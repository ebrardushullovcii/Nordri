import { describe, expect, it, vi } from "vitest";
import type { JobFinderWorkspaceSnapshot } from "@nordri/contracts";

import { collectJobFinderPerformanceSnapshot } from "./collect-performance-snapshot";

const generatedAt = "2026-08-09T10:00:00.000Z";

describe("collectJobFinderPerformanceSnapshot", () => {
  it("measures the existing workspace read and leaves unobserved runtime areas unavailable", async () => {
    const workspace = {
      activeDiscoveryRun: null,
      recentDiscoveryRuns: [],
      latestResumeImportRun: null,
      applicationAttempts: [],
      activeSourceDebugRun: null,
      recentSourceDebugRuns: [],
    } as unknown as JobFinderWorkspaceSnapshot;
    const service = {
      getWorkspaceSnapshot: vi.fn().mockResolvedValue(workspace),
      getSourceDebugRunDetails: vi.fn(),
    };
    const nowMs = vi
      .fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(112.5);

    const result = await collectJobFinderPerformanceSnapshot({
      service,
      generatedAt,
      nowMs,
    });
    const persistence = result.performance.evidence.find(
      (entry) => entry.area === "persistence",
    );
    const ipc = result.performance.evidence.find(
      (entry) => entry.area === "ipc",
    );

    expect(result.workspace).toBe(workspace);
    expect(persistence).toMatchObject({
      measurementStatus: "available",
      durationMs: 12.5,
      recordedAt: generatedAt,
      budgetStatus: "not_evaluated",
      stageDurations: [
        {
          id: "persistence.workspace_snapshot_read",
          durationMs: 12.5,
        },
      ],
    });
    expect(ipc).toMatchObject({
      measurementStatus: "unavailable",
      durationMs: null,
    });
    expect(service.getSourceDebugRunDetails).not.toHaveBeenCalled();
  });
});
