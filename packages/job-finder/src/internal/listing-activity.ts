import type {
  ApplicationAttempt,
  DiscoveryJobView,
  DiscoveryLedgerEntry,
  ListingActivity,
  ListingSignalRecord,
  SavedJob,
} from "@nordri/contracts";

import { createJobIdentityIndex } from "./job-identity";

type ActivityCandidate = Exclude<ListingActivity, { status: "unknown" }>;

/**
 * Phrases a listing uses to say it is over.
 *
 * One list, shared with discovery title triage, so a phrase added for either
 * surface closes the listing everywhere. Matching stays on whole phrases
 * rather than on a board name or a URL shape: nothing here is specific to any
 * one job site.
 */
export const CLOSED_LISTING_BODY_PATTERN =
  /\b(?:no longer accepting applications|no longer accepting candidates|not accepting (?:new )?applications|closed to new applicants|no longer available|no longer active|this (?:job|position|role|listing|vacancy|opening) (?:(?:has been|was) (?:filled|closed|removed|archived|expired)|is now (?:filled|closed|removed|archived|expired)|is (?:closed|removed|archived|expired|no longer open))|(?:this )?(?:position|role|vacancy|opening) (?:has been|was|is now) filled|(?:job|position|listing|vacancy|opening) has (?:closed|expired|ended)|applications? (?:are|is|have) (?:now )?closed|this posting (?:has expired|is closed|is no longer active)|hiring for this (?:job|role|position) has (?:closed|ended)|we are no longer hiring for this|we have filled this)\b/iu;

const CONDITIONAL_CLOSURE_PREFIX_PATTERN =
  /\b(?:after|before|if|once|until|when)\b[^.!?]*$/iu;

/**
 * The captured listing text, in the order a closure sentence usually appears.
 * Only text the app actually stored is read; nothing is fetched here.
 */
function listingText(job: SavedJob): string {
  return [job.summary, job.description, job.title]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

/** The closure phrase the listing itself used, or null. */
export function findClosedListingPhrase(job: SavedJob): string | null {
  for (const sentence of listingText(job).split(/(?<=[.!?])\s+|\r?\n+/u)) {
    const match = CLOSED_LISTING_BODY_PATTERN.exec(sentence);
    if (
      match &&
      !CONDITIONAL_CLOSURE_PREFIX_PATTERN.test(sentence.slice(0, match.index))
    ) {
      return match[0];
    }
  }
  return null;
}

function closedByOwnTextCandidate(
  job: SavedJob,
): ActivityCandidate | undefined {
  const phrase = findClosedListingPhrase(job);
  if (!phrase) {
    return undefined;
  }

  // Same instant as the "last seen" observation it overrides, so the closure
  // wins the tie instead of losing to the sighting that captured it.
  const observedAt = job.lastSeenAt ?? job.firstSeenAt ?? job.discoveredAt;
  return {
    status: "closed",
    observedAt,
    signalId: `listing-text:${job.id}`,
    provenance: "system",
    explanation: "The listing's own text says it is no longer open.",
    detail: `The page says "${phrase}".`,
    confidence: 1,
  };
}

const activityTiePriority: Record<ActivityCandidate["status"], number> = {
  active: 0,
  inactive: 1,
  stale: 2,
  closed: 3,
};

function newerActivity(
  current: ActivityCandidate | undefined,
  candidate: ActivityCandidate,
): ActivityCandidate {
  if (!current) return candidate;

  const timestampOrder =
    Date.parse(candidate.observedAt) - Date.parse(current.observedAt);
  if (timestampOrder !== 0) {
    return timestampOrder > 0 ? candidate : current;
  }

  return activityTiePriority[candidate.status] >
    activityTiePriority[current.status]
    ? candidate
    : current;
}

function activeCandidate(job: SavedJob): ActivityCandidate | undefined {
  if (
    job.lastVerifiedActiveAt &&
    (!job.lastSeenAt ||
      Date.parse(job.lastVerifiedActiveAt) >= Date.parse(job.lastSeenAt))
  ) {
    return {
      status: "active",
      observedAt: job.lastVerifiedActiveAt,
      evidence: "last_verified_active_at",
    };
  }
  return job.lastSeenAt
    ? {
        status: "active",
        observedAt: job.lastSeenAt,
        evidence: "last_seen_at",
      }
    : undefined;
}

/**
 * Projects non-persisted listing activity in linear indexed passes. Ledger
 * aliases must resolve to exactly one job; possible, ambiguous, and conflicting
 * identities cannot change another listing's activity.
 */
export function projectDiscoveryJobViews(input: {
  jobs: readonly SavedJob[];
  discoveryLedger: readonly DiscoveryLedgerEntry[];
  listingSignals: readonly ListingSignalRecord[];
  applicationAttempts?: readonly ApplicationAttempt[];
}): DiscoveryJobView[] {
  const jobIdentityIndex = createJobIdentityIndex(input.jobs, (job) => job);
  const candidateByJob = new Map<SavedJob, ActivityCandidate>();
  const uniqueJobById = new Map<string, SavedJob | null>();

  for (const job of input.jobs) {
    const active = activeCandidate(job);
    if (active) candidateByJob.set(job, active);
    // A listing that says it is closed is closed, whatever the last sighting
    // claimed. This used to leave such a posting labelled Active and free to
    // rank first.
    const closedByOwnText = closedByOwnTextCandidate(job);
    if (closedByOwnText) {
      candidateByJob.set(
        job,
        newerActivity(candidateByJob.get(job), closedByOwnText),
      );
    }
    uniqueJobById.set(job.id, uniqueJobById.has(job.id) ? null : job);
  }

  for (const entry of input.discoveryLedger) {
    if (entry.latestStatus !== "inactive" || entry.inactiveAt === null)
      continue;
    const resolution = jobIdentityIndex.resolve(entry);
    if (resolution.status !== "matched") continue;

    candidateByJob.set(
      resolution.value,
      newerActivity(candidateByJob.get(resolution.value), {
        status: "inactive",
        observedAt: entry.inactiveAt,
        ledgerEntryId: entry.id,
        provenance: "discovery_ledger",
        explanation:
          "A source inventory observation marked this exact listing inactive.",
      }),
    );
  }

  for (const signal of input.listingSignals) {
    if (signal.signal === "suspicious") continue;
    const job = uniqueJobById.get(signal.jobId);
    if (!job) continue;

    candidateByJob.set(
      job,
      newerActivity(candidateByJob.get(job), {
        status: signal.signal,
        observedAt: signal.detectedAt,
        signalId: signal.id,
        provenance: signal.provenance,
        explanation: signal.explanation,
        detail: signal.detail,
        confidence: signal.confidence,
      }),
    );
  }

  for (const attempt of input.applicationAttempts ?? []) {
    if (attempt.blocker?.code !== "application_closed") continue;
    const job = uniqueJobById.get(attempt.jobId);
    if (!job) continue;
    candidateByJob.set(
      job,
      newerActivity(candidateByJob.get(job), {
        status: "closed",
        observedAt: attempt.updatedAt,
        signalId: attempt.id,
        provenance: "browser",
        confidence: 1,
        explanation: attempt.summary,
        detail: attempt.detail,
      }),
    );
  }

  return input.jobs.map((job) => ({
    ...job,
    listingActivity: candidateByJob.get(job) ?? { status: "unknown" },
  }));
}
