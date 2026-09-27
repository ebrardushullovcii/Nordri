// @vitest-environment jsdom

import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ProfileCopilotCollapsedBubble,
  ProfileCopilotComposer,
  ProfileCopilotTranscript,
} from "./profile-copilot-rail-sections";

describe("ProfileCopilotComposer", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  function renderComposer(
    props: Partial<ComponentProps<typeof ProfileCopilotComposer>> = {},
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const defaultProps: ComponentProps<typeof ProfileCopilotComposer> = {
      busy: false,
      composerId: "profile-copilot-composer",
      input: "Draft next request while Copilot works.",
      isPendingHere: true,
      onInputChange: vi.fn(),
      onKeyDown: vi.fn(),
      onSend: vi.fn(),
      placeholder: "Message the Assistant…",
      sendDisabledReason: null,
    };

    act(() => {
      root?.render(<ProfileCopilotComposer {...defaultProps} {...props} />);
    });
  }

  test("keeps the composer editable while a reply is pending", () => {
    renderComposer();

    const textarea = container?.querySelector("textarea");
    const button = container?.querySelector("button");

    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(textarea?.value).toBe("Draft next request while Copilot works.");
    expect(container?.textContent).toContain("Assistant is thinking…");
    expect(button?.getAttribute("aria-label")).toBe("Send message");
    expect(button?.hasAttribute("disabled")).toBe(true);
  });

  test("shows an explicit save-first guard reason when sending is blocked", () => {
    renderComposer({
      input: "Please update my preferences.",
      isPendingHere: false,
      sendDisabledReason:
        "Save this page before asking the Assistant to edit it so your current profile draft does not get overwritten.",
    });

    const textarea = container?.querySelector("textarea");
    const button = container?.querySelector("button");

    expect(textarea?.disabled).toBe(false);
    expect(container?.textContent).toContain(
      "Save this page before asking the Assistant to edit it so your current profile draft does not get overwritten.",
    );
    expect(button?.getAttribute("aria-label")).toBe("Send message");
    expect(button?.hasAttribute("disabled")).toBe(true);
  });

  test("links the data question to Settings instead of a popover note", () => {
    renderComposer({ isPendingHere: false });
    // The Assistant is bundled: there is nothing to configure, so the
    // link answers the question Settings actually answers.
    expect(container?.textContent).toContain("How your data is used");
    expect(container?.textContent).not.toContain("Keyboard & movement help");
    expect(container?.textContent).not.toContain("Ask for an edit");
    expect(container?.textContent).not.toContain("Send request");
    expect(
      container?.querySelector('[data-profile-copilot-provider-link="true"]'),
    ).not.toBeNull();
  });

  test("uses a compact chat input with keyboard shortcuts", () => {
    renderComposer({
      input: "Please update my headline.",
      isPendingHere: false,
    });

    const composer = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-composer="true"]',
    );
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    const sendRow = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-send-row="true"]',
    );
    const movementHelp = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-movement-help="true"]',
    );
    const providerLink = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-provider-link="true"]',
    );

    expect(composer?.className).toContain("shrink-0");
    expect(textarea?.getAttribute("rows")).toBe("1");
    expect(textarea?.getAttribute("aria-label")).toBe("Message the Assistant");
    expect(textarea?.getAttribute("aria-keyshortcuts")).toBe(
      "Enter Shift+Enter",
    );
    expect(textarea?.className).toContain("min-h-10");
    expect(textarea?.className).toContain("overflow-y-hidden");
    expect(textarea?.style.height).toBe("40px");
    expect(sendRow?.className).toContain("flex");
    expect(sendRow?.className).not.toContain("sticky");
    expect(movementHelp).toBeNull();
    expect(providerLink?.getAttribute("href")).toBe("#/job-finder/settings");
    expect(container?.textContent).not.toContain("Send request");
  });

  test("keeps multiline composer input inside an 80px budget", () => {
    const input = "A long multiline request with more detail";
    renderComposer({ input });

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    if (!textarea) {
      throw new Error("Expected the Copilot composer textarea.");
    }

    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      value: 240,
    });
    act(() => {
      root?.render(
        <ProfileCopilotComposer
          busy={false}
          composerId="profile-copilot-composer"
          input={`${input}\nwith another line`}
          isPendingHere={false}
          onInputChange={vi.fn()}
          onKeyDown={vi.fn()}
          onSend={vi.fn()}
          placeholder="Message the Assistant…"
          sendDisabledReason={null}
        />,
      );
    });

    expect(textarea.style.height).toBe("80px");
    expect(textarea.style.overflowY).toBe("auto");
  });
});

describe("ProfileCopilotTranscript", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  function renderTranscript(
    props: Partial<ComponentProps<typeof ProfileCopilotTranscript>> = {},
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const defaultProps: ComponentProps<typeof ProfileCopilotTranscript> = {
      busy: false,
      emptyStateDescription: "No transcript yet.",
      emptyStateTitle: "Ask the Assistant",
      isPendingHere: false,
      messages: [
        {
          id: "assistant_message_1",
          role: "assistant",
          content: [
            "## Suggested updates",
            "",
            "- Prefer **remote-first** targets",
            "- Add `LinkedIn Jobs`",
            "",
            "> Review the broader rewrite before applying it.",
            "",
            "```json",
            "{",
            '  "applyMode": "needs_review"',
            "}",
            "```",
          ].join("\n"),
          context: { surface: "profile", section: "preferences" },
          patchGroups: [],
          createdAt: "2026-04-15T16:00:00.000Z",
        },
      ],
      onUsePrompt: vi.fn(),
      suggestedPrompts: [],
      transcriptRef: createRef<HTMLDivElement>(),
    };

    act(() => {
      root?.render(<ProfileCopilotTranscript {...defaultProps} {...props} />);
    });
  }

  test("renders assistant markdown-like content as structured transcript UI", () => {
    renderTranscript();

    const markdownRoot = container?.querySelector(
      '[data-profile-copilot-markdown="true"]',
    );
    const heading = markdownRoot?.querySelector("h3");
    const listItems = [...(markdownRoot?.querySelectorAll("ul li") ?? [])].map(
      (element) => element.textContent?.trim(),
    );
    const blockquote = markdownRoot?.querySelector("blockquote");
    const strong = markdownRoot?.querySelector("strong");
    const inlineCode = markdownRoot?.querySelector("code");
    const codeBlock = markdownRoot?.querySelector("pre code");

    expect(heading?.textContent).toBe("Suggested updates");
    expect(listItems).toEqual([
      "Prefer remote-first targets",
      "Add LinkedIn Jobs",
    ]);
    expect(strong?.textContent).toBe("remote-first");
    expect(blockquote?.textContent).toContain(
      "Review the broader rewrite before applying it.",
    );
    expect(inlineCode?.textContent).toBe("LinkedIn Jobs");
    expect(codeBlock?.textContent).toContain('"applyMode": "needs_review"');
    expect(container?.textContent).toContain("Profile - Preferences");
  });

  test("wraps long suggested prompts within the transcript width", () => {
    const longPrompt =
      "What should I save for my background when the answer includes several sentences and a detailed explanation?";
    renderTranscript({ messages: [], suggestedPrompts: [longPrompt] });

    const suggestion = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes(longPrompt),
    );

    expect(suggestion).not.toBeUndefined();
    expect(suggestion?.className).toContain("min-w-0");
    expect(suggestion?.className).toContain("max-w-full");
    expect(suggestion?.className).toContain("whitespace-normal");
    expect(suggestion?.className).toContain("break-words");
  });

  test("shows a quiet assistant typing row while a reply is pending", () => {
    renderTranscript({ isPendingHere: true });

    expect(container?.textContent).toContain("Thinking");
    expect(
      container?.querySelector('[data-profile-copilot-pending="true"]'),
    ).not.toBeNull();
  });

  test("shows exact proposed scalar, list, and compensation values before approval", () => {
    renderTranscript({
      messages: [
        {
          id: "assistant_message_proposal",
          role: "assistant",
          content:
            "I prepared these changes for your review. Nothing changed yet.",
          context: { surface: "profile", section: "preferences" },
          patchGroups: [
            {
              id: "patch_group_proposal",
              summary: "Update job preferences",
              applyMode: "needs_review",
              operations: [
                {
                  operation: "replace_identity_fields",
                  value: { headline: "Senior Product Engineer" },
                },
                {
                  operation: "replace_profile_list_fields",
                  value: { locations: ["New York"] },
                },
                {
                  operation: "replace_compensation_preferences_fields",
                  value: {
                    minimum: 3000,
                    maximum: 4000,
                    interval: "month",
                    currency: null,
                    currencyStatus: "needs_clarification",
                  },
                },
              ],
              createdAt: "2026-04-15T16:00:00.000Z",
            },
          ],
          createdAt: "2026-04-15T16:00:00.000Z",
        },
      ],
    });

    expect(container?.textContent).toContain(
      "Set headline to “Senior Product Engineer”",
    );
    expect(container?.textContent).toContain("Set locations to New York");
    expect(container?.textContent).toContain(
      "Set minimum compensation to 3,000 and target compensation to 4,000 / month (currency not set — confirmation needed)",
    );
    expect(container?.textContent).not.toContain("Nothing changed yet.");
  });

  test.each([
    {
      applyMode: "applied" as const,
      expectedStatus: "Applied",
    },
    {
      applyMode: "rejected" as const,
      expectedStatus: "Rejected",
    },
  ])(
    "replaces stale pending-only wording after a proposal is $applyMode",
    ({ applyMode, expectedStatus }) => {
      renderTranscript({
        messages: [
          {
            id: `assistant_message_${applyMode}`,
            role: "assistant",
            content:
              "I prepared this change for your review. Nothing changed yet.",
            context: { surface: "profile", section: "basics" },
            patchGroups: [
              {
                id: `patch_group_${applyMode}`,
                summary: "Update headline",
                applyMode,
                operations: [
                  {
                    operation: "replace_identity_fields",
                    value: { headline: "Senior Product Engineer" },
                  },
                ],
                createdAt: "2026-04-15T16:00:00.000Z",
              },
            ],
            createdAt: "2026-04-15T16:00:00.000Z",
          },
        ],
      });

      expect(container?.textContent).not.toContain("Nothing changed yet");
      expect(container?.textContent).toContain(expectedStatus);
      expect(container?.textContent).not.toContain("Current status:");
    },
  );

  test("reports partial progress when one proposal is applied and another still needs review", () => {
    renderTranscript({
      messages: [
        {
          id: "assistant_message_partial",
          role: "assistant",
          content: "I prepared 2 changes for your review. Nothing changed yet.",
          context: { surface: "profile", section: "preferences" },
          patchGroups: [
            {
              id: "patch_group_applied",
              summary: "Update headline",
              applyMode: "applied",
              operations: [
                {
                  operation: "replace_identity_fields",
                  value: { headline: "Senior Product Engineer" },
                },
              ],
              createdAt: "2026-04-15T16:00:00.000Z",
            },
            {
              id: "patch_group_pending",
              summary: "Update locations",
              applyMode: "needs_review",
              operations: [
                {
                  operation: "replace_profile_list_fields",
                  value: { locations: ["New York"] },
                },
              ],
              createdAt: "2026-04-15T16:00:00.000Z",
            },
          ],
          createdAt: "2026-04-15T16:00:00.000Z",
        },
      ],
    });

    expect(container?.textContent).not.toContain("Nothing changed yet");
    expect(container?.textContent).toContain("Applied");
    expect(container?.textContent).toContain("Needs review");
  });

  test("does not claim applied after revision undo — transcript shows undone status", () => {
    renderTranscript({
      messages: [
        {
          id: "assistant_message_applied",
          role: "assistant",
          content:
            "I prepared this change for your review. Nothing changed yet.",
          context: { surface: "profile", section: "basics" },
          patchGroups: [
            {
              id: "patch_group_applied",
              summary: "Update headline",
              applyMode: "applied",
              operations: [
                {
                  operation: "replace_identity_fields",
                  value: { headline: "Senior Product Engineer" },
                },
              ],
              createdAt: "2026-04-15T16:00:00.000Z",
            },
          ],
          createdAt: "2026-04-15T16:00:00.000Z",
        },
      ],
      revisions: [
        {
          id: "profile_revision_applied",
          createdAt: "2026-04-15T16:00:10.000Z",
          reason: "Assistant patch: Update headline",
          trigger: "assistant_patch",
          messageId: "assistant_message_applied",
          patchGroupId: "patch_group_applied",
          restoredFromRevisionId: null,
        },
        {
          id: "profile_revision_undo",
          createdAt: "2026-04-15T16:01:00.000Z",
          reason: "Undo: Assistant patch: Update headline",
          trigger: "undo",
          messageId: null,
          patchGroupId: null,
          restoredFromRevisionId: "profile_revision_applied",
        },
      ] as never,
    });

    expect(container?.textContent).not.toContain("This change is applied");
    expect(container?.textContent).not.toContain("These changes are applied");
    expect(container?.textContent).toContain("Undone");
  });
  test("renders the shared wait trio while a request is pending, not three dots", () => {
    // STAB-04: a measured Copilot round trip is ~22s and this was
    // `<ThinkingDots label="Thinking" />` alone — no clock, so nothing could
    // say the wait had gone long, and no stated expectation to go long
    // against. The identical wait one screen over already showed all of it.
    renderTranscript({ isPendingHere: true });

    const pending = container?.querySelector<HTMLElement>(
      "[data-profile-copilot-pending]",
    );
    expect(pending).not.toBeNull();

    const wait = pending?.querySelector<HTMLElement>("[data-wait-indicator]");
    expect(wait).not.toBeNull();
    // The trio: an indeterminate signal, a reserved elapsed slot, an
    // expectation.
    expect(wait?.querySelector("[role='progressbar']")).not.toBeNull();
    expect(wait?.querySelector("[data-wait-elapsed]")).not.toBeNull();
    expect(
      wait?.querySelector("[data-wait-expectation]")?.textContent,
    ).toContain("Usually 20-30 seconds");
  });
});

describe("ProfileCopilotTranscript inline proposals", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  function renderProposal(
    applyMode: "needs_review" | "applied" | "rejected" = "needs_review",
    revisions: ComponentProps<
      typeof ProfileCopilotTranscript
    >["revisions"] = [],
    busy = false,
  ) {
    const onApplyPatchGroup = vi.fn();
    const onRejectPatchGroup = vi.fn();
    const onUndoRevision = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotTranscript
          busy={busy}
          context={{ surface: "profile", section: "basics" }}
          emptyStateDescription="Ask a question."
          emptyStateTitle="What would you like to improve?"
          isPendingHere={false}
          messages={[
            {
              id: "assistant_message_proposal",
              role: "assistant",
              content: "I can make this change for you. Nothing changed yet.",
              context: { surface: "profile", section: "basics" },
              patchGroups: [
                {
                  id: "patch_group_proposal",
                  summary: "Update headline",
                  applyMode,
                  operations: [
                    {
                      operation: "replace_identity_fields",
                      value: { headline: "Product Designer" },
                    },
                  ],
                  createdAt: "2026-04-15T16:00:00.000Z",
                },
              ],
              createdAt: "2026-04-15T16:00:00.000Z",
            },
          ]}
          onApplyPatchGroup={onApplyPatchGroup}
          onRejectPatchGroup={onRejectPatchGroup}
          onUndoRevision={onUndoRevision}
          onUsePrompt={vi.fn()}
          revisions={revisions}
          suggestedPrompts={[]}
          transcriptRef={createRef<HTMLDivElement>()}
        />,
      );
    });

    return { onApplyPatchGroup, onRejectPatchGroup, onUndoRevision };
  }

  test("keeps proposal actions inline with the assistant message", () => {
    const { onApplyPatchGroup, onRejectPatchGroup } = renderProposal();
    const proposal = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-proposal="true"]',
    );
    const applyButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Apply & save:"]',
    );
    const rejectButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Reject:"]',
    );

    expect(proposal).not.toBeNull();
    expect(proposal?.getAttribute("data-profile-copilot-proposal-status")).toBe(
      "needs_review",
    );
    expect(proposal?.textContent).toContain(
      "Set headline to “Product Designer”",
    );
    expect(proposal?.textContent).toContain("No changes made yet.");
    const statusLabel = proposal?.querySelector<HTMLElement>(
      '[data-profile-copilot-proposal-status-label="true"]',
    );
    expect(statusLabel).not.toBeNull();
    expect(statusLabel?.className).toContain("absolute");
    expect(statusLabel?.className).toContain("right-0");
    expect(proposal?.textContent).not.toContain("Saves immediately");
    expect(applyButton?.textContent).toContain("Apply & save");
    expect(proposal?.textContent).not.toContain("Nothing changed yet");
    expect(
      container?.querySelector("[data-profile-copilot-review-actions]"),
    ).toBeNull();
    expect(
      container?.querySelector("[data-profile-copilot-history]"),
    ).toBeNull();

    act(() => {
      applyButton?.click();
      rejectButton?.click();
    });

    expect(onApplyPatchGroup).toHaveBeenCalledWith("patch_group_proposal");
    expect(onRejectPatchGroup).toHaveBeenCalledWith("patch_group_proposal");
  });

  test("shows a compact undo on the applied proposal using its assistant revision", () => {
    const { onUndoRevision } = renderProposal("applied", [
      {
        id: "profile_revision_applied",
        createdAt: "2026-04-15T16:00:10.000Z",
        reason: "Assistant patch: Update headline",
        trigger: "assistant_patch",
        messageId: "assistant_message_proposal",
        patchGroupId: "patch_group_proposal",
        restoredFromRevisionId: null,
      },
    ] as never);
    const proposal = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-proposal="true"]',
    );
    const undoButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Undo applied change:"]',
    );

    expect(proposal?.textContent).toContain("Applied");
    expect(proposal?.textContent).toContain("Saved to your profile");
    expect(undoButton).not.toBeNull();

    act(() => undoButton?.click());
    expect(onUndoRevision).toHaveBeenCalledWith("profile_revision_applied");
  });

  test("disables apply, reject, and undo while profile mutation is pending", () => {
    const { onApplyPatchGroup, onRejectPatchGroup } = renderProposal(
      "needs_review",
      [],
      true,
    );
    const proposal = container?.querySelector<HTMLElement>(
      '[data-profile-copilot-proposal="true"]',
    );
    const applyButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Apply & save:"]',
    );
    const rejectButton = proposal?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Reject:"]',
    );

    expect(applyButton?.disabled).toBe(true);
    expect(rejectButton?.disabled).toBe(true);

    act(() => {
      applyButton?.click();
      rejectButton?.click();
    });

    expect(onApplyPatchGroup).not.toHaveBeenCalled();
    expect(onRejectPatchGroup).not.toHaveBeenCalled();
  });

  test("keeps undo on an earlier applied change after a newer one lands", () => {
    renderProposal("applied", [
      {
        id: "profile_revision_applied",
        createdAt: "2026-04-15T16:00:10.000Z",
        reason: "Assistant patch: Update headline",
        trigger: "assistant_patch",
        messageId: "assistant_message_proposal",
        patchGroupId: "patch_group_proposal",
        restoredFromRevisionId: null,
      },
      {
        id: "profile_revision_newer",
        createdAt: "2026-04-15T16:01:10.000Z",
        reason: "Assistant patch: Update location",
        trigger: "assistant_patch",
        messageId: "assistant_message_newer",
        patchGroupId: "patch_group_newer",
        restoredFromRevisionId: null,
      },
    ] as never);

    // Undo used to appear only on the newest revision, so three accepted
    // changes left the person able to reverse the third and nothing else.
    // Each applied change now offers its own Undo; the service refuses the
    // ones that would overwrite a later edit of the person's own.
    expect(
      container
        ?.querySelector('button[aria-label^="Undo applied change:"]')
        ?.getAttribute("aria-label"),
    ).toBe("Undo applied change: Update headline");
    expect(container?.textContent).toContain("Applied");
  });

  test("renders failed turns inline with a retry action", () => {
    const onRetryFailedRequest = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotTranscript
          busy={false}
          emptyStateDescription="Ask a question."
          emptyStateTitle="What would you like to improve?"
          failedRequest={{
            content: "Please update my headline.",
            context: { surface: "profile", section: "basics" },
            message: "Copilot could not complete that message.",
          }}
          isPendingHere={false}
          messages={[]}
          onRetryFailedRequest={onRetryFailedRequest}
          onUsePrompt={vi.fn()}
          suggestedPrompts={[]}
          transcriptRef={createRef<HTMLDivElement>()}
        />,
      );
    });

    const failedTurn = container.querySelector<HTMLElement>(
      '[data-profile-copilot-failed-turn="true"]',
    );
    const retry = [
      ...(failedTurn?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((button) => button.textContent === "Ask again");

    expect(failedTurn?.textContent).toContain("Please update my headline.");
    expect(failedTurn?.textContent).toContain(
      "Copilot could not complete that message.",
    );
    act(() => retry?.click());
    expect(onRetryFailedRequest).toHaveBeenCalledTimes(1);
  });

  const savedQuestion = {
    id: "profile_copilot_user_message_saved",
    role: "user" as const,
    content: "Change my headline to Principal Engineer.",
    context: { surface: "profile" as const, section: "basics" as const },
    patchGroups: [],
    createdAt: "2026-09-23T10:00:00.000Z",
  };

  function renderTranscript(
    overrides: Partial<Parameters<typeof ProfileCopilotTranscript>[0]> = {},
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <ProfileCopilotTranscript
          busy={false}
          emptyStateDescription="Ask a question."
          emptyStateTitle="What would you like to improve?"
          isPendingHere={false}
          messages={[savedQuestion]}
          onUsePrompt={vi.fn()}
          suggestedPrompts={[]}
          transcriptRef={createRef<HTMLDivElement>()}
          {...overrides}
        />,
      );
    });
    return container;
  }

  test("offers Ask again under a saved question that never got an answer", () => {
    // The app closed while the Assistant was working: the question was saved
    // first, and used to vanish with no way back but retyping it.
    const onAskAgain = vi.fn();
    const view = renderTranscript({ onAskAgain });

    const note = view.querySelector<HTMLElement>(
      '[data-profile-copilot-unanswered="true"]',
    );
    expect(note?.textContent).toContain(
      "No answer yet: the Assistant stopped before it replied.",
    );
    const askAgain = [...(note?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Ask again",
    );
    act(() => askAgain?.click());
    expect(onAskAgain).toHaveBeenCalledWith(
      "Change my headline to Principal Engineer.",
      { surface: "profile", section: "basics" },
    );
  });

  test("shows a failed request once, under its saved copy, with the reason", () => {
    const view = renderTranscript({
      failedRequest: {
        content: "Change my headline to Principal Engineer.",
        context: { surface: "profile", section: "basics" },
        message:
          "Could not get an answer from the Assistant. The writing assistant did not answer. Try again in a few minutes.",
      },
      onAskAgain: vi.fn(),
      onRetryFailedRequest: vi.fn(),
    });

    expect(
      view.querySelector('[data-profile-copilot-failed-turn="true"]'),
    ).toBeNull();
    expect(
      view.querySelector('[data-profile-copilot-unanswered="true"]')
        ?.textContent,
    ).toContain("The writing assistant did not answer.");
    expect(view.textContent?.match(/Change my headline/g)).toHaveLength(1);
  });

  test("says nothing about an answer while the Assistant is still working", () => {
    const pending = renderTranscript({ isPendingHere: true });
    expect(
      pending.querySelector('[data-profile-copilot-unanswered="true"]'),
    ).toBeNull();
    act(() => root?.unmount());
    container?.remove();

    const busy = renderTranscript({ busy: true });
    expect(
      busy.querySelector('[data-profile-copilot-unanswered="true"]'),
    ).toBeNull();
  });
});

describe("describePatchOperation compensation clear truth", () => {
  test.each([
    {
      name: "clear minimum only",
      value: {
        minimum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit" as const,
      },
      expected: "Clear compensation minimum",
      notExpected: "Set compensation to range",
    },
    {
      name: "clear maximum only",
      value: {
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit" as const,
      },
      expected: "Clear compensation maximum",
      notExpected: "Set compensation to range",
    },
    {
      name: "clear range (both bounds)",
      value: {
        minimum: null,
        maximum: null,
        interval: "year",
        currency: "USD",
        currencyStatus: "explicit" as const,
      },
      expected: "Clear compensation range",
      notExpected: "Set compensation to range",
    },
    {
      name: "clear minimum with maximum set",
      value: {
        minimum: null,
        maximum: 4000,
        interval: "month",
        currency: null,
        currencyStatus: "needs_clarification" as const,
      },
      expected: "Clear compensation minimum",
      notExpected: "Set compensation to range",
    },
  ])(
    "renders explicit clear wording for $name",
    async ({ value, expected, notExpected }) => {
      const { describePatchOperation } =
        await import("./profile-copilot-rail.shared");
      const operation = {
        operation: "replace_compensation_preferences_fields" as const,
        value,
      };
      const description = describePatchOperation(operation as never);
      expect(description).toContain(expected);
      expect(description).not.toContain(notExpected);
      expect(description).toContain("Clear");
    },
  );

  test("still renders range correctly for non-clear values", async () => {
    const { describePatchOperation } =
      await import("./profile-copilot-rail.shared");
    const description = describePatchOperation({
      operation: "replace_compensation_preferences_fields",
      value: {
        minimum: 3000,
        maximum: 4000,
        interval: "month",
        currency: null,
        currencyStatus: "needs_clarification",
      },
    } as never);
    expect(description).toContain(
      "Set minimum compensation to 3,000 and target compensation to 4,000",
    );
  });
});

describe("getProfileCopilotDisplayContent undone truth", () => {
  test("does not claim applied after revision undo — shows undone status", async () => {
    const { getProfileCopilotDisplayContent } =
      await import("./profile-copilot-rail.shared");
    const message = {
      id: "assistant_message_applied",
      role: "assistant" as const,
      content: "I prepared this change for your review. Nothing changed yet.",
      context: { surface: "profile" as const, section: "basics" as const },
      patchGroups: [
        {
          id: "patch_group_applied",
          summary: "Update headline",
          applyMode: "applied" as const,
          operations: [
            {
              operation: "replace_identity_fields" as const,
              value: { headline: "Senior Product Engineer" },
            },
          ],
          createdAt: "2026-04-15T16:00:00.000Z",
        },
      ],
      createdAt: "2026-04-15T16:00:00.000Z",
    };
    const revisions: Array<{
      id: string;
      createdAt: string;
      reason: string | null;
      trigger: "assistant_patch" | "undo";
      messageId: string | null;
      patchGroupId: string | null;
      restoredFromRevisionId: string | null;
    }> = [
      {
        id: "profile_revision_applied",
        createdAt: "2026-04-15T16:00:10.000Z",
        reason: "Assistant patch: Update headline",
        trigger: "assistant_patch",
        messageId: message.id,
        patchGroupId: "patch_group_applied",
        restoredFromRevisionId: null,
      },
      {
        id: "profile_revision_undo",
        createdAt: "2026-04-15T16:01:00.000Z",
        reason: "Undo: Assistant patch: Update headline",
        trigger: "undo",
        messageId: null,
        patchGroupId: null,
        restoredFromRevisionId: "profile_revision_applied",
      },
    ];

    const withoutRevisions = getProfileCopilotDisplayContent(message as never);
    expect(withoutRevisions).toContain("This change is applied");

    const withUndo = getProfileCopilotDisplayContent(
      message as never,
      revisions as never,
    );
    expect(withUndo).not.toContain("This change is applied");
    expect(withUndo).not.toContain("These changes are applied");
    expect(withUndo).toContain("undone");
    expect(withUndo).toContain("no longer applied");
  });

  test("handles indirect undo via timestamp — later patches reverted when undo targets earlier snapshot", async () => {
    const { getUndonePatchGroupIds } =
      await import("./profile-copilot-rail.shared");
    const revisions = [
      {
        id: "rev_a",
        createdAt: "2026-04-15T16:00:00.000Z",
        reason: "Assistant patch A",
        trigger: "assistant_patch" as const,
        messageId: "msg_a",
        patchGroupId: "patch_a",
        restoredFromRevisionId: null,
      },
      {
        id: "rev_b",
        createdAt: "2026-04-15T16:00:10.000Z",
        reason: "Assistant patch B",
        trigger: "assistant_patch" as const,
        messageId: "msg_b",
        patchGroupId: "patch_b",
        restoredFromRevisionId: null,
      },
      {
        id: "rev_undo_to_a",
        createdAt: "2026-04-15T16:00:20.000Z",
        reason: "Undo to A",
        trigger: "undo" as const,
        messageId: null,
        patchGroupId: null,
        restoredFromRevisionId: "rev_a",
      },
    ];
    const undone = getUndonePatchGroupIds(revisions as never);
    // rev_a is direct target, rev_b is after rev_a but before undo, so both should be undone
    expect(undone.has("patch_a")).toBe(true);
    expect(undone.has("patch_b")).toBe(true);
  });
});

describe("ProfileCopilotCollapsedBubble", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }

    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  test("uses native button activation semantics on the floating bubble", () => {
    const onClick = vi.fn();
    const onPointerCancel = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ProfileCopilotCollapsedBubble
          collapsedPreviewTitle="Continue this thread"
          isOpen={false}
          isPendingHere={false}
          messageCount={1}
          onClick={onClick}
          onPointerCancel={onPointerCancel}
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
        />,
      );
    });

    const button = container?.querySelector("button");
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      button?.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPointerCancel).toHaveBeenCalledTimes(1);
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button?.getAttribute("aria-label")).toBe(
      "the Assistant: Continue this thread",
    );
    expect(button?.className).toContain("size-12");
    expect(button?.getAttribute("title")).toBe(
      "the Assistant: Continue this thread",
    );
  });
});
