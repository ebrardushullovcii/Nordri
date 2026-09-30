import { describe, expect, test } from "vitest";

import { createWorkspaceServiceHarness } from "./workspace-service.test-support";

async function approvedResumeHarness() {
  const harness = createWorkspaceServiceHarness();
  await harness.workspaceService.generateResume("job_ready");
  const exported = await harness.workspaceService.exportResumePdf("job_ready");
  const artifact = exported.resumeExportArtifacts.find(
    (entry) => entry.jobId === "job_ready",
  );
  expect(artifact).toBeDefined();
  await harness.workspaceService.approveResume("job_ready", artifact!.id);
  return harness;
}

describe("assistant profile edit resume invalidation", () => {
  test("reports an approval that the requested profile edit actually invalidated", async () => {
    const { workspaceService } = await approvedResumeHarness();
    const before = await workspaceService.getWorkspaceSnapshot();
    const result = await workspaceService.applyAssistantProfileOperations({
      operations: [
        {
          operation: "replace_identity_fields",
          value: { headline: "Senior Frontend Platform Engineer" },
        },
      ],
      summary: "Update headline",
      messageId: "synthetic_headline_instruction",
    });
    const after = await workspaceService.getWorkspaceSnapshot();

    expect(result.invalidatedApprovedResumeJobIds).toEqual(["job_ready"]);
    expect(
      after.resumeDrafts.find((draft) => draft.jobId === "job_ready"),
    ).toMatchObject({
      status: "stale",
      approvedAt: null,
      approvedExportId: null,
    });
    expect(
      after.resumeExportArtifacts.find((entry) => entry.jobId === "job_ready")
        ?.isApproved,
    ).toBe(false);
    expect(after.profile.experiences).toEqual(before.profile.experiences);

    const repeated = await workspaceService.applyAssistantProfileOperations({
      operations: [
        {
          operation: "replace_identity_fields",
          value: { headline: "Senior Frontend Platform Engineer" },
        },
      ],
      summary: "Keep the same headline",
      messageId: "synthetic_repeat_instruction",
    });
    expect(repeated.invalidatedApprovedResumeJobIds).toEqual([]);
  });

  test("does not report an approval invalidated by a future-job resume preference", async () => {
    const { workspaceService } = await approvedResumeHarness();
    const before = await workspaceService.getResumeWorkspace("job_ready");
    const result = await workspaceService.applyAssistantProfileOperations({
      operations: [{ operation: "set_resume_approach", value: "conservative" }],
      summary: "Use Light for future jobs",
      messageId: "synthetic_light_instruction",
    });
    const after = await workspaceService.getResumeWorkspace("job_ready");

    expect(result.invalidatedApprovedResumeJobIds).toEqual([]);
    expect(after.draft).toEqual(before.draft);
    expect(after.draft.status).toBe("approved");
  });
});
