import {
  SourceInstructionArtifactSchema,
  type JobDiscoveryTarget,
  type JobSource,
  type SourceDebugRunRecord,
  type SourceDebugWorkerAttempt,
  type SourceInstructionArtifact,
} from "@unemployed/contracts";
import {
  collectAttemptInstructionGuidance,
  evaluateSourceInstructionQuality,
  filterSourceDebugWarnings,
  filterSourceInstructionLines,
  isExplicitSearchProbeDisproof,
  isPositiveReusableSearchSignal,
  isVisibilityOnlySearchSignal,
  reconcileApplyGuidance,
  reconcileFinalSourceInstructionGuidance,
  reconcileMixedAccessGuidance,
  reconcileVisibleControlEvidence,
  type SourceInstructionReviewOverride,
} from "./source-instructions";
import { normalizeText, uniqueStrings } from "./shared";
import { buildSourceInstructionVersionInfo } from "./workspace-helpers";
import { buildSourceIntelligenceArtifact } from "./workspace-source-intelligence";

const APPLY_LINE_PATTERN =
  /^apply note:|\bapply\b|\bapplication\b|\beasy apply\b/iu;
const DETAIL_LINE_PATTERN =
  /\b(detail page|detail pages|job detail|job details|job page|job pages|canonical url|canonical urls|stable url|stable identity|posting page|posting pages|opens the posting|full description)\b/iu;
const SEARCH_LINE_PATTERN =
  /^(reliable control|filter note):|\b(search|filter|filters|keyword|keywords|location|industry|category|sort|pagination|paginate|next page|load more|infinite scroll|show all|collection|collections|result set|results)\b/iu;

/**
 * Files one learning run's lines by what they are about.
 *
 * Apply first, because "apply" is the most specific word; then job pages;
 * then anything about search, filters, sorting, or paging; the rest is how
 * to get to the jobs at all.
 */
function splitLearningGuidance(lines: readonly string[]): {
  navigation: string[];
  search: string[];
  detail: string[];
  apply: string[];
} {
  const split = { navigation: [] as string[], search: [] as string[], detail: [] as string[], apply: [] as string[] };
  for (const line of lines) {
    if (APPLY_LINE_PATTERN.test(line)) split.apply.push(line);
    else if (DETAIL_LINE_PATTERN.test(line)) split.detail.push(line);
    else if (SEARCH_LINE_PATTERN.test(line)) split.search.push(line);
    else split.navigation.push(line);
  }
  return split;
}

export function synthesizeSourceInstructionArtifact(
  target: JobDiscoveryTarget,
  run: SourceDebugRunRecord,
  attempts: readonly SourceDebugWorkerAttempt[],
  adapterKind: JobSource,
  verification: SourceInstructionArtifact["verification"],
  reviewOverride?: SourceInstructionReviewOverride | null,
  currentArtifact?: SourceInstructionArtifact | null,
): SourceInstructionArtifact {
  const byPhase = new Map(attempts.map((attempt) => [attempt.phase, attempt]));
  // One learning run now covers access, structure, search, detail, and apply
  // (ADR 0023). Its attempt stands in wherever an older separate phase is
  // absent; each guidance kind still takes only its own tagged lines.
  const structureAttempt = byPhase.get("site_structure_mapping");
  const accessAttempt = byPhase.get("access_auth_probe") ?? structureAttempt;
  const searchAttempt = byPhase.get("search_filter_probe") ?? structureAttempt;
  const detailAttempt = byPhase.get("job_detail_validation") ?? structureAttempt;
  const applyAttempt = byPhase.get("apply_path_validation") ?? structureAttempt;
  const hasPartialTimeoutEvidence = attempts.some(
    (attempt) => attempt.completionMode === "timed_out_with_partial_evidence",
  );
  const hasUnstructuredFailure = attempts.some(
    (attempt) =>
      attempt.completionMode === "timed_out_without_evidence" ||
      attempt.completionMode === "runtime_failed" ||
      attempt.completionMode === "interrupted" ||
      attempt.completionMode === "stalled",
  );
  const draftWarnings = filterSourceDebugWarnings(
    attempts.flatMap((attempt) => [attempt.blockerSummary]),
  );
  const usedGuidance = new Set<string>();
  const takeUniqueGuidance = (lines: readonly string[]) =>
    lines.filter((line) => {
      const key = normalizeText(line);

      if (usedGuidance.has(key)) {
        return false;
      }

      usedGuidance.add(key);
      return true;
    });
  // With one learning run, what a line is about decides where it files,
  // not which phase said it. With the older separate phases, the phase
  // still decides, as before.
  const learningOnly =
    structureAttempt !== undefined &&
    !byPhase.has("search_filter_probe") &&
    !byPhase.has("job_detail_validation") &&
    !byPhase.has("apply_path_validation");
  const learningLines = learningOnly
    ? splitLearningGuidance(
        uniqueStrings([
          ...collectAttemptInstructionGuidance(accessAttempt),
          ...collectAttemptInstructionGuidance(structureAttempt),
        ]),
      )
    : null;
  const rawNavigationGuidance = takeUniqueGuidance(
    learningLines
      ? learningLines.navigation
      : uniqueStrings([
          ...collectAttemptInstructionGuidance(accessAttempt),
          ...collectAttemptInstructionGuidance(structureAttempt),
        ]),
  );
  const rawSearchGuidance = takeUniqueGuidance(
    learningLines
      ? learningLines.search
      : uniqueStrings([...collectAttemptInstructionGuidance(searchAttempt)]),
  );
  const rawDetailGuidance = takeUniqueGuidance(
    learningLines
      ? learningLines.detail
      : uniqueStrings([...collectAttemptInstructionGuidance(detailAttempt)]),
  );
  const rawApplyGuidance = takeUniqueGuidance(
    reconcileApplyGuidance(
      learningLines
        ? learningLines.apply
        : uniqueStrings([...collectAttemptInstructionGuidance(applyAttempt)]),
    ),
  );
  const visibleControlReconciledGuidance = reconcileVisibleControlEvidence({
    attempts,
    navigationGuidance: rawNavigationGuidance,
    searchGuidance: rawSearchGuidance,
    detailGuidance: rawDetailGuidance,
    applyGuidance: rawApplyGuidance,
  });
  const reconciledGuidance = reconcileMixedAccessGuidance({
    navigationGuidance: visibleControlReconciledGuidance.navigationGuidance,
    searchGuidance: visibleControlReconciledGuidance.searchGuidance,
    detailGuidance: visibleControlReconciledGuidance.detailGuidance,
    applyGuidance: visibleControlReconciledGuidance.applyGuidance,
  });
  const finalReconciledGuidance = reconcileFinalSourceInstructionGuidance({
    navigationGuidance: reconciledGuidance.navigationGuidance,
    searchGuidance: reconciledGuidance.searchGuidance,
    detailGuidance: reconciledGuidance.detailGuidance,
    applyGuidance: reconciledGuidance.applyGuidance,
  });
  const reviewedGuidance = reconcileFinalSourceInstructionGuidance({
    navigationGuidance:
      reviewOverride && reviewOverride.navigationGuidance !== null
        ? filterSourceInstructionLines(reviewOverride.navigationGuidance)
        : finalReconciledGuidance.navigationGuidance,
    searchGuidance:
      reviewOverride && reviewOverride.searchGuidance !== null
        ? filterSourceInstructionLines(reviewOverride.searchGuidance)
        : finalReconciledGuidance.searchGuidance,
    detailGuidance:
      reviewOverride && reviewOverride.detailGuidance !== null
        ? filterSourceInstructionLines(reviewOverride.detailGuidance)
        : finalReconciledGuidance.detailGuidance,
    applyGuidance:
      reviewOverride && reviewOverride.applyGuidance !== null
        ? filterSourceInstructionLines(reviewOverride.applyGuidance)
        : finalReconciledGuidance.applyGuidance,
  });
  const navigationGuidance = reviewedGuidance.navigationGuidance;
  const searchGuidance = reviewedGuidance.searchGuidance;
  const detailGuidance = reviewedGuidance.detailGuidance;
  const applyGuidance = reviewedGuidance.applyGuidance;
  const hasPositiveReusableSearchGuidance = searchGuidance.some(
    isPositiveReusableSearchSignal,
  );
  const hasExplicitSearchDisproof = searchGuidance.some(
    isExplicitSearchProbeDisproof,
  );
  const hasVisibilityOnlySearchSignals = searchGuidance.some(
    isVisibilityOnlySearchSignal,
  );
  const hasConclusiveSearchDisproof =
    hasExplicitSearchDisproof && !hasVisibilityOnlySearchSignals;
  const hasSearchGuidanceWithoutPositiveProof =
    searchGuidance.length > 0 &&
    !hasPositiveReusableSearchGuidance &&
    !hasConclusiveSearchDisproof;
  const hasOnlyVisibilitySearchGuidance =
    searchGuidance.length > 0 &&
    !hasPositiveReusableSearchGuidance &&
    !hasConclusiveSearchDisproof &&
    searchGuidance.every(
      (line) =>
        isVisibilityOnlySearchSignal(line) ||
        isExplicitSearchProbeDisproof(line),
    );
  const quality = evaluateSourceInstructionQuality({
    navigationGuidance,
    searchGuidance,
    detailGuidance,
    applyGuidance,
  });
  const warnings = uniqueStrings([
    ...filterSourceDebugWarnings(reviewOverride?.warnings ?? []),
    ...draftWarnings,
    ...(hasPartialTimeoutEvidence
      ? [
          "The check ran out of time before it could finish its report, so this guidance is partial. Check the source again to complete it.",
        ]
      : []),
    ...(hasUnstructuredFailure
      ? [
          "The check ended before it could report what it learned, so this guidance is a draft. Check the source again to complete it.",
        ]
      : []),
    ...(hasSearchGuidanceWithoutPositiveProof
      ? [
          "The check saw search and filter controls but did not confirm that any of them changes the results.",
        ]
      : []),
    ...(hasOnlyVisibilitySearchGuidance
      ? [
          "The check saw search and filter controls but did not confirm that any of them changes the results.",
        ]
      : []),
    ...reconciledGuidance.warnings,
    ...quality.qualityWarnings,
  ]);
  const hasPromotionBlocker =
    hasPartialTimeoutEvidence ||
    hasUnstructuredFailure ||
    hasSearchGuidanceWithoutPositiveProof ||
    hasOnlyVisibilitySearchGuidance;
  const status =
    verification?.outcome === "passed" &&
    quality.qualifiesForValidation &&
    !hasPromotionBlocker
      ? "validated"
      : warnings.some((warning) =>
            warning.toLowerCase().includes("unsupported"),
          )
        ? "unsupported"
        : "draft";
  const intelligence =
    reviewOverride?.intelligence ??
    buildSourceIntelligenceArtifact({
      target,
      attempts,
      currentArtifact: currentArtifact ?? null,
    });

  return SourceInstructionArtifactSchema.parse({
    id:
      run.instructionArtifactId ??
      `source_instruction_${target.id}_${Date.now()}`,
    targetId: target.id,
    status,
    createdAt: attempts[0]?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acceptedAt: status === "validated" ? new Date().toISOString() : null,
    basedOnRunId: run.id,
    basedOnAttemptIds: attempts.map((attempt) => attempt.id),
    notes: run.finalSummary ?? null,
    navigationGuidance,
    searchGuidance,
    detailGuidance,
    applyGuidance,
    warnings,
    intelligence,
    versionInfo: buildSourceInstructionVersionInfo(adapterKind),
    verification,
  });
}
