import { z } from "zod";

import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UrlStringSchema,
} from "./base";

export const applicationCrmStageValues = [
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
] as const;

export const ApplicationCrmStageSchema = z.enum(applicationCrmStageValues);
export type ApplicationCrmStage = z.infer<typeof ApplicationCrmStageSchema>;

export const ApplicationCrmStageDefinitionSchema = z.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  baseStage: ApplicationCrmStageSchema,
  color: z
    .enum(["neutral", "blue", "cyan", "green", "amber", "red", "violet"])
    .default("neutral"),
  position: z.number().int().nonnegative(),
  isTerminal: z.boolean().default(false),
});
export type ApplicationCrmStageDefinition = z.infer<
  typeof ApplicationCrmStageDefinitionSchema
>;

export const ApplicationCrmEventSchema = z.object({
  id: NonEmptyStringSchema,
  at: IsoDateTimeSchema,
  kind: z.enum([
    "created",
    "stage_changed",
    "tags_changed",
    "note_changed",
    "reminder_changed",
    "interview_changed",
    "contact_changed",
    "attachment_changed",
    "compensation_changed",
    "automation",
    "application_prepare",
  ]),
  title: NonEmptyStringSchema,
  detail: NonEmptyStringSchema.nullable().default(null),
  fromStage: ApplicationCrmStageSchema.nullable().default(null),
  toStage: ApplicationCrmStageSchema.nullable().default(null),
  source: z.enum([
    "user",
    "assistant",
    "automation",
    "application_prepare",
    "system",
  ]),
});
export type ApplicationCrmEvent = z.infer<typeof ApplicationCrmEventSchema>;

export const ApplicationCrmContactSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  role: NonEmptyStringSchema.nullable().default(null),
  email: z.string().trim().email().nullable().default(null),
  phone: NonEmptyStringSchema.nullable().default(null),
  profileUrl: UrlStringSchema.nullable().default(null),
  notes: NonEmptyStringSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ApplicationCrmContact = z.infer<typeof ApplicationCrmContactSchema>;

export const ApplicationCrmReminderSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  dueAt: IsoDateTimeSchema,
  status: z.enum(["pending", "completed", "dismissed"]).default("pending"),
  note: NonEmptyStringSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable().default(null),
});
export type ApplicationCrmReminder = z.infer<
  typeof ApplicationCrmReminderSchema
>;

export const ApplicationCrmInterviewSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema.nullable().default(null),
  timeZone: NonEmptyStringSchema.nullable().default(null),
  location: NonEmptyStringSchema.nullable().default(null),
  meetingUrl: UrlStringSchema.nullable().default(null),
  contactIds: z.array(NonEmptyStringSchema).default([]),
  status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled"),
  notes: NonEmptyStringSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ApplicationCrmInterview = z.infer<
  typeof ApplicationCrmInterviewSchema
>;

export const ApplicationCrmNoteSchema = z.object({
  id: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ApplicationCrmNote = z.infer<typeof ApplicationCrmNoteSchema>;

export const ApplicationCrmAttachmentSchema = z.object({
  id: NonEmptyStringSchema,
  candidateAssetId: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  kind: z.enum([
    "resume",
    "cover_letter",
    "portfolio",
    "work_sample",
    "assessment",
    "offer",
    "other",
  ]),
  addedAt: IsoDateTimeSchema,
});
export type ApplicationCrmAttachment = z.infer<
  typeof ApplicationCrmAttachmentSchema
>;

export const ApplicationCrmMoneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/u),
  period: z.enum(["hour", "month", "year"]),
});
export type ApplicationCrmMoney = z.infer<typeof ApplicationCrmMoneySchema>;

export const ApplicationCrmCompensationSchema = z.object({
  listedMinimum: ApplicationCrmMoneySchema.nullable().default(null),
  listedMaximum: ApplicationCrmMoneySchema.nullable().default(null),
  expectedMinimum: ApplicationCrmMoneySchema.nullable().default(null),
  expectedMaximum: ApplicationCrmMoneySchema.nullable().default(null),
  offerBase: ApplicationCrmMoneySchema.nullable().default(null),
  offerBonus: ApplicationCrmMoneySchema.nullable().default(null),
  offerEquity: NonEmptyStringSchema.nullable().default(null),
  offerBenefits: z.array(NonEmptyStringSchema).default([]),
  offerDeadlineAt: IsoDateTimeSchema.nullable().default(null),
  offerStatus: z
    .enum(["none", "active", "accepted", "declined", "expired"])
    .default("none"),
  notes: NonEmptyStringSchema.nullable().default(null),
});
export type ApplicationCrmCompensation = z.infer<
  typeof ApplicationCrmCompensationSchema
>;

export const ApplicationCrmDataSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  stage: ApplicationCrmStageSchema,
  stageSource: z.enum(["activity", "user"]).optional(),
  customStageId: NonEmptyStringSchema.nullable().default(null),
  stageChangedAt: IsoDateTimeSchema,
  tags: z.array(NonEmptyStringSchema).max(50).default([]),
  events: z.array(ApplicationCrmEventSchema).default([]),
  contacts: z.array(ApplicationCrmContactSchema).default([]),
  reminders: z.array(ApplicationCrmReminderSchema).default([]),
  interviews: z.array(ApplicationCrmInterviewSchema).default([]),
  notes: z.array(ApplicationCrmNoteSchema).default([]),
  attachments: z.array(ApplicationCrmAttachmentSchema).default([]),
  compensation: ApplicationCrmCompensationSchema.default({}),
  lastEmployerActivityAt: IsoDateTimeSchema.nullable().default(null),
  appliedAt: IsoDateTimeSchema.nullable().default(null),
});
export type ApplicationCrmData = z.infer<typeof ApplicationCrmDataSchema>;

const metadataEventKinds: ReadonlySet<ApplicationCrmEvent["kind"]> = new Set([
  "tags_changed",
  "note_changed",
  "reminder_changed",
  "interview_changed",
  "contact_changed",
  "attachment_changed",
  "compensation_changed",
]);

/** Old payloads did not distinguish stage choices from tracking metadata. */
export function resolveApplicationCrmStageSource(
  crm: ApplicationCrmData | null | undefined,
): "activity" | "user" {
  if (!crm) return "activity";
  if (crm.stageSource) return crm.stageSource;
  if (crm.customStageId) return "user";
  // Only a complete metadata-only history proves that nobody chose a stage.
  // Missing or truncated history keeps the stored stage to protect old choices.
  return crm.revision > 0 &&
    crm.revision === crm.events.length &&
    crm.events.every(
      (event) =>
        (metadataEventKinds.has(event.kind) &&
          !event.fromStage &&
          !event.toStage) ||
        (event.kind === "automation" &&
          event.source === "automation" &&
          event.fromStage === "applied" &&
          event.toStage === "no_response"),
    )
    ? "activity"
    : "user";
}

/** Stages an application only reaches after it was sent. */
export const APPLICATION_CRM_STAGES_AFTER_SENDING: ReadonlySet<ApplicationCrmStage> =
  new Set<ApplicationCrmStage>([
    "applied",
    "employer_viewed",
    "recruiter_contact",
    "assessment",
    "interview",
    "offer",
    "rejected",
    "no_response",
  ]);

/**
 * The person (not activity) recorded a stage that comes after sending: they
 * sent it themselves, outside Job Finder. This is their word, not the site's
 * confirmation, so it is never shown as a verified submission (N-033), but
 * nothing offers to fill the application in again.
 */
export function isApplicationTrackedAsSentByPerson(
  crm: ApplicationCrmData | null | undefined,
): boolean {
  return (
    crm != null &&
    resolveApplicationCrmStageSource(crm) === "user" &&
    APPLICATION_CRM_STAGES_AFTER_SENDING.has(crm.stage)
  );
}

/**
 * The person marked the application withdrawn. That can come before or after
 * sending, so it says nothing about a send; it only means they stopped.
 */
export function isApplicationWithdrawnByPerson(
  crm: ApplicationCrmData | null | undefined,
): boolean {
  return (
    crm != null &&
    resolveApplicationCrmStageSource(crm) === "user" &&
    crm.stage === "withdrawn"
  );
}

export function resolveApplicationCrmTrackedStage(
  crm: ApplicationCrmData | null | undefined,
  activityStage: ApplicationCrmStage,
): ApplicationCrmStage {
  if (!crm) return activityStage;
  if (resolveApplicationCrmStageSource(crm) === "user") return crm.stage;
  // The configured follow-up automation remains useful while waiting for a
  // response, but an actual interview/offer/etc. must move the tracker on.
  if (crm.stage === "no_response" && activityStage === "applied") {
    const lastStageEvent = [...crm.events]
      .reverse()
      .find((event) => event.toStage);
    if (
      lastStageEvent?.source === "automation" &&
      lastStageEvent.toStage === "no_response"
    ) {
      return "no_response";
    }
  }
  return activityStage;
}

export const ApplicationCrmSettingsSchema = z.object({
  noResponseAutomation: z
    .object({
      enabled: z.boolean().default(true),
      afterDays: z.number().int().min(1).max(365).default(14),
    })
    .default({}),
  customStages: z.array(ApplicationCrmStageDefinitionSchema).default([]),
});
export type ApplicationCrmSettings = z.infer<
  typeof ApplicationCrmSettingsSchema
>;

export const ApplicationCrmMutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_stage"),
    stage: ApplicationCrmStageSchema,
    customStageId: NonEmptyStringSchema.nullable().default(null),
    note: NonEmptyStringSchema.nullable().default(null),
  }),
  z.object({
    type: z.literal("set_tags"),
    tags: z.array(NonEmptyStringSchema).max(50),
  }),
  z.object({ type: z.literal("add_note"), note: ApplicationCrmNoteSchema }),
  z.object({ type: z.literal("remove_note"), noteId: NonEmptyStringSchema }),
  z.object({
    type: z.literal("upsert_contact"),
    contact: ApplicationCrmContactSchema,
  }),
  z.object({
    type: z.literal("remove_contact"),
    contactId: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("upsert_reminder"),
    reminder: ApplicationCrmReminderSchema,
  }),
  z.object({
    type: z.literal("remove_reminder"),
    reminderId: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("upsert_interview"),
    interview: ApplicationCrmInterviewSchema,
  }),
  z.object({
    type: z.literal("remove_interview"),
    interviewId: NonEmptyStringSchema,
  }),
  z.object({
    type: z.literal("set_compensation"),
    compensation: ApplicationCrmCompensationSchema,
  }),
  z.object({
    type: z.literal("add_attachment"),
    attachment: ApplicationCrmAttachmentSchema,
  }),
  z.object({
    type: z.literal("remove_attachment"),
    attachmentId: NonEmptyStringSchema,
  }),
]);
export type ApplicationCrmMutation = z.infer<
  typeof ApplicationCrmMutationSchema
>;

/** Who made a tracker change: the person, or the assistant for them. */
export const ApplicationCrmActorSchema = z
  .enum(["user", "assistant"])
  .optional();

export const ApplicationCrmMutationInputSchema = z.object({
  applicationRecordId: NonEmptyStringSchema,
  expectedRevision: z.number().int().nonnegative(),
  mutation: ApplicationCrmMutationSchema,
  actor: ApplicationCrmActorSchema,
});
export type ApplicationCrmMutationInput = z.infer<
  typeof ApplicationCrmMutationInputSchema
>;

export const ApplicationCrmBulkStageMutationItemSchema = z.object({
  applicationRecordId: NonEmptyStringSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type ApplicationCrmBulkStageMutationItem = z.infer<
  typeof ApplicationCrmBulkStageMutationItemSchema
>;

/**
 * A stage-only bulk command. Each selected record carries the revision that
 * was visible to the user so the entire command can be rejected as stale
 * without partially changing the CRM.
 */
export const ApplicationCrmBulkStageMutationInputSchema = z
  .object({
    items: ApplicationCrmBulkStageMutationItemSchema.array().min(1).max(1000),
    stage: ApplicationCrmStageSchema,
    customStageId: NonEmptyStringSchema.nullable().default(null),
    note: NonEmptyStringSchema.nullable().default(null),
    actor: ApplicationCrmActorSchema,
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, item] of input.items.entries()) {
      if (seen.has(item.applicationRecordId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each application record may appear only once.",
          path: ["items", index, "applicationRecordId"],
        });
      }
      seen.add(item.applicationRecordId);
    }
  });
export type ApplicationCrmBulkStageMutationInput = z.infer<
  typeof ApplicationCrmBulkStageMutationInputSchema
>;

export const ApplicationCrmDuplicateHintSchema = z.object({
  applicationRecordId: NonEmptyStringSchema,
  duplicateApplicationRecordId: NonEmptyStringSchema,
  kind: z.enum(["employer", "contact"]),
  reason: NonEmptyStringSchema,
});
export type ApplicationCrmDuplicateHint = z.infer<
  typeof ApplicationCrmDuplicateHintSchema
>;

export const ApplicationCrmCalendarEntrySchema = z.object({
  id: NonEmptyStringSchema,
  applicationRecordId: NonEmptyStringSchema,
  kind: z.enum(["reminder", "interview", "offer_deadline"]),
  title: NonEmptyStringSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema.nullable().default(null),
  status: NonEmptyStringSchema,
});
export type ApplicationCrmCalendarEntry = z.infer<
  typeof ApplicationCrmCalendarEntrySchema
>;

export const ApplicationCrmRecommendedActionSchema = z.object({
  applicationRecordId: NonEmptyStringSchema,
  kind: z.enum([
    "overdue_reminder",
    "upcoming_interview",
    "offer_deadline",
    "ready_for_approval",
    "follow_up",
    "review_application",
  ]),
  title: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
  dueAt: IsoDateTimeSchema.nullable().default(null),
});
export type ApplicationCrmRecommendedAction = z.infer<
  typeof ApplicationCrmRecommendedActionSchema
>;

export const ApplicationCrmExportFormatSchema = z.enum(["json", "csv"]);
export type ApplicationCrmExportFormat = z.infer<
  typeof ApplicationCrmExportFormatSchema
>;

export const ApplicationCrmExportInputSchema = z.object({
  format: ApplicationCrmExportFormatSchema,
  applicationRecordIds: z.array(NonEmptyStringSchema).default([]),
});
export type ApplicationCrmExportInput = z.infer<
  typeof ApplicationCrmExportInputSchema
>;

export const ApplicationCrmExportResultSchema = z.object({
  format: ApplicationCrmExportFormatSchema,
  fileName: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  content: NonEmptyStringSchema,
  exportedCount: z.number().int().nonnegative(),
});
export type ApplicationCrmExportResult = z.infer<
  typeof ApplicationCrmExportResultSchema
>;

export const ApplicationCrmFileExportResultSchema = z.object({
  status: z.enum(["saved", "cancelled"]),
  exportedCount: z.number().int().nonnegative(),
  filePath: NonEmptyStringSchema.nullable().default(null),
});
export type ApplicationCrmFileExportResult = z.infer<
  typeof ApplicationCrmFileExportResultSchema
>;

/**
 * The last-action label of an application the person asked to skip in a
 * batch. Screens show it as skipped, never as an application that failed.
 */
export const APPLICATION_SKIPPED_BY_PERSON_LABEL = "Skipped at your request.";
