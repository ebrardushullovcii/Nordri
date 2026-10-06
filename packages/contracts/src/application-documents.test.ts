import { resumeFormFileNames } from "./application-documents";
import { describe, expect, it } from "vitest";

import {
  ApplicationDocumentRevisionSchema,
  ApplicationDocumentListResultSchema,
  EditApplicationDocumentInputSchema,
  ProposeApplicationDocumentInputSchema,
} from "./application-documents";

describe("application document contracts", () => {
  it("keeps exact job and attachment-question lineage on every revision", () => {
    const document = ApplicationDocumentRevisionSchema.parse({
      id: "document_1",
      revision: 2,
      kind: "cover_letter",
      status: "proposed",
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-10T10:05:00.000Z",
      job: {
        jobId: "job_1",
        applicationRecordId: "application_1",
        sourceJobId: "source_job_1",
        canonicalUrl: "https://example.com/jobs/1",
        title: "Platform Engineer",
        company: "Acme",
        jobDigest: "a".repeat(64),
      },
      question: {
        runId: "run_1",
        questionId: "question_1",
        prompt: "Attach a cover letter",
      },
      content: "Grounded content",
      evidence: [
        {
          id: "profile.summary",
          source: "profile_summary",
          label: "Profile summary",
          text: "Grounded content",
        },
      ],
      evidenceDigest: "b".repeat(64),
      approvedAt: null,
      outputAsset: null,
      lastExportedAt: null,
    });

    const approved = {
      ...document,
      revision: 1,
      status: "approved" as const,
      approvedAt: document.updatedAt,
    };
    expect(
      ApplicationDocumentListResultSchema.parse({
        documents: [document],
        approvedRevisions: [approved],
      }).approvedRevisions,
    ).toEqual([approved]);
    expect(
      ApplicationDocumentListResultSchema.parse({ documents: [document] })
        .approvedRevisions,
    ).toEqual([]);
    expect(document.question?.questionId).toBe("question_1");
    expect(document.job.jobId).toBe("job_1");
  });

  it("bounds non-empty user-authored edit revisions", () => {
    expect(() =>
      EditApplicationDocumentInputSchema.parse({
        documentId: "document_1",
        expectedRevision: 1,
        content: "   ",
      }),
    ).toThrow(/cannot be empty/i);
    expect(() =>
      EditApplicationDocumentInputSchema.parse({
        documentId: "document_1",
        expectedRevision: 1,
        content: "x".repeat(12_001),
      }),
    ).toThrow(/12,000/i);
  });

  it("rejects revisions without compare-and-swap protection", () => {
    expect(() =>
      ProposeApplicationDocumentInputSchema.parse({
        kind: "short_response",
        jobId: "job_1",
        applicationRecordId: "application_1",
        documentId: "document_1",
      }),
    ).toThrow(/expected revision/i);
  });

  it("rejects unknown fields at every document mutation boundary", () => {
    expect(() =>
      EditApplicationDocumentInputSchema.parse({
        documentId: "document_1",
        expectedRevision: 1,
        content: "Reviewed content.",
        storagePath: "C:\\private\\document.txt",
      }),
    ).toThrow();
    expect(() =>
      ProposeApplicationDocumentInputSchema.parse({
        kind: "cover_letter",
        jobId: "job_1",
        applicationRecordId: "application_1",
        submitAuthorized: true,
      }),
    ).toThrow();
  });
});

it("accepts only the original and byte-identical Markdown copy filenames", () => {
  expect(resumeFormFileNames("original.md")).toEqual([
    "original.md",
    "original.txt",
  ]);
  expect(resumeFormFileNames("original.pdf")).toEqual(["original.pdf"]);
});
