import {
  CandidateProfileSchema,
  JobPostingSchema,
  type RawApplyPage,
} from "@unemployed/contracts";
import { describe, expect, test, vi } from "vitest";

import type { JobExtractor, LLMClient } from "../agent/contracts";
import { buildApplyFormObservation } from "../apply/page-hands";
import type { ApplyPageHands } from "../apply/types";
import type { AgentConfig } from "../types";
import type { Page } from "playwright";
import { runJobSearchAgent } from "./job-search-agent";
import { createJobSearchPrompts } from "./job-search-prompts";
import { captureCompactDiscoveryObservation } from "../compact-discovery-observer";

function rawPage(overrides: Partial<RawApplyPage> = {}): RawApplyPage {
  return {
    url: "https://jobs.example.test/search?q=engineer",
    title: "Jobs",
    bodyText: "Platform Engineer at Northwind. Data Engineer at Contoso.",
    controls: [],
    actions: [{ index: 0, label: "Next page", visible: true, disabled: false }],
    links: [],
    headings: [],
    clickables: [],
    openedTabs: [],
    loading: false,
    validationErrors: [],
    stepLabel: null,
    ...overrides,
  };
}

function hands(pages: { current: RawApplyPage }): ApplyPageHands {
  return {
    observe: () =>
      Promise.resolve(
        buildApplyFormObservation(pages.current, "2026-09-14T10:00:00.000Z"),
      ),
    navigate: (url) => {
      pages.current = rawPage({ url });
      return Promise.resolve({ ok: true, url });
    },
    clickElement: () => {
      pages.current = rawPage({
        url: "https://jobs.example.test/search?q=engineer&page=2",
      });
      return Promise.resolve({ ok: true, observedValue: "clicked" });
    },
    scroll: () => Promise.resolve({ ok: true, observedValue: "down" }),
    wait: () => Promise.resolve(),
    goBack: () => Promise.resolve({ ok: true, url: pages.current.url ?? "" }),
    readText: () => Promise.resolve(pages.current.bodyText),
    fillText: (_ref, value) =>
      Promise.resolve({ ok: true, observedValue: value }),
    chooseOption: (_ref, option) =>
      Promise.resolve({ ok: true, observedValue: option }),
    setToggle: () => Promise.resolve({ ok: true, observedValue: "checked" }),
    uploadFile: (_ref, file) =>
      Promise.resolve({ ok: true, observedValue: file.name }),
    clickAction: () => Promise.resolve({ ok: true, observedValue: "clicked" }),
    followLink: () =>
      Promise.resolve({ ok: true, url: pages.current.url ?? "" }),
  };
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    source: "target_site",
    maxSteps: 60,
    targetJobCount: 10,
    userProfile: CandidateProfileSchema.parse({
      id: "candidate_test",
      firstName: "Robin",
      lastName: "Ashford",
      fullName: "Robin Ashford",
      headline: "Platform engineer",
      summary: "Builds dependable internal tools.",
      currentLocation: "Manchester",
      yearsExperience: 8,
      baseResume: {
        id: "resume_test",
        fileName: "resume.txt",
        uploadedAt: "2026-09-01T09:00:00.000Z",
        textContent: "8 years of platform engineering.",
        textUpdatedAt: "2026-09-01T09:00:00.000Z",
        extractionStatus: "ready",
      },
      experiences: [
        {
          id: "experience_1",
          title: "Platform Engineer",
          companyName: "Northwind",
          startDate: "2020",
          isCurrent: true,
          summary: "Built reliable developer tooling.",
        },
      ],
      education: [
        {
          id: "education_1",
          degree: "BSc",
          fieldOfStudy: "Computer Science",
          schoolName: "Example University",
        },
      ],
    }),
    searchPreferences: {
      targetRoles: ["Platform Engineer"],
      locations: ["Manchester"],
    },
    startingUrls: ["https://jobs.example.test/search?q=engineer"],
    navigationPolicy: {
      allowedHostnames: ["jobs.example.test"],
      allowSubdomains: true,
    },
    promptContext: { siteLabel: "the example board" },
    ...overrides,
  };
}

function scripted(
  turns: Array<{ name: string; args?: Record<string, unknown> }>,
): LLMClient {
  let calls = 0;
  return {
    chatWithTools: () => {
      const turn = turns[Math.min(calls, turns.length - 1)];
      calls += 1;
      return Promise.resolve({
        toolCalls: [
          {
            id: `call_${calls}`,
            type: "function" as const,
            function: {
              name: turn.name,
              arguments: JSON.stringify(turn.args ?? {}),
            },
          },
        ],
      });
    },
  };
}

function posting(title: string, company: string, id: string) {
  return {
    sourceJobId: id,
    canonicalUrl: `https://jobs.example.test/jobs/${id}`,
    title,
    company,
    location: "Manchester",
    workMode: ["hybrid" as const],
    applyPath: "unknown" as const,
    postedAt: "2026-09-10T09:00:00.000Z",
    salaryText: null,
    summary: `${title} at ${company}.`,
    description: `${title} at ${company}. Build things.`,
    easyApplyEligible: false,
    keySkills: ["TypeScript"],
  };
}

const extractor: JobExtractor = {
  extractJobsFromPage: vi.fn(() =>
    Promise.resolve([
      posting("Platform Engineer", "Northwind", "j1"),
      posting("Data Engineer", "Contoso", "j2"),
    ]),
  ),
};

describe("job search agent", () => {
  test("turns precision and scale modes into distinct search instructions", () => {
    const precision = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "the example board",
          searchMode: "precision",
        },
      }),
    );
    const scale = createJobSearchPrompts(
      config({
        promptContext: { siteLabel: "the example board", searchMode: "scale" },
      }),
    );

    expect(precision.system).toContain("save only strong fits");
    expect(precision.system).toContain("over filling the list");
    expect(scale.system).toContain("find a broad pool of plausible jobs");
    expect(scale.system).toContain("borderline possibilities");
  });

  test("lets the saved AI search behavior decide how picky the run is and how remote counts", () => {
    const balanced = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "the example board",
          searchMode: "precision",
          searchGuidance: {
            selectivity: "balanced",
            remoteCountsAsAnyLocation: true,
          },
        },
      }),
    );
    const strict = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "the example board",
          // The saved choice wins over the run mode the caller passed.
          searchMode: "scale",
          searchGuidance: {
            selectivity: "best_matches",
            remoteCountsAsAnyLocation: false,
          },
        },
      }),
    );

    expect(balanced.system).toContain(
      "adjacent roles the person could plausibly do well",
    );
    expect(balanced.system).toContain("counts as matching their locations");
    expect(strict.system).toContain("save only strong fits");
    expect(strict.system).not.toContain("find a broad pool of plausible jobs");
    expect(strict.system).toContain(
      "do not count a remote posting as a location match",
    );
  });

  test("uses the person's exact goal, freshness choice, and full profile", () => {
    const prompts = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "the example board",
          searchMode: "precision",
          searchRequest: {
            intent: "around engineering",
            breadth: "best_only",
            freshness: "recent",
            sourceIds: "all",
          },
        },
      }),
    );

    expect(prompts.system).toContain(
      'The person asked for: "around engineering"',
    );
    expect(prompts.system).toContain(
      "Freshness: prefer postings marked as recent",
    );
    expect(prompts.system).toContain("Builds dependable internal tools");
    expect(prompts.system).toContain("Platform Engineer · at Northwind");
    expect(prompts.system).toContain(
      "BSc · Computer Science · Example University",
    );
    expect(prompts.system).toContain("8 years of platform engineering");
  });

  test("saves what it reads, tells the model what was already saved, and finishes in its own words", async () => {
    const pages = { current: rawPage() };
    const conversation: string[] = [];
    const llm = scripted([
      { name: "extract_jobs", args: { pageType: "search_results" } },
      { name: "click", args: { ref: "a0" } },
      { name: "extract_jobs", args: { pageType: "search_results" } },
      {
        name: "finish",
        args: {
          reason: "The board has two postings that fit and no more pages",
        },
      },
    ]);
    const spyingLlm: LLMClient = {
      chatWithTools: (messages, tools, options) => {
        conversation.length = 0;
        for (const message of messages)
          conversation.push(`${message.role}: ${message.content}`);
        return llm.chatWithTools(messages, tools, options);
      },
    };

    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: spyingLlm,
      jobExtractor: extractor,
    });

    expect(result.jobs.map((job) => job.title)).toEqual([
      "Platform Engineer",
      "Data Engineer",
    ]);
    expect(result.jobs[0]?.discoveryMethod).toBe("browser_agent");
    expect(result.incomplete).toBe(false);
    expect(result.error).toBeUndefined();
    expect(conversation.join("\n")).toContain("Saved 2 new postings");
    expect(conversation.join("\n")).toContain(
      "2 on this page were already saved",
    );
  });

  test("an uncapped default search does not tell the model to stop at a numeric hint", () => {
    const prompts = createJobSearchPrompts(config({ retainAllFound: true }));
    expect(prompts.system).toContain("save all suitable results you find");
    expect(prompts.system).toContain("honor any limit in the person's request");
    expect(prompts.system).not.toContain("Find up to 10");
  });

  test("a conflicting goal does not promise to override Best matches only filters", () => {
    const request = {
      intent: "Find customer support roles instead",
      freshness: "any" as const,
      sourceIds: "all" as const,
    };
    const strict = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "Example",
          searchMode: "precision",
          searchRequest: request,
        },
      }),
    );
    expect(strict.system).toContain("cannot override them");
    expect(strict.system).toContain(
      "Explain the conflict in your finish reason",
    );
    expect(strict.system).toContain(
      "save no jobs: do not fall back to the saved role",
    );
    expect(strict.system).not.toContain("may narrow or redirect");
    const broad = createJobSearchPrompts(
      config({
        promptContext: {
          siteLabel: "Example",
          searchMode: "scale",
          searchRequest: request,
        },
      }),
    );
    expect(broad.system).toContain("may narrow or redirect");
  });

  test("the model sees the feed, goal and recency choice and selects original records", async () => {
    const catalog = ["Platform Engineer", "Data Engineer"].map((title, id) =>
      JobPostingSchema.parse({
        ...posting(title, "Example", String(id)),
        source: "target_site",
        discoveryMethod: "public_api",
        discoveredAt: "2026-09-20T10:00:00Z",
      }),
    );
    const model = scripted([
      { name: "list_catalog_jobs", args: { sort: "recent" } },
      { name: "save_catalog_jobs", args: { ids: [1] } },
      {
        name: "finish",
        args: { reason: "The data role fits the requested focus." },
      },
    ]);
    const seen: string[] = [];
    const result = await runJobSearchAgent({
      hands: hands({ current: rawPage() }),
      config: config({
        sourceCatalog: catalog,
        promptContext: {
          siteLabel: "Example",
          searchRequest: {
            intent: "Find data roles",
            freshness: "recent",
            sourceIds: "all",
          },
        },
      }),
      llmClient: {
        chatWithTools: (messages, tools, options) => {
          seen.push(messages.map((message) => message.content).join("\n"));
          return model.chatWithTools(messages, tools, options);
        },
      },
      jobExtractor: extractor,
    });
    expect(seen[0]).toContain("Find data roles");
    expect(seen[0]).toContain("Freshness: prefer postings marked as recent");
    expect(seen[0]).toContain("public feed already supplied 2 postings");
    expect(result.jobs).toEqual([catalog[1]]);
    expect(result.phaseCompletionReason).toBe(
      "The data role fits the requested focus.",
    );
  });

  test("a single temporary model failure does not end the search", async () => {
    const pages = { current: rawPage() };
    const llm = scripted([
      { name: "extract_jobs", args: { pageType: "search_results" } },
      { name: "finish", args: { reason: "Two postings fit; no more pages" } },
    ]);
    let calls = 0;
    const flakyLlm: LLMClient = {
      chatWithTools: (messages, tools, options) => {
        calls += 1;
        if (calls === 2) {
          const error = new Error("Service unavailable");
          error.name = "ModelRequestHttpError";
          Reflect.set(error, "status", 503);
          return Promise.reject(error);
        }
        return llm.chatWithTools(messages, tools, options);
      },
    };

    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: flakyLlm,
      jobExtractor: extractor,
    });

    expect(calls).toBe(3);
    expect(result.jobs).toHaveLength(2);
    expect(result.incomplete).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test("gives extraction observed posting URLs without saving scanner candidates automatically", async () => {
    const pages = { current: rawPage() };
    const jobUrls = [
      "https://jobs.example.test/jobs/one",
      "https://jobs.example.test/jobs/two",
    ];
    const page = {
      url: () => pages.current.url,
      title: () => Promise.resolve("Careers"),
      locator: () => ({ innerText: () => Promise.resolve(pages.current.bodyText) }),
      evaluate: () => Promise.resolve({
        structuredPostings: jobUrls.map((canonicalUrl) => ({
          sourceJobId: null,
          canonicalUrl,
          title: "Platform Engineer",
          company: "Northwind",
          location: "Manchester",
          description: "Build dependable platforms.",
          postedAtText: null,
          salaryText: null,
          employmentType: null,
          workModeHints: [],
        })),
        cardContainers: [],
        elements: [],
        cardSignatures: [],
      }),
    } as unknown as Page;
    const observed = await captureCompactDiscoveryObservation({
      page,
      targetId: "careers",
      observationId: "test_identity",
      revision: 1,
      observedAt: "2026-09-26T10:00:00.000Z",
    });
    expect(observed.kind).toBe("supported");
    if (observed.kind !== "supported") throw new Error("Expected job metadata.");
    expect(observed.postingCandidates.map((job) => job.canonicalUrl)).toEqual(jobUrls);

    const extractJobsFromPage = vi.fn<JobExtractor["extractJobsFromPage"]>(() => Promise.resolve([]));
    const result = await runJobSearchAgent({
      hands: hands(pages),
      page,
      config: config(),
      llmClient: scripted([
        { name: "extract_jobs", args: { pageType: "job_detail" } },
        { name: "finish", args: { reason: "Read the page." } },
      ]),
      jobExtractor: { extractJobsFromPage },
    });
    const extractionText = extractJobsFromPage.mock.calls[0]?.[0].pageText;
    for (const url of jobUrls) expect(extractionText).toContain(url);
    expect(extractionText).toContain("untrusted page evidence");
    expect(result.jobs).toEqual([]);
  });

  test("repairs a truncated detail title from the page's own heading before saving", async () => {
    const pages = {
      current: rawPage({
        url: "https://jobs.example.test/jobs/4",
        bodyText:
          "Paper Orbit Studio Remote, Americas Posted 1d ago Frontend Engineer, Paper Interfaces About the role Build reliable software for the product team.",
        headings: [
          { level: 1, text: "Frontend Engineer, Paper Interfaces" },
          { level: 2, text: "About the role" },
        ],
      }),
    };
    const detailExtractor: JobExtractor = {
      extractJobsFromPage: vi.fn(() =>
        Promise.resolve([
          {
            ...posting("Frontend Engineer,", "Paper Orbit Studio", "4"),
            sourceJobId: "jobs_example_test_jobs_4",
            canonicalUrl: "https://jobs.example.test/jobs/4",
            location: "Remote, Americas",
            description:
              "About the role Build reliable software for the product team.",
          },
        ]),
      ),
    };

    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config({
        startingUrls: ["https://jobs.example.test/jobs/4"],
      }),
      llmClient: scripted([
        { name: "extract_jobs", args: { pageType: "job_detail" } },
        { name: "finish", args: { reason: "The detail page was read." } },
      ]),
      jobExtractor: detailExtractor,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.title).toBe("Frontend Engineer, Paper Interfaces");
    expect(result.jobs[0]?.sourceJobId).toBe("4");
  });

  test("does not repair a title from a lower related-job heading", async () => {
    const pages = {
      current: rawPage({
        url: "https://jobs.example.test/jobs/risk",
        bodyText:
          "Data Engineer, Risk. About the role. Related jobs: Data Engineer, Payments.",
        headings: [
          { level: 1, text: "Data Engineer, Risk" },
          { level: 2, text: "Related jobs" },
          { level: 3, text: "Data Engineer, Payments" },
        ],
      }),
    };
    const detailExtractor: JobExtractor = {
      extractJobsFromPage: vi.fn(() =>
        Promise.resolve([
          {
            ...posting("Data Engineer, Risk", "Acme", "risk"),
            canonicalUrl: "https://jobs.example.test/jobs/risk",
          },
        ]),
      ),
    };

    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config({ startingUrls: ["https://jobs.example.test/jobs/risk"] }),
      llmClient: scripted([
        { name: "extract_jobs", args: { pageType: "job_detail" } },
        { name: "finish", args: { reason: "The detail page was read." } },
      ]),
      jobExtractor: detailExtractor,
    });

    expect(result.jobs[0]?.title).toBe("Data Engineer, Risk");
  });

  test("reads a task-relevant same-site GET endpoint through the live browser session", async () => {
    const pages = { current: rawPage() };
    const get = vi.fn(
      (url: string, options: { headers: Record<string, string> }) => {
        void url;
        void options;
        return Promise.resolve({
          text: () => Promise.resolve('{"jobs":[{"id":"j1"}]}'),
          status: () => 200,
          statusText: () => "OK",
          headers: () => ({ "content-type": "application/json" }),
          ok: () => true,
        });
      },
    );
    const page = {
      url: () => pages.current.url ?? "",
      context: () => ({ request: { get } }),
    } as unknown as Page;

    await runJobSearchAgent({
      hands: hands(pages),
      page,
      config: config(),
      llmClient: scripted([
        {
          name: "read_page_api",
          args: {
            url: "/api/jobs?query=engineer",
            reason:
              "The results page loads its visible job cards from this endpoint.",
          },
        },
        {
          name: "finish",
          args: { reason: "The site API returned the job data needed." },
        },
      ]),
      jobExtractor: extractor,
    });

    const [requestedUrl, requestOptions] = get.mock.calls[0] ?? [];
    expect(requestedUrl).toBe(
      "https://jobs.example.test/api/jobs?query=engineer",
    );
    expect(requestOptions?.headers.accept).toContain("application/json");
  });

  test("reviews a task-relevant API-only origin before reading it directly", async () => {
    const pages = { current: rawPage() };
    const get = vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve('{"jobs":[{"id":"j1"}]}'),
        status: () => 200,
        statusText: () => "OK",
        headers: () => ({ "content-type": "application/json" }),
        ok: () => true,
      }),
    );
    const page = {
      url: () => pages.current.url ?? "",
      context: () => ({ request: { get } }),
    } as unknown as Page;
    let agentTurn = 0;
    const reviews: string[] = [];
    const llmClient: LLMClient = {
      chatWithTools(messages, tools) {
        if (tools.some((tool) => tool.function.name === "decide")) {
          reviews.push(messages.map((message) => message.content).join("\n"));
          return Promise.resolve({
            toolCalls: [
              {
                id: "review_direct",
                type: "function" as const,
                function: {
                  name: "decide",
                  arguments: JSON.stringify({
                    allowed: true,
                    verdict: "The endpoint is the employer's job data service.",
                  }),
                },
              },
            ],
          });
        }
        agentTurn += 1;
        return scripted(
          agentTurn === 1
            ? [
                {
                  name: "read_page_api",
                  args: {
                    url: "https://api.employer.test/jobs",
                    reason:
                      "The page names this endpoint as its visible-card data source.",
                  },
                },
              ]
            : [
                {
                  name: "finish",
                  args: { reason: "The reviewed API returned the job data." },
                },
              ],
        ).chatWithTools(messages, tools);
      },
    };

    await runJobSearchAgent({
      hands: hands(pages),
      page,
      config: config(),
      llmClient,
      jobExtractor: extractor,
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toContain("https://api.employer.test/jobs");
    expect(get).toHaveBeenCalledOnce();
  });

  test("reviews every off-scope API redirect and refuses before following it", async () => {
    const pages = { current: rawPage() };
    const get = vi.fn(() =>
      Promise.resolve({
        text: () => Promise.resolve(""),
        status: () => 302,
        statusText: () => "Found",
        headers: () => ({ location: "https://tracker.invalid/jobs" }),
        ok: () => false,
      }),
    );
    const page = {
      url: () => pages.current.url ?? "",
      context: () => ({ request: { get } }),
    } as unknown as Page;
    let agentTurn = 0;
    const llmClient: LLMClient = {
      chatWithTools(messages, tools) {
        if (tools.some((tool) => tool.function.name === "decide")) {
          return Promise.resolve({
            toolCalls: [
              {
                id: "review_redirect",
                type: "function" as const,
                function: {
                  name: "decide",
                  arguments: JSON.stringify({
                    allowed: false,
                    verdict:
                      "This tracker is unrelated to reading the posting.",
                  }),
                },
              },
            ],
          });
        }
        agentTurn += 1;
        return scripted(
          agentTurn === 1
            ? [
                {
                  name: "read_page_api",
                  args: {
                    url: "/api/jobs",
                    reason:
                      "The results page says visible cards come from this endpoint.",
                  },
                },
              ]
            : [
                {
                  name: "finish",
                  args: { reason: "The unrelated redirect was refused." },
                },
              ],
        ).chatWithTools(messages, tools);
      },
    };

    await runJobSearchAgent({
      hands: hands(pages),
      page,
      config: config(),
      llmClient,
      jobExtractor: extractor,
    });

    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(
      "https://jobs.example.test/api/jobs",
      expect.objectContaining({ maxRedirects: 0 }),
    );
  });

  test("a sign-in wall the model reports becomes a typed blocker with the page it happened on", async () => {
    const pages = { current: rawPage() };
    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: scripted([
        {
          name: "finish",
          args: {
            reason:
              "The results load, but every posting opens a sign-in page before the details",
            needsPerson: true,
            blockedBy: "sign_in",
          },
        },
      ]),
      jobExtractor: extractor,
    });

    expect(result.incomplete).toBe(true);
    expect(result.accessBlockerReason).toBe("auth_required");
    expect(result.parkedPageUrl).toBe(
      "https://jobs.example.test/search?q=engineer",
    );
    expect(result.error).toBe(
      "The results load, but every posting opens a sign-in page before the details.",
    );
  });

  test("a visible password form corrects a generic manual-step handoff to sign-in", async () => {
    const pages = {
      current: rawPage({
        title: "Sign in to see jobs",
        bodyText: "Sign in to view job listings.",
        controls: [
          {
            index: 0,
            tagName: "input",
            inputType: "password",
            role: "textbox",
            id: "password",
            name: "password",
            label: "Password",
            groupLabel: "",
            placeholder: "Password",
            autocomplete: "current-password",
            required: true,
            invalid: false,
            validationMessage: "",
            disabled: false,
            readOnly: false,
            visible: true,
            value: "",
            checked: false,
            multiple: false,
            options: [],
            selectedOptionLabel: "",
          },
        ],
      }),
    };
    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: scripted([
        {
          name: "finish",
          args: {
            reason:
              "The source asks the person to sign in before showing jobs.",
            needsPerson: true,
            blockedBy: "manual_step",
          },
        },
      ]),
      jobExtractor: extractor,
    });

    expect(result.accessBlockerReason).toBe("auth_required");
    expect(result.error).toBe(
      "The source asks the person to sign in before showing jobs.",
    );
  });

  test("a stuck finish carries the model's report", async () => {
    const pages = { current: rawPage() };
    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: scripted([
        {
          name: "finish",
          args: {
            reason: "Next page keeps returning the same ten postings",
            stuck: true,
          },
        },
      ]),
      jobExtractor: extractor,
    });

    expect(result.incomplete).toBe(true);
    expect(result.error).toContain(
      "because it got stuck: Next page keeps returning the same ten postings.",
    );
  });

  test("a source check returns the model's structured findings", async () => {
    const pages = { current: rawPage() };
    const result = await runJobSearchAgent({
      hands: hands(pages),
      config: config({
        promptContext: {
          siteLabel: "the example board",
          taskPacket: {
            phase: "search_filter_probe",
            phaseGoal: "Prove which controls change results",
            knownFacts: [],
            avoidStrategyFingerprints: [],
            successCriteria: [],
            stopConditions: [],
          },
        },
      }),
      llmClient: scripted([
        {
          name: "extract_jobs",
          args: { pageType: "search_results", maxJobs: 2 },
        },
        {
          name: "finish",
          args: {
            reason: "The search box at the top narrows results by title",
            summary: "Search box narrows by title.",
            reliableControls: ["Top search box"],
            warnings: ["Location filter is decorative"],
          },
        },
      ]),
      jobExtractor: extractor,
    });

    expect(result.phaseCompletionMode).toBe("structured_finish");
    expect(result.phaseCompletionReason).toContain("search box");
    expect(result.debugFindings?.reliableControls).toEqual(["Top search box"]);
    expect(result.phaseEvidence?.warnings).toEqual([
      "Location filter is decorative",
    ]);
    expect(result.phaseEvidence?.routeSignals).toContain(
      "https://jobs.example.test/search",
    );
  });

  test("a resumed run starts with the jobs it already had and skips them on re-read", async () => {
    const pages = { current: rawPage() };
    const first = await runJobSearchAgent({
      hands: hands(pages),
      config: config(),
      llmClient: scripted([
        { name: "extract_jobs", args: { pageType: "search_results" } },
        { name: "finish", args: { reason: "Done" } },
      ]),
      jobExtractor: extractor,
    });
    const checkpoints: unknown[] = [];
    const resumed = await runJobSearchAgent({
      hands: hands(pages),
      config: config({
        resumeCheckpoint: {
          revision: 3,
          savedAt: "2026-09-14T10:00:00.000Z",
          currentUrl: "https://jobs.example.test/search?q=engineer",
          lastStableUrl: "https://jobs.example.test/search?q=engineer",
          stepCount: 4,
          collectedJobs: first.jobs,
          visitedUrls: [],
          phaseEvidence: {
            visibleControls: [],
            successfulInteractions: [],
            routeSignals: [],
            attemptedControls: [],
            warnings: [],
            visualFindings: [],
          },
        },
        onCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint);
        },
      }),
      llmClient: scripted([
        { name: "extract_jobs", args: { pageType: "search_results" } },
        { name: "finish", args: { reason: "Done" } },
      ]),
      jobExtractor: extractor,
    });

    expect(resumed.jobs).toHaveLength(2);
    // Nothing new was saved, so no checkpoint was written on the re-read.
    expect(checkpoints).toHaveLength(0);
  });
});

describe("what the person sees while it runs", () => {
  test("turn notes are rewritten without tool names or handles", async () => {
    const { describeStepForPerson } = await import("./job-search-agent");
    expect(describeStepForPerson("observe → Page: https://x.test")).toBe(
      "Looking at the page.",
    );
    expect(describeStepForPerson('click → Pressed "Next page".')).toBe(
      'Pressing "Next page".',
    );
    expect(describeStepForPerson("type → Typed into c1. The page now:")).toBe(
      "Typing into a field.",
    );
    expect(describeStepForPerson("wait → Waited 2000ms.")).toBe(
      "Waiting for the page to settle.",
    );
    expect(describeStepForPerson("scan_cards → Saved 12 new postings:")).toBe(
      "Saved 12 new postings.",
    );
    expect(describeStepForPerson("extract_jobs → Saved no new postings.")).toBe(
      "Read the page; nothing new here.",
    );
    expect(
      describeStepForPerson("navigate → Opened https://jobs.example.test/p2."),
    ).toBe("Opening https://jobs.example.test/p2.");
  });
});
