import type {
  JobFinderWorkspaceSnapshot,
  ProfileCopilotContext,
  ProfileCopilotPatchOperation,
  ResumeApproach,
} from "@unemployed/contracts";
import { formatStatusLabel } from "../../lib/job-finder-utils";
import { formatProfileSetupStepLabel } from "./setup/profile-setup-steps";

function getDiscoveryTargetCount(
  operation: ProfileCopilotPatchOperation,
): number | null {
  if (operation.operation !== "replace_search_preferences_fields") {
    return null;
  }

  const discoveryValue = operation.value.discovery;
  return discoveryValue ? discoveryValue.targets.length : null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value,
  );
}

function formatProposedValue(value: unknown): string {
  if (value === null) {
    return "cleared";
  }

  if (typeof value === "string") {
    return `“${value}”`;
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "none";
    }

    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (typeof item === "number") {
          return formatNumber(item);
        }

        if (typeof item === "boolean") {
          return item ? "yes" : "no";
        }

        return "updated item";
      })
      .join(", ");
  }

  return "updated details";
}

function describeFieldChanges(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, proposedValue]) => {
      const fieldLabel = humanizeFieldKey(key);

      if (proposedValue === null) {
        return `Clear ${fieldLabel}`;
      }

      return `Set ${fieldLabel} to ${formatProposedValue(proposedValue)}`;
    })
    .join("; ");
}

function humanizeFieldKey(key: string): string {
  switch (key) {
    case "targetSalaryUsd":
      return "expected salary";
    case "minimumSalaryUsd":
      return "minimum salary";
    case "workModes":
      return "work modes";
    case "targetRoles":
      return "target roles";
    case "yearsExperience":
      return "years of experience";
    case "linkedinUrl":
      return "LinkedIn URL";
    case "portfolioUrl":
      return "portfolio URL";
    case "currentLocation":
      return "current location";
    case "preferredEmail":
      return "preferred email";
    case "preferredPhone":
      return "preferred phone";
    case "professionalStory":
      return "professional story";
    case "nextChapterSummary":
      return "next chapter summary";
    case "careerTransitionSummary":
      return "career transition summary";
    case "selfIntroduction":
      return "self-introduction";
    case "visaSponsorship":
      return "visa sponsorship";
    case "authorizedWorkCountries":
      return "authorized work countries";
    case "requiresVisaSponsorship":
      return "requires visa sponsorship";
    case "remoteEligible":
      return "remote eligible";
    case "willingToRelocate":
      return "willing to relocate";
    case "willingToTravel":
      return "willing to travel";
    case "availableStartDate":
      return "available start date";
    case "jobFamilies":
      // The Preferences control this field belongs to is called "Related role
      // areas"; the trade name never reaches a screen.
      return "related role areas";
    default:
      return key
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase();
  }
}

export function getProfileCopilotContextLabel(
  context: ProfileCopilotContext,
): string {
  if (context.surface === "setup") {
    // Name the step the way the step tabs do ("Basics", not "Essentials").
    return `Setup - ${formatProfileSetupStepLabel(context.step)}`;
  }

  if (context.surface === "profile") {
    return `Profile - ${formatStatusLabel(context.section)}`;
  }

  return "Profile";
}

export function getPatchGroupBadgeVariant(
  applyMode: JobFinderWorkspaceSnapshot["profileCopilotMessages"][number]["patchGroups"][number]["applyMode"],
): "default" | "outline" | "destructive" {
  if (applyMode === "applied") {
    return "default";
  }

  return applyMode === "rejected" ? "destructive" : "outline";
}

/**
 * The resume level in the words Settings > AI behavior > Resumes uses, so a
 * card that changes it reads like the choice it changes.
 */
const RESUME_LEVEL_CARD_LABEL: Record<ResumeApproach, string> = {
  original_resume: "Original (your imported file, unchanged)",
  conservative: "Light (small edits, every fact kept)",
  balanced: "Tailored (a fuller rewrite, every fact kept)",
  aggressive: "Aggressive (may stretch, with your say-so)",
};

export function describePatchOperation(
  operation: ProfileCopilotPatchOperation,
): string {
  switch (operation.operation) {
    case "replace_identity_fields":
    case "replace_work_eligibility_fields":
    case "replace_professional_summary_fields":
    case "replace_narrative_fields":
    case "replace_answer_bank_fields":
    case "replace_application_identity_fields":
    case "replace_skill_group_fields":
    case "replace_profile_list_fields":
    case "replace_search_preferences_fields": {
      const keys = Object.keys(operation.value);
      const discoveryTargetCount = getDiscoveryTargetCount(operation);

      if (
        keys.length === 1 &&
        keys[0] === "discovery" &&
        discoveryTargetCount !== null
      ) {
        return `Update job sources (${discoveryTargetCount} target${discoveryTargetCount === 1 ? "" : "s"})`;
      }

      return describeFieldChanges(operation.value);
    }
    case "replace_compensation_preferences_fields": {
      const { currency, currencyStatus, interval, maximum, minimum } =
        operation.value;
      const hasMinimum = Object.prototype.hasOwnProperty.call(
        operation.value,
        "minimum",
      );
      const hasMaximum = Object.prototype.hasOwnProperty.call(
        operation.value,
        "maximum",
      );
      const minimumIsNull = hasMinimum && minimum === null;
      const maximumIsNull = hasMaximum && maximum === null;
      const minimumIsNumber = hasMinimum && typeof minimum === "number";
      const maximumIsNumber = hasMaximum && typeof maximum === "number";

      const currencyLabel =
        currencyStatus === "needs_clarification"
          ? "currency not set — confirmation needed"
          : (currency ?? "saved currency");
      const intervalLabel = interval ?? "saved interval";

      if (minimumIsNull && maximumIsNull) {
        return `Clear compensation range / ${intervalLabel} (${currencyLabel})`;
      }

      if (minimumIsNull && maximumIsNumber) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        return `Clear compensation minimum and set maximum to ${formatNumber(maximum as number)} / ${intervalLabel} (${currencyLabel})`;
      }

      if (maximumIsNull && minimumIsNumber) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        return `Clear compensation maximum and set minimum to ${formatNumber(minimum as number)} / ${intervalLabel} (${currencyLabel})`;
      }

      if (minimumIsNull) {
        return `Clear compensation minimum / ${intervalLabel} (${currencyLabel})`;
      }

      if (maximumIsNull) {
        return `Clear compensation maximum / ${intervalLabel} (${currencyLabel})`;
      }

      const hasInterval = Object.prototype.hasOwnProperty.call(
        operation.value,
        "interval",
      );
      const hasCurrency = Object.prototype.hasOwnProperty.call(
        operation.value,
        "currency",
      );
      const hasCurrencyStatus = Object.prototype.hasOwnProperty.call(
        operation.value,
        "currencyStatus",
      );

      if (!minimumIsNumber && !maximumIsNumber) {
        const detailParts: string[] = [];

        if (hasInterval && interval != null) {
          detailParts.push(`interval to ${intervalLabel}`);
        }

        if (hasCurrency && currency !== null && currency !== undefined) {
          detailParts.push(`currency to ${currency}`);
        } else if (
          hasCurrencyStatus &&
          currencyStatus === "needs_clarification"
        ) {
          detailParts.push("currency to not set");
        } else if (hasCurrency && currency === null) {
          detailParts.push("currency cleared");
        }

        if (detailParts.length > 0) {
          return `Update compensation ${detailParts.join(" and ")} (${currencyLabel})`;
        }
      }

      if (minimumIsNumber && maximumIsNumber) {
        return `Set minimum compensation to ${formatNumber(minimum)} and target compensation to ${formatNumber(maximum)} / ${intervalLabel} (${currencyLabel})`;
      }
      if (minimumIsNumber) {
        return `Set minimum compensation to ${formatNumber(minimum)} / ${intervalLabel} (${currencyLabel})`;
      }
      if (maximumIsNumber) {
        return `Set target compensation to ${formatNumber(maximum)} / ${intervalLabel} (${currencyLabel})`;
      }
      return `Update compensation / ${intervalLabel} (${currencyLabel})`;
    }
    case "remove_profile_list_entries": {
      // The confirmation card quotes what would go, so nothing disappears
      // without the person reading it first.
      const listLabel =
        operation.field === "targetRoles"
          ? "target role"
          : operation.field === "locations"
            ? "location"
            : "skill";
      const plural = operation.values.length === 1 ? "" : "s";
      return `Remove ${listLabel}${plural}: ${operation.values.join(", ")}`;
    }
    case "upsert_experience_record":
      return `Add or update experience: ${operation.record.title ?? operation.record.companyName ?? "record"}`;
    case "remove_experience_record":
      return `Remove experience record ${operation.recordId}`;
    case "upsert_education_record":
      return `Add or update education: ${operation.record.schoolName ?? operation.record.degree ?? "record"}`;
    case "remove_education_record":
      return `Remove education record ${operation.recordId}`;
    case "reorder_education_records":
      return `Reorder ${operation.orderedRecordIds.length} education records`;
    case "upsert_certification_record":
      return `Add or update certification: ${operation.record.name ?? "record"}`;
    case "remove_certification_record":
      return `Remove certification record ${operation.recordId}`;
    case "upsert_project_record":
      return `Add or update project: ${operation.record.name}`;
    case "remove_project_record":
      return `Remove project record ${operation.recordId}`;
    case "upsert_link_record":
      return `Add or update link: ${operation.record.label ?? operation.record.url ?? "record"}`;
    case "remove_link_record":
      return `Remove link record ${operation.recordId}`;
    case "upsert_language_record":
      return `Add or update language: ${operation.record.language}`;
    case "remove_language_record":
      return `Remove language record ${operation.recordId}`;
    case "upsert_proof_point":
      return `Add or update proof: ${operation.record.title}`;
    case "remove_proof_point":
      return `Remove proof record ${operation.recordId}`;
    case "upsert_reusable_answer":
      return `Add or update reusable answer: ${operation.record.label}`;
    case "remove_reusable_answer":
      return `Remove reusable answer ${operation.recordId}`;
    case "resolve_review_items":
      return `Resolve ${operation.reviewItemIds.length} review item${operation.reviewItemIds.length === 1 ? "" : "s"} as ${formatStatusLabel(operation.resolutionStatus)}`;
    case "set_resume_approach":
      return `Resume level for new jobs: ${RESUME_LEVEL_CARD_LABEL[operation.value]}`;
  }

  return "Update profile data";
}

/**
 * Derives undone patch groups from snapshot revision lineage without new IPC.
 * - Direct: an undo revision whose restoredFromRevisionId points to the assistant_patch revision for that patchGroupId.
 * - Indirect: an undo that restores to an earlier snapshot implicitly reverts intermediate patches (timestamp heuristic).
 *
 * Backend requirement for ideal truth without heuristics:
 * On undoProfileRevision the service should either mutate the originating profileCopilotMessage patchGroup
 * applyMode to a terminal 'undone'/'reverted' state or expose an explicit revertedPatchGroupIds set in the snapshot.
 * That eliminates timestamp inference and covers any non-linear lineage deterministically.
 */
export function getUndonePatchGroupIds(
  revisions: readonly JobFinderWorkspaceSnapshot["profileRevisions"][number][],
): Set<string> {
  const revisionById = new Map<
    string,
    JobFinderWorkspaceSnapshot["profileRevisions"][number]
  >();
  const assistantPatchRevByPatchGroupId = new Map<
    string,
    JobFinderWorkspaceSnapshot["profileRevisions"][number]
  >();

  for (const revision of revisions) {
    revisionById.set(revision.id, revision);

    if (revision.trigger === "assistant_patch" && revision.patchGroupId) {
      assistantPatchRevByPatchGroupId.set(revision.patchGroupId, revision);
    }
  }

  const undone = new Set<string>();

  for (const revision of revisions) {
    if (revision.trigger !== "undo" || !revision.restoredFromRevisionId) {
      continue;
    }

    const target = revisionById.get(revision.restoredFromRevisionId);

    if (!target) {
      continue;
    }

    if (target.patchGroupId && target.trigger === "assistant_patch") {
      undone.add(target.patchGroupId);
    }

    const targetTime = Date.parse(target.createdAt);
    const undoTime = Date.parse(revision.createdAt);

    if (Number.isNaN(targetTime) || Number.isNaN(undoTime)) {
      continue;
    }

    for (const [
      patchGroupId,
      patchRevision,
    ] of assistantPatchRevByPatchGroupId.entries()) {
      const patchTime = Date.parse(patchRevision.createdAt);

      if (Number.isNaN(patchTime)) {
        continue;
      }

      if (patchTime > targetTime && patchTime < undoTime) {
        undone.add(patchGroupId);
      }
    }
  }

  return undone;
}

export function getProfileCopilotDisplayContent(
  message: JobFinderWorkspaceSnapshot["profileCopilotMessages"][number],
  revisions?: readonly JobFinderWorkspaceSnapshot["profileRevisions"][number][],
): string {
  if (
    message.patchGroups.length === 0 ||
    message.patchGroups.every(
      (patchGroup) => patchGroup.applyMode === "needs_review",
    )
  ) {
    return message.content;
  }

  const originalAppliedCount = message.patchGroups.filter(
    (patchGroup) => patchGroup.applyMode === "applied",
  ).length;
  const rejectedCount = message.patchGroups.filter(
    (patchGroup) => patchGroup.applyMode === "rejected",
  ).length;
  const pendingCount =
    message.patchGroups.length - originalAppliedCount - rejectedCount;
  const contentWithoutPendingStatus = message.content
    .replace(/\s*Nothing changed yet\.?/giu, "")
    .trim();

  const undonePatchGroupIds = revisions
    ? getUndonePatchGroupIds(revisions)
    : new Set<string>();
  const undoneCount = message.patchGroups.filter(
    (patchGroup) =>
      patchGroup.applyMode === "applied" &&
      undonePatchGroupIds.has(patchGroup.id),
  ).length;
  const effectiveAppliedCount = originalAppliedCount - undoneCount;

  if (undoneCount > 0) {
    if (
      effectiveAppliedCount === 0 &&
      pendingCount === 0 &&
      rejectedCount === 0
    ) {
      return `${contentWithoutPendingStatus}\n\n**Current status:** ${undoneCount === 1 ? "This change was undone and is no longer applied to your profile." : "These changes were undone and are no longer applied to your profile."}`;
    }

    if (effectiveAppliedCount === 0 && pendingCount === 0) {
      return `${contentWithoutPendingStatus}\n\n**Current status:** All proposals resolved — ${undoneCount} undone and ${rejectedCount} rejected.`;
    }

    if (pendingCount === 0) {
      const rejectedSuffix =
        rejectedCount > 0 ? ` and ${rejectedCount} rejected` : "";

      return `${contentWithoutPendingStatus}\n\n**Current status:** All proposals resolved — ${effectiveAppliedCount} applied, ${undoneCount} undone${rejectedSuffix}.`;
    }

    const parts: string[] = [];

    if (effectiveAppliedCount > 0) {
      parts.push(`${effectiveAppliedCount} applied`);
    }

    if (undoneCount > 0) {
      parts.push(`${undoneCount} undone`);
    }

    parts.push(`${pendingCount} awaiting review`);

    if (rejectedCount > 0) {
      parts.push(`${rejectedCount} rejected`);
    }

    return `${contentWithoutPendingStatus}\n\n**Current status:** ${parts.join(", ")}.`;
  }

  const currentStatus =
    originalAppliedCount === message.patchGroups.length
      ? `**Current status:** ${originalAppliedCount === 1 ? "This change is" : "These changes are"} applied to your profile.`
      : rejectedCount === message.patchGroups.length
        ? `**Current status:** ${rejectedCount === 1 ? "This proposal was" : "These proposals were"} rejected. Your profile was not changed.`
        : pendingCount === 0
          ? `**Current status:** All proposals resolved — ${originalAppliedCount} applied and ${rejectedCount} rejected.`
          : `**Current status:** ${originalAppliedCount} applied, ${pendingCount} awaiting review${rejectedCount > 0 ? `, and ${rejectedCount} rejected` : ""}.`;

  return `${contentWithoutPendingStatus}\n\n${currentStatus}`;
}

export function getPatchGroupOperationSummary(
  patchGroup: JobFinderWorkspaceSnapshot["profileCopilotMessages"][number]["patchGroups"][number],
): string {
  const firstOperation = patchGroup.operations[0];

  if (!firstOperation) {
    return patchGroup.summary;
  }

  switch (firstOperation.operation) {
    case "replace_identity_fields":
    case "replace_work_eligibility_fields":
    case "replace_narrative_fields":
    case "replace_professional_summary_fields":
    case "replace_answer_bank_fields":
    case "replace_application_identity_fields":
    case "replace_skill_group_fields": {
      const keys = Object.keys(firstOperation.value);

      if (keys.length === 1 && keys[0] !== undefined) {
        return `Updated ${humanizeFieldKey(keys[0])}`;
      }

      return `Updated ${keys.length} profile fields`;
    }
    case "replace_search_preferences_fields": {
      const keys = Object.keys(firstOperation.value);

      if (keys.length === 1 && keys[0] === "discovery") {
        return patchGroup.summary;
      }

      if (keys.length === 1 && keys[0] !== undefined) {
        return `Updated ${humanizeFieldKey(keys[0])}`;
      }

      return `Updated ${keys.length} profile fields`;
    }
    case "replace_compensation_preferences_fields":
      return "Updated compensation preferences";
    case "upsert_experience_record":
      return `Suggested experience update: ${firstOperation.record.title ?? firstOperation.record.companyName ?? "record"}`;
    case "upsert_link_record":
      return `Suggested link update: ${firstOperation.record.label ?? firstOperation.record.url ?? "record"}`;
    default:
      return patchGroup.summary;
  }
}
