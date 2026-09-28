import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@renderer/components/ui/button";
import { isImeComposingEvent } from "../job-finder/lib/job-finder-shortcuts";
import { useJobFinderOverlayOwnership } from "../job-finder/lib/job-finder-overlay-ownership";

interface InterviewDeleteSessionDialogProps {
  error: string | null;
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function InterviewDeleteSessionDialog(
  props: InterviewDeleteSessionDialogProps,
) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(props.onCancel);
  const pendingRef = useRef(props.pending);

  useEffect(() => {
    onCancelRef.current = props.onCancel;
    pendingRef.current = props.pending;
  }, [props.onCancel, props.pending]);

  // The delete confirmation joins the app-wide LIFO overlay stack so stacked
  // surfaces (global search, Task Center, screen modals) unwind one Escape at
  // a time and shell aliases stay blocked while it owns the surface.
  const { isTopmost } = useJobFinderOverlayOwnership({
    active: props.open,
    close: () => {
      if (!pendingRef.current) {
        onCancelRef.current();
      }
    },
  });

  useEffect(() => {
    if (!props.open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const appRoot = document.getElementById("root");
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const appRootWasInert = appRoot?.hasAttribute("inert") ?? false;

    appRoot?.setAttribute("aria-hidden", "true");
    appRoot?.setAttribute("inert", "");
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (
          event.defaultPrevented ||
          isImeComposingEvent(event) ||
          pendingRef.current ||
          !isTopmost()
        ) {
          return;
        }
        event.preventDefault();
        onCancelRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      if (appRoot) {
        if (previousAriaHidden === null) {
          appRoot.removeAttribute("aria-hidden");
        } else {
          appRoot.setAttribute("aria-hidden", previousAriaHidden);
        }

        if (appRootWasInert) {
          appRoot.setAttribute("inert", "");
        } else {
          appRoot.removeAttribute("inert");
        }
      }

      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isTopmost, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-(--modal-scrim) px-4 py-6 backdrop-blur-sm"
      onClick={() => {
        if (!props.pending) props.onCancel();
      }}
    >
      <div
        aria-describedby={
          props.error ? `${descriptionId} ${errorId}` : descriptionId
        }
        aria-labelledby={titleId}
        aria-modal="true"
        className="surface-panel-shell grid w-full max-w-lg gap-5 rounded-(--radius-panel) border border-(--surface-panel-border) p-6 shadow-(--modal-shadow)"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="grid gap-2">
          <p className="text-(length:--text-tiny) uppercase tracking-(--tracking-label) text-critical">
            Permanent deletion
          </p>
          <h2
            className="font-display font-semibold text-(--text-headline)"
            id={titleId}
          >
            Delete this interview session?
          </h2>
          <p
            className="text-sm leading-6 text-foreground-soft"
            id={descriptionId}
          >
            This permanently removes the retained transcript, cue cards, and
            session notes from this device. This cannot be undone.
          </p>
          {props.error ? (
            <p
              className="rounded-(--radius-small) border border-critical/35 bg-critical/10 px-3 py-2 text-sm leading-5 text-critical"
              id={errorId}
              role="alert"
            >
              {props.error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            disabled={props.pending}
            onClick={props.onCancel}
            ref={cancelButtonRef}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            onClick={props.onConfirm}
            pending={props.pending}
            type="button"
            variant="destructive"
          >
            Delete permanently
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
