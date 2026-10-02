import { describe, expect, test } from "vitest";

import { createPreferences, createProfile } from "../test-fixtures";
import { buildDeterministicResumeProfileExtraction } from "./resume-parser";

function parse(text: string) {
  return buildDeterministicResumeProfileExtraction(
    {
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: text,
    },
    "deterministic",
    "Test",
    { preserveExistingValues: false },
  );
}

const junior = `Taylor Example
Columbus, OH, United States
taylor@example.test
Objective
Seeking an Information Systems Analyst role with practical training.
Experience
Harbor Networks
Network Administrator Co-op
<START DATE> - <END DATE>
- Configured office routers and supported network troubleshooting.
Self-employed
Website Designer
<START DATE> - <END DATE>
- Built accessible websites for fictional local businesses.
Cedar Systems
Information Systems Co-op
<START DATE> - <END DATE>
- Maintained inventory records and assisted the help desk.
Activities
Student House
House Manager
2024 - Present
- Organized extracurricular events for student residents.
Education
Cedar State University — Bachelor's Degree in Information Systems
Skills
Network troubleshooting, Microsoft Excel`;

describe("resume import usability regressions", () => {
  test("N-019 keeps three IT roles, uses the objective, and leaves placeholder dates uncertain", () => {
    const result = parse(junior);
    expect(result.experiences.map((entry) => entry.title)).toEqual([
      "Network Administrator Co-Op",
      "Website Designer",
      "Information Systems Co-Op",
    ]);
    expect(
      result.experiences.every(
        (entry) =>
          entry.startDate === null &&
          entry.endDate === null &&
          !entry.isCurrent,
      ),
    ).toBe(true);
    expect(result.headline).toBe("Network Administrator Co-Op");
    expect(result.targetRoles).toEqual(["Information Systems Analyst"]);
    expect(result.education).toHaveLength(1);
  });

  test.each([
    "Activities",
    "Extracurricular",
    "Extracurricular Activities",
    "Volunteer Experience",
  ])("N-019 ends employment at %s", (heading) => {
    expect(
      parse(junior.replace("Activities", heading)).experiences,
    ).toHaveLength(3);
  });

  test("N-043.1 stops skills at work preferences", () => {
    expect(
      parse(
        "Skills\nMicrosoft Excel, Customer service\nWork preferences\nFull-time\nUSD 70,000 minimum",
      ).skills,
    ).toEqual(["Microsoft Excel", "Customer service"]);
  });

  test("N-043.2 parses each qualification once without mixing adjacent entries", () => {
    const result = parse(
      "Education\nCedar Community College — Associate of Applied Science in Business Administration, 2021\nMaple State University\nBachelor's Degree in Accounting\n2022 - 2025",
    );
    expect(result.education).toEqual([
      expect.objectContaining({
        schoolName: "Cedar Community College",
        degree: "Associate of Applied Science",
        fieldOfStudy: "Business Administration",
        endDate: "2021",
      }),
      expect.objectContaining({
        schoolName: "Maple State University",
        degree: "Bachelor's Degree",
        fieldOfStudy: "Accounting",
        startDate: "2022",
        endDate: "2025",
      }),
    ]);
  });

  test("N-043.3 preserves the entire three-part contact location", () => {
    expect(
      parse(
        "Taylor Example\nColumbus, OH, United States | taylor@example.test\nExperience",
      ).currentLocation,
    ).toBe("Columbus, OH, United States");
  });

  test.each([
    "Operations Coordinator at Cedar Services",
    "Operations Coordinator, Cedar Services",
  ])("N-043.4 separates title and employer: %s", (heading) => {
    const result = parse(
      `Taylor Example\nExperience\n${heading}\n2021 - 2025\n- Scheduled deliveries and maintained customer records.`,
    );
    expect(result.experiences[0]).toMatchObject({
      title: "Operations Coordinator",
      companyName: "Cedar Services",
    });
    expect(result.targetRoles).toEqual(["Operations Coordinator"]);
  });

  test("N-043.7 excludes footer, disclaimer, and preference lines from languages", () => {
    const result = parse(
      "Languages\nEnglish - fluent\nSpanish - conversational\nPage 1 - Resume of Taylor Example\nDisclaimer - This document is for review only.\nWork preferences\nFull-time - USD 70,000 minimum",
    );
    expect(result.spokenLanguages.map((entry) => entry.language)).toEqual([
      "English",
      "Spanish",
    ]);
  });

  test("N-043.8 retains listed multi-word skills in every group", () => {
    const result = parse(
      "Skills\nMicrosoft Excel, Customer service, React Native",
    );
    expect(result.skills).toEqual([
      "Microsoft Excel",
      "Customer service",
      "React Native",
    ]);
    expect(result.skillGroups.coreSkills).toEqual(result.skills);
  });

  test("N-043.9 never uses a location row as a job or search target", () => {
    const result = parse(
      "Taylor Example\nExperience\nColumbus, OH, United States\nOperations Coordinator at Cedar Services\n2021 - 2025\n- Scheduled deliveries and maintained customer records.",
    );
    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0]?.title).toBe("Operations Coordinator");
    expect(result.targetRoles).toEqual(["Operations Coordinator"]);
  });

  test("N-043.10 keeps two dated certificates as two source items", () => {
    expect(
      parse(
        "Certifications\nService Foundations — Cedar Training (2022)\nRecords Management — Maple Institute (2023)",
      ).certifications,
    ).toEqual([
      expect.objectContaining({
        name: "Service Foundations",
        issuer: "Cedar Training",
        issueDate: "2022",
      }),
      expect.objectContaining({
        name: "Records Management",
        issuer: "Maple Institute",
        issueDate: "2023",
      }),
    ]);
  });

  test("N-043.10 keeps project technologies and URLs with their own project", () => {
    const result = parse(
      "Projects\nInventory Tracker\nTechnologies: Microsoft Excel\n- Created an inventory workbook for a fictional community center.\nhttps://example.test/inventory\nVolunteer Scheduler\nTechnologies: Microsoft Access\n- Built a shift schedule for a fictional volunteer group.\nhttps://example.test/scheduler",
    );
    expect(result.projects).toEqual([
      expect.objectContaining({
        name: "Inventory Tracker",
        skills: ["Microsoft Excel"],
        projectUrl: "https://example.test/inventory",
      }),
      expect.objectContaining({
        name: "Volunteer Scheduler",
        skills: ["Microsoft Access"],
        projectUrl: "https://example.test/scheduler",
      }),
    ]);
    expect(result.projects[0]?.summary).not.toContain("Scheduler");
    expect(result.projects[1]?.summary).not.toContain("inventory");
  });
});

describe("resume import review regressions", () => {
  test("a spelled-out credential after a dash is not read as the issuer", () => {
    const result = parse(
      "Jordan Example\nCertifications\nPMP - Project Management Professional\nGoogle Data Analytics - Coursera",
    );
    const byName = new Map(
      result.certifications.map((entry) => [entry.name, entry.issuer]),
    );
    expect(byName.has("PMP - Project Management Professional")).toBe(true);
    expect(byName.get("PMP - Project Management Professional")).toBeNull();
    expect(byName.get("Google Data Analytics")).toBe("Coursera");
  });

  test("a job at a university is not education when the resume has no Education section", () => {
    const result = parse(
      [
        "Jordan Example",
        "Experience",
        "Research Assistant, Synthetic State University",
        "2019 - 2021",
        "- Supported a Master of Science cohort with lab scheduling.",
        "Lab Coordinator, Example Institute",
        "2021 - Present",
        "- Ran weekly safety checks.",
      ].join("\n"),
    );
    expect(result.education.length).toBeLessThanOrEqual(1);
  });

  test.each([
    ["Microsoft Excel, Google Sheets", ["Microsoft Excel", "Google Sheets"]],
    ["Proficient in Python, SQL and Tableau", ["Python", "SQL", "Tableau"]],
    ["Tools: Figma, Adobe XD", ["Figma", "Adobe XD"]],
    ["Experience with React Native and Python", ["React Native", "Python"]],
    ["Familiar with SQL or Python", ["SQL", "Python"]],
    [
      "Health and Safety, Sales and Marketing",
      ["Health and Safety", "Sales and Marketing"],
    ],
  ])("extracts list items or known phrases from %s", (line, expected) => {
    const result = parse(`Skills\n${line}`);
    expect(result.skills).toEqual(expected);
    expect(result.skillGroups.coreSkills).toEqual(result.skills);
  });

  test.each([
    ["Senior Engineer, Acme Corp", "Senior Engineer", "Acme Corp"],
    [
      "Engineering Manager, Platform\nAcme Corp",
      "Engineering Manager, Platform",
      "Acme Corp",
    ],
    ["Senior Engineer at Acme", "Senior Engineer", "Acme"],
  ])("uses company context for %s", (header, title, companyName) => {
    const result = parse(
      `Taylor Example\nExperience\n${header}\n2021 - 2025\n- Delivered a fictional platform.`,
    );
    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0]).toMatchObject({ title, companyName });
    expect(result.targetRoles).toEqual([title]);
  });
});

test.each([
  [
    "Associate of Applied Science in Supply Chain Management, 2018",
    "Associate of Applied Science",
    "Supply Chain Management",
    "2018",
  ],
  ["BSc Computer Science 2016", "BSc Computer Science", null, "2016"],
])(
  "education moves the qualification's trailing year into the date: %s",
  (qualification, degree, fieldOfStudy, endDate) => {
    const result = parse(
      `Education\nColumbus State Community College\n${qualification}`,
    );
    expect(result.education).toHaveLength(1);
    expect(result.education[0]).toMatchObject({
      schoolName: "Columbus State Community College",
      degree,
      fieldOfStudy,
      endDate,
    });
  },
);
