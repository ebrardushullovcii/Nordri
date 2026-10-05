/**
 * The wait trio now lives in `features/job-finder/lib/wait-state.ts` so every
 * screen can reach it, not only this folder. This module stays as the
 * re-export the review-queue panels already import, so promoting the helpers
 * changed no call site here.
 */
export {
  formatResumeOperationElapsed,
  isWaitLongRunning,
  RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
  RESUME_ASSISTANT_LONG_RUNNING_MS,
  RESUME_OPERATION_LONG_RUNNING_MS,
  WAIT_ELAPSED_RESERVED_CHARACTERS,
  WAIT_ELAPSED_RESERVED_WIDTH,
  WAIT_ELAPSED_VISIBLE_AFTER_SECONDS,
} from "../../lib/wait-state";

export const RESUME_DRAFT_EXPECTED_WAIT_LABEL =
  "Writing and checking the facts can take a few minutes, especially for Aggressive resumes.";
