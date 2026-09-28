import type {
  ApplicationAnswerRecord,
  ApplicationQuestionRecord,
  CandidateProfile,
} from "@nordri/contracts";
import { createReusableAnswerForQuestion } from "./workspace-answer-memory";

function compareAnswerRecency(
  left: ApplicationAnswerRecord,
  right: ApplicationAnswerRecord,
): number {
  return (
    right.revision - left.revision ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function isExecutableUserAnswer(
  answer: ApplicationAnswerRecord | undefined,
): answer is ApplicationAnswerRecord {
  return (
    answer?.sourceKind === "user" &&
    (answer.status === "suggested" || answer.status === "filled") &&
    answer.value?.type !== "asset_ref" &&
    answer.text.trim().length > 0
  );
}

export function mergeApplicationAnswersIntoExecutionProfile(input: {
  profile: CandidateProfile;
  questionRecords: readonly ApplicationQuestionRecord[];
  answerRecords: readonly ApplicationAnswerRecord[];
  idPrefix: string;
}): CandidateProfile {
  const answerById = new Map(
    input.answerRecords.map((answer) => [answer.id, answer] as const),
  );
  const answersByQuestionId = new Map<string, ApplicationAnswerRecord[]>();
  for (const answer of input.answerRecords) {
    const current = answersByQuestionId.get(answer.questionId) ?? [];
    current.push(answer);
    answersByQuestionId.set(answer.questionId, current);
  }

  const applicationAnswers = input.questionRecords.flatMap((question) => {
    const selected = question.selectedAnswerId
      ? answerById.get(question.selectedAnswerId)
      : undefined;
    const latest =
      selected ??
      [...(answersByQuestionId.get(question.id) ?? [])].sort(
        compareAnswerRecency,
      )[0];
    if (!isExecutableUserAnswer(latest)) {
      return [];
    }

    return [
      createReusableAnswerForQuestion({
        answer: latest.text,
        prompt: question.prompt,
        kind: question.kind,
        idPrefix: input.idPrefix,
      }),
    ];
  });
  if (applicationAnswers.length === 0) {
    return input.profile;
  }

  return {
    ...input.profile,
    answerBank: {
      ...input.profile.answerBank,
      customAnswers: [
        ...applicationAnswers,
        ...input.profile.answerBank.customAnswers,
      ],
    },
  };
}
