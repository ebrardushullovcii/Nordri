import type { CandidateProfile, JobPosting } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { createSeed } from "../workspace-service.test-fixtures";
import {
  assessRemoteGeographyRequirement,
  assessSecurityClearanceRequirement,
  buildEligibilityRequirementAssessments,
} from "./matching-eligibility";

type PostingOverrides = Omit<Partial<JobPosting>, "screeningHints"> & {
  screeningHints?: Partial<JobPosting["screeningHints"]>;
};

type ProfileOverrides = Omit<Partial<CandidateProfile>, "workEligibility"> & {
  workEligibility?: Partial<CandidateProfile["workEligibility"]>;
};

function createPosting(overrides: PostingOverrides = {}): JobPosting {
  const base = createSeed().savedJobs[0]!;
  return {
    ...base,
    ...overrides,
    screeningHints: {
      ...base.screeningHints,
      ...overrides.screeningHints,
    },
  };
}

function createProfile(overrides: ProfileOverrides = {}): CandidateProfile {
  const base = createSeed().profile;
  return {
    ...base,
    ...overrides,
    workEligibility: {
      ...base.workEligibility,
      ...overrides.workEligibility,
    },
  };
}

function assessRemote(input: {
  profile?: ProfileOverrides;
  posting?: PostingOverrides;
}) {
  return assessRemoteGeographyRequirement({
    profile: createProfile(input.profile),
    posting: createPosting({
      location: "Remote",
      workMode: ["remote"],
      screeningHints: { remoteGeographies: [] },
      ...input.posting,
    }),
  });
}

function assessClearance(input: {
  savedClearance: string | null;
  description?: string;
  minimumQualifications?: string[];
  preferredQualifications?: string[];
  requiresSecurityClearance?: boolean | null;
}) {
  return assessSecurityClearanceRequirement({
    profile: createProfile({
      workEligibility: { securityClearance: input.savedClearance },
    }),
    posting: createPosting({
      workMode: ["hybrid"],
      description:
        input.description ?? "Active TS/SCI security clearance is required.",
      minimumQualifications: input.minimumQualifications ?? [],
      preferredQualifications: input.preferredQualifications ?? [],
      screeningHints: {
        requiresSecurityClearance:
          input.requiresSecurityClearance === undefined
            ? true
            : input.requiresSecurityClearance,
      },
    }),
  });
}

describe("remote-geography eligibility", () => {
  test("does not create a remote-geography requirement for non-remote work", () => {
    const requirement = assessRemoteGeographyRequirement({
      profile: createProfile(),
      posting: createPosting({
        location: "On-site - London, United Kingdom",
        workMode: ["onsite"],
        screeningHints: { remoteGeographies: ["EMEA"] },
      }),
    });

    expect(requirement).toBeNull();
  });

  test("keeps a remote role with no stated hiring geography unknown", () => {
    expect(assessRemote({})?.status).toBe("unknown");
  });

  test("supports worldwide, exact-country, and EMEA eligibility", () => {
    const worldwide = assessRemote({
      profile: {
        currentLocation: "Set your preferred location",
        currentCountry: null,
      },
      posting: { screeningHints: { remoteGeographies: ["Worldwide"] } },
    });
    const exactCountry = assessRemote({
      posting: {
        screeningHints: { remoteGeographies: ["United Kingdom"] },
      },
    });
    const emeaFromUnitedKingdom = assessRemote({
      posting: { screeningHints: { remoteGeographies: ["EMEA"] } },
    });
    const emeaFromKosovo = assessRemote({
      profile: {
        currentLocation: "Prishtina, Kosovo",
        currentCountry: "Kosovo",
      },
      posting: { screeningHints: { remoteGeographies: ["EMEA"] } },
    });

    expect(worldwide?.status).toBe("supported");
    expect(exactCountry?.status).toBe("supported");
    expect(emeaFromUnitedKingdom?.status).toBe("supported");
    expect(emeaFromKosovo?.status).toBe("supported");
  });

  test("does not treat bare Europe as proof for UK or other non-EU residents", () => {
    const unitedKingdom = assessRemote({
      posting: { screeningHints: { remoteGeographies: ["Europe"] } },
    });
    const kosovo = assessRemote({
      profile: {
        currentLocation: "Prishtina, Kosovo",
        currentCountry: "Kosovo",
      },
      posting: { screeningHints: { remoteGeographies: ["Europe"] } },
    });
    const germany = assessRemote({
      profile: {
        currentLocation: "Berlin, Germany",
        currentCountry: "Germany",
      },
      posting: { screeningHints: { remoteGeographies: ["Europe"] } },
    });

    expect(unitedKingdom?.status).toBe("unknown");
    expect(kosovo?.status).toBe("unknown");
    expect(germany?.status).toBe("supported");
  });

  test("treats explicit exclusions as conflicts unless relocation is confirmed", () => {
    const excluded = assessRemote({
      profile: { workEligibility: { willingToRelocate: false } },
      posting: {
        location: "Remote - European Union only (United Kingdom excluded)",
        screeningHints: {
          remoteGeographies: ["European Union excluding United Kingdom"],
        },
      },
    });
    const relocationConfirmed = assessRemote({
      profile: { workEligibility: { willingToRelocate: true } },
      posting: {
        location: "Remote - European Union only (United Kingdom excluded)",
        screeningHints: {
          remoteGeographies: ["European Union excluding United Kingdom"],
        },
      },
    });

    expect(excluded?.status).toBe("conflict");
    expect(relocationConfirmed?.status).toBe("unknown");
  });

  test.each(["United States", "APAC"])(
    "marks a disjoint %s hiring geography as a conflict",
    (remoteGeography) => {
      expect(
        assessRemote({
          profile: { workEligibility: { willingToRelocate: false } },
          posting: {
            screeningHints: { remoteGeographies: [remoteGeography] },
          },
        })?.status,
      ).toBe("conflict");
    },
  );

  test("keeps an unparsed alternative unknown instead of inferring a conflict", () => {
    expect(
      assessRemote({
        posting: {
          screeningHints: {
            remoteGeographies: ["United States or approved company hubs"],
          },
        },
      })?.status,
    ).toBe("unknown");
  });

  test("does not use work authorization alone as proof of current residence", () => {
    const requirement = assessRemote({
      profile: {
        currentLocation: "Set your preferred location",
        currentCountry: null,
        workEligibility: {
          authorizedWorkCountries: ["United States"],
        },
      },
      posting: {
        screeningHints: { remoteGeographies: ["United States"] },
      },
    });

    expect(requirement?.status).toBe("unknown");
    expect(requirement?.explanation).toContain(
      "authorization alone does not prove current residence",
    );
  });

  test.each([
    ["Portland, Oregon", "Oregon"],
    ["Portland, OR", "OR"],
  ])(
    "infers United States residence from a saved state name or postal code: %s",
    (currentLocation, currentRegion) => {
      const requirement = assessRemote({
        profile: {
          currentLocation,
          currentRegion,
          currentCountry: null,
          workEligibility: {
            authorizedWorkCountries: ["United States"],
            requiresVisaSponsorship: false,
            remoteEligible: true,
          },
        },
        posting: {
          location:
            "San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States",
          screeningHints: {
            remoteGeographies: ["United States", "Canada"],
          },
        },
      });

      expect(requirement).toMatchObject({
        label: "Remote geography eligibility",
        status: "supported",
      });
      expect(requirement?.explanation).toContain(
        "current country is explicitly inside",
      );
      expect(requirement?.resumeEvidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceKind: "profile",
            detail: currentLocation,
          }),
        ]),
      );
    },
  );

  test("keeps an ambiguous country-or-state name conservative", () => {
    const requirement = assessRemote({
      profile: {
        currentLocation: "Tbilisi, Georgia",
        currentRegion: "Georgia",
        currentCountry: null,
        workEligibility: {
          authorizedWorkCountries: ["United States"],
          remoteEligible: true,
        },
      },
      posting: {
        screeningHints: { remoteGeographies: ["United States"] },
      },
    });

    expect(requirement?.status).toBe("unknown");
  });
});

describe("security-clearance eligibility", () => {
  test("keeps a required active clearance unknown when the profile is silent", () => {
    expect(assessClearance({ savedClearance: null })).toMatchObject({
      label: "Security clearance",
      importance: "required",
      status: "unknown",
    });
  });

  test.each([
    "None",
    "Expired",
    "Inactive",
    "Revoked",
    "No active security clearance",
    "Secret security clearance expired",
    "Inactive TS/SCI security clearance",
    "Security clearance revoked",
  ])(
    "treats explicit negative clearance evidence as a conflict: %s",
    (value) => {
      expect(assessClearance({ savedClearance: value })?.status).toBe(
        "conflict",
      );
    },
  );

  test("supports an exact active named clearance", () => {
    expect(
      assessClearance({
        savedClearance: "Active TS/SCI security clearance",
      })?.status,
    ).toBe("supported");
  });

  test("supports an active named clearance when the listing is generic", () => {
    expect(
      assessClearance({
        savedClearance: "Current Secret clearance",
        description: "An active security clearance is required.",
      })?.status,
    ).toBe("supported");
  });

  test("keeps a different active clearance type unknown", () => {
    expect(
      assessClearance({
        savedClearance: "Active Secret clearance",
      })?.status,
    ).toBe("unknown");
  });

  test("keeps able-to-obtain language unknown", () => {
    expect(
      assessClearance({
        savedClearance: "Able to obtain a TS/SCI security clearance",
      })?.status,
    ).toBe("unknown");
  });

  test("does not treat an untyped active clearance as proof of a named type", () => {
    expect(
      assessClearance({
        savedClearance: "Active security clearance",
      })?.status,
    ).toBe("unknown");
  });

  test("does not create a required row for a preferred clearance", () => {
    expect(
      assessClearance({
        savedClearance: null,
        description: "Security clearance preferred.",
        preferredQualifications: ["Active security clearance is preferred."],
      }),
    ).toBeNull();
  });

  test("builds both independent eligibility rows when both are applicable", () => {
    const profile = createProfile({
      workEligibility: { securityClearance: null },
    });
    const posting = createPosting({
      location: "Remote - EMEA",
      workMode: ["remote"],
      description: "An active security clearance is required.",
      screeningHints: {
        remoteGeographies: ["EMEA"],
        requiresSecurityClearance: true,
      },
    });

    expect(
      buildEligibilityRequirementAssessments({ profile, posting }).map(
        (requirement) => [requirement.label, requirement.status],
      ),
    ).toEqual([
      ["Remote geography eligibility", "supported"],
      ["Security clearance", "unknown"],
    ]);
  });
});
