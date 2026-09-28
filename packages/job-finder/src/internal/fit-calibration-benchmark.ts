import {
  SavedJobSchema,
  type FitRecommendation,
  type MatchAssessment,
} from "@nordri/contracts";

import { createMatchAssessmentSession } from "./match-assessment-session";
import { createMatchAssessment } from "./matching";
import { compareDiscoveryJobs } from "./matching-review-queue";
import { runFitCalibrationCounterexamples } from "./fit-calibration-counterexamples";
import type {
  FitAssessmentSemanticSnapshot,
  FitCalibrationBenchmarkReport,
  FitCalibrationCase,
  FitCalibrationCaseResult,
  FitCalibrationCohort,
  FitCalibrationCohortResult,
  FitCalibrationCorpus,
  FitCalibrationDisposition,
  FitCalibrationGrade,
  FitCalibrationThresholds,
  FitScenarioTag,
} from "./fit-calibration-types";

export const DEFAULT_FIT_CALIBRATION_THRESHOLDS: FitCalibrationThresholds = {
  maxHardConflictsInTopFive: 0,
  maxUnsafeHardConflictRecommendations: 0,
  maxIncompleteStrongRecommendations: 0,
  maxMisleadingTitlesInTopFive: 0,
  minCounterexamplePassRate: 1,
  minDispositionAgreement: 0.7,
  minMacroNdcgAtTen: 0.85,
  minMacroPrecisionAtFive: 0.8,
  minMacroRecallAtTen: 0.9,
  minPerCohortNdcgAtTen: 0.75,
  minPerCohortPrecisionAtFive: 0.6,
  minPerCohortRecallAtTen: 0.8,
  minQuadraticWeightedKappa: 0.65,
  minRegionalHardConflictRecall: 1,
  requireDeterministicReplay: true,
};

const FIT_CALIBRATION_RATIO_THRESHOLD_KEYS = [
  "minCounterexamplePassRate",
  "minDispositionAgreement",
  "minMacroNdcgAtTen",
  "minMacroPrecisionAtFive",
  "minMacroRecallAtTen",
  "minPerCohortNdcgAtTen",
  "minPerCohortPrecisionAtFive",
  "minPerCohortRecallAtTen",
  "minQuadraticWeightedKappa",
  "minRegionalHardConflictRecall",
] as const satisfies readonly (keyof FitCalibrationThresholds)[];

const FIT_CALIBRATION_COUNT_THRESHOLD_KEYS = [
  "maxHardConflictsInTopFive",
  "maxUnsafeHardConflictRecommendations",
  "maxIncompleteStrongRecommendations",
  "maxMisleadingTitlesInTopFive",
] as const satisfies readonly (keyof FitCalibrationThresholds)[];

const FIT_CALIBRATION_BOOLEAN_THRESHOLD_KEYS = [
  "requireDeterministicReplay",
] as const satisfies readonly (keyof FitCalibrationThresholds)[];

const FIT_CALIBRATION_THRESHOLD_KEYS: ReadonlySet<string> = new Set([
  ...FIT_CALIBRATION_RATIO_THRESHOLD_KEYS,
  ...FIT_CALIBRATION_COUNT_THRESHOLD_KEYS,
  ...FIT_CALIBRATION_BOOLEAN_THRESHOLD_KEYS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFitCalibrationThresholdOverrides(
  overrides: unknown,
): string[] {
  if (overrides === undefined) {
    return [];
  }
  if (!isRecord(overrides)) {
    return ["threshold_overrides_must_be_an_object"];
  }

  const failures = Object.keys(overrides)
    .filter((key) => !FIT_CALIBRATION_THRESHOLD_KEYS.has(key))
    .sort()
    .map((key) => `unknown_threshold:${key}`);

  for (const key of FIT_CALIBRATION_RATIO_THRESHOLD_KEYS) {
    if (!(key in overrides)) {
      continue;
    }
    const value = overrides[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      failures.push(`invalid_ratio_threshold:${key}`);
    }
  }

  for (const key of FIT_CALIBRATION_COUNT_THRESHOLD_KEYS) {
    if (!(key in overrides)) {
      continue;
    }
    const value = overrides[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      failures.push(`invalid_count_threshold:${key}`);
    }
  }

  for (const key of FIT_CALIBRATION_BOOLEAN_THRESHOLD_KEYS) {
    if (key in overrides && typeof overrides[key] !== "boolean") {
      failures.push(`invalid_boolean_threshold:${key}`);
    }
  }

  return failures;
}

export function resolveFitCalibrationThresholds(
  overrides: unknown,
): FitCalibrationThresholds {
  const failures = validateFitCalibrationThresholdOverrides(overrides);
  if (failures.length > 0) {
    throw new Error(
      `Invalid fit calibration threshold overrides: ${failures.join(", ")}`,
    );
  }
  return {
    ...DEFAULT_FIT_CALIBRATION_THRESHOLDS,
    ...(overrides as Partial<FitCalibrationThresholds> | undefined),
  };
}

const ALL_SCENARIO_TAGS: readonly FitScenarioTag[] = [
  "senior_engineering",
  "nontechnical",
  "career_change",
  "incomplete_listing",
  "misleading_title",
  "regional_eligibility",
  "hard_requirement_conflict",
  "compensation",
  "application_effort",
];

const EXPECTED_DISPOSITION_BY_GRADE: Record<
  FitCalibrationGrade,
  FitCalibrationDisposition
> = {
  0: "reject",
  1: "review",
  2: "consider",
  3: "promote",
};

const DISPOSITION_ORDINAL: Record<FitCalibrationDisposition, number> = {
  reject: 0,
  review: 1,
  consider: 2,
  promote: 3,
};

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

export function normalizeFitCalibrationRequirementLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function normalizedFitCalibrationRequirementLabelsMatch(
  expected: string,
  actual: string,
): boolean {
  const normalizedExpected = normalizeFitCalibrationRequirementLabel(expected);
  return (
    normalizedExpected.length > 0 &&
    normalizedExpected === normalizeFitCalibrationRequirementLabel(actual)
  );
}

function hasTag(
  calibrationCase: FitCalibrationCase,
  tag: FitScenarioTag,
): boolean {
  return calibrationCase.label.tags.includes(tag);
}

export function recommendationToCalibrationDisposition(
  recommendation: FitRecommendation,
): FitCalibrationDisposition {
  switch (recommendation) {
    case "strong_fit":
      return "promote";
    case "apply_with_original":
      return "consider";
    case "review_before_applying":
      return "review";
    case "skip":
      return "reject";
  }
}

export function toFitAssessmentSemanticSnapshot(
  assessment: MatchAssessment,
): FitAssessmentSemanticSnapshot {
  const { contextFingerprint, postingFingerprint, ...semantic } = assessment;
  void contextFingerprint;
  void postingFingerprint;
  return semantic;
}

function semanticKey(assessment: MatchAssessment): string {
  return JSON.stringify(toFitAssessmentSemanticSnapshot(assessment));
}

function relevanceGain(grade: FitCalibrationGrade): number {
  return 2 ** grade - 1;
}

function discountedCumulativeGain(
  grades: readonly FitCalibrationGrade[],
  limit: number,
): number {
  return grades
    .slice(0, limit)
    .reduce<number>(
      (total, grade, index) =>
        total + relevanceGain(grade) / Math.log2(index + 2),
      0,
    );
}

export function calculateNdcgAt(
  rankedGrades: readonly FitCalibrationGrade[],
  limit: number,
): number {
  const actual = discountedCumulativeGain(rankedGrades, limit);
  const ideal = discountedCumulativeGain(
    [...rankedGrades].sort((left, right) => right - left),
    limit,
  );
  return ideal > 0 ? actual / ideal : 1;
}

export function calculatePrecisionAt(
  rankedGrades: readonly FitCalibrationGrade[],
  limit: number,
): number {
  if (limit <= 0) {
    return 0;
  }
  const relevant = rankedGrades
    .slice(0, limit)
    .filter((grade) => grade >= 2).length;
  return relevant / limit;
}

export function calculateRecallAt(
  rankedGrades: readonly FitCalibrationGrade[],
  limit: number,
): number {
  const relevantTotal = rankedGrades.filter((grade) => grade >= 2).length;
  const relevantAtLimit = rankedGrades
    .slice(0, limit)
    .filter((grade) => grade >= 2).length;
  return relevantTotal > 0 ? relevantAtLimit / relevantTotal : 1;
}

export function calculateQuadraticWeightedKappa(
  expected: readonly FitCalibrationDisposition[],
  actual: readonly FitCalibrationDisposition[],
): number {
  if (expected.length !== actual.length) {
    throw new Error("Kappa inputs must contain the same number of labels.");
  }
  if (expected.length === 0) {
    return 1;
  }

  const size = 4;
  const confusion = Array.from({ length: size }, () =>
    Array<number>(size).fill(0),
  );
  const expectedCounts = Array<number>(size).fill(0);
  const actualCounts = Array<number>(size).fill(0);

  for (let index = 0; index < expected.length; index += 1) {
    const expectedOrdinal = DISPOSITION_ORDINAL[expected[index]!];
    const actualOrdinal = DISPOSITION_ORDINAL[actual[index]!];
    const row = confusion[expectedOrdinal]!;
    row[actualOrdinal] = (row[actualOrdinal] ?? 0) + 1;
    expectedCounts[expectedOrdinal] =
      (expectedCounts[expectedOrdinal] ?? 0) + 1;
    actualCounts[actualOrdinal] = (actualCounts[actualOrdinal] ?? 0) + 1;
  }

  const weight = (left: number, right: number) =>
    (left - right) ** 2 / (size - 1) ** 2;
  const count = expected.length;
  let observedDisagreement = 0;
  let expectedDisagreement = 0;

  for (let expectedOrdinal = 0; expectedOrdinal < size; expectedOrdinal += 1) {
    for (let actualOrdinal = 0; actualOrdinal < size; actualOrdinal += 1) {
      const cellWeight = weight(expectedOrdinal, actualOrdinal);
      observedDisagreement +=
        (confusion[expectedOrdinal]![actualOrdinal]! / count) * cellWeight;
      expectedDisagreement +=
        ((expectedCounts[expectedOrdinal]! * actualCounts[actualOrdinal]!) /
          count ** 2) *
        cellWeight;
    }
  }

  return expectedDisagreement === 0
    ? 1
    : 1 - observedDisagreement / expectedDisagreement;
}

export function validateFitCalibrationCorpus(
  corpus: FitCalibrationCorpus,
): string[] {
  const failures: string[] = [];
  const cases = corpus.cohorts.flatMap((cohort) => cohort.cases);
  const seenIds = new Set<string>();
  const seenTags = new Set<FitScenarioTag>();
  const postedTimes = new Set<string>();
  const discoveredTimes = new Set<string>();

  if (corpus.cohorts.length !== 4) {
    failures.push(`expected_4_cohorts:${corpus.cohorts.length}`);
  }
  if (cases.length !== 52) {
    failures.push(`expected_52_cases:${cases.length}`);
  }

  for (const cohort of corpus.cohorts) {
    const relevantCount = cohort.cases.filter(
      (calibrationCase) => calibrationCase.label.grade >= 2,
    ).length;
    const rejectCount = cohort.cases.filter(
      (calibrationCase) => calibrationCase.label.grade === 0,
    ).length;
    if (cohort.cases.length < 10) {
      failures.push(`cohort_too_small:${cohort.id}`);
    }
    if (relevantCount < 5) {
      failures.push(`cohort_relevant_coverage:${cohort.id}`);
    }
    if (rejectCount < 3) {
      failures.push(`cohort_reject_coverage:${cohort.id}`);
    }

    for (const calibrationCase of cohort.cases) {
      if (seenIds.has(calibrationCase.id)) {
        failures.push(`duplicate_case_id:${calibrationCase.id}`);
      }
      seenIds.add(calibrationCase.id);
      calibrationCase.label.tags.forEach((tag) => seenTags.add(tag));
      if (calibrationCase.posting.postedAt) {
        postedTimes.add(calibrationCase.posting.postedAt);
      }
      discoveredTimes.add(calibrationCase.posting.discoveredAt);

      if (
        EXPECTED_DISPOSITION_BY_GRADE[calibrationCase.label.grade] !==
        calibrationCase.label.disposition
      ) {
        failures.push(`grade_disposition_mismatch:${calibrationCase.id}`);
      }
      const rationale = calibrationCase.label.rationale.trim();
      if (
        rationale.length < 24 ||
        rationale === calibrationCase.posting.description.trim() ||
        rationale.includes("missing an independent label rationale")
      ) {
        failures.push(`invalid_rationale:${calibrationCase.id}`);
      }
      if (
        calibrationCase.label.hardConflict &&
        (calibrationCase.label.grade !== 0 ||
          calibrationCase.label.disposition !== "reject" ||
          !hasTag(calibrationCase, "hard_requirement_conflict"))
      ) {
        failures.push(`invalid_hard_conflict_label:${calibrationCase.id}`);
      }
      const expectedLabels =
        calibrationCase.label.expectedRequirements?.map((requirement) =>
          normalizeFitCalibrationRequirementLabel(requirement.label),
        ) ?? [];
      if (new Set(expectedLabels).size !== expectedLabels.length) {
        failures.push(`duplicate_expected_requirement:${calibrationCase.id}`);
      }
      if (expectedLabels.some((label) => label.length === 0)) {
        failures.push(`invalid_expected_requirement:${calibrationCase.id}`);
      }
    }
  }

  for (const tag of ALL_SCENARIO_TAGS) {
    if (!seenTags.has(tag)) {
      failures.push(`missing_scenario_tag:${tag}`);
    }
  }
  if (postedTimes.size !== 1) {
    failures.push(`unstable_posted_timestamps:${postedTimes.size}`);
  }
  if (discoveredTimes.size !== 1) {
    failures.push(`unstable_discovered_timestamps:${discoveredTimes.size}`);
  }

  return failures;
}

function dimensionFailureCodes(
  calibrationCase: FitCalibrationCase,
  assessment: MatchAssessment,
): string[] {
  const expected = calibrationCase.label.expectedDimensions;
  if (!expected) {
    return [];
  }

  const checks: Array<{
    code: string;
    actual: string;
    accepted: readonly string[] | undefined;
  }> = [
    {
      code: "unexpected_role_suitability",
      actual: assessment.dimensions.roleSuitability.state,
      accepted: expected.roleSuitability,
    },
    {
      code: "unexpected_preference_alignment",
      actual: assessment.dimensions.preferenceAlignment.state,
      accepted: expected.preferenceAlignment,
    },
    {
      code: "unexpected_compensation_fit",
      actual: assessment.compensationFit.state,
      accepted: expected.compensationFit,
    },
    {
      code: "unexpected_application_effort",
      actual: assessment.dimensions.applicationEffort.level,
      accepted: expected.applicationEffort,
    },
    {
      code: "unexpected_evidence_confidence",
      actual: assessment.dimensions.evidenceConfidence.level,
      accepted: expected.evidenceConfidence,
    },
  ];

  return checks.flatMap(({ code, actual, accepted }) =>
    accepted && !accepted.includes(actual) ? [code] : [],
  );
}

function requirementFailureCodes(
  calibrationCase: FitCalibrationCase,
  assessment: MatchAssessment,
): string[] {
  return (calibrationCase.label.expectedRequirements ?? []).flatMap(
    (expected) => {
      const requirement = assessment.requirements.find((candidate) =>
        normalizedFitCalibrationRequirementLabelsMatch(
          expected.label,
          candidate.label,
        ),
      );
      if (!requirement) {
        return [`missing_expected_requirement:${expected.label}`];
      }
      return expected.allowedStatuses.includes(requirement.status)
        ? []
        : [`unexpected_requirement_status:${expected.label}`];
    },
  );
}

type AssessedCase = {
  calibrationCase: FitCalibrationCase;
  assessment: MatchAssessment;
  savedJob: ReturnType<typeof SavedJobSchema.parse>;
};

function assessCases(
  cohort: FitCalibrationCohort,
  cases: readonly FitCalibrationCase[],
): AssessedCase[] {
  const session = createMatchAssessmentSession({
    profile: cohort.profile,
    searchPreferences: cohort.searchPreferences,
    calculate: createMatchAssessment,
  });
  return cases.map((calibrationCase) => {
    const assessment = session.assess(calibrationCase.posting);
    return {
      calibrationCase,
      assessment,
      savedJob: SavedJobSchema.parse({
        ...calibrationCase.posting,
        id: `fit_calibration_${cohort.id}_${calibrationCase.id}`,
        status: "discovered",
        matchAssessment: assessment,
      }),
    };
  });
}

function buildCohortResult(
  cohort: FitCalibrationCohort,
): FitCalibrationCohortResult {
  const assessed = assessCases(cohort, cohort.cases);
  const reversed = assessCases(cohort, [...cohort.cases].reverse());
  const ranked = [...assessed].sort((left, right) =>
    compareDiscoveryJobs(left.savedJob, right.savedJob),
  );
  const reversedRanked = [...reversed].sort((left, right) =>
    compareDiscoveryJobs(left.savedJob, right.savedJob),
  );
  const reversedById = new Map(
    reversed.map((entry) => [entry.calibrationCase.id, entry]),
  );
  const deterministicOrder =
    ranked.map((entry) => entry.calibrationCase.id).join("|") ===
    reversedRanked.map((entry) => entry.calibrationCase.id).join("|");
  const topFive = ranked.slice(0, 5);

  const cases = ranked.map<FitCalibrationCaseResult>((entry, index) => {
    const actualDisposition = recommendationToCalibrationDisposition(
      entry.assessment.recommendation,
    );
    const replay = reversedById.get(entry.calibrationCase.id);
    const deterministicReplay =
      deterministicOrder &&
      Boolean(replay) &&
      semanticKey(entry.assessment) === semanticKey(replay!.assessment);
    const explicitExpectationFailureCodes = [
      ...dimensionFailureCodes(entry.calibrationCase, entry.assessment),
      ...requirementFailureCodes(entry.calibrationCase, entry.assessment),
    ];

    if (
      entry.calibrationCase.label.hardConflict &&
      entry.assessment.recommendation !== "skip"
    ) {
      explicitExpectationFailureCodes.push("hard_conflict_not_skipped");
    }

    const failureCodes = [...explicitExpectationFailureCodes];

    if (actualDisposition !== entry.calibrationCase.label.disposition) {
      failureCodes.push("unexpected_disposition");
    }
    if (
      entry.calibrationCase.label.hardConflict &&
      (entry.assessment.recommendation === "strong_fit" ||
        entry.assessment.recommendation === "apply_with_original")
    ) {
      failureCodes.push("unsafe_hard_conflict_recommendation");
    }
    if (!deterministicReplay) {
      failureCodes.push("nondeterministic_replay");
    }

    return {
      id: entry.calibrationCase.id,
      expectedDisposition: entry.calibrationCase.label.disposition,
      actualDisposition,
      grade: entry.calibrationCase.label.grade,
      hardConflict: entry.calibrationCase.label.hardConflict,
      tags: entry.calibrationCase.label.tags,
      rank: index + 1,
      scorerVersion: entry.assessment.scorerVersion,
      score: entry.assessment.score,
      recommendation: entry.assessment.recommendation,
      recommendationRationale: entry.assessment.recommendationRationale,
      labelRationale: entry.calibrationCase.label.rationale,
      dimensions: entry.assessment.dimensions,
      compensationFit: entry.assessment.compensationFit,
      requirements: entry.assessment.requirements,
      deterministicReplay,
      explicitExpectationFailureCodes,
      failureCodes,
    };
  });

  const rankedGrades = ranked.map((entry) => entry.calibrationCase.label.grade);
  return {
    id: cohort.id,
    label: cohort.label,
    caseCount: cases.length,
    relevantCount: rankedGrades.filter((grade) => grade >= 2).length,
    ndcgAtTen: calculateNdcgAt(rankedGrades, 10),
    precisionAtFive: calculatePrecisionAt(rankedGrades, 5),
    recallAtTen: calculateRecallAt(rankedGrades, 10),
    hardConflictsInTopFive: topFive.filter(
      (entry) => entry.calibrationCase.label.hardConflict,
    ).length,
    misleadingTitlesInTopFive: topFive.filter((entry) =>
      hasTag(entry.calibrationCase, "misleading_title"),
    ).length,
    dispositionAgreementCount: cases.filter(
      (entry) => entry.actualDisposition === entry.expectedDisposition,
    ).length,
    cases,
  };
}

function thresholdFailures(input: {
  reportAggregate: FitCalibrationBenchmarkReport["aggregate"];
  cohorts: readonly FitCalibrationCohortResult[];
  thresholds: FitCalibrationThresholds;
}): string[] {
  const { reportAggregate: aggregate, cohorts, thresholds } = input;
  const failures: string[] = [];
  if (aggregate.macroNdcgAtTen < thresholds.minMacroNdcgAtTen) {
    failures.push("macro_ndcg_at_10");
  }
  if (aggregate.macroPrecisionAtFive < thresholds.minMacroPrecisionAtFive) {
    failures.push("macro_precision_at_5");
  }
  if (aggregate.macroRecallAtTen < thresholds.minMacroRecallAtTen) {
    failures.push("macro_recall_at_10");
  }
  if (aggregate.dispositionAgreement < thresholds.minDispositionAgreement) {
    failures.push("disposition_agreement");
  }
  if (aggregate.explicitCaseExpectationFailures > 0) {
    failures.push("explicit_case_expectations");
  }
  if (aggregate.quadraticWeightedKappa < thresholds.minQuadraticWeightedKappa) {
    failures.push("quadratic_weighted_kappa");
  }
  if (
    aggregate.regionalHardConflictRecall <
    thresholds.minRegionalHardConflictRecall
  ) {
    failures.push("regional_hard_conflict_recall");
  }
  if (
    aggregate.unsafeHardConflictRecommendations >
    thresholds.maxUnsafeHardConflictRecommendations
  ) {
    failures.push("unsafe_hard_conflict_recommendations");
  }
  if (aggregate.hardConflictsInTopFive > thresholds.maxHardConflictsInTopFive) {
    failures.push("hard_conflicts_in_top_5");
  }
  if (
    aggregate.incompleteStrongRecommendations >
    thresholds.maxIncompleteStrongRecommendations
  ) {
    failures.push("incomplete_unqualified_recommendations");
  }
  if (
    aggregate.misleadingTitlesInTopFive >
    thresholds.maxMisleadingTitlesInTopFive
  ) {
    failures.push("misleading_titles_in_top_5");
  }
  if (aggregate.counterexamplePassRate < thresholds.minCounterexamplePassRate) {
    failures.push("counterexample_pass_rate");
  }
  if (thresholds.requireDeterministicReplay && !aggregate.deterministicReplay) {
    failures.push("deterministic_replay");
  }
  for (const cohort of cohorts) {
    if (cohort.ndcgAtTen < thresholds.minPerCohortNdcgAtTen) {
      failures.push(`cohort_ndcg_at_10:${cohort.id}`);
    }
    if (cohort.precisionAtFive < thresholds.minPerCohortPrecisionAtFive) {
      failures.push(`cohort_precision_at_5:${cohort.id}`);
    }
    if (cohort.recallAtTen < thresholds.minPerCohortRecallAtTen) {
      failures.push(`cohort_recall_at_10:${cohort.id}`);
    }
  }
  return failures;
}

export function runFitCalibrationBenchmark(input: {
  corpus: FitCalibrationCorpus;
  generatedAt?: string;
  thresholds?: Partial<FitCalibrationThresholds>;
}): FitCalibrationBenchmarkReport {
  const corpusFailures = validateFitCalibrationCorpus(input.corpus);
  if (corpusFailures.length > 0) {
    throw new Error(
      `Invalid fit calibration corpus: ${corpusFailures.join(", ")}`,
    );
  }

  const startedAt = performance.now();
  const thresholds = resolveFitCalibrationThresholds(input.thresholds);
  const cohorts = input.corpus.cohorts.map(buildCohortResult);
  const cases = cohorts.flatMap((cohort) => cohort.cases);
  const counterexamples = runFitCalibrationCounterexamples(input.corpus);
  const expectedDispositions = cases.map((entry) => entry.expectedDisposition);
  const actualDispositions = cases.map((entry) => entry.actualDisposition);
  const regionalHardConflicts = cases.filter(
    (entry) =>
      entry.hardConflict && entry.tags.includes("regional_eligibility"),
  );
  const regionalHardConflictsDetected = regionalHardConflicts.filter(
    (entry) =>
      entry.recommendation === "skip" ||
      entry.requirements.some(
        (requirement) =>
          requirement.importance === "required" &&
          requirement.status === "conflict",
      ),
  ).length;
  const aggregate: FitCalibrationBenchmarkReport["aggregate"] = {
    caseCount: cases.length,
    cohortCount: cohorts.length,
    counterexamplePassRate: safeDivide(
      counterexamples.filter((entry) => entry.passed).length,
      counterexamples.length,
    ),
    deterministicReplay: cases.every((entry) => entry.deterministicReplay),
    dispositionAgreement: safeDivide(
      cases.filter(
        (entry) => entry.actualDisposition === entry.expectedDisposition,
      ).length,
      cases.length,
    ),
    explicitCaseExpectationFailures: cases.filter(
      (entry) => entry.explicitExpectationFailureCodes.length > 0,
    ).length,
    hardConflictsInTopFive: cohorts.reduce(
      (total, cohort) => total + cohort.hardConflictsInTopFive,
      0,
    ),
    incompleteStrongRecommendations: cases.filter(
      (entry) =>
        entry.tags.includes("incomplete_listing") &&
        (entry.recommendation === "strong_fit" ||
          entry.recommendation === "apply_with_original"),
    ).length,
    macroNdcgAtTen: mean(cohorts.map((cohort) => cohort.ndcgAtTen)),
    macroPrecisionAtFive: mean(cohorts.map((cohort) => cohort.precisionAtFive)),
    macroRecallAtTen: mean(cohorts.map((cohort) => cohort.recallAtTen)),
    misleadingTitlesInTopFive: cohorts.reduce(
      (total, cohort) => total + cohort.misleadingTitlesInTopFive,
      0,
    ),
    quadraticWeightedKappa: calculateQuadraticWeightedKappa(
      expectedDispositions,
      actualDispositions,
    ),
    regionalHardConflictRecall: safeDivide(
      regionalHardConflictsDetected,
      regionalHardConflicts.length,
    ),
    unsafeHardConflictRecommendations: cases.filter(
      (entry) =>
        entry.hardConflict &&
        (entry.recommendation === "strong_fit" ||
          entry.recommendation === "apply_with_original"),
    ).length,
  };
  const gateFailures = thresholdFailures({
    reportAggregate: aggregate,
    cohorts,
    thresholds,
  });

  return {
    schemaVersion: 1,
    corpusVersion: input.corpus.version,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    scorerVersion: cases[0]?.scorerVersion ?? 0,
    durationMs: performance.now() - startedAt,
    thresholds,
    aggregate,
    cohorts,
    counterexamples,
    gateFailures,
    passed: gateFailures.length === 0,
  };
}

export function decideFitCalibrationExitCode(
  report: Pick<FitCalibrationBenchmarkReport, "passed">,
  reportOnly: boolean,
): 0 | 1 {
  return report.passed || reportOnly ? 0 : 1;
}
