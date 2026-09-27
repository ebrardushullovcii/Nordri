// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationsDetailPanelEmptyState } from "./applications-detail-panel-empty-state";

afterEach(cleanup);

describe("ApplicationsDetailPanelEmptyState", () => {
  it("offers a direct Shortlisted action instead of a dead-end card before any applications exist", () => {
    render(
      <MemoryRouter>
        <ApplicationsDetailPanelEmptyState
          activeFilter="all"
          hasAnyApplications={false}
          hasVisibleApplications={false}
        />
      </MemoryRouter>,
    );

    const shortlistedLink = screen.getByRole("link", {
      name: "Open Shortlisted",
    });
    expect(shortlistedLink.getAttribute("href")).toBe(
      "/job-finder/review-queue",
    );
    expect(screen.queryByText("Nothing selected")).toBeNull();
    expect(
      screen.queryByText("Start an application from the list on the left."),
    ).toBeNull();
    expect(
      screen.getByText(/choose Apply.*apply mode chosen in Settings/i),
    ).toBeTruthy();
  });

  it("keeps filter-specific guidance when records exist outside the active view", () => {
    render(
      <MemoryRouter>
        <ApplicationsDetailPanelEmptyState
          activeFilter="submitted"
          hasAnyApplications
          hasVisibleApplications={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("No applications in this view")).toBeTruthy();
    expect(screen.getByText(/outside the Submitted view/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("prompts selection when applications are visible", () => {
    render(
      <MemoryRouter>
        <ApplicationsDetailPanelEmptyState
          activeFilter="all"
          hasAnyApplications
          hasVisibleApplications
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Choose an application")).toBeTruthy();
  });
});
