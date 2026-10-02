import { afterEach, expect, test, vi } from "vitest";
import type { JudgeJobFitsInput } from "@nordri/ai-providers";
import { JobDiscoveryTargetSchema } from "@nordri/contracts";
import {
  createAiClient,
  createSeed,
  createWorkspaceServiceHarness,
} from "./workspace-service.test-support";

afterEach(() => vi.restoreAllMocks());

function seedWithBoard() {
  const seed = createSeed();
  seed.savedJobs = [];
  seed.discovery.pendingDiscoveryJobs = [];
  seed.discovery.discoveryLedger = [];
  seed.settings.discoveryOnly = false;
  seed.searchPreferences.targetRoles = ["Product Designer"];
  seed.searchPreferences.locations = ["Berlin, Germany"];
  seed.searchPreferences.discovery.collectOnlyHardCriteriaMatches = false;
  seed.searchPreferences.discovery.targets = [
    JobDiscoveryTargetSchema.parse({
      id: "fit",
      label: "Fit fixture",
      startingUrl: "https://job-boards.greenhouse.io/fit-fixture",
    }),
  ];
  const rows = [
    { id: 1, title: "Product Designer", location: "Berlin, DE" },
    { id: 2, title: "Backend Engineer", location: "Berlin, DE" },
  ].map((row) => ({
    ...row,
    location: { name: row.location },
    absolute_url: `https://job-boards.greenhouse.io/fit-fixture/jobs/${row.id}`,
    content:
      "Work with product managers and engineers on a collaborative planning product.",
    updated_at: "2026-09-25T09:00:00.000Z",
  }));
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ jobs: rows })),
  );
  return seed;
}

test("a search has the model judge the jobs it found, and its verdict stands", async () => {
  const judgeJobFits = vi.fn((input: JudgeJobFitsInput) =>
    Promise.resolve(
      input.jobs.map(({ jobId, posting }) =>
        posting.title === "Product Designer"
          ? {
              jobId,
              score: 86,
              recommendation: "strong_fit" as const,
              role: "exact" as const,
              roleExplanation: "This is the design work you are looking for.",
              preferences: "aligned" as const,
              preferencesExplanation: "Berlin, Germany is one of your places.",
              locationReach: "in_area" as const,
              reasons: ["Berlin, Germany is one of your places"],
              gaps: [],
            }
          : {
              jobId,
              score: 12,
              recommendation: "skip" as const,
              role: "conflict" as const,
              roleExplanation: "This is engineering work, not design.",
              preferences: "aligned" as const,
              preferencesExplanation: null,
              locationReach: "in_area" as const,
              reasons: [],
              gaps: ["A different occupation"],
            },
      ),
    ),
  );
  const { workspaceService, repository } = createWorkspaceServiceHarness({
    seed: seedWithBoard(),
    aiClient: { ...createAiClient(), judgeJobFits },
  });

  await workspaceService.runAgentDiscovery();

  expect(judgeJobFits).toHaveBeenCalledTimes(1);
  const asked = judgeJobFits.mock.calls[0]![0];
  expect(asked.searchPreferences.targetRoles).toEqual(["Product Designer"]);
  expect(asked.jobs.map((job) => job.posting.title).sort()).toEqual([
    "Backend Engineer",
    "Product Designer",
  ]);
  const jobs = await repository.listSavedJobs();
  const designer = jobs.find((job) => job.title === "Product Designer")!;
  const engineer = jobs.find((job) => job.title === "Backend Engineer")!;
  expect(designer.matchAssessment).toMatchObject({
    score: 86,
    recommendation: "strong_fit",
    locationReach: "in_area",
    reasons: ["Berlin, Germany is one of your places"],
    judgment: { source: "batch", score: 86 },
  });
  expect(engineer.matchAssessment).toMatchObject({
    score: 12,
    recommendation: "skip",
    recommendationRationale: "A different occupation",
  });

  // Nothing changed, so a second search does not ask again.
  await workspaceService.runAgentDiscovery();
  expect(judgeJobFits).toHaveBeenCalledTimes(1);
  expect(
    (await repository.listSavedJobs()).find(
      (job) => job.title === "Product Designer",
    )?.matchAssessment.score,
  ).toBe(86);
}, 30_000);

test("jobs the model could not judge keep a score and are asked about next time", async () => {
  const judgeJobFits = vi
    .fn<(input: JudgeJobFitsInput) => Promise<never[]>>()
    .mockRejectedValueOnce(new Error("model unavailable"))
    .mockResolvedValue([]);
  const { workspaceService, repository } = createWorkspaceServiceHarness({
    seed: seedWithBoard(),
    aiClient: { ...createAiClient(), judgeJobFits },
  });

  await workspaceService.runAgentDiscovery();
  const jobs = await repository.listSavedJobs();
  expect(jobs).toHaveLength(2);
  expect(jobs.every((job) => !job.matchAssessment.judgment)).toBe(true);
  expect(jobs.every((job) => job.matchAssessment.score > 0)).toBe(true);

  await workspaceService.runAgentDiscovery();
  expect(judgeJobFits).toHaveBeenCalledTimes(2);
}, 30_000);
