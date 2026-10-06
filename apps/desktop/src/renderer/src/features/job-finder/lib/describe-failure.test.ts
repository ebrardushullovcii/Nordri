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
