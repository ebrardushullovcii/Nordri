import { EventEmitter } from "node:events";
import type { BrowserContext, Page, Request, Route } from "playwright";
import { expect, test, vi } from "vitest";
import {
  createApplicationRunServiceWorkerSentinel,
  getLatestBlockedPrepareOnlyAttempt,
} from "./playwright-application-flow";

function fakePage(url: string, opener: Page | null = null) {
  const close = vi.fn().mockResolvedValue(undefined);
  const page = {
    url: () => url,
    opener: vi.fn().mockResolvedValue(opener),
    close,
    frames: () => [],
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Page;
  return { page, close };
}

test("two application sentinels leave other tabs, popups, and requests alone", async () => {
  const events = new EventEmitter();
  const handlers: Array<(route: Route) => Promise<void>> = [];
  const context = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    route: vi.fn(
      (_pattern: string, handler: (route: Route) => Promise<void>) => {
        handlers.push(handler);
        return Promise.resolve();
      },
    ),
    unroute: vi.fn().mockResolvedValue(undefined),
    serviceWorkers: () => [],
  } as unknown as BrowserContext;
  const first = fakePage("https://one.example/apply");
  const second = fakePage("https://two.test/apply");
  const person = fakePage("https://person.test/home");
  const firstSentinel = createApplicationRunServiceWorkerSentinel({
    context,
    targetUrl: first.page.url(),
  });
  const secondSentinel = createApplicationRunServiceWorkerSentinel({
    context,
    targetUrl: second.page.url(),
  });
  firstSentinel.attachPage(first.page);
  secondSentinel.attachPage(second.page);
  await Promise.resolve();
  expect(handlers).toHaveLength(2);

  try {
    const personPopup = fakePage("https://person.test/help", person.page);
    const firstPopup = fakePage("https://one.example/help", first.page);
    const secondPopup = fakePage("https://two.test/help", second.page);
    events.emit("page", personPopup.page);
    events.emit("page", firstPopup.page);
    events.emit("page", secondPopup.page);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(personPopup.close).not.toHaveBeenCalled();
    expect(firstPopup.close).toHaveBeenCalledOnce();
    expect(secondPopup.close).toHaveBeenCalledOnce();
    expect(await getLatestBlockedPrepareOnlyAttempt(first.page)).toMatchObject({
      kind: "popup_open",
      url: "https://one.example/help",
    });
    expect(await getLatestBlockedPrepareOnlyAttempt(second.page)).toMatchObject(
      {
        kind: "popup_open",
        url: "https://two.test/help",
      },
    );

    async function postFrom(owner: Page) {
      const request = {
        frame: () => ({ page: () => owner }),
        method: () => "POST",
        resourceType: () => "fetch",
        url: () => `${owner.url()}/save`,
        postData: () => "answer=value",
        headers: () => ({}),
      } as unknown as Request;
      let continued = 0;
      let aborted = 0;
      const dispatch = async (index: number): Promise<void> => {
        if (index < 0) {
          continued += 1;
          return;
        }
        const route = {
          request: () => request,
          fallback: () => dispatch(index - 1),
          continue: () => {
            continued += 1;
            return Promise.resolve();
          },
          abort: () => {
            aborted += 1;
            return Promise.resolve();
          },
        } as unknown as Route;
        await handlers[index]!(route);
      };
      await dispatch(handlers.length - 1);
      return { continued, aborted };
    }

    expect(await postFrom(person.page)).toEqual({ continued: 1, aborted: 0 });
    expect(await getLatestBlockedPrepareOnlyAttempt(second.page)).toMatchObject(
      {
        kind: "popup_open",
        url: "https://two.test/help",
      },
    );
    expect(await postFrom(first.page)).toEqual({ continued: 0, aborted: 1 });
    expect(await getLatestBlockedPrepareOnlyAttempt(first.page)).toMatchObject({
      kind: "network_request",
      method: "POST",
    });
    expect(await getLatestBlockedPrepareOnlyAttempt(second.page)).toMatchObject(
      {
        kind: "popup_open",
        url: "https://two.test/help",
      },
    );
    expect(await postFrom(second.page)).toEqual({ continued: 0, aborted: 1 });
    expect(await getLatestBlockedPrepareOnlyAttempt(second.page)).toMatchObject(
      {
        kind: "network_request",
        method: "POST",
      },
    );

    events.emit("serviceworker", { url: () => "https://two.test/sw.js" });
    expect(firstSentinel.pendingWorkerEventCount()).toBe(0);
    expect(secondSentinel.pendingWorkerEventCount()).toBe(1);
  } finally {
    firstSentinel.detach();
    secondSentinel.detach();
  }
});
