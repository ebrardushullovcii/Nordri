import {
  CandidateProfileSchema,
  ResumeDocumentBundleSchema,
  ResumeImportFieldCandidateSchema,
  ResumeImportRunSchema,
  type AiProviderKind,
  type CandidateProfile,
  type JobSearchPreferences,
  type ResumeDocumentBundle,
  type ResumeImportFieldCandidate,
  type ResumeImportBranchStatus,
  type ResumeImportModelRoleState,
  type ResumeImportStageFallbackKind,
  type ResumeImportTextStage,
  type ResumeImportTextStageTiming,
  type ResumeImportRun,
  type ResumeImportVisionArtifact,
} from "@unemployed/contracts";

import type { WorkspaceServiceContext } from "./workspace-service-context";
export { applyResolvedResumeImportCandidatesToWorkspace } from "./resume-import-apply";
export {
  countResumeImportCandidates,
  hasBlockingResumeImportCandidates,
  summarizeCandidateWarnings,
} from "./resume-import-candidate-utils";
import { applyResolvedResumeImportCandidatesToWorkspace } from "./resume-import-apply";
import {
  countResumeImportCandidates,
  hasBlockingResumeImportCandidates,
  RESUME_IMPORT_STAGES,
  summarizeCandidateWarnings,
  toCandidate,
} from "./resume-import-candidate-utils";
import { resolveResumeIdentity } from "./resume-identity";
import { extractLiteralCandidates } from "./resume-import-literal-extraction";
import { enrichExperienceCandidatesFromNearbyMarkers } from "./resume-import-experience-markers";
import {
  NO_AI_PROVIDER_REASON,
  ResumeImportStageExtractionResultSchema,
  ResumeVisionExtractionResultSchema,
  type ResumeImportExtractionStage,
  type ResumeImportStageExtractionResult,
  type ResumeVisionExtractionResult,
} from "@unemployed/ai-providers";
import {
  normalizeSharedMemoryCandidates,
  promoteGroundedSharedMemoryCandidates,
  reconcileCandidates,
} from "./resume-import-reconciliation";
import { createUniqueId, uniqueStrings } from "./shared";
import { deriveResumeTimelineRepairProposals } from "./resume-timeline-repair";
import {
  buildResumeAnalysisCacheIdentity,
  cloneCachedResumeAnalysisArtifacts,
  findCompatibleResumeAnalysisCacheEntry,
} from "./resume-analysis-cache";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInlineText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/**
 * A resume import that loses its optimistic-revision race is not a failed
 * import: extraction and reconciliation already succeeded. "failed" stays
 * reserved for extraction/parse failures. When a newer profile edit wins the
 * race, the current profile is kept and every candidate that would have been
 * applied automatically is instead held for the user's review.
 */
export const RESUME_IMPORT_SUPERSEDED_MESSAGE =
  "Your profile changed while this resume import was finishing. Your edits were kept, and the imported details are waiting for your review instead of being applied automatically.";
/**
 * The deferred visual-scan stage finalizes after the text stage already
 * applied its fields. Losing that later race must never rewrite the applied
 * run as failed; it only means the visual refinements were not applied.
 */
export const RESUME_IMPORT_VISION_SUPERSEDED_MESSAGE =
  "Your profile changed while the visual resume scan was finishing. The imported text details stayed applied; visual-scan refinements were not applied automatically.";
const RESUME_IMPORT_HELD_FOR_REVIEW_REASON = "profile_changed_before_apply";

/**
 * A degraded extraction stage still returns usable fields, so nothing downstream
 * can tell that the configured model was never consulted. These sentences are
 * the user-facing record of that, and every one of them starts with the shared
 * marker below so a renderer can find them without re-deriving the wording.
 */
export const RESUME_IMPORT_STAGE_FALLBACK_MESSAGE_PREFIX =
  "Job Finder could not use the AI model for";

const RESUME_IMPORT_STAGE_FALLBACK_SUBJECTS: Record<
  ResumeImportTextStage,
  string
> = {
  identity_summary: "your name, contact details, and summary",
  experience: "your work history",
  background: "your skills, education, and projects",
  // `shared_memory` is deterministic by design and never has a model call to
  // lose, so it can never reach this table in practice.
  shared_memory: "the shared resume context",
};

function describeResumeImportFallbackCause(input: {
  kind: ResumeImportStageFallbackKind;
  reason?: string | null;
}): string {
  if (input.reason === NO_AI_PROVIDER_REASON) {
    return "no AI model is available right now";
  }
  return input.kind === "timeout"
    ? "the model did not answer in time"
    : "the model call failed";
}

export function describeResumeImportStageFallback(input: {
  stage: ResumeImportTextStage;
  kind: ResumeImportStageFallbackKind;
  reason?: string | null;
}): string {
  const cause = describeResumeImportFallbackCause(input);

  return `${RESUME_IMPORT_STAGE_FALLBACK_MESSAGE_PREFIX} ${RESUME_IMPORT_STAGE_FALLBACK_SUBJECTS[input.stage]} because ${cause}. It filled that part with its built-in text reader instead, so check those details before you rely on them, or import the file again to retry.`;
}

/**
 * When every model stage fell back, one sentence says so. Three sentences
 * that differed only in which part of the resume they named read as three
 * separate problems.
 */
export function describeWholeResumeImportFallback(input: {
  kind: ResumeImportStageFallbackKind;
  reason?: string | null;
}): string {
  const cause = describeResumeImportFallbackCause(input);
  return `${RESUME_IMPORT_STAGE_FALLBACK_MESSAGE_PREFIX} this import because ${cause}. It filled in your profile with its built-in text reader instead, so check the details before you rely on them, or import the file again later to retry.`;
}

function holdResumeImportCandidatesForReview(
  candidates: readonly ResumeImportFieldCandidate[],
): ResumeImportFieldCandidate[] {
  return candidates.map((candidate) =>
    candidate.resolution === "auto_applied"
      ? ResumeImportFieldCandidateSchema.parse({
          ...candidate,
          resolution: "needs_review",
          resolutionReason: RESUME_IMPORT_HELD_FOR_REVIEW_REASON,
          resolvedAt: null,
        })
      : candidate,
  );
}

function isSameStoredResumeDocument(
  left: CandidateProfile["baseResume"],
  right: CandidateProfile["baseResume"],
): boolean {
  return (
    left.id === right.id &&
    left.storagePath === right.storagePath &&
    (left.sha256 ?? null) === (right.sha256 ?? null) &&
    left.textContent === right.textContent
  );
}

/**
 * The stored resume this run is replacing, read once before any stage runs.
 * It is `null` when the persisted profile already moved past the revision the
 * caller captured, because then this run cannot prove which resume it
 * supersedes and must not replace whatever is there now.
 */
async function readSupersededBaseResume(
  ctx: WorkspaceServiceContext,
  expectedProfileRevision: number,
): Promise<CandidateProfile["baseResume"] | null> {
  const current = await ctx.repository.getProfileWithRevision();
  return current.revision === expectedProfileRevision
    ? current.profile.baseResume
    : null;
}

/**
 * A foreground import that loses the revision race writes nothing, but by then
 * the chosen resume file has already been copied into the workspace and the
 * run plus every held review item are keyed to that new resume id. Leaving the
 * profile on the previous resume produces an orphaned file, a run whose bundle
 * can no longer be looked up by `profile.baseResume.id`, and review items that
 * would apply one person's details on top of another person's resume text.
 *
 * Attaching the copied file is therefore worth doing, but it is still a write
 * to the exact field the compare-and-swap protects, so it is allowed only when
 * it cannot take anything away:
 *  - the persisted resume must still be the one this run superseded, so a
 *    second import that already landed keeps the file the user picked last and
 *    an unrelated writer's resume edit is never rolled back; and
 *  - the resulting profile must stay identity-coherent, because writing an
 *    imported header that contradicts the visible identity hard-blocks resume
 *    generation, preview, export and approval with no way out.
 * When either check declines, the run simply stays superseded and its details
 * wait in review, which is the behaviour that predates the attach.
 */
async function attachImportedBaseResumeAfterStaleFinalization(input: {
  ctx: WorkspaceServiceContext;
  currentProfile: CandidateProfile;
  currentRevision: number;
  supersededBaseResume: CandidateProfile["baseResume"] | null;
  importedBaseResume: CandidateProfile["baseResume"];
}): Promise<{ profile: CandidateProfile; revision: number } | null> {
  const current = input.currentProfile.baseResume;
  const imported = input.importedBaseResume;
  const superseded = input.supersededBaseResume;

  if (!superseded || isSameStoredResumeDocument(current, imported)) {
    return null;
  }

  if (!isSameStoredResumeDocument(current, superseded)) {
    return null;
  }

  const attachedProfile = CandidateProfileSchema.parse({
    ...input.currentProfile,
    baseResume: imported,
  });
  if (resolveResumeIdentity(attachedProfile).mismatchReasons.length > 0) {
    return null;
  }

  const commit = await input.ctx.repository.commitProfileUpdate(
    (profile) =>
      CandidateProfileSchema.parse({
        ...profile,
        baseResume: imported,
      }),
    { expectedRevision: input.currentRevision },
  );

  return commit.status === "applied"
    ? { profile: commit.profile, revision: commit.revision }
    : null;
}

async function finalizeResumeImportRunAtRevision(input: {
  ctx: WorkspaceServiceContext;
  expectedProfileRevision: number;
  profile: CandidateProfile;
  searchPreferences: JobSearchPreferences;
  run: ResumeImportRun;
  documentBundles: readonly ResumeDocumentBundle[];
  fieldCandidates: readonly ResumeImportFieldCandidate[];
  /**
   * The stored resume this run replaces, captured before the run started. Only
   * the `hold_for_review` stale path uses it, to decide whether attaching the
   * copied import file would take away a newer writer's resume.
   */
  supersededBaseResume?: CandidateProfile["baseResume"] | null;
  /**
   * `hold_for_review` (default) persists the run as review-ready with every
   * would-be-applied candidate downgraded to needs-review. `report_only`
   * writes nothing on a stale outcome so the caller can retry against the
   * current revision or fall back to already-applied state.
   */
  staleMode?: "hold_for_review" | "report_only";
}): Promise<{
  status: "applied" | "stale";
  profile: CandidateProfile;
  searchPreferences: JobSearchPreferences;
  revision: number;
  run: ResumeImportRun;
  candidates: ResumeImportFieldCandidate[];
}> {
  const outcome = await input.ctx.repository.finalizeResumeImportRun({
    profile: input.profile,
    searchPreferences: input.searchPreferences,
    run: input.run,
    documentBundles: input.documentBundles,
    fieldCandidates: input.fieldCandidates,
    expectedProfileRevision: input.expectedProfileRevision,
  });

  if (outcome.status === "applied") {
    return {
      ...outcome,
      run: input.run,
      candidates: [...input.fieldCandidates],
    };
  }

  if (input.staleMode === "report_only") {
    return {
      ...outcome,
      run: input.run,
      candidates: [...input.fieldCandidates],
    };
  }

  const heldCandidates = holdResumeImportCandidatesForReview(
    input.fieldCandidates,
  );
  const supersededRun = ResumeImportRunSchema.parse({
    ...input.run,
    status: hasBlockingResumeImportCandidates(heldCandidates)
      ? "review_ready"
      : "applied",
    completedAt: new Date().toISOString(),
    warnings: uniqueStrings([
      ...input.run.warnings,
      RESUME_IMPORT_SUPERSEDED_MESSAGE,
    ]),
    errorMessage: null,
    candidateCounts: countResumeImportCandidates(heldCandidates),
  });
  await input.ctx.repository.replaceResumeImportRunArtifacts({
    run: supersededRun,
    documentBundles: input.documentBundles,
    fieldCandidates: heldCandidates,
  });
  const attachedResume = await attachImportedBaseResumeAfterStaleFinalization({
    ctx: input.ctx,
    currentProfile: outcome.profile,
    currentRevision: outcome.revision,
    supersededBaseResume: input.supersededBaseResume ?? null,
    importedBaseResume: input.profile.baseResume,
  });

  return {
    ...outcome,
    profile: attachedResume?.profile ?? outcome.profile,
    revision: attachedResume?.revision ?? outcome.revision,
    run: supersededRun,
    candidates: heldCandidates,
  };
}

function promoteEducationScalarCandidates(
  candidates: readonly ResumeImportFieldCandidate[],
): ResumeImportFieldCandidate[] {
  const promoted: ResumeImportFieldCandidate[] = [];
  const scalarEducationCandidates = candidates.filter(
    (candidate) =>
      candidate.target.section === "education" &&
      candidate.target.key !== "record" &&
      !isObjectRecord(candidate.value),
  );

  for (const candidate of candidates) {
    if (
      candidate.target.section !== "education" ||
      candidate.target.key !== "record" ||
      typeof candidate.value !== "string"
    ) {
      promoted.push(candidate);
      continue;
    }

    const text = normalizeInlineText(candidate.value);
    const relatedScalars = scalarEducationCandidates.filter(
      (entry) =>
        normalizeInlineText(entry.value) &&
        text.includes(normalizeInlineText(entry.value)),
    );
    const schoolScalar = relatedScalars.find(
      (entry) =>
        /institution|school|university|college/i.test(entry.label) ||
        entry.target.key === "institution",
    );
    const degreeScalar = relatedScalars.find((entry) =>
      /degree|bachelor|master|phd/i.test(entry.label),
    );
    const startScalar = relatedScalars.find((entry) =>
      /start/i.test(entry.label),
    );
    const endScalar = relatedScalars.find((entry) =>
      /graduation|end/i.test(entry.label),
    );
    const dateRange = text.match(
      /((?:[A-Za-z]{3,9}\s+)?\d{4})\s*[–—-]\s*((?:[A-Za-z]{3,9}\s+)?\d{4}|present|current)/i,
    );
    const schoolName = normalizeInlineText(schoolScalar?.value) || null;
    let degree = normalizeInlineText(degreeScalar?.value) || null;
    let fieldOfStudy: string | null = null;

    if (degree) {
      const degreeWithField = degree.match(
        /^(.*?(?:degree|bachelor|master|phd)(?:\s*\([^)]*\))?)(?:\s+in\s+|,\s+)(.+)$/i,
      );
      if (degreeWithField) {
        degree = normalizeInlineText(degreeWithField[1]);
        fieldOfStudy = normalizeInlineText(degreeWithField[2]) || null;
      }
    }

    if (!schoolName || !degree) {
      promoted.push(candidate);
      continue;
    }

    promoted.push({
      ...candidate,
      value: {
        schoolName,
        degree,
        fieldOfStudy,
        location: null,
        startDate:
          normalizeInlineText(startScalar?.value) || dateRange?.[1] || null,
        endDate:
          normalizeInlineText(endScalar?.value) || dateRange?.[2] || null,
        summary: null,
      },
      normalizedValue: null,
      valuePreview: null,
      notes: uniqueStrings([
        ...candidate.notes,
        "education_scalar_record_promoted",
      ]),
    });
  }

  return promoted;
}

type ResumeImportTrigger = ResumeImportRun["trigger"];

type ResumeImportBranchResult =
  | {
      ok: true;
      literalCandidates: ResumeImportFieldCandidate[];
      stageCandidates: ResumeImportFieldCandidate[];
      providerKind: Extract<
        AiProviderKind,
        "deterministic" | "openai_compatible"
      > | null;
      providerLabel: string | null;
      notes: string[];
      warnings: string[];
    }
  | {
      ok: false;
      message: string;
    };

type ResumeImportStageExtractionOutcome =
  | {
      ok: true;
      stage: ResumeImportExtractionStage;
      result: ResumeImportStageExtractionResult;
    }
  | {
      ok: false;
      stage: ResumeImportExtractionStage;
      message: string;
      diagnostic: string;
    };

type ResumeVisionBranchResult =
  | {
      ok: true;
      result: ResumeVisionExtractionResult;
    }
  | {
      ok: false;
      skipped?: true;
      message: string;
    };

type ResumeVisionBranchDeferredResult = {
  ok: false;
  deferred: true;
  message: string;
};

type ResumeVisionBranchResolution =
  | ResumeVisionBranchResult
  | ResumeVisionBranchDeferredResult;

type PromiseSnapshot<T> =
  | {
      settled: false;
    }
  | {
      settled: true;
      value: T;
    };

function observePromise<T>(promise: Promise<T>): {
  promise: Promise<T>;
  getSnapshot: () => PromiseSnapshot<T>;
} {
  let snapshot: PromiseSnapshot<T> = { settled: false };
  const observedPromise = promise.then((value) => {
    snapshot = { settled: true, value };
    return value;
  });

  return {
    promise: observedPromise,
    getSnapshot: () => snapshot,
  };
}

function isTimeoutLikeMessage(message: string): boolean {
  return /timed out|timeout|aborted/i.test(message);
}

function branchStatusForFailure(message: string): "failed" | "timed_out" {
  return isTimeoutLikeMessage(message) ? "timed_out" : "failed";
}

function messageFromUnknownError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resumeImportStageFailureOutcome(
  stage: ResumeImportExtractionStage,
  error: unknown,
): Extract<ResumeImportStageExtractionOutcome, { ok: false }> {
  const message = messageFromUnknownError(
    error,
    "The extraction provider rejected the stage without an error message.",
  );

  return {
    ok: false,
    stage,
    message,
    diagnostic: `Resume import ${stage} stage failed; other text stages continued. ${message}`,
  };
}

function visionTimeoutMsFor(ctx: WorkspaceServiceContext): number {
  const timeoutMs = ctx.visionProvider?.getStatus().requestTimeoutMs;

  return typeof timeoutMs === "number" &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? timeoutMs
    : 600_000;
}

function visionBranchTimeoutMessage(timeoutMs: number): string {
  return `Vision resume import branch timed out after ${timeoutMs}ms; text import continued.`;
}

function visionBranchDeferredMessage(timeoutMs: number): string {
  const timeoutMinutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return `Visual scan is still running. Your text import is ready, and visual reconciliation will continue in the background for up to ${timeoutMinutes} minute${timeoutMinutes === 1 ? "" : "s"}.`;
}

function removeVisionDeferredWarnings(warnings: readonly string[]): string[] {
  return warnings.filter(
    (warning) =>
      !/^Visual scan is still running(?: after text import completed;|\.)/.test(
        warning,
      ),
  );
}

function createVisionTimeoutResult(
  ctx: WorkspaceServiceContext,
  message: string,
): ResumeVisionExtractionResult {
  const status = ctx.visionProvider?.getStatus();

  return ResumeVisionExtractionResultSchema.parse({
    analysisProviderKind:
      status?.kind === "openai_compatible_vision"
        ? "openai_compatible_vision"
        : "deterministic",
    analysisProviderLabel: status?.label ?? "Resume vision provider",
    candidates: [],
    notes: [],
    warnings: [message],
    primaryErrorMessage: message,
  });
}

function createTimedOutVisionResult(
  ctx: WorkspaceServiceContext,
  timeoutMs: number,
): ResumeVisionExtractionResult {
  return createVisionTimeoutResult(ctx, visionBranchTimeoutMessage(timeoutMs));
}

function withVisionBranchDeadline(
  promise: Promise<ResumeVisionBranchResult>,
  timeoutMs: number,
  ctx: WorkspaceServiceContext,
  options: { unrefTimer?: boolean } = {},
): Promise<ResumeVisionBranchResult> {
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<ResumeVisionBranchResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: true, result: createTimedOutVisionResult(ctx, timeoutMs) });
    }, timeoutMs);
    if (options.unrefTimer) {
      timer.unref?.();
    }
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function getVisionBranchWithoutBlockingTextCompletion(
  observedVisionBranch: ReturnType<
    typeof observePromise<ResumeVisionBranchResult>
  >,
  timeoutMs: number,
): Promise<ResumeVisionBranchResolution> {
  let timer: NodeJS.Timeout | null = null;
  const nextTickPromise = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ settled: false });
    }, 0);
  });

  return Promise.race([
    observedVisionBranch.promise.then((value) => ({
      settled: true as const,
      value,
    })),
    nextTickPromise,
  ])
    .then((outcome) => {
      if (outcome.settled) {
        return outcome.value;
      }

      return {
        ok: false as const,
        deferred: true as const,
        message: visionBranchDeferredMessage(timeoutMs),
      };
    })
    .finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
}

function isDeferredVisionBranch(
  visionBranch: ResumeVisionBranchResolution,
): visionBranch is ResumeVisionBranchDeferredResult {
  return !visionBranch.ok && "deferred" in visionBranch;
}

function hasExplicitUserDecision(
  candidate: ResumeImportFieldCandidate,
): boolean {
  return Boolean(
    candidate.resolvedAt &&
    candidate.resolution !== "needs_review" &&
    candidate.resolutionReason &&
    /setup_|review_/.test(candidate.resolutionReason),
  );
}

function mergeCurrentResolution(
  candidate: ResumeImportFieldCandidate,
  currentCandidate: ResumeImportFieldCandidate | undefined,
): ResumeImportFieldCandidate {
  if (!currentCandidate || !hasExplicitUserDecision(currentCandidate)) {
    return candidate;
  }

  return {
    ...candidate,
    resolution: currentCandidate.resolution,
    resolutionReason: currentCandidate.resolutionReason,
    resolvedAt: currentCandidate.resolvedAt,
    value: currentCandidate.value,
    normalizedValue: currentCandidate.normalizedValue,
    valuePreview: currentCandidate.valuePreview,
    evidenceText: currentCandidate.evidenceText,
    confidence: currentCandidate.confidence,
    notes: currentCandidate.notes,
    alternatives: currentCandidate.alternatives,
    conflictChoices: currentCandidate.conflictChoices,
    visualEvidence: currentCandidate.visualEvidence,
  };
}

function preserveCurrentCandidateDecisions(
  nextCandidates: readonly ResumeImportFieldCandidate[],
  currentCandidates: readonly ResumeImportFieldCandidate[],
): ResumeImportFieldCandidate[] {
  const currentById = new Map(
    currentCandidates.map((candidate) => [candidate.id, candidate]),
  );

  return nextCandidates.map((candidate) =>
    mergeCurrentResolution(candidate, currentById.get(candidate.id)),
  );
}

async function preserveLatestCandidateDecisions(
  ctx: WorkspaceServiceContext,
  runId: string,
  candidates: readonly ResumeImportFieldCandidate[],
): Promise<ResumeImportFieldCandidate[]> {
  return preserveCurrentCandidateDecisions(
    candidates,
    await ctx.repository.listResumeImportFieldCandidates({ runId }),
  );
}

function branchStateFromVisionResolution(input: {
  current: ResumeImportModelRoleState["vision"];
  visionBranch: ResumeVisionBranchResolution;
  visionTimeoutMs: number | null;
}) {
  const { current, visionBranch, visionTimeoutMs } = input;

  if (visionBranch.ok) {
    return {
      ...current,
      status: visionBranch.result.primaryErrorMessage
        ? branchStatusForFailure(visionBranch.result.primaryErrorMessage)
        : ("completed" as const),
      completedAt: new Date().toISOString(),
      providerKind: visionBranch.result.analysisProviderKind,
      providerLabel: visionBranch.result.analysisProviderLabel,
      timeoutMs: visionTimeoutMs,
      warning: visionBranch.result.warnings[0] ?? null,
      errorMessage: visionBranch.result.primaryErrorMessage,
      candidateCount: visionBranch.result.candidates.length,
    };
  }

  if (isDeferredVisionBranch(visionBranch)) {
    return {
      ...current,
      status: "running" as const,
      completedAt: null,
      providerKind: current.providerKind,
      providerLabel: current.providerLabel,
      timeoutMs: visionTimeoutMs,
      warning: visionBranch.message,
      errorMessage: null,
      candidateCount: 0,
    };
  }

  return {
    ...current,
    status:
      "skipped" in visionBranch
        ? ("skipped" as const)
        : branchStatusForFailure(visionBranch.message),
    completedAt: new Date().toISOString(),
    providerKind: null,
    providerLabel: null,
    timeoutMs: visionTimeoutMs,
    warning: visionBranch.message,
    errorMessage: "skipped" in visionBranch ? null : visionBranch.message,
    candidateCount: 0,
  };
}

async function completeDeferredVisionBranch(input: {
  ctx: WorkspaceServiceContext;
  promise: Promise<ResumeVisionBranchResult>;
  bundle: ResumeDocumentBundle;
  run: ResumeImportRun;
  runId: string;
  now: string;
  textCandidates: readonly ResumeImportFieldCandidate[];
  visionTimeoutMs: number;
}): Promise<void> {
  const { ctx, promise, bundle, runId, now, textCandidates, visionTimeoutMs } =
    input;
  // The text stage already finalized this run as applied/review-ready. Keep
  // that persisted truth as the fallback if the visual refinements cannot be
  // applied; the run must never regress to "failed" because of a lost race.
  const appliedTextStageRun = input.run;
  let run = input.run;

  try {
    const visionBranch = await withVisionBranchDeadline(
      promise,
      visionTimeoutMs,
      ctx,
      {
        unrefTimer: true,
      },
    );
    const currentCandidates =
      await ctx.repository.listResumeImportFieldCandidates({ runId });
    // Read the profile together with its current revision: the text stage
    // finalized against an older epoch, and any ordinary profile write since
    // then (setup save, review confirmation, copilot apply) advanced it. The
    // visual scan merges onto this latest profile, so its compare-and-swap
    // must target this revision, not the one the text stage produced.
    const latestProfileState = await ctx.repository.getProfileWithRevision();
    let latestProfile = CandidateProfileSchema.parse(
      latestProfileState.profile,
    );
    let latestProfileRevision = latestProfileState.revision;
    let latestSearchPreferences = await ctx.repository.getSearchPreferences();
    const currentTextCandidates = currentCandidates.filter(
      (candidate) =>
        candidate.sourceKind !== "vision_omni" &&
        candidate.sourceKind !== "adjudicator",
    );
    const preservedTextCandidates =
      currentTextCandidates.length > 0
        ? currentTextCandidates
        : [...textCandidates];
    const visionCandidates = visionBranch.ok
      ? visionBranch.result.candidates.map((candidate, index) =>
          toCandidate(
            bundle,
            runId,
            "vision_omni",
            now,
            candidate,
            10_000 + index,
          ),
        )
      : [];
    const provisionalCandidates = promoteEducationScalarCandidates(
      normalizeSharedMemoryCandidates(
        enrichExperienceCandidatesFromNearbyMarkers(bundle, [
          ...preservedTextCandidates,
          ...visionCandidates,
        ]),
      ),
    );
    // The text stage already settled this run. The visual scan's progress
    // lives on `modelRoles.vision`; the run keeps its settled status so a
    // snapshot read meanwhile never mistakes it for a text import that was
    // cut off.
    run = ResumeImportRunSchema.parse({
      ...run,
      status: appliedTextStageRun.status,
      visionProviderKind: visionBranch.ok
        ? visionBranch.result.analysisProviderKind
        : (run.visionProviderKind ?? null),
      visionProviderLabel: visionBranch.ok
        ? visionBranch.result.analysisProviderLabel
        : (run.visionProviderLabel ?? null),
      modelRoles: {
        ...modelRolesFor(run),
        vision: branchStateFromVisionResolution({
          current: modelRolesFor(run).vision,
          visionBranch,
          visionTimeoutMs,
        }),
      },
    });

    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: provisionalCandidates,
    });

    let reconciledCandidates = preserveCurrentCandidateDecisions(
      promoteGroundedSharedMemoryCandidates(
        reconcileCandidates(
          latestProfile,
          latestSearchPreferences,
          provisionalCandidates,
        ),
      ),
      currentCandidates,
    );
    const adjudicationStartedAt = new Date().toISOString();
    run = ResumeImportRunSchema.parse({
      ...run,
      status: appliedTextStageRun.status,
      modelRoles: {
        ...modelRolesFor(run),
        adjudication: {
          ...modelRolesFor(run).adjudication,
          status: hasReviewableTextVisionConflict(reconciledCandidates)
            ? "running"
            : "skipped",
          startedAt: hasReviewableTextVisionConflict(reconciledCandidates)
            ? adjudicationStartedAt
            : modelRolesFor(run).adjudication.startedAt,
        },
      },
    });
    reconciledCandidates = await preserveLatestCandidateDecisions(
      ctx,
      runId,
      reconciledCandidates,
    );
    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: reconciledCandidates,
    });

    const adjudicationResult = await maybeAdjudicateResumeImportCandidates(
      ctx,
      {
        profile: latestProfile,
        searchPreferences: latestSearchPreferences,
        bundle,
        runId,
        now,
        candidates: reconciledCandidates,
      },
    );
    reconciledCandidates = preserveCurrentCandidateDecisions(
      promoteGroundedSharedMemoryCandidates(
        reconcileCandidates(
          latestProfile,
          latestSearchPreferences,
          adjudicationResult.candidates,
        ),
      ),
      currentCandidates,
    );

    reconciledCandidates = await preserveLatestCandidateDecisions(
      ctx,
      runId,
      reconciledCandidates,
    );

    const visionBranchNotes = visionBranch.ok
      ? [...visionBranch.result.notes, ...visionBranch.result.warnings]
      : "skipped" in visionBranch
        ? []
        : [visionBranch.message];
    const stageNotes = uniqueStrings([
      ...removeVisionDeferredWarnings(run.warnings),
      ...visionBranchNotes,
      ...adjudicationResult.notes,
      ...adjudicationResult.warnings,
      ...summarizeCandidateWarnings(reconciledCandidates),
    ]);
    const hasBlockingReviewCandidates =
      hasBlockingResumeImportCandidates(reconciledCandidates);

    run = ResumeImportRunSchema.parse({
      ...run,
      status: hasBlockingReviewCandidates ? "review_ready" : "applied",
      completedAt: new Date().toISOString(),
      warnings: stageNotes,
      candidateCounts: countResumeImportCandidates(reconciledCandidates),
      modelRoles: {
        ...modelRolesFor(run),
        adjudication: {
          ...modelRolesFor(run).adjudication,
          status: adjudicationResult.status,
          completedAt: new Date().toISOString(),
          providerKind: adjudicationResult.providerKind,
          providerLabel: adjudicationResult.providerLabel,
          warning: adjudicationResult.warnings[0] ?? null,
          errorMessage: adjudicationResult.errorMessage,
          candidateCount: reconciledCandidates.filter(
            (candidate) => candidate.sourceKind === "adjudicator",
          ).length,
        },
      },
    });

    const finalizeVisionStage = (
      candidates: readonly ResumeImportFieldCandidate[],
    ) => {
      const merged = applyResolvedResumeImportCandidatesToWorkspace({
        profile: latestProfile,
        searchPreferences: latestSearchPreferences,
        candidates,
        analysisProviderKind: run.analysisProviderKind,
        analysisProviderLabel: run.analysisProviderLabel,
        analysisWarnings: stageNotes,
      });
      return finalizeResumeImportRunAtRevision({
        ctx,
        expectedProfileRevision: latestProfileRevision,
        profile: merged.profile,
        searchPreferences: merged.searchPreferences,
        run,
        documentBundles: [bundle],
        fieldCandidates: candidates,
        staleMode: "report_only",
      });
    };

    let finalization = await finalizeVisionStage(reconciledCandidates);

    if (finalization.status === "stale") {
      // One bounded retry: a profile write landed during reconciliation.
      // Re-read the current profile, re-reconcile the already adjudicated
      // candidates against it (no further model calls), and try once more.
      const retryProfileState = await ctx.repository.getProfileWithRevision();
      latestProfile = CandidateProfileSchema.parse(retryProfileState.profile);
      latestProfileRevision = retryProfileState.revision;
      latestSearchPreferences = await ctx.repository.getSearchPreferences();
      reconciledCandidates = await preserveLatestCandidateDecisions(
        ctx,
        runId,
        preserveCurrentCandidateDecisions(
          promoteGroundedSharedMemoryCandidates(
            reconcileCandidates(
              latestProfile,
              latestSearchPreferences,
              adjudicationResult.candidates,
            ),
          ),
          currentCandidates,
        ),
      );
      finalization = await finalizeVisionStage(reconciledCandidates);
    }

    if (finalization.status === "stale") {
      // A genuine concurrent edit won twice. Restore the text stage's applied
      // truth and its candidates, record why the visual refinements were not
      // applied, and leave the user's edits untouched.
      const supersededRun = ResumeImportRunSchema.parse({
        ...appliedTextStageRun,
        warnings: uniqueStrings([
          ...removeVisionDeferredWarnings(appliedTextStageRun.warnings),
          RESUME_IMPORT_VISION_SUPERSEDED_MESSAGE,
        ]),
        errorMessage: null,
        modelRoles: {
          ...modelRolesFor(run),
          vision: {
            ...modelRolesFor(run).vision,
            status: "skipped",
            completedAt: new Date().toISOString(),
            warning: RESUME_IMPORT_VISION_SUPERSEDED_MESSAGE,
            errorMessage: null,
            candidateCount: 0,
          },
          adjudication: modelRolesFor(appliedTextStageRun).adjudication,
        },
      });
      await ctx.repository.replaceResumeImportRunArtifacts({
        run: supersededRun,
        documentBundles: [bundle],
        fieldCandidates: currentCandidates,
      });
    }
  } catch (error) {
    const message = messageFromUnknownError(
      error,
      "Deferred resume vision branch failed.",
    );
    const failedRun = ResumeImportRunSchema.parse({
      ...run,
      // A failed visual scan never takes back what the text stage applied.
      status: appliedTextStageRun.status,
      completedAt: appliedTextStageRun.completedAt,
      modelRoles: {
        ...modelRolesFor(run),
        vision: {
          ...modelRolesFor(run).vision,
          status: branchStatusForFailure(message),
          completedAt: new Date().toISOString(),
          timeoutMs: visionTimeoutMs,
          errorMessage: message,
          warning: message,
        },
      },
      warnings: uniqueStrings([...run.warnings, message]),
    });
    const currentCandidates =
      await ctx.repository.listResumeImportFieldCandidates({ runId });
    await ctx.repository.replaceResumeImportRunArtifacts({
      run: failedRun,
      documentBundles: [bundle],
      fieldCandidates: currentCandidates,
    });
  }
}

function scheduleDeferredVisionBranchCompletion(
  input: Parameters<typeof completeDeferredVisionBranch>[0],
): void {
  input.ctx.activeResumeVisionRunIds.add(input.runId);
  void completeDeferredVisionBranch(input)
    .catch((error: unknown) => {
      console.error("Deferred resume vision branch completion failed.", error);
    })
    .finally(() => {
      input.ctx.activeResumeVisionRunIds.delete(input.runId);
    });
}

function modelRolesFor(run: ResumeImportRun): ResumeImportModelRoleState {
  return (
    run.modelRoles ?? {
      text: {
        status: "not_started",
        startedAt: null,
        completedAt: null,
        providerKind: null,
        providerLabel: null,
        warning: null,
        errorMessage: null,
        timeoutMs: null,
        candidateCount: 0,
      },
      vision: {
        status: "not_started",
        startedAt: null,
        completedAt: null,
        providerKind: null,
        providerLabel: null,
        warning: null,
        errorMessage: null,
        timeoutMs: null,
        candidateCount: 0,
      },
      adjudication: {
        status: "not_started",
        startedAt: null,
        completedAt: null,
        providerKind: null,
        providerLabel: null,
        warning: null,
        errorMessage: null,
        timeoutMs: null,
        candidateCount: 0,
      },
    }
  );
}

function hasReviewableTextVisionConflict(
  candidates: readonly ResumeImportFieldCandidate[],
): boolean {
  return candidates.some(
    (candidate) =>
      candidate.resolution === "needs_review" &&
      (candidate.conflictChoices ?? []).some(
        (choice) => choice.sourceLabel === "Document text",
      ) &&
      (candidate.conflictChoices ?? []).some(
        (choice) => choice.sourceLabel === "Visual scan",
      ),
  );
}

async function maybeAdjudicateResumeImportCandidates(
  ctx: WorkspaceServiceContext,
  input: {
    profile: CandidateProfile;
    searchPreferences: JobSearchPreferences;
    bundle: ResumeDocumentBundle;
    runId: string;
    now: string;
    candidates: readonly ResumeImportFieldCandidate[];
  },
): Promise<{
  candidates: ResumeImportFieldCandidate[];
  notes: string[];
  warnings: string[];
  status: ResumeImportBranchStatus;
  providerKind: AiProviderKind | null;
  providerLabel: string | null;
  errorMessage: string | null;
}> {
  if (!hasReviewableTextVisionConflict(input.candidates)) {
    return {
      candidates: [...input.candidates],
      notes: [],
      warnings: [],
      status: "skipped",
      providerKind: null,
      providerLabel: null,
      errorMessage: null,
    };
  }

  if (!ctx.aiClient.adjudicateResumeImportCandidates) {
    return {
      candidates: [...input.candidates],
      notes: [
        "Material text-vs-visual import conflicts were routed to setup review because no Pro adjudication adapter is configured.",
      ],
      warnings: [],
      status: "skipped",
      providerKind: null,
      providerLabel: null,
      errorMessage: null,
    };
  }

  try {
    const result = await ctx.aiClient.adjudicateResumeImportCandidates({
      existingProfile: input.profile,
      existingSearchPreferences: input.searchPreferences,
      documentBundle: input.bundle,
      candidates: input.candidates,
    });
    const adjudicatedCandidates = result.candidates.map((candidate, index) =>
      toCandidate(
        input.bundle,
        input.runId,
        "adjudicator",
        input.now,
        candidate,
        20_000 + index,
      ),
    );

    return {
      candidates: [...input.candidates, ...adjudicatedCandidates],
      notes: result.notes,
      warnings: result.warnings,
      status: "completed",
      providerKind: ctx.aiClient.getStatus().kind,
      providerLabel: ctx.aiClient.getStatus().label,
      errorMessage: null,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Resume import adjudication failed.";
    return {
      candidates: [...input.candidates],
      notes: [
        "Material text-vs-visual import conflicts stayed in setup review after adjudication failed.",
      ],
      warnings: [message],
      status: branchStatusForFailure(message),
      providerKind: ctx.aiClient.getStatus().kind,
      providerLabel: ctx.aiClient.getStatus().label,
      errorMessage: message,
    };
  }
}

type ResumeImportWorkflowInput = {
  profile: CandidateProfile;
  searchPreferences: JobSearchPreferences;
  documentBundle: ResumeDocumentBundle;
  trigger: ResumeImportTrigger;
  expectedProfileRevision: number;
  importWarnings?: readonly string[];
  visionArtifact?: ResumeImportVisionArtifact | null;
};

type ResumeImportWorkflowResult = {
  profile: CandidateProfile;
  searchPreferences: JobSearchPreferences;
  run: ResumeImportRun;
  candidates: ResumeImportFieldCandidate[];
};

/**
 * Imports running in this process, per workspace repository. A run that is
 * still marked in progress while none is running here was cut off by the app
 * closing; recovery can then say so instead of reporting "importing" forever.
 */
const activeResumeImportCounts = new WeakMap<object, number>();

export function isResumeImportActiveInProcess(
  ctx: Pick<WorkspaceServiceContext, "repository">,
): boolean {
  return (activeResumeImportCounts.get(ctx.repository) ?? 0) > 0;
}

export async function runResumeImportWorkflow(
  ctx: WorkspaceServiceContext,
  input: ResumeImportWorkflowInput,
): Promise<ResumeImportWorkflowResult> {
  const key = ctx.repository;
  activeResumeImportCounts.set(
    key,
    (activeResumeImportCounts.get(key) ?? 0) + 1,
  );
  try {
    return await runResumeImportWorkflowInProcess(ctx, input);
  } finally {
    const remaining = (activeResumeImportCounts.get(key) ?? 1) - 1;
    if (remaining > 0) {
      activeResumeImportCounts.set(key, remaining);
    } else {
      activeResumeImportCounts.delete(key);
    }
  }
}

async function runResumeImportWorkflowInProcess(
  ctx: WorkspaceServiceContext,
  input: ResumeImportWorkflowInput,
): Promise<ResumeImportWorkflowResult> {
  const expectedProfileRevision = input.expectedProfileRevision;
  const workflowStartedAtMs = performance.now();
  const supersededBaseResume = await readSupersededBaseResume(
    ctx,
    expectedProfileRevision,
  );
  let literalExtractionMs = 0;
  let textBranchMs = 0;
  let textStageTimings: ResumeImportTextStageTiming[] = [];
  const now = new Date().toISOString();
  const runId = createUniqueId("resume_import_run");
  const bundle = ResumeDocumentBundleSchema.parse({
    ...input.documentBundle,
    id: createUniqueId("resume_bundle"),
    runId,
    sourceResumeId: input.profile.baseResume.id,
  });
  // Import paths hash the newly copied app-owned bytes before entering this
  // workflow. Refresh paths do not reread the file, so they deliberately bypass
  // the cache rather than trusting a possibly stale persisted digest.
  const analysisCacheIdentity =
    input.trigger === "import"
      ? buildResumeAnalysisCacheIdentity({
          profile: input.profile,
          searchPreferences: input.searchPreferences,
          documentBundle: bundle,
          visionArtifact: input.visionArtifact,
          textProviderStatus: ctx.aiClient.getStatus(),
          visionProviderStatus:
            input.visionArtifact && ctx.visionProvider
              ? ctx.visionProvider.getStatus()
              : null,
        })
      : null;
  const cachedAnalysis = await findCompatibleResumeAnalysisCacheEntry(
    ctx,
    analysisCacheIdentity,
  );

  if (cachedAnalysis) {
    const cachedArtifacts = cloneCachedResumeAnalysisArtifacts({
      entry: cachedAnalysis,
      runId,
      sourceResumeId: input.profile.baseResume.id,
      now,
    });
    const analysisWarnings = uniqueStrings([
      ...(input.importWarnings ?? []),
      ...cachedAnalysis.run.warnings,
    ]);
    const merged = applyResolvedResumeImportCandidatesToWorkspace({
      profile: input.profile,
      searchPreferences: input.searchPreferences,
      candidates: cachedArtifacts.candidates,
      analysisProviderKind: cachedAnalysis.run.analysisProviderKind,
      analysisProviderLabel: cachedAnalysis.run.analysisProviderLabel,
      analysisWarnings,
    });
    const candidateCounts = countResumeImportCandidates(
      cachedArtifacts.candidates,
    );
    let cachedRun = ResumeImportRunSchema.parse({
      id: runId,
      sourceResumeId: input.profile.baseResume.id,
      sourceResumeFileName: input.profile.baseResume.fileName,
      trigger: input.trigger,
      status: hasBlockingResumeImportCandidates(cachedArtifacts.candidates)
        ? "review_ready"
        : "applied",
      startedAt: now,
      completedAt: new Date().toISOString(),
      primaryParserKind: cachedArtifacts.bundle.primaryParserKind,
      parserKinds: cachedArtifacts.bundle.parserKinds,
      routeKind: cachedArtifacts.bundle.route?.routeKind ?? null,
      parserManifestVersion:
        cachedArtifacts.bundle.parserManifest?.manifestVersion ?? null,
      qualityScore: cachedArtifacts.bundle.quality?.score ?? null,
      analysisProviderKind: cachedAnalysis.run.analysisProviderKind,
      analysisProviderLabel: cachedAnalysis.run.analysisProviderLabel,
      visionProviderKind: cachedAnalysis.run.visionProviderKind ?? null,
      visionProviderLabel: cachedAnalysis.run.visionProviderLabel ?? null,
      modelRoles: cachedAnalysis.run.modelRoles,
      timing: {
        totalMs: Math.max(
          0,
          Math.round(performance.now() - workflowStartedAtMs),
        ),
        textBranchMs: 0,
        literalExtractionMs: 0,
        reconciliationMs: 0,
        finalizationMs: 0,
        textStages: [],
      },
      analysisCacheIdentity,
      analysisCacheHit: true,
      analysisCacheSourceRunId: cachedAnalysis.run.id,
      warnings: analysisWarnings,
      errorMessage: null,
      candidateCounts,
    });
    const finalization = await finalizeResumeImportRunAtRevision({
      ctx,
      expectedProfileRevision,
      profile: merged.profile,
      searchPreferences: merged.searchPreferences,
      run: cachedRun,
      documentBundles: [cachedArtifacts.bundle],
      fieldCandidates: cachedArtifacts.candidates,
      supersededBaseResume,
    });
    cachedRun = finalization.run;
    cachedRun = ResumeImportRunSchema.parse({
      ...cachedRun,
      timing: {
        ...cachedRun.timing,
        totalMs: Math.max(
          0,
          Math.round(performance.now() - workflowStartedAtMs),
        ),
      },
    });
    try {
      await ctx.repository.upsertResumeImportRun(cachedRun);
    } catch (telemetryError) {
      console.warn(
        "Resume import cache timing could not be persisted after finalization.",
        telemetryError instanceof Error
          ? telemetryError.message
          : "Unknown error",
      );
    }

    return {
      profile: finalization.profile,
      searchPreferences: finalization.searchPreferences,
      run: cachedRun,
      candidates: finalization.candidates,
    };
  }

  let run = ResumeImportRunSchema.parse({
    id: runId,
    sourceResumeId: input.profile.baseResume.id,
    sourceResumeFileName: input.profile.baseResume.fileName,
    trigger: input.trigger,
    status: "parsing",
    startedAt: now,
    completedAt: null,
    primaryParserKind: bundle.primaryParserKind,
    parserKinds: bundle.parserKinds,
    analysisProviderKind: null,
    analysisProviderLabel: null,
    visionProviderKind: null,
    visionProviderLabel: null,
    modelRoles: {
      text: { status: "not_started" },
      vision: { status: input.visionArtifact ? "not_started" : "skipped" },
      adjudication: { status: "not_started" },
    },
    warnings: uniqueStrings([
      ...(input.importWarnings ?? []),
      ...bundle.warnings,
    ]),
    errorMessage: null,
    analysisCacheIdentity,
    analysisCacheHit: false,
    analysisCacheSourceRunId: null,
    candidateCounts: {
      total: 0,
      autoApplied: 0,
      needsReview: 0,
      rejected: 0,
      abstained: 0,
    },
  });

  await ctx.repository.replaceResumeImportRunArtifacts({
    run,
    documentBundles: [bundle],
    fieldCandidates: [],
  });

  try {
    const textStartedAt = new Date().toISOString();
    const textBranchStartedAtMs = performance.now();
    const visionArtifact = input.visionArtifact;
    const visionProvider = ctx.visionProvider;
    const visionSkipMessage =
      !visionArtifact || visionArtifact.pages.length === 0
        ? "No local resume page images were available for the vision branch."
        : "Resume vision provider is not configured; text import continued.";
    const canRunVision = Boolean(
      visionArtifact && visionArtifact.pages.length > 0 && visionProvider,
    );
    const visionStartedAt = canRunVision ? textStartedAt : null;
    const visionTimeoutMs = canRunVision ? visionTimeoutMsFor(ctx) : null;
    const modelRoles = modelRolesFor(run);
    run = ResumeImportRunSchema.parse({
      ...run,
      status: "extracting",
      modelRoles: {
        ...modelRoles,
        text: {
          ...modelRoles.text,
          status: "running",
          startedAt: textStartedAt,
        },
        vision: canRunVision
          ? {
              ...modelRoles.vision,
              status: "running",
              startedAt: visionStartedAt,
              timeoutMs: visionTimeoutMs,
              providerKind: visionProvider?.getStatus().kind ?? null,
              providerLabel: visionProvider?.getStatus().label ?? null,
            }
          : {
              ...modelRoles.vision,
              status: "skipped",
              warning: visionSkipMessage,
            },
      },
    });
    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: [],
    });

    const textBranchPromise: Promise<ResumeImportBranchResult> =
      (async (): Promise<ResumeImportBranchResult> => {
        const literalStartedAtMs = performance.now();
        const literalCandidates = extractLiteralCandidates(runId, bundle, now);
        literalExtractionMs = Math.max(
          0,
          Math.round(performance.now() - literalStartedAtMs),
        );
        const stageDurations = new Map<
          (typeof RESUME_IMPORT_STAGES)[number],
          number
        >();
        const stageSettlements = await Promise.allSettled(
          RESUME_IMPORT_STAGES.map((stage) => {
            const stageStartedAtMs = performance.now();
            return Promise.resolve()
              .then(() =>
                ctx.aiClient.extractResumeImportStage({
                  stage,
                  existingProfile: input.profile,
                  existingSearchPreferences: input.searchPreferences,
                  documentBundle: bundle,
                }),
              )
              .finally(() => {
                stageDurations.set(
                  stage,
                  Math.max(0, Math.round(performance.now() - stageStartedAtMs)),
                );
              });
          }),
        );
        const stageOutcomes: ResumeImportStageExtractionOutcome[] =
          RESUME_IMPORT_STAGES.map((stage, index) => {
            const settlement = stageSettlements[index];

            if (!settlement) {
              return resumeImportStageFailureOutcome(
                stage,
                new Error(
                  "The extraction stage did not produce a settled result.",
                ),
              );
            }

            if (settlement.status === "rejected") {
              return resumeImportStageFailureOutcome(stage, settlement.reason);
            }

            const parsedResult =
              ResumeImportStageExtractionResultSchema.safeParse(
                settlement.value,
              );
            if (!parsedResult.success) {
              return resumeImportStageFailureOutcome(stage, parsedResult.error);
            }

            if (parsedResult.data.stage !== stage) {
              return resumeImportStageFailureOutcome(
                stage,
                new Error(
                  `The provider returned the ${parsedResult.data.stage} stage instead of ${stage}.`,
                ),
              );
            }

            return {
              ok: true,
              stage,
              result: parsedResult.data,
            };
          });
        textStageTimings = stageOutcomes.map(
          (outcome): ResumeImportTextStageTiming => ({
            stage: outcome.stage,
            status: outcome.ok
              ? "completed"
              : branchStatusForFailure(outcome.message),
            providerKind: outcome.ok
              ? outcome.result.analysisProviderKind
              : null,
            providerLabel: outcome.ok
              ? outcome.result.analysisProviderLabel
              : null,
            durationMs: stageDurations.get(outcome.stage) ?? 0,
            primaryProviderMs: outcome.ok
              ? (outcome.result.timing?.primaryProviderMs ?? null)
              : null,
            deterministicFallbackMs: outcome.ok
              ? (outcome.result.timing?.deterministicFallbackMs ?? null)
              : null,
            candidateCount: outcome.ok ? outcome.result.candidates.length : 0,
            fallbackKind: outcome.ok
              ? (outcome.result.fallback?.kind ?? null)
              : null,
            fallbackReason: outcome.ok
              ? (outcome.result.fallback?.reason ?? null)
              : null,
          }),
        );
        const successfulStages = stageOutcomes.filter(
          (
            outcome,
          ): outcome is Extract<
            ResumeImportStageExtractionOutcome,
            { ok: true }
          > => outcome.ok,
        );
        const failedStages = stageOutcomes.filter(
          (
            outcome,
          ): outcome is Extract<
            ResumeImportStageExtractionOutcome,
            { ok: false }
          > => !outcome.ok,
        );

        if (successfulStages.length === 0) {
          return {
            ok: false,
            message:
              failedStages[0]?.message ||
              "Text resume import branch produced no usable extraction results.",
          };
        }

        const stageCandidates = successfulStages.flatMap(
          ({ stage, result }) => {
            const sourceKind = (() => {
              switch (stage) {
                case "identity_summary":
                  return "model_identity_summary" as const;
                case "experience":
                  return "model_experience" as const;
                case "background":
                  return "model_background" as const;
                case "shared_memory":
                  return "model_shared_memory" as const;
                default:
                  return "reconciler" as const;
              }
            })();

            return result.candidates.map((candidate, index) =>
              toCandidate(bundle, runId, sourceKind, now, candidate, index),
            );
          },
        );

        return {
          ok: true as const,
          literalCandidates,
          stageCandidates,
          providerKind:
            successfulStages.find(
              (entry) => entry.result.analysisProviderKind !== null,
            )?.result.analysisProviderKind ?? null,
          providerLabel:
            successfulStages.find((entry) => entry.result.analysisProviderLabel)
              ?.result.analysisProviderLabel ?? null,
          notes: uniqueStrings(
            successfulStages.flatMap((entry) => entry.result.notes),
          ),
          warnings: uniqueStrings([
            // A stage that fell back is not a failed stage, so it never
            // reaches `failedStages`. Reporting it here is the only thing that
            // stops a silent degradation from looking like a clean model run.
            ...(() => {
              const fellBack = successfulStages.filter(
                ({ result }) => result.fallback,
              );
              const modelStageCount = RESUME_IMPORT_STAGES.filter(
                (stage) => stage !== "shared_memory",
              ).length;
              const first = fellBack[0]?.result.fallback;
              if (first && fellBack.length >= modelStageCount) {
                return [
                  describeWholeResumeImportFallback({
                    kind: first.kind,
                    reason: first.reason,
                  }),
                ];
              }
              return fellBack.flatMap(({ stage, result }) =>
                result.fallback
                  ? [
                      describeResumeImportStageFallback({
                        stage,
                        kind: result.fallback.kind,
                        reason: result.fallback.reason,
                      }),
                    ]
                  : [],
              );
            })(),
            ...failedStages.map((entry) => entry.diagnostic),
          ]),
        };
      })().catch(
        (error: unknown): ResumeImportBranchResult => ({
          ok: false,
          message: messageFromUnknownError(
            error,
            "Text resume import branch failed.",
          ),
        }),
      );

    const visionBranchPromise: Promise<ResumeVisionBranchResult> =
      canRunVision && visionArtifact && visionProvider
        ? visionProvider
            .extractResumeVision({
              existingProfile: input.profile,
              existingSearchPreferences: input.searchPreferences,
              documentBundle: bundle,
              visionArtifact,
            })
            .then((result) => ({ ok: true as const, result }))
            .catch((error: unknown) => ({
              ok: false as const,
              message: messageFromUnknownError(
                error,
                "Vision resume import branch failed.",
              ),
            }))
        : Promise.resolve({
            ok: false as const,
            skipped: true as const,
            message: visionSkipMessage,
          });
    const observedVisionBranch = observePromise(visionBranchPromise);

    const textBranch = await textBranchPromise;
    textBranchMs = Math.max(
      0,
      Math.round(performance.now() - textBranchStartedAtMs),
    );
    let visionBranch: ResumeVisionBranchResolution;

    if (textBranch.ok && canRunVision) {
      const visionSnapshot = observedVisionBranch.getSnapshot();
      visionBranch = visionSnapshot.settled
        ? visionSnapshot.value
        : await getVisionBranchWithoutBlockingTextCompletion(
            observedVisionBranch,
            visionTimeoutMs ?? 600_000,
          );
    } else {
      visionBranch = canRunVision
        ? await withVisionBranchDeadline(
            observedVisionBranch.promise,
            visionTimeoutMs ?? 600_000,
            ctx,
          )
        : await observedVisionBranch.promise;
    }
    const reconciliationStartedAtMs = performance.now();

    run = ResumeImportRunSchema.parse({
      ...run,
      status: "extracting",
      analysisProviderKind: textBranch.ok ? textBranch.providerKind : null,
      analysisProviderLabel: textBranch.ok ? textBranch.providerLabel : null,
      visionProviderKind: visionBranch.ok
        ? visionBranch.result.analysisProviderKind
        : null,
      visionProviderLabel: visionBranch.ok
        ? visionBranch.result.analysisProviderLabel
        : null,
      modelRoles: {
        ...modelRolesFor(run),
        text: {
          ...modelRolesFor(run).text,
          status: textBranch.ok
            ? "completed"
            : branchStatusForFailure(textBranch.message),
          completedAt: new Date().toISOString(),
          providerKind: textBranch.ok ? textBranch.providerKind : null,
          providerLabel: textBranch.ok ? textBranch.providerLabel : null,
          warning: textBranch.ok ? (textBranch.warnings[0] ?? null) : null,
          errorMessage: textBranch.ok ? null : textBranch.message,
          candidateCount: textBranch.ok
            ? textBranch.literalCandidates.length +
              textBranch.stageCandidates.length
            : 0,
        },
        vision: branchStateFromVisionResolution({
          current: modelRolesFor(run).vision,
          visionBranch,
          visionTimeoutMs,
        }),
      },
    });

    const visionBranchHasUsableCandidates =
      visionBranch.ok && visionBranch.result.candidates.length > 0;

    if (!textBranch.ok && !visionBranchHasUsableCandidates) {
      throw new Error(
        uniqueStrings([
          textBranch.message,
          visionBranch.ok
            ? (visionBranch.result.primaryErrorMessage ??
              "Vision resume import produced no usable candidates.")
            : visionBranch.message,
        ]).join(" ") || "Both resume import extraction branches failed.",
      );
    }

    const visionCandidates = visionBranch.ok
      ? visionBranch.result.candidates.map((candidate, index) =>
          toCandidate(
            bundle,
            runId,
            "vision_omni",
            now,
            candidate,
            10_000 + index,
          ),
        )
      : [];

    const provisionalCandidates = promoteEducationScalarCandidates(
      normalizeSharedMemoryCandidates(
        enrichExperienceCandidatesFromNearbyMarkers(bundle, [
          ...(textBranch.ok ? textBranch.literalCandidates : []),
          ...(textBranch.ok ? textBranch.stageCandidates : []),
          ...visionCandidates,
        ]),
      ),
    );
    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: provisionalCandidates,
    });

    let reconciledCandidates = promoteGroundedSharedMemoryCandidates(
      reconcileCandidates(
        input.profile,
        input.searchPreferences,
        provisionalCandidates,
      ),
    );
    const adjudicationStartedAt = new Date().toISOString();
    run = ResumeImportRunSchema.parse({
      ...run,
      status: "reconciling",
      modelRoles: {
        ...modelRolesFor(run),
        adjudication: {
          ...modelRolesFor(run).adjudication,
          status: hasReviewableTextVisionConflict(reconciledCandidates)
            ? "running"
            : "skipped",
          startedAt: hasReviewableTextVisionConflict(reconciledCandidates)
            ? adjudicationStartedAt
            : null,
        },
      },
    });
    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: reconciledCandidates,
    });

    const adjudicationResult = await maybeAdjudicateResumeImportCandidates(
      ctx,
      {
        profile: input.profile,
        searchPreferences: input.searchPreferences,
        bundle,
        runId,
        now,
        candidates: reconciledCandidates,
      },
    );
    reconciledCandidates = promoteGroundedSharedMemoryCandidates(
      reconcileCandidates(
        input.profile,
        input.searchPreferences,
        adjudicationResult.candidates,
      ),
    );
    run = ResumeImportRunSchema.parse({
      ...run,
      modelRoles: {
        ...modelRolesFor(run),
        adjudication: {
          ...modelRolesFor(run).adjudication,
          status: adjudicationResult.status,
          completedAt: new Date().toISOString(),
          providerKind: adjudicationResult.providerKind,
          providerLabel: adjudicationResult.providerLabel,
          warning: adjudicationResult.warnings[0] ?? null,
          errorMessage: adjudicationResult.errorMessage,
          candidateCount: reconciledCandidates.filter(
            (candidate) => candidate.sourceKind === "adjudicator",
          ).length,
        },
      },
    });
    const visionBranchNotes = visionBranch.ok
      ? [...visionBranch.result.notes, ...visionBranch.result.warnings]
      : "skipped" in visionBranch
        ? []
        : [visionBranch.message];
    const stageNotes = uniqueStrings([
      ...(textBranch.ok
        ? [...textBranch.notes, ...textBranch.warnings]
        : [textBranch.message]),
      ...visionBranchNotes,
      ...adjudicationResult.notes,
      ...adjudicationResult.warnings,
    ]);
    const analysisWarnings = uniqueStrings([
      ...run.warnings,
      ...stageNotes,
      ...summarizeCandidateWarnings(reconciledCandidates),
    ]);
    const reconciliationMs = Math.max(
      0,
      Math.round(performance.now() - reconciliationStartedAtMs),
    );
    const finalizationStartedAtMs = performance.now();

    const merged = applyResolvedResumeImportCandidatesToWorkspace({
      profile: input.profile,
      searchPreferences: input.searchPreferences,
      candidates: reconciledCandidates,
      analysisProviderKind: run.analysisProviderKind,
      analysisProviderLabel: run.analysisProviderLabel,
      analysisWarnings,
    });
    const candidateCounts = countResumeImportCandidates(reconciledCandidates);
    const hasBlockingReviewCandidates =
      hasBlockingResumeImportCandidates(reconciledCandidates);
    const timelineRepairProposals = deriveResumeTimelineRepairProposals({
      runId: run.id,
      candidates: reconciledCandidates,
      createdAt: new Date().toISOString(),
    });

    run = ResumeImportRunSchema.parse({
      ...run,
      status: hasBlockingReviewCandidates ? "review_ready" : "applied",
      completedAt: new Date().toISOString(),
      warnings: analysisWarnings,
      candidateCounts,
      timelineRepairProposals,
      timing: {
        totalMs: null,
        textBranchMs,
        literalExtractionMs,
        reconciliationMs,
        finalizationMs: null,
        textStages: textStageTimings,
      },
    });
    const timingBeforeFinalization = run.timing;
    if (!timingBeforeFinalization) {
      throw new Error(
        "Resume import timing summary was not retained before finalization.",
      );
    }

    const atomicallyFinalizedRun = run;
    let finalization = await finalizeResumeImportRunAtRevision({
      ctx,
      expectedProfileRevision,
      profile: merged.profile,
      searchPreferences: merged.searchPreferences,
      run: atomicallyFinalizedRun,
      documentBundles: [bundle],
      fieldCandidates: reconciledCandidates,
      supersededBaseResume,
    });
    const retryState =
      finalization.status === "stale"
        ? await ctx.repository.getProfileWithRevision()
        : null;
    if (
      finalization.status === "stale" &&
      retryState &&
      (isSameStoredResumeDocument(
        retryState.profile.baseResume,
        input.profile.baseResume,
      ) ||
        (supersededBaseResume !== null &&
          isSameStoredResumeDocument(
            retryState.profile.baseResume,
            supersededBaseResume,
          ))) &&
      // Never retry a resume that names a different person than the profile
      // now shows; that import stays in review, as the hold path decided.
      resolveResumeIdentity(
        CandidateProfileSchema.parse({
          ...retryState.profile,
          baseResume: input.profile.baseResume,
        }),
      ).mismatchReasons.length === 0
    ) {
      // A profile write landed while the model was reading the resume (the
      // setup screen saving, a copilot patch, a warning being cleared). Every
      // extracted detail used to be downgraded to review for that alone, so
      // the person confirmed their whole resume by hand. When the stored
      // resume is still the one this import replaces, re-read the profile,
      // re-reconcile the same candidates against it, and try once more. A
      // newer resume import or a manual resume change keeps the old path.
      const retryProfile = CandidateProfileSchema.parse({
        ...retryState.profile,
        baseResume: input.profile.baseResume,
      });
      const retrySearchPreferences = await ctx.repository.getSearchPreferences();
      reconciledCandidates = await preserveLatestCandidateDecisions(
        ctx,
        run.id,
        reconcileCandidates(
          retryProfile,
          retrySearchPreferences,
          reconciledCandidates,
        ),
      );
      const retryMerged = applyResolvedResumeImportCandidatesToWorkspace({
        profile: retryProfile,
        searchPreferences: retrySearchPreferences,
        candidates: reconciledCandidates,
        analysisProviderKind: run.analysisProviderKind,
        analysisProviderLabel: run.analysisProviderLabel,
        analysisWarnings,
      });
      run = ResumeImportRunSchema.parse({
        ...run,
        status: hasBlockingResumeImportCandidates(reconciledCandidates)
          ? "review_ready"
          : "applied",
        candidateCounts: countResumeImportCandidates(reconciledCandidates),
      });
      finalization = await finalizeResumeImportRunAtRevision({
        ctx,
        expectedProfileRevision: retryState.revision,
        profile: retryMerged.profile,
        searchPreferences: retryMerged.searchPreferences,
        run,
        documentBundles: [bundle],
        fieldCandidates: reconciledCandidates,
        supersededBaseResume: await readSupersededBaseResume(
          ctx,
          retryState.revision,
        ),
      });
    }
    if (finalization.status === "stale") {
      // No retry was possible, or it lost again: the run is already persisted
      // as review-ready with every would-be-applied candidate held.
      return {
        profile: finalization.profile,
        searchPreferences: finalization.searchPreferences,
        run: finalization.run,
        candidates: finalization.candidates,
      };
    }
    const finalizationMs = Math.max(
      0,
      Math.round(performance.now() - finalizationStartedAtMs),
    );
    const measuredRun = ResumeImportRunSchema.parse({
      ...atomicallyFinalizedRun,
      timing: {
        ...timingBeforeFinalization,
        totalMs: Math.max(
          0,
          Math.round(performance.now() - workflowStartedAtMs),
        ),
        finalizationMs,
      },
    });
    try {
      await ctx.repository.upsertResumeImportRun(measuredRun);
      run = measuredRun;
    } catch (telemetryError) {
      console.warn(
        "Resume import timing telemetry could not be persisted after finalization.",
        telemetryError instanceof Error
          ? telemetryError.message
          : "Unknown error",
      );
      run = atomicallyFinalizedRun;
    }

    if (
      isDeferredVisionBranch(visionBranch) &&
      canRunVision &&
      visionTimeoutMs
    ) {
      scheduleDeferredVisionBranchCompletion({
        ctx,
        promise: observedVisionBranch.promise,
        bundle,
        run,
        runId,
        now,
        textCandidates: provisionalCandidates.filter(
          (candidate) => candidate.sourceKind !== "vision_omni",
        ),
        visionTimeoutMs,
      });
    }

    return {
      profile: finalization.profile,
      searchPreferences: finalization.searchPreferences,
      run,
      candidates: reconciledCandidates,
    };
  } catch (error) {
    run = ResumeImportRunSchema.parse({
      ...run,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage:
        error instanceof Error
          ? error.message
          : "Resume import failed before candidate extraction could finish.",
    });

    await ctx.repository.replaceResumeImportRunArtifacts({
      run,
      documentBundles: [bundle],
      fieldCandidates: [],
    });

    await ctx.repository.commitProfileUpdate(
      (current) =>
        CandidateProfileSchema.parse({
          ...current,
          baseResume: {
            ...current.baseResume,
            ...input.profile.baseResume,
            extractionStatus: bundle.fullText ? "failed" : "needs_text",
            lastAnalyzedAt: null,
            analysisWarnings: uniqueStrings([
              ...(input.importWarnings ?? []),
              ...bundle.warnings,
              run.errorMessage ?? "Resume import failed.",
            ]),
          },
        }),
      { expectedRevision: expectedProfileRevision },
    );

    throw error;
  }
}
