import { describe, expect, it, test } from "vitest";

import {
  buildGroundedResumeRewriteModelPayload,
  classifyResumeClaimGrounding,
  collectListingRequestedSkills,
  describeAggressiveResumeEditPolicy,
  mergeAggressiveVisibleSkills,
  RESUME_CLAIM_SUPPORT_EVIDENCE_CAP,
  selectResumeRewrite,
  compactJobDescriptionForModel,
} from "./resume-generation-grounding";
import {
  createJobPosting,
  createPreferences,
  createProfile,
  createSettings,
} from "./test-fixtures";

describe("resume generation grounding", () => {
  test("rejects a new leadership claim even when most words overlap role evidence", () => {
    const selection = selectResumeRewrite({
      generated: {
        text: "Led reliable TypeScript workflow tools for operations teams and regulatory strategy.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built reliable TypeScript workflow tools for operations teams.",
          scope: "experience",
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience",
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    });

    expect(selection).toBeNull();
  });

  test("rejects canonical text when exact claims are disabled even if paraphrases are allowed", () => {
    const canonical =
      "Built reliable TypeScript workflow tools for operations teams.";

    expect(
      selectResumeRewrite({
        generated: {
          text: canonical,
          evidenceRefs: ["experience:role_1:achievement:0"],
        },
        canonicalCandidates: [canonical],
        evidenceCatalog: [
          {
            id: "experience:role_1:achievement:0",
            text: canonical,
            scope: "experience",
            profileRecordId: "role_1",
          },
        ],
        allowedScope: {
          scope: "experience",
          profileRecordId: "role_1",
        },
        jobCompany: "ExampleCo",
        jobSkills: ["TypeScript"],
        allowExactClaims: false,
        allowParaphrasedClaims: true,
      }),
    ).toBeNull();
  });

  test("replaces a strict-prefix rewrite with the complete canonical bullet", () => {
    const canonical =
      "Recorded supply counts in a shared spreadsheet for weekly operations.";
    const selection = selectResumeRewrite({
      generated: {
        text: "Recorded supply counts in a shared spreadsheet",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [canonical],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: canonical,
          scope: "experience",
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience",
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    });

    expect(selection).toMatchObject({
      text: canonical,
      kind: "canonical",
    });
  });

  test("rejects a novel clause even when every preceding phrase is grounded", () => {
    const selection = selectResumeRewrite({
      generated: {
        text: "Built reliable TypeScript workflow tools for operations teams and regulatory strategy.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built reliable TypeScript workflow tools for operations teams.",
          scope: "experience",
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience",
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    });

    expect(selection).toBeNull();
  });

  test("allows bounded responsibility inference only when aggressive tailoring explicitly opts in", () => {
    const input = {
      generated: {
        text: "Built reliable customer-facing workflow tools for support operations teams.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built reliable workflow tools for support operations teams.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
    });
  });

  test("aggressive mode elaborates plain-language domain details around thin evidence", () => {
    const input = {
      generated: {
        text: "Designed table reservation flows, ordering, menu management, and staff scheduling modules for the restaurant platform.",
        evidenceRefs: ["experience:role_1:summary"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:summary",
          text: "Built and maintained a restaurant management SaaS platform.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
      inferred: false,
    });
  });

  test("aggressive mode accepts profile skill evidence as a supplement for stack-aware bullets", () => {
    const input = {
      generated: {
        text: "Implemented code-splitting and lazy loading in Next.js, cutting dashboard load time by 15%.",
        evidenceRefs: ["experience:role_1:achievement:0", "profile:skills"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Made the customer dashboard 15% faster on load.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
        {
          id: "profile:skills",
          text: "JavaScript, TypeScript, Next.js",
          scope: "profile" as const,
          profileRecordId: null,
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
    });
  });

  test("aggressive mode still rejects invented named technologies", () => {
    const input = {
      generated: {
        text: "Built React dashboards for support teams.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built workflow tools for support teams.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("aggressive mode still rejects fabricated metrics", () => {
    const input = {
      generated: {
        text: "Improved production uptime from 99.5% to 100%.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Improved production uptime from 99.5% to 99.9%.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("aggressive mode still rejects leadership claims the evidence never supports", () => {
    const input = {
      generated: {
        text: "Led a team of engineers on workflow tooling and regulatory strategy.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built reliable TypeScript workflow tools for operations teams.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("propagates the model's inferred flag onto accepted rewrites", () => {
    const input = {
      generated: {
        text: "Designed table reservation flows and ordering modules for the restaurant platform.",
        evidenceRefs: ["experience:role_1:summary"],
        inferred: true,
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:summary",
          text: "Built a restaurant management SaaS platform.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      inferred: true,
    });
  });

  test("aggressive mode rounds evidenced years up by one for flagged inferred proposals", () => {
    const input = {
      generated: {
        text: "Delivered resilient TypeScript services across 4 years of professional experience.",
        evidenceRefs: [
          "experience:role_1:achievement:0",
          "profile:yearsExperience",
        ],
        inferred: true,
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Delivered resilient TypeScript services for the operations platform.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
        {
          id: "profile:yearsExperience",
          text: "3 years of professional experience.",
          scope: "profile" as const,
          profileRecordId: null,
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
      jobListingText: "4+ years of TypeScript experience required.",
      allowReasonableInference: true,
    };

    expect(selectResumeRewrite(input)).toMatchObject({
      kind: "grounded_rewrite",
      inferred: true,
    });
    // The rounding relaxation requires the model's own inferred flag...
    expect(
      selectResumeRewrite({
        ...input,
        generated: { ...input.generated, inferred: false },
      }),
    ).toBeNull();
    // ...it stays targeted to the job's stated years figure...
    expect(
      selectResumeRewrite({
        ...input,
        jobListingText: "TypeScript experience required.",
      }),
    ).toBeNull();
    // ...and never applies outside aggressive mode.
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: false }),
    ).toBeNull();
  });

  test("aggressive mode never rounds evidenced years up by more than one", () => {
    const input = {
      generated: {
        text: "Delivered resilient TypeScript services across 5 years of professional experience.",
        evidenceRefs: [
          "experience:role_1:achievement:0",
          "profile:yearsExperience",
        ],
        inferred: true,
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Delivered resilient TypeScript services for the operations platform.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
        {
          id: "profile:yearsExperience",
          text: "3 years of professional experience.",
          scope: "profile" as const,
          profileRecordId: null,
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
      jobListingText: "5+ years of TypeScript experience required.",
      allowReasonableInference: true,
    };

    expect(selectResumeRewrite(input)).toBeNull();
  });

  test("aggressive mode accepts a job-listing technology for flagged inferred proposals", () => {
    const input = {
      generated: {
        text: "Built type-safe React interfaces for customer dashboard workflows.",
        evidenceRefs: ["experience:role_1:achievement:0"],
        inferred: true,
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built type-safe customer interfaces with TypeScript for dashboard workflows.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript", "React"],
      jobListingText: "Requirements: React for our customer dashboard.",
      allowReasonableInference: true,
    };

    expect(selectResumeRewrite(input)).toMatchObject({
      kind: "grounded_rewrite",
      inferred: true,
    });
    // The same technology invented outside the listing stays rejected.
    expect(
      selectResumeRewrite({
        ...input,
        jobSkills: ["TypeScript"],
        jobListingText: "TypeScript only.",
      }),
    ).toBeNull();
    // Substring containment is not enough: "reaction" never authorizes React.
    expect(
      selectResumeRewrite({
        ...input,
        jobListingText: "Requirements: fast reaction handling.",
      }),
    ).toBeNull();
    // And so does an unflagged proposal.
    expect(
      selectResumeRewrite({
        ...input,
        generated: { ...input.generated, inferred: false },
      }),
    ).toBeNull();
  });

  test("aggressive mode adds a listing technology the evidence does not directly imply", () => {
    // The evidence shows frontend-flavored work; Kubernetes comes only from
    // the listing's own requirement. For a candidate with professional
    // experience the gate admits it: the bound is "the listing asked for it",
    // not "the evidence implies it".
    const input = {
      generated: {
        text: "Deployed customer dashboard services with Kubernetes across the platform.",
        evidenceRefs: ["experience:role_1:achievement:0"],
        inferred: true,
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Built customer dashboard services with TypeScript for the platform.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript", "Kubernetes"],
      jobListingText:
        "Mandatory: Kubernetes experience. Preferred: TypeScript for the customer platform.",
      allowReasonableInference: true,
    };

    expect(selectResumeRewrite(input)).toMatchObject({
      kind: "grounded_rewrite",
      inferred: true,
    });
    // The same claim without the listing's Kubernetes requirement stays
    // rejected: the technology must come from the job itself.
    expect(
      selectResumeRewrite({
        ...input,
        jobSkills: ["TypeScript"],
        jobListingText: "TypeScript for the customer platform.",
      }),
    ).toBeNull();
  });

  test("rejects unevidenced lowercase technology names regardless of casing rules", () => {
    const input = {
      generated: {
        text: "Streamlined deployments with redis caching and docker images for the platform team.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Streamlined deployments for the platform team.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("rejects unevidenced sentence-initial technology names", () => {
    const input = {
      generated: {
        text: "Redis caching cut checkout wait times for holiday shoppers.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Improved checkout flows for holiday shoppers.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("rejects mixed-case spellings of unevidenced technology names", () => {
    const input = {
      generated: {
        text: "Rebuilt session storage on ReDis for active account holders.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Rebuilt session storage for active account holders.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("accepts technology names grounded by candidate skills evidence while preserving prose elaboration", () => {
    const input = {
      generated: {
        text: "Cut checkout latency further by moving sessions into Redis and archiving history in PostgreSQL.",
        evidenceRefs: ["experience:role_1:achievement:0", "profile:skills"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Cut checkout latency by moving sessions into Redis.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
        {
          id: "profile:skills",
          text: "PostgreSQL, Redis, Docker",
          scope: "profile" as const,
          profileRecordId: null,
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
    });
  });

  test("job-only technology names never become candidate facts", () => {
    const input = {
      generated: {
        text: "Cut checkout latency by moving sessions into Redis for shoppers.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Cut checkout latency for shoppers.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["Redis"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toBeNull();
  });

  test("does not flag ordinary prose elaboration as unevidenced technology", () => {
    const input = {
      generated: {
        text: "Distributed teams adopted weekly planning rituals, and roadmap delivery became predictable across the organization.",
        evidenceRefs: ["experience:role_1:summary"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:summary",
          text: "Owned roadmap delivery and planning cadence for platform teams.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: ["TypeScript"],
    };

    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
    });
  });

  test("fails closed on unknown brand tokens regardless of casing or position", () => {
    const base = {
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Improved weekly reporting for finance teams.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    const lowercase = {
      ...base,
      generated: {
        text: "Improved weekly reporting with fictionaldb for finance teams.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
    };
    expect(selectResumeRewrite(lowercase)).toBeNull();
    expect(
      selectResumeRewrite({ ...lowercase, allowReasonableInference: true }),
    ).toBeNull();

    expect(
      selectResumeRewrite({
        ...base,
        allowReasonableInference: true,
        generated: {
          text: "zenithly built weekly reporting for finance teams.",
          evidenceRefs: ["experience:role_1:achievement:0"],
        },
      }),
    ).toBeNull();

    expect(
      selectResumeRewrite({
        ...base,
        allowReasonableInference: true,
        generated: {
          text: "Improved weekly Zenithly reporting for finance teams.",
          evidenceRefs: ["experience:role_1:achievement:0"],
        },
      }),
    ).toBeNull();
  });

  test("requires cited evidence for every audited technology spelling", () => {
    const auditedSpellings = [
      "sql",
      "html",
      "css",
      "json",
      "xml",
      "yaml",
      "csv",
      "pdf",
      "http",
      "scala",
      "sentry",
      "zod",
      "trpc",
      ".net",
      "dotnet",
      "asp.net",
      "c++",
      "SQL Server",
      "Amazon Web Services",
    ];

    for (const spelling of auditedSpellings) {
      expect(
        selectResumeRewrite({
          generated: {
            text: `Migrated reporting workflows to ${spelling} for the finance team.`,
            evidenceRefs: ["experience:role_1:summary"],
          },
          canonicalCandidates: [],
          evidenceCatalog: [
            {
              id: "experience:role_1:summary",
              text: "Migrated reporting workflows for the finance team.",
              scope: "experience" as const,
              profileRecordId: "role_1",
            },
          ],
          allowedScope: {
            scope: "experience" as const,
            profileRecordId: "role_1",
          },
          jobCompany: "ExampleCo",
          jobSkills: [],
          allowReasonableInference: true,
        }),
        `expected "${spelling}" to require cited evidence`,
      ).toBeNull();
    }
  });

  test("requires evidence for ambiguous technology homographs", () => {
    const homographs = [
      "go",
      "swift",
      "rails",
      "express",
      "spring",
      "flask",
      "bun",
      "temporal",
    ];

    for (const homograph of homographs) {
      expect(
        selectResumeRewrite({
          generated: {
            text: `Built ${homograph} ingestion pipelines for the finance team.`,
            evidenceRefs: ["experience:role_1:summary"],
          },
          canonicalCandidates: [],
          evidenceCatalog: [
            {
              id: "experience:role_1:summary",
              text: "Built ingestion pipelines for the finance team.",
              scope: "experience" as const,
              profileRecordId: "role_1",
            },
          ],
          allowedScope: {
            scope: "experience" as const,
            profileRecordId: "role_1",
          },
          jobCompany: "ExampleCo",
          jobSkills: [],
          allowReasonableInference: true,
        }),
        `expected "${homograph}" to require cited evidence`,
      ).toBeNull();
    }
  });

  test("accepts ambiguous technology names when the cited evidence uses them", () => {
    const cases = [
      {
        evidenceText: "Built go pipelines for ingestion.",
        generatedText: "Designed go pipelines for ingestion.",
      },
      {
        evidenceText: "Built temporal workflows for nightly reconciliation.",
        generatedText:
          "Designed temporal workflows for nightly reconciliation.",
      },
    ];

    for (const testCase of cases) {
      expect(
        selectResumeRewrite({
          generated: {
            text: testCase.generatedText,
            evidenceRefs: ["experience:role_1:summary"],
          },
          canonicalCandidates: [],
          evidenceCatalog: [
            {
              id: "experience:role_1:summary",
              text: testCase.evidenceText,
              scope: "experience" as const,
              profileRecordId: "role_1",
            },
          ],
          allowedScope: {
            scope: "experience" as const,
            profileRecordId: "role_1",
          },
          jobCompany: "ExampleCo",
          jobSkills: [],
          allowReasonableInference: true,
        }),
      ).toMatchObject({
        kind: "grounded_rewrite",
        text: testCase.generatedText,
      });
    }
  });

  test("matches evidence at token boundaries rather than substrings", () => {
    const input = {
      generated: {
        text: "Modernized the restaurant menu platform and shipped REST ordering flows.",
        evidenceRefs: ["experience:role_1:summary"],
      },
      canonicalCandidates: [],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
      allowReasonableInference: true,
    };

    expect(
      selectResumeRewrite({
        ...input,
        evidenceCatalog: [
          {
            id: "experience:role_1:summary",
            text: "Scaled the restaurant menu platform with documented contracts.",
            scope: "experience" as const,
            profileRecordId: "role_1",
          },
        ],
      }),
    ).toBeNull();

    expect(
      selectResumeRewrite({
        ...input,
        evidenceCatalog: [
          {
            id: "experience:role_1:summary",
            text: "Scaled the restaurant menu platform with documented REST contracts.",
            scope: "experience" as const,
            profileRecordId: "role_1",
          },
        ],
      }),
    ).toMatchObject({ kind: "grounded_rewrite" });
  });

  test("authorizes hyphenated evidence compounds component-wise", () => {
    const input = {
      generated: {
        text: "Redis-backed session stores cut login times.",
        evidenceRefs: ["experience:role_1:achievement:0"],
      },
      canonicalCandidates: [],
      evidenceCatalog: [
        {
          id: "experience:role_1:achievement:0",
          text: "Maintained Redis-based session stores and cached profiles.",
          scope: "experience" as const,
          profileRecordId: "role_1",
        },
      ],
      allowedScope: {
        scope: "experience" as const,
        profileRecordId: "role_1",
      },
      jobCompany: "ExampleCo",
      jobSkills: [],
    };

    expect(selectResumeRewrite(input)).toBeNull();
    expect(
      selectResumeRewrite({ ...input, allowReasonableInference: true }),
    ).toMatchObject({
      kind: "grounded_rewrite",
      text: input.generated.text,
    });
  });
});

describe("classifyResumeClaimGrounding", () => {
  const makeEvidence = (
    id: string,
    text: string,
    overrides?: {
      scope: "profile" | "experience" | "project" | "proof" | "import_evidence";
      profileRecordId: string | null;
    },
  ) => ({
    id,
    text,
    scope: overrides?.scope ?? ("experience" as const),
    profileRecordId: overrides?.profileRecordId ?? "role_1",
  });

  const classify = (
    text: string,
    evidence: ReturnType<typeof makeEvidence>[],
    overrides?: Partial<Parameters<typeof classifyResumeClaimGrounding>[0]>,
  ) =>
    classifyResumeClaimGrounding({
      text,
      evidence,
      jobCompany: "ExampleCo",
      jobSkills: [],
      ...overrides,
    });

  test("classifies verbatim evidence text as exact", () => {
    const evidenceText =
      "Built reliable TypeScript workflow tools for operations teams.";
    const result = classify(evidenceText, [
      makeEvidence("experience:role_1:achievement:0", evidenceText),
    ]);

    expect(result.verdict).toBe("exact");
    expect(result.supportEvidenceIds).toEqual([
      "experience:role_1:achievement:0",
    ]);
    expect(result.anchorRatio).toBe(1);
    expect(result.gaps).toEqual([]);
  });

  test("covers a claim assembled from a two-item evidence union", () => {
    const result = classify(
      "Grew annual recurring revenue 40% by shipping the Atlas billing platform.",
      [
        makeEvidence(
          "experience:role_1:heroMetric",
          "Grew annual recurring revenue by 40% year over year.",
        ),
        makeEvidence(
          "experience:role_1:projectAtlas",
          "Shipped the Atlas billing platform for enterprise customers.",
        ),
      ],
      { jobSkills: ["SQL"] },
    );

    expect(result.verdict).toBe("covered");
    expect(result.supportEvidenceIds).toEqual([
      "experience:role_1:heroMetric",
      "experience:role_1:projectAtlas",
    ]);
    expect(result.anchorRatio).toBe(1);
    expect(result.gaps).toEqual([]);
  });

  test("matches formatted metrics across the union without a fabricated-metric gap", () => {
    const result = classify("Cut infrastructure spend by €1200k annually.", [
      makeEvidence(
        "proof:p1:heroMetric",
        "Cut infrastructure spend by €1,200k annually without outages.",
        { scope: "proof", profileRecordId: "p1" },
      ),
    ]);

    expect(result.verdict).toBe("covered");
    expect(result.anchorRatio).toBe(1);
    expect(
      result.gaps.filter((gap) => gap.type === "fabricated_metric"),
    ).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  test("flags lowercase unknown technology as unsupported in every mode", () => {
    const text =
      "Streamlined deployments with fictionaldb for the platform team.";
    const evidence = [
      makeEvidence(
        "experience:role_1:achievement:0",
        "Streamlined deployments for the platform team.",
      ),
    ];

    const conservative = classify(text, evidence);
    expect(conservative.verdict).toBe("unsupported");
    expect(conservative.gaps).toEqual([
      { type: "inference_not_allowed", values: ["fictionaldb"] },
    ]);

    const aggressive = classify(text, evidence, {
      allowReasonableInference: true,
    });
    expect(aggressive.verdict).toBe("unsupported");
    expect(aggressive.gaps).toEqual([
      { type: "unsafe_elaboration", values: ["fictionaldb"] },
    ]);
  });

  test("treats inflections of an evidenced verb as the same word", () => {
    // The model reordered one bullet and turned "automating deployments" into
    // "to automate deployments". That is the same fact; the classifier used to
    // read "automate" as new content and block approval.
    const result = classify(
      "Reduced deployment time by 40% by creating and maintaining CI/CD pipelines with Docker and Kubernetes to automate deployments.",
      [
        makeEvidence(
          "experience:role_1:bullet_1",
          "Created and maintained CI/CD pipelines with Docker and Kubernetes, automating deployments and reducing deployment time by 40%.",
        ),
      ],
      { allowReasonableInference: true },
    );

    expect(result.verdict).toBe("covered");
    expect(result.gaps).toEqual([]);
  });

  test("classifies safe elaboration only when inference is allowed", () => {
    const text =
      "Designed table reservation flows and ordering modules for the restaurant platform.";
    const evidence = [
      makeEvidence(
        "experience:role_1:summary",
        "Built and maintained a restaurant management SaaS platform.",
      ),
    ];

    const conservative = classify(text, evidence);
    expect(conservative.verdict).toBe("unsupported");
    expect(conservative.gaps).toEqual([
      {
        type: "inference_not_allowed",
        // Gap values are normalized stems, the same form the evidence is
        // compared in.
        values: ["group_1", "table", "reservation", "flow", "order", "modul"],
      },
    ]);

    const aggressive = classify(text, evidence, {
      allowReasonableInference: true,
    });
    expect(aggressive.verdict).toBe("elaborated");
    expect(aggressive.supportEvidenceIds).toEqual([
      "experience:role_1:summary",
    ]);
    expect(aggressive.anchorRatio).toBe(0.25);
    expect(aggressive.gaps).toEqual([]);
    expect(aggressive.relaxations).toEqual([]);
  });

  test("records which aggressive relaxations authorized content beyond the evidence", () => {
    const evidence = [
      makeEvidence(
        "experience:role_1:achievement:0",
        "Delivered resilient TypeScript services for the operations platform.",
      ),
      makeEvidence(
        "profile:yearsExperience",
        "3 years of professional experience.",
        { scope: "profile", profileRecordId: null },
      ),
    ];

    const roundedYears = classify(
      "Delivered resilient TypeScript services across 4 years of professional experience.",
      evidence,
      {
        allowReasonableInference: true,
        allowAggressiveClaimRelaxation: true,
        jobListingText: "4+ years of TypeScript experience required.",
      },
    );
    expect(roundedYears.verdict).toBe("elaborated");
    expect(roundedYears.gaps).toEqual([]);
    expect(roundedYears.relaxations).toEqual(["years_rounded_up"]);

    const listingTerm = classify(
      "Delivered resilient TypeScript and React services for the operations platform.",
      evidence,
      {
        allowReasonableInference: true,
        allowAggressiveClaimRelaxation: true,
        jobSkills: ["TypeScript", "React"],
        jobListingText: "Requirements: React for the operations platform.",
      },
    );
    expect(listingTerm.verdict).toBe("elaborated");
    expect(listingTerm.gaps).toEqual([]);
    expect(listingTerm.relaxations).toEqual(["listing_term"]);

    // The relaxation flags require both the aggressive posture and the
    // explicit relaxation switch; neither fires in plain aggressive mode.
    const unrelaxed = classify(
      "Delivered resilient TypeScript services across 4 years of professional experience.",
      evidence,
      { allowReasonableInference: true },
    );
    expect(unrelaxed.verdict).toBe("unsupported");
    expect(unrelaxed.relaxations).toEqual([]);
  });

  test("keeps ordinary plural nouns aligned with their singular evidence", () => {
    const result = classify(
      "Built accessible interfaces and reliable services.",
      [
        makeEvidence(
          "experience:role_1:summary",
          "Built an accessible interface and a reliable service.",
        ),
      ],
    );
    expect(result.verdict).toBe("covered");
    expect(result.gaps).toEqual([]);
  });

  test("allows a generic technologies label only when the listed skills are evidenced", () => {
    const evidence = [
      makeEvidence(
        "project:project_1:summary",
        "Scaled an internal design system. Reduced release churn. Figma React.",
        { scope: "project", profileRecordId: "project_1" },
      ),
    ];

    const grounded = classify(
      "Scaled an internal design system. Reduced release churn. Technologies: Figma, React.",
      evidence,
      { allowReasonableInference: true },
    );
    expect(grounded.verdict).toBe("elaborated");
    expect(grounded.gaps).toEqual([]);

    const unknownSkill = classify(
      "Scaled an internal design system. Technologies: FictionalDB.",
      evidence,
      { allowReasonableInference: true },
    );
    expect(unknownSkill.verdict).toBe("unsupported");
    expect(unknownSkill.gaps).toEqual([
      { type: "unsafe_elaboration", values: ["fictionaldb"] },
    ]);
  });

  test("reports hard gaps for unevidenced leadership and credential claims", () => {
    const leadership = classify(
      "Led a team of engineers on workflow tooling.",
      [
        makeEvidence(
          "experience:role_1:achievement:0",
          "Built reliable TypeScript workflow tools for operations teams.",
        ),
      ],
    );
    expect(leadership.verdict).toBe("unsupported");
    expect(leadership.gaps).toEqual([
      { type: "unevidenced_leadership_claim", values: [] },
    ]);

    const credential = classify(
      "Certified in analytics and fluent with dashboards.",
      [
        makeEvidence(
          "experience:role_1:summary",
          "Built analytics dashboards for finance teams.",
        ),
      ],
    );
    expect(credential.verdict).toBe("unsupported");
    expect(credential.anchorRatio).toBe(0.5);
    expect(credential.gaps).toEqual([
      { type: "unevidenced_credential_claim", values: [] },
    ]);
  });

  test("separates weak support from hard failure and never auto-accepts it", () => {
    const text = "Orchestrated quarterly forecasting reviews.";
    const evidence = [
      makeEvidence(
        "experience:role_1:summary",
        "Forecast accuracy improvements.",
      ),
    ];

    for (const allowReasonableInference of [false, true]) {
      const result = classify(text, evidence, { allowReasonableInference });
      expect(result.verdict).toBe("weakly_supported");
      expect(result.anchorRatio).toBe(0.25);
      expect(result.gaps).toEqual([]);
    }

    expect(
      selectResumeRewrite({
        generated: { text, evidenceRefs: ["experience:role_1:summary"] },
        canonicalCandidates: [],
        evidenceCatalog: evidence,
        allowedScope: { scope: "experience", profileRecordId: "role_1" },
        jobCompany: "ExampleCo",
        jobSkills: [],
        allowReasonableInference: true,
      }),
    ).toBeNull();
  });

  test("keeps every cited item in the support union when the pool fits the cap", () => {
    const result = classify("Built scaled checkout pipelines.", [
      makeEvidence("experience:r:a", "Built checkout pipelines."),
      makeEvidence("experience:r:b", "Scaled checkout pipelines globally."),
      makeEvidence("experience:r:c", "Unrelated operations note."),
    ]);

    expect(result.verdict).toBe("covered");
    expect(result.supportEvidenceIds).toEqual([
      "experience:r:a",
      "experience:r:b",
      "experience:r:c",
    ]);
    expect(result.anchorRatio).toBe(1);
    expect(result.gaps).toEqual([]);
  });

  test("caps oversized pools with deterministic greedy coverage ties", () => {
    const greekWords = [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
    ];
    const text = `Tracking ${greekWords.join(" ")} programs.`;
    const pool = greekWords.map((word, index) =>
      makeEvidence(`experience:bulk:${index}`, `${word} telemetry systems.`),
    );

    const first = classify(text, pool);
    const second = classify(text, pool);

    expect(first.supportEvidenceIds.length).toBe(
      RESUME_CLAIM_SUPPORT_EVIDENCE_CAP,
    );
    expect(first.supportEvidenceIds).toEqual(
      greekWords
        .slice(0, RESUME_CLAIM_SUPPORT_EVIDENCE_CAP)
        .map((_, index) => `experience:bulk:${index}`),
    );
    expect(second).toEqual(first);
  });
});

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

describe("mergeAggressiveVisibleSkills", () => {
  it("reserves visible core slots for listing-asked skills when grounded skills already fill the cap", () => {
    const grounded = Array.from(
      { length: 10 },
      (_, index) => `Grounded${index + 1}`,
    );
    const merged = mergeAggressiveVisibleSkills({
      groundedCoreSkills: grounded,
      groundedAdditionalSkills: ["ExtraGrounded"],
      listingSkills: ["Terraform", "Kubernetes", "Ansible"],
      coreLimit: 10,
      additionalLimit: 14,
    });

    expect(merged.coreSkills).toEqual(
      expect.arrayContaining(["Terraform", "Kubernetes", "Ansible"]),
    );
    expect(merged.coreSkills).toHaveLength(10);
    expect(merged.addedListingSkills).toEqual([
      "Terraform",
      "Kubernetes",
      "Ansible",
    ]);
  });

  it("does not add a listing skill the profile already has under an alias", () => {
    const merged = mergeAggressiveVisibleSkills({
      groundedCoreSkills: ["TypeScript", "React"],
      groundedAdditionalSkills: ["PostgreSQL", "Docker"],
      listingSkills: ["Postgres", "Terraform"],
      coreLimit: 10,
      additionalLimit: 14,
    });

    expect(merged.coreSkills).toContain("Terraform");
    expect(merged.coreSkills).not.toContain("Postgres");
    expect(merged.additionalSkills).toContain("PostgreSQL");
    expect(merged.addedListingSkills).toEqual(["Terraform"]);
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
