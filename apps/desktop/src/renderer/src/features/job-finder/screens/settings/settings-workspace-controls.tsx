import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@renderer/components/ui/toast";
import { Button } from "@renderer/components/ui/button";
import {
  describeFailure,
  TECHNICAL_DETAILS_LABEL,
} from "../../lib/describe-failure";
import type { FailureDescription } from "../../lib/describe-failure";
import { useModalFocusTrap } from "../../components/profile/use-modal-focus-trap";

interface SettingsWorkspaceControlsProps {
  isWorkspaceResetPending: boolean;
  onResetWorkspace: () => void | Promise<boolean | void>;
}

export function SettingsWorkspaceControls({
  isWorkspaceResetPending,
  onResetWorkspace,
}: SettingsWorkspaceControlsProps) {
  const { showToast } = useToast();
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<FailureDescription | null>(null);
  const pending = resetPending || isWorkspaceResetPending;
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportWorkspace() {
    setExportPending(true);
    setExportError(null);
    try {
      const result = await window.nordri.jobFinder.exportPersonalWorkspace();
      if (result.status === "saved")
        showToast({
          title: "Workspace exported",
          description: `Saved to ${result.filePath}. Keep the file somewhere private.`,
        });
    } catch {
      setExportError(
        "Your workspace could not be exported. Nothing was deleted. Try again.",
      );
    } finally {
      setExportPending(false);
    }
  }
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalFocusTrap(showResetConfirmation, dialogRef, () => {
    if (!pending) {
      setShowResetConfirmation(false);
    }
  });

  async function confirmReset() {
    setResetPending(true);
    setResetError(null);
    try {
      const completed = await onResetWorkspace();
      if (completed === false)
        throw new Error("Reset did not finish. Try again.");
      setShowResetConfirmation(false);
    } catch (error) {
      setResetError(
        describeFailure(error, {
          action: "reset your workspace",
          unknownSentence:
            "Reset did not finish. Your workspace may still contain data. Restart Nordri and try again.",
        }),
      );
    } finally {
      setResetPending(false);
    }
  }

  return (
    <>
      <section className="surface-panel-shell relative grid gap-3.5 rounded-(--radius-field) border border-(--surface-panel-border) px-4 py-4">
        <div className="grid gap-1.5">
          <p className="text-[10px] uppercase tracking-(--tracking-badge) text-muted-foreground">
            Start over
          </p>
          <h2 className="font-display font-semibold text-(--text-headline)">
            Reset this device workspace
          </h2>
          <p className="text-sm leading-6 text-foreground-soft">
            Your workspace and resume stay on this device until you choose to
            reset them. Reset permanently removes your profile, imported resume,
            saved jobs, tailored resumes, application history, chats,
            app-managed exports, and browser session data from this device.
          </p>
        </div>
        <div className="grid justify-items-start gap-2">
          <p className="text-(length:--text-description) leading-5 text-foreground-soft">
            Export your personal workspace first to keep a copy of your profile,
            saved jobs, resumes, drafts, application history, answers and chats.
            Browser sign-ins and AI credentials are excluded.
          </p>
          <Button
            pending={exportPending}
            disabled={pending}
            onClick={() => void exportWorkspace()}
            type="button"
            variant="secondary"
          >
            Export personal workspace
          </Button>
          {exportError ? (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          ) : null}
          <Button
            disabled={exportPending || pending}
            variant="destructive"
            pending={pending}
            onClick={() => setShowResetConfirmation(true)}
            type="button"
          >
            Reset everything
          </Button>
        </div>
      </section>

      {showResetConfirmation
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-(--modal-scrim) px-4 py-6 backdrop-blur-sm"
              onClick={() => {
                if (!pending) {
                  setShowResetConfirmation(false);
                }
              }}
            >
              <div
                aria-describedby={dialogDescriptionId}
                aria-labelledby={dialogTitleId}
                aria-modal="true"
                className="surface-panel-shell grid w-full max-w-lg gap-5 rounded-(--radius-panel) border border-(--surface-panel-border) p-6 shadow-(--modal-shadow)"
                onClick={(event) => event.stopPropagation()}
                ref={dialogRef}
                role="dialog"
                tabIndex={-1}
              >
                <div className="grid gap-2">
                  <p className="text-(length:--text-tiny) uppercase tracking-(--tracking-label) text-destructive">
                    Permanent device reset
                  </p>
                  <h2
                    className="font-display font-semibold text-(--text-headline)"
                    id={dialogTitleId}
                  >
                    Reset this device workspace?
                  </h2>
                  <p
                    className="text-sm leading-6 text-foreground-soft"
                    id={dialogDescriptionId}
                  >
                    This permanently deletes your profile, imported resume,
                    saved jobs, tailored resumes, application history, chats,
                    app-managed exports, and browser session data from this
                    device. This cannot be undone.
                  </p>
                </div>
                {pending ? (
                  <p role="status">
                    Resetting workspace… Keep Nordri open until this finishes.
                  </p>
                ) : null}
                {resetError ? (
                  <div
                    role="alert"
                    className="grid gap-2 text-sm text-destructive"
                  >
                    <p>{resetError.userMessage}</p>
                    {resetError.technicalDetails ? (
                      <details>
                        <summary>{TECHNICAL_DETAILS_LABEL}</summary>
                        <pre className="whitespace-pre-wrap break-words text-xs">
                          {resetError.technicalDetails}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                {exportError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {exportError}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-3">
                  <Button
                    disabled={pending}
                    onClick={() => setShowResetConfirmation(false)}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    pending={exportPending}
                    disabled={pending}
                    onClick={() => void exportWorkspace()}
                    variant="secondary"
                  >
                    Export first
                  </Button>
                  <Button
                    disabled={exportPending || pending}
                    pending={pending}
                    onClick={() => void confirmReset()}
                    type="button"
                    variant="destructive"
                  >
                    Reset workspace
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
