import { describe, expect, test } from "vitest";

import {
  buildResumeClaimCheckPayload,
  buildResumeClaimCheckPrompt,
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
              fix: "A supported line needs no fix.",
            },
            {
              id: "b",
              verdict: "unsupported",
              reason: "Not in evidence.",
              fix: "",
            },
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
        style: null,
        fix: null,
        evidenceIds: ["experience:1"],
      },
      {
        id: "b",
        verdict: "unsupported",
        reason: "Not in evidence.",
        style: null,
        fix: "",
        evidenceIds: [],
      },
    ]);
  });

  test("keeps a style note, and a fix for a supported line that has one", () => {
    expect(
      normalizeResumeClaimChecks(
        {
          checks: [
            {
              id: "a",
              verdict: "supported",
              reason: "In evidence.",
              style: "This reads as a fragment.",
              fix: "Built SQL dashboards for the sales team.",
            },
          ],
        },
        input,
      ).map((check) => [check.style, check.fix]),
    ).toEqual([
      ["This reads as a fragment.", "Built SQL dashboards for the sales team."],
    ]);
  });

  test("reads the claim id under the key names models use", () => {
    expect(
      normalizeResumeClaimChecks(
        {
          checks: [
            { claim_id: "a", verdict: "supported", reason: "In evidence." },
            { claim: "b", verdict: "unsupported", reason: "No.", fix: "" },
          ],
        },
        input,
      ).map((check) => [check.id, check.verdict, check.fix]),
    ).toEqual([
      ["a", "supported", null],
      ["b", "unsupported", ""],
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

test("checks mixed claims and role-specific details without dropping qualifiers", () => {
  const prompt = buildResumeClaimCheckPrompt();
  for (const detail of [
    "every factual part",
    "particular implementation detail",
    "basic or still learning",
    "seasonal or partial dates",
    "credential years and renewal dates",
    "quantified results",
    "no word limit",
  ]) {
    expect(prompt).toContain(detail);
  }
});

test("fact-check instructions contain general rules without tester facts", () => {
  const prompt = buildResumeClaimCheckPrompt();
  for (const fact of [
    "Workday",
    "Excel (advanced)",
    "Articulate Rise",
    "settlement offsets",
    "Dallas",
    "IFRS",
    "CFO",
  ])
    expect(prompt).not.toContain(fact);
});
