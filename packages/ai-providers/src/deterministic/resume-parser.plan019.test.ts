import { describe, expect, test } from "vitest";

import { createPreferences, createProfile } from "../test-fixtures";
import { buildDeterministicResumeProfileExtraction } from "./resume-parser";

describe("plan 019 deterministic resume parser regressions", () => {
  test("reads the generated PDF contact location and excludes inline skill labels", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Alex Vanguard",
          "Senior systems designer",
          "London, UK alex@example.com +44 7700 900123 linkedin.com/in/alex-vanguard",
          "SUMMARY",
          "Builds resilient workflows for design systems, workflow automation, and operations platforms.",
          "SKILLS",
          "Core: React, Design Systems, Figma",
          "EXPERIENCE",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.currentLocation).toBe("London, UK");
    expect(extraction.preferredLocations).toEqual(["London, UK"]);
    expect(extraction.skills).toEqual(
      expect.arrayContaining(["React", "Design Systems", "Figma"]),
    );
    expect(extraction.skills).not.toContain("Core: React");
    expect(extraction.skillGroups.coreSkills).not.toContain("Core: React");
  });

  test("never uses a comma-separated skills line as a missing contact location", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Alex Vanguard",
          "Senior systems designer",
          "SKILLS",
          "Core: React, Design Systems, Figma",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.currentLocation).toBeNull();
    expect(extraction.preferredLocations).toEqual([]);
  });

  test("extracts a name from inline contact header content", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Tampa, FL",
          "Aaron Murphy +1 615-378-5538",
          "murphyaron12@gmail.com",
          "Senior Software Engineer linkedin.com/in/amurp",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.fullName).toBe("Aaron Murphy");
    expect(extraction.currentLocation).toBe("Tampa, FL");
    expect(extraction.headline).toBe("Senior Software Engineer");
  });

  test("extracts a location when it shares a line with the candidate name", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "+1 650-353-7911",
          "Ryan Holstien Cedar Park, TX 78613",
          "linkedin.com/in/ryan-holstien-7954b665",
          "Senior Software Engineer ryanholstien993@outlook.com",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.fullName).toBe("Ryan Holstien");
    expect(extraction.currentLocation).toBe("Cedar Park, TX 78613");
    expect(extraction.headline).toBe("Senior Software Engineer");
  });

  test("does not misread summary fragments as a person name on hard resumes", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "+1 650-353-7911",
          "Ryan Holstien Cedar Park, TX 78613",
          "linkedin.com/in/ryan-holstien-7954b665",
          "Senior Software Engineer ryanholstien993@outlook.com",
          "Senior Software Engineer with 10+ years of experience building secure, scalable healthcare and SaaS platforms.",
          "Technical Mentorship",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.fullName).toBe("Ryan Holstien");
    expect(extraction.firstName).toBe("Ryan");
    expect(extraction.lastName).toBe("Holstien");
  });

  test("prefers header location lines before summary prose", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Philadelphia, PA · (530) 213-3550",
          "paul.asselin454@outlook.com",
          "Paul Asselin",
          "linkedin.com/in/paul-asselin",
          "Summary",
          "Senior Software Engineer with 7+ years building scalable web platforms across fintech and education financing.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.fullName).toBe("Paul Asselin");
    expect(extraction.currentLocation).toBe("Philadelphia, PA");
  });

  test("extracts a location from a pipe-delimited contact line", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Casey Rowan",
          "casey.rowan@example.test | +1 555 010 8420 | Portland, Oregon",
          "Senior Frontend Engineer",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.currentLocation).toBe("Portland, Oregon");
  });

  test("parses company-first experience headers with separate date lines", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Aaron Murphy",
          "Tampa, FL",
          "EXPERIENCE",
          "EdSights, Remote, NY — Staff/Senior Software Engineer",
          "Sep 2021 – Feb 2026",
          "Led the design and implementation of scalable cloud-native applications.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences[0]).toMatchObject({
      companyName: "EdSights",
      title: "Staff/Senior Software Engineer",
      location: "Remote, NY",
      startDate: "Sep 2021",
      endDate: "Feb 2026",
    });
  });
});
