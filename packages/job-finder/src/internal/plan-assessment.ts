import type { SavedJob, MatchAssessment } from "@nordri/contracts";
export function withPlanAssessment<T extends SavedJob>(
  job: T,
  planId: string | null,
  assessment: MatchAssessment = job.matchAssessment,
): T {
  return {
    ...job,
    matchAssessment: assessment,
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
  return assessment ? { ...job, matchAssessment: assessment } : job;
}
export function personPickedJob(job: SavedJob): boolean {
  return (
    job.personSupplied === true ||
    job.status !== "discovered" ||
    job.provenance.some((source) => source.targetId === "assistant_page")
  );
}
