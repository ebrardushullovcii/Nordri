import { useState } from "react";
import type { ApplicationReviewCard } from "@unemployed/contracts";
import { Button } from "@renderer/components/ui/button";
import { ExternalUrlLink } from "../../components/open-outside-links";
import {
  TECHNICAL_DETAILS_LABEL,
  describeFailure,
  type FailureDescription,
} from "../../lib/describe-failure";

/**
 * What Job Finder wrote, before you send it.
 *
 * This is the whole point of choosing "ask me before sending": a person should
 * be able to read every answer that is about to go out, see where each one came
 * from, and read the letter in full. A review that hides the generated answers
 * is not a review, so nothing here is collapsed by default.
 *
 * The card is what the run that filled the form in actually recorded, so the
 * wording under each answer is the run's own phrase for where it came from.
 */

export interface ApplicationsReviewCardProps {
  card: ApplicationReviewCard;
  /**
   * True when the browser no longer holds the page this was filled in on.
   * Sending is impossible until it is prepared again.
   */
  pageClosed?: boolean | undefined;
  onSubmit: () => Promise<void>;
  onPrepareAgain?: (() => Promise<void>) | undefined;
  isSubmitPending?: boolean | undefined;
}

export function ApplicationsReviewCard({
  card,
  pageClosed,
  onSubmit,
  onPrepareAgain,
  isSubmitPending,
}: ApplicationsReviewCardProps) {
  const [failure, setFailure] = useState<FailureDescription | null>(null);
  const [pending, setPending] = useState(false);
  const busy = pending || isSubmitPending === true;
  const readyToSend = card.waitingOnYou.length === 0 && pageClosed !== true;

  const run = async (
    action: (() => Promise<void>) | undefined,
    describeAs: string,
  ) => {
    if (!action || busy) {
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await action();
    } catch (cause) {
      setFailure(describeFailure(cause, { action: describeAs }));
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="Review before sending"
      className="surface-panel-shell grid min-w-0 gap-3 rounded-(--radius-field) border border-(--surface-panel-border) px-4 py-4"
    >
      <div className="grid gap-1">
        <h3 className="font-semibold text-(--text-headline)">
          Read this before you send it
        </h3>
        <p className="text-(length:--text-description) leading-5 text-foreground-soft">
          Job Finder filled this in on {card.siteLabel}. Nothing has been sent
          yet. Everything it wrote is below, with where each answer came from.
        </p>
        {card.pageUrl ? (
          <p className="break-all text-(length:--text-small) leading-5 text-foreground-soft">
            Page: <ExternalUrlLink url={card.pageUrl} />
          </p>
        ) : null}
      </div>

      {pageClosed ? (
        <div
          className="grid gap-2 rounded-(--radius-field) border border-warning/40 bg-warning/8 px-3.5 py-3"
          role="status"
        >
          <p className="text-(length:--text-small) leading-6 text-foreground">
            The application page was closed before you reviewed it. Prepare it
            again to continue.
          </p>
          {onPrepareAgain ? (
            <div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(onPrepareAgain, "prepare this application again")
                }
                pending={busy}
                type="button"
                variant="secondary"
              >
                Prepare again
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {card.answers.length > 0 ? (
        <div className="grid gap-2">
          <p className="label-mono-xs">Answers going out</p>
          {card.answers.map((answer) => (
            <div
              className="rounded-(--radius-field) border border-(--surface-panel-border) bg-background/40 px-3 py-3"
              key={`${answer.question}:${answer.answer}`}
            >
              <strong className="text-foreground">{answer.question}</strong>
              <p className="mt-1 whitespace-pre-wrap text-(length:--text-small) leading-6 text-foreground">
                {answer.answer}
              </p>
              <p className="mt-1 text-(length:--text-small) leading-6 text-foreground-soft">
                {answer.written ? "Written for this application" : "From"}{" "}
                {answer.source}
                {answer.written && answer.groundedIn.length > 0
                  ? `, based on ${answer.groundedIn.join(", ")}`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {card.letter ? (
        <div className="grid gap-2">
          <p className="label-mono-xs">The letter going with it</p>
          <p className="whitespace-pre-wrap rounded-(--radius-field) border border-(--surface-panel-border) bg-background/40 px-3 py-3 text-(length:--text-small) leading-6 text-foreground">
            {card.letter.text}
          </p>
          {card.letter.groundedIn.length > 0 ? (
            <p className="text-(length:--text-small) leading-6 text-foreground-soft">
              Written from {card.letter.groundedIn.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {card.attachments.length > 0 ? (
        <div className="grid gap-2">
          <p className="label-mono-xs">Files attached</p>
          <ul className="grid gap-1">
            {card.attachments.map((attachment) => (
              <li
                className="text-(length:--text-small) leading-6 text-foreground-soft"
                key={attachment.fileName}
              >
                {attachment.label} — {attachment.fileName} ({attachment.field})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.waitingOnYou.length > 0 ? (
        <div
          className="grid gap-1 rounded-(--radius-field) border border-warning/40 bg-warning/8 px-3.5 py-3"
          role="status"
        >
          <p className="font-semibold text-foreground">
            Waiting on you before this can be sent
          </p>
          {card.waitingOnYou.map((item) => (
            <p
              className="text-(length:--text-small) leading-6 text-foreground-soft"
              key={item}
            >
              {item}
            </p>
          ))}
        </div>
      ) : null}

      {failure ? (
        <div className="grid gap-1" role="alert">
          <p className="text-(length:--text-small) leading-6 text-destructive">
            {failure.userMessage} Nothing on the site was changed.
          </p>
          {failure.technicalDetails ? (
            <details className="text-(length:--text-small) leading-6 text-foreground-soft">
              <summary>{TECHNICAL_DETAILS_LABEL}</summary>
              <p className="mt-1 break-all">{failure.technicalDetails}</p>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!readyToSend || busy}
          onClick={() => void run(onSubmit, "send this application")}
          pending={busy}
          type="button"
          variant="primary"
        >
          Submit application
        </Button>
        <p className="text-(length:--text-small) leading-5 text-foreground-soft">
          {pageClosed
            ? "Prepare it again before it can be sent."
            : readyToSend
              ? "This sends it to the employer once. Job Finder never sends it twice."
              : "Answer what is waiting on you above first."}
        </p>
      </div>
    </section>
  );
}
