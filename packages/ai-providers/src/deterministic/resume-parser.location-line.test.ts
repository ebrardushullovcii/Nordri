import { describe, expect, test } from "vitest";
import { createPreferences, createProfile } from "../test-fixtures";
import { buildDeterministicResumeProfileExtraction } from "./resume-parser";

describe("experience location-only detail line", () => {
  test("a place under the dates is the role's location, never its summary", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Morgan Lee",
          "morgan.lee@example.com",
          "",
          "EXPERIENCE",
          "Senior Backend Engineer",
          "Acme Payments",
          "Mar 2021 - Present",
          "Lisbon, Portugal",
          "- Led the migration of the settlement service from a monolith to Go microservices.",
          "- Cut nightly reconciliation time from 4 hours to 35 minutes.",
          "",
          "Backend Engineer",
          "Northwind Data",
          "Jun 2018 - Feb 2021",
          "Owned the ingestion platform for forty retail customers.",
          "- Built ingestion pipelines in Python.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );
    const [acme, northwind] = extraction.experiences;
    expect(acme?.summary).toBeNull();
    expect(acme?.location).toBe("Lisbon, Portugal");
    expect(acme?.achievements).toHaveLength(2);
    expect(northwind?.summary).toBe(
      "Owned the ingestion platform for forty retail customers.",
    );
  });
});
