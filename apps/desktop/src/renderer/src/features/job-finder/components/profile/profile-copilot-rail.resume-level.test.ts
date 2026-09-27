import { describe, expect, it } from "vitest";
import { describePatchOperation } from "./profile-copilot-rail.shared";

describe("describePatchOperation for the resume level", () => {
  // The Assistant can now move a person onto or off Original. Without its own
  // wording the card read "Update profile data", which says nothing about a
  // choice that decides what every new application sends.
  it("names the level the way Settings > AI behavior > Resumes does", () => {
    expect(
      describePatchOperation({
        operation: "set_resume_approach",
        value: "conservative",
      }),
    ).toBe("Resume level for new jobs: Light (small edits, every fact kept)");
    expect(
      describePatchOperation({
        operation: "set_resume_approach",
        value: "original_resume",
      }),
    ).toBe(
      "Resume level for new jobs: Original (your imported file, unchanged)",
    );
  });
});
