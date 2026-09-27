// @vitest-environment jsdom

import type { JobFinderWorkspaceSnapshot } from "@unemployed/contracts";
import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { JobFinderShellActions } from "@renderer/features/job-finder/lib/job-finder-types";
import { useJobFinderPageController } from "./use-job-finder-page-controller";

type GenerateResume = (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;

function createReviewQueueItem(jobId: string) {
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
  };
}

function createBatchWorkspace(): JobFinderWorkspaceSnapshot {
  return {
    hydration: { phase: "complete", deferredCollections: [] },
    activeCampaignId: "campaign_1",
    campaigns: [{ id: "campaign_1", jobIds: ["job_1", "job_2", "job_3"] }],
    discoveryJobs: [],
    dismissedDiscoveryJobs: [],
    recentDiscoveryRuns: [],
    discoverySessions: [],
    sourceAccessPrompts: [],
    activeDiscoveryRun: null,
    reviewQueue: [
      createReviewQueueItem("job_1"),
      createReviewQueueItem("job_2"),
      createReviewQueueItem("job_3"),
    ],
    tailoredAssets: [],
    applicationRecords: [],
    applicationAttempts: [],
    applyRuns: [],
    applyJobResults: [],
    selectedDiscoveryJobId: null,
    selectedReviewJobId: null,
    selectedApplicationRecordId: null,
    selectedApplyRunId: null,
    settings: { appearanceTheme: "system" },
    profileSetupState: { status: "completed", reviewItems: [] },
    profileCopilotMessages: [],
  } as unknown as JobFinderWorkspaceSnapshot;
}

function createBatchHarness(options: { parkFirstCall?: boolean } = {}) {
  const parkFirstCall = options.parkFirstCall ?? true;
  const workspace = createBatchWorkspace();
  const activeResolvers: (() => void)[] = [];
  const parkedIds = new Set<string>();
  const generateResume = vi.fn<GenerateResume>((jobId: string) => {
    if (
      ["job_1", "job_2"].includes(jobId) &&
      !parkedIds.has(jobId) &&
      parkFirstCall
    ) {
      parkedIds.add(jobId);
      return new Promise<JobFinderWorkspaceSnapshot>((resolve) => {
        activeResolvers.push(() => resolve(workspace));
      });
    }
    return Promise.resolve(workspace);
  });

  Object.defineProperty(window, "unemployed", {
    configurable: true,
    value: {
      ping: vi.fn(() => Promise.resolve({ platform: "darwin" as const })),
      jobFinder: {
        getWorkspaceBootstrap: vi.fn(() => Promise.resolve(workspace)),
        generateResume,
      },
    } as unknown as Window["unemployed"],
  });

  return {
    generateResume,
    resolveParked: () => activeResolvers.forEach((resolve) => resolve()),
  };
}

async function flushTurns(turns = 6) {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

type JobFinderPageController = ReturnType<typeof useJobFinderPageController>;

// The data router constructs a real fetch Request for every navigation.
// jsdom's AbortSignal fails Node's brand check inside the Request constructor,
// so hand React Router a stub with the tiny request surface it reads (url,
// method, signal).
class NavigationRequestStub {
  method: string;
  signal: unknown;
  url: string;

  constructor(
    input: string | URL,
    init?: { method?: string; signal?: unknown },
  ) {
    this.url = String(input);
    this.method = (init?.method ?? "GET").toUpperCase();
    this.signal = init?.signal ?? null;
  }
}

beforeAll(() => {
  vi.stubGlobal("Request", NavigationRequestStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// The controller mounts a React Router blocker, so the harness must host it in
// a data router. A probe component publishes the live controller value so the
// assertions keep reading the latest render's result.
function mountController(strictMode: boolean) {
  const mounted: { current: JobFinderPageController | null } = {
    current: null,
  };

  function ControllerProbe() {
    mounted.current = useJobFinderPageController();
    return null;
  }

  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: strictMode ? (
          <StrictMode>
            <ControllerProbe />
          </StrictMode>
        ) : (
          <ControllerProbe />
        ),
      },
    ],
    { initialEntries: ["/job-finder/review-queue"] },
  );

  const view = render(<RouterProvider router={router} />);

  return {
    get current() {
      return mounted.current;
    },
    unmount: view.unmount,
  };
}

describe("useJobFinderPageController tailored-draft lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "unemployed");
  });

  it("lets a truly unmounted controller stop the batch tail after both active items settle", async () => {
    const harness = createBatchHarness();
    const first = mountController(false);
    await waitFor(() =>
      expect(first.current?.workspaceState.status).toBe("ready"),
    );
    const firstContext = first.current?.context;
    expect(firstContext).not.toBeNull();

    act(() => {
      firstContext?.onPrepareTailoredDrafts();
    });
    await waitFor(() =>
      expect(harness.generateResume).toHaveBeenCalledTimes(2),
    );

    // True teardown finishes both active jobs without starting the third.
    first.unmount();

    harness.resolveParked();
    await flushTurns();

    expect(harness.generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
    ]);

    // The released global guard lets a freshly mounted controller run again.
    const second = mountController(false);
    await waitFor(() =>
      expect(second.current?.workspaceState.status).toBe("ready"),
    );
    const secondContext = second.current?.context;
    expect(secondContext).not.toBeNull();

    act(() => {
      secondContext?.onPrepareTailoredDrafts();
    });
    await waitFor(() =>
      expect(second.current?.context?.tailoredDraftPreparation.status).toBe(
        "completed",
      ),
    );
    expect(harness.generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
      "job_1",
      "job_2",
      "job_3",
    ]);
  });

  it("keeps a mounted controller's batch runnable across StrictMode effect cycling", async () => {
    const harness = createBatchHarness({ parkFirstCall: false });
    const mountedController = mountController(true);
    await waitFor(() =>
      expect(mountedController.current?.workspaceState.status).toBe("ready"),
    );
    const context = mountedController.current?.context;
    expect(context).not.toBeNull();

    act(() => {
      context?.onPrepareTailoredDrafts();
    });
    await waitFor(() =>
      expect(
        mountedController.current?.context?.tailoredDraftPreparation.status,
      ).toBe("completed"),
    );

    // StrictMode's simulated unmount/remount reset the disposal signal, so
    // every eligible job still ran under the same live controller.
    expect(harness.generateResume.mock.calls.map(([jobId]) => jobId)).toEqual([
      "job_1",
      "job_2",
      "job_3",
    ]);
  });
});

describe("useJobFinderPageController cross-route status lifetime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "unemployed");
  });

  function mountStatusHarness(options: {
    initialEntry: string;
    mutateWorkspaceEntities?: (input: {
      baseRevision: number | null;
      mutation: { type: string; jobId: string };
    }) => Promise<{
      kind: "snapshot";
      currentRevision: number;
      snapshot: JobFinderWorkspaceSnapshot;
    }>;
    startApplyCopilotRun?: JobFinderShellActions["startApplyCopilotRun"];
  }) {
    const workspace = createBatchWorkspace();
    const mutateWorkspaceEntities = vi.fn(
      options.mutateWorkspaceEntities ??
        (() =>
          Promise.resolve({
            kind: "snapshot" as const,
            currentRevision: 1,
            snapshot: workspace,
          })),
    );
    Object.defineProperty(window, "unemployed", {
      configurable: true,
      value: {
        ping: vi.fn(() => Promise.resolve({ platform: "darwin" as const })),
        jobFinder: {
          getWorkspaceBootstrap: vi.fn(() => Promise.resolve(workspace)),
          mutateWorkspaceEntities,
          startApplyCopilotRun:
            options.startApplyCopilotRun ?? (() => Promise.resolve(workspace)),
        },
      } as unknown as Window["unemployed"],
    });

    const mounted: { current: JobFinderPageController | null } = {
      current: null,
    };

    function ControllerProbe() {
      mounted.current = useJobFinderPageController();
      return null;
    }

    const router = createMemoryRouter(
      [{ path: "*", element: <ControllerProbe /> }],
      { initialEntries: [options.initialEntry] },
    );

    const view = render(<RouterProvider router={router} />);

    return {
      get current() {
        return mounted.current;
      },
      mutateWorkspaceEntities,
      router,
      unmount: view.unmount,
    };
  }

  async function waitForReady(harness: ReturnType<typeof mountStatusHarness>) {
    await waitFor(() => {
      expect(harness.current?.workspaceState.status).toBe("ready");
      expect(harness.current?.context).not.toBeNull();
    });
  }

  it("keeps a completed status on its owning route and never leaks it to a sibling route", async () => {
    const harness = mountStatusHarness({
      initialEntry: "/job-finder/discovery",
    });
    await waitForReady(harness);

    // Awaiting inside act pins the tested lifecycle: the status write lands
    // before the shortlist promise resolves.
    await act(async () => {
      await harness.current?.context?.onQueueJob("job_discovery_1");
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toBe(
        "Job added to Shortlisted.",
      );
    });

    act(() => {
      harness.current?.context?.onNavigateSafely("/job-finder/applications");
    });
    await waitFor(() => {
      expect(harness.router.state.location.pathname).toBe(
        "/job-finder/applications",
      );
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toBeNull();
    });

    // The status stays attached to its owning route: coming back restores it
    // instead of a fresh unrelated route silently showing a stale status.
    act(() => {
      harness.current?.context?.onNavigateSafely("/job-finder/discovery");
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toBe(
        "Job added to Shortlisted.",
      );
    });
  });

  it("carries an action's completion status to the route it navigates to", async () => {
    const startApplyCopilotRun = vi
      .fn<JobFinderShellActions["startApplyCopilotRun"]>()
      .mockResolvedValue(createBatchWorkspace());
    const harness = mountStatusHarness({
      initialEntry: "/job-finder/review-queue",
      startApplyCopilotRun,
    });
    await waitForReady(harness);

    act(() => {
      harness.current?.context?.onApproveApply("job_review_approve");
    });
    await waitFor(() => {
      expect(harness.router.state.location.pathname).toBe(
        "/job-finder/applications",
      );
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toContain(
        "Applications updated",
      );
    });
  });

  it("keeps a status written after a sibling navigation on the route that owns it", async () => {
    let releaseQueue: () => void = () => undefined;
    let hasParked = false;
    const harness = mountStatusHarness({
      initialEntry: "/job-finder/discovery",
      mutateWorkspaceEntities: () =>
        new Promise((resolve) => {
          if (!hasParked) {
            releaseQueue = () => {
              hasParked = true;
              resolve({
                kind: "snapshot" as const,
                currentRevision: 1,
                snapshot: createBatchWorkspace(),
              });
            };
            return;
          }
          resolve({
            kind: "snapshot" as const,
            currentRevision: 1,
            snapshot: createBatchWorkspace(),
          });
        }),
    });
    await waitForReady(harness);

    act(() => {
      // Intentionally un-awaited: this first shortlist stays parked until
      // `releaseQueue` resolves it after the navigation below, which is the
      // exact late-completion lifecycle under test.
      void harness.current?.context?.onQueueJob("job_discovery_1");
    });
    await waitFor(() => {
      expect(harness.mutateWorkspaceEntities).toHaveBeenCalledTimes(1);
    });

    // The user leaves the discovery route while the action is still running.
    act(() => {
      harness.current?.context?.onNavigateSafely("/job-finder/applications");
    });
    await waitFor(() => {
      expect(harness.router.state.location.pathname).toBe(
        "/job-finder/applications",
      );
    });

    act(() => {
      releaseQueue();
    });
    await waitFor(() => {
      expect(hasParked).toBe(true);
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toBeNull();
    });

    // The late completion belongs to the discovery route, not to whatever
    // route the user was on when it landed.
    act(() => {
      harness.current?.context?.onNavigateSafely("/job-finder/discovery");
    });
    await waitFor(() => {
      expect(harness.current?.context?.actionState.message).toBe(
        "Job added to Shortlisted.",
      );
    });
  });
});
