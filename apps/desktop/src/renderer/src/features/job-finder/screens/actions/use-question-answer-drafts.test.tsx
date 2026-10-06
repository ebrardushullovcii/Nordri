// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { UserActionRequestSchema } from "@nordri/contracts";
import { expect, test, vi } from "vitest";
import { useQuestionAnswerDrafts } from "./use-question-answer-drafts";

test("restores a durable draft on either screen without treating it as submitted", async () => {
  const saveUserActionAnswerDraft = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "nordri", {
    configurable: true,
    value: { jobFinder: { saveUserActionAnswerDraft } },
  });
  const request = UserActionRequestSchema.parse({
    id: "request",
    dedupeKey: "dates",
    kind: "manual_answer",
    state: "awaiting_user",
    revision: 1,
    title: "Two dates",
    summary: "Enter both dates",
    scope: {
      type: "application",
      source: "target_site",
      runId: "run",
      jobId: "job",
      resultId: "result",
      applicationRecordId: "app",
    },
    verification: { type: "page_blocker_absent", blockerFingerprint: "dates" },
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    answerDraft: {
      answers: { Start: "2026-11-02", Interview: "" },
      saveForFuture: false,
    },
  });
  const first = renderHook(() =>
    useQuestionAnswerDrafts({ requests: [request] }),
  );
  expect(first.result.current.answerDrafts.current.get(request.id)).toEqual(
    request.answerDraft,
  );
  const edited = {
    answers: { Start: "2026-11-03", Interview: "" },
    saveForFuture: false,
  };
  await act(() => first.result.current.updateAnswerDraft(request, edited));
  expect(saveUserActionAnswerDraft).toHaveBeenCalledWith({
    requestId: request.id,
    expectedRevision: 1,
    draft: edited,
  });
  first.unmount();
  const second = renderHook(() =>
    useQuestionAnswerDrafts({
      requests: [{ ...request, answerDraft: edited }],
    }),
  );
  expect(second.result.current.answerDrafts.current.get(request.id)).toEqual(
    edited,
  );
  expect(saveUserActionAnswerDraft).toHaveBeenCalledTimes(1);
});
