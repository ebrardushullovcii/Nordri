import { resumeFormFileNames } from "@nordri/contracts";
import {
  parseToolArguments,
  runAgentLoop,
  type AgentLoopFinish,
  type AgentLoopModel,
  type AgentLoopTool,
  type AgentLoopToolOutcome,
} from "@nordri/agent-runtime";
import {
  describeBrowserError,
  type ApplicationAttemptQuestion,
} from "@nordri/contracts";

import type { LLMClient } from "../agent/contracts";
import { createPageTools } from "../page-tools";
import {
  createApplySystemPrompt,
  createApplyUserPrompt,
  describeObservation,
} from "./apply-prompts";
import {
  FILL_FIELDS_TOOL_DEFINITION,
  getApplyToolDefinitions,
  parseApplyProposal,
  parseFillFields,
  type FillFieldsEntry,
} from "./apply-tools";
import {
  buildPendingQuestion,
  createApplyGuardState,
  executeApplyProposal,
  fileFieldHoldsOtherFile,
  questionPrompt,
  type ApplyExecutionOutcome,
} from "./policy-executor";
import {
  buildCoverLetterRequest,
  coverLetterPolicyAllows,
  isCoverLetterControl,
} from "./cover-letter";
import { createQuestionClassifier } from "./question-classification";
import {
  applicationFacts,
  savedAnswerForQuestion,
  storedFactFor,
} from "./application-facts";
import { normalizeSignal } from "./control-classification";
import {
  checkFormReadiness,
  runSubmitPreflight,
  unresolvedRequiredControls,
} from "./submit-preflight";
import { matchOption } from "./option-match";
import {
  checkWrittenApplicationAnswer,
  checkWrittenApplicationAnswers,
  WrittenAnswerCheckUnavailableError,
  type WrittenAnswerCheck,
} from "./written-answer-grounding";
import {
  isSecurityChallengeControl,
  reportedSecurityChallenge,
} from "./blockers";
import type {
  ApplyAgentConfig,
  ApplyAgentResult,
  ApplyAttachedDocument,
  ApplyFilledControl,
  ApplyFormObservation,
  ApplyDocument,
  ApplyPause,
  ApplyProposal,
} from "./types";

const DEFAULT_MAX_STEPS = 200;
// Long forms on a slow model took 16 minutes to reach the review step;
// 15 minutes cut them off just before it.
const DEFAULT_TIME_BUDGET_MS = 30 * 60_000;
const DEFAULT_NO_PROGRESS_STEP_LIMIT = 12;

const PAGE_TOOL_NAMES = new Set([
  "observe",
  "read_text",
  "navigate",
  "follow_link",
  "scroll",
  "wait",
  "go_back",
]);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function defaultOutcomeFor(
  config: ApplyAgentConfig,
): "prepared" | "awaiting_your_review" {
  return config.authority.mode === "confirm_before_submit"
    ? "awaiting_your_review"
    : "prepared";
}

function describePrepared(
  config: ApplyAgentConfig,
  filledCount: number,
  attachmentCount: number,
): string {
  const filledPart =
    filledCount === 1
      ? "filled in 1 answer"
      : `filled in ${filledCount} answers`;
  const attachmentPart =
    attachmentCount === 0
      ? ""
      : attachmentCount === 1
        ? " and attached 1 file"
        : ` and attached ${attachmentCount} files`;
  const ending =
    config.authority.mode === "confirm_before_submit"
      ? "It is ready for you to look over and send."
      : "It is filled in and waiting; nothing was sent.";
  return `Job Finder ${filledPart}${attachmentPart} on ${config.siteLabel}. ${ending}`;
}

function browserFailureKind(toolName: string): "browser" | "tool" {
  return [
    "click",
    "type",
    "select",
    "set_checkbox",
    "submit_application",
  ].includes(toolName)
    ? "browser"
    : "tool";
}

const GENERIC_FILE_WORDS = new Set([
  "a",
  "an",
  "application",
  "attach",
  "attachment",
  "document",
  "file",
  "required",
  "the",
  "upload",
]);

function hasMatchingApplicationDocument(
  control: ApplyFormObservation["controls"][number],
  documents: readonly ApplyDocument[],
): boolean {
  const prompt = questionPrompt(control).toLowerCase();
  if (
    control.questionKind === "resume" &&
    /(?:\bresume\b|curriculum vitae|\bcv\b)/u.test(prompt)
  ) {
    return documents.some((document) => document.kind === "resume");
  }
  if (
    control.questionKind === "cover_letter" &&
    /(?:cover|motivation)[ -]?letter/u.test(prompt)
  ) {
    return documents.some((document) => document.kind === "cover_letter");
  }
  const promptWords = prompt
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 2 && !GENERIC_FILE_WORDS.has(word));
  if (promptWords.length === 0) return false;
  return documents.some((document) => {
    if (document.kind === "resume" || document.kind === "cover_letter") {
      return false;
    }
    const description = `${document.label} ${document.fileName}`.toLowerCase();
    return promptWords.some((word) => description.includes(word));
  });
}

function stuckReasonMentionsRequiredFile(
  reason: string,
  control: ApplyFormObservation["controls"][number],
): boolean {
  const normalizedReason = reason.toLowerCase();
  if (/\b(?:attach|document|file|upload)\b/u.test(normalizedReason)) {
    return true;
  }
  const promptWords = questionPrompt(control)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 3 && !GENERIC_FILE_WORDS.has(word));
  return promptWords.some((word) => normalizedReason.includes(word));
}

function isApplicationLetterOrStatement(
  control: ApplyFormObservation["controls"][number],
): boolean {
  const prompt = questionPrompt(control).toLowerCase();
  return (
    isCoverLetterControl(control) ||
    /\b(?:supporting|personal) statement\b/u.test(prompt)
  );
}

function canGenerateRequiredApplicationDocument(
  control: ApplyFormObservation["controls"][number],
  config: ApplyAgentConfig,
): boolean {
  if (!config.letters || !isApplicationLetterOrStatement(control)) {
    return false;
  }
  const policy = config.writing?.coverLetterPolicy ?? "when_required";
  return coverLetterPolicyAllows(control, policy);
}

export async function runApplyAgent(
  config: ApplyAgentConfig,
  llmClient: LLMClient,
): Promise<ApplyAgentResult> {
  const now = config.now ?? (() => new Date());
  const filled: ApplyFilledControl[] = [];
  const attachments: ApplyAttachedDocument[] = [];
  const observedAnswers = new Map<string, ApplyFilledControl>();
  const observedAttachments = new Map<string, ApplyAttachedDocument>();
  const pauses: ApplyPause[] = [];
  const notes: string[] = [];
  const timeline: { at: string; text: string }[] = [];
  const reviewObservedFieldKeys = new Set<string>();
  const pendingQuestions = new Map<string, ApplicationAttemptQuestion>();
  // A run that stops for the person (a check only they can pass) is first
  // asked once to fill the fields it already knows, so the person is left
  // only the part the agent could not do.
  let stuckFinishNudged = false;
  const guardState = createApplyGuardState();
  const classifyQuestions = config.modelQuestionClassification
    ? createQuestionClassifier({ client: llmClient, signal: config.signal })
    : undefined;
  const documentCatalog: ApplyDocument[] = [...config.sources.documents];
  const runConfig: ApplyAgentConfig = {
    ...config,
    sources: { ...config.sources, documents: documentCatalog },
  };
  let readyToSend: ApplyAgentResult["readyToSend"] = null;
  const payDisclosed =
    config.authority.salaryDisclosure === "answer_from_profile";
  const resumeText =
    (config.sources.resumeText ?? config.sources.profile.baseResume.textContent)
      ?.trim()
      .slice(0, 8_000) || null;
  const checkOne = (question: string, answer: string) =>
    checkWrittenApplicationAnswer({
      client: llmClient,
      sources: runConfig.sources,
      payDisclosed,
      question,
      answer,
      signal: config.signal,
    });
  /**
   * The single step a fill_fields entry stands for, and the answer the fact
   * check will be asked about, worded exactly as that step asks it.
   */
  const fillFieldStep = (
    entry: FillFieldsEntry,
    observation: ApplyFormObservation,
  ):
    | {
        proposal: ApplyProposal;
        check: { question: string; answer: string } | null;
      }
    | { error: string } => {
    const control = observation.controls.find(
      (candidate) => candidate.ref === entry.ref,
    );
    if (!control) return { error: `There is no ${entry.ref} on this page.` };
    const needsCheck = (
      target: ApplyFormObservation["controls"][number],
      answer: string,
    ) =>
      target.attestationKind === null &&
      !isCoverLetterControl(target) &&
      normalizeSignal(
        savedAnswerForQuestion(target, runConfig.sources.reusableAnswers)
          ?.answer ?? "",
      ) !== normalizeSignal(answer) &&
      !storedFactFor({
        sources: runConfig.sources,
        payDisclosed,
        control: target,
        value: answer,
      })
        ? { question: questionPrompt(target), answer }
        : null;
    switch (control.kind) {
      case "file":
        return {
          error: `"${questionPrompt(control)}" takes a file: use upload.`,
        };
      case "checkbox":
        return {
          proposal: {
            tool: "set_checkbox",
            ref: control.ref,
            checked: /^(?:yes|true|checked|on|1|tick|ticked|agree)$/iu.test(
              entry.value,
            ),
          },
          check: null,
        };
      case "radio": {
        const group = observation.controls.filter(
          (candidate) =>
            candidate.kind === "radio" &&
            (control.choiceGroupKey
              ? candidate.choiceGroupKey === control.choiceGroupKey
              : candidate.ref === control.ref),
        );
        const labels = group.map(
          (candidate) => candidate.label || candidate.value,
        );
        const label = matchOption(labels, entry.value);
        const chosen = label
          ? group.find(
              (candidate) => (candidate.label || candidate.value) === label,
            )
          : undefined;
        if (!chosen) {
          return {
            error: `"${entry.value}" is not one of the choices for "${questionPrompt(control)}": ${labels.slice(0, 12).join(", ")}.`,
          };
        }
        return {
          proposal: { tool: "set_checkbox", ref: chosen.ref, checked: true },
          check: needsCheck(chosen, chosen.label || chosen.value),
        };
      }
      case "select":
      case "combobox": {
        const option =
          control.options.length > 0
            ? matchOption(control.options, entry.value)
            : entry.value;
        return {
          proposal: { tool: "select", ref: control.ref, option: entry.value },
          check: option ? needsCheck(control, option) : null,
        };
      }
      default:
        return {
          proposal: {
            tool: "type",
            ref: control.ref,
            text: entry.value,
            ...(entry.groundedIn ? { groundedIn: entry.groundedIn } : {}),
          },
          check: needsCheck(control, entry.value),
        };
    }
  };
  let requiredEmptyNudged = false;
  let advanceFinishNudged = false;
  let finalActionNudged = false;
  let staleResumeNudged = false;
  let optionalLetterNudged = false;

  const pendingQuestionKey = (
    control: Pick<
      ApplyFormObservation["controls"][number],
      "ref" | "kind" | "choiceGroupKey"
    >,
  ): string =>
    (control.kind === "radio" || control.kind === "checkbox") &&
    control.choiceGroupKey
      ? `${control.kind}:${control.choiceGroupKey}`
      : control.ref;

  await config.onProgress?.({
    step: 0,
    note: "reading the application form",
    progressSteps: 0,
    elapsedMs: 0,
  });

  const note = (text: string): void => {
    notes.push(text);
    timeline.push({ at: now().toISOString(), text });
  };
  const collectedQuestionsPause = (): ApplyPause | null => {
    const questions = [...pendingQuestions.values()];
    const first = questions[0];
    if (!first) return null;
    return {
      code: questions.every((question) => question.answerControlType === "file")
        ? "document_needs_you"
        : "question_needs_you",
      summary: questions.every(
        (question) => question.answerControlType === "file",
      )
        ? `Add the required ${questions.map((question) => question.prompt).join(" and ")} to continue.`
        : questions.length === 1
          ? `Job Finder filled in what it could on ${config.siteLabel} and needs your answer to one question.`
          : `Job Finder filled in what it could on ${config.siteLabel} and needs your answers to ${questions.length} questions.`,
      question: first,
      questions,
      blocker: null,
    };
  };

  const startOrigin = originOf(config.application.startingUrl);
  const pageTools = createPageTools(config.hands, {
    allowUrl: (url) => {
      const origin = originOf(url);
      if (!origin) return null;
      if (config.reviewMove && startOrigin && origin !== startOrigin) {
        return `${origin} is a different site from the listing.`;
      }
      return null;
    },
    ...(config.reviewMove
      ? {
          reviewMove: async (move: {
            url: string;
            reason: string;
            fromUrl: string | null;
          }) => {
            return config.reviewMove!(move);
          },
        }
      : {}),
  });

  const syncObservation = (next: ApplyFormObservation): void => {
    pageTools.state.observation = next;
    // Classify the page's questions now, while the model reads the page, so
    // the first answer does not wait for it. Writes await the same result.
    void classifyQuestions?.(next.controls).catch(() => undefined);
    // A person or a later page write may have answered a previously pending
    // question. Keep the live controls authoritative when continuing.
    // Refs are page-local. Retain only questions that still describe an
    // unresolved control on this step, rather than a field from an older page.
    for (const [key, pending] of pendingQuestions) {
      const current = next.controls.find(
        (control) =>
          pendingQuestionKey(control) === key &&
          questionPrompt(control) === pending.prompt,
      );
      if (
        !current ||
        current.disabled ||
        (!current.visible && current.kind !== "file") ||
        current.answered
      )
        pendingQuestions.delete(key);
    }
    readyToSend = null;
    for (const control of next.controls) {
      if (control.disabled || (!control.visible && control.kind !== "file"))
        continue;
      const label = questionPrompt(control);
      const fieldKey =
        `${next.url?.split(/[?#]/u)[0] ?? ""}|${next.step.label ?? ""}|${control.choiceGroupKey ?? control.ref}|${label}`.slice(
          0,
          2_000,
        );
      reviewObservedFieldKeys.add(fieldKey);
      if (control.kind === "file") {
        if (control.answered) {
          const fileName =
            control.value.split(/[\\/]/u).at(-1) ?? control.value;
          const recorded = [...attachments]
            .reverse()
            .find(
              (entry) =>
                entry.controlLabel === label && entry.fileName === fileName,
            );
          observedAttachments.set(fieldKey, {
            ...(recorded ?? {
              documentId: `observed.${control.ref}`,
              fileName,
              label,
              controlLabel: label,
              at: next.observedAt,
            }),
            fieldKey,
          });
        } else {
          observedAttachments.delete(fieldKey);
        }
      } else if (
        control.answered &&
        ((control.kind !== "radio" && control.kind !== "checkbox") ||
          control.checked) &&
        !isSecurityChallengeControl(control)
      ) {
        const value =
          control.kind === "checkbox"
            ? control.answerControlType === "multi_choice"
              ? next.controls
                  .filter(
                    (candidate) =>
                      candidate.choiceGroupKey === control.choiceGroupKey &&
                      candidate.checked,
                  )
                  .map((candidate) => candidate.label || candidate.value)
                  .join(", ")
              : "Yes"
            : control.kind === "radio"
              ? control.label || control.value
              : control.selectedOptionLabel || control.value;
        if (value.trim()) {
          const recorded = [...filled]
            .reverse()
            .find(
              (entry) => entry.label === label && entry.answer.value === value,
            );
          observedAnswers.set(fieldKey, {
            ...(recorded ?? {
              ref: control.ref,
              label,
              questionKind: control.questionKind,
              answer: {
                value,
                kind: control.questionKind,
                sourceKind: "profile",
                sourceId: `observed.${control.ref}`,
                provenanceLabel: "the filled application form",
                groundedIn: [],
              },
              at: next.observedAt,
            }),
            fieldKey,
          });
        }
      } else if (
        (control.kind !== "radio" && control.kind !== "checkbox") ||
        !control.answered
      ) {
        observedAnswers.delete(fieldKey);
      }
      if (control.answered)
        pendingQuestions.delete(pendingQuestionKey(control));
    }
    if (next.url && !pageTools.state.visitedUrls.includes(next.url)) {
      pageTools.state.visitedUrls.push(next.url);
    }
    for (const [origin, reason] of pageTools.state.approvedOrigins) {
      guardState.approvedOrigins.set(origin, reason);
    }
    for (const [origin, reason] of guardState.approvedOrigins) {
      pageTools.state.approvedOrigins.set(origin, reason);
    }
  };

  let openingMessage: string;
  try {
    syncObservation(await pageTools.observe());
    openingMessage = `The page you have landed on:\n\n${describeObservation(pageTools.state.observation!)}`;
  } catch (error) {
    const detail = describeBrowserError(error, "The page did not open.");
    note(`The application page did not open. ${detail}`);
    openingMessage = `The first attempt to read the application page failed: ${detail} Use the browser tools to recover: wait, navigate to the starting address, or observe again.`;
  }

  const definitions = new Map(
    getApplyToolDefinitions().map((definition) => [
      definition.function.name,
      definition,
    ]),
  );

  // A step inside fill_fields reports one line; the page is shown once, after
  // the whole batch.
  const outcomeToLoop = async (
    outcome: ApplyExecutionOutcome,
    options: { withPage?: boolean } = {},
  ): Promise<AgentLoopToolOutcome> => {
    const withPage = options.withPage !== false;
    switch (outcome.kind) {
      case "observed":
        syncObservation(outcome.observation);
        return {
          kind: "ok",
          content: describeObservation(outcome.observation),
        };
      case "read":
        syncObservation(outcome.observation);
        return {
          kind: "ok",
          content: outcome.text.slice(0, 20_000) || "That has no text.",
        };
      case "filled":
        filled.push(outcome.filled);
        pendingQuestions.delete(
          pendingQuestionKey(
            outcome.observation.controls.find(
              (control) => control.ref === outcome.filled.ref,
            ) ?? {
              ref: outcome.filled.ref,
              kind: "other",
            },
          ),
        );
        syncObservation(outcome.observation);
        note(
          `Answered "${outcome.filled.label}" from ${outcome.filled.answer.provenanceLabel}.`,
        );
        return {
          kind: "ok",
          progress: true,
          content: withPage
            ? `Filled in "${outcome.filled.label}". The form now looks like this:\n\n${describeObservation(outcome.observation)}`
            : `Filled in "${outcome.filled.label}".`,
        };
      case "attached":
        attachments.push(outcome.attachment);
        syncObservation(outcome.observation);
        note(
          `Attached ${outcome.attachment.label} to "${outcome.attachment.controlLabel}".`,
        );
        return {
          kind: "ok",
          progress: true,
          content: withPage
            ? `Attached ${outcome.attachment.label}. The form now looks like this:\n\n${describeObservation(outcome.observation)}`
            : `Attached ${outcome.attachment.label}.`,
        };
      case "moved":
        syncObservation(outcome.observation);
        note(outcome.note);
        return {
          kind: "ok",
          progress: outcome.progress,
          content: withPage
            ? `${outcome.note}\n\nThe page now:\n\n${describeObservation(outcome.observation)}`
            : outcome.note,
        };
      case "suggestion":
        syncObservation(outcome.observation);
        if (outcome.question) {
          const control = outcome.observation.controls.find(
            (candidate) => candidate.ref === outcome.controlRef,
          );
          pendingQuestions.set(
            control ? pendingQuestionKey(control) : outcome.controlRef,
            outcome.question,
          );
        }
        return { kind: "ok", content: outcome.note };
      case "refused":
        syncObservation(outcome.observation);
        return {
          kind: "ok",
          content: withPage
            ? `${outcome.reason}\n\nThe page now:\n\n${describeObservation(outcome.observation)}`
            : outcome.reason,
        };
      case "paused":
        if (outcome.pause.code === "document_needs_you") {
          const observation = await pageTools.observe();
          const classifications = await classifyQuestions?.(
            observation.controls,
          ).catch(() => undefined);
          for (const control of observation.controls) {
            if (classifications?.get(questionPrompt(control))?.required)
              control.required = true;
          }
          syncObservation(observation);
          for (const control of unresolvedRequiredControls(observation)) {
            const key = pendingQuestionKey(control);
            if (pendingQuestions.has(key)) continue;
            pendingQuestions.set(
              key,
              buildPendingQuestion({
                control,
                jobId: config.application.jobId,
                detectedAt: now().toISOString(),
                suggestion: null,
                siblings: observation.controls,
              }),
            );
          }
        }
        if (outcome.pause.code === "document_needs_you") {
          const fileQuestion = outcome.pause.question;
          if (fileQuestion) {
            const matching = [...pendingQuestions.entries()].find(
              ([, question]) => question.id === fileQuestion.id,
            );
            if (matching) pendingQuestions.set(matching[0], fileQuestion);
          }
          outcome.pause.questions = [...pendingQuestions.values()];
        }
        pauses.push(outcome.pause);
        note(outcome.pause.summary);
        return {
          kind: "stop",
          reason: outcome.pause.summary,
          data: outcome.pause,
        };
      case "ready_to_send":
        finalActionNudged = true;
        syncObservation(outcome.observation);
        readyToSend = {
          actionRef: outcome.finalActionRef,
          actionLabel: outcome.finalActionLabel,
        };
        note("The form is complete and ready to send.");
        return {
          kind: "ok",
          progress: true,
          content:
            "The form is complete and everything checks out. Nothing has been sent: call finish now.",
        };
      case "finished": {
        // A write receipt is not proof that a controlled field retained its
        // value. Re-read the live form before accepting the model's finish.
        const observation = await pageTools.observe();
        const classifications = await classifyQuestions?.(
          observation.controls,
        ).catch(() => undefined);
        for (const control of observation.controls) {
          const classification = classifications?.get(questionPrompt(control));
          if (classification?.required) control.required = true;
        }
        syncObservation(observation);
        const resume = documentCatalog.find(
          (document) => document.kind === "resume",
        );
        const staleUpload = observation.controls.find(
          (control) =>
            control.kind === "file" &&
            control.questionKind === "resume" &&
            control.answered &&
            resume &&
            resumeFormFileNames(resume.fileName).every((name) =>
              fileFieldHoldsOtherFile(control.value, name),
            ) &&
            !attachments.some(
              (entry) =>
                entry.documentId === resume.id &&
                !fileFieldHoldsOtherFile(control.value, entry.fileName),
            ),
        );
        if (staleUpload && resume && !staleResumeNudged) {
          staleResumeNudged = true;
          return {
            kind: "ok",
            content: `"${questionPrompt(staleUpload)}" contains a different resume. The selected file is ${resume.fileName}.`,
          };
        }
        if (staleUpload && resume) {
          pauses.push({
            code: "document_needs_you",
            summary:
              "The form still contains a different resume. Attach the selected resume before sending.",
            question: buildPendingQuestion({
              control: staleUpload,
              jobId: config.application.jobId,
              detectedAt: now().toISOString(),
              suggestion: null,
            }),
            blocker: null,
          });
        }
        // "Whenever there is room" covers optional letter fields too. Ask
        // once; an empty optional field never stops the application.
        const emptyOptionalLetter =
          runConfig.writing?.coverLetterPolicy === "when_possible"
            ? observation.controls.find(
                (control) =>
                  !control.required &&
                  !control.disabled &&
                  (control.visible || control.kind === "file") &&
                  !control.answered &&
                  isCoverLetterControl(control),
              )
            : undefined;
        if (emptyOptionalLetter && !optionalLetterNudged) {
          optionalLetterNudged = true;
          return {
            kind: "ok",
            content: `"${questionPrompt(emptyOptionalLetter)}" is empty. The cover-letter setting asks for a letter in optional fields too: create and attach one before finishing.`,
          };
        }
        if (emptyOptionalLetter) {
          note(
            `Left "${questionPrompt(emptyOptionalLetter)}" empty: Job Finder could not attach a letter there.`,
          );
        }
        // Completing the current step is not completing a multi-step form.
        // Give the model a chance to carry on before accepting a handoff.
        const hasAnotherStep =
          (observation.step.index !== null &&
            observation.step.total !== null &&
            observation.step.index < observation.step.total) ||
          observation.actions.some(
            (action) => action.kind === "advance" && action.visible,
          );
        if (
          hasAnotherStep &&
          !outcome.stuck &&
          !outcome.needsPerson &&
          observation.blocker?.requiresPerson !== true &&
          pendingQuestions.size === 0
        ) {
          if (!advanceFinishNudged) {
            advanceFinishNudged = true;
            return {
              kind: "ok",
              content:
                "This form has another step. Continue on the current page to Review before finishing.",
            };
          }
        }
        const unansweredRequired = unresolvedRequiredControls(observation);
        const stuckOnMissingFile =
          outcome.stuck === true &&
          unansweredRequired.some(
            (control) =>
              control.kind === "file" &&
              stuckReasonMentionsRequiredFile(outcome.reason, control),
          );
        if (unansweredRequired.length > 0) {
          const actionable: string[] = [];
          for (const control of unansweredRequired) {
            if (pendingQuestions.has(pendingQuestionKey(control))) continue;
            if (outcome.stuck && control.kind !== "file") {
              if (stuckFinishNudged) {
                pendingQuestions.set(
                  pendingQuestionKey(control),
                  buildPendingQuestion({
                    control,
                    jobId: config.application.jobId,
                    detectedAt: now().toISOString(),
                    suggestion: null,
                    siblings: observation.controls,
                    reason:
                      control.answered && control.invalid
                        ? "The site did not accept this value. Check it and try again."
                        : null,
                  }),
                );
                continue;
              }
              actionable.push(
                `"${questionPrompt(control)}" is required and still empty. Fill it now if the person's facts answer it; the person should only have to do what you cannot.`,
              );
              continue;
            }
            // A run stuck on something other than a file leaves files as
            // they are.
            if (outcome.stuck && !stuckOnMissingFile) continue;
            if (control.kind === "file") {
              if (hasMatchingApplicationDocument(control, documentCatalog)) {
                actionable.push(
                  `"${questionPrompt(control)}" requires a file. Use upload with the matching supplied document before finishing.`,
                );
              } else if (
                canGenerateRequiredApplicationDocument(control, runConfig)
              ) {
                actionable.push(
                  `"${questionPrompt(control)}" requires a document that Job Finder is allowed to write. Use create_application_document, then upload the generated file before finishing.`,
                );
              } else if (
                isApplicationLetterOrStatement(control) &&
                (runConfig.writing?.coverLetterPolicy ?? "when_required") ===
                  "never"
              ) {
                const question = buildPendingQuestion({
                  control,
                  jobId: config.application.jobId,
                  detectedAt: now().toISOString(),
                  suggestion: null,
                  siblings: observation.controls,
                  reason:
                    "Your cover-letter setting is Never. Attach the required letter yourself or change that setting.",
                });
                pauses.push({
                  code: "document_needs_you",
                  summary:
                    "This form requires a letter, but your settings say Job Finder should not write one. Attach the letter yourself or change that setting, then continue.",
                  question,
                  questions: [question],
                  blocker: null,
                });
              } else {
                pendingQuestions.set(
                  pendingQuestionKey(control),
                  buildPendingQuestion({
                    control,
                    jobId: config.application.jobId,
                    detectedAt: now().toISOString(),
                    suggestion: null,
                    siblings: observation.controls,
                    ...(isApplicationLetterOrStatement(control)
                      ? {
                          reason:
                            "Job Finder could not create a letter for this field.",
                        }
                      : {}),
                  }),
                );
              }
              continue;
            }
            // The model is asked once to fill what the person's facts
            // answer; what is still empty after that is theirs to answer.
            if (!requiredEmptyNudged) {
              actionable.push(
                `"${questionPrompt(control)}" is required and still empty.`,
              );
              continue;
            }
            pendingQuestions.set(
              pendingQuestionKey(control),
              buildPendingQuestion({
                control,
                jobId: config.application.jobId,
                detectedAt: now().toISOString(),
                suggestion: null,
                siblings: observation.controls,
              }),
            );
          }
          if (actionable.length > 0) {
            if (outcome.stuck) stuckFinishNudged = true;
            else requiredEmptyNudged = true;
            return {
              kind: "ok",
              content: `The form is not finished yet. ${actionable.join(" ")} Fill each one the person's facts answer, then finish; a question their facts do not answer is handed to them with the form.`,
            };
          }
        }
        // The summary the person reads must not say "filled in" over empty
        // required fields; name what is still empty.
        const stillEmpty = unansweredRequired
          .filter((control) => !isSecurityChallengeControl(control))
          .map((control) => questionPrompt(control))
          .slice(0, 6);
        const reasonWithGaps =
          stillEmpty.length > 0
            ? `${outcome.reason.trim()} Still empty on the form: ${stillEmpty.join(", ")}.`
            : outcome.reason;
        const readiness = checkFormReadiness(observation);
        if (
          !readiness.ok &&
          pendingQuestions.size === 0 &&
          pauses.length === 0 &&
          !observation.blocker &&
          !reportedSecurityChallenge(outcome.reason) &&
          !outcome.needsPerson &&
          !outcome.stuck
        ) {
          pauses.push({
            code: "page_blocked",
            summary: readiness.reason,
            question: null,
            blocker: null,
          });
        }
        if (
          readiness.ok &&
          pendingQuestions.size === 0 &&
          pauses.length === 0 &&
          config.authority.mode !== "prepare_only"
        ) {
          const finalAction = observation.actions.find(
            (action) =>
              action.kind === "final" && action.visible && !action.disabled,
          )!;
          if (!finalActionNudged) {
            finalActionNudged = true;
            return {
              kind: "ok",
              content: `The form is filled in, but Job Finder has not recorded its final action yet. Use submit_application with ref "${finalAction.ref}" to record its final readiness check without pressing it.`,
            };
          }
          const preflight = runSubmitPreflight({
            observation,
            proposedActionRef: finalAction.ref,
            authority: config.authority,
          });
          if (preflight.ok) {
            readyToSend = {
              actionRef: finalAction.ref,
              actionLabel: finalAction.label,
            };
          } else {
            pauses.push({
              code: "page_blocked",
              summary: preflight.reason,
              question: null,
              blocker: null,
            });
          }
        }
        const finish: AgentLoopFinish = {
          reason: reasonWithGaps,
          stuck: outcome.stuck,
          needsPerson: outcome.needsPerson,
          data: {},
        };
        // A challenge the person already solved on this page (its box is
        // ticked) is not waiting on them, whatever the finish text says.
        const challengeControls = observation.controls.filter(
          (control) => control.visible && isSecurityChallengeControl(control),
        );
        const challengeAlreadySolved =
          challengeControls.length > 0 &&
          challengeControls.every(
            (control) =>
              control.checked ||
              (control.answered && control.value.trim().length > 0),
          );
        const challengeInReason = reportedSecurityChallenge(outcome.reason);
        if (
          challengeAlreadySolved &&
          observation.blocker === null &&
          /captcha|not a robot|verify you are (?:a )?human|security check/iu.test(
            outcome.reason,
          )
        ) {
          // The model is pointing at a check the person already solved, and
          // nothing else on the page is waiting on them.
          finish.needsPerson = false;
        }
        const reportedChallenge = challengeAlreadySolved
          ? null
          : challengeInReason;
        if (reportedChallenge) {
          pauses.push({
            code: "page_blocked",
            summary: reportedChallenge.summary,
            question: null,
            blocker: reportedChallenge,
          });
          finish.needsPerson = true;
        }
        return { kind: "finish", finish };
      }
      default: {
        const exhaustive: never = outcome;
        throw new Error(
          `Unhandled apply outcome: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  };

  const domainTools: AgentLoopTool[] = [];
  const completedControlWrites = new Set<string>();
  const controlWriteKey = (proposal: ApplyProposal): string | null => {
    if (
      proposal.tool !== "type" &&
      proposal.tool !== "select" &&
      proposal.tool !== "set_checkbox" &&
      proposal.tool !== "upload"
    ) {
      return null;
    }
    const observation = pageTools.state.observation;
    const control = observation?.controls.find(
      (candidate) => candidate.ref === proposal.ref,
    );
    return observation && control
      ? `${observation.url ?? ""}|${control.ref}|${control.kind}|${control.groupLabel}|${control.label}`
      : null;
  };
  const runProposal = async (
    proposal: ApplyProposal,
    checkWrittenAnswer: (
      question: string,
      answer: string,
    ) => Promise<WrittenAnswerCheck>,
  ): Promise<ApplyExecutionOutcome> => {
    const writeKey = controlWriteKey(proposal);
    const outcome = await executeApplyProposal(
      proposal,
      pageTools.state.observation?.signature ?? "",
      {
        config: runConfig,
        now,
        guardState,
        ...(classifyQuestions ? { classifyQuestions } : {}),
        checkWrittenAnswer,
      },
    );
    if (
      writeKey &&
      (outcome.kind === "filled" || outcome.kind === "attached")
    ) {
      completedControlWrites.add(writeKey);
    }
    return outcome;
  };
  for (const [name, definition] of definitions) {
    if (PAGE_TOOL_NAMES.has(name)) continue;
    domainTools.push({
      definition,
      failureKind: browserFailureKind(name),
      describeError: (error) =>
        error instanceof WrittenAnswerCheckUnavailableError
          ? error.message
          : describeBrowserError(error, "The browser did not respond."),
      execute: async (rawArguments) => {
        const parsed = parseApplyProposal(name, rawArguments);
        if (!parsed.ok) return { kind: "ok", content: parsed.error };
        const writeKey = controlWriteKey(parsed.proposal);
        const proposedRef =
          "ref" in parsed.proposal ? parsed.proposal.ref : null;
        const writeControl = pageTools.state.observation?.controls.find(
          (control) => control.ref === proposedRef,
        );
        if (
          writeKey &&
          writeControl?.answered &&
          completedControlWrites.has(writeKey)
        ) {
          return {
            kind: "ok",
            content:
              "That exact field was already completed on this page. Do not write it again; use the latest form observation and continue with a different empty field or finish.",
          };
        }
        return outcomeToLoop(await runProposal(parsed.proposal, checkOne));
      },
    });
  }

  domainTools.push({
    definition: FILL_FIELDS_TOOL_DEFINITION,
    failureKind: "browser",
    describeError: (error) =>
      error instanceof WrittenAnswerCheckUnavailableError
        ? error.message
        : describeBrowserError(error, "The browser did not respond."),
    execute: async (rawArguments) => {
      const parsed = parseFillFields(rawArguments);
      if (!parsed.ok) return { kind: "ok", content: parsed.error };
      const observation = pageTools.state.observation;
      if (!observation) {
        return { kind: "ok", content: "Look at the page first." };
      }
      const steps = parsed.fields.map((entry) =>
        fillFieldStep(entry, observation),
      );
      // Answers about the person are checked together, in one call, before
      // any of them is entered. A value that is a stored fact word for word
      // needs no check; a declaration or a letter is settled elsewhere.
      const toCheck = steps.flatMap((step) =>
        "check" in step && step.check ? [step.check] : [],
      );
      const prechecked = new Map<string, WrittenAnswerCheck>();
      const verdicts = await checkWrittenApplicationAnswers({
        client: llmClient,
        sources: runConfig.sources,
        payDisclosed,
        answers: toCheck,
        signal: config.signal,
      });
      toCheck.forEach((entry, index) => {
        const verdict = verdicts[index];
        if (verdict) {
          prechecked.set(`${entry.question}\u0000${entry.answer}`, verdict);
        }
      });
      const checkFromBatch = (
        question: string,
        answer: string,
      ): Promise<WrittenAnswerCheck> => {
        const known = prechecked.get(`${question}\u0000${answer}`);
        return known ? Promise.resolve(known) : checkOne(question, answer);
      };
      const lines: string[] = [];
      let wrote = false;
      for (const step of steps) {
        if ("error" in step) {
          lines.push(step.error);
          continue;
        }
        const outcome = await runProposal(step.proposal, checkFromBatch);
        if (outcome.kind === "paused") {
          return outcomeToLoop(outcome);
        }
        if (outcome.kind === "filled" || outcome.kind === "attached") {
          wrote = true;
        }
        const reported = await outcomeToLoop(outcome, { withPage: false });
        if (reported.kind === "ok") lines.push(reported.content);
      }
      const after = await pageTools.observe();
      syncObservation(after);
      return {
        kind: "ok",
        progress: wrote,
        content: `${lines.join("\n")}\n\nThe form now looks like this:\n\n${describeObservation(after)}`,
      };
    },
  });

  domainTools.push({
    definition: {
      type: "function",
      function: {
        name: "list_application_documents",
        description:
          "List every document currently available for this application, including documents created during this run. Use an id from this list with upload.",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: () =>
      Promise.resolve({
        kind: "ok",
        content:
          documentCatalog.length === 0
            ? "No application documents are available yet."
            : documentCatalog
                .map(
                  (document) =>
                    `- ${document.id}: ${document.label} (${document.fileName}, ${document.mimeType})`,
                )
                .join("\n"),
      }),
  });

  domainTools.push({
    definition: {
      type: "function",
      function: {
        name: "create_application_document",
        description:
          "Create or revise a grounded cover letter, motivation letter, or short supporting statement requested by this application, as a PDF, Word (docx) or plain text (txt) file, whichever the form accepts. The document is rendered locally and added to the application document list; creating it never uploads or submits it. Never create a substitute for a portfolio, work sample, transcript, or certificate upload.",
        parameters: {
          type: "object",
          properties: {
            purpose: {
              type: "string",
              enum: [
                "cover_letter",
                "motivation_letter",
                "supporting_statement",
              ],
            },
            instructions: {
              type: "string",
              description:
                "What the form requests and any revision needed. Do not invent candidate facts.",
            },
            fileType: { type: "string", enum: ["pdf", "docx", "txt"] },
          },
          required: ["purpose", "instructions", "fileType"],
        },
      },
    },
    execute: async (rawArguments) => {
      if (!runConfig.letters) {
        return {
          kind: "ok",
          content:
            "Document generation is unavailable in this run. Leave the field for the person and say what document the site requested.",
        };
      }
      const args = parseToolArguments(rawArguments);
      const purpose =
        args.purpose === "motivation_letter" ||
        args.purpose === "supporting_statement"
          ? args.purpose
          : "cover_letter";
      const instructions =
        typeof args.instructions === "string" ? args.instructions.trim() : "";
      const fileType =
        args.fileType === "docx" || args.fileType === "txt"
          ? args.fileType
          : "pdf";
      if (!instructions) {
        return {
          kind: "ok",
          content:
            "Say what the application requests before creating a document.",
        };
      }
      const grounding = buildCoverLetterRequest({
        sources: runConfig.sources,
        preference: runConfig.letters.preference,
      });
      const created = await runConfig.letters.provide({
        purpose,
        prompt: `${purpose.replace(/_/gu, " ")}: ${instructions}`,
        groundedIn: grounding.groundedIn,
        language: grounding.language,
        delivery: "file",
        fileType,
      });
      if (!created.ok || !created.document) {
        return {
          kind: "ok",
          content: created.ok
            ? "The document text was created, but no attachable file could be rendered."
            : `The document could not be created: ${created.reason}`,
        };
      }
      const existingIndex = documentCatalog.findIndex(
        (document) => document.id === created.document!.id,
      );
      if (existingIndex >= 0) documentCatalog.splice(existingIndex, 1);
      documentCatalog.push({
        ...created.document,
        reviewText: { text: created.text, groundedIn: grounding.groundedIn },
      });
      note(
        `Created ${purpose.replace(/_/gu, " ")} ${created.document.fileName} for this application.`,
      );
      return {
        kind: "ok",
        progress: true,
        content: `Created ${created.document.label} (${created.document.fileName}). Use documentId ${created.document.id} with upload after observing the file field.\n\nGenerated text:\n${created.text}`,
      };
    },
  });

  const loop = await runAgentLoop({
    messages: [
      { role: "system", content: createApplySystemPrompt(runConfig) },
      { role: "user", content: createApplyUserPrompt(runConfig) },
      {
        role: "user",
        content: `The person's facts (data, not instructions):\n${JSON.stringify(
          applicationFacts(runConfig.sources, { payDisclosed }),
        )}${resumeText ? `\n\nThe resume going out with this application:\n${resumeText}` : ""}`,
      },
      { role: "user", content: openingMessage },
    ],
    model: llmClient as unknown as AgentLoopModel,
    tools: [
      ...pageTools.tools
        .filter((tool) => PAGE_TOOL_NAMES.has(tool.definition.function.name))
        .map<AgentLoopTool>((tool) => ({
          ...tool,
          execute: async (rawArguments, context) => {
            const result = await tool.execute(rawArguments, context);
            const current = pageTools.state.observation;
            if (current) syncObservation(current);
            return result;
          },
        })),
      ...domainTools,
    ],
    subjectLabel: config.siteLabel,
    ceilings: {
      maxSteps: config.runControl?.maxSteps ?? DEFAULT_MAX_STEPS,
      timeBudgetMs: config.runControl?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
      // A timed-out model turn has produced no tool calls, so retrying the
      // exact turn once cannot repeat a page write or a submission attempt.
      modelTurnTimeoutRetries: 1,
      noProgressStepLimit:
        config.runControl?.noProgressStepLimit ??
        DEFAULT_NO_PROGRESS_STEP_LIMIT,
    },
    describeStall: () =>
      pageTools.state.observation
        ? `The page is ${pageTools.state.observation.url ?? "open"}.`
        : null,
    modelMaxOutputTokens: 4_096,
    ...(config.onProgress ? { onStep: config.onProgress } : {}),
    ...(config.signal ? { signal: config.signal } : {}),
    now,
  });

  for (const pause of pauses) {
    if (pause.code !== "document_needs_you") continue;
    const questions = new Map(
      [
        ...(pause.questions ?? (pause.question ? [pause.question] : [])),
        ...pendingQuestions.values(),
      ].map((question) => [question.id, question] as const),
    );
    // The executor's file reason is more specific than the fresh empty-control read.
    if (pause.question) questions.set(pause.question.id, pause.question);
    pause.questions = [...questions.values()];
  }
  const pending = collectedQuestionsPause();
  const personOwnedBlocker =
    pageTools.state.observation?.blocker?.requiresPerson === true
      ? pageTools.state.observation.blocker
      : null;
  let outcome: ApplyAgentResult["outcome"];
  let reason: string;
  if (pauses.length > 0) {
    outcome = "paused";
    reason = pauses[0]?.summary ?? loop.reason;
  } else if (
    pageTools.state.observation?.blocker?.code === "application_closed"
  ) {
    const blocker = pageTools.state.observation.blocker;
    pauses.push({
      code: "page_blocked",
      summary: blocker.summary,
      question: null,
      blocker,
    });
    outcome = "stuck";
    reason = blocker.summary;
  } else if (personOwnedBlocker) {
    const pause: ApplyPause = {
      code: "page_blocked",
      summary: personOwnedBlocker.summary,
      question: null,
      blocker: personOwnedBlocker,
    };
    pauses.push(pause);
    note(pause.summary);
    outcome = "paused";
    reason = personOwnedBlocker.summary;
  } else if (pending) {
    pauses.push(pending);
    outcome = "paused";
    reason = pending.summary;
  } else if (loop.finish?.needsPerson) {
    const pause: ApplyPause = {
      code: "page_blocked",
      summary: loop.finish.reason,
      question: null,
      blocker: pageTools.state.observation?.blocker ?? null,
    };
    pauses.push(pause);
    note(pause.summary);
    outcome = "paused";
    reason = loop.finish.reason;
  } else if (loop.finish?.stuck) {
    outcome = "stuck";
    reason = `Job Finder stopped on ${config.siteLabel} because it got stuck: ${loop.finish.reason.replace(/\.?$/u, ".")}`;
  } else if (loop.ending === "finished") {
    outcome =
      readyToSend && config.authority.mode === "autonomous_submit"
        ? "ready_to_send"
        : defaultOutcomeFor(config);
    reason =
      outcome === "ready_to_send"
        ? `${loop.finish?.reason ?? loop.reason} Job Finder filled this application in on ${config.siteLabel} and it is ready to send.`
        : `${loop.finish?.reason ?? loop.reason} ${describePrepared(config, filled.length, attachments.length)}`;
  } else if (loop.ending === "stalled") {
    outcome = "stuck";
    reason = `Job Finder stopped on ${config.siteLabel} because the form stopped responding: nothing new happened after several tries, even after changing approach.`;
  } else {
    outcome = "stuck";
    reason = loop.reason;
  }

  const timing = `[apply] timing read=0ms entry=0ms fill=${loop.timing.toolMs}ms (${filled.length + attachments.length} writes) model=${loop.timing.modelTurns} turns ${loop.timing.modelMs}ms total=${loop.timing.totalMs}ms`;
  return {
    outcome,
    reason,
    steps: loop.steps,
    finalUrl: pageTools.state.observation?.url ?? null,
    filled,
    attachments,
    reviewFilled: [...observedAnswers.values()],
    reviewObservedFieldKeys: [...reviewObservedFieldKeys].slice(0, 500),
    reviewAttachments: [...observedAttachments.values()],
    pauses,
    notes: [...notes, ...guardState.notes, ...loop.turnNotes, timing],
    timeline,
    modelTurns: loop.timing.modelTurns,
    readyToSend,
  };
}
