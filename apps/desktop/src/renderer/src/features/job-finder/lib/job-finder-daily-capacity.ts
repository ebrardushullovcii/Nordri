import type { GlobalDailyApplicationPreparationCapacity } from "@nordri/contracts";

/**
 * Truthful daily-capacity presentation shared by every surface that can start
 * an employer-application preparation. The durable accounting itself stays in
 * the workspace service; this module only projects one consistent,
 * non-color explanation of the fixed local-day limit.
 */

export function isDailyPreparationCapacityExhausted(
  capacity: GlobalDailyApplicationPreparationCapacity | null | undefined,
): boolean {
  return capacity?.remaining === 0;
}

export function formatDailyPreparationResetTime(resetsAt: string): string {
  const resetTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(resetsAt));
  return resetTime;
}

/**
 * Renderer-side mirror of the backend's fixed local-day safeguard limit.
 * Renderer code cannot import job-finder package internals across its
 * boundary, so a legacy snapshot whose dashboard has not derived a capacity
 * object yet still presents one consistent number instead of an inline magic
 * literal on every surface.
 */
export const FALLBACK_DAILY_APPLICATION_PREPARATION_LIMIT = 20;

/**
 * The quiet footer summary for the fixed local-day limit, in plain language:
 * "Applications today: 3 of 20 used · resets at midnight". Older records
 * whose start could not be verified are named only when any exist, so the
 * exact count never silently absorbs them. A missing capacity object stays
 * truthful by naming the safeguard maximum; an exhausted day says when more
 * room arrives instead of formatting a reset time.
 */
export function formatDailyPreparationCapacitySummaryText(
  capacity: GlobalDailyApplicationPreparationCapacity | null | undefined,
): string {
  if (!capacity) {
    return `Applications today: up to ${FALLBACK_DAILY_APPLICATION_PREPARATION_LIMIT} per day`;
  }

  const legacySuffix =
    capacity.legacyUncertain > 0
      ? ` (${capacity.legacyUncertain} older ${
          capacity.legacyUncertain === 1 ? "record" : "records"
        } may also count)`
      : "";
  const tail = isDailyPreparationCapacityExhausted(capacity)
    ? "more available after midnight"
    : "resets at midnight";
  return `Applications today: ${capacity.used} of ${capacity.limit} used${legacySuffix} · ${tail}`;
}

/**
 * Control-associated reason for a Queue control whose staged batch would pass
 * the day's remaining slots while slots still exist. Names the exact selected
 * count, the exact remaining slots, and the local reset timing so a disabled
 * control never reads like full exhaustion or the per-run batch cap.
 */
export function formatDailyPreparationBatchExceedsRemainingText(input: {
  capacity: GlobalDailyApplicationPreparationCapacity;
  selectedCount: number;
}): string {
  const { capacity } = input;
  const selectedCount = Math.max(0, input.selectedCount);
  return `You selected ${selectedCount} ${selectedCount === 1 ? "job" : "jobs"} for this run, but only ${capacity.remaining} of ${capacity.limit} daily application ${capacity.remaining === 1 ? "slot remains" : "slots remain"} today. Trim the selection to ${capacity.remaining} or fewer to prepare now, or prepare the rest after it resets at local midnight (${formatDailyPreparationResetTime(capacity.resetsAt)}).`;
}

/**
 * One sentence naming the exact usage ("20 of 20 used today") plus the local
 * reset timing, so a refused start never has to rely on a silent no-op.
 */
export function formatDailyPreparationCapacityReachedText(
  capacity: GlobalDailyApplicationPreparationCapacity,
): string {
  const legacySuffix =
    capacity.legacyUncertain > 0
      ? ` plus ${capacity.legacyUncertain} older ${
          capacity.legacyUncertain === 1 ? "record" : "records"
        } that may also have begun`
      : "";
  return `Today's application preparation limit is reached: ${capacity.used} of ${capacity.limit} used today${legacySuffix}. New preparations reset at local midnight (${formatDailyPreparationResetTime(capacity.resetsAt)}).`;
}
