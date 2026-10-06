import { ResumeDraftSchema } from "@nordri/contracts";
import { describe, expect, test, vi } from "vitest";

import { createSeed } from "../workspace-service.test-support";
import {
  withResumeClaimChecks,
  withResumeClaimFixes,
} from "./resume-claim-checks";
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
            fix: null,
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
            fix: null,
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

  describe("fixing what the check did not pass", () => {
    // Verdicts are remembered for the session, so each test words its own lines.
    function lines(tag: string) {
      return {
        invented: `Cut cloud spend by 40% across twelve teams (${tag}).`,
        fixedInvented: `Worked on cloud spend reviews (${tag}).`,
        skill: `Kubernetes ${tag}`,
        stretch: `Owned the platform roadmap (${tag}).`,
        fixedStretch: `Contributed to the platform roadmap (${tag}).`,
        theirs: `Wrote this line myself after the interview (${tag}).`,
      };
    }

    function checker(
      verdicts: Record<string, "supported" | "stretch" | "unsupported">,
      fixes: Record<string, string>,
      styles: Record<string, string> = {},
    ) {
      return vi.fn(
        (input: { claims: ReadonlyArray<{ id: string; text: string }> }) =>
          Promise.resolve(
            input.claims.map((claim) => ({
              id: claim.id,
              verdict: verdicts[claim.text] ?? ("supported" as const),
              reason: "Test verdict.",
              evidenceIds: [],
              fix: fixes[claim.text] ?? null,
              style: styles[claim.text] ?? null,
            })),
          ),
      );
    }

    async function generateAndFix(
      line: ReturnType<typeof lines>,
      checkResumeClaims: ReturnType<typeof checker>,
      stretchesAreThePersons: boolean,
    ) {
      const { profile, job } = context();
      const base = {
        aiClient: { checkResumeClaims },
        job,
        profile,
        now: () => at,
      };
      const checked = await withResumeClaimChecks({
        ...base,
        draft: draftWith([
          { text: line.invented, origin: "ai_generated" },
          { text: line.skill, origin: "ai_generated" },
          { text: line.stretch, origin: "ai_generated" },
          { text: line.theirs, origin: "user_edited" },
        ]),
      });
      return withResumeClaimFixes({
        ...base,
        draft: checked,
        stretchesAreThePersons,
      });
    }

    test("rewrites or hides failed lines, checks the rewrites, keeps the person's lines", async () => {
      const line = lines("fixes");
      const checkResumeClaims = checker(
        {
          [line.invented]: "unsupported",
          [line.skill]: "unsupported",
          [line.stretch]: "stretch",
        },
        {
          [line.invented]: line.fixedInvented,
          [line.skill]: "",
          [line.stretch]: line.fixedStretch,
        },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, false);
      const bullets = fixed.sections[0]?.bullets ?? [];

      expect(bullets.map((bullet) => [bullet.text, bullet.included])).toEqual([
        [line.fixedInvented, true],
        [line.skill, false],
        [line.fixedStretch, true],
        [line.theirs, true],
      ]);
      // The two rewrites were checked in a second call.
      expect(checkResumeClaims).toHaveBeenCalledTimes(2);
      expect(
        checkResumeClaims.mock.calls[1]?.[0].claims.map((claim) => claim.text),
      ).toEqual([line.fixedInvented, line.fixedStretch]);
      expect(
        fixed.claimChecks?.find(
          (check) =>
            check.contentHash === resumeClaimContentHash(line.fixedInvented),
        )?.verdict,
      ).toBe("supported");
    });

    test("a supported line the checker notes as unfinished writing gets its fix", async () => {
      const line = lines("style");
      const checkResumeClaims = checker(
        {},
        { [line.invented]: line.fixedInvented },
        { [line.invented]: "This reads as a fragment." },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, true);

      expect(fixed.sections[0]?.bullets[0]?.text).toBe(line.fixedInvented);
    });

    test("a stretch stays for the person in aggressive tailoring", async () => {
      const line = lines("aggressive");
      const checkResumeClaims = checker(
        { [line.stretch]: "stretch" },
        { [line.stretch]: line.fixedStretch },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, true);

      expect(fixed.sections[0]?.bullets.map((bullet) => bullet.text)).toContain(
        line.stretch,
      );
      expect(checkResumeClaims).toHaveBeenCalledOnce();
    });

    test("a fix that repeats a line already there hides the line", async () => {
      const line = lines("duplicate");
      const checkResumeClaims = checker(
        { [line.invented]: "unsupported" },
        { [line.invented]: line.theirs },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, false);

      expect(
        fixed.sections[0]?.bullets.map((bullet) => [
          bullet.text,
          bullet.included,
        ]),
      ).toContainEqual([line.invented, false]);
      expect(checkResumeClaims).toHaveBeenCalledTimes(2);
    });

    test("a fix that rewords a line already there hides the line too", async () => {
      const line = lines("reworded");
      const checkResumeClaims = checker(
        { [line.invented]: "unsupported" },
        {
          [line.invented]:
            "Wrote this same line myself after the interview (reworded).",
        },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, false);

      expect(
        fixed.sections[0]?.bullets.find(
          (bullet) => bullet.text === line.invented,
        )?.included,
      ).toBe(false);
    });

    test("a rewrite that still fails is not fixed again", async () => {
      const line = lines("again");
      const worse = "Cut cloud spend by 30% across ten teams (again).";
      const checkResumeClaims = checker(
        { [line.invented]: "unsupported", [worse]: "unsupported" },
        { [line.invented]: worse, [worse]: "Worked on cloud spend." },
      );

      const fixed = await generateAndFix(line, checkResumeClaims, false);

      expect(fixed.sections[0]?.bullets[0]?.text).toBe(worse);
      expect(checkResumeClaims).toHaveBeenCalledTimes(2);
    });
  });
});
