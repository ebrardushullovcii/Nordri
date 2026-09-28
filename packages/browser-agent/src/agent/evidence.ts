import {
  AgentDebugFindingsSchema,
  SourceDebugVisualFindingSchema,
  JobPostingSchema,
  type SourceDebugPhase,
  SourceDebugPhaseEvidenceSchema,
  type JobPosting,
  type SourceDebugPhaseEvidence,
} from "@nordri/contracts";
import type { AgentResult, AgentState } from "../types";
import { uniqueStrings } from "../utils/string";
import {
  findDetailRouteIdSegment,
  repairExtractedJobTitle,
} from "./job-extraction";

const NOISE_TOKEN_RE =
  /\bdismiss\b|\bviewed\b|\bpromoted\b|\bwith verification\b/i;
const QUALITY_WEIGHTS = {
  titleLength: 6,
  companyLength: 4,
  locationLength: 2,
  keySkill: 8,
  responsibility: 6,
  minimumQualification: 6,
  preferredQualification: 4,
  easyApplyBonus: 10,
  titleNoisePenalty: 180,
  repeatedTitlePenalty: 360,
  companyNoisePenalty: 220,
  companyContainsTitlePenalty: 260,
  titleContainsCompanyPenalty: 120,
  shortTitlePenalty: 120,
} as const;

interface ToolExecutionResult {
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

export type ExtractedJobInput = Pick<
  JobPosting,
  | "sourceJobId"
  | "canonicalUrl"
  | "title"
  | "company"
  | "location"
  | "description"
  | "salaryText"
  | "summary"
  | "postedAt"
  | "workMode"
  | "applyPath"
  | "easyApplyEligible"
  | "keySkills"
> &
  Partial<
    Pick<
      JobPosting,
      | "postedAtText"
      | "providerUpdatedAt"
      | "responsibilities"
      | "minimumQualifications"
      | "preferredQualifications"
      | "seniority"
      | "employmentType"
      | "department"
      | "team"
      | "employerWebsiteUrl"
      | "employerDomain"
      | "benefits"
    >
  >;

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function summarizeJobInput(job: ExtractedJobInput): string {
  const firstStructuredLine =
    [
      ...(job.responsibilities ?? []),
      ...(job.minimumQualifications ?? []),
      ...(job.preferredQualifications ?? []),
    ][0] ?? null;

  if (firstStructuredLine) {
    return firstStructuredLine;
  }

  const description = job.description.trim();
  if (!description) {
    return `${job.title} opportunity at ${job.company}`;
  }

  const firstSentence = description
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .find(Boolean);

  return (firstSentence ?? description).slice(0, 280);
}

function findRepeatedLeadingPhrase(value: string): string | null {
  const words = trimToNull(value)?.split(/\s+/).filter(Boolean) ?? [];
  for (let width = Math.floor(words.length / 2); width >= 2; width -= 1) {
    const left = words.slice(0, width).join(" ");
    const right = words.slice(width, width * 2).join(" ");
    if (left && left.toLowerCase() === right.toLowerCase()) {
      return left;
    }
  }

  return null;
}

export function scoreCollectedJobQuality(
  job: ExtractedJobInput | JobPosting,
): number {
  const title = trimToNull(job.title) ?? "";
  const company = trimToNull(job.company) ?? "";
  const location = trimToNull(job.location) ?? "";
  const summary = trimToNull(job.summary) ?? "";
  const description = trimToNull(job.description) ?? "";
  const titleLower = title.toLowerCase();
  const companyLower = company.toLowerCase();
  const repeatedTitlePrefix = findRepeatedLeadingPhrase(title);
  let score = 0;

  score += Math.min(title.length, 120) * QUALITY_WEIGHTS.titleLength;
  score += Math.min(company.length, 120) * QUALITY_WEIGHTS.companyLength;
  score += Math.min(location.length, 80) * QUALITY_WEIGHTS.locationLength;
  score += Math.min(summary.length, 280);
  score += Math.min(description.length, 500) / 2;
  score += (job.keySkills?.length ?? 0) * QUALITY_WEIGHTS.keySkill;
  score += (job.responsibilities?.length ?? 0) * QUALITY_WEIGHTS.responsibility;
  score +=
    (job.minimumQualifications?.length ?? 0) *
    QUALITY_WEIGHTS.minimumQualification;
  score +=
    (job.preferredQualifications?.length ?? 0) *
    QUALITY_WEIGHTS.preferredQualification;

  if (job.easyApplyEligible) {
    score += QUALITY_WEIGHTS.easyApplyBonus;
  }

  if (NOISE_TOKEN_RE.test(title)) {
    score -= QUALITY_WEIGHTS.titleNoisePenalty;
  }

  if (repeatedTitlePrefix) {
    score -= QUALITY_WEIGHTS.repeatedTitlePenalty;
  }

  if (NOISE_TOKEN_RE.test(company)) {
    score -= QUALITY_WEIGHTS.companyNoisePenalty;
  }

  if (
    companyLower &&
    titleLower &&
    companyLower !== titleLower &&
    companyLower.includes(titleLower)
  ) {
    score -= QUALITY_WEIGHTS.companyContainsTitlePenalty;
  }

  if (
    titleLower &&
    companyLower &&
    titleLower.includes(companyLower) &&
    companyLower.length >= 6
  ) {
    score -= QUALITY_WEIGHTS.titleContainsCompanyPenalty;
  }

  if (title.split(/\s+/).filter(Boolean).length <= 1) {
    score -= QUALITY_WEIGHTS.shortTitlePenalty;
  }

  return Math.round(score);
}

function buildCollectedJob(
  job: ExtractedJobInput,
  source: JobPosting["source"],
  discoveredAt: string,
): JobPosting | null {
  const jobToAdd = {
    source,
    sourceJobId: job.sourceJobId,
    discoveryMethod: "browser_agent" as const,
    canonicalUrl: job.canonicalUrl,
    title: job.title,
    company: job.company,
    location: job.location,
    workMode: normalizeJobWorkMode(job),
    applyPath: ["easy_apply", "external_redirect", "unknown"].includes(
      job.applyPath as string,
    )
      ? job.applyPath
      : "unknown",
    easyApplyEligible: job.easyApplyEligible ?? false,
    postedAt: job.postedAt ?? null,
    postedAtText: trimToNull(job.postedAtText),
    providerUpdatedAt: trimToNull(job.providerUpdatedAt),
    discoveredAt,
    salaryText: job.salaryText || null,
    summary: trimToNull(job.summary) ?? summarizeJobInput(job),
    description: job.description,
    keySkills: job.keySkills ?? [],
    responsibilities: job.responsibilities ?? [],
    minimumQualifications: job.minimumQualifications ?? [],
    preferredQualifications: job.preferredQualifications ?? [],
    seniority: trimToNull(job.seniority),
    employmentType: trimToNull(job.employmentType),
    department: trimToNull(job.department),
    team: trimToNull(job.team),
    employerWebsiteUrl: trimToNull(job.employerWebsiteUrl),
    employerDomain: trimToNull(job.employerDomain),
    benefits: job.benefits ?? [],
  };

  const validation = JobPostingSchema.safeParse(jobToAdd);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    });
    console.warn(`[Agent] Skipping invalid job ${job.sourceJobId}:`, issues);
    return null;
  }

  return validation.data;
}

function isToolResult(value: unknown): value is ToolExecutionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if ("success" in candidate && typeof candidate.success !== "boolean") {
    return false;
  }

  if (
    "error" in candidate &&
    typeof candidate.error !== "string" &&
    typeof candidate.error !== "undefined"
  ) {
    return false;
  }

  if (
    "data" in candidate &&
    typeof candidate.data !== "undefined" &&
    (candidate.data === null ||
      typeof candidate.data !== "object" ||
      Array.isArray(candidate.data))
  ) {
    return false;
  }

  return true;
}

export function createEmptyPhaseEvidence(): SourceDebugPhaseEvidence {
  return SourceDebugPhaseEvidenceSchema.parse({});
}

export function appendPhaseEvidence(
  state: AgentState,
  key: Exclude<keyof SourceDebugPhaseEvidence, "visualFindings">,
  values: readonly (string | null | undefined)[],
) {
  state.phaseEvidence[key] = uniqueStrings([
    ...(state.phaseEvidence[key] ?? []),
    ...values,
  ]);
}

export function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function formatControlLabel(
  role: string | undefined,
  name: string | undefined,
  index?: number,
): string | null {
  const trimmedRole = role?.trim();
  const trimmedName = name?.trim();

  if (!trimmedRole || !trimmedName) {
    return null;
  }

  return `${trimmedRole} "${trimmedName}"${typeof index === "number" && index > 0 ? ` (#${index + 1})` : ""}`;
}

function normalizeInteractiveElement(
  value: unknown,
): { role?: string; name?: string; index?: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const normalized: { role?: string; name?: string; index?: number } = {};

  if (typeof candidate.role === "string") {
    normalized.role = candidate.role;
  }

  if (typeof candidate.name === "string") {
    normalized.name = candidate.name;
  }

  if (typeof candidate.index === "number" && Number.isFinite(candidate.index)) {
    normalized.index = candidate.index;
  }

  return normalized;
}

function buildUserFacingToolFailure(toolName: string, error: string): string {
  const normalizedError = error.toLowerCase();

  if (/timeout|timed out/i.test(normalizedError)) {
    return `${toolName} timed out.`;
  }

  if (/not visible|visibility/i.test(normalizedError)) {
    return `${toolName} failed because the target was not visible.`;
  }

  if (
    /invalid tool arguments|malformed data|unknown tool/i.test(normalizedError)
  ) {
    return `${toolName} failed because the tool response was invalid.`;
  }

  if (/404|not-found route/i.test(normalizedError)) {
    return `${toolName} reached a broken route.`;
  }

  return `${toolName} failed.`;
}

export function synthesizeFallbackDebugFindings(
  state: AgentState,
): NonNullable<AgentResult["debugFindings"]> | null {
  const reliableControls = state.phaseEvidence.visibleControls.slice(0, 4);
  const currentUrl = sanitizeUrl(state.currentUrl);
  const navigationTips = uniqueStrings([
    ...state.phaseEvidence.routeSignals.slice(0, 4),
    currentUrl ? `Last observed jobs surface: ${currentUrl}` : null,
  ]);
  const applyTips = uniqueStrings([
    state.collectedJobs.some(
      (job) => job.applyPath === "easy_apply" || job.easyApplyEligible,
    )
      ? "Use the on-site apply entry when the detail page exposes it."
      : null,
    state.collectedJobs.some((job) => job.applyPath === "external_redirect")
      ? "Expect some listings to hand off apply to an external destination."
      : null,
    state.collectedJobs.length > 0 &&
    !state.collectedJobs.some(
      (job) =>
        job.applyPath === "easy_apply" ||
        job.easyApplyEligible ||
        job.applyPath === "external_redirect",
    )
      ? "Treat applications as manual until a reliable on-site apply entry is proven."
      : null,
  ]);
  const warnings = state.phaseEvidence.warnings.slice(0, 4);

  if (
    reliableControls.length === 0 &&
    navigationTips.length === 0 &&
    applyTips.length === 0 &&
    warnings.length === 0
  ) {
    return null;
  }

  return AgentDebugFindingsSchema.parse({
    summary:
      uniqueStrings([
        navigationTips[0] ?? null,
        reliableControls[0]
          ? "Observed reusable controls on the jobs surface, but the phase timed out before a structured finish."
          : null,
        currentUrl
          ? `Observed a partial jobs surface at ${currentUrl}, but the phase timed out before structured completion.`
          : null,
      ])[0] ?? "The phase timed out before structured completion.",
    reliableControls,
    trickyFilters: [],
    navigationTips,
    applyTips,
    warnings,
  });
}

export function hasMeaningfulPhaseEvidence(state: AgentState): boolean {
  return (
    state.phaseEvidence.visibleControls.length > 0 ||
    state.phaseEvidence.successfulInteractions.length > 0 ||
    state.phaseEvidence.routeSignals.length > 0 ||
    state.phaseEvidence.attemptedControls.length > 0 ||
    state.phaseEvidence.warnings.length > 0 ||
    (state.phaseEvidence.visualFindings?.length ?? 0) > 0 ||
    state.collectedJobs.length > 0
  );
}

export function recordToolEvidence(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  state: AgentState,
  phase?: SourceDebugPhase,
) {
  const normalizedResult = isToolResult(result) ? result : {};
  const controlLabel = formatControlLabel(
    typeof args.role === "string" ? args.role : undefined,
    typeof args.name === "string" ? args.name : undefined,
    typeof args.index === "number" ? args.index : undefined,
  );

  if (
    toolName === "get_interactive_elements" &&
    normalizedResult.success &&
    normalizedResult.data
  ) {
    const elements = Array.isArray(normalizedResult.data.elements)
      ? normalizedResult.data.elements
          .map((element) => normalizeInteractiveElement(element))
          .filter(
            (
              element,
            ): element is { role?: string; name?: string; index?: number } =>
              element !== null,
          )
      : [];
    appendPhaseEvidence(
      state,
      "visibleControls",
      elements
        .slice(0, 8)
        .map((element) =>
          formatControlLabel(element.role, element.name, element.index),
        ),
    );
    return;
  }

  if (toolName === "navigate") {
    const reachedUrl =
      typeof normalizedResult.data?.url === "string"
        ? sanitizeUrl(normalizedResult.data.url)
        : null;
    const requestedUrl =
      typeof normalizedResult.data?.requestedUrl === "string"
        ? sanitizeUrl(normalizedResult.data.requestedUrl)
        : null;
    appendPhaseEvidence(state, "routeSignals", [
      normalizedResult.success && reachedUrl
        ? `Navigation reached ${reachedUrl}`
        : requestedUrl
          ? `Tried navigation to ${requestedUrl}`
          : null,
    ]);
  }

  if (
    toolName === "click" ||
    toolName === "fill" ||
    toolName === "select_option"
  ) {
    const optionText =
      typeof args.optionText === "string" ? args.optionText.trim() : "";
    appendPhaseEvidence(state, "attemptedControls", [
      controlLabel
        ? toolName === "click"
          ? `Attempted to click ${controlLabel}`
          : toolName === "fill"
            ? `Attempted to fill ${controlLabel}`
            : `Attempted to select "${optionText}" from ${controlLabel}`
        : null,
    ]);
  }

  if (toolName === "click" && normalizedResult.success) {
    appendPhaseEvidence(state, "successfulInteractions", [
      controlLabel ? `Clicked ${controlLabel}` : null,
    ]);
  }

  if (toolName === "fill" && normalizedResult.success) {
    appendPhaseEvidence(state, "successfulInteractions", [
      controlLabel ? `Filled ${controlLabel}` : null,
    ]);
  }

  if (toolName === "select_option" && normalizedResult.success) {
    const optionText =
      typeof args.optionText === "string" ? args.optionText.trim() : "";
    appendPhaseEvidence(state, "successfulInteractions", [
      controlLabel ? `Selected "${optionText}" from ${controlLabel}` : null,
    ]);
  }

  if (toolName === "scroll_down" && normalizedResult.success) {
    const currentUrl = sanitizeUrl(state.currentUrl);
    appendPhaseEvidence(state, "successfulInteractions", [
      "Scrolled down on the current jobs surface",
    ]);
    appendPhaseEvidence(state, "routeSignals", [
      normalizedResult.data?.newContentLoaded === true && currentUrl
        ? `Scrolling revealed additional content on ${currentUrl}`
        : null,
    ]);
  }

  if (toolName === "scroll_to_top" && normalizedResult.success) {
    const currentUrl = sanitizeUrl(state.currentUrl);
    appendPhaseEvidence(state, "successfulInteractions", [
      "Returned to the top of the current page to re-check header controls",
    ]);
    appendPhaseEvidence(state, "routeSignals", [
      currentUrl
        ? `Returned to the top of ${currentUrl} to probe header controls again`
        : null,
    ]);
  }

  if (
    (toolName === "click" ||
      toolName === "fill" ||
      toolName === "select_option") &&
    normalizedResult.success &&
    normalizedResult.data
  ) {
    const newUrl =
      typeof normalizedResult.data.newUrl === "string"
        ? sanitizeUrl(normalizedResult.data.newUrl)
        : null;
    if (newUrl) {
      appendPhaseEvidence(state, "routeSignals", [
        `${toolName === "click" ? "Control click" : toolName === "fill" ? "Search submit" : "Dropdown selection"} opened ${newUrl}`,
      ]);
    }
  }

  if (
    toolName === "extract_jobs" &&
    normalizedResult.success &&
    normalizedResult.data
  ) {
    const jobsExtracted =
      typeof normalizedResult.data.jobsExtracted === "number"
        ? normalizedResult.data.jobsExtracted
        : 0;
    const pageUrl =
      typeof normalizedResult.data.pageUrl === "string"
        ? sanitizeUrl(normalizedResult.data.pageUrl)
        : sanitizeUrl(state.currentUrl);
    appendPhaseEvidence(state, "routeSignals", [
      jobsExtracted > 0
        ? `Job extraction found ${jobsExtracted} candidate jobs on ${pageUrl}`
        : null,
    ]);
  }

  if (
    toolName === "capture_visual_snapshot" &&
    normalizedResult.success &&
    normalizedResult.data
  ) {
    if (!phase) {
      appendPhaseEvidence(state, "warnings", [
        "Visual snapshot evidence was ignored because the source-debug phase was missing.",
      ]);
      return;
    }

    const snapshotId =
      typeof normalizedResult.data.snapshotId === "string"
        ? normalizedResult.data.snapshotId
        : null;
    const observationSetId =
      typeof normalizedResult.data.observationSetId === "string"
        ? normalizedResult.data.observationSetId
        : null;

    if (!snapshotId || !observationSetId) {
      appendPhaseEvidence(state, "warnings", [
        "Visual snapshot evidence was ignored because the tool result did not include snapshot and observation IDs.",
      ]);
      return;
    }

    const summary =
      typeof normalizedResult.data.summary === "string" &&
      normalizedResult.data.summary.trim()
        ? normalizedResult.data.summary.trim()
        : "Visual snapshot captured structured page-state observations.";
    const storagePath =
      typeof normalizedResult.data.storagePath === "string" &&
      normalizedResult.data.storagePath.trim()
        ? normalizedResult.data.storagePath.trim()
        : null;
    const retained = normalizedResult.data.retained === true;
    const capturedAt = new Date().toISOString();

    state.phaseEvidence.visualFindings = [
      ...(state.phaseEvidence.visualFindings ?? []),
      SourceDebugVisualFindingSchema.parse({
        id: `visual_finding_${snapshotId}`,
        phase,
        snapshotId,
        observationSetId,
        kind: "recovery_note",
        summary,
        capturedAt,
        storagePath,
        retention: retained ? "retained" : "temporary",
        redactionLevel: "standard",
        confidence: 0.62,
        reconciliationStatus: null,
      }),
    ];
    appendPhaseEvidence(state, "warnings", [
      storagePath
        ? null
        : retained
          ? "Visual snapshot was requested for retention but no storage path was available."
          : null,
    ]);
  }

  if (normalizedResult.error) {
    console.error("[Agent] Tool failed during evidence recording:", {
      toolName,
      error: normalizedResult.error,
    });
    appendPhaseEvidence(state, "warnings", [
      buildUserFacingToolFailure(toolName, normalizedResult.error),
    ]);
  }
}

function normalizeJobWorkMode(
  job: Pick<JobPosting, "workMode">,
): JobPosting["workMode"] {
  const allowedWorkModes = ["remote", "hybrid", "onsite", "flexible"] as const;
  const validWorkModes = Array.isArray(job.workMode)
    ? job.workMode.filter((mode): mode is (typeof allowedWorkModes)[number] =>
        allowedWorkModes.includes(mode),
      )
    : [];

  return validWorkModes.length > 0 ? validWorkModes : ["flexible"];
}

/**
 * URLs that stand for a results surface rather than one posting: the same URL
 * attached to two or more differently titled jobs (a search page whose cards
 * have no links of their own). The same posting reached twice shares a URL
 * too, but also a title, and that is a duplicate to merge, not a surface.
 */
function collectSharedSurfaceUrls(
  jobs: readonly ExtractedJobInput[],
): Set<string> {
  const titlesByUrl = new Map<string, Set<string>>();
  for (const job of jobs) {
    const canonicalUrl = job.canonicalUrl.trim();
    if (!canonicalUrl) {
      continue;
    }
    const titles = titlesByUrl.get(canonicalUrl) ?? new Set<string>();
    titles.add(normalizeTitleForIdentity(job.title));
    titlesByUrl.set(canonicalUrl, titles);
  }

  return new Set(
    [...titlesByUrl.entries()]
      .filter(([, titles]) => titles.size >= 2)
      .map(([canonicalUrl]) => canonicalUrl),
  );
}

function normalizeTitleForIdentity(title: string | null | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/gu, " ")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function shouldDeduplicateByCanonicalUrl(
  value: string | null | undefined,
  sharedSurfaceUrls: ReadonlySet<string>,
): boolean {
  const canonicalUrl = value?.trim();
  if (!canonicalUrl) {
    return false;
  }

  try {
    const parsed = new URL(canonicalUrl);
    if (findDetailRouteIdSegment(parsed.pathname)) {
      return true;
    }
  } catch {
    return true;
  }

  return !sharedSurfaceUrls.has(canonicalUrl);
}

/**
 * Every extracted job enters the run's state here, whichever extractor found
 * it, so this is where a title wrapped across two painted lines is put back
 * together. The card reader repairs its own records, but the model pass
 * returns the heading as painted — a run stored "Manager" for a listing its
 * own summary called "Manager Credit Risk" — and those jobs reach state
 * through this same function. The witnesses are the job's address slug, its
 * own summary and description, and the page text around the title.
 */
export function addExtractedJobsToState(
  extractedJobs: readonly ExtractedJobInput[],
  state: AgentState,
  source: JobPosting["source"],
  options?: { pageText?: string | null },
): number {
  let addedCount = 0;
  const discoveredAt = new Date().toISOString();
  const repairedJobs = extractedJobs.map((job) =>
    repairExtractedJobTitle(job, { pageText: options?.pageText ?? null }),
  );
  const sharedSurfaceUrls = collectSharedSurfaceUrls([
    ...state.collectedJobs,
    ...repairedJobs,
  ]);

  for (const job of repairedJobs) {
    const existingIndex = state.collectedJobs.findIndex(
      (existingJob) =>
        existingJob.sourceJobId === job.sourceJobId ||
        (shouldDeduplicateByCanonicalUrl(
          existingJob.canonicalUrl,
          sharedSurfaceUrls,
        ) &&
          shouldDeduplicateByCanonicalUrl(
            job.canonicalUrl,
            sharedSurfaceUrls,
          ) &&
          existingJob.canonicalUrl === job.canonicalUrl),
    );

    const validatedJob = buildCollectedJob(job, source, discoveredAt);
    if (!validatedJob) {
      continue;
    }

    if (existingIndex !== -1) {
      const existingJob = state.collectedJobs[existingIndex];
      if (existingJob === undefined) {
        continue;
      }
      if (
        scoreCollectedJobQuality(validatedJob) >
        scoreCollectedJobQuality(existingJob)
      ) {
        state.collectedJobs[existingIndex] = {
          ...validatedJob,
          discoveredAt: existingJob.discoveredAt,
        };
      }
      continue;
    }

    state.collectedJobs.push(validatedJob);
    addedCount += 1;
  }

  return addedCount;
}
