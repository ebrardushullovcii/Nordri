import { expect, it } from "vitest";
import { formatDiscoveryAccounting } from "./base";

it("uses a singular page when one page was covered", () => {
  expect(
    formatDiscoveryAccounting({
      found: 1,
      unique: 1,
      new: 1,
      retained: 1,
      duplicates: 0,
      rejected: 0,
      deferred: 0,
      pagesCovered: 1,
    }),
  ).toContain("1 page covered");
});

it("shows only known counts in a first search's partial report", () => {
  expect(
    formatDiscoveryAccounting({
      found: 2,
      unique: 2,
      new: 2,
      retained: null,
      duplicates: 0,
      rejected: null,
      deferred: null,
      pagesCovered: null,
    }),
  ).toBe(
    "2 postings seen · 2 unique jobs · 2 new to you · 0 duplicates merged",
  );
});
