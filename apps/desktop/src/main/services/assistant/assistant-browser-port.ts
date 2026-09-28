import { randomUUID } from "node:crypto";

import { createPlaywrightApplyPageMechanics } from "@unemployed/browser-runtime";
import type { ApplyRawPageHands } from "@unemployed/contracts";
import type {
  AssistantBrowserLease,
  AssistantBrowserPort,
} from "@unemployed/job-finder";
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
): AssistantBrowserPort {
  return {
    visibleTab() {
      const state = browser.getState();
      if (state.phase === "closed" || state.presentation === "minimized")
        return null;
      const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
      return tab ? { tabId: tab.id, url: tab.url, title: tab.title } : null;
    },
    lease(input) {
      const leaseId = `assistant_lease_${randomUUID()}`;
      return new Promise<AssistantBrowserLease>((resolve, reject) => {
        let settled = false;
        let release: () => void = () => undefined;
        const released = new Promise<void>((done) => {
          release = done;
        });
        let lentTabId: string | null = input.tabId;
        const work = browser.runAutomation(
          "The assistant is working in this tab",
          undefined,
          async (signal, _updateActivity, claimPage) => {
            if (lentTabId) await browser.lendTab(lentTabId);
            const connection = await browser.connect();
            let page: Page | null = null;
            if (lentTabId) {
              page = await findPageForTab(browser, connection, lentTabId);
            } else {
              const context = connection.contexts()[0];
              if (!context) throw new Error("The browser is not ready.");
              page = await context.newPage();
              if (input.openUrl) {
                await page
                  .goto(input.openUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 20_000,
                  })
                  .catch(() => undefined);
              }
              lentTabId = await browser.identifyAutomationPage(page);
              if (lentTabId) browser.showTab(lentTabId);
            }
            if (!page || !lentTabId) {
              throw new Error(
                "The assistant could not reach that browser tab.",
              );
            }
            claimPage(page);
            let current: Page = page;
            let mechanics: ApplyRawPageHands =
              createPlaywrightApplyPageMechanics(current);
            const children: string[] = [];
            const hands: ApplyRawPageHands = {
              readPage: () => mechanics.readPage(),
              fillText: (ref, value) => mechanics.fillText(ref, value),
              chooseOption: (ref, label) => mechanics.chooseOption(ref, label),
              setToggle: (ref, checked) => mechanics.setToggle(ref, checked),
              uploadFile: (ref, file) => mechanics.uploadFile(ref, file),
              clickAction: (ref) => mechanics.clickAction(ref),
              followLink: (ref) => mechanics.followLink(ref),
              navigate: (url) => mechanics.navigate(url),
              clickElement: (ref) => mechanics.clickElement(ref),
              pressKey: (ref, key) => mechanics.pressKey(ref, key),
              scroll: (direction) => mechanics.scroll(direction),
              wait: (milliseconds) => mechanics.wait(milliseconds),
              goBack: () => mechanics.goBack(),
              readText: (ref) => mechanics.readText(ref),
              // The real popup is adopted, keeping its opener and form state;
              // the lent tab stays open behind it.
              adoptOpenedTab: async (index) => {
                const popups = await popupsOf(current);
                const opened = popups[index];
                if (!opened)
                  return { ok: false, error: "That tab is no longer open." };
                await opened
                  .waitForLoadState("domcontentloaded", { timeout: 5_000 })
                  .catch(() => undefined);
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
              tabId: lentTabId,
              revoked: signal,
              hands,
              currentUrl: () => current.url(),
              childTabIds: () => [...children],
              screenshot: async () => {
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
            settled = true;
            resolve(lease);
            await Promise.race([
              released,
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
