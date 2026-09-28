// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  SavedJobSchema,
  UserActionRequestSchema,
  type JobFinderWorkspaceSnapshot,
  type UserActionCommandInput,
  type UserActionRequest,
} from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COLLECTION_PAGE_SIZE } from "../../components/collection-pagination";
import { ActionsScreen, buildJobIndexById } from "./actions-screen";

const ACTION_COUNT = 210;
const APPLICATION_ACTION_COUNT = 130;
const JOB_COUNT = 1000;

// The exhaustive six-page walk over the full 210-action inbox is the heaviest
// jsdom render in this file and its wall time varies ~10x between fast laptops
// and loaded serial CI runners (measured ~0.9 s locally vs ~9.8 s on a loaded
// single-worker run before focusing queries). The per-test timeout only guards
// against true hangs; PAGING_WALK_BOUND_MS is the pagination regression guard.
const PAGING_WALK_TIMEOUT_MS = 15_000;
const PAGING_WALK_BOUND_MS = 10_000;
type DiscoveryJob = JobFinderWorkspaceSnapshot["discoveryJobs"][number];

function createJobs(): DiscoveryJob[] {
  return Array.from({ length: JOB_COUNT }, (_, index) => {
    const ordinal = index.toString().padStart(4, "0");

    return {
      ...SavedJobSchema.parse({
        id: `scale_job_${ordinal}`,
        source: "target_site",
        sourceJobId: `scale_source_${ordinal}`,
        canonicalUrl: `https://jobs.example.test/roles/${ordinal}`,
        applicationUrl: `https://jobs.example.test/roles/${ordinal}/apply`,
        title: `Scale Engineer ${ordinal}`,
        company: `Scale Company ${index % 50}`,
        location: index % 2 === 0 ? "Remote" : "Budapest, Hungary",
        workMode: index % 2 === 0 ? ["remote"] : ["hybrid"],
        applyPath: "external_redirect",
        easyApplyEligible: false,
        discoveredAt: "2026-07-30T10:00:00.000Z",
        salaryText: null,
        description: `Own product systems for role ${ordinal}.`,
        status: "discovered",
        matchAssessment: {
          score: 70 + (index % 30),
          reasons: ["Relevant product design experience"],
          gaps: [],
        },
      }),
      listingActivity: { status: "unknown" as const },
    };
  });
}

function createRequest(index: number): UserActionRequest {
  const ordinal = index.toString().padStart(4, "0");
  const isApplication = index < APPLICATION_ACTION_COUNT;

  const applicationScope = {
    type: "application" as const,
    runId: "run_scale",
    jobId: `scale_job_${ordinal}`,
    resultId: null,
    replayCheckpointId: null,
    source: "target_site" as const,
  };
  const discoveryScope = {
    type: "discovery_source" as const,
    targetId: `scale_target_${ordinal}`,
    source: "target_site" as const,
    sourceDebugRunId: null,
    sourceDebugAttemptId: null,
  };

  return UserActionRequestSchema.parse({
    id: `scale_action_${ordinal}`,
    dedupeKey: `scale_dedupe_${ordinal}`,
    revision: 1,
    kind: "login",
    state: "pending",
    scope: isApplication ? applicationScope : discoveryScope,
    verification: isApplication
      ? { type: "page_blocker_absent", blockerFingerprint: "blocker_1" }
      : {
          type: "source_access",
          targetId: `scale_target_${ordinal}`,
          blockerFingerprint: "blocker_1",
        },
    title: `Scale action ${ordinal}`,
    summary: "Use the Job Finder browser, then return here.",
    actionUrl: "https://jobs.example.com/login",
    displayOrigin: "https://jobs.example.com/",
    credentialsPolicy: "browser_only",
    submitAuthorized: false,
    accountCreationAuthorized: false,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T08:00:00.000Z",
    resolvedAt: null,
  });
}

// Parsed fixtures are immutable; build them once per file so the serial
// single-worker run does not re-parse 1,000+ zod objects for every test.
const SCALE_JOBS = createJobs();
const SCALE_REQUESTS = Array.from({ length: ACTION_COUNT }, (_, index) =>
  createRequest(index),
);

function renderScaleInbox(jobs: DiscoveryJob[] = SCALE_JOBS) {
  return render(
    <ActionsScreen
      discoveryJobs={jobs}
      isPending={() => false}
      onCommand={vi.fn<(command: UserActionCommandInput) => void>()}
      onNavigate={vi.fn()}
      requests={SCALE_REQUESTS}
    />,
  );
}

function getGroupSection(headingName: string): HTMLElement {
  const section = screen
    .getByRole("heading", { name: headingName })
    .closest("section");
  if (!section) {
    throw new Error(`Missing action group section for ${headingName}`);
  }
  return section;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ActionsScreen workspace scale", () => {
  it("indexes the job list by id in one pass", () => {
    const index = buildJobIndexById(SCALE_JOBS);

    expect(index.size).toBe(JOB_COUNT);
    expect(index.get("scale_job_0999")?.title).toBe("Scale Engineer 0999");
    expect(index.get("scale_job_missing")).toBeUndefined();
  });

  it("mounts one bounded page for 210 actions over 1,000 jobs with truthful counts", () => {
    // Spy on a shallow copy so the shared fixture cache stays pristine.
    const jobs = [...SCALE_JOBS];
    const findSpy = vi.spyOn(jobs, "find");
    const { container } = renderScaleInbox(jobs);

    expect(container.querySelectorAll("article")).toHaveLength(
      COLLECTION_PAGE_SIZE,
    );
    expect(screen.getByText(`${ACTION_COUNT} results`)).toBeTruthy();
    expect(
      screen.getByText(
        `Showing 1–${COLLECTION_PAGE_SIZE} of ${ACTION_COUNT} actions`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "actions pagination" }),
    ).toBeTruthy();
    // Group badges report totals across every matching action, not just the
    // mounted page window; each group also states how many of those land on
    // the mounted page, or that all of them sit on another page.
    expect(screen.getByText(String(APPLICATION_ACTION_COUNT))).toBeTruthy();
    expect(
      screen.getByText(String(ACTION_COUNT - APPLICATION_ACTION_COUNT)),
    ).toBeTruthy();
    expect(findSpy).not.toHaveBeenCalled();
  });

  it(
    "labels off-page group members explicitly instead of leaving an empty section",
    () => {
      const { container } = renderScaleInbox();

      // Page 1 mounts only the first 40 actions, and every one is an
      // application action, so the job-sources group must say where its cards
      // are instead of rendering a bare header above nothing.
      const applications = getGroupSection("Applications");
      const sources = getGroupSection("Job sources");
      expect(applications.querySelectorAll("article")).toHaveLength(
        COLLECTION_PAGE_SIZE,
      );
      expect(
        within(applications).getByText(
          `Showing ${COLLECTION_PAGE_SIZE} of ${APPLICATION_ACTION_COUNT} on this page.`,
        ),
      ).toBeTruthy();
      expect(sources.querySelectorAll("article")).toHaveLength(0);
      expect(
        within(sources).getByText(
          `All ${ACTION_COUNT - APPLICATION_ACTION_COUNT} on another page.`,
        ),
      ).toBeTruthy();

      // Paging keeps the per-group accounting truthful in both directions.
      for (let click = 0; click < 4; click += 1) {
        fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      }

      expect(screen.getByText("Showing 161–200 of 210 actions")).toBeTruthy();
      expect(applications.querySelectorAll("article")).toHaveLength(0);
      expect(
        within(applications).getByText(
          `All ${APPLICATION_ACTION_COUNT} on another page.`,
        ),
      ).toBeTruthy();
      expect(sources.querySelectorAll("article")).toHaveLength(
        COLLECTION_PAGE_SIZE,
      );
      expect(
        within(sources).getByText(
          `Showing ${COLLECTION_PAGE_SIZE} of ${
            ACTION_COUNT - APPLICATION_ACTION_COUNT
          } on this page.`,
        ),
      ).toBeTruthy();
      expect(container.querySelectorAll("article")).toHaveLength(
        COLLECTION_PAGE_SIZE,
      );
    },
    PAGING_WALK_TIMEOUT_MS,
  );

  it("keeps search complete across the whole collection without a find loop", async () => {
    const jobs = [...SCALE_JOBS];
    const findSpy = vi.spyOn(jobs, "find");
    renderScaleInbox(jobs);

    const input = screen.getByLabelText("Find an action");

    // A late discovery-source action beyond the first page stays reachable.
    fireEvent.change(input, { target: { value: "0195" } });
    await waitFor(() => {
      expect(screen.getAllByText("Scale action 0195")).toHaveLength(1);
    });
    expect(screen.getByText("1 of 210 results")).toBeTruthy();

    // A late application action resolves its job through the id index too.
    fireEvent.change(input, { target: { value: "0128" } });
    await waitFor(() => {
      expect(screen.getAllByText("Scale action 0128")).toHaveLength(1);
    });
    expect(
      screen.getByText(/Scale Engineer 0128 at Scale Company/),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => {
      expect(
        screen.getByText(
          `Showing 1–${COLLECTION_PAGE_SIZE} of ${ACTION_COUNT} actions`,
        ),
      ).toBeTruthy();
    });
    expect(findSpy).not.toHaveBeenCalled();
  });

  it(
    "pages through every action without losing any and bounds each page",
    () => {
      const { container } = renderScaleInbox();
      const seenTitles = new Set<string>();
      // Query the small pagination nav once; in-loop button reads stay scoped to
      // it so the six-page walk measures pagination work, not RTL document scans.
      const pagination = screen.getByRole("navigation", {
        name: "actions pagination",
      });
      const startedAt = performance.now();

      for (;;) {
        for (const heading of container.querySelectorAll("article h3")) {
          seenTitles.add(heading.textContent ?? "");
        }
        const nextButton = within(pagination).getByRole<HTMLButtonElement>(
          "button",
          { name: "Next page" },
        );
        if (nextButton.disabled) break;
        fireEvent.click(nextButton);
      }
      const elapsedMs = performance.now() - startedAt;

      expect(seenTitles.size).toBe(ACTION_COUNT);
      expect(seenTitles.has("Scale action 0000")).toBe(true);
      expect(
        seenTitles.has(
          `Scale action ${(ACTION_COUNT - 1).toString().padStart(4, "0")}`,
        ),
      ).toBe(true);
      expect(container.querySelectorAll("article").length).toBeLessThanOrEqual(
        COLLECTION_PAGE_SIZE,
      );
      expect(
        screen.getByText(
          `Showing 201–${ACTION_COUNT} of ${ACTION_COUNT} actions`,
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toHaveProperty("disabled", false);
      expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty(
        "disabled",
        true,
      );
      // Regression guard for pagination complexity: the walk must stay linear
      // in mounted cards. The bound sits far above the observed serial-run
      // range (~0.9–9.8 s across machines) but far below anything super-linear.
      expect(elapsedMs).toBeLessThan(PAGING_WALK_BOUND_MS);
    },
    PAGING_WALK_TIMEOUT_MS,
  );

  it("moves between pages with truthful windows and keeps commands intact", () => {
    const onCommand = vi.fn<(command: UserActionCommandInput) => void>();
    const { container } = render(
      <ActionsScreen
        discoveryJobs={SCALE_JOBS}
        isPending={() => false}
        onCommand={onCommand}
        onNavigate={vi.fn()}
        requests={SCALE_REQUESTS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Showing 41–80 of 210 actions")).toBeTruthy();
    expect(screen.queryByText("Scale action 0000")).toBeNull();
    expect(container.querySelectorAll("article")).toHaveLength(
      COLLECTION_PAGE_SIZE,
    );

    const card = screen.getByText("Scale action 0045").closest("article");
    expect(card).toBeTruthy();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", {
        name: "Cancel this step",
      }),
    );

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cancel",
        requestId: "scale_action_0045",
      }),
    );
  });
});
