import { BrowserWindow, dialog } from "electron";
import type { IpcMain, IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import {
  CandidateAssetDeleteInputSchema,
  CandidateAssetDeleteResultSchema,
  CandidateAssetImportInputSchema,
  CandidateAssetImportResultSchema,
  CandidateAssetListInputSchema,
  CandidateAssetListResultSchema,
  CandidateAssetRestoreInputSchema,
  CandidateAssetRestoreResultSchema,
  type CandidateAsset,
} from "@unemployed/contracts";
import { CandidateAssetLibraryError } from "../services/job-finder/candidate-asset-library";
import type { CandidateAssetLibrary } from "../services/job-finder/candidate-asset-library";
import { getCandidateAssetLibrary } from "../services/job-finder/candidate-asset-library-instance";

interface CandidateAssetRouteDependencies {
  library: CandidateAssetLibrary;
  selectFile: (event: IpcMainInvokeEvent) => Promise<string | null>;
  /**
   * Told when a file the applications may attach becomes available, so an
   * application waiting on a file question carries on without another press.
   */
  onApplicationFileAvailable?: (asset: CandidateAsset) => Promise<unknown>;
}

async function continueApplicationsWaitingForFile(
  asset: CandidateAsset,
): Promise<unknown> {
  const { getJobFinderWorkspaceService } =
    await import("../services/job-finder/workspace-service");
  const workspaceService = await getJobFinderWorkspaceService();
  return workspaceService.continueApplicationsWaitingForFiles({
    assetId: asset.id,
    assetKind: asset.kind,
  });
}

function notifyApplicationFileAvailable(
  dependencies: CandidateAssetRouteDependencies,
  asset: CandidateAsset,
): void {
  if (
    !dependencies.onApplicationFileAvailable ||
    asset.deletedAt ||
    asset.kind === "resume" ||
    asset.consentScope !== "job_application_attachment"
  ) {
    return;
  }
  // Not awaited: the continuation drives the browser for minutes, and the
  // Files tab must settle as soon as the file is stored.
  void dependencies.onApplicationFileAvailable(asset).catch((error) => {
    console.warn(
      "[candidate-assets] Could not continue an application waiting for a file.",
      error instanceof Error ? error.message : error,
    );
  });
}

const fileDialogOptions: OpenDialogOptions = {
  title: "Import a document or asset",
  buttonLabel: "Import securely",
  properties: ["openFile"],
  filters: [
    {
      name: "Supported documents and images",
      extensions: [
        "pdf",
        "docx",
        "txt",
        "md",
        "csv",
        "vtt",
        "srt",
        "png",
        "jpg",
        "jpeg",
        "webp",
      ],
    },
  ],
};

async function selectCandidateAssetFile(event: IpcMainInvokeEvent) {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const selection = parentWindow
    ? await dialog.showOpenDialog(parentWindow, fileDialogOptions)
    : await dialog.showOpenDialog(fileDialogOptions);
  return selection.canceled ? null : (selection.filePaths[0] ?? null);
}

async function runAssetOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CandidateAssetLibraryError) throw error;
    throw new CandidateAssetLibraryError(
      "The candidate asset storage operation could not be completed.",
    );
  }
}

export function registerCandidateAssetRouteHandlers(
  ipcMain: IpcMain,
  dependencies: CandidateAssetRouteDependencies = {
    library: getCandidateAssetLibrary(),
    selectFile: selectCandidateAssetFile,
    onApplicationFileAvailable: continueApplicationsWaitingForFile,
  },
) {
  ipcMain.handle(
    "job-finder:candidate-assets:list",
    async (_event, payload) => {
      const input = CandidateAssetListInputSchema.parse(payload ?? {});
      return runAssetOperation(async () =>
        CandidateAssetListResultSchema.parse(
          await dependencies.library.list(input),
        ),
      );
    },
  );

  ipcMain.handle(
    "job-finder:candidate-assets:import",
    async (event, payload) => {
      const input = CandidateAssetImportInputSchema.parse(payload);
      const sourcePath = await dependencies.selectFile(event);
      if (!sourcePath) {
        return CandidateAssetImportResultSchema.parse({ status: "cancelled" });
      }
      const result = await runAssetOperation(async () =>
        CandidateAssetImportResultSchema.parse(
          await dependencies.library.importFromSourcePath(sourcePath, input),
        ),
      );
      if (result.status === "imported") {
        notifyApplicationFileAvailable(dependencies, result.asset);
      }
      return result;
    },
  );

  ipcMain.handle(
    "job-finder:candidate-assets:delete",
    async (_event, payload) => {
      const input = CandidateAssetDeleteInputSchema.parse(payload);
      return runAssetOperation(async () =>
        CandidateAssetDeleteResultSchema.parse(
          await dependencies.library.softDelete(input.assetId),
        ),
      );
    },
  );

  ipcMain.handle(
    "job-finder:candidate-assets:restore",
    async (_event, payload) => {
      const input = CandidateAssetRestoreInputSchema.parse(payload);
      const result = await runAssetOperation(async () =>
        CandidateAssetRestoreResultSchema.parse(
          await dependencies.library.restore(input),
        ),
      );
      notifyApplicationFileAvailable(dependencies, result.asset);
      return result;
    },
  );
}
