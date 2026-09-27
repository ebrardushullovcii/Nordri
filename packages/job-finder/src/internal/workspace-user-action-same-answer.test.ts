import { describe, expect, it } from "vitest";
import type {
  CandidateProfile,
  UserActionRequest,
} from "@unemployed/contracts";
import { onlySavedAnswersWereAdded } from "./workspace-application-methods";
import { findManualAnswerStepsCoveredBy } from "./workspace-user-action-methods";

function request(
  id: string,
  runId: string,
  resultId: string,
): UserActionRequest {
  return {
    id,
    kind: "manual_answer",
    state: "pending",
    revision: 1,
    scope: {
      type: "application",
      runId,
      jobId: `job_${resultId}`,
      resultId,
      applicationRecordId: `record_${resultId}`,
      source: "target_site",
    },
  } as unknown as UserActionRequest;
}

function fakeRepository(input: {
  requests: UserActionRequest[];
  questions: Record<
    string,
    { id: string; prompt: string; isRequired?: boolean; status?: string }[]
  >;
  userAnswered?: Record<string, string[]>;
}) {
  return {
    listUserActionRequests: () => Promise.resolve(input.requests),
    listApplicationQuestionRecords: (scope: { resultId: string }) =>
      Promise.resolve(
        (input.questions[scope.resultId] ?? []).map((question) => ({
          status: "detected",
          isRequired: true,
          ...question,
        })),
      ),
    listApplicationAnswerRecords: (scope: { resultId: string }) =>
      Promise.resolve(
        (input.userAnswered?.[scope.resultId] ?? []).map((questionId) => ({
          questionId,
          sourceKind: "user",
        })),
      ),
  };
}

const authorization = "Are you legally authorized to work in Germany?";

describe("one answer covers the same question across a batch", () => {
  it("answers the other applications of the batch that wait on the same question", async () => {
    const answered = request("a", "run_1", "r_a");
    const sameBatch = request("b", "run_1", "r_b");
    const otherQuestion = request("c", "run_1", "r_c");
    const otherBatch = request("d", "run_2", "r_d");
    const repository = fakeRepository({
      requests: [answered, sameBatch, otherQuestion, otherBatch],
      questions: {
        r_b: [{ id: "q_b", prompt: `  ${authorization.toUpperCase()} ` }],
        r_c: [
          { id: "q_c1", prompt: authorization },
          { id: "q_c2", prompt: "Why do you want this job?" },
        ],
        r_d: [{ id: "q_d", prompt: authorization }],
      },
    });

    const covered = await findManualAnswerStepsCoveredBy({
      ctx: { repository } as never,
      answered: [{ prompt: authorization, answer: "Yes" }],
      request: answered,
      savedForFuture: false,
    });

    // A step with another required question still waits on the person, and
    // a one-off answer stays inside its own batch.
    expect(covered.map((entry) => entry.request.id)).toEqual(["b"]);
    expect(covered[0]?.answers).toEqual([{ questionId: "q_b", answer: "Yes" }]);
  });

  it("reaches other batches once the answer is saved for next time", async () => {
    const answered = request("a", "run_1", "r_a");
    const otherBatch = request("d", "run_2", "r_d");
    const repository = fakeRepository({
      requests: [answered, otherBatch],
      questions: {
        r_d: [
          { id: "q_d", prompt: authorization },
          { id: "q_opt", prompt: "Pronouns", isRequired: false },
          { id: "q_done", prompt: "Phone" },
        ],
      },
      userAnswered: { r_d: ["q_done"] },
    });

    const covered = await findManualAnswerStepsCoveredBy({
      ctx: { repository } as never,
      answered: [{ prompt: authorization, answer: "Yes" }],
      request: answered,
      savedForFuture: true,
    });

    expect(covered).toHaveLength(1);
    expect(covered[0]?.answers).toEqual([{ questionId: "q_d", answer: "Yes" }]);
  });
});

describe("a step asked after the answer was saved", () => {
  it("is covered by the saved answer in any batch", async () => {
    const late = request("late", "run_9", "r_late");
    const repository = fakeRepository({
      requests: [late],
      questions: { r_late: [{ id: "q_late", prompt: authorization }] },
    });

    const covered = await findManualAnswerStepsCoveredBy({
      ctx: { repository } as never,
      answered: [{ prompt: authorization, answer: "Yes" }],
      request: null,
      savedForFuture: true,
      states: ["pending"],
    });

    expect(covered.map((entry) => entry.request.id)).toEqual(["late"]);
  });
});

describe("an answer saved while a batch runs", () => {
  const profile = {
    fullName: "Jamie Rivers",
    answerBank: {
      workAuthorization: null,
      customAnswers: [{ id: "a1", question: "Phone?", answer: "+49" }],
    },
  } as unknown as CandidateProfile;

  it("does not count as a profile change for the application being filled in", () => {
    const after = {
      ...profile,
      answerBank: {
        ...profile.answerBank,
        customAnswers: [
          ...profile.answerBank.customAnswers,
          { id: "a2", question: "Authorized?", answer: "Yes" },
        ],
      },
    } as unknown as CandidateProfile;
    expect(onlySavedAnswersWereAdded(profile, after)).toBe(true);
  });

  it("still counts any other edit", () => {
    expect(
      onlySavedAnswersWereAdded(profile, {
        ...profile,
        fullName: "Someone Else",
      } as CandidateProfile),
    ).toBe(false);
    expect(
      onlySavedAnswersWereAdded(profile, {
        ...profile,
        answerBank: { ...profile.answerBank, customAnswers: [] },
      } as unknown as CandidateProfile),
    ).toBe(false);
  });
});
