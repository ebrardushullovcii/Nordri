import { AiBehaviorPreferenceSchema } from "@unemployed/contracts";
import { describe, expect, test } from "vitest";
import { createSeed } from "../workspace-service.test-fixtures";
import { withSavedJobSearchBehavior } from "./job-search-behavior";

function aiBehavior(remoteCountsAsAnyLocation: boolean) {
  return AiBehaviorPreferenceSchema.parse({
    jobSearch: { selectivity: "balanced", remoteCountsAsAnyLocation },
  });
}

describe("withSavedJobSearchBehavior", () => {
  test("writes only an explicit off into the search preferences", () => {
    const { searchPreferences } = createSeed();

    const unset = withSavedJobSearchBehavior(searchPreferences, {});
    const on = withSavedJobSearchBehavior(searchPreferences, {
      aiBehavior: aiBehavior(true),
    });
    const off = withSavedJobSearchBehavior(searchPreferences, {
      aiBehavior: aiBehavior(false),
    });

    expect("remoteCountsAsAnyLocation" in unset.discovery).toBe(false);
    expect(on).toEqual(unset);
    expect(off.discovery.remoteCountsAsAnyLocation).toBe(false);
    // Turning it back on clears a stale copy.
    expect(
      withSavedJobSearchBehavior(off, { aiBehavior: aiBehavior(true) }),
    ).toEqual(unset);
  });
});
