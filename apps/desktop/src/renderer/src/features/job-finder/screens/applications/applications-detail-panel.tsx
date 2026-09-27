import { inferApplicationCrmStageForView } from "./applications-crm-model";
import { useMemo } from "react";
import type {
  ApplicationAttempt,
  ApplicationRecord,
  ApplyRunDetails,
  ClearApplicationAnswerCommandInput,
  GlobalDailyApplicationPreparationCapacity,
  JobFinderWorkspaceSnapshot,
  SaveApplicationAnswerCommandInput,
  JobFinderApplyConsentActionInput,
  JobFinderApplyRunActionInput,
  JobFinderApplyRunDetailsQuery,
  JobFinderExactApplicationTarget,
  UserActionCommandInput,
  UserActionRequest,
} from "@unemployed/contracts";
import type { ApplicationAnswerStep } from "./applications-answer-step";
import { Mic } from "lucide-react";
import { Button } from "@renderer/components/ui";
import { StatusBadge } from "../../components/status-badge";
import { ApplicationsDetailPanelActivitySections } from "./applications-detail-panel-activity-sections";
import { getApplicationApplyPresentation } from "./applications-apply-state";
import { resolveApplyStatePresentation } from "./apply-state";
import type { ApplyRunContext } from "./applications-recovery-state";
import type { ApplyMode } from "../../lib/apply-mode-contracts-stub";
import { ApplicationsApplicationDocuments } from "./applications-application-documents";
import { ApplicationsDetailPanelEmptyState } from "./applications-detail-panel-empty-state";
import { ApplicationsDetailFactStrip } from "./applications-detail-fact-strip";
import {
  buildQueueEntries,
  applicationNeedsPrimaryRecovery,
  findActionableApplicationAnswerRequest,
} from "./applications-detail-panel-helpers";
import { ApplicationsDetailPanelOverviewSections } from "./applications-detail-panel-overview-sections";
import type {
  ConfirmFinishedInBrowserStatus,
  FinishInBrowserHandler,
  FinishInBrowserInput,
} from "./applications-detail-panel-recovery-actions-section";
import { ApplicationsDetailPanelRecoverySections } from "./applications-detail-panel-recovery-sections";
import {
  ApplicationsDetailPanelSubmitApprovalSection,
  isAwaitingPreparationApproval,
  preparationApprovalActionLabel,
} from "./applications-detail-panel-submit-approval-section";
import { type ApplicationsViewFilter } from "./applications-filters";
import {
  getApplicationStagePresentation,
  listPendingApplicationQuestions,
} from "./applications-status";
import { formatApplicationEmployerLine } from "../../lib/job-employer-location-display";

function buildInterviewHelperApplicationHref(input: {
  record: ApplicationRecord;
  relatedJob: JobFinderWorkspaceSnapshot["discoveryJobs"][number] | null;
}) {
  const { record, relatedJob } = input;
  const employerLine = formatApplicationEmployerLine({
    company: record.company,
    ...(relatedJob?.canonicalUrl
      ? { canonicalUrl: relatedJob.canonicalUrl }
      : {}),
  });
  const notes = [
    record.nextActionLabel ? `Next step: ${record.nextActionLabel}` : null,
    record.lastActionLabel
      ? `Latest application activity: ${record.lastActionLabel}`
      : null,
    relatedJob?.summary ? `Job summary: ${relatedJob.summary}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  const params = new URLSearchParams({
    source: "job_application",
    id: record.id,
    label: employerLine ? `${record.title} at ${employerLine}` : record.title,
    role: record.title,
    company: employerLine ?? "",
    sourceUrl: relatedJob?.canonicalUrl ?? "",
    notes:
      notes.join("\n\n") ||
      (employerLine
        ? `Application record for ${record.title} at ${employerLine}.`
        : `Application record for ${record.title}.`),
  });

  return `/interview-helper?${params.toString()}`;
}

interface ApplicationsDetailPanelProps {
  activeFilter: ApplicationsViewFilter;
  /** What each result's run is doing, so a planned job is never "Filling in". */
  readApplyRunContext?: (
    result: JobFinderWorkspaceSnapshot["applyJobResults"][number] | null,
  ) => ApplyRunContext | null;
  applyRunDetails: ApplyRunDetails | null;
  applyRunDetailsTarget: {
    applicationRecordId: string;
    jobId: string;
    runId: string;
  } | null;
  applyRunDetailsError: string | null;
  applyRunDetailsStatus: "idle" | "loading" | "ready" | "error";
  applicationAttempts?: readonly ApplicationAttempt[];
  applicationRecords: readonly ApplicationRecord[];
  applyJobResults: JobFinderWorkspaceSnapshot["applyJobResults"];
  dailyPreparationCapacity: GlobalDailyApplicationPreparationCapacity | null;
  discoveryJobs: JobFinderWorkspaceSnapshot["discoveryJobs"];
  applyRunHistory: Array<{
    result: JobFinderWorkspaceSnapshot["applyJobResults"][number];
    run: JobFinderWorkspaceSnapshot["applyRuns"][number] | null;
  }>;
  effectiveSelectedApplyResult:
    | JobFinderWorkspaceSnapshot["applyJobResults"][number]
    | null;
  hasAnyApplications: boolean;
  hasVisibleApplications: boolean;
  isApplyPending: boolean;
  isApplyRequestPending: (requestId: string) => boolean;
  isApplyRunPending: (runId: string) => boolean;
  onApproveApplyRun: (input: JobFinderApplyRunActionInput) => void;
  onCancelApplyRun: (input: JobFinderApplyRunActionInput) => void;
  onOpenCompany?: (companyId: string) => void;
  onExportApplicationPacket: (
    input: JobFinderApplyRunDetailsQuery,
  ) => Promise<void>;
  onResolveSubmissionOutcome?: (
    uncertainOutcomeId: string,
    resolution: "submitted" | "not_submitted",
  ) => Promise<void>;
  /** Sends an application the person chose to look over first. */
  onSubmitPreparedApplication?: (jobId: string) => Promise<void>;
  /** Prepares the application again when its page is no longer open. */
  onPrepareApplicationAgain?: (jobId: string) => Promise<void>;
  onSaveApplicationAnswer: (
    command: SaveApplicationAnswerCommandInput,
  ) => Promise<void>;
  onClearApplicationAnswer: (
    command: ClearApplicationAnswerCommandInput,
  ) => Promise<void>;
  onResolveApplyConsentRequest: (
    input: JobFinderApplyConsentActionInput,
  ) => void;
  onRevokeApplyRunApproval: (input: JobFinderApplyRunActionInput) => void;
  onSelectApplyRun: (runId: string) => void;
  onStartApplyCopilot: (input: JobFinderExactApplicationTarget) => void;
  onStartAutoApplyQueue: (jobIds: string[]) => void;
  /** The mode chosen in Settings; decides what a finished fill means. */
  applyMode?: ApplyMode;
  onOpenSafeguards?: () => void;
  onOpenNeedsYou?: () => void;
  /** Open requests, so the question step can be answered on this panel. */
  userActionRequests?: readonly UserActionRequest[];
  onPerformUserAction?: (
    command: UserActionCommandInput,
  ) => void | Promise<void>;
  isUserActionPending?: (requestId: string) => boolean;
  onAllowSiteSaves?: (host: string | null) => void;
  /**
   * Pass-through only. The declared return type has to match the leaf's, or
   * the outcome the leaf uses to decide what the hand-off status claims would
   * be under-reported at every intermediate hop.
   */
  onFinishInBrowser?: FinishInBrowserHandler;
  onConfirmFinishedInBrowser?: (input: FinishInBrowserInput) => void;
  canConfirmFinishedInBrowser?: boolean;
  browserStepContinuesOnItsOwn?: boolean;
  confirmFinishedInBrowserStatus?: ConfirmFinishedInBrowserStatus;
  confirmFinishedInBrowserBlockerText?: string | null;
  selectedApplyRunId: string | null;
  selectedAttempt: ApplicationAttempt | null;
  selectedRecord: ApplicationRecord | null;
  selectedRecordCompanyId?: string | null;
}

export function ApplicationsDetailPanel({
  activeFilter,
  readApplyRunContext,
  applyRunDetails,
  applyRunDetailsTarget,
  applyRunDetailsError,
  applyRunDetailsStatus,
  applicationAttempts = [],
  applicationRecords,
  applyJobResults,
  dailyPreparationCapacity,
  discoveryJobs,
  applyRunHistory,
  effectiveSelectedApplyResult,
  hasAnyApplications,
  hasVisibleApplications,
  isApplyPending,
  isApplyRequestPending,
  isApplyRunPending,
  onApproveApplyRun,
  onOpenCompany,
  onExportApplicationPacket,
  onResolveSubmissionOutcome,
  onSaveApplicationAnswer,
  onClearApplicationAnswer,
  onResolveApplyConsentRequest,
  onSelectApplyRun,
  onStartApplyCopilot,
  onStartAutoApplyQueue,
  onOpenSafeguards,
  onOpenNeedsYou,
  userActionRequests,
  onPerformUserAction,
  isUserActionPending,
  onAllowSiteSaves,
  onFinishInBrowser,
  onConfirmFinishedInBrowser,
  canConfirmFinishedInBrowser,
  browserStepContinuesOnItsOwn,
  confirmFinishedInBrowserStatus,
  confirmFinishedInBrowserBlockerText,
  selectedApplyRunId,
  selectedAttempt,
  selectedRecord,
  selectedRecordCompanyId,
  onSubmitPreparedApplication,
  onPrepareApplicationAgain,
}: ApplicationsDetailPanelProps) {
  const visibleApplyResult = effectiveSelectedApplyResult;
  const pendingQuestions = selectedRecord
    ? listPendingApplicationQuestions({
        applicationAttempts,
        applicationRecordId: selectedRecord.id,
        jobId: selectedRecord.jobId,
      })
    : [];
  const pendingQuestionCount = pendingQuestions.length;
  const answerRun = effectiveSelectedApplyResult
    ? (applyRunHistory.find(
        ({ result }) => result.runId === effectiveSelectedApplyResult.runId,
      )?.run ?? null)
    : null;
  // The question step for this application, answerable right here.
  const answerRequest =
    selectedRecord && onPerformUserAction
      ? findActionableApplicationAnswerRequest({
          applicationRecordId: selectedRecord.id,
          jobId: selectedRecord.jobId,
          requests: userActionRequests,
          run: answerRun,
        })
      : null;
  const answerStep: ApplicationAnswerStep | null =
    answerRequest && onPerformUserAction && pendingQuestions.length > 0
      ? {
          request: answerRequest,
          questions: pendingQuestions,
          isPending: isUserActionPending?.(answerRequest.id) ?? false,
          onCommand: onPerformUserAction,
        }
      : null;
  // Where this application stands, in the one vocabulary the screen uses.
  const applyPresentation = selectedRecord
    ? getApplicationApplyPresentation({
        record: selectedRecord,
        applyResult: effectiveSelectedApplyResult,
      })
    : null;
  const canRestageAutoRun =
    selectedRecord?.status === "approved" ||
    selectedRecord?.status === "ready_for_review";
  const selectedRunHistoryEntry = useMemo(
    () =>
      applyRunHistory.find(
        ({ result }) => result.runId === selectedApplyRunId,
      ) ?? null,
    [applyRunHistory, selectedApplyRunId],
  );
  const selectedApplyRunDetails = useMemo(
    () =>
      applyRunDetailsStatus === "ready" &&
      selectedRecord != null &&
      applyRunDetailsTarget?.jobId === selectedRecord.jobId &&
      applyRunDetailsTarget.applicationRecordId === selectedRecord.id &&
      applyRunDetailsTarget.runId === selectedApplyRunId &&
      applyRunDetails?.run?.id === selectedApplyRunId
        ? applyRunDetails
        : null,
    [
      applyRunDetails,
      applyRunDetailsStatus,
      applyRunDetailsTarget,
      selectedApplyRunId,
      selectedRecord,
    ],
  );
  const selectedRun = selectedApplyRunDetails
    ? selectedApplyRunDetails.run
    : (selectedRunHistoryEntry?.run ?? null);
  const visibleApplyRunId =
    selectedApplyRunDetails?.run.id ?? visibleApplyResult?.runId ?? null;
  const selectedQueueEntries = useMemo(
    () =>
      buildQueueEntries({
        applicationRecords,
        applyJobResults,
        discoveryJobs,
        selectedRun,
      }),
    [applicationRecords, applyJobResults, discoveryJobs, selectedRun],
  );
  const selectedQueueRecoveryEntries = selectedQueueEntries.filter(
    (entry) => entry.includeInRecovery,
  );
  const selectedQueueRecoveryJobIds = selectedQueueRecoveryEntries.map(
    (entry) => entry.jobId,
  );
  const excludedQueueRecoveryEntries = selectedQueueEntries.filter(
    (entry) => !entry.includeInRecovery,
  );
  const canRestageQueueRun =
    selectedRun?.mode === "queue_auto" &&
    selectedQueueRecoveryJobIds.length > 0;
  // The same five words the row uses (ADR 0022), read from the newest run;
  // the older stage words only for a record no run has touched yet.
  const selectedApplyState =
    selectedRecord && visibleApplyResult
      ? resolveApplyStatePresentation({
          mode:
            selectedRecord.automationMode === "autonomous_submit"
              ? "apply_for_me"
              : "fill_only",
          result: visibleApplyResult,
          run: readApplyRunContext?.(visibleApplyResult) ?? null,
          pendingQuestionCount:
            selectedRecord.questionSummary.total -
            selectedRecord.questionSummary.answered,
          recordFailure:
            selectedRecord.lastAttemptState === "failed"
              ? {
                  lastActionLabel: selectedRecord.lastActionLabel,
                  lastUpdatedAt: selectedRecord.lastUpdatedAt,
                }
              : null,
        })
      : null;
  const selectedStage = selectedApplyState
    ? {
        label: selectedApplyState.title,
        tone:
          selectedApplyState.kind === "applied"
            ? ("positive" as const)
            : selectedApplyState.kind === "could_not_apply"
              ? ("critical" as const)
              : selectedApplyState.kind === "needs_you"
                ? ("warning" as const)
                : ("active" as const),
      }
    : selectedRecord
      ? getApplicationStagePresentation(selectedRecord)
      : null;
  const selectedRecordJob = selectedRecord
    ? (discoveryJobs.find((job) => job.id === selectedRecord.jobId) ?? null)
    : null;
  // Prepare-only runs never reach a "submitted" status, so the tracker stage
  // the user records by hand is the path that actually enables this.
  const canPrepareInterview = selectedRecord
    ? selectedRecord.lastAttemptState === "submitted" ||
      ["submitted", "assessment", "interview", "offer"].includes(
        selectedRecord.status,
      ) ||
      ["assessment", "interview", "offer"].includes(
        inferApplicationCrmStageForView(selectedRecord),
      )
    : false;
  const needsPrimaryRecovery = selectedRecord
    ? applicationNeedsPrimaryRecovery({
        lastAttemptState: selectedRecord.lastAttemptState,
        visibleApplyResult,
      })
    : false;
  // The one control this panel is asking for cannot be the one the reader has
  // to find. Moving the approval block above the documents was not enough at
  // the panel's smallest height, where it still sat below the fold and was
  // reachable only by tabbing into the pane, so while an approval is pending
  // the action is pinned to the panel's own footer, outside the scroller.
  const awaitingPreparationApproval = isAwaitingPreparationApproval(
    selectedApplyRunDetails,
  );
  const pinnedApproval =
    selectedRecord &&
    awaitingPreparationApproval &&
    selectedApplyRunDetails?.submitApproval
      ? {
          approval: selectedApplyRunDetails.submitApproval,
          record: selectedRecord,
        }
      : null;

  // While the user is being sent to the browser to finish this application,
  // an optional cover-letter block advertised a feature its own copy says to
  // come back for later. It returns once the application is unblocked.
  const documentsSection =
    selectedRecord && !needsPrimaryRecovery ? (
      <ApplicationsApplicationDocuments
        applicationRecord={selectedRecord}
        applyRunDetails={selectedApplyRunDetails}
      />
    ) : null;

  const recoverySection = selectedRecord ? (
    <ApplicationsDetailPanelRecoverySections
      canRestageAutoRun={canRestageAutoRun}
      canRestageQueueRun={canRestageQueueRun}
      dailyPreparationCapacity={dailyPreparationCapacity}
      excludedQueueRecoveryEntries={excludedQueueRecoveryEntries}
      isApplyPending={isApplyPending}
      onStartApplyCopilot={onStartApplyCopilot}
      onStartAutoApplyQueue={onStartAutoApplyQueue}
      {...(onOpenSafeguards ? { onOpenSafeguards } : {})}
      {...(onOpenNeedsYou ? { onOpenNeedsYou } : {})}
      answerStep={answerStep}
      {...(onAllowSiteSaves ? { onAllowSiteSaves } : {})}
      {...(onFinishInBrowser ? { onFinishInBrowser } : {})}
      {...(onConfirmFinishedInBrowser ? { onConfirmFinishedInBrowser } : {})}
      canConfirmFinishedInBrowser={canConfirmFinishedInBrowser ?? false}
      browserStepContinuesOnItsOwn={browserStepContinuesOnItsOwn ?? false}
      confirmFinishedInBrowserStatus={confirmFinishedInBrowserStatus ?? "idle"}
      confirmFinishedInBrowserBlockerText={
        confirmFinishedInBrowserBlockerText ?? null
      }
      selectedQueueOutcomeEntries={selectedQueueEntries}
      selectedQueueRecoveryEntries={selectedQueueRecoveryEntries}
      selectedQueueRecoveryJobIds={selectedQueueRecoveryJobIds}
      // The same selector Needs you renders from, so the two screens can
      // never disagree about how many questions are pending.
      pausedQuestionCount={pendingQuestionCount}
      selectedRecordJobId={selectedRecord.jobId}
      selectedApplicationRecordId={selectedRecord.id}
      selectedRecordLatestBlockerCode={
        selectedRecord.latestBlocker?.code ?? null
      }
      selectedRun={selectedRun}
      visibleApplyRunContext={readApplyRunContext?.(visibleApplyResult) ?? null}
      visibleApplyResult={visibleApplyResult}
    />
  ) : null;

  const selectedRecordEmployerDisplay = selectedRecord
    ? formatApplicationEmployerLine({
        company: selectedRecord.company,
        ...(selectedRecordJob?.canonicalUrl
          ? { canonicalUrl: selectedRecordJob.canonicalUrl }
          : {}),
      })
    : null;

  /**
   * Convenience destinations (Companies, interview prep). Useful, but never
   * the next step — when the application is waiting on the user they render
   * after the recovery actions so the action row is not pushed below the
   * fold at 1024x768.
   */
  // Only a run that actually reached the employer's send control leaves the
  // reader wondering whether something went out.
  const showNotSubmittedPill =
    visibleApplyResult?.privacyReceipt?.submissionOutcome?.outcome ===
    "not_submitted";
  const convenienceLinks = selectedRecord ? (
    <>
      {selectedRecordCompanyId &&
      onOpenCompany &&
      selectedRecordEmployerDisplay ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Reference links, not actions: text links read as "also
              available" rather than as one more thing to do. */}
          <Button
            className="h-auto px-0 text-sm font-medium normal-case tracking-normal"
            onClick={() => onOpenCompany(selectedRecordCompanyId)}
            size="compact"
            type="button"
            variant="link"
          >
            View {selectedRecordEmployerDisplay} in Companies
          </Button>
          {canPrepareInterview ? (
            <Button
              asChild
              className="h-auto px-0 text-sm font-medium normal-case tracking-normal"
              size="compact"
              variant="link"
            >
              <a
                href={`#${buildInterviewHelperApplicationHref({
                  record: selectedRecord,
                  relatedJob: selectedRecordJob,
                })}`}
              >
                <Mic aria-hidden="true" className="size-4" focusable="false" />
                Prepare interview
              </a>
            </Button>
          ) : null}
        </div>
      ) : canPrepareInterview ? (
        <Button
          asChild
          className="h-10 justify-start px-3.5 text-sm font-medium normal-case tracking-normal"
          size="compact"
          variant="secondary"
        >
          <a
            href={`#${buildInterviewHelperApplicationHref({
              record: selectedRecord,
              relatedJob: selectedRecordJob,
            })}`}
          >
            <Mic aria-hidden="true" className="size-4" focusable="false" />
            Prepare interview
          </a>
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <section
      className="@container/detail surface-panel-shell relative flex min-w-0 flex-col gap-6 overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border) px-8 py-5 xl:h-full xl:min-h-0"
      id="applications-detail-content"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          {/* Title first, employer under it: the same order as the row the
              reader just clicked. The "Details" eyebrow said nothing the
              panel did not already show. */}
          {selectedRecord ? (
            <>
              <h2 className="min-w-0 break-words font-semibold tracking-tight text-(--text-headline)">
                {selectedRecord.title}
              </h2>
              {selectedRecordEmployerDisplay ? (
                <span className="text-(length:--text-small) text-foreground-soft">
                  {selectedRecordEmployerDisplay}
                </span>
              ) : null}
            </>
          ) : (
            <strong className="text-(length:--text-body) text-muted-foreground">
              Nothing selected
            </strong>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showNotSubmittedPill ? (
            <StatusBadge
              data-testid="applications-not-submitted-pill"
              tone="muted"
            >
              Not submitted
            </StatusBadge>
          ) : null}
          <StatusBadge tone={selectedStage ? selectedStage.tone : "muted"}>
            {selectedRecord ? selectedStage?.label : "Nothing selected"}
          </StatusBadge>
        </div>
      </div>
      {selectedRecord ? (
        // A scroller that only names one axis still resolves the other to
        // `auto`, so at 1920 this pane drew a horizontal track beside its
        // vertical one and clipped run-history content into two-direction
        // scrolling. The pane scrolls vertically; its content wraps.
        <div
          className="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-x-hidden overflow-y-auto pr-1"
          data-locked-pane-scroll-region
        >
          {/* "Not submitted" used to be a boxed paragraph above a NEXT STEP
              callout above the status block above the fact strip — four
              places for one fact. It is a pill beside the title now, and only
              where a run actually reached a send control and the reader might
              wonder. */}
          {needsPrimaryRecovery ? null : convenienceLinks}
          <ApplicationsDetailPanelOverviewSections
            selectedAttempt={selectedAttempt}
            selectedRecord={selectedRecord}
            visibleApplyResult={visibleApplyResult}
            visibleApplyRunId={visibleApplyRunId}
            plannedStanding={selectedApplyState?.plannedStanding ?? null}
            showFactStrip={!needsPrimaryRecovery}
            waitingOnSafetyLimitReview={
              selectedRun?.state === "paused_for_user_review" &&
              visibleApplyResult?.state === "planned"
            }
          />
          {/* The decision comes before the paperwork. This sat under the
              documents block, where it was not visible without tabbing into
              the panel, so a person who had read everything still could not
              see the one control the screen was asking them to use. */}
          <ApplicationsDetailPanelSubmitApprovalSection
            approvalScopeEntries={selectedQueueEntries.map(
              ({ jobId, label }) => ({ jobId, label }),
            )}
            showApproveAction={!awaitingPreparationApproval}
            isApplyRunPending={isApplyRunPending}
            onApproveApplyRun={onApproveApplyRun}
            selectedApplicationTarget={{
              applicationRecordId: selectedRecord.id,
              jobId: selectedRecord.jobId,
            }}
            selectedApplyRunDetails={selectedApplyRunDetails}
          />
          {/* Where the application stands and what it asks of you come
              first; the optional cover letter follows, never above them. */}
          {recoverySection}
          {needsPrimaryRecovery ? convenienceLinks : null}
          {needsPrimaryRecovery ? (
            <ApplicationsDetailFactStrip
              selectedAttempt={selectedAttempt}
              selectedRecord={selectedRecord}
              visibleApplyResult={visibleApplyResult}
              visibleApplyRunId={visibleApplyRunId}
              plannedStanding={selectedApplyState?.plannedStanding ?? null}
              waitingOnSafetyLimitReview={
                selectedRun?.state === "paused_for_user_review" &&
                visibleApplyResult?.state === "planned"
              }
            />
          ) : null}
          {/* Under Ask before sending, the send card (inside the activity
              sections) is the decision; the optional documents follow it. */}
          {applyPresentation?.state === "awaiting_your_review"
            ? null
            : documentsSection}
          <ApplicationsDetailPanelActivitySections
            applyRunDetailsError={applyRunDetailsError}
            applyRunDetailsStatus={applyRunDetailsStatus}
            applyRunHistory={applyRunHistory}
            isApplyRequestPending={isApplyRequestPending}
            onResolveApplyConsentRequest={onResolveApplyConsentRequest}
            onExportApplicationPacket={onExportApplicationPacket}
            {...(onResolveSubmissionOutcome
              ? { onResolveSubmissionOutcome }
              : {})}
            onSaveApplicationAnswer={onSaveApplicationAnswer}
            onClearApplicationAnswer={onClearApplicationAnswer}
            onSelectApplyRun={onSelectApplyRun}
            {...(onSubmitPreparedApplication
              ? { onSubmitPreparedApplication }
              : {})}
            awaitsYourReview={
              applyPresentation?.state === "awaiting_your_review"
            }
            {...(onPrepareApplicationAgain
              ? { onPrepareApplicationAgain }
              : {})}
            applicationPageClosed={
              selectedRecord?.nextActionLabel === "Prepare again"
            }
            selectedApplyRunDetails={selectedApplyRunDetails}
            selectedApplyRunId={selectedApplyRunId}
            selectedAttempt={selectedAttempt}
            selectedRecord={selectedRecord}
            visibleApplyResult={visibleApplyResult}
          />
          {applyPresentation?.state === "awaiting_your_review"
            ? documentsSection
            : null}
        </div>
      ) : (
        <ApplicationsDetailPanelEmptyState
          activeFilter={activeFilter}
          hasAnyApplications={hasAnyApplications}
          hasVisibleApplications={hasVisibleApplications}
        />
      )}
      {pinnedApproval ? (
        <div
          className="-mx-8 -mb-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-(--surface-panel-border) bg-(--surface-panel) px-8 py-4"
          data-testid="applications-pinned-preparation-approval"
        >
          <p className="text-(length:--text-small) leading-6 text-foreground-soft">
            {pinnedApproval.approval.jobIds.length === 1
              ? "This application is waiting for you to start it."
              : `These ${pinnedApproval.approval.jobIds.length} applications are waiting for you to start them.`}
          </p>
          <Button
            disabled={isApplyRunPending(pinnedApproval.approval.runId)}
            onClick={() =>
              onApproveApplyRun({
                applicationRecordId: pinnedApproval.record.id,
                jobId: pinnedApproval.record.jobId,
                runId: pinnedApproval.approval.runId,
              })
            }
            pending={isApplyRunPending(pinnedApproval.approval.runId)}
            type="button"
            variant="secondary"
          >
            {preparationApprovalActionLabel(
              pinnedApproval.approval.jobIds.length,
            )}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
