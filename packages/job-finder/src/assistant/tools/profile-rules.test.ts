import { ProfileCopilotPatchOperationSchema } from "@unemployed/contracts";
import { describe, expect, it } from "vitest";

import { PROFILE_EDITING_RULES } from "./profile-tools";

describe("profile editing rules", () => {
  it("shows the model only operation shapes that validate", () => {
    const examples = [
      ...PROFILE_EDITING_RULES.matchAll(
        /\{"operation":[^;]*?\}(?=[;.] |\s\(|\.$)/gu,
      ),
    ].map((match) => match[0]);
    expect(examples.length).toBeGreaterThanOrEqual(7);
    for (const example of examples) {
      const parsed = ProfileCopilotPatchOperationSchema.safeParse(
        JSON.parse(example),
      );
      expect(parsed.success, example).toBe(true);
    }
  });
});
