import type { ReactNode } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { cn } from "@renderer/lib/utils";
import type { BadgeTone } from "../lib/job-finder-types";

interface StatusBadgeProps {
  children: ReactNode;
  className?: string;
  tone: BadgeTone;
}

export function StatusBadge({ children, className, tone }: StatusBadgeProps) {
  // Tinted status fills at /10 with a /25-/30 border composited to
  // 1.18-1.4:1 in the light theme, so the chips read as tinted text runs and
  // the status grammar collapsed. The fills and borders below keep the same
  // hue families but survive both themes.
  //
  // The tinted borders take --badge-border-alpha: 75% in light, where /65
  // fell below 3:1 against each chip's own tint (2.97:1 positive, 2.86:1
  // active), and 40% in dark. A badge is an inert label whose text (>= 4.5:1
  // on its tint) carries the status; at 75% every row of a dark list wore a
  // bright coloured outline and the columns read as a stack of boxes. Pinned
  // per theme by styles/globals.test.ts.
  const toneClassName = {
    active: "border-primary/(--badge-border-alpha) bg-primary/15 text-primary",
    critical:
      "border-critical/(--badge-border-alpha) bg-critical/15 text-critical",
    muted: "border-(--surface-panel-border) bg-secondary text-muted-foreground",
    neutral: "border-(--surface-panel-border) bg-surface text-foreground-soft",
    positive:
      "border-positive/(--badge-border-alpha) bg-positive/15 text-positive",
    warning:
      "border-warning/(--badge-border-alpha) bg-(--warning-surface) text-(--warning-text)",
  }[tone];

  return (
    <Badge
      className={cn(
        "inline-block w-auto min-w-0 max-w-full shrink whitespace-normal break-words text-center leading-4 [overflow-wrap:anywhere]",
        toneClassName,
        className,
      )}
      variant="status"
    >
      {children}
    </Badge>
  );
}
