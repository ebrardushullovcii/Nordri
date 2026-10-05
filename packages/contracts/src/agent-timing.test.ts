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
