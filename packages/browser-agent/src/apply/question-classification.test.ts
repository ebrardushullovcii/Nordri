import { describe, expect, test, vi } from "vitest";

import { buildApplyFormObservation } from "./page-hands";
import type { RawApplyPage } from "@nordri/contracts";
import type { LLMClient } from "../agent/contracts";
import {
  classifyApplicationQuestions,
  createQuestionClassifier,
} from "./question-classification";

function clientReplying(questions: unknown): LLMClient {
  return {
    chatWithTools: vi.fn(() =>
      Promise.resolve({
        content: "",
        toolCalls: [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "report_question_kinds",
              arguments: JSON.stringify({ questions }),
            },
          },
        ],
      }),
    ),
  } as unknown as LLMClient;
}

describe("classifyApplicationQuestions", () => {
  test("reads the model's answer for each question by its wording", async () => {
    const result = await classifyApplicationQuestions({
      client: clientReplying([
        { index: 0, asksAboutPay: true, declarationKind: null },
        {
          index: 1,
          asksAboutPay: false,
          declarationKind: "background_check_consent",
        },
        { index: 2, asksAboutPay: false, declarationKind: "not_a_kind" },
      ]),
      questions: [
        { prompt: "Gehaltsvorstellung", kind: "text", options: [] },
        { prompt: "We may verify your history", kind: "checkbox", options: [] },
        { prompt: "Portfolio link", kind: "text", options: [] },
      ],
    });

    expect(result.get("Gehaltsvorstellung")).toEqual({
      asksAboutPay: true,
      declarationKind: null,
    });
    expect(result.get("We may verify your history")).toEqual({
      asksAboutPay: false,
      declarationKind: "background_check_consent",
    });
    expect(result.get("Portfolio link")?.declarationKind).toBeNull();
  });

  test("returns nothing for a reply without the report", async () => {
    const client = {
      chatWithTools: () => Promise.resolve({ content: "ok", toolCalls: [] }),
    } as unknown as LLMClient;
    const result = await classifyApplicationQuestions({
      client,
      questions: [{ prompt: "Expected salary", kind: "text", options: [] }],
    });
    expect(result.size).toBe(0);
  });
});

function controls(label = "Pay", options = ["Annual"], required = false) {
  return buildApplyFormObservation(
    {
      url: "https://example.test",
      title: "",
      bodyText: "",
      headings: [],
      controls: [
        {
          index: 0,
          tagName: "select",
          inputType: "",
          role: "",
          id: "pay",
          name: "pay",
          label,
          groupLabel: "",
          placeholder: "",
          autocomplete: "",
          required,
          invalid: false,
          validationMessage: "",
          disabled: false,
          readOnly: false,
          visible: true,
          value: "",
          checked: false,
          multiple: false,
          options,
          selectedOptionLabel: "",
        },
      ],
      actions: [],
      links: [],
      clickables: [],
      openedTabs: [],
      loading: false,
      validationErrors: [],
      stepLabel: null,
    } satisfies RawApplyPage,
    "2026-10-05T10:00:00Z",
  ).controls;
}

test("shares one classification for concurrent decisions and changed values on the same step", async () => {
  const client = clientReplying([
    { index: 0, asksAboutPay: true, declarationKind: null },
  ]);
  const classify = createQuestionClassifier({ client });
  const first = classify(controls(), "step1");
  const second = classify(controls(), "step1");
  expect(first).toBe(second);
  const questions = controls();
  questions[0].value = "Annual";
  questions[0].ref = "new-handle";
  expect(await classify(questions, "step1")).toEqual(await first);
  expect(client.chatWithTools).toHaveBeenCalledTimes(1);
});

test("invalidates when step, question wording, options or requirement changes", async () => {
  const client = clientReplying([
    { index: 0, asksAboutPay: true, declarationKind: null },
  ]);
  const classify = createQuestionClassifier({ client });
  await classify(controls(), "step1");
  await classify(controls(), "step2");
  await classify(controls("Rate"), "step2");
  await classify(controls("Rate", ["Hourly"]), "step2");
  await classify(controls("Rate", ["Hourly"], true), "step2");
  expect(client.chatWithTools).toHaveBeenCalledTimes(5);
});

test("retries a failed classification rather than caching the failure", async () => {
  const client = clientReplying([
    { index: 0, asksAboutPay: true, declarationKind: null },
  ]);
  vi.mocked(client.chatWithTools).mockRejectedValueOnce(new Error("offline"));
  const classify = createQuestionClassifier({ client });
  await expect(classify(controls())).rejects.toThrow("offline");
  expect((await classify(controls())).get("Pay")?.asksAboutPay).toBe(true);
  expect(client.chatWithTools).toHaveBeenCalledTimes(2);
});

test("does not cache an incomplete reply as a checked page", async () => {
  const client = clientReplying([]);
  const classify = createQuestionClassifier({ client });
  await expect(classify(controls())).rejects.toThrow("every question");
  await expect(classify(controls())).rejects.toThrow("every question");
  expect(client.chatWithTools).toHaveBeenCalledTimes(2);
});

test("gives a large page enough output budget to classify every question", async () => {
  const client = clientReplying([]);
  await classifyApplicationQuestions({
    client,
    questions: Array.from({ length: 30 }, (_, index) => ({
      prompt: `Question ${index}`,
      kind: "text",
      options: [],
    })),
  });
  expect(
    vi.mocked(client.chatWithTools).mock.calls[0]?.[2]?.maxOutputTokens,
  ).toBe(4800);
});

test("returning to a step reuses its classification unless its questions changed", async () => {
  const client = clientReplying([
    { index: 0, asksAboutPay: true, declarationKind: null },
  ]);
  const classify = createQuestionClassifier({ client });
  await classify(controls(), "step1");
  await classify(controls(), "step2");
  await classify(controls(), "step1");
  expect(client.chatWithTools).toHaveBeenCalledTimes(2);
  await classify(controls("Rate", ["Hourly"]), "step1");
  await classify(controls(), "step1");
  expect(client.chatWithTools).toHaveBeenCalledTimes(4);
});
