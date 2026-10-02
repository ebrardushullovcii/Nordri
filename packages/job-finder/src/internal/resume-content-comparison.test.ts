import { describe, expect, test } from "vitest";
import {
  resumeFactIsCovered,
  resumeSentences,
} from "./resume-content-comparison";

describe("resume content comparison", () => {
  test("splits sentences without changing their wording", () => {
    expect(
      resumeSentences("Led 3 teams. Built dashboards for finance leads"),
    ).toEqual(["Led 3 teams.", "Built dashboards for finance leads"]);
  });

  test("treats a reworded achievement with the same facts as covered", () => {
    expect(
      resumeFactIsCovered(
        "Redesigned onboarding for a pensions app; activation up 23% in eight weeks.",
        [
          "Redesigned pension-app onboarding, lifting activation 23% in eight weeks.",
        ],
      ),
    ).toBe(true);
  });

  test("a changed number is a different fact", () => {
    expect(
      resumeFactIsCovered("Cut dispatch time from 28 to 9 hours.", [
        "Cut dispatch time from 28 to 6 hours.",
      ]),
    ).toBe(false);
  });
});
