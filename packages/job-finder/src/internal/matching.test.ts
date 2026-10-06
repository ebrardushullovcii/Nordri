import { describe, expect, test } from "vitest";

import { buildDiscoveryJobs, matchesExcludedLocation } from "./matching";
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
