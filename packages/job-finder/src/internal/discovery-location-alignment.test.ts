import { JobSearchPreferencesSchema, SavedJobSchema } from "@nordri/contracts";
import { describe, expect, it } from "vitest";

import { describeRemoteOnlySourceMismatch } from "./discovery-location-alignment";

const preferences = JobSearchPreferencesSchema.parse({
  targetRoles: ["Recruiter"],
  locations: ["Chicago, IL"],
  workModes: ["onsite", "hybrid"],
  minimumSalaryUsd: null,
  approvalMode: "review_before_submit",
  tailoringMode: "balanced",
});

function remoteJob() {
  return SavedJobSchema.parse({
    id: "job_remote",
    source: "target_site",
    sourceJobId: "remote_1",
    canonicalUrl: "https://jobs.example.test/remote_1",
    title: "Recruiter",
    company: "Example",
    location: "Anywhere",
    workMode: ["remote"],
    applyPath: "unknown",
    easyApplyEligible: false,
    salaryText: null,
    status: "discovered",
    discoveredAt: "2026-09-12T10:00:00.000Z",
    description: "Recruiter",
    summary: "Recruiter",
    matchAssessment: {
      score: 70,
      locationReach: "in_area",
      reasons: ["Location fits the saved search preferences."],
      gaps: [],
      dimensions: {
        preferenceAlignment: {
          state: "aligned",
          explanation: "Anywhere compared with Chicago, IL: aligned.",
          evidence: [
            {
              source: "derived",
              label: "Location comparison",
              detail: "Anywhere compared with Chicago, IL: aligned.",
            },
          ],
        },
      },
    },
  });
}

describe("remote-only source warning", () => {
  it("warns when every retained result is remote and none is in area", () => {
    expect(describeRemoteOnlySourceMismatch([remoteJob()], preferences)).toBe(
      "This search returned only remote jobs; try another search for jobs in Chicago, IL.",
    );
  });

  it("does not call a named local office remote-only because the body mentions remote work", () => {
    const madridPreferences = JobSearchPreferencesSchema.parse({
      ...preferences,
      locations: ["Madrid, Spain"],
    });
    const madridOffice = SavedJobSchema.parse({
      ...remoteJob(),
      location: "Madrid Office",
      workMode: [],
      description:
        "Frontend engineer in our Madrid office. Remote collaboration benefits.",
    });

    expect(
      describeRemoteOnlySourceMismatch([madridOffice], madridPreferences),
    ).toBeNull();
  });

  it("does not infer a remote-only result from generic remote wording in an office listing", () => {
    const office = SavedJobSchema.parse({
      ...remoteJob(),
      location: "Berlin Office",
      workMode: ["onsite"],
      canonicalUrl: "https://example.test/jobs/office-role",
      applicationUrl: null,
      description: "This office role collaborates with remote teams.",
    });
    expect(describeRemoteOnlySourceMismatch([office], preferences)).toBeNull();
  });

  it("does not warn when a saved location explicitly accepts remote work", () => {
    const remotePreferences = JobSearchPreferencesSchema.parse({
      ...preferences,
      locations: ["Chicago, IL", "Remote, Worldwide"],
    });

    expect(
      describeRemoteOnlySourceMismatch([remoteJob()], remotePreferences),
    ).toBeNull();
  });

  it("keeps remote geography specific when the saved place is not global", () => {
    const regionalRemotePreferences = JobSearchPreferencesSchema.parse({
      ...preferences,
      locations: ["Remote, Europe"],
    });

    expect(
      describeRemoteOnlySourceMismatch(
        [remoteJob()],
        regionalRemotePreferences,
      ),
    ).toBe(
      "This search returned only remote jobs; try another search for jobs in Remote, Europe.",
    );
  });

  it.each(["Chicago, IL", "Philadelphia, PA", "Akron, OH"])(
    "warns deterministically for %s when remote is clear from the listing URL",
    (location) => {
      const localPreferences = JobSearchPreferencesSchema.parse({
        ...preferences,
        locations: [location],
        workModes: ["hybrid"],
      });
      const urlOnlyRemote = SavedJobSchema.parse({
        ...remoteJob(),
        location: "Location not stated",
        workMode: [],
        canonicalUrl: "https://jobs.example.test/remote-jobs/recruiter",
        applicationUrl: null,
        description: "Recruiter role at Example",
        summary: null,
      });

      expect(
        describeRemoteOnlySourceMismatch([urlOnlyRemote], localPreferences),
      ).toBe(
        `This search returned only remote jobs; try another search for jobs in ${location}.`,
      );
    },
  );
});
