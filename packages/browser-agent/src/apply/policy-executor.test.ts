import {
  CandidateProfileSchema,
  type CandidateProfile,
} from "@nordri/contracts";
import { describe, expect, test, vi } from "vitest";

import {
  buildPendingQuestion,
  createApplyGuardState,
  executeApplyProposal,
} from "./policy-executor";
import type { RawApplyControl, RawApplyPage } from "@nordri/contracts";
import { buildApplyFormObservation } from "./page-hands";
import { runSubmitPreflight } from "./submit-preflight";
import type {
  ApplyAgentConfig,
  ApplyAuthority,
  ApplyFormObservation,
  ApplyPageHands,
} from "./types";

function rawControl(
  overrides: Partial<RawApplyControl> & { index: number },
): RawApplyControl {
  return {
    tagName: "input",
    inputType: "text",
    role: "",
    id: `field_${overrides.index}`,
    name: `field_${overrides.index}`,
    label: "",
    groupLabel: "",
    placeholder: "",
    autocomplete: "",
    required: false,
    invalid: false,
    validationMessage: "",
    disabled: false,
    readOnly: false,
    visible: true,
    value: "",
    checked: false,
    multiple: false,
    options: [],
    selectedOptionLabel: "",
    ...overrides,
  };
}

function rawPage(overrides: Partial<RawApplyPage> = {}): RawApplyPage {
  return {
    url: "https://apply.example.test/form",
    title: "Apply",
    bodyText: "Apply for the role",
    controls: [],
    actions: [],
    links: [],
    headings: [],
    clickables: [],
    openedTabs: [],
    loading: false,
    validationErrors: [],
    stepLabel: null,
    ...overrides,
  };
}

function observationOf(page: RawApplyPage): ApplyFormObservation {
  return buildApplyFormObservation(page, "2026-09-14T10:00:00.000Z");
}

function profile(): CandidateProfile {
  return CandidateProfileSchema.parse({
    id: "candidate_test",
    firstName: "Robin",
    lastName: "Ashford",
    fullName: "Robin Ashford",
    headline: "Platform engineer",
    summary: "Builds dependable internal tools.",
    currentLocation: "Manchester, United Kingdom",
    yearsExperience: 8,
    email: "robin.ashford@example.test",
    baseResume: {
      id: "resume_test",
      fileName: "resume.txt",
      uploadedAt: "2026-09-01T09:00:00.000Z",
      textContent: "8 years of platform engineering.",
      textUpdatedAt: "2026-09-01T09:00:00.000Z",
      extractionStatus: "ready",
    },
  });
}

function authority(overrides: Partial<ApplyAuthority> = {}): ApplyAuthority {
  return {
    mode: "prepare_only",
    submitAuthorized: false,
    preApprovedAttestationKinds: [],
    salaryDisclosure: "pause_for_user",
    allowedOrigins: [],
    ...overrides,
  };
}

function configFor(
  page: RawApplyPage,
  overrides: {
    accountCreationAuthorized?: boolean;
    authority?: Partial<ApplyAuthority>;
    hands?: Partial<ApplyPageHands>;
  } = {},
): { config: ApplyAgentConfig; hands: ApplyPageHands } {
  const hands: ApplyPageHands = {
    observe: () => Promise.resolve(observationOf(page)),
    navigate: () =>
      Promise.resolve({ ok: true, url: "https://apply.example.test/form" }),
    clickElement: () => Promise.resolve({ ok: true, observedValue: "clicked" }),
    scroll: () => Promise.resolve({ ok: true, observedValue: "down" }),
    wait: () => Promise.resolve(),
    goBack: () =>
      Promise.resolve({ ok: true, url: "https://apply.example.test/form" }),
    readText: () => Promise.resolve("Apply for the role"),
    fillText: (_ref, value) =>
      Promise.resolve({ ok: true, observedValue: value }),
    chooseOption: (_ref, option) =>
      Promise.resolve({ ok: true, observedValue: option }),
    setToggle: (_ref, checked) =>
      Promise.resolve({
        ok: true,
        observedValue: checked ? "checked" : "unchecked",
      }),
    uploadFile: (_ref, file) =>
      Promise.resolve({ ok: true, observedValue: file.name }),
    clickAction: () => Promise.resolve({ ok: true, observedValue: "clicked" }),
    followLink: () =>
      Promise.resolve({ ok: true, url: "https://apply.example.test/form" }),
    ...overrides.hands,
  };
  return {
    hands,
    config: {
      hands,
      accountCreationAuthorized: overrides.accountCreationAuthorized,
      authority: authority(overrides.authority),
      sources: {
        profile: profile(),
        resumeText: "Robin Ashford. 8 years of platform engineering.",
        posting: {
          title: "Platform Engineer",
          company: "Northwind Tools",
          location: "Manchester",
          description: "Own the internal platform.",
        },
        reusableAnswers: [],
        documents: [],
      },
      application: {
        jobId: "job_test",
        applicationId: "application_test",
        startingUrl: "https://apply.example.test/form",
      },
      siteLabel: "the careers site",
    },
  };
}

const now = () => new Date("2026-09-14T10:00:00.000Z");

describe("apply policy executor", () => {
  test.each([false, true])(
    "does not write unsupported personal experience (required=%s)",
    async (required) => {
      const source = rawPage({
        controls: [
          rawControl({
            index: 0,
            tagName: "textarea",
            required,
            label:
              "Tell me about a feature you built using an AI coding assistant",
          }),
        ],
      });
      const fillText = vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          observedValue: "written",
        }),
      );
      const { config } = configFor(source, { hands: { fillText } });
      const checkWrittenAnswer = vi.fn(() =>
        Promise.resolve({
          supported: false,
          reason:
            "No supplied applicant fact says they used an AI coding assistant.",
        }),
      );
      const result = await executeApplyProposal(
        {
          tool: "type",
          ref: "c0",
          text: "I use an AI coding assistant every day.",
          groundedIn: ["general industry practice"],
        },
        observationOf(source).signature,
        {
          config,
          now,
          guardState: createApplyGuardState(),
          checkWrittenAnswer,
        },
      );
      expect(checkWrittenAnswer).toHaveBeenCalledOnce();
      expect(fillText).not.toHaveBeenCalled();
      expect(result.kind).toBe("suggestion");
      if (result.kind !== "suggestion")
        throw new Error("Expected grounded-answer handoff");
      expect(result.question !== null).toBe(required);
      expect(result.note).toContain("continue with the other fields");
    },
  );

  test("writes supported prose after the applicant-fact check", async () => {
    const source = rawPage({
      controls: [
        rawControl({ index: 0, tagName: "textarea", label: "Why this role?" }),
      ],
    });
    const fillText = vi.fn((_ref: string, value: string) =>
      Promise.resolve({
        ok: true as const,
        observedValue: value,
      }),
    );
    const { config } = configFor(source, { hands: { fillText } });
    const result = await executeApplyProposal(
      {
        tool: "type",
        ref: "c0",
        text: "I would like to build reliable tools.",
      },
      observationOf(source).signature,
      {
        config,
        now,
        guardState: createApplyGuardState(),
        checkWrittenAnswer: () =>
          Promise.resolve({
            supported: true,
            reason: "Motivation, without unsupported personal history.",
          }),
      },
    );
    expect(result.kind).toBe("filled");
    expect(fillText).toHaveBeenCalledWith(
      "c0",
      "I would like to build reliable tools.",
    );
    if (result.kind === "filled") {
      expect(result.filled.answer.sourceKind).toBe("generated");
    }
  });
  test("never touches a security-check box, even one the person already ticked", async () => {
    const source = rawPage({
      bodyText: "Apply I am not a robot Local fake CAPTCHA",
      controls: [
        rawControl({ index: 0, label: "Full name", value: "Robin Ashford" }),
        rawControl({
          index: 1,
          inputType: "checkbox",
          role: "checkbox",
          label: "I am not a robot",
          checked: true,
        }),
      ],
    });
    const setToggle = vi.fn(() =>
      Promise.resolve({ ok: true as const, observedValue: "unchecked" }),
    );
    const { config } = configFor(source, { hands: { setToggle } });
    const result = await executeApplyProposal(
      { tool: "set_checkbox", ref: "c1", checked: true },
      observationOf(source).signature,
      { config, now, guardState: createApplyGuardState() },
    );
    expect(result.kind).toBe("refused");
    expect(setToggle).not.toHaveBeenCalled();
  });
  test("refuses an account-creation link when this run has no account authority", async () => {
    const page = rawPage({
      bodyText: "Sign in or create an account to continue.",
      links: [
        {
          index: 0,
          label: "Create account",
          href: "https://apply.example.test/register",
          target: "",
          visible: true,
          topOffset: 10,
        },
      ],
    });
    const followLink = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        url: "https://apply.example.test/register",
      }),
    );
    const { config } = configFor(page, { hands: { followLink } });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "follow_link", ref: "l0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("Expected refusal.");
    expect(outcome.reason).toMatch(/account has not been authorized/i);
    expect(followLink).not.toHaveBeenCalled();
  });

  test("permits an account-creation link only with exact account authority", async () => {
    const page = rawPage({
      links: [
        {
          index: 0,
          label: "Register",
          href: "https://apply.example.test/register",
          target: "",
          visible: true,
          topOffset: 10,
        },
      ],
    });
    const followLink = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        url: "https://apply.example.test/register",
      }),
    );
    const { config } = configFor(page, {
      accountCreationAuthorized: true,
      hands: { followLink },
    });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "follow_link", ref: "l0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("moved");
    expect(followLink).toHaveBeenCalledOnce();
  });

  test("keeps a continuation on its retained form instead of following the site header home", async () => {
    const page = rawPage({
      url: "https://apply.example.test/workday/apply/2?stage=application",
      controls: [
        rawControl({ index: 0, label: "First name", inputType: "text" }),
      ],
      actions: [
        {
          index: 0,
          label: "Submit application",
          visible: true,
          disabled: false,
        },
      ],
      links: [
        {
          index: 0,
          label: "Careers home",
          href: "https://apply.example.test/workday/",
          target: "",
          visible: true,
          topOffset: 10,
        },
      ],
    });
    const followLink = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        url: "https://apply.example.test/workday/",
      }),
    );
    const { config } = configFor(page, { hands: { followLink } });
    config.application.continuation = {
      sourceUrls: ["https://apply.example.test/workday/jobs/2"],
    };
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "follow_link", ref: "l0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") throw new Error("Expected refusal.");
    expect(outcome.reason).toMatch(/retained application form/i);
    expect(followLink).not.toHaveBeenCalled();
  });

  test("a continuation can still advance to another page inside its wizard", async () => {
    const page = rawPage({
      url: "https://apply.example.test/workday/apply/2?stage=application",
    });
    const navigate = vi.fn((url: string) =>
      Promise.resolve({ ok: true as const, url }),
    );
    const { config } = configFor(page, { hands: { navigate } });
    config.application.continuation = {
      sourceUrls: ["https://apply.example.test/workday/jobs/2"],
    };
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      {
        tool: "navigate",
        url: "https://apply.example.test/workday/apply/2?stage=review",
      },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("moved");
    expect(navigate).toHaveBeenCalledOnce();
  });

  test("a continuation may leave an account landing page to reach its known job", async () => {
    const landing = rawPage({
      url: "https://apply.example.test/workday/account",
      controls: [
        rawControl({
          index: 0,
          label: "Search jobs",
          inputType: "search",
          required: false,
        }),
      ],
    });
    const navigate = vi.fn((url: string) =>
      Promise.resolve({ ok: true as const, url }),
    );
    const { config } = configFor(landing, { hands: { navigate } });
    config.application.continuation = {
      sourceUrls: ["https://apply.example.test/workday/jobs/2"],
    };
    const observation = observationOf(landing);

    const outcome = await executeApplyProposal(
      {
        tool: "navigate",
        url: "https://apply.example.test/workday/jobs/2",
      },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("moved");
    expect(navigate).toHaveBeenCalledOnce();
  });

  test("stops before pressing a credential-form action outside the task-local credential path", async () => {
    const page = rawPage({
      url: "https://apply.example.test/signin",
      bodyText: "Sign in to continue",
      controls: [
        rawControl({
          index: 0,
          label: "Password",
          inputType: "password",
          required: true,
        }),
      ],
      actions: [
        {
          index: 0,
          label: "Sign in",
          visible: true,
          disabled: false,
        },
      ],
    });
    const clickElement = vi.fn(() =>
      Promise.resolve({ ok: true as const, observedValue: "clicked" }),
    );
    const { config } = configFor(page, { hands: { clickElement } });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "click", ref: "a0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome).toMatchObject({
      kind: "paused",
      pause: { blocker: { code: "site_login_required" } },
    });
    expect(clickElement).not.toHaveBeenCalled();
  });

  test("never types a model-proposed value into a credential form", async () => {
    const page = rawPage({
      url: "https://apply.example.test/signin",
      bodyText: "Sign in to continue",
      controls: [
        rawControl({
          index: 0,
          label: "Password",
          inputType: "password",
          required: true,
        }),
      ],
      actions: [
        {
          index: 0,
          label: "Sign in",
          visible: true,
          disabled: false,
        },
      ],
    });
    const fillText = vi.fn(() =>
      Promise.resolve({ ok: true as const, observedValue: "redacted" }),
    );
    const { config } = configFor(page, { hands: { fillText } });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      {
        tool: "type",
        ref: "c0",
        text: "invented-password",
        groundedIn: ["the posting"],
      },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome).toMatchObject({
      kind: "paused",
      pause: { blocker: { code: "site_login_required" } },
    });
    expect(fillText).not.toHaveBeenCalled();
  });

  test("fills a known field from the person's own profile, not from the model", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config, hands } = configFor(page);
    const fillText = vi.spyOn(hands, "fillText");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "someone.else@example.test" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    expect(fillText).toHaveBeenCalledWith("c0", "robin.ashford@example.test");
  });

  // A value about the person goes into the form exactly as stored, whatever
  // the model typed and however the record id was shortened.
  test.each([
    {
      label: "Phone",
      inputType: "tel",
      typed: "+49 555 0000000",
      expected: "+49 555 1234567-88",
    },
    {
      label: "LinkedIn URL",
      inputType: "url",
      typed: "https://www.linkedin.com/in/robin-ashford",
      expected: "https://www.linkedin.com/in/robin-ashford-test-profile-2026",
    },
    {
      label: "GitHub",
      inputType: "url",
      typed: "https://github.com/robin",
      expected: "https://github.com/robin-ashford-builds",
    },
    {
      label: "Portfolio website",
      inputType: "url",
      typed: "https://robin.example.test",
      expected: "https://portfolio.example.test/robin-ashford/work",
    },
  ])(
    "writes the stored $label exactly",
    async ({ label, inputType, typed, expected }) => {
      const page = rawPage({
        controls: [rawControl({ index: 0, label, inputType })],
      });
      const { config, hands } = configFor(page);
      const stored = config.sources.profile;
      stored.phone = "+49 555 1234567-88";
      stored.linkedinUrl =
        "https://www.linkedin.com/in/robin-ashford-test-profile-2026";
      stored.githubUrl = "https://github.com/robin-ashford-builds";
      stored.portfolioUrl = "https://portfolio.example.test/robin-ashford/work";
      stored.links = [
        {
          // Record ids are built from a shortened URL; the value is the url.
          id: "link_linkedin_https_www_linkedin_com_in_robin_ashford_",
          label: "LinkedIn",
          url: "https://www.linkedin.com/in/robin-ashford-test-profile-2026",
          kind: "linkedin",
          isDraft: false,
        },
        {
          id: "link_github_https_github_com_robin_",
          label: "GitHub",
          url: "https://github.com/robin-ashford-builds",
          kind: "github",
          isDraft: false,
        },
      ];
      const fillText = vi.spyOn(hands, "fillText");
      const observation = observationOf(page);

      const outcome = await executeApplyProposal(
        { tool: "type", ref: "c0", text: typed },
        observation.signature,
        { config, now, guardState: createApplyGuardState() },
      );

      expect(outcome.kind).toBe("filled");
      expect(fillText).toHaveBeenCalledTimes(1);
      expect(fillText.mock.calls[0]?.[1]).toBe(expected);
    },
  );

  test("does not add unsupported technologies to a technical-skills answer", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "textarea",
          label: "Which technical skills would you bring?",
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.profile.skills = ["React", "TypeScript", "Design Systems"];
    const fillText = vi.spyOn(hands, "fillText");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      {
        tool: "type",
        ref: "c0",
        text: "I improve CI/CD and support distributed teams.",
      },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    expect(fillText).toHaveBeenCalledWith(
      "c0",
      "React, TypeScript, Design Systems",
    );
  });

  test.each([
    { tool: "set_checkbox", required: true },
    { tool: "click", required: true },
    { tool: "set_checkbox", required: false },
    { tool: "click", required: false },
  ] as const)(
    "an unapproved declaration stays unticked through $tool (required=$required)",
    async ({ tool, required }) => {
      const page = rawPage({
        controls: [
          rawControl({
            index: 0,
            inputType: "checkbox",
            label:
              "I certify that the information I have given is true and complete",
            required,
          }),
        ],
      });
      const { config, hands } = configFor(page);
      const setToggle = vi.spyOn(hands, "setToggle");
      const clickElement = vi.spyOn(hands, "clickElement");
      const observation = observationOf(page);

      const outcome = await executeApplyProposal(
        tool === "click"
          ? { tool: "click", ref: "c0" }
          : { tool: "set_checkbox", ref: "c0", checked: true },
        observation.signature,
        { config, now, guardState: createApplyGuardState() },
      );

      // Not a pause: the run carries on and hands the box back with the
      // finished form. Stopping here left the rest of the form empty.
      expect(outcome.kind).toBe("suggestion");
      if (outcome.kind === "suggestion") {
        if (required) expect(outcome.question?.prompt).toContain("I certify");
        else expect(outcome.question).toBeNull();
        expect(outcome.note).toMatch(/carry on/i);
      }
      expect(setToggle).not.toHaveBeenCalled();
      expect(clickElement).not.toHaveBeenCalled();
    },
  );

  test("a declaration the person answered Yes to earlier is ticked from that saved answer", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "checkbox",
          label:
            "I certify that the information I have given is true and complete",
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.reusableAnswers = [
      {
        id: "saved_certify",
        kind: "other",
        label:
          "I certify that the information I have given is true and complete",
        question:
          "I certify that the information I have given is true and complete",
        answer: "Yes",
        roleFamilies: [],
        proofEntryIds: [],
      },
    ];
    const setToggle = vi.spyOn(hands, "setToggle");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "set_checkbox", ref: "c0", checked: true },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    if (outcome.kind === "filled") {
      expect(outcome.filled.answer.sourceKind).toBe("answer_library");
    }
    expect(setToggle).toHaveBeenCalledWith("c0", true);
  });

  test("a declaration the person pre-approved is ticked and recorded as theirs", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "checkbox",
          label:
            "I certify that the information I have given is true and complete",
        }),
      ],
    });
    const { config } = configFor(page, {
      authority: {
        preApprovedAttestationKinds: ["truthfulness_certification"],
      },
    });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "set_checkbox", ref: "c0", checked: true },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    if (outcome.kind === "filled") {
      expect(outcome.filled.answer.provenanceLabel).toBe(
        "a declaration you approved in advance",
      );
    }
  });

  test.each(["set_checkbox", "click"] as const)(
    "rejects a contradictory radio answer through %s",
    async (tool) => {
      const page = rawPage({
        controls: [
          rawControl({
            index: 0,
            inputType: "radio",
            name: "authorized",
            value: "internal_yes",
            label: "Yes",
            groupLabel: "Are you legally authorized to work in this country?",
            required: true,
          }),
          rawControl({
            index: 1,
            inputType: "radio",
            name: "authorized",
            value: "internal_no",
            label: "No",
            groupLabel: "Are you legally authorized to work in this country?",
            required: true,
          }),
        ],
      });
      const { config, hands } = configFor(page);
      config.sources.profile = CandidateProfileSchema.parse({
        ...config.sources.profile,
        answerBank: {
          ...config.sources.profile.answerBank,
          workAuthorization: "Yes",
        },
      });
      const setToggle = vi.spyOn(hands, "setToggle");
      const observation = observationOf(page);

      const outcome = await executeApplyProposal(
        tool === "click"
          ? { tool: "click", ref: "c1" }
          : { tool: "set_checkbox", ref: "c1", checked: true },
        observation.signature,
        { config, now, guardState: createApplyGuardState() },
      );

      expect(outcome.kind).toBe("refused");
      if (outcome.kind !== "refused") throw new Error("Expected refusal.");
      expect(outcome.reason).toMatch(/grounded answer is "Yes"/iu);
      expect(setToggle).not.toHaveBeenCalled();

      const groundedOutcome = await executeApplyProposal(
        tool === "click"
          ? { tool: "click", ref: "c0" }
          : { tool: "set_checkbox", ref: "c0", checked: true },
        observation.signature,
        { config, now, guardState: createApplyGuardState() },
      );

      expect(groundedOutcome).toMatchObject({
        kind: "filled",
        filled: {
          answer: {
            value: "Yes",
            sourceKind: "profile",
          },
        },
      });
      expect(setToggle).toHaveBeenCalledOnce();
    },
  );

  test("a saved prose answer that cannot choose a radio becomes a person question", async () => {
    const source = rawPage({
      controls: ["Yes", "No"].map((label, index) =>
        rawControl({
          index,
          inputType: "radio",
          name: "authorized",
          label,
          value: label,
          groupLabel: "Are you legally authorized to work in this country?",
          required: true,
        }),
      ),
    });
    const { config, hands } = configFor(source);
    config.sources.profile.answerBank.workAuthorization =
      "Authorized to work in the United Kingdom and open to remote roles across Europe.";
    const setToggle = vi.spyOn(hands, "setToggle");
    const outcome = await executeApplyProposal(
      { tool: "set_checkbox", ref: "c0", checked: true },
      observationOf(source).signature,
      { config, now, guardState: createApplyGuardState() },
    );
    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind !== "suggestion")
      throw new Error("Expected a person question");
    expect(outcome.question?.prompt).toContain("legally authorized");
    expect(outcome.note).toContain("names the country");
    expect(setToggle).not.toHaveBeenCalled();
  });

  test("overrides a proposed target-job title with the matching saved work-history fact", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          label: "Job title",
          groupLabel: "Work experience 1",
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.profile = CandidateProfileSchema.parse({
      ...config.sources.profile,
      experiences: [
        {
          id: "experience_signal",
          companyName: "Signal Systems",
          title: "Staff Frontend Engineer",
          startDate: "2014-01",
          isCurrent: true,
          summary: "Led design system modernization.",
        },
      ],
    });
    const fillText = vi.spyOn(hands, "fillText");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      {
        tool: "type",
        ref: "c0",
        text: config.sources.posting.title,
      },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    expect(fillText).toHaveBeenCalledWith("c0", "Staff Frontend Engineer");
    if (outcome.kind === "filled") {
      expect(outcome.filled.answer.sourceId).toBe(
        "profile.experiences.experience_signal.title",
      );
    }
  });

  test("pay is left to the person unless they said otherwise", async () => {
    const page = rawPage({
      controls: [
        rawControl({ index: 0, label: "Expected salary", required: true }),
      ],
    });
    const { config } = configFor(page);
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "suggest_answer", ref: "c0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind === "suggestion") {
      expect(outcome.answer).toBeNull();
      expect(outcome.note).toContain("pay");
      expect(outcome.note).toContain("needs the person");
    }
  });

  test.each([
    {
      name: "text pay answer",
      control: rawControl({
        index: 0,
        label: "Expected salary",
        required: true,
      }),
      proposal: { tool: "type" as const, ref: "c0", text: "90000" },
    },
    {
      name: "select pay answer",
      control: rawControl({
        index: 0,
        tagName: "select",
        inputType: "select-one",
        label: "Expected salary",
        options: ["80000", "90000"],
        required: true,
      }),
      proposal: { tool: "select" as const, ref: "c0", option: "90000" },
    },
    {
      name: "radio office preference",
      control: rawControl({
        index: 0,
        inputType: "radio",
        name: "office",
        value: "London",
        label: "London",
        groupLabel: "Which office would you prefer?",
        required: true,
      }),
      proposal: { tool: "set_checkbox" as const, ref: "c0", checked: true },
    },
  ])(
    "leaves an unsourced $name for the person",
    async ({ control, proposal }) => {
      const page = rawPage({ controls: [control] });
      const { config, hands } = configFor(page);
      const fillText = vi.spyOn(hands, "fillText");
      const chooseOption = vi.spyOn(hands, "chooseOption");
      const setToggle = vi.spyOn(hands, "setToggle");

      const outcome = await executeApplyProposal(
        proposal,
        observationOf(page).signature,
        { config, now, guardState: createApplyGuardState() },
      );

      expect(outcome.kind).toBe("suggestion");
      if (outcome.kind === "suggestion") {
        expect(outcome.question?.prompt).toBeTruthy();
        expect(outcome.note).toContain("person's answer");
      }
      expect(fillText).not.toHaveBeenCalled();
      expect(chooseOption).not.toHaveBeenCalled();
      expect(setToggle).not.toHaveBeenCalled();
    },
  );

  test("a saved pay answer stays private when pay disclosure is set to pause", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          inputType: "select-one",
          label: "Expected salary",
          options: ["80000", "90000"],
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.profile = CandidateProfileSchema.parse({
      ...config.sources.profile,
      answerBank: { salaryExpectations: "90000" },
    });
    const chooseOption = vi.spyOn(hands, "chooseOption");

    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "90000" },
      observationOf(page).signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind === "suggestion") {
      expect(outcome.question?.suggestedAnswers[0]?.text).toBe("90000");
    }
    expect(chooseOption).not.toHaveBeenCalled();
  });

  test("an optional preference stays empty without a person handoff", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          inputType: "select-one",
          label: "Which office would you prefer?",
          options: ["Leeds", "Bristol"],
          required: false,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const chooseOption = vi.spyOn(hands, "chooseOption");

    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "Bristol" },
      observationOf(page).signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind === "suggestion") {
      expect(outcome.question).toBeNull();
      expect(outcome.note).toContain("carry on with the rest");
    }
    expect(chooseOption).not.toHaveBeenCalled();
  });

  test("a question nothing can answer goes to the person with its exact wording", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          label: "Which of our office locations would you prefer?",
          options: ["Leeds", "Bristol"],
          required: true,
        }),
      ],
    });
    const { config } = configFor(page);
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "suggest_answer", ref: "c0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind === "suggestion") {
      // The exact question is recorded, so the person gets its own words.
      expect(outcome.question?.prompt).toBe(
        "Which of our office locations would you prefer?",
      );
      expect(outcome.question?.answerOptions).toEqual(["Leeds", "Bristol"]);
    }
  });

  test("a proposal made against a page that has since changed is refused", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config, hands } = configFor(page);
    const fillText = vi.spyOn(hands, "fillText");

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "" },
      "a-signature-from-an-older-page",
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("refused");
    expect(fillText).not.toHaveBeenCalled();
  });

  test("a reviewed employer handoff may be filled even when only the listing origin is authorized to send", async () => {
    const page = rawPage({
      url: "https://somewhere-else.example.test/form",
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config } = configFor(page, {
      authority: { allowedOrigins: ["https://apply.example.test"] },
    });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "robin@example.test" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
  });

  test("a hop to another site is reported as a fact when nothing forbids it", async () => {
    // A listing on one site whose form lives on another is the ordinary shape
    // of job applications, so it is told to the model rather than blocked.
    const page = rawPage({
      url: "https://boards.example-ats.test/form",
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config } = configFor(page);
    const guardState = createApplyGuardState();

    const outcome = await executeApplyProposal(
      { tool: "navigate", url: "https://boards.example-ats.test/form" },
      observationOf(page).signature,
      { config, now, guardState },
    );

    expect(outcome.kind).toBe("moved");
    if (outcome.kind === "moved") {
      expect(outcome.note).toContain("a different site from the listing");
    }
  });

  test("with a reviewer, leaving the listing's site needs a reason the review accepts", async () => {
    const listing = rawPage({
      url: "https://apply.example.test/form",
      controls: [],
    });
    const employer = rawPage({
      url: "https://boards.example-ats.test/form",
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    let where = listing;
    const review = vi.fn(
      (move: { url: string; reason: string; fromUrl: string | null }) =>
        Promise.resolve(
          /application form/u.test(move.reason)
            ? {
                allowed: true,
                verdict: "The listing hands off to the employer's form.",
              }
            : {
                allowed: false,
                verdict: "That reason does not say what the page is for.",
              },
        ),
    );
    const { config } = configFor(listing, {
      hands: {
        observe: () => Promise.resolve(observationOf(where)),
        navigate: (url) => {
          where = url.startsWith("https://boards") ? employer : listing;
          return Promise.resolve({ ok: true, url });
        },
        goBack: () => {
          where = listing;
          return Promise.resolve({ ok: true, url: listing.url ?? "" });
        },
      },
    });
    const withReview = { ...config, reviewMove: review };
    const guardState = createApplyGuardState();

    const noReason = await executeApplyProposal(
      { tool: "navigate", url: "https://boards.example-ats.test/form" },
      observationOf(listing).signature,
      { config: withReview, now, guardState },
    );
    expect(noReason.kind).toBe("refused");
    if (noReason.kind === "refused")
      expect(noReason.reason).toContain("say why in reason");
    expect(review).not.toHaveBeenCalled();

    const weak = await executeApplyProposal(
      {
        tool: "navigate",
        url: "https://boards.example-ats.test/form",
        reason: "Looks interesting",
      },
      observationOf(listing).signature,
      { config: withReview, now, guardState },
    );
    expect(weak.kind).toBe("refused");
    if (weak.kind === "refused")
      expect(weak.reason).toContain("did not allow going there");

    const good = await executeApplyProposal(
      {
        tool: "navigate",
        url: "https://boards.example-ats.test/form",
        reason:
          "The Apply button on the listing links here, to the employer's application form",
      },
      observationOf(listing).signature,
      { config: withReview, now, guardState },
    );
    expect(good.kind).toBe("moved");
    if (good.kind === "moved") {
      expect(good.note).toContain("allowed after review");
      expect(good.observation.url).toBe("https://boards.example-ats.test/form");
    }
    expect(
      guardState.approvedOrigins.has("https://boards.example-ats.test"),
    ).toBe(true);
    expect(guardState.notes.join("\n")).toContain("Allowed after review");
  });

  test("a sign-in wall is reported on the page rather than ending the run", async () => {
    const page = rawPage({
      bodyText: "Please sign in to continue with your application",
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config } = configFor(page);

    const observation = await config.hands.observe();

    // The model is told; what to do about it is the model's call, and it can
    // finish saying the person has to sign in.
    expect(observation.blocker?.code).toBe("site_login_required");
  });

  test("the send button is never pressed when the run may only prepare", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          label: "Email",
          inputType: "email",
          value: "robin@example.test",
        }),
      ],
      actions: [
        {
          index: 0,
          label: "Submit application",
          visible: true,
          disabled: false,
        },
      ],
    });
    const { config, hands } = configFor(page);
    const clickAction = vi.spyOn(hands, "clickAction");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "submit_application", ref: "a0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("refused");
    expect(clickAction).not.toHaveBeenCalled();
  });
});

describe("submit preflight", () => {
  const sendableAuthority = authority({
    mode: "autonomous_submit",
    submitAuthorized: true,
    allowedOrigins: ["https://apply.example.test"],
  });

  test("stops before sending on an employer origin outside the saved authority", () => {
    const observation = observationOf(
      rawPage({
        url: "https://employer.example-ats.test/form",
        stepLabel: "Step 2 of 2",
        controls: [
          rawControl({
            index: 0,
            label: "Email",
            required: true,
            value: "robin@example.test",
          }),
        ],
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    );

    const result = runSubmitPreflight({
      observation,
      proposedActionRef: "a0",
      authority: sendableAuthority,
    });

    expect(result).toEqual({
      ok: false,
      reason:
        "Job Finder is not authorized to send an application on https://employer.example-ats.test. The form is still available for review.",
    });
  });

  test("stops when a required answer is still empty", () => {
    const observation = observationOf(
      rawPage({
        controls: [rawControl({ index: 0, label: "Email", required: true })],
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    );

    const result = runSubmitPreflight({
      observation,
      proposedActionRef: "a0",
      authority: sendableAuthority,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Email");
    }
  });

  test("stops when a file the form asks for is not attached", () => {
    const observation = observationOf(
      rawPage({
        controls: [
          rawControl({
            index: 0,
            label: "Email",
            required: true,
            value: "robin@example.test",
          }),
          rawControl({
            index: 1,
            label: "Resume",
            inputType: "file",
            required: true,
          }),
        ],
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    );

    const result = runSubmitPreflight({
      observation,
      proposedActionRef: "a0",
      authority: sendableAuthority,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not attached");
    }
  });

  test("stops when there is still a step after this one", () => {
    const observation = observationOf(
      rawPage({
        stepLabel: "Step 1 of 2",
        controls: [
          rawControl({
            index: 0,
            label: "Email",
            required: true,
            value: "robin@example.test",
          }),
        ],
        actions: [
          { index: 0, label: "Next", visible: true, disabled: false },
          {
            index: 1,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    );

    const result = runSubmitPreflight({
      observation,
      proposedActionRef: "a1",
      authority: sendableAuthority,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("another step");
    }
  });

  test("passes on a complete final screen with authority", () => {
    const observation = observationOf(
      rawPage({
        stepLabel: "Step 2 of 2",
        controls: [
          rawControl({
            index: 0,
            label: "Email",
            required: true,
            value: "robin@example.test",
          }),
          rawControl({
            index: 1,
            label: "Resume",
            inputType: "file",
            required: true,
            value: "resume.pdf",
          }),
        ],
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    );

    const result = runSubmitPreflight({
      observation,
      proposedActionRef: "a0",
      authority: sendableAuthority,
    });

    expect(result.ok).toBe(true);
  });
});

describe("the letter this application sends", () => {
  const letterText =
    "Dear hiring team, I have spent eight years building internal platforms that other engineers depend on every day, and the work described in this posting is the same shape. I would bring that experience to your team and would welcome the chance to talk it through with you.";

  function lettersFor(
    document: {
      id: string;
      fileName: string;
      mimeType: string;
      label: string;
      kind: "cover_letter";
      loadBytes: () => Promise<Uint8Array>;
    } | null,
  ) {
    return {
      preference: {
        tone: "plain_professional" as const,
        length: "standard" as const,
        language: null,
        sample: null,
      },
      provide: () =>
        Promise.resolve({
          ok: true as const,
          text: letterText,
          document,
        }),
    };
  }

  test("leaves an optional letter blank when settings allow only required letters", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "textarea",
          label: "Cover letter",
          required: false,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const fillText = vi.spyOn(hands, "fillText");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "A generated letter" },
      observation.signature,
      {
        config: {
          ...config,
          writing: {
            coverLetterPolicy: "when_required",
            writtenAnswerLength: "short",
            preApprovedDeclarations: [],
          },
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("optional");
    }
    expect(fillText).not.toHaveBeenCalled();
  });

  test("hands a required letter to the person when settings say never", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Cover letter",
          required: true,
        }),
      ],
    });
    const { config } = configFor(page);
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: "letter" },
      observation.signature,
      {
        config: {
          ...config,
          writing: {
            coverLetterPolicy: "never",
            writtenAnswerLength: "short",
            preApprovedDeclarations: [],
          },
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("paused");
    if (outcome.kind === "paused") {
      expect(outcome.pause.code).toBe("document_needs_you");
      expect(outcome.pause.question?.prompt).toContain("Cover letter");
    }
  });

  test("when possible writes an optional letter box and records it as written for this job", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "textarea",
          label: "Cover letter",
          required: false,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const fillText = vi.spyOn(hands, "fillText");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "" },
      observation.signature,
      {
        config: {
          ...config,
          writing: {
            coverLetterPolicy: "when_possible",
            writtenAnswerLength: "short",
            preApprovedDeclarations: [],
          },
          letters: lettersFor(null),
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("filled");
    expect(fillText).toHaveBeenCalledWith("c0", letterText);
    if (outcome.kind === "filled") {
      expect(outcome.filled.questionKind).toBe("cover_letter");
      expect(outcome.filled.answer.provenanceLabel).toBe(
        "the letter written for this application",
      );
      expect(outcome.filled.answer.groundedIn.length).toBeGreaterThan(0);
    }
  });

  test("a file field asking for a letter gets the same letter as a file", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Cover letter",
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const uploadFile = vi.spyOn(hands, "uploadFile");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: "document_letter" },
      observation.signature,
      {
        config: {
          ...config,
          letters: lettersFor({
            id: "document_letter",
            fileName: "letter.pdf",
            mimeType: "application/pdf",
            label: "Cover letter",
            kind: "cover_letter",
            loadBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
          }),
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("attached");
    expect(uploadFile).toHaveBeenCalledWith("c0", {
      name: "letter.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  test("the person's own cover letter file is attached, even to an optional field, instead of writing one", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Cover letter",
          required: false,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const uploadFile = vi.spyOn(hands, "uploadFile");
    const observation = observationOf(page);
    const provideLetter = vi.fn();

    const outcome = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: "document_asset_letter" },
      observation.signature,
      {
        config: {
          ...config,
          sources: {
            ...config.sources,
            documents: [
              {
                id: "document_asset_letter",
                fileName: "my-letter.pdf",
                mimeType: "application/pdf",
                label: "Cover letter from the person's files",
                kind: "cover_letter",
                loadBytes: () => Promise.resolve(new Uint8Array([7, 8, 9])),
              },
            ],
          },
          letters: { ...lettersFor(null), provide: provideLetter },
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("attached");
    if (outcome.kind === "attached") {
      expect(outcome.attachment.documentId).toBe("document_asset_letter");
    }
    expect(uploadFile).toHaveBeenCalledWith("c0", {
      name: "my-letter.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([7, 8, 9]),
    });
    expect(provideLetter).not.toHaveBeenCalled();
  });

  test("a portfolio field accepts the person's file but refuses a generated statement", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Portfolio",
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const uploadFile = vi.spyOn(hands, "uploadFile");
    const observation = observationOf(page);
    const own = {
      id: "own_portfolio",
      fileName: "portfolio.pdf",
      mimeType: "application/pdf",
      label: "Portfolio from the person's files",
      kind: "portfolio" as const,
      loadBytes: () => Promise.resolve(new Uint8Array([4, 5, 6])),
    };
    const generated = {
      ...own,
      id: "generated_statement",
      kind: "other" as const,
    };
    const sources = { ...config.sources, documents: [own, generated] };
    const refused = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: generated.id },
      observation.signature,
      {
        config: { ...config, sources },
        now,
        guardState: createApplyGuardState(),
      },
    );
    expect(refused.kind).toBe("refused");
    expect(uploadFile).not.toHaveBeenCalled();
    const attached = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: own.id },
      observation.signature,
      {
        config: { ...config, sources },
        now,
        guardState: createApplyGuardState(),
      },
    );
    expect(attached.kind).toBe("attached");
    expect(uploadFile).toHaveBeenCalledWith("c0", {
      name: "portfolio.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([4, 5, 6]),
    });
  });

  test("a file the form insists on that cannot be produced goes to the person", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Cover letter (Word document)",
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const uploadFile = vi.spyOn(hands, "uploadFile");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "upload", ref: "c0", documentId: "document_letter" },
      observation.signature,
      {
        config: { ...config, letters: lettersFor(null) },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("paused");
    if (outcome.kind === "paused") {
      expect(outcome.pause.code).toBe("document_needs_you");
      expect(outcome.pause.summary).toContain(
        "Attach one here and it will be used",
      );
    }
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe("being ready to send", () => {
  const completePage = () =>
    rawPage({
      stepLabel: "Step 2 of 2",
      controls: [
        rawControl({
          index: 0,
          label: "Email",
          required: true,
          value: "robin@example.test",
        }),
      ],
      actions: [
        {
          index: 0,
          label: "Submit application",
          visible: true,
          disabled: false,
        },
      ],
    });

  test("a complete form with authority is reported ready, and nothing is pressed", async () => {
    const page = completePage();
    const { config, hands } = configFor(page, {
      authority: {
        mode: "autonomous_submit",
        submitAuthorized: true,
        allowedOrigins: ["https://apply.example.test"],
      },
    });
    const clickAction = vi.spyOn(hands, "clickAction");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "submit_application", ref: "a0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("ready_to_send");
    if (outcome.kind === "ready_to_send") {
      expect(outcome.finalActionRef).toBe("a0");
      expect(outcome.finalActionLabel).toBe("Submit application");
    }
    // The one irreversible act is not this loop's to take.
    expect(clickAction).not.toHaveBeenCalled();
  });

  test("confirm-first reaches the send button but is never the one to press it", async () => {
    const page = completePage();
    const { config, hands } = configFor(page, {
      authority: {
        mode: "confirm_before_submit",
        submitAuthorized: false,
        allowedOrigins: ["https://apply.example.test"],
      },
    });
    const clickAction = vi.spyOn(hands, "clickAction");
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "submit_application", ref: "a0" },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    // The form is worked all the way to the button so the person has a
    // complete application to review; pressing it stays theirs.
    expect(outcome.kind).toBe("ready_to_send");
    expect(clickAction).not.toHaveBeenCalled();
  });

  test.each([
    ["confirm_before_submit", false],
    ["autonomous_submit", true],
  ] as const)(
    "a generic click on the final button in %s mode uses the submission preflight without pressing it",
    async (mode, submitAuthorized) => {
      const page = completePage();
      const clickElement = vi.fn(() =>
        Promise.resolve({ ok: true as const, observedValue: "clicked" }),
      );
      const { config } = configFor(page, {
        authority: {
          mode,
          submitAuthorized,
          allowedOrigins: ["https://apply.example.test"],
        },
        hands: { clickElement },
      });
      const observation = observationOf(page);

      const outcome = await executeApplyProposal(
        { tool: "click", ref: "a0", reason: "The form is complete." },
        observation.signature,
        { config, now, guardState: createApplyGuardState() },
      );

      expect(outcome.kind).toBe("ready_to_send");
      expect(clickElement).not.toHaveBeenCalled();
    },
  );

  test("a generic click cannot approve a final button while a required field is empty", async () => {
    const page = completePage();
    page.controls = [
      rawControl({
        index: 0,
        label: "Email",
        required: true,
        value: "",
      }),
    ];
    const clickElement = vi.fn(() =>
      Promise.resolve({ ok: true as const, observedValue: "clicked" }),
    );
    const { config } = configFor(page, {
      authority: {
        mode: "confirm_before_submit",
        submitAuthorized: false,
        allowedOrigins: ["https://apply.example.test"],
      },
      hands: { clickElement },
    });
    const observation = observationOf(page);

    const outcome = await executeApplyProposal(
      { tool: "click", ref: "a0", reason: "The form is complete." },
      observation.signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("refused");
    expect(clickElement).not.toHaveBeenCalled();
  });
});

/**
 * A form that saves each answer as it is typed.
 *
 * The guard refuses every one of those saves, so nothing leaves the page. What
 * changed is what happens next: the run keeps filling and writes the blocked
 * save down, and only stops when the form will not go on without it.
 */
describe("a site that saves as you go", () => {
  const savedAttempt = {
    kind: "fetch" as const,
    method: "POST",
    url: "https://boards.example.test/applications/autosave",
    at: "2026-09-14T10:00:01.000Z",
    carriedPreparedValue: true,
  };

  function safetyThatBlocksOneSave() {
    let handedOut = false;
    return {
      readBlockedAttempt: () => {
        if (handedOut) return Promise.resolve(null);
        handedOut = true;
        return Promise.resolve(savedAttempt);
      },
      registerPreparedValue: () => Promise.resolve(),
      openIntermediateWriteWindow: () => Promise.resolve(),
      closeIntermediateWriteWindow: () => Promise.resolve(),
      checkServiceWorker: () => Promise.resolve(null),
    };
  }

  test("a blocked background save during an answer does not stop the run", async () => {
    // The field keeps the answer, so the blocked save changed nothing.
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "First Name" })],
    });
    const filled = rawPage({
      controls: [rawControl({ index: 0, label: "First Name", value: "Robin" })],
    });
    let reads = 0;
    const { config } = configFor(page, {
      hands: {
        observe: () => {
          reads += 1;
          return Promise.resolve(observationOf(reads === 1 ? page : filled));
        },
      },
    });
    const guardState = createApplyGuardState();

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "" },
      observationOf(page).signature,
      {
        config: { ...config, safety: safetyThatBlocksOneSave() },
        now,
        guardState,
      },
    );

    expect(outcome.kind).toBe("filled");
    expect(guardState.notes).toEqual([
      "Blocked a background save to boards.example.test while filling First Name.",
    ]);
    expect(guardState.blockedSaveCount).toBe(1);
  });

  test("a blocked save that stops the form moving on pauses, and names the site", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "First Name", value: "Robin" })],
      actions: [
        { index: 0, label: "Continue", visible: true, disabled: false },
      ],
    });
    const { config } = configFor(page);
    const guardState = createApplyGuardState();

    const outcome = await executeApplyProposal(
      { tool: "click", ref: "a0" },
      observationOf(page).signature,
      {
        config: { ...config, safety: safetyThatBlocksOneSave() },
        now,
        guardState,
      },
    );

    expect(outcome.kind).toBe("paused");
    if (outcome.kind === "paused") {
      expect(outcome.pause.blocker?.code).toBe("site_saves_as_you_go");
      expect(outcome.pause.blocker?.summary).toBe(
        "This site saves your answers as you type, and Job Finder is not allowed to let it.",
      );
      expect(outcome.pause.blocker?.nextActionLabel).toBe(
        "Allow saving on this site",
      );
      expect(outcome.pause.blocker?.host).toBe("boards.example.test");
    }
  });

  test("the page sending the form itself still stops everything", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "First Name" })],
    });
    const { config } = configFor(page);

    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "" },
      observationOf(page).signature,
      {
        config: {
          ...config,
          safety: {
            ...safetyThatBlocksOneSave(),
            readBlockedAttempt: () =>
              Promise.resolve({
                ...savedAttempt,
                kind: "form_submit" as const,
              }),
          },
        },
        now,
        guardState: createApplyGuardState(),
      },
    );

    expect(outcome.kind).toBe("paused");
    if (outcome.kind === "paused") {
      expect(outcome.pause.summary).toContain(
        "tried to send the application on its own",
      );
    }
  });
});

/**
 * Two controls that say the same thing are still two questions.
 *
 * A phone number sits beside its country list, and both are labelled Phone.
 * Treating them as one question gave the number field the country's 240
 * choices and stopped the country being answered from the profile at all.
 */
describe("questions keep to their own control", () => {
  const phoneCountry = rawControl({
    index: 0,
    tagName: "select",
    inputType: "select-one",
    label: "Country",
    groupLabel: "Phone",
    options: ["Afghanistan +93", "United Kingdom +44", "United States +1"],
  });
  const phoneNumber = rawControl({
    index: 1,
    inputType: "tel",
    label: "Phone",
    groupLabel: "Phone",
  });
  const yesNo = rawControl({
    index: 2,
    tagName: "select",
    inputType: "select-one",
    label: "Have you previously worked at or consulted for us?*",
    options: ["Yes", "No"],
  });

  test("the phone country and the phone number are two different questions", () => {
    const page = rawPage({ controls: [phoneCountry, phoneNumber, yesNo] });
    const observation = observationOf(page);
    const [country, number, choice] = observation.controls;
    const build = (control: (typeof observation.controls)[number]) =>
      buildPendingQuestion({
        control,
        jobId: "job_test",
        detectedAt: "2026-09-14T10:00:00.000Z",
        suggestion: null,
      });

    const countryQuestion = build(country);
    const numberQuestion = build(number);
    expect(countryQuestion.id).not.toBe(numberQuestion.id);
    // The number field has no choices; the country list's do not leak onto it.
    expect(numberQuestion.answerOptions).toEqual([]);
    expect(countryQuestion.answerOptions).toHaveLength(3);
    // Display still reads as one thing where the group only repeats the label.
    expect(numberQuestion.prompt).toBe("Phone");
    expect(countryQuestion.prompt).toBe("Phone — Country");

    const choiceQuestion = build(choice);
    expect(choiceQuestion.answerOptions).toEqual(["Yes", "No"]);
    expect(choiceQuestion.answerControlType).toBe("single_choice");
  });

  test("the phone country is still answered from the profile", async () => {
    const page = rawPage({ controls: [phoneCountry, phoneNumber] });
    const { config, hands } = configFor(page);
    const chooseOption = vi.spyOn(hands, "chooseOption");
    const withPhone: ApplyAgentConfig = {
      ...config,
      sources: {
        ...config.sources,
        profile: {
          ...config.sources.profile,
          phone: "+44 7700 900000",
          currentCountry: "United Kingdom",
        },
      },
    };

    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "United Kingdom +44" },
      observationOf(page).signature,
      { config: withPhone, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    if (outcome.kind === "filled") {
      expect(outcome.filled.answer.provenanceLabel).toContain(
        "the country your phone number belongs to",
      );
    }
    expect(chooseOption).toHaveBeenCalled();
  });

  test("a saved choice overrides a different option proposed by the model", async () => {
    const sourceQuestion =
      "How did you hear about this job? Select an option Job board Company website Referral Other";
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          inputType: "select-one",
          label: sourceQuestion,
          options: [
            "Select an option",
            "Job board",
            "Company website",
            "Referral",
            "Other",
          ],
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.reusableAnswers = [
      {
        id: "saved_source",
        kind: "other",
        label: sourceQuestion,
        question: sourceQuestion,
        answer: "Job board",
        roleFamilies: [],
        proofEntryIds: [],
      },
    ];
    const chooseOption = vi.spyOn(hands, "chooseOption");

    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "Other" },
      observationOf(page).signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("filled");
    expect(chooseOption).toHaveBeenCalledWith("c0", "Job board");
    if (outcome.kind === "filled") {
      expect(outcome.filled.answer).toMatchObject({
        value: "Job board",
        sourceKind: "answer_library",
      });
    }
  });

  test("a grounded choice that is not offered stays for the person", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          inputType: "select-one",
          label: "How did you hear about this job?",
          options: ["Referral", "Other"],
          required: true,
        }),
      ],
    });
    const { config, hands } = configFor(page);
    config.sources.reusableAnswers = [
      {
        id: "saved_source",
        kind: "other",
        label: "How did you hear about this job?",
        question: "How did you hear about this job?",
        answer: "Job board",
        roleFamilies: [],
        proofEntryIds: [],
      },
    ];
    const chooseOption = vi.spyOn(hands, "chooseOption");

    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "Other" },
      observationOf(page).signature,
      { config, now, guardState: createApplyGuardState() },
    );

    expect(outcome.kind).toBe("suggestion");
    if (outcome.kind === "suggestion") {
      expect(outcome.question?.suggestedAnswers[0]?.text).toBe("Job board");
    }
    expect(chooseOption).not.toHaveBeenCalled();
  });
});

/**
 * The same question, the same handle, on every run.
 *
 * A retry reads the page fresh and the refs come out renumbered. If the
 * question's identity moved with them, the answer the person gave yesterday
 * belongs to a question nothing recognises today, and they are asked again.
 */
describe("a question keeps its name across runs", () => {
  function askedPage(offset: number): RawApplyPage {
    const before = Array.from({ length: offset }, (_, index) =>
      rawControl({ index, label: `Filler ${index}` }),
    );
    return rawPage({
      controls: [
        ...before,
        rawControl({
          index: offset,
          tagName: "select",
          inputType: "select-one",
          label: "Have you previously worked at or consulted for us?*",
          options: ["Yes", "No"],
          required: true,
        }),
      ],
    });
  }

  test("renumbered refs do not change the question's id", () => {
    const first = observationOf(askedPage(0));
    const second = observationOf(askedPage(3));
    const build = (observation: ApplyFormObservation, ref: string) =>
      buildPendingQuestion({
        control: observation.controls.find((entry) => entry.ref === ref)!,
        siblings: observation.controls,
        jobId: "job_test",
        detectedAt: "2026-09-14T10:00:00.000Z",
        suggestion: null,
      });

    expect(build(first, "c0").id).toBe(build(second, "c3").id);
  });

  test("two controls that say exactly the same thing are still told apart", () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          inputType: "select-one",
          label: "Gender",
          options: ["Male", "Female"],
        }),
        rawControl({
          index: 1,
          tagName: "select",
          inputType: "select-one",
          label: "Gender",
          options: ["Male", "Female"],
        }),
      ],
    });
    const observation = observationOf(page);
    const ids = observation.controls.map(
      (control) =>
        buildPendingQuestion({
          control,
          siblings: observation.controls,
          jobId: "job_test",
          detectedAt: "2026-09-14T10:00:00.000Z",
          suggestion: null,
        }).id,
    );

    expect(new Set(ids).size).toBe(2);
  });

  test("one radio group has one stable id while equal-worded groups stay distinct", () => {
    const page = rawPage({
      controls: [
        ...["Yes", "No"].map((label, index) =>
          rawControl({
            index,
            inputType: "radio",
            name: "authorized-primary",
            label,
            value: label,
            groupLabel: "Are you authorized?",
          }),
        ),
        ...["Yes", "No"].map((label, index) =>
          rawControl({
            index: index + 2,
            inputType: "radio",
            name: "authorized-secondary",
            label,
            value: label,
            groupLabel: "Are you authorized?",
          }),
        ),
      ],
    });
    const observation = observationOf(page);
    const questions = observation.controls.map((control) =>
      buildPendingQuestion({
        control,
        siblings: observation.controls,
        jobId: "job_test",
        detectedAt: "2026-09-14T10:00:00.000Z",
        suggestion: null,
      }),
    );

    expect(questions[0]?.id).toBe(questions[1]?.id);
    expect(questions[2]?.id).toBe(questions[3]?.id);
    expect(questions[0]?.id).not.toBe(questions[2]?.id);
    expect(questions[0]?.answerOptions).toEqual(["Yes", "No"]);
  });

  test("radio ids ignore option wording and digest exact long group keys", () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "radio",
          name: `${"same-prefix-".repeat(8)}alpha!`,
          label: "Yes",
          groupLabel: "",
        }),
        rawControl({
          index: 1,
          inputType: "radio",
          name: `${"same-prefix-".repeat(8)}alpha!`,
          label: "No",
          groupLabel: "",
        }),
        rawControl({
          index: 2,
          inputType: "radio",
          name: `${"same-prefix-".repeat(8)}alpha?`,
          label: "Yes",
          groupLabel: "",
        }),
      ],
    });
    const observation = observationOf(page);
    const ids = observation.controls.map(
      (control) =>
        buildPendingQuestion({
          control,
          siblings: observation.controls,
          jobId: "job_test",
          detectedAt: "2026-09-14T10:00:00.000Z",
          suggestion: null,
        }).id,
    );

    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe("a button that opens a new tab", () => {
  test("the run goes where the tab was going, in this tab, and says so", async () => {
    const listing = rawPage({
      url: "https://remoteok.test/remote-jobs/staff-engineer",
      actions: [{ index: 0, label: "Apply", visible: true, disabled: false }],
    });
    const employerForm = rawPage({
      url: "https://jobs.employer.test/apply/123",
      controls: [rawControl({ index: 0, label: "First Name" })],
    });
    let popupHandedOut = false;
    let onEmployerSite = false;
    const navigated: string[] = [];
    const { config } = configFor(listing, {
      hands: {
        observe: () =>
          Promise.resolve(
            observationOf(onEmployerSite ? employerForm : listing),
          ),
        navigate: (url) => {
          navigated.push(url);
          onEmployerSite = true;
          return Promise.resolve({ ok: true, url });
        },
      },
    });
    const withSafety: ApplyAgentConfig = {
      ...config,
      safety: {
        readBlockedAttempt: () => {
          if (popupHandedOut) return Promise.resolve(null);
          popupHandedOut = true;
          return Promise.resolve({
            kind: "popup_open" as const,
            method: "GET",
            url: "https://jobs.employer.test/apply/123",
            at: "2026-09-14T10:00:01.000Z",
          });
        },
        registerPreparedValue: () => Promise.resolve(),
        openIntermediateWriteWindow: () => Promise.resolve(),
        closeIntermediateWriteWindow: () => Promise.resolve(),
        checkServiceWorker: () => Promise.resolve(null),
      },
    };

    const outcome = await executeApplyProposal(
      { tool: "click", ref: "a0" },
      observationOf(listing).signature,
      {
        config: withSafety,
        now: () => new Date("2026-09-14T10:00:00.000Z"),
        guardState: createApplyGuardState(),
      },
    );

    expect(navigated).toEqual(["https://jobs.employer.test/apply/123"]);
    expect(outcome.kind).toBe("moved");
    if (outcome.kind === "moved") {
      expect(outcome.note).toContain('"Apply"');
      expect(outcome.note).toContain("new tab");
      expect(outcome.note).toContain("https://jobs.employer.test/apply/123");
      expect(outcome.observation.url).toBe(
        "https://jobs.employer.test/apply/123",
      );
    }
  });
});

describe("Round 2 application recovery", () => {
  test.each([true, false])(
    "the model maps saved prose to an option only with a supported fact check (%s)",
    async (supported) => {
      const page = rawPage({
        controls: [
          rawControl({
            index: 0,
            tagName: "select",
            label: "Do you need visa sponsorship in Germany?",
            required: true,
            options: ["Yes", "No"],
          }),
        ],
      });
      const { config, hands } = configFor(page);
      config.sources.profile.answerBank.visaSponsorship =
        "I will need employer sponsorship after my student permit ends.";
      config.sources.posting.location = "Berlin, Germany";
      const choose = vi.spyOn(hands, "chooseOption");
      const check = vi.fn(() =>
        Promise.resolve({
          supported,
          reason: "Permit conditions need clarification.",
        }),
      );
      const outcome = await executeApplyProposal(
        { tool: "select", ref: "c0", option: "Yes" },
        observationOf(page).signature,
        {
          config,
          now,
          guardState: createApplyGuardState(),
          checkWrittenAnswer: check,
        },
      );
      expect(check).toHaveBeenCalledWith(
        "Do you need visa sponsorship in Germany?",
        "Yes",
      );
      expect(choose).toHaveBeenCalledTimes(supported ? 1 : 0);
      expect(outcome.kind).toBe(supported ? "filled" : "suggestion");
    },
  );

  test("an old upload must be replaced before advancing a retained form", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          inputType: "file",
          label: "Resume",
          value: "C:\\fakepath\\original.docx",
        }),
      ],
      actions: [
        { index: 0, label: "Continue", visible: true, disabled: false },
      ],
    });
    const { config, hands } = configFor(page);
    hands.uploadFile = (_ref, file) => {
      page.controls[0].value = file.name;
      return Promise.resolve({ ok: true, observedValue: file.name });
    };
    config.sources.documents = [
      {
        id: "approved",
        kind: "resume",
        label: "Your CV",
        fileName: "approved.pdf",
        mimeType: "application/pdf",
        loadBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      },
    ];
    const click = vi.spyOn(hands, "clickElement");
    expect(
      await executeApplyProposal(
        { tool: "click", ref: "a0" },
        observationOf(page).signature,
        { config, now, guardState: createApplyGuardState() },
      ),
    ).toMatchObject({ kind: "refused" });
    expect(click).not.toHaveBeenCalled();
    expect(
      await executeApplyProposal(
        { tool: "upload", ref: "c0", documentId: "approved" },
        observationOf(page).signature,
        { config, now, guardState: createApplyGuardState() },
      ),
    ).toMatchObject({
      kind: "attached",
      attachment: { fileName: "approved.pdf" },
    });
    expect((await hands.observe()).controls[0]?.value).toBe("approved.pdf");
    expect(
      await executeApplyProposal(
        { tool: "click", ref: "a0" },
        observationOf(page).signature,
        { config, now, guardState: createApplyGuardState() },
      ),
    ).toMatchObject({ kind: "moved" });
    expect(click).toHaveBeenCalledOnce();
  });

  test("an upload that retains another filename is not recorded as attached", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, inputType: "file", label: "Resume" })],
    });
    const { config } = configFor(page, {
      hands: {
        uploadFile: () =>
          Promise.resolve({ ok: true, observedValue: "original.docx" }),
      },
    });
    config.sources.documents = [
      {
        id: "approved",
        kind: "resume",
        label: "Your CV",
        fileName: "approved.pdf",
        mimeType: "application/pdf",
        loadBytes: () => Promise.resolve(new Uint8Array([1])),
      },
    ];
    expect(
      await executeApplyProposal(
        { tool: "upload", ref: "c0", documentId: "approved" },
        observationOf(page).signature,
        { config, now, guardState: createApplyGuardState() },
      ),
    ).toMatchObject({ kind: "refused" });
  });
});

describe("the model's answers stand when the person's facts support them (ADR 0041)", () => {
  const deps = (
    config: ApplyAgentConfig,
    supported: boolean,
    reason = "checked",
  ) => {
    const checkWrittenAnswer = vi.fn(() =>
      Promise.resolve({ supported, reason }),
    );
    return {
      checkWrittenAnswer,
      deps: {
        config,
        now,
        guardState: createApplyGuardState(),
        checkWrittenAnswer,
      },
    };
  };

  test("text matching a stored fact goes in as that fact without a check", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const { config } = configFor(page);
    const { deps: run, checkWrittenAnswer } = deps(config, true);
    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "robin.ashford@example.test" },
      observationOf(page).signature,
      run,
    );
    expect(checkWrittenAnswer).not.toHaveBeenCalled();
    if (outcome.kind !== "filled") throw new Error("Expected a fill");
    expect(outcome.filled.answer.sourceKind).toBe("profile");
  });

  test("the model's text replaces a stored fact the question was not asking for", async () => {
    // Read by keywords this is the person's own email; the model saw it asks
    // for a referee's.
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          label: "Email",
          inputType: "email",
          groupLabel: "Referee",
        }),
      ],
    });
    const fillText = vi.fn((_ref: string, value: string) =>
      Promise.resolve({ ok: true as const, observedValue: value }),
    );
    const { config } = configFor(page, { hands: { fillText } });
    config.sources.reusableAnswers = [];
    const { deps: run, checkWrittenAnswer } = deps(config, true);
    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "referee@example.test" },
      observationOf(page).signature,
      run,
    );
    expect(checkWrittenAnswer).toHaveBeenCalledOnce();
    expect(fillText).toHaveBeenCalledWith("c0", "referee@example.test");
    if (outcome.kind !== "filled") throw new Error("Expected a fill");
    expect(outcome.filled.answer.value).toBe("referee@example.test");
  });

  test("an unsupported answer is not written, and the saved one is named", async () => {
    const page = rawPage({
      controls: [rawControl({ index: 0, label: "Email", inputType: "email" })],
    });
    const fillText = vi.fn();
    const { config } = configFor(page, { hands: { fillText } });
    const { deps: run } = deps(
      config,
      false,
      "That is not the applicant's email.",
    );
    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "someone.else@example.test" },
      observationOf(page).signature,
      run,
    );
    expect(fillText).not.toHaveBeenCalled();
    if (outcome.kind !== "suggestion") throw new Error("Expected a note");
    expect(outcome.note).toContain(
      'Their saved answer is "robin.ashford@example.test"',
    );
  });

  test("the model chooses an option nothing stored answers once the check supports it", async () => {
    const page = rawPage({
      controls: [
        rawControl({
          index: 0,
          tagName: "select",
          label: "How did you hear about this job?",
          required: true,
          options: ["LinkedIn", "A friend", "Other"],
        }),
      ],
    });
    const { config, hands } = configFor(page);
    const choose = vi.spyOn(hands, "chooseOption");
    const { deps: run, checkWrittenAnswer } = deps(config, true);
    const outcome = await executeApplyProposal(
      { tool: "select", ref: "c0", option: "Other" },
      observationOf(page).signature,
      run,
    );
    expect(checkWrittenAnswer).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledWith("c0", "Other");
    expect(outcome.kind).toBe("filled");
  });

  test("pay the person keeps to themselves is left for them whatever the model chose", async () => {
    const page = rawPage({
      controls: [
        rawControl({ index: 0, label: "Expected salary", required: true }),
      ],
    });
    const fillText = vi.fn();
    const { config } = configFor(page, { hands: { fillText } });
    const { deps: run, checkWrittenAnswer } = deps(config, true);
    const outcome = await executeApplyProposal(
      { tool: "type", ref: "c0", text: "60000" },
      observationOf(page).signature,
      run,
    );
    expect(checkWrittenAnswer).not.toHaveBeenCalled();
    expect(fillText).not.toHaveBeenCalled();
    expect(outcome.kind).not.toBe("filled");
  });
});
