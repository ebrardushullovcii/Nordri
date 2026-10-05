import { expect, test } from "vitest";
import { CandidateWorkEligibilitySchema } from "./profile";
import { JobSearchPreferencesSchema } from "./discovery";
import { ProfileSearchPreferencesPatchFieldsSchema } from "./profile-copilot";

const legacy = {
  minimumSalaryUsd: null,
  approvalMode: "review_before_submit",
  tailoringMode: "balanced",
};

test("new preference fields stay absent on old data", () => {
  const preferences = JobSearchPreferencesSchema.parse(legacy);
  expect(preferences).not.toHaveProperty("shiftPreference");
  expect(preferences).not.toHaveProperty("weeklyHours");
  expect(preferences).not.toHaveProperty("searchSelectivity");
  expect(preferences.compensation).not.toHaveProperty("basis");
  expect(CandidateWorkEligibilitySchema.parse({})).not.toHaveProperty(
    "limitedWorkPermissions",
  );
});

test("R3-065 retains limited country permission and uncertain future sponsorship", () => {
  const eligibility = CandidateWorkEligibilitySchema.parse({
    authorizedWorkCountries: ["Lebanon"],
    limitedWorkPermissions: [
      { country: "Germany", conditions: "Student work only" },
    ],
  });
  expect(
    eligibility.limitedWorkPermissions?.[0]?.requiresFutureSponsorship,
  ).toBeNull();
  expect(
    CandidateWorkEligibilitySchema.safeParse({
      limitedWorkPermissions: [{ country: "Germany", conditions: "" }],
    }).success,
  ).toBe(false);
});

test("R3-105 validates shifts and weekly hours", () => {
  expect(
    JobSearchPreferencesSchema.parse({
      ...legacy,
      shiftPreference: "day",
      weeklyHours: { minimum: 20, maximum: 30 },
    }).weeklyHours,
  ).toEqual({ minimum: 20, maximum: 30 });
  expect(
    JobSearchPreferencesSchema.safeParse({
      ...legacy,
      weeklyHours: { minimum: 30, maximum: 20 },
    }).success,
  ).toBe(false);
});

test("R3-138 preserves OTE when loading legacy numeric salary fields", () => {
  expect(
    JobSearchPreferencesSchema.parse({
      ...legacy,
      minimumSalaryUsd: 160000,
      compensation: { basis: "total_ote" },
    }).compensation,
  ).toMatchObject({ minimum: 160000, basis: "total_ote" });
});

test("R3-193 keeps independent plan pickiness choices", () => {
  expect(
    JobSearchPreferencesSchema.parse({
      ...legacy,
      searchSelectivity: "best_matches",
    }).searchSelectivity,
  ).toBe("best_matches");
  expect(
    JobSearchPreferencesSchema.parse({
      ...legacy,
      searchSelectivity: "wide_net",
    }).searchSelectivity,
  ).toBe("wide_net");
});

test("preference updates accept the new schedule and plan fields", () => {
  expect(
    ProfileSearchPreferencesPatchFieldsSchema.parse({
      shiftPreference: "day",
      weeklyHours: { minimum: 20, maximum: 30 },
      searchSelectivity: "best_matches",
    }),
  ).toEqual({
    shiftPreference: "day",
    weeklyHours: { minimum: 20, maximum: 30 },
    searchSelectivity: "best_matches",
  });
});
