import type { Ref } from "react";
import { Button } from "@renderer/components/ui/button";
import type { SettingsDirtySection } from "./settings-dirty-sections";
import { focusSettingsSection } from "./settings-section-anchor";

/** Contextual reminder; each save still belongs to its own section. */
export function SettingsUnsavedChangesBar({
  dirtySections,
  ref,
}: {
  dirtySections: readonly SettingsDirtySection[];
  // The screen measures the rendered bar so the scrolled sections above can
  // reserve at least its height of clearance; the bar wraps, so its height is
  // layout-dependent rather than a constant.
  ref?: Ref<HTMLDivElement>;
}) {
  const hasUnsavedChanges = dirtySections.length > 0;
  const soleDirtySection =
    dirtySections.length === 1 ? dirtySections[0] : undefined;

  if (!hasUnsavedChanges) return null;

  return (
    <div
      aria-live="polite"
      // Sticky to the bottom of the settings scroll region: the distance
      // between a control and the commit that owns it no longer grows with
      // the section's height. Fully opaque — the page must never be visible
      // scrolling through the bar the way it did through the old subnav.
      className="sticky bottom-3 z-40 mx-auto flex w-full max-w-3xl min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--background) px-3 py-2 shadow-sm"
      data-settings-save-state="dirty"
      data-settings-unsaved-bar
      data-settings-unsaved-count={dirtySections.length}
      ref={ref}
      role="status"
    >
      <p className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium leading-5">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-(--warning-text)"
        />
        {soleDirtySection
          ? `Unsaved changes in ${soleDirtySection.label}.`
          : `Unsaved changes in ${dirtySections.length} sections: ${dirtySections.map((section) => section.label).join(", ")}.`}
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {dirtySections.map((section) => (
          <Button
            key={section.anchorId}
            onClick={() => {
              focusSettingsSection(section.anchorId);
            }}
            size="compact"
            type="button"
            variant="secondary"
          >
            {soleDirtySection ? "Review" : `Go to ${section.label}`}
          </Button>
        ))}
        {soleDirtySection ? (
          <Button
            disabled={
              soleDirtySection.isSaving || soleDirtySection.isSaveDisabled
            }
            onClick={() => soleDirtySection.save()}
            pending={soleDirtySection.isSaving}
            size="compact"
            type="button"
            variant="primary"
          >
            {soleDirtySection.isSaving
              ? `Saving ${soleDirtySection.label}`
              : soleDirtySection.saveLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
