import { expect, test, vi } from "vitest";
import type { JobFinderAiClient } from "@nordri/ai-providers";
import {
  createSeed,
  createAiClient,
  createWorkspaceServiceHarness,
} from "../workspace-service.test-support";
import {
  seedResumeDraft,
  buildResumeRenderDocument,
} from "./resume-workspace-structure";
import {
  buildResumeCoverageComparison,
  validateResumeDraft,
} from "./resume-workspace-helpers";
import { writeResumeLanguage } from "./resume-workspace-language";

function context() {
  const seed = createSeed();
  const job = {
    ...seed.savedJobs[0]!,
    description:
      "DISPONENT / SPEDITIONSKAUFMANN in Hamburg. Lagerlogistik und Schichtplanung.",
  };
  const draft = seedResumeDraft({
    profile: seed.profile,
    job,
    templateId: seed.settings.resumeTemplateId,
  });
  return { ...seed, job, draft };
}

test("translates every field together in one model call and keeps source structure", async () => {
  const { draft, job, profile } = context();
  const chatWithTools = vi.fn<NonNullable<JobFinderAiClient["chatWithTools"]>>(
    (messages) => {
      const payload = JSON.parse(messages[1]!.content) as {
        language: string | null;
        fields: Array<{ id: string; text: string }>;
      };
      expect(payload.language).toBeNull();
      expect(messages[0]!.content).toContain(
        "generic credential descriptions such as First aid",
      );
      return Promise.resolve({
        content: JSON.stringify({
          language: "German",
          listingLanguage: "German",
          translations: payload.fields.map((field) => ({
            id: field.id,
            text: field.id.endsWith(":label")
              ? "Berufserfahrung"
              : field.id.endsWith(":dateRange")
                ? "Januar 2020 – heute"
                : field.text,
          })),
        }),
      });
    },
  );
  const result = await writeResumeLanguage({
    aiClient: { chatWithTools },
    draft,
    job,
  });
  expect(chatWithTools).toHaveBeenCalledTimes(1);
  expect(result.writtenLanguage).toBe("German");
  expect(result.listingLanguage).toBe("German");
  const role = result.sections.find((section) => section.kind === "experience")!
    .entries[0]!;
  expect(role.profileRecordId).toBe(
    draft.sections.find((section) => section.kind === "experience")!.entries[0]!
      .profileRecordId,
  );
  expect(
    buildResumeRenderDocument(profile, result).sections.find(
      (section) => section.kind === "experience",
    )?.entries[0]?.dateRange,
  ).toBe("Januar 2020 – heute");
});

test("a chosen language overrides the listing and rejects incomplete translation", async () => {
  const { draft, job } = context();
  const chatWithTools = vi.fn<NonNullable<JobFinderAiClient["chatWithTools"]>>(
    (messages) => {
      expect(messages[1]!.content).toContain('"language":"English"');
      return Promise.resolve({
        content: JSON.stringify({ language: "English", translations: [] }),
      });
    },
  );
  await expect(
    writeResumeLanguage({
      aiClient: { chatWithTools },
      draft: { ...draft, language: "English" },
      job,
    }),
  ).rejects.toThrow("did not cover the whole resume");
  expect(draft.language).toBeUndefined();
});

test("a language change without AI keeps the existing draft and reports failure", async () => {
  const { draft, job } = context();
  await expect(
    writeResumeLanguage({
      aiClient: {},
      draft: { ...draft, language: "German" },
      job,
    }),
  ).rejects.toThrow("previous resume was kept");
});

test.each([null, "German"])(
  "generation uses the writer language %s without a translation call",
  async (language) => {
    const seed = createSeed();
    const base = createAiClient();
    const chatWithTools =
      vi.fn<NonNullable<JobFinderAiClient["chatWithTools"]>>();
    const createResumeDraft = vi.fn<JobFinderAiClient["createResumeDraft"]>(
      async (input) => {
        expect(input.language).toBe(language);
        expect(input.languageFields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "section_experience:label" }),
          ]),
        );
        return {
          ...(await base.createResumeDraft(input)),
          languagePresentation: {
            language: language ?? "English",
            translations: language
              ? [{ id: "section_experience:label", text: "Berufserfahrung" }]
              : [],
          },
        };
      },
    );
    const { workspaceService, repository } = createWorkspaceServiceHarness({
      seed,
      aiClient: { ...base, createResumeDraft, chatWithTools },
    });
    if (language)
      await workspaceService.generateResume("job_ready", { language });
    else await workspaceService.generateResume("job_ready");
    await workspaceService.regenerateResumeDraft("job_ready");
    expect(createResumeDraft).toHaveBeenCalledTimes(2);
    expect(chatWithTools).not.toHaveBeenCalled();
    expect(await repository.getResumeDraftByJobId("job_ready")).toMatchObject({
      language,
      writtenLanguage: language ?? "English",
    });
    if (language)
      expect(
        (await repository.getResumeDraftByJobId("job_ready"))?.sections.find(
          (section) => section.kind === "experience",
        )?.label,
      ).toBe("Berufserfahrung");
  },
);

test("changing an existing Light draft translates once, checks translated text and never regenerates", async () => {
  const seed = createSeed();
  seed.savedJobs = seed.savedJobs.map((job) =>
    job.id === "job_ready"
      ? { ...job, resumeTailoringMode: "conservative" }
      : job,
  );
  const base = createAiClient();
  const createResumeDraft = vi.fn<JobFinderAiClient["createResumeDraft"]>(
    (input) => base.createResumeDraft(input),
  );
  const checkResumeClaims = vi.fn<
    NonNullable<JobFinderAiClient["checkResumeClaims"]>
  >((input) =>
    Promise.resolve(
      input.claims.map((claim) => ({
        id: claim.id,
        verdict: "supported" as const,
        reason: "Supported translated source facts",
        evidenceIds: [],
        style: null,
        fix: null,
      })),
    ),
  );
  const chatWithTools = vi.fn<NonNullable<JobFinderAiClient["chatWithTools"]>>(
    (messages) => {
      const payload = JSON.parse(messages[1]!.content) as {
        fields: Array<{ id: string; text: string }>;
      };
      return Promise.resolve({
        content: JSON.stringify({
          language: "German",
          translations: payload.fields.map((field) => ({
            ...field,
            text:
              field.id === "section_summary:text"
                ? "Erfahrene Fachkraft mit belegten Ergebnissen im Betrieb."
                : field.text,
          })),
        }),
      });
    },
  );
  const { workspaceService, repository } = createWorkspaceServiceHarness({
    seed,
    aiClient: { ...base, createResumeDraft, chatWithTools, checkResumeClaims },
  });
  const workspace = await workspaceService.getResumeWorkspace("job_ready");
  await workspaceService.saveResumeDraft({
    ...workspace.draft,
    language: "German",
  });
  expect(chatWithTools).toHaveBeenCalledTimes(1);
  expect(createResumeDraft).not.toHaveBeenCalled();
  expect(
    checkResumeClaims.mock.calls
      .flatMap(([input]) => input.claims)
      .map((claim) => claim.text),
  ).toContain("Erfahrene Fachkraft mit belegten Ergebnissen im Betrieb.");
  expect(
    (await repository.listSavedJobs()).find((job) => job.id === "job_ready")
      ?.resumeTailoringMode,
  ).toBe("conservative");
  const saved = await repository.getResumeDraftByJobId("job_ready");
  expect(saved).toMatchObject({
    language: "German",
    writtenLanguage: "German",
  });
  await workspaceService.saveResumeDraft(saved!);
  expect(chatWithTools).toHaveBeenCalledTimes(1);
});

test("translated imported lines and keywords keep their original field sources", async () => {
  const seed = context();
  const profile = {
    ...seed.profile,
    skills: ["Warehouse planning", "Inventory control"],
    spokenLanguages: [
      {
        id: "german",
        language: "German",
        proficiency: "C1",
        interviewPreference: false,
        notes: null,
      },
      {
        id: "polish",
        language: "Polish",
        proficiency: "Native",
        interviewPreference: false,
        notes: null,
      },
      {
        id: "english",
        language: "English",
        proficiency: "B1",
        interviewPreference: false,
        notes: null,
      },
    ],
    certifications: [
      {
        id: "first_aid",
        name: "First aid",
        issuer: null,
        issueDate: null,
        expiryDate: null,
        credentialUrl: null,
        isDraft: false,
      },
    ],
  };
  const job = seed.job;
  const draft = seedResumeDraft({
    profile,
    job,
    templateId: seed.settings.resumeTemplateId,
  });
  const result = await writeResumeLanguage({
    draft,
    job,
    aiClient: {
      chatWithTools: async (messages) => {
        const payload = JSON.parse(messages[1]!.content) as {
          fields: Array<{ id: string; text: string }>;
        };
        return {
          content: JSON.stringify({
            language: "German",
            translations: payload.fields.map(({ id, text }) => ({
              id,
              text: `Übersetzt: ${text}`,
            })),
          }),
        };
      },
    },
  });
  // Restoring an older translated draft changes its draft id, while its
  // original field links still point at the draft that was translated.
  const olderTranslated = { ...result, id: "restored-translated-draft" };
  const comparison = buildResumeCoverageComparison({
    profile,
    draft: olderTranslated,
  });
  expect(comparison.addedKeywords).toEqual([]);
  expect(comparison.removedKeywords).toEqual(
    buildResumeCoverageComparison({ profile, draft }).removedKeywords,
  );
  for (const role of comparison.roles) {
    expect(role.status).toBe("rewritten");
    expect(role.retainedClaimCount).toBe(role.originalClaimCount);
    for (const original of role.removedClaims)
      expect(
        role.addedClaims.some((added) =>
          original.sourceAchievementIds?.some((id) =>
            added.sourceAchievementIds?.includes(id),
          ),
        ),
      ).toBe(true);
  }
  const again = await writeResumeLanguage({
    draft: result,
    job,
    aiClient: {
      chatWithTools: async (messages) => {
        const payload = JSON.parse(messages[1]!.content) as {
          fields: Array<{ id: string; text: string }>;
        };
        return {
          content: JSON.stringify({
            language: "French",
            translations: payload.fields.map(({ id, text }) => ({
              id,
              text: `Traduit: ${text}`,
            })),
          }),
        };
      },
    },
  });
  expect(
    buildResumeCoverageComparison({ profile, draft: again }).addedKeywords,
  ).toEqual([]);
});

test("R3-183 a continued generation reads its persisted language request", async () => {
  const seed = createSeed();
  const base = createAiClient();
  const createResumeDraft = vi.fn<JobFinderAiClient["createResumeDraft"]>(
    async (input) => {
      expect(input.language).toBe("German");
      return {
        ...(await base.createResumeDraft(input)),
        languagePresentation: { language: "German", translations: [] },
      };
    },
  );
  const { workspaceService } = createWorkspaceServiceHarness({
    seed,
    aiClient: { ...base, createResumeDraft },
  });
  await workspaceService.saveResumeBatchCheckpoint({
    id: "continued",
    jobIds: ["job_ready"],
    activeJobIds: [],
    completedJobIds: [],
    done: false,
    stopRequested: false,
    running: true,
    resumedBatchIds: ["interrupted"],
    requests: [{ jobId: "job_ready", language: "German", regenerate: true }],
  });
  await workspaceService.generateResume("job_ready");
  await workspaceService.regenerateResumeDraft("job_ready");
  expect(createResumeDraft).toHaveBeenCalledTimes(2);
});

test("stored older translated experience lines without source links retain their original positions", async () => {
  const seed = createSeed();
  const experience = seed.profile.experiences[0]!;
  seed.profile.experiences = [
    {
      ...experience,
      summary: "Coordinated the daily team schedule.",
      achievements: [
        "Managed customer orders.",
        "Organized warehouse deliveries.",
      ],
    },
  ];
  const draft = seedResumeDraft({
    profile: seed.profile,
    job: seed.savedJobs[0]!,
    templateId: seed.settings.resumeTemplateId,
  });
  draft.language = "German";
  draft.writtenLanguage = "German";
  const entry = draft.sections.find((section) => section.kind === "experience")!
    .entries[0]!;
  entry.summary = "Koordination des täglichen Schichtplans.";
  entry.sourceRefs = [];
  entry.bullets[0]!.text = "Bearbeitung von Kundenaufträgen.";
  entry.bullets[1]!.text = "Organisation der Lagerlieferungen.";
  for (const bullet of entry.bullets) bullet.sourceRefs = [];
  const { repository, workspaceService } = createWorkspaceServiceHarness({
    seed,
  });
  await repository.upsertResumeDraft(draft);
  const legacyValidation = validateResumeDraft({
    draft,
    profile: seed.profile,
    job: seed.savedJobs[0]!,
  });
  // Old persisted comparisons have no links on their translated rows.
  for (const role of legacyValidation.coverageComparison!.roles) {
    role.retainedClaimCount = 0;
    for (const claim of role.addedClaims) delete claim.sourceAchievementIds;
  }
  await repository.upsertResumeValidationResult(legacyValidation);
  const workspace = await workspaceService.getResumeWorkspace(draft.jobId);
  const role = workspace.validation!.coverageComparison!.roles[0]!;
  expect(role.retainedClaimCount).toBe(3);
  expect(role.status).toBe("rewritten");
  for (const [index, added] of role.addedClaims.entries()) {
    expect(added.sourceAchievementIds).toEqual(
      role.removedClaims[index]!.sourceAchievementIds,
    );
  }
});
