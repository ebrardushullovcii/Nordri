import {
  JobDiscoveryTargetSchema,
  JobFinderSettingsSchema,
  JobSearchPreferencesSchema,
  JobSourceAdapterKindSchema,
  ResumeDraftSchema,
  getResumeTemplateDeliveryLane,
  isResumeTemplateApplyEligible,
  type ApplicationAttempt,
  type ApplicationEvent,
  type ApplicationStatus,
  type CandidateProfile,
  type JobDiscoveryTarget,
  type JobFinderSettings,
  type JobSearchPreferences,
  type JobSource,
  type ResumeDraft,
  type ResumeTemplateDefinition,
  type SavedJob,
  type SourceInstructionArtifact,
  type TailoredAsset,
} from "@unemployed/contracts";
import {
  filterDiscoveryInstructionLines,
  filterSourceInstructionLines,
  prefixedLines,
} from "./source-instructions";
import { normalizeResumeDraftEntryOrdering } from "./resume-entry-ordering";
import { uniqueStrings } from "./shared";
import {
  DEFAULT_MAX_TARGET_ROLES,
  GENERIC_DEFAULT_TARGET_LABEL,
  LEGACY_DEFAULT_TARGET_ID,
  LEGACY_DEFAULT_TARGET_LABEL,
  LEGACY_DEFAULT_TARGET_STARTING_URL,
  PROFILE_PLACEHOLDER_HEADLINE,
  PROFILE_PLACEHOLDER_LOCATION,
  SOURCE_DEBUG_APP_SCHEMA_VERSION,
  SOURCE_DEBUG_PROMPT_PROFILE_VERSION,
  SOURCE_DEBUG_TOOLSET_VERSION,
} from "./workspace-defaults";

export function enrichSearchPreferencesFromProfile(
  searchPreferences: JobSearchPreferences,
  profile: CandidateProfile,
): JobSearchPreferences {
  const targetRoles = [...searchPreferences.targetRoles];

  if (targetRoles.length === 0) {
    for (const role of profile.targetRoles) {
      if (targetRoles.length < DEFAULT_MAX_TARGET_ROLES) {
        targetRoles.push(role);
      }
    }

    for (const experience of profile.experiences) {
      const experienceTitle = experience.title?.trim() ?? "";
      if (
        targetRoles.length < DEFAULT_MAX_TARGET_ROLES &&
        experienceTitle.length > 0
      ) {
        targetRoles.push(experienceTitle);
      }
    }

    if (
      targetRoles.length < DEFAULT_MAX_TARGET_ROLES &&
      profile.headline &&
      profile.headline !== PROFILE_PLACEHOLDER_HEADLINE
    ) {
      targetRoles.push(profile.headline);
    }
  }

  const locations = [...searchPreferences.locations];

  if (
    locations.length === 0 &&
    !searchPreferences.workModes.includes("remote") &&
    profile.currentLocation &&
    profile.currentLocation !== PROFILE_PLACEHOLDER_LOCATION
  ) {
    locations.push(profile.currentLocation);
  }

  if (targetRoles.length === 0 && locations.length === 0) {
    return searchPreferences;
  }

  return {
    ...searchPreferences,
    targetRoles: uniqueStrings(targetRoles),
    locations: uniqueStrings(locations),
  };
}

export function resolveAdapterKind(target: JobDiscoveryTarget): JobSource {
  JobSourceAdapterKindSchema.parse(target.adapterKind);
  return "target_site";
}

export function normalizeDiscoveryTarget(
  target: JobDiscoveryTarget,
): JobDiscoveryTarget {
  const isLegacyDefaultTarget =
    target.id === LEGACY_DEFAULT_TARGET_ID &&
    target.label === LEGACY_DEFAULT_TARGET_LABEL &&
    target.startingUrl === LEGACY_DEFAULT_TARGET_STARTING_URL;

  return JobDiscoveryTargetSchema.parse({
    ...target,
    adapterKind: "auto",
    label: isLegacyDefaultTarget ? GENERIC_DEFAULT_TARGET_LABEL : target.label,
  });
}

export function normalizeSearchPreferences(
  searchPreferences: JobSearchPreferences,
): JobSearchPreferences {
  return JobSearchPreferencesSchema.parse({
    ...searchPreferences,
    discovery: {
      ...searchPreferences.discovery,
      targets: searchPreferences.discovery.targets.map((target) =>
        normalizeDiscoveryTarget(target),
      ),
    },
  });
}

export function invalidateChangedSourceGuidance(
  currentSearchPreferences: JobSearchPreferences,
  nextSearchPreferences: JobSearchPreferences,
): JobSearchPreferences {
  const currentTargetsById = new Map(
    currentSearchPreferences.discovery.targets.map((target) => [
      target.id,
      target,
    ]),
  );

  return JobSearchPreferencesSchema.parse({
    ...nextSearchPreferences,
    discovery: {
      ...nextSearchPreferences.discovery,
      targets: nextSearchPreferences.discovery.targets.map((target) => {
        const currentTarget = currentTargetsById.get(target.id);
        if (
          !currentTarget ||
          currentTarget.startingUrl.trim() === target.startingUrl.trim()
        ) {
          return target;
        }

        return {
          ...target,
          instructionStatus: "missing",
          validatedInstructionId: null,
          draftInstructionId: null,
          lastDebugRunId: null,
          lastVerifiedAt: null,
          staleReason:
            "Starting page URL changed. Check this source again before reusing saved guidance.",
        };
      }),
    },
  });
}
export function normalizeJobFinderSettings(
  settings: JobFinderSettings,
  availableResumeTemplates: readonly ResumeTemplateDefinition[],
): JobFinderSettings {
  const isApplySafeTemplate = (template: ResumeTemplateDefinition) =>
    getResumeTemplateDeliveryLane(template) === "apply_safe" &&
    isResumeTemplateApplyEligible(template);
  const defaultApplySafeTemplate = availableResumeTemplates.find((template) =>
    isApplySafeTemplate(template),
  );
  const fallbackTemplateId = defaultApplySafeTemplate?.id ?? "classic_ats";
  const selectedTemplateAvailable = availableResumeTemplates.some(
    (template) =>
      template.id === settings.resumeTemplateId &&
      isApplySafeTemplate(template),
  );

  return JobFinderSettingsSchema.parse({
    ...settings,
    applicationAutomationMode:
      settings.applicationAutomationMode ?? "prepare_only",
    maxApplicationsPerLocalDay: settings.maxApplicationsPerLocalDay ?? 20,
    resumeApplicationMode: settings.resumeApplicationMode ?? "tailored_per_job",
    resumeFormat: "pdf",
    resumeTemplateId: selectedTemplateAvailable
      ? settings.resumeTemplateId
      : fallbackTemplateId,
  });
}

export function wasResumeDraftApproved(
  draft:
    | Pick<ResumeDraft, "status" | "approvedAt" | "approvedExportId">
    | null
    | undefined,
): boolean {
  return Boolean(
    draft?.status === "approved" ||
    draft?.approvedAt ||
    draft?.approvedExportId,
  );
}

export function normalizeResumeDraftTemplate(
  draft: ResumeDraft,
  availableResumeTemplates: readonly ResumeTemplateDefinition[],
): ResumeDraft {
  const fallbackTemplate = availableResumeTemplates[0] ?? {
    id: "classic_ats",
    label: "Chronology Classic",
  };
  const selectedTemplateAvailable = availableResumeTemplates.some(
    (template) => template.id === draft.templateId,
  );

  const orderedDraft = normalizeResumeDraftEntryOrdering(draft);

  if (selectedTemplateAvailable) {
    return orderedDraft;
  }

  const shouldClearApproval = wasResumeDraftApproved(draft);

  return ResumeDraftSchema.parse({
    ...orderedDraft,
    templateId: fallbackTemplate.id,
    status: shouldClearApproval ? "stale" : draft.status,
    approvedAt: shouldClearApproval ? null : draft.approvedAt,
    approvedExportId: shouldClearApproval ? null : draft.approvedExportId,
    staleReason: shouldClearApproval
      ? `This resume used a retired theme. Export a fresh ${fallbackTemplate.label} PDF before applying.`
      : draft.staleReason,
  });
}

export function getActiveDiscoveryTargets(
  searchPreferences: JobSearchPreferences,
): JobDiscoveryTarget[] {
  return searchPreferences.discovery.targets
    .map((target) => normalizeDiscoveryTarget(target))
    .filter((target) => target.enabled);
}

export function getPreferredSessionAdapter(
  searchPreferences: JobSearchPreferences,
): JobSource {
  const targets = getActiveDiscoveryTargets(searchPreferences);
  const preferredTarget = targets[0];

  return preferredTarget ? resolveAdapterKind(preferredTarget) : "target_site";
}

export function nextAssetVersion(
  existingAsset: TailoredAsset | undefined,
): string {
  if (!existingAsset) {
    return "v1";
  }

  const numericPortion = Number(existingAsset.version.replace(/^v/i, ""));

  if (Number.isNaN(numericPortion)) {
    return "v1";
  }

  return `v${numericPortion + 1}`;
}

// Per-application event history is capped at the newest 100 entries so
// repeated apply/retry cycles cannot grow workspace snapshots and DB rows
// without bound. This mirrors the newest-100 history retention already used
// for campaign dashboards and resume revision diffs. Dedupe still replaces
// same-ID events before the cap is applied, so retried checkpoints never
// consume extra history slots.
export const MAX_APPLICATION_EVENT_HISTORY = 100;

export function mergeEvents(
  existingEvents: readonly ApplicationEvent[],
  additionalEvents: readonly ApplicationEvent[],
): ApplicationEvent[] {
  const merged = new Map(existingEvents.map((event) => [event.id, event]));

  for (const event of additionalEvents) {
    merged.set(event.id, event);
  }

  return [...merged.values()]
    .sort(
      (left, right) =>
        new Date(right.at).getTime() - new Date(left.at).getTime(),
    )
    .slice(0, MAX_APPLICATION_EVENT_HISTORY);
}

export function toApplicationEvents(
  job: SavedJob,
  checkpoints: ApplicationAttempt["checkpoints"],
): ApplicationEvent[] {
  return checkpoints.map((checkpoint) => ({
    id: `event_${checkpoint.id}`,
    at: checkpoint.at,
    title: checkpoint.label,
    detail: `${checkpoint.detail} (${job.company})`,
    emphasis:
      checkpoint.state === "submitted"
        ? "positive"
        : checkpoint.state === "paused" || checkpoint.state === "unsupported"
          ? "warning"
          : checkpoint.state === "failed"
            ? "critical"
            : "neutral",
  }));
}

export function nextJobStatusFromAttempt(
  job: SavedJob,
  attemptState: ApplicationAttempt["state"],
): ApplicationStatus {
  switch (attemptState) {
    case "submitted":
      return "submitted";
    case "paused":
    case "unsupported":
    case "failed":
      return "approved";
    default:
      return job.status;
  }
}

export function buildSourceInstructionVersionInfo(adapterKind: JobSource) {
  return {
    promptProfileVersion: SOURCE_DEBUG_PROMPT_PROFILE_VERSION,
    toolsetVersion: SOURCE_DEBUG_TOOLSET_VERSION,
    adapterVersion: `${adapterKind}-adapter-v1`,
    appSchemaVersion: SOURCE_DEBUG_APP_SCHEMA_VERSION,
  };
}

export function buildInstructionGuidance(
  artifact: SourceInstructionArtifact | null,
): string[] {
  return buildGuidanceLines(artifact, filterSourceInstructionLines);
}

export function buildDiscoveryInstructionGuidance(
  artifact: SourceInstructionArtifact | null,
): string[] {
  return buildGuidanceLines(artifact, filterDiscoveryInstructionLines);
}

function buildGuidanceLines(
  artifact: SourceInstructionArtifact | null,
  filterLines: (values: readonly string[]) => string[],
): string[] {
  if (!artifact) {
    return [];
  }

  const navigationLines = filterLines(artifact.navigationGuidance);
  const searchLines = filterLines(artifact.searchGuidance);
  const detailLines = filterLines(artifact.detailGuidance);
  const applyLines = filterLines(artifact.applyGuidance);

  return uniqueStrings([
    ...prefixedLines("[Navigation] ", navigationLines),
    ...prefixedLines("[Search] ", searchLines),
    ...prefixedLines("[Detail] ", detailLines),
    ...prefixedLines("[Apply] ", applyLines),
  ]);
}

export function resolveActiveSourceInstructionArtifact(
  target: JobDiscoveryTarget,
  artifacts: readonly SourceInstructionArtifact[],
): SourceInstructionArtifact | null {
  const draftInstruction = target.draftInstructionId
    ? (artifacts.find(
        (artifact) =>
          artifact.id === target.draftInstructionId &&
          artifact.targetId === target.id &&
          artifact.status === "draft",
      ) ?? null)
    : null;

  if (draftInstruction) {
    return draftInstruction;
  }

  return target.validatedInstructionId
    ? (artifacts.find(
        (artifact) =>
          artifact.id === target.validatedInstructionId &&
          artifact.targetId === target.id &&
          artifact.status === "validated",
      ) ?? null)
    : null;
}

export function updateDiscoveryTarget(
  searchPreferences: JobSearchPreferences,
  targetId: string,
  updater: (target: JobDiscoveryTarget) => JobDiscoveryTarget,
): JobSearchPreferences {
  let found = false;
  const nextTargets = searchPreferences.discovery.targets.map((target) => {
    if (target.id !== targetId) {
      return target;
    }

    found = true;
    return updater(target);
  });

  if (!found) {
    throw new Error(`Unknown discovery target '${targetId}'.`);
  }

  return JobSearchPreferencesSchema.parse({
    ...searchPreferences,
    discovery: {
      ...searchPreferences.discovery,
      targets: nextTargets,
    },
  });
}
