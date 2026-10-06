import { expect, it } from "vitest";
import { PROFILE_WORK_CONSTRAINT_COPY } from "./profile-work-constraints-copy";
it("points limited work permits to Work eligibility", () => {
  expect(
    PROFILE_WORK_CONSTRAINT_COPY.authorizedWorkCountries.description,
  ).toContain("under Work eligibility");
});
