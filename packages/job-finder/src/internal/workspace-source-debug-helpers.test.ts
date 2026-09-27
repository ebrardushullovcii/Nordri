import { describe, expect, test } from "vitest";

import type {
  JobDiscoveryTarget,
  JobSearchPreferences,
} from "@unemployed/contracts";

import { createSourceInstructionArtifact } from "../workspace-service.test-fixtures";
import {
  deriveSourceDebugStartingUrls,
  getSourceDebugMaxSteps,
  resolveSourceDebugPhases,
} from "./workspace-source-debug-helpers";

function createTarget(
  overrides: Partial<JobDiscoveryTarget> = {},
): JobDiscoveryTarget {
  return {
    id: "unknown_careers",
    label: "Unknown Careers",
    startingUrl: "https://example.com/careers",
    enabled: true,
    adapterKind: "auto",
    customInstructions: null,
    instructionStatus: "missing",
    validatedInstructionId: null,
    draftInstructionId: null,
    lastDebugRunId: null,
    lastVerifiedAt: null,
    staleReason: null,
    ...overrides,
  };
}

function createUnknownCareersTarget(): JobDiscoveryTarget {
  return createTarget();
}

function createSearchSurfaceTarget(): JobDiscoveryTarget {
  return createTarget({
    id: "linkedin_default",
    label: "LinkedIn Jobs",
    startingUrl: "https://www.linkedin.com/feed/",
  });
}

function createPublicProviderTarget(): JobDiscoveryTarget {
  return createTarget({
    id: "greenhouse_remote",
    label: "Remote Greenhouse",
    startingUrl: "https://job-boards.greenhouse.io/remote",
  });
}

function createSearchPreferences(
  overrides: Partial<JobSearchPreferences> = {},
): JobSearchPreferences {
  return {
    targetRoles: [],
    jobFamilies: [],
    locations: [],
    excludedLocations: [],
    workModes: [],
    seniorityLevels: [],
    targetIndustries: [],
    targetCompanyStages: [],
    employmentTypes: [],
    minimumSalaryUsd: null,
    targetSalaryUsd: null,
    salaryCurrency: "USD",
    compensation: {
      minimum: null,
      maximum: null,
      interval: "year",
      currency: null,
      currencyStatus: "needs_clarification",
    },
    approvalMode: "draft_only",
    tailoringMode: "conservative",
    companyBlacklist: [],
    companyWhitelist: [],
    discovery: {
      targets: [],
      historyLimit: 5,
    },
    ...overrides,
  };
}

describe("deriveSourceDebugStartingUrls", () => {
  test("filters broken and detail-like route hints before reusing phase starting urls", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_unknown_careers_phase_routes",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_unknown_careers_phase_routes",
      basedOnAttemptIds: ["debug_attempt_unknown_careers_phase_routes"],
      notes:
        "Source-debug should not restart from broken or detail-only routes.",
      navigationGuidance: [
        "Best repeatable entry path is https://example.com/jobs/search?selectedJobId=456.",
        "Direct path guesses like https://example.com/404 are broken and should be ignored.",
        "Observed canonical detail page https://example.com/jobs/view/123 after opening a listing.",
        "Fallback listing surface is https://example.com/vacancies.",
      ],
      searchGuidance: [
        "Use https://example.com/jobs/search?currentJobId=123 as the fuller results surface.",
      ],
      detailGuidance: [],
      applyGuidance: [],
      warnings: [],
      versionInfo: {
        promptProfileVersion: "v1",
        toolsetVersion: "v1",
        adapterVersion: "v1",
        appSchemaVersion: "v1",
      },
      verification: null,
      intelligence: {
        provider: null,
        collection: {
          preferredMethod: "listing_route",
          rankedMethods: ["listing_route", "careers_page", "fallback_search"],
          startingRoutes: [
            {
              url: target.startingUrl,
              label: "Starting URL",
              kind: "listing",
              confidence: 0.6,
            },
          ],
          searchRouteTemplates: [],
          detailRoutePatterns: [],
          listingMarkers: [],
        },
        apply: {
          applyPath: "unknown",
          authMarkers: [],
          consentMarkers: [],
          questionSurfaceHints: [],
          resumeUploadHints: [],
        },
        reliability: {
          selectorFingerprints: [],
          stableControlNames: [],
          failureFingerprints: [],
          verifiedAt: null,
          freshnessNotes: [],
        },
        overrides: {
          forceMethod: null,
          deniedRoutePatterns: [],
          extraStartingRoutes: [],
        },
      },
    });

    expect(
      deriveSourceDebugStartingUrls(target, artifact, "search_filter_probe"),
    ).toEqual([
      "https://example.com/jobs/search",
      "https://example.com/vacancies",
      "https://example.com/careers",
    ]);
  });

  test("prefers a concrete guided query url for search filter probe when preferences are available", () => {
    const target = createSearchSurfaceTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_guided_source_debug_query_first",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_guided_source_debug_query_first",
      basedOnAttemptIds: ["debug_attempt_guided_source_debug_query_first"],
      notes:
        "Prefer concrete guided query route over collections during source-debug search probing.",
      navigationGuidance: [
        "Show all top job picks for you opens https://www.linkedin.com/jobs/collections/recommended/.",
      ],
      searchGuidance: [
        "Use https://www.linkedin.com/jobs/search/ to reach job results directly.",
      ],
      detailGuidance: [],
      applyGuidance: [],
      warnings: [],
      versionInfo: {
        promptProfileVersion: "v1",
        toolsetVersion: "v1",
        adapterVersion: "v1",
        appSchemaVersion: "v1",
      },
      verification: null,
      intelligence: {
        provider: {
          key: "linkedin",
          label: "LinkedIn Jobs",
          confidence: 0.98,
          apiAvailability: "not_supported",
          publicApiUrlTemplate: null,
          boardToken: null,
          boardSlug: null,
          providerIdentifier: "linkedin_jobs",
        },
        collection: {
          preferredMethod: "listing_route",
          rankedMethods: ["listing_route", "careers_page", "fallback_search"],
          startingRoutes: [
            {
              url: "https://www.linkedin.com/jobs/collections/recommended/",
              label: "Recommended collection",
              kind: "collection",
              confidence: 0.92,
            },
            {
              url: "https://www.linkedin.com/jobs/search/",
              label: "Generic search route",
              kind: "search",
              confidence: 0.9,
            },
          ],
          searchRouteTemplates: [
            {
              url: "https://www.linkedin.com/jobs/search/",
              label: "Generic search template",
              kind: "search",
              confidence: 0.95,
            },
          ],
          detailRoutePatterns: [],
          listingMarkers: [],
        },
        apply: {
          applyPath: "unknown",
          authMarkers: [],
          consentMarkers: [],
          questionSurfaceHints: [],
          resumeUploadHints: [],
        },
        reliability: {
          selectorFingerprints: [],
          stableControlNames: [],
          failureFingerprints: [],
          verifiedAt: null,
          freshnessNotes: [],
        },
        overrides: {
          forceMethod: null,
          deniedRoutePatterns: [],
          extraStartingRoutes: [],
        },
      },
    });

    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });

    expect(
      deriveSourceDebugStartingUrls(
        target,
        artifact,
        "search_filter_probe",
        searchPreferences,
      ),
    ).toEqual([
      "https://www.linkedin.com/jobs/search/",
      "https://www.linkedin.com/feed/",
      "https://www.linkedin.com/jobs/collections/recommended/",
    ]);
  });

  test("prefers a guided homepage query url for search filter probe when preferences are available", () => {
    const target: JobDiscoveryTarget = {
      id: "kosovajob_default",
      label: "KosovaJob",
      startingUrl: "https://kosovajob.com/",
      enabled: true,
      adapterKind: "auto",
      customInstructions: null,
      instructionStatus: "draft",
      validatedInstructionId: null,
      draftInstructionId: null,
      lastDebugRunId: null,
      lastVerifiedAt: null,
      staleReason: null,
    };
    const artifact = createSourceInstructionArtifact({
      id: "instruction_kosovajob_source_debug_query_first",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-23T18:04:00.000Z",
      updatedAt: "2026-04-23T18:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_kosovajob_source_debug_query_first",
      basedOnAttemptIds: ["debug_attempt_kosovajob_source_debug_query_first"],
      notes:
        "Prefer concrete homepage query over generic route guesses during search probing.",
      navigationGuidance: [],
      searchGuidance: [
        "Homepage query parameters like ?q=software change results while /jobs returns 404.",
      ],
      detailGuidance: [],
      applyGuidance: [],
      warnings: [],
      versionInfo: {
        promptProfileVersion: "v1",
        toolsetVersion: "v1",
        adapterVersion: "v1",
        appSchemaVersion: "v1",
      },
      verification: null,
      intelligence: {
        provider: null,
        collection: {
          preferredMethod: "listing_route",
          rankedMethods: ["listing_route", "careers_page", "fallback_search"],
          startingRoutes: [],
          searchRouteTemplates: [],
          detailRoutePatterns: [],
          listingMarkers: [],
        },
        apply: {
          applyPath: "unknown",
          authMarkers: [],
          consentMarkers: [],
          questionSurfaceHints: [],
          resumeUploadHints: [],
        },
        reliability: {
          selectorFingerprints: [],
          stableControlNames: [],
          failureFingerprints: [],
          verifiedAt: null,
          freshnessNotes: [],
        },
        overrides: {
          forceMethod: null,
          deniedRoutePatterns: [],
          extraStartingRoutes: [],
        },
      },
    });

    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });

    expect(
      deriveSourceDebugStartingUrls(
        target,
        artifact,
        "search_filter_probe",
        searchPreferences,
      ),
    ).toEqual(["https://kosovajob.com/?q=software", "https://kosovajob.com/"]);
  });
});

describe("resolveSourceDebugPhases", () => {
  test("keeps complete browser fallback coverage when a public provider API is unavailable at runtime", () => {
    expect(
      resolveSourceDebugPhases({
        target: createPublicProviderTarget(),
        instructionArtifact: null,
      }),
    ).toEqual(["site_structure_mapping", "replay_verification"]);
  });

  test("falls back to inferred intelligence when persisted intelligence is malformed", () => {
    const instructionArtifact = createSourceInstructionArtifact({
      id: "instruction_malformed_intelligence",
      targetId: createPublicProviderTarget().id,
      status: "draft",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_malformed_intelligence",
      basedOnAttemptIds: ["debug_attempt_malformed_intelligence"],
      notes: null,
      navigationGuidance: [],
      searchGuidance: [],
      detailGuidance: [],
      applyGuidance: [],
      warnings: [],
      versionInfo: {
        promptProfileVersion: "v1",
        toolsetVersion: "v1",
        adapterVersion: "v1",
        appSchemaVersion: "v1",
      },
      verification: null,
      intelligence: {
        provider: null,
        collection: {
          preferredMethod: "listing_route",
          rankedMethods: ["listing_route", "careers_page", "fallback_search"],
          startingRoutes: [],
          searchRouteTemplates: [],
          detailRoutePatterns: [],
          listingMarkers: [],
        },
        apply: {
          applyPath: "unknown",
          authMarkers: [],
          consentMarkers: [],
          questionSurfaceHints: [],
          resumeUploadHints: [],
        },
        reliability: {
          selectorFingerprints: [],
          stableControlNames: [],
          failureFingerprints: [],
          verifiedAt: null,
          freshnessNotes: [],
        },
        overrides: {
          forceMethod: null,
          deniedRoutePatterns: [],
          extraStartingRoutes: [],
        },
      },
    });
    // Simulate malformed persisted intelligence while keeping the rest of the artifact intact.
    (instructionArtifact as unknown as { intelligence: unknown }).intelligence =
      {
        bad: true,
      };

    expect(
      resolveSourceDebugPhases({
        target: createPublicProviderTarget(),
        instructionArtifact,
      }),
    ).toEqual(["site_structure_mapping", "replay_verification"]);
  });
});

describe("getSourceDebugMaxSteps", () => {
  test("reduces non-auth phase budgets when reusable route context already exists", () => {
    expect(
      getSourceDebugMaxSteps("search_filter_probe", {
        hasLearnedRouteHints: true,
        hasPriorPhaseSummary: true,
        hasExistingInstructionArtifact: true,
      }),
    ).toBe(10);

    expect(
      getSourceDebugMaxSteps("access_auth_probe", {
        hasLearnedRouteHints: true,
        hasPriorPhaseSummary: true,
        hasExistingInstructionArtifact: true,
      }),
    ).toBe(16);
  });
});

describe("deriveSourceDebugStartingUrls bucketing", () => {
  test("lets url classification win over line text and filters detail/apply routes before bucketing", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_bucket_route_kinds",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_bucket_route_kinds",
      basedOnAttemptIds: ["debug_attempt_bucket_route_kinds"],
      notes: null,
      navigationGuidance: [
        "Search entry path mention https://example.com/jobs/view/123 should still be treated like a landing or detail-classified url, not a search route.",
        "Apply path mention https://example.com/apply/123 should be ignored for starting-url reuse.",
      ],
      searchGuidance: [],
      detailGuidance: [],
      applyGuidance: [],
      warnings: [],
      versionInfo: {
        promptProfileVersion: "v1",
        toolsetVersion: "v1",
        adapterVersion: "v1",
        appSchemaVersion: "v1",
      },
      verification: null,
      intelligence: {
        provider: null,
        collection: {
          preferredMethod: "listing_route",
          rankedMethods: ["listing_route", "careers_page", "fallback_search"],
          startingRoutes: [],
          searchRouteTemplates: [],
          detailRoutePatterns: [],
          listingMarkers: [],
        },
        apply: {
          applyPath: "unknown",
          authMarkers: [],
          consentMarkers: [],
          questionSurfaceHints: [],
          resumeUploadHints: [],
        },
        reliability: {
          selectorFingerprints: [],
          stableControlNames: [],
          failureFingerprints: [],
          verifiedAt: null,
          freshnessNotes: [],
        },
        overrides: {
          forceMethod: null,
          deniedRoutePatterns: [],
          extraStartingRoutes: [],
        },
      },
    });

    expect(
      deriveSourceDebugStartingUrls(target, artifact, "search_filter_probe"),
    ).toEqual(["https://example.com/careers"]);
  });
});
