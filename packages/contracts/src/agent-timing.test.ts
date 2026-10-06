import { expect, test } from "vitest";
import { ApplyAgentTimingSchema } from "./agent-timing";
import {
  ApplyExecutionResultSchema,
  ApplicationAttemptSchema,
} from "./discovery";
import { ApplyJobResultSchema } from "./apply";

const timing = {
  totalMs: 1200,
  modelMs: 800,
  modelTurns: 2,
  auxiliaryModelMs: 100,
  auxiliaryModelCalls: 1,
  toolMs: 300,
  pageReadMs: 150,
  pageReads: 7,
  writeMs: 30,
  uploadMs: 50,
  longestSteps: [{ toolName: "fill_fields", durationMs: 200 }],
  requests: [{ turn: 1, historyChars: 2000, observationChars: 500 }],
};
const result = {
  state: "ready",
  summary: "Prepared.",
  detail: "Nothing sent.",
  submittedAt: null,
  outcome: null,
  nextActionLabel: null,
};

test("old execution and attempt data loads without timing; new run timing survives parsing", () => {
  expect(ApplyExecutionResultSchema.parse(result).agentTiming).toBeUndefined();
  expect(
    ApplyExecutionResultSchema.parse({ ...result, agentTiming: timing })
      .agentTiming,
  ).toEqual(timing);
  const attempt = {
    ...result,
    id: "attempt_test",
    jobId: "job_test",
    startedAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:01.000Z",
    completedAt: null,
  };
  expect(ApplicationAttemptSchema.parse(attempt).agentTiming).toBeUndefined();
  expect(
    ApplicationAttemptSchema.parse({ ...attempt, agentTiming: timing })
      .agentTiming,
  ).toEqual(timing);
  const jobResult = {
    id: "result_test",
    runId: "run_test",
    jobId: "job_test",
    summary: "Prepared.",
    detail: "Nothing sent.",
    startedAt: attempt.startedAt,
    updatedAt: attempt.updatedAt,
  };
  expect(ApplyJobResultSchema.parse(jobResult).agentTiming).toBeUndefined();
  expect(
    ApplyJobResultSchema.parse({ ...jobResult, agentTiming: timing })
      .agentTiming,
  ).toEqual(timing);
});

test("timing rejects invalid counts and retains only bounded longest steps", () => {
  expect(
    ApplyAgentTimingSchema.safeParse({ ...timing, pageReads: -1 }).success,
  ).toBe(false);
  expect(
    ApplyAgentTimingSchema.safeParse({
      ...timing,
      longestSteps: Array(6).fill(timing.longestSteps[0]),
    }).success,
  ).toBe(false);
});

test("per-turn field counts survive persistence without requiring them on older records", () => {
  const measured = {
    ...timing,
    requests: [
      {
        ...timing.requests[0],
        fieldsAttempted: 5,
        fieldsFilled: 4,
        stepsAdvanced: 1,
        uploadsAttached: 1,
      },
    ],
  };
  expect(
    ApplyExecutionResultSchema.parse({ ...result, agentTiming: measured })
      .agentTiming,
  ).toEqual(measured);
  expect(
    ApplyAgentTimingSchema.parse(timing).requests[0]?.fieldsFilled,
  ).toBeUndefined();
  expect(
    ApplyAgentTimingSchema.safeParse({
      ...measured,
      requests: [{ ...measured.requests[0], fieldsAttempted: -1 }],
    }).success,
  ).toBe(false);
});

test("steps advanced is optional for old records and rejects invalid counts", () => {
  expect(
    ApplyAgentTimingSchema.parse(timing).requests[0]?.stepsAdvanced,
  ).toBeUndefined();
  for (const stepsAdvanced of [-1, 0.5]) {
    expect(
      ApplyAgentTimingSchema.safeParse({
        ...timing,
        requests: [{ ...timing.requests[0], stepsAdvanced }],
      }).success,
    ).toBe(false);
  }
});

test("uploads attached is optional for old records and rejects invalid counts", () => {
  expect(
    ApplyAgentTimingSchema.parse(timing).requests[0]?.uploadsAttached,
  ).toBeUndefined();
  for (const uploadsAttached of [-1, 0.5, Infinity]) {
    expect(
      ApplyAgentTimingSchema.safeParse({
        ...timing,
        requests: [{ ...timing.requests[0], uploadsAttached }],
      }).success,
    ).toBe(false);
  }
});

test("question and answer timing plus fill sources survive persisted result parsing", () => {
  const measured = {
    ...timing,
    questionReadingCalls: 5,
    questionReadingMs: 300,
    answerCheckCalls: 1,
    answerCheckMs: 100,
    requests: [{ ...timing.requests[0], storedFactFills: 3, answersWaited: 1 }],
  };
  expect(
    ApplyExecutionResultSchema.parse({ ...result, agentTiming: measured })
      .agentTiming,
  ).toEqual(measured);
  expect(
    ApplyAgentTimingSchema.safeParse({ ...measured, questionReadingCalls: -1 })
      .success,
  ).toBe(false);
});
