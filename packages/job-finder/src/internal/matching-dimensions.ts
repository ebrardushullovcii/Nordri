import {
  assessJobPostingDetailQuality,
  type JobRequirementAssessment,
  type JobSearchPreferences,
  type MatchDimensionEvidence,
  type MatchDimensionsAssessment,
} from "@nordri/contracts";

import { resolvePostingSeniority } from "./posting-seniority";
import type { MatchAssessmentPostingInput } from "./match-assessment-posting-input";
import type {
  LocationCompatibilityState,
  WorkModeCompatibilityState,
} from "./matching";
import { isAbsentFieldText, normalizeText } from "./shared";
import { collapseRepeatedLocationTokens } from "./listing-field-shapes";

export type BuildMatchDimensionsAssessmentInput = {
  posting: MatchAssessmentPostingInput;
  searchPreferences: JobSearchPreferences;
  requirements: readonly JobRequirementAssessment[];
  matchesRole: boolean;
  roleFamilyMismatch: boolean;
  roleFamilyUnclear: boolean;
  locationCompatibility: LocationCompatibilityState;
  /**
   * The listing is remote and remote is a preferred work mode, so the place
   * comparison was settled by the work-mode preference instead of the city.
   */
  locationRemotePreferenceApplied?: boolean;
  workModeCompatibility: WorkModeCompatibilityState;
  isPreferredCompany: boolean;
};

/**
 * How much of the listing this panel may claim was read.
 *
 * `assessJobPostingDetailQuality` is the one shared rule for that question, so
 * the depth row states what the posting's own fields support rather than
 * repeating a stored label that may have been written before the body was
 * (or was not) fetched. The wording stays the existing three-value
 * vocabulary the score panel already turns into sentences.
 */
function describeListingDetailDepth(
  posting: MatchAssessmentPostingInput,
): string {
  const assessed = assessJobPostingDetailQuality({
    title: posting.title,
    company: posting.company,
    description: posting.description,
    keySkills: posting.keySkills,
    responsibilities: posting.responsibilities,
    minimumQualifications: posting.minimumQualifications,
    preferredQualifications: posting.preferredQualifications,
    benefits: posting.benefits,
  });
  // Never claims more than the stored label, and never more than the text
  // supports: the weaker of the two wins.
  const order: Record<string, number> = {
    card_only: 0,
    partial_detail: 1,
    detail_enriched: 2,
  };
  const claimed =
    (order[assessed] ?? 0) <= (order[posting.detailQuality] ?? 0)
      ? assessed
      : posting.detailQuality;
  return claimed.replaceAll("_", " ");
}

// Absence placeholders are shared across boards, so both labels use the one
// source-generic rule instead of a per-phrase pattern.
function displayEmployerLabel(company: string): string | null {
  const trimmed = company.trim();
  return isAbsentFieldText(trimmed) ? null : trimmed;
}

function displayLocationLabel(location: string): string | null {
  const trimmed = location.trim();
  if (isAbsentFieldText(trimmed)) {
    return null;
  }
  // "Anywhere, Anywhere, Anywhere compared with Philadelphia, PA: aligned."
  // is one place stated three times. The repeats carry nothing and made the
  // comparison read as though the listing named three separate areas, so the
  // sentence is built from the distinct parts in their original order.
  return collapseRepeatedLocationTokens(trimmed) || null;
}

function clip(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trim()}…`;
}

function evidence(
  source: MatchDimensionEvidence["source"],
  label: string,
  detail: string,
): MatchDimensionEvidence {
  return {
    source,
    label: clip(label, 120),
    detail: clip(detail, 240),
  };
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.slice(0, 4).join(", ") : "None saved";
}

function buildRoleSuitability(
  input: BuildMatchDimensionsAssessmentInput,
): MatchDimensionsAssessment["roleSuitability"] {
  const { posting, searchPreferences } = input;
  const roleEvidence = [
    evidence("listing", "Listing title", posting.title),
    ...(searchPreferences.targetRoles.length > 0
      ? [
          evidence(
            "preference",
            "Saved target roles",
            formatList(searchPreferences.targetRoles),
          ),
        ]
      : []),
  ];

  const requiredCoreRequirements = input.requirements.filter(
    (requirement) =>
      requirement.importance === "required" &&
      (requirement.category === "skill" ||
        requirement.category === "domain" ||
        requirement.category === "experience"),
  );
  const requiredCoreConflict =
    requiredCoreRequirements.find(
      (requirement) => requirement.status === "conflict",
    ) ??
    input.requirements.find(
      (requirement) =>
        requirement.importance === "required" &&
        // Career stage ("this opening is reserved for graduates") and work
        // authorization are hard eligibility facts about the opening itself,
        // so a conflict in either makes the role unsuitable even when every
        // skill lines up.
        (requirement.category === "work_authorization" ||
          requirement.category === "seniority") &&
        requirement.status === "conflict",
    );
  const unsupportedRequiredCore = requiredCoreRequirements.find(
    (requirement) => requirement.status !== "supported",
  );
  const withRequirementEvidence = (
    requirement: JobRequirementAssessment,
  ): MatchDimensionEvidence[] =>
    [
      ...roleEvidence,
      evidence(
        "listing",
        `Required: ${requirement.label}`,
        `${requirement.status.replaceAll("_", " ")}: ${requirement.jobEvidence}`,
      ),
    ].slice(0, 4);

  if (input.roleFamilyMismatch || requiredCoreConflict) {
    return {
      state: "conflict",
      // The requirement already states the conflict in its own words; a
      // generic "conflicts with the saved profile evidence" sentence would
      // hide the reason the user actually needs.
      explanation: requiredCoreConflict
        ? clip(requiredCoreConflict.explanation, 320)
        : "The listing belongs to a different role family than the saved target roles.",
      evidence: requiredCoreConflict
        ? withRequirementEvidence(requiredCoreConflict)
        : roleEvidence,
    };
  }

  if (searchPreferences.targetRoles.length === 0) {
    return {
      state: "unknown",
      explanation:
        "No target roles are saved, so there is nothing to compare the listing title with.",
      evidence: roleEvidence,
    };
  }

  if (
    input.matchesRole &&
    requiredCoreRequirements.length > 0 &&
    !unsupportedRequiredCore
  ) {
    return {
      state: "exact",
      explanation:
        "The listing title matches a saved target role and its detected required core evidence is supported.",
      evidence: roleEvidence,
    };
  }

  if (input.matchesRole) {
    const listingBodyWasRead =
      input.posting.detailQuality !== "card_only" &&
      assessJobPostingDetailQuality(input.posting) !== "card_only";
    return {
      state: "adjacent",
      explanation: unsupportedRequiredCore
        ? `The title matches, but your saved profile does not yet show ${unsupportedRequiredCore.label.toLowerCase()}.`
        : listingBodyWasRead
          ? "The title matches and the listing body was read, but it did not state a required core skill clearly enough to compare."
          : "The title matches, but the listing text was not captured, so nothing beyond the title could be checked.",
      evidence: unsupportedRequiredCore
        ? withRequirementEvidence(unsupportedRequiredCore)
        : roleEvidence,
    };
  }

  if (input.roleFamilyUnclear) {
    return {
      state: "unknown",
      explanation:
        "The listing title does not say enough about the kind of work for a reliable comparison.",
      evidence: roleEvidence,
    };
  }

  return {
    state: "adjacent",
    explanation:
      "The listing title is related to the saved target roles, but it is not a direct title match.",
    evidence: roleEvidence,
  };
}

function buildPreferenceAlignment(
  input: BuildMatchDimensionsAssessmentInput,
): MatchDimensionsAssessment["preferenceAlignment"] {
  const { posting, searchPreferences } = input;
  const hasLocationPreference = searchPreferences.locations.length > 0;
  const hasWorkModePreference = searchPreferences.workModes.length > 0;
  const hasCompanyPreference = searchPreferences.companyWhitelist.length > 0;
  const statedSeniority = resolvePostingSeniority(posting);
  const hasSeniorityPreference = searchPreferences.seniorityLevels.length > 0;
  const hasEmploymentTypePreference =
    searchPreferences.employmentTypes.length > 0;
  const senioritySignal = hasSeniorityPreference
    ? statedSeniority
      ? searchPreferences.seniorityLevels.some(
          (seniority) =>
            normalizeText(seniority) === normalizeText(statedSeniority),
        )
      : null
    : undefined;
  const employmentTypeSignal = hasEmploymentTypePreference
    ? posting.employmentType
      ? searchPreferences.employmentTypes.some(
          (employmentType) =>
            normalizeText(employmentType) ===
            normalizeText(posting.employmentType!),
        )
      : null
    : undefined;
  const facets: Array<{
    signal: boolean | null;
    evidence: MatchDimensionEvidence;
  }> = [];

  if (hasLocationPreference) {
    const locationLabel = displayLocationLabel(posting.location);
    const locationSignal =
      input.locationCompatibility === "compatible"
        ? true
        : input.locationCompatibility === "incompatible"
          ? false
          : null;
    facets.push({
      signal: locationSignal,
      evidence: evidence(
        "preference",
        "Location comparison",
        input.locationRemotePreferenceApplied
          ? input.locationCompatibility === "compatible"
            ? "Remote listing; remote is one of your preferred work modes."
            : `Remote listing; remote is one of your preferred work modes, but its stated region (${locationLabel ?? "not stated"}) may exclude ${formatList(searchPreferences.locations)}.`
          : input.locationCompatibility === "compatible"
            ? `${locationLabel ?? "The listing location"} compared with ${formatList(searchPreferences.locations)}: aligned.`
            : input.locationCompatibility === "incompatible"
              ? `${locationLabel ?? "The listing location"} compared with ${formatList(searchPreferences.locations)}: outside the saved areas.`
              : `The listing does not specify enough geography to compare with ${formatList(searchPreferences.locations)}.`,
      ),
    });
  }

  if (hasWorkModePreference) {
    facets.push({
      signal:
        input.workModeCompatibility === "compatible"
          ? true
          : input.workModeCompatibility === "conflict"
            ? false
            : null,
      evidence: evidence(
        "preference",
        "Work-mode comparison",
        input.workModeCompatibility === "compatible"
          ? `${formatList(posting.workMode)} compared with ${formatList(searchPreferences.workModes)}: aligned.`
          : input.workModeCompatibility === "conflict"
            ? `${formatList(posting.workMode)} compared with ${formatList(searchPreferences.workModes)}: not aligned.`
            : `The listing does not state a concrete work mode comparable with ${formatList(searchPreferences.workModes)}.`,
      ),
    });
  }

  if (hasCompanyPreference) {
    const employerLabel = displayEmployerLabel(posting.company);
    facets.push({
      signal: input.isPreferredCompany ? true : null,
      evidence: evidence(
        "preference",
        "Preferred-company comparison",
        input.isPreferredCompany
          ? `${employerLabel ?? "This employer"} is on the saved preferred-company list.`
          : employerLabel
            ? `${employerLabel} is not on the saved preferred-company list; this is neutral, not a conflict.`
            : "The listing employer is not on the saved preferred-company list; this is neutral, not a conflict.",
      ),
    });
  }

  if (senioritySignal !== undefined) {
    facets.push({
      signal: senioritySignal,
      evidence: evidence(
        "preference",
        "Seniority comparison",
        statedSeniority
          ? `${statedSeniority} compared with ${formatList(searchPreferences.seniorityLevels)}: ${senioritySignal ? "aligned" : "not aligned"}.`
          : `The listing does not state seniority; saved levels are ${formatList(searchPreferences.seniorityLevels)}.`,
      ),
    });
  }

  if (employmentTypeSignal !== undefined) {
    facets.push({
      signal: employmentTypeSignal,
      evidence: evidence(
        "preference",
        "Employment-type comparison",
        posting.employmentType
          ? `${posting.employmentType} compared with ${formatList(searchPreferences.employmentTypes)}: ${employmentTypeSignal ? "aligned" : "not aligned"}.`
          : `The listing does not state employment type; saved types are ${formatList(searchPreferences.employmentTypes)}.`,
      ),
    });
  }

  if (facets.length === 0) {
    return {
      state: "not_configured",
      explanation:
        "No location, work-mode, seniority, employment-type, or preferred-company constraints are saved.",
      evidence: [],
    };
  }

  const alignedCount = facets.filter((facet) => facet.signal === true).length;
  const conflictCount = facets.filter((facet) => facet.signal === false).length;
  const unknownCount = facets.filter((facet) => facet.signal === null).length;
  const preferenceEvidence = facets
    .sort((left, right) => {
      const rank = (signal: boolean | null) =>
        signal === false ? 0 : signal === null ? 1 : 2;
      return rank(left.signal) - rank(right.signal);
    })
    .slice(0, 4)
    .map((facet) => facet.evidence);

  if (conflictCount > 0 && (alignedCount > 0 || unknownCount > 0)) {
    return {
      state: "mixed",
      explanation:
        "Some configured preferences align or remain unknown while others conflict with the listing.",
      evidence: preferenceEvidence,
    };
  }

  if (conflictCount > 0) {
    return {
      state: "conflict",
      explanation:
        "The listing conflicts with one or more configured search preferences.",
      evidence: preferenceEvidence,
    };
  }

  if (alignedCount > 0 && unknownCount > 0) {
    return {
      state: "mixed",
      explanation:
        "Some configured preferences align, while other listing fields are missing or neutral.",
      evidence: preferenceEvidence,
    };
  }

  if (alignedCount > 0) {
    return {
      state: "aligned",
      explanation: "The listing aligns with the configured search preferences.",
      evidence: preferenceEvidence,
    };
  }

  return {
    state: "unknown",
    explanation:
      "The configured preferences could not be compared or are neutral rather than conflicting.",
    evidence: preferenceEvidence,
  };
}
function buildApplicationEffort(
  input: BuildMatchDimensionsAssessmentInput,
): MatchDimensionsAssessment["applicationEffort"] {
  const { posting } = input;
  const effortEvidence = [
    evidence(
      "listing",
      "Application path",
      posting.applyPath.replaceAll("_", " "),
    ),
  ];

  if (posting.screeningHints.requiresConsentInterrupt === true) {
    const kind = posting.screeningHints.requiresConsentInterruptKind;
    effortEvidence.push(
      evidence(
        "listing",
        "User-action checkpoint",
        kind
          ? `The listing signals a ${kind.replaceAll("_", " ")} step.`
          : "The listing signals an account or verification step.",
      ),
    );
    return {
      level: "high",
      explanation:
        "The application path requires an account, decision, or verification step that needs user action.",
      evidence: effortEvidence,
    };
  }

  if (posting.applyPath === "easy_apply" && posting.easyApplyEligible) {
    effortEvidence.push(
      evidence(
        "derived",
        "Easy Apply signal",
        "Both application-path fields confirm an in-platform Easy Apply route.",
      ),
    );
    return {
      level: "low",
      explanation:
        "The listing consistently exposes an in-platform application path with fewer expected handoff steps.",
      evidence: effortEvidence,
    };
  }

  if (
    (posting.applyPath === "easy_apply" && !posting.easyApplyEligible) ||
    (posting.applyPath !== "easy_apply" && posting.easyApplyEligible)
  ) {
    effortEvidence.push(
      evidence(
        "derived",
        "Inconsistent path signal",
        "The application path and Easy Apply eligibility fields disagree.",
      ),
    );
    return {
      level: "unknown",
      explanation:
        "The listing exposes inconsistent application-path signals, so effort is not inferred.",
      evidence: effortEvidence,
    };
  }

  if (posting.applyPath === "external_redirect") {
    return {
      level: "moderate",
      explanation:
        "The application redirects to an employer or ATS form, which usually requires more review and form entry.",
      evidence: effortEvidence,
    };
  }

  return {
    level: "unknown",
    explanation:
      "The listing does not expose a reliable application path, so effort cannot be estimated yet.",
    evidence: effortEvidence,
  };
}

function buildEvidenceConfidence(
  input: BuildMatchDimensionsAssessmentInput,
): MatchDimensionsAssessment["evidenceConfidence"] {
  const counts = {
    supportedCount: 0,
    partialCount: 0,
    missingCount: 0,
    unknownCount: 0,
    conflictCount: 0,
  };
  const evidenceRequirements = input.requirements.filter(
    (requirement) =>
      requirement.category !== "location" &&
      requirement.category !== "work_mode",
  );
  const unverifiedPreferences = input.requirements.filter(
    (requirement) =>
      (requirement.category === "location" ||
        requirement.category === "work_mode") &&
      requirement.status === "unknown",
  );
  const unverifiedPreferenceNote =
    unverifiedPreferences.length > 0
      ? ` Your saved ${unverifiedPreferences
          .map((requirement) =>
            requirement.category === "work_mode" ? "work-mode" : "location",
          )
          .join(
            " and ",
          )} preference could not be confirmed against this listing.`
      : "";

  // Saved location/work-mode comparisons are preference checks, not proof that
  // the listing exposes enough role evidence for a reliable fit decision.
  for (const requirement of evidenceRequirements) {
    switch (requirement.status) {
      case "supported":
        counts.supportedCount += 1;
        break;
      case "partial":
        counts.partialCount += 1;
        break;
      case "missing":
        counts.missingCount += 1;
        break;
      case "unknown":
        counts.unknownCount += 1;
        break;
      case "conflict":
        counts.conflictCount += 1;
        break;
    }
  }

  const total = evidenceRequirements.length;
  const supportableCount = total - counts.unknownCount;
  const supportableRatio = total > 0 ? supportableCount / total : 0;
  const evidenceRows = [
    evidence(
      "listing",
      "Listing detail depth",
      // Re-derived from the text actually in hand rather than echoed from the
      // stored label. A row whose `detailQuality` was set optimistically
      // upstream printed "The full listing detail was available." directly
      // above "the listing text was not captured"; the depth this panel
      // claims is now the same reading of the same body the capture state
      // makes, so the two lines cannot contradict each other.
      describeListingDetailDepth(input.posting),
    ),
    evidence(
      "derived",
      "Requirement supportability",
      total === 0
        ? "No requirements were extracted for comparison."
        : `${supportableCount} of ${total} role or eligibility requirements have explicit positive or negative evidence.`,
    ),
  ];

  if (total === 0 && input.posting.detailQuality === "card_only") {
    return {
      level: "unavailable",
      explanation:
        "Only the search-result card was available, so no requirements could be checked. This describes how much was read, not how good the job is.",
      evidence: evidenceRows,
      ...counts,
    };
  }

  if (
    input.posting.detailQuality === "detail_enriched" &&
    total >= 2 &&
    supportableRatio >= 0.75
  ) {
    return {
      level: "high",
      // Names the scope ("role requirements") and any saved preference that
      // stayed unverified, so "5 of 5 checked" no longer reads as "remote was
      // confirmed" when the work-mode row is the one that could not be.
      explanation: `The listing body was read and ${counts.supportedCount + counts.partialCount + counts.missingCount + counts.conflictCount} of ${total} role requirements were checked. A gap that was found still counts against the fit.${unverifiedPreferenceNote}`,
      evidence: evidenceRows,
      ...counts,
    };
  }

  if (input.posting.detailQuality === "detail_enriched" && total === 0) {
    return {
      level: "moderate",
      explanation:
        "The listing body was read, but it did not expose structured requirements to compare one by one. The fit still uses the readable role and listing evidence; nothing missing is assumed.",
      evidence: evidenceRows,
      ...counts,
    };
  }

  if (
    input.posting.detailQuality !== "card_only" &&
    total > 0 &&
    supportableRatio >= 0.5
  ) {
    return {
      level: "moderate",
      explanation:
        "Several requirements could be checked, but some evidence is still incomplete. This describes how much was read, not how good the job is.",
      evidence: evidenceRows,
      ...counts,
    };
  }

  return {
    level: "low",
    explanation:
      "Not much of the listing could be read, so few requirements could be checked. Gaps that were found are kept; nothing else is assumed.",
    evidence: evidenceRows,
    ...counts,
  };
}

export function buildMatchDimensionsAssessment(
  input: BuildMatchDimensionsAssessmentInput,
): MatchDimensionsAssessment {
  return {
    roleSuitability: buildRoleSuitability(input),
    preferenceAlignment: buildPreferenceAlignment(input),
    applicationEffort: buildApplicationEffort(input),
    evidenceConfidence: buildEvidenceConfidence(input),
  };
}
