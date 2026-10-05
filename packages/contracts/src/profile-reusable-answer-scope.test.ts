import { expect, test } from "vitest";
import { CandidateAnswerBankSchema } from "./profile";

test("legacy eligibility labels migrate to a structured scope without changing the answer", () => {
  const question =
    "Are you authorized? (Application location: Berlin, Germany; reuse only for the same hiring country and permit conditions)";
  const bank = CandidateAnswerBankSchema.parse({
    customAnswers: [
      {
        id: "legacy",
        kind: "work_authorization",
        label: question.slice(0, 120),
        question,
        answer: "Yes",
      },
    ],
  });
  expect(bank.customAnswers[0]).toMatchObject({
    id: "legacy",
    question: "Are you authorized?",
    label: "Are you authorized?",
    answer: "Yes",
    applicationScope: {
      location: "Berlin, Germany",
      resultId: null,
      applicationRecordId: null,
    },
  });
  expect(CandidateAnswerBankSchema.parse(bank)).toEqual(bank);
});
