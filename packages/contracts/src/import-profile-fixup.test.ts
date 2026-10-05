import { expect, test } from "vitest";
import { normalizePublicLinkUrl } from "./base";
import { ResumeSourceDocumentSchema } from "./profile";
import { ProfileSetupStateSchema } from "./profile-setup";
import {
  canRetrySavedResumeImport,
  CancelResumeImportRequestSchema,
} from "./resume-import";
test("normalizes bare domains mechanically without repairing invalid input", () => {
  expect(normalizePublicLinkUrl("dribbble.com/hannah-berg-example")).toBe(
    "https://dribbble.com/hannah-berg-example",
  );
  expect(normalizePublicLinkUrl("hannahberg.example.com")).toBe(
    "https://hannahberg.example.com/",
  );
  expect(normalizePublicLinkUrl("https://example.test/path")).toBe(
    "https://example.test/path",
  );
  expect(normalizePublicLinkUrl("not a url")).toBe("not a url");
});
test("preserves model source identity on the imported resume", () => {
  expect(
    ResumeSourceDocumentSchema.parse({
      id: "r",
      fileName: "hannah.md",
      uploadedAt: "2026-10-04T00:00:00.000Z",
      sourceIdentity: { fullName: "Hannah Berg", email: null },
    }).sourceIdentity?.fullName,
  ).toBe("Hannah Berg");
});
test("preserves reviewed setup steps and normalizes old step names", () => {
  expect(
    ProfileSetupStateSchema.parse({
      reviewedSteps: ["essentials", "background", "answers"],
    }).reviewedSteps,
  ).toEqual(["essentials", "background", "extras"]);
});
test("only stopped and connection-failed imports retry the saved file", () => {
  expect(
    canRetrySavedResumeImport({
      status: "failed",
      failureKind: "invalid_document",
    }),
  ).toBe(false);
  expect(
    canRetrySavedResumeImport({
      status: "failed",
      failureKind: "ai_unavailable",
    }),
  ).toBe(true);
  expect(
    canRetrySavedResumeImport({ status: "failed", failureKind: "cancelled" }),
  ).toBe(true);
  expect(
    canRetrySavedResumeImport({ status: "failed", failureKind: "interrupted" }),
  ).toBe(true);
});
test("explicit processing cancellation has a typed flag", () => {
  expect(
    CancelResumeImportRequestSchema.parse({
      requestId: "r",
      stopProcessing: true,
    }).stopProcessing,
  ).toBe(true);
  expect(
    CancelResumeImportRequestSchema.parse({ requestId: "r" }).stopProcessing,
  ).toBeUndefined();
});
