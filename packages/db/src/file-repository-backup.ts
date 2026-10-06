import { chmod, copyFile, rename, rm, stat } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

import { openDatabaseFile } from "./internal/migrations";

export type WorkspaceDatabaseBackupStatus =
  | { status: "created"; backupPath: string }
  | { status: "skipped"; backupPath: string; reason: unknown };

export interface WorkspaceDatabaseBackupPaths {
  /**
   * Newest database-only snapshot written on graceful close. Rotated into
   * `closeBackupPreviousPath` on every successful close snapshot.
   */
  closeBackupPath: string;
  /** Previous graceful-close generation, preserved against bad overwrites. */
  closeBackupPreviousPath: string;
  closeTemporaryPath: string;
  /**
   * Database-only snapshot taken immediately before a destructive full-state
   * reset. Removed along with all older backups when the reset succeeds.
   */
  resetBackupPath: string;
  resetTemporaryPath: string;
}

export function getWorkspaceDatabaseBackupPaths(
  filePath: string,
): WorkspaceDatabaseBackupPaths {
  return {
    closeBackupPath: `${filePath}.backup`,
    closeBackupPreviousPath: `${filePath}.backup.prev`,
    closeTemporaryPath: `${filePath}.backup.tmp`,
    resetBackupPath: `${filePath}.reset-backup`,
    resetTemporaryPath: `${filePath}.reset-backup.tmp`,
  };
}

/**
 * All snapshots produced here are DATABASE-ONLY recovery points. They never
 * include generated resume documents, candidate assets, application
 * documents, or browser profile data, so they cannot restore the full
 * workspace after a destructive reset deletes those directories. They exist
 * solely to recover the SQLite workspace database itself.
 *
 * Snapshot writers never throw: persistence callers treat backup failures
 * as non-fatal and must still close or reset the workspace afterwards.
 */

async function writeSnapshot(
  input: { database: DatabaseSync },
  temporaryPath: string,
): Promise<void> {
  // A previous attempt may have been killed between VACUUM INTO and the
  // final rename. VACUUM INTO requires a nonexistent destination file.
  await rm(temporaryPath, { force: true });
  input.database.prepare("VACUUM INTO ?").run(temporaryPath);
  if (process.platform !== "win32") {
    // Match secureDatabaseFile permissions so private profile, resume,
    // and application data never become group/world readable.
    await chmod(temporaryPath, 0o600);
  }
}

/**
 * Writes the rotating graceful-close snapshot. On success the prior
 * `<filePath>.backup` generation is preserved as `<filePath>.backup.prev`
 * so one anomalous empty or damaged session cannot destroy the last known
 * good copy.
 */
export async function createWorkspaceCloseDatabaseBackup(input: {
  database: DatabaseSync;
  filePath: string;
}): Promise<WorkspaceDatabaseBackupStatus> {
  const { closeBackupPath, closeBackupPreviousPath, closeTemporaryPath } =
    getWorkspaceDatabaseBackupPaths(input.filePath);

  try {
    await writeSnapshot(input, closeTemporaryPath);
    await rename(closeBackupPath, closeBackupPreviousPath).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    await rename(closeTemporaryPath, closeBackupPath);
    return { status: "created", backupPath: closeBackupPath };
  } catch (error) {
    await rm(closeTemporaryPath, { force: true }).catch(() => undefined);
    return { status: "skipped", backupPath: closeBackupPath, reason: error };
  }
}

/**
 * Writes the pre-reset snapshot to the dedicated `<filePath>.reset-backup`
 * destination. It is retained only while the reset is in progress or has failed.
 */
export async function createWorkspaceResetDatabaseBackup(input: {
  database: DatabaseSync;
  filePath: string;
}): Promise<WorkspaceDatabaseBackupStatus> {
  const { resetBackupPath, resetTemporaryPath } =
    getWorkspaceDatabaseBackupPaths(input.filePath);

  try {
    await writeSnapshot(input, resetTemporaryPath);
    await rename(resetTemporaryPath, resetBackupPath);
    return { status: "created", backupPath: resetBackupPath };
  } catch (error) {
    await rm(resetTemporaryPath, { force: true }).catch(() => undefined);
    return { status: "skipped", backupPath: resetBackupPath, reason: error };
  }
}

/** Remove every managed snapshot after a successful destructive reset.
 * Failures propagate so callers cannot report permanent deletion prematurely.
 */
export async function removeWorkspaceDatabaseBackups(
  filePath: string,
): Promise<void> {
  for (const snapshotPath of Object.values({
    ...getWorkspaceDatabaseBackupPaths(filePath),
  })) {
    for (const suffix of ["", "-wal", "-shm"]) {
      await rm(`${snapshotPath}${suffix}`, { force: true });
    }
  }
}

export type WorkspaceBackupReconciliationAction =
  | {
      code: "promoted-temporary-backup";
      sourcePath: string;
      targetPath: string;
    }
  | {
      code: "restored-backup-from-previous-generation";
      sourcePath: string;
      targetPath: string;
    }
  | { code: "removed-stale-temporary-backup"; path: string };

export type WorkspaceBackupReconciliationWarning =
  | { code: "invalid-temporary-backup-retained"; path: string; reason: unknown }
  | { code: "invalid-primary-backup-retained"; path: string; reason: unknown }
  | {
      code: "invalid-previous-generation-retained";
      path: string;
      reason: unknown;
    }
  | {
      code: "reconciliation-operation-failed";
      path: string;
      reason: unknown;
    };

export interface WorkspaceBackupReconciliationResult {
  readonly actions: ReadonlyArray<WorkspaceBackupReconciliationAction>;
  readonly warnings: ReadonlyArray<WorkspaceBackupReconciliationWarning>;
}

type SqliteSnapshotValidation =
  | { valid: true }
  | { valid: false; reason: unknown };

function validateSqliteSnapshot(
  candidatePath: string,
): SqliteSnapshotValidation {
  let candidate: DatabaseSync;
  try {
    candidate = openDatabaseFile(candidatePath, { readOnly: true });
  } catch (error) {
    return { valid: false, reason: error };
  }
  try {
    const check = candidate.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: unknown }
      | undefined;
    if (check?.integrity_check !== "ok") {
      return {
        valid: false,
        reason: new Error(
          `integrity_check reported ${String(check?.integrity_check)}`,
        ),
      };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: error };
  } finally {
    candidate.close();
  }
}

async function snapshotFileExists(candidatePath: string): Promise<boolean> {
  try {
    await stat(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function secureSnapshotFile(snapshotPath: string): Promise<void> {
  if (process.platform === "win32") {
    return Promise.resolve();
  }
  // Match writeSnapshot permissions so promoted or restored snapshots never
  // become group/world readable.
  return chmod(snapshotPath, 0o600).catch(() => undefined);
}

async function reconcileTemporarySnapshotRotation(input: {
  backupPath: string;
  temporaryPath: string;
  actions: WorkspaceBackupReconciliationAction[];
  warnings: WorkspaceBackupReconciliationWarning[];
}): Promise<void> {
  const { backupPath, temporaryPath } = input;

  if (!(await snapshotFileExists(temporaryPath))) return;

  if (!(await snapshotFileExists(backupPath))) {
    const validation = validateSqliteSnapshot(temporaryPath);
    if (!validation.valid) {
      input.warnings.push({
        code: "invalid-temporary-backup-retained",
        path: temporaryPath,
        reason: validation.reason,
      });
      return;
    }
    await rename(temporaryPath, backupPath);
    await secureSnapshotFile(backupPath);
    input.actions.push({
      code: "promoted-temporary-backup",
      sourcePath: temporaryPath,
      targetPath: backupPath,
    });
    return;
  }

  // The stale temporary is only removable while the primary it would
  // duplicate still validates; an unusable primary means the temporary may
  // be the last recoverable copy and must be retained.
  const primaryValidation = validateSqliteSnapshot(backupPath);
  if (!primaryValidation.valid) {
    input.warnings.push({
      code: "invalid-primary-backup-retained",
      path: backupPath,
      reason: primaryValidation.reason,
    });
    return;
  }
  await rm(temporaryPath, { force: true });
  input.actions.push({
    code: "removed-stale-temporary-backup",
    path: temporaryPath,
  });
}

async function reconcilePreviousGenerationFallback(input: {
  backupPath: string;
  previousPath: string;
  temporaryPath: string;
  actions: WorkspaceBackupReconciliationAction[];
  warnings: WorkspaceBackupReconciliationWarning[];
}): Promise<void> {
  const { backupPath, previousPath } = input;

  if (await snapshotFileExists(backupPath)) return;
  if (await snapshotFileExists(input.temporaryPath)) return;
  if (!(await snapshotFileExists(previousPath))) return;

  const validation = validateSqliteSnapshot(previousPath);
  if (!validation.valid) {
    input.warnings.push({
      code: "invalid-previous-generation-retained",
      path: previousPath,
      reason: validation.reason,
    });
    return;
  }
  await copyFile(previousPath, backupPath);
  await secureSnapshotFile(backupPath);
  input.actions.push({
    code: "restored-backup-from-previous-generation",
    sourcePath: previousPath,
    targetPath: backupPath,
  });
}

/**
 * Recovers graceful-close and pre-reset snapshot destinations after a
 * process was killed between the renames of a rotation. Candidates are only
 * promoted, copied, or removed once they validate as readable SQLite files;
 * anything invalid is retained in place and reported as a warning so callers
 * can emit telemetry. Healthy workspaces reconcile to a no-op, making the
 * call safe on every startup.
 */
export async function reconcileWorkspaceBackupRotation(
  filePath: string,
): Promise<WorkspaceBackupReconciliationResult> {
  const {
    closeBackupPath,
    closeBackupPreviousPath,
    closeTemporaryPath,
    resetBackupPath,
    resetTemporaryPath,
  } = getWorkspaceDatabaseBackupPaths(filePath);

  const actions: WorkspaceBackupReconciliationAction[] = [];
  const warnings: WorkspaceBackupReconciliationWarning[] = [];

  async function runStep(step: () => Promise<void>, reportedPath: string) {
    try {
      await step();
    } catch (error) {
      warnings.push({
        code: "reconciliation-operation-failed",
        path: reportedPath,
        reason: error,
      });
    }
  }

  await runStep(async () => {
    await reconcileTemporarySnapshotRotation({
      backupPath: closeBackupPath,
      temporaryPath: closeTemporaryPath,
      actions,
      warnings,
    });
    await reconcilePreviousGenerationFallback({
      backupPath: closeBackupPath,
      previousPath: closeBackupPreviousPath,
      temporaryPath: closeTemporaryPath,
      actions,
      warnings,
    });
  }, closeBackupPath);

  await runStep(async () => {
    await reconcileTemporarySnapshotRotation({
      backupPath: resetBackupPath,
      temporaryPath: resetTemporaryPath,
      actions,
      warnings,
    });
  }, resetBackupPath);

  return { actions, warnings };
}
