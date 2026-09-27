// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {} from "./profile-copilot-rail-layout";
import { ProfileCopilotRail } from "./profile-copilot-rail";

describe("ProfileCopilotRail", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("floats at the right edge without reserving page space and exposes a draggable open panel", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "setup", step: "targeting" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    const rail = bubble?.parentElement;

    expect(bubble).not.toBeNull();
    expect(bubble?.className).toContain("cursor-pointer");
    expect(bubble?.className).toContain("size-12");
    expect(rail?.className).toContain("fixed");
    expect(rail?.style.left).toBe("");
    expect(rail?.style.right).toBe("16px");
    expect(rail?.style.bottom).toBe("16px");
    expect(rail?.style.top).toBe("");
    expect(container?.children).toHaveLength(0);

    act(() => {
      bubble?.click();
    });

    const panel = document.body.querySelector<HTMLElement>(
      'aside[role="dialog"]',
    );
    const dragHandle = panel?.querySelector<HTMLElement>(
      'header[aria-label="Drag the Assistant"]',
    );

    expect(panel).not.toBeNull();
    expect(dragHandle?.className).toContain("cursor-grab");
    expect(
      document.body.querySelector('button[aria-haspopup="dialog"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(
      document.getElementById(panel?.querySelector("textarea")?.id ?? ""),
    );
    expect(rail?.style.left).not.toBe("");
    expect(
      panel?.querySelector('button[aria-label="Minimize the Assistant"]'),
    ).not.toBeNull();

    act(() => {
      panel
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Minimize the Assistant"]',
        )
        ?.click();
    });

    expect(rail?.style.bottom).toBe("16px");
    expect(document.activeElement).toBe(
      document.body.querySelector('button[aria-haspopup="dialog"]'),
    );

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    expect(document.activeElement?.tagName).toBe("TEXTAREA");

    act(() => {
      const handledEscape = new KeyboardEvent("keydown", {
        cancelable: true,
        key: "Escape",
      });
      handledEscape.preventDefault();
      window.dispatchEvent(handledEscape);
    });

    expect(document.body.querySelector('aside[role="dialog"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(document.body.querySelector('aside[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(
      document.body.querySelector('button[aria-haspopup="dialog"]'),
    );
  });

  it("keeps the open panel clear of the sticky save footer", () => {
    // The panel floated over the bottom-right corner with a fixed clearance,
    // so it covered "Save changes" and "Finish setup and find jobs" — the very
    // buttons it told people to press.
    const previousViewport = {
      height: window.innerHeight,
      width: window.innerWidth,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 843,
      writable: true,
    });

    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    document.body.appendChild(shellHeader);
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(footer);
    const footerHeight = 96;
    footer.getBoundingClientRect = () =>
      ({
        bottom: 843,
        height: footerHeight,
        left: 0,
        right: 1280,
        top: 843 - footerHeight,
        width: 1280,
        x: 0,
        y: 843 - footerHeight,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            showProactivePrompt={false}
            title="the Assistant"
          />,
        );
      });

      act(() =>
        document.body
          .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
          ?.click(),
      );

      const panel = document.body.querySelector<HTMLElement>(
        'aside[role="dialog"]',
      );
      const rail = panel?.parentElement;
      const top = Number.parseInt(rail?.style.top ?? "0", 10);
      const height = Number.parseInt(panel?.style.height ?? "0", 10);

      expect(height).toBeGreaterThan(0);
      expect(top + height).toBeLessThanOrEqual(843 - footerHeight);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousViewport.width,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousViewport.height,
        writable: true,
      });
      footer.remove();
      shellHeader.remove();
    }
  });

  it("keeps the the Assistant compact at a wide Profile viewport", () => {
    const previousViewport = {
      height: window.innerHeight,
      width: window.innerWidth,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 843,
      writable: true,
    });

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            showProactivePrompt={false}
            title="the Assistant"
          />,
        );
      });

      const bubble = document.body.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="dialog"]',
      );
      expect(container.children).toHaveLength(0);

      act(() => bubble?.click());

      const panel = document.body.querySelector<HTMLElement>(
        'aside[role="dialog"]',
      );
      const rail = panel?.parentElement;

      expect(panel?.style.width).toBe("360px");
      expect(Number.parseInt(panel?.style.height ?? "0", 10)).toBe(460);
      expect(
        Number.parseInt(panel?.style.height ?? "0", 10),
      ).toBeLessThanOrEqual(460);
      expect(rail?.className).toContain("fixed");
      expect(rail?.style.left).toBe("904px");
      expect(rail?.style.top).toBe("367px");
      expect(container.children).toHaveLength(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousViewport.width,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousViewport.height,
        writable: true,
      });
    }
  });

  it("uses the compact the Assistant size at the supplied 1175px viewport", () => {
    const previousViewport = {
      height: window.innerHeight,
      width: window.innerWidth,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1175,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 843,
      writable: true,
    });

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            showProactivePrompt={false}
            title="the Assistant"
          />,
        );
      });

      const bubble = document.body.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="dialog"]',
      );
      expect(container.children).toHaveLength(0);

      act(() => bubble?.click());

      const panel = document.body.querySelector<HTMLElement>(
        'aside[role="dialog"]',
      );
      const rail = panel?.parentElement;

      expect(panel?.style.width).toBe("360px");
      expect(Number.parseInt(panel?.style.height ?? "0", 10)).toBe(460);
      expect(
        Number.parseInt(panel?.style.height ?? "0", 10),
      ).toBeLessThanOrEqual(460);
      expect(rail?.className).toContain("fixed");
      expect(rail?.style.left).toBe("799px");
      expect(rail?.style.top).toBe("367px");
      expect(container.children).toHaveLength(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousViewport.width,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousViewport.height,
        writable: true,
      });
    }
  });

  it("lifts the launcher above a visible Profile action footer", () => {
    const actions = document.createElement("div");
    actions.setAttribute("data-profile-workspace-actions", "");
    actions.getBoundingClientRect = () =>
      ({
        bottom: window.innerHeight,
        height: 100,
        left: 0,
        right: window.innerWidth,
        top: window.innerHeight - 100,
        width: window.innerWidth,
        x: 0,
        y: window.innerHeight - 100,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(actions);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );

    // Previously `expect(bubble?.parentElement?.style.bottom).toBe("124px")`:
    // the floating launcher measured this footer and lifted itself 124px off
    // the window bottom to clear it. Lifting only ever cleared the rows the
    // clearance set named — which is how it still landed on a section's own
    // `Add experience` at short heights — so the launcher is now an ordinary
    // control INSIDE that footer and cannot cover anything at all.
    expect(bubble).not.toBeNull();
    expect(actions.contains(bubble)).toBe(true);
    expect(
      bubble?.closest("[data-profile-copilot-launcher-dock]"),
    ).not.toBeNull();

    act(() => {
      actions.remove();
    });
  });

  it("puts the collapsed launcher beside Save inside the footer's action row", () => {
    // A containment-only check against the footer root would pass on the very
    // layout this replaces — the launcher rendered as the footer's last child,
    // below the Save row instead of next to it. The slot lives in the action
    // row, so the assertion is sibling-of-Save.
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    const actionRow = document.createElement("div");
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save changes";
    const slot = document.createElement("span");
    slot.setAttribute("data-profile-assistant-launcher-slot", "");
    actionRow.append(slot, save);
    footer.appendChild(actionRow);
    document.body.appendChild(footer);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const launcher = document.body.querySelector<HTMLButtonElement>(
      'button[data-profile-copilot-launcher="true"]',
    );

    expect(launcher).not.toBeNull();
    // In the slot, and the slot is in the row that holds Save. The slot is
    // `display: contents`, so the launcher lays out as Save's sibling.
    const launcherSlot = launcher?.closest(
      "[data-profile-assistant-launcher-slot]",
    );
    expect(launcherSlot).toBe(slot);
    expect(slot.parentElement).toBe(actionRow);
    expect(save.parentElement).toBe(actionRow);
    // Not the old shape: a descendant of the footer root but outside the row.
    expect(launcher?.closest("div")?.parentElement).not.toBe(footer);

    // Same control as the Resume Studio launcher (variant, label, icon); the
    // size follows the row it sits in, and Save's row is default-size.
    expect(launcher?.getAttribute("data-variant")).toBe("secondary");
    expect(launcher?.getAttribute("data-size")).toBe("default");
    expect(launcher?.textContent).toContain("Assistant");
    for (const retiredPillClass of [
      "rounded-full",
      "min-h-12",
      "sm:min-w-12",
    ]) {
      expect(launcher?.className).not.toContain(retiredPillClass);
    }

    act(() => {
      footer.remove();
    });
  });

  it("floats no launcher while collapsed once the save footer is mounted", () => {
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(footer);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          starterQuestion="How should I tighten my headline?"
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );

    expect(footer.contains(bubble)).toBe(true);
    // The suggestion pill is part of the launcher stack and docks with it;
    // left floating it would be the one thing still resting over the page.
    expect(footer.textContent).toContain("Suggested:");
    // Nothing the rail still portals to the body paints while collapsed.
    const floatingRoot = document.body.querySelector<HTMLElement>(
      "[data-profile-copilot-covered-by-modal]",
    );
    expect(floatingRoot?.textContent).toBe("");

    act(() => {
      footer.remove();
    });
  });

  it("keeps the transcript and composer below Profile tabs at 1280x720", () => {
    const previousViewport = {
      height: window.innerHeight,
      width: window.innerWidth,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720,
      writable: true,
    });

    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    shellHeader.getBoundingClientRect = () =>
      ({
        bottom: 118,
        height: 118,
        left: 0,
        right: 1280,
        top: 0,
        width: 1280,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const profileTabs = document.createElement("div");
    profileTabs.setAttribute("data-profile-section-tabs", "");
    profileTabs.getBoundingClientRect = () =>
      ({
        bottom: 380,
        height: 68,
        left: 0,
        right: 1280,
        top: 312,
        width: 1280,
        x: 0,
        y: 312,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(shellHeader, profileTabs);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[
            {
              id: "profile_revision_1",
              sequence: 1,
              createdAt: "2026-04-15T16:00:00.000Z",
              reason: "Assistant patch: Update headline",
              trigger: "assistant_patch",
              messageId: "assistant_message_1",
              patchGroupId: null,
              restoredFromRevisionId: null,
            },
          ]}
          showProactivePrompt={false}
          starterQuestion="Update my headline"
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    act(() => bubble?.click());

    const panel = document.body.querySelector<HTMLElement>(
      'aside[role="dialog"]',
    );
    const rail = panel?.parentElement;
    const content = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-content="true"]',
    );
    const transcript = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-transcript="true"]',
    );
    const footer = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-composer-footer="true"]',
    );
    const textarea = panel?.querySelector<HTMLTextAreaElement>("textarea");
    const sendRow = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-send-row="true"]',
    );

    expect(panel?.getAttribute("data-profile-copilot-maximized")).toBeNull();
    expect(panel?.className).toContain("min-h-0");
    expect(panel?.className).toContain("flex-col");
    expect(panel?.querySelector("header")?.className).toContain("shrink-0");
    expect(content?.className).toContain("min-h-0");
    expect(content?.className).toContain("overflow-hidden");
    expect(transcript?.className).toContain("min-h-0");
    expect(transcript?.className).toContain("flex-1");
    expect(footer?.className).toContain("shrink-0");
    expect(footer?.className).not.toContain("overflow-y-auto");
    expect(textarea?.getAttribute("rows")).toBe("1");
    expect(textarea?.className).toContain("min-h-10");
    expect(textarea?.className).toContain("overflow-y-hidden");
    expect(sendRow?.className).toContain("min-w-0");
    expect(
      panel?.querySelector('[data-profile-copilot-movement-help="true"]'),
    ).toBeNull();
    expect(
      panel?.querySelector('[data-profile-copilot-provider-link="true"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(panel?.style.width).toBe("360px");
    expect(Number.parseInt(rail?.style.top ?? "0", 10)).toBeGreaterThanOrEqual(
      134,
    );
    expect(Number.parseInt(rail?.style.top ?? "0", 10)).toBeGreaterThanOrEqual(
      396,
    );
    expect(Number.parseInt(panel?.style.height ?? "0", 10)).toBeGreaterThan(
      280,
    );

    shellHeader.remove();
    profileTabs.remove();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousViewport.width,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousViewport.height,
      writable: true,
    });
  });

  it("keeps proposal actions inline and the composer visible at 1280x720", () => {
    const previousViewport = {
      height: window.innerHeight,
      width: window.innerWidth,
    };
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720,
      writable: true,
    });

    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    shellHeader.getBoundingClientRect = () =>
      ({
        bottom: 118,
        height: 118,
        left: 0,
        right: 1280,
        top: 0,
        width: 1280,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const profileTabs = document.createElement("div");
    profileTabs.setAttribute("data-profile-section-tabs", "");
    profileTabs.getBoundingClientRect = () =>
      ({
        bottom: 380,
        height: 68,
        left: 0,
        right: 1280,
        top: 312,
        width: 1280,
        x: 0,
        y: 312,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(shellHeader, profileTabs);

    const onApplyPatchGroup = vi.fn();
    const onRejectPatchGroup = vi.fn();
    const messages = [
      {
        id: "assistant_message_proposal",
        role: "assistant" as const,
        content:
          "I prepared this change for your review. The full explanation is intentionally long enough to require transcript scrolling before the proposal details.",
        context: { surface: "profile" as const, section: "basics" as const },
        patchGroups: [
          {
            id: "patch_group_proposal",
            summary: "Update headline",
            applyMode: "needs_review" as const,
            operations: [
              {
                operation: "replace_identity_fields" as const,
                value: { headline: "Product Designer" },
              },
            ],
            createdAt: "2026-04-15T16:00:00.000Z",
          },
        ],
        createdAt: "2026-04-15T16:00:00.000Z",
      },
    ];

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={messages}
          onApplyPatchGroup={onApplyPatchGroup}
          onRejectPatchGroup={onRejectPatchGroup}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          title="the Assistant"
        />,
      );
    });

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    const panel = document.body.querySelector<HTMLElement>(
      'aside[role="dialog"]',
    );
    const rail = panel?.parentElement;
    const content = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-content="true"]',
    );
    const transcript = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-transcript="true"]',
    );
    const composerFooter = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-composer-footer="true"]',
    );
    const proposal = panel?.querySelector<HTMLElement>(
      '[data-profile-copilot-proposal="true"]',
    );
    const applyButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label="Apply & save: Update headline"]',
    );
    const rejectButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label="Reject: Update headline"]',
    );

    expect(Number.parseInt(rail?.style.top ?? "0", 10)).toBeGreaterThanOrEqual(
      396,
    );
    expect(Number.parseInt(panel?.style.height ?? "0", 10)).toBeGreaterThan(
      280,
    );
    expect(transcript?.className).toContain("flex-1");
    expect(transcript?.className).toContain("min-h-0");
    expect(
      content?.querySelector("[data-profile-copilot-review-actions]"),
    ).toBeNull();
    expect(content?.querySelector("[data-profile-copilot-history]")).toBeNull();
    expect(transcript?.contains(proposal ?? null)).toBe(true);
    expect(composerFooter?.className).toContain("shrink-0");
    expect(composerFooter?.className).not.toContain("overflow-y-auto");
    expect(applyButton).not.toBeNull();
    expect(rejectButton).not.toBeNull();
    expect(applyButton?.disabled).toBe(false);
    expect(rejectButton?.disabled).toBe(false);

    act(() => {
      applyButton?.click();
      rejectButton?.click();
    });

    expect(onApplyPatchGroup).toHaveBeenCalledWith("patch_group_proposal");
    expect(onRejectPatchGroup).toHaveBeenCalledWith("patch_group_proposal");

    const viewport = panel?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(viewport).not.toBeNull();
    if (!viewport) {
      throw new Error("Expected the Copilot transcript viewport to render.");
    }

    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const transcriptMetrics = { clientHeight: 200, scrollHeight: 1200 };

    try {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => transcriptMetrics.clientHeight,
      });
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => transcriptMetrics.scrollHeight,
      });
      viewport.scrollTop = 1000;
      act(() => {
        fireEvent.scroll(viewport);
      });

      act(() => {
        panel
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="Minimize the Assistant"]',
          )
          ?.click();
      });
      act(() => {
        document.body
          .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
          ?.click();
      });

      const reopenedPanel = document.body.querySelector<HTMLElement>(
        'aside[role="dialog"]',
      );
      const reopenedViewport = reopenedPanel?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      expect(reopenedViewport?.scrollTop).toBe(1200);
      expect(
        reopenedPanel?.querySelector(
          'button[aria-label="Apply & save: Update headline"]',
        ),
      ).not.toBeNull();

      if (!reopenedViewport) {
        throw new Error("Expected the reopened Copilot transcript viewport.");
      }
      reopenedViewport.scrollTop = 300;
      act(() => {
        fireEvent.scroll(reopenedViewport);
      });
      act(() => {
        reopenedPanel
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="Minimize the Assistant"]',
          )
          ?.click();
      });
      act(() => {
        document.body
          .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
          ?.click();
      });

      expect(
        document.body.querySelector<HTMLElement>(
          '[data-slot="scroll-area-viewport"]',
        )?.scrollTop,
      ).toBe(300);
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          originalClientHeight,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      }
      if (originalScrollHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          originalScrollHeight,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      }
    }

    shellHeader.remove();
    profileTabs.remove();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousViewport.width,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousViewport.height,
      writable: true,
    });
  });

  it("follows a new proposal when the transcript was near the bottom", () => {
    const initialMessages: ComponentProps<
      typeof ProfileCopilotRail
    >["messages"] = [
      {
        id: "assistant_message_existing",
        role: "assistant",
        content:
          "Here is the existing profile guidance with enough detail to make the conversation scroll.",
        context: { surface: "profile", section: "basics" },
        patchGroups: [],
        createdAt: "2026-04-15T16:00:00.000Z",
      },
    ];
    const updatedMessages: ComponentProps<
      typeof ProfileCopilotRail
    >["messages"] = [
      ...initialMessages,
      {
        id: "assistant_message_new_proposal",
        role: "assistant",
        content: "I prepared this change for your review.",
        context: { surface: "profile", section: "basics" },
        patchGroups: [
          {
            id: "patch_group_new_proposal",
            summary: "Update headline",
            applyMode: "needs_review",
            operations: [
              {
                operation: "replace_identity_fields",
                value: { headline: "Product Designer" },
              },
            ],
            createdAt: "2026-04-15T16:00:00.000Z",
          },
        ],
        createdAt: "2026-04-15T16:00:00.000Z",
      },
    ];
    const renderRail = (
      messages: ComponentProps<typeof ProfileCopilotRail>["messages"],
    ) => (
      <ProfileCopilotRail
        busy={false}
        context={{ surface: "profile", section: "basics" }}
        emptyStateDescription="Ask why a field matters."
        emptyStateTitle="No requests yet"
        messages={messages}
        onApplyPatchGroup={vi.fn()}
        onRejectPatchGroup={vi.fn()}
        onSendMessage={vi.fn()}
        onUndoRevision={vi.fn()}
        pendingContextKey={null}
        placeholder="Ask for an edit"
        revisions={[]}
        showProactivePrompt={false}
        title="the Assistant"
      />
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(renderRail(initialMessages));
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    const transcript = document.body.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(transcript).not.toBeNull();
    if (!transcript) {
      throw new Error("Expected the Copilot transcript viewport to render.");
    }
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    transcript.scrollTop = 600;
    act(() => {
      transcript.dispatchEvent(new Event("scroll"));
    });

    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    act(() => {
      root?.render(renderRail(updatedMessages));
    });

    expect(transcript.scrollTop).toBe(1200);
    expect(
      document.body.querySelector(
        'button[aria-label="Apply & save: Update headline"]',
      ),
    ).not.toBeNull();
  });

  it("preserves a manually scrolled-up transcript when a proposal arrives", () => {
    const initialMessages: ComponentProps<
      typeof ProfileCopilotRail
    >["messages"] = [
      {
        id: "assistant_message_existing",
        role: "assistant",
        content: "Earlier profile guidance.",
        context: { surface: "profile", section: "basics" },
        patchGroups: [],
        createdAt: "2026-04-15T16:00:00.000Z",
      },
    ];
    const updatedMessages: ComponentProps<
      typeof ProfileCopilotRail
    >["messages"] = [
      ...initialMessages,
      {
        id: "assistant_message_new_proposal",
        role: "assistant",
        content: "I prepared this change for your review.",
        context: { surface: "profile", section: "basics" },
        patchGroups: [
          {
            id: "patch_group_new_proposal",
            summary: "Update headline",
            applyMode: "needs_review",
            operations: [
              {
                operation: "replace_identity_fields",
                value: { headline: "Product Designer" },
              },
            ],
            createdAt: "2026-04-15T16:00:00.000Z",
          },
        ],
        createdAt: "2026-04-15T16:00:00.000Z",
      },
    ];
    const renderRail = (
      messages: ComponentProps<typeof ProfileCopilotRail>["messages"],
    ) => (
      <ProfileCopilotRail
        busy={false}
        context={{ surface: "profile", section: "basics" }}
        emptyStateDescription="Ask why a field matters."
        emptyStateTitle="No requests yet"
        messages={messages}
        onApplyPatchGroup={vi.fn()}
        onRejectPatchGroup={vi.fn()}
        onSendMessage={vi.fn()}
        onUndoRevision={vi.fn()}
        pendingContextKey={null}
        placeholder="Ask for an edit"
        revisions={[]}
        showProactivePrompt={false}
        title="the Assistant"
      />
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(renderRail(initialMessages));
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    const transcript = document.body.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(transcript).not.toBeNull();
    if (!transcript) {
      throw new Error("Expected the Copilot transcript viewport to render.");
    }
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 800,
    });
    transcript.scrollTop = 200;
    act(() => {
      transcript.dispatchEvent(new Event("scroll"));
    });

    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    act(() => {
      root?.render(renderRail(updatedMessages));
    });

    expect(transcript.scrollTop).toBe(200);
  });

  it("can hide the proactive prompt without removing the launcher or panel", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          starterQuestion="How should I tighten my headline?"
          title="the Assistant"
        />,
      );
    });

    expect(document.body.textContent).not.toContain(
      "Suggested: How should I tighten my headline?",
    );
    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(bubble).not.toBeNull();

    act(() => {
      bubble?.click();
    });

    expect(document.body.querySelector('aside[role="dialog"]')).not.toBeNull();
  });

  it("keeps the launcher position stable when a save status appears", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    const rail = bubble?.parentElement;
    const beforeToast = {
      bottom: rail?.style.bottom,
      left: rail?.style.left,
      right: rail?.style.right,
      top: rail?.style.top,
    };

    const saveStatus = document.createElement("div");
    saveStatus.setAttribute("data-save-status", "saving");
    saveStatus.getBoundingClientRect = () =>
      ({
        bottom: window.innerHeight - 68,
        height: 60,
        left: window.innerWidth - 420,
        right: window.innerWidth - 16,
        top: window.innerHeight - 128,
        width: 404,
        x: window.innerWidth - 420,
        y: window.innerHeight - 128,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(saveStatus);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const afterToastRail = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )?.parentElement;
    expect({
      bottom: afterToastRail?.style.bottom,
      left: afterToastRail?.style.left,
      right: afterToastRail?.style.right,
      top: afterToastRail?.style.top,
    }).toEqual(beforeToast);
    // Previously also `expect(afterToastRail?.style.bottom).toBe("16px")`.
    // That pinned the floating pill's inset; the collapsed launcher is a
    // control in the save footer now, so it has no viewport offset of its own.
    // The invariant this test is named for — a toast never moves it — is the
    // equality above, and it is strictly stronger now that the launcher is in
    // the layout rather than measured against the corner.
    expect(afterToastRail).not.toBeNull();
  });

  it("lifts the launcher above Profile section tabs in the bottom corner", () => {
    const tabs = document.createElement("div");
    tabs.setAttribute("data-profile-section-tabs", "");
    tabs.getBoundingClientRect = () =>
      ({
        bottom: window.innerHeight - 20,
        height: 68,
        left: 0,
        right: window.innerWidth,
        top: window.innerHeight - 88,
        width: window.innerWidth,
        x: 0,
        y: window.innerHeight - 88,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(tabs);
    // Profile always renders its save footer; that is where the launcher docks.
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(footer);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );

    // Previously `expect(bubble?.parentElement?.style.bottom).toBe("112px")`:
    // the floating launcher measured the section tabs and lifted itself 112px
    // off the window bottom to clear them. It is a control in the save footer
    // now, so it sits in the layout below the tabs and cannot overlap them at
    // any height — no lift, and nothing to measure.
    expect(bubble).not.toBeNull();
    expect(footer.contains(bubble)).toBe(true);

    act(() => {
      tabs.remove();
      footer.remove();
    });
  });

  it("lifts the suggestion pill clear of section tabs inside the old 64px probe blind zone", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 920,
      writable: true,
    });
    const tabs = document.createElement("div");
    tabs.setAttribute("data-profile-section-tabs", "");
    const tabsBottom = 840;
    tabs.getBoundingClientRect = () =>
      ({
        bottom: tabsBottom,
        height: 68,
        left: 0,
        right: 1440,
        top: tabsBottom - 68,
        width: 1440,
        x: 0,
        y: tabsBottom - 68,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(tabs);
    // Profile always renders its save footer; that is where the launcher docks.
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(footer);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          starterQuestion="How should I tighten my headline?"
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    const rail = bubble?.parentElement;
    expect(rail).not.toBeNull();
    expect(rail?.querySelector(".max-sm\\:hidden")).not.toBeNull();

    // Previously this computed the lifted stack's bottom edge from
    // `rail.style.bottom` and required it to clear `tabsBottom - 68 -
    // COPILOT_LAUNCHER_MIN_INTERACTIVE_GAP`. The launcher and its suggestion
    // pill are in the save footer now, below the tabs in the layout, so there
    // is no clearance arithmetic and no blind zone for a probe to miss.
    expect(footer.contains(bubble)).toBe(true);
    expect(rail?.style.bottom).toBe("");

    act(() => {
      tabs.remove();
      footer.remove();
    });
  });

  it("ignores old saved placement and keeps the collapsed launcher docked after maximize", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 920,
      writable: true,
    });
    window.localStorage.setItem(
      "unemployed.profile-copilot-position-v7",
      JSON.stringify({
        x: 1168,
        y: 840,
        viewportHeight: 920,
        viewportWidth: 1440,
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    const rail = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    )?.parentElement;
    expect(rail?.style.left).toBe("");
    expect(rail?.style.top).toBe("");
    expect(rail?.style.right).toBe("16px");
    expect(rail?.style.bottom).toBe("16px");
    expect(
      window.localStorage.getItem("unemployed.profile-copilot-position-v7"),
    ).toBeNull();

    act(() => {
      window.innerWidth = 1920;
      window.innerHeight = 1033;
      window.dispatchEvent(new Event("resize"));
    });

    expect(rail?.style.left).toBe("");
    expect(rail?.style.top).toBe("");
    expect(rail?.style.right).toBe("16px");
    expect(rail?.style.bottom).toBe("16px");

    act(() => {
      window.innerWidth = 1440;
      window.innerHeight = 920;
      window.dispatchEvent(new Event("resize"));
    });

    expect(rail?.style.left).toBe("");
    expect(rail?.style.top).toBe("");
    expect(rail?.style.right).toBe("16px");
    expect(rail?.style.bottom).toBe("16px");
  });

  it("lets Escape minimize an automatically opened pending conversation", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "setup", step: "targeting" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey="setup:targeting"
          placeholder="Ask for an edit"
          revisions={[]}
          title="the Assistant"
        />,
      );
    });

    expect(document.body.querySelector('aside[role="dialog"]')).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("TEXTAREA");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(document.body.querySelector('aside[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(
      document.body.querySelector('button[aria-haspopup="dialog"]'),
    );
  });

  it("keeps Enter locked for busy and IME-composing requests", () => {
    const onSendMessage = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={onSendMessage}
          onUndoRevision={vi.fn()}
          pendingContextKey="profile:experience"
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          starterQuestion="Update my headline"
          title="the Assistant"
        />,
      );
    });

    const bubble = document.body.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    act(() => bubble?.click());
    const textarea =
      document.body.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe("Update my headline");

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });

    act(() => {
      const composing = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });
      Object.defineProperty(composing, "isComposing", { value: true });
      textarea?.dispatchEvent(composing);
    });

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("shows a prefilled starter question only once in the open composer", () => {
    const starterQuestion = "What should I save for my background?";
    const otherSuggestion = "How can I make this section clearer?";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "setup", step: "background" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          starterQuestion={starterQuestion}
          suggestedPrompts={[starterQuestion, otherSuggestion]}
          title="the Assistant"
        />,
      );
    });

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    const textarea =
      document.body.querySelector<HTMLTextAreaElement>("textarea");
    const starterSuggestionButtons = [
      ...document.body.querySelectorAll("button"),
    ].filter((button) => button.textContent?.trim() === starterQuestion);

    expect(textarea?.value).toBe(starterQuestion);
    expect(starterSuggestionButtons).toHaveLength(0);
    expect(
      [...document.body.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === otherSuggestion,
      ),
    ).toBe(true);
  });

  it("does not restore a failed request over a newer draft", async () => {
    const starterQuestion = "What should I save for my background?";
    const newerDraft = "Keep this newer request draft.";
    let resolveRequest: ((succeeded: boolean) => void) | undefined;
    const request = new Promise<boolean>((resolve) => {
      resolveRequest = resolve;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "setup", step: "background" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn(() => request)}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          starterQuestion={starterQuestion}
          title="the Assistant"
        />,
      );
    });

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });
    const textarea =
      document.body.querySelector<HTMLTextAreaElement>("textarea");
    const sendButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );

    act(() => {
      sendButton?.click();
      fireEvent.change(textarea as HTMLTextAreaElement, {
        target: { value: newerDraft },
      });
    });
    expect(textarea?.value).toBe(newerDraft);

    await act(async () => {
      resolveRequest?.(false);
      await request;
    });

    expect(textarea?.value).toBe(newerDraft);
  });

  it("does not restore a failed request after the Copilot context changes", async () => {
    const starterQuestion = "What should I save for my background?";
    let resolveRequest: ((succeeded: boolean) => void) | undefined;
    const request = new Promise<boolean>((resolve) => {
      resolveRequest = resolve;
    });
    const onSendMessage = vi.fn(() => request);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const renderRail = (step: "background" | "targeting") => (
      <ProfileCopilotRail
        busy={false}
        context={{ surface: "setup", step }}
        emptyStateDescription="Ask why a field matters."
        emptyStateTitle="No requests yet"
        messages={[]}
        onApplyPatchGroup={vi.fn()}
        onRejectPatchGroup={vi.fn()}
        onSendMessage={onSendMessage}
        onUndoRevision={vi.fn()}
        pendingContextKey={null}
        placeholder="Ask for an edit"
        revisions={[]}
        showProactivePrompt={false}
        starterQuestion={starterQuestion}
        title="the Assistant"
      />
    );

    act(() => {
      root?.render(renderRail("background"));
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });
    const sendButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );
    act(() => sendButton?.click());

    act(() => {
      root?.render(renderRail("targeting"));
    });
    const textarea =
      document.body.querySelector<HTMLTextAreaElement>("textarea");

    await act(async () => {
      resolveRequest?.(false);
      await request;
    });

    expect(textarea?.value).not.toBe(starterQuestion);
    expect(onSendMessage).toHaveBeenCalledWith(starterQuestion, {
      surface: "setup",
      step: "background",
    });
  });

  it("retries a stored failure against its originating Copilot context", async () => {
    const starterQuestion = "What should I save for my background?";
    const onSendMessage = vi.fn().mockResolvedValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const renderRail = (step: "background" | "targeting") => (
      <ProfileCopilotRail
        busy={false}
        context={{ surface: "setup", step }}
        emptyStateDescription="Ask why a field matters."
        emptyStateTitle="No requests yet"
        messages={[]}
        onApplyPatchGroup={vi.fn()}
        onRejectPatchGroup={vi.fn()}
        onSendMessage={onSendMessage}
        onUndoRevision={vi.fn()}
        pendingContextKey={null}
        placeholder="Ask for an edit"
        revisions={[]}
        showProactivePrompt={false}
        starterQuestion={starterQuestion}
        title="the Assistant"
      />
    );

    act(() => {
      root?.render(renderRail("background"));
    });
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
        ?.click();
      await Promise.resolve();
    });

    act(() => {
      root?.render(renderRail("targeting"));
    });
    const retry = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        '[data-profile-copilot-failed-turn="true"] button',
      ),
    ].find((button) => button.textContent === "Ask again");
    expect(retry).toBeDefined();

    act(() => retry?.click());

    expect(onSendMessage).toHaveBeenNthCalledWith(1, starterQuestion, {
      surface: "setup",
      step: "background",
    });
    expect(onSendMessage).toHaveBeenNthCalledWith(2, starterQuestion, {
      surface: "setup",
      step: "background",
    });
  });

  it("restores a definitively failed prompt with a retry action", async () => {
    const onSendMessage = vi.fn().mockResolvedValue(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={onSendMessage}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
          showProactivePrompt={false}
          starterQuestion="Update my headline"
          title="the Assistant"
        />,
      );
    });

    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click(),
    );
    const sendButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Send message"]',
    );
    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Ask again");
    expect(document.body.querySelector("textarea")?.value).toBe(
      "Update my headline",
    );
  });
  it("updates open-panel clearance when the Profile action footer grows", () => {
    const observers: ControlledResizeObserver[] = [];

    class ControlledResizeObserver {
      readonly observeCalls: Element[] = [];

      constructor(private readonly callback: ResizeObserverCallback) {
        observers.push(this);
      }

      observe(target: Element) {
        this.observeCalls.push(target);
      }

      unobserve() {}

      disconnect() {}

      deliver() {
        this.callback([], this as unknown as ResizeObserver);
      }
    }

    const previousResizeObserver = (
      globalThis as typeof globalThis & {
        ResizeObserver?: typeof ResizeObserver;
      }
    ).ResizeObserver;
    (
      globalThis as typeof globalThis & { ResizeObserver?: unknown }
    ).ResizeObserver = ControlledResizeObserver;

    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    document.body.appendChild(shellHeader);
    const footer = document.createElement("div");
    footer.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(footer);
    let footerHeight = 48;
    footer.getBoundingClientRect = () =>
      ({
        bottom: window.innerHeight,
        height: footerHeight,
        left: 0,
        right: window.innerWidth,
        top: window.innerHeight - footerHeight,
        width: window.innerWidth,
        x: 0,
        y: window.innerHeight - footerHeight,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            title="the Assistant"
          />,
        );
      });
      act(() =>
        document.body
          .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
          ?.click(),
      );

      const footerObserver = observers.find((observer) =>
        observer.observeCalls.includes(footer),
      );
      expect(footerObserver).toBeTruthy();

      footerHeight = 132;
      act(() => footerObserver?.deliver());

      const panel = document.body.querySelector<HTMLElement>(
        'aside[role="dialog"]',
      );
      const rail = panel?.parentElement;
      const top = Number.parseInt(rail?.style.top ?? "0", 10);
      const height = Number.parseInt(panel?.style.height ?? "0", 10);
      expect(top + height).toBeLessThanOrEqual(
        window.innerHeight - footerHeight,
      );
    } finally {
      if (previousResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, "ResizeObserver");
      } else {
        (
          globalThis as typeof globalThis & {
            ResizeObserver?: typeof ResizeObserver;
          }
        ).ResizeObserver = previousResizeObserver;
      }
      shellHeader.remove();
      footer.remove();
    }
  });

  it("observes each clearance target once without re-observing in its callback", () => {
    // Calling observe again from the ResizeObserver callback schedules another
    // delivery and can loop forever. The targets are captured once; callbacks
    // only re-measure them.
    const observers: LoopProbeResizeObserver[] = [];

    class LoopProbeResizeObserver {
      readonly observeCalls: Element[] = [];
      iterations = 0;
      private readonly deliver: () => void;
      private pending = false;
      private flushing = false;

      constructor(callback: ResizeObserverCallback) {
        this.deliver = () => {
          callback([], this as unknown as ResizeObserver);
        };
        observers.push(this);
      }

      observe(target: Element) {
        this.observeCalls.push(target);
        this.pending = true;
        this.flush();
      }

      unobserve() {}

      disconnect() {
        this.pending = false;
      }

      private flush() {
        if (this.flushing) {
          return;
        }

        this.flushing = true;
        // A hard cap so a regression fails the assertion instead of hanging.
        while (this.pending && this.iterations < 25) {
          this.pending = false;
          this.iterations += 1;
          this.deliver();
        }
        this.flushing = false;
      }
    }

    const previousResizeObserver = (
      globalThis as typeof globalThis & {
        ResizeObserver?: typeof ResizeObserver;
      }
    ).ResizeObserver;
    (
      globalThis as typeof globalThis & { ResizeObserver?: unknown }
    ).ResizeObserver = LoopProbeResizeObserver;

    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    document.body.appendChild(shellHeader);
    const actions = document.createElement("div");
    actions.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(actions);
    const tabs = document.createElement("div");
    tabs.setAttribute("data-profile-section-tabs", "");
    document.body.appendChild(tabs);

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            title="the Assistant"
          />,
        );
      });

      expect(
        observers.flatMap((observer) => observer.observeCalls),
      ).toEqual([shellHeader, tabs, actions]);
      for (const observer of observers) {
        expect(observer.iterations).toBeLessThan(5);
      }
      // The launcher is still placed clear of the action footer, which is what
      // the observation existed to achieve.
      const launcher = document.querySelector<HTMLElement>(
        "[data-profile-copilot-launcher]",
      );
      expect(launcher).not.toBeNull();
    } finally {
      if (previousResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, "ResizeObserver");
      } else {
        (
          globalThis as typeof globalThis & {
            ResizeObserver?: typeof ResizeObserver;
          }
        ).ResizeObserver = previousResizeObserver;
      }

      shellHeader.remove();
      actions.remove();
      tabs.remove();
    }
  });

  it("listens for scroll passively and coalesces the measurement into one frame", () => {
    const shellHeader = document.createElement("div");
    shellHeader.setAttribute("data-job-finder-shell-header", "");
    document.body.appendChild(shellHeader);
    const actions = document.createElement("div");
    actions.setAttribute("data-profile-workspace-actions", "");
    document.body.appendChild(actions);

    let measureCount = 0;
    // Previously counted `actions.getBoundingClientRect()`: the launcher's own
    // clearance loop measured the action footer on every scroll. The launcher
    // is docked in that footer now and computes no clearance at all, so the
    // remaining scroll-driven measurement — and the behaviour this test is
    // named for — is the safe-top offset reading the shell header.
    shellHeader.getBoundingClientRect = () => {
      measureCount += 1;
      return {
        bottom: 900,
        height: 64,
        left: 0,
        right: 1440,
        top: 836,
        width: 1440,
        x: 0,
        y: 836,
        toJSON: () => ({}),
      } as DOMRect;
    };

    const frames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const addEventListener = vi.spyOn(document, "addEventListener");

    try {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(
          <ProfileCopilotRail
            busy={false}
            context={{ surface: "profile", section: "basics" }}
            emptyStateDescription="Ask why a field matters."
            emptyStateTitle="No requests yet"
            messages={[]}
            onApplyPatchGroup={vi.fn()}
            onRejectPatchGroup={vi.fn()}
            onSendMessage={vi.fn()}
            onUndoRevision={vi.fn()}
            pendingContextKey={null}
            placeholder="Ask for an edit"
            revisions={[]}
            title="the Assistant"
          />,
        );
      });

      const scrollRegistrations = addEventListener.mock.calls.filter(
        ([type]) => type === "scroll",
      );
      expect(scrollRegistrations.length).toBeGreaterThan(0);
      for (const [, , options] of scrollRegistrations) {
        // A capture listener on `document` runs for every scrollable element in
        // the app, so it must never be able to cancel the scroll.
        expect(options).toEqual({ capture: true, passive: true });
      }

      // Drain the frames scheduled during mount so only scroll-driven work is
      // measured below.
      act(() => {
        const mountFrames = frames.splice(0, frames.length);
        for (const frame of mountFrames) {
          frame(0);
        }
      });

      const beforeScroll = measureCount;
      act(() => {
        for (let index = 0; index < 5; index += 1) {
          document.dispatchEvent(new Event("scroll", { bubbles: false }));
        }
      });

      // Nothing is measured synchronously: the five events schedule work
      // instead of forcing five layout reads.
      expect(measureCount).toBe(beforeScroll);
      expect(frames.length).toBeLessThan(5);

      act(() => {
        const pending = frames.splice(0, frames.length);
        for (const frame of pending) {
          frame(0);
        }
      });

      // Five scroll events coalesce into exactly one measurement pass.
      expect(measureCount - beforeScroll).toBe(1);
    } finally {
      requestAnimationFrame.mockRestore();
      vi.mocked(window.cancelAnimationFrame).mockRestore?.();
      addEventListener.mockRestore();
      shellHeader.remove();
      actions.remove();
    }
  });

  it("heads the panel Assistant when no title is passed", () => {
    // Guided setup now relies on this default. It used to pass
    // title="the Assistant", left over from a find-and-replace, so its
    // panel heading read "the Assistant" while Profile read "Assistant".
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotRail
          busy={false}
          context={{ surface: "setup", step: "targeting" }}
          emptyStateDescription="Ask why a field matters."
          emptyStateTitle="No requests yet"
          messages={[]}
          onApplyPatchGroup={vi.fn()}
          onRejectPatchGroup={vi.fn()}
          onSendMessage={vi.fn()}
          onUndoRevision={vi.fn()}
          pendingContextKey={null}
          placeholder="Ask for an edit"
          revisions={[]}
        />,
      );
    });

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click();
    });

    expect(
      document.body.querySelector('aside[role="dialog"] h2')?.textContent,
    ).toBe("Assistant");
  });
});
