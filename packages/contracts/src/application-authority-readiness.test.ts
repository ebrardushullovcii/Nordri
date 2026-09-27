import { describe, expect, it } from "vitest";

import {
  ApplicationAuthorityReadinessSchema,
  ApplicationAnswerSnapshotSummarySchema,
  ApproveCurrentApplicationAnswersInputSchema,
} from "./index";

const readiness = {
  generatedAt: "2026-08-28T10:00:00.000Z",
  executionCapability: "prepare_only" as const,
  elevatedExecutionAvailable: false as const,
  answerApprovalStatus: "not_approved" as const,
  currentAnswers: {
    sourceProfileRevision: 4,
    digest: "a".repeat(64),
    entryCount: 2,
    kinds: ["work_authorization", "visa_sponsorship"] as const,
    missingRequiredKinds: [],
  },
  approvedSnapshot: null,
  activeAuthority: null,
  blockers: [
    {
      code: "no_approved_answer_snapshot" as const,
      remediation: "settings" as const,
    },
    {
      code: "elevated_execution_unavailable" as const,
      remediation: "unavailable" as const,
    },
  ],
};

describe("application authority readiness", () => {
  it("accepts an approved empty answer snapshot while rejecting negative counts", () => {
    const approvedSnapshot = {
      id: "answer_snapshot_empty",
      revision: 1,
      digest: "b".repeat(64),
      sourceProfileRevision: 4,
      approvedAt: readiness.generatedAt,
      entryCount: 0,
      kinds: [],
    };
    expect(
      ApplicationAuthorityReadinessSchema.parse({
        ...readiness,
        approvedSnapshot,
        currentAnswers: {
          ...readiness.currentAnswers,
          entryCount: 0,
          kinds: [],
        },
      }).approvedSnapshot?.entryCount,
    ).toBe(0);
    expect(
      ApplicationAnswerSnapshotSummarySchema.safeParse({
        ...approvedSnapshot,
        entryCount: -1,
      }).success,
    ).toBe(false);
  });

  it("exposes content-free answer identity and an explicit prepare-only ceiling", () => {
    const parsed = ApplicationAuthorityReadinessSchema.parse(readiness);
    expect(parsed.executionCapability).toBe("prepare_only");
    expect(JSON.stringify(parsed)).not.toContain("authorized to work");
  });

  it("rejects raw answers and future execution claims", () => {
    expect(
      ApplicationAuthorityReadinessSchema.safeParse({
        ...readiness,
        currentAnswers: {
          ...readiness.currentAnswers,
          answers: ["Yes"],
        },
      }).success,
    ).toBe(false);
    expect(
      ApplicationAuthorityReadinessSchema.safeParse({
        ...readiness,
        executionCapability: "autonomous_submit",
        elevatedExecutionAvailable: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only a revision-bound explicit approval confirmation", () => {
    expect(
      ApproveCurrentApplicationAnswersInputSchema.parse({
        expectedProfileRevision: 4,
        confirmedCurrentAnswers: true,
      }),
    ).toEqual({
      expectedProfileRevision: 4,
      confirmedCurrentAnswers: true,
    });
    expect(
      ApproveCurrentApplicationAnswersInputSchema.safeParse({
        expectedProfileRevision: 4,
        confirmedCurrentAnswers: true,
        digest: "a".repeat(64),
        answers: ["renderer-owned"],
      }).success,
    ).toBe(false);
  });
});
