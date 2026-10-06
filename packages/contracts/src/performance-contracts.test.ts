import { describe, expect, it } from "vitest";

import {
  JobFinderPerformanceEvidenceSchema,
  JobFinderPerformanceSnapshotSchema,
} from "./performance";

const recordedAt = "2026-08-09T10:00:00.000Z";

describe("Job Finder performance evidence contracts", () => {
  it("preserves a measured zero as available evidence", () => {
    const evidence = JobFinderPerformanceEvidenceSchema.parse({
      area: "resume_import",
      measurementStatus: "available",
      durationMs: 0,
      recordedAt,
      method: "resume_import_run",
      sampleCount: 1,
      budgetStatus: "not_evaluated",
      stageDurations: [
        { id: "resume_import.literal_extraction", durationMs: 0 },
      ],
    });

    expect(evidence.durationMs).toBe(0);
    expect(evidence.measurementStatus).toBe("available");
  });

  it("requires unavailable evidence to use null instead of a fabricated zero", () => {
    const result = JobFinderPerformanceEvidenceSchema.safeParse({
      area: "renderer_commit",
      measurementStatus: "unavailable",
      durationMs: 0,
      recordedAt: null,
      method: "none",
      sampleCount: 0,
      budgetStatus: "unavailable",
      unavailableReason: "no_recorded_measurement",
    });

    expect(result.success).toBe(false);
  });

  it("requires stage evidence before accepting a partial measurement", () => {
    const result = JobFinderPerformanceEvidenceSchema.safeParse({
      area: "application_preparation",
      measurementStatus: "partial",
      durationMs: null,
      recordedAt,
      method: "application_attempt",
      sampleCount: 1,
      budgetStatus: "not_evaluated",
      stageDurations: [],
      unavailableReason: "total_not_recorded",
    });

    expect(result.success).toBe(false);
  });

  it("keeps older performance snapshots readable with an empty evidence list", () => {
    const snapshot = JobFinderPerformanceSnapshotSchema.parse({
      generatedAt: recordedAt,
      latestDiscoveryRun: null,
      latestSourceDebugRun: null,
    });

    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.budgetEvaluations).toEqual([]);
  });
});

it("waiting forms keep per-process memory, missing measurements and old timing snapshots", async () => {
  const { WaitingFormMemorySchema, JobFinderPerformanceSnapshotSchema } =
    await import("./performance");
  const snapshot = { generatedAt: "2026-10-05T10:00:00Z" };
  expect(
    JobFinderPerformanceSnapshotSchema.parse(snapshot).waitingFormMemory,
  ).toBeUndefined();
  const memory = {
    recordedAt: snapshot.generatedAt,
    totalBytes: 1024,
    budgetBytes: 805306368,
    measurementComplete: false,
    overBudget: false,
    tabs: [
      {
        tabId: "synthetic",
        processId: 42,
        processBytes: 1024,
        backgroundThrottled: true,
      },
      {
        tabId: "missing",
        processId: 0,
        processBytes: null,
        backgroundThrottled: true,
      },
    ],
  };
  expect(
    JobFinderPerformanceSnapshotSchema.parse({
      ...snapshot,
      waitingFormMemory: memory,
    }).waitingFormMemory,
  ).toEqual(memory);
  expect(
    WaitingFormMemorySchema.safeParse({ ...memory, totalBytes: -1 }).success,
  ).toBe(false);
});
