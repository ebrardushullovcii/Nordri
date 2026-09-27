// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ResumeAssistantMessage,
  ResumeClaimAssessment,
  ResumeDraft,
  ResumeDraftPatch,
  ResumeValidationResult,
} from "@unemployed/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeAssistantPanel } from "./resume-assistant-panel";

const savedSummaryText =
  "Systems-focused product designer with deep workflow automation experience.";
const proposedSummaryText = "A tighter, job-specific proposed summary.";
const jobSnippet = "Own the workflow automation surface end to end.";

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
        sourceRefs: [
          {
            id: "ref job demo",
            sourceKind: "job",
            sourceId: null,
            snippet: jobSnippet,
          },
        ],
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

function buildPatch(): ResumeDraftPatch {
  return {
    id: "patch one",
    draftId: "draft demo",
    operation: "replace_section_text",
    targetSectionId: "sec summary",
    targetEntryId: null,
    anchorEntryId: null,
    targetBulletId: null,
    anchorBulletId: null,
    position: null,
    newText: proposedSummaryText,
    newIncluded: null,
    newLocked: null,
    newBullets: null,
    appliedAt: "2026-04-27T00:30:00.000Z",
    origin: "assistant",
    conflictReason: null,
  };
}

function buildMessage(): ResumeAssistantMessage {
  return {
    id: "assistant one",
    jobId: "job demo",
    role: "assistant",
    content: "Here is a grounded edit.",
    patches: [buildPatch()],
    proposalStatus: "pending",
    baseDraftUpdatedAt: null,
    resolvedPatchIds: [],
    resolvedAt: null,
    proposalError: null,
    createdAt: "2026-04-27T00:40:00.000Z",
  };
}

function buildValidation(): ResumeValidationResult {
  const assessment: ResumeClaimAssessment = {
    id: "assessment one",
    field: "section_text",
    sectionId: "sec summary",
    entryId: null,
    bulletId: null,
    claimText: savedSummaryText,
    claimOrigin: "ai_generated",
    contentHash: "fnv1a32:00000000",
    status: "exact",
    evidenceRefs: [],
    verifier: "deterministic_candidate_evidence_v1",
    assessedAt: "2026-04-27T01:00:00.000Z",
  };

  return {
    id: "validation one",
    draftId: "draft demo",
    issues: [],
    draftContentHash: null,
    claimAssessments: [assessment],
    coverageComparison: null,
    pageCount: null,
    validatedAt: "2026-04-27T01:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
});

describe("ResumeAssistantPanel", () => {
  it("is the one Assistant, in one floating placement, and it never sizes itself", () => {
    const { container } = render(
      <ResumeAssistantPanel
        assistantMessages={[]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={vi.fn()}
      />,
    );

    const panel = container.querySelector<HTMLElement>(
      "[data-resume-assistant-panel]",
    );

    // The docked studio column and the compact Assistant tab are gone: this
    // panel only ever renders inside the floating shell, so opening it can
    // never re-flow the studio.
    expect(panel?.dataset.resumeAssistantVariant).toBe("floating");
    // Fills its container and scrolls internally; the caller owns the bound.
    expect(panel?.className).toContain("h-full");
    expect(panel?.className).toContain("min-h-0");
    expect(
      panel?.querySelector("[data-resume-guided-edits-transcript]"),
    ).not.toBeNull();
    expect(
      panel?.querySelector("[data-resume-guided-edits-composer]"),
    ).not.toBeNull();

    expect(
      screen.getByRole("heading", { level: 2, name: "Assistant" }),
    ).toBeTruthy();
    // The retired second implementation called itself "Guided edits" and
    // sent with a "Send request" button.
    expect(container.textContent).not.toContain("Guided edits");
    expect(container.textContent).not.toContain("Send request");
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
  });

  it("keeps a pending proposal's decision controls inside the scrolling transcript", () => {
    const { container } = render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage()]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={vi.fn()}
        validation={buildValidation()}
      />,
    );

    const reject = screen.getByRole("button", { name: "Reject proposal" });
    const accept = screen.getByRole("button", { name: /^Accept selected/ });

    for (const control of [accept, reject]) {
      expect(
        control.closest("[data-resume-guided-edits-transcript]"),
      ).not.toBeNull();
    }
    expect(
      container.querySelector("[data-resume-guided-edits-composer]"),
    ).not.toBeNull();
  });

  // The floating panel keeps its own viewport inset, so the composer never
  // needs the extra bottom gutter the retired in-studio placements reserved to
  // clear the window edge.
  it("keeps the composer flush inside the floating panel", () => {
    const { container } = render(
      <ResumeAssistantPanel
        assistantMessages={[]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={vi.fn()}
      />,
    );

    expect(
      container
        .querySelector<HTMLElement>("[data-resume-guided-edits-composer]")
        ?.className.includes("pb-[1.375rem]"),
    ).toBe(false);
  });

  it("applies the latest safe proposal when the person says do it", () => {
    const resolveProposal = vi.fn();
    const sendMessage = vi.fn();
    render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage()]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={sendMessage}
        onResolveProposal={resolveProposal}
        validation={buildValidation()}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
      { target: { value: "do it" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(resolveProposal).toHaveBeenCalledWith("assistant one", "accept", [
      "patch one",
    ]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(["yes", "Yes please!", "go ahead", "ok, do it", "sounds good"])(
    "applies the latest safe proposal on a typed yes: %s",
    (reply) => {
      const resolveProposal = vi.fn();
      const sendMessage = vi.fn();
      render(
        <ResumeAssistantPanel
          assistantMessages={[buildMessage()]}
          assistantPending={false}
          draft={buildDraft()}
          isWorkspacePending={false}
          onSendAssistantMessage={sendMessage}
          onResolveProposal={resolveProposal}
          validation={buildValidation()}
        />,
      );

      fireEvent.change(
        screen.getByRole("textbox", { name: "Message the Assistant" }),
        { target: { value: reply } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      expect(resolveProposal).toHaveBeenCalledWith("assistant one", "accept", [
        "patch one",
      ]);
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it("applies a proposal whose only flag is a line to confirm on a typed yes", () => {
    const resolveProposal = vi.fn();
    const confirmMessage = {
      ...buildMessage(),
      approvalBlockers: [
        {
          patchId: "patch one",
          sectionId: "sec summary",
          entryId: null,
          bulletId: null,
          flaggedText: proposedSummaryText,
          message: "This wording stretches past your saved evidence.",
          kind: "needs_confirmation" as const,
        },
      ],
    } satisfies ResumeAssistantMessage;
    render(
      <ResumeAssistantPanel
        assistantMessages={[confirmMessage]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={resolveProposal}
        validation={buildValidation()}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
      { target: { value: "yes" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(resolveProposal).toHaveBeenCalledWith("assistant one", "accept", [
      "patch one",
    ]);
  });

  it("sends a pick among proposed changes to the Assistant instead of accepting everything", () => {
    const resolveProposal = vi.fn();
    const sendMessage = vi.fn();
    render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage()]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={sendMessage}
        onResolveProposal={resolveProposal}
        validation={buildValidation()}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
      { target: { value: "the second one" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(resolveProposal).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("the second one");
  });

  it("does not apply a blocked proposal when the person says do it", () => {
    const resolveProposal = vi.fn();
    const sendMessage = vi.fn();
    const blockedMessage = {
      ...buildMessage(),
      approvalBlockers: [
        {
          patchId: "patch one",
          sectionId: "sec summary",
          entryId: null,
          bulletId: null,
          flaggedText: proposedSummaryText,
          message: "This wording is not supported by saved evidence.",
        },
      ],
    } satisfies ResumeAssistantMessage;
    render(
      <ResumeAssistantPanel
        assistantMessages={[blockedMessage]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={sendMessage}
        onResolveProposal={resolveProposal}
        validation={buildValidation()}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
      { target: { value: "do it" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(resolveProposal).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("do it");
  });

  it("does not skip a newer blocked response to apply an older safe proposal", () => {
    const resolveProposal = vi.fn();
    const sendMessage = vi.fn();
    const blockedMessage = {
      ...buildMessage(),
      id: "assistant newer blocked",
      createdAt: "2026-04-27T00:50:00.000Z",
      approvalBlockers: [
        {
          patchId: "patch one",
          sectionId: "sec summary",
          entryId: null,
          bulletId: null,
          flaggedText: proposedSummaryText,
          message: "This wording is not supported by saved evidence.",
        },
      ],
    } satisfies ResumeAssistantMessage;
    render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage(), blockedMessage]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={sendMessage}
        onResolveProposal={resolveProposal}
        validation={buildValidation()}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message the Assistant" }),
      { target: { value: "do it" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(resolveProposal).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("do it");
  });
});

describe("ResumeAssistantPanel grounding", () => {
  it("surfaces the proposal's grounding verdict and its evidence, checked and unchecked", () => {
    const checked = render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage()]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={vi.fn()}
        validation={buildValidation()}
      />,
    );

    // The verdict block and the job evidence behind it are always visible; the
    // exact copy is owned by `resume-assistant-proposal-card.test.tsx`.
    expect(
      checked.container.querySelector("[data-resume-proposal-grounding]"),
    ).not.toBeNull();
    expect(checked.container.textContent).toContain(jobSnippet);
    expect(
      screen.getByLabelText("Select proposed change 1: replace section text"),
    ).toBeTruthy();
    const checkedOutcome = checked.container.querySelector(
      "[data-resume-proposal-grounding-outcome]",
    )?.textContent;
    expect(checkedOutcome?.length).toBeGreaterThan(0);

    cleanup();

    const unchecked = render(
      <ResumeAssistantPanel
        assistantMessages={[buildMessage()]}
        assistantPending={false}
        draft={buildDraft()}
        isWorkspacePending={false}
        onSendAssistantMessage={vi.fn()}
        onResolveProposal={vi.fn()}
      />,
    );

    // Without a loaded validation the panel must still render a verdict rather
    // than implying the wording was verified.
    const uncheckedGrounding = unchecked.container.querySelector(
      "[data-resume-proposal-grounding]",
    );
    expect(uncheckedGrounding).not.toBeNull();
    expect(
      unchecked.container.querySelector(
        "[data-resume-proposal-grounding-outcome]",
      )?.textContent?.length,
    ).toBeGreaterThan(0);
  });
});
