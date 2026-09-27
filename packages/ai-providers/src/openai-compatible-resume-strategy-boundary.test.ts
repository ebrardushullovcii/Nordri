import { describe, expect, test } from "vitest";

import {
  createJobFinderAiClientFromEnvironment,
  createOpenAiCompatibleJobFinderAiClient,
} from "./openai-compatible";
import {
  ResumeGenerationStrategyPolicySchema,
  type ResumeGenerationStrategyPolicy,
} from "./shared";
import {
  createJobPosting,
  createPreferences,
  createProfile,
  createSettings,
  mockCapturingJsonFetch,
} from "./test-fixtures";

function createStrategy(
  evidenceBoundaries: Partial<
    ResumeGenerationStrategyPolicy["evidenceBoundaries"]
  > = {},
): ResumeGenerationStrategyPolicy {
  return ResumeGenerationStrategyPolicySchema.parse({
    strategyId: "strategy_frontend_platform",
    strategyName: "Frontend platform",
    roleFamily: "Frontend Platform Engineering",
    baseResumeDocumentId: "resume_strategy_1",
    templateId: "classic_ats",
    headlinePolicy: "per_job_tailored",
    skillsPolicy: "role_family_expanded",
    coveragePolicy: "full_tailoring",
    tailoringStrength: "aggressive",
    evidenceBoundaries,
    effectiveSource: "recommendation",
    effectiveReason: "The target role matches the selected family.",
    recommendationSource: "role_family",
    recommendationReason:
      "The role family has the strongest supported overlap.",
    selectionSource: "rule_match",
    selectionReason: "The saved role-family rule selected this strategy.",
  });
}

describe("configured resume strategy request boundary", () => {
  test("sends strategy policy, base resume text, and evidence limits to the provider", async () => {
    const fetchMock = mockCapturingJsonFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({}),
          },
        },
      ],
    });
    const strategy = createStrategy({
      allowExactClaims: false,
      allowParaphrasedClaims: true,
      maxEvidenceRefsPerBullet: 2,
      requireVerifierPass: true,
    });
    const baseResumeText =
      "Alex Vanguard\nFrontend platform engineer\nVerified base resume text.";

    try {
      const client = createOpenAiCompatibleJobFinderAiClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "test-model",
      });

      await client.createResumeDraft({
        profile: createProfile(),
        searchPreferences: createPreferences(),
        settings: createSettings(),
        job: createJobPosting(),
        resumeText: baseResumeText,
        strategy,
        evidence: {
          summary: ["Built reliable workflow tools."],
          candidateSummary: [],
          experience: ["Built reliable workflow tools for operations teams."],
          skills: ["TypeScript"],
          keywords: ["workflow"],
        },
        researchContext: {
          companyNotes: [],
          domainVocabulary: [],
          priorityThemes: [],
        },
      });

      const body = JSON.parse(fetchMock.getCapturedBody()) as {
        messages?: Array<{ content?: string }>;
      };
      const systemPrompt = body.messages?.[0]?.content ?? "";
      const userPayload = JSON.parse(body.messages?.[1]?.content ?? "{}") as {
        strategy?: ResumeGenerationStrategyPolicy;
        baseResumeText?: string;
        groundingEvidence?: {
          items?: Array<{ id?: string; text?: string }>;
        };
      };

      expect(userPayload.strategy).toEqual(strategy);
      expect(userPayload.baseResumeText).toBe(baseResumeText);
      expect(userPayload.groundingEvidence?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "baseResume:text",
            text: baseResumeText,
          }),
        ]),
      );
      expect(systemPrompt).toContain(
        'Apply the named resume strategy "Frontend platform" for the Frontend Platform Engineering role family.',
      );
      expect(systemPrompt).toContain(
        "Use the per_job_tailored headline policy, role_family_expanded skills policy, and full_tailoring coverage policy.",
      );
      expect(systemPrompt).toContain(
        "The selected base resume document is resume_strategy_1",
      );
      expect(systemPrompt).toContain(
        "Evidence boundaries: exact claims not allowed; paraphrased claims allowed; at most 2 evidence references per bullet.",
      );
    } finally {
      fetchMock.restore();
    }
  });

  test("rejects a model bullet that cites more evidence references than the strategy allows", async () => {
    const canonicalBullet =
      "Built reliable TypeScript workflow tools for operations teams.";
    const overLimitBullet =
      "Built reliable TypeScript workflow tools for operations teams and platform delivery.";
    const fetchMock = mockCapturingJsonFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({
              experienceEntries: [
                {
                  profileRecordId: "experience_platform",
                  bullets: [
                    {
                      text: overLimitBullet,
                      evidenceRefs: [
                        "experience:experience_platform:achievement:0",
                        "profile:skills",
                      ],
                    },
                  ],
                },
              ],
            }),
          },
        },
      ],
    });

    try {
      const client = createOpenAiCompatibleJobFinderAiClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "test-model",
      });
      const baseProfile = createProfile();
      const result = await client.createResumeDraft({
        profile: {
          ...baseProfile,
          skills: ["TypeScript"],
          experiences: [
            {
              id: "experience_platform",
              companyName: "Acme Labs",
              companyUrl: null,
              title: "Platform Engineer",
              employmentType: null,
              location: "Remote",
              workMode: ["remote"],
              startDate: "2022-01",
              endDate: null,
              isCurrent: true,
              isDraft: false,
              summary: "Built reliable workflow tools for operations teams.",
              achievements: [canonicalBullet],
              skills: ["TypeScript"],
              domainTags: [],
              peopleManagementScope: null,
              ownershipScope: null,
            },
          ],
        },
        searchPreferences: createPreferences(),
        settings: createSettings(),
        job: createJobPosting(),
        resumeText: "Resume text",
        strategy: createStrategy({
          allowParaphrasedClaims: true,
          maxEvidenceRefsPerBullet: 1,
        }),
        evidence: {
          summary: [],
          candidateSummary: [],
          experience: [],
          skills: ["TypeScript"],
          keywords: [],
        },
        researchContext: {
          companyNotes: [],
          domainVocabulary: [],
          priorityThemes: [],
        },
      });

      const experienceEntry = result.experienceEntries.find(
        (entry) => entry.profileRecordId === "experience_platform",
      );
      expect(experienceEntry?.bullets).toContain(canonicalBullet);
      expect(experienceEntry?.bullets).not.toContain(overLimitBullet);
      expect(result.generationQuality).toMatchObject({
        strategy: "deterministic",
        proposedRewriteCount: 1,
        acceptedRewriteCount: 0,
        rejectedRewriteCount: 1,
      });
    } finally {
      fetchMock.restore();
    }
  });

  test("routes a strategy-selected aggressive draft to the aggressive model", async () => {
    const fetchMock = mockCapturingJsonFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({}),
          },
        },
      ],
    });

    try {
      const client = createJobFinderAiClientFromEnvironment({
        UNEMPLOYED_AI_API_KEY: "test-key",
        UNEMPLOYED_AI_MODEL: "ordinary-model",
      });

      await client.createResumeDraft({
        profile: createProfile(),
        searchPreferences: createPreferences(),
        settings: createSettings(),
        job: {
          ...createJobPosting(),
          responsibilities: ["Own the design system roadmap."],
        },
        resumeText: "Resume text",
        strategy: createStrategy(),
      });

      const body = JSON.parse(fetchMock.getCapturedBody()) as {
        model?: string;
      };
      expect(body.model).toBe("deepseek-v4.1-flash");
    } finally {
      fetchMock.restore();
    }
  });

  test("tells chat-completions providers to return JSON when requesting json_object", async () => {
    const fetchMock = mockCapturingJsonFetch({
      choices: [{ message: { content: "{}" } }],
    });

    try {
      const client = createOpenAiCompatibleJobFinderAiClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "deepseek-v4.1-flash",
        apiMode: "chat_completions",
      });
      const searchPreferences = createPreferences();
      searchPreferences.tailoringMode = "aggressive";

      await client.createResumeDraft({
        profile: createProfile(),
        searchPreferences,
        settings: createSettings(),
        job: createJobPosting(),
        resumeText: "Resume text",
      });

      const body = JSON.parse(fetchMock.getCapturedBody()) as {
        response_format?: { type?: string };
        messages?: Array<{ content?: string }>;
      };
      expect(body.response_format?.type).toBe("json_object");
      expect(body.messages?.[0]?.content).toMatch(/\bJSON\b/i);
    } finally {
      fetchMock.restore();
    }
  });
});
