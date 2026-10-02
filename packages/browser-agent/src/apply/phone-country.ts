import type { CandidateProfile } from "@nordri/contracts";

import { normalizeSignal } from "./control-classification";
import type { ApplyFormControl } from "./types";

/**
 * The country picker that sits next to a phone number.
 *
 * Forms split a phone number into a country and the rest of it. Getting this
 * wrong can make the number unreachable or repeat its calling code. A
 * calling-code-only choice comes from the international number. A choice
 * naming a country also needs that country, because some codes are shared.
 */

export function isPhoneCountryControl(
  control: Pick<ApplyFormControl, "label" | "groupLabel">,
): boolean {
  const label = normalizeSignal(control.label);
  const groupLabel = normalizeSignal(control.groupLabel);
  const signal = normalizeSignal(`${control.label} ${control.groupLabel}`);
  return (
    /\b(?:phone country|country code|calling code|dial code)\b/u.test(signal) ||
    (label === "country" && groupLabel.includes("phone"))
  );
}

/**
 * Regions that identify their country without naming it.
 *
 * A profile that says "California" and nothing else still says which country
 * the phone number belongs to.
 */
const UNITED_STATES_REGIONS: ReadonlySet<string> = new Set(
  [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
    "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
    "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
    "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
    "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
    "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin",
    "Wyoming",
  ].map(normalizeSignal),
);

/** The country the person's phone number most likely belongs to, or null. */
export function resolvePhoneCountryHint(
  profile: CandidateProfile,
): string | null {
  const currentCountry = profile.currentCountry?.trim();
  if (currentCountry) {
    return currentCountry;
  }
  if (UNITED_STATES_REGIONS.has(normalizeSignal(profile.currentRegion ?? ""))) {
    return "United States";
  }
  const authorized = [
    ...new Set(
      profile.workEligibility.authorizedWorkCountries
        .map((country) => country.trim())
        .filter(Boolean),
    ),
  ];
  return authorized.length === 1 ? (authorized[0] ?? null) : null;
}

export function optionCallingCodes(optionLabel: string): string[] {
  return [...new Set(optionLabel.match(/\+\d{1,4}(?!\d)/gu) ?? [])];
}

export function optionCountry(optionLabel: string): string {
  return normalizeSignal(optionLabel.replace(/\+\d{1,4}(?!\d)/gu, " "));
}

/** A calling code the person wrote into their own phone number. */
export function explicitCallingCode(phone: string): string | null {
  const trimmed = phone.trim();
  const standalone = /^\+\d{1,4}$/u.exec(trimmed)?.[0] ?? null;
  if (standalone) {
    return standalone;
  }
  return /^(?:\(\s*)?(\+\d{1,4})(?=\s|\)|[.-])/u.exec(trimmed)?.[1] ?? null;
}

/**
 * Which calling code to select, when it can be known for certain.
 *
 * Returns null rather than guessing when the number carries no code and the
 * country does not narrow the options to exactly one.
 */
export function resolveCallingCode(input: {
  phone: string;
  countryHint: string | null;
  optionLabels: readonly string[];
}): string | null {
  const explicit = explicitCallingCode(input.phone);
  if (explicit) {
    return explicit;
  }

  const compact = input.phone.trim();
  if (!/^\+\d{7,15}$/u.test(compact)) {
    return null;
  }

  const matching = [
    ...new Set(
      input.optionLabels.flatMap((optionLabel) =>
        optionCallingCodes(optionLabel).filter((code) =>
          compact.startsWith(code),
        ),
      ),
    ),
  ];
  return matching.length === 1 ? (matching[0] ?? null) : null;
}

/**
 * The option to choose for a phone-country control.
 *
 * Code-only choices use the number's calling code. Choices naming a country
 * must also match the saved country; shared calling codes do not settle it.
 */
export function matchPhoneCountryOption(input: {
  options: readonly string[];
  callingCode: string;
  countryHint: string | null;
}): string | null {
  const country = normalizeSignal(input.countryHint ?? "");
  if (!/^\+\d{1,4}$/u.test(input.callingCode)) {
    return null;
  }
  const matches = input.options.filter(
    (optionLabel) =>
      (!optionCountry(optionLabel) ||
        (Boolean(country) && optionCountry(optionLabel) === country)) &&
      optionCallingCodes(optionLabel).includes(input.callingCode),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * The phone number with a country code removed, when the picker next to it
 * already carries that code. Nothing is stripped unless it matches exactly.
 */
export function stripSelectedCallingCode(
  phone: string,
  selectedCallingCode: string | null,
): string {
  const trimmed = phone.trim();
  if (!selectedCallingCode || !trimmed.startsWith(selectedCallingCode)) {
    return trimmed;
  }
  return trimmed.slice(selectedCallingCode.length).replace(/^[\s).-]+/u, "");
}
