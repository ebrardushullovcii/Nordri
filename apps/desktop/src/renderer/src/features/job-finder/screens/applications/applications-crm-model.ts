import type {
  ApplicationCrmCalendarEntry,
  ApplicationCrmData,
  ApplicationCrmStage,
  ApplicationRecord,
} from "@unemployed/contracts";
import {
  resolveApplicationCrmStageSource,
  resolveApplicationCrmTrackedStage,
} from "@unemployed/contracts";
import { formatApplicationEmployerLine } from "../../lib/job-employer-location-display";

export const APPLICATION_CRM_STAGE_ORDER: readonly ApplicationCrmStage[] = [
  "discovered",
  "reviewing",
  "shortlisted",
  "preparing",
  "ready_for_approval",
  "applied",
  "employer_viewed",
  "recruiter_contact",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "no_response",
];

export const APPLICATION_CRM_STAGE_NAMES: Record<ApplicationCrmStage, string> =
  {
    discovered: "Discovered",
    reviewing: "Reviewing",
    shortlisted: "Shortlisted",
    preparing: "Preparing",
    ready_for_approval: "Ready for approval",
    applied: "Applied",
    employer_viewed: "Employer viewed",
    recruiter_contact: "Recruiter contact",
    assessment: "Assessment",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    no_response: "No response",
  };

export const APPLICATION_CRM_STAGE_LABELS: Record<ApplicationCrmStage, string> =
  {
    discovered: "Discovered",
    reviewing: "Reviewing",
    shortlisted: "Shortlisted",
    preparing: "Preparing",
    ready_for_approval: "Ready for approval",
    // Provenance lives in the "You recorded this" badge, not in every label.
    applied: "Applied",
    employer_viewed: "Employer viewed",
    recruiter_contact: "Recruiter contact",
    assessment: "Assessment",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    no_response: "No response",
  };

export function inferApplicationCrmStageForView(
  record: ApplicationRecord,
): ApplicationCrmStage {
  return resolveApplicationCrmTrackedStage(
    record.crm,
    inferActivityStage(record),
  );
}

function inferActivityStage(record: ApplicationRecord): ApplicationCrmStage {
  // A paused or blocked attempt is still being prepared and is waiting on the
  // user. Reading only `status` showed "Ready for approval" on the Stages tab
  // while the Preparation tab said Needs you about the same application.
  const preparationBlocked =
    Boolean(record.latestBlocker) || record.lastAttemptState === "paused";
  switch (record.status) {
    case "shortlisted":
      return preparationBlocked ? "preparing" : "shortlisted";
    case "drafting":
      return "preparing";
    case "ready_for_review":
    case "approved":
      return preparationBlocked ? "preparing" : "ready_for_approval";
    case "submitted":
      return "applied";
    case "assessment":
    case "interview":
    case "offer":
    case "rejected":
    case "withdrawn":
      return record.status;
    case "archived":
      return "no_response";
    default:
      return preparationBlocked || record.lastAttemptState === "in_progress"
        ? "preparing"
        : "discovered";
  }
}

export function applicationCrmStageLabelForView(
  record: ApplicationRecord,
): string {
  const stage = inferApplicationCrmStageForView(record);
  // "(local historical inference)" is implementation vocabulary inside a
  // table cell. The provenance stays visible as its own badge and tooltip;
  // the cell just names the stage.
  return record.crm
    ? APPLICATION_CRM_STAGE_LABELS[stage]
    : APPLICATION_CRM_STAGE_NAMES[stage];
}

export function applicationCrmStageProvenanceForView(
  record: ApplicationRecord,
): string {
  return resolveApplicationCrmStageSource(record.crm) === "user"
    ? "You recorded this"
    : "From your activity";
}

/** Hover explanation for how a stage was decided. */
export function applicationCrmStageProvenanceDetailForView(
  record: ApplicationRecord,
): string {
  return resolveApplicationCrmStageSource(record.crm) === "user"
    ? "You set this stage yourself."
    : "Job Finder worked this out from your activity. Set it yourself to override.";
}

export function applicationCrmDataForView(
  record: ApplicationRecord,
): ApplicationCrmData {
  const stage = inferApplicationCrmStageForView(record);
  if (record.crm)
    return {
      ...record.crm,
      stage,
      stageSource: resolveApplicationCrmStageSource(record.crm),
      stageChangedAt:
        stage === record.crm.stage
          ? record.crm.stageChangedAt
          : record.lastUpdatedAt,
    };
  return {
    revision: 0,
    stage,
    stageSource: "activity",
    customStageId: null,
    stageChangedAt: record.lastUpdatedAt,
    tags: [],
    events: [],
    contacts: [],
    reminders: [],
    interviews: [],
    notes: [],
    attachments: [],
    compensation: {
      listedMinimum: null,
      listedMaximum: null,
      expectedMinimum: null,
      expectedMaximum: null,
      offerBase: null,
      offerBonus: null,
      offerEquity: null,
      offerBenefits: [],
      offerDeadlineAt: null,
      offerStatus: "none",
      notes: null,
    },
    lastEmployerActivityAt: null,
    appliedAt: record.status === "submitted" ? record.lastUpdatedAt : null,
  };
}

export function groupApplicationRecordsByStage(
  records: readonly ApplicationRecord[],
): Map<ApplicationCrmStage, ApplicationRecord[]> {
  const grouped = new Map<ApplicationCrmStage, ApplicationRecord[]>(
    APPLICATION_CRM_STAGE_ORDER.map((stage) => [stage, []]),
  );
  for (const record of records) {
    grouped.get(inferApplicationCrmStageForView(record))?.push(record);
  }
  return grouped;
}

export function buildApplicationCrmCalendarForView(
  records: readonly ApplicationRecord[],
  relatedJobsById?: ReadonlyMap<string, { canonicalUrl?: string | null }>,
): ApplicationCrmCalendarEntry[] {
  return records
    .flatMap((record) => {
      const crm = applicationCrmDataForView(record);
      const employerLine = formatApplicationEmployerLine({
        company: record.company,
        ...(relatedJobsById?.get(record.jobId)?.canonicalUrl
          ? { canonicalUrl: relatedJobsById.get(record.jobId)?.canonicalUrl }
          : {}),
      });
      const employerSuffix = employerLine ? ` · ${employerLine}` : "";
      const entries: ApplicationCrmCalendarEntry[] = [
        ...crm.reminders
          .filter((reminder) => reminder.status === "pending")
          .map((reminder) => ({
            id: `reminder_${reminder.id}`,
            applicationRecordId: record.id,
            kind: "reminder" as const,
            title: `${reminder.title}${employerSuffix}`,
            startsAt: reminder.dueAt,
            endsAt: null,
            status: reminder.status,
          })),
        ...crm.interviews
          .filter((interview) => interview.status === "scheduled")
          .map((interview) => ({
            id: `interview_${interview.id}`,
            applicationRecordId: record.id,
            kind: "interview" as const,
            title: `${interview.title}${employerSuffix}`,
            startsAt: interview.startsAt,
            endsAt: interview.endsAt,
            status: interview.status,
          })),
      ];
      if (crm.compensation.offerDeadlineAt) {
        entries.push({
          id: `offer_${record.id}`,
          applicationRecordId: record.id,
          kind: "offer_deadline",
          title: `Offer deadline${employerSuffix}`,
          startsAt: crm.compensation.offerDeadlineAt,
          endsAt: null,
          status: crm.compensation.offerStatus,
        });
      }
      return entries;
    })
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}
