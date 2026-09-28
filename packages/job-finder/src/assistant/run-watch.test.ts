import type { JobFinderWorkspaceSnapshot } from "@nordri/contracts";
import { describe, expect, it } from "vitest";

import { readRunStatus } from "./run-watch";

function snapshot(stepState: string) {
  return {
    applyRuns: [{ id: "run_1", state: "paused_for_user_review" }],
    applyJobResults: [
      {
        id: "result_1",
        runId: "run_1",
        jobId: "job_1",
        state: "awaiting_review",
        updatedAt: "2026-09-28T03:10:00.000Z",
        blockerSummary: null,
      },
    ],
    userActionRequests: [
      {
        id: "step_1",
        state: stepState,
        scope: { type: "application", runId: "run_1", jobId: "job_1" },
      },
    ],
    discoveryJobs: [],
    companyJobs: [],
    dismissedDiscoveryJobs: [],
  } as unknown as JobFinderWorkspaceSnapshot;
}

const run = {
  kind: "apply_run" as const,
  id: "run_1",
  jobIds: ["job_1"],
};

describe("following an application while an answer is put on the form", () => {
  it("does not report the run as ended while the answer is still verifying", () => {
    expect(readRunStatus(snapshot("verifying"), run).done).toBe(false);
  });

  it("reports it once the step is settled", () => {
    const status = readRunStatus(snapshot("resolved"), run);
    expect(status.done).toBe(true);
    expect(status.summary).toContain("1 awaiting review");
  });
});
