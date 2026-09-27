// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  GroupedManualAnswerDecisionSchema,
  UserActionRequestSchema,
  type ApplyGroupedManualAnswerInput,
  type CandidateProfile,
  type GroupedManualAnswerDecision,
  type JobFinderWorkspaceSnapshot,
  type ProjectGroupedManualAnswerCommand,
  type SnoozeGroupedDecisionInput,
  type UserActionCommandInput,
} from "@unemployed/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActionsScreen } from "./actions-screen";

afterEach(cleanup);

function createManualAnswerRequest(input: {
  applicationRecordId?: string;
  id: string;
  jobId: string;
  revision?: number;
  state?: "pending" | "verifying" | "resolved";
}) {
  return UserActionRequestSchema.parse({
    id: input.id,
    dedupeKey: `dedupe_${input.id}`,
    revision: input.revision ?? 1,
    kind: "manual_answer",
    state: input.state ?? "pending",
    scope: {
      type: "application",
      runId: "run_1",
      jobId: input.jobId,
      applicationRecordId:
        input.applicationRecordId ?? `application_${input.jobId}`,
      source: "target_site",
    },
    verification: {
      type: "page_blocker_absent",
      blockerFingerprint: "blocker_1",
    },
    title: `Answer question for ${input.jobId}`,
    summary: "Review and answer the question in the browser.",
    actionUrl: "https://jobs.example.com/application",
    displayOrigin: "https://jobs.example.com/",
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T08:00:00.000Z",
  });
}

function createLineageEntry(entry: {
  requestId: string;
  jobId: string;
  applicationRecordId?: string;
  expectedRequestRevision?: number;
}) {
  return {
    requestId: entry.requestId,
    jobId: entry.jobId,
    applicationRecordId:
      entry.applicationRecordId ?? `application_${entry.jobId}`,
    resultId: null,
    questionId: "question_years",
    answerRecordId: null,
    expectedRequestRevision: entry.expectedRequestRevision ?? 1,
    expectedQuestionRevision: 1,
    expectedAnswerRevision: 0,
    appliedAt: null,
  };
}

function createDecision(
  overrides: Partial<GroupedManualAnswerDecision> = {},
): GroupedManualAnswerDecision {
  return GroupedManualAnswerDecisionSchema.parse({
    id: "group_1:abc123",
    groupKey: "group_1",
    requestId: "request_a",
    applicationRecordId: "application_job_a",
    jobId: "job_a",
    resultId: null,
    questionId: "question_years",
    expectedRevision: 1,
    expectedQuestionRevision: 1,
    expectedAnswerRevision: 0,
    fingerprints: {
      questionMeaning: "a".repeat(64),
      answerPolicy: "b".repeat(64),
    },
    answer: { type: "text", value: "5 years" },
    approval: "pending",
    conflict: { status: "none" },
    snooze: null,
    lineage: [
      createLineageEntry({ requestId: "request_a", jobId: "job_a" }),
      createLineageEntry({ requestId: "request_b", jobId: "job_b" }),
    ],
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  });
}

function createJobs(): JobFinderWorkspaceSnapshot["discoveryJobs"] {
  return [
    { id: "job_a", title: "Senior Engineer", company: "Acme" },
    { id: "job_b", title: "Staff Engineer", company: "Beta" },
    { id: "job_c", title: "Principal Engineer", company: "Gamma" },
  ] as unknown as JobFinderWorkspaceSnapshot["discoveryJobs"];
}

function renderScreen(props: {
  decision?: GroupedManualAnswerDecision;
  onApply?: (input: ApplyGroupedManualAnswerInput) => void;
  onProject?: (command: ProjectGroupedManualAnswerCommand) => void;
  onSnooze?: (input: SnoozeGroupedDecisionInput) => void;
  requests?: readonly ReturnType<typeof createManualAnswerRequest>[];
}) {
  const onApply = vi.fn(props.onApply ?? (() => undefined));
  const onProject = vi.fn(props.onProject ?? (() => undefined));
  const onSnooze = vi.fn(props.onSnooze ?? (() => undefined));
  const screen = render(
    <ActionsScreen
      discoveryJobs={createJobs()}
      groupedDecisions={props.decision ? [props.decision] : []}
      isPending={() => false}
      onApplyGroupedManualAnswer={onApply}
      onCommand={vi.fn<(command: UserActionCommandInput) => void>()}
      onNavigate={vi.fn()}
      onProjectGroupedManualAnswer={onProject}
      onSnoozeGroupedDecision={onSnooze}
      requests={props.requests ?? []}
    />,
  );
  return { onApply, onProject, onSnooze, screen };
}

describe("ActionsScreen persisted grouped reusable answers", () => {
  it("never renders a persisted legacy password question as an answer form", () => {
    const request = createManualAnswerRequest({
      id: "legacy_password_request",
      jobId: "job_a",
    });
    const applicationAttempts = [
      {
        applicationRecordId: "application_job_a",
        jobId: "job_a",
        blocker: { code: "missing_candidate_answer" },
        questions: [
          {
            id: "question_password",
            prompt: "Password *",
            kind: "other",
            status: "detected",
          },
        ],
        updatedAt: "2026-08-15T09:00:00.000Z",
      },
    ] as unknown as JobFinderWorkspaceSnapshot["applicationAttempts"];
    const onCommand = vi.fn();
    const { getByRole, getByText, queryByLabelText, queryByRole } = render(
      <ActionsScreen
        applicationAttempts={applicationAttempts}
        discoveryJobs={createJobs()}
        isPending={() => false}
        onCommand={onCommand}
        onNavigate={vi.fn()}
        requests={[request]}
      />,
    );

    expect(getByText("Sign in to continue")).toBeTruthy();
    expect(getByText(/cannot collect a password/i)).toBeTruthy();
    expect(queryByLabelText("Password *")).toBeNull();
    expect(queryByRole("button", { name: "Answer and continue" })).toBeNull();
    expect(
      getByRole("button", { name: "Open the Job Finder browser" }),
    ).toBeTruthy();
    expect(
      getByRole("button", { name: "Check whether this step is done" }),
    ).toBeTruthy();
  });

  it("projects the typed draft as a reusable-profile command rooted at the request revision", () => {
    const request = createManualAnswerRequest({
      id: "request_a",
      jobId: "job_a",
      revision: 2,
    });
    const profile = {
      answerBank: { customAnswers: [] },
      proofBank: [],
    } as unknown as CandidateProfile;
    const applicationAttempts = [
      {
        applicationRecordId: "application_job_a",
        jobId: "job_a",
        blocker: { code: "missing_candidate_answer" },
        questions: [
          {
            id: "question_years",
            prompt: "Years of experience",
            kind: "other",
            status: "detected",
          },
        ],
        updatedAt: "2026-08-15T09:00:00.000Z",
      },
    ] as unknown as JobFinderWorkspaceSnapshot["applicationAttempts"];
    const onProject =
      vi.fn<(command: ProjectGroupedManualAnswerCommand) => void>();
    const onCommand = vi.fn();

    const { getByLabelText, getByRole, queryByRole, getByText } = render(
      <ActionsScreen
        applicationAttempts={applicationAttempts}
        discoveryJobs={createJobs()}
        groupedDecisions={[]}
        isPending={() => false}
        onCommand={onCommand}
        onNavigate={vi.fn()}
        onProjectGroupedManualAnswer={onProject}
        profile={profile}
        requests={[request]}
      />,
    );

    // One field, one checkbox, one button — the four-button answer-memory
    // panel (which was not in the accessibility tree at all) is gone.
    // The label of the control is the question itself.
    // One sentence above the job line, not four restating the heading.
    expect(
      getByText(
        "Nothing in your profile, resume, or saved answers covers this.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(
      /complete this manual-answer step|come back here and confirm/i,
    );
    fireEvent.change(getByLabelText("Years of experience"), {
      target: { value: "5 years" },
    });
    // Remembered by default, so the next application does not ask again.
    expect(
      (getByLabelText("Save this answer for next time") as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(getByRole("button", { name: "Answer and continue" }));

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submit_manual_answer",
        answer: "5 years",
        // Tied to its question even when it is the only one on the card.
        answers: [{ questionId: "question_years", answer: "5 years" }],
        requestId: "request_a",
        saveForFuture: true,
      }),
    );
    expect(onProject).not.toHaveBeenCalled();
    for (const gone of [
      "Use once",
      "Save for future & use",
      "Reuse for matching applications",
      "Reset draft",
    ]) {
      expect(queryByRole("button", { name: gone })).toBeNull();
    }
    expect(document.body.textContent ?? "").not.toMatch(
      /answer memory|reusable match|manual-answer step|prepare-only retry|verify the blocker|projects this draft|exact compatible/i,
    );
    expect(getByRole("button", { name: /Skip this job/ })).toBeTruthy();
  });

  it("offers a consent box as a box, and names what the profile has when it does not settle a question", () => {
    const request = createManualAnswerRequest({ id: "request_a", jobId: "job_a" });
    const applicationAttempts = [
      {
        applicationRecordId: "application_job_a",
        jobId: "job_a",
        blocker: { code: "missing_candidate_answer" },
        questions: [
          {
            id: "question_consent",
            prompt: "I consent to a background check",
            kind: "other",
            answerControlType: "boolean",
            status: "detected",
          },
          {
            id: "question_country",
            prompt: "Are you authorized to work in the job's country?",
            kind: "work_authorization",
            answerControlType: "single_choice",
            answerOptions: ["Yes", "No"],
            note: "This asks whether you can work in Europe. Your profile says you can work in Germany, which does not settle it.",
            status: "detected",
          },
        ],
        updatedAt: "2026-08-15T09:00:00.000Z",
      },
    ] as unknown as JobFinderWorkspaceSnapshot["applicationAttempts"];
    const onCommand = vi.fn();
    const { getByLabelText, getByRole, getByTestId, getByText, queryByText } =
      render(
        <ActionsScreen
          applicationAttempts={applicationAttempts}
          discoveryJobs={createJobs()}
          isPending={() => false}
          onCommand={onCommand}
          onNavigate={vi.fn()}
          requests={[request]}
        />,
      );

    expect(
      queryByText("Nothing in your profile, resume, or saved answers covers this."),
    ).toBeNull();
    expect(getByText(/Your profile says you can work in Germany/)).toBeTruthy();
    const box = getByTestId("needs-you-question-checkbox") as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(document.querySelector("textarea")).toBeNull();

    fireEvent.change(
      getByLabelText("Are you authorized to work in the job's country?"),
      { target: { value: "Yes" } },
    );
    const answer = getByRole("button", { name: "Answer and continue" });
    expect((answer as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(answer);
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "submit_manual_answer",
        answers: [
          { questionId: "question_consent", answer: "Yes" },
          { questionId: "question_country", answer: "Yes" },
        ],
      }),
    );
  });

  it("shows the exact unique job count and full title/company lineage with revisions", () => {
    const decision = createDecision({
      lineage: [
        createLineageEntry({ requestId: "request_a", jobId: "job_a" }),
        createLineageEntry({ requestId: "request_b", jobId: "job_b" }),
        createLineageEntry({ requestId: "request_c", jobId: "job_c" }),
      ],
    });
    const { screen } = renderScreen({ decision });

    expect(
      screen.getByRole("heading", {
        name: "Reuse one answer across 3 jobs",
      }),
    ).toBeTruthy();
    expect(screen.getByText("5 years")).toBeTruthy();
    expect(screen.getByText("Senior Engineer at Acme")).toBeTruthy();
    expect(screen.getByText("Staff Engineer at Beta")).toBeTruthy();
    expect(screen.getByText("Principal Engineer at Gamma")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve & reuse for 3 jobs" }),
    ).toBeTruthy();
    expect(screen.getByText(/^request request_a · revision 1$/)).toBeTruthy();
    expect(screen.getByText(/^request request_b · revision 1$/)).toBeTruthy();
    expect(screen.getByText(/^request request_c · revision 1$/)).toBeTruthy();
  });

  it("hides ordinary member cards while a pending decision represents them", () => {
    const decision = createDecision();
    const requests = [
      createManualAnswerRequest({ id: "request_a", jobId: "job_a" }),
      createManualAnswerRequest({ id: "request_b", jobId: "job_b" }),
    ];
    const { screen } = renderScreen({ decision, requests });

    expect(screen.getByText("5 years")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve & reuse for 2 jobs" }),
    ).toBeTruthy();
    expect(screen.queryByText("Answer question for job_a")).toBeNull();
    expect(screen.queryByText("Answer question for job_b")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Applications" })).toBeNull();
  });

  it("approves with exactly the lineage ids, revisions, and persisted answer", () => {
    const decision = createDecision();
    const { onApply, screen } = renderScreen({ decision });

    fireEvent.click(
      screen.getByRole("button", { name: "Approve & reuse for 2 jobs" }),
    );

    expect(onApply).toHaveBeenCalledWith({
      decisionId: "group_1:abc123",
      requestIds: ["request_a", "request_b"],
      expectedRequestRevisions: { request_a: 1, request_b: 1 },
      answer: { type: "text", value: "5 years" },
    });
    expect(document.body.textContent ?? "").toMatch(
      /Job Finder cannot create an account or submit an application/i,
    );
    expect(document.body.textContent ?? "").not.toMatch(
      /later explicit confirmation/i,
    );
  });

  it("snoozes with the decision revision and a future note-free payload", () => {
    const decision = createDecision();
    const { onSnooze, screen } = renderScreen({ decision });

    fireEvent.click(screen.getByRole("button", { name: "Snooze 3 days" }));

    expect(onSnooze).toHaveBeenCalledTimes(1);
    const input = onSnooze.mock.calls[0]?.[0] as SnoozeGroupedDecisionInput;
    expect(input).toMatchObject({
      decisionId: "group_1:abc123",
      expectedRevision: 1,
      reason: null,
    });
    expect(Date.parse(input.until)).toBeGreaterThan(Date.now() - 1_000);
  });

  it("keeps a conflicted decision visible with reason/recovery while approval is disabled", () => {
    const decision = createDecision({
      conflict: {
        status: "detected",
        detectedAt: "2026-08-15T11:00:00.000Z",
        resolvedAt: null,
        conflictingDecisionId: null,
        summary: "A conflicting saved answer exists for this question.",
      },
    });
    const { screen } = renderScreen({ decision });

    expect(
      screen.getByText(/A conflicting saved answer exists for this question/),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(
      /Approval stays disabled until the conflict is resolved/i,
    );
    expect(
      screen.getByRole("button", { name: "Approve & reuse for 2 jobs" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Snooze 3 days" }),
    ).toHaveProperty("disabled", false);
  });

  it("keeps snoozed decisions represented in the compact Snoozed section", () => {
    const decision = createDecision({
      snooze: {
        until: "2026-08-20T10:00:00.000Z",
        reason: "Ask the recruiter",
      },
    });
    const requests = [
      createManualAnswerRequest({ id: "request_a", jobId: "job_a" }),
      createManualAnswerRequest({ id: "request_b", jobId: "job_b" }),
    ];
    const { screen } = renderScreen({ decision, requests });

    expect(screen.getByRole("heading", { name: "Snoozed" })).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Snoozed reusable answer for 2 jobs",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Snoozed until/i);
    expect(screen.getByRole("status").textContent).toContain(
      "Ask the recruiter",
    );
    expect(screen.queryByText("Answer question for job_a")).toBeNull();
    expect(screen.queryByText("Answer question for job_b")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Approve & reuse for 2 jobs" }),
    ).toBeTruthy();
  });

  it("lets ordinary member cards reappear after the decision is approved", () => {
    const decision = createDecision({
      approval: "approved",
      approvedAt: "2026-08-16T10:00:00.000Z",
    });
    const requests = [
      createManualAnswerRequest({
        id: "request_a",
        jobId: "job_a",
        state: "verifying",
      }),
      createManualAnswerRequest({
        id: "request_b",
        jobId: "job_b",
        state: "verifying",
      }),
    ];
    const { screen } = renderScreen({ decision, requests });

    expect(screen.queryByText("5 years")).toBeNull();
    expect(screen.queryByText("Reusable answers")).toBeNull();
    expect(screen.getByText("Answer question for job_a")).toBeTruthy();
    expect(screen.getByText("Answer question for job_b")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Applications" })).toBeTruthy();
  });
});

describe("Needs you question step shapes", () => {
  const profile = {
    answerBank: { customAnswers: [] },
    proofBank: [],
  } as unknown as CandidateProfile;

  function attemptsWith(
    questions: ReadonlyArray<Record<string, unknown>>,
  ): JobFinderWorkspaceSnapshot["applicationAttempts"] {
    return [
      {
        applicationRecordId: "application_job_a",
        jobId: "job_a",
        blocker: { code: "missing_candidate_answer" },
        questions,
        updatedAt: "2026-08-15T09:00:00.000Z",
      },
    ] as unknown as JobFinderWorkspaceSnapshot["applicationAttempts"];
  }

  function renderStep(
    questions: ReadonlyArray<Record<string, unknown>>,
    onCommand: (command: UserActionCommandInput) => void | Promise<void>,
  ) {
    return render(
      <ActionsScreen
        applicationAttempts={attemptsWith(questions)}
        discoveryJobs={createJobs()}
        groupedDecisions={[]}
        isPending={() => false}
        onCommand={onCommand}
        onNavigate={vi.fn()}
        profile={profile}
        requests={[
          createManualAnswerRequest({
            id: "request_a",
            jobId: "job_a",
            revision: 2,
          }),
        ]}
      />,
    );
  }

  it("sends a one-off answer when the person unticks Save for next time", async () => {
    const onCommand = vi.fn<(command: UserActionCommandInput) => Promise<void>>(
      () => Promise.resolve(),
    );
    const { getByLabelText, getByRole } = renderStep(
      [
        {
          id: "q_phone",
          prompt: "Phone",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: [],
        },
      ],
      onCommand,
    );
    fireEvent.change(getByLabelText("Phone"), {
      target: { value: "+1 555 0100" },
    });
    fireEvent.click(getByLabelText("Save this answer for next time"));
    fireEvent.click(getByRole("button", { name: "Answer and continue" }));
    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledTimes(1);
    });
    expect(onCommand.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ saveForFuture: false }),
    );
  });

  it("renders every pending question and submits them all behind one button", async () => {
    const onCommand = vi.fn<(command: UserActionCommandInput) => Promise<void>>(
      () => Promise.resolve(),
    );
    const { getByLabelText, getByRole } = renderStep(
      [
        {
          id: "q_phone",
          prompt: "Phone",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: [],
        },
        {
          id: "q_sponsorship",
          prompt: "Will you need sponsorship?",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: ["Yes", "No"],
        },
      ],
      onCommand,
    );

    const answerButton = getByRole("button", { name: "Answer and continue" });
    expect(answerButton).toHaveProperty("disabled", true);

    fireEvent.change(getByLabelText("Phone"), {
      target: { value: "+1 555 0100" },
    });
    fireEvent.change(getByLabelText("Will you need sponsorship?"), {
      target: { value: "No" },
    });
    expect(answerButton).toHaveProperty("disabled", false);
    fireEvent.click(answerButton);

    // One command carries every answer tied to its question, so one
    // revision moves the step on and nothing is lost between calls.
    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledTimes(1);
    });
    expect(onCommand.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        answer: "+1 555 0100",
        saveForFuture: true,
        answers: [
          { questionId: "q_phone", answer: "+1 555 0100" },
          { questionId: "q_sponsorship", answer: "No" },
        ],
      }),
    );
  });

  it("keeps the single-question shape and its singular checkbox", () => {
    const { getByLabelText, queryByLabelText } = renderStep(
      [
        {
          id: "q_phone",
          prompt: "Phone — Phone",
          description: "Phone",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: [],
        },
      ],
      vi.fn(),
    );

    // Label and description are the same word, so it is printed once.
    expect(getByLabelText("Phone")).toBeTruthy();
    expect(getByLabelText("Save this answer for next time")).toBeTruthy();
    expect(queryByLabelText("Save these answers for next time")).toBeNull();
  });

  it("shows the pause note above a choice control", () => {
    const { getByTestId, getByLabelText } = renderStep(
      [
        {
          id: "q_auth",
          prompt: "Are you authorised to work?",
          kind: "other",
          status: "detected",
          isRequired: true,
          note: "Your answer did not fit this question.",
          answerOptions: ["Yes", "No"],
        },
      ],
      vi.fn(),
    );

    expect(getByTestId("needs-you-question-note").textContent).toBe(
      "Your answer did not fit this question.",
    );
    expect(
      (getByLabelText("Are you authorised to work?") as HTMLSelectElement)
        .tagName,
    ).toBe("SELECT");
  });

  it("says so in place when the bridge call is refused and keeps the answer", async () => {
    const onCommand = vi.fn(() => Promise.reject(new Error("Bridge refused.")));
    const { getByLabelText, getByRole, findByTestId } = renderStep(
      [
        {
          id: "q_phone",
          prompt: "Phone",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: [],
        },
      ],
      onCommand,
    );

    fireEvent.change(getByLabelText("Phone"), {
      target: { value: "+1 555 0100" },
    });
    fireEvent.click(getByRole("button", { name: "Answer and continue" }));

    const failure = await findByTestId("needs-you-answer-failure");
    expect(failure.textContent).toBe(
      "Job Finder could not save that answer; try again.",
    );
    expect((getByLabelText("Phone") as HTMLTextAreaElement).value).toBe(
      "+1 555 0100",
    );
    expect(getByRole("button", { name: "Answer and continue" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("lets optional questions stay blank without holding the button back", async () => {
    const onCommand = vi.fn<(command: UserActionCommandInput) => Promise<void>>(
      () => Promise.resolve(),
    );
    const { getByLabelText, getByRole, getByTestId } = renderStep(
      [
        {
          id: "q_phone",
          prompt: "Phone",
          kind: "other",
          status: "detected",
          isRequired: true,
          answerOptions: [],
        },
        {
          id: "q_auth",
          prompt: "Are you authorised to work?",
          kind: "other",
          status: "detected",
          isRequired: true,
          note: "Your answer did not match one of the choices.",
          answerOptions: ["Yes", "No"],
        },
        {
          id: "q_linkedin",
          prompt: "LinkedIn",
          kind: "other",
          status: "detected",
          isRequired: false,
          answerOptions: [],
        },
      ],
      onCommand,
    );

    expect(getByLabelText("LinkedIn (optional)")).toBeTruthy();
    // The per-question note stays above its own control.
    expect(getByTestId("needs-you-question-note").textContent).toBe(
      "Your answer did not match one of the choices.",
    );

    const answerButton = getByRole("button", { name: "Answer and continue" });
    expect(answerButton).toHaveProperty("disabled", true);

    fireEvent.change(getByLabelText("Phone"), {
      target: { value: "+1 555 0100" },
    });
    fireEvent.change(getByLabelText("Are you authorised to work?"), {
      target: { value: "Yes" },
    });

    // Both required answers are in; the blank optional one does not count.
    expect(answerButton).toHaveProperty("disabled", false);
    fireEvent.click(answerButton);

    await waitFor(() => {
      expect(onCommand).toHaveBeenCalledTimes(1);
    });
    expect(
      (
        onCommand.mock.calls[0]?.[0] as {
          answers: { answer: string }[];
        }
      ).answers.map((entry) => entry.answer),
    ).toEqual(["+1 555 0100", "Yes"]);
  });
});
