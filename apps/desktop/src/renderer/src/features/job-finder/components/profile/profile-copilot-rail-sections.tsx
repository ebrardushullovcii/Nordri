import {
  ArrowUp,
  Check,
  MessageSquare,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  JobFinderWorkspaceSnapshot,
  ProfileCopilotContext,
} from "@unemployed/contracts";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { Textarea } from "@renderer/components/ui/textarea";
import { cn } from "@renderer/lib/cn";
import { getProfileCopilotContextKey } from "../../lib/profile-copilot-context";
import {
  RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
  RESUME_ASSISTANT_LONG_RUNNING_MS,
} from "../../lib/wait-state";
import { WaitIndicator } from "../wait-indicator";
import { ProfileCopilotMessageContent } from "./profile-copilot-message-content";
import {
  describePatchOperation,
  getPatchGroupBadgeVariant,
  getProfileCopilotContextLabel,
  getUndonePatchGroupIds,
} from "./profile-copilot-rail.shared";

type ProfileCopilotMessage =
  JobFinderWorkspaceSnapshot["profileCopilotMessages"][number];
type ProfileCopilotPatchGroup = ProfileCopilotMessage["patchGroups"][number];
type ProfileRevision = JobFinderWorkspaceSnapshot["profileRevisions"][number];

export interface ProfileCopilotFailedRequest {
  content: string;
  context: ProfileCopilotContext;
  message: string;
}

function getConversationContent(message: ProfileCopilotMessage): string {
  if (message.patchGroups.length === 0) {
    return message.content;
  }

  // The proposal card owns status and approval copy. Do not repeat the old
  // pending-only sentence in the assistant bubble after the card is shown.
  return message.content
    .replace(/\s*(?:Nothing changed yet|No changes made yet)\.?/giu, "")
    .trim();
}

/**
 * The revision this applied change wrote, whatever has happened since.
 *
 * Only the newest revision used to offer an Undo, so a person who accepted
 * three changes could reverse the third and nothing else. Every applied
 * change now carries its own Undo; the service decides what an undo may
 * reach back through and refuses when it would overwrite the person's own
 * later edit.
 */
function getSafeUndoRevisionId(
  revisions: readonly ProfileRevision[],
  patchGroupId: string,
): string | null {
  let match: ProfileRevision | null = null;

  for (const revision of revisions) {
    if (
      revision.trigger !== "assistant_patch" ||
      revision.patchGroupId !== patchGroupId
    ) {
      continue;
    }

    // A patch group is applied once, but a re-applied group would leave more
    // than one revision behind; the newest is the one to reverse.
    if (match === null || revision.createdAt > match.createdAt) {
      match = revision;
    }
  }

  return match?.id ?? null;
}

function getPatchGroupStatus(
  patchGroup: ProfileCopilotPatchGroup,
  undonePatchGroupIds: ReadonlySet<string>,
): "needs_review" | "applied" | "rejected" | "undone" {
  if (
    patchGroup.applyMode === "applied" &&
    undonePatchGroupIds.has(patchGroup.id)
  ) {
    return "undone";
  }

  return patchGroup.applyMode;
}

function getPatchGroupStatusLabel(
  status: "needs_review" | "applied" | "rejected" | "undone",
): string {
  switch (status) {
    case "needs_review":
      return "Needs review";
    case "applied":
      return "Applied";
    case "rejected":
      return "Rejected";
    case "undone":
      return "Undone";
  }
}

function ProfileCopilotProposalCard(props: {
  actionsDisabledReason?: string | null | undefined;
  busy: boolean;
  onApplyPatchGroup?: ((patchGroupId: string) => void) | undefined;
  onRejectPatchGroup?: ((patchGroupId: string) => void) | undefined;
  onUndoRevision?: ((revisionId: string) => void) | undefined;
  patchGroup: ProfileCopilotPatchGroup;
  revisions: readonly ProfileRevision[];
  undonePatchGroupIds: ReadonlySet<string>;
}) {
  const persistenceNoteId = useId();
  const status = getPatchGroupStatus(
    props.patchGroup,
    props.undonePatchGroupIds,
  );
  const statusLabel = getPatchGroupStatusLabel(status);
  const actionsDisabled = props.busy || Boolean(props.actionsDisabledReason);
  const revisionId =
    status === "applied"
      ? getSafeUndoRevisionId(props.revisions, props.patchGroup.id)
      : null;

  return (
    <section
      aria-label={`Proposed change: ${props.patchGroup.summary}`}
      className="grid min-w-0 gap-2 overflow-hidden rounded-(--radius-field) border border-primary/30 bg-(--surface-panel-solid) p-3 shadow-[inset_0_1px_0_var(--surface-inset-highlight)]"
      data-profile-copilot-proposal="true"
      data-profile-copilot-proposal-status={status}
    >
      <div className="relative grid min-w-0 gap-1 pr-24">
        <p
          className="break-words text-sm font-semibold leading-5 text-foreground"
          title={props.patchGroup.summary}
        >
          {props.patchGroup.summary}
        </p>
        <Badge
          className="absolute right-0 top-0 max-w-24 shrink-0"
          data-profile-copilot-proposal-status-label="true"
          variant={
            status === "undone" ? "outline" : getPatchGroupBadgeVariant(status)
          }
        >
          {statusLabel}
        </Badge>
        <p className="text-(length:--text-tiny) text-muted-foreground">
          {props.patchGroup.operations.length} change
          {props.patchGroup.operations.length === 1 ? "" : "s"}
        </p>
      </div>

      <ul className="grid gap-1 text-sm leading-5 text-foreground-soft">
        {props.patchGroup.operations.map((operation, index) => (
          <li
            className="flex min-w-0 gap-2"
            key={`${props.patchGroup.id}_${index}`}
          >
            <span aria-hidden="true" className="text-primary">
              •
            </span>
            <span className="min-w-0 break-words">
              {describePatchOperation(operation)}
            </span>
          </li>
        ))}
      </ul>

      {status === "needs_review" ? (
        <div className="grid gap-2 border-t border-border/30 pt-2 sm:flex sm:items-center sm:justify-between">
          <p
            className="text-(length:--text-tiny) text-muted-foreground"
            id={persistenceNoteId}
          >
            No changes made yet.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              aria-describedby={persistenceNoteId}
              aria-label={`Apply & save: ${props.patchGroup.summary}`}
              disabled={actionsDisabled}
              onClick={() => props.onApplyPatchGroup?.(props.patchGroup.id)}
              size="xs"
              type="button"
            >
              <Check className="size-3.5" />
              Apply &amp; save
            </Button>
            <Button
              aria-label={`Reject: ${props.patchGroup.summary}`}
              disabled={actionsDisabled}
              onClick={() => props.onRejectPatchGroup?.(props.patchGroup.id)}
              size="xs"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" />
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      {status === "applied" && revisionId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/30 pt-2">
          <p className="text-(length:--text-tiny) text-muted-foreground">
            Saved to your profile
          </p>
          <Button
            aria-label={`Undo applied change: ${props.patchGroup.summary}`}
            disabled={actionsDisabled}
            onClick={() => props.onUndoRevision?.(revisionId)}
            size="xs"
            type="button"
            variant="ghost"
          >
            <RotateCcw className="size-3.5" />
            Undo
          </Button>
        </div>
      ) : null}

      {props.actionsDisabledReason &&
      (status === "needs_review" || status === "applied") ? (
        <p
          className="text-(length:--text-tiny) text-muted-foreground"
          role="status"
        >
          {props.actionsDisabledReason}
        </p>
      ) : null}
    </section>
  );
}

export function ThinkingDots(props: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-(length:--text-tiny) uppercase tracking-[0.18em] text-muted-foreground",
        props.className,
      )}
    >
      <Sparkles className="size-3.5 animate-pulse" />
      <span>{props.label}</span>
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-1 text-current/80"
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 animate-bounce rounded-full bg-current"
            style={{
              animationDelay: `${index * 120}ms`,
              animationDuration: "900ms",
            }}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * Whole seconds since a wait began, restarting each time one does. The clock
 * lives here because the Copilot's pending state is a boolean prop with no
 * start timestamp attached to it.
 */
function useWaitElapsedSeconds(active: boolean): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    if (!active || typeof window === "undefined") {
      return undefined;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [active]);

  return elapsedSeconds;
}

export function ProfileCopilotTranscript(props: {
  actionsDisabledReason?: string | null | undefined;
  busy: boolean;
  context?: ProfileCopilotContext;
  emptyStateDescription: string;
  emptyStateTitle: string;
  failedRequest?: ProfileCopilotFailedRequest | null | undefined;
  isPendingHere: boolean;
  messages: readonly ProfileCopilotMessage[];
  onApplyPatchGroup?: ((patchGroupId: string) => void) | undefined;
  onRejectPatchGroup?: ((patchGroupId: string) => void) | undefined;
  /** Sends a saved question that never got an answer, as it was asked. */
  onAskAgain?:
    | ((content: string, context: ProfileCopilotContext) => void)
    | undefined;
  onRetryFailedRequest?: (() => void) | undefined;
  onUndoRevision?: ((revisionId: string) => void) | undefined;
  onUsePrompt: (prompt: string) => void;
  suggestedPrompts?: readonly string[] | undefined;
  transcriptRef: React.RefObject<HTMLDivElement | null>;
  revisions?: readonly ProfileRevision[] | undefined;
}) {
  const currentContext = props.context ?? { surface: "general" as const };
  const revisions = props.revisions ?? [];
  const pendingElapsedSeconds = useWaitElapsedSeconds(props.isPendingHere);
  const undonePatchGroupIds = useMemo(
    () => getUndonePatchGroupIds(revisions),
    [revisions],
  );
  // A question is saved before the Assistant answers. When the last message
  // is a question and nothing is working on it, it was never answered: the
  // app closed mid-answer, or the AI did not answer. It used to vanish, or
  // sit there with no way to ask it again but retyping it.
  const lastMessage = props.messages.at(-1) ?? null;
  const unansweredQuestion =
    lastMessage?.role === "user" && !props.isPendingHere && !props.busy
      ? lastMessage
      : null;
  // The same question as the failed request is shown once, under the saved
  // copy, with the reason it failed.
  const failedRequest =
    props.failedRequest &&
    unansweredQuestion &&
    unansweredQuestion.content.trim() === props.failedRequest.content.trim()
      ? null
      : props.failedRequest;
  const unansweredReason =
    props.failedRequest &&
    unansweredQuestion &&
    unansweredQuestion.content.trim() === props.failedRequest.content.trim()
      ? props.failedRequest.message
      : "No answer yet: the Assistant stopped before it replied.";

  return (
    <ScrollArea
      className="min-h-0 min-w-0 max-w-full flex-1"
      data-profile-copilot-transcript="true"
      viewportClassName="min-w-0 max-w-full overflow-x-hidden"
      viewportRef={props.transcriptRef}
    >
      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="grid min-h-full min-w-0 max-w-full content-start gap-3 overflow-x-hidden px-4 py-4"
        role="log"
      >
        {props.messages.length > 0 ? (
          props.messages.map((message) => {
            const isAssistant = message.role === "assistant";
            const isCurrentContext =
              getProfileCopilotContextKey(message.context) ===
              getProfileCopilotContextKey(currentContext);
            const content = getConversationContent(message);

            return (
              <article
                className={cn(
                  "grid min-w-0 max-w-full gap-1.5",
                  isAssistant ? "justify-items-start" : "justify-items-end",
                )}
                data-profile-copilot-message-role={message.role}
                key={message.id}
              >
                <div
                  className={cn(
                    "min-w-0 max-w-[94%] break-words text-sm leading-6",
                    isAssistant
                      ? "text-foreground"
                      : "surface-card-tint max-w-[84%] rounded-2xl border border-(--surface-panel-border) px-3 py-2.5 text-foreground",
                  )}
                >
                  {isAssistant ? (
                    <div className="mb-1 flex min-w-0 items-center gap-1.5 text-(length:--text-tiny) text-muted-foreground">
                      <Sparkles className="size-3" />
                      <span>Assistant</span>
                      {!isCurrentContext ? (
                        <span className="truncate">
                          · {getProfileCopilotContextLabel(message.context)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {content ? (
                    isAssistant ? (
                      <ProfileCopilotMessageContent content={content} />
                    ) : (
                      <p className="whitespace-pre-wrap break-words">
                        {content}
                      </p>
                    )
                  ) : null}

                  {message.executionAttribution?.fallbackUsed ? (
                    <p className="mt-2 text-(length:--text-tiny) text-muted-foreground">
                      Copilot used its built-in safe fallback for this reply.
                    </p>
                  ) : null}

                  {isAssistant && message.patchGroups.length > 0 ? (
                    <div className="mt-2 grid min-w-0 gap-2">
                      {message.patchGroups.map((patchGroup) => (
                        <ProfileCopilotProposalCard
                          actionsDisabledReason={props.actionsDisabledReason}
                          busy={props.busy}
                          key={patchGroup.id}
                          onApplyPatchGroup={props.onApplyPatchGroup}
                          onRejectPatchGroup={props.onRejectPatchGroup}
                          onUndoRevision={props.onUndoRevision}
                          patchGroup={patchGroup}
                          revisions={revisions}
                          undonePatchGroupIds={undonePatchGroupIds}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                {unansweredQuestion?.id === message.id ? (
                  <div
                    className="flex max-w-full flex-wrap items-center justify-end gap-2 text-(length:--text-tiny)"
                    data-profile-copilot-unanswered="true"
                  >
                    <p
                      className={
                        props.failedRequest
                          ? "text-destructive"
                          : "text-foreground-soft"
                      }
                      role={props.failedRequest ? "alert" : "status"}
                    >
                      {unansweredReason}
                    </p>
                    {props.onAskAgain ? (
                      <Button
                        disabled={props.busy || props.isPendingHere}
                        onClick={() =>
                          props.onAskAgain?.(message.content, message.context)
                        }
                        size="xs"
                        type="button"
                        variant="secondary"
                      >
                        Ask again
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="flex min-h-full items-start justify-center px-2 py-10">
            <div className="grid w-full max-w-[22rem] gap-2 text-center">
              <p className="font-display text-sm font-semibold text-foreground">
                {props.emptyStateTitle === "No requests yet"
                  ? "What would you like to improve?"
                  : props.emptyStateTitle}
              </p>
              <p className="text-sm leading-5 text-foreground-soft">
                Ask a question or suggest a change.
              </p>
              {(props.suggestedPrompts?.length ?? 0) > 0 ? (
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {props.suggestedPrompts?.slice(0, 2).map((prompt) => (
                    <Button
                      className="h-auto min-w-0 max-w-full break-words whitespace-normal px-2.5 py-1.5 text-left"
                      key={prompt}
                      onClick={() => props.onUsePrompt(prompt)}
                      size="xs"
                      type="button"
                      variant="secondary"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {failedRequest ? (
          <article
            className="grid justify-items-end gap-1.5"
            data-profile-copilot-failed-turn="true"
          >
            <div className="surface-card-tint max-w-[84%] rounded-2xl border border-destructive/35 px-3 py-2.5 text-sm leading-6 text-foreground">
              <p className="whitespace-pre-wrap break-words">
                {failedRequest.content}
              </p>
            </div>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2 text-(length:--text-tiny)">
              <p className="text-destructive" role="alert">
                {failedRequest.message}
              </p>
              {props.onRetryFailedRequest ? (
                <Button
                  disabled={props.busy || props.isPendingHere}
                  onClick={props.onRetryFailedRequest}
                  size="xs"
                  type="button"
                  variant="secondary"
                >
                  Ask again
                </Button>
              ) : null}
            </div>
          </article>
        ) : null}

        {props.isPendingHere ? (
          <article
            className="grid w-full justify-items-stretch"
            data-profile-copilot-pending="true"
          >
            {/* A measured Copilot round trip is ~22s, and this used to be
                three bouncing dots and nothing else — no clock, so nothing
                could tell the user the wait had gone long, and no stated
                expectation to go long *against*. It renders the shared wait
                trio now, the same one the Studio Assistant shows. */}
            <WaitIndicator
              className="max-w-full px-1 py-1.5"
              elapsedSeconds={pendingElapsedSeconds}
              expectationLabel={RESUME_ASSISTANT_EXPECTED_WAIT_LABEL}
              label="Thinking"
              longRunningMs={RESUME_ASSISTANT_LONG_RUNNING_MS}
              message="Working on your request…"
              variant="inline"
            />
          </article>
        ) : null}
      </div>
    </ScrollArea>
  );
}

export function ProfileCopilotComposer(props: {
  busy: boolean;
  composerId: string;
  input: string;
  isPendingHere: boolean;
  onInputChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  placeholder?: string | undefined;
  sendDisabledReason?: string | null | undefined;
}) {
  const helperTextId = `${props.composerId}-helper`;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const maxHeight = 80;
    textarea.style.height = "auto";
    const contentHeight = Math.max(40, textarea.scrollHeight);
    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [props.input]);

  const sendDisabled =
    props.busy ||
    props.isPendingHere ||
    props.input.trim().length === 0 ||
    Boolean(props.sendDisabledReason);

  return (
    <div className="grid shrink-0 gap-1.5" data-profile-copilot-composer="true">
      <div className="flex min-w-0 items-end gap-1.5 rounded-(--radius-field) border border-(--field-border) bg-(--field) p-1.5 transition-[border-color,background-color,box-shadow] focus-within:border-(--field-focus-border) focus-within:bg-(--field-strong) focus-within:shadow-[var(--field-focus-shadow)]">
        <Textarea
          aria-describedby={helperTextId}
          aria-keyshortcuts="Enter Shift+Enter"
          aria-label="Message the Assistant"
          className="min-h-10 min-w-0 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-1.5 text-sm leading-5 shadow-none focus-visible:bg-transparent focus-visible:shadow-none"
          id={props.composerId}
          onChange={(event) => props.onInputChange(event.currentTarget.value)}
          onKeyDown={props.onKeyDown}
          placeholder={props.placeholder ?? "Message the Assistant…"}
          ref={textareaRef}
          rows={1}
          title="Enter to send · Shift+Enter for a new line"
          value={props.input}
        />
        <Button
          aria-label="Send message"
          className="size-9 rounded-full p-0"
          disabled={sendDisabled}
          onClick={props.onSend}
          size="icon"
          title="Send message"
          type="button"
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>

      <div
        className="flex min-w-0 items-center justify-between gap-2"
        data-profile-copilot-send-row="true"
      >
        <p
          className={cn(
            "min-w-0 flex-1 text-(length:--text-tiny) leading-4 text-muted-foreground",
            !props.sendDisabledReason && !props.isPendingHere && "sr-only",
          )}
          id={helperTextId}
        >
          {props.sendDisabledReason ??
            (props.isPendingHere
              ? "Assistant is thinking…"
              : "Enter to send · Shift+Enter for a new line")}
        </p>
        {/* A real link, not a disclosure: the old popover note rendered inside
            the panel's clipped box and painted over the composer. The
            Assistant is part of the app — there is no model or key to choose —
            so this points at what Settings genuinely answers: what leaves this
            device. */}
        <a
          className="shrink-0 rounded-sm text-(length:--text-tiny) leading-4 text-muted-foreground underline decoration-from-font underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          data-profile-copilot-provider-link="true"
          href="#/job-finder/settings"
        >
          How your data is used
        </a>
      </div>
    </div>
  );
}

export function ProfileCopilotCollapsedBubble(props: {
  onClick: () => void;
  collapsedPreviewTitle: string;
  /**
   * Rendered as an ordinary control inside a screen's action row rather than
   * as a floating pill. Identical in shape, label and icon to the Resume
   * Studio launcher, so the two screens are indistinguishable.
   */
  docked?: boolean;
  hasPendingReview?: boolean;
  isDraggable?: boolean;
  isOpen: boolean;
  isPendingHere: boolean;
  messageCount: number;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  title?: string | undefined;
  /**
   * While a form field is focused the launcher hides so it cannot cover the
   * text being typed. It stays mounted and focusable, and focusing it (or
   * leaving the field) brings it straight back.
   */
  yieldsToFocusedField?: boolean;
}) {
  if (props.docked) {
    // The badge says which kind of activity is waiting; an unexplained dot
    // could mean an unread reply, a change to review, or work in progress.
    const badgeLabel = props.isPendingHere
      ? "Replying now"
      : props.hasPendingReview
        ? "A change is waiting for your review"
        : props.messageCount > 0
          ? "This thread has replies"
          : null;

    return (
      <Button
        aria-expanded={props.isOpen}
        aria-haspopup="dialog"
        aria-label={`${props.title ?? "the Assistant"}: ${
          props.isPendingHere
            ? "Replying now"
            : props.messageCount > 0
              ? props.collapsedPreviewTitle
              : "Message the Assistant"
        }`}
        className="relative"
        data-profile-copilot-launcher="true"
        data-profile-copilot-launcher-yielded="false"
        onClick={props.onClick}
        // Default size on purpose: it shares a row with the default-size Save
        // button, and the two must paint at one height. Resume Studio's copy
        // is compact because its header row is compact; size follows the row.
        title={`${props.title ?? "the Assistant"}: ${props.collapsedPreviewTitle}`}
        type="button"
        variant="secondary"
      >
        {props.isPendingHere ? (
          <Sparkles aria-hidden="true" className="size-4 animate-pulse" />
        ) : (
          <MessageSquare aria-hidden="true" className="size-4" />
        )}
        Assistant
        {badgeLabel ? (
          <span
            className="size-2 shrink-0 rounded-full border border-background bg-primary"
            title={badgeLabel}
          >
            <span className="sr-only">{badgeLabel}</span>
          </span>
        ) : null}
      </Button>
    );
  }

  return (
    <Button
      aria-label={`${props.title ?? "the Assistant"}: ${
        props.isPendingHere
          ? "Replying now"
          : props.messageCount > 0
            ? props.collapsedPreviewTitle
            : "Message the Assistant"
      }`}
      aria-expanded={props.isOpen}
      aria-haspopup="dialog"
      className={cn(
        "pointer-events-auto relative size-12 min-h-12 touch-none select-none rounded-full p-0 shadow-(--guided-edits-bubble-shadow) transition-opacity duration-150 sm:h-12 sm:w-auto sm:min-w-12 sm:px-3",
        props.isDraggable === false
          ? "cursor-pointer"
          : "cursor-grab active:cursor-grabbing",
        props.yieldsToFocusedField
          ? "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100"
          : "opacity-100",
      )}
      data-profile-copilot-launcher="true"
      data-profile-copilot-launcher-yielded={
        props.yieldsToFocusedField ? "true" : "false"
      }
      onClick={props.onClick}
      onPointerDown={
        props.isDraggable === false ? undefined : props.onPointerDown
      }
      onPointerMove={
        props.isDraggable === false ? undefined : props.onPointerMove
      }
      onPointerCancel={
        props.isDraggable === false ? undefined : props.onPointerCancel
      }
      onPointerUp={props.isDraggable === false ? undefined : props.onPointerUp}
      title={`${props.title ?? "the Assistant"}: ${props.collapsedPreviewTitle}`}
      type="button"
      variant={
        props.messageCount > 0 || props.isPendingHere ? "primary" : "secondary"
      }
    >
      <span className="flex size-9 items-center justify-center rounded-full border border-current/15 bg-background/15">
        <MessageSquare className="size-4" />
      </span>
      <span className="hidden text-xs font-semibold sm:inline">
        {props.isPendingHere
          ? "Working"
          : props.hasPendingReview
            ? "Review change"
            : "Assistant"}
      </span>
      {props.isPendingHere ? (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-primary/30 bg-background text-primary shadow-sm"
        >
          <Sparkles className="size-3 animate-pulse" />
        </span>
      ) : null}
    </Button>
  );
}
