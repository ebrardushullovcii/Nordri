import {
  formatEmployerLabelFromSlug,
  isAgeTokenMisreadAsCompany,
  sanitizeObservedEmployerLabel,
  type JobPosting,
} from "@unemployed/contracts";

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

export interface StructuredDataJobCandidate {
  canonicalUrl?: string | null;
  sourceJobId?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  summary?: string | null;
  postedAt?: string | null;
  postedAtText?: string | null;
  providerUpdatedAt?: string | null;
  salaryText?: string | null;
  workMode?: readonly string[] | null;
  applyPath?: JobPosting["applyPath"] | null;
  easyApplyEligible?: boolean | null;
  keySkills?: readonly string[] | null;
  responsibilities?: readonly string[] | null;
  minimumQualifications?: readonly string[] | null;
  preferredQualifications?: readonly string[] | null;
  seniority?: string | null;
  employmentType?: string | null;
  department?: string | null;
  team?: string | null;
  employerWebsiteUrl?: string | null;
  employerDomain?: string | null;
  benefits?: readonly string[] | null;
}

export interface SearchResultCardCandidate {
  canonicalUrl: string;
  anchorText: string;
  headingText: string | null;
  lines: string[];
  companyText?: string | null;
  /** Absolute `/company/{slug}` (or company job) href observed on the card. */
  companyHref?: string | null;
  locationText?: string | null;
  sourceJobIdHint?: string | null;
  captureMeta?: SearchResultCardCaptureMeta | null;
}

export interface SearchResultCardCaptureMeta {
  domOrder: number;
  rootTagName: string | null;
  rootRole: string | null;
  rootClassName: string | null;
  hasJobDataset: boolean;
  sameRootJobAnchorCount: number;
  inLikelyResultsList: boolean;
  inAside: boolean;
  inHeader: boolean;
  inNavigation: boolean;
  inDetailPane: boolean;
  hasDismissLabel: boolean;
  isVisible?: boolean;
  intersectsViewport?: boolean;
  viewportTop?: number | null;
  viewportDistance?: number | null;
}

export interface ExtractionSearchPreferences {
  targetRoles?: readonly string[];
  locations?: readonly string[];
}

const WORK_MODE_VALUES = ["remote", "hybrid", "onsite"] as const;
const EASY_APPLY_PATTERN =
  /\b(easy apply|quick apply|one[- ]click apply|apply instantly|instant apply)\b/i;
const APPLY_PATTERN = /\bapply\b/i;
// A bare age badge ("12d", "3h", "2w", "1mo", "5m") is how boards print how
// long ago a card was posted. It used to pass every guard and end up as the
// employer of the job.
const POSTED_PATTERN =
  /\b(posted|ago|today|yesterday|just posted|sot|dje|\d+\s*(?:day|days|week|weeks|month|months|hour|hours|hr|hrs|dit[eë]?|jav[eë]?|jave|muaj(?:sh)?|ore?)|\d{1,3}\s?(?:d|h|w|mo|m|y))\b/iu;
/**
 * Text that can honestly be reported as a posting date: it carries a number, a
 * month name, or a relative-time word.
 *
 * Structured data and learned card shapes hand back whatever sits in the slot
 * they matched, so a card once reported `postedAtText: "NOPE"` and the app
 * printed it where a posting date belongs. A token that says nothing about
 * time is dropped instead of travelling with the listing.
 */
const POSTED_AT_DATE_TEXT_PATTERN =
  /\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:today|yesterday|now|ago|posted|sot|dje|recently)\b/iu;
const SALARY_PATTERN =
  /(\$|€|£)\s?\d[\d,.]*(?:\s?[kKmM])?(?:\s?(?:-|–|to)\s?(?:\$|€|£)?\s?\d[\d,.]*(?:\s?[kKmM])?)?(?:\s?\/?\s?(?:yr|year|month|mo|week|wk|day|hour|hr))?/;
const COMPANY_NOISE_PATTERN =
  /\b(save|saved|share|apply|easy apply|quick apply|view|see more|show more|details|posted|ago|today|yesterday|salary|compensation|remote|hybrid|on[- ]site|onsite|full[- ]time|part[- ]time|contract|intern(ship)?|temporary|promoted|featured)\b/i;
const LOCATION_HINT_PATTERN =
  /\b(remote|hybrid|on[- ]site|onsite|work from home|home office|worldwide|global|anywhere)\b/i;
const EMPLOYMENT_TYPE_PATTERN =
  /\b(full[- ]time|part[- ]time|contract|temporary|intern(ship)?|freelance)\b/i;
const COMPOSITE_POSTED_SUFFIX_PATTERN =
  /(?:posted\s+)?(?:\d+\s*(?:day|days|week|weeks|month|months|hour|hours|hr|hrs|dit[eë]?|jav[eë]?|jave|muaj(?:sh)?|ore?)(?:\s+ago)?|today|yesterday|just posted|sot|dje)$/iu;
const POSTED_SUFFIX_CALL_TO_ACTION_PREFIX_PATTERN =
  /\b(?:apply|start|join(?:\s+us)?|interview|hiring|call|book|register|sign\s+up|get\s+(?:hired|started)|begin)\s*$/i;
// "Apply today" is a call to action, not a posting date.
const POSTED_CALL_TO_ACTION_LINE_PATTERN =
  /\b(?:apply|start|join(?:\s+us)?|interview|hiring|call|book|register|sign\s+up|get\s+(?:hired|started)|begin)\s+(?:today|now)\b/i;
const EXTRACTION_UI_NOISE_PATTERN =
  /\b(dismiss|viewed|promoted|follow|works here|school alumni|connection(?:s)?|verified job)\b/i;
const EXTRACTION_UI_SUFFIX_PATTERN =
  /\b(?:dismiss|viewed|promoted|follow|works here|school alumni|connection(?:s)?|posted on)\b.*$/i;
const EXTRACTION_UI_INLINE_NOISE_PATTERN =
  /\b(?:with verification|verified job|recommended|promoted|viewed|works here|school alumni|connection(?:s)?|actively reviewing applicants|be an early applicant)\b/gi;
const ROLE_TOKEN_PATTERN =
  /^(?:engineer|developer|manager|designer|analyst|specialist|support|sales|marketing|data|software|product|qa|frontend|backend|react|category|customer|experience|work)$/i;
const ROLE_SUFFIX_TOKENS = new Set([
  "senior",
  "staff",
  "lead",
  "principal",
  "junior",
  "mid",
  "level",
  "full",
  "stack",
  "go",
  "software",
  "frontend",
  "backend",
  "engineer",
  "developer",
  "architect",
  "qa",
  "react",
  "native",
  "application",
  "dotnet",
  ".net",
  "typescript",
  "javascript",
  "node",
  "nodejs",
  "python",
  "java",
  "golang",
  "ios",
  "android",
  "mobile",
  "cloud",
  "platform",
  "devops",
  "sre",
  "ai",
]);
const COMPANY_LEGAL_SUFFIX_PATTERN =
  /\b(?:gmbh|llc|l\.l\.c\.|inc|corp|co\.?|ltd|limited|plc|ag|sa|sarl|groupe|group|sh\.p\.k\.|shpk)\b/i;
const COMPANY_STYLE_SUFFIX_TOKENS = new Set([
  "agency",
  "careers",
  "consulting",
  "digital",
  "group",
  "labs",
  "media",
  "partners",
  "solutions",
  "studio",
  "studios",
  "systems",
  "technologies",
  "technology",
]);
const TECHNICAL_ROLE_SIGNAL_PATTERNS = [
  /\bsoftware\b/i,
  /\bdeveloper\b/i,
  /\bengineer\b/i,
  /\bfrontend\b/i,
  /\bbackend\b/i,
  /\bfull stack\b/i,
  /\bfullstack\b/i,
  /\bweb\b/i,
  /\bmobile\b/i,
  /\bdevops\b/i,
  /\bsdet\b/i,
  /\bqa automation\b/i,
  /\bplatform\b/i,
  /\bprogrammer\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\breact\b/i,
  /\bnode\b/i,
  /\bdotnet\b/i,
  /\bcsharp\b/i,
  /\bpython\b/i,
  /\bjava\b/i,
] as const;
const TITLE_TOKEN_ALIASES = new Map<string, string>([
  ["developer", "engineer"],
  ["developers", "engineer"],
  ["dev", "engineer"],
]);
const LOCATION_NOISE_TOKENS = new Set([
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
const GENERIC_JOB_PATH_SEGMENTS = new Set([
  "job",
  "jobs",
  "jobs-view",
  "view",
  "career",
  "careers",
  "position",
  "positions",
  "opening",
  "openings",
  "search",
  "apply",
  "company",
  "companies",
  "category",
  "categories",
  "vacancy",
  "vacancies",
  "role",
  "roles",
  "pune",
  "punes",
  "punesim",
  "pozita",
  "pozite",
  "konkurs",
  "karriere",
  "karrier",
]);
const SITE_UTILITY_PATH_SEGMENTS = new Set([
  "about",
  "about-us",
  "blog",
  "blogs",
  "browse",
  "candidates",
  "contact",
  "contact-us",
  "faq",
  "help",
  "hire",
  "hiring-data",
  "support",
  "privacy",
  "privacy-policy",
  "cookie-policy",
  "politika-e-privatesise",
  "politike-e-privatesise",
  "politike-privatesise",
  "politika-privatesise",
  "mbrojtja-e-te-dhenave",
  "mbrojtja-e-te-dhenave-personale",
  "terms",
  "terms-of-service",
  "legal",
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "account",
  "kontakt",
  "krijo-cv",
  "create-cv",
  "create-resume",
  "llogaritja-e-pages",
  "location",
  "news",
  "press",
  "publiko",
  "role",
  "careers-home",
]);
const SITE_UTILITY_TITLE_PATTERN =
  /^(blog|blogs|news|about|about us|contact|contact us|kontakt|faq|help|support|privacy|privacy policy|cookie policy|politik[eë]\s+e\s+privat[eë]sis[eë]|politika\s+e\s+privat[eë]sis[eë]|terms|sign in|log in|login|register|sign up|create cv|krijo cv|create resume|home|homepage|view all jobs|view all .+ jobs|overview|locations|pricing|jobs|remote jobs|remote|trust|curated|wellfound|wellfound:ai|why wellfound|previous|next|platform status|privacy & cookies|terms & risks|salaries|for companies|get discovered|hire developers|create profile|recruit pro|try errgo|web3 jobs|tech startups|sign up with google|produktet|publiko konkurs|llogarite pag[eë]n|llogaritja e pages|www\.fb\.com\/kosovajob|fb\.com\/kosovajob)$/i;
// Albanian privacy titles often continue after "Privatësisë". Avoid `\b` after
// diacritics — JS word boundaries treat `ë` as non-word, so `\b` fails before space.
const SITE_UTILITY_ALBANIAN_PRIVACY_TITLE_PATTERN =
  /^politik[aeë]\s+e\s+privat[eë]sis[eë]/i;
const SITE_UTILITY_TITLE_PREFIX_PATTERN =
  /^(sign up with|view all|create profile|get discovered|for companies|hire developers|platform status|privacy|privacy policy|cookie policy|terms|remote jobs|web3 jobs|tech startups|recruit pro|try errgo|why wellfound|publiko|llogarite|llogaritja|www\.fb\.com\/|fb\.com\/)\b/i;
const SITE_UTILITY_OPEN_POSITIONS_TITLE_PATTERN = /^\d+\s+open positions$/i;
// Informational pages that boards list beside their postings and that read
// like jobs once they are cards: salary explorers ("Find salaries", "Cashier
// salaries in Waterloo, IA"), curated collections ("Job Collections"), hub
// pages ("Job Opportunities", "Jobs by location") and advice articles ("How
// the Local Government Hiring Process Works"). Source-generic by design.
const SITE_UTILITY_INFO_TITLE_PATTERN =
  /^(find|browse|explore|compare)\s+(salaries|jobs|companies|careers)\b|\bsalar(y|ies)\s+in\s+\S|^(job|jobs|career|careers)\s+(opportunities|collections|listings|openings|by\s+\w+)$|^how\s+(the\s+)?.+\b(works|process)\b/i;
// Board self-promotion rendered as a result card ("Unlock your remote career
// potential with Remote OK Premium ★★★★★").
const SITE_PROMO_TITLE_PATTERN =
  /^(?:unlock|upgrade|get exclusive|be the first|try|go)\b.*\b(?:premium|pro|plus|membership|subscription)\b|\bpremium\b.*\b(?:access|career|jobs?)\b|[★⭐]{2,}|\b(?:\d+[,.]?\d*k?\+? remote jobs)\b/iu;
// Board self-promotion written as an instruction to the reader rather than a
// role: "Post a Remote Job", "Hire developers", "Advertise your job". A
// posting title never opens by telling the reader to post or hire.
const SITE_CALL_TO_ACTION_TITLE_PATTERN =
  /^(?:post|hire|advertise|promote|sponsor|upgrade|subscribe|claim)\b(?:\s+(?:a|an|your|the|our|more|now))?\s+\S/i;
// Marketing that sells a salary band instead of naming one role: "Remote Tech
// Jobs Paying $130k to $250k", "Jobs from $80,000 - $150,000". The tell is a
// plural "jobs" heading joined to a pay range or a "paying" clause; a single
// posting states its own title and carries salary in its own field.
const SITE_SALARY_MARKETING_TITLE_PATTERN =
  /\bjobs\b[^$]*\bpaying\b|\bjobs\b[^$]*\$\s?\d[\d,.]*\s?k?\s*(?:to|-|\u2013|\u2014)\s*\$?\s?\d/i;
// A listing index that carries its own freshness line once the card is
// flattened: "Remote Data Science JobsLatest post about 3 hours ago". The
// freshness phrase belongs to the index, never to one posting.
const LISTING_INDEX_FRESHNESS_TITLE_PATTERN =
  /\bjobs\s*(?:latest|newest|last)\s+(?:post|posting|job|update)\b|\bjobs\s*updated\s+(?:about\s+)?\d/i;
// Category routes rendered as cards: "<Role> Jobs in <City> & <City>",
// "Remote Jobs in Europe". "Jobs in ..." is a place-scoped index; a posting
// puts its location in its own field.
const LISTING_INDEX_LOCATION_TITLE_PATTERN = /\bjobs\s+in\s+\S/i;
// A bare category heading: "Prishtina Jobs", "Remote Python Jobs". Up to four
// words ending in "Jobs" has the shape of an index label \u2014 but only the shape:
// "Director of Green Jobs" is a real posting, so the shape alone never drops a
// record (see isListingIndexCategoryTitle).
const LISTING_INDEX_CATEGORY_TITLE_PATTERN =
  /^(?<lead>(?:[\p{L}\d.&'\u2019/+-]+\s+){0,3})jobs$/iu;
// Role nouns that make "<words> Jobs" a posting title rather than a category
// route. Shape rules only: this is not a taxonomy, just the common heads.
const LISTING_INDEX_ROLE_NOUN_PATTERN =
  /\b(?:director|manager|engineer|assistant|nurse|developer|analyst|clerk|technician|specialist|coordinator|representative|lead)s?\b/iu;
// A category route names a place, an industry or a category and stops:
// "Remote Python Jobs". A connector word means the words before "Jobs" are
// describing a role instead ("Director of Green Jobs", "Head for Jobs").
const LISTING_INDEX_TITLE_CONNECTOR_PATTERN =
  /(?:^|\s)(?:of|for|and|at|with|to|in|on|the)(?:\s|$)|&/iu;

/**
 * True when a "<words> Jobs" title is a category route rather than a posting.
 * The shape alone is not enough: the words before "Jobs" have to read as a
 * place, industry or category \u2014 no role noun and no connector \u2014 or the record
 * has to carry nothing a posting would (no employer and no description).
 */
function isListingIndexCategoryTitle(
  title: string,
  record: { hasDescription: boolean; hasEmployer: boolean },
): boolean {
  const match = LISTING_INDEX_CATEGORY_TITLE_PATTERN.exec(title);
  if (!match) {
    return false;
  }
  // Nothing an employer would publish: no company, no body text.
  if (!record.hasEmployer && !record.hasDescription) {
    return true;
  }
  const lead = cleanLine(match.groups?.lead ?? "");
  if (!lead) {
    return true;
  }
  return (
    !LISTING_INDEX_ROLE_NOUN_PATTERN.test(title) &&
    !LISTING_INDEX_TITLE_CONNECTOR_PATTERN.test(lead)
  );
}
// Page chrome whose accessible name carries its own control hint:
// "Accessibility Statement (opens in new tab)", "Privacy (opens in a new
// window)". Anything announcing where it opens is navigation.
const SITE_UTILITY_CHROME_TITLE_PATTERN =
  /\(opens?\s+in\s+(?:a\s+)?new\s+(?:tab|window)\)|^(?:accessibility|cookie|modern slavery|sitemap)\b.*\b(?:statement|preferences|settings|notice|map)\b/i;
const PAGINATION_TITLE_PATTERN =
  /^(?:(?:go\s+to\s+)?page\s+\d+|next(?:\s+page)?|previous(?:\s+page)?)$/iu;
const ABSENT_EMPLOYER_PATTERN =
  /^(?:employer|company|organization|organisation)?\s*(?:not\s+(?:listed|stated|available)|unknown|unavailable|n\/?a)?$/iu;
const DETAIL_QUERY_KEY_PATTERN =
  /^(?:id|job|jobid|job_id|posting|position|requisition|req)$/iu;
const DETAIL_PATH_ID_PATTERN =
  /(?:^[0-9a-f]{8}-[0-9a-f-]{27,}$|\d{4,}|^(?=[^]*\d)(?=[^]*[a-z])[a-z0-9]{8,}$)/iu;
const ROLE_TITLE_NOUN_PATTERN =
  /\b(?:engineer|developer|manager|analyst|designer|specialist|coordinator|assistant|technician|consultant|administrator|scientist|officer|clerk|recruiter|nurse|driver|cashier|representative|director|lead|intern)\b/iu;
const SITE_UTILITY_INFO_PATH_SEGMENTS = new Set([
  "salaries",
  "salary",
  "job-collections",
  "collections",
  "career-advice",
  "advice",
  "resources",
  "guides",
  "cmp",
]);
const TWO_PANE_RESULTS_LIST_CLASS_HINTS = [
  "jobs-search-results",
  "jobs-search-results-list",
  "jobs-search-two-pane",
  "scaffold-layout__list",
  "scaffold-layout__content",
  "job-card-container",
  "job-card-list",
] as const;
const TWO_PANE_DETAIL_PANE_CLASS_HINTS = [
  "jobs-search__job-details",
  "jobs-search-two-pane__details",
  "job-details",
  "jobs-details",
  "job-view-layout",
] as const;
const SPECIALIZED_TITLE_TOKEN_PHRASES = [
  ["full", "stack"],
  ["frontend"],
  ["backend"],
  ["react", "native"],
  ["qa", "automation"],
  ["site", "reliability"],
  ["machine", "learning"],
  ["devops"],
] as const;
const SEARCH_SURFACE_SCORE_WEIGHT = 25;
const SEARCH_TITLE_DOMINANCE_THRESHOLD = 20;
const TECHNICAL_ROLE_FALLBACK_BONUS = 900;
const TECHNICAL_ROLE_MISS_PENALTY = 650;

function cleanLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePreferenceText(
  value: string,
  mode: "title" | "location",
): string {
  const normalized = cleanLine(value)
    .replace(/\bfullstack\b/gi, "full stack")
    .replace(/\bfront\s*end\b/gi, "frontend")
    .replace(/\bback\s*end\b/gi, "backend")
    .replace(/(^|[^a-z0-9])c\s*\+\s*\+(?=$|[^a-z0-9])/gi, "$1cplusplus")
    .replace(/(^|[^a-z0-9])c\s*#(?=$|[^a-z0-9])/gi, "$1csharp")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (mode !== "location") {
    return normalized;
  }

  return normalized
    .replace(/\bon\s*site\b/gi, "onsite")
    .replace(/\bwork\s+from\s+home\b/gi, "remote");
}

function tokenizePreferenceValue(
  value: string,
  mode: "title" | "location",
): string[] {
  const tokens = normalizePreferenceText(value, mode)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      if (mode === "location" && LOCATION_NOISE_TOKENS.has(token)) {
        return [];
      }

      if (mode === "title") {
        return [TITLE_TOKEN_ALIASES.get(token) ?? token];
      }

      return [token];
    });

  return [...new Set(tokens)];
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

function preferenceTokensEqual(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (left.length < 6 || right.length < 6) {
    return false;
  }

  return isEditDistanceAtMostOne(left, right);
}

function countMatchedPreferenceTokens(
  desiredTokens: readonly string[],
  candidateTokens: readonly string[],
): number {
  const remainingCandidateTokens = [...candidateTokens];
  let matchedCount = 0;

  for (const desiredToken of desiredTokens) {
    const matchedIndex = remainingCandidateTokens.findIndex((candidateToken) =>
      preferenceTokensEqual(desiredToken, candidateToken),
    );

    if (matchedIndex === -1) {
      continue;
    }

    matchedCount += 1;
    remainingCandidateTokens.splice(matchedIndex, 1);
  }

  return matchedCount;
}

function matchesTechnicalRoleSignal(value: string | null | undefined): boolean {
  const normalized = cleanLine(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return TECHNICAL_ROLE_SIGNAL_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
}

function hasTechnicalSearchIntent(
  searchPreferences?: ExtractionSearchPreferences,
): boolean {
  return (searchPreferences?.targetRoles ?? []).some((role) =>
    matchesTechnicalRoleSignal(role),
  );
}

function jobLooksTechnicallyRelevant(job: ExtractedJobInput): boolean {
  if (matchesTechnicalRoleSignal(job.title)) {
    return true;
  }

  if (job.keySkills.some((skill) => matchesTechnicalRoleSignal(skill))) {
    return true;
  }

  const evidenceText = [
    job.summary,
    job.description,
    ...(job.responsibilities ?? []),
    ...(job.minimumQualifications ?? []),
    ...(job.preferredQualifications ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return matchesTechnicalRoleSignal(evidenceText);
}

function everyPreferenceTokenMatches(
  desiredTokens: readonly string[],
  candidateTokens: readonly string[],
): boolean {
  return desiredTokens.every((desiredToken) =>
    candidateTokens.some((candidateToken) =>
      preferenceTokensEqual(desiredToken, candidateToken),
    ),
  );
}

function titlePreferenceMatchPassesThreshold(
  desiredTokens: readonly string[],
  candidateTokens: readonly string[],
): boolean {
  if (desiredTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }

  const leadingDesiredToken = desiredTokens[0];
  if (leadingDesiredToken === undefined) {
    return false;
  }

  if (desiredTokens.length === 1) {
    return candidateTokens.some((candidateToken) =>
      preferenceTokensEqual(candidateToken, leadingDesiredToken),
    );
  }

  const normalizedCandidate = candidateTokens.join(" ");
  const normalizedDesired = desiredTokens.join(" ");
  if (
    normalizedDesired &&
    new RegExp(
      `(^|\\s)${normalizedDesired.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`,
    ).test(normalizedCandidate)
  ) {
    return true;
  }

  if (everyPreferenceTokenMatches(desiredTokens, candidateTokens)) {
    return true;
  }

  const matchedCount = countMatchedPreferenceTokens(
    desiredTokens,
    candidateTokens,
  );
  const matchRatio = matchedCount / desiredTokens.length;

  if (desiredTokens.length === 2) {
    return matchedCount === 2;
  }

  if (desiredTokens.length === 3) {
    return matchedCount >= 2 && matchRatio >= 2 / 3;
  }

  return matchedCount >= 3 && matchRatio >= 0.6;
}

function containsTokenPhrase(
  haystack: readonly string[],
  phrase: readonly string[],
): boolean {
  if (phrase.length === 0 || haystack.length < phrase.length) {
    return false;
  }

  for (let index = 0; index <= haystack.length - phrase.length; index += 1) {
    const matchesPhrase = phrase.every((token, phraseIndex) =>
      preferenceTokensEqual(haystack[index + phraseIndex] ?? "", token),
    );
    if (matchesPhrase) {
      return true;
    }
  }

  return false;
}

function scoreSpecializedTitlePhraseMatch(
  desiredTokens: readonly string[],
  candidateTokens: readonly string[],
): number {
  return SPECIALIZED_TITLE_TOKEN_PHRASES.reduce((bestScore, phrase) => {
    if (
      !containsTokenPhrase(desiredTokens, phrase) ||
      !containsTokenPhrase(candidateTokens, phrase)
    ) {
      return bestScore;
    }

    return Math.max(bestScore, phrase.length * 2);
  }, 0);
}

function scorePreferenceMatch(
  candidate: string,
  desiredValues: readonly string[] | undefined,
  mode: "title" | "location",
): number {
  if (!desiredValues || desiredValues.length === 0) {
    return 0;
  }

  const candidateTokens = tokenizePreferenceValue(candidate, mode);
  if (candidateTokens.length === 0) {
    return 0;
  }

  let bestScore = 0;

  for (const desiredValue of desiredValues) {
    const desiredTokens = tokenizePreferenceValue(desiredValue, mode);
    if (desiredTokens.length === 0) {
      continue;
    }

    const matchedCount = countMatchedPreferenceTokens(
      desiredTokens,
      candidateTokens,
    );
    if (matchedCount === 0) {
      continue;
    }

    if (
      mode === "title" &&
      !titlePreferenceMatchPassesThreshold(desiredTokens, candidateTokens)
    ) {
      continue;
    }

    const matchRatio = matchedCount / desiredTokens.length;
    let score = matchedCount * 10 + Math.round(matchRatio * 10);

    if (matchedCount === desiredTokens.length) {
      score += 15;
    } else if (matchedCount >= 3 || matchRatio >= 0.6) {
      score += 8;
    }

    if (mode === "title") {
      score += scoreSpecializedTitlePhraseMatch(desiredTokens, candidateTokens);
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function scoreJobForPreferences(
  job: ExtractedJobInput,
  searchPreferences?: ExtractionSearchPreferences,
): number {
  const titleScore = scoreJobTitleForPreferences(job, searchPreferences);
  const locationScore = searchPreferences
    ? scorePreferenceMatch(
        job.location,
        searchPreferences.locations,
        "location",
      )
    : 0;
  const leadingSpecificLocationBonus = searchPreferences?.locations?.length
    ? Math.max(
        0,
        ...searchPreferences.locations.map((desiredLocation) => {
          const desiredTokens = tokenizePreferenceValue(
            desiredLocation,
            "location",
          );
          const candidateTokens = tokenizePreferenceValue(
            job.location,
            "location",
          );
          if (desiredTokens.length < 2 || candidateTokens.length === 0) {
            return 0;
          }

          const leadingDesiredToken = desiredTokens[0];
          if (leadingDesiredToken === undefined) {
            return 0;
          }

          return candidateTokens.some((candidateToken) =>
            preferenceTokensEqual(candidateToken, leadingDesiredToken),
          )
            ? 700
            : 0;
        }),
      )
    : 0;
  const locationSpecificityBonus = searchPreferences?.locations?.length
    ? Math.max(
        0,
        ...searchPreferences.locations.map((desiredLocation) => {
          const desiredTokens = tokenizePreferenceValue(
            desiredLocation,
            "location",
          );
          const candidateTokens = tokenizePreferenceValue(
            job.location,
            "location",
          );
          return desiredTokens
            .filter((desiredToken) =>
              candidateTokens.some((candidateToken) =>
                preferenceTokensEqual(desiredToken, candidateToken),
              ),
            )
            .reduce((sum, token) => sum + Math.min(token.length, 12), 0);
        }),
      )
    : 0;
  const broadTrailingLocationOnlyPenalty = searchPreferences?.locations?.length
    ? Math.max(
        0,
        ...searchPreferences.locations.map((desiredLocation) => {
          const desiredTokens = tokenizePreferenceValue(
            desiredLocation,
            "location",
          );
          const candidateTokens = tokenizePreferenceValue(
            job.location,
            "location",
          );
          if (desiredTokens.length < 2) {
            return 0;
          }

          const leadingDesiredToken = desiredTokens[0];
          if (leadingDesiredToken === undefined) {
            return 0;
          }

          const matchesLeadingSpecificToken = candidateTokens.some(
            (candidateToken) =>
              preferenceTokensEqual(candidateToken, leadingDesiredToken),
          );
          const matchesTrailingBroaderToken = desiredTokens
            .slice(1)
            .some((desiredToken) =>
              candidateTokens.some((candidateToken) =>
                preferenceTokensEqual(candidateToken, desiredToken),
              ),
            );

          return !matchesLeadingSpecificToken && matchesTrailingBroaderToken
            ? 600
            : 0;
        }),
      )
    : 0;

  const normalizedTitle = normalizePreferenceText(job.title, "title");
  const normalizedCompany = normalizePreferenceText(job.company, "title");
  const technicalSearchIntent = hasTechnicalSearchIntent(searchPreferences);
  const technicalRoleFallbackBonus =
    technicalSearchIntent &&
    titleScore === 0 &&
    jobLooksTechnicallyRelevant(job)
      ? TECHNICAL_ROLE_FALLBACK_BONUS
      : 0;
  let qualityPenalty = broadTrailingLocationOnlyPenalty;

  if ((cleanLine(job.title).match(/\S+/g) ?? []).length <= 1) {
    qualityPenalty += 400;
  }

  if (/\|\s*$/.test(cleanLine(job.title))) {
    qualityPenalty += 250;
  }

  if (/\bwith verification\b/i.test(job.company)) {
    qualityPenalty += 300;
  }

  if (
    normalizedTitle &&
    normalizedTitle.length >= 6 &&
    normalizedCompany &&
    normalizedCompany !== normalizedTitle &&
    normalizedCompany.includes(normalizedTitle)
  ) {
    qualityPenalty += 250;
  }

  if (
    technicalSearchIntent &&
    titleScore === 0 &&
    technicalRoleFallbackBonus === 0
  ) {
    qualityPenalty += TECHNICAL_ROLE_MISS_PENALTY;
  }

  return (
    titleScore * 100 +
    technicalRoleFallbackBonus +
    locationScore * 10 +
    leadingSpecificLocationBonus +
    locationSpecificityBonus * 10 +
    (job.easyApplyEligible ? 1 : 0) -
    qualityPenalty
  );
}

function scoreJobTitleForPreferences(
  job: ExtractedJobInput,
  searchPreferences?: ExtractionSearchPreferences,
): number {
  return searchPreferences
    ? scorePreferenceMatch(job.title, searchPreferences.targetRoles, "title")
    : 0;
}

export function isJobPreferenceAligned(input: {
  job: ExtractedJobInput;
  searchPreferences?: ExtractionSearchPreferences;
}): boolean {
  if (!input.searchPreferences) {
    return true;
  }

  const { searchPreferences, job } = input;

  if ((searchPreferences.targetRoles ?? []).length === 0) {
    return scoreJobForPreferences(job, searchPreferences) > 0;
  }

  const titleScore = scorePreferenceMatch(
    job.title,
    searchPreferences.targetRoles,
    "title",
  );
  if (titleScore > 0) {
    return true;
  }

  return (
    hasTechnicalSearchIntent(searchPreferences) &&
    jobLooksTechnicallyRelevant(job)
  );
}

function includesClassHint(
  value: string | null | undefined,
  hints: readonly string[],
): boolean {
  const normalized = cleanLine(value).toLowerCase();
  return hints.some((hint) => normalized.includes(hint));
}

function scoreSearchResultCardSurfaceQuality(
  candidate: SearchResultCardCandidate,
): number {
  const meta = candidate.captureMeta;
  if (!meta) {
    return 0;
  }

  let score = 0;

  if (meta.hasJobDataset) {
    score += 70;
  }

  if (meta.inLikelyResultsList) {
    score += 55;
  }

  if (
    includesClassHint(meta.rootClassName, TWO_PANE_RESULTS_LIST_CLASS_HINTS)
  ) {
    score += 40;
  }

  if (
    meta.hasDismissLabel ||
    candidate.lines.some((line) => /\bdismiss\b.*\bjob\b/i.test(line))
  ) {
    score += 25;
  }

  if (meta.intersectsViewport) {
    score += 150;
  } else if (meta.isVisible) {
    score += 50;
  }

  if (meta.sameRootJobAnchorCount <= 1) {
    score += 10;
  } else if (meta.sameRootJobAnchorCount >= 4) {
    score -= 25;
  }

  const viewportTop =
    typeof meta.viewportTop === "number" && Number.isFinite(meta.viewportTop)
      ? meta.viewportTop
      : null;
  if (viewportTop !== null) {
    if (viewportTop >= -48 && viewportTop <= 560) {
      score += 45;
    } else if (viewportTop > 560) {
      score -= Math.min(viewportTop - 560, 1600) / 18;
    } else if (viewportTop < -120) {
      score -= Math.min(Math.abs(viewportTop) - 120, 800) / 18;
    }
  }

  const viewportDistance =
    typeof meta.viewportDistance === "number" &&
    Number.isFinite(meta.viewportDistance)
      ? Math.max(0, meta.viewportDistance)
      : null;
  if (viewportDistance !== null) {
    score -= Math.min(viewportDistance, 1600) / 12;
  }

  if (meta.inDetailPane) {
    score -= 70;
  }

  if (includesClassHint(meta.rootClassName, TWO_PANE_DETAIL_PANE_CLASS_HINTS)) {
    score -= 55;
  }

  if (meta.inAside) {
    score -= 80;
  }

  if (meta.inHeader) {
    score -= 60;
  }

  if (meta.inNavigation) {
    score -= 80;
  }

  score += Math.min(candidate.lines.length, 8) * 3;
  score += Math.min(cleanLine(candidate.headingText).length, 40) / 4;
  score += Math.min(cleanLine(candidate.anchorText).length, 80) / 8;

  return Math.round(score);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalized = cleanLine(value);

    if (!normalized) {
      return [];
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [normalized];
  });
}

function titleCaseWords(value: string): string {
  return value.replace(
    /\b\p{L}[\p{L}\p{N}]*/gu,
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
}

export function normalizeQueryParamKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isJobIdShapedParamKey(key: string): boolean {
  const normalized = normalizeQueryParamKey(key);
  return normalized.includes("jobid") || normalized.endsWith("jid");
}

export function isTrackingShapedParamKey(key: string): boolean {
  const normalized = normalizeQueryParamKey(key);
  return normalized.startsWith("utm") || normalized.includes("track");
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHttpUrl(value: string, baseUrl?: string): URL | null {
  const normalized = cleanLine(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized, baseUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const LEARNED_DETAIL_TEMPLATE_PLACEHOLDER = "{sourceJobId}";
const DETAIL_ROUTE_ID_SEGMENT_PATTERN = /\d{4,}|[0-9a-f]{8,}/i;
const REWRITABLE_DETAIL_ID_SEGMENT_PATTERN = /^(?:\d{4,}|[0-9a-f]{8,})$/i;
const EMBEDDED_JOB_ID_VALUE_PATTERN = /^\d{3,}$/;

export function findDetailRouteIdSegment(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return null;
  }

  const decoded = safeDecodeUriComponent(lastSegment);
  return DETAIL_ROUTE_ID_SEGMENT_PATTERN.test(decoded) ? decoded : null;
}

export interface LearnedSearchSurfaceRouteEvidence {
  readonly sharedSurfaceUrls: ReadonlySet<string>;
  readonly detailTemplatesByOrigin: ReadonlyMap<string, string>;
  readonly observedDetailIdsByOrigin: ReadonlyMap<string, ReadonlySet<string>>;
}

interface LearnedDetailRouteObservation {
  readonly prefixSegments: readonly string[];
  readonly id: string;
  readonly endsWithSlash: boolean;
}

function normalizeRouteIdentityKey(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

export function observeLearnedSearchSurfaceRoutes(input: {
  pageUrl?: string | null;
  observedUrls: readonly (string | null | undefined)[];
  detailOnlyUrls?: readonly (string | null | undefined)[];
}): LearnedSearchSurfaceRouteEvidence {
  const routeKeyMeta = new Map<
    string,
    { count: number; hasIdSegment: boolean }
  >();
  const observationsByOrigin = new Map<
    string,
    LearnedDetailRouteObservation[]
  >();
  const seenObservationKeys = new Set<string>();

  const countRouteKey = (routeKey: string, hasIdSegment: boolean) => {
    const existing = routeKeyMeta.get(routeKey);
    routeKeyMeta.set(routeKey, {
      count: (existing?.count ?? 0) + 1,
      hasIdSegment: (existing?.hasIdSegment ?? false) || hasIdSegment,
    });
  };

  const pageUrl = parseHttpUrl(input.pageUrl ?? "");
  if (pageUrl) {
    countRouteKey(
      normalizeRouteIdentityKey(pageUrl),
      findDetailRouteIdSegment(pageUrl.pathname) !== null,
    );
  }

  const observeDetailRoute = (parsed: URL) => {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = segments.at(-1);
    if (!lastSegment) {
      return;
    }

    const decodedId = safeDecodeUriComponent(lastSegment);
    if (!REWRITABLE_DETAIL_ID_SEGMENT_PATTERN.test(decodedId)) {
      return;
    }

    const observationKey = `${normalizeRouteIdentityKey(parsed)}#${decodedId}`;
    if (seenObservationKeys.has(observationKey)) {
      return;
    }
    seenObservationKeys.add(observationKey);

    const bucket = observationsByOrigin.get(parsed.origin) ?? [];
    bucket.push({
      prefixSegments: segments
        .slice(0, -1)
        .map((segment) => safeDecodeUriComponent(segment)),
      id: decodedId,
      endsWithSlash: parsed.pathname.endsWith("/"),
    });
    observationsByOrigin.set(parsed.origin, bucket);
  };

  for (const observedUrl of input.observedUrls) {
    const parsed = parseHttpUrl(observedUrl ?? "");
    if (!parsed) {
      continue;
    }

    countRouteKey(
      normalizeRouteIdentityKey(parsed),
      findDetailRouteIdSegment(parsed.pathname) !== null,
    );
    observeDetailRoute(parsed);
  }

  for (const detailOnlyUrl of input.detailOnlyUrls ?? []) {
    const parsed = parseHttpUrl(detailOnlyUrl ?? "");
    if (!parsed) {
      continue;
    }

    observeDetailRoute(parsed);
  }

  const sharedSurfaceUrls = new Set<string>();
  for (const [routeKey, meta] of routeKeyMeta) {
    if (meta.count >= 2 && !meta.hasIdSegment) {
      sharedSurfaceUrls.add(routeKey);
    }
  }

  const detailTemplatesByOrigin = new Map<string, string>();
  const observedDetailIdsByOrigin = new Map<string, Set<string>>();
  for (const [origin, observations] of observationsByOrigin) {
    const firstObservation = observations[0];
    if (!firstObservation) {
      continue;
    }

    let commonPrefix = firstObservation.prefixSegments;
    let allEndsWithSlash = true;
    for (const observation of observations) {
      if (!observation.endsWithSlash) {
        allEndsWithSlash = false;
      }

      const nextPrefix: string[] = [];
      const sharedLength = Math.min(
        commonPrefix.length,
        observation.prefixSegments.length,
      );
      for (
        let index = 0;
        index < sharedLength &&
        commonPrefix[index] === observation.prefixSegments[index];
        index += 1
      ) {
        const segment = commonPrefix[index];
        if (segment === undefined) break;
        nextPrefix.push(segment);
      }
      commonPrefix = nextPrefix;
    }

    if (commonPrefix.length === 0) {
      continue;
    }

    detailTemplatesByOrigin.set(
      origin,
      `/${[...commonPrefix, LEARNED_DETAIL_TEMPLATE_PLACEHOLDER].join("/")}${allEndsWithSlash ? "/" : ""}`,
    );
    observedDetailIdsByOrigin.set(
      origin,
      new Set(observations.map((observation) => observation.id)),
    );
  }

  return {
    sharedSurfaceUrls,
    detailTemplatesByOrigin,
    observedDetailIdsByOrigin,
  };
}

export function isSharedLearnedSurfaceUrl(
  url: string | null | undefined,
  evidence: LearnedSearchSurfaceRouteEvidence,
): boolean {
  const parsed = parseHttpUrl(cleanLine(url));
  return (
    parsed !== null &&
    evidence.sharedSurfaceUrls.has(normalizeRouteIdentityKey(parsed))
  );
}

function formatLearnedDetailUrl(
  origin: string,
  template: string,
  jobId: string,
): string {
  return `${origin}${template.replace(LEARNED_DETAIL_TEMPLATE_PLACEHOLDER, encodeURIComponent(jobId))}`;
}

export function buildLearnedDetailUrlFromHint(input: {
  url: string | null | undefined;
  pageUrl: string;
  sourceJobIdHint?: string | null;
  searchableText?: string | null;
  evidence: LearnedSearchSurfaceRouteEvidence;
}): string | null {
  const parsed =
    parseHttpUrl(cleanLine(input.url), input.pageUrl) ??
    parseHttpUrl(input.pageUrl);
  if (!parsed) {
    return null;
  }

  const template = input.evidence.detailTemplatesByOrigin.get(parsed.origin);
  if (!template) {
    return null;
  }

  const hint = canonicalizeNumericJobIdHint(input.sourceJobIdHint);
  if (hint) {
    return formatLearnedDetailUrl(parsed.origin, template, hint);
  }

  const text = cleanLine(input.searchableText).toLowerCase();
  if (!text) {
    return null;
  }

  for (const value of parsed.searchParams.values()) {
    const paramValue = cleanLine(value);
    if (
      EMBEDDED_JOB_ID_VALUE_PATTERN.test(paramValue) &&
      text.includes(paramValue.toLowerCase())
    ) {
      return formatLearnedDetailUrl(parsed.origin, template, paramValue);
    }
  }

  return null;
}

function canonicalizeUrl(
  url: string | null | undefined,
  baseUrl: string,
): string {
  const normalizedUrl = cleanLine(url);

  if (!normalizedUrl) {
    return "";
  }

  const parsed = parseHttpUrl(normalizedUrl, baseUrl);
  if (!parsed) {
    return "";
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (
      isTrackingShapedParamKey(key) ||
      isJobIdShapedParamKey(key) ||
      normalizeQueryParamKey(key).includes("geo")
    ) {
      parsed.searchParams.delete(key);
    }
  }

  if (findDetailRouteIdSegment(parsed.pathname)) {
    for (const key of [...parsed.searchParams.keys()]) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.hash = "";
  return parsed.toString();
}

function canonicalizeNumericJobIdHint(
  value: string | null | undefined,
): string | null {
  const normalized = cleanLine(value);
  return /^\d+$/.test(normalized) ? normalized : null;
}

function buildSearchResultCardFingerprint(
  candidate: SearchResultCardCandidate,
): string {
  const fingerprint = uniqueStrings(
    [candidate.anchorText, candidate.headingText, ...candidate.lines]
      .filter((value): value is string => Boolean(value))
      .map((value) => cleanLine(value).toLowerCase()),
  )
    .join(" ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return fingerprint || "candidate";
}

export function buildSearchResultCardMergeKey(input: {
  pageUrl: string;
  candidate: SearchResultCardCandidate;
  canonicalUrl?: string | null;
  evidence?: LearnedSearchSurfaceRouteEvidence;
}): string {
  const baseCanonicalUrl = cleanLine(
    input.canonicalUrl ?? input.candidate.canonicalUrl,
  );
  if (!baseCanonicalUrl) {
    return `card:${buildSearchResultCardFingerprint(input.candidate)}`;
  }

  const resolvedEvidence =
    input.evidence ??
    observeLearnedSearchSurfaceRoutes({
      pageUrl: input.pageUrl,
      observedUrls: [baseCanonicalUrl],
    });

  if (
    isSharedLearnedSurfaceUrl(baseCanonicalUrl, resolvedEvidence) &&
    !shouldCanonicalizeSearchSurfaceDetailRoute({
      candidate: input.candidate,
      pageUrl: input.pageUrl,
      evidence: resolvedEvidence,
    })
  ) {
    return `${baseCanonicalUrl}::card:${buildSearchResultCardFingerprint(input.candidate)}`;
  }

  return baseCanonicalUrl;
}

/**
 * A stable posting id from a URL that carries no explicit id: host and path
 * (plus any id-shaped query values) as one slug. Every extraction path uses
 * this same fallback so the same listing reached twice gets the same id.
 */
function buildPathBasedGenericJobId(parsed: URL): string {
  const interestingParamKeys = [
    "id",
    "job",
    "jobid",
    "job_id",
    "gh_jid",
    "req",
    "reqid",
    "opening",
  ];
  const interestingParams = interestingParamKeys
    .map((key) => parsed.searchParams.get(key))
    .filter((value): value is string => Boolean(cleanLine(value)))
    .join("_");
  const rawValue = [parsed.hostname, parsed.pathname, interestingParams]
    .filter(Boolean)
    .join("_");

  return rawValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

export function buildGenericJobId(url: string): string {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map(safeDecodeUriComponent);
    const detailId = pathSegments.at(-1);
    const detailRoute = pathSegments.at(-2);
    if (
      detailId &&
      detailRoute &&
      /^(?:jobs?|positions?|openings?|requisitions?|vacanc(?:y|ies))$/iu.test(
        detailRoute,
      )
    ) {
      return detailId.slice(0, 160);
    }
    return buildPathBasedGenericJobId(parsed);
  } catch {
    return url
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 160);
  }
}

/**
 * Replaces only the legacy host-plus-path fallback with the semantic detail
 * route id. Provider-supplied ids stay authoritative.
 */
export function normalizeExtractedJobSourceId<T extends ExtractedJobInput>(
  job: T,
): T {
  try {
    const parsed = new URL(job.canonicalUrl);
    const legacyFallback = buildPathBasedGenericJobId(parsed);
    const semanticFallback = buildGenericJobId(job.canonicalUrl);
    if (
      job.sourceJobId !== legacyFallback ||
      semanticFallback === legacyFallback
    ) {
      return job;
    }
    return { ...job, sourceJobId: semanticFallback };
  } catch {
    return job;
  }
}

function normalizeStringArray(
  values: readonly string[] | null | undefined,
): string[] {
  return uniqueStrings((values ?? []).map((value) => cleanLine(value)));
}

function normalizeDetectedWorkMode(
  value: string,
): JobPosting["workMode"][number] | null {
  const normalized = cleanLine(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("remote")) {
    return "remote";
  }

  if (normalized.includes("hybrid") || normalized.includes("flexible")) {
    return "hybrid";
  }

  if (
    normalized.includes("in_office") ||
    normalized.includes("in office") ||
    normalized.includes("on-site") ||
    normalized.includes("onsite")
  ) {
    return "onsite";
  }

  return null;
}

function normalizeWorkModes(
  values: readonly string[] | null | undefined,
  text?: string,
): JobPosting["workMode"] {
  const detected = new Set<JobPosting["workMode"][number]>();

  for (const value of values ?? []) {
    const normalizedWorkMode = normalizeDetectedWorkMode(value);
    if (normalizedWorkMode) {
      detected.add(normalizedWorkMode);
    }
  }

  const haystack = cleanLine(text).toLowerCase();
  if (haystack) {
    const normalizedWorkMode = normalizeDetectedWorkMode(haystack);
    if (normalizedWorkMode) {
      detected.add(normalizedWorkMode);
    }
  }

  return WORK_MODE_VALUES.filter((value) => detected.has(value));
}

function toIsoDateTimeOrNull(value: string | null | undefined): string | null {
  const normalized = cleanLine(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function preferLatestIsoDateTime(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  const currentIso = toIsoDateTimeOrNull(current);
  const candidateIso = toIsoDateTimeOrNull(candidate);
  if (!currentIso) {
    return candidateIso;
  }
  if (!candidateIso) {
    return currentIso;
  }
  return Date.parse(candidateIso) > Date.parse(currentIso)
    ? candidateIso
    : currentIso;
}

function trimToNull(value: string | null | undefined): string | null {
  const normalized = cleanLine(value);
  return normalized || null;
}

function stripCompanySuffix(value: string): string {
  return value.replace(/\s+[•·\-–—]\s+.*$/, "").trim();
}

function stripExtractionUiSuffix(value: string): string {
  return cleanLine(value)
    .replace(EXTRACTION_UI_SUFFIX_PATTERN, "")
    .replace(EXTRACTION_UI_INLINE_NOISE_PATTERN, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s*[•·|]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimMalformedTrailingRoleRepeat(value: string): string {
  const normalized = cleanLine(value);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) {
    return normalized;
  }

  const firstToken = normalizePreferenceText(tokens[0] ?? "", "title");
  const lastToken = normalizePreferenceText(tokens.at(-1) ?? "", "title");
  if (
    !firstToken ||
    !lastToken ||
    firstToken !== lastToken ||
    !ROLE_SUFFIX_TOKENS.has(firstToken)
  ) {
    return normalized;
  }

  return cleanLine(tokens.slice(0, -1).join(" "));
}

// Placement and ranking badges a board prints beside the employer. Flattened
// into one line they read as part of the company name ("Boosted listing Toggl
// Boosted Featured Top 100 Full-Time"), so they are removed before the
// employer is shown. Shape rules only: no board is named.
// Placement badges never belong to a company name, whichever board printed
// them. Each entry is a phrase written as its whitespace-separated tokens.
const COMPANY_MARKETING_BADGE_PHRASES: readonly (readonly string[])[] = [
  ["boosted", "listing"],
  ["boosted"],
  ["featured", "listing"],
  ["featured"],
  ["promoted"],
  ["sponsored"],
  ["highlighted"],
  ["urgently", "hiring"],
  ["urgent"],
  ["hot"],
  ["new", "listing"],
  ["verified", "job"],
  ["verified", "employer"],
  ["actively", "hiring"],
  ["hiring", "now"],
];

// Employment-type badges, which a real company name can legitimately contain
// ("Contract Furniture Company", "Temporary Staffing Group"), so they are only
// removed at an edge of the line or beside another badge \u2014 never mid-name.
const COMPANY_EMPLOYMENT_BADGE_PHRASES: readonly (readonly string[])[] = [
  ["full-time"],
  ["fulltime"],
  ["full", "time"],
  ["part-time"],
  ["parttime"],
  ["part", "time"],
  ["contract"],
  ["temporary"],
  ["freelance"],
  ["internship"],
  ["intern"],
];

const COMPANY_RANKING_BADGE_LEAD_TOKENS = new Set(["top", "no.", "no", "rank"]);

type CompanyBadgeKind = "employment" | "marketing";

function normalizeBadgeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}#]+$/gu, "");
}

function matchPhrase(
  tokens: readonly string[],
  index: number,
  phrases: readonly (readonly string[])[],
): number {
  let best = 0;
  for (const phrase of phrases) {
    if (phrase.length <= best || index + phrase.length > tokens.length) {
      continue;
    }
    const matches = phrase.every(
      (word, offset) =>
        normalizeBadgeToken(tokens[index + offset] ?? "") === word,
    );
    if (matches) {
      best = phrase.length;
    }
  }
  return best;
}

/** The badge phrase starting at `index`, longest match wins, or null. */
function matchCompanyBadgeAt(
  tokens: readonly string[],
  index: number,
): { kind: CompanyBadgeKind; length: number } | null {
  const token = normalizeBadgeToken(tokens[index] ?? "");
  if (!token) {
    return null;
  }
  // "Top 100" / "#1" style ranking badges.
  if (/^#\d+$/.test(token)) {
    return { kind: "marketing", length: 1 };
  }
  if (
    COMPANY_RANKING_BADGE_LEAD_TOKENS.has(token) &&
    /^#?\d+$/.test(normalizeBadgeToken(tokens[index + 1] ?? ""))
  ) {
    return { kind: "marketing", length: 2 };
  }

  const marketing = matchPhrase(tokens, index, COMPANY_MARKETING_BADGE_PHRASES);
  if (marketing > 0) {
    return { kind: "marketing", length: marketing };
  }
  const employment = matchPhrase(
    tokens,
    index,
    COMPANY_EMPLOYMENT_BADGE_PHRASES,
  );
  return employment > 0 ? { kind: "employment", length: employment } : null;
}

/** Length in tokens of the badge run starting at `index`, and what it holds. */
function measureBadgeRun(
  tokens: readonly string[],
  index: number,
): { hasMarketing: boolean; length: number } {
  let cursor = index;
  let hasMarketing = false;
  while (cursor < tokens.length) {
    const match = matchCompanyBadgeAt(tokens, cursor);
    if (!match) {
      break;
    }
    hasMarketing ||= match.kind === "marketing";
    cursor += match.length;
  }
  return { hasMarketing, length: cursor - index };
}

/** The token index where the trailing badge run of `tokens` begins. */
function findTrailingBadgeRunStart(tokens: readonly string[]): number {
  for (let start = 0; start < tokens.length; start += 1) {
    const run = measureBadgeRun(tokens, start);
    if (run.length > 0 && start + run.length === tokens.length) {
      return start;
    }
  }
  return tokens.length;
}

/**
 * Removes badge tokens from a candidate employer line. Badges only come off at
 * an edge: a whole punctuation-delimited segment that is nothing but badges, a
 * leading run that includes a placement badge, or the trailing run. Words in
 * the middle of a name are left alone, and identical neighbouring words are
 * never collapsed ("Pizza Pizza" is a real employer). Returns the input
 * unchanged when stripping would leave nothing: an unreadable employer is
 * better than an empty one.
 */
export function stripCompanyMarketingBadges(value: string): string {
  const normalized = cleanLine(value);
  if (!normalized) {
    return normalized;
  }

  // Split only on separators a board uses between chips. A hyphen inside a
  // word belongs to the name ("Mid-Level", "Jean-Luc") and is never touched.
  const segments = normalized
    .split(/\s*[,\u2022\u00b7|]\s*|\s+[\u2013\u2014-]+\s+/u)
    .map((segment) => cleanLine(segment))
    .filter(Boolean);

  const keptSegments = segments.filter((segment) => {
    const tokens = segment.split(/\s+/).filter(Boolean);
    const run = measureBadgeRun(tokens, 0);
    return run.length !== tokens.length;
  });
  if (keptSegments.length === 0) {
    return normalized;
  }

  let tokens = keptSegments.join(" ").split(/\s+/).filter(Boolean);

  // A leading run comes off only when it carries a placement badge, so
  // "Contract Furniture Company" keeps its first word.
  const leading = measureBadgeRun(tokens, 0);
  if (leading.hasMarketing && leading.length < tokens.length) {
    tokens = tokens.slice(leading.length);
  }

  const trailingStart = findTrailingBadgeRunStart(tokens);
  if (trailingStart > 0) {
    tokens = tokens.slice(0, trailingStart);
  }

  const stripped = cleanLine(tokens.join(" "));
  return stripped || normalized;
}

/**
 * The employer label as it reaches a card: badge tokens removed first, then
 * the shared chrome/URL-derived guard applied.
 */
function sanitizeEmployerLabelWithoutBadges(
  value: string | null | undefined,
): string | null {
  const stripped = stripCompanyMarketingBadges(value ?? "");
  return stripped ? sanitizeObservedEmployerLabel(stripped) : null;
}

function normalizePotentialCompanyCandidate(value: string): string {
  const normalized = cleanLine(value);
  if (!normalized) {
    return "";
  }

  const withoutBadges = stripCompanyMarketingBadges(normalized);
  const withoutAtPrefix = cleanLine(withoutBadges.replace(/^at\s+/i, ""))
    .replace(/[\s\u2022\u00b7|\u2013\u2014-]+$/u, "")
    .trim();
  return withoutAtPrefix || normalized;
}

const SALARY_PATTERN_GLOBAL = new RegExp(SALARY_PATTERN.source, "gi");

function stripSalaryArtifacts(value: string): string {
  return cleanLine(
    value
      .replace(SALARY_PATTERN_GLOBAL, " ")
      .replace(/\/\s*(?:yr|year|month|mo|week|wk|day|hour|hr)\b/gi, " ")
      .replace(/\b(?:yr|year|month|mo|week|wk|day|hour|hr)\b/gi, " ")
      .replace(/\s*(?:-|–|to)\s*$/gi, " "),
  );
}

function splitTrailingCompanyLocation(value: string): {
  company: string | null;
  location: string | null;
} {
  const normalized = cleanLine(value);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  let bestMatch: { company: string; location: string; score: number } | null =
    null;

  for (let width = 1; width <= Math.min(4, tokens.length - 1); width += 1) {
    const locationCandidate = cleanLine(tokens.slice(-width).join(" "));
    if (
      !locationCandidate ||
      !isLocationLike(locationCandidate, { allowSingleTokenGeneric: false })
    ) {
      continue;
    }

    const companyCandidate = normalizePotentialCompanyCandidate(
      cleanLine(tokens.slice(0, Math.max(0, tokens.length - width)).join(" ")),
    );
    if (
      !companyCandidate ||
      COMPANY_NOISE_PATTERN.test(companyCandidate) ||
      SALARY_PATTERN.test(companyCandidate) ||
      POSTED_PATTERN.test(companyCandidate) ||
      isRoleLikePhrase(companyCandidate) ||
      // "12d" beside a card is how long ago it was posted, not who posted it.
      isAgeTokenMisreadAsCompany(companyCandidate)
    ) {
      continue;
    }

    const companyWordCount = companyCandidate
      .split(/\s+/)
      .filter(Boolean).length;
    let score = scoreLocationCandidate(locationCandidate, {
      allowSingleTokenGeneric: false,
    });
    if (isLikelyCompanyName(companyCandidate)) {
      score += 40;
    }
    if (companyWordCount >= 2 && companyWordCount <= 4) {
      score += 10;
    } else if (
      companyWordCount === 1 &&
      !/^[A-Z]{2,6}$/u.test(companyCandidate)
    ) {
      score -= 8;
    }
    if (/[()]/.test(locationCandidate)) {
      score += 4;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        company: companyCandidate,
        location: locationCandidate,
        score,
      };
    }
  }

  return bestMatch
    ? { company: bestMatch.company, location: bestMatch.location }
    : { company: null, location: null };
}

function isLikelyCompanyName(value: string): boolean {
  const normalized = normalizePotentialCompanyCandidate(value);
  if (!normalized || normalized.length > 80) {
    return false;
  }

  if (
    COMPANY_NOISE_PATTERN.test(normalized) ||
    POSTED_PATTERN.test(normalized) ||
    SALARY_PATTERN.test(normalized) ||
    APPLY_PATTERN.test(normalized) ||
    EXTRACTION_UI_NOISE_PATTERN.test(normalized)
  ) {
    return false;
  }

  if (/\bconfidential(?:\s+careers)?\b/i.test(normalized)) {
    return true;
  }

  if (
    COMPANY_LEGAL_SUFFIX_PATTERN.test(normalized) ||
    looksLikeCompanyTrailingSegment(normalized)
  ) {
    return true;
  }

  if (isLocationLike(normalized) || isRoleLikePhrase(normalized)) {
    return false;
  }

  const tokens = normalized.match(/[\p{L}\p{N}.+#&'’-]+/gu) ?? [];
  if (tokens.length === 0 || tokens.length > 6) {
    return false;
  }

  return tokens.some((token) => /^[A-Z\p{L}\p{N}]/u.test(token));
}

function splitContaminatedTitleCompanySuffix(value: string): {
  title: string;
  company: string | null;
} {
  const normalized = cleanLine(stripExtractionUiSuffix(value));
  if (!normalized) {
    return { title: "", company: null };
  }

  const match = normalized.match(
    /^(?<title>.+?)(?:\s*[|•·-]\s*|\s+)at\s+(?<company>.+)$/i,
  );
  const rawTitle = cleanLine(match?.groups?.title).replace(/[\s|•·-]+$/, "");
  const rawCompany = normalizePotentialCompanyCandidate(
    match?.groups?.company ?? "",
  );
  const cleanedRawTitle = stripSalaryArtifacts(rawTitle);
  const trailingRawTitleMetadata =
    splitTrailingCompanyLocation(cleanedRawTitle);
  const inferredRawTitleLocation = inferLocation(
    [cleanedRawTitle],
    normalizeWorkModes([], cleanedRawTitle),
    { allowSingleTokenGeneric: false },
  );
  const reversedTitle = rawCompany;
  const reversedTitleLooksLikeRole = scoreCardTitleCandidate(reversedTitle) > 0;
  const rawTitleLooksLikeRole = scoreCardTitleCandidate(rawTitle) > 0;
  const rawTitleLooksLikeLocationOrMetadata =
    isLocationLike(rawTitle) ||
    isLocationLike(cleanedRawTitle) ||
    SALARY_PATTERN.test(rawTitle) ||
    trailingRawTitleMetadata.location !== null ||
    inferredRawTitleLocation !== null ||
    !rawTitleLooksLikeRole;
  const reversedCompanyFromRawTitle = normalizePotentialCompanyCandidate(
    trailingRawTitleMetadata.company
      ? trailingRawTitleMetadata.company
      : cleanLine(
          inferredRawTitleLocation
            ? cleanedRawTitle
                .slice(
                  0,
                  Math.max(
                    0,
                    cleanedRawTitle.length - inferredRawTitleLocation.length,
                  ),
                )
                .replace(/[\s|•·–—-]+$/, "")
            : cleanedRawTitle,
        ),
  );
  const reversedCompanyLooksPlausible =
    Boolean(reversedCompanyFromRawTitle) &&
    (isLikelyCompanyName(reversedCompanyFromRawTitle) ||
      (trailingRawTitleMetadata.location !== null &&
        !COMPANY_NOISE_PATTERN.test(reversedCompanyFromRawTitle) &&
        !SALARY_PATTERN.test(reversedCompanyFromRawTitle) &&
        !POSTED_PATTERN.test(reversedCompanyFromRawTitle) &&
        !isRoleLikePhrase(reversedCompanyFromRawTitle)) ||
      (!isLocationLike(reversedCompanyFromRawTitle) &&
        !isRoleLikePhrase(reversedCompanyFromRawTitle)));

  if (
    reversedTitleLooksLikeRole &&
    reversedCompanyLooksPlausible &&
    rawTitleLooksLikeLocationOrMetadata
  ) {
    return {
      title: reversedTitle,
      company: stripCompanySuffix(reversedCompanyFromRawTitle),
    };
  }

  if (!rawTitle || !rawCompany) {
    return { title: normalized, company: null };
  }

  if (
    scoreCardTitleCandidate(rawTitle) <= 0 ||
    !isLikelyCompanyName(rawCompany)
  ) {
    if (
      reversedTitle &&
      reversedTitleLooksLikeRole &&
      reversedCompanyLooksPlausible
    ) {
      return {
        title: reversedTitle,
        company: stripCompanySuffix(reversedCompanyFromRawTitle),
      };
    }

    return { title: normalized, company: null };
  }

  return {
    title: rawTitle,
    company: stripCompanySuffix(rawCompany),
  };
}

function recoverBetterCardTitleFromLines(input: {
  lines: readonly string[];
  fallbackTitle: string;
}): string | null {
  const fallbackScore = scoreCardTitleCandidate(input.fallbackTitle);
  const bestCandidate =
    uniqueStrings(input.lines)
      .flatMap((line) => {
        const candidates: string[] = [];
        const recoveredMetadataTitle = recoverTitleFromMetadataLine(
          line,
          input.fallbackTitle,
        );
        if (recoveredMetadataTitle) {
          candidates.push(recoveredMetadataTitle);
        }

        const splitTitleCompany = splitContaminatedTitleCompanySuffix(line);
        if (splitTitleCompany.company) {
          candidates.push(splitTitleCompany.title);
        }

        return uniqueStrings(
          candidates.map((candidateTitle) =>
            sanitizeCardTitle(
              normalizeCompositeCardTitle(
                stripExtractionUiSuffix(candidateTitle),
              ).title,
            ),
          ),
        );
      })
      .filter((candidateTitle) => {
        if (!candidateTitle) {
          return false;
        }

        if (
          cleanLine(candidateTitle).toLowerCase() ===
          cleanLine(input.fallbackTitle).toLowerCase()
        ) {
          return false;
        }

        if (
          /\sat\s+/i.test(candidateTitle) ||
          SALARY_PATTERN.test(candidateTitle)
        ) {
          return false;
        }

        if (
          isLocationLike(candidateTitle) ||
          isLikelyCompanyName(candidateTitle)
        ) {
          return false;
        }

        return scoreCardTitleCandidate(candidateTitle) > 0;
      })
      .sort(
        (left, right) =>
          scoreCardTitleCandidate(right) - scoreCardTitleCandidate(left),
      )[0] ?? null;

  if (!bestCandidate) {
    return null;
  }

  return scoreCardTitleCandidate(bestCandidate) > fallbackScore
    ? bestCandidate
    : null;
}

function cardShowsRecoverableUiNoise(
  candidate: SearchResultCardCandidate,
): boolean {
  const textLines = uniqueStrings([
    candidate.anchorText,
    candidate.headingText ?? "",
    ...candidate.lines,
  ]);
  const joinedLines = textLines.join(" ");
  return (
    EXTRACTION_UI_NOISE_PATTERN.test(joinedLines) ||
    /\bdismiss\b[\s\S]*\bjob\b/i.test(joinedLines) ||
    SALARY_PATTERN.test(cleanLine(candidate.headingText)) ||
    SALARY_PATTERN.test(cleanLine(candidate.anchorText)) ||
    textLines.some((line) => findRepeatedLeadingPhrase(line) !== null)
  );
}

function removeLeadingTitleEcho(value: string, title: string): string {
  const normalizedValue = cleanLine(value);
  const normalizedTitle = cleanLine(title);
  if (
    !normalizedValue ||
    !normalizedTitle ||
    normalizedTitle.split(/\s+/).length < 2
  ) {
    return normalizedValue;
  }

  const escapedTitle = normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanLine(
    normalizedValue.replace(
      new RegExp(`^(?:${escapedTitle})(?:\\s*${escapedTitle})*\\s*`, "i"),
      "",
    ),
  );
}

function removeLeadingTitleSuffixOverlap(value: string, title: string): string {
  const normalizedValue = cleanLine(value);
  const valueTokens = normalizedValue.match(/[\p{L}\p{N}.+#-]+/gu) ?? [];
  const titleTokens = cleanLine(title).match(/[\p{L}\p{N}.+#-]+/gu) ?? [];
  if (valueTokens.length < 3 || titleTokens.length < 3) {
    return normalizedValue;
  }

  for (
    let width = Math.min(3, titleTokens.length - 1, valueTokens.length - 1);
    width >= 2;
    width -= 1
  ) {
    const titleSuffix = titleTokens
      .slice(-width)
      .map((token) => token.toLowerCase());
    const valuePrefix = valueTokens
      .slice(0, width)
      .map((token) => token.toLowerCase());
    if (titleSuffix.join(" ") !== valuePrefix.join(" ")) {
      continue;
    }

    const remaining = cleanLine(valueTokens.slice(width).join(" "));
    if (remaining) {
      return remaining;
    }
  }

  return normalizedValue;
}

function expandCompositeMetadataLine(value: string): string[] {
  const cleaned = stripExtractionUiSuffix(value);
  if (!cleaned) {
    return [];
  }

  const withoutTrailingCount =
    cleaned.replace(/\s+\d+\s*$/, "").trim() || cleaned;

  if (
    !/[•·|]/.test(withoutTrailingCount) &&
    isLocationLike(withoutTrailingCount) &&
    countMeaningfulLocationTokens(withoutTrailingCount) > 0
  ) {
    return [withoutTrailingCount];
  }

  const segments = withoutTrailingCount
    .split(/\s*[•·|]\s*/)
    .map((segment) => cleanLine(segment))
    .filter(Boolean);

  if (segments.length > 1) {
    return uniqueStrings([...segments, withoutTrailingCount]);
  }

  const inferredTrailingLocation =
    inferTrailingCompositeLocation(withoutTrailingCount);
  if (inferredTrailingLocation) {
    const prefix = withoutTrailingCount
      .slice(
        0,
        Math.max(
          0,
          withoutTrailingCount.length - inferredTrailingLocation.length,
        ),
      )
      .replace(/[\s•·|–—-]+$/, "")
      .trim();
    if (prefix) {
      return uniqueStrings([
        prefix,
        inferredTrailingLocation,
        withoutTrailingCount,
        cleaned,
      ]);
    }
  }

  return [withoutTrailingCount];
}

function sanitizeCardTitle(value: string): string {
  const cleaned = stripExtractionUiSuffix(value).replace(
    /\(verified job\)/gi,
    " ",
  );
  const leadingSegment = cleaned.split(/\s*[•·|]\s*/)[0] ?? cleaned;
  return trimMalformedTrailingRoleRepeat(cleanLine(leadingSegment));
}

function findRepeatedLeadingPhrase(value: string): string | null {
  const words = cleanLine(value).split(/\s+/).filter(Boolean);
  for (let width = Math.floor(words.length / 2); width >= 2; width -= 1) {
    const left = words.slice(0, width).join(" ");
    const right = words.slice(width, width * 2).join(" ");
    if (left && left.toLowerCase() === right.toLowerCase()) {
      return left;
    }
  }

  return null;
}

function normalizeExtractedJobTitle(input: {
  value: string | null | undefined;
  company?: string | null | undefined;
  location?: string | null | undefined;
}): string {
  const normalized = cleanLine(input.value);
  const workModeQualifiedRepeat = normalized.match(
    /^(?<title>.+?)\s+(?:\((?:remote|hybrid|on[- ]?site|onsite)\)|[-–—|•·]\s*(?:remote|hybrid|on[- ]?site|onsite))\s+\k<title>$/iu,
  );
  const workModeQualifiedTitle = cleanLine(
    workModeQualifiedRepeat?.groups?.title,
  );
  if (
    workModeQualifiedTitle &&
    scoreCardTitleCandidate(workModeQualifiedTitle) > 0
  ) {
    return workModeQualifiedTitle;
  }

  const repeatedTitle = findRepeatedLeadingPhrase(normalized);
  if (!repeatedTitle || scoreCardTitleCandidate(repeatedTitle) <= 0) {
    return normalized;
  }

  const escapedTitle = repeatedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = cleanLine(
    normalized
      .replace(
        new RegExp(`^(?:${escapedTitle})(?:\\s+${escapedTitle})+\\s*`, "iu"),
        "",
      )
      .replace(/^[\s|•·–—-]+/u, ""),
  );

  if (!suffix) {
    return repeatedTitle;
  }

  const normalizedSuffix = suffix.toLocaleLowerCase();
  const beginsWithKnownMetadata = [input.company, input.location]
    .map((value) => cleanLine(value).replace(/^[\s|•·–—-]+/u, ""))
    .filter(Boolean)
    .some((value) => {
      const normalizedValue = value.toLocaleLowerCase();
      return (
        normalizedSuffix === normalizedValue ||
        normalizedSuffix.startsWith(`${normalizedValue} `) ||
        normalizedSuffix.startsWith(`${normalizedValue} •`) ||
        normalizedSuffix.startsWith(`${normalizedValue} ·`) ||
        normalizedSuffix.startsWith(`${normalizedValue} |`)
      );
    });

  return beginsWithKnownMetadata ? repeatedTitle : normalized;
}

function recoverTitleFromMetadataLine(
  line: string,
  fallbackTitle: string,
): string | null {
  const normalized = cleanLine(line);
  if (!normalized) {
    return null;
  }

  const repeatedTitlePrefix = findRepeatedLeadingPhrase(
    cleanLine(
      normalized.split(
        /\b(?:with verification|verified job|recommended|promoted|viewed|works here|school alumni|connection(?:s)?|actively reviewing applicants|be an early applicant)\b/i,
      )[0],
    ),
  );

  if (repeatedTitlePrefix) {
    const recoveredRepeatedTitle = sanitizeCardTitle(repeatedTitlePrefix);
    const escapedRepeatedTitle = recoveredRepeatedTitle.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const repeatsAtStart =
      Boolean(recoveredRepeatedTitle) &&
      new RegExp(
        `^(?:${escapedRepeatedTitle})(?:\\s+${escapedRepeatedTitle})+\\b`,
        "i",
      ).test(normalized);
    if (
      recoveredRepeatedTitle &&
      (scoreCardTitleCandidate(recoveredRepeatedTitle) >
        scoreCardTitleCandidate(fallbackTitle) ||
        repeatsAtStart)
    ) {
      return recoveredRepeatedTitle;
    }
  }

  const cleaned = stripExtractionUiSuffix(line);
  if (!cleaned) {
    return null;
  }

  const withoutEcho = removeLeadingTitleEcho(cleaned, fallbackTitle);
  const leadingSegment = cleanLine(
    withoutEcho.split(/\s*[•·|]\s*/)[0] ?? withoutEcho,
  );
  if (!leadingSegment) {
    return null;
  }

  const compositeTitle = normalizeCompositeCardTitle(leadingSegment).title;
  const recovered = sanitizeCardTitle(compositeTitle || leadingSegment);
  if (!recovered) {
    return null;
  }

  return scoreCardTitleCandidate(recovered) >
    scoreCardTitleCandidate(fallbackTitle)
    ? recovered
    : null;
}

function looksLikeRecoveredTitleSource(
  line: string,
  fallbackTitle: string,
): boolean {
  const normalized = cleanLine(line);
  if (!normalized) {
    return false;
  }

  if (/\bdismiss\b.*\bjob\b/i.test(normalized)) {
    return true;
  }

  if (
    /\b(?:with verification|verified job|recommended|promoted|viewed|works here|school alumni|connection(?:s)?|actively reviewing applicants|be an early applicant)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  const repeatedPhrase = findRepeatedLeadingPhrase(
    stripExtractionUiSuffix(normalized),
  );
  if (repeatedPhrase) {
    const recoveredRepeatedTitle = sanitizeCardTitle(repeatedPhrase);
    if (scoreCardTitleCandidate(recoveredRepeatedTitle) > 0) {
      return true;
    }
  }

  const repeatedTitle = cleanLine(fallbackTitle);
  if (repeatedTitle && repeatedTitle.split(/\s+/).length >= 2) {
    const escapedTitle = repeatedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^(?:${escapedTitle})(?:\\s+${escapedTitle})+`, "i").test(
      normalized,
    );
  }

  return false;
}

function isRoleLikePhrase(value: string): boolean {
  const tokens =
    cleanLine(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}.+#-]+/gu) ?? [];

  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => ROLE_SUFFIX_TOKENS.has(token));
}

function extractDismissTitle(value: string): string | null {
  const match = value.match(/\bdismiss\s+(.+?)\s+job\b/i);
  if (!match?.[1]) {
    return null;
  }

  return (
    cleanLine(match[1])
      .replace(/\(verified job\)/gi, " ")
      .replace(/\brecommended$/i, "")
      .trim() || null
  );
}

function collectDismissTitles(candidate: SearchResultCardCandidate): string[] {
  return uniqueStrings(
    [candidate.anchorText, ...candidate.lines]
      .map((value) => extractDismissTitle(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function scoreCardTitleCandidate(value: string): number {
  const normalized = cleanLine(value);
  if (!normalized) {
    return 0;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasRoleHint =
    /\b(engineer|developer|manager|designer|analyst|architect|specialist|consultant|lead|qa|software|frontend|backend|full stack|react|node|typescript|\.net)\b/i.test(
      normalized,
    );
  const looksTruncated =
    /^(?:senior|mid|junior|staff|lead|principal|frontend|backend|full stack|software|developer|engineer|\.net)$/i.test(
      normalized,
    );

  return wordCount * 10 + (hasRoleHint ? 8 : 0) - (looksTruncated ? 12 : 0);
}

function looksLikeContaminatedTitleCandidate(
  candidateTitle: string,
  recoveredDismissTitle: string,
): boolean {
  const normalizedCandidate = cleanLine(candidateTitle);
  const normalizedRecovered = cleanLine(recoveredDismissTitle);
  if (!normalizedCandidate || !normalizedRecovered) {
    return false;
  }

  const normalizedCandidateLower = normalizedCandidate.toLowerCase();
  const normalizedRecoveredLower = normalizedRecovered.toLowerCase();
  if (
    !normalizedCandidateLower.startsWith(normalizedRecoveredLower) ||
    normalizedCandidateLower === normalizedRecoveredLower
  ) {
    return false;
  }

  const escapedRecoveredTitle = normalizedRecovered.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const withoutRepeatedRecoveredTitle = cleanLine(
    normalizedCandidate.replace(
      new RegExp(
        `^(?:${escapedRecoveredTitle})(?:\\s+${escapedRecoveredTitle})+\\s*`,
        "i",
      ),
      "",
    ),
  );
  const trailingSegment = cleanLine(
    withoutRepeatedRecoveredTitle ||
      normalizedCandidate.slice(normalizedRecovered.length),
  );
  if (!trailingSegment) {
    return false;
  }

  if (
    looksLikeCompanyTrailingSegment(trailingSegment) ||
    COMPANY_LEGAL_SUFFIX_PATTERN.test(trailingSegment)
  ) {
    return true;
  }

  const trailingTokens = trailingSegment.match(/[\p{L}\p{N}.+#-]+/gu) ?? [];
  return (
    trailingTokens.length > 0 &&
    trailingTokens.length <= 4 &&
    !isRoleLikePhrase(trailingSegment) &&
    !isLocationLike(trailingSegment) &&
    !POSTED_PATTERN.test(trailingSegment) &&
    !SALARY_PATTERN.test(trailingSegment)
  );
}

function selectBestRawCardTitle(candidate: SearchResultCardCandidate): string {
  const headingTitle = sanitizeCardTitle(cleanLine(candidate.headingText));
  const anchorTitle = sanitizeCardTitle(cleanLine(candidate.anchorText));
  const dismissTitle =
    collectDismissTitles(candidate).sort(
      (left, right) =>
        scoreCardTitleCandidate(right) - scoreCardTitleCandidate(left),
    )[0] ?? null;
  const metadataRecoveredTitle = cardShowsRecoverableUiNoise(candidate)
    ? (uniqueStrings(candidate.lines)
        .filter((line) =>
          looksLikeRecoveredTitleSource(
            line,
            headingTitle || cleanLine(candidate.anchorText),
          ),
        )
        .map((line) =>
          recoverTitleFromMetadataLine(
            line,
            headingTitle || cleanLine(candidate.anchorText),
          ),
        )
        .filter((value): value is string => Boolean(value))
        .sort(
          (left, right) =>
            scoreCardTitleCandidate(right) - scoreCardTitleCandidate(left),
        )[0] ?? null)
    : null;

  // Search-result dismiss controls carry the clean visible job title even when
  // the surrounding card's accessibility text repeats the title and appends
  // verification/company/location metadata. Prefer that explicit label over
  // all composite text heuristics.
  if (dismissTitle && scoreCardTitleCandidate(dismissTitle) > 0) {
    return dismissTitle;
  }

  if (metadataRecoveredTitle) {
    const escapedRecoveredTitle = metadataRecoveredTitle.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const repeatedRecoveredTitlePattern = new RegExp(
      `^(?:${escapedRecoveredTitle})(?:\\s+${escapedRecoveredTitle})+\\b`,
      "i",
    );

    if (
      repeatedRecoveredTitlePattern.test(headingTitle) ||
      repeatedRecoveredTitlePattern.test(anchorTitle)
    ) {
      return metadataRecoveredTitle;
    }
  }

  if (
    metadataRecoveredTitle &&
    scoreCardTitleCandidate(metadataRecoveredTitle) >
      Math.max(
        scoreCardTitleCandidate(dismissTitle ?? ""),
        scoreCardTitleCandidate(headingTitle),
      )
  ) {
    return metadataRecoveredTitle;
  }

  if (
    dismissTitle &&
    (looksLikeContaminatedTitleCandidate(headingTitle, dismissTitle) ||
      looksLikeContaminatedTitleCandidate(anchorTitle, dismissTitle))
  ) {
    return dismissTitle;
  }

  if (
    dismissTitle &&
    scoreCardTitleCandidate(dismissTitle) >
      scoreCardTitleCandidate(headingTitle)
  ) {
    return dismissTitle;
  }

  return headingTitle || cleanLine(candidate.anchorText);
}

function recoverSearchSurfaceCompositeMetadata(
  lines: readonly string[],
  title: string,
): { company: string; location: string } | null {
  const knownRemoteRegionPattern =
    /\b(?:United States|United Kingdom|European Union|North America|Latin America|South America|Middle East|Asia Pacific|EMEA|APAC|Europe|Worldwide|Global|Anywhere|Remote)\s*\((?:Remote|Hybrid|On[- ]?site)\)/i;
  const isPlausibleCompositeCompany = (value: string) =>
    Boolean(value) &&
    value.length <= 80 &&
    !COMPANY_NOISE_PATTERN.test(value) &&
    !POSTED_PATTERN.test(value) &&
    !SALARY_PATTERN.test(value) &&
    !isRoleLikePhrase(value);

  for (const line of uniqueStrings(lines)) {
    const cleaned = stripExtractionUiSuffix(line);
    const withoutTitle = removeLeadingTitleEcho(cleaned, title)
      .replace(
        /^(?:with verification|verified job|recommended|promoted|viewed)\b\s*/i,
        "",
      )
      .trim();
    if (!withoutTitle || withoutTitle === cleaned) {
      continue;
    }

    const workModeMatch = withoutTitle.match(
      /\((?:Remote|Hybrid|On[- ]?site)\)/i,
    );
    if (!workModeMatch || workModeMatch.index === undefined) {
      continue;
    }

    const throughWorkMode = cleanLine(
      withoutTitle.slice(0, workModeMatch.index + workModeMatch[0].length),
    );
    const knownLocationMatch = knownRemoteRegionPattern.exec(throughWorkMode);
    if (knownLocationMatch?.index !== undefined) {
      const company = normalizePotentialCompanyCandidate(
        throughWorkMode.slice(0, knownLocationMatch.index),
      );
      const location = cleanLine(knownLocationMatch[0]);
      if (isPlausibleCompositeCompany(company)) {
        return { company: stripCompanySuffix(company), location };
      }
    }

    if (throughWorkMode.includes(",")) {
      const tokens = throughWorkMode.split(/\s+/).filter(Boolean);
      for (let splitIndex = 1; splitIndex < tokens.length; splitIndex += 1) {
        const company = normalizePotentialCompanyCandidate(
          tokens.slice(0, splitIndex).join(" "),
        );
        const location = cleanLine(tokens.slice(splitIndex).join(" "));
        if (isPlausibleCompositeCompany(company) && location.includes(",")) {
          return { company: stripCompanySuffix(company), location };
        }
      }
      continue;
    }

    const singleTokenLocationMatch =
      /\s(?<location>[A-Z][\p{L}.'’-]+\s*\((?:Remote|Hybrid|On[- ]?site)\))$/u.exec(
        throughWorkMode,
      );
    if (
      singleTokenLocationMatch?.index !== undefined &&
      singleTokenLocationMatch.groups?.location
    ) {
      const company = normalizePotentialCompanyCandidate(
        throughWorkMode.slice(0, singleTokenLocationMatch.index),
      );
      const location = cleanLine(singleTokenLocationMatch.groups.location);
      if (isPlausibleCompositeCompany(company)) {
        return { company: stripCompanySuffix(company), location };
      }
    }
  }

  return null;
}

function isLocationLike(
  value: string,
  options?: { allowSingleTokenGeneric?: boolean },
): boolean {
  const normalized = cleanLine(value);
  if (!normalized || normalized.length > 80) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;

  if (COMPANY_LEGAL_SUFFIX_PATTERN.test(normalized)) {
    return false;
  }

  if (LOCATION_HINT_PATTERN.test(normalized)) {
    if (
      wordCount <= 4 &&
      !EXTRACTION_UI_NOISE_PATTERN.test(normalized) &&
      !/\bjob\b/i.test(normalized) &&
      !isRoleLikePhrase(normalized)
    ) {
      return true;
    }
  }

  if (SALARY_PATTERN.test(normalized) || POSTED_PATTERN.test(normalized)) {
    return false;
  }

  const allowSingleTokenGeneric = options?.allowSingleTokenGeneric ?? true;
  if (normalized.includes(",") && wordCount <= 8) {
    return true;
  }

  if (wordCount <= 3) {
    if (!allowSingleTokenGeneric && wordCount === 1) {
      return false;
    }

    return (
      tokens.every((token) => /^[A-Z][\p{L}\p{N}.'’-]*$/u.test(token)) &&
      !COMPANY_NOISE_PATTERN.test(normalized)
    );
  }

  return (
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/.test(normalized) &&
    wordCount <= 6 &&
    !COMPANY_NOISE_PATTERN.test(normalized)
  );
}

function scoreLocationCandidate(
  value: string,
  options?: { allowSingleTokenGeneric?: boolean },
): number {
  const normalized = cleanLine(value);
  if (!isLocationLike(normalized, options)) {
    return 0;
  }

  let score = 1;

  if (LOCATION_HINT_PATTERN.test(normalized)) {
    score += 20;
  }

  if (normalized.includes(",")) {
    score += 10;
  }

  if (/[()]/.test(normalized)) {
    score += 5;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1) {
    score += 2;
  } else if (wordCount <= 3) {
    score += 1;
  }

  return score;
}

function findSalaryText(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = cleanLine(line).match(SALARY_PATTERN);
    if (match?.[0]) {
      return cleanLine(match[0]);
    }
  }

  return null;
}

/** Keeps only posted text that reads as a date. See the pattern's note. */
function keepPostedAtDateText(value: string | null): string | null {
  return value && POSTED_AT_DATE_TEXT_PATTERN.test(value) ? value : null;
}

function findPostedAtText(lines: readonly string[]): string | null {
  for (const line of lines) {
    const normalized = cleanLine(line);
    if (
      !POSTED_PATTERN.test(normalized) ||
      normalized.length > 80 ||
      POSTED_CALL_TO_ACTION_LINE_PATTERN.test(normalized)
    ) {
      continue;
    }

    const compositePostedAtText =
      stripTrailingPostedAtText(normalized).postedAtText;
    const postedAtText = compositePostedAtText ?? normalized;
    const datedPostedAtText = keepPostedAtDateText(postedAtText);
    if (datedPostedAtText) {
      return datedPostedAtText;
    }
  }

  return null;
}

function findEmploymentType(lines: readonly string[]): string | null {
  const match = lines.find((line) => EMPLOYMENT_TYPE_PATTERN.test(line));
  return trimToNull(match);
}

function stripTrailingPostedAtText(value: string): {
  content: string;
  postedAtText: string | null;
} {
  const normalized = cleanLine(value);
  const match = normalized.match(COMPOSITE_POSTED_SUFFIX_PATTERN);

  if (!match || typeof match.index !== "number") {
    return { content: normalized, postedAtText: null };
  }

  // "Apply today", "Start today", "Join us today" are calls to action, not
  // posting dates. Keep them in the content and report no posted text.
  if (
    POSTED_SUFFIX_CALL_TO_ACTION_PREFIX_PATTERN.test(
      normalized.slice(0, match.index),
    )
  ) {
    return { content: normalized, postedAtText: null };
  }

  return {
    content: normalized.slice(0, match.index).trim(),
    postedAtText: cleanLine(match[0]),
  };
}

function isPureWorkModeLocationLabel(value: string): boolean {
  const normalized = cleanLine(value)
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    normalized === "remote" ||
    normalized === "hybrid" ||
    normalized === "on-site" ||
    normalized === "onsite" ||
    normalized === "on site" ||
    normalized === "work from home" ||
    normalized === "home office" ||
    normalized === "anywhere" ||
    normalized === "worldwide" ||
    normalized === "global"
  );
}

function countMeaningfulLocationTokens(value: string): number {
  return tokenizePreferenceValue(value, "location").length;
}

function looksLikeCompanyTrailingSegment(value: string): boolean {
  const normalized = cleanLine(value);
  if (!normalized) {
    return false;
  }

  if (COMPANY_LEGAL_SUFFIX_PATTERN.test(normalized)) {
    return true;
  }

  const tokens = normalized.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const lastToken = tokens.at(-1);
  return Boolean(lastToken && COMPANY_STYLE_SUFFIX_TOKENS.has(lastToken));
}

function hasRicherMeaningfulLocationSuffix(
  tokens: readonly string[],
  width: number,
): boolean {
  const maxExtraWidth = Math.min(2, tokens.length - width - 1);
  for (let extraWidth = 1; extraWidth <= maxExtraWidth; extraWidth += 1) {
    const candidate = tokens.slice(-(width + extraWidth)).join(" ");
    if (
      !candidate ||
      /[•·|]/.test(candidate) ||
      !isLocationLike(candidate) ||
      looksLikeCompanyTrailingSegment(candidate) ||
      countMeaningfulLocationTokens(candidate) === 0
    ) {
      continue;
    }

    return true;
  }

  return false;
}

function narrowVerificationNoiseLocationCandidate(
  value: string,
  candidate: string,
): string {
  if (
    !/\b(?:with verification|verified job|works here|school alumni|connection(?:s)?|promoted|viewed)\b/i.test(
      value,
    )
  ) {
    return candidate;
  }

  const tokens = cleanLine(candidate).split(/\s+/).filter(Boolean);
  for (let startIndex = 1; startIndex < tokens.length - 1; startIndex += 1) {
    const narrowedCandidate = tokens.slice(startIndex).join(" ");
    if (
      !narrowedCandidate ||
      /[•·|]/.test(narrowedCandidate) ||
      !isLocationLike(narrowedCandidate) ||
      looksLikeCompanyTrailingSegment(narrowedCandidate) ||
      countMeaningfulLocationTokens(narrowedCandidate) === 0
    ) {
      continue;
    }

    return narrowedCandidate;
  }

  return candidate;
}

function inferTrailingCompositeLocation(value: string): string | null {
  const tokens = cleanLine(value).split(/\s+/).filter(Boolean);
  const tailToken =
    cleanLine(tokens.at(-1) ?? "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.at(-1) ?? "";

  if (!tailToken || ROLE_TOKEN_PATTERN.test(tailToken)) {
    return null;
  }

  let bestCandidate: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let width = 1; width <= Math.min(3, tokens.length - 1); width += 1) {
    const candidate = tokens.slice(-width).join(" ");
    if (
      width === 1 &&
      !LOCATION_HINT_PATTERN.test(candidate) &&
      (tokens.length < 3 || ROLE_TOKEN_PATTERN.test(candidate))
    ) {
      continue;
    }

    if (isRoleLikePhrase(candidate)) {
      continue;
    }

    if (/[•·|]/.test(candidate) || looksLikeCompanyTrailingSegment(candidate)) {
      continue;
    }

    if (isLocationLike(candidate)) {
      if (
        isPureWorkModeLocationLabel(candidate) &&
        hasRicherMeaningfulLocationSuffix(tokens, width)
      ) {
        continue;
      }

      const score =
        scoreLocationCandidate(candidate) +
        countMeaningfulLocationTokens(candidate) * 5 -
        (isPureWorkModeLocationLabel(candidate) ? 15 : 0);

      if (score > bestScore) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }
  }

  return bestCandidate
    ? narrowVerificationNoiseLocationCandidate(value, bestCandidate)
    : null;
}

function normalizeCompositeCardTitle(value: string): {
  title: string;
  location: string | null;
  postedAtText: string | null;
} {
  const { content, postedAtText } = stripTrailingPostedAtText(value);
  const location = inferTrailingCompositeLocation(content);
  const title = location
    ? content
        .slice(0, Math.max(0, content.length - location.length))
        .replace(/[\s•·|–—-]+$/, "")
        .trim()
    : content;

  return {
    title: title || content,
    location,
    postedAtText,
  };
}

function inferCompany(
  lines: readonly string[],
  title: string,
  location: string | null,
): string | null {
  const normalizedTitle = title.toLowerCase();
  const normalizedLocation = location?.toLowerCase() ?? null;
  const titleTokens = new Set(
    title.toLowerCase().match(/[\p{L}\p{N}.+#-]+/gu) ?? [],
  );

  for (const line of lines) {
    const normalized = normalizePotentialCompanyCandidate(
      removeLeadingTitleSuffixOverlap(
        removeLeadingTitleEcho(stripExtractionUiSuffix(line), title),
        title,
      ),
    );
    const splitTitleCompany = splitContaminatedTitleCompanySuffix(normalized);
    const lowered = normalized.toLowerCase();
    const candidateTokens =
      normalized.toLowerCase().match(/[\p{L}\p{N}.+#-]+/gu) ?? [];
    const sharesOnlyTitleTokens =
      candidateTokens.length > 0 &&
      candidateTokens.every((token) => titleTokens.has(token));
    const matchedTitleTokenCount = countMatchedPreferenceTokens(
      [...titleTokens],
      candidateTokens,
    );
    const titleEchoRatio =
      titleTokens.size > 0 ? matchedTitleTokenCount / titleTokens.size : 0;

    if (
      !normalized ||
      lowered === normalizedTitle ||
      lowered === normalizedLocation ||
      normalized.length > 80 ||
      normalized.split(/\s+/).length > 8 ||
      sharesOnlyTitleTokens ||
      titleEchoRatio >= 0.7 ||
      COMPANY_NOISE_PATTERN.test(normalized) ||
      SALARY_PATTERN.test(normalized) ||
      POSTED_PATTERN.test(normalized) ||
      (normalizedLocation === null && isLocationLike(normalized))
    ) {
      continue;
    }

    if (splitTitleCompany.company) {
      const splitTitleTokens =
        splitTitleCompany.title.toLowerCase().match(/[\p{L}\p{N}.+#-]+/gu) ??
        [];
      const splitTitleOverlapCount = countMatchedPreferenceTokens(
        [...titleTokens],
        splitTitleTokens,
      );
      if (splitTitleOverlapCount > 0) {
        return stripCompanySuffix(splitTitleCompany.company);
      }
    }

    return stripCompanySuffix(normalized);
  }

  return null;
}

/**
 * Employer name from an explicit employer profile or employer-job href.
 * Accepts hubs (`/company/{slug}`, `/employer/{slug}`, …) because those
 * links name the employer on job cards — unlike treating a hub page itself
 * as a job listing.
 */
export function inferEmployerFromCompanyProfileHref(
  url: string | null | undefined,
): string | null {
  const canonicalUrl = cleanLine(url ?? "");
  if (!canonicalUrl) {
    return null;
  }

  const employerProfilePathMarkers = new Set(["company", "employer"]);

  try {
    const parsed = new URL(canonicalUrl);
    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)))
      .filter(Boolean);
    const profileIndex = pathSegments.findIndex((segment) =>
      employerProfilePathMarkers.has(segment.toLowerCase()),
    );
    if (profileIndex < 0) {
      return null;
    }

    const slug = pathSegments[profileIndex + 1];
    if (
      !slug ||
      GENERIC_JOB_PATH_SEGMENTS.has(slug.toLowerCase()) ||
      SITE_UTILITY_PATH_SEGMENTS.has(slug.toLowerCase()) ||
      !/[a-z\p{L}]/iu.test(slug)
    ) {
      return null;
    }

    // Some boards append numeric disambiguators to profile slugs.
    const displaySlug = slug.replace(/-\d+$/u, "");
    return formatEmployerLabelFromSlug(displaySlug);
  } catch {
    return null;
  }
}

function inferCompanySlugFromCanonicalUrl(url: string): string | null {
  const canonicalUrl = cleanLine(url);
  if (!canonicalUrl) {
    return null;
  }

  try {
    const parsed = new URL(canonicalUrl);
    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)))
      .filter(Boolean);
    const companyMarkerIndex = pathSegments.findIndex(
      (segment) => segment.toLowerCase() === "company",
    );
    if (companyMarkerIndex < 0) {
      return null;
    }

    const slug = pathSegments[companyMarkerIndex + 1];
    if (
      !slug ||
      GENERIC_JOB_PATH_SEGMENTS.has(slug.toLowerCase()) ||
      !/[a-z\p{L}]/iu.test(slug)
    ) {
      return null;
    }

    // Job listing URLs must include a role segment after `/company/{slug}`
    // (or `/company/{slug}/jobs/{id}-…`). Pure hubs stay non-employers here.
    const rest = pathSegments.slice(companyMarkerIndex + 2);
    if (
      rest.length === 0 ||
      (rest.length === 1 && rest[0]?.toLowerCase() === "jobs")
    ) {
      return null;
    }

    return formatEmployerLabelFromSlug(slug);
  } catch {
    return null;
  }
}

function inferCompanyFromCanonicalUrl(url: string): string | null {
  const slugCompany = inferCompanySlugFromCanonicalUrl(url);
  if (slugCompany) {
    return slugCompany;
  }

  const canonicalUrl = cleanLine(url);
  if (!canonicalUrl) {
    return null;
  }

  try {
    const parsed = new URL(canonicalUrl);
    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)))
      .filter(Boolean);

    if (pathSegments.length < 2) {
      return null;
    }

    const companySegment = pathSegments[0]?.toLowerCase() ?? "";
    if (
      !companySegment ||
      GENERIC_JOB_PATH_SEGMENTS.has(companySegment) ||
      !/[a-z\p{L}]/iu.test(companySegment)
    ) {
      return null;
    }

    return titleCaseWords(companySegment.replace(/[-_]+/g, " "));
  } catch {
    return null;
  }
}

function recoverVerificationMetadata(
  lines: readonly string[],
  title: string,
): { company: string | null; location: string | null } | null {
  for (const line of uniqueStrings(lines)) {
    if (!/\bwith verification\b/i.test(line)) {
      continue;
    }

    const cleaned = cleanLine(
      stripExtractionUiSuffix(line).replace(/\s+\d+\s*$/, ""),
    );
    if (!cleaned) {
      continue;
    }

    const withoutTitleEcho = removeLeadingTitleEcho(cleaned, title);
    if (!withoutTitleEcho || withoutTitleEcho === cleaned) {
      continue;
    }

    const tokens = withoutTitleEcho.split(/\s+/).filter(Boolean);
    let location: string | null = null;
    let company: string | null = null;

    for (let width = Math.min(3, tokens.length - 1); width >= 1; width -= 1) {
      const locationCandidate = tokens.slice(-width).join(" ");
      if (!locationCandidate || !isLocationLike(locationCandidate)) {
        continue;
      }

      const companyCandidate = cleanLine(
        tokens.slice(0, Math.max(0, tokens.length - width)).join(" "),
      );
      if (!companyCandidate || isRoleLikePhrase(companyCandidate)) {
        continue;
      }

      location = locationCandidate;
      company = companyCandidate;
      break;
    }

    if (!location) {
      location = inferTrailingCompositeLocation(withoutTitleEcho);
      company = cleanLine(
        location
          ? withoutTitleEcho
              .slice(0, Math.max(0, withoutTitleEcho.length - location.length))
              .replace(/[\s•·|–—-]+$/, "")
          : withoutTitleEcho,
      );
    }

    return {
      company:
        company &&
        !COMPANY_NOISE_PATTERN.test(company) &&
        !POSTED_PATTERN.test(company) &&
        !SALARY_PATTERN.test(company)
          ? stripCompanySuffix(company)
          : null,
      location,
    };
  }

  return null;
}

function inferLocation(
  lines: readonly string[],
  workMode: JobPosting["workMode"],
  options?: { allowSingleTokenGeneric?: boolean },
): string | null {
  let bestLocationValue: string | null = null;
  let bestLocationScore = 0;

  const considerCandidate = (candidate: string) => {
    const score = scoreLocationCandidate(candidate, options);
    if (score <= 0) {
      return;
    }

    if (!bestLocationValue || score > bestLocationScore) {
      bestLocationValue = candidate;
      bestLocationScore = score;
    }
  };

  for (const line of lines) {
    const expandedCandidates = expandCompositeMetadataLine(line);
    for (const candidate of expandedCandidates) {
      considerCandidate(candidate);
    }
  }

  if (bestLocationValue) {
    return bestLocationValue;
  }

  if (workMode.includes("remote")) {
    return "Remote";
  }

  if (workMode.includes("hybrid")) {
    return "Hybrid";
  }

  return null;
}

function buildSummaryAndDescription(input: {
  lines: readonly string[];
  title: string;
  company: string;
  location: string;
  excludedLines?: readonly string[];
}): { summary: string; description: string } {
  const excluded = new Set(
    [input.title, input.company, input.location, ...(input.excludedLines ?? [])]
      .map((value) => value.toLowerCase())
      .filter(Boolean),
  );
  const contentLines = input.lines.filter((line) => {
    const normalized = cleanLine(line);
    if (!normalized) {
      return false;
    }

    const lowered = normalized.toLowerCase();
    return (
      !excluded.has(lowered) &&
      !POSTED_PATTERN.test(normalized) &&
      !SALARY_PATTERN.test(normalized) &&
      !APPLY_PATTERN.test(normalized)
    );
  });

  const summary =
    contentLines.find((line) => cleanLine(line).length >= 24) ??
    contentLines[0] ??
    `${input.title} role at ${input.company}`;
  const description = uniqueStrings(contentLines).join(" ") || summary;

  return {
    summary: cleanLine(summary).slice(0, 280),
    description: cleanLine(description),
  };
}

function preferHigherQualityField(current: string, candidate: string): string {
  const normalizedCurrent = cleanLine(current);
  const normalizedCandidate = cleanLine(candidate);

  if (!normalizedCurrent) {
    return normalizedCandidate;
  }

  if (!normalizedCandidate) {
    return normalizedCurrent;
  }

  const currentHasNoise = EXTRACTION_UI_NOISE_PATTERN.test(normalizedCurrent);
  const candidateHasNoise =
    EXTRACTION_UI_NOISE_PATTERN.test(normalizedCandidate);

  if (currentHasNoise !== candidateHasNoise) {
    return currentHasNoise ? normalizedCandidate : normalizedCurrent;
  }

  return normalizedCurrent.length >= normalizedCandidate.length
    ? normalizedCurrent
    : normalizedCandidate;
}

function preferHigherQualityLocation(
  current: string,
  candidate: string,
): string {
  const normalizedCurrent = cleanLine(current);
  const normalizedCandidate = cleanLine(candidate);

  if (!normalizedCurrent) {
    return normalizedCandidate;
  }

  if (!normalizedCandidate) {
    return normalizedCurrent;
  }

  const currentScore = scoreLocationCandidate(normalizedCurrent);
  const candidateScore = scoreLocationCandidate(normalizedCandidate);
  if (currentScore !== candidateScore) {
    return candidateScore > currentScore
      ? normalizedCandidate
      : normalizedCurrent;
  }

  return preferHigherQualityField(normalizedCurrent, normalizedCandidate);
}

function mergeJob(
  current: ExtractedJobInput | undefined,
  candidate: ExtractedJobInput,
): ExtractedJobInput {
  if (!current) {
    return candidate;
  }

  const mergedApplyPath =
    current.applyPath === "easy_apply" || candidate.applyPath === "easy_apply"
      ? "easy_apply"
      : current.applyPath !== "unknown"
        ? current.applyPath
        : candidate.applyPath !== "unknown"
          ? candidate.applyPath
          : current.applyPath;

  return {
    ...current,
    ...candidate,
    sourceJobId: current.sourceJobId || candidate.sourceJobId,
    title: preferHigherQualityField(current.title, candidate.title),
    company: preferHigherQualityField(current.company, candidate.company),
    location: preferHigherQualityLocation(current.location, candidate.location),
    summary:
      (candidate.summary &&
      candidate.summary.length > (current.summary?.length ?? 0)
        ? candidate.summary
        : current.summary) ?? null,
    description:
      candidate.description.length > current.description.length
        ? candidate.description
        : current.description,
    salaryText: candidate.salaryText ?? current.salaryText ?? null,
    postedAt: candidate.postedAt ?? current.postedAt ?? null,
    postedAtText: candidate.postedAtText ?? current.postedAtText ?? null,
    providerUpdatedAt: preferLatestIsoDateTime(
      current.providerUpdatedAt,
      candidate.providerUpdatedAt,
    ),
    workMode: uniqueStrings([
      ...(current.workMode ?? []),
      ...(candidate.workMode ?? []),
    ]).flatMap((value) => {
      const normalizedWorkMode = normalizeDetectedWorkMode(value);
      return normalizedWorkMode ? [normalizedWorkMode] : [];
    }),
    easyApplyEligible: current.easyApplyEligible || candidate.easyApplyEligible,
    applyPath: mergedApplyPath,
    keySkills: uniqueStrings([
      ...(current.keySkills ?? []),
      ...(candidate.keySkills ?? []),
    ]),
    responsibilities: uniqueStrings([
      ...(current.responsibilities ?? []),
      ...(candidate.responsibilities ?? []),
    ]),
    minimumQualifications: uniqueStrings([
      ...(current.minimumQualifications ?? []),
      ...(candidate.minimumQualifications ?? []),
    ]),
    preferredQualifications: uniqueStrings([
      ...(current.preferredQualifications ?? []),
      ...(candidate.preferredQualifications ?? []),
    ]),
    seniority: current.seniority ?? candidate.seniority ?? null,
    employmentType: current.employmentType ?? candidate.employmentType ?? null,
    department: current.department ?? candidate.department ?? null,
    team: current.team ?? candidate.team ?? null,
    employerWebsiteUrl:
      current.employerWebsiteUrl ?? candidate.employerWebsiteUrl ?? null,
    employerDomain: current.employerDomain ?? candidate.employerDomain ?? null,
    benefits: uniqueStrings([
      ...(current.benefits ?? []),
      ...(candidate.benefits ?? []),
    ]),
  };
}

/**
 * True for bare job-board index URLs such as `/jobs` that are not concrete
 * posting detail routes (no id-shaped segment after the jobs marker).
 */
export function isLikelyJobListingHubUrl(canonicalUrl: string): boolean {
  const raw = cleanLine(canonicalUrl);
  if (!raw) {
    return false;
  }

  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)).toLowerCase())
      .filter(Boolean);
    if (segments.length === 1 && segments[0] === "jobs") {
      return true;
    }
    // Category and search routes under /jobs ("/jobs/dev-engineering/front-end",
    // "/jobs/dev-engineering/search/engineering") are board navigation, not
    // postings: no segment carries an id, and every segment is a category
    // word. A posting route has an id or a multi-word title slug.
    if (
      segments[0] === "jobs" &&
      segments.length >= 2 &&
      segments.length <= 4 &&
      segments
        .slice(1)
        .every((segment) => JOB_HUB_CATEGORY_SEGMENT_PATTERN.test(segment))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const JOB_HUB_CATEGORY_SEGMENT_PATTERN =
  /^(?:search|browse|category|categories|all|remote|hybrid|onsite|dev-engineering|engineering|software|developer|front-?end|back-?end|full-?stack|mobile|devops|data(?:-science)?|design|product|marketing|sales|finance|hr|people|operations|support|customer-success|security|qa|it|legal|internships?|new-grad|entry-level|senior|junior|management|executive)$/u;

/**
 * The board's own brand, taken from its hostname: "remotive.com" ->
 * "remotive". A record whose employer is the site it was read from is the
 * site advertising itself, not an employer hiring.
 */
function getSiteBrandFromUrl(canonicalUrl: string): string | null {
  try {
    const host = new URL(canonicalUrl).hostname.toLowerCase();
    const labels = host
      .replace(/^www\./, "")
      .split(".")
      .filter(Boolean);
    // Drop the public suffix; a two-label host leaves its own first label.
    const brand = labels.length > 1 ? labels[labels.length - 2] : labels[0];
    return brand && brand.length > 1 ? brand : null;
  } catch {
    return null;
  }
}

function normalizeBrandText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * File extensions a link points at when it is a document to download rather
 * than a page to apply on. Generic file-type vocabulary, no board.
 */
const DOCUMENT_ATTACHMENT_EXTENSION_PATTERN =
  /\.(?:pdf|docx?|rtf|odt|xlsx?|csv|pptx?|odp|ods|zip|gz|tar|txt|epub)$/i;

/**
 * Whether this record is a document a page linked to rather than a job.
 *
 * "applicant rights under Federal Employment Laws.pdf" was saved as a job and
 * given a Shortlist button, because the link sat among the postings and the
 * extraction judged it by title alone. A document is recognisable by shape:
 * the address (or the title, when the link text kept the filename) ends in a
 * document extension, nobody is named as the employer, and there is no job
 * body. All three are required — a real posting served as a PDF with an
 * employer and a body still passes.
 */
export function isLikelyDocumentAttachmentJob(input: {
  canonicalUrl: string;
  title?: string | null;
  company?: string | null;
  description?: string | null;
}): boolean {
  const title = cleanLine(input.title ?? "");
  let pathname = "";
  try {
    pathname = new URL(input.canonicalUrl).pathname;
  } catch {
    pathname = input.canonicalUrl;
  }
  const looksLikeDocument =
    DOCUMENT_ATTACHMENT_EXTENSION_PATTERN.test(pathname.replace(/\/+$/u, "")) ||
    DOCUMENT_ATTACHMENT_EXTENSION_PATTERN.test(title);
  if (!looksLikeDocument) {
    return false;
  }
  const hasEmployer = cleanLine(input.company ?? "").length > 0;
  const body = cleanLine(input.description ?? "");
  // A title repeated into the description is not a job body.
  const hasJobBody =
    body.length > 0 && body.toLowerCase() !== title.toLowerCase();
  return !hasEmployer && !hasJobBody;
}

/**
 * Whether an address points at a transient access step rather than a listing.
 *
 * Match complete path segments only. A role such as `/jobs/security-engineer`
 * is a listing; `/security/123` is an access step whose eventual destination
 * must be observed before the job can be saved.
 */
export function isLikelyAccessGateUrl(value: string): boolean {
  try {
    return new URL(value).pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)).toLowerCase())
      .filter(Boolean)
      .some((segment) =>
        /^(?:auth|captcha|challenge|login|security|sign-?in|verify|verification)$/u.test(
          segment,
        ),
      );
  } catch {
    return false;
  }
}

export function isLikelySiteUtilityJob(input: {
  canonicalUrl: string;
  title?: string | null;
  company?: string | null;
  description?: string | null;
  captureMeta?: SearchResultCardCaptureMeta | null;
  /**
   * The record's address is the results surface it was read from, not an
   * address of its own: the card's anchor carried no link, so the extractor
   * fell back to the page URL. The URL then says nothing about this record —
   * every result on a search page would share the search page's shape — so
   * only the record's own text may decide whether it is site furniture.
   */
  addressIsReadSurface?: boolean;
}): boolean {
  if (input.captureMeta?.inNavigation || input.captureMeta?.inHeader) {
    return true;
  }

  if (isLikelyDocumentAttachmentJob(input)) {
    return true;
  }

  if (isLikelyAccessGateUrl(input.canonicalUrl)) {
    return true;
  }

  const title = cleanLine(input.title ?? "");
  if (PAGINATION_TITLE_PATTERN.test(title)) {
    return true;
  }
  if (
    title &&
    isListingIndexCategoryTitle(title, {
      hasDescription: Boolean(cleanLine(input.description ?? "")),
      hasEmployer: Boolean(cleanLine(input.company ?? "")),
    })
  ) {
    return true;
  }
  if (
    title &&
    (SITE_UTILITY_TITLE_PATTERN.test(title) ||
      SITE_UTILITY_ALBANIAN_PRIVACY_TITLE_PATTERN.test(title) ||
      SITE_UTILITY_TITLE_PREFIX_PATTERN.test(title) ||
      SITE_UTILITY_OPEN_POSITIONS_TITLE_PATTERN.test(title) ||
      SITE_UTILITY_INFO_TITLE_PATTERN.test(title) ||
      SITE_PROMO_TITLE_PATTERN.test(title) ||
      SITE_CALL_TO_ACTION_TITLE_PATTERN.test(title) ||
      SITE_SALARY_MARKETING_TITLE_PATTERN.test(title) ||
      LISTING_INDEX_FRESHNESS_TITLE_PATTERN.test(title) ||
      LISTING_INDEX_LOCATION_TITLE_PATTERN.test(title) ||
      SITE_UTILITY_CHROME_TITLE_PATTERN.test(title))
  ) {
    return true;
  }

  // Past this point every rule reads the address. A record that borrowed the
  // read surface's address has none of its own to read, so it is judged on
  // its text alone and passes.
  if (input.addressIsReadSurface) {
    return false;
  }

  const company = cleanLine(input.company ?? "");
  const body = cleanLine(input.description ?? "");
  const hasEmployer =
    company.length > 0 && !ABSENT_EMPLOYER_PATTERN.test(company);
  const hasBody =
    body.length > 0 && body.toLocaleLowerCase() !== title.toLocaleLowerCase();
  if (!hasEmployer && !hasBody) {
    try {
      const parsed = new URL(input.canonicalUrl);
      const hasDetailQuery = [...parsed.searchParams].some(
        ([key, value]) =>
          DETAIL_QUERY_KEY_PATTERN.test(key) && value.trim().length > 0,
      );
      const hasDetailPath = parsed.pathname
        .split("/")
        .map((segment) => decodeURIComponent(segment).trim())
        .filter(Boolean)
        .some((segment) => DETAIL_PATH_ID_PATTERN.test(segment));
      const hasRoleShapedPath =
        ROLE_TITLE_NOUN_PATTERN.test(title) &&
        (parsed.pathname.split("/").filter(Boolean).length >= 2 ||
          parsed.searchParams.size > 0);
      if (!hasDetailQuery && !hasDetailPath && !hasRoleShapedPath) {
        return true;
      }
    } catch {
      return true;
    }
  }

  // The employer is the board itself, so nobody is hiring here.
  if (company) {
    const brand = getSiteBrandFromUrl(input.canonicalUrl);
    if (brand && normalizeBrandText(company) === normalizeBrandText(brand)) {
      return true;
    }
  }

  if (isLikelyJobListingHubUrl(input.canonicalUrl)) {
    return true;
  }

  try {
    const parsed = new URL(input.canonicalUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "fb.com" ||
      host === "www.fb.com" ||
      host === "facebook.com" ||
      host === "www.facebook.com" ||
      host.endsWith(".facebook.com") ||
      host.startsWith("help.")
    ) {
      return true;
    }

    const segments = parsed.pathname
      .split("/")
      .map((segment) => cleanLine(decodeURIComponent(segment)).toLowerCase())
      .filter(Boolean);
    if (
      segments.some(
        (segment) =>
          SITE_UTILITY_PATH_SEGMENTS.has(segment) ||
          SITE_UTILITY_INFO_PATH_SEGMENTS.has(segment),
      )
    ) {
      return true;
    }

    // Company profile hubs under either spelling: `/company/{slug}` and
    // `/companies/{slug}` are pages about an employer, not postings.
    const companyIndex =
      segments.indexOf("company") >= 0
        ? segments.indexOf("company")
        : segments.indexOf("companies");
    if (companyIndex >= 0) {
      const rest = segments.slice(companyIndex + 2);
      // `/company/{slug}` hubs and `/company/{slug}/jobs` indexes are chrome.
      if (
        segments[companyIndex + 1] &&
        (rest.length === 0 || (rest.length === 1 && rest[0] === "jobs"))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function isCompleteJob(
  job: ExtractedJobInput | undefined,
  evidence?: LearnedSearchSurfaceRouteEvidence,
): job is ExtractedJobInput {
  return Boolean(
    job &&
    job.canonicalUrl &&
    job.sourceJobId &&
    job.title &&
    job.company &&
    job.location &&
    job.description &&
    !isLikelySiteUtilityJob({
      canonicalUrl: job.canonicalUrl,
      title: job.title,
      company: job.company,
      description: job.description,
      addressIsReadSurface: evidence
        ? isSharedLearnedSurfaceUrl(job.canonicalUrl, evidence)
        : false,
    }),
  );
}

function buildJobFromStructuredData(
  candidate: StructuredDataJobCandidate,
  pageUrl: string,
  evidence: LearnedSearchSurfaceRouteEvidence,
): ExtractedJobInput | null {
  const canonicalUrl =
    buildLearnedDetailUrlFromHint({
      url: candidate.canonicalUrl,
      pageUrl,
      sourceJobIdHint: candidate.sourceJobId ?? null,
      evidence,
    }) || canonicalizeUrl(candidate.canonicalUrl, pageUrl);
  const title = normalizeExtractedJobTitle({
    value: candidate.title,
    company: candidate.company,
    location: candidate.location,
  });
  const company = cleanLine(candidate.company);
  const workMode = normalizeWorkModes(
    candidate.workMode,
    candidate.location ?? undefined,
  );
  const location = cleanLine(candidate.location) || inferLocation([], workMode);
  const description =
    cleanLine(candidate.description) || cleanLine(candidate.summary);

  if (
    isLikelySiteUtilityJob({
      canonicalUrl,
      title,
      company,
      description,
    })
  ) {
    return null;
  }

  return {
    sourceJobId:
      cleanLine(candidate.sourceJobId) ||
      buildGenericJobId(canonicalUrl || pageUrl),
    canonicalUrl,
    title,
    company,
    location: location || "",
    description,
    salaryText: trimToNull(candidate.salaryText),
    summary: trimToNull(candidate.summary) ?? description.slice(0, 280),
    postedAt: toIsoDateTimeOrNull(candidate.postedAt),
    postedAtText: keepPostedAtDateText(trimToNull(candidate.postedAtText)),
    providerUpdatedAt: toIsoDateTimeOrNull(candidate.providerUpdatedAt),
    workMode,
    applyPath: candidate.applyPath ?? "unknown",
    easyApplyEligible: candidate.easyApplyEligible === true,
    keySkills: normalizeStringArray(candidate.keySkills),
    responsibilities: normalizeStringArray(candidate.responsibilities),
    minimumQualifications: normalizeStringArray(
      candidate.minimumQualifications,
    ),
    preferredQualifications: normalizeStringArray(
      candidate.preferredQualifications,
    ),
    seniority: trimToNull(candidate.seniority),
    employmentType: trimToNull(candidate.employmentType),
    department: trimToNull(candidate.department),
    team: trimToNull(candidate.team),
    employerWebsiteUrl: trimToNull(candidate.employerWebsiteUrl),
    employerDomain: trimToNull(candidate.employerDomain),
    benefits: normalizeStringArray(candidate.benefits),
  };
}

/** Separators boards use between the employer and the rest of a card's meta line. */
const CARD_META_SEGMENT_SEPARATOR = /\s*[|•·]\s*/u;

function countUnclosedParentheses(value: string): number {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/**
 * A title never honestly ends on a connector or an opening bracket: the rest
 * of it was painted on another line and dropped. Shape only — no board knows
 * about this rule.
 */
const DANGLING_TITLE_TAIL_PATTERN =
  /(?:[&,/:+\-–—]|\b(?:and|or|with|of|for|to|in|the)\b|[([])\s*$/iu;
/** Words a place name carries that a title remainder does not. */
const PLACE_NAME_TOKEN_PATTERN =
  /\b(?:usa|u\.s\.a?\.?|united\s+states|uk|united\s+kingdom|canada|australia|india|germany|france|spain|italy|netherlands|ireland|poland|portugal|sweden|norway|denmark|switzerland|austria|belgium|brazil|mexico|japan|china|singapore|city|county|state|province|region|district|metro|greater|area|county)\b/iu;

function toComparableWords(value: string): string[] {
  return cleanLine(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The words a URL slug carries after the ones the title already has.
 *
 * A listing's address spells the whole title, so a slug that starts with every
 * title word and keeps going is telling us the painted title stopped early.
 */
function findSlugTitleContinuationWords(
  urls: readonly (string | null | undefined)[],
  titleWords: readonly string[],
): string[] | null {
  if (titleWords.length === 0) {
    return null;
  }

  for (const url of urls) {
    const continuation = findSlugContinuationInUrl(url, titleWords);
    if (continuation) {
      return continuation;
    }
  }

  return null;
}

function findSlugContinuationInUrl(
  url: string | null | undefined,
  titleWords: readonly string[],
): string[] | null {
  const parsed = parseHttpUrl(cleanLine(url));
  if (!parsed) {
    return null;
  }

  for (const segment of parsed.pathname.split("/").filter(Boolean)) {
    // Only a trailing numeric id is dropped. A year or a number inside the
    // title ("2027 US Chess Academy Interest Form") is part of the title, and
    // dropping every digit stopped the address from matching the title at all.
    const words = toComparableWords(safeDecodeUriComponent(segment));
    while (words.length > 0 && /^\d+$/.test(words.at(-1) ?? "")) {
      words.pop();
    }
    if (words.length <= titleWords.length || words.length > 24) {
      continue;
    }

    if (titleWords.some((word, index) => words[index] !== word)) {
      continue;
    }

    const continuation = words.slice(titleWords.length);
    if (continuation.length === 0 || continuation.length > 6) {
      continue;
    }

    return continuation;
  }

  return null;
}

/**
 * The continuation as the card actually spelled it. A slug is lowercase and
 * hyphenated, so "isv ecosystem" is read back off the card's own text to keep
 * "ISV Ecosystem" rather than inventing "Isv Ecosystem".
 */
function recoverCasedContinuation(
  words: readonly string[],
  cardText: string | null | undefined,
): string {
  const tokens = cleanLine(cardText).split(/\s+/).filter(Boolean);

  for (let index = 0; index + words.length <= tokens.length; index += 1) {
    const window = tokens.slice(index, index + words.length);
    const matches = window.every(
      (token, offset) => toComparableWords(token).join("") === words[offset],
    );
    if (matches) {
      return cleanLine(window.join(" ").replace(/[,;:.]+$/u, ""));
    }
  }

  return titleCaseWords(words.join(" "));
}

/** The words the card printed right after a title that stopped mid-phrase. */
function findCardTextContinuation(
  title: string,
  cardText: string | null | undefined,
): string | null {
  const text = cleanLine(cardText);
  const normalizedTitle = cleanLine(title);
  if (!text || !normalizedTitle) {
    return null;
  }

  const index = text.toLowerCase().indexOf(normalizedTitle.toLowerCase());
  if (index === -1) {
    return null;
  }

  const remainder = text.slice(index + normalizedTitle.length);
  const boundary = /\s(?:at|·|•|\||–|—|-)\s|,\s|\s{2,}/u.exec(remainder);
  const continuation = cleanLine(
    boundary ? remainder.slice(0, boundary.index) : remainder,
  );
  const wordCount = toComparableWords(continuation).length;

  return continuation && wordCount >= 1 && wordCount <= 6 ? continuation : null;
}

/**
 * Clears a location line the finished title already says.
 *
 * Whichever rule lengthened the title, the words it recovered were painted
 * once and must not also stand as where the work is: rows read "Manager
 * Credit Risk" in "Credit Risk" and "Product Manager Services" in "Services".
 * A line the title ends with, or that the title carries as a run of its own
 * words, is title text; a real place is left alone.
 */
function dropLocationTheTitleAlreadyCarries(
  title: string,
  location: string | null,
): string | null {
  const normalized = cleanLine(location);
  if (!normalized) {
    return location;
  }

  const titleWords = toComparableWords(title);
  const locationWords = toComparableWords(normalized);
  if (locationWords.length === 0 || locationWords.length > titleWords.length) {
    return location;
  }

  const carriedAt = (start: number): boolean =>
    locationWords.every((word, offset) => titleWords[start + offset] === word);

  // The title ends on exactly these words: they were painted once, as title.
  // This holds even for a line shaped like a place ("Owner, Workday ERP"),
  // which is why the suffix test is not guarded by the place check.
  if (carriedAt(titleWords.length - locationWords.length)) {
    return null;
  }

  if (readsLikePlaceName(normalized)) {
    return location;
  }

  for (
    let index = 0;
    index + locationWords.length <= titleWords.length;
    index += 1
  ) {
    if (carriedAt(index)) {
      return null;
    }
  }

  return location;
}

/** True when a line reads as a place rather than as more of a title. */
function readsLikePlaceName(value: string): boolean {
  const normalized = cleanLine(value);
  if (!normalized) {
    return false;
  }

  return (
    LOCATION_HINT_PATTERN.test(normalized) ||
    normalized.includes(",") ||
    PLACE_NAME_TOKEN_PATTERN.test(normalized)
  );
}

/**
 * Puts back a title a card broke across two painted lines.
 *
 * A card whose heading wraps paints the rest of the title as its own line, and
 * the card reader took the first line as the title and left the remainder in
 * the employer's meta line. Rows then read "Lead" at "Wells Fargo • Equipment
 * Finance Underwriter" and "Sr. Strategic Finance Manager (Bellevue, WA" at
 * "Logicgate • or Chicago, IL)": two facts, both wrong, from one heading.
 *
 * Two rules decide, and both are about the text itself rather than any board:
 * a parenthesis the title opened is closed inside the title, and a bare
 * seniority word ("Lead", "Senior", "Principal") followed by a role-like
 * segment is one title. The employer is never a continuation of the title, and
 * the last remaining segment is never taken — an employer is not emptied to
 * lengthen a title.
 */
export function repairWrappedCardTitle(input: {
  title: string;
  company: string | null;
  location?: string | null;
  cardText?: string | null;
  canonicalUrl?: string | null;
  /**
   * The address the card itself carried, before canonicalisation. Once a run
   * has learned a board's detail route, every listing is rewritten to
   * `/job/{id}` — which throws away the slug this repair reads the title
   * from, so the card's own address is kept as a second witness.
   */
  sourceUrl?: string | null;
}): { title: string; company: string | null; location?: string | null } {
  const metaRepaired = repairTitleWrappedIntoMetaLine(input);
  // The location rule runs first: once the title has been extended, the words
  // it took are part of the title and the "does the address continue with
  // these words" test can no longer recognise the same words sitting in the
  // location line.
  const slugUrls = [input.canonicalUrl ?? null, input.sourceUrl ?? null];
  const withLocation = repairTitleRemainderReadAsLocation({
    title: metaRepaired.title,
    location: input.location ?? null,
    slugUrls,
  });
  const title = repairTitleStoppedMidPhrase({
    title: withLocation.title,
    cardText: input.cardText ?? null,
    slugUrls,
  });
  const location = dropLocationTheTitleAlreadyCarries(
    title,
    withLocation.location,
  );

  return "location" in input
    ? { title, company: metaRepaired.company, location }
    : { title, company: metaRepaired.company };
}

/**
 * A title that stops on a connector ("… AI &", "Manager,") lost its rest to
 * the next painted line. The address slug spells the whole title, so the words
 * it carries past the painted ones are the missing remainder; the card's own
 * text supplies their real casing.
 */
function repairTitleStoppedMidPhrase(input: {
  title: string;
  cardText: string | null;
  slugUrls: readonly (string | null)[];
}): string {
  // Whatever the rules below make of the title, it never leaves here holding a
  // bracket nothing closes: the address slug can put the same half-written
  // aside back on the end after the parenthesis rule has dealt with it.
  return dropDanglingTitleParenthesis(resolveTitleStoppedMidPhrase(input));
}

function resolveTitleStoppedMidPhrase(input: {
  title: string;
  cardText: string | null;
  slugUrls: readonly (string | null)[];
}): string {
  const completed = completeUnclosedTitleParenthesis(
    cleanLine(input.title),
    input.cardText,
  );
  const title = cleanLine(completed);
  if (!title) {
    return title;
  }

  const titleWords = toComparableWords(title);
  const slugContinuation = findSlugTitleContinuationWords(
    input.slugUrls,
    titleWords,
  );
  const endsMidPhrase = DANGLING_TITLE_TAIL_PATTERN.test(title);

  if (slugContinuation) {
    // A title that reads as finished is only extended on two agreeing
    // witnesses: the address spells more words right after it, and the card's
    // own text prints that same longer phrase. A heading painted on one line
    // ("Manager") and summarised on another ("Manager Credit Risk at …") is
    // the same wrap as a dangling connector, with nothing in the text to show
    // for it.
    // The card's own spelling, punctuation included: the record says
    // "Analyst - Insurance Solutions", never "Analyst Insurance Solutions".
    const printed = readContinuedTitleFromCardText(
      titleWords,
      slugContinuation,
      input.cardText,
    );
    if (printed) {
      return printed;
    }
    return endsMidPhrase
      ? cleanLine(
          `${title} ${recoverCasedContinuation(slugContinuation, input.cardText)}`,
        )
      : title;
  }

  if (!endsMidPhrase) {
    return title;
  }

  const continuation = findCardTextContinuation(title, input.cardText);
  return continuation ? cleanLine(`${title} ${continuation}`) : title;
}

/**
 * A parenthesis the painted title opened and the line break swallowed:
 * "Software Engineer I - AI (Hybrid in" is finished from the card's own text
 * up to the bracket that closes it, and a bracketed work-mode aside is then
 * dropped the way the rest of extraction drops one, so the title is the role.
 */
function closeTitleFromTail(
  title: string,
  tailText: string,
  openDepth: number,
): string | null {
  let depth = openDepth;
  let tail = "";
  for (const character of tailText) {
    tail += character;
    if (tail.length > 80) {
      return null;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character !== ")") {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return cleanLine(
        `${title}${tail}`.replace(PARENTHETICAL_WORK_MODE_TAIL_PATTERN, ""),
      );
    }
  }
  return null;
}

/**
 * A title with a bracket nothing closes is the painted line, not the role.
 *
 * Keeping "Lead Platform Software Engineer (Remote" puts a half-written aside
 * in front of the person on every screen the title appears. The aside is the
 * part that was cut, so the aside is what goes.
 */
function dropDanglingTitleParenthesis(title: string): string {
  let depth = 0;
  let cutAt = -1;
  for (let index = 0; index < title.length; index += 1) {
    const character = title[index];
    if (character === "(") {
      if (depth === 0) cutAt = index;
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) cutAt = -1;
    }
  }
  if (cutAt <= 0) {
    return title;
  }
  const kept = cleanLine(title.slice(0, cutAt)).replace(
    /[\s\-–—,:;/|]+$/u,
    "",
  );
  return kept.length > 0 ? kept : title;
}

function completeUnclosedTitleParenthesis(
  title: string,
  cardText: string | null | undefined,
): string {
  const openDepth = countUnclosedParentheses(title);
  if (openDepth === 0) {
    return title;
  }

  // Every witness the repair was given is searched, and every place in it the
  // title appears. The first place is often the title's own copy at the head
  // of the text, whose tail is the summary repeating the whole heading; the
  // closing bracket is in the copy after that.
  const text = cleanLine(cardText);
  const haystack = text.toLowerCase();
  const needle = title.toLowerCase();
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + 1)
  ) {
    const closed = closeTitleFromTail(
      title,
      text.slice(index + title.length),
      openDepth,
    );
    if (closed) {
      return closed;
    }
  }

  return dropDanglingTitleParenthesis(title);
}

/** A bracketed aside that only states the work mode and where: "(Hybrid in Oak Brook, IL)". */
const PARENTHETICAL_WORK_MODE_TAIL_PATTERN =
  /\s*\((?=[^)]*(?:remote|hybrid|on[- ]?site|onsite))[^)]*\)\s*$/iu;

/**
 * The title and its continuation exactly as the card printed them, or null
 * when the card never printed them together.
 *
 * Reading the phrase back off the card keeps the punctuation the address
 * cannot carry: a slug spells "analyst insurance solutions" for a card that
 * says "Analyst - Insurance Solutions".
 */
function readContinuedTitleFromCardText(
  titleWords: readonly string[],
  continuationWords: readonly string[],
  cardText: string | null | undefined,
): string | null {
  const phrase = [...titleWords, ...continuationWords];
  const text = cleanLine(cardText);
  if (phrase.length === 0 || !text) {
    return null;
  }

  const words: { value: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const index = match.index ?? 0;
    words.push({
      value: match[0].toLowerCase(),
      start: index,
      end: index + match[0].length,
    });
  }

  for (let index = 0; index + phrase.length <= words.length; index += 1) {
    const matches = phrase.every(
      (word, offset) => words[index + offset]?.value === word,
    );
    if (!matches) {
      continue;
    }

    const first = words[index];
    const last = words[index + phrase.length - 1];
    if (!first || !last) {
      continue;
    }

    return cleanLine(text.slice(first.start, last.end));
  }

  return null;
}

/**
 * The stretch of page text around where the title was painted.
 *
 * A whole results page names dozens of roles, and the repair must read the
 * words that follow this one's heading rather than a phrase from a card
 * further down; a window keeps the evidence local to the listing.
 */
function readPageTextAroundTitle(
  pageText: string | null | undefined,
  title: string,
): string {
  const text = cleanLine(pageText);
  const normalizedTitle = cleanLine(title);
  if (!text || !normalizedTitle) {
    return "";
  }

  const index = text.toLowerCase().indexOf(normalizedTitle.toLowerCase());
  if (index === -1) {
    return "";
  }

  return text.slice(index, index + normalizedTitle.length + 160);
}

/**
 * Puts a wrapped title back together for a record however it was built.
 *
 * Cards are not the only way a listing reaches the app: the same painted
 * heading also arrives as structured data, and a run's rows showed titles cut
 * to their first painted line ("Manager", "People Operations Generalist" cut
 * to "People Operations") while the record's own summary and address spelled
 * the whole thing. Every extracted record passes through here, so the repair
 * does not depend on which extractor produced it.
 */
export function repairExtractedJobTitle(
  job: ExtractedJobInput,
  options?: { pageText?: string | null },
): ExtractedJobInput {
  const repaired = repairWrappedCardTitle({
    title: job.title,
    company: job.company,
    location: job.location,
    cardText: [
      job.title,
      job.summary ?? "",
      job.description,
      readPageTextAroundTitle(options?.pageText, job.title),
    ]
      .map((value) => cleanLine(value))
      .filter(Boolean)
      .join(" "),
    canonicalUrl: job.canonicalUrl,
  });

  if (
    repaired.title === job.title &&
    (repaired.company ?? "") === job.company &&
    (repaired.location ?? "") === job.location
  ) {
    return job;
  }

  return {
    ...job,
    title: repaired.title,
    company: repaired.company ?? "",
    location: repaired.location ?? "",
  };
}

/**
 * A location line that names no place, and whose words the address spells
 * immediately after the title's, is the rest of the title rather than where
 * the work happens.
 */
function repairTitleRemainderReadAsLocation(input: {
  title: string;
  location: string | null;
  slugUrls: readonly (string | null)[];
}): { title: string; location: string | null } {
  const title = cleanLine(input.title);
  const location = cleanLine(input.location);
  if (!title || !location || readsLikePlaceName(location)) {
    return { title, location: input.location ?? null };
  }

  const continuation = findSlugTitleContinuationWords(
    input.slugUrls,
    toComparableWords(title),
  );
  const locationWords = toComparableWords(location);
  const continuesWithLocation =
    continuation !== null &&
    continuation.length === locationWords.length &&
    continuation.every((word, index) => locationWords[index] === word);

  if (!continuesWithLocation) {
    return { title, location: input.location ?? null };
  }

  return { title: cleanLine(`${title} ${location}`), location: null };
}

function repairTitleWrappedIntoMetaLine(input: {
  title: string;
  company: string | null;
}): { title: string; company: string | null } {
  const title = cleanLine(input.title);
  const company = cleanLine(input.company);
  if (!title || !company) {
    return { title, company: input.company };
  }

  const segments = company
    .split(CARD_META_SEGMENT_SEPARATOR)
    .map((segment) => cleanLine(segment))
    .filter(Boolean);
  // One segment is the employer and nothing else; there is no continuation to
  // recover and taking it would leave the row with no employer at all.
  if (segments.length < 2) {
    return { title, company: input.company };
  }

  const unclosed = countUnclosedParentheses(title);
  const continuationIndex = unclosed
    ? segments.findIndex((segment) => segment.includes(")"))
    : /^(?:senior|sr\.?|junior|jr\.?|mid|staff|lead|principal|associate|head)$/iu.test(
          title,
        )
      ? segments.findIndex(
          (segment, index) =>
            index > 0 && scoreCardTitleCandidate(segment) > 0,
        )
      : -1;
  if (continuationIndex <= 0) {
    return { title, company: input.company };
  }

  const remaining = segments.filter((_, index) => index !== continuationIndex);
  if (remaining.length === 0) {
    return { title, company: input.company };
  }

  return {
    title: cleanLine(`${title} ${segments[continuationIndex]}`),
    company: remaining.join(" • "),
  };
}

function buildJobFromCardCandidate(
  candidate: SearchResultCardCandidate,
  pageUrl: string,
  evidence: LearnedSearchSurfaceRouteEvidence,
): ExtractedJobInput | null {
  const shouldCanonicalizeCurrentJobIdRoute =
    shouldCanonicalizeSearchSurfaceDetailRoute({
      candidate,
      pageUrl,
      evidence,
    });
  const hasUnprovenSearchSurfaceRoute =
    !shouldCanonicalizeCurrentJobIdRoute &&
    isSharedLearnedSurfaceUrl(candidate.canonicalUrl, evidence);
  const hintedSourceJobId =
    shouldCanonicalizeCurrentJobIdRoute || !hasUnprovenSearchSurfaceRoute
      ? cleanLine(candidate.sourceJobIdHint)
      : "";
  const canonicalUrl =
    buildLearnedDetailUrlFromHint({
      url: candidate.canonicalUrl,
      pageUrl,
      ...(candidate.sourceJobIdHint !== undefined
        ? { sourceJobIdHint: candidate.sourceJobIdHint }
        : {}),
      searchableText: [
        candidate.anchorText,
        candidate.headingText ?? "",
        ...candidate.lines,
      ].join(" "),
      evidence,
    }) ?? canonicalizeUrl(candidate.canonicalUrl, pageUrl);
  if (
    isLikelySiteUtilityJob({
      canonicalUrl,
      title: candidate.anchorText ?? candidate.headingText,
      company: candidate.companyText ?? null,
      description: candidate.lines.join(" "),
      captureMeta: candidate.captureMeta ?? null,
      addressIsReadSurface:
        hasUnprovenSearchSurfaceRoute &&
        isSharedLearnedSurfaceUrl(canonicalUrl, evidence),
    })
  ) {
    return null;
  }

  const candidateFingerprint = buildSearchResultCardFingerprint(candidate);
  const lines = uniqueStrings(candidate.lines);
  const rawHeadingOrAnchor = selectBestRawCardTitle(candidate);
  const explicitDismissTitle =
    collectDismissTitles(candidate).sort(
      (left, right) =>
        scoreCardTitleCandidate(right) - scoreCardTitleCandidate(left),
    )[0] ?? null;
  const isSearchSurfaceCandidate = cardShowsRecoverableUiNoise(candidate);
  const pollutedTitleCompanySplit = isSearchSurfaceCandidate
    ? splitContaminatedTitleCompanySuffix(rawHeadingOrAnchor)
    : { title: rawHeadingOrAnchor, company: null };
  const recoveredCardTitle = isSearchSurfaceCandidate
    ? recoverBetterCardTitleFromLines({
        lines,
        fallbackTitle: pollutedTitleCompanySplit.title,
      })
    : null;
  const rawTitle = sanitizeCardTitle(
    recoveredCardTitle ?? pollutedTitleCompanySplit.title,
  );
  const compositeTitle = explicitDismissTitle
    ? {
        title: trimMalformedTrailingRoleRepeat(
          stripExtractionUiSuffix(explicitDismissTitle)
            .replace(/\(verified job\)/gi, " ")
            .replace(
              /\s*[|•·]\s*(?:Remote|Hybrid|On[- ]?site|Onsite)\s*$/i,
              "",
            ),
        ),
        location: null,
        postedAtText: null,
      }
    : normalizeCompositeCardTitle(
        stripExtractionUiSuffix(
          recoveredCardTitle ?? pollutedTitleCompanySplit.title,
        ),
      );
  const title = explicitDismissTitle
    ? cleanLine(compositeTitle.title) || rawTitle
    : sanitizeCardTitle(compositeTitle.title) || rawTitle;
  const excludedTitleLines = new Set(
    [rawHeadingOrAnchor, rawTitle, title]
      .map((value) => cleanLine(value).toLowerCase())
      .filter(Boolean),
  );
  const metadataLines = uniqueStrings(
    lines
      .filter((line) => !excludedTitleLines.has(cleanLine(line).toLowerCase()))
      .flatMap((line) => expandCompositeMetadataLine(line)),
  );
  const workMode = normalizeWorkModes(
    metadataLines,
    [rawTitle, ...metadataLines].join(" "),
  );
  const verificationMetadata = isSearchSurfaceCandidate
    ? recoverVerificationMetadata(lines, title)
    : null;
  const compositeMetadata = isSearchSurfaceCandidate
    ? recoverSearchSurfaceCompositeMetadata(lines, title)
    : null;
  const hardLocation =
    trimToNull(candidate.locationText) ??
    compositeMetadata?.location ??
    verificationMetadata?.location ??
    inferLocation(metadataLines, workMode, {
      allowSingleTokenGeneric: false,
    }) ??
    compositeTitle.location;
  const urlCompany = inferCompanyFromCanonicalUrl(canonicalUrl);
  const urlCompanySlug = inferCompanySlugFromCanonicalUrl(canonicalUrl);
  const companyHrefEmployer = inferEmployerFromCompanyProfileHref(
    candidate.companyHref,
  );
  const initialCompany =
    sanitizeEmployerLabelWithoutBadges(trimToNull(candidate.companyText)) ??
    sanitizeEmployerLabelWithoutBadges(compositeMetadata?.company) ??
    companyHrefEmployer ??
    urlCompanySlug ??
    inferCompany(
      metadataLines.filter(
        (line) =>
          cleanLine(line).toLowerCase() !== (hardLocation?.toLowerCase() ?? ""),
      ),
      title,
      hardLocation,
    ) ??
    verificationMetadata?.company ??
    pollutedTitleCompanySplit.company ??
    urlCompany;
  const location =
    hardLocation ??
    inferLocation(
      metadataLines.filter(
        (line) =>
          cleanLine(line).toLowerCase() !==
          (initialCompany?.toLowerCase() ?? ""),
      ),
      workMode,
    ) ??
    verificationMetadata?.location;
  const company =
    sanitizeEmployerLabelWithoutBadges(
      initialCompany ??
        inferCompany(
          metadataLines.filter(
            (line) =>
              cleanLine(line).toLowerCase() !== (location?.toLowerCase() ?? ""),
          ),
          title,
          location ?? null,
        ) ??
        pollutedTitleCompanySplit.company ??
        urlCompany,
    ) ?? null;
  const repairedCard = repairWrappedCardTitle({
    title: normalizeExtractedJobTitle({ value: title, company, location }),
    company,
    location: location ?? null,
    cardText: [
      cleanLine(candidate.anchorText),
      cleanLine(candidate.headingText),
      ...lines,
    ]
      .filter(Boolean)
      .join(" "),
    canonicalUrl,
    sourceUrl: candidate.canonicalUrl,
  });
  const canonicalTitle = repairedCard.title;
  const repairedCompany = repairedCard.company;
  const repairedLocation = repairedCard.location ?? null;

  const { summary, description } = buildSummaryAndDescription({
    lines,
    title: canonicalTitle || cleanLine(candidate.anchorText),
    company: repairedCompany || "",
    location: repairedLocation || "",
    excludedLines: [rawTitle],
  });

  return {
    sourceJobId:
      hintedSourceJobId ||
      (hasUnprovenSearchSurfaceRoute
        ? `${buildGenericJobId(canonicalUrl || pageUrl)}_${candidateFingerprint}`.slice(
            0,
            160,
          )
        : buildGenericJobId(canonicalUrl || pageUrl)),
    canonicalUrl,
    title: canonicalTitle,
    company: repairedCompany || "",
    location: repairedLocation || "",
    description,
    salaryText: findSalaryText(lines),
    summary,
    postedAt: null,
    postedAtText: findPostedAtText(lines) ?? compositeTitle.postedAtText,
    workMode,
    applyPath: EASY_APPLY_PATTERN.test(lines.join(" "))
      ? "easy_apply"
      : "unknown",
    easyApplyEligible: EASY_APPLY_PATTERN.test(lines.join(" ")),
    keySkills: [],
    responsibilities: [],
    minimumQualifications: [],
    preferredQualifications: [],
    seniority: null,
    employmentType: findEmploymentType(lines),
    department: null,
    team: null,
    employerWebsiteUrl: null,
    employerDomain: null,
    benefits: [],
  };
}

export function scoreSearchResultCardForPreferences(input: {
  pageUrl: string;
  candidate: SearchResultCardCandidate;
  searchPreferences?: ExtractionSearchPreferences;
  prebuiltJob?: ExtractedJobInput;
}): number {
  if (!input.searchPreferences) {
    return 0;
  }

  const job =
    input.prebuiltJob ??
    buildJobFromCardCandidate(
      input.candidate,
      input.pageUrl,
      observeLearnedSearchSurfaceRoutes({
        pageUrl: input.pageUrl,
        observedUrls: [input.candidate.canonicalUrl],
      }),
    );
  if (!job) {
    return 0;
  }

  return Math.max(0, scoreJobForPreferences(job, input.searchPreferences));
}

export function scoreSearchResultCardTitleForPreferences(input: {
  pageUrl: string;
  candidate: SearchResultCardCandidate;
  searchPreferences?: ExtractionSearchPreferences;
  prebuiltJob?: ExtractedJobInput;
}): number {
  if (!input.searchPreferences) {
    return 0;
  }

  const job =
    input.prebuiltJob ??
    buildJobFromCardCandidate(
      input.candidate,
      input.pageUrl,
      observeLearnedSearchSurfaceRoutes({
        pageUrl: input.pageUrl,
        observedUrls: [input.candidate.canonicalUrl],
      }),
    );
  if (!job) {
    return 0;
  }

  return scoreJobTitleForPreferences(job, input.searchPreferences);
}

/**
 * How many distinct sibling detail links a page must carry before it counts
 * as an index of jobs rather than one job.
 */
const LISTING_INDEX_MIN_SIBLING_LINKS = 3;

function toUrlIdentityKey(value: string): string | null {
  try {
    const parsed = new URL(value);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/u, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

/**
 * Whether a record is the index page it was read from rather than a posting on
 * it.
 *
 * Board landing pages used to be scraped like any other page and then have
 * their records dropped afterwards by title, which meant the decision rested
 * on how a board happened to word its headings — a per-board rule by another
 * name (ADR 0007). The shape of the page answers it instead, and generically:
 * the record's address is the page's own address, the page carries several
 * distinct sibling links to job detail pages, and there is no single job body
 * on it. Anything that has a body of its own is a posting and passes.
 */
export function isListingIndexPageRecord(input: {
  canonicalUrl: string;
  pageUrl: string;
  siblingDetailUrlCount: number;
  description?: string | null;
  title?: string | null;
}): boolean {
  if (input.siblingDetailUrlCount < LISTING_INDEX_MIN_SIBLING_LINKS) {
    return false;
  }
  const recordKey = toUrlIdentityKey(input.canonicalUrl);
  const pageKey = toUrlIdentityKey(input.pageUrl);
  if (!recordKey || !pageKey || recordKey !== pageKey) {
    return false;
  }
  const title = cleanLine(input.title ?? "");
  const body = cleanLine(input.description ?? "");
  const hasJobBody =
    body.length > 0 && body.toLowerCase() !== title.toLowerCase();
  return !hasJobBody;
}

export function buildStructuredCandidateJobs(input: {
  pageUrl: string;
  maxJobs: number;
  structuredDataCandidates?: readonly StructuredDataJobCandidate[];
  cardCandidates?: readonly SearchResultCardCandidate[];
  searchPreferences?: ExtractionSearchPreferences;
}): ExtractedJobInput[] {
  if (input.maxJobs <= 0) {
    return [];
  }

  const jobsByKey = new Map<string, ExtractedJobInput>();
  const cardSurfaceScoreByMergeKey = new Map<string, number>();
  const learnedEvidence = observeLearnedSearchSurfaceRoutes({
    pageUrl: input.pageUrl,
    observedUrls: [
      input.pageUrl,
      ...(input.cardCandidates ?? []).map(
        (candidate) => candidate.canonicalUrl,
      ),
    ],
    detailOnlyUrls: (input.structuredDataCandidates ?? []).map(
      (candidate) => candidate.canonicalUrl,
    ),
  });
  const isSearchSurface = learnedEvidence.sharedSurfaceUrls.size > 0;
  // How many distinct sibling job links this page carries. It is the one
  // signal that decides — before anything is extracted — whether a record
  // sharing the page's own address is the index rather than a posting.
  const pageIdentityKey = toUrlIdentityKey(input.pageUrl);
  const siblingDetailUrlCount = new Set(
    [
      ...(input.cardCandidates ?? []).map(
        (candidate) => candidate.canonicalUrl,
      ),
      ...(input.structuredDataCandidates ?? []).map(
        (candidate) => candidate.canonicalUrl,
      ),
    ]
      .map((url) => (url ? toUrlIdentityKey(url) : null))
      .filter((key): key is string => Boolean(key) && key !== pageIdentityKey),
  ).size;
  const effectiveMaxJobs = Math.max(1, input.maxJobs);
  const targetCardCandidateBudget = isSearchSurface
    ? Math.max(96, effectiveMaxJobs * 8)
    : Math.max(20, effectiveMaxJobs * 3);

  for (const candidate of input.structuredDataCandidates ?? []) {
    const job = buildJobFromStructuredData(
      candidate,
      input.pageUrl,
      learnedEvidence,
    );
    if (
      !job ||
      isListingIndexPageRecord({
        canonicalUrl: job.canonicalUrl,
        pageUrl: input.pageUrl,
        siblingDetailUrlCount,
        description: job.description,
        title: job.title,
      })
    ) {
      continue;
    }

    const repairedJob = repairExtractedJobTitle(job);
    jobsByKey.set(
      repairedJob.canonicalUrl,
      mergeJob(jobsByKey.get(repairedJob.canonicalUrl), repairedJob),
    );
  }

  for (const candidate of (input.cardCandidates ?? []).slice(
    0,
    targetCardCandidateBudget,
  )) {
    const job = buildJobFromCardCandidate(
      candidate,
      input.pageUrl,
      learnedEvidence,
    );
    if (
      !job ||
      isListingIndexPageRecord({
        canonicalUrl: job.canonicalUrl,
        pageUrl: input.pageUrl,
        siblingDetailUrlCount,
        description: job.description,
        title: job.title,
      })
    ) {
      continue;
    }

    const mergeKey = buildSearchResultCardMergeKey({
      pageUrl: input.pageUrl,
      candidate,
      canonicalUrl: job.canonicalUrl,
      evidence: learnedEvidence,
    });

    jobsByKey.set(
      mergeKey,
      mergeJob(jobsByKey.get(mergeKey), repairExtractedJobTitle(job)),
    );
    cardSurfaceScoreByMergeKey.set(
      mergeKey,
      Math.max(
        cardSurfaceScoreByMergeKey.get(mergeKey) ?? Number.NEGATIVE_INFINITY,
        scoreSearchResultCardSurfaceQuality(candidate),
      ),
    );
  }

  const rankedJobs = [...jobsByKey.entries()]
    .flatMap(([mergeKey, job], index) => {
      if (!isCompleteJob(job, learnedEvidence)) {
        return [];
      }

      const preferenceScore = scoreJobForPreferences(
        job,
        input.searchPreferences,
      );
      const surfaceScore = isSearchSurface
        ? (cardSurfaceScoreByMergeKey.get(mergeKey) ?? 0) *
          SEARCH_SURFACE_SCORE_WEIGHT
        : (cardSurfaceScoreByMergeKey.get(mergeKey) ?? 0);

      return [
        {
          job,
          index,
          titleScore: scoreJobTitleForPreferences(job, input.searchPreferences),
          preferenceScore,
          surfaceScore,
        },
      ];
    })
    .sort((left, right) => {
      if (input.searchPreferences) {
        const titleScoreDelta = right.titleScore - left.titleScore;
        if (Math.abs(titleScoreDelta) >= SEARCH_TITLE_DOMINANCE_THRESHOLD) {
          return titleScoreDelta;
        }
      }

      const combinedScoreDelta =
        right.preferenceScore +
        right.surfaceScore -
        (left.preferenceScore + left.surfaceScore);
      if (combinedScoreDelta !== 0) {
        return combinedScoreDelta;
      }

      const surfaceScoreDelta = right.surfaceScore - left.surfaceScore;
      if (surfaceScoreDelta !== 0) {
        return surfaceScoreDelta;
      }

      const preferenceScoreDelta = right.preferenceScore - left.preferenceScore;
      if (preferenceScoreDelta !== 0) {
        return preferenceScoreDelta;
      }

      return left.index - right.index;
    });

  return (
    rankedJobs
      // A merged record carries both halves of the evidence — one extractor's
      // painted title and another's full summary — so the repair runs once
      // more on the merge result.
      .map((entry) => repairExtractedJobTitle(entry.job))
      .slice(0, Math.max(0, input.maxJobs))
  );
}

export function shouldCanonicalizeSearchSurfaceDetailRoute(input: {
  candidate: SearchResultCardCandidate;
  pageUrl: string;
  evidence: LearnedSearchSurfaceRouteEvidence;
}): boolean {
  const sourceJobIdHint = canonicalizeNumericJobIdHint(
    input.candidate.sourceJobIdHint,
  );
  if (sourceJobIdHint) {
    const parsed =
      parseHttpUrl(cleanLine(input.candidate.canonicalUrl), input.pageUrl) ??
      parseHttpUrl(input.pageUrl);
    return (
      parsed !== null &&
      input.evidence.detailTemplatesByOrigin.has(parsed.origin)
    );
  }

  const candidateUrl = cleanLine(input.candidate.canonicalUrl);
  if (!candidateUrl) {
    return false;
  }

  return (
    buildLearnedDetailUrlFromHint({
      url: candidateUrl,
      pageUrl: input.pageUrl,
      searchableText: [
        input.candidate.anchorText,
        input.candidate.headingText,
        ...input.candidate.lines,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
      evidence: input.evidence,
    }) !== null
  );
}
