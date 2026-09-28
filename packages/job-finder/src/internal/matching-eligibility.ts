import type {
  CandidateProfile,
  JobRequirementAssessment,
  ResumeRequirementEvidence,
} from "@nordri/contracts";

import { inferAdministrativeAreaCountry } from "./location-normalization";
import type { MatchAssessmentPostingInput } from "./match-assessment-posting-input";
import { normalizeText, uniqueStrings } from "./shared";

type EligibilityState = "supported" | "unknown" | "conflict";
type ResidenceRegion =
  | "eu"
  | "europe_non_eu"
  | "middle_east"
  | "africa"
  | "north_america"
  | "latin_america"
  | "apac";
type GeographyToken =
  | "worldwide"
  | "emea"
  | "europe"
  | "eu"
  | "middle_east"
  | "africa"
  | "americas"
  | "north_america"
  | "latin_america"
  | "apac"
  | `country:${string}`;

type RegionGeographyToken = Exclude<
  GeographyToken,
  `country:${string}` | "worldwide"
>;
type CountryDefinition = {
  id: string;
  label: string;
  aliases: readonly string[];
  region: ResidenceRegion;
};

function defineCountry(
  label: string,
  region: ResidenceRegion,
  aliases: readonly string[] = [],
): CountryDefinition {
  return {
    id: normalizeText(label).replaceAll(" ", "_"),
    label,
    aliases: uniqueStrings([label, ...aliases]).map(normalizeText),
    region,
  };
}

const countryDefinitions: readonly CountryDefinition[] = [
  defineCountry("Austria", "eu"),
  defineCountry("Belgium", "eu"),
  defineCountry("Bulgaria", "eu"),
  defineCountry("Croatia", "eu"),
  defineCountry("Cyprus", "eu"),
  defineCountry("Czechia", "eu", ["Czech Republic"]),
  defineCountry("Denmark", "eu"),
  defineCountry("Estonia", "eu"),
  defineCountry("Finland", "eu"),
  defineCountry("France", "eu"),
  defineCountry("Germany", "eu"),
  defineCountry("Greece", "eu"),
  defineCountry("Hungary", "eu"),
  defineCountry("Ireland", "eu"),
  defineCountry("Italy", "eu"),
  defineCountry("Latvia", "eu"),
  defineCountry("Lithuania", "eu"),
  defineCountry("Luxembourg", "eu"),
  defineCountry("Malta", "eu"),
  defineCountry("Netherlands", "eu", ["The Netherlands"]),
  defineCountry("Poland", "eu"),
  defineCountry("Portugal", "eu"),
  defineCountry("Romania", "eu"),
  defineCountry("Slovakia", "eu"),
  defineCountry("Slovenia", "eu"),
  defineCountry("Spain", "eu"),
  defineCountry("Sweden", "eu"),
  defineCountry("United Kingdom", "europe_non_eu", [
    "UK",
    "U.K.",
    "Great Britain",
  ]),
  defineCountry("Kosovo", "europe_non_eu"),
  defineCountry("Albania", "europe_non_eu"),
  defineCountry("Bosnia and Herzegovina", "europe_non_eu", ["Bosnia"]),
  defineCountry("Iceland", "europe_non_eu"),
  defineCountry("Moldova", "europe_non_eu"),
  defineCountry("Montenegro", "europe_non_eu"),
  defineCountry("North Macedonia", "europe_non_eu", ["Macedonia"]),
  defineCountry("Norway", "europe_non_eu"),
  defineCountry("Serbia", "europe_non_eu"),
  defineCountry("Switzerland", "europe_non_eu"),
  defineCountry("Ukraine", "europe_non_eu"),
  defineCountry("Turkey", "middle_east", ["Türkiye"]),
  defineCountry("United Arab Emirates", "middle_east", ["UAE"]),
  defineCountry("Israel", "middle_east"),
  defineCountry("Saudi Arabia", "middle_east"),
  defineCountry("Qatar", "middle_east"),
  defineCountry("Egypt", "africa"),
  defineCountry("Kenya", "africa"),
  defineCountry("Nigeria", "africa"),
  defineCountry("South Africa", "africa"),
  defineCountry("United States", "north_america", ["USA", "U.S.A.", "U.S."]),
  defineCountry("Canada", "north_america"),
  defineCountry("Mexico", "latin_america"),
  defineCountry("Argentina", "latin_america"),
  defineCountry("Brazil", "latin_america"),
  defineCountry("Chile", "latin_america"),
  defineCountry("Colombia", "latin_america"),
  defineCountry("Australia", "apac"),
  defineCountry("China", "apac"),
  defineCountry("India", "apac"),
  defineCountry("Japan", "apac"),
  defineCountry("New Zealand", "apac"),
  defineCountry("Singapore", "apac"),
  defineCountry("South Korea", "apac", ["Republic of Korea"]),
  defineCountry("Thailand", "apac"),
];

type Residence = {
  country: CountryDefinition | null;
  directCountryValues: string[];
  regionHint: RegionGeographyToken | null;
};

type ParsedGeography = {
  original: string;
  allowedText: string;
  tokens: GeographyToken[];
  hasUnparsedAlternative: boolean;
};

function hasNormalizedPhrase(value: string, phrase: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedValue || !normalizedPhrase) {
    return false;
  }

  return ` ${normalizedValue} `.includes(` ${normalizedPhrase} `);
}

function detectCountry(values: readonly string[]): CountryDefinition | null {
  return (
    countryDefinitions.find((country) =>
      values.some((value) =>
        country.aliases.some((alias) => hasNormalizedPhrase(value, alias)),
      ),
    ) ?? null
  );
}

function inferRegionHint(values: readonly string[]): GeographyToken | null {
  const normalized = normalizeText(values.join(" "));
  if (/\bemea\b|\beurope middle east (?:and )?africa\b/u.test(normalized)) {
    return "emea";
  }
  if (/\beuropean union\b|\beu\b/u.test(normalized)) {
    return "eu";
  }
  if (/\beurope\b/u.test(normalized)) {
    return "europe";
  }
  if (/\bmiddle east\b/u.test(normalized)) {
    return "middle_east";
  }
  if (/\bafrica\b/u.test(normalized)) {
    return "africa";
  }
  if (/\bapac\b|\basia pacific\b/u.test(normalized)) {
    return "apac";
  }
  if (/\blatam\b|\blatin america\b/u.test(normalized)) {
    return "latin_america";
  }
  if (/\bnorth america\b/u.test(normalized)) {
    return "north_america";
  }
  if (/\bamericas?\b/u.test(normalized)) {
    return "americas";
  }
  return null;
}

function getResidence(profile: CandidateProfile): Residence {
  const locationParts = (profile.currentLocation ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const explicitCountryValues = uniqueStrings([
    ...(profile.currentCountry ? [profile.currentCountry] : []),
    ...(locationParts.length > 1
      ? [locationParts[locationParts.length - 1]!]
      : []),
  ]).filter(
    (value) =>
      !/\b(?:set|select|unknown|not provided|not listed)\b/iu.test(value),
  );
  const explicitCountry = detectCountry(explicitCountryValues);
  const administrativeAreaCountry = explicitCountry
    ? null
    : inferAdministrativeAreaCountry([
        profile.currentRegion,
        locationParts.length > 1
          ? locationParts[locationParts.length - 1]
          : null,
      ]);
  const directCountryValues = uniqueStrings([
    ...explicitCountryValues,
    ...(administrativeAreaCountry ? [administrativeAreaCountry] : []),
  ]);
  const locationValues = uniqueStrings([
    ...directCountryValues,
    ...(profile.currentLocation ? [profile.currentLocation] : []),
    ...(profile.currentRegion ? [profile.currentRegion] : []),
  ]);

  return {
    country: explicitCountry ?? detectCountry(locationValues),
    directCountryValues,
    regionHint: inferRegionHint(locationValues) as RegionGeographyToken | null,
  };
}

function extractGeographyTokens(value: string): GeographyToken[] {
  const normalized = normalizeText(value);
  const tokens: GeographyToken[] = [];
  if (/\b(?:worldwide|global|anywhere)\b/u.test(normalized)) {
    tokens.push("worldwide");
  }
  if (/\bemea\b|\beurope middle east (?:and )?africa\b/u.test(normalized)) {
    tokens.push("emea");
  }
  if (/\beuropean union\b|\beu\b/u.test(normalized)) {
    tokens.push("eu");
  } else if (/\beurope\b/u.test(normalized)) {
    tokens.push("europe");
  }
  if (/\bmiddle east\b/u.test(normalized)) {
    tokens.push("middle_east");
  }
  if (/\bafrica\b/u.test(normalized)) {
    tokens.push("africa");
  }
  if (/\bapac\b|\basia pacific\b/u.test(normalized)) {
    tokens.push("apac");
  }
  if (/\blatam\b|\blatin america\b/u.test(normalized)) {
    tokens.push("latin_america");
  }
  if (/\bnorth america\b/u.test(normalized)) {
    tokens.push("north_america");
  } else if (/\bamericas?\b/u.test(normalized)) {
    tokens.push("americas");
  }

  for (const country of countryDefinitions) {
    if (country.aliases.some((alias) => hasNormalizedPhrase(value, alias))) {
      tokens.push(`country:${country.id}`);
    }
  }

  return [...new Set(tokens)];
}

function parseGeography(value: string): ParsedGeography {
  const normalized = normalizeText(value);
  const exclusionMarker = /\b(?:excluding|except|but not|excluded)\b/u.exec(
    normalized,
  );
  const allowedText = exclusionMarker
    ? normalized.slice(0, exclusionMarker.index).trim()
    : normalized;
  const alternatives = allowedText
    .split(/\bor\b/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const tokens = extractGeographyTokens(allowedText);
  const hasUnparsedAlternative =
    alternatives.length > 1 &&
    alternatives.some(
      (alternative) => extractGeographyTokens(alternative).length === 0,
    );

  return {
    original: value,
    allowedText,
    tokens,
    hasUnparsedAlternative,
  };
}

function matchesDirectCountry(
  geography: ParsedGeography,
  residence: Residence,
): boolean {
  return residence.directCountryValues.some((country) =>
    hasNormalizedPhrase(geography.allowedText, country),
  );
}

function compareRegion(
  token: Exclude<GeographyToken, `country:${string}` | "worldwide">,
  residenceRegion: ResidenceRegion,
): EligibilityState {
  switch (token) {
    case "emea":
      return ["eu", "europe_non_eu", "middle_east", "africa"].includes(
        residenceRegion,
      )
        ? "supported"
        : "conflict";
    case "europe":
      return residenceRegion === "eu"
        ? "supported"
        : residenceRegion === "europe_non_eu"
          ? "unknown"
          : "conflict";
    case "eu":
      return residenceRegion === "eu" ? "supported" : "conflict";
    case "middle_east":
      return residenceRegion === "middle_east" ? "supported" : "conflict";
    case "africa":
      return residenceRegion === "africa" ? "supported" : "conflict";
    case "americas":
      return residenceRegion === "north_america" ||
        residenceRegion === "latin_america"
        ? "supported"
        : "conflict";
    case "north_america":
      return residenceRegion === "north_america" ? "supported" : "conflict";
    case "latin_america":
      return residenceRegion === "latin_america" ? "supported" : "conflict";
    case "apac":
      return residenceRegion === "apac" ? "supported" : "conflict";
  }
}

function compareGeography(
  geography: ParsedGeography,
  residence: Residence,
): EligibilityState {
  const restrictiveTokens = geography.tokens.filter(
    (token) => token !== "worldwide",
  );
  if (
    (geography.tokens.includes("worldwide") && restrictiveTokens.length === 0) ||
    matchesDirectCountry(geography, residence)
  ) {
    return "supported";
  }
  if (geography.tokens.length === 0) {
    return "unknown";
  }
  if (!residence.country) {
    if (
      residence.regionHint &&
      geography.tokens.includes(residence.regionHint)
    ) {
      return "supported";
    }
    return "unknown";
  }

  const outcomes = restrictiveTokens.map((token): EligibilityState => {
    if (token.startsWith("country:")) {
      return token === `country:${residence.country!.id}`
        ? "supported"
        : "conflict";
    }
    return compareRegion(
      token as RegionGeographyToken,
      residence.country!.region,
    );
  });

  if (outcomes.includes("supported")) {
    return "supported";
  }
  if (outcomes.includes("unknown") || geography.hasUnparsedAlternative) {
    return "unknown";
  }
  return "conflict";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function explicitlyExcludesResidence(
  posting: MatchAssessmentPostingInput,
  residence: Residence,
): boolean {
  const aliases = uniqueStrings([
    ...(residence.country?.aliases ?? []),
    ...residence.directCountryValues.map(normalizeText),
  ]).filter((value) => value.length >= 2);
  if (aliases.length === 0) {
    return false;
  }

  const text = normalizeText(
    [
      posting.location,
      posting.description,
      ...posting.screeningHints.remoteGeographies,
      ...posting.minimumQualifications,
    ].join(" "),
  );
  return aliases.some((alias) => {
    const phrase = escapeRegex(alias).replaceAll(" ", "\\s+");
    return (
      new RegExp(
        `\\b(?:excluding|except|but not|exclude(?:s|d)?|not available in|unavailable in|cannot hire in|do not hire in)\\b.{0,60}\\b${phrase}\\b`,
        "u",
      ).test(text) ||
      new RegExp(
        `\\b${phrase}\\b.{0,24}\\b(?:excluded|not eligible|not supported)\\b`,
        "u",
      ).test(text)
    );
  });
}

function profileLocationEvidence(
  profile: CandidateProfile,
): ResumeRequirementEvidence[] {
  if (
    !profile.currentLocation ||
    /\b(?:set|select|unknown|not provided|not listed)\b/iu.test(
      profile.currentLocation,
    )
  ) {
    return [];
  }
  return [
    {
      sourceKind: "profile",
      sourceId: profile.id,
      label: "Current location",
      detail: profile.currentLocation,
    },
  ];
}

function withRelocationUncertainty(
  state: EligibilityState,
  profile: CandidateProfile,
): EligibilityState {
  return state === "conflict" &&
    profile.workEligibility.willingToRelocate === true
    ? "unknown"
    : state;
}

export function assessRemoteGeographyRequirement(input: {
  profile: CandidateProfile;
  posting: MatchAssessmentPostingInput;
}): JobRequirementAssessment | null {
  const { profile, posting } = input;
  if (!posting.workMode.includes("remote")) {
    return null;
  }

  const geographyEvidence =
    posting.screeningHints.remoteGeographies.length > 0
      ? posting.screeningHints.remoteGeographies
      : posting.location.trim().length > 0 &&
          !/^\s*(?:remote|anywhere|worldwide|global)\s*$/iu.test(
            posting.location,
          )
        ? [posting.location]
        : [];
  const residence = getResidence(profile);
  let state: EligibilityState;
  let explanation: string;

  if (geographyEvidence.length === 0) {
    state = "unknown";
    explanation =
      "The role is remote, but the listing does not state where remote employees may reside.";
  } else if (explicitlyExcludesResidence(posting, residence)) {
    state = withRelocationUncertainty("conflict", profile);
    explanation =
      state === "conflict"
        ? "The listing explicitly excludes the candidate's current country from its remote hiring area."
        : "The current country is explicitly excluded, but the profile confirms willingness to relocate; eligibility still needs confirmation.";
  } else {
    const parsed = geographyEvidence.map(parseGeography);
    const outcomes = parsed.map((geography) =>
      compareGeography(geography, residence),
    );
    const rawState: EligibilityState = outcomes.includes("supported")
      ? "supported"
      : outcomes.includes("unknown") ||
          parsed.some((geography) => geography.hasUnparsedAlternative)
        ? "unknown"
        : "conflict";
    state = withRelocationUncertainty(rawState, profile);

    if (state === "supported") {
      explanation =
        "The candidate's current country is explicitly inside the listing's remote hiring geography.";
    } else if (rawState === "conflict" && state === "unknown") {
      explanation =
        "The current country is outside the stated remote hiring geography, but the profile confirms willingness to relocate; eligibility still needs confirmation.";
    } else if (state === "conflict") {
      explanation =
        "The candidate's current country is outside the listing's stated remote hiring geography.";
    } else if (
      profile.workEligibility.authorizedWorkCountries.length > 0 &&
      profileLocationEvidence(profile).length === 0
    ) {
      explanation =
        "Work authorization is recorded, but authorization alone does not prove current residence in the listing's remote hiring geography.";
    } else {
      explanation =
        "The listing or profile does not provide enough precise residence evidence to confirm remote-geography eligibility.";
    }
  }

  return {
    id: "requirement_location_remote_geography_eligibility",
    category: "location",
    label: "Remote geography eligibility",
    importance: "required",
    status: state,
    jobEvidence:
      geographyEvidence.length > 0
        ? geographyEvidence.join("; ")
        : `${posting.location}; remote work mode`,
    resumeEvidence: profileLocationEvidence(profile),
    explanation,
  };
}

type ClearanceKind =
  | "ts_sci"
  | "top_secret"
  | "secret"
  | "public_trust"
  | "confidential"
  | "uk_dv"
  | "uk_sc";

function extractClearanceKinds(value: string): Set<ClearanceKind> {
  const normalized = normalizeText(value);
  const kinds = new Set<ClearanceKind>();
  if (/\bts sci\b/u.test(normalized)) {
    kinds.add("ts_sci");
  }
  if (/\btop secret\b/u.test(normalized)) {
    kinds.add("top_secret");
  }
  if (/\bpublic trust\b/u.test(normalized)) {
    kinds.add("public_trust");
  }
  if (/\bconfidential clearance\b/u.test(normalized)) {
    kinds.add("confidential");
  }
  if (/\b(?:developed vetting|dv clearance)\b/u.test(normalized)) {
    kinds.add("uk_dv");
  }
  if (/\b(?:security check|sc clearance)\b/u.test(normalized)) {
    kinds.add("uk_sc");
  }
  if (
    /\bsecret clearance\b/u.test(normalized) &&
    !/\btop secret\b/u.test(normalized)
  ) {
    kinds.add("secret");
  }
  return kinds;
}

function mentionsClearance(value: string): boolean {
  return (
    /\b(?:security )?clearance\b/iu.test(value) ||
    extractClearanceKinds(value).size > 0
  );
}

function isPreferredClearance(value: string): boolean {
  return /\b(?:preferred|nice to have|bonus|desired|a plus)\b/iu.test(value);
}

function isRequiredClearance(value: string): boolean {
  return /\b(?:must|required|requirement|need to have|shall hold|must hold|must maintain)\b/iu.test(
    value,
  );
}

function isExplicitlyInactiveClearance(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    /^(?:none|no|not held)$/u.test(normalized) ||
    /\b(?:expired|inactive|revoked|lapsed)\b/u.test(normalized) ||
    /\b(?:no|none|without)\b.{0,24}\b(?:active )?(?:security )?clearance\b/iu.test(
      value,
    ) ||
    /\b(?:expired|inactive|revoked|lapsed)\b.{0,32}\b(?:security )?clearance\b/iu.test(
      value,
    ) ||
    /\b(?:security )?clearance\b.{0,20}\b(?:expired|inactive|revoked|lapsed)\b/iu.test(
      value,
    )
  );
}

function onlyAbleToObtainClearance(value: string): boolean {
  return /\b(?:able|eligible|willing|can)\b.{0,24}\b(?:obtain|acquire|get)\b.{0,24}\b(?:security )?clearance\b/iu.test(
    value,
  );
}

function hasActiveClearance(value: string): boolean {
  const hasActiveMarker = /\b(?:active|current|valid)\b/iu.test(value);
  return hasActiveMarker && mentionsClearance(value);
}

function clip(value: string, limit = 220): string {
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit - 1).trim()}…`;
}

export function assessSecurityClearanceRequirement(input: {
  profile: CandidateProfile;
  posting: MatchAssessmentPostingInput;
}): JobRequirementAssessment | null {
  const { profile, posting } = input;
  const minimumMentions =
    posting.minimumQualifications.filter(mentionsClearance);
  const preferredMentions =
    posting.preferredQualifications.filter(mentionsClearance);
  const descriptionMentions = posting.description
    .split(/\r?\n|(?<=[.!?])\s+/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && mentionsClearance(line));
  const requiredMentions = [
    ...minimumMentions,
    ...descriptionMentions.filter(
      (line) => isRequiredClearance(line) && !isPreferredClearance(line),
    ),
  ];
  const preferredOnly =
    requiredMentions.length === 0 &&
    (preferredMentions.length > 0 ||
      descriptionMentions.some(isPreferredClearance));

  if (preferredOnly) {
    return null;
  }
  if (
    posting.screeningHints.requiresSecurityClearance !== true &&
    requiredMentions.length === 0
  ) {
    return null;
  }

  const jobEvidence =
    requiredMentions[0] ??
    descriptionMentions[0] ??
    "The listing marks security clearance as required.";
  const requiredKinds = extractClearanceKinds(jobEvidence);
  const savedClearance = profile.workEligibility.securityClearance;
  let status: EligibilityState = "unknown";
  let explanation =
    "The listing requires security clearance, but the profile does not record current clearance evidence.";

  if (savedClearance) {
    const candidateKinds = extractClearanceKinds(savedClearance);
    if (isExplicitlyInactiveClearance(savedClearance)) {
      status = "conflict";
      explanation =
        "The saved profile explicitly records no active clearance or an expired, inactive, revoked, or lapsed clearance.";
    } else if (onlyAbleToObtainClearance(savedClearance)) {
      explanation =
        "The profile says the candidate may obtain a clearance, which does not prove an active clearance.";
    } else if (!hasActiveClearance(savedClearance)) {
      explanation =
        "The saved clearance text does not explicitly confirm that the clearance is active.";
    } else if (requiredKinds.size === 0) {
      status = "supported";
      explanation =
        "The profile explicitly records an active clearance and the listing does not name a different clearance type.";
    } else if (
      [...requiredKinds].some((requiredKind) =>
        candidateKinds.has(requiredKind),
      )
    ) {
      status = "supported";
      explanation =
        "The profile explicitly records the same active clearance type required by the listing.";
    } else {
      explanation =
        "The profile records an active clearance, but it does not prove the specific clearance type required by the listing.";
    }
  }

  return {
    id: "requirement_work_authorization_security_clearance",
    category: "work_authorization",
    label: "Security clearance",
    importance: "required",
    status,
    jobEvidence: clip(jobEvidence),
    resumeEvidence: savedClearance
      ? [
          {
            sourceKind: "profile",
            sourceId: profile.id,
            label: "Saved security clearance",
            detail: clip(savedClearance),
          },
        ]
      : [],
    explanation,
  };
}

export function buildEligibilityRequirementAssessments(input: {
  profile: CandidateProfile;
  posting: MatchAssessmentPostingInput;
}): JobRequirementAssessment[] {
  return [
    assessRemoteGeographyRequirement(input),
    assessSecurityClearanceRequirement(input),
  ].filter(
    (requirement): requirement is JobRequirementAssessment =>
      requirement !== null,
  );
}
