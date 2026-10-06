import { expect, test } from "vitest";
import { round3SearchRun } from "../../lib/discovery-round3.test-fixture";
import { getRunOptions } from "./discovery-history-utils";
test("search history sorts distinct runs newest first by start time", () => {
  const older = {
    ...round3SearchRun(),
    id: "older",
    startedAt: "2026-10-03T10:00:00.000Z",
  };
  const newer = {
    ...round3SearchRun(),
    id: "newer",
    startedAt: "2026-10-05T10:00:00.000Z",
  };
  expect(
    getRunOptions(null, older, [older, newer]).map((run) => run.id),
  ).toEqual(["newer", "older"]);
});
