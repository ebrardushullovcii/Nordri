import { z } from "zod";

import {
  ApplicationAutomationModeSchema,
  ApplicationAuthorityStatusSchema,
  Sha256HexSchema,
} from "./application-authority";
import { IsoDateTimeSchema, NonEmptyStringSchema } from "./base";
import { CandidateAnswerKindSchema } from "./profile";

export const ApplicationAnswerSnapshotSummarySchema = z
  .object({
    id: NonEmptyStringSchema,
    revision: z.number().int().positive(),
    digest: Sha256HexSchema,
    sourceProfileRevision: z.number().int().positive(),
    approvedAt: IsoDateTimeSchema,
    entryCount: z.number().int().nonnegative(),
    kinds: z.array(CandidateAnswerKindSchema).max(10),
  })
  .strict();
export type ApplicationAnswerSnapshotSummary = z.infer<
  typeof ApplicationAnswerSnapshotSummarySchema
>;

export const CurrentApplicationAnswerSummarySchema = z
  .object({
    sourceProfileRevision: z.number().int().positive(),
    digest: Sha256HexSchema.nullable(),
    entryCount: z.number().int().nonnegative(),
    kinds: z.array(CandidateAnswerKindSchema).max(10),
    missingRequiredKinds: z.array(CandidateAnswerKindSchema).max(10),
  })
  .strict();
export type CurrentApplicationAnswerSummary = z.infer<
  typeof CurrentApplicationAnswerSummarySchema
>;

export const ApplicationAuthorityReadinessBlockerSchema = z
  .object({
    code: z.enum([
      "no_reusable_answers",
      "required_answer_missing",
      "no_approved_answer_snapshot",
      "approved_answer_snapshot_stale",
      "elevated_execution_unavailable",
    ]),
    remediation: z.enum(["profile", "settings", "unavailable"]),
  })
  .strict();
export type ApplicationAuthorityReadinessBlocker = z.infer<
  typeof ApplicationAuthorityReadinessBlockerSchema
>;

export const ApplicationAuthorityReadinessSchema = z
  .object({
    generatedAt: IsoDateTimeSchema,
    executionCapability: z.literal("prepare_only"),
    elevatedExecutionAvailable: z.literal(false),
    answerApprovalStatus: z.enum([
      "missing_answers",
      "not_approved",
      "stale",
      "current",
    ]),
    currentAnswers: CurrentApplicationAnswerSummarySchema,
    approvedSnapshot: ApplicationAnswerSnapshotSummarySchema.nullable(),
    activeAuthority: z
      .object({
        id: NonEmptyStringSchema,
        revision: z.number().int().positive(),
        status: ApplicationAuthorityStatusSchema,
        mode: ApplicationAutomationModeSchema,
      })
      .strict()
      .nullable(),
    blockers: z.array(ApplicationAuthorityReadinessBlockerSchema).max(10),
  })
  .strict();
export type ApplicationAuthorityReadiness = z.infer<
  typeof ApplicationAuthorityReadinessSchema
>;

export const GetApplicationAuthorityReadinessInputSchema = z
  .object({})
  .strict();
export type GetApplicationAuthorityReadinessInput = z.infer<
  typeof GetApplicationAuthorityReadinessInputSchema
>;

/** Main rereads the profile and owns the content, digest, lifecycle, and time. */
export const ApproveCurrentApplicationAnswersInputSchema = z
  .object({
    expectedProfileRevision: z.number().int().positive(),
    confirmedCurrentAnswers: z.literal(true),
  })
  .strict();
export type ApproveCurrentApplicationAnswersInput = z.infer<
  typeof ApproveCurrentApplicationAnswersInputSchema
>;

export const ApproveCurrentApplicationAnswersResultSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.enum(["created", "duplicate"]),
        snapshot: ApplicationAnswerSnapshotSummarySchema,
        readiness: ApplicationAuthorityReadinessSchema,
      })
      .strict(),
    z
      .object({
        status: z.enum(["stale", "blocked"]),
        snapshot: ApplicationAnswerSnapshotSummarySchema.nullable(),
        readiness: ApplicationAuthorityReadinessSchema,
      })
      .strict(),
  ]);
export type ApproveCurrentApplicationAnswersResult = z.infer<
  typeof ApproveCurrentApplicationAnswersResultSchema
>;
