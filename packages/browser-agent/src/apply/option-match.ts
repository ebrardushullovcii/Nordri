import { normalizeSignal } from "./control-classification";

/** The plain ways people write yes and no, in the words a form offers. */
const AFFIRMATIVE_SYNONYMS = new Set([
  "yes",
  "y",
  "true",
  "i do",
  "i have",
  "affirmative",
]);
const NEGATIVE_SYNONYMS = new Set([
  "no",
  "n",
  "none",
  "nope",
  "false",
  "i do not",
  "i have not",
  "negative",
  "not applicable",
  "n a",
]);

/**
 * Fit the model's chosen answer to the options a control actually offers.
 *
 * Returns the option label to choose, or null when nothing on the list says
 * the same thing. This is spelling, not judgment: the model picked the
 * answer; this finds the exact label the page uses for it.
 */
export function matchOption(
  options: readonly string[],
  desiredValue: string,
): string | null {
  const desired = normalizeSignal(desiredValue);
  if (!desired) {
    return null;
  }
  const exact = options.find((option) => normalizeSignal(option) === desired);
  if (exact) {
    return exact;
  }
  const yesish =
    AFFIRMATIVE_SYNONYMS.has(desired) || desired.startsWith("yes ");
  const noish = NEGATIVE_SYNONYMS.has(desired) || desired.startsWith("no ");
  if (yesish || noish) {
    const wanted = yesish ? "yes" : "no";
    const affirmative = options.find((option) => {
      const normalized = normalizeSignal(option);
      return normalized === wanted || normalized.startsWith(`${wanted} `);
    });
    if (affirmative) {
      return affirmative;
    }
  }
  const contained = options.filter((option) => {
    const normalized = normalizeSignal(option);
    return (
      normalized.length > 0 &&
      (normalized === desired || normalized.includes(desired))
    );
  });
  if (contained.length === 1) {
    return contained[0] ?? null;
  }
  // One choice the answer is the beginning of, and only one, is that choice:
  // "Bach" on a list offering "Bachelor's degree" and "Master's degree".
  const prefixed = options.filter((option) =>
    normalizeSignal(option).startsWith(desired),
  );
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}
