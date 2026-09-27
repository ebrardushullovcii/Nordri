import {
  ApplicationAnswerRecordSchema,
  ApplicationQuestionRecordSchema,
  ApplicationRecordSchema,
  ApplyJobResultSchema,
  ApplyRunSchema,
  UserActionEventSchema,
  UserActionRequestSchema,
  type ApplicationAnswerRecord,
  type ApplicationQuestionRecord,
  type UserActionRequest,
} from "@unemployed/contracts";
import { describe, expect, test } from "vitest";

import {
  createSeed,
  createWorkspaceServiceHarness,
} from "./workspace-service.test-support";

const now = "2026-08-15T10:00:00.000Z";
const later = "2026-08-15T11:00:00.000Z";

function createManualAnswerRequest(
  overrides: Partial<UserActionRequest> = {},
): UserActionRequest {
  return UserActionRequestSchema.parse({
    id: "request_a",
    dedupeKey: "dedupe_request_a",
    revision: 1,
    kind: "manual_answer",
    state: "pending",
    requirement: "required",
    scope: {
      type: "application",
      runId: "run_manual",
      jobId: "job_ready",
      applicationRecordId: "application_a",
      resultId: "result_a",
      replayCheckpointId: null,
      source: "target_site",
    },
    verification: {
      type: "page_blocker_absent",
      blockerFingerprint: "blocker_request_a",
      expectedPageFingerprint: null,
    },
    title: "Answer the required question",
    summary: "A safe manual answer is required.",
    instructions: [],
    actionUrl: null,
    displayOrigin: null,
    credentialsPolicy: "browser_only",
    submitAuthorized: false,
    accountCreationAuthorized: false,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    openedAt: null,
    resolvedAt: null,
    expiresAt: null,
    ...overrides,
  });
}

function createQuestion(): ApplicationQuestionRecord {
  return ApplicationQuestionRecordSchema.parse({
    id: "question_a",
    runId: "run_manual",
    jobId: "job_ready",
    applicationRecordId: "application_a",
    resultId: "result_a",
    prompt: "Years of experience",
    kind: "experience",
    answerControlType: "text",
    isRequired: true,
    detectedAt: now,
    answerOptions: [],
    suggestedAnswers: [],
    selectedAnswerId: null,
    submittedAnswer: null,
    status: "detected",
    pageUrl: null,
    visualContext: null,
  });
}

function createAnswer(input: {
  id: string;
  questionId?: string;
  revision?: number;
  supersedesAnswerId?: string | null;
  text?: string;
  createdAt?: string;
  applicationRecordId?: string | null;
}): ApplicationAnswerRecord {
  return ApplicationAnswerRecordSchema.parse({
    id: input.id,
    runId: "run_manual",
    jobId: "job_ready",
    applicationRecordId: input.applicationRecordId ?? "application_a",
    resultId: "result_a",
    questionId: input.questionId ?? "question_a",
    status: "suggested",
    text: input.text ?? "5 years",
    value: { type: "text", value: input.text ?? "5 years" },
    revision: input.revision ?? 1,
    saveScope: "application_once",
    supersedesAnswerId: input.supersedesAnswerId ?? null,
    sourceKind: "user",
    sourceId: null,
    confidenceLabel: null,
    provenance: [],
    createdAt: input.createdAt ?? now,
    submittedAt: null,
  });
}

function submitManualAnswerCommand(commandId = "command_submit") {
  return {
    action: "submit_manual_answer" as const,
    requestId: "request_a",
    commandId,
    expectedRevision: 1,
    answer: "5 years",
    saveForFuture: false,
    credentialsPolicy: "browser_only" as const,
    submitAuthorized: false as const,
    accountCreationAuthorized: false as const,
  };
}

describe("workspace manual-answer persistence races", () => {
  test("creates a monotonic revision-1 manual answer with no superseded record", async () => {
    const seed = createSeed();
    seed.applicationRecords = [
      ApplicationRecordSchema.parse({
        id: "application_a",
        jobId: "job_ready",
        title: "Senior Product Designer",
        company: "Signal Systems",
        status: "ready_for_review",
        lastActionLabel: "Manual answer needed",
        nextActionLabel: "Review answer",
        lastUpdatedAt: now,
      }),
    ];
    seed.applyRuns = [
      ApplyRunSchema.parse({
        id: "run_manual",
        campaignId: null,
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        summary: "Manual answer needed.",
        detail: "The exact application remains reviewable.",
        totalJobs: 1,
        pendingJobs: 0,
      }),
    ];
    seed.applyJobResults = [
      ApplyJobResultSchema.parse({
        id: "result_a",
        runId: "run_manual",
        jobId: "job_ready",
        applicationRecordId: "application_a",
        state: "blocked",
        summary: "Manual answer needed.",
        detail: "A required question needs review.",
        startedAt: now,
        updatedAt: now,
      }),
    ];
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [createQuestion()];
    const harness = createWorkspaceServiceHarness({ seed });

    const snapshot = await harness.workspaceService.performUserAction(
      submitManualAnswerCommand(),
    );

    expect(snapshot.userActionRequests[0]).toEqual(
      expect.objectContaining({ state: "verifying", revision: 2 }),
    );
    const answers = await harness.repository.listApplicationAnswerRecords();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toEqual(
      expect.objectContaining({
        id: "manual_answer_request_a_2",
        applicationRecordId: "application_a",
        questionId: "question_a",
        revision: 1,
        supersedesAnswerId: null,
        status: "suggested",
        submittedAt: null,
        text: "5 years",
      }),
    );
    // Prepare-only: the question stays detected and unsubmitted.
    const questions = await harness.repository.listApplicationQuestionRecords();
    expect(questions[0]).toEqual(
      expect.objectContaining({ status: "detected", submittedAnswer: null }),
    );
  });

  test("a bare answer goes to the one question still waiting when earlier ones were already answered", async () => {
    const seed = createSeed();
    seed.applicationRecords = [
      ApplicationRecordSchema.parse({
        id: "application_a",
        jobId: "job_ready",
        title: "Senior Product Designer",
        company: "Signal Systems",
        status: "ready_for_review",
        lastActionLabel: "Manual answer needed",
        nextActionLabel: "Review answer",
        lastUpdatedAt: now,
      }),
    ];
    seed.applyRuns = [
      ApplyRunSchema.parse({
        id: "run_manual",
        campaignId: null,
        state: "completed",
        jobIds: ["job_ready"],
        currentJobId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        summary: "Manual answer needed.",
        detail: "The exact application remains reviewable.",
        totalJobs: 1,
        pendingJobs: 0,
      }),
    ];
    seed.applyJobResults = [
      ApplyJobResultSchema.parse({
        id: "result_a",
        runId: "run_manual",
        jobId: "job_ready",
        applicationRecordId: "application_a",
        state: "blocked",
        summary: "Manual answer needed.",
        detail: "A required question needs review.",
        startedAt: now,
        updatedAt: now,
      }),
    ];
    seed.userActionRequests = [createManualAnswerRequest()];
    // The postal code was answered on an earlier step of this same
    // application; its question record stays detected.
    seed.applicationQuestionRecords = [
      createQuestion(),
      ApplicationQuestionRecordSchema.parse({
        ...createQuestion(),
        id: "question_notice",
        prompt: "What is your notice period?",
        kind: "other",
      }),
    ];
    seed.applicationAnswerRecords = [
      createAnswer({ id: "earlier_answer", questionId: "question_a" }),
    ];
    const harness = createWorkspaceServiceHarness({ seed });

    await harness.workspaceService.performUserAction({
      ...submitManualAnswerCommand(),
      answer: "Two weeks",
    });

    const answers = await harness.repository.listApplicationAnswerRecords();
    expect(
      answers.find((answer) => answer.questionId === "question_notice"),
    ).toEqual(expect.objectContaining({ text: "Two weeks" }));
  });

  test("advances the revision and supersedes the actual latest record for the question", async () => {
    const seed = createSeed();
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [createQuestion()];
    seed.applicationAnswerRecords = [
      createAnswer({
        id: "answer_existing",
        revision: 1,
        supersedesAnswerId: null,
        text: "3 years",
      }),
    ];
    const harness = createWorkspaceServiceHarness({ seed });

    await harness.workspaceService.performUserAction(
      submitManualAnswerCommand(),
    );

    const answers = await harness.repository.listApplicationAnswerRecords();
    const byId = new Map(answers.map((answer) => [answer.id, answer]));
    expect(answers).toHaveLength(2);
    expect(byId.get("manual_answer_request_a_2")).toEqual(
      expect.objectContaining({
        revision: 2,
        supersedesAnswerId: "answer_existing",
        status: "suggested",
        submittedAt: null,
      }),
    );
    expect(byId.get("answer_existing")).toEqual(
      expect.objectContaining({ revision: 1, supersedesAnswerId: null }),
    );
  });

  test("does not read or supersede an answer from a sibling application record", async () => {
    const seed = createSeed();
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [
      createQuestion(),
      ApplicationQuestionRecordSchema.parse({
        ...createQuestion(),
        id: "question_b",
        applicationRecordId: "application_b",
      }),
    ];
    seed.applicationAnswerRecords = [
      createAnswer({
        id: "grouped_answer_sibling_question_b",
        questionId: "question_b",
        revision: 7,
        applicationRecordId: "application_b",
      }),
    ];
    const harness = createWorkspaceServiceHarness({ seed });

    await harness.workspaceService.performUserAction(
      submitManualAnswerCommand(),
    );

    const answers = await harness.repository.listApplicationAnswerRecords();
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manual_answer_request_a_2",
          applicationRecordId: "application_a",
          questionId: "question_a",
          revision: 1,
          supersedesAnswerId: null,
        }),
        expect.objectContaining({
          id: "grouped_answer_sibling_question_b",
          applicationRecordId: "application_b",
          questionId: "question_b",
          revision: 7,
        }),
      ]),
    );
  });

  test("an exact retry of the deterministic record id is idempotent and preserves createdAt", async () => {
    const seed = createSeed();
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [createQuestion()];
    const harness = createWorkspaceServiceHarness({ seed });

    const command = submitManualAnswerCommand("command_retry");
    await harness.workspaceService.performUserAction(command);
    const first = await harness.repository.listApplicationAnswerRecords();
    expect(first).toHaveLength(1);
    const createdAt = first[0]!.createdAt;

    // Re-issuing the exact same command is the reducer-stale retry path; the
    // exact commandId event exists, so the answer is re-persisted idempotently
    // (no new revision, no rewritten createdAt).
    await harness.workspaceService.performUserAction(command);
    const second = await harness.repository.listApplicationAnswerRecords();
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual(
      expect.objectContaining({
        id: "manual_answer_request_a_2",
        revision: 1,
        supersedesAnswerId: null,
        createdAt,
      }),
    );
  });

  test("a same-id conflict throws instead of overwriting", async () => {
    const seed = createSeed();
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [createQuestion()];
    seed.applicationAnswerRecords = [
      createAnswer({
        id: "manual_answer_request_a_2",
        revision: 1,
        supersedesAnswerId: null,
        text: "conflicting answer",
      }),
    ];
    const harness = createWorkspaceServiceHarness({ seed });

    await expect(
      harness.workspaceService.performUserAction(submitManualAnswerCommand()),
    ).rejects.toThrow(/already exists with different data/i);

    // The conflicting record is untouched.
    const answers = await harness.repository.listApplicationAnswerRecords();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toEqual(
      expect.objectContaining({
        id: "manual_answer_request_a_2",
        text: "conflicting answer",
      }),
    );
  });

  test("an answer whose store failed after the step moved on is asked again, never skipped", async () => {
    const seed = createSeed();
    seed.userActionRequests = [
      createManualAnswerRequest({
        scope: {
          type: "application",
          runId: "run_manual",
          jobId: "job_ready",
          applicationRecordId: "application_a",
          resultId: "result_a",
          replayCheckpointId: "checkpoint_a",
          source: "target_site",
        },
      }),
    ];
    seed.applicationQuestionRecords = [createQuestion()];
    const harness = createWorkspaceServiceHarness({ seed });
    const originalUpsert =
      harness.repository.upsertApplicationAnswerRecord.bind(harness.repository);
    let failNext = true;
    harness.repository.upsertApplicationAnswerRecord = async (record) => {
      if (failNext) {
        failNext = false;
        throw new Error("disk full");
      }
      return originalUpsert(record);
    };

    await expect(
      harness.workspaceService.performUserAction(submitManualAnswerCommand()),
    ).rejects.toThrow("disk full");
    // The step committed, the answer did not.
    expect(await harness.repository.getUserActionRequest("request_a")).toEqual(
      expect.objectContaining({ state: "verifying", revision: 2 }),
    );

    // The person presses again: the application must not carry on without
    // the answer; the question comes back to them instead.
    await harness.workspaceService.performUserAction(
      submitManualAnswerCommand("command_submit_again"),
    );
    expect(await harness.repository.getUserActionRequest("request_a")).toEqual(
      expect.objectContaining({ state: "still_blocked" }),
    );
    expect(await harness.repository.listApplicationAttempts()).toEqual([]);
  });

  test("a snapshot taken while the answer is being stored leaves the step alone", async () => {
    const seed = createSeed();
    seed.userActionRequests = [
      createManualAnswerRequest({
        scope: {
          type: "application",
          runId: "run_manual",
          jobId: "job_ready",
          applicationRecordId: "application_a",
          resultId: "result_a",
          replayCheckpointId: "checkpoint_a",
          source: "target_site",
        },
      }),
    ];
    seed.applicationQuestionRecords = [createQuestion()];
    const harness = createWorkspaceServiceHarness({ seed });
    const originalUpsert =
      harness.repository.upsertApplicationAnswerRecord.bind(harness.repository);
    let releaseStore!: () => void;
    const storeGate = new Promise<void>((resolve) => {
      releaseStore = resolve;
    });
    let storeStarted!: () => void;
    const storing = new Promise<void>((resolve) => {
      storeStarted = resolve;
    });
    harness.repository.upsertApplicationAnswerRecord = async (record) => {
      storeStarted();
      await storeGate;
      return originalUpsert(record);
    };

    const answering = harness.workspaceService
      .performUserAction(submitManualAnswerCommand())
      .catch(() => undefined);
    await storing;
    // The step is verifying and its answer is not stored yet.
    await harness.workspaceService.getWorkspaceSnapshot();
    // Read as a lost write, the snapshot used to hand the question back
    // here, before the answer ever landed.
    expect(await harness.repository.getUserActionRequest("request_a")).toEqual(
      expect.objectContaining({ state: "verifying", revision: 2 }),
    );
    expect(
      (
        await harness.repository.listUserActionEvents({
          requestId: "request_a",
        })
      ).map((event) => event.operation),
    ).toEqual(["submit_manual_answer"]);
    releaseStore();
    await answering;

    // The answer's own continuation then checks the step (this harness has
    // no retained page, so it ends there).
    const attempts = await harness.repository.listApplicationAttempts();
    expect(attempts).toHaveLength(1);
    expect(
      await harness.repository.listApplicationAnswerRecords({
        runId: "run_manual",
        jobId: "job_ready",
        resultId: "result_a",
        applicationRecordId: "application_a",
      }),
    ).toHaveLength(1);
  });

  test("a commit race returning stale never persists the answer", async () => {
    const seed = createSeed();
    seed.userActionRequests = [createManualAnswerRequest()];
    seed.applicationQuestionRecords = [createQuestion()];
    const harness = createWorkspaceServiceHarness({ seed });

    // Simulate a concurrent writer advancing the request between the reducer
    // and the caller's commit: the caller's transition then returns stale.
    const originalCommit = harness.repository.commitUserActionTransition.bind(
      harness.repository,
    );
    let advanced = false;
    harness.repository.commitUserActionTransition = async (input) => {
      if (!advanced) {
        advanced = true;
        const current = await harness.repository.getUserActionRequest(
          input.request.id,
        );
        if (current) {
          const advancedRequest = UserActionRequestSchema.parse({
            ...current,
            revision: current.revision + 1,
            state: "page_opened",
            openedAt: current.openedAt ?? later,
            updatedAt: later,
          });
          await originalCommit({
            request: advancedRequest,
            event: UserActionEventSchema.parse({
              id: "race_advance",
              requestId: advancedRequest.id,
              operation: "open_page",
              previousRevision: current.revision,
              resultingRevision: advancedRequest.revision,
              previousState: current.state,
              resultingState: "page_opened",
              occurredAt: later,
            }),
          });
        }
      }
      return originalCommit(input);
    };

    await harness.workspaceService.performUserAction(
      submitManualAnswerCommand(),
    );

    // The reducer saw the current revision, but the commit returned stale, so
    // the answer must not be persisted for this command.
    expect(await harness.repository.listApplicationAnswerRecords()).toEqual([]);
    const request = await harness.repository.getUserActionRequest("request_a");
    expect(request).toEqual(
      expect.objectContaining({ state: "page_opened", revision: 2 }),
    );
    const events = await harness.repository.listUserActionEvents({
      requestId: "request_a",
    });
    expect(events.some((event) => event.id === "command_submit")).toBe(false);
  });

  test("legacy null application lineage fails closed before answer or profile mutation", async () => {
    const seed = createSeed();
    seed.userActionRequests = [
      createManualAnswerRequest({
        scope: {
          type: "application",
          runId: "run_manual",
          jobId: "job_ready",
          applicationRecordId: null,
          resultId: "result_a",
          replayCheckpointId: null,
          source: "target_site",
        },
      }),
    ];
    seed.applicationQuestionRecords = [
      ApplicationQuestionRecordSchema.parse({
        ...createQuestion(),
        applicationRecordId: null,
      }),
    ];
    const harness = createWorkspaceServiceHarness({ seed });
    const profileBefore = await harness.repository.getProfile();

    await expect(
      harness.workspaceService.performUserAction({
        ...submitManualAnswerCommand(),
        saveForFuture: true,
      }),
    ).rejects.toThrow(/missing its exact application record scope/i);

    expect(await harness.repository.listApplicationAnswerRecords()).toEqual([]);
    expect(await harness.repository.getProfile()).toEqual(profileBefore);
  });
});
