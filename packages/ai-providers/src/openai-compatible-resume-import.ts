import {
  ResumeImportTargetSectionSchema,
  ResumeImportConflictChoiceSchema,
  type AgentProviderStatus,
  type ResumeImportFieldCandidateDraft,
  type ResumeImportJsonValue,
  ResumeImportVisualEvidenceRefSchema,
} from "@nordri/contracts";
import {
  ResumeImportAdjudicationResultSchema,
  ResumeImportStageExtractionResultSchema,
  sanitizeStageCandidates,
  selectBlocksForResumeImportStage,
  type AdjudicateResumeImportCandidatesInput,
  type ExtractResumeImportStageInput,
  type ResumeImportAdjudicationResult,
  type ResumeImportStageExtractionResult,
} from "./resume-import";
import { buildCandidateConfidenceBreakdown } from "./resume-import-helpers";
import type { OpenAiCompatibleJsonOperation } from "./openai-compatible-request-compaction";

const ADJUDICATION_BLOCK_LIMIT = 80;
const ADJUDICATION_CANDIDATE_LIMIT = 24;
// Post-adjudication confidence weighting: adjudicated candidates are assigned a lower
// normalization risk and higher conflict risk compared with extract-path defaults,
// reflecting the pro-normalization review pass that produced them.
const POST_ADJ_NORMALIZATION_RISK = 0.1;
const POST_ADJ_CONFLICT_RISK = 0.34;

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "string") {
      return [];
    }

    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  });
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return undefined;
}

function normalizeAlternatives(value: unknown): ResumeImportJsonValue[] {
  if (Array.isArray(value)) {
    return value as ResumeImportJsonValue[];
  }

  return value === null || value === undefined
    ? []
    : [value as ResumeImportJsonValue];
}

function normalizeTarget(
  value: unknown,
): ResumeImportFieldCandidateDraft["target"] | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sectionResult = ResumeImportTargetSectionSchema.safeParse(
      record.section,
    );
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const recordId =
      typeof record.recordId === "string" ? record.recordId.trim() : null;

    if (sectionResult.success && key) {
      return {
        section: sectionResult.data,
        key,
        recordId: recordId || null,
      };
    }
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/^target\s*[:=]\s*/i, "");
  if (!normalized) {
    return undefined;
  }

  const delimiter = normalized.includes("|")
    ? "|"
    : normalized.includes(":")
      ? ":"
      : ".";
  const parts = normalized
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return undefined;
  }

  const sectionResult = ResumeImportTargetSectionSchema.safeParse(parts[0]);
  if (!sectionResult.success) {
    return undefined;
  }

  const key = parts[1] ?? "";
  const recordId = parts.length > 2 ? parts.slice(2).join(delimiter) : null;

  if (!key) {
    return undefined;
  }

  return {
    section: sectionResult.data,
    key,
    recordId: recordId || null,
  };
}

function normalizeCandidate(
  value: unknown,
): ResumeImportFieldCandidateDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const target = normalizeTarget(record.target);

  if (!target) {
    return undefined;
  }

  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : `${target.section}.${target.key}${target.recordId ? `.${target.recordId}` : ""}`;
  const confidence = normalizeConfidence(record.confidence) ?? 0.5;

  return {
    target,
    label,
    value: (record.value ?? null) as ResumeImportJsonValue,
    normalizedValue: (record.normalizedValue ?? null) as ResumeImportJsonValue,
    valuePreview:
      typeof record.valuePreview === "string" ? record.valuePreview : null,
    evidenceText:
      typeof record.evidenceText === "string" ? record.evidenceText : null,
    sourceBlockIds: toStringArray(record.sourceBlockIds),
    confidence,
    confidenceBreakdown: null,
    notes: toStringArray(record.notes),
    alternatives: normalizeAlternatives(record.alternatives),
    conflictChoices: Array.isArray(record.conflictChoices)
      ? record.conflictChoices.flatMap((entry) => {
          const parsed = ResumeImportConflictChoiceSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
    visualEvidence: Array.isArray(record.visualEvidence)
      ? record.visualEvidence.flatMap((entry) => {
          const parsed = ResumeImportVisualEvidenceRefSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
  };
}

export function buildResumeImportStageInstructions(
  stage: ExtractResumeImportStageInput["stage"],
): string {
  switch (stage) {
    case "identity_summary":
      return [
        "Return only identity, contact, location, search-preference and work-eligibility candidates.",
        "Valid target sections: identity, contact, location, search_preferences, work_eligibility.",
        "Use keys such as fullName, firstName, lastName, middleName, headline, summary, currentLocation, timeZone, yearsExperience, email, phone, portfolioUrl, linkedinUrl, githubUrl, personalWebsiteUrl, targetRoles, locations, workModes, employmentTypes, compensation, salaryCurrency.",
        "Read the whole resume, not only its header: a work authorization or work preferences line can sit anywhere.",
        'When the resume states work authorization outright, return work_eligibility.authorizedWorkCountries (an array of the countries or regions named, such as "European Union") and work_eligibility.requiresVisaSponsorship (true or false). Never infer either from where the person lives, studied or worked.',
        'When the resume states the employment type it wants, return search_preferences.employmentTypes using "Full-time", "Part-time", "Contract", "Temporary" or "Internship". When it states a minimum pay, return search_preferences.compensation as {"minimum": number, "maximum": number or null, "interval": "year", "month", "week", "day" or "hour", "currency": a three-letter code or null, "currencyStatus": "explicit" when a currency code or unambiguous symbol is written, otherwise "needs_clarification"}; a bare "$" is not a currency.',
        "Return search_preferences.workModes only when the header, contact line, or summary literally says remote, hybrid, onsite, or flexible; the value is an array of those lowercase words and nothing else.",
        "Prefer literal values from the document over inferred rewrites.",
        "Never use a section heading like ABOUT ME, SKILLS, or WORK EXPERIENCE as a person name.",
        "Only return currentLocation when the blocks show an address or a short literal location label, not a narrative sentence.",
        'Each candidate target must be an object like {"section":"identity","key":"fullName","recordId":null}, not a string.',
      ].join(" ");
    case "experience":
      return [
        "Return only experience record candidates.",
        "Valid target section: experience.",
        "Use target.key = 'record' and a stable recordId like experience_1, experience_2.",
        "Each value must be a structured object matching one resume experience record with exactly these keys: companyName, companyUrl, title, employmentType, location, workMode (array), startDate, endDate, isCurrent (boolean), summary, achievements (array of strings), skills (array), domainTags (array).",
        "Write startDate and endDate as YYYY-MM; when the role is ongoing set isCurrent true and endDate null.",
        "Put every bullet under that role into achievements as a separate complete sentence.",
        "Use the nearest explicit company marker or inline company segment when the resume shows one, and populate companyName separately from title.",
        "When a role header has no employer on the same line, take the employer from the nearest company marker, section heading, or employer line that governs that role, even if it sits a few lines away; leave companyName null only when the resume never names an employer for that role.",
        "If title, company, and location appear on one header line, split them into the correct fields instead of embedding company or location inside title.",
        "Merge wrapped continuation lines so summaries and achievements read as complete sentences instead of broken fragments.",
        "Populate workMode only when the record explicitly says remote, hybrid, onsite, or flexible.",
        "Include skills only when that specific role header, summary, or achievement explicitly names the skill or directly demonstrates a skill that is also declared in the resume skills section.",
        "Do not copy unrelated global skills onto every experience record.",
        "Do not create an experience record unless the blocks contain an explicit role header or date range.",
        'For record candidates, target must be an object like {"section":"experience","key":"record","recordId":"experience_1"}.',
      ].join(" ");
    case "background":
      return [
        "Return only background candidates for skills, education, certifications, links, projects, and languages.",
        "Valid target sections: skill, education, certification, link, project, language.",
        'Use target {"section":"skill","key":"skills","recordId":null} for a complete skills array, and optional skillGroups.coreSkills, skillGroups.tools, skillGroups.languagesAndFrameworks, skillGroups.softSkills, or skillGroups.highlightedSkills for grouped skill arrays.',
        'Use target {"section":"education","key":"record","recordId":"education_1"} for each education object with schoolName, degree, fieldOfStudy, location, startDate, endDate, and summary fields.',
        "Preserve the named qualification and completion date or year in degree and endDate; leave dates absent from the document null rather than inventing months or years.",
        "Do not emit education.institution, education.startDate, education.graduationDate, or education.education scalar targets; fold those values into an education record object.",
        "Use key 'record' for certification, link, project, and language object records.",
      ].join(" ");
    case "shared_memory":
      return [
        "Return only conservative shared-memory suggestions.",
        "Valid target sections: narrative, proof_point, answer_bank, application_identity.",
        "Never invent sensitive facts such as work authorization, sponsorship, relocation, notice period, availability, or salary expectations.",
        "For application_identity, prefer keys preferredEmail, preferredPhone, or preferredLinkIds.",
        "For proof_point records, use value objects with title, claim, heroMetric, supportingContext, roleFamilies, projectIds, and linkIds.",
        "Prefer concise reusable narratives grounded in multiple resume lines over clipped fragments from a single wrapped sentence.",
      ].join(" ");
    default:
      return "Return conservative grounded candidates only.";
  }
}

export async function extractOpenAiCompatibleResumeImportStage(input: {
  stageInput: ExtractResumeImportStageInput;
  status: AgentProviderStatus;
  fetchModelJson: (
    operation: OpenAiCompatibleJsonOperation,
    systemPrompt: string,
    userPayload: unknown,
    options?: { timeoutMs?: number },
  ) => Promise<unknown>;
  timeoutMs: number;
}): Promise<ResumeImportStageExtractionResult> {
  const blocks = selectBlocksForResumeImportStage(
    input.stageInput.documentBundle,
    input.stageInput.stage,
  );
  const payload = await input.fetchModelJson(
    "extractResumeImportStage",
    [
      "You extract structured resume import candidates from parsed document blocks.",
      "Return JSON only.",
      "Use only the provided blocks as evidence.",
      "Each candidate must include target, label, value, normalizedValue when helpful, evidenceText, sourceBlockIds, confidence, notes, and alternatives.",
      'Example candidate: {"target":{"section":"identity","key":"fullName","recordId":null},"label":"Full name","value":"Jane Doe","normalizedValue":"Jane Doe","evidenceText":"Jane Doe","sourceBlockIds":["block_1"],"confidence":0.98,"notes":[],"alternatives":[]}',
      "Only use sourceBlockIds that exist in the input block list.",
      "Confidence must be a number between 0 and 1.",
      buildResumeImportStageInstructions(input.stageInput.stage),
      "Abstain instead of guessing.",
    ].join(" "),
    {
      stage: input.stageInput.stage,
      existingProfile: input.stageInput.existingProfile,
      existingSearchPreferences: input.stageInput.existingSearchPreferences,
      documentBundle: {
        id: input.stageInput.documentBundle.id,
        sourceResumeId: input.stageInput.documentBundle.sourceResumeId,
        parserKinds: input.stageInput.documentBundle.parserKinds,
        warnings: input.stageInput.documentBundle.warnings,
        blocks: blocks.map((block) => ({
          id: block.id,
          pageNumber: block.pageNumber,
          sectionHint: block.sectionHint,
          kind: block.kind,
          text: block.text,
        })),
      },
    },
    { timeoutMs: input.timeoutMs },
  );

  const normalizedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  return sanitizeStageCandidates(
    input.stageInput,
    ResumeImportStageExtractionResultSchema.parse({
      stage: input.stageInput.stage,
      analysisProviderKind: "openai_compatible",
      analysisProviderLabel: input.status.label,
      candidates: Array.isArray(normalizedPayload.candidates)
        ? normalizedPayload.candidates
            .map((candidate) => normalizeCandidate(candidate))
            .filter((candidate): candidate is ResumeImportFieldCandidateDraft =>
              Boolean(candidate),
            )
            .map((candidate) => ({
              ...candidate,
              confidenceBreakdown: buildCandidateConfidenceBreakdown({
                candidate: {
                  target: candidate.target,
                  confidence: candidate.confidence,
                  sourceBlockIds: candidate.sourceBlockIds,
                },
                bundle: input.stageInput.documentBundle,
              }),
            }))
        : [],
      notes: toStringArray(normalizedPayload.notes),
    }),
  );
}

export async function adjudicateOpenAiCompatibleResumeImportCandidates(input: {
  adjudicationInput: AdjudicateResumeImportCandidatesInput;
  status: AgentProviderStatus;
  fetchModelJson: (
    operation: OpenAiCompatibleJsonOperation,
    systemPrompt: string,
    userPayload: unknown,
    options?: { timeoutMs?: number },
  ) => Promise<unknown>;
  timeoutMs: number;
}): Promise<ResumeImportAdjudicationResult> {
  const payload = await input.fetchModelJson(
    "adjudicateResumeImportCandidates",
    [
      "You adjudicate conflicting resume import candidates produced by document text extraction and visual scan extraction.",
      "Return JSON only with candidates, notes, and warnings arrays.",
      "Use Pro-style normalization only: produce validated import candidate drafts when a safer normalized value can be grounded in the supplied candidates and document blocks.",
      "Do not invent values. Do not write to the canonical profile. If the conflict is still ambiguous, return no candidates and explain the review need in notes.",
      "Each candidate must include target, label, value, normalizedValue when useful, evidenceText, sourceBlockIds, confidence, notes, alternatives, and may include visualEvidence.",
      "Each candidate target must be an object, not a string.",
      'Example candidate: {"target":{"section":"experience","key":"record","recordId":"experience_1"},"label":"Current role","value":{"title":"Engineer"},"confidence":0.9,"evidenceText":"Senior Engineer at Acme","sourceBlockIds":["b1"],"notes":[],"alternatives":[],"conflictChoices":[{"id":"c1","sourceLabel":"Text extraction","sourceKind":"document_text","confidence":0.85,"valuePreview":"Engineer","recommended":true}],"visualEvidence":[]}',
    ].join(" "),
    {
      existingProfile: input.adjudicationInput.existingProfile,
      existingSearchPreferences:
        input.adjudicationInput.existingSearchPreferences,
      documentBundle: {
        id: input.adjudicationInput.documentBundle.id,
        sourceFileKind: input.adjudicationInput.documentBundle.sourceFileKind,
        quality: input.adjudicationInput.documentBundle.quality ?? null,
        warnings: input.adjudicationInput.documentBundle.warnings,
        blocks: input.adjudicationInput.documentBundle.blocks
          .slice(0, ADJUDICATION_BLOCK_LIMIT)
          .map((block) => ({
            id: block.id,
            pageNumber: block.pageNumber,
            sectionHint: block.sectionHint,
            kind: block.kind,
            text: block.text,
          })),
      },
      candidates: input.adjudicationInput.candidates.slice(
        0,
        ADJUDICATION_CANDIDATE_LIMIT,
      ),
    },
    { timeoutMs: input.timeoutMs },
  );

  const truncationWarnings: string[] = [];
  if (
    input.adjudicationInput.documentBundle.blocks.length >
    ADJUDICATION_BLOCK_LIMIT
  ) {
    truncationWarnings.push(
      `Adjudication input truncated: ${input.adjudicationInput.documentBundle.blocks.length} blocks (>${ADJUDICATION_BLOCK_LIMIT} limit)`,
    );
  }
  if (
    input.adjudicationInput.candidates.length > ADJUDICATION_CANDIDATE_LIMIT
  ) {
    truncationWarnings.push(
      `Adjudication input truncated: ${input.adjudicationInput.candidates.length} candidates (>${ADJUDICATION_CANDIDATE_LIMIT} limit)`,
    );
  }

  const normalizedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const candidates = Array.isArray(normalizedPayload.candidates)
    ? normalizedPayload.candidates
        .map((candidate) => normalizeCandidate(candidate))
        .filter((candidate): candidate is ResumeImportFieldCandidateDraft =>
          Boolean(candidate),
        )
        .map((candidate) => ({
          ...candidate,
          confidenceBreakdown: buildCandidateConfidenceBreakdown({
            candidate: {
              target: candidate.target,
              confidence: candidate.confidence,
              sourceBlockIds: candidate.sourceBlockIds,
            },
            bundle: input.adjudicationInput.documentBundle,
            normalizationRisk: POST_ADJ_NORMALIZATION_RISK,
            conflictRisk: POST_ADJ_CONFLICT_RISK,
          }),
        }))
    : [];

  return ResumeImportAdjudicationResultSchema.parse({
    candidates,
    notes: toStringArray(normalizedPayload.notes),
    warnings: [
      ...truncationWarnings,
      ...toStringArray(normalizedPayload.warnings),
    ],
  });
}
