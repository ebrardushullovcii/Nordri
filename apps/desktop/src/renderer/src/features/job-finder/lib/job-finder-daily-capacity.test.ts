import type { GlobalDailyApplicationPreparationCapacity } from "@nordri/contracts";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_DAILY_APPLICATION_PREPARATION_LIMIT,
  formatDailyPreparationBatchExceedsRemainingText,
  formatDailyPreparationCapacityReachedText,
  formatDailyPreparationCapacitySummaryText,
  formatDailyPreparationResetTime,
  isDailyPreparationCapacityExhausted,
} from "./job-finder-daily-capacity";

function createCapacity(
  overrides: Partial<GlobalDailyApplicationPreparationCapacity> = {},
): GlobalDailyApplicationPreparationCapacity {
  return {
    limit: 20,
    used: 12,
    legacyUncertain: 0,
    remaining: 8,
    localDate: "2026-08-25",
    resetsAt: "2026-08-26T04:00:00.000Z",
    ...overrides,
  };
}

describe("isDailyPreparationCapacityExhausted", () => {
  it("treats a missing capacity object as not exhausted", () => {
    expect(isDailyPreparationCapacityExhausted(null)).toBe(false);
    expect(isDailyPreparationCapacityExhausted(undefined)).toBe(false);
  });

  it("is exhausted only when zero slots remain", () => {
    expect(isDailyPreparationCapacityExhausted(createCapacity())).toBe(false);
    expect(
      isDailyPreparationCapacityExhausted(
        createCapacity({ used: 20, remaining: 0 }),
      ),
    ).toBe(true);
  });
});

describe("formatDailyPreparationResetTime", () => {
  it("formats the reset timestamp as a local clock time without seconds", () => {
    const formatted = formatDailyPreparationResetTime(
      "2026-08-26T04:00:00.000Z",
    );

    expect(formatted).not.toMatch(/:\d{2}:\d{2}/u);
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("formatDailyPreparationCapacitySummaryText", () => {
  it("falls back to the safeguard maximum when no derived capacity exists", () => {
    expect(FALLBACK_DAILY_APPLICATION_PREPARATION_LIMIT).toBe(20);
    expect(formatDailyPreparationCapacitySummaryText(null)).toBe(
      "Applications today: up to 20 per day",
    );
  });

  it("names exact usage, the limit, and remaining slots with reset timing", () => {
    const text = formatDailyPreparationCapacitySummaryText(createCapacity());

    expect(text).toBe("Applications today: 12 of 20 used · resets at midnight");
    expect(text).not.toContain("exact begun");
    expect(text).not.toContain("available after midnight");
  });

  it("keeps legacy-uncertain records singular and plural", () => {
    const singular = formatDailyPreparationCapacitySummaryText(
      createCapacity({ used: 19, legacyUncertain: 1, remaining: 0 }),
    );
    expect(singular).toBe(
      "Applications today: 19 of 20 used (1 older record may also count) · more available after midnight",
    );

    const plural = formatDailyPreparationCapacitySummaryText(
      createCapacity({ used: 18, legacyUncertain: 2, remaining: 0 }),
    );
    expect(plural).toBe(
      "Applications today: 18 of 20 used (2 older records may also count) · more available after midnight",
    );
  });

  it("points an exhausted day at the next local-midnight availability instead of a reset time", () => {
    const text = formatDailyPreparationCapacitySummaryText(
      createCapacity({ used: 20, remaining: 0 }),
    );

    expect(text.endsWith("· more available after midnight")).toBe(true);
    expect(text).not.toContain("resets at midnight");
  });
});

describe("formatDailyPreparationBatchExceedsRemainingText", () => {
  it("states the selected count, remaining slots, and local reset timing", () => {
    const text = formatDailyPreparationBatchExceedsRemainingText({
      capacity: createCapacity(),
      selectedCount: 4,
    });

    expect(text).toContain("You selected 4 jobs for this run");
    expect(text).toContain("only 8 of 20 daily application slots remain");
    expect(text).toContain("Trim the selection to 8 or fewer");
    expect(text).toMatch(/resets at local midnight \(/u);
  });

  it("stays grammatical for singular counts", () => {
    const text = formatDailyPreparationBatchExceedsRemainingText({
      capacity: createCapacity({ remaining: 1 }),
      selectedCount: 1,
    });

    expect(text).toContain("You selected 1 job for this run");
    expect(text).toContain("only 1 of 20 daily application slot remains");
  });
});

describe("formatDailyPreparationCapacityReachedText", () => {
  it("keeps the refusal sentence with exact usage and reset timing", () => {
    const text = formatDailyPreparationCapacityReachedText(
      createCapacity({ used: 20, remaining: 0 }),
    );

    expect(text).toBe(
      "Today's application preparation limit is reached: 20 of 20 used today. New preparations reset at local midnight (" +
        formatDailyPreparationResetTime("2026-08-26T04:00:00.000Z") +
        ").",
    );
  });

  it("appends legacy-uncertain records singular and plural", () => {
    expect(
      formatDailyPreparationCapacityReachedText(
        createCapacity({ used: 20, legacyUncertain: 1, remaining: 0 }),
      ),
    ).toContain("plus 1 older record that may also have begun");

    expect(
      formatDailyPreparationCapacityReachedText(
        createCapacity({ used: 20, legacyUncertain: 3, remaining: 0 }),
      ),
    ).toContain("plus 3 older records that may also have begun");
  });
});
