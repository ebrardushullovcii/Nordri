import {
  type ApplicationAttemptState,
  type ApplicationStatus,
  type BrowserSessionState,
  type ResumeApplicationMode,
  type ReviewQueueItem,
  type TailoredAsset,
  type TailoringMode,
} from "@unemployed/contracts";
import type { BadgeTone } from "../../lib/job-finder-types";
import {
  describeAiUnavailableResume,
  describeUntailorableListing,
} from "./resume-workspace-utils";

export const APPLICATION_PREPARATION_BATCH_LIMIT = 10;
export const TAILORED_DRAFT_PREPARATION_LIMIT = 10;

export type TailoredDraftPreparationStatus =
  | "idle"
  | "running"
  | "completed"
  | "stopped"
  | "failed";

export interface TailoredDraftPreparationViewState {
  attemptedCount: number;
  completedCount: number;
  currentIndex: number | null;
  eligibleRemainingCount: number;
  failedCount: number;
  status: TailoredDraftPreparationStatus;
  /** Stop was pressed: nothing new starts; drafts already started finish. */
  stopRequested?: boolean;
  totalCount: number;
}

export interface TailoredDraftPreparationProgress {
  completedCount: number;
  currentIndex: number;
  failedCount: number;
  totalCount: number;
}

export interface TailoredDraftPreparationResult {
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  failedJobIds: readonly string[];
  stopped: boolean;
  totalCount: number;
}

export interface ReviewQueueWorkflowStatus {
  label: string;
  tone: BadgeTone;
}

export interface ApplyReadinessStatus {
  label: string;
  tone: "active" | "critical" | "muted" | "positive";
}

export type ApplySupportState = "incomplete" | "manual_follow_up" | "supported";

export function getReviewQueueWorkflowStatus(
  item: ReviewQueueItem | null,
  asset?: TailoredAsset | null,
  /**
   * The renderer's own in-flight flag. The persisted asset status never moves
   * to "generating" during a draft, so without this the row and header kept
   * saying "Needs resume" for the whole run beside a progress bar.
   */
  isPending = false,
  /** Jobs whose application is already prepared; see isQueueStageReady. */
  preparedJobIds?: ReadonlySet<string>,
  /** Jobs with a preparation attempt that is still running. */
  applicationPreparingJobIds?: ReadonlySet<string>,
): ReviewQueueWorkflowStatus {
  if (!item) {
    return {
      label: "Choose a job",
      tone: "muted",
    };
  }

  if (hasResumeGenerationFailure(item, asset)) {
    return {
      label: "Resume failed",
      tone: "critical",
    };
  }

  if (isPending) {
    return {
      label: "Writing resume",
      tone: "active",
    };
  }

  if (applicationPreparingJobIds?.has(item.jobId)) {
    return {
      label: "Applying",
      tone: "active",
    };
  }

  if (preparedJobIds?.has(item.jobId)) {
    return {
      label: "In Applications",
      tone: "positive",
    };
  }

  if (item.assetStatus === "not_started") {
    return {
      label:
        item.resumeApplicationMode === "original_resume"
          ? "Ready to apply"
          : "No resume yet",
      tone:
        item.resumeApplicationMode === "original_resume" ? "positive" : "muted",
    };
  }

  if (item.assetStatus === "generating" || item.assetStatus === "queued") {
    return {
      label: "Writing resume",
      tone: "active",
    };
  }

  // An Aggressive draft is read by the person before it is used (ADR 0018),
  // so the row says so instead of promising Apply.
  if (needsPersonResumeReview(item, asset)) {
    return {
      label: "Review resume",
      tone: "active",
    };
  }

  if (isQueueStageReady(item)) {
    return {
      label: "Ready to apply",
      tone: "positive",
    };
  }

  if (item.resumeReview.status === "approved" && !item.resumeAssetId) {
    return {
      label: "Resume unavailable",
      tone: "critical",
    };
  }

  if (item.resumeReview.status === "stale") {
    // The approved draft is stale, not broken: the resume still exists and the
    // job is still reviewable, it just needs regenerating. `warning` (F44)
    // instead of the failure hue `critical` used before the tone existed.
    return {
      label: "Out of date",
      tone: "warning",
    };
  }

  return {
    label: "Review resume",
    tone: "active",
  };
}

/**
 * Lines in the job's saved resume still waiting for the person's decision.
 * Apply cannot approve such a resume at any level, so the job is not ready.
 */
export function countResumeLinesToDecide(
  item: Pick<ReviewQueueItem, "resumeLinesToDecide" | "resumeReview"> | null,
): number {
  if (!item || item.resumeReview.status === "approved") return 0;
  return item.resumeLinesToDecide ?? 0;
}

/**
 * True when the draft has to be read by the person before it is used: an
 * Aggressive draft that is not yet approved (ADR 0018), or a draft at any
 * level with a line still waiting for their decision. Light and Tailored
 * otherwise keep every fact, so pressing Apply is their approval.
 */
export function needsPersonResumeReview(
  item: ReviewQueueItem | null,
  /**
   * The job's written resume, when the caller has it. A resume written
   * without the listing text kept the person's own wording: nothing was
   * stretched, so there are no flagged lines to read, whatever the level.
   */
  asset?: Pick<
    TailoredAsset,
    "id" | "generationMethod" | "generationReason"
  > | null,
): boolean {
  if (
    item !== null &&
    item.resumeApplicationMode !== "original_resume" &&
    countResumeLinesToDecide(item) > 0
  ) {
    return true;
  }
  if (
    asset &&
    item?.resumeAssetId === asset.id &&
    asset.generationMethod === "deterministic" &&
    (asset.generationReason === "listing_text_missing" ||
      asset.generationReason === "listing_text_not_distinguishing")
  ) {
    return false;
  }
  return (
    item !== null &&
    item.resumeApplicationMode !== "original_resume" &&
    item.resumeTailoringMode === "aggressive" &&
    Boolean(item.resumeAssetId) &&
    item.resumeReview.status !== "approved"
  );
}

export function isResumeGenerationInProgress(
  item: ReviewQueueItem | null,
): boolean {
  return item?.assetStatus === "generating" || item?.assetStatus === "queued";
}

/**
 * Picking another level for a job whose resume is already written rewrites
 * it at that level. Changing Light to Tailored used to leave the Light text
 * in place, still "ready", and Apply approved and sent it; the only rewrite
 * sat inside the guided-edits popup. Original sends the imported file, so
 * moving to it rewrites nothing, and a job with no resume yet keeps its
 * "Create the resume" step.
 */
export function shouldRewriteResumeAfterLevelChange(input: {
  item: Pick<
    ReviewQueueItem,
    "assetStatus" | "resumeApplicationMode" | "resumeTailoringMode"
  >;
  /** The saved strength a job without its own level is written at. */
  defaultTailoringMode: TailoringMode;
  nextApplicationMode: ResumeApplicationMode;
  nextTailoringMode?: TailoringMode | null;
}): boolean {
  if (
    input.nextApplicationMode === "original_resume" ||
    input.item.assetStatus !== "ready"
  ) {
    return false;
  }
  const currentLevel =
    input.item.resumeApplicationMode === "original_resume"
      ? "original_resume"
      : (input.item.resumeTailoringMode ?? input.defaultTailoringMode);
  const nextLevel = input.nextTailoringMode ?? input.defaultTailoringMode;
  return currentLevel !== nextLevel;
}

export function needsResumeGeneration(item: ReviewQueueItem | null): boolean {
  return (
    item?.resumeApplicationMode !== "original_resume" &&
    item?.assetStatus === "not_started"
  );
}

export function hasResumeGenerationFailure(
  item: ReviewQueueItem | null,
  asset?: TailoredAsset | null,
): boolean {
  if (item?.assetStatus !== "failed") {
    return false;
  }
  // A real generation failure always persists sanitized failure detail next
  // to its failed status. A failed marker without any failure detail is a
  // restored or stale review state (the tailored draft still exists), so the
  // nearest recovery is review plus export instead of regenerating.
  if (!asset) {
    return true;
  }
  return asset.failureMessage !== null || asset.failedAt !== null;
}

/**
 * Jobs that have moved to Applications, including a failed or staged attempt.
 * ADR 0026 excludes them from Shortlisted's Apply to all count. Their next
 * action belongs to the existing record in Applications, where Try again
 * preserves its history instead of starting another batch entry here.
 */
export function collectPreparedApplicationJobIds(
  applicationRecords:
    | readonly {
        jobId: string;
        status: ApplicationStatus;
        lastAttemptState?: ApplicationAttemptState | null;
      }[]
    | undefined,
): ReadonlySet<string> {
  return new Set((applicationRecords ?? []).map((record) => record.jobId));
}

export function collectInProgressApplicationJobIds(
  applicationRecords:
    | readonly {
        jobId: string;
        lastAttemptState?: ApplicationAttemptState | null | undefined;
      }[]
    | undefined,
): ReadonlySet<string> {
  return new Set(
    (applicationRecords ?? [])
      .filter((record) => record.lastAttemptState === "in_progress")
      .map((record) => record.jobId),
  );
}

export function isQueueStageReady(
  item: ReviewQueueItem | null,
  preparedJobIds?: ReadonlySet<string>,
): boolean {
  if (!item || preparedJobIds?.has(item.jobId)) {
    return false;
  }

  // A job set to apply with the original resume already has its resume file:
  // the one the person uploaded. It has no tailored draft and never will, so
  // requiring a ready generated asset left six such rows unselectable under a
  // sentence that named the unchanged original resume as qualifying, beside a
  // batch card explaining there was no draft to write.
  if (item.resumeApplicationMode === "original_resume") {
    return true;
  }

  if (needsPersonResumeReview(item)) {
    return false;
  }

  return Boolean(
    item.assetStatus === "ready" &&
    item.resumeAssetId &&
    (item.resumeReview.status === "approved" ||
      item.resumeReview.status === "draft" ||
      item.resumeReview.status === "needs_review" ||
      item.resumeReview.status === "original_resume"),
  );
}

/**
 * Shortlisted row caption: what the resume for this job is right now, in
 * one short line. Must match readiness: never say a resume "will be created"
 * when one is ready.
 */
export function getReviewQueueResumePolicyCaption(
  item: ReviewQueueItem,
  asset?: TailoredAsset | null,
): string {
  // Nothing could be written for a job whose listing text was never captured,
  // so the row must not promise a tailored resume it is not going to produce.
  if (describeUntailorableListing(asset)) {
    return "Original wording — the listing text was not captured";
  }

  if (item.resumeApplicationMode === "original_resume") {
    return item.resumeReview.status === "original_resume"
      ? "Original resume, unchanged"
      : "Original resume, unchanged (import it in Profile)";
  }

  if (item.assetStatus === "generating" || item.assetStatus === "queued") {
    return "Writing the resume…";
  }

  if (item.resumeReview.status === "stale") {
    return "Approved resume is out of date";
  }

  if (hasResumeGenerationFailure(item)) {
    return "Resume failed — try again";
  }

  if (item.resumeReview.status === "approved") {
    return "Resume approved";
  }

  // The built-in generator wrote it because AI was unavailable. It is usable,
  // but the row must not read like an AI-written resume.
  if (item.assetStatus === "ready" && describeAiUnavailableResume(asset)) {
    return "Your saved wording — AI was unavailable";
  }

  const linesToDecide = countResumeLinesToDecide(item);
  if (linesToDecide > 0) {
    return linesToDecide === 1
      ? "A line in this resume needs your decision"
      : `${linesToDecide} lines in this resume need your decision`;
  }

  if (needsPersonResumeReview(item, asset)) {
    return "Resume ready — review it before applying";
  }

  if (
    item.assetStatus === "ready" ||
    item.resumeReview.status === "needs_review" ||
    item.resumeReview.status === "draft"
  ) {
    return "Resume ready — Apply approves it";
  }

  // Nothing has been requested yet; name the need, not a promised action.
  return "No resume yet";
}

/**
 * A bulk draft run may only schedule a tailored job that has no existing
 * review. Failed attempts remain eligible so the user can retry them; queued,
 * generating, ready, stale, approved, and already-reviewed jobs stay out of
 * the run.
 */
export function isTailoredDraftPreparationEligible(
  item: ReviewQueueItem,
  /**
   * Jobs whose application is already prepared, read from the application
   * records — the SAME set `isQueueStageReady` is given. Both counts on the
   * batch card now come off one population, so "0 eligible · 12 ready to
   * prepare" can no longer be two answers about jobs that overlap.
   */
  preparedJobIds?: ReadonlySet<string>,
): boolean {
  if (preparedJobIds?.has(item.jobId)) {
    return false;
  }

  return (
    item.resumeApplicationMode !== "original_resume" &&
    (item.assetStatus === "not_started" || item.assetStatus === "failed") &&
    item.resumeReview.status === "not_started"
  );
}

/**
 * Why the batch-draft button cannot run, in the words of what would change it.
 * A permanently greyed control beside a number the person cannot act on is the
 * shape of the defect this replaces; null means the button is live.
 */
export function describeTailoredDraftPreparationBlocker(
  queue: readonly ReviewQueueItem[],
  preparedJobIds?: ReadonlySet<string>,
): string | null {
  if (countTailoredDraftPreparationEligible(queue, preparedJobIds) > 0) {
    return null;
  }

  if (queue.length === 0) {
    return "Shortlist a job first.";
  }

  const allOriginalResume = queue.every(
    (item) => item.resumeApplicationMode === "original_resume",
  );
  if (allOriginalResume) {
    return "Every job here uses your original resume, so there is nothing to write.";
  }

  return "Every job here already has a resume.";
}

export function getTailoredDraftPreparationCandidates(
  queue: readonly ReviewQueueItem[],
  limit = TAILORED_DRAFT_PREPARATION_LIMIT,
  preparedJobIds?: ReadonlySet<string>,
): ReviewQueueItem[] {
  const boundedLimit = Math.min(
    Math.max(0, limit),
    TAILORED_DRAFT_PREPARATION_LIMIT,
  );

  if (boundedLimit === 0) {
    return [];
  }

  const seenJobIds = new Set<string>();
  const candidates: ReviewQueueItem[] = [];

  for (const item of queue) {
    if (
      seenJobIds.has(item.jobId) ||
      !isTailoredDraftPreparationEligible(item, preparedJobIds)
    ) {
      continue;
    }

    seenJobIds.add(item.jobId);
    candidates.push(item);

    if (candidates.length >= boundedLimit) {
      break;
    }
  }

  return candidates;
}

export function countTailoredDraftPreparationEligible(
  queue: readonly ReviewQueueItem[],
  preparedJobIds?: ReadonlySet<string>,
): number {
  const seenJobIds = new Set<string>();
  let count = 0;

  for (const item of queue) {
    if (
      seenJobIds.has(item.jobId) ||
      !isTailoredDraftPreparationEligible(item, preparedJobIds)
    ) {
      continue;
    }

    seenJobIds.add(item.jobId);
    count += 1;
  }

  return count;
}

export function countQueueStageReady(
  queue: readonly ReviewQueueItem[],
  preparedJobIds?: ReadonlySet<string>,
): number {
  const seenJobIds = new Set<string>();
  let count = 0;

  for (const item of queue) {
    if (seenJobIds.has(item.jobId)) {
      continue;
    }

    seenJobIds.add(item.jobId);
    if (isQueueStageReady(item, preparedJobIds)) {
      count += 1;
    }
  }

  return count;
}

export async function prepareTailoredDraftBatch(
  queue: readonly ReviewQueueItem[],
  onGenerateResume: (jobId: string) => Promise<boolean>,
  options: {
    onProgress?: (progress: TailoredDraftPreparationProgress) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<TailoredDraftPreparationResult> {
  const candidates = getTailoredDraftPreparationCandidates(queue);
  let attemptedCount = 0;
  let completedCount = 0;
  const failedJobIds: string[] = [];
  let stopped = false;

  const reportProgress = () => {
    options.onProgress?.({
      completedCount,
      currentIndex: attemptedCount,
      failedCount: failedJobIds.length,
      totalCount: candidates.length,
    });
  };
  const worker = async () => {
    while (attemptedCount < candidates.length) {
      if (options.shouldStop?.()) {
        stopped = true;
        return;
      }
      // Claim synchronously before awaiting so each job has exactly one owner.
      const item = candidates[attemptedCount++]!;
      reportProgress();
      let succeeded = false;
      try {
        succeeded = await onGenerateResume(item.jobId);
      } catch {
        succeeded = false;
      }
      if (succeeded) completedCount += 1;
      else failedJobIds.push(item.jobId);
      reportProgress();
    }
  };

  // Two requests keep providers and local PDF work bounded. Stop prevents new
  // claims; already-started drafts finish and remain available.
  await Promise.all(
    Array.from({ length: Math.min(2, candidates.length) }, worker),
  );

  return {
    attemptedCount,
    completedCount,
    failedCount: failedJobIds.length,
    failedJobIds: candidates
      .filter((item) => failedJobIds.includes(item.jobId))
      .map((item) => item.jobId),
    stopped,
    totalCount: candidates.length,
  };
}

function formatEligibleRemainderSentence(count: number): string {
  const safeCount = Math.max(0, count);
  return safeCount === 1
    ? "1 more job still needs a resume; run it again."
    : `${safeCount} more jobs still need a resume; run it again.`;
}

/**
 * Result copy for a finished tailored-draft batch. A run that attempted every
 * candidate never reports "Stopped": failures continue the batch, and failed
 * jobs stay eligible so the exact remainder can be rerun.
 */
export function getTailoredDraftPreparationResultMessage(
  state: TailoredDraftPreparationViewState,
): string | null {
  if (
    state.status !== "completed" &&
    state.status !== "failed" &&
    state.status !== "stopped"
  ) {
    return null;
  }

  const completedCount = Math.max(0, state.completedCount);
  const failedCount = Math.max(0, state.failedCount);
  const eligibleRemainingCount = Math.max(0, state.eligibleRemainingCount);
  const completedDrafts = `${completedCount} resume${completedCount === 1 ? "" : "s"}`;
  const remainderSentence =
    eligibleRemainingCount > 0
      ? ` ${formatEligibleRemainderSentence(eligibleRemainingCount)}`
      : "";

  if (state.status === "completed") {
    return `Wrote ${completedDrafts}.${remainderSentence} Nothing was sent.`;
  }

  if (state.status === "stopped") {
    return `Stopped after ${completedDrafts}. Nothing was sent.`;
  }

  const ranToCompletion = state.attemptedCount >= state.totalCount;
  const leadSentence = ranToCompletion
    ? `Wrote ${completedDrafts}; ${failedCount} failed.`
    : `Stopped after ${completedDrafts}; ${failedCount} failed.`;

  return `${leadSentence}${remainderSentence} Run it again to retry the failed job${failedCount === 1 ? "" : "s"}. Nothing was sent.`;
}

export function getApplyReadinessStatus(params: {
  applySupportState: ApplySupportState;
  browserSession: BrowserSessionState;
  hasGenerationFailure: boolean;
  hasReadyApprovedAsset: boolean;
  isGenerating: boolean;
  needsGeneration: boolean;
  resumeReviewStatus: ReviewQueueItem["resumeReview"]["status"] | "not_started";
  selectedItem: ReviewQueueItem | null;
}): ApplyReadinessStatus {
  const {
    applySupportState,
    browserSession,
    hasGenerationFailure,
    hasReadyApprovedAsset,
    isGenerating,
    needsGeneration,
    resumeReviewStatus,
    selectedItem,
  } = params;

  if (!selectedItem) {
    return {
      label: "Choose a job",
      tone: "muted",
    };
  }

  if (hasGenerationFailure) {
    return {
      label: "Resume failed",
      tone: "critical",
    };
  }

  // An in-flight run wins over "No resume yet": both flags are true while a
  // draft is being written, and the readiness description already orders
  // them this way.
  if (isGenerating) {
    return {
      label: "Writing resume",
      tone: "active",
    };
  }

  if (needsGeneration) {
    return {
      label: "No resume yet",
      tone: "muted",
    };
  }

  if (!hasReadyApprovedAsset) {
    return {
      label: resumeReviewStatus === "stale" ? "Out of date" : "Review resume",
      tone: "critical",
    };
  }

  if (applySupportState === "incomplete") {
    return {
      label: "Job data missing",
      tone: "critical",
    };
  }

  if (applySupportState === "manual_follow_up") {
    if (browserSession.status === "blocked") {
      return {
        label: "Browser blocked",
        tone: "critical",
      };
    }

    if (browserSession.status === "login_required") {
      return {
        label: "Browser requires sign-in",
        tone: "active",
      };
    }

    return {
      label:
        browserSession.status === "unknown"
          ? "Browser not open"
          : "Live form check",
      tone: "active",
    };
  }

  if (browserSession.status === "ready") {
    return {
      label: "Ready to apply",
      tone: "positive",
    };
  }

  if (browserSession.status === "unknown") {
    return {
      label: "Browser not open",
      tone: "active",
    };
  }

  if (browserSession.status === "login_required") {
    return {
      label: "Browser requires sign-in",
      tone: "active",
    };
  }

  return {
    label: "Browser blocked",
    tone: "critical",
  };
}

/** The Shortlisted level name for a saved tailoring strength. */
export function describeSavedResumeLevel(level: TailoringMode): string {
  return level === "aggressive"
    ? "Aggressive"
    : level === "conservative"
      ? "Light"
      : "Tailored";
}

/** What the action line says after a resume run for one job finished. */
export const AI_UNAVAILABLE_RESUME_RESULT_MESSAGE =
  "AI was unavailable, so this resume keeps your saved wording. Press Try again with AI when you are ready.";

/**
 * A resume run can end with the built-in resume when AI was unavailable. The
 * action line must say so instead of "Resume created", which reads as an AI
 * resume that is ready.
 */
export function describeResumeRunResult(
  snapshot: { tailoredAssets?: readonly TailoredAsset[] } | null | undefined,
  jobId: string,
  successMessage: string,
): string {
  const asset = snapshot?.tailoredAssets?.find(
    (candidate) => candidate.jobId === jobId,
  );
  return describeAiUnavailableResume(asset)
    ? AI_UNAVAILABLE_RESUME_RESULT_MESSAGE
    : successMessage;
}
