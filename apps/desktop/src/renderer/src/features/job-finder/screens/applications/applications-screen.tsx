import { projectApplicationRecordsActivity } from "@nordri/contracts";
import type { ReactNode } from "react";
import { useQuestionAnswerDrafts } from "../actions/use-question-answer-drafts";
import { isSameSiteApplicationActive } from "../actions/actions-screen";
import { formatElapsedMinutes } from "./applications-recovery-state";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ApplicationCrmBulkStageMutationInput,
  ApplicationCrmExportFormat,
  ApplicationCrmMutationInput,
  ApplicationCrmSettings,
  ApplicationAttempt,
  ApplicationAutomationMode,
  ApplicationRecord,
  ApplyRunDetails,
  ClearApplicationAnswerCommandInput,
  CompanyEntity,
  GlobalDailyApplicationPreparationCapacity,
  JobFinderWorkspaceSnapshot,
  RecordOutcomeInput,
  SaveApplicationAnswerCommandInput,
  JobFinderApplyConsentActionInput,
  JobFinderApplyRunActionInput,
  JobFinderApplyRunDetailsQuery,
  JobFinderExactApplicationTarget,
  UserActionCommandInput,
} from "@nordri/contracts";
import {
  isListableCompanyName,
  isApplicationTrackedAsSentByPerson,
  PREPARED_PAGE_CLOSED_SUMMARY,
} from "@nordri/contracts";
import { ArrowLeft } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { LockedScreenLayout } from "../../components/locked-screen-layout";
import { EmptyState } from "../../components/empty-state";
import { PageHeaderStack } from "../../components/page-header";
import { ApplicationsDetailPanel } from "./applications-detail-panel";
import type {
  ConfirmFinishedInBrowserStatus,
  FinishInBrowserHandler,
  FinishInBrowserInput,
} from "./applications-detail-panel-recovery-actions-section";
import {
  APPLICATION_FILTER_LABELS,
  APPLICATION_FILTERS,
  type ApplicationsViewFilter,
} from "./applications-filters";
import {
  getLatestApplicationAttemptForRecord,
  matchesApplicationsFilter,
  pickLatestIsoTimestamp,
  resolveUnambiguousApplicationRecordIdByJobId,
  resolveVisibleRouteActionMessage,
} from "./applications-screen-helpers";
import { useApplicationsApplyRunDetails } from "./use-applications-apply-run-details";
import { ApplicationsRecordsPanel } from "./applications-records-panel";
import { StatusBadge } from "../../components/status-badge";
import { countApplyRunItemsNeedingYou } from "../../lib/needs-you-count";
import {
  ApplicationsCrmViews,
  type ApplicationCrmView,
} from "./applications-crm-views";
import { ApplicationsCrmDetail } from "./applications-crm-detail";
import type { ApplyMode } from "../../lib/apply-mode-contracts-stub";
import {
  resolveApplyStatePresentation,
  WAITING_FOR_BROWSER_TAB_SUMMARY,
} from "./apply-state";
import { buildApplyRunContextReader } from "./applications-recovery-state";
import { APPLICATION_PREPARATION_BATCH_LIMIT } from "../review-queue/review-queue-status";
import { useAssistantContextSource } from "../../assistant/assistant-provider";
import { buildListContext } from "../../assistant/assistant-context-capture";

/** Statuses an application reaches once it was sent and can have an outcome. */
const OUTCOME_STATUSES = new Set<string>([
  "submitted",
  "assessment",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
]);

export function ApplicationsScreen(props: {
  homeTimeZone?: string;
  scopeControl?: ReactNode;
  actionMessage?: string | null;
  searchPlanName?: string | undefined;
  hasOtherPlanApplications?: boolean;
  applicationAttempts: readonly ApplicationAttempt[];
  applicationRecords: readonly ApplicationRecord[];
  applyRuns: JobFinderWorkspaceSnapshot["applyRuns"];
  applyJobResults: JobFinderWorkspaceSnapshot["applyJobResults"];
  /** The person's pause, so a job held by it reads Paused, not Filling in. */
  activityControl?: JobFinderWorkspaceSnapshot["activityControl"] | null;
  /**
   * Live user-action requests, so the finished-run summary counts this run's
   * share of the same Needs you population the header badge totals.
   */
  userActionRequests?: JobFinderWorkspaceSnapshot["userActionRequests"];
  companies?: readonly CompanyEntity[];
  dailyPreparationCapacity: GlobalDailyApplicationPreparationCapacity | null;
  discoveryJobs: JobFinderWorkspaceSnapshot["discoveryJobs"];
  isApplyPending: boolean;
  isApplyRequestPending: (requestId: string) => boolean;
  isApplyRunPending: (runId: string) => boolean;
  onApproveApplyRun: (input: JobFinderApplyRunActionInput) => void;
  onCancelApplyRun: (input: JobFinderApplyRunActionInput) => void;
  onGetApplyRunDetails: (
    input: JobFinderApplyRunDetailsQuery,
  ) => Promise<ApplyRunDetails>;
  /**
   * Sends an application the person chose to look over first. Absent unless
   * they allowed Job Finder to send at all.
   */
  onSubmitPreparedApplication?: (jobId: string) => Promise<void>;
  /** Prepares the application again when its page is no longer open. */
  onPrepareApplicationAgain?: (jobId: string) => Promise<void>;
  onSaveApplicationAnswer: (
    command: SaveApplicationAnswerCommandInput,
  ) => Promise<ApplyRunDetails>;
  onClearApplicationAnswer: (
    command: ClearApplicationAnswerCommandInput,
  ) => Promise<ApplyRunDetails>;
  onExportApplicationPacket: (
    input: JobFinderApplyRunDetailsQuery,
  ) => Promise<void>;
  onResolveSubmissionOutcome?: (
    uncertainOutcomeId: string,
    resolution: "submitted" | "not_submitted",
  ) => Promise<void>;
  onResolveApplyConsentRequest: (
    input: JobFinderApplyConsentActionInput,
  ) => void;
  onRevokeApplyRunApproval: (input: JobFinderApplyRunActionInput) => void;
  applicationAutomationMode?: ApplicationAutomationMode;
  onStartAutoApplyQueue: (
    jobIds: string[],
    applicationAutomationMode?: ApplicationAutomationMode,
  ) => void;
  onStartApplyCopilot: (input: JobFinderExactApplicationTarget) => void;
  onReviewResumePdf?: (jobId: string) => void;
  onOpenCompany?: (companyId: string) => void;
  /**
   * The workspace's most recently updated run. Not used to pick a record's
   * attempt (see effectiveSelectedApplyRunId); kept for callers.
   */
  selectedApplyRunId: string | null;
  onSelectRecord: (recordId: string) => void;
  selectedAttempt: ApplicationAttempt | null;
  selectedRecord: ApplicationRecord | null;
  crmSettings?: ApplicationCrmSettings;
  onMutateApplicationCrm?: (
    command: ApplicationCrmMutationInput,
  ) => Promise<void>;
  onMutateApplicationCrmBulkStage?: (
    command: ApplicationCrmBulkStageMutationInput,
  ) => Promise<void>;
  onExportApplicationCrm?: (
    format: ApplicationCrmExportFormat,
    recordId: string,
  ) => Promise<void>;
  onRecordOutcome?: (input: RecordOutcomeInput) => Promise<void>;
  isRecordOutcomePending?: (jobId: string) => boolean;
  outcomeCampaignId?: string | null;
  getOutcomeResumeStrategyId?: (jobId: string) => string | null;
  /** Outcomes the person recorded for one application. */
  getRecordedOutcomes?: (applicationRecordId: string) => readonly {
    id: string;
    outcome: string;
    occurredAt: string;
    note: string | null;
  }[];
  safeguardsBlockerCount?: number;
  onOpenSafeguards?: () => void;
  /** Opens Outcomes, which has no navigation entry of its own. */
  onOpenOutcomes?: () => void;
  onOpenNeedsYou?: () => void;
  onPerformUserAction?: (
    command: UserActionCommandInput,
  ) => void | Promise<void>;
  isUserActionPending?: (requestId: string) => boolean;
  onAllowSiteSaves?: (host: string | null) => void;
  /**
   * Opens or focuses the managed Job Finder browser on the paused application
   * so the user can finish a field the site tried to save on its own. It
   * reports what the hand-off actually did; the declared return type has to
   * match the leaf's or that outcome is under-reported on the way down.
   */
  onFinishInBrowser?: FinishInBrowserHandler;
  /**
   * Confirms the browser-owned step the user was sent out to finish, running
   * the same verification Needs you runs. The screen that sends the user to
   * the browser is the screen that takes them back in.
   */
  onConfirmFinishedInBrowser?: (input: FinishInBrowserInput) => void;
  /** True while a pending browser step exists for the visible result. */
  canConfirmFinishedInBrowser?: boolean;
  /** The pending browser step is a sign-in Job Finder watches by itself. */
  browserStepContinuesOnItsOwn?: boolean;
  confirmFinishedInBrowserStatus?: ConfirmFinishedInBrowserStatus;
  confirmFinishedInBrowserBlockerText?: string | null;
  /** The mode chosen in Settings; decides what a finished fill means. */
  applyMode?: ApplyMode;
  /** Route-owned tracker mode, so "Open tracker" is a link, not a tab. */
  requestedRecordId?: string | null;
  workspaceView?: "workflow" | "crm";
  onWorkspaceViewChange?: (view: "workflow" | "crm") => void;
}) {
  const {
    applicationAttempts,
    applicationRecords,
    applyRuns,
    applyJobResults,
    userActionRequests,
    dailyPreparationCapacity,
    discoveryJobs,
    isApplyPending,
    isApplyRequestPending,
    isApplyRunPending,
    onApproveApplyRun,
    onCancelApplyRun,
    onGetApplyRunDetails,
    onSaveApplicationAnswer,
    onSubmitPreparedApplication,
    onPrepareApplicationAgain,
    onClearApplicationAnswer,
    onExportApplicationPacket,
    onResolveSubmissionOutcome,
    onResolveApplyConsentRequest,
    onRevokeApplyRunApproval,
    onStartAutoApplyQueue,
    onStartApplyCopilot,
    onReviewResumePdf,
    onSelectRecord,
    selectedAttempt,
    selectedRecord,
  } = props;
  const [activeFilter, setActiveFilter] =
    useState<ApplicationsViewFilter>("all");
  // Preparation is the product; the stage tracker is a deferred power surface
  // reached explicitly, not a peer tab that splits one application into two
  // competing screens. The route owns the mode so the tracker keeps a link.
  const [localWorkspaceView, setLocalWorkspaceView] = useState<
    "workflow" | "crm"
  >("workflow");
  const workspaceView = props.workspaceView ?? localWorkspaceView;
  const setWorkspaceView = (view: "workflow" | "crm") => {
    setLocalWorkspaceView(view);
    props.onWorkspaceViewChange?.(view);
  };
  const [crmView, setCrmView] = useState<ApplicationCrmView>("table");
  const [crmVisibleRecordIds, setCrmVisibleRecordIds] = useState<
    readonly string[] | null
  >(null);
  const [
    selectedApplyRunIdByApplicationRecordId,
    setSelectedApplyRunIdByApplicationRecordId,
  ] = useState<Record<string, string>>({});
  const selectRecordAndRevealDetails = useCallback(
    (recordId: string) => {
      onSelectRecord(recordId);
      if (
        typeof window.matchMedia !== "function" ||
        window.matchMedia("(min-width: 1280px)").matches
      ) {
        return;
      }
      window.requestAnimationFrame(() => {
        document
          .getElementById("applications-detail-content")
          ?.scrollIntoView({ block: "start" });
      });
    },
    [onSelectRecord],
  );
  const handleCrmVisibleRecordIdsChange = useCallback(
    (recordIds: readonly string[]) => {
      setCrmVisibleRecordIds((current) =>
        current !== null &&
        current.length === recordIds.length &&
        current.every((id, index) => id === recordIds[index])
          ? current
          : recordIds,
      );
    },
    [],
  );
  // The words for a job whose application is being filled in right now, so
  // the list never shows a stale "prepare when you are ready" beside a
  // running preparation.
  const [progressNow, setProgressNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setProgressNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const liveRunLinesByJobId = useMemo(() => {
    const runningRunIds = new Set(
      applyRuns.filter((run) => run.state === "running").map((run) => run.id),
    );
    const lines = new Map<string, string>();
    for (const result of applyJobResults) {
      if (!runningRunIds.has(result.runId)) continue;
      // Started but held until the browser has a free tab: say that.
      const elapsed = formatElapsedMinutes(result.startedAt, progressNow);
      if (result.summary === WAITING_FOR_BROWSER_TAB_SUMMARY) {
        lines.set(
          result.jobId,
          `${WAITING_FOR_BROWSER_TAB_SUMMARY}${elapsed ? ` (${elapsed})` : ""}.`,
        );
        continue;
      }
      if (result.state === "planned") {
        lines.set(
          result.jobId,
          props.activityControl?.paused
            ? "Paused before this application. It carries on when you resume."
            : `Waiting its turn${elapsed ? ` (${elapsed})` : ""}.`,
        );
        continue;
      }
      if (result.state !== "filling" && result.state !== "submitting") continue;
      lines.set(
        result.jobId,
        `Filling in${elapsed ? ` (${elapsed})` : ""}${result.detail?.trim() ? ` · ${result.detail.trim()}` : ""}`,
      );
    }
    const jobsById = new Map(discoveryJobs.map((job) => [job.id, job]));
    for (const request of userActionRequests ?? []) {
      if (
        request.kind !== "manual_answer" ||
        request.state !== "verifying" ||
        request.scope.type !== "application"
      )
        continue;
      const job = jobsById.get(request.scope.jobId);
      const waiting =
        job && isSameSiteApplicationActive(job, applyJobResults, jobsById);
      const elapsed = formatElapsedMinutes(request.updatedAt, progressNow);
      lines.set(
        request.scope.jobId,
        `${waiting ? "Waiting its turn" : "Inserting your answer"}${elapsed ? ` (${elapsed})` : ""}.`,
      );
    }
    return lines;
  }, [
    applyJobResults,
    applyRuns,
    props.activityControl?.paused,
    progressNow,
    userActionRequests,
    discoveryJobs,
  ]);
  const applyMode: ApplyMode = props.applyMode ?? "fill_only";
  // The newest run result per record, so each row reads one of the five
  // apply states from what the run recorded.
  const latestApplyResultByRecordId = useMemo(() => {
    const latest = new Map<
      string,
      JobFinderWorkspaceSnapshot["applyJobResults"][number]
    >();
    const runsById = new Map(applyRuns.map((run) => [run.id, run]));
    for (const result of applyJobResults) {
      if (!result.applicationRecordId) continue;
      const current = latest.get(result.applicationRecordId);
      const currentStart = current
        ? (runsById.get(current.runId)?.createdAt ?? current.startedAt)
        : "";
      const resultStart =
        runsById.get(result.runId)?.createdAt ?? result.startedAt;
      if (
        !current ||
        (result.privacyReceipt?.finalSubmitOccurred === true &&
          result.privacyReceipt.submissionOutcome?.outcome !==
            "outcome_uncertain") ||
        (current.privacyReceipt?.finalSubmitOccurred !== true &&
          (currentStart < resultStart ||
            (current.runId === result.runId &&
              current.updatedAt < result.updatedAt)))
      ) {
        latest.set(result.applicationRecordId, result);
      }
    }
    return latest;
  }, [applyJobResults, applyRuns]);
  // What each result's run is doing: a planned job waits its turn, is held
  // by the person's pause, or was left behind by a batch that stopped.
  const readApplyRunContext = useMemo(
    () =>
      buildApplyRunContextReader({
        applyRuns,
        applyJobResults,
        activityControl: props.activityControl ?? null,
      }),
    [applyJobResults, applyRuns, props.activityControl],
  );
  // Retained records can predate terminal-result synchronization. Tracker uses
  // the same newest attempt as Preparation without rewriting saved history.
  const crmApplicationRecords = useMemo(
    () =>
      projectApplicationRecordsActivity({
        records: applicationRecords,
        results: applyJobResults,
        runs: applyRuns,
      }),
    [applicationRecords, applyJobResults, applyRuns],
  );
  // Bulk retry: every application whose last run ended where a fresh run
  // could differ. One control, so a batch that failed on a bad network night
  // is not ten separate "Try again" presses.
  const retryableJobIds = useMemo(() => {
    const running = new Set(
      applyRuns
        .filter((run) => run.state === "running")
        .flatMap((run) => run.jobIds),
    );
    const jobIds: string[] = [];
    for (const record of applicationRecords) {
      if (running.has(record.jobId)) continue;
      const result = latestApplyResultByRecordId.get(record.id);
      if (!result) continue;
      // A form whose page closed while it waited on the person may have been
      // sent by them; only they can say, one application at a time.
      if (result.blockerSummary === PREPARED_PAGE_CLOSED_SUMMARY) continue;
      if (isApplicationTrackedAsSentByPerson(record.crm)) continue;
      const presentation = resolveApplyStatePresentation({
        recordCrm: record.crm,
        recordLatestBlocker: record.latestBlocker,
        mode:
          record.automationMode === "autonomous_submit"
            ? "apply_for_me"
            : "fill_only",
        result,
        run: readApplyRunContext(result),
        recordLastActionLabel: record.lastActionLabel,
        recordFailure:
          record.lastAttemptState === "failed"
            ? {
                lastActionLabel: record.lastActionLabel,
                lastUpdatedAt: record.lastUpdatedAt,
              }
            : null,
      });
      if (
        !presentation.cancelledByPerson &&
        presentation.kind === "could_not_apply" &&
        presentation.action === "try_again" &&
        !jobIds.includes(record.jobId)
      ) {
        jobIds.push(record.jobId);
      }
    }
    return jobIds.slice(0, APPLICATION_PREPARATION_BATCH_LIMIT);
  }, [
    applicationRecords,
    applyRuns,
    latestApplyResultByRecordId,
    readApplyRunContext,
  ]);
  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        APPLICATION_FILTERS.map((filter) => [
          filter,
          applicationRecords.filter((record) =>
            matchesApplicationsFilter(
              record,
              filter,
              latestApplyResultByRecordId.has(record.id)
                ? resolveApplyStatePresentation({
                    recordCrm: record.crm,
                    recordLatestBlocker: record.latestBlocker,
                    mode:
                      record.automationMode === "autonomous_submit"
                        ? "apply_for_me"
                        : "fill_only",
                    result: latestApplyResultByRecordId.get(record.id) ?? null,
                    run: readApplyRunContext(
                      latestApplyResultByRecordId.get(record.id) ?? null,
                    ),
                    pendingQuestionCount: Math.max(
                      0,
                      record.questionSummary.total -
                        record.questionSummary.answered,
                    ),
                    recordLastActionLabel: record.lastActionLabel,
                    recordFailure:
                      record.lastAttemptState === "failed"
                        ? {
                            lastActionLabel: record.lastActionLabel,
                            lastUpdatedAt: record.lastUpdatedAt,
                          }
                        : null,
                  }).kind
                : undefined,
            ),
          ).length,
        ]),
      ) as Record<ApplicationsViewFilter, number>,
    [applicationRecords, latestApplyResultByRecordId, readApplyRunContext],
  );
  const { answerDrafts, restoredApplications } = useQuestionAnswerDrafts({
    applicationAttempts,
    requests: userActionRequests ?? [],
    onGetApplyRunDetails,
  });
  const latestAutomaticRun = useMemo(
    () =>
      [...applyRuns]
        .filter((run) => run.mode !== "copilot")
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )[0] ?? null,
    [applyRuns],
  );
  const latestAutomaticResults = useMemo(
    () =>
      latestAutomaticRun
        ? applyJobResults.filter(
            (result) => result.runId === latestAutomaticRun.id,
          )
        : [],
    [applyJobResults, latestAutomaticRun],
  );
  // One owner for "needs you": the run summary counts this run's share of the
  // population the header badge totals, rather than its own blocked/failed
  // result states, which reported "5 need attention" beside "Needs you: 4
  // unresolved" for the same five jobs.
  const latestRunAttentionResults = latestAutomaticResults.filter(
    (result) =>
      !result.applicationRecordId ||
      latestApplyResultByRecordId.get(result.applicationRecordId)?.id ===
        result.id,
  );
  const latestRunAttentionRecords = applicationRecords.filter((record) =>
    latestRunAttentionResults.some(
      (result) => result.applicationRecordId === record.id,
    ),
  );
  const latestRunAttentionRequests = (userActionRequests ?? []).filter(
    (request) => {
      const scope = request.scope;
      return (
        scope.type === "application" &&
        scope.runId === latestAutomaticRun?.id &&
        (!scope.applicationRecordId ||
          latestRunAttentionResults.some(
            (result) =>
              result.applicationRecordId === scope.applicationRecordId,
          ))
      );
    },
  );
  const latestRunAttentionCount = latestAutomaticRun
    ? countApplyRunItemsNeedingYou({
        applicationRecords: latestRunAttentionRecords,
        applyJobResults: latestRunAttentionResults,
        requests: latestRunAttentionRequests,
        runId: latestAutomaticRun.id,
        runJobIds: new Set(latestAutomaticRun.jobIds),
      })
    : 0;
  const latestRunCouldNotApplyCount = latestRunAttentionResults.filter(
    (result) => ["failed", "blocked", "skipped"].includes(result.state),
  ).length;
  const latestRunHasCountedFailure =
    latestAutomaticRun &&
    latestRunAttentionResults.some(
      (result) =>
        result.state === "failed" &&
        countApplyRunItemsNeedingYou({
          applicationRecords: latestRunAttentionRecords.filter(
            (record) => record.id === result.applicationRecordId,
          ),
          applyJobResults: [result],
          requests: latestRunAttentionRequests.filter(
            (request) =>
              request.scope.type === "application" &&
              request.scope.jobId === result.jobId,
          ),
          runId: latestAutomaticRun.id,
          runJobIds: new Set([result.jobId]),
        }) > 0,
    );
  const latestRunQueuedCount =
    latestAutomaticRun?.state === "running"
      ? latestAutomaticResults.filter((result) => result.state === "planned")
          .length
      : 0;
  const latestRunNotStartedCount =
    latestAutomaticRun?.state !== "running"
      ? latestAutomaticResults.filter((result) => result.state === "planned")
          .length
      : 0;
  const latestRunInProgressCount =
    latestAutomaticRun?.state === "running"
      ? latestAutomaticResults.filter((result) =>
          ["filling", "question_capture", "submitting"].includes(result.state),
        ).length
      : 0;
  const latestRunFinishedCount = latestAutomaticResults.filter(
    (result) =>
      result.state === "submitted" &&
      result.privacyReceipt?.finalSubmitOccurred !== false,
  ).length;
  const latestRunSkippedCount = latestAutomaticResults.filter(
    (result) => result.state === "skipped",
  ).length;
  const filteredApplicationRecords = useMemo(
    () =>
      applicationRecords.filter((record) =>
        matchesApplicationsFilter(
          record,
          activeFilter,
          latestApplyResultByRecordId.has(record.id)
            ? resolveApplyStatePresentation({
                recordCrm: record.crm,
                recordLatestBlocker: record.latestBlocker,
                mode:
                  record.automationMode === "autonomous_submit"
                    ? "apply_for_me"
                    : "fill_only",
                result: latestApplyResultByRecordId.get(record.id) ?? null,
                run: readApplyRunContext(
                  latestApplyResultByRecordId.get(record.id) ?? null,
                ),
                pendingQuestionCount: Math.max(
                  0,
                  record.questionSummary.total -
                    record.questionSummary.answered,
                ),
                recordLastActionLabel: record.lastActionLabel,
                recordFailure:
                  record.lastAttemptState === "failed"
                    ? {
                        lastActionLabel: record.lastActionLabel,
                        lastUpdatedAt: record.lastUpdatedAt,
                      }
                    : null,
              }).kind
            : undefined,
        ),
      ),
    [
      activeFilter,
      applicationRecords,
      latestApplyResultByRecordId,
      readApplyRunContext,
    ],
  );
  const [explicitlyHiddenRecordId, setExplicitlyHiddenRecordId] = useState<
    string | null
  >(null);
  const handleFilterChange = (filter: ApplicationsViewFilter) => {
    const result = selectedRecord
      ? latestApplyResultByRecordId.get(selectedRecord.id)
      : null;
    const state = result
      ? resolveApplyStatePresentation({
          mode: applyMode,
          result,
          run: readApplyRunContext(result),
          recordCrm: selectedRecord?.crm,
          recordLatestBlocker: selectedRecord?.latestBlocker ?? null,
          recordLastActionLabel: selectedRecord?.lastActionLabel ?? null,
        }).kind
      : undefined;
    setExplicitlyHiddenRecordId(
      selectedRecord &&
        !matchesApplicationsFilter(selectedRecord, filter, state)
        ? selectedRecord.id
        : null,
    );
    setActiveFilter(filter);
  };
  const isSelectedRecordHiddenByFilter =
    selectedRecord !== null &&
    filteredApplicationRecords.length > 0 &&
    !filteredApplicationRecords.some(
      (record) => record.id === selectedRecord.id,
    );
  const shouldPreserveHiddenSelection =
    workspaceView === "workflow" &&
    isSelectedRecordHiddenByFilter &&
    explicitlyHiddenRecordId === selectedRecord?.id;
  const effectiveSelectedRecord = shouldPreserveHiddenSelection
    ? null
    : (selectedRecord ?? filteredApplicationRecords[0] ?? null);
  // The applications list as the person sees it, for the assistant (ADR 0037).
  useAssistantContextSource("applications", () => ({
    focus: effectiveSelectedRecord
      ? {
          kind: "application",
          id: effectiveSelectedRecord.id,
          label: `${effectiveSelectedRecord.title} at ${effectiveSelectedRecord.company}`,
        }
      : null,
    // The open application is focus, never selection. The tracker table
    // publishes its ticked rows with a higher priority when it is shown.
    list: buildListContext({
      listKind: "applications",
      checkedIds: [],
      displayedIds: filteredApplicationRecords.map((record) => record.id),
      filteredIds: filteredApplicationRecords.map((record) => record.id),
      filterSummary: activeFilter === "all" ? null : `Filter: ${activeFilter}`,
    }),
  }));
  const effectiveSelectedAttempt = (() => {
    if (!effectiveSelectedRecord) {
      return null;
    }

    // Exact lineage from route selection stays authoritative.
    if (
      selectedAttempt &&
      selectedAttempt.applicationRecordId === effectiveSelectedRecord.id
    ) {
      return selectedAttempt;
    }

    // Otherwise the latest associated attempt may come from legacy history
    // whose applicationRecordId is null but whose job ownership is unique.
    return getLatestApplicationAttemptForRecord(
      effectiveSelectedRecord,
      applicationAttempts,
      applicationRecords,
    );
  })();
  const isSelectedRecordInCrmView =
    crmVisibleRecordIds !== null &&
    effectiveSelectedRecord !== null &&
    crmVisibleRecordIds.includes(effectiveSelectedRecord.id);
  const applyRunsById = useMemo(
    () => new Map(applyRuns.map((run) => [run.id, run])),
    [applyRuns],
  );
  const unambiguousRecordIdByJobId = useMemo(
    () => resolveUnambiguousApplicationRecordIdByJobId(applicationRecords),
    [applicationRecords],
  );
  const scopedApplyRunIds = useMemo(
    () => new Set(applyRuns.map((run) => run.id)),
    [applyRuns],
  );
  const applyResultsForSelectedRecord = useMemo(() => {
    if (!effectiveSelectedRecord) {
      return [];
    }

    return [...applyJobResults]
      .filter((result) => {
        if (result.applicationRecordId) {
          // Exact lineage is authoritative and is never re-attributed.
          return result.applicationRecordId === effectiveSelectedRecord.id;
        }

        // Legacy results predate application records; attach them only when
        // one scoped record owns the job inside a scoped run. Multiple records
        // for the same job keep ownership ambiguous, so nothing attaches.
        return (
          scopedApplyRunIds.has(result.runId) &&
          unambiguousRecordIdByJobId.get(result.jobId) ===
            effectiveSelectedRecord.id
        );
      })
      .sort(
        (left, right) =>
          Number(right.privacyReceipt?.finalSubmitOccurred === true) -
            Number(left.privacyReceipt?.finalSubmitOccurred === true) ||
          new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
      );
  }, [
    applyJobResults,
    effectiveSelectedRecord,
    scopedApplyRunIds,
    unambiguousRecordIdByJobId,
  ]);
  const effectiveSelectedApplyRunId = useMemo(() => {
    if (!effectiveSelectedRecord) {
      return null;
    }

    const applicationRecordId = effectiveSelectedRecord.id;
    const locallySelectedRunId =
      selectedApplyRunIdByApplicationRecordId[applicationRecordId] ?? null;

    if (
      locallySelectedRunId &&
      applyResultsForSelectedRecord.some(
        (result) => result.runId === locallySelectedRunId,
      )
    ) {
      return locallySelectedRunId;
    }

    // Otherwise the record's newest attempt. The workspace-wide selection is
    // the most recently *updated* run, which after a Try again is often the
    // older batch (a late write to it moves it forward). Following it here
    // aimed "Open the Job Finder browser" at the earlier, failed attempt, so
    // the kept page of the newer one was never handed to the person.
    return applyResultsForSelectedRecord[0]?.runId ?? null;
  }, [
    applyResultsForSelectedRecord,
    effectiveSelectedRecord,
    selectedApplyRunIdByApplicationRecordId,
  ]);
  const effectiveSelectedApplyResult = useMemo(
    () =>
      applyResultsForSelectedRecord.find(
        (result) => result.runId === effectiveSelectedApplyRunId,
      ) ??
      applyResultsForSelectedRecord[0] ??
      null,
    [applyResultsForSelectedRecord, effectiveSelectedApplyRunId],
  );
  const applyRunHistory = useMemo(
    () =>
      applyResultsForSelectedRecord.map((result) => ({
        result,
        run: applyRunsById.get(result.runId) ?? null,
      })),
    [applyResultsForSelectedRecord, applyRunsById],
  );
  const latestApplyRunIdForSelectedRecord =
    applyResultsForSelectedRecord[0]?.runId ?? null;
  const effectiveSelectedJobId = effectiveSelectedRecord?.jobId ?? null;
  const effectiveSelectedRunId = effectiveSelectedApplyResult?.runId ?? null;
  const selectedApplyRun = effectiveSelectedRunId
    ? (applyRunsById.get(effectiveSelectedRunId) ?? null)
    : null;
  const effectiveSelectedRunUpdatedAt = pickLatestIsoTimestamp(
    selectedApplyRun?.updatedAt,
    effectiveSelectedApplyResult?.updatedAt,
  );
  const {
    applyRunDetails,
    applyRunDetailsError,
    applyRunDetailsStatus,
    applyRunDetailsTarget,
    replaceApplyRunDetails,
  } = useApplicationsApplyRunDetails({
    jobId: effectiveSelectedJobId,
    applicationRecordId: effectiveSelectedRecord?.id ?? null,
    onGetApplyRunDetails,
    runId: effectiveSelectedRunId,
    runUpdatedAt: effectiveSelectedRunUpdatedAt,
  });
  const showLatestAttemptDetails =
    !effectiveSelectedApplyRunId ||
    !latestApplyRunIdForSelectedRecord ||
    effectiveSelectedApplyRunId === latestApplyRunIdForSelectedRecord;

  const handleSelectApplyRun = useCallback(
    (runId: string) => {
      if (!effectiveSelectedRecord) {
        return;
      }

      setSelectedApplyRunIdByApplicationRecordId((current) => ({
        ...current,
        [effectiveSelectedRecord.id]: runId,
      }));
    },
    [effectiveSelectedRecord],
  );

  useEffect(() => {
    if (
      !effectiveSelectedRecord ||
      effectiveSelectedRecord.id === selectedRecord?.id
    ) {
      return;
    }

    onSelectRecord(effectiveSelectedRecord.id);
  }, [effectiveSelectedRecord, onSelectRecord, selectedRecord?.id]);

  const hasCrmTrackerControls = Boolean(
    props.crmSettings &&
    props.onMutateApplicationCrm &&
    props.onExportApplicationCrm,
  );
  const hasUnassignedLegacyLineage =
    applicationAttempts.some(
      (attempt) =>
        !attempt.applicationRecordId &&
        !unambiguousRecordIdByJobId.has(attempt.jobId),
    ) ||
    applyJobResults.some(
      (result) =>
        !result.applicationRecordId &&
        (!unambiguousRecordIdByJobId.has(result.jobId) ||
          !scopedApplyRunIds.has(result.runId)),
    );
  // Retry, queue, and copilot refusals and backend errors are written as
  // route-owned statuses by the page controller; Applications owns their one
  // visible presentation. The controller's route scoping keeps sibling-route
  // messages from ever arriving here.
  const visibleActionMessage = resolveVisibleRouteActionMessage({
    actionMessage: props.actionMessage ?? null,
    dailyPreparationCapacity,
    latestRunAttentionCount,
  });
  const crmEmptyState = !hasCrmTrackerControls
    ? {
        title: "Tracking tools unavailable",
        description:
          "Application tracking tools are not available right now, so this pane has nothing to manage.",
      }
    : applicationRecords.length === 0
      ? {
          title: "No applications to track yet",
          description:
            "Shortlist a job or prepare an application and its local stages, notes, and exports will appear here.",
        }
      : !effectiveSelectedRecord
        ? {
            title: "No application selected",
            description:
              "Choose an application in the tracker to review and update its local stages, notes, and reminders.",
          }
        : {
            title: "No application selected in this view",
            description:
              "The application you had selected is not shown by this view's search or lifecycle filter, so its tracking tools are unavailable here. Clearing the search box, switching the lifecycle view, or choosing Show all applications will bring it back.",
          };

  return (
    <LockedScreenLayout
      contentClassName={
        workspaceView === "crm" ? "overflow-y-auto" : "xl:overflow-hidden"
      }
      // Applications is a two-pane route like Find jobs and Shortlisted, so it
      // needs the same viewport bound they pass. Without it the grid's `1fr`
      // row resolves to max-content, the workspace grid's `xl:h-full` resolves
      // against an indefinite height, `xl:overflow-hidden` clips nothing, and
      // the panes marked `data-locked-pane-scroll-region` never get a scroll
      // range — so the whole route scrolled as one page and the detail pane's
      // recovery action fell below the fold on any record with a long status
      // stack.
      lockContentHeight
      topContent={
        <>
          {/* One list, one state per application. The stage tracker — table,
              board, calendar, saved views, columns, export — is a separate
              destination reached by name, not a peer tab that renders a CRM
              beside a single record. */}
          <PageHeaderStack
            subnav={props.scopeControl}
            actions={
              workspaceView === "crm" ? (
                <Button
                  data-testid="applications-close-tracker"
                  onClick={() => setWorkspaceView("workflow")}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  Back to Applications
                </Button>
              ) : applicationRecords.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {workspaceView === "workflow" &&
                  retryableJobIds.length > 1 ? (
                    <section
                      aria-label="Retry applications that could not be applied"
                      className="flex items-center gap-2"
                      data-testid="applications-bulk-retry"
                    >
                      <p className="sr-only">
                        {retryableJobIds.length} applications could not be
                        applied and can be tried again.
                      </p>
                      <Button
                        disabled={
                          isApplyPending ||
                          (dailyPreparationCapacity !== null &&
                            dailyPreparationCapacity.remaining < 1)
                        }
                        onClick={() =>
                          onStartAutoApplyQueue(
                            [...retryableJobIds],
                            props.applicationAutomationMode ?? "prepare_only",
                          )
                        }
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Try again for all {retryableJobIds.length}
                      </Button>
                    </section>
                  ) : null}
                  {/* Outcomes has no navigation entry; it is reached from
                      here once something has been sent and can have one. */}
                  {props.onOpenOutcomes &&
                  applicationRecords.some((record) =>
                    OUTCOME_STATUSES.has(record.status),
                  ) ? (
                    <Button
                      className="border-(--control-border)"
                      data-testid="applications-open-outcomes"
                      onClick={props.onOpenOutcomes}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      See outcomes
                    </Button>
                  ) : null}
                  <Button
                    className="border-(--control-border)"
                    data-testid="applications-open-tracker"
                    onClick={() => setWorkspaceView("crm")}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Open tracker
                  </Button>
                </div>
              ) : null
            }
            description={
              workspaceView === "crm"
                ? "Stages you record yourself, plus notes, reminders and export. Recording a stage is a local note; it never submits anything."
                : "Track preparations and hiring progress. Search or filter to find an application."
            }
            title={workspaceView === "crm" ? "Tracker" : "Applications"}
          />
          {props.safeguardsBlockerCount !== undefined &&
          props.safeguardsBlockerCount > 0 ? (
            <section
              aria-label="Active safeguards"
              className="flex flex-wrap items-center justify-between gap-4 rounded-(--radius-field) border border-destructive/30 bg-destructive/10 px-4 py-3"
            >
              <p className="min-w-0 text-(length:--text-small) leading-6 text-foreground">
                {props.safeguardsBlockerCount} active safeguard{" "}
                {props.safeguardsBlockerCount === 1 ? "blocker" : "blockers"}{" "}
                {props.safeguardsBlockerCount === 1 ? "needs" : "need"}{" "}
                attention. Affected work is paused; job discovery may still be
                available.
              </p>
              {props.onOpenSafeguards ? (
                <Button
                  onClick={props.onOpenSafeguards}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Open Safeguards
                </Button>
              ) : null}
            </section>
          ) : null}
          {/* Completed runs belong in Activity. Keep this callout only while
              the person has an unresolved step in this run. */}
          {latestAutomaticRun &&
          latestRunAttentionCount > 0 &&
          workspaceView === "workflow" ? (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-(--radius-field) border border-(--surface-panel-border) px-4 py-3">
              <div className="min-w-0">
                <p className="label-mono-xs">Latest automatic run</p>
                <p className="mt-1 text-(length:--text-small) leading-6 text-foreground-soft">
                  {latestAutomaticRun.totalJobs} job
                  {latestAutomaticRun.totalJobs === 1 ? "" : "s"} ·{" "}
                  {latestRunAttentionCount} need attention
                  {[
                    latestRunCouldNotApplyCount
                      ? `${latestRunCouldNotApplyCount} could not apply`
                      : null,
                    latestRunQueuedCount
                      ? `${latestRunQueuedCount} queued`
                      : null,
                    latestRunInProgressCount
                      ? `${latestRunInProgressCount} in progress`
                      : null,
                    latestRunNotStartedCount
                      ? `${latestRunNotStartedCount} not started`
                      : null,
                    latestAutomaticResults.filter(
                      (result) => result.state === "awaiting_review",
                    ).length
                      ? `${latestAutomaticResults.filter((result) => result.state === "awaiting_review").length} prepared`
                      : null,
                    latestRunFinishedCount
                      ? `${latestRunFinishedCount} sent`
                      : null,
                    latestRunSkippedCount
                      ? `${latestRunSkippedCount} skipped`
                      : null,
                  ]
                    .filter(Boolean)
                    .map((label) => ` · ${label}`)
                    .join("")}
                </p>
              </div>
              <StatusBadge
                tone={latestRunHasCountedFailure ? "critical" : "neutral"}
              >
                {latestRunAttentionCount} need attention
              </StatusBadge>
            </section>
          ) : null}
          {hasUnassignedLegacyLineage ? (
            <p className="text-(length:--text-small) leading-6 text-foreground-soft">
              Unassigned legacy preparation history is retained for audit only.
              It is not attached to an application record and has no action
              controls.
            </p>
          ) : null}
          {visibleActionMessage ? (
            <p
              aria-atomic="true"
              aria-live="polite"
              className="min-w-0 break-words rounded-(--radius-small) border border-primary/25 bg-primary/5 px-3 py-2 text-(length:--text-small) leading-6 text-foreground"
              data-testid="applications-route-action-status"
              role="status"
            >
              {visibleActionMessage}
            </p>
          ) : null}
        </>
      }
    >
      <div
        className={
          workspaceView === "crm"
            ? "grid min-w-0 items-stretch gap-4"
            : "grid min-w-0 items-stretch gap-4 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(22rem,0.95fr)_minmax(30rem,1.45fr)] assistant-docked:xl:grid-cols-[minmax(16rem,0.95fr)_minmax(0,1.45fr)] xl:items-start xl:overflow-hidden"
        }
        id="applications-workspace-content"
      >
        {workspaceView === "crm" ? (
          <ApplicationsCrmViews
            {...(props.homeTimeZone
              ? { homeTimeZone: props.homeTimeZone }
              : {})}
            {...(props.onMutateApplicationCrmBulkStage
              ? { onBulkChange: props.onMutateApplicationCrmBulkStage }
              : {})}
            {...(props.onMutateApplicationCrmBulkStage
              ? {
                  onBulkStageChange: async (recordIds, stage) => {
                    const recordsById = new Map(
                      applicationRecords.map((record) => [record.id, record]),
                    );
                    const missingRecordIds = recordIds.filter(
                      (recordId) => !recordsById.has(recordId),
                    );
                    if (missingRecordIds.length > 0) {
                      throw new Error(
                        "Some selected applications are no longer available. Refresh and try again.",
                      );
                    }
                    await props.onMutateApplicationCrmBulkStage?.({
                      items: recordIds.map((recordId) => ({
                        applicationRecordId: recordId,
                        expectedRevision:
                          recordsById.get(recordId)?.crm?.revision ?? 0,
                      })),
                      stage,
                      customStageId: null,
                      note: "Updated from the application tracker bulk action.",
                    });
                  },
                }
              : {})}
            {...(props.crmSettings
              ? { customStages: props.crmSettings.customStages }
              : {})}
            {...(props.onMutateApplicationCrm
              ? {
                  onCompleteReminder: async (recordId, reminderId) => {
                    const record = applicationRecords.find(
                      (entry) => entry.id === recordId,
                    );
                    const reminder = record?.crm?.reminders.find(
                      (entry) => entry.id === reminderId,
                    );
                    if (!record?.crm || !reminder) {
                      throw new Error(
                        "That reminder is no longer saved. Refresh and try again.",
                      );
                    }
                    const now = new Date().toISOString();
                    await props.onMutateApplicationCrm?.({
                      applicationRecordId: record.id,
                      expectedRevision: record.crm.revision,
                      mutation: {
                        type: "upsert_reminder",
                        reminder: {
                          ...reminder,
                          status: "completed",
                          updatedAt: now,
                          completedAt: now,
                        },
                      },
                    });
                  },
                }
              : {})}
            onSelectRecord={onSelectRecord}
            onViewChange={setCrmView}
            onVisibleRecordIdsChange={handleCrmVisibleRecordIdsChange}
            requestedRecordId={props.requestedRecordId ?? null}
            records={crmApplicationRecords}
            discoveryJobs={discoveryJobs}
            selectedRecordId={effectiveSelectedRecord?.id ?? null}
            view={crmView}
          />
        ) : (
          <ApplicationsRecordsPanel
            {...(props.crmSettings
              ? { customStages: props.crmSettings.customStages }
              : {})}
            activeFilter={activeFilter}
            applicationRecords={crmApplicationRecords}
            filterCounts={filterCounts}
            hasAnyApplications={applicationRecords.length > 0}
            searchPlanName={props.searchPlanName}
            hasOtherPlanApplications={props.hasOtherPlanApplications}
            liveRunLinesByJobId={liveRunLinesByJobId}
            latestApplyResultByRecordId={latestApplyResultByRecordId}
            readApplyRunContext={readApplyRunContext}
            applyMode={applyMode}
            onFilterChange={handleFilterChange}
            onSelectRecord={selectRecordAndRevealDetails}
            selectedRecord={effectiveSelectedRecord}
            discoveryJobs={discoveryJobs}
          />
        )}
        {workspaceView === "crm" ? (
          isSelectedRecordInCrmView &&
          effectiveSelectedRecord &&
          props.crmSettings &&
          props.onMutateApplicationCrm &&
          props.onExportApplicationCrm ? (
            <div
              className="min-h-0 overflow-auto pr-1"
              data-locked-pane-scroll-region
            >
              <ApplicationsCrmDetail
                {...(props.homeTimeZone
                  ? { homeTimeZone: props.homeTimeZone }
                  : {})}
                isRecordOutcomePending={
                  props.isRecordOutcomePending?.(
                    effectiveSelectedRecord.jobId,
                  ) ?? false
                }
                key={effectiveSelectedRecord.id}
                onExport={props.onExportApplicationCrm}
                onMutate={props.onMutateApplicationCrm}
                {...(props.onRecordOutcome
                  ? { onRecordOutcome: props.onRecordOutcome }
                  : {})}
                outcomeResumeStrategyId={
                  props.getOutcomeResumeStrategyId?.(
                    effectiveSelectedRecord.jobId,
                  ) ?? null
                }
                recordedOutcomes={
                  props.getRecordedOutcomes?.(effectiveSelectedRecord.id) ?? []
                }
                outcomeCampaignId={props.outcomeCampaignId ?? null}
                record={
                  crmApplicationRecords.find(
                    (record) => record.id === effectiveSelectedRecord.id,
                  ) ?? effectiveSelectedRecord
                }
                relatedJobCanonicalUrl={
                  discoveryJobs.find(
                    (job) => job.id === effectiveSelectedRecord.jobId,
                  )?.canonicalUrl ?? null
                }
                settings={props.crmSettings}
              />
            </div>
          ) : (
            <div className="min-h-0 overflow-auto pr-1">
              <EmptyState
                description={crmEmptyState.description}
                title={crmEmptyState.title}
              />
            </div>
          )
        ) : shouldPreserveHiddenSelection ? (
          <section className="surface-panel-shell relative flex min-w-0 flex-col gap-6 overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border) px-8 py-5 xl:h-full xl:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1">
                <p className="label-mono-xs">Details</p>
                <strong className="text-(length:--text-body) text-muted-foreground">
                  Filtered selection
                </strong>
              </div>
              <StatusBadge tone="muted">Not shown</StatusBadge>
            </div>
            <div className="flex min-h-0 flex-1 items-start justify-center pt-12">
              <EmptyState
                title="Selected application not shown by this filter"
                description={`The selected application is not shown by the ${APPLICATION_FILTER_LABELS[activeFilter]} filter. Try another filter to review it.`}
              />
            </div>
          </section>
        ) : (
          <ApplicationsDetailPanel
            {...(props.crmSettings
              ? { customStages: props.crmSettings.customStages }
              : {})}
            activeFilter={activeFilter}
            readApplyRunContext={readApplyRunContext}
            answerDraft={
              selectedRecord
                ? answerDrafts.current.get(selectedRecord.id)
                : undefined
            }
            answerDraftRestored={
              selectedRecord
                ? restoredApplications.has(selectedRecord.id)
                : false
            }
            onAnswerDraftChange={(draft) => {
              if (selectedRecord)
                answerDrafts.current.set(selectedRecord.id, draft);
            }}
            applyRunDetails={applyRunDetails}
            applyRunDetailsTarget={applyRunDetailsTarget}
            applyRunDetailsError={applyRunDetailsError}
            applyRunDetailsStatus={applyRunDetailsStatus}
            applicationRecords={applicationRecords}
            applyJobResults={applyJobResults}
            dailyPreparationCapacity={dailyPreparationCapacity}
            discoveryJobs={discoveryJobs}
            applyRunHistory={applyRunHistory}
            effectiveSelectedApplyResult={effectiveSelectedApplyResult}
            hasAnyApplications={applicationRecords.length > 0}
            hasVisibleApplications={filteredApplicationRecords.length > 0}
            isApplyPending={isApplyPending}
            isApplyRequestPending={isApplyRequestPending}
            isApplyRunPending={isApplyRunPending}
            onApproveApplyRun={onApproveApplyRun}
            onCancelApplyRun={onCancelApplyRun}
            {...(props.onOpenCompany
              ? { onOpenCompany: props.onOpenCompany }
              : {})}
            selectedRecordCompanyId={
              effectiveSelectedRecord
                ? ((props.companies ?? []).find(
                    (company) =>
                      isListableCompanyName(company.canonicalName) &&
                      company.applicationRecordIds.includes(
                        effectiveSelectedRecord.id,
                      ),
                  )?.id ?? null)
                : null
            }
            onExportApplicationPacket={onExportApplicationPacket}
            {...(onResolveSubmissionOutcome
              ? { onResolveSubmissionOutcome }
              : {})}
            onSaveApplicationAnswer={async (command) => {
              replaceApplyRunDetails(await onSaveApplicationAnswer(command));
            }}
            onClearApplicationAnswer={async (command) => {
              replaceApplyRunDetails(await onClearApplicationAnswer(command));
            }}
            onResolveApplyConsentRequest={onResolveApplyConsentRequest}
            {...(onSubmitPreparedApplication
              ? { onSubmitPreparedApplication }
              : {})}
            {...(onPrepareApplicationAgain
              ? { onPrepareApplicationAgain }
              : {})}
            onRevokeApplyRunApproval={onRevokeApplyRunApproval}
            onStartAutoApplyQueue={(jobIds) =>
              onStartAutoApplyQueue(
                jobIds,
                props.applicationAutomationMode ?? "prepare_only",
              )
            }
            applyMode={applyMode}
            onSelectApplyRun={handleSelectApplyRun}
            onStartApplyCopilot={onStartApplyCopilot}
            {...(onReviewResumePdf ? { onReviewResumePdf } : {})}
            applicationAttempts={applicationAttempts}
            {...(props.onOpenNeedsYou
              ? { onOpenNeedsYou: props.onOpenNeedsYou }
              : {})}
            {...(userActionRequests ? { userActionRequests } : {})}
            {...(props.onPerformUserAction
              ? { onPerformUserAction: props.onPerformUserAction }
              : {})}
            {...(props.isUserActionPending
              ? { isUserActionPending: props.isUserActionPending }
              : {})}
            {...(props.onAllowSiteSaves
              ? { onAllowSiteSaves: props.onAllowSiteSaves }
              : {})}
            {...(props.onOpenSafeguards
              ? { onOpenSafeguards: props.onOpenSafeguards }
              : {})}
            canConfirmFinishedInBrowser={
              props.canConfirmFinishedInBrowser ?? false
            }
            browserStepContinuesOnItsOwn={
              props.browserStepContinuesOnItsOwn ?? false
            }
            confirmFinishedInBrowserStatus={
              props.confirmFinishedInBrowserStatus ?? "idle"
            }
            confirmFinishedInBrowserBlockerText={
              props.confirmFinishedInBrowserBlockerText ?? null
            }
            {...(props.onConfirmFinishedInBrowser
              ? {
                  onConfirmFinishedInBrowser: props.onConfirmFinishedInBrowser,
                }
              : {})}
            {...(props.onFinishInBrowser
              ? { onFinishInBrowser: props.onFinishInBrowser }
              : {})}
            selectedApplyRunId={effectiveSelectedApplyRunId}
            selectedAttempt={
              showLatestAttemptDetails ? effectiveSelectedAttempt : null
            }
            selectedRecord={effectiveSelectedRecord}
          />
        )}
      </div>
    </LockedScreenLayout>
  );
}
