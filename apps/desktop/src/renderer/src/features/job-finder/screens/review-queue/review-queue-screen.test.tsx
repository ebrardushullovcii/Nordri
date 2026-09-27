// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ApplicationRecordSchema } from "@unemployed/contracts";
import type {
  ApplicationAutomationMode,
  ApplicationRecord,
  BrowserSessionState,
  GlobalDailyApplicationPreparationCapacity,
  ResumeSourceDocument,
  ReviewQueueItem,
  SavedJob,
  TailoredAsset,
} from "@unemployed/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { JobFinderAutoApplyQueueStartOutcome } from "@renderer/features/job-finder/lib/job-finder-types";
import { ReviewQueueScreen } from "./review-queue-screen";
import type { TailoredDraftPreparationViewState } from "./review-queue-status";

beforeEach(() => {
  window.localStorage?.clear();

  class ResizeObserverMock {
    observe() {}

    disconnect() {}

    unobserve() {}
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function createIdleDraftPreparation(): TailoredDraftPreparationViewState {
  return {
    attemptedCount: 0,
    completedCount: 0,
    currentIndex: null,
    eligibleRemainingCount: 0,
    failedCount: 0,
    status: "idle",
    totalCount: 0,
  };
}

function createEligibleItem(jobId: string): ReviewQueueItem {
  return {
    jobId,
    title: `Role ${jobId}`,
    company: "Acme",
    location: "Remote",
    matchScore: 80,
    applicationStatus: "shortlisted",
    assetStatus: "not_started",
    progressPercent: null,
    resumeAssetId: null,
    resumeApplicationMode: "tailored_per_job",
    resumeReview: { status: "not_started" },
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

function createBrowserSession(): BrowserSessionState {
  return {
    source: "user",
    status: "unknown",
    driver: "catalog_seed",
    label: "Browser",
    detail: null,
    lastCheckedAt: "2026-08-20T00:00:00.000Z",
  } as unknown as BrowserSessionState;
}

function createOriginalResume(): ResumeSourceDocument {
  return {
    id: "resume_base",
    fileName: "base-resume.pdf",
    uploadedAt: "2026-08-20T00:00:00.000Z",
  } as unknown as ResumeSourceDocument;
}

function renderScreen(props: {
  applicationAutomationMode?: ApplicationAutomationMode;
  applicationRecords?: readonly ApplicationRecord[];
  dailyCapacity?: GlobalDailyApplicationPreparationCapacity;
  resumeOperationStarts?: Readonly<Record<string, number>>;
  browserSession?: BrowserSessionState;
  isJobPending?: (jobId: string) => boolean;
  campaignId?: string;
  draftPreparation?: TailoredDraftPreparationViewState;
  onGenerateResume?: (
    jobId: string,
    options?: { selectAfter?: boolean },
  ) => Promise<boolean>;
  onPrepareTailoredDrafts?: () => void;
  onStartAutoApplyQueue?: (
    jobIds: string[],
    applicationAutomationMode?: ApplicationAutomationMode,
  ) => Promise<JobFinderAutoApplyQueueStartOutcome>;
  onStopTailoredDraftPreparation?: () => void;
  onSelectItem?: (jobId: string) => void;
  queue: readonly ReviewQueueItem[];
  selectedItem?: ReviewQueueItem | null;
  selectedJob?: SavedJob | null;
  selectedAsset?: TailoredAsset | null;
}) {
  return render(
    <MemoryRouter>
      <ReviewQueueScreen
        applicationAutomationMode={
          props.applicationAutomationMode ?? "prepare_only"
        }
        resumeOperationStarts={props.resumeOperationStarts}
        applicationRecords={props.applicationRecords ?? []}
        actionState={{ message: null }}
        browserSession={props.browserSession ?? createBrowserSession()}
        campaignId={props.campaignId ?? "campaign_1"}
        draftPreparation={
          props.draftPreparation ?? createIdleDraftPreparation()
        }
        globalDailyApplicationPreparationCapacity={props.dailyCapacity ?? null}
        isApplyPending={false}
        isJobPending={props.isJobPending ?? (() => false)}
        onPrepareTailoredDrafts={props.onPrepareTailoredDrafts ?? vi.fn()}
        onStopTailoredDraftPreparation={
          props.onStopTailoredDraftPreparation ?? vi.fn()
        }
        onStartAutoApplyQueue={
          props.onStartAutoApplyQueue ??
          vi.fn<
            NonNullable<
              Parameters<typeof renderScreen>[0]["onStartAutoApplyQueue"]
            >
          >(() => Promise.resolve({ status: "confirmed" }))
        }
        onStartApplyCopilot={vi.fn()}
        onEditResumeWorkspace={vi.fn()}
        onGenerateResume={
          props.onGenerateResume ??
          vi.fn<
            (
              jobId: string,
              options?: { selectAfter?: boolean },
            ) => Promise<boolean>
          >(() => Promise.resolve(true))
        }
        onOpenBrowserSession={vi.fn()}
        onOpenJobDetails={vi.fn()}
        onOpenProfile={vi.fn()}
        onRemoveReviewJob={vi.fn()}
        onSetJobResumeApplicationMode={vi.fn()}
        onSelectItem={props.onSelectItem ?? vi.fn()}
        originalResume={createOriginalResume()}
        queue={props.queue}
        selectedAsset={props.selectedAsset ?? null}
        selectedItem={props.selectedItem ?? null}
        selectedJob={props.selectedJob ?? null}
      />
    </MemoryRouter>,
  );
}

describe("ReviewQueueScreen tailored draft preparation (controlled)", () => {
  it("shows a moving elapsed clock and a stated expectation instead of a fabricated percentage", () => {
    vi.useFakeTimers();

    try {
      const selectedItem: ReviewQueueItem = {
        ...createEligibleItem("job_generating"),
        assetStatus: "generating",
      };

      const operationStartedAt = Date.now();
      const props = {
        resumeOperationStarts: { job_generating: operationStartedAt },
        isJobPending: (jobId: string) => jobId === "job_generating",
        queue: [selectedItem],
        selectedItem,
        selectedJob: {
          id: selectedItem.jobId,
          title: "Senior Frontend Engineer",
          company: "Acme",
          location: "Remote",
          summary: "Build dependable hiring tooling.",
          description: "Build dependable hiring tooling.",
          matchAssessment: {
            score: 82,
            reasons: ["Relevant experience"],
            gaps: [],
            recommendation: "review_before_applying",
            recommendationRationale: null,
            requirements: [],
          },
        } as unknown as SavedJob,
      };
      const view = renderScreen(props);

      const elapsed = document.querySelector("[data-resume-draft-elapsed]");
      expect(elapsed).not.toBeNull();
      expect(elapsed?.textContent).toBe("0:00");

      // The old bar climbed a made-up percentage to a 94% ceiling and froze
      // there; nothing in the pipeline can substantiate a completion fraction.
      expect(document.body.textContent).not.toContain("% estimated");
      for (const bar of document.querySelectorAll('[role="progressbar"]')) {
        expect(bar.getAttribute("aria-valuenow")).toBeNull();
      }

      expect(
        document.querySelector("[data-resume-draft-expected-wait]")
          ?.textContent,
      ).toBe("Usually 40-70 seconds for a tailored draft.");

      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      expect(
        document.querySelector("[data-resume-draft-elapsed]")?.textContent,
      ).toBe("0:03");
      view.unmount();
      act(() => {
        vi.advanceTimersByTime(12_000);
      });
      renderScreen(props);
      expect(
        document.querySelector("[data-resume-draft-elapsed]")?.textContent,
      ).toBe("0:15");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses canonical workflow status for a ready asset that still needs approval", () => {
    const selectedItem: ReviewQueueItem = {
      ...createEligibleItem("job_needs_approval"),
      assetStatus: "ready",
      progressPercent: 100,
      resumeAssetId: "asset_needs_approval",
      resumeReview: { status: "draft" },
    };

    renderScreen({ queue: [selectedItem], selectedItem });

    // The row and the detail header must name the same canonical state,
    // never two names for one job. Once on the selected row (rows keep their
    // badge when selected) and once in the detail header.
    expect(screen.getAllByText("Ready to apply").length).toBe(2);
    expect(screen.queryByText("Review resume")).toBeNull();
  });

  it("delegates the create-all run to the page controller without owning it", () => {
    const onPrepareTailoredDrafts = vi.fn();
    const onGenerateResume = vi
      .fn<
        (jobId: string, options?: { selectAfter?: boolean }) => Promise<boolean>
      >()
      .mockResolvedValue(true);

    renderScreen({
      onGenerateResume,
      onPrepareTailoredDrafts,
      queue: [
        createEligibleItem("job_1"),
        createEligibleItem("job_2"),
        createEligibleItem("job_3"),
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Create 3 missing resumes" }),
    );

    expect(onPrepareTailoredDrafts).toHaveBeenCalledTimes(1);
    expect(onGenerateResume).not.toHaveBeenCalled();
  });

  it("renders running progress from controller state and forwards cooperative stop", () => {
    const onStopTailoredDraftPreparation = vi.fn();

    renderScreen({
      draftPreparation: {
        attemptedCount: 2,
        completedCount: 1,
        currentIndex: 2,
        eligibleRemainingCount: 0,
        failedCount: 0,
        status: "running",
        totalCount: 3,
      },
      onStopTailoredDraftPreparation,
      queue: [
        createEligibleItem("job_1"),
        createEligibleItem("job_2"),
        createEligibleItem("job_3"),
      ],
    });

    expect(screen.getByText(/Writing resumes · 1 of 3 finished/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Stop new resumes" }),
    );

    expect(onStopTailoredDraftPreparation).toHaveBeenCalledTimes(1);
  });

  it("renders the finished aggregate result from controller state", () => {
    renderScreen({
      draftPreparation: {
        attemptedCount: 3,
        completedCount: 3,
        currentIndex: null,
        eligibleRemainingCount: 0,
        failedCount: 0,
        status: "completed",
        totalCount: 3,
      },
      queue: [
        createEligibleItem("job_1"),
        createEligibleItem("job_2"),
        createEligibleItem("job_3"),
      ],
    });

    expect(screen.getByText(/Wrote 3 resumes/)).toBeTruthy();
  });

  it("caps one create-all run at ten and says how many are left", () => {
    const onPrepareTailoredDrafts = vi.fn();
    const queue = Array.from({ length: 12 }, (_, index) =>
      createEligibleItem(`job_${index}`),
    );

    renderScreen({ onPrepareTailoredDrafts, queue });

    fireEvent.click(
      screen.getByRole("button", { name: "Create 10 missing resumes" }),
    );
    expect(screen.getByText(/2 more after that/)).toBeTruthy();
    expect(onPrepareTailoredDrafts).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])(
    "keeps a ready batch within %i remaining daily slots",
    async (remaining) => {
      const onStartAutoApplyQueue = vi
        .fn<
          (jobIds: string[]) => Promise<JobFinderAutoApplyQueueStartOutcome>
        >()
        .mockResolvedValue({ status: "confirmed" });
      renderScreen({
        dailyCapacity: {
          limit: 2,
          used: 2 - remaining,
          legacyUncertain: 0,
          remaining,
          localDate: "2026-09-26",
          resetsAt: "2026-09-27T00:00:00.000Z",
        },
        onStartAutoApplyQueue,
        queue: ["job_a", "job_b"].map((jobId) => ({
          ...createEligibleItem(jobId),
          assetStatus: "ready",
          resumeAssetId: `asset_${jobId}`,
          resumeReview: { status: "needs_review" },
        })),
      });

      if (remaining === 0) {
        expect(screen.queryByTestId("apply-all-ready")).toBeNull();
        expect(onStartAutoApplyQueue).not.toHaveBeenCalled();
        return;
      }
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name:
              remaining === 1
                ? "Apply to the 1 ready job"
                : "Apply to all 2 ready jobs",
          }),
        );
        await Promise.resolve();
      });
      expect(onStartAutoApplyQueue).toHaveBeenCalledWith(
        ["job_a", "job_b"].slice(0, remaining),
        "prepare_only",
      );
    },
  );

  it.each([
    "prepare_only",
    "confirm_before_submit",
    "autonomous_submit",
  ] as const)(
    "applies to every ready job in one press with %s, leaving jobs already in Applications alone",
    async (applicationAutomationMode) => {
      const onStartAutoApplyQueue = vi
        .fn<
          (jobIds: string[]) => Promise<JobFinderAutoApplyQueueStartOutcome>
        >()
        .mockResolvedValue({ status: "confirmed" });
      const ready = (jobId: string): ReviewQueueItem => ({
        ...createEligibleItem(jobId),
        assetStatus: "ready",
        resumeAssetId: `asset_${jobId}`,
        resumeReview: { status: "needs_review" },
      });

      renderScreen({
        applicationAutomationMode,
        applicationRecords: [
          ApplicationRecordSchema.parse({
            id: "application_done",
            jobId: "job_done",
            title: "Role job_done",
            company: "Acme",
            status: "ready_for_review",
            lastAttemptState: null,
            lastActionLabel: "Prepared",
            nextActionLabel: "Send",
            lastUpdatedAt: "2026-08-30T10:00:00.000Z",
          }),
        ],
        onStartAutoApplyQueue,
        queue: [ready("job_a"), ready("job_b"), ready("job_done")],
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Apply to all 2 ready jobs" }),
        );
        await Promise.resolve();
      });

      expect(onStartAutoApplyQueue).toHaveBeenCalledWith(
        ["job_a", "job_b"],
        applicationAutomationMode,
      );
    },
  );
});

describe("ReviewQueueScreen single-column workspace", () => {
  function createSelectedJob(jobId: string): SavedJob {
    return {
      id: jobId,
      title: `Role ${jobId}`,
      company: "Acme",
      location: "Remote",
      summary: "Build dependable hiring tooling.",
      description: "Build dependable hiring tooling.",
      matchAssessment: {
        score: 82,
        reasons: ["Relevant experience"],
        gaps: [],
        recommendation: "review_before_applying",
        recommendationRationale: null,
        requirements: [],
      },
    } as unknown as SavedJob;
  }

  it("has no tab strip: the shortlisted job is one linear column", () => {
    const selectedItem = createEligibleItem("job_column");
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: createSelectedJob(selectedItem.jobId),
    });

    // Readiness / Resume / Job details split one strictly ordered job across
    // three destinations, two of which were nearly empty.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();

    const column = screen.getByTestId("review-queue-workspace-column");
    // State and next action first, the job facts under them, one job title in
    // the detail header.
    expect(column.textContent).toContain("Open full job details");
    expect(column.textContent).toContain("About this job");
    expect(
      screen.getAllByRole("heading", { name: `Role ${selectedItem.jobId}` }),
    ).toHaveLength(1);
  });

  it("holds the scoring breakdown behind one disclosure", () => {
    const selectedItem = createEligibleItem("job_scored");
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: createSelectedJob(selectedItem.jobId),
    });

    const disclosure = screen
      .getByText("How this was scored")
      .closest("details");
    expect(disclosure).toBeInstanceOf(HTMLDetailsElement);
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
  });

  it("shows no resume section until a resume exists", () => {
    const selectedItem = createEligibleItem("job_no_resume");
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: createSelectedJob(selectedItem.jobId),
    });

    // The Resume tab was a ~600px empty box duplicating the primary above it.
    expect(
      screen.queryByRole("heading", { level: 2, name: "Resume" }),
    ).toBeNull();
  });
});

describe("ReviewQueueScreen locked pane scroll regions", () => {
  function createSelectedJob(jobId: string): SavedJob {
    return {
      id: jobId,
      title: `Role ${jobId}`,
      company: "Acme",
      location: "Remote",
      summary: "Build dependable hiring tooling.",
      description: "Build dependable hiring tooling.",
      matchAssessment: {
        score: 82,
        reasons: ["Relevant experience"],
        gaps: [],
        recommendation: "review_before_applying",
        recommendationRationale: null,
        requirements: [],
      },
    } as unknown as SavedJob;
  }

  it("owns exactly one scroller per column", () => {
    const selectedItem = createEligibleItem("job_region");
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: createSelectedJob(selectedItem.jobId),
    });

    // The shortlist column and the workspace column: the stacked panels
    // inside the workspace never add a second nested scroll owner.
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-locked-pane-scroll-region]",
      ),
    );
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region.className).toContain("overflow-y-auto");
      expect(
        region.querySelectorAll("[data-locked-pane-scroll-region]"),
      ).toHaveLength(0);
    }
    expect(
      screen
        .getByTestId("review-queue-workspace-column")
        .getAttribute("data-locked-pane-scroll-region"),
    ).not.toBeNull();
  });

  it("keeps the resume preview inside the one workspace scroller", () => {
    const selectedItem: ReviewQueueItem = {
      ...createEligibleItem("job_tailored_preview"),
      assetStatus: "ready",
      progressPercent: 100,
      resumeAssetId: "asset_tailored_preview",
      resumeReview: { status: "needs_review" },
    };
    const selectedAsset: TailoredAsset = {
      id: "asset_tailored_preview",
      jobId: "job_tailored_preview",
      kind: "resume",
      status: "ready",
      label: "Tailored resume v1",
      version: "v1",
      templateName: "standard",
      compatibilityScore: 92,
      progressPercent: 100,
      updatedAt: "2026-08-20T00:00:00.000Z",
      storagePath: null,
      contentText: null,
      previewSections: [
        { heading: "Summary", lines: ["Dependable product engineer."] },
      ],
      generationMethod: "deterministic",
      notes: [],
      failureMessage: null,
      failedAt: null,
    };

    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedAsset,
      selectedJob: createSelectedJob(selectedItem.jobId),
    });

    const column = screen.getByTestId("review-queue-workspace-column");
    expect(
      within(column).getAllByText("Tailored resume v1").length,
    ).toBeGreaterThan(0);
    expect(
      column.querySelectorAll("[data-locked-pane-scroll-region]"),
    ).toHaveLength(0);
  });

  it("leaves empty shortlist states unmarked", () => {
    renderScreen({ queue: [] });

    // No selected job: only the workspace column is a scroll owner.
    expect(
      document.querySelectorAll("[data-locked-pane-scroll-region]"),
    ).toHaveLength(1);
  });
});

describe("ReviewQueueScreen job details honesty", () => {
  function buildJob(input: {
    jobId: string;
    summary: string;
    title: string;
  }): SavedJob {
    return {
      id: input.jobId,
      title: input.title,
      company: "Acme",
      location: "Remote",
      summary: input.summary,
      description: input.summary,
      discoveryMethod: "browser_agent",
      matchAssessment: {
        score: 64,
        reasons: ["Role title aligns with the current target roles."],
        gaps: [],
        recommendation: "review_before_applying",
        recommendationRationale: null,
        requirements: [],
        contextFingerprint: "context_v1",
        postingFingerprint: "posting_v1",
      },
    } as unknown as SavedJob;
  }

  it("presents an unverified score provisionally and drops an echoed summary", () => {
    const selectedItem = createEligibleItem("job_title_only");
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: buildJob({
        jobId: selectedItem.jobId,
        // The only "summary" the listing carried is its own title.
        summary: selectedItem.title,
        title: selectedItem.title,
      }),
    });

    // The withheld rule now names what was actually checked instead of
    // printing a percentage the app has not earned.
    expect(screen.getByTestId("review-queue-fit-score").textContent).toBe(
      "Title-only estimate",
    );
    // Once beside the score, once inside the breakdown that would otherwise
    // read as five contradictions of it.
    expect(
      screen.getAllByText(
        "Fit is based on the title alone. Review the listing details before applying.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        "The listing text was not captured. Open the full job details to read it.",
      ),
    ).toBeTruthy();

    // The route to the real posting sits with the job, not below the
    // evidence cards.
    const openListing = screen.getByRole("button", {
      name: "Open full job details",
    });
    const breakdown = screen.getByRole("region", {
      name: /score and evidence/iu,
    });
    expect(
      openListing.compareDocumentPosition(breakdown) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("withholds the score for the shape the real scorer emits for a card-only listing", () => {
    // Regression guard: the bare fixture above passed while the shape the
    // matching engine actually produces — an "adjacent" role verdict plus a
    // saved-preference location requirement that stayed unknown — printed a
    // bare percentage on this screen and on Find jobs.
    const selectedItem = createEligibleItem("job_real_title_only");
    const job = buildJob({
      jobId: selectedItem.jobId,
      summary: selectedItem.title,
      title: selectedItem.title,
    });
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: {
        ...job,
        matchAssessment: {
          ...job.matchAssessment,
          score: 54,
          compensationFit: { state: "unknown" },
          dimensions: {
            roleSuitability: {
              state: "adjacent",
              explanation:
                "The title matches, but the listing text was not captured, so nothing beyond the title could be checked.",
              evidence: [],
            },
            preferenceAlignment: { state: "unknown", evidence: [] },
            applicationEffort: { level: "unknown", evidence: [] },
            evidenceConfidence: { level: "unavailable", evidence: [] },
          },
          requirements: [
            {
              id: "location_not_stated",
              category: "location",
              label: "Location (not stated in listing)",
              importance: "required",
              status: "unknown",
              jobEvidence: "The listing does not state a location.",
              resumeEvidence: [],
              explanation:
                "The listing does not state a location, so it could not be compared with the saved search areas.",
            },
          ],
        },
      } as unknown as SavedJob,
    });

    expect(screen.getByTestId("review-queue-fit-score").textContent).toBe(
      "Title-only estimate",
    );
    expect(screen.queryByText(/54% fit/)).toBeNull();
    // The number is not destroyed: it stays inside the breakdown, qualified.
    expect(screen.getByText("Title-only estimate: 54%")).toBeTruthy();
  });

  it("keeps real listing text and a plain score when evidence was checked", () => {
    const selectedItem = createEligibleItem("job_verified");
    const job = buildJob({
      jobId: selectedItem.jobId,
      summary: "Own the deployment pipeline for the payments platform.",
      title: selectedItem.title,
    });
    renderScreen({
      queue: [selectedItem],
      selectedItem,
      selectedJob: {
        ...job,
        matchAssessment: {
          ...job.matchAssessment,
          requirements: [
            {
              id: "req_1",
              label: "Backend services",
              importance: "required",
              status: "supported",
              explanation: "Matches saved backend experience.",
              jobEvidence: "Own backend services.",
              resumeEvidence: [],
            },
          ],
        },
      } as unknown as SavedJob,
    });

    expect(screen.getByTestId("review-queue-fit-score").textContent).toBe(
      "64% fit",
    );
    expect(
      screen.getByText(
        "Own the deployment pipeline for the payments platform.",
      ),
    ).toBeTruthy();
  });
});

describe("ReviewQueueScreen readiness agreement", () => {
  it("badges an already-prepared job the same way in the list and the header", () => {
    // The panel saw "RESUME NEEDS REVIEW" and "READY TO APPLY" for one job
    // seconds apart: the row read the prepared-application set and the
    // workspace header computed its own verdict without it.
    const item: ReviewQueueItem = {
      ...createEligibleItem("job_prepared"),
      assetStatus: "ready",
      resumeAssetId: "asset_prepared",
      resumeReview: {
        status: "approved",
        approvedAt: "2026-08-20T00:00:00.000Z",
        approvedExportId: "export_prepared",
        approvedFormat: "pdf",
        approvedFilePath: "/tmp/prepared.pdf",
      },
    };

    renderScreen({
      applicationRecords: [
        ApplicationRecordSchema.parse({
          id: "application_prepared",
          jobId: "job_prepared",
          title: "Role job_prepared",
          company: "Acme",
          status: "ready_for_review",
          lastActionLabel: "Prepared application",
          nextActionLabel: "Review",
          lastUpdatedAt: "2026-08-20T00:00:00.000Z",
        }),
      ],
      queue: [item],
      selectedItem: item,
    });

    const badges = screen.getAllByText("In Applications");
    expect(badges.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Ready to apply")).toBeNull();
  });
});
