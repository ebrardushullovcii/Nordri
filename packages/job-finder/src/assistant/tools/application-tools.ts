import {
  ApplicationAnswerValueSchema,
  ApplicationCrmMutationSchema,
  ApplicationCrmStageSchema,
  ApplicationOutcomeSchema,
  AssistantGrantActionSchema,
  NonEmptyStringSchema,
  applicationCrmStageValues,
  type ApplicationAutomationMode,
  type AssistantInstructionGrant,
  type JobFinderWorkspaceSnapshot,
} from "@unemployed/contracts";
import { z } from "zod";

import type { JobFinderWorkspaceService } from "../../internal/workspace-service-contracts";
import { checkGrantTargets, decideUnderGrants, narrowGrant } from "../grants";
import { AssistantToolError, defineTool, json } from "../tool-kit";
import {
  applicationRowsPart,
  compactApplication,
  createJobCaveats,
  findJob,
  pausedByPersonMessage,
  plural,
} from "./format";

const Id = NonEmptyStringSchema.max(200);

export const recordInstructionTool = defineTool({
  name: "record_instruction",
  group: "applications",
  description:
    "Records what the person's own message authorizes for applications before you start any: prepare (fill in and stop; they send), prepare_and_send (they wrote that the applications should be sent), or apply_saved_mode (they said apply and nothing about sending). Name the jobs by id or by a result set and positions. The jobs are frozen: jobs that arrive later are not added. Quote their words in 'quote'.",
  parameters: json.object(
    {
      action: json.enumOf(["prepare", "prepare_and_send", "apply_saved_mode"]),
      jobIds: json.ids(),
      resultSetId: json.string(),
      positions: json.array(
        json.number(),
        "1-based positions in the result set; omit for all of it.",
      ),
      quote: json.string("The person's words that authorize this."),
      constraints: json.array(
        json.string(),
        "Limits they stated, such as 'skip anything asking for a cover letter'.",
      ),
      resumePolicy: json.string(),
      answerPolicy: json.string(),
    },
    ["action", "quote"],
  ),
  input: z.object({
    action: AssistantGrantActionSchema,
    jobIds: z.array(Id).max(100).default([]),
    resultSetId: Id.optional(),
    positions: z.array(z.number().int().min(1)).max(100).optional(),
    quote: z.string().trim().min(1).max(1_000),
    constraints: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
    resumePolicy: z.string().max(400).optional(),
    answerPolicy: z.string().max(1_000).optional(),
  }),
  label: () => "Recording your instruction",
  effect: "local_write",
  async execute(input, { service, session }) {
    const authorizing = session.sourceMessage;
    if (
      !authorizing ||
      authorizing.origin !== "sidebar" ||
      authorizing.role !== "user"
    ) {
      throw new AssistantToolError(
        "refused",
        "Only a message the person typed in this sidebar can authorize applications. Ask them.",
      );
    }
    let requested = [...input.jobIds];
    if (input.resultSetId) {
      const resultSet = await session.getResultSet(input.resultSetId);
      if (!resultSet)
        throw new AssistantToolError(
          "not_found",
          "No result set with that id.",
        );
      const picked = input.positions?.length
        ? input.positions
            .map((position) => resultSet.itemIds[position - 1])
            .filter((id): id is string => Boolean(id))
        : resultSet.itemIds;
      requested.push(...picked);
    }
    requested = [...new Set(requested)];
    if (requested.length === 0) {
      throw new AssistantToolError(
        "missing_information",
        "Name the jobs the instruction covers.",
      );
    }
    const snapshot = await service.getWorkspaceSnapshot();
    const check = checkGrantTargets({
      requestedJobIds: requested,
      authorizingMessage: authorizing,
      resultSets: await session.listResultSets(),
      jobIdForApplication: (id) =>
        snapshot.applicationRecords.find((record) => record.id === id)?.jobId ??
        null,
    });
    if (check.accepted.length === 0) {
      throw new AssistantToolError(
        "refused",
        "None of those jobs came from the person's message, the screen it was sent from, or a list shown in this conversation.",
        { rejected: check.rejected },
      );
    }
    const now = session.now();
    const grant: AssistantInstructionGrant = {
      id: session.createId("assistant_grant"),
      conversationId: session.conversationId,
      sourceMessageId: authorizing.id,
      action: input.action,
      jobIds: check.accepted.slice(0, 100),
      resumePolicy: input.resumePolicy ?? null,
      answerPolicy: input.answerPolicy ?? null,
      constraints: input.constraints,
      status: "active",
      history: [
        {
          at: now,
          messageId: authorizing.id,
          change: `Recorded: "${input.quote.slice(0, 300)}"`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await session.grants.save(grant);
    return {
      summary: `Recorded: ${input.action.replaceAll("_", " ")} for ${plural(grant.jobIds.length, "job")}.${check.rejected.length ? ` Left out ${check.rejected.length} not named by the person.` : ""}`,
      data: {
        grantId: grant.id,
        jobIds: grant.jobIds,
        rejected: check.rejected,
      },
    };
  },
});

export const updateInstructionTool = defineTool({
  name: "update_instruction",
  group: "applications",
  description:
    "Narrows or withdraws a recorded instruction when the person corrects it ('skip the second one', 'don't send yet'): remove jobs, weaken the action to prepare, or revoke it. It never widens one; a wider instruction is a new record_instruction from a new message.",
  parameters: json.object(
    {
      grantId: json.string(),
      removeJobIds: json.ids(),
      action: json.enumOf(["prepare", "apply_saved_mode"]),
      revoke: json.boolean(),
      quote: json.string("The person's words."),
    },
    ["grantId", "quote"],
  ),
  input: z.object({
    grantId: Id,
    removeJobIds: z.array(Id).max(100).default([]),
    action: z.enum(["prepare", "apply_saved_mode"]).optional(),
    revoke: z.boolean().default(false),
    quote: z.string().trim().min(1).max(1_000),
  }),
  label: () => "Updating your instruction",
  effect: "local_write",
  async execute(input, { session }) {
    const message = session.sourceMessage;
    if (!message || message.origin !== "sidebar") {
      throw new AssistantToolError(
        "refused",
        "Only the person's own message can change an instruction.",
      );
    }
    const grant = (await session.grants.list()).find(
      (entry) => entry.id === input.grantId,
    );
    if (!grant)
      throw new AssistantToolError("not_found", "No instruction with that id.");
    const next = narrowGrant(grant, {
      removeJobIds: input.removeJobIds,
      ...(input.action ? { action: input.action } : {}),
      revoke: input.revoke,
      messageId: message.id,
      description: `"${input.quote.slice(0, 300)}"`,
      at: session.now(),
    });
    await session.grants.save(next);
    return {
      summary: `Instruction ${next.status}: ${next.action.replaceAll("_", " ")} for ${plural(next.jobIds.length, "job")}.`,
      data: {
        grantId: next.id,
        status: next.status,
        jobIds: next.jobIds,
        action: next.action,
      },
    };
  },
});

export const listInstructionsTool = defineTool({
  name: "list_instructions",
  group: "applications",
  description:
    "Lists the instructions recorded in this conversation and what each covers.",
  parameters: json.object({}),
  input: z.object({}).passthrough(),
  label: () => "Reading your instructions",
  effect: "read",
  async execute(_input, { session }) {
    const grants = await session.grants.list();
    return {
      summary: `${plural(grants.length, "instruction")}.`,
      data: grants.map((grant) => ({
        id: grant.id,
        action: grant.action,
        status: grant.status,
        jobIds: grant.jobIds,
        constraints: grant.constraints,
        history: grant.history.slice(-5),
      })),
    };
  },
});

export const applyToJobsTool = defineTool({
  name: "apply_to_jobs",
  group: "applications",
  description:
    "Starts applications for jobs covered by a recorded instruction, as Apply to all does: resumes are built and approved the way Apply does it, and each batch runs in the mode the instruction allows (prepare only, send, or the saved mode). It runs in the background; the conversation continues when it ends. Jobs without a covering instruction are refused and named. Jobs from an excluded employer, or the same posting as one already applied to, are held back unless evenIfExcludedOrApplied is set because the person asked for them knowing it.",
  parameters: json.object(
    { jobIds: json.ids(), evenIfExcludedOrApplied: json.boolean() },
    ["jobIds"],
  ),
  input: z.object({
    jobIds: z.array(Id).min(1).max(50),
    evenIfExcludedOrApplied: z.boolean().default(false),
  }),
  label: (input) =>
    `Starting ${plural(Array.isArray(input.jobIds) ? input.jobIds.length : 1, "application")}`,
  effect: "external",
  async execute(input, { service, session, ports }) {
    const snapshot = await service.getWorkspaceSnapshot();
    const paused = pausedByPersonMessage(
      snapshot.activityControl,
      "applications",
    );
    if (paused) throw new AssistantToolError("refused", paused);
    const savedMode: ApplicationAutomationMode =
      snapshot.settings.applicationAutomationMode ?? "prepare_only";
    const caveatsFor = createJobCaveats(snapshot);
    const cautioned: { jobId: string; reason: string }[] = [];
    const candidates = [...new Set(input.jobIds)].filter((jobId) => {
      // One application per job: never start a second run while one is
      // still open for it.
      const inFlight = openApplicationFor(snapshot, jobId);
      if (inFlight) {
        cautioned.push({
          jobId,
          reason:
            inFlight.jobState === "awaiting_review"
              ? `This application is already prepared and waiting (run ${inFlight.runId}). Answer its Needs you step with resolve_needs_you, or send it with send_applications; a new run would only pile up behind it.`
              : `This application is already in progress (run ${inFlight.runId}, ${inFlight.runState.replaceAll("_", " ")}, job ${inFlight.jobState.replaceAll("_", " ")}). Let it finish, or stop it with cancel_applications first.`,
        });
        return false;
      }
      const job = findJob(snapshot, jobId);
      if (!job || input.evenIfExcludedOrApplied) return true;
      const caveats = caveatsFor(job);
      if (caveats.excludedEmployer) {
        cautioned.push({
          jobId,
          reason: `The person excluded ${job.company}.`,
        });
        return false;
      }
      if (
        caveats.alreadyAppliedAs &&
        caveats.alreadyAppliedAs.jobId !== jobId
      ) {
        cautioned.push({
          jobId,
          reason: `Same posting as job ${caveats.alreadyAppliedAs.jobId}, already applied (${caveats.alreadyAppliedAs.status}).`,
        });
        return false;
      }
      return true;
    });
    if (candidates.length === 0) {
      throw new AssistantToolError(
        "refused",
        cautioned.map((entry) => `${entry.jobId}: ${entry.reason}`).join(" "),
      );
    }
    const decisions = decideUnderGrants({
      grants: await session.grants.list(),
      jobIds: candidates,
      action: "prepare",
      savedMode,
    });
    const refused = decisions.filter((decision) => !decision.allowed);
    const byMode = new Map<ApplicationAutomationMode, string[]>();
    for (const decision of decisions) {
      if (!decision.allowed || !decision.mode) continue;
      byMode.set(decision.mode, [
        ...(byMode.get(decision.mode) ?? []),
        decision.jobId,
      ]);
    }
    if (byMode.size === 0) {
      throw new AssistantToolError(
        "refused",
        refused
          .map((decision) => `${decision.jobId}: ${decision.reason}`)
          .join(" "),
      );
    }
    const started: string[] = [];
    const heldBack: { jobId: string; reason: string }[] = [...cautioned];
    const runIds: string[] = [];
    for (const [mode, jobIds] of byMode) {
      session.assertCurrent();
      const result = await ports.startApplications({ jobIds, mode });
      started.push(...result.startedJobIds);
      heldBack.push(
        ...result.heldBack.map(({ jobId, reason }) => ({ jobId, reason })),
      );
      if (result.runId) {
        runIds.push(result.runId);
        await session.watchRun(
          {
            kind: "apply_batch",
            id: result.runId,
            jobIds: result.startedJobIds,
          },
          `Applying to ${plural(result.startedJobIds.length, "job")}`,
        );
      }
    }
    ports.publishWorkspaceUpdate();
    return {
      summary: `Started ${plural(started.length, "application")}${heldBack.length ? `; held back ${heldBack.length}` : ""}${refused.length ? `; refused ${refused.length}` : ""}. The conversation continues when the batch ends.`,
      data: {
        runIds,
        started,
        heldBack,
        refused: refused.map(({ jobId, reason }) => ({ jobId, reason })),
        modes: Object.fromEntries(byMode),
      },
    };
  },
});

export const sendApplicationsTool = defineTool({
  name: "send_applications",
  group: "applications",
  description:
    "Sends applications already filled in and waiting, one after another through the send path (preflight, daily limit, one send at a time). Only jobs whose recorded instruction says to send; a prepare-only instruction blocks it. The saved default apply mode does not matter here: the person's send instruction is the permission, so never change settings to send. An application counts as sent only when the employer's page confirms it.",
  parameters: json.object({ jobIds: json.ids() }, ["jobIds"]),
  input: z.object({ jobIds: z.array(Id).min(1).max(50) }),
  label: (input) =>
    `Sending ${plural(Array.isArray(input.jobIds) ? input.jobIds.length : 1, "application")}`,
  effect: "external",
  async execute(input, { service, session, ports }) {
    const snapshot = await service.getWorkspaceSnapshot();
    const decisions = decideUnderGrants({
      grants: await session.grants.list(),
      jobIds: [...new Set(input.jobIds)],
      action: "send",
      savedMode: snapshot.settings.applicationAutomationMode ?? "prepare_only",
    });
    const allowed = decisions
      .filter((decision) => decision.allowed)
      .map((decision) => decision.jobId);
    const refused = decisions.filter((decision) => !decision.allowed);
    if (allowed.length === 0) {
      throw new AssistantToolError(
        "refused",
        refused
          .map((decision) => `${decision.jobId}: ${decision.reason}`)
          .join(" "),
      );
    }
    session.assertCurrent();
    const result = await ports.sendPreparedApplications({ jobIds: allowed });
    ports.publishWorkspaceUpdate();
    const after = await service.getWorkspaceSnapshot();
    const records = after.applicationRecords.filter((record) =>
      [
        ...result.sentJobIds,
        ...result.failed.map((entry) => entry.jobId),
      ].includes(record.jobId),
    );
    return {
      summary: `Sent ${plural(result.sentJobIds.length, "application")}${result.failed.length ? `, ${result.failed.length} not sent` : ""}${refused.length ? `, ${refused.length} refused` : ""}.`,
      data: {
        sent: result.sentJobIds,
        failed: result.failed,
        refused: refused.map(({ jobId, reason }) => ({ jobId, reason })),
        records: records.map(compactApplication),
      },
      parts: records.length
        ? [applicationRowsPart({ records, title: "Sent" })]
        : [],
    };
  },
});

export const listApplicationsTool = defineTool({
  name: "list_applications",
  group: "applications",
  description:
    "Lists applications with their state, next step, blocker and tracking stage, filtered by words, status or stage.",
  parameters: json.object({
    text: json.string(),
    status: json.string(
      "Such as ready_for_review, submitted, interview, rejected.",
    ),
    stage: json.enumOf(applicationCrmStageValues),
    needsAttention: json.boolean("Only ones blocked or waiting on the person."),
    limit: json.number(),
  }),
  input: z.object({
    text: z.string().trim().max(200).optional(),
    status: z.string().trim().max(60).optional(),
    stage: ApplicationCrmStageSchema.optional(),
    needsAttention: z.boolean().default(false),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  label: () => "Reading your applications",
  effect: "read",
  async execute(input, { service, session }) {
    const snapshot = await service.getWorkspaceSnapshot();
    const words = (input.text ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean);
    const records = snapshot.applicationRecords
      .filter((record) => !input.status || record.status === input.status)
      .filter((record) => !input.stage || record.crm?.stage === input.stage)
      .filter(
        (record) =>
          !input.needsAttention ||
          record.latestBlocker !== null ||
          record.lastAttemptState === "paused",
      )
      .filter((record) => {
        const haystack = `${record.title} ${record.company}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort((left, right) =>
        right.lastUpdatedAt.localeCompare(left.lastUpdatedAt),
      );
    const resultSet = await session.createResultSet({
      kind: "applications",
      label: "Applications",
      itemIds: records.map((record) => record.id),
      source: "tool_query",
    });
    const shown = records.slice(0, input.limit);
    return {
      summary: `${plural(records.length, "application")} (result set ${resultSet.id}).`,
      data: {
        resultSetId: resultSet.id,
        applications: shown.map(compactApplication),
      },
      parts: shown.length
        ? [
            applicationRowsPart({
              records: shown,
              title: null,
              resultSetId: resultSet.id,
            }),
          ]
        : [],
    };
  },
});

/** Needs you steps that are still open for an application. */
const OPEN_STEP_STATES = new Set([
  "pending",
  "page_opened",
  "awaiting_user",
  "verifying",
  "still_blocked",
]);

const OPEN_RUN_STATES = new Set([
  "draft",
  "awaiting_submit_approval",
  "running",
  "paused_for_user_review",
  "paused_for_consent",
]);

/**
 * The application already in progress for a job, if any: a run that has not
 * ended and whose result for this job has not ended either. A second run for
 * the same job only piles up behind it (and on one site, blocks the rest).
 */
export function openApplicationFor(
  snapshot: JobFinderWorkspaceSnapshot,
  jobId: string,
): { runId: string; runState: string; jobState: string } | null {
  const runsById = new Map(snapshot.applyRuns.map((run) => [run.id, run]));
  const open = snapshot.applyJobResults
    .filter((result) => result.jobId === jobId)
    .filter((result) => {
      const run = runsById.get(result.runId);
      return (
        run !== undefined &&
        OPEN_RUN_STATES.has(run.state) &&
        !["submitted", "failed", "skipped"].includes(result.state)
      );
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (!open) return null;
  return {
    runId: open.runId,
    runState: runsById.get(open.runId)!.state,
    jobState: open.state,
  };
}

async function latestRunFor(service: JobFinderWorkspaceService, jobId: string) {
  const snapshot = await service.getWorkspaceSnapshot();
  const result = snapshot.applyJobResults
    .filter((entry) => entry.jobId === jobId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const record =
    snapshot.applicationRecords.find((entry) => entry.jobId === jobId) ?? null;
  return { snapshot, result: result ?? null, record };
}

export const getApplicationTool = defineTool({
  name: "get_application",
  group: "applications",
  description:
    "Reads one application by job id: its state, the questions the form asked and the answers given, what blocks it, and tracking.",
  parameters: json.object({ jobId: json.string() }, ["jobId"]),
  input: z.object({ jobId: Id }),
  label: () => "Reading the application",
  effect: "read",
  async execute(input, { service }) {
    const { result, record, snapshot } = await latestRunFor(
      service,
      input.jobId,
    );
    if (!result && !record) {
      throw new AssistantToolError(
        "not_found",
        "This job has no application yet.",
      );
    }
    const details = result
      ? await service.getApplyRunDetails(
          result.runId,
          input.jobId,
          record?.id ?? null,
        )
      : null;
    const steps = (snapshot.userActionRequests ?? [])
      .filter(
        (request) =>
          request.scope.type === "application" &&
          request.scope.jobId === input.jobId &&
          OPEN_STEP_STATES.has(request.state),
      )
      .slice(0, 10);
    const verifying = steps.some((step) => step.state === "verifying");
    return {
      summary: [
        record
          ? `${record.title} at ${record.company}: ${record.lastActionLabel}.`
          : `Application in state ${result?.state}.`,
        verifying
          ? "An answer given for this application is being put on the form now (its Needs you step is verifying). It is not waiting on the person; question rows update when that finishes."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        record: record ? compactApplication(record) : null,
        needsYouSteps: steps.map((step) => ({
          id: step.id,
          title: step.title,
          state: step.state,
        })),
        run: result
          ? { runId: result.runId, resultId: result.id, state: result.state }
          : null,
        questions: (details?.questionRecords ?? [])
          .slice(0, 30)
          .map((question) => ({
            id: question.id,
            prompt: question.prompt,
            kind: question.kind,
            required: question.isRequired,
            options: question.answerOptions.slice(0, 20),
            status: question.status,
            answer: question.submittedAnswer,
          })),
        answers: (details?.answerRecords ?? []).slice(0, 30).map((answer) => ({
          questionId: answer.questionId,
          text: answer.text,
          revision: answer.revision,
          status: answer.status,
        })),
        // Files the form was given: the review card the run wrote, and any
        // uploaded-file records, so "was it attached?" has an answer.
        attachedFiles: [
          ...(details?.reviewCard?.attachments ?? []).map((attachment) => ({
            fileName: attachment.fileName,
            field: attachment.label,
          })),
          ...(details?.artifactRefs ?? [])
            .filter((artifact) => artifact.kind === "uploaded_asset")
            .map((artifact) => ({ fileName: artifact.label, field: null })),
        ].slice(0, 20),
        blocker: record?.latestBlocker ?? null,
        tracking: record?.crm
          ? {
              stage: record.crm.stage,
              revision: record.crm.revision,
              reminders: record.crm.reminders.slice(0, 5),
              notes: record.crm.notes.slice(-5),
            }
          : null,
      },
    };
  },
});

export const answerApplicationQuestionTool = defineTool({
  name: "answer_application_question",
  group: "applications",
  description:
    "Saves the person's answer to one question an application asked (from get_application), for this application or also for later ones (saveForLater). Use their words; never make up personal facts. When the question is also a Needs you step (list_needs_you), answer it with resolve_needs_you instead: that is what continues the paused application.",
  parameters: json.object(
    {
      jobId: json.string(),
      questionId: json.string(),
      answer: json.looseObject(
        "{type:'text',value} | {type:'single_choice',value} | {type:'multi_choice',values} | {type:'boolean',value} | {type:'date',value}",
      ),
      saveForLater: json.boolean(),
    },
    ["jobId", "questionId", "answer"],
  ),
  input: z.object({
    jobId: Id,
    questionId: Id,
    answer: ApplicationAnswerValueSchema,
    saveForLater: z.boolean().default(false),
  }),
  label: () => "Saving your answer",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const { result, record } = await latestRunFor(service, input.jobId);
    if (!result)
      throw new AssistantToolError(
        "not_found",
        "This job has no application run.",
      );
    const details = await service.getApplyRunDetails(
      result.runId,
      input.jobId,
      record?.id ?? null,
    );
    const current = details.answerRecords
      .filter((answer) => answer.questionId === input.questionId)
      .sort((left, right) => right.revision - left.revision)[0];
    session.assertCurrent();
    await service.saveApplicationAnswer({
      commandId: session.createId("assistant_answer"),
      runId: result.runId,
      jobId: input.jobId,
      resultId: result.id,
      questionId: input.questionId,
      expectedAnswerRevision: current?.revision ?? 0,
      value: input.answer,
      saveScope: input.saveForLater ? "reusable_profile" : "application_once",
      submitAuthorized: false,
      accountCreationAuthorized: false,
    });
    ports.publishWorkspaceUpdate();
    return { summary: "Answer saved." };
  },
});

export const continueApplicationTool = defineTool({
  name: "continue_application",
  group: "applications",
  description:
    "Tries a stopped or failed application again, or opens its kept page for the person (openPage). Retrying needs a covering instruction like any start. An application paused on a Needs you step is not retried: it continues when that step is answered or marked done with resolve_needs_you.",
  parameters: json.object({ jobId: json.string(), openPage: json.boolean() }, [
    "jobId",
  ]),
  input: z.object({ jobId: Id, openPage: z.boolean().default(false) }),
  label: (input) =>
    input.openPage
      ? "Opening the application page"
      : "Trying the application again",
  effect: "external",
  async execute(input, context) {
    const { service, session, ports } = context;
    const { result, record } = await latestRunFor(service, input.jobId);
    if (input.openPage) {
      if (!result || !record)
        throw new AssistantToolError("not_found", "No kept page for this job.");
      await service.focusPreparedApplicationPage({
        runId: result.runId,
        jobId: input.jobId,
        resultId: result.id,
        applicationRecordId: record.id,
      });
      return { summary: "The application page is open in the browser." };
    }
    const outcome = await applyToJobsTool.execute(
      { jobIds: [input.jobId], evenIfExcludedOrApplied: true },
      context,
    );
    void ports;
    void session;
    return outcome;
  },
});

export const cancelApplicationsTool = defineTool({
  name: "cancel_applications",
  group: "applications",
  description:
    "Stops a running application batch by its run id; work already sent stays sent. Name in skippedJobIds the jobs the person asked to skip, so they read as skipped, not as failed.",
  parameters: json.object({ runId: json.string(), skippedJobIds: json.ids() }, [
    "runId",
  ]),
  input: z.object({
    runId: Id,
    skippedJobIds: z.array(Id).max(100).default([]),
  }),
  label: () => "Stopping the applications",
  effect: "local_write",
  async execute(input, { service, ports }) {
    await service.cancelApplyRun(input.runId, {
      skippedByPerson: input.skippedJobIds,
    });
    ports.publishWorkspaceUpdate();
    return {
      summary: `Stopped the batch.${input.skippedJobIds.length > 0 ? ` Marked as skipped at the person's request: ${input.skippedJobIds.join(", ")}.` : ""}`,
    };
  },
});

export const updateTrackingTool = defineTool({
  name: "update_tracking",
  group: "tracking",
  description:
    "Changes one application's tracking: set_stage, add_note, upsert_reminder (with a dueAt date), set_tags, upsert_interview, set_compensation and their removals. The revision comes from get_application. A tracking stage never counts as sending anything.",
  parameters: json.object(
    {
      applicationRecordId: json.string(),
      revision: json.number(),
      mutation: json.looseObject(
        "{type:'set_stage',stage,note?} | {type:'add_note',note:{id,body,createdAt,updatedAt}} | {type:'upsert_reminder',reminder:{id,dueAt,note,...}} | ...",
      ),
    },
    ["applicationRecordId", "revision", "mutation"],
  ),
  input: z.object({
    applicationRecordId: Id,
    revision: z.number().int().nonnegative(),
    mutation: ApplicationCrmMutationSchema,
  }),
  label: () => "Updating application tracking",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    session.assertCurrent();
    await service.mutateApplicationCrm({
      applicationRecordId: input.applicationRecordId,
      expectedRevision: input.revision,
      mutation: input.mutation,
      actor: "assistant",
    });
    ports.publishWorkspaceUpdate();
    return {
      summary: `Tracking updated (${input.mutation.type.replaceAll("_", " ")}).`,
    };
  },
});

export const setStageForManyTool = defineTool({
  name: "set_stage_for_applications",
  group: "tracking",
  description: "Moves several applications to one tracking stage at once.",
  parameters: json.object(
    {
      applicationRecordIds: json.ids(),
      stage: json.enumOf(applicationCrmStageValues),
      note: json.string(),
    },
    ["applicationRecordIds", "stage"],
  ),
  input: z.object({
    applicationRecordIds: z.array(Id).min(1).max(500),
    stage: ApplicationCrmStageSchema,
    note: z.string().trim().min(1).max(1_000).optional(),
  }),
  label: () => "Updating application stages",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    const snapshot = await service.getWorkspaceSnapshot();
    const items = input.applicationRecordIds.map((id) => {
      const record = snapshot.applicationRecords.find(
        (entry) => entry.id === id,
      );
      if (!record)
        throw new AssistantToolError("not_found", `No application ${id}.`);
      return {
        applicationRecordId: id,
        expectedRevision: record.crm?.revision ?? 0,
      };
    });
    session.assertCurrent();
    await service.mutateApplicationCrmBulkStage({
      items,
      stage: input.stage,
      customStageId: null,
      note: input.note ?? null,
      actor: "assistant",
    });
    ports.publishWorkspaceUpdate();
    return {
      summary: `Moved ${plural(items.length, "application")} to ${input.stage}.`,
    };
  },
});

export const recordOutcomeTool = defineTool({
  name: "record_outcome",
  group: "tracking",
  description:
    "Records what happened with an application (interview, offer, rejection, no response...), as the person reported it.",
  parameters: json.object(
    {
      jobId: json.string(),
      outcome: json.string(
        "An outcome value such as interview, offer, rejected.",
      ),
      note: json.string(),
    },
    ["jobId", "outcome"],
  ),
  input: z.object({
    jobId: Id,
    outcome: ApplicationOutcomeSchema,
    note: z.string().trim().min(1).max(2_000).optional(),
  }),
  label: () => "Recording the outcome",
  effect: "local_write",
  async execute(input, { service, session, ports }) {
    session.assertCurrent();
    await service.recordOutcome({
      jobId: input.jobId,
      outcome: input.outcome,
      resumeStrategyId: null,
      note: input.note ?? null,
    });
    ports.publishWorkspaceUpdate();
    return { summary: "Outcome recorded." };
  },
});

export const exportTrackerTool = defineTool({
  name: "export_tracker",
  group: "tracking",
  description:
    "Exports every application in the tracker as CSV or JSON to a file and returns the file's exact path. Nothing else is needed from the person. Tell them the path the result gives; never guess the folder.",
  parameters: json.object({ format: json.enumOf(["csv", "json"]) }),
  input: z.object({ format: z.enum(["csv", "json"]).default("csv") }),
  label: () => "Exporting the tracker",
  effect: "local_write",
  async execute(input, { ports }) {
    if (!ports.exportTracker) {
      throw new AssistantToolError(
        "refused",
        "Exporting is not available here.",
      );
    }
    const path = await ports.exportTracker(input.format);
    return {
      summary: path
        ? `Exported the tracker to ${path}. Give the person this exact path; do not name a folder in other words.`
        : "Nothing was exported.",
      data: { saved: Boolean(path), path },
    };
  },
});

export const applicationTools = [
  recordInstructionTool,
  updateInstructionTool,
  listInstructionsTool,
  applyToJobsTool,
  sendApplicationsTool,
  listApplicationsTool,
  getApplicationTool,
  answerApplicationQuestionTool,
  continueApplicationTool,
  cancelApplicationsTool,
];

export const trackingTools = [
  updateTrackingTool,
  setStageForManyTool,
  recordOutcomeTool,
  exportTrackerTool,
];
