// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SavedJobSchema, type SavedJob } from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DiscoveryResultsPanel,
  getDiscoveryProgressCountLabel,
} from "./discovery-results-panel";

const browserSession = {
  source: "target_site" as const,
  status: "ready" as const,
  driver: "chrome_profile_agent" as const,
  label: "Browser ready",
  detail: "Ready when needed.",
  lastCheckedAt: "2026-08-23T10:00:00.000Z",
};

const COLLECTION_VIEW_STORAGE_KEY =
  "nordri.job-finder.collection.discovery-results.v1";

function createJob(id: string, title: string): SavedJob {
  return SavedJobSchema.parse({
    id,
    source: "target_site",
    sourceJobId: `source-${id}`,
    canonicalUrl: `https://jobs.example.test/${id}`,
    applicationUrl: `https://jobs.example.test/${id}/apply`,
    title,
    company: `Company ${id}`,
    location: "Remote",
    workMode: ["remote"],
    applyPath: "external_redirect",
    easyApplyEligible: false,
    discoveredAt: "2026-08-23T10:00:00.000Z",
    salaryText: null,
    description: `Role ${id}`,
    status: "discovered",
    provenance: [],
    matchAssessment: {
      score: 90,
      recommendation: "strong_fit",
      reasons: ["Relevant experience"],
      gaps: [],
    },
  });
}

function renderStreamingResults(jobs: readonly SavedJob[]) {
  return render(
    <DiscoveryResultsPanel
      browserSession={browserSession}
      isSearchInProgress
      jobs={jobs}
      onSelectJob={vi.fn()}
      selectedJob={jobs[0] ?? null}
    />,
  );
}

function getProgressCount(): string {
  const liveRegion = screen.getByText(/ready to review\.$/, {
    selector: "strong",
  });
  return liveRegion.textContent ?? "";
}

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

describe("DiscoveryResultsPanel streaming progress count", () => {
  it("reports the raw total only when nothing filters the list", () => {
    renderStreamingResults([
      createJob("alpha", "Engineer alpha"),
      createJob("beta", "Designer beta"),
    ]);

    expect(getProgressCount()).toBe("2 matches ready to review.");
  });

  it("singularizes a single streaming match", () => {
    renderStreamingResults([createJob("alpha", "Engineer alpha")]);

    expect(getProgressCount()).toBe("1 match ready to review.");
  });

  it("reports the visible subset when a persisted query hides results", () => {
    window.localStorage.setItem(
      COLLECTION_VIEW_STORAGE_KEY,
      JSON.stringify({
        density: "comfortable",
        query: "designer",
        savedViews: [],
      }),
    );
    renderStreamingResults([
      createJob("alpha", "Engineer alpha"),
      createJob("beta", "Designer beta"),
    ]);

    // The persisted query survives remounts, so the callout must never claim
    // the raw total while the visible list is narrower.
    expect(getProgressCount()).toBe("1 of 2 matches ready to review.");
    expect(screen.getByText("Designer beta")).toBeTruthy();
    expect(screen.queryByText("Engineer alpha")).toBeNull();
  });

  it("returns to the raw total after the query is cleared mid-run", () => {
    window.localStorage.setItem(
      COLLECTION_VIEW_STORAGE_KEY,
      JSON.stringify({
        density: "comfortable",
        query: "designer",
        savedViews: [],
      }),
    );
    renderStreamingResults([
      createJob("alpha", "Engineer alpha"),
      createJob("beta", "Designer beta"),
    ]);
    expect(getProgressCount()).toBe("1 of 2 matches ready to review.");

    fireEvent.change(screen.getByLabelText("Find a job"), {
      target: { value: "" },
    });

    expect(getProgressCount()).toBe("2 matches ready to review.");
    expect(screen.getByText("Engineer alpha")).toBeTruthy();
  });
});

describe("getDiscoveryProgressCountLabel", () => {
  it("keeps identical totals phrased as the full result set", () => {
    expect(getDiscoveryProgressCountLabel(0, 0)).toBe(
      "0 matches ready to review.",
    );
    expect(getDiscoveryProgressCountLabel(1, 1)).toBe(
      "1 match ready to review.",
    );
    expect(getDiscoveryProgressCountLabel(7, 7)).toBe(
      "7 matches ready to review.",
    );
  });

  it("phrases filtered subsets as visible-of-total", () => {
    expect(getDiscoveryProgressCountLabel(0, 2)).toBe(
      "0 of 2 matches ready to review.",
    );
    expect(getDiscoveryProgressCountLabel(1, 2)).toBe(
      "1 of 2 matches ready to review.",
    );
    expect(getDiscoveryProgressCountLabel(3, 4)).toBe(
      "3 of 4 matches ready to review.",
    );
  });
});
