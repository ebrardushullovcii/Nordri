import { describe, expect, test } from "vitest";

import {
  runAgentLoop,
  type AgentLoopMessage,
  type AgentLoopModel,
  type AgentLoopTool,
  type AgentLoopToolCall,
} from "./agent-loop";

function call(
  name: string,
  args: Record<string, unknown> = {},
  id = `call_${name}`,
): AgentLoopToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function scripted(
  turns: AgentLoopToolCall[][],
): AgentLoopModel & { calls: number } {
  const model = {
    calls: 0,
    chatWithTools: () => {
      const turn = turns[Math.min(model.calls, turns.length - 1)] ?? [];
      model.calls += 1;
      return Promise.resolve({
        content: "",
        toolCalls: turn.map((entry, index) => ({
          ...entry,
          id: `${entry.id}_${model.calls}_${index}`,
        })),
      });
    },
  };
  return model;
}

function tool(
  name: string,
  execute: AgentLoopTool["execute"],
  options: Pick<AgentLoopTool, "failureKind" | "describeError"> = {},
): AgentLoopTool {
  return {
    definition: {
      type: "function",
      function: {
        name,
        description: name,
        parameters: { type: "object", properties: {} },
      },
    },
    execute,
    ...options,
  };
}

const finishTool = tool("finish", (raw) => {
  const args = JSON.parse(raw || "{}") as {
    reason?: string;
    stuck?: boolean;
    needsPerson?: boolean;
  };
  return Promise.resolve({
    kind: "finish",
    finish: {
      reason: args.reason ?? "done",
      stuck: args.stuck === true,
      needsPerson: args.needsPerson === true,
      data: args,
    },
  });
});

const opening: AgentLoopMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: "goal" },
];

describe("runAgentLoop", () => {
  test("the model's finish reason is the run's reason, word for word", async () => {
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([
        [
          call("finish", {
            reason: "Every posting opens a sign-in page first",
            needsPerson: true,
          }),
        ],
      ]),
      tools: [finishTool],
      subjectLabel: "the careers site",
    });
    expect(result.ending).toBe("finished");
    expect(result.reason).toBe("Every posting opens a sign-in page first.");
    expect(result.finish?.needsPerson).toBe(true);
    expect(result.steps).toBe(1);
  });

  test("a stall gets one warning, then the run ends if nothing moves", async () => {
    const look = tool("look", () =>
      Promise.resolve({ kind: "ok", content: "same page" }),
    );
    const model = scripted([[call("look")]]);
    const result = await runAgentLoop({
      messages: opening,
      model,
      tools: [look, finishTool],
      subjectLabel: "the careers site",
      ceilings: { noProgressStepLimit: 3, maxSteps: 50 },
    });
    expect(result.ending).toBe("stalled");
    expect(result.reason).toContain("nothing new happened");
    const warnings = result.messages.filter(
      (message) =>
        message.role === "user" && message.content.startsWith("Stall check"),
    );
    expect(warnings).toHaveLength(1);
    expect(result.steps).toBeLessThan(10);
  });

  test("progress resets the stall window", async () => {
    let calls = 0;
    const work = tool("work", () => {
      calls += 1;
      return Promise.resolve({
        kind: "ok",
        content: "did something",
        progress: calls % 2 === 0,
      });
    });
    const turns: AgentLoopToolCall[][] = Array.from({ length: 12 }, () => [
      call("work"),
    ]);
    turns.push([call("finish", { reason: "Done" })]);
    const result = await runAgentLoop({
      messages: opening,
      model: scripted(turns),
      tools: [work, finishTool],
      subjectLabel: "the site",
      ceilings: { noProgressStepLimit: 3 },
    });
    expect(result.ending).toBe("finished");
    expect(result.progressSteps).toBe(6);
  });

  test("a browser failure is handed back as a fact and the run carries on", async () => {
    let attempts = 0;
    const flaky = tool(
      "press",
      () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(
            new Error(
              "The page moved to a new address while Job Finder was reading it.",
            ),
          );
        }
        return Promise.resolve({
          kind: "ok",
          content: "pressed",
          progress: true,
        });
      },
      {
        failureKind: "browser",
        describeError: (error) =>
          error instanceof Error
            ? error.message
            : "The browser did not respond.",
      },
    );
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([
        [call("press")],
        [call("press")],
        [call("finish", { reason: "Done" })],
      ]),
      tools: [flaky, finishTool],
      subjectLabel: "the site",
    });
    expect(result.ending).toBe("finished");
    const failureNote = result.messages.find(
      (message) =>
        message.role === "tool" &&
        message.content.startsWith("That step did not complete"),
    );
    expect(failureNote?.content).toContain("moved to a new address");
    expect(result.turnNotes.join("\n")).toContain("browser failure");
  });

  test("three browser failures in a row end the run in plain words", async () => {
    const dead = tool(
      "press",
      () =>
        Promise.reject(
          new Error("The browser tab Job Finder was working in was closed."),
        ),
      {
        failureKind: "browser",
        describeError: (error) =>
          error instanceof Error
            ? error.message
            : "The browser did not respond.",
      },
    );
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([[call("press")]]),
      tools: [dead, finishTool],
      subjectLabel: "the site",
    });
    expect(result.ending).toBe("browser_failed");
    expect(result.reason).toContain("stopped responding");
    expect(result.reason).toContain("was closed");
    expect(result.steps).toBe(3);
  });

  test("a safety stop ends the run with the host's reason", async () => {
    const guard = tool("press", () =>
      Promise.resolve({
        kind: "stop",
        reason: "The page tried to send the application on its own.",
      }),
    );
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([[call("press")]]),
      tools: [guard, finishTool],
      subjectLabel: "the site",
    });
    expect(result.ending).toBe("stopped");
    expect(result.stop?.reason).toContain("send the application");
  });

  test("a domain tool failure is not counted as a dead browser or exposed", async () => {
    const broken = tool("save", () =>
      Promise.reject(new Error("database password was visible in a stack")),
    );
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([
        [call("save")],
        [call("finish", { reason: "Could not save this result" })],
      ]),
      tools: [broken, finishTool],
      subjectLabel: "the site",
    });

    expect(result.ending).toBe("finished");
    expect(JSON.stringify(result)).not.toContain("database password");
    expect(result.turnNotes.join("\n")).toContain("tool failure");
  });

  test("the time ceiling stops a returned tool batch between calls", async () => {
    let tick = 0;
    let secondCalls = 0;
    const first = tool("first", () => {
      tick += 2;
      return Promise.resolve({ kind: "ok", content: "first done" });
    });
    const second = tool("second", () => {
      secondCalls += 1;
      return Promise.resolve({ kind: "ok", content: "second done" });
    });
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([[call("first"), call("second")]]),
      tools: [first, second],
      subjectLabel: "the site",
      ceilings: { timeBudgetMs: 1_000 },
      now: () => new Date(1_700_000_000_000 + tick * 1_000),
    });

    expect(result.ending).toBe("timed_out");
    expect(secondCalls).toBe(0);
  });

  test("running out of time keeps what was done and says so", async () => {
    let tick = 0;
    const now = () => new Date(1_700_000_000_000 + tick * 60_000);
    const work = tool("work", () => {
      tick += 1;
      return Promise.resolve({ kind: "ok", content: "ok", progress: true });
    });
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([[call("work")]]),
      tools: [work, finishTool],
      subjectLabel: "the site",
      ceilings: { timeBudgetMs: 3 * 60_000 },
      now,
    });
    expect(result.ending).toBe("timed_out");
    expect(result.reason).toContain("ran out of time");
    expect(result.progressSteps).toBeGreaterThan(0);
  });

  test("a silent model turn stops promptly and reports progress", async () => {
    const updates: string[] = [];
    const result = await runAgentLoop({
      messages: opening,
      model: {
        chatWithTools: () => new Promise(() => undefined),
      },
      tools: [finishTool],
      subjectLabel: "the site",
      ceilings: { modelTurnTimeoutMs: 10 },
      onStep: ({ note }) => {
        updates.push(note);
      },
    });

    expect(result.ending).toBe("timed_out");
    expect(result.reason).toContain("did not answer in time");
    expect(updates).toEqual([
      "asking the assistant what to do next",
      "the assistant did not answer before this turn's time limit",
    ]);
  });

  test("retries one unanswered model turn without replaying any tool", async () => {
    let calls = 0;
    let toolCalls = 0;
    const countedFinish = tool("finish", () => {
      toolCalls += 1;
      return Promise.resolve({
        kind: "finish",
        finish: {
          reason: "Recovered",
          stuck: false,
          needsPerson: false,
          data: {},
        },
      });
    });
    const result = await runAgentLoop({
      messages: opening,
      model: {
        chatWithTools: () => {
          calls += 1;
          return calls === 1
            ? new Promise(() => undefined)
            : Promise.resolve({
                toolCalls: [call("finish", { reason: "Recovered" })],
              });
        },
      },
      tools: [countedFinish],
      subjectLabel: "the site",
      ceilings: { modelTurnTimeoutMs: 10, modelTurnTimeoutRetries: 1 },
    });

    expect(result.ending).toBe("finished");
    expect(calls).toBe(2);
    expect(toolCalls).toBe(1);
    expect(result.turnNotes.join("\n")).toContain(
      "retrying the same unanswered assistant turn once",
    );
  });

  test("stops after the bounded unanswered-turn retry is exhausted", async () => {
    let calls = 0;
    const result = await runAgentLoop({
      messages: opening,
      model: {
        chatWithTools: () => {
          calls += 1;
          return new Promise(() => undefined);
        },
      },
      tools: [finishTool],
      subjectLabel: "the site",
      ceilings: { modelTurnTimeoutMs: 10, modelTurnTimeoutRetries: 1 },
    });

    expect(result.ending).toBe("timed_out");
    expect(result.reason).toContain("did not answer in time");
    expect(calls).toBe(2);
  });

  test("shares the bounded no-response retry with a typed transient HTTP failure", async () => {
    let calls = 0;
    let toolCalls = 0;
    const countedFinish = tool("finish", () => {
      toolCalls += 1;
      return Promise.resolve({
        kind: "finish",
        finish: {
          reason: "Recovered",
          stuck: false,
          needsPerson: false,
          data: {},
        },
      });
    });
    const transientError = Object.assign(new Error("Service unavailable"), {
      name: "ModelRequestHttpError",
      status: 503,
    });
    const result = await runAgentLoop({
      messages: opening,
      model: {
        chatWithTools: () => {
          calls += 1;
          return calls === 1
            ? Promise.reject(transientError)
            : Promise.resolve({
                toolCalls: [call("finish", { reason: "Recovered" })],
              });
        },
      },
      tools: [countedFinish],
      subjectLabel: "the site",
      ceilings: { modelTurnTimeoutRetries: 1 },
    });

    expect(result.ending).toBe("finished");
    expect(calls).toBe(2);
    expect(toolCalls).toBe(1);
    expect(result.turnNotes.join("\n")).toContain(
      "retrying the same assistant turn after a temporary service failure",
    );
  });

  test.each([
    { name: "auth failure", errorName: "ModelRequestHttpError", status: 401 },
    {
      name: "validation failure",
      errorName: "ModelRequestHttpError",
      status: 400,
    },
    { name: "untyped server error", errorName: "Error", status: 503 },
  ])("does not retry $name", async ({ errorName, status }) => {
    let calls = 0;
    const error = Object.assign(new Error("Provider request failed"), {
      name: errorName,
      status,
    });

    await expect(
      runAgentLoop({
        messages: opening,
        model: {
          chatWithTools: () => {
            calls += 1;
            return Promise.reject(error);
          },
        },
        tools: [finishTool],
        subjectLabel: "the site",
        ceilings: { modelTurnTimeoutRetries: 1 },
      }),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  test("stops after the bounded transient HTTP retry is exhausted", async () => {
    let calls = 0;
    const error = Object.assign(new Error("Service unavailable"), {
      name: "ModelRequestHttpError",
      status: 500,
    });

    await expect(
      runAgentLoop({
        messages: opening,
        model: {
          chatWithTools: () => {
            calls += 1;
            return Promise.reject(error);
          },
        },
        tools: [finishTool],
        subjectLabel: "the site",
        ceilings: { modelTurnTimeoutRetries: 1 },
      }),
    ).rejects.toBe(error);
    expect(calls).toBe(2);
  });

  test("a person stopping an unanswered turn never triggers its retry", async () => {
    const controller = new AbortController();
    let calls = 0;
    const resultPromise = runAgentLoop({
      messages: opening,
      model: {
        chatWithTools: () => {
          calls += 1;
          return new Promise(() => undefined);
        },
      },
      tools: [finishTool],
      subjectLabel: "the site",
      ceilings: { modelTurnTimeoutMs: 100, modelTurnTimeoutRetries: 1 },
      signal: controller.signal,
    });
    controller.abort();

    const result = await resultPromise;
    expect(result.ending).toBe("aborted");
    expect(calls).toBe(1);
  });

  test("a long conversation is trimmed in the middle and the opening survives", async () => {
    const chatty = tool("look", () =>
      Promise.resolve({
        kind: "ok",
        content: "x".repeat(5_000),
        progress: true,
      }),
    );
    const turns: AgentLoopToolCall[][] = Array.from({ length: 40 }, () => [
      call("look"),
    ]);
    turns.push([call("finish", { reason: "Done" })]);
    const result = await runAgentLoop({
      messages: opening,
      model: scripted(turns),
      tools: [chatty, finishTool],
      subjectLabel: "the site",
      compactionMaxChars: 60_000,
    });
    expect(result.ending).toBe("finished");
    expect(result.messages[0]).toEqual(opening[0]);
    expect(result.messages[1]).toEqual(opening[1]);
    const trimmed = result.messages.find(
      (message) =>
        message.role === "user" &&
        message.content.startsWith("Earlier turns were trimmed"),
    );
    expect(trimmed).toBeDefined();
    expect(result.messages.length).toBeLessThan(40);
  });

  test("a tool that hangs is given up after its deadline and the run carries on", async () => {
    let calls = 0;
    const hang = tool(
      "read",
      () => {
        calls += 1;
        return calls === 1
          ? new Promise(() => undefined)
          : Promise.resolve({ kind: "ok", content: "read", progress: true });
      },
      { failureKind: "browser" },
    );
    const result = await runAgentLoop({
      messages: opening,
      model: scripted([
        [call("read")],
        [call("read")],
        [call("finish", { reason: "Done" })],
      ]),
      tools: [hang, finishTool],
      subjectLabel: "the site",
      ceilings: { toolTimeoutMs: 1_000 },
    });
    expect(result.ending).toBe("finished");
    const gaveUp = result.messages.find(
      (message) =>
        message.role === "tool" && message.content.includes("took longer than"),
    );
    expect(gaveUp).toBeDefined();
    expect(result.turnNotes.join("\n")).toContain("took too long");
  });

  test("a stop request lands while the model ignores its abort signal", async () => {
    const controller = new AbortController();
    const pending = runAgentLoop({
      messages: opening,
      model: { chatWithTools: () => new Promise(() => undefined) },
      tools: [finishTool],
      subjectLabel: "the site",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.ending).toBe("aborted");
  });

  test("a stop request lands even while a tool call is hanging", async () => {
    const controller = new AbortController();
    const hang = tool("read", () => new Promise(() => undefined), {
      failureKind: "browser",
    });
    const pending = runAgentLoop({
      messages: opening,
      model: scripted([[call("read")]]),
      tools: [hang, finishTool],
      subjectLabel: "the site",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.ending).toBe("aborted");
  });

  test("a model that answers without a tool is nudged, not ended", async () => {
    const model: AgentLoopModel & { calls: number } = {
      calls: 0,
      chatWithTools: () => {
        model.calls += 1;
        return Promise.resolve(
          model.calls === 1
            ? { content: "thinking out loud" }
            : { content: "", toolCalls: [call("finish", { reason: "Done" })] },
        );
      },
    };
    const result = await runAgentLoop({
      messages: opening,
      model,
      tools: [finishTool],
      subjectLabel: "the site",
    });
    expect(result.ending).toBe("finished");
    expect(result.steps).toBe(2);
  });
});
