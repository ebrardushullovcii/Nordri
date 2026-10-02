import type { ApplyAnswerSources, ApplyFormObservation } from "./types";
import { normalizeSignal } from "./control-classification";
import { workHistoryField } from "./answer-sourcing";

/** Current saved facts, rather than the model's conversation or the attached PDF. */
export function applicationFacts(sources: ApplyAnswerSources) {
  const profile = sources.profile;
  return {
    experiences: profile.experiences.filter((entry) => entry.isDraft !== true),
    education: profile.education,
    skills: profile.skills,
    reusableAnswers: sources.reusableAnswers,
  };
}

/** Null means this observation does not show a structured employment section. */
export function structuredExperienceGap(
  observation: ApplyFormObservation,
  sources: ApplyAnswerSources,
): string | null | false {
  const roles = sources.profile.experiences.filter(
    (entry) => entry.isDraft !== true,
  );
  if (roles.length === 0) return null;
  const rows = new Map<number, { fields: Set<string>; incomplete: boolean }>();
  for (const control of observation.controls) {
    if (!control.visible || control.disabled) continue;
    const field = workHistoryField(control);
    if (!field) continue;
    const row = rows.get(field.index) ?? {
      fields: new Set<string>(),
      incomplete: false,
    };
    if (control.answered) row.fields.add(field.field);
    if (control.required && !control.answered) row.incomplete = true;
    rows.set(field.index, row);
  }
  const employmentSection = [
    observation.step.label ?? "",
    ...observation.headings.map((heading) => heading.text),
    ...observation.controls
      .filter((control) => control.visible && !control.disabled)
      .map((control) => control.groupLabel),
  ].some((label) =>
    /^(?:my |work |employment |professional )?(?:experience|history)$/u.test(
      normalizeSignal(label),
    ),
  );
  const hasAdd = [...observation.actions, ...observation.clickables].some(
    (action) =>
      action.visible &&
      /^add(?: work| employment)?(?: experience| history)?$/u.test(
        normalizeSignal(action.label),
      ),
  );
  if (rows.size === 0 && !(employmentSection && hasAdd)) return null;
  const completed = [...rows.values()].filter(
    (row) =>
      row.fields.has("companyName") &&
      row.fields.has("title") &&
      !row.incomplete,
  ).length;
  return completed >= roles.length
    ? false
    : "Structured work history is incomplete. Your saved roles still need to be entered on the form; the attached resume does not fill those rows.";
}
