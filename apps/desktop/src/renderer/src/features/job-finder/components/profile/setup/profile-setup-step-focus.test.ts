// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROFILE_SETUP_STEP_HEADING_ID,
  focusProfileSetupStepHeading,
} from "./profile-setup-step-focus";

describe("focusProfileSetupStepHeading", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("focuses the new step heading without changing the setup scroll position", () => {
    document.body.innerHTML = `
      <div class="screen-scroll-area">
        <div>
          <h2 id="${PROFILE_SETUP_STEP_HEADING_ID}" tabindex="-1">Background setup step</h2>
        </div>
      </div>
    `;
    const scrollContainer = document.querySelector<HTMLElement>(
      ".screen-scroll-area",
    );
    const stepHeading = document.getElementById(PROFILE_SETUP_STEP_HEADING_ID);
    const scrollTo = vi.fn();

    if (!scrollContainer || !stepHeading) {
      throw new Error("Expected the setup test fixture to render");
    }

    scrollContainer.scrollTop = 640;
    scrollContainer.scrollTo = scrollTo;

    expect(focusProfileSetupStepHeading()).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollContainer.scrollTop).toBe(640);
    expect(document.activeElement).toBe(stepHeading);
  });

  it("preserves the selected setup-path control and current scroll position", () => {
    document.body.innerHTML = `
      <div class="screen-scroll-area">
        <button id="background-step">Background</button>
        <h2 id="${PROFILE_SETUP_STEP_HEADING_ID}" tabindex="-1">Background setup step</h2>
      </div>
    `;
    const scrollContainer = document.querySelector<HTMLElement>(
      ".screen-scroll-area",
    );
    const selectedStep = document.getElementById("background-step");

    if (!scrollContainer || !selectedStep) {
      throw new Error("Expected the setup path test fixture to render");
    }

    const scrollTo = vi.fn();
    scrollContainer.scrollTop = 720;
    scrollContainer.scrollTo = scrollTo;
    selectedStep.focus();

    expect(focusProfileSetupStepHeading()).toBe(false);
    expect(document.activeElement).toBe(selectedStep);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollContainer.scrollTop).toBe(720);
  });

  it("does nothing when the setup step is not mounted", () => {
    expect(focusProfileSetupStepHeading()).toBe(false);
  });
});

it("moves from Save and continue to the next step heading and scrolls it into view", () => {
  document.body.innerHTML = `<button>Save and continue</button><h2 id="${PROFILE_SETUP_STEP_HEADING_ID}" tabindex="-1">Job targets</h2>`;
  document.querySelector("button")!.focus();
  const heading = document.querySelector("h2")!;
  const scrollIntoView = vi.fn();
  heading.scrollIntoView = scrollIntoView;
  expect(focusProfileSetupStepHeading(document, true)).toBe(true);
  expect(document.activeElement).toBe(heading);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
});
