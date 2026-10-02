import {
  CandidateProfileSchema,
  type RawApplyControl,
  type RawApplyPage,
} from "@nordri/contracts";
import { describe, expect, test } from "vitest";

import { buildApplyFormObservation } from "./page-hands";
import { resolveApplyAnswer } from "./answer-sourcing";

function rawPage(password: string): RawApplyPage {
  return {
    url: "https://fixture.example/sign-in",
    title: "Sign in",
    bodyText: "Sign in to continue",
    headings: [],
    controls: [
      {
        index: 0,
        tagName: "input",
        inputType: "password",
        role: "textbox",
        id: "password",
        name: "password",
        label: "Password",
        groupLabel: "",
        placeholder: "Password",
        autocomplete: "current-password",
        required: true,
        invalid: false,
        validationMessage: "",
        disabled: false,
        readOnly: false,
        visible: true,
        value: password,
        checked: false,
        multiple: false,
        options: [],
        selectedOptionLabel: "",
      },
    ],
    actions: [
      {
        index: 0,
        label: "Sign in",
        visible: true,
        disabled: false,
      },
    ],
    links: [],
    clickables: [],
    openedTabs: [],
    validationErrors: [],
    stepLabel: null,
    loading: false,
  };
}

describe("buildApplyFormObservation credential redaction", () => {
  test("reports password presence without exposing its value", () => {
    const password = "test-secret-value";
    const observation = buildApplyFormObservation(
      rawPage(password),
      "2026-09-22T10:00:00.000Z",
    );

    expect(observation.controls[0]).toMatchObject({
      credentialRole: "password",
      value: "",
      answered: true,
    });
    expect(JSON.stringify(observation)).not.toContain(password);
  });
});

describe("buildApplyFormObservation work-history rows", () => {
  const profile = CandidateProfileSchema.parse({
    id: "synthetic_profile",
    fullName: "Taylor Example",
    yearsExperience: 8,
    baseResume: {
      id: "synthetic_resume",
      fileName: "resume.txt",
      uploadedAt: "2026-10-01T10:00:00.000Z",
    },
    experiences: [
      { id: "first_role", title: "Platform Engineer", companyName: "Cedar" },
      {
        id: "second_role",
        title: "Teaching Assistant",
        companyName: "Example School",
      },
    ],
  });

  function role(
    index: number,
    overrides: Partial<RawApplyControl> = {},
  ): RawApplyControl {
    const source = rawPage("").controls[0];
    if (!source) throw new Error("Expected the fixture control.");
    return {
      ...source,
      index,
      inputType: "text",
      id: `experience_${index}_title`,
      name: `experience_${index}_title`,
      label: "Job title",
      groupLabel: `Work experience ${index + 1}`,
      placeholder: "",
      autocomplete: "",
      ...overrides,
    };
  }

  function answers(controls: RawApplyControl[]) {
    return buildApplyFormObservation(
      { ...rawPage(""), controls },
      "2026-10-01T10:00:00.000Z",
    ).controls.map((control) => ({
      index: control.workHistoryIndex,
      resolution: resolveApplyAnswer({
        control,
        sources: {
          profile,
          resumeText: null,
          posting: {
            title: "Engineer",
            company: "Cedar",
            location: "Manchester",
            description: "",
          },
          reusableAnswers: [],
          documents: [],
        },
        salaryDisclosure: "pause_for_user",
      }),
    }));
  }

  test.each([
    { visible: false },
    { visible: false, value: "Platform Engineer" },
  ])("keeps a hidden first row's slot: %j", (hidden) => {
    const result = answers([role(0, hidden), role(1)]);
    expect(result[1]).toMatchObject({
      index: 1,
      resolution: {
        status: "answered",
        answer: {
          value: "Teaching Assistant",
          sourceId: "profile.experiences.second_role.title",
        },
      },
    });
  });

  test("renumbers rows actually removed from the DOM", () => {
    expect(answers([role(1), role(3)])).toMatchObject([
      { index: 0, resolution: { answer: { value: "Platform Engineer" } } },
      { index: 1, resolution: { answer: { value: "Teaching Assistant" } } },
    ]);
  });

  test.each([false, true])(
    "ignores a hidden location template with a default (disabled: %s)",
    (disabled) => {
      const result = answers([
        role(0, {
          visible: false,
          disabled,
          tagName: "select",
          inputType: "",
          id: "experience_template_location",
          name: "experience_template_location",
          label: "Location",
          value: "US",
          options: ["United States"],
          selectedOptionLabel: "United States",
        }),
        role(1),
      ]);
      expect(result[1]).toMatchObject({
        index: 0,
        resolution: {
          answer: {
            value: "Platform Engineer",
            sourceId: "profile.experiences.first_role.title",
          },
        },
      });
    },
  );

  test.each([
    { disabled: true },
    { id: "experience_template_title" },
    { name: "experience_template_title" },
    {
      disabled: true,
      tagName: "select",
      inputType: "",
      label: "Location",
      selectedOptionLabel: "Choose a location",
    },
  ])("ignores a hidden empty template row: %j", (template) => {
    expect(
      answers([
        role(0, { visible: false, ...template }),
        role(1),
        role(3),
      ]).slice(1),
    ).toMatchObject([
      { index: 0, resolution: { answer: { value: "Platform Engineer" } } },
      { index: 1, resolution: { answer: { value: "Teaching Assistant" } } },
    ]);
  });
});

describe("buildApplyFormObservation radio groups", () => {
  test("uses form scope and DOM name instead of merging equal wording", () => {
    const source = rawPage("");
    const template = source.controls[0];
    if (!template) throw new Error("Expected the fixture control.");
    source.controls = [
      ...["Yes", "No"].map((label, index) => ({
        ...template,
        index,
        inputType: "radio",
        name: "authorized",
        scopeKey: "form0",
        label,
        groupLabel: "Are you authorized?",
        value: label,
        checked: index === 0,
      })),
      ...["Yes", "No"].map((label, index) => ({
        ...template,
        index: index + 2,
        inputType: "radio",
        name: "authorized",
        scopeKey: "form1",
        label,
        groupLabel: "Are you authorized?",
        value: label,
        checked: false,
      })),
    ];

    const observation = buildApplyFormObservation(
      source,
      "2026-09-22T10:00:00.000Z",
    );

    expect(observation.controls.map((control) => control.answered)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(observation.controls[0]?.choiceGroupKey).not.toBe(
      observation.controls[2]?.choiceGroupKey,
    );
    expect(observation.controls.map((control) => control.options)).toEqual([
      ["Yes", "No"],
      ["Yes", "No"],
      ["Yes", "No"],
      ["Yes", "No"],
    ]);
  });

  test("does not merge unnamed radios only because their wording matches", () => {
    const source = rawPage("");
    const template = source.controls[0];
    if (!template) throw new Error("Expected the fixture control.");
    source.controls = [0, 1].map((index) => ({
      ...template,
      index,
      inputType: "radio",
      name: "",
      label: "Yes",
      groupLabel: "Are you authorized?",
      value: "Yes",
      checked: index === 0,
    }));

    const observation = buildApplyFormObservation(
      source,
      "2026-09-22T10:00:00.000Z",
    );
    expect(observation.controls.map((control) => control.answered)).toEqual([
      true,
      false,
    ]);
    expect(observation.controls.map((control) => control.options)).toEqual([
      ["Yes"],
      ["Yes"],
    ]);
  });
});
