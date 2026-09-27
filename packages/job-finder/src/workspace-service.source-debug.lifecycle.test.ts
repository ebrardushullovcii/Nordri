import { describe, expect, test } from "vitest";
import { createInMemoryJobFinderRepository } from "@unemployed/db";
import type { AgentDebugFindings } from "@unemployed/contracts";
import { createJobFinderWorkspaceService } from "./index";
import {
  createAgentAiClient,
  createAgentBrowserRuntime,
  createAiClient,
  createBrowserRuntime,
  createDocumentManager,
  createSeed,
  createStrongSourceDebugFindingsByPhase,
  createThinSourceDebugFindingsByPhase,
  createUnprovenVisibleControlFindingsByPhase,
} from "./workspace-service.test-support";

describe("createJobFinderWorkspaceService", () => {
  test("runs source debug, persists artifacts, and validates learned instructions after replay", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
    });
    const visualSearchFindings: AgentDebugFindings = {
      summary:
        "Visible search controls and job cards were confirmed by visual analysis.",
      reliableControls: [
        "Use the keyword search box and location filter together; they refresh the visible job set on the results surface.",
      ],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
      visualFindings: [
        {
          snapshotId: "visual_snapshot_search_probe",
          observationSetId: "visual_observation_search_probe",
          summary: "Visible search controls and job cards appear in the viewport.",
          capturedAt: "2026-03-20T10:00:45.000Z",
          storagePath: "/tmp/source-debug/visual-search-probe.png",
          retention: "retained",
          redactionLevel: "standard",
          confidence: 0.78,
          reconciliationStatus: "not_compared",
        },
      ],
      visualObservationSets: [
        {
          id: "visual_observation_search_probe",
          snapshotId: "visual_snapshot_search_probe",
          observedAt: "2026-03-20T10:00:45.000Z",
          url: "https://www.linkedin.com/jobs/search/",
          purpose: "source_debug",
          providerKind: "deterministic",
          providerLabel: "Deterministic browser visual analysis",
          summary: "Visible search controls and job cards appear in the viewport.",
          observations: [],
          blockers: [],
          visibleControls: ["Keyword search and location filter are visible"],
          jobCardClues: ["Several job-card rows are visible"],
          applyPathClues: [],
          fieldControls: [],
          validationErrors: [],
          buttonStates: [],
          questionContexts: [],
          recoveryNotes: [],
          uncertainty: [],
          reconciliations: [],
          rejectedOutputReasons: [],
        },
      ],
    };
    const strongFindings = createStrongSourceDebugFindingsByPhase();
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_1",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_1",
          title: "Staff Product Designer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          postedAt: "2026-03-20T09:00:00.000Z",
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: "$180k - $220k",
          summary: "Validate stable job detail routes.",
          description: "Validate stable job detail routes.",
          keySkills: ["Figma", "React"],
        },
      ],
      {
        compactionState: {
          compactedAt: "2026-03-20T10:00:30.000Z",
          compactionCount: 1,
          triggerKind: "token_budget",
          estimatedTokensBefore: 121000,
          estimatedTokensAfter: 79000,
          summary: "Compacted execution summary.",
          confirmedFacts: ["Visited 3 pages."],
          blockerNotes: [],
          avoidStrategyFingerprints: [
            "site_structure_mapping:target_site:site structure mapping",
          ],
          preservedContext: ["Staff Product Designer at Signal Systems"],
          stickyWorkflowState: ["Phase goal: Map the site structure"],
        },
        debugFindingsByPhase: {
          ...strongFindings,
          search_filter_probe: visualSearchFindings,
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
    const runs = await repository.listSourceDebugRuns();
    const attempts = await repository.listSourceDebugAttempts();
    const artifacts = await repository.listSourceInstructionArtifacts();
    const evidenceRefs = await repository.listSourceDebugEvidenceRefs();
    const validatedArtifact = artifacts.find(
      (artifact) => artifact.status === "validated",
    );

    expect(snapshot.activeSourceDebugRun).toBeNull();
    expect(snapshot.recentSourceDebugRuns[0]?.state).toBe("completed");
    expect(
      snapshot.searchPreferences.discovery.targets[0]?.instructionStatus,
    ).toBe("validated");
    expect(
      snapshot.searchPreferences.discovery.targets[0]?.validatedInstructionId,
    ).not.toBeNull();
    expect(
      snapshot.searchPreferences.discovery.targets[0]?.draftInstructionId,
    ).toBeNull();
    expect(runs).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.runId === runs[0]?.id)).toBe(
      true,
    );
    expect(attempts[0]?.compactionState?.compactionCount).toBe(1);
    expect(
      snapshot.sourceInstructionArtifacts.some(
        (artifact) => artifact.status === "validated",
      ),
    ).toBe(true);
    expect(artifacts.some((artifact) => artifact.status === "validated")).toBe(
      true,
    );
    expect(validatedArtifact?.applyGuidance.length).toBeGreaterThan(0);
    expect(
      [
        ...(validatedArtifact?.navigationGuidance ?? []),
        ...(validatedArtifact?.searchGuidance ?? []),
        ...(validatedArtifact?.detailGuidance ?? []),
        ...(validatedArtifact?.applyGuidance ?? []),
      ].some((line) => /candidate job result/i.test(line)),
    ).toBe(false);
    const learnedLines = [
      ...(validatedArtifact?.navigationGuidance ?? []),
      ...(validatedArtifact?.searchGuidance ?? []),
      ...(validatedArtifact?.detailGuidance ?? []),
      ...(validatedArtifact?.applyGuidance ?? []),
    ];
    expect(new Set(learnedLines).size).toBe(learnedLines.length);
    expect(evidenceRefs.length).toBeGreaterThan(0);
    expect(
      attempts.some((attempt) => attempt.visualEvidence.length > 0),
    ).toBe(true);
    expect(
      attempts.some((attempt) =>
        attempt.confirmedFacts.some((fact) => fact.includes("Visual evidence:")),
      ),
    ).toBe(true);
    const visualEvidenceRef = evidenceRefs.find(
      (evidenceRef) => evidenceRef.kind === "screenshot",
    );
    expect(visualEvidenceRef).toMatchObject({
      storagePath: "/tmp/source-debug/visual-search-probe.png",
      visualSnapshotId: "visual_snapshot_search_probe",
      visualObservationSetId: "visual_observation_search_probe",
    });
  });

  test("marks lingering running source-debug runs as interrupted on workspace load", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      discovery: {
        ...createSeed().discovery,
        activeSourceDebugRun: {
          id: "source_debug_run_lingering",
          targetId: "target_linkedin_default",
          state: "running",
          startedAt: "2026-03-20T10:00:00.000Z",
          updatedAt: "2026-03-20T10:04:00.000Z",
          completedAt: null,
          activePhase: "job_detail_validation",
          phases: [
            "access_auth_probe",
            "site_structure_mapping",
            "search_filter_probe",
            "job_detail_validation",
          ],
          targetLabel: "LinkedIn default",
          targetUrl: "https://www.linkedin.com/jobs/search/",
          targetHostname: "www.linkedin.com",
          manualPrerequisiteSummary: null,
          finalSummary: null,
          attemptIds: [],
          phaseSummaries: [],
          instructionArtifactId: null,
          timing: null,
        },
        recentSourceDebugRuns: [],
      },
      sourceDebugRuns: [
        {
          id: "source_debug_run_lingering",
          targetId: "target_linkedin_default",
          state: "running",
          startedAt: "2026-03-20T10:00:00.000Z",
          updatedAt: "2026-03-20T10:04:00.000Z",
          completedAt: null,
          activePhase: "job_detail_validation",
          phases: [
            "access_auth_probe",
            "site_structure_mapping",
            "search_filter_probe",
            "job_detail_validation",
          ],
          targetLabel: "LinkedIn default",
          targetUrl: "https://www.linkedin.com/jobs/search/",
          targetHostname: "www.linkedin.com",
          manualPrerequisiteSummary: null,
          finalSummary: null,
          attemptIds: [],
          phaseSummaries: [],
          instructionArtifactId: null,
          timing: null,
        },
      ],
    });
    const workspaceService = createJobFinderWorkspaceService({
      repository,
      browserRuntime: createBrowserRuntime(),
      aiClient: createAiClient(),
      documentManager: createDocumentManager(),
    });

    const snapshot = await workspaceService.getWorkspaceSnapshot();
    const runs = await repository.listSourceDebugRuns();

    expect(snapshot.activeSourceDebugRun).toBeNull();
    expect(snapshot.recentSourceDebugRuns[0]?.state).toBe("interrupted");
    expect(snapshot.recentSourceDebugRuns[0]?.activePhase).toBeNull();
    expect(snapshot.recentSourceDebugRuns[0]?.completedAt).not.toBeNull();
    expect(runs[0]?.state).toBe("interrupted");
    expect(runs[0]?.activePhase).toBeNull();
  });

  test("keeps learned instructions in draft when replay passes but reusable guidance is still too thin", async () => {
    const repository = createInMemoryJobFinderRepository({
      ...createSeed(),
      savedJobs: [],
      tailoredAssets: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "linkedin_source_debug_thin_1",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/linkedin_source_debug_thin_1",
          title: "Product Designer",
          company: "Signal Systems",
          location: "Remote",
          workMode: ["remote"],
          applyPath: "unknown",
          easyApplyEligible: false,
          postedAt: "2026-03-20T09:00:00.000Z",
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Thin source-debug coverage.",
          description: "Thin source-debug coverage.",
          keySkills: ["Figma"],
        },
      ],
      {
        debugFindingsByPhase: createThinSourceDebugFindingsByPhase(),
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
    const artifacts = await repository.listSourceInstructionArtifacts();
    const latestArtifact = artifacts.at(-1);

    expect(
      snapshot.searchPreferences.discovery.targets[0]?.instructionStatus,
    ).toBe("draft");
    expect(
      snapshot.searchPreferences.discovery.targets[0]?.validatedInstructionId,
    ).toBeNull();
    expect(
      snapshot.searchPreferences.discovery.targets[0]?.draftInstructionId,
    ).not.toBeNull();
    expect(latestArtifact?.status).toBe("draft");
    expect(
      latestArtifact?.warnings.some((warning) =>
        /still thin|not yet shown/i.test(warning),
      ),
    ).toBe(true);
    expect((latestArtifact?.searchGuidance ?? []).length).toBe(0);
  });

  test("keeps learned instructions in draft when visible search controls were mentioned but never proven reusable", async () => {
    const seed = createSeed();
    seed.searchPreferences.discovery.targets[0] = {
      ...seed.searchPreferences.discovery.targets[0]!,
      id: "target_generic_default",
      label: "KosovaJob",
      startingUrl: "https://kosovajob.com/",
      adapterKind: "auto",
    };
    const repositoryWithGenericTarget = createInMemoryJobFinderRepository({
      ...seed,
      savedJobs: [],
      tailoredAssets: [],
    });
    const browserRuntime = createAgentBrowserRuntime(
      [
        {
          source: "target_site",
          sourceJobId: "generic_source_debug_1",
          discoveryMethod: "catalog_seed",
          canonicalUrl:
            "https://kosovajob.com/jobs/view/generic_source_debug_1",
          title: "Customer Experience Specialist",
          company: "KosovaJob",
          location: "Prishtina",
          workMode: ["onsite"],
          applyPath: "unknown",
          easyApplyEligible: false,
          postedAt: "2026-03-20T09:00:00.000Z",
          discoveredAt: "2026-03-20T10:04:00.000Z",
          salaryText: null,
          summary: "Homepage listing.",
          description: "Homepage listing.",
          keySkills: ["Support"],
        },
      ],
      {
        debugFindingsByPhase: createUnprovenVisibleControlFindingsByPhase(),
        phaseEvidenceByPhase: {
          search_filter_probe: {
            visibleControls: [
              'searchbox "Kërko sipas pozitës së punës"',
              'combobox "Qyteti"',
              'combobox "Industria"',
            ],
            successfulInteractions: [
              "Returned to the top of the current page to re-check header controls",
            ],
            routeSignals: [
              "Returned to the top of https://kosovajob.com/ to probe header controls again",
            ],
            attemptedControls: [
              'Filled searchbox "Kërko sipas pozitës së punës"',
              'Selected "Prishtinë" from combobox "Qyteti"',
              'Selected "Teknologji e Informacionit" from combobox "Industria"',
            ],
            warnings: ["fill failed: Timeout 10000ms exceeded."],
          },
        },
      },
    );
    const workspaceService = createJobFinderWorkspaceService({
      repository: repositoryWithGenericTarget,
      browserRuntime,
      aiClient: createAgentAiClient(),
      documentManager: createDocumentManager(),
    });

    const snapshot = await workspaceService.runSourceDebug(
      "target_generic_default",
    );
    const latestArtifact = (
      await repositoryWithGenericTarget.listSourceInstructionArtifacts()
    ).at(-1);

    expect(
      snapshot.searchPreferences.discovery.targets[0]?.instructionStatus,
    ).toBe("draft");
    expect(latestArtifact?.status).toBe("draft");
    expect(
      latestArtifact?.warnings.some((warning) =>
        /did not confirm/i.test(warning),
      ),
    ).toBe(true);
  });


});
