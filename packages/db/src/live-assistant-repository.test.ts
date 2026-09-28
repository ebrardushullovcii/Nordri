import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createFileLiveAssistantRepository } from "./live-assistant-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function overlay(surfaceKind: string) {
  return {
    surfaceKind,
    mode: "compact",
    visible: false,
    interactionMode: false,
    opacity: 0.9,
    protectionState: "unknown",
    statusLabel: "Waiting",
  };
}

describe("createFileLiveAssistantRepository", () => {
  test("loads a workspace saved before the Live Assistant rename", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nordri-live-assistant-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "live-assistant-workspace.json");
    await writeFile(
      filePath,
      JSON.stringify({
        module: "interview-helper",
        generatedAt: "2026-09-01T10:00:00.000Z",
        setup: {},
        answerOverlay: overlay("live_answer_overlay"),
        transcriptOverlay: overlay("live_transcript_overlay"),
      }),
      "utf8",
    );

    const snapshot = await createFileLiveAssistantRepository({ filePath }).load();

    expect(snapshot?.module).toBe("live-assistant");
    expect(snapshot?.generatedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  test("returns null when nothing was saved yet", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nordri-live-assistant-"));
    temporaryDirectories.push(directory);

    await expect(
      createFileLiveAssistantRepository({
        filePath: path.join(directory, "live-assistant-workspace.json"),
      }).load(),
    ).resolves.toBeNull();
  });
});
