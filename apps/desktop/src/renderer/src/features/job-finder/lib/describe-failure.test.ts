import { describe, expect, it } from "vitest";

import {
  NO_PROGRESS_MESSAGE,
  plainRecordedJobFinderText,
  splitBlockedAttemptNote,
  describeFailure,
  describeWorkspaceRestoreFailure,
} from "./describe-failure";

describe("recorded Job Finder copy", () => {
  const internal =
    "The page did not expose a new form state after the previous safe advance. The runtime stopped instead of repeating a control or guessing at page behavior.";

  it("never exposes internal no-progress language", () => {
    expect(plainRecordedJobFinderText(internal)).toBe(NO_PROGRESS_MESSAGE);
    expect(
      splitBlockedAttemptNote(`${internal} Blocked: xhr POST /apply`),
    ).toEqual({
      message: NO_PROGRESS_MESSAGE,
      technicalDetails: "Blocked: xhr POST /apply",
    });
    expect(plainRecordedJobFinderText(internal)).not.toMatch(
      /safe advance|form state|runtime/iu,
    );
  });
});

describe("paused background work", () => {
  it("turns the activity-paused IPC error into a resume instruction", () => {
    const description = describeFailure(
      new Error(
        "Error invoking remote method 'job-finder:run-source-debug': Error: Browser and application activity is paused. Press Resume background work on the Job Finder Home screen before starting new work.",
      ),
      { action: "check this source" },
    );
    expect(description.kind).toBe("paused");
    expect(description.userMessage).toBe(
      "Could not check this source. Background work is paused, so nothing new can start. Press Resume background work on the Job Finder Home screen, then try again.",
    );
    expect(description.userMessage).not.toContain("remote method");
  });
});

it("workspace restore explains unknown versions and keeps unexpected raw errors behind details", () => {
  const unsupported = describeWorkspaceRestoreFailure(
    new Error(
      "Error invoking remote method 'job-finder:preview-personal-workspace-restore': Error: This export uses a version Nordri cannot restore. Your workspace was kept.",
    ),
  );
  expect(unsupported.userMessage).toBe(
    "This export uses a version Nordri cannot restore. Your workspace was kept.",
  );
  const unknown = describeWorkspaceRestoreFailure(
    new Error("Unexpected storage failure at internal_record_123"),
  );
  expect(unknown.userMessage).not.toContain("internal_record_123");
  expect(unknown.technicalDetails).toContain("internal_record_123");
});

it("keeps service listing advice without its Electron wrapper and hides arbitrary errors", async () => {
  const { describeListingReadFailure, describeBrowserJobFailure } =
    await import("./describe-failure");
  const advice =
    "The listing could not be read from this page. Open the listing and try again.";
  expect(
    describeListingReadFailure(
      new Error(
        `Error invoking remote method 'job-finder:assess': Error: ${advice}`,
      ),
    ),
  ).toBe(advice);
  expect(
    describeListingReadFailure(new Error("Model provider secret payload")),
  ).toBe("Could not assess this listing. Try again.");
  expect(
    describeBrowserJobFailure(
      new Error(
        "No job listing was found on this page. Open the job's own listing and try again.",
      ),
    ),
  ).toContain("No job listing");
});
