import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Settings keeps section-scoped saves: the button that commits a change lives
 * with the fields it commits. What was missing is persistent ownership — a
 * user who scrolled away from a long section had no way to tell that anything
 * was still unsaved, and no way back. Every section publishes its dirty state
 * here so one sticky bar can name what is outstanding without ever committing
 * a section the user did not ask it to commit.
 */
export type SettingsDirtySection = {
  /** The `id` of the settings region that owns this change. */
  anchorId: string;
  /** Whether this section's own save is currently in flight. */
  isSaving: boolean;
  isSaveDisabled?: boolean;
  /** Human name of the section, as shown in the section nav. */
  label: string;
  /** Document order, so the bar lists sections the way the page does. */
  order: number;
  /** Commits this section only. Stable across renders. */
  save: () => void;
  /** Full name of the commit action, for example "Save appearance". */
  saveLabel: string;
};

type SettingsDirtySectionsContextValue = {
  publish: (key: string, section: SettingsDirtySection | null) => void;
};

const SettingsDirtySectionsContext =
  createContext<SettingsDirtySectionsContextValue | null>(null);

function areSectionsEqual(
  left: SettingsDirtySection,
  right: SettingsDirtySection,
) {
  return (
    left.anchorId === right.anchorId &&
    left.isSaving === right.isSaving &&
    left.isSaveDisabled === right.isSaveDisabled &&
    left.label === right.label &&
    left.order === right.order &&
    left.save === right.save &&
    left.saveLabel === right.saveLabel
  );
}

/**
 * Owned by the Settings screen. Returns the ordered dirty sections plus the
 * stable context value to hand to `SettingsDirtySectionsProvider`.
 */
export function useSettingsDirtySections() {
  const [entries, setEntries] = useState<
    Readonly<Record<string, SettingsDirtySection>>
  >({});

  const publish = useCallback(
    (key: string, section: SettingsDirtySection | null) => {
      setEntries((current) => {
        if (!section) {
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        }

        const existing = current[key];
        if (existing && areSectionsEqual(existing, section)) {
          return current;
        }
        return { ...current, [key]: section };
      });
    },
    [],
  );

  const registry = useMemo<SettingsDirtySectionsContextValue>(
    () => ({ publish }),
    [publish],
  );

  const dirtySections = useMemo(
    () =>
      Object.values(entries).sort((left, right) => left.order - right.order),
    [entries],
  );

  return { dirtySections, registry };
}

export function SettingsDirtySectionsProvider({
  children,
  registry,
}: {
  children: ReactNode;
  registry: SettingsDirtySectionsContextValue;
}) {
  return (
    <SettingsDirtySectionsContext.Provider value={registry}>
      {children}
    </SettingsDirtySectionsContext.Provider>
  );
}

/**
 * Called by each settings section. Publishing is a no-op outside the provider,
 * so a section stays usable when rendered on its own (including in tests).
 */
export function useRegisterSettingsDirtySection(input: {
  anchorId: string;
  isDirty: boolean;
  isSaving: boolean;
  isSaveDisabled?: boolean;
  label: string;
  onSave: () => void;
  order: number;
  saveLabel: string;
}) {
  const {
    anchorId,
    isDirty,
    isSaveDisabled = false,
    isSaving,
    label,
    onSave,
    order,
    saveLabel,
  } = input;
  const context = useContext(SettingsDirtySectionsContext);
  const publish = context?.publish;

  // The save closure changes every render; the published handle must not, or
  // the registry would see a new value on every render and loop.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const stableSaveRef = useRef<(() => void) | null>(null);
  if (!stableSaveRef.current) {
    stableSaveRef.current = () => {
      onSaveRef.current();
    };
  }
  const stableSave = stableSaveRef.current;

  useEffect(() => {
    if (!publish) {
      return;
    }
    if (!isDirty) {
      publish(anchorId, null);
      return;
    }
    publish(anchorId, {
      anchorId,
      isSaveDisabled,
      isSaving,
      label,
      order,
      save: stableSave,
      saveLabel,
    });
  }, [
    anchorId,
    isDirty,
    isSaveDisabled,
    isSaving,
    label,
    order,
    publish,
    saveLabel,
    stableSave,
  ]);

  useEffect(
    () => () => {
      publish?.(anchorId, null);
    },
    [anchorId, publish],
  );
}
