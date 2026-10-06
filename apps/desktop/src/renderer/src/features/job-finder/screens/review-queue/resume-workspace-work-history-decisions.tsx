import type {
  JobFinderSetWorkHistoryReviewAcknowledgmentInput,
  ResumeDraft,
  ResumeCoverageRoleComparison,
  WorkHistoryReviewAcknowledgment,
  WorkHistoryReviewSuggestion,
} from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";
import { StatusBadge } from "../../components/status-badge";

import { describeReviewRole } from "./resume-review-context";

type DraftAcknowledgments = ResumeDraft["workHistoryReviewAcknowledgments"];

export type ResumeWorkHistoryDecisionRequest =
  | {
      intent: "acknowledge";
      suggestion: Pick<
        WorkHistoryReviewSuggestion,
        "id" | "profileRecordId" | "kind" | "action" | "messageContentHash"
      >;
    }
  | {
      intent: "remove";
      acknowledgmentId: string;
    };

const omissionKindLabels = {
  weak_fit: "Weak fit",
  gap_coverage: "Gap coverage",
} as const;

export function isWorkHistoryOmissionDecisionSuggestion<
  T extends Pick<WorkHistoryReviewSuggestion, "kind" | "action">,
>(
  suggestion: T,
): suggestion is T & {
  kind: "weak_fit" | "gap_coverage";
  action: "consider_showing";
} {
  return (
    (suggestion.kind === "weak_fit" || suggestion.kind === "gap_coverage") &&
    suggestion.action === "consider_showing"
  );
}

export function matchWorkHistoryOmissionDecisionAcknowledgment(input: {
  draftId: string;
  suggestion: WorkHistoryReviewSuggestion;
  acknowledgments: DraftAcknowledgments;
}): WorkHistoryReviewAcknowledgment | null {
  return (
    input.acknowledgments.find(
      (acknowledgment) =>
        acknowledgment.draftId === input.draftId &&
        acknowledgment.profileRecordId === input.suggestion.profileRecordId &&
        acknowledgment.kind === input.suggestion.kind &&
        acknowledgment.action === input.suggestion.action &&
        acknowledgment.messageContentHash ===
          input.suggestion.messageContentHash,
    ) ?? null
  );
}

export function listUnresolvedWorkHistoryOmissionSuggestions(input: {
  draftId: string;
  suggestions: readonly WorkHistoryReviewSuggestion[];
  acknowledgments: DraftAcknowledgments;
}): WorkHistoryReviewSuggestion[] {
  return input.suggestions.filter(
    (suggestion) =>
      isWorkHistoryOmissionDecisionSuggestion(suggestion) &&
      !matchWorkHistoryOmissionDecisionAcknowledgment({
        draftId: input.draftId,
        suggestion,
        acknowledgments: input.acknowledgments,
      }),
  );
}

export function buildWorkHistoryReviewAcknowledgmentCommandInput(input: {
  jobId: string;
  draft: Pick<ResumeDraft, "id" | "updatedAt"> & {
    workHistoryReviewAcknowledgments: DraftAcknowledgments;
  };
  suggestions: readonly WorkHistoryReviewSuggestion[];
  decision: ResumeWorkHistoryDecisionRequest;
}): JobFinderSetWorkHistoryReviewAcknowledgmentInput | null {
  const { decision } = input;

  if (decision.intent === "remove") {
    const acknowledgmentId = decision.acknowledgmentId;
    const acknowledgment = input.draft.workHistoryReviewAcknowledgments.find(
      (candidate) => candidate.id === acknowledgmentId,
    );

    if (!acknowledgment || acknowledgment.draftId !== input.draft.id) {
      return null;
    }

    return {
      intent: "remove",
      jobId: input.jobId,
      draftId: input.draft.id,
      expectedDraftUpdatedAt: input.draft.updatedAt,
      acknowledgmentId: acknowledgment.id,
    };
  }

  const captured = decision.suggestion;
  const suggestion = input.suggestions.find(
    (candidate) => candidate.id === captured.id,
  );

  if (!suggestion || !isWorkHistoryOmissionDecisionSuggestion(suggestion)) {
    return null;
  }

  const stillProjected =
    suggestion.profileRecordId === captured.profileRecordId &&
    suggestion.kind === captured.kind &&
    suggestion.action === captured.action &&
    suggestion.messageContentHash === captured.messageContentHash;

  if (!stillProjected) {
    return null;
  }

  return {
    intent: "acknowledge",
    jobId: input.jobId,
    draftId: input.draft.id,
    expectedDraftUpdatedAt: input.draft.updatedAt,
    suggestionId: suggestion.id,
    profileRecordId: suggestion.profileRecordId,
    kind: suggestion.kind,
    action: suggestion.action,
    messageContentHash: suggestion.messageContentHash,
    reason: "intentional_omission",
  };
}

interface ResumeWorkHistoryDecisionsProps {
  sections?: ResumeDraft["sections"];
  roles?: readonly ResumeCoverageRoleComparison[];
  acknowledgments: DraftAcknowledgments;
  disabled: boolean;
  draftId: string;
  suggestions: readonly WorkHistoryReviewSuggestion[];
  onAcknowledge: (suggestion: WorkHistoryReviewSuggestion) => void;
  /**
   * Puts the role back on the resume. Undoing a leave-off used to return the
   * role to "needs a choice", which blocked approval again: the person had
   * decided, and the only way to act on it was to find the entry in the
   * editor. Both choices now sit on the row.
   */
  onIncludeRole?: (suggestion: WorkHistoryReviewSuggestion) => void;
  onRemoveAcknowledgment: (acknowledgmentId: string) => void;
}

export function ResumeWorkHistoryDecisions(
  props: ResumeWorkHistoryDecisionsProps,
) {
  const decisions = props.suggestions.filter(
    isWorkHistoryOmissionDecisionSuggestion,
  );

  if (decisions.length === 0) {
    return null;
  }

  const resolved = decisions.map((suggestion) => ({
    suggestion,
    context: describeReviewRole(
      suggestion,
      props.sections ?? [],
      props.roles ?? [],
    ),
    acknowledgment: matchWorkHistoryOmissionDecisionAcknowledgment({
      draftId: props.draftId,
      suggestion,
      acknowledgments: props.acknowledgments,
    }),
  }));
  const unresolvedCount = resolved.filter(
    (decision) => !decision.acknowledgment,
  ).length;

  return (
    <section
      aria-labelledby="resume-work-history-decisions-heading"
      // Amber only while a decision is still open; once every hidden role is
      // decided it is a plain record (ADR 0042).
      className={
        unresolvedCount > 0
          ? "grid min-w-0 grid-cols-1 gap-2 rounded-(--radius-field) border border-(--warning-border) bg-(--warning-surface) p-2.5 text-(length:--text-small) leading-5 text-(--warning-text)"
          : "grid min-w-0 grid-cols-1 gap-2 rounded-(--radius-field) border border-(--surface-panel-border) p-2.5 text-(length:--text-small) leading-5 text-foreground"
      }
      data-resume-work-history-decisions
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className="font-display text-(--text-headline)"
          id="resume-work-history-decisions-heading"
        >
          Work-history decisions
        </h3>
        <StatusBadge tone={unresolvedCount > 0 ? "critical" : "positive"}>
          {unresolvedCount > 0 ? `${unresolvedCount} hidden` : "All left off"}
        </StatusBadge>
      </div>
      <p aria-live="polite" role="status">
        {unresolvedCount > 0
          ? `${unresolvedCount} of ${decisions.length} hidden roles ${unresolvedCount === 1 ? "is" : "are"} off this resume. Add any back if you want it included; nothing here blocks approval.`
          : "You chose to leave every listed hidden role off this resume."}
      </p>
      <ul className="grid min-w-0 grid-cols-1 gap-2">
        {resolved.map(({ suggestion, context, acknowledgment }) => (
          <li
            className="grid min-w-0 grid-cols-1 gap-1.5 rounded-(--radius-field) border border-(--surface-panel-border) bg-background/60 px-2.5 py-2"
            key={suggestion.id}
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div
                className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                id={`review-role-${suggestion.id}`}
              >
                <p className="font-medium text-(--text-headline)">
                  {context.title}
                </p>
                {context.detail ? (
                  <p className="text-xs text-foreground-soft">
                    {context.detail}
                  </p>
                ) : null}
              </div>
              <StatusBadge tone={acknowledgment ? "positive" : "neutral"}>
                {acknowledgment ? "Left off" : "Hidden"}
              </StatusBadge>
            </div>
            <p className="min-w-0 [overflow-wrap:anywhere]">
              {suggestion.message}
            </p>
            <div className="flex flex-wrap gap-2">
              {props.onIncludeRole ? (
                <Button
                  aria-label={`Add this role back · ${omissionKindLabels[suggestion.kind]}: ${suggestion.message}`}
                  aria-describedby={`review-role-${suggestion.id}`}
                  data-resume-work-history-include
                  disabled={props.disabled}
                  onClick={() => props.onIncludeRole?.(suggestion)}
                  pending={props.disabled}
                  size="compact"
                  type="button"
                  variant={acknowledgment ? "secondary" : "primary"}
                >
                  Add this role back
                </Button>
              ) : null}
              <Button
                aria-label={`${acknowledgment ? "Undo leave-off" : "Leave this role off"} · ${omissionKindLabels[suggestion.kind]}: ${suggestion.message}`}
                aria-describedby={`review-role-${suggestion.id}`}
                aria-pressed={Boolean(acknowledgment)}
                disabled={props.disabled}
                onClick={() =>
                  acknowledgment
                    ? props.onRemoveAcknowledgment(acknowledgment.id)
                    : props.onAcknowledge(suggestion)
                }
                pending={props.disabled}
                size="compact"
                type="button"
                variant={
                  acknowledgment || props.onIncludeRole
                    ? "secondary"
                    : "primary"
                }
              >
                {acknowledgment ? "Undo leave-off" : "Leave this role off"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
