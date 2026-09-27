import { describe, expect, it, vi } from "vitest";
import {
  formatProfileSetupFinishReadiness,
  getProfileSetupStepFooterContinue,
  getProfileSetupStepFooterPrimary,
} from "./profile-setup-step-footer";

describe("getProfileSetupStepFooterPrimary", () => {
  it("keeps Save and continue as the primary action on Essentials", () => {
    const onSaveAndGoToStep = vi.fn();
    const primary = getProfileSetupStepFooterPrimary({
      canFinishSetup: false,
      currentStep: "essentials",
      onSaveAndFinish: vi.fn(),
      onSaveAndGoToStep,
    });

    expect(primary).toMatchObject({
      disabled: false,
      label: "Save and continue to Work history",
    });
    primary.onPrimary?.();
    expect(onSaveAndGoToStep).toHaveBeenCalledWith("background");
  });

  it("gates Finish until setup is materially complete", () => {
    const onSaveAndFinish = vi.fn();
    const blocked = getProfileSetupStepFooterPrimary({
      canFinishSetup: false,
      currentStep: "extras",
      onSaveAndFinish,
      onSaveAndGoToStep: vi.fn(),
    });
    expect(blocked).toMatchObject({
      disabled: true,
      label: "Finish setup and find jobs",
      onPrimary: null,
    });

    const ready = getProfileSetupStepFooterPrimary({
      canFinishSetup: true,
      currentStep: "extras",
      onSaveAndFinish,
      onSaveAndGoToStep: vi.fn(),
    });
    expect(ready.disabled).toBe(false);
    expect(ready.label).toBe("Finish setup and find jobs");
    ready.onPrimary?.();
    expect(onSaveAndFinish).toHaveBeenCalledTimes(1);
  });

  it("offers Finish from Job targets, the last required step", () => {
    const onSaveAndFinish = vi.fn();
    const primary = getProfileSetupStepFooterPrimary({
      canFinishSetup: true,
      currentStep: "targeting",
      onSaveAndFinish,
      onSaveAndGoToStep: vi.fn(),
    });

    expect(primary.label).toBe("Finish setup and find jobs");
    primary.onPrimary?.();
    expect(onSaveAndFinish).toHaveBeenCalledTimes(1);
  });

  it("resolves a retired stored step onto the step that owns its content", () => {
    const onSaveAndFinish = vi.fn();

    expect(
      getProfileSetupStepFooterPrimary({
        canFinishSetup: true,
        currentStep: "ready_check",
        onSaveAndFinish,
        onSaveAndGoToStep: vi.fn(),
      }).label,
    ).toBe("Finish setup and find jobs");
    expect(
      getProfileSetupStepFooterPrimary({
        canFinishSetup: false,
        currentStep: "narrative",
        onSaveAndFinish,
        onSaveAndGoToStep: vi.fn(),
      }).label,
    ).toBe("Finish setup and find jobs");
  });
});

describe("getProfileSetupStepFooterContinue", () => {
  it("keeps Save and continue to Extras once Finish takes the primary slot", () => {
    // The finish action replaced the continue action mid-step, so a button
    // read as "Save and continue to Extras" and then opened Find jobs.
    const onSaveAndGoToStep = vi.fn();
    const continueAction = getProfileSetupStepFooterContinue({
      canFinishSetup: true,
      currentStep: "targeting",
      onSaveAndGoToStep,
    });

    expect(continueAction?.label).toBe("Save and continue to Extras");
    continueAction?.onContinue();
    expect(onSaveAndGoToStep).toHaveBeenCalledWith("extras");
  });

  it("offers no second continue action where the primary already continues", () => {
    expect(
      getProfileSetupStepFooterContinue({
        canFinishSetup: false,
        currentStep: "targeting",
        onSaveAndGoToStep: vi.fn(),
      }),
    ).toBeNull();
    expect(
      getProfileSetupStepFooterContinue({
        canFinishSetup: true,
        currentStep: "extras",
        onSaveAndGoToStep: vi.fn(),
      }),
    ).toBeNull();
    expect(
      getProfileSetupStepFooterContinue({
        canFinishSetup: false,
        currentStep: "essentials",
        onSaveAndGoToStep: vi.fn(),
      }),
    ).toBeNull();
  });
});

describe("formatProfileSetupFinishReadiness", () => {
  it("collapses a long run of imported-detail reviews into one count per step", () => {
    // Twenty-three "Confirm ..." items used to print in full and push the
    // step's form off screen. Real blockers stay named; review items become
    // one line per step, because the step itself lists them.
    const confirms = Array.from(
      { length: 20 },
      (_, index) => `Confirm acme field ${index + 1}`,
    );
    expect(
      formatProfileSetupFinishReadiness({
        canFinishSetup: false,
        remainingBlockerLabels: [
          "Add a job source (Job targets step)",
          ...confirms,
          "Fill in bluebird title (Basics step)",
          "Confirm bluebird company (Basics step)",
        ],
      }),
    ).toBe(
      "Still needed to finish: Add a job source (Job targets step) · Review 20 imported details on this step · Review 2 imported details (Basics step).",
    );
    // Three or fewer stay named in full, whatever they are.
    expect(
      formatProfileSetupFinishReadiness({
        canFinishSetup: false,
        remainingBlockerLabels: [
          "Confirm acme company",
          "Confirm acme title",
          "Confirm acme start date",
        ],
      }),
    ).toBe(
      "Still needed to finish: Confirm acme company · Confirm acme title · Confirm acme start date.",
    );
  });

  it("names what is missing instead of publishing a second count", () => {
    expect(
      formatProfileSetupFinishReadiness({
        canFinishSetup: false,
        remainingBlockerLabels: ["Add work history"],
      }),
    ).toBe("Still needed to finish: Add work history.");
    expect(
      formatProfileSetupFinishReadiness({
        canFinishSetup: true,
        remainingBlockerLabels: [],
      }),
    ).toBe("Everything required is in. You can finish setup.");
  });
});
