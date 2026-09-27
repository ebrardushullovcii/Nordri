import {
  JobSearchPreferencesSchema,
  SavedJobSchema,
} from "@unemployed/contracts";
import { describe, expect, it } from "vitest";

import {
  correctRemoteOnlyLocationAlignment,
  describeRemoteOnlySourceMismatch,
} from "./discovery-location-alignment";

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

describe("remote-only discovery location alignment", () => {
  it("counts Anywhere as a location miss when remote was not requested", () => {
    const job = remoteJob();
    const corrected = correctRemoteOnlyLocationAlignment(
      job,
      job.matchAssessment,
      preferences,
    );

    expect(corrected.locationReach).toBe("outside_area");
    expect(corrected.score).toBe(50);
    expect(corrected.gaps[0]).toBe(
      "The listing does not name the requested place; you asked for Chicago, IL onsite or hybrid.",
    );
    expect(corrected.dimensions.preferenceAlignment.state).toBe("mixed");
  });

  it("does not align an Anywhere listing restricted to another country", () => {
    const job = SavedJobSchema.parse({
      ...remoteJob(),
      location: "Anywhere, Costa Rica",
      description: "Remote role restricted to people in Costa Rica.",
    });
    const corrected = correctRemoteOnlyLocationAlignment(
      job,
      job.matchAssessment,
      preferences,
    );

    expect(corrected.locationReach).toBe("outside_area");
    expect(corrected.reasons.join(" ")).not.toContain("Location fits");
  });

  it("keeps a listing naming the requested city in area", () => {
    const job = SavedJobSchema.parse({
      ...remoteJob(),
      location: "Chicago, IL",
      workMode: ["hybrid"],
      description: "Hybrid Chicago role supporting a distributed team.",
      matchAssessment: {
        ...remoteJob().matchAssessment,
        locationReach: "outside_area",
      },
    });

    expect(
      correctRemoteOnlyLocationAlignment(job, job.matchAssessment, preferences)
        .locationReach,
    ).toBe("in_area");
  });

  const chicagoLocationShapes = [
    "Hiring Remotely in Chicago, IL, USA",
    "Hiring Remotely in Illinois, USA",
    "Chicago, IL, USA",
    "Remote in Chicago",
    "Hybrid in Chicago",
  ];

  it.each(chicagoLocationShapes)(
    "keeps %s in area because it names the requested place",
    (location) => {
      const job = SavedJobSchema.parse({
        ...remoteJob(),
        location,
        workMode: ["remote", "hybrid"],
        description: `Marketing lead. ${location}.`,
        matchAssessment: {
          ...remoteJob().matchAssessment,
          locationReach: "outside_area",
        },
      });

      expect(
        correctRemoteOnlyLocationAlignment(
          job,
          job.matchAssessment,
          preferences,
        ).locationReach,
      ).toBe("in_area");
    },
  );

  it("still reads a remote listing in another city as outside the area", () => {
    const job = SavedJobSchema.parse({
      ...remoteJob(),
      location: "Hiring Remotely in Austin, TX, USA",
      workMode: ["remote"],
      description: "Marketing lead. Hiring Remotely in Austin, TX, USA.",
    });

    expect(
      correctRemoteOnlyLocationAlignment(job, job.matchAssessment, preferences)
        .locationReach,
    ).toBe("outside_area");
  });

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
