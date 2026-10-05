import {
  clearUiResumeBatch,
  stopUiResumeBatch,
  syncUiResumeBatch,
} from "../../../main/services/assistant/ui-resume-batch";
import type { AssistantResumeBatchState } from "@nordri/contracts";
import { ApplicationCrmBulkStageMutationInputSchema } from "@nordri/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject, SetStateAction } from "react";
import type {
  ActionState,
  JobFinderShellActions,
} from "@renderer/features/job-finder/lib/job-finder-types";
import type { PendingActionState } from "./job-finder-pending-actions";
import { jobFinderPendingActions } from "./job-finder-pending-actions";
import { buildJobFinderPageContext } from "./use-job-finder-page-controller-context";
import type {
  JobFinderSetResumeClaimConfirmationInput,
  JobFinderWorkspaceSnapshot,
  ReviewQueueItem,
} from "@nordri/contracts";
import type { TailoredDraftPreparationViewState } from "@renderer/features/job-finder/screens/review-queue/review-queue-status";
import type { DiscoveryRunFeedback } from "@renderer/features/job-finder/screens/discovery/discovery-run-feedback";
import { buildJobFinderTaskCenterModel } from "@renderer/features/job-finder/components/task-center/job-finder-task-center-model";
import { createJobFinderSaveCoordinator } from "./job-finder-save-state";
import { runJobFinderApplicationBrowserHandoff } from "./job-finder-page-routes";
import { formatJobFinderBrowserHandoffFailedStatus } from "@renderer/features/job-finder/lib/job-finder-browser-handoff-copy";

beforeEach(() => {
  clearUiResumeBatch();
  vi.stubGlobal("window", {
    nordri: {
      assistant: {
        syncResumeBatch: (state: AssistantResumeBatchState) =>
          Promise.resolve(syncUiResumeBatch(state)),
      },
    },
  });
});
async function flushBatchDispatch() {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

function createIdleTailoredDraftPreparation(): TailoredDraftPreparationViewState {
  return {
    attemptedCount: 0,
    completedCount: 0,
    currentIndex: null,
    eligibleRemainingCount: 0,
    failedCount: 0,
    status: "idle",
    totalCount: 0,
  };
}

function buildContext(overrides: {
  actions: Partial<JobFinderShellActions>;
  workspace?: JobFinderWorkspaceSnapshot;
  tailoredDraftPreparationRunRef?: MutableRefObject<boolean>;
  tailoredDraftPreparationStopRequestedRef?: MutableRefObject<boolean>;
  tailoredDraftPreparationDisposedRef?: MutableRefObject<boolean>;
  latestWorkspaceRef?: MutableRefObject<JobFinderWorkspaceSnapshot | null>;
}) {
  let actionState: ActionState = { message: null };
  const actionMessages: (string | null)[] = [];
  let pendingActionState: PendingActionState = {};
  let tailoredDraftPreparation = createIdleTailoredDraftPreparation();
  let discoveryRunFeedback: DiscoveryRunFeedback | null = null;
  let tailoredDraftPreparationWriteCount = 0;
  const workspace =
    overrides.workspace ??
    ({ activeCampaignId: "campaign_active" } as JobFinderWorkspaceSnapshot);
  const setActionState = (next: SetStateAction<ActionState>) => {
    actionState = typeof next === "function" ? next(actionState) : next;
    actionMessages.push(actionState.message);
  };
  const setTailoredDraftPreparation = (
    next: SetStateAction<TailoredDraftPreparationViewState>,
  ) => {
    tailoredDraftPreparationWriteCount += 1;
    tailoredDraftPreparation =
      typeof next === "function" ? next(tailoredDraftPreparation) : next;
  };
  const setPendingActionState = (next: SetStateAction<PendingActionState>) => {
    pendingActionState =
      typeof next === "function" ? next(pendingActionState) : next;
  };
  const setDiscoveryRunFeedback = (
    next: SetStateAction<DiscoveryRunFeedback | null>,
  ) => {
    discoveryRunFeedback =
      typeof next === "function" ? next(discoveryRunFeedback) : next;
  };
  const saveCoordinator = createJobFinderSaveCoordinator({
    onStateChange: vi.fn(),
  });
  const context = buildJobFinderPageContext({
    actionState,
    actions: overrides.actions as JobFinderShellActions,
    activeRouteResumeAssistantMessages: [],
    activeRouteResumeAssistantPending: false,
    activeRouteResumeWorkspace: null,
    canImportResume: true,
    confirmLeaveDirtyResumeWorkspace: () => Promise.resolve(true),
    importResumeGuardMessage: null,
    isAnyPendingAction: () => false,
    isPendingAction: () => false,
    isCurrentResumeAssistantRequest: () => false,
    isCurrentResumeWorkspaceJob: () => false,
    liveDiscoveryEvents: [],
    latestWorkspaceRef: overrides.latestWorkspaceRef ?? { current: workspace },
    locationPathname: "/job-finder/home",
    navigate: vi.fn(),
    navigateSafely: vi.fn(),
    profileCopilotBusy: false,
    resumeImportProgress: null,
    profileCopilotPendingContextKey: null,
    profileCopilotRequestTokenRef: { current: 0 },
    requestApplyCopilotVisualCheckpoints: vi.fn(),
    profileSetupState: null,
    saveCoordinator,
    saveState: { state: "idle", version: 0 },
    refreshResumeWorkspace: () => Promise.resolve(false),
    resumeAssistantRequestTokenRef: { current: 0 },
    selectedApplicationAttempt: null,
    selectedApplicationRecord: null,
    selectedDiscoveryJob: null,
    selectedReviewItem: null,
    selectedReviewJob: null,
    selectedTailoredAsset: null,
    setPendingActionState,
    setActionState,
    setDiscoveryRunFeedback,
    setLiveDiscoveryEvents: vi.fn(),
    setOptimisticProfileCopilotMessages: vi.fn(),
    setProfileCopilotBusy: vi.fn(),
    setProfileCopilotPendingContextKey: vi.fn(),
    setProfileSurfaceDirty: vi.fn(),
    setSearchPlanSurfaceDirty: vi.fn(),
    setResumeAssistantMessages: vi.fn(),
    setResumeAssistantPending: vi.fn(),
    setResumeWorkspace: vi.fn(),
    clearResumeWorkspaceState: vi.fn(),
    setResumeWorkspaceDirty: vi.fn(),
    setSelectedApplicationRecordId: vi.fn(),
    setSelectedDiscoveryJobId: vi.fn(),
    setSelectedReviewJobId: vi.fn(),
    setTailoredDraftPreparation,
    sourceDebugRunIdRef: { current: 0 },
    tailoredDraftPreparation,
    tailoredDraftPreparationRunRef:
      overrides.tailoredDraftPreparationRunRef ?? { current: false },
    tailoredDraftPreparationStopRequestedRef:
      overrides.tailoredDraftPreparationStopRequestedRef ?? { current: false },
    tailoredDraftPreparationDisposedRef:
      overrides.tailoredDraftPreparationDisposedRef ?? { current: false },
    workspace,
  } as unknown as Parameters<typeof buildJobFinderPageContext>[0]);

  return {
    context,
    getActionState: () => actionState,
    getActionMessages: () => actionMessages,
    getPendingActionState: () => pendingActionState,
    getDiscoveryRunFeedback: () => discoveryRunFeedback,
    getTailoredDraftPreparation: () => tailoredDraftPreparation,
    getTailoredDraftPreparationWriteCount: () =>
      tailoredDraftPreparationWriteCount,
  };
}

describe("buildJobFinderPageContext campaign schedule and notifications", () => {
  it("exposes onRunCampaignNow through the page controller with a pending scope", async () => {
    const runCampaignNow = vi
      .fn<JobFinderShellActions["runCampaignNow"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getPendingActionState, getActionState } = buildContext({
      actions: { runCampaignNow },
    });

    const completed = await context.onRunCampaignNow("campaign_b");

    expect(runCampaignNow).toHaveBeenCalledWith("campaign_b");
    expect(completed).toBe(true);
    expect(getPendingActionState()).toEqual({});
    expect(getActionState().message).toMatch(/searches and reads listings/i);
    expect(getActionState().message).toMatch(
      /does not fill application forms/i,
    );
  });

  it("defaults run-now to the active campaign when no id is supplied", async () => {
    const runCampaignNow = vi
      .fn<JobFinderShellActions["runCampaignNow"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context } = buildContext({
      actions: { runCampaignNow },
      workspace: {
        activeCampaignId: "campaign_active",
      } as JobFinderWorkspaceSnapshot,
    });

    await context.onRunCampaignNow();

    expect(runCampaignNow).toHaveBeenCalledWith(undefined);
  });

  it("freezes campaign-run feedback from that plan's own completed ledger", async () => {
    const runCampaignNow = vi
      .fn<JobFinderShellActions["runCampaignNow"]>()
      .mockResolvedValue({
        recentDiscoveryRuns: [
          {
            id: "run_campaign_b",
            campaignId: "campaign_b",
            state: "completed",
            startedAt: "2026-09-12T10:00:00.000Z",
            summary: {
              report: {
                measuredAt: "2026-09-12T10:01:00.000Z",
                found: 5,
                new: 0,
                retained: 15,
                duplicates: 5,
                worthOpening: 5,
              },
            },
          },
        ],
      } as unknown as JobFinderWorkspaceSnapshot);
    const { context, getDiscoveryRunFeedback } = buildContext({
      actions: { runCampaignNow },
    });

    await context.onRunCampaignNow("campaign_b");

    expect(getDiscoveryRunFeedback()?.headline).toContain(
      "5 found · 0 new · 15 kept · 5 already here",
    );
  });

  it("keeps the campaign-run scope pending while the action runs", async () => {
    let resolveRun: () => void = () => undefined;
    const runCampaignNow = vi
      .fn<JobFinderShellActions["runCampaignNow"]>()
      .mockImplementation(
        () =>
          new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            resolveRun = () => resolve({} as JobFinderWorkspaceSnapshot);
          }),
      );
    const { context, getPendingActionState } = buildContext({
      actions: { runCampaignNow },
    });

    const actionPromise = context.onRunCampaignNow("campaign_b");
    expect(getPendingActionState()).toEqual({
      [jobFinderPendingActions.campaignRun("campaign_b")]: 1,
    });

    resolveRun();
    await actionPromise;
    expect(getPendingActionState()).toEqual({});
  });

  it("exposes mark-read and mark-all-read through the page controller", async () => {
    const markCampaignNotificationRead = vi
      .fn<JobFinderShellActions["markCampaignNotificationRead"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const markAllCampaignNotificationsRead = vi
      .fn<JobFinderShellActions["markAllCampaignNotificationsRead"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getActionState } = buildContext({
      actions: {
        markCampaignNotificationRead,
        markAllCampaignNotificationsRead,
      },
    });
    const pageContext = context;

    pageContext.onMarkCampaignNotificationRead("n_1");
    await vi.waitFor(() => {
      expect(markCampaignNotificationRead).toHaveBeenCalledWith("n_1");
    });

    pageContext.onMarkAllCampaignNotificationsRead();
    await vi.waitFor(() => {
      expect(markAllCampaignNotificationsRead).toHaveBeenCalledTimes(1);
      expect(getActionState().message).toMatch(/marked as read/i);
    });
  });
});

describe("buildJobFinderPageContext outcome recording and suggestions", () => {
  it("records a manual outcome through the shell action with a pending scope", async () => {
    const recordOutcome = vi
      .fn<JobFinderShellActions["recordOutcome"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getPendingActionState, getActionState } = buildContext({
      actions: { recordOutcome },
    });
    const pageContext = context;

    const completed = await pageContext.onRecordOutcome({
      jobId: "job_1",
      outcome: "interview",
      resumeStrategyId: null,
      note: "Recruiter call went well",
    });

    expect(recordOutcome).toHaveBeenCalledWith({
      jobId: "job_1",
      outcome: "interview",
      resumeStrategyId: null,
      note: "Recruiter call went well",
    });
    expect(completed).toBe(true);
    expect(getPendingActionState()).toEqual({});
    expect(getActionState().message).toMatch(/local tracking/i);
    expect(getActionState().message).not.toMatch(/nothing was submitted/i);
  });

  it("keeps the record-outcome scope pending while the action runs", async () => {
    let resolveRecord: () => void = () => undefined;
    const recordOutcome = vi
      .fn<JobFinderShellActions["recordOutcome"]>()
      .mockImplementation(
        () =>
          new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            resolveRecord = () => resolve({} as JobFinderWorkspaceSnapshot);
          }),
      );
    const { context, getPendingActionState } = buildContext({
      actions: { recordOutcome },
    });
    const actionPromise = context.onRecordOutcome({
      jobId: "job_1",
      outcome: "applied",
      resumeStrategyId: null,
      note: null,
    });

    expect(getPendingActionState()).toEqual({
      [jobFinderPendingActions.recordOutcome("job_1")]: 1,
    });

    resolveRecord();
    await actionPromise;
    expect(getPendingActionState()).toEqual({});
  });

  it("surfaces a failed outcome record as a thrown error for the form", async () => {
    const recordOutcome = vi
      .fn<JobFinderShellActions["recordOutcome"]>()
      .mockRejectedValue(new Error("That job is no longer available."));
    const { context } = buildContext({ actions: { recordOutcome } });
    const pageContext = context;

    await expect(
      pageContext.onRecordOutcome({
        jobId: "job_1",
        outcome: "offer",
        resumeStrategyId: null,
        note: null,
      }),
    ).rejects.toThrow("That job is no longer available.");
  });

  it("disables a suggestion through the shell action with a pending scope", async () => {
    const setOutcomeSuggestionEnabled = vi
      .fn<JobFinderShellActions["setOutcomeSuggestionEnabled"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getPendingActionState, getActionState } = buildContext({
      actions: { setOutcomeSuggestionEnabled },
    });
    const pageContext = context;

    const completed = await pageContext.onSetOutcomeSuggestionEnabled({
      dimension: "source",
      key: "example",
      enabled: false,
      reset: false,
    });

    expect(setOutcomeSuggestionEnabled).toHaveBeenCalledWith({
      dimension: "source",
      key: "example",
      enabled: false,
      reset: false,
    });
    expect(completed).toBe(true);
    expect(getPendingActionState()).toEqual({});
    expect(getActionState().message).toMatch(/stays off until you reset it/i);
  });

  it("resets a suggestion with the reset flag and re-evaluation message", async () => {
    const setOutcomeSuggestionEnabled = vi
      .fn<JobFinderShellActions["setOutcomeSuggestionEnabled"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getActionState } = buildContext({
      actions: { setOutcomeSuggestionEnabled },
    });
    const pageContext = context;

    const completed = await pageContext.onSetOutcomeSuggestionEnabled({
      dimension: "campaign",
      key: "campaign_1",
      enabled: true,
      reset: true,
    });

    expect(setOutcomeSuggestionEnabled).toHaveBeenCalledWith({
      dimension: "campaign",
      key: "campaign_1",
      enabled: true,
      reset: true,
    });
    expect(completed).toBe(true);
    expect(getActionState().message).toMatch(/re-evaluate it/i);
  });
});

function createReviewQueueItem(
  jobId: string,
  overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
  return {
    jobId,
    title: `Role ${jobId}`,
    company: "Acme",
    location: "Remote",
    matchScore: 80,
    applicationStatus: "shortlisted",
    assetStatus: "not_started",
    progressPercent: null,
    resumeAssetId: null,
    resumeApplicationMode: "tailored_per_job",
    resumeReview: { status: "not_started" },
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  } as ReviewQueueItem;
}

function createBatchWorkspace(
  reviewQueue: readonly ReviewQueueItem[],
): JobFinderWorkspaceSnapshot {
  return {
    activeCampaignId: "campaign_1",
    campaigns: [
      { id: "campaign_1", jobIds: reviewQueue.map((item) => item.jobId) },
    ],
    reviewQueue,
  } as unknown as JobFinderWorkspaceSnapshot;
}

describe("buildJobFinderPageContext tailored draft batch", () => {
  it("stops a UI-started queue through the assistant's main-process stop flag", async () => {
    const resolvers: (() => void)[] = [];
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            resolvers.push(() => resolve({} as JobFinderWorkspaceSnapshot)),
          ),
      );
    const run = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("one"),
        createReviewQueueItem("two"),
        createReviewQueueItem("three"),
        createReviewQueueItem("four"),
      ]),
    });
    run.context.onPrepareTailoredDrafts();
    await vi.waitFor(() => expect(generateResume).toHaveBeenCalledTimes(2));
    expect(stopUiResumeBatch()?.activeJobIds).toEqual(["one", "two"]);
    resolvers.forEach((resolve) => resolve());
    await vi.waitFor(() =>
      expect(run.getTailoredDraftPreparation().status).toBe("stopped"),
    );
    expect(generateResume.mock.calls.map(([id]) => id)).toEqual(["one", "two"]);
    expect(run.getTailoredDraftPreparation()).toMatchObject({
      completedCount: 2,
      failedCount: 0,
    });
  });

  it("limits generation and remaining counts to selected eligible jobs in the original campaign", async () => {
    let finish: (() => void) | undefined;
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({} as JobFinderWorkspaceSnapshot);
          }),
      );
    const workspace = createBatchWorkspace([
      createReviewQueueItem("one"),
      createReviewQueueItem("two"),
      createReviewQueueItem("ready", { assetStatus: "ready" }),
    ]);
    const latestWorkspaceRef = { current: workspace };
    const { context, getTailoredDraftPreparation } = buildContext({
      actions: { generateResume },
      workspace,
      latestWorkspaceRef,
    });
    context.onPrepareTailoredDrafts([
      "two",
      "two",
      "ready",
      "outside-campaign",
    ]);
    await flushBatchDispatch();
    expect(generateResume.mock.calls).toEqual([["two"]]);
    latestWorkspaceRef.current = {
      ...workspace,
      activeCampaignId: "other",
      campaigns: [
        ...workspace.campaigns,
        { ...workspace.campaigns[0]!, id: "other", jobIds: ["one"] },
      ],
    };
    finish?.();
    await vi.waitFor(() =>
      expect(getTailoredDraftPreparation().status).toBe("completed"),
    );
    expect(getTailoredDraftPreparation()).toMatchObject({
      totalCount: 1,
      completedCount: 1,
      eligibleRemainingCount: 0,
    });
    context.onPrepareTailoredDrafts([]);
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(1);
  });

  it("runs eligible jobs with bounded parallelism with quiet pending scopes and one final aggregate message", async () => {
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const {
      context,
      getActionMessages,
      getPendingActionState,
      getTailoredDraftPreparation,
    } = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
        createReviewQueueItem("job_3"),
      ]),
    });

    context.onPrepareTailoredDrafts();

    await vi.waitFor(() =>
      expect(getTailoredDraftPreparation().status).toBe("completed"),
    );

    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
      "job_3",
    ]);
    const batchMessages = getActionMessages().filter(
      (message) =>
        message !== null && /^(Wrote|Stopped after) \d+ resume/i.test(message),
    );
    expect(batchMessages).toHaveLength(1);
    expect(getTailoredDraftPreparation()).toMatchObject({
      attemptedCount: 3,
      completedCount: 3,
      failedCount: 0,
      status: "completed",
      totalCount: 3,
    });
    expect(getPendingActionState()).toEqual({});
    expect(batchMessages[0]).not.toMatch(/nothing was sent/i);
  });

  it("keeps per-job pending scopes active without touching review selection", async () => {
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation((jobId: string) => {
        if (jobId === "job_1") {
          return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            resolveFirst = () => resolve({} as JobFinderWorkspaceSnapshot);
          });
        }
        return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
          resolveSecond = () => resolve({} as JobFinderWorkspaceSnapshot);
        });
      });
    const {
      context,
      getActionState,
      getPendingActionState,
      getTailoredDraftPreparation,
    } = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
      ]),
    });

    context.onPrepareTailoredDrafts();
    await flushBatchDispatch();

    expect(generateResume).toHaveBeenCalledTimes(2);
    expect(getPendingActionState()).toEqual({
      [jobFinderPendingActions.resumeJob("job_1")]: 1,
      [jobFinderPendingActions.resumeJob("job_2")]: 1,
    });
    expect(getActionState().message).toBeNull();

    resolveFirst?.();
    await vi.waitFor(() =>
      expect(getPendingActionState()).toEqual({
        [jobFinderPendingActions.resumeJob("job_2")]: 1,
      }),
    );
    expect(getPendingActionState()).toEqual({
      [jobFinderPendingActions.resumeJob("job_2")]: 1,
    });
    expect(getActionState().message).toBeNull();

    resolveSecond?.();
    await vi.waitFor(() => expect(getPendingActionState()).toEqual({}));
    expect(getTailoredDraftPreparation().status).toBe("completed");
  });

  it("ignores a duplicate start while running, including after a context rebuild with the same controller refs", async () => {
    let resolveFirst: (() => void) | undefined;
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation((jobId: string) => {
        if (jobId === "job_1") {
          return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            resolveFirst = () => resolve({} as JobFinderWorkspaceSnapshot);
          });
        }
        return Promise.resolve({} as JobFinderWorkspaceSnapshot);
      });
    // The page controller owns these refs once and passes the same objects to
    // every context rebuild; a route change reuses them instead of resetting.
    const sharedRunRef = { current: false };
    const sharedStopRef = { current: false };
    const workspace = createBatchWorkspace([
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2"),
    ]);
    const first = buildContext({
      actions: { generateResume },
      workspace,
      tailoredDraftPreparationRunRef: sharedRunRef,
      tailoredDraftPreparationStopRequestedRef: sharedStopRef,
    });
    const rebuilt = buildContext({
      actions: { generateResume },
      workspace,
      tailoredDraftPreparationRunRef: sharedRunRef,
      tailoredDraftPreparationStopRequestedRef: sharedStopRef,
    });

    first.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    first.context.onPrepareTailoredDrafts();
    rebuilt.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    resolveFirst?.();
    await vi.waitFor(() => expect(sharedRunRef.current).toBe(false));

    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
    ]);
  });

  it("continues past a failed job and reports it in one aggregate message", async () => {
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation((jobId: string) =>
        jobId === "job_2"
          ? Promise.reject(new Error("generation failed"))
          : Promise.resolve({} as JobFinderWorkspaceSnapshot),
      );
    const { context, getActionMessages, getTailoredDraftPreparation } =
      buildContext({
        actions: { generateResume },
        workspace: createBatchWorkspace([
          createReviewQueueItem("job_1"),
          createReviewQueueItem("job_2"),
          createReviewQueueItem("job_3"),
        ]),
      });

    context.onPrepareTailoredDrafts();

    await vi.waitFor(() =>
      expect(getTailoredDraftPreparation().status).toBe("failed"),
    );

    expect(generateResume).toHaveBeenCalledTimes(3);
    expect(getTailoredDraftPreparation()).toMatchObject({
      attemptedCount: 3,
      completedCount: 2,
      failedCount: 1,
      totalCount: 3,
    });
    const batchMessage = getActionMessages().find(
      (message) =>
        message !== null && /^(Wrote|Stopped after) \d+ resume/i.test(message),
    );
    expect(batchMessage).toMatch(/Wrote 2 resumes/);
    expect(batchMessage).toMatch(/1 failed/);
    expect(batchMessage).toMatch(/run it again to retry the failed job/i);
  });

  it("finishes both active resumes after Stop and leaves the third unstarted", async () => {
    const activeResolvers: (() => void)[] = [];
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(() => {
        return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
          activeResolvers.push(() => resolve({} as JobFinderWorkspaceSnapshot));
        });
      });
    const { context, getActionMessages, getTailoredDraftPreparation } =
      buildContext({
        actions: { generateResume },
        workspace: createBatchWorkspace([
          createReviewQueueItem("job_1"),
          createReviewQueueItem("job_2"),
          createReviewQueueItem("job_3"),
        ]),
      });

    context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    context.onStopTailoredDraftPreparation();
    activeResolvers.forEach((resolve) => resolve());

    await vi.waitFor(() =>
      expect(getTailoredDraftPreparation().status).toBe("stopped"),
    );

    expect(generateResume).toHaveBeenCalledTimes(2);
    expect(getTailoredDraftPreparation()).toMatchObject({
      attemptedCount: 2,
      completedCount: 2,
      failedCount: 0,
      status: "stopped",
      totalCount: 3,
    });
    const batchMessage = getActionMessages().find(
      (message) => message !== null && /stopped after/i.test(message),
    );
    expect(batchMessage).toMatch(/Stopped after 2 resumes/);
  });

  it("accepts Stop from a remounted controller whose refs are fresh", async () => {
    const activeResolvers: (() => void)[] = [];
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(
        () =>
          new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            activeResolvers.push(() =>
              resolve({} as JobFinderWorkspaceSnapshot),
            );
          }),
      );
    const workspace = createBatchWorkspace([
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2"),
      createReviewQueueItem("job_3"),
    ]);
    const started = buildContext({ actions: { generateResume }, workspace });

    started.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    // A remount builds a controller with its own refs, all back to false. The
    // batch is still running on the module-level guard, so its Stop has to
    // reach it: testers saw preparation advance to "Writing resume 8 of 10"
    // forty-five seconds after pressing Stop.
    const remounted = buildContext({ actions: { generateResume }, workspace });
    remounted.context.onStopTailoredDraftPreparation();
    activeResolvers.forEach((resolve) => resolve());

    await vi.waitFor(() =>
      expect(started.getTailoredDraftPreparation().status).toBe("stopped"),
    );
    expect(generateResume).toHaveBeenCalledTimes(2);
  });

  it("keeps the batch alive across route changes: the task center tracks it away from Shortlisted and Stop from any route finishes only the active jobs", async () => {
    const activeResolvers: (() => void)[] = [];
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(() => {
        return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
          activeResolvers.push(() => resolve({} as JobFinderWorkspaceSnapshot));
        });
      });
    // Route changes rebuild the page context but reuse the controller's refs,
    // so the run, its progress state, and cooperative stop survive navigation.
    const sharedRunRef = { current: false };
    const sharedStopRef = { current: false };
    const sharedDisposedRef = { current: false };
    const workspace = createBatchWorkspace([
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2"),
      createReviewQueueItem("job_3"),
    ]);
    const reviewQueueRoute = buildContext({
      actions: { generateResume },
      workspace,
      tailoredDraftPreparationRunRef: sharedRunRef,
      tailoredDraftPreparationStopRequestedRef: sharedStopRef,
      tailoredDraftPreparationDisposedRef: sharedDisposedRef,
    });
    const discoveryRoute = buildContext({
      actions: { generateResume },
      workspace,
      tailoredDraftPreparationRunRef: sharedRunRef,
      tailoredDraftPreparationStopRequestedRef: sharedStopRef,
      tailoredDraftPreparationDisposedRef: sharedDisposedRef,
    });

    reviewQueueRoute.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    // Away from Shortlisted, the task center still reports the active batch
    // and routes its Stop control through the same controller refs.
    const taskModel = buildJobFinderTaskCenterModel({
      isDiscoveryPending: false,
      isResumeImportPending: false,
      tailoredDraftPreparation: reviewQueueRoute.getTailoredDraftPreparation(),
      workspace,
    });
    expect(taskModel.items.map((item) => item.kind)).toEqual([
      "tailored_drafts",
    ]);
    expect(taskModel.items[0]).toMatchObject({
      status: "active",
      countLabel: "0 of 3 prepared",
      canCancel: true,
      cancelKind: "tailored_drafts",
      resumeRoute: "/job-finder/review-queue",
    });

    discoveryRoute.context.onStopTailoredDraftPreparation();
    activeResolvers.forEach((resolve) => resolve());

    await vi.waitFor(() =>
      expect(reviewQueueRoute.getTailoredDraftPreparation().status).toBe(
        "stopped",
      ),
    );

    // Returning to Shortlisted shows accurate final state; no next item ran.
    expect(generateResume).toHaveBeenCalledTimes(2);
    expect(sharedRunRef.current).toBe(false);
    expect(sharedDisposedRef.current).toBe(false);
    expect(reviewQueueRoute.getTailoredDraftPreparation()).toMatchObject({
      attemptedCount: 2,
      completedCount: 2,
      currentIndex: null,
      status: "stopped",
      totalCount: 3,
    });
    const batchMessage = reviewQueueRoute
      .getActionMessages()
      .find((message) => message !== null && /stopped after/i.test(message));
    expect(batchMessage).toMatch(/Stopped after 2 resumes/);
    const settledTaskModel = buildJobFinderTaskCenterModel({
      isDiscoveryPending: false,
      isResumeImportPending: false,
      tailoredDraftPreparation: reviewQueueRoute.getTailoredDraftPreparation(),
      workspace,
    });
    expect(
      settledTaskModel.items.some((item) => item.kind === "tailored_drafts"),
    ).toBe(false);
  });

  it("reruns only still-eligible jobs from durable workspace state, keeping failed jobs retryable under the cap", async () => {
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const firstRun = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
        createReviewQueueItem("job_3"),
      ]),
    });

    firstRun.context.onPrepareTailoredDrafts();
    await vi.waitFor(() =>
      expect(firstRun.getTailoredDraftPreparation().status).toBe("completed"),
    );
    expect(generateResume).toHaveBeenCalledTimes(3);

    // Durable post-batch state: job_1/job_3 have ready artifacts, job_2's
    // generation failed and stays eligible, job_4 was shortlisted afterwards.
    const rerun = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1", { assetStatus: "ready" }),
        createReviewQueueItem("job_2", { assetStatus: "failed" }),
        createReviewQueueItem("job_3", { assetStatus: "ready" }),
        createReviewQueueItem("job_4"),
      ]),
    });

    rerun.context.onPrepareTailoredDrafts();
    await vi.waitFor(() =>
      expect(rerun.getTailoredDraftPreparation().status).toBe("completed"),
    );

    expect(generateResume).toHaveBeenCalledTimes(5);
    expect(generateResume.mock.calls.slice(3).map(([jobId]) => jobId)).toEqual([
      "job_2",
      "job_4",
    ]);
    expect(rerun.getTailoredDraftPreparation()).toMatchObject({
      completedCount: 2,
      failedCount: 0,
      status: "completed",
      totalCount: 2,
    });
  });

  it("queues all missing resumes in one run", async () => {
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getActionMessages, getTailoredDraftPreparation } =
      buildContext({
        actions: { generateResume },
        workspace: createBatchWorkspace(
          Array.from({ length: 12 }, (_, index) =>
            createReviewQueueItem(`job_${index}`),
          ),
        ),
      });

    context.onPrepareTailoredDrafts();

    await vi.waitFor(() =>
      expect(getTailoredDraftPreparation().status).toBe("completed"),
    );

    expect(generateResume).toHaveBeenCalledTimes(12);
    expect(getTailoredDraftPreparation()).toMatchObject({
      completedCount: 12,
      eligibleRemainingCount: 0,
      totalCount: 12,
    });
    const batchMessage = getActionMessages().find(
      (message) =>
        message !== null && /^(Wrote|Stopped after) \d+ resume/i.test(message),
    );
    expect(batchMessage).toMatch(/Wrote 12 resumes/);
    expect(batchMessage).not.toMatch(/more jobs still need a resume/);
  });

  it("treats a start with no eligible jobs as a deterministic no-op", async () => {
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockResolvedValue({} as JobFinderWorkspaceSnapshot);
    const { context, getActionMessages, getTailoredDraftPreparation } =
      buildContext({
        actions: { generateResume },
        workspace: createBatchWorkspace([
          createReviewQueueItem("job_ready", { assetStatus: "ready" }),
        ]),
      });

    context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    context.onStopTailoredDraftPreparation();

    expect(generateResume).not.toHaveBeenCalled();
    expect(getTailoredDraftPreparation().status).toBe("idle");
    expect(getActionMessages().filter((message) => message !== null)).toEqual(
      [],
    );
  });

  it("stops a disposed controller's batch tail after the active items settle without any further writes", async () => {
    const activeResolvers: (() => void)[] = [];
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation(
        () =>
          new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            activeResolvers.push(() =>
              resolve({} as JobFinderWorkspaceSnapshot),
            );
          }),
      );

    // The controller starts the batch and parks on job_1 and job_2; teardown of
    // the owning controller then marks it disposed mid-flight.
    const runRef = { current: false };
    const disposedRef = { current: false };
    const mounted = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
        createReviewQueueItem("job_3"),
      ]),
      tailoredDraftPreparationRunRef: runRef,
      tailoredDraftPreparationDisposedRef: disposedRef,
    });
    mounted.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);

    disposedRef.current = true;
    const messagesAtDisposal = mounted.getActionMessages().length;
    const writesAtDisposal = mounted.getTailoredDraftPreparationWriteCount();

    // Active jobs settle, then the loop must not schedule job_3, and the
    // orphaned run must stay silent instead of writing into dead state.
    activeResolvers.forEach((resolve) => resolve());
    await vi.waitFor(() => expect(runRef.current).toBe(false));

    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
    ]);
    expect(mounted.getActionMessages()).toHaveLength(messagesAtDisposal);
    expect(mounted.getTailoredDraftPreparationWriteCount()).toBe(
      writesAtDisposal,
    );
  });

  it("blocks a replacement-controller start while a disposed run is parked and releases the global guard once it stops", async () => {
    const parked: (() => void)[] = [];
    const resolveParked = () => parked.forEach((resolve) => resolve());
    let hasParkedFirstCall = false;
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation((jobId: string) => {
        if (["job_1", "job_2"].includes(jobId) && !hasParkedFirstCall) {
          return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            parked.push(() => {
              hasParkedFirstCall = true;
              resolve({} as JobFinderWorkspaceSnapshot);
            });
          });
        }
        return Promise.resolve({} as JobFinderWorkspaceSnapshot);
      });

    // First controller mount owns these refs; starting parks on job_1.
    const firstRunRef = { current: false };
    const firstStopRef = { current: false };
    const firstDisposedRef = { current: false };
    const mounted = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
        createReviewQueueItem("job_3"),
      ]),
      tailoredDraftPreparationRunRef: firstRunRef,
      tailoredDraftPreparationStopRequestedRef: firstStopRef,
      tailoredDraftPreparationDisposedRef: firstDisposedRef,
    });
    mounted.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);
    expect(firstRunRef.current).toBe(true);

    // True teardown disposes the owning controller; a later remount builds a
    // brand-new controller whose refs are fresh and cannot see the parked
    // run, so only the module-scope guard can prevent a second batch here.
    firstDisposedRef.current = true;
    const remountedRunRef = { current: false };
    const remountedStopRef = { current: false };
    const remountedDisposedRef = { current: false };
    const remounted = buildContext({
      actions: { generateResume },
      workspace: createBatchWorkspace([
        createReviewQueueItem("job_1"),
        createReviewQueueItem("job_2"),
        createReviewQueueItem("job_3"),
      ]),
      tailoredDraftPreparationRunRef: remountedRunRef,
      tailoredDraftPreparationStopRequestedRef: remountedStopRef,
      tailoredDraftPreparationDisposedRef: remountedDisposedRef,
    });

    remounted.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(generateResume).toHaveBeenCalledTimes(2);
    expect(remountedRunRef.current).toBe(false);
    expect(remounted.getTailoredDraftPreparation().status).toBe("idle");
    expect(
      remounted.getActionMessages().filter((message) => message !== null),
    ).toEqual([]);

    // Settling job_1 ends the disposed run without starting job_3.
    resolveParked?.();
    await vi.waitFor(() => expect(firstRunRef.current).toBe(false));
    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
    ]);

    // Guard released by the stopped orphan: the fresh controller runs again.
    remounted.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(remountedRunRef.current).toBe(true);
    await vi.waitFor(() =>
      expect(remounted.getTailoredDraftPreparation().status).toBe("completed"),
    );
    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
      "job_1",
      "job_2",
      "job_3",
    ]);
    expect(remountedRunRef.current).toBe(false);
  });

  it("recomputes the final eligible remainder from the latest workspace after jobs change while the run is parked", async () => {
    let resolveParked: (() => void) | undefined;
    const generateResume = vi
      .fn<JobFinderShellActions["generateResume"]>()
      .mockImplementation((jobId: string) => {
        if (jobId === "job_1") {
          return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
            resolveParked = () => resolve({} as JobFinderWorkspaceSnapshot);
          });
        }
        return Promise.resolve({} as JobFinderWorkspaceSnapshot);
      });

    const latestWorkspaceRef: MutableRefObject<JobFinderWorkspaceSnapshot | null> =
      { current: null };
    const startWorkspace = createBatchWorkspace([
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2"),
      createReviewQueueItem("job_3"),
    ]);
    latestWorkspaceRef.current = startWorkspace;

    const run = buildContext({
      actions: { generateResume },
      workspace: startWorkspace,
      latestWorkspaceRef,
    });

    run.context.onPrepareTailoredDrafts();
    await flushBatchDispatch();
    expect(run.getTailoredDraftPreparation()).toMatchObject({
      status: "running",
      eligibleRemainingCount: 0,
      totalCount: 3,
    });

    // Operator edits land while the run is parked: job_3 leaves the queue,
    // job_2 is switched to original resume, job_4 is shortlisted. A rerender
    // publishes the newer snapshot through the ref instead of mutating the
    // captured array.
    latestWorkspaceRef.current = createBatchWorkspace([
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2", {
        resumeApplicationMode: "original_resume",
      }),
      createReviewQueueItem("job_4"),
    ]);

    resolveParked?.();
    await vi.waitFor(() =>
      expect(run.getTailoredDraftPreparation().status).toBe("completed"),
    );

    expect(generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
      "job_3",
    ]);
    expect(run.getTailoredDraftPreparation()).toMatchObject({
      completedCount: 3,
      eligibleRemainingCount: 1,
      failedCount: 0,
      status: "completed",
      totalCount: 3,
    });
    const batchMessage = run
      .getActionMessages()
      .find(
        (message) =>
          message !== null &&
          /^(Wrote|Stopped after) \d+ resume/i.test(message),
      );
    expect(batchMessage).toMatch(/Wrote 3 resumes/);
    expect(batchMessage).not.toMatch(/more job still needs a resume/);
  });
});

describe("buildJobFinderPageContext scoped settings saves", () => {
  it("saves application tracker settings through updateTrackerCrm without a whole-settings merge", async () => {
    const snapshot = {} as JobFinderWorkspaceSnapshot;
    const saveSettings = vi.fn<JobFinderShellActions["saveSettings"]>();
    const updateTrackerCrm = vi
      .fn<JobFinderShellActions["updateTrackerCrm"]>()
      .mockResolvedValue(snapshot);
    const { context } = buildContext({
      actions: { saveSettings, updateTrackerCrm },
    });

    const completed = await context.onUpdateTrackerCrm({
      noResponseAutomation: { enabled: true, afterDays: 7 },
      customStages: [],
    });

    expect(completed).toBe(true);
    expect(updateTrackerCrm).toHaveBeenCalledOnce();
    expect(updateTrackerCrm).toHaveBeenCalledWith({
      noResponseAutomation: { enabled: true, afterDays: 7 },
      customStages: [],
    });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("marks tracker settings saves as failed when the scoped method fails", async () => {
    const failingUpdate = vi
      .fn<JobFinderShellActions["updateTrackerCrm"]>()
      .mockRejectedValue(new Error("commit refused"));
    const { context, getActionState } = buildContext({
      actions: { updateTrackerCrm: failingUpdate },
    });

    const completed = await context.onUpdateTrackerCrm({
      noResponseAutomation: { enabled: false, afterDays: 30 },
      customStages: [],
    });

    expect(completed).toBe(false);
    expect(getActionState().message).toBe("commit refused");
  });
});

describe("buildJobFinderPageContext resume claim confirmation passthrough", () => {
  it("exposes the fenced shell command unchanged for the Resume workspace", async () => {
    const snapshot = {} as JobFinderWorkspaceSnapshot;
    const setResumeClaimConfirmation = vi
      .fn<JobFinderShellActions["setResumeClaimConfirmation"]>()
      .mockResolvedValue(snapshot);
    const { context } = buildContext({
      actions: { setResumeClaimConfirmation },
    });

    const input: JobFinderSetResumeClaimConfirmationInput = {
      intent: "remove",
      jobId: "job_1",
      draftId: "resume_draft_job_1",
      expectedDraftUpdatedAt: "2026-08-26T10:00:00.000Z",
      confirmationId: "claim_confirmation_section_experience_abc",
    };
    const returned = await context.onSetResumeClaimConfirmation(input);

    expect(returned).toBe(snapshot);
    expect(setResumeClaimConfirmation).toHaveBeenCalledOnce();
    expect(setResumeClaimConfirmation).toHaveBeenCalledWith(input);
  });
});

describe("Applications browser hand-off failure reporting", () => {
  /**
   * The hand-off status is composed from what the REAL action wrapper hands
   * back, so these drive `buildJobFinderPageContext`'s own
   * `onPerformUserAction` / `onOpenBrowserSession` with a rejecting IPC double.
   * Calling the composer directly with a fabricated error would have passed
   * before the fix as well: the whole defect was that the wrapper reports its
   * failure as a bare `false` and the cause never reached the sentence.
   */
  const target = {
    jobId: "job_a",
    resultId: "result_a",
    runId: "run_a",
    applicationRecordId: "record_a",
    destinationUrl: "https://jobs.example.com/apply/1",
  };

  function pendingRequests() {
    return [
      {
        id: "request_a",
        revision: 3,
        state: "pending",
        scope: {
          type: "application",
          runId: "run_a",
          jobId: "job_a",
          applicationRecordId: "record_a",
        },
      },
    ] as unknown as JobFinderWorkspaceSnapshot["userActionRequests"];
  }

  it("carries the real cause into the failed status when the open-page command rejects", async () => {
    const performUserAction = vi
      .fn<JobFinderShellActions["performUserAction"]>()
      .mockRejectedValue(new Error("The browser runtime is disabled"));
    const { context } = buildContext({ actions: { performUserAction } });

    const outcome = await runJobFinderApplicationBrowserHandoff({
      onOpenBrowserSession: () =>
        context.onOpenBrowserSession(undefined, { rethrowError: true }),
      onPerformUserAction: (command) =>
        context.onPerformUserAction(command, { rethrowError: true }),
      requests: pendingRequests(),
      target,
    });

    expect(outcome).toEqual({
      kind: "failed",
      reason: "The browser runtime is disabled",
    });
    expect(performUserAction).toHaveBeenCalledTimes(1);

    const status = formatJobFinderBrowserHandoffFailedStatus(
      outcome.kind === "failed" ? outcome.reason : null,
    );

    expect(status).toBe(
      "The Job Finder browser did not open, so nothing was opened for this " +
        "application and nothing was sent to the employer. The browser runtime " +
        "is disabled. Try again, or open this step from Needs you.",
    );
  });

  it("reports a closed prepared page after the refreshed workspace exposes Try again", async () => {
    const performUserAction = vi
      .fn<JobFinderShellActions["performUserAction"]>()
      .mockResolvedValue({
        userActionRequests: [],
        applicationRecords: [
          {
            id: "record_a",
            lastAttemptState: "failed",
            lastActionLabel: "The prepared application page is no longer open.",
          },
        ],
      } as unknown as JobFinderWorkspaceSnapshot);
    const { context } = buildContext({
      actions: { performUserAction },
      workspace: {
        activeCampaignId: "campaign_active",
        userActionRequests: pendingRequests(),
      } as JobFinderWorkspaceSnapshot,
    });

    const outcome = await runJobFinderApplicationBrowserHandoff({
      onOpenBrowserSession: () =>
        context.onOpenBrowserSession(undefined, { rethrowError: true }),
      onPerformUserAction: (command) =>
        context.onPerformUserAction(command, { rethrowError: true }),
      requests: pendingRequests(),
      target,
    });

    expect(outcome).toEqual({
      kind: "failed",
      reason:
        "That prepared application page is no longer open. Choose Prepare again in Applications to rebuild it.",
    });
  });

  it("shows the application page expanded after opening it, not minimized", async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      ...globalThis.window,
      nordri: { browser: { command, getState: vi.fn() } },
    });
    try {
      const performUserAction = vi
        .fn<JobFinderShellActions["performUserAction"]>()
        .mockResolvedValue({
          userActionRequests: pendingRequests(),
          applicationRecords: [],
        } as unknown as JobFinderWorkspaceSnapshot);
      const { context } = buildContext({
        actions: { performUserAction },
        workspace: {
          activeCampaignId: "campaign_active",
          userActionRequests: pendingRequests(),
        } as JobFinderWorkspaceSnapshot,
      });

      await context.onPerformUserAction(
        {
          action: "open_page",
          requestId: "request_a",
          commandId: "open_a",
          expectedRevision: 3,
          credentialsPolicy: "browser_only",
          submitAuthorized: false,
          accountCreationAuthorized: false,
        },
        { rethrowError: true },
      );

      expect(command).toHaveBeenCalledWith({ type: "expand", expanded: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens a parked sign-in whose tab is gone through main, then shows it", async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const getState = vi.fn().mockResolvedValue({
      activeTabId: "tab_before_restart",
      tabs: [{ id: "tab_before_restart", url: "http://localhost/authboard/" }],
    });
    vi.stubGlobal("window", {
      ...globalThis.window,
      nordri: { browser: { command, getState } },
    });
    try {
      const requests = [
        {
          id: "request_sign_in",
          revision: 2,
          state: "pending",
          scope: {
            type: "discovery_source",
            discoveryRunId: "run_1",
            parkedTab: {
              tabId: "tab_before_restart",
              url: "http://localhost/authboard/",
              title: null,
            },
          },
        },
      ] as unknown as JobFinderWorkspaceSnapshot["userActionRequests"];
      const performUserAction = vi
        .fn<JobFinderShellActions["performUserAction"]>()
        .mockResolvedValue({
          userActionRequests: requests,
        } as unknown as JobFinderWorkspaceSnapshot);
      const { context } = buildContext({
        actions: { performUserAction },
        workspace: {
          activeCampaignId: "campaign_active",
          userActionRequests: requests,
        } as JobFinderWorkspaceSnapshot,
      });

      await context.onPerformUserAction(
        {
          action: "open_page",
          requestId: "request_sign_in",
          commandId: "open_sign_in",
          expectedRevision: 2,
          credentialsPolicy: "browser_only",
          submitAuthorized: false,
          accountCreationAuthorized: false,
        },
        { rethrowError: true },
      );

      // Main reopens the tab first (the renderer no longer refuses when the
      // tab is missing from its view), then it is selected and expanded.
      expect(performUserAction).toHaveBeenCalledOnce();
      expect(command).toHaveBeenCalledWith({
        type: "select_tab",
        tabId: "tab_before_restart",
      });
      expect(command).toHaveBeenCalledWith({ type: "expand", expanded: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("carries the real cause when only the window could be opened", async () => {
    const openBrowserSession = vi
      .fn<JobFinderShellActions["openBrowserSession"]>()
      .mockRejectedValue(new Error("No browser session could be started"));
    const { context } = buildContext({ actions: { openBrowserSession } });

    const outcome = await runJobFinderApplicationBrowserHandoff({
      onOpenBrowserSession: () =>
        context.onOpenBrowserSession(undefined, { rethrowError: true }),
      onPerformUserAction: (command) =>
        context.onPerformUserAction(command, { rethrowError: true }),
      requests:
        [] as unknown as JobFinderWorkspaceSnapshot["userActionRequests"],
      target,
    });

    expect(outcome).toEqual({
      kind: "failed",
      reason: "No browser session could be started",
    });
    expect(
      formatJobFinderBrowserHandoffFailedStatus(
        outcome.kind === "failed" ? outcome.reason : null,
      ),
    ).toContain("No browser session could be started.");
  });

  it("still reports the failure once at the route and leaves other callers resolving false", async () => {
    // The banner is unchanged, and a caller that does not ask for the cause
    // keeps the wrapper's own fire-and-forget contract.
    const performUserAction = vi
      .fn<JobFinderShellActions["performUserAction"]>()
      .mockRejectedValue(new Error("The browser runtime is disabled"));
    const { context, getActionState } = buildContext({
      actions: { performUserAction },
    });

    await expect(
      context.onPerformUserAction({
        requestId: "request_a",
        commandId: "command_a",
        expectedRevision: 3,
        action: "confirm_done",
        credentialsPolicy: "browser_only",
        submitAuthorized: false,
        accountCreationAuthorized: false,
      }),
    ).resolves.toBe(false);

    expect(getActionState().message).toContain(
      "The browser runtime is disabled",
    );
  });
});

it("does not count a removed in-flight job as a written resume", async () => {
  const generateResume = vi
    .fn<JobFinderShellActions["generateResume"]>()
    .mockResolvedValue(createBatchWorkspace([]));
  const { context, getTailoredDraftPreparation, getActionState } = buildContext(
    {
      actions: { generateResume },
      workspace: createBatchWorkspace([createReviewQueueItem("removed")]),
    },
  );
  context.onPrepareTailoredDrafts();
  await vi.waitFor(() =>
    expect(getTailoredDraftPreparation().status).toBe("completed"),
  );
  expect(getTailoredDraftPreparation().cancelledCount).toBe(1);
  expect(getActionState().message).toBe(
    "Wrote 0 resumes · 1 removed from the shortlist.",
  );
});

describe("tracker bulk notices and reset completion", () => {
  it.each(["stage", "tags", "archive"] as const)(
    "leaves %s success to the tracker toast",
    async (action) => {
      const mutateApplicationCrmBulkStage = vi
        .fn<JobFinderShellActions["mutateApplicationCrmBulkStage"]>()
        .mockResolvedValue({
          activeCampaignId: null,
        } as unknown as JobFinderWorkspaceSnapshot);
      const { context, getActionMessages } = buildContext({
        actions: { mutateApplicationCrmBulkStage },
      });
      const command = ApplicationCrmBulkStageMutationInputSchema.parse({
        action,
        stage: "reviewing",
        tags: ["Priority"],
        items: [
          { applicationRecordId: "synthetic_application", expectedRevision: 0 },
        ],
      });
      await context.onMutateApplicationCrmBulkStage(command);
      expect(mutateApplicationCrmBulkStage).toHaveBeenCalledWith(command);
      expect(getActionMessages().filter((message) => message !== null)).toEqual(
        [],
      );
    },
  );

  it("returns reset failure to the pending confirmation", async () => {
    const resetWorkspace = vi.fn(() =>
      Promise.reject(new Error("Your workspace was not deleted.")),
    );
    const { context } = buildContext({ actions: { resetWorkspace } });
    await expect(context.onResetWorkspace()).rejects.toThrow(
      "Your workspace was not deleted.",
    );
    expect(resetWorkspace).toHaveBeenCalledOnce();
  });
});
