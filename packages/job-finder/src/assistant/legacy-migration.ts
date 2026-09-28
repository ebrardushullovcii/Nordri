import type {
  AssistantConversation,
  AssistantMessage,
  AssistantMessagePart,
  ProfileCopilotMessage,
  ResumeAssistantMessage,
} from "@unemployed/contracts";
import type { AssistantRepository } from "@unemployed/db";

/**
 * The two retired chats become archived conversations (plan §8).
 *
 * Additive and safe to repeat: every old message gets a migration identity,
 * so a retry never duplicates it. Proposals stay in their own stores and are
 * resolved through them, so an unresolved one is still actionable. Old user
 * messages are copied as history only; nothing is replayed as a command.
 */

export const PROFILE_ARCHIVE_CONVERSATION_ID = "assistant_archive_profile";
export const resumeArchiveConversationId = (jobId: string) =>
  `assistant_archive_resume_${jobId}`;

function profileParts(message: ProfileCopilotMessage): AssistantMessagePart[] {
  const parts: AssistantMessagePart[] = [
    { type: "text", text: message.content.slice(0, 40_000) },
  ];
  for (const group of message.patchGroups) {
    parts.push({
      type: "proposal",
      proposalId: `legacy_profile_${group.id}`,
      kind: "profile_operations",
      summary: group.summary.slice(0, 400),
      status:
        group.applyMode === "applied"
          ? "applied"
          : group.applyMode === "rejected"
            ? "rejected"
            : "pending",
      targetId: null,
      items: group.operations.slice(0, 30).map((operation, index) => ({
        id: `${group.id}_${index + 1}`,
        label: operation.operation.replaceAll("_", " ").slice(0, 400),
        detail: null,
      })),
      source: {
        store: "profile_copilot",
        legacyMessageId: message.id,
        patchGroupIds: [group.id],
      },
    });
  }
  return parts;
}

function resumeParts(message: ResumeAssistantMessage): AssistantMessagePart[] {
  const parts: AssistantMessagePart[] = [
    { type: "text", text: message.content.slice(0, 40_000) },
  ];
  if (message.role === "assistant" && message.patches.length > 0) {
    parts.push({
      type: "proposal",
      proposalId: `legacy_resume_${message.id}`,
      kind: "resume_patches",
      summary: `${message.patches.length} resume change${message.patches.length === 1 ? "" : "s"}`,
      status:
        message.proposalStatus === "accepted"
          ? "applied"
          : message.proposalStatus === "rejected"
            ? "rejected"
            : "pending",
      targetId: message.jobId,
      items: message.patches.slice(0, 30).map((patch) => ({
        id: patch.id,
        label:
          `${patch.operation.replaceAll("_", " ")}${patch.newText ? `: ${patch.newText.slice(0, 300)}` : ""}`.slice(
            0,
            400,
          ),
        detail: null,
      })),
      source: {
        store: "resume_assistant",
        legacyMessageId: message.id,
        patchGroupIds: [],
      },
    });
  }
  return parts;
}

async function ensureConversation(
  repository: AssistantRepository,
  conversation: AssistantConversation,
): Promise<void> {
  const existing = await repository.getConversation(conversation.id);
  if (!existing) await repository.upsertConversation(conversation);
}

async function migrateMessages(
  repository: AssistantRepository,
  conversation: AssistantConversation,
  messages: readonly {
    id: string;
    role: "user" | "assistant";
    createdAt: string;
    parts: AssistantMessagePart[];
  }[],
  source: "profile_copilot" | "resume_assistant",
): Promise<number> {
  let added = 0;
  let last: string | null = null;
  for (const legacy of messages) {
    last = legacy.createdAt;
    if (await repository.findMigratedMessage(source, legacy.id)) continue;
    const message: AssistantMessage = {
      id: `migrated_${source}_${legacy.id}`.slice(0, 200),
      conversationId: conversation.id,
      clientMessageId: null,
      role: legacy.role,
      origin: "migrated",
      parts: legacy.parts,
      turnId: null,
      context: null,
      contextResultSetIds: [],
      migratedFrom: { source, legacyId: legacy.id },
      createdAt: legacy.createdAt,
      updatedAt: null,
    };
    await repository.upsertMessage(message);
    added += 1;
  }
  if (added > 0) {
    const count = await repository.countMessages(conversation.id);
    await repository.upsertConversation({
      ...conversation,
      messageCount: count,
      lastMessageAt: last,
      updatedAt: last ?? conversation.updatedAt,
    });
  }
  return added;
}

export async function migrateLegacyChats(input: {
  repository: AssistantRepository;
  profileMessages: readonly ProfileCopilotMessage[];
  resumeMessagesByJob: ReadonlyMap<
    string,
    { jobTitle: string; messages: readonly ResumeAssistantMessage[] }
  >;
  now: string;
}): Promise<{ conversations: number; messages: number }> {
  let conversations = 0;
  let messages = 0;
  if (input.profileMessages.length > 0) {
    const first = input.profileMessages[0]!;
    const conversation: AssistantConversation = {
      id: PROFILE_ARCHIVE_CONVERSATION_ID,
      title: "Profile chat (archived)",
      status: "archived",
      source: "profile_copilot_archive",
      jobId: null,
      createdAt: first.createdAt,
      updatedAt: input.now,
      lastMessageAt: null,
      messageCount: 0,
    };
    await ensureConversation(input.repository, conversation);
    const current =
      (await input.repository.getConversation(conversation.id)) ?? conversation;
    const added = await migrateMessages(
      input.repository,
      current,
      input.profileMessages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        parts: profileParts(message),
      })),
      "profile_copilot",
    );
    conversations += 1;
    messages += added;
  }
  for (const [jobId, entry] of input.resumeMessagesByJob) {
    if (entry.messages.length === 0) continue;
    const conversation: AssistantConversation = {
      id: resumeArchiveConversationId(jobId),
      title: `Resume chat: ${entry.jobTitle}`.slice(0, 160),
      status: "archived",
      source: "resume_assistant_archive",
      jobId,
      createdAt: entry.messages[0]!.createdAt,
      updatedAt: input.now,
      lastMessageAt: null,
      messageCount: 0,
    };
    await ensureConversation(input.repository, conversation);
    const current =
      (await input.repository.getConversation(conversation.id)) ?? conversation;
    const added = await migrateMessages(
      input.repository,
      current,
      entry.messages.map((message) => ({
        id: message.id,
        role: message.role,
        createdAt: message.createdAt,
        parts: resumeParts(message),
      })),
      "resume_assistant",
    );
    conversations += 1;
    messages += added;
  }
  return { conversations, messages };
}
