import type { MatchAssessment, TitleFamilyMatch } from "@nordri/contracts";

import {
  TITLE_MATCHES_TARGET_ROLES_REASON,
  TITLE_MISSES_TARGET_ROLES_GAPS,
} from "../discovery-ordering";

/**
 * Whether the listing's own title sits in the same occupational family as a
 * saved target role, read back from one assessment.
 *
 * The scorer already decides this — it is why one row earns "Role title
 * aligns closely with the current target roles." and another "Role title is
 * adjacent to the target list but not an exact fit." — but until now the only
 * way to read the verdict was to look for those sentences, and every caller
 * that did lumped all three misses together. So a role a person plainly asked
 * for ("Executive Assistant I" against a saved "Executive Assistant") was
 * demoted to "Also found — Weaker matches" for the sole reason that its
 * listing text was never captured and it could not earn a score.
 *
 * `titleFamilyMatch` on the assessment is the field of record. This resolver
 * prefers it and falls back to the sentences for every assessment written
 * before that field existed, so banding is correct for stored rows today and
 * keeps working once the scorer records the verdict directly.
 *
 * Source-generic: it reads only the scorer's own verdict, never a board.
 */
export function resolveTitleFamilyMatch(
  assessment: Pick<MatchAssessment, "gaps" | "reasons" | "titleFamilyMatch"> &
    Partial<Pick<MatchAssessment, "dimensions">>,
): TitleFamilyMatch | null {
  const recorded = assessment.titleFamilyMatch;
  if (recorded) {
    return recorded;
  }

  const reasons = assessment.reasons ?? [];
  if (reasons.includes(TITLE_MATCHES_TARGET_ROLES_REASON)) {
    return "same_family";
  }

  const gaps = assessment.gaps ?? [];
  // The scorer's "adjacent" verdict: close enough to the saved list to be a
  // result the person asked for, not close enough to call an exact fit.
  if (gaps.includes(TITLE_MISSES_TARGET_ROLES_GAPS[2]!)) {
    return "adjacent";
  }
  if (
    gaps.includes(TITLE_MISSES_TARGET_ROLES_GAPS[0]!) ||
    gaps.includes(TITLE_MISSES_TARGET_ROLES_GAPS[1]!)
  ) {
    return "unrelated";
  }

  // The dimension carries the same verdict for rows whose reason and gap
  // sentences were rewritten or trimmed on the way to storage.
  const roleSuitability = assessment.dimensions?.roleSuitability?.state;
  if (roleSuitability === "exact") {
    return "same_family";
  }
  if (roleSuitability === "adjacent") {
    return "adjacent";
  }
  if (roleSuitability === "conflict") {
    return "unrelated";
  }

  return null;
}

/**
 * Whether this row's title is one the saved targets asked for. Used to keep a
 * role in the main results while its listing text is still unread: only a
 * title the scorer positively placed outside the saved families is demoted
 * for the absence of a score.
 */
export function isTargetTitleFamily(
  assessment: Parameters<typeof resolveTitleFamilyMatch>[0],
): boolean {
  const family = resolveTitleFamilyMatch(assessment);
  return family === "same_family" || family === "adjacent";
}
