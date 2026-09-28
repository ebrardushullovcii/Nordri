import type {
  CandidateProfile,
  JobRequirementAssessment,
} from "@nordri/contracts";

import type { MatchAssessmentPostingInput } from "./match-assessment-posting-input";

/**
 * Career stage — the "who is this role for" axis — is separate from the role
 * family ("what work is this") and from the saved seniority *preference*.
 *
 * A senior candidate and a graduate-programme listing can share a role family
 * ("Software Engineer"), an identical skill list and every saved preference,
 * so before this dimension existed they scored identically. That is the
 * defect this module closes.
 *
 * Everything here is source-generic: it reads only the listing's own words and
 * the saved profile, never the board the listing came from.
 *
 * Conservative-unknown discipline, matching the rest of the matcher:
 * - a stage is only claimed when the listing (or profile) states it;
 * - the requirement is emitted only when BOTH sides are known;
 * - the only hard conflict is a listing that is explicitly reserved for
 *   entrants (graduate/intern/new-grad/early-careers programmes) held against
 *   a profile that is explicitly senior. Everything else stays neutral.
 */
export type ListingCareerStage = "entry_programme" | "experienced";

/**
 * Only the saved target roles are read, and only as extra evidence about the
 * candidate's own stage. Accepting a readonly list keeps callers free to pass
 * a frozen preferences slice.
 */
export type CareerStageSearchPreferences = {
  targetRoles: readonly string[];
};

export type ProfileCareerStage = "early_career" | "experienced" | "senior";

export interface ListingCareerStageEvidence {
  stage: ListingCareerStage;
  /** The exact listing sentence or title fragment the stage was read from. */
  evidence: string;
}

export interface ProfileCareerStageEvidence {
  stage: ProfileCareerStage;
  /** Plain-language statement of the profile fact behind the stage. */
  detail: string;
}

/**
 * Years of recorded experience at or above which a profile is treated as
 * senior even when no explicit seniority word appears anywhere. Deliberately
 * generous: below it, only explicit wording decides.
 */
const SENIOR_YEARS_THRESHOLD = 6;
const EXPERIENCED_YEARS_THRESHOLD = 3;

/**
 * Programme wording. These describe who the opening is *reserved for*, not
 * merely that juniors are welcome, so they are strong enough to conflict.
 */
const ENTRY_PROGRAMME_PATTERNS: readonly RegExp[] = [
  /\bearly[\s-]?careers?\b/iu,
  /\bnew[\s-]?grad(?:uate)?s?\b/iu,
  // "Graduate" only counts when a role or programme noun follows within a
  // couple of words, so "graduate degree required" is not misread as a
  // graduate programme.
  /\bgraduates?\s+(?:\w+\s+){0,2}(?:programme|program|scheme|scholar|analyst|engineer|developer|designer|associate|consultant|role|position|opportunit\w+|hiring|recruitment)\b/iu,
  /\b(?:campus|university)\s+(?:hire|hiring|recruit\w*|programme|program)\b/iu,
  /\bintern(?:ship)?s?\b/iu,
  /\bapprentice(?:ship)?s?\b/iu,
  /\bplacement\s+(?:year|student|scheme)\b/iu,
  /\bworking\s+student\b/iu,
  /\bentry[\s-]?level\b/iu,
  /\bstudents?\s+and\s+(?:recent\s+)?graduates?\b/iu,
  /\brecent\s+graduates?\b/iu,
  /\bclass\s+of\s+20\d{2}\b/iu,
];

/**
 * A dated future start ("2027 Start", "Starting September 2026") is only a
 * career-stage signal in combination with programme wording or a study-status
 * requirement; on its own it is just a start date.
 */
const DATED_FUTURE_START_PATTERN =
  /\b(?:(?:start(?:ing|s)?|intake|cohort|commenc\w+)\s+(?:in\s+)?(?:\w+\s+)?20\d{2}|20\d{2}\s+(?:start|intake|cohort))\b/iu;

const STUDY_STATUS_PATTERN =
  /\b(?:currently\s+(?:enrolled|studying)|final[\s-]?year\s+student|pursuing\s+(?:a\s+)?(?:bachelor|master|degree)|expected\s+graduation|graduating\s+in\s+20\d{2}|must\s+be\s+a\s+student)\b/iu;

/**
 * Explicit "this is not an entry role" wording. When present it overrides
 * incidental programme vocabulary (for example a senior role that mentions
 * mentoring interns).
 */
const EXPERIENCED_LISTING_PATTERNS: readonly RegExp[] = [
  /\b(?:senior|staff|principal|lead|distinguished|architect)\b/iu,
  /\b(?:\d{1,2})\+?\s*(?:years|yrs)\b[^.!?\n]{0,40}\bexperience\b/iu,
  /\bexperienced\s+(?:engineer|developer|professional|hire)s?\b/iu,
];

const SENIOR_PROFILE_TITLE_PATTERN =
  /\b(?:senior|staff|principal|lead|distinguished|architect|director|head|chief|manager|vp)\b/iu;

const EARLY_CAREER_PROFILE_TITLE_PATTERN =
  /\b(?:junior|intern|graduate|trainee|apprentice|entry[\s-]?level|student)\b/iu;

function firstSentenceContaining(text: string, pattern: RegExp): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.find((sentence) => pattern.test(sentence)) ?? null;
}

function clip(value: string, limit = 200): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trim()}…`;
}

/**
 * Reads the listing's own career-stage claim.
 *
 * The title outranks the body: a title that reserves the opening for entrants
 * is decisive even when the body also lists years of experience, while body-
 * only programme wording yields to explicit experienced wording so that a
 * senior role mentioning "mentor our interns" is not misread.
 */
export function detectListingCareerStage(
  posting: Pick<
    MatchAssessmentPostingInput,
    "title" | "summary" | "description" | "minimumQualifications" | "seniority"
  >,
): ListingCareerStageEvidence | null {
  const title = posting.title ?? "";
  const body = [
    posting.summary ?? "",
    posting.description ?? "",
    ...(posting.minimumQualifications ?? []),
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n");
  const seniority = posting.seniority ?? "";

  const titleProgramme = ENTRY_PROGRAMME_PATTERNS.some((pattern) =>
    pattern.test(title),
  );
  const seniorityProgramme = ENTRY_PROGRAMME_PATTERNS.some((pattern) =>
    pattern.test(seniority),
  );
  if (titleProgramme || seniorityProgramme) {
    return {
      stage: "entry_programme",
      evidence: clip(titleProgramme ? title : `${title} — ${seniority}`),
    };
  }

  const titleExperienced = EXPERIENCED_LISTING_PATTERNS.some((pattern) =>
    pattern.test(title),
  );
  if (titleExperienced) {
    return { stage: "experienced", evidence: clip(title) };
  }

  const bodyProgramme = ENTRY_PROGRAMME_PATTERNS.find((pattern) =>
    pattern.test(body),
  );
  const bodyExperienced = EXPERIENCED_LISTING_PATTERNS.some((pattern) =>
    pattern.test(body),
  );
  if (bodyProgramme && !bodyExperienced) {
    return {
      stage: "entry_programme",
      evidence: clip(firstSentenceContaining(body, bodyProgramme) ?? title),
    };
  }

  // A dated future start is only a stage signal beside a study-status
  // requirement; alone it is an ordinary start date and stays unknown.
  if (
    DATED_FUTURE_START_PATTERN.test(`${title}\n${body}`) &&
    STUDY_STATUS_PATTERN.test(body)
  ) {
    return {
      stage: "entry_programme",
      evidence: clip(
        firstSentenceContaining(body, STUDY_STATUS_PATTERN) ?? title,
      ),
    };
  }

  if (bodyExperienced) {
    return { stage: "experienced", evidence: clip(title) };
  }

  return null;
}

/**
 * Reads the profile's own career stage. Explicit wording in the headline or
 * current role wins; the recorded experience timeline is the fallback.
 */
export function deriveProfileCareerStage(
  profile: Pick<
    CandidateProfile,
    "headline" | "yearsExperience" | "experiences"
  >,
  searchPreferences: CareerStageSearchPreferences,
): ProfileCareerStageEvidence | null {
  const titleEvidence = [
    profile.headline ?? "",
    profile.experiences[0]?.title ?? "",
    ...searchPreferences.targetRoles,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const years = Number.isFinite(profile.yearsExperience)
    ? profile.yearsExperience
    : 0;

  if (EARLY_CAREER_PROFILE_TITLE_PATTERN.test(titleEvidence) && years < 3) {
    return {
      stage: "early_career",
      detail: `The saved profile describes an early-career position and records ${years} ${years === 1 ? "year" : "years"} of experience.`,
    };
  }

  if (SENIOR_PROFILE_TITLE_PATTERN.test(titleEvidence)) {
    return {
      stage: "senior",
      detail: `The saved headline and target roles describe a senior position, with ${years} ${years === 1 ? "year" : "years"} of recorded experience.`,
    };
  }

  if (years >= SENIOR_YEARS_THRESHOLD) {
    return {
      stage: "senior",
      detail: `The imported timeline records ${years} years of experience.`,
    };
  }

  if (years >= EXPERIENCED_YEARS_THRESHOLD) {
    return {
      stage: "experienced",
      detail: `The imported timeline records ${years} years of experience.`,
    };
  }

  return null;
}

/**
 * The career-stage requirement, or `null` when either side is unknown.
 *
 * Emitting nothing on unknown evidence is deliberate: an absent requirement
 * leaves the score exactly where it was, whereas an "unknown" required
 * requirement would penalise every listing whose wording happens not to state
 * a stage.
 */
export function buildCareerStageRequirement(input: {
  profile: Pick<
    CandidateProfile,
    "id" | "headline" | "yearsExperience" | "experiences"
  >;
  posting: Pick<
    MatchAssessmentPostingInput,
    "title" | "summary" | "description" | "minimumQualifications" | "seniority"
  >;
  searchPreferences: CareerStageSearchPreferences;
}): JobRequirementAssessment | null {
  const listing = detectListingCareerStage(input.posting);
  if (!listing) {
    return null;
  }
  const candidate = deriveProfileCareerStage(
    input.profile,
    input.searchPreferences,
  );
  if (!candidate) {
    return null;
  }

  const resumeEvidence = [
    {
      sourceKind: "profile" as const,
      sourceId: input.profile.id,
      label: "Career stage in your profile",
      detail: candidate.detail,
    },
  ];

  if (listing.stage === "entry_programme") {
    if (candidate.stage === "senior") {
      return {
        id: "seniority_career_stage",
        category: "seniority",
        label: "Career stage: early-careers opening",
        importance: "required",
        status: "conflict",
        jobEvidence: listing.evidence,
        resumeEvidence,
        explanation:
          "This opening is reserved for graduates, interns, or other early-careers entrants, while your profile is senior. Openings reserved for entrants normally exclude senior applicants.",
      };
    }

    if (candidate.stage === "early_career") {
      return {
        id: "seniority_career_stage",
        category: "seniority",
        label: "Career stage: early-careers opening",
        importance: "required",
        status: "supported",
        jobEvidence: listing.evidence,
        resumeEvidence,
        explanation:
          "This opening is aimed at early-careers entrants, which matches the career stage saved in your profile.",
      };
    }

    // "experienced" but not senior: neither clearly excluded nor a match.
    return null;
  }

  // An ordinary experienced-hire listing states nothing that the role family,
  // years-of-experience and seniority-preference checks do not already cover,
  // so it deliberately contributes no extra requirement row: adding one to
  // every listing would change every listing's evidence coverage without
  // telling the user anything new.
  return null;
}
