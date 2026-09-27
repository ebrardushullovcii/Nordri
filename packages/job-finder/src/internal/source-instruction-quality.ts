import { normalizeText, uniqueStrings } from "./shared";
import type { SourceInstructionQualityAssessment } from "./source-instruction-types";
import { lineMentionsAnyKeyword } from "./source-instruction-filtering";
import {
  isExplicitSearchProbeDisproof,
  isPositiveReusableSearchSignal,
  isUrlShortcutSourceInstruction,
  sourceDebugEntryPathKeywords,
  isVisibilityOnlySearchSignal,
} from "./source-instruction-evidence";

export function evaluateSourceInstructionQuality(input: {
  navigationGuidance: readonly string[];
  searchGuidance: readonly string[];
  detailGuidance: readonly string[];
  applyGuidance: readonly string[];
}): SourceInstructionQualityAssessment {
  const accessOnlyKeywords = [
    "without login",
    "without auth",
    "authentication required",
    "consent",
    "networkidle",
    "reachable",
    "accessible",
  ];
  const entryPathSignals = uniqueStrings(
    [...input.navigationGuidance, ...input.searchGuidance].filter((line) => {
      const normalized = normalizeText(line);
      const matchesEntryPath = lineMentionsAnyKeyword(
        normalized,
        sourceDebugEntryPathKeywords,
      );
      const isAccessOnly = accessOnlyKeywords.some((keyword) =>
        normalized.includes(keyword),
      );
      return (
        matchesEntryPath &&
        !isAccessOnly &&
        !isUrlShortcutSourceInstruction(line)
      );
    }),
  );
  const searchControlSignals = uniqueStrings(
    input.searchGuidance.filter((line) => {
      return isPositiveReusableSearchSignal(line);
    }),
  );
  const searchProbeDisproofSignals = uniqueStrings(
    input.searchGuidance.filter(isExplicitSearchProbeDisproof),
  );
  const searchVisibilityOnlySignals = uniqueStrings(
    input.searchGuidance.filter(isVisibilityOnlySearchSignal),
  );
  const isConclusiveDisproof =
    searchProbeDisproofSignals.length > 0 &&
    searchVisibilityOnlySignals.length === 0;
  const searchProbeCoverageSignals = uniqueStrings([
    ...searchControlSignals,
    ...(isConclusiveDisproof ? searchProbeDisproofSignals : []),
  ]);
  const highSignalNavigationOrSearch = uniqueStrings([
    ...entryPathSignals,
    ...searchProbeCoverageSignals,
  ]);
  const highSignalDetailOrApply = uniqueStrings([
    ...input.detailGuidance,
    ...input.applyGuidance,
  ]);
  const totalReusableSignals = uniqueStrings([
    ...highSignalNavigationOrSearch,
    ...highSignalDetailOrApply,
  ]);
  const qualityWarnings: string[] = [];

  if (entryPathSignals.length === 0) {
    qualityWarnings.push(
      "The check did not find a repeatable way to the job list yet. Check the source again, or open it in the Job Finder browser and see where the jobs are.",
    );
  }

  if (searchProbeCoverageSignals.length === 0) {
    qualityWarnings.push(
      "The check has not yet shown a search, filter, or paging control that changes the results, or said clearly that there is none. Check the source again to complete it.",
    );
  }

  if (
    searchControlSignals.length === 0 &&
    searchProbeDisproofSignals.length > 0 &&
    isConclusiveDisproof
  ) {
    qualityWarnings.push(
      "No search or filter control changed the results on this site; the check said so explicitly. A future check will still look for new controls.",
    );
  }

  if (highSignalDetailOrApply.length === 0) {
    qualityWarnings.push(
      "The check has not yet shown how job pages are laid out or how applying starts. Check the source again to complete it.",
    );
  }

  if (totalReusableSignals.length < 4) {
    qualityWarnings.push(
      "The guidance is still thin: a validated source needs at least four distinct findings across the way to the jobs, search or filters, job pages, and applying.",
    );
  }

  return {
    highSignalNavigationOrSearch,
    highSignalDetailOrApply,
    qualifiesForValidation:
      entryPathSignals.length > 0 &&
      searchProbeCoverageSignals.length > 0 &&
      highSignalDetailOrApply.length > 0 &&
      totalReusableSignals.length >= 4,
    qualityWarnings,
  };
}

export function reconcileApplyGuidance(lines: readonly string[]): string[] {
  const normalizedLines = uniqueStrings(lines);
  const hasProvenOnSiteApply = normalizedLines.some((line) => {
    const normalized = normalizeText(line);
    return (
      normalized.includes("easy apply") ||
      normalized.includes("on site apply entry") ||
      normalized.includes("on-site apply entry") ||
      normalized.includes("primary apply entry point") ||
      normalized.includes("use the on site apply entry") ||
      normalized.includes("use the on-site apply entry")
    );
  });

  if (!hasProvenOnSiteApply) {
    return normalizedLines;
  }

  return normalizedLines.filter((line) => {
    const normalized = normalizeText(line);
    return !(
      normalized.includes("treat applications as manual") ||
      normalized.includes(
        "manual until a reliable on site apply entry is proven",
      ) ||
      normalized.includes(
        "manual until a reliable on-site apply entry is proven",
      ) ||
      normalized.includes("did not expose a reliable on site apply entry") ||
      normalized.includes("did not expose a reliable on-site apply entry")
    );
  });
}

type SourceInstructionGuidanceSection =
  | "navigation"
  | "search"
  | "detail"
  | "apply";

interface SourceInstructionGuidanceLineItem {
  section: SourceInstructionGuidanceSection;
  line: string;
  sectionOrder: number;
  originalIndex: number;
}

export function lineMentionsKeywordSearch(value: string): boolean {
  return lineMentionsAnyKeyword(value, [
    "search box",
    "search textbox",
    "keyword search",
    "searchbox",
    "textbox",
  ]);
}

export function lineMentionsLocationFilter(value: string): boolean {
  return lineMentionsAnyKeyword(value, [
    "location filter",
    "update location",
    'combobox "location"',
    "visible location",
    "location controls",
  ]);
}

export function lineMentionsIndustryFilter(value: string): boolean {
  return lineMentionsAnyKeyword(value, [
    "industry filter",
    "category filter",
    "department filter",
    "visible industry",
    "industry or category",
  ]);
}

export function classifySourceInstructionGuidanceFamily(
  value: string,
  section: SourceInstructionGuidanceSection,
): string | null {
  const normalized = normalizeText(value);

  if (
    (section === "navigation" || section === "search") &&
    lineMentionsKeywordSearch(normalized)
  ) {
    return "keyword_search";
  }

  if (
    (section === "navigation" || section === "search") &&
    lineMentionsLocationFilter(normalized)
  ) {
    return "location_filter";
  }

  if (
    (section === "navigation" || section === "search") &&
    lineMentionsIndustryFilter(normalized)
  ) {
    return "industry_filter";
  }

  if (
    (section === "navigation" || section === "search") &&
    lineMentionsAnyKeyword(normalized, [
      "show all",
      "collection",
      "recommendation",
    ])
  ) {
    return "show_all_collection";
  }

  if (
    section === "detail" &&
    (lineMentionsAnyKeyword(normalized, [
      "detail page",
      "canonical detail",
      "same-host detail",
      "detail route",
      "url pattern",
      "job cards",
      "job extraction",
    ]) ||
      normalized.includes("/jobs/view/") ||
      normalized.includes("/fresha/"))
  ) {
    return "detail_route";
  }

  if (
    section === "apply" &&
    lineMentionsAnyKeyword(normalized, [
      "easy apply",
      "apply entry",
      "on-site apply",
      "on site apply",
      "apply button",
      "manual",
    ])
  ) {
    return "apply_entry";
  }

  return null;
}

export function isStrongPositiveSourceInstructionGuidance(
  value: string,
  section: SourceInstructionGuidanceSection,
): boolean {
  const normalized = normalizeText(value);
  const family = classifySourceInstructionGuidanceFamily(normalized, section);

  if (!family) {
    return false;
  }

  if (
    family === "keyword_search" ||
    family === "location_filter" ||
    family === "industry_filter"
  ) {
    return (
      isPositiveReusableSearchSignal(value) ||
      (!isExplicitSearchProbeDisproof(value) &&
        (normalized.includes("confirmed") ||
          normalized.includes("proven") ||
          normalized.includes("works reliably") ||
          normalized.includes("changes the result set") ||
          normalized.includes("change the result set") ||
          normalized.includes("refresh the visible job set") ||
          normalized.includes("narrow the listings")))
    );
  }

  if (family === "show_all_collection") {
    return (
      !normalized.includes("not proven") &&
      !normalized.includes("not confirmed") &&
      !normalized.includes("unclear") &&
      (normalized.includes("opens reusable") ||
        normalized.includes("open reusable") ||
        normalized.includes("best repeatable") ||
        normalized.includes("confirmed") ||
        normalized.includes("use reusable show all") ||
        normalized.includes("can open reusable"))
    );
  }

  if (family === "detail_route") {
    return (
      !normalized.includes("tool limitation") &&
      !normalized.includes("timed out") &&
      !normalized.includes("failed") &&
      (normalized.includes("canonical") ||
        normalized.includes("url pattern") ||
        normalized.includes("confirmed stable") ||
        normalized.includes("confirmed") ||
        normalized.includes("same-host detail"))
    );
  }

  if (family === "apply_entry") {
    return (
      !normalized.includes("treat applications as manual") &&
      !normalized.includes("not confirmed") &&
      !normalized.includes("not visible") &&
      !normalized.includes("timeout") &&
      (normalized.includes("easy apply") ||
        normalized.includes("on-site apply") ||
        normalized.includes("on site apply") ||
        normalized.includes("primary apply entry"))
    );
  }

  return false;
}

export function isSupersededByStrongerSourceInstructionGuidance(
  value: string,
  family: string,
): boolean {
  const normalized = normalizeText(value);

  switch (family) {
    case "keyword_search":
      return (
        isVisibilityOnlySearchSignal(value) ||
        isExplicitSearchProbeDisproof(value) ||
        (lineMentionsKeywordSearch(normalized) &&
          (normalized.includes("timed out") ||
            normalized.includes("non-functional") ||
            normalized.includes("unreliable") ||
            normalized.includes("requires specific interaction") ||
            normalized.includes("flaky")))
      );
    case "location_filter":
      return (
        (lineMentionsLocationFilter(normalized) &&
          isExplicitSearchProbeDisproof(value)) ||
        normalized.includes(
          "visible location filters exist, but this run did not prove they change the result set reliably",
        )
      );
    case "industry_filter":
      return (
        (lineMentionsIndustryFilter(normalized) &&
          isExplicitSearchProbeDisproof(value)) ||
        normalized.includes(
          "visible industry or category filters exist, but this run did not prove they change the result set reliably",
        )
      );
    case "show_all_collection":
      return (
        normalized.includes("not proven") ||
        normalized.includes("not confirmed") ||
        normalized.includes("unclear") ||
        normalized.includes("thin")
      );
    case "detail_route":
      return (
        normalized.includes("tool limitation") ||
        normalized.includes("returned 0") ||
        normalized.includes("timed out") ||
        normalized.includes("failed due to visibility") ||
        normalized.includes("not visible off-screen")
      );
    case "apply_entry":
      return (
        normalized.includes("treat applications as manual") ||
        normalized.includes("not confirmed") ||
        normalized.includes("timeout") ||
        normalized.includes("requires login") ||
        normalized.includes("blocked")
      );
    default:
      return false;
  }
}

export function getSourceInstructionGuidanceScore(
  value: string,
  section: SourceInstructionGuidanceSection,
): number {
  const normalized = normalizeText(value);
  let score = value.length;

  if (isStrongPositiveSourceInstructionGuidance(value, section)) {
    score += 40;
  }

  if (
    normalized.includes("best repeatable") ||
    normalized.includes("primary")
  ) {
    score += 8;
  }

  if (normalized.includes("confirmed") || normalized.includes("proven")) {
    score += 6;
  }

  if (normalized.includes("canonical") || normalized.includes("url pattern")) {
    score += 6;
  }

  if (normalized.includes("stable") || normalized.includes("reliable")) {
    score += 4;
  }

  if (isVisibilityOnlySearchSignal(value)) {
    score -= 8;
  }

  if (isExplicitSearchProbeDisproof(value)) {
    score -= 12;
  }

  if (
    normalized.includes("tool limitation") ||
    normalized.includes("timed out") ||
    normalized.includes("manual") ||
    normalized.includes("not confirmed")
  ) {
    score -= 12;
  }

  return score;
}

export function reconcileFinalSourceInstructionGuidance(input: {
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
  const sectionOrder: Record<SourceInstructionGuidanceSection, number> = {
    navigation: 1,
    search: 2,
    detail: 3,
    apply: 4,
  };
  const items: SourceInstructionGuidanceLineItem[] = [
    ...input.navigationGuidance.map((line, index) => ({
      section: "navigation" as const,
      line,
      sectionOrder: sectionOrder.navigation,
      originalIndex: index,
    })),
    ...input.searchGuidance.map((line, index) => ({
      section: "search" as const,
      line,
      sectionOrder: sectionOrder.search,
      originalIndex: index,
    })),
    ...input.detailGuidance.map((line, index) => ({
      section: "detail" as const,
      line,
      sectionOrder: sectionOrder.detail,
      originalIndex: index,
    })),
    ...input.applyGuidance.map((line, index) => ({
      section: "apply" as const,
      line,
      sectionOrder: sectionOrder.apply,
      originalIndex: index,
    })),
  ];
  const strongestPositiveByFamily = new Map<
    string,
    SourceInstructionGuidanceLineItem
  >();

  for (const item of items) {
    const family = classifySourceInstructionGuidanceFamily(
      item.line,
      item.section,
    );

    if (
      !family ||
      !isStrongPositiveSourceInstructionGuidance(item.line, item.section)
    ) {
      continue;
    }

    const current = strongestPositiveByFamily.get(family);

    if (!current) {
      strongestPositiveByFamily.set(family, item);
      continue;
    }

    const currentScore = getSourceInstructionGuidanceScore(
      current.line,
      current.section,
    );
    const nextScore = getSourceInstructionGuidanceScore(
      item.line,
      item.section,
    );
    const shouldReplace =
      item.sectionOrder > current.sectionOrder ||
      (item.sectionOrder === current.sectionOrder &&
        nextScore > currentScore) ||
      (item.sectionOrder === current.sectionOrder &&
        nextScore === currentScore &&
        item.line.length > current.line.length);

    if (shouldReplace) {
      strongestPositiveByFamily.set(family, item);
    }
  }

  const keptItems = items.filter((item) => {
    const family = classifySourceInstructionGuidanceFamily(
      item.line,
      item.section,
    );

    if (!family) {
      return true;
    }

    const strongestPositive = strongestPositiveByFamily.get(family);

    if (!strongestPositive) {
      return true;
    }

    if (
      isSupersededByStrongerSourceInstructionGuidance(item.line, family) &&
      strongestPositive.sectionOrder >= item.sectionOrder
    ) {
      return false;
    }

    if (isStrongPositiveSourceInstructionGuidance(item.line, item.section)) {
      return strongestPositive === item;
    }

    return true;
  });

  const seenNormalized = new Set<string>();
  const dedupedItems = keptItems.filter((item) => {
    const normalized = normalizeText(item.line);

    if (seenNormalized.has(normalized)) {
      return false;
    }

    seenNormalized.add(normalized);
    return true;
  });

  return {
    navigationGuidance: dedupedItems
      .filter((item) => item.section === "navigation")
      .map((item) => item.line),
    searchGuidance: dedupedItems
      .filter((item) => item.section === "search")
      .map((item) => item.line),
    detailGuidance: dedupedItems
      .filter((item) => item.section === "detail")
      .map((item) => item.line),
    applyGuidance: dedupedItems
      .filter((item) => item.section === "apply")
      .map((item) => item.line),
  };
}

export function extractJsonObjectString(rawContent: string): string {
  const trimmed = rawContent.trim();

  if (!trimmed) {
    throw new Error("Model review returned empty content.");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmed.indexOf("{");
  const lastBraceIndex = trimmed.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmed.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  return trimmed;
}

