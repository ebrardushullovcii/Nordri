import { describe, expect, test } from "vitest";
import { z } from "zod";

import { runAgentTask } from "./runtime";

describe("agent task runtime", () => {
  test("repairs a rejected tool call and finishes a valid draft", async () => {
    let call = 0;
    const result = await runAgentTask({
      taskId: "task_1",
      capability: "profile_copilot",
      systemPrompt: "Update the draft.",
      state: { saved: "old" },
      initialDraft: { value: "" },
      model: {
        model: "test-model",
        reasoningEffort: "high",
        chat() {
          call += 1;
          return Promise.resolve(
            call === 1
              ? {
                  toolCalls: [
                    {
                      id: "bad",
                      type: "function",
                      function: { name: "set_value", arguments: "{}" },
                    },
                  ],
                }
              : {
                  toolCalls: [
                    {
                      id: "set",
                      type: "function",
                      function: {
                        name: "set_value",
                        arguments: JSON.stringify({ value: "ready" }),
                      },
                    },
                    {
                      id: "finish",
                      type: "function",
                      function: { name: "finish_task", arguments: "{}" },
                    },
                  ],
                },
          );
        },
      },
      tools: [
        {
          name: "set_value",
          description: "Set the value",
          inputSchema: z.object({ value: z.string().min(1) }),
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
          permission: "draft_write",
          execute(input: { value: string }, context) {
            return {
              draft: { ...context.draft, value: input.value },
              summary: "Value set",
              progressMade: true,
            };
          },
        },
        {
          name: "finish_task",
          description: "Finish",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "read",
          execute() {
            return { summary: "Finish requested", finish: true };
          },
        },
      ],
      validate: (draft) =>
        draft.value
          ? []
          : [{ code: "required", message: "Value required", path: ["value"] }],
      buildContext: ({ state, draft, validationIssues }) => ({
        state,
        draft,
        validationIssues,
      }),
    });

    expect(result.draft.value).toBe("ready");
    expect(result.receipt.stopReason).toBe("completed");
    expect(result.receipt.repairAttempts).toBe(1);
  });

  test("treats cut-off tool arguments as a repair turn instead of stopping the run", async () => {
    let call = 0;
    const seenToolMessages: string[] = [];
    const tools = [
      {
        name: "set_value",
        description: "Set the value",
        inputSchema: z.object({ value: z.string().min(1) }),
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        permission: "draft_write" as const,
        execute(input: { value: string }, context: { draft: { value: string } }) {
          return {
            draft: { ...context.draft, value: input.value },
            summary: "Value set",
            progressMade: true,
          };
        },
      },
      {
        name: "finish_task",
        description: "Finish",
        inputSchema: z.object({}),
        parameters: { type: "object", properties: {} },
        permission: "read" as const,
        execute() {
          return { summary: "Finish requested", finish: true };
        },
      },
    ];
    const result = await runAgentTask({
      taskId: "task_cut_off_args",
      capability: "resume_generation",
      systemPrompt: "Set the value.",
      state: {},
      initialDraft: { value: "" },
      model: {
        model: "test-model",
        reasoningEffort: "high",
        chat(request) {
          call += 1;
          for (const message of request.messages) {
            if (message.role === "tool") seenToolMessages.push(message.content);
          }
          return Promise.resolve(
            call === 1
              ? {
                  toolCalls: [
                    {
                      id: "cut",
                      type: "function" as const,
                      function: {
                        name: "set_value",
                        arguments: '{"value": "a long proposal that was cu',
                      },
                    },
                  ],
                }
              : {
                  toolCalls: [
                    {
                      id: "set",
                      type: "function" as const,
                      function: {
                        name: "set_value",
                        arguments: JSON.stringify({ value: "ready" }),
                      },
                    },
                    {
                      id: "finish",
                      type: "function" as const,
                      function: { name: "finish_task", arguments: "{}" },
                    },
                  ],
                },
          );
        },
      },
      tools,
      validate: (draft) =>
        draft.value
          ? []
          : [{ code: "required", message: "Value required", path: ["value"] }],
      buildContext: ({ draft, validationIssues }) => ({ draft, validationIssues }),
    });

    expect(result.receipt.stopReason).toBe("completed");
    expect(result.draft.value).toBe("ready");
    expect(result.receipt.toolReceipts[0]).toMatchObject({
      outcome: "rejected",
      failureKind: "validation",
    });
    expect(seenToolMessages.join("\n")).toContain("not valid JSON");
  });

  test("keeps the cause of a tool failure that stops the run", async () => {
    const result = await runAgentTask({
      taskId: "task_tool_error",
      capability: "resume_generation",
      systemPrompt: "Pick a template.",
      state: {},
      initialDraft: { value: "" },
      model: {
        model: "test-model",
        reasoningEffort: "high",
        chat() {
          return Promise.resolve({
            toolCalls: [
              {
                id: "pick",
                type: "function" as const,
                function: { name: "pick", arguments: "{}" },
              },
            ],
          });
        },
      },
      tools: [
        {
          name: "pick",
          description: "Pick",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "draft_write" as const,
          execute(): never {
            throw new Error("Template 'x' is unavailable.");
          },
        },
      ],
      validate: () => [],
      buildContext: ({ draft }) => ({ draft }),
    });

    expect(result.receipt.stopReason).toBe("permanent_failure");
    expect(result.receipt.toolReceipts[0]?.validationIssues[0]).toMatchObject({
      code: "tool_error",
      message: "Template 'x' is unavailable.",
    });
  });

  test("does not finish on top of a write it refused in the same turn", async () => {
    // A model often sends its change and finish together. When the change is
    // refused, finishing then dropped it without the model ever hearing why.
    let call = 0;
    const seenFinishRejections: unknown[] = [];
    const result = await runAgentTask({
      taskId: "task_refused_write",
      capability: "profile_copilot",
      systemPrompt: "Add an item.",
      state: {},
      initialDraft: { items: [] as string[] },
      model: {
        model: "test-model",
        reasoningEffort: "low",
        chat(request) {
          call += 1;
          for (const message of request.messages) {
            if (
              message.role === "user" &&
              typeof message.content === "string" &&
              message.content.includes("finishRejected")
            ) {
              seenFinishRejections.push(message.content);
            }
          }
          const item = call === 1 ? "" : "ready";
          return Promise.resolve({
            toolCalls: [
              {
                id: `add_${call}`,
                type: "function",
                function: {
                  name: "add_item",
                  arguments: JSON.stringify({ item }),
                },
              },
              {
                id: `finish_${call}`,
                type: "function",
                function: { name: "finish_task", arguments: "{}" },
              },
            ],
          });
        },
      },
      tools: [
        {
          name: "add_item",
          description: "Add an item",
          inputSchema: z.object({ item: z.string().min(1) }),
          parameters: {
            type: "object",
            properties: { item: { type: "string" } },
            required: ["item"],
          },
          permission: "draft_write",
          execute(input: { item: string }, context) {
            return {
              draft: { items: [...context.draft.items, input.item] },
              summary: "Item added",
              progressMade: true,
            };
          },
        },
        {
          name: "finish_task",
          description: "Finish",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "read",
          execute() {
            return { summary: "Finish requested", finish: true };
          },
        },
      ],
      validate: () => [],
      buildContext: ({ state, draft, validationIssues }) => ({
        state,
        draft,
        validationIssues,
      }),
    });

    expect(result.receipt.stopReason).toBe("completed");
    expect(result.draft.items).toEqual(["ready"]);
    expect(call).toBe(2);
    expect(seenFinishRejections.length).toBeGreaterThan(0);
  });

  test("rejects external-action tools without executing them", async () => {
    let executed = false;
    const result = await runAgentTask({
      taskId: "task_2",
      capability: "safe_boundary",
      systemPrompt: "Do not submit.",
      state: {},
      initialDraft: {},
      model: {
        chat() {
          return Promise.resolve({
            toolCalls: [
              {
                id: "submit",
                type: "function",
                function: { name: "submit_application", arguments: "{}" },
              },
            ],
          });
        },
      },
      tools: [
        {
          name: "submit_application",
          description: "Submit",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "external_action",
          execute() {
            executed = true;
            return { summary: "submitted" };
          },
        },
      ],
      validate: () => [],
      buildContext: () => ({}),
      noProgressLimit: 1,
    });

    expect(executed).toBe(false);
    expect(result.receipt.stopReason).toBe("safety_boundary");
    expect(result.receipt.toolReceipts[0]?.failureKind).toBe("safety_boundary");
  });

  test("stops on its provider-call cost guard without pretending it completed", async () => {
    const result = await runAgentTask({
      taskId: "task_cost_guard",
      capability: "bounded_task",
      systemPrompt: "Use a tool.",
      state: {},
      initialDraft: {},
      model: {
        chat() {
          return Promise.resolve({ content: "still thinking" });
        },
      },
      tools: [],
      validate: () => [],
      buildContext: () => ({}),
      providerCallBudget: 1,
      noProgressLimit: 5,
    });

    expect(result.receipt.providerCalls).toBe(1);
    expect(result.receipt.stopReason).toBe("cost_budget");
  });

  test("one silent provider call cannot overrun the task budget", async () => {
    const progress: string[] = [];
    const result = await runAgentTask({
      taskId: "task_silent_provider",
      capability: "bounded_task",
      systemPrompt: "Use a tool.",
      state: {},
      initialDraft: {},
      model: {
        chat() {
          return new Promise(() => {
            // Deliberately ignore the signal: the runtime still owns its
            // deadline even when a provider adapter fails to settle on abort.
          });
        },
      },
      tools: [],
      validate: () => [],
      buildContext: () => ({}),
      timeBudgetMs: 1_000,
      modelTurnTimeoutMs: 10,
      onProgress: ({ message }) => progress.push(message),
    });

    expect(result.receipt.stopReason).toBe("time_budget");
    expect(result.receipt.providerCalls).toBe(1);
    expect(progress).toContain(
      "The assistant did not answer before this turn's time limit",
    );
  });

  test("keeps the assistant tool-call message when the recent tail contains many tool results", async () => {
    let providerCall = 0;
    const result = await runAgentTask({
      taskId: "task_protocol_safe_tail",
      capability: "bounded_task",
      systemPrompt: "Inspect, then finish.",
      state: {},
      initialDraft: {},
      model: {
        chat({ messages }) {
          providerCall += 1;
          if (providerCall === 2) {
            const firstRecent = messages[2];
            expect(firstRecent?.role).toBe("assistant");
            expect(firstRecent?.toolCalls).toHaveLength(9);
          }
          return Promise.resolve(
            providerCall === 1
              ? {
                  toolCalls: Array.from({ length: 9 }, (_, index) => ({
                    id: `read_${index}`,
                    type: "function" as const,
                    function: { name: "read", arguments: "{}" },
                  })),
                }
              : {
                  toolCalls: [
                    {
                      id: "finish",
                      type: "function" as const,
                      function: { name: "finish_task", arguments: "{}" },
                    },
                  ],
                },
          );
        },
      },
      tools: [
        {
          name: "read",
          description: "Read",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "read",
          parallelSafe: true,
          execute() {
            return { summary: "Read" };
          },
        },
        {
          name: "finish_task",
          description: "Finish",
          inputSchema: z.object({}),
          parameters: { type: "object", properties: {} },
          permission: "read",
          execute() {
            return { summary: "Finish", finish: true };
          },
        },
      ],
      validate: () => [],
      buildContext: () => ({}),
    });

    expect(result.receipt.stopReason).toBe("completed");
  });
});
