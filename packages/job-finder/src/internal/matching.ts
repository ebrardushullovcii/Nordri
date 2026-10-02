import type { JobFinderAiClient } from "@nordri/ai-providers";
import {
  SavedJobDiscoveryProvenanceSchema,
  SavedJobSchema,
  jobPostingDetailQualityValues,
  type ApplicationStatus,
  type CandidateProfile,
  type JobKeywordSignal,
  type JobRequirementAssessment,
  type JobSearchPreferences,
  type JobPosting,
  type JobPostingDetailQuality,
  type MatchAssessment,
  type MatchLocationReach,
  type SavedJob,
  type SavedJobDiscoveryProvenance,
  type WorkMode,
} from "@nordri/contracts";
import {
  evaluateCompensationFit,
  parseNormalizedCompensation,
} from "./matching-compensation";
import type { MatchAssessmentPostingInput } from "./match-assessment-posting-input";
import { createMatchAssessmentChangeAudit } from "./match-assessment-change-audit";
import { MATCH_ASSESSMENT_SCORER_VERSION } from "./match-assessment-session";
import { assessRemoteGeographyRequirement } from "./matching-eligibility";
import { resolvePostingSeniority } from "./posting-seniority";
import { buildMatchDimensionsAssessment } from "./matching-dimensions";
import {
  buildFitRecommendation,
  buildRequirementEvidenceAssessment,
  collectTechnologySignals,
} from "./matching-requirements";
import {
  canonicalizeLocationAliases,
  resolveStatedLocationPlace,
  resolveCountryName,
} from "./location-normalization";
import {
  createJobIdentityDigest,
  createJobIdentityIndex,
  hasEquivalentListingContentIdentity,
} from "./job-identity";
import { assessJobPostingDetailQuality } from "./job-posting-detail-quality";
import {
  attributeLegacySighting,
  canSwitchCanonicalSighting,
  isLikelyAccessGateListingUrl,
  selectCanonicalSighting,
} from "./listing-sightings";
import {
  buildDiscoveryJobs as orderVisibleDiscoveryJobs,
  isLikelyEmptyNonDetailPosting,
  isLikelyUtilityShortlistJob,
} from "./matching-review-queue";
export {
  buildApplicationRecords,
  compareDiscoveryJobs,
  buildDiscoveryJobs,
  buildReviewQueue,
} from "./matching-review-queue";
import {
  isAbsentFieldText,
  normalizeText,
  tokenize,
  uniqueStrings,
} from "./shared";
import {
  TITLE_MATCHES_TARGET_ROLES_REASON,
  TITLE_MISSES_TARGET_ROLES_GAPS,
} from "../discovery-ordering";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PhraseMatchMode = "generic" | "title" | "location";

const titleTokenAliases = new Map<string, string>([
  ["developer", "engineer"],
  ["developers", "engineer"],
  ["dev", "engineer"],
]);

const genericTitleTokens = new Set([
  "designer",
  "design",
  "junior",
  "senior",
  "staff",
  "lead",
  "principal",
  "engineer",
]);

const titleTechnologySpecializations = [
  "elixir",
  "ruby",
  "java",
  "kotlin",
  "golang",
  "rust",
  "php",
  "python",
  "react",
  "angular",
  "vue",
  "salesforce",
  "ios",
  "android",
] as const;

type RoleFamily =
  | "engineering"
  | "data"
  | "support"
  | "product"
  | "marketing"
  | "sales"
  | "people"
  | "finance"
  | "legal"
  | "risk_compliance"
  | "security"
  | "learning"
  | "physical_engineering"
  | "quality_engineering"
  | "design"
  | "operations"
  | "clerical"
  | "trades"
  | "healthcare";

const roleFamilyPatterns: Record<RoleFamily, readonly RegExp[]> = {
  learning: [
    /\b(?:instructional|learning|training|curriculum) (?:design(?:er)?|specialist|developer|manager)\b/,
  ],
  physical_engineering: [
    /\b(?:mechanical|electrical|civil|chemical|industrial) engineer/,
  ],
  quality_engineering: [/\bquality engineer/],
  engineering: [
    /\bengineer(?:ing)?\b/,
    /\bdeveloper\b/,
    /\bsoftware\b/,
    /\bfrontend\b/,
    /\bbackend\b/,
    /\bfull\s*stack\b/,
    /\bdevops\b/,
    /\bsite reliability\b/,
    /\bplatform engineer(?:ing)?\b/,
    /\barchitect\b/,
  ],
  data: [
    /\bdata (?:engineer|scientist|analyst)\b/,
    /\bdata steward\b/,
    /\banalytics?\b/,
    /\bbusiness intelligence\b/,
    /\bmachine learning\b/,
  ],
  support: [
    /\bcustomer (?:support|service|success|experience)\b/,
    /\btechnical support\b/,
    /\bsupport specialist\b/,
    /\bhelp ?desk\b/,
    /\bclient services?\b/,
  ],
  product: [
    /\bproduct (?:manager|management|owner|operations?)\b/,
    /\bproduct strategy\b/,
  ],
  marketing: [
    /\bmarketing\b/,
    /\bcontent\b/,
    /\bcopywriter\b/,
    /\bcommunications?\b/,
    /\bseo\b/,
    /\bbrand\b/,
    /\bgrowth\b/,
  ],
  sales: [
    /\bsales\b/,
    /\baccount executive\b/,
    /\baccount manager\b/,
    /\bbusiness development\b/,
    /\b(?:sales|business) development representative\b/,
    /\bgo[ -]?to[ -]?market\b/,
    /\bgtm\b/,
  ],
  people: [
    /\bhuman resources?\b/,
    /\bhr\b/,
    /\bpeople (?:operations|partner|business)\b/,
    /\brecruit(?:er|ing|ment)\b/,
    /\btalent (?:acquisition|partner)\b/,
    /\btotal rewards?\b/,
    /\bcompensation\b/,
    /\b(?:global )?mobility specialist\b/,
    /\btime (?:and )?attendance\b/,
    /\bemployee relations?\b/,
    /\bemployee (?:lifecycle|transitions?)\b/,
    /\blabou?r relations?\b/,
  ],
  finance: [
    /\bfinance\b/,
    /\bfinancial\b/,
    /\baccountant\b/,
    /\baccounting\b/,
    /\bcontroller\b/,
    /\bpayroll\b/,
    /\bbilling\b/,
    /\baccounts? (?:payable|receivable)\b/,
    /\btreasury\b/,
    /\btax\b/,
  ],
  legal: [
    /\blegal\b/,
    /\bcounsel\b/,
    /\battorney\b/,
    /\blawyer\b/,
    /\bparalegal\b/,
    /\bsolicitor\b/,
  ],
  risk_compliance: [
    /\brisk\b/,
    /\baudit(?:or|ing)?\b/,
    /\bcompliance\b/,
    /\bfraud\b/,
    /\banti money laundering\b/,
    /\baml\b/,
    /\bedd analyst\b/,
    /\benhanced due diligence\b/,
    /\bkyc\b/,
    /\bohs\b/,
    /\boccupational (?:health (?:and )?)?safety\b/,
    /\b(?:workplace|health (?:and )?)safety\b/,
    /\bsafety (?:officer|specialist|manager|advisor|coordinator)\b/,
    /\bprevenci n de riesgos laborales\b/,
  ],
  security: [
    /\bciso\b/,
    /\bchief information security officer\b/,
    /\bcyber ?security\b/,
    /\binformation security\b/,
  ],
  design: [/\bdesigner\b/, /\bproduct design\b/, /\bux\b/, /\bui design\b/],
  operations: [
    /\boperations?\b/,
    /\bproject coordinator\b/,
    /\bprogram coordinator\b/,
    /\badministrative\b/,
    /\boffice manager\b/,
    /\bprocurement\b/,
    /\bsupply chain\b/,
    /\blogistics\b/,
    /\bcontracts? management\b/,
    /\bcontracts? (?:manager|specialist|administrator)\b/,
    /\bvendor management\b/,
  ],
  clerical: [
    /\bdata entry\b/,
    /\b(?:records?|filing|document) clerk\b/,
    /\bclerical\b/,
    /\boffice assistant\b/,
  ],
  trades: [
    /\bbuilding maintenance\b/,
    /\bfacilities? technician\b/,
    /\bmaintenance technician\b/,
    /\b(?:hvac|electrical|mechanical) technician\b/,
    /\b(?:electrician|plumber|mechanic)\b/,
  ],
  healthcare: [
    /\bnurs(?:e|ing)\b/,
    /\bphysician\b/,
    /\btherap(?:ist|y)\b/,
    /\bclinical\b/,
    /\bmedical\b/,
  ],
};

const primaryRoleFamilyPatterns: ReadonlyArray<readonly [RoleFamily, RegExp]> =
  [
    [
      "learning",
      /\b(?:instructional|learning|training|curriculum) (?:design(?:er)?|specialist|developer|manager)\b/iu,
    ],
    [
      "physical_engineering",
      /\b(?:mechanical|electrical|civil|chemical|industrial) engineer/iu,
    ],
    ["quality_engineering", /\bquality engineer/iu],
    [
      "data",
      /\b(?:data engineer|data scientist|data analyst|analytics engineer|machine learning engineer|ml engineer|ai engineer)\b/iu,
    ],
    [
      "engineering",
      /\b(?:software|frontend|front[- ]end|backend|back[- ]end|full[- ]?stack|platform|site reliability|devops) engineer\b|\bsoftware developer\b/iu,
    ],
    [
      "sales",
      /\b(?:account executive|sales engineer|sales manager|business development|sales development representative)\b/iu,
    ],
    [
      "support",
      /\b(?:customer success|customer support|customer service|technical support|support specialist|client services?)\b/iu,
    ],
    [
      "design",
      /\b(?:product|ux|ui|interaction|visual) designer\b|\bux researcher\b/iu,
    ],
    [
      "finance",
      /\b(?:financial analyst|accountant|controller|payroll specialist|financial engineer)\b/iu,
    ],
    [
      "people",
      /\b(?:recruiter|talent acquisition|human resources|people operations)\b/iu,
    ],
    ["healthcare", /\b(?:nurse|physician|therapist|clinical engineer)\b/iu],
    ["clerical", /\b(?:data entry|records?|filing|document) clerk\b/iu],
    [
      "trades",
      /\b(?:building maintenance|facilities? technician|maintenance technician|electrician|plumber|mechanic)\b/iu,
    ],
  ];

function getPrimaryRoleFamily(value: string): RoleFamily | null {
  return (
    primaryRoleFamilyPatterns.find(([, pattern]) => pattern.test(value))?.[0] ??
    null
  );
}

function collectRoleFamilies(value: string): Set<RoleFamily> {
  const normalized = normalizeText(value);
  // Classify reusable occupational phrases rather than complete listing titles.
  // A title may belong to more than one family; an explicit target anchor such
  // as "Software Engineer" or "Customer Support" therefore still wins when a
  // second phrase only describes the product domain. Generic wrappers such as
  // "Lifecycle" and "Specialist" intentionally carry no family on their own.
  return new Set(
    (
      Object.entries(roleFamilyPatterns) as Array<
        [RoleFamily, readonly RegExp[]]
      >
    ).flatMap(([family, patterns]) =>
      family === "engineering" &&
      /\b(?:data|analytics|machine learning|ml|ai) engineer\b/.test(normalized)
        ? []
        : patterns.some((pattern) => pattern.test(normalized))
          ? [family]
          : [],
    ),
  );
}

const engineeringVocationalTitlePatterns: ReadonlyArray<
  readonly [RoleFamily, RegExp]
> = [
  ["sales", /\bsales engineer\b/iu],
  ["support", /\b(?:technical |customer )?support engineer\b/iu],
  ["finance", /\bfinancial engineer\b/iu],
  ["healthcare", /\bclinical engineer\b/iu],
];

const adjacentRoleFamilies: Readonly<
  Partial<Record<RoleFamily, ReadonlySet<RoleFamily>>>
> = {
  marketing: new Set(["product", "sales", "support"]),
};

function occupationHeadStem(value: string): string | null {
  const tokens = normalizeText(value).split(/\s+/u).filter(Boolean);
  const head = tokens.at(-1);
  if (!head) return null;
  if (/^manag(?:e|er|ement|ing)$/u.test(head)) return "manag";
  const stem = head.replace(/(?:s|es)$/u, "");
  return new Set([
    "accountant",
    "analyst",
    "architect",
    "consultant",
    "designer",
    "developer",
    "engineer",
    "recruiter",
  ]).has(stem)
    ? stem
    : null;
}

function sharesTargetRoleHead(
  candidateTitle: string,
  targetRoles: readonly string[],
): boolean {
  const candidate = normalizeText(candidateTitle);
  return targetRoles.some((role) => {
    const stem = occupationHeadStem(role);
    return (
      stem !== null &&
      new RegExp(`\\b${escapeRegex(stem)}`, "u").test(candidate)
    );
  });
}

function hasAdjacentRoleFamily(
  candidateFamilies: ReadonlySet<RoleFamily>,
  targetFamilies: ReadonlySet<RoleFamily>,
): boolean {
  return [...targetFamilies].some((targetFamily) =>
    [...candidateFamilies].some(
      (candidateFamily) =>
        adjacentRoleFamilies[targetFamily]?.has(candidateFamily) === true,
    ),
  );
}

function hasRoleFamilyMismatch(
  candidateTitle: string,
  targetRoles: readonly string[],
): boolean {
  const candidateFamilies = collectRoleFamilies(candidateTitle);
  const targetFamilies = new Set(
    targetRoles.flatMap((role) => [...collectRoleFamilies(role)]),
  );
  if (candidateFamilies.size === 0 || targetFamilies.size === 0) {
    return false;
  }
  // Explicit occupations win over a shared head noun: Data Engineer and
  // Software Engineer are different roles even though both say Engineer.
  const candidatePrimaryFamily = getPrimaryRoleFamily(candidateTitle);
  const targetPrimaryFamilies = new Set(
    targetRoles
      .map(getPrimaryRoleFamily)
      .filter((family): family is RoleFamily => family !== null),
  );
  if (
    candidatePrimaryFamily &&
    targetPrimaryFamilies.size > 0 &&
    !targetPrimaryFamilies.has(candidatePrimaryFamily)
  ) {
    return true;
  }

  // A shared occupational head (Manager/Management) or an adjacent family is
  // useful recall, not positive evidence that the listing is unrelated.
  if (
    sharesTargetRoleHead(candidateTitle, targetRoles) ||
    hasAdjacentRoleFamily(candidateFamilies, targetFamilies)
  ) {
    return false;
  }
  if (![...candidateFamilies].some((family) => targetFamilies.has(family))) {
    return true;
  }

  // Match the occupational phrase, not a domain qualifier such as
  // "Software Engineer, Sales Platform".
  return engineeringVocationalTitlePatterns.some(
    ([family, pattern]) =>
      !targetFamilies.has(family) && pattern.test(candidateTitle),
  );
}

const locationNoiseTokens = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on",
  "site",
  "office",
  "home",
  "anywhere",
  "worldwide",
  "global",
]);

type BroadLocationRegion = "europe" | "americas" | "apac" | "africa";
type EuropeanLocationRegion =
  | "northern_europe"
  | "southern_europe"
  | "western_europe"
  | "central_europe"
  | "eastern_europe";

const broadLocationRegionPatterns: Record<
  BroadLocationRegion,
  readonly RegExp[]
> = {
  europe: [
    /\beurope\b/,
    /\bemea\b/,
    /\buk\b|\bunited kingdom\b|\bireland\b/,
    /\bkosovo\b|\bprishtina\b|\bpristina\b|\balbania\b|\bbalkan(?:s)?\b/,
    /\bspain\b|\bportugal\b|\bfrance\b|\bgermany\b|\baustria\b|\bnetherlands\b/,
    /\bhungary\b|\bpoland\b|\bitaly\b|\bsweden\b|\bnorway\b|\bdenmark\b|\bfinland\b/,
  ],
  americas: [
    /\bamericas?\b|\blatam\b/,
    /\bunited states\b|\busa\b|\bu\s*s\b|\bcanada\b/,
    /\bbrazil\b|\bmexico\b|\bargentina\b|\bcolombia\b/,
  ],
  apac: [
    /\bapac\b|\basia\b/,
    /\baustralia\b|\bnew zealand\b|\bjapan\b|\bsingapore\b|\bindia\b/,
  ],
  africa: [/\bafrica\b|\bnigeria\b|\bkenya\b|\bsouth africa\b/],
};

const europeanLocationRegionPatterns: Record<
  EuropeanLocationRegion,
  readonly RegExp[]
> = {
  northern_europe: [
    /\bnorthern europe\b/,
    /\b(?:united kingdom|uk|ireland|sweden|norway|denmark|finland|iceland)\b/,
  ],
  southern_europe: [
    /\bsouthern europe\b/,
    /\b(?:kosovo|prishtina|pristina|albania|balkans?|spain|portugal|italy|greece|malta|cyprus)\b/,
  ],
  western_europe: [
    /\bwestern europe\b/,
    /\b(?:france|germany|austria|netherlands|belgium|luxembourg|switzerland)\b/,
  ],
  central_europe: [
    /\bcentral europe\b/,
    /\b(?:hungary|poland|czechia|czech republic|slovakia|slovenia|croatia)\b/,
  ],
  eastern_europe: [
    /\beastern europe\b/,
    /\b(?:romania|bulgaria|moldova|ukraine|estonia|latvia|lithuania)\b/,
  ],
};

function inferBroadLocationRegions(value: string): Set<BroadLocationRegion> {
  const normalized = normalizeText(value);
  return new Set(
    (
      Object.entries(broadLocationRegionPatterns) as Array<
        [BroadLocationRegion, readonly RegExp[]]
      >
    ).flatMap(([region, patterns]) =>
      patterns.some((pattern) => pattern.test(normalized)) ? [region] : [],
    ),
  );
}

function inferEuropeanLocationRegions(
  value: string,
): Set<EuropeanLocationRegion> {
  const normalized = normalizeText(value);
  return new Set(
    (
      Object.entries(europeanLocationRegionPatterns) as Array<
        [EuropeanLocationRegion, readonly RegExp[]]
      >
    ).flatMap(([region, patterns]) =>
      patterns.some((pattern) => pattern.test(normalized)) ? [region] : [],
    ),
  );
}

export function getBroadLocationCompatibility(
  candidate: string,
  desiredValues: readonly string[],
): boolean | null {
  const candidateRegions = inferBroadLocationRegions(candidate);
  const desiredRegions = new Set(
    desiredValues.flatMap((value) => [...inferBroadLocationRegions(value)]),
  );

  if (candidateRegions.size === 0 || desiredRegions.size === 0) {
    return null;
  }

  if (candidateRegions.has("europe") && desiredRegions.has("europe")) {
    const candidateEuropeanRegions = inferEuropeanLocationRegions(candidate);
    const desiredEuropeanRegions = new Set(
      desiredValues.flatMap((value) => [
        ...inferEuropeanLocationRegions(value),
      ]),
    );

    if (candidateEuropeanRegions.size > 0) {
      if (desiredEuropeanRegions.size === 0) {
        return null;
      }

      return [...candidateEuropeanRegions].some((region) =>
        desiredEuropeanRegions.has(region),
      );
    }
  }

  return [...candidateRegions].some((region) => desiredRegions.has(region));
}

function cleanTitleMatchCandidate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }

  const dismissMatch = collapsed.match(/\bdismiss\s+(.+?)\s+job\b/i);
  const candidate = dismissMatch?.[1] ?? collapsed;

  return candidate
    .replace(/\(verified job\)/gi, " ")
    .replace(/\bverified job\b/gi, " ")
    .replace(/\b\d+\s+connection(?:s)?\s+works\s+here\b/gi, " ")
    .replace(/\b\d+\s+school alumni\b/gi, " ")
    .replace(/\b(viewed|promoted)\b.*$/i, " ")
    .replace(/\s*[•·|]\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitleMatchCandidateVariants(value: string): string[] {
  const collapsed = value.replace(/\s+/g, " ").trim();
  const cleaned = cleanTitleMatchCandidate(value);

  if (!cleaned || cleaned === collapsed) {
    return collapsed ? [collapsed] : [];
  }

  return [cleaned, collapsed];
}

function normalizePhraseMatchInput(
  value: string,
  mode: PhraseMatchMode,
): string {
  const normalized = value
    .replace(/\bfullstack\b/gi, "full stack")
    .replace(/\bfront\s*end\b/gi, "frontend")
    .replace(/\bback\s*end\b/gi, "backend");

  if (mode !== "location") {
    return normalized;
  }

  return canonicalizeLocationAliases(normalized)
    .replace(/\bon\s*site\b/gi, "onsite")
    .replace(/\bwork\s+from\s+home\b/gi, "remote");
}

function tokenizePhraseMatchValue(
  value: string,
  mode: PhraseMatchMode,
): string[] {
  const tokens = tokenize(normalizePhraseMatchInput(value, mode)).flatMap(
    (token) => {
      if (mode === "location" && locationNoiseTokens.has(token)) {
        return [];
      }

      if (mode === "title") {
        return [titleTokenAliases.get(token) ?? token];
      }

      return [token];
    },
  );

  return [...new Set(tokens)];
}

// Noise tokens that assert availability across every geography rather than a
// work mode alone.
const worldwideLocationNoiseTokens = new Set([
  "anywhere",
  "worldwide",
  "global",
]);

const broadRemoteGeographyPattern =
  /\bremote\b|\bhybrid\b|\bemea\b|\beurope\b|\bapac\b|\blatam\b|\bamericas?\b|\bworldwide\b|\bglobal\b/iu;

type LocationGeographySignal = {
  rawText: string;
  tokens: readonly string[];
  genericTokens: readonly string[];
  workModeTokens: readonly string[];
  noiseOnly: boolean;
  regions: ReadonlySet<BroadLocationRegion>;
  europeanRegions: ReadonlySet<EuropeanLocationRegion>;
};

function readLocationGeographySignal(value: string): LocationGeographySignal {
  // Work-mode phrases normalize into noise tokens ("work from home" reads as
  // "remote"), so classification and the retained work-mode tokens share one
  // view of the value.
  const workModeTokens = tokenize(normalizePhraseMatchInput(value, "location"));

  return {
    rawText: canonicalizeLocationAliases(value),
    tokens: tokenizePhraseMatchValue(value, "location"),
    genericTokens: tokenizePhraseMatchValue(value, "generic"),
    workModeTokens,
    noiseOnly:
      workModeTokens.length > 0 &&
      workModeTokens.every((token) => locationNoiseTokens.has(token)),
    regions: inferBroadLocationRegions(value),
    europeanRegions: inferEuropeanLocationRegions(value),
  };
}

function isEditDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  const leftLength = left.length;
  const rightLength = right.length;
  if (Math.abs(leftLength - rightLength) > 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let mismatchCount = 0;

  while (leftIndex < leftLength && rightIndex < rightLength) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    mismatchCount += 1;
    if (mismatchCount > 1) {
      return false;
    }

    if (leftLength > rightLength) {
      leftIndex += 1;
      continue;
    }

    if (rightLength > leftLength) {
      rightIndex += 1;
      continue;
    }

    leftIndex += 1;
    rightIndex += 1;
  }

  if (leftIndex < leftLength || rightIndex < rightLength) {
    mismatchCount += 1;
  }

  return mismatchCount <= 1;
}

// Avoid fuzzy title-token matching on short tokens where one edit would be too permissive.
const MIN_FUZZY_MATCH_TOKEN_LENGTH = 6;

function phraseMatchTokensEqual(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (
    left.length < MIN_FUZZY_MATCH_TOKEN_LENGTH ||
    right.length < MIN_FUZZY_MATCH_TOKEN_LENGTH
  ) {
    return false;
  }

  return isEditDistanceAtMostOne(left, right);
}

function everyPhraseTokenMatches(
  sourceTokens: readonly string[],
  targetTokens: readonly string[],
): boolean {
  return sourceTokens.every((sourceToken) =>
    targetTokens.some((targetToken) =>
      phraseMatchTokensEqual(sourceToken, targetToken),
    ),
  );
}

function countMatchedPhraseTokens(
  desiredTokens: readonly string[],
  candidateTokens: readonly string[],
): number {
  const remainingCandidateTokens = [...candidateTokens];
  let matchedCount = 0;

  for (const desiredToken of desiredTokens) {
    const matchedIndex = remainingCandidateTokens.findIndex((candidateToken) =>
      phraseMatchTokensEqual(desiredToken, candidateToken),
    );

    if (matchedIndex === -1) {
      continue;
    }

    matchedCount += 1;
    remainingCandidateTokens.splice(matchedIndex, 1);
  }

  return matchedCount;
}

const remoteGeographyHints = [
  {
    pattern: /\b(united states|u\.s\.|u\.s|us only|usa only)\b/i,
    label: "United States",
  },
  { pattern: /\b(united kingdom|uk only|u\.k\.)\b/i, label: "United Kingdom" },
  { pattern: /\b(european union|europe|eu only)\b/i, label: "Europe" },
  { pattern: /\b(canada|canadian)\b/i, label: "Canada" },
] as const;

export interface MergeDiscoveryResult {
  mergedJobs: SavedJob[];
  newJobs: SavedJob[];
  validatedCount: number;
  duplicatesMerged: number;
  invalidSkipped: number;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

type AtsProviderHostRule = {
  provider: string;
  exact?: readonly string[];
  suffixes?: readonly string[];
};

// Metadata taxonomy only: these hosts label saved jobs with the ATS provider
// that hosted the listing. Discovery routing and workflow policy never branch
// on them.
const ATS_PROVIDER_HOST_RULES: readonly AtsProviderHostRule[] = [
  { provider: "Greenhouse", suffixes: ["greenhouse.io"] },
  { provider: "Lever", suffixes: ["lever.co"] },
  { provider: "Workday", suffixes: ["myworkdayjobs.com"] },
  { provider: "Ashby", suffixes: ["ashbyhq.com"] },
  { provider: "iCIMS", suffixes: ["icims.com", "icims.eu"] },
];

function parseHttpUrlHostname(value: string | null): string | null {
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // URL.hostname already lowercases and IDN-encodes special-scheme hosts;
  // only a trailing root dot survives parsing, so strip it explicitly.
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  return hostname.length > 0 ? hostname : null;
}

function matchesAtsProviderHostRule(
  hostname: string,
  rule: AtsProviderHostRule,
): boolean {
  if (rule.exact?.includes(hostname)) {
    return true;
  }

  return (
    rule.suffixes?.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    ) ?? false
  );
}

function detectAtsProvider(posting: JobPosting): string | null {
  const urlCandidates = [
    posting.applicationUrl,
    posting.canonicalUrl,
    posting.employerWebsiteUrl,
  ];

  for (const value of urlCandidates) {
    const hostname = parseHttpUrlHostname(value);
    if (hostname === null) {
      continue;
    }

    const matchedRule = ATS_PROVIDER_HOST_RULES.find((rule) =>
      matchesAtsProviderHostRule(hostname, rule),
    );
    if (matchedRule) {
      return matchedRule.provider;
    }
  }

  return null;
}

function buildKeywordSignals(posting: JobPosting): JobKeywordSignal[] {
  const buckets: Array<{
    values: readonly string[];
    kind: JobKeywordSignal["kind"];
    weight: number;
  }> = [
    { values: posting.keySkills, kind: "skill", weight: 5 },
    { values: posting.responsibilities, kind: "responsibility", weight: 3 },
    { values: posting.minimumQualifications, kind: "qualification", weight: 4 },
    {
      values: posting.preferredQualifications,
      kind: "qualification",
      weight: 2,
    },
    { values: posting.benefits, kind: "benefit", weight: 1 },
  ];
  const seen = new Set<string>();

  return buckets.flatMap(({ values, kind, weight }) =>
    values.flatMap((value, index) => {
      const label = value.trim();

      if (!label) {
        return [];
      }

      const key = `${kind}:${normalizeText(label)}`;
      if (seen.has(key)) {
        return [];
      }

      seen.add(key);
      return [
        {
          id: `job_keyword_${kind}_${index}_${normalizeText(label).replaceAll(" ", "_")}`,
          label,
          kind,
          weight,
        },
      ];
    }),
  );
}

function buildScreeningHints(posting: JobPosting): SavedJob["screeningHints"] {
  const remoteHintSource = [
    posting.location,
    posting.summary,
    posting.description,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedText = normalizeText(
    [
      posting.location,
      posting.summary,
      posting.description,
      ...posting.minimumQualifications,
      ...posting.preferredQualifications,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const supportsRemoteGeographyHints =
    posting.workMode.includes("remote") ||
    posting.workMode.includes("flexible") ||
    /\bremote\b/i.test(remoteHintSource);

  return {
    sponsorshipText:
      normalizedText.includes("visa sponsorship") ||
      normalizedText.includes("work authorization")
        ? "Work authorization or sponsorship details are mentioned in the listing."
        : null,
    requiresSecurityClearance:
      normalizedText.includes("security clearance") ||
      normalizedText.includes("active clearance")
        ? true
        : null,
    relocationText:
      normalizedText.includes("relocation") ||
      normalizedText.includes("relocate")
        ? "Relocation support or requirements are mentioned in the listing."
        : null,
    travelText:
      /(?:\b(?:requires?|must|expected|willing|ability|availability)\b[^.!?]{0,72}\btravel\b|\btravel\b[^.!?]{0,48}\b(?:required|expected|occasionally|regularly|up to\s+\d{1,3}%|\d{1,3}%)\b)/iu.test(
        normalizedText,
      )
        ? "Travel expectations are mentioned in the listing."
        : null,
    remoteGeographies: supportsRemoteGeographyHints
      ? uniqueStrings(
          remoteGeographyHints.flatMap((entry) =>
            entry.pattern.test(remoteHintSource) ? [entry.label] : [],
          ),
        )
      : [],
    requiresConsentInterrupt: null,
    requiresConsentInterruptKind: null,
  };
}

function mergeKeywordSignals(
  existingSignals: readonly JobKeywordSignal[],
  nextSignals: readonly JobKeywordSignal[],
): JobKeywordSignal[] {
  const byKey = new Map<string, JobKeywordSignal>();

  for (const signal of [...existingSignals, ...nextSignals]) {
    byKey.set(`${signal.kind}:${normalizeText(signal.label)}`, signal);
  }

  return [...byKey.values()];
}

function selectLatestProviderUpdate(
  incoming: string | null,
  existing: string | null | undefined,
): string | null {
  if (!incoming) {
    return existing ?? null;
  }
  if (!existing) {
    return incoming;
  }
  return Date.parse(incoming) >= Date.parse(existing) ? incoming : existing;
}

function jobPostingDetailQualityRank(quality: JobPostingDetailQuality): number {
  return jobPostingDetailQualityValues.indexOf(quality);
}

function strongestDetailQuality(
  left: JobPostingDetailQuality,
  right: JobPostingDetailQuality,
): JobPostingDetailQuality {
  return jobPostingDetailQualityRank(left) >= jobPostingDetailQualityRank(right)
    ? left
    : right;
}

// Historical quality metadata remains evidence even if the current rubric
// cannot reconstruct it. Incoming strength is grounded in current content.
function hasWeakerIncomingDetailEvidence(
  posting: JobPosting,
  existingJob: SavedJob,
): boolean {
  const existingQuality = strongestDetailQuality(
    existingJob.detailQuality,
    assessJobPostingDetailQuality(existingJob),
  );

  return (
    jobPostingDetailQualityRank(assessJobPostingDetailQuality(posting)) <
    jobPostingDetailQualityRank(existingQuality)
  );
}

// Preserved groups cover every resume-affecting content field verbatim so a
// weaker recrawl leaves the stored resume-staleness signature untouched.
// Card-level freshness (lastSeenAt, providerUpdatedAt, provenance) still flows;
// nullable evidence links only fall back when the thinner recrawl dropped them.
function preserveRicherExistingDetail(
  enrichedPosting: JobPosting,
  existingJob: SavedJob,
): JobPosting {
  const existingQuality = strongestDetailQuality(
    existingJob.detailQuality,
    assessJobPostingDetailQuality(existingJob),
  );

  return {
    ...enrichedPosting,
    summary: existingJob.summary,
    description: existingJob.description,
    keySkills: [...existingJob.keySkills],
    responsibilities: [...existingJob.responsibilities],
    minimumQualifications: [...existingJob.minimumQualifications],
    preferredQualifications: [...existingJob.preferredQualifications],
    benefits: [...existingJob.benefits],
    seniority: existingJob.seniority,
    employmentType: existingJob.employmentType,
    department: existingJob.department,
    team: existingJob.team,
    salaryText: enrichedPosting.salaryText ?? existingJob.salaryText,
    employerWebsiteUrl:
      enrichedPosting.employerWebsiteUrl ?? existingJob.employerWebsiteUrl,
    employerDomain:
      enrichedPosting.employerDomain ?? existingJob.employerDomain,
    detailQuality: existingQuality,
    keywordSignals: [...existingJob.keywordSignals],
  };
}

export function enrichDiscoveredPosting(
  posting: JobPosting,
  existingJob: SavedJob | undefined,
): JobPosting {
  const normalizedCompensation = parseNormalizedCompensation(
    posting.salaryText,
  );
  const screeningHints = buildScreeningHints(posting);
  const existingCompensation = existingJob?.normalizedCompensation;
  const postingKeywordSignals = posting.keywordSignals ?? [];

  const enrichedPosting: JobPosting = {
    ...posting,
    title:
      existingJob &&
      hasEquivalentListingContentIdentity(posting, existingJob) &&
      normalizeText(existingJob.title).length >
        normalizeText(posting.title).length
        ? existingJob.title
        : posting.title,
    providerUpdatedAt: selectLatestProviderUpdate(
      posting.providerUpdatedAt,
      existingJob?.providerUpdatedAt,
    ),
    applicationUrl:
      posting.applicationUrl ??
      existingJob?.applicationUrl ??
      (posting.applyPath === "external_redirect"
        ? posting.employerWebsiteUrl
        : null),
    firstSeenAt:
      existingJob?.firstSeenAt ?? posting.firstSeenAt ?? posting.discoveredAt,
    lastSeenAt: posting.lastSeenAt ?? posting.discoveredAt,
    // A re-sighting from a listing card has not read the page. Dropping the
    // earlier read's record made every later search read every saved page
    // again, which is also how a board that rate-limits got asked twice.
    listingDetailFetch:
      posting.listingDetailFetch ?? existingJob?.listingDetailFetch ?? null,
    lastVerifiedActiveAt: posting.lastVerifiedActiveAt ?? posting.discoveredAt,
    // Salary the listing stated, kept across re-sightings so a card-only
    // re-read does not silently drop what a detail page published.
    salaryText: posting.salaryText ?? existingJob?.salaryText ?? null,
    // A band may only survive while some sighting of this listing actually
    // stated a salary. Carrying an earlier band onto a posting that states
    // none is how a figure no employer published reached the screen.
    normalizedCompensation:
      existingCompensation &&
      (posting.salaryText ?? existingJob?.salaryText) &&
      (existingCompensation.minAmount !== null ||
        existingCompensation.maxAmount !== null)
        ? {
            ...existingCompensation,
            ...normalizedCompensation,
            currency:
              normalizedCompensation.currency ?? existingCompensation.currency,
            interval:
              normalizedCompensation.interval ?? existingCompensation.interval,
            minAmount:
              normalizedCompensation.minAmount ??
              existingCompensation.minAmount,
            maxAmount:
              normalizedCompensation.maxAmount ??
              existingCompensation.maxAmount,
            minAnnualUsd:
              normalizedCompensation.minAnnualUsd ??
              existingCompensation.minAnnualUsd,
            maxAnnualUsd:
              normalizedCompensation.maxAnnualUsd ??
              existingCompensation.maxAnnualUsd,
          }
        : normalizedCompensation,
    atsProvider:
      posting.atsProvider ??
      existingJob?.atsProvider ??
      detectAtsProvider(posting),
    screeningHints: {
      sponsorshipText:
        screeningHints.sponsorshipText ??
        existingJob?.screeningHints.sponsorshipText ??
        null,
      requiresSecurityClearance:
        screeningHints.requiresSecurityClearance ??
        existingJob?.screeningHints.requiresSecurityClearance ??
        null,
      relocationText:
        screeningHints.relocationText ??
        existingJob?.screeningHints.relocationText ??
        null,
      travelText:
        screeningHints.travelText ??
        existingJob?.screeningHints.travelText ??
        null,
      remoteGeographies: uniqueStrings([
        ...(existingJob?.screeningHints.remoteGeographies ?? []),
        ...screeningHints.remoteGeographies,
      ]),
      requiresConsentInterrupt:
        screeningHints.requiresConsentInterrupt ??
        existingJob?.screeningHints.requiresConsentInterrupt ??
        null,
      requiresConsentInterruptKind:
        screeningHints.requiresConsentInterruptKind ??
        existingJob?.screeningHints.requiresConsentInterruptKind ??
        null,
    },
    keywordSignals: mergeKeywordSignals(
      existingJob?.keywordSignals ?? [],
      postingKeywordSignals.length > 0
        ? postingKeywordSignals
        : buildKeywordSignals(posting),
    ),
  };

  if (
    existingJob &&
    isLikelyAccessGateListingUrl(posting.canonicalUrl) &&
    !isLikelyAccessGateListingUrl(existingJob.canonicalUrl)
  ) {
    return {
      ...preserveRicherExistingDetail(enrichedPosting, existingJob),
      title: existingJob.title,
      canonicalUrl: existingJob.canonicalUrl,
      applicationUrl: existingJob.applicationUrl,
    };
  }

  if (existingJob && hasWeakerIncomingDetailEvidence(posting, existingJob)) {
    return preserveRicherExistingDetail(enrichedPosting, existingJob);
  }

  return enrichedPosting;
}

export function matchesAnyPhrase(
  candidate: string,
  desiredValues: readonly string[],
): boolean {
  if (desiredValues.length === 0) {
    return true;
  }

  const normalizedCandidate = normalizeText(candidate);
  const candidateTokens = new Set(tokenize(candidate));

  return desiredValues.some((desiredValue) => {
    const normalizedDesired = normalizeText(desiredValue);

    if (!normalizedDesired) {
      return false;
    }

    const desiredTokens = tokenize(desiredValue);

    if (desiredTokens.length === 0) {
      return false;
    }

    if (desiredTokens.length === 1 && candidateTokens.has(normalizedDesired)) {
      return true;
    }

    if (
      new RegExp(`(^|\\s)${escapeRegex(normalizedDesired)}($|\\s)`).test(
        normalizedCandidate,
      )
    ) {
      return true;
    }

    return desiredTokens.every((token) => candidateTokens.has(token));
  });
}

export function matchesTitlePreference(
  candidate: string,
  desiredValues: readonly string[],
): boolean {
  // Title matching is intentionally richer than matchesAnyPhrase and should stay aligned with
  // target-role semantics unless we explicitly choose to widen or narrow role-title behavior.
  if (desiredValues.length === 0) {
    return true;
  }

  return getTitleMatchCandidateVariants(candidate).some((candidateVariant) => {
    const candidateTokens = tokenizePhraseMatchValue(candidateVariant, "title");
    const normalizedCandidate = candidateTokens.join(" ");

    return desiredValues.some((desiredValue) => {
      const desiredTokens = tokenizePhraseMatchValue(desiredValue, "title");

      if (desiredTokens.length === 0) {
        return false;
      }

      if (desiredTokens.length === 1) {
        return candidateTokens.some((candidateToken) =>
          phraseMatchTokensEqual(candidateToken, desiredTokens[0]!),
        );
      }

      const normalizedDesired = desiredTokens.join(" ");
      if (
        new RegExp(`(^|\\s)${escapeRegex(normalizedDesired)}($|\\s)`).test(
          normalizedCandidate,
        )
      ) {
        return true;
      }

      if (everyPhraseTokenMatches(desiredTokens, candidateTokens)) {
        return true;
      }

      const matchedCount = countMatchedPhraseTokens(
        desiredTokens,
        candidateTokens,
      );
      const matchRatio = matchedCount / desiredTokens.length;

      if (desiredTokens.length === 3) {
        const hasSpecificTokenMatch = desiredTokens
          .filter((token) => !genericTitleTokens.has(token))
          .some((desiredToken) =>
            candidateTokens.some((candidateToken) =>
              phraseMatchTokensEqual(candidateToken, desiredToken),
            ),
          );
        return (
          matchedCount >= 2 && matchRatio >= 2 / 3 && hasSpecificTokenMatch
        );
      }

      return matchedCount >= 3 && matchRatio >= 0.6;
    });
  });
}

function matchesLocationPhrase(
  candidateSignal: LocationGeographySignal,
  desiredSignal: LocationGeographySignal,
): boolean {
  const candidateTokens = candidateSignal.tokens;
  const normalizedCandidate = candidateTokens.join(" ");
  const desiredTokens = desiredSignal.tokens;

  if (desiredTokens.length === 0) {
    const fallbackDesiredTokens = desiredSignal.genericTokens;
    if (fallbackDesiredTokens.length === 0) {
      return false;
    }

    if (fallbackDesiredTokens.length === 1) {
      return candidateSignal.genericTokens.some((candidateToken) =>
        phraseMatchTokensEqual(candidateToken, fallbackDesiredTokens[0]!),
      );
    }

    return everyPhraseTokenMatches(
      fallbackDesiredTokens,
      candidateSignal.genericTokens,
    );
  }

  // An empty candidate side cannot match a concrete place; the symmetric
  // token comparison below would otherwise hold vacuously.
  if (candidateTokens.length === 0) {
    return false;
  }

  if (desiredTokens.length === 1) {
    return candidateTokens.some((candidateToken) =>
      phraseMatchTokensEqual(candidateToken, desiredTokens[0]!),
    );
  }

  const normalizedDesired = desiredTokens.join(" ");
  if (
    new RegExp(`(^|\\s)${escapeRegex(normalizedDesired)}($|\\s)`).test(
      normalizedCandidate,
    )
  ) {
    return true;
  }

  return (
    everyPhraseTokenMatches(desiredTokens, candidateTokens) ||
    everyPhraseTokenMatches(candidateTokens, desiredTokens)
  );
}

function isCoarseRegionalSignal(signal: LocationGeographySignal): boolean {
  // Only europe has a finer subregion layer; every other broad region is
  // terminal, so any signal resolving to it is coarse by definition.
  return signal.europeanRegions.size === 0;
}

// Conservative containment for exclusion decisions: possible regional overlap
// conflicts, proven separation does not. Two fine-grained places in the same
// subregion are not enough evidence; at least one side must stop at the
// region level.
function locationRegionsPossiblyOverlap(
  left: LocationGeographySignal,
  right: LocationGeographySignal,
): boolean {
  if (left.regions.size === 0 || right.regions.size === 0) {
    return false;
  }

  if (![...left.regions].some((region) => right.regions.has(region))) {
    return false;
  }

  if (!isCoarseRegionalSignal(left) && !isCoarseRegionalSignal(right)) {
    return false;
  }

  if (
    left.regions.has("europe") &&
    right.regions.has("europe") &&
    left.europeanRegions.size > 0 &&
    right.europeanRegions.size > 0 &&
    ![...left.europeanRegions].some((region) =>
      right.europeanRegions.has(region),
    )
  ) {
    return false;
  }

  return true;
}

export type LocationCompatibilityState =
  | "compatible"
  | "incompatible"
  | "unknown";

/**
 * The saved places that actually constrain a search.
 *
 * An imported profile can push a stored absence placeholder ("Location not
 * stated") into the preferred locations, and a user can type "N/A"; neither
 * states a place. `assessLocationCompatibility` answers "compatible" for both
 * "no constraint" and "verified match", so every caller that distinguishes
 * those two must count the constraints here rather than the raw saved list —
 * otherwise a placeholder-only preference reads as a location the user chose
 * and the listing met.
 */
function getSavedLocationConstraints(
  desiredValues: readonly string[],
): readonly string[] {
  if (desiredValues.every((value) => !isAbsentFieldText(value))) {
    return desiredValues;
  }
  return desiredValues.filter((value) => !isAbsentFieldText(value));
}

/**
 * How the person's "Count remote jobs as any location" setting reaches the
 * location checks. On (the default), a remote listing for a region or the
 * whole world that covers a saved place counts as a location match. Off, a
 * remote listing is judged by the place it names alone: it matches only a
 * saved place it names, or a saved "Remote"/"Worldwide" place.
 */
export interface LocationMatchOptions {
  remoteCountsAsAnyLocation?: boolean;
}

/** Reads the run-time copy of the remote setting from search preferences. */
export function readLocationMatchOptions(
  searchPreferences: Pick<JobSearchPreferences, "discovery"> | null | undefined,
): LocationMatchOptions {
  return {
    remoteCountsAsAnyLocation:
      searchPreferences?.discovery?.remoteCountsAsAnyLocation !== false,
  };
}

// Positive preference fit only. Work-mode noise ("Remote", "Hybrid") states
// how a job is done, never where, so it cannot confirm geographic
// compatibility; "worldwide"/"anywhere" coverage is the documented exception
// because it includes every saved area, unless the person turned off
// "Count remote jobs as any location".
export function assessLocationCompatibility(
  candidate: string,
  desiredValues: readonly string[],
  options: LocationMatchOptions = {},
): LocationCompatibilityState {
  const remoteCountsAsAnyLocation = options.remoteCountsAsAnyLocation !== false;
  // An absence placeholder is not a place on either side. A saved preference
  // that reads "N/A" or "Location not stated" states no geographic constraint,
  // so tokenising it would fabricate a conflict against every real listing.
  const desiredPlaces = getSavedLocationConstraints(desiredValues);
  if (desiredPlaces.length === 0) {
    return "compatible";
  }

  // An absence placeholder is not a place. Comparing it against a saved city
  // can only ever produce a conflict the app never actually observed.
  if (isAbsentFieldText(candidate)) {
    return "unknown";
  }

  const canonicalCandidate = canonicalizeLocationAliases(candidate);
  const candidateCountries = canonicalCandidate
    .split(/[,;/|]/u)
    .map((part) => resolveCountryName(part.trim()))
    .filter(Boolean);
  if (
    desiredPlaces.some((place) => {
      const country = resolveCountryName(canonicalizeLocationAliases(place));
      return country !== null && candidateCountries.includes(country);
    })
  )
    return "compatible";

  // A board writes how the work is done and where it is in one cell
  // ("Hiring Remotely in Chicago, IL, USA", "Remote in Chicago"). Only the
  // place part can answer the geographic question, so the work-mode lead-in
  // and the trailing country come off before the comparison.
  const candidateSignal = readLocationGeographySignal(
    resolveStatedLocationPlace(candidate),
  );
  const desiredSignals = desiredPlaces.map(readLocationGeographySignal);

  if (candidateSignal.genericTokens.length === 0) {
    return "unknown";
  }

  const hasGeographicDesired = desiredSignals.some(
    (signal) => !signal.noiseOnly,
  );

  if (candidateSignal.noiseOnly) {
    if (desiredSignals.some((signal) => signal.noiseOnly)) {
      return "compatible";
    }

    if (
      candidateSignal.genericTokens.some((token) =>
        worldwideLocationNoiseTokens.has(token),
      )
    ) {
      // "Remote, Worldwide" names no saved place. With remote not counting as
      // any location, it does not fit a person who listed only real places.
      return remoteCountsAsAnyLocation || !hasGeographicDesired
        ? "compatible"
        : "incompatible";
    }

    return "unknown";
  }

  if (
    remoteCountsAsAnyLocation &&
    broadRemoteGeographyPattern.test(candidateSignal.rawText) &&
    getBroadLocationCompatibility(candidate, desiredPlaces) === true
  ) {
    return "compatible";
  }

  const matched = desiredSignals.some((desiredSignal) =>
    matchesLocationPhrase(candidateSignal, desiredSignal),
  );

  if (matched) {
    return "compatible";
  }

  // Without any geographic constraint to compare against, a failed
  // work-mode token overlap is neutral rather than a conflict.
  return hasGeographicDesired ? "incompatible" : "unknown";
}

export interface PostingLocationCompatibility {
  state: LocationCompatibilityState;
  /**
   * True when the saved places alone would have read as outside or unknown,
   * but the listing is remote and remote is one of the preferred work modes,
   * so the place comparison no longer decides fit.
   */
  remotePreferenceApplied: boolean;
}

/**
 * Location fit for a posting, honoring the saved work modes. A user who
 * prefers remote work has said that where the employer sits matters less than
 * how the job is done, so a remote listing must not be scored as "outside the
 * saved areas" merely because its stated place is not the saved city. An
 * explicit regional restriction that excludes every saved area (for example
 * "Remote - United States" against a European place) still needs the user's
 * confirmation and stays unknown rather than compatible.
 */
export function assessPostingLocationCompatibility(
  posting: Pick<MatchAssessmentPostingInput, "location" | "workMode">,
  searchPreferences: Pick<JobSearchPreferences, "locations" | "workModes">,
  options: LocationMatchOptions = {},
): PostingLocationCompatibility {
  const savedPlaces = getSavedLocationConstraints(searchPreferences.locations);
  const state = assessLocationCompatibility(
    posting.location,
    savedPlaces,
    options,
  );
  if (
    state === "compatible" ||
    savedPlaces.length === 0 ||
    // The person said a remote posting must still fit their places, so a
    // remote work-mode preference does not stand in for the place.
    options.remoteCountsAsAnyLocation === false
  ) {
    return { state, remotePreferenceApplied: false };
  }

  // "Anywhere in the World", "Worldwide", "Work from home" are remote
  // listings even when the board never says the word "remote".
  const listingIsRemote =
    posting.workMode.includes("remote") ||
    /\b(?:remote|anywhere|worldwide|work from home|wfh|global|distributed)\b/iu.test(
      posting.location,
    );
  const prefersRemote = searchPreferences.workModes.includes("remote");
  if (!listingIsRemote || !prefersRemote) {
    return { state, remotePreferenceApplied: false };
  }

  const broadCompatibility = getBroadLocationCompatibility(
    posting.location,
    savedPlaces,
  );
  return {
    state: broadCompatibility === false ? "unknown" : "compatible",
    remotePreferenceApplied: true,
  };
}

// A listing that says where it sits but never says it can be done away from
// there. The place words alone are not enough — a board can leave work mode
// out entirely — so an explicit in-person phrase counts as onsite too.
const EXPLICIT_ONSITE_LOCATION_PATTERN =
  /\b(?:on[-\s]?site|onsite|in[-\s]?person|in[-\s]?office)\b/iu;
const REMOTE_LOCATION_PATTERN =
  /\b(?:remote|anywhere|worldwide|work from home|wfh|global|distributed|hybrid)\b/iu;

function isOnsiteOnlyListing(
  workMode: readonly WorkMode[],
  location: string,
): boolean {
  if (
    workMode.includes("remote") ||
    workMode.includes("hybrid") ||
    workMode.includes("flexible")
  ) {
    return false;
  }
  if (workMode.includes("onsite")) {
    return true;
  }
  // No stated mode: the location text decides, and only when it is explicit.
  return (
    EXPLICIT_ONSITE_LOCATION_PATTERN.test(location) &&
    !REMOTE_LOCATION_PATTERN.test(location)
  );
}

/**
 * Where a listing sits against the saved areas. Only `outside_area` changes
 * ordering, and it is claimed conservatively: the person saved at least one
 * real place, the listing's own place is outside every one of them, and the
 * listing is on site, so there is no way to do the job from a saved area.
 */
export function resolveMatchLocationReach(input: {
  hasSavedLocationConstraint: boolean;
  locationCompatibility: LocationCompatibilityState;
  locationRemotePreferenceApplied: boolean;
  workMode: readonly WorkMode[];
  location: string;
}): MatchLocationReach {
  if (!input.hasSavedLocationConstraint) {
    return "unknown";
  }
  if (input.locationCompatibility === "compatible") {
    return input.locationRemotePreferenceApplied
      ? "remote_preferred"
      : "in_area";
  }
  if (input.locationCompatibility !== "incompatible") {
    return "unknown";
  }
  return isOnsiteOnlyListing(input.workMode, input.location)
    ? "outside_area"
    : "unknown";
}

export function matchesLocationPreference(
  candidate: string,
  desiredValues: readonly string[],
): boolean {
  // Location matching is intentionally richer than matchesAnyPhrase and should stay aligned with
  // location semantics unless we explicitly choose to widen or narrow location behavior.
  return assessLocationCompatibility(candidate, desiredValues) === "compatible";
}

export type WorkModeCompatibilityState = "compatible" | "conflict" | "unknown";

/**
 * Positive preference fit only, from concrete listing evidence. A listing that
 * names no concrete mode (empty or "flexible" alone) stays unknown rather than
 * compatible: offered flexibility is not evidence of any specific accepted
 * mode. The same unknown applies when unpreferred concrete modes are listed
 * alongside "flexible", so ambiguity is never hardened into a conflict. An
 * all-concrete mismatch remains a real conflict.
 */
export function assessWorkModeCompatibility(
  listingWorkModes: readonly WorkMode[],
  preferredWorkModes: readonly WorkMode[],
): WorkModeCompatibilityState {
  if (
    preferredWorkModes.length === 0 ||
    preferredWorkModes.includes("flexible")
  ) {
    return "compatible";
  }

  const concreteListingModes = listingWorkModes.filter(
    (mode) => mode !== "flexible",
  );
  if (concreteListingModes.length === 0) {
    return "unknown";
  }

  if (concreteListingModes.some((mode) => preferredWorkModes.includes(mode))) {
    return "compatible";
  }

  return listingWorkModes.includes("flexible") ? "unknown" : "conflict";
}

// Exclusion conflicts are a different question from positive fit: they skip
// listings and must rest on concrete or conservatively contained geography.
// Noise-only listings never conflict with an arbitrary excluded place; they
// can only conflict when an exclusion targets that same work-mode noise.
export function matchesExcludedLocation(
  candidate: string,
  excludedValues: readonly string[],
): boolean {
  if (excludedValues.length === 0) {
    return false;
  }

  // An absence placeholder cannot be excluded: nothing was observed to exclude.
  if (isAbsentFieldText(candidate)) {
    return false;
  }

  const candidateSignal = readLocationGeographySignal(candidate);
  const matchesWorkModeExclusion = (excludedSignal: LocationGeographySignal) =>
    excludedSignal.noiseOnly &&
    excludedSignal.workModeTokens.length > 0 &&
    excludedSignal.workModeTokens.every((token) =>
      candidateSignal.workModeTokens.includes(token),
    );

  if (candidateSignal.noiseOnly) {
    return excludedValues.some((value) =>
      matchesWorkModeExclusion(readLocationGeographySignal(value)),
    );
  }

  return excludedValues.some((value) => {
    const excludedSignal = readLocationGeographySignal(value);
    if (excludedSignal.noiseOnly) {
      return matchesWorkModeExclusion(excludedSignal);
    }

    if (matchesLocationPhrase(candidateSignal, excludedSignal)) {
      return true;
    }

    return (
      broadRemoteGeographyPattern.test(candidateSignal.rawText) &&
      locationRegionsPossiblyOverlap(candidateSignal, excludedSignal)
    );
  });
}

export function toSavedJobId(posting: JobPosting): string {
  return `job_${posting.source}_${posting.sourceJobId}`;
}

function isSalesOrientedEngineeringListing(
  posting: MatchAssessmentPostingInput,
): boolean {
  if (!/\b(?:solutions?|sales) engineer\b/iu.test(posting.title)) {
    return false;
  }

  const evidence = [
    posting.summary,
    posting.description,
    ...posting.responsibilities,
    ...posting.minimumQualifications,
    ...posting.preferredQualifications,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const decisiveSalesSignals = [
    /\b(?:carry|own|meet)\s+(?:a\s+)?(?:sales\s+)?quota\b/iu,
    /\b(?:pre[- ]sales|presales)\b/iu,
  ];
  if (decisiveSalesSignals.some((pattern) => pattern.test(evidence))) {
    return true;
  }

  const independentSalesCycleSignals = [
    /\b(?:sales|revenue)\s+pipeline\b|\bqualif(?:y|ying) opportunities\b/iu,
    /\b(?:technical|product) demos?\b.{0,48}\b(?:prospects?|customers?)\b|\b(?:prospects?|customers?)\b.{0,48}\b(?:technical|product) demos?\b/iu,
    /\b(?:partner|work|collaborate)\w*\b.{0,32}\b(?:account executives?|sales team)\b/iu,
    /\b(?:technical discovery|proofs? of concept|pocs?|rfps?|rfis?)\b/iu,
    /\b(?:close|win)\w*\b.{0,24}\b(?:deals?|revenue|opportunities)\b/iu,
  ];
  return (
    independentSalesCycleSignals.filter((pattern) => pattern.test(evidence))
      .length >= 2
  );
}

function isNonOpeningListing(posting: MatchAssessmentPostingInput): boolean {
  const title = normalizeText(posting.title);
  const evidence = normalizeText(
    [posting.title, posting.summary, posting.description]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  const titleSignalsTalentPool =
    /\b(?:talent (?:community|network|pool)|future opportunities|general application|open application|expression of interest)\b/iu.test(
      title,
    );
  const explicitlyNotOpen =
    /\b(?:not|isn t)\s+(?:an?\s+)?(?:active|current)\s+(?:vacancy|opening|role|position)\b/iu.test(
      evidence,
    );
  const invitesFutureInterest =
    /\b(?:join|register|submit)\b.{0,48}\b(?:talent|future|interest|network|community)\b/iu.test(
      evidence,
    );

  return titleSignalsTalentPool || (explicitlyNotOpen && invitesFutureInterest);
}

// Boards publish more than one value in a single field: "Full-Time/Part-Time",
// "Contract or Permanent", "Mid, Senior". Read as one string, the part-time
// job a person asked for looked like a conflict with their part-time
// preference. Each stated value is compared on its own, and one match is
// enough.
function splitStatedPreferenceValues(listingValue: string): string[] {
  return listingValue
    .split(/[/|,;]|\bor\b|\band\b/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function hasExplicitPreferenceConflict(
  listingValue: string | null,
  savedValues: readonly string[],
): boolean {
  if (savedValues.length === 0 || listingValue === null) {
    return false;
  }

  const statedValues = splitStatedPreferenceValues(listingValue);
  if (statedValues.length === 0) {
    return false;
  }

  return !statedValues.some((statedValue) =>
    savedValues.some(
      (savedValue) => normalizeText(savedValue) === normalizeText(statedValue),
    ),
  );
}

type CareerStage = "entry" | "experienced" | "unknown";

function inferCareerStage(value: string): CareerStage {
  if (
    /\b(?:intern(?:ship)?|student|graduate|new grad|entry[- ]level|junior|apprentice|trainee)\b/iu.test(
      value,
    )
  ) {
    return "entry";
  }
  if (
    /\b(?:senior|sr\.?|staff|lead|principal|manager|director|head|chief|architect)\b/iu.test(
      value,
    )
  ) {
    return "experienced";
  }
  return "unknown";
}

/**
 * Words that say what level a role sits at, or name the head noun every
 * office role shares. They are never what makes a saved role that role.
 */
const ROLE_HEAD_NOUN_TOKENS = new Set([
  "junior",
  "senior",
  "staff",
  "lead",
  "principal",
  "associate",
  "assistant",
  "manager",
  "managing",
  "management",
  "director",
  "head",
  "chief",
  "officer",
  "specialist",
  "coordinator",
  "consultant",
  "analyst",
  "engineer",
  "developer",
  "designer",
  "design",
  "owner",
  "supervisor",
  "advisor",
  "executive",
  "representative",
  "administrator",
  "i",
  "ii",
  "iii",
  "iv",
]);

/**
 * Words that stand for the same kind of work. A saved "Marketing Manager" is
 * still asked for by a "Demand Generation Manager"; it is not asked for by a
 * "Manager, Financial Reporting". Vocabulary only — no board, no employer.
 */
const ROLE_VOCABULARY_FAMILIES: readonly (readonly string[])[] = [
  [
    "marketing",
    "brand",
    "growth",
    "demand",
    "generation",
    "lifecycle",
    "campaign",
    "communications",
    "seo",
    "content",
  ],
  ["sales", "revenue", "partnerships", "affiliate", "affiliates", "account"],
  ["finance", "financial", "accounting", "treasury", "audit"],
  ["people", "talent", "recruiting", "recruitment", "hr"],
  ["support", "success", "service", "customer"],
  ["data", "analytics", "ml", "ai"],
  ["product", "ux", "design"],
  ["software", "platform", "backend", "frontend", "infrastructure"],
];

function sharesRoleVocabulary(
  token: string,
  candidateTokens: ReadonlySet<string>,
): boolean {
  return ROLE_VOCABULARY_FAMILIES.some(
    (family) =>
      family.includes(token) &&
      family.some((relative) => candidateTokens.has(relative)),
  );
}

/**
 * True when the listing title has nothing in common with any saved target
 * role but the head noun or a level word.
 *
 * A "Marketing Manager" search returned "Manager Credit Risk", "Manager,
 * Financial Reporting" and "Product Owner, Workday ERP" under "Matches your
 * role, not yet scored" while no marketing title was in that band: sharing
 * "Manager" is not being the role the person asked for. Such a title is a
 * weaker match, never a clear mismatch — it is not in conflict with anything,
 * it simply is not the role.
 */
function sharesOnlyRoleHeadNoun(
  title: string,
  targetRoles: readonly string[],
): boolean {
  const titleTokens = new Set(tokenize(title));
  if (titleTokens.size === 0) {
    return false;
  }

  const titleFamilies = collectRoleFamilies(title);
  if (tokenize(title).every((token) => ROLE_HEAD_NOUN_TOKENS.has(token))) {
    return targetRoles.some((role) =>
      tokenize(role).some((token) => !ROLE_HEAD_NOUN_TOKENS.has(token)),
    );
  }
  let anyRoleIsDistinguishable = false;

  for (const role of targetRoles) {
    // The occupational taxonomy already placed both in one family ("Website
    // Developer" for a saved "Software Engineer"). That is the adjacency the
    // scorer records, and this rule does not second-guess it.
    const sharedFamily = [...collectRoleFamilies(role)].some((family) =>
      titleFamilies.has(family),
    );
    if (sharedFamily && !titleFamilies.has("design")) {
      return false;
    }

    const distinguishing = tokenize(role).filter(
      (token) => !ROLE_HEAD_NOUN_TOKENS.has(token),
    );
    if (distinguishing.length === 0) {
      // The saved role is a bare head noun ("Manager"); it distinguishes
      // nothing, so this rule has no opinion about it.
      continue;
    }

    anyRoleIsDistinguishable = true;
    const sharesSubject = distinguishing.some(
      (token) =>
        titleTokens.has(token) || sharesRoleVocabulary(token, titleTokens),
    );
    if (sharesSubject) {
      return false;
    }
  }

  return anyRoleIsDistinguishable;
}

function titleSignalOverlapCount(
  postingTitle: string,
  targetRoles: readonly string[],
): number {
  const ignored = new Set(["junior", "senior", "staff", "lead", "principal"]);
  const postingTokens = new Set(
    tokenize(postingTitle).filter((token) => !ignored.has(token)),
  );
  return new Set(
    targetRoles
      .flatMap(tokenize)
      .filter((token) => !ignored.has(token) && postingTokens.has(token)),
  ).size;
}

export function createMatchAssessment<
  TPosting extends MatchAssessmentPostingInput,
>(
  profile: CandidateProfile,
  searchPreferences: JobSearchPreferences,
  posting: TPosting,
  extractedRequirements: readonly JobRequirementAssessment[] = [],
): MatchAssessment {
  posting = { ...posting, seniority: resolvePostingSeniority(posting) };
  let score = 48;
  // Deterministic overlap is a shortlist signal, not proof that every listed requirement is met.
  let scoreCeiling = 94;
  const reasons: string[] = [];
  const gaps: string[] = [];

  const matchesRole = matchesTitlePreference(
    posting.title,
    searchPreferences.targetRoles,
  );
  const nonOpeningListing = isNonOpeningListing(posting);
  const roleFamilyMismatch =
    hasRoleFamilyMismatch(posting.title, searchPreferences.targetRoles) ||
    isSalesOrientedEngineeringListing(posting);
  const roleFamilyUnclear =
    (searchPreferences.targetRoles.some(
      (role) => collectRoleFamilies(role).size > 0,
    ) &&
      collectRoleFamilies(posting.title).size === 0) ||
    sharesOnlyRoleHeadNoun(posting.title, searchPreferences.targetRoles);
  // "compatible" covers both "no saved constraint" and "verified match", so
  // every branch below that distinguishes the two counts the real saved
  // places rather than the raw list: a placeholder-only preference states no
  // constraint and must not be credited as a location the listing met.
  const savedLocationConstraints = getSavedLocationConstraints(
    searchPreferences.locations,
  );
  const hasSavedLocationConstraint = savedLocationConstraints.length > 0;
  const assessedLocation = assessPostingLocationCompatibility(
    posting,
    searchPreferences,
    readLocationMatchOptions(searchPreferences),
  );
  const remoteGeographyRequirement = assessRemoteGeographyRequirement({
    profile,
    posting,
  });
  const remoteGeographyConflicts =
    remoteGeographyRequirement?.status === "conflict" ||
    extractedRequirements.some(
      (requirement) =>
        requirement.category === "location" &&
        requirement.importance === "required" &&
        requirement.status === "conflict",
    );
  const locationCompatibility = remoteGeographyConflicts
    ? ("incompatible" as const)
    : assessedLocation.state;
  const locationRemotePreferenceApplied = remoteGeographyConflicts
    ? false
    : assessedLocation.remotePreferenceApplied;
  const workModeCompatibility = assessWorkModeCompatibility(
    posting.workMode,
    searchPreferences.workModes,
  );
  const locationReach = resolveMatchLocationReach({
    hasSavedLocationConstraint,
    locationCompatibility,
    locationRemotePreferenceApplied,
    workMode: posting.workMode,
    location: posting.location,
  });
  // Only a place or a work mode the person ruled out themselves can throw a
  // listing away. Everything else they simply did not tick, which changes
  // where the listing ranks, never whether they get to see it.
  const locationExcluded = matchesExcludedLocation(
    posting.location,
    searchPreferences.excludedLocations,
  );
  const statedWorkModes = posting.workMode.filter(
    (mode) => mode !== "flexible",
  );
  const workModeExcluded =
    statedWorkModes.length > 0 &&
    statedWorkModes.every((mode) =>
      matchesExcludedLocation(mode, searchPreferences.excludedLocations),
    );
  const explicitSeniorityConflict = hasExplicitPreferenceConflict(
    posting.seniority,
    searchPreferences.seniorityLevels,
  );
  const explicitEmploymentTypeConflict = hasExplicitPreferenceConflict(
    posting.employmentType,
    searchPreferences.employmentTypes,
  );
  const compensationFit = evaluateCompensationFit(
    posting.salaryText,
    searchPreferences.compensation,
  );
  const isPreferredCompany = searchPreferences.companyWhitelist.some(
    (company) => normalizeText(company) === normalizeText(posting.company),
  );
  const profileSkills = uniqueStrings([
    ...profile.skills,
    ...profile.skillGroups.coreSkills,
    ...profile.skillGroups.tools,
    ...profile.skillGroups.languagesAndFrameworks,
    ...profile.skillGroups.highlightedSkills,
    ...profile.experiences.flatMap((experience) => experience.skills),
    ...profile.projects.flatMap((project) => project.skills),
  ]);
  const postingSkillEvidence = [
    ...posting.keySkills,
    ...posting.keywordSignals.map((signal) => signal.label),
    posting.description,
    ...posting.responsibilities,
    ...posting.minimumQualifications,
    ...posting.preferredQualifications,
  ].join(" ");
  const overlappingSkills = profileSkills.filter((skill) =>
    matchesAnyPhrase(postingSkillEvidence, [skill]),
  );
  const profileCapabilityEvidence = [
    ...profileSkills,
    profile.headline,
    ...profile.experiences.flatMap((experience) => [
      experience.title,
      experience.summary,
      ...experience.achievements,
    ]),
    ...profile.projects.flatMap((project) => [
      project.name,
      project.role,
      project.summary,
      project.outcome,
    ]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const listingTechnologies = collectTechnologySignals(
    `${posting.title} ${postingSkillEvidence}`,
  );
  const profileTechnologies = new Set(
    collectTechnologySignals(profileCapabilityEvidence),
  );
  const overlappingTechnologies = listingTechnologies.filter((technology) =>
    profileTechnologies.has(technology),
  );
  const detectedRequirements = buildRequirementEvidenceAssessment({
    profile,
    posting,
    locationCompatibility,
    locationRemotePreferenceApplied,
    workModeCompatibility,
    hasLocationPreferences: hasSavedLocationConstraint,
    hasWorkModePreferences: searchPreferences.workModes.length > 0,
    locationReach,
    locationExcluded,
    workModeExcluded,
    targetRoles: searchPreferences.targetRoles,
  });
  const requirements = [
    ...detectedRequirements.filter(
      (detected) =>
        !extractedRequirements.some(
          (extracted) =>
            extracted.category === detected.category &&
            normalizeText(extracted.label) === normalizeText(detected.label),
        ),
    ),
    ...extractedRequirements,
  ];
  const missingCoreRequirements = requirements.filter(
    (requirement) =>
      requirement.importance === "required" &&
      requirement.status === "missing" &&
      (requirement.category === "skill" ||
        requirement.category === "domain" ||
        requirement.category === "experience" ||
        requirement.category === "work_authorization"),
  );
  if (missingCoreRequirements.length >= 2) {
    scoreCeiling = Math.min(scoreCeiling, 64);
  } else if (missingCoreRequirements.length === 1) {
    scoreCeiling = Math.min(scoreCeiling, 74);
  }

  if (nonOpeningListing) {
    score -= 40;
    scoreCeiling = Math.min(scoreCeiling, 39);
    gaps.push(
      "The listing is a talent pool or future-interest form rather than a current vacancy.",
    );
  } else if (roleFamilyMismatch) {
    score -= 28;
    scoreCeiling = Math.min(scoreCeiling, 39);
    gaps.push(TITLE_MISSES_TARGET_ROLES_GAPS[0]!);
  } else if (matchesRole && !roleFamilyUnclear) {
    score += 16;
    reasons.push(TITLE_MATCHES_TARGET_ROLES_REASON);
  } else if (roleFamilyUnclear) {
    score -= 22;
    scoreCeiling = Math.min(scoreCeiling, 50);
    gaps.push(TITLE_MISSES_TARGET_ROLES_GAPS[1]!);
  } else {
    score -= 12;
    gaps.push(TITLE_MISSES_TARGET_ROLES_GAPS[2]!);
  }

  if (!hasSavedLocationConstraint) {
    // An unconstrained search is neutral. It is not evidence that the listing
    // matches a location the user explicitly chose.
  } else if (locationCompatibility === "compatible") {
    score += 10;
    reasons.push(
      locationRemotePreferenceApplied
        ? "Remote listing; remote is one of your preferred work modes."
        : "Location fits the saved search preferences.",
    );
  } else if (locationCompatibility === "incompatible") {
    score -= 10;
    gaps.push("Location falls outside the preferred search areas.");
  }
  // Geographically unspecified listings stay neutral: work-mode noise alone
  // is not evidence for or against the saved areas.

  if (searchPreferences.workModes.length === 0) {
    // An unconstrained work mode is neutral for the same reason.
  } else if (workModeCompatibility === "compatible") {
    score += 8;
    reasons.push("Work mode matches the preferred operating model.");
  } else if (workModeCompatibility === "conflict") {
    score -= 8;
    gaps.push(
      "Work mode does not match the saved remote or hybrid preferences.",
    );
  }
  // Flexible or unspecified listings stay neutral: offered flexibility alone
  // is not evidence for or against the saved operating model.

  const postingRequestsElevatedSeniority =
    /\b(?:staff|principal|director|manager|head)\b/iu.test(posting.title);
  const currentEngineeringTitle = [
    profile.headline,
    profile.experiences[0]?.title ?? "",
  ].join(" ");
  const profileShowsElevatedSeniority =
    /\b(?:staff|principal|director|manager|head|chief)\b/iu.test(
      currentEngineeringTitle,
    );
  const elevatedScopeGap =
    postingRequestsElevatedSeniority && !profileShowsElevatedSeniority;
  const postingCareerStage = inferCareerStage(
    `${posting.title} ${posting.seniority ?? ""}`,
  );
  const profileCareerStage = inferCareerStage(
    [
      profile.headline,
      ...profile.experiences.map((experience) => experience.title ?? ""),
    ].join(" "),
  );
  const careerStageMismatch =
    postingCareerStage !== "unknown" &&
    profileCareerStage !== "unknown" &&
    postingCareerStage !== profileCareerStage;
  if (careerStageMismatch) {
    score -= 18;
    scoreCeiling = Math.min(scoreCeiling, 56);
    gaps.splice(
      roleFamilyMismatch ? 1 : 0,
      0,
      postingCareerStage === "entry"
        ? "The role is aimed at students or entry-level candidates, while the profile shows experienced scope."
        : "The role expects experienced scope that is not yet explicit in the current profile.",
    );
  }
  if (elevatedScopeGap) {
    score -= 8;
    gaps.push(
      "The title signals a staff-or-leadership scope not yet explicit in the current profile.",
    );
  }
  if (explicitSeniorityConflict) {
    score -= 8;
    gaps.push(
      "The listing seniority conflicts with the saved seniority preferences.",
    );
  }
  if (explicitEmploymentTypeConflict) {
    score -= 8;
    gaps.push(
      "The listing employment type conflicts with the saved employment preferences.",
    );
  }

  const missingTitleTechnology = titleTechnologySpecializations.find(
    (technology) =>
      matchesAnyPhrase(posting.title, [technology]) &&
      !matchesAnyPhrase(profileCapabilityEvidence, [technology]),
  );
  if (missingTitleTechnology) {
    score -= 16;
    scoreCeiling = Math.min(scoreCeiling, 84);
    gaps.push(
      `The title explicitly specializes in ${missingTitleTechnology}, which is not present in the current profile evidence.`,
    );
  }

  const postingIsSiteReliabilitySpecialist =
    /\b(?:site reliability|sre)\b/iu.test(posting.title);
  const profileShowsSiteReliabilityDepth =
    /\b(?:site reliability|sre|kubernetes|terraform|incident response|on[ -]?call|observability)\b/iu.test(
      profileCapabilityEvidence,
    );
  if (postingIsSiteReliabilitySpecialist && !profileShowsSiteReliabilityDepth) {
    score -= 12;
    scoreCeiling = Math.min(scoreCeiling, 72);
    gaps.push(
      "The role is explicitly site-reliability focused, but the profile does not yet show SRE, on-call, infrastructure-as-code, or production-operations depth.",
    );
  }

  if (compensationFit.state === "meets_minimum") {
    score += 6;
    reasons.push("Compensation meets the saved salary minimum.");
  } else if (compensationFit.state === "below_minimum") {
    score -= 14;
    scoreCeiling = Math.min(scoreCeiling, 71);
    gaps.push("Compensation is below the saved salary minimum.");
  }

  if (isPreferredCompany) {
    score += 8;
    reasons.push("Company appears in the current preferred-company list.");
  }

  if (overlappingTechnologies.length > 0) {
    score += Math.min(18, overlappingTechnologies.length * 6);
    reasons.push(
      `Stack overlap includes ${overlappingTechnologies.slice(0, 3).join(", ")}.`,
    );
    if (
      listingTechnologies.length >= 3 &&
      overlappingTechnologies.length / listingTechnologies.length < 0.34
    ) {
      score -= 8;
      gaps.push(
        "Most of the stated technology stack is not in the current profile.",
      );
    }
  } else if (listingTechnologies.length >= 2) {
    score -= 18;
    scoreCeiling = Math.min(scoreCeiling, 58);
    gaps.push(
      "The stated technology stack does not overlap the current profile.",
    );
  } else if (overlappingSkills.length > 0) {
    score += Math.min(6, overlappingSkills.length * 2);
    reasons.push(
      `Skill overlap includes ${overlappingSkills.slice(0, 2).join(" and ")}.`,
    );
  } else {
    gaps.push(
      "The listing emphasizes skills that are not yet prominent in the current profile.",
    );
  }

  const requirementEvidencePenalty = requirements.reduce(
    (total, requirement) => {
      if (
        requirement.category === "location" ||
        requirement.category === "work_mode" ||
        requirement.status === "supported"
      ) {
        return total;
      }

      if (requirement.status === "conflict") {
        return total + 16;
      }
      if (requirement.status === "unknown") {
        return total + (requirement.importance === "required" ? 4 : 1);
      }
      if (requirement.importance === "required") {
        return total + 8;
      }
      if (requirement.importance === "preferred") {
        return total + 3;
      }
      return total + 2;
    },
    0,
  );
  score -= Math.min(24, requirementEvidencePenalty);

  const dimensions = buildMatchDimensionsAssessment({
    posting,
    // The preference facets read the saved locations directly, both to decide
    // whether a location facet exists at all and to name the places in its
    // evidence line. Hand them the real constraints so a placeholder never
    // becomes "compared with Location not stated: aligned."
    searchPreferences:
      savedLocationConstraints.length === searchPreferences.locations.length
        ? searchPreferences
        : { ...searchPreferences, locations: [...savedLocationConstraints] },
    requirements,
    matchesRole: matchesRole && !roleFamilyUnclear,
    roleFamilyMismatch,
    roleFamilyUnclear,
    locationCompatibility,
    locationRemotePreferenceApplied,
    workModeCompatibility,
    isPreferredCompany,
  });
  const hasHardConflict = requirements.some(
    (requirement) =>
      requirement.importance === "required" &&
      requirement.status === "conflict",
  );
  const hasUnresolvedRequired = requirements.some(
    (requirement) =>
      requirement.importance === "required" &&
      (requirement.status === "missing" || requirement.status === "unknown"),
  );
  if (nonOpeningListing || roleFamilyMismatch || hasHardConflict) {
    scoreCeiling = Math.min(scoreCeiling, 39);
  } else if (
    compensationFit.state === "below_minimum" ||
    explicitSeniorityConflict ||
    careerStageMismatch ||
    explicitEmploymentTypeConflict ||
    elevatedScopeGap ||
    hasUnresolvedRequired ||
    dimensions.roleSuitability.state === "unknown" ||
    dimensions.evidenceConfidence.level === "low" ||
    dimensions.evidenceConfidence.level === "unavailable"
  ) {
    scoreCeiling = Math.min(scoreCeiling, 71);
  } else if (dimensions.roleSuitability.state === "adjacent") {
    scoreCeiling = Math.min(scoreCeiling, 85);
  }

  const technologyCoverage =
    listingTechnologies.length === 0
      ? 0
      : overlappingTechnologies.length / listingTechnologies.length;
  const ceilingRankingPenalty =
    (roleFamilyMismatch ? 8 : roleFamilyUnclear ? 6 : matchesRole ? 0 : 3) +
    (careerStageMismatch ? 5 : elevatedScopeGap ? 3 : 0) +
    (locationCompatibility === "incompatible" ? 4 : 0) +
    (listingTechnologies.length >= 2
      ? Math.round((1 - technologyCoverage) * 5)
      : 0) +
    Math.max(
      0,
      3 - titleSignalOverlapCount(posting.title, searchPreferences.targetRoles),
    );
  const finalScore = clampScore(
    score > scoreCeiling
      ? scoreCeiling - Math.min(12, ceilingRankingPenalty)
      : score,
  );
  // The accumulated signal wanted a higher number than an unresolved gap
  // allows, so the printed figure is that gap's ceiling rather than a
  // measurement of this listing. Unrelated jobs share a ceiling all the time
  // ("71%" over and over), which reads as though the app measured them as
  // equal; the screen qualifies the number instead of hiding it.
  const scoreIsUpperBound = score > scoreCeiling;
  const evidenceRecommendation = buildFitRecommendation({
    score: finalScore,
    requirements,
  });
  const recommendation = nonOpeningListing
    ? {
        recommendation: "skip" as const,
        rationale:
          "This is a talent-pool or future-interest listing, not a current vacancy.",
      }
    : roleFamilyMismatch
      ? {
          recommendation: "skip" as const,
          rationale: "The listing belongs to a different occupational role.",
        }
      : explicitEmploymentTypeConflict
        ? {
            recommendation: "skip" as const,
            rationale:
              "The listing employment type conflicts with the saved employment preferences.",
          }
        : compensationFit.state === "below_minimum" &&
            evidenceRecommendation.recommendation !== "skip"
          ? {
              recommendation: "review_before_applying" as const,
              rationale:
                "The listing compensation is below the saved salary minimum.",
            }
          : evidenceRecommendation;

  return {
    scorerVersion: MATCH_ASSESSMENT_SCORER_VERSION,
    contextFingerprint: null,
    postingFingerprint: null,
    score: finalScore,
    scoreIsUpperBound,
    compensationFit,
    locationReach,
    dimensions,
    reasons: roleFamilyMismatch
      ? [recommendation.rationale, ...reasons].slice(0, 3)
      : reasons.slice(0, 3),
    gaps: gaps.slice(0, 3),
    recommendation: recommendation.recommendation,
    recommendationRationale: recommendation.rationale,
    requirements,
  };
}

export async function createMatchAssessmentAsync(
  aiClient: JobFinderAiClient,
  profile: CandidateProfile,
  searchPreferences: JobSearchPreferences,
  posting: JobPosting,
  signal?: AbortSignal,
): Promise<MatchAssessment> {
  const fallbackAssessment = createMatchAssessment(
    profile,
    searchPreferences,
    posting,
  );
  signal?.throwIfAborted();
  const assistedAssessment = await aiClient.assessJobFit({
    ...(signal ? { signal } : {}),
    assessmentDate: new Date().toISOString().slice(0, 10),
    profile,
    searchPreferences,
    job: posting,
  });

  signal?.throwIfAborted();
  if (!assistedAssessment) {
    return fallbackAssessment;
  }

  // Rebuild dimensions, gaps and safety ceilings from the extracted evidence.
  // A model score cannot remove a known occupational or eligibility conflict.
  return {
    ...createMatchAssessment(
      profile,
      searchPreferences,
      posting,
      assistedAssessment.requirements,
    ),
    ...(assistedAssessment.requirements
      ? { requirementsSource: "model" as const }
      : {}),
  };
}

export function preserveJobStatus(
  existingJob: SavedJob | undefined,
): ApplicationStatus {
  if (!existingJob) {
    return "discovered";
  }

  if (
    existingJob.status === "archived" ||
    existingJob.status === "submitted" ||
    existingJob.status === "rejected"
  ) {
    return existingJob.status;
  }

  return existingJob.status;
}

export function mergeDiscoveredJob(
  matchAssessment: MatchAssessment,
  posting: JobPosting,
  existingJob: SavedJob | undefined,
): SavedJob {
  return assembleMergedDiscoveredJob({
    matchAssessment,
    enrichedPosting: enrichDiscoveredPosting(posting, existingJob),
    posting,
    existingJob,
  });
}

// Shared assembly so callers that already enriched the posting (the merge
// pipeline) and the direct helper above stay byte-for-byte identical.
function assembleMergedDiscoveredJob(input: {
  matchAssessment: MatchAssessment;
  enrichedPosting: JobPosting;
  posting: JobPosting;
  existingJob: SavedJob | undefined;
}): SavedJob {
  const { matchAssessment, enrichedPosting, posting, existingJob } = input;

  return SavedJobSchema.parse({
    ...enrichedPosting,
    id: existingJob?.id ?? toSavedJobId(posting),
    // A discovery recrawl refreshes shared listing content, not the plans that
    // already retained that row. Dropping this list on duplicate merge made a
    // job silently leave plan 1 as soon as plan 2 found it.
    campaignIds: [...(existingJob?.campaignIds ?? [])],
    status: preserveJobStatus(existingJob),
    matchAssessment,
    discoveryFeedback: existingJob?.discoveryFeedback ?? null,
    resumeApplicationMode: existingJob?.resumeApplicationMode ?? null,
    latestMatchAssessmentAudit: existingJob?.latestMatchAssessmentAudit ?? null,
  });
}

function buildVisibleDiscoveryRankById(
  jobs: readonly SavedJob[],
): ReadonlyMap<string, number> {
  return new Map(
    orderVisibleDiscoveryJobs(jobs).map((job, index) => [job.id, index + 1]),
  );
}

function selectLatestDiscoveryTimestamp(
  postings: readonly JobPosting[],
): string | null {
  return postings.reduce<string | null>((latest, posting) => {
    const candidate = posting.lastSeenAt ?? posting.discoveredAt;
    if (!latest) {
      return candidate;
    }

    return Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
  }, null);
}

function hasMeaningfulMatchAssessmentChange(
  audit: ReturnType<typeof createMatchAssessmentChangeAudit>,
): boolean {
  return audit.status !== "unchanged" && audit.status !== "metadata_incomplete";
}

// Helper to merge discovered postings with existing jobs
export function mergeDiscoveredPostings(
  profile: CandidateProfile,
  searchPreferences: JobSearchPreferences,
  savedJobs: readonly SavedJob[],
  discoveredPostings: readonly JobPosting[],
  provenanceBuilder: (posting: JobPosting) => SavedJobDiscoveryProvenance,
  signal?: AbortSignal,
  assessPosting?: (posting: JobPosting) => MatchAssessment,
): MergeDiscoveryResult {
  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const identityIndex = createJobIdentityIndex(
    savedJobs,
    toSightingIdentityInput,
  );
  const previousJobsById = new Map(savedJobs.map((job) => [job.id, job]));
  const previousRankById = buildVisibleDiscoveryRankById(savedJobs);
  const newJobIds = new Set<string>();
  let validatedCount = 0;
  let duplicatesMerged = 0;
  let invalidSkipped = 0;

  const nextJobsById = new Map(savedJobs.map((job) => [job.id, job]));

  for (const posting of discoveredPostings) {
    // Check for cancellation periodically
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const postingUrl = (() => {
      try {
        return new URL(posting.canonicalUrl);
      } catch {
        return null;
      }
    })();

    if (
      !posting.sourceJobId ||
      !postingUrl ||
      isLikelyUtilityShortlistJob(posting) ||
      isLikelyEmptyNonDetailPosting(posting)
    ) {
      invalidSkipped += 1;
      continue;
    }

    validatedCount += 1;
    const existingJob =
      identityIndex.find({ ...posting, matchAcrossSources: true }) ?? undefined;

    // Enrich before assessing so the stored assessment fingerprint describes
    // exactly the content this merge persists. Enrichment derives fields the
    // fingerprint covers (keyword signals, screening hints, ATS provider);
    // assessing the raw posting instead stamps a fingerprint that can never
    // match the persisted job, forcing a full re-score of every staged job on
    // the next discovery run.
    // The job's listing and application link come from one sighting chosen
    // by a rule that ignores merge order (ADR 0030), not from whichever
    // source reported last. Settle it before assessing, for the same reason.
    const builtProvenance = provenanceBuilder(posting);
    const provenance: SavedJobDiscoveryProvenance = {
      ...builtProvenance,
      listingFacts: {
        title: posting.title,
        company: posting.company,
        location: posting.location,
        salaryText: posting.salaryText,
        seniority: posting.seniority,
        description: posting.description,
        summary: posting.summary,
      },
      listingUrl: builtProvenance.listingUrl ?? posting.canonicalUrl,
      applicationUrl:
        builtProvenance.applicationUrl ?? posting.applicationUrl ?? null,
      sourceJobId: builtProvenance.sourceJobId ?? posting.sourceJobId,
      applyPath: builtProvenance.applyPath ?? posting.applyPath,
    };
    const mergedProvenance = uniqueProvenance([
      ...(existingJob
        ? attributeLegacySighting(existingJob.provenance, existingJob)
        : []),
      provenance,
    ]);
    const enrichedPosting = existingJob
      ? settleCanonicalRoute(
          enrichDiscoveredPosting(posting, existingJob),
          existingJob,
          mergedProvenance,
          posting,
        )
      : enrichDiscoveredPosting(posting, existingJob);
    const matchAssessment = assessPosting
      ? assessPosting(enrichedPosting)
      : createMatchAssessment(profile, searchPreferences, enrichedPosting);
    let mergedJob = SavedJobSchema.parse({
      ...assembleMergedDiscoveredJob({
        matchAssessment,
        enrichedPosting,
        posting,
        existingJob,
      }),
      provenance: mergedProvenance,
    });

    if (!existingJob && nextJobsById.has(mergedJob.id)) {
      const baseId = `${mergedJob.id}_${createJobIdentityDigest(posting)}`;
      let availableId = baseId;
      let collisionIndex = 2;
      while (nextJobsById.has(availableId)) {
        availableId = `${baseId}_${collisionIndex}`;
        collisionIndex += 1;
      }
      mergedJob = SavedJobSchema.parse({ ...mergedJob, id: availableId });
    }

    if (existingJob) {
      duplicatesMerged += 1;
      identityIndex.replace(existingJob, mergedJob);
    } else {
      newJobIds.add(mergedJob.id);
      identityIndex.add(mergedJob);
    }

    nextJobsById.set(mergedJob.id, mergedJob);
  }

  const jobsBeforeAudit = [...nextJobsById.values()];
  const currentRankById = buildVisibleDiscoveryRankById(jobsBeforeAudit);
  const auditRecordedAt = selectLatestDiscoveryTimestamp(discoveredPostings);
  const mergedJobs = jobsBeforeAudit.map((job) => {
    const previousJob = previousJobsById.get(job.id);
    if (!previousJob) {
      return job;
    }

    const audit = createMatchAssessmentChangeAudit({
      previous: previousJob.matchAssessment,
      current: job.matchAssessment,
      previousRank: previousRankById.get(job.id) ?? null,
      currentRank: currentRankById.get(job.id) ?? null,
      recordedAt: auditRecordedAt,
    });

    return SavedJobSchema.parse({
      ...job,
      latestMatchAssessmentAudit: hasMeaningfulMatchAssessmentChange(audit)
        ? audit
        : previousJob.latestMatchAssessmentAudit,
    });
  });

  return {
    mergedJobs,
    newJobs: mergedJobs.filter((job) => newJobIds.has(job.id)),
    validatedCount,
    duplicatesMerged,
    invalidSkipped,
  };
}

export function uniqueProvenance(
  values: readonly SavedJobDiscoveryProvenance[],
): SavedJobDiscoveryProvenance[] {
  const kept = new Map<string, SavedJobDiscoveryProvenance>();

  for (const value of values) {
    const parsed = SavedJobDiscoveryProvenanceSchema.parse(value);
    const key = `${parsed.targetId}:${parsed.adapterKind}:${parsed.resolvedAdapterKind ?? "none"}:${parsed.startingUrl}`;
    const first = kept.get(key);
    if (!first) {
      kept.set(key, parsed);
      continue;
    }
    // The first sighting per source keeps its discovery time; a later one only
    // fills in what the first did not record (older provenance had no links).
    kept.set(key, {
      ...first,
      listingFacts:
        parsed.listingUrl === first.listingUrl
          ? (parsed.listingFacts ?? first.listingFacts)
          : first.listingFacts,
      listingUrl: first.listingUrl ?? parsed.listingUrl ?? null,
      applicationUrl: first.listingUrl
        ? (first.applicationUrl ?? null)
        : (parsed.applicationUrl ?? null),
      sourceJobId: first.sourceJobId ?? parsed.sourceJobId ?? null,
      applyPath: first.applyPath ?? parsed.applyPath ?? null,
      pageApplyUrl: first.pageApplyUrl ?? parsed.pageApplyUrl ?? null,
      routeReadAt: first.routeReadAt ?? parsed.routeReadAt ?? null,
    });
  }

  return [...kept.values()];
}

/**
 * A saved job's identity for matching new sightings: its own fields plus the
 * listing links its other sources showed.
 */
export function toSightingIdentityInput(job: SavedJob): SavedJob & {
  alternateListingUrls: string[];
  matchAcrossSources: true;
} {
  return {
    ...job,
    matchAcrossSources: true,
    alternateListingUrls: job.provenance.flatMap((entry) =>
      entry.listingUrl && entry.listingUrl !== job.canonicalUrl
        ? [entry.listingUrl]
        : [],
    ),
  };
}

const SIGHTING_ROUTE_FIELDS = [
  "canonicalUrl",
  "applicationUrl",
  "applyPath",
  "easyApplyEligible",
  "source",
  "sourceJobId",
  "discoveryMethod",
  "collectionMethod",
  "providerKey",
  "providerBoardToken",
  "providerIdentifier",
  "atsProvider",
] as const satisfies readonly (keyof JobPosting)[];

function copySightingRouteFields<T extends JobPosting>(
  target: T,
  from: JobPosting,
): T {
  const next = { ...target } as Record<string, unknown>;
  for (const field of SIGHTING_ROUTE_FIELDS) {
    next[field] = from[field];
  }
  return next as T;
}

/**
 * Point a job at one of its own sightings: listing, application link, apply
 * path and identity fields all come from that sighting, never half from
 * another. Its stored display facts move with the route.
 */
export function applySightingRoute<T extends JobPosting>(
  job: T,
  sighting: SavedJobDiscoveryProvenance,
): T {
  if (
    !sighting.listingUrl ||
    (!sighting.listingFacts && sighting.listingUrl !== job.canonicalUrl)
  )
    return job;
  const applyPath = sighting.applyPath ?? job.applyPath;
  const sameProvider =
    (sighting.providerKey ?? null) === (job.providerKey ?? null);
  const routed = {
    ...job,
    ...(sighting.listingFacts ?? {}),
    ...(sighting.listingFacts
      ? {
          normalizedCompensation: parseNormalizedCompensation(
            sighting.listingFacts.salaryText,
          ),
        }
      : {}),
    canonicalUrl: sighting.listingUrl,
    applicationUrl: sighting.applicationUrl ?? null,
    applyPath,
    easyApplyEligible: applyPath === "easy_apply",
    sourceJobId: sighting.sourceJobId ?? job.sourceJobId,
    collectionMethod: sighting.collectionMethod,
    providerKey: sighting.providerKey ?? null,
    providerBoardToken: sighting.providerBoardToken ?? null,
    providerIdentifier: sameProvider ? job.providerIdentifier : null,
  } as T;
  return { ...routed, atsProvider: detectAtsProvider(routed) } as T;
}

function settleCanonicalRoute(
  enrichedPosting: JobPosting,
  existingJob: SavedJob,
  provenance: readonly SavedJobDiscoveryProvenance[],
  posting: JobPosting,
): JobPosting {
  // Work has started on this job: its listing and link stay where they are.
  if (!canSwitchCanonicalSighting(existingJob)) {
    return copySightingRouteFields(
      {
        ...enrichedPosting,
        title: existingJob.title,
        company: existingJob.company,
        location: existingJob.location,
        description: existingJob.description,
        summary: existingJob.summary,
        salaryText: existingJob.salaryText,
        normalizedCompensation: existingJob.normalizedCompensation,
        seniority: existingJob.seniority,
      },
      existingJob,
    );
  }
  const winner = selectCanonicalSighting(provenance);
  if (!winner || winner.listingUrl === existingJob.canonicalUrl) {
    if (posting.canonicalUrl === existingJob.canonicalUrl)
      return enrichedPosting;
    return copySightingRouteFields(
      {
        ...enrichedPosting,
        title: existingJob.title,
        company: existingJob.company,
        location: existingJob.location,
        description: existingJob.description,
        summary: existingJob.summary,
        salaryText: existingJob.salaryText,
        normalizedCompensation: existingJob.normalizedCompensation,
        seniority: existingJob.seniority,
      },
      existingJob,
    );
  }
  if (winner.listingUrl === enrichedPosting.canonicalUrl) {
    return {
      ...enrichedPosting,
      title: posting.title,
      company: enrichedPosting.company,
      applicationUrl: posting.applicationUrl ?? null,
      location: posting.location,
      seniority: posting.seniority,
      salaryText: posting.salaryText,
      description: posting.description,
      summary: posting.summary,
      normalizedCompensation: parseNormalizedCompensation(posting.salaryText),
    };
  }
  return applySightingRoute(enrichedPosting, winner);
}
