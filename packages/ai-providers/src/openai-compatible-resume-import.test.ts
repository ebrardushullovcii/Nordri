import { describe, expect, test } from "vitest";
import type { AgentProviderStatus, ResumeDocumentBundle } from "@nordri/contracts";
import { createPreferences, createProfile } from "./test-fixtures";
import { extractOpenAiCompatibleResumeImportStage } from "./openai-compatible-resume-import";

const status: AgentProviderStatus = {
  kind: "openai_compatible",
  role: "chat",
  ready: true,
  label: "AI resume agent",
  model: "test-model",
  baseUrl: "https://example.com/v1",
  modelContextWindowTokens: null,
  reservedHeadroomTokens: null,
  requestTimeoutMs: null,
  detail: null,
};

const documentBundle: ResumeDocumentBundle = {
  id: "bundle_1",
  runId: "run_1",
  sourceResumeId: "resume_1",
  sourceFileKind: "pdf",
  primaryParserKind: "pdfjs_text",
  parserKinds: ["pdfjs_text"],
  createdAt: "2026-04-10T00:00:00.000Z",
  warnings: [],
  languageHints: [],
  pages: [],
  fullText: "Ebrar Dushullovci\nAddress: Prishtina, Kosovo",
  blocks: [
    {
      id: "block_1",
      pageNumber: 1,
      readingOrder: 0,
      text: "Ebrar Dushullovci",
      kind: "paragraph",
      sectionHint: "identity",
      bbox: null,
      sourceParserKinds: ["pdfjs_text"],
      sourceConfidence: 0.72,
    },
  ],
};

describe("extractOpenAiCompatibleResumeImportStage", () => {
  test("normalizes string notes into an array instead of failing the stage", async () => {
    const result = await extractOpenAiCompatibleResumeImportStage({
      stageInput: {
        stage: "identity_summary",
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        documentBundle,
      },
      status,
      fetchModelJson: () =>
        Promise.resolve({
          candidates: [],
          notes: "single stage note",
        }),
      timeoutMs: 1_000,
    });

    expect(result.notes).toEqual(["single stage note"]);
    expect(result.candidates).toEqual([]);
  });

  test("normalizes string target and candidate notes into the draft schema", async () => {
    const result = await extractOpenAiCompatibleResumeImportStage({
      stageInput: {
        stage: "identity_summary",
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        documentBundle,
      },
      status,
      fetchModelJson: () =>
        Promise.resolve({
          candidates: [
            {
              target: "identity:fullName",
              label: "Full name",
              value: "Ebrar Dushullovci",
              evidenceText: "Ebrar Dushullovci",
              sourceBlockIds: "block_1",
              confidence: "0.98",
              notes: "literal top line",
              alternatives: null,
              visualEvidence: [
                {
                  branch: "vision",
                  sourceFileKind: "pdf",
                  pageNumber: 1,
                  regionHint: "name heading",
                  confidence: 0.8,
                  uncertaintyNotes: [],
                },
              ],
            },
          ],
          notes: [],
        }),
      timeoutMs: 1_000,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      target: { section: "identity", key: "fullName", recordId: null },
      label: "Full name",
      value: "Ebrar Dushullovci",
      sourceBlockIds: ["block_1"],
      confidence: 0.98,
      notes: ["literal top line"],
      alternatives: [],
      visualEvidence: [
        {
          branch: "vision",
          sourceFileKind: "pdf",
          pageNumber: 1,
          regionHint: "name heading",
          confidence: 0.8,
          uncertaintyNotes: [],
        },
      ],
    });

    expect(result.candidates[0]?.confidenceBreakdown?.overall).toBeGreaterThan(0.8);
    expect(result.candidates[0]?.confidenceBreakdown?.recommendation).toBe("auto_apply");
  });
});
