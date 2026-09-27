import { JobFinderIntelligenceStateSchema } from "@unemployed/contracts";
import { isReviewablePreparedResult } from "./automatic-safeguards";
import type { WorkspaceServiceContext } from "./workspace-service-context";

/** Retire obsolete automatic reviews without claiming that a person reviewed them. */
export async function reconcileAutomaticBatchSampleReviews(
  ctx: Pick<
    WorkspaceServiceContext,
    "repository" | "withIntelligenceTransition"
  >,
): Promise<void> {
  const initial = await ctx.repository.getIntelligenceState();
  if (
    !initial.safeguards.preparedBatchSampleReviews.some(
      (review) =>
        !review.reviewCompleted &&
        review.id === `automatic_batch_sample_review:${review.batchId}`,
    )
  ) {
    return;
  }

  await ctx.withIntelligenceTransition(async () => {
    const [state, runs, results] = await Promise.all([
      ctx.repository.getIntelligenceState(),
      ctx.repository.listApplyRuns(),
      ctx.repository.listApplyJobResults(),
    ]);
    const reviews = state.safeguards.preparedBatchSampleReviews;
    const currentReviews = reviews.filter((review) => {
      if (
        review.reviewCompleted ||
        review.id !== `automatic_batch_sample_review:${review.batchId}` ||
        state.safeguards.safeguardDismissals.some(
          (dismissal) =>
            dismissal.kind === "batch_sample_review_pending" &&
            dismissal.referenceId === review.id,
        )
      ) {
        return true;
      }
      const run = runs.find((candidate) => candidate.id === review.batchId);
      if (
        !run ||
        ![
          "completed",
          "paused_for_user_review",
          "cancelled",
          "failed",
        ].includes(run.state)
      ) {
        return true;
      }
      const batchResults = results.filter((result) => result.runId === run.id);
      // Missing history, live work, or an uncertain submission is not
      // evidence that the review became obsolete.
      if (
        run.jobIds.length === 0 ||
        run.jobIds.some(
          (jobId) => !batchResults.some((result) => result.jobId === jobId),
        ) ||
        batchResults.some(
          (result) =>
            ["planned", "filling"].includes(result.state) ||
            result.privacyReceipt?.submissionOutcome?.outcome ===
              "outcome_uncertain",
        )
      ) {
        return true;
      }
      // Older automatic samples could name a question/access handoff as if
      // there were a prepared form to review. Keep the decision only while
      // at least one sampled result is genuinely inspectable.
      if (
        review.sampledItemIds.some((id) =>
          batchResults.some(
            (result) => result.id === id && isReviewablePreparedResult(result),
          ),
        )
      )
        return true;
      // None of this completed batch's prepared forms can still be reviewed.
      // A subsequent preparation has its own run and its own review identity.
      return false;
    });
    if (currentReviews.length === reviews.length) return;
    const now = new Date().toISOString();
    await ctx.repository.saveIntelligenceState(
      JobFinderIntelligenceStateSchema.parse({
        ...state,
        safeguards: {
          ...state.safeguards,
          preparedBatchSampleReviews: currentReviews,
          updatedAt: now,
        },
        updatedAt: now,
      }),
    );
  });
}
