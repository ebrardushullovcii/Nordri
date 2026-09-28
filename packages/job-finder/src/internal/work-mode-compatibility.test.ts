import type { JobPosting } from "@nordri/contracts";
import { JobSearchPreferencesSchema } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { createSeed } from "../workspace-service.test-fixtures";
import {
  assessWorkModeCompatibility,
  createMatchAssessment,
} from "./matching";

describe("assessWorkModeCompatibility", () => {
  test("keeps flexible or unspecified listings unknown instead of conflicts when concrete modes are accepted", () => {
    const acceptedModes = ["remote", "hybrid", "onsite"] as const;

    expect(assessWorkModeCompatibility(["flexible"], [...acceptedModes])).toBe(
      "unknown",
    );
    expect(assessWorkModeCompatibility([], [...acceptedModes])).toBe("unknown");
    expect(
      assessWorkModeCompatibility(["flexible", "onsite"], ["remote"]),
    ).toBe("unknown");
  });

  test("preserves explicit concrete conflicts and positive matches", () => {
    expect(
      assessWorkModeCompatibility(["onsite"], ["remote", "hybrid"]),
    ).toBe("conflict");
    expect(assessWorkModeCompatibility(["onsite"], ["onsite"])).toBe(
      "compatible",
    );
    expect(
      assessWorkModeCompatibility(["hybrid"], ["remote", "hybrid"]),
    ).toBe("compatible");
    // An explicit preference for flexibility accepts any listing evidence.
    expect(assessWorkModeCompatibility([], ["flexible"])).toBe("compatible");
    expect(assessWorkModeCompatibility(["onsite"], ["flexible"])).toBe(
      "compatible",
    );
  });
});

describe("work-mode compatibility in match assessments", () => {
  const buildAssessment = (
    workMode: JobPosting["workMode"],
    preferredWorkModes: readonly string[],
  ) => {
    const seed = createSeed();
    const preferences = JobSearchPreferencesSchema.parse({
      ...seed.searchPreferences,
      targetRoles: ["Senior Product Designer"],
      locations: [],
      workModes: preferredWorkModes,
      minimumSalaryUsd: null,
      compensation: {
        minimum: null,
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit",
      },
      companyWhitelist: [],
    });
    const posting: JobPosting = {
      ...seed.savedJobs[0]!,
      title: "Senior Product Designer",
      description: "Design product flows with a distributed team.",
      keySkills: [],
      keywordSignals: [],
      workMode,
    };

    return {
      assessment: createMatchAssessment(seed.profile, preferences, posting),
      seed,
    };
  };

  test("treats a flexible-only listing as unresolved rather than a hard conflict", () => {
    const { assessment } = buildAssessment(["flexible"], [
      "remote",
      "hybrid",
      "onsite",
    ]);
    const workModeRequirement = assessment.requirements.find(
      (requirement) => requirement.category === "work_mode",
    );

    expect(workModeRequirement?.status).toBe("unknown");
    expect(workModeRequirement?.explanation).toContain(
      "does not state a concrete work mode",
    );
    expect(assessment.gaps).not.toContain(
      "Work mode does not match the saved remote or hybrid preferences.",
    );
    expect(
      assessment.dimensions.preferenceAlignment.evidence.some((entry) =>
        entry.detail.includes("does not state a concrete work mode"),
      ),
    ).toBe(true);
  });

  test("records an unticked onsite mode as a gap, not a blocker", () => {
    // Not ticking onsite is a preference, not a rule the listing broke. The
    // score still sinks, but the listing is never thrown out for it: "SKIP —
    // HARD CONFLICT" on a work mode the person had ticked is exactly what
    // made real hybrid roles disappear from a hybrid search.
    const { assessment } = buildAssessment(["onsite"], ["remote"]);
    const workModeRequirement = assessment.requirements.find(
      (requirement) => requirement.category === "work_mode",
    );

    expect(workModeRequirement?.status).toBe("missing");
    expect(workModeRequirement?.explanation).toBe(
      "The listing work mode is not one you ticked, so it ranks lower rather than being thrown out.",
    );
    expect(assessment.gaps).toContain(
      "Work mode does not match the saved remote or hybrid preferences.",
    );
    expect(assessment.recommendation).not.toBe("skip");
  });

  test("scores ambiguous availability above an explicit work-mode conflict", () => {
    const flexible = buildAssessment(["flexible"], [
      "remote",
      "hybrid",
      "onsite",
    ]).assessment;
    const conflicted = buildAssessment(["onsite"], ["remote"]).assessment;

    expect(flexible.score).toBeGreaterThan(conflicted.score);
  });
});
