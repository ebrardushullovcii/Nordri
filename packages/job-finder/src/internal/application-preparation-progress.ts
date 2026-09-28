import type { ApplicationPreparationProgress } from "@nordri/browser-runtime";
import { ApplyJobResultSchema } from "@nordri/contracts";
import type { JobFinderRepository } from "@nordri/db";

/**
 * Turns an agent/tool note into a safe sentence for durable UI state.
 *
 * Tool notes may include a field label or the value written to it. Those
 * details belong in the final review card, not in a progress banner or log.
 */
export function describeApplicationPreparationProgress(note: string): string {
  if (note === "asking the assistant what to do next") {
    return "Thinking about the next form step";
  }
  if (note.startsWith("suggest_answer")) return "Checking a form answer";
  if (note.startsWith("observe")) return "Reading the application form";
  if (note.startsWith("fill_text")) return "Filling a text field";
  if (note.startsWith("choose_option")) return "Choosing a form option";
  if (note.startsWith("set_toggle")) return "Setting a form choice";
  if (note.startsWith("upload")) return "Attaching an approved document";
  if (note.startsWith("finished")) return "Finishing the review checkpoint";
  if (note.includes("time limit")) return "The assistant response timed out";
  if (note.includes("failure")) return "A form step needs another approach";
  return "Working through the application form";
}

const ACTIVE_PREPARATION_STATES = new Set([
  "planned",
  "question_capture",
  "filling",
]);

/**
 * Keeps the Applications screen truthful during a long form run.
 *
 * A compare-and-swap prevents a late progress event from replacing a final
 * outcome written by cancellation, review, or submission handling.
 */
export async function persistApplicationPreparationProgress(input: {
  repository: Pick<
    JobFinderRepository,
    "listApplyJobResults" | "compareAndSwapApplyJobResult"
  >;
  resultId: string;
  runId: string;
  jobId: string;
  progress: ApplicationPreparationProgress;
  now?: () => Date;
}): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = (
      await input.repository.listApplyJobResults({
        runId: input.runId,
        jobId: input.jobId,
      })
    ).find((result) => result.id === input.resultId);

    if (!current || !ACTIVE_PREPARATION_STATES.has(current.state)) return;

    const now = (input.now ?? (() => new Date()))().toISOString();
    const next = ApplyJobResultSchema.parse({
      ...current,
      state: "filling",
      summary: `Filling in application · Step ${input.progress.step}`,
      detail: describeApplicationPreparationProgress(input.progress.note),
      updatedAt: now,
      completedAt: null,
    });
    if (
      await input.repository.compareAndSwapApplyJobResult({
        expected: current,
        result: next,
      })
    ) {
      return;
    }
  }
}

/** Written on an application waiting for a free tab in the Job Finder browser. */
export const WAITING_FOR_BROWSER_TAB_SUMMARY = "Waiting for a free browser tab";

/**
 * Says on the application that it is waiting for a tab, instead of failing
 * it after 20 seconds with "close tabs you no longer need".
 */
export async function persistApplicationWaitingForBrowserTab(input: {
  repository: Pick<
    JobFinderRepository,
    "listApplyJobResults" | "compareAndSwapApplyJobResult"
  >;
  resultId: string;
  runId: string;
  jobId: string;
}): Promise<void> {
  const current = (
    await input.repository.listApplyJobResults({
      runId: input.runId,
      jobId: input.jobId,
    })
  ).find((result) => result.id === input.resultId);
  if (!current || !ACTIVE_PREPARATION_STATES.has(current.state)) return;
  await input.repository.compareAndSwapApplyJobResult({
    expected: current,
    result: ApplyJobResultSchema.parse({
      ...current,
      summary: WAITING_FOR_BROWSER_TAB_SUMMARY,
      detail:
        "The Job Finder browser has as many tabs open as it allows. This application starts as soon as one frees up: close a tab you no longer need, or send a filled-in application.",
      updatedAt: new Date().toISOString(),
      completedAt: null,
    }),
  });
}
