// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  DiscoveryActivityEventSchema,
  DiscoveryRunRecordSchema,
  type JobSearchPreferences,
} from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DiscoveryHistoryModal,
  describeHistoryRun,
} from "./discovery-activity-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const targets = [
  {
    id: "greenhouse-source",
    label: "Greenhouse roles",
    enabled: true,
    adapterKind: "auto",
    startingUrl: "https://example.com/jobs",
  },
] as JobSearchPreferences["discovery"]["targets"];

const failedRun = DiscoveryRunRecordSchema.parse({
  id: "failed-run",
  state: "completed",
  scope: "run_all",
  startedAt: "2026-07-31T10:00:00.000Z",
  completedAt: "2026-07-31T10:00:04.000Z",
  targetIds: ["greenhouse-source"],
  targetExecutions: [
    {
      targetId: "greenhouse-source",
      adapterKind: "auto",
      state: "failed",
      startedAt: "2026-07-31T10:00:00.000Z",
      completedAt: "2026-07-31T10:00:04.000Z",
      warning: "Sign-in expired before the source could be read.",
      changeDigest: {
        new: 2,
        unchanged: 3,
        changed: 1,
        reactivated: 0,
        inactive: 1,
        known: 4,
        skipped: 2,
      },
      timing: { totalDurationMs: 4_000, longestGapMs: 0, eventCount: 0 },
    },
  ],
  summary: {
    targetsPlanned: 1,
    targetsCompleted: 1,
    validJobsFound: 2,
    outcome: "completed",
    changeDigest: {
      new: 2,
      unchanged: 3,
      changed: 1,
      reactivated: 0,
      inactive: 1,
      known: 4,
      skipped: 2,
    },
    sourceHealth: [
      {
        targetId: "greenhouse-source",
        health: "failed",
        durationMs: 4_000,
        warnings: ["Sign-in expired before the source could be read."],
      },
    ],
    warnings: ["Sign-in expired before the source could be read."],
  },
});

const liveEvent = DiscoveryActivityEventSchema.parse({
  id: "live-event-1",
  runId: "live-run",
  timestamp: "2026-07-31T10:00:01.000Z",
  kind: "progress",
  stage: "target",
  targetId: "greenhouse-source",
  message: "Reading Greenhouse roles.",
});

describe("DiscoveryHistoryModal", () => {
  it("shows the terminal source explanation instead of guessing why no jobs were collected", () => {
    const reason = "The careers page returned service unavailable. No vacancies could be read.";
    const run = DiscoveryRunRecordSchema.parse({
      ...failedRun,
      targetExecutions: failedRun.targetExecutions.map((execution) => ({
        ...execution, state: "completed", warning: null,
      })),
      activity: [
        { ...liveEvent, id: "finished", runId: failedRun.id, terminalState: "completed", message: reason },
        { ...liveEvent, id: "later-note", runId: failedRun.id, message: "Reading another page." },
      ],
      summary: {
        ...failedRun.summary,
        sourceHealth: [{ targetId: "greenhouse-source", health: "warning", durationMs: 4000, warnings: [] }],
        warnings: [],
      },
    });
    render(<DiscoveryHistoryModal activeRun={null} isDiscoveryPending={false}
      isTargetPending={() => false} liveEvents={[]} onClose={vi.fn()} open
      recentRuns={[run]} targets={targets} />);
    const sourceCard = screen.getByText(/^No jobs collected/u).closest("article");
    expect(sourceCard).not.toBeNull();
    expect(sourceCard!.parentElement!.className).not.toContain("max-h-60");
    expect(within(sourceCard!).getByText(reason)).toBeTruthy();
    expect(within(sourceCard!).queryByText("Reading another page.")).toBeNull();
  });

  it("counts distinct staged and persisted additions in source contributions", () => {
    const run = DiscoveryRunRecordSchema.parse({
      ...failedRun,
      targetExecutions: failedRun.targetExecutions.map((execution) => ({
        ...execution,
        state: "completed",
        warning: "Could not read this source",
        jobsPersisted: 1,
        jobsStaged: 2,
        jobsFound: 3,
      })),
      summary: {
        ...failedRun.summary,
        sourceHealth: [{
          targetId: "greenhouse-source",
          health: "healthy",
          durationMs: 4000,
          warnings: ["Could not read this source"],
        }],
        warnings: [],
      },
    });
    render(<DiscoveryHistoryModal activeRun={null} isDiscoveryPending={false}
      isTargetPending={() => false} liveEvents={[]} onClose={vi.fn()} open
      recentRuns={[run]} targets={targets} />);
    expect(screen.getByText("Contributed 3 new jobs to this run.")).toBeTruthy();
    expect(screen.getByText("By source: Greenhouse roles — 3 jobs.")).toBeTruthy();
    expect(
      screen.getByText("Could not read this source").closest("details"),
    ).not.toBeNull();
  });

  it("describes the dialog and exposes current activity as an additions-only log", () => {
    render(
      <DiscoveryHistoryModal
        activeRun={null}
        isDiscoveryPending={false}
        isTargetPending={() => false}
        liveEvents={[liveEvent]}
        onClose={vi.fn()}
        open
        recentRuns={[]}
        targets={targets}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Search history" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    const activityLog = screen.getByRole("log", {
      name: "Current search activity",
    });

    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? "")?.textContent).toContain(
      "Follow the current search here while new activity arrives.",
    );
    expect(activityLog.className).not.toContain("overflow-y-auto");
    expect(activityLog.getAttribute("aria-live")).toBe("polite");
    expect(activityLog.getAttribute("aria-relevant")).toBe("additions");
    expect(activityLog.getAttribute("aria-atomic")).toBe("false");
  });

  it("presents persisted changes and retries only the failed source", () => {
    const onRetrySource = vi.fn();

    render(
      <DiscoveryHistoryModal
        activeRun={null}
        isDiscoveryPending={false}
        isTargetPending={() => false}
        liveEvents={[]}
        onClose={vi.fn()}
        onRetrySource={onRetrySource}
        open
        recentRuns={[failedRun]}
        targets={targets}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Changes since earlier searches" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Source health" })).toBeTruthy();
    expect(screen.getByText("Greenhouse roles")).toBeTruthy();
    expect(
      screen.getByText("Sign-in expired before the source could be read."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Retry failed source Greenhouse roles",
      }),
    );

    expect(onRetrySource).toHaveBeenCalledTimes(1);
    expect(onRetrySource).toHaveBeenCalledWith("greenhouse-source");
  });

  it("disables retry while another all-source search is active", () => {
    render(
      <DiscoveryHistoryModal
        activeRun={null}
        isDiscoveryPending
        isTargetPending={() => false}
        liveEvents={[]}
        onClose={vi.fn()}
        onRetrySource={vi.fn()}
        open
        recentRuns={[failedRun]}
        targets={targets}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Retry failed source Greenhouse roles",
      }).disabled,
    ).toBe(true);
  });

  it("names a source's contribution and explains a second consecutive zero", () => {
    const zeroRun = DiscoveryRunRecordSchema.parse({
      ...failedRun,
      id: "zero-run-current",
      startedAt: "2026-08-02T10:00:00.000Z",
      completedAt: "2026-08-02T10:00:04.000Z",
      targetExecutions: failedRun.targetExecutions.map((execution) => ({
        ...execution,
        state: "completed",
        warning: null,
        jobsReviewed: 8,
        jobsPersisted: 0,
      })),
      summary: {
        ...failedRun.summary,
        sourceHealth: failedRun.summary.sourceHealth.map((source) => ({
          ...source,
          health: "healthy",
          warnings: [],
        })),
        warnings: [],
      },
    });
    const earlierZeroRun = DiscoveryRunRecordSchema.parse({
      ...zeroRun,
      id: "zero-run-earlier",
      startedAt: "2026-08-01T10:00:00.000Z",
      completedAt: "2026-08-01T10:00:04.000Z",
    });

    render(
      <DiscoveryHistoryModal
        activeRun={null}
        isDiscoveryPending={false}
        isTargetPending={() => false}
        liveEvents={[]}
        onClose={vi.fn()}
        open
        recentRuns={[zeroRun, earlierZeroRun]}
        targets={targets}
      />,
    );

    expect(
      screen.getByText("Contributed 0 new jobs to this run."),
    ).toBeTruthy();
    expect(screen.getByText(/^Finished( · .*)?$/u)).toBeTruthy();
    expect(
      screen.getByText("By source: Greenhouse roles — 0 jobs."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "No jobs matched this plan in either of its last two runs. Broaden the plan or try another source.",
      ),
    ).toBeTruthy();
  });

  it("does not call a quiet re-run of already saved jobs empty", () => {
    const knownOnly = (id: string, startedAt: string) =>
      DiscoveryRunRecordSchema.parse({
        ...failedRun,
        id,
        startedAt,
        completedAt: startedAt,
        targetExecutions: failedRun.targetExecutions.map((execution) => ({
          ...execution,
          state: "completed",
          warning: null,
          jobsReviewed: 10,
          jobsPersisted: 0,
          jobsSkippedByLedger: 10,
        })),
        summary: {
          ...failedRun.summary,
          sourceHealth: failedRun.summary.sourceHealth.map((source) => ({
            ...source,
            health: "healthy",
            warnings: [],
          })),
          warnings: [],
        },
      });

    render(
      <DiscoveryHistoryModal
        activeRun={null}
        isDiscoveryPending={false}
        isTargetPending={() => false}
        liveEvents={[]}
        onClose={vi.fn()}
        open
        recentRuns={[
          knownOnly("known-current", "2026-08-02T10:00:00.000Z"),
          knownOnly("known-earlier", "2026-08-01T10:00:00.000Z"),
        ]}
        targets={targets}
      />,
    );

    expect(
      screen.getByText(
        "Contributed 0 new jobs to this run; 0 duplicates merged · 10 seen before.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No jobs matched this plan/u)).toBeNull();
  });
});

it("keeps a live run's captured sources when Profile adds another source", () => {
  const activeRun = DiscoveryRunRecordSchema.parse({
    ...failedRun,
    id: "live-run",
    state: "running",
    completedAt: null,
    targetExecutions: failedRun.targetExecutions.map((execution) => ({
      ...execution,
      state: "running",
      completedAt: null,
    })),
    summary: { ...failedRun.summary, targetsCompleted: 0, outcome: "running" },
  });
  render(
    <DiscoveryHistoryModal
      activeRun={activeRun}
      isDiscoveryPending
      isTargetPending={() => false}
      liveEvents={[liveEvent]}
      onClose={vi.fn()}
      open
      recentRuns={[]}
      targets={[
        ...targets,
        { ...targets[0]!, id: "new-source", label: "Added later" },
      ]}
    />,
  );
  expect(screen.queryByText("Added later")).toBeNull();
  expect(screen.getAllByText(/0\/1 sources/).length).toBeGreaterThan(0);
});

it("leads with the notification sentence and keeps raw logs behind clean technical details", () => {
  const raw = "\u001b[31mTimeout 30000ms: locator.click failed\u001b[39m";
  const run = {
    ...failedRun,
    activity: [
      { ...liveEvent, runId: failedRun.id, message: raw },
      {
        ...liveEvent,
        id: "digest",
        runId: failedRun.id,
        message: "Digest v1_synthetic. I should inspect the page.",
      },
    ],
    summary: {
      ...failedRun.summary,
      sourceHealth: [
        { ...failedRun.summary.sourceHealth[0]!, warnings: [raw] },
      ],
    },
  };
  render(
    <DiscoveryHistoryModal
      open
      activeRun={null}
      isDiscoveryPending={false}
      isTargetPending={() => false}
      liveEvents={[]}
      onClose={vi.fn()}
      recentRuns={[run]}
      targets={targets}
    />,
  );
  expect(
    screen.getByText(describeHistoryRun(run)).closest("details"),
  ).toBeNull();
  for (const element of screen.getAllByText(
    "Timeout 30000ms: locator.click failed",
  )) {
    expect(element.closest("details")?.open).toBe(false);
  }
  expect(
    screen
      .getByText("Digest v1_synthetic. I should inspect the page.")
      .closest("details")?.open,
  ).toBe(false);
  expect(document.body.textContent).not.toContain("\u001b");
  expect(
    screen.getByText(/Could not read this source/).closest("details"),
  ).toBeNull();
});
