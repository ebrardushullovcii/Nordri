import type {
  AssistantRunRef,
  JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";

import { readBackgroundBatch } from "./tools";
import { allJobs, compactJob } from "./tools/format";

/**
 * Whether a background run a conversation waits on has ended, and what the
 * model is told about it. Read from the workspace, never from the model.
 */
export interface RunStatus {
  done: boolean;
  summary: string;
  details: unknown;
}

const APPLY_TERMINAL_STATES = new Set(["completed", "cancelled", "failed"]);

export function readRunStatus(
  snapshot: JobFinderWorkspaceSnapshot,
  run: AssistantRunRef,
): RunStatus {
  if (run.kind === "discovery") {
    const record =
      snapshot.activeDiscoveryRun?.id === run.id
        ? snapshot.activeDiscoveryRun
        : (snapshot.recentDiscoveryRuns.find((entry) => entry.id === run.id) ??
          null);
    if (!record) {
      return {
        done: true,
        summary: `The search run ${run.id} is no longer recorded.`,
        details: null,
      };
    }
    if (record.state === "running") {
      return { done: false, summary: "Searching.", details: null };
    }
    const newJobs = snapshot.discoveryJobs
      .filter(
        (job) =>
          job.discoveredAt >= record.startedAt && job.status === "discovered",
      )
      .sort(
        (left, right) =>
          right.matchAssessment.score - left.matchAssessment.score,
      );
    return {
      done: true,
      summary: `The search ${record.state === "cancelled" ? "was stopped" : "finished"}: ${record.summary.jobsPersisted ?? newJobs.length} new job(s) kept, ${record.summary.duplicatesMerged ?? 0} duplicate(s) merged.`,
      details: {
        runId: record.id,
        state: record.state,
        summary: record.summary,
        newJobs: newJobs.slice(0, 15).map(compactJob),
        newJobIds: newJobs.map((job) => job.id),
      },
    };
  }
  if (run.kind === "apply_batch" || run.kind === "apply_run") {
    const record =
      snapshot.applyRuns.find((entry) => entry.id === run.id) ?? null;
    if (!record) {
      return {
        done: true,
        summary: `The application batch ${run.id} is no longer recorded.`,
        details: null,
      };
    }
    const results = snapshot.applyJobResults.filter(
      (result) => result.runId === run.id,
    );
    // An answer given to a Needs you step is still being put on the form:
    // the run has not ended yet, whatever its own state says. Reporting it
    // as ended then read as "it stopped again on the same question".
    const answerBeingApplied = (snapshot.userActionRequests ?? []).some(
      (request) =>
        request.state === "verifying" &&
        request.scope.type === "application" &&
        request.scope.runId === run.id,
    );
    const stillWorking =
      answerBeingApplied ||
      results.some((result) =>
        ["planned", "question_capture", "filling", "submitting"].includes(
          result.state,
        ),
      );
    const done =
      APPLY_TERMINAL_STATES.has(record.state) ||
      (!stillWorking && results.length > 0 && record.state !== "running");
    if (!done) {
      return {
        done: false,
        summary: "Applications in progress.",
        details: null,
      };
    }
    const byState = new Map<string, number>();
    for (const result of results) {
      byState.set(result.state, (byState.get(result.state) ?? 0) + 1);
    }
    return {
      done: true,
      summary: `The application batch ended (${[...byState.entries()].map(([state, count]) => `${count} ${state.replaceAll("_", " ")}`).join(", ") || record.state}).`,
      details: {
        runId: record.id,
        state: record.state,
        results: results.map((result) => {
          const job = allJobs(snapshot).find(
            (entry) => entry.id === result.jobId,
          );
          return {
            jobId: result.jobId,
            title: job ? `${job.title} at ${job.company}` : null,
            // The address the application actually used, so the reply
            // names the real site.
            appliedOn: job?.applicationUrl ?? job?.canonicalUrl ?? null,
            state: result.state,
            outcome: result.privacyReceipt?.submissionOutcome?.outcome ?? null,
            blocker: result.blockerSummary ?? null,
          };
        }),
      },
    };
  }
  if (run.kind === "resume_generation") {
    const batch = readBackgroundBatch(run.id);
    if (batch && !batch.done) {
      return { done: false, summary: "Writing resumes.", details: null };
    }
    const assets = snapshot.tailoredAssets.filter((asset) =>
      run.jobIds.includes(asset.jobId),
    );
    const generating = assets.some((asset) => asset.status === "generating");
    if (!batch && generating) {
      return { done: false, summary: "Writing resumes.", details: null };
    }
    return {
      done: true,
      summary: `Resume writing ended for ${run.jobIds.length} job(s)${batch?.failures.length ? `; ${batch.failures.length} failed` : ""}.`,
      details: {
        resumes: run.jobIds.map((jobId) => {
          const item = snapshot.reviewQueue.find(
            (entry) => entry.jobId === jobId,
          );
          return {
            jobId,
            resume: item?.resumeReview.status ?? "unknown",
            linesToDecide: item?.resumeLinesToDecide ?? 0,
          };
        }),
        failures: batch?.failures ?? [],
      },
    };
  }
  const running = snapshot.recentSourceDebugRuns.find(
    (entry) => entry.id === run.id,
  );
  return {
    done: !running || running.state !== "running",
    summary: running
      ? `The source check ${running.state}.`
      : "The source check ended.",
    details: null,
  };
}
