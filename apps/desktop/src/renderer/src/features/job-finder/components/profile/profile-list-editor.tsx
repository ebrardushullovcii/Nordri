import { useId, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import { cn } from "@renderer/lib/cn";
import { profileInputClassName } from "./profile-form-primitives";

interface ProfileListEditorProps {
  className?: string;
  displayMode?: "chips" | "rows";
  draftParser?: (value: string) => readonly string[];
  emptyMessage?: string;
  inputId?: string;
  label: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: readonly string[];
}

/**
 * A place can itself contain commas ("Chicago, IL" or "Paris, France").
 * Keep those commas inside the place; only the separators the location UI
 * promises create more than one entry.
 */
export function parseProfileLocationDraft(value: string): string[] {
  return value
    .split(/[;\r\n]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ProfileListEditor({
  className,
  displayMode = "chips",
  draftParser,
  emptyMessage = "No items added yet.",
  inputId,
  label,
  onChange,
  placeholder,
  values,
}: ProfileListEditorProps) {
  const generatedInputId = useId();
  const resolvedInputId = inputId ?? generatedInputId;
  const [draft, setDraft] = useState("");

  const updateValues = (nextValues: readonly string[]) => {
    const normalizedCurrentValues = [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    const normalizedNextValues = [
      ...new Set(nextValues.map((value) => value.trim()).filter(Boolean)),
    ];
    const isUnchanged =
      normalizedCurrentValues.length === normalizedNextValues.length &&
      normalizedCurrentValues.every(
        (value, index) => value === normalizedNextValues[index],
      );

    if (!isUnchanged) {
      onChange(normalizedNextValues);
    }
  };

  const addValue = () => {
    const trimmed = draft.trim();

    if (!trimmed) {
      return;
    }

    const parsedValues = draftParser ? [...draftParser(trimmed)] : [trimmed];
    updateValues([...values, ...parsedValues]);

    setDraft("");
  };

  // Typed-but-uncommitted text used to be thrown away silently: a role typed
  // into "Add a target role" and then left by clicking "Save and continue"
  // never reached the form, so guided setup saved a plan with no roles and
  // Find jobs reported "No roles added yet". Leaving the field commits what
  // was typed, exactly as Enter and Add already do.
  const commitPendingDraft = () => {
    if (draft.trim()) {
      addValue();
    }
  };

  const isPopulated = values.length > 0;
  // Empty trays stay mounted (so adding items cannot shift the layout) but
  // collapse to roughly one control height instead of reserving full list
  // space. A populated tray grows with its content: a fixed-height tray showed
  // 6 of 52 chips and clipped the last row mid-chip, and an inner scrollbar
  // inside a page that already scrolls is worse than a taller section.
  const traySizingClassName = isPopulated
    ? displayMode === "chips"
      ? // Chips grow with their content; the old fixed 8.6rem floor left ~100px
        // of empty space under a single row of chips.
        "min-h-16"
      : "min-h-46"
    : "min-h-14";

  return (
    <section
      className={cn(
        "grid min-w-0 gap-3 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-raised) p-4 shadow-[inset_0_1px_0_var(--surface-inset-highlight)]",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel
          className="text-(length:--text-tiny) font-medium tracking-(--tracking-label) text-foreground-soft"
          htmlFor={resolvedInputId}
        >
          {label}
        </FieldLabel>
        <span className="text-(length:--text-count) uppercase tracking-(--tracking-label) text-foreground-muted">
          {values.length}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
        <Input
          className={profileInputClassName}
          id={resolvedInputId}
          onBlur={commitPendingDraft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          value={draft}
        />
        <Button
          className="h-11 w-full px-0"
          disabled={!draft.trim()}
          onClick={addValue}
          type="button"
          variant="secondary"
        >
          Add
        </Button>
      </div>

      <div
        className={cn(
          "rounded-(--radius-field) border border-border/70 bg-(--surface-overlay-list) p-3",
          displayMode === "chips"
            ? "flex flex-wrap content-start items-start gap-2"
            : "grid content-start gap-2",
          traySizingClassName,
        )}
      >
        {values.map((value) =>
          displayMode === "chips" ? (
            <div
              key={`${label}_${value}`}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-(--border) bg-(--surface-fill-chip) px-3 py-2 text-(length:--text-item) text-foreground-soft"
              title={value}
            >
              <span className="min-w-0 whitespace-normal break-words">
                {value}
              </span>
              <button
                aria-label={`Remove ${value}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-(length:--text-icon-small) leading-none text-muted-foreground transition-colors hover:bg-(--surface-panel) hover:text-foreground"
                onClick={() =>
                  updateValues(values.filter((entry) => entry !== value))
                }
                type="button"
              >
                <X aria-hidden className="size-3" />
              </button>
            </div>
          ) : (
            <div
              key={`${label}_${value}`}
              className="grid gap-2 rounded-(--radius-field) border border-border/60 bg-(--surface-fill-soft) px-3 py-2.5 text-(length:--text-item) leading-6 text-foreground-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {value}
                </span>
                <button
                  aria-label={`Remove ${value}`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-(length:--text-icon-small) leading-none text-muted-foreground transition-colors hover:bg-(--surface-panel) hover:text-foreground"
                  onClick={() =>
                    updateValues(values.filter((entry) => entry !== value))
                  }
                  type="button"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            </div>
          ),
        )}

        {values.length === 0 ? (
          <p className="m-auto px-4 py-2 text-center text-(length:--text-description) leading-6 text-foreground-muted">
            {emptyMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
