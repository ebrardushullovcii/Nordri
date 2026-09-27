import {
  AiBehaviorPreferenceSchema,
  type JobFinderSettings,
  type JobSearchPreferences,
} from "@unemployed/contracts";

/**
 * Carries Settings' "Count remote jobs as any location" into the search
 * preferences the triage and the scorer read, at the moment they read them.
 * Only an explicit off is written, so a person who never turned it off keeps
 * the same preferences (and the same score fingerprint) as before.
 */
export function withSavedJobSearchBehavior(
  searchPreferences: JobSearchPreferences,
  settings: Pick<JobFinderSettings, "aiBehavior"> | null | undefined,
): JobSearchPreferences {
  const { remoteCountsAsAnyLocation } = AiBehaviorPreferenceSchema.parse(
    settings?.aiBehavior ?? {},
  ).jobSearch;
  const discovery = { ...searchPreferences.discovery };
  delete discovery.remoteCountsAsAnyLocation;
  if (!remoteCountsAsAnyLocation) {
    discovery.remoteCountsAsAnyLocation = false;
  }
  return { ...searchPreferences, discovery };
}
