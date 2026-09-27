import { describe, expect, test } from "vitest";
import { createInMemoryJobFinderRepository } from "@unemployed/db";
import { createJobFinderWorkspaceService } from "./index";
import {
  createAgentAiClient,
  createAgentBrowserRuntime,
  createDocumentManager,
  createMixedAuthSurfaceFindingsByPhase,
  createNoisySourceDebugFindingsByPhase,
  createSeed,
  createStrongSourceDebugFindingsByPhase,
  createUrlShortcutOnlyFindingsByPhase,
} from "./workspace-service.test-support";

describe("createJobFinderWorkspaceService", () => {
  test("keeps learned instructions in draft when search guidance relies only on url shortcuts", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_geoid",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_geoid",
          title: "Frontend Developer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "unknown",
          easyApplyEligible: false,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "URL shortcut only coverage.",
          description: "URL shortcut only coverage.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: createUrlShortcutOnlyFindingsByPhase(),
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    const snapshot = await workspaceService.runSourceDebug(
      "target_linkedin_default",
    );
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);
    const learnedLines = [
      ...(latestArtifact?.navigationGuidance ?? []),
      ...(latestArtifact?.searchGuidance ?? []),
      ...(latestArtifact?.warnings ?? []),
    ]
      .join("\n")
      .toLowerCase();

    expect(
      snapshot.searchPreferences.discovery.targets[0]?.instructionStatus,
    ).toBe("draft");
    expect(latestArtifact?.status).toBe("draft");
    expect(learnedLines).not.toContain("geoid");
    expect(learnedLines).not.toContain("currentjobid");
    expect(learnedLines).not.toContain("/jobs/search/");
    expect(learnedLines).not.toContain("jobs url pattern");
  });

  test("curates mixed guest-auth and authenticated job-surface guidance toward the surface that actually exposed jobs", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_mixed_auth",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_mixed_auth",
          title: "Senior Frontend Engineer",
          company: "Signal Systems",
          location: "Prishtina",
          workMode: ["onsite"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Mixed auth surface coverage.",
          description: "Mixed auth surface coverage.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: createMixedAuthSurfaceFindingsByPhase(),
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    await workspaceService.runSourceDebug("target_linkedin_default");
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);
    const learnedLines = [
      ...(latestArtifact?.navigationGuidance ?? []),
      ...(latestArtifact?.searchGuidance ?? []),
      ...(latestArtifact?.detailGuidance ?? []),
      ...(latestArtifact?.applyGuidance ?? []),
    ]
      .join("\n")
      .toLowerCase();

    expect(learnedLines).toContain("show all");
    expect(learnedLines).toContain("search box");
    expect(learnedLines).not.toContain(
      "login form is the only visible surface",
    );
    expect(learnedLines).not.toContain(
      "cannot access job listings without target site account",
    );
    expect(
      latestArtifact?.warnings.some((warning) =>
        /crossed both guest\/login and job-bearing surfaces/i.test(warning),
      ),
    ).toBe(true);
  });

  test("treats collection result-changing guidance as positive search proof instead of leaving search coverage in draft", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const strongFindings = createStrongSourceDebugFindingsByPhase();
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_collection_positive",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_collection_positive",
          title: "Senior Frontend Engineer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Collection route search-proof coverage.",
          description: "Collection route search-proof coverage.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: {
          ...strongFindings,
          search_filter_probe: {
            summary:
              '"Show all top job picks for you" is the primary result-changing control on the jobs hub.',
            reliableControls: [
              '"Show all top job picks for you" is the primary result-changing control - it navigates to /jobs/collections/recommended/ with a different job set.',
              "Recommendation routes are the primary way to access different job collections.",
            ],
            trickyFilters: [
              "No visible search box or filter dropdowns on the main jobs hub /jobs/.",
            ],
            navigationTips: [],
            applyTips: [],
            warnings: [],
          },
        },
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    await workspaceService.runSourceDebug("target_linkedin_default");
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);

    expect(
      latestArtifact?.warnings.some((warning) =>
        /search and filter behavior is still unproven/i.test(warning),
      ),
    ).toBe(false);
    expect(
      latestArtifact?.warnings.some((warning) =>
        /search and filter coverage is still missing/i.test(warning),
      ),
    ).toBe(false);
  });

  test("treats stable jobs search routes with visible filter controls as positive search proof", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const strongFindings = createStrongSourceDebugFindingsByPhase();
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_search_route_positive",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_search_route_positive",
          title: "Senior Frontend Engineer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "unknown",
          easyApplyEligible: false,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Search route search-proof coverage.",
          description: "Search route search-proof coverage.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: {
          ...strongFindings,
          search_filter_probe: {
            summary:
              "LinkedIn Jobs search endpoint /jobs/search/?keywords=...&location=... reliably returns job cards with filter controls.",
            reliableControls: [
              "/jobs/search/?keywords=...&location=... reliably returns job cards with filter controls.",
              "Filter buttons visible on search results: Show all filters, Experience level, Remote.",
            ],
            trickyFilters: [
              "Homepage /jobs/ shows recommendation cards but has no visible search/filter UI.",
            ],
            navigationTips: [],
            applyTips: [],
            warnings: [],
          },
        },
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    await workspaceService.runSourceDebug("target_linkedin_default");
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);

    expect(
      latestArtifact?.warnings.some((warning) =>
        /search and filter behavior is still unproven/i.test(warning),
      ),
    ).toBe(false);
    expect(
      latestArtifact?.warnings.some((warning) =>
        /search and filter coverage is still missing/i.test(warning),
      ),
    ).toBe(false);
  });

  test("filters raw interaction traces from learned instructions and reconciles apply guidance", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_cleaned",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_cleaned",
          title: "Frontend Engineer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Noise cleanup coverage.",
          description: "Noise cleanup coverage.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: createNoisySourceDebugFindingsByPhase(),
        phaseEvidenceByPhase: {
          site_structure_mapping: {
            visibleControls: [
              'link "Show all top job picks for you"',
              'searchbox "Search by title, skill, or company"',
            ],
            successfulInteractions: [
              'Clicked link "Show all top job picks for you"',
            ],
            routeSignals: [
              "Control click opened https://www.linkedin.com/jobs/collections/recommended/",
            ],
            attemptedControls: [
              'Clicked link "Show all top job picks for you"',
            ],
            warnings: [],
          },
          search_filter_probe: {
            visibleControls: [
              'searchbox "Search by title, skill, or company"',
              'combobox "Location"',
              'combobox "Industry"',
              'button "Show all filters"',
            ],
            successfulInteractions: [
              "Scrolled down on the current jobs surface",
            ],
            routeSignals: [
              "Search submit opened https://www.linkedin.com/jobs/search/",
              "Scrolling revealed additional content on https://www.linkedin.com/jobs/collections/recommended/",
            ],
            attemptedControls: [
              'Filled searchbox "Search by title, skill, or company"',
              'Selected "Prishtina" from combobox "Location"',
              'Selected "Information Technology" from combobox "Industry"',
            ],
            warnings: [
              "fill failed: Timeout 10000ms exceeded.",
              "click failed: element is not visible until the page is scrolled.",
            ],
          },
        },
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    const snapshot = await workspaceService.runSourceDebug(
      "target_linkedin_default",
    );
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);
    const learnedLines = [
      ...(latestArtifact?.navigationGuidance ?? []),
      ...(latestArtifact?.searchGuidance ?? []),
      ...(latestArtifact?.detailGuidance ?? []),
      ...(latestArtifact?.applyGuidance ?? []),
    ]
      .join("\n")
      .toLowerCase();

    expect(
      snapshot.searchPreferences.discovery.targets[0]?.instructionStatus,
    ).not.toBe("missing");
    expect(learnedLines).not.toContain("clicked link");
    expect(learnedLines).not.toContain("locator.click");
    expect(learnedLines).not.toContain("promoted");
    expect(learnedLines).not.toContain("dismiss senior frontend engineer");
    expect(learnedLines).not.toContain("timed out");
    expect(learnedLines).not.toContain("element is not visible");
    expect(learnedLines).toContain("show all");
    expect(learnedLines).toContain("collection");
    expect(learnedLines).toContain("visible keyword search box");
    expect(learnedLines).toContain("visible location filter");
    expect(learnedLines).toContain("visible industry or category filter");
    expect(learnedLines).toContain(
      "did not prove they change the result set reliably",
    );
    expect(learnedLines).toContain(
      "may need scrolling into view before interaction",
    );
    expect(learnedLines).toContain("on-site apply entry");
    expect(learnedLines).not.toContain(
      "treat applications as manual until a reliable on-site apply entry is proven",
    );
  });

  test("reconciles earlier search and detail failures away when later phases prove the reusable path", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
      resumeDrafts: [],
      resumeDraftRevisions: [],
      resumeExportArtifacts: [],
      resumeResearchArtifacts: [],
      resumeValidationResults: [],
      resumeAssistantMessages: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_reconcile_case",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_reconcile_case",
          title: "Frontend Engineer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          postedAt: "2026-03-20T09:00:00.000Z",
          postedAtText: null,
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Reconciliation case.",
          description: "Reconciliation case.",
          keySkills: ["React"],
          responsibilities: [],
        },
      ],
      {
        debugFindingsByPhase: {
          access_auth_probe:
            createStrongSourceDebugFindingsByPhase().access_auth_probe ?? null,
          site_structure_mapping: {
            summary:
              "The jobs landing page shows recommendation modules and visible controls before the fuller results route is opened.",
            reliableControls: [
              "Show all recommendation routes can open reusable collections.",
            ],
            trickyFilters: [
              "A visible keyword search box exists, but this run did not prove it changes the result set reliably.",
              "Visible location filters exist, but this run did not prove they change the result set reliably.",
              "Visible industry or category filters exist, but this run did not prove they change the result set reliably.",
            ],
            navigationTips: [
              "Use Show all on recommendation modules to reach a reusable collection before broader search.",
            ],
            applyTips: [],
            warnings: [],
          },
          search_filter_probe: {
            summary:
              'Search textbox "Search everything" is a reliable control and changes the result set when submitted.',
            reliableControls: [
              "Use the keyword search box to change the result set reliably.",
              "Use the visible location filter to narrow the listings by city.",
              "Use the visible industry filter to narrow the listings by sector.",
            ],
            trickyFilters: [],
            navigationTips: [],
            applyTips: [],
            warnings: [],
          },
          job_detail_validation: {
            summary:
              "Job detail validation successful. Confirmed stable URL pattern: /jobs/view/{jobId}.",
            reliableControls: [],
            trickyFilters: [
              "Job extraction consistently returned 0 despite visible job cards - tool limitation.",
            ],
            navigationTips: [
              "Use same-host detail pages as the canonical source of job data.",
            ],
            applyTips: [],
            warnings: [],
          },
          apply_path_validation: {
            summary: "Easy Apply is visible on supported listings.",
            reliableControls: [],
            trickyFilters: [],
            navigationTips: [],
            applyTips: [
              "Use the on-site apply entry when the detail page exposes it.",
              "Treat applications as manual until a reliable on-site apply entry is proven.",
            ],
            warnings: [],
          },
          replay_verification: {
            summary: "Replay verification reached the same listings again.",
            reliableControls: [
              "The keyword search box, visible location filter, and visible industry filter remained stable on replay.",
            ],
            trickyFilters: [],
            navigationTips: [],
            applyTips: [],
            warnings: [],
          },
        },
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    await workspaceService.runSourceDebug("target_linkedin_default");
    const latestArtifact = (
      await repository.listSourceInstructionArtifacts()
    ).at(-1);
    const learnedLines = [
      ...(latestArtifact?.navigationGuidance ?? []),
      ...(latestArtifact?.searchGuidance ?? []),
      ...(latestArtifact?.detailGuidance ?? []),
      ...(latestArtifact?.applyGuidance ?? []),
    ]
      .join("\n")
      .toLowerCase();

    expect(learnedLines).toContain("change the result set reliably");
    expect(learnedLines).toContain("location filter");
    expect(learnedLines).toContain("industry filter");
    expect(learnedLines).toContain("stable slug-style paths");
    expect(learnedLines).toContain("on-site apply entry");
    expect(learnedLines).not.toContain(
      "did not prove it changes the result set reliably",
    );
    expect(learnedLines).not.toContain("tool limitation");
    expect(learnedLines).not.toContain(
      "treat applications as manual until a reliable on-site apply entry is proven",
    );
  });


});
