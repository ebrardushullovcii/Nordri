import type {
  GroupedManualAnswerDecision,
  JobFinderWorkspaceSnapshot,
} from "@unemployed/contracts";
import { projectPlanSafeguardPauses } from "@unemployed/job-finder/plan-safeguard-pauses";
import { applicationRecordAwaitsUser } from "../screens/applications/applications-status";
import { resolveApplyStatePresentation } from "../screens/applications/apply-state";

/**
 * The one renderer-side owner of the "Needs you" population.
 *
 * Before this module the same twenty lines existed twice — once in
 * `job-finder-shell.tsx` for the badge and once in `job-search-home-screen.tsx`
 * for Home's next action — and `campaign-dashboard.ts` derived a third,
 * un-collapsed number. One grouped decision covering three questions therefore
 * read as 1 in the badge, 3 on Home and 0 in the Needs you toolbar.
 *
 * The population is: every user action request that is not in a final state,
 * minus the requests a pending grouped decision already represents, plus one
 * entry per pending grouped decision. That is exactly what the Needs you screen
 * renders, so the badge and the page cannot disagree.
 */
const FINAL_ACTION_REQUEST_STATES: readonly string[] = [
  "resolved",
  "skipped",
  "cancelled",
  "expired",
  "superseded",
];

export interface NeedsYouCountInput {
  /**
   * Applications the Applications screen badges "Needs you". They belong to
   * the same population: an application paused on a site step the person has
   * to finish was badged NEEDS YOU while this count said "0 unresolved",
   * because it only ever counted live browser-step requests.
   */
  applicationRecords?:
    | readonly JobFinderWorkspaceSnapshot["applicationRecords"][number][]
    | undefined;
  applyJobResults?:
    | readonly JobFinderWorkspaceSnapshot["applyJobResults"][number][]
    | undefined;
  groupedDecisions?: readonly GroupedManualAnswerDecision[] | undefined;
  requests?:
    | readonly JobFinderWorkspaceSnapshot["userActionRequests"][number][]
    | undefined;
}

/** The application-record ledger is the one application population. */
export function countApplicationLedgerEntries<
  TRecord extends { jobId: string },
>(records: readonly TRecord[], jobIds?: ReadonlySet<string>): number {
  return jobIds
    ? records.filter((record) => jobIds.has(record.jobId)).length
    : records.length;
}

/**
 * Applications waiting on the person that no live request already represents.
 * Exported so the Needs you screen lists exactly what the badge counts.
 */
export function listApplicationsAwaitingUser({
  applicationRecords,
  applyJobResults,
  requests,
}: Pick<
  NeedsYouCountInput,
  "applicationRecords" | "applyJobResults" | "requests"
>): readonly JobFinderWorkspaceSnapshot["applicationRecords"][number][] {
  const records = applicationRecords ?? [];
  if (records.length === 0) return records;

  const latestResultByRecordId = new Map<
    string,
    JobFinderWorkspaceSnapshot["applyJobResults"][number]
  >();
  for (const result of applyJobResults ?? []) {
    if (!result.applicationRecordId) continue;
    const previous = latestResultByRecordId.get(result.applicationRecordId);
    if (!previous || previous.updatedAt < result.updatedAt) {
      latestResultByRecordId.set(result.applicationRecordId, result);
    }
  }

  const coveredRecordIds = new Set(
    (requests ?? [])
      .filter((request) => !FINAL_ACTION_REQUEST_STATES.includes(request.state))
      .flatMap((request) =>
        request.scope?.type === "application" &&
        request.scope.applicationRecordId
          ? [request.scope.applicationRecordId]
          : [],
      ),
  );

  return records.filter((record) => {
    if (coveredRecordIds.has(record.id)) return false;
    const result = latestResultByRecordId.get(record.id);
    if (!result) return applicationRecordAwaitsUser(record);
    return (
      resolveApplyStatePresentation({
        mode:
          record.automationMode === "autonomous_submit"
            ? "apply_for_me"
            : "fill_only",
        result,
        pendingQuestionCount: Math.max(
          0,
          record.questionSummary.total - record.questionSummary.answered,
        ),
        recordFailure:
          record.lastAttemptState === "failed"
            ? {
                lastActionLabel: record.lastActionLabel,
                lastUpdatedAt: record.lastUpdatedAt,
              }
            : null,
      }).kind === "needs_you"
    );
  });
}

export function countNeedsYouItems({
  applicationRecords,
  applyJobResults,
  groupedDecisions,
  requests,
}: NeedsYouCountInput): number {
  const unresolved = (requests ?? []).filter(
    (request) => !FINAL_ACTION_REQUEST_STATES.includes(request.state),
  );
  const pendingDecisions = (groupedDecisions ?? []).filter(
    (decision) => decision.approval === "pending",
  );
  // A pending grouped decision represents its member requests on the Needs you
  // screen, so the count counts the decision card instead of the hidden
  // ordinary member cards.
  const representedRequestIds = new Set(
    pendingDecisions.flatMap((decision) =>
      decision.lineage.map((entry) => entry.requestId),
    ),
  );
  const unrepresentedRequests = unresolved.filter(
    (request) => !representedRequestIds.has(request.id),
  );

  return (
    unrepresentedRequests.length +
    pendingDecisions.length +
    listApplicationsAwaitingUser({
      applicationRecords,
      applyJobResults,
      requests,
    }).length
  );
}

/**
 * How many of one apply run's jobs the Needs you population holds.
 *
 * The Applications run summary used to count the run's own blocked and failed
 * results directly, so a finished batch printed "5 need attention" beside a
 * header badge reading "Needs you: 4 unresolved" for the same five jobs: one
 * of them was blocked without ever becoming something the person could act
 * on. Both numbers now come from this module — the summary counts this run's
 * share of exactly the population the badge totals — so the two can only
 * differ by what belongs to another run.
 */
export function countApplyRunItemsNeedingYou({
  applicationRecords,
  applyJobResults,
  requests,
  runId,
  runJobIds,
}: NeedsYouCountInput & {
  runId: string;
  runJobIds: ReadonlySet<string>;
}): number {
  const runRequests = (requests ?? []).filter(
    (request) =>
      request.scope?.type === "application" &&
      (request.scope.runId === runId || runJobIds.has(request.scope.jobId)),
  );
  const unresolvedRunRequests = runRequests.filter(
    (request) => !FINAL_ACTION_REQUEST_STATES.includes(request.state),
  );
  const runApplications = (applicationRecords ?? []).filter((record) =>
    runJobIds.has(record.jobId),
  );

  return (
    unresolvedRunRequests.length +
    listApplicationsAwaitingUser({
      applicationRecords: runApplications,
      applyJobResults,
      requests: runRequests,
    }).length
  );
}

/** Convenience reader for callers that already hold the whole snapshot. */
export function countWorkspaceNeedsYouItems(
  workspace: JobFinderWorkspaceSnapshot,
): number {
  return (
    projectPlanSafeguardPauses(
      workspace.intelligence?.safeguards,
      workspace.campaigns,
    ).length +
    countNeedsYouItems({
      applicationRecords: workspace.applicationRecords ?? [],
      applyJobResults: workspace.applyJobResults ?? [],
      groupedDecisions: workspace.intelligence?.groupedDecisions ?? [],
      requests: workspace.userActionRequests ?? [],
    })
  );
}
