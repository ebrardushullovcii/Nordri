import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nordri/ai-providers": path.resolve(
        currentDir,
        "packages/ai-providers/src/index.ts",
      ),
      "@renderer": path.resolve(currentDir, "apps/desktop/src/renderer/src"),
      "@nordri/browser-agent": path.resolve(
        currentDir,
        "packages/browser-agent/src/index.ts",
      ),
      "@nordri/browser-runtime": path.resolve(
        currentDir,
        "packages/browser-runtime/src/index.ts",
      ),
      "@nordri/contracts": path.resolve(
        currentDir,
        "packages/contracts/src/index.ts",
      ),
      "@nordri/db": path.resolve(currentDir, "packages/db/src/index.ts"),
      "@nordri/job-finder/discovery-ordering": path.resolve(
        currentDir,
        "packages/job-finder/src/discovery-ordering.ts",
      ),
      "@nordri/job-finder/discovery-result-bands": path.resolve(
        currentDir,
        "packages/job-finder/src/discovery-result-bands.ts",
      ),
      "@nordri/job-finder/resume-record-identity": path.resolve(
        currentDir,
        "packages/job-finder/src/resume-record-identity.ts",
      ),
      "@nordri/job-finder/plan-safeguard-pauses": path.resolve(currentDir, "packages/job-finder/src/plan-safeguard-pauses.ts"),
      "@nordri/job-finder/resume-identity": path.resolve(
        currentDir,
        "packages/job-finder/src/internal/resume-identity.ts",
      ),
      "@nordri/job-finder/apply-run-recovery": path.resolve(
        currentDir,
        "packages/job-finder/src/internal/workspace-apply-run-recovery.ts",
      ),
      "@nordri/job-finder/source-health": path.resolve(
        currentDir,
        "packages/job-finder/src/source-health.ts",
      ),
      "@nordri/job-finder/application-submission-runtime-main":
        path.resolve(
          currentDir,
          "packages/job-finder/src/application-submission-runtime-main.ts",
        ),
      "@nordri/job-finder": path.resolve(
        currentDir,
        "packages/job-finder/src/index.ts",
      ),
      "@nordri/knowledge-base": path.resolve(
        currentDir,
        "packages/knowledge-base/src/index.ts",
      ),
    },
  },
  test: {
    setupFiles: [path.resolve(currentDir, "apps/desktop/src/test/setup.ts")],
    include: ["**/*.test.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.tmp/**",
      "**/apps/desktop/.tmp/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportOnFailure: true,
      include: [
        "apps/desktop/src/**/*.{js,jsx,mjs,cjs,ts,tsx}",
        "packages/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx}",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.d.*",
        "**/*fixtures.*",
        "**/test-fixtures/**",
        "**/.tmp/**",
        "**/coverage/**",
        "packages/job-finder/src/internal/workspace-discovery-ledger.performance.test.ts",
        "packages/job-finder/src/workspace-service.discovery-ledger-performance.test.ts",
      ],
    },
  },
});
