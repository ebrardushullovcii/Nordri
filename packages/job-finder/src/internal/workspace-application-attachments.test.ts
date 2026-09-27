import {
  ApplicationAnswerRecordSchema,
  ApplicationQuestionRecordSchema,
  CandidateAssetSchema,
} from "@unemployed/contracts";
import { describe, expect, it, vi } from "vitest";
import { resolveApplicationAttachmentsForExecution } from "./workspace-application-attachments";

const now = "2026-08-10T10:00:00.000Z";

const asset = CandidateAssetSchema.parse({
  id: "asset-portfolio",
  kind: "portfolio",
  originalName: "portfolio.pdf",
  mime: "application/pdf",
  byteSize: 100,
  sha256: "a".repeat(64),
  createdAt: now,
  sensitivity: "sensitive",
  consentScope: "job_application_attachment",
  retention: "until_deleted",
});

const question = ApplicationQuestionRecordSchema.parse({
  id: "question-portfolio",
  runId: "run-1",
  jobId: "job-1",
  resultId: "result-1",
  prompt: "Upload a portfolio",
  kind: "portfolio",
  answerControlType: "file",
  isRequired: true,
  detectedAt: now,
  selectedAnswerId: "answer-asset",
  status: "answered",
});

const answer = ApplicationAnswerRecordSchema.parse({
  id: "answer-asset",
  runId: "run-1",
  jobId: "job-1",
  resultId: "result-1",
  questionId: question.id,
  status: "suggested",
  text: asset.originalName,
  value: { type: "asset_ref", assetId: asset.id },
  revision: 1,
  sourceKind: "user",
  createdAt: now,
});

describe("application attachment execution", () => {
  it("offers every active asset allowed for application attachment before a form question exists", async () => {
    const privateAsset = CandidateAssetSchema.parse({
      ...asset,
      id: "asset-private",
      originalName: "private-notes.pdf",
      consentScope: "private_storage_only",
    });
    const assistantAsset = CandidateAssetSchema.parse({
      ...asset,
      id: "asset-assistant",
      originalName: "assistant-context.pdf",
      consentScope: "assistant_context",
    });
    const deletedAsset = CandidateAssetSchema.parse({
      ...asset,
      id: "asset-deleted",
      originalName: "deleted-portfolio.pdf",
      deletedAt: now,
      lifecycle: {
        retentionStartedAt: now,
        expiresAt: null,
        deletionReason: "removed",
        purgeAt: "2026-08-17T10:00:00.000Z",
      },
    });
    const loadVerifiedBytes = vi.fn(() =>
      Promise.resolve(new Uint8Array([1, 2, 3])),
    );
    const resolveForApplication = vi.fn((assetId: string) => {
      if (assetId !== asset.id) throw new Error("Unexpected asset");
      return Promise.resolve({ asset, loadVerifiedBytes });
    });

    const result = await resolveApplicationAttachmentsForExecution({
      resolver: {
        list: () =>
          Promise.resolve({
            assets: [privateAsset, assistantAsset, deletedAsset, asset],
          }),
        resolveForApplication,
      },
      questionRecords: [],
      answerRecords: [],
    });

    expect(resolveForApplication).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        assetId: asset.id,
        assetKind: "portfolio",
        questionId: null,
        prompt: "Portfolio from the person's files",
        questionKind: "portfolio",
        fileName: asset.originalName,
        mime: asset.mime,
        sha256: asset.sha256,
        loadVerifiedBytes,
      },
    ]);
    expect(loadVerifiedBytes).not.toHaveBeenCalled();
  });

  it("keeps valid supporting assets when an unrelated catalog file is unavailable and excludes resume assets", async () => {
    const unavailableTranscript = CandidateAssetSchema.parse({
      ...asset,
      id: "asset-transcript",
      kind: "transcript",
      originalName: "transcript.pdf",
    });
    const catalogResume = CandidateAssetSchema.parse({
      ...asset,
      id: "asset-resume",
      kind: "resume",
      originalName: "old-resume.pdf",
    });
    const loadVerifiedBytes = vi.fn(() =>
      Promise.resolve(new Uint8Array([1, 2, 3])),
    );
    const resolveForApplication = vi.fn((assetId: string) => {
      if (assetId === unavailableTranscript.id) {
        return Promise.reject(new Error("File was removed"));
      }
      if (assetId !== asset.id) throw new Error("Unexpected asset");
      return Promise.resolve({ asset, loadVerifiedBytes });
    });

    const result = await resolveApplicationAttachmentsForExecution({
      resolver: {
        list: () =>
          Promise.resolve({
            assets: [catalogResume, unavailableTranscript, asset],
          }),
        resolveForApplication,
      },
      questionRecords: [],
      answerRecords: [],
    });

    expect(resolveForApplication).toHaveBeenCalledTimes(2);
    expect(resolveForApplication).not.toHaveBeenCalledWith(catalogResume.id);
    expect(result.map((entry) => entry.assetId)).toEqual([asset.id]);
  });

  it("resolves only the exact selected asset into a main-process artifact", async () => {
    const loadVerifiedBytes = vi.fn(() =>
      Promise.resolve(new Uint8Array([1, 2, 3])),
    );
    const resolveForApplication = vi.fn(() =>
      Promise.resolve({ asset, loadVerifiedBytes }),
    );

    const result = await resolveApplicationAttachmentsForExecution({
      resolver: {
        list: () => Promise.resolve({ assets: [asset] }),
        resolveForApplication,
      },
      questionRecords: [question],
      answerRecords: [answer],
    });

    expect(resolveForApplication).toHaveBeenCalledWith(asset.id);
    expect(resolveForApplication).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        assetId: asset.id,
        assetKind: "portfolio",
        questionId: question.id,
        prompt: question.prompt,
        questionKind: "portfolio",
        fileName: asset.originalName,
        mime: asset.mime,
        sha256: asset.sha256,
        loadVerifiedBytes,
      },
    ]);
    expect(loadVerifiedBytes).not.toHaveBeenCalled();
  });

  it("does not resurrect an asset after its latest answer revision was cleared", async () => {
    const cleared = ApplicationAnswerRecordSchema.parse({
      ...answer,
      id: "answer-cleared",
      status: "rejected",
      text: "Answer cleared by the user",
      value: null,
      revision: 2,
      supersedesAnswerId: answer.id,
    });
    const result = await resolveApplicationAttachmentsForExecution({
      resolver: undefined,
      questionRecords: [
        { ...question, selectedAnswerId: null, status: "detected" },
      ],
      answerRecords: [answer, cleared],
    });

    expect(result).toEqual([]);
  });

  it("fails safely when an active asset answer cannot be resolved", async () => {
    await expect(
      resolveApplicationAttachmentsForExecution({
        resolver: undefined,
        questionRecords: [question],
        answerRecords: [answer],
      }),
    ).rejects.toThrow(/asset library is unavailable/i);
  });
});
