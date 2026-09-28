import { useState } from "react";
import type { ProfileSetupState } from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";

const PROFILE_SETUP_REMINDER_DISMISSED_KEY =
  "nordri.profile-setup-reminder-dismissed-v1";

// Mirrors the friendly step language used on Home so the reminder never
// exposes raw setup step identifiers.
const PROFILE_SETUP_STEP_LABELS: Record<
  ProfileSetupState["currentStep"],
  string
> = {
  import: "resume import",
  essentials: "your basics",
  background: "your work history",
  targeting: "your job targets",
  extras: "the optional extras",
  // Retired step ids kept so a legacy stored value still reads as English.
  narrative: "the optional extras",
  answers: "the optional extras",
  ready_check: "your job targets",
};

function readReminderDismissed(): boolean {
  try {
    return (
      window.sessionStorage.getItem(PROFILE_SETUP_REMINDER_DISMISSED_KEY) ===
      "1"
    );
  } catch {
    return false;
  }
}

export function ProfileSetupReminder(props: {
  currentStep: ProfileSetupState["currentStep"];
  isResumePending: boolean;
  onResume: (step: ProfileSetupState["currentStep"]) => void;
  pendingItemCount: number;
}) {
  const [isDismissed, setIsDismissed] = useState(readReminderDismissed);

  if (isDismissed) {
    return null;
  }

  function dismissReminder() {
    setIsDismissed(true);
    try {
      window.sessionStorage.setItem(PROFILE_SETUP_REMINDER_DISMISSED_KEY, "1");
    } catch {
      // The in-memory dismissal still applies when storage is unavailable.
    }
  }

  return (
    <div className="surface-card-tint flex flex-col gap-3 rounded-(--radius-panel) border border-border/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid gap-1">
        <p className="text-(length:--text-tiny) uppercase tracking-[0.18em] text-muted-foreground">
          Setup still in progress
        </p>
        <p className="text-sm text-foreground-soft">
          {props.pendingItemCount > 0
            ? `${props.pendingItemCount} setup item${props.pendingItemCount === 1 ? "" : "s"} still need${props.pendingItemCount === 1 ? "s" : ""} review. Continue from ${PROFILE_SETUP_STEP_LABELS[props.currentStep]}.`
            : `Continue setup from ${PROFILE_SETUP_STEP_LABELS[props.currentStep]}.`}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          aria-label="Dismiss guided setup reminder for this session"
          className="text-sm font-medium tracking-normal normal-case"
          onClick={dismissReminder}
          size="sm"
          type="button"
          variant="ghost"
        >
          Not now
        </Button>
        <Button
          pending={props.isResumePending}
          onClick={() => props.onResume(props.currentStep)}
          type="button"
          variant="secondary"
        >
          Resume guided setup
        </Button>
      </div>
    </div>
  );
}
