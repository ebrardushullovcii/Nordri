import type {
  JobPosting,
  JobSearchPreferences,
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
