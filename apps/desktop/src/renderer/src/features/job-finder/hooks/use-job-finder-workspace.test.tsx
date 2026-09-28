// @vitest-environment jsdom

import {
  createFreshStartCandidateProfile,
  DiscoveryJobViewSchema,
  getDefaultCampaignConfiguration,
  JobFinderSettingsSchema,
  JobFinderWorkspaceDeltaSchema,
  JobFinderWorkspaceSnapshotSchema,
  JobSearchCampaignSchema,
  JobSearchPreferencesSchema,
} from "@nordri/contracts";
import type {
  CandidateProfile,
  JobFinderSetResumeClaimConfirmationInput,
  JobFinderWorkspaceDelta,
  JobFinderWorkspaceEntityMutationInput,
  JobFinderWorkspaceSnapshot,
  JobFinderWorkspaceSyncResult,
  ResumeImportProgressEvent,
} from "@nordri/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useJobFinderWorkspace } from "./use-job-finder-workspace";

function requireReadyWorkspace(
  value: ReturnType<typeof useJobFinderWorkspace>,
): Extract<ReturnType<typeof useJobFinderWorkspace>, { status: "ready" }> {
  if (value.status !== "ready") {
    throw new Error("Expected a ready Job Finder workspace.");
  }
  return value;
}

function createBaseSnapshot(generatedAt: string): JobFinderWorkspaceSnapshot {
  const profile = createFreshStartCandidateProfile();
  const searchPreferences = JobSearchPreferencesSchema.parse({
    targetRoles: [],
    jobFamilies: [],
    locations: [],
    excludedLocations: [],
    workModes: [],
    seniorityLevels: [],
    minimumSalaryUsd: null,
    targetSalaryUsd: null,
    salaryCurrency: "USD",
    targetIndustries: [],
    targetCompanyStages: [],
    employmentTypes: [],
    approvalMode: "review_before_submit",
    tailoringMode: "balanced",
    companyBlacklist: [],
    companyWhitelist: [],
    discovery: {
      historyLimit: 5,
      targets: [],
    },
  });
  const settings = JobFinderSettingsSchema.parse({
    resumeTemplateId: "classic_ats",
    resumeFormat: "pdf",
    fontPreset: "inter_requisite",
    appearanceTheme: "system",
    humanReviewRequired: true,
    keepSessionAlive: false,
    allowAutoSubmitOverride: false,
    discoveryOnly: false,
  });
  const campaign = JobSearchCampaignSchema.parse({
    id: "campaign_1",
    name: "Test campaign",
    description: "",
    mode: "precision",
    status: "active",
    createdAt: generatedAt,
    updatedAt: generatedAt,
    searchPreferences,
    sourceTargetIds: [],
    jobIds: [],
    minimumFitScore: null,
    ...getDefaultCampaignConfiguration("precision"),
    schedule: {},
    progress: { lastUpdatedAt: generatedAt },
    history: [],
  });
  return JobFinderWorkspaceSnapshotSchema.parse({
    module: "job-finder",
    generatedAt,
    hydration: { phase: "complete", deferredCollections: [] },
    agentProvider: {
      kind: "deterministic",
      role: "chat",
      ready: true,
      label: "Test AI",
      model: null,
      baseUrl: null,
      modelContextWindowTokens: null,
      reservedHeadroomTokens: null,
      requestTimeoutMs: null,
      detail: "Test AI",
    },
    visionProvider: null,
    availableResumeTemplates: [],
    profile,
    searchPreferences,
    profileSetupState: {
      status: "completed",
      currentStep: "import",
      completedAt: generatedAt,
      reviewItems: [],
      lastResumedAt: null,
    },
    browserSession: {
      source: "target_site",
      status: "ready",
      driver: "catalog_seed",
      label: "Ready",
      detail: "Ready",
      lastCheckedAt: generatedAt,
    },
    sourceAccessPrompts: [],
    discoverySessions: [],
    discoveryRunState: "idle",
    activeDiscoveryRun: null,
    recentDiscoveryRuns: [],
    activeSourceDebugRun: null,
    recentSourceDebugRuns: [],
    discoveryJobs: [],
    dismissedDiscoveryJobs: [],
    companyJobs: [],
    selectedDiscoveryJobId: null,
    reviewQueue: [],
    selectedReviewJobId: null,
    tailoredAssets: [],
    resumeDrafts: [],
    resumeExportArtifacts: [],
    resumeResearchArtifacts: [],
    applyRuns: [],
    applyJobResults: [],
    applicationRecords: [],
    applicationAttempts: [],
    userActionRequests: [],
    userActionEvents: [],
    sourceInstructionArtifacts: [],
    latestResumeImportRun: null,
    latestResumeImportReviewCandidates: [],
    profileCopilotMessages: [],
    profileRevisions: [],
    selectedApplyRunId: null,
    selectedApplicationRecordId: null,
    settings,
    campaigns: [campaign],
    activeCampaignId: campaign.id,
    campaignNotifications: [],
    dashboard: {
      generatedAt,
      activeCampaignId: campaign.id,
      activeCampaignCount: 1,
      jobsFoundToday: 0,
      jobsAwaitingReview: 0,
      applicationsReadyForApproval: 0,
      applicationsAppliedToday: 0,
      applicationsAppliedThisWeek: 0,
      needsYouCount: 0,
      upcomingInterviews: 0,
      upcomingFollowUps: 0,
      responseRate: null,
      interviewRate: null,
      sourceHealth: {
        healthy: 0,
        needsAttention: 0,
        running: 0,
        total: 0,
      },
      backgroundOperationCount: 0,
      recommendedNextAction: {
        label: "Review profile",
        detail: "Complete the profile before searching.",
        route: "/job-finder/profile",
      },
    },
    activityControl: { paused: false, pausedAt: null, reason: null },
    intelligence: {},
  });
}

function createDiscoveryJob(jobId: string, generatedAt: string) {
  return DiscoveryJobViewSchema.parse({
    id: jobId,
    source: "target_site",
    sourceJobId: `source_${jobId}`,
    canonicalUrl: `https://jobs.example.com/roles/${jobId}`,
    applicationUrl: `https://jobs.example.com/roles/${jobId}/apply`,
    title: `Role ${jobId}`,
    company: "Acme",
    location: "Remote",
    workMode: ["remote"],
    applyPath: "external_redirect",
    easyApplyEligible: false,
    discoveredAt: generatedAt,
    salaryText: null,
    description: `Description for ${jobId}`,
    status: "discovered",
    matchAssessment: { score: 80, reasons: [], gaps: [] },
    listingActivity: { status: "unknown" },
  });
}

function createWorkspace(
  jobId: string,
  generatedAt = "2026-08-09T10:00:00.000Z",
): JobFinderWorkspaceSnapshot {
  const base = createBaseSnapshot(generatedAt);
  return {
    ...base,
    discoveryJobs: [createDiscoveryJob(jobId, generatedAt)],
    selectedDiscoveryJobId: jobId,
  };
}

function createJobReplacementDelta(input: {
  baseRevision: number;
  currentRevision: number;
  previousJobId: string;
  currentJobId: string;
}): JobFinderWorkspaceDelta {
  const generatedAt = "2026-08-09T10:01:00.000Z";
  const base = createBaseSnapshot(generatedAt);
  return JobFinderWorkspaceDeltaSchema.parse({
    baseRevision: input.baseRevision,
    currentRevision: input.currentRevision,
    generatedAt,
    discoveryRunState: "idle",
    activeDiscoveryRun: null,
    discoverySessions: [],
    sourceAccessPrompts: [],
    latestResumeImportRun: null,
    campaigns: base.campaigns,
    activeCampaignId: base.activeCampaignId,
    campaignNotifications: [],
    dashboard: base.dashboard,
    activityControl: base.activityControl,
    intelligence: base.intelligence,
    selectedDiscoveryJobId: input.currentJobId,
    selectedReviewJobId: null,
    selectedApplyRunId: null,
    selectedApplicationRecordId: null,
    discoveryJobs: {
      upserts: [createDiscoveryJob(input.currentJobId, generatedAt)],
      removedIds: [input.previousJobId],
    },
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
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("useJobFinderWorkspace entity mutations", () => {
  const syncWorkspace =
    vi.fn<
      (baseRevision: number | null) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const mutateWorkspaceEntities =
    vi.fn<
      (
        input: JobFinderWorkspaceEntityMutationInput,
      ) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const getWorkspace = vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const getWorkspaceBootstrap =
    vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const checkBrowserSession =
    vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const legacyQueueJobForReview =
    vi.fn<(jobId: string) => Promise<JobFinderWorkspaceSnapshot>>();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: {
        ping: vi.fn(() => Promise.resolve({ platform: "win32" as const })),
        jobFinder: {
          syncWorkspace,
          mutateWorkspaceEntities,
          getWorkspace,
          checkBrowserSession,
          queueJobForReview: legacyQueueJobForReview,
        },
      } as unknown as Window["nordri"],
    });
  });

  function enableBootstrapApi() {
    Object.assign(window.nordri.jobFinder as object, {
      getWorkspaceBootstrap,
    });
  }

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "nordri");
  });

  it("commits a typed entity delta without calling the legacy snapshot route", async () => {
    const initialWorkspace = createWorkspace("job-old");
    syncWorkspace.mockResolvedValueOnce({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
      snapshot: initialWorkspace,
    });
    mutateWorkspaceEntities.mockResolvedValueOnce({
      kind: "delta",
      delta: createJobReplacementDelta({
        baseRevision: 1,
        currentRevision: 2,
        previousJobId: "job-old",
        currentJobId: "job-new",
      }),
    });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await requireReadyWorkspace(result.current).actions.queueJobForReview(
        "job-new",
      );
    });

    expect(mutateWorkspaceEntities).toHaveBeenCalledWith({
      baseRevision: 1,
      mutation: {
        type: "queue_job_for_review",
        jobId: "job-new",
      },
    });
    expect(legacyQueueJobForReview).not.toHaveBeenCalled();
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(
        result.current.workspace.discoveryJobs.map(({ id }) => id),
      ).toEqual(["job-new"]);
      expect(result.current.workspace.selectedDiscoveryJobId).toBe("job-new");
    }
  });

  // PERF-03 / F33 durability contract. A mutation that answers with the typed
  // sync envelope must let the renderer CARRY its revision baseline forward;
  // a mutation that answers with a bare snapshot must SURRENDER it. Both
  // halves are load-bearing: the first is the whole point of the delta path,
  // and the second is what stops a delta from being computed against a
  // baseline the renderer no longer holds.
  it("carries the delta revision baseline forward across consecutive mutations", async () => {
    const initialWorkspace = createWorkspace("job-old");
    syncWorkspace.mockResolvedValueOnce({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
      snapshot: initialWorkspace,
    });
    mutateWorkspaceEntities
      .mockResolvedValueOnce({
        kind: "delta",
        delta: createJobReplacementDelta({
          baseRevision: 1,
          currentRevision: 2,
          previousJobId: "job-old",
          currentJobId: "job-second",
        }),
      })
      .mockResolvedValueOnce({
        kind: "delta",
        delta: createJobReplacementDelta({
          baseRevision: 2,
          currentRevision: 3,
          previousJobId: "job-second",
          currentJobId: "job-third",
        }),
      });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await requireReadyWorkspace(result.current).actions.queueJobForReview(
        "job-second",
      );
    });
    await act(async () => {
      await requireReadyWorkspace(result.current).actions.queueJobForReview(
        "job-third",
      );
    });

    // The second mutation must advertise revision 2 — not 0/null. Resetting
    // the baseline here is what forced every follow-up request back onto a
    // full-snapshot payload.
    expect(mutateWorkspaceEntities).toHaveBeenNthCalledWith(2, {
      baseRevision: 2,
      mutation: { type: "queue_job_for_review", jobId: "job-third" },
    });
    // No extra full-snapshot round trip was needed to keep converging.
    expect(syncWorkspace).toHaveBeenCalledTimes(1);
    expect(getWorkspace).not.toHaveBeenCalled();
    expect(
      requireReadyWorkspace(result.current).workspace.discoveryJobs.map(
        ({ id }) => id,
      ),
    ).toEqual(["job-third"]);
  });

  it("surrenders the delta baseline after a bare-snapshot mutation response", async () => {
    const initialWorkspace = createWorkspace("job-old");
    const mutatedWorkspace = createWorkspace(
      "job-after-bare-snapshot",
      "2026-08-09T10:05:00.000Z",
    );
    // Exactly one queued sync response: the initial hydration. Leaving an
    // unconsumed `...Once` value behind would leak into the next test,
    // because `vi.clearAllMocks()` clears calls but not queued results.
    syncWorkspace.mockResolvedValueOnce({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
      snapshot: initialWorkspace,
    });
    checkBrowserSession.mockResolvedValueOnce(mutatedWorkspace);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await requireReadyWorkspace(result.current).actions.checkBrowserSession();
    });

    // A bare snapshot carries no revision, so the renderer holds a workspace
    // that corresponds to no revision main knows about. The next entity
    // mutation must therefore ask for a full re-baseline rather than claim a
    // revision whose baseline no longer matches the committed state.
    mutateWorkspaceEntities.mockResolvedValueOnce({
      kind: "snapshot",
      currentRevision: 8,
      reason: "stale_base",
      snapshot: mutatedWorkspace,
    });
    await act(async () => {
      await requireReadyWorkspace(result.current).actions.queueJobForReview(
        "job-after-bare-snapshot",
      );
    });

    expect(mutateWorkspaceEntities).toHaveBeenNthCalledWith(1, {
      baseRevision: null,
      mutation: {
        type: "queue_job_for_review",
        jobId: "job-after-bare-snapshot",
      },
    });
  });

  it("clears cancelled import progress and ignores progress delivered after settlement", async () => {
    const initialWorkspace = createWorkspace("job-import");
    const importResponse = deferred<JobFinderWorkspaceSnapshot>();
    const progressListeners: Array<
      ((event: ResumeImportProgressEvent) => void) | undefined
    > = [];
    const importResume =
      vi.fn<
        (
          onProgress?: (event: ResumeImportProgressEvent) => void,
        ) => Promise<JobFinderWorkspaceSnapshot>
      >();
    importResume.mockImplementation((onProgress) => {
      progressListeners.push(onProgress);
      return importResponse.promise;
    });
    syncWorkspace.mockResolvedValueOnce({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
      snapshot: initialWorkspace,
    });
    Object.assign(window.nordri.jobFinder as object, { importResume });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let importPromise!: Promise<JobFinderWorkspaceSnapshot>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }
      importPromise = result.current.actions.importResume();
    });

    const progress: ResumeImportProgressEvent = {
      stage: "reading_document",
      message: "Reading the selected resume.",
      occurredAt: "2026-08-09T10:00:01.000Z",
    };
    act(() => {
      progressListeners[0]?.(progress);
    });
    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }
      expect(result.current.resumeImportProgress).toEqual(progress);
    });

    // Main resolves a closed/cancelled picker with the unchanged snapshot.
    await act(async () => {
      importResponse.resolve(initialWorkspace);
      await importPromise;
    });
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.resumeImportProgress).toBeNull();
    }

    // A misbehaving late event must not resurrect Guided setup's busy state.
    act(() => {
      progressListeners[0]?.(progress);
    });
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.resumeImportProgress).toBeNull();
    }
  });

  it("recovers a revision mismatch with one fresh snapshot", async () => {
    const initialWorkspace = createWorkspace("job-old");
    const recoveredWorkspace = createWorkspace(
      "job-recovered",
      "2026-08-09T10:02:00.000Z",
    );
    syncWorkspace
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 4,
        reason: "initial",
        snapshot: initialWorkspace,
      })
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 6,
        reason: "initial",
        snapshot: recoveredWorkspace,
      });
    mutateWorkspaceEntities.mockResolvedValueOnce({
      kind: "delta",
      delta: createJobReplacementDelta({
        baseRevision: 2,
        currentRevision: 3,
        previousJobId: "job-old",
        currentJobId: "job-stale",
      }),
    });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await requireReadyWorkspace(result.current).actions.removeJobFromReview(
        "job-old",
      );
    });

    expect(syncWorkspace).toHaveBeenNthCalledWith(2, null);
    expect(getWorkspace).not.toHaveBeenCalled();
    if (result.current.status === "ready") {
      expect(result.current.workspace.selectedDiscoveryJobId).toBe(
        "job-recovered",
      );
    }
  });

  it("ignores a slower older action response after a newer response commits", async () => {
    const initialWorkspace = createWorkspace("job-initial");
    const olderWorkspace = createWorkspace(
      "job-older",
      "2026-08-09T10:03:00.000Z",
    );
    const newerWorkspace = createWorkspace(
      "job-newer",
      "2026-08-09T10:04:00.000Z",
    );
    syncWorkspace
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 1,
        reason: "initial",
        snapshot: initialWorkspace,
      })
      // The fenced older response schedules one trailing authoritative
      // fetch so the superseded action still converges; it must observe the
      // already-committed newer state instead of rolling it back.
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 2,
        reason: "initial",
        snapshot: newerWorkspace,
      });
    const older = deferred<JobFinderWorkspaceSnapshot>();
    const newer = deferred<JobFinderWorkspaceSnapshot>();
    checkBrowserSession
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let olderAction!: Promise<JobFinderWorkspaceSnapshot>;
    let newerAction!: Promise<JobFinderWorkspaceSnapshot>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }

      olderAction = result.current.actions.checkBrowserSession();
      newerAction = result.current.actions.checkBrowserSession();
    });

    await act(async () => {
      newer.resolve(newerWorkspace);
      await newerAction;
    });
    await act(async () => {
      older.resolve(olderWorkspace);
      await olderAction;
    });

    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.workspace.selectedDiscoveryJobId).toBe("job-newer");
    }
    // The convergence fetch runs after the fenced response settles and its
    // snapshot (already reflecting the newer commit) keeps the state.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));
    if (result.current.status === "ready") {
      expect(result.current.workspace.selectedDiscoveryJobId).toBe("job-newer");
    }
  });

  it("keeps an update-triggered sync from invalidating an in-flight cancellation", async () => {
    const beforeCancellation = createWorkspace("job-running");
    const cancelled = createWorkspace(
      "job-cancelled",
      "2026-08-09T10:05:00.000Z",
    );
    const cancellation = deferred<JobFinderWorkspaceSnapshot>();
    const updateSync = deferred<JobFinderWorkspaceSyncResult>();
    const updateListeners: Array<() => void> = [];
    const cancelAgentDiscovery = vi.fn(() => cancellation.promise);
    const onWorkspaceUpdate = vi.fn((listener: () => void) => {
      updateListeners.push(listener);
      return () => undefined;
    });

    syncWorkspace
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 1,
        reason: "initial",
        snapshot: beforeCancellation,
      })
      .mockReturnValueOnce(updateSync.promise);
    Object.assign(window.nordri.jobFinder as object, {
      cancelAgentDiscovery,
      onWorkspaceUpdate,
    });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let cancellationPromise!: Promise<JobFinderWorkspaceSnapshot>;
    act(() => {
      cancellationPromise = requireReadyWorkspace(
        result.current,
      ).actions.cancelAgentDiscovery({ runId: "discovery_run_1" });
    });
    expect(cancelAgentDiscovery).toHaveBeenCalledOnce();

    act(() => updateListeners[0]?.());
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));

    let cancellationResult: JobFinderWorkspaceSnapshot | undefined;
    await act(async () => {
      cancellation.resolve(cancelled);
      cancellationResult = await cancellationPromise;
    });
    expect(cancellationResult).toBe(cancelled);
    expect(requireReadyWorkspace(result.current).workspace).toBe(cancelled);

    act(() => {
      updateSync.resolve({
        kind: "snapshot",
        currentRevision: 1,
        reason: "initial",
        snapshot: beforeCancellation,
      });
    });
    await act(() => Promise.resolve());

    expect(requireReadyWorkspace(result.current).workspace).toBe(cancelled);
  });

  it("shows the bootstrap before deferred collections arrive and then hydrates them", async () => {
    enableBootstrapApi();
    const bootstrap: JobFinderWorkspaceSnapshot = {
      ...createWorkspace("job-bootstrap"),
      discoveryJobs: [],
      selectedDiscoveryJobId: null,
      hydration: {
        phase: "bootstrap" as const,
        deferredCollections: ["discovery_jobs", "applications"] as const,
      },
    };
    const hydrated = createWorkspace("job-hydrated");
    const hydration = deferred<JobFinderWorkspaceSyncResult>();
    getWorkspaceBootstrap.mockResolvedValueOnce(bootstrap);
    syncWorkspace.mockReturnValueOnce(hydration.promise);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.workspace.hydration.phase).toBe("bootstrap");
      expect(result.current.workspace.discoveryJobs).toEqual([]);
      expect(result.current.workspace.hydration.deferredCollections).toEqual(
        expect.arrayContaining(["discovery_jobs", "applications"]),
      );
    }

    await act(async () => {
      hydration.resolve({
        kind: "snapshot",
        currentRevision: 8,
        reason: "initial",
        snapshot: hydrated,
      });
      await hydration.promise;
    });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
      if (result.current.status === "ready") {
        expect(result.current.workspace.hydration.phase).toBe("complete");
        expect(result.current.workspace.discoveryJobs[0]?.id).toBe(
          "job-hydrated",
        );
      }
    });
  });

  it("does not let late hydration overwrite a newer user action", async () => {
    enableBootstrapApi();
    const bootstrap: JobFinderWorkspaceSnapshot = {
      ...createWorkspace("job-bootstrap"),
      discoveryJobs: [],
      selectedDiscoveryJobId: null,
      hydration: {
        phase: "bootstrap" as const,
        deferredCollections: ["discovery_jobs"] as const,
      },
    };
    const hydrated = createWorkspace("job-hydrated");
    const actionWorkspace = createWorkspace("job-action");
    const hydration = deferred<JobFinderWorkspaceSyncResult>();
    getWorkspaceBootstrap.mockResolvedValueOnce(bootstrap);
    syncWorkspace.mockReturnValueOnce(hydration.promise);
    checkBrowserSession.mockResolvedValueOnce(actionWorkspace);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }
      await result.current.actions.checkBrowserSession();
    });

    await act(async () => {
      hydration.resolve({
        kind: "snapshot",
        currentRevision: 9,
        reason: "initial",
        snapshot: hydrated,
      });
      await hydration.promise;
    });

    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      expect(result.current.workspace.selectedDiscoveryJobId).toBe(
        "job-action",
      );
    }
  });

  it("reports bootstrap failures instead of showing a blank shell", async () => {
    enableBootstrapApi();
    getWorkspaceBootstrap.mockRejectedValueOnce(
      new Error("bootstrap database unavailable"),
    );

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("bootstrap database unavailable");
    }
  });

  it("reports a full hydration failure and keeps the bootstrap error actionable", async () => {
    enableBootstrapApi();
    const bootstrap = {
      ...createWorkspace("job-bootstrap"),
      discoveryJobs: [],
      selectedDiscoveryJobId: null,
      hydration: {
        phase: "bootstrap" as const,
        deferredCollections: ["discovery_jobs"] as const,
      },
    } as unknown as JobFinderWorkspaceSnapshot;
    getWorkspaceBootstrap.mockResolvedValueOnce(bootstrap);
    syncWorkspace.mockRejectedValueOnce(
      new Error("hydration sync unavailable"),
    );
    getWorkspace.mockRejectedValueOnce(new Error("full workspace unavailable"));

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("full workspace unavailable");
      expect(typeof result.current.retry).toBe("function");
    }
  });

  it("retries the initial workspace load after a recoverable failure", async () => {
    const recoveredWorkspace = createWorkspace("job-recovered");
    syncWorkspace
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce({
        kind: "snapshot",
        currentRevision: 1,
        reason: "initial",
        snapshot: recoveredWorkspace,
      });
    getWorkspace.mockRejectedValueOnce(
      new Error("database temporarily unavailable"),
    );

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => {
      if (result.current.status !== "error") {
        throw new Error("Expected a failed initial workspace load.");
      }
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.workspace.selectedDiscoveryJobId).toBe(
        "job-recovered",
      );
    }
  });

  it("refreshes just after server reset and when focus or visibility finds stale capacity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
    const initialWorkspace = {
      ...createWorkspace("job-capacity"),
      dashboard: {
        globalDailyApplicationPreparationCapacity: {
          limit: 20,
          used: 7,
          legacyUncertain: 0,
          remaining: 13,
          localDate: "2026-08-09",
          resetsAt: "2026-08-09T10:00:01.000Z",
        },
      },
    } as JobFinderWorkspaceSnapshot;
    const refreshedWorkspace = {
      ...initialWorkspace,
      dashboard: {
        globalDailyApplicationPreparationCapacity: {
          limit: 20,
          used: 0,
          legacyUncertain: 0,
          remaining: 20,
          localDate: "2026-08-10",
          resetsAt: "2026-08-10T10:00:01.000Z",
        },
      },
    } as JobFinderWorkspaceSnapshot;
    syncWorkspace.mockResolvedValue({
      kind: "snapshot",
      currentRevision: 1,
      reason: "initial",
      snapshot: initialWorkspace,
    });

    const { result } = renderHook(() => useJobFinderWorkspace());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("ready");
    syncWorkspace.mockClear();
    syncWorkspace.mockResolvedValue({
      kind: "snapshot",
      currentRevision: 2,
      reason: "initial",
      snapshot: refreshedWorkspace,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(syncWorkspace).toHaveBeenCalledTimes(1);

    syncWorkspace.mockClear();
    vi.setSystemTime(new Date("2026-08-10T10:00:02.000Z"));
    window.dispatchEvent(new Event("focus"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncWorkspace).toHaveBeenCalledTimes(1);

    syncWorkspace.mockClear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(syncWorkspace).toHaveBeenCalledTimes(1);
  });
});

describe("useJobFinderWorkspace concurrency convergence", () => {
  function deferral<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });

    return { promise, resolve, reject };
  }

  const syncWorkspace =
    vi.fn<
      (baseRevision: number | null) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const mutateWorkspaceEntities =
    vi.fn<
      (
        input: JobFinderWorkspaceEntityMutationInput,
      ) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const getWorkspace = vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const getWorkspaceBootstrap =
    vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const checkBrowserSession =
    vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const saveProfile =
    vi.fn<(profile: CandidateProfile) => Promise<JobFinderWorkspaceSnapshot>>();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: {
        ping: vi.fn(() => Promise.resolve({ platform: "win32" as const })),
        jobFinder: {
          syncWorkspace,
          mutateWorkspaceEntities,
          getWorkspace,
          checkBrowserSession,
          saveProfile,
        },
      } as unknown as Window["nordri"],
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "nordri");
  });

  // Bootstrap-aware initial load; legacy-path tests never install this.
  function enableBootstrapApi() {
    Object.assign(window.nordri.jobFinder as object, {
      getWorkspaceBootstrap,
    });
  }

  function createBootstrapPhaseWorkspace(
    jobId: string,
  ): JobFinderWorkspaceSnapshot {
    const base = createWorkspace(jobId);
    return {
      ...base,
      hydration: {
        phase: "bootstrap" as const,
        deferredCollections: ["discovery_jobs"] as const,
      },
    };
  }

  function queueSyncResponses(
    ...responses: Array<{ promise: Promise<JobFinderWorkspaceSyncResult> }>
  ) {
    syncWorkspace.mockImplementation(() => {
      const next = responses.shift();
      if (!next) {
        throw new Error("Unexpected extra syncWorkspace call");
      }
      return next.promise;
    });
  }

  function snapshotResult(
    snapshot: JobFinderWorkspaceSnapshot,
    currentRevision = 1,
  ): JobFinderWorkspaceSyncResult {
    return { kind: "snapshot", currentRevision, reason: "initial", snapshot };
  }

  function renderReadyWith(
    firstSync: { promise: Promise<JobFinderWorkspaceSyncResult> },
    snapshot: JobFinderWorkspaceSnapshot,
    ...restResponses: Array<{ promise: Promise<JobFinderWorkspaceSyncResult> }>
  ) {
    queueSyncResponses(firstSync, ...restResponses);
    return renderHook(() => useJobFinderWorkspace());
  }

  it("converges a committed entity mutation that lost the sequencing race to a background refresh", async () => {
    const staleWorkspace = createWorkspace("job-old");
    const convergedWorkspace = createWorkspace(
      "job-new",
      "2026-08-09T10:06:00.000Z",
    );

    const initialSync = deferral<JobFinderWorkspaceSyncResult>();
    const backgroundRefresh = deferral<JobFinderWorkspaceSyncResult>();
    const convergenceFetch = deferral<JobFinderWorkspaceSyncResult>();
    const mutation = deferral<JobFinderWorkspaceSyncResult>();

    mutateWorkspaceEntities.mockReturnValue(mutation.promise);
    const { result } = renderReadyWith(
      initialSync,
      staleWorkspace,
      backgroundRefresh,
      convergenceFetch,
    );
    act(() => {
      initialSync.resolve(snapshotResult(staleWorkspace));
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(syncWorkspace).toHaveBeenCalledTimes(1);

    let mutationPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      mutationPromise = result.current.actions.queueJobForReview("job-new");
    });

    // A focus/capacity-style refresh starts after the mutation dispatched
    // and answers first, committing the pre-mutation snapshot.
    let refreshPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      refreshPromise = result.current.actions.refreshWorkspace();
    });
    act(() => {
      backgroundRefresh.resolve(snapshotResult(staleWorkspace));
    });
    await refreshPromise;

    act(() => {
      mutation.resolve({
        kind: "delta",
        delta: createJobReplacementDelta({
          baseRevision: 1,
          currentRevision: 2,
          previousJobId: "job-old",
          currentJobId: "job-new",
        }),
      });
    });

    // The fenced mutation response must not be dropped silently: exactly one
    // trailing authoritative fetch is scheduled instead.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(3));

    act(() => {
      convergenceFetch.resolve(snapshotResult(convergedWorkspace, 2));
    });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      expect(
        result.current.workspace.discoveryJobs.map(({ id }) => id),
      ).toEqual(["job-new"]);
      expect(result.current.workspace.selectedDiscoveryJobId).toBe("job-new");
    });
    await mutationPromise;
  });

  it("converges a fenced user action response with one trailing fetch", async () => {
    const staleWorkspace = createWorkspace("job-old");
    const savedWorkspace = createWorkspace(
      "job-old",
      "2026-08-09T10:08:00.000Z",
    );

    const initialSync = deferral<JobFinderWorkspaceSyncResult>();
    const backgroundRefresh = deferral<JobFinderWorkspaceSyncResult>();
    const convergenceFetch = deferral<JobFinderWorkspaceSyncResult>();
    const actionResponse = deferral<JobFinderWorkspaceSnapshot>();

    saveProfile.mockReturnValue(actionResponse.promise);
    const { result } = renderReadyWith(
      initialSync,
      staleWorkspace,
      backgroundRefresh,
      convergenceFetch,
    );
    act(() => {
      initialSync.resolve(snapshotResult(staleWorkspace));
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(syncWorkspace).toHaveBeenCalledTimes(1);

    let actionPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      actionPromise = result.current.actions.saveProfile(
        {} as CandidateProfile,
      );
    });

    // The refresh wins the race and commits while the action is in flight.
    let refreshPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      refreshPromise = result.current.actions.refreshWorkspace();
    });
    act(() => {
      backgroundRefresh.resolve(snapshotResult(staleWorkspace));
    });
    await refreshPromise;

    act(() => {
      actionResponse.resolve(savedWorkspace);
    });

    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(3));

    act(() => {
      convergenceFetch.resolve(snapshotResult(savedWorkspace, 2));
    });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      // The fenced action's own snapshot must not be committed directly, but
      // the visible workspace must still converge onto its committed state.
      expect(result.current.workspace.generatedAt).toBe(
        savedWorkspace.generatedAt,
      );
    });
    await actionPromise;
  });

  it("resumes hydration when an allowDuringBootstrap action supersedes it", async () => {
    const bootstrapSnapshot = createBootstrapPhaseWorkspace("job-old");
    const supersedingSnapshot = createBootstrapPhaseWorkspace("job-old");
    const hydratedSnapshot = createWorkspace("job-old");

    const bootstrap = deferral<JobFinderWorkspaceSnapshot>();
    const hydrationFetch = deferral<JobFinderWorkspaceSyncResult>();
    const resumeFetch = deferral<JobFinderWorkspaceSyncResult>();
    const actionResponse = deferral<JobFinderWorkspaceSnapshot>();

    enableBootstrapApi();
    getWorkspaceBootstrap.mockReturnValue(bootstrap.promise);
    checkBrowserSession.mockReturnValue(actionResponse.promise);

    // The hydration request fires immediately after the bootstrap snapshot
    // lands, so the response queue must be installed before resolving it.
    queueSyncResponses(hydrationFetch, resumeFetch);

    const { result } = renderHook(() => useJobFinderWorkspace());
    act(() => {
      bootstrap.resolve(bootstrapSnapshot);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") {
      throw new Error("Expected a ready workspace.");
    }
    expect(result.current.workspace.hydration.phase).toBe("bootstrap");
    expect(syncWorkspace).toHaveBeenCalledTimes(1);

    let actionPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      actionPromise = result.current.actions.checkBrowserSession();
    });

    // The allowDuringBootstrap action wins the sequence race and commits
    // another partial bootstrap snapshot while the backend still hydrates.
    act(() => {
      actionResponse.resolve(supersedingSnapshot);
    });

    // Hydration settles afterwards and loses the fence.
    act(() => {
      hydrationFetch.resolve(snapshotResult(hydratedSnapshot, 9));
    });

    // A superseded hydration must schedule one authoritative resume fetch
    // instead of stranding the shell on the partial bootstrap forever.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));

    act(() => {
      resumeFetch.resolve(snapshotResult(hydratedSnapshot, 9));
    });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      expect(result.current.workspace.hydration.phase).toBe("complete");
      expect(result.current.workspace.generatedAt).toBe(
        hydratedSnapshot.generatedAt,
      );
    });
    await actionPromise;
  });

  it("recovers bootstrap through the resume fetch when a superseded hydration attempt fails", async () => {
    const bootstrapSnapshot = createBootstrapPhaseWorkspace("job-old");
    const supersedingSnapshot = createBootstrapPhaseWorkspace("job-old");
    const hydratedSnapshot = createWorkspace("job-old");

    const bootstrap = deferral<JobFinderWorkspaceSnapshot>();
    const hydrationFetch = deferral<JobFinderWorkspaceSyncResult>();
    const resumeFetch = deferral<JobFinderWorkspaceSyncResult>();
    const actionResponse = deferral<JobFinderWorkspaceSnapshot>();

    enableBootstrapApi();
    getWorkspaceBootstrap.mockReturnValue(bootstrap.promise);
    checkBrowserSession.mockReturnValue(actionResponse.promise);

    queueSyncResponses(hydrationFetch, resumeFetch);
    getWorkspace.mockRejectedValueOnce(new Error("hydration full load failed"));

    const { result } = renderHook(() => useJobFinderWorkspace());
    act(() => {
      bootstrap.resolve(bootstrapSnapshot);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let actionPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      actionPromise = result.current.actions.checkBrowserSession();
    });
    act(() => {
      actionResponse.resolve(supersedingSnapshot);
    });

    act(() => {
      hydrationFetch.reject(new Error("hydration sync failed"));
    });

    // The failed-but-superseded hydration still converges through the resume
    // fetch; no error state and no stranded bootstrap.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));

    act(() => {
      resumeFetch.resolve(snapshotResult(hydratedSnapshot, 4));
    });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace without an error state.");
      }
      expect(result.current.workspace.hydration.phase).toBe("complete");
    });
    await actionPromise;
  });

  it("surfaces a retryable error when even the bootstrap resume fetch fails", async () => {
    const bootstrapSnapshot = createBootstrapPhaseWorkspace("job-old");
    const supersedingSnapshot = createBootstrapPhaseWorkspace("job-old");

    const bootstrap = deferral<JobFinderWorkspaceSnapshot>();
    const hydrationFetch = deferral<JobFinderWorkspaceSyncResult>();
    const resumeFetch = deferral<JobFinderWorkspaceSyncResult>();
    const actionResponse = deferral<JobFinderWorkspaceSnapshot>();

    enableBootstrapApi();
    getWorkspaceBootstrap.mockReturnValue(bootstrap.promise);
    checkBrowserSession.mockReturnValue(actionResponse.promise);

    queueSyncResponses(hydrationFetch, resumeFetch);
    getWorkspace.mockRejectedValue(new Error("resume fallback failed"));

    const { result } = renderHook(() => useJobFinderWorkspace());
    act(() => {
      bootstrap.resolve(bootstrapSnapshot);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let actionPromise!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      actionPromise = result.current.actions.checkBrowserSession();
    });
    act(() => {
      actionResponse.resolve(supersedingSnapshot);
    });

    act(() => {
      hydrationFetch.reject(new Error("hydration sync failed"));
    });

    // The superseded hydration schedules one authoritative resume fetch.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));

    // Even the resume fetch fails end to end; the shell must surface the
    // retryable error instead of silently stranding the bootstrap phase.
    act(() => {
      resumeFetch.reject(new Error("resume sync failed"));
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("resume fallback failed");
      expect(typeof result.current.retry).toBe("function");
    }
    await actionPromise;
  });
});

describe("useJobFinderWorkspace resume claim confirmation action", () => {
  const removeCommand: JobFinderSetResumeClaimConfirmationInput = {
    intent: "remove",
    jobId: "job_1",
    draftId: "resume_draft_job_1",
    expectedDraftUpdatedAt: "2026-08-09T10:00:00.000Z",
    confirmationId: "claim_confirmation_section_experience_abc",
  };

  const syncWorkspace =
    vi.fn<
      (baseRevision: number | null) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const getWorkspace = vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const setResumeClaimConfirmation =
    vi.fn<
      (
        input: JobFinderSetResumeClaimConfirmationInput,
      ) => Promise<JobFinderWorkspaceSnapshot>
    >();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: {
        ping: vi.fn(() => Promise.resolve({ platform: "win32" as const })),
        jobFinder: {
          syncWorkspace,
          getWorkspace,
          setResumeClaimConfirmation,
        },
      } as unknown as Window["nordri"],
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "nordri");
  });

  function snapshotSyncResult(
    snapshot: JobFinderWorkspaceSnapshot,
    currentRevision = 1,
  ): JobFinderWorkspaceSyncResult {
    return { kind: "snapshot", currentRevision, reason: "initial", snapshot };
  }

  it("forwards the typed command and commits the returned snapshot", async () => {
    const initial = createWorkspace("job_1");
    const committed = createWorkspace("job_1", "2026-08-09T10:05:00.000Z");
    syncWorkspace.mockResolvedValueOnce(snapshotSyncResult(initial));
    setResumeClaimConfirmation.mockResolvedValueOnce(committed);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await expect(
        requireReadyWorkspace(
          result.current,
        ).actions.setResumeClaimConfirmation(removeCommand),
      ).resolves.toBe(committed);
    });

    expect(setResumeClaimConfirmation).toHaveBeenCalledOnce();
    expect(setResumeClaimConfirmation).toHaveBeenCalledWith(removeCommand);
    if (result.current.status === "ready") {
      expect(result.current.workspace).toBe(committed);
    }
  });

  it("never lets a stale claim-confirmation response overwrite a newer commit", async () => {
    const initial = createWorkspace("job_1");
    const newer = createWorkspace("job_1", "2026-08-09T10:06:00.000Z");
    const staleResponse = deferred<JobFinderWorkspaceSnapshot>();
    syncWorkspace
      .mockResolvedValueOnce(snapshotSyncResult(initial))
      .mockResolvedValueOnce(snapshotSyncResult(newer, 2));
    setResumeClaimConfirmation
      .mockReturnValueOnce(staleResponse.promise)
      .mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let staleAction!: Promise<unknown>;
    act(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      staleAction =
        result.current.actions.setResumeClaimConfirmation(removeCommand);
    });

    await act(async () => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready workspace.");
      }
      await result.current.actions.setResumeClaimConfirmation(removeCommand);
    });

    if (result.current.status !== "ready") {
      throw new Error("Expected a ready workspace.");
    }
    // The newest request already owns the sequence and committed its snapshot.
    expect(result.current.workspace).toBe(newer);

    act(() => {
      staleResponse.resolve(
        createWorkspace("job_1", "2026-08-09T10:03:00.000Z"),
      );
    });
    await staleAction;

    // The fenced stale response schedules one authoritative convergence fetch
    // instead of committing over the newer workspace.
    await waitFor(() => expect(syncWorkspace).toHaveBeenCalledTimes(2));
    await act(async () => {});
    if (result.current.status === "ready") {
      expect(result.current.workspace).toBe(newer);
    }
  });
});
