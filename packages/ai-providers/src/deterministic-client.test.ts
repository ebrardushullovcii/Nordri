import { describe, expect, test } from "vitest";
import { createDeterministicJobFinderAiClient } from "./index";
import { createPreferences, createProfile } from "./test-fixtures";

describe("deterministic ai client resume extraction", () => {
  test("returns a rejected promise for aborted job extraction requests", async () => {
    const client = createDeterministicJobFinderAiClient();
    const controller = new AbortController();
    controller.abort();

    const result = client.extractJobsFromPage({
      pageText: "Frontend Engineer at Acme",
      pageUrl: "https://jobs.example.com/search",
      pageType: "search_results",
      maxJobs: 5,
      signal: controller.signal,
    });

    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  test("extracts structured details with the deterministic client", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Ari Devlin",
        "Date of birth: 04/07/1998 Nationality: Kosovar Phone: (+383) 44000000 (Mobile) Email:",
        "ari.devlin@example.test Website: https://www.linkedin.com/in/ari-devlin-example/",
        "Address: Prishtina, Kosovo (Home)",
        "ABOUT MYSELF",
        "A passionate software developer with 6+ years of full-stack experience building impactful solutions using React, Next.js,",
        "Node.js, .NET Core, SQL Server and Azure. After spending time in management, and leading projects and teams, I",
        "recently decided to return to hands-on development, where my career initially began and where my true passion lies. I",
        "am driven by solving complex challenges and continuously improving the quality and efficiency of the software I create.",
        "SKILLS",
        "Frameworks",
        "React, Node.js, Next.js, Express.js, React Native ASP.NET, .Net Core, .Net Framework, MVC, Entity Framework",
        "Programming Languages",
        "Javascript, TypeScript C# SQL Python",
        "WORK EXPERIENCE",
        "REACT/NEXT.JS DEVELOPER – 07/2023 – CURRENT",
      ].join("\n"),
    });

    expect(result.firstName).toBe("Ari");
    expect(result.lastName).toBe("Devlin");
    expect(result.fullName).toBe("Ari Devlin");
    expect(result.headline).toBe("React/Next.js Developer");
    expect(result.currentLocation).toBe("Prishtina, Kosovo");
    expect(result.summary).toContain(
      "A passionate software developer with 6+ years of full-stack experience",
    );
    expect(result.email).toBe("ari.devlin@example.test");
    expect(result.phone).toBe("(+383) 44000000");
    expect(result.portfolioUrl).toBeNull();
    expect(result.linkedinUrl).toBe(
      "https://www.linkedin.com/in/ari-devlin-example/",
    );
    expect(result.targetRoles).toEqual(["React/Next.js Developer"]);
    expect(result.preferredLocations).toEqual(["Prishtina, Kosovo"]);
    expect(result.analysisProviderKind).toBe("deterministic");
    expect(result.notes).toEqual([]);
    expect(result.skills).toContain("React");
    expect(result.skillGroups.languagesAndFrameworks).toContain("React");
    expect(result.professionalSummary.fullSummary).toContain(
      "A passionate software developer",
    );
    expect(result.experiences[0]?.title).toBe("React/Next.js Developer");
    expect(result.links[0]?.kind).toBe("linkedin");
  });

  test("handles alternate summary and skills sections without seeded leakage", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Mira Stone",
        "Lead Product Engineer - 2024 - CURRENT",
        "Address: Toronto, Canada",
        "PROFILE",
        "Hands-on product engineer focused on polished frontend systems, experimentation, and shipping measurable improvements.",
        "CORE SKILLS",
        "React, TypeScript, Design Systems, Accessibility, Product Strategy",
      ].join("\n"),
    });

    expect(result.fullName).toBe("Mira Stone");
    expect(result.headline).toBe("Lead Product Engineer");
    expect(result.currentLocation).toBe("Toronto, Canada");
    expect(result.summary).toContain(
      "Hands-on product engineer focused on polished frontend systems",
    );
    expect(result.skills).toEqual([
      "React",
      "TypeScript",
      "Design Systems",
      "Accessibility",
      "Product Strategy",
    ]);
    expect(result.skillGroups.coreSkills).toContain("React");
    expect(result.targetRoles).toEqual(["Lead Product Engineer"]);
    expect(result.analysisProviderKind).toBe("deterministic");
  });

  test("does not treat degree or role lines as fallback locations", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Jamie Rivers",
        "Staff Engineer, Acme Corp",
        "Bachelor of Science, Arbana College",
        "PROFILE",
        "Hands-on product engineer focused on resilient systems.",
      ].join("\n"),
    });

    expect(result.currentLocation).toBe("London, UK");
    expect(result.preferredLocations).toEqual(["London, UK"]);
  });

  test("parses real imported resume details into structured sections", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Ari Devlin",
        "Date of birth: 04/07/1998 Nationality: Kosovar Phone: (+383) 44000000 (Mobile) Email:",
        "ari.devlin@example.test Website: https://www.linkedin.com/in/ari-devlin-example/",
        "Address: Prishtina, Kosovo (Home)",
        "ABOUT MYSELF",
        "A passionate software developer with 6+ years of full-stack experience building impactful solutions using React, Next.js, Node.js, .NET Core, SQL Server and Azure.",
        "SKILLS",
        "Frameworks",
        "React, Node.js, Next.js, Express.js, React Native ASP.NET, .Net Core, .Net Framework, MVC, Entity Framework",
        "Programming Languages",
        "Javascript, TypeScript C# SQL Python",
        "Databases",
        "SQL Server MySQL PostgreSQL MongoDB",
        "Tools",
        "Docker Git Azure/AWS WebSockets Postman Jira Figma Selenium Cypress",
        "Security & Authentication",
        "OAuth JWT",
        "Soft Skills",
        "Leadership Communication Problem-solving Adaptability",
        "WORK EXPERIENCE",
        " NORTHLANE – PRISHTINA, KOSOVO",
        "REACT/NEXT.JS DEVELOPER – 07/2023 – CURRENT",
        "After deciding to return to my passion for development, I transitioned back into a hands-on developer role,",
        "contributing to two key projects.",
        "• Engineered a real-time restaurant order platform with React, Next.js, TailwindCSS & WebSockets.",
        "BACHELOR'S DEGREE, COMPUTER SCIENCE Kolegji Arbana (Arbana College)",
        "Mother tongue(s): ALBANIAN",
        "ENGLISH C2 C2 C2 C2 C2",
      ].join("\n"),
    });

    expect(result.skillGroups.tools).toEqual(
      expect.arrayContaining([
        "SQL Server",
        "MySQL",
        "PostgreSQL",
        "MongoDB",
        "Docker",
      ]),
    );
    expect(result.skillGroups.softSkills).toEqual(
      expect.arrayContaining([
        "Leadership",
        "Communication",
        "Problem-solving",
        "Adaptability",
      ]),
    );
    expect(result.experiences[0]).toMatchObject({
      companyName: "NORTHLANE",
      location: "Prishtina, Kosovo",
      title: "React/Next.js Developer",
      startDate: "07/2023",
      isCurrent: true,
    });
    expect(result.experiences[0]?.achievements).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Engineered a real-time restaurant order platform",
        ),
      ]),
    );
    expect(result.experiences[0]?.skills).toEqual(
      expect.arrayContaining(["React", "Next.js", "TailwindCSS", "WebSockets"]),
    );
    expect(result.education[0]?.schoolName).toContain("Kolegji Arbana");
    expect(result.education[0]?.degree).toBe("BACHELOR'S DEGREE");
    expect(result.timeZone).toBe("Europe/Belgrade");
    expect(result.salaryCurrency).toBe("EUR");
    expect(result.spokenLanguages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: "Albanian",
          proficiency: "Native",
        }),
        expect.objectContaining({ language: "English", proficiency: "C2" }),
      ]),
    );
  });

  test("prefers top-level personal sites over arbitrary non-platform links", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Jamie Rivers",
        "https://acme.com/team/jamie-rivers",
        "https://github.com/jamie-rivers",
        "https://www.linkedin.com/in/jamie-rivers",
        "https://jamierivers.dev",
      ].join("\n"),
    });

    expect(result.personalWebsiteUrl).toBe("https://jamierivers.dev");
  });

  test("chooses likely portfolio links over company or certification URLs when no personal site is present", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Jamie Rivers",
        "https://acme.com/team/jamie-rivers",
        "https://www.credly.com/badges/example-badge",
        "https://github.com/jamie-rivers",
        "https://www.linkedin.com/in/jamie-rivers",
      ].join("\n"),
    });

    expect(result.portfolioUrl).toBe("https://github.com/jamie-rivers");
  });

  test("preserves parsed zero years experience instead of falling back to seeded values", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Alex Vanguard",
        "Junior Developer",
        "0 years experience with professional software teams.",
      ].join("\n"),
    });

    expect(result.yearsExperience).toBe(0);
  });

  test("keeps bullet achievements when the first non-heading detail line is a bullet", async () => {
    const client = createDeterministicJobFinderAiClient();

    const result = await client.extractProfileFromResume({
      existingProfile: createProfile(),
      existingSearchPreferences: createPreferences(),
      resumeText: [
        "Alex Vanguard",
        "WORK EXPERIENCE",
        "ACME – LONDON, UK",
        "SOFTWARE ENGINEER – 2023 – CURRENT",
        "• Led a critical migration across multiple services with zero downtime.",
        "• Built automation tooling for release validation and monitoring.",
      ].join("\n"),
    });

    expect(result.experiences[0]?.summary).toBeNull();
    expect(result.experiences[0]?.achievements).toEqual(
      expect.arrayContaining([
        "Led a critical migration across multiple services with zero downtime.",
        "Built automation tooling for release validation and monitoring.",
      ]),
    );
  });
});
