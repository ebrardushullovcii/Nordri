import type {
  ApplicationCrmBulkStageMutationInput,
  ApplicationCrmExportInput,
  ApplicationCrmExportResult,
  ApplicationCrmMutationInput,
  ApplicationCrmSettings,
  JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";
import {
  ApplicationCrmBulkStageMutationInputSchema,
  ApplicationCrmSettingsSchema,
} from "@nordri/contracts";

import {
  exportApplicationCrm,
  mutateApplicationCrmBulkStage,
  mutateApplicationCrm,
  runApplicationNoResponseAutomation,
} from "./application-crm";
import type { WorkspaceServiceContext } from "./workspace-service-context";

/**
 * Keeps CRM persistence and Candidate Asset validation out of the public
 * workspace service. The service can spread these methods into its typed API.
 */
export function createWorkspaceCrmMethods(input: {
  ctx: WorkspaceServiceContext;
  getWorkspaceSnapshot: () => Promise<JobFinderWorkspaceSnapshot>;
}) {
  return {
    async mutateApplicationCrm(
      command: ApplicationCrmMutationInput,
    ): Promise<JobFinderWorkspaceSnapshot> {
      await input.ctx.withApplicationCrmTransition(async () => {
        const mutation = command.mutation;
        if (mutation.type === "set_stage" && mutation.customStageId) {
          const settings = ApplicationCrmSettingsSchema.parse(
            (await input.ctx.repository.getSettings()).applicationCrm ?? {},
          );
          const customStage = settings.customStages.find(
            (stage) => stage.id === mutation.customStageId,
          );
          if (!customStage || customStage.baseStage !== mutation.stage) {
            throw new Error(
              "That custom application stage is no longer available. Refresh and choose another stage.",
            );
          }
        }

        return mutateApplicationCrm({
          repository: input.ctx.repository,
          command,
          validateCandidateAsset: async (assetId) => {
            if (!input.ctx.candidateAssetResolver) {
              throw new Error(
                "Candidate Assets are unavailable in this workspace.",
              );
            }
            const resolved =
              await input.ctx.candidateAssetResolver.resolveForApplication(
                assetId,
              );
            return resolved.asset;
          },
        });
      });
      return input.getWorkspaceSnapshot();
    },

    async mutateApplicationCrmBulkStage(
      command: ApplicationCrmBulkStageMutationInput,
    ): Promise<JobFinderWorkspaceSnapshot> {
      await input.ctx.withApplicationCrmTransition(async () => {
        const parsedCommand =
          ApplicationCrmBulkStageMutationInputSchema.parse(command);
        if (parsedCommand.customStageId) {
          const settings = ApplicationCrmSettingsSchema.parse(
            (await input.ctx.repository.getSettings()).applicationCrm ?? {},
          );
          const customStage = settings.customStages.find(
            (stage) => stage.id === parsedCommand.customStageId,
          );
          if (!customStage || customStage.baseStage !== parsedCommand.stage) {
            throw new Error(
              "That custom application stage is no longer available. Refresh and choose another stage.",
            );
          }
        }

        return mutateApplicationCrmBulkStage({
          repository: input.ctx.repository,
          command: parsedCommand,
        });
      });
      return input.getWorkspaceSnapshot();
    },

    async runApplicationNoResponseAutomation(
      settings?: ApplicationCrmSettings,
    ): Promise<JobFinderWorkspaceSnapshot> {
      const effectiveSettings =
        settings ??
        ApplicationCrmSettingsSchema.parse(
          (await input.ctx.repository.getSettings()).applicationCrm ?? {},
        );
      await input.ctx.withApplicationCrmTransition(() =>
        runApplicationNoResponseAutomation({
          repository: input.ctx.repository,
          settings: effectiveSettings,
        }),
      );
      return input.getWorkspaceSnapshot();
    },

    async exportApplicationCrm(
      command: ApplicationCrmExportInput,
    ): Promise<ApplicationCrmExportResult> {
      return input.ctx.withApplicationCrmTransition(async () => {
        const records = await input.ctx.repository.listApplicationRecords();
        return exportApplicationCrm({
          records,
          request: command,
        });
      });
    },
  };
}
