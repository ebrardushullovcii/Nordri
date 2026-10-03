import { ResumeDraftSchema } from "@nordri/contracts";
import { describe, expect, test, vi } from "vitest";

import { createSeed } from "../workspace-service.test-support";
import { withResumeClaimChecks } from "./resume-claim-checks";
import { resumeClaimContentHash } from "./resume-workspace-helpers";

const at = "2026-10-03T10:00:00.000Z";

function context() {
  const seed = createSeed();
  const job = seed.savedJobs.find((entry) => entry.id === "job_ready");
  if (!job) throw new Error("job_ready missing");
  return { profile: seed.profile, job };
}

function draftWith(bullets: ReadonlyArray<{ text: string; origin: string }>) {
  return ResumeDraftSchema.parse({
    id: "resume_draft_job_ready",
    jobId: "job_ready",
    status: "draft",
    templateId: "classic_ats",
    sections: [
      {
        id: "section_summary",
        kind: "summary",
        label: "Highlights",
        text: null,
        bullets: bullets.map((bullet, index) => ({
          id: `bullet_${index + 1}`,
          text: bullet.text,
          origin: bullet.origin,
          locked: false,
          included: true,
          updatedAt: at,
        })),
        entries: [],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 0,
        updatedAt: at,
      },
    ],
    createdAt: at,
    updatedAt: at,
  });
}

describe("resume claim checks before a draft is kept (ADR 0041)", () => {
  test("asks the model about generated lines only, once per wording", async () => {
    const { profile, job } = context();
    const checkResumeClaims = vi.fn(
      (input: { claims: ReadonlyArray<{ id: string; text: string }> }) =>
        Promise.resolve(
          input.claims.map((claim) => ({
            id: claim.id,
            verdict: "stretch" as const,
            reason: "A small step past the evidence.",
            evidenceIds: [],
          })),
        ),
    );
    const draft = draftWith([
      {
        text: "Steered a thirty-person migration to event sourcing.",
        origin: "ai_generated",
      },
      {
        text: "Wrote this line myself after the interview.",
        origin: "user_edited",
      },
    ]);

    const checked = await withResumeClaimChecks({
      aiClient: { checkResumeClaims },
      draft,
      job,
      profile,
      now: () => at,
    });

    expect(checkResumeClaims).toHaveBeenCalledOnce();
    expect(
      checkResumeClaims.mock.calls[0]?.[0].claims.map((claim) => claim.text),
    ).toEqual(["Steered a thirty-person migration to event sourcing."]);
    expect(checked.claimChecks).toMatchObject([
      {
        contentHash: resumeClaimContentHash(
          "Steered a thirty-person migration to event sourcing.",
        ),
        verdict: "stretch",
      },
    ]);

    // The stored verdict is reused; the model is not asked again.
    await withResumeClaimChecks({
      aiClient: { checkResumeClaims },
      draft: checked,
      job,
      profile,
    });
    expect(checkResumeClaims).toHaveBeenCalledOnce();
  });

  test("a project line built from the person's own records is theirs", async () => {
    const { profile, job } = context();
    const checkResumeClaims = vi.fn(() => Promise.resolve([]));
    const withProject = {
      ...profile,
      projects: [
        {
          id: "project_workflow_os",
          name: "Workflow OS",
          projectType: "product",
          summary: "Scaled an internal design system.",
          role: "Design lead",
          skills: ["Figma", "Accessibility"],
          outcome: "Reduced release churn for operations teams.",
          projectUrl: null,
          repositoryUrl: null,
          caseStudyUrl: null,
          isDraft: false,
        },
      ],
    };

    const checked = await withResumeClaimChecks({
      aiClient: { checkResumeClaims },
      draft: draftWith([
        {
          text: "Scaled an internal design system. Reduced release churn for operations teams. Technologies: Figma, Accessibility.",
          origin: "ai_generated",
        },
      ]),
      job,
      profile: withProject,
      now: () => at,
    });

    expect(checkResumeClaims).not.toHaveBeenCalled();
    expect(checked.claimChecks ?? []).toEqual([]);
  });

  test("a changed profile has the lines checked again", async () => {
    const { profile, job } = context();
    const checkResumeClaims = vi.fn(
      (input: { claims: ReadonlyArray<{ id: string }> }) =>
        Promise.resolve(
          input.claims.map((claim) => ({
            id: claim.id,
            verdict: "supported" as const,
            reason: "In the evidence.",
            evidenceIds: [],
          })),
        ),
    );
    const draft = draftWith([
      {
        text: "Rebuilt the onboarding funnel analytics end to end.",
        origin: "ai_generated",
      },
    ]);
    const checked = await withResumeClaimChecks({
      aiClient: { checkResumeClaims },
      draft,
      job,
      profile,
    });
    await withResumeClaimChecks({
      aiClient: { checkResumeClaims },
      draft: checked,
      job,
      profile: {
        ...profile,
        summary: `${profile.summary ?? ""} Now leads analytics.`,
      },
    });
    expect(checkResumeClaims).toHaveBeenCalledTimes(2);
  });

  test("a failed check leaves the lines unchecked", async () => {
    const { profile, job } = context();
    const checked = await withResumeClaimChecks({
      aiClient: {
        checkResumeClaims: () => Promise.reject(new Error("model unavailable")),
      },
      draft: draftWith([
        {
          text: "Negotiated a vendor contract worth two million.",
          origin: "ai_generated",
        },
      ]),
      job,
      profile,
    });
    expect(checked.claimChecks).toEqual([]);
  });
});
