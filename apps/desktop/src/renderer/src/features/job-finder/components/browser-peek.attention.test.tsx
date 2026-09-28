// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  DesktopBrowserBridge,
  DesktopBrowserState,
} from "@nordri/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserPeek } from "./browser-peek";

const staleAttentionState: DesktopBrowserState = {
  revision: 4,
  phase: "needs_you",
  presentation: "minimized",
  tabs: [],
  activeTabId: null,
  activity: null,
  attention: {
    kind: "user_action",
    title: "This page needs a human",
    detail: "A handoff was waiting.",
  },
  automationPaused: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserPeek handoff attention", () => {
  it("clears the derived browser chip when the workspace has no unresolved handoff", async () => {
    const previousBridge = window.nordri;
    const browser: DesktopBrowserBridge = {
      getState: vi.fn().mockResolvedValue(staleAttentionState),
      command: vi.fn().mockResolvedValue(staleAttentionState),
      setViewport: vi.fn().mockResolvedValue(undefined),
      captureActivePage: vi.fn().mockResolvedValue({ dataUrl: null }),
      listImportSources: vi.fn().mockResolvedValue({ sources: [], note: null }),
      importFromBrowser: vi.fn().mockResolvedValue({
        status: "cancelled",
        cookieCount: 0,
        siteCount: 0,
        message: "Cancelled.",
      }),
      onStateChanged: vi.fn().mockReturnValue(() => undefined),
      onFocusAddress: vi.fn().mockReturnValue(() => undefined),
    };
    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: { browser },
    });

    const view = render(<BrowserPeek hasUnresolvedAttention />);
    expect(
      await screen.findByRole("button", {
        name: /This page needs a human/,
      }),
    ).toBeTruthy();

    view.rerender(<BrowserPeek hasUnresolvedAttention={false} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Job Finder browser.*Ready/i }),
      ).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/This page needs a human/)).toBeNull();

    Object.defineProperty(window, "nordri", {
      configurable: true,
      value: previousBridge,
    });
  });
});
