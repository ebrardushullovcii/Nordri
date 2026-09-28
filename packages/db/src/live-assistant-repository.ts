import {
  InterviewWorkspaceSnapshotSchema,
  type InterviewWorkspaceSnapshot,
} from "@nordri/contracts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LiveAssistantRepository {
  load(): Promise<InterviewWorkspaceSnapshot | null>;
  save(snapshot: InterviewWorkspaceSnapshot): Promise<void>;
  close(): Promise<void>;
}

export interface FileLiveAssistantRepositoryOptions {
  filePath: string;
}

// Snapshots saved before the rename (ADR 0040) name the module
// "interview-helper".
function withCurrentModuleName(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "module" in value &&
    value.module === "interview-helper"
  ) {
    return { ...value, module: "live-assistant" };
  }
  return value;
}

export function createFileLiveAssistantRepository(
  options: FileLiveAssistantRepositoryOptions,
): LiveAssistantRepository {
  return {
    async load() {
      try {
        const raw = await readFile(options.filePath, "utf8");
        return InterviewWorkspaceSnapshotSchema.parse(
          withCurrentModuleName(JSON.parse(raw) as unknown),
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }

        throw error;
      }
    },
    async save(snapshot) {
      const normalizedSnapshot = InterviewWorkspaceSnapshotSchema.parse(
        snapshot,
      );
      await mkdir(path.dirname(options.filePath), { recursive: true });
      await writeFile(
        options.filePath,
        `${JSON.stringify(normalizedSnapshot, null, 2)}\n`,
        "utf8",
      );
    },
    close() {
      return Promise.resolve();
    },
  };
}
