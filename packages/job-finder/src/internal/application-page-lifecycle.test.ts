import type { BrowserSessionRuntime } from "@nordri/browser-runtime";
import {
  ApplyJobResultSchema,
  ApplyRunSchema,
  ApplicationRecordSchema,
  UserActionRequestSchema,
} from "@nordri/contracts";
import { describe, expect, test, vi } from "vitest";
import {
  createBrowserRuntime,
  createSeed,
  createWorkspaceServiceHarness,
} from "../workspace-service.test-support";
import {
  releaseFinishedApplicationPages,
  reuseApplicationPage,
} from "./application-page-lifecycle";

const now = "2026-10-03T10:00:00.000Z";
function seedPages(states: string[] = ["awaiting_review"]) {
  const seed = createSeed();
  seed.applicationRecords = [
    ApplicationRecordSchema.parse({
      id: "application_a",
      jobId: "job_ready",
      title: "Synthetic job",
      company: "Synthetic company",
      status: "ready_for_review",
      lastAttemptState: "paused",
      lastActionLabel: "Waiting",
      nextActionLabel: "Review",
      lastUpdatedAt: now,
    }),
  ];
  seed.applyRuns = [
    ApplyRunSchema.parse({
      id: "run_a",
      state: "paused_for_user_review",
      jobIds: ["job_ready"],
      createdAt: now,
      updatedAt: now,
      summary: "Waiting",
      detail: "Synthetic run",
      totalJobs: 1,
    }),
  ];
  seed.applyJobResults = states.map((state, index) =>
    ApplyJobResultSchema.parse({
      id: `result_${index}`,
      runId: "run_a",
      jobId: "job_ready",
      applicationRecordId: "application_a",
      state,
      summary: "Synthetic result",
      detail: "Synthetic result",
      startedAt: now,
      updatedAt: now,
    }),
  );
  return seed;
}

describe("application page ownership", () => {
  test("releases terminal results while retaining waiting and resumable forms", async () => {
    const releaseApplicationPageBinding = vi.fn<
      NonNullable<BrowserSessionRuntime["releaseApplicationPageBinding"]>
    >(() => Promise.resolve());
    const harness = createWorkspaceServiceHarness({
      seed: seedPages([
        "submitted",
        "skipped",
        "cancelled",
        "failed",
        "awaiting_review",
        "blocked",
      ]),
      browserRuntime: {
        ...createBrowserRuntime(),
        releaseApplicationPageBinding,
      },
    });
    await releaseFinishedApplicationPages({ ...harness, runId: "run_a" });
    expect(
      releaseApplicationPageBinding.mock.calls.map((call) => call[1]),
    ).toEqual(["result_0", "result_1", "result_2", "result_3"]);
  });

  test("a tab that will not close leaves the caller's result alone", async () => {
    const harness = createWorkspaceServiceHarness({
      seed: seedPages(["submitted", "blocked"]),
      browserRuntime: {
        ...createBrowserRuntime(),
        releaseApplicationPageBinding: () =>
          Promise.reject(new Error("Target page has been closed")),
        transferApplicationPageBinding: () =>
          Promise.reject(new Error("Target page has been closed")),
      },
    });
    await expect(
      releaseFinishedApplicationPages({ ...harness, runId: "run_a" }),
    ).resolves.toBeUndefined();
    await expect(
      reuseApplicationPage({
        ...harness,
        source: "target_site",
        applicationRecordId: "application_a",
        resultId: "result_next",
      }),
    ).resolves.toBeUndefined();
  });

  test("transfers only a result of the exact application before its replacement starts", async () => {
    const seed = seedPages(["blocked"]);
    seed.applyJobResults.push(
      ApplyJobResultSchema.parse({
        ...seed.applyJobResults[0],
        id: "another_application_result",
        applicationRecordId: "application_b",
      }),
    );
    const transferApplicationPageBinding = vi.fn(() => Promise.resolve(true));
    const harness = createWorkspaceServiceHarness({
      seed,
      browserRuntime: {
        ...createBrowserRuntime(),
        transferApplicationPageBinding,
      },
    });
    await reuseApplicationPage({
      ...harness,
      source: "target_site",
      applicationRecordId: "application_a",
      resultId: "retry_result",
    });
    expect(transferApplicationPageBinding).toHaveBeenCalledExactlyOnceWith(
      "target_site",
      "result_0",
      "retry_result",
    );
  });

  test("a replacement copilot attempt transfers the page before executing its new result", async () => {
    const transferApplicationPageBinding = vi.fn<
      NonNullable<BrowserSessionRuntime["transferApplicationPageBinding"]>
    >(() => Promise.resolve(true));
    const base = createBrowserRuntime();
    const executeApplicationFlow = vi.fn<
      BrowserSessionRuntime["executeApplicationFlow"]
    >((...args) => base.executeApplicationFlow(...args));
    const seed = seedPages(["blocked"]);
    seed.settings.resumeApplicationMode = "original_resume";
    const harness = createWorkspaceServiceHarness({
      seed,
      browserRuntime: {
        ...base,
        transferApplicationPageBinding,
        executeApplicationFlow,
      },
    });
    await harness.workspaceService.startApplyCopilotRun(
      "job_ready",
      undefined,
      "application_a",
    );
    expect(transferApplicationPageBinding).toHaveBeenCalledOnce();
    const nextKey = transferApplicationPageBinding.mock.calls[0]?.[2];
    expect(
      executeApplicationFlow.mock.calls[0]?.[1].applicationPageBindingKey,
    ).toBe(nextKey);
    expect(
      transferApplicationPageBinding.mock.invocationCallOrder[0],
    ).toBeLessThan(executeApplicationFlow.mock.invocationCallOrder[0]!);
  });

  test("a terminal run releases an unfinished form after a cancellation race", async () => {
    const seed = seedPages(["filling", "awaiting_review"]);
    seed.applyRuns = seed.applyRuns?.map((run) => ({
      ...run,
      state: "cancelled" as const,
    }));
    const releaseApplicationPageBinding = vi.fn<
      NonNullable<BrowserSessionRuntime["releaseApplicationPageBinding"]>
    >(() => Promise.resolve());
    const harness = createWorkspaceServiceHarness({
      seed,
      browserRuntime: {
        ...createBrowserRuntime(),
        releaseApplicationPageBinding,
      },
    });
    await releaseFinishedApplicationPages({ ...harness, runId: "run_a" });
    expect(releaseApplicationPageBinding).toHaveBeenCalledExactlyOnceWith(
      "target_site",
      "result_0",
    );
  });

  test("cancelling a run closes blocked forms and keeps completed forms waiting for the person", async () => {
    for (const state of ["blocked", "awaiting_review"]) {
      const releaseApplicationPageBinding = vi.fn<
        NonNullable<BrowserSessionRuntime["releaseApplicationPageBinding"]>
      >(() => Promise.resolve());
      const harness = createWorkspaceServiceHarness({
        seed: seedPages([state]),
        browserRuntime: {
          ...createBrowserRuntime(),
          releaseApplicationPageBinding,
        },
      });
      await harness.workspaceService.cancelApplyRun("run_a");
      if (state === "blocked")
        expect(releaseApplicationPageBinding).toHaveBeenCalledWith(
          "target_site",
          "result_0",
        );
      else expect(releaseApplicationPageBinding).not.toHaveBeenCalled();
    }
  });

  test("removing a job closes its waiting form", async () => {
    const releaseApplicationPageBinding = vi.fn<
      NonNullable<BrowserSessionRuntime["releaseApplicationPageBinding"]>
    >(() => Promise.resolve());
    const harness = createWorkspaceServiceHarness({
      seed: seedPages(),
      browserRuntime: {
        ...createBrowserRuntime(),
        releaseApplicationPageBinding,
      },
    });
    await harness.workspaceService.dismissDiscoveryJob({
      jobId: "job_ready",
      action: "hide_job",
      reasons: ["other"],
    });
    expect(releaseApplicationPageBinding).toHaveBeenCalledWith(
      "target_site",
      "result_0",
    );
  });

  test.each(["cancel", "skip"] as const)(
    "%s closes a dismissed application's page",
    async (action) => {
      const seed = seedPages(["blocked"]);
      seed.userActionRequests = [
        UserActionRequestSchema.parse({
          id: "request_a",
          dedupeKey: "request_a",
          revision: 1,
          kind: "other",
          state: "pending",
          title: "Synthetic step",
          summary: "Synthetic step",
          instructions: ["Review this step"],
          verification: {
            type: "page_blocker_absent",
            blockerFingerprint: "synthetic_blocker",
            expectedPageFingerprint: null,
          },
          createdAt: now,
          updatedAt: now,
          scope: {
            type: "application",
            source: "target_site",
            runId: "run_a",
            resultId: "result_0",
            jobId: "job_ready",
            applicationRecordId: "application_a",
          },
        }),
      ];
      const releaseApplicationPageBinding = vi.fn<
        NonNullable<BrowserSessionRuntime["releaseApplicationPageBinding"]>
      >(() => Promise.resolve());
      const harness = createWorkspaceServiceHarness({
        seed,
        browserRuntime: {
          ...createBrowserRuntime(),
          releaseApplicationPageBinding,
        },
      });
      await harness.workspaceService.performUserAction({
        requestId: "request_a",
        commandId: `command_${action}`,
        expectedRevision: 1,
        action,
        credentialsPolicy: "browser_only",
        submitAuthorized: false,
        accountCreationAuthorized: false,
      });
      expect(releaseApplicationPageBinding).toHaveBeenCalledWith(
        "target_site",
        "result_0",
      );
    },
  );
});
