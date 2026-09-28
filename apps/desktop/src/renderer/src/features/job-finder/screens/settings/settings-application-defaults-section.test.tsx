// @vitest-environment jsdom

import type {
  JobFinderSettings,
  UpdateApplicationDefaultsInput,
} from "@nordri/contracts";
import { JobFinderSettingsSchema } from "@nordri/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsApplicationDefaultsSection } from "./settings-application-defaults-section";

function parseSettings(
  overrides: Partial<JobFinderSettings> = {},
): JobFinderSettings {
  return JobFinderSettingsSchema.parse({
    allowAutoSubmitOverride: false,
    fontPreset: "inter_requisite",
    humanReviewRequired: true,
    keepSessionAlive: false,
    resumeFormat: "pdf",
    resumeTemplateId: "classic_ats",
    ...overrides,
  });
}

function chooseDisplayFont() {
  fireEvent.keyDown(screen.getByLabelText("Resume font"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Display sans" }));
}

describe("SettingsApplicationDefaultsSection", () => {
  beforeEach(() => {
    // jsdom has no layout, and the select popup scrolls its active item.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("owns only the look of a tailored resume; the approach lives under AI behavior", () => {
    render(
      <SettingsApplicationDefaultsSection
        availableResumeTemplates={[]}
        onUpdateApplicationDefaults={vi.fn()}
        settings={parseSettings()}
      />,
    );

    expect(screen.getByText("Resume look")).toBeTruthy();
    expect(screen.getByText(/set under AI behavior/)).toBeTruthy();
    expect(
      screen.queryByRole("radio", { name: /Use my original resume unchanged/ }),
    ).toBeNull();
    expect(
      screen.getByRole("group", { name: "Default resume template" }),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save resume look",
      }).disabled,
    ).toBe(true);
  });

  it("sends only template and font and reports saved status", async () => {
    const onUpdateApplicationDefaults = vi.fn<
      (input: UpdateApplicationDefaultsInput) => Promise<void>
    >(() => Promise.resolve());
    render(
      <SettingsApplicationDefaultsSection
        availableResumeTemplates={[]}
        onUpdateApplicationDefaults={onUpdateApplicationDefaults}
        settings={parseSettings()}
      />,
    );

    chooseDisplayFont();
    expect(
      screen.getByText("You have unsaved resume look changes."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save resume look",
      }),
    );

    await waitFor(() =>
      expect(onUpdateApplicationDefaults).toHaveBeenCalledTimes(1),
    );
    expect(onUpdateApplicationDefaults).toHaveBeenCalledWith({
      fontPreset: "space_grotesk_display",
      resumeTemplateId: "classic_ats",
    });
    await waitFor(() =>
      expect(
        screen.getByText("Resume look saved."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("No unsaved changes.")).toBeNull();
  });

  it("resets staged drafts when the persisted settings prop refreshes", () => {
    const onUpdateApplicationDefaults = vi.fn<
      (input: UpdateApplicationDefaultsInput) => Promise<void>
    >(() => Promise.resolve());
    const view = render(
      <SettingsApplicationDefaultsSection
        availableResumeTemplates={[]}
        onUpdateApplicationDefaults={onUpdateApplicationDefaults}
        settings={parseSettings()}
      />,
    );

    chooseDisplayFont();
    expect(
      screen.getByText("You have unsaved resume look changes."),
    ).toBeTruthy();

    view.rerender(
      <SettingsApplicationDefaultsSection
        availableResumeTemplates={[]}
        onUpdateApplicationDefaults={onUpdateApplicationDefaults}
        settings={parseSettings({ fontPreset: "space_grotesk_display" })}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Save resume look",
      }).disabled,
    ).toBe(true);
    expect(
      screen.queryByText("You have unsaved resume look changes."),
    ).toBeNull();
  });
});
