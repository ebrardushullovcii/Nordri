export type EmbeddedBrowserFocusAction =
  | { type: "none" }
  /** Hide the banner for this tab; nothing stops. */
  | { type: "dismiss_attention" }
  /** The person takes this tab over: stop exactly these runs, nothing else. */
  | { type: "take_tab"; operationIds: string[] };

export interface EmbeddedBrowserFocusOperation {
  id: string;
  /** Tabs this run is known to be working in; empty when not yet known. */
  tabIds: readonly string[];
}

/**
 * What a person's click or keypress on one tab does (ADR 0024: stepping in
 * hands over that tab, and nothing else pauses).
 *
 * - A tab the person already holds: nothing more happens.
 * - A tab a run is working in: that run stops, and only that run.
 * - A tab parked for the person (a sign-in, a check): helping there is
 *   task-local; it never stops work in other tabs, however many clicks and
 *   keystrokes it takes.
 * - Any other tab: nothing stops. A run must claim its tab before using it.
 */
export function getEmbeddedBrowserFocusAction(input: {
  focusedTabId: string;
  operations: readonly EmbeddedBrowserFocusOperation[];
  parked: boolean;
  held: boolean;
  bannerOnTab: boolean;
  handoverPending: boolean;
  /**
   * The person is closing this tab rather than stepping into it. Only runs
   * that work in it stop: a run with no tab yet (an application waiting for
   * a free tab) was stopped as "you took over" by the close that freed one.
   */
  closingTab?: boolean;
}): EmbeddedBrowserFocusAction {
  if (input.held || input.handoverPending) return { type: "none" };
  const owners = input.operations
    .filter((operation) => operation.tabIds.includes(input.focusedTabId))
    .map((operation) => operation.id);
  if (owners.length > 0) return { type: "take_tab", operationIds: owners };
  if (input.parked) {
    return input.bannerOnTab ? { type: "dismiss_attention" } : { type: "none" };
  }
  if (input.closingTab) return { type: "none" };
  return input.bannerOnTab ? { type: "dismiss_attention" } : { type: "none" };
}
