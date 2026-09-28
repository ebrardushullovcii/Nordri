import {
  ResumeImportFieldCandidateDraftSchema,
  type ResumeImportFieldCandidateDraft,
} from "@nordri/contracts";

import { uniqueStrings } from "./deterministic/utils";

const supportedResumeExperienceWorkModes = new Set([
  "remote",
  "hybrid",
  "onsite",
  "flexible",
]);

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toCandidateStringArray(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return uniqueStrings(
    values.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry] : [],
    ),
  );
}

function normalizeComparableRecordValue(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function experienceStageCandidatesMatch(
  primary: ResumeImportFieldCandidateDraft,
  fallback: ResumeImportFieldCandidateDraft,
): boolean {
  const primaryValue = primary.value;
  const fallbackValue = fallback.value;
  if (!isRecordValue(primaryValue) || !isRecordValue(fallbackValue)) {
    return false;
  }

  const matchingIdentityFields = ["companyName", "title", "startDate"].filter(
    (key) => {
      const primaryField = normalizeComparableRecordValue(primaryValue[key]);
      const fallbackField = normalizeComparableRecordValue(fallbackValue[key]);
      return primaryField.length > 0 && primaryField === fallbackField;
    },
  ).length;

  if (matchingIdentityFields >= 2) {
    return true;
  }

  return (
    matchingIdentityFields >= 1 &&
    Boolean(primary.target.recordId) &&
    primary.target.recordId === fallback.target.recordId
  );
}

export function supplementExperienceStageCandidates(
  primaryCandidates: readonly ResumeImportFieldCandidateDraft[],
  fallbackCandidates: readonly ResumeImportFieldCandidateDraft[],
): ResumeImportFieldCandidateDraft[] {
  const availableFallbacks = fallbackCandidates.filter(
    (candidate) =>
      candidate.target.section === "experience" &&
      candidate.target.key === "record" &&
      candidate.sourceBlockIds.length > 0,
  );

  return primaryCandidates.map((candidate) => {
    if (
      candidate.target.section !== "experience" ||
      candidate.target.key !== "record" ||
      !isRecordValue(candidate.value)
    ) {
      return candidate;
    }

    const fallback = availableFallbacks.find((candidateFallback) =>
      experienceStageCandidatesMatch(candidate, candidateFallback),
    );

    if (!fallback || !isRecordValue(fallback.value)) {
      return candidate;
    }

    const primarySkills = toCandidateStringArray(candidate.value.skills);
    const fallbackSkills = toCandidateStringArray(fallback.value.skills);
    const mergedSkills = uniqueStrings([...primarySkills, ...fallbackSkills]);
    const primaryWorkModes = toCandidateStringArray(candidate.value.workMode)
      .map((value) => value.toLowerCase())
      .filter((value) => supportedResumeExperienceWorkModes.has(value));
    const fallbackWorkModes = toCandidateStringArray(fallback.value.workMode)
      .map((value) => value.toLowerCase())
      .filter((value) => supportedResumeExperienceWorkModes.has(value));
    const mergedWorkModes =
      primaryWorkModes.length > 0 ? primaryWorkModes : fallbackWorkModes;
    const addedSkills = mergedSkills.length > primarySkills.length;
    const addedWorkMode =
      primaryWorkModes.length === 0 && mergedWorkModes.length > 0;

    if (!addedSkills && !addedWorkMode) {
      return candidate;
    }

    const mergedValue = {
      ...candidate.value,
      skills: mergedSkills,
      workMode: mergedWorkModes,
    };

    return ResumeImportFieldCandidateDraftSchema.parse({
      ...candidate,
      value: mergedValue,
      normalizedValue: mergedValue,
      sourceBlockIds: uniqueStrings([
        ...candidate.sourceBlockIds,
        ...fallback.sourceBlockIds,
      ]),
      notes: uniqueStrings([
        ...candidate.notes,
        "Grounded work mode and role-specific skills were completed from the deterministic document pass.",
      ]),
    });
  });
}
