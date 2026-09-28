import { describe, expect, it } from "vitest";

import { createAgentInputLedger } from "./agent-input-ledger";

describe("telling the agent's clicks from the person's", () => {
  it("counts each press the agent sent as the agent's, once", () => {
    const ledger = createAgentInputLedger();
    ledger.notePress("tab_1", 1_000);
    expect(ledger.claimPress("tab_1", 1_010)).toBe(true);
    // The next mouse-down has no agent press behind it: the person clicked.
    expect(ledger.claimPress("tab_1", 1_020)).toBe(false);
  });

  it("takes a repeat click at the same spot as the person's", () => {
    const ledger = createAgentInputLedger();
    // Two clicks without moving the cursor, with agent work in between.
    expect(ledger.claimPress("tab_1", 1_000)).toBe(false);
    ledger.notePress("tab_1", 2_000);
    expect(ledger.claimPress("tab_1", 2_005)).toBe(true);
    expect(ledger.claimPress("tab_1", 2_100)).toBe(false);
  });

  it("counts a click right after the agent's own press as the person's once that press is used", () => {
    const ledger = createAgentInputLedger();
    ledger.notePress("tab_1", 5_000);
    expect(ledger.claimPress("tab_1", 5_002)).toBe(true);
    expect(ledger.claimPress("tab_1", 5_200)).toBe(false);
  });

  it("keeps tabs apart and lets an unreported press go stale", () => {
    const ledger = createAgentInputLedger({ staleAfterMs: 1_500 });
    ledger.notePress("tab_1", 1_000);
    expect(ledger.claimPress("tab_2", 1_001)).toBe(false);
    expect(ledger.claimPress("tab_1", 4_000)).toBe(false);
  });
});
