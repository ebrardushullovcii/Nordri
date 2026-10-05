import { describe, expect, it } from "vitest";

import {
  DiscoveryFeedbackSchema,
  EmployerExclusionPreviewSchema,
  JobFinderDismissDiscoveryJobInputSchema,
  SavedJobSchema,
} from "./index";

const legacyJob = {
  id: "job_1",
  source: "target_site",
  sourceJobId: "source_job_1",
  canonicalUrl: "https://boards.greenhouse.io/example/jobs/1",
  title: "Platform Engineer",
  company: "Example",
  location: "Remote",
  workMode: ["remote"],
  applyPath: "external_redirect",
  easyApplyEligible: false,
  discoveredAt: "2026-07-31T12:00:00.000Z",
  salaryText: null,
  description: "Build dependable systems.",
  status: "discovered",
  matchAssessment: { score: 72, reasons: [], gaps: [] },
};

describe("discovery feedback contracts", () => {
  it("persists reason-free hiding through the input and saved feedback schemas", () => {
    expect(
      JobFinderDismissDiscoveryJobInputSchema.parse({
        jobId: "job_1",
        reasons: [],
        action: "hide_job",
      }).reasons,
    ).toEqual([]);
    expect(
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 1,
        reasons: [],
        recordedAt: "2026-07-31T12:00:00.000Z",
      }).reasons,
    ).toEqual([]);
  });

  it("parses a bounded set of fact-neutral reason chips", () => {
    expect(
      JobFinderDismissDiscoveryJobInputSchema.parse({
        jobId: "job_1",
        reasons: ["role", "location"],
      }),
    ).toEqual({ jobId: "job_1", reasons: ["role", "location"] });
  });

  it("accepts empty feedback and rejects unknown reasons", () => {
    expect(
      JobFinderDismissDiscoveryJobInputSchema.parse({
        jobId: "job_1",
        reasons: [],
      }).reasons,
    ).toEqual([]);
    expect(() =>
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 1,
        reasons: ["salary_is_a_hard_fact"],
        recordedAt: "2026-07-31T12:00:00.000Z",
      }),
    ).toThrow();
  });

  it("migrates legacy jobs without feedback to an explicit null", () => {
    expect(SavedJobSchema.parse(legacyJob).discoveryFeedback).toBeNull();
  });

  it("defaults missing prior status on persisted legacy feedback to null", () => {
    expect(
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 2,
        reasons: ["company"],
        recordedAt: "2026-07-31T12:00:00.000Z",
      }).priorStatus,
    ).toBeNull();
    expect(
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 1,
        reasons: ["role"],
        recordedAt: "2026-07-31T12:00:00.000Z",
        priorStatus: "shortlisted",
      }).priorStatus,
    ).toBe("shortlisted");
  });

  it("defaults a legacy employer exclusion reference to null", () => {
    expect(
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 1,
        reasons: ["company"],
        recordedAt: "2026-07-31T12:00:00.000Z",
      }).employerExclusion,
    ).toBeNull();
  });

  it("defaults a legacy employer exclusion campaign reference to null", () => {
    expect(
      DiscoveryFeedbackSchema.parse({
        version: 1,
        revision: 1,
        reasons: ["company"],
        recordedAt: "2026-07-31T12:00:00.000Z",
        employerExclusion: {
          normalizedCompanyName: "legacy employer",
          displayCompanyName: "Legacy Employer",
          addedByThisFeedback: true,
        },
      }).employerExclusion?.campaignId,
    ).toBeNull();
  });

  it("requires an expected normalized identity for reusable exclusion", () => {
    expect(
      JobFinderDismissDiscoveryJobInputSchema.safeParse({
        jobId: "job_1",
        reasons: ["company"],
        action: "hide_and_exclude_employer",
      }).success,
    ).toBe(false);
    expect(
      JobFinderDismissDiscoveryJobInputSchema.parse({
        jobId: "job_1",
        reasons: ["company"],
        action: "hide_and_exclude_employer",
        expectedNormalizedCompanyName: "example",
      }).action,
    ).toBe("hide_and_exclude_employer");
  });

  it("keeps employer exclusion previews strict and discriminated", () => {
    const available = EmployerExclusionPreviewSchema.parse({
      status: "available",
      jobId: "job_1",
      displayCompanyName: "Example",
      normalizedCompanyName: "example",
      employerDomain: "example.com",
    });
    expect(available.status).toBe("available");
    if (available.status !== "available") throw new Error("Expected preview");
    expect(available.normalizedCompanyName).toBe("example");
    expect(
      EmployerExclusionPreviewSchema.safeParse({
        status: "unavailable",
        jobId: "job_1",
        reason: "provider_domain_only",
        employerDomain: "jobs.example.com",
        normalizedCompanyName: "example",
      }).success,
    ).toBe(false);
  });
});
