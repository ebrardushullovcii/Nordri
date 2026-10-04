import {
  ApplicationAnswerRecordSchema,
  ApplicationQuestionRecordSchema,
} from "@nordri/contracts";
import { describe, expect, it } from "vitest";
import { createSeed } from "../workspace-service.test-fixtures";
import { mergeApplicationAnswersIntoExecutionProfile } from "./workspace-application-answer-execution";

const now = "2026-08-10T10:00:00.000Z";

function question(id: string, selectedAnswerId: string | null) {
  return ApplicationQuestionRecordSchema.parse({
    id,
    runId: "run-1",
    jobId: "job-1",
    resultId: "result-1",
    prompt: `Prompt for ${id}`,
    kind: "other",
    isRequired: true,
    detectedAt: now,
    selectedAnswerId,
    status: selectedAnswerId ? "answered" : "detected",
  });
}

function answer(input: {
  id: string;
  questionId: string;
  text: string;
  revision: number;
  status?: "suggested" | "rejected";
}) {
  return ApplicationAnswerRecordSchema.parse({
    id: input.id,
    runId: "run-1",
    jobId: "job-1",
    resultId: "result-1",
    questionId: input.questionId,
    status: input.status ?? "suggested",
    text: input.text,
    value:
      input.status === "rejected" ? null : { type: "text", value: input.text },
    revision: input.revision,
    sourceKind: "user",
    createdAt: now,
  });
}

describe("application answers in prepare-only execution", () => {
  it("injects every selected user-reviewed answer ahead of reusable profile answers", () => {
    const profile = createSeed().profile;
    const merged = mergeApplicationAnswersIntoExecutionProfile({
      profile,
      questionRecords: [
        question("question-1", "answer-1"),
        question("question-2", "answer-2"),
      ],
      answerRecords: [
        answer({
          id: "answer-1",
          questionId: "question-1",
          text: "First",
          revision: 1,
        }),
        answer({
          id: "answer-2",
          questionId: "question-2",
          text: "Second",
          revision: 1,
        }),
      ],
      idPrefix: "application-run-1",
    });

    expect(merged.answerBank.customAnswers.slice(0, 2)).toEqual([
      expect.objectContaining({
        question: "Prompt for question-1",
        answer: "First",
      }),
      expect.objectContaining({
        question: "Prompt for question-2",
        answer: "Second",
      }),
    ]);
  });

  it("does not resurrect an answer whose latest revision was cleared", () => {
    const profile = createSeed().profile;
    const merged = mergeApplicationAnswersIntoExecutionProfile({
      profile,
      questionRecords: [question("question-1", null)],
      answerRecords: [
        answer({
          id: "answer-old",
          questionId: "question-1",
          text: "Old",
          revision: 1,
        }),
        answer({
          id: "answer-cleared",
          questionId: "question-1",
          text: "Answer cleared by the user",
          revision: 2,
          status: "rejected",
        }),
      ],
      idPrefix: "application-run-1",
    });

    expect(merged).toBe(profile);
  });
  it("honors an explicit selection of an older answer despite a newer revision", () => {
    const merged = mergeApplicationAnswersIntoExecutionProfile({
      profile: createSeed().profile,
      questionRecords: [question("question-1", "answer-old")],
      answerRecords: [
        answer({
          id: "answer-old",
          questionId: "question-1",
          text: "Old",
          revision: 1,
        }),
        answer({
          id: "answer-new",
          questionId: "question-1",
          text: "Two weeks",
          revision: 2,
        }),
      ],
      idPrefix: "application-run-1",
    });
    expect(merged.answerBank.customAnswers[0]?.answer).toBe("Old");
  });
});

it("keeps the person's pay answers scoped to this application's execution profile", () => {
  const profile = createSeed().profile;
  const before = structuredClone(profile);
  const salary = {
    ...question("salary", "salary_answer"),
    prompt: "Expected salary",
    kind: "salary_expectation" as const,
  };
  const currency = {
    ...question("currency", "currency_answer"),
    prompt: "Salary currency",
  };
  const merged = mergeApplicationAnswersIntoExecutionProfile({
    profile,
    questionRecords: [salary, currency],
    answerRecords: [
      answer({
        id: "salary_answer",
        questionId: "salary",
        text: "90000",
        revision: 1,
      }),
      answer({
        id: "currency_answer",
        questionId: "currency",
        text: "EUR",
        revision: 1,
      }),
    ],
    idPrefix: "application_request_pay",
  });
  expect(merged.answerBank.customAnswers.slice(0, 2)).toEqual([
    expect.objectContaining({
      question: "Expected salary",
      answer: "90000",
    }),
    expect.objectContaining({
      question: "Salary currency",
      answer: "EUR",
    }),
  ]);
  for (const entry of merged.answerBank.customAnswers.slice(0, 2)) {
    expect(entry.id).toMatch(/^application_request_pay_/);
  }
  expect(profile).toEqual(before);
});

it("an application's own currency survives a newer library-seeded suggestion", () => {
  const profile = createSeed().profile;
  const own = answer({
    id: "own_currency",
    questionId: "currency",
    text: "GBP",
    revision: 1,
  });
  const library = {
    ...answer({
      id: "seeded_currency",
      questionId: "currency",
      text: "EUR",
      revision: 2,
    }),
    sourceId: "answerLibrary.other_job_currency",
  };
  const merged = mergeApplicationAnswersIntoExecutionProfile({
    profile,
    questionRecords: [
      { ...question("currency", library.id), prompt: "Currency" },
    ],
    answerRecords: [own, library],
    idPrefix: "application_this",
  });
  expect(merged.answerBank.customAnswers[0]).toMatchObject({
    question: "Currency",
    answer: "GBP",
  });
});
