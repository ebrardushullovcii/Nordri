import type { AssistantResumeBatchState } from "@nordri/contracts";
import { beforeEach, expect, it } from "vitest";
import {
  clearUiResumeBatch,
  readUiResumeBatch,
  stopUiResumeBatch,
  syncUiResumeBatch,
} from "./ui-resume-batch";

const state: AssistantResumeBatchState = {
  id: "ui_batch",
  jobIds: ["one", "two", "three"],
  activeJobIds: ["one", "two"],
  completedJobIds: [],
  done: false,
  stopRequested: false,
};
beforeEach(clearUiResumeBatch);

it("stops a UI queue and fences later dispatch even before the renderer receives the stop event", () => {
  syncUiResumeBatch(state);
  expect(stopUiResumeBatch()).toMatchObject({
    stopRequested: true,
    activeJobIds: ["one", "two"],
  });
  expect(
    syncUiResumeBatch({ ...state, activeJobIds: ["three"] }).stopRequested,
  ).toBe(true);
  expect(readUiResumeBatch()?.stopRequested).toBe(true);
  syncUiResumeBatch({ ...state, activeJobIds: [], done: true });
  expect(readUiResumeBatch()).toBeNull();
  expect(syncUiResumeBatch({ ...state, id: "next_batch" }).stopRequested).toBe(
    false,
  );
});

it("does not expose mutable state or keep work after the renderer reloads", () => {
  syncUiResumeBatch(state);
  readUiResumeBatch()!.activeJobIds.length = 0;
  expect(readUiResumeBatch()?.activeJobIds).toEqual(["one", "two"]);
  clearUiResumeBatch();
  expect(readUiResumeBatch()).toBeNull();
});

it("an interrupted receipt does not keep the old UI scheduler locked", () => {
  syncUiResumeBatch({ ...state, running: false, activeJobIds: [] });
  expect(readUiResumeBatch()).toBeNull();
  expect(() =>
    syncUiResumeBatch({ ...state, id: "continued", running: true }),
  ).not.toThrow();
});
