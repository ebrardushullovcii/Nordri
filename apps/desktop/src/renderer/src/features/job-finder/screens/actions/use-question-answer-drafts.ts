import { useEffect, useRef, useState } from "react";
import type {
  ApplicationAttempt,
  ApplyRunDetails,
  JobFinderApplyRunDetailsQuery,
  UserActionRequest,
} from "@nordri/contracts";
import { listPendingApplicationQuestions } from "../applications/applications-status";
import type { QuestionAnswerDraft } from "./actions-screen";

export function useQuestionAnswerDrafts(props: {
  applicationAttempts?: readonly ApplicationAttempt[];
  requests: readonly UserActionRequest[];
  onGetApplyRunDetails?: (
    query: JobFinderApplyRunDetailsQuery,
  ) => Promise<ApplyRunDetails>;
}) {
  // Drafts survive the question form temporarily disappearing during a
  // browser check. They stay local to this screen and exact application.
  const answerDrafts = useRef(new Map<string, QuestionAnswerDraft>());
  const restoredDrafts = useRef(new Set<string>());
  const [restoredApplications, setRestoredApplications] = useState<
    ReadonlySet<string>
  >(new Set());
  useEffect(() => {
    if (!props.onGetApplyRunDetails) return;
    let cancelled = false;
    const started: string[] = [];
    for (const request of props.requests) {
      if (
        !["pending", "awaiting_user", "still_blocked"].includes(
          request.state,
        ) ||
        request.kind !== "manual_answer" ||
        request.scope.type !== "application" ||
        !request.scope.applicationRecordId ||
        restoredDrafts.current.has(request.id)
      )
        continue;
      const applicationRecordId = request.scope.applicationRecordId;
      const existing = answerDrafts.current.get(applicationRecordId);
      if (
        existing &&
        (Object.keys(existing.answers).length > 0 || !existing.saveForFuture)
      )
        continue;
      const previous = [...props.requests]
        .filter(
          (entry) =>
            entry.id !== request.id &&
            entry.kind === "manual_answer" &&
            entry.scope.type === "application" &&
            entry.scope.applicationRecordId === applicationRecordId &&
            entry.updatedAt <= request.updatedAt,
        )
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        )[0];
      if (!previous || previous.scope.type !== "application") continue;
      restoredDrafts.current.add(request.id);
      started.push(request.id);
      void props
        .onGetApplyRunDetails({
          runId: previous.scope.runId,
          jobId: previous.scope.jobId,
          applicationRecordId,
        })
        .then((details) => {
          if (cancelled) return;
          const edited = answerDrafts.current.get(applicationRecordId);
          if (
            edited &&
            (Object.keys(edited.answers).length > 0 || !edited.saveForFuture)
          )
            return;
          const records = [...details.answerRecords]
            .filter(
              (answer) =>
                answer.applicationRecordId === applicationRecordId &&
                answer.sourceKind === "user",
            )
            .sort(
              (left, right) =>
                right.revision - left.revision ||
                right.createdAt.localeCompare(left.createdAt),
            );
          const questions = listPendingApplicationQuestions({
            applicationAttempts: props.applicationAttempts ?? [],
            applicationRecordId,
            jobId:
              previous.scope.type === "application" ? previous.scope.jobId : "",
          });
          const answers: QuestionAnswerDraft["answers"] = {};
          for (const question of questions) {
            const answer = records.find(
              (entry) =>
                entry.questionId === question.id ||
                entry.questionId ===
                  `apply_question_${applicationRecordId}_${question.id}`,
            );
            if (!answer) continue;
            let value: string | string[] = answer.text;
            if (question.answerControlType === "multi_choice") {
              try {
                const parsed: unknown = JSON.parse(answer.text);
                if (
                  Array.isArray(parsed) &&
                  parsed.every((entry) => typeof entry === "string")
                )
                  value = parsed;
              } catch {
                /* Keep a legacy text answer available for review. */
              }
            }
            const key =
              questions.filter((entry) => entry.prompt === question.prompt)
                .length > 1
                ? question.id
                : question.prompt;
            answers[key] = value;
          }
          if (!Object.keys(answers).length) return;
          answerDrafts.current.set(applicationRecordId, {
            answers,
            saveForFuture: records[0]?.saveScope === "reusable_profile",
          });
          setRestoredApplications(
            (current) => new Set([...current, applicationRecordId]),
          );
        })
        .catch(() => {
          /* A failed read leaves the current editable form intact. */
        });
    }
    return () => {
      cancelled = true;
      for (const requestId of started) restoredDrafts.current.delete(requestId);
    };
  }, [props.onGetApplyRunDetails, props.requests, props.applicationAttempts]);
  return { answerDrafts, restoredApplications };
}
