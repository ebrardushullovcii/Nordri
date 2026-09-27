import { MessageSquare, Sparkles } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  ResumeAssistantMessage,
  ResumeDraft,
  ResumeValidationResult,
} from "@unemployed/contracts";
import { Button } from "@renderer/components/ui/button";
import { ScrollArea } from "@renderer/components/ui/scroll-area";
import { cn } from "@renderer/lib/cn";
import {
  ProfileCopilotComposer,
  ThinkingDots,
} from "../../components/profile/profile-copilot-rail-sections";
import {
  formatResumeOperationElapsed,
  RESUME_ASSISTANT_EXPECTED_WAIT_LABEL,
  RESUME_ASSISTANT_LONG_RUNNING_MS,
} from "./review-queue-progress";
import { formatTimestamp } from "./resume-workspace-utils";
import { ResumeAssistantProposalCard } from "./resume-assistant-proposal-card";
import { isLinesToConfirmBlocker } from "./resume-proposal-verdict";

/**
 * The one Assistant implementation in Resume Studio, rendered in exactly one
 * place: the floating panel.
 *
 * There used to be three placements — a floating panel, a docked studio grid
 * column, and a compact `Assistant` tab. The docked column squeezed the
 * preview and tools panes the moment the Assistant opened, and the tab was a
 * second mounted transcript. Both are gone: the panel now hovers over the
 * studio at every width and the studio layout never reacts to it.
 *
 * It never sizes itself: it fills its container (`h-full min-h-0`) and scrolls
 * internally, so the floating shell's viewport-bounded box is the only bound.
 */
export interface ResumeAssistantPanelProps {
  assistantMessages: readonly ResumeAssistantMessage[];
  assistantPending: boolean;
  /** Supplied by the floating panel so it can focus the composer on open. */
  composerId?: string;
  draft?: ResumeDraft | null;
  /** Extra controls in the header row (the floating panel's Minimize). */
  headerActions?: ReactNode;
  /** Leading header ornament (the floating panel's drag grip). */
  headerLeading?: ReactNode;
  /** Drag handlers the floating panel attaches to its own header. */
  headerProps?: HTMLAttributes<HTMLElement>;
  isWorkspacePending: boolean;
  onEditProposalWording?: (targetId: string) => void;
  onReloadWorkspace?: () => void;
  /** Whole-draft rewrite, offered here as the single named AI action. */
  onRegenerateDraft?: () => void;
  onResolveProposal?: (
    proposalId: string,
    action: "accept" | "reject",
    patchIds: readonly string[],
  ) => void;
  onSendAssistantMessage: (content: string) => void;
  titleId?: string;
  transcriptViewportRef?: RefObject<HTMLDivElement | null>;
  validation?: ResumeValidationResult | null;
}

/** Ready questions for an empty thread; each is sent as typed. */
export const RESUME_ASSISTANT_STARTER_PROMPTS: readonly string[] = [
  "What would you change to fit this job better?",
  "Make the summary sharper and more specific.",
  "Use the posting's own words where my experience backs them.",
];

/**
 * A typed yes to the proposal on screen is the same decision as pressing its
 * Accept, so it is taken locally instead of asking the model to propose the
 * same change again. A proposal whose wording the evidence does not back is
 * not accepted this way ("do it" may mean "fix it"); that reply, and anything
 * else ("the second one", "only the summary"), goes to the Assistant, which
 * sees the recent turns and each proposal's status.
 */
export const RESUME_ASSISTANT_ACCEPT_REPLY =
  /^(?:(?:ok(?:ay)?|yes|yep|sure|great|perfect)[,!. ]+)?(?:yes(?: please)?|yep|sure|ok(?:ay)?|go ahead|do it|please do(?: it)?|apply (?:it|them|that|those|all)|make (?:that|those|the) changes?|accept (?:it|them|that|those|all)|sounds good|looks good|do (?:that|those|both|all of them))[.! ]*$/iu;

export function findAcceptableAssistantProposal(
  messages: readonly ResumeAssistantMessage[],
): ResumeAssistantMessage | undefined {
  const latestAssistantResponse = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  return latestAssistantResponse?.proposalStatus === "pending" &&
    latestAssistantResponse.patches.length > 0 &&
    (latestAssistantResponse.approvalBlockers ?? []).every(
      isLinesToConfirmBlocker,
    )
    ? latestAssistantResponse
    : undefined;
}

export function ResumeAssistantPanel(props: ResumeAssistantPanelProps) {
  const [input, setInput] = useState("");
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const [isAssistantLongRunning, setIsAssistantLongRunning] = useState(false);
  const [assistantElapsedSeconds, setAssistantElapsedSeconds] = useState(0);
  const generatedComposerId = useId();
  const generatedTitleId = useId();
  const composerId = props.composerId ?? generatedComposerId;
  const titleId = props.titleId ?? generatedTitleId;
  const ownTranscriptViewportRef = useRef<HTMLDivElement | null>(null);
  const transcriptViewportRef =
    props.transcriptViewportRef ?? ownTranscriptViewportRef;
  const hasPendingProposal = props.assistantMessages.some(
    (message) =>
      message.role === "assistant" && message.proposalStatus === "pending",
  );
  const latestAcceptableProposal = findAcceptableAssistantProposal(
    props.assistantMessages,
  );

  // The proposal's Accept/Reject controls are the last thing in the transcript,
  // and the transcript is the only region that shrinks when the panel does.
  // Pinning it to the bottom on every content *and* size change keeps those
  // controls visible instead of half-clipped behind the composer.
  useEffect(() => {
    const transcriptViewport = transcriptViewportRef.current;

    if (!transcriptViewport) {
      return;
    }

    const pinToBottom = () => {
      transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
    };

    pinToBottom();

    if (!hasPendingProposal) {
      return;
    }

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(pinToBottom);

    observer?.observe(transcriptViewport);
    window.addEventListener("resize", pinToBottom);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", pinToBottom);
    };
  }, [
    hasPendingProposal,
    props.assistantMessages.length,
    props.assistantPending,
    transcriptViewportRef,
  ]);

  useEffect(() => {
    setIsAssistantLongRunning(false);
    setAssistantElapsedSeconds(0);

    if (!props.assistantPending) {
      return;
    }

    const startedAt = Date.now();
    // An indefinite "Working on your edit…" with three dots gave the user no
    // way to tell a 25s wait from a stalled one. The counter runs from the
    // moment the request left, beside a stated expected range.
    const intervalId = window.setInterval(() => {
      setAssistantElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    const timeoutId = window.setTimeout(() => {
      setIsAssistantLongRunning(true);
    }, RESUME_ASSISTANT_LONG_RUNNING_MS);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [props.assistantPending]);

  function handleSend() {
    const nextInput = input.trim();

    if (
      props.isWorkspacePending ||
      props.assistantPending ||
      nextInput.length === 0
    ) {
      return;
    }

    if (
      latestAcceptableProposal &&
      props.onResolveProposal &&
      RESUME_ASSISTANT_ACCEPT_REPLY.test(nextInput)
    ) {
      props.onResolveProposal(
        latestAcceptableProposal.id,
        "accept",
        latestAcceptableProposal.patches.map((patch) => patch.id),
      );
    } else {
      props.onSendAssistantMessage(nextInput);
    }
    setInput("");
  }

  // The empty thread used to be a description of what one could type. Three
  // ready questions are faster than composing one, and the first is the one
  // most people actually want: what would you change.
  function sendStarterPrompt(prompt: string) {
    if (props.isWorkspacePending || props.assistantPending) {
      return;
    }
    props.onSendAssistantMessage(prompt);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSend();
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-resume-assistant-panel="true"
      data-resume-assistant-variant="floating"
    >
      <header
        {...(props.headerProps ?? {})}
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-border/30 px-4 py-2.5",
          props.headerProps?.className,
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {props.headerLeading}
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <MessageSquare className="size-3.5" />
          </div>
          <div className="min-w-0">
            {/* No size override: the published scale owns `h2`. */}
            <h2 className="truncate leading-tight text-foreground" id={titleId}>
              Assistant
            </h2>
            <p className="truncate text-(length:--text-tiny) text-muted-foreground">
              Resume draft
            </p>
          </div>
        </div>
        {props.headerActions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {props.headerActions}
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea
          className="min-h-0 min-w-0 max-w-full flex-1"
          data-resume-guided-edits-transcript="true"
          viewportClassName="min-w-0 max-w-full overflow-x-hidden"
          viewportRef={transcriptViewportRef}
        >
          <div
            aria-live="polite"
            aria-relevant="additions text"
            className="grid min-h-full min-w-0 max-w-full content-start gap-3 overflow-x-hidden px-4 py-4"
            role="log"
          >
            {props.assistantMessages.length ? (
              props.assistantMessages.map((message, messageIndex) => {
                const isAssistant = message.role === "assistant";
                const timestamp = formatTimestamp(message.createdAt);
                // A full locale timestamp on every bubble of a two-message
                // thread is noise. The thread is anchored by the first
                // message; the rest expose the exact time on hover.
                const showTimestamp = messageIndex === 0;

                return (
                  <article
                    className={cn(
                      "grid min-w-0 max-w-full gap-1.5",
                      isAssistant ? "justify-items-start" : "justify-items-end",
                    )}
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
                      <div
                        className="mb-1 flex min-w-0 items-center gap-1.5 text-(length:--text-tiny) text-muted-foreground"
                        title={timestamp}
                      >
                        {isAssistant ? <Sparkles className="size-3" /> : null}
                        <span>{isAssistant ? "Assistant" : "You"}</span>
                        {showTimestamp ? (
                          <span className="truncate">· {timestamp}</span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                      {message.executionAttribution?.fallbackUsed ? (
                        <p className="mt-2 text-(length:--text-tiny) text-muted-foreground">
                          {describeAssistantFallback(
                            message.executionAttribution.stopReason,
                          )}
                        </p>
                      ) : null}
                      {isAssistant &&
                      props.draft &&
                      props.onResolveProposal &&
                      message.proposalStatus !== "none" ? (
                        <ResumeAssistantProposalCard
                          draft={props.draft}
                          isPending={props.isWorkspacePending}
                          message={message}
                          {...(props.onEditProposalWording
                            ? {
                                onEditWording: props.onEditProposalWording,
                              }
                            : {})}
                          onResolve={props.onResolveProposal}
                          validation={props.validation ?? null}
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="flex min-h-48 items-center justify-center">
                <div className="grid max-w-80 gap-3 text-center">
                  <div className="surface-card-tint mx-auto flex size-11 items-center justify-center rounded-full border border-(--surface-panel-border) text-muted-foreground">
                    <MessageSquare className="size-4" />
                  </div>
                  <p className="font-display text-sm text-foreground">
                    Ask for a change, or ask what to change
                  </p>
                  <p className="text-sm leading-6 text-foreground-soft">
                    Every suggestion shows up as a before-and-after you accept
                    or reject. Nothing changes until you accept.
                  </p>
                  <div
                    className="flex flex-wrap justify-center gap-1.5"
                    data-resume-assistant-starters
                  >
                    {RESUME_ASSISTANT_STARTER_PROMPTS.map((prompt) => (
                      <Button
                        className="h-auto max-w-full whitespace-normal px-2.5 py-1 text-left text-xs font-medium normal-case tracking-normal"
                        disabled={
                          props.isWorkspacePending || props.assistantPending
                        }
                        key={prompt}
                        onClick={() => sendStarterPrompt(prompt)}
                        size="compact"
                        type="button"
                        variant="secondary"
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {props.assistantPending ? (
              <article className="grid justify-items-start gap-2">
                <div className="max-w-full px-1 py-1.5 text-sm leading-5 text-foreground">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <ThinkingDots label="Assistant thinking" />
                    <span
                      className="font-mono text-(length:--text-tiny) tabular-nums text-foreground-soft"
                      data-resume-assistant-elapsed
                    >
                      {formatResumeOperationElapsed(assistantElapsedSeconds)}
                    </span>
                  </div>
                  <p>
                    {isAssistantLongRunning
                      ? "Taking longer than expected. Your saved draft is unchanged; reload the workspace to check for a completed reply. This request may still finish in the background."
                      : "Working on your edit…"}
                  </p>
                  <p
                    className="mt-1 text-(length:--text-tiny) leading-4 text-muted-foreground"
                    data-resume-assistant-expected-wait
                  >
                    {RESUME_ASSISTANT_EXPECTED_WAIT_LABEL}
                  </p>
                  {isAssistantLongRunning && props.onReloadWorkspace ? (
                    <Button
                      className="mt-3"
                      onClick={props.onReloadWorkspace}
                      type="button"
                      variant="secondary"
                    >
                      Reload workspace
                    </Button>
                  ) : null}
                </div>
              </article>
            ) : null}
          </div>
        </ScrollArea>

        {/* The whole-draft rewrite used to sit on the page as "Refresh draft"
            and "Retry with AI", two differently named buttons for the same
            destructive action with no stated blast radius. It is now one
            Assistant action that says what it replaces and asks once before it
            runs. */}
        {props.onRegenerateDraft ? (
          <div
            className="shrink-0 border-t border-(--surface-panel-border) px-2.5 py-2"
            data-resume-assistant-quick-actions="true"
          >
            {isRegenerateConfirmOpen ? (
              <div className="grid gap-2">
                <p className="text-(length:--text-small) leading-5 text-foreground-soft">
                  This writes a completely new draft from your saved evidence
                  and replaces the edits you have made here.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={props.isWorkspacePending}
                    onClick={() => {
                      setIsRegenerateConfirmOpen(false);
                      props.onRegenerateDraft?.();
                    }}
                    size="compact"
                    type="button"
                    variant="primary"
                  >
                    Replace my draft
                  </Button>
                  <Button
                    onClick={() => setIsRegenerateConfirmOpen(false)}
                    size="compact"
                    type="button"
                    variant="ghost"
                  >
                    Keep my draft
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left leading-5"
                data-resume-assistant-regenerate
                disabled={props.isWorkspacePending || props.assistantPending}
                onClick={() => setIsRegenerateConfirmOpen(true)}
                size="compact"
                type="button"
                variant="secondary"
              >
                Create a new AI draft — this replaces your edits
              </Button>
            )}
          </div>
        ) : null}

        <div
          // The floating panel keeps its own viewport inset, so the composer
          // never needs an extra bottom gutter to clear the window edge.
          className="shrink-0 border-t border-(--surface-panel-border) bg-(--surface-fill-soft) p-2.5"
          data-resume-guided-edits-composer="true"
        >
          <ProfileCopilotComposer
            busy={props.isWorkspacePending}
            composerId={composerId}
            input={input}
            isPendingHere={props.assistantPending}
            onInputChange={setInput}
            onKeyDown={handleComposerKeyDown}
            onSend={handleSend}
            placeholder="Ask for a resume edit…"
            sendDisabledReason={
              props.isWorkspacePending
                ? "Saving workspace…"
                : props.assistantPending
                  ? "Reply in progress…"
                  : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Why the safe fallback answered instead of the model. "Unavailable" was the
 * only wording before, which blamed the provider for a request the model was
 * still working on when its time ran out.
 */
function describeAssistantFallback(
  stopReason: string | null | undefined,
): string {
  switch (stopReason) {
    case "time_budget":
      return "The AI ran out of time before it finished this edit, so the Assistant answered with its built-in safe fallback. A smaller, more specific request usually completes.";
    case "no_progress":
      return "The AI could not turn this request into a grounded edit, so the Assistant answered with its built-in safe fallback.";
    default:
      return "AI was unavailable, so the Assistant used the built-in safe fallback for this reply.";
  }
}
