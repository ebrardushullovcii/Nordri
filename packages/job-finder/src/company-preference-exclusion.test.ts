import { describe, expect, it, vi } from "vitest";

import { createJobCaveats } from "./assistant/tools/format";
import { queryJobsTool, shortlistJobsTool } from "./assistant/tools/jobs-tools";
import type { AssistantHostPorts } from "./assistant/ports";
import type { AssistantTurnSession } from "./assistant/tool-kit";
import { applyDiscoveryTitleTriage } from "./internal/workspace-source-intelligence";
import { createSeed } from "./workspace-service.test-fixtures";
import { createWorkspaceServiceHarness } from "./workspace-service.test-harness";

describe("company preference exclusions", () => {
  async function harness() {
    const seed = createSeed();
    seed.searchPreferences.companyWhitelist = [];
    seed.savedJobs = seed.savedJobs.map((job) =>
      job.id === "job_generating" ? { ...job, status: "discovered" } : job,
    );
    const result = createWorkspaceServiceHarness({ seed });
    await result.workspaceService.getWorkspaceSnapshot();
    const snapshot = await result.workspaceService.refreshCompanyIntelligence();
    const company = snapshot.intelligence.companies.find(
      (entry) => entry.canonicalName === "Northwind Labs",
    )!;
    return { ...result, snapshot, company };
  }

  it("makes a directory exclusion effective for job picks and future discovery", async () => {
    const { workspaceService, repository, company } = await harness();
    const excluded = await workspaceService.setCompanyPreference({
      companyId: company.id,
      preference: "exclude",
    });
    expect(excluded.searchPreferences.companyBlacklist).toContain(
      "Northwind Labs",
    );
    expect(
      (await repository.getCampaignState())!.campaigns[0]!.searchPreferences
        .companyBlacklist,
    ).toContain("Northwind Labs");
    const job = excluded.companyJobs.find(
      (entry) => entry.company === "Northwind Labs",
    )!;
    expect(createJobCaveats(excluded)(job).excludedEmployer).toBe(true);
    expect(
      applyDiscoveryTitleTriage({
        posting: job,
        profile: excluded.profile,
        searchPreferences: excluded.searchPreferences,
      }).outcome,
    ).toBe("skip_company");
    const context = {
      service: workspaceService,
      session: {
        assertCurrent: () => undefined,
        createResultSet: () => Promise.resolve({ id: "excluded_jobs_result" }),
      } as unknown as AssistantTurnSession,
      ports: {
        publishWorkspaceUpdate: () => undefined,
      } as unknown as AssistantHostPorts,
    };
    const query = await queryJobsTool.execute(
      {
        scope: "all",
        sort: "score",
        limit: 25,
        includeExcludedEmployers: false,
      },
      context,
    );
    expect(
      (query.data as { jobs: { id: string }[] }).jobs.map((entry) => entry.id),
    ).not.toContain(job.id);
    const held = await shortlistJobsTool.execute(
      { jobIds: [job.id], evenIfExcludedOrApplied: false },
      context,
    );
    expect(held.data).toEqual([
      {
        jobId: job.id,
        outcome: "held back: the person excluded Northwind Labs",
      },
    ]);
    const namedQuery = await queryJobsTool.execute(
      {
        scope: "all",
        sort: "score",
        limit: 25,
        includeExcludedEmployers: true,
      },
      context,
    );
    expect(
      (namedQuery.data as { jobs: { id: string }[] }).jobs.map(
        (entry) => entry.id,
      ),
    ).toContain(job.id);
    const explicitlyRequested = await shortlistJobsTool.execute(
      { jobIds: [job.id], evenIfExcludedOrApplied: true },
      context,
    );
    expect(explicitlyRequested.data).toEqual([
      { jobId: job.id, outcome: "shortlisted" },
    ]);
  });

  it("excludes across plans and lifts only this company's names when the preference changes", async () => {
    const { workspaceService, repository, snapshot, company } = await harness();
    const campaign = snapshot.campaigns[0]!;
    await repository.saveCampaignState({
      activeCampaignId: campaign.id,
      notifications: [],
      campaigns: [
        campaign,
        {
          ...campaign,
          id: "campaign_other",
          name: "Another plan",
          searchPreferences: {
            ...campaign.searchPreferences,
            companyBlacklist: ["Keep excluded in the other plan"],
          },
        },
      ],
    });
    const excluded = await workspaceService.setCompanyPreference({
      companyId: company.id,
      preference: "exclude",
    });
    expect(
      excluded.campaigns.map(
        (entry) => entry.searchPreferences.companyBlacklist,
      ),
    ).toEqual([
      ["Northwind Labs"],
      ["Keep excluded in the other plan", "Northwind Labs"],
    ]);
    const preferred = await workspaceService.setCompanyPreference({
      companyId: company.id,
      preference: "prefer",
    });
    expect(preferred.searchPreferences.companyBlacklist).not.toContain(
      "Northwind Labs",
    );
    expect(
      preferred.campaigns.map(
        (entry) => entry.searchPreferences.companyBlacklist,
      ),
    ).toEqual([[], ["Keep excluded in the other plan"]]);
  });

  it("uses approved aliases without extending exclusion to inferred aliases", async () => {
    const { workspaceService, repository, snapshot, company } = await harness();
    await repository.saveIntelligenceState({
      ...snapshot.intelligence,
      companies: snapshot.intelligence.companies.map((entry) =>
        entry.id !== company.id
          ? entry
          : {
              ...entry,
              aliases: [
                {
                  alias: "Northwind Operations",
                  normalized: "northwind operations",
                  confidence: 1,
                  identityAuthority: "user_approved_merge",
                },
                {
                  alias: "Possible Northwind Affiliate",
                  normalized: "possible northwind affiliate",
                  confidence: 0.5,
                  identityAuthority: "unknown",
                },
              ],
            },
      ),
    });
    const excluded = await workspaceService.setCompanyPreference({
      companyId: company.id,
      preference: "exclude",
    });
    expect(excluded.searchPreferences.companyBlacklist).toEqual([
      "Northwind Labs",
      "Northwind Operations",
    ]);
  });

  it("keeps directory and search state unchanged while a company identity merge is pending", async () => {
    const { workspaceService, repository, snapshot, company } = await harness();
    const other = snapshot.intelligence.companies.find(
      (entry) => entry.id !== company.id,
    )!;
    await repository.saveIntelligenceState({
      ...snapshot.intelligence,
      companies: snapshot.intelligence.companies.map((entry) =>
        entry.id !== company.id
          ? entry
          : {
              ...entry,
              mergeReviewCandidates: [
                {
                  candidateCompanyId: other.id,
                  reason: "Identity needs review",
                  decision: "pending",
                  decidedAt: null,
                  requiresUserDecision: true,
                },
              ],
            },
      ),
    });
    await expect(
      workspaceService.setCompanyPreference({
        companyId: company.id,
        preference: "exclude",
      }),
    ).rejects.toThrow("pending_company_merge");
    expect(
      (await repository.getIntelligenceState()).companies.find(
        (entry) => entry.id === company.id,
      )!.preference,
    ).toBe("neutral");
    expect((await repository.getSearchPreferences()).companyBlacklist).toEqual(
      [],
    );
  });

  it("does not save a metadata-only exclusion when its atomic commit fails", async () => {
    const { workspaceService, repository, company } = await harness();
    vi.spyOn(
      repository,
      "commitCampaignPreferencesUpdate",
    ).mockRejectedValueOnce(new Error("Cannot persist preferences"));
    await expect(
      workspaceService.setCompanyPreference({
        companyId: company.id,
        preference: "exclude",
      }),
    ).rejects.toThrow("Cannot persist preferences");
    expect(
      (await repository.getIntelligenceState()).companies.find(
        (entry) => entry.id === company.id,
      )!.preference,
    ).toBe("neutral");
    expect((await repository.getSearchPreferences()).companyBlacklist).toEqual(
      [],
    );
  });
});
