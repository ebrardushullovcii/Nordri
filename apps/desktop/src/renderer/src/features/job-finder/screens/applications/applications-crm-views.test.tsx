// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApplicationRecordSchema } from "@nordri/contracts";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApplicationsCrmViews } from "./applications-crm-views";

const canonicalFieldTokens = [
  "border-(--field-border)",
  "bg-(--field)",
  "outline-none",
  "focus-visible:border-(--field-focus-border)",
  "focus-visible:bg-(--field-strong)",
  "focus-visible:shadow-[var(--field-focus-shadow)]",
];

function expectCanonicalFieldClasses(control: HTMLElement) {
  for (const token of canonicalFieldTokens) {
    expect(control.className).toContain(token);
  }
  expect(control.className).not.toContain("border-input");
  expect(control.className).not.toContain("bg-background");
  expect(control.className).not.toContain("ring-[3px]");
}

function record(
  id: string,
  title: string,
  company: string,
  overrides: Record<string, unknown> = {},
) {
  return ApplicationRecordSchema.parse({
    id,
    jobId: `job_${id}`,
    title,
    company,
    status: "approved",
    lastActionLabel: "Prepared",
    nextActionLabel: "Review",
    lastUpdatedAt: "2026-08-15T10:00:00.000Z",
    crm: {
      stage: "ready_for_approval",
      stageChangedAt: "2026-08-15T10:00:00.000Z",
      tags: company === "Acme" ? ["priority"] : [],
    },
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ApplicationsCrmViews", () => {
  test("searches locally without resetting the selected application", () => {
    const onSelectRecord = vi.fn();
    render(
      <ApplicationsCrmViews
        onSelectRecord={onSelectRecord}
        onViewChange={vi.fn()}
        records={[
          record("application_1", "Frontend Engineer", "Acme"),
          record("application_2", "Backend Engineer", "Beta"),
        ]}
        selectedRecordId="application_2"
        view="table"
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      {
        target: { value: "priority" },
      },
    );
    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
    expect(screen.queryByText("Backend Engineer")).toBeNull();
    expect(onSelectRecord).not.toHaveBeenCalled();
  });

  test("does not offer three ways to view a single row", () => {
    render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId={null}
        view="table"
      />,
    );

    expect(screen.queryByTestId("applications-crm-view-switcher")).toBeNull();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Calendar" })).toBeNull();
    // The record itself is still fully present and editable.
    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
  });

  test("offers table, Kanban, calendar, columns, saved views, and a sticky bulk action", async () => {
    const onBulkStageChange = vi.fn(() => Promise.resolve());
    render(
      <ApplicationsCrmViews
        onBulkStageChange={onBulkStageChange}
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[
          record("application_1", "Frontend Engineer", "Acme"),
          record("application_2", "Backend Engineer", "Globex"),
        ]}
        selectedRecordId={null}
        view="table"
      />,
    );

    expect(screen.getByRole("button", { name: "List" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByText("Columns")).toBeTruthy();
    expect(screen.getByText("Saved views")).toBeTruthy();
    expect(
      screen.getByText(/one you recorded or one Job Finder worked out/i),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select Frontend Engineer at Acme",
      }),
    );
    expect(screen.getByText("1 matching application selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move to Reviewing" }));
    await waitFor(() =>
      expect(onBulkStageChange).toHaveBeenCalledWith(
        ["application_1"],
        "reviewing",
      ),
    );
  });

  test("shows explicit and inferred Applied stages with distinct local provenance", () => {
    render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[
          record("legacy", "Legacy Engineer", "Archive Co", {
            status: "submitted",
            crm: null,
          }),
          record("explicit", "Current Engineer", "Tracked Co", {
            status: "submitted",
            crm: {
              stage: "applied",
              stageChangedAt: "2026-08-15T10:00:00.000Z",
            },
          }),
        ]}
        selectedRecordId={null}
        view="table"
      />,
    );

    // Both rows say "Applied"; provenance is the badge, not a suffix on the
    // stage name.
    expect(screen.getAllByText("Applied")).toHaveLength(2);
    expect(screen.queryByText(/historical inference/i)).toBeNull();
    expect(screen.queryByText(/user recorded/i)).toBeNull();
    expect(
      screen.queryByText(/receipt|submission proof|externally verified/i),
    ).toBeNull();
  });

  test("bounds the table DOM and names matching select-all semantics", () => {
    const records = Array.from({ length: 226 }, (_, index) =>
      record(`application_${index}`, `Frontend Engineer ${index}`, "Acme"),
    );

    render(
      <ApplicationsCrmViews
        onBulkStageChange={vi.fn(() => Promise.resolve())}
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={records}
        selectedRecordId={null}
        view="table"
      />,
    );

    expect(
      screen.getByRole("table", { name: "Application tracker" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(
      screen.getByRole("navigation", { name: "applications pagination" }),
    ).toBeTruthy();
    expect(screen.getByText("Showing 1–50 of 226 applications")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Frontend Engineer 50")).toBeTruthy();
    expect(screen.queryByText("Frontend Engineer 0")).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all matching applications",
      }),
    );
    expect(screen.getByText("226 matching applications selected")).toBeTruthy();
  });

  test("reports the full filtered record-id set, including records on later pages", async () => {
    const onVisibleRecordIdsChange =
      vi.fn<(recordIds: readonly string[]) => void>();
    const records = Array.from({ length: 120 }, (_, index) =>
      record(
        `application_${index}`,
        index % 2 === 0 ? "Frontend Engineer" : "Backend Engineer",
        "Acme",
      ),
    );

    render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        onVisibleRecordIdsChange={onVisibleRecordIdsChange}
        records={records}
        selectedRecordId="application_119"
        view="table"
      />,
    );

    await waitFor(() => expect(onVisibleRecordIdsChange).toHaveBeenCalled());
    const initialReport = onVisibleRecordIdsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(initialReport).toHaveLength(120);
    expect(initialReport).toContain("application_119");
    expect(
      screen.getByText("Showing 101–120 of 120 applications"),
    ).toBeTruthy();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "Backend" } },
    );
    await waitFor(() =>
      expect(onVisibleRecordIdsChange.mock.calls.at(-1)?.[0]).toHaveLength(60),
    );
    const narrowedReport =
      onVisibleRecordIdsChange.mock.calls.at(-1)?.[0] ?? [];
    expect(narrowedReport).toContain("application_119");
    expect(narrowedReport).not.toContain("application_0");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search applications" }),
      { target: { value: "no-such-application-exists" } },
    );
    await waitFor(() =>
      expect(onVisibleRecordIdsChange.mock.calls.at(-1)?.[0]).toEqual([]),
    );
  });

  test("re-reports visible ids when the tracker remounts with identical records", async () => {
    const onVisibleRecordIdsChange =
      vi.fn<(recordIds: readonly string[]) => void>();
    const records = [record("application_1", "Frontend Engineer", "Acme")];
    const renderTracker = () =>
      render(
        <ApplicationsCrmViews
          onSelectRecord={vi.fn()}
          onViewChange={vi.fn()}
          onVisibleRecordIdsChange={onVisibleRecordIdsChange}
          records={records}
          selectedRecordId="application_1"
          view="table"
        />,
      );

    const firstMount = renderTracker();
    await waitFor(() =>
      expect(onVisibleRecordIdsChange).toHaveBeenCalledTimes(1),
    );
    firstMount.unmount();

    renderTracker();
    await waitFor(() =>
      expect(onVisibleRecordIdsChange).toHaveBeenCalledTimes(2),
    );
    expect(onVisibleRecordIdsChange.mock.calls[1]?.[0]).toEqual([
      "application_1",
    ]);
  });

  test("keeps a single report while the parent re-renders with fresh callback identities", async () => {
    const reports: Array<readonly string[]> = [];

    function ChurnHarness() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button onClick={() => setTick((tick) => tick + 1)} type="button">
            Rerender tracker host
          </button>
          <ApplicationsCrmViews
            onSelectRecord={vi.fn()}
            onViewChange={vi.fn()}
            onVisibleRecordIdsChange={(recordIds) => {
              reports.push([...recordIds]);
            }}
            records={[record("application_1", "Frontend Engineer", "Acme")]}
            selectedRecordId="application_1"
            view="table"
          />
        </div>
      );
    }

    render(<ChurnHarness />);
    await waitFor(() => expect(reports).toHaveLength(1));
    fireEvent.click(
      screen.getByRole("button", { name: "Rerender tracker host" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rerender tracker host" }),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(["application_1"]);
  });

  test("round-trips collision-prone record ids losslessly in order", async () => {
    const onVisibleRecordIdsChange =
      vi.fn<(recordIds: readonly string[]) => void>();
    const exoticIds = [
      "plain",
      '["application_1","application_2"]',
      "joined\u0000ids",
      "comma,separated",
    ];
    const records = exoticIds.map((id) =>
      record(id, "Frontend Engineer", "Acme"),
    );

    render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        onVisibleRecordIdsChange={onVisibleRecordIdsChange}
        records={records}
        selectedRecordId="plain"
        view="table"
      />,
    );

    await waitFor(() => expect(onVisibleRecordIdsChange).toHaveBeenCalled());
    expect(onVisibleRecordIdsChange.mock.calls.at(-1)?.[0]).toEqual(exoticIds);
  });

  test("names each tracker subview in its own empty state", () => {
    const renderView = (view: "table" | "kanban" | "calendar") => {
      cleanup();
      render(
        <ApplicationsCrmViews
          onSelectRecord={vi.fn()}
          onViewChange={vi.fn()}
          records={[]}
          selectedRecordId={null}
          view={view}
        />,
      );
    };

    renderView("table");
    expect(screen.getByText("No applications yet")).toBeTruthy();
    expect(screen.getByText(/tracker table/)).toBeTruthy();

    renderView("kanban");
    expect(screen.getByText("No applications on your board yet")).toBeTruthy();
    expect(screen.getByText(/grouped by hiring stage/)).toBeTruthy();

    renderView("calendar");
    expect(screen.getByText("Nothing scheduled yet")).toBeTruthy();
    expect(screen.getByText(/application calendar/)).toBeTruthy();
  });

  test("keeps a failed bulk update selected for an explicit retry", async () => {
    let resolveRetry: (() => void) | undefined;
    const onBulkStageChange = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("internal revision mismatch"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRetry = resolve;
          }),
      );
    render(
      <ApplicationsCrmViews
        onBulkStageChange={onBulkStageChange}
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId={null}
        view="table"
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select Frontend Engineer at Acme",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to Reviewing" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The selected applications could not be updated. Keep them selected and try again.",
    );
    expect(screen.queryByText(/internal revision mismatch/i)).toBeNull();
    expect(screen.getByText("1 matching application selected")).toBeTruthy();
    expect(onBulkStageChange).toHaveBeenCalledTimes(1);

    const retryButton = screen.getByRole("button", {
      name: "Move to Reviewing",
    });
    fireEvent.click(retryButton);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retryButton);
    expect(onBulkStageChange).toHaveBeenCalledTimes(2);
    expect(onBulkStageChange).toHaveBeenNthCalledWith(
      2,
      ["application_1"],
      "reviewing",
    );

    resolveRetry?.();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText(/matching application selected/)).toBeNull();
    expect(onBulkStageChange).toHaveBeenCalledTimes(2);
  });

  test("clears a bulk failure when the relevant selection resets", async () => {
    render(
      <ApplicationsCrmViews
        onBulkStageChange={vi.fn(() => Promise.reject(new Error("stale")))}
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId={null}
        view="table"
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Frontend Engineer at Acme",
    });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Move to Reviewing" }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  test("styles the lifecycle view select with the canonical field recipe", () => {
    render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId={null}
        view="table"
      />,
    );

    const lifecycleSelect = screen.getByLabelText("Show");
    expect(lifecycleSelect.className).toContain("h-9");
    expectCanonicalFieldClasses(lifecycleSelect);
  });
});

describe("ApplicationsCrmViews locked pane scroll regions", () => {
  function expectSingleLeafScrollRegion(scope: ParentNode): HTMLElement {
    const regions = Array.from(
      scope.querySelectorAll<HTMLElement>("[data-locked-pane-scroll-region]"),
    );
    expect(regions).toHaveLength(1);
    const region = regions[0]!;
    // A marked pane owns scrolling without nesting another marker.
    expect(
      region.querySelectorAll("[data-locked-pane-scroll-region]"),
    ).toHaveLength(0);
    return region;
  }

  test("marks only the bounded table scroller in the table view", () => {
    const { container } = render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[
          record("application_1", "Frontend Engineer", "Acme"),
          record("application_2", "Backend Engineer", "Beta"),
        ]}
        selectedRecordId="application_1"
        view="table"
      />,
    );

    const region = expectSingleLeafScrollRegion(container);
    expect(region.className).toContain("flex-1 overflow-auto");
    expect(
      region.querySelector(
        'table[aria-labelledby="application-tracker-heading"]',
      ),
    ).toBeTruthy();
    // The tracker shell clips layout but never scrolls, so it stays unmarked.
    expect(
      document
        .getElementById("application-tracker-heading")
        ?.closest("section")
        ?.hasAttribute("data-locked-pane-scroll-region"),
    ).toBe(false);
  });

  test("marks only the bounded board scroller in the Kanban view", () => {
    const { container } = render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId="application_1"
        view="kanban"
      />,
    );

    const region = expectSingleLeafScrollRegion(container);
    expect(region.className).toContain("overflow-x-hidden");
    expect(region.className).toContain("overflow-y-auto");
    expect(screen.getByText("Frontend Engineer")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Discovered" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Show empty stages/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show empty stages/ }));
    expect(screen.getByRole("list", { name: "Empty stages" })).toBeTruthy();
    expect(screen.getByText("Discovered")).toBeTruthy();
    const stageColumn = screen
      .getByText("Frontend Engineer")
      .closest("section");
    expect(stageColumn).toBeTruthy();
    expect(stageColumn?.className).not.toContain("overflow-y-auto");
    expect(stageColumn?.hasAttribute("data-locked-pane-scroll-region")).toBe(
      false,
    );
  });

  test("marks only the bounded calendar scroller in the calendar view", () => {
    const { container } = render(
      <ApplicationsCrmViews
        onSelectRecord={vi.fn()}
        onViewChange={vi.fn()}
        records={[record("application_1", "Frontend Engineer", "Acme")]}
        selectedRecordId="application_1"
        view="calendar"
      />,
    );

    const region = expectSingleLeafScrollRegion(container);
    // The pane also clips sideways now: Windows draws both scrollbar tracks,
    // so a wide row put a horizontal bar inside an already vertical scroller.
    expect(region.className).toContain(
      "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
    );
    expect(screen.getByText(/Nothing scheduled/)).toBeTruthy();
  });

  test("leaves every tracker empty state unmarked", () => {
    for (const view of ["table", "kanban", "calendar"] as const) {
      const { container } = render(
        <ApplicationsCrmViews
          onSelectRecord={vi.fn()}
          onViewChange={vi.fn()}
          records={[]}
          selectedRecordId={null}
          view={view}
        />,
      );

      expect(
        container.querySelectorAll("[data-locked-pane-scroll-region]"),
      ).toHaveLength(0);
      cleanup();
    }
  });
});
