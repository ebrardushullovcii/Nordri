// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BrowserSessionState } from "@unemployed/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscoveryResultsPanel } from "./discovery-results-panel";
import type { DiscoveryLatestRunVerdict } from "./discovery-run-feedback";

const browserSession: BrowserSessionState = {
  source: "target_site",
  status: "ready",
  driver: "chrome_profile_agent",
  label: "Browser ready",
  detail: "Ready when needed.",
  lastCheckedAt: "2026-08-23T10:00:00.000Z",
};

function renderEmptyResults(options?: {
  browserSession?: BrowserSessionState;
  hasCompletedSearch?: boolean;
  isSearchInProgress?: boolean;
  latestRunVerdict?: DiscoveryLatestRunVerdict | null;
  editPlanHref?: string;
  failureCalloutShown?: boolean;
}) {
  return render(
    <MemoryRouter>
      <DiscoveryResultsPanel
        browserSession={options?.browserSession ?? browserSession}
        jobs={[]}
        onSelectJob={vi.fn()}
        selectedJob={null}
        {...(options?.editPlanHref
          ? { editPlanHref: options.editPlanHref }
          : {})}
        {...(options?.hasCompletedSearch ? { hasCompletedSearch: true } : {})}
        {...(options?.failureCalloutShown ? { failureCalloutShown: true } : {})}
        {...(options?.isSearchInProgress ? { isSearchInProgress: true } : {})}
        {...(options?.latestRunVerdict !== undefined
          ? { latestRunVerdict: options.latestRunVerdict }
          : {})}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("DiscoveryResultsPanel newest-run empty-state verdicts", () => {
  it("offers source setup when the offline catalog has no results", () => {
    renderEmptyResults({
      browserSession: {
        ...browserSession,
        driver: "catalog_seed",
        status: "unknown",
      },
    });

    expect(
      screen.getByText("Job Finder cannot search right now"),
    ).toBeTruthy();
    const emptyState = screen.getByRole("heading", {
      name: "Job Finder cannot search right now",
    }).parentElement?.parentElement;
    expect(emptyState?.className).toContain("min-h-0");
    expect(emptyState?.className).not.toContain("min-h-80");
    expect(
      screen
        .getByRole("link", { name: "Review job sources" })
        .getAttribute("href"),
    ).toBe("/job-finder/profile?section=sources&focus=job-sources");
    expect(
      screen.getByText(
        /check your saved job sites in profile, then try searching again/iu,
      ),
    ).toBeTruthy();
  });

  it("shows an explicit failed state instead of first-search or no-match copy", () => {
    renderEmptyResults({
      latestRunVerdict: {
        hasEarlierCompleted: false,
        interruptState: "failed",
        kind: "interrupted",
      },
    });

    expect(
      screen.getByText("The last search stopped before finishing"),
    ).toBeTruthy();
    expect(
      screen.getByText(/stopped before every enabled source was checked/),
    ).toBeTruthy();
    expect(screen.queryByText("No matches from this search")).toBeNull();
    expect(screen.queryByText("Ready for your first search")).toBeNull();
  });

  it("names cancellation as its own outcome", () => {
    renderEmptyResults({
      latestRunVerdict: {
        hasEarlierCompleted: false,
        interruptState: "cancelled",
        kind: "interrupted",
      },
    });

    expect(screen.getByText("The last search was cancelled")).toBeTruthy();
    expect(
      screen.getByText(/was cancelled before every enabled source was checked/),
    ).toBeTruthy();
    expect(screen.queryByText("No matches from this search")).toBeNull();
    expect(screen.queryByText("Ready for your first search")).toBeNull();
  });

  it("acknowledges an earlier completed search behind the stopped attempt", () => {
    renderEmptyResults({
      latestRunVerdict: {
        hasEarlierCompleted: true,
        interruptState: "cancelled",
        kind: "interrupted",
      },
    });

    expect(screen.getByText(/An earlier completed search exists/)).toBeTruthy();
    expect(screen.getByText("The last search was cancelled")).toBeTruthy();
  });

  it("reports a zero-result completed run with failed sources as source failures", () => {
    renderEmptyResults({
      latestRunVerdict: {
        hasEarlierCompleted: false,
        interruptState: "sources_failed",
        kind: "interrupted",
      },
    });

    expect(
      screen.getByText("The last search finished, but sources failed"),
    ).toBeTruthy();
    expect(
      screen.getByText(/finished, but at least one enabled source failed/),
    ).toBeTruthy();
    expect(screen.queryByText("No matches from this search")).toBeNull();
  });

  it("defers to the failure callout instead of offering Search now beside it", () => {
    const verdict: DiscoveryLatestRunVerdict = {
      hasEarlierCompleted: false,
      interruptState: "sources_failed",
      kind: "interrupted",
    };
    renderEmptyResults({ latestRunVerdict: verdict });
    expect(screen.getByText(/Select Search now to try again\./)).toBeTruthy();
    cleanup();

    renderEmptyResults({ latestRunVerdict: verdict, failureCalloutShown: true });
    expect(screen.queryByText(/Select Search now to try again/)).toBeNull();
    expect(
      screen.getByText(/The message above says what to do next\./),
    ).toBeTruthy();
  });

  it("keeps the earlier-completed note behind a degraded newest run", () => {
    renderEmptyResults({
      latestRunVerdict: {
        hasEarlierCompleted: true,
        interruptState: "sources_failed",
        kind: "interrupted",
      },
    });

    expect(
      screen.getByText("The last search finished, but sources failed"),
    ).toBeTruthy();
    expect(screen.getByText(/An earlier completed search exists/)).toBeTruthy();
    expect(screen.queryByText("No matches from this search")).toBeNull();
  });

  it("keeps the no-match verdict only for a completed newest run", () => {
    renderEmptyResults({
      editPlanHref: "/job-finder/campaigns?campaignId=plan_chicago",
      latestRunVerdict: { kind: "completed" },
    });

    expect(screen.getByText("No matches from this search")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Edit your places" })
        .getAttribute("href"),
    ).toBe("/job-finder/campaigns?campaignId=plan_chicago");
    expect(
      screen.queryByText("The last search stopped before finishing"),
    ).toBeNull();
  });

  it("keeps the ready verdict only when no settled run exists", () => {
    renderEmptyResults({ latestRunVerdict: { kind: "none" } });

    expect(screen.getByText("Ready for your first search")).toBeTruthy();
    expect(screen.queryByText("No matches from this search")).toBeNull();
  });

  it("falls back to the legacy completed flag when no verdict is provided", () => {
    renderEmptyResults({ hasCompletedSearch: true });
    expect(screen.getByText("No matches from this search")).toBeTruthy();

    cleanup();

    renderEmptyResults();
    expect(screen.getByText("Ready for your first search")).toBeTruthy();
  });

  it("keeps live progress above any terminal verdict while a run is active", () => {
    renderEmptyResults({
      isSearchInProgress: true,
      latestRunVerdict: {
        hasEarlierCompleted: false,
        interruptState: "failed",
        kind: "interrupted",
      },
    });

    expect(screen.getByText("Searching your sources")).toBeTruthy();
    expect(
      screen.queryByText("The last search stopped before finishing"),
    ).toBeNull();
  });

  it("treats a running newest run as live progress rather than a final verdict", () => {
    renderEmptyResults({ latestRunVerdict: { kind: "running" } });

    expect(screen.getByText("Searching your sources")).toBeTruthy();
    expect(screen.queryByText("Ready for your first search")).toBeNull();
    expect(screen.queryByText("No matches from this search")).toBeNull();
  });
});
