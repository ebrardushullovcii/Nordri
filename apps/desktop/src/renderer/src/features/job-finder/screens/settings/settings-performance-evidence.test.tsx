// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { JobFinderPerformanceSnapshotSchema } from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPerformanceEvidence } from "./settings-performance-evidence";

const generatedAt = "2026-08-09T10:00:00.000Z";

describe("SettingsPerformanceEvidence", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows measured zero, partial, and unavailable timings as distinct states", async () => {
    const snapshot = JobFinderPerformanceSnapshotSchema.parse({
      generatedAt,
      latestDiscoveryRun: null,
      latestSourceDebugRun: null,
      evidence: [
        {
          area: "resume_import",
          measurementStatus: "available",
          durationMs: 0,
          recordedAt: generatedAt,
          method: "resume_import_run",
          sampleCount: 1,
          budgetStatus: "not_evaluated",
          stageDurations: [
            { id: "resume_import.literal_extraction", durationMs: 0 },
          ],
        },
        {
          area: "application_preparation",
          measurementStatus: "partial",
          durationMs: null,
          recordedAt: generatedAt,
          method: "application_attempt",
          sampleCount: 1,
          budgetStatus: "not_evaluated",
          stageDurations: [
            {
              id: "application_preparation.form_preparation",
              durationMs: 2_500,
            },
          ],
          unavailableReason: "total_not_recorded",
        },
        {
          area: "renderer_commit",
          measurementStatus: "unavailable",
          durationMs: null,
          recordedAt: null,
          method: "none",
          sampleCount: 0,
          budgetStatus: "unavailable",
          unavailableReason: "no_recorded_measurement",
        },
      ],
    });
    const getPerformanceSnapshot = vi.fn().mockResolvedValue(snapshot);
    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: { jobFinder: { getPerformanceSnapshot } },
    });
    const { getAllByText, getByRole, getByText } = render(
      <SettingsPerformanceEvidence />,
    );

    fireEvent.click(getByRole("button", { name: "Load performance evidence" }));

    await waitFor(() => expect(getPerformanceSnapshot).toHaveBeenCalledOnce());
    expect(getByText("Resume import")).toBeTruthy();
    expect(getAllByText("0 ms").length).toBeGreaterThanOrEqual(1);
    expect(getByText("Application preparation")).toBeTruthy();
    expect(getByText("Total not recorded")).toBeTruthy();
    expect(getByText("Renderer commit")).toBeTruthy();
    expect(getByText("Not recorded")).toBeTruthy();
    expect(getAllByText("No stable budget yet")).toHaveLength(2);
    expect(
      getAllByText("Stage details")[0]
        ?.closest("details")
        ?.hasAttribute("open"),
    ).toBe(false);
  });
});
