import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export default defineConfig({
  resolve: {
    alias: {
      "@nordri/ai-providers": path.resolve(
        repoRoot,
        "packages/ai-providers/src/index.ts",
      ),
      "@renderer": path.resolve(repoRoot, "apps/desktop/src/renderer/src"),
      "@nordri/contracts": path.resolve(
        repoRoot,
        "packages/contracts/src/index.ts",
      ),
      "@nordri/job-finder": path.resolve(
        repoRoot,
        "packages/job-finder/src/index.ts",
      ),
    },
  },
  test: {
    include: ["scripts/drive-aggressive-tailoring.drive.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
