import { describe, expect, test } from "vitest";

import { createJobFinderAiClientFromEnvironment } from "./index";
import {
  PROFILE_ASSISTANT_UNFINISHED_MESSAGE,
  ProfileCopilotUnfinishedError,
} from "./openai-compatible";
import {
  createEnvironment,
  createPreferences,
  createProfile,
} from "./test-fixtures";

type ToolCall = { name: string; arguments: Record<string, unknown> };

const readContext: ToolCall = { name: "read_profile_context", arguments: {} };
const addStaffDesigner: ToolCall = {
  name: "set_profile_list_fields",
  arguments: {
    summary: "Add Staff Designer to target roles",
    fields: { targetRoles: ["Staff Designer"] },
  },
};
const finish: ToolCall = { name: "finish_task", arguments: {} };

/** Answers each model turn with the next scripted set of tool calls. */
function mockToolTurns(turns: readonly (readonly ToolCall[])[]) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    const turn = turns[Math.min(calls, turns.length - 1)] ?? [];
    calls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: turn.map((call, index) => ({
                  id: `call_${calls}_${index}`,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  return {
    callCount: () => calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function revise(request: string) {
  const client = createJobFinderAiClientFromEnvironment(createEnvironment());
  return client.reviseCandidateProfile({
    profile: createProfile(),
    searchPreferences: createPreferences(),
    context: { surface: "profile", section: "basics" },
    relevantReviewItems: [],
    request,
  });
}

describe("Profile Assistant runs that stop before finishing", () => {
  test("keeps the cards a run prepared before it stopped", async () => {
    // Live, a run that circled after proposing was thrown away whole and the
    // built-in editor answered with no card.
    const mock = mockToolTurns([
      [addStaffDesigner],
      [readContext],
      [readContext],
      [readContext],
      [readContext],
    ]);
    try {
      const reply = await revise("Add Staff Designer to my target roles.");

      expect(reply.patchGroups).toHaveLength(1);
      expect(reply.patchGroups[0]?.operations[0]).toEqual({
        operation: "replace_profile_list_fields",
        value: { targetRoles: ["Staff Designer"] },
      });
      expect(reply.executionReceipt?.stopReason).toBe("no_progress");
      expect(reply.executionReceipt?.fallbackUsed).toBe(false);
      // No second run once cards exist.
      expect(mock.callCount()).toBe(5);
    } finally {
      mock.restore();
    }
  });

  test("starts one fresh run when the first stopped with nothing prepared", async () => {
    const mock = mockToolTurns([
      [readContext],
      [readContext],
      [readContext],
      [readContext],
      [addStaffDesigner],
      [finish],
    ]);
    try {
      const reply = await revise("Add Staff Designer to my target roles.");

      expect(reply.executionReceipt?.stopReason).toBe("completed");
      expect(reply.executionReceipt?.fallbackUsed).toBe(false);
      expect(reply.patchGroups).toHaveLength(1);
      expect(mock.callCount()).toBe(6);
    } finally {
      mock.restore();
    }
  });

  test("fails with a plain sentence instead of a non-answer when neither run nor the built-in editor prepared anything", async () => {
    const mock = mockToolTurns([[readContext]]);
    try {
      const attempt = revise("Tidy up the part we talked about earlier.");

      await expect(attempt).rejects.toBeInstanceOf(
        ProfileCopilotUnfinishedError,
      );
      await expect(attempt).rejects.toThrow(
        PROFILE_ASSISTANT_UNFINISHED_MESSAGE,
      );
      // Two runs of four turns each, never a third.
      expect(mock.callCount()).toBe(8);
    } finally {
      mock.restore();
    }
  });
});
