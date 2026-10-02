import { describe, expect, test, vi } from "vitest";
import { EmbeddedBrowser } from "./embedded-browser";

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: class {},
  dialog: {},
  screen: {},
  session: {},
  WebContentsView: class {},
}));

function makeBrowser() {
  const browser = new EmbeddedBrowser();
  const state = browser as unknown as {
    pageMap: Map<
      string,
      { id: string; contents: ReturnType<typeof makeContents> }
    >;
    activeTabId: string | null;
    parkedTabs: Map<string, null>;
    heldTabs: Map<string, string[]>;
    personTabs: Set<string>;
    operationClaims: Map<
      AbortController,
      { id: string; owner: null; tabs: Set<string> }
    >;
  };
  const ids = [
    "failed",
    "search",
    "prepared",
    "parked",
    "held",
    "person",
    "working",
  ];
  const pages = new Map(ids.map((id) => [id, makeContents(id)]));
  for (const [id, contents] of pages) state.pageMap.set(id, { id, contents });
  state.activeTabId = "failed";
  return { browser, state, pages };
}

function makeContents(id: string) {
  let closed = false;
  return {
    isDestroyed: () => closed,
    getTitle: () => id,
    getURL: () => `https://jobs.example/${id}`,
    isLoading: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    close: vi.fn(() => {
      closed = true;
    }),
  };
}

describe("embedded browser tab state", () => {
  test("sign-in attention follows its tab instead of the active public listing", async () => {
    const { browser } = makeBrowser();
    browser.requestAttention(
      {
        kind: "sign_in",
        title: "Sign in to continue: Example Jobs",
        detail: "Sign in here.",
      },
      "failed",
    );
    expect(browser.getState().attention?.title).toContain("Example Jobs");
    await browser.command({ type: "select_tab", tabId: "person" });
    expect(browser.getState().attention).toBeNull();
    await browser.command({ type: "select_tab", tabId: "failed" });
    expect(browser.getState().attention?.kind).toBe("sign_in");
  });

  test("cleanup closes only finished tabs and preserves unsent forms and occupied tabs", async () => {
    const { browser, state, pages } = makeBrowser();
    state.parkedTabs.set("parked", null);
    state.heldTabs.set("held", []);
    state.personTabs.add("person");
    state.operationClaims.set(new AbortController(), {
      id: "active",
      owner: null,
      tabs: new Set(["working"]),
    });
    browser.markFinishedTabs([
      "failed",
      "search",
      "parked",
      "held",
      "person",
      "working",
    ]);
    await browser.command({ type: "close_finished_tabs" });
    expect(pages.get("failed")?.close).toHaveBeenCalledOnce();
    expect(pages.get("search")?.close).toHaveBeenCalledOnce();
    for (const id of ["prepared", "parked", "held", "person", "working"])
      expect(pages.get(id)?.close).not.toHaveBeenCalled();
  });
});
