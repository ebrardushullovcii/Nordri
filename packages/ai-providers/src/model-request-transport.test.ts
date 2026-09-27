import { describe, expect, test, vi } from "vitest";
import {
  ModelRequestHttpError,
  ModelRequestTimeoutError,
  computeRetryDelayMs,
  parseRetryAfterMs,
  performModelRequest,
} from "./model-request-transport";

function sseResponse(
  events: readonly string[],
  options: { status?: number; chunkDelayMs?: number; hang?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        if (options.chunkDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.chunkDelayMs),
          );
        }
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      if (!options.hang) {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: options.status ?? 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const baseInput = {
  url: "https://gateway.example/v1/chat/completions",
  headers: { Authorization: "Bearer test" },
  body: { model: "test-model", messages: [] },
  apiMode: "chat_completions" as const,
  totalTimeoutMs: 5_000,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 5,
};

describe("performModelRequest", () => {
  test("sends stream: true and reassembles streamed chat content and tool calls", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as Record<
          string,
          unknown
        >;
        expect(body.stream).toBe(true);
        return sseResponse([
          JSON.stringify({ choices: [{ delta: { role: "assistant" } }] }),
          JSON.stringify({ choices: [{ delta: { content: '{"ok":' } }] }),
          JSON.stringify({ choices: [{ delta: { content: "true}" } }] }),
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "inspect", arguments: '{"a":' },
                    },
                  ],
                },
              },
            ],
          }),
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: "1}" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          "[DONE]",
        ]);
      },
    );

    const payload = await performModelRequest({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.content).toBe('{"ok":true}');
    expect(payload.choices?.[0]?.message?.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "inspect", arguments: '{"a":1}' },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("uses the completed Responses event and ignores reasoning summaries", async () => {
    const fetchImpl = vi.fn(() =>
      sseResponse([
        JSON.stringify({ type: "response.created" }),
        JSON.stringify({
          type: "response.reasoning_summary_text.delta",
          delta: "thinking…",
        }),
        JSON.stringify({ type: "response.output_text.delta", delta: "{" }),
        JSON.stringify({
          type: "response.completed",
          response: {
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: '{"score":92}' }],
              },
              {
                type: "function_call",
                call_id: "call_9",
                name: "prepare",
                arguments: "{}",
              },
            ],
          },
        }),
        JSON.stringify({ type: "ping" }),
      ]),
    );

    const payload = await performModelRequest({
      ...baseInput,
      apiMode: "responses",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.content).toBe('{"score":92}');
    expect(payload.choices?.[0]?.message?.tool_calls?.[0]?.id).toBe("call_9");
  });

  test("accepts a plain JSON body from a gateway that ignores streaming", async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({ choices: [{ message: { content: "plain" } }] }),
    );

    const payload = await performModelRequest({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.content).toBe("plain");
  });

  test("retries a 503 and a network error, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "overloaded" } }, { status: 503 }),
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "done" } }] }),
      );
    const events: string[] = [];

    const payload = await performModelRequest({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (event) => events.push(event.type),
    });

    expect(payload.choices?.[0]?.message?.content).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event === "retry_scheduled")).toHaveLength(
      2,
    );
  });

  test("retries a stream that goes silent and reports the silence when it keeps failing", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() =>
        sseResponse(
          [JSON.stringify({ choices: [{ delta: { content: "par" } }] })],
          { hang: true },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "recovered" } }] }),
      );

    const payload = await performModelRequest({
      ...baseInput,
      idleTimeoutMs: 40,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.content).toBe("recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const alwaysSilent = vi.fn(() => sseResponse([], { hang: true }));
    await expect(
      performModelRequest({
        ...baseInput,
        idleTimeoutMs: 30,
        maxAttempts: 2,
        fetchImpl: alwaysSilent as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/timed out after 0s of silence/);
    expect(alwaysSilent).toHaveBeenCalledTimes(2);
  });

  test("retries a stream the service closed before completing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([JSON.stringify({ type: "response.created" })]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          JSON.stringify({
            type: "response.completed",
            response: { output_text: '{"ok":1}' },
          }),
        ]),
      );

    const payload = await performModelRequest({
      ...baseInput,
      apiMode: "responses",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.content).toBe('{"ok":1}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("retries a chat stream that stopped in the middle of a tool call", async () => {
    const cutOff = sseResponse([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_cut",
                  type: "function",
                  function: {
                    name: "compose_resume_proposal",
                    arguments: '{"summary":"A long proposal that was cu',
                  },
                },
              ],
            },
          },
        ],
      }),
    ]);
    const complete = sseResponse([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_full",
                  type: "function",
                  function: {
                    name: "compose_resume_proposal",
                    arguments: '{"summary":"Done"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
      "[DONE]",
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(cutOff)
      .mockResolvedValueOnce(complete);

    const payload = await performModelRequest({
      ...baseInput,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(payload.choices?.[0]?.message?.tool_calls?.[0]?.function).toEqual({
      name: "compose_resume_proposal",
      arguments: '{"summary":"Done"}',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test.each(["chat_completions", "responses"] as const)(
    "retries %s text that arrives without a completion marker",
    async (apiMode) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          sseResponse([
            JSON.stringify(
              apiMode === "responses"
                ? {
                    type: "response.output_text.delta",
                    delta: '{"partial":true}',
                  }
                : { choices: [{ delta: { content: '{"partial":true}' } }] },
            ),
          ]),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            apiMode === "responses"
              ? { output_text: '{"complete":true}' }
              : { choices: [{ message: { content: '{"complete":true}' } }] },
          ),
        );

      const payload = await performModelRequest({
        ...baseInput,
        apiMode,
        fetchImpl,
      });
      expect(payload.choices?.[0]?.message?.content).toBe('{"complete":true}');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  test("does not release Responses tool calls before the response finishes", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        sseResponse([
          JSON.stringify({
            type: "response.output_item.done",
            item: {
              type: "function_call",
              call_id: "cut_off",
              name: "inspect",
              arguments: "{}",
            },
          }),
        ]),
      ),
    );
    await expect(
      performModelRequest({
        ...baseInput,
        apiMode: "responses",
        maxAttempts: 1,
        fetchImpl,
      }),
    ).rejects.toThrow(/closed the stream before finishing/);
  });

  test("gives up on a chat stream that keeps stopping mid tool call with a plain error", async () => {
    const fetchImpl = vi.fn(() =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_cut",
                    type: "function",
                    function: { name: "inspect", arguments: '{"a":' },
                  },
                ],
              },
            },
          ],
        }),
      ]),
    );

    await expect(
      performModelRequest({
        ...baseInput,
        maxAttempts: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/closed the stream before finishing/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("does not retry a validation error", async () => {
    const fetchImpl = vi.fn(() =>
      jsonResponse({ error: { message: "bad request" } }, { status: 400 }),
    );

    await expect(
      performModelRequest({
        ...baseInput,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ModelRequestHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([true, false])(
    "rejects explicitly incomplete output (streaming %s) without retrying the same token budget",
    async (streaming) => {
      for (const apiMode of ["responses", "chat_completions"] as const) {
        const response =
          apiMode === "responses"
            ? {
                status: "incomplete",
                incomplete_details: { reason: "max_output_tokens" },
                output_text: '{"partial":true}',
              }
            : {
                choices: [
                  {
                    message: { content: '{"partial":true}' },
                    finish_reason: "length",
                  },
                ],
              };
        const fetchImpl = vi.fn(() =>
          Promise.resolve(
            streaming
              ? sseResponse([
                  JSON.stringify(
                    apiMode === "responses"
                      ? { type: "response.incomplete", response }
                      : response,
                  ),
                  "[DONE]",
                ])
              : jsonResponse(response),
          ),
        );
        await expect(
          performModelRequest({ ...baseInput, apiMode, streaming, fetchImpl }),
        ).rejects.toThrow(/incomplete response/);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    },
  );

  test("stops at the total budget with a plain timeout", async () => {
    const fetchImpl = vi.fn(() => sseResponse([], { hang: true }));

    await expect(
      performModelRequest({
        ...baseInput,
        totalTimeoutMs: 60,
        idleTimeoutMs: 1_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ModelRequestTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a caller abort wins over retries", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => {
      controller.abort();
      return jsonResponse(
        { error: { message: "overloaded" } },
        { status: 503 },
      );
    });

    await expect(
      performModelRequest({
        ...baseInput,
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: "AbortError", message: "Aborted" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("retry timing", () => {
  test("honours Retry-After and caps exponential backoff", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000);
    expect(parseRetryAfterMs("not a date")).toBeNull();
    expect(
      computeRetryDelayMs({
        attempt: 0,
        baseDelayMs: 1_000,
        maxDelayMs: 20_000,
        retryAfterMs: 5_000,
        random: () => 0,
      }),
    ).toBe(5_000);
    expect(
      computeRetryDelayMs({
        attempt: 10,
        baseDelayMs: 1_000,
        maxDelayMs: 20_000,
        random: () => 0,
      }),
    ).toBe(20_000);
  });
});
