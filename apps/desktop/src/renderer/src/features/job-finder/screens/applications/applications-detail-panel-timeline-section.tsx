import type { ApplicationRecord } from "@nordri/contracts";
import { cn } from "@renderer/lib/utils";
import {
  formatTimestamp,
  getEventTone,
} from "@renderer/features/job-finder/lib/job-finder-utils";
import { getCustomerFacingApplyText } from "./applications-detail-panel-helpers";

export function ApplicationsDetailPanelTimelineSection(props: {
  events: ApplicationRecord["events"];
}) {
  // Older records sometimes appended the same site confirmation twice.
  // Show that outcome once while preserving the stored history.
  const seen = new Set<string>();
  const events = [...props.events]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .filter((event) => {
      if (event.emphasis !== "positive") return true;
      const key = (getCustomerFacingApplyText(event.detail) ?? "").trim();
      if (
        !key.startsWith("The site confirmed receipt") &&
        key !== "Submission confirmed."
      )
        return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!events.length) {
    return null;
  }

  return (
    <details className="group min-w-0">
      <summary className="cursor-pointer list-none text-(length:--text-small) font-semibold text-primary outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-ring">
        Activity history ({events.length})
      </summary>
      <div className="mt-2 grid gap-0">
        {[...events]
          .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
          .map((event) => {
            const tone = getEventTone(event);

            return (
              <article
                key={event.id}
                className="relative grid gap-3 border-l border-border/20 pl-8 pb-8 sm:grid-cols-[1fr]"
              >
                <div
                  className={cn(
                    "absolute -left-1.25 top-1 h-2.5 w-2.5",
                    tone === "positive"
                      ? "bg-positive"
                      : tone === "active"
                        ? "bg-primary"
                        : tone === "critical"
                          ? "bg-destructive"
                          : "border border-border bg-background",
                  )}
                />
                <div>
                  <div className="label-mono-xs">
                    {formatTimestamp(event.at)}
                  </div>
                  <strong
                    className={cn(
                      "mt-1 block text-sm font-medium",
                      tone === "positive"
                        ? "text-positive"
                        : tone === "active"
                          ? "text-primary"
                          : tone === "critical"
                            ? "text-destructive"
                            : "text-foreground",
                    )}
                  >
                    {getCustomerFacingApplyText(event.title)}
                  </strong>
                  <p className="mt-2 text-(length:--text-description) leading-relaxed text-foreground-soft">
                    {getCustomerFacingApplyText(event.detail)}
                  </p>
                </div>
              </article>
            );
          })}
      </div>
    </details>
  );
}
