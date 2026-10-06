import type { ApplicationReviewCard, ApplyRunDetails } from "@nordri/contracts";

function selectedOptions(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    )
      return [...parsed].sort();
  } catch {
    /* Older answers used separators. */
  }
  return value
    .split(/[\n,;]+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
}

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
          JSON.stringify(selectedOptions(recorded.text)) ===
            JSON.stringify(selectedOptions(answer.answer)));
      const savedSource =
        recorded.sourceId?.startsWith("answerLibrary.") &&
        !recorded.sourceId.startsWith("answerLibrary.application_");
      const source = savedSource
        ? (recorded.provenance.find(
            (entry) => entry.sourceId === recorded.sourceId,
          )?.label ?? "your saved answer")
        : "your answer to this question";
      return same ? { ...answer, source } : answer;
    }),
  };
}
