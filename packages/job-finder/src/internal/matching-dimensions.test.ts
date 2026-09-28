import type { JobRequirementAssessment } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { createSeed } from "../workspace-service.test-fixtures";
import {
  type BuildMatchDimensionsAssessmentInput,
  buildMatchDimensionsAssessment,
} from "./matching-dimensions";

function createRequirement(
  status: JobRequirementAssessment["status"],
  index: number,
): JobRequirementAssessment {
  return {
    id: `requirement_${index}`,
    category: "skill",
    label: `Requirement ${index}`,
    importance: "required",
    status,
    jobEvidence: `Listing evidence ${index}`,
    resumeEvidence: [],
    explanation: `Evidence explanation ${index}`,
  };
}

function createInput(
  overrides: Partial<BuildMatchDimensionsAssessmentInput> = {},
): BuildMatchDimensionsAssessmentInput {
  const seed = createSeed();
  return {
    posting: {
      ...seed.savedJobs[0]!,
      detailQuality: "detail_enriched",
    },
    searchPreferences: seed.searchPreferences,
    requirements: [
      createRequirement("supported", 1),
      createRequirement("supported", 2),
    ],
    matchesRole: true,
    roleFamilyMismatch: false,
    roleFamilyUnclear: false,
    locationCompatibility: "compatible",
    workModeCompatibility: "compatible",
    isPreferredCompany: true,
    ...overrides,
  };
}

describe("match dimensions", () => {
  test("explains exact role, aligned preferences, low effort, and supportability confidence", () => {
    const dimensions = buildMatchDimensionsAssessment(createInput());

    expect(dimensions.roleSuitability).toMatchObject({
      state: "exact",
      evidence: [
        { source: "listing", label: "Listing title" },
        { source: "preference", label: "Saved target roles" },
      ],
    });
    expect(dimensions.preferenceAlignment.state).toBe("aligned");
    expect(dimensions.applicationEffort.level).toBe("low");
    expect(dimensions.evidenceConfidence).toMatchObject({
      level: "high",
      supportedCount: 2,
      missingCount: 0,
      unknownCount: 0,
    });
  });

  test("treats explicit negative evidence as supportable rather than low-confidence", () => {
    const dimensions = buildMatchDimensionsAssessment(
      createInput({
        requirements: [
          createRequirement("missing", 1),
          createRequirement("conflict", 2),
        ],
      }),
    );

    expect(dimensions.evidenceConfidence).toMatchObject({
      level: "high",
      missingCount: 1,
      conflictCount: 1,
      unknownCount: 0,
    });
    expect(dimensions.evidenceConfidence.explanation).toContain(
      "still counts against the fit",
    );
  });

  test("downgrades a matching title without supported required core evidence", () => {
    for (const status of ["missing", "partial", "unknown"] as const) {
      const dimensions = buildMatchDimensionsAssessment(
        createInput({ requirements: [createRequirement(status, 1)] }),
      );
      expect(dimensions.roleSuitability.state).toBe("adjacent");
      const requirementEvidence = dimensions.roleSuitability.evidence.find(
        (entry) => entry.label === "Required: Requirement 1",
      );
      expect(requirementEvidence?.source).toBe("listing");
      expect(requirementEvidence?.detail).toContain(status);
    }

    const cardOnlyWithoutRequirements = buildMatchDimensionsAssessment(
      createInput({
        posting: {
          ...createInput().posting,
          detailQuality: "card_only",
        },
        requirements: [],
      }),
    );

    expect(cardOnlyWithoutRequirements.roleSuitability.state).toBe("adjacent");
  });

  test("credits a captured listing body even when no requirement row can be structured", () => {
    const dimensions = buildMatchDimensionsAssessment(
      createInput({ requirements: [] }),
    );

    expect(dimensions.evidenceConfidence).toMatchObject({
      level: "moderate",
      supportedCount: 0,
      unknownCount: 0,
    });
    expect(dimensions.evidenceConfidence.explanation).toContain(
      "listing body was read",
    );
  });

  test("turns an explicit required work-authorization conflict into a role conflict", () => {
    const requirement = {
      ...createRequirement("conflict", 1),
      category: "work_authorization" as const,
    };
    const dimensions = buildMatchDimensionsAssessment(
      createInput({ requirements: [requirement] }),
    );

    expect(dimensions.roleSuitability.state).toBe("conflict");
    const requirementEvidence = dimensions.roleSuitability.evidence.find(
      (entry) => entry.label === "Required: Requirement 1",
    );
    expect(requirementEvidence?.source).toBe("listing");
    expect(requirementEvidence?.detail).toContain("conflict");
  });

  test("does not let supported eligibility evidence certify an exact role fit", () => {
    const requirement = {
      ...createRequirement("supported", 1),
      category: "work_authorization" as const,
    };
    const dimensions = buildMatchDimensionsAssessment(
      createInput({ requirements: [requirement] }),
    );

    expect(dimensions.roleSuitability).toMatchObject({
      state: "adjacent",
    });
  });

  test("separates role conflict from mixed preference alignment", () => {
    const dimensions = buildMatchDimensionsAssessment(
      createInput({
        matchesRole: false,
        roleFamilyMismatch: true,
        locationCompatibility: "compatible",
        workModeCompatibility: "conflict",
        isPreferredCompany: false,
      }),
    );

    expect(dimensions.roleSuitability.state).toBe("conflict");
    expect(dimensions.preferenceAlignment.state).toBe("mixed");
  });

  test("keeps a non-preferred company neutral when it is the only saved preference", () => {
    const base = createInput();
    const dimensions = buildMatchDimensionsAssessment({
      ...base,
      searchPreferences: {
        ...base.searchPreferences,
        locations: [],
        workModes: [],
        seniorityLevels: [],
        employmentTypes: [],
        companyWhitelist: ["Preferred Co"],
      },
      locationCompatibility: "compatible",
      workModeCompatibility: "compatible",
      isPreferredCompany: false,
    });

    expect(dimensions.preferenceAlignment.state).toBe("unknown");
    expect(dimensions.preferenceAlignment.explanation).toContain("neutral");
  });

  test("evaluates saved seniority and employment type only when listing fields are present", () => {
    const base = createInput();
    const searchPreferences = {
      ...base.searchPreferences,
      locations: [],
      workModes: [],
      companyWhitelist: [],
      seniorityLevels: ["senior"],
      employmentTypes: ["full-time"],
    };
    const aligned = buildMatchDimensionsAssessment({
      ...base,
      searchPreferences,
      posting: {
        ...base.posting,
        seniority: "Senior",
        employmentType: "Full-time",
      },
    });
    const conflict = buildMatchDimensionsAssessment({
      ...base,
      searchPreferences,
      posting: {
        ...base.posting,
        seniority: "Junior",
        employmentType: "Contract",
      },
    });
    const unknown = buildMatchDimensionsAssessment({
      ...base,
      searchPreferences,
      posting: {
        ...base.posting,
        seniority: null,
        employmentType: null,
      },
    });

    expect(aligned.preferenceAlignment.state).toBe("aligned");
    expect(conflict.preferenceAlignment.state).toBe("conflict");
    expect(unknown.preferenceAlignment.state).toBe("unknown");
    expect(unknown.preferenceAlignment.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Seniority comparison" }),
        expect.objectContaining({ label: "Employment-type comparison" }),
      ]),
    );
  });

  test("keeps unspecified listing geography unknown instead of aligned or conflicting", () => {
    const base = createInput();
    const dimensions = buildMatchDimensionsAssessment({
      ...base,
      locationCompatibility: "unknown",
      searchPreferences: {
        ...base.searchPreferences,
        workModes: [],
        companyWhitelist: [],
        seniorityLevels: [],
        employmentTypes: [],
      },
      posting: {
        ...base.posting,
        location: "Remote",
      },
    });

    expect(dimensions.preferenceAlignment.state).toBe("unknown");
    expect(dimensions.preferenceAlignment.evidence).toHaveLength(1);
    const locationEvidence = dimensions.preferenceAlignment.evidence[0];
    expect(locationEvidence?.label).toBe("Location comparison");
    expect(locationEvidence?.detail).toMatch(
      /does not specify enough geography/i,
    );
    expect(locationEvidence?.detail).not.toMatch(
      /aligned|outside the saved areas/i,
    );
  });

  test("explains a remote listing through the remote work-mode preference instead of the saved city", () => {
    const base = createInput();
    const dimensions = buildMatchDimensionsAssessment({
      ...base,
      locationCompatibility: "compatible",
      locationRemotePreferenceApplied: true,
      searchPreferences: {
        ...base.searchPreferences,
        locations: ["Austin, TX"],
        workModes: ["remote"],
      },
      posting: {
        ...base.posting,
        location: "Remote (Chicago, IL)",
        workMode: ["remote"],
      },
    });

    const locationEvidence = dimensions.preferenceAlignment.evidence.find(
      (evidence) => evidence.label === "Location comparison",
    );
    expect(locationEvidence?.detail).toBe(
      "Remote listing; remote is one of your preferred work modes.",
    );
    expect(locationEvidence?.detail).not.toMatch(/outside the saved areas/);
  });

  test("uses Easy Apply only for effort and recognizes redirect and consent checkpoints", () => {
    const base = createInput();
    const low = buildMatchDimensionsAssessment(base);
    const moderate = buildMatchDimensionsAssessment({
      ...base,
      posting: {
        ...base.posting,
        applyPath: "external_redirect",
        easyApplyEligible: false,
      },
    });
    const high = buildMatchDimensionsAssessment({
      ...base,
      posting: {
        ...base.posting,
        screeningHints: {
          ...base.posting.screeningHints,
          requiresConsentInterrupt: true,
          requiresConsentInterruptKind: "signup",
        },
      },
    });
    const unknown = buildMatchDimensionsAssessment({
      ...base,
      posting: {
        ...base.posting,
        applyPath: "unknown",
        easyApplyEligible: false,
      },
    });
    const inconsistentEasy = buildMatchDimensionsAssessment({
      ...base,
      posting: {
        ...base.posting,
        applyPath: "easy_apply",
        easyApplyEligible: false,
      },
    });
    const inconsistentUnknown = buildMatchDimensionsAssessment({
      ...base,
      posting: {
        ...base.posting,
        applyPath: "unknown",
        easyApplyEligible: true,
      },
    });

    expect(low.applicationEffort.level).toBe("low");
    expect(moderate.applicationEffort.level).toBe("moderate");
    expect(high.applicationEffort.level).toBe("high");
    expect(unknown.applicationEffort.level).toBe("unknown");
    expect(inconsistentEasy.applicationEffort.level).toBe("unknown");
    expect(inconsistentUnknown.applicationEffort.level).toBe("unknown");
  });

  test("defaults confidence to unavailable when card-only detail has no extracted requirements", () => {
    const base = createInput();
    const dimensions = buildMatchDimensionsAssessment({
      ...base,
      posting: { ...base.posting, detailQuality: "card_only" },
      requirements: [],
    });

    expect(dimensions.evidenceConfidence).toMatchObject({
      level: "unavailable",
      supportedCount: 0,
      partialCount: 0,
      missingCount: 0,
      unknownCount: 0,
      conflictCount: 0,
    });
  });
});
