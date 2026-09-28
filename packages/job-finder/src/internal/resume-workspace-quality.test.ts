import { describe, expect, test } from "vitest";

import type { ResumeDraft, ResumeDraftEntry } from "@nordri/contracts";
import {
  ResumeClaimConfirmationSchema,
  ResumeDraftSchema,
  resumeClaimOwnershipStatement,
} from "@nordri/contracts";
import { fnv1a32 } from "@nordri/core";
import { ResumeGenerationStrategyPolicySchema } from "@nordri/ai-providers";
import {
  buildResumeCoverageComparison,
  buildResumeDraftContentHash,
  buildResumeDraftFromTailoredDraft,
  hasBlockingResumeClaimAssessment,
  sanitizeResumeDraft,
  seedResumeDraft,
  validateResumeDraft,
} from "./resume-workspace-helpers";
import { createEntry } from "./resume-workspace-primitives";
import { normalizeText } from "./shared";
import { createSeed } from "../workspace-service.test-support";

function createBullets(prefix: string, texts: string[]) {
  return texts.map((text, index) => ({
    id: `${prefix}_${index + 1}`,
    text,
    origin: "ai_generated" as const,
    locked: false,
    included: true,
    sourceRefs: [],
    lastGeneratedContentHash: null,
    updatedAt: "2026-03-20T10:04:00.000Z",
  }));
}

function createBaseDraft(): ResumeDraft {
  return {
    id: "resume_draft_job_ready",
    jobId: "job_ready",
    status: "draft",
    templateId: "classic_ats",
    identity: null,
    sections: [
      {
        id: "section_summary",
        kind: "summary",
        label: "Summary",
        text: "Grounded summary.",
        bullets: [],
        entries: [],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 0,
        entryOrderMode: "chronology",
        profileRecordId: null,
        sourceRefs: [],
        updatedAt: "2026-03-20T10:04:00.000Z",
      },
      {
        id: "section_skills",
        kind: "skills",
        label: "Core Skills",
        text: null,
        bullets: createBullets("skill_bullet", ["Figma"]),
        entries: [],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 1,
        entryOrderMode: "chronology",
        profileRecordId: null,
        sourceRefs: [],
        updatedAt: "2026-03-20T10:04:00.000Z",
      },
      {
        id: "section_experience",
        kind: "experience",
        label: "Experience",
        text: null,
        bullets: [],
        entries: [
          {
            id: "experience_1",
            entryType: "experience",
            title: "Senior systems designer",
            subtitle: "Orbit Commerce",
            location: "London, UK",
            dateRange: "2020-01 – Present",
            startDate: "2020-01",
            endDate: null,
            isCurrent: true,
            summary: "Builds resilient workflow tools.",
            bullets: createBullets("experience_bullet", [
              "Led design-system rollout across core surfaces.",
            ]),
            origin: "ai_generated",
            locked: false,
            included: true,
            sortOrder: 0,
            profileRecordId: "experience_1",
            sourceRefs: [],
            updatedAt: "2026-03-20T10:04:00.000Z",
          },
        ],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 2,
        entryOrderMode: "chronology",
        profileRecordId: null,
        sourceRefs: [],
        updatedAt: "2026-03-20T10:04:00.000Z",
      },
    ],
    targetPageCount: 2,
    generationMethod: "ai",
    approvedAt: null,
    approvedExportId: null,
    staleReason: null,
    workHistoryReviewAcknowledgments: [],
    claimConfirmations: [],
    issueApprovals: [],
    createdAt: "2026-03-20T10:04:00.000Z",
    updatedAt: "2026-03-20T10:04:00.000Z",
  };
}

function updateSection(
  draft: ResumeDraft,
  sectionId: string,
  updater: (
    section: ResumeDraft["sections"][number],
  ) => ResumeDraft["sections"][number],
): ResumeDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) =>
      section.id === sectionId ? updater(section) : section,
    ),
  };
}

function getSection(draft: ResumeDraft, sectionId: string) {
  const section = draft.sections.find((entry) => entry.id === sectionId);

  if (!section) {
    throw new Error(`Missing section '${sectionId}' in test draft.`);
  }

  return section;
}

function getExperienceEntry(draft: ResumeDraft) {
  const experienceSection = getSection(draft, "section_experience");
  const entry = experienceSection.entries[0];

  if (!entry) {
    throw new Error("Expected an experience entry in the test draft.");
  }

  return entry;
}

function createDuplicateExperienceEntry(
  source: ResumeDraftEntry,
): ResumeDraftEntry {
  return {
    ...source,
    id: "experience_2",
    title: "Principal systems designer",
    bullets: createBullets("experience_duplicate", [
      "Led design-system rollout across core surfaces.",
    ]),
  };
}

function getSeedContext() {
  const seed = createSeed();
  const profile = seed.profile;
  const job = seed.savedJobs.find((entry) => entry.id === "job_ready");

  if (!job) {
    throw new Error("job not found: job_ready");
  }

  return { profile, job };
}

describe("resume workspace quality helpers", () => {
  test("never calls the candidate's own verbatim sentence unsupported", () => {
    // The verifier was flagging lines lifted straight out of the person's own
    // imported resume. Whatever else it can say about such a line, it cannot
    // say the product invented it.
    const { profile, job } = getSeedContext();
    const ownSentence =
      "Architected a quantum operating model for global logistics teams.";
    const profileWithOwnSentence = {
      ...profile,
      baseResume: {
        ...profile.baseResume,
        textContent: `${profile.baseResume.textContent ?? ""}
${ownSentence}`,
      },
    };
    const draft = ResumeDraftSchema.parse({
      id: "resume_draft_own_verbatim",
      jobId: job.id,
      status: "draft",
      templateId: "classic_ats",
      generationMethod: "ai",
      sections: [
        {
          id: "section_experience",
          kind: "experience",
          label: "Experience",
          origin: "ai_generated",
          sortOrder: 0,
          entries: [
            {
              id: "entry_own_verbatim",
              entryType: "experience",
              title: "Senior systems designer",
              subtitle: "Signal Systems",
              origin: "ai_generated",
              sortOrder: 0,
              profileRecordId: "experience_1",
              bullets: [
                {
                  id: "bullet_own_verbatim",
                  text: ownSentence,
                  origin: "ai_generated",
                  updatedAt: "2026-08-17T10:00:00.000Z",
                },
              ],
              updatedAt: "2026-08-17T10:00:00.000Z",
            },
          ],
          updatedAt: "2026-08-17T10:00:00.000Z",
        },
      ],
      createdAt: "2026-08-17T10:00:00.000Z",
      updatedAt: "2026-08-17T10:00:00.000Z",
    });

    const withoutOwnResume = validateResumeDraft({
      draft,
      job,
      profile,
      validatedAt: "2026-08-17T10:00:00.000Z",
    });
    const withOwnResume = validateResumeDraft({
      draft,
      job,
      profile: profileWithOwnSentence,
      validatedAt: "2026-08-17T10:00:00.000Z",
    });

    expect(
      withoutOwnResume.claimAssessments.find(
        (assessment) => assessment.bulletId === "bullet_own_verbatim",
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(
      withOwnResume.claimAssessments.find(
        (assessment) => assessment.bulletId === "bullet_own_verbatim",
      ),
    ).toMatchObject({ status: "exact" });
  });

  test("enforces selected strategy evidence boundaries while still rejecting unsupported claims", () => {
    const { profile, job } = getSeedContext();
    const draft = ResumeDraftSchema.parse({
      id: "resume_draft_strategy_boundary",
      jobId: job.id,
      status: "draft",
      templateId: "classic_ats",
      generationMethod: "ai",
      sections: [
        {
          id: "section_experience",
          kind: "experience",
          label: "Experience",
          origin: "ai_generated",
          sortOrder: 0,
          entries: [
            {
              id: "entry_strategy_boundary",
              entryType: "experience",
              title: "Senior systems designer",
              subtitle: "Signal Systems",
              origin: "ai_generated",
              sortOrder: 0,
              profileRecordId: "experience_1",
              bullets: [
                {
                  id: "bullet_exact_boundary",
                  text: "Led design-system rollout across core surfaces.",
                  origin: "ai_generated",
                  updatedAt: "2026-08-17T10:00:00.000Z",
                },
                {
                  id: "bullet_unsupported_boundary",
                  text: "Architected a quantum operating model for global logistics teams.",
                  origin: "ai_generated",
                  updatedAt: "2026-08-17T10:00:00.000Z",
                },
              ],
              updatedAt: "2026-08-17T10:00:00.000Z",
            },
          ],
          updatedAt: "2026-08-17T10:00:00.000Z",
        },
      ],
      createdAt: "2026-08-17T10:00:00.000Z",
      updatedAt: "2026-08-17T10:00:00.000Z",
    });
    const strategy = ResumeGenerationStrategyPolicySchema.parse({
      strategyId: "strategy_strict_evidence",
      strategyName: "Strict evidence",
      roleFamily: "Product Design",
      baseResumeDocumentId: profile.baseResume.id,
      templateId: "classic_ats",
      headlinePolicy: "fixed",
      skillsPolicy: "base_only",
      coveragePolicy: "base_omissions",
      tailoringStrength: "conservative",
      evidenceBoundaries: {
        allowExactClaims: false,
        allowParaphrasedClaims: false,
        maxEvidenceRefsPerBullet: 3,
        requireVerifierPass: true,
      },
      effectiveSource: "selection",
      effectiveReason: "The user selected strict evidence handling.",
      recommendationSource: "none",
      recommendationReason: null,
      selectionSource: "user",
      selectionReason: "The user selected this strategy.",
    });

    const validation = validateResumeDraft({
      draft,
      job,
      profile,
      strategy,
      validatedAt: "2026-08-17T10:00:00.000Z",
    });
    const exactClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "bullet_exact_boundary",
    );
    const unsupportedClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "bullet_unsupported_boundary",
    );

    expect(exactClaim).toMatchObject({
      claimOrigin: "ai_generated",
      status: "exact",
    });
    expect(
      validation.issues.some(
        (issue) =>
          issue.id.startsWith("issue_strategy_evidence_boundary_") &&
          issue.bulletId === "bullet_exact_boundary" &&
          issue.category === "unsupported_claim" &&
          issue.severity === "error",
      ),
    ).toBe(true);
    expect(unsupportedClaim).toMatchObject({
      claimOrigin: "ai_generated",
      status: "unsupported",
      evidenceRefs: [],
    });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bulletId: "bullet_unsupported_boundary",
          category: "unsupported_claim",
          severity: "error",
        }),
      ]),
    );
  });

  test("sanitizeResumeDraft drops how-the-job-ended sentences from a generated summary", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_summary",
      (section) => ({
        ...section,
        text: "Product designer focused on reliable workflow software. Position ended in a company-wide reduction in July 2026.",
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job, profile });

    expect(getSection(sanitized, "section_summary").text).toBe(
      "Product designer focused on reliable workflow software.",
    );
  });

  test("sanitizeResumeDraft removes visible company and job-only skill bleed", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", [
          "Figma",
          "Signal Systems",
          "Remote-first collaboration",
        ]),
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job, profile });
    const visibleSkills = getSection(sanitized, "section_skills").bullets.map(
      (bullet) => bullet.text,
    );

    expect(visibleSkills).toEqual(["Figma"]);
  });

  test("sanitizeResumeDraft keeps job-listing technologies in the skills section", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: [...job.keySkills, "Kubernetes"],
      minimumQualifications: [
        ...job.minimumQualifications,
        "Kubernetes experience required.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Kubernetes", "Figma"]),
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job: listingJob, profile });
    const visibleSkills = getSection(sanitized, "section_skills").bullets.map(
      (bullet) => bullet.text,
    );

    expect(visibleSkills).toEqual(["Kubernetes", "Figma"]);
  });

  test("validateResumeDraft maps a job-listing skill bullet to confirm_needed", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: [...job.keySkills, "Kubernetes"],
      description: `${job.description} Kubernetes required.`,
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Kubernetes"]),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile,
    });

    expect(
      validation.claimAssessments.find(
        (assessment) => assessment.bulletId === "skill_bullet_1",
      ),
    ).toMatchObject({ status: "confirm_needed" });
    // The same skill without the job ever asking for it stays unsupported.
    const unsupported = validateResumeDraft({ draft, job, profile });
    expect(
      unsupported.claimAssessments.find(
        (assessment) => assessment.bulletId === "skill_bullet_1",
      ),
    ).toMatchObject({ status: "unsupported" });
  });

  test("validateResumeDraft does not ask to confirm a listing skill the profile already has under an alias", () => {
    const { profile, job } = getSeedContext();
    const profileWithPostgres = {
      ...profile,
      skills: [...profile.skills, "PostgreSQL"],
      skillGroups: {
        ...profile.skillGroups,
        coreSkills: [...profile.skillGroups.coreSkills, "PostgreSQL"],
      },
    };
    const listingJob = {
      ...job,
      keySkills: [...job.keySkills, "Postgres"],
      description: `${job.description} Postgres required.`,
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Postgres"]),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile: profileWithPostgres,
    });

    expect(
      validation.claimAssessments.find(
        (assessment) => assessment.bulletId === "skill_bullet_1",
      ),
    ).toMatchObject({ status: "exact" });
  });

  test("sanitizeResumeDraft drops Europass language chrome from skills and languages", () => {
    const { profile, job } = getSeedContext();
    const profileWithLanguages = {
      ...profile,
      spokenLanguages: [
        ...profile.spokenLanguages,
        {
          id: "language_albanian",
          language: "Albanian",
          proficiency: "Native",
          interviewPreference: true,
          notes: null,
        },
      ],
    };
    const skillsDraft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", [
          "Figma",
          "Mother Tongue(S) — ALBANIAN",
          "English — C2",
        ]),
      }),
    );
    const languageSection = {
      ...getSection(skillsDraft, "section_skills"),
      id: "section_languages",
      label: "Languages",
      bullets: createBullets("language_bullet", [
        "Albanian — Native",
        "Levels — A1 and A2: Basic user; B1 and B2: Independent user",
      ]),
    };
    const draft = {
      ...skillsDraft,
      sections: [...skillsDraft.sections, languageSection],
    };

    const sanitized = sanitizeResumeDraft({
      draft,
      job,
      profile: profileWithLanguages,
    });
    const visibleSkills = getSection(sanitized, "section_skills").bullets.map(
      (bullet) => bullet.text,
    );
    const visibleLanguages = getSection(
      sanitized,
      "section_languages",
    ).bullets.map((bullet) => bullet.text);

    expect(visibleSkills).toEqual(["Figma"]);
    expect(visibleLanguages).toEqual(["Albanian — Native"]);
  });

  test("sanitizeResumeDraft keeps a qualification-only listing technology in the skills section", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: job.keySkills,
      minimumQualifications: [
        ...job.minimumQualifications,
        "Hands-on experience with Terraform.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Terraform", "Figma"]),
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job: listingJob, profile });
    const visibleSkills = getSection(sanitized, "section_skills").bullets.map(
      (bullet) => bullet.text,
    );

    expect(visibleSkills).toEqual(["Terraform", "Figma"]);
  });

  test("sanitizeResumeDraft drops listing responsibility sentences from the skills section", () => {
    const { profile, job } = getSeedContext();
    const profileWithReact = {
      ...profile,
      skills: [...profile.skills, "React", "Next.js", "TypeScript"],
    };
    const listingJob = {
      ...job,
      responsibilities: [
        ...job.responsibilities,
        "Own React and Next.js storefronts used by kitchen and floor staff.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", [
          "Terraform",
          "TypeScript services",
          "Own React and Next.js storefronts used by kitchen and floor staff.",
        ]),
      }),
    );

    const sanitized = sanitizeResumeDraft({
      draft,
      job: listingJob,
      profile: profileWithReact,
    });
    const visibleSkills = getSection(sanitized, "section_skills").bullets.map(
      (bullet) => bullet.text,
    );

    expect(visibleSkills).not.toContain(
      "Own React and Next.js storefronts used by kitchen and floor staff.",
    );
    expect(visibleSkills).not.toContain("TypeScript services");
  });

  test("validateResumeDraft maps a qualification-only listing skill to confirm_needed", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: job.keySkills,
      minimumQualifications: [
        ...job.minimumQualifications,
        "Hands-on experience with Terraform.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Terraform"]),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile,
    });

    expect(
      validation.claimAssessments.find(
        (assessment) => assessment.bulletId === "skill_bullet_1",
      ),
    ).toMatchObject({ status: "confirm_needed" });
  });

  test("validateResumeDraft flags short job-only skill bleed that remains in a draft", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", ["Remote-first collaboration"]),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "job_description_bleed",
          bulletId: "skill_bullet_1",
        }),
      ]),
    );
  });

  test("sanitizeResumeDraft keeps grounded spoken languages visible", () => {
    const { job } = getSeedContext();
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      spokenLanguages: [
        {
          id: "language_1",
          language: "English",
          proficiency: "Native",
          interviewPreference: false,
          notes: null,
        },
      ],
    };
    const draft = {
      ...createBaseDraft(),
      sections: [
        ...createBaseDraft().sections,
        {
          id: "section_languages",
          kind: "skills" as const,
          label: "Languages",
          text: null,
          bullets: createBullets("language_bullet", ["English — Native"]),
          entries: [],
          origin: "ai_generated" as const,
          locked: false,
          included: true,
          sortOrder: 3,
          entryOrderMode: "chronology" as const,
          profileRecordId: null,
          sourceRefs: [],
          updatedAt: "2026-03-20T10:04:00.000Z",
        },
      ],
    };

    const sanitized = sanitizeResumeDraft({ draft, job, profile });

    expect(
      getSection(sanitized, "section_languages").bullets.map(
        (bullet) => bullet.text,
      ),
    ).toEqual(["English — Native"]);
  });

  test("sanitizing visible resume text preserves distinct non-Latin achievements", () => {
    const { profile, job } = getSeedContext();
    const achievements = [
      "Réconcilié les dossiers de Montréal.",
      "Připravila přehled příjmů.",
      "Συντόνισε την υποστήριξη πελατών.",
      "Координировала обслуживание клиентов.",
      "顧客対応と資料管理を担当しました。",
      "负责客户支持和文档管理。",
      "نسقت خدمة العملاء وحافظت على دقة السجلات.",
      "顧客 20 件を担当しました。",
      "資料 20 件を確認しました。",
    ];
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          summary: "正確な記録を維持しました。",
          bullets: createBullets("multilingual", [
            ...achievements,
            achievements[0]!.normalize("NFD"),
          ]).map((bullet) => ({ ...bullet, origin: "user_edited" as const })),
        })),
      }),
    );

    const entry = getExperienceEntry(
      sanitizeResumeDraft({ draft, job, profile }),
    );
    expect(entry.summary).toBe("正確な記録を維持しました。");
    expect(entry.bullets.map((bullet) => bullet.text)).toEqual(achievements);
  });

  test("sanitizeResumeDraft keeps grounded action bullets that include multiple commas", () => {
    const { profile, job } = getSeedContext();
    const actionBullet =
      "Partnered with product, design, and platform engineering to standardize components, testing, and performance budgets.";
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_bullet", [
            "Led design-system rollout across core surfaces.",
            actionBullet,
          ]),
        })),
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job, profile });
    const visibleBullets = getExperienceEntry(sanitized).bullets.map(
      (bullet) => bullet.text,
    );

    expect(visibleBullets).toEqual([
      "Led design-system rollout across core surfaces.",
      actionBullet,
    ]);
  });

  test("sanitizeResumeDraft keeps a comma-rich summary supported by the profile", () => {
    const { profile, job } = getSeedContext();
    const supportedSummary =
      "Frontend engineer focused on React, TypeScript, testing, performance, and mentoring.";
    const groundedProfile = {
      ...profile,
      summary: supportedSummary,
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_summary",
      (section) => ({
        ...section,
        text: supportedSummary,
      }),
    );

    const sanitized = sanitizeResumeDraft({
      draft,
      job,
      profile: groundedProfile,
    });

    expect(getSection(sanitized, "section_summary").text).toBe(
      supportedSummary,
    );
    expect(getSection(sanitized, "section_summary").included).toBe(true);
  });

  test("sanitizeResumeDraft removes copied job-description summary prose and copied section bullets", () => {
    const { profile, job } = getSeedContext();
    const copiedSummary = job.description;
    const copiedResponsibility =
      job.responsibilities[0] ?? "Own the design system roadmap.";
    const draftWithSummaryBleed = updateSection(
      updateSection(createBaseDraft(), "section_summary", (section) => ({
        ...section,
        text: copiedSummary,
      })),
      "section_experience",
      (section) => ({
        ...section,
        bullets: createBullets("experience_section_bleed", [
          copiedResponsibility,
        ]),
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_quality", [
            copiedResponsibility,
            "React, TypeScript, Design Systems, Figma, Playwright, Accessibility, Testing",
            "Improved workflow QA handoff across release reviews.",
          ]),
        })),
      }),
    );

    const sanitized = sanitizeResumeDraft({
      draft: draftWithSummaryBleed,
      job,
      profile,
    });
    const summarySection = getSection(sanitized, "section_summary");
    const experienceEntry = getExperienceEntry(sanitized);

    expect(summarySection.text).toBeNull();
    expect(summarySection.included).toBe(false);
    expect(getSection(sanitized, "section_experience").bullets).toEqual([]);
    expect(experienceEntry.bullets.map((bullet) => bullet.text)).toEqual([
      "Improved workflow QA handoff across release reviews.",
    ]);
  });

  test("sanitizeResumeDraft removes summary sentences that repeat visible experience bullets", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          summary:
            "Led design-system rollout across core surfaces. Reduced median load time from 4.2 seconds to 1.9 seconds. Mentored four engineers through accessibility reviews.",
          bullets: createBullets("experience_summary_overlap", [
            "Led design-system rollout across core surfaces.",
            "Reduced median load time from 4.2 seconds to 1.9 seconds.",
          ]),
        })),
      }),
    );

    const sanitized = sanitizeResumeDraft({ draft, job, profile });
    const experienceEntry = getExperienceEntry(sanitized);

    expect(experienceEntry.summary).toBe(
      "Mentored four engineers through accessibility reviews.",
    );
    expect(experienceEntry.bullets.map((bullet) => bullet.text)).toEqual([
      "Led design-system rollout across core surfaces.",
      "Reduced median load time from 4.2 seconds to 1.9 seconds.",
    ]);
  });

  test("validateResumeDraft flags copied job-description section bullets without false grounding from short profile tokens", () => {
    const { profile, job } = getSeedContext();
    const copiedResponsibility =
      job.responsibilities[0] ?? "Own the design system roadmap.";
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        bullets: createBullets("experience_section_validate", [
          copiedResponsibility,
        ]),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "job_description_bleed",
          bulletId: "experience_section_validate_1",
        }),
      ]),
    );
  });

  test("validateResumeDraft maps rounded-up years and listing technologies to confirm_needed instead of unsupported", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: [...job.keySkills, "Framer"],
      description: `${job.description} Strong Framer prototyping and 11 years of professional experience required.`,
      minimumQualifications: [
        ...job.minimumQualifications,
        "11 years of professional experience.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_relaxed", [
            // 10 evidenced years rounded up by exactly one.
            "Designed resilient workflow tools across 11 years of professional experience.",
            // A listing technology the evidenced product-design stack implies.
            "Prototyped resilient workflow systems in Framer for product teams.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile,
    });

    const roundedYears = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "experience_relaxed_1",
    );
    const listingTerm = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "experience_relaxed_2",
    );

    expect(roundedYears).toMatchObject({ status: "confirm_needed" });
    expect(listingTerm).toMatchObject({ status: "confirm_needed" });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "claim_confirmation_needed",
          bulletId: "experience_relaxed_1",
        }),
        expect.objectContaining({
          category: "claim_confirmation_needed",
          bulletId: "experience_relaxed_2",
        }),
      ]),
    );
    // Both stay export-blocking until the user confirms them.
    expect(hasBlockingResumeClaimAssessment({ validation, draft })).toBe(true);
  });

  test("validateResumeDraft maps a single bullet that both rounds years and names a listing technology to confirm_needed", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      keySkills: [...job.keySkills, "Framer"],
      description: `${job.description} Strong Framer prototyping and 11 years of professional experience required.`,
      minimumQualifications: [
        ...job.minimumQualifications,
        "11 years of professional experience.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_combined", [
            "Designed resilient workflow tools in Framer across 11 years of professional experience.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile,
    });
    const combined = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "experience_combined_1",
    );

    expect(combined).toMatchObject({ status: "confirm_needed" });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "claim_confirmation_needed",
          bulletId: "experience_combined_1",
        }),
      ]),
    );
    expect(hasBlockingResumeClaimAssessment({ validation, draft })).toBe(true);
  });

  test("validateResumeDraft keeps an unevidenced credential the listing asks for unsupported", () => {
    const { profile, job } = getSeedContext();
    const listingJob = {
      ...job,
      preferredQualifications: [
        ...job.preferredQualifications,
        "AWS Certified Solutions Architect preferred.",
      ],
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_credential", [
            "AWS Certified Solutions Architect.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job: listingJob,
      profile,
    });
    const credential = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "experience_credential_1",
    );

    expect(credential).toMatchObject({ status: "unsupported" });
    expect(credential?.status).not.toBe("confirm_needed");
    expect(hasBlockingResumeClaimAssessment({ validation, draft })).toBe(true);
  });

  test("validateResumeDraft keeps years beyond one rounding and technologies absent from the listing unsupported", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_unrelaxed", [
            // Two years past the evidenced 10 is not a rounding.
            "Designed resilient workflow tools across 12 years of professional experience.",
            // A technology neither the evidence nor the listing mentions.
            "Prototyped resilient workflow systems in Framer for product teams.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(
      validation.claimAssessments.find(
        (assessment) => assessment.bulletId === "experience_unrelaxed_1",
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(
      validation.claimAssessments.find(
        (assessment) => assessment.bulletId === "experience_unrelaxed_2",
      ),
    ).toMatchObject({ status: "unsupported" });
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "invented_metric",
          bulletId: "experience_unrelaxed_1",
        }),
      ]),
    );
  });

  test("validateResumeDraft flags keyword stuffing and vague filler when they remain in bullets", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("experience_validate", [
            "React, TypeScript, Design Systems, Figma, Playwright, Accessibility, Testing",
            "Results-driven team player who thrives in fast-paced environments.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "keyword_stuffing",
          bulletId: "experience_validate_1",
        }),
        expect.objectContaining({
          category: "vague_filler",
          bulletId: "experience_validate_2",
        }),
      ]),
    );
  });

  test("validateResumeDraft flags duplicate bullets and duplicate entry summaries", () => {
    const { profile, job } = getSeedContext();
    const duplicateEntry = createDuplicateExperienceEntry(
      getExperienceEntry(createBaseDraft()),
    );
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: [...section.entries, duplicateEntry],
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "duplicate_bullet",
          bulletId: "experience_duplicate_1",
        }),
        expect.objectContaining({
          category: "duplicate_section_content",
          entryId: "experience_2",
        }),
      ]),
    );
  });

  test("validateResumeDraft flags thin output when only a fragment remains", () => {
    const { profile, job } = getSeedContext();
    const draft = {
      ...createBaseDraft(),
      sections: [
        {
          ...getSection(createBaseDraft(), "section_summary"),
          text: "Brief summary.",
          bullets: [],
          entries: [],
          included: true,
        },
        {
          ...getSection(createBaseDraft(), "section_skills"),
          bullets: [],
          included: false,
        },
        {
          ...getSection(createBaseDraft(), "section_experience"),
          bullets: [],
          entries: [],
          included: false,
        },
      ],
    };

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "thin_output",
        }),
      ]),
    );
  });

  test("validateResumeDraft blocks preview-derived content without candidate traceability", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      experiences: [],
      projects: [],
      education: [],
      certifications: [],
    };
    const draft = seedResumeDraft({
      profile,
      job: seed.savedJobs[0]!,
      templateId: seed.settings.resumeTemplateId,
      tailoredAsset: {
        ...seed.tailoredAssets[0]!,
        previewSections: [
          { heading: "Summary", lines: ["Preview-only summary."] },
          {
            heading: "Experience",
            lines: ["Preview-only role", "Preview-only claim."],
          },
        ],
      },
    });

    const validation = validateResumeDraft({
      draft,
      job: seed.savedJobs[0]!,
      profile,
    });

    const factualReviewIssue = validation.issues.find(
      (issue) => issue.category === "low_confidence_fact",
    );
    expect(factualReviewIssue?.severity).toBe("error");
    expect(factualReviewIssue?.message).toMatch(
      /needs factual review before approval/i,
    );
  });

  test("keeps thin generated fallback empty of search metadata and blocks approval", () => {
    const seed = createSeed();
    const job = seed.savedJobs[0]!;
    const draft = buildResumeDraftFromTailoredDraft({
      job,
      templateId: seed.settings.resumeTemplateId,
      createdAt: "2026-08-30T10:04:00.000Z",
      generationMethod: "deterministic",
      profile: seed.profile,
      draft: {
        label: "Tailored Resume",
        summary: "A short generated summary.",
        experienceHighlights: [],
        coreSkills: ["React"],
        targetedKeywords: [],
        experienceEntries: [],
        projectEntries: [],
        educationEntries: [],
        certificationEntries: [],
        coverageMetadata: [],
        additionalSkills: [],
        languages: [],
        fullText: "A short generated summary.",
        compatibilityScore: 40,
        notes: [],
      },
    });
    const summary = draft.sections.find(
      (section) => section.kind === "summary",
    );

    expect(summary?.bullets).toEqual([]);
    expect(summary?.text).not.toMatch(
      /target role|preferred location|core tools/i,
    );

    const validation = validateResumeDraft({
      draft,
      job,
      profile: seed.profile,
    });

    const factualReviewIssue = validation.issues.find(
      (issue) => issue.category === "low_confidence_fact",
    );
    expect(factualReviewIssue?.severity).toBe("error");
    expect(factualReviewIssue?.message).toMatch(
      /needs factual review before approval/i,
    );
  });

  test("blocks an untraceable generated summary when another section is grounded", () => {
    const { profile, job } = getSeedContext();
    const candidateSourceRef = {
      id: "resume_source_profile_summary",
      sourceKind: "profile" as const,
      sourceId: "profile:summary",
      snippet: profile.summary,
    };
    const baseDraft = createBaseDraft();
    const draft = {
      ...baseDraft,
      sections: baseDraft.sections.map((section) => ({
        ...section,
        text: section.kind === "summary" ? job.description : section.text,
        sourceRefs: section.kind === "summary" ? [] : [candidateSourceRef],
      })),
    };

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "low_confidence_fact",
          severity: "error",
        }),
      ]),
    );
  });

  test("does not flag generated sections when every visible section has candidate grounding", () => {
    const { profile, job } = getSeedContext();
    const candidateSourceRef = {
      id: "resume_source_profile_summary",
      sourceKind: "profile" as const,
      sourceId: "profile:summary",
      snippet: profile.summary,
    };
    const baseDraft = createBaseDraft();
    const draft = {
      ...baseDraft,
      sections: baseDraft.sections.map((section) => ({
        ...section,
        text: section.kind === "summary" ? profile.summary : section.text,
        sourceRefs: [candidateSourceRef],
      })),
    };

    const validation = validateResumeDraft({ draft, job, profile });

    expect(
      validation.issues.some(
        (issue) => issue.category === "low_confidence_fact",
      ),
    ).toBe(false);
  });

  test("validateResumeDraft flags page overflow at three pages as an error", () => {
    const { profile, job } = getSeedContext();
    const validation = validateResumeDraft({
      draft: createBaseDraft(),
      job,
      profile,
      pageCount: 3,
    });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "page_overflow",
          severity: "error",
        }),
      ]),
    );
  });

  test("validateResumeDraft uses the draft page target in overflow messaging", () => {
    const { profile, job } = getSeedContext();
    const validation = validateResumeDraft({
      draft: {
        ...createBaseDraft(),
        targetPageCount: 1,
      },
      job,
      profile,
      pageCount: 2,
    });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "page_overflow",
          severity: "warning",
          message: "The exported resume exceeded the 1-page target.",
        }),
      ]),
    );
  });

  test("validateResumeDraft does not mutate user-included entry included flags even under page overflow", () => {
    const { profile, job } = getSeedContext();
    const userIncludedWeakFit = {
      ...getExperienceEntry(createBaseDraft()),
      id: "experience_user_included_gap_role",
      title: "Sales Operations Associate",
      subtitle: "Bright Market",
      summary: "Kept customer operations reporting concise.",
      included: true,
      profileRecordId: "experience_sales_bridge",
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: [...section.entries, userIncludedWeakFit],
      }),
    );
    const validation = validateResumeDraft({
      draft,
      job,
      profile,
      pageCount: 3,
    });

    expect(
      getSection(draft, "section_experience").entries.find(
        (entry) => entry.id === "experience_user_included_gap_role",
      )?.included,
    ).toBe(true);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "page_overflow",
          severity: "error",
        }),
      ]),
    );
  });

  test("createEntry removes near-duplicate long bullets without dropping short skills", () => {
    const entry = createEntry({
      id: "experience_net_migration",
      entryType: "experience",
      title: ".NET Developer",
      subtitle: "CREA-KO",
      bullets: [
        "Assisted in migrating a web-based ERP system from .NET Framework to .NET Core MVC, refactoring both front-end and back-end code to enhance performance, scalability, and alignment with the .NET Core MVC architecture.",
        "Refactored front-end and back-end code to align with .NET Core MVC architecture, improving the performance and scalability of the web application.",
        "Replaced 12 deprecated NuGet packages, eliminating 100+ security warnings in CI builds.",
      ],
      updatedAt: "2026-03-20T10:04:00.000Z",
      origin: "imported",
      sortOrder: 0,
    });

    expect(entry.bullets.map((bullet) => bullet.text)).toEqual([
      "Assisted in migrating a web-based ERP system from .NET Framework to .NET Core MVC, refactoring both front-end and back-end code to enhance performance, scalability, and alignment with the .NET Core MVC architecture.",
      "Replaced 12 deprecated NuGet packages, eliminating 100+ security warnings in CI builds.",
    ]);
  });

  test("validateResumeDraft rejects unsupported metrics while preserving canonical quantified evidence", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("claim_quality_metric", [
            "Increased adoption to 95% across three teams.",
            "Adoption reached 80% of core product surfaces within two quarters.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });
    const metricIssues = validation.issues.filter(
      (issue) => issue.category === "invented_metric",
    );

    expect(metricIssues.map((issue) => issue.bulletId)).toEqual([
      "claim_quality_metric_1",
    ]);
  });

  test("validateResumeDraft catches unsupported absolutes, teen-like filler, fragments, and near repetition", () => {
    const { profile, job } = getSeedContext();
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          summary:
            "I did a lot of different things. I did a lot of different things.",
          bullets: createBullets("claim_quality_tone", [
            "Single-handedly revolutionized the industry with a world-class platform.",
            "Worked on various things and helped with lots of stuff.",
            "TailwindCSS & WebSockets.",
            "Led design-system rollout across core surfaces.",
            "Led the design system rollout across core product surfaces.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "unsupported_claim",
          bulletId: "claim_quality_tone_1",
        }),
        expect.objectContaining({
          category: "vague_filler",
          bulletId: "claim_quality_tone_2",
        }),
        expect.objectContaining({
          category: "vague_filler",
          bulletId: "claim_quality_tone_3",
        }),
        expect.objectContaining({
          category: "duplicate_bullet",
          bulletId: "claim_quality_tone_5",
        }),
        expect.objectContaining({
          category: "vague_filler",
          entryId: "experience_1",
        }),
      ]),
    );
  });

  test("validateResumeDraft reports missing and hidden canonical work-history roles", () => {
    const { profile, job } = getSeedContext();
    const canonicalRole = {
      ...profile.experiences[0]!,
      id: "experience_canonical_second",
      companyName: "Orbit Labs",
      title: "Product designer",
    };
    const profileWithSecondRole = {
      ...profile,
      experiences: [...profile.experiences, canonicalRole],
    };

    const missingValidation = validateResumeDraft({
      draft: createBaseDraft(),
      job,
      profile: profileWithSecondRole,
    });
    expect(missingValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "issue_work_history_experience_canonical_second",
          category: "work_history_review",
          message:
            "A canonical work-history role is missing from the resume draft.",
        }),
      ]),
    );

    const hiddenDraft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: [
          ...section.entries,
          {
            ...getExperienceEntry(createBaseDraft()),
            id: "experience_hidden_canonical",
            profileRecordId: canonicalRole.id,
            included: false,
          },
        ],
      }),
    );
    const hiddenValidation = validateResumeDraft({
      draft: hiddenDraft,
      job,
      profile: profileWithSecondRole,
    });
    expect(hiddenValidation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "issue_work_history_experience_canonical_second",
          category: "work_history_review",
          message:
            "A canonical work-history role is hidden from the visible resume.",
        }),
      ]),
    );
  });

  test("buildResumeCoverageComparison explains role, claim, order, and page changes", () => {
    const { profile } = getSeedContext();
    const secondRole = {
      ...profile.experiences[0]!,
      id: "experience_2",
      companyName: "Orbit Labs",
      title: "Product designer",
      summary: "Designed internal workflow products.",
      achievements: ["Shipped a shared operations dashboard."],
    };
    const profileWithHistory = {
      ...profile,
      experiences: [...profile.experiences, secondRole],
    };
    const comparisonDraft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: [
          {
            ...getExperienceEntry(createBaseDraft()),
            id: "experience_2",
            profileRecordId: secondRole.id,
            title: secondRole.title,
            subtitle: secondRole.companyName,
            summary: secondRole.summary,
            bullets: createBullets(
              "experience_2_bullet",
              secondRole.achievements,
            ),
            included: false,
            sortOrder: 0,
          },
          {
            ...getExperienceEntry(createBaseDraft()),
            summary: "Builds reliable workflow platforms for product teams.",
            bullets: createBullets("experience_rewritten", [
              "Led a grounded design-system rollout across core product surfaces.",
            ]),
            sortOrder: 1,
          },
        ],
      }),
    );

    const comparison = buildResumeCoverageComparison({
      profile: profileWithHistory,
      draft: comparisonDraft,
      pageCount: 3,
      validationIssues: [
        {
          id: "duplicate_1",
          severity: "warning",
          category: "duplicate_bullet",
          sectionId: "section_experience",
          entryId: "experience_1",
          bulletId: "experience_rewritten_1",
          message: "Repeated claim.",
        },
      ],
    });

    expect(comparison).toMatchObject({
      originalRoleCount: 2,
      representedRoleCount: 2,
      visibleRoleCount: 1,
      rewrittenRoleCount: 1,
      hiddenRoleCount: 1,
      reorderedRoleCount: 2,
      duplicateIssueCount: 1,
      pageImpact: "over_target",
      pageCount: 3,
      targetPageCount: 2,
    });
    const rewrittenRole = comparison.roles.find(
      (role) => role.profileRecordId === "experience_1",
    );
    expect(rewrittenRole).toMatchObject({
      status: "rewritten",
      reordered: true,
    });
    expect(rewrittenRole?.addedClaims).toContainEqual({
      field: "summary",
      text: "Builds reliable workflow platforms for product teams.",
      restorable: false,
    });
    expect(rewrittenRole?.removedClaims).toContainEqual({
      field: "summary",
      text: "Builds resilient workflow tools.",
      restorable: true,
    });
    expect(
      comparison.roles.find((role) => role.profileRecordId === "experience_2"),
    ).toMatchObject({
      status: "hidden",
      included: false,
    });

    const hiddenSectionComparison = buildResumeCoverageComparison({
      profile: profileWithHistory,
      draft: updateSection(
        comparisonDraft,
        "section_experience",
        (section) => ({
          ...section,
          included: false,
          entries: section.entries.map((entry) => ({
            ...entry,
            included: true,
          })),
        }),
      ),
    });

    expect(hiddenSectionComparison).toMatchObject({
      visibleRoleCount: 0,
      hiddenRoleCount: 2,
    });
    expect(
      hiddenSectionComparison.roles.flatMap((role) => role.removedClaims),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ restorable: false })]),
    );
  });

  test("sanitizeResumeDraft suppresses unprofessional generated summaries without deleting grounded history", () => {
    const { profile, job } = getSeedContext();
    const unprofessionalSummary =
      "After deciding to return to my passion, I did a lot of different things and moved back into development.";
    const generatedDraft = updateSection(
      createBaseDraft(),
      "section_summary",
      (section) => ({
        ...section,
        text: unprofessionalSummary,
        origin: "ai_generated",
      }),
    );

    const sanitized = sanitizeResumeDraft({
      draft: generatedDraft,
      job,
      profile,
    });

    // The bad generated summary is replaced by the person's own profile
    // summary, never dropped: an export with no summary at all is worse.
    expect(getSection(sanitized, "section_summary")).toMatchObject({
      text: profile.summary,
    });
    expect(getExperienceEntry(sanitized)).toMatchObject({
      profileRecordId: "experience_1",
      included: true,
    });

    const userEditedDraft = updateSection(
      generatedDraft,
      "section_summary",
      (section) => ({
        ...section,
        origin: "user_edited",
      }),
    );
    expect(
      getSection(
        sanitizeResumeDraft({ draft: userEditedDraft, job, profile }),
        "section_summary",
      ).text,
    ).toBe(unprofessionalSummary);
  });

  test("grounds a concise summary in short candidate skill and role evidence without accepting a new technology", () => {
    const { profile, job } = getSeedContext();
    const candidate = {
      ...profile,
      headline: "Senior Product Engineer",
      summary:
        "Product engineer focused on reliable workflow software and accessible frontend systems.",
      skills: ["React", "TypeScript", "Accessibility"],
      baseResume: {
        ...profile.baseResume,
        textContent:
          "Frontend Engineer\nDelivered customer-facing React applications.\nBuilt TypeScript workflow tools for operations teams.",
      },
    };
    const assess = (text: string) =>
      validateResumeDraft({
        draft: updateSection(
          createBaseDraft(),
          "section_summary",
          (section) => ({ ...section, text, origin: "ai_generated" }),
        ),
        job,
        profile: candidate,
      }).claimAssessments.find(
        (claim) => claim.sectionId === "section_summary",
      );

    expect(
      assess(
        "Frontend engineer building workflow software and accessible interfaces with React and TypeScript.",
      )?.status,
    ).toBe("paraphrase");
    expect(
      assess(
        "Frontend engineer building workflow software and accessible interfaces with Kubernetes.",
      )?.status,
    ).toBe("unsupported");
  });

  test("assesses every visible generated claim against candidate-only evidence", () => {
    const { profile, job } = getSeedContext();
    const groundedClaim = "Led design-system rollout across core surfaces.";
    const groundedProfile = {
      ...profile,
      experiences: profile.experiences.map((experience, index) =>
        index === 0
          ? {
              ...experience,
              achievements: [...experience.achievements, groundedClaim],
            }
          : experience,
      ),
    };
    const draft = updateSection(
      createBaseDraft(),
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("claim_grounding", [
            groundedClaim,
            "Architected a quantum operating model for global logistics teams.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({
      draft,
      job,
      profile: groundedProfile,
    });
    const grounded = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "claim_grounding_1",
    );
    const unsupported = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "claim_grounding_2",
    );

    expect(grounded).toMatchObject({
      claimOrigin: "ai_generated",
      status: "exact",
      verifier: "deterministic_candidate_evidence_v2",
    });
    expect(grounded?.evidenceRefs.length).toBeGreaterThan(0);
    expect(grounded?.evidenceRefs.map((ref) => ref.sourceKind)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(resume|profile|proof|user)$/),
      ]),
    );
    expect(unsupported).toMatchObject({
      claimOrigin: "ai_generated",
      status: "unsupported",
      evidenceRefs: [],
    });
    expect(validation.draftContentHash).toBe(
      buildResumeDraftContentHash(draft),
    );
  });

  test("does not auto-support user edits and invalidates hashes when claim text changes", () => {
    const { profile, job } = getSeedContext();
    const userEditedDraft = updateSection(
      createBaseDraft(),
      "section_summary",
      (section) => ({
        ...section,
        text: "Created a novel operating model that is not yet in candidate evidence.",
        origin: "user_edited",
      }),
    );
    const before = validateResumeDraft({
      draft: userEditedDraft,
      job,
      profile,
    });
    const editedDraft = updateSection(
      userEditedDraft,
      "section_summary",
      (section) => ({
        ...section,
        text: "Created a different novel operating model that is not yet in candidate evidence.",
      }),
    );
    const after = validateResumeDraft({ draft: editedDraft, job, profile });
    const beforeClaim = before.claimAssessments.find(
      (assessment) =>
        assessment.field === "section_text" &&
        assessment.sectionId === "section_summary",
    );
    const afterClaim = after.claimAssessments.find(
      (assessment) =>
        assessment.field === "section_text" &&
        assessment.sectionId === "section_summary",
    );

    expect(beforeClaim).toMatchObject({
      claimOrigin: "user_edited",
      status: "review",
    });
    expect(beforeClaim?.contentHash).not.toBe(afterClaim?.contentHash);
    expect(before.draftContentHash).not.toBe(after.draftContentHash);

    const originOnlyEdit = updateSection(
      userEditedDraft,
      "section_summary",
      (section) => ({ ...section, origin: "ai_generated" }),
    );
    expect(buildResumeDraftContentHash(originOnlyEdit)).not.toBe(
      buildResumeDraftContentHash(userEditedDraft),
    );
  });

  test("gives a listing-asked skill the person cannot evidence a confirmation of its own", () => {
    // ADR 0018 lets aggressive tailoring name a technology the listing asks
    // for, and promises the candidate confirms each one. The headline said
    // "none could be verified" while the skill sat in Core Skills with no
    // control at all, because an unsupported verdict is not confirmable.
    const { profile, job } = getSeedContext();
    const listingSkill = job.keySkills[0];
    expect(typeof listingSkill).toBe("string");
    const draft = updateSection(
      createBaseDraft(),
      "section_skills",
      (section) => ({
        ...section,
        bullets: createBullets("skill_bullet", [
          listingSkill!,
          "Cobol mainframe migration",
        ]),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });
    const listingSkillClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "skill_bullet_1",
    );
    const inventedSkillClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "skill_bullet_2",
    );

    // The listing asked for it, so it becomes the candidate's call.
    expect(listingSkillClaim?.status).not.toBe("unsupported");
    // A skill neither the evidence nor the listing mentions stays refused.
    expect(inventedSkillClaim?.status).toBe("unsupported");
  });

  test("maps classifier verdicts to statuses and gates confirmations by locator and hash", () => {
    const { profile, job } = getSeedContext();
    // Every other generated claim in this fixture must be fully grounded so
    // the single weak-supported bullet below is the only confirmation-gated
    // row: confirming one row can never clear a second unconfirmed weak row,
    // so the gate would stay closed after its confirmation. The summary text
    // is verbatim stored-profile evidence, which classifies as exact.
    const groundedDraft = updateSection(
      createBaseDraft(),
      "section_summary",
      (section) => ({
        ...section,
        text: profile.summary ?? "",
      }),
    );
    const draft = updateSection(
      groundedDraft,
      "section_experience",
      (section) => ({
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: createBullets("grounding_confirm", [
            // Shares only one meaningful token with candidate evidence: weak
            // support that a generated claim must confirm before export.
            "Championed resilient delivery improvements across organizations.",
            // Multi-anchor paraphrase of grounded achievements: accepted.
            "Delivered the design system rollout across core product surfaces.",
          ]),
        })),
      }),
    );

    const validation = validateResumeDraft({ draft, job, profile });
    const weakClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "grounding_confirm_1",
    );
    const paraphraseClaim = validation.claimAssessments.find(
      (assessment) => assessment.bulletId === "grounding_confirm_2",
    );

    expect(weakClaim).toMatchObject({
      claimOrigin: "ai_generated",
      status: "confirm_needed",
      verifier: "deterministic_candidate_evidence_v2",
    });
    expect(
      validation.issues.some(
        (issue) =>
          issue.category === "claim_confirmation_needed" &&
          issue.severity === "warning" &&
          issue.bulletId === "grounding_confirm_1",
      ),
    ).toBe(true);
    expect(paraphraseClaim).toMatchObject({
      claimOrigin: "ai_generated",
      status: "paraphrase",
    });
    expect(paraphraseClaim?.evidenceRefs.length).toBeGreaterThan(0);
    expect(hasBlockingResumeClaimAssessment({ validation, draft })).toBe(true);

    const confirmation = ResumeClaimConfirmationSchema.parse({
      id: "claim_confirmation_grounding_1",
      draftId: draft.id,
      field: weakClaim?.field ?? "section_bullet",
      sectionId: weakClaim?.sectionId ?? "",
      entryId: weakClaim?.entryId ?? null,
      bulletId: weakClaim?.bulletId ?? null,
      confirmedClaimContentHash: fnv1a32(
        normalizeText(weakClaim?.claimText ?? ""),
      ),
      ownershipStatement: resumeClaimOwnershipStatement,
      confirmedAt: "2026-08-26T10:00:00.000Z",
    });
    const confirmedDraft = { ...draft, claimConfirmations: [confirmation] };
    expect(
      hasBlockingResumeClaimAssessment({ validation, draft: confirmedDraft }),
    ).toBe(false);

    // A cross-draft confirmation never satisfies the gate.
    const foreignConfirmation = {
      ...confirmation,
      id: "claim_confirmation_foreign_draft",
      draftId: "resume_draft_elsewhere",
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation,
        draft: { ...draft, claimConfirmations: [foreignConfirmation] },
      }),
    ).toBe(true);

    // A content-hash change re-blocks even with a stored confirmation:
    // origin flips or wording edits alone cannot clear the gate.
    const rewordedValidation = {
      ...validation,
      claimAssessments: validation.claimAssessments.map((assessment) =>
        assessment.id === weakClaim?.id
          ? { ...assessment, contentHash: fnv1a32("reworded claim") }
          : assessment,
      ),
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation: rewordedValidation,
        draft: confirmedDraft,
      }),
    ).toBe(true);

    const originFlippedRow = {
      ...(weakClaim as NonNullable<typeof weakClaim>),
      claimOrigin: "user_edited" as const,
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [originFlippedRow] },
        draft,
      }),
    ).toBe(true);
  });

  test("fails closed on stale verifier currency while keeping user prose informational", () => {
    const { profile, job } = getSeedContext();
    const baseDraft = createBaseDraft();
    const validation = validateResumeDraft({ draft: baseDraft, job, profile });
    const generatedRow =
      validation.claimAssessments.find(
        (assessment) =>
          assessment.claimOrigin === "ai_generated" &&
          assessment.status !== "unsupported",
      ) ?? validation.claimAssessments[0];

    if (!generatedRow) {
      throw new Error("Expected at least one claim assessment.");
    }

    // v1 rows predate the converged verifier: generated claims stay blocked
    // pending revalidation regardless of their recorded status.
    const staleGeneratedRow = {
      ...generatedRow,
      verifier: "deterministic_candidate_evidence_v1" as const,
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [staleGeneratedRow] },
        draft: baseDraft,
      }),
    ).toBe(true);

    // User-authored v1 rows keep legacy semantics: only hard unsupported
    // verdicts blocked before v2 existed.
    const staleUserExactRow = {
      ...generatedRow,
      claimOrigin: "user_edited" as const,
      status: "exact" as const,
      verifier: "deterministic_candidate_evidence_v1" as const,
    };
    const staleUserUnsupportedRow = {
      ...staleUserExactRow,
      status: "unsupported" as const,
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [staleUserExactRow] },
        draft: baseDraft,
      }),
    ).toBe(false);
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [staleUserUnsupportedRow] },
        draft: baseDraft,
      }),
    ).toBe(true);

    // Under v2, hard unsupported gaps block regardless of origin, while
    // review-status user prose stays informational.
    const v2UserReviewRow = {
      ...generatedRow,
      claimOrigin: "user_edited" as const,
      status: "review" as const,
      verifier: "deterministic_candidate_evidence_v2" as const,
    };
    const v2UserUnsupportedRow = {
      ...v2UserReviewRow,
      status: "unsupported" as const,
    };
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [v2UserReviewRow] },
        draft: baseDraft,
      }),
    ).toBe(false);
    expect(
      hasBlockingResumeClaimAssessment({
        validation: { claimAssessments: [v2UserUnsupportedRow] },
        draft: baseDraft,
      }),
    ).toBe(true);
  });
});
