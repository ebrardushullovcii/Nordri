// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ApplicationAttemptQuestionSchema } from "@nordri/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { QuestionAnswerForm } from "./actions-screen";
afterEach(cleanup);
const at = "2026-10-01T10:00:00.000Z";

test("country and two half-written answers restore while submit waits for both decisions", async () => {
  const onAnswer = vi.fn();
  const onDraftChange = vi.fn();
  const questions = ["work_authorization", "visa_sponsorship"].map((kind) =>
    ApplicationAttemptQuestionSchema.parse({
      id: kind,
      prompt:
        kind === "work_authorization"
          ? "Can you work here?"
          : "Need sponsorship?",
      kind,
      detectedAt: at,
      answerOptions: ["Yes", "No"],
    }),
  );
  const view = render(
    <QuestionAnswerForm
      requestId="request"
      questions={questions}
      draft={{
        answers: { "Can you work here?": "Yes" },
        saveForFuture: false,
        hiringCountry: "Canada",
      }}
      isPending={false}
      onAnswer={onAnswer}
      onDraftChange={onDraftChange}
    />,
  );
  expect(
    (
      view.getByLabelText(
        "Which country would hire you for this job?",
      ) as HTMLInputElement
    ).value,
  ).toBe("Canada");
  const submit = view.getByRole("button", {
    name: /Answer and continue/,
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(view.getByLabelText("Need sponsorship?"), {
    target: { value: "No" },
  });
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(onAnswer).toHaveBeenCalledWith(
      [
        { questionId: "work_authorization", answer: "Yes" },
        { questionId: "visa_sponsorship", answer: "No" },
      ],
      false,
      "Canada",
    ),
  );
});

test("conflict wording is visible but remains unconfirmed until the person uses and submits it", async () => {
  const onAnswer = vi.fn();
  const wording =
    "I can work 20–30 hours from Toronto. Can the role support this?";
  const question = ApplicationAttemptQuestionSchema.parse({
    id: "motivation",
    prompt: "Why this role?",
    detectedAt: at,
    note: "The job requires full-time work in Boston.",
    suggestedAnswers: [
      {
        id: "suggestion",
        text: wording,
        sourceKind: "prior_answer",
        sourceId: "review.c0",
      },
    ],
  });
  const view = render(
    <QuestionAnswerForm
      requestId="request"
      questions={[question]}
      isPending={false}
      onAnswer={onAnswer}
    />,
  );
  expect(view.getByText(wording)).toBeTruthy();
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(view.getByRole("button", { name: "Use this wording" }));
  expect(onAnswer).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: /Answer and continue/ }));
  await waitFor(() =>
    expect(onAnswer).toHaveBeenCalledWith(
      [{ questionId: "motivation", answer: wording }],
      true,
    ),
  );
});
