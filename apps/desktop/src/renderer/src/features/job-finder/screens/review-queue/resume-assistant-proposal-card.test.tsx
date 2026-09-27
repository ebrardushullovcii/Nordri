// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ResumeAssistantMessage,
  ResumeClaimAssessment,
  ResumeDraft,
  ResumeDraftPatch,
  ResumeDraftSourceRef,
  ResumeValidationResult,
} from "@unemployed/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeAssistantProposalCard } from "./resume-assistant-proposal-card";

const savedSummaryText =
  "Systems-focused product designer with deep workflow automation experience.";
const savedBulletText =
  "Led design-system rollout across core workflow surfaces.";
const proposedBulletText = "Proposed replacement bullet wording.";
const profileSnippet = "Ran the rollout playbook across teams.";

const profileSourceRef: ResumeDraftSourceRef = {
  id: "ref profile demo",
  sourceKind: "profile",
  sourceId: null,
  snippet: profileSnippet,
};

function buildDraft(): ResumeDraft {
  const updatedAt = "2026-04-27T00:00:00.000Z";

  return {
    id: "draft demo",
    jobId: "job demo",
    status: "draft",
    templateId: "classic_ats",
    identity: null,
    sections: [
      {
        id: "sec summary",
        kind: "summary",
        label: "Summary",
        text: savedSummaryText,
        bullets: [],
        entries: [],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 0,
        entryOrderMode: "chronology",
        profileRecordId: null,
        sourceRefs: [],
        updatedAt,
      },
      {
        id: "sec experience",
        kind: "experience",
        label: "Experience",
        text: null,
        bullets: [],
        entries: [
          {
            id: "ent design",
            entryType: "experience",
            title: "Senior Systems Designer",
            subtitle: "Signal Systems",
            location: "London, UK",
            dateRange: "2020 - Present",
            startDate: "2020",
            endDate: null,
            isCurrent: true,
            summary: "Leads design systems work.",
            bullets: [
              {
                id: "bul one",
                text: savedBulletText,
                origin: "ai_generated",
                locked: false,
                included: true,
                sourceRefs: [],
                lastGeneratedContentHash: null,
                updatedAt,
              },
            ],
            origin: "ai_generated",
            locked: false,
            included: true,
            sortOrder: 0,
            profileRecordId: null,
            sourceRefs: [profileSourceRef],
            updatedAt,
          },
        ],
        origin: "ai_generated",
        locked: false,
        included: true,
        sortOrder: 1,
        entryOrderMode: "chronology",
        profileRecordId: null,
        sourceRefs: [],
        updatedAt,
      },
    ],
    targetPageCount: 2,
    generationMethod: "ai",
    approvedAt: null,
    approvedExportId: null,
    staleReason: null,
    workHistoryReviewAcknowledgments: [],
    claimConfirmations: [],
    issueApprovals: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function buildPatch(overrides?: Partial<ResumeDraftPatch>): ResumeDraftPatch {
  return {
    id: "patch one",
    draftId: "draft demo",
    operation: "update_bullet",
    targetSectionId: "sec experience",
    targetEntryId: "ent design",
    anchorEntryId: null,
    targetBulletId: "bul one",
    anchorBulletId: null,
    position: null,
    newText: proposedBulletText,
    newIncluded: null,
    newLocked: null,
    newBullets: null,
    appliedAt: "2026-04-27T00:30:00.000Z",
    origin: "assistant",
    conflictReason: null,
    ...overrides,
  };
}

function buildMessage(overrides?: Partial<ResumeAssistantMessage>) {
  const fallbackPatch = buildPatch();
  const { patches, ...rest } = overrides ?? {};

  return {
    id: "assistant one",
    jobId: "job demo",
    role: "assistant" as const,
    content: "Here is a grounded edit.",
    patches: patches ?? [fallbackPatch],
    proposalStatus: "pending" as const,
    baseDraftUpdatedAt: null,
    resolvedPatchIds: [],
    resolvedAt: null,
    proposalError: null,
    createdAt: "2026-04-27T00:40:00.000Z",
    ...rest,
  } satisfies ResumeAssistantMessage;
}

function buildAssessment(overrides?: {
  claimText?: string;
  status?: "exact" | "paraphrase" | "review" | "unsupported";
}): ResumeClaimAssessment {
  return {
    id: "assessment one",
    field: "entry_bullet",
    sectionId: "sec experience",
    entryId: "ent design",
    bulletId: "bul one",
    claimText: overrides?.claimText ?? savedBulletText,
    claimOrigin: "assistant_edited",
    contentHash: "fnv1a32:00000000",
    status: overrides?.status ?? "exact",
    evidenceRefs: [],
    verifier: "deterministic_candidate_evidence_v1",
    assessedAt: "2026-04-27T01:00:00.000Z",
  };
}

function buildValidation(
  claimAssessments: readonly ResumeClaimAssessment[],
): ResumeValidationResult {
  return {
    id: "validation one",
    draftId: "draft demo",
    issues: [],
    draftContentHash: null,
    claimAssessments: [...claimAssessments],
    coverageComparison: null,
    pageCount: null,
    validatedAt: "2026-04-27T01:00:00.000Z",
  };
}

function renderCard(props?: {
  draft?: ResumeDraft;
  message?: ResumeAssistantMessage;
  validation?: ResumeValidationResult | null;
}) {
  return render(
    <ResumeAssistantProposalCard
      draft={props?.draft ?? buildDraft()}
      isPending={false}
      message={props?.message ?? buildMessage()}
      onResolve={vi.fn()}
      validation={props?.validation ?? null}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("ResumeAssistantProposalCard grounding", () => {
  it("prints one verdict heading with its reason always attached", () => {
    const renderResult = renderCard({
      validation: buildValidation([buildAssessment({ status: "exact" })]),
    });

    // The verdict used to be a collapsed `<details>` summary, so the panel
    // showed a bare uppercase label with no body directly above Accept.
    expect(
      screen
        .getByText("Checked against your saved evidence")
        .closest("details"),
    ).toBeNull();
    expect(
      screen.getByText("Supporting evidence (1)").closest("details")?.open,
    ).toBe(false);

    const grounding = renderResult.container.querySelector(
      "[data-resume-proposal-grounding]",
    );
    expect(grounding).toBeTruthy();
    expect(grounding?.textContent).toContain(
      "Checked against your saved evidence",
    );
    expect(
      grounding?.querySelector("[data-resume-proposal-grounding-outcome]")
        ?.textContent,
    ).toBe("Adds no new wording that would block approval.");
    expect(
      screen.getByText("Current saved text: Exact evidence."),
    ).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText(profileSnippet)).toBeTruthy();
    expect(
      screen.getByText("New wording is checked after you accept and save."),
    ).toBeTruthy();
    expect(screen.getByText(proposedBulletText)).toBeTruthy();
    expect(
      screen.getByText(
        "Lands on Experience · Senior Systems Designer · Bullet 1.",
      ),
    ).toBeTruthy();
  });

  it("uses one vocabulary for the blocked and the clear outcome", () => {
    const clear = renderCard({
      validation: buildValidation([buildAssessment({ status: "exact" })]),
    });
    expect(
      clear.container.querySelectorAll("[data-resume-proposal-grounding]")
        .length,
    ).toBe(1);
    expect(clear.container.textContent).toContain(
      "Checked against your saved evidence",
    );
    expect(clear.container.textContent).not.toContain(
      "Why this edit is grounded",
    );
    clear.unmount();

    const blocked = renderCard({
      message: buildMessage({
        approvalBlockers: [
          {
            patchId: "patch one",
            sectionId: "sec experience",
            entryId: "ent design",
            bulletId: "bul one",
            flaggedText: proposedBulletText,
            message: "Not supported by saved evidence.",
          },
        ],
      }),
    });
    expect(blocked.container.textContent).toContain(
      "Checked against your saved evidence",
    );
    expect(blocked.container.textContent).not.toContain(
      "Why this edit would block approval",
    );
    expect(
      blocked.container.querySelector(
        "[data-resume-proposal-grounding-outcome]",
      )?.textContent,
    ).toBe(
      "Blocks approval: your saved evidence does not back the new wording. Accept it only if it is true, then approve it as accurate in the resume checks.",
    );
  });

  it("reports not-checked saved text when validation is absent, mismatched, or stale", () => {
    const absent = renderCard();
    expect(
      screen.getByText("Current saved text: Not checked yet."),
    ).toBeTruthy();
    absent.unmount();

    renderCard({
      validation: buildValidation([
        buildAssessment({ claimText: "Older saved bullet wording." }),
      ]),
    });
    expect(
      screen.getByText("Current saved text: Not checked yet."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Current saved text: Exact evidence."),
    ).toBeNull();
    expect(
      screen.getByText("New wording is checked after you accept and save."),
    ).toBeTruthy();
  });

  it("never presents the proposed wording as already verified", () => {
    renderCard({
      validation: buildValidation([buildAssessment({ status: "exact" })]),
    });

    const statusLines = screen.getAllByText(/Current saved text:/);
    expect(statusLines.length).toBe(1);
    expect(
      screen.getByText("New wording is checked after you accept and save."),
    ).toBeTruthy();
  });

  it("describes a deletion of existing wording as a removal, never as grounded", () => {
    renderCard({
      message: buildMessage({
        patches: [buildPatch({ operation: "remove_bullet", newText: null })],
      }),
    });

    expect(
      screen.getByText(
        "Removes wording you already have. Your saved evidence is unchanged, so nothing new is claimed.",
      ),
    ).toBeTruthy();
  });

  it("keeps grounded provenance on accepted and rejected historical cards", () => {
    const accepted = renderCard({
      message: buildMessage({
        proposalStatus: "accepted",
        resolvedPatchIds: ["patch one"],
        resolvedAt: "2026-04-27T02:00:00.000Z",
      }),
      validation: buildValidation([buildAssessment({ status: "exact" })]),
    });
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(
      screen.getByText("Current saved text: Exact evidence."),
    ).toBeTruthy();
    expect(document.querySelectorAll("input[type=checkbox]").length).toBe(0);
    accepted.unmount();

    renderCard({
      message: buildMessage({
        proposalStatus: "rejected",
        resolvedAt: "2026-04-27T02:00:00.000Z",
      }),
    });
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(
      screen.getByText("Current saved text: Not checked yet."),
    ).toBeTruthy();
    expect(document.querySelectorAll("input[type=checkbox]").length).toBe(0);
  });

  it("leaves proposal selection alone while the verdict is visible", () => {
    const renderResult = renderCard({
      validation: buildValidation([buildAssessment()]),
    });
    const checkbox = screen.getByLabelText(
      "Select proposed change 1: update bullet",
    );
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error("Expected checkbox input element");
    }
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText(profileSnippet)).toBeTruthy();

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(renderResult.container.textContent).not.toContain("_");
  });

  it("degrades honestly when the patch target is gone", () => {
    renderCard({
      message: buildMessage({
        patches: [
          buildPatch({
            targetSectionId: "sec removed",
            targetEntryId: null,
            targetBulletId: null,
          }),
        ],
      }),
    });

    expect(
      screen.getByText("Original target is no longer in the draft"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This edit points at a target that is no longer in the draft.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Current saved text: Not checked yet."),
    ).toBeTruthy();
    expect(screen.queryByText(profileSnippet)).toBeNull();
  });

  it("skips saved-text claims for wording-free operations", () => {
    renderCard({
      message: buildMessage({
        patches: [
          buildPatch({
            operation: "toggle_include",
            newIncluded: false,
            newText: null,
          }),
        ],
      }),
    });

    expect(screen.queryByText(/Current saved text:/)).toBeNull();
    expect(
      screen.queryByText("New wording is checked after you accept and save."),
    ).toBeNull();
    expect(screen.getByText("Profile")).toBeTruthy();
  });
});

describe("ResumeAssistantProposalCard export-gate warnings", () => {
  const liveUngroundedSummary =
    "Senior Software Engineer with 10+ years building secure, scalable healthcare SaaS platforms with C#, .NET, ASP.NET Core, REST APIs, MongoDB, SQL Server, and Azure/AWS. Delivered microservices and EHR-adjacent integrations for scheduling and billing, with resilient third-party integrations, CI/CD, and observability for reliable Agile delivery.";

  function buildBlockedMessage(): ResumeAssistantMessage {
    return buildMessage({
      content:
        "I prepared 1 resume edit, but 1 of them would block approval: the new wording is not supported by your saved evidence.",
      patches: [
        buildPatch({
          id: "patch summary",
          operation: "replace_section_text",
          targetSectionId: "sec summary",
          targetEntryId: null,
          targetBulletId: null,
          newText: liveUngroundedSummary,
        }),
      ],
      approvalBlockers: [
        {
          patchId: "patch summary",
          sectionId: "sec summary",
          entryId: null,
          bulletId: null,
          flaggedText: liveUngroundedSummary,
          message:
            "Your saved evidence does not back this generated claim. Rewrite it, or approve it as accurate if you can stand behind it.",
        },
      ],
    });
  }

  it("warns that the proposal would block approval and never calls it grounded", () => {
    const renderResult = renderCard({ message: buildBlockedMessage() });

    expect(
      renderResult.container.querySelector(
        "[data-resume-proposal-approval-warning]",
      )?.textContent,
    ).toContain(
      "1 proposed change would block approval because your saved evidence does not back its new wording.",
    );
    expect(
      renderResult.container.querySelector(
        '[data-resume-proposal-approval-blocker="patch summary"]',
      )?.textContent,
    ).toContain(liveUngroundedSummary);
    expect(
      renderResult.container.querySelector(
        "[data-resume-proposal-grounding-outcome]",
      )?.textContent,
    ).toBe(
      "Blocks approval: your saved evidence does not back the new wording. Accept it only if it is true, then approve it as accurate in the resume checks.",
    );
  });

  it("names a stretch that goes to Lines to confirm without calling it a blocker", () => {
    const message = buildBlockedMessage();
    const renderResult = renderCard({
      message: {
        ...message,
        approvalBlockers: message.approvalBlockers!.map((blocker) => ({
          ...blocker,
          message:
            "This wording stretches past your saved evidence. After you accept, it is listed under Lines to confirm, where you keep it or remove it.",
          kind: "needs_confirmation" as const,
        })),
      },
    });

    const blockerBox = renderResult.container.querySelector(
      '[data-resume-proposal-approval-blocker="patch summary"]',
    );
    expect(blockerBox?.getAttribute("data-resume-proposal-approval-blocker-kind")).toBe(
      "needs_confirmation",
    );
    expect(blockerBox?.textContent).toContain("Goes to Lines to confirm");
    expect(blockerBox?.textContent).not.toContain("Would block approval");
    expect(
      renderResult.container.querySelector(
        "[data-resume-proposal-grounding-outcome]",
      )?.textContent,
    ).toBe(
      "Stretches past your saved evidence. After you accept, it is listed under Lines to confirm, where you keep it or remove it.",
    );
    expect(
      renderResult.container.querySelector(
        "[data-resume-proposal-approval-warning]",
      )?.textContent,
    ).toContain(
      "1 change stretches past your saved evidence; after you accept, it is listed under Lines to confirm for you to keep or remove.",
    );
    // Accept stays the primary action: this is decided under Lines to confirm.
    expect(
      screen.getByRole("button", { name: "Accept selected (1)" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept anyway/ })).toBeNull();
  });

  it("counts approval blockers the resume already carries so the panel cannot promise approval", () => {
    const draft = buildDraft();
    const renderResult = renderCard({
      draft,
      message: buildMessage({ approvalBlockers: [] }),
      validation: {
        ...buildValidation([]),
        issues: [
          {
            id: "issue blocking",
            severity: "error",
            category: "unsupported_claim",
            message: "An existing claim is unsupported.",
            sectionId: "sec summary",
            entryId: null,
            bulletId: null,
            flaggedText: null,
          },
        ],
      },
    });

    expect(
      renderResult.container.querySelector(
        "[data-resume-proposal-approval-warning]",
      )?.textContent,
    ).toContain(
      "The resume already has 1 approval blocker, and accepting this proposal does not clear it.",
    );
  });

  it("names undecided Lines to confirm as decisions, not approval blockers", () => {
    const draft = buildDraft();
    const renderResult = renderCard({
      draft,
      message: buildMessage({ approvalBlockers: [] }),
      validation: {
        ...buildValidation([
          {
            id: "claim_stretch",
            field: "section_bullet",
            sectionId: "sec skills",
            entryId: null,
            bulletId: "bul graphql",
            claimText: "GraphQL",
            claimOrigin: "ai_generated",
            contentHash: "fnv1a32:22222222",
            status: "confirm_needed",
            evidenceRefs: [],
            verifier: "deterministic_candidate_evidence_v2",
            assessedAt: "2026-04-27T01:00:00.000Z",
          },
        ]),
        issues: [
          {
            id: "issue_claim_grounding_claim_stretch",
            severity: "error",
            category: "unsupported_claim",
            message: "Your saved evidence does not back this generated claim.",
            sectionId: "sec skills",
            entryId: null,
            bulletId: "bul graphql",
            flaggedText: "GraphQL",
          },
        ],
      },
    });

    const warning = renderResult.container.querySelector(
      "[data-resume-proposal-approval-warning]",
    )?.textContent;
    expect(warning).toContain(
      "1 line is still waiting for your Keep or Remove under Lines to confirm.",
    );
    expect(warning).not.toContain("approval blocker");
  });

  it("demotes accept-anyway and offers the edit route the block text asks for", () => {
    const onEditWording = vi.fn();
    render(
      <ResumeAssistantProposalCard
        draft={buildDraft()}
        isPending={false}
        message={buildBlockedMessage()}
        onEditWording={onEditWording}
        onResolve={vi.fn()}
        validation={null}
      />,
    );

    const editButton = screen.getByRole("button", {
      name: "Edit this wording myself",
    });
    fireEvent.click(editButton);
    expect(onEditWording).toHaveBeenCalledWith("section:sec%20summary:text");

    // The accept path stays available but stops presenting itself as a peer
    // of Reject: it drops to the quietest variant and says what it costs.
    const acceptButton = screen.getByRole("button", {
      name: "Accept anyway (1)",
    });
    expect(acceptButton.className).not.toContain("border-primary");
    // Quieter than Reject, but still a control: a bare ghost button had no
    // boundary at all here and read as plain text beside the bordered
    // "Reject proposal".
    expect(acceptButton.className).toContain("border-(--control-border)");
    const rejectButton = screen.getByRole("button", {
      name: "Reject proposal",
    });
    expect(rejectButton.className).not.toBe(acceptButton.className);
    expect(
      screen.getByText(
        "Accepting a blocked change keeps approval disabled until you rewrite the flagged wording or approve it as accurate in the resume checks.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Accept selected/ }),
    ).toBeNull();
  });

  it("keeps the decision row pinned so it is painted at short panel heights", () => {
    const renderResult = renderCard({ message: buildMessage() });
    const decisionRow = renderResult.container.querySelector(
      "[data-resume-proposal-decision-row]",
    );

    expect(decisionRow).toBeTruthy();
    expect(decisionRow?.className).toContain("sticky");
    expect(decisionRow?.className).toContain("bottom-0");
    expect(decisionRow?.querySelector("button")?.textContent).toBeTruthy();
  });

  it("leaves a persistent result line for every resolved proposal", () => {
    const refused = renderCard({
      message: buildMessage({
        proposalStatus: "accepted",
        resolvedPatchIds: [],
        resolvedAt: "2026-04-27T02:00:00.000Z",
      }),
    });
    expect(
      refused.container.querySelector("[data-resume-proposal-result]")
        ?.textContent,
    ).toBe(
      "Not applied — none of the selected changes passed the grounding check, so your draft is unchanged.",
    );
    refused.unmount();

    const rejected = renderCard({
      message: buildMessage({
        proposalStatus: "rejected",
        resolvedAt: "2026-04-27T02:00:00.000Z",
      }),
    });
    expect(
      rejected.container.querySelector("[data-resume-proposal-result]")
        ?.textContent,
    ).toBe(
      "Not applied — this proposal was rejected and your draft is unchanged.",
    );
  });

  it("names a whole-draft blocker as the draft's, not as the proposed wording's", () => {
    const draftLevelMessage =
      "This preview-derived resume contains untraceable candidate content and needs factual review before approval.";
    const renderResult = renderCard({
      message: buildMessage({
        approvalBlockers: [
          {
            patchId: null,
            sectionId: null,
            entryId: null,
            bulletId: null,
            flaggedText: null,
            message: draftLevelMessage,
          },
        ],
      }),
    });

    const warning = renderResult.container.querySelector(
      "[data-resume-proposal-approval-warning]",
    )?.textContent;
    expect(warning).toContain(
      "No proposed change adds wording that would block approval.",
    );
    expect(warning).toContain(
      `Approval stays blocked for the whole resume, not because of this change: ${draftLevelMessage}`,
    );
    expect(warning).not.toContain("1 proposed change would block approval");
    expect(
      screen.getByText("Adds no new wording that would block approval."),
    ).toBeTruthy();
  });

  it("keeps the clear wording when the export gate reported no blockers", () => {
    renderCard({ message: buildMessage({ approvalBlockers: [] }) });

    expect(
      screen.getByText("Adds no new wording that would block approval."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Accept selected (1)" }),
    ).toBeTruthy();
  });
});

describe("ResumeAssistantProposalCard readable, selectable decisions", () => {
  it("gives every selected change a visible selected state matching the accept count", () => {
    // "Accept selected (n)" counted cards that carried no visible state of
    // their own, so the number referred to nothing the user could see.
    renderCard({
      message: buildMessage({
        patches: [
          buildPatch({ id: "patch one" }),
          buildPatch({
            id: "patch two",
            newText: "A second proposed replacement bullet.",
          }),
        ],
      }),
    });

    const selectedCards = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-resume-proposal-patch-selected="true"]',
        ),
      );
    const acceptCount = () =>
      Number.parseInt(
        /\((\d+)\)/.exec(
          document.querySelector("[data-resume-proposal-accept]")
            ?.textContent ?? "",
        )?.[1] ?? "-1",
        10,
      );

    expect(selectedCards().length).toBe(2);
    expect(acceptCount()).toBe(2);
    expect(screen.getAllByText("Selected").length).toBe(2);

    fireEvent.click(
      screen.getByLabelText("Select proposed change 2: update bullet"),
    );

    expect(selectedCards().length).toBe(1);
    expect(acceptCount()).toBe(1);
    expect(screen.getByText("Not selected")).toBeTruthy();
    expect(
      document
        .querySelector('[data-resume-proposal-patch="patch two"]')
        ?.getAttribute("data-resume-proposal-patch-selected"),
    ).toBe("false");
  });

  it("shows the whole proposed wording and the whole evidence excerpt before Accept", () => {
    // The evidence beside Accept used to clamp to three lines, so the user was
    // asked to approve wording that ended mid-sentence in an ellipsis with no
    // expander anywhere on the card.
    const longSnippet = [
      "Ran the rollout playbook across teams, including onboarding, tooling,",
      "documentation, and the review cadence that kept the design system",
      "aligned with the platform roadmap for four consecutive quarters",
      "without regressions.",
    ].join(" ");
    const draft = buildDraft();
    const experience = draft.sections[1];
    if (!experience?.entries[0]) {
      throw new Error("Expected the experience entry fixture");
    }
    experience.entries[0].sourceRefs = [
      { ...profileSourceRef, snippet: longSnippet },
    ];

    renderCard({
      draft,
      validation: buildValidation([buildAssessment()]),
    });

    const evidence = screen.getByText(longSnippet);

    expect(evidence.className).not.toContain("line-clamp");
    expect(evidence.textContent).toBe(longSnippet);
    expect(
      Array.from(document.querySelectorAll("[class*='line-clamp']")).length,
    ).toBe(0);
    // The proposed wording itself stays complete in the same card.
    expect(document.body.textContent).toContain(proposedBulletText);
  });
});
