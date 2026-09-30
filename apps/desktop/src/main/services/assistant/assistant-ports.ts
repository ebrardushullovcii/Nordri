import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";
import type { CandidateAsset } from "@nordri/contracts";
import type { AssistantHostPorts } from "@nordri/job-finder";

import { extractResumeDocument } from "../../adapters/resume-document";
import {
  approveApplicationResumes,
  listJobsStillReadyToSend,
  scopeSendPermissionToPreparedJobs,
  syncApplicationAuthorityForSavedMode,
} from "../../routes/job-finder";
import { getEmbeddedBrowser } from "../browser/embedded-browser";
import { getCandidateAssetLibrary } from "../job-finder/candidate-asset-library-instance";
import { getJobFinderRepositoryForWorkspaceService } from "../job-finder/create-workspace-service";
import { importResumeFromSourcePath } from "../job-finder/import-resume";
import { getJobFinderUserDataDirectory } from "../job-finder/paths";
import {
  listJobsNotInProgress,
  startApplyBatch,
} from "../job-finder/start-apply-batch";
import { isDesktopTestApiEnabled } from "../job-finder/test-api";
import { publishJobFinderWorkspaceUpdate } from "../job-finder/workspace-updates";
import { getJobFinderWorkspaceService } from "../job-finder/workspace-service";
import { createAssistantBrowserPort } from "./assistant-browser-port";
import { waitForAssistantResumeImport } from "./resume-import-completion";
import { writeExportFile } from "./tracker-export-file";

/**
 * The assistant's host ports, implemented with the exact functions the IPC
 * routes use, so a request in the sidebar and a button press take one path:
 * the same resume approval, the same task-scoped sending authority, the same
 * batch start, the same serialized send.
 */

const SEARCH_START_TIMEOUT_MS = 20_000;

async function waitFor<T>(
  read: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function withTempCopy<T>(
  asset: CandidateAsset,
  bytes: Uint8Array,
  use: (filePath: string) => Promise<T>,
): Promise<T> {
  const directory = path.join(
    getJobFinderUserDataDirectory(),
    "tmp",
    "assistant",
  );
  await mkdir(directory, { recursive: true });
  const filePath = path.join(
    directory,
    `${Date.now()}_${path.basename(asset.originalName)}`,
  );
  await writeFile(filePath, bytes, { mode: 0o600 });
  try {
    return await use(filePath);
  } finally {
    await rm(filePath, { force: true });
  }
}

export function createAssistantHostPorts(input: {
  browserHost: "embedded" | "external";
}): AssistantHostPorts {
  const library = getCandidateAssetLibrary();
  const ports: AssistantHostPorts = {
    async startSearch({ searchRequest, targetId }) {
      const service = await getJobFinderWorkspaceService();
      const before = await service.getWorkspaceSnapshot();
      if (before.activeDiscoveryRun?.state === "running") {
        return {
          runId: before.activeDiscoveryRun.id,
          message: "A search is already running.",
        };
      }
      const startedAt = new Date().toISOString();
      let failure: unknown = null;
      let settled = false;
      void service
        .runAgentDiscovery(
          () => publishJobFinderWorkspaceUpdate(),
          undefined,
          targetId ?? undefined,
          searchRequest,
        )
        .then(
          () => {
            settled = true;
          },
          (error: unknown) => {
            settled = true;
            failure = error;
          },
        )
        .finally(() => publishJobFinderWorkspaceUpdate());
      const runId = await waitFor(async () => {
        const snapshot = await service.getWorkspaceSnapshot();
        const run =
          snapshot.activeDiscoveryRun ??
          snapshot.recentDiscoveryRuns.find(
            (entry) => entry.startedAt >= startedAt,
          ) ??
          null;
        if (run && run.startedAt >= startedAt.slice(0, 19)) return run.id;
        if (settled)
          return failure ? "" : (snapshot.recentDiscoveryRuns[0]?.id ?? "");
        return null;
      }, SEARCH_START_TIMEOUT_MS);
      if (!runId) {
        return {
          runId: null,
          message:
            failure instanceof Error
              ? failure.message
              : "The search did not start. Check that at least one job source is on.",
        };
      }
      return { runId, message: "The search started." };
    },
    async cancelSearch(runId) {
      const service = await getJobFinderWorkspaceService();
      await service.cancelDiscoveryRun(runId);
      publishJobFinderWorkspaceUpdate();
    },
    async startApplications({ jobIds, mode }) {
      const service = await getJobFinderWorkspaceService();
      const repository = getJobFinderRepositoryForWorkspaceService(service);
      if (!repository) {
        throw new Error(
          "The application workspace is not open, so nothing was started.",
        );
      }
      const pending = await listJobsNotInProgress(repository, jobIds);
      if (pending.length === 0) {
        return { startedJobIds: [], heldBack: [], runId: null };
      }
      const heldBack = await approveApplicationResumes(service, pending, {
        holdBackResumesAwaitingPerson: true,
      });
      const held = new Set(heldBack.map((entry) => entry.jobId));
      const ids = pending.filter((jobId) => !held.has(jobId));
      if (ids.length === 0) return { startedJobIds: [], heldBack, runId: null };
      await syncApplicationAuthorityForSavedMode(service, ids, mode);
      const knownRunIds = new Set(
        (await repository.listApplyRuns()).map((run) => run.id),
      );
      const { startedJobIds } = await startApplyBatch({
        service,
        runs: repository,
        jobIds: ids,
        applicationAutomationMode: mode,
        onBackgroundSettled: () => publishJobFinderWorkspaceUpdate(),
      });
      publishJobFinderWorkspaceUpdate();
      const run = (await repository.listApplyRuns()).find(
        (candidate) =>
          !knownRunIds.has(candidate.id) &&
          candidate.jobIds.some((jobId) => startedJobIds.includes(jobId)),
      );
      return { startedJobIds, heldBack, runId: run?.id ?? null };
    },
    async sendPreparedApplications({ jobIds }) {
      const service = await getJobFinderWorkspaceService();
      const ready = await listJobsStillReadyToSend(service, jobIds);
      const failed: { jobId: string; reason: string }[] = jobIds
        .filter((jobId) => !ready.includes(jobId))
        .map((jobId) => ({
          jobId,
          reason: "This application is not filled in and waiting to be sent.",
        }));
      if (ready.length === 0) return { sentJobIds: [], failed };
      // The written instruction is the send press (ADR 0039).
      await scopeSendPermissionToPreparedJobs(
        service,
        ready,
        "confirm_before_submit",
      );
      const sentJobIds: string[] = [];
      for (const jobId of ready) {
        try {
          const snapshot = await service.submitPreparedApplication(jobId);
          const latest = snapshot.applyJobResults
            .filter((result) => result.jobId === jobId)
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt),
            )[0];
          if (latest?.state === "submitted") sentJobIds.push(jobId);
          else {
            failed.push({
              jobId,
              reason:
                latest?.privacyReceipt?.submissionOutcome?.outcome ===
                "outcome_uncertain"
                  ? "The site did not confirm the application; check it on the employer's page before trying again."
                  : (latest?.blockerSummary ??
                    "The site did not confirm the application."),
            });
          }
        } catch (error) {
          failed.push({
            jobId,
            reason:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "It could not be sent.",
          });
        } finally {
          publishJobFinderWorkspaceUpdate();
        }
      }
      return { sentJobIds, failed };
    },
    async checkSource(targetId) {
      const service = await getJobFinderWorkspaceService();
      await service.runSourceDebug(targetId, undefined, () =>
        publishJobFinderWorkspaceUpdate(),
      );
      publishJobFinderWorkspaceUpdate();
    },
    async listDocuments() {
      return (await library.list({ includeDeleted: false })).assets;
    },
    async readDocumentText(documentId) {
      const resolved = await library.resolveForApplication(documentId);
      const bytes = await resolved.loadVerifiedBytes();
      if (resolved.asset.mime.startsWith("text/")) {
        return new TextDecoder().decode(bytes);
      }
      return withTempCopy(resolved.asset, bytes, async (filePath) => {
        const extracted = await extractResumeDocument(filePath, {
          bundleId: `assistant_read_${Date.now()}`,
          runId: `assistant_read_${Date.now()}`,
          sourceResumeId: documentId,
        });
        return extracted.textContent;
      });
    },
    async loadDocumentFile(documentId) {
      const resolved = await library.resolveForApplication(documentId);
      return {
        name: resolved.asset.originalName,
        mimeType: resolved.asset.mime,
        bytes: await resolved.loadVerifiedBytes(),
      };
    },
    async importResumeDocument(documentId, options) {
      options?.signal?.throwIfAborted();
      const service = await getJobFinderWorkspaceService();
      const resolved = await library.resolveForApplication(documentId);
      const bytes = await resolved.loadVerifiedBytes();
      options?.signal?.throwIfAborted();
      const imported = await withTempCopy(resolved.asset, bytes, (filePath) =>
        importResumeFromSourcePath(filePath, {
          fileName: resolved.asset.originalName,
          useVision: !isDesktopTestApiEnabled(),
        }),
      );
      try {
        await waitForAssistantResumeImport(service, imported, options);
      } finally {
        publishJobFinderWorkspaceUpdate();
      }
    },
    async exportTracker(format) {
      const service = await getJobFinderWorkspaceService();
      const result = await service.exportApplicationCrm({
        format,
        applicationRecordIds: [],
      });
      // From chat no save dialog can be answered, so the export goes to
      // Downloads (a folder inside the app's data in test runs, so tests
      // never write into the person's own folders) and the path is reported.
      const directory = isDesktopTestApiEnabled()
        ? path.join(getJobFinderUserDataDirectory(), "exports")
        : app.getPath("downloads");
      return writeExportFile({
        directory,
        fileName: result.fileName,
        content: result.content,
      });
    },
    publishWorkspaceUpdate: () => publishJobFinderWorkspaceUpdate(),
  };
  if (input.browserHost === "embedded") {
    ports.browser = createAssistantBrowserPort(getEmbeddedBrowser());
  }
  return ports;
}
