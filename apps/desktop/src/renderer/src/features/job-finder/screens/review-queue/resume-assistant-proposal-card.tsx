import { useState } from "react";
import type {
  ResumeAssistantMessage,
  ResumeDraft,
  ResumeDraftPatch,
  ResumeProposalApprovalBlocker,
  ResumeValidationResult,
} from "@unemployed/contracts";
import { Button } from "@renderer/components/ui/button";
import {
  diffProposalWording,
  shouldRenderProposalDiff,
} from "./resume-assistant-proposal-diff";
import {
  findProposalPatchTarget,
  getProposalPatchEditorTargetId,
  resolveProposalProvenance,
} from "./resume-assistant-proposal-provenance";
import type { ProposalProvenance } from "./resume-assistant-proposal-provenance";
import {
  evaluateResumeProposalPatchVerdict,
  evaluateResumeProposalVerdict,
  isLinesToConfirmBlocker,
  PROPOSAL_GROUNDING_HEADING,
  type ResumeProposalPatchVerdict,
  type ResumeProposalVerdictTone,
} from "./resume-proposal-verdict";
import { SourceRefsList } from "./source-refs-list";

function readCurrentValue(draft: ResumeDraft, patch: ResumeDraftPatch): string {
  const target = findProposalPatchTarget(draft, patch);
  const section = target.section;
  const entry = target.entry;
  const bullet = target.bullet;

  switch (patch.operation) {
    case "replace_section_text":
      return section?.text ?? "Empty section";
    case "replace_entry_summary":
      return entry?.summary ?? "Empty summary";
    case "insert_bullet":
      return "No bullet";
    case "update_bullet":
    case "remove_bullet":
      return bullet?.text ?? "Bullet is no longer available";
    case "toggle_include":
      return `${(bullet?.included ?? entry?.included ?? section?.included ?? false) ? "Included" : "Excluded"}`;
    case "set_lock":
      return `${(bullet?.locked ?? entry?.locked ?? section?.locked ?? false) ? "Locked" : "Unlocked"}`;
    case "replace_section_bullets":
      return (entry?.bullets ?? section?.bullets ?? [])
        .map((candidate) => candidate.text)
        .join("\n");
    case "move_bullet":
    case "move_entry":
    case "reset_entry_order":
      return "Current order";
  }
}

function readProposedValue(patch: ResumeDraftPatch): string {
  switch (patch.operation) {
    case "replace_section_text":
    case "replace_entry_summary":
    case "insert_bullet":
    case "update_bullet":
      return patch.newText ?? "No replacement text";
    case "remove_bullet":
      return "Remove this bullet";
    case "toggle_include":
      return patch.newIncluded ? "Included" : "Excluded";
    case "set_lock":
      return patch.newLocked ? "Locked" : "Unlocked";
    case "replace_section_bullets":
      return (patch.newBullets ?? []).map((bullet) => bullet.text).join("\n");
    case "move_bullet":
    case "move_entry":
      return `Move ${patch.position ?? "to the requested position"}`;
    case "reset_entry_order":
      return "Restore chronological order";
  }
}

function operationLabel(operation: ResumeDraftPatch["operation"]): string {
  return operation.replaceAll("_", " ");
}

/**
 * The proposal rendered on the wording it changes: removed words struck out,
 * added words highlighted, everything else left alone. Two opaque "Before" and
 * "After" paragraphs made the user re-read a whole bullet to find the handful
 * of words the assistant touched.
 */
function ProposalWordingDiff(props: { after: string; before: string }) {
  const parts = diffProposalWording(props.before, props.after);

  return (
    <span
      className="whitespace-pre-wrap break-words text-foreground"
      data-resume-proposal-diff
    >
      <span className="sr-only">
        Proposed wording, with removals and additions marked.
      </span>
      {parts.map((part, index) =>
        part.kind === "removed" ? (
          <del
            className="rounded-[3px] bg-destructive/15 text-foreground-soft decoration-destructive/70"
            key={`diff_${index}`}
          >
            {part.text}
          </del>
        ) : part.kind === "added" ? (
          <ins
            className="rounded-[3px] bg-(--success-surface) text-(--success-text) no-underline"
            key={`diff_${index}`}
          >
            {part.text}
          </ins>
        ) : (
          <span key={`diff_${index}`}>{part.text}</span>
        ),
      )}
    </span>
  );
}

const verdictToneClassNames: Record<ResumeProposalVerdictTone, string> = {
  blocked: "text-destructive",
  clear: "text-(--success-text)",
  confirm: "text-(--warning-text)",
  removal: "text-(--warning-text)",
};

/**
 * One verdict per proposed change, from one evaluation, with its reason always
 * attached. This used to be a collapsed `<details>` whose summary printed a
 * verdict word ("Why this edit is grounded" / "Why this edit would block
 * approval") with the body hidden behind a marker-less summary, so the panel
 * read as an orphaned uppercase label directly above Accept. It is now a plain
 * block: one heading, one outcome sentence, and the reasons behind it.
 */
function ProposalGroundingVerdict(props: {
  provenance: ProposalProvenance;
  verdict: ResumeProposalPatchVerdict;
}) {
  const provenance = props.provenance;

  return (
    <div
      className="grid min-w-0 gap-1.5 border-t border-(--surface-panel-border) pt-2"
      data-resume-proposal-grounding
      data-resume-proposal-grounding-tone={props.verdict.tone}
    >
      <p className="text-(length:--text-tiny) font-medium uppercase tracking-(--tracking-caps) text-muted-foreground">
        {PROPOSAL_GROUNDING_HEADING}
      </p>
      <p
        className={`text-xs font-medium leading-5 ${verdictToneClassNames[props.verdict.tone]}`}
        data-resume-proposal-grounding-outcome
      >
        {props.verdict.outcome}
      </p>
      <div className="grid min-w-0 gap-1 text-xs leading-5 text-foreground-soft">
        {props.verdict.reasons.map((reason, reasonIndex) => (
          <p key={`grounding_reason_${reasonIndex}`}>{reason}</p>
        ))}
        {provenance.targetFound && provenance.sourceRefs.length > 0 ? (
          <details className="min-w-0">
            <summary className="list-item cursor-pointer py-1 font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Supporting evidence ({provenance.sourceRefs.length})
            </summary>
            <SourceRefsList
              sourceRefs={provenance.sourceRefs}
              variant="compact"
            />
          </details>
        ) : null}
      </div>
    </div>
  );
}

function findPatchApprovalBlockers(
  message: ResumeAssistantMessage,
  patch: ResumeDraftPatch,
): ResumeProposalApprovalBlocker[] {
  return (message.approvalBlockers ?? []).filter(
    (blocker) =>
      blocker.patchId === patch.id ||
      (blocker.patchId === null &&
        blocker.sectionId === patch.targetSectionId &&
        (blocker.entryId ?? null) === (patch.targetEntryId ?? null) &&
        (blocker.bulletId ?? null) === (patch.targetBulletId ?? null)),
  );
}

export function ResumeAssistantProposalCard(props: {
  draft: ResumeDraft;
  isPending: boolean;
  message: ResumeAssistantMessage;
  /**
   * Opens the exact editor field a proposed change lands on. The blocked-state
   * copy says the wording has to be user-edited, so the panel offers that route
   * instead of only "reject" and an accept that the app has already said cannot
   * be approved.
   */
  onEditWording?: (targetId: string) => void;
  onResolve: (
    proposalId: string,
    action: "accept" | "reject",
    patchIds: readonly string[],
  ) => void;
  validation?: ResumeValidationResult | null;
}) {
  const [selectedPatchIds, setSelectedPatchIds] = useState<readonly string[]>(
    () => props.message.patches.map((patch) => patch.id),
  );
  const pending = props.message.proposalStatus === "pending";
  // Only wording the evidence does not back demotes Accept. A stretch that
  // goes to Lines to confirm is accepted like any other change and decided
  // there.
  const blockedSelectionCount = props.message.patches.filter(
    (patch) =>
      selectedPatchIds.includes(patch.id) &&
      findPatchApprovalBlockers(props.message, patch).some(
        (blocker) => !isLinesToConfirmBlocker(blocker),
      ),
  ).length;
  // One evaluation drives every grounding statement on this card: the
  // per-change verdicts, this summary, and the accept control's own wording.
  const proposalVerdict = evaluateResumeProposalVerdict({
    draft: props.draft,
    message: props.message,
    validation: props.validation ?? null,
  });
  const firstBlockedEditableTargetId =
    props.message.patches
      .filter((patch) =>
        findPatchApprovalBlockers(props.message, patch).some(
          (blocker) => !isLinesToConfirmBlocker(blocker),
        ),
      )
      .map(getProposalPatchEditorTargetId)
      .find((targetId): targetId is string => targetId !== null) ?? null;

  return (
    <section
      aria-label="Assistant proposal"
      className="mt-3 grid gap-3 rounded-(--radius-field) border border-primary/25 bg-background/70 p-3"
      data-resume-assistant-proposal={props.message.id}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-(--tracking-caps) text-primary">
          Proposed changes
        </p>
        <span className="text-xs capitalize text-muted-foreground">
          {props.message.proposalStatus}
        </span>
      </div>
      <div className="grid gap-3">
        {props.message.patches.map((patch, index) => {
          const selected = selectedPatchIds.includes(patch.id);
          const patchApprovalBlockers = findPatchApprovalBlockers(
            props.message,
            patch,
          );
          const provenance = resolveProposalProvenance({
            claimAssessments: props.validation?.claimAssessments ?? [],
            draft: props.draft,
            patch,
          });
          const currentValue = readCurrentValue(props.draft, patch);
          const proposedValue = readProposedValue(patch);
          const rendersDiff = shouldRenderProposalDiff(
            currentValue,
            proposedValue,
          );
          const comparison = (
            <>
              <span className="flex items-center gap-2 text-xs font-semibold capitalize text-foreground">
                {pending ? (
                  <input
                    aria-label={`Select proposed change ${index + 1}: ${operationLabel(patch.operation)}`}
                    checked={selected}
                    disabled={props.isPending}
                    onChange={() =>
                      setSelectedPatchIds((current) =>
                        current.includes(patch.id)
                          ? current.filter((id) => id !== patch.id)
                          : [...current, patch.id],
                      )
                    }
                    type="checkbox"
                  />
                ) : null}
                {operationLabel(patch.operation)}
                {/* "Accept selected (n)" counts these cards, so each one has
                    to say whether it is one of them. A bare checkbox in a row
                    of identical cards did not read as a per-card state. */}
                {pending ? (
                  <span
                    className={
                      selected
                        ? "ml-auto rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-(length:--text-tiny) font-semibold uppercase tracking-(--tracking-caps) text-primary"
                        : "ml-auto rounded-full border border-(--surface-panel-border) px-2 py-0.5 text-(length:--text-tiny) font-semibold uppercase tracking-(--tracking-caps) text-muted-foreground"
                    }
                    data-resume-proposal-patch-selected-label
                  >
                    {selected ? "Selected" : "Not selected"}
                  </span>
                ) : null}
                {!pending ? (
                  <span className="ml-auto text-muted-foreground">
                    {props.message.proposalStatus === "accepted"
                      ? props.message.resolvedPatchIds.includes(patch.id)
                        ? "Applied"
                        : "Not applied"
                      : "Rejected"}
                  </span>
                ) : null}
              </span>
              <span className="text-(length:--text-tiny) uppercase tracking-(--tracking-caps) text-muted-foreground">
                {provenance.targetLabel}
              </span>
              <span className="grid gap-1 text-xs leading-5">
                {rendersDiff ? (
                  <>
                    <span className="text-muted-foreground">
                      {pending ? "Proposed change" : "Proposed"}
                    </span>
                    <ProposalWordingDiff
                      after={proposedValue}
                      before={currentValue}
                    />
                  </>
                ) : (
                  <>
                    {pending ? (
                      <>
                        <span className="text-muted-foreground">Before</span>
                        <span className="whitespace-pre-wrap break-words text-foreground-soft">
                          {currentValue}
                        </span>
                        <span className="mt-1 text-muted-foreground">
                          After
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Proposed</span>
                    )}
                    <span className="whitespace-pre-wrap break-words text-foreground">
                      {proposedValue}
                    </span>
                  </>
                )}
              </span>
            </>
          );

          return (
            <div
              className={
                pending && selected
                  ? "grid gap-2 rounded-(--radius-field) border border-primary/50 bg-primary/5 p-3 ring-1 ring-primary/25"
                  : "grid gap-2 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-fill-soft) p-3"
              }
              data-resume-proposal-patch={patch.id}
              data-resume-proposal-patch-selected={
                pending && selected ? "true" : "false"
              }
              key={patch.id}
            >
              {pending ? (
                // The disclosure stays outside this label so toggling it never
                // flips the proposal selection checkbox.
                <label className="grid cursor-pointer gap-2">
                  {comparison}
                </label>
              ) : (
                <div className="grid gap-2">{comparison}</div>
              )}
              {patchApprovalBlockers.length > 0 ? (
                <div
                  className={
                    patchApprovalBlockers.every(isLinesToConfirmBlocker)
                      ? "grid gap-1 rounded-(--radius-field) border border-(--warning-border) bg-(--warning-surface) px-2.5 py-2 text-(length:--text-tiny) leading-4 text-(--text-headline)"
                      : "grid gap-1 rounded-(--radius-field) border border-destructive/45 bg-destructive/10 px-2.5 py-2 text-(length:--text-tiny) leading-4 text-(--text-headline)"
                  }
                  data-resume-proposal-approval-blocker={patch.id}
                  data-resume-proposal-approval-blocker-kind={
                    patchApprovalBlockers.every(isLinesToConfirmBlocker)
                      ? "needs_confirmation"
                      : "unsupported"
                  }
                >
                  <span
                    className={
                      patchApprovalBlockers.every(isLinesToConfirmBlocker)
                        ? "font-semibold uppercase tracking-(--tracking-caps) text-(--warning-text)"
                        : "font-semibold uppercase tracking-(--tracking-caps) text-destructive"
                    }
                  >
                    {patchApprovalBlockers.every(isLinesToConfirmBlocker)
                      ? "Goes to Lines to confirm"
                      : "Would block approval"}
                  </span>
                  {patchApprovalBlockers.map((blocker, blockerIndex) => (
                    <span
                      className="grid gap-0.5"
                      key={`${patch.id}_blocker_${blockerIndex}`}
                    >
                      <span>{blocker.message}</span>
                      {blocker.flaggedText ? (
                        <q className="text-foreground-soft">
                          {blocker.flaggedText}
                        </q>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
              <ProposalGroundingVerdict
                provenance={provenance}
                verdict={evaluateResumeProposalPatchVerdict({
                  blockers: patchApprovalBlockers,
                  patch,
                  provenance,
                })}
              />
            </div>
          );
        })}
      </div>
      {/* The set-level line earns its box when it says something the
          per-change verdicts above do not: a block, a blocker the resume
          already carries, or a roll-up across several changes. For one clean
          change it repeated the line directly above it. */}
      {pending &&
      (proposalVerdict.tone === "blocked" ||
        proposalVerdict.tone === "confirm" ||
        proposalVerdict.unresolvedBlockerCount > 0 ||
        proposalVerdict.undecidedLineCount > 0 ||
        props.message.patches.length > 1) ? (
        <p
          className={
            proposalVerdict.tone === "blocked"
              ? "rounded-(--radius-field) border border-destructive/45 bg-destructive/10 px-3 py-2 text-(length:--text-small) leading-5 text-(--text-headline)"
              : "rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-fill-soft) px-3 py-2 text-(length:--text-small) leading-5 text-foreground-soft"
          }
          data-resume-proposal-approval-warning
          role="status"
        >
          {proposalVerdict.summary}
        </p>
      ) : null}
      {props.message.proposalError ? (
        <p className="text-sm text-destructive" role="alert">
          {props.message.proposalError}
        </p>
      ) : null}
      {pending ? (
        // The decision row is the reason this card exists. It sticks to the
        // bottom of whichever scroll region holds the transcript so it stays
        // painted at short window heights instead of being clipped below the
        // composer.
        <div
          className="sticky bottom-0 z-10 -mx-3 -mb-3 grid gap-2 rounded-b-(--radius-field) border-t border-(--surface-panel-border) bg-background/95 px-3 py-2.5 backdrop-blur-sm"
          data-resume-proposal-decision-row
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            {blockedSelectionCount > 0 &&
            firstBlockedEditableTargetId &&
            props.onEditWording ? (
              <Button
                data-resume-proposal-edit-wording
                disabled={props.isPending}
                onClick={() =>
                  props.onEditWording?.(firstBlockedEditableTargetId)
                }
                size="sm"
                type="button"
                variant="primary"
              >
                Edit this wording myself
              </Button>
            ) : null}
            <Button
              disabled={props.isPending}
              onClick={() => props.onResolve(props.message.id, "reject", [])}
              size="sm"
              type="button"
              variant="secondary"
            >
              Reject proposal
            </Button>
            <Button
              // A blocked selection demotes this from the primary action, but
              // a bare ghost button had no boundary at all: "Accept anyway (1)"
              // read as text sitting next to the bordered "Reject proposal",
              // not as a control. The ghost fill keeps it subordinate while
              // `--control-border` gives it the >=3:1 boundary every clickable
              // thing on this screen has.
              className={
                blockedSelectionCount > 0
                  ? "border border-(--control-border)"
                  : undefined
              }
              data-resume-proposal-accept
              disabled={props.isPending || selectedPatchIds.length === 0}
              onClick={() =>
                props.onResolve(props.message.id, "accept", selectedPatchIds)
              }
              size="sm"
              type="button"
              variant={blockedSelectionCount > 0 ? "ghost" : "primary"}
            >
              {blockedSelectionCount > 0
                ? `Accept anyway (${selectedPatchIds.length})`
                : `Accept selected (${selectedPatchIds.length})`}
            </Button>
          </div>
          {blockedSelectionCount > 0 ? (
            <p className="text-(length:--text-tiny) leading-4 text-foreground-soft">
              Accepting a blocked change keeps approval disabled until you
              rewrite the flagged wording or approve it as accurate in the
              resume checks.
            </p>
          ) : null}
        </div>
      ) : (
        // A click on a consequential control must never produce a zero-pixel
        // diff. Both outcomes leave a persistent line in the thread, including
        // the case where the grounding verifier refused every selected change.
        <p
          className={
            props.message.proposalStatus === "accepted" &&
            props.message.resolvedPatchIds.length > 0
              ? "text-xs leading-5 text-foreground-soft"
              : "text-xs leading-5 text-(--warning-text)"
          }
          data-resume-proposal-result
          role="status"
        >
          {props.message.proposalStatus === "accepted"
            ? props.message.resolvedPatchIds.length > 0
              ? `Applied ${props.message.resolvedPatchIds.length} of ${props.message.patches.length} proposed changes. The studio shows an Undo for this edit beside the draft.`
              : "Not applied — none of the selected changes passed the grounding check, so your draft is unchanged."
            : "Not applied — this proposal was rejected and your draft is unchanged."}
        </p>
      )}
    </section>
  );
}
