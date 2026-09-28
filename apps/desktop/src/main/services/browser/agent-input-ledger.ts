/**
 * Tells the agent's pointer presses from the person's by where they came
 * from, not by whether the cursor moved (ADR 0024, ADR 0034, ADR 0038).
 *
 * Every press automation sends over CDP is noted here before it reaches the
 * page; the page then reports it back as a mouse-down. A mouse-down with a
 * noted press waiting is the agent's and uses that note up. One with none
 * waiting is the person's own click, even when their pointer has not moved
 * since their last click. A note that no mouse-down claimed goes stale, so
 * a press the page never reported cannot swallow a later real click.
 */
export function createAgentInputLedger(
  options: { staleAfterMs?: number } = {},
) {
  const staleAfterMs = options.staleAfterMs ?? 1_500;
  const pending = new Map<string, number[]>();
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
    forget(pageId: string): void {
      pending.delete(pageId);
    },
  };
}
