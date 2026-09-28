import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserSessionState,
  ApplicationAutomationMode,
  ApplicationRecord,
  CandidateProfile,
  GlobalDailyApplicationPreparationCapacity,
  JobFinderApplicationStartTarget,
  JobFinderWorkspaceSnapshot,
  ResumeApplicationMode,
  TailoringMode,
  ResumeSourceDocument,
  ReviewQueueItem,
  SavedJob,
  TailoredAsset,
} from "@unemployed/contracts";
import {
  APPLICATION_PREPARATION_BATCH_LIMIT,
  collectInProgressApplicationJobIds,
  getReviewQueueWorkflowStatus,
  isQueueStageReady,
  isResumeGenerationInProgress,
} from "./review-queue-status";
import { LockedScreenLayout } from "../../components/locked-screen-layout";
import { PageHeaderStack } from "../../components/page-header";
import { Button } from "@renderer/components/ui/button";
import { EmptyState } from "../../components/empty-state";
import { StatusBadge } from "../../components/status-badge";
import { MatchEvidenceMatrix } from "../../components/match-evidence-matrix";
import { jobDescriptionToText } from "../../lib/job-description-text";
import {
  formatJobEmployerLocationLine,
  scrubJobAbsencePlaceholdersList,
} from "../../lib/job-employer-location-display";
import { getMatchAssessmentPresentation } from "../../lib/match-assessment-presentation";
import { RESUME_OPERATION_LONG_RUNNING_MS } from "./review-queue-progress";
import type { JobFinderAutoApplyQueueStartOutcome } from "../../lib/job-finder-types";
import { useStableCallback } from "../../hooks/use-stable-callback";
import { ReviewQueueListPanel } from "./review-queue-list-panel";
import { collectPreparedApplicationJobIds } from "./review-queue-status";
import { ReviewQueueMissionPanel } from "./review-queue-mission-panel";
import { useAssistantContextSource } from "../../assistant/assistant-provider";
import { buildListContext } from "../../assistant/assistant-context-capture";
import { describeApplyAllOutcome } from "./review-queue-mission-panel-helpers";
import { ReviewQueuePreviewPanel } from "./review-queue-preview-panel";
import type { TailoredDraftPreparationViewState } from "./review-queue-status";

const workspacePanelId = "review-queue-workspace-panel";

export function ReviewQueueScreen(props: {
  resumeOperationStarts?: Readonly<Record<string, number>> | undefined;
  actionState: { message: string | null };
  applicationRecords: readonly ApplicationRecord[];
  applicationAutomationMode?: ApplicationAutomationMode;
  browserSession: BrowserSessionState;
  campaignId: string;
  draftPreparation: TailoredDraftPreparationViewState;
  globalDailyApplicationPreparationCapacity: GlobalDailyApplicationPreparationCapacity | null;
  isApplyPending: boolean;
  /**
   * The live apply results, so the start control can follow the run record
   * rather than a local pending flag that expires after about a minute while
   * a real run keeps going for several.
   */
  applyJobResults?: JobFinderWorkspaceSnapshot["applyJobResults"];
  isJobPending: (jobId: string) => boolean;
  onPrepareTailoredDrafts: (jobIds?: readonly string[]) => void;
  onStopTailoredDraftPreparation: () => void;
  onStartAutoApplyQueue: (
    jobIds: string[],
    applicationAutomationMode?: ApplicationAutomationMode,
  ) => Promise<JobFinderAutoApplyQueueStartOutcome>;
  onStartApplyCopilot: (input: JobFinderApplicationStartTarget) => void;
  onEditResumeWorkspace: (jobId: string) => void;
  onApproveResumeAndApply?: (jobId: string) => void;
  onGenerateResume: (
    jobId: string,
    options?: { selectAfter?: boolean },
  ) => Promise<boolean>;
  onOpenBrowserSession: () => void;
  onOpenJobDetails: (jobId: string) => void;
  onOpenApplication?: (recordId: string) => void;
  onOpenProfile: () => void;
  onOpenSafeguards?: () => void;
  safeguardBlocker?: string | null;
  onClaimResumeIdentity?: () => void;
  onKeepResumeIdentity?: () => void;
  onRemoveReviewJob: (jobId: string) => void;
  onSetJobResumeApplicationMode: (
    jobId: string,
    resumeApplicationMode: ResumeApplicationMode,
    resumeTailoringMode?: TailoringMode | null,
  ) => void;
  onSelectItem: (jobId: string) => void;
  originalResume: ResumeSourceDocument;
  profile?: CandidateProfile;
  queue: readonly ReviewQueueItem[];
  selectedAsset: TailoredAsset | null;
  selectedItem: ReviewQueueItem | null;
  selectedJob: SavedJob | null;
  tailoredAssets?: readonly TailoredAsset[] | undefined;
}) {
  const {
    resumeOperationStarts,
    actionState,
    applicationRecords,
    applicationAutomationMode = "prepare_only",
    browserSession,
    draftPreparation,
    globalDailyApplicationPreparationCapacity,
    isApplyPending,
    applyJobResults,
    isJobPending,
    onPrepareTailoredDrafts,
    onStopTailoredDraftPreparation,
    onStartAutoApplyQueue,
    onStartApplyCopilot,
    onEditResumeWorkspace,
    onApproveResumeAndApply,
    onGenerateResume,
    onOpenBrowserSession,
    onOpenJobDetails,
    onOpenApplication,
    onOpenProfile,
    onOpenSafeguards,
    safeguardBlocker,
    onClaimResumeIdentity,
    onKeepResumeIdentity,
    onRemoveReviewJob,
    onSetJobResumeApplicationMode,
    onSelectItem,
    originalResume,
    profile,
    queue,
    selectedAsset,
    selectedItem,
    selectedJob,
    tailoredAssets,
  } = props;
  const previewState =
    selectedItem &&
    selectedItem.resumeApplicationMode !== "original_resume" &&
    !selectedAsset &&
    selectedItem.assetStatus === "ready"
      ? "missing"
      : null;
  const selectedJobPending = selectedItem
    ? isJobPending(selectedItem.jobId)
    : false;
  const selectedJobId = selectedItem?.jobId ?? null;
  const [selectedJobPendingTooLong, setSelectedJobPendingTooLong] =
    useState(false);
  const isSelectedJobPreparing =
    selectedJobPending || isResumeGenerationInProgress(selectedItem);
  const [pendingElapsedSeconds, setPendingElapsedSeconds] = useState(0);
  const actionMessageScopeRef = useRef<{
    jobId: string | null;
    message: string | null;
  }>({ jobId: selectedItem?.jobId ?? null, message: actionState.message });
  if (actionMessageScopeRef.current.message !== actionState.message) {
    actionMessageScopeRef.current = {
      jobId: selectedItem?.jobId ?? null,
      message: actionState.message,
    };
  }
  const scopedActionMessage =
    actionMessageScopeRef.current.jobId === (selectedItem?.jobId ?? null)
      ? actionState.message
      : null;
  // Jobs that already have an application record are in Applications; they
  // stop counting as ready to apply here.
  const preparedJobIds = useMemo(
    () => collectPreparedApplicationJobIds(applicationRecords),
    [applicationRecords],
  );
  // The shortlist as the person sees it, for the assistant (ADR 0037).
  useAssistantContextSource("shortlist", () => ({
    focus: selectedItem
      ? {
          kind: "job",
          id: selectedItem.jobId,
          label: `${selectedItem.title} at ${selectedItem.company}`,
        }
      : null,
    // The open job is focus; the list panel publishes the ticked rows.
    list: buildListContext({
      listKind: "shortlist",
      checkedIds: [],
      displayedIds: queue.map((item) => item.jobId),
      filteredIds: queue.map((item) => item.jobId),
    }),
  }));
  const applicationPreparingJobIds = useMemo(
    () => collectInProgressApplicationJobIds(applicationRecords),
    [applicationRecords],
  );
  const selectedWorkflowStatus = getReviewQueueWorkflowStatus(
    selectedItem,
    selectedAsset,
    selectedItem ? isJobPending(selectedItem.jobId) : false,
    // Same set the Shortlisted rows read. Leaving it out gave the header its
    // own second verdict for the job already selected in the list.
    preparedJobIds,
    applicationPreparingJobIds,
  );
  const selectedJobEmployerLocationLine = selectedJob
    ? formatJobEmployerLocationLine({
        company: selectedJob.company,
        location: selectedJob.location,
        canonicalUrl: selectedJob.canonicalUrl,
      })
    : "";
  const selectedJobFitReasons = selectedJob
    ? scrubJobAbsencePlaceholdersList(selectedJob.matchAssessment.reasons)
    : [];
  const selectedJobAssessment = selectedJob
    ? getMatchAssessmentPresentation(selectedJob)
    : null;
  // A "summary" that only repeats the job title is not listing text.
  const selectedJobSummaryText = (() => {
    if (!selectedJob) {
      return "";
    }
    const text = jobDescriptionToText(
      selectedJob.summary ?? selectedJob.description,
    ).trim();
    return text.toLowerCase() === selectedJob.title.trim().toLowerCase()
      ? ""
      : text;
  })();

  const operationStartedAt = selectedJobId
    ? resumeOperationStarts?.[selectedJobId]
    : undefined;

  useEffect(() => {
    setSelectedJobPendingTooLong(false);

    if (!selectedJobPending || selectedJobId === null) {
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        setSelectedJobPendingTooLong(true);
      },
      Math.max(
        0,
        RESUME_OPERATION_LONG_RUNNING_MS -
          (operationStartedAt === undefined
            ? 0
            : Date.now() - operationStartedAt),
      ),
    );

    return () => window.clearTimeout(timeoutId);
  }, [selectedJobId, selectedJobPending, operationStartedAt]);

  // The draft reports no real progress, so the honest thing to move is the
  // clock, not a fabricated percentage. Keyed to the same condition the
  // panels use to show the indicator, so the bar never appears beside a
  // stopped clock.
  useEffect(() => {
    if (!isSelectedJobPreparing || selectedJobId === null) {
      setPendingElapsedSeconds(0);
      return;
    }

    const startedAt = operationStartedAt ?? Date.now();
    const updateElapsed = () =>
      setPendingElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);

    return () => window.clearInterval(timer);
  }, [isSelectedJobPreparing, selectedJobId, operationStartedAt]);

  // "Apply to all ready jobs": every job whose resume is ready, in list
  // order, up to the per-run cap. Jobs already in Applications and jobs whose
  // application is running are left alone (ADR 0022's "Apply to all").
  const [applyAllPending, setApplyAllPending] = useState(false);
  const applicationBatchLimit = Math.min(
    APPLICATION_PREPARATION_BATCH_LIMIT,
    Math.max(
      0,
      globalDailyApplicationPreparationCapacity?.remaining ??
        Number.POSITIVE_INFINITY,
    ),
  );
  const handleApplyToAllReady = useCallback(() => {
    const unavailable = new Set([
      ...preparedJobIds,
      ...applicationPreparingJobIds,
    ]);
    const readyJobIds = queue
      .filter((item) => isQueueStageReady(item, unavailable))
      .map((item) => item.jobId)
      .slice(0, applicationBatchLimit);
    if (readyJobIds.length === 0) {
      return;
    }
    setApplyAllPending(true);
    void onStartAutoApplyQueue(readyJobIds, applicationAutomationMode).finally(
      () => {
        setApplyAllPending(false);
      },
    );
  }, [
    applicationBatchLimit,
    applicationPreparingJobIds,
    applicationAutomationMode,
    onStartAutoApplyQueue,
    preparedJobIds,
    queue,
  ]);

  // Below the `xl` two-pane breakpoint the job column stacks under the list,
  // so selecting a job moved the one next action below the fold with nothing
  // saying so. Find jobs and Applications both reveal their stacked detail
  // region on pointer selection; Shortlisted uses the same mechanism.
  //
  // Stable for the life of the screen: the rows are memoised, and this
  // handler reaches every one of them.
  const selectItemAndRevealWorkspace = useStableCallback((jobId: string) => {
    onSelectItem(jobId);

    if (
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      return;
    }

    window.requestAnimationFrame(() => {
      document
        .getElementById(workspacePanelId)
        ?.scrollIntoView({ block: "start" });
    });
  });
  return (
    <LockedScreenLayout
      contentClassName="xl:overflow-hidden"
      lockContentHeight
      topContent={
        <PageHeaderStack
          title="Shortlisted"
          description="The jobs you want. Pick a resume level for each, get the resume ready, then press Apply."
        />
      }
    >
      <div className="grid min-w-0 items-stretch gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(24rem,0.72fr)_minmax(34rem,1fr)] assistant-docked:xl:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1fr)] xl:overflow-hidden">
        <ReviewQueueListPanel
          key={props.campaignId}
          campaignId={props.campaignId}
          draftPreparation={draftPreparation}
          isApplyToAllPending={applyAllPending || isApplyPending}
          applicationBatchLimit={applicationBatchLimit}
          isJobPending={isJobPending}
          onApplyToAllReady={handleApplyToAllReady}
          applyAllOutcome={describeApplyAllOutcome(applicationAutomationMode)}
          onPrepareTailoredDrafts={onPrepareTailoredDrafts}
          {...(onOpenSafeguards ? { onOpenSafeguards } : {})}
          safeguardBlocker={safeguardBlocker ?? null}
          onSelectItem={selectItemAndRevealWorkspace}
          onStopTailoredDraftPreparation={onStopTailoredDraftPreparation}
          preparedJobIds={preparedJobIds}
          applicationPreparingJobIds={applicationPreparingJobIds}
          queue={queue}
          selectedItem={selectedItem}
          tailoredAssets={tailoredAssets}
        />
        <section className="surface-panel-shell flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border) xl:h-full">
          {/* Pinned: reading a long resume or job description must not scroll
              away the job title or its state. */}
          <header className="sticky top-0 z-10 grid shrink-0 gap-1 border-b border-(--surface-panel-border) bg-(--surface-panel) px-5 pb-3 pt-4 xl:static">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-(--text-headline)">
                  {selectedJob?.title ?? "Job"}
                </h2>
                {selectedJob ? (
                  selectedJobEmployerLocationLine ? (
                    <p className="mt-1 truncate text-(length:--text-small) text-foreground-muted">
                      {selectedJobEmployerLocationLine}
                    </p>
                  ) : null
                ) : (
                  <p className="mt-1 truncate text-(length:--text-small) text-foreground-muted">
                    Choose a shortlisted job.
                  </p>
                )}
              </div>
              {selectedItem ? (
                <StatusBadge tone={selectedWorkflowStatus.tone}>
                  {selectedWorkflowStatus.label}
                </StatusBadge>
              ) : null}
            </div>
          </header>
          {/* One column, in the order the work happens: the resume level and
              the one next action, then the resume once it exists, then the
              job facts. */}
          <div
            className="grid min-h-0 min-w-0 flex-1 content-start gap-4 overflow-x-hidden overflow-y-auto pb-6"
            data-locked-pane-scroll-region
            data-testid="review-queue-workspace-column"
            id={workspacePanelId}
          >
            {selectedItem ? (
              <ReviewQueueMissionPanel
                actionMessage={scopedActionMessage}
                applicationAutomationMode={applicationAutomationMode}
                applicationRecords={applicationRecords}
                browserSession={browserSession}
                pendingElapsedSeconds={pendingElapsedSeconds}
                globalDailyApplicationPreparationCapacity={
                  globalDailyApplicationPreparationCapacity
                }
                applyJobResults={applyJobResults ?? []}
                isApplyPending={isApplyPending}
                isJobPending={isJobPending}
                isSelectedJobPendingTooLong={selectedJobPendingTooLong}
                onStartApplyCopilot={onStartApplyCopilot}
                onEditResumeWorkspace={onEditResumeWorkspace}
                {...(onApproveResumeAndApply
                  ? { onApproveResumeAndApply }
                  : {})}
                onGenerateResume={onGenerateResume}
                onOpenBrowserSession={onOpenBrowserSession}
                onOpenJobDetails={onOpenJobDetails}
                onOpenApplication={onOpenApplication ?? (() => undefined)}
                onOpenProfile={onOpenProfile}
                {...(onOpenSafeguards ? { onOpenSafeguards } : {})}
                safeguardBlocker={safeguardBlocker ?? null}
                {...(onClaimResumeIdentity ? { onClaimResumeIdentity } : {})}
                {...(onKeepResumeIdentity ? { onKeepResumeIdentity } : {})}
                onRemoveReviewJob={onRemoveReviewJob}
                onSetJobResumeApplicationMode={onSetJobResumeApplicationMode}
                originalResume={originalResume}
                {...(profile ? { profile } : {})}
                selectedAsset={selectedAsset}
                selectedItem={selectedItem}
                selectedJob={selectedJob}
              />
            ) : null}
            {selectedItem && (selectedAsset || previewState === "missing") ? (
              // The resume appears in place once one exists.
              <ReviewQueuePreviewPanel
                pendingElapsedSeconds={pendingElapsedSeconds}
                embedded
                isGenerating={selectedJobPending}
                isPendingTooLong={selectedJobPendingTooLong}
                onEditResumeWorkspace={onEditResumeWorkspace}
                onGenerateResume={onGenerateResume}
                originalResume={originalResume}
                preparedJobIds={preparedJobIds}
                applicationPreparingJobIds={applicationPreparingJobIds}
                previewState={previewState}
                queue={queue}
                selectedAsset={selectedAsset}
                selectedItem={selectedItem}
                selectedJob={selectedJob}
                stacked
              />
            ) : null}
            {selectedJob && selectedItem ? (
              <div className="min-w-0 px-6 pt-2">
                {/* Every level down to the listing text resets its minimum
                    width, and the text may break inside a word: a listing
                    with one long unbroken token otherwise sets the column's
                    minimum content width and pushes the whole column past
                    the pane's right edge. */}
                <div className="grid min-w-0 max-w-3xl gap-6">
                  <section className="grid min-w-0 gap-2 border-t border-(--surface-panel-border) pt-5">
                    <span className="label-mono-xs text-foreground-muted">
                      About this job
                    </span>
                    {/* An echoed title under a heading looks like a bug; the
                        listing text only appears when it is real text. */}
                    {selectedJobSummaryText ? (
                      <p className="min-w-0 wrap-anywhere whitespace-pre-line text-(length:--text-body) leading-7 text-foreground-soft">
                        {selectedJobSummaryText}
                      </p>
                    ) : (
                      <p className="text-(length:--text-small) leading-6 text-foreground-soft">
                        The listing text was not captured. Open the full job
                        details to read it.
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <strong
                        aria-label={
                          selectedJobAssessment?.headlineScoreAriaLabel
                        }
                        className="text-(length:--text-body) text-(--text-headline)"
                        data-testid="review-queue-fit-score"
                      >
                        {selectedJobAssessment?.headlineScoreLabel}
                      </strong>
                      <span className="min-w-0 text-(length:--text-small) leading-6 text-foreground-soft">
                        {selectedJobAssessment?.withheldReason ??
                          selectedJobFitReasons[0] ??
                          "Estimated from the listing and your approved profile."}
                      </span>
                    </div>
                    <Button
                      className="mt-1 w-fit"
                      onClick={() => onOpenJobDetails(selectedItem.jobId)}
                      type="button"
                      variant="secondary"
                    >
                      Open full job details
                    </Button>
                  </section>
                  <details className="min-w-0 rounded-(--radius-field) border border-(--surface-panel-border)">
                    <summary className="cursor-pointer px-4 py-3 text-(length:--text-small) font-medium text-foreground-soft">
                      How this was scored
                    </summary>
                    <div className="px-4 pb-4">
                      <MatchEvidenceMatrix
                        assessment={selectedJob.matchAssessment}
                        listingCapture={
                          selectedJob.listingDetailCapture?.state ?? null
                        }
                        scoreLabel={
                          selectedJobAssessment?.breakdownScoreLabel ?? null
                        }
                      />
                    </div>
                  </details>
                </div>
              </div>
            ) : null}
            {!selectedItem ? (
              <div className="grid place-items-center p-8">
                <EmptyState
                  description="Select a shortlisted job to get its resume ready and apply."
                  title="Choose a job"
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </LockedScreenLayout>
  );
}
