// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type {
  ResumeAssistantMessage,
  ResumeDraft,
  ResumeDraftPatch,
} from "@unemployed/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireJobFinderOverlay,
  markJobFinderOverlayAsModal,
  resetJobFinderOverlaysForTests,
} from "../../lib/job-finder-overlay-ownership";
import { ResumeGuidedEditsPopup } from "./resume-guided-edits-popup";
import {
  RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
  RESUME_ASSISTANT_LONG_RUNNING_MS,
} from "./review-queue-progress";

describe("ResumeGuidedEditsPopup", () => {
  let launcherSlotHost: HTMLElement | null = null;

  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    class PointerEventMock extends MouseEvent {
      readonly isPrimary: boolean;
      readonly pointerId: number;

      constructor(
        type: string,
        init: MouseEventInit & { isPrimary?: boolean; pointerId?: number },
      ) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 1;
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("PointerEvent", PointerEventMock);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    // The studio shell owns the sticky header the collapsed launcher docks
    // into. Every mount here needs that slot present, exactly as the real
    // screen provides it, or the Assistant has nowhere to render.
    launcherSlotHost = document.createElement("span");
    launcherSlotHost.setAttribute(
      "data-resume-studio-assistant-launcher-slot",
      "",
    );
    document.body.appendChild(launcherSlotHost);
  });

  afterEach(() => {
    cleanup();
    launcherSlotHost?.remove();
    launcherSlotHost = null;
    resetJobFinderOverlaysForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderPopup() {
    render(
      <>
        <section data-resume-workspace-top-actions />
        <ResumeGuidedEditsPopup
          assistantMessages={[]}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
        />
      </>,
    );
  }

  it("keeps the expanded panel below the measured workspace actions", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const bottom = this.hasAttribute("data-resume-workspace-top-actions")
          ? 204
          : 0;

        return {
          bottom,
          height: bottom,
          left: 0,
          right: 1280,
          top: 0,
          width: 1280,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );
    renderPopup();

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );
    const dialog = screen.getByRole("dialog", { name: "Assistant" });

    // Previously `expect(popupRoot?.style.top).toBe("324px")`. That exact
    // number was a consequence of the retired corner-anchored pill: the panel
    // grew out of `window.innerHeight - 16`, so 800 - 16 - 460 = 324. The
    // launcher is a button in the studio header now and the panel folds out of
    // its rect, so the invariant this test is named for — the panel never
    // rides over the measured workspace actions — is asserted directly
    // instead of through that one arithmetic result.
    expect(
      Number.parseFloat(popupRoot?.style.top ?? ""),
    ).toBeGreaterThanOrEqual(220);
    expect(dialog.style.maxHeight).toBe("calc(100vh - 236px)");
  });

  it("keeps the expanded panel above the Undo row it tells the user to press", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.hasAttribute("data-resume-draft-provenance")) {
          return {
            bottom: 780,
            height: 80,
            left: 900,
            right: 1264,
            top: 700,
            width: 364,
            x: 900,
            y: 700,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 1280,
          top: 0,
          width: 1280,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    render(
      <>
        <section data-resume-workspace-top-actions />
        <section data-resume-draft-provenance />
        <ResumeGuidedEditsPopup
          assistantMessages={[]}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
        />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const dialog = screen.getByRole("dialog", { name: "Assistant" });

    // 800 - 700 + 16 = 116px is reserved below the panel (the default is 16),
    // so the Undo row the Assistant points at stays clickable while the panel
    // is open. 112px of top safe area plus that 116px is the 228px reserved.
    expect(dialog.style.maxHeight).toBe("calc(100vh - 228px)");
  });

  it("docks the collapsed launcher in the studio header and floats nothing", () => {
    // Previously "keeps the launcher bottom-right with the shared responsive
    // inset": it asserted a floating root at `bottom: 16px; right: 16px`
    // holding a `size-12 p-0` pill. That pill rested over the tools column,
    // and no reservation in a scrolling column can keep a fixed pill off live
    // content at every scroll position — so while collapsed there is now no
    // floating surface at all.
    renderPopup();

    expect(
      document.querySelector("[data-resume-guided-edits-open]"),
    ).toBeNull();

    const launcher = screen.getByRole("button", {
      name: "Open the Assistant",
    });

    expect(
      launcher.closest("[data-resume-studio-assistant-launcher-slot]"),
    ).not.toBeNull();
    expect(launcher.getAttribute("title")).toBe("Open the Assistant");
    expect(launcher.getAttribute("data-resume-guided-edits-launcher")).toBe(
      "true",
    );
  });

  it("opens into the studio dock slot, not over the page, when the studio provides one", () => {
    // The floating panel opened mid-right over the tools column (Save, the
    // template chooser, "Edit resume"). With a studio dock slot mounted, the
    // open panel is an in-flow column inside it: no fixed box, no drag grip,
    // and minimizing returns it to the launcher.
    const dock = document.createElement("div");
    dock.setAttribute("data-resume-studio-assistant-dock-slot", "");
    document.body.appendChild(dock);
    const onOpenChange = vi.fn();

    try {
      render(
        <>
          <section data-resume-workspace-top-actions />
          <ResumeGuidedEditsPopup
            assistantMessages={[]}
            assistantPending={false}
            isWorkspacePending={false}
            onOpenChange={onOpenChange}
            onSendAssistantMessage={vi.fn()}
          />
        </>,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Open the Assistant" }),
      );

      const panel = screen.getByRole("dialog", { name: "Assistant" });

      expect(panel.parentElement).toBe(dock);
      expect(panel.getAttribute("data-resume-guided-edits-docked")).toBe(
        "true",
      );
      expect(panel.className).not.toMatch(/\bfixed\b/);
      expect(panel.style.top).toBe("");
      expect(panel.style.left).toBe("");
      expect(screen.queryByLabelText("Drag the Assistant")).toBeNull();
      expect(onOpenChange).toHaveBeenLastCalledWith(true);

      fireEvent.click(
        screen.getByRole("button", { name: "Minimize the Assistant" }),
      );

      expect(dock.childElementCount).toBe(0);
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
      expect(
        screen.getByRole("button", { name: "Open the Assistant" }),
      ).toBeTruthy();
    } finally {
      cleanup();
      dock.remove();
    }
  });

  it("uses an ordinary action-row button, not a floating pill", () => {
    // Previously "uses the same labelled pill launcher shape as Profile
    // Copilot", which pinned `rounded-full`, `min-h-12`, `sm:h-12`,
    // `sm:w-auto`, `sm:min-w-12` and `sm:px-3` — the floating-pill geometry.
    // Both launchers are ordinary secondary buttons in their screen's action
    // row now, so parity is asserted on that shape instead.
    renderPopup();

    const launcher = screen.getByRole("button", { name: "Open the Assistant" });

    expect(launcher.getAttribute("data-variant")).toBe("secondary");
    expect(launcher.getAttribute("data-size")).toBe("compact");
    for (const retiredPillClass of [
      "rounded-full",
      "min-h-12",
      "sm:min-w-12",
    ]) {
      expect(launcher.className).not.toContain(retiredPillClass);
    }
    expect(launcher.textContent).toContain("Assistant");
  });

  it("uses 12px side insets for a narrow viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    renderPopup();

    // Previously also asserted the collapsed floating root sat at
    // `right: 12px`. The collapsed launcher no longer floats, so only the open
    // panel's narrow-viewport sizing remains — which is what this test is for.
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    expect(dialog.style.width).toBe("296px");
    expect(dialog.style.maxWidth).toBe("calc(100vw - 24px)");
  });

  it("uses a compact header and minimize-only controls while open", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    const header = screen.getByLabelText("Drag the Assistant");

    expect(header.className).toContain("cursor-grab");
    // 1280 is the wide-panel breakpoint; the width rule itself is pinned by
    // its own test.
    expect(dialog.style.width).toBe("384px");
    expect(dialog.style.height).toBe("460px");
    expect(dialog.getAttribute("data-resume-guided-edits-panel")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Minimize the Assistant" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Maximize the Assistant" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore the Assistant" }),
    ).toBe(null);
    expect(
      screen.queryByRole("button", { name: "Open the Assistant" }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Minimize the Assistant" }),
    );
    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open the Assistant" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open the Assistant" }),
    );
  });

  it("uses the compact one-line composer and sends with Enter", () => {
    const onSendAssistantMessage = vi.fn();
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={onSendAssistantMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const input = screen.getByRole("textbox", {
      name: "Message the Assistant",
    });
    expect(input.getAttribute("rows")).toBe("1");
    expect(input.className).toContain("min-h-10");
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();

    fireEvent.change(input, { target: { value: "Tighten the summary" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSendAssistantMessage).toHaveBeenCalledOnce();
    expect(onSendAssistantMessage).toHaveBeenCalledWith("Tighten the summary");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("closes on Escape and restores focus to the launcher", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
    );

    const handledEscape = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Escape",
    });
    handledEscape.preventDefault();
    fireEvent(window, handledEscape);

    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Open the Assistant" }),
    );
  });

  it("keeps native keyboard activation and does not swallow the next mouse click", () => {
    renderPopup();
    const launcher = screen.getByRole("button", { name: "Open the Assistant" });
    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });

    launcher.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(false);

    fireEvent.click(launcher);
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
  });

  it("keeps existing and newly arriving messages minimized until the user opens them", () => {
    const onSendAssistantMessage = vi.fn();
    const firstMessage = {
      id: "assistant_existing",
      jobId: "job_ready",
      role: "assistant" as const,
      content: "Existing grounded edit guidance.",
      patches: [],
      proposalStatus: "none" as const,
      baseDraftUpdatedAt: null,
      resolvedPatchIds: [],
      resolvedAt: null,
      proposalError: null,
      createdAt: "2026-08-09T20:00:00.000Z",
    };
    const { rerender } = render(
      <ResumeGuidedEditsPopup
        assistantMessages={[firstMessage]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={onSendAssistantMessage}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    ).toBeTruthy();

    rerender(
      <ResumeGuidedEditsPopup
        assistantMessages={[
          firstMessage,
          {
            id: "assistant_new",
            jobId: "job_ready",
            role: "assistant",
            content: "A newer reply arrived.",
            patches: [],
            proposalStatus: "none",
            baseDraftUpdatedAt: null,
            resolvedPatchIds: [],
            resolvedAt: null,
            proposalError: null,
            createdAt: "2026-08-09T20:01:00.000Z",
          },
        ]}
        assistantPending={true}
        isWorkspacePending={false}
        onSendAssistantMessage={onSendAssistantMessage}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open the Assistant, reply in progress",
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, reply in progress",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    expect(dialog.className).toContain("surface-popover-solid");
    expect(dialog.className).not.toContain("surface-panel-shell");
    expect(dialog.className).not.toContain("backdrop-blur");
  });

  it("counts the wait, states the expected range, and escalates below it", () => {
    vi.useFakeTimers();
    const onReloadWorkspace = vi.fn();

    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[]}
        assistantPending
        isWorkspacePending={false}
        onReloadWorkspace={onReloadWorkspace}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, reply in progress",
      }),
    );
    expect(screen.queryByText(/taking longer than expected/i)).toBeNull();
    // The wait has an expectation attached, and a live counter, from the
    // first frame: an indefinite "Working on your edit…" could not be told
    // apart from a stalled request.
    expect(screen.getByText(RESUME_ASSISTANT_EXPECTED_WAIT_LABEL)).toBeTruthy();
    expect(
      document.querySelector("[data-resume-assistant-elapsed]")?.textContent,
    ).toBe("0:00");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(
      document.querySelector("[data-resume-assistant-elapsed]")?.textContent,
    ).toBe("0:05");

    // The old 30s threshold sat above the measured 24-27s reply, so the
    // recovery copy never rendered while it would have helped.
    expect(RESUME_ASSISTANT_LONG_RUNNING_MS).toBeLessThan(24_000);

    act(() => {
      vi.advanceTimersByTime(RESUME_ASSISTANT_LONG_RUNNING_MS);
    });

    expect(
      screen.getByText(
        /taking longer than expected.*your saved draft is unchanged.*this request may still finish in the background/i,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload workspace" }));
    expect(onReloadWorkspace).toHaveBeenCalledOnce();
  });

  it("passes saved validation through to proposal grounding disclosures", () => {
    const updatedAt = "2026-04-27T00:00:00.000Z";
    const savedSummaryText =
      "Systems-focused product designer with deep workflow automation experience.";
    const draft: ResumeDraft = {
      id: "draft demo",
      jobId: "job demo",
      status: "draft",
      templateId: "classic_ats",
      identity: null,
      sections: [
        {
          id: "sec summary",
          kind: "summary",
          label: "Summary",
          text: savedSummaryText,
          bullets: [],
          entries: [],
          origin: "ai_generated",
          locked: false,
          included: true,
          sortOrder: 0,
          entryOrderMode: "chronology",
          profileRecordId: null,
          sourceRefs: [
            {
              id: "ref job demo",
              sourceKind: "job",
              sourceId: null,
              snippet: "Own the workflow automation surface end to end.",
            },
          ],
          updatedAt,
        },
      ],
      targetPageCount: 2,
      generationMethod: "ai",
      approvedAt: null,
      approvedExportId: null,
      staleReason: null,
      workHistoryReviewAcknowledgments: [],
      claimConfirmations: [],
      issueApprovals: [],
      createdAt: updatedAt,
      updatedAt,
    };
    const patch: ResumeDraftPatch = {
      id: "patch one",
      draftId: draft.id,
      operation: "replace_section_text",
      targetSectionId: "sec summary",
      targetEntryId: null,
      anchorEntryId: null,
      targetBulletId: null,
      anchorBulletId: null,
      position: null,
      newText: "A tighter proposed summary.",
      newIncluded: null,
      newLocked: null,
      newBullets: null,
      appliedAt: updatedAt,
      origin: "assistant",
      conflictReason: null,
    };
    const message: ResumeAssistantMessage = {
      id: "assistant one",
      jobId: "job demo",
      role: "assistant",
      content: "Here is a grounded edit.",
      patches: [patch],
      proposalStatus: "pending",
      baseDraftUpdatedAt: null,
      resolvedPatchIds: [],
      resolvedAt: null,
      proposalError: null,
      createdAt: updatedAt,
    };

    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[message]}
        assistantPending={false}
        draft={draft}
        isWorkspacePending={false}
        onResolveProposal={vi.fn()}
        onSendAssistantMessage={vi.fn()}
        validation={{
          id: "validation one",
          draftId: draft.id,
          issues: [],
          draftContentHash: null,
          claimAssessments: [
            {
              id: "assessment one",
              field: "section_text",
              sectionId: "sec summary",
              entryId: null,
              bulletId: null,
              claimText: savedSummaryText,
              claimOrigin: "ai_generated",
              contentHash: "fnv1a32:00000000",
              status: "exact",
              evidenceRefs: [],
              verifier: "deterministic_candidate_evidence_v1",
              assessedAt: updatedAt,
            },
          ],
          coverageComparison: null,
          pageCount: null,
          validatedAt: updatedAt,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    );

    expect(
      screen.getByText("Checked against your saved evidence"),
    ).toBeTruthy();

    expect(
      screen.getByText("Current saved text: Exact evidence."),
    ).toBeTruthy();
    expect(
      screen.getByText("New wording is checked after you accept and save."),
    ).toBeTruthy();
  });

  it("paints both proposal decision controls inside every supported viewport", () => {
    const updatedAt = "2026-04-27T00:00:00.000Z";
    const draft: ResumeDraft = {
      id: "draft demo",
      jobId: "job demo",
      status: "draft",
      templateId: "classic_ats",
      identity: null,
      sections: [
        {
          id: "sec summary",
          kind: "summary",
          label: "Summary",
          text: "Systems-focused product designer.",
          bullets: [],
          entries: [],
          origin: "ai_generated",
          locked: false,
          included: true,
          sortOrder: 0,
          entryOrderMode: "chronology",
          profileRecordId: null,
          sourceRefs: [],
          updatedAt,
        },
      ],
      targetPageCount: 2,
      generationMethod: "ai",
      approvedAt: null,
      approvedExportId: null,
      staleReason: null,
      workHistoryReviewAcknowledgments: [],
      claimConfirmations: [],
      issueApprovals: [],
      createdAt: updatedAt,
      updatedAt,
    };
    const patch: ResumeDraftPatch = {
      id: "patch one",
      draftId: draft.id,
      operation: "replace_section_text",
      targetSectionId: "sec summary",
      targetEntryId: null,
      anchorEntryId: null,
      targetBulletId: null,
      anchorBulletId: null,
      position: null,
      newText: "A tighter proposed summary.",
      newIncluded: null,
      newLocked: null,
      newBullets: null,
      appliedAt: updatedAt,
      origin: "assistant",
      conflictReason: null,
    };
    const message: ResumeAssistantMessage = {
      id: "assistant one",
      jobId: "job demo",
      role: "assistant",
      content: "Here is a grounded edit.",
      patches: [patch],
      proposalStatus: "pending",
      baseDraftUpdatedAt: null,
      resolvedPatchIds: [],
      resolvedAt: null,
      proposalError: null,
      createdAt: updatedAt,
    };

    // The reported failures: at 1200x640 the floating panel ran past the
    // window bottom, covered its own `Assistant` tab and `Clear approval`, and
    // painted neither decision control; at 1280x720 the transcript was sliced
    // mid-glyph and the proposal card sat entirely below the clip. Both
    // controls must exist, be enabled, and sit inside a panel that is bounded
    // to the viewport at every supported size.
    for (const viewport of [
      { height: 920, width: 1440 },
      { height: 840, width: 1440 },
      { height: 720, width: 1280 },
      { height: 640, width: 1200 },
    ]) {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewport.width,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: viewport.height,
      });

      const rendered = render(
        <ResumeGuidedEditsPopup
          assistantMessages={[message]}
          assistantPending={false}
          draft={draft}
          isWorkspacePending={false}
          onResolveProposal={vi.fn()}
          onSendAssistantMessage={vi.fn()}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "Open the Assistant, unread activity in this thread",
        }),
      );

      const label = `${viewport.width}x${viewport.height}`;
      const panel = document.querySelector<HTMLElement>(
        "[data-resume-guided-edits-panel]",
      );
      if (!panel) {
        throw new Error(`Expected the Assistant panel at ${label}.`);
      }

      // Bounded to the window, with the transcript as the only scroll region.
      const panelHeight = Number.parseFloat(panel.style.height);
      // Bounded by the measured safe top offset plus the bottom inset, not
      // merely "smaller than the window": the reported failure was a panel
      // whose bottom edge ran past the window at 1200x640.
      expect(panelHeight, `panel height at ${label}`).toBeLessThanOrEqual(
        viewport.height - 128,
      );
      expect(panelHeight, `panel height at ${label}`).toBeGreaterThan(0);
      expect(panel.className).toContain("overflow-hidden");
      expect(
        document.querySelector("[data-resume-guided-edits-transcript]"),
      ).toBeTruthy();

      const reject = screen.getByRole("button", { name: "Reject proposal" });
      const accept = screen.getByRole("button", {
        name: "Accept selected (1)",
      });
      expect(reject.hasAttribute("disabled"), `reject at ${label}`).toBe(false);
      expect(accept.hasAttribute("disabled"), `accept at ${label}`).toBe(false);

      // Both live in the pinned decision row, which sticks to the bottom of
      // the transcript rather than scrolling out of the panel.
      const decisionRow = document.querySelector<HTMLElement>(
        "[data-resume-proposal-decision-row]",
      );
      expect(decisionRow, `decision row at ${label}`).toBeTruthy();
      expect(decisionRow?.contains(reject)).toBe(true);
      expect(decisionRow?.contains(accept)).toBe(true);
      expect(decisionRow?.className).toContain("sticky");
      expect(decisionRow?.className).toContain("bottom-0");

      rendered.unmount();
      cleanup();
    }
  });

  it("keeps the floating panel and launcher at compact widths instead of a second layout", () => {
    // The studio used to own an `Assistant` tab below xl and suppress this
    // panel there, so the Assistant looked and behaved differently depending
    // on the window width. One floating panel now serves every width.
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 640,
    });

    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    const launcher = screen.getByRole("button", {
      name: "Open the Assistant",
    });
    expect(launcher).toBeTruthy();

    fireEvent.click(launcher);

    const panel = screen.getByRole("dialog", { name: "Assistant" });
    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );

    expect(popupRoot?.parentElement).toBe(document.body);
    expect(popupRoot?.className).toContain("fixed");
    // Bounded by the viewport: the panel never runs past the window bottom, so
    // the composer at its foot stays reachable at a short height.
    const panelTop = Number.parseFloat(popupRoot?.style.top ?? "0");
    const panelHeight = Number.parseFloat(panel.style.height);
    expect(panelHeight).toBeGreaterThan(0);
    expect(panelTop + panelHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  it("uses a 384px panel on a full desktop window and 360px below 1280", () => {
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    expect(screen.getByRole("dialog", { name: "Assistant" }).style.width).toBe(
      "384px",
    );

    cleanup();

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });

    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    expect(screen.getByRole("dialog", { name: "Assistant" }).style.width).toBe(
      "360px",
    );
  });

  it.each([
    [1440, 920],
    [1200, 640],
  ])(
    "clamps a drag far outside the window back inside the viewport at %ix%i",
    (viewportWidth, viewportHeight) => {
      // The panel is a fixed, body-portalled surface, so studio scrolling can
      // never move it — and a drag toward the desktop's edge must stop at the
      // window's, never leave part of the panel outside it.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewportWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: viewportHeight,
      });

      renderPopup();
      fireEvent.click(
        screen.getByRole("button", { name: "Open the Assistant" }),
      );

      const popupRoot = document.querySelector<HTMLElement>(
        "[data-resume-guided-edits-open]",
      );
      const dialog = screen.getByRole("dialog", { name: "Assistant" });
      const header = screen.getByLabelText("Drag the Assistant");

      const drags: ReadonlyArray<readonly [number, number]> = [
        [2000, 2000],
        [-2000, -2000],
        [2000, -2000],
      ];

      for (const [dx, dy] of drags) {
        fireEvent.pointerDown(header, {
          button: 0,
          clientX: 400,
          clientY: 300,
          isPrimary: true,
          pointerId: 1,
        });
        fireEvent.pointerMove(header, {
          button: 0,
          clientX: 400 + dx,
          clientY: 300 + dy,
          isPrimary: true,
          pointerId: 1,
        });
        fireEvent.pointerUp(header, {
          button: 0,
          clientX: 400 + dx,
          clientY: 300 + dy,
          isPrimary: true,
          pointerId: 1,
        });

        const left = Number.parseFloat(popupRoot?.style.left ?? "0");
        const top = Number.parseFloat(popupRoot?.style.top ?? "0");
        const width = Number.parseFloat(dialog.style.width);
        const height = Number.parseFloat(dialog.style.height);

        // jsdom resolves no Tailwind stylesheet, so the class is the fact:
        // the surface is a fixed, body-portalled layer, never an absolutely
        // positioned child of a studio scroller.
        expect(popupRoot?.className).toContain("fixed");
        expect(popupRoot?.parentElement).toBe(document.body);
        expect(left, `left after ${dx},${dy}`).toBeGreaterThanOrEqual(0);
        expect(top, `top after ${dx},${dy}`).toBeGreaterThanOrEqual(0);
        expect(
          left + width,
          `right edge after ${dx},${dy}`,
        ).toBeLessThanOrEqual(viewportWidth);
        expect(
          top + height,
          `bottom edge after ${dx},${dy}`,
        ).toBeLessThanOrEqual(viewportHeight);
      }
    },
  );

  it.each([
    [1440, 920],
    [1200, 640],
  ])(
    "minimizes back into the header launcher, floating nothing, at %ix%i",
    (viewportWidth, viewportHeight) => {
      // Previously "collapses into the launcher at the panel's own
      // bottom-right corner at %ix%i": it dragged the panel, faked its rect,
      // minimized, and asserted the collapsed pill's right/bottom edges landed
      // within 1px of the panel's. That corner arithmetic only existed because
      // the collapsed launcher was a free-floating pill. It is a button in the
      // studio header now, so minimizing returns to a fixed place in the
      // layout and the assertion is that nothing is left floating.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewportWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: viewportHeight,
      });

      renderPopup();
      fireEvent.click(
        screen.getByRole("button", { name: "Open the Assistant" }),
      );

      // Drag it away from its opening position so minimize is exercised from
      // somewhere other than where it started.
      const header = screen.getByLabelText("Drag the Assistant");
      for (const [type, clientX, clientY] of [
        ["pointerDown", 500, 400],
        ["pointerMove", 380, 320],
        ["pointerUp", 380, 320],
      ] as const) {
        fireEvent[type](header, {
          button: 0,
          clientX,
          clientY,
          isPrimary: true,
          pointerId: 1,
        });
      }

      expect(
        document.querySelector("[data-resume-guided-edits-open]"),
      ).not.toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Minimize the Assistant" }),
      );

      // No floating surface survives the minimize, at either viewport.
      expect(
        document.querySelector("[data-resume-guided-edits-open]"),
      ).toBeNull();
      expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();

      const launcher = screen.getByRole("button", {
        name: "Open the Assistant",
      });
      expect(
        launcher.closest("[data-resume-studio-assistant-launcher-slot]"),
      ).not.toBeNull();
      // Minimizing returns focus to the control the user pressed.
      expect(document.activeElement).toBe(launcher);
    },
  );

  it("moves the expanded panel by its header while keeping it in the viewport", () => {
    renderPopup();
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );
    const header = screen.getByLabelText("Drag the Assistant");
    const initialLeft = popupRoot?.style.left;

    fireEvent.pointerDown(header, {
      button: 0,
      clientX: 824,
      clientY: 160,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(header, {
      button: 0,
      clientX: 624,
      clientY: 160,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(header, {
      button: 0,
      clientX: 624,
      clientY: 160,
      isPrimary: true,
      pointerId: 1,
    });

    expect(popupRoot?.style.left).not.toBe(initialLeft);
    expect(
      Number.parseInt(popupRoot?.style.left ?? "0", 10),
    ).toBeGreaterThanOrEqual(16);
    expect(
      Number.parseInt(popupRoot?.style.top ?? "0", 10),
    ).toBeGreaterThanOrEqual(112);

    fireEvent.click(
      screen.getByRole("button", { name: "Minimize the Assistant" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
  });

  function buildMessage(
    overrides: Partial<ResumeAssistantMessage> & { id: string },
  ): ResumeAssistantMessage {
    return {
      jobId: "job_ready",
      role: "user",
      content: "Tighten the summary.",
      patches: [],
      proposalStatus: "none",
      baseDraftUpdatedAt: null,
      resolvedPatchIds: [],
      resolvedAt: null,
      proposalError: null,
      createdAt: "2026-08-09T20:00:00.000Z",
      ...overrides,
    } as ResumeAssistantMessage;
  }

  it("timestamps only the first bubble and keeps the exact time on hover", () => {
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[
          buildMessage({ id: "m1" }),
          buildMessage({
            id: "m2",
            role: "assistant",
            content: "Here is the edit.",
            createdAt: "2026-08-09T20:00:12.000Z",
          }),
        ]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    const roleRows = Array.from(
      dialog.querySelectorAll<HTMLElement>("article [title]"),
    );

    expect(roleRows).toHaveLength(2);
    // Both keep the exact time reachable; only the thread anchor prints it.
    for (const row of roleRows) {
      expect(row.getAttribute("title")).toBeTruthy();
    }
    expect(roleRows[0]?.textContent).toContain("·");
    expect(roleRows[1]?.textContent).not.toContain("·");
  });

  it("grows the panel so a pending proposal is not clipped by the composer", () => {
    const { rerender } = render(
      <ResumeGuidedEditsPopup
        assistantMessages={[buildMessage({ id: "m1" })]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    );

    const restingHeight = Number.parseInt(
      screen.getByRole("dialog", { name: "Assistant" }).style.height,
      10,
    );

    rerender(
      <ResumeGuidedEditsPopup
        assistantMessages={[
          buildMessage({ id: "m1" }),
          buildMessage({
            id: "m2",
            role: "assistant",
            content: "I prepared one grounded edit for your review.",
            proposalStatus: "pending",
          }),
        ]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    const proposalHeight = Number.parseInt(
      screen.getByRole("dialog", { name: "Assistant" }).style.height,
      10,
    );

    expect(proposalHeight).toBeGreaterThan(restingHeight);
  });

  it("re-pins the transcript to its bottom when the panel shrinks with a proposal open", () => {
    // At 1440x840 the panel is clamped shorter than at 1440x920, and the
    // transcript is the only region that shrinks. Without a re-pin the
    // proposal's Accept/Reject row stayed half-clipped under the quick
    // actions after the resize.
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[
          buildMessage({ id: "m1" }),
          buildMessage({
            id: "m2",
            role: "assistant",
            content: "I prepared one grounded edit for your review.",
            proposalStatus: "pending",
          }),
        ]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    );

    const transcriptViewport = document
      .querySelector('[data-resume-guided-edits-transcript="true"]')
      ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');

    if (!transcriptViewport) {
      throw new Error("Expected a mounted transcript viewport.");
    }

    Object.defineProperty(transcriptViewport, "scrollHeight", {
      configurable: true,
      value: 900,
    });
    transcriptViewport.scrollTop = 120;

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 840,
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(transcriptViewport.scrollTop).toBe(900);
  });

  it("keeps the grown proposal panel inside the window bottom", () => {
    // The position clamp used to run with the resting 460px maximum while the
    // panel rendered at the taller proposal height, so the panel started low
    // enough for its accept control and composer to fall off the screen.
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[
          buildMessage({ id: "m1" }),
          buildMessage({
            id: "m2",
            role: "assistant",
            content: "I prepared one grounded edit for your review.",
            proposalStatus: "pending",
          }),
        ]}
        assistantPending={false}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the Assistant, unread activity in this thread",
      }),
    );

    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );
    if (!popupRoot) throw new Error("guided edits root missing");
    const panel = screen.getByRole("dialog", { name: "Assistant" });
    const top = Number.parseInt(popupRoot.style.top, 10);
    const height = Number.parseInt(panel.style.height, 10);

    expect(Number.isNaN(top)).toBe(false);
    expect(Number.isNaN(height)).toBe(false);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight);
  });

  it("steps under an open modal scrim and stops being interactive", () => {
    renderPopup();

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );
    if (!popupRoot) throw new Error("guided edits root missing");
    expect(popupRoot.className).toContain("z-[80]");
    expect(popupRoot.hasAttribute("inert")).toBe(false);

    // A window-owning dialog (prepare consent, unsaved changes, ...) opens.
    act(() => {
      markJobFinderOverlayAsModal(acquireJobFinderOverlay(() => {}));
    });

    // The panel portals to document.body, so the modal's #root inertness can
    // never reach it: it must drop below the z-50 scrim and go inert itself.
    expect(popupRoot.className).toContain("z-30");
    expect(popupRoot.className).not.toContain("z-[80]");
    expect(popupRoot.getAttribute("aria-hidden")).toBe("true");
    expect(popupRoot.hasAttribute("inert")).toBe(true);
    expect(
      popupRoot.getAttribute("data-resume-guided-edits-covered-by-modal"),
    ).toBe("true");
  });

  it("shows a live working indicator on the minimized launcher", () => {
    render(
      <ResumeGuidedEditsPopup
        assistantMessages={[buildMessage({ id: "m1" })]}
        assistantPending={true}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
      />,
    );

    const launcher = screen.getByRole("button", {
      name: "Open the Assistant, reply in progress",
    });

    expect(launcher.getAttribute("title")).toContain("working on your request");
    expect(launcher.querySelector(".animate-pulse")).toBeTruthy();
  });
  describe("floating at every width", () => {
    function renderFloating(
      overrides?: Partial<{
        assistantMessages: ResumeAssistantMessage[];
        onRegenerateDraft: () => void;
      }>,
    ) {
      render(
        <ResumeGuidedEditsPopup
          assistantMessages={overrides?.assistantMessages ?? []}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
          {...(overrides?.onRegenerateDraft
            ? { onRegenerateDraft: overrides.onRegenerateDraft }
            : {})}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Open the Assistant" }),
      );
    }

    it("never docks into a studio column", () => {
      renderFloating();

      const panel = screen.getByRole("dialog", { name: "Assistant" });
      const popupRoot = document.querySelector<HTMLElement>(
        "[data-resume-guided-edits-open]",
      );

      // The retired docked variant portalled into a studio grid column and
      // let that column size it. The panel now owns its own pixel box and
      // always hangs off `document.body`.
      expect(popupRoot?.parentElement).toBe(document.body);
      expect(document.querySelector("[data-resume-guided-edits-docked]")).toBe(
        null,
      );
      expect(panel.style.width).not.toBe("");
      expect(panel.style.height).not.toBe("");
      expect(panel.style.maxHeight).not.toBe("");
      expect(panel.className).toContain("pointer-events-auto");
      // The launcher pill is the closed-state entry point only.
      expect(
        screen.queryByRole("button", { name: /^Open the Assistant/ }),
      ).toBeNull();
    });

    it("keeps the composer pinned below a scrolling transcript at a short viewport", () => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 640,
      });

      renderFloating();

      const panel = screen.getByRole("dialog", { name: "Assistant" });
      const composer = panel.querySelector<HTMLElement>(
        '[data-resume-guided-edits-composer="true"]',
      );
      const transcript = panel.querySelector<HTMLElement>(
        '[data-resume-guided-edits-transcript="true"]',
      );

      expect(panel.className).toContain("overflow-hidden");
      expect(panel.className).toContain("min-h-0");
      expect(transcript?.className).toContain("flex-1");
      expect(transcript?.className).toContain("min-h-0");
      expect(composer?.className).toContain("shrink-0");
      // Composer last means the window bottom can never clip it: the panel is
      // bounded by the viewport, and only the transcript flexes.
      if (!composer || !transcript) {
        throw new Error("Expected a floating transcript and composer.");
      }
      expect(composer.parentElement?.lastElementChild).toBe(composer);
      expect(
        composer.compareDocumentPosition(transcript) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();
    });

    it("keeps the whole-draft rewrite in its own footer above the composer", () => {
      renderFloating({ onRegenerateDraft: vi.fn() });

      const panel = screen.getByRole("dialog", { name: "Assistant" });
      const quickActions = panel.querySelector<HTMLElement>(
        '[data-resume-assistant-quick-actions="true"]',
      );
      const composer = panel.querySelector<HTMLElement>(
        '[data-resume-guided-edits-composer="true"]',
      );

      if (!quickActions || !composer) {
        throw new Error("Expected quick actions above the composer.");
      }
      expect(quickActions.className).toContain("shrink-0");
      expect(
        screen.getByRole("button", {
          name: "Create a new AI draft — this replaces your edits",
        }),
      ).toBeTruthy();
      expect(
        quickActions.compareDocumentPosition(composer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("unmounts the panel and restores the launcher when minimized", () => {
      renderFloating();

      fireEvent.click(
        screen.getByRole("button", { name: "Minimize the Assistant" }),
      );

      expect(
        document.querySelector("[data-resume-guided-edits-panel]"),
      ).toBeNull();

      const launcher = screen.getByRole("button", {
        name: "Open the Assistant",
      });

      expect(launcher).toBeTruthy();
      // Previously this asserted the floating root survived the minimize as a
      // body-portalled `data-resume-guided-edits-open="false"` container
      // holding the pill. Nothing floats while collapsed now: the launcher is
      // a button in the studio header, so the root is gone entirely.
      expect(
        document.querySelector("[data-resume-guided-edits-open]"),
      ).toBeNull();
      expect(
        launcher.closest("[data-resume-studio-assistant-launcher-slot]"),
      ).not.toBeNull();
    });

    it("steps under a modal scrim", () => {
      renderFloating();

      act(() => {
        markJobFinderOverlayAsModal(acquireJobFinderOverlay(() => {}));
      });

      const popupRoot = document.querySelector<HTMLElement>(
        "[data-resume-guided-edits-open]",
      );

      expect(popupRoot?.getAttribute("aria-hidden")).toBe("true");
      expect(popupRoot?.hasAttribute("inert")).toBe(true);
      expect(
        popupRoot?.getAttribute("data-resume-guided-edits-covered-by-modal"),
      ).toBe("true");
    });
  });
});

describe("ResumeGuidedEditsPopup no-cover zones", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    class PointerEventMock extends MouseEvent {
      readonly isPrimary: boolean;
      readonly pointerId: number;

      constructor(
        type: string,
        init: MouseEventInit & { isPrimary?: boolean; pointerId?: number },
      ) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
        this.pointerId = init.pointerId ?? 1;
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("PointerEvent", PointerEventMock);
  });

  afterEach(() => {
    cleanup();
    resetJobFinderOverlaysForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    });
  }

  function mockRects(rects: Readonly<Record<string, DOMRectInit>>) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const attribute = Object.keys(rects).find((candidate) =>
          this.hasAttribute(candidate),
        );
        const rect = attribute ? rects[attribute] : undefined;
        const top = rect?.y ?? 0;
        const height = rect?.height ?? 0;
        const left = rect?.x ?? 0;
        const width = rect?.width ?? 0;

        return {
          bottom: top + height,
          height,
          left,
          right: left + width,
          top,
          width,
          x: left,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
  }

  it("anchors the open panel below the compact Tools tab strip at 1200x640", () => {
    // Below xl the tab strip is the only route to the editor, the template
    // chooser and approval. The panel used to be anchored only under the
    // sticky approval row, so at 1200x640 it rested over the whole strip and
    // left no visible way back to the resume.
    setViewport(1200, 640);
    mockRects({
      "data-resume-workspace-top-actions": {
        height: 50,
        width: 1200,
        x: 0,
        y: 100,
      },
      "data-resume-studio-compact-tabs": {
        height: 40,
        width: 1200,
        x: 0,
        y: 160,
      },
    });

    render(
      <>
        <section data-resume-workspace-top-actions />
        <div data-resume-studio-compact-tabs />
        <span data-resume-studio-assistant-launcher-slot />
        <ResumeGuidedEditsPopup
          assistantMessages={[]}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
        />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    const popupRoot = document.querySelector<HTMLElement>(
      "[data-resume-guided-edits-open]",
    );
    const panelTop = Number.parseFloat(popupRoot?.style.top ?? "0");

    // Both no-cover zones stay above the panel, with the shared 16px gap.
    expect(panelTop).toBeGreaterThanOrEqual(150);
    expect(panelTop).toBeGreaterThanOrEqual(200);
    expect(panelTop).toBe(216);

    // The height is capped to the space that is left, so the composer at the
    // panel's bottom stays inside the window.
    const dialog = screen.getByRole("dialog", { name: "Assistant" });
    expect(dialog.style.maxHeight).toBe("calc(100vh - 232px)");
    expect(panelTop + 640 - 216 - 16).toBeLessThanOrEqual(640);
  });

  it("never floats the collapsed launcher over a tools-column action row", () => {
    // Previously two tests: "lifts the resting launcher off a tools-column
    // action row" (asserting the parked pill's clearance rose to 94px so it
    // cleared the applied-AI-edit row's `Undo`) and "keeps the shared inset
    // when nothing would sit under the launcher" (asserting `bottom: 16px`).
    //
    // Both described a pill fixed over the tools column. Lifting it only ever
    // fixed the rows the clearance set happened to name, and a reservation at
    // the column's end left the middle of the scroll uncovered. The launcher
    // does not float at all now, so there is nothing to lift and nothing that
    // can rest over any row at any scroll position.
    setViewport(1280, 800);
    mockRects({
      "data-resume-draft-provenance": {
        height: 40,
        width: 264,
        x: 1000,
        y: 730,
      },
    });

    render(
      <>
        <div data-resume-draft-provenance>
          <button type="button">Undo</button>
        </div>
        <span data-resume-studio-assistant-launcher-slot />
        <ResumeGuidedEditsPopup
          assistantMessages={[]}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
        />
      </>,
    );

    expect(
      document.querySelector("[data-resume-guided-edits-open]"),
    ).toBeNull();

    const launcher = screen.getByRole("button", {
      name: "Open the Assistant",
    });

    expect(
      launcher.closest("[data-resume-studio-assistant-launcher-slot]"),
    ).not.toBeNull();
    // Nothing positions it against the viewport any more.
    expect(launcher.style.position).toBe("");
    expect(launcher.style.bottom).toBe("");
    expect(launcher.className).not.toContain("fixed");
  });

  it("changes nothing in the studio grid when the Assistant opens", () => {
    // The r13 invariant: the Assistant is a body-portalled floating layer, so
    // opening it can never reflow the preview or tools rects.
    setViewport(1440, 920);
    mockRects({});

    render(
      <>
        <div data-resume-studio-grid-columns="preview-tools">
          <div data-resume-studio-preview-pane="true">Preview</div>
          <div data-resume-studio-tools-pane="true">Tools</div>
        </div>
        <span data-resume-studio-assistant-launcher-slot />
        <ResumeGuidedEditsPopup
          assistantMessages={[]}
          assistantPending={false}
          isWorkspacePending={false}
          onSendAssistantMessage={vi.fn()}
        />
      </>,
    );

    const grid = document.querySelector<HTMLElement>(
      "[data-resume-studio-grid-columns]",
    );
    const before = grid?.outerHTML;

    fireEvent.click(screen.getByRole("button", { name: "Open the Assistant" }));

    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
    expect(grid?.outerHTML).toBe(before);
    expect(grid?.querySelector("[data-resume-guided-edits-panel]")).toBeNull();
    expect(
      document.querySelector("[data-resume-guided-edits-open]")?.parentElement,
    ).toBe(document.body);
  });
});
