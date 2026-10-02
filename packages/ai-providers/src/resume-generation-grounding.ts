import { z } from "zod";
import { buildResumeSkillContextFilter } from "./resume-skill-context";

import {
  canonicalSkillPhrase,
  skillsAreEquivalent,
} from "./deterministic/resume-skill-grounding";
import type { CreateResumeDraftInput, TailorResumeInput } from "./shared";

const EvidenceReferenceSchema = z.string().trim().min(1).max(300);
const EvidenceReferenceListSchema = z
  .array(EvidenceReferenceSchema)
  .min(1)
  .max(8);
const EvidenceLinkedTextSchema = z.object({
  text: z.string().trim().min(1).max(1_000),
  evidenceRefs: EvidenceReferenceListSchema,
  inferred: z.boolean().optional(),
});

export type ResumeGenerationInput = CreateResumeDraftInput | TailorResumeInput;

export type ResumeGenerationEvidenceScope =
  | "profile"
  | "experience"
  | "project"
  | "proof"
  | "import_evidence";

export interface ResumeGenerationEvidenceItem {
  id: string;
  text: string;
  scope: ResumeGenerationEvidenceScope;
  profileRecordId: string | null;
}

export interface ParsedEvidenceLinkedText {
  text: string;
  evidenceRefs: string[];
  inferred: boolean;
}

export interface ResumeRewriteSelection {
  text: string;
  kind: "canonical" | "grounded_rewrite";
  referencedEvidenceText: string[];
  inferred: boolean;
}

const RESUME_STOP_WORD_LIST = [
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "through",
  "to",
  "using",
  "via",
  "with",
];

const RESUME_TOKEN_SYNONYM_GROUPS = [
  ["build", "create", "develop", "engineer", "implement"],
  ["design", "architect"],
  ["deliver", "launch", "release", "ship"],
  ["direct", "lead", "manage", "own"],
  ["collaborate", "partner", "work"],
  ["improve", "enhance", "optimize", "raise"],
  ["decrease", "cut", "reduce"],
  ["boost", "grow", "increase"],
  ["maintain", "operate", "support"],
] as const;

const RESUME_TOKEN_SYNONYMS = new Map<string, string>(
  RESUME_TOKEN_SYNONYM_GROUPS.flatMap((group, groupIndex) =>
    group.map((token) => [token, `group_${groupIndex}`] as const),
  ),
);

// Both sets are consulted with normalized tokens, so their entries are
// normalized the same way; a literal "predictable" would otherwise never meet
// the stem the text produces.
const RESUME_STOP_WORDS = new Set(
  RESUME_STOP_WORD_LIST.flatMap((word) => [word, normalizeToken(word)]),
);

const UNSUPPORTED_ABSOLUTE_CLAIM_PATTERN =
  /\b(?:best[- ]in[- ]class|industry[- ]leading|unparalleled|visionary|world[- ]class|guaranteed|mastered every|expert in every)\b/i;
const FIRST_PERSON_PATTERN = /\b(?:i|me|my|mine|we|our|ours)\b/i;
const LEADERSHIP_CLAIM_PATTERN =
  /\b(?:lead(?!\s+time)|led|leads|leading|manage|manages|managed|managing|direct|directs|directed|directing|own|owns|owned|supervise|supervises|supervised|supervising|oversee|oversees|oversaw|head|heads|headed|mentor|mentors|mentored|mentoring)\b/i;
const CREDENTIAL_CLAIM_PATTERN =
  /\b(?:certified|licensed|fluent|native proficiency|subject[- ]matter expert)\b/i;
const NUMBER_OR_METRIC_PATTERN =
  /(?:[$€£]\s*)?\d+(?:[.,]\d+)*(?:\s*(?:%|x|k|m|b|million|billion|thousand))?/gi;

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeToken(value: string): string {
  let normalized = value
    .toLowerCase()
    .replace(/^[^a-z0-9+#.]+|[^a-z0-9+#.]+$/g, "")
    // Preserve meaningful internal/leading dots (`Node.js`, `.NET`) while
    // removing sentence punctuation from otherwise identical evidence tokens.
    .replace(/\.+$/g, "");

  if (normalized.length > 6 && normalized.endsWith("ing")) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.length > 5 && normalized.endsWith("ed")) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 5 && normalized.endsWith("ies")) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.length > 5 && /(?:s|x|z|ch|sh)es$/.test(normalized)) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 4 && normalized.endsWith("s")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.startsWith("reliab")) {
    return "reliab";
  }

  // Bring inflections of one verb to one stem: "automating" is stripped to
  // "automat" above, so "automate" must land there too, or a rewrite that
  // says "to automate deployments" reads as new content next to evidence that
  // said "automating deployments". A trailing silent "e" is dropped and a
  // doubled final consonant left by "-ing"/"-ed" stripping is collapsed.
  // Both sides of every comparison pass through here, so the stem only has to
  // be consistent, not linguistically exact.
  const synonym = RESUME_TOKEN_SYNONYMS.get(normalized);
  if (synonym) {
    return synonym;
  }
  let stemmed = normalized;
  if (
    stemmed.length > 5 &&
    /[a-z]e$/.test(stemmed) &&
    !/[aeiou]e$/.test(stemmed)
  ) {
    stemmed = stemmed.slice(0, -1);
  } else if (stemmed.length > 5 && /([bdfglmnprt])\1$/.test(stemmed)) {
    stemmed = stemmed.slice(0, -1);
  }
  return RESUME_TOKEN_SYNONYMS.get(stemmed) ?? stemmed;
}

function meaningfulTokens(value: string): string[] {
  return Array.from(
    new Set(
      (value.match(/[A-Za-z0-9][A-Za-z0-9+#.%-]*/g) ?? [])
        .map((token) => normalizeToken(token))
        .filter(
          (token) =>
            token.length >= 2 &&
            !RESUME_STOP_WORDS.has(token) &&
            !/^\d/.test(token),
        ),
    ),
  );
}

function normalizedMetrics(value: string): string[] {
  return (value.match(NUMBER_OR_METRIC_PATTERN) ?? []).map((metric) =>
    metric.toLowerCase().replace(/[\s,]/g, ""),
  );
}

function normalizedComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Years-of-experience figures the aggressive relaxation may round up by at
// most one: a bare number ("4", "3+") directly followed by "year"/"years".
// Every other number keeps requiring verbatim evidence in every mode.
const YEARS_OF_EXPERIENCE_PATTERN = /\b(\d+)\s*\+?\s*years?\b/gi;

export function extractYearsOfExperienceNumbers(value: string): number[] {
  return Array.from(value.matchAll(YEARS_OF_EXPERIENCE_PATTERN), (match) =>
    Number.parseInt(match[1] ?? "", 10),
  ).filter((years) => Number.isFinite(years));
}

// A metric may only count as a rounded-up years figure when it is a pure
// integer (never "15%", "$4", or "4k"), the claim itself states it as years
// of experience, the cited evidence carries exactly one year less, and the
// target listing states the rounded figure as its own years requirement.
function isRoundedUpYearsMetric(
  metric: string,
  claimYearsNumbers: ReadonlySet<number>,
  evidenceYearsNumbers: ReadonlySet<number>,
  listingYearsNumbers: ReadonlySet<number>,
): boolean {
  if (!/^\d+$/.test(metric)) {
    return false;
  }
  const years = Number.parseInt(metric, 10);
  return (
    claimYearsNumbers.has(years) &&
    evidenceYearsNumbers.has(years - 1) &&
    listingYearsNumbers.has(years)
  );
}

function findStrictPrefixCanonical(
  generated: string,
  canonicalCandidates: readonly string[],
): string | null {
  const normalizedGenerated = normalizedComparableText(generated);
  if (!normalizedGenerated) {
    return null;
  }

  return (
    canonicalCandidates.find((candidate) => {
      const normalizedCandidate = normalizedComparableText(candidate);
      return (
        normalizedCandidate.length > normalizedGenerated.length &&
        normalizedCandidate.startsWith(`${normalizedGenerated} `)
      );
    }) ?? null
  );
}

function phraseAppears(value: string, phrase: string): boolean {
  const normalizedValue = normalizedComparableText(value);
  const normalizedPhrase = normalizedComparableText(phrase);
  return (
    Boolean(normalizedPhrase) && normalizedValue.includes(normalizedPhrase)
  );
}

function pushEvidenceItem(
  items: ResumeGenerationEvidenceItem[],
  seenIds: Set<string>,
  item: Omit<ResumeGenerationEvidenceItem, "text"> & { text: unknown },
): void {
  const text = normalizeNullableText(item.text);
  if (!text || seenIds.has(item.id)) {
    return;
  }

  seenIds.add(item.id);
  items.push({ ...item, text });
}

export function buildResumeGenerationEvidenceCatalog(
  input: ResumeGenerationInput,
): ResumeGenerationEvidenceItem[] {
  const items: ResumeGenerationEvidenceItem[] = [];
  const seenIds = new Set<string>();
  const addProfileEvidence = (id: string, text: unknown) => {
    pushEvidenceItem(items, seenIds, {
      id,
      text,
      scope: "profile",
      profileRecordId: null,
    });
  };

  addProfileEvidence("profile:headline", input.profile.headline);
  addProfileEvidence("profile:summary", input.profile.summary);
  addProfileEvidence(
    "profile:yearsExperience",
    input.profile.yearsExperience > 0
      ? `${input.profile.yearsExperience} years of professional experience.`
      : null,
  );
  addProfileEvidence(
    "profile:professionalSummary:shortValueProposition",
    input.profile.professionalSummary.shortValueProposition,
  );
  addProfileEvidence(
    "profile:professionalSummary:fullSummary",
    input.profile.professionalSummary.fullSummary,
  );
  addProfileEvidence(
    "profile:professionalSummary:leadershipSummary",
    input.profile.professionalSummary.leadershipSummary,
  );
  addProfileEvidence(
    "profile:professionalSummary:domainFocusSummary",
    input.profile.professionalSummary.domainFocusSummary,
  );
  input.profile.professionalSummary.careerThemes.forEach((text, index) => {
    addProfileEvidence(
      `profile:professionalSummary:careerTheme:${index}`,
      text,
    );
  });
  input.profile.professionalSummary.strengths.forEach((text, index) => {
    addProfileEvidence(`profile:professionalSummary:strength:${index}`, text);
  });
  addProfileEvidence(
    "profile:narrative:professionalStory",
    input.profile.narrative.professionalStory,
  );
  addProfileEvidence(
    "profile:narrative:careerTransitionSummary",
    input.profile.narrative.careerTransitionSummary,
  );
  input.profile.narrative.differentiators.forEach((text, index) => {
    addProfileEvidence(`profile:narrative:differentiator:${index}`, text);
  });
  addProfileEvidence(
    "profile:skills",
    input.profile.skills.length > 0 ? input.profile.skills.join(", ") : null,
  );
  for (const [group, skills] of [
    ["coreSkills", input.profile.skillGroups.coreSkills],
    ["tools", input.profile.skillGroups.tools],
    [
      "languagesAndFrameworks",
      input.profile.skillGroups.languagesAndFrameworks,
    ],
    ["softSkills", input.profile.skillGroups.softSkills],
    ["highlightedSkills", input.profile.skillGroups.highlightedSkills],
  ] as const) {
    addProfileEvidence(
      `profile:skillGroup:${group}`,
      skills.length > 0 ? skills.join(", ") : null,
    );
  }

  input.profile.experiences.forEach((experience) => {
    pushEvidenceItem(items, seenIds, {
      id: `experience:${experience.id}:summary`,
      text: experience.summary,
      scope: "experience",
      profileRecordId: experience.id,
    });
    experience.achievements.forEach((text, index) => {
      pushEvidenceItem(items, seenIds, {
        id: `experience:${experience.id}:achievement:${index}`,
        text,
        scope: "experience",
        profileRecordId: experience.id,
      });
    });
    pushEvidenceItem(items, seenIds, {
      id: `experience:${experience.id}:skills`,
      text: experience.skills.length > 0 ? experience.skills.join(", ") : null,
      scope: "experience",
      profileRecordId: experience.id,
    });
    pushEvidenceItem(items, seenIds, {
      id: `experience:${experience.id}:domainTags`,
      text:
        experience.domainTags.length > 0
          ? experience.domainTags.join(", ")
          : null,
      scope: "experience",
      profileRecordId: experience.id,
    });
  });

  input.profile.projects.forEach((project) => {
    pushEvidenceItem(items, seenIds, {
      id: `project:${project.id}:summary`,
      text: project.summary,
      scope: "project",
      profileRecordId: project.id,
    });
    pushEvidenceItem(items, seenIds, {
      id: `project:${project.id}:outcome`,
      text: project.outcome,
      scope: "project",
      profileRecordId: project.id,
    });
    pushEvidenceItem(items, seenIds, {
      id: `project:${project.id}:skills`,
      text: project.skills.length > 0 ? project.skills.join(", ") : null,
      scope: "project",
      profileRecordId: project.id,
    });
    pushEvidenceItem(items, seenIds, {
      id: `project:${project.id}:projectType`,
      text: project.projectType,
      scope: "project",
      profileRecordId: project.id,
    });
  });

  input.profile.proofBank.forEach((proof) => {
    for (const [field, text] of [
      ["claim", proof.claim],
      ["heroMetric", proof.heroMetric],
      ["supportingContext", proof.supportingContext],
    ] as const) {
      pushEvidenceItem(items, seenIds, {
        id: `proof:${proof.id}:${field}`,
        text,
        scope: "proof",
        profileRecordId: proof.id,
      });
    }
  });

  if ("evidence" in input && input.evidence) {
    for (const field of [
      "summary",
      "candidateSummary",
      "experience",
    ] as const) {
      input.evidence[field].forEach((text, index) => {
        pushEvidenceItem(items, seenIds, {
          id: `importEvidence:${field}:${index}`,
          text,
          scope: "import_evidence",
          profileRecordId: null,
        });
      });
    }
    for (const field of ["skills", "keywords"] as const) {
      pushEvidenceItem(items, seenIds, {
        id: `importEvidence:${field}`,
        text:
          input.evidence[field].length > 0
            ? input.evidence[field].join(", ")
            : null,
        scope: "import_evidence",
        profileRecordId: null,
      });
    }
  }

  if (input.resumeText?.trim()) {
    pushEvidenceItem(items, seenIds, {
      id: "baseResume:text",
      text: input.resumeText,
      scope: "import_evidence",
      profileRecordId: null,
    });
  }

  return items;
}

export function buildGroundedResumeRewriteModelPayload(
  input: ResumeGenerationInput,
) {
  return {
    ...("strategy" in input && input.strategy
      ? { strategy: input.strategy }
      : {}),
    ...(input.resumeText?.trim() ? { baseResumeText: input.resumeText } : {}),
    targetJob: {
      title: input.job.title,
      company: input.job.company,
      description: compactJobDescriptionForModel(input.job.description),
      responsibilities: input.job.responsibilities,
      minimumQualifications: input.job.minimumQualifications,
      preferredQualifications: input.job.preferredQualifications,
      keySkills: input.job.keySkills,
      keywordSignals: input.job.keywordSignals,
      listingRequestedSkills: collectListingRequestedSkills(input.job),
    },
    ...("researchContext" in input && input.researchContext
      ? { researchContext: input.researchContext }
      : {}),
    groundingEvidence: {
      version: 1,
      items: buildResumeGenerationEvidenceCatalog(input),
    },
  };
}

export function parseEvidenceLinkedText(
  value: unknown,
  companionEvidenceRefs?: unknown,
): ParsedEvidenceLinkedText | null {
  const structured = EvidenceLinkedTextSchema.safeParse(value);
  if (structured.success) {
    return {
      text: structured.data.text,
      evidenceRefs: Array.from(new Set(structured.data.evidenceRefs)),
      inferred: structured.data.inferred === true,
    };
  }

  const text = normalizeNullableText(value);
  if (!text) {
    return null;
  }

  const parsedRefs = EvidenceReferenceListSchema.safeParse(
    companionEvidenceRefs,
  );
  return {
    text,
    evidenceRefs: parsedRefs.success
      ? Array.from(new Set(parsedRefs.data))
      : [],
    inferred: false,
  };
}

export type ResumeClaimGroundingVerdict =
  | "exact"
  | "covered"
  | "elaborated"
  | "weakly_supported"
  | "unsupported";

/**
 * Aggressive-tailoring claim relaxations that let content beyond the cited
 * candidate evidence through the gate. They never make a claim silently
 * accepted: consumers surface every relaxed claim as a user-confirmation
 * state, so the candidate owns the risk of standing behind it.
 */
export type ResumeClaimGroundingRelaxation =
  | "years_rounded_up"
  | "listing_term";

/**
 * Hard gaps are integrity violations that make a claim unpublishable without
 * edits. A classification is `weakly_supported` — a human-confirmation state,
 * never auto-accepted for generation — only when it carries no hard gap.
 */
export type ResumeClaimHardGapType =
  | "claim_too_short"
  | "claim_too_long"
  | "first_person_voice"
  | "unsupported_absolute_claim"
  | "fabricated_metric"
  | "unknown_named_word"
  | "job_only_term"
  | "claim_without_content"
  | "evidence_without_content"
  | "unevidenced_leadership_claim"
  | "unevidenced_credential_claim"
  | "inference_not_allowed"
  | "unsafe_elaboration";

export interface ResumeClaimGroundingGap {
  type: ResumeClaimHardGapType;
  /** Offending metrics, words, terms, or tokens in claim discovery order. */
  values: string[];
}

export interface ResumeClaimGroundingResult {
  verdict: ResumeClaimGroundingVerdict;
  /**
   * Deterministic input-ordered IDs of the evidence union the claim was
   * audited against. Cited pools within the cap are kept verbatim; oversized
   * pools are reduced by greedy anchor coverage (cap included).
   */
  supportEvidenceIds: string[];
  /**
   * Share of distinct claim anchors (metrics, named words, meaningful tokens)
   * found in the selected evidence union, rounded to two decimals.
   */
  anchorRatio: number;
  gaps: ResumeClaimGroundingGap[];
  /**
   * Aggressive-tailoring relaxations that actually authorized content beyond
   * the cited evidence for this claim. Empty unless aggressive relaxation was
   * explicitly enabled; consumers must treat every relaxed claim as needing
   * the candidate's explicit confirmation, never as silently verified.
   */
  relaxations: ResumeClaimGroundingRelaxation[];
}

export interface ResumeClaimGroundingInput {
  text: string;
  evidence: readonly ResumeGenerationEvidenceItem[];
  jobCompany: string;
  jobSkills: readonly string[];
  allowReasonableInference?: boolean;
  /**
   * Compact text of the target job listing (description, responsibilities,
   * qualifications, key skills). Consulted only when aggressive claim
   * relaxation is enabled, and only to bound listing-anchored claims: a
   * technology the claim adds may come from the listing, never from nowhere.
   */
  jobListingText?: string | null;
  /**
   * Enables the aggressive-tailoring claim relaxations (years of experience
   * rounded up from an evidenced figure exactly one year lower to the years
   * figure stated by the listing, and technologies named by the target job
   * listing) on top of the safe-elaboration vocabulary. Requires
   * `allowReasonableInference`. The generation gate enables it only for
   * proposals the model itself flagged `inferred`, so every relaxed line is
   * counted and surfaced for review; the workspace verifier enables it to
   * match the most permissive legitimate generation posture so accepted
   * claims never flip to unsupported after acceptance.
   */
  allowAggressiveClaimRelaxation?: boolean;
}

// Support unions are bounded to the same per-claim citation limit enforced by
// parseEvidenceLinkedText and selectResumeRewrite.
export const RESUME_CLAIM_SUPPORT_EVIDENCE_CAP = 8;

const GENERATION_ACCEPTED_GROUNDING_VERDICTS: ReadonlySet<ResumeClaimGroundingVerdict> =
  new Set(["exact", "covered", "elaborated"] as const);

// Deterministic support selection for direct classifier callers that pass more
// candidate evidence than the citation cap. Items are chosen greedily by how
// many still-uncovered claim anchors they add, weighted metrics > named words
// > meaningful tokens, with strict-greater comparison so ties resolve to the
// earliest input position. Pools already within the cap are kept verbatim in
// input order: cited evidence is the audited union, and dropping zero-gain
// citations could silently flip gate outcomes (for example substring-only or
// phrase-only authorizations) for generation rewrites.
function selectResumeClaimSupportEvidence(
  claimText: string,
  pool: readonly ResumeGenerationEvidenceItem[],
): ResumeGenerationEvidenceItem[] {
  if (pool.length <= RESUME_CLAIM_SUPPORT_EVIDENCE_CAP) {
    return [...pool];
  }

  const claimMetrics = Array.from(new Set(normalizedMetrics(claimText)));
  const claimNamedWords = Array.from(new Set(capitalizedNamedWords(claimText)));
  const claimTokens = meaningfulTokens(claimText);

  const itemSnapshots = pool.map((item) => ({
    item,
    metrics: new Set(normalizedMetrics(item.text)),
    lowercaseText: item.text.toLowerCase(),
    tokens: new Set(meaningfulTokens(item.text)),
  }));

  const coveredMetrics = new Set<string>();
  const coveredNamedWords = new Set<string>();
  const coveredTokens = new Set<string>();
  const selectedIndexes = new Set<number>();

  while (selectedIndexes.size < RESUME_CLAIM_SUPPORT_EVIDENCE_CAP) {
    let bestIndex = -1;
    let bestGain = 0;
    itemSnapshots.forEach((snapshot, index) => {
      if (selectedIndexes.has(index)) {
        return;
      }
      const metricGain = claimMetrics.filter(
        (metric) => snapshot.metrics.has(metric) && !coveredMetrics.has(metric),
      ).length;
      const namedGain = claimNamedWords.filter(
        (word) =>
          snapshot.lowercaseText.includes(word) && !coveredNamedWords.has(word),
      ).length;
      const tokenGain = claimTokens.filter(
        (token) => snapshot.tokens.has(token) && !coveredTokens.has(token),
      ).length;
      const gain = metricGain * 3 + namedGain * 2 + tokenGain;
      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = index;
      }
    });
    if (bestIndex < 0 || bestGain === 0) {
      break;
    }

    selectedIndexes.add(bestIndex);
    const best = itemSnapshots[bestIndex];
    if (!best) {
      break;
    }
    claimMetrics.forEach((metric) => {
      if (best.metrics.has(metric)) {
        coveredMetrics.add(metric);
      }
    });
    claimNamedWords.forEach((word) => {
      if (best.lowercaseText.includes(word)) {
        coveredNamedWords.add(word);
      }
    });
    claimTokens.forEach((token) => {
      if (best.tokens.has(token)) {
        coveredTokens.add(token);
      }
    });
  }

  return pool.filter((_, index) => selectedIndexes.has(index));
}

export function classifyResumeClaimGrounding(
  input: ResumeClaimGroundingInput,
): ResumeClaimGroundingResult {
  const allowReasonableInference = input.allowReasonableInference ?? false;
  // Relaxation requires the aggressive posture itself: no caller can widen
  // claim acceptance without also opting into reasonable inference.
  const allowAggressiveClaimRelaxation =
    allowReasonableInference && (input.allowAggressiveClaimRelaxation ?? false);
  const jobListingText = allowAggressiveClaimRelaxation
    ? (normalizeNullableText(input.jobListingText) ?? "")
    : "";
  const jobListingUnits = new Set(
    allowAggressiveClaimRelaxation ? gateUnits(jobListingText) : [],
  );
  const listingYearsNumbers = new Set(
    allowAggressiveClaimRelaxation
      ? extractYearsOfExperienceNumbers(jobListingText)
      : [],
  );
  const trimmed = input.text.trim();
  const supportEvidence = selectResumeClaimSupportEvidence(
    trimmed,
    input.evidence,
  );
  const supportEvidenceIds = supportEvidence.map((item) => item.id);

  const relaxations = new Set<ResumeClaimGroundingRelaxation>();
  const gaps: ResumeClaimGroundingGap[] = [];
  const pushGap = (
    type: ResumeClaimHardGapType,
    values: readonly string[] = [],
  ) => {
    gaps.push({ type, values: [...values] });
  };

  // Gate order below mirrors the historical rewrite predicate exactly so the
  // generation acceptance set stays byte-for-byte identical.
  if (trimmed.length < 12) {
    pushGap("claim_too_short");
  }
  if (trimmed.length > 1_000) {
    pushGap("claim_too_long");
  }
  if (FIRST_PERSON_PATTERN.test(trimmed)) {
    pushGap("first_person_voice");
  }
  if (UNSUPPORTED_ABSOLUTE_CLAIM_PATTERN.test(trimmed)) {
    pushGap("unsupported_absolute_claim");
  }

  const evidenceText = supportEvidence.map((item) => item.text).join(" ");
  const evidenceMetrics = new Set(normalizedMetrics(evidenceText));
  // Aggressive relaxation only: a years-of-experience figure may be rounded
  // up from an evidenced figure exactly one year lower to the years figure
  // stated by the listing (3 evidenced years may be stated as a listed 4).
  // Every other metric still requires verbatim evidence in every mode, so
  // percentages, money, and counts stay fail-closed.
  const evidenceYearsNumbers = new Set(
    allowAggressiveClaimRelaxation
      ? extractYearsOfExperienceNumbers(evidenceText)
      : [],
  );
  const claimYearsNumbers = new Set(extractYearsOfExperienceNumbers(trimmed));
  const fabricatedMetrics = normalizedMetrics(trimmed).filter((metric) => {
    if (evidenceMetrics.has(metric)) {
      return false;
    }
    if (
      allowAggressiveClaimRelaxation &&
      isRoundedUpYearsMetric(
        metric,
        claimYearsNumbers,
        evidenceYearsNumbers,
        listingYearsNumbers,
      )
    ) {
      relaxations.add("years_rounded_up");
      return false;
    }
    return true;
  });
  if (fabricatedMetrics.length > 0) {
    pushGap("fabricated_metric", fabricatedMetrics);
  }

  // Named words are capitalized tokens that are not plain sentence starts:
  // technologies, frameworks, tools, services, products, employers, and other
  // proper nouns. They must come from the cited evidence in every mode, with
  // one aggressive relaxation: a named word the target job listing itself
  // uses may anchor a flagged inferred claim (a listing technology), never
  // one invented from nowhere.
  // Aggressive rewrites are additionally gated by the fail-closed lexical
  // policy below (SAFE_ELABORATION_TOKENS): unevidenced technology, product,
  // or brand tokens reject regardless of casing or sentence position.
  const evidenceLowercaseText = evidenceText.toLowerCase();
  const unknownNamedWords = capitalizedNamedWords(trimmed).filter((word) => {
    if (evidenceLowercaseText.includes(word)) {
      return false;
    }
    // Token-bound matching only: listing prose such as "reaction" must not
    // authorize "React" through substring containment.
    if (
      allowAggressiveClaimRelaxation &&
      jobListingUnits.has(normalizeToken(word))
    ) {
      relaxations.add("listing_term");
      return false;
    }
    return true;
  });
  if (unknownNamedWords.length > 0) {
    pushGap("unknown_named_word", unknownNamedWords);
  }

  const jobOnlyTerms = [input.jobCompany, ...input.jobSkills].filter((term) => {
    if (!normalizeNullableText(term)) {
      return false;
    }
    if (!phraseAppears(trimmed, term)) {
      return false;
    }
    if (phraseAppears(evidenceText, term)) {
      return false;
    }
    // Aggressive relaxation only: a job-listing skill may anchor a flagged
    // inferred claim (the candidate plausibly used a technology the listing
    // asks for) only when the listing text itself states that term. The
    // employer itself stays evidence-required in every mode, so the gate
    // never authorizes borrowed work history.
    if (
      allowAggressiveClaimRelaxation &&
      input.jobSkills.includes(term) &&
      phraseAppears(jobListingText, term)
    ) {
      relaxations.add("listing_term");
      return false;
    }
    return true;
  });
  if (jobOnlyTerms.length > 0) {
    pushGap("job_only_term", jobOnlyTerms);
  }

  const generatedTokens = meaningfulTokens(trimmed);
  const evidenceTokens = new Set(meaningfulTokens(evidenceText));
  if (generatedTokens.length === 0) {
    pushGap("claim_without_content");
  } else if (evidenceTokens.size === 0) {
    pushGap("evidence_without_content");
  }

  if (
    LEADERSHIP_CLAIM_PATTERN.test(trimmed) &&
    !LEADERSHIP_CLAIM_PATTERN.test(evidenceText)
  ) {
    pushGap("unevidenced_leadership_claim");
  }
  if (
    CREDENTIAL_CLAIM_PATTERN.test(trimmed) &&
    !CREDENTIAL_CLAIM_PATTERN.test(evidenceText)
  ) {
    pushGap("unevidenced_credential_claim");
  }

  const anchorCoverage = new Map<string, boolean>();
  const recordAnchor = (anchor: string, covered: boolean) => {
    anchorCoverage.set(
      anchor,
      (anchorCoverage.get(anchor) ?? false) || covered,
    );
  };
  Array.from(new Set(normalizedMetrics(trimmed))).forEach((metric) => {
    recordAnchor(metric, evidenceMetrics.has(metric));
  });
  Array.from(new Set(capitalizedNamedWords(trimmed))).forEach((word) => {
    recordAnchor(word, evidenceLowercaseText.includes(word));
  });
  generatedTokens.forEach((token) => {
    recordAnchor(token, evidenceTokens.has(token));
  });
  const totalAnchors = anchorCoverage.size;
  const coveredAnchors = Array.from(anchorCoverage.values()).filter(
    (covered) => covered,
  ).length;
  const anchorRatio =
    totalAnchors === 0
      ? 0
      : Math.round((coveredAnchors / totalAnchors) * 100) / 100;

  if (gaps.length > 0) {
    return {
      verdict: "unsupported",
      supportEvidenceIds,
      anchorRatio,
      gaps,
      relaxations: [...relaxations],
    };
  }

  const unmatchedTokens = generatedTokens.filter(
    (token) => !evidenceTokens.has(token),
  );
  const matchedTokens = generatedTokens.length - unmatchedTokens.length;

  // Thin lexical overlap short-circuits before mode-specific elaboration
  // policy, mirroring the historical check order: content without a hard gap
  // but with too little shared wording is weak support needing confirmation,
  // not an integrity violation.
  if (matchedTokens < Math.min(2, generatedTokens.length)) {
    return {
      verdict: "weakly_supported",
      supportEvidenceIds,
      anchorRatio,
      gaps: [],
      relaxations: [...relaxations],
    };
  }

  if (!allowReasonableInference) {
    if (unmatchedTokens.length > 0) {
      pushGap("inference_not_allowed", unmatchedTokens);
      return {
        verdict: "unsupported",
        supportEvidenceIds,
        anchorRatio,
        gaps,
        relaxations: [...relaxations],
      };
    }
  } else {
    // Aggressive tailoring may elaborate beyond the cited wording, but the
    // elaboration is fail-closed at the lexical level: every normalized token
    // the cited evidence does not contain must belong to the bounded
    // ordinary-prose vocabulary (SAFE_ELABORATION_TOKENS). Concrete anchors are
    // already protected above — numbers and metrics, named words, job-only
    // skills, leadership claims, and credentials — and everything unrecognized,
    // including new or unknown brands, products, and technologies in any casing
    // or sentence position, rejects here. Conservative false negatives are
    // preferred over invented facts; no proportional cap is needed because
    // unmatched content is bounded to explicitly safe prose, with one
    // aggressive relaxation: units the target job listing itself uses may
    // anchor a flagged inferred claim (a listing technology), so the added
    // terms stay bounded to what the employer asked for.
    const evidenceGateUnits = new Set(gateUnits(evidenceText));
    const unsafeUnits = gateUnits(trimmed).filter((unit) => {
      if (evidenceGateUnits.has(unit) || SAFE_ELABORATION_TOKENS.has(unit)) {
        return false;
      }
      if (allowAggressiveClaimRelaxation && jobListingUnits.has(unit)) {
        relaxations.add("listing_term");
        return false;
      }
      return true;
    });
    if (unsafeUnits.length > 0) {
      pushGap("unsafe_elaboration", unsafeUnits);
      return {
        verdict: "unsupported",
        supportEvidenceIds,
        anchorRatio,
        gaps,
        relaxations: [...relaxations],
      };
    }
  }

  // Exact means the trimmed claim appears verbatim at word boundaries inside
  // the normalized selected-evidence union; otherwise full anchor coverage is
  // "covered" and safe-elaborated claims are "elaborated".
  const normalizedClaim = normalizedComparableText(trimmed);
  const isExact =
    normalizedClaim.length > 0 &&
    ` ${normalizedComparableText(evidenceText)} `.includes(
      ` ${normalizedClaim} `,
    );

  return {
    verdict: isExact
      ? "exact"
      : unmatchedTokens.length === 0
        ? "covered"
        : "elaborated",
    supportEvidenceIds,
    anchorRatio,
    gaps: [],
    relaxations: [...relaxations],
  };
}

function capitalizedNamedWords(value: string): string[] {
  const matches = Array.from(value.matchAll(/[A-Za-z][A-Za-z0-9+#.%-]*/g));
  const named: string[] = [];
  matches.forEach((match, index) => {
    const word = match[0];
    if (!/^[A-Z]/.test(word)) {
      return;
    }
    const prefix = value.slice(0, match.index ?? 0);
    const trimmedPrefix = prefix.trimEnd();
    if (index === 0 || /[.!?:;\n\u2013\u2014]\s*$/.test(trimmedPrefix)) {
      return;
    }
    // Sentence-final punctuation must not leak into the checked word
    // ("PostgreSQL." should be validated as "postgresql").
    named.push(word.toLowerCase().replace(/\.+$/, ""));
  });
  return named;
}

// Fail-closed lexical policy for aggressive free-text rewrites: every
// normalized generated token that is not present in the cited candidate
// evidence must belong to this bounded ordinary-prose vocabulary, or the
// rewrite is rejected. There is deliberately no technology allowlist or
// blacklist: any unknown, new, misspelled, or ambiguous token — brand,
// product, library, protocol, acronym, or technology homograph such as "go",
// "swift", "rails", "express", "spring", "flask", "bun", "temporal" — is
// evidence-required by default, including in lowercase or sentence-initial
// position. Conservative false negatives are preferred over invented facts.
// Entries are seeded from the supported elaboration language exercised by the
// grounding tests and stay strictly non-domain and non-product: connectors,
// modifiers, elaboration verbs, and generic engineering nouns that cannot
// assert a named tool.
const SAFE_ELABORATION_TOKEN_LIST = [
  // Connector synonyms and elaboration verb groups (leadership group
  // excluded: leading/directing/owning must always come from evidence).
  "group_0",
  "group_1",
  "group_2",
  "group_4",
  "group_5",
  "group_6",
  "group_7",
  // Connectors, quantifiers, and time/place framing.
  "across",
  "after",
  "again",
  "against",
  "all",
  "also",
  "although",
  "always",
  "among",
  "another",
  "any",
  "around",
  "because",
  "before",
  "behind",
  "below",
  "besides",
  "between",
  "beyond",
  "both",
  "during",
  "each",
  "either",
  "else",
  "enough",
  "especially",
  "even",
  "ever",
  "every",
  "first",
  "following",
  "further",
  "furthermore",
  "hence",
  "however",
  "instead",
  "later",
  "meanwhile",
  "moreover",
  "most",
  "mostly",
  "much",
  "namely",
  "nearly",
  "notably",
  "often",
  "once",
  "only",
  "overall",
  "particularly",
  "per",
  "plus",
  "primarily",
  "previously",
  "recently",
  "roughly",
  "second",
  "several",
  "significantly",
  "similarly",
  "since",
  "sometimes",
  "soon",
  "still",
  "such",
  "then",
  "there",
  "therefore",
  "though",
  "throughout",
  "thus",
  "together",
  "toward",
  "towards",
  "twice",
  "typically",
  "under",
  "until",
  "upon",
  "usually",
  "well",
  "while",
  "within",
  "without",
  "yet",
  // Generic modifiers.
  "additional",
  "advanced",
  "annual",
  "available",
  "back",
  "backed",
  "became",
  "better",
  "big",
  "bigger",
  "central",
  "clean",
  "clear",
  "close",
  "common",
  "complete",
  "complex",
  "concise",
  "consistent",
  "continuous",
  "core",
  "correct",
  "critical",
  "current",
  "currently",
  "custom",
  "daily",
  "deep",
  "different",
  "difficult",
  "direct",
  "distributed",
  "distribut",
  "dual",
  "early",
  "easy",
  "efficient",
  "existing",
  "external",
  "extra",
  "faster",
  "flexible",
  "focused",
  "full",
  "global",
  "greater",
  "high",
  "higher",
  "hourly",
  "internal",
  "large",
  "larger",
  "last",
  "late",
  "latest",
  "light",
  "local",
  "long",
  "longer",
  "low",
  "lower",
  "main",
  "major",
  "minimal",
  "minor",
  "modern",
  "modular",
  "monthly",
  "needed",
  "new",
  "newer",
  "nightly",
  "notable",
  "ongoing",
  "online",
  "operational",
  "optional",
  "original",
  "other",
  "parallel",
  "partial",
  "periodic",
  "practical",
  "precise",
  "predictable",
  "primary",
  "private",
  "proven",
  "public",
  "quick",
  "quicker",
  "rapid",
  "redundant",
  "regional",
  "regular",
  "related",
  "relevant",
  "reliab",
  "repeatable",
  "resilient",
  "responsive",
  "robust",
  "seamless",
  "secondary",
  "secure",
  "shared",
  "short",
  "shorter",
  "simple",
  "single",
  "slow",
  "small",
  "smaller",
  "smooth",
  "specialized",
  "stable",
  "standalone",
  "standard",
  "steady",
  "strategic",
  "strong",
  "stronger",
  "successful",
  "sustainable",
  "tailored",
  "technical",
  "thorough",
  "tight",
  "timely",
  "top",
  "total",
  "transparent",
  "typical",
  "unique",
  "unified",
  "upcoming",
  "upper",
  "visible",
  "weekly",
  "whole",
  "wide",
  "wider",
  "yearly",
  // Elaboration verbs (normalized stems).
  "acros",
  "across",
  "adopt",
  "align",
  "appl",
  "apply",
  "archiv",
  "automat",
  "captur",
  "centraliz",
  "clarifi",
  "combin",
  "consolidat",
  "coordinat",
  "cutt",
  "debug",
  "defin",
  "deploy",
  "describ",
  "detect",
  "diagnos",
  "diagnose",
  "document",
  "doubl",
  "draft",
  "eliminat",
  "embed",
  "enabl",
  "ensur",
  "establish",
  "evaluat",
  "expand",
  "explor",
  "extend",
  "facilitat",
  "facing",
  "featur",
  "finaliz",
  "focus",
  "formaliz",
  "gather",
  "handl",
  "identifi",
  "incorpor",
  "integrat",
  "introduc",
  "keep",
  "lazy",
  "learn",
  "leverag",
  "map",
  "mapp",
  "migrat",
  "moderniz",
  "modul",
  "module",
  "monitor",
  "mov",
  "navigat",
  "onboard",
  "organize",
  "organiz",
  "outlin",
  "pair",
  "pilot",
  "pivot",
  "plan",
  "prepar",
  "prioritiz",
  "prototyp",
  "publish",
  "ran",
  "refactor",
  "replac",
  "report",
  "research",
  "resolv",
  "respond",
  "restor",
  "review",
  "revis",
  "run",
  "rout",
  "route",
  "scale",
  "scal",
  "schedul",
  "sequenc",
  "shap",
  "shipp",
  "split",
  "splitt",
  "streamlin",
  "structur",
  "track",
  "train",
  "transfer",
  "translat",
  "triage",
  "triag",
  "troubleshoot",
  "tun",
  "tune",
  "updat",
  "upgrad",
  "validat",
  "verifi",
  "visualiz",
  "write",
  "wrote",
  "written",
  "writ",
  // Generic engineering and process nouns that cannot assert a named tool,
  // service, vendor, or product.
  "algorithm",
  "analytic",
  "app",
  "architectur",
  "backend",
  "backlog",
  "backup",
  "batch",
  "benchmark",
  "browser",
  "cach",
  "cache",
  "capability",
  "chatbot",
  "checklist",
  "client",
  "cluster",
  "code",
  "codebas",
  "column",
  "component",
  "comput",
  "config",
  "configuration",
  "connector",
  "console",
  "container",
  "contract",
  "coverage",
  "customer",
  "dashboard",
  "data",
  "database",
  "dataset",
  "deadline",
  "deployment",
  "developer",
  "device",
  "discovery",
  "distribution",
  "documentation",
  "domain",
  "email",
  "endpoint",
  "engine",
  "engineer",
  "environment",
  "error",
  "event",
  "experiment",
  "feature",
  "feed",
  "file",
  "finance",
  "flag",
  "flow",
  "form",
  "formula",
  "framework",
  "frontend",
  "function",
  "functionality",
  "funnel",
  "gateway",
  "guideline",
  "handler",
  "hardware",
  "history",
  "homepage",
  "hook",
  "image",
  "incident",
  "index",
  "infrastructur",
  "ingestion",
  "input",
  "integration",
  "interface",
  "inventory",
  "issue",
  "item",
  "iteration",
  "job",
  "label",
  "latency",
  "layer",
  "library",
  "limit",
  "link",
  "list",
  "listing",
  "load",
  "localization",
  "log",
  "logic",
  "login",
  "lookup",
  "loop",
  "maintenance",
  "message",
  "metric",
  "migration",
  "mock",
  "model",
  "module",
  "notification",
  "object",
  "onboarding",
  "operation",
  "optimization",
  "order",
  "outcome",
  "output",
  "package",
  "page",
  "panel",
  "parameter",
  "parse",
  "partner",
  "pattern",
  "performance",
  "permission",
  "pipeline",
  "platform",
  "playbook",
  "practice",
  "process",
  "product",
  "production",
  "profile",
  "project",
  "prompt",
  "quer",
  "queri",
  "query",
  "queue",
  "rate",
  "record",
  "regression",
  "region",
  "reliability",
  "reminder",
  "render",
  "repair",
  "request",
  "requirement",
  "response",
  "retry",
  "retri",
  "roadmap",
  "routine",
  "rule",
  "runtime",
  "schema",
  "screen",
  "script",
  "search",
  "security",
  "sequence",
  "service",
  "session",
  "signup",
  "snapshot",
  "source",
  "spec",
  "specification",
  "stack",
  "stakeholder",
  "state",
  "status",
  "storage",
  "store",
  "strategy",
  "stream",
  "structure",
  "summary",
  "sync",
  "system",
  "table",
  "tag",
  "task",
  "team",
  "template",
  "test",
  "technology",
  "throughput",
  "tier",
  "time",
  "timeline",
  "timeout",
  "tool",
  "toolkit",
  "transaction",
  "transition",
  "trigger",
  "uptime",
  "usage",
  "user",
  "validation",
  "vendor",
  "version",
  "view",
  "viewer",
  "widget",
  "workflow",
  "workspace",
  "workload",
  "end",
  "menu",
  "staff",
  "reservation",
  "ritual",
  "organization",
];
const SAFE_ELABORATION_TOKENS = new Set(
  SAFE_ELABORATION_TOKEN_LIST.flatMap((word) => [word, normalizeToken(word)]),
);

// Gate tokens keep technology spellings intact ("c++"), then split
// punctuation-joined compounds at separators so evidence compounds such as
// "Redis-based" authorize their components ("redis") without authorizing
// unrelated substrings ("restaurant" never yields "rest"). Matching is
// token-boundary based end to end; there is no substring containment check.
const GATE_TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9+#._/-]*/g;

function gateUnits(value: string): string[] {
  const units = new Set<string>();
  for (const match of value.matchAll(GATE_TOKEN_PATTERN)) {
    const lower = match[0].toLowerCase();
    if (!/[a-z]/.test(lower)) {
      continue;
    }
    const segments = lower
      .split(/[._/-]+/)
      .filter((segment) => /[a-z]/.test(segment));
    // Always reduce through the separator split so sentence-final
    // punctuation ("postgresql.") cannot leak into the checked unit.
    const parts = segments.length > 1 ? segments : [segments[0]];
    for (const part of parts) {
      if (!part || part.length < 2) {
        continue;
      }
      const unit = normalizeToken(part);
      if (
        unit.length >= 2 &&
        /[a-z]/.test(unit) &&
        !RESUME_STOP_WORDS.has(unit)
      ) {
        units.add(unit);
      }
    }
  }
  return Array.from(units);
}

/**
 * Whether a term appears as a token in the target job listing text. Used by
 * the skills-section relaxation: a job-requested technology (Kubernetes,
 * shadcn, Python) may enter an aggressive resume's skills when the listing
 * itself names it — the bound is the listing, never a technology invented
 * from nowhere. Token-bound matching keeps listing prose such as "reaction"
 * from authorizing "React".
 */
export function listingTextContainsTerm(
  listingText: string,
  term: string,
): boolean {
  const normalizedTerm = normalizeToken(term.trim());
  if (normalizedTerm.length < 2) {
    return false;
  }
  return new Set(gateUnits(listingText)).has(normalizedTerm);
}

const MAX_LISTING_REQUESTED_SKILLS = 16;
export const MAX_AGGRESSIVE_LISTING_CORE_SKILLS = 6;

/**
 * Listing fields the aggressive skills injector may harvest. Structured
 * `keySkills` come first; qualification and skill-prompt prose fill gaps when
 * extraction left those fields as sentences instead of a skill list.
 */
export interface ListingRequestedSkillJob {
  location?: string | null;
  keySkills?: readonly string[] | null;
  keywordSignals?: readonly { kind: string; label: string }[] | null;
  minimumQualifications?: readonly string[] | null;
  preferredQualifications?: readonly string[] | null;
  responsibilities?: readonly string[] | null;
  description?: string | null;
  summary?: string | null;
  /** The job title and employer name are names, not skills the job asks for. */
  title?: string | null;
  company?: string | null;
}

function listingTextMentions(text: string, phrase: string): boolean {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    escaped.length > 0 &&
    new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "iu").test(text)
  );
}

function stripListingNames(text: string, names: readonly string[]): string {
  return names.reduce(
    (current, name) => current.split(name).join(" "),
    text,
  );
}

const LISTING_SKILL_PROMPT_PATTERN =
  /\b(?:experience (?:with|in|using)|proficien(?:t|cy) (?:in|with)|familiar(?:ity)? with|knowledge of|skilled (?:in|with)|expertise (?:in|with)|hands-?on (?:with|in)|work(?:s|ed|ing)? (?:with|knowledge of)|written (?:in|with)|pipelines? (?:in|with|using)|must (?:have|know)|(?:required|preferred)\s*:?|(?:including|such as)|(?:tech(?:nology)? stack|stack)\s*:?)\s+([^.;:\n]+)/giu;

const LISTING_SKILL_TITLE_CASE_PATTERN =
  /\b(?:C(?:\+\+|#)|F#|\.[A-Za-z][A-Za-z0-9+#.]{1,}|[A-Z][A-Za-z0-9+#.]*(?:[+\-/.][A-Za-z0-9+#.]+)*)(?:\b(?![+#])|(?<=[+#]))/g;

const LISTING_SKILL_SHORT_TECH = new Set(["go", "qt", "c#", "f#", "c++"]);

const LISTING_SKILL_HR_ACRONYMS = new Set([
  "eeo",
  "pto",
  "usa",
  "usd",
  "uk",
  "eu",
  "nyc",
  "ceo",
  "cto",
  "vp",
  "hr",
  "nda",
  "doe",
  "tbd",
]);

const LISTING_SKILL_FLUFF_TOKENS = new Set([
  "a",
  "an",
  "and",
  "or",
  "the",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "using",
  "via",
  "as",
  "at",
  "by",
  "from",
  "strong",
  "excellent",
  "outstanding",
  "proven",
  "evidence",
  "practical",
  "required",
  "preferred",
  "plus",
  "etc",
  "including",
  "such",
  "both",
  "either",
  "across",
  "within",
  "years",
  "year",
  "yrs",
  "yr",
  "bachelor",
  "bachelors",
  "master",
  "masters",
  "degree",
  "diploma",
  "phd",
  "doctorate",
  "equivalent",
  "related",
  "field",
  "ability",
  "abilities",
  "able",
  "must",
  "have",
  "has",
  "communication",
  "communications",
  "clear",
  "teamwork",
  "collaboration",
  "collaborative",
  "leadership",
  "stakeholder",
  "stakeholders",
  "ownership",
  "delivery",
  "problem",
  "solving",
  "attention",
  "detail",
  "self",
  "motivated",
  "fast",
  "paced",
  "equal",
  "opportunity",
  "benefits",
  "salary",
  "visa",
  "sponsorship",
  "clearance",
  "education",
  "university",
  "college",
  "environment",
  "passionate",
  "passion",
  "understanding",
  "track",
  "record",
  "background",
  "experience",
  "experiences",
  "knowledge",
  "skills",
  "skill",
  "work",
  "working",
  "authorization",
  "authorized",
  "deep",
  "solid",
  "hands",
  "minimum",
  "bonus",
  "nice",
  "candidate",
  "candidates",
  "team",
  "teams",
  "people",
  "customer",
  "customers",
  "business",
  "role",
  "position",
  "job",
  "our",
  "we",
  "you",
  "your",
  "english",
  "written",
  "verbal",
  "oral",
  "demonstrated",
  "own",
  "owning",
  "roadmap",
  "product",
  "design",
  "systems",
  "workflow",
  "platform",
  "cloud",
  "computer",
  "science",
  "engineering",
  "engineer",
  "developer",
  "software",
  "professional",
  "proficient",
  "proficiency",
  "expertise",
  "exposure",
  "fluency",
  "fluent",
  "competency",
  "competence",
  "familiarity",
  "familiar",
  "responsibility",
  "responsibilities",
  "qualification",
  "qualifications",
  "requirement",
  "requirements",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
]);

// Verbs and bare nouns that title-case harvest must not treat as skills
// ("Build pipelines…", "Services written in Go"). They are not affix fluff:
// stripping them would turn "Amazon Web Services" into "Amazon Web".
const LISTING_SKILL_STANDALONE_REJECT = new Set([
  "build",
  "built",
  "building",
  "service",
  "services",
  "certified",
  "certification",
  "certificate",
  "architect",
  "solutions",
]);

function isRejectedListingSkillToken(token: string): boolean {
  return (
    LISTING_SKILL_FLUFF_TOKENS.has(token) ||
    LISTING_SKILL_STANDALONE_REJECT.has(token)
  );
}

function listingSkillTokenKey(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9+#.]+/gu, "");
}

function stripListingSkillFluffAffixes(phrase: string): string {
  const tokens = phrase.split(/[\s,]+/u).filter(Boolean);
  while (tokens.length > 0) {
    const key = listingSkillTokenKey(tokens[0] ?? "");
    if (key.length < 2 || LISTING_SKILL_FLUFF_TOKENS.has(key)) {
      tokens.shift();
      continue;
    }
    break;
  }
  while (tokens.length > 0) {
    const key = listingSkillTokenKey(tokens[tokens.length - 1] ?? "");
    if (key.length < 2 || LISTING_SKILL_FLUFF_TOKENS.has(key)) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.join(" ");
}

function uniqueListingSkillNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = canonicalSkillPhrase(trimmed) || trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function splitListingSkillList(tail: string): string[] {
  return tail
    .split(/\s*(?:,|;|\band\b|\bor\b)\s*/iu)
    .map((part) =>
      part
        .replace(/^(?:and|or|plus)\s+/iu, "")
        .replace(/^[:\-–—]\s*/u, "")
        .replace(/[.)]+$/u, "")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter((part) => part.length >= 2 && part.length <= 48);
}

export function isInjectableListingSkillName(phrase: string): boolean {
  const trimmed = phrase.trim();
  return (
    looksLikeListingTechnology(trimmed, { fromPrompt: false }) ||
    looksLikeCompoundListingProductName(trimmed)
  );
}

function looksLikeCompoundListingProductName(phrase: string): boolean {
  const trimmed = phrase
    .replace(/^[^A-Za-z0-9+#.]+|[^A-Za-z0-9+#.]+$/gu, "")
    .trim();
  if (trimmed.length < 4 || trimmed.length > 48) {
    return false;
  }
  const tokens = trimmed.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) {
    return false;
  }
  const content = tokens.filter((token) => {
    const key = listingSkillTokenKey(token);
    return key.length >= 2 && !LISTING_SKILL_FLUFF_TOKENS.has(key);
  });
  if (content.length < 2) {
    return false;
  }
  return content.every((token) => {
    if (LISTING_SKILL_SHORT_TECH.has(listingSkillTokenKey(token))) {
      return true;
    }
    return /^(?:[A-Z]{2,6}|[A-Z][A-Za-z0-9+#.]*)$/u.test(token);
  });
}

function looksLikeListingTechnology(
  phrase: string,
  options: { fromPrompt: boolean },
): boolean {
  const trimmed = phrase
    .replace(/^[^A-Za-z0-9+#.]+|[^A-Za-z0-9+#.]+$/gu, "")
    .trim();
  if (trimmed.length < 2 || trimmed.length > 48) {
    return false;
  }
  if (/\d/u.test(trimmed) && /\byears?\b/iu.test(trimmed)) {
    return false;
  }

  if (
    !/\s/u.test(trimmed) &&
    trimmed.includes("-") &&
    !/[+#./]/u.test(trimmed)
  ) {
    const parts = trimmed.split("-").filter(Boolean);
    return parts.some((part) =>
      looksLikeListingTechnology(part, { fromPrompt: false }),
    );
  }

  const tokens = trimmed.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }
  const lowerTokens = tokens.map((token) =>
    token.toLowerCase().replace(/[^a-z0-9+#.]+/gu, ""),
  );
  if (
    lowerTokens.every(
      (token) => isRejectedListingSkillToken(token) || token.length < 2,
    )
  ) {
    return false;
  }
  if (/[+#]/u.test(trimmed) || /\./u.test(trimmed) || /\//u.test(trimmed)) {
    return true;
  }
  if (tokens.length === 1 && /[A-Z][a-z]+[A-Z]/u.test(trimmed)) {
    return true;
  }
  if (tokens.length === 1) {
    const token = tokens[0] ?? "";
    const lower = token.toLowerCase();
    if (isRejectedListingSkillToken(lower)) {
      return false;
    }
    if (LISTING_SKILL_SHORT_TECH.has(listingSkillTokenKey(token))) {
      return true;
    }
    if (/^[A-Z]{2,6}$/u.test(token)) {
      return !LISTING_SKILL_HR_ACRONYMS.has(lower);
    }
    return /^[A-Z][A-Za-z0-9+#.]{2,}$/u.test(token);
  }
  if (options.fromPrompt) {
    return isInjectableListingSkillName(trimmed);
  }
  return tokens.every((token) =>
    looksLikeListingTechnology(token, { fromPrompt: false }),
  );
}

function collectPromptCapturedListingSkills(
  lines: readonly string[],
): string[] {
  const captured: string[] = [];
  for (const line of lines) {
    const matches = line.matchAll(LISTING_SKILL_PROMPT_PATTERN);
    for (const match of matches) {
      const tail = match[1];
      if (!tail) {
        continue;
      }
      for (const phrase of splitListingSkillList(tail)) {
        const stripped = stripListingSkillFluffAffixes(phrase);
        if (stripped && isInjectableListingSkillName(stripped)) {
          captured.push(stripped);
        }
      }
    }
  }
  return captured;
}

function collectTitleCaseListingSkills(lines: readonly string[]): string[] {
  const captured: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(LISTING_SKILL_TITLE_CASE_PATTERN)) {
      const token = match[0];
      if (looksLikeListingTechnology(token, { fromPrompt: false })) {
        captured.push(token);
      }
    }
  }
  return captured;
}

/**
 * Technologies the listing itself asks for, including ones that only appear
 * in qualification prose rather than the structured `keySkills` array.
 * Bounded and de-duplicated so screening can see the job's stack without
 * scraping company boilerplate into the skills section.
 */
export function collectListingRequestedSkills(
  job: ListingRequestedSkillJob,
): string[] {
  const structured = [
    ...(job.keySkills ?? []),
    ...(job.keywordSignals ?? [])
      .filter((signal) => signal.kind === "skill" || signal.kind === "tool")
      .map((signal) => signal.label),
  ];
  const qualificationLines = [
    ...(job.minimumQualifications ?? []),
    ...(job.preferredQualifications ?? []),
  ];
  const skillPromptLines = [
    ...qualificationLines,
    ...(job.responsibilities ?? []),
    job.summary ?? "",
    job.description ?? "",
  ].filter((line) => line.trim().length > 0);

  // A page's description repeats the posting title and the employer name
  // ("Full-stack Engineer, Cloud Gardens"). A word that only appears there is
  // a name, not a requested skill, so it never becomes an Aggressive skill.
  const names = [job.title, job.company]
    .map((name) => name?.trim() ?? "")
    .filter((name) => name.length > 0);
  const textWithoutNames = stripListingNames(
    skillPromptLines.join("\n"),
    names,
  );
  const inferred = [
    ...collectPromptCapturedListingSkills(skillPromptLines),
    ...collectTitleCaseListingSkills(qualificationLines),
  ].filter(
    (skill) =>
      !names.some((name) => listingTextMentions(name, skill)) ||
      listingTextMentions(textWithoutNames, skill),
  );

  return uniqueListingSkillNames([...structured, ...inferred])
    .filter(buildResumeSkillContextFilter(job))
    .slice(0, MAX_LISTING_REQUESTED_SKILLS);
}

export function mergeAggressiveVisibleSkills(input: {
  groundedCoreSkills: readonly string[];
  groundedAdditionalSkills: readonly string[];
  listingSkills: readonly string[];
  coreLimit: number;
  additionalLimit: number;
}): {
  coreSkills: string[];
  additionalSkills: string[];
  addedListingSkills: string[];
} {
  const groundedCore = uniqueListingSkillNames(input.groundedCoreSkills);
  const groundedAdditional = uniqueListingSkillNames(
    input.groundedAdditionalSkills,
  );
  const alreadyGrounded = [...groundedCore, ...groundedAdditional];
  const listingNew = uniqueListingSkillNames(input.listingSkills).filter(
    (skill) =>
      !alreadyGrounded.some((grounded) => skillsAreEquivalent(grounded, skill)),
  );
  const listingCore = listingNew.slice(
    0,
    Math.min(
      listingNew.length,
      MAX_AGGRESSIVE_LISTING_CORE_SKILLS,
      input.coreLimit,
    ),
  );
  const groundedCoreKeep = groundedCore.slice(
    0,
    Math.max(0, input.coreLimit - listingCore.length),
  );
  const coreSkills = [...groundedCoreKeep, ...listingCore];
  const leftoverListing = listingNew.filter(
    (skill) => !coreSkills.some((core) => skillsAreEquivalent(core, skill)),
  );
  const additionalGrounded = groundedAdditional.filter(
    (skill) => !coreSkills.some((core) => skillsAreEquivalent(core, skill)),
  );
  const listingAdditional = leftoverListing.slice(0, input.additionalLimit);
  const additionalGroundedKeep = additionalGrounded.slice(
    0,
    Math.max(0, input.additionalLimit - listingAdditional.length),
  );
  const additionalSkills = [...additionalGroundedKeep, ...listingAdditional];
  return {
    coreSkills,
    additionalSkills,
    addedListingSkills: uniqueListingSkillNames([
      ...listingCore,
      ...listingAdditional,
    ]),
  };
}

/**
 * Review and section-regeneration guidance for aggressive drafts. Stating the
 * same bounds as generation keeps a later edit from stripping listing-asked
 * technologies the candidate still has to confirm.
 */
export function describeAggressiveResumeEditPolicy(
  tailoringStrength:
    | "conservative"
    | "balanced"
    | "aggressive"
    | null
    | undefined,
): string | null {
  if (tailoringStrength !== "aggressive") {
    return null;
  }
  return [
    "This draft uses aggressive tailoring to help the resume clear screening for a first interview.",
    "Keep bounded stretches of saved evidence: you may state evidenced years of experience one year higher when the listing itself asks for that figure, and you may name any technology, library, framework, or tool the listing asks for — required or preferred, including technologies named only in qualifications — in both the prose and the skills section, whenever the saved evidence shows professional technical experience.",
    "Never invent employers, dates, titles, credentials, seniority, leadership, or a technology absent from both the saved evidence and the job listing.",
    "The candidate confirms every stretch before export; state what you changed plainly and do not lecture.",
  ].join(" ");
}

export function selectResumeRewrite(input: {
  generated: unknown;
  companionEvidenceRefs?: unknown;
  canonicalCandidates: readonly string[];
  evidenceCatalog: readonly ResumeGenerationEvidenceItem[];
  allowedScope?:
    | {
        scope: "experience" | "project";
        profileRecordId: string;
      }
    | undefined;
  jobCompany: string;
  jobSkills: readonly string[];
  jobListingText?: string | null;
  allowReasonableInference?: boolean;
  allowExactClaims?: boolean;
  allowParaphrasedClaims?: boolean;
  maxEvidenceRefsPerBullet?: number;
}): ResumeRewriteSelection | null {
  const parsed = parseEvidenceLinkedText(
    input.generated,
    input.companionEvidenceRefs,
  );
  if (!parsed) {
    return null;
  }

  const maxEvidenceRefsPerBullet = input.maxEvidenceRefsPerBullet ?? 8;
  if (parsed.evidenceRefs.length > maxEvidenceRefsPerBullet) {
    return null;
  }

  const normalizedGenerated = normalizedComparableText(parsed.text);
  const canonical = input.canonicalCandidates.find(
    (candidate) => normalizedComparableText(candidate) === normalizedGenerated,
  );
  if (canonical) {
    if (input.allowExactClaims === false) {
      return null;
    }
    return {
      text: canonical,
      kind: "canonical",
      referencedEvidenceText: [canonical],
      inferred: false,
    };
  }

  // A provider can stop after a grounded prefix of a canonical bullet. Keep
  // the complete candidate fact rather than persisting an incomplete rewrite.
  const strictPrefixCanonical = findStrictPrefixCanonical(
    parsed.text,
    input.canonicalCandidates,
  );
  if (strictPrefixCanonical) {
    if (input.allowExactClaims === false) {
      return null;
    }
    return {
      text: strictPrefixCanonical,
      kind: "canonical",
      referencedEvidenceText: [strictPrefixCanonical],
      inferred: false,
    };
  }

  if (parsed.evidenceRefs.length === 0) {
    return null;
  }

  if (input.allowParaphrasedClaims === false) {
    return null;
  }

  const evidenceById = new Map(
    input.evidenceCatalog.map((item) => [item.id, item] as const),
  );
  const referencedEvidence = parsed.evidenceRefs.flatMap((reference) => {
    const item = evidenceById.get(reference);
    return item ? [item] : [];
  });
  if (referencedEvidence.length !== parsed.evidenceRefs.length) {
    return null;
  }

  if (input.allowedScope) {
    const supplementScopes = input.allowReasonableInference
      ? new Set<ResumeGenerationEvidenceScope>(["profile", "import_evidence"])
      : null;
    const outOfScope = referencedEvidence.some((item) => {
      const matchesRecord =
        item.scope === input.allowedScope!.scope &&
        item.profileRecordId === input.allowedScope!.profileRecordId;
      const supplementsScope =
        supplementScopes !== null && supplementScopes.has(item.scope);
      return !matchesRecord && !supplementsScope;
    });
    if (outOfScope) {
      return null;
    }
  }

  const grounding = classifyResumeClaimGrounding({
    text: parsed.text,
    evidence: referencedEvidence,
    jobCompany: input.jobCompany,
    jobSkills: input.jobSkills,
    jobListingText: input.jobListingText ?? null,
    allowReasonableInference: input.allowReasonableInference ?? false,
    // Relaxed acceptance (rounded-up years, listing technologies) requires
    // the model to have flagged the proposal inferred, so every relaxed line
    // is counted in the draft notes and stays user-confirmed before export.
    allowAggressiveClaimRelaxation:
      (input.allowReasonableInference ?? false) && parsed.inferred,
  });
  if (!GENERATION_ACCEPTED_GROUNDING_VERDICTS.has(grounding.verdict)) {
    return null;
  }

  return {
    text: parsed.text.trim(),
    kind: "grounded_rewrite",
    referencedEvidenceText: referencedEvidence.map((item) => item.text),
    inferred: parsed.inferred,
  };
}

const MODEL_JOB_DESCRIPTION_MAX_CHARS = 6_000;
const REQUIREMENT_PARAGRAPH_SIGNAL =
  /\b(responsibilit|requirement|qualification|must have|nice to have|you will|you'll|you have|experience|skills?|proficien|familiar|years|degree|stack|tools?|technolog|what we.re looking for|who you are|about the role|about this role|the role)\b/iu;
const BOILERPLATE_PARAGRAPH_SIGNAL =
  /\b(equal opportunity|equal employment|discriminat|accommodation|privacy|cookie|benefits? (?:include|package)|401\(k\)|dental|vision insurance|paid time off|pto\b|unlimited vacation|about (?:us|the company)|our mission|we are a|founded in|backed by|series [a-f]\b|valuation)/iu;

/**
 * Keeps a long listing body inside a budget the model handles well, and keeps
 * the right parts: the paragraphs that describe the work and its requirements
 * stay, company boilerplate and benefits go first. Order is preserved so the
 * model still reads a coherent listing. Short bodies pass through untouched.
 */
export function compactJobDescriptionForModel(
  description: string,
  maxChars: number = MODEL_JOB_DESCRIPTION_MAX_CHARS,
): string {
  if (description.length <= maxChars) {
    return description;
  }
  const paragraphs = description
    .split(/\n{2,}|\n(?=• )/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const ranked = paragraphs.map((text, index) => ({
    index,
    text,
    priority: REQUIREMENT_PARAGRAPH_SIGNAL.test(text)
      ? 0
      : BOILERPLATE_PARAGRAPH_SIGNAL.test(text)
        ? 2
        : 1,
  }));
  const kept = new Set<number>();
  let used = 0;
  for (const priority of [0, 1, 2]) {
    for (const entry of ranked) {
      if (entry.priority !== priority) {
        continue;
      }
      const cost = entry.text.length + 2;
      if (used + cost > maxChars) {
        continue;
      }
      kept.add(entry.index);
      used += cost;
    }
  }
  const compacted = ranked
    .filter((entry) => kept.has(entry.index))
    .map((entry) => entry.text)
    .join("\n\n");
  return compacted.length > 0
    ? compacted
    : description.slice(0, maxChars).trimEnd();
}
