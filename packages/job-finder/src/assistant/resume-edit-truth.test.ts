import { describe, expect, it } from "vitest";
import type { AssistantTurnSession } from "./tool-kit";

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

it("R3-118 restores seasonal wording through assistant edits and the same Undo receipt", async () => {
  const { editResumeTool } = await import("./tools/resume-tools");
  const { createSeed } = await import("../workspace-service.test-support");
  const { workspaceService: service } = createWorkspaceServiceHarness({
    seed: createSeed(),
  });
  const workspace = await service.getResumeWorkspace("job_ready");
  const section = workspace.draft.sections.find(
    (entry) => entry.kind === "experience" && entry.entries.length,
  )!;
  const entry = section.entries[0]!;
  Object.assign(entry, {
    dateRange: "June 2019 – August 2022",
    startDate: "June 2019",
    endDate: "August 2022",
    isCurrent: false,
  });
  await service.saveResumeDraft(workspace.draft);
  const before = await service.getResumeWorkspace("job_ready");
  const recorded: Parameters<AssistantTurnSession["recordChange"]>[0][] = [];
  const session = {
    assertCurrent: () => undefined,
    now: () => new Date().toISOString(),
    recordChange: (
      change: Parameters<AssistantTurnSession["recordChange"]>[0],
    ) => {
      recorded.push(change);
      return Promise.resolve({
        receipt: { id: "seasonal_receipt" },
        part: { type: "notice", kind: "info", text: "Saved" },
      });
    },
  } as unknown as AssistantTurnSession;
  await editResumeTool.execute(
    editResumeTool.input.parse({
      jobId: "job_ready",
      revision: before.draft.updatedAt,
      summary: "Restore summers wording",
      edits: [
        {
          operation: "replace_entry_date_range",
          sectionId: section.id,
          entryId: entry.id,
          text: "June 2019 – August 2022 (summers)",
        },
      ],
    }),
    {
      service,
      session,
      ports: { publishWorkspaceUpdate: () => undefined } as never,
    },
  );
  const after = await service.getResumeWorkspace("job_ready");
  expect(
    after.draft.sections
      .find((row) => row.id === section.id)!
      .entries.find((row) => row.id === entry.id),
  ).toMatchObject({
    dateRange: "June 2019 – August 2022 (summers)",
    startDate: "June 2019",
    endDate: "August 2022",
    isCurrent: false,
  });
  expect(recorded).toHaveLength(1);
  await service.undoAssistantResumeChange({
    jobId: "job_ready",
    entries: recorded[0]!.entries,
    reason: "Undo seasonal wording",
  });
  const undone = await service.getResumeWorkspace("job_ready");
  expect(
    undone.draft.sections
      .find((row) => row.id === section.id)!
      .entries.find((row) => row.id === entry.id)?.dateRange,
  ).toBe("June 2019 – August 2022");
});
