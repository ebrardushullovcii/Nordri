import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const aiProvidersPath = path.resolve(
  currentDir,
  "../../packages/ai-providers/src/index.ts",
);
const browserAgentPath = path.resolve(
  currentDir,
  "../../packages/browser-agent/src/index.ts",
);
const browserRuntimePath = path.resolve(
  currentDir,
  "../../packages/browser-runtime/src/index.ts",
);
const contractsPath = path.resolve(
  currentDir,
  "../../packages/contracts/src/index.ts",
);
const corePath = path.resolve(currentDir, "../../packages/core/src/index.ts");
const dbPath = path.resolve(currentDir, "../../packages/db/src/index.ts");
const liveAssistantPath = path.resolve(
  currentDir,
  "../../packages/live-assistant/src/index.ts",
);
const jobFinderDiscoveryOrderingPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/discovery-ordering.ts",
);
const jobFinderDiscoveryResultBandsPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/discovery-result-bands.ts",
);
const jobFinderPlanSafeguardPausesPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/plan-safeguard-pauses.ts",
);
const jobFinderResumeRecordIdentityPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/resume-record-identity.ts",
);
const jobFinderResumeIdentityPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/internal/resume-identity.ts",
);
const jobFinderApplyRunRecoveryPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/internal/workspace-apply-run-recovery.ts",
);
const jobFinderSourceHealthPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/source-health.ts",
);
const jobFinderApplicationSubmissionRuntimeMainPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/application-submission-runtime-main.ts",
);
const jobFinderPath = path.resolve(
  currentDir,
  "../../packages/job-finder/src/index.ts",
);
const knowledgeBasePath = path.resolve(
  currentDir,
  "../../packages/knowledge-base/src/index.ts",
);
const osIntegrationPath = path.resolve(
  currentDir,
  "../../packages/os-integration/src/index.ts",
);

const workspaceAliases = {
  "@nordri/ai-providers": aiProvidersPath,
  "@nordri/browser-agent": browserAgentPath,
  "@nordri/browser-runtime": browserRuntimePath,
  "@nordri/contracts": contractsPath,
  "@nordri/core": corePath,
  "@nordri/db": dbPath,
  "@nordri/live-assistant": liveAssistantPath,
  "@nordri/job-finder/assistant-attention": path.resolve(
    currentDir,
    "../../packages/job-finder/src/assistant/attention.ts",
  ),
  "@nordri/job-finder/discovery-ordering": jobFinderDiscoveryOrderingPath,
  "@nordri/job-finder/discovery-result-bands":
    jobFinderDiscoveryResultBandsPath,
  "@nordri/job-finder/resume-record-identity":
    jobFinderResumeRecordIdentityPath,
  "@nordri/job-finder/resume-identity": jobFinderResumeIdentityPath,
  "@nordri/job-finder/apply-run-recovery": jobFinderApplyRunRecoveryPath,
  "@nordri/job-finder/source-health": jobFinderSourceHealthPath,
  "@nordri/job-finder/plan-safeguard-pauses":
    jobFinderPlanSafeguardPausesPath,
  "@nordri/job-finder": jobFinderPath,
  "@nordri/knowledge-base": knowledgeBasePath,
  "@nordri/os-integration": osIntegrationPath,
};

const mainWorkspaceAliases = {
  ...workspaceAliases,
  "@nordri/job-finder/application-submission-runtime-main":
    jobFinderApplicationSubmissionRuntimeMainPath,
};

export default defineConfig({
  main: {
    resolve: {
      alias: mainWorkspaceAliases,
    },
    build: {
      rollupOptions: {
        external: [
          "playwright",
          "playwright-core",
          "chromium-bidi",
          "jsdom",
          "@mozilla/readability",
          // Bundling ws turns its optional native `bufferutil` require into an
          // empty module, so masked frames over 48 bytes from the CDP client
          // crash main ("bufferUtil.unmask is not a function"). Load it as
          // the installed dependency instead.
          "ws",
        ],
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name]-[hash].cjs",
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: workspaceAliases,
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(currentDir, "src/preload/index.ts"),
          // Bridge-free page preload for the embedded browser (ADR 0017).
          "browser-page": path.resolve(
            currentDir,
            "src/preload/browser-page.ts",
          ),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name]-[hash].cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        ...workspaceAliases,
        "@renderer": path.resolve(currentDir, "src/renderer/src"),
      },
    },
    plugins: [tailwindcss(), react()] as never,
  },
});
