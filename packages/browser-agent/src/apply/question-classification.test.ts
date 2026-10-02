import { describe, expect, test, vi } from "vitest";

import type { LLMClient } from "../agent/contracts";
import { classifyApplicationQuestions } from "./question-classification";

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
