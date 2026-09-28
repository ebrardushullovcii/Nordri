import type { JobFinderWorkspaceSnapshot } from "@nordri/contracts";
import { describe, expect, it } from "vitest";

import { createJobFinderWorkspaceDeltaTracker } from "./workspace-delta";

const SCALE_OPERATION_BUDGET_MS = 1_000;

function createWorkspace(input: {
  generatedAt: string;
  jobIds: readonly string[];
  selectedJobId: string | null;
  profileSummary?: string;
  discoveryJobs?: readonly Record<string, unknown>[];
  companyJobs?: readonly Record<string, unknown>[];
  applicationRecords?: readonly Record<string, unknown>[];
  dailyCapacity?: Record<string, unknown> | null;
}): JobFinderWorkspaceSnapshot {
  return {
    generatedAt: input.generatedAt,
    profile: { summary: input.profileSummary ?? "Original summary" },
    discoveryRunState: "idle",
    activeDiscoveryRun: null,
    discoverySessions: [],
    sourceAccessPrompts: [],
    latestResumeImportRun: null,
    discoveryJobs: input.discoveryJobs ?? input.jobIds.map((id) => ({ id })),
    dismissedDiscoveryJobs: [],
    companyJobs: input.companyJobs ?? [],
    recentDiscoveryRuns: [],
    reviewQueue: [],
    applyRuns: [],
    applyJobResults: [],
    applicationRecords: input.applicationRecords ?? [],
    applicationAttempts: [],
    userActionRequests: [],
    userActionEvents: [],
    selectedDiscoveryJobId: input.selectedJobId,
    selectedReviewJobId: null,
    selectedApplyRunId: null,
    selectedApplicationRecordId: null,
    dashboard: {
      globalDailyApplicationPreparationCapacity: input.dailyCapacity ?? null,
    },
  } as unknown as JobFinderWorkspaceSnapshot;
}

describe("Job Finder workspace delta tracker", () => {
  it("returns a bounded entity delta with the current selection", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: ["job-1"],
      selectedJobId: "job-1",
    });
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: ["job-2"],
      selectedJobId: "job-2",
    });

    expect(tracker.synchronize(null, initial)).toMatchObject({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
    });
    const result = tracker.synchronize(1, current);

    expect(result).toMatchObject({
      kind: "delta",
      delta: {
        baseRevision: 1,
        currentRevision: 2,
        selectedDiscoveryJobId: "job-2",
        discoveryJobs: {
          upserts: [{ id: "job-2" }],
          removedIds: ["job-1"],
        },
      },
    });
  });

  it("emits an upsert when only derived listing activity changes", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initialJob = {
      id: "job-1",
      listingActivity: { status: "unknown" },
    };
    const currentJob = {
      id: "job-1",
      listingActivity: {
        status: "closed",
        observedAt: "2026-08-23T10:00:00.000Z",
        signalId: "signal-1",
        provenance: "provider",
        explanation: "The provider explicitly reported the listing closed.",
        detail: null,
        confidence: 1,
      },
    };
    const initial = createWorkspace({
      generatedAt: "2026-08-23T10:00:00.000Z",
      jobIds: [],
      selectedJobId: "job-1",
      discoveryJobs: [initialJob],
    });
    const current = createWorkspace({
      generatedAt: "2026-08-23T10:01:00.000Z",
      jobIds: [],
      selectedJobId: "job-1",
      discoveryJobs: [currentJob],
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        discoveryJobs: { upserts: [currentJob], removedIds: [] },
      },
    });
  });

  it("propagates Companies activity and workflow changes independently of Discovery", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initialCompanyJob = {
      id: "job-company",
      status: "submitted",
      listingActivity: { status: "active" },
    };
    const currentCompanyJob = {
      id: "job-company",
      status: "rejected",
      listingActivity: { status: "closed" },
    };
    const initial = createWorkspace({
      generatedAt: "2026-08-23T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [],
      companyJobs: [initialCompanyJob],
    });
    const current = createWorkspace({
      generatedAt: "2026-08-23T10:01:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [],
      companyJobs: [currentCompanyJob],
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        discoveryJobs: { upserts: [], removedIds: [] },
        companyJobs: { upserts: [currentCompanyJob], removedIds: [] },
      },
    });
  });

  it("falls back to a revisioned snapshot for untracked scalar changes", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: ["job-1"],
      selectedJobId: "job-1",
    });
    const changed = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: ["job-1"],
      selectedJobId: "job-1",
      profileSummary: "Changed summary",
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, changed)).toMatchObject({
      kind: "snapshot",
      currentRevision: 2,
      reason: "unsupported_change",
      snapshot: changed,
    });
  });

  it("recovers stale mutation revisions with one full snapshot", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const workspace = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
    });

    tracker.synchronize(null, workspace);

    expect(tracker.synchronize(0, workspace)).toMatchObject({
      kind: "snapshot",
      currentRevision: 2,
      reason: "stale_base",
    });
  });

  it("ignores nested object key order when comparing entities", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [
        {
          id: "job-1",
          metadata: {
            title: "Engineer",
            location: { country: "Kosovo", city: "Pristina" },
          },
        },
      ],
    });
    const sameValuesWithDifferentKeyOrder = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [
        {
          id: "job-1",
          metadata: {
            location: { city: "Pristina", country: "Kosovo" },
            title: "Engineer",
          },
        },
      ],
    });

    tracker.synchronize(null, initial);

    expect(
      tracker.synchronize(1, sameValuesWithDifferentKeyOrder),
    ).toMatchObject({
      kind: "delta",
      delta: {
        discoveryJobs: { upserts: [], removedIds: [] },
      },
    });
  });

  it("detects a removed nested object key", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initialJob = {
      id: "job-1",
      metadata: { title: "Engineer", location: "Pristina" },
    };
    const currentJob = {
      id: "job-1",
      metadata: { title: "Engineer" },
    };
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [initialJob],
    });
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [currentJob],
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        discoveryJobs: { upserts: [currentJob], removedIds: [] },
      },
    });
  });

  it.each([
    {
      label: "order",
      currentTags: ["backend", "typescript"],
    },
    {
      label: "value",
      currentTags: ["backend", "rust"],
    },
  ])("detects nested array $label changes", ({ currentTags }) => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [
        { id: "job-1", metadata: { tags: ["typescript", "backend"] } },
      ],
    });
    const currentJob = {
      id: "job-1",
      metadata: { tags: currentTags },
    };
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: [],
      selectedJobId: null,
      discoveryJobs: [currentJob],
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        discoveryJobs: { upserts: [currentJob], removedIds: [] },
      },
    });
  });

  it("keeps generatedAt-only changes as a delta", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: ["job-1"],
      selectedJobId: "job-1",
    });
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: ["job-1"],
      selectedJobId: "job-1",
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        generatedAt: current.generatedAt,
        discoveryJobs: { upserts: [], removedIds: [] },
      },
    });
  });

  it("carries the authoritative daily preparation capacity in the dashboard delta", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: null,
      dailyCapacity: null,
    });
    const capacity = {
      limit: 20,
      used: 7,
      legacyUncertain: 0,
      remaining: 13,
      localDate: "2026-08-09",
      resetsAt: "2026-08-10T00:00:00.000Z",
    };
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: [],
      selectedJobId: null,
      dailyCapacity: capacity,
    });

    tracker.synchronize(null, initial);

    expect(tracker.synchronize(1, current)).toMatchObject({
      kind: "delta",
      delta: {
        dashboard: {
          globalDailyApplicationPreparationCapacity: capacity,
        },
      },
    });
  });

  it("bounds 5,000-job delta construction and stale snapshot fallback", () => {
    const tracker = createJobFinderWorkspaceDeltaTracker();
    const createJobs = () =>
      Array.from({ length: 5_000 }, (_, index) => ({
        id: `job-${index}`,
        title: `Platform Engineer ${index}`,
        company: {
          id: `company-${index % 250}`,
          name: `Company ${index % 250}`,
        },
        metadata: {
          locations: [`City ${index % 50}`, "Remote"],
          compensation: { currency: "USD", minimum: 90_000 + index },
          skills: ["typescript", "sql", `specialty-${index % 20}`],
        },
      }));
    const createApplications = () =>
      Array.from({ length: 1_001 }, (_, index) => ({
        id: `application-${index}`,
        jobId: `job-${index}`,
        status: "prepared",
        answers: [
          { id: `answer-${index}-1`, value: `Candidate response ${index}` },
          { id: `answer-${index}-2`, value: "Authorized local-only evidence" },
        ],
      }));

    const initialJobs = createJobs();
    const currentJobs = createJobs().slice(1);
    const originalChangedJob = currentJobs[2_499]!;
    const changedJob = {
      ...originalChangedJob,
      metadata: {
        ...originalChangedJob.metadata,
        skills: [...originalChangedJob.metadata.skills, "electron"],
      },
    };
    currentJobs[2_499] = changedJob;
    const addedJob = {
      ...initialJobs[0]!,
      id: "job-5000",
      title: "Platform Engineer 5000",
    };
    currentJobs.push(addedJob);

    const initialApplications = createApplications();
    const currentApplications = createApplications().slice(0, -1);
    const changedApplication = {
      ...currentApplications[500]!,
      status: "interviewing",
    };
    currentApplications[500] = changedApplication;

    const initial = createWorkspace({
      generatedAt: "2026-08-09T10:00:00.000Z",
      jobIds: [],
      selectedJobId: "job-0",
      discoveryJobs: initialJobs,
      applicationRecords: initialApplications,
    });
    const current = createWorkspace({
      generatedAt: "2026-08-09T10:01:00.000Z",
      jobIds: [],
      selectedJobId: "job-5000",
      discoveryJobs: currentJobs,
      applicationRecords: currentApplications,
    });

    tracker.synchronize(null, initial);
    const deltaStartedAt = performance.now();
    const deltaResult = tracker.synchronize(1, current);
    const deltaDurationMs = performance.now() - deltaStartedAt;

    expect(deltaResult).toMatchObject({
      kind: "delta",
      delta: {
        baseRevision: 1,
        currentRevision: 2,
        selectedDiscoveryJobId: "job-5000",
        discoveryJobs: {
          upserts: [changedJob, addedJob],
          removedIds: ["job-0"],
        },
        applicationRecords: {
          upserts: [changedApplication],
          removedIds: ["application-1000"],
        },
      },
    });
    expect(deltaDurationMs).toBeLessThan(SCALE_OPERATION_BUDGET_MS);

    const fallbackStartedAt = performance.now();
    const fallbackResult = tracker.synchronize(1, current);
    const fallbackDurationMs = performance.now() - fallbackStartedAt;

    expect(fallbackResult).toMatchObject({
      kind: "snapshot",
      currentRevision: 3,
      reason: "stale_base",
    });
    expect(fallbackResult.kind).toBe("snapshot");
    if (fallbackResult.kind === "snapshot") {
      expect(fallbackResult.snapshot).toBe(current);
    }
    expect(fallbackDurationMs).toBeLessThan(SCALE_OPERATION_BUDGET_MS);
  });
});
