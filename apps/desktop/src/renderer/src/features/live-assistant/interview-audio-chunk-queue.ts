export interface InterviewAudioChunkQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  cancelPending(reason?: string): void;
  getSnapshot(): InterviewAudioChunkQueueSnapshot;
}

export interface InterviewAudioChunkQueueSnapshot {
  active: boolean;
  maxPending: number;
  pending: number;
}

export class InterviewAudioChunkQueueDropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewAudioChunkQueueDropError";
  }
}

export function isInterviewAudioChunkQueueDropError(
  error: unknown,
): error is InterviewAudioChunkQueueDropError {
  return error instanceof InterviewAudioChunkQueueDropError;
}

interface PendingAudioChunkTask {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export function createInterviewAudioChunkQueue(options?: {
  maxPending?: number;
}): InterviewAudioChunkQueue {
  const maxPending = Math.max(1, Math.floor(options?.maxPending ?? 4));
  const pendingTasks: PendingAudioChunkTask[] = [];
  let active = false;

  function getSnapshot(): InterviewAudioChunkQueueSnapshot {
    return {
      active,
      maxPending,
      pending: pendingTasks.length,
    };
  }

  function pump() {
    if (active) return;
    const nextTask = pendingTasks.shift();
    if (!nextTask) return;

    active = true;
    void nextTask
      .task()
      .then(nextTask.resolve, nextTask.reject)
      .finally(() => {
        active = false;
        pump();
      });
  }

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (pendingTasks.length >= maxPending) {
          const droppedTask = pendingTasks.shift();
          droppedTask?.reject(
            new InterviewAudioChunkQueueDropError(
              "The STT backlog was full, so the oldest pending audio chunk was discarded.",
            ),
          );
        }

        pendingTasks.push({
          task,
          resolve: (value) => resolve(value as T),
          reject,
        });
        pump();
      });
    },
    cancelPending(reason = "Pending audio transcription was cancelled.") {
      for (const pendingTask of pendingTasks.splice(0)) {
        pendingTask.reject(new InterviewAudioChunkQueueDropError(reason));
      }
    },
    getSnapshot,
  };
}
