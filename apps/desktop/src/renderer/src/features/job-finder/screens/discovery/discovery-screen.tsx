import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import type {
  BrowserSessionState,
  ApplicationRecord,
  CompanyEntity,
  DiscoveryAdapterSessionState,
  DiscoveryActivityEvent,
  DiscoveryFeedbackReason,
  EmployerExclusionPreview,
  DiscoveryRunRecord,
  JobSearchCampaign,
  JobFinderSearchRequest,
  JobSearchPreferences,
  JobSearchSelectivity,
  PlanSafeguardPause,
  ReviewQueueItem,
  SourceAccessPrompt,
  SavedJob,
} from "@unemployed/contracts";
import { isListableCompanyName } from "@unemployed/contracts";
import { PauseCircle, Play, X } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  DISCOVERY_PAUSED_SEARCH_REASON,
  getDiscoveryRuntimeProjection,
} from "./discovery-search-readiness";
import {
  createDiscoveryRunCancelledFeedback,
  createDiscoveryRunInterruptedFeedback,
  createDiscoveryRunSafeguardPausedFeedback,
  createDiscoveryRunStartedFeedback,
  createDiscoveryRunSucceededFeedback,
} from "./discovery-run-feedback";
import { LockedScreenLayout } from "@renderer/features/job-finder/components/locked-screen-layout";
import { PageHeaderStack } from "@renderer/features/job-finder/components/page-header";
import { OPEN_JOB_FINDER_BROWSER_ACTION } from "@renderer/features/job-finder/lib/job-finder-browser-handoff-copy";
import { JOB_FINDER_ROUTE_PATHS } from "@renderer/features/job-finder/lib/job-finder-route-hrefs";
import { formatCountLabel } from "@renderer/features/job-finder/lib/job-finder-utils";
import {
  formatDiscoveryRunReportLabel,
  formatDiscoveryRunCountLabel,
  getDiscoveryRunReportCounts,
  getDiscoveryRunCountEvidence,
  hasDiscoveryRunReportCounts,
} from "@renderer/features/job-finder/lib/discovery-run-count-label";
import { settleJobFinderRouteHeaderScroll } from "@renderer/features/job-finder/lib/job-finder-scroll-reveal";
import { DiscoveryHistoryModal } from "./discovery-activity-panel";
import { isDiscoveryAlsoFoundResult } from "./discovery-result-groups";
import {
  DISCOVERY_SEARCH_SETUP_PANEL_ID,
  DiscoverySearchBar,
} from "./discovery-search-bar";
import { DiscoveryDetailPanel } from "./discovery-detail-panel";
import { formatDiscoveryHideReason } from "./discovery-hide-reason-options";
import { DiscoveryFiltersPanel } from "./discovery-filters-panel";
import {
  DISCOVERY_OFFLINE_CATALOG_NOTICE_ID,
  DISCOVERY_SEARCH_SETUP_BLOCKER_ID,
  DiscoveryResultsPanel,
} from "./discovery-results-panel";
import { DiscoveryRunFeedbackCallout } from "./discovery-run-feedback-callout";
import {
  getDiscoveryLatestRunNotices,
  getDiscoveryLatestRunVerdict,
  type DiscoveryRunFeedback,
} from "./discovery-run-feedback";
import { compareDiscoveryFitOrder } from "./discovery-results-sort";
import { useDiscoveryStopState } from "@renderer/features/job-finder/lib/discovery-stop-state";
import { DISCOVERY_STOP_UNACKNOWLEDGED_LABEL } from "@renderer/features/job-finder/lib/status-copy";
import { getDiscoverySearchReadiness } from "./discovery-search-readiness";
import type {
  ActionState,
  JobFinderQueuedJobOutcome,
} from "@renderer/features/job-finder/lib/job-finder-types";
import { cn } from "@renderer/lib/cn";

export function getDiscoveryConfiguredFilters(
  searchPreferences: JobSearchPreferences,
) {
  const enabledSourceCount =
    getDiscoverySearchReadiness(searchPreferences).enabledSourceCount;
  const searchTargetCount =
    searchPreferences.targetRoles.length + searchPreferences.jobFamilies.length;

  // A remote-only search has no locations by design; reporting "0 locations"
  // beside "1 work mode" reads as a setup error instead of the intended
  // configuration.
  const isRemoteOnlySearch =
    searchPreferences.locations.length === 0 &&
    searchPreferences.workModes.length > 0 &&
    searchPreferences.workModes.every((workMode) => workMode === "remote");

  return [
    searchTargetCount > 0
      ? formatCountLabel(searchTargetCount, "search target")
      : "No search targets",
    ...(isRemoteOnlySearch
      ? ["remote only"]
      : [
          formatCountLabel(searchPreferences.locations.length, "location"),
          formatCountLabel(searchPreferences.workModes.length, "work mode"),
        ]),
    formatCountLabel(enabledSourceCount, "enabled source"),
  ];
}
export {
  DISCOVERY_CLEAR_MISMATCH_SCORE_FLOOR,
  isDiscoveryClearMismatch,
} from "./discovery-result-groups";

/**
 * Whether Find jobs opens with the weaker matches shown. It follows the rule
 * that picks a search's own mode (ADR 0025): "Cast a wide net" runs broad,
 * "Best matches only" runs precise, and the middle setting defers to the
 * plan's mode.
 */
export function resolveDiscoveryListOpensWide(
  searchSelectivity: JobSearchSelectivity | null | undefined,
  activeCampaignMode: "precision" | "scale",
): boolean {
  if (searchSelectivity === "wide_net") return true;
  if (searchSelectivity === "best_matches") return false;
  return activeCampaignMode === "scale";
}

export function getNewestRunForCampaign(
  recentRuns: readonly DiscoveryRunRecord[],
  campaignId: string | null,
): DiscoveryRunRecord | null {
  return (
    [...recentRuns]
      .filter((run) => run.campaignId === campaignId)
      .sort(
        (left, right) =>
          Date.parse(right.startedAt) - Date.parse(left.startedAt),
      )[0] ?? null
  );
}

export function getDiscoveryResultVisibility(
  jobs: readonly SavedJob[],
  selectedJob: SavedJob | null,
  showAlsoFound: boolean,
  preserveSelectedJob = false,
  stableOrderIds?: readonly string[],
): {
  alsoFoundCount: number;
  hiddenAlsoFoundCount: number;
  jobs: readonly SavedJob[];
  selectedJob: SavedJob | null;
} {
  // Weaker matches and clear mismatches are one "also found" pool. Presenting
  // them beside the leading band made the headline count describe jobs the
  // app itself had already scored well below the saved targets.
  const alsoFound = jobs.filter(isDiscoveryAlsoFoundResult);
  // A deep-linked selection keeps only that job visible even when it is in the
  // also-found pool; the rest stay hidden so the preserve path never silently
  // reveals the whole pool.
  const displayCandidates = showAlsoFound
    ? jobs
    : jobs.filter(
        (job) =>
          !isDiscoveryAlsoFoundResult(job) ||
          (preserveSelectedJob && job.id === selectedJob?.id),
      );
  // Ordering is the canonical Best-match chain (see compareDiscoveryFitOrder),
  // so the visible sequence always equals the rediscovery rank-audit sequence
  // for the same candidate set instead of depending on arrival order.
  const stableOrder = stableOrderIds
    ? new Map(stableOrderIds.map((id, index) => [id, index]))
    : null;
  const visibleJobs = displayCandidates.slice().sort((left, right) => {
    if (stableOrder) {
      const leftIndex = stableOrder.get(left.id);
      const rightIndex = stableOrder.get(right.id);
      if (leftIndex !== undefined || rightIndex !== undefined) {
        if (leftIndex === undefined) return 1;
        if (rightIndex === undefined) return -1;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      }
    }
    return compareDiscoveryFitOrder(left, right);
  });
  const visibleSelectedJob =
    selectedJob && visibleJobs.some((job) => job.id === selectedJob.id)
      ? selectedJob
      : (visibleJobs[0] ?? null);
  const visibleJobIds = new Set(visibleJobs.map((job) => job.id));

  return {
    alsoFoundCount: alsoFound.length,
    // Truthful hidden count: also-found rows actually absent from the
    // displayed list, so a deep-linked row held visible counts as shown.
    hiddenAlsoFoundCount: alsoFound.filter((job) => !visibleJobIds.has(job.id))
      .length,
    jobs: visibleJobs,
    selectedJob: visibleSelectedJob,
  };
}

export interface StableDiscoveryRunSnapshot {
  runId: string;
  jobIds: readonly string[];
  jobsById: ReadonlyMap<string, SavedJob>;
}

/**
 * Freezes rows already shown during a run and appends only genuinely new
 * rows. The terminal render receives the current objects once, so rescoring
 * and band changes happen together after the run rather than flickering while
 * listing pages are still being read.
 */
export function updateStableDiscoveryRunSnapshot(input: {
  current: StableDiscoveryRunSnapshot | null;
  jobs: readonly SavedJob[];
  runId: string | null;
}): { jobs: readonly SavedJob[]; snapshot: StableDiscoveryRunSnapshot | null } {
  if (!input.runId) {
    return { jobs: input.jobs, snapshot: null };
  }

  if (input.current?.runId !== input.runId) {
    const ordered = input.jobs.slice().sort(compareDiscoveryFitOrder);
    return {
      jobs: ordered,
      snapshot: {
        runId: input.runId,
        jobIds: ordered.map((job) => job.id),
        jobsById: new Map(ordered.map((job) => [job.id, job])),
      },
    };
  }

  const appended = input.jobs.filter(
    (job) => !input.current?.jobsById.has(job.id),
  );
  const snapshot =
    appended.length === 0
      ? input.current
      : {
          runId: input.runId,
          jobIds: [...input.current.jobIds, ...appended.map((job) => job.id)],
          jobsById: new Map([
            ...input.current.jobsById,
            ...appended.map((job) => [job.id, job] as const),
          ]),
        };
  return {
    jobs: snapshot.jobIds.flatMap((id) => {
      const job = snapshot.jobsById.get(id);
      return job ? [job] : [];
    }),
    snapshot,
  };
}

/**
 * Resolves the job the inspector should describe. The results panel reports
 * which job it actually displays on the current filtered and paginated page;
 * until the first report arrives (`displayedJobId === undefined`), the
 * pre-existing default-selection behavior applies. An explicit `null` report
 * means the visible page is empty and the inspector must clear rather than
 * keep describing a row the user cannot see.
 */
export function getDiscoveryInspectedJob(
  rankedJobs: readonly SavedJob[],
  requestedJobId: string | null,
  displayedJobId: string | null | undefined,
): SavedJob | null {
  if (displayedJobId === undefined) {
    const requested = requestedJobId
      ? rankedJobs.find((job) => job.id === requestedJobId)
      : undefined;
    return requested ?? rankedJobs[0] ?? null;
  }
  if (displayedJobId === null) {
    return null;
  }
  return rankedJobs.find((job) => job.id === displayedJobId) ?? null;
}

/**
 * Concise, non-color paused state with the nearest Resume action. Rendered
 * above every mode and message so an unrelated failure callout can never
 * mask the pause truth.
 */
export function DiscoveryPausedBanner(props: {
  isResumePending: boolean;
  onResolve?: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--warning-surface) px-3 py-2 text-(length:--text-small) text-foreground"
      data-testid="discovery-paused-banner"
      role="status"
    >
      <PauseCircle aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">Paused.</strong> Automatic work is
        paused. Press Resume activity to continue.
      </span>
      {props.onResolve ? (
        <Button
          disabled={props.isResumePending}
          onClick={props.onResolve}
          pending={props.isResumePending}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Play aria-hidden="true" className="size-4" />
          Resume activity
        </Button>
      ) : null}
    </div>
  );
}

export function DiscoveryScreen(props: {
  actionState: Pick<ActionState, "message" | "actionLink">;
  activityPaused?: boolean;
  activeRun: DiscoveryRunRecord | null;
  applicationRecords?: readonly ApplicationRecord[];
  /**
   * Shortlisted rows, so the inspector's readiness badge reads the same value
   * Shortlisted renders instead of deriving a second one from the job status.
   */
  reviewQueue?: readonly ReviewQueueItem[];
  /** Search plans the page can switch between; Search now runs the current one. */
  campaigns?: readonly JobSearchCampaign[];
  safeguardPauses?: readonly PlanSafeguardPause[];
  pendingApplicationReviewCount?: number;
  activeCampaignId?: string | null;
  isPlanSwitchPending?: boolean;
  onSelectCampaign?: (campaignId: string) => void;
  browserSession: BrowserSessionState;
  companies?: readonly CompanyEntity[];
  discoveryRunFeedback?: DiscoveryRunFeedback | null;
  discoverySessions: readonly DiscoveryAdapterSessionState[];
  isBrowserSessionPending: boolean;
  isBrowserSessionPendingForTarget: (targetId: string) => boolean;
  isDiscoveryAllPending: boolean;
  isActivityPausePending?: boolean;
  isJobPending: (jobId: string) => boolean;
  isTargetPending: (targetId: string) => boolean;
  jobs: readonly SavedJob[];
  dismissedJobs: readonly SavedJob[];
  liveEvents: readonly DiscoveryActivityEvent[];
  onBackToRapidReview?: () => void;
  /** Cancels the active run through the same fenced request the Task Center uses. */
  onCancelDiscovery?: (runId: string) => Promise<boolean>;
  onResumeActivity?: () => void;
  onDismissJob: (
    jobId: string,
    reasons: readonly DiscoveryFeedbackReason[],
    action?: "hide_job" | "hide_and_exclude_employer",
    expectedNormalizedCompanyName?: string | null,
  ) => void | Promise<void>;
  onPreviewEmployerExclusion?: (
    jobId: string,
  ) => Promise<EmployerExclusionPreview>;
  onRemoveEmployerExclusion?: (input: {
    jobId: string;
    normalizedCompanyName: string;
  }) => void;
  onRestoreDismissedJob: (jobId: string) => void;
  onOpenBrowserSession: () => void;
  onOpenBrowserSessionForTarget: (targetId: string) => void;
  onOpenCompany?: (companyId: string) => void;
  onOpenApplication?: (recordId: string) => void;
  /** Opens a job's original listing page in the Job Finder browser. */
  onOpenListing?: (url: string) => void;
  onQueueJob: (jobId: string) => void | Promise<JobFinderQueuedJobOutcome>;
  onRunAgentDiscovery:
    | ((searchRequest?: JobFinderSearchRequest) => void)
    | undefined;
  onRunDiscoveryForTarget?: (targetId: string) => void;
  onSelectJob: (jobId: string) => void;
  recentRuns: readonly DiscoveryRunRecord[];
  searchPreferences: JobSearchPreferences;
  /** How picky the search is, from Settings, AI behavior; shown read-only. */
  searchSelectivity?: JobSearchSelectivity | null;
  preserveSelectedJob?: boolean;
  selectedJob: SavedJob | null;
  selectedSourceTargetId?: string | null;
  sourceAccessPrompts: readonly SourceAccessPrompt[];
}) {
  const {
    actionState,
    activityPaused = false,
    activeRun,
    applicationRecords = [],
    reviewQueue = [],
    campaigns,
    safeguardPauses = [],
    pendingApplicationReviewCount = 0,
    activeCampaignId = null,
    isPlanSwitchPending = false,
    onSelectCampaign,
    browserSession,
    companies,
    discoveryRunFeedback = null,
    discoverySessions,
    isActivityPausePending = false,
    isBrowserSessionPending,
    isBrowserSessionPendingForTarget,
    isDiscoveryAllPending,
    isJobPending,
    isTargetPending,
    jobs,
    dismissedJobs,
    liveEvents,
    onBackToRapidReview,
    onCancelDiscovery,
    onDismissJob,
    onResumeActivity,
    onPreviewEmployerExclusion,
    onRemoveEmployerExclusion,
    onRestoreDismissedJob,
    onOpenBrowserSession,
    onOpenBrowserSessionForTarget,
    onOpenCompany,
    onOpenApplication,
    onOpenListing,
    onQueueJob,
    onRunAgentDiscovery,
    onSelectJob,
    recentRuns,
    searchPreferences,
    searchSelectivity = null,
    preserveSelectedJob,
    selectedJob,
    selectedSourceTargetId,
    sourceAccessPrompts,
  } = props;
  const activeCampaignMode =
    campaigns?.find((campaign) => campaign.id === activeCampaignId)?.mode ??
    "precision";
  const [showHistory, setShowHistory] = useState(false);
  // The list opens as wide as the search ran: "Cast a wide net" (and a scale
  // plan under the middle setting) shows the weaker matches too, the same
  // rule that picks the run's own mode. "Best matches only" always opens on
  // the strong matches.
  const opensWide = resolveDiscoveryListOpensWide(
    searchSelectivity,
    activeCampaignMode,
  );
  const [showAlsoFound, setShowAlsoFound] = useState(() => opensWide);
  useEffect(() => {
    setShowAlsoFound(opensWide);
  }, [activeCampaignId, opensWide]);
  // What the results panel actually displays on its current filtered and
  // paginated page. Null state means "not reported yet"; an explicit null
  // jobId means the panel is showing no results at all.
  const [displayedSelection, setDisplayedSelection] = useState<{
    jobId: string | null;
  } | null>(null);
  // Results-mode feedback for the Shortlist decision, keyed by the exact
  // clicked job. Each `onQueueJob` call resolves its own awaited outcome, so
  // overlapping shortlists resolving out of order, search completions, and
  // Hide/Restore route messages can never cross-label a row. Route action
  // statuses share one surface above both workspaces (never duplicated in
  // either), so this per-row surface neither duplicates them nor lets a
  // route-level failure adopt another row's attribution.
  const [queueOutcomesByJobId, setQueueOutcomesByJobId] = useState<
    ReadonlyMap<string, JobFinderQueuedJobOutcome>
  >(new Map());
  // Single-shot stop request for the currently running discovery run. The
  // request reuses the same fenced cancellation as the Task Center, so the
  // local flag only keeps the header control from sending duplicates until
  // the run leaves its running state.
  const [isStopSearchRequested, setIsStopSearchRequested] = useState(false);
  const handleQueueJob = useCallback(
    (jobId: string) => {
      // Request-local attribution: each click owns its own resolved outcome,
      // so overlapping shortlists, search completions, and shared route
      // messages can never cross-label another row.
      void Promise.resolve(onQueueJob(jobId))
        .then((outcome) => {
          if (!outcome) {
            return;
          }
          setQueueOutcomesByJobId((current) =>
            new Map(current).set(jobId, outcome),
          );
        })
        .catch(() => {
          setQueueOutcomesByJobId((current) =>
            new Map(current).set(jobId, {
              message: "The requested Job Finder action failed.",
              status: "failure",
            }),
          );
        });
    },
    [onQueueJob],
  );
  // Results own the page. Search setup is a disclosure opened from the search
  // bar's chips, so editing what the search looks for never costs a
  // navigation act and never hides a finished search behind a tab.
  // Results own the page from the first visit too: the goal box and Search
  // now are the whole setup a person needs; the defaults panel is one click.
  const [openSetupChipId, setOpenSetupChipId] = useState<string | null>(null);
  const isSetupOpen = openSetupChipId !== null;
  const selectedPlanLatestRun = useMemo(
    () => getNewestRunForCampaign(recentRuns, activeCampaignId),
    [activeCampaignId, recentRuns],
  );
  const selectedPlanSafeguardRoute =
    safeguardPauses.find((pause) => pause.campaignId === activeCampaignId)
      ?.route ?? null;
  const selectedPlanRunReportLabel = useMemo(() => {
    if (selectedPlanLatestRun?.state !== "completed") return null;
    const counts = getDiscoveryRunReportCounts(selectedPlanLatestRun);
    return hasDiscoveryRunReportCounts(counts)
      ? formatDiscoveryRunReportLabel(counts)
      : null;
  }, [selectedPlanLatestRun]);
  const selectedPlanRunFeedback = useMemo(() => {
    if (
      activeRun?.state === "running" &&
      activeRun.campaignId === activeCampaignId
    ) {
      return createDiscoveryRunStartedFeedback();
    }
    if (!selectedPlanLatestRun) return null;
    if (selectedPlanLatestRun.state === "completed") {
      if (selectedPlanSafeguardRoute) {
        return createDiscoveryRunSafeguardPausedFeedback(
          selectedPlanSafeguardRoute,
        );
      }
      return createDiscoveryRunSucceededFeedback(
        null,
        selectedPlanRunReportLabel ??
          formatDiscoveryRunCountLabel(
            getDiscoveryRunCountEvidence(selectedPlanLatestRun, null),
          ),
      );
    }
    if (selectedPlanLatestRun.state === "cancelled") {
      return createDiscoveryRunCancelledFeedback({
        savedJobCount: selectedPlanLatestRun.summary.validJobsFound,
      });
    }
    if (selectedPlanLatestRun.state === "failed") {
      return createDiscoveryRunInterruptedFeedback({
        detail: selectedPlanLatestRun.summary.warnings.at(-1) ?? null,
      });
    }
    return null;
  }, [
    activeCampaignId,
    activeRun,
    selectedPlanLatestRun,
    selectedPlanRunReportLabel,
    selectedPlanSafeguardRoute,
  ]);
  const failureSupersededByCompletedRun =
    discoveryRunFeedback?.status === "failed" &&
    discoveryRunFeedback.recordedAtMs !== undefined &&
    selectedPlanLatestRun?.state === "completed" &&
    selectedPlanLatestRun.completedAt !== null &&
    Date.parse(selectedPlanLatestRun.completedAt) >
      discoveryRunFeedback.recordedAtMs;
  const currentDiscoveryRunFeedback =
    discoveryRunFeedback &&
    ((discoveryRunFeedback.status === "failed" &&
      !failureSupersededByCompletedRun) ||
      selectedPlanLatestRun === null ||
      (discoveryRunFeedback.status === "started" &&
        (activeRun == null || activeRun.campaignId === activeCampaignId)))
      ? discoveryRunFeedback
      : selectedPlanRunFeedback;
  // A dismissed banner stays gone for that exact verdict; the next run, or
  // the same run changing state, brings a fresh one.
  const [dismissedFeedbackKey, setDismissedFeedbackKey] = useState<
    string | null
  >(null);
  const currentFeedbackKey = currentDiscoveryRunFeedback
    ? `${currentDiscoveryRunFeedback.status}|${currentDiscoveryRunFeedback.headline}|${activeRun?.id ?? selectedPlanLatestRun?.id ?? ""}`
    : null;
  const visibleDiscoveryRunFeedback =
    currentFeedbackKey !== null && currentFeedbackKey === dismissedFeedbackKey
      ? null
      : currentDiscoveryRunFeedback;
  const [dismissedActionMessage, setDismissedActionMessage] = useState<
    string | null
  >(null);
  // A search that starts while setup is open would finish behind the setup
  // panel: the completion banner and results were invisible until the user
  // happened to close it. Starting a run closes setup.
  useEffect(() => {
    if (visibleDiscoveryRunFeedback?.status === "started") {
      setOpenSetupChipId(null);
    }
  }, [visibleDiscoveryRunFeedback?.status]);
  // The wait belongs beside the control that started it, in the same
  // vocabulary Home and Search history use for the finished run.
  const liveSearchProgressLabel = useMemo(() => {
    if (activeRun?.state !== "running") {
      return null;
    }

    const evidence = getDiscoveryRunCountEvidence(
      activeRun,
      liveEvents.at(-1) ?? null,
    );
    return evidence.distinctJobsRetained > 0 || evidence.duplicatesMerged > 0
      ? formatDiscoveryRunCountLabel(evidence)
      : null;
  }, [activeRun, liveEvents]);
  // The agent's own latest note, with the source it is on and how long ago
  // it said it, so a slow model turn or a long page read never reads as a
  // frozen page.
  const liveStatusLine = useMemo(() => {
    if (activeRun?.state !== "running") return null;
    const events =
      liveEvents.length > 0 ? liveEvents : (activeRun.activity ?? []);
    const latest = [...events]
      .reverse()
      .find((event) => event.message && event.message.trim().length > 0);
    if (!latest) return null;
    const target = latest.targetId
      ? searchPreferences.discovery.targets.find(
          (entry) => entry.id === latest.targetId,
        )
      : null;
    const done = activeRun.summary.targetsCompleted;
    const planned = activeRun.summary.targetsPlanned;
    const agoMs = Date.now() - Date.parse(latest.timestamp);
    const ago =
      Number.isFinite(agoMs) && agoMs >= 60_000
        ? ` (${Math.floor(agoMs / 60_000)} min ago)`
        : "";
    return [
      target ? `${target.label}:` : null,
      `${latest.message.replace(/\.$/u, "")}${ago}.`,
      planned > 0 ? `${done} of ${planned} sources done.` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }, [activeRun, liveEvents, searchPreferences.discovery.targets]);
  const workspaceMode: "results" | "setup" = isSetupOpen ? "setup" : "results";
  const setWorkspaceMode = useCallback((mode: "results" | "setup") => {
    setOpenSetupChipId(mode === "setup" ? "roles" : null);
  }, []);
  // One-shot reveal: a workspace that opens empty lands on Search setup, and
  // the first arrival of saved results switches to Results exactly once so a
  // first successful search is never hidden behind the setup tab. The flag is
  // latched, so later empty→nonempty transitions stay wherever the user
  // navigated instead of yanking them back.
  const hasRevealedFirstResultsRef = useRef(jobs.length > 0);
  const firstResultRevealPendingRef = useRef(false);
  useLayoutEffect(() => {
    // Detect the first arrival in the same layout phase as settlement. A
    // passive effect can otherwise set the pending ref after this effect has
    // already run; when the user is already on Results, its no-op state update
    // would not produce another commit to settle the route header.
    if (!hasRevealedFirstResultsRef.current && jobs.length > 0) {
      hasRevealedFirstResultsRef.current = true;
      firstResultRevealPendingRef.current = true;

      if (workspaceMode === "setup") {
        setWorkspaceMode("results");
        return undefined;
      }
    }

    if (!firstResultRevealPendingRef.current || workspaceMode !== "results") {
      return undefined;
    }

    firstResultRevealPendingRef.current = false;
    const settleRouteHeader = () => {
      const headerStack = document.querySelector<HTMLElement>(
        "[data-page-header-stack]",
      );
      const scrollArea = headerStack?.closest<HTMLElement>(
        "[data-locked-screen-scroll-area]",
      );
      const topContent = headerStack?.parentElement;
      const topContentHeight = topContent?.getBoundingClientRect().height ?? 0;
      const headerHeight =
        topContentHeight || headerStack?.getBoundingClientRect().height || 0;

      if (scrollArea && headerHeight > 0) {
        settleJobFinderRouteHeaderScroll(scrollArea, headerHeight);
      }
    };

    // The first-results render changes the locked layout's top height. Run
    // once after commit and once after that geometry settles so a browser
    // reveal can never leave the route title half under the fixed shell.
    settleRouteHeader();
    if (typeof window.requestAnimationFrame !== "function") {
      return undefined;
    }
    const frame = window.requestAnimationFrame(settleRouteHeader);
    return () => window.cancelAnimationFrame(frame);
  }, [jobs.length, setWorkspaceMode, workspaceMode]);
  const stableReadStageSnapshotRef = useRef<StableDiscoveryRunSnapshot | null>(
    null,
  );
  const stableReadStage = updateStableDiscoveryRunSnapshot({
    current: stableReadStageSnapshotRef.current,
    jobs,
    runId: activeRun?.state === "running" ? activeRun.id : null,
  });
  stableReadStageSnapshotRef.current = stableReadStage.snapshot;
  const stableJobs = stableReadStage.jobs;
  const stableSelectedJob = selectedJob
    ? (stableJobs.find((job) => job.id === selectedJob.id) ?? selectedJob)
    : null;
  const resultVisibility = useMemo(
    () =>
      getDiscoveryResultVisibility(
        stableJobs,
        stableSelectedJob,
        showAlsoFound,
        preserveSelectedJob,
        stableReadStage.snapshot?.jobIds,
      ),
    [
      activeRun?.id,
      activeRun?.state,
      stableJobs,
      stableSelectedJob,
      showAlsoFound,
      preserveSelectedJob,
    ],
  );
  const inspectedJob = getDiscoveryInspectedJob(
    resultVisibility.jobs,
    selectedJob?.id ?? null,
    displayedSelection?.jobId,
  );
  // Only the inspected job's own resolved outcome is eligible for display;
  // switching rows drops every other entry so no stale outcome replays later.
  useEffect(() => {
    const inspectedJobId = inspectedJob?.id ?? null;
    setQueueOutcomesByJobId((current) => {
      if (current.size === 0) {
        return current;
      }
      const next = new Map<string, JobFinderQueuedJobOutcome>();
      for (const [jobId, outcome] of current) {
        if (jobId === inspectedJobId) {
          next.set(jobId, outcome);
        }
      }
      return next.size === current.size ? current : next;
    });
  }, [inspectedJob?.id]);
  const inspectedJobQueueFeedback = inspectedJob
    ? (queueOutcomesByJobId.get(inspectedJob.id) ?? null)
    : null;
  const hasInspectableJob = inspectedJob !== null;
  const selectedJobCompanyId =
    inspectedJob && (companies ?? []).length > 0
      ? ((companies ?? []).find(
          (company) =>
            isListableCompanyName(company.canonicalName) &&
            company.jobIds.includes(inspectedJob.id),
        )?.id ?? null)
      : null;
  const hiddenJobCount = resultVisibility.hiddenAlsoFoundCount;
  // A focused view with nothing in it and results behind the reveal is a
  // list lying about a search that found jobs. Show them.
  const focusedViewIsEmpty =
    !showAlsoFound && hiddenJobCount > 0 && resultVisibility.jobs.length === 0;
  useEffect(() => {
    if (focusedViewIsEmpty) setShowAlsoFound(true);
  }, [focusedViewIsEmpty]);

  const showEmptyDiscoveryState = jobs.length === 0;
  // Newest-run truth for the results panel's empty states, so a failed or
  // cancelled latest attempt never renders as "no matches" or "first search".
  const latestRunVerdict = useMemo(
    () => getDiscoveryLatestRunVerdict(recentRuns),
    [recentRuns],
  );
  // Run-level warnings the newest run recorded about its own evidence (for
  // example: only listing cards were read). They are printed verbatim beside
  // the run outcome instead of being re-derived from the results on screen.
  const latestRunNotices = useMemo(
    () => getDiscoveryLatestRunNotices(recentRuns),
    [recentRuns],
  );
  const enabledTargetIds = new Set(
    searchPreferences.discovery.targets
      .filter((target) => target.enabled)
      .map((target) => target.id),
  );
  const enabledSourceAccessPrompts = sourceAccessPrompts.filter((prompt) =>
    enabledTargetIds.has(prompt.targetId),
  );
  const primarySourceAccessPrompt =
    (selectedSourceTargetId
      ? enabledSourceAccessPrompts.find(
          (prompt) => prompt.targetId === selectedSourceTargetId,
        )
      : null) ??
    enabledSourceAccessPrompts.find(
      (prompt) => prompt.state === "prompt_login_required",
    ) ??
    enabledSourceAccessPrompts[0] ??
    null;
  const runtimeProjection = getDiscoveryRuntimeProjection(browserSession);
  // A run that is active now, or whose newest attempt completed, proves the
  // browser runtime works; a stale blocked snapshot must not gate the next
  // search or contradict the results on screen.
  const trustRecentRun =
    activeRun?.state === "running" ||
    isDiscoveryAllPending ||
    latestRunVerdict.kind === "completed";
  const searchReadiness = getDiscoverySearchReadiness(
    searchPreferences,
    browserSession,
    { trustRecentRun },
  );
  const hasOfflineCatalogRows =
    runtimeProjection.isOffline && resultVisibility.jobs.length > 0;
  let primaryRecoveryAction: {
    label: string;
    pending: boolean;
    nextStep: string;
    onAction: () => void;
  } | null = null;
  if (
    !runtimeProjection.isOffline &&
    primarySourceAccessPrompt?.state === "prompt_login_required"
  ) {
    if (browserSession.status === "ready" && props.onRunDiscoveryForTarget) {
      primaryRecoveryAction = {
        label: `I'm signed in — retry ${primarySourceAccessPrompt.targetLabel}`,
        pending: isTargetPending(primarySourceAccessPrompt.targetId),
        nextStep:
          "Job Finder will check only this source and show the sign-in handoff again if access is still blocked.",
        onAction: () =>
          props.onRunDiscoveryForTarget?.(primarySourceAccessPrompt.targetId),
      };
    } else {
      primaryRecoveryAction = {
        label: primarySourceAccessPrompt.actionLabel,
        pending: isBrowserSessionPendingForTarget(
          primarySourceAccessPrompt.targetId,
        ),
        nextStep:
          "Job Finder will wait while you sign in, then you can confirm and retry only this source.",
        onAction: () =>
          onOpenBrowserSessionForTarget(primarySourceAccessPrompt.targetId),
      };
    }
  } else if (
    !runtimeProjection.isOffline &&
    (browserSession.status === "blocked" ||
      browserSession.status === "login_required")
  ) {
    // A browser that is merely not open never needs recovery: the search
    // opens it. Only a blocked or sign-in-pending session earns a handoff.
    primaryRecoveryAction = primarySourceAccessPrompt
      ? {
          label: primarySourceAccessPrompt.actionLabel,
          pending: isBrowserSessionPendingForTarget(
            primarySourceAccessPrompt.targetId,
          ),
          nextStep: primarySourceAccessPrompt.rerunLabel
            ? `Then ${primarySourceAccessPrompt.rerunLabel}.`
            : "Then search again.",
          onAction: () =>
            onOpenBrowserSessionForTarget(primarySourceAccessPrompt.targetId),
        }
      : {
          label:
            browserSession.status === "blocked"
              ? `${OPEN_JOB_FINDER_BROWSER_ACTION} to recover`
              : `${OPEN_JOB_FINDER_BROWSER_ACTION} to sign in`,
          pending: isBrowserSessionPending,
          nextStep: "Then search again.",
          onAction: onOpenBrowserSession,
        };
  }
  const hasEnabledSources = searchReadiness.enabledSourceCount > 0;
  const hasLocations = searchPreferences.locations.length > 0;
  // A single-source run also occupies the shared discovery pipeline; every
  // Search now control must refuse a concurrent click instead of relying on
  // the main process to reject it. Paused activity refuses for the same
  // reason: the run would be rejected, so the controls say so up front.
  const liveRunId = isDiscoveryAllPending ? liveEvents.at(-1)?.runId : null;
  // A stop request the search never answered must not hold the screen. Once
  // the release window passes the run is reported as stopped and every
  // control it was disabling — the plan dropdown included — comes back.
  const stopState = useDiscoveryStopState(activeRun);
  const isStopUnacknowledged = stopState === "unacknowledged";
  const activeRunId = isStopUnacknowledged
    ? null
    : activeRun?.state === "running"
      ? activeRun.id
      : (liveRunId ?? null);
  const isActiveRunRunning = activeRunId !== null;
  // Leaving the running state always re-arms stop for the next run, whether
  // the run completed, failed, or honoured the cancellation request.
  useEffect(() => {
    if (!isActiveRunRunning) {
      setIsStopSearchRequested(false);
    }
  }, [isActiveRunRunning]);
  const handleStopSearch = useCallback(() => {
    if (!onCancelDiscovery || !isActiveRunRunning || isStopSearchRequested) {
      return;
    }
    // Stop means stop. The confirm dialog that used to stand here cost a
    // click and, in a scripted browser, silently swallowed every stop.
    setIsStopSearchRequested(true);
    void onCancelDiscovery(activeRunId).then((accepted) => {
      if (!accepted) {
        setIsStopSearchRequested(false);
      }
    });
  }, [
    activeRunId,
    isActiveRunRunning,
    isStopSearchRequested,
    onCancelDiscovery,
  ]);
  const isAnyDiscoveryRunActive =
    !isStopUnacknowledged &&
    (activeRun?.state === "running" || isDiscoveryAllPending);
  const isSearchUnavailable = activityPaused || isAnyDiscoveryRunActive;
  const savedSourceCount = searchPreferences.discovery.targets.length;
  const searchSetupBlocker =
    showEmptyDiscoveryState && !hasEnabledSources
      ? {
          title:
            savedSourceCount > 0
              ? "Enable a source before searching"
              : "Choose at least one source before searching",
          description:
            savedSourceCount > 0
              ? "Sources are saved but none are turned on, so Search stays disabled. Enable a saved source in Profile, then search."
              : "Enable at least one source in Profile so Find jobs has somewhere to search. Your profile will guide the search even when you leave target roles blank.",
          actionLabel:
            savedSourceCount > 0 ? "Enable sources" : "Add a job source",
          actionHref: JOB_FINDER_ROUTE_PATHS.profileSources,
          nextStep: hasLocations
            ? "Then search again."
            : "Then add locations if you want tighter matches and search again.",
        }
      : null;

  // Keep the readiness explanation out of the title/action grid. It is a
  // route-level status row, so the title keeps its full width while the
  // Search now button remains aligned with the configured search summary.
  const discoveryHeaderStatus =
    workspaceMode !== "results" ? null : activityPaused ? (
      <span
        className="block w-full min-w-0 text-(length:--text-description) leading-5 text-(--warning-text)"
        id="discovery-header-search-paused-reason"
        role="status"
      >
        {DISCOVERY_PAUSED_SEARCH_REASON}
      </span>
    ) : searchReadiness.ready ||
      searchSetupBlocker ||
      hasOfflineCatalogRows ? null : (
      <span
        className="flex w-full min-w-0 flex-wrap items-center gap-2 text-(length:--text-description) leading-5 text-(--warning-text)"
        id="discovery-header-search-disabled-reason"
        role="status"
      >
        <span className="min-w-0 flex-1 break-words">
          {searchReadiness.reason}
        </span>
        {/* The action is derived from the exact blocker so a browser problem
            never reads as "Enable sources" while a source is already on. */}
        {searchReadiness.blocker === "browser_blocked" ? (
          <Button
            className="h-8 shrink-0 whitespace-nowrap px-3 text-xs normal-case tracking-normal"
            onClick={onOpenBrowserSession}
            pending={isBrowserSessionPending}
            size="sm"
            type="button"
            variant="primary"
          >
            {OPEN_JOB_FINDER_BROWSER_ACTION}
          </Button>
        ) : searchReadiness.blocker === "no_search_roles" ? (
          <Button
            asChild
            className="h-8 shrink-0 whitespace-nowrap px-3 text-xs normal-case tracking-normal"
            size="sm"
            variant="primary"
          >
            <Link to={JOB_FINDER_ROUTE_PATHS.profileTargetRoles}>
              Add target roles
            </Link>
          </Button>
        ) : searchReadiness.blocker === "no_enabled_sources" ? (
          <Button
            asChild
            className="h-8 shrink-0 whitespace-nowrap px-3 text-xs normal-case tracking-normal"
            size="sm"
            variant="primary"
          >
            <Link to={JOB_FINDER_ROUTE_PATHS.profileSources}>
              {savedSourceCount > 0 ? "Enable sources" : "Add sources"}
            </Link>
          </Button>
        ) : null}
      </span>
    );
  const headerStatusWithReview =
    discoveryHeaderStatus ??
    (pendingApplicationReviewCount > 0 ? (
      <span
        className="flex w-full min-w-0 flex-wrap items-center gap-2 text-(length:--text-description) leading-5 text-foreground-soft"
        role="status"
      >
        {pendingApplicationReviewCount === 1
          ? "A prepared application sample needs review before more applications can be prepared. Searching is available."
          : `${pendingApplicationReviewCount} prepared application samples need review before more applications can be prepared. Searching is available.`}
        <Button asChild size="sm" type="button" variant="outline">
          <Link to="/job-finder/safeguards?tab=reviews">
            Review prepared sample
          </Link>
        </Button>
      </span>
    ) : null);

  const filtersPanel = (
    <DiscoveryFiltersPanel
      activeRun={activeRun}
      activityPaused={activityPaused}
      browserSession={browserSession}
      discoverySessions={discoverySessions}
      isAnyDiscoveryRunActive={isAnyDiscoveryRunActive}
      isBrowserSessionPending={isBrowserSessionPending}
      isBrowserSessionPendingForTarget={isBrowserSessionPendingForTarget}
      isDiscoveryAllPending={isDiscoveryAllPending}
      isTargetPending={isTargetPending}
      planEditorHref={JOB_FINDER_ROUTE_PATHS.profileWorkModes}
      onOpenBrowserSession={onOpenBrowserSession}
      onOpenBrowserSessionForTarget={onOpenBrowserSessionForTarget}
      // The search bar above owns the single Search command, so the setup
      // panel keeps only its own secondary browser and history actions.
      onRunAgentDiscovery={undefined}
      {...(props.onRunDiscoveryForTarget
        ? { onRunDiscoveryForTarget: props.onRunDiscoveryForTarget }
        : {})}
      onViewProgress={() => setShowHistory(true)}
      searchPreferences={searchPreferences}
      searchSelectivity={searchSelectivity}
      sourceAccessPrompts={sourceAccessPrompts}
      trustRecentRun={trustRecentRun}
    />
  );

  const recoveryActionProps = primaryRecoveryAction
    ? {
        onRecoveryAction: primaryRecoveryAction.onAction,
        recoveryActionLabel: primaryRecoveryAction.label,
        recoveryActionNextStep: primaryRecoveryAction.nextStep,
        recoveryActionPending: primaryRecoveryAction.pending,
      }
    : {};

  const resultsWorkspace = (
    <div
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-1 items-stretch gap-4 xl:h-full xl:min-h-0 xl:overflow-hidden",
        hasInspectableJob
          ? "xl:grid-cols-[minmax(30rem,1.35fr)_minmax(25rem,0.9fr)]"
          : "xl:grid-cols-1",
      )}
      id="discovery-workspace-content"
    >
      <div
        className={
          dismissedJobs.length > 0
            ? "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2"
            : "min-h-0 min-w-0"
        }
      >
        {dismissedJobs.length > 0 ? (
          <details className="rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel) px-3 py-2">
            <summary className="cursor-pointer text-(length:--text-small) font-medium text-foreground-soft">
              Hidden by you ({dismissedJobs.length})
            </summary>
            <p className="mt-2 text-(length:--text-small) leading-5 text-foreground-muted">
              Hidden jobs stay on this device and do not change fit scores.
            </p>
            <ul className="mt-3 grid gap-2">
              {dismissedJobs.map((job) => (
                <li
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-(--surface-panel-border) pt-2"
                  key={job.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-(length:--text-small) font-medium text-foreground">
                      {job.title}
                    </p>
                    <p className="text-(length:--text-tiny) text-foreground-muted">
                      {job.discoveryFeedback?.reasons
                        .map(formatDiscoveryHideReason)
                        .join(" · ") ?? "Hidden without saved reasons"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.discoveryFeedback?.employerExclusion &&
                    onRemoveEmployerExclusion ? (
                      <Button
                        disabled={isJobPending(job.id)}
                        onClick={() =>
                          onRemoveEmployerExclusion({
                            jobId: job.id,
                            normalizedCompanyName:
                              job.discoveryFeedback!.employerExclusion!
                                .normalizedCompanyName,
                          })
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Allow this employer in future searches
                      </Button>
                    ) : null}
                    <Button
                      disabled={isJobPending(job.id)}
                      onClick={() => onRestoreDismissedJob(job.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Show again
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <DiscoveryResultsPanel
          alsoFoundCount={resultVisibility.alsoFoundCount}
          areAlsoFoundShown={showAlsoFound}
          browserSession={browserSession}
          discoveryTargets={searchPreferences.discovery.targets}
          emptyClassName="min-h-80"
          // Active search plan identity: the running run's campaign, else the
          // most recent run's, else the shared default scope. Facet filters
          // persist per plan so switching plans never leaks selections.
          facetScopeId={
            activeRun?.campaignId ?? recentRuns[0]?.campaignId ?? null
          }
          hasCompletedSearch={recentRuns.some(
            (run) => run.state === "completed",
          )}
          isSearchInProgress={
            activeRun?.state === "running" ||
            discoveryRunFeedback?.status === "started"
          }
          liveStatusLine={liveStatusLine}
          hiddenAlsoFoundCount={hiddenJobCount}
          inAreaJobCount={
            stableJobs.filter(
              (job) => job.matchAssessment.locationReach === "in_area",
            ).length
          }
          jobs={resultVisibility.jobs}
          latestRun={selectedPlanLatestRun}
          latestRunVerdict={latestRunVerdict}
          failureCalloutShown={
            visibleDiscoveryRunFeedback?.status === "failed" &&
            visibleDiscoveryRunFeedback.recovery !== null
          }
          preferredLocations={searchPreferences.locations}
          remoteIncluded={searchPreferences.workModes.includes("remote")}
          totalLocationJobCount={stableJobs.length}
          editPlanHref={JOB_FINDER_ROUTE_PATHS.profileWorkModes}
          onSearchAgain={onRunAgentDiscovery ?? null}
          onDisplayedSelectedJobIdChange={(jobId) =>
            setDisplayedSelection({ jobId })
          }
          onShowAlsoFound={() => setShowAlsoFound(true)}
          onToggleAlsoFound={() => setShowAlsoFound((current) => !current)}
          onSelectJob={onSelectJob}
          onShortlistJobs={(jobIds) => {
            for (const jobId of jobIds) {
              handleQueueJob(jobId);
            }
          }}
          searchSetupBlocker={searchSetupBlocker}
          selectedJob={resultVisibility.selectedJob}
          {...recoveryActionProps}
        />
      </div>
      {hasInspectableJob ? (
        <div className="min-h-0 min-w-0">
          <DiscoveryDetailPanel
            applicationRecords={applicationRecords}
            reviewQueue={reviewQueue}
            discoveryTargets={searchPreferences.discovery.targets}
            isJobPending={isJobPending}
            onDismissJob={onDismissJob}
            {...(onPreviewEmployerExclusion
              ? { onPreviewEmployerExclusion }
              : {})}
            {...(onOpenCompany ? { onOpenCompany } : {})}
            onOpenApplication={onOpenApplication ?? (() => undefined)}
            {...(onOpenListing ? { onOpenListing } : {})}
            onQueueJob={handleQueueJob}
            queueFeedback={inspectedJobQueueFeedback}
            selectedJob={inspectedJob}
            selectedJobCompanyId={selectedJobCompanyId}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <LockedScreenLayout
        contentClassName="xl:overflow-hidden"
        lockContentHeight
        topContent={
          <>
            <PageHeaderStack
              actions={
                onBackToRapidReview ? (
                  <Button
                    onClick={onBackToRapidReview}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Back to rapid review
                  </Button>
                ) : null
              }
              description="Search your job sources, then shortlist the jobs you want to apply to."
              layout="stacked-until-xl"
              status={headerStatusWithReview}
              subnav={
                // The search settings used to be a peer tab whose whole content
                // was four read-only summary rows. They are now an interactive
                // bar: each chip opens the same editor in place, and the one
                // search command lives at its right end.
                <DiscoverySearchBar
                  {...(campaigns ? { campaigns } : {})}
                  activeCampaignId={activeCampaignId}
                  isPlanSwitchPending={isPlanSwitchPending}
                  {...(onSelectCampaign ? { onSelectCampaign } : {})}
                  browserSession={browserSession}
                  isBrowserSessionPending={isBrowserSessionPending}
                  isSearchDisabled={
                    !searchReadiness.ready ||
                    isSearchUnavailable ||
                    !onRunAgentDiscovery
                  }
                  isSearchPending={isDiscoveryAllPending}
                  isSearchRunning={isActiveRunRunning}
                  resultScope={showAlsoFound ? "wide" : "focused"}
                  hiddenResultCount={showAlsoFound ? 0 : hiddenJobCount}
                  isSetupOpen={isSetupOpen}
                  openSetupChipId={openSetupChipId}
                  isStopPending={
                    !isStopUnacknowledged &&
                    (isStopSearchRequested ||
                      (activeRun?.id === activeRunId &&
                        Boolean(activeRun.cancellationRequestedAt)))
                  }
                  stoppedNotice={
                    isStopUnacknowledged
                      ? DISCOVERY_STOP_UNACKNOWLEDGED_LABEL
                      : null
                  }
                  onOpenBrowserSession={onOpenBrowserSession}
                  onRunAgentDiscovery={onRunAgentDiscovery}
                  onToggleResultScope={() =>
                    setShowAlsoFound((current) => !current)
                  }
                  onToggleSetup={setOpenSetupChipId}
                  searchActionDescribedBy={
                    activityPaused
                      ? "discovery-header-search-paused-reason"
                      : hasOfflineCatalogRows
                        ? DISCOVERY_OFFLINE_CATALOG_NOTICE_ID
                        : searchReadiness.ready || !searchSetupBlocker
                          ? undefined
                          : DISCOVERY_SEARCH_SETUP_BLOCKER_ID
                  }
                  searchPreferences={searchPreferences}
                  searchProgressLabel={liveSearchProgressLabel}
                  searchStartedAt={activeRun?.startedAt ?? null}
                  {...(onCancelDiscovery
                    ? { onStopSearch: handleStopSearch }
                    : {})}
                />
              }
              title="Find jobs"
            />
            {activityPaused ? (
              <DiscoveryPausedBanner
                isResumePending={isActivityPausePending}
                {...(onResumeActivity ? { onResolve: onResumeActivity } : {})}
              />
            ) : null}
            {/* A results banner belongs where the results are. While the
                search-setup editor is open there are no results on screen, so
                only feedback that still needs the user — a failure, a
                cancellation, a run in flight — stays visible. */}
            {visibleDiscoveryRunFeedback &&
            (!isSetupOpen ||
              visibleDiscoveryRunFeedback.status !== "succeeded") ? (
              <DiscoveryRunFeedbackCallout
                feedback={visibleDiscoveryRunFeedback}
                isRecoveryPending={isBrowserSessionPending}
                // A run in flight has recorded nothing yet, so an earlier
                // run's evidence warning must not sit under "Search started"
                // where it would read as a claim about the live attempt.
                notices={
                  visibleDiscoveryRunFeedback.status === "started"
                    ? []
                    : latestRunNotices
                }
                onDismiss={() => setDismissedFeedbackKey(currentFeedbackKey)}
                onOpenBrowserSession={onOpenBrowserSession}
                suppressBrowserRecovery={runtimeProjection.isOffline}
              />
            ) : null}
            {/* One route-owned action surface shared by Results and Search
                setup, so a failed Resume activity or any other authoritative
                refusal stays visible in every mode. It renders below the
                paused banner and run feedback so a stale message can never
                mask the pause truth or the newest run verdict. */}
            {actionState.message &&
            !visibleDiscoveryRunFeedback &&
            actionState.message !== dismissedActionMessage ? (
              <p
                aria-atomic="true"
                aria-live="polite"
                className="relative min-w-0 break-words rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) py-2 pl-3 pr-10 text-(length:--text-description) leading-5 text-foreground"
                data-testid="discovery-route-action-status"
                role="status"
              >
                {actionState.message}
                {actionState.actionLink ? (
                  <>
                    {" "}
                    <Link
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      to={actionState.actionLink.route}
                    >
                      {actionState.actionLink.label}
                    </Link>
                  </>
                ) : null}
                <Button
                  aria-label="Dismiss this notice"
                  className="absolute right-1.5 top-1 h-7 w-7 rounded-full p-0 opacity-70 hover:opacity-100"
                  onClick={() => setDismissedActionMessage(actionState.message)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </p>
            ) : null}
          </>
        }
      >
        {isSetupOpen ? (
          <div
            className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 xl:h-full"
            id={DISCOVERY_SEARCH_SETUP_PANEL_ID}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-(length:--text-small) text-foreground-muted">
                Editing what this search looks for. Results stay saved.
              </p>
              <Button
                onClick={() => setOpenSetupChipId(null)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {jobs.length > 0 ? "Back to results" : "Close search setup"}
              </Button>
            </div>
            <div className="min-h-0 min-w-0" id="discovery-workspace-content">
              {filtersPanel}
            </div>
          </div>
        ) : (
          resultsWorkspace
        )}
      </LockedScreenLayout>

      <DiscoveryHistoryModal
        activeRun={activeRun}
        isDiscoveryPending={isDiscoveryAllPending}
        isTargetPending={isTargetPending}
        liveEvents={liveEvents}
        onClose={() => setShowHistory(false)}
        {...(props.onRunDiscoveryForTarget
          ? { onRetrySource: props.onRunDiscoveryForTarget }
          : {})}
        open={showHistory}
        recentRuns={recentRuns}
        targets={searchPreferences.discovery.targets}
      />
    </>
  );
}
