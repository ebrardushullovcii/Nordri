import { describe, expect, it } from "vitest";

import { describeChangedFields } from "./assistant-message-parts";

describe("the one-line summary on an assistant change card", () => {
  it("names an added or removed record instead of calling it changed", () => {
    expect(
      describeChangedFields(["Added Education: Example College of Art"]),
    ).toBe("Added Education: Example College of Art");
    expect(
      describeChangedFields([
        "Headline",
        "Location",
        "Removed Experience: Example Co",
      ]),
    ).toBe("Changed Headline, Location · Removed Experience: Example Co");
  });

  it("keeps edited values under Changed and counts the rest", () => {
    expect(
      describeChangedFields(["A", "B", "C", "D", "E", "F", "G", "H"]),
    ).toBe("Changed A, B, C, D, E, F and 2 more");
  });
});
