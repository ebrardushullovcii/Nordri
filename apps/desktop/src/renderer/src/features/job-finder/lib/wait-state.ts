/**
 * The shared wait contract for every Job Finder surface.
 *
 * `docs/PRODUCT.md` "Honest loading": every wait shows elapsed and expected
 * time or a real progress signal, never a fabricated percentage. The reference
 * implementation of that trio used to live inside
 * `screens/review-queue/review-queue-progress.ts`, so only the two review-queue
 * waits had it and five others had one leg or none — a ~22s Copilot round-trip
 * showed three dots and no clock. The helpers now live here, one import away
 * from any screen, and `review-queue-progress.ts` re-exports them so its own
 * callers are unchanged.
 */

/**
 * A pending resume operation can legitimately take longer when it is waiting
 * on research or the configured AI provider. Once this threshold passes, the
 * UI adds recovery guidance without changing the operation's real state.
 */
export const RESUME_OPERATION_LONG_RUNNING_MS = 30_000;

/**
 * A tailored draft says "Usually 40-70 seconds", so it is only late once that
 * stated range has passed.
 */
export const RESUME_DRAFT_LONG_RUNNING_MS = 70_000;

/**
 * The Assistant's own escalation threshold. A measured reply takes 24-27s, so a
 * 30s threshold fired only after the wait was already over and the recovery
 * copy never appeared when it would have helped. This sits below the typical
 * wait instead.
 */
export const RESUME_ASSISTANT_LONG_RUNNING_MS = 20_000;

/**
 * Stated out loud beside the elapsed counter so the wait has an expectation
 * attached rather than an indefinite "Working on your edit…".
 */
export const RESUME_ASSISTANT_EXPECTED_WAIT_LABEL =
  "Usually 20-30 seconds for a grounded rewrite.";

/**
 * The tailored draft is the longest wait in the journey. Measured wall-clocks
 * for a full draft-and-PDF run: 39.1s, 57.7s and 63.7s across the last three
 * full walks. Stated from the first second so a successful long operation is
 * not mistaken for a hang.
 */
export const RESUME_DRAFT_EXPECTED_WAIT_LABEL =
  "Usually 40-70 seconds for a tailored draft.";

/**
 * A sub-second round trip that flashes `0:00` and vanishes reads as a glitch,
 * so the digits are withheld until the wait is genuinely worth timing. The
 * slot itself is reserved from the first frame regardless — see
 * `WAIT_ELAPSED_RESERVED_WIDTH`.
 */
export const WAIT_ELAPSED_VISIBLE_AFTER_SECONDS = 2;

/**
 * The widest value the clock can print in the shape below is five characters
 * (`10:00`, `59:59`, …), while the narrowest is four (`0:00`). Rendered with
 * `tabular-nums`, a five-character floor therefore holds the box at exactly one
 * width for every value: the counter cannot widen the row it sits in as the
 * digits grow, which is what made the Assistant's message block jump one
 * character wider on the first minute boundary.
 *
 * This is an inline `min-width` rather than a utility class deliberately: it is
 * the load-bearing part of the "nothing shifts" promise here, and an inline
 * value is the only form the guard test can read back out of the DOM.
 */
export const WAIT_ELAPSED_RESERVED_CHARACTERS = 5;
export const WAIT_ELAPSED_RESERVED_WIDTH = `${WAIT_ELAPSED_RESERVED_CHARACTERS}ch`;

/** Whole seconds, in the same `0:07` shape the resume-import progress uses. */
export function formatResumeOperationElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

/**
 * The escalation decision, kept here so every surface crosses the same
 * threshold instead of each one inventing its own (or having none).
 */
export function isWaitLongRunning(
  elapsedSeconds: number,
  longRunningMs: number = RESUME_OPERATION_LONG_RUNNING_MS,
): boolean {
  return Math.max(0, elapsedSeconds) * 1_000 >= longRunningMs;
}
