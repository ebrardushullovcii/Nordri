import type {
  JobFinderWorkspaceDelta,
  JobFinderWorkspaceSnapshot,
  WorkspaceRevision,
} from "@nordri/contracts";

export type WorkspaceDeltaApplyResult =
  | {
      status: "applied";
      revision: WorkspaceRevision;
      workspace: JobFinderWorkspaceSnapshot;
    }
  | { status: "stale" }
  | { status: "gap" };

const STRUCTURAL_EQUAL_MAX_DEPTH = 24;

function structuralEqual(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (depth >= STRUCTURAL_EQUAL_MAX_DEPTH) {
    return false;
  }
  if (isReadonlyArray(left)) {
    if (!isReadonlyArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) =>
      structuralEqual(item, right[index], depth + 1),
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      structuralEqual(left[key], right[key], depth + 1),
  );
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || isReadonlyArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function applyEntitySlice<T>(
  current: readonly T[],
  upserts: readonly T[],
  removedIds: readonly string[],
  getId: (value: T) => string,
): T[] {
  if (upserts.length === 0 && removedIds.length === 0) {
    return current as T[];
  }

  let changed = false;
  const removed = new Set(removedIds);
  const upsertsById = new Map(upserts.map((value) => [getId(value), value]));
  const next: T[] = [];
  const existingIds = new Set<string>();

  for (const value of current) {
    const id = getId(value);
    if (removed.has(id)) {
      changed = true;
      continue;
    }
    const upsert = upsertsById.get(id);
    if (upsert === undefined) {
      next.push(value);
      existingIds.add(id);
      continue;
    }
    if (upsert !== value && !structuralEqual(upsert, value)) {
      changed = true;
      next.push(upsert);
    } else {
      next.push(value);
    }
    existingIds.add(id);
  }

  for (const value of upserts) {
    const id = getId(value);
    if (removed.has(id) || existingIds.has(id)) {
      continue;
    }
    next.push(value);
    existingIds.add(id);
    changed = true;
  }

  return changed ? next : (current as T[]);
}

function preserveValidSelection<T>(input: {
  requestedId: string | null;
  previousId: string | null;
  entities: readonly T[];
  getId: (value: T) => string;
}): string | null {
  const availableIds = new Set(input.entities.map(input.getId));

  if (input.requestedId && availableIds.has(input.requestedId)) {
    return input.requestedId;
  }

  if (input.previousId && availableIds.has(input.previousId)) {
    return input.previousId;
  }

  return input.entities[0] ? input.getId(input.entities[0]) : null;
}

export function applyJobFinderWorkspaceDelta(input: {
  revision: WorkspaceRevision;
  workspace: JobFinderWorkspaceSnapshot;
  delta: JobFinderWorkspaceDelta;
}): WorkspaceDeltaApplyResult {
  if (input.delta.currentRevision <= input.revision) {
    return { status: "stale" };
  }

  if (
    input.delta.baseRevision !== input.revision ||
    input.delta.currentRevision !== input.revision + 1
  ) {
    return { status: "gap" };
  }

  const discoveryJobs = applyEntitySlice(
    input.workspace.discoveryJobs,
    input.delta.discoveryJobs.upserts,
    input.delta.discoveryJobs.removedIds,
    (value) => value.id,
  );
  const reviewQueue = applyEntitySlice(
    input.workspace.reviewQueue,
    input.delta.reviewQueue.upserts,
    input.delta.reviewQueue.removedIds,
    (value) => value.jobId,
  );
  const applyRuns = applyEntitySlice(
    input.workspace.applyRuns,
    input.delta.applyRuns.upserts,
    input.delta.applyRuns.removedIds,
    (value) => value.id,
  );
  const applicationRecords = applyEntitySlice(
    input.workspace.applicationRecords,
    input.delta.applicationRecords.upserts,
    input.delta.applicationRecords.removedIds,
    (value) => value.id,
  );

  return {
    status: "applied",
    revision: input.delta.currentRevision,
    workspace: {
      ...input.workspace,
      generatedAt: input.delta.generatedAt,
      discoveryRunState: input.delta.discoveryRunState,
      activeDiscoveryRun: input.delta.activeDiscoveryRun,
      discoverySessions: input.delta.discoverySessions,
      sourceAccessPrompts: input.delta.sourceAccessPrompts,
      latestResumeImportRun: input.delta.latestResumeImportRun,
      campaigns: input.delta.campaigns,
      activeCampaignId: input.delta.activeCampaignId,
      campaignNotifications: input.delta.campaignNotifications,
      dashboard: input.delta.dashboard,
      activityControl: input.delta.activityControl,
      intelligence: input.delta.intelligence,
      discoveryJobs,
      dismissedDiscoveryJobs: applyEntitySlice(
        input.workspace.dismissedDiscoveryJobs,
        input.delta.dismissedDiscoveryJobs.upserts,
        input.delta.dismissedDiscoveryJobs.removedIds,
        (value) => value.id,
      ),
      companyJobs: applyEntitySlice(
        input.workspace.companyJobs,
        input.delta.companyJobs.upserts,
        input.delta.companyJobs.removedIds,
        (value) => value.id,
      ),
      recentDiscoveryRuns: applyEntitySlice(
        input.workspace.recentDiscoveryRuns,
        input.delta.recentDiscoveryRuns.upserts,
        input.delta.recentDiscoveryRuns.removedIds,
        (value) => value.id,
      ),
      reviewQueue,
      applyRuns,
      applyJobResults: applyEntitySlice(
        input.workspace.applyJobResults,
        input.delta.applyJobResults.upserts,
        input.delta.applyJobResults.removedIds,
        (value) => value.id,
      ),
      applicationRecords,
      applicationAttempts: applyEntitySlice(
        input.workspace.applicationAttempts,
        input.delta.applicationAttempts.upserts,
        input.delta.applicationAttempts.removedIds,
        (value) => value.id,
      ),
      userActionRequests: applyEntitySlice(
        input.workspace.userActionRequests,
        input.delta.userActionRequests.upserts,
        input.delta.userActionRequests.removedIds,
        (value) => value.id,
      ),
      userActionEvents: applyEntitySlice(
        input.workspace.userActionEvents,
        input.delta.userActionEvents.upserts,
        input.delta.userActionEvents.removedIds,
        (value) => value.id,
      ),
      selectedDiscoveryJobId: preserveValidSelection({
        requestedId: input.delta.selectedDiscoveryJobId,
        previousId: input.workspace.selectedDiscoveryJobId,
        entities: discoveryJobs,
        getId: (value) => value.id,
      }),
      selectedReviewJobId: preserveValidSelection({
        requestedId: input.delta.selectedReviewJobId,
        previousId: input.workspace.selectedReviewJobId,
        entities: reviewQueue,
        getId: (value) => value.jobId,
      }),
      selectedApplyRunId: preserveValidSelection({
        requestedId: input.delta.selectedApplyRunId,
        previousId: input.workspace.selectedApplyRunId,
        entities: applyRuns,
        getId: (value) => value.id,
      }),
      selectedApplicationRecordId: preserveValidSelection({
        requestedId: input.delta.selectedApplicationRecordId,
        previousId: input.workspace.selectedApplicationRecordId,
        entities: applicationRecords,
        getId: (value) => value.id,
      }),
    },
  };
}
