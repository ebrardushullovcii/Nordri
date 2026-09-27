import { describe, expect, test } from "vitest";
import {
  buildStructuredCandidateJobs,
  buildGenericJobId,
  inferEmployerFromCompanyProfileHref,
  isJobPreferenceAligned,
  isLikelyAccessGateUrl,
  isLikelyDocumentAttachmentJob,
  isLikelyJobListingHubUrl,
  isLikelySiteUtilityJob,
  isListingIndexPageRecord,
  normalizeExtractedJobSourceId,
  stripCompanyMarketingBadges,
  observeLearnedSearchSurfaceRoutes,
  repairExtractedJobTitle,
  type ExtractedJobInput,
  repairWrappedCardTitle,
  shouldCanonicalizeSearchSurfaceDetailRoute,
  type SearchResultCardCandidate,
} from "./job-extraction";

describe("buildStructuredCandidateJobs", () => {
  // The live fallback_search path: harvested cards in, stored rows out. Unit
  // tests of the repair passed while these rows came back cut, so the entry
  // point itself is exercised here with the exact stored card text.
  describe("a wrapped card heading reaches the record whole", () => {
    const buildCard = (input: {
      canonicalUrl: string;
      title: string;
      company: string;
      lines: readonly string[];
      location?: string;
    }): SearchResultCardCandidate => ({
      canonicalUrl: input.canonicalUrl,
      anchorText: input.title,
      headingText: input.title,
      lines: [input.title, ...input.lines],
      companyText: input.company,
      ...(input.location === undefined ? {} : { locationText: input.location }),
    });

    test("keeps the slug witness when the run has learned the board's detail route", () => {
      // Two cards with numeric id hints teach the run a `/job/{id}` detail
      // route, and every listing's address is rewritten to it. That is what
      // the live run does, and it throws away the slug the repair reads.
      const jobs = buildStructuredCandidateJobs({
        pageUrl: "https://builtinchicago.org/jobs",
        maxJobs: 5,
        cardCandidates: [
          {
            ...buildCard({
              canonicalUrl:
                "https://builtinchicago.org/job/manager-credit-risk/11136865",
              title: "Manager",
              company: "Alliant Credit Union",
              location: "Chicago, IL",
              lines: [
                "Alliant Credit Union",
                "Manager Credit Risk",
                "2 Days Ago",
                "Hybrid",
                "Chicago, IL",
              ],
            }),
            sourceJobIdHint: "11136865",
          },
          {
            ...buildCard({
              canonicalUrl:
                "https://builtinchicago.org/job/analyst-insurance-solutions/11148521",
              title: "Analyst",
              company: "TransUnion",
              location: "Chicago, IL",
              lines: [
                "Analyst - Insurance Solutions at TransUnion - Yesterday - Hybrid - Chicago, IL",
              ],
            }),
            sourceJobIdHint: "11148521",
          },
        ],
      });

      expect(jobs.map((job) => job.title).sort()).toEqual([
        "Analyst - Insurance Solutions",
        "Manager Credit Risk",
      ]);
      expect(jobs.every((job) => job.location === "Chicago, IL")).toBe(true);
      // The address really was rewritten; the repair did not depend on it.
      expect(jobs.every((job) => !job.canonicalUrl.includes("credit-risk"))).toBe(
        true,
      );
    });

    test.each([
      {
        title: "Manager",
        company: "Alliant Credit Union",
        location: "Chicago, IL",
        canonicalUrl: "https://builtinchicago.org/job/manager-credit-risk/11136865",
        lines: [
          "Alliant Credit Union",
          "Manager Credit Risk",
          "2 Days Ago",
          "Hybrid",
          "Chicago, IL",
        ],
        expected: "Manager Credit Risk",
      },
      {
        title: "Principal,",
        company: "OCC",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/principal-platform-architecture/11144971",
        lines: [
          "OCC",
          "Principal, Platform Architecture",
          "2 Days Ago",
          "Hybrid",
          "Chicago, IL",
        ],
        expected: "Principal, Platform Architecture",
      },
      {
        title: "Manager,",
        company: "Metropolis Technologies",
        canonicalUrl:
          "https://builtinchicago.org/job/manager-people-solutions/11145855",
        lines: [
          "Manager, People Solutions at Metropolis Technologies - 2 Days Ago - Easy Apply - In-Office",
        ],
        expected: "Manager, People Solutions",
      },
      {
        title: "Principal, Corporate Marketing Operations &",
        company: "Morningstar",
        canonicalUrl:
          "https://builtinchicago.org/job/principal-corporate-marketing-operations-enablement/11147281",
        lines: [
          "Principal, Corporate Marketing Operations & Enablement at Morningstar - Yesterday - Hybrid",
        ],
        expected: "Principal, Corporate Marketing Operations & Enablement",
      },
      {
        title: "Analyst",
        company: "TransUnion",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/analyst-insurance-solutions/11148521",
        lines: [
          "Analyst - Insurance Solutions at TransUnion - Yesterday - Hybrid - Chicago, IL",
        ],
        expected: "Analyst - Insurance Solutions",
      },
      {
        title: "2027 US Chess",
        company: "IMC Trading",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/2027-us-chess-academy-interest-form/11147852",
        lines: [
          "2027 US Chess Academy Interest Form at IMC Trading - Yesterday - Hybrid - Chicago, IL",
        ],
        expected: "2027 US Chess Academy Interest Form",
      },
      {
        title: "People Operations",
        company: "Belvedere Trading",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/people-operations-generalist/11139860",
        lines: [
          "Belvedere Trading",
          "People Operations Generalist",
          "2 Days Ago",
          "Hybrid",
          "Chicago, IL",
        ],
        expected: "People Operations Generalist",
      },
      {
        title: "Sales Support Associate",
        company: "Tapestry",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/sales-support-associate-i/8946587",
        lines: [
          "Sales Support Associate I at Tapestry - Hybrid - Chicago, IL",
        ],
        expected: "Sales Support Associate I",
      },
    ])("stores $expected whole", (row) => {
      const [job] = buildStructuredCandidateJobs({
        pageUrl: "https://builtinchicago.org/jobs",
        maxJobs: 5,
        cardCandidates: [
          buildCard({
            canonicalUrl: row.canonicalUrl,
            title: row.title,
            company: row.company,
            lines: row.lines,
            ...(row.location === undefined ? {} : { location: row.location }),
          }),
        ],
      });

      expect(job?.title).toBe(row.expected);
      if (row.location !== undefined) {
        expect(job?.location).toBe(row.location);
      }
    });
  });

  test("restores a title cut to its painted first line, however the record was built", () => {
    const [structured] = buildStructuredCandidateJobs({
      pageUrl: "https://builtinchicago.org/jobs",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl:
            "https://builtinchicago.org/job/manager-credit-risk/11136865",
          title: "Manager",
          company: "Alliant Credit Union",
          location: "Chicago, IL",
          summary:
            "Manager Credit Risk at Alliant Credit Union - Hybrid - Chicago, IL - 2 Days Ago",
          description:
            "Manager Credit Risk at Alliant Credit Union - Hybrid - Chicago, IL - 2 Days Ago",
        },
      ],
    });

    expect(structured?.title).toBe("Manager Credit Risk");
    expect(structured?.company).toBe("Alliant Credit Union");
    expect(structured?.location).toBe("Chicago, IL");
  });

  test("builds jobs from generic search-result card candidates without site-specific rules", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/roles/frontend-engineer?utm_source=test",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: [
            "Frontend Engineer",
            "Acme",
            "Remote",
            "Build product interfaces for customer workflows.",
            "Posted 2 days ago",
            "Easy Apply",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "jobs_example_com_roles_frontend_engineer",
        canonicalUrl: "https://jobs.example.com/roles/frontend-engineer",
        title: "Frontend Engineer",
        company: "Acme",
        location: "Remote",
        applyPath: "easy_apply",
        easyApplyEligible: true,
        postedAt: null,
        postedAtText: "Posted 2 days ago",
        summary: "Build product interfaces for customer workflows.",
      }),
    ]);
  });

  test("does not read a call to action ending in today as a posting date", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/warehouse-associate",
          anchorText: "Warehouse Associate",
          headingText: "Warehouse Associate",
          lines: [
            "Warehouse Associate",
            "Acme Logistics",
            "Denver, CO",
            "Weekly pay and flexible shifts. Apply Today",
          ],
        },
      ],
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.postedAtText).toBeNull();
    expect(jobs[0]?.postedAt).toBeNull();
  });

  test("drops a structured posted value that is not a date", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/support-lead",
          sourceJobId: "job_schema_nope",
          title: "Support Lead",
          company: "Acme",
          location: "Remote",
          description: "Lead the customer support team.",
          summary: "Lead support.",
          postedAtText: "NOPE",
          applyPath: "unknown",
          easyApplyEligible: false,
        },
      ],
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.postedAtText).toBeNull();
  });

  test("keeps a structured posted value that reads as a date", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/support-lead",
          sourceJobId: "job_schema_dated",
          title: "Support Lead",
          company: "Acme",
          location: "Remote",
          description: "Lead the customer support team.",
          summary: "Lead support.",
          postedAtText: "04 Sept 2026",
          applyPath: "unknown",
          easyApplyEligible: false,
        },
      ],
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.postedAtText).toBe("04 Sept 2026");
  });

  test("infers employer from /company/{slug}/ listing URLs (Wellfound-style)", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://wellfound.com/jobs",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://wellfound.com/company/signal-systems/jobs/123456-software-engineer",
          anchorText: "Software Engineer",
          headingText: null,
          lines: [
            "Software Engineer",
            "Remote",
            "Build backend services for hiring workflows.",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        title: "Software Engineer",
        company: "Signal Systems",
      }),
    ]);
  });

  test("infers employer from company profile href when job URL is /jobs/{id}-…", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://wellfound.com/role/r/software-engineer",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://wellfound.com/jobs/4634158-ai-product-engineer",
          anchorText: "AI Product Engineer",
          headingText: "AI Product Engineer",
          companyHref: "https://wellfound.com/company/signal-systems",
          lines: [
            "AI Product Engineer",
            "Remote",
            "Ship AI product workflows for hiring teams.",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        title: "AI Product Engineer",
        company: "Signal Systems",
        canonicalUrl: "https://wellfound.com/jobs/4634158-ai-product-engineer",
      }),
    ]);
  });

  test("does not invent an employer from a bare /jobs/{id}-… URL alone", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://wellfound.com/role/r/software-engineer",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://wellfound.com/jobs/4634158-ai-product-engineer",
          anchorText: "AI Product Engineer",
          headingText: "AI Product Engineer",
          lines: [
            "AI Product Engineer",
            "Remote · Full-time",
            "Ship AI product workflows for hiring teams.",
          ],
        },
      ],
    });

    expect(jobs).toHaveLength(1);
    // Without company-path evidence, never invent from the numeric job id or
    // title slug in the URL.
    expect(jobs[0]?.company).not.toMatch(/4634158|Ai Product Engineer/i);
    expect(jobs[0]?.company).not.toBe("Signal Systems");
  });

  test("inferEmployerFromCompanyProfileHref accepts hubs and rejects noise", () => {
    expect(
      inferEmployerFromCompanyProfileHref(
        "https://wellfound.com/company/signal-systems",
      ),
    ).toBe("Signal Systems");
    expect(
      inferEmployerFromCompanyProfileHref(
        "https://wellfound.com/company/signal-systems/jobs/1-role",
      ),
    ).toBe("Signal Systems");
    expect(
      inferEmployerFromCompanyProfileHref(
        "https://wellfound.com/company/sigma-computing-2",
      ),
    ).toBe("Sigma Computing");
    expect(
      inferEmployerFromCompanyProfileHref("https://wellfound.com/jobs/1-role"),
    ).toBeNull();
    expect(
      inferEmployerFromCompanyProfileHref("https://wellfound.com/company/jobs"),
    ).toBeNull();
  });

  test("prefers richer structured data when it is available on the page", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/frontend-engineer",
          sourceJobId: "job_schema_1",
          title: "Frontend Engineer",
          company: "Acme",
          location: "Remote",
          description: "Build product interfaces for the hiring platform.",
          summary: "Build product interfaces.",
          postedAt: "2026-03-20T10:00:00.000Z",
          providerUpdatedAt: "2026-03-20T12:30:00+02:00",
          salaryText: "$120k",
          workMode: ["remote"],
          applyPath: "easy_apply",
          easyApplyEligible: true,
          keySkills: ["React", "TypeScript"],
          responsibilities: ["Build hiring workflows"],
          minimumQualifications: ["3+ years with React"],
          employmentType: "Full-time",
        },
      ],
      cardCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/frontend-engineer",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Acme", "Remote"],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "job_schema_1",
        canonicalUrl: "https://jobs.example.com/roles/frontend-engineer",
        title: "Frontend Engineer",
        company: "Acme",
        location: "Remote",
        description: "Build product interfaces for the hiring platform.",
        salaryText: "$120k",
        applyPath: "easy_apply",
        easyApplyEligible: true,
        keySkills: ["React", "TypeScript"],
        responsibilities: ["Build hiring workflows"],
        providerUpdatedAt: "2026-03-20T10:30:00.000Z",
        minimumQualifications: ["3+ years with React"],
        employmentType: "Full-time",
      }),
    ]);
  });

  test("keeps cleaner structured fields when a merged card adds LinkedIn-style UI noise", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4399165260/?trackingId=abc123",
          sourceJobId: "4399165260",
          title: "Senior Full Stack Engineer (Typescript)",
          company: "Fresha",
          location: "Pristina (On-site)",
          description: "Build product systems for salons and marketplaces.",
          summary: "Build product systems.",
          applyPath: "unknown",
          easyApplyEligible: false,
          keySkills: ["TypeScript"],
        },
      ],
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4399165260/?trackingId=noisy-card",
          anchorText:
            "Senior Full Stack Engineer (Typescript) (Verified job) Fresha • Pristina (On-site) Dismiss Senior Full Stack Engineer (Typescript) job 1 connection works here Viewed · Promoted",
          headingText: null,
          lines: [
            "Senior Full Stack Engineer (Typescript) (Verified job) Fresha • Pristina (On-site) Dismiss Senior Full Stack Engineer (Typescript) job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        sourceJobId: "4399165260",
        canonicalUrl: "https://www.linkedin.com/jobs/view/4399165260/",
        title: "Senior Full Stack Engineer (Typescript)",
        company: "Fresha",
        location: "Pristina (On-site)",
      }),
    ]);
  });

  test("normalizes a repeated structured title before company and location metadata", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://www.linkedin.com/jobs/view/4399165260/",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4399165260/",
          sourceJobId: "4399165260",
          title:
            "Senior Full Stack Engineer (Typescript) Senior Full Stack Engineer (Typescript) Fresha Pristina, District of Pristina, Kosovo (Hybrid)",
          company: "Fresha",
          location: "Pristina, District of Pristina, Kosovo (Hybrid)",
          description: "Build product systems for salons and marketplaces.",
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        title: "Senior Full Stack Engineer (Typescript)",
        company: "Fresha",
        location: "Pristina, District of Pristina, Kosovo (Hybrid)",
      }),
    ]);
  });

  test("normalizes the same repeated title when it comes from a generic result card", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/roles/senior-full-stack-engineer",
          anchorText:
            "Senior Full Stack Engineer (Typescript) Senior Full Stack Engineer (Typescript)",
          headingText:
            "Senior Full Stack Engineer (Typescript) Senior Full Stack Engineer (Typescript)",
          lines: [
            "Senior Full Stack Engineer (Typescript) Senior Full Stack Engineer (Typescript)",
            "Fresha",
            "Pristina (Hybrid)",
            "Build product systems for salons and marketplaces.",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        title: "Senior Full Stack Engineer (Typescript)",
        company: "Fresha",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("preserves legitimate role and team wording that repeats a role token", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/roles/engineer-productivity",
      maxJobs: 5,
      structuredDataCandidates: [
        {
          canonicalUrl: "https://jobs.example.com/roles/engineer-productivity",
          sourceJobId: "engineer_productivity",
          title: "Senior Engineer, Engineer Productivity",
          company: "Acme",
          location: "Remote",
          description: "Improve the developer experience and build systems.",
        },
      ],
    });

    expect(jobs[0]?.title).toBe("Senior Engineer, Engineer Productivity");
  });

  test("normalizes LinkedIn detail tracking params so duplicate job variants merge into one candidate", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4404592001/?eBP=NOT_ELIGIBLE_FOR_CHARGING&refId=abc123",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Jobs Ai", "Remote"],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4404592001/",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Jobs Ai", "Remote"],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4404592001/",
        title: "Frontend Engineer",
        company: "Jobs Ai",
      }),
    ]);
  });

  test("normalizes selected-job query routes into stable detail urls learned from observed links", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?q=frontend&selected_job_id=4399165260",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?q=frontend&selected_job_id=4399165260",
          sourceJobIdHint: "4404057151",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
        {
          canonicalUrl: "https://jobs.example.com/jobs/4386674431/",
          anchorText: "Senior Backend Engineer",
          headingText: "Senior Backend Engineer",
          lines: ["Senior Backend Engineer", "Odiin", "Prishtina, Kosovo"],
        },
      ],
    });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://jobs.example.com/jobs/4404057151/",
          sourceJobId: "4404057151",
          title: "Full Stack Developer (AI-First)",
          company: "Full Circle Agency",
          location: "Pristina (Remote)",
        }),
      ]),
    );
  });

  test("prefers a card-level job id hint over the shared selected-job route on the same page", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4404057151&q=frontend",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4404057151&q=frontend",
          sourceJobIdHint: "4404542575",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
        {
          canonicalUrl: "https://jobs.example.com/jobs/4386674431/",
          anchorText: "Senior Backend Engineer",
          headingText: "Senior Backend Engineer",
          lines: ["Senior Backend Engineer", "Odiin", "Prishtina, Kosovo"],
        },
      ],
    });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://jobs.example.com/jobs/4404542575/",
          sourceJobId: "4404542575",
          title: "Full Stack Developer (AI-First)",
          company: "Full Circle Agency",
        }),
      ]),
    );
  });

  test("learns distinct detail-route shapes per host across two boards in one batch", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      maxJobs: 8,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
          sourceJobIdHint: "4404057151",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Odiin", "Remote"],
        },
        {
          canonicalUrl: "https://jobs.example.com/openings/4386674431",
          anchorText: "Platform Engineer",
          headingText: "Platform Engineer",
          lines: ["Platform Engineer", "Acme", "Hybrid"],
        },
        {
          canonicalUrl:
            "https://careers.acme.io/careers/search?q=platform&selected_job_id=4400784689",
          sourceJobIdHint: "4404592001",
          anchorText: "QA Automation Engineer",
          headingText: "QA Automation Engineer",
          lines: ["QA Automation Engineer", "Acme Labs", "Pristina"],
        },
        {
          canonicalUrl: "https://careers.acme.io/careers/openings/4386851676/",
          anchorText: "Backend Engineer",
          headingText: "Backend Engineer",
          lines: ["Backend Engineer", "Crossing Hurdles", "EMEA (Remote)"],
        },
      ],
    });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://jobs.example.com/openings/4404057151",
          sourceJobId: "4404057151",
          title: "Frontend Engineer",
        }),
        expect.objectContaining({
          canonicalUrl: "https://careers.acme.io/careers/openings/4404592001/",
          sourceJobId: "4404592001",
          title: "QA Automation Engineer",
        }),
      ]),
    );
  });

  test("keeps partial seeded-search cards when no detail-route shape was observed for the host", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
          sourceJobIdHint: "4404057151",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://jobs.example.com/search?q=frontend",
        title: "Full Stack Developer (AI-First)",
        company: "Full Circle Agency",
      }),
    ]);
    expect(jobs[0]?.sourceJobId).toContain("full_stack_developer_ai_first");
    expect(jobs[0]?.sourceJobId).not.toBe("4404057151");
  });

  test("does not build detail urls from malformed or non-numeric id hints", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
          sourceJobIdHint: "role_backend_crossing_hurdles",
          anchorText: "Back-End Engineer",
          headingText: "Back-End Engineer",
          lines: ["Back-End Engineer", "Crossing Hurdles", "Prishtina, Kosovo"],
        },
        {
          canonicalUrl: "https://jobs.example.com/jobs/4386674431/",
          anchorText: "Platform Engineer",
          headingText: "Platform Engineer",
          lines: ["Platform Engineer", "Acme", "Hybrid"],
        },
      ],
    });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://jobs.example.com/search?q=frontend",
          title: "Back-End Engineer",
        }),
      ]),
    );
  });

  test("refuses cross-origin detail templates when canonicalizing hinted cards", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://careers.acme.io/careers/search?q=platform&selected_job_id=4400784689",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
          sourceJobIdHint: "4404057151",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Odiin", "Remote"],
        },
        {
          canonicalUrl: "https://careers.acme.io/careers/openings/4386851676/",
          anchorText: "Backend Engineer",
          headingText: "Backend Engineer",
          lines: ["Backend Engineer", "Crossing Hurdles", "EMEA (Remote)"],
        },
      ],
    });

    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalUrl: "https://jobs.example.com/search?q=frontend",
          title: "Frontend Engineer",
        }),
      ]),
    );
  });

  test("does not canonicalize a seeded selected-job search route when the card does not prove that id", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://jobs.example.com/search?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
        title: "Full Stack Developer (AI-First)",
        company: "Full Circle Agency",
      }),
    ]);
    expect(jobs[0]?.sourceJobId).toContain("full_stack_developer_ai_first");
  });

  test("does not collapse multiple visible cards onto the shared seeded search route", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
          anchorText: "Frontend Engineer",
          headingText: "Frontend Engineer",
          lines: ["Frontend Engineer", "Odiin", "Prishtina, Kosovo"],
        },
        {
          canonicalUrl:
            "https://jobs.example.com/search?selected_job_id=4399165260&keywords=Senior%20Full-Stack%20Software%20Engineer&location=Prishtina%2C%20Kosovo",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Full Stack Developer (AI-First)" }),
        expect.objectContaining({ title: "Frontend Engineer" }),
      ]),
    );
  });

  test("does not collapse multiple visible cards onto the shared seeded search route when fallback capture has no card-level id proof", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://careers.acme.io/careers/search?keywords=Senior%20Frontend%20Engineer&location=Prishtina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://careers.acme.io/careers/search?keywords=Senior%20Frontend%20Engineer&location=Prishtina",
          anchorText: "Senior Frontend Engineer",
          headingText: "Senior Frontend Engineer",
          lines: ["Senior Frontend Engineer", "Odiin", "Prishtina, Kosovo"],
        },
        {
          canonicalUrl:
            "https://careers.acme.io/careers/search?keywords=Senior%20Frontend%20Engineer&location=Prishtina",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
            "Dismiss Full Stack Developer (AI-First) job",
          ],
        },
      ],
    });

    expect(jobs).toHaveLength(2);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Full Stack Developer (AI-First)" }),
        expect.objectContaining({ title: "Senior Frontend Engineer" }),
      ]),
    );
    expect(new Set(jobs.map((job) => job.sourceJobId)).size).toBe(2);
  });

  test("sanitizes LinkedIn-style noisy metadata lines into clean company and location fields", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://www.linkedin.com/jobs/collections/recommended/",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4399165260/?trackingId=noisy-card",
          anchorText:
            "Senior Full Stack Engineer (Typescript) (Verified job) Fresha • Pristina (On-site) Dismiss Senior Full Stack Engineer (Typescript) job 1 connection works here Viewed · Promoted",
          headingText: "Senior Full Stack Engineer (Typescript)",
          lines: [
            "Senior Full Stack Engineer (Typescript)",
            "Fresha • Pristina (On-site) Dismiss Senior Full Stack Engineer (Typescript) job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4399165260/",
        title: "Senior Full Stack Engineer (Typescript)",
        company: "Fresha",
        location: "Pristina (On-site)",
      }),
    ]);
  });

  test("never takes a card's age badge as the employer", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://weworkremotely.com/categories/remote-full-stack-programming-jobs",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://weworkremotely.com/remote-jobs/lemon-io-senior-net-full-stack-developer-1",
          anchorText: "Senior .NET Full-stack Developer 12d",
          headingText: "Senior .NET Full-stack Developer",
          lines: ["Senior .NET Full-stack Developer", "12d"],
        },
      ],
    });

    // A card with nothing but a title and an age badge has no employer to
    // report; whatever comes out, the badge is never it.
    expect(jobs.every((job) => job.company !== "12d")).toBe(true);
  });

  test("prefers the fuller LinkedIn dismiss-title when the visible heading is truncated", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4400784689/?trackingId=noisy-card",
          anchorText:
            ".NET Software Developer Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          headingText: ".NET",
          lines: [
            ".NET",
            "Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4400784689/",
        title: ".NET Software Developer",
        company: "Quipu GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("recovers repeated LinkedIn technical titles before company and location pollution", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4400784689/?trackingId=noisy-card",
          anchorText:
            ".NET Software Developer .NET Software Developer Quipu GmbH Pristina, District of Pristina, Kosovo (Hybrid)",
          headingText:
            ".NET Software Developer .NET Software Developer Quipu GmbH Pristina,",
          lines: [
            ".NET Software Developer .NET Software Developer Quipu GmbH Pristina, District of Pristina, Kosovo (Hybrid)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4400784689/",
        title: ".NET Software Developer",
      }),
    ]);
  });

  test("recovers the fuller LinkedIn dismiss-title from card lines when anchor text is still truncated", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Backend+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4400784690/?trackingId=noisy-card",
          anchorText: "Backend",
          headingText: "Backend",
          lines: [
            "Backend",
            "Acme • Pristina (Remote) Dismiss Backend TypeScript Engineer job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4400784690/",
        title: "Backend TypeScript Engineer",
        company: "Acme",
        location: "Pristina (Remote)",
      }),
    ]);
  });

  test("recovers fuller LinkedIn titles from dismiss labels when the visible title stops at seniority phrasing", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Full+Stack+Developer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4404592001/?trackingId=noisy-card",
          anchorText: "Mid-Level to Senior",
          headingText: "Mid-Level to Senior",
          lines: [
            "Mid-Level to Senior",
            "MKY Treuhandpartner GmbH",
            "Pristina (Hybrid)",
            "Dismiss Mid-Level to Senior Software Developer job",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4404592001/",
        title: "Mid-Level to Senior Software Developer",
        company: "MKY Treuhandpartner GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("recovers fuller LinkedIn titles from dismiss labels when the visible title is only a single seniority token", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4386674431/?trackingId=noisy-card",
          anchorText: "Senior",
          headingText: "Senior",
          lines: [
            "Senior",
            "Lodgify",
            "Remote",
            "Dismiss Senior Software Engineer job",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4386674431/",
        title: "Senior Software Engineer",
        company: "Lodgify",
        location: "Remote",
      }),
    ]);
  });

  test("recovers a stronger LinkedIn title from metadata when the heading is generic and the line repeats the title with verification noise", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://www.linkedin.com/jobs/collections/recommended/",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4385358746/",
          anchorText: "Senior",
          headingText: "Senior",
          lines: [
            "Senior",
            "Senior Go Developer Senior Go Developer with verification Proxify Kosovo (Remote) 3 school alumni work here Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4385358746/",
        title: "Senior Go Developer",
        company: "Proxify",
        location: "Kosovo (Remote)",
      }),
    ]);
  });

  test("does not keep a title-echo verification line as the company on LinkedIn cards", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_experienced/",
          anchorText: "Experienced Software Engineer",
          headingText: "Experienced Software Engineer",
          lines: [
            "Experienced Software Engineer",
            "Experienced Software Engineer Experienced Software Engineer with verification",
            "Proxify",
            "Kosovo (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/role_experienced/",
        title: "Experienced Software Engineer",
        company: "Proxify",
        location: "Kosovo (Remote)",
      }),
    ]);
  });

  test("strips malformed title-overlap fragments from confidential LinkedIn company metadata", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4404057151/",
          anchorText: "Full",
          headingText: "Full",
          lines: [
            "Full",
            "Full Stack Engineer Full Stack Engineer Confidential",
            "Remote",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4404057151/",
        title: "Full Stack Engineer",
        company: "Confidential",
        location: "Remote",
      }),
    ]);
  });

  test("splits polluted LinkedIn titles that append company text with an at separator", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_backend_crossing_hurdles/",
          anchorText: "Back-End Engineer | at Crossing Hurdles",
          headingText: "Back-End Engineer | at Crossing Hurdles",
          lines: [
            "Back-End Engineer | at Crossing Hurdles",
            "Prishtina, Kosovo",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_backend_crossing_hurdles/",
        title: "Back-End Engineer",
        company: "Crossing Hurdles",
        location: "Prishtina, Kosovo",
      }),
    ]);
  });

  test("recovers the technical title when a polluted LinkedIn heading reverses company and title around an at separator", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4386851676/",
          anchorText:
            "Crossing Hurdles EMEA (Remote) $230K/yr - $280K/yr at Software Engineer (Fullstack)",
          headingText:
            "Crossing Hurdles EMEA (Remote) $230K/yr - $280K/yr at Software Engineer (Fullstack)",
          lines: [
            "Crossing Hurdles EMEA (Remote) $230K/yr - $280K/yr at Software Engineer (Fullstack)",
            "Crossing Hurdles",
            "EMEA (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4386851676/",
        title: "Software Engineer (Fullstack)",
        company: "Crossing Hurdles",
        location: "EMEA (Remote)",
      }),
    ]);
  });

  test("sanitizes repeated LinkedIn title overlap even when the fallback title already has multiple words", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4404057151/",
          anchorText: "Full Stack Engineer Full",
          headingText: "Full Stack Engineer Full",
          lines: [
            "Full Stack Engineer Full Stack Engineer Confidential",
            "Remote",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4404057151/",
        title: "Full Stack Engineer",
        company: "Confidential",
        location: "Remote",
      }),
    ]);
  });

  test("prefers the recovered LinkedIn repeated title over a duplicated concatenated heading", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_frontend_concat/",
          anchorText:
            "Senior Frontend Engineer Senior Frontend Engineer Fresha",
          headingText:
            "Senior Frontend Engineer Senior Frontend Engineer Fresha",
          lines: [
            "Senior Frontend Engineer Senior Frontend Engineer Fresha • Pristina (On-site) 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_frontend_concat/",
        title: "Senior Frontend Engineer",
        company: "Fresha",
        location: "Pristina (On-site)",
      }),
    ]);
  });

  test("prefers the dismiss title when a LinkedIn heading is polluted with trailing company text", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_mky_polluted_heading/",
          anchorText:
            "Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          headingText:
            "Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH",
          lines: [
            "Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_mky_polluted_heading/",
        title: "Mid-Level to Senior Software Developer",
        company: "MKY Treuhandpartner GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("prefers the dismiss title when a LinkedIn heading repeats the title before the company", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_mky_repeated_heading/",
          anchorText:
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          headingText:
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH",
          lines: [
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_mky_repeated_heading/",
        title: "Mid-Level to Senior Software Developer",
        company: "MKY Treuhandpartner GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("prefers the dismiss title when a LinkedIn heading is polluted with trailing company text for Quipu-style cards", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_quipu_polluted_heading/",
          anchorText:
            ".NET Software Developer Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          headingText: ".NET Software Developer Quipu GmbH",
          lines: [
            ".NET Software Developer Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_quipu_polluted_heading/",
        title: ".NET Software Developer",
        company: "Quipu GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("prefers the dismiss title when a LinkedIn heading repeats the title before Quipu company text", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_quipu_repeated_heading/",
          anchorText:
            ".NET Software Developer .NET Software Developer Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          headingText:
            ".NET Software Developer .NET Software Developer Quipu GmbH",
          lines: [
            ".NET Software Developer .NET Software Developer Quipu GmbH • Pristina (Hybrid) Dismiss .NET Software Developer job 1 connection works here Viewed · Promoted",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_quipu_repeated_heading/",
        title: ".NET Software Developer",
        company: "Quipu GmbH",
        location: "Pristina (Hybrid)",
      }),
    ]);
  });

  test("keeps the richer LinkedIn candidate when the same job url first appears through a weak nested card", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Software+Engineer&location=Pristina",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4404057151/?trackingId=weak-card",
          anchorText: "Full",
          headingText: "Full",
          lines: ["Full", "Confidential Careers"],
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/4404057151/?trackingId=rich-card",
          anchorText:
            "Fullstack Developer | Remote Confidential Careers Dismiss Fullstack Developer | Remote job",
          headingText: "Fullstack Developer",
          lines: [
            "Fullstack Developer",
            "Confidential Careers",
            "Remote",
            "Dismiss Fullstack Developer | Remote job",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/4404057151/",
        title: "Fullstack Developer",
        company: "Confidential Careers",
        location: "Remote",
      }),
    ]);
  });

  test("prioritizes extracted jobs that better match the saved role and location when maxJobs is small", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_frontend/",
          anchorText: "Senior Frontend Engineer",
          headingText: "Senior Frontend Engineer",
          lines: ["Senior Frontend Engineer", "Fresha", "Pristina (On-site)"],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("does not let broad software engineer titles outrank the stronger full-stack card under the review cap", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_broad/",
          anchorText: "Experienced Software Engineer",
          headingText: "Experienced Software Engineer",
          lines: [
            "Experienced Software Engineer",
            "Broad Co",
            "Prishtina, Kosovo",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("prefers the local full-stack card over a broader Kosovo-only full-stack match under the review cap", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_broad_kosovo/",
          anchorText: "Senior Fullstack (MERN) Developer",
          headingText: "Senior Fullstack (MERN) Developer",
          lines: [
            "Senior Fullstack (MERN) Developer",
            "Proxify",
            "Kosovo (Remote)",
          ],
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_fullstack_local/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_fullstack_local/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("does not let a polluted LinkedIn software-developer card outrank the local full-stack card under the review cap", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_mky_polluted/",
          anchorText:
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina, District of Pristina, Kosovo (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          headingText:
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH",
          lines: [
            "Mid-Level to Senior Software Developer Mid-Level to Senior Software Developer MKY Treuhandpartner GmbH • Pristina, District of Pristina, Kosovo (Hybrid) Dismiss Mid-Level to Senior Software Developer job Viewed · Promoted",
          ],
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/role_fullstack_local/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Pristina (Remote)",
            "Dismiss Full Stack Developer (AI-First) job",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/role_fullstack_local/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("downranks malformed LinkedIn candidates so cleaner full-stack cards win the review cap", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_malformed/",
          anchorText: "Full",
          headingText: "Full",
          lines: ["Full", "Full Full with verification", "Remote"],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/role_fullstack/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("prefers real LinkedIn results-list cards over detail-pane contamination when selecting the capped batch", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/detail-pane-frontend/",
          anchorText: "Senior Frontend Engineer",
          headingText: "Senior Frontend Engineer",
          lines: ["Senior Frontend Engineer", "Odiin", "Prishtina, Kosovo"],
          captureMeta: {
            domOrder: 0,
            rootTagName: "aside",
            rootRole: null,
            rootClassName: "jobs-search__job-details detail-pane",
            hasJobDataset: false,
            sameRootJobAnchorCount: 5,
            inLikelyResultsList: false,
            inAside: true,
            inHeader: false,
            inNavigation: false,
            inDetailPane: true,
            hasDismissLabel: false,
          },
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/fullstack-list-card/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
            "Dismiss Full Stack Developer (AI-First) job",
          ],
          captureMeta: {
            domOrder: 1,
            rootTagName: "li",
            rootRole: "listitem",
            rootClassName: "jobs-search-results__list-item job-card-container",
            hasJobDataset: true,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: true,
            inAside: false,
            inHeader: false,
            inNavigation: false,
            inDetailPane: false,
            hasDismissLabel: true,
          },
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl: "https://www.linkedin.com/jobs/view/fullstack-list-card/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("parses LinkedIn composite result cards without dropping or contaminating jobs", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior%20Full-Stack%20Software%20Engineer&geoId=92000000&f_WT=2",
      maxJobs: 50,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: [],
      },
      cardCandidates: [
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4445516986/",
          sourceJobIdHint: "4445516986",
          anchorText:
            "Senior Full Stack Engineer (Node/React) - Remote Senior Full Stack Engineer (Node/React) - Remote with verification",
          headingText: null,
          lines: [
            "Senior Full Stack Engineer (Node/React) - Remote Senior Full Stack Engineer (Node/React) - Remote with verification",
            "Dismiss Senior Full Stack Engineer (Node/React) - Remote job",
            "Senior Full Stack Engineer (Node/React) - Remote Senior Full Stack Engineer (Node/React) - Remote with verification Kake Bengaluru, Karnataka, India (Remote) Actively reviewing applicants 1 week ago Easy Apply",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4444154507/",
          sourceJobIdHint: "4444154507",
          anchorText:
            "Senior Full Stack Software Engineer (React/Node) Senior Full Stack Software Engineer (React/Node) with verification",
          headingText: null,
          lines: [
            "Senior Full Stack Software Engineer (React/Node) Senior Full Stack Software Engineer (React/Node) with verification",
            "Dismiss Senior Full Stack Software Engineer (React/Node) job",
            "Senior Full Stack Software Engineer (React/Node) Senior Full Stack Software Engineer (React/Node) with verification Reputation United States (Remote) 401(k), +1 benefit 1 week ago",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4451384800/",
          sourceJobIdHint: "4451384800",
          anchorText:
            "Frontend Developer - TypeScript (Remote)Frontend Developer - TypeScript (Remote)",
          headingText: null,
          lines: [
            "Frontend Developer - TypeScript (Remote)Frontend Developer - TypeScript (Remote)",
            "Dismiss Frontend Developer - TypeScript (Remote) job",
            "Frontend Developer - TypeScript (Remote) Frontend Developer - TypeScript (Remote) Hire Feed EMEA (Remote) 23 hours ago Within the past 24 hours",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4450348065/",
          sourceJobIdHint: "4450348065",
          anchorText:
            "Software Engineer (Frontend) Software Engineer (Frontend) with verification",
          headingText: null,
          lines: [
            "Software Engineer (Frontend) Software Engineer (Frontend) with verification",
            "Dismiss Software Engineer (Frontend) job",
            "Software Engineer (Frontend) Software Engineer (Frontend) with verification Aditude United States (Remote) $115K/yr - $135K/yr · Vision benefit Viewed",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4448560474/",
          sourceJobIdHint: "4448560474",
          anchorText:
            "Software Engineer II, Fullstack Software Engineer II, Fullstack with verification",
          headingText: null,
          lines: [
            "Software Engineer II, Fullstack Software Engineer II, Fullstack with verification",
            "Dismiss Software Engineer II, Fullstack job",
            "Software Engineer II, Fullstack Software Engineer II, Fullstack with verification Dave United States (Remote) Vision, 401(k) 6 days ago",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4451999999/",
          sourceJobIdHint: "4451999999",
          anchorText:
            "JavaScript Frontend Developer (Remote)JavaScript Frontend Developer",
          headingText: null,
          lines: [
            "JavaScript Frontend Developer (Remote)JavaScript Frontend Developer",
            "Dismiss JavaScript Frontend Developer (Remote) JavaScript Frontend Developer job",
            "JavaScript Frontend Developer (Remote) JavaScript Frontend Developer Quik Hire Staffing EMEA (Remote) 21 minutes ago Within the past 24 hours",
          ],
          companyText: "Quik Hire Staffing",
          locationText: "EMEA (Remote)",
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4451606720/",
          sourceJobIdHint: "4451606720",
          anchorText:
            "MERN Stack Developer | MongoDB | Express.js | React | Node.jsMERN Stack Developer | MongoDB | Express.js | React | Node.js",
          headingText: null,
          lines: [
            "MERN Stack Developer | MongoDB | Express.js | React | Node.jsMERN Stack Developer | MongoDB | Express.js | React | Node.js",
            "Dismiss MERN Stack Developer | MongoDB | Express.js | React | Node.js job",
            "MERN Stack Developer | MongoDB | Express.js | React | Node.js MERN Stack Developer | MongoDB | Express.js | React | Node.js Wake Up Whistle India (Remote) 41 minutes ago Within the past 24 hours",
          ],
        },
        {
          canonicalUrl: "https://www.linkedin.com/jobs/view/4452600000/",
          sourceJobIdHint: "4452600000",
          anchorText:
            "Full Stack - React and Node.js developer Full Stack - React and Node.js developer",
          headingText: null,
          companyText: "Shortcastle Technologies",
          locationText: "Hyderabad, Telangana, India (Remote)",
          lines: [
            "Full Stack - React and Node.js developer Full Stack - React and Node.js developer",
            "Dismiss Full Stack - React and Node.js developer job",
            "Full Stack - React and Node.js developer Full Stack - React and Node.js developer Shortcastle Technologies Hyderabad, Telangana, India (Remote)",
          ],
        },
      ],
    });

    expect(jobs).toHaveLength(8);
    expect(
      jobs.map(({ sourceJobId, title, company, location }) => ({
        sourceJobId,
        title,
        company,
        location,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          sourceJobId: "4445516986",
          title: "Senior Full Stack Engineer (Node/React) - Remote",
          company: "Kake",
          location: "Bengaluru, Karnataka, India (Remote)",
        },
        {
          sourceJobId: "4444154507",
          title: "Senior Full Stack Software Engineer (React/Node)",
          company: "Reputation",
          location: "United States (Remote)",
        },
        {
          sourceJobId: "4451384800",
          title: "Frontend Developer - TypeScript (Remote)",
          company: "Hire Feed",
          location: "EMEA (Remote)",
        },
        {
          sourceJobId: "4450348065",
          title: "Software Engineer (Frontend)",
          company: "Aditude",
          location: "United States (Remote)",
        },
        {
          sourceJobId: "4448560474",
          title: "Software Engineer II, Fullstack",
          company: "Dave",
          location: "United States (Remote)",
        },
        {
          sourceJobId: "4451999999",
          title: "JavaScript Frontend Developer",
          company: "Quik Hire Staffing",
          location: "EMEA (Remote)",
        },
        {
          sourceJobId: "4451606720",
          title:
            "MERN Stack Developer | MongoDB | Express.js | React | Node.js",
          company: "Wake Up Whistle",
          location: "India (Remote)",
        },
        {
          sourceJobId: "4452600000",
          title: "Full Stack - React and Node.js developer",
          company: "Shortcastle Technologies",
          location: "Hyderabad, Telangana, India (Remote)",
        },
      ]),
    );
  });

  test("prefers visible in-viewport LinkedIn results cards when selecting the capped batch", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/offscreen-fullstack-role/",
          anchorText: "Senior Full Stack Engineer",
          headingText: "Senior Full Stack Engineer",
          lines: [
            "Senior Full Stack Engineer",
            "Broader Co",
            "Prishtina, Kosovo",
          ],
          captureMeta: {
            domOrder: 0,
            rootTagName: "li",
            rootRole: "listitem",
            rootClassName: "jobs-search-results__list-item job-card-container",
            hasJobDataset: true,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: true,
            inAside: false,
            inHeader: false,
            inNavigation: false,
            inDetailPane: false,
            hasDismissLabel: true,
            isVisible: true,
            intersectsViewport: false,
            viewportTop: 1760,
            viewportDistance: 1040,
          },
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/fullstack-visible-card/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
            "Dismiss Full Stack Developer (AI-First) job",
          ],
          captureMeta: {
            domOrder: 1,
            rootTagName: "li",
            rootRole: "listitem",
            rootClassName: "jobs-search-results__list-item job-card-container",
            hasJobDataset: true,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: true,
            inAside: false,
            inHeader: false,
            inNavigation: false,
            inDetailPane: false,
            hasDismissLabel: true,
            isVisible: true,
            intersectsViewport: true,
            viewportTop: 140,
            viewportDistance: 0,
          },
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/fullstack-visible-card/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("does not let LinkedIn surface quality displace the better full-stack role under the final cap", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl:
        "https://www.linkedin.com/jobs/search/?keywords=Senior+Full-Stack+Software+Engineer&location=Prishtina%2C+Kosovo",
      maxJobs: 1,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/visible-frontend-card/",
          anchorText: "Senior Frontend Engineer",
          headingText: "Senior Frontend Engineer",
          lines: ["Senior Frontend Engineer", "Odiin", "Prishtina, Kosovo"],
          captureMeta: {
            domOrder: 0,
            rootTagName: "li",
            rootRole: "listitem",
            rootClassName: "jobs-search-results__list-item job-card-container",
            hasJobDataset: true,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: true,
            inAside: false,
            inHeader: false,
            inNavigation: false,
            inDetailPane: false,
            hasDismissLabel: true,
            isVisible: true,
            intersectsViewport: true,
            viewportTop: 112,
            viewportDistance: 0,
          },
        },
        {
          canonicalUrl:
            "https://www.linkedin.com/jobs/view/offscreen-fullstack-card/",
          anchorText: "Full Stack Developer (AI-First)",
          headingText: "Full Stack Developer (AI-First)",
          lines: [
            "Full Stack Developer (AI-First)",
            "Full Circle Agency",
            "Prishtina (Remote)",
            "Dismiss Full Stack Developer (AI-First) job",
          ],
          captureMeta: {
            domOrder: 1,
            rootTagName: "li",
            rootRole: "listitem",
            rootClassName: "jobs-search-results__list-item job-card-container",
            hasJobDataset: true,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: true,
            inAside: false,
            inHeader: false,
            inNavigation: false,
            inDetailPane: false,
            hasDismissLabel: true,
            isVisible: true,
            intersectsViewport: false,
            viewportTop: 1280,
            viewportDistance: 560,
          },
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        canonicalUrl:
          "https://www.linkedin.com/jobs/view/offscreen-fullstack-card/",
        title: "Full Stack Developer (AI-First)",
      }),
    ]);
  });

  test("recovers sparse weak-target cards by deriving company from same-host detail urls and splitting composite titles", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://kosovajob.com/",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://kosovajob.com/shopaz/category-manager-fashion-sports-outdoor-e-commerce",
          anchorText:
            "Category Manager, Fashion, Sports & Outdoor (E-Commerce) Prishtinë 11 ditë",
          headingText: null,
          lines: [
            "Category Manager, Fashion, Sports & Outdoor (E-Commerce) Prishtinë 11 ditë",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        sourceJobId:
          "kosovajob_com_shopaz_category_manager_fashion_sports_outdoor_e_commerce",
        canonicalUrl:
          "https://kosovajob.com/shopaz/category-manager-fashion-sports-outdoor-e-commerce",
        title: "Category Manager, Fashion, Sports & Outdoor (E-Commerce)",
        company: "Shopaz",
        location: "Prishtinë",
        postedAtText: "11 ditë",
      }),
    ]);
  });

  test("prefers technical weak-board jobs over non-technical local matches for technical searches", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://kosovajob.com/",
      maxJobs: 2,
      searchPreferences: {
        targetRoles: ["Senior Full-Stack Software Engineer"],
        locations: ["Prishtina, Kosovo"],
      },
      cardCandidates: [
        {
          canonicalUrl:
            "https://kosovajob.com/company-x/software-developer-prishtine",
          anchorText: "Software Developer",
          headingText: null,
          lines: [
            "Software Developer",
            "Company X",
            "Prishtinë",
            "2 ditë",
            "React",
            "TypeScript",
            "Node.js",
          ],
        },
        {
          canonicalUrl:
            "https://kosovajob.com/shopaz/category-manager-fashion-sports-outdoor-e-commerce",
          anchorText:
            "Category Manager, Fashion, Sports & Outdoor (E-Commerce)",
          headingText: null,
          lines: [
            "Category Manager, Fashion, Sports & Outdoor (E-Commerce)",
            "SHOPAZ",
            "Prishtinë",
            "2 ditë",
            "Merchandising",
            "Retail Operations",
          ],
        },
      ],
    });

    expect(jobs).toEqual([
      expect.objectContaining({
        title: "Software Developer",
      }),
      expect.objectContaining({
        title: "Category Manager, Fashion, Sports & Outdoor (E-Commerce)",
      }),
    ]);
  });

  test("does not treat generic path prefixes as company names when recovering sparse cards", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://jobs.example.com/search",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl:
            "https://jobs.example.com/jobs/frontend-engineer-remote",
          anchorText: "Frontend Engineer Remote 2 days ago",
          headingText: null,
          lines: ["Frontend Engineer Remote 2 days ago"],
        },
      ],
    });

    expect(jobs).toEqual([]);
  });
});

describe("isJobPreferenceAligned", () => {
  test("does not treat local non-technical jobs as aligned for technical searches", () => {
    expect(
      isJobPreferenceAligned({
        searchPreferences: {
          targetRoles: ["Senior Full-Stack Software Engineer"],
          locations: ["Prishtina, Kosovo"],
        },
        job: {
          sourceJobId: "job_local_retail",
          canonicalUrl: "https://kosovajob.com/jobs/local-retail",
          title: "Category Manager",
          company: "Shopaz",
          location: "Prishtinë",
          description: "Retail merchandising and category planning.",
          salaryText: null,
          summary: "Retail merchandising and category planning.",
          postedAt: null,
          workMode: [],
          applyPath: "unknown",
          easyApplyEligible: false,
          keySkills: ["Merchandising"],
        },
      }),
    ).toBe(false);
  });

  test("treats adjacent technical jobs as aligned for technical searches", () => {
    expect(
      isJobPreferenceAligned({
        searchPreferences: {
          targetRoles: ["Senior Full-Stack Software Engineer"],
          locations: ["Prishtina, Kosovo"],
        },
        job: {
          sourceJobId: "job_local_software",
          canonicalUrl: "https://kosovajob.com/jobs/local-software",
          title: "Software Developer",
          company: "Acme Tech",
          location: "Prishtinë",
          description: "Build internal web apps with React and Node.js.",
          salaryText: null,
          summary: "React and TypeScript role.",
          postedAt: null,
          workMode: [],
          applyPath: "unknown",
          easyApplyEligible: false,
          keySkills: ["React", "TypeScript"],
        },
      }),
    ).toBe(true);
  });

  test("treats clearly technical platform roles as aligned for technical searches even without explicit skill overlap", () => {
    expect(
      isJobPreferenceAligned({
        searchPreferences: {
          targetRoles: ["Senior Full-Stack Software Engineer"],
          locations: ["Prishtina, Kosovo"],
        },
        job: {
          sourceJobId: "job_platform_engineer",
          canonicalUrl: "https://kosovajob.com/jobs/platform-engineer",
          title: "Platform Engineer",
          company: "Acme Cloud",
          location: "Prishtinë",
          description:
            "Own cloud infrastructure, platform services, and backend delivery systems.",
          salaryText: null,
          summary: "Platform and cloud engineering role.",
          postedAt: null,
          workMode: [],
          applyPath: "unknown",
          easyApplyEligible: false,
          keySkills: [],
        },
      }),
    ).toBe(true);
  });
});

describe("shouldCanonicalizeSearchSurfaceDetailRoute", () => {
  const learnedEvidence = observeLearnedSearchSurfaceRoutes({
    pageUrl:
      "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
    observedUrls: [
      "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      "https://jobs.example.com/jobs/4386674431/",
    ],
  });
  const seededCard: SearchResultCardCandidate = {
    canonicalUrl:
      "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
    anchorText: "Full Stack Developer (AI-First)",
    headingText: "Full Stack Developer (AI-First)",
    lines: [
      "Full Stack Developer (AI-First)",
      "Full Circle Agency",
      "Pristina (Remote)",
    ],
  };

  test("returns false for seeded search cards without a card-level id proof", () => {
    expect(
      shouldCanonicalizeSearchSurfaceDetailRoute({
        pageUrl:
          "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
        candidate: { ...seededCard },
        evidence: learnedEvidence,
      }),
    ).toBe(false);
  });

  test("returns true when the card has its own id hint and the host detail shape was learned", () => {
    expect(
      shouldCanonicalizeSearchSurfaceDetailRoute({
        pageUrl:
          "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
        candidate: { ...seededCard, sourceJobIdHint: "4404542575" },
        evidence: learnedEvidence,
      }),
    ).toBe(true);
  });

  test("returns false when the host has no learned detail-route shape", () => {
    const unrelatedEvidence = observeLearnedSearchSurfaceRoutes({
      pageUrl:
        "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      observedUrls: [
        "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
      ],
    });

    expect(
      shouldCanonicalizeSearchSurfaceDetailRoute({
        pageUrl:
          "https://jobs.example.com/search?selected_job_id=4399165260&q=frontend",
        candidate: { ...seededCard, sourceJobIdHint: "4404542575" },
        evidence: unrelatedEvidence,
      }),
    ).toBe(false);
  });
});

describe("isLikelySiteUtilityJob", () => {
  test("treats only whole access-gate path segments as transient pages", () => {
    expect(
      isLikelyAccessGateUrl("https://jobs.example.test/security/42"),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://jobs.example.test/security/42",
        title: "Security Engineer",
        company: "Example Co",
        description: "Build secure systems.",
      }),
    ).toBe(true);
    expect(
      isLikelyAccessGateUrl(
        "https://jobs.example.test/jobs/security-engineer",
      ),
    ).toBe(false);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://jobs.example.test/jobs/security-engineer",
        title: "Security Engineer",
        company: "Example Co",
        description: "Build secure systems.",
      }),
    ).toBe(false);
  });

  test("rejects pagination and empty site-section records before extraction", () => {
    for (const title of ["Go to page 1000", "Next", "Previous", "Page 12"]) {
      expect(
        isLikelySiteUtilityJob({
          canonicalUrl: "https://example.com/jobs?page=12",
          company: "Employer not listed",
          description: "",
          title,
        }),
      ).toBe(true);
    }
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example.com/content/descriptions",
        company: "Employer not listed",
        description: "",
        title: "Content Descriptions",
      }),
    ).toBe(true);
  });

  test("flags salary explorers, collections, hubs and advice articles that boards list beside jobs", () => {
    // Blind testers saw "Find salaries", "Cashier salaries in Waterloo, IA",
    // "Job Collections" and "How the Local Government Hiring Process Works"
    // ranked as jobs, one of them at 48% fit.
    for (const [canonicalUrl, title] of [
      ["https://www.indeed.com/career/salaries", "Find salaries"],
      [
        "https://www.indeed.com/career/cashier/salaries/Waterloo--IA",
        "Cashier salaries in Waterloo, IA",
      ],
      [
        "https://wellfound.com/job-collections/blockchain-startups",
        "Blockchain Startups",
      ],
      ["https://example.gov/jobs/opportunities", "Job Opportunities"],
      [
        "https://example.gov/resources/how-the-local-government-hiring-process-works",
        "How the Local Government Hiring Process Works",
      ],
      ["https://www.indeed.com/cmp/Home-Depot", "Home Depot"],
    ] as const) {
      expect(isLikelySiteUtilityJob({ canonicalUrl, title })).toBe(true);
    }
    // Real postings whose titles mention pay or process stay.
    for (const [canonicalUrl, title] of [
      ["https://www.indeed.com/viewjob?jk=abc123", "Salary Analyst"],
      ["https://jobs.example.com/jobs/4421", "Payroll Specialist"],
      ["https://jobs.example.com/jobs/4422", "Process Engineer"],
    ] as const) {
      expect(isLikelySiteUtilityJob({ canonicalUrl, title })).toBe(false);
    }
  });

  test("rejects board self-promotion, salary marketing and listing indexes", () => {
    // Exact strings blind testers saw saved as jobs. Every rule below is a
    // shape rule: no site name appears in the gate.
    for (const [canonicalUrl, title] of [
      ["https://remotive.com/remote-jobs", "Post a Remote Job"],
      ["https://example-board.com/pricing", "Hire developers fast"],
      [
        "https://example-board.com/collections/high-paying",
        "Remote Tech Jobs Paying $130k to $250k",
      ],
      [
        "https://example-board.com/remote-data-science",
        "Remote Data Science JobsLatest post about 3 hours ago",
      ],
      [
        "https://example-board.com/frontend-berlin-munich",
        "Frontend Developer Jobs in Berlin & Munich",
      ],
      [
        "https://example-board.com/accessibility",
        "Accessibility Statement (opens in new tab)",
      ],
      ["https://example-board.com/prishtina", "Prishtina Jobs"],
      [
        "https://www.ycombinator.com/companies/stripe",
        "Stripe: payments infrastructure",
      ],
    ] as const) {
      expect(isLikelySiteUtilityJob({ canonicalUrl, title })).toBe(true);
    }

    // A record whose employer is the board itself is the board advertising.
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://remotive.com/remote-jobs/software-dev/1234",
        title: "Senior Backend Engineer",
        company: "Remotive",
      }),
    ).toBe(true);

    // Real postings with nearby wording stay.
    for (const [canonicalUrl, title] of [
      ["https://example-board.com/jobs/4421", "Postal Operations Manager"],
      ["https://example-board.com/jobs/4422", "Hiring Manager, EMEA"],
      [
        "https://example-board.com/jobs/4423",
        "Senior Data Scientist, Payments",
      ],
      ["https://example-board.com/jobs/4424", "Director of Jobs Marketplace"],
    ] as const) {
      expect(isLikelySiteUtilityJob({ canonicalUrl, title })).toBe(false);
    }
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://remotive.com/remote-jobs/software-dev/1234",
        title: "Senior Backend Engineer",
        company: "Stripe",
      }),
    ).toBe(false);
  });

  test("flags KosovaJob-style navigation pages", () => {
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/blog",
        title: "Blog",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/kontakt",
        title: "Kontakt",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/krijo-cv",
        title: "Krijo CV",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/privacy-policy",
        title: "Politikë e Privatësisë",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/politika-e-privatesise",
        title: "Politikë e Privatësisë dhe Mbrojtjes së të Dhënave Personale",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example.com/legal/privacy",
        title: "Privacy Policy",
      }),
    ).toBe(true);
  });

  test("flags live Maya KosovaJob compound privacy title and Albanian path", () => {
    const mayaLiveTitle =
      "Politikë e Privatësisë dhe Mbrojtjes së të Dhënave Personale";
    const mayaLiveUrl = "https://kosovajob.com/politika-e-privatesise";

    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/jobs",
        title: mayaLiveTitle,
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: mayaLiveUrl,
        title: "Unrelated chrome label",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: mayaLiveUrl,
        title: mayaLiveTitle,
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/politike-e-privatesise",
        title: "Politike e Privatesise",
      }),
    ).toBe(true);
  });

  test("keeps a posting whose title happens to end in Jobs", () => {
    // The category shape alone must not drop a real role.
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example-board.com/jobs/9912",
        title: "Director of Green Jobs",
        company: "City of Portland",
        description: "Lead the city's green workforce programme.",
      }),
    ).toBe(false);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example-board.com/jobs/9913",
        title: "Coordinator Youth Jobs",
        company: "Bright Futures",
        description: "Run the youth placement programme.",
      }),
    ).toBe(false);
  });

  test("still drops a category route card", () => {
    // A place or category label with nothing an employer would publish.
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example-board.com/remote-python",
        title: "Remote Python Jobs",
        company: "Example Board",
        description: "Browse the newest openings.",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://example-board.com/jobs/9914",
        title: "Director of Green Jobs",
      }),
    ).toBe(true);
  });

  test("does not flag real job detail routes", () => {
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl:
          "https://kosovajob.com/jobs/view/software-engineer-remote",
        title: "Software Engineer",
      }),
    ).toBe(false);
  });

  test("flags Wellfound-style view-all navigation links", () => {
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/jobs",
        title: "View all engineering jobs",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/jobs",
        title: "Sign up with Google",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/jobs",
        title: "11 open positions",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl:
          "https://wellfound.com/company/signal-systems/jobs/123456-engineer",
        title: "Software Engineer",
      }),
    ).toBe(false);
  });

  test("flags Maya-wave KosovaJob and Wellfound company-hub chrome", () => {
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/llogaritja-e-pages",
        title: "Llogarite Pagën",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://kosovajob.com/publiko",
        title: "Publiko Konkurs",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/company/lamatic",
        title: "Lamatic.ai",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/candidates/overview",
        title: "Why Wellfound",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://fb.com/kosovajob",
        title: "www.fb.com/kosovajob",
      }),
    ).toBe(true);
  });

  test("flags bare /jobs hub and browse/hiring-data chrome regardless of title", () => {
    expect(isLikelyJobListingHubUrl("https://wellfound.com/jobs")).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/jobs",
        title: "Data Engineer",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/hiring-data",
        title: "Engineering hiring trends",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/browse/remote-engineering-jobs",
        title: "Remote engineering jobs",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://wellfound.com/jobs/4505800-data-engineer",
        title: "Data Engineer",
      }),
    ).toBe(false);
  });

  test("excludes navigation capture metadata from structured results", () => {
    const jobs = buildStructuredCandidateJobs({
      pageUrl: "https://kosovajob.com/jobs",
      maxJobs: 5,
      cardCandidates: [
        {
          canonicalUrl: "https://kosovajob.com/blog",
          anchorText: "Blog",
          headingText: "Blog",
          lines: ["Blog", "KosovaJob", "Remote", "Read company news."],
          captureMeta: {
            domOrder: 0,
            rootTagName: "a",
            rootRole: null,
            rootClassName: null,
            hasJobDataset: false,
            sameRootJobAnchorCount: 1,
            inLikelyResultsList: false,
            inAside: false,
            inHeader: false,
            inNavigation: true,
            inDetailPane: false,
            hasDismissLabel: false,
          },
        },
      ],
    });

    expect(jobs).toEqual([]);
  });
});

describe("stripCompanyMarketingBadges", () => {
  test("drops placement badges that flatten into the employer line", () => {
    // Testers saw this exact string printed as the company on a result card.
    expect(
      stripCompanyMarketingBadges(
        "Boosted listing Toggl Boosted Featured Top 100 Full-Time",
      ),
    ).toBe("Toggl");
    expect(stripCompanyMarketingBadges("Promoted Acme Corp Part-time")).toBe(
      "Acme Corp",
    );
  });

  test("leaves a real employer name alone, hyphens included", () => {
    expect(stripCompanyMarketingBadges("MKY Treuhandpartner GmbH")).toBe(
      "MKY Treuhandpartner GmbH",
    );
    expect(stripCompanyMarketingBadges("Jean-Luc & Partners")).toBe(
      "Jean-Luc & Partners",
    );
  });

  test("keeps an unreadable line rather than emptying the employer", () => {
    expect(stripCompanyMarketingBadges("Featured Promoted")).toBe(
      "Featured Promoted",
    );
  });

  test("keeps employment words that belong to the company name", () => {
    expect(stripCompanyMarketingBadges("Contract Furniture Company")).toBe(
      "Contract Furniture Company",
    );
    expect(stripCompanyMarketingBadges("Temporary Staffing Group")).toBe(
      "Temporary Staffing Group",
    );
    expect(stripCompanyMarketingBadges("Freelance Collective GmbH")).toBe(
      "Freelance Collective GmbH",
    );
  });

  test("never collapses a repeated word of a real employer name", () => {
    expect(stripCompanyMarketingBadges("Pizza Pizza")).toBe("Pizza Pizza");
    expect(stripCompanyMarketingBadges("Boosted Pizza Pizza Featured")).toBe(
      "Pizza Pizza",
    );
  });

  test("drops a badge chip separated by punctuation", () => {
    expect(stripCompanyMarketingBadges("Acme Inc · Full-Time")).toBe(
      "Acme Inc",
    );
    expect(
      stripCompanyMarketingBadges("Contract Furniture Company • Contract"),
    ).toBe("Contract Furniture Company");
  });
});

describe("isLikelyDocumentAttachmentJob", () => {
  test("rejects a linked policy document saved among the postings", () => {
    expect(
      isLikelyDocumentAttachmentJob({
        canonicalUrl: "https://careers.example.test/files/applicant-rights.pdf",
        title: "applicant rights under Federal Employment Laws.pdf",
        company: "",
        description: "",
      }),
    ).toBe(true);
    expect(
      isLikelySiteUtilityJob({
        canonicalUrl: "https://careers.example.test/files/applicant-rights.pdf",
        title: "applicant rights under Federal Employment Laws.pdf",
        company: "",
        description: "",
      }),
    ).toBe(true);
  });

  test("keeps a real posting that happens to be served as a document", () => {
    expect(
      isLikelyDocumentAttachmentJob({
        canonicalUrl: "https://careers.example.test/roles/warehouse-lead.pdf",
        title: "Warehouse Lead",
        company: "Example Logistics",
        description:
          "You will run the night shift, own the pick schedule and report to the site manager.",
      }),
    ).toBe(false);
  });
});

describe("isListingIndexPageRecord", () => {
  const pageUrl = "https://boards.example.test/jobs";

  test("treats a bodyless record at the page's own address as the index", () => {
    expect(
      isListingIndexPageRecord({
        canonicalUrl: pageUrl,
        pageUrl,
        siblingDetailUrlCount: 12,
        title: "Jobs at Example",
        description: "",
      }),
    ).toBe(true);
  });

  test("keeps a record that carries a job body of its own", () => {
    expect(
      isListingIndexPageRecord({
        canonicalUrl: pageUrl,
        pageUrl,
        siblingDetailUrlCount: 12,
        title: "Warehouse Lead",
        description:
          "You will run the night shift and own the pick schedule for the site.",
      }),
    ).toBe(false);
  });

  test("claims nothing about a page with too few sibling links to be an index", () => {
    expect(
      isListingIndexPageRecord({
        canonicalUrl: pageUrl,
        pageUrl,
        siblingDetailUrlCount: 1,
        title: "Jobs at Example",
        description: "",
      }),
    ).toBe(false);
  });

  test("never demotes a posting at its own address", () => {
    expect(
      isListingIndexPageRecord({
        canonicalUrl: "https://boards.example.test/jobs/4677969",
        pageUrl,
        siblingDetailUrlCount: 12,
        title: "Warehouse Lead",
        description: "",
      }),
    ).toBe(false);
  });
});

describe("repairWrappedCardTitle", () => {
  test("puts a heading's second line back in the title instead of the employer", () => {
    expect(
      repairWrappedCardTitle({
        title: "Lead",
        company: "Wells Fargo • Equipment Finance Underwriter",
      }),
    ).toEqual({
      title: "Lead Equipment Finance Underwriter",
      company: "Wells Fargo",
    });
  });

  test("closes in the title a parenthesis the title opened", () => {
    expect(
      repairWrappedCardTitle({
        title: "Sr. Strategic Finance Manager (Bellevue, WA",
        company: "Logicgate • or Chicago, IL)",
      }),
    ).toEqual({
      title: "Sr. Strategic Finance Manager (Bellevue, WA or Chicago, IL)",
      company: "Logicgate",
    });
  });

  test("leaves a short title and its own employer alone", () => {
    expect(
      repairWrappedCardTitle({
        title: "Manager",
        company: "Alliant Credit Union",
      }),
    ).toEqual({ title: "Manager", company: "Alliant Credit Union" });
  });

  test("never empties the employer to lengthen a title", () => {
    expect(
      repairWrappedCardTitle({
        title: "Lead",
        company: "Equipment Finance Underwriter",
      }),
    ).toEqual({ title: "Lead", company: "Equipment Finance Underwriter" });
  });

  test("reattaches the remainder a title dropped after a dangling connector", () => {
    expect(
      repairWrappedCardTitle({
        title: "Senior Partner Marketing Manager, AI &",
        company: "Dropbox",
        location: "Remote, United States",
        cardText:
          "Senior Partner Marketing Manager, AI & ISV Ecosystem at Dropbox, Remote, United States, 13 Days Ago",
        canonicalUrl:
          "https://builtinchicago.org/job/senior-partner-marketing-manager-ai-isv-ecosystem/1234567",
      }),
    ).toEqual({
      title: "Senior Partner Marketing Manager, AI & ISV Ecosystem",
      company: "Dropbox",
      location: "Remote, United States",
    });
  });

  test("moves a location line that is title remainder back into the title", () => {
    expect(
      repairWrappedCardTitle({
        title: "Marketing Manager",
        company: "Vantive",
        location: "PD Products Portfolio",
        cardText: "Marketing Manager role at Vantive",
        canonicalUrl:
          "https://builtinchicago.org/job/marketing-manager-pd-products-portfolio/7654321",
      }),
    ).toEqual({
      title: "Marketing Manager PD Products Portfolio",
      company: "Vantive",
      location: null,
    });
  });

  test("keeps a real place as the location even when the title is short", () => {
    expect(
      repairWrappedCardTitle({
        title: "Marketing Manager",
        company: "Vantive",
        location: "Chicago, IL",
        cardText: "Marketing Manager at Vantive, Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/marketing-manager-chicago-il/7654321",
      }),
    ).toEqual({
      title: "Marketing Manager",
      company: "Vantive",
      location: "Chicago, IL",
    });
  });

  // Five rows a live Built In Chicago run stored with the painted first line
  // as the whole title. Each address spells the rest, and each card summary
  // prints the full phrase.
  test.each([
    {
      title: "Manager",
      company: "Alliant Credit Union",
      location: "Chicago, IL",
      canonicalUrl: "https://builtinchicago.org/job/manager-credit-risk/11136865",
      cardText:
        "Manager Credit Risk at Alliant Credit Union - Hybrid - Chicago, IL - 2 Days Ago",
      expected: "Manager Credit Risk",
    },
    {
      title: "People Operations",
      company: "Belvedere Trading",
      location: "Chicago, IL",
      canonicalUrl:
        "https://builtinchicago.org/job/people-operations-generalist/11139860",
      cardText:
        "People Operations Generalist at Belvedere Trading - Easy Apply - Hybrid - Chicago, IL - 2 Days Ago",
      expected: "People Operations Generalist",
    },
    {
      title: "Senior Lifecycle Marketing Manager,",
      company: "Bankrate",
      location: "United States",
      canonicalUrl:
        "https://builtinchicago.org/job/senior-lifecycle-marketing-manager-enterprise-partnerships/10872069",
      cardText:
        "Senior Lifecycle Marketing Manager, Enterprise Partnerships at Bankrate - 17 Days Ago - Easy Apply",
      expected: "Senior Lifecycle Marketing Manager, Enterprise Partnerships",
    },
    {
      title: "Principal, Corporate Marketing Operations &",
      company: "Morningstar",
      location: "Chicago, IL",
      canonicalUrl:
        "https://builtinchicago.org/job/principal-corporate-marketing-operations-enablement/11147281",
      cardText:
        "Principal, Corporate Marketing Operations & Enablement at Morningstar - Hybrid - Chicago, IL",
      expected: "Principal, Corporate Marketing Operations & Enablement",
    },
    {
      title: "Sales Support Associate",
      company: "Tapestry - Coach and Kate Spade",
      location: "Chicago, IL",
      canonicalUrl:
        "https://builtinchicago.org/job/sales-support-associate-i/8946587",
      cardText:
        "Sales Support Associate I at Tapestry - Coach and Kate Spade - Hybrid - Chicago, IL",
      expected: "Sales Support Associate I",
    },
  ])("restores the whole title for $expected", (row) => {
    expect(
      repairWrappedCardTitle({
        title: row.title,
        company: row.company,
        location: row.location,
        cardText: row.cardText,
        canonicalUrl: row.canonicalUrl,
      }).title,
    ).toBe(row.expected);
  });

  test.each([
    {
      name: "Manager Credit Risk",
      title: "Manager",
      company: "Alliant Credit Union",
      location: "Credit Risk",
      canonicalUrl: "https://builtinchicago.org/job/manager-credit-risk/11136865",
      cardText:
        "Manager Credit Risk at Alliant Credit Union - Hybrid - Chicago, IL - 2 Days Ago",
      expected: "Manager Credit Risk",
    },
    {
      name: "Product Owner, Workday ERP",
      title: "Product Owner, Workday ERP",
      company: "Wipfli",
      location: "Owner, Workday ERP",
      canonicalUrl:
        "https://builtinchicago.org/job/product-owner-workday-erp/11140001",
      cardText: "Product Owner, Workday ERP at Wipfli - Remote",
      expected: "Product Owner, Workday ERP",
    },
    {
      name: "Product Manager Services",
      title: "Product Manager Services",
      company: "Cdw",
      location: "Services",
      canonicalUrl:
        "https://builtinchicago.org/job/product-manager-services/11140002",
      cardText: "Product Manager Services at Cdw - Hybrid",
      expected: "Product Manager Services",
    },
    {
      name: "2027 US Chess Academy Interest Form",
      title: "2027 US Chess",
      company: "Imc Trading",
      location: "Academy Interest Form",
      canonicalUrl:
        "https://builtinchicago.org/job/2027-us-chess-academy-interest-form/11140003",
      cardText: "2027 US Chess role at Imc Trading",
      expected: "2027 US Chess Academy Interest Form",
    },
  ])("keeps the title remainder out of the location line for $name", (row) => {
    expect(
      repairWrappedCardTitle({
        title: row.title,
        company: row.company,
        location: row.location,
        cardText: row.cardText,
        canonicalUrl: row.canonicalUrl,
      }),
    ).toEqual({
      title: row.expected,
      company: row.company,
      location: null,
    });
  });

  test("finishes a title's open parenthesis and drops the work-mode aside", () => {
    expect(
      repairWrappedCardTitle({
        title: "Software Engineer I - AI (Hybrid in",
        company: "Chamberlain Group",
        location: "Chicago, IL",
        cardText:
          "Software Engineer I - AI (Hybrid in Oak Brook, IL) at Chamberlain Group - Hybrid - Chicago, IL - Reposted 2 Days Ago",
        canonicalUrl:
          "https://builtinchicago.org/job/software-engineer-i-ai/11140004",
      }),
    ).toEqual({
      title: "Software Engineer I - AI",
      company: "Chamberlain Group",
      location: "Chicago, IL",
    });
  });

/** One extracted record, with only the fields these repairs read varied. */
function extractedJob(
  overrides: Partial<ExtractedJobInput> & { title: string },
): ExtractedJobInput {
  return {
    sourceJobId: "11119020",
    canonicalUrl: "https://builtinchicago.org/job/11119020",
    company: "Inspira Financial",
    location: "Chicago, IL",
    description: "Own the platform this team runs on.",
    salaryText: null,
    summary: null,
    postedAt: null,
    workMode: [],
    applyPath: "unknown",
    easyApplyEligible: false,
    keySkills: [],
    ...overrides,
  };
}

  test("closes the parenthesis from the record's own summary, past its own copy of the title", () => {
    // The witnesses reach the repair as one text that starts with the title
    // itself, so the closing bracket is in the copy after that one.
    expect(
      repairExtractedJobTitle(extractedJob({
        title: "Lead Platform Software Engineer (Remote",
        company: "Inspira Financial",
        location: "Chicago, IL",
        canonicalUrl:
          "https://builtinchicago.org/job/lead-platform-software-engineer-remote/11119020",
        summary:
          "Lead Platform Software Engineer (Remote) at Inspira Financial - Remote - Chicago, IL - Reposted 3 Days Ago",
        description:
          "Own the platform this team runs on and the tools that keep it honest.",
      })).title,
    ).toBe("Lead Platform Software Engineer");
  });

  test("drops a bracket nothing can close rather than keeping half an aside", () => {
    expect(
      repairExtractedJobTitle(extractedJob({
        title: "Lead Platform Software Engineer (Remote",
        company: "Inspira Financial",
        location: "Chicago, IL",
        canonicalUrl: "https://builtinchicago.org/job/11119020",
        summary: null,
        description: "Own the platform this team runs on.",
      })).title,
    ).toBe("Lead Platform Software Engineer");
  });

  test("a title that is only a dangling aside is left as it is", () => {
    expect(
      repairExtractedJobTitle(extractedJob({
        title: "(Remote",
        company: "Inspira Financial",
        location: "Chicago, IL",
        canonicalUrl: "https://builtinchicago.org/job/11119020",
        summary: null,
        description: "Own the platform this team runs on.",
      })).title,
    ).toBe("(Remote");
  });

  test("does not lengthen a title the card text never prints longer", () => {
    expect(
      repairWrappedCardTitle({
        title: "Marketing Manager",
        company: "Vantive",
        location: "Chicago, IL",
        cardText: "Marketing Manager at Vantive, Chicago, IL",
        canonicalUrl:
          "https://boards.example.test/job/marketing-manager-emea-growth/42",
      }).title,
    ).toBe("Marketing Manager");
  });

  test("uses a short semantic detail-route id as the generic posting id", () => {
    expect(buildGenericJobId("https://careers.example.test/jobs/4")).toBe(
      "4",
    );
    expect(
      buildGenericJobId("https://careers.example.test/openings/design-lead"),
    ).toBe("design-lead");
  });

  test("normalizes only a legacy URL-derived id on a semantic detail route", () => {
    const legacy = extractedJob({
      sourceJobId: "careers_example_test_jobs_4",
      canonicalUrl: "https://careers.example.test/jobs/4",
      title: "Frontend Engineer",
    });
    expect(normalizeExtractedJobSourceId(legacy).sourceJobId).toBe("4");
    expect(
      normalizeExtractedJobSourceId({
        ...legacy,
        sourceJobId: "provider-requisition-004",
      }).sourceJobId,
    ).toBe("provider-requisition-004");
  });

  test("leaves a complete title and a plain employer untouched", () => {
    expect(
      repairWrappedCardTitle({
        title: "Senior Paid Media Manager",
        company: "Envisionit",
      }),
    ).toEqual({ title: "Senior Paid Media Manager", company: "Envisionit" });
  });
});
