import type { JobPosting, SourceDebugWorkerAttempt } from "@nordri/contracts";
import { normalizeText, uniqueStrings } from "./shared";
import {
  filterSourceInstructionLines,
  lineMentionsAnyKeyword,
} from "./source-instruction-filtering";

export function summarizeCanonicalUrlBehavior(
  jobs: readonly JobPosting[],
  hostname: string,
): string[] {
  if (jobs.length === 0) {
    return [];
  }

  const urls = jobs
    .map((job) => {
      try {
        return new URL(job.canonicalUrl);
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => url !== null);

  if (urls.length === 0) {
    return [];
  }

  const sameHostUrls = urls.filter((url) => url.hostname === hostname);
  const uniquePaths = uniqueStrings(
    sameHostUrls.map((url) => url.pathname).filter(Boolean),
  );
  const slugLikePaths = uniquePaths.filter(
    (path) => path.split("/").filter(Boolean).length >= 2,
  );

  return uniqueStrings(
    [
      sameHostUrls.length > 0
        ? "Use same-host detail pages as the canonical source of job data."
        : null,
      uniquePaths.length >= 2
        ? "Expect different listings to resolve to distinct canonical detail URLs."
        : null,
      slugLikePaths.length > 0
        ? "Treat stable slug-style paths on the same host as the canonical detail route."
        : null,
    ].filter((value): value is string => Boolean(value)),
  );
}

export function summarizeApplyPathBehavior(jobs: readonly JobPosting[]): string[] {
  if (jobs.length === 0) {
    return [];
  }

  const easyApplyCount = jobs.filter(
    (job) => job.applyPath === "easy_apply" || job.easyApplyEligible,
  ).length;
  const externalApplyCount = jobs.filter(
    (job) => job.applyPath === "external_redirect",
  ).length;
  const unknownApplyCount = jobs.filter(
    (job) => job.applyPath === "unknown" && !job.easyApplyEligible,
  ).length;

  return uniqueStrings(
    [
      easyApplyCount > 0
        ? "Use the on-site apply entry when the detail page exposes it."
        : null,
      externalApplyCount > 0
        ? "Expect some listings to hand off apply to an external destination."
        : null,
      unknownApplyCount === jobs.length
        ? "Treat applications as manual for now; sampled job details did not expose a reliable on-site apply entry."
        : null,
    ].filter((value): value is string => Boolean(value)),
  );
}

export function warningSuggestsAuthRestriction(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeText(value ?? "");

  return (
    normalized.includes("login required") ||
    normalized.includes("logged in") ||
    normalized.includes("authentication required") ||
    normalized.includes("session is not ready") ||
    normalized.includes("sign in") ||
    normalized.includes("auth restriction") ||
    normalized.includes("not authenticated")
  );
}

export function collectAttemptInstructionGuidance(
  attempt: SourceDebugWorkerAttempt | undefined,
): string[] {
  const derivedEvidenceGuidance = deriveGuidanceFromPhaseEvidence(attempt);

  return filterSourceInstructionLines([
    attempt?.resultSummary ?? "",
    ...(attempt?.confirmedFacts ?? []),
    ...derivedEvidenceGuidance,
  ]);
}

export function extractControlName(control: string): string | null {
  const match = control.match(/^[a-z]+\s+"([^"]+)"/i);
  return match?.[1]?.trim() ?? null;
}

export function summarizeNamedVisibleControls(
  controls: readonly string[],
  keywords: readonly string[],
): string[] {
  return uniqueStrings(
    controls
      .map(extractControlName)
      .filter((value): value is string => Boolean(value))
      .filter((value) => value.length <= 32)
      .filter((value) => lineMentionsAnyKeyword(value, keywords)),
  );
}

export function deriveGuidanceFromPhaseEvidence(
  attempt: SourceDebugWorkerAttempt | undefined,
): string[] {
  if (!attempt?.phaseEvidence) {
    return [];
  }

  const controls = attempt.phaseEvidence.visibleControls ?? [];
  const routeSignals = attempt.phaseEvidence.routeSignals ?? [];
  const successfulInteractions =
    attempt.phaseEvidence.successfulInteractions ?? [];
  const attemptedControls = attempt.phaseEvidence.attemptedControls ?? [];
  const visualFindingSummaries = (attempt.phaseEvidence.visualFindings ?? []).flatMap(
    (finding) => [finding.summary],
  );
  const visualEvidenceSummaries = Array.isArray(attempt.visualEvidence)
    ? attempt.visualEvidence.map((evidence) => evidence.summary)
    : [];
  const warnings = [
    ...(attempt.phaseEvidence.warnings ?? []),
    ...visualFindingSummaries,
    ...visualEvidenceSummaries,
  ];
  const locationControls = summarizeNamedVisibleControls(controls, [
    "location",
    "city",
    "region",
    "country",
    "where",
    "place",
    "qyteti",
    "prishtin",
    "kosov",
    "vendit",
    "ort",
    "lieu",
    "ubicaci",
    "cidade",
    "lokacija",
  ]);
  const industryControls = summarizeNamedVisibleControls(controls, [
    "industry",
    "industria",
    "category",
    "department",
    "sector",
    "field",
    "branche",
    "secteur",
    "kategorija",
  ]);
  const hasShowAllControl = controls.some((control) =>
    /\bshow all\b/i.test(control),
  );
  const hasSearchBox = controls.some((control) =>
    /\b(searchbox|textbox)\b/i.test(control),
  );
  const hasLocationCombobox = controls.some(
    (control) =>
      /\bcombobox\b/i.test(control) &&
      /\b(location|city|region|country|where|qyteti|ort|lieu|ubicaci|lokacija)\b/i.test(
        control,
      ),
  );
  const hasIndustryCombobox = controls.some(
    (control) =>
      /\bcombobox\b/i.test(control) &&
      /\b(industry|industria|category|department|sector|field|branche|secteur|kategorija)\b/i.test(
        control,
      ),
  );
  const routeOpensCollection = routeSignals.some((signal) =>
    /\/collections\//i.test(signal),
  );
  const routeOpensSearch = routeSignals.some((signal) =>
    /\/jobs\/search\//i.test(signal),
  );
  const hit404LikeRoute = warnings.some((warning) =>
    /not-found route|404|broken route/i.test(warning),
  );
  const interactedWithShowAll = successfulInteractions.some((value) =>
    /\bshow all\b/i.test(value),
  );
  const attemptedSearchControl = attemptedControls.some((value) =>
    /\b(searchbox|textbox)\b/i.test(value),
  );
  const attemptedLocationControl = attemptedControls.some((value) =>
    /\b(location|city|region|country|where|qyteti|ort|lieu|ubicaci|lokacija)\b/i.test(
      value,
    ),
  );
  const attemptedIndustryControl = attemptedControls.some((value) =>
    /\b(industry|industria|category|department|sector|field|branche|secteur|kategorija)\b/i.test(
      value,
    ),
  );
  const hasTimeoutLikeWarning = warnings.some((warning) =>
    /timeout|timed out/i.test(warning),
  );
  const hasVisibilityLikeWarning = warnings.some((warning) =>
    /not visible|scroll/i.test(warning),
  );
  const scrollingHelped = successfulInteractions.some((value) =>
    /\bscrolled down\b/i.test(value),
  );
  const hasVisibleSearchCoverageGap =
    hasSearchBox &&
    attemptedSearchControl &&
    (hasTimeoutLikeWarning || hasVisibilityLikeWarning);
  const hasVisibleLocationCoverageGap =
    (hasLocationCombobox || locationControls.length > 0) &&
    attemptedLocationControl &&
    (hasTimeoutLikeWarning || hasVisibilityLikeWarning);
  const hasVisibleIndustryCoverageGap =
    (hasIndustryCombobox || industryControls.length > 0) &&
    attemptedIndustryControl &&
    (hasTimeoutLikeWarning || hasVisibilityLikeWarning);

  return uniqueStrings(
    [
      hasShowAllControl
        ? "Visible Show all links can open fuller job lists or recommendation collections."
        : null,
      interactedWithShowAll
        ? "Use reusable Show all or collection links from the landing page before assuming the jobs hub is thin."
        : null,
      routeOpensCollection
        ? "Recommendation or show-all routes can open reusable collection pages."
        : null,
      routeOpensSearch
        ? "The fuller results surface lives under the main jobs search route."
        : null,
      hasSearchBox
        ? "A visible keyword search box is present on the landing or results surface."
        : null,
      hasLocationCombobox
        ? "A visible location filter is present on the landing or results surface."
        : null,
      hasIndustryCombobox
        ? "A visible industry or category filter is present on the landing or results surface."
        : null,
      locationControls.length > 0
        ? `Visible location controls include ${locationControls.join(", ")}.`
        : null,
      industryControls.length > 0
        ? `Visible industry or category controls include ${industryControls.join(", ")}.`
        : null,
      hasVisibleSearchCoverageGap
        ? "A visible keyword search box exists, but this run did not prove it changes the result set reliably."
        : null,
      hasVisibleLocationCoverageGap
        ? "Visible location filters exist, but this run did not prove they change the result set reliably."
        : null,
      hasVisibleIndustryCoverageGap
        ? "Visible industry or category filters exist, but this run did not prove they change the result set reliably."
        : null,
      scrollingHelped || hasVisibilityLikeWarning
        ? "Some job links or filters may need scrolling into view before interaction."
        : null,
      scrollingHelped
        ? "Scrolling can reveal additional jobs on the current list surface before a separate route is needed."
        : null,
      hit404LikeRoute
        ? "Direct path guesses can land on a not-found route; return to the last known jobs surface instead of relying on the broken path."
        : null,
    ].filter((value): value is string => Boolean(value)),
  );
}

export function lineContradictsVisiblePhaseEvidence(
  value: string,
  attempts: readonly SourceDebugWorkerAttempt[],
): boolean {
  const normalized = normalizeText(value);
  const visibleControls = attempts.flatMap(
    (attempt) => attempt.phaseEvidence?.visibleControls ?? [],
  );
  const hasVisibleSearchBox = visibleControls.some((control) =>
    /\b(searchbox|textbox)\b/i.test(control),
  );
  const hasVisibleLocationControl = visibleControls.some((control) =>
    /\b(location|qyteti)\b/i.test(control),
  );
  const hasVisibleIndustryControl = visibleControls.some((control) =>
    /\b(industry|industria|category|department)\b/i.test(control),
  );

  if (
    hasVisibleSearchBox &&
    (normalized.includes("search box interaction failed") ||
      normalized.includes("search textbox interaction failed") ||
      normalized.includes("search textbox was not found") ||
      normalized.includes("search textbox not found") ||
      normalized.includes("no search textbox confirmed accessible") ||
      normalized.includes("no search textbox or dropdown filters confirmed") ||
      normalized.includes("search box exists in header but timed out"))
  ) {
    return true;
  }

  if (
    hasVisibleLocationControl &&
    (normalized.includes("no visible dropdown filters for city") ||
      normalized.includes("no visible dropdown filters for location") ||
      normalized.includes(
        "no visible dropdown filters for city industry or category",
      ) ||
      normalized.includes("no visible dropdown filters"))
  ) {
    return true;
  }

  if (
    hasVisibleIndustryControl &&
    (normalized.includes("no visible dropdown filters for industry") ||
      normalized.includes(
        "no visible dropdown filters for city industry or category",
      ) ||
      normalized.includes("no visible dropdown filters"))
  ) {
    return true;
  }

  return false;
}

export function reconcileVisibleControlEvidence(input: {
  attempts: readonly SourceDebugWorkerAttempt[];
  navigationGuidance: readonly string[];
  searchGuidance: readonly string[];
  detailGuidance: readonly string[];
  applyGuidance: readonly string[];
}): {
  navigationGuidance: string[];
  searchGuidance: string[];
  detailGuidance: string[];
  applyGuidance: string[];
} {
  const filterLines = (lines: readonly string[]) =>
    lines.filter(
      (line) => !lineContradictsVisiblePhaseEvidence(line, input.attempts),
    );

  return {
    navigationGuidance: filterLines(input.navigationGuidance),
    searchGuidance: filterLines(input.searchGuidance),
    detailGuidance: filterLines(input.detailGuidance),
    applyGuidance: filterLines(input.applyGuidance),
  };
}

export function isAuthBarrierOnlySourceInstruction(value: string): boolean {
  const normalized = normalizeText(value);

  return (
    normalized.includes("login form") ||
    normalized.includes("sign in form") ||
    normalized.includes("sign in dialog") ||
    normalized.includes("sign in wall") ||
    normalized.includes("only visible surface") ||
    normalized.includes("no public access") ||
    normalized.includes("no guest access") ||
    normalized.includes("guest view") ||
    normalized.includes("hidden behind a sign in") ||
    normalized.includes("gated behind authentication") ||
    normalized.includes("requires authentication") ||
    normalized.includes("authentication required") ||
    normalized.includes("without target site account") ||
    normalized.includes("without being logged in")
  );
}

export function lineShowsExposedJobsSurface(value: string): boolean {
  const normalized = normalizeText(value);

  return (
    normalized.includes("job listings") ||
    normalized.includes("job cards") ||
    normalized.includes("search box") ||
    normalized.includes("filter") ||
    normalized.includes("recommendation") ||
    normalized.includes("show all") ||
    normalized.includes("collection") ||
    normalized.includes("easy apply") ||
    normalized.includes("homepage") ||
    normalized.includes("same host detail") ||
    normalized.includes("same-host detail") ||
    normalized.includes("canonical detail") ||
    normalized.includes("jobs view") ||
    normalized.includes("jobs search") ||
    normalized.includes("jobs are listed directly") ||
    normalized.includes("jobs appear directly")
  );
}

export function reconcileMixedAccessGuidance(input: {
  navigationGuidance: readonly string[];
  searchGuidance: readonly string[];
  detailGuidance: readonly string[];
  applyGuidance: readonly string[];
}): {
  navigationGuidance: string[];
  searchGuidance: string[];
  detailGuidance: string[];
  applyGuidance: string[];
  warnings: string[];
} {
  const allLines = [
    ...input.navigationGuidance,
    ...input.searchGuidance,
    ...input.detailGuidance,
    ...input.applyGuidance,
  ];
  const hasExposedJobsSurface = allLines.some(lineShowsExposedJobsSurface);
  const hasAuthBarrierOnlyGuidance = allLines.some(
    isAuthBarrierOnlySourceInstruction,
  );

  if (!hasExposedJobsSurface || !hasAuthBarrierOnlyGuidance) {
    return {
      navigationGuidance: [...input.navigationGuidance],
      searchGuidance: [...input.searchGuidance],
      detailGuidance: [...input.detailGuidance],
      applyGuidance: [...input.applyGuidance],
      warnings: [],
    };
  }

  const filterMixedLines = (lines: readonly string[]) =>
    lines.filter((line) => !isAuthBarrierOnlySourceInstruction(line));

  return {
    navigationGuidance: filterMixedLines(input.navigationGuidance),
    searchGuidance: filterMixedLines(input.searchGuidance),
    detailGuidance: filterMixedLines(input.detailGuidance),
    applyGuidance: filterMixedLines(input.applyGuidance),
    warnings: [
      "This run crossed both guest/login and job-bearing surfaces; learned guidance was curated toward the surfaces that actually exposed jobs.",
    ],
  };
}

export const sourceDebugEntryPathKeywords = [
  "homepage",
  "jobs page",
  "jobs route",
  "job route",
  "listing route",
  "listings route",
  "result route",
  "results route",
  "entry path",
  "entrypoint",
  "show all",
  "showall",
  "recommended",
  "recommendation",
  "collection",
  "prefilter",
  "preselected",
] as const;

const sourceDebugSearchControlKeywords = [
  "search",
  "filter",
  "keyword",
  "location",
  "industry",
  "department",
  "category",
  "chip",
  "dropdown",
  "input",
  "sort",
  "pagination",
  "all filters",
  "date posted",
  "experience",
  "company",
  "remote",
  "load more",
  "next page",
  "infinite scroll",
  "lazy load",
  "show all",
  "showall",
  "recommended",
  "recommendation",
  "prefilter",
  "preselected",
] as const;

export function isExplicitSearchProbeDisproof(value: string): boolean {
  const normalized = normalizeText(value);
  const hasNegativeSearchVerdict =
    /(^|\s)no\s+[^.]*\b(proven|confirmed|working|reliable)\b/.test(
      normalized,
    ) ||
    normalized.includes("no search filter control was proven") ||
    normalized.includes("no working search filter controls confirmed") ||
    normalized.includes("no filters confirmed to change result set");

  return (
    (hasNegativeSearchVerdict ||
      normalized.includes("no reliable") ||
      normalized.includes("could not confirm") ||
      normalized.includes("could not prove") ||
      normalized.includes("did not confirm") ||
      normalized.includes("did not prove") ||
      normalized.includes("not proven") ||
      normalized.includes("unproven") ||
      normalized.includes("not confirmed") ||
      normalized.includes("not clearly visible") ||
      normalized.includes("not clearly proven") ||
      normalized.includes("not conclusively proven") ||
      normalized.includes("not identified") ||
      normalized.includes("not tested") ||
      normalized.includes("did not reliably change") ||
      normalized.includes("did not change") ||
      normalized.includes("not reliable") ||
      normalized.includes("decorative")) &&
    lineMentionsAnyKeyword(normalized, sourceDebugSearchControlKeywords)
  );
}

export function isVisibilityOnlySearchSignal(value: string): boolean {
  const normalized = normalizeText(value);

  return (
    normalized.startsWith("a visible keyword search box is present") ||
    normalized.startsWith("a visible location filter is present") ||
    normalized.startsWith("a visible industry or category filter is present") ||
    normalized.startsWith("visible location controls include") ||
    normalized.startsWith("visible industry or category controls include") ||
    normalized.startsWith(
      "some job links or filters may need scrolling into view",
    ) ||
    normalized.startsWith(
      "scrolling can reveal additional jobs on the current list surface",
    )
  );
}

export function isPositiveReusableSearchSignal(value: string): boolean {
  const normalized = normalizeText(value);
  const hasPositiveProofPhrase =
    normalized.startsWith("use ") ||
    normalized.startsWith("start at ") ||
    normalized.startsWith("start from ") ||
    normalized.startsWith("click ") ||
    normalized.startsWith("open ") ||
    normalized.includes("reliably returns") ||
    normalized.includes("returns job cards") ||
    normalized.includes("returns job card") ||
    normalized.includes("returns results") ||
    normalized.includes("returns filter controls") ||
    normalized.includes("with filter controls") ||
    normalized.includes("primary result changing control") ||
    normalized.includes("primary result-changing control") ||
    normalized.includes("primary way to access") ||
    normalized.includes("proven control") ||
    normalized.includes("changes the result set") ||
    normalized.includes("change the result set") ||
    normalized.includes("different job set") ||
    normalized.includes("different job collection") ||
    normalized.includes("different job collections") ||
    normalized.includes("opens reusable") ||
    normalized.includes("open reusable") ||
    normalized.includes("opens a reusable") ||
    normalized.includes("can open reusable") ||
    normalized.includes("works with authentication") ||
    normalized.includes("works reliably") ||
    normalized.includes("remained stable") ||
    normalized.includes("refresh the visible job set") ||
    normalized.includes("narrow the listings") ||
    normalized.includes("access the fuller") ||
    normalized.includes("access recommended jobs collection");

  return (
    lineMentionsAnyKeyword(normalized, sourceDebugSearchControlKeywords) &&
    hasPositiveProofPhrase &&
    !isVisibilityOnlySearchSignal(value) &&
    !isExplicitSearchProbeDisproof(value) &&
    !isUrlShortcutSourceInstruction(value)
  );
}

export function isUrlShortcutSourceInstruction(value: string): boolean {
  const normalized = normalizeText(value);

  return (
    normalized.includes("geoid") ||
    normalized.includes("currentjobid") ||
    normalized.includes("query parameter") ||
    normalized.includes("query url") ||
    normalized.includes("jobs landing url") ||
    normalized.includes("jobs url pattern") ||
    normalized.includes("direct url")
  );
}
