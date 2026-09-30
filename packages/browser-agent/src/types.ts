import type {
  AgentDebugFindings,
  DiscoveryAccessBlockerReason,
  BrowserVisualAnalysisContext,
  BrowserVisualObservationSet,
  BrowserVisualSnapshotRef,
  BrowserVisualSnapshotRequest,
  BrowserAgentRunCheckpoint,
  JobPosting,
  JobFinderSearchRequest,
  JobSearchCampaignMode,
  AiJobSearchBehavior,
  CandidateProfile,
  AgentDiscoveryProgress,
  JobSource,
  SharedAgentCompactionPolicy,
  SharedAgentCompactionSnapshot,
  SharedAgentCompactionTriggerKind,
  SourceDebugCompactionState,
  SourceDebugPhase,
  SourceDebugPhaseCompletionMode,
  SourceDebugPhaseEvidence,
  Tool,
  ToolCall,
} from "@nordri/contracts";
import type { Page } from "playwright";
import type {
  SearchResultCardCandidate,
  StructuredDataJobCandidate,
} from "./agent/job-extraction";

// Re-export shared types from contracts
export type { Tool, ToolCall };

// Narrow interface for search preferences used by the agent
export interface AgentSearchPreferences {
  targetRoles: string[];
  locations: string[];
  workModes?: string[];
}

export interface AgentNavigationPolicy {
  allowedHostnames: string[];
  allowSubdomains?: boolean;
}

export interface AgentPromptContext {
  siteLabel: string;
  /** Whether this run should favor only strong fits or find a broad pool. */
  searchMode?: JobSearchCampaignMode;
  searchRequest?: JobFinderSearchRequest;
  /** The saved AI search behavior: how picky, and how remote counts. */
  searchGuidance?: AiJobSearchBehavior;
  siteInstructions?: string[];
  toolUsageNotes?: string[];
  experimental?: boolean;
  taskPacket?: {
    phase: SourceDebugPhase;
    phaseGoal: string;
    knownFacts: string[];
    priorPhaseSummary?: string | null;
    avoidStrategyFingerprints: string[];
    successCriteria: string[];
    stopConditions: string[];
    manualPrerequisiteState?: string | null;
    strategyLabel?: string | null;
  };
}

export interface AgentExtractionContext {
  relevantUrlSubstrings?: string[];
}

export interface DeferredSearchExtraction {
  key: string;
  pageUrl: string;
  pageText: string;
  capturedAt: string;
  structuredDataCandidates?: StructuredDataJobCandidate[];
  cardCandidates?: SearchResultCardCandidate[];
}

export interface AgentCompactionConfig {
  enabled: boolean;
  warningTokenBudget: number;
  targetTokenBudget: number;
  minimumResponseHeadroomTokens: number;
  preserveRecentMessages: number;
  minimumPreserveRecentMessages: number;
  maxToolPayloadChars: number;
  messageCountFallbackThreshold: number;
}

export interface AgentTokenEstimatorContext {
  messages: readonly AgentMessage[];
  maxOutputTokens: number;
}

export interface AgentTokenEstimatorResult {
  estimatedInputTokens: number;
  estimatedTotalTokens: number;
}

export interface AgentCompactionCapability {
  tokenEstimator?: (
    context: AgentTokenEstimatorContext,
  ) => AgentTokenEstimatorResult | null;
  modelContextWindowTokens?: number | null;
  compactionWorkflowKey?: string;
}

export interface AgentCompactionStatus {
  lastTriggerKind: SharedAgentCompactionTriggerKind | null;
  usedMessageCountFallback: boolean;
  lastEstimatedTokensBefore: number | null;
  lastEstimatedTokensAfter: number | null;
}

export interface AgentConfig {
  /** No person-specified result cap; retain every suitable posting found. */
  retainAllFound?: boolean;
  /** Public feed postings available for the model to inspect and select. */
  sourceCatalog?: JobPosting[];
  /** True only for a complete authoritative inventory of this source. */
  sourceCatalogComplete?: boolean;
  source: JobSource;
  maxSteps: number;
  /** Legacy-compatible emergency ceiling. Normal completion is progress based. */
  runControl?: {
    timeBudgetMs?: number;
    noProgressStepLimit?: number;
  };
  targetJobCount: number;
  userProfile: CandidateProfile;
  searchPreferences: AgentSearchPreferences;
  startingUrls: string[];
  /**
   * Enables the widened review budget for a weak same-host job board only after
   * generic extraction has evidence that multiple jobs live on one host without
   * durable detail URLs. This is an adapter capability signal, not a per-source
   * route override.
   */
  weakSameHostBoard?: boolean;
  navigationPolicy: AgentNavigationPolicy;
  promptContext: AgentPromptContext;
  extractionContext?: AgentExtractionContext;
  compaction?: Partial<SharedAgentCompactionPolicy>;
  compactionCapability?: AgentCompactionCapability;
  resolveLivePage?: () => Promise<Page>;
  visualAnalysis?: AgentVisualAnalysisCapability;
  resumeCheckpoint?: BrowserAgentRunCheckpoint;
  onCheckpoint?: (
    checkpoint: BrowserAgentRunCheckpoint,
  ) => Promise<void> | void;
}

export type AgentVisualAnalysisCapability =
  | { enabled: false }
  | {
      enabled: true;
      captureSnapshot: (
        request: BrowserVisualSnapshotRequest,
        page?: Page,
      ) => Promise<BrowserVisualSnapshotRef>;
      analyzeSnapshot: (input: {
        snapshot: BrowserVisualSnapshotRef;
        context: BrowserVisualAnalysisContext;
      }) => Promise<BrowserVisualObservationSet>;
      persistScreenshots?: boolean;
    };

export interface AgentState {
  conversation: AgentMessage[];
  reviewTranscript: string[];
  collectedJobs: JobPosting[];
  deferredSearchExtractions: Map<string, DeferredSearchExtraction>;
  failedInteractionAttempts?: Map<string, { count: number; lastError: string }>;
  failedInteractionPageStateToken?: string;
  visitedUrls: Set<string>;
  stepCount: number;
  currentUrl: string;
  lastStableUrl: string;
  visualObservationSets: BrowserVisualObservationSet[];
  visualSnapshots: BrowserVisualSnapshotRef[];
  isRunning: boolean;
  phaseEvidence: SourceDebugPhaseEvidence;
  compactionState: SourceDebugCompactionState | null;
  compactionStatus: AgentCompactionStatus;
  /**
   * Dedupe key for the last seeded-query drift guard note, formatted as
   * "blockedUrl|restoredUrl". Undefined until a drift recovery has been reported.
   */
  lastSeededDrift?: string;
}

export interface AgentResult {
  jobs: JobPosting[];
  steps: number;
  incomplete?: boolean;
  warning?: string;
  error?: string;
  transcriptMessageCount: number;
  reviewTranscript?: string[];
  compactionState?: SharedAgentCompactionSnapshot | null;
  compactionUsedFallbackTrigger?: boolean;
  phaseCompletionMode?: SourceDebugPhaseCompletionMode | null;
  phaseCompletionReason?: string | null;
  phaseEvidence?: SourceDebugPhaseEvidence | null;
  debugFindings?: AgentDebugFindings | null;
  accessBlockerReason?: DiscoveryAccessBlockerReason;
  parkedPageUrl?: string;
}

// Re-export AgentDiscoveryProgress from contracts for consistency
export type AgentProgress = AgentDiscoveryProgress;

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolContext {
  page: Page;
  state: AgentState;
  config: AgentConfig;
}

export type ToolExecutor = (
  args: unknown,
  context: ToolContext,
) => Promise<ToolResult>;

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  retryable?: boolean;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: ToolExecutor;
}

export type OnProgressCallback = (progress: AgentProgress) => void;
