import { describe, expect, test } from "vitest";
import {
  createJobPosting,
  createPreferences,
  createProfile,
  createSettings,
} from "../test-fixtures";
import { buildDeterministicResumeProfileExtraction } from "./resume-parser";
import { EBRAR_IMPORTED_TEXT } from "../resume-import-fixtures";
import { buildDeterministicTailoredResume } from "./tailoring";

describe("buildDeterministicResumeProfileExtraction", () => {
  test.each(["WORK ELIGIBILITY", "Work authorization:", "RIGHT TO WORK"])(
    "keeps semicolon-separated nontechnical skills and stops before %s",
    (heading) => {
      const skills = [
        "Guest service",
        "reservation management",
        "telephone support",
        "complaint resolution",
        "cash handling",
      ];
      const extraction = buildDeterministicResumeProfileExtraction(
        {
          existingProfile: createProfile(),
          existingSearchPreferences: createPreferences(),
          resumeText: [
            "Morgan Ellis",
            "SKILLS",
            skills.join("; "),
            heading,
            "Authorized to work in Canada.",
          ].join("\n"),
        },
        "deterministic",
        "Test provider",
      );

      expect(extraction.skills).toEqual(skills);
      expect(extraction.skillGroups.coreSkills).toEqual(skills);
      expect(extraction.skills).not.toContain(heading);
    },
  );

  test("uses ABOUT ME content as the summary body", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ebrar Dushullovci",
          "Address: Prishtina, Kosovo (Home)",
          "ABOUT ME",
          "A passionate software developer with 6+ years of full-stack experience building impactful solutions using React, Next.js,",
          "Node.js, .NET Core, SQL Server and AWS/Azure.",
          "WORK EXPERIENCE",
          "AUTOMATEDPROS – PRISHTINA, KOSOVO",
          "SENIOR FULL-STACK SOFTWARE ENGINEER – 07/2023 – Current",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.summary).toContain(
      "A passionate software developer with 6+ years of full-stack experience",
    );
    expect(extraction.summary).toContain("AWS/Azure");
    expect(extraction.currentLocation).toBe("Prishtina, Kosovo");
  });

  test("captures wrapped intro summaries and 10+ years markers from real-style header text", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ryan Holstien",
          "+1 650-353-7911",
          "Cedar Park, TX 78613",
          "linkedin.com/in/ryan-holstien-7954b665",
          "Senior Software Engineer",
          "ryanholstien993@outlook.com",
          "Senior Software Engineer with 10+ years of experience building secure, scalable healthcare and SaaS platforms with C#,.NET, ASP.NET Core, REST APIs, MongoDB, SQL Server, and cloud-native services on Azure and AWS. Proven record",
          "delivering microservices, third-party integrations, CI/CD automation, observability, and production support in Agile teams.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.headline).toBe("Senior Software Engineer");
    expect(extraction.summary).toContain("10+ years of experience");
    expect(extraction.summary).toContain("delivering microservices");
    expect(extraction.yearsExperience).toBe(10);
  });

  test("derives years of experience from dated work history when the summary does not state it explicitly", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Aaron Murphy",
          "Tampa, FL",
          "Senior Software Engineer",
          "PROFESSIONAL SUMMARY",
          "Experienced Staff Engineer with a focus on leading complex, high-impact initiatives across full-stack systems.",
          "EXPERIENCE",
          "EdSights, Remote, NY — Staff/Senior Software Engineer",
          "Sep 2021 – Feb 2026",
          "Agile Thought, Tampa, FL — Senior Software Developer",
          "Jul 2019 - Sep 2021",
          "Agile Thought, Tampa, FL — Software Developer",
          "Sep 2016 - Jul 2019",
          "Three Five Two, Tampa, FL — Software Developer",
          "Jun 2015 - Aug 2016",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.yearsExperience).toBe(10);
  });

  test("returns null for inferred years of experience when coverage is under one year", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Avery Stone",
          "Product Designer",
          "EXPERIENCE",
          "Northwind Labs — Product Designer",
          "Jan 2025 - Jun 2025",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.yearsExperience).toBeNull();
  });

  test("does not treat leading experience content as a summary fallback", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Jordan Avery",
          "Senior Software Engineer",
          "EXPERIENCE",
          "Signal Systems — Senior Software Engineer",
          "Jan 2021 - Present",
          "Led platform migration work across shared services.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.summary).toBeNull();
  });

  test("does not infer a collaborator's profession as an experience skill", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Casey Rowan",
          "Senior Frontend Engineer",
          "EXPERIENCE",
          "Cedar Ledger — Frontend Engineer",
          "June 2018 - February 2021",
          "- Built account-management workflows with React, GraphQL, and Node.js.",
          "- Partnered with product designers to improve form completion and error recovery.",
          "SKILLS",
          "React, TypeScript, GraphQL, Node.js",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences[0]?.skills).toEqual(
      expect.arrayContaining(["React", "GraphQL", "Node.js"]),
    );
    expect(extraction.experiences[0]?.skills).not.toContain("Product Design");
  });

  test("keeps explicit work modes and grounded job-scoped skills on the matching experience", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "CASEY ROWAN",
          "Senior Frontend Engineer",
          "casey.rowan@example.test | +1 555 010 2401 | Portland, Oregon",
          "SUMMARY",
          "Frontend engineer with eight years of experience building accessible web applications and design systems for logistics and financial-services teams. Strong in React, TypeScript, testing, performance, and mentoring.",
          "EXPERIENCE",
          "Senior Frontend Engineer — Northstar Parcel Software",
          "March 2021–Present | Portland, Oregon",
          "- Led a React and TypeScript shipment-tracking redesign used by 18 internal operations teams.",
          "- Reduced median page-load time from 4.2 seconds to 1.9 seconds by splitting bundles and removing duplicate requests.",
          "- Built an accessible component library with Storybook and automated axe checks.",
          "- Mentored four engineers and introduced Vitest integration tests for critical workflows.",
          "Frontend Engineer — Cedar Ledger",
          "June 2018–February 2021 | Remote",
          "- Built account-management workflows with React, GraphQL, and Node.js.",
          "- Partnered with product designers to improve form completion and error recovery.",
          "EDUCATION",
          "Bachelor of Science in Computer Science — Oregon State University, 2018",
          "SKILLS",
          "React, TypeScript, JavaScript, HTML, CSS, GraphQL, Node.js, Vitest, Playwright, Storybook, accessibility, performance optimization",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences).toHaveLength(2);

    const northstar = extraction.experiences.find(
      (experience) => experience.companyName === "Northstar Parcel Software",
    );
    const cedar = extraction.experiences.find(
      (experience) => experience.companyName === "Cedar Ledger",
    );

    expect(northstar).toMatchObject({
      title: "Senior Frontend Engineer",
      location: "Portland, Oregon",
      workMode: [],
    });
    expect(northstar?.achievements).toHaveLength(4);
    expect(northstar?.skills).toEqual(
      expect.arrayContaining([
        "React",
        "TypeScript",
        "Storybook",
        "Vitest",
        "Accessibility",
        "axe",
        "Performance Optimization",
      ]),
    );

    expect(cedar).toMatchObject({
      title: "Frontend Engineer",
      location: "Remote",
      workMode: ["remote"],
    });
    expect(cedar?.achievements).toHaveLength(2);
    expect(cedar?.skills).toEqual(
      expect.arrayContaining(["React", "GraphQL", "Node.js"]),
    );
    expect(cedar?.skills).not.toEqual(
      expect.arrayContaining([
        "Storybook",
        "Vitest",
        "Performance Optimization",
      ]),
    );
  });
  test("derives years of experience from single-digit slash month ranges", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Jordan Avery",
          "Senior Software Engineer",
          "EXPERIENCE",
          "Signal Systems — Senior Software Engineer",
          "7/2023 - Present",
          "Northwind Labs — Software Engineer",
          "6/2021 - 6/2023",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      {
        preserveExistingValues: false,
        now: new Date("2026-02-01T00:00:00Z"),
      },
    );

    expect(extraction.yearsExperience).toBe(4);
  });

  test("parses day-month-year slash ranges without dropping completed roles", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "WORK EXPERIENCE",
          "SENIOR FULL-STACK SOFTWARE ENGINEER – AUTOMATEDPROS – 01/07/2023 – Current – REMOTE, KOSOVO",
          "• Engineered a real-time restaurant order platform with React and Next.js.",
          "SENIOR FULL-STACK SOFTWARE ENGINEER (PART-TIME CONSULTANT) – INFOTECH L.L.C – 01/11/2021 – Current – REMOTE, KOSOVO",
          "• Provide on-call architecture and performance triage.",
          "CHIEF EXPERIENCE OFFICER – AUTOMATEDPROS – 01/11/2021 – 30/06/2023 – REMOTE, KOSOVO",
          "• Led and oversaw customer experience initiatives.",
          "FULL-STACK SOFTWARE ENGINEER – CREA-KO – 01/12/2018 – 31/07/2019 – PRISHTINA, KOSOVO",
          "• Assisted in migrating a web-based ERP system from .NET Framework to .NET Core MVC.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences).toHaveLength(4);
    expect(extraction.experiences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Senior Full-Stack Software Engineer",
          companyName: "AUTOMATEDPROS",
          startDate: "01/07/2023",
          isCurrent: true,
        }),
        expect.objectContaining({
          title: "Chief Experience Officer",
          companyName: "AUTOMATEDPROS",
          startDate: "01/11/2021",
          endDate: "30/06/2023",
        }),
        expect.objectContaining({
          title: "Senior Full-Stack Software Engineer (Part-Time Consultant)",
          companyName: "INFOTECH L.L.C",
          startDate: "01/11/2021",
          isCurrent: true,
        }),
        expect.objectContaining({
          title: "Full-Stack Software Engineer",
          companyName: "CREA-KO",
          startDate: "01/12/2018",
          endDate: "31/07/2019",
        }),
      ]),
    );
  });

  test("uses the primary current role instead of a nested project heading as the headline", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ebrar Dushullovci",
          "Address: Prishtina, Kosovo (Home)",
          "ABOUT MYSELF",
          "A full-stack developer focused on production automation systems.",
          "WORK EXPERIENCE",
          "SENIOR FULL-STACK SOFTWARE ENGINEER – AUTOMATEDPROS – 01/07/2023 – Current – REMOTE, KOSOVO",
          "• Engineered a real-time restaurant order platform.",
          "Project Lead (React, Next.js) – QA Management System",
          "• Developed a QA Management System with React and Next.js.",
          "SENIOR FULL-STACK SOFTWARE ENGINEER (PART-TIME CONSULTANT) – INFOTECH L.L.C – 01/11/2021 – Current – REMOTE, KOSOVO",
          "• Provided on-call architecture and performance triage.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.headline).toBe("Senior Full-Stack Software Engineer");
    expect(extraction.targetRoles).toEqual([
      "Senior Full-Stack Software Engineer",
    ]);
  });

  test("does not inflate ISO month date ranges into a full year of experience", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Jordan Avery",
          "Senior Software Engineer",
          "EXPERIENCE",
          "Signal Systems — Senior Software Engineer",
          "2024-12 - 2025-01",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.yearsExperience).toBeNull();
  });

  test("preserves year-only dates in deterministic tailored resume entries", () => {
    const profile = {
      ...createProfile(),
      experiences: [
        {
          id: "experience_year_only",
          companyName: "Mercury",
          companyUrl: null,
          title: "Senior Software Engineer",
          employmentType: null,
          location: "Remote",
          workMode: [],
          startDate: "2024",
          endDate: null,
          isCurrent: true,
          isDraft: false,
          summary: null,
          achievements: [],
          skills: [],
          domainTags: [],
          peopleManagementScope: null,
          ownershipScope: null,
        },
      ],
      education: [
        {
          id: "education_year_only",
          schoolName: "State University",
          degree: "Bachelor's Degree",
          fieldOfStudy: "Computer Science",
          location: null,
          startDate: "2014",
          endDate: "2018",
          isDraft: false,
          summary: null,
        },
      ],
      certifications: [
        {
          id: "cert_year_only",
          name: "AWS Certified Developer",
          issuer: "Amazon",
          issueDate: "2024",
          expiryDate: null,
          credentialUrl: null,
          isDraft: false,
        },
      ],
    };

    const draft = buildDeterministicTailoredResume({
      profile,
      searchPreferences: createPreferences(),
      settings: createSettings(),
      job: createJobPosting(),
      resumeText: profile.baseResume.textContent,
    });

    expect(draft.experienceEntries[0]?.dateRange).toBe("2024 – Present");
    expect(draft.educationEntries[0]?.dateRange).toBe("2014 – 2018");
    expect(draft.certificationEntries[0]?.dateRange).toBe("2024");
  });

  test("splits inline company and location details from combined experience headers", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "WORK EXPERIENCE",
          ".NET DEVELOPER – CREA-KO – 01/2019 – 07/2019 – PRISHTINA, KOSOVO",
          "• Assisted in migrating a web-based ERP system from .NET Framework to .NET Core MVC, refactoring both front-end",
          "and back-end code to enhance performance, scalability, and alignment with the .NET Core MVC architecture.",
          "TECHNICAL SUPPORT AGENT – BIT BY BIT – 06/2017 – 12/2017 – PRISHTINA, KOSOVO",
          "• Resolved IPTV incidents with a 92 % first-call resolution rate across 40+ tickets/day.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.experiences[0]).toMatchObject({
      title: ".NET Developer",
      companyName: "CREA-KO",
      location: "Prishtina, Kosovo",
      startDate: "01/2019",
      endDate: "07/2019",
    });
    expect(
      [
        extraction.experiences[0]?.summary ?? "",
        ...(extraction.experiences[0]?.achievements ?? []),
      ].join(" "),
    ).toContain("refactoring both front-end");
    expect(extraction.experiences[1]).toMatchObject({
      title: "Technical Support Agent",
      companyName: "BIT BY BIT",
      location: "Prishtina, Kosovo",
      startDate: "06/2017",
      endDate: "12/2017",
    });
  });

  test("extracts realistic fixture text for plan 019 benchmark coverage", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: EBRAR_IMPORTED_TEXT,
      },
      "deterministic",
      "Test provider",
    );

    expect(extraction.fullName).toBe("Ebrar Dushullovci");
    expect(extraction.currentLocation).toBe("Prishtina, Kosovo");
    expect(extraction.summary).toContain("6+ years of full-stack experience");
    expect(
      extraction.experiences.some(
        (entry) => entry.companyName === "AUTOMATEDPROS",
      ),
    ).toBe(true);
  });

  test("parses professional experience headings and inline date headers", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ryan Holstien",
          "PROFESSIONAL EXPERIENCE",
          "Senior Software Engineer — DataHub, Remote, CA (Dec 2021–Feb 2026)",
          "Designed C# and .NET services for a behavioral-health platform.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences[0]).toMatchObject({
      title: "Senior Software Engineer",
      companyName: "DataHub",
      location: "Remote, CA",
      startDate: "Dec 2021",
      endDate: "Feb 2026",
    });
  });

  test("infers undated experience entries from company then role lines", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Experience",
          "Signal Systems",
          "Staff Frontend Engineer",
          "Built React and TypeScript foundations for product teams.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences[0]).toMatchObject({
      companyName: "Signal Systems",
      title: "Staff Frontend Engineer",
    });
  });

  test("parses school-first education lines with adjacent dates", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Aaron Murphy",
          "EDUCATION",
          "Florida State University — Bachelor’s Degree in Computer Science and Physics",
          "May 2011 - Sept 2015",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.education[0]).toMatchObject({
      schoolName: "Florida State University",
      degree: "Bachelor’s Degree",
      fieldOfStudy: "Computer Science and Physics",
      startDate: "May 2011",
      endDate: "Sept 2015",
    });
  });

  test("parses degree-first education lines with embedded college names", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EDUCATION AND TRAINING",
          "Prishtina, Kosovo",
          "BACHELOR'S DEGREE, COMPUTER SCIENCE Kolegji Riinvest (Riinvest College)",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.education[0]).toMatchObject({
      schoolName: "Kolegji Riinvest (Riinvest College)",
      degree: "BACHELOR'S DEGREE",
      fieldOfStudy: "COMPUTER SCIENCE",
      location: "Prishtina, Kosovo",
    });
  });

  test("parses an associate degree before a school name on one line", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EDUCATION",
          "Associate of Applied Science in Business Administration — Columbus State Community College, 2021",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.education[0]).toMatchObject({
      schoolName: "Columbus State Community College",
      degree: "Associate of Applied Science",
      fieldOfStudy: "Business Administration",
      endDate: "2021",
    });
  });

  test("parses school and degree education entries split across adjacent lines", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EDUCATION",
          "The University of Texas at Austin (Sep 2012 - Jun 2016)",
          "Bachelor of Science (B.S.), Computer Science",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.education[0]).toMatchObject({
      schoolName: "The University of Texas at Austin",
      degree: "Bachelor of Science (B.S.)",
      fieldOfStudy: "Computer Science",
      startDate: "Sep 2012",
      endDate: "Jun 2016",
    });
  });

  test("starts a new experience block when a new header appears before the next date line", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EXPERIENCE",
          "EdSights, Remote, NY — Staff/Senior Software Engineer",
          "Sep 2021 – Feb 2026",
          "● Led the design and implementation of scalable cloud-native applications.",
          "Agile Thought, Tampa, FL — Senior Software Developer",
          "Jul 2019 - Sep 2021",
          "● Built and scaled front-end applications using React and TypeScript.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences[0]).toMatchObject({
      companyName: "EdSights",
      title: "Staff/Senior Software Engineer",
    });
    expect(extraction.experiences[1]).toMatchObject({
      companyName: "Agile Thought",
      title: "Senior Software Developer",
      location: "Tampa, FL",
      startDate: "Jul 2019",
      endDate: "Sep 2021",
    });
  });

  test("repairs run-on Ebrar extraction lines before parsing later experience headers", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "WORK EXPERIENCE",
          "AUTOMATEDPROS - PRISHTINA, KOSOVO",
          "SENIOR FULL-STACK SOFTWARE ENGINEER - 07/2023 - Current",
          "• Built a centralized dashboard with ShadCN components for logging outcomes.",
          "CHIEF EXPERIENCE OFFICER - 11/2021 - 07/2023",
          "• Managed the delivery of product updates, ensuring QA testing coverage and that support teams were fully equipped.",
          "INFOTECH L.L.C - PRISHTINA, KOSOVO.NET CONSULTANT - 01/2022 - Current",
          "• Authored quick-fix patches that restored business-critical services within 2 h of incident notification, maintaining 99.9 % uptime..NET DEVELOPER - 08/2019 - 01/2022",
          "• Supported and enhanced a comprehensive .NET desktop application for business management.",
          "• Project Lead (.NET MVC) - Logistics & Delivery Web Solution: designed user registration, order placement, real-time tracking, responsive UI, and optimized database for high-volume order processing..NET DEVELOPER - CREA-KO - 01/2019 - 07/2019 - PRISHTINA, KOSOVO",
          "• Assisted in migrating a web-based ERP system from .NET Framework to .NET Core MVC.",
          "BEAUTYQUE - PRISHTINA, KOSOVO",
          "PROJECT MANAGER - 04/2018 - 12/2018",
          "DIGITAL MARKETING MANAGER - 12/2017 - 04/2018",
          "TECHNICAL SUPPORT AGENT - BIT BY BIT - 06/2017 - 12/2017 - PRISHTINA, KOSOVO",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    const titles = extraction.experiences.map((entry) => entry.title);

    expect(titles).toEqual(
      expect.arrayContaining([
        ".NET Consultant",
        ".NET Developer",
        "Project Manager",
        "Digital Marketing Manager",
        "Technical Support Agent",
      ]),
    );
    expect(extraction.experiences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: ".NET Consultant",
          companyName: "INFOTECH L.L.C",
          startDate: "01/2022",
          isCurrent: true,
        }),
        expect.objectContaining({
          title: ".NET Developer",
          startDate: "08/2019",
          endDate: "01/2022",
        }),
        expect.objectContaining({
          title: ".NET Developer",
          companyName: "CREA-KO",
          startDate: "01/2019",
          endDate: "07/2019",
        }),
      ]),
    );
    expect(
      extraction.experiences.some(
        (entry) => entry.companyName === "AUTOMATEDPROS - 01/",
      ),
    ).toBe(false);
    expect(
      extraction.experiences.some(
        (entry) => entry.companyName === "INFOTECH L.L.C - 01/",
      ),
    ).toBe(false);
    expect(
      titles.some((title) => title?.includes("Prishtina, Kosovo.net")),
    ).toBe(false);
    expect(titles.some((title) => title?.includes("99.9 % Uptime"))).toBe(
      false,
    );
    expect(titles.some((title) => title?.includes("Real-time Tracking"))).toBe(
      false,
    );
  });

  test("repairs the real extracted Ebrar PDF text around INFOTECH and CREA-KO", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "WORK EXPERIENCE",
          "AUTOMATEDPROS – PRISHTINA, KOSOVO",
          "SENIOR FULL-STACK SOFTWARE ENGINEER – 07/2023 – Current",
          "• Engineered a real-time restaurant order platform.",
          "• Integrated the platform with the company's project-management tool through REST APIs so failed tests automatically created and assigned tickets, eliminating manual triage and ensuring rapid resolution.",
          "CHIEF EXPERIENCE OFFICER – 11/2021 – 07/2023",
          "• Managed the delivery of product updates, ensuring QA testing coverage and that support teams were fully equipped with knowledge of new features before deployment.",
          "INFOTECH L.L.C – PRISHTINA, KOSOVO.NET CONSULTANT – 01/2022 – Current",
          "• Provide on-call architecture and performance triage, cutting query response times by up to 60 % in critical workflows.",
          "• Authored quick-fix patches that restored business-critical services within 2 h of incident notification, maintaining 99.9 % uptime..NET DEVELOPER – 08/2019 – 01/2022",
          "• Supported and enhanced a comprehensive.NET desktop application for business management covering inventory, sales, tax documentation, POS, restaurant orders, car repair, and fuel-pump control.",
          "• Project Lead (.NET MVC) – Logistics & Delivery Web Solution: designed user registration, order placement, real-time tracking, responsive UI, and optimized database for high-volume order processing..NET DEVELOPER – CREA-KO – 01/2019 – 07/2019 – PRISHTINA, KOSOVO",
          "• Assisted in migrating a web-based ERP system from.NET Framework to.NET Core MVC, refactoring both front-end and back-end code to enhance performance.",
          "BEAUTYQUE – PRISHTINA, KOSOVO",
          "PROJECT MANAGER – 04/2018 – 12/2018",
          "DIGITAL MARKETING MANAGER – 12/2017 – 04/2018",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    const titles = extraction.experiences.map((entry) => entry.title);

    expect(titles).toEqual(
      expect.arrayContaining([
        ".NET Consultant",
        ".NET Developer",
        "Project Manager",
        "Digital Marketing Manager",
      ]),
    );
    expect(extraction.experiences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: ".NET Consultant",
          companyName: "INFOTECH L.L.C",
          location: "Prishtina, Kosovo",
          startDate: "01/2022",
          isCurrent: true,
        }),
        expect.objectContaining({
          title: ".NET Developer",
          companyName: "CREA-KO",
          location: "Prishtina, Kosovo",
          startDate: "01/2019",
          endDate: "07/2019",
        }),
      ]),
    );
    expect(
      titles.some((title) => title?.includes("Prishtina, Kosovo.net")),
    ).toBe(false);
    expect(titles.some((title) => title?.includes("99.9 % Uptime"))).toBe(
      false,
    );
    expect(titles.some((title) => title?.includes("Real-time Tracking"))).toBe(
      false,
    );
  });

  test("keeps stacked role headers and background sections associated with their records", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EXPERIENCE",
          "Northstar Labs",
          "Senior Product Engineer",
          "Amsterdam, Netherlands",
          "March 2022 - Present",
          "Built TypeScript workflow tools for operations teams.",
          "- Reduced manual review time by 28% through a guided validation queue.",
          "Harbor Studio",
          "Frontend Engineer",
          "Rotterdam, Netherlands",
          "January 2019 - February 2022",
          "Delivered customer-facing React applications.",
          "- Shipped a reusable component library across four products.",
          "PROJECTS",
          "Queue Insight",
          "Lead Developer",
          "Open-source workflow diagnostics dashboard built with TypeScript.",
          "https://example.test/queue-insight",
          "CERTIFICATIONS",
          "AWS Certified Developer - Associate",
          "Amazon Web Services",
          "Issued June 2023",
          "EDUCATION",
          "Delft University of Technology",
          "BSc Computer Science",
          "2015 - 2018",
          "LANGUAGES",
          "English - Professional working proficiency",
          "Dutch - Native",
          "SKILLS",
          "TypeScript, React, Accessibility, AWS",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences).toEqual([
      expect.objectContaining({
        companyName: "Northstar Labs",
        title: "Senior Product Engineer",
        location: "Amsterdam, Netherlands",
        startDate: "March 2022",
        isCurrent: true,
      }),
      expect.objectContaining({
        companyName: "Harbor Studio",
        title: "Frontend Engineer",
        location: "Rotterdam, Netherlands",
        startDate: "January 2019",
        endDate: "February 2022",
      }),
    ]);
    expect(extraction.experiences[0]?.achievements).toContain(
      "Reduced manual review time by 28% through a guided validation queue.",
    );
    expect(extraction.education[0]).toMatchObject({
      schoolName: "Delft University of Technology",
      degree: "BSc Computer Science",
    });
    expect(extraction.projects[0]).toMatchObject({
      name: "Queue Insight",
      role: "Lead Developer",
    });
    expect(extraction.certifications[0]).toMatchObject({
      name: "AWS Certified Developer - Associate",
      issuer: "Amazon Web Services",
      issueDate: "June 2023",
    });
    expect(extraction.spokenLanguages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "English",
          proficiency: "Professional working proficiency",
        }),
        expect.objectContaining({ language: "Dutch", proficiency: "Native" }),
      ]),
    );
  });

  test.each([
    "Eligibility",
    "Target roles",
    "Preferred location: Remote worldwide or Berlin, Germany",
  ])("keeps real spoken languages separate from %s", (boundary) => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Jamie Rivers",
          "Languages",
          "English - fluent",
          "German - fluent",
          boundary,
          "Authorized to work in Germany and the European Union. No sponsorship required.",
          "Target roles",
          "Frontend Engineer, Backend Engineer, Full-stack Engineer, Platform Engineer, Data Engineer",
          "Preferred location: Remote worldwide or Berlin, Germany",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.spokenLanguages).toEqual([
      expect.objectContaining({ language: "English", proficiency: "fluent" }),
      expect.objectContaining({ language: "German", proficiency: "fluent" }),
    ]);
  });

  test("keeps real spoken languages and drops Europass language-section chrome", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ada Example",
          "LANGUAGE SKILLS",
          "Mother Tongue(S) — ALBANIAN",
          "English — C2",
          "Levels — A1 and A2: Basic user; B1 and B2: Independent user; C1 and C2: Proficient user",
          "SKILLS",
          "TypeScript, React, PostgreSQL",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.spokenLanguages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "Albanian",
          proficiency: "Native",
        }),
        expect.objectContaining({ language: "English", proficiency: "C2" }),
      ]),
    );
    expect(
      extraction.spokenLanguages.some((entry) =>
        /mother tongue|levels/i.test(entry.language ?? ""),
      ),
    ).toBe(false);
    expect(extraction.skills.join(" ")).not.toMatch(
      /mother tongue|levels|albanian|english/i,
    );
  });

  test("supports title-first stacked headers and carries an employer across consecutive roles", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "EXPERIENCE",
          "Senior Product Engineer",
          "Northstar Labs",
          "Amsterdam, Netherlands",
          "March 2022 - Present",
          "Built workflow tools for operations teams.",
          "Product Engineer",
          "January 2020 - February 2022",
          "Maintained the same product platform for internal teams.",
          "Frontend Engineer",
          "Harbor Studio",
          "Rotterdam, Netherlands",
          "January 2018 - December 2019",
          "Delivered customer-facing applications.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences).toEqual([
      expect.objectContaining({
        title: "Senior Product Engineer",
        companyName: "Northstar Labs",
        location: "Amsterdam, Netherlands",
      }),
      expect.objectContaining({
        title: "Product Engineer",
        companyName: "Northstar Labs",
        location: "Amsterdam, Netherlands",
      }),
      expect.objectContaining({
        title: "Frontend Engineer",
        companyName: "Harbor Studio",
        location: "Rotterdam, Netherlands",
      }),
    ]);
  });

  test("splits ● bullet glyphs into separate achievements instead of one summary paragraph", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ryan Holstien",
          "Senior Software Engineer",
          "ryanholstien993@outlook.com",
          "EXPERIENCE",
          "Senior Software Engineer — DataHub, Remote, CA (Dec 2021–Feb 2026)",
          "● Designed C# and .NET services for a behavioral-health platform, using GitHub Copilot and ChatGPT to speed",
          "coding, refactoring, and docs while improving release quality and delivery pace.",
          "● Built ASP.NET Core REST APIs and internal microservices integrating scheduling, billing, and EHR-adjacent",
          "workflows, reducing manual handoffs and supporting reliable low-latency operations.",
          "● Optimized MongoDB collections with better schema design, compound indexes, and query tuning, cutting read",
          "latency on provider and appointment workflows in production environments.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.experiences).toHaveLength(1);
    const entry = extraction.experiences[0];
    expect(entry?.title).toBe("Senior Software Engineer");
    expect(entry?.companyName).toBe("DataHub");
    expect(entry?.summary).toBeNull();
    expect(entry?.achievements).toHaveLength(3);
    expect(entry?.achievements[0]).toMatch(/^Designed C# and \.NET services/);
    expect(entry?.achievements[1]).toMatch(/^Built ASP ?\.NET Core REST APIs/);
    expect(entry?.achievements[2]).toMatch(/^Optimized MongoDB collections/);
    expect(JSON.stringify(entry)).not.toContain("●");
  });

  test("splits inline ● bullets that PDF extraction glued onto the previous sentence", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ryan Holstien",
          "Senior Software Engineer",
          "EXPERIENCE",
          "Senior Software Engineer — DataHub, Remote, CA (Dec 2021–Feb 2026)",
          "● Designed C# and .NET services for a behavioral-health platform while improving release quality and delivery pace. ● Built ASP.NET Core REST APIs and internal microservices integrating scheduling, billing, and EHR-adjacent workflows.",
          "● Optimized MongoDB collections with better schema design, compound indexes, and query tuning.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    const entry = extraction.experiences[0];
    expect(entry?.summary).toBeNull();
    expect(entry?.achievements).toHaveLength(3);
    expect(JSON.stringify(entry)).not.toContain("●");
  });

  test("uses the header title without turning old employment titles into targets", () => {
    const extraction = buildDeterministicResumeProfileExtraction(
      {
        existingProfile: createProfile(),
        existingSearchPreferences: createPreferences(),
        resumeText: [
          "Ryan Holstien",
          "Senior Software Engineer",
          "EXPERIENCE",
          "Staff Backend Engineer — DataHub, Remote, CA (Dec 2021–Feb 2026)",
          "● Designed C# and .NET services for a behavioral-health platform while improving release quality.",
          "Senior Software Engineer — Cedar Ledger, Remote (Jun 2018–Nov 2021)",
          "● Built account-management workflows with React, GraphQL, and Node.js for enterprise customers.",
          "Software Engineer — Harbor Studio, Rotterdam (Jan 2015–May 2018)",
          "● Shipped front-end features for a design collaboration product used by agencies.",
        ].join("\n"),
      },
      "deterministic",
      "Test provider",
      { preserveExistingValues: false },
    );

    expect(extraction.headline).toBe("Senior Software Engineer");
    expect(extraction.targetRoles).toEqual(["Senior Software Engineer"]);
    expect(extraction.targetRoles.length).toBeLessThanOrEqual(3);
  });
});
