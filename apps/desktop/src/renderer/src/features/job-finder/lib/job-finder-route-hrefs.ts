// Router-owned route paths for the Job Finder surfaces. Render them through
// react-router <Link to> (or navigate()) so every in-app navigation goes
// through the router and stays guarded by the page controller's dirty-state
// blocker; do not render them as raw "#/..." anchor hrefs.
export const JOB_FINDER_ROUTE_PATHS = {
  profile: "/job-finder/profile",
  profileTargetRoles:
    "/job-finder/profile?section=preferences&focus=target-roles",
  profileWorkModes: "/job-finder/profile?section=preferences&focus=work-modes",
  profileSources: "/job-finder/profile?section=sources&focus=job-sources",
  discovery: "/job-finder/discovery",
  campaigns: "/job-finder/campaigns",
  reviewQueue: "/job-finder/review-queue",
  applications: "/job-finder/applications",
  /** The person's extra application files: a Profile tab, not a destination. */
  profileFiles: "/job-finder/profile?section=files",
  settings: "/job-finder/settings",
} as const;

/**
 * Search plans carries the plan editor; `edit=plan` asks it to open that
 * plan's editor on arrival, which is the same editor the plan card's Edit
 * button opens.
 */
export const CAMPAIGN_PLAN_EDITOR_SEARCH_PARAM = "edit";
export const CAMPAIGN_PLAN_EDITOR_SEARCH_VALUE = "plan";

/**
 * One plan's editor, open and ready to change.
 *
 * Find jobs offers "Edit this plan's places" in two places. Both used to link
 * to the plan list, so a person who asked to change where this search looks
 * landed on a screen of plan cards and had to find the plan and press Edit
 * again. The link now names the plan it is about.
 */
export function campaignPlanEditorHref(campaignId: string): string {
  return `${JOB_FINDER_ROUTE_PATHS.campaigns}?campaignId=${encodeURIComponent(
    campaignId,
  )}&${CAMPAIGN_PLAN_EDITOR_SEARCH_PARAM}=${CAMPAIGN_PLAN_EDITOR_SEARCH_VALUE}`;
}

/** The file kinds Profile › Files can preselect from a link. */
export type ProfileFileKindHint =
  | "portfolio"
  | "work_sample"
  | "cover_letter"
  | "transcript"
  | "certificate"
  | "image"
  | "other";

/**
 * Profile › Files with "What is the file?" already set to the kind the
 * application asked for. A transcript card used to land on Portfolio.
 */
export function profileFilesHref(
  kind?: ProfileFileKindHint | readonly ProfileFileKindHint[] | null,
): string {
  const kinds = [...new Set(kind ? (Array.isArray(kind) ? kind : [kind]) : [])];
  return kinds.length > 0
    ? `${JOB_FINDER_ROUTE_PATHS.profileFiles}&kind=${kinds.map(encodeURIComponent).join(",")}`
    : JOB_FINDER_ROUTE_PATHS.profileFiles;
}

/**
 * The file kind a form's upload field asks for, read from its question kind
 * and its label ("Academic transcript" is a transcript).
 */
export function inferFileKindForQuestion(question: {
  kind: string;
  prompt: string;
}): ProfileFileKindHint {
  if (question.kind === "portfolio") return "portfolio";
  if (question.kind === "cover_letter") return "cover_letter";
  const prompt = question.prompt.toLowerCase();
  if (/transcript|grades|academic record/u.test(prompt)) return "transcript";
  if (/certificat|licen[cs]e|diploma/u.test(prompt)) return "certificate";
  if (/cover letter|motivation letter/u.test(prompt)) return "cover_letter";
  if (/portfolio/u.test(prompt)) return "portfolio";
  if (/sample|writing|case study/u.test(prompt)) return "work_sample";
  if (/photo|image|headshot|picture/u.test(prompt)) return "image";
  return "other";
}
