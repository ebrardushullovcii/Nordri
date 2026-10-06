import { describe, expect, it } from "vitest";
import {
  ApplicationAnswerRecordSchema,
  ApplicationReviewAnswerSchema,
  ApplicationReviewAttachmentSchema,
  ApplicationAnswerValueSchema,
  ClearApplicationAnswerCommandSchema,
  SaveApplicationAnswerCommandSchema,
} from "./apply";

describe("application answer contracts", () => {
  it("keeps persisted legacy answers backward compatible", () => {
    const answer = ApplicationAnswerRecordSchema.parse({
      id: "answer-1",
      runId: "run-1",
      jobId: "job-1",
      questionId: "question-1",
      text: "Yes",
      createdAt: "2026-08-10T10:00:00.000Z",
    });

    expect(answer).toEqual(
      expect.objectContaining({
        value: null,
        revision: 1,
        saveScope: "application_once",
        supersedesAnswerId: null,
      }),
    );
  });

  it.each([
    { type: "text", value: "Four weeks" },
    { type: "single_choice", value: "Yes" },
    { type: "multi_choice", values: ["React", "TypeScript"] },
    { type: "boolean", value: true },
    { type: "date", value: "2026-08-31" },
    { type: "asset_ref", assetId: "asset-portfolio" },
  ])("accepts the typed answer value %#", (value) => {
    expect(ApplicationAnswerValueSchema.parse(value)).toEqual(value);
  });

  it("rejects impossible calendar dates", () => {
    expect(
      ApplicationAnswerValueSchema.safeParse({
        type: "date",
        value: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it.each([
    [SaveApplicationAnswerCommandSchema, "submitAuthorized"],
    [SaveApplicationAnswerCommandSchema, "accountCreationAuthorized"],
    [ClearApplicationAnswerCommandSchema, "submitAuthorized"],
    [ClearApplicationAnswerCommandSchema, "accountCreationAuthorized"],
  ] as const)("rejects %s=true", (schema, property) => {
    const common = {
      commandId: "command-1",
      runId: "run-1",
      jobId: "job-1",
      resultId: "result-1",
      questionId: "question-1",
      expectedAnswerRevision: 1,
      submitAuthorized: false,
      accountCreationAuthorized: false,
    };
    const input =
      schema === SaveApplicationAnswerCommandSchema
        ? {
            ...common,
            expectedAnswerRevision: 0,
            value: { type: "text" as const, value: "Answer" },
          }
        : common;

    expect(schema.safeParse({ ...input, [property]: true }).success).toBe(
      false,
    );
  });
});

it("review fields can retain identity without breaking older records", () => {
  const answer = {
    question: "Description",
    answer: "Synthetic role description.",
    source: "your profile",
    written: false,
  };
  expect(ApplicationReviewAnswerSchema.parse(answer).fieldKey).toBeUndefined();
  expect(
    ApplicationReviewAnswerSchema.parse({
      ...answer,
      fieldKey: "step_2_role_1",
    }).fieldKey,
  ).toBe("step_2_role_1");
  expect(
    ApplicationReviewAttachmentSchema.parse({
      field: "Resume",
      fileName: "approved.pdf",
      label: "Your CV",
      fieldKey: "step_1_resume",
    }).fieldKey,
  ).toBe("step_1_resume");
});
