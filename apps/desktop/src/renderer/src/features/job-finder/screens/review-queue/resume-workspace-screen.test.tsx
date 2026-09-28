// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  JobFinderResumePreview,
  JobFinderResumeWorkspace,
  ResumeDraft,
  ResumeDraftPatch,
  ResumeAssistantMessage,
  ResumeTemplateDefinition,
  WorkHistoryReviewAcknowledgment,
} from "@unemployed/contracts";
import {
  getResumeIdentityTargetId,
  ResumeDraftRevisionSchema,
} from "@unemployed/contracts";
import { JobFinderResumeWorkspaceSchema } from "@unemployed/contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApplyQueueDemoState } from "../../../../../../main/adapters/job-finder-demo-state";
import {
  createJobFinderSaveCoordinator,
  JOB_FINDER_STALE_RETRY_GUIDANCE,
  type JobFinderSaveState,
} from "@renderer/pages/job-finder-save-state";
import { ResumeWorkspaceScreen } from "./resume-workspace-screen";
import type { ResumeWorkHistoryDecisionRequest } from "./resume-workspace-work-history-decisions";

const availableResumeTemplates: readonly ResumeTemplateDefinition[] = [
  {
    id: "classic_ats",
    label: "Chronology Classic",
    familyId: "chronology_classic",
    familyLabel: "Chronology Classic",
    familyDescription: "Calm ATS-safe layouts.",
    variantLabel: "Recruiter Standard",
    description:
      "Single-column, conservative, and recruiter-friendly for high parsing reliability.",
    fitSummary: "A clean all-rounder.",
    avoidSummary: "Less distinctive for project-led portfolios.",
    bestFor: ["General applications"],
    visualTags: ["Minimal", "Balanced"],
    density: "balanced",
    deliveryLane: "apply_safe",
    atsConfidence: "high",
    applyEligible: true,
    approvalEligible: true,
    benchmarkEligible: true,
    sortOrder: 10,
  },
  {
    id: "technical_matrix",
    label: "Engineering Spec",
    familyId: "engineering_spec",
    familyLabel: "Engineering Spec",
    familyDescription: "Spec-like ATS-safe layouts.",
    variantLabel: "Skills First",
    description:
      "Skills-forward single-column layout that highlights technical depth before chronology.",
    fitSummary: "Best when systems depth should land early.",
    avoidSummary: "Can feel too technical for generalist roles.",
    bestFor: ["Engineering roles"],
    visualTags: ["Skills matrix", "Technical"],
    density: "compact",
    deliveryLane: "apply_safe",
    atsConfidence: "high",
    applyEligible: true,
    approvalEligible: true,
    benchmarkEligible: true,
    sortOrder: 20,
  },
  {
    id: "project_showcase",
    label: "Proof Portfolio",
    familyId: "proof_portfolio",
    familyLabel: "Proof Portfolio",
    familyDescription: "Proof-led ATS-safe layouts.",
    variantLabel: "Projects First",
    description:
      "Project-forward single-column layout for candidates whose proof lands best through shipped work.",
    fitSummary: "Useful when shipped work is your strongest evidence.",
    avoidSummary: "Less ideal for conservative chronology-first screens.",
    bestFor: ["Portfolio-heavy candidates"],
    visualTags: ["Projects first", "Proof led"],
    density: "comfortable",
    deliveryLane: "apply_safe",
    atsConfidence: "high",
    applyEligible: true,
    approvalEligible: true,
    benchmarkEligible: true,
    sortOrder: 30,
  },
];

function buildWorkspace(): JobFinderResumeWorkspace {
  const state = createApplyQueueDemoState();
  const job = state.savedJobs.find((entry) => entry.id === "job_ready");
  const baseDraft = state.resumeDrafts.find(
    (entry) => entry.jobId === "job_ready",
  );
  const tailoredAsset =
    state.tailoredAssets.find((entry) => entry.jobId === "job_ready") ?? null;

  if (!job || !baseDraft) {
    throw new Error(
      "Expected demo state to contain the ready resume workspace fixture.",
    );
  }
  const draft: ResumeDraft = {
    ...baseDraft,
    sections: baseDraft.sections.map((section) =>
      section.kind === "experience"
        ? {
            ...section,
            entries: [
              {
                ...section.entries[0]!,
                id: "experience_demo_previous",
                title: "Previous Systems Designer",
                subtitle: "Northwind Labs",
                dateRange: "2019 – 2021",
                startDate: "2019",
                endDate: "2021",
                isCurrent: false,
                sortOrder: 1,
                profileRecordId: "experience_demo_previous",
              },
              ...section.entries,
              {
                id: "experience_demo_hidden",
                entryType: "experience",
                title: "Sales Operations Associate",
                subtitle: "Bright Market",
                location: "Remote",
                dateRange: "2019 – 2020",
                startDate: "2019",
                endDate: "2020",
                isCurrent: false,
                summary: "Coordinated customer operations reporting.",
                bullets: [],
                origin: "ai_generated",
                locked: false,
                included: false,
                sortOrder: section.entries.length + 1,
                profileRecordId: "experience_demo_hidden",
                sourceRefs: [],
                updatedAt: baseDraft.updatedAt,
              },
            ],
          }
        : section,
    ),
  };

  return JobFinderResumeWorkspaceSchema.parse({
    job,
    draft,
    validation: null,
    exports: state.resumeExportArtifacts.filter(
      (entry) => entry.jobId === "job_ready",
    ),
    research: [],
    assistantMessages: [],
    tailoredAsset,
    sharedProfile: {},
    workHistoryReviewSuggestions: [
      {
        id: "work_history_review_demo_hidden",
        profileRecordId: "experience_demo_hidden",
        sectionId: "section_experience",
        entryId: null,
        kind: "weak_fit",
        action: "consider_showing",
        severity: "info",
        message:
          "Hidden by default for review: this role has a weaker career-family fit for the target job.",
        messageContentHash: "fnv1a32:465fc3f2",
      },
    ],
  });
}

function buildWorkspaceWithRevision(): JobFinderResumeWorkspace {
  const workspace = buildWorkspace();

  return JobFinderResumeWorkspaceSchema.parse({
    ...workspace,
    revisions: [
      ResumeDraftRevisionSchema.parse({
        id: "revision_restore_1",
        draftId: workspace.draft.id,
        parentRevisionId: null,
        actor: "user",
        mutationKind: "manual_save",
        snapshotDraft: workspace.draft,
        snapshotIdentity: workspace.draft.identity,
        snapshotSections: workspace.draft.sections,
        beforeHash: "before_restore_1",
        afterHash: "after_restore_1",
        diff: {
          templateChanged: false,
          identityChanged: false,
          sectionOrderChanged: false,
          addedSectionIds: [],
          removedSectionIds: [],
          changedSectionIds: ["section_summary"],
        },
        restoredFromRevisionId: null,
        createdAt: "2026-04-27T00:00:00.000Z",
        reason: "Before template change",
      }),
    ],
  });
}
/**
 * A saved workspace whose summary text is blocked by the export gate, with one
 * earlier revision that still holds the text the blocked claim replaced.
 */
function buildWorkspaceWithBlockedSummaryClaim(): JobFinderResumeWorkspace {
  const workspace = buildWorkspace();
  const summarySection =
    workspace.draft.sections.find((section) => section.text?.trim()) ?? null;

  if (!summarySection?.text) {
    throw new Error("Expected the demo draft to contain a text section.");
  }

  const previousDraft: ResumeDraft = {
    ...workspace.draft,
    sections: workspace.draft.sections.map((section) =>
      section.id === summarySection.id
        ? { ...section, text: "Previous grounded summary text." }
        : section,
    ),
  };

  return JobFinderResumeWorkspaceSchema.parse({
    ...workspace,
    validation: {
      id: "validation_blocked_claim",
      draftId: workspace.draft.id,
      issues: [
        {
          id: `issue_claim_grounding_${summarySection.id}`,
          severity: "error",
          category: "unsupported_claim",
          sectionId: summarySection.id,
          entryId: null,
          bulletId: null,
          message:
            "Your saved evidence does not back this generated claim. Rewrite it, or approve it as accurate if you can stand behind it.",
          flaggedText: summarySection.text,
        },
      ],
      draftContentHash: null,
      claimAssessments: [],
      coverageComparison: null,
      pageCount: null,
      validatedAt: "2026-04-27T01:00:00.000Z",
    },
    revisions: [
      ResumeDraftRevisionSchema.parse({
        id: "revision_blocked_claim_previous",
        draftId: workspace.draft.id,
        parentRevisionId: null,
        actor: "user",
        mutationKind: "manual_save",
        snapshotDraft: previousDraft,
        snapshotIdentity: previousDraft.identity,
        snapshotSections: previousDraft.sections,
        beforeHash: null,
        afterHash: null,
        diff: null,
        restoredFromRevisionId: null,
        createdAt: "2026-04-26T00:00:00.000Z",
        reason: null,
      }),
    ],
  });
}

/**
 * A workspace whose saved draft carries one unsupported generated claim, which
 * is what puts `Review blocked claims` on screen.
 */
function buildWorkspaceWithUnsupportedClaim(): JobFinderResumeWorkspace {
  const workspace = buildWorkspace();
  const summarySection =
    workspace.draft.sections.find((section) => section.text?.trim()) ?? null;

  if (!summarySection?.text) {
    throw new Error("Expected the demo draft to contain a text section.");
  }

  return JobFinderResumeWorkspaceSchema.parse({
    ...workspace,
    validation: {
      id: "validation_unsupported_claim",
      draftId: workspace.draft.id,
      issues: [],
      draftContentHash: null,
      claimAssessments: [
        {
          id: "claim_unsupported_summary",
          field: "section_text",
          sectionId: summarySection.id,
          entryId: null,
          bulletId: null,
          claimText: summarySection.text,
          claimOrigin: "ai_generated",
          contentHash: "fnv1a32:0000abcd",
          status: "unsupported",
          evidenceRefs: [],
          verifier: "deterministic_candidate_evidence_v2",
          assessedAt: "2026-04-27T01:00:00.000Z",
        },
      ],
      coverageComparison: null,
      pageCount: null,
      validatedAt: "2026-04-27T01:00:00.000Z",
    },
  });
}

function buildPreview(
  revisionKey: string,
  htmlText: string,
): JobFinderResumePreview {
  return {
    draftId: "resume_draft_job_ready",
    revisionKey,
    html: `<!doctype html><html><body>${htmlText}</body></html>`,
    warnings: [],
    metadata: {
      templateId: "classic_ats",
      renderedAt: "2026-04-27T00:00:00.000Z",
      pageCount: null,
      sectionCount: 2,
      entryCount: 1,
    },
  };
}

function buildAssistantMessage(
  overrides?: Partial<ResumeAssistantMessage>,
): ResumeAssistantMessage {
  return {
    id: overrides?.id ?? "assistant_1",
    jobId: overrides?.jobId ?? "job_ready",
    role: overrides?.role ?? "assistant",
    content: overrides?.content ?? "Draft update ready.",
    patches: overrides?.patches ?? [],
    proposalStatus: overrides?.proposalStatus ?? "none",
    baseDraftUpdatedAt: overrides?.baseDraftUpdatedAt ?? null,
    resolvedPatchIds: overrides?.resolvedPatchIds ?? [],
    resolvedAt: overrides?.resolvedAt ?? null,
    proposalError: overrides?.proposalError ?? null,
    createdAt: overrides?.createdAt ?? "2026-04-27T00:00:00.000Z",
  };
}

function buildPendingProposalWorkspaceAndMessage(): {
  workspace: JobFinderResumeWorkspace;
  message: ResumeAssistantMessage;
} {
  const workspace = buildWorkspace();
  const section = workspace.draft.sections.find((entry) => entry.text);

  if (!section) {
    throw new Error("Expected a text section for proposal coverage.");
  }

  return {
    workspace,
    message: buildAssistantMessage({
      id: "proposal_1",
      proposalStatus: "pending",
      baseDraftUpdatedAt: workspace.draft.updatedAt,
      patches: [
        {
          id: "proposal_patch_1",
          draftId: workspace.draft.id,
          operation: "replace_section_text",
          targetSectionId: section.id,
          targetEntryId: null,
          anchorEntryId: null,
          targetBulletId: null,
          anchorBulletId: null,
          position: null,
          newText: "A clearer proposed summary.",
          newIncluded: null,
          newLocked: null,
          newBullets: null,
          appliedAt: "2026-04-27T00:01:00.000Z",
          origin: "assistant",
          conflictReason: null,
        },
      ],
    }),
  };
}

/**
 * The tools pane keeps only the focused section open, so a one-page resume
 * can be reviewed inside one screen. A test that reaches into another
 * section's fields opens it the way a user would: by its title.
 */
function openEditorSection(sectionId: string): void {
  const toggle = document.querySelector<HTMLButtonElement>(
    `[data-resume-section-toggle="${sectionId}"]`,
  );

  if (!toggle) {
    throw new Error(`No editor section toggle for '${sectionId}'.`);
  }

  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }
}

function renderScreen(options?: {
  assistantMessages?: ResumeAssistantMessage[];
  assistantPending?: boolean;
  onApplyPatch?: (
    patch: ResumeDraftPatch,
    revisionReason?: string | null,
  ) => void;
  onDraftEdited?: () => void;
  onPreviewDraft?: (draft: ResumeDraft) => Promise<JobFinderResumePreview>;
  onRegenerateDraft?: (jobId: string) => void;
  onResolveAssistantProposal?: (
    jobId: string,
    proposalId: string,
    action: "accept" | "reject",
    patchIds: readonly string[],
  ) => void;
  onRestoreRevision?: (jobId: string, revisionId: string) => void;
  onUndoAiEdit?: (jobId: string, revisionId: string) => void;
  onSaveDraftAndThen?: (
    draft: ResumeDraft,
    next: () => void | Promise<void>,
    successMessage?: string | null,
  ) => void;
  onSetWorkHistoryReviewAcknowledgment?: (
    jobId: string,
    decision: ResumeWorkHistoryDecisionRequest,
  ) => void;
  workspace?: JobFinderResumeWorkspace | null;
}) {
  const onPreviewDraft =
    options?.onPreviewDraft ??
    (() => Promise.resolve(buildPreview("preview_ready", "ready-preview")));

  return render(
    <ResumeWorkspaceScreen
      actionMessage={null}
      assistantMessages={options?.assistantMessages ?? []}
      assistantPending={options?.assistantPending ?? false}
      availableResumeTemplates={availableResumeTemplates}
      isWorkspacePending={false}
      jobId="job_ready"
      onApplyPatch={options?.onApplyPatch ?? vi.fn()}
      onApproveCurrentResume={vi.fn()}
      onApproveResume={vi.fn()}
      onBack={vi.fn()}
      onClearResumeApproval={vi.fn()}
      onDirtyChange={vi.fn()}
      {...(options?.onDraftEdited
        ? { onDraftEdited: options.onDraftEdited }
        : {})}
      onExportPdf={vi.fn()}
      onPreviewDraft={onPreviewDraft}
      onRefresh={vi.fn()}
      onRegenerateDraft={options?.onRegenerateDraft ?? vi.fn()}
      onResolveAssistantProposal={
        options?.onResolveAssistantProposal ?? vi.fn()
      }
      onRestoreRevision={options?.onRestoreRevision ?? vi.fn()}
      onUndoAiEdit={options?.onUndoAiEdit ?? vi.fn()}
      onSaveDraft={vi.fn()}
      onSaveDraftAndThen={options?.onSaveDraftAndThen ?? vi.fn()}
      onSendAssistantMessage={vi.fn()}
      onSetWorkHistoryReviewAcknowledgment={
        options?.onSetWorkHistoryReviewAcknowledgment ?? vi.fn()
      }
      workspace={
        options && "workspace" in options ? options.workspace : buildWorkspace()
      }
    />,
  );
}

describe("ResumeWorkspaceScreen", () => {
  const globalScope = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const originalActEnvironment = globalScope.IS_REACT_ACT_ENVIRONMENT;
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );

  beforeAll(() => {
    globalScope.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    if (originalActEnvironment === undefined) {
      delete globalScope.IS_REACT_ACT_ENVIRONMENT;
      return;
    }

    globalScope.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  });

  beforeEach(() => {
    vi.useFakeTimers();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(async () => {
    // Unmount before flushing timers so preview/debounce effects cannot
    // re-schedule work and hang `runOnlyPendingTimersAsync` under suite load.
    cleanup();
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoViewDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    if (originalResizeObserver) {
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    } else {
      vi.unstubAllGlobals();
    }
    // Tests that read the compact studio layout stub this; the default is the
    // desktop split view.
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("opens the one mounted proof disclosure from Review 1 line at desktop width", async () => {
    // Both studio layouts used to mount at once, so `id="resume-proof-details"`
    // existed twice and `getElementById` always returned the CSS-hidden
    // compact copy: at >= 1280px the button opened, scrolled and focused a
    // `display:none` subtree and nothing on screen changed.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      })),
    });

    renderScreen({ workspace: buildWorkspaceWithUnsupportedClaim() });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    // Reaching the blocked claim goes through the attention chip, which sets
    // the compact Tools tab. Pre-fix that mounted the compact copy of the
    // proof disclosure beside the desktop one, ahead of it in document order.
    const attentionChip = screen.getByRole("button", {
      name: /item(s)? need(s)? attention/,
    });
    await act(async () => {
      fireEvent.click(attentionChip);
      await vi.runOnlyPendingTimersAsync();
    });

    const proofNodes = document.querySelectorAll("#resume-proof-details");
    expect(proofNodes).toHaveLength(1);
    const proof = proofNodes[0] as HTMLDetailsElement;
    expect(proof.open).toBe(false);
    expect(proof.closest("[data-resume-studio-desktop-grid]")).not.toBeNull();
    expect(proof.closest(".xl\\:hidden")).toBeNull();

    const review = screen.getByRole("button", {
      name: "Review 1 line",
    });
    await act(async () => {
      fireEvent.click(review);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(proof.open).toBe(true);
    expect(document.activeElement).toBe(proof.querySelector("summary"));
  });

  it("offers a one-click restore of the text a blocked claim replaced", async () => {
    const onApplyPatch = vi.fn();
    const workspace = buildWorkspaceWithBlockedSummaryClaim();

    renderScreen({ onApplyPatch, workspace });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const restore = screen.getByRole("button", {
      name: /^Restore previous text:/,
    });
    await act(async () => {
      fireEvent.click(restore);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(onApplyPatch).toHaveBeenCalledTimes(1);
    expect(onApplyPatch.mock.calls[0]?.[0]).toMatchObject({
      operation: "replace_section_text",
      origin: "user",
      newText: "Previous grounded summary text.",
    });
    expect(onApplyPatch.mock.calls[0]?.[1]).toBe(
      "Restored the previous text for a blocked claim.",
    );
  });

  it("names the flagged sentence on the blocking claim", async () => {
    const workspace = buildWorkspaceWithBlockedSummaryClaim();

    const { container } = renderScreen({ workspace });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const flagged = container.querySelector(
      "[data-resume-validation-flagged-text]",
    );
    expect(flagged?.textContent).toContain("Flagged sentence:");
  });

  it("shows an honest loading state while the resume workspace is fetched", () => {
    renderScreen({ workspace: null });

    expect(
      screen.getByRole("heading", { name: "Loading Resume Studio" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Loading the saved draft, validation, and version history.",
      ),
    ).toBeTruthy();
  });

  it("consolidates header status and date metadata while retaining lifecycle actions", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getAllByText(/Updated /).length).toBe(1);
    expect(screen.queryByText(/^Template: /)).toBeNull();
    expect(screen.queryByText("Preview-led review")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /save draft/i }).length,
    ).toBeGreaterThan(0);
    // Exactly one AI control lives on this screen, in the Assistant. The
    // duplicate "Refresh draft" verb and the unlabelled circular refresh in
    // the header are both gone.
    expect(
      screen.queryAllByRole("button", { name: /refresh draft/i }),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole("button", {
        name: /Continue to Shortlisted|Approve resume|Download PDF|Choose an apply-safe template/i,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByRole("button", { name: /refresh this resume/i }),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: /back to shortlisted/i }).length,
    ).toBeGreaterThan(0);
  });
  it("makes the resume-to-application handoff explicit", () => {
    renderScreen();

    // The pinned banner stack collapsed into one compact sticky row; the
    // next-step sentence is that row's only prose.
    expect(
      document.querySelector("[data-resume-studio-compact-header]")
        ?.textContent,
    ).toContain("Resume approved.");
    // The approved fixture resolves the background-work promise into a
    // finished, inspectable fact instead of leaving present-tense copy up.
    expect(
      document.querySelector("[data-resume-pdf-status]")?.textContent,
    ).toBe("Application PDF ready · 1 page. Download a copy if you want one.");
    expect(
      screen.getAllByRole("button", {
        name: /Apply|Approve resume|Download PDF/,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("shows preview fallback while keeping editing available when preview rendering fails", async () => {
    const onPreviewDraft = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'job-finder:preview-resume-draft': Error: Preview rendering failed in desktop test mode.",
        ),
      );

    renderScreen({ onPreviewDraft });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getAllByText("Preview unavailable").length).toBeGreaterThan(
      0,
    );

    expect(
      screen.getAllByText("Preview rendering failed in desktop test mode.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Section text").length).toBeGreaterThan(0);
  });

  it("debounces unsaved preview refreshes and ignores stale preview responses", async () => {
    const previewResolvers: Array<(preview: JobFinderResumePreview) => void> =
      [];
    const onPreviewDraft = vi.fn().mockImplementation(
      () =>
        new Promise<JobFinderResumePreview>((resolve) => {
          previewResolvers.push(resolve);
        }),
    );

    renderScreen({ onPreviewDraft });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(99);
    });
    expect(onPreviewDraft).toHaveBeenCalledTimes(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onPreviewDraft).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getAllByLabelText("Section text")[0]!, {
      target: { value: "Updated unsaved summary for preview coverage." },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(onPreviewDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onPreviewDraft).toHaveBeenCalledTimes(2);

    await act(async () => {
      previewResolvers[1]?.(buildPreview("preview_fresh", "fresh-preview"));
      await Promise.resolve();
    });

    const freshPreviewFrame = screen.getAllByTitle(
      "Live resume preview",
    )[0] as HTMLIFrameElement;
    expect(
      freshPreviewFrame.getAttribute("srcdoc") ?? freshPreviewFrame.srcdoc,
    ).toContain("fresh-preview");

    await act(async () => {
      previewResolvers[0]?.(buildPreview("preview_stale", "stale-preview"));
      await Promise.resolve();
    });

    const staleCheckFrame = screen.getAllByTitle(
      "Live resume preview",
    )[0] as HTMLIFrameElement;
    const renderedHtml =
      staleCheckFrame.getAttribute("srcdoc") ?? staleCheckFrame.srcdoc;

    expect(renderedHtml).toContain("fresh-preview");
    expect(renderedHtml).not.toContain("stale-preview");
    expect(
      screen.getAllByText("Unsaved edits rendered").length,
    ).toBeGreaterThan(0);
  });

  it("shows grounded template recommendations for the current draft", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getAllByText("Template").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Engineering Spec · Skills First").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", {
        name: /template: Engineering Spec · Skills First$/,
      }).length,
    ).toBeGreaterThan(0);
  });

  it("sets a pending guided edits proposal aside when the resume is approved and says so", async () => {
    const { workspace, message } = buildPendingProposalWorkspaceAndMessage();
    // Approval must actually be reachable: clear the existing approval and
    // resolve the one hidden-role decision that otherwise blocks it.
    const approvableWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      draft: {
        ...workspace.draft,
        approvedAt: null,
        approvedExportId: null,
        workHistoryReviewAcknowledgments: [
          {
            id: "work_history_ack_demo_hidden_1",
            draftId: workspace.draft.id,
            profileRecordId: "experience_demo_hidden",
            kind: "weak_fit",
            action: "consider_showing",
            messageContentHash: "fnv1a32:465fc3f2",
            reason: "intentional_omission",
            acknowledgedAt: "2026-04-27T00:00:00.000Z",
          } satisfies WorkHistoryReviewAcknowledgment,
        ],
      },
    });
    const onResolveAssistantProposal = vi.fn();
    renderScreen({
      assistantMessages: [message],
      onResolveAssistantProposal,
      onSaveDraftAndThen: (_draft, next) => {
        void next();
      },
      workspace: approvableWorkspace,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    fireEvent.click(screen.getByRole("button", { name: /^Approve resume/ }));

    // Approval freezes one exact artifact, so an unresolved proposal cannot
    // survive it silently: it is rejected (no patch applied) and reported.
    expect(onResolveAssistantProposal).toHaveBeenCalledWith(
      "job_ready",
      "proposal_1",
      "reject",
      [],
    );
    expect(
      screen.getByText(
        "1 pending suggestion was set aside because you approved the resume. It is still in the Assistant thread.",
      ),
    ).toBeTruthy();
  });

  it("keeps preview-selected identity fields focused instead of jumping to summary", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const linkedinInput = screen.getAllByLabelText(
      "LinkedIn URL",
    )[0] as HTMLInputElement;
    linkedinInput.focus();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(linkedinInput);
    expect(linkedinInput.dataset.resumeEditorTarget).toBe(
      getResumeIdentityTargetId("linkedinUrl"),
    );
    expect(screen.getAllByLabelText("Section text")[0]).not.toBe(
      document.activeElement,
    );
  });

  it("saves unsaved edits before restoring an earlier draft", async () => {
    const onRestoreRevision = vi.fn();
    const onSaveDraftAndThen = vi.fn();

    renderScreen({
      onRestoreRevision,
      onSaveDraftAndThen,
      workspace: buildWorkspaceWithRevision(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const summaryInput = screen.getAllByLabelText(
      "Section text",
    )[0] as HTMLTextAreaElement;
    fireEvent.change(summaryInput, {
      target: { value: "Unsaved summary that must be saved before restore." },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Restore version saved/i }),
    );

    expect(onSaveDraftAndThen).toHaveBeenCalledTimes(1);
    expect(onRestoreRevision).not.toHaveBeenCalled();

    const followUp = onSaveDraftAndThen.mock.calls[0]?.[1] as
      | (() => void | Promise<void>)
      | undefined;
    expect(followUp).toBeTypeOf("function");
    await followUp?.();

    expect(onRestoreRevision).toHaveBeenCalledWith(
      "job_ready",
      "revision_restore_1",
    );
    expect(onSaveDraftAndThen.mock.calls[0]?.[2]).toBe(
      "Saved your current edits before restoring the earlier draft.",
    );
  });
  it("credits an accepted AI edit instead of denying the AI helped", async () => {
    const workspace = buildWorkspace();
    const section = workspace.draft.sections.find((entry) => entry.text);
    if (!section) {
      throw new Error("Expected a section with text in the fixture.");
    }
    const onRestoreRevision = vi.fn();
    const onUndoAiEdit = vi.fn();
    const acceptedWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      revisions: [
        ResumeDraftRevisionSchema.parse({
          id: "revision_assistant_1",
          draftId: workspace.draft.id,
          parentRevisionId: null,
          actor: "assistant",
          mutationKind: "assistant_patch",
          snapshotDraft: workspace.draft,
          snapshotIdentity: workspace.draft.identity,
          snapshotSections: workspace.draft.sections,
          beforeHash: "before_assistant_1",
          afterHash: "after_assistant_1",
          diff: null,
          restoredFromRevisionId: null,
          createdAt: "2026-04-27T01:00:00.000Z",
          reason: "Applied an assistant proposal",
        }),
      ],
    });

    renderScreen({
      onRestoreRevision,
      onUndoAiEdit,
      workspace: acceptedWorkspace,
      assistantMessages: [
        buildAssistantMessage({
          proposalStatus: "accepted",
          resolvedPatchIds: ["assistant_patch_1"],
          patches: [
            {
              id: "assistant_patch_1",
              origin: "assistant",
              operation: "replace_section_text",
              targetSectionId: section.id,
              targetEntryId: null,
              targetBulletId: null,
              anchorEntryId: null,
              anchorBulletId: null,
              position: null,
              newText: "A tighter, grounded summary.",
              newBullets: null,
              newIncluded: null,
              newLocked: null,
              conflictReason: null,
            } as ResumeDraftPatch,
          ],
        }),
      ],
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // The one place a user checks "did the AI actually help me" must agree
    // with the preview beside it.
    const notice = document.querySelector("[data-resume-applied-ai-edits]");
    expect(notice?.textContent).toContain("1 AI edit applied");

    // Accepting a proposal is undoable from the page it changed, not only
    // from version history. Undo removes only that AI edit; it does not
    // restore the whole pre-edit draft over later manual edits.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndoAiEdit).toHaveBeenCalledWith(
      "job_ready",
      "revision_assistant_1",
    );
    expect(onRestoreRevision).not.toHaveBeenCalled();
  });

  it("keeps only the focused section open and still lands on its exact field", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const expandedSections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-resume-editor-section]"),
    ).filter(
      (section) => section.dataset.resumeEditorSectionExpanded === "true",
    );
    // A one-page resume must be reviewable inside one screen of tools, not a
    // ten-viewport ladder of always-open field editors.
    expect(expandedSections).toHaveLength(1);

    // Opening another section by its title collapses the previous one and
    // still reaches that section's own fields.
    openEditorSection("section_experience");

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-resume-editor-section]"),
      ).filter(
        (section) => section.dataset.resumeEditorSectionExpanded === "true",
      ),
    ).toHaveLength(1);
    expect(screen.getAllByLabelText("Title").length).toBeGreaterThan(0);
  });

  it("keeps exactly one AI control on the studio", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Per-section "Rewrite", "Retry with AI", and "Refresh draft" were three
    // entry points with unstated blast radius; every AI action now belongs to
    // the single Assistant.
    expect(screen.queryAllByRole("button", { name: /rewrite/i })).toHaveLength(
      0,
    );
    expect(
      screen.queryAllByRole("button", { name: /retry with ai/i }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: /refresh draft/i }),
    ).toHaveLength(0);
    // The studio has no assistant of its own; the app-wide sidebar is the
    // one assistant (ADR 0037).
    expect(
      screen.queryAllByRole("button", { name: /^Open the Assistant/ }),
    ).toHaveLength(0);
  });

  it("shows work-history review guidance in the editor", async () => {
    renderScreen({
      onPreviewDraft: () =>
        Promise.resolve(
          buildPreview(
            "preview_guidance",
            "<main><p>Sales Operations Associate</p></main>",
          ),
        ),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    openEditorSection("section_experience");

    expect(screen.getAllByText("Work-history review").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(
        "Hidden by default for review: this role has a weaker career-family fit for the target job.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("exposes manual entry ordering controls and sends typed reorder patches", async () => {
    const appliedPatches: Array<{
      patch: ResumeDraftPatch;
      revisionReason?: string | null;
    }> = [];
    const onApplyPatch = vi.fn(
      (patch: ResumeDraftPatch, revisionReason?: string | null) => {
        appliedPatches.push({
          patch,
          ...(revisionReason === undefined ? {} : { revisionReason }),
        });
      },
    );

    renderScreen({ onApplyPatch });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    openEditorSection("section_experience");

    // Chronology is the default order, so it earns no header chip; only the
    // non-default "Manual order" state is announced.
    expect(screen.queryAllByText("Chronology")).toHaveLength(0);

    const moveUpButtons = screen.getAllByRole("button", {
      name: /^Move .+ up$/,
    });
    const moveDownButtons = screen.getAllByRole("button", {
      name: /^Move .+ down$/,
    });

    expect(moveUpButtons.length).toBeGreaterThanOrEqual(2);
    expect(moveUpButtons[0]).toHaveProperty("disabled", true);
    expect(moveDownButtons.at(-1)).toHaveProperty("disabled", true);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Move Senior systems designer up",
        }),
      );
      await Promise.resolve();
    });

    expect(onApplyPatch).toHaveBeenCalledTimes(1);
    expect(appliedPatches[0]?.patch).toMatchObject({
      anchorEntryId: "experience_demo_previous",
      operation: "move_entry",
      position: "before",
      targetEntryId: "entry_signal_systems",
      targetSectionId: "section_experience",
    });
    expect(appliedPatches[0]?.revisionReason).toBe("Moved entry up");
  });

  it("marks manual order and exposes reset-to-chronology for manually ordered sections", async () => {
    const workspace = buildWorkspace();
    const experienceSection = workspace.draft.sections.find(
      (section) => section.kind === "experience",
    );

    if (!experienceSection) {
      throw new Error(
        "Expected demo workspace to contain an experience section.",
      );
    }

    const manualWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      draft: {
        ...workspace.draft,
        sections: workspace.draft.sections.map((section) =>
          section.kind === "experience"
            ? {
                ...section,
                entryOrderMode: "manual",
                entries: [
                  {
                    ...experienceSection.entries[1]!,
                    dateRange: "2021 – 2022",
                    startDate: "2021",
                    endDate: "2022",
                    isCurrent: false,
                    sortOrder: 0,
                  },
                  {
                    ...experienceSection.entries[0]!,
                    dateRange: "2024 – Present",
                    startDate: "2024",
                    endDate: null,
                    isCurrent: true,
                    sortOrder: 1,
                  },
                ],
              }
            : section,
        ),
      },
    });
    const appliedPatches: Array<{
      patch: ResumeDraftPatch;
      revisionReason?: string | null;
    }> = [];
    const onApplyPatch = vi.fn(
      (patch: ResumeDraftPatch, revisionReason?: string | null) => {
        appliedPatches.push({
          patch,
          ...(revisionReason === undefined ? {} : { revisionReason }),
        });
      },
    );

    render(
      <ResumeWorkspaceScreen
        actionMessage={null}
        assistantMessages={[]}
        assistantPending={false}
        availableResumeTemplates={availableResumeTemplates}
        isWorkspacePending={false}
        jobId="job_ready"
        onApplyPatch={onApplyPatch}
        onApproveCurrentResume={vi.fn()}
        onApproveResume={vi.fn()}
        onBack={vi.fn()}
        onClearResumeApproval={vi.fn()}
        onDirtyChange={vi.fn()}
        onExportPdf={vi.fn()}
        onPreviewDraft={() =>
          Promise.resolve(buildPreview("preview_ready", "ready-preview"))
        }
        onRefresh={vi.fn()}
        onRegenerateDraft={vi.fn()}
        onRestoreRevision={vi.fn()}
        onUndoAiEdit={vi.fn()}
        onSaveDraft={vi.fn()}
        onSaveDraftAndThen={vi.fn()}
        onSendAssistantMessage={vi.fn()}
        onSetWorkHistoryReviewAcknowledgment={vi.fn()}
        workspace={manualWorkspace}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    openEditorSection("section_experience");

    expect(screen.getAllByText("Manual order").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Reset to chronology/i }),
      );
      await Promise.resolve();
    });

    expect(onApplyPatch).toHaveBeenCalledTimes(1);
    expect(appliedPatches[0]?.patch).toMatchObject({
      operation: "reset_entry_order",
      targetEntryId: null,
      targetSectionId: "section_experience",
    });
    expect(appliedPatches[0]?.revisionReason).toBe(
      "Reset entry order to chronology",
    );
    // Resetting returns the section to the default chronology order, which
    // clears the "Manual order" chip instead of swapping in a default one.
    expect(screen.queryAllByText("Manual order")).toHaveLength(0);
    expect(screen.queryAllByText("Chronology")).toHaveLength(0);

    const entryTitleInputs: HTMLElement[] = screen.getAllByLabelText("Title");
    const currentRoleIndex = entryTitleInputs.findIndex(
      (input) =>
        input instanceof HTMLInputElement &&
        input.value === experienceSection.entries[0]!.title,
    );
    const olderRoleIndex = entryTitleInputs.findIndex(
      (input) =>
        input instanceof HTMLInputElement &&
        input.value === experienceSection.entries[1]!.title,
    );

    expect(currentRoleIndex).toBeGreaterThanOrEqual(0);
    expect(olderRoleIndex).toBeGreaterThanOrEqual(0);
    expect(currentRoleIndex).toBeLessThan(olderRoleIndex);
  });

  const hiddenRoleMessage =
    "Hidden by default for review: this role has a weaker career-family fit for the target job.";

  it("lists omitted-entry decisions near the top of the structured editor with exact guidance", async () => {
    renderScreen();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const scrollRegion = document.querySelector(
      "[data-resume-editor-scroll-region]",
    );
    expect(scrollRegion?.textContent).toContain("Work-history decisions");
    expect(scrollRegion?.textContent).toContain(hiddenRoleMessage);
    const decisionContext = document.querySelector(
      "[data-resume-work-history-decisions]",
    );
    expect(decisionContext?.textContent).toContain(
      "Sales Operations Associate",
    );
    expect(decisionContext?.textContent).toMatch(/Bright Market.*2019.*2020/);
    expect(screen.getAllByText("Hidden").length).toBeGreaterThan(0);

    const decisionsSection = document.querySelector(
      "[data-resume-work-history-decisions]",
    );
    const identityHeading = Array.from(
      scrollRegion?.querySelectorAll("h3") ?? [],
    ).find((heading) => heading.textContent === "Resume identity");

    if (!decisionsSection || !identityHeading) {
      throw new Error("Expected structured editor sections to render.");
    }

    expect(
      decisionsSection.compareDocumentPosition(identityHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const keepButtons = screen.getAllByRole("button", {
      name: `Leave this role off · Weak fit: ${hiddenRoleMessage}`,
    });
    expect(keepButtons.length).toBeGreaterThan(0);
    for (const button of keepButtons) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("sends the exact typed acknowledgment command with server suggestion fields", async () => {
    const onSetWorkHistoryReviewAcknowledgment = vi.fn();
    renderScreen({ onSetWorkHistoryReviewAcknowledgment });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    fireEvent.click(
      screen.getAllByRole("button", {
        name: `Leave this role off · Weak fit: ${hiddenRoleMessage}`,
      })[0]!,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSetWorkHistoryReviewAcknowledgment).toHaveBeenCalledOnce();
    expect(onSetWorkHistoryReviewAcknowledgment).toHaveBeenCalledWith(
      "job_ready",
      {
        intent: "acknowledge",
        suggestion: {
          id: "work_history_review_demo_hidden",
          profileRecordId: "experience_demo_hidden",
          kind: "weak_fit",
          action: "consider_showing",
          messageContentHash: "fnv1a32:465fc3f2",
        },
      },
    );
  });

  it("shows acknowledged omissions as kept and sends the removal command by acknowledgment id", async () => {
    const workspace = buildWorkspace();
    const acknowledgedWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      draft: {
        ...workspace.draft,
        workHistoryReviewAcknowledgments: [
          {
            id: "work_history_ack_demo_hidden_1",
            draftId: workspace.draft.id,
            profileRecordId: "experience_demo_hidden",
            kind: "weak_fit",
            action: "consider_showing",
            messageContentHash: "fnv1a32:465fc3f2",
            reason: "intentional_omission",
            acknowledgedAt: "2026-04-27T00:00:00.000Z",
          } satisfies WorkHistoryReviewAcknowledgment,
        ],
      },
    });
    const onSetWorkHistoryReviewAcknowledgment = vi.fn();

    renderScreen({
      onSetWorkHistoryReviewAcknowledgment,
      workspace: acknowledgedWorkspace,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getAllByText("Left off").length).toBeGreaterThan(0);

    const undoButtons = screen.getAllByRole("button", {
      name: `Undo leave-off · Weak fit: ${hiddenRoleMessage}`,
    });
    expect(undoButtons.length).toBeGreaterThan(0);
    expect(undoButtons[0]!.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(undoButtons[0]!);
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSetWorkHistoryReviewAcknowledgment).toHaveBeenCalledOnce();
    expect(onSetWorkHistoryReviewAcknowledgment).toHaveBeenCalledWith(
      "job_ready",
      {
        intent: "remove",
        acknowledgmentId: "work_history_ack_demo_hidden_1",
      },
    );
  });

  it("keeps stale acknowledgments unresolved when the projected hash no longer matches", async () => {
    const workspace = buildWorkspace();
    const staleAckWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      draft: {
        ...workspace.draft,
        workHistoryReviewAcknowledgments: [
          {
            id: "work_history_ack_stale_hash",
            draftId: workspace.draft.id,
            profileRecordId: "experience_demo_hidden",
            kind: "weak_fit",
            action: "consider_showing",
            messageContentHash: "fnv1a32:00000000",
            reason: "intentional_omission",
            acknowledgedAt: "2026-04-27T00:00:00.000Z",
          } satisfies WorkHistoryReviewAcknowledgment,
        ],
      },
    });

    renderScreen({ workspace: staleAckWorkspace });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getAllByText("Hidden").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/nothing here blocks approval/).length,
    ).toBeGreaterThan(0);
  });

  it("disables decision buttons while workspace work is pending", async () => {
    const workspace = buildWorkspace();
    const onSetWorkHistoryReviewAcknowledgment = vi.fn();

    render(
      <ResumeWorkspaceScreen
        actionMessage={null}
        assistantMessages={[]}
        assistantPending={false}
        availableResumeTemplates={availableResumeTemplates}
        isWorkspacePending
        jobId="job_ready"
        onApplyPatch={vi.fn()}
        onApproveCurrentResume={vi.fn()}
        onApproveResume={vi.fn()}
        onBack={vi.fn()}
        onClearResumeApproval={vi.fn()}
        onDirtyChange={vi.fn()}
        onExportPdf={vi.fn()}
        onPreviewDraft={() =>
          Promise.resolve(buildPreview("preview_ready", "ready-preview"))
        }
        onRefresh={vi.fn()}
        onRegenerateDraft={vi.fn()}
        onRestoreRevision={vi.fn()}
        onUndoAiEdit={vi.fn()}
        onSaveDraft={vi.fn()}
        onSaveDraftAndThen={vi.fn()}
        onSendAssistantMessage={vi.fn()}
        onSetWorkHistoryReviewAcknowledgment={
          onSetWorkHistoryReviewAcknowledgment
        }
        workspace={workspace}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const keepButtons = screen.getAllByRole("button", {
      name: `Leave this role off · Weak fit: ${hiddenRoleMessage}`,
    });
    expect(keepButtons.length).toBeGreaterThan(0);
    for (const button of keepButtons) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(button.hasAttribute("data-pending")).toBe(true);
    }

    fireEvent.click(keepButtons[0]!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSetWorkHistoryReviewAcknowledgment).not.toHaveBeenCalled();
  });

  it("never blocks approval on hidden roles and offers to add each back", async () => {
    const workspace = buildWorkspace();
    const unapprovedWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      draft: {
        ...workspace.draft,
        approvedAt: null,
        approvedExportId: null,
      },
    });

    renderScreen({ workspace: unapprovedWorkspace });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // A hidden role is the person's choice, not a blocker.
    expect(screen.queryByText(/before you can approve/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review hidden roles" }),
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /^Add this role back/ }).length,
    ).toBeGreaterThan(0);
  });

  it("does not block approval or show the decisions list for compact-only suggestions", async () => {
    const workspace = buildWorkspace();
    const compactOnlyWorkspace = JobFinderResumeWorkspaceSchema.parse({
      ...workspace,
      workHistoryReviewSuggestions: [
        {
          id: "work_history_review_compact_only",
          profileRecordId: "experience_demo_previous",
          sectionId: null,
          entryId: null,
          kind: "compact_recommended",
          action: "keep_compact",
          severity: "info",
          message:
            "This resume is compact enough to keep every included entry as-is.",
          messageContentHash: "fnv1a32:32a7b731",
        },
      ],
    });

    renderScreen({ workspace: compactOnlyWorkspace });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.queryByText("Work-history decisions")).toBeNull();
    expect(screen.queryByText(/You can still export a PDF/)).toBeNull();
  });

  it("saves unsaved edits before recording a leave-off decision", () => {
    const onSaveDraftAndThen = vi.fn();
    renderScreen({ onSaveDraftAndThen });

    fireEvent.change(screen.getAllByLabelText("Section text")[0]!, {
      target: { value: "Dirty summary before a work-history decision." },
    });

    fireEvent.click(
      screen.getAllByRole("button", {
        name: `Leave this role off · Weak fit: ${hiddenRoleMessage}`,
      })[0]!,
    );

    expect(onSaveDraftAndThen).toHaveBeenCalledTimes(1);
    expect(onSaveDraftAndThen.mock.calls[0]?.[2]).toBe(
      "Saved your draft before recording this decision.",
    );
  });

  describe("draft-edit revision signals", () => {
    // These cases mount the full studio and exercise several mutation paths;
    // keep headroom above the default 5s when the full desktop suite is busy.
    it("signals each user-authored mutation path: section, identity, reorder patch, and template", async () => {
      const onApplyPatch = vi.fn();
      const onDraftEdited = vi.fn();

      renderScreen({ onApplyPatch, onDraftEdited });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(onDraftEdited).not.toHaveBeenCalled();

      openEditorSection("section_experience");

      // A user-directed reorder patch both mutates local order and dispatches
      // its saved patch request; run it before local edits would require the
      // separate save-before-action continuation.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: "Move Senior systems designer up",
          }),
        );
        await Promise.resolve();
      });
      expect(onApplyPatch).toHaveBeenCalledTimes(1);
      expect(onDraftEdited).toHaveBeenCalledTimes(1);

      // Section editor keystrokes revise the local draft.
      openEditorSection("section_summary");
      fireEvent.change(screen.getAllByLabelText("Section text")[0]!, {
        target: { value: "Locally edited summary." },
      });
      expect(onDraftEdited).toHaveBeenCalledTimes(2);

      // Identity header edits go through the same draft-change contract.
      fireEvent.change(screen.getAllByLabelText("Full name")[0]!, {
        target: { value: "Renamed Candidate" },
      });
      expect(onDraftEdited).toHaveBeenCalledTimes(3);

      // Switching templates revises the draft's presentation settings.
      fireEvent.click(
        screen.getAllByRole("button", { name: "Change template" })[0]!,
      );
      fireEvent.click(
        screen
          .getAllByRole("button", { name: /^Use template: Engineering Spec/ })
          .at(-1)!,
      );
      expect(onDraftEdited).toHaveBeenCalledTimes(4);
    }, 15_000);

    it("keeps unsaved edits when the saved draft changes in the background and offers the saved version", async () => {
      const { workspace, message } = buildPendingProposalWorkspaceAndMessage();
      const buildElement = (currentWorkspace: JobFinderResumeWorkspace) => (
        <ResumeWorkspaceScreen
          actionMessage={null}
          assistantMessages={[message]}
          assistantPending={false}
          availableResumeTemplates={availableResumeTemplates}
          isWorkspacePending={false}
          jobId="job_ready"
          onApplyPatch={vi.fn()}
          onApproveCurrentResume={vi.fn()}
          onApproveResume={vi.fn()}
          onBack={vi.fn()}
          onClearResumeApproval={vi.fn()}
          onDirtyChange={vi.fn()}
          onExportPdf={vi.fn()}
          onPreviewDraft={() =>
            Promise.resolve(buildPreview("preview_ready", "ready-preview"))
          }
          onRefresh={vi.fn()}
          onRegenerateDraft={vi.fn()}
          onRestoreRevision={vi.fn()}
          onUndoAiEdit={vi.fn()}
          onSaveDraft={vi.fn()}
          onSaveDraftAndThen={vi.fn()}
          onSendAssistantMessage={vi.fn()}
          onSetWorkHistoryReviewAcknowledgment={vi.fn()}
          workspace={currentWorkspace}
        />
      );
      const view = render(buildElement(workspace));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const textarea = () =>
        screen.getAllByLabelText("Section text")[0] as HTMLTextAreaElement;
      fireEvent.change(textarea(), {
        target: { value: "My own unsaved wording." },
      });
      const refreshedWorkspace = JobFinderResumeWorkspaceSchema.parse({
        ...workspace,
        draft: {
          ...workspace.draft,
          updatedAt: "2026-04-27T00:07:00.000Z",
          sections: workspace.draft.sections.map((section) =>
            section.text
              ? { ...section, text: "Assistant saved wording." }
              : section,
          ),
        },
      });
      await act(async () => {
        view.rerender(buildElement(refreshedWorkspace));
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(textarea().value).toBe("My own unsaved wording.");
      expect(
        document.querySelector("[data-resume-background-change]"),
      ).not.toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Load the saved version" }),
      );
      expect(textarea().value).toBe("Assistant saved wording.");
      expect(
        document.querySelector("[data-resume-background-change]"),
      ).toBeNull();
    }, 15_000);

    it("stays silent while canonical revisions refresh", async () => {
      const onDraftEdited = vi.fn();
      const onResolveAssistantProposal = vi.fn();
      const { workspace, message } = buildPendingProposalWorkspaceAndMessage();

      const buildElement = (currentWorkspace: JobFinderResumeWorkspace) => (
        <ResumeWorkspaceScreen
          actionMessage={null}
          assistantMessages={[message]}
          assistantPending={false}
          availableResumeTemplates={availableResumeTemplates}
          isWorkspacePending={false}
          jobId="job_ready"
          onApplyPatch={vi.fn()}
          onApproveCurrentResume={vi.fn()}
          onApproveResume={vi.fn()}
          onBack={vi.fn()}
          onClearResumeApproval={vi.fn()}
          onDirtyChange={vi.fn()}
          onDraftEdited={onDraftEdited}
          onExportPdf={vi.fn()}
          onPreviewDraft={() =>
            Promise.resolve(buildPreview("preview_ready", "ready-preview"))
          }
          onRefresh={vi.fn()}
          onRegenerateDraft={vi.fn()}
          onResolveAssistantProposal={onResolveAssistantProposal}
          onRestoreRevision={vi.fn()}
          onUndoAiEdit={vi.fn()}
          onSaveDraft={vi.fn()}
          onSaveDraftAndThen={vi.fn()}
          onSendAssistantMessage={vi.fn()}
          onSetWorkHistoryReviewAcknowledgment={vi.fn()}
          workspace={currentWorkspace}
        />
      );

      const view = render(buildElement(workspace));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Mount-time canonical hydration and preview refreshes never signal.
      expect(onDraftEdited).not.toHaveBeenCalled();

      // A later canonical revision re-clones the saved draft silently even
      // though the whole draft payload changed underneath the screen.
      const refreshedWorkspace = JobFinderResumeWorkspaceSchema.parse({
        ...workspace,
        draft: {
          ...workspace.draft,
          updatedAt: "2026-04-27T00:06:00.000Z",
          sections: workspace.draft.sections.map((section) =>
            section.text
              ? { ...section, text: "Canonical refresh text." }
              : section,
          ),
        },
      });

      await act(async () => {
        view.rerender(buildElement(refreshedWorkspace));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(
        (screen.getAllByLabelText("Section text")[0] as HTMLTextAreaElement)
          .value,
      ).toBe("Canonical refresh text.");
      expect(onDraftEdited).not.toHaveBeenCalled();
    }, 15_000);

    it("propagates draft edits to the save coordinator so an edit after a failed save retires Retry with guidance", async () => {
      const states: JobFinderSaveState[] = [];
      const coordinator = createJobFinderSaveCoordinator({
        onStateChange: (state) => states.push(state),
      });

      renderScreen({
        onDraftEdited: () => coordinator.markSurfaceRevised("resume"),
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // First genuine edit: the studio becomes dirty and the revision epoch
      // advances BEFORE the failing save below captures its retry request.
      fireEvent.change(screen.getAllByLabelText("Section text")[0]!, {
        target: { value: "Dirty before the failed save." },
      });

      await act(async () => {
        const outcome = await coordinator.run({
          dedupeKey: "resume:integration-failure",
          execute: () => Promise.reject(new Error("save unavailable")),
          failedMessage: () => "Resume draft was not saved.",
          label: "Resume draft",
          savedMessage: "Changes saved.",
          surface: "resume",
        });
        expect(outcome.status).toBe("failed");
      });

      // No edit happened after the failure, so the exact-request retry stays.
      const failedState = states.at(-1);
      if (!failedState || failedState.state !== "failed") {
        throw new Error("Expected the failed save state.");
      }
      expect(failedState.canRetry).toBe(true);
      expect(failedState.retryBlockedReason).toBeUndefined();

      // A further user edit while already dirty retires the pre-edit retry:
      // Retry disappears and the stale-retry guidance takes its place.
      fireEvent.change(screen.getAllByLabelText("Section text")[0]!, {
        target: { value: "Edited again after the failed save." },
      });

      const retiredState = states.at(-1);
      if (!retiredState || retiredState.state !== "failed") {
        throw new Error("Expected the failed state to persist.");
      }
      expect(retiredState.canRetry).toBe(false);
      expect(retiredState.retryBlockedReason).toBe(
        JOB_FINDER_STALE_RETRY_GUIDANCE,
      );

      // Defense in depth at the seam: retry refuses instead of resubmitting.
      let retryOutcome: unknown = "unset";
      await act(async () => {
        retryOutcome = await coordinator.retry();
      });
      expect(retryOutcome).toBeNull();
    });
  });
  describe("studio layout", () => {
    it("keeps the workspace title compact with its job meta on the same line", async () => {
      renderScreen();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      const title = screen.getByRole("heading", {
        level: 1,
        name: "Senior Product Designer",
      });

      // The element defaults in `globals.css` live in `@layer base`, so these
      // utilities apply without an important modifier. A reintroduced `!`
      // would mean the cascade bug came back.
      expect(title.className).toContain(
        "text-(length:--text-page-title-compact)",
      );
      expect(title.className).toContain("leading-tight");
      expect(title.className).toContain(
        "tracking-(--tracking-page-title-compact)",
      );
      expect(title.className).not.toContain("!");
      expect(title.className).not.toContain("text-(length:--text-page-title) ");
      // Title and meta share one baseline row instead of stacking a large
      // page title above the studio.
      expect(title.parentElement?.className).toContain("items-baseline");
      expect(title.parentElement?.textContent).toContain("Updated");
    });

    // The studio pane container has to END at or above the window bottom at
    // scroll 0, which is the position the user arrives in. Subtracting only
    // the shell chrome and the bottom gutter left it exactly
    // `titleRow - gutter` past the fold — a measured 41px at both 1440x920 and
    // 1280x720 — so the route grew a scroll whose whole range existed to
    // reveal a pane's bottom border, and the last resume line was sliced by
    // the window edge instead of by the pane. Every band above the studio is
    // subtracted here, and the arithmetic below is the guard: it fails if any
    // one of them is dropped again.
    it.each([
      // viewport height, shell chrome above the route, workspace title row
      [920, 56, 53],
      [720, 116, 53],
      [640, 116, 72],
    ])(
      "ends the studio content area above the window bottom at scroll 0 in a %ipx window",
      async (viewportHeight, shellChrome, titleRow) => {
        const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          "getBoundingClientRect",
        );
        HTMLElement.prototype.getBoundingClientRect = function measured(
          this: HTMLElement,
        ) {
          const height = this.hasAttribute("data-locked-screen-top-content")
            ? titleRow
            : 0;
          const top = this.hasAttribute("data-locked-screen-scroll-area")
            ? shellChrome
            : 0;

          return {
            bottom: top + height,
            height,
            left: 0,
            right: 1440,
            top,
            width: 1440,
            x: 0,
            y: top,
            toJSON: () => ({}),
          } as DOMRect;
        };

        try {
          renderScreen();

          await act(async () => {
            await vi.advanceTimersByTimeAsync(100);
          });

          const contentArea = document.querySelector<HTMLElement>(
            "[data-resume-studio-content-area]",
          );

          // The bound applies at every supported width, not only from xl up:
          // below xl the studio is a tab surface whose transcript must scroll
          // inside the viewport rather than growing the route.
          expect(contentArea?.className).toContain(
            "h-(--resume-studio-height)",
          );
          expect(contentArea?.className).not.toContain(
            "xl:h-(--resume-studio-height)",
          );
          expect(contentArea?.className).toContain("overflow-hidden");

          const declaredHeight = contentArea?.style.getPropertyValue(
            "--resume-studio-height",
          );
          const subtracted = Number(
            /^calc\(100dvh - (\d+)px\)$/.exec(declaredHeight ?? "")?.[1],
          );

          expect(Number.isFinite(subtracted)).toBe(true);
          // Shell chrome + title row + the shell's own 12px bottom gutter.
          expect(subtracted).toBe(shellChrome + titleRow + 12);

          // At scroll 0 the container starts below both permanent bands, so
          // its bottom is the only thing this height controls.
          const containerTop = shellChrome + titleRow;
          const containerBottom = containerTop + (viewportHeight - subtracted);

          expect(containerBottom).toBeLessThanOrEqual(viewportHeight);
          // ...and it lands exactly on the shell's bottom gutter, so the fix
          // cannot be satisfied by an arbitrarily short studio either.
          expect(containerBottom).toBe(viewportHeight - 12);
        } finally {
          if (originalGetBoundingClientRect) {
            Object.defineProperty(
              HTMLElement.prototype,
              "getBoundingClientRect",
              originalGetBoundingClientRect,
            );
          }
        }
      },
    );

    // A grounded proposal is the tallest thing the Assistant thread can hold.
    // The studio's compact `Assistant` tab used to render a second, unbounded
    // copy of the thread, so one proposal grew the route past 38,000px and put
    // Accept/Reject ~37,000px below the fold. The Assistant is now one bounded
    // floating panel at every width. These four sizes are the ones the gate
    // captures.
  });
});
