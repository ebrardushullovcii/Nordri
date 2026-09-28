import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { JOB_FINDER_ROUTE_PATHS } from "../../lib/job-finder-route-hrefs";

const PROFILE_READY_BANNER_DISMISSED_KEY =
  "nordri.profile-ready-banner-dismissed-v1";

function getReadyBannerDismissedKey(completionIdentity: string): string {
  return `${PROFILE_READY_BANNER_DISMISSED_KEY}:${encodeURIComponent(completionIdentity)}`;
}

function readReadyBannerDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function ProfileReadyBanner(props: { completionIdentity: string }) {
  const dismissedKey = getReadyBannerDismissedKey(props.completionIdentity);
  const [dismissedIdentity, setDismissedIdentity] = useState<string | null>(
    () =>
      readReadyBannerDismissed(dismissedKey) ? props.completionIdentity : null,
  );

  if (dismissedIdentity === props.completionIdentity) return null;

  function dismissBanner() {
    setDismissedIdentity(props.completionIdentity);
    try {
      localStorage.setItem(dismissedKey, "1");
    } catch {
      // Keep the in-memory dismissal when persistent storage is unavailable.
    }
  }

  return (
    // F81/F17: this was a 110-116px permanent block on a finished profile, with
    // the dismissive action stacked ABOVE the real one. It is now one compact
    // row, the primary reads first, and Dismiss is a plain text control at the
    // end of the line - so the section tabs and the first editable field are
    // still on the first viewport at 1024x720.
    <div className="surface-card-tint flex flex-col gap-2 rounded-(--radius-panel) border border-primary/40 bg-primary/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="min-w-0 text-(length:--text-body) leading-6 text-foreground-soft">
        <span className="font-semibold text-foreground">
          Core setup is ready.
        </span>{" "}
        Optional details can stay empty.
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Button asChild size="compact">
          <Link to={JOB_FINDER_ROUTE_PATHS.discovery}>
            Continue to Find jobs
          </Link>
        </Button>
        <Button
          aria-label="Dismiss core setup ready message"
          onClick={dismissBanner}
          size="compact"
          type="button"
          variant="link"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
