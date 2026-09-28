export type JobFinderPlatform = "darwin" | "linux" | "win32";

export type JobFinderShortcutId =
  | "open-global-search"
  | "open-shortcuts"
  | "toggle-assistant"
  | "toggle-sidebar";

export type JobFinderShortcutCombo = "/" | "?" | "mod+b" | "mod+i" | "mod+k";

const LITERAL_KEY_COMBOS: readonly JobFinderShortcutCombo[] = ["/", "?"];

function isLiteralKeyCombo(combo: JobFinderShortcutCombo): boolean {
  return LITERAL_KEY_COMBOS.includes(combo);
}

export interface JobFinderShortcutDefinition {
  combo: JobFinderShortcutCombo;
  id: JobFinderShortcutId;
  label: string;
  scope: string;
}

export const JOB_FINDER_SHORTCUTS: readonly JobFinderShortcutDefinition[] = [
  {
    combo: "mod+k",
    id: "open-global-search",
    label: "Search your workspace",
    scope: "Anywhere in Job Finder",
  },
  {
    combo: "/",
    id: "open-global-search",
    label: "Search your workspace",
    scope: "Outside text fields, controls, and dialogs",
  },
  {
    combo: "mod+b",
    id: "toggle-sidebar",
    label: "Show or hide the sidebar",
    // Must mirror useJobFinderShellShortcuts: the combo only fires at the wide
    // layout breakpoint while no overlay or search surface is open and the
    // focus is outside editable fields.
    scope: "Wide layout only, outside overlays, search, and editable fields",
  },
  {
    combo: "mod+i",
    id: "toggle-assistant",
    label: "Show or hide the assistant",
    scope: "Anywhere in Job Finder",
  },
  {
    combo: "?",
    id: "open-shortcuts",
    label: "Show keyboard shortcuts",
    scope: "Outside text fields, controls, and dialogs",
  },
];

export interface JobFinderKeyEventLike {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function eventMatchesJobFinderShortcut(
  event: JobFinderKeyEventLike,
  combo: JobFinderShortcutCombo,
): boolean {
  if (isLiteralKeyCombo(combo)) {
    return (
      event.key === combo && !event.altKey && !event.ctrlKey && !event.metaKey
    );
  }

  const shortcutKey = combo.slice(4);
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === shortcutKey
  );
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  const contenteditable = target.getAttribute("contenteditable");
  return contenteditable !== null && contenteditable !== "false";
}

const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  "button, a, select, summary, [role='button'], [role='combobox'], [role='menuitem'], [role='option'], [role='tab']";

export function isInteractiveShortcutTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest(INTERACTIVE_SHORTCUT_TARGET_SELECTOR) !== null;
}

export function isImeComposingEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}

/**
 * The keycaps a combo is made of, in press order.
 *
 * A modifier and its key are two physical keys, so they are two caps: rendering
 * `⌘K` as a single cap read as one unfamiliar glyph-token rather than as
 * "hold Command, press K". Literal-key shortcuts are a single cap.
 */
export function getJobFinderShortcutKeycaps(
  combo: JobFinderShortcutCombo,
  platform: JobFinderPlatform,
): readonly string[] {
  if (isLiteralKeyCombo(combo)) {
    return [combo];
  }
  return [platform === "darwin" ? "⌘" : "Ctrl", combo.slice(4).toUpperCase()];
}

/** One-line rendering of a combo, for tooltips and title strings. */
export function formatJobFinderShortcutCombo(
  combo: JobFinderShortcutCombo,
  platform: JobFinderPlatform,
): string {
  if (isLiteralKeyCombo(combo)) {
    return combo;
  }
  const key = combo.slice(4).toUpperCase();
  return platform === "darwin" ? `⌘${key}` : `Ctrl ${key}`;
}

export function getJobFinderAriaKeyshortcuts(
  combo: Exclude<JobFinderShortcutCombo, "/">,
  platform: JobFinderPlatform,
): string {
  return `${platform === "darwin" ? "Meta" : "Control"}+${combo.slice(4)}`;
}

/** One combo, as the individual keycaps it is pressed with. */
export type JobFinderShortcutKeycaps = readonly string[];

export interface JobFinderShortcutHelpEntry {
  combos: readonly JobFinderShortcutKeycaps[];
  id: JobFinderShortcutId;
  /** Stable row key; an id can appear once per distinct scope. */
  rowId: string;
  label: string;
  scope: string;
}

/**
 * One row per shortcut id **and scope**.
 *
 * Grouping purely by id used to concatenate the aliases' scopes into a single
 * three-line grey paragraph ("Anywhere in Job Finder; Outside text fields,
 * controls, and dialogs") describing two different conditions at once, beside a
 * pair of keycaps that read as one broken token. Splitting by scope keeps every
 * row to one action, one scope sentence, and the keycaps that actually fire
 * under it; aliases that genuinely share a scope still share a row and render
 * as separate keycaps.
 */
export function buildJobFinderShortcutHelp(
  platform: JobFinderPlatform,
): readonly JobFinderShortcutHelpEntry[] {
  const entries = new Map<string, JobFinderShortcutHelpEntry>();
  for (const shortcut of JOB_FINDER_SHORTCUTS) {
    const rowId = `${shortcut.id}::${shortcut.scope}`;
    const keycaps = getJobFinderShortcutKeycaps(shortcut.combo, platform);
    const existing = entries.get(rowId);
    if (existing) {
      existing.combos = [...existing.combos, keycaps];
      continue;
    }
    entries.set(rowId, {
      combos: [keycaps],
      id: shortcut.id,
      rowId,
      label: shortcut.label,
      scope: shortcut.scope,
    });
  }
  return [...entries.values()];
}
