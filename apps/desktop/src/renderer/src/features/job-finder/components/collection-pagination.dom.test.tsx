// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useState } from "react";
import { CollectionPagination } from "./collection-pagination";

function StatefulPagination({ initialPage = 1 }: { initialPage?: number }) {
  const [page, setPage] = useState(initialPage);

  return (
    <CollectionPagination
      itemLabel="jobs"
      onPageChange={setPage}
      page={page}
      pageSize={50}
      totalCount={120}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("CollectionPagination focus ownership", () => {
  test("does not steal focus when it mounts", () => {
    render(
      <>
        <button type="button">Before pagination</button>
        <StatefulPagination />
      </>,
    );

    expect(document.activeElement).toBe(document.body);
  });

  test("keeps focus on a valid pagination action after changing page", () => {
    render(<StatefulPagination />);
    const nextButton = screen.getByRole("button", { name: "Next page" });

    nextButton.focus();
    fireEvent.click(nextButton);

    expect(screen.getByText("51–100 of 120")).toBeTruthy();
    expect(document.activeElement).toBe(nextButton);
  });

  test("moves focus to Previous when Next becomes disabled on the last page", () => {
    render(<StatefulPagination initialPage={2} />);
    const nextButton = screen.getByRole("button", { name: "Next page" });
    const previousButton = screen.getByRole("button", {
      name: "Previous page",
    });

    nextButton.focus();
    fireEvent.click(nextButton);

    expect(screen.getByText("101–120 of 120")).toBeTruthy();
    expect(nextButton).toHaveProperty("disabled", true);
    expect(document.activeElement).toBe(previousButton);
  });

  test("does not prevent Tab or Shift+Tab from leaving the controls", () => {
    render(<StatefulPagination />);
    const previousButton = screen.getByRole("button", {
      name: "Previous page",
    });
    const nextButton = screen.getByRole("button", { name: "Next page" });

    expect(fireEvent.keyDown(nextButton, { key: "Tab" })).toBe(true);
    expect(
      fireEvent.keyDown(previousButton, { key: "Tab", shiftKey: true }),
    ).toBe(true);
  });
});

describe("CollectionPagination layout", () => {
  test("is one 44px line with the range on the left and small buttons on the right", () => {
    const view = render(<StatefulPagination />);
    const nav = screen.getByRole("navigation", { name: "jobs pagination" });

    for (const token of [
      "flex",
      "h-11",
      "items-center",
      "justify-between",
      "px-3",
    ]) {
      expect(nav.className).toContain(token);
    }
    expect(nav.className).not.toContain("flex-wrap");
    const range = screen.getByText("1–50 of 120");
    // The noun stays for screen readers.
    expect(range.textContent).toBe("1–50 of 120 jobs");
    expect(view.container.querySelector(".sr-only")?.textContent).toBe(" jobs");
    expect(
      screen.getByRole("button", { name: "Next page" }).className,
    ).toContain("h-6");
    expect(
      screen.getByRole("button", { name: "Previous page" }).className,
    ).toContain("h-6");
  });
});
