import { describe, expect, it } from "vitest";

import { AssistantEditConflictError } from "../internal/workspace-assistant-edit-methods";
import { createWorkspaceServiceHarness } from "../workspace-service.test-support";
import { describeSavedResumeChanges } from "./tools/resume-tools";

describe("assistant resume edits report only what was saved", () => {
  it("refuses a summary the resume checker would replace, and leaves the draft as it was", async () => {
    const { workspaceService } = createWorkspaceServiceHarness();
    const before = await workspaceService.getResumeWorkspace("job_ready");
    const summary = before.draft.sections.find(
      (section) => section.kind === "summary",
    );
    expect(summary).toBeTruthy();
    const error = await workspaceService
      .applyAssistantResumePatches({
        jobId: "job_ready",
        patches: [
          {
            operation: "replace_section_text",
            targetSectionId: summary!.id,
            targetEntryId: null,
            anchorEntryId: null,
            targetBulletId: null,
            anchorBulletId: null,
            position: null,
            // The checker drops how a job ended from a summary.
            newText: `${summary!.text ?? ""} Position ended in a company-wide reduction.`,
            newIncluded: null,
            newLocked: null,
            newBullets: null,
            conflictReason: null,
          },
        ],
        expectedDraftUpdatedAt: before.draft.updatedAt,
        summary: "Add a reliability line",
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(AssistantEditConflictError);
    expect((error as AssistantEditConflictError).kind).toBe("not_kept");
    const after = await workspaceService.getResumeWorkspace("job_ready");
    expect(after.draft.updatedAt).toBe(before.draft.updatedAt);
    expect(
      after.draft.sections.find((section) => section.id === summary!.id)?.text,
    ).toBe(summary!.text);
  });

  it("describes the saved text, not the request, and ignores origin flips", () => {
    expect(
      describeSavedResumeChanges([
        {
          entries: [
            {
              path: ["sections", "#id:summary", "origin"],
              kind: "set",
              before: "imported",
              after: "assistant_edited",
              index: null,
              label: "Summary",
            },
          ],
        },
      ]),
    ).toBe("no visible text changed");
    expect(
      describeSavedResumeChanges([
        {
          entries: [
            {
              path: ["sections", "#id:summary", "text"],
              kind: "set",
              before: "Old.",
              after: "Builds reliable platforms.",
              index: null,
              label: "Summary",
            },
          ],
        },
      ]),
    ).toBe('Summary now reads "Builds reliable platforms."');
  });
});
