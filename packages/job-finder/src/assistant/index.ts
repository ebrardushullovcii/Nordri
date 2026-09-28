export {
  AssistantSessionHost,
  type AssistantModelHandle,
  type AssistantModelResolution,
  type AssistantSessionHostOptions,
} from "./session-host";
export type {
  AssistantBrowserLease,
  AssistantBrowserPort,
  AssistantHostPorts,
} from "./ports";
export {
  createAssistantModelHandle,
  createScriptedAssistantModelHandle,
} from "./model-handle";
export { createScriptedAssistantModel } from "./scripted-model";
export {
  ACTION_INVENTORY,
  SERVICE_METHOD_COVERAGE,
  type ActionInventoryEntry,
} from "./action-inventory";
export {
  buildAssistantToolCatalog,
  listAllAssistantToolNames,
  type AssistantCatalogMode,
} from "./tools";
export { decideUnderGrants, checkGrantTargets, narrowGrant } from "./grants";
export { diffValues, undoChangeEntries } from "./change-diff";
export {
  PROFILE_ARCHIVE_CONVERSATION_ID,
  migrateLegacyChats,
} from "./legacy-migration";
