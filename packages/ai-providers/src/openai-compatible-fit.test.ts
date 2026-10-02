import { describe, expect, test } from "vitest";

import { normalizeJobFitJudgments } from "./openai-compatible-fit";

describe("batch fit judging", () => {
  test("keeps the model's verdict as returned", () => {
    const [judgment] = normalizeJobFitJudgments(
      {
        judgments: [
          {
            jobId: "job_1",
            score: 81.6,
            recommendation: "strong_fit",
            role: "exact",
            roleExplanation:
              "This is the product design work you are looking for.",
            preferences: "aligned",
            locationReach: "in_area",
            reasons: ["Berlin, Germany is one of your places"],
            gaps: ["German C1 is required"],
          },
        ],
      },
      new Set(["job_1"]),
    );

    expect(judgment).toEqual({
      jobId: "job_1",
      score: 82,
      recommendation: "strong_fit",
      role: "exact",
      roleExplanation: "This is the product design work you are looking for.",
      preferences: "aligned",
      preferencesExplanation: null,
      locationReach: "in_area",
      reasons: ["Berlin, Germany is one of your places"],
      gaps: ["German C1 is required"],
    });
  });

  test("drops entries for jobs it was not asked about or without a verdict", () => {
    const judgments = normalizeJobFitJudgments(
      {
        judgments: [
          { jobId: "job_other", score: 70, recommendation: "skip" },
          { jobId: "job_1", score: 70 },
          { jobId: "job_2", score: "64", recommendation: "skip", role: "x" },
          { jobId: "job_2", score: 99, recommendation: "strong_fit" },
        ],
      },
      new Set(["job_1", "job_2"]),
    );

    expect(judgments).toEqual([
      expect.objectContaining({ jobId: "job_2", score: 64, role: "unknown" }),
    ]);
  });

  test("reads a malformed answer as no verdicts", () => {
    expect(normalizeJobFitJudgments({ jobs: [] }, new Set(["job_1"]))).toEqual(
      [],
    );
    expect(normalizeJobFitJudgments(null, new Set(["job_1"]))).toEqual([]);
  });
});
