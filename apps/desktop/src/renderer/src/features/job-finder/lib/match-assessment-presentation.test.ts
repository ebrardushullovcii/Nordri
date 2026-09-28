import { MatchAssessmentSchema, type SavedJob } from "@nordri/contracts";
import { describe, expect, it } from "vitest";

import {
  FIT_TITLE_ONLY_REASON,
  FIT_UNASSESSED_REASON,
  FIT_UPPER_BOUND_REASON,
  getFitEvidenceDepth,
  getMatchAssessmentPresentation,
  getRoleAndRequirementsStatus,
} from "./match-assessment-presentation";

type PresentationInput = Pick<SavedJob, "discoveryMethod" | "matchAssessment">;

const boundFingerprints = {
  contextFingerprint: "match_context_v4_candidate",
  postingFingerprint: "match_posting_v4_listing",
};

function titleOnlyJob(): PresentationInput {
  return {
    discoveryMethod: "browser_agent",
    matchAssessment: MatchAssessmentSchema.parse({
      score: 54,
      ...boundFingerprints,
    }),
  };
}

/**
 * The shape `createMatchAssessment` actually emits for a listing whose text
 * was never captured. The bare fixture above passed for months while this one
 * printed a bare percentage in the app: a saved-preference location
 * requirement existed but was never decided, and "mixed" preference alignment
 * was reached only because an absence placeholder had been read as a real
 * place. Both are counted as "not verified" now.
 */
function realEngineTitleOnlyJob(): PresentationInput {
  return {
    discoveryMethod: "browser_agent",
    matchAssessment: MatchAssessmentSchema.parse({
      score: 54,
      ...boundFingerprints,
      compensationFit: { state: "unknown" },
      dimensions: {
        roleSuitability: {
          state: "adjacent",
          explanation:
            "The title matches, but the listing text was not captured, so nothing beyond the title could be checked.",
        },
        preferenceAlignment: { state: "unknown" },
        evidenceConfidence: { level: "unavailable" },
      },
      requirements: [
        {
          id: "location_not_stated",
          category: "location",
          label: "Location (not stated in listing)",
          importance: "required",
          status: "unknown",
          jobEvidence: "The listing does not state a location.",
          resumeEvidence: [],
          explanation:
            "The listing does not state a location, so it could not be compared with the saved search areas.",
        },
      ],
    }),
  };
}

function checkedJob(): PresentationInput {
  return {
    discoveryMethod: "browser_agent",
    matchAssessment: MatchAssessmentSchema.parse({
      score: 78,
      ...boundFingerprints,
      dimensions: {
        roleSuitability: {
          state: "exact",
          explanation: "The listing title matches a saved target role.",
          evidence: [],
        },
      },
      requirements: [
        {
          id: "skill_figma",
          category: "skill",
          label: "Figma",
          importance: "required",
          status: "supported",
          jobEvidence: "Figma is used daily.",
          resumeEvidence: [],
          explanation: "The resume contains explicit Figma evidence.",
        },
      ],
    }),
  };
}

function unboundJob(): PresentationInput {
  return {
    discoveryMethod: "catalog_seed",
    matchAssessment: MatchAssessmentSchema.parse({ score: 70 }),
  };
}

describe("getFitEvidenceDepth", () => {
  it("reports title-only when nothing beyond the title was checkable", () => {
    expect(getFitEvidenceDepth(titleOnlyJob().matchAssessment)).toEqual({
      isTitleOnly: true,
      reason: FIT_TITLE_ONLY_REASON,
      verifiedDimensionCount: 0,
    });
  });

  it("counts an undecided saved-preference requirement as no evidence at all", () => {
    expect(
      getFitEvidenceDepth(realEngineTitleOnlyJob().matchAssessment),
    ).toEqual({
      isTitleOnly: true,
      reason: FIT_TITLE_ONLY_REASON,
      verifiedDimensionCount: 0,
    });
  });

  it("counts a decided role requirement as real evidence", () => {
    const job = realEngineTitleOnlyJob();
    expect(
      getFitEvidenceDepth({
        ...job.matchAssessment,
        requirements: [
          ...job.matchAssessment.requirements,
          {
            id: "skill_typescript",
            category: "skill",
            label: "TypeScript",
            importance: "required",
            status: "conflict",
            jobEvidence: "TypeScript is required.",
            resumeEvidence: [],
            explanation: "The resume shows no TypeScript evidence.",
          },
        ],
      }).isTitleOnly,
    ).toBe(false);
  });

  it("tolerates a partial payload instead of throwing", () => {
    expect(
      getFitEvidenceDepth({
        score: 40,
      } as unknown as PresentationInput["matchAssessment"]).isTitleOnly,
    ).toBe(true);
  });
});

describe("getMatchAssessmentPresentation", () => {
  it("withholds the percentage when only the listing title was checkable", () => {
    const presentation = getMatchAssessmentPresentation(titleOnlyJob());

    expect(presentation.isTitleOnly).toBe(true);
    expect(presentation.isScoreWithheld).toBe(true);
    expect(presentation.headlineScoreLabel).toBe("Title-only estimate");
    expect(presentation.headlineScoreLabel).not.toContain("54");
    expect(presentation.headlineScoreAriaLabel).toBe(
      "Overall fit: title-only estimate",
    );
    // The number is not destroyed: it stays inside the scoring breakdown,
    // beside the evidence it was derived from, with its own qualifier.
    expect(presentation.breakdownScoreLabel).toBe("Title-only estimate: 54%");
    expect(presentation.withheldReason).toBe(FIT_TITLE_ONLY_REASON);
  });

  it("names the row line and the inspector number as the same estimate", () => {
    // The panel found "Overall fit: title match only, not scored" on the row
    // above "Title-only estimate: 64%" in the inspector: one screen denying
    // the score the other screen printed.
    const presentation = getMatchAssessmentPresentation(titleOnlyJob());

    expect(presentation.headlineScoreAriaLabel).not.toContain("not scored");
    expect(presentation.breakdownScoreLabel).toContain(
      presentation.headlineScoreLabel,
    );
  });

  it("withholds the percentage for the real card-only engine output", () => {
    const presentation = getMatchAssessmentPresentation(
      realEngineTitleOnlyJob(),
    );

    expect(presentation.headlineScoreLabel).toBe("Title-only estimate");
    expect(presentation.headlineScoreLabel).not.toContain("54");
    expect(presentation.breakdownScoreLabel).toBe("Title-only estimate: 54%");
  });

  it("qualifies a score that stopped at a gap's ceiling", () => {
    // Unrelated jobs kept printing an identical "71% fit" because several
    // ceilings land on the same number; the ceiling is not a measurement.
    const presentation = getMatchAssessmentPresentation({
      ...checkedJob(),
      matchAssessment: MatchAssessmentSchema.parse({
        ...checkedJob().matchAssessment,
        score: 71,
        scoreIsUpperBound: true,
      }),
    });

    expect(presentation.isScoreWithheld).toBe(false);
    expect(presentation.headlineScoreLabel).toBe("Up to 71% fit");
    expect(presentation.headlineScoreAriaLabel).toBe(
      "Overall fit: up to 71 percent",
    );
    expect(presentation.breakdownScoreLabel).toBe("Up to 71% fit");
    expect(presentation.withheldReason).toBe(FIT_UPPER_BOUND_REASON);
  });

  it("withholds any number at all for an unbound assessment", () => {
    const presentation = getMatchAssessmentPresentation(unboundJob());

    expect(presentation.isProvisional).toBe(true);
    expect(presentation.headlineScoreLabel).toBe("Fit not assessed");
    expect(presentation.breakdownScoreLabel).toBeNull();
    expect(presentation.withheldReason).toBe(FIT_UNASSESSED_REASON);
  });

  it("prints the percentage once the evidence behind it was checked", () => {
    const presentation = getMatchAssessmentPresentation(checkedJob());

    expect(presentation.isScoreWithheld).toBe(false);
    expect(presentation.headlineScoreLabel).toBe("78% fit");
    expect(presentation.breakdownScoreLabel).toBe("78% fit");
    expect(presentation.withheldReason).toBeNull();
  });
});

describe("getRoleAndRequirementsStatus", () => {
  const requirement = (status: "supported" | "missing" | "partial") => ({
    status,
  });

  it("never says Strong match above evidence that does not support it", () => {
    // The line printed underneath reads "1 of 3 supported".
    expect(
      getRoleAndRequirementsStatus("exact", [
        requirement("supported"),
        requirement("missing"),
        requirement("partial"),
      ]),
    ).toEqual({ label: "Partial match", tone: "active" });
  });

  it("says the evidence is missing when nothing is supported", () => {
    expect(
      getRoleAndRequirementsStatus("exact", [
        requirement("missing"),
        requirement("missing"),
      ]),
    ).toEqual({ label: "Needs evidence", tone: "critical" });
  });

  it("keeps the title verdict when every requirement is supported", () => {
    expect(
      getRoleAndRequirementsStatus("exact", [
        requirement("supported"),
        requirement("supported"),
      ]),
    ).toEqual({ label: "Strong match", tone: "positive" });
  });

  it("keeps the title verdict when there is nothing to compare", () => {
    expect(getRoleAndRequirementsStatus("exact", [])).toEqual({
      label: "Strong match",
      tone: "positive",
    });
    expect(
      getRoleAndRequirementsStatus("conflict", [requirement("missing")]),
    ).toEqual({ label: "Role conflict", tone: "critical" });
  });
});
