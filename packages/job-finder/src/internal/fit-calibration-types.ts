import type {
  CandidateProfile,
  EvidenceConfidenceLevel,
  FitRecommendation,
  JobPosting,
  JobRequirementEvidenceStatus,
  JobSearchPreferences,
  MatchAssessment,
} from "@nordri/contracts";

export type FitCalibrationGrade = 0 | 1 | 2 | 3;

export type FitCalibrationDisposition =
  | "reject"
  | "review"
  | "consider"
  | "promote";

export type FitScenarioTag =
  | "senior_engineering"
  | "nontechnical"
  | "career_change"
  | "incomplete_listing"
  | "misleading_title"
  | "regional_eligibility"
  | "hard_requirement_conflict"
  | "compensation"
  | "application_effort";

export interface FitCalibrationDimensionExpectation {
  applicationEffort?: readonly MatchAssessment["dimensions"]["applicationEffort"]["level"][];
  compensationFit?: readonly MatchAssessment["compensationFit"]["state"][];
  evidenceConfidence?: readonly EvidenceConfidenceLevel[];
  preferenceAlignment?: readonly MatchAssessment["dimensions"]["preferenceAlignment"]["state"][];
  roleSuitability?: readonly MatchAssessment["dimensions"]["roleSuitability"]["state"][];
}

export interface FitCalibrationRequirementExpectation {
  label: string;
  allowedStatuses: readonly JobRequirementEvidenceStatus[];
}

export interface FitCalibrationLabel {
  grade: FitCalibrationGrade;
  disposition: FitCalibrationDisposition;
  hardConflict: boolean;
  rationale: string;
  tags: readonly FitScenarioTag[];
  expectedDimensions?: FitCalibrationDimensionExpectation;
  expectedRequirements?: readonly FitCalibrationRequirementExpectation[];
}

export interface FitCalibrationCase {
  id: string;
  posting: JobPosting;
  label: FitCalibrationLabel;
}

export interface FitCalibrationCohort {
  id: string;
  label: string;
  profile: CandidateProfile;
  searchPreferences: JobSearchPreferences;
  cases: readonly FitCalibrationCase[];
}

export interface FitCalibrationCorpus {
  version: string;
  cohorts: readonly FitCalibrationCohort[];
}

export interface FitCalibrationThresholds {
  maxHardConflictsInTopFive: number;
  maxUnsafeHardConflictRecommendations: number;
  maxIncompleteStrongRecommendations: number;
  maxMisleadingTitlesInTopFive: number;
  minCounterexamplePassRate: number;
  minDispositionAgreement: number;
  minMacroNdcgAtTen: number;
  minMacroPrecisionAtFive: number;
  minMacroRecallAtTen: number;
  minPerCohortNdcgAtTen: number;
  minPerCohortPrecisionAtFive: number;
  minPerCohortRecallAtTen: number;
  minQuadraticWeightedKappa: number;
  minRegionalHardConflictRecall: number;
  requireDeterministicReplay: boolean;
}

export interface FitCalibrationCaseResult {
  id: string;
  expectedDisposition: FitCalibrationDisposition;
  actualDisposition: FitCalibrationDisposition;
  grade: FitCalibrationGrade;
  hardConflict: boolean;
  tags: readonly FitScenarioTag[];
  rank: number;
  scorerVersion: number;
  score: number;
  recommendation: FitRecommendation;
  recommendationRationale: string;
  labelRationale: string;
  dimensions: MatchAssessment["dimensions"];
  compensationFit: MatchAssessment["compensationFit"];
  requirements: MatchAssessment["requirements"];
  deterministicReplay: boolean;
  explicitExpectationFailureCodes: string[];
  failureCodes: string[];
}

export interface FitCalibrationCohortResult {
  id: string;
  label: string;
  caseCount: number;
  relevantCount: number;
  ndcgAtTen: number;
  precisionAtFive: number;
  recallAtTen: number;
  hardConflictsInTopFive: number;
  misleadingTitlesInTopFive: number;
  dispositionAgreementCount: number;
  cases: FitCalibrationCaseResult[];
}

export interface FitCalibrationCounterexampleResult {
  id: string;
  description: string;
  passed: boolean;
  failures: string[];
}

export interface FitCalibrationBenchmarkReport {
  schemaVersion: 1;
  corpusVersion: string;
  generatedAt: string;
  scorerVersion: number;
  durationMs: number;
  thresholds: FitCalibrationThresholds;
  aggregate: {
    caseCount: number;
    cohortCount: number;
    counterexamplePassRate: number;
    deterministicReplay: boolean;
    dispositionAgreement: number;
    explicitCaseExpectationFailures: number;
    hardConflictsInTopFive: number;
    incompleteStrongRecommendations: number;
    macroNdcgAtTen: number;
    macroPrecisionAtFive: number;
    macroRecallAtTen: number;
    misleadingTitlesInTopFive: number;
    quadraticWeightedKappa: number;
    regionalHardConflictRecall: number;
    unsafeHardConflictRecommendations: number;
  };
  cohorts: FitCalibrationCohortResult[];
  counterexamples: FitCalibrationCounterexampleResult[];
  gateFailures: string[];
  passed: boolean;
}

export type FitAssessmentSemanticSnapshot = Omit<
  MatchAssessment,
  "contextFingerprint" | "postingFingerprint"
>;
