import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  JobFinderWorkspaceSnapshotSchema,
  isInterruptedResumeImportRun,
  type ResumeImportProgressEvent,
  type ResumeImportRun,
  type ResumeSourceDocument,
} from "@unemployed/contracts";
import {
  detectResumeDocumentFileKind,
  extractResumeDocument,
} from "../../adapters/resume-document";
import { generateResumeVisionImages } from "../../adapters/resume-vision-images";
import { getJobFinderWorkspaceService } from "./workspace-service";
import { getJobFinderDocumentsDirectory } from "./paths";

export interface ImportResumeFromSourcePathOptions {
  onProgress?: (event: ResumeImportProgressEvent) => void;
  useVision?: boolean;
  /**
   * The name the person knows the file by. Set when importing the private
   * working copy again, whose own name carries a timestamp prefix.
   */
  fileName?: string;
}

/**
 * Where an import keeps its private working copy: the documents directory,
 * named `<timestamp>_<file name>` with the same timestamp as the resume id
 * `resume_<timestamp>`. Null when the id does not follow that shape.
 */
export function resolveResumeWorkingCopyPath(input: {
  documentsDirectory: string;
  sourceResumeId: string;
  fileName: string;
}): string | null {
  const timestamp = /^resume_(\d+)$/.exec(input.sourceResumeId)?.[1];
  const fileName = path.basename(input.fileName.trim());
  if (!timestamp || !fileName) {
    return null;
  }
  return path.join(input.documentsDirectory, `${timestamp}_${fileName}`);
}

export class ResumeImportRetryUnavailableError extends Error {}

/**
 * Imports again the file an import was reading when the app closed. The
 * working copy saved at the start of that import is read in place of a file
 * picker, so starting over is one press instead of finding the file again.
 */
export async function retryInterruptedResumeImport(
  latestRun: ResumeImportRun | null,
  options: Omit<ImportResumeFromSourcePathOptions, "fileName"> = {},
) {
  if (!latestRun || !isInterruptedResumeImportRun(latestRun)) {
    throw new ResumeImportRetryUnavailableError(
      "There is no stopped import to start again. Choose your resume file to import it.",
    );
  }
  const workingCopy = resolveResumeWorkingCopyPath({
    documentsDirectory: getJobFinderDocumentsDirectory(),
    sourceResumeId: latestRun.sourceResumeId,
    fileName: latestRun.sourceResumeFileName,
  });
  const exists = workingCopy
    ? await access(workingCopy).then(
        () => true,
        () => false,
      )
    : false;
  if (!workingCopy || !exists) {
    throw new ResumeImportRetryUnavailableError(
      `The saved copy of ${latestRun.sourceResumeFileName} is no longer on this device. Choose the file again to import it.`,
    );
  }
  return importResumeFromSourcePath(workingCopy, {
    ...options,
    fileName: latestRun.sourceResumeFileName,
  });
}

export async function importResumeFromSourcePath(
  sourcePath: string,
  options: ImportResumeFromSourcePathOptions = {},
) {
  const targetDirectory = getJobFinderDocumentsDirectory();
  const jobFinderWorkspaceService = await getJobFinderWorkspaceService();
  const useVision = options.useVision ?? true;
  // The four stages are the ones the contract names, in the order they run, so
  // the renderer can show "step 2 of 4" instead of one label that sits frozen
  // for the ~30s the model stages take. Expectations are stated per stage
  // rather than only after 45s, which a 36s import never reached.
  const stageOrder: readonly ResumeImportProgressEvent["stage"][] = [
    "saving_file",
    "reading_document",
    "building_profile",
    "saving_results",
  ];
  const stageExpectations: Record<
    ResumeImportProgressEvent["stage"],
    { max: number; min: number }
  > = {
    saving_file: { max: 2, min: 0 },
    reading_document: { max: 5, min: 0 },
    building_profile: { max: 60, min: 15 },
    saving_results: { max: 3, min: 0 },
  };
  const reportProgress = (
    stage: ResumeImportProgressEvent["stage"],
    message: string,
  ) =>
    options.onProgress?.({
      stage,
      message,
      occurredAt: new Date().toISOString(),
      completed: stageOrder.indexOf(stage),
      total: stageOrder.length,
      expectedSecondsMin: stageExpectations[stage].min,
      expectedSecondsMax: stageExpectations[stage].max,
    });

  reportProgress(
    "saving_file",
    "Saving a private working copy on this device.",
  );
  await mkdir(targetDirectory, { recursive: true });

  const timestamp = Date.now();
  const uploadedAt = new Date(timestamp).toISOString();
  const fileName = path.basename(
    options.fileName?.trim() || path.basename(sourcePath),
  );
  const resumeId = `resume_${timestamp}`;
  const targetPath = path.join(targetDirectory, `${timestamp}_${fileName}`);
  const seedRunId = `resume_import_seed_${timestamp}`;
  const sourceFileKind = detectResumeDocumentFileKind(targetPath);
  const shouldGenerateVision =
    useVision &&
    sourceFileKind !== "plain_text" &&
    sourceFileKind !== "markdown";

  await copyFile(sourcePath, targetPath);
  const sourceSha256 = createHash("sha256")
    .update(await readFile(targetPath))
    .digest("hex");
  reportProgress(
    "reading_document",
    "Reading resume text, sections, and page layout.",
  );
  const extractionInput = {
    bundleId: `resume_bundle_${timestamp}`,
    runId: seedRunId,
    sourceResumeId: resumeId,
  };
  const generatedVisionArtifactPromise = shouldGenerateVision
    ? generateResumeVisionImages({
        filePath: targetPath,
        fileKind: sourceFileKind,
        runId: seedRunId,
        sourceResumeId: resumeId,
        artifactId: `resume_vision_artifact_${timestamp}`,
      }).catch((error) => ({
        artifact: null,
        warnings: [
          error instanceof Error
            ? `Local resume image generation failed: ${error.message}`
            : "Local resume image generation failed before the vision branch could start.",
        ],
      }))
    : Promise.resolve({ artifact: null, warnings: [] });

  const [extractedResume, generatedVisionArtifact] = await Promise.all([
    extractResumeDocument(targetPath, extractionInput),
    generatedVisionArtifactPromise,
  ]);
  const visionWarnings = generatedVisionArtifact.warnings;
  const extractionStatus = extractedResume.textContent
    ? "not_started"
    : "needs_text";
  const baseResume: ResumeSourceDocument = {
    id: resumeId,
    fileName,
    uploadedAt,
    storagePath: targetPath,
    sha256: sourceSha256,
    textContent: extractedResume.textContent,
    textUpdatedAt: extractedResume.textContent ? uploadedAt : null,
    extractionStatus,
    lastAnalyzedAt: null,
    analysisProviderKind: null,
    analysisProviderLabel: null,
    analysisWarnings:
      extractedResume.warnings.length > 0 || visionWarnings.length > 0
        ? [...extractedResume.warnings, ...visionWarnings]
        : extractedResume.textContent
          ? []
          : [
              "Paste plain-text resume content below if you want the agent to extract profile details from this file.",
            ],
  };

  const hasReadableResumeContent = Boolean(
    extractedResume.textContent ||
    generatedVisionArtifact.artifact?.pages.length,
  );
  // Always announce this stage. It is the single longest phase of the import,
  // and skipping it for an unreadable file left the previous stage's label
  // frozen on screen for the whole wait.
  reportProgress(
    "building_profile",
    hasReadableResumeContent
      ? "Reading your resume and filling in your profile. Anything that would replace details you already saved waits for your review."
      : "Checking what can be recovered from this file.",
  );
  const snapshot = await jobFinderWorkspaceService.runResumeImport({
    baseResume,
    documentBundle: extractedResume.bundle,
    importWarnings: [...extractedResume.warnings, ...visionWarnings],
    visionArtifact: generatedVisionArtifact.artifact,
  });

  reportProgress(
    "saving_results",
    hasReadableResumeContent
      ? "Saving the imported resume and review items."
      : "Saving the import issue and recovery guidance.",
  );
  return JobFinderWorkspaceSnapshotSchema.parse(snapshot);
}
