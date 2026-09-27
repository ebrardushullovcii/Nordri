import {
  AgentTaskNonRetryableProviderError,
  runAgentTask,
  type AgentTaskModel,
} from "@unemployed/agent-runtime";
import {
  ProfileCopilotPatchGroupSchema,
  ProfileCopilotPatchOperationSchema,
  ProfileCompensationPreferencePatchFieldsSchema,
  ProfileCoreListPatchFieldsSchema,
  ProfileIdentityPatchFieldsSchema,
  ProfileProfessionalSummaryPatchFieldsSchema,
  ProfileSearchPreferencesPatchFieldsSchema,
  ProfileWorkEligibilityPatchFieldsSchema,
  ProfileCopilotReplySchema,
  ResumeDraftPatchSchema,
  ResumeImportFieldCandidateDraftSchema,
  type AgentTaskValidationIssue,
  type CandidateProfile,
  type ProfileCopilotPatchGroup,
  type ProfileCopilotPatchOperation,
  type ProfileCopilotReply,
  type ResumeDraftPatch,
  type ResumeImportFieldCandidateDraft,
  type ToolCall,
} from "@unemployed/contracts";
import { z } from "zod";
import { buildResumeImportStageInstructions } from "./openai-compatible-resume-import";

import {
  ResumeAssistantReplySchema,
  TailoredResumeDraftSchema,
  type AgentCapableJobFinderAiClient,
  type ResumeAssistantReply,
  type CreateResumeDraftInput,
  type ReviseCandidateProfileInput,
  type ReviseResumeDraftInput,
  type ResumeProposalCheckResult,
  type TailoredResumeDraft,
  type ExtractResumeImportStageTransportInput,
  describeProfileAssistantBehavior,
  PROFILE_RESUME_APPROACH_VOCABULARY,
} from "./shared";
import { completeTailoredResumeDraft } from "./openai-compatible-shared";
import {
  buildGroundedResumeRewriteModelPayload,
  describeAggressiveResumeEditPolicy,
} from "./resume-generation-grounding";
import { compactOpenAiCompatibleUserPayload } from "./openai-compatible-request-compaction";
import { modelConversationKeys } from "./model-request-identity";
import {
  ResumeImportStageExtractionResultSchema,
  sanitizeStageCandidates,
  type ResumeImportStageExtractionResult,
} from "./resume-import";

const EmptyInputSchema = z.object({});
const ContentInputSchema = z.object({ content: z.string().trim().min(1) });
const ResumePatchInputSchema = z.object({ patch: ResumeDraftPatchSchema });
const ResumeSectionTextInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  newText: z.string().trim().min(1),
});
const ResumeBulletTextInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  entryId: z.string().trim().min(1).nullish(),
  bulletId: z.string().trim().min(1),
  newText: z.string().trim().min(1),
});
const ResumeBulletIncludedInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  bulletId: z.string().trim().min(1),
  included: z.boolean(),
});
const ResumeGenerationProposalInputSchema = z.object({
  proposal: z.record(z.string(), z.unknown()),
  reasonForRevision: z.string().trim().min(1).optional(),
});
const ResumeImportCandidateSetInputSchema = z.object({
  candidates: z.array(ResumeImportFieldCandidateDraftSchema),
  notes: z.array(z.string().trim().min(1)).default([]),
});

const resumeImportTargetSectionsByStage = {
  identity_summary: ["identity", "contact", "location", "search_preferences"],
  experience: ["experience"],
  background: [
    "education",
    "certification",
    "link",
    "project",
    "language",
    "skill",
  ],
  shared_memory: [
    "narrative",
    "proof_point",
    "answer_bank",
    "application_identity",
  ],
} as const;

/**
 * What each patch operation must carry to be appliable. The patch schema
 * leaves the target ids nullable because different operations need different
 * ones; a model that omits the bullet id used to sail through the schema and
 * fail at apply time with a message the user saw verbatim. Rejecting it here
 * hands the model an exact repair instead.
 */
function describeMissingPatchFields(patch: ResumeDraftPatch): string | null {
  const needs = (fields: Array<keyof ResumeDraftPatch>): string | null => {
    const missing = fields.filter((field) => {
      const value = patch[field];
      return value === null || value === undefined || value === "";
    });
    return missing.length > 0
      ? `Invalid patch: ${patch.operation} requires ${missing.join(", ")}. Read the draft with read_resume_context to find the exact ids.`
      : null;
  };
  switch (patch.operation) {
    case "update_bullet":
      return needs(["targetBulletId", "newText"]);
    case "insert_bullet":
      return needs(["newText"]);
    case "remove_bullet":
    case "move_bullet":
      return needs(["targetBulletId"]);
    case "replace_entry_summary":
      return needs(["targetEntryId", "newText"]);
    case "replace_section_text":
      return needs(["newText"]);
    default:
      return null;
  }
}

function profileOperationInputSchema<T extends z.ZodTypeAny>(fields: T) {
  return z.object({
    summary: z.string().trim().min(1),
    fields,
  });
}

const IdentityFieldsInputSchema = profileOperationInputSchema(
  ProfileIdentityPatchFieldsSchema,
);
const ProfessionalSummaryFieldsInputSchema = profileOperationInputSchema(
  ProfileProfessionalSummaryPatchFieldsSchema,
);
const ProfileListFieldsInputSchema = profileOperationInputSchema(
  ProfileCoreListPatchFieldsSchema,
);
const SearchPreferenceFieldsInputSchema = profileOperationInputSchema(
  ProfileSearchPreferencesPatchFieldsSchema,
);
const CompensationFieldsInputSchema = profileOperationInputSchema(
  ProfileCompensationPreferencePatchFieldsSchema,
);
const WorkEligibilityFieldsInputSchema = profileOperationInputSchema(
  ProfileWorkEligibilityPatchFieldsSchema,
);
const ResumeApproachInputSchema = z.object({
  summary: z.string().trim().min(1),
  approach: z.enum([
    "original_resume",
    "conservative",
    "balanced",
    "aggressive",
  ]),
});
const ProfileOperationsInputSchema = z
  .object({
    summary: z.string().trim().min(1),
    operations: z.array(ProfileCopilotPatchOperationSchema).min(1),
  })
  .superRefine((value, context) => {
    for (const [index, operation] of value.operations.entries()) {
      let hasCreationIdentity = true;
      switch (operation.operation) {
        case "upsert_experience_record":
          // A new role needs both: an update sent without its card id and
          // with only a title used to become a second, employer-less card
          // (splitting "Acme" left the old card untouched and a stray
          // "Backend Engineer" beside it).
          hasCreationIdentity = Boolean(
            operation.record.title && operation.record.companyName,
          );
          break;
        case "upsert_education_record":
          hasCreationIdentity = Boolean(
            operation.record.schoolName || operation.record.degree,
          );
          break;
        case "upsert_certification_record":
          hasCreationIdentity = Boolean(operation.record.name);
          break;
        case "upsert_link_record":
          hasCreationIdentity = Boolean(
            operation.record.label || operation.record.url,
          );
          break;
        default:
          continue;
      }
      if (operation.record.id === null && !hasCreationIdentity) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations", index, "record", "id"],
          message:
            operation.operation === "upsert_experience_record"
              ? "An update to an existing work-history card must include that card's id from read_profile_context. A new work-history card must include both companyName and title (use 'Self-employed' when the person worked for themselves)."
              : "An update to an existing card must include that card's id. A new card must include identifying details.",
        });
      }
    }
  });

function jsonObject(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function createModelAdapter(
  client: AgentCapableJobFinderAiClient,
  conversationKey?: string,
  options?: {
    contentToToolCalls?: (content: string) => ToolCall[] | null;
    preventRuntimeRetries?: boolean;
  },
): AgentTaskModel {
  const status = client.getStatus();
  return {
    model: status.model,
    reasoningEffort: null,
    async chat(input) {
      try {
        const response = await client.chatWithTools(
          input.messages.map((message) => {
            if (message.role === "tool") {
              return {
                role: "tool" as const,
                toolCallId: message.toolCallId ?? "missing_tool_call_id",
                content: message.content,
              };
            }
            if (message.role === "assistant") {
              return {
                role: "assistant" as const,
                content: message.content,
                ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
              };
            }
            return { role: message.role, content: message.content };
          }),
          [...input.tools],
          {
            ...(input.signal ? { signal: input.signal } : {}),
            ...(conversationKey ? { conversationKey } : {}),
          },
        );
        if (
          (!response.toolCalls || response.toolCalls.length === 0) &&
          response.content &&
          options?.contentToToolCalls
        ) {
          const toolCalls = options.contentToToolCalls(response.content);
          if (toolCalls) return { ...response, toolCalls };
        }
        return response;
      } catch (error) {
        if (!options?.preventRuntimeRetries) throw error;
        throw new AgentTaskNonRetryableProviderError(
          error instanceof Error ? error.message : "Provider request failed",
          { cause: error },
        );
      }
    },
  };
}

function zodIssues(error: z.ZodError): AgentTaskValidationIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path,
  }));
}

function normalizeBulletText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.;:!]+$/, "");
}

/**
 * A split that gives the new card the old card's bullets while the old card
 * keeps them shows every bullet twice. A bullet belongs to exactly one card,
 * so a proposal that would put it on a new card and leave it on an existing
 * one goes back to the model to repair, naming the card to update.
 */
export function findBulletsOnTwoCards(
  profile: CandidateProfile,
  patchGroups: readonly ProfileCopilotPatchGroup[],
): AgentTaskValidationIssue[] {
  const issues: AgentTaskValidationIssue[] = [];
  patchGroups.forEach((group, groupIndex) => {
    const upserts = group.operations.flatMap((operation, operationIndex) =>
      operation.operation === "upsert_experience_record"
        ? [{ record: operation.record, operationIndex }]
        : [],
    );
    const existingIds = new Set(profile.experiences.map((entry) => entry.id));
    const newCards = upserts.filter(
      ({ record }) => !record.id || !existingIds.has(record.id),
    );
    if (newCards.length === 0) {
      return;
    }
    const removedIds = new Set(
      group.operations.flatMap((operation) =>
        operation.operation === "remove_experience_record"
          ? [operation.recordId]
          : [],
      ),
    );
    const keptCards = profile.experiences
      .filter((entry) => !removedIds.has(entry.id))
      .map((entry) => {
        const update = upserts.find(({ record }) => record.id === entry.id);
        const achievements = Array.isArray(update?.record.achievements)
          ? update.record.achievements
          : entry.achievements;
        const title = update?.record.title ?? entry.title;
        const companyName = update?.record.companyName ?? entry.companyName;
        return {
          id: entry.id,
          label: [title, companyName].filter(Boolean).join(" at "),
          bullets: new Set(achievements.map(normalizeBulletText)),
        };
      });
    for (const { record, operationIndex } of newCards) {
      for (const bullet of record.achievements ?? []) {
        const card = keptCards.find((candidate) =>
          candidate.bullets.has(normalizeBulletText(bullet)),
        );
        if (!card) {
          continue;
        }
        issues.push({
          code: "bullet_on_two_cards",
          message: `"${bullet}" would be on the new card and also stay on ${card.label} (${card.id}). A bullet belongs to exactly one card: in this same proposal, update ${card.id} with its achievements minus the bullets that move to the new card.`,
          path: [
            "patchGroups",
            groupIndex,
            "operations",
            operationIndex,
            "record",
            "achievements",
          ],
        });
      }
    }
  });
  return issues;
}

/**
 * Gives resume generation a bounded working loop instead of treating the
 * model as a one-shot JSON endpoint. The model owns the useful writing work;
 * the existing completion layer still owns identity, chronology, and the
 * final typed draft contract.
 */
export async function runResumeGenerationAgentTask(input: {
  client: AgentCapableJobFinderAiClient;
  request: CreateResumeDraftInput;
  substantivePrompt: string;
}): Promise<TailoredResumeDraft> {
  let selectedTemplateId =
    input.request.selectedTemplateId ?? input.request.settings.resumeTemplateId;
  let hasComposedProposal = false;
  let hasRenderedPreview = false;
  let hasInspectedRenderedPreview = false;
  // Stall warning: a run that keeps rewording flagged lines render after
  // render used to reach its budget with no clean draft and fall back to the
  // built-in resume. From the third flagged render, or half the budget, the
  // model is told to drop the flagged lines instead.
  const generationStartedAtMs = Date.now();
  const generationBudgetMs = 600_000;
  let flaggedRenderCount = 0;
  const describeRepairStall = (repairCount: number): string | null => {
    const elapsedMs = Date.now() - generationStartedAtMs;
    if (
      repairCount === 0 ||
      (flaggedRenderCount < 3 && elapsedMs < generationBudgetMs / 2)
    ) {
      return null;
    }
    const secondsLeft = Math.max(
      0,
      Math.round((generationBudgetMs - elapsedMs) / 1_000),
    );
    return `This is flagged render ${flaggedRenderCount} and about ${secondsLeft}s are left. Stop rewording: remove each line named in requiredModelRepairs, or put back the candidate's saved wording for it, then render once more and finish. A run that ends without a clean render loses all of your work to the built-in resume.`;
  };
  // The same warning for the other way a run stalls: live Aggressive runs
  // rendered clean drafts and rewrote them again without inspecting, render
  // after render, until the call ceiling ended the run.
  let cleanRenderCount = 0;
  const describeCleanRenderStall = (repairCount: number): string | null =>
    repairCount === 0 && cleanRenderCount >= 3
      ? `This is clean render ${cleanRenderCount} in this run. The draft is ready to keep: call finish_task now, after inspect_completed_resume if you have not inspected this render. Rewriting a clean draft again uses up the run without improving what the person gets.`
      : null;
  let lastRenderedPreview: Awaited<
    ReturnType<NonNullable<typeof input.request.renderPreview>>
  > | null = null;
  // The newest proposal whose render needed no model repair. A run that is
  // still polishing when its time or call budget ends keeps this checked
  // draft instead of dropping all of the AI's work for the built-in resume.
  let lastCheckedProposal: Record<string, unknown> | null = null;
  const groundedResumePayload = buildGroundedResumeRewriteModelPayload(
    input.request,
  );
  const result = await runAgentTask({
    taskId: `resume_generation_${Date.now()}`,
    capability: "resume_generation",
    systemPrompt: [
      input.substantivePrompt,
      "Work through the task tools instead of returning a final JSON object.",
      "Read the complete context and template options, compose a material proposal, render and inspect the resulting full-text preview, revise the proposal when the inspection exposes a weak result, then finish.",
      "The rendered preview can report requiredModelRepairs and personConfirmationCount. Repair every requiredModelRepairs item by removing or rephrasing unsupported model wording; never invent missing candidate facts, dates, or chronology. Aggressive person confirmations are deliberate review decisions for the person, not defects for you to erase or confirm.",
      "When the current proposal has been rendered and inspected with no validation issue, call finish_task unless the inspection exposed a concrete defect. If you revise, name the defect you are fixing, render and inspect that revision, then finish when it is acceptable. Do not keep restyling an already valid preview.",
      "The runtime preserves identity, chronology, selected strategy, and the final typed resume shape. Your job is to do the actual job-targeted writing within the mode-specific instructions above.",
    ].join(" "),
    state: input.request,
    initialDraft: {} as Record<string, unknown>,
    model: createModelAdapter(
      input.client,
      modelConversationKeys.resumeForJob(input.request.job),
      {
        preventRuntimeRetries: true,
        contentToToolCalls(content) {
          try {
            const proposal = JSON.parse(content) as unknown;
            if (
              !proposal ||
              typeof proposal !== "object" ||
              Array.isArray(proposal)
            )
              return null;
            return [
              {
                id: `resume_proposal_${Date.now()}`,
                type: "function",
                function: {
                  name: "compose_resume_proposal",
                  arguments: JSON.stringify({ proposal }),
                },
              },
              {
                id: `resume_preview_${Date.now()}`,
                type: "function",
                function: {
                  name: "render_resume_preview",
                  arguments: "{}",
                },
              },
              {
                id: `resume_finish_${Date.now()}`,
                type: "function",
                function: { name: "finish_task", arguments: "{}" },
              },
            ];
          } catch {
            return null;
          }
        },
      },
    ),
    tools: [
      {
        name: "read_resume_generation_context",
        description:
          "Read the complete target job, candidate profile, selected base resume text, saved preferences, strategy, and settings.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Resume generation context read",
            value: {
              ...context.state,
              ...groundedResumePayload,
            },
            progressMade: false,
          };
        },
      },
      {
        name: "read_resume_templates",
        description:
          "Read the available resume templates and the template already selected by saved strategy, existing draft, or settings. Template selection stays governed by that saved policy.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Resume template options read",
            value: {
              selectedTemplateId,
              selectionLocked: context.state.templateSelectionLocked === true,
              availableTemplates: context.state.availableTemplates ?? [],
            },
            progressMade: false,
          };
        },
      },
      {
        name: "select_resume_template",
        description:
          "Choose the best eligible template for this job and content when the person has not locked a template through an existing draft or saved strategy. An explicit choice is never overridden.",
        inputSchema: z.object({ templateId: z.string().trim().min(1) }),
        parameters: jsonObject({ templateId: { type: "string" } }, [
          "templateId",
        ]),
        permission: "draft_write",
        execute(toolInput, context) {
          const templateId = z
            .object({ templateId: z.string().trim().min(1) })
            .parse(toolInput).templateId;
          if (context.state.templateSelectionLocked) {
            return {
              summary: "Explicit template choice preserved",
              value: { selectedTemplateId },
              progressMade: false,
            };
          }
          const template = context.state.availableTemplates?.find(
            (candidate) => candidate.id === templateId,
          );
          if (!template || template.applyEligible === false) {
            throw new Error(
              `Template '${templateId}' is unavailable or not eligible for application use.`,
            );
          }
          const changed = selectedTemplateId !== templateId;
          selectedTemplateId = templateId;
          if (changed) {
            hasRenderedPreview = false;
            hasInspectedRenderedPreview = false;
            lastRenderedPreview = null;
          }
          return {
            summary: `Resume template selected: ${template.label}`,
            value: { selectedTemplateId },
            progressMade: changed,
          };
        },
      },
      {
        name: "compose_resume_proposal",
        description:
          "Write or revise the sparse job-targeted resume proposal. Use the exact proposal shape described in the task instructions. After inspecting a rendered preview, call this again only to fix a concrete defect and name that defect in reasonForRevision.",
        inputSchema: ResumeGenerationProposalInputSchema,
        parameters: jsonObject(
          {
            proposal: {
              type: "object",
              additionalProperties: true,
              description:
                "Sparse summary, experienceEntries, projectEntries, and optional coreSkills proposal from the task instructions.",
            },
            reasonForRevision: {
              type: "string",
              description:
                "Required only when revising an already rendered and inspected proposal: name the concrete defect this revision fixes.",
            },
          },
          ["proposal"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeGenerationProposalInputSchema.parse(toolInput);
          if (
            hasInspectedRenderedPreview &&
            parsed.reasonForRevision === undefined
          ) {
            return {
              summary:
                "Revision not applied: name a concrete preview defect, or finish the valid inspected proposal",
              validationIssues: [
                {
                  code: "resume_revision_reason_required",
                  message:
                    "The current proposal is already rendered and inspected. Call finish_task if it is acceptable. To revise it, call compose_resume_proposal with reasonForRevision naming the concrete defect you are fixing.",
                  path: ["reasonForRevision"],
                },
              ],
              progressMade: false,
            };
          }
          hasComposedProposal = true;
          hasRenderedPreview = false;
          hasInspectedRenderedPreview = false;
          lastRenderedPreview = null;
          return {
            draft: parsed.proposal,
            summary: "Resume proposal composed",
            progressMade:
              JSON.stringify(context.draft) !== JSON.stringify(parsed.proposal),
          };
        },
      },
      {
        name: "render_resume_preview",
        description:
          "Render the current proposal into the complete typed, full-text resume preview using the selected base resume and saved generation strategy. Inspect all sections and revise before finishing when needed.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute(_toolInput, context) {
          const preview = completeTailoredResumeDraft(
            context.draft,
            context.state,
          );
          return Promise.resolve(
            context.state.renderPreview
              ? context.state.renderPreview({
                  draft: preview,
                  templateId: selectedTemplateId,
                })
              : null,
          ).then((rendered) => {
            hasRenderedPreview = true;
            lastRenderedPreview = rendered;
            const repairCount = rendered?.requiredModelRepairs?.length ?? 0;
            if (repairCount === 0) {
              cleanRenderCount += 1;
              lastCheckedProposal = structuredClone(context.draft);
            } else {
              flaggedRenderCount += 1;
            }
            const stallWarning =
              describeRepairStall(repairCount) ??
              describeCleanRenderStall(repairCount);
            const nextAction =
              stallWarning ??
              (repairCount > 0
                ? "Repair every requiredModelRepairs item, then render again. Do not resolve person confirmation items."
                : "This render is clean. Call inspect_completed_resume, then finish_task unless the inspection shows a concrete defect.");
            return {
              summary: rendered
                ? stallWarning
                  ? `Formatted resume preview rendered. ${stallWarning}`
                  : "Formatted resume preview rendered"
                : "Resume content preview rendered",
              value: {
                ...(stallWarning ? { stallWarning } : {}),
                nextAction,
                selectedTemplateId,
                formattedArtifact: rendered,
                label: preview.label,
                fullText: preview.fullText,
                summary: preview.summary,
                experienceEntries: preview.experienceEntries,
                projectEntries: preview.projectEntries,
                educationEntries: preview.educationEntries,
                certificationEntries: preview.certificationEntries,
                coreSkills: preview.coreSkills,
                targetedKeywords: preview.targetedKeywords,
                coverageMetadata: preview.coverageMetadata,
                generationQuality: preview.generationQuality,
                notes: preview.notes,
              },
              progressMade: false,
            };
          });
        },
      },
      {
        name: "inspect_completed_resume",
        description:
          "Inspect the complete typed resume that the current writing proposal produces, including notes, coverage metadata, provenance, and every rendered content section. Use this feedback to revise weak or incomplete writing before finishing.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute(_toolInput, context) {
          if (hasRenderedPreview) hasInspectedRenderedPreview = true;
          return {
            summary: hasRenderedPreview
              ? "Completed resume inspected; call finish_task now unless you found a concrete defect"
              : "No current rendered preview to inspect; render it before finishing",
            value: {
              resume: completeTailoredResumeDraft(context.draft, context.state),
              formattedArtifact: lastRenderedPreview,
              resumeGenerationPhase: {
                proposalComposed: hasComposedProposal,
                previewRenderedForCurrentProposal: hasRenderedPreview,
                previewInspectedForCurrentProposal: hasInspectedRenderedPreview,
                readyToFinish:
                  hasComposedProposal &&
                  hasRenderedPreview &&
                  hasInspectedRenderedPreview &&
                  (lastRenderedPreview?.requiredModelRepairs?.length ?? 0) ===
                    0,
                nextAction:
                  hasComposedProposal &&
                  hasRenderedPreview &&
                  hasInspectedRenderedPreview &&
                  (lastRenderedPreview?.requiredModelRepairs?.length ?? 0) === 0
                    ? "Call finish_task unless inspection found a concrete defect. To revise, call compose_resume_proposal with reasonForRevision naming that defect."
                    : (lastRenderedPreview?.requiredModelRepairs?.length ?? 0) >
                        0
                      ? (describeRepairStall(
                          lastRenderedPreview?.requiredModelRepairs?.length ??
                            0,
                        ) ??
                        "Repair every requiredModelRepairs item, then render and inspect the revision. Do not resolve person confirmation items.")
                      : "Render and inspect the current proposal before finishing.",
              },
            },
            progressMade: false,
          };
        },
      },
      {
        name: "finish_task",
        description:
          "Finish after composing, rendering, and inspecting a useful resume proposal. This is the required next action when the inspected preview is acceptable.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute() {
          return { summary: "Resume generation finished", finish: true };
        },
      },
    ],
    validate: () => [
      ...(!hasComposedProposal
        ? [
            {
              code: "resume_proposal_required",
              message: "Compose a resume proposal before finishing.",
              path: ["proposal"],
            },
          ]
        : []),
      ...(!hasRenderedPreview
        ? [
            {
              code: "resume_preview_required",
              message:
                "Render and inspect the current resume preview before finishing.",
              path: ["preview"],
            },
          ]
        : []),
      ...(lastRenderedPreview?.requiredModelRepairs ?? []).map((issue) => ({
        code: `resume_preview_${issue.id}`,
        message: issue.flaggedText
          ? `${issue.message} Flagged text: ${issue.flaggedText}`
          : issue.message,
        path: [
          "preview",
          issue.sectionId ?? "",
          issue.entryId ?? "",
          issue.bulletId ?? "",
        ],
      })),
    ],
    buildContext: ({ state, draft, validationIssues }) =>
      compactOpenAiCompatibleUserPayload({
        operation: "createResumeDraft",
        modelContextWindowTokens: 196_000,
        systemPrompt: input.substantivePrompt,
        userPayload: jsonSafe({
          ...groundedResumePayload,
          fullTargetJob: state.job,
          candidateProfile: state.profile,
          selectedBaseResumeText: state.resumeText,
          searchPreferences: state.searchPreferences,
          generationStrategy: state.strategy ?? null,
          settings: state.settings,
          workingProposal: draft,
          resumeGenerationPhase: {
            proposalComposed: hasComposedProposal,
            previewRenderedForCurrentProposal: hasRenderedPreview,
            previewInspectedForCurrentProposal: hasInspectedRenderedPreview,
            formattedArtifact: lastRenderedPreview,
            readyToFinish:
              hasComposedProposal &&
              hasRenderedPreview &&
              hasInspectedRenderedPreview &&
              (lastRenderedPreview?.requiredModelRepairs?.length ?? 0) === 0 &&
              validationIssues.length === 0,
            validationIssues,
          },
        }),
      }),
    timeBudgetMs: generationBudgetMs,
    providerCallBudget: 40,
    noProgressLimit: 6,
    emergencyCeiling: 24,
  });

  // A stopped agent task is not model output. Returning its partial (or still
  // empty) draft made a provider timeout look like writing that had been
  // evaluated and rejected as `provider_output_unverified`. Keep that label
  // for completed model work only so the outer provider boundary can record
  // the real timeout/failure provenance. The one exception is a run that had
  // already rendered a proposal cleanly and was only still revising when a
  // budget ended: that checked draft is kept (above), not thrown away.
  const checkedProposal = lastCheckedProposal as Record<string, unknown> | null;
  if (
    result.receipt.stopReason !== "completed" &&
    checkedProposal &&
    ["time_budget", "cost_budget", "no_progress", "emergency_ceiling"].includes(
      result.receipt.stopReason,
    )
  ) {
    const seconds = Math.max(1, Math.ceil(result.receipt.durationMs / 1_000));
    const completed = completeTailoredResumeDraft(
      checkedProposal,
      input.request,
    );
    return TailoredResumeDraftSchema.parse({
      ...completed,
      notes: [
        ...completed.notes,
        `The AI was still revising when its ${result.receipt.stopReason === "time_budget" ? `time ran out (${seconds}s)` : "budget ran out"}, so this is its last draft that rendered cleanly.`,
      ],
      recommendedTemplateId: selectedTemplateId,
    });
  }

  if (result.receipt.stopReason !== "completed") {
    if (result.receipt.stopReason === "time_budget") {
      const seconds = Math.max(1, Math.ceil(result.receipt.durationMs / 1_000));
      throw new Error(
        `Resume generation agent timed out after ${seconds}s before completing.`,
      );
    }
    throw new Error(
      `Resume generation agent stopped before completing (${result.receipt.stopReason}).`,
    );
  }

  return TailoredResumeDraftSchema.parse({
    ...completeTailoredResumeDraft(result.draft, input.request),
    recommendedTemplateId: selectedTemplateId,
  });
}

export async function runResumeImportStageAgentTask(input: {
  client: AgentCapableJobFinderAiClient;
  request: ExtractResumeImportStageTransportInput;
}): Promise<ResumeImportStageExtractionResult> {
  type Draft = {
    candidates: ResumeImportFieldCandidateDraft[];
    notes: string[];
  };
  const initialDraft: Draft = { candidates: [], notes: [] };
  const result = await runAgentTask({
    taskId: `resume_import_${input.request.stage}_${Date.now()}`,
    capability: "resume_import",
    systemPrompt: [
      `You are importing the ${input.request.stage} portion of a resume into typed profile candidates.`,
      "Use the tools to inspect the parsed document blocks and any layout or vision evidence. Populate candidates only from evidence in the document, with exact source block ids, confidence, alternatives, and review notes when ambiguity remains.",
      "Resolve ambiguity by inspecting more document evidence before finishing. Do not overwrite the saved profile directly; the reconciliation layer will keep genuinely uncertain candidates available for user review.",
      buildResumeImportStageInstructions(input.request.stage),
    ].join(" "),
    state: input.request,
    initialDraft,
    model: createModelAdapter(
      input.client,
      modelConversationKeys.resumeImport(
        input.request.documentBundle.fullText ??
          input.request.documentBundle.blocks
            .map((block) => block.text)
            .join("\n"),
      ),
      {
        preventRuntimeRetries: true,
        contentToToolCalls(content) {
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            const candidateSet = {
              candidates: Array.isArray(parsed.candidates)
                ? parsed.candidates
                : [],
              notes: Array.isArray(parsed.notes) ? parsed.notes : [],
            };
            return [
              {
                id: `resume_import_candidates_${Date.now()}`,
                type: "function",
                function: {
                  name: "record_import_candidates",
                  arguments: JSON.stringify(candidateSet),
                },
              },
              {
                id: `resume_import_finish_${Date.now()}`,
                type: "function",
                function: { name: "finish_task", arguments: "{}" },
              },
            ];
          } catch {
            return null;
          }
        },
      },
    ),
    tools: [
      {
        name: "read_resume_document",
        description:
          "Read the complete parsed resume bundle, including normalized text, structured blocks, pages, parser warnings, and visual evidence references.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Resume document evidence read",
            value: context.state.documentBundle,
            progressMade: false,
          };
        },
      },
      {
        name: "inspect_document_layout",
        description:
          "Inspect page dimensions, ordered blocks, bounding boxes, parser lineage, OCR and quality warnings, and the document route used to decide whether separate vision evidence is required.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          const bundle = context.state.documentBundle;
          return {
            summary: "Resume layout evidence inspected",
            value: {
              pages: bundle.pages,
              blocks: bundle.blocks.map((block) => ({
                id: block.id,
                pageNumber: block.pageNumber,
                readingOrder: block.readingOrder,
                kind: block.kind,
                sectionHint: block.sectionHint,
                bbox: block.bbox,
                sourceParserKinds: block.sourceParserKinds,
                sourceConfidence: block.sourceConfidence,
                parserLineage: block.parserLineage,
                readingOrderConfidence: block.readingOrderConfidence,
              })),
              parserManifest: bundle.parserManifest,
              route: bundle.route,
              quality: bundle.quality,
              warnings: [...bundle.warnings, ...(bundle.qualityWarnings ?? [])],
            },
            progressMade: false,
          };
        },
      },
      {
        name: "read_existing_profile",
        description:
          "Read the existing profile and search preferences so imported values can be marked as new, conflicting, or ambiguous without silently replacing saved data.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Existing profile context read",
            value: {
              profile: context.state.existingProfile,
              searchPreferences: context.state.existingSearchPreferences,
            },
            progressMade: false,
          };
        },
      },
      {
        name: "record_import_candidates",
        description:
          "Write or revise the typed candidates extracted for this stage. Every candidate must cite real source block ids from the document.",
        inputSchema: ResumeImportCandidateSetInputSchema,
        parameters: jsonObject(
          {
            candidates: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  target: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      section: {
                        type: "string",
                        enum: [
                          ...resumeImportTargetSectionsByStage[
                            input.request.stage
                          ],
                        ],
                      },
                      key: { type: "string" },
                      recordId: { type: ["string", "null"] },
                    },
                    required: ["section", "key"],
                  },
                  label: { type: "string" },
                  value: {},
                  normalizedValue: {},
                  valuePreview: { type: ["string", "null"] },
                  evidenceText: { type: ["string", "null"] },
                  sourceBlockIds: {
                    type: "array",
                    items: { type: "string" },
                  },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  notes: { type: "array", items: { type: "string" } },
                  alternatives: { type: "array", items: {} },
                  visualEvidence: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        branch: {
                          type: "string",
                          enum: ["text", "vision", "adjudication"],
                        },
                        sourceFileKind: { type: "string" },
                        pageNumber: { type: ["integer", "null"], minimum: 1 },
                        regionHint: { type: ["string", "null"] },
                        confidence: {
                          type: ["number", "null"],
                          minimum: 0,
                          maximum: 1,
                        },
                        uncertaintyNotes: {
                          type: "array",
                          items: { type: "string" },
                        },
                      },
                    },
                  },
                },
                required: [
                  "target",
                  "label",
                  "value",
                  "sourceBlockIds",
                  "confidence",
                ],
              },
            },
            notes: { type: "array", items: { type: "string" } },
          },
          ["candidates"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeImportCandidateSetInputSchema.parse(toolInput);
          return {
            draft: parsed,
            summary: `${parsed.candidates.length} import candidate(s) recorded`,
            progressMade:
              JSON.stringify(context.draft) !== JSON.stringify(parsed),
          };
        },
      },
      {
        name: "inspect_import_candidates",
        description:
          "Inspect the current candidate set after stage and source-block validation. Revise candidates that lost evidence or target the wrong section.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute(_toolInput, context) {
          const candidateResult = ResumeImportStageExtractionResultSchema.parse(
            {
              stage: context.state.stage,
              analysisProviderKind: "openai_compatible",
              analysisProviderLabel: input.client.getStatus().label,
              candidates: context.draft.candidates,
              notes: context.draft.notes,
            },
          );
          return {
            summary: "Import candidates inspected",
            value: sanitizeStageCandidates(context.state, candidateResult),
            progressMade: false,
          };
        },
      },
      {
        name: "finish_task",
        description:
          "Finish after document inspection and candidate validation are complete.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute() {
          return { summary: "Resume import stage finished", finish: true };
        },
      },
    ],
    validate: () => [],
    buildContext: ({ state, draft }) =>
      compactOpenAiCompatibleUserPayload({
        operation: "extractResumeImportStage",
        modelContextWindowTokens: 196_000,
        systemPrompt: `Resume import ${state.stage} tool task`,
        userPayload: jsonSafe({
          stage: state.stage,
          existingProfile: state.existingProfile,
          existingSearchPreferences: state.existingSearchPreferences,
          documentBundle: state.documentBundle,
          currentCandidates: draft,
        }),
      }),
    timeBudgetMs: 600_000,
    providerCallBudget: 40,
    noProgressLimit: 6,
    emergencyCeiling: 24,
  });

  return sanitizeStageCandidates(
    input.request,
    ResumeImportStageExtractionResultSchema.parse({
      stage: input.request.stage,
      analysisProviderKind: "openai_compatible",
      analysisProviderLabel: input.client.getStatus().label,
      candidates: result.draft.candidates,
      notes: result.draft.notes,
    }),
  );
}

export async function runProfileCopilotAgentTask(input: {
  client: AgentCapableJobFinderAiClient;
  request: ReviseCandidateProfileInput;
}): Promise<ProfileCopilotReply> {
  const initialDraft: ProfileCopilotReply = {
    content: "I need to inspect the saved profile before proposing a change.",
    patchGroups: [],
  };
  const createRuntimeOwnedPatchGroup = (
    draft: ProfileCopilotReply,
    summary: string,
    operations: readonly ProfileCopilotPatchOperation[],
  ): ProfileCopilotPatchGroup => {
    const takenIds = new Set(draft.patchGroups.map((group) => group.id));
    let index = draft.patchGroups.length + 1;
    while (takenIds.has(`profile_proposal_${index}`)) index += 1;
    return ProfileCopilotPatchGroupSchema.parse({
      id: `profile_proposal_${index}`,
      summary,
      applyMode: "needs_review",
      operations: [...operations],
      createdAt: new Date().toISOString(),
    });
  };
  // A proposal that would leave a bullet on an existing card and copy it to a
  // new one is refused before it reaches the draft, with the card to update.
  const ProposeOperationsInputSchema = ProfileOperationsInputSchema.superRefine(
    (value, context) => {
      for (const issue of findBulletsOnTwoCards(input.request.profile, [
        {
          id: "proposal_check",
          summary: value.summary,
          applyMode: "needs_review",
          operations: value.operations,
          createdAt: new Date(0).toISOString(),
        },
      ])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path.slice(2),
          message: issue.message,
        });
      }
    },
  );
  const addOperation = (
    draft: ProfileCopilotReply,
    summary: string,
    operation: ProfileCopilotPatchOperation,
  ): ProfileCopilotReply => ({
    ...draft,
    patchGroups: [
      ...draft.patchGroups,
      createRuntimeOwnedPatchGroup(draft, summary, [operation]),
    ],
  });
  const result = await runAgentTask({
    taskId: `profile_copilot_${Date.now()}`,
    capability: "profile_copilot",
    systemPrompt: [
      "You are the Profile Copilot. Work through the typed tools instead of returning a final JSON object.",
      PROFILE_RESUME_APPROACH_VOCABULARY,
      "Use propose_profile_operations for profile edits: it is the universal path that accepts every schema-valid operation kind and wraps them into one needs_review group per call with runtime-assigned id, apply mode, and timestamp. The dedicated set_* tools remain as conveniences.",
      "For record upserts, include only fields the person asked to change and the existing record id. Omit every unchanged field. Send null or an empty list only when the person explicitly asks to clear that field. New records may include only the details that are known; the runtime supplies safe defaults.",
      "For education reordering, use reorder_education_records with every existing education record id exactly once in the requested order; do not use upserts to simulate ordering.",
      "Any update to an existing card (experience, education, certification, link, project, language) must carry that card's id from read_profile_context; an operation without an id always creates a new card.",
      "To end a role, update its card with isCurrent false and endDate as YYYY-MM. To fix a date, update only the date fields of that card.",
      "To merge two roles into one, update the card you keep (by id) with the combined dates and every bullet from both, then remove the other card by id, in one propose_profile_operations call.",
      "To split one role into two, update the existing card (by id) to the earlier title and dates, and add one new card with companyName, title, dates and the bullets that belong to it. Each bullet ends up on exactly one card: the update to the existing card must carry its achievements without the bullets that moved (an empty list when all moved). When the person did not say which bullets belong where, move them all to the later card and say so.",
      "To reorder skills, target roles or locations, send the complete list in the new order with set_profile_list_fields; to remove entries, use remove_profile_list_entries.",
      "Work eligibility (countries where the person can work, whether they need visa sponsorship, remote eligibility, relocation, travel, notice period) uses set_work_eligibility_fields. Record only what the person says or what their resume states outright.",
      "Contact details (email, phone, links) and location use set_identity_fields.",
      "recentConversation holds the last turns of this chat, oldest first, with the proposals you made and whether they were applied. Treat short follow-ups such as 'fix it', 'do it', 'yes', 'all of them' or 'the second one' as referring to what you said or proposed there, and act on all of it.",
      "Every gap or improvement you mention must be one you either propose as a change in this same reply, or ask one direct question about that names the exact fact you need. Never tell the person to make a change themselves when a tool here can make it; do not write 'you should', 'consider adding' or 'you may want to'. When asked to fix what you listed, propose every change the saved profile and resume support, and ask a single short question for the facts only the person knows.",
      "When asked what is weak or missing, name the three to five gaps that matter most for getting hired, each in a few words, then propose the fixes the saved profile and resume support and ask for the facts only the person knows.",
      "conversationFacts include changes the person already applied or turned down in this chat; never propose undoing one or re-proposing a turned-down change unless they ask.",
      "Answer grounded questions directly. For edits, set helpful response content that says what each proposal does and what, if anything, you still need from the person, and add one or more bounded patch groups.",
      "Each proposal is shown under your reply as a card, and nothing in the profile changes until the person presses Apply & save on it. Write that you prepared a change, never that you applied, saved, updated or changed anything.",
      // Last, so the person's chosen initiative is the final word on how much
      // to add beyond the request.
      ...describeProfileAssistantBehavior(input.request.assistantBehavior),
      "Never invent experience, credentials, dates, compensation currency, or metrics. Broad or ambiguous edits need review.",
      "Call validate_profile_draft, repair every issue, then finish_task.",
    ].join(" "),
    state: input.request,
    initialDraft,
    model: createModelAdapter(
      input.client,
      modelConversationKeys.profileCopilot(input.request.profile),
      { preventRuntimeRetries: true },
    ),
    tools: [
      {
        name: "read_profile_context",
        description:
          "Read the saved profile, preferences, context, and review items for this task.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Saved profile context",
            value: context.state,
            progressMade: false,
          };
        },
      },
      {
        name: "set_response_content",
        description: "Set the concise grounded response shown to the user.",
        inputSchema: ContentInputSchema,
        parameters: jsonObject({ content: { type: "string" } }, ["content"]),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ContentInputSchema.parse(toolInput);
          return {
            draft: { ...context.draft, content: parsed.content },
            summary: "Response content updated",
            progressMade: context.draft.content !== parsed.content,
          };
        },
      },
      {
        name: "set_identity_fields",
        description:
          "Propose bounded identity changes such as headline, location, portfolio, GitHub, or website fields. Use set_professional_summary_fields for the professional summary shown in Basics. Supply only fields the user requested or evidence supports; proposal metadata is added automatically.",
        inputSchema: IdentityFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: {
              type: "object",
              additionalProperties: true,
              description:
                "Supported examples: headline, currentLocation, githubUrl, portfolioUrl, personalWebsiteUrl, yearsExperience. For the professional summary shown in Basics, use set_professional_summary_fields with fullSummary.",
            },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = IdentityFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_identity_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_professional_summary_fields",
        description:
          "Propose bounded professional-summary fields such as shortValueProposition, fullSummary, strengths, or careerThemes. The editable Professional summary field in Basics is fullSummary.",
        inputSchema: ProfessionalSummaryFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: { type: "object", additionalProperties: true },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ProfessionalSummaryFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_professional_summary_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_profile_list_fields",
        description:
          "Propose complete replacements for profile targetRoles, locations, or skills arrays.",
        inputSchema: ProfileListFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: {
              type: "object",
              additionalProperties: false,
              properties: {
                targetRoles: { type: "array", items: { type: "string" } },
                locations: { type: "array", items: { type: "string" } },
                skills: { type: "array", items: { type: "string" } },
              },
            },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ProfileListFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_profile_list_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_search_preferences",
        description:
          "Propose bounded search-preference changes such as targetRoles, locations, workModes, employmentTypes, or seniorityLevels. For the resume level (Original, Light, Tailored or Aggressive) use set_resume_approach instead.",
        inputSchema: SearchPreferenceFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: { type: "object", additionalProperties: true },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = SearchPreferenceFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_search_preferences_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_resume_approach",
        description:
          "Propose the resume level for jobs shortlisted from now on, the same choice as Settings > AI behavior > Resumes: original_resume (Original, the imported file sent unchanged), conservative (Light), balanced (Tailored) or aggressive (Aggressive).",
        inputSchema: ResumeApproachInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            approach: {
              type: "string",
              enum: [
                "original_resume",
                "conservative",
                "balanced",
                "aggressive",
              ],
            },
          },
          ["summary", "approach"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeApproachInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "set_resume_approach",
              value: parsed.approach,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_compensation_preferences",
        description:
          "Propose compensation fields. Preserve minimum and target ranges separately, use interval hour/day/week/month/year, and never guess currency.",
        inputSchema: CompensationFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: { type: "object", additionalProperties: true },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = CompensationFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_compensation_preferences_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "set_work_eligibility_fields",
        description:
          "Propose work-eligibility facts: authorizedWorkCountries (array of countries or regions such as European Union), requiresVisaSponsorship (boolean), remoteEligible, willingToRelocate, willingToTravel (booleans), preferredRelocationRegions (array), noticePeriodDays (number), availableStartDate, securityClearance. Only facts the person stated or their resume states outright.",
        inputSchema: WorkEligibilityFieldsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            fields: { type: "object", additionalProperties: true },
          },
          ["summary", "fields"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = WorkEligibilityFieldsInputSchema.parse(toolInput);
          return {
            draft: addOperation(context.draft, parsed.summary, {
              operation: "replace_work_eligibility_fields",
              value: parsed.fields,
            }),
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "propose_profile_operations",
        description:
          "Universal profile proposal path: submit one or more schema-valid profile patch operations of any kind (scalar or list field replacements, record upserts or removals, review resolutions) and the runtime wraps them into a single review-only patch group, assigning the id, needs_review apply mode, and timestamp itself.",
        inputSchema: ProposeOperationsInputSchema,
        parameters: jsonObject(
          {
            summary: { type: "string" },
            operations: {
              type: "array",
              minItems: 1,
              items: { type: "object", additionalProperties: true },
              description:
                "Each entry carries an operation discriminator (for example replace_identity_fields, upsert_experience_record, reorder_education_records, remove_link_record, remove_profile_list_entries, resolve_review_items, set_resume_approach) plus its payload: value, record, recordId, orderedRecordIds, field with values, or reviewItemIds with resolutionStatus. set_resume_approach takes value original_resume, conservative, balanced or aggressive. To reorder education, pass every existing education id exactly once in orderedRecordIds. To take one skill, saved location, or target role out of a list, use remove_profile_list_entries with the field and the exact entries to remove; never resend the whole list to drop one item, and never remove an entry the person did not name.",
            },
          },
          ["summary", "operations"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ProposeOperationsInputSchema.parse(toolInput);
          return {
            draft: {
              ...context.draft,
              patchGroups: [
                ...context.draft.patchGroups,
                createRuntimeOwnedPatchGroup(
                  context.draft,
                  parsed.summary,
                  parsed.operations,
                ),
              ],
            },
            summary: parsed.summary,
            progressMade: true,
          };
        },
      },
      {
        name: "validate_profile_draft",
        description:
          "Validate the complete temporary profile proposal and return exact repair errors.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute(_toolInput, context) {
          const parsed = ProfileCopilotReplySchema.safeParse(context.draft);
          return {
            summary: parsed.success
              ? "Profile proposal is valid"
              : "Profile proposal needs repair",
            validationIssues: parsed.success ? [] : zodIssues(parsed.error),
            progressMade: false,
          };
        },
      },
      {
        name: "finish_task",
        description: "Finish only after the profile proposal validates.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        execute() {
          return { summary: "Finish requested", finish: true };
        },
      },
    ],
    validate: (draft) => {
      const parsed = ProfileCopilotReplySchema.safeParse(draft);
      return parsed.success ? [] : zodIssues(parsed.error);
    },
    buildContext: ({ state, draft, validationIssues }) =>
      compactOpenAiCompatibleUserPayload({
        operation: "reviseCandidateProfile",
        modelContextWindowTokens: 196_000,
        systemPrompt: "Profile Copilot tool task",
        userPayload: jsonSafe({
          request: state.request,
          recentConversation: state.recentConversation ?? [],
          conversationFacts: state.conversationFacts ?? [],
          context: state.context,
          // The saved resume level, Original included; the prompt names this
          // field, and searchPreferences alone reads as Light on Original.
          resumeApproach: state.resumeApproach ?? null,
          profile: state.profile,
          searchPreferences: state.searchPreferences,
          relevantReviewItems: state.relevantReviewItems,
          currentDraft: draft,
          validationIssues,
        }),
      }),
    // Two or three tool turns on a slower model; each turn has its own
    // timeout, this bounds the whole request.
    timeBudgetMs: 150_000,
    noProgressLimit: 4,
  });

  return ProfileCopilotReplySchema.parse({
    ...result.draft,
    executionReceipt: result.receipt,
  });
}

/**
 * How many times finish is refused because the approval gate still flags the
 * proposal and the model has not yet seen that verdict. After that the model's
 * own call stands and the service reports whatever the gate still says.
 */
const RESUME_EDIT_GATE_REFUSAL_LIMIT = 2;

const ResumeEntrySummaryInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  entryId: z.string().trim().min(1),
  newText: z.string().trim().min(1),
});
const ResumeItemIncludedInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  entryId: z.string().trim().min(1).nullish(),
  bulletId: z.string().trim().min(1).nullish(),
  included: z.boolean(),
});
const ResumeInsertBulletInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  entryId: z.string().trim().min(1).nullish(),
  newText: z.string().trim().min(1),
  anchorBulletId: z.string().trim().min(1).nullish(),
  position: z.enum(["before", "after"]).nullish(),
});
const ResumeMoveBulletInputSchema = z.object({
  sectionId: z.string().trim().min(1),
  entryId: z.string().trim().min(1).nullish(),
  bulletId: z.string().trim().min(1),
  anchorBulletId: z.string().trim().min(1).nullish(),
  position: z.enum(["before", "after"]).nullish(),
});
const ResumePatchIdInputSchema = z.object({
  patchId: z.string().trim().min(1),
});

/**
 * A wrong id or a locked target is the model's to repair: the message names
 * the valid ids and the "Invalid" prefix keeps the run going instead of
 * ending it as a permanent failure with nothing to show.
 */
function invalidResumeTarget(message: string): Error {
  return new Error(`Invalid target: ${message}`);
}

type ResumeEditSection = ReviseResumeDraftInput["draft"]["sections"][number];

function requireEditableResumeSection(
  draft: ReviseResumeDraftInput["draft"],
  sectionId: string,
): ResumeEditSection {
  const section = draft.sections.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!section) {
    throw invalidResumeTarget(
      `section '${sectionId}' does not exist. Section ids: ${draft.sections.map((candidate) => candidate.id).join(", ") || "none"}.`,
    );
  }
  if (section.locked) {
    throw invalidResumeTarget(
      `the ${section.label} section is locked by the person, so it cannot be changed. Say so in the response.`,
    );
  }
  return section;
}

function requireEditableResumeEntry(
  section: ResumeEditSection,
  entryId: string,
): ResumeEditSection["entries"][number] {
  const entry = section.entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw invalidResumeTarget(
      `entry '${entryId}' is not in section '${section.id}'. Entry ids in this section: ${section.entries.map((candidate) => candidate.id).join(", ") || "none"}.`,
    );
  }
  if (entry.locked) {
    throw invalidResumeTarget(
      `this entry is locked by the person, so it cannot be changed. Say so in the response.`,
    );
  }
  return entry;
}

function requireEditableResumeBullet(
  section: ResumeEditSection,
  entryId: string | null | undefined,
  bulletId: string,
): ResumeEditSection["bullets"][number] {
  const collection = entryId
    ? requireEditableResumeEntry(section, entryId).bullets
    : section.bullets;
  const bullet = collection.find((candidate) => candidate.id === bulletId);
  if (!bullet) {
    throw invalidResumeTarget(
      `bullet '${bulletId}' is not in ${entryId ? `entry '${entryId}'` : `the top level of section '${section.id}'`}. Bullet ids there: ${collection.map((candidate) => candidate.id).join(", ") || "none"}.${entryId ? "" : ` Entries in this section: ${section.entries.map((candidate) => candidate.id).join(", ") || "none"}.`}`,
    );
  }
  if (bullet.locked) {
    throw invalidResumeTarget(
      "this bullet is locked by the person, so it cannot be changed. Say so in the response.",
    );
  }
  return bullet;
}

function nextResumeEditPatchId(patches: readonly ResumeDraftPatch[]): string {
  const highest = patches.reduce((max, patch) => {
    const match = /^resume_patch_(\d+)$/u.exec(patch.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `resume_patch_${highest + 1}`;
}

/**
 * A second change to the same text replaces the first instead of stacking on
 * it: that is how the model repairs a flagged wording, and two patches on one
 * line would otherwise both be shown and the first one blamed.
 */
function withResumeEditPatch(
  patches: readonly ResumeDraftPatch[],
  patch: ResumeDraftPatch,
): ResumeDraftPatch[] {
  const replaceable = new Set([
    "replace_section_text",
    "replace_entry_summary",
    "update_bullet",
    "toggle_include",
    "move_bullet",
  ]);
  const kept = replaceable.has(patch.operation)
    ? patches.filter(
        (existing) =>
          !(
            existing.operation === patch.operation &&
            existing.targetSectionId === patch.targetSectionId &&
            (existing.targetEntryId ?? null) ===
              (patch.targetEntryId ?? null) &&
            (existing.targetBulletId ?? null) === (patch.targetBulletId ?? null)
          ),
      )
    : [...patches];
  return [...kept, patch];
}

function resumeEditPatchSignature(
  patches: readonly ResumeDraftPatch[],
): string {
  return JSON.stringify(
    patches.map((patch) => [
      patch.operation,
      patch.targetSectionId,
      patch.targetEntryId,
      patch.targetBulletId,
      patch.anchorBulletId,
      patch.position,
      patch.newText,
      patch.newIncluded,
    ]),
  );
}

/**
 * Which gate findings the model has to repair at this resume level. On
 * Aggressive, a stretch the person confirms under Lines to confirm is the
 * policy working; everywhere else it is a change to reword or drop unless the
 * person stated that fact themselves.
 */
function describeResumeProposalCheck(input: {
  check: ResumeProposalCheckResult;
  tailoringStrength: ReviseResumeDraftInput["tailoringStrength"];
}): {
  needsRepair: boolean;
  issues: AgentTaskValidationIssue[];
  value: unknown;
} {
  const aggressive = input.tailoringStrength === "aggressive";
  if (input.check.applyError) {
    return {
      needsRepair: true,
      issues: [
        {
          code: "proposal_not_appliable",
          message: `A change cannot be applied to the draft: ${input.check.applyError} Fix its ids or remove it with remove_resume_patch.`,
          path: [],
        },
      ],
      value: { appliable: false, error: input.check.applyError },
    };
  }
  const findings = input.check.findings.map((finding) => ({
    ...finding,
    whatHappensIfAccepted:
      finding.kind === "needs_confirmation"
        ? "It is listed under Lines to confirm, where the person keeps or removes it before approval."
        : "It blocks approval until the person rewrites it or approves it as accurate.",
    whatToDo:
      finding.kind === "needs_confirmation"
        ? aggressive
          ? "Allowed on this Aggressive resume. Keep it if it serves the request, and say in the response that it goes to Lines to confirm."
          : "Reword it from the saved evidence, or remove it with remove_resume_patch, unless the person stated this fact themselves in this conversation; then keep it and say it goes to Lines to confirm."
        : "Reword it so the saved evidence backs it, or remove it with remove_resume_patch and say which part you did not do and why. Keep it only if the person stated this exact fact themselves in this conversation, and then say they will need to approve it as accurate.",
  }));
  const repairable = findings.filter(
    (finding) => finding.kind === "unsupported" || !aggressive,
  );
  const dropped = input.check.droppedOnSave ?? [];
  return {
    needsRepair: repairable.length > 0 || dropped.length > 0,
    issues: [
      ...dropped.map((drop) => ({
        code: "removed_when_saved",
        message: `${drop.patchId}: ${drop.message} Remove it with remove_resume_patch and say plainly in the response why it cannot be added.`,
        path: [drop.patchId],
      })),
      ...repairable.map((finding) => ({
        code:
          finding.kind === "needs_confirmation"
            ? "needs_person_confirmation"
            : "unsupported_by_saved_evidence",
        message: `${finding.patchId ?? "A change"}: "${finding.flaggedText ?? "this wording"}" ${finding.message} ${finding.whatToDo}`,
        path: finding.patchId ? [finding.patchId] : [],
      })),
    ],
    value: {
      appliable: true,
      clean: findings.length === 0 && dropped.length === 0,
      findings,
      removedWhenSaved: dropped,
    },
  };
}

export async function runResumeEditAgentTask(input: {
  client: AgentCapableJobFinderAiClient;
  request: ReviseResumeDraftInput;
}): Promise<ResumeAssistantReply> {
  const initialDraft: ResumeAssistantReply = {
    content:
      "I am reviewing the requested résumé change against the saved evidence.",
    patches: [],
  };
  const aggressive = input.request.tailoringStrength === "aggressive";
  // The last patch set whose gate verdict the model has been shown. Finishing
  // on a set it has seen is its decision; finishing on an unseen, flagged set
  // is refused (a bounded number of times) with the verdict attached.
  let lastCheckedSignature: string | null = null;
  let gateRefusals = 0;
  // Stall warning and safety net. A Tailored "what would you change" run
  // rewrote the summary, was flagged, removed it, rewrote it again, and
  // reached its time budget with nothing to show. From the third flagged
  // check, or half the budget, the model is told to keep what passed and
  // finish; a run that still stops mid-rewording keeps the newest set of
  // changes that passed the check.
  const editStartedAtMs = Date.now();
  const editBudgetMs = 180_000;
  let flaggedCheckCount = 0;
  let lastCleanPatches: ResumeDraftPatch[] | null = null;
  const describeEditStall = (): string | null => {
    const elapsedMs = Date.now() - editStartedAtMs;
    if (flaggedCheckCount < 3 && elapsedMs < editBudgetMs / 2) {
      return null;
    }
    const secondsLeft = Math.max(
      0,
      Math.round((editBudgetMs - elapsedMs) / 1_000),
    );
    return `This is flagged check ${flaggedCheckCount} and about ${secondsLeft}s are left. Stop rewording: remove each flagged change with remove_resume_patch and keep the ones that passed, set the response to say what you changed and which part you could not do because the saved evidence does not back it, then call validate_resume_draft once more and finish_task. A run that stops in the middle of rewording gives the person nothing.`;
  };
  const runCheck = async (patches: readonly ResumeDraftPatch[]) => {
    const check = input.request.checkProposal
      ? await input.request.checkProposal(patches)
      : { applyError: null, findings: [] };
    lastCheckedSignature = resumeEditPatchSignature(patches);
    const verdict = describeResumeProposalCheck({
      check,
      tailoringStrength: input.request.tailoringStrength,
    });
    if (verdict.needsRepair) {
      flaggedCheckCount += 1;
    } else if (patches.length > 0) {
      lastCleanPatches = structuredClone([...patches]);
    }
    const stallWarning = verdict.needsRepair ? describeEditStall() : null;
    return {
      ...verdict,
      stallWarning,
      issues: stallWarning
        ? [
            ...verdict.issues,
            { code: "stop_rewording", message: stallWarning, path: [] },
          ]
        : verdict.issues,
    };
  };
  const readableContext = (state: ReviseResumeDraftInput) => ({
    request: state.request,
    recentConversation: state.recentConversation ?? [],
    linesToConfirm: state.linesToConfirm ?? null,
    draft: state.draft,
    job: state.job,
    // The level by the name the person sees in the app.
    resumeLevel:
      state.tailoringStrength === "aggressive"
        ? "Aggressive"
        : state.tailoringStrength === "balanced"
          ? "Tailored"
          : state.tailoringStrength === "conservative"
            ? "Light"
            : null,
    currentPageCount: state.currentPageCount ?? null,
    availableTemplates: state.availableTemplates ?? [],
    currentTemplateId: state.draft.templateId,
    // The name the studio shows; the model called "classic_ats" "Classic
    // ATS" while the studio said "Chronology Classic".
    currentTemplateLabel:
      (state.availableTemplates ?? []).find(
        (template) => template.id === state.draft.templateId,
      )?.label ?? null,
    validationIssues: state.validationIssues ?? [],
    researchContext: state.researchContext ?? null,
  });
  const addPatch = (
    context: { draft: ResumeAssistantReply; state: ReviseResumeDraftInput },
    fields: Partial<ResumeDraftPatch> &
      Pick<ResumeDraftPatch, "operation" | "targetSectionId">,
    summary: string,
  ) => {
    const patch = ResumeDraftPatchSchema.parse({
      id: nextResumeEditPatchId(context.draft.patches),
      draftId: context.state.draft.id,
      appliedAt: new Date().toISOString(),
      origin: "assistant",
      ...fields,
    });
    return {
      draft: {
        ...context.draft,
        patches: withResumeEditPatch(context.draft.patches, patch),
      },
      summary: `${summary} (${patch.id})`,
      progressMade: true,
    };
  };
  const result = await runAgentTask({
    taskId: `resume_edit_${Date.now()}`,
    capability: "guided_resume_edits",
    systemPrompt: [
      "You are the Assistant inside the person's Resume Studio for one job. You edit this job's résumé draft through tools, not a final JSON response. Every change you make is a proposal the person accepts or rejects with one press.",
      "recentConversation holds the last turns of this thread, oldest first, with each proposal's changes and status (waiting_for_review, accepted, rejected). Read the new request against it: 'do it', 'yes', 'go ahead', 'the second one' or 'that' refer to what was just said or proposed. When the person agrees to changes you described in words, make those changes now. When they pick some of several changes, propose only those. Never answer a follow-up by asking what they meant when the conversation already says it.",
      "Prefer replace_resume_section_text for section prose, replace_resume_entry_summary for a role's summary line, update_resume_bullet for one bullet (top-level or in an entry), insert_resume_bullet to add a bullet or skill, move_resume_bullet to reorder bullets or skills, and set_resume_item_included to hide or show a bullet, a skill, or a whole entry such as a role. A second change to the same text replaces your first one; remove_resume_patch drops a change. Use add_resume_patch only when no dedicated tool fits. You cannot reorder whole entries, change dates, or switch templates.",
      aggressive
        ? (describeAggressiveResumeEditPolicy(
            input.request.tailoringStrength,
          ) ?? "")
        : "This is a Light or Tailored resume: never state a fact, metric, employer, tool, or date that the saved evidence does not carry. Job-only wording is not candidate evidence. If part of a request asks for one, do the grounded part and say plainly in the response which part you did not do and why.",
      "The person is the authority on their own facts. When they state a fact about themselves in this conversation (for example 'my accessibility focus' or 'I use Storybook'), you may write it even if the saved evidence lacks it. Say what validate_resume_draft reports for it: that it goes to Lines to confirm, that they approve it as accurate, or, when the check finds nothing to flag, nothing extra. A skill must be in their saved profile or the job listing to stay on the resume; when the check says a change is removed when saved, drop it and say so plainly, adding that a skill added to their Profile skills becomes available here.",
      "linesToConfirm lists lines already on the résumé that wait for the person's Keep or Remove under Lines to confirm (null when unknown). Use it when asked what still needs confirming; validate_resume_draft checks only your new changes.",
      "validate_resume_draft runs the same approval check the résumé must pass, over the draft your changes would produce, and says for each flagged line whether it would go to Lines to confirm or would block approval, and what to do. Call it after your changes, repair what it asks you to repair, and call it again before finish_task.",
      "Only suggest changes you can make with these tools. When the person asks what you would change, make the changes as proposals instead of only describing them, unless no safe improvement exists; then say so plainly. Never tell the person to do something you could do yourself. For something you cannot do, say plainly that you cannot do it here and name the studio control that does it: dates are the Start date and End date fields on that role under Edit resume, Experience; the template is Change template; a role's position is its Move up and Move down buttons. Name templates by their label (currentTemplateLabel, availableTemplates), never by id.",
      "currentPageCount is how many pages the draft rendered to when last measured (null when unknown). measure_resume_pages renders the draft your changes would produce and returns the real page count: use it for any request about length or pages, before and after your changes. If the draft already fits, say so and change nothing. To make it shorter, hide the weakest bullets or trim wording; do not hide the person's only role.",
      "Keep the response short and plain: what you changed, and anything you did not do and why. Do not touch locked content.",
    ]
      .filter((line) => line.length > 0)
      .join(" "),
    state: input.request,
    initialDraft,
    model: createModelAdapter(
      input.client,
      modelConversationKeys.resumeForJob(input.request.job),
    ),
    tools: [
      {
        name: "read_resume_context",
        description:
          "Read the request, the recent conversation, the résumé draft with its ids, the job, the resume level, the page count, and research context.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        parallelSafe: true,
        execute(_toolInput, context) {
          return {
            summary: "Résumé context",
            value: jsonSafe(readableContext(context.state)),
          };
        },
      },
      {
        name: "set_response_content",
        description:
          "Set the short reply shown to the person: what you changed, and anything you did not do and why.",
        inputSchema: ContentInputSchema,
        parameters: jsonObject({ content: { type: "string" } }, ["content"]),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ContentInputSchema.parse(toolInput);
          return {
            draft: { ...context.draft, content: parsed.content },
            summary: "Response content updated",
            progressMade: context.draft.content !== parsed.content,
          };
        },
      },
      {
        name: "replace_resume_section_text",
        description:
          "Propose new text for one unlocked prose section such as the summary. Replaces any earlier change you made to the same section.",
        inputSchema: ResumeSectionTextInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            newText: { type: "string" },
          },
          ["sectionId", "newText"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeSectionTextInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          return addPatch(
            context,
            {
              operation: "replace_section_text",
              targetSectionId: section.id,
              newText: parsed.newText,
            },
            `Proposed a replacement for ${section.label}`,
          );
        },
      },
      {
        name: "replace_resume_entry_summary",
        description:
          "Propose a new summary line for one entry, such as a role's description under Experience.",
        inputSchema: ResumeEntrySummaryInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            entryId: { type: "string" },
            newText: { type: "string" },
          },
          ["sectionId", "entryId", "newText"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeEntrySummaryInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          const entry = requireEditableResumeEntry(section, parsed.entryId);
          return addPatch(
            context,
            {
              operation: "replace_entry_summary",
              targetSectionId: section.id,
              targetEntryId: entry.id,
              newText: parsed.newText,
            },
            `Proposed a new summary for ${entry.title ?? section.label}`,
          );
        },
      },
      {
        name: "update_resume_bullet",
        description:
          "Propose a rewrite of one bullet. Give entryId for a bullet inside an entry; leave it out for a top-level bullet such as one skill.",
        inputSchema: ResumeBulletTextInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            entryId: { type: ["string", "null"] },
            bulletId: { type: "string" },
            newText: { type: "string" },
          },
          ["sectionId", "bulletId", "newText"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeBulletTextInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          const bullet = requireEditableResumeBullet(
            section,
            parsed.entryId,
            parsed.bulletId,
          );
          return addPatch(
            context,
            {
              operation: "update_bullet",
              targetSectionId: section.id,
              targetEntryId: parsed.entryId ?? null,
              targetBulletId: bullet.id,
              newText: parsed.newText,
            },
            `Proposed a rewrite of one bullet in ${section.label}`,
          );
        },
      },
      {
        name: "insert_resume_bullet",
        description:
          "Propose a new bullet: a skill or keyword at the top level of a section, or a bullet inside an entry. Without anchorBulletId it goes last.",
        inputSchema: ResumeInsertBulletInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            entryId: { type: ["string", "null"] },
            newText: { type: "string" },
            anchorBulletId: { type: ["string", "null"] },
            position: {
              type: ["string", "null"],
              enum: ["before", "after", null],
            },
          },
          ["sectionId", "newText"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeInsertBulletInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          if (parsed.entryId)
            requireEditableResumeEntry(section, parsed.entryId);
          if (parsed.anchorBulletId) {
            requireEditableResumeBullet(
              section,
              parsed.entryId,
              parsed.anchorBulletId,
            );
          }
          return addPatch(
            context,
            {
              operation: "insert_bullet",
              targetSectionId: section.id,
              targetEntryId: parsed.entryId ?? null,
              anchorBulletId: parsed.anchorBulletId ?? null,
              position: parsed.anchorBulletId
                ? (parsed.position ?? "after")
                : null,
              newText: parsed.newText,
            },
            `Proposed a new bullet in ${section.label}`,
          );
        },
      },
      {
        name: "move_resume_bullet",
        description:
          "Propose moving one bullet or skill before or after another in the same list. Without anchorBulletId it moves to the end.",
        inputSchema: ResumeMoveBulletInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            entryId: { type: ["string", "null"] },
            bulletId: { type: "string" },
            anchorBulletId: { type: ["string", "null"] },
            position: {
              type: ["string", "null"],
              enum: ["before", "after", null],
            },
          },
          ["sectionId", "bulletId"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeMoveBulletInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          const bullet = requireEditableResumeBullet(
            section,
            parsed.entryId,
            parsed.bulletId,
          );
          if (parsed.anchorBulletId) {
            requireEditableResumeBullet(
              section,
              parsed.entryId,
              parsed.anchorBulletId,
            );
          }
          return addPatch(
            context,
            {
              operation: "move_bullet",
              targetSectionId: section.id,
              targetEntryId: parsed.entryId ?? null,
              targetBulletId: bullet.id,
              anchorBulletId: parsed.anchorBulletId ?? null,
              position: parsed.anchorBulletId
                ? (parsed.position ?? "before")
                : null,
            },
            `Proposed moving "${bullet.text}"`,
          );
        },
      },
      {
        name: "set_resume_item_included",
        description:
          "Propose hiding or showing existing content: give bulletId for one bullet or skill (with entryId when it sits in an entry), or only entryId for a whole entry such as a role. This never creates a new fact.",
        inputSchema: ResumeItemIncludedInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            entryId: { type: ["string", "null"] },
            bulletId: { type: ["string", "null"] },
            included: { type: "boolean" },
          },
          ["sectionId", "included"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeItemIncludedInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          if (!parsed.bulletId && !parsed.entryId) {
            throw invalidResumeTarget(
              "give a bulletId, an entryId, or both. To hide a whole section, hide each of its entries or bullets.",
            );
          }
          const label = parsed.bulletId
            ? requireEditableResumeBullet(
                section,
                parsed.entryId,
                parsed.bulletId,
              ).text
            : (requireEditableResumeEntry(section, parsed.entryId!).title ??
              section.label);
          return addPatch(
            context,
            {
              operation: "toggle_include",
              targetSectionId: section.id,
              targetEntryId: parsed.entryId ?? null,
              targetBulletId: parsed.bulletId ?? null,
              newIncluded: parsed.included,
            },
            `${parsed.included ? "Showed" : "Hid"} ${label}`,
          );
        },
      },
      {
        name: "set_resume_bullet_included",
        description:
          "Older name for set_resume_item_included with a top-level bullet: show or hide one existing skill or keyword.",
        inputSchema: ResumeBulletIncludedInputSchema,
        parameters: jsonObject(
          {
            sectionId: { type: "string" },
            bulletId: { type: "string" },
            included: { type: "boolean" },
          },
          ["sectionId", "bulletId", "included"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumeBulletIncludedInputSchema.parse(toolInput);
          const section = requireEditableResumeSection(
            context.state.draft,
            parsed.sectionId,
          );
          const bullet = requireEditableResumeBullet(
            section,
            null,
            parsed.bulletId,
          );
          return addPatch(
            context,
            {
              operation: "toggle_include",
              targetSectionId: section.id,
              targetBulletId: bullet.id,
              newIncluded: parsed.included,
            },
            `${parsed.included ? "Showed" : "Hid"} ${bullet.text}`,
          );
        },
      },
      {
        name: "measure_resume_pages",
        description:
          "Render the draft your current changes would produce to the application PDF and return its page count and the planned page count. Takes several seconds.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        async execute(_toolInput, context) {
          if (!context.state.measurePages) {
            return {
              summary: "Page count is not available here",
              value: { pageCount: null },
            };
          }
          const measured = await context.state.measurePages(
            context.draft.patches,
          );
          return {
            summary:
              measured.pageCount === null
                ? "The page count could not be measured"
                : `Renders to ${measured.pageCount} page${measured.pageCount === 1 ? "" : "s"} (planned ${measured.targetPageCount})`,
            value: {
              ...measured,
              measuredWithChanges: context.draft.patches.map(
                (patch) => patch.id,
              ),
            },
          };
        },
      },
      {
        name: "remove_resume_patch",
        description:
          "Drop one of your proposed changes by its patch id, for example one the approval check flagged that you cannot reword.",
        inputSchema: ResumePatchIdInputSchema,
        parameters: jsonObject({ patchId: { type: "string" } }, ["patchId"]),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumePatchIdInputSchema.parse(toolInput);
          if (
            !context.draft.patches.some((patch) => patch.id === parsed.patchId)
          ) {
            throw invalidResumeTarget(
              `no proposed change has id '${parsed.patchId}'. Proposed change ids: ${context.draft.patches.map((patch) => patch.id).join(", ") || "none"}.`,
            );
          }
          return {
            draft: {
              ...context.draft,
              patches: context.draft.patches.filter(
                (patch) => patch.id !== parsed.patchId,
              ),
            },
            summary: `Removed ${parsed.patchId}`,
            progressMade: true,
          };
        },
      },
      {
        name: "add_resume_patch",
        description: "Add one bounded patch when no dedicated tool fits.",
        inputSchema: ResumePatchInputSchema,
        parameters: jsonObject(
          { patch: { type: "object", additionalProperties: true } },
          ["patch"],
        ),
        permission: "draft_write",
        execute(toolInput, context) {
          const parsed = ResumePatchInputSchema.parse(toolInput);
          const patch: ResumeDraftPatch = {
            ...parsed.patch,
            draftId: context.state.draft.id,
            origin: "assistant",
          };
          const missing = describeMissingPatchFields(patch);
          if (missing) {
            throw new Error(missing);
          }
          return {
            draft: {
              ...context.draft,
              patches: withResumeEditPatch(context.draft.patches, patch),
            },
            summary: `Added one résumé patch (${patch.id})`,
            progressMade: true,
          };
        },
      },
      {
        name: "validate_resume_draft",
        description:
          "Check your proposed changes: the reply shape, whether each change applies, and the approval check over the draft they would produce. Returns each flagged line with what happens if accepted and what to do.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        async execute(_toolInput, context) {
          const parsed = ResumeAssistantReplySchema.safeParse(context.draft);
          if (!parsed.success) {
            return {
              summary: "Résumé proposal needs repair",
              validationIssues: zodIssues(parsed.error),
            };
          }
          if (context.draft.patches.length === 0) {
            // An empty check passed, and the model told the person a line
            // already under Lines to confirm had "nothing to flag".
            return {
              summary:
                "No proposed changes, so nothing was checked. This says nothing about lines already on the resume: their status is in validationIssues from read_resume_context.",
              value: { proposedChanges: 0 },
            };
          }
          const verdict = await runCheck(context.draft.patches);
          return {
            summary: verdict.needsRepair
              ? verdict.stallWarning
                ? `The approval check flagged changes. ${verdict.stallWarning}`
                : "The approval check flagged changes that need repair"
              : "Résumé proposal passes the approval check",
            value: verdict.value,
            validationIssues: verdict.issues,
          };
        },
      },
      {
        name: "finish_task",
        description:
          "Finish once validate_resume_draft has checked your final changes.",
        inputSchema: EmptyInputSchema,
        parameters: jsonObject({}),
        permission: "read",
        async execute(_toolInput, context) {
          const signature = resumeEditPatchSignature(context.draft.patches);
          if (
            context.draft.patches.length > 0 &&
            signature !== lastCheckedSignature &&
            gateRefusals < RESUME_EDIT_GATE_REFUSAL_LIMIT
          ) {
            const verdict = await runCheck(context.draft.patches);
            if (verdict.needsRepair) {
              gateRefusals += 1;
              return {
                summary:
                  "Not finished: the approval check flagged your changes. Repair them, or keep them on purpose and say why in the response, then finish again.",
                value: verdict.value,
                validationIssues: verdict.issues,
              };
            }
          }
          return { summary: "Finish requested", finish: true };
        },
      },
    ],
    validate: (draft) => {
      const parsed = ResumeAssistantReplySchema.safeParse(draft);
      return parsed.success ? [] : zodIssues(parsed.error);
    },
    buildContext: ({ state, draft, validationIssues }) =>
      compactOpenAiCompatibleUserPayload({
        operation: "reviseResumeDraft",
        modelContextWindowTokens: 196_000,
        systemPrompt: "Guided résumé edit tool task",
        userPayload: jsonSafe({
          ...readableContext(state),
          priorValidationIssues: state.validationIssues,
          currentProposal: draft,
          validationIssues,
        }),
      }),
    // A few tool turns plus one or two repairs after the approval check;
    // each turn has its own timeout, this bounds the whole request.
    timeBudgetMs: editBudgetMs,
    noProgressLimit: 4,
  });

  const keptCleanPatches: ResumeDraftPatch[] | null = lastCleanPatches;
  if (
    result.receipt.stopReason !== "completed" &&
    keptCleanPatches !== null &&
    resumeEditPatchSignature(result.draft.patches) !==
      resumeEditPatchSignature(keptCleanPatches)
  ) {
    return ResumeAssistantReplySchema.parse({
      content:
        "I stopped before I finished rewording. These changes passed the approval check; the rest are left out because your saved evidence does not back them.",
      patches: keptCleanPatches,
      executionReceipt: result.receipt,
    });
  }

  return ResumeAssistantReplySchema.parse({
    ...result.draft,
    executionReceipt: result.receipt,
  });
}
