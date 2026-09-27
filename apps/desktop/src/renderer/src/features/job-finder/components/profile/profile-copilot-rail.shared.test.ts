import { describe, expect, it } from "vitest";
import { getProfileCopilotContextLabel } from "./profile-copilot-rail.shared";

describe("getProfileCopilotContextLabel", () => {
  it("names setup steps the way the step tabs do", () => {
    // The Assistant panel on the Basics step read "Setup - Essentials" and on
    // Job targets "Setup - Targeting", names the person never sees elsewhere.
    expect(
      getProfileCopilotContextLabel({ surface: "setup", step: "essentials" }),
    ).toBe("Setup - Basics");
    expect(
      getProfileCopilotContextLabel({ surface: "setup", step: "background" }),
    ).toBe("Setup - Work history");
    expect(
      getProfileCopilotContextLabel({ surface: "setup", step: "targeting" }),
    ).toBe("Setup - Job targets");
  });

  it("keeps the Profile tab names", () => {
    expect(
      getProfileCopilotContextLabel({ surface: "profile", section: "basics" }),
    ).toBe("Profile - Basics");
    expect(
      getProfileCopilotContextLabel({
        surface: "profile",
        section: "preferences",
      }),
    ).toBe("Profile - Preferences");
  });
});
