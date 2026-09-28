import { describe, expect, test } from "vitest";

import {
  createInterviewAudioChunkQueue,
  InterviewAudioChunkQueueDropError,
} from "./interview-audio-chunk-queue";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("interview audio chunk queue", () => {
  test("keeps microphone and system chunks in FIFO order while transcription is slow", async () => {
    const queue = createInterviewAudioChunkQueue();
    const firstChunk = createDeferred();
    const events: string[] = [];

    const microphone = queue.enqueue(async () => {
      events.push("microphone:start");
      await firstChunk.promise;
      events.push("microphone:end");
      return "microphone transcript";
    });
    const system = queue.enqueue(() => {
      events.push("system:start");
      events.push("system:end");
      return Promise.resolve("system transcript");
    });

    await Promise.resolve();
    expect(events).toEqual(["microphone:start"]);

    firstChunk.resolve();

    await expect(Promise.all([microphone, system])).resolves.toEqual([
      "microphone transcript",
      "system transcript",
    ]);
    expect(events).toEqual([
      "microphone:start",
      "microphone:end",
      "system:start",
      "system:end",
    ]);
  });

  test("continues with the next captured chunk after a failed task", async () => {
    const queue = createInterviewAudioChunkQueue();
    const failed = queue.enqueue(() => Promise.reject(new Error("STT failed")));
    const recovered = queue.enqueue(() => Promise.resolve("next transcript"));

    await expect(failed).rejects.toThrow("STT failed");
    await expect(recovered).resolves.toBe("next transcript");
  });

  test("bounds retained audio and drops the oldest pending chunk", async () => {
    const queue = createInterviewAudioChunkQueue({ maxPending: 2 });
    const activeChunk = createDeferred();
    const first = queue.enqueue(async () => {
      await activeChunk.promise;
      return "active";
    });
    const dropped = queue.enqueue(() => Promise.resolve("oldest pending"));
    const second = queue.enqueue(() => Promise.resolve("second"));
    const newest = queue.enqueue(() => Promise.resolve("newest"));

    expect(queue.getSnapshot()).toEqual({
      active: true,
      maxPending: 2,
      pending: 2,
    });
    await expect(dropped).rejects.toBeInstanceOf(
      InterviewAudioChunkQueueDropError,
    );

    activeChunk.resolve();
    await expect(Promise.all([first, second, newest])).resolves.toEqual([
      "active",
      "second",
      "newest",
    ]);
    expect(queue.getSnapshot()).toEqual({
      active: false,
      maxPending: 2,
      pending: 0,
    });
  });

  test("cancels pending chunks without interrupting the active transcription", async () => {
    const queue = createInterviewAudioChunkQueue();
    const activeChunk = createDeferred();
    const active = queue.enqueue(async () => {
      await activeChunk.promise;
      return "active";
    });
    const pending = queue.enqueue(() => Promise.resolve("pending"));

    queue.cancelPending("Session paused.");
    await expect(pending).rejects.toBeInstanceOf(
      InterviewAudioChunkQueueDropError,
    );
    activeChunk.resolve();
    await expect(active).resolves.toBe("active");
  });
});
