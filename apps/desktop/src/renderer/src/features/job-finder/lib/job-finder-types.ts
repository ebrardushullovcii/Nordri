import type {
  ApplicationCrmBulkStageMutationInput,
  ApplicationCrmExportInput,
  ApplicationCrmFileExportResult,
  ApplicationCrmMutationInput,
  ApplicationCrmSettings,
  ApplyGroupedManualAnswerInput,
  ApplyRunDetails,
  AppearanceTheme,
  CampaignRuleFunnelProjection,
  CandidateAnswerKind,
  CandidateLinkKind,
  CandidateProfile,
  ClearApplicationAnswerCommandInput,
  CompanyIntelligenceMutationInput,
  DiscoveryActivityEvent,
  DiscoveryFeedbackReason,
  EditableSourceInstructionArtifact,
  EmployerExclusionPreview,
  JobFinderApplicationPacketExportResult,
  ResolveSubmissionOutcomeInput,
  ResolveSubmissionOutcomeResult,
  JobFinderApplyConsentActionInput,
  JobFinderApplyCopilotActionInput,
  JobFinderApplyQueueActionInput,
  JobFinderApplyRunActionInput,
  JobFinderApplyRunDetailsQuery,
  JobFinderApplicationStartTarget,
  JobFinderPreparedApplicationPageInput,
  JobFinderAgentDiscoveryResult,
  JobFinderSearchRequest,
  JobFinderDiscoveryCancellationInput,
  JobFinderOpenBrowserSessionInput,
  JobFinderResumePreview,
  JobFinderResumeWorkspace,
  JobFinderSetResumeClaimConfirmationInput,
  JobFinderSetWorkHistoryReviewAcknowledgmentInput,
  JobFinderSettings,
  JobSearchPreferences,
  RapidReviewMutationInput,
  RecommendResumeStrategyInput,
  RecordOutcomeInput,
  ResumeStrategyRecommendation,
  ReviewCompanyMergeInput,
  SaveResumeStrategyInput,
  SafeguardMutationInput,
  SaveCampaignRuleInput,
  SaveJobSearchCampaignInput,
  SelectResumeStrategyInput,
  SetCampaignResumeStrategyDefaultInput,
  SetCompanyPreferenceInput,
  SetJobFinderActivityControlInput,
  SetOutcomeSuggestionEnabledInput,
  JobFinderWorkspaceSnapshot,
  JobSourceAdapterKind,
  ProfileCopilotContext,
  ProfileSetupReviewAction,
  ProfileSetupReviewActionOptions,
  ProfileSetupState,
  ProjectGroupedManualAnswerCommand,
  ResumeAssistantMessage,
  ResumeApplicationMode,
  TailoringMode,
  JobFinderResumePdfExportResult,
  ResumePdfExportIntent,
  RemoveEmployerExclusionInput,
  RevealSavedFileResult,
  ResumeDraft,
  ResumeDraftPatch,
  ResumeTimelineRepairAction,
  SaveApplicationAnswerCommandInput,
  SnoozeGroupedDecisionInput,
  SourceDebugProgressEvent,
  SourceDebugRunDetails,
  SourceInstructionStatus,
  UpdateApplicationDefaultsInput,
  UpdateWorkspaceBehaviorInput,
  UpdateAiBehaviorInput,
  WorkMode,
  UserActionCommandInput,
} from "@unemployed/contracts";

export type JobFinderScreen =
  | "home"
  | "profile"
  | "discovery"
  | "review-queue"
  | "applications"
  | "campaigns"
  | "actions"
  | "analytics"
  | "settings"
  | "rapid-review"
  | "resume-strategies"
  | "safeguards"
  | "companies";

/**
 * Typed result of starting an employer-application batch queue. Curation is
 * consumed only on `confirmed`; every other status preserves the exact
 * staged selection so a refusal, handled backend failure, or unknown ending
 * can never silently discard the user's review work.
 */
export type JobFinderAutoApplyQueueStartOutcome =
  | { status: "confirmed" }
  | {
      status: "refused";
      reason:
        | "daily_capacity_exhausted"
        | "empty_selection"
        | "cancelled_stayed_in_workspace";
      message: string | null;
    }
  | { status: "failed"; message: string | null }
  | { status: "unknown" };

export interface JobFinderShellActions {
  analyzeProfileFromResume: () => Promise<JobFinderWorkspaceSnapshot>;
  openBrowserSession: (
    input?: JobFinderOpenBrowserSessionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  checkBrowserSession: () => Promise<JobFinderWorkspaceSnapshot>;
  performUserAction: (
    command: UserActionCommandInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  refreshWorkspace: () => Promise<JobFinderWorkspaceSnapshot>;
  resetWorkspace: () => Promise<JobFinderWorkspaceSnapshot>;
  runAgentDiscovery: (
    onActivity?: (event: DiscoveryActivityEvent) => void,
    targetId?: string,
    searchRequest?: JobFinderSearchRequest,
  ) => Promise<JobFinderAgentDiscoveryResult>;
  cancelAgentDiscovery: (
    input: JobFinderDiscoveryCancellationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  runSourceDebug: (
    targetId: string,
    onProgress?: (event: SourceDebugProgressEvent) => void,
    options?: { readabilityTimeoutMs?: number },
  ) => Promise<JobFinderWorkspaceSnapshot>;
  getSourceDebugRunDetails: (runId: string) => Promise<SourceDebugRunDetails>;
  getApplyRunDetails: (
    input: JobFinderApplyRunDetailsQuery,
  ) => Promise<ApplyRunDetails>;
  saveApplicationAnswer: (
    command: SaveApplicationAnswerCommandInput,
  ) => Promise<ApplyRunDetails>;
  clearApplicationAnswer: (
    command: ClearApplicationAnswerCommandInput,
  ) => Promise<ApplyRunDetails>;
  projectGroupedManualAnswer: (
    command: ProjectGroupedManualAnswerCommand,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  applyGroupedManualAnswer: (
    input: ApplyGroupedManualAnswerInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  snoozeGroupedDecision: (
    input: SnoozeGroupedDecisionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  exportApplicationPacket: (
    input: JobFinderApplyRunDetailsQuery,
  ) => Promise<JobFinderApplicationPacketExportResult>;
  resolveSubmissionOutcome: (
    input: ResolveSubmissionOutcomeInput,
  ) => Promise<ResolveSubmissionOutcomeResult>;
  saveSourceInstructionArtifact: (
    targetId: string,
    artifact: EditableSourceInstructionArtifact,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  acceptSourceInstructionDraft: (
    targetId: string,
    instructionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  verifySourceInstructions: (
    targetId: string,
    instructionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  importResume: (options?: {
    retryInterrupted?: boolean;
  }) => Promise<JobFinderWorkspaceSnapshot>;
  saveProfile: (
    profile: CandidateProfile,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveWorkspaceInputs: (
    profile: CandidateProfile,
    searchPreferences: JobSearchPreferences,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveSearchPreferences: (
    searchPreferences: JobSearchPreferences,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveCampaign: (
    campaign: SaveJobSearchCampaignInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  selectCampaign: (campaignId: string) => Promise<JobFinderWorkspaceSnapshot>;
  runCampaignNow: (
    campaignId?: string | null,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  markCampaignNotificationRead: (
    notificationId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  markAllCampaignNotificationsRead: () => Promise<JobFinderWorkspaceSnapshot>;
  saveCampaignRule: (
    campaignId: string,
    rule: SaveCampaignRuleInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  deleteCampaignRule: (
    campaignId: string,
    ruleId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  deleteCampaign: (campaignId: string) => Promise<boolean>;
  toggleCampaignRule: (
    campaignId: string,
    ruleId: string,
    enabled: boolean,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  projectCampaignRuleFunnel: (
    campaignId: string,
  ) => Promise<CampaignRuleFunnelProjection>;
  setActivityControl: (
    input: SetJobFinderActivityControlInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  mutateRapidReview: (
    input: RapidReviewMutationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  recordOutcome: (
    input: RecordOutcomeInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveResumeStrategy: (
    input: SaveResumeStrategyInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  disableResumeStrategy: (
    strategyId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  selectResumeStrategy: (
    input: SelectResumeStrategyInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  recommendResumeStrategy: (
    input: RecommendResumeStrategyInput,
  ) => Promise<ResumeStrategyRecommendation>;
  setCampaignResumeStrategyDefault: (
    input: SetCampaignResumeStrategyDefaultInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  refreshCompanyIntelligence: () => Promise<JobFinderWorkspaceSnapshot>;
  setCompanyPreference: (
    input: SetCompanyPreferenceInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  reviewCompanyMerge: (
    input: ReviewCompanyMergeInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  mutateCompanyIntelligence: (
    input: CompanyIntelligenceMutationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  setOutcomeSuggestionEnabled: (
    input: SetOutcomeSuggestionEnabledInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  mutateSafeguards: (
    input: SafeguardMutationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveSettings: (
    settings: JobFinderSettings,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  updateApplicationDefaults: (
    input: UpdateApplicationDefaultsInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  updateWorkspaceBehavior: (
    input: UpdateWorkspaceBehaviorInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  updateAiBehavior: (
    input: UpdateAiBehaviorInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  updateAppearanceTheme: (
    appearanceTheme: AppearanceTheme,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  updateTrackerCrm: (
    applicationCrm: ApplicationCrmSettings,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  saveProfileSetupState: (
    profileSetupState: ProfileSetupState,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  applyProfileSetupReviewAction: (
    reviewItemId: string,
    action: ProfileSetupReviewAction,
    options?: ProfileSetupReviewActionOptions,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  applyResumeTimelineRepairAction: (
    runId: string,
    proposalId: string,
    action: ResumeTimelineRepairAction,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  sendProfileCopilotMessage: (
    content: string,
    context?: ProfileCopilotContext,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  applyProfileCopilotPatchGroup: (
    patchGroupId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  rejectProfileCopilotPatchGroup: (
    patchGroupId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  undoProfileRevision: (
    revisionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  queueJobForReview: (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;
  setJobResumeApplicationMode: (
    jobId: string,
    resumeApplicationMode: ResumeApplicationMode,
    resumeTailoringMode?: TailoringMode | null,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  removeJobFromReview: (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;
  dismissDiscoveryJob: (
    jobId: string,
    reasons: readonly DiscoveryFeedbackReason[],
    action?: "hide_job" | "hide_and_exclude_employer",
    expectedNormalizedCompanyName?: string | null,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  previewEmployerExclusion: (
    jobId: string,
  ) => Promise<EmployerExclusionPreview>;
  removeEmployerExclusion: (
    input: RemoveEmployerExclusionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  restoreDismissedDiscoveryJob: (
    jobId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  getResumeWorkspace: (jobId: string) => Promise<JobFinderResumeWorkspace>;
  previewResumeDraft: (
    draft: ResumeDraft,
    requestId?: string,
  ) => Promise<JobFinderResumePreview>;
  saveResumeDraft: (draft: ResumeDraft) => Promise<JobFinderWorkspaceSnapshot>;
  regenerateResumeDraft: (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;
  regenerateResumeSection: (
    jobId: string,
    sectionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  restoreResumeDraftRevision: (
    jobId: string,
    revisionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  undoResumeAssistantEdit: (
    jobId: string,
    revisionId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  exportResumePdf: (
    jobId: string,
    intent?: ResumePdfExportIntent,
  ) => Promise<JobFinderResumePdfExportResult>;
  /**
   * Shows a file the app wrote in the OS file manager. The export already
   * named the path and then left the person to find it by hand; nothing is
   * opened or executed, only selected.
   */
  revealSavedFile: (path: string) => Promise<RevealSavedFileResult>;
  approveResume: (
    jobId: string,
    exportId: string,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  clearResumeApproval: (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;
  setWorkHistoryReviewAcknowledgment: (
    input: JobFinderSetWorkHistoryReviewAcknowledgmentInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  setResumeClaimConfirmation: (
    input: JobFinderSetResumeClaimConfirmationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  applyResumePatch: (
    patch: ResumeDraftPatch,
    revisionReason?: string | null,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  getResumeAssistantMessages: (
    jobId: string,
  ) => Promise<readonly ResumeAssistantMessage[]>;
  sendResumeAssistantMessage: (
    jobId: string,
    content: string,
  ) => Promise<readonly ResumeAssistantMessage[]>;
  resolveResumeAssistantProposal: (
    jobId: string,
    proposalId: string,
    action: "accept" | "reject",
    patchIds: readonly string[],
  ) => Promise<readonly ResumeAssistantMessage[]>;
  generateResume: (jobId: string) => Promise<JobFinderWorkspaceSnapshot>;
  startApplyCopilotRun: (
    input: JobFinderApplyCopilotActionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  startAutoApplyRun: (
    input: JobFinderApplicationStartTarget,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  startAutoApplyQueueRun: (
    jobIds: JobFinderApplyQueueActionInput["jobIds"],
    applicationAutomationMode?: JobFinderApplyQueueActionInput["applicationAutomationMode"],
  ) => Promise<JobFinderWorkspaceSnapshot>;
  approveApplyRun: (
    input: JobFinderApplyRunActionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  cancelApplyRun: (
    input: JobFinderApplyRunActionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  resolveApplyConsentRequest: (
    input: JobFinderApplyConsentActionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  revokeApplyRunApproval: (
    input: JobFinderApplyRunActionInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  focusPreparedApplicationPage: (
    input: JobFinderPreparedApplicationPageInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  /** Sends one application the person has already looked over. */
  submitPreparedApplication: (input: {
    jobId: string;
  }) => Promise<JobFinderWorkspaceSnapshot>;
  /** Send for me: sends each filled-in form under one permission. */
  sendPreparedApplications: (input: {
    jobIds: string[];
  }) => Promise<JobFinderWorkspaceSnapshot>;
  approveApply: (
    input: JobFinderApplicationStartTarget,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  mutateApplicationCrm: (
    input: ApplicationCrmMutationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  mutateApplicationCrmBulkStage: (
    input: ApplicationCrmBulkStageMutationInput,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  runApplicationNoResponseAutomation: (
    settings?: ApplicationCrmSettings,
  ) => Promise<JobFinderWorkspaceSnapshot>;
  exportApplicationCrm: (
    input: ApplicationCrmExportInput,
  ) => Promise<ApplicationCrmFileExportResult>;
}

export interface ScreenDefinition {
  id: JobFinderScreen;
  label: string;
  count: number | null;
}

export type ExperienceFormEntry = {
  id: string;
  companyName: string;
  companyUrl: string;
  title: string;
  employmentType: string;
  location: string;
  workMode: WorkMode[];
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: string;
  achievements: string;
  skills: string;
  domainTags: string;
  peopleManagementScope: string;
  ownershipScope: string;
  sourceCandidateId?: string | null;
  sourceCandidateFingerprint?: string | null;
};

export type EducationFormEntry = {
  id: string;
  schoolName: string;
  degree: string;
  fieldOfStudy: string;
  location: string;
  startDate: string;
  endDate: string;
  summary: string;
  sourceCandidateId?: string | null;
  sourceCandidateFingerprint?: string | null;
};

export type CertificationFormEntry = {
  id: string;
  name: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  credentialUrl: string;
};

export type LinkFormEntry = {
  id: string;
  label: string;
  url: string;
  kind: CandidateLinkKind | "";
};

export type ProjectFormEntry = {
  id: string;
  name: string;
  projectType: string;
  summary: string;
  role: string;
  skills: string;
  outcome: string;
  projectUrl: string;
  repositoryUrl: string;
  caseStudyUrl: string;
};

export type LanguageFormEntry = {
  id: string;
  language: string;
  proficiency: string;
  interviewPreference: boolean;
  notes: string;
};

export type ProofBankEntryFormEntry = {
  id: string;
  title: string;
  claim: string;
  heroMetric: string;
  supportingContext: string;
  roleFamilies: string;
  projectIds: string;
  linkIds: string;
};

export type ReusableAnswerFormEntry = {
  id: string;
  label: string;
  question: string;
  answer: string;
  kind: CandidateAnswerKind;
  roleFamilies: string;
  proofEntryIds: string;
};

export type DiscoveryTargetEditorValue = {
  id: string;
  label: string;
  startingUrl: string;
  enabled: boolean;
  adapterKind: JobSourceAdapterKind;
  customInstructions: string;
  instructionStatus: SourceInstructionStatus;
  validatedInstructionId: string | null;
  draftInstructionId: string | null;
  lastDebugRunId: string | null;
  lastVerifiedAt: string | null;
  staleReason: string | null;
};

export type BooleanSelectValue = "" | "yes" | "no";

export type BadgeTone =
  | "active"
  | "critical"
  | "muted"
  | "neutral"
  | "positive"
  /**
   * Attention that is not yet a failure: a blocked claim, a pending
   * work-history decision, a paused run awaiting the user. Before this member
   * existed those states borrowed `critical` (overstating them) or `neutral`
   * (hiding them), while `--warning-text` was used by nothing.
   */
  | "warning";

export interface ActionState {
  message: string | null;
  /**
   * A file this action just wrote, when the message names its path. The
   * surface that prints the message offers "Open folder" beside it, so the
   * path is an action rather than something to retype.
   */
  savedFilePath?: string | null;
  /** Where the message's natural next step lives, offered beside it. */
  actionLink?: { label: string; route: string } | null;
}

/**
 * Request-local resolution of one Shortlist decision. `onQueueJob` returns
 * this awaited outcome so the Discovery screen can attribute feedback to the
 * exact clicked job; the shared route-scoped `ActionState` keeps serving other
 * surfaces but is never the attribution authority for a shortlist row.
 */
export type JobFinderQueuedJobOutcome = {
  message: string;
  status: "success" | "failure";
};
