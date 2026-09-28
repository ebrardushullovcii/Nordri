import type {
  ApplicationAttemptQuestion,
  UserActionCommandInput,
  UserActionRequest,
} from "@nordri/contracts";
import { QuestionAnswerForm, createCommand } from "../actions/actions-screen";

/**
 * The question step an application is waiting on, answerable right where the
 * application is shown. Needs you lists the same step; answering in either
 * place moves the same request on, so a person never has to leave the
 * application to find the box.
 */
export interface ApplicationAnswerStep {
  request: UserActionRequest;
  questions: readonly ApplicationAttemptQuestion[];
  isPending: boolean;
  onCommand: (command: UserActionCommandInput) => void | Promise<void>;
}

export function ApplicationAnswerStepCard(props: {
  step: ApplicationAnswerStep;
}) {
  const { request, questions, isPending, onCommand } = props.step;
  if (request.state === "verifying") {
    return (
      <p
        aria-live="polite"
        className="text-(length:--text-small) leading-6 text-foreground-soft"
        data-testid="application-answer-step-status"
        role="status"
      >
        Answered. Job Finder is putting your answers in and carrying on.
      </p>
    );
  }
  return (
    <div className="grid min-w-0 gap-2" data-testid="application-answer-step">
      <p className="text-(length:--text-small) leading-6 text-foreground">
        Answer here and Job Finder will continue.
      </p>
      <QuestionAnswerForm
        isPending={isPending}
        onAnswer={async (answers, saveForFuture) => {
          const first = answers[0];
          if (!first) return;
          await onCommand({
            ...createCommand(request, "confirm_done"),
            action: "submit_manual_answer",
            answer: first.answer,
            ...(answers.length > 1 || questions.length > 1
              ? { answers: answers.map((entry) => ({ ...entry })) }
              : {}),
            saveForFuture,
          });
        }}
        questions={questions}
        requestId={request.id}
      />
    </div>
  );
}
