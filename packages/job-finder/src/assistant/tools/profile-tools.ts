import {
  NonEmptyStringSchema,
  ProfileCopilotPatchOperationSchema,
  ProfileSetupReviewActionSchema,
  type AssistantChangeEntry,
  type AssistantChangeReceipt,
  type AssistantChangeTarget,
  type AssistantMessagePart,
  type CandidateProfile,
  type JobSearchPreferences,
  type ProfileCopilotPatchOperation,
} from "@nordri/contracts";
import { findBulletsOnTwoCards } from "@nordri/ai-providers";
import { z } from "zod";

import {
  AssistantToolError,
  defineTool,
  argText,
  describeZodIssues,
  json,
  type AssistantToolContext,
} from "../tool-kit";
import { plainFieldName } from "../prompt";
import { plural } from "./format";

const Id = NonEmptyStringSchema.max(200);

/**
 * The long editing rules from the old Profile chat, returned with the first
 * profile read in a conversation instead of sitting in every system prompt.
 */
export const PROFILE_EDITING_RULES = [
  "Profile edits are typed operations sent with edit_profile. Each operation names its kind: replace_identity_fields, replace_professional_summary_fields, replace_work_eligibility_fields, replace_profile_list_fields, remove_profile_list_entries, replace_search_preferences_fields, replace_compensation_preferences_fields, set_resume_approach, upsert_/remove_ experience, education, certification, project, link, language records, upsert_/remove_ proof_point and reusable_answer, reorder_education_records, resolve_review_items.",
  "An update to an existing card (experience, education, certification, link, project, language) carries that card's id from read_profile; an upsert without an id creates a new card. Include only the fields that change.",
  "To end a role, update its card with isCurrent false and endDate YYYY-MM. To fix a date, change only the date fields.",
  "To merge two roles, update the card you keep with the combined dates and every bullet from both, then remove the other card by id, in one edit_profile call.",
  "To split one role in two, update the existing card to the earlier title and dates and add one new card for the later one; each bullet ends up on exactly one card.",
  "To reorder skills, target roles or locations send the whole list in the new order with replace_profile_list_fields; to take entries out use remove_profile_list_entries with the exact entries.",
  "The professional summary shown in Basics is replace_professional_summary_fields with fullSummary. Headline, contact details and location are replace_identity_fields.",
  "Work eligibility (countries, sponsorship, remote eligibility, relocation, notice period) is replace_work_eligibility_fields; record only what the person said or the resume states.",
  "The resume level for jobs shortlisted from now on is set_resume_approach: original_resume, conservative (Light), balanced (Tailored) or aggressive.",
  "Never invent experience, credentials, dates, pay currency or metrics.",
  'Exact shapes (value is always an object of the fields that change, never an array): {"operation":"replace_identity_fields","value":{"headline":"Staff designer"}}; {"operation":"replace_profile_list_fields","value":{"skills":["Figma","Accessibility"]}} (send the whole new list); {"operation":"replace_profile_list_fields","value":{"targetRoles":["Frontend Engineer","Platform Engineer"]}}; {"operation":"remove_profile_list_entries","field":"skills","values":["Sketch"]}; {"operation":"replace_work_eligibility_fields","value":{"requiresVisaSponsorship":false}}; {"operation":"replace_professional_summary_fields","value":{"fullSummary":"…"}}; {"operation":"upsert_experience_record","record":{"id":"<card id>","endDate":"2024-06","isCurrent":false}}; {"operation":"remove_experience_record","recordId":"<card id>"}.',
].join(" ");

const SECTIONS = [
  "basics",
  "experience",
  "background",
  "preferences",
  "review",
  "all",
] as const;

function basics(profile: CandidateProfile) {
  return {
    fullName: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    headline: profile.headline,
    summary: profile.professionalSummary.fullSummary ?? profile.summary,
    shortValueProposition: profile.professionalSummary.shortValueProposition,
    email: profile.email,
    phone: profile.phone,
    currentLocation: profile.currentLocation,
    timeZone: profile.timeZone,
    yearsExperience: profile.yearsExperience,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    personalWebsiteUrl: profile.personalWebsiteUrl,
    skills: profile.skills,
    skillGroups: profile.skillGroups,
    targetRoles: profile.targetRoles,
    locations: profile.locations,
    workEligibility: profile.workEligibility,
  };
}

function experience(profile: CandidateProfile) {
  return {
    experiences: profile.experiences.map((entry) => ({
      id: entry.id,
      title: entry.title,
      companyName: entry.companyName,
      location: entry.location,
      startDate: entry.startDate,
      endDate: entry.endDate,
      isCurrent: entry.isCurrent,
      summary: entry.summary,
      achievements: entry.achievements,
      skills: entry.skills,
    })),
    education: profile.education,
    certifications: profile.certifications,
  };
}

function background(profile: CandidateProfile) {
  return {
    projects: profile.projects,
    links: profile.links,
    spokenLanguages: profile.spokenLanguages,
    proofBank: profile.proofBank,
    narrative: profile.narrative,
    answerBank: {
      ...profile.answerBank,
      customAnswers: profile.answerBank.customAnswers,
    },
    applicationIdentity: profile.applicationIdentity,
  };
}

function preferences(searchPreferences: JobSearchPreferences) {
  return {
    targetRoles: searchPreferences.targetRoles,
    jobFamilies: searchPreferences.jobFamilies,
    locations: searchPreferences.locations,
    excludedLocations: searchPreferences.excludedLocations,
    workModes: searchPreferences.workModes,
    seniorityLevels: searchPreferences.seniorityLevels,
    employmentTypes: searchPreferences.employmentTypes,
    targetIndustries: searchPreferences.targetIndustries,
    targetCompanyStages: searchPreferences.targetCompanyStages,
    companyBlacklist: searchPreferences.companyBlacklist,
    companyWhitelist: searchPreferences.companyWhitelist,
    compensation: searchPreferences.compensation,
    tailoringMode: searchPreferences.tailoringMode,
  };
}

export const readProfileTool = defineTool({
  name: "read_profile",
  group: "profile",
  description:
    "Reads the saved profile by section, with record ids for editing: basics (name, headline, summary, contact, skills, target roles, eligibility), experience (work history, education, certifications), background (projects, links, languages, proof points, saved answers), preferences (what to search for, pay, resume level), review (import suggestions waiting), or all.",
  parameters: json.object({ section: json.enumOf(SECTIONS) }),
  input: z.object({ section: z.enum(SECTIONS).default("all") }),
  label: (input) =>
    input.section && input.section !== "all"
      ? `Reading your profile (${argText(input.section)})`
      : "Reading your profile",
  effect: "read",
  async execute(input, { service, session }) {
    const snapshot = await service.getWorkspaceSnapshot();
    const { profile, searchPreferences } = snapshot;
    const pendingReview = snapshot.profileSetupState.reviewItems.filter(
      (item) => item.status === "pending",
    );
    const data: Record<string, unknown> = {};
    if (input.section === "basics" || input.section === "all")
      data.basics = basics(profile);
    if (input.section === "experience" || input.section === "all")
      data.experience = experience(profile);
    if (input.section === "background" || input.section === "all")
      data.background = background(profile);
    if (input.section === "preferences" || input.section === "all") {
      data.preferences = preferences(searchPreferences);
      data.resumeApproach =
        snapshot.settings.resumeApplicationMode === "original_resume"
          ? "original_resume"
          : searchPreferences.tailoringMode;
    }
    if (input.section === "review" || input.section === "all") {
      data.reviewItems = pendingReview.slice(0, 30).map((item) => ({
        id: item.id,
        label: item.label,
        reason: item.reason,
        proposedValue: item.proposedValue,
        step: item.step,
      }));
    }
    const editor = session.context?.editor;
    if (editor?.editor === "profile" && editor.dirtyFields.length > 0) {
      data.unsavedInEditor = {
        fields: editor.dirtyFields,
        values: editor.unsavedValues,
        note: "The person has edited these fields on screen without saving. Treat the on-screen values as what they see; do not overwrite these fields unless they ask you to.",
      };
    }
    if (await session.firstProfileRead()) {
      data.editingRules = PROFILE_EDITING_RULES;
    }
    return {
      summary: `Profile for ${profile.fullName || "the person"}: ${plural(profile.experiences.length, "role")}, ${plural(profile.skills.length, "skill")}, ${plural(pendingReview.length, "import suggestion")} waiting.`,
      data,
    };
  },
});

/** Top-level profile fields an operation writes, in the editor's field names. */
export function fieldsTouchedByOperation(
  operation: ProfileCopilotPatchOperation,
): string[] {
  switch (operation.operation) {
    case "replace_identity_fields":
      return Object.keys(operation.value).flatMap((key) =>
        key === "summary" ? ["summary", "professionalSummary"] : [key],
      );
    case "replace_work_eligibility_fields":
      return ["workEligibility"];
    case "replace_professional_summary_fields":
      return ["professionalSummary", "summary"];
    case "replace_narrative_fields":
      return ["narrative"];
    case "replace_answer_bank_fields":
    case "upsert_reusable_answer":
    case "remove_reusable_answer":
      return ["answerBank"];
    case "replace_application_identity_fields":
      return ["applicationIdentity"];
    case "replace_skill_group_fields":
      return ["skillGroups"];
    case "replace_profile_list_fields":
      return Object.keys(operation.value);
    case "remove_profile_list_entries":
      return [operation.field];
    case "replace_search_preferences_fields":
      return Object.keys(operation.value);
    case "replace_compensation_preferences_fields":
      return ["compensation"];
    case "set_resume_approach":
      return ["tailoringMode"];
    case "upsert_experience_record":
    case "remove_experience_record":
      return ["experiences"];
    case "upsert_education_record":
    case "remove_education_record":
    case "reorder_education_records":
      return ["education"];
    case "upsert_certification_record":
    case "remove_certification_record":
      return ["certifications"];
    case "upsert_project_record":
    case "remove_project_record":
      return ["projects"];
    case "upsert_link_record":
    case "remove_link_record":
      return ["links"];
    case "upsert_language_record":
    case "remove_language_record":
      return ["spokenLanguages"];
    case "upsert_proof_point":
    case "remove_proof_point":
      return ["proofBank"];
    case "resolve_review_items":
      return [];
  }
}

function parseOperations(
  raw: readonly unknown[],
  profile: CandidateProfile,
): ProfileCopilotPatchOperation[] {
  const operations: ProfileCopilotPatchOperation[] = [];
  const problems: string[] = [];
  raw.forEach((entry, index) => {
    const parsed = ProfileCopilotPatchOperationSchema.safeParse(entry);
    if (parsed.success) operations.push(parsed.data);
    else
      problems.push(`operations[${index}]: ${describeZodIssues(parsed.error)}`);
  });
  if (problems.length > 0) {
    throw new AssistantToolError("invalid_input", problems.join(" | "));
  }
  const bulletIssues = findBulletsOnTwoCards(profile, [
    {
      id: "assistant_check",
      summary: "check",
      applyMode: "needs_review",
      operations,
      createdAt: new Date(0).toISOString(),
    },
  ]);
  if (bulletIssues.length > 0) {
    throw new AssistantToolError(
      "invalid_input",
      bulletIssues.map((issue) => issue.message).join(" "),
    );
  }
  return operations;
}

function describeOperation(operation: ProfileCopilotPatchOperation): string {
  const fields = fieldsTouchedByOperation(operation);
  return `${operation.operation.replaceAll("_", " ")}${fields.length ? ` (${fields.join(", ")})` : ""}`;
}

async function recordEditChanges(
  context: AssistantToolContext,
  changes: readonly {
    target: AssistantChangeTarget;
    targetId: string | null;
    entries: AssistantChangeEntry[];
  }[],
  summary: string,
): Promise<{
  parts: AssistantMessagePart[];
  receiptIds: string[];
  fields: string[];
}> {
  const parts: AssistantMessagePart[] = [];
  const receiptIds: string[] = [];
  const fields: string[] = [];
  // One receipt for the whole request: profile, preference and settings
  // halves undo together, the way the person asked for them.
  const entries = changes.flatMap((change) =>
    change.entries.map((entry) => ({
      ...entry,
      path: [change.target, ...entry.path],
    })),
  );
  if (entries.length === 0) return { parts, receiptIds, fields };
  const recorded = await context.session.recordChange({
    target: changes[0]!.target,
    targetId: changes[0]!.targetId,
    summary,
    entries,
  });
  parts.push(recorded.part);
  receiptIds.push(recorded.receipt.id);
  fields.push(...recorded.receipt.fieldLabels);
  return { parts, receiptIds, fields };
}

export const editProfileTool = defineTool({
  name: "edit_profile",
  group: "profile",
  description:
    "Changes the saved profile or search preferences with typed operations (see the editing rules returned by read_profile). mode apply commits at once with a per-change Undo, for what the person asked you to change; mode suggest leaves the changes as a proposal the person accepts or rejects, for improvements they did not ask for. Returns the exact fields changed.",
  parameters: json.object(
    {
      summary: json.string("What this change does, in a few plain words."),
      operations: json.array(
        json.looseObject(
          "One typed operation: {operation, value|record|recordId|field+values|orderedRecordIds|reviewItemIds+resolutionStatus}.",
        ),
      ),
      mode: json.enumOf(["apply", "suggest"]),
    },
    ["summary", "operations"],
  ),
  input: z.object({
    summary: z.string().trim().min(1).max(300),
    operations: z.array(z.unknown()).min(1).max(40),
    mode: z.enum(["apply", "suggest"]).default("apply"),
  }),
  label: (input) =>
    input.mode === "suggest"
      ? "Preparing suggested profile changes"
      : `Updating your profile: ${argText(input.summary).slice(0, 80)}`,
  effect: "local_write",
  async execute(input, context) {
    const { service, session } = context;
    const snapshot = await service.getWorkspaceSnapshot();
    const operations = parseOperations(input.operations, snapshot.profile);

    const editor = session.context?.editor;
    if (editor?.editor === "profile" && editor.dirtyFields.length > 0) {
      const dirtyTop = new Set(
        editor.dirtyFields.map((field) => field.split(/[.[]/u)[0] ?? field),
      );
      const clashes = [
        ...new Set(operations.flatMap(fieldsTouchedByOperation)),
      ].filter((field) => dirtyTop.has(field));
      if (clashes.length > 0 && input.mode === "apply") {
        throw new AssistantToolError(
          "conflict",
          `The person has unsaved edits on screen in ${clashes.map(plainFieldName).join(", ")}. Ask whether to replace them or leave those fields out.`,
          { unsavedFields: clashes, unsavedValues: editor.unsavedValues },
        );
      }
    }

    if (input.mode === "suggest") {
      const { proposal, part } = await session.createProposal({
        kind: "profile_operations",
        targetId: null,
        summary: input.summary,
        items: operations.map((operation, index) => ({
          id: `item_${index + 1}`,
          label: describeOperation(operation),
          payload: operation,
        })),
        baseRevision: snapshot.generatedAt,
      });
      return {
        summary: `Suggested ${plural(operations.length, "change")}; nothing changes until the person accepts.`,
        data: { proposalId: proposal.id },
        parts: [part],
      };
    }

    session.assertCurrent();
    const result = await service.applyAssistantProfileOperations({
      operations,
      summary: input.summary,
      messageId: session.sourceMessage?.id ?? null,
    });
    const recorded = await recordEditChanges(
      context,
      result.changes,
      input.summary,
    );
    context.ports.publishWorkspaceUpdate();
    if (recorded.receiptIds.length === 0) {
      return {
        summary: "Nothing changed: the profile already says that.",
        status: "done",
      };
    }
    return {
      summary: `Saved: ${input.summary}. Changed ${recorded.fields.join(", ")}.`,
      data: {
        receiptId: recorded.receiptIds[0],
        changedFields: recorded.fields,
      },
      parts: recorded.parts,
    };
  },
});

export const undoChangeTool = defineTool({
  name: "undo_change",
  group: "profile",
  description:
    "Undoes one earlier assistant change by its receipt id (from a change you made, or 'undo that'). Later edits by the person or by you are kept; fields changed again since are named and left alone.",
  parameters: json.object({ receiptId: json.string() }, ["receiptId"]),
  input: z.object({ receiptId: Id }),
  label: () => "Undoing a change",
  effect: "local_write",
  async execute(input, context) {
    const receipt = await context.session.getReceipt(input.receiptId);
    if (!receipt) {
      throw new AssistantToolError(
        "not_found",
        "No change with that receipt id in this conversation.",
      );
    }
    context.session.assertCurrent();
    const outcome = await undoReceipt(context, receipt.id);
    return {
      summary: outcome.message,
      data: { status: outcome.receipt.status },
    };
  },
});

/**
 * Undo of one receipt, shared by the tool and the Undo button. Profile,
 * preference and settings entries are routed to their own stores.
 */
export async function undoReceipt(
  context: Pick<AssistantToolContext, "service" | "session" | "ports">,
  receiptId: string,
): Promise<{
  receipt: AssistantChangeReceipt;
  message: string;
}> {
  const { service, session } = context;
  const receipt = await session.getReceipt(receiptId);
  if (!receipt)
    throw new AssistantToolError("not_found", "That change is gone.");
  if (receipt.status === "undone") {
    return { receipt, message: "That change was already undone." };
  }
  const strip = (target: string) =>
    receipt.entries
      .filter((entry) => entry.path[0] === target)
      .map((entry) => ({ ...entry, path: entry.path.slice(1) }));
  let undone: string[] = [];
  let conflicts: string[] = [];
  if (receipt.target === "resume_draft") {
    const result = await service.undoAssistantResumeChange({
      jobId: receipt.targetId ?? "",
      entries: receipt.entries,
      reason: `Undid assistant change: ${receipt.summary}`,
    });
    undone = result.undoneLabels;
    conflicts = result.conflictLabels;
  } else {
    const profileEntries = strip("profile");
    const preferenceEntries = strip("search_preferences");
    const settingsEntries = strip("settings");
    if (profileEntries.length > 0 || preferenceEntries.length > 0) {
      const result = await service.undoAssistantProfileChange({
        profileEntries,
        searchPreferencesEntries: preferenceEntries,
        reason: `Undid assistant change: ${receipt.summary}`,
      });
      undone.push(...result.undoneLabels);
      conflicts.push(...result.conflictLabels);
    }
    if (settingsEntries.length > 0) {
      const result = await service.undoAssistantSettingsChange({
        entries: settingsEntries,
      });
      undone.push(...result.undoneLabels);
      conflicts.push(...result.conflictLabels);
    }
  }
  const status =
    conflicts.length === 0
      ? ("undone" as const)
      : undone.length === 0
        ? receipt.status
        : ("partially_undone" as const);
  const next = {
    ...receipt,
    status,
    undoneAt: status === "applied" ? receipt.undoneAt : session.now(),
    undoConflicts: [...new Set(conflicts)].slice(0, 60),
  };
  await session.saveReceipt(next);
  context.ports.publishWorkspaceUpdate();
  const conflictText =
    conflicts.length > 0
      ? ` ${[...new Set(conflicts)].join(", ")} ${conflicts.length === 1 ? "was" : "were"} changed again since, so ${conflicts.length === 1 ? "it was" : "they were"} left as ${conflicts.length === 1 ? "it is" : "they are"}.`
      : "";
  const message =
    undone.length > 0
      ? `Undid "${receipt.summary}".${conflictText}`
      : `Nothing was undone.${conflictText}`;
  return { receipt: next, message };
}

export const reviewImportSuggestionsTool = defineTool({
  name: "resolve_import_suggestion",
  group: "profile",
  description:
    "Acts on one suggestion left by a resume import (from read_profile section review): confirm keeps the proposed value, dismiss drops it, clear_value empties the field.",
  parameters: json.object(
    {
      reviewItemId: json.string(),
      action: json.enumOf(["confirm", "dismiss", "clear_value"]),
    },
    ["reviewItemId", "action"],
  ),
  input: z.object({
    reviewItemId: Id,
    action: ProfileSetupReviewActionSchema,
  }),
  label: () => "Resolving an import suggestion",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    session.assertCurrent();
    await service.applyProfileSetupReviewAction(
      input.reviewItemId,
      input.action,
    );
    ports.publishWorkspaceUpdate();
    return {
      summary: `Suggestion ${input.action === "confirm" ? "kept" : input.action === "dismiss" ? "dismissed" : "cleared"}.`,
    };
  },
});

export const listDocumentsTool = defineTool({
  name: "list_documents",
  group: "files",
  description:
    "Lists the person's files (resumes, cover letters, portfolios, transcripts) with ids. Refer to files only by these ids, never by path. Files the person attached in this chat or added under Documents are used by applications: when Job Finder fills a form, it uploads the matching file (portfolio, transcript, cover letter, other) to that form's file field, so no extra step is needed to use them.",
  parameters: json.object({}),
  input: z.object({}).passthrough(),
  label: () => "Listing your files",
  effect: "read",
  async execute(_input, { ports }) {
    const documents = await ports.listDocuments();
    return {
      summary: `${plural(documents.length, "file")}. Applications upload the matching one to a form's file field (portfolio, transcript, cover letter), so these can be used for an application without any other step.`,
      data: documents.slice(0, 60).map((document) => ({
        id: document.id,
        kind: document.kind,
        name: document.originalName,
        bytes: document.byteSize,
        addedAt: document.createdAt,
      })),
    };
  },
});

export const readDocumentTool = defineTool({
  name: "read_document",
  group: "files",
  description: "Reads the text of one of the person's files by id (bounded).",
  parameters: json.object({ documentId: json.string() }, ["documentId"]),
  input: z.object({ documentId: Id }),
  label: () => "Reading a file",
  effect: "read",
  async execute(input, { ports }) {
    const text = await ports.readDocumentText(input.documentId);
    if (text === null) {
      throw new AssistantToolError(
        "not_found",
        "That file has no readable text.",
      );
    }
    return {
      summary: `Read ${text.length} characters.`,
      data: { text: text.slice(0, 12_000), truncated: text.length > 12_000 },
    };
  },
});

export const importResumeTool = defineTool({
  name: "import_resume",
  group: "files",
  description:
    "Imports one of the person's files (by id, usually one they just attached) as their resume: its details fill the profile, with suggestions left for review. Only when the person asks to use the file for their profile.",
  parameters: json.object({ documentId: json.string() }, ["documentId"]),
  input: z.object({ documentId: Id }),
  label: () => "Importing the resume into your profile",
  effect: "local_write",
  async execute(input, { ports, session }) {
    session.assertCurrent();
    await ports.importResumeDocument(input.documentId);
    ports.publishWorkspaceUpdate();
    return {
      summary:
        "The resume was imported. Read the profile to see what changed and the suggestions left for review.",
    };
  },
});

export const profileTools = [
  readProfileTool,
  editProfileTool,
  undoChangeTool,
  reviewImportSuggestionsTool,
];

export const fileTools = [
  listDocumentsTool,
  readDocumentTool,
  importResumeTool,
];
