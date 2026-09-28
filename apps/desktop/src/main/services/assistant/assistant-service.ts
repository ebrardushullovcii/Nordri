import { existsSync } from "node:fs";
import path from "node:path";

import { BrowserWindow } from "electron";
import { resolveAssistantModelRouteFromEnvironment } from "@unemployed/ai-providers";
import type { AssistantEvent } from "@unemployed/contracts";
import {
  createAssistantRepository,
  type AssistantRepository,
} from "@unemployed/db";
import {
  AssistantSessionHost,
  createAssistantModelHandle,
  createScriptedAssistantModelHandle,
  type AssistantModelResolution,
} from "@unemployed/job-finder";

import { getJobFinderUserDataDirectory } from "../job-finder/paths";
import { isDesktopTestApiEnabled } from "../job-finder/test-api";
import { onJobFinderWorkspaceUpdate } from "../job-finder/workspace-updates";
import { getJobFinderWorkspaceService } from "../job-finder/workspace-service";
import { createAssistantHostPorts } from "./assistant-ports";

/**
 * The assistant session host lives in the main process for the life of the
 * app (ADR 0037), with its own store beside the workspace database.
 */

export const ASSISTANT_EVENT_CHANNEL = "job-finder:assistant:event";

let hostPromise: Promise<AssistantSessionHost> | null = null;
let repository: AssistantRepository | null = null;
let unsubscribeWorkspaceUpdates: (() => void) | null = null;

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function resolveAssistantModel(
  env: NodeJS.ProcessEnv = process.env,
): AssistantModelResolution {
  // Test builds without live AI get the deterministic stand-in, the same
  // rule the rest of Job Finder follows (see create-workspace-service).
  if (
    isDesktopTestApiEnabled(env) &&
    !isEnabled(env.UNEMPLOYED_TEST_API_USE_LIVE_AI)
  ) {
    const delay = Number.parseInt(
      env.UNEMPLOYED_TEST_ASSISTANT_DELAY_MS ?? "",
      10,
    );
    return {
      kind: "ready",
      handle: createScriptedAssistantModelHandle(
        Number.isFinite(delay) && delay > 0 ? { delayMs: delay } : {},
      ),
    };
  }
  const resolution = resolveAssistantModelRouteFromEnvironment(env);
  if (!resolution.available) {
    return { kind: "unavailable", detail: resolution.detail };
  }
  return {
    kind: "ready",
    handle: createAssistantModelHandle(resolution.route, resolution.fallback),
  };
}

function publish(event: AssistantEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(ASSISTANT_EVENT_CHANNEL, event);
    }
  }
}

function browserHost(env: NodeJS.ProcessEnv): "embedded" | "external" {
  const testApi = isDesktopTestApiEnabled(env);
  return env.UNEMPLOYED_BROWSER_HOST !== "external" &&
    (!testApi || env.UNEMPLOYED_BROWSER_HOST === "embedded")
    ? "embedded"
    : "external";
}

export function getAssistantHost(): Promise<AssistantSessionHost> {
  hostPromise ??= (async () => {
    const service = await getJobFinderWorkspaceService();
    repository ??= createAssistantRepository({
      filePath: path.join(getJobFinderUserDataDirectory(), "assistant.sqlite"),
    });
    const host = new AssistantSessionHost({
      repository,
      service,
      ports: createAssistantHostPorts({
        browserHost: browserHost(process.env),
      }),
      resolveModel: () => resolveAssistantModel(process.env),
      publish,
      stallAfterMs: 25_000,
    });
    unsubscribeWorkspaceUpdates?.();
    unsubscribeWorkspaceUpdates = onJobFinderWorkspaceUpdate(() =>
      host.notifyWorkspaceChanged(),
    );
    await host.recover().catch((error: unknown) => {
      console.warn("[assistant] Recovery after restart failed", error);
    });
    // The two old chats become archived conversations; safe to repeat.
    void host.migrateLegacyHistory().catch((error: unknown) => {
      console.warn(
        "[assistant] Moving the old chats into the history failed",
        error,
      );
    });
    return host;
  })();
  const created = hostPromise;
  void created.catch(() => {
    if (hostPromise === created) hostPromise = null;
  });
  return created;
}

export async function shutdownAssistantHost(): Promise<void> {
  const current = hostPromise;
  hostPromise = null;
  unsubscribeWorkspaceUpdates?.();
  unsubscribeWorkspaceUpdates = null;
  if (current) {
    const host = await current.catch(() => null);
    await host?.shutdown().catch(() => undefined);
  }
  await repository?.close().catch(() => undefined);
  repository = null;
}

/** Workspace reset clears the assistant's store too. */
export async function resetAssistantStore(): Promise<void> {
  const current = hostPromise;
  hostPromise = null;
  if (current) {
    const host = await current.catch(() => null);
    await host?.shutdown().catch(() => undefined);
  }
  if (!repository) {
    const filePath = path.join(
      getJobFinderUserDataDirectory(),
      "assistant.sqlite",
    );
    // Nothing was ever stored: nothing to clear.
    if (!existsSync(filePath)) return;
    repository = createAssistantRepository({ filePath });
  }
  await repository.reset();
}
