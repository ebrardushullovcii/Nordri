import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  JobPostingSchema,
  type JobDiscoveryTarget,
  type JobSearchPreferences,
  type JobSource,
} from "@nordri/contracts";

import {
  applyDiscoveryTitleTriage,
  buildDiscoveryStartingUrls,
  collectPublicProviderJobs,
  inferSourceIntelligenceFromTarget,
  resolveRouteKindForReuse,
} from "./workspace-source-intelligence";
import {
  createSeed,
  createSourceInstructionArtifact,
} from "../workspace-service.test-fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

function createGreenhouseTarget(): JobDiscoveryTarget {
  return {
    id: "greenhouse_remote",
    label: "Remote Greenhouse",
    startingUrl: "https://job-boards.greenhouse.io/remote",
    enabled: true,
    adapterKind: "auto",
    customInstructions: null,
    instructionStatus: "missing",
    validatedInstructionId: null,
    draftInstructionId: null,
    lastDebugRunId: null,
    lastVerifiedAt: null,
    staleReason: null,
  };
}

function createLeverTarget(): JobDiscoveryTarget {
  return {
    id: "lever_aircall",
    label: "Aircall Lever",
    startingUrl: "https://jobs.lever.co/aircall",
    enabled: true,
    adapterKind: "auto",
    customInstructions: null,
    instructionStatus: "missing",
    validatedInstructionId: null,
    draftInstructionId: null,
    lastDebugRunId: null,
    lastVerifiedAt: null,
    staleReason: null,
  };
}

function createEuropeanLeverTarget(): JobDiscoveryTarget {
  return {
    ...createLeverTarget(),
    id: "lever_olx_europe",
    label: "OLX Lever Europe",
    startingUrl: "https://jobs.eu.lever.co/olx",
  };
}

function createAshbyTarget(): JobDiscoveryTarget {
  return {
    ...createGreenhouseTarget(),
    id: "ashby_constructor",
    label: "Constructor Ashby",
    startingUrl: "https://jobs.ashbyhq.com/constructor/ashby_job_1",
  };
}

function createWorkdayTarget(): JobDiscoveryTarget {
  return {
    ...createGreenhouseTarget(),
    id: "workday_amat",
    label: "Applied Materials Workday",
    startingUrl:
      "https://amat.wd1.myworkdayjobs.com/en-US/External/job/SingaporeSGP/Software-Engineer_R2612079",
  };
}

function createUnknownCareersTarget(): JobDiscoveryTarget {
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
  };
}

function createSearchSurfaceTarget(): JobDiscoveryTarget {
  return {
    id: "linkedin_default",
    label: "LinkedIn Jobs",
    startingUrl: "https://www.linkedin.com/jobs/",
    enabled: true,
    adapterKind: "auto",
    customInstructions: null,
    instructionStatus: "missing",
    validatedInstructionId: null,
    draftInstructionId: null,
    lastDebugRunId: null,
    lastVerifiedAt: null,
    staleReason: null,
  };
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
      collectOnlyHardCriteriaMatches: true,
    },
    ...overrides,
  };
}

function createLearnedSearchRoutesArtifact(input: {
  targetId: string;
  searchRouteTemplateUrl: string;
}) {
  return createSourceInstructionArtifact({
    id: `instruction_${input.targetId}_learned_search`,
    targetId: input.targetId,
    status: "draft",
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:01:00.000Z",
    acceptedAt: null,
    basedOnRunId: `debug_run_${input.targetId}_learned_search`,
    basedOnAttemptIds: [`debug_attempt_${input.targetId}_learned_search`],
    notes: null,
    navigationGuidance: [
      "Search accepts query parameters like ?keywords=engineer&location=remote.",
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
        rankedMethods: ["listing_route", "fallback_search"],
        startingRoutes: [],
        searchRouteTemplates: [
          {
            url: input.searchRouteTemplateUrl,
            label: "Learned search route",
            kind: "search",
            confidence: 0.9,
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
}

test("keeps jobs outside soft preferences visible unless strict collection is enabled", () => {
  const seed = createSeed();
  const posting = createPosting({
    title: "Product Designer",
    location: "Toronto, Canada",
    workMode: ["onsite"],
  });
  const broadPreferences = createSearchPreferences({
    targetRoles: ["Senior Software Engineer"],
    locations: ["Berlin, Germany"],
    workModes: ["remote"],
    discovery: {
      targets: [],
      historyLimit: 5,
      collectOnlyHardCriteriaMatches: false,
    },
  });

  expect(
    applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences: broadPreferences,
    }),
  ).toEqual({ outcome: "pass", reason: null });
});

test("skips a sign-in wall captured as a job even when broad discovery is enabled", () => {
  const seed = createSeed();
  const posting = createPosting({
    title: "Customer Service",
    company: "Linkedin",
    summary: "Get notified about new Customer Service jobs in San Antonio.",
    description:
      "Sign in to continue. Welcome back. Email or phone. Password. New to LinkedIn? Join now. Get notified about new Customer Service jobs in San Antonio, TX.",
  });

  expect(
    applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences: createSearchPreferences({
        discovery: {
          targets: [],
          historyLimit: 5,
          collectOnlyHardCriteriaMatches: false,
        },
      }),
    }),
  ).toEqual({
    outcome: "skip_title",
    reason:
      "This page asks you to sign in or create an account; it is not a job listing.",
  });
});

test("skips generic talent-pool invitations even when broad discovery is enabled", () => {
  const seed = createSeed();
  const posting = createPosting({
    title: "Keep me in mind!",
  });
  const broadPreferences = createSearchPreferences({
    targetRoles: ["Marketing Coordinator"],
    discovery: {
      targets: [],
      historyLimit: 5,
      collectOnlyHardCriteriaMatches: false,
    },
  });

  expect(
    applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences: broadPreferences,
    }),
  ).toEqual({
    outcome: "skip_title",
    reason:
      "This is a general talent-pool invitation rather than a specific open role.",
  });
});

test("always skips an explicitly excluded location", () => {
  const seed = createSeed();
  const posting = createPosting({
    location: "Toronto, Canada",
  });
  const searchPreferences = createSearchPreferences({
    excludedLocations: ["Toronto, Canada"],
    discovery: {
      targets: [],
      historyLimit: 5,
      collectOnlyHardCriteriaMatches: false,
    },
  });

  expect(
    applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    }),
  ).toEqual({
    outcome: "skip_location",
    reason: "Location is explicitly excluded.",
  });
});

function createPosting(
  overrides: Partial<ReturnType<typeof JobPostingSchema.parse>> = {},
) {
  return JobPostingSchema.parse({
    source: "target_site",
    sourceJobId: "job_1",
    discoveryMethod: "browser_agent",
    collectionMethod: "fallback_search",
    canonicalUrl: "https://example.com/jobs/job_1",
    applicationUrl: null,
    title: "Software Engineer",
    company: "Example Co",
    location: "Remote",
    workMode: ["remote"],
    applyPath: "unknown",
    easyApplyEligible: false,
    postedAt: null,
    postedAtText: null,
    discoveredAt: "2026-03-20T10:00:00.000Z",
    firstSeenAt: null,
    lastSeenAt: null,
    lastVerifiedActiveAt: null,
    salaryText: null,
    summary: "Build product features.",
    description: "Build product features with TypeScript and React.",
    keySkills: ["TypeScript", "React"],
    responsibilities: [],
    minimumQualifications: [],
    preferredQualifications: [],
    seniority: null,
    employmentType: null,
    department: null,
    team: null,
    employerWebsiteUrl: null,
    employerDomain: null,
    atsProvider: null,
    providerKey: null,
    providerBoardToken: null,
    providerIdentifier: null,
    titleTriageOutcome: "pass",
    sourceIntelligence: null,
    screeningHints: {},
    keywordSignals: [],
    benefits: [],
    ...overrides,
  });
}

async function collectGreenhouseJobs(
  updatedAt: string | null,
  content = "<p>Teach software engineering.</p>",
) {
  const target = createGreenhouseTarget();
  const intelligence = inferSourceIntelligenceFromTarget({
    target,
    currentArtifact: null,
  });
  const source: JobSource = "target_site";

  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        jobs: [
          {
            id: 4622190,
            title: "SEI Instructor Lead",
            absolute_url:
              "https://job-boards.greenhouse.io/remote/jobs/4622190",
            location: { name: "New York, NY" },
            updated_at: updatedAt,
            content,
          },
        ],
      }),
  } as Response);

  return collectPublicProviderJobs({
    target,
    artifact: { intelligence },
    source,
  });
}

describe("collectPublicProviderJobs", () => {
  test("decodes escaped provider markup before summarizing the job", async () => {
    const result = await collectGreenhouseJobs(
      null,
      "&lt;div class=&quot;content-intro&quot;&gt;&lt;strong&gt;About the role:&lt;/strong&gt;&lt;/div&gt;" +
        "&lt;p&gt;Build React &amp;amp; TypeScript interfaces. Ship &#8220;accessible&#8221; UI.&lt;/p&gt;" +
        "&lt;script&gt;ignore this script&lt;/script&gt;",
    );
    expect(result.jobs[0]?.description).toBe(
      "About the role:\n\nBuild React & TypeScript interfaces. Ship “accessible” UI.",
    );
    expect(result.jobs[0]?.summary).toBe(
      "About the role: Build React & TypeScript interfaces. Ship “accessible” UI.",
    );
  });
  test("collects current Ashby board jobs through the reusable posting API", async () => {
    const target = createAshbyTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          jobs: [
            {
              id: "ashby_job_1",
              title: "Software Engineer: Core",
              location: "Remote - EMEA",
              publishedAt: "2026-06-04T12:01:47.857+02:00",
              workplaceType: "Remote",
              employmentType: "FullTime",
              department: "Engineering",
              team: "Core",
              jobUrl: "https://jobs.ashbyhq.com/constructor/ashby_job_1",
              applyUrl:
                "https://jobs.ashbyhq.com/constructor/ashby_job_1/application",
              descriptionPlain: "Build high-availability backend systems.",
            },
          ],
        }),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(intelligence.provider).toMatchObject({
      key: "ashby",
      apiAvailability: "available",
      boardSlug: "constructor",
      publicApiUrlTemplate:
        "https://api.ashbyhq.com/posting-api/job-board/constructor",
    });
    expect(result.warning).toBeNull();
    expect(result.jobs[0]).toMatchObject({
      sourceJobId: "ashby_job_1",
      company: "Constructor",
      canonicalUrl: target.startingUrl,
      applicationUrl:
        "https://jobs.ashbyhq.com/constructor/ashby_job_1/application",
      providerKey: "ashby",
      workMode: ["remote"],
      employerDomain: null,
    });
  });

  test("collects an exact Workday job through its public candidate-experience endpoint", async () => {
    const target = createWorkdayTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          jobPostingInfo: {
            jobReqId: "R2612079",
            title: "Software Engineer",
            location: "Singapore,SGP",
            externalUrl:
              "https://amat.wd1.myworkdayjobs.com/External/job/SingaporeSGP/Software-Engineer_R2612079",
            jobDescription: "<p>Build software for semiconductor systems.</p>",
            startDate: "2026-02-02",
            timeType: "Full time",
          },
        }),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(intelligence.provider).toMatchObject({
      key: "workday",
      apiAvailability: "available",
      boardSlug: "External",
      publicApiUrlTemplate:
        "https://amat.wd1.myworkdayjobs.com/wday/cxs/amat/External/job/SingaporeSGP/Software-Engineer_R2612079",
    });
    expect(result.warning).toBeNull();
    expect(result.jobs[0]).toMatchObject({
      sourceJobId: "R2612079",
      canonicalUrl: target.startingUrl,
      providerKey: "workday",
      description: "Build software for semiconductor systems.",
      employerDomain: null,
    });
  });

  test("prioritizes an exact provider job URL before applying collection caps", async () => {
    const target = {
      ...createGreenhouseTarget(),
      startingUrl:
        "https://job-boards.greenhouse.io/remote/jobs/target_job?gh_src=test",
    };
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          jobs: [
            {
              id: "unrelated_job",
              title: "Unrelated role",
              absolute_url:
                "https://job-boards.greenhouse.io/remote/jobs/unrelated_job",
              location: { name: "Remote" },
              content: "<p>Unrelated role.</p>",
            },
            {
              id: "target_job",
              title: "Software Engineer",
              absolute_url:
                "https://job-boards.greenhouse.io/remote/jobs/target_job",
              location: { name: "Remote" },
              content: "<p>Build software.</p>",
            },
          ],
        }),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.jobs.map((job) => job.sourceJobId)).toEqual([
      "target_job",
      "unrelated_job",
    ]);
  });

  test("maps Greenhouse updated_at to providerUpdatedAt without claiming a posted date", async () => {
    const result = await collectGreenhouseJobs("2024-07-24T16:08:01-04:00");

    expect(result.warning).toBeNull();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.postedAt).toBeNull();
    expect(result.jobs[0]?.providerUpdatedAt).toBe("2024-07-24T20:08:01.000Z");
  });

  test("keeps Greenhouse jobs when provider timestamps are invalid", async () => {
    const result = await collectGreenhouseJobs("not-a-date");

    expect(result.warning).toBeNull();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.postedAt).toBeNull();
    expect(result.jobs[0]?.providerUpdatedAt).toBeNull();
  });

  test("keeps Lever posting dates on postedAt with providerUpdatedAt untouched", async () => {
    const target = createLeverTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "lever_job_1",
            text: "Senior Engineer",
            createdAt: "2024-07-24T16:08:01-04:00",
            hostedUrl: "https://jobs.lever.co/aircall/lever_job_1",
            applyUrl: null,
            descriptionPlain: "Build platform features.",
            categories: {
              location: "Remote",
            },
          },
        ]),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.warning).toBeNull();
    expect(result.jobs[0]?.postedAt).toBe("2024-07-24T20:08:01.000Z");
    expect(result.jobs[0]?.providerUpdatedAt).toBeNull();
  });

  test("skips isolated malformed records while collecting the rest of the board", async () => {
    const target = createGreenhouseTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });
    const records: Array<Record<string, unknown> | string | null> = Array.from(
      { length: 49 },
      (_, index) => ({
        id: index + 1,
        title: `Software Engineer ${index + 1}`,
        absolute_url: `https://job-boards.greenhouse.io/remote/jobs/${index + 1}`,
        location: { name: "Remote" },
        content: "<p>Build software.</p>",
      }),
    );
    records.splice(7, 0, "malformed-provider-record");
    expect(records).toHaveLength(50);

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jobs: records }),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.jobs).toHaveLength(49);
    expect(result.jobs.find((job) => job.sourceJobId === "8")?.title).toBe(
      "Software Engineer 8",
    );
    expect(result.warning).toBe(
      "Skipped 1 malformed Greenhouse job record from the public API response.",
    );
  });

  test("fails collection when every record in the payload is malformed", async () => {
    const target = createGreenhouseTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ jobs: [null, 42, "malformed-provider-record"] }),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.jobs).toEqual([]);
    expect(result.warning).toBe(
      "Public provider API collection failed: Public provider API returned an invalid payload.",
    );
  });

  test("normalizes stringified numeric provider timestamps", async () => {
    const target = createLeverTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "lever_job_1",
            text: "Senior Engineer",
            createdAt: "1721851681000",
            hostedUrl: "https://jobs.lever.co/aircall/lever_job_1",
            applyUrl: null,
            descriptionPlain: "Build platform features.",
            additionalPlain: "Remote-friendly engineering culture.",
            workplaceType: "hybrid",
            lists: [
              {
                text: "What we're looking for",
                content:
                  "<p>Production experience with React and TypeScript.</p>",
              },
            ],
            categories: {
              location: "Madrid Office",
            },
          },
        ]),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.warning).toBeNull();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.postedAt).toBe("2024-07-24T20:08:01.000Z");
    expect(result.jobs[0]?.description).toContain(
      "Production experience with React and TypeScript.",
    );
    expect(result.jobs[0]?.workMode).toContain("hybrid");
  });

  test.each([
    ["onsite", ["onsite"]],
    ["on-site", ["onsite"]],
    ["on site", ["onsite"]],
    ["hybrid / on-site", ["hybrid"]],
    ["remote or on-site", ["remote"]],
    ["not onsite", []],
    ["not on-site", []],
    ["not an on site role", []],
  ])(
    "preserves explicit provider work mode %s",
    async (workplaceType, expected) => {
      const target = createLeverTarget();
      const intelligence = inferSourceIntelligenceFromTarget({
        target,
        currentArtifact: null,
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json([
          {
            id: "paris-onsite",
            text: "Frontend Engineer",
            hostedUrl: "https://jobs.lever.co/aircall/paris-onsite",
            categories: { location: "Paris, France" },
            workplaceType,
            descriptionPlain:
              "Build accessible React and TypeScript interfaces.",
          },
        ]),
      );
      const result = await collectPublicProviderJobs({
        target,
        artifact: { intelligence },
        source: "target_site",
      });
      const posting = result.jobs[0]!;
      expect(posting.workMode).toEqual(expected);
      if (expected[0] === "onsite") {
        const searchPreferences = createSearchPreferences({
          targetRoles: ["Frontend Engineer"],
          locations: ["Berlin, Germany"],
          discovery: {
            targets: [],
            historyLimit: 5,
            collectOnlyHardCriteriaMatches: true,
            remoteCountsAsAnyLocation: true,
          },
        });
        expect(
          applyDiscoveryTitleTriage({
            posting,
            profile: createSeed().profile,
            searchPreferences,
          }).outcome,
        ).toBe("skip_location");
      }
    },
  );

  test("uses the European Lever API for EU-hosted boards", () => {
    const intelligence = inferSourceIntelligenceFromTarget({
      target: createEuropeanLeverTarget(),
      currentArtifact: null,
    });
    const provider = intelligence.provider;

    expect(provider).not.toBeNull();
    if (!provider) {
      throw new Error("Expected EU Lever source intelligence.");
    }

    expect(provider.key).toBe("lever");
    expect(provider.publicApiUrlTemplate).toBe(
      "https://api.eu.lever.co/v0/postings/olx?mode=json",
    );
  });

  test("returns a clear timeout warning when the Greenhouse API hangs", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      new AbortController().signal,
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Timed out", "AbortError"),
    );

    const target = createGreenhouseTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.jobs).toEqual([]);
    expect(result.warning).toBe(
      "Public provider API collection failed: Greenhouse API request timed out.",
    );
  });

  test("returns a clear timeout warning when the Lever API hangs", async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(new AbortController().signal);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Timed out", "AbortError"),
    );

    const target = createLeverTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.jobs).toEqual([]);
    expect(result.warning).toBe(
      "Public provider API collection failed: Lever API request timed out.",
    );
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  test("normalizes Lever createdAt timestamps when present", async () => {
    const target = createLeverTarget();
    const intelligence = inferSourceIntelligenceFromTarget({
      target,
      currentArtifact: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: "lever_job_1",
            text: "Senior Engineer",
            createdAt: "2024-07-24T16:08:01-04:00",
            hostedUrl: "https://jobs.lever.co/aircall/lever_job_1",
            applyUrl: null,
            descriptionPlain: "Build platform features.",
            categories: {
              location: "Remote",
            },
          },
        ]),
    } as Response);

    const result = await collectPublicProviderJobs({
      target,
      artifact: { intelligence },
      source: "target_site",
    });

    expect(result.warning).toBeNull();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.postedAt).toBe("2024-07-24T20:08:01.000Z");
  });

  test("infers a route-backed no-artifact collection method from the target URL", () => {
    const intelligence = inferSourceIntelligenceFromTarget({
      target: createUnknownCareersTarget(),
      currentArtifact: null,
    });

    expect(intelligence.collection.preferredMethod).toBe("careers_page");
  });

  test("prefers learned discovery routes before the raw target starting URL", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_unknown_careers_learned_routes",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_unknown_careers",
      basedOnAttemptIds: ["debug_attempt_unknown_careers"],
      notes:
        "Prefer learned jobs routes before the generic careers landing page.",
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
          startingRoutes: [
            {
              url: target.startingUrl,
              label: "Starting URL",
              kind: "listing",
              confidence: 0.6,
            },
            {
              url: "https://example.com/jobs/recommended",
              label: "Learned jobs collection",
              kind: "collection",
              confidence: 0.88,
            },
          ],
          searchRouteTemplates: [
            {
              url: "https://example.com/jobs/search",
              label: "Learned search route",
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
          extraStartingRoutes: ["https://example.com/jobs/curated"],
        },
      },
    });

    expect(buildDiscoveryStartingUrls(target, artifact)).toEqual([
      "https://example.com/jobs/curated",
      "https://example.com/jobs/search",
      "https://example.com/jobs/recommended",
      "https://example.com/careers",
    ]);
  });

  test("filters broken and templated learned routes before reusing discovery starting urls", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_unknown_careers_filtered_routes",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_unknown_careers_filtered_routes",
      basedOnAttemptIds: ["debug_attempt_unknown_careers_filtered_routes"],
      notes: "Broken and templated routes should not be reused.",
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
          startingRoutes: [
            {
              url: target.startingUrl,
              label: "Starting URL",
              kind: "listing",
              confidence: 0.6,
            },
            {
              url: "https://example.com/jobs/search?currentJobId=123",
              label: "Search route with unstable query",
              kind: "search",
              confidence: 0.9,
            },
            {
              url: "https://example.com/{slug}",
              label: "Templated route",
              kind: "listing",
              confidence: 0.4,
            },
            {
              url: "https://example.com/404",
              label: "Broken route",
              kind: "listing",
              confidence: 0.2,
            },
            {
              url: "https://example.com/jobs/view/123",
              label: "Detail route",
              kind: "detail",
              confidence: 0.5,
            },
          ],
          searchRouteTemplates: [
            {
              url: "https://example.com/jobs/search?selectedJobId=456",
              label: "Search template with unstable query",
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

    expect(buildDiscoveryStartingUrls(target, artifact)).toEqual([
      "https://example.com/jobs/search",
      "https://example.com/careers",
    ]);
  });

  test("prefers a concrete guided query url over generic learned routes when search preferences are available", () => {
    const target = createSearchSurfaceTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_guided_query_first",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-03-20T10:04:00.000Z",
      updatedAt: "2026-03-20T10:05:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_guided_query_first",
      basedOnAttemptIds: ["debug_attempt_guided_query_first"],
      notes: "Prefer concrete query entry over generic collections.",
      navigationGuidance: [],
      searchGuidance: [
        "URL-based search works with parameters like ?keywords=frontend&location=kosovo.",
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
      buildDiscoveryStartingUrls(target, artifact, searchPreferences),
    ).toEqual([
      "https://www.linkedin.com/jobs/search/?keywords=software&location=Prishtina%2C+Kosovo",
      "https://www.linkedin.com/jobs/search/",
      "https://www.linkedin.com/jobs/collections/recommended/",
      "https://www.linkedin.com/jobs/",
    ]);
  });

  test("falls back to only the configured starting url when no learned source guidance exists", () => {
    const target = createSearchSurfaceTarget();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: [],
      workModes: ["remote"],
    });

    expect(buildDiscoveryStartingUrls(target, null, searchPreferences)).toEqual(
      ["https://www.linkedin.com/jobs/"],
    );
  });

  test("prefers a guided homepage query url when source-debug proves a generic q filter", () => {
    const target = {
      id: "kosovajob",
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
    } satisfies JobDiscoveryTarget;
    const artifact = createSourceInstructionArtifact({
      id: "instruction_kosovajob_query_first",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-23T18:00:00.000Z",
      updatedAt: "2026-04-23T18:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_kosovajob_query_first",
      basedOnAttemptIds: ["debug_attempt_kosovajob_query_first"],
      notes: "Prefer homepage query parameters over generic route guesses.",
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
          startingRoutes: [
            {
              url: "https://kosovajob.com/jobs",
              label: "Observed route",
              kind: "listing",
              confidence: 0.84,
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

    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });

    expect(
      buildDiscoveryStartingUrls(target, artifact, searchPreferences),
    ).toEqual(["https://kosovajob.com/?q=software", "https://kosovajob.com/"]);
  });

  test("does not reuse search routes that the instruction guidance explicitly disproved", () => {
    const target = {
      id: "kosovajob",
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
    } satisfies JobDiscoveryTarget;
    const artifact = createSourceInstructionArtifact({
      id: "instruction_kosovajob_disproved_search_route",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-23T03:00:00.000Z",
      updatedAt: "2026-04-23T03:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_kosovajob_disproved_search_route",
      basedOnAttemptIds: ["debug_attempt_kosovajob_disproved_search_route"],
      notes: null,
      navigationGuidance: [],
      searchGuidance: [
        "Filter note: /search route returns 404 - not a working search endpoint",
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
              kind: "anchor",
              confidence: 0.6,
            },
            {
              url: "https://kosovajob.com/search",
              label: "Observed route",
              kind: "search",
              confidence: 0.84,
            },
            {
              url: "https://kosovajob.com/jobs",
              label: "Observed route",
              kind: "listing",
              confidence: 0.84,
            },
          ],
          searchRouteTemplates: [
            {
              url: "https://kosovajob.com/search",
              label: "Observed route",
              kind: "search",
              confidence: 0.84,
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

    expect(buildDiscoveryStartingUrls(target, artifact)).toEqual([
      "https://kosovajob.com/jobs",
      "https://kosovajob.com/",
    ]);
  });

  test("does not re-add the starting url when it is denied by learned guidance", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_unknown_careers_denied_starting_url",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_unknown_careers_denied_starting_url",
      basedOnAttemptIds: ["debug_attempt_unknown_careers_denied_starting_url"],
      notes: null,
      navigationGuidance: [],
      searchGuidance: [
        "https://example.com/careers returns 404 and should not be reused.",
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
          searchRouteTemplates: [
            {
              url: "https://example.com/jobs/search",
              label: "Search route",
              kind: "search",
              confidence: 0.9,
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

    expect(buildDiscoveryStartingUrls(target, artifact)).toEqual([
      "https://example.com/jobs/search",
    ]);
  });

  test("returns no discovery starting urls when every learned route and the target starting url are denied", () => {
    const target = createUnknownCareersTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_unknown_careers_all_routes_denied",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_unknown_careers_all_routes_denied",
      basedOnAttemptIds: ["debug_attempt_unknown_careers_all_routes_denied"],
      notes: null,
      navigationGuidance: [],
      searchGuidance: [
        "https://example.com/careers returns 404 and should not be reused.",
        "https://example.com/jobs/search returns 404 and should not be reused.",
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
          searchRouteTemplates: [
            {
              url: "https://example.com/jobs/search",
              label: "Search route",
              kind: "search",
              confidence: 0.9,
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

    expect(buildDiscoveryStartingUrls(target, artifact)).toEqual([]);
  });

  test("clears stale query params from guided search templates before building the final url", () => {
    const target = createSearchSurfaceTarget();
    const artifact = createSourceInstructionArtifact({
      id: "instruction_guided_query_clears_stale_params",
      targetId: target.id,
      status: "draft",
      createdAt: "2026-04-24T00:00:00.000Z",
      updatedAt: "2026-04-24T00:01:00.000Z",
      acceptedAt: null,
      basedOnRunId: "debug_run_guided_query_clears_stale_params",
      basedOnAttemptIds: ["debug_attempt_guided_query_clears_stale_params"],
      notes: "Use a clean search template before setting query params.",
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
          startingRoutes: [],
          searchRouteTemplates: [
            {
              url: "https://www.linkedin.com/jobs/search/?keywords=placeholder&location=old",
              label: "Templated search route",
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
      buildDiscoveryStartingUrls(target, artifact, searchPreferences)[0],
    ).toBe(
      "https://www.linkedin.com/jobs/search/?keywords=software&location=Prishtina%2C+Kosovo",
    );
  });

  test("builds guided queries only from each target's own learned evidence regardless of host", () => {
    const linkedinTarget = createSearchSurfaceTarget();
    const genericTarget = {
      ...linkedinTarget,
      id: "generic_jobs_hub",
      label: "Generic Jobs Hub",
      startingUrl: "https://jobs.example.com/hub/",
    };
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: [],
      workModes: ["remote"],
    });

    expect(
      buildDiscoveryStartingUrls(
        linkedinTarget,
        createLearnedSearchRoutesArtifact({
          targetId: linkedinTarget.id,
          searchRouteTemplateUrl: "https://www.linkedin.com/jobs/search/",
        }),
        searchPreferences,
      ),
    ).toEqual([
      "https://www.linkedin.com/jobs/search/?keywords=software",
      "https://www.linkedin.com/jobs/search/",
      "https://www.linkedin.com/jobs/",
    ]);
    expect(
      buildDiscoveryStartingUrls(
        genericTarget,
        createLearnedSearchRoutesArtifact({
          targetId: genericTarget.id,
          searchRouteTemplateUrl: "https://jobs.example.com/hub/search",
        }),
        searchPreferences,
      ),
    ).toEqual([
      "https://jobs.example.com/hub/search?keywords=software",
      "https://jobs.example.com/hub/search",
      "https://jobs.example.com/hub/",
    ]);
  });

  test("keeps discovery starting-url building free of board-specific host gates and query policy", () => {
    const moduleSource = readFileSync(
      new URL("./workspace-source-intelligence.ts", import.meta.url),
      "utf8",
    );

    expect(moduleSource).not.toMatch(/geoId|f_WT/);
    expect(moduleSource).not.toMatch(/new URL\("\/jobs\/search/u);
  });

  test("does not classify kosovajob-style same-host slug detail routes as reusable listing routes", () => {
    expect(
      resolveRouteKindForReuse(
        "https://kosovajob.com/shopaz/category-manager-fashion-sports-outdoor-e-commerce",
      ),
    ).toBe("anchor");
  });
});

describe("applyDiscoveryTitleTriage", () => {
  test("Best matches only keeps role variants but skips distinct engineering roles", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
    });

    for (const title of [
      "Full Stack Developer",
      "Senior Full Stack Engineer",
    ]) {
      expect(
        applyDiscoveryTitleTriage({
          posting: createPosting({ title }),
          profile: seed.profile,
          searchPreferences,
        }).outcome,
      ).toBe("pass");
    }

    for (const title of ["Platform Engineer", "Senior Frontend Engineer"]) {
      expect(
        applyDiscoveryTitleTriage({
          posting: createPosting({ title }),
          profile: seed.profile,
          searchPreferences,
        }).outcome,
      ).toBe("skip_title");
    }
  });

  test("keeps adjacent software roles in broad collection when technical skills overlap", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Full-Stack Software Engineer",
      targetRoles: ["Senior Full-Stack Software Engineer"],
      skills: ["TypeScript", "React", "Node.js"],
      skillGroups: {
        ...seed.profile.skillGroups,
        coreSkills: ["APIs"],
        tools: ["Node.js"],
        languagesAndFrameworks: ["TypeScript", "React"],
        highlightedSkills: ["PostgreSQL"],
      },
    };
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      discovery: {
        targets: [],
        historyLimit: 5,
        collectOnlyHardCriteriaMatches: false,
      },
    });
    const posting = createPosting({
      title: "Back-End Engineer",
      keySkills: ["TypeScript", "Node.js"],
      description:
        "Build backend services with Node.js, TypeScript, and PostgreSQL.",
    });

    expect(
      applyDiscoveryTitleTriage({ posting, profile, searchPreferences })
        .outcome,
    ).toBe("pass");
  });

  test("does not widen non-technical target roles just because skills overlap", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Principal Designer"],
    });
    const posting = createPosting({
      title: "Frontend Engineer",
      keySkills: ["React"],
      description: "Build frontend workflows with React.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("skip_title");
  });

  test("does not keep non-technical roles for technical targets without technical signals", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Full-Stack Software Engineer",
      targetRoles: ["Senior Full-Stack Software Engineer"],
      skills: ["TypeScript", "React", "Node.js"],
    };
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
    });
    const posting = createPosting({
      title: "Category Manager, Fashion, Sports & Outdoor (E-Commerce)",
      keySkills: ["Merchandising", "Retail Operations"],
      description:
        "Own category planning, retail assortment, and commercial performance.",
    });

    expect(
      applyDiscoveryTitleTriage({ posting, profile, searchPreferences })
        .outcome,
    ).toBe("skip_title");
  });

  test("does not treat provider descriptions as role titles", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Software Engineer"],
    });
    const posting = createPosting({
      title: "Accountant",
      providerKey: "greenhouse",
      description:
        "Partner with software engineers and use React-based finance tooling.",
      keySkills: ["React"],
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("skip_title");
  });

  test("does not widen software searches into unrelated data or automation families", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Software Engineer", "Backend Engineer"],
    });

    for (const title of [
      "Finance Systems Data Analyst",
      "CX AI & Automation Lead",
      "Senior Data Engineer",
    ]) {
      expect(
        applyDiscoveryTitleTriage({
          posting: createPosting({
            title,
            description:
              "Work with software engineers using Python, SQL, React, and AWS.",
          }),
          profile: seed.profile,
          searchPreferences,
        }).outcome,
      ).toBe("skip_title");
    }
  });

  test("keeps adjacent technical roles in broad collection without profile skill evidence", () => {
    const seed = createSeed();
    const profile = {
      ...seed.profile,
      headline: "Senior Full-Stack Software Engineer",
      targetRoles: ["Senior Full-Stack Software Engineer"],
      skills: [],
      skillGroups: {
        ...seed.profile.skillGroups,
        coreSkills: [],
        tools: [],
        languagesAndFrameworks: [],
        highlightedSkills: [],
      },
      experiences: [],
      projects: [],
    };
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      discovery: {
        targets: [],
        historyLimit: 5,
        collectOnlyHardCriteriaMatches: false,
      },
    });
    const posting = createPosting({
      title: "Platform Engineer",
      keySkills: [],
      description:
        "Build cloud platform services and backend infrastructure for product teams.",
    });

    expect(
      applyDiscoveryTitleTriage({ posting, profile, searchPreferences })
        .outcome,
    ).toBe("pass");
  });

  test("keeps remote-friendly adjacent technical roles when strict location matching misses", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: ["remote"],
    });
    const posting = createPosting({
      title: "Fullstack Developer",
      location: "EMEA Remote",
      workMode: ["remote"],
      description: "Build full-stack product features with React and Node.js.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("pass");
  });

  test("rejects remote technical roles tied to an incompatible broad region", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: ["remote"],
    });
    const posting = createPosting({
      title: "Senior Full-Stack Software Engineer",
      location: "Remote-APAC",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("skip_location");
  });

  test("keeps lower-match technical roles in broad collection", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      discovery: {
        targets: [],
        historyLimit: 5,
        collectOnlyHardCriteriaMatches: false,
      },
    });
    const posting = createPosting({
      title: "Frontend Engineer",
      company: "Odiin",
      location: "Kosovo (Remote)",
      workMode: ["remote"],
      description:
        "Build frontend product experiences with React and TypeScript.",
      keySkills: ["React", "TypeScript"],
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("pass");
  });

  test("keeps technical roles when the clean role only survives in polluted evidence text", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });
    const posting = createPosting({
      title: "Full at Confidential Careers",
      company: "Pristina, District of",
      location: "Pristina, Kosovo (Hybrid)",
      workMode: ["hybrid"],
      summary: "Dismiss Full Stack Developer job",
      description:
        "Dismiss Full Stack Developer job Full Stack Developer Confidential Careers Pristina, Kosovo (Hybrid) Viewed Promoted React TypeScript Node.js.",
      keySkills: [],
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("pass");
  });

  test("keeps broad technical families like platform or devops in broad collection", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      discovery: {
        targets: [],
        historyLimit: 5,
        collectOnlyHardCriteriaMatches: false,
      },
    });
    const posting = createPosting({
      title: "Senior Platform Engineer (Infrastructure)",
      location: "Pristina (Hybrid)",
      workMode: ["hybrid"],
      description:
        "Build cloud infrastructure, delivery pipelines, and platform services.",
      keySkills: ["AWS", "Docker"],
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("pass");
  });

  test("does not keep remote-friendly non-technical roles when strict location matching misses", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: ["remote"],
    });
    const posting = createPosting({
      title: "Operations Manager",
      location: "EMEA Remote",
      workMode: ["remote"],
      description:
        "Own operations planning and team coordination across regions.",
      keySkills: ["Operations", "Planning"],
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("skip_title");
  });

  test("does not widen location matching when remote or hybrid work is not preferred", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
      workModes: ["onsite"],
    });
    const posting = createPosting({
      title: "Full Stack Developer",
      location: "Europe Remote",
      workMode: ["remote"],
      description:
        "Build frontend product experiences with React and TypeScript.",
    });

    const triage = applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    });

    expect(triage.outcome).toBe("skip_work_mode");
    expect(triage.reason).toBe(
      "Work mode is outside the preferred operating model.",
    );
  });

  test("keeps technical hybrid roles in nearby locations even when exact location matching is weak", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });
    const posting = createPosting({
      title: "Full Stack Developer",
      location: "Kosovo (Hybrid)",
      workMode: ["hybrid"],
      description:
        "Build frontend product experiences with React and TypeScript.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ).toBe("pass");
  });

  test("still skips clearly onsite-only technical roles outside preferred locations", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      locations: ["Prishtina, Kosovo"],
    });
    const posting = createPosting({
      title: "Senior Full-Stack Software Engineer",
      location: "Berlin, Germany",
      workMode: ["onsite"],
      description:
        "Build frontend product experiences with React and TypeScript.",
    });

    const triage = applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    });

    expect(triage.outcome).toBe("skip_location");
  });

  test("does not drop bare remote listings because of an unrelated excluded location", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      excludedLocations: ["India"],
    });
    const posting = createPosting({
      title: "Senior Full-Stack Software Engineer",
      location: "Remote",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }),
    ).toEqual({ outcome: "pass", reason: null });
  });

  test("still skips concrete listings inside an explicitly excluded place", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      excludedLocations: ["India"],
    });
    const posting = createPosting({
      title: "Senior Backend Engineer",
      location: "Bengaluru, India",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    const triage = applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    });

    expect(triage.outcome).toBe("skip_location");
    expect(triage.reason).toBe("Location is explicitly excluded.");
  });

  test("skips region-restricted remote listings that may fall inside an excluded geography", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      excludedLocations: ["India"],
    });
    const posting = createPosting({
      title: "Senior Backend Engineer",
      location: "Remote - APAC",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    const triage = applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    });

    expect(triage.outcome).toBe("skip_location");
  });

  test("keeps region-restricted remote listings proven outside every excluded geography", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      excludedLocations: ["India"],
    });
    const posting = createPosting({
      title: "Senior Full-Stack Software Engineer",
      location: "Remote - Europe",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    expect(
      applyDiscoveryTitleTriage({
        posting,
        profile: seed.profile,
        searchPreferences,
      }),
    ).toEqual({ outcome: "pass", reason: null });
  });

  test("still honors an exclusion that targets work-mode noise itself", () => {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Senior Full-Stack Software Engineer"],
      excludedLocations: ["Remote"],
    });
    const posting = createPosting({
      title: "Senior Backend Engineer",
      location: "Remote",
      workMode: ["remote"],
      description: "Build backend services with TypeScript and PostgreSQL.",
    });

    const triage = applyDiscoveryTitleTriage({
      posting,
      profile: seed.profile,
      searchPreferences,
    });

    expect(triage.outcome).toBe("skip_location");
  });
});

describe("strict triage and the remote setting", () => {
  const remotePostings = [
    ["Frontend Engineer, Cedar", "Remote, Europe"],
    ["Frontend Engineer, Spruce", "Remote, Worldwide"],
    ["Frontend Engineer, Paper", "Remote, Americas"],
  ] as const;

  function triageAll(remoteCountsAsAnyLocation: boolean | undefined) {
    const seed = createSeed();
    const searchPreferences = createSearchPreferences({
      targetRoles: ["Frontend Engineer"],
      locations: ["Berlin, Germany"],
      discovery: {
        targets: [],
        historyLimit: 5,
        collectOnlyHardCriteriaMatches: true,
        ...(remoteCountsAsAnyLocation === undefined
          ? {}
          : { remoteCountsAsAnyLocation }),
      },
    });
    return remotePostings.map(([title, location]) => [
      location,
      applyDiscoveryTitleTriage({
        posting: createPosting({
          title,
          location,
          workMode: ["remote"],
          description: "Build frontend product experiences with React.",
        }),
        profile: seed.profile,
        searchPreferences,
      }).outcome,
    ]);
  }

  test("remote on (and unset) keeps remote roles whose region covers a saved place", () => {
    const expected = [
      ["Remote, Europe", "pass"],
      ["Remote, Worldwide", "pass"],
      ["Remote, Americas", "skip_location"],
    ];
    expect(triageAll(true)).toEqual(expected);
    expect(triageAll(undefined)).toEqual(expected);
  });

  test("remote off drops every remote role that names no saved place", () => {
    expect(triageAll(false)).toEqual([
      ["Remote, Europe", "skip_location"],
      ["Remote, Worldwide", "skip_location"],
      ["Remote, Americas", "skip_location"],
    ]);
  });

  test("remote off still keeps a remote role in a saved place", () => {
    const seed = createSeed();
    const triage = applyDiscoveryTitleTriage({
      posting: createPosting({
        title: "Frontend Engineer",
        location: "Berlin, Germany (Remote)",
        workMode: ["remote"],
        description: "Build frontend product experiences with React.",
      }),
      profile: seed.profile,
      searchPreferences: createSearchPreferences({
        targetRoles: ["Frontend Engineer"],
        locations: ["Berlin, Germany"],
        discovery: {
          targets: [],
          historyLimit: 5,
          collectOnlyHardCriteriaMatches: true,
          remoteCountsAsAnyLocation: false,
        },
      }),
    });
    expect(triage.outcome).toBe("pass");
  });
});
