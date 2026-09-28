import { describe, expect, it } from "vitest";

import { ASSISTANT_LANE_CASES, uncoveredInventoryEntries } from "./cases";
import { runAssistantLaneCase } from "./run";

describe("assistant eval lane", () => {
  it("has a case for every inventory entry mapped to tools", () => {
    expect(uncoveredInventoryEntries()).toEqual([]);
  });

  const scripted = ASSISTANT_LANE_CASES.filter((evalCase) => evalCase.scripted);

  it.each(scripted.map((evalCase) => [evalCase.id, evalCase] as const))(
    "passes %s on the scripted model",
    async (_id, evalCase) => {
      const result = await runAssistantLaneCase(evalCase, "scripted", {
        turnTimeoutMs: 20_000,
      });
      expect(result.error, result.error ?? "").toBeNull();
      expect(result.failures).toEqual([]);
    },
    30_000,
  );
});
