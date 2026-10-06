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
