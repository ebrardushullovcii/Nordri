import {
  CandidateProfileSchema,
  type CandidateReusableAnswer,
} from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import {
  matchOption,
  NO_STORED_ANSWER_REASON,
  resolveApplyAnswer,
  resolveReusableAnswer,
} from "./answer-sourcing";
import { buildPendingQuestion } from "./policy-executor";
import type { ApplyAnswerSources, ApplyFormControl } from "./types";

/**
 * An answer the person already gave has to be recognised the next time.
 *
 * Answering "No" to the same yes/no question four times, and being asked a
 * fifth, is the failure these cover: the saved answer has to find the field,
 * and the field's choices have to recognise the words.
 */

function control(overrides: Partial<ApplyFormControl> = {}): ApplyFormControl {
  return {
    ref: "c0",
    kind: "select",
    label: "Have you previously worked at or consulted for us?",
    groupLabel: "",
    placeholder: "",
    required: true,
    disabled: false,
    readOnly: false,
    visible: true,
    value: "",
    checked: false,
    options: ["Yes", "No"],
    selectedOptionLabel: "",
    invalid: false,
    validationMessage: "",
    questionKind: "other",
    answerControlType: "single_choice",
    attestationKind: null,
    answered: false,
    ...overrides,
  };
}

function savedAnswer(
  question: string,
  answer: string,
): CandidateReusableAnswer {
  return {
    id: "answer_1",
    label: question,
    question,
    answer,
    kind: "other",
    roleFamilies: [],
    proofEntryIds: [],
  };
}

function sources(
  reusableAnswers: readonly CandidateReusableAnswer[],
): ApplyAnswerSources {
  return {
    profile: CandidateProfileSchema.parse({
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
        textContent: "8 years of platform engineering.",
        textUpdatedAt: "2026-09-01T09:00:00.000Z",
        extractionStatus: "ready",
      },
    }),
    resumeText: null,
    posting: {
      title: "Platform Engineer",
      company: "Northwind Tools",
      location: "Manchester",
      description: "Own the internal platform.",
    },
    reusableAnswers,
    documents: [],
  };
}

describe("the person's answer to this exact question", () => {
  test("beats a saved work-authorization sentence that fits none of the choices", () => {
    const input = sources([
      savedAnswer(
        "Are you legally authorized to work in this country? *",
        "Yes",
      ),
    ]);
    input.profile.answerBank.workAuthorization =
      "Authorized to work in the United Kingdom and open to remote roles across Europe.";
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "radio",
          label: "Are you legally authorized to work in this country?",
          questionKind: "work_authorization",
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "Yes", sourceKind: "answer_library" },
    });
  });
});

describe("the person's answer to a yes/no radio group", () => {
  test("matches the group's question, not the option label", () => {
    const input = sources([
      savedAnswer(
        "Are you legally authorized to work in this country? *",
        "Yes",
      ),
    ]);
    input.profile.answerBank.workAuthorization =
      "Authorized to work in the United Kingdom and open to remote roles across Europe.";
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "radio",
          label: "Yes",
          groupLabel: "Are you legally authorized to work in this country? *",
          questionKind: "work_authorization",
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "Yes", sourceKind: "answer_library" },
    });
  });
});

describe("fitting an answer to the choices a form offers", () => {
  test.each([
    "First available interview session",
    "Last available interview session",
    "Would you work a middle shift?",
  ])(
    "does not use a name for %s, and accepts the person's saved answer",
    (label) => {
      const input = sources([]);
      input.profile.middleName = "Taylor";
      const field = control({ label, options: ["Option A", "Option B"] });
      expect(
        resolveApplyAnswer({
          control: field,
          sources: input,
          salaryDisclosure: "pause_for_user",
        }),
      ).toMatchObject({ status: "needs_you", suggestion: null });
      expect(
        resolveApplyAnswer({
          control: field,
          sources: {
            ...input,
            reusableAnswers: [savedAnswer(label, "Option B")],
          },
          salaryDisclosure: "pause_for_user",
        }),
      ).toMatchObject({
        status: "answered",
        answer: { value: "Option B", sourceKind: "answer_library" },
      });
    },
  );

  test.each([
    ["First name", "", "Robin"],
    ["Given name", "", "Robin"],
    ["Last name", "", "Ashford"],
    ["Family name", "", "Ashford"],
    ["Middle name", "", "Taylor"],
    ["First", "", "Robin"],
    ["Given", "Name", "Robin"],
    ["Last", "Name", "Ashford"],
    ["Family", "", "Ashford"],
    ["Middle", "Name", "Taylor"],
  ])("preserves name field %s in group %s", (label, groupLabel, expected) => {
    const input = sources([]);
    input.profile.middleName = "Taylor";
    expect(
      resolveApplyAnswer({
        control: control({ label, groupLabel, kind: "text", options: [] }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: expected, sourceKind: "profile" },
    });
  });

  test("asks for an unknown preferred interview session instead of using the person's name", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Preferred interview session",
        options: ["Thursday at 14:00", "Friday at 10:00"],
      }),
      sources: sources([]),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({ status: "needs_you", suggestion: null });
  });

  test("uses the person's answer to a preferred interview session when continuing", () => {
    const label = "Preferred interview session";
    const result = resolveApplyAnswer({
      control: control({
        label,
        options: ["Thursday at 14:00", "Friday at 10:00"],
      }),
      sources: sources([savedAnswer(label, "Thursday at 14:00")]),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "Thursday at 14:00", sourceKind: "answer_library" },
    });
  });

  test.each([
    "Preferred name",
    "Preferred full name",
    "Preferred display name",
  ])("still fills %s from the preferred name", (label) => {
    const input = sources([]);
    input.profile.preferredDisplayName = "Rory";
    const result = resolveApplyAnswer({
      control: control({ label, kind: "text", options: [] }),
      sources: input,
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "Rory", sourceId: "profile.preferredDisplayName" },
    });
  });

  test("uses the posting for the location being applied to", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Which location are you applying for?",
        questionKind: "location",
        options: ["", "Remote, Europe", "Remote, Worldwide"],
      }),
      sources: {
        ...sources([]),
        posting: {
          ...sources([]).posting,
          location: "Remote, Europe",
        },
      },
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: {
        value: "Remote, Europe",
        sourceKind: "posting",
        sourceId: "posting.location",
      },
    });
  });

  test("uses the profile for a residence-location field", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Current location",
        groupLabel: "Application location",
        questionKind: "location",
        options: [],
      }),
      sources: {
        ...sources([]),
        posting: {
          ...sources([]).posting,
          location: "Remote, Europe",
        },
      },
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: {
        value: "Manchester",
        sourceKind: "profile",
        sourceId: "profile.currentLocation",
      },
    });
  });

  test("does not treat an ambiguous location label as the job location", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Location",
        groupLabel: "Application details",
        questionKind: "location",
        options: [],
      }),
      sources: {
        ...sources([]),
        posting: {
          ...sources([]).posting,
          location: "Remote, Europe",
        },
      },
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: {
        value: "Manchester",
        sourceKind: "profile",
        sourceId: "profile.currentLocation",
      },
    });
  });

  test("never puts a city in a street-address field or writes an address from prose", () => {
    for (const location of [
      null,
      "Manchester",
      "London, UK",
      "District 1, London",
    ]) {
      const input = sources([]);
      input.profile.currentLocation = location;
      expect(
        resolveApplyAnswer({
          control: control({
            kind: "text",
            label: "Address *",
            groupLabel: "My Information",
            questionKind: "location",
            options: [],
          }),
          sources: input,
          salaryDisclosure: "pause_for_user",
        }),
      ).toMatchObject({ status: "needs_you", suggestion: null });
    }
  });

  test("uses the explicit street line the person supplied in their full location", () => {
    const input = sources([]);
    input.profile.currentLocation =
      "1 Example Road, London, SW1A 1AA, United Kingdom";
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "text",
          label: "Address",
          questionKind: "location",
          options: [],
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "1 Example Road", sourceId: "profile.currentLocation" },
    });
  });

  test("an exact saved address works without assuming any particular address format", () => {
    const input = sources([savedAnswer("Street address", "Rua das Flores")]);
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "text",
          label: "Street address",
          questionKind: "location",
          options: [],
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "Rua das Flores", sourceKind: "answer_library" },
    });
  });

  test("postal codes and address line 2 are separate facts from a saved street", () => {
    const input = sources([]);
    input.profile.currentLocation = "1 Example Road, London";
    for (const label of ["Postal code", "ZIP code", "Address line 2"]) {
      expect(
        resolveApplyAnswer({
          control: control({
            kind: "text",
            label,
            groupLabel: "Address",
            questionKind: "location",
            options: [],
          }),
          sources: input,
          salaryDisclosure: "pause_for_user",
        }),
      ).toMatchObject({ status: "needs_you", suggestion: null });
    }
  });

  test("does not use a home location when the posting location is missing", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Which location are you applying for?",
        questionKind: "location",
        options: ["", "Remote, Europe", "Remote, Worldwide"],
      }),
      sources: {
        ...sources([]),
        posting: {
          ...sources([]).posting,
          location: "",
        },
      },
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toEqual({
      status: "needs_you",
      reason: "Nothing in your profile, resume, or saved answers answers this.",
      suggestion: null,
    });
  });

  test("the words for no all find the No choice", () => {
    for (const written of ["no", "No", "NO", "none", "n", "Not applicable"]) {
      expect(matchOption(["Yes", "No"], written)).toBe("No");
    }
  });

  test("the words for yes all find the Yes choice", () => {
    for (const written of ["yes", "Yes", "y", "true", "I have"]) {
      expect(matchOption(["Yes", "No"], written)).toBe("Yes");
    }
  });

  test("one choice the answer begins is that choice", () => {
    expect(
      matchOption(["Bachelor's degree", "Master's degree"], "Bachelor"),
    ).toBe("Bachelor's degree");
  });

  test("an answer that fits two choices is still the person's to settle", () => {
    expect(
      matchOption(["Master's degree", "Master of Science"], "Master"),
    ).toBe(null);
  });

  test("grounded overall experience fits every range and endpoint", () => {
    for (const [years, expected] of [
      [0, "0–1"],
      [1, "0–1"],
      [2, "2–4"],
      [4, "2–4"],
      [5, "5–9"],
      [9, "5–9"],
      [10, "10+"],
      [12, "10+"],
    ] as const) {
      const field = control({
        label: "Years of professional experience",
        options: ["0–1", "2–4", "5–9", "10+"],
        questionKind: "experience",
      });
      const answerSources = sources([]);
      answerSources.profile.yearsExperience = years;
      const resolution = resolveApplyAnswer({
        control: field,
        sources: answerSources,
        salaryDisclosure: "pause_for_user",
      });

      expect(resolution.status).toBe("answered");
      if (resolution.status === "answered") {
        expect(resolution.answer.value).toBe(expected);
        expect(resolution.answer.sourceId).toBe("profile.yearsExperience");
      }
    }
  });

  test("overall experience does not answer years in a specific skill", () => {
    for (const specificField of [
      {
        label: "How many years of Python experience do you have?",
        groupLabel: "",
      },
      {
        label: "How many years of experience with Python do you have?",
        groupLabel: "",
      },
      { label: "Years of experience", groupLabel: "Python" },
    ]) {
      const field = control({
        ...specificField,
        options: ["0–1", "2–4", "5–9", "10+"],
        questionKind: "experience",
      });
      const answerSources = sources([]);
      answerSources.profile.yearsExperience = 12;
      answerSources.resumeText = "12 years of professional experience.";
      const resolution = resolveApplyAnswer({
        control: field,
        sources: answerSources,
        salaryDisclosure: "pause_for_user",
      });

      expect(resolution.status).toBe("needs_you");
    }
  });

  test("ambiguous or incomplete ranges stay unanswered", () => {
    const field = control({
      label: "Years of professional experience",
      options: ["5–12", "10+"],
      questionKind: "experience",
    });
    const answerSources = sources([]);
    answerSources.profile.yearsExperience = 12;
    const resolution = resolveApplyAnswer({
      control: field,
      sources: answerSources,
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).toBe("needs_you");
  });
});

describe("technical skills answers", () => {
  test("uses only the skills saved in the profile", () => {
    const answerSources = sources([]);
    answerSources.profile.skills = ["React", "TypeScript", "Design Systems"];
    answerSources.profile.skillGroups = {
      coreSkills: ["React", "TypeScript"],
      tools: [],
      languagesAndFrameworks: [],
      softSkills: [],
      highlightedSkills: ["Design Systems"],
    };

    const resolution = resolveApplyAnswer({
      control: control({
        kind: "long_text",
        label: "Which technical skills would you bring?",
        options: [],
        questionKind: "other",
        answerControlType: "text",
      }),
      sources: answerSources,
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).toBe("answered");
    if (resolution.status === "answered") {
      expect(resolution.answer.value).toBe("React, TypeScript, Design Systems");
      expect(resolution.answer.groundedIn).toEqual([
        "the technical skills saved in your profile",
      ]);
    }
  });

  test.each([
    "How many years have you used these technologies?",
    "Which technologies have you never used?",
  ])("does not turn saved skills into an answer for %s", (label) => {
    const answerSources = sources([]);
    answerSources.profile.skills = ["React", "TypeScript"];

    const resolution = resolveApplyAnswer({
      control: control({
        kind: "long_text",
        label,
        options: [],
        questionKind: label.startsWith("How many") ? "experience" : "other",
        answerControlType: "text",
      }),
      sources: answerSources,
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).not.toBe("answered");
  });
});

describe("an answer the person saved earlier", () => {
  test("is found again by the question's own label", () => {
    const field = control();
    const resolved = resolveReusableAnswer(field, [
      savedAnswer(field.label, "No"),
    ]);

    expect(resolved?.value).toBe("No");
  });

  test("is found when the pause said label and group together", () => {
    const field = control({ groupLabel: "Phone", label: "Phone" });
    // "Phone — Phone" is what the pause used to carry for this field.
    const resolved = resolveReusableAnswer(field, [
      savedAnswer("Phone — Phone", "+44 7700 900000"),
    ]);

    expect(resolved?.value).toBe("+44 7700 900000");
  });

  test("answers the yes/no question rather than asking it again", () => {
    const field = control();
    const resolution = resolveApplyAnswer({
      control: field,
      sources: sources([savedAnswer(field.label, "no")]),
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).toBe("answered");
    if (resolution.status === "answered") {
      expect(resolution.answer.value).toBe("No");
    }
  });

  test("does not reuse a source answer for a one-word company field", () => {
    const resolved = resolveReusableAnswer(
      control({
        label: "Company",
        groupLabel: "Work experience 1",
        kind: "text",
        options: [],
        answerControlType: "text",
      }),
      [
        savedAnswer(
          "How did you hear about this job? Job board Company website Referral",
          "Job board",
        ),
      ],
    );

    expect(resolved).toBeNull();
  });

  test("uses the saved job source instead of a portfolio URL mentioned by an option", () => {
    const sourceQuestion =
      "How did you hear about this job? Select an option Job board Company website Referral Other";
    const answerSources = sources([savedAnswer(sourceQuestion, "Job board")]);
    answerSources.profile = CandidateProfileSchema.parse({
      ...answerSources.profile,
      portfolioUrl: "https://portfolio.example.test",
    });
    const resolution = resolveApplyAnswer({
      control: control({
        label: sourceQuestion,
        options: ["Job board", "Company website", "Referral", "Other"],
      }),
      sources: answerSources,
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).toBe("answered");
    if (resolution.status === "answered") {
      expect(resolution.answer.value).toBe("Job board");
      expect(resolution.answer.sourceId).toBe("answerLibrary.answer_1");
    }
  });

  test("descriptive saved prose is context for the model to map to a choice", () => {
    const field = control({ options: ["Yes", "No"] });
    const resolution = resolveApplyAnswer({
      control: field,
      sources: sources([savedAnswer(field.label, "Only as a contractor")]),
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution).toMatchObject({
      status: "map_choice",
      context: { value: "Only as a contractor" },
    });
  });
});

describe("repeatable work-history fields", () => {
  function workHistorySources(): ApplyAnswerSources {
    const answerSources = sources([
      savedAnswer(
        "How did you hear about this job? Job board Company website Referral",
        "Job board",
      ),
    ]);
    answerSources.profile = CandidateProfileSchema.parse({
      ...answerSources.profile,
      experiences: [
        {
          id: "experience_signal",
          companyName: "Signal Systems",
          title: "Staff Frontend Engineer",
          startDate: "2014-01",
          isCurrent: true,
          summary: "Led design system modernization.",
        },
        {
          id: "experience_orbit",
          companyName: "Orbit Labs",
          title: "Frontend Engineer",
          startDate: "2011-01",
          endDate: "2013-12",
          summary: "Built accessible product interfaces.",
        },
      ],
    });
    return answerSources;
  }

  test.each([
    ["Work experience 1", "Job title", "Staff Frontend Engineer"],
    ["Work experience 1", "Company", "Signal Systems"],
    ["Work experience 1", "From", "2014-01"],
    ["Work experience 1", "Description", "Led design system modernization."],
    ["Work experience 2", "Job title", "Frontend Engineer"],
    ["Work experience 2", "Company", "Orbit Labs"],
    ["Work experience 2", "To (optional)", "2013-12"],
  ])(
    "uses %s — %s from the matching saved role",
    (groupLabel, label, expected) => {
      const resolution = resolveApplyAnswer({
        control: control({
          groupLabel,
          label,
          kind: "text",
          options: [],
          answerControlType: "text",
        }),
        sources: workHistorySources(),
        salaryDisclosure: "pause_for_user",
      });

      expect(resolution.status).toBe("answered");
      if (resolution.status === "answered") {
        expect(resolution.answer.value).toBe(expected);
        expect(resolution.answer.provenanceLabel).toBe(
          "your saved work history",
        );
      }
    },
  );

  test("does not fill a missing repeatable role from the target job or a source answer", () => {
    const resolution = resolveApplyAnswer({
      control: control({
        groupLabel: "Work experience 3",
        label: "Company",
        kind: "text",
        options: [],
        answerControlType: "text",
      }),
      sources: workHistorySources(),
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution).toMatchObject({
      status: "needs_you",
      suggestion: null,
    });
  });
});

/**
 * The retry after the person answers.
 *
 * Three questions answered in Needs you, a page read fresh with its controls
 * renumbered, and every one of those answers has to land — otherwise the
 * person answers the same questions again and the list grows.
 */
describe("a retry finds every answer the person gave", () => {
  const asked = [
    {
      label:
        "Are you subject to any employment agreements and/or post-employment restrictions with your current employer or a past employer?*",
      given: "No",
    },
    {
      label: "Have you previously worked at or consulted for GitLab?*",
      given: "No",
    },
    { label: "Are you located in Bangalore, India?", given: "No" },
  ];

  test("every saved answer is applied to its own select", () => {
    const saved = asked.map((entry, index) => ({
      ...savedAnswer(entry.label, entry.given),
      id: `answer_${index}`,
    }));

    for (const entry of asked) {
      const field = control({ label: entry.label, options: ["Yes", "No"] });
      const resolution = resolveApplyAnswer({
        control: field,
        sources: sources(saved),
        salaryDisclosure: "pause_for_user",
      });

      expect(resolution.status).toBe("answered");
      if (resolution.status === "answered") {
        expect(resolution.answer.value).toBe("No");
      }
    }
  });

  test("an answer saved as the option's own words still matches", () => {
    const field = control({
      label: "Are you located in Bangalore, India?",
      options: ["Yes", "No"],
    });
    const resolution = resolveApplyAnswer({
      control: field,
      sources: sources([savedAnswer(field.label, "no ")]),
      salaryDisclosure: "pause_for_user",
    });

    expect(resolution.status).toBe("answered");
  });
});

describe("work authorization answers follow the job's country", () => {
  function withCountries(
    countries: string[],
    location: string,
    requiresVisaSponsorship: boolean | null = false,
  ): ApplyAnswerSources {
    const base = sources([]);
    return {
      ...base,
      profile: CandidateProfileSchema.parse({
        ...base.profile,
        workEligibility: {
          ...base.profile.workEligibility,
          authorizedWorkCountries: countries,
          requiresVisaSponsorship,
        },
      }),
      posting: { ...base.posting, location },
    };
  }

  function authorizationQuestion(label: string, options = ["Yes", "No"]) {
    return control({
      label,
      questionKind: "work_authorization",
      options,
    });
  }

  test("answers Yes with the country the question names when the list has it", () => {
    const result = resolveApplyAnswer({
      control: authorizationQuestion(
        "Are you legally authorized to work in the United States?",
        [],
      ),
      sources: withCountries(["Canada", "United States"], "Remote"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: {
        value: "Yes — authorised to work in United States",
        sourceId: "profile.workEligibility.authorizedWorkCountries",
      },
    });
  });

  test("uses the job's country when the question names none, with EU membership counting", () => {
    const result = resolveApplyAnswer({
      control: authorizationQuestion(
        "Are you legally authorized to work in the country where this role is located?",
      ),
      sources: withCountries(["European Union"], "Berlin, Germany"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "Yes" },
    });
  });

  test("answers No when the named country is clearly not on the list", () => {
    // Authorized only in Germany, applying to a US job: "Yes" was a legal
    // misstatement.
    const result = resolveApplyAnswer({
      control: authorizationQuestion(
        "Are you legally authorized to work in the U.S.?",
      ),
      sources: withCountries(["Germany"], "Berlin, Germany"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "No" },
    });
  });

  test("hands the question back when neither the question nor the job names a country", () => {
    const result = resolveApplyAnswer({
      control: authorizationQuestion(
        "Are you authorized to work in the country where this job is located?",
      ),
      sources: withCountries(["Germany"], "Remote"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({ status: "needs_you", suggestion: null });
    expect(result.status === "needs_you" && result.reason).toContain("Germany");
  });

  test("hands back a free-text question instead of writing an answer", () => {
    const result = resolveApplyAnswer({
      control: control({
        kind: "text",
        label: "Describe your right to work for us",
        questionKind: "work_authorization",
        options: [],
      }),
      sources: withCountries(["Germany"], "Remote, Worldwide"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result.status).toBe("needs_you");
  });

  test("hands back when another member state's rules depend on citizenship", () => {
    // A German work visa does not cover Austria; German citizenship does.
    const result = resolveApplyAnswer({
      control: authorizationQuestion("Are you eligible to work in Austria?"),
      sources: withCountries(["Germany"], "Vienna, Austria"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result.status).toBe("needs_you");
  });

  test("does not claim no sponsorship is needed for a country the list leaves out", () => {
    const result = resolveApplyAnswer({
      control: control({
        label:
          "Will you now or in the future require sponsorship to work in the United States?",
        questionKind: "visa_sponsorship",
      }),
      sources: withCountries(["Germany"], "New York, NY"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result.status).toBe("needs_you");
  });

  test("keeps the saved sponsorship answer for a country on the list", () => {
    const result = resolveApplyAnswer({
      control: control({
        label: "Will you require visa sponsorship?",
        questionKind: "visa_sponsorship",
      }),
      sources: withCountries(["United Kingdom"], "Manchester, United Kingdom"),
      salaryDisclosure: "pause_for_user",
    });

    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "No" },
    });
  });
});

describe("what the person is told when a question comes back", () => {
  test("an unsettled work-country question says which countries the profile has", () => {
    const base = sources([]);
    const control_ = control({
      label:
        "Are you legally authorized to work in the country where this job is based?",
      questionKind: "work_authorization",
      options: ["Yes", "No"],
    });
    const resolution = resolveApplyAnswer({
      control: control_,
      sources: {
        ...base,
        profile: {
          ...base.profile,
          workEligibility: {
            ...base.profile.workEligibility,
            authorizedWorkCountries: ["Germany"],
          },
        },
        posting: { ...base.posting, location: "Remote, Europe" },
      },
      salaryDisclosure: "pause_for_user",
    });
    expect(resolution.status).toBe("needs_you");
    const question = buildPendingQuestion({
      control: control_,
      jobId: "job_1",
      detectedAt: "2026-09-24T10:00:00.000Z",
      suggestion: null,
      reason: resolution.status === "needs_you" ? resolution.reason : null,
    });
    expect(question.note).toMatch(/Germany/);

    // The bare "nothing answers this" is the card's own heading already.
    const bare = buildPendingQuestion({
      control: control_,
      jobId: "job_1",
      detectedAt: "2026-09-24T10:00:00.000Z",
      suggestion: null,
      reason: NO_STORED_ANSWER_REASON,
    });
    expect(bare.note).toBeUndefined();
  });
});

describe("a notice period or start date with nothing saved", () => {
  test("goes to the person instead of being written", () => {
    for (const [label, questionKind] of [
      ["What is your notice period?", "notice_period"],
      ["When can you start?", "availability"],
    ] as const) {
      const result = resolveApplyAnswer({
        control: control({
          kind: "long_text",
          label,
          questionKind,
          options: [],
          answerControlType: "text",
        }),
        sources: sources([]),
        salaryDisclosure: "pause_for_user",
      });
      expect(result.status).toBe("needs_you");
    }
  });

  test("a saved answer still answers it", () => {
    const result = resolveApplyAnswer({
      control: control({
        kind: "long_text",
        label: "What is your notice period?",
        questionKind: "notice_period",
        options: [],
        answerControlType: "text",
      }),
      sources: sources([
        savedAnswer("What is your notice period?", "Two weeks"),
      ]),
      salaryDisclosure: "pause_for_user",
    });
    expect(result).toMatchObject({
      status: "answered",
      answer: { value: "Two weeks" },
    });
  });
});

describe("saved answer control identity on resumption", () => {
  test("matches a question shown only as a placeholder", () => {
    const input = sources([
      savedAnswer("What is your notice period?", "Two weeks"),
    ]);
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "text",
          label: "",
          placeholder: "What is your notice period?",
          options: [],
          questionKind: "notice_period",
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "Two weeks", sourceKind: "answer_library" },
    });
  });
  test("a deduplicated question beats an older general profile answer", () => {
    const input = sources([savedAnswer("Notice period", "Two weeks")]);
    input.profile.answerBank.noticePeriod = "Three months";
    expect(
      resolveApplyAnswer({
        control: control({
          kind: "text",
          label: "Notice period",
          groupLabel: "Notice period",
          options: [],
          questionKind: "notice_period",
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      }),
    ).toMatchObject({
      status: "answered",
      answer: { value: "Two weeks", sourceKind: "answer_library" },
    });
  });
  test.each([
    ["January 2014", "month", "2014-01"],
    ["2014-01-23", "month", "2014-01"],
    ["2014-01-23", "date", "2014-01-23"],
    ["January 2014", "date", null],
    ["2014", "month", null],
  ] as const)(
    "fits %s to a %s input without inventing dates",
    (startDate, dateInputType, expected) => {
      const input = sources([]);
      input.profile = CandidateProfileSchema.parse({
        ...input.profile,
        experiences: [
          {
            id: "signal",
            companyName: "Signal Systems",
            title: "Engineer",
            startDate,
            isCurrent: true,
          },
        ],
      });
      const result = resolveApplyAnswer({
        control: control({
          kind: "date",
          dateInputType,
          label: "From",
          groupLabel: "Work experience 1",
          options: [],
          questionKind: "experience",
        }),
        sources: input,
        salaryDisclosure: "pause_for_user",
      });
      expect(result.status).toBe(expected ? "answered" : "needs_you");
      if (result.status === "answered")
        expect(result.answer.value).toBe(expected);
    },
  );
});

test("a calling-code-only picker uses the saved international phone rather than residence", () => {
  const answerSources = sources([]);
  answerSources.profile.phone = "+351912345678";
  answerSources.profile.currentCountry = "Portugal";
  expect(
    resolveApplyAnswer({
      control: control({
        label: "Phone country code",
        questionKind: "location",
        options: ["+1", "+44", "+49", "+351", "+961"],
      }),
      sources: answerSources,
      salaryDisclosure: "pause_for_user",
    }),
  ).toMatchObject({
    status: "answered",
    answer: { value: "+351", sourceId: "profile.phoneCountry" },
  });
});
