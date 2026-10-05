// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PageStatusLine,
  sortPageStatusItems,
  type PageStatusItem,
} from "./page-status-line";

function renderLine(items: readonly PageStatusItem[]) {
  return render(
    <MemoryRouter>
      <PageStatusLine items={items} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PageStatusLine", () => {
  it("renders nothing when there is nothing to report", () => {
    const view = renderLine([]);

    expect(
      view.container.querySelector("[data-page-header-status]"),
    ).toBeNull();
    expect(view.container.textContent).toBe("");
  });

  it("is one polite status line that never wraps", () => {
    renderLine([{ id: "run", text: "Last automatic run: 10 jobs" }]);

    const line = screen.getByRole("status");
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(line.hasAttribute("data-page-header-status")).toBe(true);
    for (const token of [
      "mt-1.5",
      "h-6",
      "overflow-x-clip",
      "whitespace-nowrap",
      "text-foreground-soft",
    ]) {
      expect(line.className).toContain(token);
    }
    // No tinted box: no fill, border or radius on the line.
    expect(line.className).not.toMatch(/\bbg-|\bborder\b|rounded/u);
  });

  it("orders critical, then warning, then info, then neutral items", () => {
    const sorted = sortPageStatusItems([
      { id: "neutral", text: "Last run" },
      { id: "info", text: "Editing paused", tone: "info" },
      { id: "warning", text: "Paused", tone: "warning" },
      { id: "critical", text: "3 holds", tone: "critical" },
    ]);

    expect(sorted.map((item) => item.id)).toEqual([
      "critical",
      "warning",
      "info",
      "neutral",
    ]);
  });

  it("marks tone with an 8px dot and keeps critical text at full contrast", () => {
    const view = renderLine([
      { id: "warning", text: "Paused", tone: "warning" },
      { id: "critical", text: "3 safeguard holds", tone: "critical" },
      { id: "neutral", text: "Last automatic run" },
    ]);

    const items = view.container.querySelectorAll("[data-page-status-item]");
    expect(
      Array.from(items, (item) => item.getAttribute("data-page-status-item")),
    ).toEqual(["critical", "warning", "neutral"]);
    const criticalDot = items[0]?.querySelector("[data-page-status-dot]");
    expect(criticalDot?.className).toContain("size-2");
    expect(criticalDot?.className).toContain("bg-destructive");
    expect(
      items[1]?.querySelector("[data-page-status-dot]")?.className,
    ).toContain("bg-(--warning-text)");
    expect(items[2]?.querySelector("[data-page-status-dot]")).toBeNull();
    expect(screen.getByText("3 safeguard holds").className).toContain(
      "text-foreground",
    );
    // Separators sit between items, never before the first.
    expect(items[0]?.textContent?.startsWith("·")).toBe(false);
    expect(items[1]?.textContent?.startsWith("·")).toBe(true);
  });

  it("links to the owning screen and keeps at most one button on the line", () => {
    const resume = vi.fn();
    const retry = vi.fn();
    renderLine([
      {
        id: "holds",
        text: "3 safeguard holds are pausing some work",
        tone: "critical",
        action: {
          kind: "link",
          label: "Open Safeguards",
          to: "/job-finder/safeguards",
        },
      },
      {
        id: "paused",
        text: "Paused",
        tone: "warning",
        action: { kind: "button", label: "Resume activity", onClick: resume },
      },
      {
        id: "retry",
        text: "10 could not be applied",
        action: { kind: "button", label: "Retry all 10", onClick: retry },
      },
    ]);

    const link = screen.getByRole("link", { name: "Open Safeguards" });
    expect(link.getAttribute("href")).toBe("/job-finder/safeguards");
    expect(link.getAttribute("data-slot")).toBe("text-link");

    const resumeButton = screen.getByRole("button", {
      name: "Resume activity",
    });
    expect(resumeButton.getAttribute("data-slot")).not.toBe("text-link");
    expect(resumeButton.className).toContain("h-6");
    fireEvent.click(resumeButton);
    expect(resume).toHaveBeenCalledOnce();

    // The second page-level button reads as a link instead.
    const retryLink = screen.getByRole("button", { name: "Retry all 10" });
    expect(retryLink.getAttribute("data-slot")).toBe("text-link");
    fireEvent.click(retryLink);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("hides an item for the visit and disappears once everything is hidden", () => {
    const view = renderLine([
      { id: "paused", text: "Paused", tone: "warning" },
      { id: "run", text: "Last automatic run: 10 jobs" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Hide for now: Paused" }),
    );
    expect(screen.queryByText("Paused")).toBeNull();
    expect(screen.getByText("Last automatic run: 10 jobs")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Hide for now: Last automatic run: 10 jobs",
      }),
    );
    expect(
      view.container.querySelector("[data-page-header-status]"),
    ).toBeNull();
  });

  it("shows hidden items again on the next visit", () => {
    const items: PageStatusItem[] = [
      { id: "paused", text: "Paused", tone: "warning" },
    ];
    const first = renderLine(items);
    fireEvent.click(
      screen.getByRole("button", { name: "Hide for now: Paused" }),
    );
    expect(screen.queryByText("Paused")).toBeNull();
    first.unmount();

    renderLine(items);
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("collapses items that do not fit into +N more, which lists every item", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.hasAttribute("data-page-status-item")) return 200;
        if (this.hasAttribute("data-page-status-more")) return 70;
        return 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-page-header-status") ? 500 : 0;
      },
    );

    const view = renderLine([
      { id: "a", text: "First condition", tone: "critical" },
      { id: "b", text: "Second condition", tone: "warning" },
      { id: "c", text: "Third summary" },
      { id: "d", text: "Fourth summary" },
    ]);

    const line = screen.getByRole("status");
    const shown = line.querySelectorAll("[data-page-status-item]");
    expect(shown).toHaveLength(2);
    // Measured at full width; after the fit only the first item may shrink.
    expect(shown[0]?.className).toMatch(/(^|\s)shrink(\s|$)/u);
    expect(shown[1]?.className).toContain("shrink-0");
    const more = within(line).getByRole("button", { name: "+2 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      fireEvent.click(more);
    });
    const popover = document.body.querySelector<HTMLElement>(
      "[data-page-status-popover]",
    );
    expect(popover).not.toBeNull();
    const listed = within(popover as HTMLElement).getAllByRole("listitem");
    expect(listed.map((item) => item.textContent)).toEqual([
      expect.stringContaining("First condition"),
      expect.stringContaining("Second condition"),
      expect.stringContaining("Third summary"),
      expect.stringContaining("Fourth summary"),
    ]);

    act(() => {
      fireEvent.click(
        within(popover as HTMLElement).getByRole("button", {
          name: "Hide for now: Fourth summary",
        }),
      );
    });
    expect(screen.queryByText("Fourth summary")).toBeNull();
    expect(
      view.container.querySelector("[data-page-header-status]"),
    ).not.toBeNull();
  });
});
