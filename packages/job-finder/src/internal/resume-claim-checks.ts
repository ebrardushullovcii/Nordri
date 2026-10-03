import {
  RESUME_CLAIM_CHECK_BATCH_SIZE,
  type JobFinderAiClient,
} from "@nordri/ai-providers";
import type {
  CandidateProfile,
  ResumeClaimCheck,
  ResumeDraft,
  SavedJob,
} from "@nordri/contracts";
import { fnv1a32 } from "@nordri/core";

import { applyPatchToResumeDraft } from "./resume-workspace-patches";
import {
  buildResumeClaimDescriptors,
  buildResumeClaimEvidenceBank,
  buildPersonsOwnResumeClaimMatcher,
  evaluateResumeProposalGrounding,
  resumeClaimContentHash,
  sanitizeResumeDraft,
} from "./resume-workspace-helpers";

/**
 * The model checks a draft's generated lines against the person's evidence
 * before the draft is validated and kept (ADR 0041).
 *
 * Verdicts are kept on the draft by each line's content hash, and remembered
 * here for the session, so a line is checked once however many times the
 * draft is previewed, proposed, accepted or exported. A line the model could
 * not check stays unchecked and goes to the person; nothing guesses for it.
 */

const SESSION_CACHE_LIMIT = 4_000;
const sessionChecks = new Map<string, ResumeClaimCheck>();

function remember(key: string, check: ResumeClaimCheck): void {
  sessionChecks.delete(key);
  sessionChecks.set(key, check);
  if (sessionChecks.size > SESSION_CACHE_LIMIT) {
    const oldest = sessionChecks.keys().next().value;
    if (oldest !== undefined) sessionChecks.delete(oldest);
  }
}

export async function withResumeClaimChecks(input: {
  aiClient: Pick<JobFinderAiClient, "checkResumeClaims">;
  draft: ResumeDraft;
  job: SavedJob;
  profile: CandidateProfile | undefined;
  tailoringStrength?: string | null;
  now?: () => string;
  signal?: AbortSignal;
}): Promise<ResumeDraft> {
  const { draft, profile } = input;
  const isPersonsOwn = buildPersonsOwnResumeClaimMatcher({ draft, profile });
  const claims = buildResumeClaimDescriptors(draft).filter(
    (claim) => !isPersonsOwn(claim),
  );
  if (claims.length === 0 && (draft.claimChecks ?? []).length === 0) {
    return draft;
  }
  const evidence = buildResumeClaimEvidenceBank(profile).map((entry) => ({
    id: entry.ref.id,
    text: entry.text,
  }));
  const evidenceKey = fnv1a32(
    JSON.stringify([
      evidence.map((entry) => entry.text),
      profile?.baseResume.textContent ?? "",
    ]),
  );
  const stored = new Map(
    (draft.claimChecks ?? [])
      .filter((check) => check.evidenceKey === evidenceKey)
      .map((check) => [check.contentHash, check] as const),
  );
  const kept = new Map<string, ResumeClaimCheck>();
  const pending = new Map<string, (typeof claims)[number]>();
  for (const claim of claims) {
    const contentHash = resumeClaimContentHash(claim.text);
    const known =
      stored.get(contentHash) ??
      sessionChecks.get(`${evidenceKey}|${contentHash}`);
    if (known) kept.set(contentHash, known);
    else if (!kept.has(contentHash)) pending.set(contentHash, claim);
  }

  const checkResumeClaims = input.aiClient.checkResumeClaims?.bind(
    input.aiClient,
  );
  if (checkResumeClaims && pending.size > 0) {
    const now = input.now ?? (() => new Date().toISOString());
    const entries = [...pending.entries()];
    for (
      let start = 0;
      start < entries.length;
      start += RESUME_CLAIM_CHECK_BATCH_SIZE
    ) {
      const batch = entries.slice(start, start + RESUME_CLAIM_CHECK_BATCH_SIZE);
      // Short ids the model can echo exactly; each maps back to its line.
      const hashById = new Map(
        batch.map(([contentHash], index) => [`line_${index + 1}`, contentHash]),
      );
      const request = {
        ...(input.signal ? { signal: input.signal } : {}),
        tailoringStrength: input.tailoringStrength ?? "balanced",
        job: {
          title: input.job.title,
          company: input.job.company,
          description: input.job.description,
        },
        evidence,
        resumeText: profile?.baseResume.textContent ?? null,
        claims: batch.map(([, claim], index) => ({
          id: `line_${index + 1}`,
          section:
            draft.sections.find((section) => section.id === claim.sectionId)
              ?.label ?? claim.field,
          text: claim.text,
        })),
      };
      // A call that fails for a passing reason is asked once more.
      const results = await checkResumeClaims(request).catch(
        (error: unknown) => {
          if (input.signal?.aborted) throw error;
          return checkResumeClaims(request).catch((retryError: unknown) => {
            if (input.signal?.aborted) throw retryError;
            // These lines stay unchecked and go to the person.
            return [];
          });
        },
      );
      const checkedAt = now();
      for (const result of results) {
        const contentHash = hashById.get(result.id);
        if (!contentHash) continue;
        const check: ResumeClaimCheck = {
          contentHash,
          verdict: result.verdict,
          reason: result.reason,
          evidenceIds: result.evidenceIds,
          evidenceKey,
          checkedAt,
        };
        kept.set(contentHash, check);
        remember(`${evidenceKey}|${contentHash}`, check);
      }
    }
  }

  return { ...draft, claimChecks: [...kept.values()] };
}

/**
 * The proposal gate over the draft that accepting these changes would
 * produce, with the model's verdicts on its new lines (ADR 0041).
 */
export async function evaluateCheckedResumeProposalGrounding(
  check: {
    aiClient: Pick<JobFinderAiClient, "checkResumeClaims">;
    tailoringStrength?: string | null;
    signal?: AbortSignal;
  },
  input: Parameters<typeof evaluateResumeProposalGrounding>[0],
): Promise<ReturnType<typeof evaluateResumeProposalGrounding>> {
  if (input.patches.length === 0) {
    return evaluateResumeProposalGrounding(input);
  }
  let candidate = input.baselineDraft;
  for (const patch of input.patches) {
    candidate = applyPatchToResumeDraft({
      draft: candidate,
      patch,
      updatedAt: input.evaluatedAt,
    });
  }
  const checked = await withResumeClaimChecks({
    aiClient: check.aiClient,
    draft: sanitizeResumeDraft({
      draft: candidate,
      job: input.job,
      ...(input.profile ? { profile: input.profile } : {}),
    }),
    job: input.job,
    profile: input.profile,
    tailoringStrength: check.tailoringStrength ?? null,
    ...(check.signal ? { signal: check.signal } : {}),
  });
  return evaluateResumeProposalGrounding({
    ...input,
    candidateClaimChecks: checked.claimChecks ?? [],
  });
}
