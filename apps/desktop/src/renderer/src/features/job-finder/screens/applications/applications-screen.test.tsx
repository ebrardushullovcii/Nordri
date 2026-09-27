// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApplyRunDetails,
  ApplyRunSummary,
  ApplyJobResultSummary,
  ApplicationAttempt,
  ApplicationRecord,
  BrowserVisualEvidenceSummary,
  JobFinderWorkspaceSnapshot,
} from "@unemployed/contracts";
import {
  ApplicationAttemptSchema,
  ApplicationCrmSettingsSchema,
  ApplicationRecordSchema,
  JobFinderIntelligenceSafeguardsSchema,
} from "@unemployed/contracts";
import { countActiveSafeguardBlockers } from "../../lib/safeguards-blocker-count";
import { formatDailyPreparationCapacityReachedText } from "../../lib/job-finder-daily-capacity";
import { ApplicationsScreen } from "./applications-screen";
import type { ApplicationsDetailPanel } from "./applications-detail-panel";
import { ApplicationsDetailPanelAttemptSection } from "./applications-detail-panel-attempt-section";
import type { ApplicationsDetailPanelRecoverySections } from "./applications-detail-panel-recovery-sections";

describe("ApplicationsScreen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function createVisualEvidence(
    overrides: Partial<BrowserVisualEvidenceSummary> = {},
  ): BrowserVisualEvidenceSummary {
    return {
      snapshotId: "visual_snapshot_apply_1",
      observationSetId: "visual_observation_apply_1",
      summary: "Visible resume upload and disabled final submit button.",
      capturedAt: "2026-03-20T10:04:30.000Z",
      storagePath: null,
      retention: "temporary",
      redactionLevel: "sensitive",
      confidence: 0.76,
      reconciliationStatus: "not_compared",
      ...overrides,
    };
  }

  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }

  function createTrackedApplication(
    overrides: Record<string, unknown> = {},
  ): ApplicationRecord {
    return ApplicationRecordSchema.parse({
      id: "application_beta",
      jobId: "job_beta",
      title: "Backend Engineer",
      company: "Beta",
      status: "approved",
      lastActionLabel: "Prepared",
      nextActionLabel: "Review",
      lastUpdatedAt: "2026-08-15T10:00:00.000Z",
      crm: {
        stage: "ready_for_approval",
        stageChangedAt: "2026-08-15T10:00:00.000Z",
      },
      ...overrides,
    });
  }

  function stubCandidateAssetsBridge() {
    Object.defineProperty(window, "unemployed", {
      configurable: true,
      value: {
        jobFinder: {
          listCandidateAssets: vi.fn(() => Promise.resolve({ assets: [] })),
        },
      },
    });
  }

  function buildCrmScreenProps(input: {
    applicationRecords: readonly ApplicationRecord[];
    onSelectRecord: (recordId: string) => void;
    selectedRecord: ApplicationRecord | null;
    includeTrackerControls?: boolean;
  }) {
    const { includeTrackerControls = true } = input;
    return {
      applicationAttempts: [],
      applicationRecords: input.applicationRecords,
      applyRuns: [],
      applyJobResults: [],
      discoveryJobs: [],
      isApplyPending: false,
      isApplyRequestPending: () => false,
      isApplyRunPending: () => false,
      onApproveApplyRun: vi.fn(),
      onCancelApplyRun: vi.fn(),
      onGetApplyRunDetails: vi.fn(),
      onExportApplicationPacket: vi.fn(),
      onResolveApplyConsentRequest: vi.fn(),
      onSaveApplicationAnswer: vi.fn(() =>
        Promise.reject(new Error("unused in this scenario")),
      ),
      onClearApplicationAnswer: vi.fn(() =>
        Promise.reject(new Error("unused in this scenario")),
      ),
      onRevokeApplyRunApproval: vi.fn(),
      onStartAutoApplyQueue: vi.fn(),
      onStartApplyCopilot: vi.fn(),
      onStartAutoApply: vi.fn(),
      onSelectRecord: input.onSelectRecord,
      selectedApplyRunId: null,
      selectedAttempt: null as ApplicationAttempt | null,
      selectedRecord: input.selectedRecord,
      ...(includeTrackerControls
        ? {
            crmSettings: ApplicationCrmSettingsSchema.parse({}),
            onMutateApplicationCrm: vi.fn(() => Promise.resolve()),
            onExportApplicationCrm: vi.fn(() => Promise.resolve()),
          }
        : {}),
    };
  }

  it("retries failed applications with the exact saved Send mode", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const first = createTrackedApplication({
      id: "application_retry_a",
      jobId: "job_retry_a",
      lastAttemptState: "failed",
      lastActionLabel: "Could not apply",
    });
    const second = createTrackedApplication({
      id: "application_retry_b",
      jobId: "job_retry_b",
      lastAttemptState: "failed",
      lastActionLabel: "Could not apply",
    });
    const failedResult = (
      record: ApplicationRecord,
      index: number,
    ): ApplyJobResultSummary => ({
      id: `result_retry_${index}`,
      runId: "run_retry_failed",
      jobId: record.jobId,
      applicationRecordId: record.id,
      queuePosition: index,
      state: "failed",
      summary: "Could not apply",
      detail: "The application could not be prepared.",
      startedAt: "2026-09-22T16:00:00.000Z",
      updatedAt: `2026-09-22T16:0${index + 1}:00.000Z`,
      completedAt: `2026-09-22T16:0${index + 1}:00.000Z`,
      blockerReason: "application_page_unreachable",
      blockerSummary: "The application could not be prepared.",
      listingSignalEvidence: null,
      visualObservationSets: [],
      visualCheckpoints: [],
      latestQuestionCount: 0,
      latestAnswerCount: 0,
      pendingConsentRequestCount: 0,
      artifactCount: 0,
      latestCheckpointId: null,
      privacyReceipt: null,
      reviewCard: null,
    });
    const onStartAutoApplyQueue = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          {...buildCrmScreenProps({
            applicationRecords: [first, second],
            onSelectRecord: vi.fn(),
            selectedRecord: first,
          })}
          applicationAutomationMode="autonomous_submit"
          applyJobResults={[failedResult(first, 0), failedResult(second, 1)]}
          dailyPreparationCapacity={null}
          onGetApplyRunDetails={vi.fn(
            () => new Promise<ApplyRunDetails>(() => {}),
          )}
          onStartAutoApplyQueue={onStartAutoApplyQueue}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Try again for all 2" }),
    );
    expect(onStartAutoApplyQueue).toHaveBeenCalledWith(
      ["job_retry_a", "job_retry_b"],
      "autonomous_submit",
    );
  });

  it("shows action-led first-run CTAs when there are no applications yet", () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[]}
          applyRuns={[]}
          applyJobResults={[]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={vi.fn()}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={null}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Nothing applied to yet")).toBeTruthy();
    expect(
      screen.getByText(/Press Apply on a shortlisted job and it shows up here/i),
    ).toBeTruthy();
    expect(
      screen.queryByText("Application details will appear here"),
    ).toBeNull();

    const shortlistedLinks = screen.getAllByRole("link", {
      name: "Open Shortlisted",
    });
    expect(shortlistedLinks).toHaveLength(2);
    for (const link of shortlistedLinks) {
      expect(link.getAttribute("href")).toBe("/job-finder/review-queue");
    }
    expect(
      screen.getByRole("link", { name: "Find jobs" }).getAttribute("href"),
    ).toBe("/job-finder/discovery");
    expect(screen.queryByRole("button", { name: /needs action/i })).toBeNull();

    // With nothing to track, the tracker is not offered at all.
    expect(screen.queryByRole("button", { name: "Open tracker" })).toBeNull();
  });

  it("keeps workspace modes directly under the title and renders notices below them", () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const view = render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[]}
          applyRuns={[]}
          applyJobResults={[]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={vi.fn()}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onOpenSafeguards={vi.fn()}
          safeguardsBlockerCount={2}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={null}
        />
      </MemoryRouter>,
    );

    const stack = view.container.querySelector("[data-page-header-stack]");
    const subnav = view.container.querySelector("[data-page-header-subnav]");
    const dividers = view.container.querySelectorAll(
      "[data-page-header-divider]",
    );
    const safeguards = screen.getByRole("region", {
      name: "Active safeguards",
    });
    expect(safeguards.textContent).toContain(
      "2 active safeguard blockers need attention. Affected work is paused; job discovery may still be available.",
    );

    expect(dividers).toHaveLength(1);
    expect(stack?.className).toContain("mb-(--gap-page-header-body)");

    // Preparation is the product: there is no Preparation/Stages tab pair,
    // and with no applications yet there is nothing to track either.
    expect(subnav).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Applications workspace view" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Stages" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open tracker" })).toBeNull();
    expect(
      document.getElementById("applications-workspace-content"),
    ).toBeTruthy();
  });

  it("shows the latest-run banner only while it still needs attention, and never leaks a raw state", () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const finishedRun: ApplyRunSummary = {
      id: "apply_run_finished",
      campaignId: null,
      mode: "queue_auto",
      state: "failed",
      jobIds: ["job_finished"],
      currentJobId: null,
      submitApprovalId: null,
      visualCheckpointsEnabled: false,
      createdAt: "2026-08-20T09:55:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      summary: "Finished with failures.",
      detail: "The queue stopped before every job was tried.",
      totalJobs: 1,
      pendingJobs: 0,
      submittedJobs: 0,
      skippedJobs: 0,
      blockedJobs: 0,
      failedJobs: 1,
    };
    const buildProps = (state: ApplyRunSummary["state"]) => ({
      dailyPreparationCapacity: null,
      applicationAttempts: [],
      applicationRecords: [],
      applyRuns: [{ ...finishedRun, state }],
      applyJobResults: [],
      discoveryJobs: [],
      isApplyPending: false,
      isApplyRequestPending: () => false,
      isApplyRunPending: () => false,
      onApproveApplyRun: vi.fn(),
      onCancelApplyRun: vi.fn(),
      onGetApplyRunDetails: vi.fn(),
      onExportApplicationPacket: vi.fn(),
      onResolveApplyConsentRequest: vi.fn(),
      onSaveApplicationAnswer: vi.fn(() =>
        Promise.reject(new Error("unused in this scenario")),
      ),
      onClearApplicationAnswer: vi.fn(() =>
        Promise.reject(new Error("unused in this scenario")),
      ),
      onRevokeApplyRunApproval: vi.fn(),
      onSelectRecord: vi.fn(),
      onStartApplyCopilot: vi.fn(),
      onStartAutoApply: vi.fn(),
      onStartAutoApplyQueue: vi.fn(),
      selectedApplyRunId: null,
      selectedAttempt: null,
      selectedRecord: null,
    });

    // With zero results there are no attention cases, so the run is history:
    // the banner is not page furniture and does not reappear as a fresh event
    // every time the user comes back from the tracker. The run stays visible
    // in the record's own run history.
    for (const rawState of ["failed", "cancelled"] as const) {
      render(
        <MemoryRouter>
          <ApplicationsScreen {...buildProps(rawState)} />
        </MemoryRouter>,
      );

      expect(screen.queryByText("Latest automatic run")).toBeNull();
      expect(screen.queryByText(rawState)).toBeNull();

      cleanup();
    }

    // When it does need attention it says so, and it counts the cases rather
    // than naming a run state.
    render(
      <MemoryRouter>
        <ApplicationsScreen
          {...buildProps("failed")}
          applyJobResults={[
            {
              id: "apply_result_attention",
              runId: "apply_run_finished",
              jobId: "job_finished",
              applicationRecordId: null,
              queuePosition: 0,
              state: "blocked",
              summary: "Blocked before review.",
              detail: "The run stopped before the job was prepared.",
              startedAt: "2026-08-20T09:56:00.000Z",
              updatedAt: "2026-08-20T10:00:00.000Z",
              completedAt: "2026-08-20T10:00:00.000Z",
              blockerReason: "required_human_input",
              blockerSummary: "The job site needs you to finish a step.",
              listingSignalEvidence: null,
              visualObservationSets: [],
              visualCheckpoints: [],
              latestQuestionCount: 0,
              latestAnswerCount: 0,
              pendingConsentRequestCount: 0,
              artifactCount: 0,
              latestCheckpointId: null,
              privacyReceipt: null,
    reviewCard: null,
            },
          ]}
          // The banner counts this run's share of the Needs you population
          // rather than its own result states, so the fixture carries the
          // open request that makes the blocked job something to act on.
          userActionRequests={
            [
              {
                id: "request_finished",
                state: "awaiting_user",
                scope: {
                  type: "application",
                  runId: "apply_run_finished",
                  jobId: "job_finished",
                  applicationRecordId: null,
                },
              },
            ] as unknown as JobFinderWorkspaceSnapshot["userActionRequests"]
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Latest automatic run")).toBeTruthy();
    expect(screen.getByText("1 unusual case")).toBeTruthy();
    expect(screen.queryByText("failed")).toBeNull();
  });

  it("does not show the pause banner for a contradictory answer advisory", () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const safeguards = JobFinderIntelligenceSafeguardsSchema.parse({
      contradictoryAnswerDetections: [
        {
          id: "detection_1",
          questionA: "How many years?",
          questionB: "Experience years?",
          answerA: "5",
          answerB: "2",
          contradictionScore: 0.9,
          status: "detected",
          detectedAt: "2026-08-15T10:00:00.000Z",
          resolvedAt: null,
          explanation: "Answers conflict.",
          recoveryGuidance: "Ask the user to confirm the correct answer.",
        },
      ],
    });

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[]}
          applyRuns={[]}
          applyJobResults={[]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={vi.fn()}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          safeguardsBlockerCount={countActiveSafeguardBlockers(safeguards)}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={null}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("region", { name: "Active safeguards" }),
    ).toBeNull();
  });

  it("loads details for a newly selected historical apply run", async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const selectedRecord: ApplicationRecord = {
      id: "application_1",
      jobId: "job_ready",
      title: "Senior Product Designer",
      company: "Signal Systems",
      status: "ready_for_review",
      lastActionLabel: "Resume approved",
      nextActionLabel: "Start apply copilot",
      lastUpdatedAt: "2026-03-20T10:05:00.000Z",
      lastAttemptState: "submitted",
      questionSummary: {
        total: 0,
        required: 0,
        answered: 0,
        unansweredRequired: 0,
      },
      latestBlocker: null,
      consentSummary: {
        status: "none",
        pendingCount: 0,
      },
      replaySummary: {
        sourceInstructionArtifactId: null,
        lastUrl: null,
        checkpointCount: 0,
        evidenceCount: 0,
      },
      events: [],
      crm: null,
    automationMode: "prepare_only" as const,
    };
    const applyRuns: ApplyRunSummary[] = [
      {
        id: "apply_run_latest",
        campaignId: null,
        mode: "copilot",
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        submitApprovalId: null,
        visualCheckpointsEnabled: false,
        createdAt: "2026-03-20T10:04:00.000Z",
        updatedAt: "2026-03-20T10:05:00.000Z",
        completedAt: "2026-03-20T10:05:00.000Z",
        summary: "Latest run",
        detail: "Latest safe run finished.",
        totalJobs: 1,
        pendingJobs: 0,
        submittedJobs: 1,
        skippedJobs: 0,
        blockedJobs: 0,
        failedJobs: 0,
      },
      {
        id: "apply_run_older",
        campaignId: null,
        mode: "copilot",
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        submitApprovalId: null,
        visualCheckpointsEnabled: false,
        createdAt: "2026-03-20T09:54:00.000Z",
        updatedAt: "2026-03-20T09:55:00.000Z",
        completedAt: "2026-03-20T09:55:00.000Z",
        summary: "Older run",
        detail: "Older safe run finished.",
        totalJobs: 1,
        pendingJobs: 0,
        submittedJobs: 1,
        skippedJobs: 0,
        blockedJobs: 0,
        failedJobs: 0,
      },
    ];
    const applyJobResults: ApplyJobResultSummary[] = [
      {
        id: "apply_result_latest",
        runId: "apply_run_latest",
        jobId: "job_ready",
        applicationRecordId: selectedRecord.id,
        queuePosition: 0,
        state: "submitted",
        summary: "Latest application summary",
        detail: "Latest application detail",
        startedAt: "2026-03-20T10:04:00.000Z",
        updatedAt: "2026-03-20T10:05:00.000Z",
        completedAt: "2026-03-20T10:05:00.000Z",
        blockerReason: null,
        blockerSummary: null,
        listingSignalEvidence: null,
        visualObservationSets: [],
        visualCheckpoints: [],
        latestQuestionCount: 0,
        latestAnswerCount: 0,
        pendingConsentRequestCount: 0,
        artifactCount: 0,
        latestCheckpointId: null,
        privacyReceipt: null,
    reviewCard: null,
      },
      {
        id: "apply_result_older",
        runId: "apply_run_older",
        jobId: "job_ready",
        applicationRecordId: selectedRecord.id,
        queuePosition: 0,
        state: "blocked",
        summary: "Older application summary",
        detail: "Older application detail",
        startedAt: "2026-03-20T09:54:00.000Z",
        updatedAt: "2026-03-20T09:55:00.000Z",
        completedAt: "2026-03-20T09:55:00.000Z",
        blockerReason: "required_human_input",
        blockerSummary: "Needed manual follow-up",
        listingSignalEvidence: null,
        visualObservationSets: [],
        visualCheckpoints: [],
        latestQuestionCount: 0,
        latestAnswerCount: 0,
        pendingConsentRequestCount: 0,
        artifactCount: 0,
        latestCheckpointId: null,
        privacyReceipt: null,
    reviewCard: null,
      },
    ];
    const otherRecordForSameJob: ApplicationRecord = {
      ...selectedRecord,
      id: "application_ready_other",
      lastActionLabel: "Separate application record",
      lastUpdatedAt: "2026-03-20T10:06:00.000Z",
    };
    applyJobResults.push({
      ...applyJobResults[0]!,
      id: "apply_result_other_record",
      applicationRecordId: otherRecordForSameJob.id,
      summary: "Other record must stay isolated",
      state: "failed",
      updatedAt: "2026-03-20T10:06:00.000Z",
    });
    const onGetApplyRunDetails = vi.fn(
      (input: { runId: string }): Promise<ApplyRunDetails> =>
        Promise.resolve({
          run:
            applyRuns.find((entry) => entry.id === input.runId) ??
            applyRuns[0]!,
          result:
            applyJobResults.find((entry) => entry.runId === input.runId) ??
            null,
          results: applyJobResults.filter(
            (entry) => entry.runId === input.runId,
          ),
          submitApproval: null,
          questionRecords: [],
          answerRecords: [],
          artifactRefs: [],
          checkpoints: [],
          consentRequests: [],
  reviewCard: null,
        }),
    );

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[selectedRecord, otherRecordForSameJob]}
          applyRuns={applyRuns}
          applyJobResults={applyJobResults}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={onGetApplyRunDetails}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={selectedRecord}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(onGetApplyRunDetails).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Other record must stay isolated")).toBeNull();
    expect(
      screen.getByRole("link", { name: /prepare interview/i }),
    ).toBeTruthy();

    const olderRunButton = screen.getByTitle("apply_run_older");

    fireEvent.click(olderRunButton);

    await waitFor(() => {
      expect(onGetApplyRunDetails).toHaveBeenCalledTimes(2);
    });
    expect(onGetApplyRunDetails).toHaveBeenLastCalledWith({
      runId: "apply_run_older",
      jobId: "job_ready",
      applicationRecordId: selectedRecord.id,
    });
  });

  it("opens the newest attempt, not the most recently updated older run", async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const selectedRecord: ApplicationRecord = {
      id: "application_1",
      jobId: "job_ready",
      title: "Senior Product Designer",
      company: "Signal Systems",
      status: "ready_for_review",
      lastActionLabel: "Resume approved",
      nextActionLabel: "Start apply copilot",
      lastUpdatedAt: "2026-03-20T10:05:00.000Z",
      lastAttemptState: "submitted",
      questionSummary: {
        total: 0,
        required: 0,
        answered: 0,
        unansweredRequired: 0,
      },
      latestBlocker: null,
      consentSummary: {
        status: "none",
        pendingCount: 0,
      },
      replaySummary: {
        sourceInstructionArtifactId: null,
        lastUrl: null,
        checkpointCount: 0,
        evidenceCount: 0,
      },
      events: [],
      crm: null,
    automationMode: "prepare_only" as const,
    };
    const applyRuns: ApplyRunSummary[] = [
      {
        id: "apply_run_latest",
        campaignId: null,
        mode: "copilot",
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        submitApprovalId: null,
        visualCheckpointsEnabled: false,
        createdAt: "2026-03-20T10:04:00.000Z",
        updatedAt: "2026-03-20T10:05:00.000Z",
        completedAt: "2026-03-20T10:05:00.000Z",
        summary: "Latest run",
        detail: "Latest safe run finished.",
        totalJobs: 1,
        pendingJobs: 0,
        submittedJobs: 1,
        skippedJobs: 0,
        blockedJobs: 0,
        failedJobs: 0,
      },
      {
        id: "apply_run_older",
        campaignId: null,
        mode: "copilot",
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        submitApprovalId: null,
        visualCheckpointsEnabled: false,
        createdAt: "2026-03-20T09:54:00.000Z",
        updatedAt: "2026-03-20T09:55:00.000Z",
        completedAt: "2026-03-20T09:55:00.000Z",
        summary: "Older run",
        detail: "Older safe run finished.",
        totalJobs: 1,
        pendingJobs: 0,
        submittedJobs: 1,
        skippedJobs: 0,
        blockedJobs: 0,
        failedJobs: 0,
      },
    ];
    const applyJobResults: ApplyJobResultSummary[] = [
      {
        id: "apply_result_latest",
        runId: "apply_run_latest",
        jobId: "job_ready",
        applicationRecordId: selectedRecord.id,
        queuePosition: 0,
        state: "submitted",
        summary: "Latest application summary",
        detail: "Latest application detail",
        startedAt: "2026-03-20T10:04:00.000Z",
        updatedAt: "2026-03-20T10:05:00.000Z",
        completedAt: "2026-03-20T10:05:00.000Z",
        blockerReason: null,
        blockerSummary: null,
        listingSignalEvidence: null,
        visualObservationSets: [],
        visualCheckpoints: [],
        latestQuestionCount: 0,
        latestAnswerCount: 0,
        pendingConsentRequestCount: 0,
        artifactCount: 0,
        latestCheckpointId: null,
        privacyReceipt: null,
    reviewCard: null,
      },
      {
        id: "apply_result_older",
        runId: "apply_run_older",
        jobId: "job_ready",
        applicationRecordId: selectedRecord.id,
        queuePosition: 0,
        state: "blocked",
        summary: "Older application summary",
        detail: "Older application detail",
        startedAt: "2026-03-20T09:54:00.000Z",
        updatedAt: "2026-03-20T09:55:00.000Z",
        completedAt: "2026-03-20T09:55:00.000Z",
        blockerReason: "required_human_input",
        blockerSummary: "Needed manual follow-up",
        listingSignalEvidence: null,
        visualObservationSets: [],
        visualCheckpoints: [],
        latestQuestionCount: 0,
        latestAnswerCount: 0,
        pendingConsentRequestCount: 0,
        artifactCount: 0,
        latestCheckpointId: null,
        privacyReceipt: null,
    reviewCard: null,
      },
    ];
    const otherRecordForSameJob: ApplicationRecord = {
      ...selectedRecord,
      id: "application_ready_other",
      lastActionLabel: "Separate application record",
      lastUpdatedAt: "2026-03-20T10:06:00.000Z",
    };
    applyJobResults.push({
      ...applyJobResults[0]!,
      id: "apply_result_other_record",
      applicationRecordId: otherRecordForSameJob.id,
      summary: "Other record must stay isolated",
      state: "failed",
      updatedAt: "2026-03-20T10:06:00.000Z",
    });
    const onGetApplyRunDetails = vi.fn(
      (input: { runId: string }): Promise<ApplyRunDetails> =>
        Promise.resolve({
          run:
            applyRuns.find((entry) => entry.id === input.runId) ??
            applyRuns[0]!,
          result:
            applyJobResults.find((entry) => entry.runId === input.runId) ??
            null,
          results: applyJobResults.filter(
            (entry) => entry.runId === input.runId,
          ),
          submitApproval: null,
          questionRecords: [],
          answerRecords: [],
          artifactRefs: [],
          checkpoints: [],
          consentRequests: [],
  reviewCard: null,
        }),
    );

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[selectedRecord, otherRecordForSameJob]}
          applyRuns={applyRuns}
          applyJobResults={applyJobResults}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={onGetApplyRunDetails}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId="apply_run_older"
          selectedAttempt={null}
          selectedRecord={selectedRecord}
        />
      </MemoryRouter>,
    );

    // The workspace-wide selection is the most recently updated run, which
    // after a retry is often the older batch. The record still shows (and
    // "Open the Job Finder browser" targets) its newest attempt.
    await waitFor(() => {
      expect(onGetApplyRunDetails).toHaveBeenCalledTimes(1);
    });
    expect(onGetApplyRunDetails).toHaveBeenLastCalledWith({
      runId: "apply_run_latest",
      jobId: "job_ready",
      applicationRecordId: selectedRecord.id,
    });
  });

  it("counts and associates legacy null-lineage run history with the matching application record", async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();

    const legacyRecord = ApplicationRecordSchema.parse({
      id: "application_legacy_lineage",
      jobId: "job_legacy",
      title: "Legacy Lineage Engineer",
      company: "Heritage Systems",
      status: "submitted",
      lastActionLabel: "Submitted via safe run",
      nextActionLabel: null,
      lastUpdatedAt: "2026-08-20T10:00:00.000Z",
      lastAttemptState: "submitted",
    });
    const legacyRun: ApplyRunSummary = {
      id: "apply_run_legacy",
      campaignId: "campaign_active",
      mode: "copilot",
      state: "completed",
      jobIds: ["job_legacy"],
      currentJobId: null,
      submitApprovalId: null,
      visualCheckpointsEnabled: false,
      createdAt: "2026-08-20T09:55:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      summary: "Legacy run",
      detail: "Completed before application records existed.",
      totalJobs: 1,
      pendingJobs: 0,
      submittedJobs: 1,
      skippedJobs: 0,
      blockedJobs: 0,
      failedJobs: 0,
    };
    const legacyResult: ApplyJobResultSummary = {
      id: "apply_result_legacy",
      runId: legacyRun.id,
      jobId: "job_legacy",
      applicationRecordId: null,
      queuePosition: 0,
      state: "submitted",
      summary: "Prepared and submitted the application form.",
      detail: "Legacy result stored before application records existed.",
      startedAt: "2026-08-20T09:56:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      blockerReason: null,
      blockerSummary: null,
      listingSignalEvidence: null,
      visualObservationSets: [],
      visualCheckpoints: [],
      latestQuestionCount: 0,
      latestAnswerCount: 0,
      pendingConsentRequestCount: 0,
      artifactCount: 0,
      latestCheckpointId: null,
      privacyReceipt: null,
    reviewCard: null,
    };
    const legacyAttempt = ApplicationAttemptSchema.parse({
      id: "attempt_legacy",
      jobId: "job_legacy",
      applicationRecordId: null,
      state: "submitted",
      summary: "Legacy attempt prepared every required answer.",
      detail: "Legacy attempt stored before application records existed.",
      startedAt: "2026-08-20T09:56:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      outcome: "submitted",
      nextActionLabel: null,
    });
    const onGetApplyRunDetails = vi.fn(
      (): Promise<ApplyRunDetails> =>
        Promise.resolve({
          run: legacyRun,
          result: legacyResult,
          results: [legacyResult],
          submitApproval: null,
          questionRecords: [],
          answerRecords: [],
          artifactRefs: [],
          checkpoints: [],
          consentRequests: [],
  reviewCard: null,
        }),
    );

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[legacyAttempt]}
          applicationRecords={[legacyRecord]}
          applyRuns={[legacyRun]}
          applyJobResults={[legacyResult]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={onGetApplyRunDetails}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={legacyRecord}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("1 application")).toBeTruthy();
    // Association is proven by the run entry itself; the recovery section no
    // longer repeats a saved-run count above its one action.
    expect(screen.getAllByTitle("apply_run_legacy").length).toBeGreaterThan(0);
    expect(screen.queryByText(/runs? saved/i)).toBeNull();
    expect(
      screen.getByText("Legacy attempt prepared every required answer."),
    ).toBeTruthy();
    await waitFor(() => {
      expect(onGetApplyRunDetails).toHaveBeenCalledTimes(1);
    });
    expect(onGetApplyRunDetails).toHaveBeenCalledWith({
      runId: "apply_run_legacy",
      jobId: "job_legacy",
      applicationRecordId: "application_legacy_lineage",
    });
    expect(
      screen.queryByText(/Unassigned legacy preparation history/i),
    ).toBeNull();
  });

  it("keeps legacy null-lineage history unassigned when two records share the job", () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();

    const firstRecord = ApplicationRecordSchema.parse({
      id: "application_shared_first",
      jobId: "job_shared",
      title: "Shared Job Engineer",
      company: "Ambiguous Co",
      status: "submitted",
      lastActionLabel: "Prepared",
      nextActionLabel: null,
      lastUpdatedAt: "2026-08-20T10:00:00.000Z",
      lastAttemptState: "submitted",
    });
    const secondRecord = ApplicationRecordSchema.parse({
      ...firstRecord,
      id: "application_shared_second",
      lastUpdatedAt: "2026-08-21T10:00:00.000Z",
    });
    const sharedRun: ApplyRunSummary = {
      id: "apply_run_shared",
      campaignId: "campaign_active",
      mode: "copilot",
      state: "completed",
      jobIds: ["job_shared"],
      currentJobId: null,
      submitApprovalId: null,
      visualCheckpointsEnabled: false,
      createdAt: "2026-08-20T09:55:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      summary: "Shared run",
      detail: "Legacy result cannot be attributed to one record.",
      totalJobs: 1,
      pendingJobs: 0,
      submittedJobs: 1,
      skippedJobs: 0,
      blockedJobs: 0,
      failedJobs: 0,
    };
    const sharedResult: ApplyJobResultSummary = {
      id: "apply_result_shared",
      runId: sharedRun.id,
      jobId: "job_shared",
      applicationRecordId: null,
      queuePosition: 0,
      state: "submitted",
      summary: "Prepared and submitted the application form.",
      detail: "Ownership is ambiguous between two records.",
      startedAt: "2026-08-20T09:56:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      completedAt: "2026-08-20T10:00:00.000Z",
      blockerReason: null,
      blockerSummary: null,
      listingSignalEvidence: null,
      visualObservationSets: [],
      visualCheckpoints: [],
      latestQuestionCount: 0,
      latestAnswerCount: 0,
      pendingConsentRequestCount: 0,
      artifactCount: 0,
      latestCheckpointId: null,
      privacyReceipt: null,
    reviewCard: null,
    };

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[firstRecord, secondRecord]}
          applyRuns={[sharedRun]}
          applyJobResults={[sharedResult]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={vi.fn()}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={firstRecord}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 applications")).toBeTruthy();
    expect(screen.queryByText(/runs? saved/i)).toBeNull();
    expect(screen.queryByTitle("apply_run_shared")).toBeNull();
    expect(
      screen.getByText(/Unassigned legacy preparation history/i),
    ).toBeTruthy();
  });

  it("renders persisted apply visual evidence in the review panel", async () => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const visualEvidence = createVisualEvidence();
    const selectedRecord: ApplicationRecord = {
      id: "application_visual",
      jobId: "job_visual",
      title: "Senior Platform Engineer",
      company: "Visual Systems",
      status: "ready_for_review",
      lastActionLabel: "Apply copilot paused before final submit",
      nextActionLabel:
        "Review the prepared application and submit manually when ready",
      lastUpdatedAt: "2026-03-20T10:05:00.000Z",
      lastAttemptState: "paused",
      questionSummary: {
        total: 1,
        required: 1,
        answered: 1,
        unansweredRequired: 0,
      },
      latestBlocker: null,
      consentSummary: {
        status: "approved",
        pendingCount: 0,
      },
      replaySummary: {
        sourceInstructionArtifactId: null,
        lastUrl: "https://jobs.example.com/apply",
        checkpointCount: 1,
        evidenceCount: 0,
      },
      events: [],
      crm: null,
    automationMode: "prepare_only" as const,
    };
    const applyRun: ApplyRunSummary = {
      id: "apply_run_visual",
      campaignId: null,
      mode: "copilot",
      state: "paused_for_user_review",
      jobIds: ["job_visual"],
      currentJobId: "job_visual",
      submitApprovalId: null,
      visualCheckpointsEnabled: true,
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      completedAt: null,
      summary: "Apply copilot paused before final submit",
      detail: "Safe non-submitting apply paused for user review.",
      totalJobs: 1,
      pendingJobs: 1,
      submittedJobs: 0,
      skippedJobs: 0,
      blockedJobs: 0,
      failedJobs: 0,
    };
    const applyResult: ApplyJobResultSummary = {
      id: "apply_result_visual",
      runId: applyRun.id,
      jobId: "job_visual",
      applicationRecordId: selectedRecord.id,
      queuePosition: 0,
      state: "awaiting_review",
      summary: "Apply copilot paused before final submit",
      detail: "Safe non-submitting apply paused for user review.",
      startedAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      completedAt: null,
      blockerReason: null,
      blockerSummary: null,
      listingSignalEvidence: null,
      visualObservationSets: [],
      visualCheckpoints: [
        {
          id: "apply_visual_checkpoint_1",
          label: "Apply page visual checkpoint",
          purpose: "apply_checkpoint",
          snapshotId: visualEvidence.snapshotId,
          observationSetId: visualEvidence.observationSetId,
          summary: visualEvidence.summary,
          capturedAt: visualEvidence.capturedAt,
          retained: false,
          storagePath: null,
          blockers: [],
          fieldControls: ["Resume upload control is visible."],
          validationErrors: [],
          buttonStates: ["Final submit button appears disabled."],
          questionContextIds: [],
          reconciliations: [],
        },
      ],
      latestQuestionCount: 1,
      latestAnswerCount: 1,
      pendingConsentRequestCount: 0,
      artifactCount: 1,
      latestCheckpointId: "apply_checkpoint_visual",
      privacyReceipt: null,
    reviewCard: null,
    };
    const onGetApplyRunDetails = vi.fn(
      (): Promise<ApplyRunDetails> =>
        Promise.resolve({
          run: applyRun,
          result: applyResult,
          results: [applyResult],
          submitApproval: null,
          questionRecords: [
            {
              id: "apply_question_visual",
              runId: applyRun.id,
              jobId: "job_visual",
              applicationRecordId: selectedRecord.id,
              resultId: applyResult.id,
              prompt: "Upload resume",
              kind: "resume",
              answerControlType: "file",
              isRequired: true,
              detectedAt: "2026-03-20T10:04:10.000Z",
              answerOptions: [],
              suggestedAnswers: [],
              selectedAnswerId: null,
              submittedAnswer: "/tmp/resume.pdf",
              status: "submitted",
              pageUrl: "https://jobs.example.com/apply",
              visualContext: visualEvidence,
            },
          ],
          answerRecords: [],
          artifactRefs: [
            {
              id: "apply_artifact_visual",
              runId: applyRun.id,
              jobId: "job_visual",
              applicationRecordId: selectedRecord.id,
              resultId: applyResult.id,
              questionId: null,
              kind: "checkpoint",
              label: "Prepared application for final review",
              createdAt: "2026-03-20T10:04:30.000Z",
              storagePath: null,
              url: "https://jobs.example.com/apply",
              textSnippet: "Stopped before final submit.",
              visualEvidence,
            },
          ],
          checkpoints: [
            {
              id: "apply_checkpoint_visual",
              runId: applyRun.id,
              jobId: "job_visual",
              applicationRecordId: selectedRecord.id,
              resultId: applyResult.id,
              createdAt: "2026-03-20T10:04:30.000Z",
              label: "Prepared application for final review",
              detail: "Stopped before final submit.",
              url: "https://jobs.example.com/apply",
              jobState: "awaiting_review",
              artifactRefIds: ["apply_artifact_visual"],
              visualEvidence: [visualEvidence],
              visualReconciliations: [],
            },
          ],
          consentRequests: [],
  reviewCard: null,
        }),
    );

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          applicationAttempts={[]}
          applicationRecords={[selectedRecord]}
          applyRuns={[applyRun]}
          applyJobResults={[applyResult]}
          discoveryJobs={[]}
          isApplyPending={false}
          isApplyRequestPending={() => false}
          isApplyRunPending={() => false}
          onApproveApplyRun={vi.fn()}
          onCancelApplyRun={vi.fn()}
          onGetApplyRunDetails={onGetApplyRunDetails}
          onExportApplicationPacket={vi.fn()}
          onResolveApplyConsentRequest={vi.fn()}
          onSaveApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onClearApplicationAnswer={vi.fn(() =>
            Promise.reject(new Error("unused in this scenario")),
          )}
          onRevokeApplyRunApproval={vi.fn()}
          onSelectRecord={vi.fn()}
          onStartApplyCopilot={vi.fn()}
          onStartAutoApplyQueue={vi.fn()}
          selectedApplyRunId={null}
          selectedAttempt={null}
          selectedRecord={selectedRecord}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Screenshots of the form")).toBeTruthy();
    });
    expect(
      screen.getAllByText(
        /Visible resume upload and disabled final submit button/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Resume upload control is visible/i)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /prepare interview/i }),
    ).toBeNull();
  });

  it("shows persisted preparation stage timings for the selected attempt", () => {
    const selectedAttempt: ApplicationAttempt = {
      id: "attempt_timing",
      jobId: "job_timing",
      applicationRecordId: "application_timing",
      state: "paused",
      summary: "Application paused safely",
      detail: "Manual review is required.",
      startedAt: "2026-07-30T06:56:00.000Z",
      updatedAt: "2026-07-30T06:56:08.000Z",
      completedAt: "2026-07-30T06:56:08.000Z",
      outcome: null,
      checkpoints: [],
      questions: [],
      blocker: null,
      listingSignalEvidence: null,
      consentDecisions: [],
      replay: {
        sourceInstructionArtifactId: null,
        sourceDebugEvidenceRefIds: [],
        lastUrl: "https://jobs.example.com/apply",
        checkpointUrls: ["https://jobs.example.com/apply"],
      },
      visualEvidence: [],
      visualObservationSets: [],
      visualCheckpoints: [],
      nextActionLabel: "Review the conflicting fields manually",
      executionTimings: [
        {
          stage: "browser_preparation",
          startedAt: "2026-07-30T06:56:00.000Z",
          completedAt: "2026-07-30T06:56:02.000Z",
          durationMs: 2_000,
        },
        {
          stage: "form_preparation",
          startedAt: "2026-07-30T06:56:02.000Z",
          completedAt: "2026-07-30T06:56:08.000Z",
          durationMs: 6_000,
        },
        {
          stage: "total",
          startedAt: "2026-07-30T06:56:00.000Z",
          completedAt: "2026-07-30T06:56:08.000Z",
          durationMs: 8_000,
        },
      ],
    };

    render(
      <ApplicationsDetailPanelAttemptSection
        selectedAttempt={selectedAttempt}
      />,
    );

    expect(screen.getByText("Preparation timing")).toBeTruthy();
    expect(screen.getByText("Browser setup: 2s")).toBeTruthy();
    expect(screen.getByText("Form preparation: 6s")).toBeTruthy();
    expect(screen.getByText("Total: 8s")).toBeTruthy();
  });

  it("links to Outcomes from the header once an application was sent", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const sent = {
      ...createTrackedApplication({}),
      status: "submitted" as const,
    };
    const onOpenOutcomes = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          onOpenOutcomes={onOpenOutcomes}
          {...buildCrmScreenProps({
            applicationRecords: [sent],
            onSelectRecord: vi.fn(),
            selectedRecord: sent,
          })}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "See outcomes" }));
    expect(onOpenOutcomes).toHaveBeenCalledTimes(1);

    const notSent = { ...sent, status: "approved" as const };
    rerender(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          onOpenOutcomes={onOpenOutcomes}
          {...buildCrmScreenProps({
            applicationRecords: [notSent],
            onSelectRecord: vi.fn(),
            selectedRecord: notSent,
          })}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "See outcomes" })).toBeNull();
  });

  it("hides CRM tracking controls while search hides the selected application and restores them when the search clears", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const acme = createTrackedApplication({
      id: "application_acme",
      jobId: "job_acme",
      title: "Frontend Engineer",
      company: "Acme",
    });
    const beta = createTrackedApplication({});
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [acme, beta],
            onSelectRecord,
            selectedRecord: beta,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer · Beta")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "nothing-matches-this-search" } },
    );
    expect(
      await screen.findByText("No application selected in this view"),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export JSON" })).toBeNull();
    expect(onSelectRecord).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "" } },
    );
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer · Beta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeTruthy();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  it("hides CRM tracking controls when the lifecycle view has zero matches and restores them via Show all applications", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const tracked = createTrackedApplication({});
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord,
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), {
      target: { value: "offers" },
    });
    expect(
      await screen.findByText("No application selected in this view"),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(onSelectRecord).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Show all applications" }),
    );
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer · Beta")).toBeTruthy();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  it("keeps CRM tracking controls for a matching selection that sits on another pagination page", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const records = Array.from({ length: 120 }, (_, index) =>
      createTrackedApplication({
        id: `application_${index}`,
        jobId: `job_${index}`,
        title: `Backend Engineer ${index}`,
      }),
    );
    const selected = records[110]!;
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: records,
            onSelectRecord,
            selectedRecord: selected,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer 110 · Beta")).toBeTruthy();
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();

    expect(screen.getByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer 110 · Beta")).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 120 applications")).toBeTruthy();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  it("keeps the stage tracker off the primary Applications surface", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const tracked = createTrackedApplication({});
    const onWorkspaceViewChange = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          onWorkspaceViewChange={onWorkspaceViewChange}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord: vi.fn(),
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    // One list, one state per application: no peer Preparation/Stages tabs,
    // no view switcher, and no export controls beside a single record.
    for (const name of [
      "Preparation",
      "Stages",
      "Table",
      "Kanban",
      "Calendar",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export JSON" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved views" })).toBeNull();

    // The tracker is a named destination reached explicitly, and the route
    // owns the mode so it keeps a link.
    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(onWorkspaceViewChange).toHaveBeenCalledWith("crm");
    expect(screen.getByRole("heading", { name: "Tracker" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Back to Applications" }),
    ).toBeTruthy();
  });

  it("shows a truthful zero-record right pane in the Stages view without claiming a filtered selection", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          workspaceView="crm"
          {...buildCrmScreenProps({
            applicationRecords: [],
            onSelectRecord,
            selectedRecord: null,
          })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("No applications to track yet")).toBeTruthy();
    expect(
      screen.queryByText("No application selected in this view"),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  it("offers no filter recovery advice when tracking tools are unavailable", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const tracked = createTrackedApplication({});

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            includeTrackerControls: false,
            onSelectRecord: vi.fn(),
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(screen.getByText("Tracking tools unavailable")).toBeTruthy();
    expect(
      screen.queryByText(/Show all applications will bring it back/),
    ).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
  });

  it("restores the CRM editor synchronously across Preparation and Stages switches", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const tracked = createTrackedApplication({});
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord,
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Applications" }),
    );
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(screen.getByRole("combobox", { name: "Stage" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer · Beta")).toBeTruthy();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  it("marks exactly the two bounded preparation panes and keeps the workspace wrapper unmarked", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const tracked = createTrackedApplication({});

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord: vi.fn(),
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    // Preparation mode: the records list and the detail panel own scrolling;
    // the workspace grid itself never becomes a scroll region owner.
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-locked-pane-scroll-region]",
      ),
    );
    expect(regions).toHaveLength(2);
    expect(
      document
        .getElementById("applications-workspace-content")
        ?.hasAttribute("data-locked-pane-scroll-region"),
    ).toBe(false);
    expect(
      screen
        .getByRole("list", { name: "Applications" })
        .hasAttribute("data-locked-pane-scroll-region"),
    ).toBe(true);
    for (const region of regions) {
      expect(
        region.querySelectorAll("[data-locked-pane-scroll-region]"),
      ).toHaveLength(0);
    }

    // The list column stays pinned to the top of its column instead of riding
    // away with the detail scroll and leaving a dead half-screen behind it.
    const listPanel = screen
      .getByRole("list", { name: "Applications" })
      .closest("section");
    expect(listPanel?.className).toContain("xl:sticky");
    expect(listPanel?.className).toContain("xl:top-0");
    expect(listPanel?.className).toContain("xl:self-start");
    expect(listPanel?.className).not.toContain("xl:h-full");
  });

  it("reveals the stacked detail panel after selecting an application at compact width", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }),
    );
    const tracked = createTrackedApplication({});
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord,
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    const detail = document.getElementById("applications-detail-content");
    expect(detail).toBeTruthy();
    const scrollIntoView = vi.fn();
    Object.defineProperty(detail, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "View details for Backend Engineer at Beta",
      }),
    );

    expect(onSelectRecord).toHaveBeenCalledWith(tracked.id);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("marks the tracker table scroller plus the CRM detail wrapper in Stages mode without nesting markers", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const tracked = createTrackedApplication({});

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [tracked],
            onSelectRecord: vi.fn(),
            selectedRecord: tracked,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tracker" }));
    expect(await screen.findByRole("combobox", { name: "Stage" })).toBeTruthy();

    // Stages mode: the leaf table body and the screen-level CRM detail
    // wrapper are the only bounded scroll owners.
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-locked-pane-scroll-region]",
      ),
    );
    expect(regions).toHaveLength(2);
    expect(
      document
        .getElementById("applications-workspace-content")
        ?.hasAttribute("data-locked-pane-scroll-region"),
    ).toBe(false);
    expect(
      document
        .getElementById("application-tracker-heading")
        ?.closest("section")
        ?.hasAttribute("data-locked-pane-scroll-region"),
    ).toBe(false);

    const tableView = screen.getByRole("table", {
      name: "Application tracker",
    });
    const stageSelect = screen.getByRole("combobox", { name: "Stage" });
    const tableRegion = regions.find((region) => region.contains(tableView));
    const detailRegion = regions.find((region) => region.contains(stageSelect));
    expect(tableRegion).toBeTruthy();
    expect(detailRegion).toBeTruthy();
    expect(tableRegion).not.toBe(detailRegion);
    for (const region of regions) {
      expect(
        region.querySelectorAll("[data-locked-pane-scroll-region]"),
      ).toHaveLength(0);
    }

    // Search states that cannot overflow keep both sides unmarked, then the
    // owners return when the full view is restored.
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "nothing-matches-this-search" } },
    );
    expect(
      await screen.findByText("No application selected in this view"),
    ).toBeTruthy();
    expect(
      document.querySelectorAll("[data-locked-pane-scroll-region]"),
    ).toHaveLength(0);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "" } },
    );
    expect(
      await screen.findByRole("table", { name: "Application tracker" }),
    ).toBeTruthy();
    expect(
      document.querySelectorAll("[data-locked-pane-scroll-region]"),
    ).toHaveLength(2);
  });

  it("preserves a selected application hidden by the Preparation filter", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const submitted = createTrackedApplication({
      id: "application_submitted",
      jobId: "job_submitted",
      status: "submitted",
      title: "Staff Engineer",
    });
    const selected = createTrackedApplication({
      id: "application_selected",
      jobId: "job_selected",
      status: "drafting",
      title: "Product Manager",
    });
    const onSelectRecord = vi.fn();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [submitted, selected],
            onSelectRecord,
            selectedRecord: selected,
          })}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Submitted/ }));
    expect(onSelectRecord).not.toHaveBeenCalled();
    expect(
      screen.getByText("Selected application not shown by this filter"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(onSelectRecord).not.toHaveBeenCalled();
    expect(screen.getAllByText("Product Manager").length).toBeGreaterThan(0);
  });

  it("renders a route-owned refusal as a visible accessible status", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();

    render(
      <MemoryRouter>
        <ApplicationsScreen
          actionMessage="The requested Job Finder action failed."
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [],
            onSelectRecord: vi.fn(),
            selectedRecord: null,
          })}
        />
      </MemoryRouter>,
    );

    const status = screen.getByTestId("applications-route-action-status");
    // Refusals and errors arrive through the same route-scoped channel as
    // successes; the surface stays a polite status region either way.
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("The requested Job Finder action failed.");

    cleanup();
    render(
      <MemoryRouter>
        <ApplicationsScreen
          actionMessage="No jobs selected for auto-apply queue."
          dailyPreparationCapacity={null}
          {...buildCrmScreenProps({
            applicationRecords: [],
            onSelectRecord: vi.fn(),
            selectedRecord: null,
          })}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("applications-route-action-status").textContent,
    ).toBe("No jobs selected for auto-apply queue.");
  });

  it("never duplicates the static daily-capacity reached alert at the route level", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubCandidateAssetsBridge();
    const exhaustedCapacity = {
      limit: 20,
      used: 20,
      legacyUncertain: 0,
      remaining: 0,
      localDate: "2026-08-25",
      resetsAt: "2026-08-26T04:00:00.000Z",
    };

    render(
      <MemoryRouter>
        <ApplicationsScreen
          actionMessage={formatDailyPreparationCapacityReachedText(
            exhaustedCapacity,
          )}
          dailyPreparationCapacity={exhaustedCapacity}
          {...buildCrmScreenProps({
            applicationRecords: [],
            onSelectRecord: vi.fn(),
            selectedRecord: null,
          })}
        />
      </MemoryRouter>,
    );

    // The Recovery section's dedicated alert owns this exact sentence; the
    // route surface suppresses only that duplicate.
    expect(screen.queryByTestId("applications-route-action-status")).toBeNull();
  });
});

/**
 * The hand-off outcome is produced by the leaf recovery section and consumed
 * there to decide what the status beside the control claims. Every panel it
 * passes through has to declare the same return type: while these three
 * declared `=> void`, the outcome was still forwarded at runtime but the
 * declared contract said nothing came back, so the only thing stopping a
 * status-less hand-off was that nobody had written a void-returning handler
 * yet. These assertions read the reported outcome back out of each declared
 * prop type; against a `=> void` declaration each one is a type error.
 */
describe("browser hand-off outcome contract", () => {
  type ReportedOutcome<Handler> = Handler extends (
    ...args: never[]
  ) => infer Result
    ? Result
    : never;

  it("keeps the reported outcome in the declared type at every pass-through hop", () => {
    const screenOutcome: ReportedOutcome<
      NonNullable<
        ComponentProps<typeof ApplicationsScreen>["onFinishInBrowser"]
      >
    > = { kind: "opened_application_page" };
    const detailPanelOutcome: ReportedOutcome<
      NonNullable<
        ComponentProps<typeof ApplicationsDetailPanel>["onFinishInBrowser"]
      >
    > = { kind: "opened_browser_only" };
    const recoverySectionsOutcome: ReportedOutcome<
      NonNullable<
        ComponentProps<
          typeof ApplicationsDetailPanelRecoverySections
        >["onFinishInBrowser"]
      >
    > = { kind: "failed", reason: "The browser runtime is disabled" };

    expect(screenOutcome).toEqual({ kind: "opened_application_page" });
    expect(detailPanelOutcome).toEqual({ kind: "opened_browser_only" });
    expect(recoverySectionsOutcome).toEqual({
      kind: "failed",
      reason: "The browser runtime is disabled",
    });
  });
});
