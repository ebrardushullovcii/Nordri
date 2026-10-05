import type { ReviewQueueItem, TailoredAsset } from "@nordri/contracts";
import { Button } from "@renderer/components/ui";
import { cn } from "@renderer/lib/cn";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CollectionPagination,
  COLLECTION_PAGE_SIZE,
} from "../../components/collection-pagination";
import {
  CollectionNoMatches,
  CollectionSearchToolbar,
  matchesCollectionSearch,
} from "../../components/collection-search-toolbar";
import { EmptyState } from "../../components/empty-state";
import { formatJobEmployerLocationLine } from "../../lib/job-employer-location-display";
import { jobFinderListRegionClassName } from "../../components/list-row";
import { usePersistedCollectionView } from "../../hooks/use-persisted-collection-view";
import { useStableCallback } from "../../hooks/use-stable-callback";
import { ReviewQueueRow } from "./review-queue-list-row";
import { useAssistantContextSource } from "../../assistant/assistant-provider";
import { buildListContext } from "../../assistant/assistant-context-capture";
import { stripInternalCodeParenthetical } from "./review-queue-mission-panel-helpers";
import {
  focusCollectionItem,
  getAdjacentCollectionItemId,
} from "../../lib/collection-keyboard-navigation";
import { Link } from "react-router-dom";
import { buildJobFinderContextRoute } from "../../lib/job-finder-context-navigation";
import {
  APPLICATION_PREPARATION_BATCH_LIMIT,
  countQueueStageReady,
  countTailoredDraftPreparationEligible,
  describeTailoredDraftPreparationBlocker,
  getReviewQueueResumePolicyCaption,
  getReviewQueueWorkflowStatus,
  getTailoredDraftPreparationResultMessage,
  isTailoredDraftPreparationEligible,
  type TailoredDraftPreparationViewState,
} from "./review-queue-status";

interface ReviewQueueListPanelProps {
  campaignId?: string;
  draftPreparation?: TailoredDraftPreparationViewState;
  isJobPending: (jobId: string) => boolean;
  /** Writes missing first resumes for the chosen jobs, or all eligible jobs. */
  onPrepareTailoredDrafts?: (jobIds?: readonly string[]) => void;
  /** Starts the application for every job whose resume is ready. */
  onApplyToAllReady?: (readyCount: number) => void;
  /** What Apply to all does in the mode saved in Settings, in one sentence. */
  applyAllOutcome?: string | null;
  isApplyToAllPending?: boolean;
  applicationBatchLimit?: number;
  onOpenSafeguards?: () => void;
  /** A safeguard holding every application start back, in plain words. */
  safeguardBlocker?: string | null;
  onSelectItem: (jobId: string) => void;
  onStopTailoredDraftPreparation?: () => void;
  /**
   * Jobs whose application is already prepared. They stop counting as ready
   * to apply.
   */
  preparedJobIds?: ReadonlySet<string>;
  applicationPreparingJobIds?: ReadonlySet<string>;
  queue: readonly ReviewQueueItem[];
  selectedItem: ReviewQueueItem | null;
  tailoredAssets?: readonly TailoredAsset[] | undefined;
}

export function ReviewQueueListPanel({
  campaignId = "",
  draftPreparation = {
    attemptedCount: 0,
    completedCount: 0,
    currentIndex: null,
    eligibleRemainingCount: 0,
    failedCount: 0,
    status: "idle",
    totalCount: 0,
  },
  isJobPending,
  onPrepareTailoredDrafts = () => undefined,
  onApplyToAllReady,
  applyAllOutcome = null,
  isApplyToAllPending = false,
  applicationBatchLimit = APPLICATION_PREPARATION_BATCH_LIMIT,
  onOpenSafeguards,
  safeguardBlocker = null,
  onSelectItem,
  onStopTailoredDraftPreparation = () => undefined,
  preparedJobIds,
  applicationPreparingJobIds,
  queue,
  selectedItem,
  tailoredAssets,
}: ReviewQueueListPanelProps) {
  const view = usePersistedCollectionView("shortlisted", "comfortable");
  const deferredQuery = useDeferredValue(view.query);
  // Per-job asset evidence lets legacy failed-without-detail restored rows
  // resolve to the same review-pending status as the selected detail panels.
  const assetsByJobId = useMemo(
    () => new Map((tailoredAssets ?? []).map((asset) => [asset.jobId, asset])),
    [tailoredAssets],
  );
  const visibleQueue = useMemo(
    () =>
      queue.filter((item) =>
        matchesCollectionSearch(deferredQuery, [
          item.title,
          item.company,
          item.location,
          item.resumeApplicationMode,
          getReviewQueueWorkflowStatus(
            item,
            assetsByJobId.get(item.jobId),
            false,
            preparedJobIds,
            applicationPreparingJobIds,
          ).label,
        ]),
      ),
    [
      applicationPreparingJobIds,
      assetsByJobId,
      deferredQuery,
      preparedJobIds,
      queue,
    ],
  );
  const [queuePage, setQueuePage] = useState(1);
  const choosingResumeIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const queueListRegionRef = useRef<HTMLDivElement | null>(null);
  const queuePageCount = Math.max(
    1,
    Math.ceil(visibleQueue.length / COLLECTION_PAGE_SIZE),
  );
  const currentQueuePage = Math.min(queuePage, queuePageCount);
  const selectedQueueIndex = useMemo(
    () =>
      selectedItem
        ? visibleQueue.findIndex((item) => item.jobId === selectedItem.jobId)
        : -1,
    [selectedItem, visibleQueue],
  );
  useEffect(() => {
    setQueuePage(1);
  }, [deferredQuery]);
  useEffect(() => {
    setQueuePage((currentPage) => Math.min(currentPage, queuePageCount));
  }, [queuePageCount]);
  useEffect(() => {
    if (selectedQueueIndex < 0) return;
    setQueuePage(Math.floor(selectedQueueIndex / COLLECTION_PAGE_SIZE) + 1);
  }, [selectedQueueIndex]);
  useEffect(() => {
    if (!pendingFocusId) return;
    // Scoped to this panel's scroll region so the deferred frame can never
    // land focus in another surface's rows.
    focusCollectionItem(pendingFocusId, {
      region: queueListRegionRef.current,
    });
    setPendingFocusId(null);
  }, [currentQueuePage, pendingFocusId]);
  const pagedVisibleQueue = useMemo(
    () =>
      visibleQueue.slice(
        (currentQueuePage - 1) * COLLECTION_PAGE_SIZE,
        currentQueuePage * COLLECTION_PAGE_SIZE,
      ),
    [currentQueuePage, visibleQueue],
  );
  // The shortlist for the assistant (ADR 0037): jobs ticked under "Choose
  // jobs" are the selection; the open job is focus, published by the screen.
  useAssistantContextSource(
    "shortlist-list",
    () => ({
      list: buildListContext({
        listKind: "shortlist",
        checkedIds: choosingResumeIdsRef.current,
        displayedIds: pagedVisibleQueue.map((item) => item.jobId),
        filteredIds: visibleQueue.map((item) => item.jobId),
        filterSummary: deferredQuery.trim()
          ? `matching "${deferredQuery.trim()}"`
          : null,
      }),
    }),
    { priority: 1 },
  );
  const unavailableApplicationJobIds = useMemo(
    () =>
      new Set([
        ...(preparedJobIds ?? []),
        ...(applicationPreparingJobIds ?? []),
      ]),
    [applicationPreparingJobIds, preparedJobIds],
  );
  // One population, read once: both numbers on the "for all jobs" row come
  // off the same queue plus the same prepared-job set the application
  // records give.
  const draftEligibleCount = useMemo(
    () =>
      countTailoredDraftPreparationEligible(
        queue,
        unavailableApplicationJobIds,
      ),
    [queue, unavailableApplicationJobIds],
  );
  const [resumeSelection, setResumeSelection] = useState<{
    campaignId: string;
    jobIds: readonly string[];
  } | null>(null);
  const choosingResumes = resumeSelection?.campaignId === campaignId;
  const eligibleResumeIds = new Set(
    queue
      .filter(
        (item) =>
          isTailoredDraftPreparationEligible(
            item,
            unavailableApplicationJobIds,
          ) && !isJobPending(item.jobId),
      )
      .map((item) => item.jobId),
  );
  const selectedResumeIds = new Set(
    choosingResumes
      ? resumeSelection.jobIds.filter((id) => eligibleResumeIds.has(id))
      : [],
  );
  choosingResumeIdsRef.current = selectedResumeIds;
  const toggleResume = useStableCallback((jobId: string) => {
    if (!eligibleResumeIds.has(jobId)) return;
    const next = new Set(selectedResumeIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setResumeSelection({ campaignId, jobIds: [...next] });
  });
  const totalReadyToApplyCount = useMemo(
    () =>
      countQueueStageReady(
        queue.filter((item) => !isJobPending(item.jobId)),
        unavailableApplicationJobIds,
      ),
    [isJobPending, queue, unavailableApplicationJobIds],
  );
  const readyToApplyCount = Math.min(
    totalReadyToApplyCount,
    applicationBatchLimit,
  );
  const safeguardBlockerSentence = safeguardBlocker?.trim()
    ? stripInternalCodeParenthetical(safeguardBlocker)
    : null;
  const draftPreparationBlocker = useMemo(
    () =>
      describeTailoredDraftPreparationBlocker(
        queue,
        unavailableApplicationJobIds,
      ),
    [queue, unavailableApplicationJobIds],
  );
  const isDraftPreparationRunning = draftPreparation.status === "running";
  const draftPreparationResultMessage =
    getTailoredDraftPreparationResultMessage(draftPreparation);
  const draftRunCount = draftEligibleCount;
  // The three row handlers keep one identity for the life of the panel. Each
  // closes over the queue, so a `useCallback` on it would be rebuilt whenever
  // any job changed and every row would re-render with it — which is exactly
  // what memoising the rows is meant to stop.
  const handleListKeyDown = useStableCallback(
    (event: KeyboardEvent<HTMLButtonElement>, jobId: string) => {
      const nextId = getAdjacentCollectionItemId(
        visibleQueue.map((item) => item.jobId),
        jobId,
        event.key,
      );
      if (!nextId) return;
      event.preventDefault();
      const nextIndex = visibleQueue.findIndex((item) => item.jobId === nextId);
      const nextPage = Math.floor(nextIndex / COLLECTION_PAGE_SIZE) + 1;
      if (nextPage !== currentQueuePage) {
        setQueuePage(nextPage);
      }
      onSelectItem(nextId);
      setPendingFocusId(nextId);
    },
  );
  const selectItem = useStableCallback((jobId: string) => {
    onSelectItem(jobId);
  });
  // The "for all jobs" row appears only when it can do something: two or
  // more jobs, and at least one of them needs a resume or is ready to apply.
  const showsAllJobsRow =
    (queue.length > 1 || choosingResumes || isDraftPreparationRunning) &&
    (choosingResumes ||
      isDraftPreparationRunning ||
      draftEligibleCount > 0 ||
      readyToApplyCount > 0 ||
      draftPreparationResultMessage !== null);

  return (
    <section className="surface-panel-shell relative flex min-w-0 flex-col overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border) xl:h-full xl:min-h-0">
      {/* A search field, a density switch and named views are list
          management for a list that usually holds one to eight rows. Only the
          search survives, and only once there is more than one row to search.
          The page title already names the list, so no label row sits above
          it (ADR 0044). */}
      {queue.length > 1 ? (
        <CollectionSearchToolbar
          compact
          placement="panel"
          label="Find a shortlisted job"
          onQueryChange={view.setQuery}
          placeholder="Search jobs"
          query={view.query}
          totalCount={queue.length}
          visibleCount={visibleQueue.length}
        />
      ) : null}
      {showsAllJobsRow ? (
        <div
          className="mx-5 grid gap-2 border-b border-(--surface-panel-border) py-3"
          data-testid="shortlisted-all-jobs"
        >
          <div className="flex flex-wrap items-center gap-2">
            {isDraftPreparationRunning ? (
              <>
                <p
                  aria-live="polite"
                  className="m-0 text-sm text-primary"
                  role="status"
                >
                  {draftPreparation.stopRequested
                    ? "Stopping · finishing the resumes already started · "
                    : "Writing resumes · "}
                  {draftPreparation.completedCount +
                    draftPreparation.failedCount}{" "}
                  of {draftPreparation.totalCount} finished
                </p>
                {draftPreparation.stopRequested ? null : (
                  <Button
                    className="h-8 px-2.5 text-xs font-medium tracking-normal normal-case"
                    onClick={onStopTailoredDraftPreparation}
                    size="compact"
                    type="button"
                    variant="ghost"
                  >
                    Stop new resumes
                  </Button>
                )}
              </>
            ) : choosingResumes ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={selectedResumeIds.size === 0}
                  onClick={() => {
                    onPrepareTailoredDrafts([...selectedResumeIds]);
                    setResumeSelection(null);
                  }}
                >
                  Create {selectedResumeIds.size}{" "}
                  {selectedResumeIds.size === 1 ? "resume" : "resumes"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setResumeSelection(null)}
                >
                  Cancel selection
                </Button>
              </>
            ) : (
              <>
                {visibleQueue.length < queue.length ? (
                  <p
                    className="text-xs text-foreground-muted"
                    data-testid="shortlist-bulk-filter-scope"
                  >
                    Bulk actions use this plan’s full shortlist of{" "}
                    {queue.length} jobs, including{" "}
                    {queue.length - visibleQueue.length} hidden by this filter.
                  </p>
                ) : null}
                {draftEligibleCount > 0 ? (
                  <Button
                    className="whitespace-normal text-sm font-medium normal-case tracking-normal"
                    data-testid="create-missing-resumes"
                    disabled={draftPreparationBlocker !== null}
                    onClick={() => onPrepareTailoredDrafts()}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {draftRunCount === 1
                      ? "Create the missing resume"
                      : `Create ${draftRunCount} missing resumes`}
                  </Button>
                ) : null}
                {draftEligibleCount > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setResumeSelection({ campaignId, jobIds: [] })
                    }
                  >
                    Choose jobs
                  </Button>
                ) : null}
                {totalReadyToApplyCount > readyToApplyCount ? (
                  <p className="text-sm text-foreground-soft">
                    {totalReadyToApplyCount} ready jobs. Up to{" "}
                    {applicationBatchLimit} start at a time;{" "}
                    {totalReadyToApplyCount - readyToApplyCount} remain after
                    this batch.
                  </p>
                ) : null}
                {readyToApplyCount > 0 && onApplyToAllReady ? (
                  safeguardBlockerSentence ? (
                    <Button
                      className="whitespace-normal text-sm font-medium normal-case tracking-normal"
                      data-testid="apply-all-safeguards"
                      onClick={() => onOpenSafeguards?.()}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Open Safeguards
                    </Button>
                  ) : (
                    <Button
                      className="whitespace-normal text-sm font-medium normal-case tracking-normal"
                      data-testid="apply-all-ready"
                      disabled={isApplyToAllPending}
                      onClick={() => onApplyToAllReady(readyToApplyCount)}
                      pending={isApplyToAllPending}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {readyToApplyCount === 1
                        ? "Apply to the 1 ready job"
                        : totalReadyToApplyCount > readyToApplyCount
                          ? `Apply to next ${readyToApplyCount} ready jobs`
                          : `Apply to all ${readyToApplyCount} ready jobs`}
                    </Button>
                  )
                ) : null}
              </>
            )}
          </div>
          {isDraftPreparationRunning ? (
            <p className="m-0 text-xs text-foreground-muted">
              Up to two at once. Stopping lets resumes already being written
              finish.
            </p>
          ) : choosingResumes ? (
            <p className="m-0 text-xs text-foreground-muted">
              {selectedResumeIds.size} selected. Select the jobs you want.
              Existing resumes are kept.
            </p>
          ) : draftEligibleCount > 0 ? (
            <p className="m-0 text-xs text-foreground-muted">
              Up to two at once. Stop any time; finished resumes are kept.
            </p>
          ) : null}
          {!isDraftPreparationRunning &&
          !choosingResumes &&
          !safeguardBlockerSentence &&
          readyToApplyCount > 0 &&
          onApplyToAllReady &&
          applyAllOutcome ? (
            <p
              className="m-0 text-xs text-foreground-muted"
              data-testid="apply-all-outcome"
            >
              {applyAllOutcome}
            </p>
          ) : null}
          {!choosingResumes &&
          safeguardBlockerSentence &&
          readyToApplyCount > 0 ? (
            <p
              className="m-0 text-xs text-foreground-muted"
              data-testid="apply-all-blocker"
            >
              {safeguardBlockerSentence}
            </p>
          ) : null}
          {draftPreparationResultMessage && !isDraftPreparationRunning ? (
            <p
              aria-live="polite"
              className="m-0 min-w-0 text-xs text-primary"
              role="status"
            >
              {draftPreparationResultMessage}
            </p>
          ) : null}
        </div>
      ) : null}
      {queue.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-5 pt-4">
          <div className="grid w-full max-w-136 justify-items-center gap-4">
            <EmptyState
              title="No shortlisted jobs in this plan"
              description="Shortlist a job from Find jobs. It shows up here, ready for a resume and an application."
            />
            <Button asChild size="lg">
              <Link
                to={buildJobFinderContextRoute("/job-finder/discovery", {})}
              >
                Go to Find jobs
              </Link>
            </Button>
          </div>
        </div>
      ) : visibleQueue.length === 0 ? (
        <CollectionNoMatches
          noun="shortlisted jobs"
          onClear={() => view.setQuery("")}
          query={view.query}
        />
      ) : (
        <div
          className={cn(
            jobFinderListRegionClassName,
            "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          )}
          data-locked-pane-scroll-region
          ref={queueListRegionRef}
        >
          {pagedVisibleQueue.map((item) => {
            // Every value the row renders is derived here and handed over as a
            // string or a boolean, so a step that changes one job's status
            // leaves the other rows' props identical and they skip the render.
            const isPending = isJobPending(item.jobId);
            const workflowStatus = getReviewQueueWorkflowStatus(
              item,
              assetsByJobId.get(item.jobId),
              isPending,
              preparedJobIds,
              applicationPreparingJobIds,
            );

            return (
              <ReviewQueueRow
                employerLocationLine={formatJobEmployerLocationLine({
                  company: item.company,
                  location: item.location,
                  separator: " • ",
                })}
                choosingResumes={choosingResumes && !isDraftPreparationRunning}
                resumeSelected={selectedResumeIds.has(item.jobId)}
                resumeSelectionDisabled={!eligibleResumeIds.has(item.jobId)}
                onToggleResume={toggleResume}
                jobId={item.jobId}
                key={item.jobId}
                onSelect={selectItem}
                onSelectionKeyDown={handleListKeyDown}
                resumePolicyCaption={
                  // While this job's resume is being (re)written the row's
                  // status already says so; the caption must not still read
                  // "Resume ready — Apply approves it" for the old text.
                  workflowStatus.label === "Writing resume"
                    ? "Writing the resume…"
                    : getReviewQueueResumePolicyCaption(
                        item,
                        assetsByJobId.get(item.jobId),
                      )
                }
                selected={selectedItem?.jobId === item.jobId}
                showProgress={workflowStatus.label === "Writing resume"}
                statusLabel={
                  item.listingAssessmentPending
                    ? "Assessing listing"
                    : workflowStatus.label
                }
                statusTone={workflowStatus.tone}
                title={item.title}
              />
            );
          })}
        </div>
      )}
      {queue.length > 0 && visibleQueue.length > 0 ? (
        <CollectionPagination
          itemLabel="shortlisted jobs"
          onPageChange={setQueuePage}
          page={currentQueuePage}
          pageSize={COLLECTION_PAGE_SIZE}
          totalCount={visibleQueue.length}
        />
      ) : null}
    </section>
  );
}
