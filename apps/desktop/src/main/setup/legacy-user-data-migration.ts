import type { App } from "electron";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

/**
 * Nordri was called UnEmployed, and Live Assistant was called Interview
 * Helper (ADR 0040). Electron derives the default userData directory from the
 * app name, so the rename alone would open an empty workspace. This moves the
 * old directory and the old module file names once, before anything opens
 * them. It never merges into a directory that already holds data.
 */
const LEGACY_APP_NAMES: Readonly<Record<string, string>> = {
  // Development builds take their name from apps/desktop/package.json.
  "@nordri/desktop": "@unemployed/desktop",
  // Packaged builds take it from electron-builder's productName.
  Nordri: "UnEmployed",
};

const LEGACY_ENTRY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["interview-helper-workspace.json", "live-assistant-workspace.json"],
  ["interview-helper-screenshots", "live-assistant-screenshots"],
];

export type LegacyUserDataMigrationResult = {
  movedDirectory: { from: string; to: string } | null;
  renamedEntries: string[];
  skippedReason: "target-has-data" | null;
};

function isEmptyDirectory(directory: string): boolean {
  return statSync(directory).isDirectory() && readdirSync(directory).length === 0;
}

export function migrateLegacyDesktopUserData(
  app: Pick<App, "getName" | "getPath">,
  options: { configuredDirectory: string | null },
): LegacyUserDataMigrationResult {
  const result: LegacyUserDataMigrationResult = {
    movedDirectory: null,
    renamedEntries: [],
    skippedReason: null,
  };
  const target = app.getPath("userData");
  const legacyName = LEGACY_APP_NAMES[app.getName()];

  // Any overridden directory (NORDRI_USER_DATA_DIR, a --user-data-dir switch)
  // is an isolated session for tests or QA. It must never adopt the person's
  // real workspace, so only the name-derived default location migrates.
  const appData = app.getPath("appData");
  const usesDefaultLocation =
    !options.configuredDirectory &&
    path.resolve(target) === path.resolve(appData, app.getName());
  if (usesDefaultLocation && legacyName) {
    const legacy = path.join(appData, legacyName);
    if (legacy !== target && existsSync(legacy)) {
      if (!existsSync(target) || isEmptyDirectory(target)) {
        if (existsSync(target)) rmdirSync(target);
        mkdirSync(path.dirname(target), { recursive: true });
        renameSync(legacy, target);
        result.movedDirectory = { from: legacy, to: target };
        // Drop the now-empty "@unemployed" scope folder in development.
        const legacyParent = path.dirname(legacy);
        if (legacyParent !== appData && isEmptyDirectory(legacyParent)) {
          rmdirSync(legacyParent);
        }
      } else {
        result.skippedReason = "target-has-data";
      }
    }
  }

  if (existsSync(target)) {
    for (const [legacyEntry, entry] of LEGACY_ENTRY_NAMES) {
      const from = path.join(target, legacyEntry);
      const to = path.join(target, entry);
      if (existsSync(from) && !existsSync(to)) {
        renameSync(from, to);
        result.renamedEntries.push(entry);
      }
    }
  }

  return result;
}
