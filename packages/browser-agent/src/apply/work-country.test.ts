import { describe, expect, test } from "vitest";

import { judgeWorkCountry, namedWorkCountries } from "./work-country";

describe("namedWorkCountries", () => {
  test.each([
    ["Are you legally authorized to work in the U.S.?", ["United States"]],
    ["Remote (US)", ["United States"]],
    ["London, UK", ["United Kingdom"]],
    ["New York, New York", ["United States"]],
    ["Toronto, Ontario", ["Canada"]],
    ["Sydney, New South Wales", ["Australia"]],
    ["Amsterdam, The Netherlands", ["Netherlands"]],
    ["Are you eligible to work in the EU?", ["European Union"]],
    ["Are you authorized to work for us?", []],
    ["Remote, Europe", []],
    ["Tbilisi, Georgia", []],
  ])("%s", (text, expected) => {
    expect(namedWorkCountries(text)).toEqual(expected);
  });
});

describe("judgeWorkCountry", () => {
  test.each([
    [["European Union"], "Portugal", "covered"],
    [["European Economic Area"], "Norway", "covered"],
    [["EU"], "European Economic Area", "covered"],
    [["us"], "United States", "covered"],
    [["Germany"], "United States", "not_covered"],
    [["European Union"], "United States", "not_covered"],
    [["Germany"], "Austria", "unknown"],
    [["European Union"], "Switzerland", "unknown"],
    [["Ireland"], "United Kingdom", "unknown"],
    [["Deutschland"], "United States", "unknown"],
  ] as const)("%j for %s is %s", (countries, asked, kind) => {
    expect(
      judgeWorkCountry({
        questionText: `Are you authorized to work in ${asked}?`,
        postingLocation: "",
        authorizedWorkCountries: countries,
      }).kind,
    ).toBe(kind);
  });

  test("the question's country wins over the posting's", () => {
    expect(
      judgeWorkCountry({
        questionText: "Are you authorized to work in Canada?",
        postingLocation: "Berlin, Germany",
        authorizedWorkCountries: ["Germany"],
      }),
    ).toEqual({ kind: "not_covered", country: "Canada" });
  });

  test("several named countries must all agree", () => {
    expect(
      judgeWorkCountry({
        questionText: "Are you authorized to work in the US and Canada?",
        postingLocation: "",
        authorizedWorkCountries: ["Canada"],
      }).kind,
    ).toBe("unknown");
  });
});
