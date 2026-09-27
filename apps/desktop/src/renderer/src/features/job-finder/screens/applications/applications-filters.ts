export const APPLICATION_FILTERS = [
  "all",
  "needs_action",
  "in_progress",
  "submitted",
  "manual_only",
] as const;

export type ApplicationsViewFilter = (typeof APPLICATION_FILTERS)[number];

/**
 * These chips are views over application records, not over the unresolved
 * steps the global "Needs you" destination counts. The waiting view used to
 * borrow that name while counting a different (larger) population, so the
 * same screen could show "Needs you 2" beside "Needs you: 1 unresolved".
 */
export const APPLICATION_FILTER_LABELS: Record<ApplicationsViewFilter, string> =
  {
    all: "All",
    needs_action: "Waiting on you",
    in_progress: "In progress",
    submitted: "Submitted",
    manual_only: "On the site",
  };

/**
 * The chip's accessible name states its unit, so a screen reader never hears
 * two bare "Needs you" counts of different things on one screen.
 */
export function formatApplicationFilterAccessibleLabel(
  filter: ApplicationsViewFilter,
  count: number,
): string {
  return `${APPLICATION_FILTER_LABELS[filter]}: ${count} ${
    count === 1 ? "application" : "applications"
  }`;
}
