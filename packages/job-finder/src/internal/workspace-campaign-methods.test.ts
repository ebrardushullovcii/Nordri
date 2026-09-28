import { describe, expect, test } from "vitest";

import {
  DISCOVERY_NO_JOB_SITES_MESSAGE,
  DiscoveryRunReportSchema,
  DiscoveryRunRecordSchema,
  type DiscoveryRunRecord,
} from "@nordri/contracts";

import { describeCampaignRunSummary } from "./workspace-campaign-methods";

function createRun(overrides: Record<string, unknown>): DiscoveryRunRecord {
  return DiscoveryRunRecordSchema.parse({
    id: "discovery_run_1",
    campaignId: "campaign-1",
    state: "completed",
    startedAt: "2026-07-31T11:00:00.000Z",
    completedAt: "2026-07-31T11:05:00.000Z",
    ...overrides,
  });
}

const emptyReport = DiscoveryRunReportSchema.parse({
  measuredAt: "2026-07-31T11:05:00.000Z",
});

describe("describeCampaignRunSummary", () => {
  test("says why a run that never started failed instead of printing zero counts", () => {
    const summary = describeCampaignRunSummary(
      createRun({
        state: "failed",
        summary: { warnings: [DISCOVERY_NO_JOB_SITES_MESSAGE] },
      }),
      emptyReport,
      [],
    );

    expect(summary).toBe(`Run failed: ${DISCOVERY_NO_JOB_SITES_MESSAGE}`);
    expect(summary).not.toContain("0 of 0 sources");
    expect(summary).not.toContain("found");
  });

  test("keeps the source tally when a run that planned sources failed", () => {
    const summary = describeCampaignRunSummary(
      createRun({
        state: "failed",
        targetIds: ["source-a", "source-b"],
        targetExecutions: [
          {
            targetId: "source-a",
            adapterKind: "auto",
            state: "completed",
          },
          {
            targetId: "source-b",
            adapterKind: "auto",
            state: "failed",
          },
        ],
        summary: {
          warnings: ["The browser closed before the run finished."],
        },
      }),
      emptyReport,
      [],
    );

    expect(summary).toContain("sources completed");
    expect(summary).toContain(
      "Run failed: The browser closed before the run finished.",
    );
  });

  test("still reports frozen counts for a run that did not fail", () => {
    const summary = describeCampaignRunSummary(
      createRun({
        targetIds: ["source-a"],
        targetExecutions: [
          {
            targetId: "source-a",
            adapterKind: "auto",
            state: "completed",
          },
        ],
      }),
      DiscoveryRunReportSchema.parse({
        measuredAt: "2026-07-31T11:05:00.000Z",
        found: 12,
        new: 3,
        retained: 5,
      }),
      [],
    );

    expect(summary).toBe(
      "1 of 1 sources completed. Discovery completed: 12 found · 3 new · 5 kept.",
    );
  });
});
