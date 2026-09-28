import {
  CandidateProfileSchema,
  JobSearchPreferencesSchema,
  SavedJobSchema,
  type FitRecommendation,
  type MatchAssessment,
} from "@nordri/contracts";

import { createMatchAssessmentSession } from "./match-assessment-session";
import { createMatchAssessment } from "./matching";
import { compareDiscoveryJobs } from "./matching-review-queue";
import type {
  FitCalibrationCase,
  FitCalibrationCohort,
  FitCalibrationCorpus,
  FitCalibrationCounterexampleResult,
} from "./fit-calibration-types";

function requireCohort(
  corpus: FitCalibrationCorpus,
  id: string,
): FitCalibrationCohort {
  const cohort = corpus.cohorts.find((entry) => entry.id === id);
  if (!cohort) {
    throw new Error(`Missing calibration cohort ${id}.`);
  }
  return cohort;
}

function requireCase(
  cohort: FitCalibrationCohort,
  id: string,
): FitCalibrationCase {
  const calibrationCase = cohort.cases.find((entry) => entry.id === id);
  if (!calibrationCase) {
    throw new Error(`Missing calibration case ${cohort.id}/${id}.`);
  }
  return calibrationCase;
}

function result(
  id: string,
  description: string,
  failures: Array<string | false | null | undefined>,
): FitCalibrationCounterexampleResult {
  const presentFailures = failures.filter(
    (failure): failure is string => typeof failure === "string",
  );
  return {
    id,
    description,
    passed: presentFailures.length === 0,
    failures: presentFailures,
  };
}

function semanticKey(assessment: MatchAssessment): string {
  const { contextFingerprint, postingFingerprint, ...semantic } = assessment;
  void contextFingerprint;
  void postingFingerprint;
  return JSON.stringify(semantic);
}

function fitWithoutEffortKey(assessment: MatchAssessment): string {
  const { applicationEffort, ...fitDimensions } = assessment.dimensions;
  void applicationEffort;
  return JSON.stringify({
    score: assessment.score,
    recommendation: assessment.recommendation,
    recommendationRationale: assessment.recommendationRationale,
    compensationFit: assessment.compensationFit,
    dimensions: fitDimensions,
    reasons: assessment.reasons,
    gaps: assessment.gaps,
    requirements: assessment.requirements,
  });
}

function baseFitKey(assessment: MatchAssessment): string {
  return JSON.stringify({
    score: assessment.score,
    recommendation: assessment.recommendation,
    recommendationRationale: assessment.recommendationRationale,
    reasons: assessment.reasons,
    gaps: assessment.gaps,
    requirements: assessment.requirements,
  });
}

function assess(
  cohort: FitCalibrationCohort,
  calibrationCase: FitCalibrationCase,
): MatchAssessment {
  return createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    calibrationCase.posting,
  );
}

export function hardConflictRecommendationFailure(
  caseId: string,
  recommendation: FitRecommendation,
): string | null {
  return recommendation === "skip" ? null : `not_skipped:${caseId}`;
}

function rank(
  cohort: FitCalibrationCohort,
  calibrationCases: readonly FitCalibrationCase[],
): string[] {
  return calibrationCases
    .map((calibrationCase) => {
      const assessment = assess(cohort, calibrationCase);
      return {
        id: calibrationCase.id,
        job: SavedJobSchema.parse({
          ...calibrationCase.posting,
          id: `counterexample_${cohort.id}_${calibrationCase.id}`,
          status: "discovered",
          matchAssessment: assessment,
        }),
      };
    })
    .sort((left, right) => compareDiscoveryJobs(left.job, right.job))
    .map((entry) => entry.id);
}

function easyApplyNeutral(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_supported_emea");
  const external = assess(cohort, calibrationCase);
  const easy = createMatchAssessment(cohort.profile, cohort.searchPreferences, {
    ...calibrationCase.posting,
    applyPath: "easy_apply",
    easyApplyEligible: true,
  });
  return result(
    "easy_apply_fit_neutral",
    "Easy Apply changes effort, never candidate suitability.",
    [
      fitWithoutEffortKey(external) !== fitWithoutEffortKey(easy) &&
        "fit_changed",
      easy.dimensions.applicationEffort.level !== "low" &&
        "easy_apply_not_low_effort",
    ],
  );
}

function consentInterruptNeutral(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_supported_emea");
  const uninterrupted = assess(cohort, calibrationCase);
  const interrupted = createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    {
      ...calibrationCase.posting,
      screeningHints: {
        ...calibrationCase.posting.screeningHints,
        requiresConsentInterrupt: true,
        requiresConsentInterruptKind: "signup",
      },
    },
  );
  return result(
    "consent_interrupt_fit_neutral",
    "A signup or consent handoff changes effort, not candidate fit.",
    [
      fitWithoutEffortKey(uninterrupted) !== fitWithoutEffortKey(interrupted) &&
        "fit_changed",
      interrupted.dimensions.applicationEffort.level !== "high" &&
        "interrupt_not_high_effort",
    ],
  );
}

function unknownPayNeutral(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_fullstack_supported_global");
  const withMinimum = assess(cohort, calibrationCase);
  const withoutMinimum = createMatchAssessment(
    cohort.profile,
    JobSearchPreferencesSchema.parse({
      ...cohort.searchPreferences,
      minimumSalaryUsd: null,
      compensation: {
        minimum: null,
        maximum: null,
        interval: "year",
        currency: null,
        currencyStatus: "needs_clarification",
      },
    }),
    calibrationCase.posting,
  );
  return result(
    "unknown_pay_neutral",
    "Missing pay cannot improve or reduce suitability.",
    [
      baseFitKey(withMinimum) !== baseFitKey(withoutMinimum) && "fit_changed",
      withMinimum.compensationFit.state !== "unknown" &&
        "minimum_case_not_unknown",
      withoutMinimum.compensationFit.state !== "not_requested" &&
        "comparison_case_not_unrequested",
    ],
  );
}

function foreignPayNeutral(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_fullstack_supported_global");
  const unknown = assess(cohort, calibrationCase);
  const foreign = createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    { ...calibrationCase.posting, salaryText: "EUR 140k/year" },
  );
  return result(
    "foreign_pay_neutral",
    "Foreign-currency pay remains incomparable to a USD minimum.",
    [
      unknown.score !== foreign.score && "score_changed",
      unknown.recommendation !== foreign.recommendation &&
        "recommendation_changed",
      foreign.compensationFit.state !== "currency_incomparable" &&
        "foreign_pay_not_incomparable",
    ],
  );
}

function belowPayRanksLower(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_supported_emea");
  const above = createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    { ...calibrationCase.posting, salaryText: "$140k/year" },
  );
  const below = createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    { ...calibrationCase.posting, salaryText: "$90k/year" },
  );
  return result(
    "below_pay_ranks_lower",
    "Comparable pay below the saved minimum is review-first and ranks lower.",
    [
      below.score >= above.score && "below_pay_not_lower",
      below.score > 71 && "below_pay_score_above_cap",
      below.recommendation !== "review_before_applying" &&
        "below_pay_not_review",
    ],
  );
}

function requiredEvidenceMonotonic(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_required_go_missing");
  const missing = assess(cohort, calibrationCase);
  const profile = CandidateProfileSchema.parse({
    ...cohort.profile,
    skills: [...cohort.profile.skills, "Go", "Kubernetes"],
    skillGroups: {
      ...cohort.profile.skillGroups,
      coreSkills: [
        ...cohort.profile.skillGroups.coreSkills,
        "Go",
        "Kubernetes",
      ],
    },
    experiences: cohort.profile.experiences.map((experience, index) =>
      index === 0
        ? {
            ...experience,
            achievements: [
              ...experience.achievements,
              "Shipped production Go services on Kubernetes.",
            ],
            skills: [...experience.skills, "Go", "Kubernetes"],
          }
        : experience,
    ),
  });
  const supported = createMatchAssessment(
    profile,
    cohort.searchPreferences,
    calibrationCase.posting,
  );
  const requiredTechnologyStatuses = supported.requirements
    .filter((requirement) =>
      ["go", "kubernetes"].includes(requirement.label.toLowerCase()),
    )
    .map((requirement) => requirement.status);
  return result(
    "required_evidence_monotonic",
    "Adding explicit required evidence cannot lower fit or leave the requirement unsupported.",
    [
      supported.score < missing.score && "score_decreased",
      (requiredTechnologyStatuses.length !== 2 ||
        requiredTechnologyStatuses.some((status) => status !== "supported")) &&
        "requirements_not_supported",
    ],
  );
}

function exactRoleBeatsWrongFamily(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const exact = requireCase(cohort, "eng_exact_supported_emea");
  const wrong = requireCase(cohort, "eng_data_wrong_family");
  const order = rank(cohort, [wrong, exact]);
  return result(
    "exact_role_beats_wrong_family",
    "A grounded exact role ranks above an otherwise attractive wrong-family role.",
    [order[0] !== exact.id && "wrong_family_ranked_first"],
  );
}

function hardConflictNeverUnqualified(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const failures = corpus.cohorts.flatMap((cohort) =>
    cohort.cases.flatMap((calibrationCase) => {
      if (!calibrationCase.label.hardConflict) {
        return [];
      }
      const assessment = assess(cohort, calibrationCase);
      const failure = hardConflictRecommendationFailure(
        calibrationCase.id,
        assessment.recommendation,
      );
      return failure ? [failure] : [];
    }),
  );
  return result(
    "hard_conflict_never_unqualified",
    "Every labeled hard conflict must produce an explicit skip recommendation.",
    failures,
  );
}

function cardOnlyRequiresReview(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const ids = [
    ["senior_engineer_eu", "eng_card_only_exact"],
    ["customer_success_nontechnical", "cs_card_only_exact"],
  ] as const;
  const failures = ids.flatMap(([cohortId, caseId]) => {
    const cohort = requireCohort(corpus, cohortId);
    const assessment = assess(cohort, requireCase(cohort, caseId));
    return assessment.recommendation === "review_before_applying" ||
      assessment.recommendation === "skip"
      ? []
      : [`unqualified:${caseId}`];
  });
  return result(
    "card_only_requires_review",
    "A title-only card cannot receive an unqualified recommendation.",
    failures,
  );
}

function misleadingSalesTitleBelowRealRole(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const misleading = requireCase(cohort, "eng_solutions_sales_body");
  const real = requireCase(cohort, "eng_frontend_adjacent_supported");
  const fullOrder = rank(cohort, cohort.cases);
  const pairOrder = rank(cohort, [misleading, real]);
  return result(
    "misleading_sales_title_below_real_role",
    "A quota-carrying Solutions Engineer listing stays below a real adjacent engineering role.",
    [
      pairOrder[0] !== real.id && "misleading_title_ranked_first",
      fullOrder.indexOf(misleading.id) < 5 && "misleading_title_in_top_5",
    ],
  );
}

function remoteGeographyTruth(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "uk_product_designer_regional");
  const worldwide = requireCase(cohort, "region_worldwide_remote");
  const usOnly = requireCase(cohort, "region_us_only_no_sponsor");
  const usAssessment = assess(cohort, usOnly);
  const order = rank(cohort, [usOnly, worldwide]);
  const requiredConflict = usAssessment.requirements.some(
    (requirement) =>
      requirement.importance === "required" &&
      requirement.status === "conflict",
  );
  return result(
    "remote_geography_truth",
    "Worldwide eligibility ranks above an explicit incompatible remote region.",
    [
      order[0] !== worldwide.id && "restricted_region_ranked_first",
      usAssessment.recommendation !== "skip" && "restricted_region_not_skipped",
      !requiredConflict && "restricted_region_without_conflict_evidence",
    ],
  );
}

function clearanceUnknownRequiresReview(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "uk_product_designer_regional");
  const calibrationCase = requireCase(
    cohort,
    "region_clearance_required_unknown",
  );
  const assessment = assess(cohort, calibrationCase);
  const clearance = assessment.requirements.find((requirement) =>
    /security clearance/iu.test(requirement.label),
  );
  return result(
    "clearance_unknown_requires_review",
    "Unknown required clearance remains explicit and review-first.",
    [
      (assessment.recommendation === "strong_fit" ||
        assessment.recommendation === "apply_with_original") &&
        "clearance_unqualified",
      !clearance && "clearance_requirement_missing",
      clearance?.status !== "unknown" && "clearance_not_unknown",
    ],
  );
}

function keywordStuffingCannotRescueWrongFamily(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const wrong = requireCase(cohort, "eng_data_wrong_family");
  const real = requireCase(cohort, "eng_frontend_adjacent_supported");
  const stuffed: FitCalibrationCase = {
    ...wrong,
    id: "eng_data_wrong_family_stuffed",
    posting: {
      ...wrong.posting,
      sourceJobId: "eng_data_wrong_family_stuffed",
      canonicalUrl:
        "https://jobs.example.test/senior_engineer_eu/eng_data_wrong_family_stuffed",
      keySkills: [
        "TypeScript",
        "React",
        "Node.js",
        "AWS",
        "Docker",
        "PostgreSQL",
      ],
      description:
        "Build data pipelines. TypeScript, React, Node.js, AWS, Docker, and PostgreSQL appear throughout this listing.",
    },
  };
  const stuffedAssessment = assess(cohort, stuffed);
  const order = rank(cohort, [stuffed, real]);
  return result(
    "keyword_stuffing_cannot_rescue_wrong_family",
    "Keyword overlap cannot rescue an explicit wrong role family.",
    [
      order[0] !== real.id && "stuffed_wrong_family_ranked_first",
      (stuffedAssessment.recommendation === "strong_fit" ||
        stuffedAssessment.recommendation === "apply_with_original") &&
        "stuffed_wrong_family_unqualified",
    ],
  );
}

function preferredCompanyBounded(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const conflict = requireCase(cohort, "eng_us_only_no_sponsorship");
  const eligible = requireCase(cohort, "eng_exact_supported_emea");
  const preferences = JobSearchPreferencesSchema.parse({
    ...cohort.searchPreferences,
    companyWhitelist: [conflict.posting.company],
  });
  const conflictAssessment = createMatchAssessment(
    cohort.profile,
    preferences,
    conflict.posting,
  );
  const eligibleAssessment = createMatchAssessment(
    cohort.profile,
    preferences,
    eligible.posting,
  );
  return result(
    "preferred_company_bounded",
    "A preferred-company bonus cannot override a hard conflict.",
    [
      conflictAssessment.recommendation !== "skip" &&
        "preferred_conflict_not_skipped",
      conflictAssessment.score >= eligibleAssessment.score &&
        "preferred_conflict_not_lower",
    ],
  );
}

function negativeEvidenceIsSupportable(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const assessment = assess(
    cohort,
    requireCase(cohort, "eng_exact_required_go_missing"),
  );
  const goRequirement = assessment.requirements.find(
    (requirement) => requirement.label === "Go",
  );
  return result(
    "negative_evidence_is_supportable",
    "Explicit negative evidence remains supportable evidence, not missing coverage.",
    [
      !goRequirement && "go_requirement_missing",
      goRequirement?.status !== "missing" && "go_requirement_not_missing",
      (assessment.dimensions.evidenceConfidence.level === "unavailable" ||
        assessment.dimensions.evidenceConfidence.level === "low") &&
        "negative_evidence_marked_low_confidence",
    ],
  );
}

function sessionSemanticEquivalence(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_supported_emea");
  const direct = assess(cohort, calibrationCase);
  const session = createMatchAssessmentSession({
    profile: cohort.profile,
    searchPreferences: cohort.searchPreferences,
    calculate: createMatchAssessment,
  });
  const first = session.assess(calibrationCase.posting);
  const second = session.assess(calibrationCase.posting);
  return result(
    "session_semantic_equivalence",
    "The versioned assessment session is semantically identical and computes once.",
    [
      semanticKey(direct) !== semanticKey(first) && "session_semantic_mismatch",
      first !== second && "session_did_not_reuse_object",
      session.getComputationCount() !== 1 &&
        "session_computation_count_not_one",
    ],
  );
}

function reversedInputStability(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const failures = corpus.cohorts.flatMap((cohort) => {
    const forward = rank(cohort, cohort.cases);
    const reversed = rank(cohort, [...cohort.cases].reverse());
    return forward.join("|") === reversed.join("|")
      ? []
      : [`order_changed:${cohort.id}`];
  });
  return result(
    "reversed_input_stability",
    "Reversing fixture input preserves the final production order.",
    failures,
  );
}

function talentPoolNotActionable(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const ids = [
    ["senior_engineer_eu", "eng_talent_pool_not_opening"],
    ["customer_success_nontechnical", "cs_talent_pool_not_opening"],
    [
      "designer_to_ux_engineer_transition",
      "transition_talent_pool_not_opening",
    ],
  ] as const;
  const failures = ids.flatMap(([cohortId, caseId]) => {
    const cohort = requireCohort(corpus, cohortId);
    const assessment = assess(cohort, requireCase(cohort, caseId));
    const order = rank(cohort, cohort.cases);
    return [
      assessment.recommendation !== "skip" && `not_skipped:${caseId}`,
      order.indexOf(caseId) < 5 && `top_5:${caseId}`,
    ].filter((failure): failure is string => typeof failure === "string");
  });
  return result(
    "talent_pool_not_actionable",
    "Talent communities and future-opportunity pools are not current vacancies.",
    failures,
  );
}

/**
 * An opening reserved for entrants cannot tie the same listing written for
 * experienced hires. The two postings here differ only in the career-stage
 * wording, so any score parity between them is the exact defect this
 * counterexample exists to catch.
 */
function earlyCareersProgrammeExcludesSeniorProfile(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult {
  const cohort = requireCohort(corpus, "senior_engineer_eu");
  const calibrationCase = requireCase(cohort, "eng_exact_supported_emea");
  const experienced = assess(cohort, calibrationCase);
  const earlyCareers = createMatchAssessment(
    cohort.profile,
    cohort.searchPreferences,
    {
      ...calibrationCase.posting,
      title: `${calibrationCase.posting.title} | Early Careers, 2027 Start`,
    },
  );

  return result(
    "early_careers_programme_excludes_senior_profile",
    "An early-careers programme never ties the same role written for experienced hires.",
    [
      earlyCareers.recommendation !== "skip" && "not_skipped",
      earlyCareers.score >= experienced.score && "score_not_lower",
      earlyCareers.dimensions.roleSuitability.state !== "conflict" &&
        "role_suitability_not_conflict",
      !earlyCareers.requirements.some(
        (requirement) =>
          requirement.category === "seniority" &&
          requirement.status === "conflict",
      ) && "career_stage_conflict_missing",
    ],
  );
}

export function runFitCalibrationCounterexamples(
  corpus: FitCalibrationCorpus,
): FitCalibrationCounterexampleResult[] {
  return [
    easyApplyNeutral(corpus),
    consentInterruptNeutral(corpus),
    unknownPayNeutral(corpus),
    foreignPayNeutral(corpus),
    belowPayRanksLower(corpus),
    requiredEvidenceMonotonic(corpus),
    exactRoleBeatsWrongFamily(corpus),
    hardConflictNeverUnqualified(corpus),
    cardOnlyRequiresReview(corpus),
    misleadingSalesTitleBelowRealRole(corpus),
    remoteGeographyTruth(corpus),
    clearanceUnknownRequiresReview(corpus),
    keywordStuffingCannotRescueWrongFamily(corpus),
    preferredCompanyBounded(corpus),
    negativeEvidenceIsSupportable(corpus),
    sessionSemanticEquivalence(corpus),
    reversedInputStability(corpus),
    talentPoolNotActionable(corpus),
    earlyCareersProgrammeExcludesSeniorProfile(corpus),
  ];
}
