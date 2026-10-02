import { describe, expect, test, vi } from "vitest";
import type { JobRequirementAssessment } from "@nordri/contracts";
import {
  createSeed,
  createAiClient,
  createWorkspaceServiceHarness,
} from "../workspace-service.test-support";
import {
  assessLocationCompatibility,
  createMatchAssessment,
  createMatchAssessmentAsync,
} from "./matching";

const requirement = (
  label: string,
  status: JobRequirementAssessment["status"],
  category: JobRequirementAssessment["category"] = "skill",
): JobRequirementAssessment => ({
  id: label,
  label,
  status,
  category,
  importance: "required",
  jobEvidence: label,
  resumeEvidence:
    status === "supported"
      ? [
          {
            sourceKind: "profile",
            sourceId: null,
            label: "Saved profile",
            detail: label,
          },
        ]
      : [],
  explanation: `${label}: ${status}`,
});

describe("Round two fit findings", () => {
  test.each([
    ["Frankfurt am Main, HESSEN, DE", "Germany"],
    ["Zurich, ZH, CH", "Switzerland"],
    ["Sydney, NSW, AU", "Australia"],
    ["Tokyo, JP", "Japan"],
    ["DE", "Germany"],
  ])("compares %s within %s", (location, country) => {
    expect(
      assessLocationCompatibility(location, [country], {
        remoteCountsAsAnyLocation: false,
      }),
    ).toBe("compatible");
  });

  test("a country match does not merge different cities", () => {
    expect(
      assessLocationCompatibility("Frankfurt, Germany", ["Berlin, Germany"]),
    ).toBe("incompatible");
  });

  test.each([
    ["Backend Engineer", "Instructional Designer"],
    ["Junior Instructional Designer", "Senior Product Designer"],
    ["Lead Mechanical Engineer", "Senior Backend Engineer"],
    ["Junior Quality Engineer", "Staff Platform Engineer"],
  ])("%s has an occupational gap against %s", (title, target) => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      seed.profile,
      { ...seed.searchPreferences, targetRoles: [target] },
      { ...seed.savedJobs[0]!, title },
    );
    expect(assessment.dimensions.roleSuitability.state).toBe("conflict");
    expect(assessment.recommendation).toBe("skip");
    expect(assessment.reasons[0]).toBe(
      "The listing belongs to a different occupational role.",
    );
  });

  test("a generic Engineer title does not establish the saved discipline", () => {
    const seed = createSeed();
    const assessment = createMatchAssessment(
      seed.profile,
      { ...seed.searchPreferences, targetRoles: ["Senior Backend Engineer"] },
      { ...seed.savedJobs[0]!, title: "Engineer" },
    );
    expect(assessment.dimensions.roleSuitability.state).toBe("unknown");
    expect(assessment.reasons).not.toContain(
      "Role title aligns closely with the current target roles.",
    );
  });

  test.each(["Junior", "Senior", "Lead", "Intern"])(
    "uses %s from the title as seniority evidence",
    (level) => {
      const seed = createSeed();
      const assessment = createMatchAssessment(
        seed.profile,
        { ...seed.searchPreferences, seniorityLevels: [level] },
        {
          ...seed.savedJobs[0]!,
          title: `${level} Datenanalyst`,
          seniority: null,
        },
      );
      expect(
        assessment.dimensions.preferenceAlignment.evidence.find(
          (row) => row.label === "Seniority comparison",
        )?.detail,
      ).toContain(`${level} compared with ${level}: aligned`);
    },
  );

  test("compares model-extracted substantive requirements and keeps conflict ceilings", async () => {
    const seed = createSeed();
    const requirements = [
      requirement("Very good German", "conflict"),
      requirement("Eight months of enrollment", "conflict", "experience"),
      requirement("Power BI", "missing"),
      requirement("Design education", "supported", "experience"),
      requirement("Strong portfolio", "supported", "experience"),
      requirement("AI tools", "unknown"),
    ];
    const client = {
      ...createAiClient(),
      assessJobFit: () =>
        Promise.resolve({
          score: 99,
          reasons: ["Remote"],
          gaps: [],
          requirements,
        }),
    };
    const assessed = await createMatchAssessmentAsync(
      client,
      seed.profile,
      seed.searchPreferences,
      seed.savedJobs[0]!,
    );
    expect(assessed.requirements).toEqual(expect.arrayContaining(requirements));
    expect(assessed.recommendation).toBe("skip");
    expect(assessed.score).toBeLessThanOrEqual(39);
    expect(
      assessed.dimensions.evidenceConfidence.conflictCount,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a required country restriction wins over generic remote alignment", async () => {
    const seed = createSeed();
    const restrictions = [
      requirement("Remote work in Germany only", "conflict", "location"),
    ];
    const client = {
      ...createAiClient(),
      assessJobFit: () =>
        Promise.resolve({
          score: 99,
          reasons: [],
          gaps: [],
          requirements: restrictions,
        }),
    };
    const assessed = await createMatchAssessmentAsync(
      client,
      seed.profile,
      seed.searchPreferences,
      { ...seed.savedJobs[0]!, location: "Remote", workMode: ["remote"] },
    );
    expect(assessed.dimensions.preferenceAlignment.state).not.toBe("aligned");
    expect(assessed.requirements).toEqual(expect.arrayContaining(restrictions));
    expect(assessed.recommendation).toBe("skip");
  });

  test("the requested assessment reads a pending result without shortlisting it", async () => {
    const seed = createSeed();
    const job = {
      ...seed.savedJobs[0]!,
      status: "discovered" as const,
      detailQuality: "card_only" as const,
      description: "Senior Software Engineer",
      listingDetailFetch: null,
    };
    const body =
      "Very good German is required. Candidates must remain enrolled for at least eight months. Experience with Power BI is required. You will collaborate with the analytics team, gather stakeholder requirements, build dashboards and explain the results to colleagues. We provide structured onboarding and support from an experienced manager.";
    const requirements = [
      requirement("Very good German", "missing"),
      requirement("Eight months of enrollment", "unknown", "experience"),
    ];
    const { workspaceService, repository } = createWorkspaceServiceHarness({
      seed: {
        ...seed,
        savedJobs: [],
        discovery: { ...seed.discovery, pendingDiscoveryJobs: [job] },
      },
      aiClient: {
        ...createAiClient(),
        assessJobFit: () =>
          Promise.resolve({
            score: 90,
            reasons: [],
            gaps: [],
            requirements,
          }),
      },
      fetchListingHtml: (url) =>
        Promise.resolve({
          status: 200,
          finalUrl: url,
          html: `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: job.title, description: body })}</script>`,
        }),
    });
    await workspaceService.assessJobListing(job.id);
    expect(await repository.listSavedJobs()).toEqual([]);
    const updated = (await repository.getDiscoveryState())
      .pendingDiscoveryJobs[0]!;
    expect(updated.description).toContain("eight months");
    expect(updated.status).toBe("discovered");
    expect(updated.matchAssessment.requirements).toEqual(
      expect.arrayContaining(requirements),
    );
    expect(updated.matchAssessment.contextFingerprint).toBeTruthy();
    await workspaceService.getWorkspaceSnapshot();
    expect(
      (await repository.getDiscoveryState()).pendingDiscoveryJobs[0]
        ?.matchAssessment.requirements,
    ).toEqual(expect.arrayContaining(requirements));
  });
  test("reuses a current full assessment on shortlist and honors an explicit reassessment", async () => {
    const seed = createSeed();
    const job = {
      ...seed.savedJobs[0]!,
      detailQuality: "detail_enriched" as const,
      listingDetailFetch: {
        outcome: "enriched" as const,
        method: "json_ld" as const,
        attemptedAt: "2026-10-02T00:00:00.000Z",
        detail: "Read the full listing.",
      },
    };
    const assessJobFit = vi.fn(() =>
      Promise.resolve({
        score: 90,
        reasons: [],
        gaps: [],
        requirements: [requirement("German B2", "missing")],
      }),
    );
    const fetchListingHtml = vi.fn(() =>
      Promise.resolve({ status: 200, finalUrl: job.canonicalUrl, html: "" }),
    );
    const { workspaceService } = createWorkspaceServiceHarness({
      seed: { ...seed, savedJobs: [job] },
      aiClient: { ...createAiClient(), assessJobFit },
      fetchListingHtml,
    });
    await workspaceService.assessJobListing(job.id);
    await workspaceService.queueJobForReview(job.id);
    expect(assessJobFit).toHaveBeenCalledTimes(1);
    expect(fetchListingHtml).not.toHaveBeenCalled();
    await workspaceService.assessJobListing(job.id);
    expect(assessJobFit).toHaveBeenCalledTimes(2);
  });
});
