/**
 * Tells the agent's pointer presses and keys from the person's by where they came
 * from, not by whether the cursor moved (ADR 0024, ADR 0034, ADR 0038).
 *
 * Every press automation sends over CDP is noted here before it reaches the
 * page; the page then reports it back as a mouse-down. A mouse-down with a
 * noted press waiting is the agent's and uses that note up. One with none
 * waiting is the person's own click, even when their pointer has not moved
 * since their last click. A note that no mouse-down claimed goes stale, so
 * a press the page never reported cannot swallow a later real click.
 * Key-downs are matched by their code, so nearby human typing is not ignored.
 */
export function createAgentInputLedger(
  options: { staleAfterMs?: number } = {},
) {
  const staleAfterMs = options.staleAfterMs ?? 1_500;
  const pending = new Map<string, number[]>();
  const pendingKeys = new Map<
    string,
    Array<{ code: string; key: string; at: number }>
  >();
  const fresh = (pageId: string, now: number) => {
    const kept = (pending.get(pageId) ?? []).filter(
      (at) => now - at < staleAfterMs,
    );
    if (kept.length > 0) pending.set(pageId, kept);
    else pending.delete(pageId);
    return kept;
  };
  return {
    /** Automation is about to press a pointer button in this page. */
    notePress(pageId: string, now = Date.now()): void {
      pending.set(pageId, [...fresh(pageId, now), now]);
    },
    /** True when this mouse-down is the agent's own press. */
    claimPress(pageId: string, now = Date.now()): boolean {
      const kept = fresh(pageId, now);
      if (kept.length === 0) return false;
      kept.shift();
      if (kept.length > 0) pending.set(pageId, kept);
      else pending.delete(pageId);
      return true;
    },
    /** Automation is about to send this key-down to the page. */
    noteKey(
      pageId: string,
      input: { code: string; key: string },
      now = Date.now(),
    ): void {
      const kept = (pendingKeys.get(pageId) ?? []).filter(
        (entry) => now - entry.at < staleAfterMs,
      );
      pendingKeys.set(pageId, [...kept, { ...input, at: now }]);
    },
    /** Match only the corresponding agent key, never nearby human input. */
    claimKey(
      pageId: string,
      input: { code: string; key: string },
      now = Date.now(),
    ): boolean {
      const kept = (pendingKeys.get(pageId) ?? []).filter(
        (entry) => now - entry.at < staleAfterMs,
      );
      const index = kept.findIndex((entry) =>
        entry.code && input.code
          ? entry.code === input.code
          : entry.key.toLowerCase() === input.key.toLowerCase(),
      );
      if (index >= 0) kept.splice(index, 1);
      if (kept.length > 0) pendingKeys.set(pageId, kept);
      else pendingKeys.delete(pageId);
      return index >= 0;
    },
    forget(pageId: string): void {
      pending.delete(pageId);
      pendingKeys.delete(pageId);
    },
  };
}
