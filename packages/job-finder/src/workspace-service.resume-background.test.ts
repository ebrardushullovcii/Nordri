import { expect, test, vi } from "vitest";
import { createWorkspaceServiceHarness } from "./workspace-service.test-support";
import { createAiClient } from "./workspace-service.test-runtimes";

test("Resume Studio opens while listing fit is still being checked and keeps one check", async () => {
  const aiClient = createAiClient();
  const { repository, workspaceService } = createWorkspaceServiceHarness({
    aiClient,
  });
  await workspaceService.generateResume("job_ready");
  const draft = await repository.getResumeDraftByJobId("job_ready");
  let rejectCheck: ((reason: Error) => void) | undefined;
  const assess = vi.spyOn(aiClient, "assessJobFit").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectCheck = reject;
      }),
  );
  const jobs = await repository.listSavedJobs();
  const job = jobs.find((entry) => entry.id === "job_ready")!;
  await repository.commitSavedJobDelta({
    upserts: [
      {
        ...job,
        matchAssessment: {
          ...job.matchAssessment,
          requirementsSource: "deterministic",
        },
        planAssessments: {},
      },
    ],
  });
  const workspace = await workspaceService.getResumeWorkspace("job_ready");
  expect(workspace.draft.id).toBe(draft!.id);
  expect(workspace.listingCheckState).toBe("checking");
  expect(
    (await workspaceService.getResumeWorkspace("job_ready")).listingCheckState,
  ).toBe("checking");
  await vi.waitFor(() => expect(assess).toHaveBeenCalledTimes(1));
  rejectCheck!(new Error("Synthetic failure"));
  await vi.waitFor(async () =>
    expect(
      (await workspaceService.getResumeWorkspace("job_ready"))
        .listingCheckState,
    ).toBe("failed"),
  );
  expect(
    (await repository.getResumeDraftByJobId("job_ready"))!.sections,
  ).toEqual(draft!.sections);
});

test("saving only job sources leaves an approved resume current", async () => {
  const { repository, workspaceService } = createWorkspaceServiceHarness();
  await workspaceService.generateResume("job_ready");
  const draft = (await repository.getResumeDraftByJobId("job_ready"))!;
  await repository.upsertResumeDraft({
    ...draft,
    status: "approved",
    approvedAt: draft.updatedAt,
    approvedExportId: "synthetic_export",
  });
  const profile = await repository.getProfile();
  const preferences = await repository.getSearchPreferences();
  await workspaceService.saveProfileAndSearchPreferences(profile, {
    ...preferences,
    discovery: { ...preferences.discovery, targets: [] },
  });
  expect((await repository.getResumeDraftByJobId("job_ready"))!.status).toBe(
    "approved",
  );
});
