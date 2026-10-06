import { expect, it } from "vitest";
import {
  ApplyRunDetailsSchema,
  ApplicationReviewCardSchema,
} from "@nordri/contracts";
import { withPersonAnswerSources } from "./application-review-source";
it("keeps a person's checkbox-group answer attributed to them when the form changes separators", () => {
  const at = "2026-10-05T10:00:00.000Z";
  const card = ApplicationReviewCardSchema.parse({
    siteLabel: "Example",
    pageUrl: "https://example.test/apply",
    preparedAt: at,
    answers: [
      {
        question: "Work areas",
        answer: "Finance; Reporting",
        source: "the filled application form",
        written: false,
        groundedIn: [],
      },
    ],
    attachments: [],
    letter: null,
    waitingOnYou: [],
  });
  const details = ApplyRunDetailsSchema.parse({
    run: {
      id: "run",
      source: "target_site",
      mode: "single_job_auto",
      state: "completed",
      summary: "Prepared",
      detail: "Ready to review",
      jobIds: ["job"],
      createdAt: at,
      updatedAt: at,
    },
    questionRecords: [
      {
        id: "question",
        runId: "run",
        jobId: "job",
        prompt: "Work areas",
        detectedAt: at,
        answerControlType: "multi_choice",
        selectedAnswerId: "answer",
      },
    ],
    answerRecords: [
      {
        id: "answer",
        runId: "run",
        jobId: "job",
        questionId: "question",
        text: "Reporting, Finance",
        sourceKind: "user",
        createdAt: at,
      },
    ],
  });
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "your answer to this question",
  );
  details.answerRecords[0]!.text = '["Reporting","Finance"]';
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "your answer to this question",
  );
  details.answerRecords[0]!.text = '["Reporting","Communication, mentoring"]';
  card.answers[0]!.answer = "Communication, mentoring; Reporting";
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "the filled application form",
  );
  card.answers[0]!.answer = '["Communication, mentoring","Reporting"]';
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "your answer to this question",
  );
  details.questionRecords[0]!.selectedAnswerId = null;
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "your answer to this question",
  );
  details.answerRecords[0]!.sourceKind = "profile";
  expect(withPersonAnswerSources(card, details).answers[0]?.source).toBe(
    "the filled application form",
  );
});
