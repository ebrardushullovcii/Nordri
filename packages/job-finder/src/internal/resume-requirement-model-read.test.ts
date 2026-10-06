import { SaveJobSearchCampaignInputSchema } from "@nordri/contracts";
import { expect, it, vi } from "vitest";
import { createWorkspaceServiceHarness } from "../workspace-service.test-harness";
import { createAiClient } from "../workspace-service.test-runtimes";
import { createSeed } from "../workspace-service.test-fixtures";
it("checks semantic requirement evidence with one model call before Resume Studio shows it", async () => {
  const seed = createSeed();
  const job = seed.savedJobs[0]!;
  job.matchAssessment = {
    ...job.matchAssessment,
    requirementsSource: "deterministic",
  };
  const ai = createAiClient();
  const assessJobFit = vi.fn().mockResolvedValue({
    score: 80,
    reasons: ["Led logistics teams"],
    gaps: [],
    recommendation: "strong_fit",
    role: "exact",
    requirements: [
      {
        id: "lead",
        label: "Leadership and logistics",
        category: "experience",
        importance: "required",
        status: "supported",
        explanation:
          "Saved team management and warehouse experience support both.",
        jobEvidence: "Lead operations",
        resumeEvidence: [],
      },
    ],
  });
  const { workspaceService, repository } = createWorkspaceServiceHarness({
    seed,
    aiClient: { ...ai, assessJobFit },
  });
  const workspace = await workspaceService.getResumeWorkspace(job.id);
  expect(assessJobFit).toHaveBeenCalledTimes(1);
  expect(workspace.job.matchAssessment.requirementsSource).toBe("model");
  expect(workspace.job.matchAssessment.requirements[0]?.status).toBe(
    "supported",
  );
  await workspaceService.getResumeWorkspace(job.id);
  expect(assessJobFit).toHaveBeenCalledTimes(1);
  expect(
    (await repository.listSavedJobs()).find((saved) => saved.id === job.id)
      ?.matchAssessment.requirementsSource,
  ).toBe("model");
  const snapshot = await workspaceService.getWorkspaceSnapshot();
  const plan = snapshot.campaigns.find(
    (plan) => plan.id === snapshot.activeCampaignId,
  )!;
  const saved = await workspaceService.saveCampaign(
    SaveJobSearchCampaignInputSchema.parse({
      ...plan,
      id: null,
      name: "Warehouse plan",
      searchPreferences: {
        ...plan.searchPreferences,
        targetRoles: ["Warehouse lead"],
      },
    }),
  );
  const next = saved.campaigns.find((plan) => plan.name === "Warehouse plan")!;
  await workspaceService.selectCampaign(next.id);
  await workspaceService.getResumeWorkspace(job.id);
  expect(assessJobFit).toHaveBeenCalledTimes(2);
  expect(assessJobFit.mock.calls[1]?.[0].searchPreferences.targetRoles).toEqual(
    ["Warehouse lead"],
  );
});
