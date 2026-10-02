import { describe, expect, test } from "vitest";

import {
  assessLocationCompatibility,
  buildDiscoveryJobs,
  matchesAnyPhrase,
  matchesExcludedLocation,
  matchesTitlePreference,
  type LocationCompatibilityState,
} from "./matching";
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
});
