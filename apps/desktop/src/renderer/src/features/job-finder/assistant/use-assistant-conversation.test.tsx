// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  AssistantConversationSchema,
  AssistantMessageSchema,
} from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssistantConversation } from "./use-assistant-conversation";

const conversation = (id: string) =>
  AssistantConversationSchema.parse({
    id,
    title: id,
    status: "active",
    source: "assistant",
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
  });
const message = (id: string, conversationId: string) =>
  AssistantMessageSchema.parse({
    id,
    conversationId,
    role: "user",
    origin: "sidebar",
    createdAt: "2026-09-27T10:00:00.000Z",
    parts: [{ type: "text", text: id }],
  });
const view = (id: string, ids: string[], hasOlderMessages = false) => ({
  conversation: conversation(id),
  messages: ids.map((entry) => message(entry, id)),
  hasOlderMessages,
  activeTurn: null,
  activity: null,
  draftText: null,
  plans: [],
  lastSequence: 0,
  pendingMessageIds: [],
});

function setup() {
  let resolveOlder!: (result: ReturnType<typeof view>) => void;
  let rejectOlder!: (error: Error) => void;
  const older = new Promise<ReturnType<typeof view>>((resolve, reject) => {
    resolveOlder = resolve;
    rejectOlder = reject;
  });
  const readConversation = vi.fn(
    (input: { conversationId: string; beforeMessageId?: string }) =>
      input.beforeMessageId
        ? older
        : Promise.resolve(
            view(
              input.conversationId,
              [`${input.conversationId}_latest`],
              true,
            ),
          ),
  );
  const bridge = {
    getStatus: vi.fn(() => Promise.resolve({ available: true })),
    listConversations: vi.fn(() =>
      Promise.resolve({
        conversations: [conversation("first"), conversation("second")],
        currentConversationId: "first",
      }),
    ),
    readConversation,
    onEvent: vi.fn(() => () => undefined),
    selectConversation: vi.fn(() => Promise.resolve()),
  };
  (window as unknown as { nordri: unknown }).nordri = {
    assistant: bridge,
  };
  const hook = renderHook(() =>
    useAssistantConversation({ onOpenRoute: () => undefined }),
  );
  return { ...hook, readConversation, resolveOlder, rejectOlder };
}

afterEach(() => {
  cleanup();
  delete (window as { nordri?: unknown }).nordri;
});

describe("assistant older history", () => {
  it("loads a page once when repeated scroll events arrive before it returns", async () => {
    const { result, readConversation, resolveOlder } = setup();
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadOlder();
      void result.current.loadOlder();
    });
    expect(
      readConversation.mock.calls.filter(([input]) => input.beforeMessageId),
    ).toHaveLength(1);
    await act(async () => {
      resolveOlder(view("first", ["older", "first_latest"]));
      await pending;
    });
    expect(result.current.state.messages.map((entry) => entry.id)).toEqual([
      "older",
      "first_latest",
    ]);
  });

  it("does not put the previous chat's older messages into a newly selected chat", async () => {
    const { result, resolveOlder } = setup();
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadOlder();
    });
    await act(() => result.current.selectConversation("second"));
    await act(async () => {
      resolveOlder(view("first", ["older"]));
      await pending;
    });
    expect(result.current.state.conversationId).toBe("second");
    expect(result.current.state.messages.map((entry) => entry.id)).toEqual([
      "second_latest",
    ]);
  });

  it("keeps history after a failed load and clears the error when retry succeeds", async () => {
    const { result, readConversation, rejectOlder } = setup();
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadOlder();
    });
    await act(async () => {
      rejectOlder(new Error("offline"));
      await pending;
    });
    expect(result.current.state.error).not.toBeNull();
    expect(result.current.state.messages.map((entry) => entry.id)).toEqual([
      "first_latest",
    ]);
    readConversation.mockResolvedValueOnce(view("first", ["older"]));
    await act(() => result.current.loadOlder());
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.messages.map((entry) => entry.id)).toEqual([
      "older",
      "first_latest",
    ]);
  });
});
