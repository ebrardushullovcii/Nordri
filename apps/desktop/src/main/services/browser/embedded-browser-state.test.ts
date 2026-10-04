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
    ownedTabs: Map<string, Set<string>>;
    closeReleasedOwnedTabs(): void;
    operations: Map<AbortController, string>;
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
    mainFrame: {
      framesInSubtree: [{ executeJavaScript: vi.fn(() => Promise.resolve()) }],
    },
    executeJavaScript: vi.fn(() =>
      Promise.resolve({ title: id, bodyText: "Application received" }),
    ),
    close: vi.fn(() => {
      closed = true;
    }),
  };
}

describe("embedded browser tab state", () => {
  test("releasing a finished owner closes its own tabs, never one the person has", () => {
    const { browser, state, pages } = makeBrowser();
    state.ownedTabs.set("sent_result", new Set(["failed", "held", "parked"]));
    state.ownedTabs.set("waiting_result", new Set(["prepared"]));
    state.heldTabs.set("held", ["sent_result"]);
    state.parkedTabs.set("parked", null);
    browser.releaseOwnedTabs("sent_result");
    expect(pages.get("failed")?.close).toHaveBeenCalledOnce();
    expect(pages.get("held")?.close).not.toHaveBeenCalled();
    expect(pages.get("parked")?.close).not.toHaveBeenCalled();
    expect(pages.get("prepared")?.close).not.toHaveBeenCalled();
    expect(state.ownedTabs.has("sent_result")).toBe(false);
  });

  test("a form the person opened to finish becomes their tab when it is sent", () => {
    const { browser, state, pages } = makeBrowser();
    state.ownedTabs.set("sent_result", new Set(["prepared"]));
    browser.releaseOwnedTabs("sent_result", { keepForPerson: true });
    expect(pages.get("prepared")?.close).not.toHaveBeenCalled();
    expect(state.personTabs.has("prepared")).toBe(true);
    expect(state.ownedTabs.has("sent_result")).toBe(false);
  });

  test("an owner release waits until the operation using its tab ends", () => {
    const { browser, state, pages } = makeBrowser();
    const controller = new AbortController();
    state.ownedTabs.set("result", new Set(["working"]));
    state.operationClaims.set(controller, {
      id: "active",
      owner: null,
      tabs: new Set(["working"]),
    });
    browser.releaseOwnedTabs("result");
    expect(pages.get("working")?.close).not.toHaveBeenCalled();
    state.operationClaims.delete(controller);
    state.closeReleasedOwnedTabs();
    expect(pages.get("working")?.close).toHaveBeenCalledOnce();
  });

  test("a retry transfers ownership so releasing the old result cannot close the form", () => {
    const { browser, state, pages } = makeBrowser();
    state.ownedTabs.set("previous_result", new Set(["prepared"]));
    browser.transferOwnedTabs("previous_result", "retry_result");
    browser.releaseOwnedTabs("previous_result");
    expect(pages.get("prepared")?.close).not.toHaveBeenCalled();
    browser.releaseOwnedTabs("retry_result");
    expect(pages.get("prepared")?.close).toHaveBeenCalledOnce();
  });

  test("a retry reclaims its held page without reclaiming unrelated tabs", async () => {
    const { browser, state } = makeBrowser();
    state.ownedTabs.set("result", new Set(["held"]));
    state.heldTabs.set("held", ["result"]);
    state.heldTabs.set("prepared", ["other_result"]);
    state.personTabs.add("held");
    vi.spyOn(browser, "getOpenBrowser").mockResolvedValue(null);
    await browser.reclaimOwnedTabs("result");
    expect(state.heldTabs.has("held")).toBe(false);
    expect(state.personTabs.has("held")).toBe(false);
    expect(state.heldTabs.has("prepared")).toBe(true);
  });

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

test("waiting forms release working capacity but a resumed form counts again", () => {
  const { browser, state } = makeBrowser();
  state.ownedTabs.set("prepared_result", new Set(["prepared"]));
  state.parkedTabs.set("parked", null);
  expect(browser.openTabCount()).toBe(7);
  expect(browser.workingTabCount()).toBe(5);
  state.operationClaims.set(new AbortController(), {
    id: "resuming",
    owner: null,
    tabs: new Set(["prepared"]),
  });
  expect(browser.workingTabCount()).toBe(6);
});

test("opening a new reading tab leaves the active application's operation running", async () => {
  const { browser, state } = makeBrowser();
  const controller = new AbortController();
  state.activeTabId = "working";
  state.operations.set(controller, "Preparing application");
  state.operationClaims.set(controller, {
    id: "application",
    owner: null,
    tabs: new Set(["working"]),
  });
  const open = vi
    .spyOn(
      browser as unknown as { openPersonTab(url: string): void },
      "openPersonTab",
    )
    .mockImplementation(() => undefined);
  await browser.command({ type: "new_tab" });
  expect(open).toHaveBeenCalledWith("about:blank");
  expect(controller.signal.aborted).toBe(false);
  expect(state.heldTabs.has("working")).toBe(false);
});

test("eight working and eight waiting tabs reach the total cap", () => {
  const { browser, state } = makeBrowser();
  state.pageMap.clear();
  for (let i = 0; i < 16; i++) {
    const id = `tab_${i}`;
    state.pageMap.set(id, { id, contents: makeContents(id) });
    if (i < 8) state.ownedTabs.set(`waiting_${i}`, new Set([id]));
  }
  expect(browser.workingTabCount()).toBe(8);
  expect(
    (browser as unknown as { hasTabCapacity(): boolean }).hasTabCapacity(),
  ).toBe(false);
  state.pageMap.delete("tab_15");
  expect(browser.workingTabCount()).toBe(7);
  expect(
    (browser as unknown as { hasTabCapacity(): boolean }).hasTabCapacity(),
  ).toBe(true);
});

test.each(["pointer", "key"] as const)(
  "a person's own %s input unlocks an idle waiting form and its receipt read",
  async (kind) => {
    const { browser, state, pages } = makeBrowser();
    const native = browser as unknown as {
      handleUserInput(
        id: string,
        kind: "pointer" | "key",
        key?: { code: string; key: string },
      ): void;
      isPointerOverPage(): boolean;
    };
    vi.spyOn(native, "isPointerOverPage").mockReturnValue(true);
    state.ownedTabs.set("waiting_result", new Set(["prepared"]));
    native.handleUserInput("prepared", kind, { code: "Enter", key: "Enter" });
    expect(
      pages.get("prepared")?.mainFrame.framesInSubtree[0]?.executeJavaScript,
    ).toHaveBeenCalledWith(
      expect.stringContaining("finalActionAllowed = true"),
    );
    expect(
      await browser.readApplicationPageWithPerson("waiting_result"),
    ).toMatchObject({ bodyText: "Application received" });
    expect(
      await browser.readApplicationPageWithPerson("other_result"),
    ).toBeNull();
  },
);

test.each(["pointer", "key"] as const)(
  "automation %s input cannot unlock the person's send guard",
  async (kind) => {
    const { browser, state, pages } = makeBrowser();
    const native = browser as unknown as {
      handleUserInput(
        id: string,
        kind: "pointer" | "key",
        key?: { code: string; key: string },
      ): void;
      agentPresses: {
        notePress(id: string): void;
        noteKey(id: string, key: { code: string; key: string }): void;
      };
    };
    state.ownedTabs.set("waiting_result", new Set(["prepared"]));
    if (kind === "pointer") native.agentPresses.notePress("prepared");
    else
      native.agentPresses.noteKey("prepared", { code: "Enter", key: "Enter" });
    native.handleUserInput("prepared", kind, { code: "Enter", key: "Enter" });
    expect(
      pages.get("prepared")?.mainFrame.framesInSubtree[0]?.executeJavaScript,
    ).not.toHaveBeenCalled();
    expect(
      await browser.readApplicationPageWithPerson("waiting_result"),
    ).toBeNull();
  },
);

test("close finished tabs explains when there is nothing eligible", async () => {
  const { browser } = makeBrowser();
  await browser.command({ type: "close_finished_tabs" });
  expect(browser.getState().attention?.title).toBe("No finished tabs to close");
  expect(browser.getState().attention?.detail).toContain("Close a tab");
});

test("handing a native-owned form back closes its person guard before automation can use it", async () => {
  const { browser, state, pages } = makeBrowser();
  state.ownedTabs.set("result", new Set(["prepared"]));
  const native = browser as unknown as {
    handleUserInput(
      id: string,
      kind: "key",
      key: { code: string; key: string },
    ): void;
  };
  native.handleUserInput("prepared", "key", { code: "Enter", key: "Enter" });
  vi.spyOn(browser, "getOpenBrowser").mockResolvedValue(null);
  await browser.reclaimOwnedTabs("result");
  expect(
    pages.get("prepared")?.mainFrame.framesInSubtree[0]?.executeJavaScript,
  ).toHaveBeenLastCalledWith(
    expect.stringContaining("finalActionAllowed = false"),
  );
  expect(await browser.readApplicationPageWithPerson("result")).toBeNull();
});
