// @vitest-environment jsdom

import type {
  JobFinderWorkspaceSnapshot,
  JobFinderWorkspaceSyncResult,
} from "@unemployed/contracts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useJobFinderWorkspace } from "./use-job-finder-workspace";

function createWorkspace(input: {
  assetStatus: "not_started" | "failed";
  generatedAt: string;
}): JobFinderWorkspaceSnapshot {
  return {
    generatedAt: input.generatedAt,
    hydration: { phase: "complete", deferredCollections: [] },
    discoveryRunState: "idle",
    activeDiscoveryRun: null,
    discoverySessions: [],
    sourceAccessPrompts: [],
    latestResumeImportRun: null,
    discoveryJobs: [],
    dismissedDiscoveryJobs: [],
    companyJobs: [],
    recentDiscoveryRuns: [],
    reviewQueue: [{ jobId: "job_1", assetStatus: input.assetStatus }],
    applyRuns: [],
    applyJobResults: [],
    applicationRecords: [],
    applicationAttempts: [],
    userActionRequests: [],
    userActionEvents: [],
    selectedDiscoveryJobId: null,
    selectedReviewJobId: null,
    selectedApplyRunId: null,
    selectedApplicationRecordId: null,
    campaigns: [],
    activeCampaignId: null,
  } as unknown as JobFinderWorkspaceSnapshot;
}

function snapshotResult(
  currentRevision: number,
  snapshot: JobFinderWorkspaceSnapshot,
): JobFinderWorkspaceSyncResult {
  return { kind: "snapshot", currentRevision, reason: "initial", snapshot };
}

describe("useJobFinderWorkspace after a failed action", () => {
  const syncWorkspace =
    vi.fn<
      (baseRevision: number | null) => Promise<JobFinderWorkspaceSyncResult>
    >();
  const generateResume =
    vi.fn<(jobId: string) => Promise<JobFinderWorkspaceSnapshot>>();
  const getWorkspace = vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();
  const checkBrowserSession =
    vi.fn<() => Promise<JobFinderWorkspaceSnapshot>>();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "unemployed", {
      configurable: true,
      value: {
        ping: vi.fn(() => Promise.resolve({ platform: "win32" as const })),
        jobFinder: {
          syncWorkspace,
          generateResume,
          getWorkspace,
          checkBrowserSession,
        },
      } as unknown as Window["unemployed"],
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "unemployed");
  });

  it("re-syncs so a resume run that failed shows its recorded failure", async () => {
    syncWorkspace.mockResolvedValueOnce(
      snapshotResult(
        1,
        createWorkspace({
          assetStatus: "not_started",
          generatedAt: "2026-09-24T10:00:00.000Z",
        }),
      ),
    );
    const { result } = renderHook(() => useJobFinderWorkspace());
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Main saved the failed asset, then rejected the call.
    syncWorkspace.mockResolvedValueOnce(
      snapshotResult(
        2,
        createWorkspace({
          assetStatus: "failed",
          generatedAt: "2026-09-24T10:02:00.000Z",
        }),
      ),
    );
    generateResume.mockRejectedValueOnce(
      new Error("Your profile changed while this resume was being written."),
    );

    await act(async () => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }
      await expect(
        result.current.actions.generateResume("job_1"),
      ).rejects.toThrow("Your profile changed");
    });

    await waitFor(() => {
      if (result.current.status !== "ready") {
        throw new Error("Expected a ready Job Finder workspace.");
      }
      expect(result.current.workspace.reviewQueue[0]?.assetStatus).toBe(
        "failed",
      );
    });
    expect(syncWorkspace).toHaveBeenLastCalledWith(null);
  });
});
