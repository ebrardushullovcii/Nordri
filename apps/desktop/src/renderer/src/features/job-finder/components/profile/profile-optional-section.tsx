import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface ProfileOptionalSectionProps {
  children: ReactNode;
  // Only applied on mount so later value changes never collapse an open
  // section while the user is editing inside it.
  defaultOpen?: boolean;
  description: string;
  title: string;
}

export function ProfileOptionalSection({
  children,
  defaultOpen = false,
  description,
  title,
}: ProfileOptionalSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="surface-card-tint group/optional rounded-(--radius-panel) border border-(--surface-panel-border) p-4 [&_summary::-webkit-details-marker]:hidden"
      onToggle={(event) =>
        setOpen((event.currentTarget as HTMLDetailsElement).open)
      }
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-(length:--text-body) font-semibold text-(--text-headline)">
              {title}
            </span>
            <span className="text-(length:--text-tiny) uppercase tracking-(--tracking-mono) text-foreground-muted">
              Optional
            </span>
          </span>
          <span className="text-(length:--text-description) leading-6 text-foreground-muted">
            {description}
          </span>
        </span>

        {/* F79: the control's entire label used to be the word "Optional" -
            a state word in a pill, which reads as a status badge rather than
            something you can press. The control now says what pressing it
            does; "Optional" stays as plain descriptive text beside the title.
            The boundary is `--control-border` because this is interactive
            chrome, not an inert well (F10). */}
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-(--control-border) bg-(--surface-well) px-2.5 py-1 text-(length:--text-tiny) font-medium uppercase tracking-(--tracking-mono) text-foreground-soft transition-transform group-open/optional:[&_svg]:rotate-180">
          <ChevronDown className="size-3 transition-transform duration-200" />
          {open ? "Hide" : "Show"}
        </span>
      </summary>

      <div className="mt-4 grid gap-4 border-t border-(--surface-panel-border) pt-4">
        {children}
      </div>
    </details>
  );
}
