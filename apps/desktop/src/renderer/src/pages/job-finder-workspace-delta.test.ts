import type {
  JobFinderWorkspaceDelta,
  JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";
import { describe, expect, it } from "vitest";

import { applyJobFinderWorkspaceDelta } from "./job-finder-workspace-delta";

function identified<T>(id: string): T {
  return { id } as T;
}

function queued<T>(jobId: string): T {
  return { jobId } as T;
}

function createWorkspace(): JobFinderWorkspaceSnapshot {
  return {
    generatedAt: "2026-07-31T10:00:00.000Z",
    discoveryRunState: { status: "idle" },
    activeDiscoveryRun: null,
    discoverySessions: [],
    sourceAccessPrompts: [],
    latestResumeImportRun: null,
    discoveryJobs: [identified("job-old"), identified("job-keep")],
    dismissedDiscoveryJobs: [identified("dismissed-old")],
    companyJobs: [identified("company-job-old")],
    recentDiscoveryRuns: [identified("run-old")],
    reviewQueue: [queued("queue-old")],
    applyRuns: [identified("apply-old")],
    applyJobResults: [identified("result-old")],
    applicationRecords: [identified("record-old")],
    applicationAttempts: [identified("attempt-old")],
    userActionRequests: [identified("request-old")],
    userActionEvents: [identified("event-old")],
    selectedDiscoveryJobId: "job-old",
    selectedReviewJobId: "queue-old",
    selectedApplyRunId: "apply-old",
    selectedApplicationRecordId: "record-old",
    dashboard: {
      globalDailyApplicationPreparationCapacity: null,
    },
  } as unknown as JobFinderWorkspaceSnapshot;
}

function createDelta(
  overrides: Partial<
    Pick<JobFinderWorkspaceDelta, "baseRevision" | "currentRevision">
  > = {},
): JobFinderWorkspaceDelta {
  return {
    baseRevision: 7,
    currentRevision: 8,
    generatedAt: "2026-07-31T10:01:00.000Z",
    discoveryRunState: { status: "running" },
    activeDiscoveryRun: null,
    discoverySessions: [],
    sourceAccessPrompts: [],
    latestResumeImportRun: null,
    selectedDiscoveryJobId: "job-new",
    selectedReviewJobId: "queue-new",
    selectedApplyRunId: "apply-new",
    selectedApplicationRecordId: "record-new",
    dashboard: {
      globalDailyApplicationPreparationCapacity: {
        limit: 20,
        used: 7,
        legacyUncertain: 0,
        remaining: 13,
        localDate: "2026-07-31",
        resetsAt: "2026-08-01T00:00:00.000Z",
      },
    },
    discoveryJobs: {
      upserts: [identified("job-new")],
      removedIds: ["job-old"],
    },
    dismissedDiscoveryJobs: {
      upserts: [],
      removedIds: ["dismissed-old"],
    },
    companyJobs: {
      upserts: [identified("company-job-new")],
      removedIds: ["company-job-old"],
    },
    recentDiscoveryRuns: {
      upserts: [identified("run-new")],
      removedIds: ["run-old"],
    },
    reviewQueue: {
      upserts: [queued("queue-new")],
      removedIds: ["queue-old"],
    },
    applyRuns: {
      upserts: [identified("apply-new")],
      removedIds: ["apply-old"],
    },
    applyJobResults: {
      upserts: [identified("result-new")],
      removedIds: ["result-old"],
    },
    applicationRecords: {
      upserts: [identified("record-new")],
      removedIds: ["record-old"],
    },
    applicationAttempts: {
      upserts: [identified("attempt-new")],
      removedIds: ["attempt-old"],
    },
    userActionRequests: {
      upserts: [identified("request-new")],
      removedIds: ["request-old"],
    },
    userActionEvents: {
      upserts: [identified("event-new")],
      removedIds: ["event-old"],
    },
    ...overrides,
  } as unknown as JobFinderWorkspaceDelta;
}

const ENTITY_SLICE_KEYS = [
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
] as const;

type EntitySliceKey = (typeof ENTITY_SLICE_KEYS)[number];

type EntitySliceChanges = {
  upserts: unknown[];
  removedIds: string[];
};

function emptyEntitySlices(): Record<EntitySliceKey, EntitySliceChanges> {
  return {
    discoveryJobs: { upserts: [], removedIds: [] },
    dismissedDiscoveryJobs: { upserts: [], removedIds: [] },
    companyJobs: { upserts: [], removedIds: [] },
    recentDiscoveryRuns: { upserts: [], removedIds: [] },
    reviewQueue: { upserts: [], removedIds: [] },
    applyRuns: { upserts: [], removedIds: [] },
    applyJobResults: { upserts: [], removedIds: [] },
    applicationRecords: { upserts: [], removedIds: [] },
    applicationAttempts: { upserts: [], removedIds: [] },
    userActionRequests: { upserts: [], removedIds: [] },
    userActionEvents: { upserts: [], removedIds: [] },
  };
}

function createSliceDelta(
  overrides: Partial<Record<EntitySliceKey, EntitySliceChanges>> = {},
): JobFinderWorkspaceDelta {
  return {
    ...createDelta(),
    ...emptyEntitySlices(),
    ...overrides,
  } as unknown as JobFinderWorkspaceDelta;
}

function expectApplied(
  result: ReturnType<typeof applyJobFinderWorkspaceDelta>,
) {
  if (result.status !== "applied") {
    throw new Error("Expected the delta to apply.");
  }
  return result;
}

describe("applyJobFinderWorkspaceDelta", () => {
  it("applies entity slices and moves selection to valid current entities", () => {
    const result = applyJobFinderWorkspaceDelta({
      revision: 7,
      workspace: createWorkspace(),
      delta: createDelta(),
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      throw new Error("Expected the delta to apply.");
    }

    expect(result.revision).toBe(8);
    expect(result.workspace.generatedAt).toBe("2026-07-31T10:01:00.000Z");
    expect(result.workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-keep",
      "job-new",
    ]);
    expect(result.workspace.companyJobs.map(({ id }) => id)).toEqual([
      "company-job-new",
    ]);
    expect(result.workspace.recentDiscoveryRuns.map(({ id }) => id)).toEqual([
      "run-new",
    ]);
    expect(result.workspace.reviewQueue.map(({ jobId }) => jobId)).toEqual([
      "queue-new",
    ]);
    expect(result.workspace.applyRuns.map(({ id }) => id)).toEqual([
      "apply-new",
    ]);
    expect(result.workspace.applicationRecords.map(({ id }) => id)).toEqual([
      "record-new",
    ]);
    expect(result.workspace.userActionRequests.map(({ id }) => id)).toEqual([
      "request-new",
    ]);
    expect(result.workspace.userActionEvents.map(({ id }) => id)).toEqual([
      "event-new",
    ]);
    expect(result.workspace.selectedDiscoveryJobId).toBe("job-new");
    expect(result.workspace.selectedReviewJobId).toBe("queue-new");
    expect(result.workspace.selectedApplyRunId).toBe("apply-new");
    expect(result.workspace.selectedApplicationRecordId).toBe("record-new");
    expect(
      result.workspace.dashboard.globalDailyApplicationPreparationCapacity,
    ).toMatchObject({ limit: 20, used: 7, remaining: 13 });
  });

  it("rejects a stale delta without replacing the current workspace", () => {
    const workspace = createWorkspace();

    const result = applyJobFinderWorkspaceDelta({
      revision: 8,
      workspace,
      delta: createDelta({ baseRevision: 7, currentRevision: 8 }),
    });

    expect(result).toEqual({ status: "stale" });
    expect(workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-old",
      "job-keep",
    ]);
  });

  it("rejects a revision gap", () => {
    const result = applyJobFinderWorkspaceDelta({
      revision: 7,
      workspace: createWorkspace(),
      delta: createDelta({ baseRevision: 8, currentRevision: 9 }),
    });

    expect(result).toEqual({ status: "gap" });
  });

  it("preserves every entity slice reference when the delta changes no slices", () => {
    const workspace = createWorkspace();

    const result = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta(),
      }),
    );

    expect(result.revision).toBe(8);
    expect(result.workspace).not.toBe(workspace);
    for (const key of ENTITY_SLICE_KEYS) {
      expect(result.workspace[key]).toBe(workspace[key]);
    }
  });

  it("keeps the previous slice reference when removals match nothing", () => {
    const workspace = createWorkspace();

    const result = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: { upserts: [], removedIds: ["missing-id"] },
          reviewQueue: { upserts: [], removedIds: ["missing-queue"] },
        }),
      }),
    );

    expect(result.workspace.discoveryJobs).toBe(workspace.discoveryJobs);
    expect(result.workspace.reviewQueue).toBe(workspace.reviewQueue);
  });

  it("changes only the slice receiving upserts", () => {
    const workspace = createWorkspace();
    const untouchedKeys = ENTITY_SLICE_KEYS.filter(
      (key) => key !== "discoveryJobs",
    );

    const result = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: { upserts: [identified("job-new")], removedIds: [] },
        }),
      }),
    );

    expect(result.workspace).not.toBe(workspace);
    expect(result.workspace.discoveryJobs).not.toBe(workspace.discoveryJobs);
    expect(result.workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-old",
      "job-keep",
      "job-new",
    ]);
    for (const key of untouchedKeys) {
      expect(result.workspace[key]).toBe(workspace[key]);
    }
  });

  it("replaces matching entities in place and appends new ones in upsert order", () => {
    const workspace = createWorkspace();
    const replacedJobOld = { id: "job-old", title: "refreshed" };

    const result = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: {
            upserts: [
              identified("appended-2"),
              replacedJobOld,
              identified("appended-1"),
            ],
            removedIds: [],
          },
        }),
      }),
    );

    expect(result.workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-old",
      "job-keep",
      "appended-2",
      "appended-1",
    ]);
    expect(result.workspace.discoveryJobs[0]).toBe(replacedJobOld);
    expect(result.workspace.discoveryJobs[1]).toBe(workspace.discoveryJobs[1]);

    const removalResult = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: {
            upserts: [],
            removedIds: ["job-old"],
          },
        }),
      }),
    );

    expect(removalResult.workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-keep",
    ]);
    expect(removalResult.workspace.discoveryJobs[0]).toBe(
      workspace.discoveryJobs[1],
    );
  });

  it("keeps the first upsert for a novel duplicated id", () => {
    const workspace = createWorkspace();
    const first = identified("job-new");
    const second = { id: "job-new", title: "later" };

    const result = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: { upserts: [first, second], removedIds: [] },
        }),
      }),
    );

    expect(result.workspace.discoveryJobs.at(-1)).toBe(first);
  });

  it("keeps slice and element references for deeply equal no-op upserts", () => {
    const jobOld = { id: "job-old", meta: { tags: ["remote"], score: 3 } };
    const jobKeep = identified("job-keep");
    const discoveryJobs = [jobOld, jobKeep];
    const workspace = {
      ...createWorkspace(),
      discoveryJobs,
    } as unknown as JobFinderWorkspaceSnapshot;

    const noOpResult = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: {
            upserts: [{ id: "job-old", meta: { tags: ["remote"], score: 3 } }],
            removedIds: [],
          },
        }),
      }),
    );

    expect(noOpResult.workspace.discoveryJobs).toBe(discoveryJobs);

    const mixedResult = expectApplied(
      applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace,
        delta: createSliceDelta({
          discoveryJobs: {
            upserts: [
              { id: "brand-new" },
              { id: "job-old", meta: { tags: ["remote"], score: 3 } },
            ],
            removedIds: [],
          },
        }),
      }),
    );

    expect(mixedResult.workspace.discoveryJobs).not.toBe(discoveryJobs);
    expect(mixedResult.workspace.discoveryJobs.map(({ id }) => id)).toEqual([
      "job-old",
      "job-keep",
      "brand-new",
    ]);
    expect(mixedResult.workspace.discoveryJobs[0]).toBe(jobOld);
    expect(mixedResult.workspace.discoveryJobs[1]).toBe(jobKeep);
  });

  it("applies thousands of no-op deltas within the performance budget", () => {
    const jobCount = 5000;
    const jobs = Array.from({ length: jobCount }, (_, index) => ({
      id: `job-${index}`,
      title: `Role ${index}`,
      meta: { score: index, tags: [`tag-${index}`] },
    }));
    const workspace = {
      ...createWorkspace(),
      discoveryJobs: jobs,
    } as unknown as JobFinderWorkspaceSnapshot;

    let latest = workspace;
    const emptyStartedAt = performance.now();
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const result = applyJobFinderWorkspaceDelta({
        revision: 7,
        workspace: latest,
        delta: createSliceDelta(),
      });
      latest = expectApplied(result).workspace;
      expect(latest.discoveryJobs).toBe(jobs);
    }
    const emptyElapsedMs = performance.now() - emptyStartedAt;
    expect(emptyElapsedMs).toBeLessThan(1000);
    expect(latest).not.toBe(workspace);

    const resentJobs = jobs.map((job) => ({
      ...job,
      meta: { ...job.meta, tags: [...job.meta.tags] },
    }));
    const upsertStartedAt = performance.now();
    const upsertResult = applyJobFinderWorkspaceDelta({
      revision: 7,
      workspace: latest,
      delta: createSliceDelta({
        discoveryJobs: { upserts: resentJobs, removedIds: [] },
      }),
    });
    expect(expectApplied(upsertResult).workspace.discoveryJobs).toBe(jobs);
    const upsertElapsedMs = performance.now() - upsertStartedAt;
    expect(upsertElapsedMs).toBeLessThan(2000);
  });
});
