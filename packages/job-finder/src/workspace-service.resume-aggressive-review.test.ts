import { describe, expect, test } from "vitest";
import { createAiClient } from "./workspace-service.test-runtimes";
import {
  createWorkspaceServiceHarness,
  createSeed,
} from "./workspace-service.test-support";

describe("aggressive resume review routing", () => {
  test.each([
    ["conservative", "aggressive"],
    ["balanced", "conservative"],
    ["aggressive", "balanced"],
  ] as const)(
    "generation sends the selected per-job %s level instead of the global %s level",
    async (jobLevel, globalLevel) => {
      const seed = createSeed();
      seed.searchPreferences = {
        ...seed.searchPreferences,
        tailoringMode: globalLevel,
      };
      seed.savedJobs = seed.savedJobs.map((job) =>
        job.id === "job_ready"
          ? { ...job, resumeTailoringMode: jobLevel }
          : job,
      );
      let capturedSearchPreference: string | null = null;
      let capturedStrategyStrength: string | null = null;
      const baseAiClient = createAiClient();
      const { workspaceService } = createWorkspaceServiceHarness({
        seed,
        aiClient: {
          ...baseAiClient,
          createResumeDraft(input) {
            capturedSearchPreference = input.searchPreferences.tailoringMode;
            capturedStrategyStrength =
              input.strategy?.tailoringStrength ?? null;
            return baseAiClient.createResumeDraft(input);
          },
        },
      });

      await workspaceService.generateResume("job_ready");
      const workspace = await workspaceService.getResumeWorkspace("job_ready");

      expect(capturedSearchPreference).toBe(jobLevel);
      expect(capturedStrategyStrength).toBeNull();
      expect(workspace.effectiveTailoringStrength).toBe(jobLevel);
    },
  );

  test("review uses the global aggressive default when no strategy sets a strength", async () => {
    const seed = createSeed();
    seed.searchPreferences = {
      ...seed.searchPreferences,
      tailoringMode: "aggressive",
    };
    let capturedTailoringStrength: string | null | undefined;
    const baseAiClient = createAiClient();
    const { workspaceService } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        reviseResumeDraft(input) {
          capturedTailoringStrength = input.tailoringStrength ?? null;
          return Promise.resolve({
            content: "No edits.",
            patches: [],
          });
        },
      },
    });

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    expect(workspace.effectiveTailoringStrength).toBe("aggressive");
    expect(workspace.strategyContext?.tailoringStrength ?? null).toBeNull();

    await workspaceService.sendResumeAssistantMessage(
      "job_ready",
      "Tighten the summary.",
    );
    expect(capturedTailoringStrength).toBe("aggressive");
  });

  test("a conservative strategy wins over the global aggressive default for review", async () => {
    const seed = createSeed();
    seed.searchPreferences = {
      ...seed.searchPreferences,
      tailoringMode: "aggressive",
    };
    let capturedTailoringStrength: string | null | undefined;
    const baseAiClient = createAiClient();
    const { workspaceService } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        reviseResumeDraft(input) {
          capturedTailoringStrength = input.tailoringStrength ?? null;
          return Promise.resolve({
            content: "No edits.",
            patches: [],
          });
        },
      },
    });

    await workspaceService.getWorkspaceSnapshot();
    const created = await workspaceService.saveResumeStrategy({
      id: null,
      name: "Keep every fact",
      roleFamily: "Product Designer",
      baseResumeDocumentId: "resume_1",
      templateId: "modern_split",
      headlinePolicy: "role_family_template",
      skillsPolicy: "role_family_expanded",
      coveragePolicy: "role_family_recommended",
      tailoringStrength: "conservative",
      evidenceBoundaries: {
        allowExactClaims: true,
        allowParaphrasedClaims: false,
        maxEvidenceRefsPerBullet: 3,
        requireVerifierPass: true,
      },
      enabled: true,
    });
    const strategyId = created.intelligence.resumeStrategies[0]!.id;
    await workspaceService.selectResumeStrategy({
      jobId: "job_ready",
      campaignId: "campaign_default",
      strategyId,
      source: "manual",
      reason: "User chose the conservative approach for this posting.",
    });

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    expect(workspace.effectiveTailoringStrength).toBe("conservative");
    expect(workspace.strategyContext?.tailoringStrength).toBe("conservative");

    await workspaceService.sendResumeAssistantMessage(
      "job_ready",
      "Tighten the summary.",
    );
    expect(capturedTailoringStrength).toBe("conservative");
  });

  test("an aggressive per-job level wins over a selected conservative strategy during generation", async () => {
    const seed = createSeed();
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_ready"
        ? { ...job, resumeTailoringMode: "aggressive" }
        : job,
    );
    let capturedSearchPreference: string | null = null;
    let capturedStrategyStrength: string | null = null;
    const baseAiClient = createAiClient();
    const { workspaceService } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        createResumeDraft(input) {
          capturedSearchPreference = input.searchPreferences.tailoringMode;
          capturedStrategyStrength = input.strategy?.tailoringStrength ?? null;
          return baseAiClient.createResumeDraft(input);
        },
      },
    });

    await workspaceService.getWorkspaceSnapshot();
    const created = await workspaceService.saveResumeStrategy({
      id: null,
      name: "Keep every fact",
      roleFamily: "Product Designer",
      baseResumeDocumentId: "resume_1",
      templateId: "modern_split",
      headlinePolicy: "role_family_template",
      skillsPolicy: "role_family_expanded",
      coveragePolicy: "role_family_recommended",
      tailoringStrength: "conservative",
      evidenceBoundaries: {
        allowExactClaims: true,
        allowParaphrasedClaims: false,
        maxEvidenceRefsPerBullet: 3,
        requireVerifierPass: true,
      },
      enabled: true,
    });
    await workspaceService.selectResumeStrategy({
      jobId: "job_ready",
      campaignId: "campaign_default",
      strategyId: created.intelligence.resumeStrategies[0]!.id,
      source: "manual",
      reason: "User chose a saved strategy before selecting the job level.",
    });

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");

    expect(capturedSearchPreference).toBe("aggressive");
    expect(capturedStrategyStrength).toBe("aggressive");
    expect(workspace.strategyContext?.tailoringStrength).toBe("conservative");
    expect(workspace.effectiveTailoringStrength).toBe("aggressive");
  });

  test("generation preview returns blocking model repairs separately from person confirmations", async () => {
    const seed = createSeed();
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_ready"
        ? { ...job, resumeTailoringMode: "aggressive" }
        : job,
    );
    let requiredModelRepairCount = -1;
    let personConfirmationCount = -1;
    const baseAiClient = createAiClient();
    const { workspaceService } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        async createResumeDraft(input) {
          const draft = await baseAiClient.createResumeDraft(input);
          const preview = await input.renderPreview?.({
            draft: {
              ...draft,
              summary:
                "Directed a fictional lunar migration for the target employer.",
            },
            templateId:
              input.selectedTemplateId ?? input.settings.resumeTemplateId,
          });
          requiredModelRepairCount =
            preview?.requiredModelRepairs?.length ?? -1;
          personConfirmationCount = preview?.personConfirmationCount ?? -1;
          return draft;
        },
      },
    });

    await workspaceService.generateResume("job_ready");

    expect(requiredModelRepairCount).toBeGreaterThan(0);
    expect(personConfirmationCount).toBeGreaterThanOrEqual(0);
  });

  test("generation preview leaves aggressive confirm-needed claims for the person", async () => {
    const seed = createSeed();
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_ready"
        ? {
            ...job,
            resumeTailoringMode: "aggressive",
            keySkills: [...job.keySkills, "Terraform"],
          }
        : job,
    );
    let requiredModelRepairCount = -1;
    let personConfirmationCount = -1;
    const baseAiClient = createAiClient();
    const { workspaceService } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        async createResumeDraft(input) {
          const draft = await baseAiClient.createResumeDraft(input);
          const preview = await input.renderPreview?.({
            draft: {
              ...draft,
              coreSkills: [...draft.coreSkills, "Terraform"],
            },
            templateId:
              input.selectedTemplateId ?? input.settings.resumeTemplateId,
          });
          requiredModelRepairCount =
            preview?.requiredModelRepairs?.length ?? -1;
          personConfirmationCount = preview?.personConfirmationCount ?? -1;
          return draft;
        },
      },
    });

    await workspaceService.generateResume("job_ready");

    expect(personConfirmationCount).toBeGreaterThan(0);
    expect(requiredModelRepairCount).toBe(0);
  });
});
