// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  BrowserSessionState,
  JobSearchPreferences,
  SavedJob,
} from "@unemployed/contracts";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@renderer/features/job-finder/components/locked-screen-layout",
  () => ({
    LockedScreenLayout: ({
      children,
      topContent,
    }: {
      children: ReactNode;
      topContent: ReactNode;
    }) => (
      <main>
        {topContent}
        {children}
      </main>
    ),
  }),
);
vi.mock("./discovery-activity-panel", () => ({
  DiscoveryHistoryModal: () => null,
}));
vi.mock("./discovery-detail-panel", () => ({
  DiscoveryDetailPanel: () => (
    <section aria-label="Job details">Job details</section>
  ),
}));
vi.mock("./discovery-filters-panel", () => ({
  DiscoveryFiltersPanel: ({ activityPaused }: { activityPaused?: boolean }) => (
    <section aria-label="Current search">
      {activityPaused ? "setup-search-paused" : "setup-search-available"}
    </section>
  ),
}));
vi.mock("./discovery-results-panel", () => ({
  DiscoveryResultsPanel: () => (
    <section aria-label="Job results">Job results</section>
  ),
}));

import { DISCOVERY_PAUSED_SEARCH_REASON } from "./discovery-search-readiness";
import { DiscoveryScreen } from "./discovery-screen";

const browserSession = {
  source: "target_site",
  status: "ready",
  driver: "chrome_profile_agent",
  label: "Browser ready",
  detail: "The browser is ready for source search.",
  lastCheckedAt: "2026-08-25T10:00:00.000Z",
} as BrowserSessionState;

const searchPreferences = {
  targetRoles: ["Software Engineer"],
  jobFamilies: [],
  locations: ["Remote"],
  excludedLocations: [],
  workModes: ["remote"],
  seniorityLevels: [],
  targetIndustries: [],
  targetCompanyStages: [],
  employmentTypes: [],
  minimumSalaryUsd: null,
  targetSalaryUsd: null,
  salaryCurrency: "USD",
  compensation: {
    minimum: null,
    maximum: null,
    interval: "year",
    currency: "USD",
    currencyStatus: "inherited",
  },
  approvalMode: "review_before_submit",
  tailoringMode: "balanced",
  companyBlacklist: [],
  companyWhitelist: [],
  discovery: {
    historyLimit: 5,
    targets: [
      {
        id: "source_1",
        label: "Example Board",
        startingUrl: "https://jobs.example.com",
        enabled: true,
      },
    ],
  },
} as unknown as JobSearchPreferences;

function createJob(id: string): SavedJob {
  return {
    id,
    matchAssessment: { recommendation: "strong_fit" },
  } as unknown as SavedJob;
}

function buildScreen(overrides?: {
  activityPaused?: boolean;
  isActivityPausePending?: boolean;
  onResumeActivity?: () => void;
}) {
  return (
    <MemoryRouter>
      <DiscoveryScreen
        actionState={{ message: null }}
        {...(overrides?.activityPaused ? { activityPaused: true } : {})}
        activeRun={null}
        browserSession={browserSession}
        {...(overrides?.isActivityPausePending
          ? { isActivityPausePending: true }
          : {})}
        discoverySessions={[]}
        isBrowserSessionPending={false}
        isBrowserSessionPendingForTarget={() => false}
        isDiscoveryAllPending={false}
        isJobPending={() => false}
        isTargetPending={() => false}
        jobs={[createJob("strong")]}
        dismissedJobs={[]}
        liveEvents={[]}
        onDismissJob={vi.fn()}
        onRestoreDismissedJob={vi.fn()}
        onOpenBrowserSession={vi.fn()}
        onOpenBrowserSessionForTarget={vi.fn()}
        onQueueJob={vi.fn()}
        onRunAgentDiscovery={vi.fn()}
        {...(overrides?.onResumeActivity
          ? { onResumeActivity: overrides.onResumeActivity }
          : {})}
        onSelectJob={vi.fn()}
        recentRuns={[]}
        searchPreferences={searchPreferences}
        selectedJob={createJob("strong")}
        sourceAccessPrompts={[]}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
});

describe("DiscoveryScreen paused search availability", () => {
  it("shows the paused banner with Resume and disables the header search with a visible reason", () => {
    const onResumeActivity = vi.fn();
    render(buildScreen({ activityPaused: true, onResumeActivity }));

    const banner = screen.getByTestId("discovery-paused-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.textContent).toMatch(/paused/i);

    const searchButton = screen.getByRole("button", { name: "Search now" });
    expect(searchButton.hasAttribute("disabled")).toBe(true);
    expect(searchButton.getAttribute("aria-describedby")).toBe(
      "discovery-header-search-paused-reason",
    );

    const reason = document.getElementById(
      "discovery-header-search-paused-reason",
    );
    expect(reason?.textContent).toContain(DISCOVERY_PAUSED_SEARCH_REASON);

    fireEvent.click(screen.getByRole("button", { name: /resume activity/i }));
    expect(onResumeActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps the paused truth visible in setup mode and reports the pause to the setup panel", () => {
    render(buildScreen({ activityPaused: true }));

    fireEvent.click(
      document.querySelector(
        '[data-discovery-search-chip="roles"]',
      ) as HTMLElement,
    );

    // Setup mode renders the filters panel; the banner stays above it.
    expect(screen.getByText(/setup-search-paused/i)).toBeTruthy();
    expect(screen.getByTestId("discovery-paused-banner")).toBeTruthy();
  });

  it("offers no banner and keeps search available when activity is running again", () => {
    render(buildScreen({}));

    expect(screen.queryByTestId("discovery-paused-banner")).toBeNull();
    const searchButton = screen.getByRole("button", { name: "Search now" });
    expect(searchButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(
      document.querySelector(
        '[data-discovery-search-chip="roles"]',
      ) as HTMLElement,
    );
    expect(screen.getByText(/setup-search-available/i)).toBeTruthy();
  });

  it("renders a pending Resume control while the resume request is in flight", () => {
    render(
      buildScreen({
        activityPaused: true,
        isActivityPausePending: true,
        onResumeActivity: vi.fn(),
      }),
    );

    const resumeButton = screen
      .getByTestId("discovery-paused-banner")
      .querySelector("button");
    // The shared Button marks in-flight controls via aria-busy/data-pending
    // plus aria-disabled instead of relying on color alone.
    expect(resumeButton?.getAttribute("data-pending")).toBe("true");
    expect(resumeButton?.getAttribute("aria-busy")).toBe("true");
  });
});
