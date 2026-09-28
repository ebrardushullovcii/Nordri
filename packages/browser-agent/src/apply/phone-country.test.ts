import { CandidateProfileSchema } from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import {
  explicitCallingCode,
  isPhoneCountryControl,
  matchPhoneCountryOption,
  resolveCallingCode,
  resolvePhoneCountryHint,
  stripSelectedCallingCode,
} from "./phone-country";

/**
 * The country picker beside a phone number.
 *
 * Getting this wrong sends an unreachable number, so the rule is that both
 * the calling code and the country have to be known. A code alone is not
 * enough: +1 is the United States and Canada and a dozen more.
 */

function profile(overrides: Record<string, unknown> = {}) {
  return CandidateProfileSchema.parse({
    id: "candidate_test",
    firstName: "Robin",
    lastName: "Ashford",
    fullName: "Robin Ashford",
    headline: "Platform engineer",
    summary: "Builds dependable internal tools.",
    currentLocation: "Manchester",
    yearsExperience: 8,
    baseResume: {
      id: "resume_test",
      fileName: "resume.txt",
      uploadedAt: "2026-09-01T09:00:00.000Z",
      textContent: "Resume",
      textUpdatedAt: "2026-09-01T09:00:00.000Z",
      extractionStatus: "ready",
    },
    ...overrides,
  });
}

describe("phone country picker", () => {
  test("recognises the picker by what it is called", () => {
    expect(
      isPhoneCountryControl({ label: "Country code", groupLabel: "" }),
    ).toBe(true);
    expect(
      isPhoneCountryControl({ label: "Country", groupLabel: "Phone number" }),
    ).toBe(true);
    expect(isPhoneCountryControl({ label: "Country", groupLabel: "Address" })).toBe(
      false,
    );
  });

  test("takes the country from the profile, a known region, or a single work country", () => {
    expect(resolvePhoneCountryHint(profile({ currentCountry: "Ireland" }))).toBe(
      "Ireland",
    );
    expect(resolvePhoneCountryHint(profile({ currentRegion: "California" }))).toBe(
      "United States",
    );
    expect(
      resolvePhoneCountryHint(
        profile({
          workEligibility: { authorizedWorkCountries: ["Germany"] },
        }),
      ),
    ).toBe("Germany");
    expect(
      resolvePhoneCountryHint(
        profile({
          workEligibility: {
            authorizedWorkCountries: ["Germany", "Austria"],
          },
        }),
      ),
    ).toBeNull();
  });

  test("a code the person wrote themselves is taken as written", () => {
    expect(explicitCallingCode("+44 7700 900123")).toBe("+44");
    expect(explicitCallingCode("(+353) 87 123 4567")).toBe("+353");
    expect(explicitCallingCode("07700 900123")).toBeNull();
  });

  test("a number with no code is only resolved when the country narrows it to one", () => {
    expect(
      resolveCallingCode({
        phone: "+447700900123",
        countryHint: "United Kingdom",
        optionLabels: ["United Kingdom +44", "Ireland +353"],
      }),
    ).toBe("+44");
    expect(
      resolveCallingCode({
        phone: "07700900123",
        countryHint: "United Kingdom",
        optionLabels: ["United Kingdom +44"],
      }),
    ).toBeNull();
  });

  test("an option is chosen only when it names both the code and the country", () => {
    const options = ["United States +1", "Canada +1", "United Kingdom +44"];
    expect(
      matchPhoneCountryOption({
        options,
        callingCode: "+1",
        countryHint: "Canada",
      }),
    ).toBe("Canada +1");
    // A shared code with no country to settle it is left for the person.
    expect(
      matchPhoneCountryOption({ options, callingCode: "+1", countryHint: null }),
    ).toBeNull();
  });

  test("the number does not repeat a code the picker already shows", () => {
    expect(stripSelectedCallingCode("+44 7700 900123", "+44")).toBe("7700 900123");
    expect(stripSelectedCallingCode("(+44) 7700 900123", "+44")).toBe(
      "(+44) 7700 900123",
    );
    expect(stripSelectedCallingCode("+44 7700 900123", null)).toBe(
      "+44 7700 900123",
    );
  });
});
