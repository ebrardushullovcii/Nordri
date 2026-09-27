// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeImportProgress } from "./resume-import-progress";

describe("ResumeImportProgress", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    vi.useRealTimers();
    container?.remove();
    container = null;
    root = null;
  });

  it("shows the real pipeline stage, exact elapsed time, and a long-import expectation", () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ResumeImportProgress
          isPending
          progress={{
            stage: "building_profile",
            message: "Building grounded profile suggestions for your review.",
            occurredAt: "2026-07-16T10:00:00.000Z",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Building profile suggestions");
    expect(container.textContent).toContain("0s elapsed");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(container.textContent).toContain("1m 01s elapsed");
    expect(container.textContent).toContain(
      "Larger or image-heavy resumes can take a couple of minutes",
    );
  });

  it("states the model stage's timing once, without claiming editing is open", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ResumeImportProgress
          isPending
          progress={{
            stage: "building_profile",
            message:
              "Reading your resume and filling in your profile. Anything that would replace details you already saved waits for your review.",
            occurredAt: "2026-09-23T14:28:12.000Z",
            completed: 2,
            total: 4,
            expectedSecondsMin: 15,
            expectedSecondsMax: 60,
          }}
        />,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Usually 15-60 seconds.");
    // Profile pauses editing during an import and setup's import screens
    // have nothing to edit, so the card must not promise editing.
    expect(text).not.toContain("keep editing");
    // The stage message carries the promise about saved details; the card
    // used to repeat it in the next sentence.
    expect(text.match(/already saved/g)).toHaveLength(1);
  });

  it("starts elapsed processing time only after a file is selected", () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<ResumeImportProgress isPending progress={null} />);
    });

    expect(container.textContent).toContain("File browser open");
    expect(container.textContent).toContain("Choose a file or press Escape");
    expect(container.textContent).toContain("The system file browser is open.");

    act(() => {
      vi.advanceTimersByTime(61_000);
      root?.render(
        <ResumeImportProgress
          isPending
          progress={{
            stage: "reading_document",
            message: "Reading resume text, sections, and page layout.",
            occurredAt: "2026-07-16T10:00:00.000Z",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Reading your resume");
    expect(container.textContent).toContain("0s elapsed");
    expect(container.textContent).not.toContain("1m 01s elapsed");
  });
});
