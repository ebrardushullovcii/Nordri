export type ProfileSection =
  | "basics"
  | "experience"
  | "background"
  | "preferences"
  | "sources"
  | "files";

export interface SectionProgress {
  filled: number;
  percent: number;
  total: number;
  /**
   * The section's minimal required fields, modelled separately from the
   * overall filled/total count so the visible tab signal counts only what
   * the journey actually needs instead of every optional field.
   */
  required?: SectionRequiredProgress;
}

export interface SectionRequiredProgress {
  filled: number;
  total: number;
}

export type SectionProgressState =
  | "complete"
  | "remaining"
  | "optional"
  | "empty";

function createSectionProgress(filled: number, total: number): SectionProgress {
  if (total <= 0) {
    return { filled: 0, percent: 0, total: 0 };
  }

  return {
    filled,
    percent: Math.round((filled / total) * 100),
    total,
  };
}

export function withRequiredProgress(
  progress: SectionProgress,
  requiredValues: readonly unknown[],
): SectionProgress {
  return {
    ...progress,
    required: {
      filled: requiredValues.filter((value) => isFilledValue(value)).length,
      total: requiredValues.length,
    },
  };
}

export function getSectionProgressState(
  progress: SectionProgress,
): SectionProgressState {
  const required = progress.required;

  if (required && required.total > 0) {
    return required.filled >= required.total ? "complete" : "remaining";
  }

  if (progress.total === 0) {
    return "empty";
  }

  return progress.filled > 0 ? "complete" : "optional";
}

function isFilledValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== null && value !== undefined;
}

export function countFilledFields(values: readonly unknown[]): SectionProgress {
  return createSectionProgress(
    values.filter((value) => isFilledValue(value)).length,
    values.length,
  );
}

export function countFilledRecordFields(
  records: ReadonlyArray<Record<string, unknown>>,
  ignoredKeys: readonly string[] = [],
): SectionProgress {
  const ignored = new Set(ignoredKeys);
  let filled = 0;
  let total = 0;

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (ignored.has(key)) {
        continue;
      }

      total += 1;

      if (isFilledValue(value)) {
        filled += 1;
      }
    }
  }

  return createSectionProgress(filled, total);
}

export function combineSectionProgress(
  ...stats: readonly SectionProgress[]
): SectionProgress {
  return createSectionProgress(
    stats.reduce((sum, stat) => sum + stat.filled, 0),
    stats.reduce((sum, stat) => sum + stat.total, 0),
  );
}

/**
 * The accessible wording that accompanies a tab's bare remaining-count digit.
 *
 * Only the `remaining` state reaches this: the section tabs render the count,
 * and this label beside it, solely while required fields are still
 * outstanding. The former "Required done" / "Optional added" / "Optional" /
 * "Empty" / "Not started" wording lost its last caller when the per-tab
 * completion chips were removed, so those branches are gone rather than kept
 * unreachable. Sections in every other state read as their name alone, and
 * the state itself is still published on each trigger by
 * `getSectionProgressState`.
 *
 * `section` is no longer read — the only section-specific wording was the
 * removed `empty` branch — but it stays in the signature because the caller
 * passes it.
 */
export function formatSectionProgressLabel(
  section: ProfileSection,
  progress: SectionProgress,
): string {
  const remaining = Math.max(
    0,
    (progress.required?.total ?? 0) - (progress.required?.filled ?? 0),
  );

  return `${remaining} to fill`;
}
