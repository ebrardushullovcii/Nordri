import type { ApplicationAttemptQuestion } from "@nordri/contracts";

import {
  matchOption,
  personFacingNeedsYouReason,
  resolveApplyAnswer,
  resolveReusableAnswer,
} from "./answer-sourcing";
import { normalizeSignal } from "./control-classification";
import {
  buildCoverLetterRequest,
  coverLetterPolicyAllows,
  coverLetterDeliveryFor,
  isCoverLetterControl,
  looksLikeUsableLetter,
  requiredLetterFileType,
} from "./cover-letter";
import { attemptKey, judgeBlockedAttempt } from "./blocked-attempts";
import { isSecurityChallengeControl } from "./blockers";
import { runSubmitPreflight } from "./submit-preflight";
import type {
  ApplyAgentConfig,
  ApplyAnswer,
  ApplyAttachedDocument,
  ApplyFilledControl,
  ApplyFormControl,
  ApplyFormObservation,
  ApplyPause,
  ApplyProposal,
  ApplyDocument,
} from "./types";

/**
 * The safety layer between the model and the page.
 *
 * It is deliberately thin. The model decides where to go, what to press, and
 * how to get through a site; none of that is second-guessed here. What this
 * layer does is the short list of things that must not depend on a model
 * being right:
 *
 * - an answer about the person comes from the person's own facts, not from
 *   the model's memory of them
 * - a declaration the person has to make themselves is only made when they
 *   approved that exact kind in advance
 * - a write proposed against a page that has since moved on is retried
 *   against the page as it is now, rather than landing in the wrong field
 * - sending an application goes through its own preflight and authority
 * - the origin allowlist is enforced only at the irreversible send preflight;
 *   ordinary navigation is governed by the reviewed-move path below
 *
 * Everything else — cookie banners, chat widgets, redirects, listings that
 * link to a different company's site, buttons made out of divs — is the
 * model's to work out, the way a person would.
 */

export type ApplyExecutionOutcome =
  | { kind: "observed"; observation: ApplyFormObservation }
  /** A read the model asked for. Carries no page change. */
  | { kind: "read"; text: string; observation: ApplyFormObservation }
  | {
      kind: "filled";
      filled: ApplyFilledControl;
      observation: ApplyFormObservation;
    }
  | {
      kind: "attached";
      attachment: ApplyAttachedDocument;
      observation: ApplyFormObservation;
    }
  /** A movement on the page. Only a real page/location change is progress. */
  | {
      kind: "moved";
      note: string;
      observation: ApplyFormObservation;
      progress: boolean;
    }
  /** What the person's own facts say about one field, for the model to use. */
  | {
      kind: "suggestion";
      answer: ApplyAnswer | null;
      note: string;
      /**
       * The exact question, recorded when nothing can answer it and the form
       * requires it. The model asked; this is what it would have to hand back
       * to the person.
       */
      question: ApplicationAttemptQuestion | null;
      controlRef: string;
      observation: ApplyFormObservation;
    }
  | { kind: "paused"; pause: ApplyPause }
  /** The step did not fit the page. The loop says why and the model retries. */
  | { kind: "refused"; reason: string; observation: ApplyFormObservation }
  | {
      kind: "ready_to_send";
      finalActionRef: string;
      finalActionLabel: string;
      observation: ApplyFormObservation;
    }
  | {
      kind: "finished";
      reason: string;
      stuck: boolean;
      needsPerson: boolean;
    };

export interface ApplyExecutorDeps {
  config: ApplyAgentConfig;
  now: () => Date;
  guardState: ApplyGuardState;
  checkWrittenAnswer?: (
    question: string,
    answer: string,
  ) => Promise<{
    supported: boolean;
    reason: string;
  }>;
}

export interface ApplyGuardState {
  acknowledged: Set<string>;
  hasWritten: boolean;
  lastFieldLabel: string | null;
  /** Plain notes about traffic that was blocked and safely ignored. */
  notes: string[];
  /** Origins the run has already told the model about, so it says it once. */
  reportedOrigins: Set<string>;
  /** How many of the site's own saves the guard blocked and tolerated. */
  blockedSaveCount: number;
  /** The most recent one, so a form that will not move on can name the site. */
  lastBlockedSave: { host: string | null; fieldLabel: string | null } | null;
  /** Origins off the listing's site that a review allowed, with the reason. */
  approvedOrigins: Map<string, string>;
  /** Where the run last was, for the reviewer's "from". */
  lastOnSiteUrl: string | null;
}

export function createApplyGuardState(): ApplyGuardState {
  return {
    acknowledged: new Set<string>(),
    hasWritten: false,
    lastFieldLabel: null,
    notes: [],
    reportedOrigins: new Set<string>(),
    blockedSaveCount: 0,
    lastBlockedSave: null,
    approvedOrigins: new Map(),
    lastOnSiteUrl: null,
  };
}

/**
 * A stable name for one question.
 *
 * Tied to what the question says rather than where it sits, so a form that
 * renumbers its fields does not turn a saved answer into a new question the
 * person is asked all over again. Two controls that say exactly the same
 * thing are told apart by which comes first, and only then.
 */
function questionIdFor(
  control: ApplyFormControl,
  jobId: string,
  siblings: readonly ApplyFormControl[] = [],
): string {
  const identity = (candidate: ApplyFormControl): string =>
    candidate.kind === "radio" && candidate.choiceGroupKey
      ? `radio|${candidate.choiceGroupKey}`
      : `${normalizeSignal(candidate.groupLabel)}|${normalizeSignal(candidate.label)}|${candidate.kind}`;
  const digest = (value: string): string => {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const semanticIdentity =
    control.kind === "radio"
      ? `${control.groupLabel || "choice"} ${control.kind}`
      : `${control.groupLabel} ${control.label} ${control.kind}`;
  const slug = semanticIdentity
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 60);
  const same = siblings.filter(
    (candidate) => identity(candidate) === identity(control),
  );
  const ordinal = same.findIndex((candidate) => candidate.ref === control.ref);
  const choiceSuffix =
    control.kind === "radio" && control.choiceGroupKey
      ? `_${digest(control.choiceGroupKey)}`
      : "";
  const suffix =
    choiceSuffix || (same.length > 1 && ordinal > 0 ? `_${ordinal + 1}` : "");
  return `question_${jobId}_${slug || "field"}${suffix}`;
}

/**
 * The question as the person reads it.
 *
 * A field whose group says the same thing as its own label reads as one
 * question, not two: "Phone — Phone" is what a saved answer then fails to
 * match on the next run.
 */
/**
 * A file field that names another file. An empty read-back is not evidence
 * either way: some sites clear the field once they hold the file.
 */
export function fileFieldHoldsOtherFile(
  value: string,
  fileName: string,
): boolean {
  const shown = value.split(/[\\/]/u).at(-1)?.trim() ?? "";
  return shown !== "" && !shown.includes(fileName) && !fileName.includes(shown);
}

export function questionPrompt(control: ApplyFormControl): string {
  const label = control.label.trim();
  const group = control.groupLabel.trim();
  const normalizedLabel = normalizeSignal(label);
  const normalizedGroup = normalizeSignal(group);
  if (control.kind === "radio" && group.length > 0) return group;
  const groupAddsSomething =
    normalizedGroup.length > 0 &&
    normalizedLabel.length > 0 &&
    !normalizedLabel.includes(normalizedGroup) &&
    !normalizedGroup.includes(normalizedLabel);
  const prompt = groupAddsSomething ? `${group} — ${label}` : label || group;
  return (
    prompt || control.placeholder.trim() || "A question on the application form"
  );
}

export function buildPendingQuestion(input: {
  control: ApplyFormControl;
  jobId: string;
  detectedAt: string;
  suggestion: ApplyAnswer | null;
  siblings?: readonly ApplyFormControl[];
  /** Why stored answers did not settle it, said beside the question. */
  reason?: string | null;
}): ApplicationAttemptQuestion {
  const { control, suggestion } = input;
  const note = input.reason ? personFacingNeedsYouReason(input.reason) : null;
  const radioSiblings =
    control.kind === "radio" && control.choiceGroupKey
      ? (input.siblings ?? []).filter(
          (candidate) =>
            candidate.kind === "radio" &&
            candidate.choiceGroupKey === control.choiceGroupKey,
        )
      : [];
  const answerOptions =
    radioSiblings.length > 0
      ? radioSiblings.map((candidate) => candidate.value || candidate.label)
      : control.options;
  return {
    id: questionIdFor(control, input.jobId, input.siblings ?? []),
    prompt: questionPrompt(control),
    kind: control.questionKind,
    answerControlType: control.answerControlType,
    isRequired: control.required,
    detectedAt: input.detectedAt,
    // A list's blank first choice is not an answer anyone could give.
    answerOptions: answerOptions
      .filter((option) => option.trim().length > 0)
      .slice(0, 40),
    suggestedAnswers: suggestion
      ? [
          {
            id: `${questionIdFor(control, input.jobId, input.siblings ?? [])}_suggestion`,
            text: suggestion.value,
            sourceKind:
              suggestion.sourceKind === "answer_library" ? "user" : "profile",
            sourceId: suggestion.sourceId,
            confidenceLabel: null,
            provenance: [],
          },
        ]
      : [],
    ...(note ? { note } : {}),
    submittedAnswer: null,
    status: "detected",
  };
}

function leaveUnansweredForPerson(input: {
  control: ApplyFormControl;
  observation: ApplyFormObservation;
  config: ApplyAgentConfig;
  at: string;
  reason: string;
  suggestion: ApplyAnswer | null;
}): ApplyExecutionOutcome {
  const { control, observation, config, at, reason, suggestion } = input;
  return {
    kind: "suggestion",
    answer: suggestion,
    note: `"${questionPrompt(control)}" needs the person's answer. ${reason} Leave it unchanged and carry on with the rest of the form.`,
    question: control.required
      ? buildPendingQuestion({
          control,
          jobId: config.application.jobId,
          detectedAt: at,
          suggestion,
          siblings: observation.controls,
          reason,
        })
      : null,
    controlRef: control.ref,
    observation,
  };
}

function bareOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function continuationSectionRoot(value: string): string | null {
  try {
    const url = new URL(value);
    const firstSegment = url.pathname.split("/").filter(Boolean)[0];
    return firstSegment ? `${url.origin}/${firstSegment}/` : `${url.origin}/`;
  } catch {
    return null;
  }
}

/**
 * A continued run may advance inside the retained wizard, but it must not
 * discard that form by returning to the exact old source page or its site
 * header. Those addresses are supplied by Job Finder from this application;
 * no ATS route names are guessed here.
 */
function refuseContinuationBacktrack(
  targetUrl: string,
  current: ApplyFormObservation,
  deps: ApplyExecutorDeps,
): string | null {
  const continuation = deps.config.application.continuation;
  if (!continuation || !current.url) return null;
  // A sign-in may land on an account page with a search or newsletter field
  // before the application is visible. It still needs to follow the known job
  // link. Protect only a page with actual application-form evidence.
  const candidateControls = current.controls.filter(
    (control) =>
      control.credentialRole !== "identifier" &&
      control.credentialRole !== "password" &&
      control.questionKind !== "other",
  );
  const hasApplicationFormEvidence =
    current.step.index !== null ||
    current.controls.some((control) => control.kind === "file") ||
    candidateControls.length >= 2 ||
    (candidateControls.length > 0 &&
      current.actions.some(
        (action) => action.kind === "advance" || action.kind === "final",
      ));
  if (!hasApplicationFormEvidence) return null;
  let target: URL;
  let here: URL;
  try {
    target = new URL(targetUrl, current.url);
    here = new URL(current.url);
  } catch {
    return null;
  }
  if (target.toString() === here.toString() || target.origin !== here.origin) {
    return null;
  }
  const oldSources = continuation.sourceUrls.flatMap((sourceUrl) => {
    try {
      return [new URL(sourceUrl).toString()];
    } catch {
      return [];
    }
  });
  const sourceSectionRoots = continuation.sourceUrls.flatMap((sourceUrl) => {
    const root = continuationSectionRoot(sourceUrl);
    return root ? [root] : [];
  });
  if (
    !oldSources.includes(target.toString()) &&
    !sourceSectionRoots.includes(target.toString())
  ) {
    return null;
  }
  return "This run is continuing the retained application form. Stay on that form instead of returning to the site home or the older job listing.";
}

/**
 * Whether the run may be on this page.
 *
 * A listing on one site whose form lives on another is the ordinary shape of
 * job applications. It is also how a run ends up on a search engine or a
 * scraper mirror, one "that is normal" at a time. So a move off the listing's
 * site is allowed only for a reason the model states, judged by a second
 * opinion against the goal; an origin allowed once stays allowed for the
 * run. Submission authority is checked separately by `runSubmitPreflight`;
 * reaching and filling an employer form does not itself send an application.
 */
async function authorizeOrigin(
  observationOrUrl: ApplyFormObservation | string,
  reason: string | null,
  deps: ApplyExecutorDeps,
): Promise<{ refuse: string | null; note: string | null }> {
  const { config } = deps;
  const origin =
    typeof observationOrUrl === "string"
      ? bareOrigin(observationOrUrl)
      : observationOrUrl.origin;
  if (!origin) {
    return { refuse: null, note: null };
  }

  const startOrigin = bareOrigin(config.application.startingUrl);
  if (!startOrigin || origin === startOrigin) {
    return { refuse: null, note: null };
  }
  if (deps.guardState.approvedOrigins.has(origin)) {
    return { refuse: null, note: null };
  }
  if (!config.reviewMove) {
    if (!deps.guardState.reportedOrigins.has(origin)) {
      deps.guardState.reportedOrigins.add(origin);
      return {
        refuse: null,
        note: `This is now ${origin}, a different site from the listing.`,
      };
    }
    return { refuse: null, note: null };
  }
  if (!reason) {
    return {
      refuse: `${origin} is a different site from the listing. To go there, say why in reason: what on the page points there and what you expect to find. A second review reads it.`,
      note: null,
    };
  }
  const url =
    typeof observationOrUrl === "string"
      ? observationOrUrl
      : (observationOrUrl.url ?? origin);
  const review = await config.reviewMove({
    url,
    reason,
    fromUrl: deps.guardState.lastOnSiteUrl,
  });
  if (!review.allowed) {
    deps.guardState.notes.push(
      `Stayed off ${origin}. Reason given: ${reason} Review: ${review.verdict}`,
    );
    return {
      refuse: `${origin} is a different site from the listing, and a review of your reason did not allow going there: ${review.verdict}`,
      note: null,
    };
  }
  deps.guardState.approvedOrigins.set(origin, reason);
  deps.guardState.notes.push(
    `Went to ${origin} because: ${reason} Allowed after review: ${review.verdict}`,
  );
  return {
    refuse: null,
    note: `This is now ${origin}, a different site from the listing. Leaving was allowed after review: ${review.verdict}`,
  };
}

/**
 * After a move that turned out to be refused: back to where the run was.
 */
async function retreat(
  deps: ApplyExecutorDeps,
  refusal: string,
): Promise<{
  kind: "refused";
  reason: string;
  observation: ApplyFormObservation;
}> {
  const back = await deps.config.hands.goBack();
  const observation = await deps.config.hands.observe();
  return {
    kind: "refused",
    reason: `${refusal}${back.ok ? " Job Finder went back." : ""}`,
    observation,
  };
}

function findControl(
  observation: ApplyFormObservation,
  ref: string,
): ApplyFormControl | null {
  return observation.controls.find((control) => control.ref === ref) ?? null;
}

/**
 * Performs one write with the prepare-only guard watching.
 *
 * The value is declared to the guard first, so it can tell a request carrying
 * the answer from one that does not. When field saves are allowed, a short
 * same-origin window is opened before the write and left to run out, so the
 * save the site sends a moment later still gets through.
 */
async function writeUnderGuard(
  deps: ApplyExecutorDeps,
  input: {
    declaredValue: string | null;
    write: () => Promise<
      { ok: true; observedValue: string } | { ok: false; error: string }
    >;
  },
): Promise<{ ok: true; observedValue: string } | { ok: false; error: string }> {
  const safety = deps.config.safety;
  if (!safety) {
    return input.write();
  }
  if (input.declaredValue) {
    await safety.registerPreparedValue(input.declaredValue);
  }
  if (deps.config.intermediateWritesAuthorized === true) {
    // Opened before the write and left to expire on its own. Sites save a
    // field a moment after it changes, not during the write; closing the
    // window the instant the write returned blocked exactly those saves and
    // left every select on the form reverting to empty.
    await safety.openIntermediateWriteWindow().catch(() => undefined);
  }
  return input.write();
}

/** What the guard saw around one write: a reason to stop, or a tab to follow. */
interface GuardReview {
  pause: ApplyPause | null;
  /** Where a tab the page tried to open was going, when it tried. */
  openedWindowUrl: string | null;
}

/** Whether the guard stopped something worth ending the run over. */
async function guardStop(
  deps: ApplyExecutorDeps,
  pageUrl: string | null,
): Promise<ApplyPause | null> {
  return (await reviewGuard(deps, pageUrl)).pause;
}

async function reviewGuard(
  deps: ApplyExecutorDeps,
  pageUrl: string | null,
): Promise<GuardReview> {
  const safety = deps.config.safety;
  if (!safety) {
    return { pause: null, openedWindowUrl: null };
  }
  const attempt = await safety.readBlockedAttempt();
  const judgement = judgeBlockedAttempt({
    attempt,
    acknowledged: deps.guardState.acknowledged,
    hasWritten: deps.guardState.hasWritten,
    pageUrl,
    lastFieldLabel: deps.guardState.lastFieldLabel,
  });
  if (judgement.stop) {
    return {
      pause: {
        code: "site_tried_to_send",
        summary: judgement.summary,
        question: null,
        blocker: null,
      },
      openedWindowUrl: null,
    };
  }
  let openedWindowUrl: string | null = null;
  if (attempt && judgement.tolerated) {
    deps.guardState.acknowledged.add(attemptKey(attempt));
    if (judgement.note) {
      deps.guardState.notes.push(judgement.note);
    }
    if (judgement.savesAsYouGo) {
      deps.guardState.lastBlockedSave = {
        host: judgement.savesAsYouGo.host,
        fieldLabel: deps.guardState.lastFieldLabel,
      };
      deps.guardState.blockedSaveCount += 1;
    }
    if (
      judgement.openedWindow?.url &&
      /^https?:/iu.test(judgement.openedWindow.url)
    ) {
      openedWindowUrl = judgement.openedWindow.url;
    }
  }
  return { pause: null, openedWindowUrl };
}

/**
 * The pause for a form that cannot go on without saving to the site.
 *
 * Reached only when the form actually refused to take an answer or to move on
 * after a save was blocked. The person is offered the one thing that would
 * change it: letting this site save as they go — their choice, not a flag.
 */
function savesAsYouGoPause(host: string | null): ApplyPause {
  const summary =
    "This site saves your answers as you type, and Job Finder is not allowed to let it.";
  return {
    code: "site_tried_to_send",
    summary,
    question: null,
    blocker: {
      code: "site_saves_as_you_go",
      summary,
      detail: host
        ? `The form sends each answer to ${host} as it is typed. Those were blocked, so the form would not carry on.`
        : "The form sends each answer to the site as it is typed. Those were blocked, so the form would not carry on.",
      nextActionLabel: "Allow saving on this site",
      host,
    },
  };
}

function afterWrite(deps: ApplyExecutorDeps, label: string | null): void {
  deps.guardState.hasWritten = true;
  deps.guardState.lastFieldLabel = label;
}

/**
 * Runs one step.
 *
 * `seenSignature` is the page the model was looking at. A page that has moved
 * on refuses the write and hands back what is there now, so the model can try
 * again against the real page rather than the run stopping.
 */
export async function executeApplyProposal(
  proposal: ApplyProposal,
  seenSignature: string,
  deps: ApplyExecutorDeps,
): Promise<ApplyExecutionOutcome> {
  const { config } = deps;
  const at = deps.now().toISOString();

  if (proposal.tool === "finish") {
    return {
      kind: "finished",
      reason: proposal.reason,
      stuck: proposal.stuck === true,
      needsPerson: proposal.needsPerson === true,
    };
  }

  // Reads and page moves never need a fresh observation first; the hands
  // return one afterwards anyway.
  switch (proposal.tool) {
    case "observe":
      return { kind: "observed", observation: await config.hands.observe() };
    case "read_text": {
      const text = await config.hands.readText(proposal.ref);
      return { kind: "read", text, observation: await config.hands.observe() };
    }
    case "navigate": {
      const reason = proposal.reason ?? null;
      const current = await config.hands.observe();
      const continuationRefusal = refuseContinuationBacktrack(
        proposal.url,
        current,
        deps,
      );
      if (continuationRefusal) {
        return {
          kind: "refused",
          reason: continuationRefusal,
          observation: current,
        };
      }
      const before = await authorizeOrigin(proposal.url, reason, deps);
      if (before.refuse) {
        return {
          kind: "refused",
          reason: before.refuse,
          observation: await config.hands.observe(),
        };
      }
      const moved = await config.hands.navigate(proposal.url);
      const observation = await config.hands.observe();
      if (!moved.ok) {
        return { kind: "refused", reason: moved.error, observation };
      }
      const origin = await authorizeOrigin(observation, reason, deps);
      if (origin.refuse) {
        return retreat(deps, origin.refuse);
      }
      deps.guardState.lastOnSiteUrl = observation.url;
      return {
        kind: "moved",
        note: [`Opened ${moved.url}.`, before.note ?? origin.note]
          .filter(Boolean)
          .join(" "),
        observation,
        progress: true,
      };
    }
    case "follow_link": {
      const reason = proposal.reason ?? null;
      const current = await config.hands.observe();
      const link =
        current.links.find((entry) => entry.ref === proposal.ref) ?? null;
      const continuationRefusal = link
        ? refuseContinuationBacktrack(link.href, current, deps)
        : null;
      if (continuationRefusal) {
        return {
          kind: "refused",
          reason: continuationRefusal,
          observation: current,
        };
      }
      const accountCreationLink = link
        ? /^(?:create (?:an? )?account|register|sign up)(?:\b|$)/iu.test(
            link.label.trim(),
          ) ||
          /(?:^|\/)(?:signup|sign-up|register|registration)(?:\/|$)/iu.test(
            (() => {
              try {
                return new URL(link.href).pathname;
              } catch {
                return link.href;
              }
            })(),
          )
        : false;
      if (accountCreationLink && config.accountCreationAuthorized !== true) {
        return {
          kind: "refused",
          reason:
            "Creating an account has not been authorized. Use an existing sign-in path, or finish and leave account creation with the person.",
          observation: current,
        };
      }
      const before = link
        ? await authorizeOrigin(link.href, reason, deps)
        : { refuse: null, note: null };
      if (before.refuse) {
        return { kind: "refused", reason: before.refuse, observation: current };
      }
      const moved = await config.hands.followLink(proposal.ref);
      const observation = await config.hands.observe();
      if (!moved.ok) {
        return { kind: "refused", reason: moved.error, observation };
      }
      const origin = await authorizeOrigin(observation, reason, deps);
      if (origin.refuse) {
        return retreat(deps, origin.refuse);
      }
      deps.guardState.lastOnSiteUrl = observation.url;
      return {
        kind: "moved",
        note: [
          `Followed ${link?.label ? `"${link.label}"` : "the link"} to ${moved.url}.`,
          before.note ?? origin.note,
        ]
          .filter(Boolean)
          .join(" "),
        observation,
        progress: true,
      };
    }
    case "go_back": {
      const moved = await config.hands.goBack();
      const observation = await config.hands.observe();
      if (moved.ok) deps.guardState.lastOnSiteUrl = observation.url;
      return moved.ok
        ? {
            kind: "moved",
            note: `Went back to ${moved.url}.`,
            observation,
            progress: true,
          }
        : { kind: "refused", reason: moved.error, observation };
    }
    case "scroll": {
      await config.hands.scroll(proposal.direction);
      return {
        kind: "moved",
        note: `Scrolled ${proposal.direction}.`,
        observation: await config.hands.observe(),
        progress: false,
      };
    }
    case "wait": {
      await config.hands.wait(proposal.milliseconds);
      return {
        kind: "moved",
        note: `Waited ${Math.round(proposal.milliseconds)}ms.`,
        observation: await config.hands.observe(),
        progress: false,
      };
    }
    default:
      break;
  }

  const observation = await config.hands.observe();
  deps.guardState.lastOnSiteUrl = observation.url;

  if (proposal.tool === "suggest_answer") {
    const control = findControl(observation, proposal.ref);
    if (!control) {
      return {
        kind: "refused",
        reason: `There is no ${proposal.ref} on this page.`,
        observation,
      };
    }
    const resolution = resolveApplyAnswer({
      control,
      sources: config.sources,
      salaryDisclosure: config.authority.salaryDisclosure,
    });
    if (resolution.status === "answered") {
      return {
        kind: "suggestion",
        answer: resolution.answer,
        note: `"${questionPrompt(control)}": ${resolution.answer.value} — from ${resolution.answer.provenanceLabel}.`,
        question: null,
        controlRef: control.ref,
        observation,
      };
    }
    if (resolution.status === "map_choice") {
      return {
        kind: "suggestion",
        answer: resolution.context,
        note: `Saved context for "${questionPrompt(control)}": ${resolution.context.value}. Choices: ${control.options.join(", ")}.`,
        question: null,
        controlRef: control.ref,
        observation,
      };
    }
    if (resolution.status === "write_free_text") {
      return {
        kind: "suggestion",
        answer: null,
        note: `Nothing stored answers "${questionPrompt(control)}". It takes prose, so write it yourself from ${resolution.grounding.join(", ")}.`,
        question: null,
        controlRef: control.ref,
        observation,
      };
    }
    return {
      kind: "suggestion",
      answer: resolution.suggestion,
      note: `Nothing can answer "${questionPrompt(control)}" honestly. ${resolution.reason}${
        resolution.suggestion
          ? ` The closest is "${resolution.suggestion.value}", which does not fit.`
          : ""
      } If it is required, finish and say this one needs the person.`,
      // Recorded now so the person gets the exact question if the run ends
      // without it being answered.
      question: control.required
        ? buildPendingQuestion({
            control,
            jobId: config.application.jobId,
            detectedAt: at,
            suggestion: resolution.suggestion,
            siblings: observation.controls,
            reason: resolution.reason,
          })
        : null,
      controlRef: control.ref,
      observation,
    };
  }

  // A page that moved on since the model looked is retried, not stopped: the
  // model gets what is there now and decides again.
  if (observation.signature !== seenSignature) {
    return {
      kind: "refused",
      reason:
        "The page changed since you last looked, so that step was not taken. Here is the page as it is now — decide again from this.",
      observation,
    };
  }

  // Security checks stay with the person. A continuation after the person
  // solved one used to tick the box again, which unticked their answer.
  if (
    (proposal.tool === "click" ||
      proposal.tool === "type" ||
      proposal.tool === "select" ||
      proposal.tool === "set_checkbox") &&
    (() => {
      const control = findControl(observation, proposal.ref);
      return control !== null && isSecurityChallengeControl(control);
    })()
  ) {
    return {
      kind: "refused",
      reason:
        "That control is a security check. Only the person answers it; leave it exactly as it is and carry on with the rest of the form.",
      observation,
    };
  }

  // Validate attachment selection before leaving a form step. An earlier
  // attempt may still hold a different resume on this retained page.
  if (proposal.tool === "click" || proposal.tool === "submit_application") {
    const action =
      "ref" in proposal
        ? observation.actions.find(
            (candidate) => candidate.ref === proposal.ref,
          )
        : null;
    if (
      proposal.tool !== "click" ||
      action?.kind === "advance" ||
      action?.kind === "final"
    ) {
      const resume = config.sources.documents.find(
        (document) => document.kind === "resume",
      );
      const staleUpload = observation.controls.find(
        (control) =>
          control.kind === "file" &&
          control.questionKind === "resume" &&
          control.answered &&
          resume &&
          fileFieldHoldsOtherFile(control.value, resume.fileName),
      );
      if (staleUpload && resume) {
        return {
          kind: "refused",
          reason: `"${questionPrompt(staleUpload)}" still contains ${staleUpload.value.split(/[\\/]/u).at(-1)}. The selected resume is ${resume.fileName}.`,
          observation,
        };
      }
    }
  }

  switch (proposal.tool) {
    case "click": {
      const control = findControl(observation, proposal.ref);
      if (control?.kind === "checkbox" || control?.kind === "radio") {
        // A click changes an answer just as set_checkbox does. Keep consent
        // and grounded-answer checks on both routes to the same control.
        return executeApplyProposal(
          {
            tool: "set_checkbox",
            ref: control.ref,
            checked: control.kind === "radio" || !control.checked,
          },
          observation.signature,
          deps,
        );
      }
      const finalAction = observation.actions.find(
        (candidate) =>
          candidate.ref === proposal.ref && candidate.kind === "final",
      );
      if (finalAction) {
        const preflight = runSubmitPreflight({
          observation,
          proposedActionRef: proposal.ref,
          authority: config.authority,
        });
        if (!preflight.ok) {
          return { kind: "refused", reason: preflight.reason, observation };
        }
        // Models sometimes choose the generic click tool for the visible send
        // button. Treat that as the same intent as submit_application so the
        // irreversible action still belongs to the separately authorized
        // submission path and is never pressed from the preparation loop.
        return {
          kind: "ready_to_send",
          finalActionRef: proposal.ref,
          finalActionLabel: finalAction.label,
          observation,
        };
      }
      const livePage = await config.hands.observe();
      const personOwnedBlocker = livePage.blocker?.requiresPerson
        ? livePage.blocker
        : null;
      if (
        personOwnedBlocker &&
        !(
          personOwnedBlocker.code === "account_creation_required" &&
          config.accountCreationAuthorized === true
        )
      ) {
        return {
          kind: "paused",
          pause: {
            code: "page_blocked",
            summary: personOwnedBlocker.summary,
            question: null,
            blocker: personOwnedBlocker,
          },
        };
      }
      const blockedSavesBefore = deps.guardState.blockedSaveCount;
      const write = await writeUnderGuard(deps, {
        declaredValue: null,
        write: () => config.hands.clickElement(proposal.ref),
      });
      if (!write.ok) {
        return { kind: "refused", reason: write.error, observation };
      }
      afterWrite(deps, null);
      const review = await reviewGuard(deps, observation.url);
      if (review.pause) {
        return { kind: "paused", pause: review.pause };
      }
      // The thing pressed wanted a new tab. A person would simply end up on
      // it; so does the run, in the one tab it works in.
      const reason = proposal.reason ?? null;
      if (review.openedWindowUrl) {
        const before = await authorizeOrigin(
          review.openedWindowUrl,
          reason,
          deps,
        );
        if (before.refuse) {
          return {
            kind: "refused",
            reason: `Pressing ${describeRef(observation, proposal.ref)} tried to open ${review.openedWindowUrl} in a new tab. ${before.refuse}`,
            observation: await config.hands.observe(),
          };
        }
        const followed = await config.hands.navigate(review.openedWindowUrl);
        const landed = await config.hands.observe();
        if (!followed.ok) {
          return {
            kind: "refused",
            reason: `Pressing ${describeRef(observation, proposal.ref)} tried to open ${review.openedWindowUrl} in a new tab, and that page would not open here: ${followed.error}`,
            observation: landed,
          };
        }
        const landedOrigin = await authorizeOrigin(landed, reason, deps);
        if (landedOrigin.refuse) {
          return retreat(deps, landedOrigin.refuse);
        }
        deps.guardState.lastOnSiteUrl = landed.url;
        return {
          kind: "moved",
          note: `Pressing ${describeRef(observation, proposal.ref)} opened ${followed.url} in a new tab. Job Finder works in one tab, so it opened that address here instead.${(before.note ?? landedOrigin.note) ? ` ${before.note ?? landedOrigin.note}` : ""}`,
          observation: landed,
          progress: true,
        };
      }
      const after = await config.hands.observe();
      // Moving on is where a blocked save stops being harmless: the site
      // wanted to save before it would advance, and the page has not.
      const blockedOnThisMove =
        deps.guardState.blockedSaveCount > blockedSavesBefore;
      // Only a run that is not allowed to let the site save can be stuck
      // here. When saving is allowed a blocked save is a page quirk the
      // agent works around, not a reason to stop.
      if (
        deps.config.intermediateWritesAuthorized !== true &&
        (blockedOnThisMove || deps.guardState.lastBlockedSave !== null) &&
        after.signature === observation.signature
      ) {
        return {
          kind: "paused",
          pause: savesAsYouGoPause(
            deps.guardState.lastBlockedSave?.host ?? null,
          ),
        };
      }
      const movedOrigin = await authorizeOrigin(after, reason, deps);
      if (movedOrigin.refuse) {
        return retreat(
          deps,
          `Pressing ${describeRef(observation, proposal.ref)} led to ${after.origin ?? "another site"}. ${movedOrigin.refuse}`,
        );
      }
      deps.guardState.lastOnSiteUrl = after.url;
      return {
        kind: "moved",
        note: [
          `Pressed ${describeRef(observation, proposal.ref)}.`,
          movedOrigin.note,
        ]
          .filter(Boolean)
          .join(" "),
        observation: after,
        progress:
          after.url !== observation.url ||
          after.signature !== observation.signature,
      };
    }

    case "type": {
      const control = findControl(observation, proposal.ref);
      if (!control) {
        return {
          kind: "refused",
          reason: `There is no ${proposal.ref} on this page.`,
          observation,
        };
      }
      if (!control.visible || control.disabled || control.readOnly) {
        return {
          kind: "refused",
          reason: `"${questionPrompt(control)}" cannot be edited right now.`,
          observation,
        };
      }
      if (observation.blocker?.requiresPerson === true) {
        return {
          kind: "paused",
          pause: {
            code: "page_blocked",
            summary: observation.blocker.summary,
            question: null,
            blocker: observation.blocker,
          },
        };
      }

      // One application sends one letter. A box asking for it gets the same
      // words as a file field would, so the person never discovers they sent
      // two different letters for the same job.
      if (isCoverLetterControl(control)) {
        const policy = config.writing?.coverLetterPolicy ?? "when_required";
        if (!coverLetterPolicyAllows(control, policy)) {
          if (policy === "never" && control.required) {
            return {
              kind: "paused",
              pause: {
                code: "document_needs_you",
                summary:
                  "This form requires a letter, but your settings say Job Finder should not write one. Add the letter yourself or change that setting, then continue.",
                question: buildPendingQuestion({
                  control,
                  jobId: config.application.jobId,
                  detectedAt: at,
                  suggestion: null,
                }),
                blocker: null,
              },
            };
          }
          return {
            kind: "refused",
            reason:
              policy === "never"
                ? "Your settings say not to write or attach letters. Leave this field blank and continue."
                : "Your settings say to write a letter only when the form requires one. This field is optional, so leave it blank and continue.",
            observation,
          };
        }
        if (!config.letters) {
          return {
            kind: "refused",
            reason: "Job Finder has no letter for this application.",
            observation,
          };
        }
        const letter = await provideApplicationLetter(deps, control);
        if (letter.kind !== "ok") {
          return letter.outcome;
        }
        const typed = await writeUnderGuard(deps, {
          declaredValue: letter.letter.text,
          write: () => config.hands.fillText(control.ref, letter.letter.text),
        });
        if (!typed.ok) {
          return { kind: "refused", reason: typed.error, observation };
        }
        afterWrite(deps, questionPrompt(control));
        const letterStop = await guardStop(deps, observation.url);
        if (letterStop) {
          return { kind: "paused", pause: letterStop };
        }
        return {
          kind: "filled",
          filled: {
            ref: control.ref,
            label: questionPrompt(control),
            questionKind: "cover_letter",
            answer: {
              value: letter.letter.text,
              kind: "cover_letter",
              sourceKind: "generated",
              sourceId: "application.letter",
              provenanceLabel: "the letter written for this application",
              groundedIn: letter.letter.groundedIn,
            },
            at,
          },
          observation: await config.hands.observe(),
        };
      }

      // An answer about the person comes from the person. When their own facts
      // answer this question, that is what goes in, whatever the model typed.
      const resolution = resolveApplyAnswer({
        control,
        sources: config.sources,
        salaryDisclosure: config.authority.salaryDisclosure,
      });
      if (resolution.status === "needs_you") {
        return leaveUnansweredForPerson({
          control,
          observation,
          config,
          at,
          reason: resolution.reason,
          suggestion: resolution.suggestion,
        });
      }
      if (resolution.status !== "answered" && deps.checkWrittenAnswer) {
        const check = await deps.checkWrittenAnswer(
          questionPrompt(control),
          proposal.text,
        );
        if (!check.supported) {
          return {
            kind: "suggestion",
            answer: null,
            note: `That answer was not written because it contains an unsupported applicant claim: ${check.reason} Use only supported facts, or leave this field blank and continue with the other fields. ${control.required ? "The required question has been kept for the person if no supported answer is available." : "This field is optional; do not ask the person to fill it."}`,
            question: control.required
              ? buildPendingQuestion({
                  control,
                  jobId: config.application.jobId,
                  detectedAt: at,
                  suggestion: null,
                  siblings: observation.controls,
                })
              : null,
            controlRef: control.ref,
            observation,
          };
        }
      }
      const answer: ApplyAnswer =
        resolution.status === "answered"
          ? resolution.answer
          : {
              value: proposal.text,
              kind: control.questionKind,
              sourceKind: "generated",
              sourceId: `written.${control.ref}`,
              provenanceLabel: "written for this application",
              groundedIn:
                proposal.groundedIn && proposal.groundedIn.length > 0
                  ? proposal.groundedIn
                  : resolution.status === "write_free_text"
                    ? resolution.grounding
                    : ["the posting"],
            };

      const write = await writeUnderGuard(deps, {
        declaredValue: answer.value,
        write: () => config.hands.fillText(control.ref, answer.value),
      });
      if (!write.ok) {
        return { kind: "refused", reason: write.error, observation };
      }
      afterWrite(deps, questionPrompt(control));
      const stop = await guardStop(deps, observation.url);
      if (stop) {
        return { kind: "paused", pause: stop };
      }
      return {
        kind: "filled",
        filled: {
          ref: control.ref,
          label: questionPrompt(control),
          questionKind: control.questionKind,
          answer,
          at,
        },
        observation: await config.hands.observe(),
      };
    }

    case "select": {
      const control = findControl(observation, proposal.ref);
      if (!control) {
        return {
          kind: "refused",
          reason: `There is no ${proposal.ref} on this page.`,
          observation,
        };
      }
      const resolution = resolveApplyAnswer({
        control,
        sources: config.sources,
        salaryDisclosure: config.authority.salaryDisclosure,
      });
      if (resolution.status === "needs_you") {
        return leaveUnansweredForPerson({
          control,
          observation,
          config,
          at,
          reason: resolution.reason,
          suggestion: resolution.suggestion,
        });
      }
      if (resolution.status === "map_choice") {
        const option = matchOption(control.options, proposal.option);
        const check =
          option && deps.checkWrittenAnswer
            ? await deps.checkWrittenAnswer(questionPrompt(control), option)
            : null;
        if (!check?.supported) {
          return leaveUnansweredForPerson({
            control,
            observation,
            config,
            at,
            reason:
              check?.reason ??
              "Your saved answer does not settle which choice to use.",
            suggestion: resolution.context,
          });
        }
      }
      const groundedOption =
        resolution.status === "answered"
          ? matchOption(control.options, resolution.answer.value)
          : null;
      if (
        resolution.status === "answered" &&
        control.options.length > 0 &&
        !groundedOption
      ) {
        return {
          kind: "refused",
          reason: `The saved answer for ${questionPrompt(control)} does not match an option on the form.`,
          observation,
        };
      }
      const option =
        groundedOption ??
        (control.options.length > 0
          ? (matchOption(control.options, proposal.option) ?? proposal.option)
          : resolution.status === "answered"
            ? resolution.answer.value
            : proposal.option);
      const usedGroundedAnswer =
        resolution.status === "answered" &&
        (groundedOption === option ||
          (control.options.length === 0 && resolution.answer.value === option));
      const write = await writeUnderGuard(deps, {
        declaredValue: option,
        write: () => config.hands.chooseOption(control.ref, option),
      });
      if (!write.ok) {
        return { kind: "refused", reason: write.error, observation };
      }
      afterWrite(deps, questionPrompt(control));
      const stop = await guardStop(deps, observation.url);
      if (stop) {
        return { kind: "paused", pause: stop };
      }
      return {
        kind: "filled",
        filled: {
          ref: control.ref,
          label: questionPrompt(control),
          questionKind: control.questionKind,
          answer:
            resolution.status === "map_choice"
              ? { ...resolution.context, value: option }
              : resolution.status === "answered" && usedGroundedAnswer
                ? resolution.answer
                : {
                    value: option,
                    kind: control.questionKind,
                    sourceKind: "generated",
                    sourceId: `chosen.${control.ref}`,
                    provenanceLabel: "chosen from the options on the form",
                    groundedIn: ["the options this form offered"],
                  },
          at,
        },
        observation: await config.hands.observe(),
      };
    }

    case "set_checkbox": {
      const control = findControl(observation, proposal.ref);
      if (!control) {
        return {
          kind: "refused",
          reason: `There is no ${proposal.ref} on this page.`,
          observation,
        };
      }
      const groundedRadioResolution =
        control.kind === "radio"
          ? resolveApplyAnswer({
              control,
              sources: config.sources,
              salaryDisclosure: config.authority.salaryDisclosure,
            })
          : null;
      if (
        control.kind === "radio" &&
        proposal.checked &&
        groundedRadioResolution?.status === "needs_you"
      ) {
        return leaveUnansweredForPerson({
          control,
          observation,
          config,
          at,
          reason: groundedRadioResolution.reason,
          suggestion: groundedRadioResolution.suggestion,
        });
      }
      if (control.kind === "radio" && proposal.checked) {
        if (groundedRadioResolution?.status === "map_choice") {
          const check = deps.checkWrittenAnswer
            ? await deps.checkWrittenAnswer(
                questionPrompt(control),
                control.label || control.value,
              )
            : null;
          if (!check?.supported) {
            return leaveUnansweredForPerson({
              control,
              observation,
              config,
              at,
              reason:
                check?.reason ??
                "Your saved answer does not settle which choice to use.",
              suggestion: groundedRadioResolution.context,
            });
          }
        }
        if (groundedRadioResolution?.status === "answered") {
          const groupControls = observation.controls.filter(
            (candidate) =>
              candidate.kind === "radio" &&
              (control.choiceGroupKey
                ? candidate.choiceGroupKey === control.choiceGroupKey
                : candidate.ref === control.ref),
          );
          const offeredValues = groupControls.map(
            (candidate) => candidate.label || candidate.value,
          );
          const groundedOption = matchOption(
            offeredValues,
            groundedRadioResolution.answer.value,
          );
          const proposedOption = control.label || control.value;
          if (
            !groundedOption ||
            normalizeSignal(groundedOption) !== normalizeSignal(proposedOption)
          ) {
            return {
              kind: "refused",
              reason: `That choice contradicts ${groundedRadioResolution.answer.provenanceLabel}. The grounded answer is "${groundedRadioResolution.answer.value}"; select its matching option instead.`,
              observation,
            };
          }
        }
      }
      // A declaration the person makes about themselves is theirs. This is the
      // one place the model is overruled rather than advised. It is not,
      // however, a reason to stop: the run used to end on the first such box
      // with the rest of the form untouched, and the person came back to a
      // half-filled page and a "Needs you" that never cleared. The box is left
      // for them, the model carries on, and the question is handed back with
      // the finished form ("1 question left for you", ADR 0022).
      //
      // A "Yes" the person saved for this exact question earlier counts as
      // their approval: they answered it once and asked to keep it.
      const savedDeclaration =
        control.attestationKind !== null && proposal.checked
          ? resolveReusableAnswer(control, config.sources.reusableAnswers)
          : null;
      const savedDeclarationSaysYes =
        savedDeclaration !== null &&
        /^(yes|true|agree|i agree|accept|checked|on|1)\b/iu.test(
          savedDeclaration.value.trim(),
        );
      if (
        control.attestationKind !== null &&
        proposal.checked &&
        !config.authority.preApprovedAttestationKinds.includes(
          control.attestationKind,
        ) &&
        !savedDeclarationSaysYes
      ) {
        return {
          kind: "suggestion",
          answer: null,
          note: `"${questionPrompt(control)}" is a declaration only the person can make, and they have not approved that kind in advance. Job Finder left it unticked.${control.required ? " It will be handed to them with the finished form." : " It is optional, so no answer is needed."} Do not try to tick it again; carry on with the rest of the application, and when everything else is done call finish.`,
          question: control.required
            ? buildPendingQuestion({
                control,
                jobId: config.application.jobId,
                detectedAt: at,
                suggestion: null,
                siblings: observation.controls,
              })
            : null,
          controlRef: control.ref,
          observation,
        };
      }
      const write = await writeUnderGuard(deps, {
        declaredValue: null,
        write: () => config.hands.setToggle(control.ref, proposal.checked),
      });
      if (!write.ok) {
        return { kind: "refused", reason: write.error, observation };
      }
      afterWrite(deps, questionPrompt(control));
      const stop = await guardStop(deps, observation.url);
      if (stop) {
        return { kind: "paused", pause: stop };
      }
      return {
        kind: "filled",
        filled: {
          ref: control.ref,
          label: questionPrompt(control),
          questionKind: control.questionKind,
          answer:
            savedDeclarationSaysYes && savedDeclaration
              ? savedDeclaration
              : groundedRadioResolution?.status === "map_choice"
                ? {
                    ...groundedRadioResolution.context,
                    value: control.label || control.value,
                  }
                : groundedRadioResolution?.status === "answered"
                  ? groundedRadioResolution.answer
                  : {
                      value:
                        control.kind === "radio" && proposal.checked
                          ? control.value || control.label
                          : proposal.checked
                            ? "Yes"
                            : "No",
                      kind: control.questionKind,
                      sourceKind: control.attestationKind
                        ? "profile"
                        : "generated",
                      sourceId: control.attestationKind
                        ? `authority.attestation.${control.attestationKind}`
                        : `chosen.${control.ref}`,
                      provenanceLabel: control.attestationKind
                        ? "a declaration you approved in advance"
                        : "chosen on the form",
                      groundedIn: [
                        control.attestationKind
                          ? "a declaration you approved in advance"
                          : "the form",
                      ],
                    },
          at,
        },
        observation: await config.hands.observe(),
      };
    }

    case "upload": {
      const control = findControl(observation, proposal.ref);
      if (!control) {
        return {
          kind: "refused",
          reason: `There is no ${proposal.ref} on this page.`,
          observation,
        };
      }
      if (isCoverLetterControl(control)) {
        const policy = config.writing?.coverLetterPolicy ?? "when_required";
        // The person's own cover letter (Profile › Files) beats a written one
        // and beats the "only when required" rule: they added the file in
        // order to send it, so an optional letter field gets it too. Only
        // "never" keeps every letter field for them.
        const ownLetter =
          policy === "never"
            ? undefined
            : config.sources.documents.find(
                (candidate) => candidate.kind === "cover_letter",
              );
        if (ownLetter) {
          const ownBytes = await ownLetter.loadBytes();
          const ownUpload = await writeUnderGuard(deps, {
            declaredValue: ownLetter.fileName,
            write: () =>
              config.hands.uploadFile(control.ref, {
                name: ownLetter.fileName,
                mimeType: ownLetter.mimeType,
                bytes: ownBytes,
              }),
          });
          if (!ownUpload.ok) {
            return { kind: "refused", reason: ownUpload.error, observation };
          }
          if (
            fileFieldHoldsOtherFile(ownUpload.observedValue, ownLetter.fileName)
          ) {
            return {
              kind: "refused",
              reason:
                "The form did not keep the selected file. Nothing was recorded as attached.",
              observation: await config.hands.observe(),
            };
          }
          afterWrite(deps, questionPrompt(control));
          const ownStop = await guardStop(deps, observation.url);
          if (ownStop) {
            return { kind: "paused", pause: ownStop };
          }
          return {
            kind: "attached",
            attachment: {
              ...(ownLetter.reviewText
                ? { reviewText: ownLetter.reviewText }
                : {}),
              documentId: ownLetter.id,
              fileName: ownLetter.fileName,
              label: ownLetter.label,
              controlLabel: questionPrompt(control),
              at,
            },
            observation: await config.hands.observe(),
          };
        }
        if (!coverLetterPolicyAllows(control, policy)) {
          if (policy === "never" && control.required) {
            return {
              kind: "paused",
              pause: {
                code: "document_needs_you",
                summary:
                  "This form requires a letter, but your settings say Job Finder should not write one. Attach the letter yourself or change that setting, then continue.",
                question: buildPendingQuestion({
                  control,
                  jobId: config.application.jobId,
                  detectedAt: at,
                  suggestion: null,
                }),
                blocker: null,
              },
            };
          }
          return {
            kind: "refused",
            reason:
              policy === "never"
                ? "Your settings say not to write or attach letters. Leave this field blank and continue."
                : "Your settings say to write a letter only when the form requires one. This field is optional, so leave it blank and continue.",
            observation,
          };
        }
        if (!config.letters) {
          return {
            kind: "refused",
            reason: "Job Finder has no letter for this application.",
            observation,
          };
        }
        const letter = await provideApplicationLetter(deps, control);
        if (letter.kind !== "ok") {
          return letter.outcome;
        }
        if (!letter.letter.document) {
          return {
            kind: "paused",
            pause: {
              code: "document_needs_you",
              summary: `This form wants the letter as a file Job Finder cannot produce for "${questionPrompt(control)}". Attach one here and it will be used.`,
              question: buildPendingQuestion({
                control,
                jobId: config.application.jobId,
                detectedAt: at,
                suggestion: null,
              }),
              blocker: null,
            },
          };
        }
        const letterFile = letter.letter.document;
        const letterBytes = await letterFile.loadBytes();
        const letterUpload = await writeUnderGuard(deps, {
          declaredValue: letterFile.fileName,
          write: () =>
            config.hands.uploadFile(control.ref, {
              name: letterFile.fileName,
              mimeType: letterFile.mimeType,
              bytes: letterBytes,
            }),
        });
        if (!letterUpload.ok) {
          return { kind: "refused", reason: letterUpload.error, observation };
        }
        if (
          fileFieldHoldsOtherFile(
            letterUpload.observedValue,
            letterFile.fileName,
          )
        ) {
          return {
            kind: "refused",
            reason:
              "The form did not keep the selected file. Nothing was recorded as attached.",
            observation: await config.hands.observe(),
          };
        }
        afterWrite(deps, questionPrompt(control));
        const letterStop = await guardStop(deps, observation.url);
        if (letterStop) {
          return { kind: "paused", pause: letterStop };
        }
        return {
          kind: "attached",
          attachment: {
            reviewText: {
              text: letter.letter.text,
              groundedIn: letter.letter.groundedIn,
            },
            documentId: letterFile.id,
            fileName: letterFile.fileName,
            label: letterFile.label,
            controlLabel: questionPrompt(control),
            at,
          },
          observation: await config.hands.observe(),
        };
      }

      const document = config.sources.documents.find(
        (candidate) => candidate.id === proposal.documentId,
      );
      if (!document) {
        return {
          kind: "refused",
          reason: `There is no file called ${proposal.documentId}. The ones available are listed in your instructions; if the form wants something else, finish and say what it asked for.`,
          observation,
        };
      }
      if (
        (control.questionKind === "portfolio" ||
          /\b(?:portfolio|work samples?)\b/iu.test(
            `${control.groupLabel} ${control.label}`,
          )) &&
        document.kind !== "portfolio" &&
        document.kind !== "work_sample"
      ) {
        return {
          kind: "refused",
          reason:
            "A portfolio upload needs the person's portfolio or work sample. Job Finder cannot create a substitute for it.",
          observation,
        };
      }
      const fileLabel = `${control.groupLabel} ${control.label}`;
      if (
        (/\btranscripts?\b/iu.test(fileLabel) &&
          document.kind !== "transcript") ||
        (/\bcertificates?\b/iu.test(fileLabel) &&
          document.kind !== "certificate")
      ) {
        return {
          kind: "refused",
          reason:
            "This upload needs the person's matching file. Job Finder cannot create a substitute for it.",
          observation,
        };
      }
      const bytes = await document.loadBytes();
      if (bytes.byteLength === 0) {
        return {
          kind: "refused",
          reason: `${document.label} came back empty, so nothing was attached.`,
          observation,
        };
      }
      const write = await writeUnderGuard(deps, {
        declaredValue: document.fileName,
        write: () =>
          config.hands.uploadFile(control.ref, {
            name: document.fileName,
            mimeType: document.mimeType,
            bytes,
          }),
      });
      if (!write.ok) {
        return { kind: "refused", reason: write.error, observation };
      }
      if (fileFieldHoldsOtherFile(write.observedValue, document.fileName)) {
        return {
          kind: "refused",
          reason:
            "The form did not keep the selected file. Nothing was recorded as attached.",
          observation: await config.hands.observe(),
        };
      }
      afterWrite(deps, questionPrompt(control));
      const stop = await guardStop(deps, observation.url);
      if (stop) {
        return { kind: "paused", pause: stop };
      }
      return {
        kind: "attached",
        attachment: {
          ...(document.reviewText ? { reviewText: document.reviewText } : {}),
          documentId: document.id,
          fileName: document.fileName,
          label: document.label,
          controlLabel: questionPrompt(control),
          at,
        },
        observation: await config.hands.observe(),
      };
    }

    case "submit_application": {
      const preflight = runSubmitPreflight({
        observation,
        proposedActionRef: proposal.ref,
        authority: config.authority,
      });
      if (!preflight.ok) {
        return { kind: "refused", reason: preflight.reason, observation };
      }
      const action = observation.actions.find(
        (candidate) => candidate.ref === proposal.ref,
      );
      // Nothing is pressed here. Sending an application is one irreversible
      // act that has to be recorded as it happens, so it belongs to the
      // submission path rather than to this loop.
      return {
        kind: "ready_to_send",
        finalActionRef: proposal.ref,
        finalActionLabel: action?.label ?? "Submit application",
        observation,
      };
    }

    default: {
      const exhaustive: never = proposal;
      return {
        kind: "refused",
        reason: `Unsupported step: ${JSON.stringify(exhaustive)}`,
        observation,
      };
    }
  }
}

type LetterOutcome =
  | {
      kind: "ok";
      letter: {
        text: string;
        document: ApplyDocument | null;
        groundedIn: string[];
      };
    }
  | { kind: "stop"; outcome: ApplyExecutionOutcome };

/**
 * Gets the one letter for this application.
 *
 * Written once and handed back unchanged after that, so a form that asks for a
 * file and a form that asks for a box never end up with two different letters.
 */
async function provideApplicationLetter(
  deps: ApplyExecutorDeps,
  control: ApplyFormControl,
): Promise<LetterOutcome> {
  const { config } = deps;
  const letters = config.letters;
  if (!letters) {
    return {
      kind: "stop",
      outcome: {
        kind: "refused",
        reason: "Job Finder has no letter for this application.",
        observation: await config.hands.observe(),
      },
    };
  }

  const request = buildCoverLetterRequest({
    sources: config.sources,
    preference: letters.preference,
  });
  const produced = await letters.provide({
    ...request,
    purpose: "cover_letter",
    delivery: coverLetterDeliveryFor(control),
    fileType: requiredLetterFileType(control),
  });

  const pauseWith = (summary: string): LetterOutcome => ({
    kind: "stop",
    outcome: {
      kind: "paused",
      pause: {
        code: "document_needs_you",
        summary,
        question: buildPendingQuestion({
          control,
          jobId: config.application.jobId,
          detectedAt: deps.now().toISOString(),
          suggestion: null,
        }),
        blocker: null,
      },
    },
  });

  if (!produced.ok) {
    return pauseWith(
      `Job Finder could not write the letter this form asks for. ${produced.reason}`,
    );
  }
  // A letter with a gap in it must never go out; the person is asked instead.
  if (!looksLikeUsableLetter(produced.text)) {
    return pauseWith(
      "The letter Job Finder wrote for this application did not come out usable, so nothing was attached. Write or attach one here and it will be used.",
    );
  }

  return {
    kind: "ok",
    letter: {
      text: produced.text,
      document: produced.document,
      groundedIn: request.groundedIn,
    },
  };
}

function describeRef(observation: ApplyFormObservation, ref: string): string {
  const action = observation.actions.find((entry) => entry.ref === ref);
  if (action?.label) return `"${action.label}"`;
  const link = observation.links.find((entry) => entry.ref === ref);
  if (link?.label) return `"${link.label}"`;
  const clickable = observation.clickables.find((entry) => entry.ref === ref);
  if (clickable?.label) return `"${clickable.label}"`;
  return ref;
}
