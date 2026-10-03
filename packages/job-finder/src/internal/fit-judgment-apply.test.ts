import { FitJudgmentSchema, MatchAssessmentSchema } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { applyFitJudgment } from "./fit-judgment-apply";

const at = "2026-10-03T10:00:00.000Z";

function judgment(overrides: Record<string, unknown>) {
  return FitJudgmentSchema.parse({
    source: "batch",
    judgedAt: at,
    score: 40,
    recommendation: "skip",
    role: "exact",
    roleExplanation: "This is the Product Designer work you are looking for.",
    preferences: "conflict",
    locationReach: "outside_area",
    ...overrides,
  });
}

describe("a verdict on a job card (ADR 0041)", () => {
  test("says the model's own reason for its recommendation", () => {
    const applied = applyFitJudgment(
      MatchAssessmentSchema.parse({ score: 0, reasons: [], gaps: [] }),
      judgment({
        summary: "Austin is outside the places you are looking in.",
      }),
    );

    expect(applied.recommendationRationale).toBe(
      "Austin is outside the places you are looking in.",
    );
  });

  test("a verdict saved before the model gave a reason keeps the old wording", () => {
    const applied = applyFitJudgment(
      MatchAssessmentSchema.parse({ score: 0, reasons: [], gaps: [] }),
      judgment({ gaps: ["Needs presence in Austin, Texas."] }),
    );

    expect(applied.recommendationRationale).toBe(
      "Needs presence in Austin, Texas.",
    );
  });
});
