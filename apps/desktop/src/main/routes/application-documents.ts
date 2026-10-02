import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog } from "electron";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  ApplicationDocumentExportResultSchema,
  ApplicationDocumentListResultSchema,
  ApplicationDocumentRevisionSchema,
  ApproveApplicationDocumentInputSchema,
  ExportApplicationDocumentInputSchema,
  EditApplicationDocumentInputSchema,
  ListApplicationDocumentsInputSchema,
  ProposeApplicationDocumentInputSchema,
  type ApplyRunDetails,
  type ApplicationQuestionRecord,
  type JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";
import {
  ApplicationDocumentLibraryError,
  type ApplicationDocumentLibrary,
} from "../services/job-finder/application-document-library";
import { getApplicationDocumentLibrary } from "../services/job-finder/application-document-library-instance";
import { getJobFinderWorkspaceService } from "../services/job-finder";

interface ApplicationDocumentRouteDependencies {
  library: ApplicationDocumentLibrary;
  getWorkspaceSnapshot: () => Promise<JobFinderWorkspaceSnapshot>;
  getApplyRunDetails: (
    runId: string,
    jobId: string,
    applicationRecordId: string,
  ) => Promise<ApplyRunDetails>;
  selectExportPath: (
    event: IpcMainInvokeEvent,
    defaultFileName: string,
  ) => Promise<string | null>;
  /** Model-written draft text; null keeps the evidence-built draft. */
  writeDocumentText?: (input: {
    jobId: string;
    kind: "cover_letter" | "short_response";
    questionPrompt: string | null;
    priorText: string | null;
  }) => Promise<string | null>;
}

async function selectExportPath(
  event: IpcMainInvokeEvent,
  defaultFileName: string,
) {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options = {
    title: "Export application document",
    defaultPath: defaultFileName,
    filters: [{ name: "Text document", extensions: ["txt"] }],
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled ? null : (result.filePath ?? null);
}

function wrapStorageError(error: unknown): never {
  if (error instanceof ApplicationDocumentLibraryError) throw error;
  throw new ApplicationDocumentLibraryError(
    "The application document operation could not be completed.",
  );
}

export function registerApplicationDocumentRouteHandlers(
  ipcMain: IpcMain,
  dependencies: ApplicationDocumentRouteDependencies = {
    library: getApplicationDocumentLibrary(),
    getWorkspaceSnapshot: async () => {
      const workspace = await getJobFinderWorkspaceService();
      return workspace.getWorkspaceSnapshot();
    },
    getApplyRunDetails: async (runId, jobId, applicationRecordId) => {
      const workspace = await getJobFinderWorkspaceService();
      return workspace.getApplyRunDetails(runId, jobId, applicationRecordId);
    },
    selectExportPath,
    writeDocumentText: async (input) => {
      const workspace = await getJobFinderWorkspaceService();
      return workspace.writeApplicationDocumentText(input);
    },
  },
) {
  ipcMain.handle(
    "job-finder:list-application-documents",
    async (_event, payload) => {
      try {
        const input = ListApplicationDocumentsInputSchema.parse(payload);
        return ApplicationDocumentListResultSchema.parse(
          await dependencies.library.list(input),
        );
      } catch (error) {
        return wrapStorageError(error);
      }
    },
  );

  ipcMain.handle(
    "job-finder:propose-application-document",
    async (_event, payload) => {
      try {
        const input = ProposeApplicationDocumentInputSchema.parse(payload);
        const snapshot = await dependencies.getWorkspaceSnapshot();
        const job = snapshot.discoveryJobs.find(
          (entry) => entry.id === input.jobId,
        );
        const applicationRecord = snapshot.applicationRecords.find(
          (entry) => entry.id === input.applicationRecordId,
        );
        if (!job || !applicationRecord || applicationRecord.jobId !== job.id) {
          throw new ApplicationDocumentLibraryError(
            "The selected application no longer matches this job.",
          );
        }
        let question: ApplicationQuestionRecord | null = null;
        if (input.question) {
          const details = await dependencies.getApplyRunDetails(
            input.question.runId,
            job.id,
            applicationRecord.id,
          );
          const result = details.result;
          const hasExactRunResultLineage =
            details.run.id === input.question.runId &&
            details.run.jobIds.includes(job.id) &&
            result?.runId === input.question.runId &&
            result.jobId === job.id &&
            result.applicationRecordId === applicationRecord.id;
          question = hasExactRunResultLineage
            ? (details.questionRecords.find(
                (entry) =>
                  entry.id === input.question?.questionId &&
                  entry.runId === input.question.runId &&
                  entry.jobId === job.id &&
                  entry.applicationRecordId === applicationRecord.id &&
                  entry.resultId === result?.id,
              ) ?? null)
            : null;
          if (!question) {
            throw new ApplicationDocumentLibraryError(
              "The selected attachment question is stale or belongs to another application.",
            );
          }
        }
        const priorText = input.documentId
          ? ((
              await dependencies.library.list({
                jobId: job.id,
                applicationRecordId: applicationRecord.id,
              })
            ).documents.find((entry) => entry.id === input.documentId)
              ?.content ?? null)
          : null;
        const writtenContent = dependencies.writeDocumentText
          ? await dependencies
              .writeDocumentText({
                jobId: job.id,
                kind: input.kind,
                questionPrompt: question?.prompt ?? null,
                priorText,
              })
              .catch(() => null)
          : null;
        return ApplicationDocumentRevisionSchema.parse(
          await dependencies.library.propose({
            writtenContent,
            kind: input.kind,
            ...(input.documentId ? { documentId: input.documentId } : {}),
            ...(input.expectedRevision
              ? { expectedRevision: input.expectedRevision }
              : {}),
            grounding: {
              profile: snapshot.profile,
              job,
              applicationRecord,
              question,
            },
          }),
        );
      } catch (error) {
        return wrapStorageError(error);
      }
    },
  );

  ipcMain.handle(
    "job-finder:approve-application-document",
    async (_event, payload) => {
      try {
        const input = ApproveApplicationDocumentInputSchema.parse(payload);
        return ApplicationDocumentRevisionSchema.parse(
          await dependencies.library.approve(
            input.documentId,
            input.expectedRevision,
          ),
        );
      } catch (error) {
        return wrapStorageError(error);
      }
    },
  );

  ipcMain.handle(
    "job-finder:edit-application-document",
    async (_event, payload) => {
      try {
        const input = EditApplicationDocumentInputSchema.parse(payload);
        return ApplicationDocumentRevisionSchema.parse(
          await dependencies.library.edit(
            input.documentId,
            input.expectedRevision,
            input.content,
          ),
        );
      } catch (error) {
        return wrapStorageError(error);
      }
    },
  );

  ipcMain.handle(
    "job-finder:export-application-document",
    async (event, payload) => {
      try {
        const input = ExportApplicationDocumentInputSchema.parse(payload);
        const document = await dependencies.library.getApproved(
          input.documentId,
          input.expectedRevision,
        );
        const filePath = await dependencies.selectExportPath(
          event,
          dependencies.library.buildDefaultFileName(document),
        );
        if (!filePath) {
          return ApplicationDocumentExportResultSchema.parse({
            status: "cancelled",
          });
        }
        const bytes = Buffer.from(document.content, "utf8");
        await writeFile(filePath, bytes, { flag: "w", mode: 0o600 });
        const updated = await dependencies.library.recordExport(
          input.documentId,
          input.expectedRevision,
        );
        return ApplicationDocumentExportResultSchema.parse({
          status: "exported",
          document: updated,
          fileName: path.basename(filePath),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          byteSize: bytes.byteLength,
        });
      } catch (error) {
        return wrapStorageError(error);
      }
    },
  );
}
