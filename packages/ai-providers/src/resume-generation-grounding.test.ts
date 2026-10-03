import { describe, expect, it } from "vitest";

import {
  buildGroundedResumeRewriteModelPayload,
  collectListingRequestedSkills,
  describeAggressiveResumeEditPolicy,
  compactJobDescriptionForModel,
} from "./resume-generation-grounding";
import {
  createJobPosting,
  createPreferences,
  createProfile,
  createSettings,
} from "./test-fixtures";

describe("compactJobDescriptionForModel", () => {
  it("passes a short body through untouched", () => {
    expect(
      compactJobDescriptionForModel("Build APIs.\n\nRequirements: .NET."),
    ).toBe("Build APIs.\n\nRequirements: .NET.");
  });

  it("keeps requirement paragraphs and drops boilerplate first when the body is long", () => {
    const requirement =
      "Requirements: 5+ years with .NET Core, REST APIs and Azure.";
    const boilerplate = Array.from(
      { length: 40 },
      (_, index) =>
        `About us ${index}: we are a venture-backed company founded in 2015 with a mission to change manufacturing forever and a generous benefits package.`,
    );
    const body = [
      ...boilerplate.slice(0, 20),
      requirement,
      ...boilerplate.slice(20),
    ].join("\n\n");

    const compacted = compactJobDescriptionForModel(body, 1_500);

    expect(compacted.length).toBeLessThanOrEqual(1_500);
    expect(compacted).toContain(requirement);
    // Order is preserved: the requirement sits after whichever boilerplate
    // survived ahead of it, never hoisted to the top.
    const kept = compacted.split("\n\n");
    expect(kept.indexOf(requirement)).toBeGreaterThanOrEqual(0);
  });
});

describe("collectListingRequestedSkills", () => {
  it("does not split a work-authorization country into requested skills", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["TypeScript"],
      minimumQualifications: [
        "Must be authorized to work in the United States.",
        "Experience with Terraform required.",
      ],
    });

    expect(collected).toContain("Terraform");
    expect(collected).not.toContain("United");
    expect(collected).not.toContain("States");
  });
  it.each([
    "Practical knowledge of Terraform and Kubernetes.",
    "Experience with practical Terraform and Kubernetes skills.",
  ])(
    "keeps technologies without the qualification adjective in %s",
    (qualification) => {
      expect(
        collectListingRequestedSkills({
          keySkills: [],
          minimumQualifications: [qualification],
        }).sort(),
      ).toEqual(["Kubernetes", "Terraform"]);
    },
  );
  it("does not take a word of the posting title or employer name for a skill", () => {
    const description = [
      "Cloud Garden Workshop · Remote, Europe · Posted 12d ago",
      "Full-stack Engineer, Cloud Gardens",
      "Work with a small team on accessible interfaces, APIs, data pipelines and developer tools.",
    ].join("\n");

    const collected = collectListingRequestedSkills({
      title: "Full-stack Engineer, Cloud Gardens",
      company: "Cloud Garden Workshop",
      description,
    });

    expect(collected).not.toContain("Gardens");
    expect(collected).toContain("APIs");
    expect(
      collectListingRequestedSkills({
        title: "Backend Engineer, Willow APIs",
        company: "Willow Circuit House",
        description: `Backend Engineer, Willow APIs\n${description}`,
      }),
    ).toContain("APIs");
  });

  it("collects a technology named only in qualifications, not keySkills", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["TypeScript"],
      minimumQualifications: [
        "Hands-on experience with Terraform and CI/CD.",
        "Proficiency in C++.",
        "Experience with Go.",
      ],
      preferredQualifications: ["C# and Node.js are a plus."],
    });

    expect(collected).toEqual(
      expect.arrayContaining([
        "TypeScript",
        "Terraform",
        "CI/CD",
        "C++",
        "Go",
        "C#",
        "Node.js",
      ]),
    );
    expect(collected).not.toContain("Proficiency");
  });

  it("does not invent skills from qualification fluff on the seed job", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["Figma", "Design Systems"],
      keywordSignals: [
        { kind: "skill", label: "Design Systems" },
        { kind: "domain", label: "Workflow platform" },
      ],
      minimumQualifications: ["Strong product design systems experience."],
      preferredQualifications: ["Workflow-platform product background."],
      responsibilities: ["Own the design system roadmap."],
      description: "Own the design system and workflow platform.",
    });

    expect(collected).toEqual(["Figma", "Design Systems"]);
    expect(collected.join(" ")).not.toMatch(/Strong|Workflow platform/i);
  });

  it("does not turn a request for evidence into an aggressive skill", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["TypeScript", "Workflow Automation", "Platform Reliability"],
      minimumQualifications: [
        "Evidence of workflow automation and production reliability work.",
        "Evidence of experience with React and TypeScript.",
      ],
    });

    expect(collected).not.toContain("Evidence");
    expect(collected).toEqual(
      expect.arrayContaining([
        "TypeScript",
        "React",
        "Workflow Automation",
        "Platform Reliability",
      ]),
    );
    expect(collectListingRequestedSkills({ keySkills: ["Evidence"] })).toEqual([
      "Evidence",
    ]);
  });

  it("collects technologies from including-lists and year-prefixed qualification lines", () => {
    expect(
      collectListingRequestedSkills({
        keySkills: [],
        minimumQualifications: [
          "3+ years of Terraform experience.",
          "Cloud stack: including Kubernetes, AWS, and CI/CD.",
        ],
      }),
    ).toEqual(
      expect.arrayContaining(["Terraform", "Kubernetes", "AWS", "CI/CD"]),
    );
  });

  it("collects technologies from work-with and pipeline-in listing prose", () => {
    const collected = collectListingRequestedSkills({
      keySkills: [],
      description: "You'll work with Terraform daily.",
      responsibilities: [
        "Build pipelines in TypeScript and Postgres.",
        "Services written in Go.",
      ],
    });

    expect(collected).toEqual(
      expect.arrayContaining(["Terraform", "TypeScript", "Postgres", "Go"]),
    );
    expect(collected).not.toContain("Build");
    expect(collected.join(" ")).not.toMatch(/daily/i);
  });

  it("does not harvest title-case verbs from the raw description", () => {
    expect(
      collectListingRequestedSkills({
        keySkills: ["React"],
        description:
          "Build payment checkout surfaces for every customer. Own the React library.",
      }),
    ).toEqual(["React"]);
  });

  it("does not harvest Build or Services from qualification sentences", () => {
    const collected = collectListingRequestedSkills({
      keySkills: [],
      minimumQualifications: [
        "Build pipelines in TypeScript and Postgres.",
        "Services written in Go.",
      ],
    });

    expect(collected).toEqual(
      expect.arrayContaining(["TypeScript", "Postgres", "Go"]),
    );
    expect(collected).not.toContain("Build");
    expect(collected).not.toContain("Services");
  });

  it("keeps real compound and product names that contain service or build", () => {
    const collected = collectListingRequestedSkills({
      keySkills: [],
      minimumQualifications: [
        "Hands-on experience with Amazon Web Services, ServiceNow, and Buildkite.",
      ],
    });

    expect(collected).toEqual(
      expect.arrayContaining([
        "Amazon Web Services",
        "ServiceNow",
        "Buildkite",
      ]),
    );
    expect(collected).not.toContain("Build");
    expect(collected).not.toContain("Services");
    expect(collected.join(" ")).not.toMatch(/^Amazon Web$/);
  });

  it("does not invent skills from work-with team boilerplate", () => {
    expect(
      collectListingRequestedSkills({
        keySkills: ["React"],
        description: "You'll work with our engineering team daily.",
      }),
    ).toEqual(["React"]);
  });

  it("does not harvest listing sentences or hyphenated prose as skills", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["TypeScript", "React", "Kubernetes", "Postgres"],
      summary:
        "Own React storefronts and the Terraform-backed delivery pipeline for restaurant operations.",
      description:
        "You'll work with Terraform daily to provision kitchen-display environments.",
      responsibilities: [
        "You'll work with Terraform daily and keep Kubernetes manifests reviewable.",
        "Build pipelines in TypeScript and Postgres so ticket flow stays under one second.",
        "Own React and Next.js storefronts used by kitchen and floor staff.",
      ],
    });

    expect(collected).toEqual(
      expect.arrayContaining([
        "TypeScript",
        "React",
        "Terraform",
        "Kubernetes",
        "Postgres",
      ]),
    );
    expect(collected.join(" | ")).not.toMatch(
      /kitchen display|restaurant operations|manifests reviewable|delivery pipeline|storefronts|settlement|typescript services/i,
    );
    expect(collected).not.toContain("TypeScript services");
  });

  it("does not harvest credential titles as skills", () => {
    const collected = collectListingRequestedSkills({
      keySkills: ["AWS"],
      preferredQualifications: [
        "AWS Certified Solutions Architect or equivalent cloud certification.",
      ],
    });

    expect(collected).toEqual(["AWS"]);
    expect(collected).not.toContain("Certified");
    expect(collected).not.toContain("Solutions");
    expect(collected).not.toContain("Architect");
    expect(collected.join(" ")).not.toMatch(/Solutions Architect/i);
  });
});

describe("buildGroundedResumeRewriteModelPayload", () => {
  it("does not turn clear communication into a requested technology", () => {
    const payload = buildGroundedResumeRewriteModelPayload({
      profile: createProfile(),
      searchPreferences: createPreferences(),
      settings: createSettings(),
      job: {
        ...createJobPosting(),
        keySkills: ["TypeScript"],
        minimumQualifications: [
          "Professional software development experience.",
          "Clear communication and an interest in learning.",
        ],
      },
      resumeText: "Resume text",
    });

    expect(payload.targetJob.listingRequestedSkills).toContain("TypeScript");
    expect(payload.targetJob.listingRequestedSkills).not.toContain("Clear");
  });

  it("puts qualification-only listing skills on the target job for the model", () => {
    const payload = buildGroundedResumeRewriteModelPayload({
      profile: createProfile(),
      searchPreferences: createPreferences(),
      settings: createSettings(),
      job: {
        ...createJobPosting(),
        keySkills: ["TypeScript"],
        minimumQualifications: ["Hands-on experience with Terraform."],
      },
      resumeText: "Resume text",
      evidence: {
        summary: [],
        candidateSummary: [],
        experience: [],
        skills: ["TypeScript"],
        keywords: [],
      },
      researchContext: {
        companyNotes: [],
        domainVocabulary: [],
        priorityThemes: [],
      },
    });

    expect(payload.targetJob.listingRequestedSkills).toEqual(
      expect.arrayContaining(["TypeScript", "Terraform"]),
    );
  });
});

describe("describeAggressiveResumeEditPolicy", () => {
  it("states the screening purpose without moralizing", () => {
    const policy = describeAggressiveResumeEditPolicy("aggressive");
    expect(policy).toMatch(/first interview/);
    expect(policy).toMatch(/listing asks for/);
    expect(policy).not.toMatch(
      /\b(lie|lies|lying|liar|dishonest|unethical|fraud)\b/i,
    );
    expect(describeAggressiveResumeEditPolicy("conservative")).toBeNull();
    expect(describeAggressiveResumeEditPolicy("balanced")).toBeNull();
  });
});
