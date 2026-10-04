import * as React from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@renderer/lib/utils";

import { Button } from "./button";

/**
 * Toasts report something that just happened and needs nothing from the
 * person: a finished search, a saved change, an applied edit. They arrive
 * at the bottom left of the content, where screens keep lists and status
 * text rather than their main actions, stay six seconds (longer while the
 * pointer or focus is on them), and offer at most one action. Anything that needs the
 * person - a failure with a retry, a hold, a decision - stays inline next to
 * the control it concerns and never lives only in a toast (ADR 0042).
 */
export interface ToastInput {
  /** Replaces a visible toast with the same id instead of stacking. */
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly tone?: "neutral" | "success";
  readonly action?: { readonly label: string; readonly onClick: () => void };
  /** Milliseconds before it leaves on its own. */
  readonly duration?: number;
}

interface ToastEntry extends ToastInput {
  readonly key: string;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATION_MS = 6000;
const MAX_VISIBLE = 3;

const noop = () => undefined;
const ToastContext = React.createContext<ToastContextValue>({
  showToast: noop,
  dismissToast: noop,
});

/** No-op outside a provider, so a screen rendered on its own still works. */
export function useToast(): ToastContextValue {
  return React.useContext(ToastContext);
}

let toastSequence = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<readonly ToastEntry[]>([]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((current) =>
      current.filter((toast) => toast.key !== id && toast.id !== id),
    );
  }, []);

  const showToast = React.useCallback((toast: ToastInput) => {
    toastSequence += 1;
    const key = `toast-${toastSequence}`;
    setToasts((current) =>
      [
        { ...toast, key },
        ...current.filter((entry) => !toast.id || entry.id !== toast.id),
      ].slice(0, MAX_VISIBLE),
    );
  }, []);

  const value = React.useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <section
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-4 left-4 z-[130] flex w-[min(22.5rem,calc(100vw-2rem))] flex-col-reverse gap-2 min-[1440px]:left-[calc(var(--job-finder-side-width)+1rem)]"
          data-toast-viewport
        >
          {toasts.map((toast) => (
            <ToastCard
              key={toast.key}
              onDismiss={() => dismissToast(toast.key)}
              toast={toast}
            />
          ))}
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({
  onDismiss,
  toast,
}: {
  onDismiss: () => void;
  toast: ToastEntry;
}) {
  const [held, setHeld] = React.useState(false);
  const duration = toast.duration ?? DEFAULT_DURATION_MS;
  // The provider hands a fresh closure on every render; the timer must not
  // restart each time another toast arrives.
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;

  React.useEffect(() => {
    if (held) return undefined;
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, held]);

  const Icon = toast.tone === "success" ? CheckCircle2 : Info;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-auto flex items-start gap-3 rounded-(--radius-panel) border border-(--surface-panel-border) bg-popover py-3 pl-3.5 pr-2 text-popover-foreground shadow-(--select-shadow) animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
      data-toast
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHeld(false);
        }
      }}
      onFocus={() => setHeld(true)}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      role="status"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0",
          toast.tone === "success"
            ? "text-(--success-text)"
            : "text-muted-foreground",
        )}
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-(length:--text-small) font-medium leading-5 text-foreground">
          {toast.title}
        </p>
        {toast.description ? (
          <p className="text-(length:--text-description) leading-5 text-foreground-muted">
            {toast.description}
          </p>
        ) : null}
        {toast.action ? (
          <button
            className="mt-1 w-fit rounded-(--radius-small) text-(length:--text-small) font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            type="button"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <Button
        aria-label="Dismiss"
        className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        onClick={onDismiss}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
