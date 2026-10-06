import { expect, test } from "vitest";
import { submissionConfirmationSummary } from "./submission-confirmation";
test("keeps the site's labelled confirmation reference without inventing one", () => {
  expect(
    submissionConfirmationSummary("Application received. Reference: SYN-105"),
  ).toBe("The site confirmed receipt. Reference: SYN-105.");
  expect(
    submissionConfirmationSummary(
      "Thanks for applying. Confirmation number: ABC_25",
    ),
  ).toContain("ABC_25");
  expect(submissionConfirmationSummary("Thank you for applying")).not.toContain(
    "Reference:",
  );
});
