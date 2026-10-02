import { expect, test } from "vitest";
import {
  createDocumentManager,
  createWorkspaceServiceHarness,
} from "./workspace-service.test-support";

test.each([1, 2, null, undefined])(
  "passes a measured preview page count through metadata: %s",
  async (pageCount) => {
    const base = createDocumentManager();
    const { workspaceService } = createWorkspaceServiceHarness({
      documentManager: {
        ...base,
        async renderResumePreview(input) {
          return { ...(await base.renderResumePreview(input)), pageCount };
        },
      },
    });
    const workspace = await workspaceService.getResumeWorkspace("job_ready");
    const preview = await workspaceService.previewResumeDraft(workspace.draft);
    expect(preview.metadata.pageCount).toBe(pageCount ?? null);
    expect(preview.html).toBeTruthy();
  },
);
