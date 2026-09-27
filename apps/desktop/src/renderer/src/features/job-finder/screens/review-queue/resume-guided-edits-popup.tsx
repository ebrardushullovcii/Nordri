import { GripHorizontal, MessageSquare, Minus, Sparkles } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ResumeAssistantMessage,
  ResumeDraft,
  ResumeValidationResult,
} from "@unemployed/contracts";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/cn";
import {
  COPILOT_BOTTOM_OFFSET,
  COPILOT_NAV_SAFE_OFFSET,
  clampCopilotPosition,
  getDefaultCopilotPosition,
  getCopilotPanelDimensions,
  getCopilotViewportInset,
} from "../../components/profile/profile-copilot-rail-layout";
import { isImeComposingEvent } from "../../lib/job-finder-shortcuts";
import {
  useHasOpenJobFinderModal,
  useJobFinderOverlayOwnership,
} from "../../lib/job-finder-overlay-ownership";
import { ResumeAssistantPanel } from "./resume-assistant-panel";
import { useDesktopStudioLayout } from "./use-desktop-studio-layout";

/**
 * Surfaces the panel may never cover. Each one is either the sticky approval
 * row or the compact tab strip, and below xl the tab strip is the only route
 * to the editor, the template chooser and approval — a panel resting over it
 * leaves the user with no visible way back to the resume itself.
 */
const GUIDED_EDITS_NO_COVER_SELECTORS = [
  "[data-job-finder-shell-header]",
  "[data-resume-workspace-top-actions]",
  "[data-resume-studio-compact-tabs]",
] as const;

/**
 * Surfaces the panel may never cover from below.
 *
 * The Assistant tells people to press Undo, and Undo sits in the tools
 * column's provenance row — directly under where this panel rests. Closing the
 * panel that told you to undo was the only way to reach the button, so the
 * panel now floats above that row the same way it floats below the header.
 */
/** Never let the no-cover rows squash the panel below this. */
const GUIDED_EDITS_PANEL_MIN_HEIGHT = 360;

const GUIDED_EDITS_BOTTOM_NO_COVER_SELECTORS = [
  "[data-resume-draft-provenance]",
  "[data-resume-assistant-quick-actions]",
] as const;

/**
 * Tall enough that a one-change proposal card shows its header, its change
 * rows, and its Accept/Reject controls above the composer. The shared layout
 * helper still clamps it to the viewport.
 */
const GUIDED_EDITS_PROPOSAL_PANEL_HEIGHT = 640;

/** Resting height; the shared layout helper clamps it to the viewport. */
const GUIDED_EDITS_PANEL_HEIGHT = 460;

/** Comfortable reading width on a full desktop window. */
export const GUIDED_EDITS_PANEL_WIDE_WIDTH = 384;

/** Narrower windows give the studio panes their width back first. */
export const GUIDED_EDITS_PANEL_NARROW_WIDTH = 360;

/** Never narrower than this unless the window itself is. */
export const GUIDED_EDITS_PANEL_MIN_WIDTH = 320;

export const GUIDED_EDITS_PANEL_WIDE_BREAKPOINT = 1280;

/**
 * The Assistant is a floating panel at every width — it never takes a studio
 * grid column, so opening it can never reflow the preview or tools panes.
 * Only its own width follows the window. The shared Copilot layout helper
 * clamps this against the real viewport, so a window narrower than the floor
 * still gets a panel that fits.
 */
export function getGuidedEditsPanelMaxWidth(viewportWidth: number): number {
  return Math.max(
    GUIDED_EDITS_PANEL_MIN_WIDTH,
    viewportWidth >= GUIDED_EDITS_PANEL_WIDE_BREAKPOINT
      ? GUIDED_EDITS_PANEL_WIDE_WIDTH
      : GUIDED_EDITS_PANEL_NARROW_WIDTH,
  );
}

/**
 * The studio header's launcher slot.
 *
 * The collapsed launcher used to be a pill fixed to the window corner, resting
 * over the tools column. A bottom padding reservation cleared it only at the
 * END of that column's scroll — mid-scroll the template card and the fallback
 * disclosure still passed underneath — and no reservation can hold for a
 * scrolling column, so the launcher moved into the row that already owns this
 * screen's actions.
 *
 * The slot is resolved from the DOM (and re-resolved as the shell mounts and
 * remounts across the studio breakpoint) because the shell renders it, not
 * this component's parent.
 */
const STUDIO_LAUNCHER_SLOT_SELECTOR =
  "[data-resume-studio-assistant-launcher-slot]";

/**
 * The studio's dock for the open Assistant: a right-hand column beside the
 * preview and tools panes (see `ResumeWorkspaceStudioShell`).
 *
 * The open panel used to float over the studio, hung below the approval row
 * and above the tools column's Undo row, which put it in the middle of the
 * right side, over Save, the template chooser and the editor controls. No
 * floating position avoids that at every window size and scroll position,
 * because the tools column runs the full studio height. Docked, the panel
 * sits where a chat is expected (the right edge, down to the bottom corner)
 * and the studio narrows to make room: it covers nothing.
 *
 * Rendered without a studio shell (no dock slot), the panel falls back to the
 * floating placement below.
 */
export const STUDIO_ASSISTANT_DOCK_SLOT_SELECTOR =
  "[data-resume-studio-assistant-dock-slot]";

function useStudioLauncherSlot(
  selector: string = STUDIO_LAUNCHER_SLOT_SELECTOR,
): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const resolve = () => {
      const next = document.querySelector<HTMLElement>(selector);
      setSlot((current) => (current === next ? current : next));
    };

    resolve();

    if (typeof MutationObserver === "undefined") {
      return undefined;
    }

    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);

  return slot;
}

export function ResumeGuidedEditsPopup(props: {
  assistantMessages: readonly ResumeAssistantMessage[];
  assistantPending: boolean;
  draft?: ResumeDraft | null;
  isWorkspacePending: boolean;
  onSendAssistantMessage: (content: string) => void;
  onReloadWorkspace?: () => void;
  /** Whole-draft rewrite, offered here as the single named AI action. */
  onRegenerateDraft?: () => void;
  /** Reports open/minimized state; the studio docks the open panel. */
  onOpenChange?: (open: boolean) => void;
  openRequestKey?: number;
  onEditProposalWording?: (targetId: string) => void;
  onResolveProposal?: (
    proposalId: string,
    action: "accept" | "reject",
    patchIds: readonly string[],
  ) => void;
  validation?: ResumeValidationResult | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // The floating assistant dialog joins the app-wide LIFO overlay stack so
  // stacked surfaces close one per Escape and shell aliases stay blocked.
  const { isTopmost: isPopupTopmost } = useJobFinderOverlayOwnership({
    active: isOpen,
    close: () => {
      setIsOpen(false);
    },
  });
  // A window-owning dialog (prepare consent, unsaved changes, …) must be the
  // only thing the user can act on. This panel portals to `document.body`, so
  // it never inherits the modal's `#root` inertness; it steps under the scrim
  // and turns itself off instead.
  const isCoveredByModal = useHasOpenJobFinderModal();
  const isDesktopStudio = useDesktopStudioLayout();
  const [safeTopOffset, setSafeTopOffset] = useState(COPILOT_NAV_SAFE_OFFSET);
  const [safeBottomOffset, setSafeBottomOffset] = useState(
    COPILOT_BOTTOM_OFFSET,
  );
  // The row that owns this screen's actions, resolved from the DOM because the
  // studio shell renders it, not this component's parent.
  const launcherSlot = useStudioLauncherSlot();
  const dockSlot = useStudioLauncherSlot(STUDIO_ASSISTANT_DOCK_SLOT_SELECTOR);
  // Only the panel's own width follows the window. The studio grid never
  // changes with it, so nothing behind the panel can reflow.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined"
      ? GUIDED_EDITS_PANEL_WIDE_BREAKPOINT
      : window.innerWidth,
  );
  const [position, setPosition] = useState(() => getDefaultCopilotPosition());
  const [hasCustomPosition, setHasCustomPosition] = useState(false);
  const composerId = useId();
  const panelId = useId();
  const titleId = useId();
  const popupRootRef = useRef<HTMLDivElement | null>(null);
  const dockedLauncherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // The corner the surface must keep across a minimize or expand. The launcher
  // pill is a labelled control, not the 48px square the shared layout helper
  // assumes, so the exact anchor is settled against the rendered surface.
  const cornerAnchorRef = useRef<{ bottom: number; right: number } | null>(
    null,
  );
  const wasOpenRef = useRef(false);
  const handledOpenRequestKeyRef = useRef(0);
  const transcriptViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    moved: boolean;
    suppressClickOnFinish: boolean;
  } | null>(null);
  const suppressNextBubbleClickRef = useRef(false);
  // A grounded proposal is the one thing in this thread the user must read in
  // full before deciding. At the resting panel height its header, checkboxes,
  // and Accept/Reject controls were clipped behind the composer, so a pending
  // proposal is allowed to grow the panel (still clamped to the viewport by
  // the shared layout helper).
  const hasPendingProposal = props.assistantMessages.some(
    (message) =>
      message.role === "assistant" && message.proposalStatus === "pending",
  );
  // The same limits must drive the rendered height AND every position clamp.
  // Clamping with the default 460px maximum while rendering the taller
  // proposal panel let the panel start low enough to run past the window
  // bottom, hiding the Accept control and the composer.
  const acceptedProposalCount = props.assistantMessages.filter(
    (message) =>
      message.role === "assistant" && message.proposalStatus === "accepted",
  ).length;
  const launcherBadgeLabel = props.assistantPending
    ? "Reply in progress"
    : hasPendingProposal
      ? "A proposal is waiting for your decision"
      : acceptedProposalCount > 0
        ? acceptedProposalCount === 1
          ? "1 applied change in this thread"
          : `${acceptedProposalCount} applied changes in this thread`
        : props.assistantMessages.length > 0
          ? "This thread has replies"
          : null;
  const panelMaxHeight = hasPendingProposal
    ? GUIDED_EDITS_PROPOSAL_PANEL_HEIGHT
    : GUIDED_EDITS_PANEL_HEIGHT;
  const panelMaxWidth = getGuidedEditsPanelMaxWidth(viewportWidth);
  const panelSizeLimits = {
    maxHeight: panelMaxHeight,
    maxWidth: panelMaxWidth,
  };
  // The rows the panel is asked not to cover can sit anywhere on screen once
  // the studio scrolls; a provenance row near the top of the window used to
  // push the bottom offset up to nearly the full height and squash the panel
  // to a sliver with no room for the composer. The panel keeps a usable
  // height first and covers such a row second.
  const effectiveBottomOffset =
    typeof window === "undefined"
      ? safeBottomOffset
      : Math.min(
          safeBottomOffset,
          Math.max(
            COPILOT_BOTTOM_OFFSET,
            window.innerHeight - safeTopOffset - GUIDED_EDITS_PANEL_MIN_HEIGHT,
          ),
        );
  const panelDimensions = getCopilotPanelDimensions(
    safeTopOffset,
    effectiveBottomOffset,
    panelSizeLimits,
  );
  const viewportInset =
    typeof window === "undefined"
      ? COPILOT_BOTTOM_OFFSET
      : getCopilotViewportInset(window.innerWidth);

  useLayoutEffect(() => {
    const safeTopSources = GUIDED_EDITS_NO_COVER_SELECTORS.flatMap(
      (selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element ? [element] : [];
      },
    );

    if (safeTopSources.length === 0) {
      return;
    }

    const updateSafeTopOffset = () => {
      setSafeTopOffset(
        Math.max(
          COPILOT_NAV_SAFE_OFFSET,
          ...safeTopSources.map((element) =>
            Math.ceil(element.getBoundingClientRect().bottom + 16),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(updateSafeTopOffset);

    updateSafeTopOffset();
    safeTopSources.forEach((element) => observer.observe(element));
    window.addEventListener("resize", updateSafeTopOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSafeTopOffset);
    };
    // The compact tab strip only exists below xl, so the no-cover set has to
    // be re-queried when the studio crosses that breakpoint.
  }, [isDesktopStudio]);

  useLayoutEffect(() => {
    // Rows inside the panel itself (its own quick actions) are never
    // something to avoid: measuring them clamped the panel to a sliver.
    const readBottomSources = () =>
      GUIDED_EDITS_BOTTOM_NO_COVER_SELECTORS.flatMap((selector) =>
        [...document.querySelectorAll<HTMLElement>(selector)].filter(
          (element) => !panelRef.current?.contains(element),
        ),
      );
    const updateSafeBottomOffset = () => {
      const sources = readBottomSources();
      setSafeBottomOffset(
        sources.length === 0
          ? COPILOT_BOTTOM_OFFSET
          : Math.max(
              COPILOT_BOTTOM_OFFSET,
              ...sources.map((element) => {
                const rect = element.getBoundingClientRect();
                // A row scrolled off the bottom of the window asks for
                // nothing; only what is actually on screen lifts the panel.
                if (rect.height === 0 || rect.top >= window.innerHeight) {
                  return COPILOT_BOTTOM_OFFSET;
                }
                return Math.ceil(window.innerHeight - rect.top + 16);
              }),
            ),
      );
    };
    const observer = new ResizeObserver(updateSafeBottomOffset);

    updateSafeBottomOffset();
    readBottomSources().forEach((element) => observer.observe(element));
    window.addEventListener("resize", updateSafeBottomOffset);
    window.addEventListener("scroll", updateSafeBottomOffset, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSafeBottomOffset);
      window.removeEventListener("scroll", updateSafeBottomOffset, true);
    };
    // The tools column only exists above the studio breakpoint, so the set is
    // re-queried when the studio crosses it.
  }, [isDesktopStudio, isOpen]);

  useEffect(() => {
    setPosition((current) =>
      clampCopilotPosition({
        x: current.x,
        y: current.y,
        isOpen,
        minBottomOffset: effectiveBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits: {
          maxHeight: panelMaxHeight,
          maxWidth: panelMaxWidth,
        },
      }),
    );
  }, [
    isOpen,
    panelMaxHeight,
    panelMaxWidth,
    effectiveBottomOffset,
    safeTopOffset,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setPosition((current) =>
        clampCopilotPosition({
          x: current.x,
          y: current.y,
          isOpen,
          minBottomOffset: effectiveBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits: {
            maxHeight: panelMaxHeight,
            maxWidth: panelMaxWidth,
          },
        }),
      );
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [
    isOpen,
    panelMaxHeight,
    panelMaxWidth,
    effectiveBottomOffset,
    safeTopOffset,
  ]);

  // The pill and the panel are different sizes, and the pill is a labelled
  // control rather than the shared 48px square, so the exact corner is settled
  // against the surface that actually rendered. Without this the pill lands up
  // to its own label width away from the corner the panel folded out of.
  useLayoutEffect(() => {
    const corner = cornerAnchorRef.current;
    const root = popupRootRef.current;

    if (!corner || !root) {
      return;
    }

    cornerAnchorRef.current = null;

    const rect = root.getBoundingClientRect();

    if (rect.width <= 0 && rect.height <= 0) {
      return;
    }

    if (
      Math.abs(rect.right - corner.right) <= 1 &&
      Math.abs(rect.bottom - corner.bottom) <= 1
    ) {
      return;
    }

    setPosition(
      clampCopilotPosition({
        x: corner.right - rect.width,
        y: corner.bottom - rect.height,
        isOpen,
        minBottomOffset: effectiveBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits,
      }),
    );
    setHasCustomPosition(true);
  }, [isOpen]);

  // The panel is a fixed, body-portalled surface, so studio scrolling can never
  // move it — but its own height changes (a pending proposal grows it) can
  // still leave a low-sitting panel hanging past the window bottom. Watching
  // the rendered panel re-clamps on every such change, the same way the
  // Profile Copilot placement helper does.
  useEffect(() => {
    const panel = panelRef.current;

    if (!isOpen || !panel || typeof ResizeObserver === "undefined") {
      return;
    }

    const reclamp = () => {
      setPosition((current) =>
        clampCopilotPosition({
          x: current.x,
          y: current.y,
          isOpen: true,
          minBottomOffset: effectiveBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits: {
            maxHeight: panelMaxHeight,
            maxWidth: panelMaxWidth,
          },
        }),
      );
    };

    const observer = new ResizeObserver(reclamp);
    observer.observe(panel);

    return () => observer.disconnect();
  }, [
    isOpen,
    panelMaxHeight,
    panelMaxWidth,
    effectiveBottomOffset,
    safeTopOffset,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isImeComposingEvent(event)) {
        return;
      }
      if (event.key !== "Escape" || !isPopupTopmost()) {
        return;
      }

      event.preventDefault();
      setIsOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopupTopmost, isOpen]);

  const onOpenChange = props.onOpenChange;
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    const requestKey = props.openRequestKey ?? 0;
    if (requestKey <= 0 || requestKey === handledOpenRequestKeyRef.current) {
      return;
    }

    handledOpenRequestKeyRef.current = requestKey;
    setIsOpen(true);
  }, [props.openRequestKey]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      document.getElementById(composerId)?.focus();
      return;
    }

    if (!isOpen && wasOpen) {
      // The launcher is a button in the studio header now, not a control
      // inside a floating root that no longer exists while collapsed.
      dockedLauncherRef.current?.focus();
    }
  }, [composerId, isOpen]);

  /**
   * Minimizing collapses the panel toward its own bottom-right corner and
   * reopening expands it back out of the pill's corner, the way the Profile
   * Assistant behaves. Keeping the stored top-left instead made the pill jump
   * to where the panel's *top-left* had been, which reads as the thread moving
   * rather than folding away.
   */
  function getCornerAnchoredPosition(nextOpen: boolean) {
    const measured = popupRootRef.current?.getBoundingClientRect();
    // A zero-sized rect means nothing is laid out yet; the declared geometry is
    // then the honest source for the corner the surface currently occupies.
    const rendered =
      measured && (measured.width > 0 || measured.height > 0) ? measured : null;
    const nextWidth = nextOpen
      ? panelDimensions.expandedWidth
      : panelDimensions.collapsedWidth;
    const nextHeight = nextOpen
      ? panelDimensions.expandedHeight
      : panelDimensions.collapsedHeight;
    const currentWidth = nextOpen
      ? panelDimensions.collapsedWidth
      : panelDimensions.expandedWidth;
    const currentHeight = nextOpen
      ? panelDimensions.collapsedHeight
      : panelDimensions.expandedHeight;
    // While closed the launcher is a button in the studio header, not a
    // corner-anchored pill, so the panel folds out of — and back into — that
    // button's own rect.
    const dockedRect = dockedLauncherRef.current?.getBoundingClientRect();
    // Fold out from the far right of the launcher's own row, not from the
    // button itself: the button sits left of "Approve resume", and a panel
    // hung from its right edge straddled the preview/tools seam and hid the
    // preview the edits are about. Hugging the row's right edge keeps the
    // whole preview visible; only the tools column sits under the panel.
    const dockedRowRect = dockedLauncherRef.current
      ?.closest("[data-resume-studio-compact-header]")
      ?.getBoundingClientRect();
    const restingCorner =
      !isOpen &&
      !hasCustomPosition &&
      dockedRect &&
      (dockedRect.width > 0 || dockedRect.height > 0)
        ? {
            bottom: dockedRect.bottom,
            right:
              dockedRowRect && dockedRowRect.right > dockedRect.right
                ? dockedRowRect.right
                : dockedRect.right,
          }
        : null;
    // The resting corner wins when it applies: it is exactly where the pill is
    // painted, and it stays correct even before the launcher has been laid out.
    const right =
      restingCorner?.right ?? rendered?.right ?? position.x + currentWidth;
    const bottom =
      restingCorner?.bottom ?? rendered?.bottom ?? position.y + currentHeight;

    return {
      corner: { bottom, right },
      position: clampCopilotPosition({
        // Same bottom-right corner, whichever size the surface takes next.
        x: right - nextWidth,
        y: bottom - nextHeight,
        isOpen: nextOpen,
        minBottomOffset: effectiveBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits,
      }),
    };
  }

  function toggleOpen() {
    const nextOpen = !isOpen;
    const { corner, position: nextPosition } =
      getCornerAnchoredPosition(nextOpen);

    cornerAnchorRef.current = corner;
    setPosition(nextPosition);
    setIsOpen(nextOpen);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.isPrimary === false || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    const interactiveTarget = target.closest<HTMLElement>(
      "button, textarea, input, a, [role='button']",
    );
    if (interactiveTarget && interactiveTarget !== event.currentTarget) {
      return;
    }

    const renderedBounds = event.currentTarget.getBoundingClientRect();
    const useRenderedAnchor = !isOpen && !hasCustomPosition;

    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: useRenderedAnchor ? renderedBounds.left : position.x,
      startY: useRenderedAnchor ? renderedBounds.top : position.y,
      moved: false,
      suppressClickOnFinish: event.currentTarget instanceof HTMLButtonElement,
    };

    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateDrag(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.originX;
    const deltaY = event.clientY - dragState.originY;

    if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 6) {
      return;
    }

    dragState.moved = true;
    setHasCustomPosition(true);
    setPosition(
      clampCopilotPosition({
        x: dragState.startX + deltaX,
        y: dragState.startY + deltaY,
        isOpen,
        minBottomOffset: effectiveBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits,
      }),
    );
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.isPrimary === false || event.button !== 0) {
      return;
    }

    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    if (dragState.suppressClickOnFinish) {
      suppressNextBubbleClickRef.current = dragState.moved;
    }

    if (!dragState.moved) {
      event.preventDefault();
    }
  }

  function cancelDrag(event: ReactPointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    if (dragState.suppressClickOnFinish) {
      suppressNextBubbleClickRef.current = dragState.moved;
    }
  }

  if (typeof document === "undefined") {
    return null;
  }

  // Open, the Assistant docks into the studio's right-hand column (below);
  // the floating placement is the fallback when no studio shell is mounted.
  // While collapsed there is no surface at all — only the button in
  // the studio header. Nothing can rest over the tools column at any scroll
  // position because nothing is painted over it.
  if (!isOpen) {
    return launcherSlot
      ? createPortal(
          <Button
            aria-expanded={false}
            aria-haspopup="dialog"
            aria-label={
              props.assistantPending
                ? "Open the Assistant, reply in progress"
                : props.assistantMessages.length > 0
                  ? "Open the Assistant, unread activity in this thread"
                  : "Open the Assistant"
            }
            className="relative"
            data-resume-guided-edits-launcher="true"
            onClick={toggleOpen}
            ref={dockedLauncherRef}
            size="compact"
            title={
              props.assistantPending
                ? "The Assistant is working on your request — open to watch the thread"
                : "Open the Assistant"
            }
            type="button"
            variant="secondary"
          >
            {props.assistantPending ? (
              <Sparkles aria-hidden="true" className="size-4 animate-pulse" />
            ) : (
              <MessageSquare aria-hidden="true" className="size-4" />
            )}
            Assistant
            {/* An unexplained dot could mean an unread reply, a proposal
                waiting for a decision, or a change already applied. It says
                which. */}
            {launcherBadgeLabel ? (
              <span
                className="absolute right-0.5 top-0.5 size-2 rounded-full border border-background bg-primary"
                title={launcherBadgeLabel}
              >
                <span className="sr-only">{launcherBadgeLabel}</span>
              </span>
            ) : null}
          </Button>,
          launcherSlot,
        )
      : null;
  }

  const minimizeButton = (
    /* Minimizing is the only way back to the full-width studio, so it may not
       be the least visible control on the panel. It uses the same bordered
       treatment every dialog close control uses instead of a bare ghost icon. */
    <Button
      aria-controls={panelId}
      aria-expanded={isOpen}
      aria-label="Minimize the Assistant"
      className="border border-(--border-strong) text-foreground"
      data-resume-guided-edits-minimize
      onClick={toggleOpen}
      size="icon-xs"
      title="Minimize the Assistant"
      type="button"
      variant="ghost"
    >
      <Minus className="size-3.5" />
    </Button>
  );
  const panelCallbacks = {
    ...(props.onEditProposalWording
      ? { onEditProposalWording: props.onEditProposalWording }
      : {}),
    ...(props.onReloadWorkspace
      ? { onReloadWorkspace: props.onReloadWorkspace }
      : {}),
    ...(props.onRegenerateDraft
      ? { onRegenerateDraft: props.onRegenerateDraft }
      : {}),
    ...(props.onResolveProposal
      ? { onResolveProposal: props.onResolveProposal }
      : {}),
  };

  if (dockSlot) {
    // Docked: an ordinary column inside the studio, so it scrolls with nothing,
    // needs no drag, and a window-owning modal makes it inert together with
    // the rest of #root.
    return createPortal(
      <aside
        aria-labelledby={titleId}
        aria-modal="false"
        className="guided-edits-panel-enter flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border) bg-(--guided-edits-panel-bg)"
        data-resume-guided-edits-docked="true"
        data-resume-guided-edits-open="true"
        data-resume-guided-edits-panel="true"
        id={panelId}
        ref={panelRef}
        role="dialog"
      >
        <ResumeAssistantPanel
          assistantMessages={props.assistantMessages}
          assistantPending={props.assistantPending}
          composerId={composerId}
          draft={props.draft ?? null}
          headerActions={minimizeButton}
          isWorkspacePending={props.isWorkspacePending}
          {...panelCallbacks}
          onSendAssistantMessage={props.onSendAssistantMessage}
          titleId={titleId}
          transcriptViewportRef={transcriptViewportRef}
          validation={props.validation ?? null}
        />
      </aside>,
      dockSlot,
    );
  }

  return createPortal(
    <div
      aria-hidden={isCoveredByModal ? "true" : undefined}
      className={cn(
        "pointer-events-none fixed flex min-w-0 flex-col items-end gap-3",
        "max-w-[min(24rem,calc(100vw-1.5rem))]",
        // The modal scrim owns z-50; dropping to z-30 puts this panel behind
        // it so it is dimmed and blurred like the rest of the app.
        isCoveredByModal ? "z-30" : "z-[80]",
      )}
      data-resume-guided-edits-covered-by-modal={
        isCoveredByModal ? "true" : "false"
      }
      data-resume-guided-edits-open="true"
      inert={isCoveredByModal}
      ref={popupRootRef}
      style={{ top: `${position.y}px`, left: `${position.x}px` }}
    >
      {isOpen ? (
        <aside
          aria-labelledby={titleId}
          aria-modal="false"
          className="surface-popover-solid guided-edits-panel-enter pointer-events-auto flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--radius-panel) border border-(--guided-edits-panel-border) bg-(--guided-edits-panel-bg) shadow-(--guided-edits-panel-shadow)"
          data-resume-guided-edits-panel="true"
          id={panelId}
          ref={panelRef}
          role="dialog"
          style={{
            width: `${panelDimensions.expandedWidth}px`,
            height: `${panelDimensions.expandedHeight}px`,
            maxWidth: `calc(100vw - ${viewportInset * 2}px)`,
            maxHeight: `calc(100vh - ${safeTopOffset + effectiveBottomOffset}px)`,
          }}
        >
          <ResumeAssistantPanel
            assistantMessages={props.assistantMessages}
            assistantPending={props.assistantPending}
            composerId={composerId}
            draft={props.draft ?? null}
            headerActions={minimizeButton}
            headerLeading={
              <GripHorizontal
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            }
            headerProps={{
              "aria-label": "Drag the Assistant",
              className:
                "cursor-grab touch-none select-none active:cursor-grabbing",
              onPointerCancel: cancelDrag,
              onPointerDown: beginDrag,
              onPointerMove: updateDrag,
              onPointerUp: finishDrag,
            }}
            isWorkspacePending={props.isWorkspacePending}
            {...panelCallbacks}
            onSendAssistantMessage={props.onSendAssistantMessage}
            titleId={titleId}
            transcriptViewportRef={transcriptViewportRef}
            validation={props.validation ?? null}
          />
        </aside>
      ) : null}
    </div>,
    document.body,
  );
}
