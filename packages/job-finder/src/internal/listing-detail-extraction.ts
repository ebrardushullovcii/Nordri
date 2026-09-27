/**
 * Reads the body of a job listing out of its own page HTML, without a browser.
 *
 * Source-generic on purpose (ADR 0007): the reader knows schema.org, Open
 * Graph, and ordinary HTML, never a board. Most job pages carry a full
 * `JobPosting` record as JSON-LD in the initial HTML because search engines
 * require it; that record is the same data a card-only scan never saw
 * (description, pay, location, posting date). When a page has no record, the
 * reader falls back to the visible text of the page and says so.
 */

/**
 * Whether a link's text reads as the one that starts an application.
 *
 * This is discovery, not the apply harness: it records a likely apply URL from
 * a listing's HTML before any run begins, so a later run has somewhere to
 * start. Nothing here gates what the harness may click — the harness reads the
 * page itself and decides (ADR 0021).
 */
const APPLY_ENTRY_PHRASES: readonly string[] = [
  "apply",
  "apply now",
  "apply here",
  "apply today",
  "apply for this job",
  "apply for this role",
  "apply for this position",
  "apply to this job",
  "easy apply",
  "quick apply",
  "one click apply",
  "apply on company site",
  "apply on company website",
  "apply on employer site",
  "apply externally",
  "apply with your resume",
  "apply for job",
  "start your application",
  "start application",
  "begin application",
  "i m interested",
  "im interested",
  "i am interested",
  "view job and apply",
  "see job and apply",
];

const NOT_AN_ENTRY_PHRASES: readonly string[] = [
  "apply filter",
  "apply filters",
  "apply changes",
  "applied",
  "how to apply",
  "jobs you applied",
  "why apply",
  "apply for other",
  "apply to other",
  "similar jobs",
  "back to",
  "apply for a different",
];

function normalizeApplyEntrySignal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function looksLikeApplyEntryText(text: string): boolean {
  const signal = normalizeApplyEntrySignal(text);
  if (!signal || signal.length > 60) {
    return false;
  }
  if (NOT_AN_ENTRY_PHRASES.some((phrase) => signal.includes(phrase))) {
    return false;
  }
  return APPLY_ENTRY_PHRASES.some((phrase) => signal.includes(phrase));
}

const MAX_HTML_LENGTH = 1_500_000;
const MAX_DESCRIPTION_LENGTH = 24_000;
const MAX_PAGE_TEXT_LENGTH = 12_000;
// Some real small-company listings are concise. The compact allowance below
// is used only when the page names the exact card title and carries listing
// cue words; otherwise the original 120-word floor still applies.
const MIN_PAGE_TEXT_WORDS = 50;
const MIN_WEAKLY_IDENTIFIED_PAGE_TEXT_WORDS = 120;
const MAX_JSON_LD_NODES = 200;

export type ListingDetailExtractionMethod = "json_ld" | "page_text";

export interface ExtractedListingDetail {
  method: ListingDetailExtractionMethod;
  title: string | null;
  company: string | null;
  location: string | null;
  /** Plain text with paragraphs separated by blank lines and "• " bullets. */
  description: string;
  /** Length before this reader's safety cap was applied. */
  descriptionSourceLength?: number;
  /** The captured text ended at a cap or in a likely word fragment. */
  descriptionLikelyTruncated?: boolean;
  salaryText: string | null;
  employmentType: string | null;
  /** ISO timestamp when the record carried a parseable posting date. */
  postedAt: string | null;
  validThrough: string | null;
  workModeHints: string[];
  directApplyUrl: string | null;
}

const LIKELY_MID_WORD_ENDING_PATTERN =
  /\b(?:th|thi|wit|fro|ac|acr|bec|req|qual|responsibilit|experienc|developm|engineer)\s*$/iu;

function isLikelyTruncatedDescription(
  description: string,
  sourceLength: number,
): boolean {
  return (
    description.length < sourceLength ||
    LIKELY_MID_WORD_ENDING_PATTERN.test(description.trimEnd())
  );
}

export interface ExtractListingDetailInput {
  html: string;
  url: string;
  /** The title the card carried; used to pick among several records. */
  expectedTitle?: string | null;
}

/**
 * Extracts the listing body from page HTML. Returns null when the page has
 * neither a JobPosting record nor enough readable text to stand in for one.
 */
export function extractListingDetailFromHtml(
  input: ExtractListingDetailInput,
): ExtractedListingDetail | null {
  const html =
    input.html.length > MAX_HTML_LENGTH
      ? input.html.slice(0, MAX_HTML_LENGTH)
      : input.html;

  const structured = extractJobPostingFromJsonLd(html, input);
  if (structured) {
    return structured;
  }

  return extractListingDetailFromPageText(html, input);
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptPattern =
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/giu;
  for (const match of html.matchAll(scriptPattern)) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const parsed = parseLenientJson(raw);
    if (parsed !== undefined) {
      blocks.push(parsed);
    }
  }
  return blocks;
}

function parseLenientJson(raw: string): unknown {
  // Some pages wrap the payload in an HTML comment or leave a trailing comma;
  // strip the common wrappers before giving up on the block.
  const candidates = [
    raw,
    raw.replace(/^<!--/u, "").replace(/-->$/u, "").trim(),
    raw.replace(/,\s*([}\]])/gu, "$1"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

function hasType(node: JsonRecord, typeName: string): boolean {
  const type = node["@type"];
  if (typeof type === "string") {
    return type.toLowerCase() === typeName.toLowerCase();
  }
  if (Array.isArray(type)) {
    return type.some(
      (entry) =>
        typeof entry === "string" &&
        entry.toLowerCase() === typeName.toLowerCase(),
    );
  }
  return false;
}

function collectJobPostingNodes(blocks: readonly unknown[]): JsonRecord[] {
  const found: JsonRecord[] = [];
  const queue: unknown[] = [...blocks];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_JSON_LD_NODES) {
    const node = queue.shift();
    visited += 1;
    if (Array.isArray(node)) {
      queue.push(...(node as unknown[]));
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    if (hasType(node, "JobPosting")) {
      found.push(node);
      continue;
    }
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
      const child = node[key];
      if (child !== undefined) {
        queue.push(child);
      }
    }
  }
  return found;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = collapseWhitespace(decodeHtmlEntities(value));
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (isRecord(value)) {
    return readString(value.name ?? value["@value"] ?? value.text ?? null);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const read = readString(entry);
      if (read) {
        return read;
      }
    }
  }
  return null;
}

function readOrganizationName(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = readOrganizationName(entry);
      if (name) {
        return name;
      }
    }
    return null;
  }
  if (isRecord(value)) {
    return readString(value.name ?? value.legalName ?? null);
  }
  return readString(value);
}

function readLocation(node: JsonRecord): {
  location: string | null;
  workModeHints: string[];
} {
  const hints: string[] = [];
  const locationType = readString(node.jobLocationType);
  if (locationType && /telecommute|remote/iu.test(locationType)) {
    hints.push("remote");
  }

  const places: string[] = [];
  const jobLocation = node.jobLocation;
  const entries = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      const plain = readString(entry);
      if (plain) {
        places.push(plain);
      }
      continue;
    }
    const address = isRecord(entry.address) ? entry.address : entry;
    const parts = [
      readString(address.addressLocality),
      readString(address.addressRegion),
      readString(address.addressCountry),
    ].filter((part): part is string => Boolean(part));
    const label = parts.length > 0 ? parts.join(", ") : readString(entry.name);
    if (label) {
      places.push(label);
    }
  }

  if (places.length === 0 && hints.includes("remote")) {
    const requirement = node.applicantLocationRequirements;
    const requirementEntries = Array.isArray(requirement)
      ? requirement
      : [requirement];
    const regions = requirementEntries
      .map((entry) => readString(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (regions.length > 0) {
      places.push(`Remote (${regions.slice(0, 3).join(", ")})`);
    } else {
      places.push("Remote");
    }
  }

  // "Austin, Texas, United States" already says "United States": a broader
  // place that is contained in a more specific one adds nothing.
  const unique = [...new Set(places)].filter(
    (place, _index, all) =>
      !all.some(
        (other) =>
          other !== place && other.toLowerCase().includes(place.toLowerCase()),
      ),
  );
  return {
    location: unique.length > 0 ? unique.slice(0, 3).join(" · ") : null,
    workModeHints: hints,
  };
}

function formatAmount(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function readSalary(node: JsonRecord): string | null {
  const salary = node.baseSalary ?? node.estimatedSalary;
  const entry: unknown = Array.isArray(salary)
    ? (salary as unknown[])[0]
    : salary;
  if (!isRecord(entry)) {
    return readString(entry);
  }
  const currency = readString(entry.currency) ?? "";
  const value = isRecord(entry.value) ? entry.value : entry;
  const toNumber = (candidate: unknown): number | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate.replace(/[^0-9.]/gu, ""));
      return Number.isFinite(parsed) && candidate.trim() !== "" ? parsed : null;
    }
    return null;
  };
  const min = toNumber(value.minValue);
  const max = toNumber(value.maxValue);
  const single = toNumber(value.value);
  const unit = readString(value.unitText);
  const unitLabel = unit
    ? ({ HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" }[
        unit.toUpperCase()
      ] ?? unit.toLowerCase())
    : null;

  let range: string | null = null;
  if (min !== null && max !== null && max !== min) {
    range = `${formatAmount(min)} – ${formatAmount(max)}`;
  } else if (min !== null || max !== null || single !== null) {
    range = formatAmount((single ?? min ?? max) as number);
  }
  if (!range) {
    return null;
  }
  return `${currency ? `${currency} ` : ""}${range}${unitLabel ? ` / ${unitLabel}` : ""}`;
}

function readIsoDate(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function readEmploymentType(value: unknown): string | null {
  const raw = Array.isArray(value)
    ? value
        .map((entry) => readString(entry))
        .filter(Boolean)
        .join(", ")
    : readString(value);
  if (!raw) {
    return null;
  }
  return raw
    .split(/\s*,\s*/u)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/_/gu, "-")
        .replace(/\b([a-z])/gu, (match) => match.toUpperCase()),
    )
    .join(", ");
}

function readDirectApplyUrl(node: JsonRecord): string | null {
  const url = readString(node.url) ?? null;
  const directApply = node.directApply;
  return directApply === true && url ? url : null;
}

const ANCHOR_PATTERN = /<a\b([^>]*?)>([\s\S]*?)<\/a\s*>/giu;
const HREF_PATTERN = /\bhref\s*=\s*["']([^"']+)["']/iu;
const ARIA_LABEL_PATTERN = /\baria-label\s*=\s*["']([^"']+)["']/iu;

/**
 * The plain apply link on a listing page, when the page has one.
 *
 * Most listings put the way in behind an ordinary anchor whose text says so.
 * Reading it here means the run starts on the employer's form rather than on
 * the listing. It is the same reading of the words the apply run does, so the
 * rule lives in one place. Best-effort by design: a page that builds its apply
 * control in script has none of this in its HTML, and the run walks the page
 * itself instead.
 */
export function findApplyLinkInHtml(
  html: string,
  baseUrl: string,
): string | null {
  ANCHOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_PATTERN.exec(html)) !== null) {
    const attributes = match[1] ?? "";
    const href = HREF_PATTERN.exec(attributes)?.[1];
    if (!href) {
      continue;
    }
    const text = collapseWhitespace(htmlToPlainText(match[2] ?? ""));
    const label =
      text ||
      collapseWhitespace(
        decodeHtmlEntities(ARIA_LABEL_PATTERN.exec(attributes)?.[1] ?? ""),
      );
    if (!looksLikeApplyEntryText(label)) {
      continue;
    }
    try {
      const resolved = new URL(decodeHtmlEntities(href), baseUrl);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
        continue;
      }
      if (resolved.toString() === baseUrl) {
        continue;
      }
      return resolved.toString();
    } catch {
      continue;
    }
  }
  return null;
}

function scoreTitleMatch(
  candidate: string | null,
  expected: string | null | undefined,
): number {
  if (!candidate || !expected) {
    return 0;
  }
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, " ")
      .trim();
  const left = normalize(candidate);
  const right = normalize(expected);
  if (left === right) {
    return 3;
  }
  if (left.includes(right) || right.includes(left)) {
    return 2;
  }
  const leftTokens = new Set(left.split(" "));
  const shared = right.split(" ").filter((token) => leftTokens.has(token));
  return shared.length >= 2 ? 1 : 0;
}

function extractJobPostingFromJsonLd(
  html: string,
  input: ExtractListingDetailInput,
): ExtractedListingDetail | null {
  const nodes = collectJobPostingNodes(readJsonLdBlocks(html));
  if (nodes.length === 0) {
    return null;
  }

  const ranked = nodes
    .map((node) => ({
      node,
      score: scoreTitleMatch(readString(node.title), input.expectedTitle),
      descriptionLength: (readString(node.description) ?? "").length,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.descriptionLength - left.descriptionLength,
    );
  const node = ranked[0]?.node;
  if (!node) {
    return null;
  }

  const descriptionHtml =
    typeof node.description === "string" ? node.description : "";
  const fullDescription = htmlToPlainText(descriptionHtml);
  const description = truncateText(fullDescription, MAX_DESCRIPTION_LENGTH);
  if (!description) {
    return null;
  }

  const { location, workModeHints } = readLocation(node);
  const combinedHints = [
    ...workModeHints,
    ...detectWorkModeHints(`${readString(node.title) ?? ""} ${description}`),
  ];

  return {
    method: "json_ld",
    title: readString(node.title),
    company: readOrganizationName(node.hiringOrganization),
    location,
    description,
    descriptionSourceLength: fullDescription.length,
    descriptionLikelyTruncated: isLikelyTruncatedDescription(
      description,
      fullDescription.length,
    ),
    salaryText: readSalary(node),
    employmentType: readEmploymentType(node.employmentType),
    postedAt: readIsoDate(node.datePosted),
    validThrough: readIsoDate(node.validThrough),
    workModeHints: [...new Set(combinedHints)],
    directApplyUrl:
      readDirectApplyUrl(node) ?? findApplyLinkInHtml(html, input.url),
  };
}

// ---------------------------------------------------------------------------
// Page text fallback
// ---------------------------------------------------------------------------

function readMetaContent(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const patterns = [
    new RegExp(
      `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "iu",
    ),
    new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["']`,
      "iu",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = collapseWhitespace(decodeHtmlEntities(match[1]));
      if (value) {
        return value;
      }
    }
  }
  return null;
}

const LISTING_BODY_SIGNAL =
  /\b(responsibilit|requirement|qualification|what you.ll do|what you will do|about (?:the|this) role|about you|who you are|experience|skills|benefits|compensation|salary)\b/iu;

/**
 * Pages without `<main>`/`<article>` landmarks put the site's menus ahead of
 * the posting. When the card's title appears as its own line, the body starts
 * there; everything before it is chrome (menu items, account links, language
 * switches) that would otherwise lead the description.
 */
function trimLeadingChromeBeforeTitle(
  text: string,
  expectedTitle: string | null | undefined,
): string {
  if (!expectedTitle) {
    return text;
  }
  const lines = text.split("\n");
  const titleLineIndex = lines.findIndex((line) =>
    lineNamesTitle(line, expectedTitle),
  );
  // Only trim when the title sits past a stretch of short lines: a body that
  // already starts with the posting stays as it is.
  if (titleLineIndex < 3) {
    return text;
  }
  const preceding = lines
    .slice(0, titleLineIndex)
    .filter((line) => line.trim());
  const shortShare =
    preceding.filter((line) => line.trim().split(/\s+/u).length <= 4).length /
    Math.max(1, preceding.length);
  return shortShare >= 0.7 ? lines.slice(titleLineIndex).join("\n") : text;
}

/**
 * Whether one line of page text is the card's title: the same words, or the
 * title with a suffix such as "(Remote)". A short menu item that happens to
 * be a substring of the title ("EN", "IT") is not.
 */
function lineNamesTitle(
  line: string,
  expectedTitle: string | null | undefined,
): boolean {
  if (!expectedTitle) {
    return false;
  }
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u00c0-\u024f]+/gu, " ")
      .trim();
  const candidate = normalize(line);
  const title = normalize(expectedTitle);
  if (!candidate || !title || candidate.length > 160) {
    return false;
  }
  if (candidate === title || candidate.includes(title)) {
    return true;
  }
  // The card may carry a suffix the page drops ("Zhvillues Softueri / IT"
  // on the card, "Zhvillues Softueri" as the heading).
  return title.includes(candidate) && candidate.length >= title.length * 0.6;
}

/** Enough body to stand in for a posting when it carries no English cue words. */
const MIN_UNCUED_PAGE_TEXT_WORDS = 200;

function extractListingDetailFromPageText(
  html: string,
  input: ExtractListingDetailInput,
): ExtractedListingDetail | null {
  const bodyHtml = startAtTitleHeading(
    selectMainContentHtml(html),
    input.expectedTitle,
  );
  const fullText = trimLeadingChromeBeforeTitle(
    htmlToPlainText(bodyHtml),
    input.expectedTitle,
  );
  const text = truncateText(fullText, MAX_PAGE_TEXT_LENGTH);
  const wordCount = text.split(/\s+/u).filter(Boolean).length;
  if (wordCount < MIN_PAGE_TEXT_WORDS) {
    return null;
  }
  // The cue words are English. A posting in another language still reads as
  // the listing when it is long enough and names the job the card promised.
  const titleNamed =
    Boolean(input.expectedTitle) &&
    text.split("\n").some((line) => lineNamesTitle(line, input.expectedTitle));
  if (!titleNamed && wordCount < MIN_WEAKLY_IDENTIFIED_PAGE_TEXT_WORDS) {
    return null;
  }
  if (
    !LISTING_BODY_SIGNAL.test(text) &&
    !(titleNamed && wordCount >= MIN_UNCUED_PAGE_TEXT_WORDS)
  ) {
    return null;
  }

  const title =
    readMetaContent(html, "og:title") ??
    (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]
      ? collapseWhitespace(
          decodeHtmlEntities(
            html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "",
          ),
        )
      : null);

  return {
    method: "page_text",
    title:
      title && scoreTitleMatch(title, input.expectedTitle) > 0 ? title : null,
    company: null,
    location: null,
    description: text,
    descriptionSourceLength: fullText.length,
    descriptionLikelyTruncated: isLikelyTruncatedDescription(
      text,
      fullText.length,
    ),
    salaryText: null,
    employmentType: null,
    postedAt: null,
    validThrough: null,
    workModeHints: detectWorkModeHints(text),
    directApplyUrl: findApplyLinkInHtml(html, input.url),
  };
}

/**
 * A page whose main content heads the posting with an `<h1>` naming the job
 * starts the listing there. What sits above that heading inside the content
 * (a banner, breadcrumbs, a "Company · Place · Posted" line) is page chrome;
 * those facts are read into their own fields, not the listing text.
 */
function startAtTitleHeading(
  contentHtml: string,
  expectedTitle: string | null | undefined,
): string {
  if (!expectedTitle) {
    return contentHtml;
  }
  const heading = contentHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/iu);
  if (!heading || heading.index === undefined || heading.index === 0) {
    return contentHtml;
  }
  const headingText = collapseWhitespace(
    decodeHtmlEntities(heading[1]?.replace(/<[^>]+>/gu, " ") ?? ""),
  );
  return lineNamesTitle(headingText, expectedTitle)
    ? contentHtml.slice(heading.index)
    : contentHtml;
}

function selectMainContentHtml(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/giu, " ")
    .replace(
      /<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)\s*>/giu,
      " ",
    );
  for (const tag of ["main", "article"]) {
    const match = stripped.match(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "iu"),
    );
    if (match?.[1] && match[1].length > 400) {
      return match[1];
    }
  }
  const body = stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/iu);
  return body?.[1] ?? stripped;
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  agrave: "à",
  ccedil: "ç",
  ntilde: "ñ",
  aring: "å",
  oslash: "ø",
  szlig: "ß",
  laquo: "«",
  raquo: "»",
  sbquo: "‚",
  bdquo: "„",
  dagger: "†",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  shy: "",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
};

// Emoji and pictographs a board prints inside a scraped field: a colour
// location pin before the place, a sparkle before the role, a flag beside a
// country. Only symbol and pictograph code points are listed — no letter of
// any script falls in these ranges, so a Cyrillic, Arabic, Greek or CJK name
// passes through untouched.
const PICTOGRAPH_GLYPH_PATTERN =
  // Written as alternatives rather than one class: variation selectors, the
  // zero-width joiner and the keycap mark are combining characters, and a
  // character class mixing them with base characters is misleading.
  /[\u{1F000}-\u{1FAFF}]|[\u2600-\u27BF]|[\u2B00-\u2BFF]|[\u203C\u2049\u2122\u2139\u2934\u2935\u3030\u303D\u3297\u3299]|\uFE0E|\uFE0F|\u200D|\u20E3/gu;

/**
 * Removes emoji and pictographs from a short scraped field and settles the
 * space they leave, so a colour location pin never reaches the company line.
 * Letters are never removed: only symbol and pictograph ranges are listed.
 */
export function stripPictographGlyphs<T extends string | null | undefined>(
  value: T,
): T {
  if (typeof value !== "string") return value;
  const stripped = value
    .replace(PICTOGRAPH_GLYPH_PATTERN, " ")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
  if (stripped === value) return value;
  // A field that was nothing but pictographs keeps its original text rather
  // than becoming empty.
  return (stripped.length > 0 ? stripped : value) as T;
}

// Structured-data descriptions arrive as HTML on some boards ("<strong>Job
// Title<br></strong>Regional Manager"). Stored text must be plain so every
// screen reads it the same way.
const HTML_MARKUP_PATTERN = /<\/?[a-z][^>]*>/i;

// Characters that carry no text: the replacement glyph a broken byte leaves
// behind (written out by some boards as the literal entity "&#65533;"), the
// two non-characters at the end of the BMP, and C0 controls other than tab and
// newline. Whatever they once were is already lost, so printing a black
// diamond in the middle of a job title only makes the loss visible.
// Control characters are exactly what this pattern exists to remove.
const UNDECODABLE_TEXT_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\uFFFD\uFFFE\uFFFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;

/**
 * Drops characters that decode to nothing and tidies the gap they leave: the
 * spaces either side collapse and a separator stranded at an edge comes off,
 * so "Sales Development Representative Attribut<U+FFFD>" reads as a title rather
 * than as a decoding accident.
 */
function dropUndecodableCharacters(value: string): string {
  return value
    .replace(UNDECODABLE_TEXT_PATTERN, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^[\s,;:•·|–—-]+/u, "")
    .replace(/[\s,;:•·|–—-]+$/u, "");
}

/**
 * The text to store for one listing field: markup stripped, HTML entities
 * decoded and undecodable characters dropped, so an employer written
 * "Rose, Klein &amp; Marias" is stored — and read back on every screen — as
 * "Rose, Klein & Marias", and no replacement glyph ever reaches a title.
 */
export function normalizeListingText<T extends string | null | undefined>(
  value: T,
): T {
  if (typeof value !== "string") return value;
  const decoded = HTML_MARKUP_PATTERN.test(value)
    ? htmlToPlainText(value)
    : decodeHtmlEntities(value);
  const normalized = dropUndecodableCharacters(decoded);
  // Required listing fields must stay non-empty: keep the original text rather
  // than normalizing a value away entirely.
  return (normalized.trim().length > 0 ? normalized : value) as T;
}

const ENTITY_PATTERN = /&(?:#x[0-9a-f]+|#\d+|[a-z]+);/iu;
// Three passes is enough for every double-encoding seen in practice
// ("&amp;amp;" → "&amp;" → "&") and keeps a hostile page from looping.
const MAX_ENTITY_DECODE_PASSES = 3;

function decodeHtmlEntitiesOnce(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      safeFromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      safeFromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/giu, (match, name: string) => {
      const replacement = NAMED_ENTITIES[name.toLowerCase()];
      return replacement ?? match;
    });
}

/**
 * Decodes HTML entities to a fixed point.
 *
 * A single pass left double-encoded text as an entity in the store, which is
 * how "Transportation Partners &amp;amp; Logistics" reached a company name and
 * was drawn on screen as "Transportation Partners &amp; Logistics". Decoding
 * repeats while the text still changes and still looks like an entity, so the
 * name is stored once, decoded, and every screen reading it shows the same
 * thing.
 */
export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < MAX_ENTITY_DECODE_PASSES; pass += 1) {
    if (!ENTITY_PATTERN.test(decoded)) {
      return decoded;
    }
    const next = decodeHtmlEntitiesOnce(decoded);
    if (next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
}

function safeFromCodePoint(codePoint: number): string {
  // 0xFFFD is the replacement glyph: a board writing "&#65533;" is telling us
  // the character was already lost, so decoding it back into a black diamond
  // only prints the loss into a job title.
  if (!Number.isFinite(codePoint) || codePoint === 0xfffd) {
    return "";
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

/**
 * Converts listing HTML into readable plain text: block elements become line
 * breaks, list items become bullets, everything else is stripped. The result
 * keeps the paragraph rhythm the scorer's requirement detection relies on.
 */
export function htmlToPlainText(html: string): string {
  if (!html) {
    return "";
  }
  // A description that is already plain text (no tags) still needs entities
  // decoded and whitespace settled; the same pipeline handles both.
  const withBreaks = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<\s*br\s*\/?>/giu, "\n")
    .replace(/<\s*li\b[^>]*>/giu, "\n• ")
    .replace(
      /<\s*\/\s*(?:p|div|li|ul|ol|h[1-6]|tr|section|article|blockquote|dd|dt)\s*>/giu,
      "\n\n",
    )
    .replace(
      /<\s*(?:p|div|h[1-6]|tr|section|article|blockquote|dd|dt)\b[^>]*>/giu,
      "\n",
    )
    .replace(/<\s*t[dh]\b[^>]*>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
  const decoded = decodeHtmlEntities(withBreaks);
  return decoded
    .replace(/\u00a0/gu, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const cut = value.slice(0, maxLength);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${cut.slice(0, lastBreak > maxLength * 0.6 ? lastBreak : maxLength).trimEnd()}…`;
}

function detectWorkModeHints(text: string): string[] {
  const normalized = text.toLowerCase();
  const hints: string[] = [];
  if (/\bremote\b|work\s+from\s+home/u.test(normalized)) {
    hints.push("remote");
  }
  if (/\bhybrid\b/u.test(normalized)) {
    hints.push("hybrid");
  }
  if (/\bon[- ]?site\b|\bin[- ]office\b|\bin\s+office\b/u.test(normalized)) {
    hints.push("onsite");
  }
  return hints;
}
