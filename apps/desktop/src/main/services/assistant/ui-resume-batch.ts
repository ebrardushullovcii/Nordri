import type { AssistantResumeBatchState } from "@nordri/contracts";

/** The UI publishes its queue and checks this stop flag before each dispatch. */
let batch: AssistantResumeBatchState | null = null;

export function syncUiResumeBatch(
  state: AssistantResumeBatchState,
): AssistantResumeBatchState {
  if (
    batch &&
    !batch.done &&
    batch.running !== false &&
    batch.id !== state.id
  ) {
    throw new Error("A resume batch is already running.");
  }
  batch = structuredClone({
    ...state,
    stopRequested:
      state.stopRequested || (batch?.id === state.id && batch.stopRequested),
  });
  return structuredClone(batch);
}

export function readUiResumeBatch(): AssistantResumeBatchState | null {
  return batch && !batch.done && batch.running !== false
    ? structuredClone(batch)
    : null;
}

export function stopUiResumeBatch(): AssistantResumeBatchState | null {
  if (batch && !batch.done) batch.stopRequested = true;
  return readUiResumeBatch();
}

export function clearUiResumeBatch(): void {
  batch = null;
}
