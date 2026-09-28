import { describe, expect, it } from "vitest";
import type { MatchAssessment, SavedJob } from "@nordri/contracts";
import { createSavedJob } from "../workspace-service.test-fixtures";
import {
  TITLE_MATCHES_TARGET_ROLES_REASON,
  TITLE_MISSES_TARGET_ROLES_GAPS,
} from "../discovery-ordering";
import { getDiscoveryResultGroup } from "../discovery-result-bands";
import {
  isTargetTitleFamily,
  resolveTitleFamilyMatch,
} from "./discovery-title-family";

function assessment(overrides: Partial<MatchAssessment> = {}): MatchAssessment {
  return {
    scorerVersion: 9,
    score: 48,
    scoreIsUpperBound: false,
    contextFingerprint: "ctx",
    postingFingerprint: "post",
    compensationFit: {},
    locationReach: "unknown",
    dimensions: {},
    reasons: [],
    gaps: [],
    recommendation: "review_before_applying",
    recommendationRationale: "test",
    requirements: [],
    ...overrides,
  } as unknown as MatchAssessment;
}

function titleOnlyJob(matchAssessment: MatchAssessment): SavedJob {
  return createSavedJob({
    id: "job_family",
    source: "target_site",
    sourceJobId: "1",
    discoveryMethod: "browser_agent",
    canonicalUrl: "https://jobs.example.test/1",
    applicationUrl: null,
    title: "Executive Assistant I",
    company: "Example Co",
    location: "Chicago, IL",
    workMode: [],
    applyPath: "unknown",
    easyApplyEligible: false,
    postedAt: null,
    postedAtText: null,
    discoveredAt: "2026-09-05T09:58:00.000Z",
    firstSeenAt: "2026-09-05T09:58:00.000Z",
    lastSeenAt: "2026-09-05T09:58:00.000Z",
    lastVerifiedActiveAt: null,
    salaryText: null,
    summary: null,
    description: "Executive Assistant I",
    keySkills: [],
    responsibilities: [],
    minimumQualifications: [],
    preferredQualifications: [],
    seniority: null,
    employmentType: null,
    department: null,
    team: null,
    employerWebsiteUrl: null,
    employerDomain: null,
    atsProvider: null,
    keywordSignals: [],
    benefits: [],
    status: "discovered",
    matchAssessment,
    provenance: [],
  } as Parameters<typeof createSavedJob>[0]);
}

describe("resolveTitleFamilyMatch", () => {
  it("prefers the recorded verdict when the scorer wrote one", () => {
    expect(
      resolveTitleFamilyMatch(
        assessment({
          titleFamilyMatch: "same_family",
          gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[0]!],
        }),
      ),
    ).toBe("same_family");
  });

  it("reads an exact title hit from the scorer's own reason", () => {
    expect(
      resolveTitleFamilyMatch(
        assessment({ reasons: [TITLE_MATCHES_TARGET_ROLES_REASON] }),
      ),
    ).toBe("same_family");
  });

  it("separates an adjacent title from one outside the saved families", () => {
    expect(
      resolveTitleFamilyMatch(
        assessment({ gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[2]!] }),
      ),
    ).toBe("adjacent");
    expect(
      resolveTitleFamilyMatch(
        assessment({ gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[0]!] }),
      ),
    ).toBe("unrelated");
    expect(
      resolveTitleFamilyMatch(
        assessment({ gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[1]!] }),
      ),
    ).toBe("unrelated");
  });

  it("reports null rather than 'unrelated' when the question was never asked", () => {
    expect(resolveTitleFamilyMatch(assessment())).toBeNull();
    expect(isTargetTitleFamily(assessment())).toBe(false);
  });
});

describe("banding a title-family match whose score is withheld", () => {
  it("keeps an adjacent title in the main results instead of burying it", () => {
    const job = titleOnlyJob(
      assessment({ gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[2]!] }),
    );
    expect(getDiscoveryResultGroup(job)).toBe("unchecked");
  });

  it("still demotes a title the scorer placed outside the saved families", () => {
    const job = titleOnlyJob(
      assessment({ gaps: [TITLE_MISSES_TARGET_ROLES_GAPS[0]!] }),
    );
    expect(getDiscoveryResultGroup(job)).toBe("weaker");
  });
});
