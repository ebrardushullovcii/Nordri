import {
  NonEmptyStringSchema,
  ResumeDraftPatchOperationSchema,
  TailoringModeSchema,
  type AssistantChangeEntry,
  type JobFinderResumeWorkspace,
  type ResumeDraft,
} from "@unemployed/contracts";
import { z } from "zod";

import { AssistantEditConflictError } from "../../internal/workspace-assistant-edit-methods";
import {
  AssistantToolError,
  argText,
  defineTool,
  json,
  type AssistantToolContext,
} from "../tool-kit";
import { RESUME_ROUTE, plural } from "./format";

const Id = NonEmptyStringSchema.max(200);
const OWNERSHIP_STATEMENT = "I confirm this content is accurate and my own.";

function compactDraft(draft: ResumeDraft, sectionId?: string | null) {
  return {
    draftId: draft.id,
    revision: draft.updatedAt,
    status: draft.status,
    templateId: draft.templateId,
    targetPageCount: draft.targetPageCount,
    sections: draft.sections
      .filter((section) => !sectionId || section.id === sectionId)
      .map((section) => ({
        id: section.id,
        kind: section.kind,
        label: section.label,
        included: section.included,
        locked: section.locked,
        text: section.text,
        bullets: section.bullets.map((bullet) => ({
          id: bullet.id,
          text: bullet.text,
          included: bullet.included,
          locked: bullet.locked,
        })),
        entries: section.entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          subtitle: entry.subtitle,
          dateRange: entry.dateRange,
          included: entry.included,
          summary: entry.summary,
          bullets: entry.bullets.map((bullet) => ({
            id: bullet.id,
            text: bullet.text,
            included: bullet.included,
            locked: bullet.locked,
          })),
        })),
      })),
  };
}

function linesToConfirm(workspace: JobFinderResumeWorkspace) {
  return (workspace.validation?.claimAssessments ?? [])
    .filter((assessment) => assessment.status === "confirm_needed")
    .map((assessment) => ({
      claimId: assessment.id,
      text: assessment.claimText,
      sectionId: assessment.sectionId,
      entryId: assessment.entryId,
      bulletId: assessment.bulletId,
    }));
}

/**
 * Lines the checker found no saved evidence for. They block approval and
 * cannot be kept as written, unlike Lines to confirm.
 */
function unsupportedLines(workspace: JobFinderResumeWorkspace) {
  return (workspace.validation?.claimAssessments ?? [])
    .filter((assessment) => assessment.status === "unsupported")
    .map((assessment) => ({
      claimId: assessment.id,
      text: assessment.claimText,
      sectionId: assessment.sectionId,
      entryId: assessment.entryId,
      bulletId: assessment.bulletId,
    }));
}

function resumeMode(
  workspace: JobFinderResumeWorkspace,
  originalDefault: boolean,
) {
  const mode =
    workspace.job.resumeApplicationMode ??
    (originalDefault ? "original_resume" : "tailored_per_job");
  return mode === "original_resume" ? "original" : "editable";
}

export const readResumeTool = defineTool({
  name: "read_resume",
  group: "resume",
  description:
    "Reads the resume draft for one job: sections, entries and bullets with ids, the revision to edit against, validation issues, lines waiting for the person's Keep or Remove, the page count and target, and whether the job sends the original file (Original) or an editable draft.",
  parameters: json.object(
    { jobId: json.string(), sectionId: json.string("Only this section.") },
    ["jobId"],
  ),
  input: z.object({ jobId: Id, sectionId: Id.optional() }),
  label: () => "Reading the resume",
  effect: "read",
  async execute(input, { service, session }) {
    const workspace = await service.getResumeWorkspace(input.jobId);
    const snapshot = await service.getWorkspaceSnapshot();
    const originalDefault =
      snapshot.settings.resumeApplicationMode === "original_resume";
    const issues = (workspace.validation?.issues ?? []).map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      sectionId: issue.sectionId,
      entryId: issue.entryId,
      bulletId: issue.bulletId,
    }));
    const editor = session.context?.editor;
    const unsaved =
      editor?.editor === "resume" &&
      editor.jobId === input.jobId &&
      editor.hasUnsavedEdits;
    return {
      summary: `Resume for ${workspace.job.title} at ${workspace.job.company}: ${plural(workspace.draft.sections.length, "section")}, revision ${workspace.draft.updatedAt}.`,
      data: {
        job: {
          id: workspace.job.id,
          title: workspace.job.title,
          company: workspace.job.company,
        },
        mode: resumeMode(workspace, originalDefault),
        level: workspace.effectiveTailoringStrength,
        pageCount: workspace.validation?.pageCount ?? null,
        draft: compactDraft(workspace.draft, input.sectionId ?? null),
        issues: issues.slice(0, 30),
        linesToConfirm: linesToConfirm(workspace).slice(0, 30),
        unsupportedLines: unsupportedLines(workspace).slice(0, 30),
        ...(unsupportedLines(workspace).length > 0
          ? {
              unsupportedLinesNote:
                "Unsupported lines cannot be kept as written. Rewrite them from the profile's evidence or remove them with edit_resume, or, if the person confirms the fact, add it to the profile first with edit_profile and then regenerate that section.",
            }
          : {}),
        approved: workspace.draft.status === "approved",
        ...(unsaved
          ? {
              unsavedInEditor:
                "The person has unsaved edits in the resume editor. Edits you make are saved to the draft; tell them the editor will show your change after their own edits are saved or discarded.",
            }
          : {}),
        ...(editor?.editor === "resume" &&
        editor.jobId === input.jobId &&
        editor.selection
          ? { selection: editor.selection }
          : {}),
      },
    };
  },
});

const PatchInput = z.object({
  operation: ResumeDraftPatchOperationSchema,
  sectionId: Id,
  entryId: Id.nullable().optional(),
  bulletId: Id.nullable().optional(),
  anchorEntryId: Id.nullable().optional(),
  anchorBulletId: Id.nullable().optional(),
  position: z.enum(["before", "after"]).nullable().optional(),
  text: z.string().trim().min(1).max(4_000).nullable().optional(),
  included: z.boolean().nullable().optional(),
  locked: z.boolean().nullable().optional(),
});

function toPatch(patch: z.infer<typeof PatchInput>, at: string) {
  return {
    operation: patch.operation,
    targetSectionId: patch.sectionId,
    targetEntryId: patch.entryId ?? null,
    anchorEntryId: patch.anchorEntryId ?? null,
    targetBulletId: patch.bulletId ?? null,
    anchorBulletId: patch.anchorBulletId ?? null,
    position: patch.position ?? null,
    newText: patch.text ?? null,
    newIncluded: patch.included ?? null,
    newLocked: patch.locked ?? null,
    newBullets: null,
    conflictReason: null,
    appliedAt: at,
  };
}

/**
 * An explicit edit on an Original job switches that job to an editable
 * draft at the saved level (the upload and the global default stay as
 * they are), then the edit is applied.
 */
/**
 * What a committed resume change actually says now, read from the saved
 * change entries rather than from the model's own summary.
 */
export function describeSavedResumeChanges(
  changes: readonly { entries: readonly AssistantChangeEntry[] }[],
): string {
  const lines: string[] = [];
  for (const entry of changes.flatMap((change) => change.entries)) {
    const key = entry.path.at(-1) ?? "";
    const label = entry.label ?? entry.path.join(".");
    if (key === "origin" || key === "sourceRefs") continue;
    if (entry.kind === "remove") lines.push(`${label}: removed`);
    else if (typeof entry.after === "string")
      lines.push(`${label} now reads "${entry.after.slice(0, 240)}"`);
    else if (entry.kind === "insert") lines.push(`${label}: added`);
    else lines.push(`${label}: changed`);
  }
  return lines.length > 0
    ? lines.slice(0, 8).join("; ")
    : "no visible text changed";
}

async function ensureEditableJob(
  context: AssistantToolContext,
  jobId: string,
): Promise<string | null> {
  const snapshot = await context.service.getWorkspaceSnapshot();
  const job = snapshot.discoveryJobs
    .concat(snapshot.companyJobs)
    .find((entry) => entry.id === jobId);
  const mode =
    job?.resumeApplicationMode ??
    snapshot.settings.resumeApplicationMode ??
    "tailored_per_job";
  if (mode !== "original_resume") return null;
  const level =
    job?.resumeTailoringMode ?? snapshot.searchPreferences.tailoringMode;
  context.session.assertCurrent();
  await context.service.setJobResumeApplicationMode(
    jobId,
    "tailored_per_job",
    level,
  );
  return `This job used the original file, so it now uses an editable ${level === "conservative" ? "Light" : level === "balanced" ? "Tailored" : "Aggressive"} resume. Your uploaded file and the default are unchanged.`;
}

export const editResumeTool = defineTool({
  name: "edit_resume",
  group: "resume",
  description:
    "Makes targeted edits to one job's resume draft against the revision from read_resume: replace_section_text, replace_entry_summary, insert_bullet (text, anchorBulletId/position), update_bullet, remove_bullet, move_bullet, move_entry, toggle_include, set_lock, reset_entry_order. mode apply commits all edits as one change with Undo; mode suggest leaves a proposal. For a large rewrite use revise_resume instead. An edit on an Original job switches that job to an editable draft at its saved level by itself; say so in a sentence, don't ask first. Report what the result says was saved, not what you intended.",
  parameters: json.object(
    {
      jobId: json.string(),
      revision: json.string("The draft revision you read."),
      summary: json.string(),
      mode: json.enumOf(["apply", "suggest"]),
      edits: json.array(
        json.object(
          {
            operation: json.enumOf([
              "replace_section_text",
              "replace_entry_summary",
              "insert_bullet",
              "update_bullet",
              "remove_bullet",
              "move_bullet",
              "move_entry",
              "reset_entry_order",
              "toggle_include",
              "set_lock",
            ]),
            sectionId: json.string(),
            entryId: json.string(),
            bulletId: json.string(),
            anchorEntryId: json.string(),
            anchorBulletId: json.string(),
            position: json.enumOf(["before", "after"]),
            text: json.string(),
            included: json.boolean(),
            locked: json.boolean(),
          },
          ["operation", "sectionId"],
        ),
      ),
    },
    ["jobId", "summary", "edits"],
  ),
  input: z.object({
    jobId: Id,
    revision: z.string().max(200).nullable().optional(),
    summary: z.string().trim().min(1).max(300),
    mode: z.enum(["apply", "suggest"]).default("apply"),
    edits: z.array(PatchInput).min(1).max(40),
  }),
  label: (input) =>
    input.mode === "suggest"
      ? "Preparing suggested resume changes"
      : `Editing the resume: ${argText(input.summary).slice(0, 80)}`,
  effect: "local_write",
  async execute(input, context) {
    const { service, session, ports } = context;
    const at = session.now();
    const patches = input.edits.map((edit) => toPatch(edit, at));
    if (input.mode === "suggest") {
      const { proposal, part } = await session.createProposal({
        kind: "resume_patches",
        targetId: input.jobId,
        summary: input.summary,
        items: input.edits.map((edit, index) => ({
          id: `item_${index + 1}`,
          label: `${edit.operation.replaceAll("_", " ")}${edit.text ? `: ${edit.text.slice(0, 200)}` : ""}`,
          payload: patches[index],
        })),
        baseRevision: input.revision ?? null,
      });
      return {
        summary: `Suggested ${plural(patches.length, "change")}; nothing changes until the person accepts.`,
        data: { proposalId: proposal.id },
        parts: [part],
      };
    }
    const switched = await ensureEditableJob(context, input.jobId);
    session.assertCurrent();
    let result: Awaited<ReturnType<typeof service.applyAssistantResumePatches>>;
    try {
      result = await service.applyAssistantResumePatches({
        jobId: input.jobId,
        patches: patches.map((patch) => {
          const { appliedAt, ...rest } = patch;
          void appliedAt;
          return rest;
        }),
        expectedDraftUpdatedAt: switched ? null : (input.revision ?? null),
        summary: input.summary,
      });
    } catch (error) {
      if (error instanceof AssistantEditConflictError) {
        const workspace = await service.getResumeWorkspace(input.jobId);
        throw new AssistantToolError(
          error.kind === "stale_revision" ? "stale_revision" : "conflict",
          `${error.message}${switched ? ` (${switched})` : ""}`,
          error.kind === "stale_revision"
            ? { revision: workspace.draft.updatedAt }
            : undefined,
        );
      }
      if (error instanceof Error && /unable to find/iu.test(error.message)) {
        throw new AssistantToolError("invalid_input", error.message);
      }
      throw error;
    }
    const parts = [];
    let receiptId: string | null = null;
    for (const change of result.changes) {
      const recorded = await session.recordChange({
        target: change.target,
        targetId: change.targetId,
        summary: input.summary,
        entries: change.entries,
      });
      parts.push(recorded.part);
      receiptId = recorded.receipt.id;
    }
    ports.publishWorkspaceUpdate();
    return {
      summary: `Saved. ${describeSavedResumeChanges(result.changes)}.${switched ? ` ${switched}` : ""} New revision ${result.draftUpdatedAt}.`,
      data: { receiptId, revision: result.draftUpdatedAt },
      parts,
    };
  },
});

export const reviseResumeTool = defineTool({
  name: "revise_resume",
  group: "resume",
  description:
    "Hands a substantial rewrite to the resume revision specialist: tailor a section harder, cut to a page target, restructure. Give it an explicit brief with what the person asked. It returns checked, measured changes; mode apply commits them as one change with Undo, mode suggest leaves them for the person to accept.",
  parameters: json.object(
    {
      jobId: json.string(),
      brief: json.string("What to change and why, in full sentences."),
      mode: json.enumOf(["apply", "suggest"]),
    },
    ["jobId", "brief"],
  ),
  input: z.object({
    jobId: Id,
    brief: z.string().trim().min(1).max(4_000),
    mode: z.enum(["apply", "suggest"]).default("apply"),
  }),
  label: () => "Revising the resume",
  effect: "local_write",
  async execute(input, context) {
    const { service, session, ports } = context;
    const switched =
      input.mode === "apply"
        ? await ensureEditableJob(context, input.jobId)
        : null;
    const excerpt = (await session.searchConversation("", 6)).map((entry) => ({
      role: entry.role === "user" ? ("user" as const) : ("assistant" as const),
      content: entry.excerpt,
    }));
    const result = await service.runResumeRevisionSpecialist({
      jobId: input.jobId,
      brief: input.brief,
      recentExcerpt: excerpt,
    });
    if (result.patches.length === 0) {
      return {
        summary:
          `The specialist proposed no change. ${result.note} ${result.droppedNotes.join(" ")}`.trim(),
        status: "done",
      };
    }
    const blockers = result.approvalBlockers.map((blocker) => blocker.message);
    if (input.mode === "suggest") {
      const { proposal, part } = await session.createProposal({
        kind: "resume_patches",
        targetId: input.jobId,
        summary: input.brief.slice(0, 300),
        items: result.patches.map((patch, index) => ({
          id: `item_${index + 1}`,
          label: `${patch.operation.replaceAll("_", " ")}${patch.newText ? `: ${patch.newText.slice(0, 200)}` : ""}`,
          payload: patch,
        })),
        baseRevision: result.baseDraftUpdatedAt,
      });
      return {
        summary: `Suggested ${plural(result.patches.length, "change")}. ${result.note}`,
        data: { proposalId: proposal.id, approvalBlockers: blockers },
        parts: [part],
      };
    }
    session.assertCurrent();
    const applied = await service.applyAssistantResumeRevision({
      jobId: input.jobId,
      patches: result.patches,
      baseDraftUpdatedAt: result.baseDraftUpdatedAt,
      summary: input.brief.slice(0, 200),
    });
    const parts = [];
    let receiptId: string | null = null;
    for (const change of applied.changes) {
      const recorded = await session.recordChange({
        target: change.target,
        targetId: change.targetId,
        summary: input.brief.slice(0, 200),
        entries: change.entries,
      });
      parts.push(recorded.part);
      receiptId = recorded.receipt.id;
    }
    ports.publishWorkspaceUpdate();
    return {
      summary: `Saved. ${describeSavedResumeChanges(applied.changes)}. ${result.note}${switched ? ` ${switched}` : ""}`,
      data: {
        receiptId,
        revision: applied.draftUpdatedAt,
        linesNeedingTheirDecision: blockers,
      },
      parts,
    };
  },
});

export const setResumeLevelTool = defineTool({
  name: "set_resume_level",
  group: "resume",
  description:
    "Sets one job's resume level: original (send the imported file unchanged), light, tailored or aggressive.",
  parameters: json.object(
    {
      jobIds: json.ids(),
      level: json.enumOf(["original", "light", "tailored", "aggressive"]),
    },
    ["jobIds", "level"],
  ),
  input: z.object({
    jobIds: z.array(Id).min(1).max(50),
    level: z.enum(["original", "light", "tailored", "aggressive"]),
  }),
  label: (input) => `Setting the resume level to ${argText(input.level)}`,
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const tailoring =
      input.level === "light"
        ? TailoringModeSchema.enum.conservative
        : input.level === "tailored"
          ? TailoringModeSchema.enum.balanced
          : input.level === "aggressive"
            ? TailoringModeSchema.enum.aggressive
            : null;
    for (const jobId of input.jobIds) {
      session.assertCurrent();
      await service.setJobResumeApplicationMode(
        jobId,
        input.level === "original" ? "original_resume" : "tailored_per_job",
        tailoring,
      );
    }
    ports.publishWorkspaceUpdate();
    return {
      summary: `Set ${plural(input.jobIds.length, "job")} to ${input.level}.`,
    };
  },
});

export const generateResumesTool = defineTool({
  name: "generate_resumes",
  group: "resume",
  description:
    "Writes (or rewrites) the tailored resume for each job, two at a time, in the background. Jobs on Original are skipped. The conversation continues when all are done.",
  parameters: json.object(
    {
      jobIds: json.ids(),
      regenerate: json.boolean("Rewrite existing drafts from scratch."),
    },
    ["jobIds"],
  ),
  input: z.object({
    jobIds: z.array(Id).min(1).max(30),
    regenerate: z.boolean().default(false),
  }),
  label: (input) =>
    `Writing ${plural(Array.isArray(input.jobIds) ? input.jobIds.length : 1, "resume")}`,
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const runId = session.createId("resume_batch");
    session.assertCurrent();
    const jobIds = [...new Set(input.jobIds)];
    const queue = [...jobIds];
    const failures: string[] = [];
    const worker = async () => {
      while (queue.length > 0) {
        const jobId = queue.shift()!;
        if (session.signal.aborted) return;
        try {
          if (input.regenerate) await service.regenerateResumeDraft(jobId);
          else await service.generateResume(jobId);
        } catch (error) {
          failures.push(
            `${jobId}: ${error instanceof Error ? error.message.slice(0, 200) : "failed"}`,
          );
        } finally {
          ports.publishWorkspaceUpdate();
        }
      }
    };
    const batch = Promise.all([worker(), worker()]).then(() => failures);
    await session.watchRun(
      { kind: "resume_generation", id: runId, jobIds },
      `Writing resumes for ${plural(jobIds.length, "job")}`,
    );
    registerBackgroundBatch(runId, batch);
    return {
      summary: `Started writing ${plural(jobIds.length, "resume")} in the background (run ${runId}). This conversation continues when they are done.`,
      data: { runId, jobIds },
    };
  },
});

/** Resume batches the host checks for completion. */
const backgroundBatches = new Map<
  string,
  { done: boolean; failures: string[] }
>();

function registerBackgroundBatch(id: string, batch: Promise<string[]>) {
  const entry = { done: false, failures: [] as string[] };
  backgroundBatches.set(id, entry);
  void batch.then(
    (failures) => {
      entry.done = true;
      entry.failures = failures;
    },
    () => {
      entry.done = true;
    },
  );
}

export function readBackgroundBatch(id: string) {
  return backgroundBatches.get(id) ?? null;
}

export const previewResumeTool = defineTool({
  name: "preview_resume",
  group: "resume",
  description:
    "Renders the current draft the way the application PDF will look and reports the page count and any render warnings.",
  parameters: json.object({ jobId: json.string() }, ["jobId"]),
  input: z.object({ jobId: Id }),
  label: () => "Checking how the resume renders",
  effect: "read",
  async execute(input, { service }) {
    const workspace = await service.getResumeWorkspace(input.jobId);
    const preview = await service.previewResumeDraft(workspace.draft);
    return {
      summary: `The resume renders to ${preview.metadata.pageCount ?? "an unknown number of"} page(s) (target ${workspace.draft.targetPageCount}).`,
      data: {
        pageCount: preview.metadata.pageCount,
        targetPageCount: workspace.draft.targetPageCount,
        warnings: preview.warnings
          .slice(0, 10)
          .map((warning) => warning.message),
      },
    };
  },
});

export const exportResumeTool = defineTool({
  name: "export_resume",
  group: "resume",
  description:
    "Builds the application PDF from the current draft and, when approve is true, approves it for applications (lines waiting for the person block approval). Aggressive resumes need the person's own approval.",
  parameters: json.object({ jobId: json.string(), approve: json.boolean() }, [
    "jobId",
  ]),
  input: z.object({ jobId: Id, approve: z.boolean().default(false) }),
  label: (input) =>
    input.approve
      ? "Exporting and approving the resume"
      : "Exporting the resume",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    session.assertCurrent();
    try {
      await service.exportResumePdf(input.jobId, null);
    } catch (error) {
      if (
        error instanceof Error &&
        /still need your decision/iu.test(error.message)
      ) {
        throw new AssistantToolError(
          "missing_information",
          "Some lines in this resume still need the person's decision (Keep or Remove) before it can be exported.",
        );
      }
      throw error;
    }
    const workspace = await service.getResumeWorkspace(input.jobId);
    const latest = [...workspace.exports].sort((left, right) =>
      right.exportedAt.localeCompare(left.exportedAt),
    )[0];
    if (input.approve && latest) {
      if (workspace.effectiveTailoringStrength === "aggressive") {
        return {
          summary:
            "Exported. An Aggressive resume is approved by the person after reading it; it was not approved.",
          status: "refused",
          data: { exportId: latest.id },
        };
      }
      await service.approveResume(input.jobId, latest.id);
    }
    ports.publishWorkspaceUpdate();
    return {
      summary: `Exported${input.approve ? " and approved" : ""} the resume (${latest?.pageCount ?? "?"} pages).`,
      data: { exportId: latest?.id ?? null, route: RESUME_ROUTE(input.jobId) },
    };
  },
});

export const confirmResumeLineTool = defineTool({
  name: "confirm_resume_line",
  group: "resume",
  description:
    "Keeps one line under Lines to confirm with the person's ownership statement. Only when the person said to keep that exact line; to drop it, remove the bullet with edit_resume.",
  parameters: json.object(
    {
      jobId: json.string(),
      claimId: json.string("From read_resume linesToConfirm."),
    },
    ["jobId", "claimId"],
  ),
  input: z.object({ jobId: Id, claimId: Id }),
  label: () => "Keeping a line you confirmed",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const workspace = await service.getResumeWorkspace(input.jobId);
    const claim = workspace.validation?.claimAssessments.find(
      (assessment) => assessment.id === input.claimId,
    );
    if (claim?.status === "unsupported") {
      throw new AssistantToolError(
        "refused",
        "That line has no saved evidence behind it and cannot be kept as written. Rewrite or remove it with edit_resume, or add the fact to the profile first.",
      );
    }
    if (!claim || claim.status !== "confirm_needed") {
      throw new AssistantToolError(
        "not_found",
        "That line is not waiting for a decision.",
      );
    }
    session.assertCurrent();
    await service.setResumeClaimConfirmation({
      intent: "add",
      jobId: input.jobId,
      draftId: workspace.draft.id,
      expectedDraftUpdatedAt: workspace.draft.updatedAt,
      field: claim.field,
      sectionId: claim.sectionId,
      entryId: claim.entryId,
      bulletId: claim.bulletId,
      confirmedClaimContentHash: claim.contentHash as never,
      ownershipStatement: OWNERSHIP_STATEMENT,
    });
    ports.publishWorkspaceUpdate();
    return { summary: `Kept "${claim.claimText.slice(0, 120)}".` };
  },
});

export const setResumeTemplateTool = defineTool({
  name: "set_resume_template",
  group: "resume",
  description:
    "Changes the template or the page target of one job's resume. List templates with read_settings.",
  parameters: json.object(
    {
      jobId: json.string(),
      templateId: json.string(),
      targetPageCount: json.number("1 to 3."),
    },
    ["jobId"],
  ),
  input: z.object({
    jobId: Id,
    templateId: Id.optional(),
    targetPageCount: z.number().int().min(1).max(3).optional(),
  }),
  label: () => "Changing the resume layout",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const workspace = await service.getResumeWorkspace(input.jobId);
    session.assertCurrent();
    await service.saveResumeDraft({
      ...workspace.draft,
      ...(input.templateId
        ? { templateId: input.templateId as ResumeDraft["templateId"] }
        : {}),
      ...(input.targetPageCount
        ? { targetPageCount: input.targetPageCount }
        : {}),
    });
    ports.publishWorkspaceUpdate();
    const after = await service.getResumeWorkspace(input.jobId);
    const wasApproved = workspace.draft.status === "approved";
    const approvalCleared = wasApproved && after.draft.status !== "approved";
    return {
      summary: approvalCleared
        ? "Updated the resume layout. This cleared the resume's approval: it must be approved again before it is used for another application. Applications already sent keep the version they sent. Say this in your reply."
        : "Updated the resume layout.",
      data: { approved: after.draft.status === "approved", approvalCleared },
    };
  },
});

export const restoreResumeVersionTool = defineTool({
  name: "restore_resume_version",
  group: "resume",
  description:
    "Restores an earlier version of one job's resume from its history (read_resume lists no history; use the revision ids the person points at in Version history).",
  parameters: json.object({ jobId: json.string(), revisionId: json.string() }, [
    "jobId",
    "revisionId",
  ]),
  input: z.object({ jobId: Id, revisionId: Id }),
  label: () => "Restoring an earlier resume version",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    session.assertCurrent();
    await service.restoreResumeDraftRevision(input.jobId, input.revisionId);
    ports.publishWorkspaceUpdate();
    return { summary: "Restored that version." };
  },
});

export const resumeTools = [
  readResumeTool,
  editResumeTool,
  reviseResumeTool,
  setResumeLevelTool,
  generateResumesTool,
  previewResumeTool,
  exportResumeTool,
  confirmResumeLineTool,
  setResumeTemplateTool,
  restoreResumeVersionTool,
];
