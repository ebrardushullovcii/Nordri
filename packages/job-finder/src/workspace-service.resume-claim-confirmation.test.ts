import type {
  JobFinderSetResumeClaimConfirmationInput,
  ResumeClaimAssessment,
} from "@nordri/contracts";
import {
  buildResumeIssueApprovalContentHash,
  isBlockingResumeClaimAssessment,
  resumeClaimOwnershipStatement,
} from "@nordri/contracts";
import { describe, expect, test } from "vitest";
import {
  createAiClient,
  fakeResumeClaimCheck,
} from "./workspace-service.test-runtimes";
import {
  createWorkspaceServiceHarness,
  createSeed,
} from "./workspace-service.test-support";
import type { JobFinderWorkspaceService } from "./internal/workspace-service-contracts";

// The model's fact check calls this generated claim a stretch, so the person
// confirms it (ADR 0041).
const WEAK_CLAIM_TEXT =
  "Championed resilient delivery improvements across organizations.";
// A metric the candidate evidence does not show: the fact check calls it
// unsupported, and only the person can approve it.
const UNSUPPORTED_CLAIM_TEXT =
  "Increased revenue by 340% within one quarter through delivery improvements.";
// Listing-asked technologies the profile does not show are stretches too.
const CLAIM_VERDICTS = {
  [WEAK_CLAIM_TEXT]: "stretch",
  [UNSUPPORTED_CLAIM_TEXT]: "unsupported",
  Terraform: "stretch",
  Kubernetes: "stretch",
  // A reworded stretch is checked again and is still a stretch.
  "Championed resilient delivery improvements across several organizations.":
    "stretch",
} as const;

function createClaimHarness(input: { bullets: readonly string[] }) {
  const seed = createSeed();
  const baseAiClient = createAiClient();

  return createWorkspaceServiceHarness({
    seed,
    aiClient: {
      ...baseAiClient,
      checkResumeClaims: fakeResumeClaimCheck(CLAIM_VERDICTS),
      async createResumeDraft(draftInput) {
        const base = await baseAiClient.createResumeDraft(draftInput);

        return {
          ...base,
          experienceEntries: base.experienceEntries.map((entry, index) =>
            index === 0 ? { ...entry, bullets: [...input.bullets] } : entry,
          ),
        };
      },
    },
  });
}

type ClaimHarness = ReturnType<typeof createClaimHarness>;
type AddClaimConfirmationInput = Extract<
  JobFinderSetResumeClaimConfirmationInput,
  { intent: "add" }
>;

function findConfirmNeededAssessment(
  workspace: Awaited<
    ReturnType<JobFinderWorkspaceService["getResumeWorkspace"]>
  >,
): ResumeClaimAssessment {
  const assessment = findOutstandingConfirmNeededAssessmentOrNull(workspace);

  if (!assessment) {
    throw new Error("Expected a confirm_needed claim assessment.");
  }

  return assessment;
}

/**
 * Validation always projects `confirm_needed` rows for weak generated claims —
 * confirmed or not, because statuses describe content while confirmations live
 * on the draft. Mirror the export gate's exact matcher so only rows without an
 * owning confirmation (same draft, locator, and normalized content hash) count
 * as still outstanding.
 */
function findOutstandingConfirmNeededAssessmentOrNull(
  workspace: Awaited<
    ReturnType<JobFinderWorkspaceService["getResumeWorkspace"]>
  >,
): ResumeClaimAssessment | null {
  const confirmations = workspace.draft.claimConfirmations;
  return (
    workspace.validation?.claimAssessments.find(
      (candidate) =>
        candidate.status === "confirm_needed" &&
        !confirmations.some(
          (confirmation) =>
            confirmation.draftId === workspace.draft.id &&
            confirmation.field === candidate.field &&
            confirmation.sectionId === candidate.sectionId &&
            confirmation.entryId === candidate.entryId &&
            confirmation.bulletId === candidate.bulletId &&
            confirmation.confirmedClaimContentHash === candidate.contentHash,
        ),
    ) ?? null
  );
}

/**
 * Confirms every outstanding `confirm_needed` row one exact command at a time,
 * always re-reading the monotonic draft revision between commands. Export can
 * only pass once nothing confirm-needed remains, independent of how many rows
 * the deterministic generation produced.
 */
async function confirmAllOutstandingClaims(
  harness: ClaimHarness,
): Promise<ResumeClaimAssessment[]> {
  const { workspaceService, repository } = harness;
  let workspace = await workspaceService.getResumeWorkspace("job_ready");
  const confirmed: ResumeClaimAssessment[] = [];

  for (;;) {
    const pending = findOutstandingConfirmNeededAssessmentOrNull(workspace);
    if (!pending) {
      break;
    }

    const stored = await repository.getResumeDraftByJobId("job_ready");
    if (!stored) {
      throw new Error("Expected the generated draft to persist.");
    }

    await workspaceService.setResumeClaimConfirmation(
      buildAddInput({
        draftUpdatedAt: stored.updatedAt,
        assessment: pending,
      }),
    );
    confirmed.push(pending);

    workspace = await workspaceService.getResumeWorkspace("job_ready");
    if (confirmed.length > 100) {
      throw new Error("Claim confirmations did not converge.");
    }
  }

  if (confirmed.length === 0) {
    throw new Error("Expected at least one confirm_needed claim assessment.");
  }

  return confirmed;
}

function buildAddInput(input: {
  jobId?: string;
  draftId?: string;
  draftUpdatedAt: string;
  assessment: ResumeClaimAssessment;
}): AddClaimConfirmationInput {
  return {
    intent: "add",
    jobId: input.jobId ?? "job_ready",
    draftId: input.draftId ?? "resume_draft_job_ready",
    expectedDraftUpdatedAt: input.draftUpdatedAt,
    field: input.assessment.field,
    sectionId: input.assessment.sectionId,
    entryId: input.assessment.entryId,
    bulletId: input.assessment.bulletId,
    confirmedClaimContentHash: input.assessment.contentHash,
    ownershipStatement: resumeClaimOwnershipStatement,
  };
}

describe("resume claim confirmation commands", () => {
  test("confirm_needed blocks export until exact confirmations land, then export and approval pass", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    // Fail fast if the deterministic generation produced no confirm_needed row.
    findConfirmNeededAssessment(
      await workspaceService.getResumeWorkspace("job_ready"),
    );
    const draftBefore = await repository.getResumeDraftByJobId("job_ready");

    await expect(workspaceService.exportResumePdf("job_ready")).rejects.toThrow(
      /still need your decision/i,
    );

    const confirmed = await confirmAllOutstandingClaims(harness);

    const confirmedDraft = await repository.getResumeDraftByJobId("job_ready");

    expect(confirmedDraft!.claimConfirmations).toHaveLength(confirmed.length);
    expect(confirmedDraft!.claimConfirmations[0]).toMatchObject({
      draftId: draftBefore!.id,
      field: confirmed[0]!.field,
      sectionId: confirmed[0]!.sectionId,
      entryId: confirmed[0]!.entryId,
      bulletId: confirmed[0]!.bulletId,
      confirmedClaimContentHash: confirmed[0]!.contentHash,
      ownershipStatement: resumeClaimOwnershipStatement,
    });
    expect(confirmedDraft!.updatedAt > draftBefore!.updatedAt).toBe(true);

    // Multi-reference v2 rows (exact/paraphrase) never blocked; once every
    // confirm_needed row is explicitly owned, the whole gate passes.
    const exported = await workspaceService.exportResumePdf("job_ready");
    const approved = await workspaceService.approveResume(
      "job_ready",
      exported.resumeExportArtifacts.find(
        (artifact) => artifact.jobId === "job_ready",
      )!.id,
    );

    expect(
      approved.resumeDrafts.find((draft) => draft.jobId === "job_ready"),
    ).toMatchObject({ status: "approved" });
  });

  test("the review queue says the resume has lines to decide until they are decided, so Apply never calls it ready", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService } = harness;

    await workspaceService.generateResume("job_ready");
    const before = await workspaceService.getWorkspaceSnapshot();
    const itemBefore = before.reviewQueue.find(
      (item) => item.jobId === "job_ready",
    );
    expect(itemBefore?.resumeLinesToDecide ?? 0).toBeGreaterThan(0);

    await confirmAllOutstandingClaims(harness);

    const after = await workspaceService.getWorkspaceSnapshot();
    const itemAfter = after.reviewQueue.find(
      (item) => item.jobId === "job_ready",
    );
    expect(itemAfter).toBeDefined();
    expect(itemAfter?.resumeLinesToDecide ?? 0).toBe(0);
  });

  test("rejects stale revisions, cross-draft ids, wrong hashes, unknown locators, and forged statements", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    const assessment = findConfirmNeededAssessment(
      await workspaceService.getResumeWorkspace("job_ready"),
    );
    const before = await repository.getResumeDraftByJobId("job_ready");
    const revisionsBefore = await repository.listResumeDraftRevisions(
      before!.id,
    );
    const validInput = buildAddInput({
      draftUpdatedAt: before!.updatedAt,
      assessment,
    });

    const mismatches: Array<[AddClaimConfirmationInput, RegExp]> = [
      [
        { ...validInput, expectedDraftUpdatedAt: "2026-03-20T09:00:00.000Z" },
        /changed before this claim confirmation/i,
      ],
      [
        { ...validInput, draftId: "resume_draft_other" },
        /Unable to find resume draft/i,
      ],
      [
        { ...validInput, jobId: "job_generating" },
        /Unable to find resume draft/i,
      ],
      [
        {
          ...validInput,
          confirmedClaimContentHash: assessment.contentHash.replace(/.$/, "0"),
        },
        /no longer projected|wording changed/i,
      ],
      [
        { ...validInput, bulletId: "experience_1_bullet_99" },
        /no longer projected|wording changed/i,
      ],
    ];

    for (const [input, pattern] of mismatches) {
      await expect(
        workspaceService.setResumeClaimConfirmation(input),
      ).rejects.toThrow(pattern);
    }

    // Forged ownership statements are rejected by the typed contract itself.
    await expect(
      workspaceService.setResumeClaimConfirmation({
        ...validInput,
        ownershipStatement: "I promise this is accurate." as never,
      }),
    ).rejects.toThrow();

    const after = await repository.getResumeDraftByJobId("job_ready");

    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect(after!.claimConfirmations).toEqual([]);
    expect(await repository.listResumeDraftRevisions(before!.id)).toHaveLength(
      revisionsBefore.length,
    );
  });

  test("duplicate adds are deterministic no-ops", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    const assessment = findConfirmNeededAssessment(
      await workspaceService.getResumeWorkspace("job_ready"),
    );

    await workspaceService.setResumeClaimConfirmation(
      buildAddInput({
        draftUpdatedAt: (await repository.getResumeDraftByJobId("job_ready"))!
          .updatedAt,
        assessment,
      }),
    );
    const afterFirst = await repository.getResumeDraftByJobId("job_ready");

    await workspaceService.setResumeClaimConfirmation(
      buildAddInput({
        draftUpdatedAt: afterFirst!.updatedAt,
        assessment,
      }),
    );
    const afterSecond = await repository.getResumeDraftByJobId("job_ready");

    expect(afterSecond!.claimConfirmations).toHaveLength(
      afterFirst!.claimConfirmations.length,
    );
    expect(afterSecond!.claimConfirmations[0]!.id).toBe(
      afterFirst!.claimConfirmations[0]!.id,
    );
    expect(afterSecond!.updatedAt).toBe(afterFirst!.updatedAt);
  });

  test("unsupported claims can be approved by the person, bound to the exact wording", async () => {
    const harness = createClaimHarness({ bullets: [UNSUPPORTED_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    const unsupported = workspace.validation?.claimAssessments.find(
      (candidate) =>
        candidate.status === "unsupported" && candidate.bulletId !== null,
    );

    if (!unsupported) {
      throw new Error("Expected an unsupported generated claim assessment.");
    }

    // It is the person's resume: the product names the conflict, and their
    // approval ends the block instead of forcing a rewrite.
    await workspaceService.setResumeClaimConfirmation(
      buildAddInput({
        draftUpdatedAt: workspace.draft.updatedAt,
        assessment: unsupported,
      }),
    );

    const draft = (await repository.getResumeDraftByJobId("job_ready"))!;
    expect(draft.claimConfirmations).toHaveLength(1);
    expect(draft.claimConfirmations[0]?.confirmedClaimContentHash).toBe(
      unsupported.contentHash,
    );
    const after = await workspaceService.getResumeWorkspace("job_ready");
    expect(
      after.validation?.issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.category === "unsupported_claim" &&
          issue.bulletId === unsupported.bulletId,
      ),
    ).toBe(false);

    // The invented-metric note on the same line is a separate blocker with
    // its own approval, bound to the flagged wording.
    const metricIssue = after.validation?.issues.find(
      (issue) =>
        issue.severity === "error" && issue.bulletId === unsupported.bulletId,
    );
    if (metricIssue) {
      await workspaceService.setResumeClaimConfirmation({
        intent: "approve_issue",
        jobId: "job_ready",
        draftId: after.draft.id,
        expectedDraftUpdatedAt: after.draft.updatedAt,
        issueId: metricIssue.id,
        approvedContentHash: buildResumeIssueApprovalContentHash(metricIssue),
      });
      const approved = await workspaceService.getResumeWorkspace("job_ready");
      expect(approved.draft.issueApprovals).toHaveLength(1);
      expect(
        approved.validation?.issues.some(
          (issue) =>
            issue.severity === "error" &&
            issue.bulletId === unsupported.bulletId,
        ),
      ).toBe(false);
      expect(
        approved.validation?.issues.find((issue) => issue.id === metricIssue.id)
          ?.message,
      ).toMatch(/^You approved this as accurate\. /);
    }
  });

  test("one Approve as accurate on a line's note also settles that line's claim", async () => {
    const harness = createClaimHarness({ bullets: [UNSUPPORTED_CLAIM_TEXT] });
    const { workspaceService } = harness;

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    const unsupported = workspace.validation?.claimAssessments.find(
      (candidate) =>
        candidate.status === "unsupported" && candidate.bulletId !== null,
    );
    if (!unsupported) {
      throw new Error("Expected an unsupported generated claim assessment.");
    }
    const lineIssue = workspace.validation?.issues.find(
      (issue) =>
        issue.severity === "error" && issue.bulletId === unsupported.bulletId,
    );
    if (!lineIssue) {
      throw new Error("Expected a blocking note on the unsupported line.");
    }

    await workspaceService.setResumeClaimConfirmation({
      intent: "approve_issue",
      jobId: "job_ready",
      draftId: workspace.draft.id,
      expectedDraftUpdatedAt: workspace.draft.updatedAt,
      issueId: lineIssue.id,
      approvedContentHash: buildResumeIssueApprovalContentHash(lineIssue),
    });

    const after = await workspaceService.getResumeWorkspace("job_ready");
    expect(
      after.draft.claimConfirmations.some(
        (confirmation) =>
          confirmation.bulletId === unsupported.bulletId &&
          confirmation.confirmedClaimContentHash === unsupported.contentHash,
      ),
    ).toBe(true);
    expect(
      after.validation?.claimAssessments.some((assessment) =>
        isBlockingResumeClaimAssessment({ assessment, draft: after.draft }),
      ),
    ).toBe(false);
    expect(
      after.validation?.issues.some((issue) => issue.severity === "error"),
    ).toBe(false);
  });

  test("normalization-only edits cannot escape gating while substantive edits re-block", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    const assessment = findConfirmNeededAssessment(
      await workspaceService.getResumeWorkspace("job_ready"),
    );

    // A whitespace/punctuation-only user rewrite keeps the generated origin,
    // so the unconfirmed claim still blocks export. Case-only rewrites are
    // deliberately avoided here: mid-sentence capital letters change which
    // tokens the classifier treats as evidence-required named words, which is
    // a substantive classification change rather than a normalization no-op.
    await workspaceService.applyResumePatch({
      id: "patch_normalization_only",
      draftId: "resume_draft_job_ready",
      operation: "update_bullet",
      targetSectionId: assessment.sectionId,
      targetEntryId: assessment.entryId,
      anchorEntryId: null,
      targetBulletId: assessment.bulletId,
      anchorBulletId: null,
      position: null,
      newText: `  ${WEAK_CLAIM_TEXT.replace(/\.$/, "")} `,
      newIncluded: null,
      newLocked: null,
      newBullets: null,
      appliedAt: "2026-03-20T10:06:00.000Z",
      origin: "user",
      conflictReason: null,
    });

    await expect(workspaceService.exportResumePdf("job_ready")).rejects.toThrow(
      /still need your decision/i,
    );

    // An exact confirmation of the current wording unblocks everything.
    await confirmAllOutstandingClaims(harness);
    const reExported = await workspaceService.exportResumePdf("job_ready");
    const approved = await workspaceService.approveResume(
      "job_ready",
      reExported.resumeExportArtifacts.find(
        (artifact) => artifact.jobId === "job_ready",
      )!.id,
    );
    expect(
      approved.resumeDrafts.find((entry) => entry.jobId === "job_ready"),
    ).toMatchObject({ status: "approved" });

    // A substantive assistant rewrite stays generated-class but produces a
    // new normalized content hash, so the historical confirmation no longer
    // matches and export blocks again.
    const confirmationsBeforeEdit = (await repository.getResumeDraftByJobId(
      "job_ready",
    ))!.claimConfirmations.length;

    await workspaceService.applyResumePatch({
      id: "patch_substantive_rewrite",
      draftId: "resume_draft_job_ready",
      operation: "update_bullet",
      targetSectionId: assessment.sectionId,
      targetEntryId: assessment.entryId,
      anchorEntryId: null,
      targetBulletId: assessment.bulletId,
      anchorBulletId: null,
      position: null,
      newText:
        "Championed resilient delivery improvements across several organizations.",
      newIncluded: null,
      newLocked: null,
      newBullets: null,
      appliedAt: "2026-03-20T10:07:00.000Z",
      origin: "assistant",
      conflictReason: null,
    });

    const editedDraft = await repository.getResumeDraftByJobId("job_ready");

    expect(editedDraft!.status).toBe("stale");
    expect(editedDraft!.approvedAt).toBeNull();
    expect(editedDraft!.claimConfirmations).toHaveLength(
      confirmationsBeforeEdit,
    );

    await expect(workspaceService.exportResumePdf("job_ready")).rejects.toThrow(
      /still need your decision/i,
    );
  });

  test("removing confirmations stales approval and re-blocks export", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;

    await workspaceService.generateResume("job_ready");
    await confirmAllOutstandingClaims(harness);

    const exported = await workspaceService.exportResumePdf("job_ready");
    const approved = await workspaceService.approveResume(
      "job_ready",
      exported.resumeExportArtifacts.find(
        (artifact) => artifact.jobId === "job_ready",
      )!.id,
    );

    expect(
      approved.resumeDrafts.find((draft) => draft.jobId === "job_ready"),
    ).toMatchObject({ status: "approved" });

    const approvedDraft = await repository.getResumeDraftByJobId("job_ready");
    const confirmationIds = approvedDraft!.claimConfirmations.map(
      (confirmation) => confirmation.id,
    );

    await expect(
      workspaceService.setResumeClaimConfirmation({
        intent: "remove",
        jobId: "job_ready",
        draftId: approvedDraft!.id,
        expectedDraftUpdatedAt: "2026-03-20T09:00:00.000Z",
        confirmationId: confirmationIds[0]!,
      }),
    ).rejects.toThrow(/changed before this claim confirmation/i);

    // Removing any one confirmation invalidates the approval whose eligibility
    // depended on it.
    for (const confirmationId of confirmationIds) {
      const current = await repository.getResumeDraftByJobId("job_ready");
      await workspaceService.setResumeClaimConfirmation({
        intent: "remove",
        jobId: "job_ready",
        draftId: current!.id,
        expectedDraftUpdatedAt: current!.updatedAt,
        confirmationId,
      });
    }

    const removedDraft = await repository.getResumeDraftByJobId("job_ready");

    expect(removedDraft).toMatchObject({
      status: "stale",
      approvedAt: null,
      approvedExportId: null,
    });
    expect(removedDraft!.claimConfirmations).toEqual([]);

    await expect(
      workspaceService.setResumeClaimConfirmation({
        intent: "remove",
        jobId: "job_ready",
        draftId: approvedDraft!.id,
        expectedDraftUpdatedAt: removedDraft!.updatedAt,
        confirmationId: confirmationIds[0]!,
      }),
    ).rejects.toThrow(/Unable to find resume claim confirmation/i);

    // Without the confirmations the fresh export blocks again.
    await expect(workspaceService.exportResumePdf("job_ready")).rejects.toThrow(
      /still need your decision/i,
    );
  });

  test("add_many confirms listing-asked skills in one draft mutation", async () => {
    const skills = ["Terraform", "Kubernetes"] as const;
    const seed = createSeed();
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_ready"
        ? {
            ...job,
            minimumQualifications: [
              ...job.minimumQualifications,
              `Hands-on experience with ${skills.join(" and ")}.`,
            ],
          }
        : job,
    );
    const baseAiClient = createAiClient();
    const { workspaceService, repository } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        checkResumeClaims: fakeResumeClaimCheck(CLAIM_VERDICTS),
        async createResumeDraft(draftInput) {
          const base = await baseAiClient.createResumeDraft(draftInput);
          return {
            ...base,
            coreSkills: [...base.coreSkills, ...skills],
          };
        },
      },
    });

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    const skillAssessments = (
      workspace.validation?.claimAssessments ?? []
    ).filter(
      (assessment) =>
        assessment.status === "confirm_needed" &&
        assessment.field === "section_bullet" &&
        skills.some((skill) => assessment.claimText === skill),
    );
    expect(skillAssessments).toHaveLength(2);

    const stored = await repository.getResumeDraftByJobId("job_ready");
    await workspaceService.setResumeClaimConfirmation({
      intent: "add_many",
      jobId: "job_ready",
      draftId: stored!.id,
      expectedDraftUpdatedAt: stored!.updatedAt,
      ownershipStatement: resumeClaimOwnershipStatement,
      targets: skillAssessments.map((assessment) => ({
        field: assessment.field,
        sectionId: assessment.sectionId,
        entryId: assessment.entryId,
        bulletId: assessment.bulletId,
        confirmedClaimContentHash: assessment.contentHash,
      })),
    });

    const after = await repository.getResumeDraftByJobId("job_ready");
    expect(after!.claimConfirmations).toHaveLength(2);
    expect(
      after!.claimConfirmations.map(
        (confirmation) => confirmation.confirmedClaimContentHash,
      ),
    ).toEqual(
      expect.arrayContaining(
        skillAssessments.map((assessment) => assessment.contentHash),
      ),
    );
  });

  test("add_many rejects a mixed batch that includes a non-skill stretch", async () => {
    const harness = createClaimHarness({ bullets: [WEAK_CLAIM_TEXT] });
    const { workspaceService, repository } = harness;
    await workspaceService.generateResume("job_ready");
    const assessment = findConfirmNeededAssessment(
      await workspaceService.getResumeWorkspace("job_ready"),
    );
    const stored = await repository.getResumeDraftByJobId("job_ready");

    await expect(
      workspaceService.setResumeClaimConfirmation({
        intent: "add_many",
        jobId: "job_ready",
        draftId: stored!.id,
        expectedDraftUpdatedAt: stored!.updatedAt,
        ownershipStatement: resumeClaimOwnershipStatement,
        targets: [
          {
            field: assessment.field,
            sectionId: assessment.sectionId,
            entryId: assessment.entryId,
            bulletId: assessment.bulletId,
            confirmedClaimContentHash: assessment.contentHash,
          },
        ],
      }),
    ).rejects.toThrow(/Bulk confirmation is only for skills/i);

    expect(
      (await repository.getResumeDraftByJobId("job_ready"))!.claimConfirmations,
    ).toEqual([]);
  });

  test("add_many of listing skills still leaves wording stretches export-blocking", async () => {
    const skills = ["Terraform", "Kubernetes"] as const;
    const seed = createSeed();
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_ready"
        ? {
            ...job,
            minimumQualifications: [
              ...job.minimumQualifications,
              `Hands-on experience with ${skills.join(" and ")}.`,
            ],
          }
        : job,
    );
    const baseAiClient = createAiClient();
    const { workspaceService, repository } = createWorkspaceServiceHarness({
      seed,
      aiClient: {
        ...baseAiClient,
        checkResumeClaims: fakeResumeClaimCheck(CLAIM_VERDICTS),
        async createResumeDraft(draftInput) {
          const base = await baseAiClient.createResumeDraft(draftInput);
          return {
            ...base,
            coreSkills: [...base.coreSkills, ...skills],
            experienceEntries: base.experienceEntries.map((entry, index) =>
              index === 0 ? { ...entry, bullets: [WEAK_CLAIM_TEXT] } : entry,
            ),
          };
        },
      },
    });

    await workspaceService.generateResume("job_ready");
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    const skillAssessments = (
      workspace.validation?.claimAssessments ?? []
    ).filter(
      (assessment) =>
        assessment.status === "confirm_needed" &&
        assessment.field === "section_bullet" &&
        skills.some((skill) => assessment.claimText === skill),
    );
    const wordingAssessment = (
      workspace.validation?.claimAssessments ?? []
    ).find(
      (assessment) =>
        assessment.status === "confirm_needed" &&
        assessment.claimText === WEAK_CLAIM_TEXT,
    );
    expect(skillAssessments).toHaveLength(2);
    expect(wordingAssessment).toBeTruthy();

    const stored = await repository.getResumeDraftByJobId("job_ready");
    await workspaceService.setResumeClaimConfirmation({
      intent: "add_many",
      jobId: "job_ready",
      draftId: stored!.id,
      expectedDraftUpdatedAt: stored!.updatedAt,
      ownershipStatement: resumeClaimOwnershipStatement,
      targets: skillAssessments.map((assessment) => ({
        field: assessment.field,
        sectionId: assessment.sectionId,
        entryId: assessment.entryId,
        bulletId: assessment.bulletId,
        confirmedClaimContentHash: assessment.contentHash,
      })),
    });

    await expect(workspaceService.exportResumePdf("job_ready")).rejects.toThrow(
      /still need your decision/i,
    );
    const after = await workspaceService.getResumeWorkspace("job_ready");
    expect(
      after.validation?.claimAssessments.some(
        (assessment) =>
          assessment.status === "confirm_needed" &&
          assessment.claimText === WEAK_CLAIM_TEXT,
      ),
    ).toBe(true);
  });
});
