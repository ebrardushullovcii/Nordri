import { describe, expect, test } from "vitest";

import {
  buildFitEvidenceInstructions,
  buildJobFitJudgingPayload,
  buildJobFitJudgingPrompt,
  normalizeJobFitJudgments,
} from "./openai-compatible-fit";

import {
  createProfile,
  createPreferences,
  createJobPosting,
} from "./test-fixtures";

describe("batch fit judging", () => {
  test("gives both judges explicit country and office constraints (R3-017)", () => {
    const prompt = buildJobFitJudgingPrompt();
    expect(prompt).toContain(buildFitEvidenceInstructions());
    expect(prompt).toContain("never overrides a country restriction");
    expect(prompt).toContain("actual office city");
    const profile = createProfile();
    profile.answerBank.workAuthorization = "Canada only";
    profile.answerBank.visaSponsorship = "Required outside Canada";
    const payload = buildJobFitJudgingPayload({
      assessmentDate: "2026-10-04",
      profile,
      searchPreferences: createPreferences(),
      jobs: [],
    });
    expect(payload.person.workEligibility).toEqual(profile.workEligibility);
    expect(payload.person.savedEligibilityAnswers.workAuthorization).toBe(
      "Canada only",
    );
  });
  test("keeps late requirements and labels sparse evidence provisional (R3-018)", () => {
    const posting = createJobPosting();
    posting.description =
      "About our company. ".repeat(100) + "Java and Dutch C1 are required.";
    const payload = buildJobFitJudgingPayload({
      assessmentDate: "2026-10-04",
      profile: createProfile(),
      searchPreferences: createPreferences(),
      jobs: [{ jobId: "one", posting }],
    });
    expect(payload.jobs[0]?.description).toContain("Java and Dutch C1");
    expect(payload.jobs[0]?.detailQuality).toBe(posting.detailQuality);
    expect(buildFitEvidenceInstructions()).toContain("do not claim strong fit");
  });
  test("includes saved availability and requires comparison of immediate starts (R3-052)", () => {
    const profile = createProfile();
    profile.answerBank.availability = "September";
    const payload = buildJobFitJudgingPayload({
      assessmentDate: "2026-10-04",
      profile,
      searchPreferences: createPreferences(),
      jobs: [],
    });
    expect(payload.person.savedEligibilityAnswers.availability).toBe(
      "September",
    );
    expect(buildFitEvidenceInstructions()).toContain(
      "ambiguous month without a year",
    );
  });
  test("does not infer a junior level from missing seniority (R3-204)", () => {
    expect(buildFitEvidenceInstructions()).toContain(
      "Missing seniority means level not confirmed",
    );
  });
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
            summary: "A product design role in Berlin that asks for German C1.",
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
      summary: "A product design role in Berlin that asks for German C1.",
      listingClosed: false,
      listingClosedEvidence: null,
    });
  });

  test("reads the job id under the key names models use", () => {
    const judgments = normalizeJobFitJudgments(
      {
        judgments: [
          { job_id: "job_1", score: 70, recommendation: "strong_fit" },
          { id: "job_2", score: 40, recommendation: "skip" },
        ],
      },
      new Set(["job_1", "job_2"]),
    );

    expect(judgments.map((judgment) => judgment.jobId)).toEqual([
      "job_1",
      "job_2",
    ]);
  });

  test("reads a closed listing with the words that say so", () => {
    const [judgment] = normalizeJobFitJudgments(
      {
        judgments: [
          {
            jobId: "job_1",
            score: 5,
            recommendation: "skip",
            listingClosed: true,
            listingClosedEvidence: "This position has been filled.",
          },
        ],
      },
      new Set(["job_1"]),
    );
    expect(judgment).toMatchObject({
      listingClosed: true,
      listingClosedEvidence: "This position has been filled.",
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

test("bounds twenty-job batch evidence while keeping eligibility facts", () => {
  const profile = createProfile();
  profile.baseResume.textContent = "Synthetic imported resume. ".repeat(500);
  const posting = createJobPosting();
  posting.description =
    "Build reliable product interfaces. ".repeat(150) +
    "Java and Dutch C1 are required.";
  posting.minimumQualifications = Array.from(
    { length: 30 },
    (_, i) => `Requirement ${i}`,
  );
  posting.responsibilities = Array.from(
    { length: 20 },
    (_, i) => `Responsibility ${i}`,
  );
  posting.preferredQualifications = Array.from(
    { length: 20 },
    (_, i) => `Preferred ${i}`,
  );
  profile.projects = Array.from({ length: 20 }, (_, i) => ({
    id: `project_${i}`,
    name: "Project",
    projectType: null,
    summary: "Project facts ".repeat(200),
    role: "Developer",
    outcome: null,
    skills: ["React"],
    projectUrl: null,
    repositoryUrl: null,
    caseStudyUrl: null,
  }));
  profile.proofBank = Array.from({ length: 20 }, (_, i) => ({
    id: `proof_${i}`,
    title: "Proof",
    claim: "Saved facts ".repeat(100),
    heroMetric: null,
    supportingContext: null,
    roleFamilies: [],
    projectIds: [],
    linkIds: [],
  }));
  const payload = buildJobFitJudgingPayload({
    assessmentDate: "2026-10-04",
    profile,
    searchPreferences: createPreferences(),
    jobs: Array.from({ length: 20 }, (_, i) => ({
      jobId: `job_${i}`,
      posting,
    })),
  });
  expect(payload.jobs).toHaveLength(20);
  expect(payload.jobs[0]?.description.length).toBeLessThanOrEqual(3000);
  expect(payload.jobs[0]?.description).toContain("Java and Dutch C1");
  expect(payload.jobs[0]?.evidenceOmitted).toBe(true);
  expect(payload.jobs[0]?.requirements).toHaveLength(12);
  expect(payload.jobs[0]?.responsibilities).toHaveLength(8);
  expect(payload.jobs[0]?.preferredQualifications).toHaveLength(8);
  expect(payload.person).not.toHaveProperty("importedResumeText");
  expect(payload.person.projects).toHaveLength(8);
  expect(payload.person.proofBank).toHaveLength(8);
  expect(payload.person.workEligibility).toEqual(profile.workEligibility);
  expect(buildJobFitJudgingPrompt()).toContain("bounded excerpts");
});

test("measures the twenty-job request against the previous uncapped shape", () => {
  const profile = createProfile();
  profile.baseResume.textContent =
    "Synthetic experience building accessible React interfaces and improving frontend delivery. ".repeat(
      120,
    );
  const posting = createJobPosting();
  posting.description =
    "Build product interfaces for customer workflows. Own the React component library, partner with design on accessibility, instrument usage analytics, and lead migration away from the legacy checkout surface. ".repeat(
      24,
    );
  const payload = buildJobFitJudgingPayload({
    assessmentDate: "2026-10-04",
    profile,
    searchPreferences: createPreferences(),
    jobs: Array.from({ length: 20 }, (_, i) => ({
      jobId: `job_${i}`,
      posting,
    })),
  });
  const previous = {
    ...payload,
    person: {
      ...payload.person,
      projects: profile.projects,
      proofBank: profile.proofBank,
      importedResumeText: profile.baseResume.textContent,
    },
    jobs: payload.jobs.map(({ evidenceOmitted, ...job }) => {
      expect(evidenceOmitted).toBe(true);
      return {
        ...job,
        description: posting.description,
        responsibilities: posting.responsibilities,
        requirements: posting.minimumQualifications,
        preferredQualifications: posting.preferredQualifications,
      };
    }),
  };
  const before = new TextEncoder().encode(JSON.stringify(previous)).length;
  const after = new TextEncoder().encode(JSON.stringify(payload)).length;
  console.info(
    `20-job synthetic batch JSON bytes: before=${before}, after=${after}`,
  );
  expect(after).toBeLessThan(before);
});
