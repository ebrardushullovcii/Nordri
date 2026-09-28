// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  InterviewLiveSession,
  InterviewWorkspaceSnapshot,
} from "@nordri/contracts";

import { LiveAssistantPage } from "./live-assistant-page";

vi.mock("./interview-media-stream-probes", () => ({
  InterviewMediaStreamProbes: () => <div data-testid="media-probes-stub" />,
}));

function createEndedSession(): InterviewLiveSession {
  return {
    automaticCueSensitivity: "conservative",
    chatConversation: null,
    cueCards: [],
    cueSummary: "No summary yet.",
    diagnostics: [],
    endedAt: "2026-08-19T10:30:00.000Z",
    id: "session_past_1",
    listening: false,
    protectedSurfaces: [],
    startedAt: "2026-08-19T10:00:00.000Z",
    status: "ended",
    targetContext: {
      company: null,
      confirmedAt: "2026-08-19T09:00:00.000Z",
      id: "target_1",
      kind: "general",
      label: "General interview",
      notes: null,
      profileSnapshot: null,
      role: null,
      savedJob: null,
      sourceUrl: null,
    },
    transcriptAnnotations: [],
    transcriptSegments: [],
    visualBatches: [],
  } as unknown as InterviewLiveSession;
}

function createWorkspace(recentSessions: InterviewLiveSession[] = []) {
  return {
    activeSession: null,
    answerOverlay: {
      confidenceLabel: null,
      currentCue: null,
      interactionMode: false,
      mode: "popup_window",
      opacity: 1,
      protectionState: "best_effort",
      queuedScreenshotCount: 0,
      statusLabel: "Ready",
      surfaceKind: "live_answer_overlay",
      transcriptSegments: [],
      visible: true,
    },
    generatedAt: "2026-08-20T10:00:00.000Z",
    module: "live-assistant",
    overlayPreferences: [],
    recentSessions,
    setup: {
      autoCaptureOnCue: false,
      consent: {
        acceptedAt: null,
        localRetention: false,
        meetingAudioCapture: false,
        microphoneCapture: false,
        modelTransmission: false,
        overlayProtectionNotice: false,
        screenshotCapture: false,
      },
      cueSensitivity: "conservative",
      prepArtifacts: [],
      rehearsal: null,
      targetContext: null,
      transcriptionLanguage: "en-US",
    },
    transcriptOverlay: {
      confidenceLabel: null,
      currentCue: null,
      interactionMode: false,
      mode: "popup_window",
      opacity: 1,
      protectionState: "best_effort",
      queuedScreenshotCount: 0,
      statusLabel: "Ready",
      surfaceKind: "live_transcript_overlay",
      transcriptSegments: [],
      visible: true,
    },
  } as unknown as InterviewWorkspaceSnapshot;
}

function installDesktopApi(
  workspace: InterviewWorkspaceSnapshot,
  isFullScreen = false,
) {
  Object.defineProperty(window, "nordri", {
    configurable: true,
    value: {
      liveAssistant: {
        getWorkspace: vi.fn().mockResolvedValue(workspace),
        onWorkspaceChange: vi.fn().mockReturnValue(() => undefined),
      },
      ping: vi.fn().mockResolvedValue({ platform: "darwin" }),
      window: {
        getControlsState: vi.fn().mockResolvedValue({
          isClosable: true,
          isFullScreen,
          isMaximized: isFullScreen,
          isMinimizable: true,
        }),
        onControlsStateChange: vi.fn().mockReturnValue(() => undefined),
      },
    },
  });
}

function renderInterviewShell() {
  window.location.hash = "#/live-assistant";
  return render(
    <HashRouter>
      <Routes>
        <Route element={<LiveAssistantPage />} path="/live-assistant" />
      </Routes>
    </HashRouter>,
  );
}

function getSectionNav(container: HTMLElement) {
  return container.querySelector(
    'nav[aria-label="Live Assistant sections"]',
  )!;
}

function getCurrentSectionLabels(container: HTMLElement) {
  return Array.from(
    getSectionNav(container).querySelectorAll('button[aria-current="page"]'),
  ).map((tab) => tab.textContent);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Live Assistant section navigation", () => {
  test("moves the suite wordmark fully left in native macOS fullscreen", async () => {
    installDesktopApi(createWorkspace(), true);
    const rendered = renderInterviewShell();

    await rendered.findByRole("heading", { name: "Start interview" });

    const brand = rendered.container.querySelector<HTMLElement>(
      "[data-desktop-brand]",
    );
    expect(brand?.style.paddingInlineStart).toBe("");
  });

  test("marks exactly one section as current and moves it when switching sections", async () => {
    installDesktopApi(createWorkspace([createEndedSession()]));
    const rendered = renderInterviewShell();

    await rendered.findByRole("button", { name: "Review" });

    expect(getCurrentSectionLabels(rendered.container)).toEqual(["Review"]);

    fireEvent.click(rendered.getByRole("button", { name: "Settings" }));

    expect(
      await rendered.findByRole("heading", { name: "Preferences" }),
    ).toBeTruthy();
    expect(getCurrentSectionLabels(rendered.container)).toEqual(["Settings"]);
    expect(getCurrentSectionLabels(rendered.container)).toHaveLength(1);
    expect(
      rendered.queryByRole("heading", { name: "Post-session review" }),
    ).toBeNull();
  });

  test("keeps Settings reachable from exactly one control", async () => {
    installDesktopApi(createWorkspace());
    const rendered = renderInterviewShell();

    await rendered.findByRole("heading", { name: "Start interview" });

    expect(rendered.getAllByRole("button", { name: "Settings" })).toHaveLength(
      1,
    );
    expect(
      rendered.getAllByRole("button", { name: "Change settings" }),
    ).toHaveLength(1);
  });

  test("states the setup stage once without repeating the primary action label", async () => {
    installDesktopApi(createWorkspace());
    const rendered = renderInterviewShell();

    expect(
      await rendered.findAllByText("Accept notices and continue"),
    ).toHaveLength(1);
    expect(rendered.getByText("Accept the required notices")).toBeTruthy();
    expect(
      rendered.getByText(
        "Accept the assistant, local-retention, and visible-overlay notices. Microphone, system audio, and screenshots remain separate opt-ins.",
      ),
    ).toBeTruthy();
  });

  test("renders a compact actionable empty state when Review has no sessions", async () => {
    installDesktopApi(createWorkspace());
    const rendered = renderInterviewShell();

    fireEvent.click(await rendered.findByRole("button", { name: "Review" }));

    expect(
      await rendered.findByText("No saved interview session yet"),
    ).toBeTruthy();
    expect(rendered.container.innerHTML).toContain("min-h-[12rem]");
    expect(rendered.container.innerHTML).not.toContain("min-h-[18rem]");

    fireEvent.click(rendered.getByRole("button", { name: "Go to setup" }));

    expect(
      await rendered.findByRole("heading", { name: "Start interview" }),
    ).toBeTruthy();
  });
});
