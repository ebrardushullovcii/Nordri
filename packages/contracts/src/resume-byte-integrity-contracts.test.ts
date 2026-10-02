import { describe, expect, it } from "vitest";
import {
  ApplicationResumeArtifactSchema,
  ResumeExportArtifactSchema,
  ResumeExportArtifactSummarySchema,
  ResumeSourceDocumentSchema,
} from "./index";

const sha256 = "a".repeat(64);

describe("resume byte integrity contracts", () => {
  it("accepts a nullable SHA-256 while preserving legacy records", () => {
    const sourceBase = {
      id: "resume_1",
      fileName: "resume.pdf",
      uploadedAt: "2026-07-30T12:00:00.000Z",
    };
    expect(ResumeSourceDocumentSchema.parse(sourceBase).sha256).toBeUndefined();
    expect(
      ResumeSourceDocumentSchema.parse({ ...sourceBase, sha256 }).sha256,
    ).toBe(sha256);

    const exportBase = {
      id: "export_1",
      draftId: "draft_1",
      jobId: "job_1",
      format: "pdf",
      filePath: "/tmp/resume.pdf",
      templateId: "classic_ats",
      exportedAt: "2026-07-30T12:00:00.000Z",
    };
    expect(ResumeExportArtifactSchema.parse(exportBase).sha256).toBeUndefined();
    expect(
      ResumeExportArtifactSchema.parse({ ...exportBase, sha256 }).sha256,
    ).toBe(sha256);
  });

  it("keeps saved digests in export summaries and defaults legacy digests to null", () => {
    const artifact = {
      id: "export_1",
      draftId: "draft_1",
      jobId: "job_1",
      format: "pdf",
      filePath: "/synthetic/resume.pdf",
      templateId: "classic_ats",
      exportedAt: "2026-07-30T12:00:00.000Z",
      isApproved: true,
    };
    expect(
      ResumeExportArtifactSummarySchema.parse({ ...artifact, sha256 }).sha256,
    ).toBe(sha256);
    expect(ResumeExportArtifactSummarySchema.parse(artifact).sha256).toBeNull();
    expect(
      ResumeExportArtifactSummarySchema.parse({ ...artifact, sha256: null })
        .sha256,
    ).toBeNull();
  });

  it("rejects malformed digests on source, export, and application artifacts", () => {
    expect(
      ResumeSourceDocumentSchema.safeParse({
        id: "resume_1",
        fileName: "resume.pdf",
        uploadedAt: "2026-07-30T12:00:00.000Z",
        sha256: "bad",
      }).success,
    ).toBe(false);
    expect(
      ResumeExportArtifactSchema.safeParse({
        id: "export_1",
        draftId: "draft_1",
        jobId: "job_1",
        format: "pdf",
        filePath: "/tmp/resume.pdf",
        templateId: "classic_ats",
        exportedAt: "2026-07-30T12:00:00.000Z",
        sha256: "bad",
      }).success,
    ).toBe(false);
    expect(
      ApplicationResumeArtifactSchema.safeParse({
        id: "application_resume_1",
        jobId: "job_1",
        source: "original_upload",
        fileName: "resume.pdf",
        filePath: "/tmp/resume.pdf",
        approvedAt: "2026-07-30T12:00:00.000Z",
        sha256: "bad",
      }).success,
    ).toBe(false);
  });
});
