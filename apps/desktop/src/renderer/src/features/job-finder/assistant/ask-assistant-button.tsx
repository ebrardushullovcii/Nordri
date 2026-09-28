import { Sparkles } from "lucide-react";
import type { AssistantEntityRef } from "@nordri/contracts";

import { cn } from "@renderer/lib/cn";
import { useAssistant } from "./assistant-provider";

/**
 * Where an old chat used to open, this opens the one assistant with the
 * right record attached and an optional question ready to send.
 */
export function AskAssistantButton(props: {
  label?: string | undefined;
  prompt?: string | undefined;
  mention?: AssistantEntityRef | undefined;
  className?: string | undefined;
}) {
  const assistant = useAssistant();
  if (!assistant) return null;
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-(--radius-button) border border-(--control-border) bg-(--surface-panel) px-3 text-(length:--text-small) font-medium text-foreground outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/40",
        props.className,
      )}
      data-ask-assistant
      onClick={() =>
        assistant.openWith({
          ...(props.prompt ? { text: props.prompt } : {}),
          ...(props.mention ? { mention: props.mention } : {}),
        })
      }
      type="button"
    >
      <Sparkles aria-hidden="true" className="size-4" />
      {props.label ?? "Ask the assistant"}
    </button>
  );
}
