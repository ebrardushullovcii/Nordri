import { describe, expect, test } from "vitest";
import { buildResumeProposalReplyContent } from "./resume-workspace-helpers";

describe("buildResumeProposalReplyContent", () => {
  test("a whole-draft blocker is named as the draft's, not blamed on the new wording", () => {
    const content = buildResumeProposalReplyContent({
      changeCount: 1,
      approvalBlockers: [
        {
          patchId: null,
          sectionId: null,
          entryId: null,
          bulletId: null,
          flaggedText: null,
          message:
            "This preview-derived resume contains untraceable candidate content and needs factual review before approval.",
        },
      ],
    });

    expect(content).not.toContain("new wording is not supported");
    expect(content).toContain(
      "The edit adds nothing that blocks approval, but the resume as a whole still does: This preview-derived resume",
    );
  });

  test("a blocker on the proposed wording still says so", () => {
    const content = buildResumeProposalReplyContent({
      changeCount: 2,
      approvalBlockers: [
        {
          patchId: "patch_1",
          sectionId: "section_summary",
          entryId: null,
          bulletId: null,
          flaggedText: "Led 40 engineers",
          message: "Your saved evidence does not back this generated claim.",
        },
      ],
    });

    expect(content).toContain(
      "1 of them would block approval: your saved evidence does not back the new wording.",
    );
    // The way out is one the Assistant can take, not "rewrite it yourself".
    expect(content).toContain(
      "If it is true, accept it and approve it as accurate in the resume checks; otherwise ask me to reword it from your saved evidence.",
    );
  });

  test("a stretch that goes to Lines to confirm is not called a blocker, and the model's note stays", () => {
    const content = buildResumeProposalReplyContent({
      changeCount: 1,
      assistantNote: "GraphQL comes from the posting, not your profile.",
      approvalBlockers: [
        {
          patchId: "patch_1",
          sectionId: "section_skills",
          entryId: null,
          bulletId: "skill_graphql",
          flaggedText: "GraphQL",
          message: "This wording stretches past your saved evidence.",
          kind: "needs_confirmation",
        },
      ],
    });

    expect(content).not.toContain("block approval");
    expect(content).toBe(
      "I prepared 1 resume edit for your review. 1 of them stretches past your saved evidence, so after you accept, it is listed under Lines to confirm for you to keep or remove. Nothing changed yet. GraphQL comes from the posting, not your profile.",
    );
  });
});
