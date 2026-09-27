import { GripHorizontal, MessageSquare, Minus } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  JobFinderWorkspaceSnapshot,
  ProfileCopilotContext,
} from "@unemployed/contracts";
import { Button } from "@renderer/components/ui/button";
import { getProfileCopilotContextKey } from "../../lib/profile-copilot-context";
import { isImeComposingEvent } from "../../lib/job-finder-shortcuts";
import {
  useHasOpenJobFinderModal,
  useJobFinderOverlayOwnership,
} from "../../lib/job-finder-overlay-ownership";
import { getProfileCopilotContextLabel } from "./profile-copilot-rail.shared";
import {
  COPILOT_BOTTOM_OFFSET,
  COPILOT_POSITION_STORAGE_KEY,
  clampCopilotPosition,
  getDefaultCopilotPosition,
  getDraggedCopilotPosition,
  getCopilotOpenPanelMaxWidth,
  getCopilotReservedColumnWidth,
  getCopilotPanelDimensions,
  getCopilotViewportInset,
  getProfileCopilotSafeTopOffset,
  resizeCopilotPosition,
  classifyCopilotFocusTarget,
  shouldYieldCollapsedLauncher,
  type CopilotFocusKind,
  type CopilotPanelSizeLimits,
} from "./profile-copilot-rail-layout";
import {
  ProfileCopilotCollapsedBubble,
  ProfileCopilotComposer,
  type ProfileCopilotFailedRequest,
  ProfileCopilotTranscript,
} from "./profile-copilot-rail-sections";

const COPILOT_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD = 96;

const PROFILE_COPILOT_PANEL_SIZE_LIMITS: CopilotPanelSizeLimits = {
  maxHeight: 460,
  maxWidth: 360,
};

function getProfileCopilotPanelSizeLimits(
  contentColumnRight: number | null,
): CopilotPanelSizeLimits {
  if (typeof window === "undefined") {
    return PROFILE_COPILOT_PANEL_SIZE_LIMITS;
  }

  if (window.innerWidth < 640) {
    return {
      maxHeight: 460,
      maxWidth: Math.max(0, window.innerWidth - 24),
    };
  }

  // The open panel is sized to the space beside the edited column so it
  // stops covering the fields it names.
  return {
    maxHeight: PROFILE_COPILOT_PANEL_SIZE_LIMITS.maxHeight,
    maxWidth: getCopilotOpenPanelMaxWidth({
      contentColumnRight,
      maxWidth: PROFILE_COPILOT_PANEL_SIZE_LIMITS.maxWidth,
      viewportWidth: window.innerWidth,
    }),
  };
}

function isTranscriptNearBottom(transcript: HTMLElement): boolean {
  return (
    transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <=
    COPILOT_TRANSCRIPT_NEAR_BOTTOM_THRESHOLD
  );
}

/**
 * The Profile save footer, which hosts the collapsed launcher.
 *
 * Resolved from the DOM (and re-resolved as sections mount and unmount)
 * because the footer belongs to the screen, not to this component's parent.
 */
function useProfileLauncherContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const resolve = () => {
      // The save footer's own action row, so the launcher lands beside Save
      // rather than below it. Guided-setup footers carry the workspace-actions
      // marker without that slot, and fall back to the footer itself.
      const next =
        document.querySelector<HTMLElement>(
          "[data-profile-assistant-launcher-slot]",
        ) ??
        document.querySelector<HTMLElement>("[data-profile-workspace-actions]");
      setContainer((current) => (current === next ? current : next));
    };

    resolve();

    if (typeof MutationObserver === "undefined") {
      return undefined;
    }

    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return container;
}

export function ProfileCopilotRail(props: {
  busy: boolean;
  actionsDisabledReason?: string | null;
  context: ProfileCopilotContext;
  emptyStateDescription: string;
  emptyStateTitle: string;
  messages: readonly JobFinderWorkspaceSnapshot["profileCopilotMessages"][number][];
  onApplyPatchGroup: (patchGroupId: string) => void;
  onRejectPatchGroup: (patchGroupId: string) => void;
  onSendMessage: (
    content: string,
    context: ProfileCopilotContext,
  ) => void | Promise<boolean>;
  onUndoRevision: (revisionId: string) => void;
  pendingContextKey: string | null;
  placeholder: string;
  revisions: readonly JobFinderWorkspaceSnapshot["profileRevisions"][number][];
  sendDisabledReason?: string | null;
  starterQuestion?: string | null;
  suggestedPrompts?: readonly string[];
  showProactivePrompt?: boolean;
  minBottomOffset?: number;
  collapsedMinBottomOffset?: number;
  /**
   * Sticky-footer slot that owns the collapsed launcher. When a screen has a
   * persistent action row (guided setup steps, the Profile save footer) the
   * launcher docks there instead of floating over the content column, so it
   * can never sit on a field the user is typing in or on a button label.
   * Without a slot the launcher falls back to the floating bottom-right pill.
   */
  launcherContainer?: HTMLElement | null;
  /**
   * Reports how much width the edited column must give up while the panel is
   * open. Sizing the panel into the free space is not enough on a window that
   * leaves none: the screen reserves the room so the panel docks beside the
   * fields instead of over them.
   */
  onReserveColumnWidth?: (width: number) => void;
  title?: string;
}) {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [showProactivePrompt, setShowProactivePrompt] = useState(true);
  const [failedRequest, setFailedRequest] =
    useState<ProfileCopilotFailedRequest | null>(null);
  const [safeTopOffset, setSafeTopOffset] = useState(240);
  // The save footer, resolved from the DOM: the screen that renders the footer
  // is not this component's parent, and the same marker already names that row
  // everywhere else in the app.
  const profileActionsContainer = useProfileLauncherContainer();
  // The height of the screen's sticky action row, re-queried on the same pass
  // as the safe top offset. The open panel floats above the page, so its
  // clearance from the bottom of the window has to clear that row: with a
  // fixed clearance the panel sat on "Save changes" and "Finish setup and find
  // jobs", and a person had to minimize the Assistant to press the button it
  // had just told them to press.
  const [profileActionRowHeight, setProfileActionRowHeight] = useState(0);
  // Right edge of the column the person is editing. The open panel is sized
  // against it so it never lands on a field it is talking about.
  const [contentColumnRight, setContentColumnRight] = useState<number | null>(
    null,
  );
  const [focusKind, setFocusKind] = useState<CopilotFocusKind>("none");
  const [position, setPosition] = useState(() => getDefaultCopilotPosition());
  const inputRef = useRef("");
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<{
    contextKey: string;
    id: number;
  } | null>(null);
  const collapsedPositionRef = useRef(position);
  const viewportRef = useRef({
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    width: typeof window === "undefined" ? 0 : window.innerWidth,
  });
  const composerId = useId();
  const dialogTitleId = `${composerId}-title`;
  const railRootRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const wasPendingHereRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptNearBottomRef = useRef(true);
  const transcriptScrollTopRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
    moved: boolean;
    isOpen: boolean;
  } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextBubbleClickRef = useRef(false);
  const panelSizeLimits = getProfileCopilotPanelSizeLimits(contentColumnRight);
  const onReserveColumnWidth = props.onReserveColumnWidth;
  useEffect(() => {
    if (!onReserveColumnWidth) {
      return undefined;
    }

    onReserveColumnWidth(
      getCopilotReservedColumnWidth({
        contentColumnRight,
        isOpen,
        maxWidth: PROFILE_COPILOT_PANEL_SIZE_LIMITS.maxWidth,
        viewportWidth: typeof window === "undefined" ? 0 : window.innerWidth,
      }),
    );

    // Give the reservation back when the rail unmounts, or the column keeps a
    // gutter for a panel that is no longer on screen.
    return () => {
      onReserveColumnWidth(0);
    };
  }, [contentColumnRight, isOpen, onReserveColumnWidth]);
  // The floating copilot dialog joins the app-wide LIFO overlay stack so
  // stacked surfaces close one per Escape and shell aliases stay blocked.
  const { isTopmost: isCopilotTopmost } = useJobFinderOverlayOwnership({
    active: isOpen,
    close: () => {
      dragStateRef.current = null;
      dragCleanupRef.current?.();
      setPosition(
        clampCopilotPosition({
          ...collapsedPositionRef.current,
          isOpen: false,
          minBottomOffset: collapsedMinBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits,
        }),
      );
      setIsOpen(false);
    },
  });
  const contextKey = getProfileCopilotContextKey(props.context);
  inputRef.current = input;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const isPendingHere = props.pendingContextKey === contextKey;
  const hasPendingReview = props.messages.some((message) =>
    message.patchGroups.some(
      (patchGroup) => patchGroup.applyMode === "needs_review",
    ),
  );
  const lastMessage = props.messages[props.messages.length - 1];
  const transcriptTailKey = lastMessage
    ? [
        props.messages.length,
        lastMessage.id,
        lastMessage.role,
        lastMessage.content.length,
        lastMessage.patchGroups
          .map((patchGroup) => `${patchGroup.id}:${patchGroup.applyMode}`)
          .join(","),
      ].join(":")
    : "empty";
  const showsProactiveSuggestion =
    props.showProactivePrompt !== false &&
    !isOpen &&
    showProactivePrompt &&
    props.messages.length === 0 &&
    Boolean(props.starterQuestion);
  const viewportInset =
    typeof window === "undefined"
      ? COPILOT_BOTTOM_OFFSET
      : getCopilotViewportInset(window.innerWidth);
  // The collapsed launcher is an ordinary control in the Profile save footer,
  // not a floating pill. It used to hover over the page and lift itself off
  // whichever rows its clearance set named — which is how it ended up on a
  // section's own `Add experience` button at short heights. A docked launcher
  // cannot cover anything, so there is no clearance to compute and nothing to
  // arbitrate against the toasts that share the corner.
  const resolvedLauncherContainer =
    props.launcherContainer === undefined
      ? profileActionsContainer
      : props.launcherContainer;
  // The open panel must clear the screen's sticky action row, not just the
  // window edge, so Save/Finish and the buttons the Assistant names stay
  // reachable while it is open.
  const workspaceActionClearance =
    COPILOT_BOTTOM_OFFSET + profileActionRowHeight;
  const minBottomOffset = Math.max(
    props.minBottomOffset ?? COPILOT_BOTTOM_OFFSET,
    workspaceActionClearance,
  );
  const collapsedMinBottomOffset = Math.max(
    props.collapsedMinBottomOffset ?? COPILOT_BOTTOM_OFFSET,
    workspaceActionClearance,
  );
  const panelDimensions = getCopilotPanelDimensions(
    safeTopOffset,
    minBottomOffset,
    panelSizeLimits,
  );
  const collapsedPreviewTitle = isPendingHere
    ? "Working on your last request"
    : hasPendingReview
      ? "Review change"
      : props.messages.length > 0
        ? "Continue this thread"
        : props.starterQuestion
          ? "Top missing detail"
          : "Message the Assistant";
  const suggestedPrompts = useMemo(
    () =>
      Array.from(
        new Set([
          ...(props.starterQuestion ? [props.starterQuestion] : []),
          ...(props.suggestedPrompts ?? []),
        ]),
      ).slice(0, 2),
    [props.starterQuestion, props.suggestedPrompts],
  );
  const visibleSuggestedPrompts = useMemo(() => {
    const currentInput = input.trim();
    if (!currentInput) {
      return suggestedPrompts;
    }

    return suggestedPrompts.filter((prompt) => prompt.trim() !== currentInput);
  }, [input, suggestedPrompts]);
  const yieldsToFocusedField = shouldYieldCollapsedLauncher({
    focusKind,
    isOpen,
    isPendingHere,
  });
  // A window-owning dialog must be the only actionable surface. This rail
  // portals to `document.body`, so the modal's `#root` inertness cannot reach
  // it; it drops under the scrim and turns itself off instead.
  const isCoveredByModal = useHasOpenJobFinderModal();
  const launcherContainer = resolvedLauncherContainer ?? null;
  const isLauncherDocked = !isOpen && launcherContainer !== null;

  // Track what owns focus so the collapsed launcher can step aside while a
  // field is being edited instead of covering the text the user just typed.
  useEffect(() => {
    let settleTimer: number | undefined;
    const readFocus = () => {
      setFocusKind(classifyCopilotFocusTarget(document.activeElement));
    };
    const handleFocusIn = () => {
      readFocus();
    };
    const handleFocusOut = () => {
      // `focusout` fires before the next element receives focus.
      settleTimer = window.setTimeout(readFocus, 0);
    };

    readFocus();
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
      }

      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  useLayoutEffect(() => {
    const shellHeader = document.querySelector<HTMLElement>(
      "[data-job-finder-shell-header]",
    );

    if (!shellHeader) {
      return;
    }

    const getProfileTabs = () =>
      document.querySelector<HTMLElement>("[data-profile-section-tabs]");
    const getProfileActionRow = () =>
      document.querySelector<HTMLElement>("[data-profile-workspace-actions]");
    const updateSafeTopOffset = () => {
      setSafeTopOffset(
        getProfileCopilotSafeTopOffset({
          shellHeaderBottom: shellHeader.getBoundingClientRect().bottom,
          profileTabsBottom: getProfileTabs()?.getBoundingClientRect().bottom,
        }),
      );
      const actionRowRect = getProfileActionRow()?.getBoundingClientRect();
      setProfileActionRowHeight(Math.round(actionRowRect?.height ?? 0));
      // The save/action row spans the edited column, so its right edge is the
      // column's right edge without a marker of its own.
      setContentColumnRight(
        actionRowRect && actionRowRect.width > 0
          ? Math.round(actionRowRect.right)
          : null,
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateSafeTopOffset);

    // Capture on `document` fires for every scrollable element in the app, so
    // the measurement is coalesced into one animation frame instead of forcing
    // a synchronous layout read per scroll event. The listener is passive: it
    // only measures and never cancels the scroll.
    let scrollFrame: number | undefined;
    const handleScroll = () => {
      if (typeof window.requestAnimationFrame !== "function") {
        updateSafeTopOffset();
        return;
      }

      if (scrollFrame !== undefined) {
        return;
      }

      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = undefined;
        updateSafeTopOffset();
      });
    };

    updateSafeTopOffset();
    observer?.observe(shellHeader);
    const profileTabs = getProfileTabs();
    if (profileTabs) {
      observer?.observe(profileTabs);
    }
    const profileActionRow = getProfileActionRow();
    if (profileActionRow) {
      observer?.observe(profileActionRow);
    }
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", updateSafeTopOffset);

    return () => {
      observer?.disconnect();
      if (scrollFrame !== undefined) {
        window.cancelAnimationFrame(scrollFrame);
      }
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updateSafeTopOffset);
    };
  }, [contextKey]);

  useEffect(() => {
    const wasPendingHere = wasPendingHereRef.current;
    wasPendingHereRef.current = isPendingHere;

    if (isPendingHere && !wasPendingHere) {
      if (!isOpen) {
        collapsedPositionRef.current = position;
      }
      setIsOpen(true);
    }
  }, [isOpen, isPendingHere, position]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      document.getElementById(composerId)?.focus();
      return;
    }

    if (!isOpen && wasOpen) {
      railRootRef.current
        ?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.focus();
    }
  }, [composerId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closePanelFromKeyboard = () => {
      dragStateRef.current = null;
      dragCleanupRef.current?.();
      setPosition(
        clampCopilotPosition({
          ...collapsedPositionRef.current,
          isOpen: false,
          minBottomOffset: collapsedMinBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits,
        }),
      );
      setIsOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // Surfaces opened above the copilot keep first claim on Escape.
      if (event.defaultPrevented || isImeComposingEvent(event)) {
        return;
      }
      if (event.key !== "Escape" || !isCopilotTopmost()) {
        return;
      }

      event.preventDefault();
      closePanelFromKeyboard();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsedMinBottomOffset, isCopilotTopmost, isOpen, safeTopOffset]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.removeItem(COPILOT_POSITION_STORAGE_KEY);
    } catch {
      // The launcher is safely docked even when local storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      const previousViewport = viewportRef.current;
      const nextViewport = {
        height: window.innerHeight,
        width: window.innerWidth,
      };
      viewportRef.current = nextViewport;
      setPosition((current) => {
        const nextPosition = resizeCopilotPosition({
          isOpen,
          minBottomOffset: isOpen ? minBottomOffset : collapsedMinBottomOffset,
          minTopOffset: safeTopOffset,
          nextViewport,
          panelSizeLimits,
          position: current,
          previousViewport,
        });

        if (!isOpen) {
          collapsedPositionRef.current = nextPosition;
        }
        return nextPosition;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [
    collapsedMinBottomOffset,
    isOpen,
    minBottomOffset,
    panelSizeLimits.maxHeight,
    panelSizeLimits.maxWidth,
    safeTopOffset,
  ]);

  useLayoutEffect(() => {
    setPosition((current) => {
      const nextPosition = clampCopilotPosition({
        x: current.x,
        y: current.y,
        isOpen,
        minBottomOffset: isOpen ? minBottomOffset : collapsedMinBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits,
      });

      if (!isOpen) {
        collapsedPositionRef.current = nextPosition;
      }
      return nextPosition;
    });
  }, [
    collapsedMinBottomOffset,
    isOpen,
    minBottomOffset,
    panelSizeLimits.maxHeight,
    panelSizeLimits.maxWidth,
    safeTopOffset,
  ]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    // The viewport is unmounted while the rail is minimized. Restore the
    // position captured before unmounting before measuring it again. In
    // particular, a fresh viewport starts at scrollTop=0 even when the user
    // was at the bottom, so recomputing first would lose the follow decision.
    if (transcriptNearBottomRef.current) {
      transcript.scrollTop = transcript.scrollHeight;
    } else {
      transcript.scrollTop = transcriptScrollTopRef.current;
    }

    const updateTranscriptScrollState = () => {
      transcriptScrollTopRef.current = transcript.scrollTop;
      transcriptNearBottomRef.current = isTranscriptNearBottom(transcript);
    };

    updateTranscriptScrollState();
    transcript.addEventListener("scroll", updateTranscriptScrollState);

    return () => {
      transcript.removeEventListener("scroll", updateTranscriptScrollState);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      return;
    }

    if (props.messages.length === 0 && !isPendingHere) {
      transcript.scrollTop = 0;
      transcriptScrollTopRef.current = 0;
      transcriptNearBottomRef.current = true;
      return;
    }

    // Follow only from the position captured before the new tail rendered.
    // Measuring after a proposal is inserted includes its height and makes a
    // formerly-bottomed transcript look scrolled upward.
    if (transcriptNearBottomRef.current) {
      transcript.scrollTop = transcript.scrollHeight;
      transcriptScrollTopRef.current = transcript.scrollTop;
    }
  }, [
    contextKey,
    isOpen,
    isPendingHere,
    props.messages.length,
    transcriptTailKey,
  ]);

  function setComposerInput(value: string) {
    inputRef.current = value;
    setInput(value);
  }

  function submitMessage(
    content: string,
    requestContext: ProfileCopilotContext = props.context,
  ) {
    const nextInput = content.trim();

    if (
      props.busy ||
      isPendingHere ||
      nextInput.length === 0 ||
      props.sendDisabledReason
    ) {
      return;
    }

    setFailedRequest(null);
    setComposerInput("");
    setIsOpen(true);
    const request = {
      contextKey: getProfileCopilotContextKey(requestContext),
      id: requestSequenceRef.current + 1,
    };
    requestSequenceRef.current = request.id;
    activeRequestRef.current = request;

    const isCurrentRequest = () =>
      activeRequestRef.current?.id === request.id &&
      contextKeyRef.current === request.contextKey;

    const restoreFailedRequest = (message: string) => {
      if (!isCurrentRequest()) {
        return;
      }

      activeRequestRef.current = null;
      if (inputRef.current === "") {
        setComposerInput(nextInput);
      }
      setFailedRequest({
        content: nextInput,
        context: requestContext,
        message,
      });
    };

    let result: void | Promise<boolean>;
    try {
      result = props.onSendMessage(nextInput, requestContext);
    } catch (error) {
      restoreFailedRequest(
        error instanceof Error
          ? error.message
          : "The Assistant could not send that request.",
      );
      return;
    }

    if (result && typeof result.then === "function") {
      void result
        .then((succeeded) => {
          if (succeeded === false) {
            restoreFailedRequest(
              "The Assistant could not complete that request.",
            );
            return;
          }

          if (isCurrentRequest()) {
            activeRequestRef.current = null;
          }
        })
        .catch((error: unknown) => {
          restoreFailedRequest(
            error instanceof Error
              ? error.message
              : "The Assistant could not send that request.",
          );
        });
      return;
    }

    activeRequestRef.current = null;
  }

  function handleSend() {
    submitMessage(input);
  }

  function handleInputChange(value: string) {
    setComposerInput(value);
    if (failedRequest && value !== failedRequest.content) {
      setFailedRequest(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      isImeComposingEvent(event.nativeEvent) ||
      event.nativeEvent.keyCode === 229 ||
      props.busy
    ) {
      return;
    }

    event.preventDefault();
    handleSend();
  }

  function handleOpen(prefill?: string) {
    if (prefill && input.trim().length === 0) {
      setComposerInput(prefill);
    }

    if (!isOpen) {
      collapsedPositionRef.current = position;
    }
    setIsOpen(true);
  }

  function handleRetryFailedRequest() {
    if (!failedRequest) {
      return;
    }

    submitMessage(failedRequest.content, failedRequest.context);
  }

  function toggleOpen() {
    if (isOpen) {
      setPosition(
        clampCopilotPosition({
          ...collapsedPositionRef.current,
          isOpen: false,
          minBottomOffset: collapsedMinBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits,
        }),
      );
      setIsOpen(false);
      return;
    }

    collapsedPositionRef.current = position;
    setIsOpen(true);
  }

  function toggleOpenFromBubble() {
    if (isOpen) {
      toggleOpen();
      return;
    }

    handleOpen(
      props.messages.length === 0
        ? (props.starterQuestion ?? undefined)
        : undefined,
    );
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    draggingOpen: boolean,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const renderedBounds = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startX: draggingOpen ? position.x : renderedBounds.left,
      startY: draggingOpen ? position.y : renderedBounds.top,
      moved: false,
      isOpen: draggingOpen,
    };

    dragCleanupRef.current?.();

    const handleWindowPointerMove = (pointerEvent: PointerEvent) => {
      updateDrag(
        pointerEvent.pointerId,
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
    };
    const handleWindowPointerUp = (pointerEvent: PointerEvent) => {
      finishDrag(
        pointerEvent.pointerId,
        pointerEvent.clientX,
        pointerEvent.clientY,
      );
    };
    const handleWindowPointerCancel = (pointerEvent: PointerEvent) => {
      cancelDrag(pointerEvent.pointerId);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove, true);
      window.removeEventListener("pointerup", handleWindowPointerUp, true);
      window.removeEventListener(
        "pointercancel",
        handleWindowPointerCancel,
        true,
      );
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
  }

  function updateDrag(pointerId: number, clientX: number, clientY: number) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    const dragResult = getDraggedCopilotPosition({
      clientX,
      clientY,
      originX: dragState.originX,
      originY: dragState.originY,
      startX: dragState.startX,
      startY: dragState.startY,
    });

    if (!dragState.moved && !dragResult.moved) {
      return;
    }

    dragState.moved = true;
    setPosition(
      clampCopilotPosition({
        x: dragResult.position.x,
        y: dragResult.position.y,
        isOpen: dragState.isOpen,
        minBottomOffset: dragState.isOpen
          ? minBottomOffset
          : collapsedMinBottomOffset,
        minTopOffset: safeTopOffset,
        panelSizeLimits,
      }),
    );
  }

  function finishDrag(pointerId: number, clientX: number, clientY: number) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    const dragResult = getDraggedCopilotPosition({
      clientX,
      clientY,
      originX: dragState.originX,
      originY: dragState.originY,
      startX: dragState.startX,
      startY: dragState.startY,
    });

    if (dragResult.moved) {
      dragState.moved = true;
      setPosition(
        clampCopilotPosition({
          x: dragResult.position.x,
          y: dragResult.position.y,
          isOpen: dragState.isOpen,
          minBottomOffset: dragState.isOpen
            ? minBottomOffset
            : collapsedMinBottomOffset,
          minTopOffset: safeTopOffset,
          panelSizeLimits,
        }),
      );
    }

    dragStateRef.current = null;
    dragCleanupRef.current?.();
    suppressBubbleClickAfterDrag(dragState.moved);
  }

  function cancelDrag(pointerId: number) {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    dragStateRef.current = null;
    dragCleanupRef.current?.();
    suppressBubbleClickAfterDrag(dragState.moved);
  }

  function suppressBubbleClickAfterDrag(moved: boolean) {
    suppressNextBubbleClickRef.current = moved;

    if (!moved) {
      return;
    }

    window.setTimeout(() => {
      suppressNextBubbleClickRef.current = false;
    }, 0);
  }

  function handleBubblePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    beginDrag(event, false);
  }

  function handlePanelPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;

    if (target.closest('button, textarea, input, a, [role="button"]')) {
      return;
    }

    beginDrag(event, true);
  }

  function handleBubblePointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    updateDrag(event.pointerId, event.clientX, event.clientY);
  }

  function handleBubblePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    finishDrag(event.pointerId, event.clientX, event.clientY);
  }

  function handleBubblePointerCancel(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    cancelDrag(event.pointerId);
  }

  function handleBubbleClick() {
    if (suppressNextBubbleClickRef.current) {
      suppressNextBubbleClickRef.current = false;
      return;
    }

    toggleOpenFromBubble();
  }

  const collapsedLauncher = !isOpen ? (
    <ProfileCopilotCollapsedBubble
      collapsedPreviewTitle={collapsedPreviewTitle}
      docked={isLauncherDocked}
      isDraggable={false}
      // Docked in a footer row the launcher is part of the layout, so it must
      // never fade out under a focused field — nothing is behind it to cover.
      yieldsToFocusedField={isLauncherDocked ? false : yieldsToFocusedField}
      isOpen={isOpen}
      isPendingHere={isPendingHere}
      messageCount={props.messages.length}
      onClick={handleBubbleClick}
      onPointerDown={handleBubblePointerDown}
      onPointerMove={handleBubblePointerMove}
      onPointerCancel={handleBubblePointerCancel}
      onPointerUp={handleBubblePointerUp}
      hasPendingReview={hasPendingReview}
      title={props.title}
    />
  ) : null;

  const suggestionPill = showsProactiveSuggestion ? (
    <div
      className={`flex min-w-0 max-w-[min(22.5rem,calc(100vw-1.5rem))] items-center gap-2 rounded-full border border-border/40 bg-card/95 p-1.5 pl-4 shadow-(--guided-edits-bubble-shadow) backdrop-blur transition-opacity duration-150 max-sm:hidden ${
        yieldsToFocusedField
          ? "pointer-events-none opacity-0"
          : "pointer-events-auto opacity-100"
      }`}
    >
      <button
        aria-label={`Use suggested prompt: ${props.starterQuestion}`}
        className="min-w-0 max-w-full flex-1 break-words whitespace-normal text-left text-xs leading-5 text-foreground-soft hover:text-foreground"
        onClick={() => handleOpen(props.starterQuestion ?? undefined)}
        type="button"
      >
        Suggested: {props.starterQuestion}
      </button>
      <button
        aria-label="Dismiss suggestion"
        className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        onClick={() => setShowProactivePrompt(false)}
        type="button"
      >
        Dismiss
      </button>
    </div>
  ) : null;

  return (
    <>
      {isLauncherDocked && collapsedLauncher
        ? createPortal(
            <div
              className="flex shrink-0 flex-wrap items-center gap-2"
              data-profile-copilot-launcher-dock="true"
            >
              {/* The suggestion pill is part of the launcher stack, so it docks
                  with it. Left in the floating layer it would be the one thing
                  still resting over the page while collapsed. */}
              {suggestionPill}
              {collapsedLauncher}
            </div>,
            launcherContainer,
          )
        : null}
      {createPortal(
        <div
          aria-hidden={isCoveredByModal ? "true" : undefined}
          className={[
            "pointer-events-none fixed flex min-w-0 max-w-[min(22.5rem,calc(100vw-1.5rem))] flex-col items-end gap-3",
            // Modal scrims own z-50; stepping to z-30 puts this panel behind
            // the scrim so an open dialog stays the only actionable surface.
            isCoveredByModal ? "z-30" : "z-[80]",
          ].join(" ")}
          data-profile-copilot-covered-by-modal={
            isCoveredByModal ? "true" : "false"
          }
          inert={isCoveredByModal}
          ref={railRootRef}
          style={
            !isOpen
              ? {
                  // Only reached when no save footer is mounted to dock into;
                  // the shared inset then places the fallback pill.
                  bottom: `${collapsedMinBottomOffset}px`,
                  right: `${viewportInset}px`,
                }
              : { left: `${position.x}px`, top: `${position.y}px` }
          }
        >
          {isOpen ? (
            <aside
              aria-labelledby={dialogTitleId}
              aria-modal="false"
              role="dialog"
              className="pointer-events-auto surface-popover-solid flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--radius-panel) border shadow-(--modal-shadow) backdrop-blur"
              data-profile-copilot-panel="true"
              style={{
                width: `${panelDimensions.expandedWidth}px`,
                height: `${panelDimensions.expandedHeight}px`,
                maxWidth: `calc(100vw - ${viewportInset * 2}px)`,
                maxHeight: `calc(100vh - ${safeTopOffset + minBottomOffset}px)`,
              }}
            >
              <header
                aria-label="Drag the Assistant"
                className="flex shrink-0 cursor-grab touch-none select-none items-center justify-between gap-3 border-b border-border/30 px-4 py-2.5 active:cursor-grabbing"
                onPointerDown={handlePanelPointerDown}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <GripHorizontal
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <div className="flex size-7 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                    <MessageSquare className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      className="truncate text-sm font-semibold text-foreground"
                      id={dialogTitleId}
                    >
                      {props.title ?? "Assistant"}
                    </h2>
                    <p className="truncate text-(length:--text-tiny) text-muted-foreground">
                      {getProfileCopilotContextLabel(props.context)}
                    </p>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    aria-label="Minimize the Assistant"
                    onClick={toggleOpen}
                    size="icon-xs"
                    title="Minimize the Assistant"
                    type="button"
                    variant="ghost"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                </div>
              </header>

              <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                data-profile-copilot-content="true"
              >
                <ProfileCopilotTranscript
                  actionsDisabledReason={props.actionsDisabledReason}
                  busy={props.busy}
                  context={props.context}
                  emptyStateDescription={props.emptyStateDescription}
                  emptyStateTitle={props.emptyStateTitle}
                  failedRequest={failedRequest}
                  isPendingHere={isPendingHere}
                  messages={props.messages}
                  onApplyPatchGroup={props.onApplyPatchGroup}
                  onRejectPatchGroup={props.onRejectPatchGroup}
                  onAskAgain={(content, context) =>
                    submitMessage(content, context)
                  }
                  onRetryFailedRequest={handleRetryFailedRequest}
                  onUndoRevision={props.onUndoRevision}
                  onUsePrompt={handleInputChange}
                  suggestedPrompts={visibleSuggestedPrompts}
                  transcriptRef={transcriptRef}
                  revisions={props.revisions}
                />

                <div
                  className="shrink-0 border-t border-(--surface-panel-border) bg-(--surface-fill-soft) p-2.5"
                  data-profile-copilot-composer-footer="true"
                >
                  <ProfileCopilotComposer
                    busy={props.busy}
                    composerId={composerId}
                    input={input}
                    isPendingHere={isPendingHere}
                    onInputChange={handleInputChange}
                    onKeyDown={handleComposerKeyDown}
                    onSend={handleSend}
                    placeholder="Message the Assistant…"
                    sendDisabledReason={props.sendDisabledReason}
                  />
                </div>
              </div>
            </aside>
          ) : null}

          {isLauncherDocked ? null : suggestionPill}

          {isLauncherDocked ? null : collapsedLauncher}
        </div>,
        document.body,
      )}
    </>
  );
}
