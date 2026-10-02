import { z } from "zod";

import { IsoDateTimeSchema, NonEmptyStringSchema } from "./base";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const TRASH_GRACE_DAYS = 7;

function addDays(timestamp: string, days: number) {
  return new Date(
    new Date(timestamp).getTime() + days * DAY_IN_MILLISECONDS,
  ).toISOString();
}

export const candidateAssetKindValues = [
  "resume",
  "cover_letter",
  "application_response",
  "portfolio",
  "work_sample",
  "transcript",
  "certificate",
  "image",
  "other",
] as const;
export const CandidateAssetKindSchema = z.enum(candidateAssetKindValues);
export type CandidateAssetKind = z.infer<typeof CandidateAssetKindSchema>;

export const candidateAssetSensitivityValues = [
  "standard",
  "sensitive",
  "highly_sensitive",
] as const;
export const CandidateAssetSensitivitySchema = z.enum(
  candidateAssetSensitivityValues,
);
export type CandidateAssetSensitivity = z.infer<
  typeof CandidateAssetSensitivitySchema
>;

export const candidateAssetConsentScopeValues = [
  "private_storage_only",
  "job_application_attachment",
  "assistant_context",
] as const;
export const CandidateAssetConsentScopeSchema = z.enum(
  candidateAssetConsentScopeValues,
);
export type CandidateAssetConsentScope = z.infer<
  typeof CandidateAssetConsentScopeSchema
>;

export const candidateAssetRetentionValues = [
  "until_deleted",
  "30_days",
  "90_days",
] as const;
export const CandidateAssetRetentionSchema = z.enum(
  candidateAssetRetentionValues,
);
export type CandidateAssetRetention = z.infer<
  typeof CandidateAssetRetentionSchema
>;

export const candidateAssetDeletionReasonValues = [
  "removed",
  "expired",
] as const;
export const CandidateAssetDeletionReasonSchema = z.enum(
  candidateAssetDeletionReasonValues,
);
export type CandidateAssetDeletionReason = z.infer<
  typeof CandidateAssetDeletionReasonSchema
>;

export const CandidateAssetLifecycleSchema = z.object({
  retentionStartedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  deletionReason: CandidateAssetDeletionReasonSchema.nullable(),
  purgeAt: IsoDateTimeSchema.nullable(),
});
export type CandidateAssetLifecycle = z.infer<
  typeof CandidateAssetLifecycleSchema
>;

export const CandidateAssetExtractedTextMetadataSchema = z.object({
  status: z.enum(["not_requested", "ready", "failed"]),
  characterCount: z.number().int().nonnegative(),
  language: NonEmptyStringSchema.nullable().default(null),
  extractedAt: IsoDateTimeSchema.nullable().default(null),
});
export type CandidateAssetExtractedTextMetadata = z.infer<
  typeof CandidateAssetExtractedTextMetadataSchema
>;

/**
 * The one job a generated document was written for. A letter written for one
 * job is never attached to another job's application.
 */
export const CandidateAssetJobScopeSchema = z.object({
  jobId: NonEmptyStringSchema,
  title: z.string().max(300),
  company: z.string().max(300),
});
export type CandidateAssetJobScope = z.infer<
  typeof CandidateAssetJobScopeSchema
>;

export const CandidateAssetSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: CandidateAssetKindSchema,
    originalName: NonEmptyStringSchema.max(255),
    mime: NonEmptyStringSchema.max(160),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: IsoDateTimeSchema,
    sensitivity: CandidateAssetSensitivitySchema,
    consentScope: CandidateAssetConsentScopeSchema,
    retention: CandidateAssetRetentionSchema,
    deletedAt: IsoDateTimeSchema.nullable().default(null),
    lifecycle: CandidateAssetLifecycleSchema.optional(),
    extractedText:
      CandidateAssetExtractedTextMetadataSchema.nullable().default(null),
    forJob: CandidateAssetJobScopeSchema.nullable().default(null),
  })
  .superRefine((asset, context) => {
    if (!asset.lifecycle) return;

    const isTimed = asset.retention !== "until_deleted";
    const expectedExpiresAt = isTimed
      ? addDays(
          asset.lifecycle.retentionStartedAt,
          asset.retention === "30_days" ? 30 : 90,
        )
      : null;
    if (asset.lifecycle.expiresAt !== expectedExpiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Asset expiry must exactly match its retention clock and policy.",
        path: ["lifecycle", "expiresAt"],
      });
    }

    if (
      new Date(asset.lifecycle.retentionStartedAt).getTime() <
      new Date(asset.createdAt).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Asset retention cannot begin before the asset was created.",
        path: ["lifecycle", "retentionStartedAt"],
      });
    }

    const isTrashed = asset.deletedAt !== null;
    const hasAnyTrashMetadata =
      asset.lifecycle.deletionReason !== null ||
      asset.lifecycle.purgeAt !== null;
    const hasCompleteTrashMetadata =
      asset.lifecycle.deletionReason !== null &&
      asset.lifecycle.purgeAt !== null;
    if (
      (!isTrashed && hasAnyTrashMetadata) ||
      (isTrashed && !hasCompleteTrashMetadata)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Trashed assets require a deletion reason and purge date.",
        path: ["lifecycle"],
      });
    }

    if (!isTrashed || !hasCompleteTrashMetadata) return;

    const deletedAt = asset.deletedAt;
    const purgeAt = asset.lifecycle.purgeAt;
    if (!deletedAt || !purgeAt) return;

    if (
      new Date(deletedAt).getTime() <
      new Date(asset.lifecycle.retentionStartedAt).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Asset deletion cannot precede its retention clock.",
        path: ["deletedAt"],
      });
    }

    if (purgeAt !== addDays(deletedAt, TRASH_GRACE_DAYS)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Asset purge must be scheduled exactly seven days after deletion.",
        path: ["lifecycle", "purgeAt"],
      });
    }

    if (asset.lifecycle.deletionReason === "expired") {
      if (!isTimed || asset.lifecycle.expiresAt !== deletedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Only timed assets can expire at their exact expiry timestamp.",
          path: ["lifecycle", "deletionReason"],
        });
      }
      return;
    }

    if (
      isTimed &&
      asset.lifecycle.expiresAt !== null &&
      new Date(deletedAt).getTime() >=
        new Date(asset.lifecycle.expiresAt).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A manually removed timed asset must be removed before expiry.",
        path: ["deletedAt"],
      });
    }
  });
export type CandidateAsset = z.infer<typeof CandidateAssetSchema>;

export const CandidateAssetImportInputSchema = z.object({
  kind: CandidateAssetKindSchema,
  sensitivity: CandidateAssetSensitivitySchema.default("sensitive"),
  consentScope: CandidateAssetConsentScopeSchema.default(
    "private_storage_only",
  ),
  retention: CandidateAssetRetentionSchema.default("until_deleted"),
  forJob: CandidateAssetJobScopeSchema.nullable().default(null),
});
// Callers may omit defaulted fields; the library parses the input.
export type CandidateAssetImportInput = z.input<
  typeof CandidateAssetImportInputSchema
>;
export type ParsedCandidateAssetImportInput = z.infer<
  typeof CandidateAssetImportInputSchema
>;

export const CandidateAssetImportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled") }),
  z.object({ status: z.literal("imported"), asset: CandidateAssetSchema }),
]);
export type CandidateAssetImportResult = z.infer<
  typeof CandidateAssetImportResultSchema
>;

export const CandidateAssetListInputSchema = z
  .object({ includeDeleted: z.boolean().default(false) })
  .default({});
export type CandidateAssetListInput = z.infer<
  typeof CandidateAssetListInputSchema
>;

export const CandidateAssetListResultSchema = z.object({
  assets: z.array(CandidateAssetSchema),
});
export type CandidateAssetListResult = z.infer<
  typeof CandidateAssetListResultSchema
>;

export const CandidateAssetDeleteInputSchema = z.object({
  assetId: NonEmptyStringSchema,
});
export type CandidateAssetDeleteInput = z.infer<
  typeof CandidateAssetDeleteInputSchema
>;

export const CandidateAssetDeleteResultSchema = z.object({
  asset: CandidateAssetSchema,
});
export type CandidateAssetDeleteResult = z.infer<
  typeof CandidateAssetDeleteResultSchema
>;

export const CandidateAssetRestoreInputSchema = z.object({
  assetId: NonEmptyStringSchema,
  retention: CandidateAssetRetentionSchema,
});
export type CandidateAssetRestoreInput = z.infer<
  typeof CandidateAssetRestoreInputSchema
>;

export const CandidateAssetRestoreResultSchema = z.object({
  asset: CandidateAssetSchema,
});
export type CandidateAssetRestoreResult = z.infer<
  typeof CandidateAssetRestoreResultSchema
>;

/** Opens a read-only copy of a saved file in the device's default app. */
export const CandidateAssetOpenInputSchema = z.object({
  assetId: NonEmptyStringSchema,
});
export type CandidateAssetOpenInput = z.infer<
  typeof CandidateAssetOpenInputSchema
>;

export const CandidateAssetOpenResultSchema = z.object({
  outcome: z.enum(["opened", "not_found", "failed"]),
});
export type CandidateAssetOpenResult = z.infer<
  typeof CandidateAssetOpenResultSchema
>;
