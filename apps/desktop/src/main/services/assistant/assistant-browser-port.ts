import { randomUUID } from "node:crypto";

import { createPlaywrightApplyPageMechanics } from "@nordri/browser-runtime";
import type {
  ApplyRawPageHands,
  JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";
import type {
  AssistantBrowserLease,
  AssistantBrowserPort,
} from "@nordri/job-finder";
import type { Browser, Page } from "playwright";

import type { EmbeddedBrowser } from "../browser/embedded-browser";

/**
 * The assistant works in the tab the person lent it (ADR 0038).
 *
 * A lease is one long automation run in the embedded browser: it claims the
 * lent tab, so the person's click or key there stops exactly this run and
 * takes the tab back. Tabs the page opens are followed for real (the popup
 * keeps its opener and form state) and recorded as the lease's children.
 * Releasing ends the loan; a borrowed tab stays open for the person.
 */

async function findPageForTab(
  browser: EmbeddedBrowser,
  connection: Browser,
  tabId: string,
): Promise<Page | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const context of connection.contexts()) {
      for (const page of context.pages()) {
        if ((await browser.identifyAutomationPage(page)) === tabId) return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function popupsOf(page: Page): Promise<Page[]> {
  const popups: Page[] = [];
  for (const candidate of page.context().pages()) {
    if (candidate === page) continue;
    if ((await candidate.opener().catch(() => null)) === page)
      popups.push(candidate);
  }
  return popups;
}

export function createAssistantBrowserPort(
  browser: EmbeddedBrowser,
  readWorkspace: () => Promise<JobFinderWorkspaceSnapshot>,
): AssistantBrowserPort {
  return {
    async show() {
      await browser.command({ type: "open" });
    },
    visibleTab() {
      const state = browser.getState();
      if (state.phase === "closed" || state.presentation === "minimized")
        return null;
      const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
      return tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null;
    },
    lease(input) {
      input.signal?.throwIfAborted();
      const leaseId = `assistant_lease_${randomUUID()}`;
      return new Promise<AssistantBrowserLease>((resolve, reject) => {
        let settled = false;
        let leaseReleased = false;
        let release: () => void = () => undefined;
        const released = new Promise<void>((done) => {
          release = () => {
            leaseReleased = true;
            done();
          };
        });
        let lentTabId: string | null = input.tabId;
        const work = browser.runAutomation(
          "The assistant is working in this tab",
          undefined,
          async (signal, _updateActivity, claimPage) => {
            const guard = () => {
              if (leaseReleased)
                throw new Error("The browser tab was released.");
              signal.throwIfAborted();
              input.signal?.throwIfAborted();
            };
            guard();
            if (lentTabId) {
              await browser.lendTab(lentTabId);
              browser.showTab(lentTabId);
            }
            const connection = await browser.connect();
            guard();
            let page: Page | null = null;
            if (lentTabId) {
              page = await findPageForTab(browser, connection, lentTabId);
            } else {
              const context = connection.contexts()[0];
              if (!context) throw new Error("The browser is not ready.");
              page = await context.newPage();
              guard();
              if (input.openUrl) {
                await page
                  .goto(input.openUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 20_000,
                  })
                  .catch(() => undefined);
              }
              guard();
              lentTabId = await browser.identifyAutomationPage(page);
              guard();
              if (lentTabId) browser.showTab(lentTabId);
            }
            if (!page || !lentTabId) {
              throw new Error(
                "The assistant could not reach that browser tab.",
              );
            }
            guard();
            claimPage(page);
            let current: Page = page;
            let mechanics: ApplyRawPageHands =
              createPlaywrightApplyPageMechanics(current);
            const children: string[] = [];
            const isApplicationBound = async () => {
              guard();
              // This is the exact preparation mark used by browser-runtime to
              // find a retained form after the person takes its tab back.
              // Never infer a successful binding from the visible tab or URL.
              const binding = await current
                .evaluate(() => {
                  const mark = "__nordriPreparedApplication";
                  const value = (window as unknown as Record<string, unknown>)[
                    mark
                  ];
                  if (typeof value === "string" && value) return value;
                  return window.sessionStorage.getItem(mark);
                })
                .catch(() => null);
              guard();
              if (binding) return true;
              const snapshot = await readWorkspace();
              guard();
              // With no exact mark, protect a page still referenced by a saved
              // preparation. URL matches are only a conservative refusal, never
              // evidence that this is the application's retained tab.
              const records = new Set(
                snapshot.applicationRecords.map((record) => record.id),
              );
              return (
                snapshot.applicationRecords.some(
                  (record) =>
                    record.lastAttemptState !== "submitted" &&
                    record.replaySummary.lastUrl === current.url(),
                ) ||
                snapshot.applyJobResults.some(
                  (result) =>
                    result.applicationRecordId !== null &&
                    records.has(result.applicationRecordId) &&
                    result.reviewCard?.pageUrl === current.url(),
                ) ||
                snapshot.userActionRequests.some(
                  (request) =>
                    request.scope.type === "application" &&
                    request.scope.applicationRecordId !== null &&
                    records.has(request.scope.applicationRecordId) &&
                    request.actionUrl === current.url(),
                )
              );
            };
            const requireEditableTab = async () => {
              if (await isApplicationBound())
                throw new Error(
                  "This tab holds a prepared application. I can read it, but cannot edit or leave it here. Use browser_open for unrelated pages so the form and attachments stay intact.",
                );
              guard();
            };
            const hands: ApplyRawPageHands = {
              readPage: () => {
                guard();
                return mechanics.readPage();
              },
              fillText: async (ref, value) => {
                await requireEditableTab();
                return mechanics.fillText(ref, value);
              },
              chooseOption: async (ref, label) => {
                await requireEditableTab();
                return mechanics.chooseOption(ref, label);
              },
              setToggle: async (ref, checked) => {
                await requireEditableTab();
                return mechanics.setToggle(ref, checked);
              },
              uploadFile: async (ref, file) => {
                await requireEditableTab();
                return mechanics.uploadFile(ref, file);
              },
              clickAction: async (ref) => {
                await requireEditableTab();
                return mechanics.clickAction(ref);
              },
              followLink: async (ref) => {
                await requireEditableTab();
                return mechanics.followLink(ref);
              },
              navigate: async (url) => {
                await requireEditableTab();
                return mechanics.navigate(url);
              },
              clickElement: async (ref) => {
                await requireEditableTab();
                return mechanics.clickElement(ref);
              },
              pressKey: async (ref, key) => {
                await requireEditableTab();
                return mechanics.pressKey(ref, key);
              },
              scroll: (direction) => {
                guard();
                return mechanics.scroll(direction);
              },
              wait: (milliseconds) => {
                guard();
                return mechanics.wait(milliseconds);
              },
              goBack: async () => {
                await requireEditableTab();
                return mechanics.goBack();
              },
              readText: (ref) => {
                guard();
                return mechanics.readText(ref);
              },
              // The real popup is adopted, keeping its opener and form state;
              // the lent tab stays open behind it.
              adoptOpenedTab: async (index) => {
                guard();
                const popups = await popupsOf(current);
                const opened = popups[index];
                if (!opened)
                  return { ok: false, error: "That tab is no longer open." };
                await opened
                  .waitForLoadState("domcontentloaded", { timeout: 5_000 })
                  .catch(() => undefined);
                guard();
                const childId = await browser.identifyAutomationPage(opened);
                if (childId) {
                  children.push(childId);
                  claimPage(opened);
                  browser.showTab(childId);
                }
                current = opened;
                mechanics = createPlaywrightApplyPageMechanics(current);
                return { ok: true, url: current.url() };
              },
            };
            const lease: AssistantBrowserLease = {
              leaseId,
              borrowed: input.tabId !== null,
              isApplicationBound,
              tabId: lentTabId,
              revoked: signal,
              hands,
              currentUrl: () => current.url(),
              childTabIds: () => [...children],
              screenshot: async () => {
                guard();
                const buffer = await current
                  .screenshot({ type: "jpeg", quality: 70, timeout: 10_000 })
                  .catch(() => null);
                return buffer
                  ? {
                      dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
                    }
                  : null;
              },
              release: () => {
                release();
                return Promise.resolve();
              },
            };
            guard();
            settled = true;
            resolve(lease);
            await Promise.race([
              released,
              new Promise<void>((done) => {
                if (input.signal?.aborted) done();
                else
                  input.signal?.addEventListener("abort", () => done(), {
                    once: true,
                  });
              }),
              new Promise<void>((done) =>
                signal.addEventListener("abort", () => done(), { once: true }),
              ),
            ]);
          },
          { owner: `assistant:${input.conversationId}` },
        );
        void work
          .catch((error: unknown) => {
            if (!settled) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          })
          .finally(() => {
            if (lentTabId) browser.endLoan(lentTabId);
          });
      });
    },
  };
}
