import { describe, expect, test, vi } from "vitest";
import { createSeed } from "../workspace-service.test-fixtures";
import { assessLocationCompatibility, createMatchAssessment } from "./matching";
import { canonicalizeLocationAliases } from "./location-normalization";
import { createMatchAssessmentSession } from "./match-assessment-session";
import { applyDiscoveryTitleTriage } from "./workspace-source-intelligence";

describe("US country aliases in saved search places", () => {
  test.each(["USA", "US", "U.S.", "U.S.A.", "United States of America"])(
    "%s matches United States in either direction with either remote setting",
    (alias) => {
      for (const remoteCountsAsAnyLocation of [true, false]) {
        const options = { remoteCountsAsAnyLocation };
        expect(
          assessLocationCompatibility(alias, ["United States"], options),
        ).toBe("compatible");
        expect(
          assessLocationCompatibility("United States", [alias], options),
        ).toBe("compatible");
        expect(
          assessLocationCompatibility(
            `Remote, ${alias}`,
            ["United States"],
            options,
          ),
        ).toBe("compatible");
        for (const foreign of ["Canada", "United Kingdom"]) {
          expect(assessLocationCompatibility(alias, [foreign], options)).toBe(
            "incompatible",
          );
        }
      }
    },
  );

  test("country normalization does not merge foreign places or distinct cities", () => {
    expect(canonicalizeLocationAliases("Austria")).toBe("Austria");
    expect(canonicalizeLocationAliases("Austin, TX")).toBe("Austin, Texas");
    expect(
      assessLocationCompatibility("Austin, TX, USA", ["Chicago, IL"]),
    ).toBe("incompatible");
    expect(
      assessLocationCompatibility("USA", ["Chicago, IL"], {
        remoteCountsAsAnyLocation: false,
      }),
    ).toBe("incompatible");
  });

  test("strict nontechnical discovery keeps a US support job against United States", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Customer Support Specialist"],
      locations: ["United States"],
      workModes: [],
      companyWhitelist: [],
      companyBlacklist: [],
      excludedLocations: [],
      discovery: {
        ...seed.searchPreferences.discovery,
        collectOnlyHardCriteriaMatches: true,
        remoteCountsAsAnyLocation: true,
      },
    };
    const posting = {
      ...seed.savedJobs[0]!,
      title: "Customer Support Specialist",
      location: "USA",
      workMode: ["remote" as const],
      description:
        "Provide chat support and resolve customer account questions.",
    };
    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences: preferences,
      }).outcome,
    ).toBe("pass");
    const calculate = vi.fn(createMatchAssessment);
    const session = createMatchAssessmentSession({
      profile: seed.profile,
      searchPreferences: preferences,
      calculate,
    });
    const current = session.assess(posting);
    const stale = {
      ...current,
      scorerVersion: 11,
      contextFingerprint: current.contextFingerprint!.replace(
        "logic13",
        "logic10",
      ),
      postingFingerprint: current.postingFingerprint!.replace(
        "logic13",
        "logic10",
      ),
      score: 40,
    };
    const resumed = createMatchAssessmentSession({
      profile: seed.profile,
      searchPreferences: preferences,
      calculate,
    });
    const refreshed = resumed.assessPersisted(posting, stale);
    expect(refreshed).not.toBe(stale);
    expect(refreshed.scorerVersion).toBe(14);
    expect(refreshed.dimensions.preferenceAlignment.state).not.toBe("conflict");
    expect(calculate).toHaveBeenCalledTimes(2);
  });
});
