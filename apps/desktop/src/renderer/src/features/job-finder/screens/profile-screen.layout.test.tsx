// @vitest-environment jsdom

import type {
  CandidateProfile,
  JobFinderWorkspaceSnapshot,
  JobSearchPreferences,
  ProfileSetupState,
  ResumeImportFieldCandidateSummary,
  SourceDebugRunDetails,
} from "@unemployed/contracts";
import {
  CandidateProfileSchema,
  JobSearchPreferencesSchema,
  ResumeImportFieldCandidateSummarySchema,
} from "@unemployed/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "./profile-screen";

const profile = CandidateProfileSchema.parse({
  id: "candidate_ready",
  firstName: "Ready",
  lastName: "Candidate",
  fullName: "Ready Candidate",
  headline: "Principal systems designer",
  summary: "Builds workflow platforms.",
  currentLocation: "Prishtina",
  yearsExperience: 10,
  baseResume: {
    id: "resume_ready",
    fileName: "resume.pdf",
    uploadedAt: new Date(0).toISOString(),
    textContent: "Experienced designer.",
    extractionStatus: "needs_text",
  },
  workEligibility: {},
  professionalSummary: {},
  targetRoles: [],
  locations: [],
  skills: [],
  experiences: [
    {
      id: "exp_1",
      companyName: "Original Co",
      title: "Designer",
      startDate: "2018-01",
      isCurrent: true,
    },
  ],
  education: [],
  certifications: [],
  links: [],
  projects: [],
  spokenLanguages: [],
});

const searchPreferences = JobSearchPreferencesSchema.parse({
  workModes: ["remote"],
  minimumSalaryUsd: null,
  approvalMode: "review_before_submit",
  tailoringMode: "balanced",
});

const profileSetupState: ProfileSetupState = {
  status: "completed",
  currentStep: "ready_check",
  completedAt: "2026-08-01T00:00:00.000Z",
  reviewItems: [],
  lastResumedAt: null,
};

type ProfileScreenProps = React.ComponentProps<typeof ProfileScreen>;

function buildProfileScreenProps(
  overrides: {
    onSaveAll?: ProfileScreenProps["onSaveAll"];
    profile?: CandidateProfile;
  } = {},
): ProfileScreenProps {
  const props: ProfileScreenProps = {
    actionState: { message: null },
    importResumeGuardMessage: null,
    latestResumeImportReviewCandidates:
      [] as readonly ResumeImportFieldCandidateSummary[],
    latestResumeImportRun: null,
    onApplyProfileCopilotPatchGroup: vi.fn(),
    onApplyProfileSetupReviewAction: vi.fn(),
    onApplyResumeTimelineRepairAction: async () => {},
    onAnalyzeProfileFromResume: vi.fn(),
    onGetSourceDebugRunDetails: () =>
      Promise.resolve({} as SourceDebugRunDetails),
    onImportResume: vi.fn(),
    onOpenBrowserSessionForTarget: vi.fn(),
    onProfileSurfaceDirtyChange: vi.fn(),
    profileCopilotPendingContextKey: null,
    onRejectProfileCopilotPatchGroup: vi.fn(),
    onResumeProfileSetup: vi.fn(),
    onRunSourceDebug: vi.fn(),
    onSaveAll: vi.fn(),
    onSaveSourceInstructionArtifact: vi.fn(),
    onSendProfileCopilotMessage: vi.fn(),
    onUndoProfileRevision: vi.fn(),
    onVerifySourceInstructions: vi.fn(),
    pendingActions: {
      analyzeProfile: false,
      browserSession: () => false,
      importResume: false,
      profileCopilotBusy: false,
      profileMutation: false,
      profileSetup: false,
      profileReviewItem: () => false,
      sourceDebug: () => false,
      sourceInstruction: () => false,
      sourceInstructionVerify: () => false,
      targetDiscovery: () => false,
    },
    profile,
    profileCopilotMessages:
      [] as readonly JobFinderWorkspaceSnapshot["profileCopilotMessages"][number][],
    profileRevisions:
      [] as readonly JobFinderWorkspaceSnapshot["profileRevisions"][number][],
    profileSetupState,
    recentSourceDebugRuns: [],
    resumeImportProgress: null,
    searchPreferences,
    sourceAccessPrompts: [],
    sourceInstructionArtifacts: [],
  };

  if (overrides.onSaveAll) {
    props.onSaveAll = overrides.onSaveAll;
  }

  if (overrides.profile) {
    props.profile = overrides.profile;
  }

  return props;
}

function renderProfileScreen(
  overrides: {
    initialEntry?: string;
    onSaveAll?: ProfileScreenProps["onSaveAll"];
    profile?: CandidateProfile;
  } = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter
      initialEntries={[overrides.initialEntry ?? "/job-finder/profile"]}
    >
      <ProfileScreen {...buildProfileScreenProps(overrides)} />
    </MemoryRouter>,
  );
}

describe("ProfileScreen ready-state density and save-bar footprint", () => {
  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    window.localStorage.removeItem(
      "unemployed.profile-ready-banner-dismissed-v1",
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["experience", "education"] as const)(
    "reviews imported %s within a completed Profile without reopening setup",
    (section) => {
      const props = buildProfileScreenProps();
      const value =
        section === "experience"
          ? {
              ...profile.experiences[0],
              achievements: ["Handled 40 requests per shift."],
            }
          : {
              schoolName: "Example College",
              degree: "Certificate",
              endDate: "2019",
            };
      const candidate = ResumeImportFieldCandidateSummarySchema.parse({
        id: "imported_record",
        target: { section, key: "record", recordId: "imported_record" },
        label: "Updated background",
        value,
        confidence: 0.95,
        resolution: "needs_review",
      });
      props.profile = CandidateProfileSchema.parse({
        ...profile,
        education: [
          {
            id: "saved_school",
            schoolName: "Example College",
            degree: "Certificate",
          },
        ],
      });
      props.latestResumeImportReviewCandidates = [candidate];
      props.profileSetupState = {
        ...profileSetupState,
        reviewItems: [
          {
            id: "review_record",
            step: "background",
            target: {
              domain: section,
              key: "record",
              recordId: "imported_record",
            },
            label: "Updated background",
            reason: "New resume details need review.",
            severity: "recommended",
            status: "pending",
            proposedValue: JSON.stringify(value),
            sourceSnippet: null,
            sourceCandidateId: candidate.id,
            sourceRunId: "import_run",
            createdAt: "2026-09-26T00:00:00.000Z",
            resolvedAt: null,
          },
        ],
      };
      render(
        <MemoryRouter>
          <ProfileScreen {...props} />
        </MemoryRouter>,
      );
      const action =
        section === "experience"
          ? /Review in Experience:/
          : /Review in Background:/;
      fireEvent.click(screen.getByRole("button", { name: action }));
      expect(screen.getByText("Currently saved")).toBeTruthy();
      expect(
        screen.getByText("Currently saved").parentElement?.textContent,
      ).not.toContain("Is draft");
      expect(screen.getByText("Suggested value")).toBeTruthy();
      const row = document.getElementById(
        "profile-import-review-imported_record",
      );
      expect(row?.textContent).toContain(
        section === "experience" ? "Handled 40 requests per shift." : "2019",
      );
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(props.onApplyProfileSetupReviewAction).toHaveBeenCalledWith(
        "review_record",
        "confirm",
        undefined,
      );
      expect(props.onResumeProfileSetup).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("heading", { name: "Guided setup" }),
      ).toBeNull();
    },
  );

  it("blocks imported review actions while Profile has unsaved edits or a pending update", () => {
    const props = buildProfileScreenProps();
    const candidate = ResumeImportFieldCandidateSummarySchema.parse({
      id: "imported_headline",
      target: { section: "identity", key: "headline" },
      label: "Headline",
      value: "New headline",
      confidence: 0.95,
      resolution: "needs_review",
    });
    props.latestResumeImportReviewCandidates = [candidate];
    props.profileSetupState = {
      ...profileSetupState,
      reviewItems: [
        {
          id: "review_headline",
          step: "essentials",
          target: { domain: "identity", key: "headline", recordId: null },
          label: "Headline",
          reason: "Different headline.",
          severity: "recommended",
          status: "pending",
          proposedValue: "New headline",
          sourceSnippet: null,
          sourceCandidateId: candidate.id,
          sourceRunId: "import_run",
          createdAt: "2026-09-26T00:00:00.000Z",
          resolvedAt: null,
        },
      ],
    };
    const rendered = render(
      <MemoryRouter>
        <ProfileScreen {...props} />
      </MemoryRouter>,
    );
    expect(
      screen
        .getByRole("button", {
          name: "Confirm",
        })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Edited" },
    });
    expect(
      screen
        .getByRole("button", {
          name: "Confirm",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText(
        "Save your profile changes before reviewing imported suggestions.",
      ),
    ).toBeTruthy();
    rendered.unmount();
    props.pendingActions.profileReviewItem = () => true;
    render(
      <MemoryRouter>
        <ProfileScreen {...props} />
      </MemoryRouter>,
    );
    expect(
      screen
        .getByRole("button", {
          name: "Confirm",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(props.onApplyProfileSetupReviewAction).not.toHaveBeenCalled();
  });

  it("raises the resume identity choice as soon as the Basics name changes", () => {
    const onSaveAll = vi.fn();
    renderProfileScreen({
      onSaveAll,
      profile: CandidateProfileSchema.parse({
        ...profile,
        firstName: "Casey",
        lastName: "Rowan",
        fullName: "Casey Rowan",
        baseResume: {
          ...profile.baseResume,
          textContent: "CASEY ROWAN\nMarketing Manager",
        },
      }),
    });

    expect(screen.queryByTestId("resume-identity-choice")).toBeNull();
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Vance" },
    });

    expect(screen.getByTestId("resume-identity-choice").textContent).toContain(
      "Preparation is paused because the imported resume says “CASEY ROWAN” while your profile says “Jordan Vance”",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Use my profile name for this resume",
      }),
    );
    expect(onSaveAll).toHaveBeenCalledTimes(1);
    expect(onSaveAll.mock.calls[0]?.[0]).toMatchObject({
      fullName: "Jordan Vance",
      resumeIdentityOwnership: {
        acknowledgedSourceFullName: "CASEY ROWAN",
      },
    });
  });

  it("renders the compact section panel with a reduced save-bar footprint", () => {
    renderProfileScreen();

    // Ready state keeps the banner path intact.
    expect(screen.getByText("Core setup is ready.")).toBeTruthy();

    // Tab panel content padding is tightened at wide breakpoints.
    const panel = document.getElementById("profile-section-panel");
    expect(panel?.className).toContain("sm:py-3");
    expect(panel?.className).not.toContain("sm:p-4");

    // Section tabs sit closer to the panel and stay above the completeness strip.
    const tabsGrid = screen
      .getByRole("tablist", { name: "Profile sections" })
      .closest("[class*='xl:grid-rows']");
    expect(tabsGrid?.className).toContain("gap-2");
    expect(tabsGrid?.className).not.toContain("--gap-content");

    // The save bar is pinned chrome, not the tail of the scrolling page.
    const saveBar = document.querySelector("[data-profile-workspace-actions]");
    expect(saveBar).toBeTruthy();
    expect(
      saveBar?.closest("[data-locked-screen-bottom-content]"),
    ).toBeTruthy();
  });

  // F01 regression. Profile rendered `ProfileSaveFooter` at the end of a
  // ~5,400px page: measured at y 5387 in an 852px viewport (1440x920), y 5533
  // (1200x640) and y 5681 (1024x720), enabled, with "Unsaved changes on this
  // page." beside it - all four thousand pixels below the fold. jsdom has no
  // layout engine, so the assertion here is structural and is the thing that
  // actually decides the geometry: the save control must live in the pinned
  // bottom slot, which is a `shrink-0` flex sibling of the `min-h-0 flex-1`
  // scroller inside an `h-full` section, and must not be inside the scroller.
  it.each([
    ["1440x920", 1440, 920],
    ["1200x640", 1200, 640],
    ["1024x720", 1024, 720],
  ])(
    "keeps Save outside the scroll area and inside the pinned footer at %s",
    (_label, width, height) => {
      vi.stubGlobal("innerWidth", width);
      vi.stubGlobal("innerHeight", height);
      renderProfileScreen();

      const save = screen.getByRole("button", { name: "Save changes" });
      const scrollArea = document.querySelector(
        "[data-locked-screen-scroll-area]",
      );
      const pinnedFooter = document.querySelector(
        "[data-locked-screen-bottom-content]",
      );

      expect(pinnedFooter).toBeTruthy();
      expect(pinnedFooter?.contains(save)).toBe(true);
      expect(scrollArea?.contains(save)).toBe(false);
      expect(pinnedFooter?.className).toContain("shrink-0");
    },
  );

  it("reports the dirty state next to the pinned Save control", () => {
    renderProfileScreen();

    const pinnedFooter = document.querySelector(
      "[data-locked-screen-bottom-content]",
    );

    // Clean profile: the footer still says so, so "no indicator" can never be
    // confused with "the indicator is somewhere below the fold".
    expect(pinnedFooter?.textContent).toContain("No unsaved changes.");

    const firstName = document.querySelector<HTMLInputElement>(
      'input[name="identity.firstName"]',
    );
    expect(firstName).toBeTruthy();
    if (!firstName) {
      return;
    }
    fireEvent.change(firstName, { target: { value: "ReadyX" } });

    expect(pinnedFooter?.textContent).toContain(
      "Unsaved changes on this page.",
    );
    expect(
      screen
        .getByRole("button", { name: "Save changes" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("marks the section panel scroller as the single locked pane scroll region", () => {
    renderProfileScreen();

    const regions = document.querySelectorAll(
      "[data-locked-pane-scroll-region]",
    );
    expect(regions).toHaveLength(1);

    const scrollArea = document.getElementById("profile-section-scroll-area");
    expect(scrollArea).not.toBeNull();
    expect(regions[0]).toBe(scrollArea);
    expect(scrollArea?.className).toContain("overflow-y-auto");
  });

  it("allows changing sections after arriving through a focused deep link", () => {
    renderProfileScreen({
      initialEntry: "/job-finder/profile?section=sources&focus=job-sources",
    });

    fireEvent.click(screen.getByRole("tab", { name: /Preferences/ }));

    expect(
      screen
        .getByRole("tab", { name: /Preferences/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("textbox", { name: "Target roles" })).toBeTruthy();
  });

  it("keeps non-Basics tabs above a compact resume summary instead of the full review surface", () => {
    renderProfileScreen({
      initialEntry: "/job-finder/profile?section=experience",
    });

    const summary = document.querySelector("[data-profile-resume-summary]");
    expect(summary).toBeTruthy();
    expect(summary?.parentElement?.className).not.toContain("pb-[4.5rem]");
    expect(
      screen
        .getByRole("tab", { name: /Work history/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getAllByText("Work history").length).toBeGreaterThan(0);
    expect(screen.queryByText("Imported details")).toBeNull();
    expect(screen.queryByText("Optional review")).toBeNull();
  });

  it("puts the editable Basics content before the detailed resume review surface", () => {
    renderProfileScreen({
      initialEntry: "/job-finder/profile?section=basics",
    });

    expect(
      document.querySelector("[data-profile-resume-summary]"),
    ).toBeTruthy();
    expect(document.querySelector("[data-profile-resume-review]")).toBeTruthy();
    expect(screen.getByText("Imported details")).toBeTruthy();

    const summary = document.querySelector("[data-profile-resume-summary]");
    const basicsEditor = document.querySelector(
      '[aria-labelledby="basics-tab"][role="tabpanel"]',
    );
    const detailedReview = document.querySelector(
      "[data-profile-resume-review]",
    );

    expect(summary).toBeTruthy();
    expect(basicsEditor).toBeTruthy();
    expect(detailedReview).toBeTruthy();
    if (!basicsEditor || !detailedReview) {
      throw new Error(
        "Expected the Basics editor and detailed resume review surface to render.",
      );
    }
    expect(
      basicsEditor.compareDocumentPosition(detailedReview) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the save path wired from the shared save bar to both payloads", () => {
    const onSaveAll =
      vi.fn<
        (
          profilePayload: CandidateProfile,
          preferencesPayload: JobSearchPreferences,
        ) => void
      >();
    renderProfileScreen({ onSaveAll });

    const headlineInput = document
      .getElementById("profile-section-panel")
      ?.querySelector<HTMLInputElement>('input[name="identity.headline"]');
    expect(headlineInput).toBeTruthy();
    fireEvent.change(headlineInput!, {
      target: { value: "Updated headline" },
    });
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save changes",
      }),
    );

    expect(onSaveAll).toHaveBeenCalledTimes(1);
    const [savedProfile, savedPreferences] = onSaveAll.mock.calls[0]!;
    expect(savedProfile.fullName).toBe("Ready Candidate");
    expect(savedPreferences.workModes).toContain("remote");
  });

  it("keeps malformed email edits local and replaces stale success feedback with validation", () => {
    const onSaveAll = vi.fn();
    const props = buildProfileScreenProps({ onSaveAll });
    props.actionState = { message: "Profile and saved answers saved." };

    render(
      <MemoryRouter initialEntries={["/job-finder/profile"]}>
        <ProfileScreen {...props} />
      </MemoryRouter>,
    );

    const emailInput = screen.getByRole("textbox", { name: "Email" });
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save changes",
      }),
    );

    expect(onSaveAll).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) =>
          alert.textContent?.includes("Email must be a valid email address."),
        ),
    ).toBe(true);
    expect(screen.queryByText("Profile and saved answers saved.")).toBeNull();
  });

  it("announces a kept-draft background merge and saves merged canonical data", () => {
    const onSaveAll =
      vi.fn<
        (
          profilePayload: CandidateProfile,
          preferencesPayload: JobSearchPreferences,
        ) => void
      >();
    const { rerender } = renderProfileScreen({ onSaveAll });

    const headlineInput = document
      .getElementById("profile-section-panel")
      ?.querySelector<HTMLInputElement>('input[name="identity.headline"]');
    expect(headlineInput).toBeTruthy();
    fireEvent.change(headlineInput!, {
      target: { value: "Kept draft headline" },
    });

    // A meaningful external canonical update lands while the draft is dirty.
    rerender(
      <MemoryRouter initialEntries={["/job-finder/profile"]}>
        <ProfileScreen
          {...buildProfileScreenProps({
            onSaveAll,
            profile: {
              ...profile,
              headline: "External canonical headline",
              currentLocation: "Berlin",
            },
          })}
        />
      </MemoryRouter>,
    );

    const mergeNotice = screen.getByText(/updated in the background/);
    expect(mergeNotice.closest('[role="status"]')).toBeTruthy();
    expect(mergeNotice.textContent).toContain(
      "Your unsaved edits were kept; review the merged fields before saving.",
    );
    expect(
      document
        .getElementById("profile-section-panel")
        ?.querySelector<HTMLInputElement>('input[name="identity.headline"]')
        ?.value,
    ).toBe("Kept draft headline");

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }),
    );

    expect(onSaveAll).toHaveBeenCalledTimes(1);
    const [mergedProfile] = onSaveAll.mock.calls[0]!;
    expect(mergedProfile.headline).toBe("Kept draft headline");
    expect(mergedProfile.currentLocation).toBe("Berlin");
  });

  it("keeps unsaved edits on an unmergeable background change and emits a reconciled save", () => {
    const onSaveAll =
      vi.fn<
        (
          profilePayload: CandidateProfile,
          preferencesPayload: JobSearchPreferences,
        ) => void
      >();
    const { rerender } = renderProfileScreen({
      initialEntry: "/job-finder/profile?section=experience",
      onSaveAll,
    });

    const companyInput = document
      .getElementById("profile-section-panel")
      ?.querySelector<HTMLInputElement>(
        'input[name="records.experiences.0.companyName"]',
      );
    expect(companyInput).toBeTruthy();
    fireEvent.change(companyInput!, { target: { value: "Kept Co" } });

    // The background removes the very record the user is editing: the merge
    // cannot be safe, so the local draft stays whole under a conflict notice.
    rerender(
      <MemoryRouter initialEntries={["/job-finder/profile?section=experience"]}>
        <ProfileScreen
          {...buildProfileScreenProps({
            onSaveAll,
            profile: {
              ...profile,
              experiences: [],
              targetRoles: ["Program Manager"],
            },
          })}
        />
      </MemoryRouter>,
    );

    const conflictNotice = screen.getByText(
      /could not be merged with your unsaved edits/,
    );
    expect(conflictNotice.closest('[role="status"]')).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Discard my edits and reload",
      }),
    ).toBeTruthy();
    expect(
      document
        .getElementById("profile-section-panel")
        ?.querySelector<HTMLInputElement>(
          'input[name="records.experiences.0.companyName"]',
        )?.value,
    ).toBe("Kept Co");

    // Saving is still the user's explicit choice; the emitted payload carries
    // the kept edit plus the newest canonical data instead of stale values.
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }),
    );

    expect(onSaveAll).toHaveBeenCalledTimes(1);
    const [emittedProfile] = onSaveAll.mock.calls[0]!;
    expect(
      emittedProfile.experiences.some(
        (experience) => experience.companyName === "Kept Co",
      ),
    ).toBe(true);
    expect(emittedProfile.targetRoles).toContain("Program Manager");

    // The returned snapshot echoes what this save emitted, so the surface
    // rebases clean and the conflict notice clears without another merge.
    rerender(
      <MemoryRouter initialEntries={["/job-finder/profile?section=experience"]}>
        <ProfileScreen
          {...buildProfileScreenProps({ onSaveAll, profile: emittedProfile })}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText(/could not be merged with your unsaved edits/),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Discard my edits and reload" }),
    ).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })
        .disabled,
    ).toBe(true);
  });

  it("restores the newest canonical data when the conflict reload action is used", () => {
    const onSaveAll =
      vi.fn<
        (
          profilePayload: CandidateProfile,
          preferencesPayload: JobSearchPreferences,
        ) => void
      >();
    const { rerender } = renderProfileScreen({
      initialEntry: "/job-finder/profile?section=experience",
      onSaveAll,
    });

    const companyInput = document
      .getElementById("profile-section-panel")
      ?.querySelector<HTMLInputElement>(
        'input[name="records.experiences.0.companyName"]',
      );
    expect(companyInput).toBeTruthy();
    fireEvent.change(companyInput!, { target: { value: "Kept Co" } });

    // The background removes the edited record: the merge aborts and the
    // notice exposes the discard-and-reload recovery action.
    rerender(
      <MemoryRouter initialEntries={["/job-finder/profile?section=experience"]}>
        <ProfileScreen
          {...buildProfileScreenProps({
            onSaveAll,
            profile: {
              ...profile,
              experiences: [],
              targetRoles: ["Program Manager"],
            },
          })}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/could not be merged with your unsaved edits/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Discard my edits and reload",
      }),
    );

    // The draft is dropped in favor of the newest canonical snapshot: no
    // experience row remains, the notice and affordance disappear, and the
    // forms land clean so saving is disabled again.
    expect(
      document
        .getElementById("profile-section-panel")
        ?.querySelector<HTMLInputElement>(
          'input[name="records.experiences.0.companyName"]',
        ),
    ).toBeNull();
    expect(
      screen.queryByText(/could not be merged with your unsaved edits/),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Discard my edits and reload" }),
    ).toBeNull();
    expect(onSaveAll).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })
        .disabled,
    ).toBe(true);
  });
});
