import { normalizeSignal } from "./control-classification";

/**
 * Which country a work-authorization question is about, and whether the
 * countries the person said they can work in cover it.
 *
 * "Are you legally authorized to work in the United States?" has one true
 * answer per person, and a saved list of countries only answers it when the
 * list and the question are about the same place. Anything this cannot tell
 * for certain goes back to the person.
 */

const EU_MEMBERS = [
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czechia",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
] as const;

const EEA_ONLY_MEMBERS = ["Iceland", "Liechtenstein", "Norway"] as const;

export const EUROPEAN_UNION = "European Union";
export const EUROPEAN_ECONOMIC_AREA = "European Economic Area";

const EEA_MEMBERS: ReadonlySet<string> = new Set([
  ...EU_MEMBERS,
  ...EEA_ONLY_MEMBERS,
]);

const OTHER_COUNTRIES = [
  "Albania",
  "Argentina",
  "Australia",
  "Bangladesh",
  "Bosnia and Herzegovina",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Egypt",
  "Hong Kong",
  "India",
  "Indonesia",
  "Israel",
  "Japan",
  "Kenya",
  "Kosovo",
  "Malaysia",
  "Mexico",
  "Moldova",
  "Montenegro",
  "Morocco",
  "New Zealand",
  "Nigeria",
  "North Macedonia",
  "Pakistan",
  "Philippines",
  "Qatar",
  "Saudi Arabia",
  "Serbia",
  "Singapore",
  "South Africa",
  "South Korea",
  "Switzerland",
  "Thailand",
  "Turkey",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Vietnam",
] as const;

/**
 * Places whose people may work in each other's countries without a visa for
 * some but not all residents. Being able to work in one member says nothing
 * certain about another: a citizen can, a visa holder cannot.
 */
const FREE_MOVEMENT_GROUPS: readonly ReadonlySet<string>[] = [
  new Set([
    ...EEA_MEMBERS,
    EUROPEAN_UNION,
    EUROPEAN_ECONOMIC_AREA,
    "Switzerland",
  ]),
  new Set(["United Kingdom", "Ireland"]),
  new Set(["Australia", "New Zealand"]),
];

/** Lower-case names, matched as whole words in normalized text. */
const NAMED_PLACES: ReadonlyMap<string, string> = new Map<string, string>([
  ...[...EU_MEMBERS, ...EEA_ONLY_MEMBERS, ...OTHER_COUNTRIES].map(
    (country) => [normalizeSignal(country), country] as const,
  ),
  ["european union", EUROPEAN_UNION],
  ["european economic area", EUROPEAN_ECONOMIC_AREA],
  ["united states of america", "United States"],
  ["czech republic", "Czechia"],
  ["the netherlands", "Netherlands"],
  ["holland", "Netherlands"],
  ["republic of ireland", "Ireland"],
  ["great britain", "United Kingdom"],
  ["britain", "United Kingdom"],
  ["england", "United Kingdom"],
  ["scotland", "United Kingdom"],
  ["wales", "United Kingdom"],
  ["northern ireland", "United Kingdom"],
  ["new south wales", "Australia"],
  ["korea", "South Korea"],
  ["turkiye", "Turkey"],
  // Regions that name their country. Georgia is left out: it is a country
  // too.
  ...[
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "District of Columbia",
    "Florida",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
  ].map((state) => [normalizeSignal(state), "United States"] as const),
  ...[
    "Alberta",
    "British Columbia",
    "Manitoba",
    "New Brunswick",
    "Newfoundland",
    "Nova Scotia",
    "Ontario",
    "Quebec",
    "Saskatchewan",
  ].map((province) => [normalizeSignal(province), "Canada"] as const),
]);

const NAMED_PLACE_PATTERN = new RegExp(
  `\\b(?:${[...NAMED_PLACES.keys()]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/ /gu, "\\s+"))
    .join("|")})\\b`,
  "gu",
);

/**
 * Abbreviations only count in capitals: "work for us" is not the United
 * States.
 */
const ABBREVIATIONS: readonly (readonly [RegExp, string])[] = [
  [/(?<![A-Za-z])U\.?S\.?A\.?(?![A-Za-z])/gu, "United States"],
  [/(?<![A-Za-z])U\.?S\.?(?![A-Za-z])/gu, "United States"],
  [/(?<![A-Za-z])U\.?K\.?(?![A-Za-z])/gu, "United Kingdom"],
  [/(?<![A-Za-z])E\.?U\.?(?![A-Za-z])/gu, EUROPEAN_UNION],
  [/(?<![A-Za-z])EEA(?![A-Za-z])/gu, EUROPEAN_ECONOMIC_AREA],
  [/(?<![A-Za-z])UAE(?![A-Za-z])/gu, "United Arab Emirates"],
];

/** Countries (and the EU or EEA) a piece of text names, in canonical form. */
export function namedWorkCountries(text: string): string[] {
  const found = new Set<string>();
  for (const [pattern, country] of ABBREVIATIONS) {
    if (new RegExp(pattern.source, pattern.flags).test(text)) {
      found.add(country);
    }
  }
  for (const match of normalizeSignal(text).matchAll(NAMED_PLACE_PATTERN)) {
    const country = NAMED_PLACES.get(match[0].replace(/\s+/gu, " "));
    if (country) {
      found.add(country);
    }
  }
  return [...found];
}

/** One saved entry ("Germany", "us", "EU citizen"), or null when unknown. */
function canonicalSavedCountry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  const byAlias = NAMED_PLACES.get(normalizeSignal(trimmed));
  if (byAlias) {
    return byAlias;
  }
  const upper = trimmed.toUpperCase().replace(/\./gu, "");
  const named = namedWorkCountries(
    upper === "US" || upper === "USA" || upper === "UK" || upper === "EU"
      ? upper
      : trimmed,
  );
  return named.length === 1 ? (named[0] ?? null) : null;
}

function isRegion(place: string): boolean {
  return place === EUROPEAN_UNION || place === EUROPEAN_ECONOMIC_AREA;
}

type Coverage = "covered" | "not_covered" | "unknown";

function coverage(saved: string | null, asked: string): Coverage {
  if (saved === null) {
    return "unknown";
  }
  if (saved === asked) {
    return "covered";
  }
  if (isRegion(saved) && (EEA_MEMBERS.has(asked) || isRegion(asked))) {
    return "covered";
  }
  const sharesFreeMovement = FREE_MOVEMENT_GROUPS.some(
    (group) => group.has(saved) && group.has(asked),
  );
  return sharesFreeMovement ? "unknown" : "not_covered";
}

export type WorkCountryVerdict =
  | { kind: "covered"; country: string }
  | { kind: "not_covered"; country: string }
  | { kind: "unknown"; reason: string };

/**
 * Whether the saved countries cover the country this question is about.
 *
 * The question's own words win; otherwise the posting's location decides.
 * When neither names a country, or the answer depends on something the
 * profile does not say (a visa versus a citizenship inside the EU), the
 * verdict is unknown and the question goes back to the person.
 */
export function judgeWorkCountry(input: {
  questionText: string;
  postingLocation: string;
  authorizedWorkCountries: readonly string[];
}): WorkCountryVerdict {
  const fromQuestion = namedWorkCountries(input.questionText);
  const asked =
    fromQuestion.length > 0
      ? fromQuestion
      : namedWorkCountries(input.postingLocation);
  const listed = input.authorizedWorkCountries
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (asked.length === 0) {
    return {
      kind: "unknown",
      reason: `This asks whether you can work in the job's country, and neither the question nor the posting says which country it is. Your profile says you can work in ${listed.join(", ")}.`,
    };
  }
  const saved = listed.map(canonicalSavedCountry);
  const verdicts = asked.map((country) => {
    const perEntry = saved.map((entry) => coverage(entry, country));
    const result: Coverage = perEntry.includes("covered")
      ? "covered"
      : perEntry.includes("unknown")
        ? "unknown"
        : "not_covered";
    return { country, result };
  });
  const askedLabel = asked.join(" and ");
  if (verdicts.every((verdict) => verdict.result === "covered")) {
    return { kind: "covered", country: askedLabel };
  }
  if (verdicts.every((verdict) => verdict.result === "not_covered")) {
    return { kind: "not_covered", country: askedLabel };
  }
  return {
    kind: "unknown",
    reason: `This asks whether you can work in ${askedLabel}. Your profile says you can work in ${listed.join(", ")}, which does not settle it.`,
  };
}
