import { CandidateProfileSchema } from "@nordri/contracts";
import { describe, expect, test, vi } from "vitest";

import type { LLMClient } from "../agent/contracts";
import { runApplyAgent } from "./apply-agent";
import {
  createApplySystemPrompt,
  createApplyUserPrompt,
} from "./apply-prompts";
import {
  checkWrittenApplicationAnswer,
  WrittenAnswerCheckUnavailableError,
} from "./written-answer-grounding";
import type { RawApplyControl, RawApplyPage } from "@nordri/contracts";
import { buildApplyFormObservation } from "./page-hands";
import type { ApplyAgentConfig, ApplyPageHands } from "./types";

/**
 * How the loop ends.
 *
 * There is no step quota: the agent decides when the form is done. What is
 * bounded is going nowhere — a stall gets one warning and then the run stops,
 * and the agent can stop itself by finishing as stuck.
 */

/** One ordinary question, so the page reads as a form rather than a listing. */
function nameControl(): RawApplyControl {
  return {
    index: 0,
    tagName: "input",
    inputType: "text",
    role: "",
    id: "f0",
    name: "f0",
    label: "Full name",
    groupLabel: "",
    placeholder: "",
    autocomplete: "",
    required: true,
    invalid: false,
    validationMessage: "",
    disabled: false,
    readOnly: false,
    visible: true,
    value: "Robin Ashford",
    checked: false,
    multiple: false,
    options: [],
    selectedOptionLabel: "",
  };
}

function workAuthorizationRadio(
  index: number,
  label: "Yes" | "No",
): RawApplyControl {
  return {
    ...nameControl(),
    index,
    inputType: "radio",
    id: `work-authorization-${label.toLowerCase()}`,
    name: "workAuthorization",
    label,
    groupLabel: "Are you legally authorized to work in this country?",
    value: label,
    checked: false,
  };
}

function page(overrides: Partial<RawApplyPage> = {}): RawApplyPage {
  return {
    url: "https://apply.example.test/form",
    title: "Apply",
    bodyText: "Apply for the role",
    controls: [nameControl()],
    actions: [{ index: 0, label: "Continue", visible: true, disabled: false }],
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

function hands(source: RawApplyPage): ApplyPageHands {
  return {
    observe: () =>
      Promise.resolve(
        buildApplyFormObservation(source, "2026-09-14T10:00:00.000Z"),
      ),
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
    setToggle: () => Promise.resolve({ ok: true, observedValue: "checked" }),
    uploadFile: (_ref, file) =>
      Promise.resolve({ ok: true, observedValue: file.name }),
    clickAction: () => Promise.resolve({ ok: true, observedValue: "clicked" }),
    followLink: () =>
      Promise.resolve({ ok: true, url: "https://apply.example.test/form" }),
  };
}

function config(
  source: RawApplyPage,
  overrides: Partial<ApplyAgentConfig> = {},
): ApplyAgentConfig {
  return {
    hands: hands(source),
    authority: {
      mode: "prepare_only",
      submitAuthorized: false,
      preApprovedAttestationKinds: [],
      salaryDisclosure: "pause_for_user",
      allowedOrigins: [],
    },
    sources: {
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
      reusableAnswers: [],
      documents: [],
    },
    application: {
      jobId: "job_test",
      applicationId: "application_test",
      startingUrl: "https://apply.example.test/form",
    },
    siteLabel: "the careers site",
    now: () => new Date("2026-09-14T10:00:00.000Z"),
    ...overrides,
  };
}

function repeatingModel(
  name: string,
  args: Record<string, unknown>,
): LLMClient {
  let calls = 0;
  return {
    chatWithTools: () => {
      calls += 1;
      return Promise.resolve({
        toolCalls: [
          {
            id: `call_${calls}`,
            type: "function" as const,
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
    },
  };
}

function scriptedModel(
  turns: Array<{ name: string; args: Record<string, unknown> }>,
): LLMClient {
  let calls = 0;
  return {
    chatWithTools: () => {
      const turn = turns[Math.min(calls, turns.length - 1)];
      calls += 1;
      return Promise.resolve({
        toolCalls: [
          {
            id: `call_${calls}`,
            type: "function" as const,
            function: { name: turn.name, arguments: JSON.stringify(turn.args) },
          },
        ],
      });
    },
  };
}

test("prose instructions separate candidate evidence from job requirements", () => {
  const prompt = createApplySystemPrompt(config(page()));
  expect(prompt).toContain("write from those candidate facts");
  expect(prompt).toContain(
    "never turn a job requirement into a claim that the person has done it",
  );
  expect(prompt).toContain("Leave unsupported candidate claims out");
});

test("a retained form receives current exact answers and only named corrections replace entered values", () => {
  const input = config(page(), {
    application: {
      jobId: "job_test",
      applicationId: "application_test",
      startingUrl: "https://apply.example.test/form?step=3",
      continuation: { sourceUrls: ["https://apply.example.test/form"] },
      instructions: [
        'Answer to "Are you legally authorized to work in this country?": Yes',
        'Correct "Address" to "1 Example Road" before sending.',
      ],
    },
  });
  const user = createApplyUserPrompt(input);
  const system = createApplySystemPrompt(input);
  expect(user).toContain(JSON.stringify(input.application.instructions));
  expect(system).toContain("even when a field already contains an older value");
  expect(system).toContain("Preserve unrelated values entered by the person");
  expect(system).toContain("leave it intact and ask");
  expect(user).toContain("does not widen application authority");
});

describe("written answer fact check recovery", () => {
  const input = () => ({
    sources: config(page()).sources,
    question: "Why do you want to work here?",
    answer: "I like the advertised work.",
  });
  const call = (args: Record<string, unknown>) => ({
    id: "check",
    type: "function" as const,
    function: {
      name: "report_answer_check",
      arguments: JSON.stringify(args),
    },
  });

  test("repairs a malformed report once and keeps the independent fact verdict", async () => {
    const client: LLMClient = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce({
          toolCalls: [call({ reason: "missing verdict" })],
        })
        .mockResolvedValueOnce({
          toolCalls: [
            call({ supported: false, reason: "No supporting fact." }),
          ],
        }),
    };
    await expect(
      checkWrittenApplicationAnswer({ ...input(), client }),
    ).resolves.toEqual({ supported: false, reason: "No supporting fact." });
    expect(client.chatWithTools).toHaveBeenCalledTimes(2);
    const lastCall = vi.mocked(client.chatWithTools).mock.lastCall;
    expect(
      lastCall?.[0].some((message) =>
        message.content.includes("previous check did not return"),
      ),
    ).toBe(true);
    expect(lastCall?.[1].length).toBeGreaterThan(0);
    expect(lastCall?.[2]?.maxOutputTokens).toBe(1200);
  });

  test("refuses to enter an answer when both fact reports are unusable", async () => {
    const client: LLMClient = {
      chatWithTools: vi.fn().mockResolvedValue({ toolCalls: [] }),
    };
    await expect(
      checkWrittenApplicationAnswer({ ...input(), client }),
    ).rejects.toBeInstanceOf(WrittenAnswerCheckUnavailableError);
    expect(client.chatWithTools).toHaveBeenCalledTimes(2);
  });

  test("accepts a valid supported verdict without a retry", async () => {
    const client: LLMClient = {
      chatWithTools: vi.fn().mockResolvedValue({
        toolCalls: [
          call({ supported: true, reason: "Only ordinary motivation." }),
        ],
      }),
    };
    await expect(
      checkWrittenApplicationAnswer({ ...input(), client }),
    ).resolves.toEqual({
      supported: true,
      reason: "Only ordinary motivation.",
    });
    expect(client.chatWithTools).toHaveBeenCalledTimes(1);
  });
});

test("preserves an explicitly reported CAPTCHA even when finish omits needsPerson", async () => {
  const result = await runApplyAgent(
    config(page()),
    scriptedModel([
      {
        name: "finish",
        args: {
          reason:
            'Form filled. Ready for person to review hCaptcha ("Please try again" showing) and submit.',
        },
      },
    ]),
  );
  expect(result.outcome).toBe("paused");
  expect(result.pauses[0]?.blocker).toMatchObject({
    code: "security_challenge",
    requiresPerson: true,
  });
});

test.each([false, true])(
  "checks prose with independent applicant facts and finishes without repeating an unsupported answer (required=%s)",
  async (required) => {
    const source = page({
      controls: [
        {
          ...nameControl(),
          tagName: "textarea",
          inputType: "",
          label:
            "Tell me about a feature you built using an AI coding assistant",
          required,
          value: "",
        },
      ],
    });
    const fillText = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        observedValue: "written",
      }),
    );
    const testConfig = config(source);
    testConfig.hands.fillText = fillText;
    let writerTurn = 0;
    let checks = 0;
    const model: LLMClient = {
      chatWithTools: (messages, definitions) => {
        const checking =
          definitions[0]?.function.name === "report_answer_check";
        if (checking) {
          checks += 1;
          expect(messages).toHaveLength(2);
          expect(messages[0]?.content).toContain(
            "General industry practice and job requirements do not prove personal experience",
          );
          expect(messages[1]?.content).toContain(
            "8 years of platform engineering",
          );
          expect(messages[1]?.content).not.toContain("self-declared proof");
        }
        const call = checking
          ? {
              name: "report_answer_check",
              args: {
                supported: false,
                reason:
                  "Applicant facts do not mention AI coding assistant use.",
              },
            }
          : writerTurn++ === 0
            ? {
                name: "type",
                args: {
                  ref: "c0",
                  text: "I use an AI coding assistant daily.",
                  groundedIn: ["self-declared proof"],
                },
              }
            : {
                name: "finish",
                args: {
                  reason:
                    "All supported fields filled; unsupported answer left blank.",
                },
              };
        return Promise.resolve({
          toolCalls: [
            {
              id: `call_${writerTurn}_${checks}`,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            },
          ],
        });
      },
    };
    const result = await runApplyAgent(testConfig, model);
    expect(checks).toBe(1);
    expect(writerTurn).toBe(2);
    expect(fillText).not.toHaveBeenCalled();
    expect(result.outcome).toBe(required ? "paused" : "prepared");
    expect(
      result.pauses.flatMap(
        (pause) => pause.questions ?? (pause.question ? [pause.question] : []),
      ),
    ).toHaveLength(required ? 1 : 0);
  },
);

test.each([
  "No CAPTCHA remains; the form is complete.",
  "The invisible hCaptcha script loaded.",
  "The person completed the CAPTCHA successfully.",
])(
  "does not turn non-blocking CAPTCHA mention into a handoff: %s",
  async (reason) => {
    const result = await runApplyAgent(
      config(page()),
      scriptedModel([{ name: "finish", args: { reason } }]),
    );
    expect(result.outcome).toBe("prepared");
  },
);

test("keeps a filled form active until its final action passes readiness review", async () => {
  const source = page({
    actions: [
      { index: 0, label: "Submit application", visible: true, disabled: false },
    ],
  });
  const prompts: string[] = [];
  let turn = 0;
  const model: LLMClient = {
    chatWithTools: (messages) => {
      prompts.push(messages.at(-1)?.content ?? "");
      const call =
        turn === 0
          ? { name: "finish", args: { reason: "Everything is filled in" } }
          : turn === 1
            ? { name: "submit_application", args: { ref: "a0" } }
            : { name: "finish", args: { reason: "Ready to send" } };
      turn += 1;
      return Promise.resolve({
        toolCalls: [
          {
            id: `call_${turn}`,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args),
            },
          },
        ],
      });
    },
  };

  const result = await runApplyAgent(
    config(source, {
      authority: {
        mode: "autonomous_submit",
        submitAuthorized: true,
        preApprovedAttestationKinds: [],
        salaryDisclosure: "pause_for_user",
        allowedOrigins: ["https://apply.example.test"],
      },
    }),
    model,
  );

  expect(prompts[1]).toContain("has not recorded its final action yet");
  expect(result.outcome).toBe("ready_to_send");
  expect(result.readyToSend).toEqual({
    actionRef: "a0",
    actionLabel: "Submit application",
  });
});

test("lets fill-in mode finish without recording a final action", async () => {
  const result = await runApplyAgent(
    config(
      page({
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: true,
            disabled: false,
          },
        ],
      }),
    ),
    repeatingModel("finish", { reason: "The form is filled in" }),
  );

  expect(result.outcome).toBe("prepared");
  expect(result.readyToSend).toBeNull();
});

test("does not demand an inaccessible hidden final action", async () => {
  const result = await runApplyAgent(
    config(
      page({
        actions: [
          {
            index: 0,
            label: "Submit application",
            visible: false,
            disabled: false,
          },
        ],
      }),
      {
        authority: {
          mode: "confirm_before_submit",
          submitAuthorized: false,
          preApprovedAttestationKinds: [],
          salaryDisclosure: "pause_for_user",
          allowedOrigins: ["https://apply.example.test"],
        },
      },
    ),
    repeatingModel("finish", { reason: "The visible form is finished" }),
  );

  expect(result.outcome).toBe("awaiting_your_review");
  expect(result.readyToSend).toBeNull();
});

test("creates a grounded requested document and attaches the generated file", async () => {
  const source = page({
    controls: [
      {
        ...nameControl(),
        inputType: "file",
        label: "Motivation letter",
        value: "",
      },
    ],
  });
  const baseHands = hands(source);
  let capturedGrounding: string[] = [];
  const result = await runApplyAgent(
    config(source, {
      hands: {
        ...baseHands,
        uploadFile: (_ref, file) => {
          source.controls = source.controls.map((control) => ({
            ...control,
            value: file.name,
          }));
          return Promise.resolve({
            ok: true as const,
            observedValue: file.name,
          });
        },
      },
      letters: {
        preference: {
          tone: "plain_professional",
          length: "short",
          language: null,
          sample: null,
        },
        provide: (request) => {
          capturedGrounding = request.groundedIn;
          return Promise.resolve({
            ok: true as const,
            text: "Dear Hiring Team,\n\nI am applying for the Platform Engineer role at Northwind Tools. My saved profile and resume show eight years of platform engineering and dependable internal-tool work. That experience aligns with your need for someone to own the internal platform.\n\nSincerely,\nRobin Ashford",
            document: {
              id: "generated_motivation_letter",
              fileName: "motivation-letter.pdf",
              mimeType: "application/pdf",
              label: "Motivation letter",
              kind: "cover_letter" as const,
              loadBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
            },
          });
        },
      },
    }),
    scriptedModel([
      {
        name: "finish",
        args: { reason: "The rest of the form is complete." },
      },
      {
        name: "create_application_document",
        args: {
          purpose: "motivation_letter",
          instructions: "Explain the supported platform-engineering fit.",
          fileType: "pdf",
        },
      },
      {
        name: "upload",
        args: { ref: "c0", documentId: "generated_motivation_letter" },
      },
      {
        name: "finish",
        args: { reason: "The requested document is attached." },
      },
    ]),
  );

  expect(result.pauses).toEqual([]);
  expect(result).toMatchObject({
    attachments: [
      {
        documentId: "generated_motivation_letter",
        fileName: "motivation-letter.pdf",
        controlLabel: "Motivation letter",
      },
    ],
  });
  expect(result.notes).toContain(
    "Created motivation letter motivation-letter.pdf for this application.",
  );
  expect(capturedGrounding.join("\n")).toContain(
    '"summary": "Builds dependable internal tools."',
  );
  expect(capturedGrounding.join("\n")).toContain(
    "8 years of platform engineering.",
  );
  expect(capturedGrounding.join("\n")).toContain("Own the internal platform.");
});

describe("apply agent run endings", () => {
  test("one selected radio answers its required group without selecting its opposite", () => {
    const observation = buildApplyFormObservation(
      page({
        controls: [
          { ...workAuthorizationRadio(0, "Yes"), checked: true },
          workAuthorizationRadio(1, "No"),
        ],
      }),
      "2026-09-14T10:00:00.000Z",
    );

    expect(observation.controls.map((control) => control.answered)).toEqual([
      true,
      true,
    ]);
    expect(observation.controls.map((control) => control.checked)).toEqual([
      true,
      false,
    ]);
  });

  test("reports reading and model-turn progress while it works", async () => {
    const progress: string[] = [];
    await runApplyAgent(
      config(page(), {
        onProgress: ({ note }) => {
          progress.push(note);
        },
      }),
      repeatingModel("finish", { reason: "The form is ready for review" }),
    );

    expect(progress[0]).toBe("reading the application form");
    expect(progress).toContain("asking the assistant what to do next");
  });

  test("an agent that keeps doing nothing is warned once and then stopped", async () => {
    const result = await runApplyAgent(
      config(page(), { runControl: { maxSteps: 40, noProgressStepLimit: 3 } }),
      repeatingModel("inspect_form", {}),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.reason).toContain("stopped responding");
    // Stopped well before the ceiling: one warning, then one more idle window.
    expect(result.steps).toBeLessThan(12);
  });

  test("an agent that says it is stuck is believed, and its words reach the person", async () => {
    const result = await runApplyAgent(
      config(page()),
      repeatingModel("finish", {
        reason: "The form will not accept the phone number in any format",
        stuck: true,
      }),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.reason).toBe(
      "Job Finder stopped on the careers site because it got stuck: The form will not accept the phone number in any format.",
    );
  });

  test("finishing normally reports what was filled in, in plain words", async () => {
    const result = await runApplyAgent(
      config(
        page({
          controls: [
            {
              index: 0,
              tagName: "input",
              inputType: "text",
              role: "",
              id: "f0",
              name: "f0",
              label: "Full name",
              groupLabel: "",
              placeholder: "",
              autocomplete: "",
              required: true,
              invalid: false,
              validationMessage: "",
              disabled: false,
              readOnly: false,
              visible: true,
              value: "Robin Ashford",
              checked: false,
              multiple: false,
              options: [],
              selectedOptionLabel: "",
            },
          ],
        }),
      ),
      repeatingModel("finish", { reason: "Nothing left to fill in" }),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.reason).toContain("Nothing left to fill in");
    expect(result.reason).toContain("nothing was sent");
  });

  test("does not call a form ready while a visible required answer is empty", async () => {
    const result = await runApplyAgent(
      config(page({ controls: [{ ...nameControl(), value: "" }] })),
      repeatingModel("finish", { reason: "The form is ready for review" }),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.reason).toContain("stopped responding");
  });

  test("does not call a native select ready while only its placeholder is displayed", async () => {
    const result = await runApplyAgent(
      config(
        page({
          controls: [
            {
              ...nameControl(),
              tagName: "select",
              inputType: "select-one",
              role: "combobox",
              label: "Location",
              value: "",
              options: ["", "Remote Europe"],
              selectedOptionLabel: "Select an option",
              invalid: true,
              validationMessage: "Please select an item in the list.",
            },
          ],
        }),
      ),
      repeatingModel("finish", { reason: "The form is ready for review" }),
    );

    expect(result.outcome).toBe("paused");
    expect(
      result.pauses.flatMap((pause) => pause.questions ?? []),
    ).toHaveLength(1);
  });

  test("refuses an early finish, fills a known required radio, then becomes ready", async () => {
    const source = page({
      controls: [
        workAuthorizationRadio(0, "Yes"),
        workAuthorizationRadio(1, "No"),
      ],
    });
    const baseHands = hands(source);
    const baseConfig = config(source);
    const result = await runApplyAgent(
      config(source, {
        hands: {
          ...baseHands,
          setToggle: (ref, checked) => {
            const index = Number(ref.slice(1));
            source.controls = source.controls.map((control) =>
              control.index === index
                ? { ...control, checked }
                : control.name === "workAuthorization"
                  ? { ...control, checked: false }
                  : control,
            );
            return Promise.resolve({
              ok: true as const,
              observedValue: checked ? "checked" : "unchecked",
            });
          },
        },
        sources: {
          ...baseConfig.sources,
          profile: CandidateProfileSchema.parse({
            ...baseConfig.sources.profile,
            answerBank: { workAuthorization: "Yes" },
          }),
        },
      }),
      scriptedModel([
        { name: "finish", args: { reason: "The form is ready" } },
        {
          name: "set_checkbox",
          args: { ref: "c0", checked: true },
        },
        { name: "finish", args: { reason: "The form is ready" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.filled).toHaveLength(1);
    expect(result.filled[0]?.answer.value).toBe("Yes");
  });

  test("does not trust a write receipt when the live required field stayed empty", async () => {
    const source = page({ controls: [{ ...nameControl(), value: "" }] });
    const result = await runApplyAgent(
      config(source),
      scriptedModel([
        { name: "type", args: { ref: "c0", text: "Robin Ashford" } },
        { name: "finish", args: { reason: "The form is ready" } },
      ]),
    );

    expect(result.filled).toHaveLength(1);
    expect(result.outcome).toBe("stuck");
  });

  test("keeps a hidden required file input unfinished until its supplied document is attached", async () => {
    const source = page({
      controls: [
        {
          ...nameControl(),
          inputType: "file",
          label: "Resume",
          visible: false,
          value: "",
        },
      ],
    });
    const baseHands = hands(source);
    const suppliedResume = {
      id: "resume_document",
      fileName: "resume.txt",
      mimeType: "text/plain",
      label: "Resume",
      kind: "resume" as const,
      loadBytes: () => Promise.resolve(new TextEncoder().encode("Resume")),
    };
    const result = await runApplyAgent(
      config(source, {
        hands: {
          ...baseHands,
          uploadFile: (_ref, file) => {
            source.controls = source.controls.map((control) => ({
              ...control,
              value: file.name,
            }));
            return Promise.resolve({
              ok: true as const,
              observedValue: file.name,
            });
          },
        },
        sources: {
          ...config(source).sources,
          documents: [suppliedResume],
        },
      }),
      scriptedModel([
        { name: "finish", args: { reason: "The form is ready" } },
        {
          name: "upload",
          args: { ref: "c0", documentId: suppliedResume.id },
        },
        { name: "finish", args: { reason: "The form is ready" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.attachments).toHaveLength(1);
  });

  test("hands an unmatched required upload to the person even when a resume is available", async () => {
    const source = page({
      controls: [
        {
          ...nameControl(),
          inputType: "file",
          label: "Academic transcript",
          visible: false,
          value: "",
        },
      ],
    });
    const suppliedResume = {
      id: "resume_document",
      fileName: "resume.txt",
      mimeType: "text/plain",
      label: "Resume",
      kind: "resume" as const,
      loadBytes: () => Promise.resolve(new TextEncoder().encode("Resume")),
    };

    const result = await runApplyAgent(
      config(source, {
        sources: {
          ...config(source).sources,
          documents: [suppliedResume],
        },
      }),
      repeatingModel("finish", {
        reason: "The required Academic transcript upload is unavailable",
        stuck: true,
      }),
    );

    expect(result.outcome).toBe("paused");
    expect(result.pauses[0]?.questions).toHaveLength(1);
    expect(result.pauses[0]?.questions?.[0]?.prompt).toBe(
      "Academic transcript",
    );
    expect(result.pauses[0]?.questions?.[0]?.answerControlType).toBe("file");
  });

  test("preserves an unrelated structural failure when a file also happens to be empty", async () => {
    const source = page({
      controls: [
        {
          ...nameControl(),
          inputType: "file",
          label: "Academic transcript",
          visible: false,
          value: "",
        },
      ],
    });

    const result = await runApplyAgent(
      config(source),
      repeatingModel("finish", {
        reason: "The application page navigation failed",
        stuck: true,
      }),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.pauses).toEqual([]);
  });

  test("keeps a required letter with the person when saved settings say never", async () => {
    const source = page({
      controls: [
        {
          ...nameControl(),
          inputType: "file",
          label: "Cover letter",
          value: "",
        },
      ],
    });
    const provide = vi.fn();
    const result = await runApplyAgent(
      config(source, {
        writing: {
          coverLetterPolicy: "never",
          writtenAnswerLength: "full",
          preApprovedDeclarations: [],
        },
        letters: {
          preference: {
            tone: "plain_professional",
            length: "short",
            language: null,
            sample: null,
          },
          provide,
        },
      }),
      repeatingModel("finish", { reason: "The rest of the form is ready" }),
    );

    expect(result.outcome).toBe("paused");
    expect(result.pauses[0]?.code).toBe("document_needs_you");
    expect(result.reason).toContain("settings say Job Finder should not write");
    expect(provide).not.toHaveBeenCalled();
  });

  test("hands unknown required eligibility to the person instead of inventing it", async () => {
    const result = await runApplyAgent(
      config(
        page({
          controls: [
            workAuthorizationRadio(0, "Yes"),
            workAuthorizationRadio(1, "No"),
          ],
        }),
      ),
      repeatingModel("finish", { reason: "The form is ready" }),
    );

    expect(result.outcome).toBe("paused");
    const questions = result.pauses.flatMap((pause) => pause.questions ?? []);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      prompt: "Are you legally authorized to work in this country?",
      answerOptions: ["Yes", "No"],
    });
  });

  test("keeps equal-worded radio groups with different DOM names separate", async () => {
    const result = await runApplyAgent(
      config(
        page({
          controls: [
            ...["Yes", "No"].map((label, index) => ({
              ...workAuthorizationRadio(index, label as "Yes" | "No"),
              name: "authorized-primary",
            })),
            ...["Yes", "No"].map((label, index) => ({
              ...workAuthorizationRadio(index + 2, label as "Yes" | "No"),
              name: "authorized-secondary",
            })),
          ],
        }),
      ),
      repeatingModel("finish", { reason: "The form is ready" }),
    );

    expect(
      result.pauses.flatMap((pause) => pause.questions ?? []),
    ).toHaveLength(2);
  });

  test("one failed first read is given to the model and can recover", async () => {
    const source = page();
    const base = hands(source);
    let reads = 0;
    const result = await runApplyAgent(
      config(source, {
        hands: {
          ...base,
          observe: () => {
            reads += 1;
            return reads === 1
              ? Promise.reject(
                  new Error("The page was replaced while it loaded."),
                )
              : base.observe();
          },
        },
      }),
      scriptedModel([
        { name: "observe", args: {} },
        { name: "finish", args: { reason: "The form recovered and is ready" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.reason).toContain("The form recovered and is ready");
    expect(result.notes.join("\n")).toContain("application page did not open");
  });

  test("a sign-in wall is a fact the model is told, not an automatic stop", async () => {
    // The model is trusted to decide what to do about it — often there is a
    // guest route, and when there is not it finishes and says so.
    const result = await runApplyAgent(
      config(page({ bodyText: "You must be signed in to apply" })),
      repeatingModel("finish", {
        reason: "This site wants you signed in before it will show the form",
        needsPerson: true,
      }),
    );

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("wants you signed in");
  });

  test("a credential gate never becomes a persisted password question", async () => {
    const passwordControl: RawApplyControl = {
      ...nameControl(),
      id: "password",
      name: "password",
      inputType: "password",
      label: "Password *",
      value: "",
    };
    const result = await runApplyAgent(
      config(
        page({
          url: "https://apply.example.test/signin",
          bodyText: "Sign in to continue",
          controls: [passwordControl],
          actions: [
            { index: 0, label: "Sign in", visible: true, disabled: false },
          ],
        }),
      ),
      scriptedModel([
        { name: "suggest_answer", args: { ref: "f0" } },
        {
          name: "finish",
          args: { reason: "The site requires a password", needsPerson: true },
        },
      ]),
    );

    expect(result.outcome).toBe("paused");
    expect(result.pauses).toHaveLength(1);
    expect(result.pauses[0]?.blocker?.code).toBe("site_login_required");
    expect(result.pauses[0]?.question).toBeNull();
    expect(result.pauses[0]?.questions).toBeUndefined();
  });

  test("a visible CAPTCHA stays with the person even when the model calls the form finished", async () => {
    const result = await runApplyAgent(
      config(
        page({
          bodyText: "Apply for the role. I am not a robot. Local fake CAPTCHA.",
        }),
      ),
      repeatingModel("finish", { reason: "The form is ready for review" }),
    );

    expect(result.outcome).toBe("paused");
    expect(result.reason).toBe("The site is running a security check.");
    expect(result.pauses[0]?.blocker?.requiresPerson).toBe(true);
  });

  test("a security check the person already ticked is not reported as waiting on them", async () => {
    const result = await runApplyAgent(
      config(
        page({
          bodyText: "Apply for the role. I am not a robot. Local fake CAPTCHA.",
          controls: [
            nameControl(),
            {
              ...nameControl(),
              index: 1,
              id: "human",
              name: "human",
              inputType: "checkbox",
              role: "checkbox",
              label: "I am not a robot",
              required: false,
              checked: true,
              value: "yes",
            },
          ],
        }),
        {
          authority: {
            mode: "confirm_before_submit",
            submitAuthorized: true,
            preApprovedAttestationKinds: [],
            salaryDisclosure: "pause_for_user",
            allowedOrigins: [],
          },
        },
      ),
      repeatingModel("finish", {
        reason:
          "Form filled, but Submit is blocked by the 'I am not a robot' CAPTCHA which only you can tick.",
        needsPerson: true,
      }),
    );

    expect(result.pauses).toEqual([]);
    expect(result.outcome).toBe("awaiting_your_review");
  });

  test("a run set to confirm first ends waiting for the person", async () => {
    const result = await runApplyAgent(
      config(page(), {
        authority: {
          mode: "confirm_before_submit",
          submitAuthorized: true,
          preApprovedAttestationKinds: [],
          salaryDisclosure: "pause_for_user",
          allowedOrigins: [],
        },
      }),
      repeatingModel("finish", { reason: "Nothing left to fill in" }),
    );

    expect(result.outcome).toBe("awaiting_your_review");
    expect(result.reason).toContain("ready for you to look over");
  });
});

/**
 * Asking once instead of once per field.
 *
 * A form with several questions nobody's profile answers used to stop at the
 * first one; the person answered, waited for a retry, and met the next. The
 * run now works the whole form and comes back with all of them together.
 */

/**
 * The form as a live board actually renders it.
 *
 * Read off a real posting: a phone country picker beside a phone number field,
 * both labelled Phone; a file field labelled "Attach"; yes/no questions drawn
 * as comboboxes; country lists; and hidden inputs that belong to the widgets
 * rather than to the person. Ten of these are answered from the person's own
 * profile, so the model is asked about the rest and nothing else.
 */

/**
 * A run says where its minutes went.
 *
 * Six minutes on a single-page form is the difference between a person using
 * this and not, and it cannot be diagnosed from a record that says only
 * "Filling in the form…".
 */
describe("the run records its own timing", () => {
  test("the trail ends with the phases and the number of model turns", async () => {
    const result = await runApplyAgent(
      config(page()),
      repeatingModel("finish", { reason: "Nothing left to fill in" }),
    );

    const timing = result.notes.at(-1) ?? "";
    expect(timing.startsWith("[apply] timing ")).toBe(true);
    expect(timing).toContain("read=");
    expect(timing).toContain("fill=");
    expect(timing).toMatch(/model=\d+ turns/u);
    expect(timing).toContain("total=");
  });
});

/**
 * Who gets asked what.
 *
 * Equal-opportunity and other voluntary declarations are the person's own and
 * optional by the site: they are left blank and said so, never put in front of
 * the person as a question they have to clear.
 */

/**
 * A field is written once.
 *
 * Thirty-three writes for fourteen fields is the run re-doing work it has
 * already done, and every one of those costs the person a second.
 */
describe("no field is written twice", () => {
  test("a control already holding its sourced answer is left alone", async () => {
    const already = {
      ...nameControl(),
      index: 0,
      label: "First Name",
      value: "Robin",
    };
    const result = await runApplyAgent(
      config(page({ controls: [already] })),
      repeatingModel("finish", { reason: "Nothing left to fill in" }),
    );

    expect(result.filled).toHaveLength(0);
  });

  test("each turn the model takes is written down", async () => {
    const result = await runApplyAgent(
      config(page()),
      repeatingModel("finish", { reason: "Nothing left to fill in" }),
    );

    expect(result.notes.some((note) => note.startsWith("turn 1: "))).toBe(true);
  });

  test("blocks a second successful write to the same control on the same page", async () => {
    const result = await runApplyAgent(
      config(page()),
      scriptedModel([
        { name: "type", args: { ref: "c0", text: "Robin Ashford" } },
        { name: "type", args: { ref: "c0", text: "Robin Ashford" } },
        { name: "finish", args: { reason: "The form is prepared" } },
      ]),
    );

    expect(result.filled).toHaveLength(1);
    expect(result.notes.join("\n")).toContain(
      "That exact field was already completed",
    );
  });
});

describe("only meaningful page movement counts as progress", () => {
  test("repeated scrolling cannot keep a stuck run alive", async () => {
    const result = await runApplyAgent(
      config(page(), {
        runControl: { noProgressStepLimit: 3, maxSteps: 20 },
      }),
      repeatingModel("scroll", { direction: "down" }),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.reason).toContain("nothing new happened");
    expect(result.steps).toBeLessThan(20);
  });
});

describe("the browser failing underneath a step", () => {
  test("one failure is handed back to the model as a fact, and the run carries on", async () => {
    const source = page();
    const base = hands(source);
    let reads = 0;
    const flakyHands: ApplyPageHands = {
      ...base,
      // The very first read after the click dies the way a navigation kills
      // it; the read after that sees the new page.
      observe: () => {
        reads += 1;
        if (reads === 2) {
          return Promise.reject(
            new Error(
              "The page moved to a new address while Job Finder was reading it.",
            ),
          );
        }
        return base.observe();
      },
    };
    const result = await runApplyAgent(
      config(source, { hands: flakyHands }),
      scriptedModel([
        { name: "observe", args: {} },
        {
          name: "finish",
          args: { reason: "The page moved on and the form is here now" },
        },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.notes.join("\n")).toContain("browser failure");
    expect(result.notes.join("\n")).toContain("moved to a new address");
  });

  test("the browser failing three times in a row ends the run in plain words", async () => {
    const source = page();
    const base = hands(source);
    let reads = 0;
    const deadHands: ApplyPageHands = {
      ...base,
      observe: () => {
        reads += 1;
        return reads === 1
          ? base.observe()
          : Promise.reject(
              new Error(
                "The browser tab Job Finder was working in was closed.",
              ),
            );
      },
    };
    const result = await runApplyAgent(
      config(source, { hands: deadHands }),
      repeatingModel("observe", {}),
    );

    expect(result.outcome).toBe("stuck");
    expect(result.reason).toContain("the browser page stopped responding");
    expect(result.reason).toContain("was closed");
    expect(result.reason).not.toContain("locator");
  });
});

describe("shared navigation and Apply safety stay in one state", () => {
  test("a send allowlist does not block an employer handoff approved by the move reviewer", async () => {
    const source = page();
    const base = hands(source);
    let navigations = 0;
    let reviews = 0;
    const result = await runApplyAgent(
      config(source, {
        hands: {
          ...base,
          navigate: (url) => {
            navigations += 1;
            return Promise.resolve({ ok: true, url });
          },
        },
        authority: {
          mode: "prepare_only",
          submitAuthorized: false,
          preApprovedAttestationKinds: [],
          salaryDisclosure: "pause_for_user",
          allowedOrigins: ["https://apply.example.test"],
        },
        reviewMove: () => {
          reviews += 1;
          return Promise.resolve({ allowed: true, verdict: "Looks relevant." });
        },
      }),
      scriptedModel([
        {
          name: "navigate",
          args: {
            url: "https://forbidden.example/form",
            reason: "The form is there.",
          },
        },
        { name: "finish", args: { reason: "Stayed on the allowed site" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(navigations).toBe(1);
    expect(reviews).toBe(1);
  });

  test("navigate then type uses the page the model just saw and reviews the move once", async () => {
    let current = page();
    let reviews = 0;
    const base = hands(current);
    const dynamicHands: ApplyPageHands = {
      ...base,
      observe: () =>
        Promise.resolve(
          buildApplyFormObservation(current, "2026-09-14T10:00:00.000Z"),
        ),
      navigate: (url) => {
        current = page({ url, title: "External application" });
        return Promise.resolve({ ok: true, url });
      },
    };
    const result = await runApplyAgent(
      config(current, {
        hands: dynamicHands,
        reviewMove: () => {
          reviews += 1;
          return Promise.resolve({
            allowed: true,
            verdict: "This is the employer form.",
          });
        },
      }),
      scriptedModel([
        {
          name: "navigate",
          args: {
            url: "https://employer.example/form",
            reason: "The listing points to the employer application form.",
          },
        },
        { name: "type", args: { ref: "c0", text: "Robin Ashford" } },
        { name: "finish", args: { reason: "The form is prepared" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(result.filled).toHaveLength(1);
    expect(result.notes.join("\n")).not.toContain(
      "page changed since you last looked",
    );
    expect(reviews).toBe(1);
  });

  test("a move approved by a guarded click is reused by shared navigation", async () => {
    let current = page({
      actions: [{ index: 0, label: "Apply", visible: true, disabled: false }],
    });
    let reviews = 0;
    const base = hands(current);
    const dynamicHands: ApplyPageHands = {
      ...base,
      observe: () =>
        Promise.resolve(
          buildApplyFormObservation(current, "2026-09-14T10:00:00.000Z"),
        ),
      clickElement: () => {
        current = page({ url: "https://employer.example/form" });
        return Promise.resolve({ ok: true, observedValue: "clicked" });
      },
      navigate: (url) => {
        current = page({ url });
        return Promise.resolve({ ok: true, url });
      },
    };
    const result = await runApplyAgent(
      config(current, {
        hands: dynamicHands,
        reviewMove: () => {
          reviews += 1;
          return Promise.resolve({
            allowed: true,
            verdict: "This is the employer form.",
          });
        },
      }),
      scriptedModel([
        {
          name: "click",
          args: {
            ref: "a0",
            reason: "The listing's Apply button leads to the employer form.",
          },
        },
        {
          name: "navigate",
          args: {
            url: "https://employer.example/form/step-two",
            reason: "The next application step is on the same employer site.",
          },
        },
        { name: "finish", args: { reason: "The employer form is prepared" } },
      ]),
    );

    expect(result.outcome).toBe("prepared");
    expect(reviews).toBe(1);
  });
});
