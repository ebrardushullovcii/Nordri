import { describe, expect, it } from "vitest";
import { DiscoveryRunRecordSchema } from "@unemployed/contracts";

import {
  buildDiscoveryRunReport,
  completeTargetExecution,
} from "./workspace-discovery-run-helpers";

describe("discovery run change digest", () => {
  it("aggregates source changes, health, warnings, and duration into the persisted summary", () => {
    const run = DiscoveryRunRecordSchema.parse({
      id: "run-change-digest",
      state: "running",
      startedAt: "2026-07-31T10:00:00.000Z",
      targetIds: ["source-one", "source-two"],
      targetExecutions: [
        {
          targetId: "source-one",
          adapterKind: "auto",
          state: "running",
          startedAt: "2026-07-31T10:00:00.000Z",
        },
        {
          targetId: "source-two",
          adapterKind: "auto",
          state: "running",
          startedAt: "2026-07-31T10:00:01.000Z",
        },
      ],
    });

    const firstComplete = completeTargetExecution(
      run,
      "source-one",
      "2026-07-31T10:00:03.000Z",
      {
        state: "completed",
        // A source that completed with nothing found is graded as a warning,
        // so this one has to have actually found something to read as healthy.
        jobsFound: 3,
        changeDigest: {
          new: 3,
          unchanged: 4,
          changed: 1,
          reactivated: 1,
          inactive: 2,
          known: 6,
          skipped: 1,
        },
      },
    );
    const allComplete = completeTargetExecution(
      firstComplete,
      "source-two",
      "2026-07-31T10:00:05.000Z",
      {
        state: "failed",
        warning: "The source stopped responding.",
        changeDigest: {
          new: 0,
          unchanged: 1,
          changed: 0,
          reactivated: 0,
          inactive: 0,
          known: 1,
          skipped: 2,
        },
      },
    );

    expect(allComplete.summary.changeDigest).toEqual({
      new: 3,
      unchanged: 5,
      changed: 1,
      reactivated: 1,
      inactive: 2,
      known: 7,
      skipped: 3,
    });
    expect(allComplete.summary.sourceHealth).toEqual([
      {
        targetId: "source-one",
        health: "healthy",
        durationMs: 3_000,
        warnings: [],
      },
      {
        targetId: "source-two",
        health: "failed",
        durationMs: 4_000,
        warnings: ["The source stopped responding."],
      },
    ]);
    expect(allComplete.summary.warnings).toEqual([
      "The source stopped responding.",
    ]);
  });

  it("keeps a productive completed source healthy when it has an informational stop note", () => {
    const run = DiscoveryRunRecordSchema.parse({
      id: "run-productive-warning",
      state: "running",
      startedAt: "2026-09-12T10:00:00.000Z",
      targetIds: ["source-one"],
      targetExecutions: [
        {
          targetId: "source-one",
          adapterKind: "auto",
          state: "running",
          startedAt: "2026-09-12T10:00:00.000Z",
        },
      ],
    });

    const completed = completeTargetExecution(
      run,
      "source-one",
      "2026-09-12T10:01:00.000Z",
      {
        state: "completed",
        jobsFound: 50,
        warning: "Stopped early after repeated listings; 50 jobs were kept.",
      },
    );

    expect(completed.summary.sourceHealth).toEqual([
      expect.objectContaining({
        targetId: "source-one",
        health: "healthy",
        warnings: [
          "Stopped early after repeated listings; 50 jobs were kept.",
        ],
      }),
    ]);
  });

  it("marks only an empty listing; a re-run that met only saved jobs stays healthy", () => {
    const run = DiscoveryRunRecordSchema.parse({
      id: "run-known-only",
      state: "running",
      startedAt: "2026-07-31T10:00:00.000Z",
      targetIds: ["known-only", "empty"],
      targetExecutions: [
        { targetId: "known-only", adapterKind: "auto", state: "running" },
        { targetId: "empty", adapterKind: "auto", state: "running" },
      ],
    });
    const knownOnly = completeTargetExecution(
      run,
      "known-only",
      "2026-07-31T10:00:03.000Z",
      { state: "completed", jobsFound: 0, jobsSkippedByLedger: 10 },
    );
    const both = completeTargetExecution(
      knownOnly,
      "empty",
      "2026-07-31T10:00:04.000Z",
      { state: "completed", jobsFound: 0 },
    );
    expect(
      both.summary.sourceHealth.map(({ targetId, health }) => ({
        targetId,
        health,
      })),
    ).toEqual([
      { targetId: "known-only", health: "healthy" },
      { targetId: "empty", health: "warning" },
    ]);
    // The frozen report counts the saved listings it met as found, so the
    // banner reads "10 found · 0 new · 10 already here", never "0 found".
    expect(
      buildDiscoveryRunReport(both, "2026-07-31T10:00:05.000Z"),
    ).toMatchObject({ found: 10, new: 0 });
  });
});
