import type {
  JobFinderAiClient,
  ResumeVisionProvider,
} from "@nordri/ai-providers";
import type { BrowserSessionRuntime } from "@nordri/browser-runtime";
import {
  createInMemoryJobFinderRepository,
  type JobFinderRepositorySeed,
} from "@nordri/db";
import {
  createJobFinderWorkspaceService,
  type ListingHtmlFetcher,
} from "./index";
import { createSeed } from "./workspace-service.test-fixtures";
import {
  createAiClient,
  createBrowserRuntime,
  createDocumentManager,
  createResearchAdapter,
} from "./workspace-service.test-runtimes";

export function createWorkspaceServiceHarness(
  options: {
    seed?: JobFinderRepositorySeed;
    browserRuntime?: BrowserSessionRuntime;
    aiClient?: JobFinderAiClient;
    visionProvider?: ResumeVisionProvider;
    documentManager?: ReturnType<typeof createDocumentManager>;
    exportFileVerifier?: {
      exists(filePath: string): Promise<boolean>;
      sha256?(filePath: string): Promise<string>;
    };
    researchAdapter?: ReturnType<typeof createResearchAdapter>;
    fetchListingHtml?: ListingHtmlFetcher;
  } = {},
) {
  const repository = createInMemoryJobFinderRepository(
    options.seed ?? createSeed(),
  );
  const browserRuntime = options.browserRuntime ?? createBrowserRuntime();
  const aiClient = options.aiClient ?? createAiClient();
  const documentManager = options.documentManager ?? createDocumentManager();
  const exportFileVerifier = options.exportFileVerifier ?? {
    exists: () => Promise.resolve(true),
  };
  const researchAdapter = options.researchAdapter ?? createResearchAdapter();
  const workspaceService = createJobFinderWorkspaceService({
    repository,
    browserRuntime,
    aiClient,
    ...(options.visionProvider
      ? { visionProvider: options.visionProvider }
      : {}),
    documentManager,
    exportFileVerifier,
    researchAdapter,
    ...(options.fetchListingHtml
      ? { fetchListingHtml: options.fetchListingHtml }
      : {}),
  });

  return {
    repository,
    browserRuntime,
    aiClient,
    documentManager,
    exportFileVerifier,
    researchAdapter,
    workspaceService,
  };
}
