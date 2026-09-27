import { describe, expect, test } from "vitest";
import { JobSearchPreferencesSchema } from "@unemployed/contracts";

import {
  assessLocationCompatibility,
  assessPostingLocationCompatibility,
  createMatchAssessment,
  buildDiscoveryJobs,
  enrichDiscoveredPosting,
  getBroadLocationCompatibility,
  matchesAnyPhrase,
  matchesExcludedLocation,
  matchesLocationPreference,
  matchesTitlePreference,
  resolveMatchLocationReach,
  type LocationCompatibilityState,
} from "./matching";
import {
  TITLE_MATCHES_TARGET_ROLES_REASON,
  TITLE_MISSES_TARGET_ROLES_GAPS,
} from "../discovery-ordering";
import { MATCH_ASSESSMENT_SCORER_VERSION } from "./match-assessment-session";
import { createSeed } from "../workspace-service.test-fixtures";
import { selectDiscoveryBudgetPostings } from "./workspace-discovery-methods";

describe("matching helpers", () => {
  test("orders equal-score discovery jobs by detail quality and recency", () => {
    const seed = createSeed();
    const base = seed.savedJobs[0]!;
    const jobs = buildDiscoveryJobs([
      {
        ...base,
        id: "older_enriched",
        sourceJobId: "older_enriched",
        detailQuality: "detail_enriched",
        postedAt: "2026-01-01T00:00:00.000Z",
        matchAssessment: {
          ...base.matchAssessment,
          score: 80,
          recommendation: "strong_fit",
        },
      },
      {
        ...base,
        id: "newer_enriched",
        sourceJobId: "newer_enriched",
        detailQuality: "detail_enriched",
        postedAt: "2026-02-01T00:00:00.000Z",
        matchAssessment: {
          ...base.matchAssessment,
          score: 80,
          recommendation: "strong_fit",
        },
      },
      {
        ...base,
        id: "newer_card",
        sourceJobId: "newer_card",
        detailQuality: "card_only",
        postedAt: "2026-03-01T00:00:00.000Z",
        matchAssessment: {
          ...base.matchAssessment,
          score: 80,
          recommendation: "strong_fit",
        },
      },
      {
        ...base,
        id: "review_first",
        sourceJobId: "review_first",
        detailQuality: "detail_enriched",
        postedAt: "2026-04-01T00:00:00.000Z",
        matchAssessment: {
          ...base.matchAssessment,
          score: 80,
          recommendation: "review_before_applying",
        },
      },
    ]);

    expect(jobs.map((job) => job.id)).toEqual([
      "review_first",
      "newer_card",
      "newer_enriched",
      "older_enriched",
    ]);
  });

  test("orders a lower-scoring strong fit ahead of a higher-scoring skip", () => {
    const seed = createSeed();
    const base = seed.savedJobs[0]!;
    const jobs = buildDiscoveryJobs([
      {
        ...base,
        id: "hard_skip_94",
        sourceJobId: "hard_skip_94",
        matchAssessment: {
          ...base.matchAssessment,
          score: 94,
          recommendation: "skip",
        },
      },
      {
        ...base,
        id: "strong_fit_86",
        sourceJobId: "strong_fit_86",
        matchAssessment: {
          ...base.matchAssessment,
          score: 86,
          recommendation: "strong_fit",
        },
      },
    ]);

    expect(jobs.map((job) => job.id)).toEqual([
      "strong_fit_86",
      "hard_skip_94",
    ]);
  });

  test("does not let a preferred hard skip consume a constrained discovery budget", () => {
    const seed = createSeed();
    const preferredSkipUrl = "https://example.com/jobs/preferred-skip";
    const strongFitUrl = "https://example.com/jobs/strong-fit";
    const selected = selectDiscoveryBudgetPostings({
      postings: [
        {
          ...seed.savedJobs[0]!,
          sourceJobId: "preferred_skip_94",
          canonicalUrl: preferredSkipUrl,
        },
        {
          ...seed.savedJobs[0]!,
          sourceJobId: "strong_fit_86",
          canonicalUrl: strongFitUrl,
        },
      ],
      profile: seed.profile,
      searchPreferences: seed.searchPreferences,
      preferredCanonicalUrls: [preferredSkipUrl],
      assessPosting: (posting) => ({
        ...seed.savedJobs[0]!.matchAssessment,
        score: posting.sourceJobId === "preferred_skip_94" ? 94 : 86,
        recommendation:
          posting.sourceJobId === "preferred_skip_94" ? "skip" : "strong_fit",
      }),
      limit: 1,
    });

    expect(selected.map((posting) => posting.sourceJobId)).toEqual([
      "strong_fit_86",
    ]);
  });

  test("uses a limited source budget for distinct role options instead of duplicate titles", () => {
    const seed = createSeed();
    const basePosting = seed.savedJobs[0]!;
    const postings = [
      {
        ...basePosting,
        sourceJobId: "duplicate_a",
        canonicalUrl: "https://example.com/jobs/duplicate-a",
        title: "Senior Software Engineer",
        company: "Example Co",
      },
      {
        ...basePosting,
        sourceJobId: "duplicate_b",
        canonicalUrl: "https://example.com/jobs/duplicate-b",
        title: "Senior Software Engineer",
        company: "Example Co",
      },
      {
        ...basePosting,
        sourceJobId: "distinct_frontend",
        canonicalUrl: "https://example.com/jobs/frontend",
        title: "Senior Frontend Engineer",
        company: "Example Co",
      },
    ];

    const selected = selectDiscoveryBudgetPostings({
      postings,
      profile: seed.profile,
      searchPreferences: {
        ...seed.searchPreferences,
        targetRoles: ["Senior Software Engineer", "Senior Frontend Engineer"],
      },
      limit: 3,
    });

    expect(selected.map((posting) => posting.sourceJobId)).toEqual([
      "duplicate_a",
      "distinct_frontend",
    ]);
  });

  test("keeps an exact configured job ahead of a higher-scoring duplicate title", () => {
    const seed = createSeed();
    const exactUrl = "https://example.com/jobs/exact";
    const selected = selectDiscoveryBudgetPostings({
      postings: [
        {
          ...seed.savedJobs[0]!,
          sourceJobId: "higher_score_duplicate",
          canonicalUrl: "https://example.com/jobs/higher-score",
          title: "Senior Software Engineer",
          company: "Example Co",
          keySkills: ["TypeScript", "React"],
        },
        {
          ...seed.savedJobs[0]!,
          sourceJobId: "exact_duplicate",
          canonicalUrl: exactUrl,
          title: "Senior Software Engineer",
          company: "Example Co",
          keySkills: [],
          description: "Software engineering role.",
        },
      ],
      profile: seed.profile,
      searchPreferences: seed.searchPreferences,
      preferredCanonicalUrls: [`${exactUrl}#details`],
      limit: 1,
    });

    expect(selected[0]?.sourceJobId).toBe("exact_duplicate");
  });

  test("keeps the generic phrase matcher strict for whole-token matches", () => {
    expect(matchesAnyPhrase("Senior Java Engineer", ["java"])).toBe(true);
    expect(matchesAnyPhrase("Senior JavaScript Engineer", ["java"])).toBe(
      false,
    );
  });

  test("matches common full-stack role variants for discovery triage", () => {
    expect(
      matchesTitlePreference("Senior Full Stack Engineer (Typescript)", [
        "Senior Full-Stack Software Engineer",
      ]),
    ).toBe(true);
    expect(
      matchesTitlePreference("Full Stack Developer (AI-First)", [
        "Senior Full-Stack Software Engineer",
      ]),
    ).toBe(true);
    expect(
      matchesTitlePreference("Senior Frontend Engineer", [
        "Senior Full-Stack Software Engineer",
      ]),
    ).toBe(false);
    expect(
      matchesTitlePreference("Senior Data Engineer", [
        "Senior Software Engineer",
      ]),
    ).toBe(false);
  });

  describe("a shared head noun is not the role the person asked for", () => {
    const assessTitle = (title: string) => {
      const seed = createSeed();
      return createMatchAssessment(
        seed.profile,
        {
          ...seed.searchPreferences,
          targetRoles: ["Marketing Manager"],
          locations: [],
          workModes: [],
          minimumSalaryUsd: null,
          companyWhitelist: [],
        },
        {
          ...seed.savedJobs[0]!,
          title,
          description: "",
          keySkills: [],
          keywordSignals: [],
          easyApplyEligible: false,
        },
      );
    };

    test.each([
      "Manager Credit Risk",
      "Manager, Business Development, Strategic Partnerships & Affiliates",
      "Manager, Financial Reporting",
      "Managing Advisory Consultant - ServiceNow Integration Solution Architect",
      "Product Owner, Workday ERP",
      "Sales Supervisor",
    ])("does not call %s a match for Marketing Manager", (title) => {
      const assessment = assessTitle(title);

      expect(assessment.reasons).not.toContain(
        TITLE_MATCHES_TARGET_ROLES_REASON,
      );
      expect(assessment.gaps).toContain(TITLE_MISSES_TARGET_ROLES_GAPS[1]!);
      // Weaker, never a clear mismatch: nothing here conflicts with the
      // saved roles, the title simply is not the one asked for.
      expect(assessment.gaps).not.toContain(TITLE_MISSES_TARGET_ROLES_GAPS[0]!);
    });

    test("still calls a lifecycle marketing title the role that was asked for", () => {
      const assessment = assessTitle("Senior Lifecycle Marketing Manager");

      expect(assessment.reasons).toContain(TITLE_MATCHES_TARGET_ROLES_REASON);
      expect(assessment.gaps).not.toContain(TITLE_MISSES_TARGET_ROLES_GAPS[1]!);
    });
  });

  test("ranks an adjacent generic developer title below an explicit target role", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: [],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      easyApplyEligible: false,
      description: "Build web products with TypeScript and React.",
      keySkills: [],
      keywordSignals: [],
    };

    const exact = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Senior Software Engineer",
    });
    const adjacent = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Website Developer",
    });

    expect(adjacent.score).toBeLessThan(exact.score);
    expect(adjacent.gaps).toContain(
      "Role title is adjacent to the target list but not an exact fit.",
    );
  });

  test("marks a score that stopped at a gap's ceiling as an upper bound", () => {
    // Unrelated listings kept printing the same number because several gaps
    // impose the same ceiling. The number is the most the listing can earn,
    // not a measurement, and the assessment now says so.
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: [],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      easyApplyEligible: false,
      description: "Build web products with TypeScript and React.",
      keySkills: [],
      keywordSignals: [],
    };

    const capped = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Senior Software Engineer",
    });

    expect(capped.scoreIsUpperBound).toBe(true);
  });

  test("keeps unrelated role families out of a candidate's high-confidence matches", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Frontend Engineer"],
      locations: [],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      description:
        "Partner across teams and deliver measurable business outcomes.",
      keySkills: [],
      keywordSignals: [],
    };

    const peopleRole = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Senior Total Rewards Partner",
    });
    const dataRole = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Senior Data Engineer",
    });
    const productRole = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      title: "Product Manager, Billing Platform",
    });
    const adjacentEngineeringRole = createMatchAssessment(
      seed.profile,
      preferences,
      {
        ...basePosting,
        title: "Senior Forward Deployed Engineer",
      },
    );

    expect(peopleRole.score).toBeLessThanOrEqual(46);
    expect(dataRole.score).toBeLessThanOrEqual(46);
    expect(productRole.score).toBeLessThanOrEqual(39);
    expect(productRole.recommendation).toBe("skip");
    expect(productRole.gaps).toContain(
      "Role family is outside the current target roles, so this is unlikely to be a useful match.",
    );
    expect(adjacentEngineeringRole.score).toBeGreaterThan(peopleRole.score);
    expect(peopleRole.gaps).toContain(
      "Role family is outside the current target roles, so this is unlikely to be a useful match.",
    );
  });

  test("hides common live-board occupational mismatches from frontend candidates", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: [
        "Senior Frontend Engineer",
        "Frontend Engineer",
        "Software Engineer",
      ],
      locations: ["Remote", "United States"],
      workModes: ["remote" as const],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      company: "Example employer",
      location: "Remote - United States",
      workMode: ["remote" as const],
      description:
        "Own this function and partner with teams across the company.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };
    const unrelatedTitles = [
      "Mobility Specialist - AMER",
      "Billing Specialist",
      "Procurement Analyst",
      "Lifecycle Specialist: Time & Attendance",
      "EDD Analyst",
      "GTM Strategy Principal",
      "Senior Product Manager, Remote Build",
      "Account Manager, DACH Market",
    ];

    for (const title of unrelatedTitles) {
      const assessment = createMatchAssessment(seed.profile, preferences, {
        ...basePosting,
        sourceJobId: `live_mismatch_${title}`,
        title,
      });

      expect(assessment, title).toMatchObject({
        recommendation: "skip",
        recommendationRationale:
          "The listing belongs to a different occupational role.",
        dimensions: {
          roleSuitability: {
            state: "conflict",
          },
        },
      });
    }
  });

  test("hides explicit non-target occupational disciplines for engineering and support searches", () => {
    const seed = createSeed();
    const basePosting = {
      ...seed.savedJobs[0]!,
      company: "Example employer",
      location: "Remote",
      workMode: ["remote" as const],
      description: "Own this discipline and partner across the company.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };
    const unrelatedTitles = [
      "Lifecycle Senior Specialist (OHS): Contract Management",
      "Lifecycle Specialist, Employee Relations & Transitions - LATAM",
      "Tecnico en prevención de riesgos laborales (Health & Safety Officer)",
    ];
    const targetRoleSets = [
      ["Senior Frontend Engineer", "Software Engineer"],
      ["Customer Support Specialist", "Technical Support Specialist"],
    ];

    for (const targetRoles of targetRoleSets) {
      for (const title of unrelatedTitles) {
        const assessment = createMatchAssessment(
          seed.profile,
          {
            ...seed.searchPreferences,
            targetRoles,
            locations: [],
            workModes: [],
          },
          {
            ...basePosting,
            sourceJobId: `occupational_conflict_${title}`,
            title,
          },
        );

        expect(assessment, `${targetRoles[0]} -> ${title}`).toMatchObject({
          recommendation: "skip",
          recommendationRationale:
            "The listing belongs to a different occupational role.",
          dimensions: {
            roleSuitability: {
              state: "conflict",
            },
          },
        });
      }
    }
  });

  test("preserves adjacent engineering and career-change recall", () => {
    const seed = createSeed();
    const basePosting = {
      ...seed.savedJobs[0]!,
      location: "Remote",
      workMode: ["remote" as const],
      description: "Partner across teams and deliver measurable outcomes.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };
    const engineeringPreferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Frontend Engineer", "Software Engineer"],
      locations: [],
      workModes: [],
    };
    const careerChangePreferences = {
      ...seed.searchPreferences,
      targetRoles: [
        "Marketing Coordinator",
        "Marketing Assistant",
        "Project Coordinator",
      ],
      locations: [],
      workModes: [],
    };

    const forwardDeployed = createMatchAssessment(
      seed.profile,
      engineeringPreferences,
      {
        ...basePosting,
        sourceJobId: "adjacent_forward_deployed",
        title: "Senior Forward Deployed Engineer",
      },
    );
    const productMarketing = createMatchAssessment(
      seed.profile,
      careerChangePreferences,
      {
        ...basePosting,
        sourceJobId: "adjacent_product_marketing",
        title: "Senior Product Marketing Manager",
      },
    );
    const programCoordinator = createMatchAssessment(
      seed.profile,
      careerChangePreferences,
      {
        ...basePosting,
        sourceJobId: "adjacent_program_coordinator",
        title: "Program Coordinator",
      },
    );
    const customerSupport = createMatchAssessment(
      seed.profile,
      {
        ...seed.searchPreferences,
        targetRoles: ["Customer Support Specialist"],
        locations: [],
        workModes: [],
      },
      {
        ...basePosting,
        sourceJobId: "target_customer_support",
        title: "Customer Support Specialist, Health & Safety Software",
      },
    );
    const softwareEngineer = createMatchAssessment(
      seed.profile,
      engineeringPreferences,
      {
        ...basePosting,
        sourceJobId: "target_software_engineer",
        title: "Software Engineer, Employee Lifecycle Platform",
      },
    );
    const frontendEngineer = createMatchAssessment(
      seed.profile,
      engineeringPreferences,
      {
        ...basePosting,
        sourceJobId: "target_frontend_engineer",
        title: "Senior Frontend Engineer",
      },
    );

    expect(forwardDeployed.recommendation).not.toBe("skip");
    expect(productMarketing.recommendation).not.toBe("skip");
    expect(programCoordinator.recommendation).not.toBe("skip");
    expect(customerSupport.recommendation).not.toBe("skip");
    expect(softwareEngineer.recommendation).not.toBe("skip");
    expect(frontendEngineer.recommendation).not.toBe("skip");
  });

  test("does not call adjacent Chicago roles conflicts for a Marketing Manager plan", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Marketing Manager"],
      locations: [],
      workModes: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      description: "Lead customer and commercial programs across the business.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };

    for (const title of [
      "Lead Treasury Management Consultant",
      "Customer Service Associate (Tues-Sat or Night Shift)",
      "Product Manager",
    ]) {
      const assessment = createMatchAssessment(seed.profile, preferences, {
        ...basePosting,
        sourceJobId: `chicago_${title}`,
        title,
      });

      expect(assessment.recommendation, title).not.toBe("skip");
      expect(assessment.dimensions.roleSuitability.state, title).not.toBe(
        "conflict",
      );
    }
  });

  test("spends a constrained source budget on credible role matches before remote occupational mismatches", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: [
        "Senior Frontend Engineer",
        "Frontend Engineer",
        "Software Engineer",
      ],
      locations: ["Remote", "United States"],
      workModes: ["remote" as const],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      company: "Example employer",
      description: "Build and operate customer-facing software.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };
    const selected = selectDiscoveryBudgetPostings({
      postings: [
        {
          ...basePosting,
          sourceJobId: "remote_billing",
          canonicalUrl: "https://example.com/jobs/remote-billing",
          title: "Billing Specialist",
          location: "Remote - United States",
          workMode: ["remote"],
        },
        {
          ...basePosting,
          sourceJobId: "remote_mobility",
          canonicalUrl: "https://example.com/jobs/remote-mobility",
          title: "Mobility Specialist - AMER",
          location: "Remote - United States",
          workMode: ["remote"],
        },
        {
          ...basePosting,
          sourceJobId: "remote_procurement",
          canonicalUrl: "https://example.com/jobs/remote-procurement",
          title: "Procurement Analyst",
          location: "Remote - United States",
          workMode: ["remote"],
        },
        {
          ...basePosting,
          sourceJobId: "credible_frontend",
          canonicalUrl: "https://example.com/jobs/credible-frontend",
          title: "Front End / Fullstack Engineer - Messaging Team",
          location: "Paris, France",
          workMode: ["onsite"],
        },
        {
          ...basePosting,
          sourceJobId: "credible_software",
          canonicalUrl: "https://example.com/jobs/credible-software",
          title: "Software Engineer - Outbound Campaigns",
          location: "Paris, France",
          workMode: ["onsite"],
        },
      ],
      profile: seed.profile,
      searchPreferences: preferences,
      limit: 2,
    });

    expect(selected.map((posting) => posting.sourceJobId)).toEqual([
      "credible_frontend",
      "credible_software",
    ]);
  });

  test("matches linkedin noisy dismiss-title strings without letting adjacent frontend roles through", () => {
    expect(
      matchesTitlePreference(
        "Full Circle Agency • Pristina (Remote) Dismiss Full Stack Developer (AI-First) job Viewed · Posted 1 month ago",
        ["Senior Full-Stack Software Engineer"],
      ),
    ).toBe(true);
    expect(
      matchesTitlePreference(
        "Senior Full Stack Engineer (Typescript) (Verified job) Fresha • Pristina (On-site) Dismiss Senior Full Stack Engineer (Typescript) job 1 connection works here Viewed · Promoted",
        ["Senior Full-Stack Software Engineer"],
      ),
    ).toBe(true);
    expect(
      matchesTitlePreference(
        "Senior Frontend Engineer (Verified job) Fresha • Pristina (On-site) Dismiss Senior Frontend Engineer job 1 connection works here Viewed · Promoted",
        ["Senior Full-Stack Software Engineer"],
      ),
    ).toBe(false);
  });

  test("matches close location variants while ignoring work-mode noise", () => {
    expect(
      matchesLocationPreference("Pristina (On-site)", ["Prishtina, Kosovo"]),
    ).toBe(true);
    expect(
      matchesLocationPreference("Prishtina, Kosovo (Remote)", [
        "Prishtina, Kosovo",
      ]),
    ).toBe(true);
    expect(
      matchesLocationPreference("Tirana, Albania", ["Prishtina, Kosovo"]),
    ).toBe(false);
    expect(
      matchesLocationPreference("Remote-Eastern Europe", ["Prishtina, Kosovo"]),
    ).toBe(false);
    expect(
      matchesLocationPreference("Remote-Southern Europe", [
        "Prishtina, Kosovo",
      ]),
    ).toBe(true);
    expect(
      matchesLocationPreference("Remote-Northern Europe", [
        "Prishtina, Kosovo",
      ]),
    ).toBe(false);
    expect(
      matchesLocationPreference("Remote-Austria", ["Prishtina, Kosovo"]),
    ).toBe(false);
    expect(
      matchesLocationPreference("Remote-EMEA", ["Prishtina, Kosovo"]),
    ).toBe(true);
    expect(
      getBroadLocationCompatibility("Remote-APAC", ["Prishtina, Kosovo"]),
    ).toBe(false);
  });

  test("keeps geographically unspecified listings neutral instead of positively compatible", () => {
    expect(assessLocationCompatibility("Remote", ["Prishtina, Kosovo"])).toBe(
      "unknown",
    );
    expect(matchesLocationPreference("Remote", ["Prishtina, Kosovo"])).toBe(
      false,
    );
    expect(assessLocationCompatibility("Hybrid", ["Berlin, Germany"])).toBe(
      "unknown",
    );
    expect(assessLocationCompatibility("", ["Berlin, Germany"])).toBe(
      "unknown",
    );
    expect(
      assessLocationCompatibility("Remote - Worldwide", ["Prishtina, Kosovo"]),
    ).toBe("compatible");
    expect(assessLocationCompatibility("Remote", ["Remote", "London"])).toBe(
      "compatible",
    );
    expect(assessLocationCompatibility("Tirana, Albania", ["Remote"])).toBe(
      "unknown",
    );
    expect(
      assessLocationCompatibility("Remote - United States", [
        "Berlin, Germany",
      ]),
    ).toBe("incompatible");
  });

  test("reads a stored absence placeholder as unknown, never as a conflict", () => {
    // Discovery stores a readable placeholder when a board exposes no place at
    // all. Reading that placeholder as a real geography made the app claim it
    // had compared a location it never saw, which then propagated into a
    // "mixed" preference verdict and an earned-looking fit percentage.
    for (const absence of [
      "Location not stated",
      "location not stated",
      "Not specified",
      "Not listed",
      "N/A",
      "Unknown",
      "—",
      "   ",
    ]) {
      expect(
        assessLocationCompatibility(absence, ["Austin, TX"]),
        absence,
      ).toBe("unknown");
      expect(matchesExcludedLocation(absence, ["Austin, TX"]), absence).toBe(
        false,
      );
    }

    // A real place is still compared normally in both directions.
    expect(assessLocationCompatibility("Berlin, Germany", ["Austin, TX"])).toBe(
      "incompatible",
    );
    expect(assessLocationCompatibility("Austin, TX", ["Austin, TX"])).toBe(
      "compatible",
    );
    // "Notting Hill, London" starts with "not" but is a place, not an absence.
    expect(
      assessLocationCompatibility("Notting Hill, London", ["London"]),
    ).toBe("compatible");
  });

  test("reads the place out of a cell that also states the work mode", () => {
    // A board writes "how" and "where" in one cell. The work-mode lead-in and
    // the trailing country are not geography, and leaving them in made every
    // listing on a city board read as outside the requested city.
    for (const stated of [
      "Hiring Remotely in Chicago, IL, USA",
      "Hiring Remotely in Illinois, USA",
      "Chicago, IL, USA",
      "Remote in Chicago",
      "Hybrid in Chicago",
    ]) {
      expect(assessLocationCompatibility(stated, ["Chicago, IL"]), stated).toBe(
        "compatible",
      );
    }

    // A different city stays outside, whatever the remote wording says.
    expect(
      assessLocationCompatibility("Hiring Remotely in Austin, TX, USA", [
        "Chicago, IL",
      ]),
    ).toBe("incompatible");

    // Stripping must never turn a work-mode-only cell into an empty place.
    expect(assessLocationCompatibility("Remote", ["Chicago, IL"])).toBe(
      "unknown",
    );
    expect(
      assessLocationCompatibility("Remote - United States", ["Chicago, IL"]),
    ).toBe("incompatible");
  });

  test("reads an absence placeholder in the saved preference as no constraint", () => {
    // The saved side carries placeholders too: an imported profile can push
    // "Location not stated" into the preferred locations, or the user can type
    // "N/A". Tokenising that as geography made every real listing read as
    // outside the saved areas, which hid the entire result set.
    for (const absence of [
      "Location not stated",
      "location not stated",
      "Not specified",
      "Not listed",
      "N/A",
      "Unknown",
      "—",
      "   ",
    ]) {
      expect(
        assessLocationCompatibility("Berlin, Germany", [absence]),
        absence,
      ).toBe("compatible");
      expect(
        assessLocationCompatibility("Austin, TX", [absence]),
        absence,
      ).toBe("compatible");
    }

    // A placeholder alongside a real saved place leaves the real comparison
    // untouched in both directions.
    expect(
      assessLocationCompatibility("Berlin, Germany", ["N/A", "Austin, TX"]),
    ).toBe("incompatible");
    expect(
      assessLocationCompatibility("Austin, TX", ["N/A", "Austin, TX"]),
    ).toBe("compatible");
  });

  test("scores a placeholder-only saved location as no constraint, not as a verified match", () => {
    // "compatible" is the same answer for "nothing was saved" and "the saved
    // place matched", so every caller that reads the raw saved list would
    // credit a placeholder as a location the user chose and the listing met:
    // +10, "Location fits the saved search preferences.", an "aligned"
    // preference facet naming the placeholder, and a supported required
    // location requirement — a claim nothing was ever compared for.
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const posting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      location: "Tokyo, Japan",
      workMode: [],
      easyApplyEligible: false,
    };

    const unconstrained = createMatchAssessment(
      seed.profile,
      { ...preferences, locations: [] },
      posting,
    );
    const placeholderOnly = createMatchAssessment(
      seed.profile,
      { ...preferences, locations: ["Location not stated"] },
      posting,
    );

    expect(placeholderOnly.score).toBe(unconstrained.score);
    expect(placeholderOnly.reasons).toEqual(unconstrained.reasons);
    expect(placeholderOnly.gaps).toEqual(unconstrained.gaps);
    expect(placeholderOnly.reasons).not.toContain(
      "Location fits the saved search preferences.",
    );
    expect(placeholderOnly.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(
      placeholderOnly.requirements.some(
        (requirement) => requirement.category === "location",
      ),
    ).toBe(false);
    expect(placeholderOnly.dimensions.preferenceAlignment).toEqual(
      unconstrained.dimensions.preferenceAlignment,
    );
    expect(
      JSON.stringify(placeholderOnly.dimensions.preferenceAlignment),
    ).not.toContain("Location not stated");

    // A real saved place still scores as a real comparison in both
    // directions, so the neutral branch is not simply always neutral.
    const savedMatch = createMatchAssessment(
      seed.profile,
      { ...preferences, locations: ["Tokyo, Japan"] },
      posting,
    );
    const savedElsewhere = createMatchAssessment(
      seed.profile,
      { ...preferences, locations: ["Austin, TX"] },
      posting,
    );
    // The saved-match score shares this posting's evidence ceiling, so the
    // credited comparison shows in the reason line rather than the number.
    expect(savedMatch.reasons).toContain(
      "Location fits the saved search preferences.",
    );
    expect(savedElsewhere.score).toBeLessThan(placeholderOnly.score);
    expect(savedElsewhere.gaps).toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(
      savedMatch.requirements.some(
        (requirement) => requirement.category === "location",
      ),
    ).toBe(true);

    // A placeholder mixed in with a real place leaves that comparison alone
    // and never names the placeholder in the evidence.
    const mixed = createMatchAssessment(
      seed.profile,
      { ...preferences, locations: ["Location not stated", "Tokyo, Japan"] },
      posting,
    );
    expect(mixed.score).toBe(savedMatch.score);
    expect(JSON.stringify(mixed.dimensions.preferenceAlignment)).not.toContain(
      "Location not stated",
    );
  });

  test("applies one location-semantics table across positive fit and exclusion conflict", () => {
    const table: ReadonlyArray<{
      listing: string;
      place: string;
      positive: LocationCompatibilityState;
      excluded: boolean;
      rationale: string;
    }> = [
      {
        listing: "Pristina (On-site)",
        place: "Prishtina, Kosovo",
        positive: "compatible",
        excluded: true,
        rationale: "normalized alias identity proves both fit and conflict",
      },
      {
        listing: "Bengaluru, India",
        place: "India",
        positive: "compatible",
        excluded: true,
        rationale: "concrete containment of the named country",
      },
      {
        listing: "Remote",
        place: "India",
        positive: "unknown",
        excluded: false,
        rationale:
          "work-mode noise asserts no geography, so it neither fits nor conflicts",
      },
      {
        listing: "Anywhere / Work from home",
        place: "India",
        positive: "compatible",
        excluded: false,
        rationale:
          "worldwide coverage includes every saved area but never drives exclusion",
      },
      {
        listing: "Remote - United States",
        place: "United States",
        positive: "compatible",
        excluded: true,
        rationale: "region-restricted remote respects the matching geography",
      },
      {
        listing: "Remote - United States",
        place: "Berlin, Germany",
        positive: "incompatible",
        excluded: false,
        rationale: "proven regional separation resolves both directions",
      },
      {
        listing: "Remote - Europe",
        place: "Germany",
        positive: "compatible",
        excluded: true,
        rationale:
          "coarse candidate region may contain the compared place, so it fits positively and conflicts under exclusion",
      },
      {
        listing: "Remote - Eastern Europe",
        place: "Germany",
        positive: "incompatible",
        excluded: false,
        rationale: "proven subregion separation blocks the exclusion",
      },
      {
        listing: "Remote-EMEA",
        place: "Prishtina, Kosovo",
        positive: "compatible",
        excluded: true,
        rationale:
          "coarse candidate region may contain the saved area in either direction",
      },
      {
        listing: "Tirana, Albania",
        place: "Prishtina, Kosovo",
        positive: "incompatible",
        excluded: false,
        rationale:
          "two fine-grained places in one region are not proof of conflict",
      },
      {
        listing: "Berlin, Germany",
        place: "India",
        positive: "incompatible",
        excluded: false,
        rationale: "unrelated concrete places stay apart",
      },
    ];

    for (const row of table) {
      const label = `${row.listing} vs ${row.place}`;
      expect(assessLocationCompatibility(row.listing, [row.place]), label).toBe(
        row.positive,
      );
      expect(matchesExcludedLocation(row.listing, [row.place]), label).toBe(
        row.excluded,
      );
    }
  });

  test("never lets noise-only locations match arbitrary exclusions while keeping explicit work-mode exclusions", () => {
    for (const listing of [
      "Remote",
      "Hybrid",
      "Anywhere",
      "Worldwide",
      "Work from home",
      "Remote - Worldwide",
    ]) {
      for (const place of [
        "India",
        "Berlin, Germany",
        "Toronto, Canada",
        "United States",
      ]) {
        expect(
          matchesExcludedLocation(listing, [place]),
          `${listing}|${place}`,
        ).toBe(false);
      }
    }

    expect(matchesExcludedLocation("Remote", ["Remote"])).toBe(true);
    expect(matchesExcludedLocation("Fully remote", ["remote"])).toBe(true);
    expect(matchesExcludedLocation("Hybrid", ["Remote"])).toBe(false);
    expect(matchesExcludedLocation("Berlin, Germany", ["Remote"])).toBe(false);
  });

  test("uses narrative overlap without manufacturing structured requirements", () => {
    const seed = createSeed();
    const posting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      description:
        "Build a desktop product with TypeScript, React, Electron, and WebSockets.",
      keySkills: [],
      minimumQualifications: [],
      preferredQualifications: [],
      responsibilities: [],
      keywordSignals: [],
      easyApplyEligible: false,
    };
    const baseProfile = {
      ...seed.profile,
      headline: "Senior Software Engineer",
      skillGroups: {
        coreSkills: [],
        tools: [],
        languagesAndFrameworks: [],
        softSkills: [],
        highlightedSkills: [],
      },
      experiences: [],
      projects: [],
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: [],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const assessment = createMatchAssessment(
      {
        ...baseProfile,
        skills: ["TypeScript", "React", "Electron"],
      },
      preferences,
      posting,
    );
    const withoutMatchingSkills = createMatchAssessment(
      { ...baseProfile, skills: [] },
      preferences,
      posting,
    );

    expect(assessment.score).toBeGreaterThan(withoutMatchingSkills.score);
    expect(assessment.score).toBeLessThanOrEqual(71);
    expect(assessment.recommendation).toBe("review_before_applying");
    expect(assessment.dimensions.evidenceConfidence.level).toBe("unavailable");
    expect(
      assessment.requirements.some(({ label }) =>
        ["TypeScript", "React", "Electron"].includes(label),
      ),
    ).toBe(false);
    expect(assessment.reasons).not.toContain(
      "Location fits the saved search preferences.",
    );
    expect(assessment.reasons).not.toContain(
      "Work mode matches the preferred operating model.",
    );
    expect(assessment.gaps).not.toContain(
      "The listing emphasizes skills that are not yet prominent in the current profile.",
    );
  });

  test("keeps unknown compensation neutral when the user has a minimum salary", () => {
    const seed = createSeed();
    const posting = {
      ...seed.savedJobs[0]!,
      salaryText: null,
      easyApplyEligible: false,
    };
    const preferences = JobSearchPreferencesSchema.parse({
      ...seed.searchPreferences,
      minimumSalaryUsd: null,
      compensation: {
        minimum: null,
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "inherited",
      },
    });

    const withoutMinimum = createMatchAssessment(
      seed.profile,
      preferences,
      posting,
    );
    const withMinimum = createMatchAssessment(
      seed.profile,
      JobSearchPreferencesSchema.parse({
        ...preferences,
        compensation: {
          minimum: 120_000,
          maximum: null,
          interval: "year",
          currency: "USD",
          currencyStatus: "explicit",
        },
      }),
      posting,
    );

    expect(withMinimum.score).toBe(withoutMinimum.score);
    expect(withMinimum.recommendation).toBe(withoutMinimum.recommendation);
    expect(withMinimum.requirements).toEqual(withoutMinimum.requirements);
    expect(withMinimum.gaps).not.toContain(
      "Compensation looks below the saved salary target.",
    );
  });

  test("caps an explicitly below-minimum listing below strong or original-ready recommendations", () => {
    const seed = createSeed();
    const preferences = JobSearchPreferencesSchema.parse({
      ...seed.searchPreferences,
      locations: [],
      workModes: [],
      compensation: {
        minimum: 120_000,
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit",
      },
    });
    const basePosting = {
      ...seed.savedJobs[0]!,
      easyApplyEligible: false,
      location: "London, United Kingdom",
      workMode: ["onsite" as const],
    };

    const meetsMinimum = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "$130k-$150k/year",
    });
    const belowMinimum = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "$90k-$100k/year",
    });

    expect(meetsMinimum.scorerVersion).toBe(MATCH_ASSESSMENT_SCORER_VERSION);
    expect(meetsMinimum.compensationFit.state).toBe("meets_minimum");
    expect(belowMinimum.compensationFit.state).toBe("below_minimum");
    expect(belowMinimum.score).toBeLessThan(meetsMinimum.score);
    expect(belowMinimum.score).toBeLessThanOrEqual(71);
    expect(belowMinimum.recommendation).toBe("review_before_applying");
    expect(belowMinimum.recommendationRationale).toContain(
      "below the saved salary minimum",
    );
  });

  test("keeps foreign or unspecified currencies incomparable with a USD minimum", () => {
    const seed = createSeed();
    const preferences = JobSearchPreferencesSchema.parse({
      ...seed.searchPreferences,
      compensation: {
        minimum: 120_000,
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit",
      },
    });
    const basePosting = {
      ...seed.savedJobs[0]!,
      easyApplyEligible: false,
    };
    const unknown = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: null,
    });
    const eur = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "EUR 140k/year",
    });
    const unspecified = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "140k/year",
    });

    expect(eur.compensationFit.state).toBe("currency_incomparable");
    expect(unspecified.compensationFit.state).toBe("currency_incomparable");
    expect(eur.score).toBe(unknown.score);
    expect(unspecified.score).toBe(unknown.score);
  });

  test("compares a saved EUR monthly floor with EUR annual listings", () => {
    const seed = createSeed();
    const preferences = JobSearchPreferencesSchema.parse({
      ...seed.searchPreferences,
      locations: [],
      workModes: [],
      compensation: {
        minimum: 2_000,
        maximum: 4_000,
        interval: "month",
        currency: "EUR",
        currencyStatus: "explicit",
      },
    });
    const basePosting = {
      ...seed.savedJobs[0]!,
      easyApplyEligible: false,
    };

    const meetsMinimum = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "EUR 30k/year",
    });
    const belowMinimum = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      salaryText: "EUR 18k/year",
    });

    expect(meetsMinimum.compensationFit.state).toBe("meets_minimum");
    expect(belowMinimum.compensationFit.state).toBe("below_minimum");
    expect(belowMinimum.score).toBeLessThan(meetsMinimum.score);
  });

  test("gives comparable above-minimum pay only the bounded preference effect", () => {
    const seed = createSeed();
    const posting = {
      ...seed.savedJobs[0]!,
      salaryText: "$130k/year",
      easyApplyEligible: false,
    };
    const withoutMinimum = createMatchAssessment(
      seed.profile,
      JobSearchPreferencesSchema.parse({
        ...seed.searchPreferences,
        compensation: {
          minimum: null,
          maximum: null,
          interval: "year",
          currency: "USD",
          currencyStatus: "inherited",
        },
      }),
      posting,
    );
    const withMinimum = createMatchAssessment(
      seed.profile,
      JobSearchPreferencesSchema.parse({
        ...seed.searchPreferences,
        compensation: {
          minimum: 120_000,
          maximum: null,
          interval: "year",
          currency: "USD",
          currencyStatus: "explicit",
        },
      }),
      posting,
    );

    expect(withMinimum.compensationFit.state).toBe("meets_minimum");
    expect(withMinimum.score - withoutMinimum.score).toBeLessThanOrEqual(6);
  });
  test("keeps Easy Apply metadata out of suitability assessment", () => {
    const seed = createSeed();
    const basePosting = {
      ...seed.savedJobs[0]!,
      salaryText: null,
      easyApplyEligible: false,
    };

    const withoutEasyApply = createMatchAssessment(
      seed.profile,
      seed.searchPreferences,
      basePosting,
    );
    const withEasyApply = createMatchAssessment(
      seed.profile,
      seed.searchPreferences,
      {
        ...basePosting,
        easyApplyEligible: true,
      },
    );

    expect(withEasyApply.score).toBe(withoutEasyApply.score);
    expect(withEasyApply.recommendation).toBe(withoutEasyApply.recommendation);
    expect(withEasyApply.requirements).toEqual(withoutEasyApply.requirements);
    expect(withEasyApply.reasons).toEqual(withoutEasyApply.reasons);
    expect(withEasyApply.gaps).toEqual(withoutEasyApply.gaps);
    expect(withoutEasyApply.dimensions.applicationEffort.level).toBe("unknown");
    expect(withEasyApply.dimensions.applicationEffort.level).toBe("low");
  });

  test("separates sales-engineering work from harmless sales-domain wording", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: [],
      workModes: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      summary: null,
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
      keySkills: [],
      keywordSignals: [],
    };

    const quotaCarrying = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      sourceJobId: "quota-solutions-engineer",
      title: "Senior Solutions Engineer",
      description:
        "Own a sales quota while delivering technical solutions to enterprise buyers.",
    });
    const salesCycle = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      sourceJobId: "sales-cycle-solutions-engineer",
      title: "Senior Solutions Engineer",
      description:
        "Deliver technical demos to prospects and partner with account executives on proofs of concept.",
    });
    const salesPlatform = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      sourceJobId: "sales-platform-software-engineer",
      title: "Software Engineer, Sales Platform",
      description:
        "Build quota-enforcement and billing code for the internal sales platform.",
    });
    const internalSolutions = createMatchAssessment(seed.profile, preferences, {
      ...basePosting,
      sourceJobId: "internal-solutions-engineer",
      title: "Senior Solutions Engineer",
      description:
        "Build internal product demos and tools for Customer Success. Prototype backend services for the research database.",
    });

    expect(quotaCarrying).toMatchObject({
      recommendation: "skip",
      recommendationRationale:
        "The listing belongs to a different occupational role.",
    });
    expect(salesCycle).toMatchObject({
      recommendation: "skip",
      recommendationRationale:
        "The listing belongs to a different occupational role.",
    });
    expect(salesPlatform.recommendation).not.toBe("skip");
    expect(internalSolutions.recommendation).not.toBe("skip");
  });

  test("penalizes explicit location and staff-scope mismatches instead of only withholding bonuses", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        headline: "Senior Software Engineer",
        experiences: seed.profile.experiences.map((experience, index) => ({
          ...experience,
          title: index === 0 ? "Senior Software Engineer" : experience.title,
        })),
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Software Engineer"],
        locations: ["Prishtina, Kosovo"],
        workModes: ["remote"],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Staff Software Engineer",
        location: "Madrid, Spain",
        workMode: ["onsite"],
        description: "Build software with React and TypeScript.",
        keySkills: [],
        keywordSignals: [],
      },
    );

    expect(assessment.score).toBeLessThan(70);
    expect(assessment.gaps).toContain(
      "The title signals a staff-or-leadership scope not yet explicit in the current profile.",
    );
  });

  test("does not award perfect scores to explicit technology or SRE specializations missing from the profile", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Full-Stack Software Engineer",
      skills: ["TypeScript", "React", "Node.js", "AWS", "Docker"],
      experiences: seed.profile.experiences.map((experience) => ({
        ...experience,
        summary: null,
        achievements: [],
        skills: ["TypeScript", "React", "Node.js"],
      })),
      projects: [],
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Backend Engineer", "Senior Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: ["remote" as const],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      location: "Remote-EMEA",
      workMode: ["remote" as const],
      description: "Build distributed services using Node.js, AWS, and Docker.",
      keySkills: [],
      keywordSignals: [],
    };

    const elixir = createMatchAssessment(profile, preferences, {
      ...basePosting,
      title: "Senior Backend Engineer (Elixir)",
    });
    const sre = createMatchAssessment(profile, preferences, {
      ...basePosting,
      title: "Senior Site Reliability Engineer",
    });

    expect(elixir.score).toBeLessThanOrEqual(84);
    expect(
      elixir.gaps.some((gap) => gap.includes("specializes in elixir")),
    ).toBe(true);
    expect(sre.score).toBeLessThanOrEqual(72);
    expect(sre.gaps.some((gap) => gap.includes("site-reliability"))).toBe(true);
    expect(sre.recommendation).toBe("review_before_applying");
    expect(
      sre.requirements.some(
        (requirement) =>
          requirement.label === "Site reliability operations" &&
          requirement.status === "missing",
      ),
    ).toBe(true);
  });

  test("builds requirement evidence and withholds an apply recommendation when a required framework is unsupported", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        headline: "Senior Backend Engineer",
        yearsExperience: 8,
        skills: ["Python", "AWS"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: [],
          tools: ["AWS"],
          languagesAndFrameworks: ["Python"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Backend Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Backend Engineer",
        description:
          "&lt;h2&gt;Requirements&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;You must have production experience with Python and FastAPI.&lt;/li&gt;&lt;li&gt;At least 5 years of backend engineering experience.&lt;/li&gt;&lt;/ul&gt;&lt;h2&gt;Nice to have&lt;/h2&gt;&lt;p&gt;AWS experience.&lt;/p&gt;",
        keySkills: [],
        keywordSignals: [],
      },
    );

    const python = assessment.requirements.find(
      (requirement) => requirement.label === "Python",
    );
    const fastApi = assessment.requirements.find(
      (requirement) => requirement.label === "FastAPI",
    );
    const experience = assessment.requirements.find(
      (requirement) => requirement.category === "experience",
    );

    expect(python?.status).toBe("supported");
    expect(python?.resumeEvidence[0]?.detail).toContain("Python");
    expect(fastApi).toMatchObject({
      importance: "required",
      status: "missing",
    });
    expect(fastApi?.jobEvidence).toContain("FastAPI");
    expect(fastApi?.jobEvidence).not.toContain("&lt;");
    expect(experience?.status).toBe("supported");
    expect(assessment.recommendation).toBe("review_before_applying");
    expect(assessment.recommendationRationale).toContain("FastAPI");
  });

  test("does not mistake ordinary Go or net prose for technology requirements", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        skills: ["TypeScript"],
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Software Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Software Engineer",
        description:
          "Go beyond customer expectations and improve net revenue retention. React to feedback with empathy.",
        keySkills: [],
        keywordSignals: [],
      },
    );

    expect(
      assessment.requirements.some((requirement) =>
        ["Go", ".NET", "React"].includes(requirement.label),
      ),
    ).toBe(false);
  });

  test("does not use React Native alone as evidence for a React web requirement", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        skills: ["React Native"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: ["React Native"],
          languagesAndFrameworks: ["React Native"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Frontend Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Frontend Engineer",
        description:
          "Required: production experience with React web applications.",
        keySkills: [],
        keywordSignals: [],
      },
    );

    expect(
      assessment.requirements.find(
        (requirement) => requirement.label === "React",
      ),
    ).toMatchObject({ importance: "required", status: "missing" });
    expect(
      assessment.requirements.some(
        (requirement) => requirement.label === "React Native",
      ),
    ).toBe(false);
  });

  test("detects punctuation-heavy C# and .NET requirements with grounded profile evidence", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        skills: ["C#", ".NET"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: ["C#", ".NET"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Software Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Software Engineer",
        description:
          "Required: production experience with C# and .NET services.",
        keySkills: [],
        keywordSignals: [],
      },
    );

    expect(
      assessment.requirements.find((requirement) => requirement.label === "C#"),
    ).toMatchObject({ importance: "required", status: "supported" });
    expect(
      assessment.requirements.find(
        (requirement) => requirement.label === ".NET",
      ),
    ).toMatchObject({ importance: "required", status: "supported" });
  });

  test("treats listed language alternatives as one requirement instead of separate hard gaps", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        skills: ["Node.js"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: ["Node.js"],
          languagesAndFrameworks: ["Node.js"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Backend Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Backend Engineer",
        detailQuality: "detail_enriched",
        location: "London, United Kingdom",
        workMode: ["onsite"],
        description:
          "Experience with 1+ backend programming language (Elixir, Python, Go, Java, Node.js, etc.).",
        keySkills: [],
        minimumQualifications: [],
        preferredQualifications: [],
        responsibilities: [],
        keywordSignals: [],
      },
    );

    const languageRequirement = assessment.requirements.find((requirement) =>
      requirement.label.startsWith("One of:"),
    );
    expect(languageRequirement).toMatchObject({
      importance: "required",
      status: "supported",
    });
    expect(languageRequirement?.label).toContain("Node.js");
    expect(
      assessment.requirements.some(
        (requirement) =>
          ["Elixir", "Python", "Go", "Java", "Node.js"].includes(
            requirement.label,
          ) && requirement.status === "missing",
      ),
    ).toBe(false);
    expect(assessment.recommendation).not.toBe("review_before_applying");
  });

  test("caps the official Circle Applied AI listing when core Rails, production AI, and scaling evidence are missing", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        headline: "Senior Full-Stack Software Engineer",
        yearsExperience: 9,
        skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
          tools: ["PostgreSQL"],
          languagesAndFrameworks: ["TypeScript", "React", "Node.js"],
        },
        experiences: seed.profile.experiences.map((experience) => ({
          ...experience,
          summary: "Built and maintained full-stack business applications.",
          achievements: [
            "Improved application response times through targeted refactoring.",
            "Designed and measured A/B campaigns to validate customer messaging.",
          ],
          skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        })),
        projects: [],
        spokenLanguages: [
          {
            id: "language_english",
            language: "English",
            proficiency: "C2",
            interviewPreference: true,
            notes: null,
          },
        ],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        sourceJobId: "5112809008",
        canonicalUrl:
          "https://job-boards.greenhouse.io/circleso/jobs/5112809008",
        applicationUrl:
          "https://job-boards.greenhouse.io/circleso/jobs/5112809008",
        title: "Senior Full-Stack Software Engineer, Applied AI",
        company: "Circle.so",
        description: [
          "The Applied AI team builds full-stack AI solutions including AI agents and Retrieval-Augmented Generation.",
          "Some team members joined with deep Rails experience and solid AI fundamentals, while others joined with deep AI experience and ramped up on Rails.",
          "6+ years experience working as a full-stack engineer on high-traffic production applications. You've dealt with the challenges that come with scale — query optimization, careful migrations, performance bottlenecks.",
          "Strong proficiency in Ruby on Rails, MySQL / Postgresql, ReactJS.",
          "Hands-on experience building AI features in production — whether RAG systems, AI agents, or LLM-powered tools. You've shipped at least one real AI use case, not just prototypes.",
          "Strong experimentation mindset — you're comfortable designing and running A/B tests, measuring results, and iterating quickly.",
          "You are proficient in English (spoken, written, and reading) at a CEFR Level C2.",
        ].join("\n"),
        keySkills: ["React", "PostgreSQL"],
        minimumQualifications: [],
        preferredQualifications: [],
        responsibilities: [],
        keywordSignals: [],
      },
    );

    const ruby = assessment.requirements.find(
      (requirement) => requirement.label === "Ruby",
    );
    const rails = assessment.requirements.find(
      (requirement) => requirement.label === "Rails",
    );
    const productionAi = assessment.requirements.find(
      (requirement) => requirement.label === "Production AI feature delivery",
    );
    const productionScale = assessment.requirements.find(
      (requirement) => requirement.label === "High-traffic production scaling",
    );
    const experimentation = assessment.requirements.find(
      (requirement) => requirement.label === "Experimentation and measurement",
    );
    const english = assessment.requirements.find((requirement) =>
      requirement.label.startsWith("English proficiency"),
    );

    expect(ruby).toMatchObject({ importance: "required", status: "missing" });
    expect(rails).toMatchObject({ importance: "required", status: "missing" });
    expect(ruby?.jobEvidence).toContain("Strong proficiency in Ruby on Rails");
    expect(rails?.jobEvidence).toContain("Strong proficiency in Ruby on Rails");
    expect(productionAi).toMatchObject({
      importance: "required",
      status: "missing",
    });
    expect(productionAi?.jobEvidence).toContain(
      "shipped at least one real AI use case",
    );
    expect(productionScale).toMatchObject({
      importance: "required",
      status: "missing",
    });
    expect(productionScale?.jobEvidence).toContain(
      "high-traffic production applications",
    );
    expect(experimentation).toMatchObject({
      importance: "required",
      status: "supported",
    });
    expect(english).toMatchObject({
      importance: "required",
      status: "supported",
    });
    expect(assessment.score).toBeLessThanOrEqual(64);
    expect(assessment.recommendation).toBe("review_before_applying");
  });

  test("reflects several unsupported technologies in both the score and recommendation", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        headline: "Senior Backend Engineer",
        skills: ["Node.js", "AWS", "PostgreSQL"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: [],
          tools: ["AWS", "PostgreSQL"],
          languagesAndFrameworks: ["Node.js"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Backend Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Backend Engineer",
        detailQuality: "detail_enriched",
        location: "London, United Kingdom",
        workMode: ["onsite"],
        description: "Build and operate reliable backend services.",
        keySkills: [],
        minimumQualifications: [],
        preferredQualifications: [],
        responsibilities: [
          "Build and operate services with Node.js and AWS.",
          "Extend Elixir, Phoenix, Kubernetes, and PostgreSQL components.",
        ],
        keywordSignals: [],
      },
    );
    const supportedAssessment = createMatchAssessment(
      {
        ...seed.profile,
        headline: "Senior Backend Engineer",
        skills: ["Node.js", "AWS", "PostgreSQL"],
        skillGroups: {
          ...seed.profile.skillGroups,
          coreSkills: [],
          tools: ["AWS", "PostgreSQL"],
          languagesAndFrameworks: ["Node.js"],
        },
        experiences: [],
        projects: [],
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Backend Engineer"],
        locations: [],
        workModes: [],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Backend Engineer",
        detailQuality: "detail_enriched",
        location: "London, United Kingdom",
        workMode: ["onsite"],
        description: "Build and operate reliable backend services.",
        keySkills: [],
        minimumQualifications: [],
        preferredQualifications: [],
        responsibilities: [
          "Build and operate services with Node.js, AWS, and PostgreSQL.",
        ],
        keywordSignals: [],
      },
    );

    expect(assessment.score).toBeLessThan(supportedAssessment.score);
    expect(assessment.recommendation).toBe("review_before_applying");
    expect(assessment.recommendationRationale).toContain(
      "3 detected requirements",
    );
  });

  test("does not call a remote requirement supported when remote eligibility is unknown", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      {
        ...seed.profile,
        workEligibility: {
          ...seed.profile.workEligibility,
          remoteEligible: null,
        },
      },
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Software Engineer"],
        locations: [],
        workModes: ["remote"],
      },
      {
        ...seed.savedJobs[0]!,
        title: "Senior Software Engineer",
        location: "Remote",
        workMode: ["remote"],
        description: "Build software with TypeScript and React.",
      },
    );

    const workMode = assessment.requirements.find(
      (requirement) => requirement.category === "work_mode",
    );

    expect(workMode).toMatchObject({
      status: "unknown",
      jobEvidence: "Remote",
    });
    expect(workMode?.explanation).toContain("eligibility is not confirmed");
    expect(assessment.recommendation).toBe("review_before_applying");
  });

  test("normalizes postal abbreviations across multi-location listings", () => {
    const listingLocation =
      "San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States";

    expect(
      matchesLocationPreference(listingLocation, ["Portland, Oregon"]),
    ).toBe(true);
    expect(
      matchesLocationPreference(listingLocation, ["Portland, Maine"]),
    ).toBe(false);
    expect(
      matchesLocationPreference("Toronto, ON or Remote within Canada", [
        "Toronto, Ontario",
      ]),
    ).toBe(true);
  });

  test("scores unspecified remote geography neutrally between fit and conflict", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Software Engineer",
      skills: ["React", "TypeScript"],
      workEligibility: {
        ...seed.profile.workEligibility,
        remoteEligible: true,
        willingToRelocate: true,
      },
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: ["Berlin, Germany"],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      workMode: ["onsite" as const],
      salaryText: null,
      detailQuality: "detail_enriched" as const,
      description:
        "Required: 5+ years of experience with TypeScript and React.",
      keySkills: ["TypeScript", "React"],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
    };
    const assessAt = (location: string, label: string) =>
      createMatchAssessment(profile, preferences, {
        ...basePosting,
        sourceJobId: `location_probe_${label}`,
        location,
      });

    const compatibleCity = assessAt("Berlin, Germany", "city");
    const unspecifiedRemote = assessAt("Remote", "bare_remote");
    const unstatedLocation = assessAt("", "empty");
    const conflictingRegion = assessAt("Remote - United States", "us_region");
    const locationRequirement = (assessment: typeof compatibleCity) =>
      assessment.requirements.find(
        (requirement) =>
          requirement.category === "location" &&
          requirement.label.startsWith("Location:"),
      );

    expect(compatibleCity.reasons).toContain(
      "Location fits the saved search preferences.",
    );
    expect(locationRequirement(compatibleCity)).toMatchObject({
      status: "supported",
    });
    expect(compatibleCity.score).toBeGreaterThan(unspecifiedRemote.score);

    expect(unspecifiedRemote.reasons).not.toContain(
      "Location fits the saved search preferences.",
    );
    expect(unspecifiedRemote.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(locationRequirement(unspecifiedRemote)).toMatchObject({
      importance: "required",
      status: "unknown",
    });
    expect(locationRequirement(unspecifiedRemote)?.explanation).toContain(
      "does not specify enough geographic detail",
    );
    expect(unspecifiedRemote.recommendation).not.toBe("skip");
    expect(unspecifiedRemote.score).toBe(unstatedLocation.score);
    expect(unstatedLocation.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );

    expect(conflictingRegion.gaps).toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(conflictingRegion.score).toBeLessThan(unspecifiedRemote.score);
  });

  test("lets a preferred remote work mode settle a remote listing's place comparison", () => {
    const austin = {
      locations: ["Austin, TX"],
      workModes: ["remote" as const],
    };

    // The saved city alone would read as outside the area; remote preference
    // plus a remote listing settles it as compatible.
    expect(
      assessLocationCompatibility("Remote (Chicago, IL)", austin.locations),
    ).toBe("incompatible");
    expect(
      assessPostingLocationCompatibility(
        { location: "Remote (Chicago, IL)", workMode: ["remote"] },
        austin,
      ),
    ).toEqual({ state: "compatible", remotePreferenceApplied: true });
    expect(
      assessPostingLocationCompatibility(
        { location: "Remote", workMode: ["remote"] },
        austin,
      ),
    ).toEqual({ state: "compatible", remotePreferenceApplied: true });

    // Without a remote preference the place comparison is unchanged.
    expect(
      assessPostingLocationCompatibility(
        { location: "Remote (Chicago, IL)", workMode: ["remote"] },
        { locations: ["Austin, TX"], workModes: ["onsite"] },
      ),
    ).toEqual({ state: "incompatible", remotePreferenceApplied: false });

    // An onsite listing elsewhere is still outside the area.
    expect(
      assessPostingLocationCompatibility(
        { location: "Chicago, IL", workMode: ["onsite"] },
        austin,
      ),
    ).toEqual({ state: "incompatible", remotePreferenceApplied: false });

    // An explicit regional restriction excluding every saved area needs the
    // user's confirmation and stays unknown instead of compatible.
    expect(
      assessPostingLocationCompatibility(
        { location: "Remote - United States", workMode: ["remote"] },
        { locations: ["Berlin, Germany"], workModes: ["remote"] },
      ),
    ).toEqual({ state: "unknown", remotePreferenceApplied: true });
  });

  test("scores a remote listing as location-compatible for a remote-preferring search and says why", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: ["Austin, TX"],
      workModes: ["remote" as const],
    };
    const posting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      location: "Remote (Chicago, IL)",
      workMode: ["remote" as const],
      detailQuality: "detail_enriched" as const,
      screeningHints: {
        ...seed.savedJobs[0]!.screeningHints,
        remoteGeographies: [],
        requiresSecurityClearance: null,
      },
    };

    const assessment = createMatchAssessment(
      seed.profile,
      preferences,
      posting,
    );

    expect(assessment.reasons).toContain(
      "Remote listing; remote is one of your preferred work modes.",
    );
    expect(assessment.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );
    const locationRequirement = assessment.requirements.find(
      (requirement) =>
        requirement.category === "location" &&
        requirement.label.startsWith("Location"),
    );
    expect(locationRequirement).toMatchObject({
      status: "supported",
      explanation:
        "Remote listing; remote is one of your preferred work modes.",
    });
    const locationEvidence =
      assessment.dimensions?.preferenceAlignment.evidence.find(
        (evidence) => evidence.label === "Location comparison",
      );
    expect(locationEvidence?.detail).toBe(
      "Remote listing; remote is one of your preferred work modes.",
    );
    expect(locationEvidence?.detail).not.toMatch(/outside the saved areas/);
  });

  test("with remote not counting as any location, a remote listing must name a saved place", () => {
    const berlin = ["Berlin, Germany"];
    const off = { remoteCountsAsAnyLocation: false };

    // On (the default): a remote region or the whole world covers Berlin.
    expect(assessLocationCompatibility("Remote, Europe", berlin)).toBe(
      "compatible",
    );
    expect(assessLocationCompatibility("Remote, Worldwide", berlin)).toBe(
      "compatible",
    );
    // Off: only the place the listing names counts.
    expect(assessLocationCompatibility("Remote, Europe", berlin, off)).toBe(
      "incompatible",
    );
    expect(assessLocationCompatibility("Remote, Worldwide", berlin, off)).toBe(
      "incompatible",
    );
    expect(
      assessLocationCompatibility("Berlin, Germany (Remote)", berlin, off),
    ).toBe("compatible");
    // A listing that says only "Remote" names no place either way.
    expect(assessLocationCompatibility("Remote", berlin, off)).toBe("unknown");
    // A person who saved "Remote, Worldwide" as a place keeps those listings.
    expect(
      assessLocationCompatibility(
        "Remote, Worldwide",
        [...berlin, "Remote, Worldwide"],
        off,
      ),
    ).toBe("compatible");
    // Off also stops a remote work-mode preference from settling the place.
    expect(
      assessPostingLocationCompatibility(
        { location: "Remote (Chicago, IL)", workMode: ["remote"] },
        { locations: ["Austin, TX"], workModes: ["remote"] },
        off,
      ),
    ).toEqual({ state: "incompatible", remotePreferenceApplied: false });
  });

  test("scores a remote-region listing lower when remote does not count as any location", () => {
    const seed = createSeed();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: ["Berlin, Germany"],
      workModes: [],
    };
    const posting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      location: "Remote, Europe",
      workMode: ["remote" as const],
      detailQuality: "detail_enriched" as const,
      screeningHints: {
        ...seed.savedJobs[0]!.screeningHints,
        remoteGeographies: [],
        requiresSecurityClearance: null,
      },
    };

    const on = createMatchAssessment(seed.profile, preferences, posting);
    const off = createMatchAssessment(
      seed.profile,
      {
        ...preferences,
        discovery: {
          ...preferences.discovery,
          remoteCountsAsAnyLocation: false,
        },
      },
      posting,
    );

    expect(on.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(off.score).toBeLessThan(on.score);
    expect(off.gaps).toContain(
      "Location falls outside the preferred search areas.",
    );
  });

  test("keeps geographically unspecified listings out of location evidence claims", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Software Engineer",
      skills: ["React", "TypeScript"],
      workEligibility: {
        ...seed.profile.workEligibility,
        willingToRelocate: false,
        remoteEligible: true,
      },
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: [],
      minimumSalaryUsd: null,
      companyWhitelist: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      title: "Senior Software Engineer",
      workMode: ["onsite" as const],
      salaryText: null,
      detailQuality: "detail_enriched" as const,
      description: "Build software with TypeScript and React.",
      keySkills: ["TypeScript", "React"],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
      screeningHints: {
        ...seed.savedJobs[0]!.screeningHints,
        remoteGeographies: [],
        requiresSecurityClearance: null,
      },
    };
    const assessAt = (location: string, label: string) =>
      createMatchAssessment(profile, preferences, {
        ...basePosting,
        sourceJobId: `location_evidence_${label}`,
        location,
      });
    const locationRequirement = (assessment: ReturnType<typeof assessAt>) =>
      assessment.requirements.find(
        (requirement) =>
          requirement.category === "location" &&
          (requirement.label.startsWith("Location:") ||
            requirement.label === "Location (not stated in listing)"),
      );

    for (const [location, label] of [
      ["Remote", "bare_remote"],
      ["", "empty_location"],
    ] as const) {
      const assessment = assessAt(location, label);

      expect(assessment.reasons, label).not.toContain(
        "Location fits the saved search preferences.",
      );
      expect(assessment.gaps, label).not.toContain(
        "Location falls outside the preferred search areas.",
      );
      expect(assessment.recommendation, label).not.toBe("skip");
      expect(assessment.score, label).toBeGreaterThan(0);
      expect(
        assessment.requirements.some(
          (requirement) =>
            requirement.importance === "required" &&
            requirement.status === "conflict",
        ),
        label,
      ).toBe(false);
      expect(locationRequirement(assessment), label).toMatchObject({
        importance: "required",
        status: "unknown",
        label:
          label === "empty_location"
            ? "Location (not stated in listing)"
            : "Location: Remote",
      });
      expect(assessment.recommendationRationale, label).not.toMatch(
        /^Location: is not yet supported/,
      );
      expect(locationRequirement(assessment)?.explanation, label).toContain(
        label === "empty_location"
          ? "does not state a location"
          : "does not specify enough geographic detail",
      );
    }
    expect(assessAt("Remote", "bare_remote").score).toBe(
      assessAt("", "empty_location").score,
    );

    const concreteMatch = assessAt("Prishtina, Kosovo", "concrete_match");
    expect(concreteMatch.reasons).toContain(
      "Location fits the saved search preferences.",
    );
    expect(locationRequirement(concreteMatch)).toMatchObject({
      status: "supported",
      explanation:
        "The listing location is compatible with the saved search area.",
    });
    expect(concreteMatch.score).toBeGreaterThan(
      assessAt("Remote", "bare_remote").score,
    );

    const concreteMismatch = assessAt("Madrid, Spain", "concrete_mismatch");
    expect(concreteMismatch.gaps).toContain(
      "Location falls outside the preferred search areas.",
    );
    // On site in a faraway city with relocation ruled out: there is no way to
    // do this job from a saved area, so it stays a real blocker.
    expect(concreteMismatch.locationReach).toBe("outside_area");
    expect(locationRequirement(concreteMismatch)).toMatchObject({
      status: "conflict",
      explanation:
        "The listing is on site outside the saved search area and the profile rules out relocation.",
    });
    expect(concreteMismatch.score).toBeLessThan(
      assessAt("Remote", "bare_remote").score,
    );
    expect(concreteMismatch.recommendationRationale).toContain(
      "conflicts with the saved profile or search preferences",
    );

    // The same faraway city, but the listing never says it must be done
    // there. That sinks the listing without throwing it out.
    const mismatchWithoutStatedMode = createMatchAssessment(
      profile,
      preferences,
      {
        ...basePosting,
        sourceJobId: "location_evidence_mismatch_no_mode",
        workMode: [],
        location: "Madrid, Spain",
      },
    );
    expect(mismatchWithoutStatedMode.locationReach).toBe("unknown");
    expect(locationRequirement(mismatchWithoutStatedMode)).toMatchObject({
      status: "unknown",
    });
    expect(mismatchWithoutStatedMode.recommendation).not.toBe("skip");
  });

  test("hard-skips explicit non-engineering occupations while preserving ambiguous engineering roles", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Frontend Engineer",
      skills: ["React", "TypeScript"],
      skillGroups: {
        coreSkills: ["React", "TypeScript"],
        tools: [],
        languagesAndFrameworks: ["React", "TypeScript"],
        softSkills: [],
        highlightedSkills: ["React", "TypeScript"],
      },
      experiences: seed.profile.experiences.map((experience, index) => ({
        ...experience,
        title: index === 0 ? "Senior Frontend Engineer" : experience.title,
        summary: null,
        achievements: [],
        skills: ["React", "TypeScript"],
      })),
      projects: [],
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Frontend Engineer"],
      locations: [],
      workModes: [],
    };
    const basePosting = {
      ...seed.savedJobs[0]!,
      location: "Remote",
      workMode: ["remote" as const],
      summary: null,
      description: "Lead work in this occupational discipline.",
      keySkills: [],
      keywordSignals: [],
      responsibilities: [],
      minimumQualifications: [],
      preferredQualifications: [],
      screeningHints: {
        ...seed.savedJobs[0]!.screeningHints,
        remoteGeographies: [],
        requiresSecurityClearance: null,
      },
    };
    const unrelatedTitles = [
      "Senior Risk Strategist - Card Fraud",
      "Chief Audit Officer",
      "Counsel, Product & Regulatory - Payments & AML",
      "Deputy CISO",
    ];
    const ambiguousEngineeringTitles = [
      "Senior Platform Engineer",
      "Senior Security Engineer",
      "Software Engineer, Risk Platform",
    ];

    for (const title of unrelatedTitles) {
      expect(
        createMatchAssessment(profile, preferences, {
          ...basePosting,
          sourceJobId: `unrelated_${title}`,
          title,
        }),
      ).toMatchObject({
        recommendation: "skip",
        recommendationRationale:
          "The listing belongs to a different occupational role.",
      });
    }

    for (const title of ambiguousEngineeringTitles) {
      expect(
        createMatchAssessment(profile, preferences, {
          ...basePosting,
          sourceJobId: `engineering_${title}`,
          title,
        }).recommendation,
      ).not.toBe("skip");
    }
  });

  test("keeps a live-style frontend listing grounded across bullet, location, and eligibility evidence", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Frontend Engineer",
      currentLocation: "Portland, Oregon",
      currentCity: "Portland",
      currentRegion: "Oregon",
      currentCountry: null,
      yearsExperience: 8,
      skills: ["React", "TypeScript", "Storybook", "Accessibility"],
      skillGroups: {
        coreSkills: ["React", "TypeScript", "Storybook", "Accessibility"],
        tools: ["Storybook"],
        languagesAndFrameworks: ["React", "TypeScript"],
        softSkills: [],
        highlightedSkills: ["React", "TypeScript", "Accessibility"],
      },
      workEligibility: {
        ...seed.profile.workEligibility,
        authorizedWorkCountries: ["United States"],
        requiresVisaSponsorship: false,
        remoteEligible: true,
      },
      experiences: [
        {
          ...seed.profile.experiences[0]!,
          id: "experience_casey_frontend",
          title: "Senior Frontend Engineer",
          companyName: "Northstar Parcel Software",
          location: "Portland, Oregon",
          summary: null,
          achievements: [
            "Built an accessible component library with Storybook and automated axe checks.",
          ],
          skills: ["React", "TypeScript"],
        },
      ],
      projects: [],
    };
    const assessment = createMatchAssessment(
      profile,
      {
        ...seed.searchPreferences,
        targetRoles: ["Senior Frontend Engineer"],
        locations: ["Portland, Oregon"],
        workModes: ["remote"],
      },
      {
        ...seed.savedJobs[0]!,
        sourceJobId: "live_style_frontend_design_systems",
        title: "Senior Frontend Engineer - Design Systems",
        location:
          "San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States",
        workMode: ["remote"],
        description:
          "Build shared frontend foundations with React and TypeScript.",
        keySkills: ["React", "TypeScript"],
        minimumQualifications: [
          "Experience building or maintaining a design system or shared component library.",
          "Hands-on fluency at the intersection of AI and software development, including production AI feature delivery.",
        ],
        preferredQualifications: [],
        responsibilities: [],
        keywordSignals: [],
        screeningHints: {
          ...seed.savedJobs[0]!.screeningHints,
          remoteGeographies: ["United States", "Canada"],
          requiresSecurityClearance: null,
        },
      },
    );
    const requirementStatus = new Map(
      assessment.requirements.map((requirement) => [
        requirement.label,
        requirement.status,
      ]),
    );

    expect(requirementStatus.get("Design systems")).toBe("supported");
    expect(requirementStatus.get("Remote geography eligibility")).toBe(
      "supported",
    );
    expect(
      assessment.requirements.find(
        (requirement) => requirement.category === "location",
      ),
    ).toMatchObject({ status: "supported" });
    expect(requirementStatus.get("Production AI feature delivery")).toBe(
      "missing",
    );
    expect(assessment.gaps).not.toContain(
      "Location falls outside the preferred search areas.",
    );
    expect(assessment.recommendation).toBe("review_before_applying");
    expect(assessment.recommendationRationale).not.toContain(
      "Design systems is not yet supported",
    );
    expect(assessment.recommendationRationale).not.toContain(
      "Remote geography eligibility is not yet supported",
    );
  });
});

describe("resolveMatchLocationReach", () => {
  const base = {
    hasSavedLocationConstraint: true,
    locationRemotePreferenceApplied: false,
    workMode: [] as const,
    location: "Toronto, Ontario, Canada",
  };

  test("marks an on-site listing outside every saved area as out of reach", () => {
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "incompatible",
        workMode: ["onsite"],
      }),
    ).toBe("outside_area");
    // No stated mode, but the listing says in person itself.
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "incompatible",
        location: "Toronto, Ontario (on-site)",
      }),
    ).toBe("outside_area");
  });

  test("leaves a remote or unstated listing alone", () => {
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "incompatible",
        workMode: ["remote"],
      }),
    ).toBe("unknown");
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "incompatible",
      }),
    ).toBe("unknown");
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "unknown",
        workMode: ["onsite"],
      }),
    ).toBe("unknown");
  });

  test("names an in-area and a remote-preference listing", () => {
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "compatible",
      }),
    ).toBe("in_area");
    expect(
      resolveMatchLocationReach({
        ...base,
        locationCompatibility: "compatible",
        locationRemotePreferenceApplied: true,
      }),
    ).toBe("remote_preferred");
  });

  test("stays unknown when no area was saved", () => {
    expect(
      resolveMatchLocationReach({
        ...base,
        hasSavedLocationConstraint: false,
        locationCompatibility: "incompatible",
        workMode: ["onsite"],
      }),
    ).toBe("unknown");
  });
});

describe("a ticked preference is never a reason to skip", () => {
  const buildScene = (input: {
    workModes?: readonly ("remote" | "hybrid" | "onsite" | "flexible")[];
    employmentTypes?: readonly string[];
    excludedLocations?: readonly string[];
  }) => {
    const seed = createSeed();
    return {
      profile: {
        ...seed.profile,
        headline: "Marketing Manager",
        workEligibility: {
          ...seed.profile.workEligibility,
          willingToRelocate: false,
          remoteEligible: true,
        },
      },
      preferences: {
        ...seed.searchPreferences,
        targetRoles: ["Marketing Manager"],
        locations: ["Chicago, IL"],
        excludedLocations: [...(input.excludedLocations ?? [])],
        workModes: [...(input.workModes ?? [])],
        employmentTypes: [...(input.employmentTypes ?? [])],
        companyWhitelist: [],
        minimumSalaryUsd: null,
      },
      posting: {
        ...seed.savedJobs[0]!,
        title: "Marketing Manager",
        location: "Chicago, IL",
        description: "Run campaigns for a Chicago team.",
        detailQuality: "detail_enriched" as const,
      },
    };
  };

  test("keeps a hybrid listing when hybrid is ticked", () => {
    const scene = buildScene({ workModes: ["hybrid", "onsite"] });
    const assessment = createMatchAssessment(scene.profile, scene.preferences, {
      ...scene.posting,
      sourceJobId: "hybrid_ticked",
      workMode: ["hybrid"],
    });

    expect(assessment.recommendation).not.toBe("skip");
    expect(
      assessment.requirements.find(
        (requirement) => requirement.category === "work_mode",
      )?.status,
    ).toBe("supported");
  });

  test("sinks an unticked work mode instead of throwing the listing out", () => {
    const scene = buildScene({ workModes: ["remote"] });
    const assessment = createMatchAssessment(scene.profile, scene.preferences, {
      ...scene.posting,
      sourceJobId: "hybrid_not_ticked",
      workMode: ["hybrid"],
    });

    expect(assessment.recommendation).not.toBe("skip");
    expect(assessment.recommendationRationale).not.toContain(
      "conflicts with the saved profile or search preferences",
    );
    expect(
      assessment.requirements.find(
        (requirement) => requirement.category === "work_mode",
      )?.status,
    ).toBe("missing");
  });

  test("skips a work mode the person excluded", () => {
    const scene = buildScene({
      workModes: ["remote"],
      excludedLocations: ["onsite"],
    });
    const assessment = createMatchAssessment(scene.profile, scene.preferences, {
      ...scene.posting,
      sourceJobId: "onsite_excluded",
      workMode: ["onsite"],
    });

    expect(assessment.recommendation).toBe("skip");
  });

  test("keeps a part-time listing when part-time is ticked", () => {
    const scene = buildScene({ employmentTypes: ["Part-time"] });
    for (const employmentType of ["Part-time", "Full-Time/Part-Time"]) {
      const assessment = createMatchAssessment(
        scene.profile,
        scene.preferences,
        {
          ...scene.posting,
          sourceJobId: `part_time_${employmentType}`,
          employmentType,
        },
      );

      expect(assessment.recommendation, employmentType).not.toBe("skip");
      expect(assessment.gaps, employmentType).not.toContain(
        "The listing employment type conflicts with the saved employment preferences.",
      );
    }
  });

  test("skips a part-time listing when only full-time was selected", () => {
    const scene = buildScene({ employmentTypes: ["Full-time"] });
    const assessment = createMatchAssessment(scene.profile, scene.preferences, {
      ...scene.posting,
      sourceJobId: "part_time_excluded",
      employmentType: "Part-time",
    });

    expect(assessment.recommendation).toBe("skip");
    expect(assessment.recommendationRationale).toContain(
      "employment type conflicts",
    );
  });
});

describe("occupation, career-stage, stack, and geography calibration", () => {
  const buildSeniorEngineeringScene = () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Software Engineer",
      currentLocation: "Philadelphia, PA, United States",
      currentCountry: "United States",
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      skillGroups: {
        ...seed.profile.skillGroups,
        coreSkills: ["TypeScript", "React", "Node.js"],
      },
      experiences: [
        {
          ...seed.profile.experiences[0]!,
          id: "senior-role",
          title: "Senior Software Engineer",
          skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        },
      ],
    };
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer"],
      locations: ["Philadelphia, PA"],
      workModes: ["remote" as const],
      seniorityLevels: [],
      minimumSalaryUsd: null,
    };
    const assess = (title: string, description: string, location = "Remote") =>
      createMatchAssessment(profile, preferences, {
        ...seed.savedJobs[0]!,
        sourceJobId: title.toLowerCase().replaceAll(" ", "_"),
        title,
        description,
        location,
        workMode: ["remote"],
        keySkills: [],
        keywordSignals: [],
        responsibilities: [],
        minimumQualifications: [],
        preferredQualifications: [],
        screeningHints: {
          ...seed.savedJobs[0]!.screeningHints,
          remoteGeographies: [],
        },
      });
    return { assess };
  };

  test("keeps a matching senior stack above clerical, trade, and student roles", () => {
    const { assess } = buildSeniorEngineeringScene();
    const senior = assess(
      "Senior Software Engineer",
      "Build TypeScript and React services with Node.js and PostgreSQL.",
    );
    const dataEntry = assess(
      "Data Entry Clerk",
      "Enter customer records and maintain filing accuracy.",
    );
    const technician = assess(
      "Building Maintenance Technician",
      "Maintain HVAC, electrical systems, and building equipment.",
    );
    const student = assess(
      "Student Software Engineering Intern",
      "An entry-level internship using TypeScript and React.",
    );

    expect(senior.score).toBeGreaterThan(student.score + 10);
    expect(student.score).toBeGreaterThan(dataEntry.score);
    expect(student.score).toBeGreaterThan(technician.score);
    expect(dataEntry.score).toBeLessThanOrEqual(39);
    expect(technician.score).toBeLessThanOrEqual(39);
    expect(student.gaps.join(" ")).toContain("entry-level");
  });

  test("keeps an unrelated occupation well below a same-family senior role", () => {
    const { assess } = buildSeniorEngineeringScene();
    const senior = assess(
      "Member of Technical Staff Engineering",
      "Own senior TypeScript, React, Node.js, and PostgreSQL platform work.",
    );
    const unrelated = assess(
      "Data Steward",
      "Maintain records, governance catalogs, and data-entry quality.",
    );

    expect(senior.score).toBeGreaterThan(unrelated.score + 20);
    expect(unrelated.score).toBeLessThanOrEqual(39);
    expect(unrelated.recommendation).toBe("skip");
  });

  test("does not rank a non-English mid-level listing over a same-family senior listing", () => {
    const { assess } = buildSeniorEngineeringScene();
    const senior = assess(
      "Senior Software Engineer",
      "Build TypeScript and React services with Node.js and PostgreSQL.",
    );
    const midLevel = assess(
      "Desenvolvedor de Software Pleno",
      "Desenvolver aplicações e colaborar com a equipe de produto.",
    );

    expect(senior.score).toBeGreaterThan(midLevel.score);
  });

  test("requires a travel-requirement sentence rather than an industry word", () => {
    const seed = createSeed();
    const industryMention = enrichDiscoveredPosting(
      {
        ...seed.savedJobs[0]!,
        description: "Build software for a travel technology company.",
        screeningHints: {
          ...seed.savedJobs[0]!.screeningHints,
          travelText: null,
        },
      },
      undefined,
    );
    const requiredTravel = enrichDiscoveredPosting(
      {
        ...seed.savedJobs[0]!,
        description: "This role requires travel up to 20% of the time.",
        screeningHints: {
          ...seed.savedJobs[0]!.screeningHints,
          travelText: null,
        },
      },
      undefined,
    );

    expect(industryMention.screeningHints.travelText).toBeNull();
    expect(requiredTravel.screeningHints.travelText).toBe(
      "Travel expectations are mentioned in the listing.",
    );
  });

  test("moves related roles materially with stack overlap", () => {
    const { assess } = buildSeniorEngineeringScene();
    const overlapping = assess(
      "Senior Software Engineer",
      "Build TypeScript, React, Node.js, and PostgreSQL systems.",
    );
    const different = assess(
      "Senior Software Engineer",
      "Build Java, Kotlin, Spring, and Kubernetes systems.",
    );
    expect(overlapping.score).toBeGreaterThan(different.score + 10);
  });

  test("treats a mixed worldwide and country restriction as restrictive", () => {
    const { assess } = buildSeniorEngineeringScene();
    const restricted = assess(
      "Senior Software Engineer",
      "Remote role for people located in Thailand. TypeScript and React.",
      "Anywhere, Thailand",
    );
    const geography = restricted.requirements.find(
      (requirement) => requirement.id === "requirement_location_remote_geography_eligibility",
    );
    expect(geography?.status).toBe("conflict");
    expect(restricted.reasons.join(" ")).not.toContain("Location fits");
  });
});
