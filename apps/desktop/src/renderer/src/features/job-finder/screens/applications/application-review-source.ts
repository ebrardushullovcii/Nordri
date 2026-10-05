import type { ApplicationReviewCard, ApplyRunDetails } from "@nordri/contracts";

export function withPersonAnswerSources(
  card: ApplicationReviewCard,
  details: ApplyRunDetails,
): ApplicationReviewCard {
  return {
    ...card,
    answers: card.answers.map((answer) => {
      if (answer.source !== "the filled application form") return answer;
      const question = details.questionRecords.find(
        (entry) => entry.prompt === answer.question,
      );
      const recorded = details.answerRecords
        .filter(
          (entry) =>
            entry.questionId === question?.id &&
            entry.sourceKind === "user" &&
            entry.status !== "rejected" &&
            entry.status !== "skipped",
        )
        .sort(
          (a, b) =>
            b.revision - a.revision || b.createdAt.localeCompare(a.createdAt),
        )[0];
      if (!recorded) return answer;
      const same =
        recorded.text === answer.answer ||
        (question?.answerControlType === "multi_choice" &&
          recorded.text
            .split(/[\n,;]+/u)
            .map((part) => part.trim())
            .filter(Boolean)
            .sort()
            .join("\n") ===
            answer.answer
              .split(/[\n,;]+/u)
              .map((part) => part.trim())
              .filter(Boolean)
              .sort()
              .join("\n"));
      return same
        ? { ...answer, source: "your answer to this question" }
        : answer;
    }),
  };
}
