import { afterEach, expect, test, vi } from "vitest";
import { JobDiscoveryTargetSchema } from "@nordri/contracts";
import {
  createSeed,
  createWorkspaceServiceHarness,
} from "./workspace-service.test-support";

afterEach(() => vi.restoreAllMocks());

test("changing remote geography revalidates existing feed jobs without duplicating them", async () => {
  const seed = createSeed();
  seed.savedJobs = [];
  seed.discovery.pendingDiscoveryJobs = [];
  seed.discovery.discoveryLedger = [];
  seed.settings.discoveryOnly = false;
  seed.searchPreferences.targetRoles = ["Product Designer"];
  seed.searchPreferences.locations = ["Berlin, Germany"];
  seed.searchPreferences.workModes = [];
  seed.searchPreferences.companyWhitelist = [];
  seed.searchPreferences.companyBlacklist = [];
  seed.searchPreferences.excludedLocations = [];
  seed.searchPreferences.discovery.collectOnlyHardCriteriaMatches = false;
  seed.searchPreferences.discovery.targets = [
    JobDiscoveryTargetSchema.parse({
      id: "geography",
      label: "Geography fixture",
      startingUrl: "https://job-boards.greenhouse.io/geography-fixture",
    }),
  ];
  const rows = [
    { id: 1, location: "Berlin, Germany" },
    { id: 2, location: "Paris, France" },
    { id: 3, location: "Remote, Europe" },
    { id: 4, location: "Remote, US" },
    { id: 5, location: "Remote, Worldwide" },
    { id: 6, location: "Location not stated" },
  ].map((row) => ({
    ...row,
    title: "Product Designer",
    location: { name: row.location },
    absolute_url: `https://job-boards.greenhouse.io/geography-fixture/jobs/${row.id}`,
    content:
      "Design accessible product interfaces and prototypes using Figma. Collaborate with product managers and engineers.",
    updated_at: "2026-09-25T09:00:00.000Z",
  }));
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(Response.json({ jobs: rows })),
  );
  const { workspaceService, repository } = createWorkspaceServiceHarness({
    seed,
  });
  const setRemote = async (remoteCountsAsAnyLocation: boolean) => {
    const w = await workspaceService.getWorkspaceSnapshot();
    await workspaceService.updateAiBehavior({
      aiBehavior: {
        ...w.settings.aiBehavior!,
        jobSearch: { selectivity: "balanced", remoteCountsAsAnyLocation },
      },
    });
  };
  await setRemote(true);
  await workspaceService.runAgentDiscovery();
  const before = await repository.listSavedJobs();
  expect(before).toHaveLength(6);
  const byLocation = (jobs: typeof before, location: string) =>
    jobs.find((job) => job.location === location)!;
  await setRemote(false);
  const repeat = await workspaceService.runAgentDiscovery();
  const after = await repository.listSavedJobs();
  expect(after.map((job) => job.id).sort()).toEqual(
    before.map((job) => job.id).sort(),
  );
  expect(repeat.recentDiscoveryRuns[0]?.summary.jobsPersisted).toBe(0);
  for (const location of ["Remote, Europe", "Remote, Worldwide"]) {
    expect(byLocation(after, location).matchAssessment.score).toBeLessThan(
      byLocation(before, location).matchAssessment.score,
    );
  }
  expect(byLocation(after, "Berlin, Germany").matchAssessment.score).toBe(
    byLocation(before, "Berlin, Germany").matchAssessment.score,
  );
  expect(
    after.every(
      (job) =>
        job.postedAt === null &&
        job.providerUpdatedAt === "2026-09-25T09:00:00.000Z",
    ),
  ).toBe(true);
}, 30_000);
