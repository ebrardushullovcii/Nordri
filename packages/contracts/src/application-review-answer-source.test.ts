import { expect, test } from "vitest";
import { ApplicationReviewAnswerSchema } from "./apply";

test("review answers keep the run's source id while older cards remain valid", () => {
  const answer = {
    question: "Declaration",
    answer: "Yes",
    source: "your answer to this question",
    written: false,
  };
  expect(ApplicationReviewAnswerSchema.parse(answer)).not.toHaveProperty(
    "sourceId",
  );
  expect(
    ApplicationReviewAnswerSchema.parse({
      ...answer,
      sourceId: "answerLibrary.saved_declaration",
    }).sourceId,
  ).toBe("answerLibrary.saved_declaration");
});
