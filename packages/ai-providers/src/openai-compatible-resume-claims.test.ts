import { describe, expect, test } from "vitest";

import {
  buildResumeClaimCheckPayload,
  normalizeResumeClaimChecks,
} from "./openai-compatible-resume-claims";

const input = {
  tailoringStrength: "balanced",
  job: { title: "Data Analyst", company: "Northwind", description: "SQL." },
  evidence: [
    { id: "experience:1", text: "Built SQL dashboards for the sales team." },
  ],
  resumeText: null,
  claims: [
    { id: "a", section: "Experience", text: "Built SQL dashboards." },
    { id: "b", section: "Skills", text: "Kubernetes" },
  ],
};

describe("resume claim checks", () => {
  test("keeps verdicts for asked claims and cited evidence only", () => {
    expect(
      normalizeResumeClaimChecks(
        {
          checks: [
            {
              id: "a",
              verdict: "supported",
              reason: "The dashboards are in the evidence.",
              evidenceIds: ["experience:1", "made-up"],
            },
            { id: "b", verdict: "unsupported", reason: "Not in evidence." },
            { id: "c", verdict: "supported", reason: "Not asked." },
            { id: "a", verdict: "unsupported", reason: "Duplicate." },
            { id: "b", verdict: "maybe" },
          ],
        },
        input,
      ),
    ).toEqual([
      {
        id: "a",
        verdict: "supported",
        reason: "The dashboards are in the evidence.",
        evidenceIds: ["experience:1"],
      },
      {
        id: "b",
        verdict: "unsupported",
        reason: "Not in evidence.",
        evidenceIds: [],
      },
    ]);
  });

  test("an answer without checks leaves every line unchecked", () => {
    expect(normalizeResumeClaimChecks({ verdicts: [] }, input)).toEqual([]);
    expect(normalizeResumeClaimChecks(null, input)).toEqual([]);
  });

  test("sends the claims, the evidence and the job as context", () => {
    const payload = buildResumeClaimCheckPayload(input);
    expect(payload.claims).toEqual(input.claims);
    expect(payload.evidence).toEqual(input.evidence);
    expect(payload.job.title).toBe("Data Analyst");
  });
});
