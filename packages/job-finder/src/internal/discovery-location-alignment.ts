import type {
  JobPosting,
  JobSearchPreferences,
  MatchAssessment,
  SavedJob,
} from "@nordri/contracts";
import {
  assessLocationCompatibility,
  readLocationMatchOptions,
} from "./matching";

const REMOTE_LISTING_PATTERN =
  /\b(?:remote|anywhere|worldwide|work from home|wfh|global|distributed)\b/iu;
const GLOBAL_REMOTE_PREFERENCE_PATTERN =
  /^(?:remote(?:\s*[,/-]\s*(?:anywhere|worldwide|global))?|anywhere|worldwide|global)$/iu;

function isRemoteListing(
  posting: Pick<
    JobPosting,
    | "applicationUrl"
    | "canonicalUrl"
    | "description"
    | "location"
    | "summary"
    | "workMode"
  >,
): boolean {
  return (
    posting.workMode.includes("remote") ||
    REMOTE_LISTING_PATTERN.test(
      [
        posting.location,
        posting.summary ?? "",
        posting.description,
        posting.canonicalUrl,
        posting.applicationUrl ?? "",
      ].join(" "),
    )
  );
}

function hasNoNamedLocation(location: string): boolean {
  const trimmed = location.trim();
  return (
    trimmed.length === 0 ||
    /^(?:location )?(?:not stated|unknown|unavailable|not listed)$/iu.test(
      trimmed,
    ) ||
    /^(?:anywhere|worldwide|global|remote)$/iu.test(trimmed)
  );
}

/**
 * The person asked for local work only when they chose on-site or hybrid
 * themselves. Work modes left blank are not a goal: reading them as "on site
 * or hybrid in my city" marked every remote job down and told the person
 * they had asked for something they never chose.
 */
function requestedLocalWork(preferences: JobSearchPreferences): boolean {
  return (
    preferences.locations.length > 0 &&
    !preferences.locations.some((location) =>
      GLOBAL_REMOTE_PREFERENCE_PATTERN.test(location.trim()),
    ) &&
    !preferences.workModes.includes("remote") &&
    (preferences.workModes.includes("onsite") ||
      preferences.workModes.includes("hybrid"))
  );
}

function requestedLocationLabel(preferences: JobSearchPreferences): string {
  return preferences.locations.join(" or ");
}

function hasNamedCompatibleLocation(
  posting: Pick<JobPosting, "location">,
  preferences: JobSearchPreferences,
): boolean {
  return (
    !hasNoNamedLocation(posting.location) &&
    assessLocationCompatibility(
      posting.location,
      preferences.locations,
      readLocationMatchOptions(preferences),
    ) === "compatible"
  );
}

/**
 * Corrects the generic "Anywhere includes every city" geography rule when a
 * person explicitly asked for local onsite/hybrid work. It is a ranking miss,
 * not an exclusion or hard conflict.
 */
export function correctRemoteOnlyLocationAlignment(
  posting: JobPosting | SavedJob,
  assessment: MatchAssessment,
  preferences: JobSearchPreferences,
): MatchAssessment {
  // The model judged the place itself; no rule corrects it (ADR 0041).
  if (assessment.judgment) {
    return assessment;
  }
  // A concrete city/region match is the strongest location evidence. A
  // generic remote word elsewhere in the page must never overturn it.
  if (hasNamedCompatibleLocation(posting, preferences)) {
    return assessment.locationReach === "in_area"
      ? assessment
      : { ...assessment, locationReach: "in_area" };
  }
  if (
    !requestedLocalWork(preferences) ||
    (!isRemoteListing(posting) && !hasNoNamedLocation(posting.location)) ||
    assessment.locationReach === "outside_area"
  ) {
    return assessment;
  }

  const modeLabel = preferences.workModes.includes("onsite")
    ? preferences.workModes.includes("hybrid")
      ? "onsite or hybrid"
      : "onsite"
    : "hybrid";
  const evidenceSentence = `${
    hasNoNamedLocation(posting.location)
      ? "The listing does not name the requested place"
      : "Remote listing"
  }; you asked for ${requestedLocationLabel(preferences)} ${modeLabel}.`;
  const reasons = assessment.reasons.filter(
    (reason) =>
      reason !== "Location fits the saved search preferences." &&
      !reason.startsWith("Remote listing; remote is one of your preferred"),
  );

  return {
    ...assessment,
    score: Math.max(0, assessment.score - 20),
    locationReach: "outside_area",
    reasons,
    gaps: [
      evidenceSentence,
      ...assessment.gaps.filter((gap) => gap !== evidenceSentence),
    ].slice(0, 3),
    dimensions: {
      ...assessment.dimensions,
      preferenceAlignment: {
        ...assessment.dimensions.preferenceAlignment,
        state: "mixed",
        explanation: evidenceSentence,
        evidence: [
          {
            source: "derived" as const,
            label: "Location comparison",
            detail: evidenceSentence,
          },
          ...assessment.dimensions.preferenceAlignment.evidence.filter(
            (entry) => entry.label !== "Location comparison",
          ),
        ].slice(0, 4),
      },
    },
  };
}

/** Describe only this search's returned listings, not a source's full inventory. */
export function describeRemoteOnlySourceMismatch(
  jobs: readonly SavedJob[],
  preferences: JobSearchPreferences,
): string | null {
  if (
    jobs.length === 0 ||
    !requestedLocalWork(preferences) ||
    jobs.some(
      (job) =>
        !(
          job.workMode.includes("remote") ||
          REMOTE_LISTING_PATTERN.test(
            [job.location, job.canonicalUrl, job.applicationUrl ?? ""].join(
              " ",
            ),
          )
        ) || hasNamedCompatibleLocation(job, preferences),
    )
  ) {
    return null;
  }

  return `This search returned only remote jobs; try another search for jobs in ${requestedLocationLabel(
    preferences,
  )}.`;
}
