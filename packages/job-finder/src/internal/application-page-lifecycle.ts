import type { BrowserSessionRuntime } from "@nordri/browser-runtime";
import type { JobSource } from "@nordri/contracts";
import type { JobFinderRepository } from "@nordri/db";

// Page cleanup is best effort: a tab that will not close must never turn a
// finished application, or the error that ended it, into a different result.

/** Replacement attempts inherit the exact application's live form, never a URL match. */
export async function reuseApplicationPage(
  input: Parameters<typeof transferApplicationPage>[0],
): Promise<void> {
  await transferApplicationPage(input).catch(() => undefined);
}

async function transferApplicationPage(input: {
  repository: JobFinderRepository;
  browserRuntime: BrowserSessionRuntime;
  source: JobSource;
  applicationRecordId: string;
  resultId: string;
}): Promise<void> {
  if (!input.browserRuntime.transferApplicationPageBinding) return;
  const results = await input.repository.listApplyJobResults({
    applicationRecordId: input.applicationRecordId,
  });
  for (const result of [...results].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (result.id === input.resultId || result.state === "submitted") continue;
    if (
      await input.browserRuntime.transferApplicationPageBinding(
        input.source,
        result.id,
        input.resultId,
      )
    )
      return;
  }
}

/** Releases only the requested results; review and resumable blockers stay live. */
export async function releaseFinishedApplicationPages(
  input: Parameters<typeof releaseApplicationPages>[0],
): Promise<void> {
  await releaseApplicationPages(input).catch(() => undefined);
}

async function releaseApplicationPages(input: {
  repository: JobFinderRepository;
  browserRuntime: BrowserSessionRuntime;
  runId?: string;
  jobId?: string;
  applicationRecordId?: string;
  removed?: boolean;
}): Promise<void> {
  if (!input.browserRuntime.releaseApplicationPageBinding) return;
  const results = await input.repository.listApplyJobResults({
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.applicationRecordId
      ? { applicationRecordId: input.applicationRecordId }
      : {}),
  });
  const [jobs, runs] = await Promise.all([
    input.repository.listSavedJobs(),
    input.repository.listApplyRuns(
      input.runId ? { id: input.runId } : undefined,
    ),
  ]);
  for (const result of results) {
    const job = jobs.find((entry) => entry.id === result.jobId);
    const run = runs.find((entry) => entry.id === result.runId);
    const unfinishedInTerminalRun =
      (run?.state === "cancelled" || run?.state === "failed") &&
      ["planned", "question_capture", "filling", "submitting"].includes(
        result.state,
      );
    if (
      unfinishedInTerminalRun ||
      input.removed ||
      !job ||
      job.status === "archived" ||
      ["submitted", "skipped", "cancelled", "failed"].includes(result.state)
    ) {
      await input.browserRuntime
        .releaseApplicationPageBinding(job?.source ?? "target_site", result.id)
        .catch(() => undefined);
    }
  }
}
