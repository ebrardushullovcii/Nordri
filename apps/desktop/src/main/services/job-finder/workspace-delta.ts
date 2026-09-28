import type {
  JobFinderWorkspaceDelta,
  JobFinderWorkspaceSnapshot,
  JobFinderWorkspaceSyncResult,
  WorkspaceRevision,
} from "@nordri/contracts";

type EntitySlice<T> = {
  upserts: T[];
  removedIds: string[];
};

const DELTA_OR_IGNORED_KEYS = new Set<keyof JobFinderWorkspaceSnapshot>([
  "generatedAt",
  "discoveryRunState",
  "activeDiscoveryRun",
  "discoverySessions",
  "sourceAccessPrompts",
  "latestResumeImportRun",
  "campaigns",
  "activeCampaignId",
  "campaignNotifications",
  "dashboard",
  "activityControl",
  "intelligence",
  "discoveryJobs",
  "dismissedDiscoveryJobs",
  "companyJobs",
  "recentDiscoveryRuns",
  "reviewQueue",
  "applyRuns",
  "applyJobResults",
  "applicationRecords",
  "applicationAttempts",
  "userActionRequests",
  "userActionEvents",
  "selectedDiscoveryJobId",
  "selectedReviewJobId",
  "selectedApplyRunId",
  "selectedApplicationRecordId",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compare parsed contract values without allocating a serialized copy of the
 * entire entity. Workspace snapshots can contain hundreds of jobs and long
 * answer histories, so JSON.stringify on every entity makes a small delta
 * pay for a full payload-sized allocation repeatedly.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!sameValue(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !sameValue(left[key], right[key])
    ) {
      return false;
    }
  }

  return true;
}

function buildEntitySlice<T>(
  previous: readonly T[],
  current: readonly T[],
  getId: (value: T) => string,
): EntitySlice<T> {
  const previousById = new Map<string, T>();
  for (const value of previous) {
    previousById.set(getId(value), value);
  }

  const currentIds = new Set<string>();
  const upserts: T[] = [];
  for (const value of current) {
    const id = getId(value);
    currentIds.add(id);
    const previousValue = previousById.get(id);
    if (!previousValue || !sameValue(previousValue, value)) {
      upserts.push(value);
    }
  }

  const removedIds: string[] = [];
  for (const value of previous) {
    const id = getId(value);
    if (!currentIds.has(id)) {
      removedIds.push(id);
    }
  }

  return { upserts, removedIds };
}

function sameUntrackedValues(
  previous: JobFinderWorkspaceSnapshot,
  current: JobFinderWorkspaceSnapshot,
): boolean {
  for (const key of Object.keys(current) as Array<
    keyof JobFinderWorkspaceSnapshot
  >) {
    if (
      DELTA_OR_IGNORED_KEYS.has(key) ||
      sameValue(previous[key], current[key])
    ) {
      continue;
    }

    return false;
  }

  return true;
}

export function buildJobFinderWorkspaceDelta(input: {
  baseRevision: WorkspaceRevision;
  currentRevision: WorkspaceRevision;
  previous: JobFinderWorkspaceSnapshot;
  current: JobFinderWorkspaceSnapshot;
}): JobFinderWorkspaceDelta | null {
  if (!sameUntrackedValues(input.previous, input.current)) {
    return null;
  }

  return {
    baseRevision: input.baseRevision,
    currentRevision: input.currentRevision,
    generatedAt: input.current.generatedAt,
    discoveryRunState: input.current.discoveryRunState,
    activeDiscoveryRun: input.current.activeDiscoveryRun,
    discoverySessions: input.current.discoverySessions,
    sourceAccessPrompts: input.current.sourceAccessPrompts,
    latestResumeImportRun: input.current.latestResumeImportRun,
    campaigns: input.current.campaigns,
    activeCampaignId: input.current.activeCampaignId,
    campaignNotifications: input.current.campaignNotifications,
    dashboard: input.current.dashboard,
    activityControl: input.current.activityControl,
    intelligence: input.current.intelligence,
    selectedDiscoveryJobId: input.current.selectedDiscoveryJobId,
    selectedReviewJobId: input.current.selectedReviewJobId,
    selectedApplyRunId: input.current.selectedApplyRunId,
    selectedApplicationRecordId: input.current.selectedApplicationRecordId,
    discoveryJobs: buildEntitySlice(
      input.previous.discoveryJobs,
      input.current.discoveryJobs,
      (value) => value.id,
    ),
    dismissedDiscoveryJobs: buildEntitySlice(
      input.previous.dismissedDiscoveryJobs,
      input.current.dismissedDiscoveryJobs,
      (value) => value.id,
    ),
    companyJobs: buildEntitySlice(
      input.previous.companyJobs,
      input.current.companyJobs,
      (value) => value.id,
    ),
    recentDiscoveryRuns: buildEntitySlice(
      input.previous.recentDiscoveryRuns,
      input.current.recentDiscoveryRuns,
      (value) => value.id,
    ),
    reviewQueue: buildEntitySlice(
      input.previous.reviewQueue,
      input.current.reviewQueue,
      (value) => value.jobId,
    ),
    applyRuns: buildEntitySlice(
      input.previous.applyRuns,
      input.current.applyRuns,
      (value) => value.id,
    ),
    applyJobResults: buildEntitySlice(
      input.previous.applyJobResults,
      input.current.applyJobResults,
      (value) => value.id,
    ),
    applicationRecords: buildEntitySlice(
      input.previous.applicationRecords,
      input.current.applicationRecords,
      (value) => value.id,
    ),
    applicationAttempts: buildEntitySlice(
      input.previous.applicationAttempts,
      input.current.applicationAttempts,
      (value) => value.id,
    ),
    userActionRequests: buildEntitySlice(
      input.previous.userActionRequests,
      input.current.userActionRequests,
      (value) => value.id,
    ),
    userActionEvents: buildEntitySlice(
      input.previous.userActionEvents,
      input.current.userActionEvents,
      (value) => value.id,
    ),
  };
}

export function createJobFinderWorkspaceDeltaTracker() {
  let currentRevision: WorkspaceRevision = 0;
  let baseline: JobFinderWorkspaceSnapshot | null = null;

  return {
    synchronize(
      baseRevision: WorkspaceRevision | null,
      current: JobFinderWorkspaceSnapshot,
    ): JobFinderWorkspaceSyncResult {
      if (baseline === null || baseRevision === null) {
        currentRevision += 1;
        baseline = current;
        return {
          kind: "snapshot",
          currentRevision,
          reason: "initial",
          snapshot: current,
        };
      }

      if (baseRevision !== currentRevision) {
        const reason =
          baseRevision < currentRevision ? "stale_base" : "revision_gap";
        currentRevision += 1;
        baseline = current;
        return {
          kind: "snapshot",
          currentRevision,
          reason,
          snapshot: current,
        };
      }

      const nextRevision = currentRevision + 1;
      const delta = buildJobFinderWorkspaceDelta({
        baseRevision,
        currentRevision: nextRevision,
        previous: baseline,
        current,
      });

      currentRevision = nextRevision;
      baseline = current;

      return delta
        ? { kind: "delta", delta }
        : {
            kind: "snapshot",
            currentRevision,
            reason: "unsupported_change",
            snapshot: current,
          };
    },
  };
}
