import { describe, expect, test } from "vitest";
import type { Page } from "playwright";
import {
  DISCOVERY_OBSERVATION_TEXT_SAMPLE_MAX,
  DiscoveryCompactObservationSchema,
  getDiscoveryCompactObservationControlRef,
  isCurrentDiscoveryCompactObservationRef,
  type DiscoveryCompactObservation,
} from "@unemployed/contracts";
import {
  captureCompactDiscoveryObservation,
  classifyOverlayCloseControl,
  classifyPaginationControl,
  classifyBlockingOverlaySignal,
  classifyUnsupportedSignal,
  createDiscoveryRefIdAllocator,
  deduplicatePostingCandidates,
  deriveSourceJobIdFromUrl,
  expandInlineMetadataSegments,
  buildDomCardPostingCandidate,
  truncateBoundedText,
  type CaptureCompactDiscoveryObservationInput,
  type CompactDiscoveryScanPayload,
} from "./compact-discovery-observer";

// ---------------------------------------------------------------------------
// In-memory fake pages
//
// The observer's only Playwright surface is `url()`, `title()`,
// `locator("body").innerText()/ariaSnapshot()`, and one `page.evaluate` scan.
// Fakes implement exactly that surface, so every test stays in-memory,
// serial-friendly, and browser-free. The evaluate fake recognizes the scanner
// by its function name (stable under esbuild/vitest transforms) and returns a
// detached fixture payload.
// ---------------------------------------------------------------------------

const SCANNER_FN_NAME = "compactDiscoveryInPageScan";
const ROLE_PAGE_URL =
  "https://wellfound.com/role/l/data-engineer/san-francisco";

interface FakePageConfig {
  url: string;
  title?: string | Error;
  bodyText?: string | Error;
  snapshot?: string;
  scanPayload?: CompactDiscoveryScanPayload | null;
  scanError?: Error;
}

function createFakePage(config: FakePageConfig): Page {
  const bodyLocator = {
    innerText: (): Promise<string> => {
      if (config.bodyText instanceof Error) {
        return Promise.reject(config.bodyText);
      }
      return Promise.resolve(config.bodyText ?? "");
    },
    ...(config.snapshot === undefined
      ? {}
      : {
          ariaSnapshot: (): Promise<string> =>
            Promise.resolve(config.snapshot ?? ""),
        }),
  };

  return {
    url: () => config.url,
    title: (): Promise<string> => {
      if (config.title instanceof Error) {
        return Promise.reject(config.title);
      }
      return Promise.resolve(config.title ?? "");
    },
    locator: (selector: string) => {
      if (selector !== "body") {
        throw new Error(`Unexpected locator in fake page: ${selector}`);
      }
      return bodyLocator;
    },
    evaluate: (fn: unknown): Promise<unknown> => {
      if (config.scanError) {
        return Promise.reject(config.scanError);
      }
      if (typeof fn === "function" && String(fn).includes(SCANNER_FN_NAME)) {
        return Promise.resolve(config.scanPayload ?? null);
      }
      return Promise.resolve(null);
    },
  } as unknown as Page;
}

function createBaseInput(overrides?: {
  page?: Page;
  observationId?: string;
  revision?: number;
}): CaptureCompactDiscoveryObservationInput {
  return {
    page:
      overrides?.page ??
      createFakePage({ url: "https://jobs.example.com/listing" }),
    targetId: "target_example_1",
    observationId: overrides?.observationId ?? "obs_test_0001",
    revision: overrides?.revision ?? 1,
    observedAt: "2026-08-26T10:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Scan payload fixtures (<50 postings everywhere)
// ---------------------------------------------------------------------------

function makeElement(overrides: {
  role?: string;
  accessibleName?: string;
  href?: string | null;
  containerKey?: string | null;
  jobIdHint?: string | null;
  companyHref?: string | null;
  companyLabel?: string | null;
}): CompactDiscoveryScanPayload["elements"][number] {
  return {
    role: overrides.role ?? "link",
    accessibleName: overrides.accessibleName ?? "",
    href: overrides.href === undefined ? null : overrides.href,
    containerKey:
      overrides.containerKey === undefined ? "c0" : overrides.containerKey,
    jobIdHint: overrides.jobIdHint ?? null,
    companyHref: overrides.companyHref ?? null,
    companyLabel: overrides.companyLabel ?? null,
  };
}

function makeContainer(
  key: string,
  lines: string[],
  overrides?: {
    headingText?: string | null;
    easyApplyHint?: boolean;
    companyHref?: string | null;
    companyLabel?: string | null;
    repeatedCard?: boolean;
  },
): CompactDiscoveryScanPayload["cardContainers"][number] {
  return {
    key,
    repeatedCard: overrides?.repeatedCard ?? false,
    headingText: overrides?.headingText ?? null,
    lines,
    easyApplyHint: overrides?.easyApplyHint ?? false,
    companyHref: overrides?.companyHref ?? null,
    companyLabel: overrides?.companyLabel ?? null,
  };
}

function emptyScanPayload(): CompactDiscoveryScanPayload {
  return {
    structuredPostings: [],
    cardContainers: [],
    elements: [],
    cardSignatures: [],
  };
}

function standardListingPayload(): CompactDiscoveryScanPayload {
  const payload = emptyScanPayload();
  for (let index = 1; index <= 3; index += 1) {
    payload.cardContainers.push(
      makeContainer(
        `c${index}`,
        [
          `Job Title ${index}`,
          `Company ${index} · Berlin, DE`,
          `Posted ${index} days ago`,
          `Build thing number ${index} with a small team.`,
        ],
        { headingText: `Job Title ${index}` },
      ),
    );
    payload.elements.push(
      makeElement({
        accessibleName: `Job Title ${index}`,
        href: `https://jobs.example.com/jobs/view/${1000 + index}`,
        containerKey: `c${index}`,
        jobIdHint: `${1000 + index}`,
      }),
    );
  }
  return payload;
}

function captureFrom(
  config: FakePageConfig,
  overrides?: Partial<CaptureCompactDiscoveryObservationInput>,
): Promise<DiscoveryCompactObservation> {
  return Promise.resolve(
    captureCompactDiscoveryObservation({
      ...createBaseInput({ page: createFakePage(config) }),
      ...overrides,
    }),
  );
}

describe("compact discovery observer", () => {
  test("standard listing page produces a supported bounded observation", async () => {
    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      title: "Example Jobs",
      bodyText: ["Example Jobs", "Job Title 1", "Job Title 2"].join("\n"),
      snapshot: '- list:\n  - link "Job Title 1"',
      scanPayload: standardListingPayload(),
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    expect(observation.postingCandidates).toHaveLength(3);
    expect(observation.sourceKind).toBe("accessibility_snapshot");
    expect(observation.pageUrl).toBe("https://jobs.example.com/listing");
    expect(observation.pageTitle).toBe("Example Jobs");
    expect(observation.observedAt).toBe("2026-08-26T10:00:00.000Z");
    expect(observation.content.textTruncated).toBe(false);
    expect(observation.content.accessibilitySummaryTruncated).toBe(false);
    expect(observation.omittedPostingCandidateCount).toBe(0);

    const first = observation.postingCandidates[0];
    expect(first.title).toBe("Job Title 1");
    expect(first.company).toBe("Company 1");
    expect(first.location).toBe("Berlin, DE");
    expect(first.postedAtText).toBe("Posted 1 days ago");
    expect(first.sourceJobId).toBe("1001");

    // Snapshot-scoped refs are unique across both candidate groups.
    const refIds = [
      ...observation.paginationCandidates.map((candidate) => candidate.refId),
      ...observation.actionCandidates.map((candidate) => candidate.refId),
    ];
    expect(new Set(refIds).size).toBe(refIds.length);

    // Output is a fully detached DTO: JSON round-trip preserves it.
    expect(JSON.parse(JSON.stringify(observation))).toEqual(observation);
    expect(
      DiscoveryCompactObservationSchema.safeParse(observation).success,
    ).toBe(true);
  });

  test("keeps a first-seen access gate openable but never saves it as a posting", async () => {
    const payload = emptyScanPayload();
    payload.cardContainers.push(
      makeContainer(
        "gate",
        [
          "Security Engineer",
          "Example Co · Remote · Full-time",
          "Build secure systems.",
        ],
        { headingText: "Security Engineer" },
      ),
    );
    payload.elements.push(
      makeElement({
        accessibleName: "Security Engineer",
        href: "https://jobs.example.com/security/42",
        containerKey: "gate",
        jobIdHint: "42",
      }),
    );

    const observation = await captureFrom({
      url: "https://jobs.example.com/",
      title: "Example Jobs",
      bodyText: "Security Engineer Example Co Remote",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }
    expect(observation.postingCandidates).toHaveLength(0);
    expect(observation.actionCandidates).toEqual([
      expect.objectContaining({
        kind: "open_posting",
        label: "Security Engineer",
      }),
    ]);
  });

  test("inline-metadata cards split company, location, salary, and date", async () => {
    const payload = emptyScanPayload();
    payload.cardContainers.push(
      makeContainer(
        "inline-1",
        [
          "Data Platform Engineer",
          "Acme Systems · Berlin, DE · €70,000 - €90,000 · Posted 3 days ago",
        ],
        { headingText: "Data Platform Engineer" },
      ),
    );
    payload.elements.push(
      makeElement({
        accessibleName: "Data Platform Engineer",
        href: "https://jobs.example.com/jobs/view/abc123456789",
        containerKey: "inline-1",
      }),
    );

    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "Data Platform Engineer",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    const posting = observation.postingCandidates[0];
    expect(posting.title).toBe("Data Platform Engineer");
    expect(posting.company).toBe("Acme Systems");
    expect(posting.location).toBe("Berlin, DE");
    // Salary ranges survive inline-separator splitting intact.
    expect(posting.salaryText).toContain("€70,000");
    expect(posting.salaryText).toContain("€90,000");
    expect(posting.postedAtText).toBe("Posted 3 days ago");
    expect(posting.easyApplyEligible).toBe(false);
  });

  test("JSON-LD postings win over duplicate DOM rows sharing the composite", async () => {
    const payload = standardListingPayload();
    payload.structuredPostings.push({
      sourceJobId: "1001",
      canonicalUrl: "https://jobs.example.com/jobs/view/1001",
      title: "Job Title 1 (canonical)",
      company: "Company 1 GmbH",
      location: "Remote",
      description: "Structured description from JSON-LD.",
      postedAtText: "2026-08-20T09:00:00.000Z",
      salaryText: "$120,000 - $150,000 a year",
      employmentType: "FULL_TIME",
      workModeHints: [],
    });

    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "listing",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    // The JSON-LD row and DOM row share canonical URL + source id composite.
    expect(observation.postingCandidates).toHaveLength(3);
    const merged = observation.postingCandidates.find(
      (posting) => posting.sourceJobId === "1001",
    );
    expect(merged?.title).toBe("Job Title 1 (canonical)");
    expect(merged?.postedAt).toBe("2026-08-20T09:00:00.000Z");
    expect(merged?.salaryText).toBe("$120,000 - $150,000 a year");
    expect(
      observation.uncertaintyNotes.some((note) =>
        note.includes("duplicate posting row(s) merged"),
      ),
    ).toBe(true);
  });

  test("duplicate DOM rows fill missing or malformed JSON-LD metadata", async () => {
    const payload = standardListingPayload();
    payload.structuredPostings.push({
      sourceJobId: "1001",
      canonicalUrl: "https://jobs.example.com/jobs/view/1001",
      title: "Job Title 1 (canonical)",
      company: "Https Jobs Example Com",
      location: null,
      description: null,
      postedAtText: null,
      salaryText: null,
      employmentType: null,
      workModeHints: [],
    });

    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "listing",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    const merged = observation.postingCandidates.find(
      (posting) => posting.sourceJobId === "1001",
    );
    expect(merged).toEqual(
      expect.objectContaining({
        title: "Job Title 1 (canonical)",
        company: "Company 1",
        location: "Berlin, DE",
        description: "Build thing number 1 with a small team.",
        postedAtText: "Posted 1 days ago",
      }),
    );
  });

  test("exact duplicates merge while distinct source ids stay separate", () => {
    const candidates = deduplicatePostingCandidates([
      {
        sourceJobId: "a1",
        canonicalUrl: "https://jobs.example.com/jobs/view/a1",
        applicationUrl: null,
        title: "Role A",
        company: "Co A",
        location: "Remote",
        description: null,
        salaryText: null,
        postedAtText: null,
        postedAtIso: null,
        employmentType: null,
        workModeHints: [],
        easyApplyEligible: false,
        origin: "dom_card",
      },
      // Exact composite repeat.
      {
        sourceJobId: "a1",
        canonicalUrl: "https://jobs.example.com/jobs/view/a1",
        applicationUrl: null,
        title: "Role A (repeat)",
        company: "Co A",
        location: "Remote",
        description: null,
        salaryText: null,
        postedAtText: null,
        postedAtIso: null,
        employmentType: null,
        workModeHints: [],
        easyApplyEligible: false,
        origin: "dom_card",
      },
      // Same URL but a different source id stays a distinct candidate.
      {
        sourceJobId: "a2",
        canonicalUrl: "https://jobs.example.com/jobs/view/a1",
        applicationUrl: null,
        title: "Role B",
        company: "Co B",
        location: "Hybrid",
        description: null,
        salaryText: null,
        postedAtText: null,
        postedAtIso: null,
        employmentType: null,
        workModeHints: [],
        easyApplyEligible: false,
        origin: "dom_card",
      },
    ]);

    expect(candidates.uniqueCandidates).toHaveLength(2);
    expect(candidates.duplicatesMergedCount).toBe(1);
  });

  test("pagination controls are classified by accessible name with honest caps", async () => {
    const payload = emptyScanPayload();
    const paginationLabels = [
      ["Next »", "next_page"],
      ["Previous", "previous_page"],
      ["2", "numbered_page"],
      ["Page 3", "numbered_page"],
      ["Load More Jobs", "load_more"],
      ["Show more results", "load_more"],
    ] as const;
    paginationLabels.forEach(([label], index) => {
      payload.elements.push(
        makeElement({
          accessibleName: label,
          href: `https://jobs.example.com/listing?page=${index + 2}`,
          containerKey: null,
        }),
      );
    });

    const observation = await captureFrom({
      url: "https://jobs.example.com/listing?page=1",
      bodyText: "page 1 of results",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    const kindsByLabel = new Map(
      observation.paginationCandidates.map((candidate) => [
        candidate.label,
        candidate,
      ]),
    );
    expect(kindsByLabel.get("Next »")?.kind).toBe("next_page");
    expect(kindsByLabel.get("Previous")?.kind).toBe("previous_page");
    expect(kindsByLabel.get("2")?.pageNumber).toBe(2);
    expect(kindsByLabel.get("Page 3")?.pageNumber).toBe(3);
    expect(kindsByLabel.get("Load More Jobs")?.kind).toBe("load_more");
    expect(kindsByLabel.get("Show more results")?.kind).toBe("load_more");

    // Pagination links must not leak into open-posting actions.
    expect(observation.actionCandidates).toHaveLength(0);

    // Bounded cap honored with an explicit omission note.
    const capped = await captureCompactDiscoveryObservation({
      ...createBaseInput({
        page: createFakePage({
          url: "https://jobs.example.com/listing?page=1",
          bodyText: "results",
          scanPayload: payload,
        }),
      }),
      options: { paginationCandidatesMax: 2 },
    });
    expect(capped.kind).toBe("supported");
    if (capped.kind !== "supported") {
      return;
    }
    expect(capped.paginationCandidates).toHaveLength(2);
    expect(
      capped.uncertaintyNotes.some((note) =>
        note.includes("pagination candidate(s) omitted"),
      ),
    ).toBe(true);
  });

  test("open-posting actions bind only to kept card candidates", async () => {
    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "listings",
      scanPayload: standardListingPayload(),
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    expect(observation.actionCandidates).toHaveLength(3);
    expect(
      observation.actionCandidates.every(
        (candidate) => candidate.kind === "open_posting",
      ),
    ).toBe(true);
    expect(observation.actionCandidates.map((c) => c.label)).toEqual([
      "Job Title 1",
      "Job Title 2",
      "Job Title 3",
    ]);
  });

  test("short listing pages still succeed without line-shape assumptions", async () => {
    const payload = emptyScanPayload();
    payload.cardContainers.push(makeContainer("tiny-1", []));
    payload.elements.push(
      makeElement({
        accessibleName: "Q1 Engineer",
        href: "https://jobs.example.com/jobs/44442222",
        containerKey: "tiny-1",
      }),
    );

    const observation = await captureFrom({
      url: "https://jobs.example.com/tiny",
      bodyText: "Q1 Engineer\nTiny Co",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    const posting = observation.postingCandidates[0];
    expect(posting.title).toBe("Q1 Engineer");
    expect(posting.company).toBe("Employer not stated");
    expect(posting.location).toBe("Location not stated");
    expect(posting.description.length).toBeGreaterThan(0);
    expect(posting.salaryText).toBeNull();
    expect(posting.workMode).toEqual([]);
  });

  test.each([
    [
      "auth wall",
      "auth_required",
      "Sign in to continue viewing jobs at Example Corp. Your session expired.",
    ],
    [
      "bot protection",
      "site_protection",
      "Attention Required! Please verify you are human to access this page. Captcha 7f2a.",
    ],
    [
      "manual challenge",
      "manual_step_required",
      "Press and hold to confirm you are not a robot, then complete the puzzle.",
    ],
  ])(
    "%s returns exactly one explicit unsupported reason",
    async (_label, reason, bodyText) => {
      const observation = await captureFrom({
        url: "https://jobs.example.com/walled",
        title: "Example Corp",
        bodyText,
        snapshot: `- text "${bodyText.slice(0, 40)}"`,
        scanPayload: emptyScanPayload(),
      });

      expect(observation.kind).toBe("unsupported");
      if (observation.kind !== "unsupported") {
        return;
      }

      expect(observation.reason).toBe(reason);
      expect(observation.detail).toBeTruthy();
      // Unsupported observations keep bounded summaries as escalation context.
      expect(observation.content.textSample).toBeTruthy();
      expect(
        DiscoveryCompactObservationSchema.safeParse(observation).success,
      ).toBe(true);
    },
  );

  test("keeps public inventory when a non-blocking sign-in banner is present", async () => {
    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      title: "Example Jobs",
      bodyText:
        "Sign in to continue saving roles. Public jobs remain available below.",
      scanPayload: standardListingPayload(),
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }
    expect(observation.postingCandidates).toHaveLength(3);
  });

  test("benign contentless page reports unsupported_layout", async () => {
    const observation = await captureFrom({
      url: "https://jobs.example.com/about",
      title: "About Us",
      bodyText: "We are a small team building useful software products.",
      snapshot: '- text "We are a small team"',
      scanPayload: emptyScanPayload(),
    });

    expect(observation.kind).toBe("unsupported");
    if (observation.kind !== "unsupported") {
      return;
    }
    expect(observation.reason).toBe("unsupported_layout");
    expect(observation.content.textSample).toContain("small team");
  });

  test("capture failures and unusable URLs fail closed as navigation_failed", async () => {
    const throwingObservation = await captureFrom({
      url: "https://jobs.example.com/broken",
      bodyText: "content",
      scanError: new Error("Execution context was destroyed"),
    });
    expect(throwingObservation.kind).toBe("unsupported");
    if (throwingObservation.kind !== "unsupported") {
      return;
    }
    expect(throwingObservation.reason).toBe("navigation_failed");
    expect(throwingObservation.detail).toBe(
      "Compact snapshot capture failed (Error).",
    );

    const blankObservation = await captureFrom({
      url: "about:blank",
      bodyText: "",
    });
    expect(blankObservation.kind).toBe("unsupported");
    if (blankObservation.kind !== "unsupported") {
      return;
    }
    expect(blankObservation.reason).toBe("navigation_failed");
  });

  test("truncation and bounds are honest at contract and caller limits", async () => {
    const longText = `padded ${"x".repeat(DISCOVERY_OBSERVATION_TEXT_SAMPLE_MAX * 2)}`;
    const longSnapshot = `- list:\n${Array.from(
      { length: 40 },
      (_, index) => `  - link "row ${index}"`,
    ).join("\n")}`;

    const widePayload = emptyScanPayload();
    for (let index = 0; index < 8; index += 1) {
      widePayload.cardContainers.push(makeContainer(`w${index}`, []));
      widePayload.elements.push(
        makeElement({
          accessibleName: `Wide Role ${index}`,
          href: `https://jobs.example.com/jobs/view/${20000 + index}`,
          containerKey: `w${index}`,
          jobIdHint: `${20000 + index}`,
        }),
      );
    }

    const observation = await captureCompactDiscoveryObservation({
      ...createBaseInput({
        page: createFakePage({
          url: "https://jobs.example.com/listing",
          bodyText: longText,
          snapshot: longSnapshot,
          scanPayload: widePayload,
        }),
      }),
      options: {
        postingCandidatesMax: 5,
        textSampleMaxChars: DISCOVERY_OBSERVATION_TEXT_SAMPLE_MAX + 5000,
      },
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    // Caller option above the contract max clamps down to the constant.
    expect(observation.content.textSample?.length).toBeLessThanOrEqual(
      DISCOVERY_OBSERVATION_TEXT_SAMPLE_MAX,
    );
    expect(observation.content.textTruncated).toBe(true);
    expect(observation.content.accessibilitySummaryTruncated).toBe(false);

    expect(observation.postingCandidates).toHaveLength(5);
    expect(observation.omittedPostingCandidateCount).toBe(3);
    expect(
      observation.uncertaintyNotes.some((note) =>
        note.includes("3 unique posting candidate(s) omitted"),
      ),
    ).toBe(true);

    // Custom smaller caps are respected exactly.
    const tight = await captureCompactDiscoveryObservation({
      ...createBaseInput({
        page: createFakePage({
          url: "https://jobs.example.com/listing",
          bodyText: longText,
          snapshot: longSnapshot,
          scanPayload: widePayload,
        }),
      }),
      options: {
        textSampleMaxChars: 50,
        postingCandidatesMax: 2,
      },
    });
    expect(tight.kind).toBe("supported");
    if (tight.kind !== "supported") {
      return;
    }
    expect(tight.content.textSample?.length).toBe(50);
    expect(tight.postingCandidates).toHaveLength(2);
    expect(tight.omittedPostingCandidateCount).toBe(6);
  });

  test("reference ids are stable across rerenders of the same page shape", async () => {
    const firstObservation = await captureFrom(
      {
        url: "https://jobs.example.com/listing",
        bodyText: "stable shape",
        scanPayload: standardListingPayload(),
      },
      { observationId: "obs_render_1", revision: 1 },
    );
    const secondObservation = await captureFrom(
      {
        url: "https://jobs.example.com/listing",
        bodyText: "stable shape",
        scanPayload: standardListingPayload(),
      },
      { observationId: "obs_render_2", revision: 2 },
    );

    expect(firstObservation.kind).toBe("supported");
    expect(secondObservation.kind).toBe("supported");
    if (
      firstObservation.kind !== "supported" ||
      secondObservation.kind !== "supported"
    ) {
      return;
    }

    const firstRefIds = firstObservation.actionCandidates.map((c) => c.refId);
    const secondRefIds = secondObservation.actionCandidates.map((c) => c.refId);
    expect(secondRefIds).toEqual(firstRefIds);

    // Detached refs bind to their own observation identity and go stale
    // against any other identity.
    const ref = getDiscoveryCompactObservationControlRef(
      firstObservation,
      firstRefIds[0] ?? "",
    );
    expect(isCurrentDiscoveryCompactObservationRef(ref, firstObservation)).toBe(
      true,
    );
    expect(
      isCurrentDiscoveryCompactObservationRef(ref, secondObservation),
    ).toBe(false);
  });

  test("duplicate control labels can never produce duplicate ref ids", async () => {
    const payload = emptyScanPayload();
    payload.elements.push(
      makeElement({
        accessibleName: "Next »",
        href: "https://jobs.example.com/listing?a=1",
        containerKey: null,
      }),
      makeElement({
        accessibleName: "Next »",
        href: "https://jobs.example.com/listing?a=2",
        containerKey: null,
      }),
      makeElement({
        accessibleName: "Dismiss",
        role: "button",
        containerKey: null,
      }),
      makeElement({
        accessibleName: "Dismiss",
        role: "button",
        containerKey: null,
      }),
    );

    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "paged results",
      scanPayload: payload,
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }

    const refIds = [
      ...observation.paginationCandidates.map((candidate) => candidate.refId),
      ...observation.actionCandidates.map((candidate) => candidate.refId),
    ];
    expect(observation.paginationCandidates).toHaveLength(2);
    expect(observation.actionCandidates).toHaveLength(2);
    expect(new Set(refIds).size).toBe(refIds.length);
    expect(
      DiscoveryCompactObservationSchema.safeParse(observation).success,
    ).toBe(true);
  });

  test("invalid identity inputs throw instead of fabricating observations", async () => {
    const page = createFakePage({
      url: "https://jobs.example.com/listing",
      scanPayload: standardListingPayload(),
    });

    await expect(
      captureCompactDiscoveryObservation({
        page,
        targetId: "",
        observationId: "obs_bad_identity",
        revision: 0,
        observedAt: "not-a-datetime",
      }),
    ).rejects.toThrow(/Invalid compact discovery observation identity/i);
  });

  test("aria-snapshot-less environments fall back to visible_text evidence", async () => {
    const observation = await captureFrom({
      url: "https://jobs.example.com/listing",
      bodyText: "plain text only environment",
      scanPayload: standardListingPayload(),
    });

    expect(observation.kind).toBe("supported");
    if (observation.kind !== "supported") {
      return;
    }
    expect(observation.sourceKind).toBe("visible_text");
    expect(observation.content.accessibilitySummary).toBeNull();
    expect(
      observation.uncertaintyNotes.some((note) =>
        note.toLowerCase().includes("accessibility snapshot"),
      ),
    ).toBe(true);
  });
});

describe("compact discovery observer pure helpers", () => {
  test("truncateBoundedText never trims visible content away silently", () => {
    expect(truncateBoundedText(null, 10)).toEqual({
      value: null,
      truncated: false,
    });
    expect(truncateBoundedText("   \n  ", 10)).toEqual({
      value: null,
      truncated: false,
    });
    expect(truncateBoundedText("short", 10)).toEqual({
      value: "short",
      truncated: false,
    });
    expect(truncateBoundedText("abcdefghij", 5)).toEqual({
      value: "abcde",
      truncated: true,
    });
    // Leading-whitespace walls report honestly rather than trimming to "".
    expect(truncateBoundedText("     x", 3)).toEqual({
      value: null,
      truncated: true,
    });
  });

  test("ref allocator disambiguates repeats deterministically", () => {
    const allocator = createDiscoveryRefIdAllocator();
    expect(allocator.next("pagination", "next_page:Next")).toBe(
      "pagination:next-page-next",
    );
    expect(allocator.next("pagination", "next_page:Next")).toBe(
      "pagination:next-page-next~2",
    );
    expect(allocator.next("action", "close_overlay:X")).toBe(
      "action:close-overlay-x",
    );
    // Empty stable parts still yield usable unique ids.
    const firstBlank = allocator.next("action", "");
    const secondBlank = allocator.next("action", "");
    expect(firstBlank).not.toBe(secondBlank);
  });

  test("pagination classification table covers all four kinds and noise", () => {
    expect(classifyPaginationControl("Next")?.kind).toBe("next_page");
    expect(classifyPaginationControl("older jobs")?.kind).toBe("next_page");
    expect(classifyPaginationControl("« Prev")?.kind).toBe("previous_page");
    expect(classifyPaginationControl("Previous page")?.kind).toBe(
      "previous_page",
    );
    expect(classifyPaginationControl("7")).toEqual({
      kind: "numbered_page",
      label: "7",
      pageNumber: 7,
    });
    expect(classifyPaginationControl("Page 12")?.pageNumber).toBe(12);
    expect(classifyPaginationControl("View more jobs")?.kind).toBe("load_more");
    expect(classifyPaginationControl("Apply now")).toBeNull();
    expect(classifyPaginationControl("   ")).toBeNull();
  });

  test("overlay-close classification matches generic dismiss labels only", () => {
    expect(classifyOverlayCloseControl("button", "Close")).toBe(true);
    expect(classifyOverlayCloseControl("button", "Got it")).toBe(true);
    expect(classifyOverlayCloseControl("button", "×")).toBe(true);
    // Job-dismiss buttons are card actions, not overlay closers.
    expect(classifyOverlayCloseControl("button", "Dismiss job")).toBe(false);
    expect(classifyOverlayCloseControl("link", "Skip")).toBe(true);
    expect(classifyOverlayCloseControl("", "Close")).toBe(false);
  });

  test("inline metadata expansion splits separators but keeps plain lines", () => {
    expect(
      expandInlineMetadataSegments("Acme · Berlin, DE · Full-time"),
    ).toEqual(["Acme", "Berlin, DE", "Full-time"]);
    expect(expandInlineMetadataSegments("Senior Engineer")).toEqual([
      "Senior Engineer",
    ]);
    expect(expandInlineMetadataSegments("  ")).toEqual([]);
  });

  test("prefers observed company label over slug inference", () => {
    const candidate = buildDomCardPostingCandidate({
      container: null,
      element: {
        href: "https://wellfound.com/jobs/4505800-data-engineer",
        accessibleName: "Data Engineer",
        jobIdHint: null,
        companyHref: "https://wellfound.com/company/coalitioninc",
        companyLabel: "Coalition, inc.",
      },
      pageUrl: ROLE_PAGE_URL,
    });

    expect(candidate?.company).toBe("Coalition, inc.");
  });

  test.each([
    ["Remote Developer Jobs", "/remote-dev-jobs"],
    ["Build your resume", "/resume"],
    ["Post a job →", "/hire"],
    ["Health insurance", "/insurance"],
  ])("does not turn the navigation link %s into a job", (title, href) => {
    expect(
      buildDomCardPostingCandidate({
        container: makeContainer("nav", [title], { headingText: null }),
        element: {
          href,
          accessibleName: title,
          jobIdHint: null,
          companyHref: null,
          companyLabel: null,
        },
        pageUrl: "https://careers.example.test/",
      }),
    ).toBeNull();
  });

  test("keeps a sparse vacancy with a job-detail route", () => {
    expect(
      buildDomCardPostingCandidate({
        container: null,
        element: {
          href: "/careers/ui-engineer",
          accessibleName: "UI Engineer",
          jobIdHint: null,
          companyHref: null,
          companyLabel: null,
        },
        pageUrl: "https://careers.example.test/",
      })?.title,
    ).toBe("UI Engineer");
  });

  test("derives Wellfound numeric job ids from /jobs/{id}-slug URLs", () => {
    expect(
      deriveSourceJobIdFromUrl(
        "https://wellfound.com/jobs/4505800-data-engineer",
      ),
    ).toBe("4505800");
  });

  test("infers employer from company profile href when job URL lacks /company/", () => {
    const candidate = buildDomCardPostingCandidate({
      container: makeContainer(
        "c1",
        ["AI Product Engineer", "Remote · Full-time", "Build AI workflows."],
        {
          headingText: "AI Product Engineer",
          companyHref: "https://wellfound.com/company/signal-systems",
        },
      ),
      element: {
        href: "https://wellfound.com/jobs/4634158-ai-product-engineer",
        accessibleName: "AI Product Engineer",
        jobIdHint: null,
        companyHref: null,
        companyLabel: null,
      },
      pageUrl: "https://wellfound.com/role/r/software-engineer",
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        title: "AI Product Engineer",
        company: "Signal Systems",
        canonicalUrl: "https://wellfound.com/jobs/4634158-ai-product-engineer",
      }),
    );
  });

  test("uses company profile href recovered from a single-job parent wrapper", () => {
    // Mirrors Wellfound cards where the `/company/{slug}` logo/link sits on a
    // parent wrapper while the nested listitem only has the `/jobs/{id}-…` link.
    // The in-page scanner now walks ancestors when the listitem itself has no
    // company href; this asserts the downstream employer inference still wins.
    const candidate = buildDomCardPostingCandidate({
      container: makeContainer(
        "c1",
        ["AI Product Engineer", "Remote · Full-time"],
        {
          headingText: "AI Product Engineer",
          companyHref: "https://wellfound.com/company/lamatic",
        },
      ),
      element: {
        href: "https://wellfound.com/jobs/3994821-2-data-engineer-staff-principal-lead",
        accessibleName: "AI Product Engineer",
        jobIdHint: null,
        companyHref: null,
        companyLabel: null,
      },
      pageUrl: "https://wellfound.com/jobs",
    });

    expect(candidate?.company).toBe("Lamatic");
    expect(candidate?.canonicalUrl).toContain("/jobs/3994821");
  });

  test("infers employer from multi-job company-card href (role-page grouping)", () => {
    // Live Wellfound role pages nest several `/jobs/{id}` titles under one
    // company card with a single `/company/{slug}` link (1 company, N jobs).
    // Ancestor recovery must accept that shape — not only single-job wrappers.
    const candidate = buildDomCardPostingCandidate({
      container: makeContainer(
        "c1",
        ["Data Engineer", "San Francisco · Full-time"],
        {
          headingText: "Data Engineer",
          companyHref: "https://wellfound.com/company/sigma-computing-2",
        },
      ),
      element: {
        href: "https://wellfound.com/jobs/4505800-data-engineer",
        accessibleName: "Data Engineer",
        jobIdHint: null,
        companyHref: null,
        companyLabel: null,
      },
      pageUrl: "https://wellfound.com/role/l/data-engineer/san-francisco",
    });

    expect(candidate?.company).toBe("Sigma Computing");
    expect(candidate?.canonicalUrl).toContain("/jobs/4505800");
  });

  test("infers employer from element companyHref when semantic container is absent", () => {
    // Wellfound role cards are plain divs (no listitem/article), so the scan
    // yields standalone job links with containerKey=null. Employer recovery
    // must still win via element.companyHref from the unique company ancestor.
    const candidate = buildDomCardPostingCandidate({
      container: null,
      element: {
        href: "https://wellfound.com/jobs/4505800-data-engineer",
        accessibleName: "Data Engineer",
        jobIdHint: null,
        companyHref: "https://wellfound.com/company/sigma-computing-2",
        companyLabel: "Sigma Computing",
      },
      pageUrl: "https://wellfound.com/role/l/data-engineer/san-francisco",
    });

    expect(candidate?.company).toBe("Sigma Computing");
    expect(candidate?.title).toBe("Data Engineer");
  });

  test("prefers visible company link text over slug title-case when both exist", () => {
    const candidate = buildDomCardPostingCandidate({
      container: null,
      element: {
        href: "https://wellfound.com/jobs/3727184-data-engineer",
        accessibleName: "Data Engineer",
        jobIdHint: null,
        companyHref: "https://wellfound.com/company/green-usd",
        companyLabel: "Green",
      },
      pageUrl: ROLE_PAGE_URL,
    });

    expect(candidate?.company).toBe("Green");
    expect(candidate?.company).not.toBe("Green Usd");
  });

  test("rejects URL-like and low-quality slug-only employer labels", () => {
    expect(
      buildDomCardPostingCandidate({
        container: null,
        element: {
          href: "https://wellfound.com/jobs/1-data-engineer",
          accessibleName: "Data Engineer",
          jobIdHint: null,
          companyHref: "https://wellfound.com/company/strongholdpay",
          companyLabel: null,
        },
        pageUrl: ROLE_PAGE_URL,
      })?.company,
    ).toBeNull();

    expect(
      buildDomCardPostingCandidate({
        container: null,
        element: {
          href: "https://wellfound.com/jobs/2-ai-engineer",
          accessibleName: "AI Engineer",
          jobIdHint: null,
          companyHref: null,
          companyLabel: "Https Therichmondmarketing Com",
        },
        pageUrl: ROLE_PAGE_URL,
      })?.company,
    ).toBeNull();

    expect(
      buildDomCardPostingCandidate({
        container: null,
        element: {
          href: "https://wellfound.com/jobs/3-ml-researcher",
          accessibleName: "ML Researcher",
          jobIdHint: null,
          companyHref: "https://wellfound.com/company/scale-ai/jobs/1-role",
          companyLabel: null,
        },
        pageUrl: ROLE_PAGE_URL,
      })?.company,
    ).toBe("Scale AI");
  });

  test("does not invent employer from /jobs/{id}-… URLs without company evidence", () => {
    const candidate = buildDomCardPostingCandidate({
      container: makeContainer(
        "c1",
        ["AI Product Engineer", "Remote · Full-time", "Build AI workflows."],
        { headingText: "AI Product Engineer" },
      ),
      element: {
        href: "https://wellfound.com/jobs/4634158-ai-product-engineer",
        accessibleName: "AI Product Engineer",
        jobIdHint: null,
        companyHref: null,
        companyLabel: null,
      },
      pageUrl: "https://wellfound.com/role/r/software-engineer",
    });

    expect(candidate?.company).not.toMatch(/4634158|Ai Product Engineer/i);
    expect(candidate?.company).not.toBe("Signal Systems");
  });

  test("source job id derivation reads id-shaped segments and params only", () => {
    expect(deriveSourceJobIdFromUrl("https://x.io/jobs/view/12345678")).toBe(
      "12345678",
    );
    expect(deriveSourceJobIdFromUrl("https://x.io/jobs?gh_jid=998877")).toBe(
      "998877",
    );
    expect(deriveSourceJobIdFromUrl("https://x.io/careers/about")).toBeNull();
    expect(deriveSourceJobIdFromUrl("not a url")).toBeNull();
  });

  test("classifies a full-page paid-plan overlay from page shape", () => {
    const element = (accessibleName: string) => ({
      role: "button",
      accessibleName,
      href: null,
      containerKey: null,
      jobIdHint: null,
      companyHref: null,
      companyLabel: null,
    });

    // The exact interstitial a tester watched a run browse for 15 minutes.
    const blocked = classifyBlockingOverlaySignal({
      pageTitle: "Remote jobs",
      bodyText:
        "Unlock your remote career potential with Remote OK Premium. Get unlimited access to every listing.",
      elements: [element("Subscribe"), element("No thanks")],
      hasPostingInventory: false,
    });
    expect(blocked?.reason).toBe("paid_plan_required");

    // Listings readable behind the message are not a wall.
    expect(
      classifyBlockingOverlaySignal({
        pageTitle: "Remote jobs",
        bodyText: "Upgrade your plan for more filters.",
        elements: [element("Subscribe")],
        hasPostingInventory: true,
      }),
    ).toBe(null);

    // Marketing wording with no overlay control is just page copy.
    expect(
      classifyBlockingOverlaySignal({
        pageTitle: "Remote jobs",
        bodyText: "Premium employers post here.",
        elements: [element("Senior Backend Engineer")],
        hasPostingInventory: false,
      }),
    ).toBe(null);
  });

  test("blocker classification is ordered and single-reason", () => {
    expect(
      classifyUnsupportedSignal(
        "Access denied",
        "Please sign in to continue reading articles about careers.",
      )?.reason,
    ).toBe("site_protection");
    expect(
      classifyUnsupportedSignal(null, "Press and hold to continue")?.reason,
    ).toBe("manual_step_required");
    expect(
      classifyUnsupportedSignal(null, "Please log in to view saved roles")
        ?.reason,
    ).toBe("auth_required");
    expect(classifyUnsupportedSignal("Jobs", "Frontend Engineer, Remote")).toBe(
      null,
    );
  });
});
