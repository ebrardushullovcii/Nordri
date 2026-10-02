import { RESUME_DRAFT_LONG_RUNNING_MS } from "@renderer/features/job-finder/lib/wait-state";
import { describe, expect, it } from "vitest";
import { isWaitLongRunning } from "../../lib/wait-state";
import * as reviewQueueProgress from "./review-queue-progress";
import {
  formatResumeOperationElapsed,
  RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
  RESUME_DRAFT_EXPECTED_WAIT_LABEL,
} from "./review-queue-progress";

describe("review queue progress helpers", () => {
  it("exposes no fabricated-progress helper for callers to reach for", () => {
    // The previous ratchet eased a made-up percentage to a 94% ceiling in
    // ~15.6s and then froze there for the remaining ~42s of a 57.7s draft.
    // Nothing in the pipeline reports a completion fraction, so the ratchet
    // is gone rather than merely unused.
    expect(Object.keys(reviewQueueProgress)).not.toContain(
      "getDisplayedResumeProgress",
    );
    expect(Object.keys(reviewQueueProgress)).not.toContain(
      "getNextDisplayedResumeProgress",
    );
    expect(Object.keys(reviewQueueProgress)).not.toContain(
      "rememberDisplayedResumeProgress",
    );
  });

  it("states a tailored-draft expectation grounded in measured wall-clocks", () => {
    // Measured full draft-and-PDF runs: 39.1s, 57.7s, 63.7s.
    expect(RESUME_DRAFT_EXPECTED_WAIT_LABEL).toBe(
      "Usually 40-70 seconds for a tailored draft.",
    );
    expect(RESUME_DRAFT_EXPECTED_WAIT_LABEL).not.toBe(
      RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
    );
  });

  it("formats the elapsed clock in the same shape the other waits use", () => {
    expect(formatResumeOperationElapsed(0)).toBe("0:00");
    expect(formatResumeOperationElapsed(7)).toBe("0:07");
    expect(formatResumeOperationElapsed(69)).toBe("1:09");
    expect(formatResumeOperationElapsed(-4)).toBe("0:00");
  });
});

it("does not call a draft late before the displayed 70-second range ends", () => {
  expect(isWaitLongRunning(36, RESUME_DRAFT_LONG_RUNNING_MS)).toBe(false);
  expect(isWaitLongRunning(69, RESUME_DRAFT_LONG_RUNNING_MS)).toBe(false);
  expect(isWaitLongRunning(70, RESUME_DRAFT_LONG_RUNNING_MS)).toBe(true);
});
