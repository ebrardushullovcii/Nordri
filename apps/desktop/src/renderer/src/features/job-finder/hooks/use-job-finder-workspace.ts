import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicationCrmBulkStageMutationInput,
  ApplicationCrmExportInput,
  ApplicationCrmMutationInput,
  ApplicationCrmSettings,
  AppearanceTheme,
  ApplyGroupedManualAnswerInput,
  CandidateProfile,
  ClearApplicationAnswerCommandInput,
  CompanyIntelligenceMutationInput,
  DiscoveryActivityEvent,
  DiscoveryFeedbackReason,
  EditableSourceInstructionArtifact,
  JobFinderApplyConsentActionInput,
  JobFinderApplyCopilotActionInput,
  JobFinderApplyQueueActionInput,
  JobFinderApplyRunActionInput,
  JobFinderApplyRunDetailsQuery,
  JobFinderApplicationStartTarget,
  JobFinderPreparedApplicationPageInput,
  JobFinderOpenBrowserSessionInput,
  JobFinderSetResumeClaimConfirmationInput,
  JobFinderSetWorkHistoryReviewAcknowledgmentInput,
  JobFinderSettings,
  JobFinderSearchRequest,
  JobFinderWorkspaceSnapshot,
  JobFinderWorkspaceEntityMutation,
  JobFinderWorkspaceSyncResult,
  JobSearchPreferences,
  RapidReviewMutationInput,
  RecommendResumeStrategyInput,
  RecordOutcomeInput,
  ResolveSubmissionOutcomeInput,
  SafeguardMutationInput,
  ReviewCompanyMergeInput,
  SaveResumeStrategyInput,
  SaveCampaignRuleInput,
  SaveJobSearchCampaignInput,
  SelectResumeStrategyInput,
  SetCampaignResumeStrategyDefaultInput,
  SetCompanyPreferenceInput,
  SetJobFinderActivityControlInput,
  SetOutcomeSuggestionEnabledInput,
  WorkspaceRevision,
  ProfileCopilotContext,
  ProfileSetupReviewAction,
  ProfileSetupReviewActionOptions,
  ProfileSetupState,
  ProjectGroupedManualAnswerCommand,
  ResumeImportProgressEvent,
  ResumeApplicationMode,
  TailoringMode,
  ResumePdfExportIntent,
  ResumeTimelineRepairAction,
  ResumeDraft,
  ResumeDraftPatch,
  SaveApplicationAnswerCommandInput,
  SnoozeGroupedDecisionInput,
  SourceDebugProgressEvent,
  UpdateApplicationDefaultsInput,
  UpdateWorkspaceBehaviorInput,
  UpdateAiBehaviorInput,
  UserActionCommandInput,
} from "@unemployed/contracts";
import type { JobFinderShellActions } from "../lib/job-finder-types";
import { applyJobFinderWorkspaceDelta } from "../../../pages/job-finder-workspace-delta";
import {
  isJobFinderStartupDatabaseRecoveryFact,
  type JobFinderStartupDatabaseRecoveryBlockedFact,
  type JobFinderStartupDatabaseRecoveryFact,
} from "../../../../../shared/job-finder-startup-db-recovery";

type JobFinderWorkspaceState =
  | { status: "loading" }
  | {
      status: "ready";
      actions: JobFinderShellActions;
      platform: "darwin" | "win32" | "linux";
      resumeImportProgress: ResumeImportProgressEvent | null;
      workspace: JobFinderWorkspaceSnapshot;
    }
  | {
      status: "error";
      message: string;
      retry: () => void;
      startupDatabaseRecovery: JobFinderStartupDatabaseRecoveryBlockedFact | null;
    };

function markJobFinderTiming(markName: string, startMarkName?: string) {
  const performanceApi = globalThis.performance;
  if (!performanceApi?.mark) {
    return;
  }

  performanceApi.mark(markName);
  if (startMarkName && performanceApi.measure) {
    try {
      performanceApi.measure(markName, startMarkName, markName);
    } catch {
      // Performance diagnostics must never affect workspace loading.
    }
  }
}

type StartupDatabaseRecoveryFactRequest =
  Promise<JobFinderStartupDatabaseRecoveryFact | null>;

function requestStartupDatabaseRecoveryFact(): StartupDatabaseRecoveryFactRequest {
  try {
    const recoveryBridge =
      window.unemployed?.jobFinder?.getStartupDatabaseRecovery;
    if (typeof recoveryBridge === "function") {
      return recoveryBridge().catch(() => null);
    }
  } catch {
    // Older preload builds without the typed bridge fall through.
  }

  return Promise.resolve(null);
}

function selectBlockedStartupDatabaseRecovery(
  recoveryFact: JobFinderStartupDatabaseRecoveryFact | null,
): JobFinderStartupDatabaseRecoveryBlockedFact | null {
  return recoveryFact !== null &&
    isJobFinderStartupDatabaseRecoveryFact(recoveryFact) &&
    recoveryFact.status === "blocked"
    ? recoveryFact
    : null;
}

export function useJobFinderWorkspace(): JobFinderWorkspaceState {
  const [workspaceState, setWorkspaceState] = useState<JobFinderWorkspaceState>(
    { status: "loading" },
  );
  const [loadRequest, setLoadRequest] = useState(0);
  const performanceRunRef = useRef(0);
  const workspaceRef = useRef<JobFinderWorkspaceSnapshot | null>(null);
  const workspaceRevisionRef = useRef<WorkspaceRevision>(0);
  const workspaceCommitVersionRef = useRef(0);
  // Progress belongs to the import invocation that registered its callback.
  // A native file picker may settle after a route change or a renderer reload;
  // request identity keeps a late event from repainting a newer import.
  const resumeImportRequestSequenceRef = useRef(0);

  useEffect(() => {
    return () => {
      resumeImportRequestSequenceRef.current += 1;
    };
  }, []);
  // A workspace action may finish after a newer action has already committed.
  // Keep the latest invocation authoritative so a slow IPC response cannot
  // restore an older snapshot or revision.
  const workspaceRequestSequenceRef = useRef(0);

  const beginWorkspaceRequest = useCallback(() => {
    workspaceRequestSequenceRef.current += 1;
    return workspaceRequestSequenceRef.current;
  }, []);

  const isCurrentWorkspaceRequest = useCallback((sequence: number) => {
    return workspaceRequestSequenceRef.current === sequence;
  }, []);

  const assertWorkspaceHydrated = useCallback(() => {
    if (workspaceRef.current?.hydration?.phase === "bootstrap") {
      throw new Error(
        "Job Finder is still finishing its initial load. Please wait a moment and try again.",
      );
    }
  }, []);

  const commitWorkspace = useCallback(
    (workspace: JobFinderWorkspaceSnapshot) => {
      workspaceCommitVersionRef.current += 1;
      workspaceRef.current = workspace;
      setWorkspaceState((currentState) =>
        currentState.status === "ready"
          ? { ...currentState, workspace }
          : currentState,
      );
    },
    [],
  );

  const recoverFullWorkspaceOnce = useCallback(
    async (sequence?: number) => {
      const requestSequence = sequence ?? beginWorkspaceRequest();
      try {
        const result = await window.unemployed.jobFinder.syncWorkspace(null);
        if (result.kind === "snapshot") {
          if (!isCurrentWorkspaceRequest(requestSequence)) {
            return workspaceRef.current ?? result.snapshot;
          }

          workspaceRevisionRef.current = result.currentRevision;
          commitWorkspace(result.snapshot);
          return result.snapshot;
        }
      } catch {
        // Older preload builds still use the existing full-snapshot fallback.
      }

      const workspace = await window.unemployed.jobFinder.getWorkspace();
      if (!isCurrentWorkspaceRequest(requestSequence)) {
        return workspaceRef.current ?? workspace;
      }

      workspaceRevisionRef.current = 0;
      commitWorkspace(workspace);
      return workspace;
    },
    [beginWorkspaceRequest, commitWorkspace, isCurrentWorkspaceRequest],
  );

  // A response that loses the sequencing race against a later request must
  // still converge. The winning request may have snapshotted main-process
  // state before this response's own backend commit landed, so dropping the
  // fenced response can leave permanently stale UI. One trailing
  // authoritative fetch — dispatched only after this response settled, so
  // its snapshot observes every settled commit — restores freshness without
  // weakening the latest-request fence: nothing stale is ever committed.
  const scheduleConvergenceFetch = useCallback(() => {
    void recoverFullWorkspaceOnce().catch(() => undefined);
  }, [recoverFullWorkspaceOnce]);

  const runWorkspaceAction = useCallback(
    async (
      action: () => Promise<JobFinderWorkspaceSnapshot>,
      options?: { allowDuringBootstrap?: boolean },
    ) => {
      if (!options?.allowDuringBootstrap) {
        assertWorkspaceHydrated();
      }
      const sequence = beginWorkspaceRequest();
      let workspace: JobFinderWorkspaceSnapshot;
      try {
        workspace = await action();
      } catch (error) {
        // Main often records the failure before it throws (a resume run that
        // failed saves a failed asset with its cause). Without a re-sync the
        // screen kept its pre-action state, "No resume yet" with "Create the
        // resume", until the window was reloaded.
        scheduleConvergenceFetch();
        throw error;
      }
      if (!isCurrentWorkspaceRequest(sequence)) {
        scheduleConvergenceFetch();
        return workspaceRef.current ?? workspace;
      }

      // A bare snapshot response carries no revision, so the delta baseline
      // must be surrendered here. `0` means "this workspace corresponds to no
      // revision main knows about", which forces the next sync to ask for a
      // full snapshot and re-baseline both sides together.
      //
      // Do NOT "optimise" this into keeping the previous revision: main's
      // tracker baseline would still be the pre-mutation snapshot while the
      // committed workspace is the post-mutation one, so the next delta would
      // be computed against a state the renderer no longer holds. An entity
      // created by this mutation and removed before the next sync would then
      // survive forever in the UI, because it is absent from both the baseline
      // and the current snapshot and therefore never appears in `removedIds`.
      // The revision can only be carried forward once the mutation response
      // itself carries it (see `runWorkspaceEntityMutation`, which does exactly
      // that through the typed sync envelope).
      workspaceRevisionRef.current = 0;
      commitWorkspace(workspace);
      return workspace;
    },
    [
      assertWorkspaceHydrated,
      beginWorkspaceRequest,
      commitWorkspace,
      isCurrentWorkspaceRequest,
      scheduleConvergenceFetch,
    ],
  );

  // Same request fencing and snapshot commit as runWorkspaceAction, but the
  // typed envelope around the snapshot survives so callers can classify the
  // terminal outcome (completed vs user-cancelled) without re-deriving it
  // from a later refresh.
  const runWorkspaceResultAction = useCallback(
    async <T extends { snapshot: JobFinderWorkspaceSnapshot }>(
      action: () => Promise<T>,
    ): Promise<T> => {
      assertWorkspaceHydrated();
      const sequence = beginWorkspaceRequest();
      const result = await action();
      if (!isCurrentWorkspaceRequest(sequence)) {
        return { ...result, snapshot: workspaceRef.current ?? result.snapshot };
      }

      workspaceRevisionRef.current = 0;
      commitWorkspace(result.snapshot);
      return result;
    },
    [
      assertWorkspaceHydrated,
      beginWorkspaceRequest,
      commitWorkspace,
      isCurrentWorkspaceRequest,
      scheduleConvergenceFetch,
    ],
  );

  const commitWorkspaceSyncResult = useCallback(
    (
      result: JobFinderWorkspaceSyncResult,
      sequence: number,
    ): JobFinderWorkspaceSnapshot | null => {
      if (!isCurrentWorkspaceRequest(sequence)) {
        return workspaceRef.current;
      }

      if (result.kind === "snapshot") {
        workspaceRevisionRef.current = result.currentRevision;
        commitWorkspace(result.snapshot);
        return result.snapshot;
      }

      const workspace = workspaceRef.current;
      if (!workspace) {
        return null;
      }

      const applied = applyJobFinderWorkspaceDelta({
        revision: workspaceRevisionRef.current,
        workspace,
        delta: result.delta,
      });
      if (applied.status !== "applied") {
        return null;
      }

      workspaceRevisionRef.current = applied.revision;
      commitWorkspace(applied.workspace);
      return applied.workspace;
    },
    [commitWorkspace, isCurrentWorkspaceRequest],
  );

  const syncWorkspace = useCallback(async () => {
    const sequence = beginWorkspaceRequest();
    const baseRevision = workspaceRevisionRef.current || null;
    let result: JobFinderWorkspaceSyncResult;
    try {
      result = await window.unemployed.jobFinder.syncWorkspace(baseRevision);
    } catch {
      return recoverFullWorkspaceOnce(sequence);
    }

    return (
      commitWorkspaceSyncResult(result, sequence) ??
      (await recoverFullWorkspaceOnce(sequence))
    );
  }, [
    beginWorkspaceRequest,
    commitWorkspaceSyncResult,
    recoverFullWorkspaceOnce,
  ]);

  // Main may publish an update before the mutation that caused it returns.
  // Notification refreshes therefore use their own fence: they never advance
  // the mutation request sequence, and they commit only if no other response
  // has committed since this refresh began.
  const syncWorkspaceFromUpdate = useCallback(async () => {
    if (!workspaceRef.current) return null;
    const commitVersion = workspaceCommitVersionRef.current;
    const baseRevision = workspaceRevisionRef.current || null;

    try {
      const result =
        await window.unemployed.jobFinder.syncWorkspace(baseRevision);
      if (workspaceCommitVersionRef.current !== commitVersion) {
        return workspaceRef.current;
      }

      if (result.kind === "snapshot") {
        workspaceRevisionRef.current = result.currentRevision;
        commitWorkspace(result.snapshot);
        return result.snapshot;
      }

      const workspace = workspaceRef.current;
      if (workspace) {
        const applied = applyJobFinderWorkspaceDelta({
          revision: workspaceRevisionRef.current,
          workspace,
          delta: result.delta,
        });
        if (applied.status === "applied") {
          workspaceRevisionRef.current = applied.revision;
          commitWorkspace(applied.workspace);
          return applied.workspace;
        }
      }
    } catch {
      // Fall through to the legacy full-snapshot recovery below.
    }

    const workspace = await window.unemployed.jobFinder.getWorkspace();
    if (workspaceCommitVersionRef.current !== commitVersion) {
      return workspaceRef.current ?? workspace;
    }
    workspaceRevisionRef.current = 0;
    commitWorkspace(workspace);
    return workspace;
  }, [commitWorkspace]);

  useEffect(() => {
    let disposed = false;
    let syncing = false;
    let queued = false;
    const converge = () => {
      if (disposed) return;
      if (syncing) {
        queued = true;
        return;
      }
      syncing = true;
      void syncWorkspaceFromUpdate().finally(() => {
        syncing = false;
        if (queued) {
          queued = false;
          converge();
        }
      });
    };
    const subscribe = window.unemployed.jobFinder.onWorkspaceUpdate;
    // Test hosts and a renderer that survived a development preload refresh
    // can briefly expose the earlier bridge shape. The next mount subscribes;
    // this mount keeps its ordinary mutation-driven convergence.
    if (typeof subscribe !== "function") return;
    const unsubscribe = subscribe(converge);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [syncWorkspaceFromUpdate]);

  const runWorkspaceEntityMutation = useCallback(
    async (mutation: JobFinderWorkspaceEntityMutation) => {
      assertWorkspaceHydrated();
      const sequence = beginWorkspaceRequest();
      const baseRevision = workspaceRevisionRef.current || null;
      const result = await window.unemployed.jobFinder.mutateWorkspaceEntities({
        baseRevision,
        mutation,
      });

      if (!isCurrentWorkspaceRequest(sequence)) {
        // Same convergence contract as runWorkspaceAction: a background sync
        // that raced this committed mutation must not leave its result
        // stranded in stale UI, and the fenced response must not be
        // committed directly ahead of the newer request.
        scheduleConvergenceFetch();
      }

      return (
        commitWorkspaceSyncResult(result, sequence) ??
        (await recoverFullWorkspaceOnce(sequence))
      );
    },
    [
      beginWorkspaceRequest,
      commitWorkspaceSyncResult,
      recoverFullWorkspaceOnce,
      assertWorkspaceHydrated,
      isCurrentWorkspaceRequest,
      scheduleConvergenceFetch,
    ],
  );

  const actions = useMemo<JobFinderShellActions>(
    () => ({
      analyzeProfileFromResume: () =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.analyzeProfileFromResume(),
        ),
      openBrowserSession: (input?: JobFinderOpenBrowserSessionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.openBrowserSession(input),
        ),
      checkBrowserSession: () =>
        runWorkspaceAction(
          () => window.unemployed.jobFinder.checkBrowserSession(),
          { allowDuringBootstrap: true },
        ),
      performUserAction: (command: UserActionCommandInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.performUserAction(command),
        ),
      approveApply: (input: JobFinderApplicationStartTarget) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.approveApply(input),
        ),
      dismissDiscoveryJob: (
        jobId: string,
        reasons: readonly DiscoveryFeedbackReason[],
        action: "hide_job" | "hide_and_exclude_employer" = "hide_job",
        expectedNormalizedCompanyName: string | null = null,
      ) =>
        runWorkspaceEntityMutation({
          type: "dismiss_discovery_job",
          jobId,
          reasons: [...reasons],
          action,
          expectedNormalizedCompanyName,
        }),
      previewEmployerExclusion: (jobId: string) =>
        window.unemployed.jobFinder.previewEmployerExclusion(jobId),
      removeEmployerExclusion: (input) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.removeEmployerExclusion(input),
        ),
      restoreDismissedDiscoveryJob: (jobId: string) =>
        runWorkspaceEntityMutation({
          type: "restore_dismissed_discovery_job",
          jobId,
        }),
      removeJobFromReview: (jobId: string) =>
        runWorkspaceEntityMutation({
          type: "remove_job_from_review",
          jobId,
        }),
      getResumeWorkspace: (jobId: string) =>
        window.unemployed.jobFinder.getResumeWorkspace(jobId),
      previewResumeDraft: (draft: ResumeDraft, requestId?: string) =>
        window.unemployed.jobFinder.previewResumeDraft(draft, requestId),
      saveResumeDraft: (draft: ResumeDraft) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveResumeDraft(draft),
        ),
      regenerateResumeDraft: (jobId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.regenerateResumeDraft(jobId),
        ),
      regenerateResumeSection: (jobId: string, sectionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.regenerateResumeSection(jobId, sectionId),
        ),
      restoreResumeDraftRevision: (jobId: string, revisionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.restoreResumeDraftRevision(
            jobId,
            revisionId,
          ),
        ),
      undoResumeAssistantEdit: (jobId: string, revisionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.undoResumeAssistantEdit(
            jobId,
            revisionId,
          ),
        ),
      exportResumePdf: (
        jobId: string,
        intent: ResumePdfExportIntent = "download",
      ) =>
        runWorkspaceResultAction(() =>
          window.unemployed.jobFinder.exportResumePdf(jobId, intent),
        ),
      // Reveal is not a workspace mutation: it selects the written file in the
      // OS file manager and returns what happened, so it never refreshes.
      revealSavedFile: (path: string) =>
        window.unemployed.jobFinder.revealSavedFile(path),
      approveResume: (jobId: string, exportId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.approveResume(jobId, exportId),
        ),
      clearResumeApproval: (jobId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.clearResumeApproval(jobId),
        ),
      setWorkHistoryReviewAcknowledgment: (
        input: JobFinderSetWorkHistoryReviewAcknowledgmentInput,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setWorkHistoryReviewAcknowledgment(input),
        ),
      setResumeClaimConfirmation: (
        input: JobFinderSetResumeClaimConfirmationInput,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setResumeClaimConfirmation(input),
        ),
      applyResumePatch: (
        patch: ResumeDraftPatch,
        revisionReason?: string | null,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.applyResumePatch(patch, revisionReason),
        ),
      getResumeAssistantMessages: (jobId: string) =>
        window.unemployed.jobFinder.getResumeAssistantMessages(jobId),
      sendResumeAssistantMessage: (jobId: string, content: string) =>
        window.unemployed.jobFinder.sendResumeAssistantMessage(jobId, content),
      resolveResumeAssistantProposal: (
        jobId: string,
        proposalId: string,
        action: "accept" | "reject",
        patchIds: readonly string[],
      ) =>
        window.unemployed.jobFinder.resolveResumeAssistantProposal(
          jobId,
          proposalId,
          action,
          patchIds,
        ),
      generateResume: (jobId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.generateResume(jobId),
        ),
      startApplyCopilotRun: (input: JobFinderApplyCopilotActionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.startApplyCopilotRun(input),
        ),
      startAutoApplyRun: (input: JobFinderApplicationStartTarget) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.startAutoApplyRun(input),
        ),
      startAutoApplyQueueRun: (
        jobIds: JobFinderApplyQueueActionInput["jobIds"],
        applicationAutomationMode?: JobFinderApplyQueueActionInput["applicationAutomationMode"],
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.startAutoApplyQueueRun(
            jobIds,
            applicationAutomationMode,
          ),
        ),
      approveApplyRun: (input: JobFinderApplyRunActionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.approveApplyRun(input),
        ),
      cancelApplyRun: (input: JobFinderApplyRunActionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.cancelApplyRun(input),
        ),
      resolveApplyConsentRequest: (input: JobFinderApplyConsentActionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.resolveApplyConsentRequest(input),
        ),
      revokeApplyRunApproval: (input: JobFinderApplyRunActionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.revokeApplyRunApproval(input),
        ),
      focusPreparedApplicationPage: (
        input: JobFinderPreparedApplicationPageInput,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.focusPreparedApplicationPage(input),
        ),
      submitPreparedApplication: (input: { jobId: string }) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.submitPreparedApplication(input),
        ),
      sendPreparedApplications: (input: { jobIds: string[] }) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.sendPreparedApplications(input),
        ),
      mutateApplicationCrm: (input: ApplicationCrmMutationInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.mutateApplicationCrm(input),
        ),
      mutateApplicationCrmBulkStage: (
        input: ApplicationCrmBulkStageMutationInput,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.mutateApplicationCrmBulkStage(input),
        ),
      runApplicationNoResponseAutomation: (settings?: ApplicationCrmSettings) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.runApplicationNoResponseAutomation(
            settings,
          ),
        ),
      exportApplicationCrm: (input: ApplicationCrmExportInput) =>
        window.unemployed.jobFinder.exportApplicationCrm(input),
      importResume: (options?: { retryInterrupted?: boolean }) => {
        const requestSequence = ++resumeImportRequestSequenceRef.current;
        setWorkspaceState((currentState) =>
          currentState.status === "ready"
            ? { ...currentState, resumeImportProgress: null }
            : currentState,
        );
        const onImportProgress = (progress: ResumeImportProgressEvent) => {
          if (resumeImportRequestSequenceRef.current !== requestSequence) {
            return;
          }

          setWorkspaceState((currentState) =>
            currentState.status === "ready"
              ? { ...currentState, resumeImportProgress: progress }
              : currentState,
          );
        };
        const importPromise = runWorkspaceAction(() =>
          options?.retryInterrupted === true
            ? window.unemployed.jobFinder.importResume(onImportProgress, {
                retryInterrupted: true,
              })
            : window.unemployed.jobFinder.importResume(onImportProgress),
        );

        return importPromise.finally(() => {
          if (resumeImportRequestSequenceRef.current !== requestSequence) {
            return;
          }

          // Invalidate the callback before clearing its visible progress so a
          // late event from a closed picker cannot resurrect Guided setup's
          // busy state.
          resumeImportRequestSequenceRef.current += 1;
          setWorkspaceState((currentState) =>
            currentState.status === "ready"
              ? { ...currentState, resumeImportProgress: null }
              : currentState,
          );
        });
      },
      queueJobForReview: (jobId: string) =>
        runWorkspaceEntityMutation({
          type: "queue_job_for_review",
          jobId,
        }),
      setJobResumeApplicationMode: (
        jobId: string,
        resumeApplicationMode: ResumeApplicationMode,
        resumeTailoringMode?: TailoringMode | null,
      ) =>
        runWorkspaceEntityMutation({
          type: "set_job_resume_application_mode",
          jobId,
          resumeApplicationMode,
          ...(resumeTailoringMode === undefined ? {} : { resumeTailoringMode }),
        }),
      refreshWorkspace: syncWorkspace,
      resetWorkspace: () =>
        runWorkspaceAction(() => window.unemployed.jobFinder.resetWorkspace()),
      runAgentDiscovery: (
        onProgress?: (event: DiscoveryActivityEvent) => void,
        targetId?: string,
        searchRequest?: JobFinderSearchRequest,
      ) =>
        runWorkspaceResultAction(() =>
          window.unemployed.jobFinder.runAgentDiscovery(
            onProgress,
            targetId,
            searchRequest,
          ),
        ),
      cancelAgentDiscovery: (input) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.cancelAgentDiscovery(input),
        ),
      runSourceDebug: (
        targetId: string,
        onProgress?: (event: SourceDebugProgressEvent) => void,
        options?: { readabilityTimeoutMs?: number },
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.runSourceDebug(
            targetId,
            onProgress,
            options,
          ),
        ),
      getSourceDebugRunDetails: (runId: string) =>
        window.unemployed.jobFinder.getSourceDebugRunDetails(runId),
      getApplyRunDetails: (input: JobFinderApplyRunDetailsQuery) =>
        window.unemployed.jobFinder.getApplyRunDetails(input),
      saveApplicationAnswer: (command: SaveApplicationAnswerCommandInput) =>
        window.unemployed.jobFinder.saveApplicationAnswer(command),
      clearApplicationAnswer: (command: ClearApplicationAnswerCommandInput) =>
        window.unemployed.jobFinder.clearApplicationAnswer(command),
      projectGroupedManualAnswer: (
        command: ProjectGroupedManualAnswerCommand,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.projectGroupedManualAnswer(command),
        ),
      applyGroupedManualAnswer: (input: ApplyGroupedManualAnswerInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.applyGroupedManualAnswer(input),
        ),
      snoozeGroupedDecision: (input: SnoozeGroupedDecisionInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.snoozeGroupedDecision(input),
        ),
      exportApplicationPacket: (input: JobFinderApplyRunDetailsQuery) =>
        window.unemployed.jobFinder.exportApplicationPacket(input),
      resolveSubmissionOutcome: (input: ResolveSubmissionOutcomeInput) =>
        window.unemployed.jobFinder.resolveSubmissionOutcome(input),
      saveSourceInstructionArtifact: (
        targetId: string,
        artifact: EditableSourceInstructionArtifact,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveSourceInstructionArtifact(
            targetId,
            artifact,
          ),
        ),
      acceptSourceInstructionDraft: (targetId: string, instructionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.acceptSourceInstructionDraft(
            targetId,
            instructionId,
          ),
        ),
      verifySourceInstructions: (targetId: string, instructionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.verifySourceInstructions(
            targetId,
            instructionId,
          ),
        ),
      saveProfile: (profile: CandidateProfile) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveProfile(profile),
        ),
      saveWorkspaceInputs: (
        profile: CandidateProfile,
        searchPreferences: JobSearchPreferences,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveWorkspaceInputs(
            profile,
            searchPreferences,
          ),
        ),
      saveSearchPreferences: (searchPreferences: JobSearchPreferences) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveSearchPreferences(searchPreferences),
        ),
      saveCampaign: (campaign: SaveJobSearchCampaignInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveCampaign(campaign),
        ),
      selectCampaign: (campaignId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.selectCampaign(campaignId),
        ),
      runCampaignNow: (campaignId?: string | null) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.runCampaignNow(
            campaignId ? { campaignId } : undefined,
          ),
        ),
      markCampaignNotificationRead: (notificationId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.markCampaignNotificationRead(
            notificationId,
          ),
        ),
      markAllCampaignNotificationsRead: () =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.markAllCampaignNotificationsRead(),
        ),
      saveCampaignRule: (campaignId: string, rule: SaveCampaignRuleInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveCampaignRule(campaignId, rule),
        ),
      deleteCampaignRule: (campaignId: string, ruleId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.deleteCampaignRule(campaignId, ruleId),
        ),
      deleteCampaign: async (campaignId: string) => {
        const deleted =
          await window.unemployed.jobFinder.deleteJobSearchCampaign(campaignId);
        // A refused or failed deletion must leave the local snapshot alone.
        // Only a confirmed delete follows the canonical sync path so the
        // removed campaign disappears immediately and the backend-selected
        // fallback active campaign becomes authoritative. The sync fences its
        // commit through the workspace request sequence, so a slow refresh
        // can never overwrite a newer snapshot.
        if (!deleted) {
          return false;
        }

        await syncWorkspace();
        return true;
      },
      toggleCampaignRule: (
        campaignId: string,
        ruleId: string,
        enabled: boolean,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.toggleCampaignRule(
            campaignId,
            ruleId,
            enabled,
          ),
        ),
      projectCampaignRuleFunnel: (campaignId: string) =>
        window.unemployed.jobFinder.projectCampaignRuleFunnel(campaignId),
      setActivityControl: (input: SetJobFinderActivityControlInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setActivityControl(input),
        ),
      mutateRapidReview: (input: RapidReviewMutationInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.mutateRapidReview(input),
        ),
      recordOutcome: (input: RecordOutcomeInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.recordOutcome(input),
        ),
      saveResumeStrategy: (input: SaveResumeStrategyInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveResumeStrategy(input),
        ),
      disableResumeStrategy: (strategyId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.disableResumeStrategy(strategyId),
        ),
      selectResumeStrategy: (input: SelectResumeStrategyInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.selectResumeStrategy(input),
        ),
      recommendResumeStrategy: (input: RecommendResumeStrategyInput) =>
        window.unemployed.jobFinder.recommendResumeStrategy(input),
      setCampaignResumeStrategyDefault: (
        input: SetCampaignResumeStrategyDefaultInput,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setCampaignResumeStrategyDefault(input),
        ),
      refreshCompanyIntelligence: () =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.refreshCompanyIntelligence(),
        ),
      setCompanyPreference: (input: SetCompanyPreferenceInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setCompanyPreference(input),
        ),
      reviewCompanyMerge: (input: ReviewCompanyMergeInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.reviewCompanyMerge(input),
        ),
      mutateCompanyIntelligence: (input: CompanyIntelligenceMutationInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.mutateCompanyIntelligence(input),
        ),
      setOutcomeSuggestionEnabled: (input: SetOutcomeSuggestionEnabledInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.setOutcomeSuggestionEnabled(input),
        ),
      mutateSafeguards: (input: SafeguardMutationInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.mutateSafeguards(input),
        ),
      saveSettings: (settings: JobFinderSettings) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveSettings(settings),
        ),
      updateApplicationDefaults: (input: UpdateApplicationDefaultsInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.updateApplicationDefaults(input),
        ),
      updateWorkspaceBehavior: (input: UpdateWorkspaceBehaviorInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.updateWorkspaceBehavior(input),
        ),
      updateAiBehavior: (input: UpdateAiBehaviorInput) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.updateAiBehavior(input),
        ),
      updateAppearanceTheme: (appearanceTheme: AppearanceTheme) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.updateAppearanceTheme(appearanceTheme),
        ),
      updateTrackerCrm: (applicationCrm: ApplicationCrmSettings) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.updateTrackerCrm(applicationCrm),
        ),
      saveProfileSetupState: (profileSetupState: ProfileSetupState) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.saveProfileSetupState(profileSetupState),
        ),
      applyProfileSetupReviewAction: (
        reviewItemId: string,
        action: ProfileSetupReviewAction,
        options?: ProfileSetupReviewActionOptions,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.applyProfileSetupReviewAction(
            reviewItemId,
            action,
            options,
          ),
        ),
      applyResumeTimelineRepairAction: (
        runId: string,
        proposalId: string,
        action: ResumeTimelineRepairAction,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.applyResumeTimelineRepairAction(
            runId,
            proposalId,
            action,
          ),
        ),
      sendProfileCopilotMessage: (
        content: string,
        context?: ProfileCopilotContext,
      ) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.sendProfileCopilotMessage(
            content,
            context,
          ),
        ),
      applyProfileCopilotPatchGroup: (patchGroupId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.applyProfileCopilotPatchGroup(
            patchGroupId,
          ),
        ),
      rejectProfileCopilotPatchGroup: (patchGroupId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.rejectProfileCopilotPatchGroup(
            patchGroupId,
          ),
        ),
      undoProfileRevision: (revisionId: string) =>
        runWorkspaceAction(() =>
          window.unemployed.jobFinder.undoProfileRevision(revisionId),
        ),
    }),
    [
      runWorkspaceAction,
      runWorkspaceResultAction,
      runWorkspaceEntityMutation,
      syncWorkspace,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      const performanceRunId = ++performanceRunRef.current;
      const performancePrefix = `job-finder:workspace:${performanceRunId}`;
      markJobFinderTiming(`${performancePrefix}:bootstrap:start`);

      try {
        const [platformResponse, bootstrap] = await Promise.all([
          window.unemployed.ping(),
          typeof window.unemployed.jobFinder.getWorkspaceBootstrap ===
          "function"
            ? window.unemployed.jobFinder.getWorkspaceBootstrap()
            : recoverFullWorkspaceOnce(),
        ]);

        if (!cancelled) {
          // Keep the bootstrap snapshot as the authoritative visible state
          // before deferred hydration begins. The hydration failure path uses
          // this identity check to report a real failure; without recording it
          // here, that error is silently discarded because the ref is still
          // null while the shell is already showing the bootstrap.
          workspaceRef.current = bootstrap;
          if (bootstrap.hydration?.phase === "bootstrap") {
            workspaceRevisionRef.current = 0;
          }
          setWorkspaceState({
            status: "ready",
            actions,
            platform: platformResponse.platform,
            resumeImportProgress: null,
            workspace: bootstrap,
          });
          markJobFinderTiming(
            `${performancePrefix}:bootstrap:ready`,
            `${performancePrefix}:bootstrap:start`,
          );
          markJobFinderTiming("job-finder:workspace:bootstrap:ready");
        }

        // Keep the shell responsive while the large collections hydrate. The
        // hydration request is fenced like every other workspace request so a
        // later user action can never be overwritten by a stale full snapshot.
        if (bootstrap.hydration?.phase === "bootstrap") {
          const hydrationSequence = beginWorkspaceRequest();
          markJobFinderTiming(`${performancePrefix}:hydration:start`);
          markJobFinderTiming("job-finder:workspace:hydration:start");

          const reportHydrationFailure = (error: unknown) => {
            // Only a shell still waiting on hydration can surface this
            // failure; once any commit moved past the bootstrap phase the
            // workspace converged and the error would be noise.
            if (
              cancelled ||
              workspaceRef.current?.hydration?.phase !== "bootstrap"
            ) {
              return;
            }

            const message =
              error instanceof Error
                ? error.message
                : "Unable to finish loading the Job Finder workspace.";
            setWorkspaceState({
              status: "error",
              message,
              retry: () => {
                setWorkspaceState({ status: "loading" });
                setLoadRequest((current) => current + 1);
              },
              startupDatabaseRecovery: null,
            });
          };

          // An allowDuringBootstrap action can win the sequence race while
          // the shell still shows the partial bootstrap snapshot. Its commit
          // cannot finish hydration, so without help bootstrap stays stranded
          // (every gated action keeps failing). Loop one authoritative fetch
          // at a time: each attempt is dispatched after the previous request
          // settled, so it observes every commit that superseded its
          // predecessor, and the loop ends as soon as the visible phase moves
          // past "bootstrap". A failing attempt surfaces the retryable error
          // instead of silently stranding.
          const resumeStrandedBootstrap = async () => {
            while (
              !cancelled &&
              workspaceRef.current?.hydration?.phase === "bootstrap"
            ) {
              try {
                await recoverFullWorkspaceOnce();
              } catch (error) {
                reportHydrationFailure(error);
                return;
              }
            }
          };

          void recoverFullWorkspaceOnce(hydrationSequence)
            .then((hydratedWorkspace) => {
              if (hydratedWorkspace?.hydration?.phase === "complete") {
                markJobFinderTiming(
                  `${performancePrefix}:hydration:complete`,
                  `${performancePrefix}:hydration:start`,
                );
                markJobFinderTiming("job-finder:workspace:hydration:complete");
              }
              void resumeStrandedBootstrap();
            })
            .catch((error) => {
              if (
                cancelled ||
                !isCurrentWorkspaceRequest(hydrationSequence) ||
                workspaceRef.current !== bootstrap
              ) {
                // This failure was superseded: an action owns the surface or
                // a newer request already replaced the bootstrap snapshot.
                // Deterministically resume hydration rather than leaving the
                // partial bootstrap visible forever.
                void resumeStrandedBootstrap();
                return;
              }

              reportHydrationFailure(error);
            });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to load the Job Finder workspace.";

        if (!cancelled) {
          // Main records the typed incident synchronously before the
          // bootstrap request rejects, so fetching here (not earlier) always
          // observes it; a malformed or unrelated fact fails closed to the
          // generic retryable error.
          const startupDatabaseRecovery = selectBlockedStartupDatabaseRecovery(
            await requestStartupDatabaseRecoveryFact(),
          );

          if (!cancelled) {
            setWorkspaceState({
              status: "error",
              message,
              retry: () => {
                setWorkspaceState({ status: "loading" });
                setLoadRequest((current) => current + 1);
              },
              startupDatabaseRecovery,
            });
          }
        }
      }
    }

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    actions,
    beginWorkspaceRequest,
    isCurrentWorkspaceRequest,
    loadRequest,
    recoverFullWorkspaceOnce,
  ]);

  const capacityResetsAt =
    workspaceState.status === "ready"
      ? workspaceState.workspace.dashboard
          ?.globalDailyApplicationPreparationCapacity?.resetsAt
      : undefined;

  useEffect(() => {
    if (!capacityResetsAt) {
      return;
    }

    const resetAtMs = Date.parse(capacityResetsAt);
    if (!Number.isFinite(resetAtMs)) {
      return;
    }

    const refreshIfStale = () => {
      if (Date.now() >= resetAtMs) {
        void syncWorkspace().catch(() => undefined);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfStale();
      }
    };
    const timeout = window.setTimeout(
      refreshIfStale,
      Math.max(0, resetAtMs - Date.now() + 100),
    );
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [capacityResetsAt, syncWorkspace]);

  return workspaceState;
}
