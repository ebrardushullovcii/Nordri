import type { CandidateProfile, JobPosting } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { createSeed } from "../workspace-service.test-fixtures";
import { createMatchAssessment } from "./matching";
import {
  buildCareerStageRequirement,
  detectListingCareerStage,
  deriveProfileCareerStage,
} from "./matching-career-stage";

function seniorProfile(overrides: Partial<CandidateProfile> = {}) {
  const seed = createSeed();
  return {
    ...seed.profile,
    headline: "Senior Software Engineer",
    yearsExperience: 10,
    ...overrides,
  };
}

function posting(overrides: Partial<JobPosting> = {}) {
  const seed = createSeed();
  return {
    ...seed.savedJobs[0]!,
    title: "Software Engineer",
    summary: "",
    description: "Build reliable software for customers.",
    keySkills: [],
    minimumQualifications: [],
    preferredQualifications: [],
    responsibilities: [],
    seniority: null,
    ...overrides,
  };
}

describe("detectListingCareerStage", () => {
  test("reads a programme title as an entry-programme opening", () => {
    expect(
      detectListingCareerStage(
        posting({ title: "Software Engineer | Early Careers, 2027 Start" }),
      ),
    ).toEqual({
      stage: "entry_programme",
      evidence: "Software Engineer | Early Careers, 2027 Start",
    });
  });

  test.each([
    "Graduate Software Engineer Programme",
    "Software Engineering Intern",
    "Backend Engineer (Entry-Level)",
    "Software Engineer — Class of 2027",
    "Apprentice Developer",
  ])("recognises %s as an entry-programme title", (title) => {
    expect(detectListingCareerStage(posting({ title }))?.stage).toBe(
      "entry_programme",
    );
  });

  test("an experienced title wins over incidental programme wording", () => {
    expect(
      detectListingCareerStage(
        posting({
          title: "Senior Software Engineer",
          description: "You will mentor our interns and graduate hires.",
        }),
      ),
    ).toEqual({ stage: "experienced", evidence: "Senior Software Engineer" });
  });

  test("a dated future start alone is not a career-stage signal", () => {
    expect(
      detectListingCareerStage(
        posting({
          title: "Software Engineer",
          description: "This role has a January 2027 start.",
        }),
      ),
    ).toBeNull();
  });

  test("a dated future start beside a study-status requirement is", () => {
    expect(
      detectListingCareerStage(
        posting({
          title: "Software Engineer",
          description:
            "The cohort starts in 2027. You must be currently enrolled in a degree programme.",
        }),
      )?.stage,
    ).toBe("entry_programme");
  });

  test("an ordinary listing with no stated stage stays unknown", () => {
    expect(detectListingCareerStage(posting())).toBeNull();
  });
});

describe("deriveProfileCareerStage", () => {
  test("an explicit senior headline is senior", () => {
    expect(
      deriveProfileCareerStage(seniorProfile(), { targetRoles: [] })?.stage,
    ).toBe("senior");
  });

  test("a long timeline without seniority wording is still senior", () => {
    expect(
      deriveProfileCareerStage(
        seniorProfile({ headline: "Software Engineer", yearsExperience: 9 }),
        { targetRoles: [] },
      )?.stage,
    ).toBe("senior");
  });

  test("saved target roles contribute seniority evidence", () => {
    expect(
      deriveProfileCareerStage(
        seniorProfile({ headline: "Software Engineer", yearsExperience: 4 }),
        { targetRoles: ["Senior Software Engineer"] },
      )?.stage,
    ).toBe("senior");
  });

  test("a graduate profile with no timeline is early career", () => {
    expect(
      deriveProfileCareerStage(
        seniorProfile({
          headline: "Graduate Developer",
          yearsExperience: 0,
          experiences: [],
        }),
        { targetRoles: [] },
      )?.stage,
    ).toBe("early_career");
  });

  test("an unstated stage with a short timeline stays unknown", () => {
    expect(
      deriveProfileCareerStage(
        seniorProfile({
          headline: "Software Engineer",
          yearsExperience: 1,
          experiences: [],
        }),
        { targetRoles: ["Software Engineer"] },
      ),
    ).toBeNull();
  });

  test("the current role title still contributes seniority evidence", () => {
    const profile = seniorProfile({
      headline: "Software Engineer",
      yearsExperience: 1,
    });
    expect(profile.experiences[0]?.title).toBeTruthy();
    expect(deriveProfileCareerStage(profile, { targetRoles: [] })?.stage).toBe(
      "senior",
    );
  });
});

describe("buildCareerStageRequirement", () => {
  test("an early-careers opening conflicts with a senior profile", () => {
    const requirement = buildCareerStageRequirement({
      profile: seniorProfile(),
      posting: posting({
        title: "Software Engineer | Early Careers, 2027 Start",
      }),
      searchPreferences: { targetRoles: ["Senior Software Engineer"] },
    });

    expect(requirement).not.toBeNull();
    expect(requirement?.category).toBe("seniority");
    expect(requirement?.importance).toBe("required");
    expect(requirement?.status).toBe("conflict");
    expect(requirement?.jobEvidence).toContain("Early Careers");
    expect(requirement?.resumeEvidence).toHaveLength(1);
  });

  test("an early-careers opening supports an early-career profile", () => {
    const requirement = buildCareerStageRequirement({
      profile: seniorProfile({
        headline: "Graduate Developer",
        yearsExperience: 0,
        experiences: [],
      }),
      posting: posting({ title: "Graduate Software Engineer Programme" }),
      searchPreferences: { targetRoles: [] },
    });

    expect(requirement?.status).toBe("supported");
  });

  test("emits nothing when either side is unknown", () => {
    expect(
      buildCareerStageRequirement({
        profile: seniorProfile(),
        posting: posting(),
        searchPreferences: { targetRoles: [] },
      }),
    ).toBeNull();
    expect(
      buildCareerStageRequirement({
        profile: seniorProfile({
          headline: "Software Engineer",
          yearsExperience: 1,
          experiences: [],
        }),
        posting: posting({ title: "Graduate Software Engineer Programme" }),
        searchPreferences: { targetRoles: ["Software Engineer"] },
      }),
    ).toBeNull();
  });

  test("an ordinary experienced listing adds no requirement row", () => {
    expect(
      buildCareerStageRequirement({
        profile: seniorProfile(),
        posting: posting({ title: "Senior Software Engineer" }),
        searchPreferences: { targetRoles: ["Senior Software Engineer"] },
      }),
    ).toBeNull();
  });
});

describe("career stage inside the whole assessment", () => {
  test("an early-careers posting no longer ties a senior posting", () => {
    const seed = createSeed();
    const profile = seniorProfile();
    const preferences = {
      ...seed.searchPreferences,
      targetRoles: ["Senior Software Engineer", ".NET Developer"],
    };

    const earlyCareers = createMatchAssessment(
      profile,
      preferences,
      posting({ title: "Software Engineer | Early Careers, 2027 Start" }),
    );
    const senior = createMatchAssessment(
      profile,
      preferences,
      posting({ title: "Senior Software Engineer" }),
    );

    expect(earlyCareers.recommendation).toBe("skip");
    expect(earlyCareers.recommendationRationale).toContain("Career stage");
    expect(earlyCareers.dimensions.roleSuitability.state).toBe("conflict");
    expect(earlyCareers.score).toBeLessThan(senior.score);
    expect(earlyCareers.score).toBeLessThanOrEqual(39);
  });
});
