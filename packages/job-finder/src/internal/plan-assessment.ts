import type { SavedJob, MatchAssessment } from "@nordri/contracts";
export function withPlanAssessment<T extends SavedJob>(
  job: T,
  planId: string | null,
  assessment: MatchAssessment = job.matchAssessment,
): T {
  return {
    ...job,
    matchAssessment: planId ? job.matchAssessment : assessment,
    ...(planId
      ? { planAssessments: { ...job.planAssessments, [planId]: assessment } }
      : {}),
  };
}
export function readPlanAssessment<T extends SavedJob>(
  job: T,
  planId: string | null,
): T {
  const assessment = planId ? job.planAssessments?.[planId] : null;
  // A plan without its own verdict shows the shared one, which plan-scoped
  // writes no longer change. Jobs judged before plans kept their own
  // verdicts keep showing that judgment instead of losing their fit.
  return assessment ? { ...job, matchAssessment: assessment } : job;
}
export function personPickedJob(job: SavedJob): boolean {
  return (
    job.personSupplied === true ||
    job.status !== "discovered" ||
    job.provenance.some((source) => source.targetId === "assistant_page")
  );
}
