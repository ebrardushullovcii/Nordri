import { useState } from "react";
import type {
  JobFinderPerformanceSnapshot,
  PerformanceEvidenceArea,
  PerformanceEvidenceBudgetStatus,
  PerformanceEvidenceStageId,
} from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";

const areaLabels: Record<PerformanceEvidenceArea, string> = {
  resume_import: "Resume import",
  resume_generation: "Resume generation",
  discovery: "Job discovery",
  application_preparation: "Application preparation",
  persistence: "Workspace persistence",
  ipc: "IPC round trip",
  renderer_commit: "Renderer commit",
};

const stageLabels: Record<PerformanceEvidenceStageId, string> = {
  "resume_import.text_branch": "AI text analysis",
  "resume_import.literal_extraction": "Literal extraction",
  "resume_import.reconciliation": "Reconciliation",
  "resume_import.finalization": "Finalization",
  "resume_import.identity_summary": "Identity and summary",
  "resume_import.experience": "Experience extraction",
  "resume_import.background": "Background extraction",
  "resume_import.shared_memory": "Shared-memory matching",
  "resume_generation.provider": "Provider generation",
  "resume_generation.grounding": "Grounding checks",
  "resume_generation.render": "Document render",
  "discovery.planning": "Planning",
  "discovery.target": "Source work",
  "discovery.navigation": "Navigation",
  "discovery.extraction": "Extraction",
  "discovery.scoring": "Scoring",
  "discovery.persistence": "Persistence",
  "discovery.run": "Run orchestration",
  "application_preparation.browser_preparation": "Browser preparation",
  "application_preparation.form_preparation": "Form preparation",
  "application_preparation.visual_diagnostics": "Visual diagnostics",
  "persistence.workspace_snapshot_read": "Workspace snapshot read",
  "ipc.workspace_round_trip": "Workspace IPC round trip",
  "renderer.discovery_results_commit": "Discovery results commit",
};

const budgetLabels: Record<PerformanceEvidenceBudgetStatus, string> = {
  pass: "Within budget",
  warning: "Budget warning",
  fail: "Over budget",
  not_evaluated: "No stable budget yet",
  unavailable: "No measurement",
};

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

export function SettingsPerformanceEvidence() {
  const [snapshot, setSnapshot] = useState<JobFinderPerformanceSnapshot | null>(
    null,
  );
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );

  async function loadPerformanceEvidence() {
    if (state === "loading") {
      return;
    }
    setState("loading");
    try {
      const next = await window.nordri.jobFinder.getPerformanceSnapshot();
      setSnapshot(next);
      setState("ready");
    } catch {
      setSnapshot(null);
      setState("failed");
    }
  }

  return (
    <section className="surface-panel-shell grid gap-3.5 rounded-(--radius-field) border border-(--surface-panel-border) px-4 py-4">
      <div className="grid gap-1.5">
        <p className="text-[10px] uppercase tracking-(--tracking-badge) text-muted-foreground">
          Performance
        </p>
        <h2 className="font-display font-semibold text-(--text-headline)">
          Workflow timing evidence
        </h2>
        <p className="text-sm leading-6 text-foreground-soft">
          Compare the latest recorded workflow stages and warning budgets. “Not
          recorded” is different from a measured 0 ms.
        </p>
      </div>

      <Button
        className="justify-self-start"
        onClick={() => void loadPerformanceEvidence()}
        pending={state === "loading"}
        type="button"
        variant="secondary"
      >
        {state === "loading"
          ? "Reading performance evidence"
          : snapshot
            ? "Refresh performance evidence"
            : "Load performance evidence"}
      </Button>

      {state === "failed" ? (
        <p aria-live="polite" className="text-sm text-destructive">
          Performance evidence could not be loaded. Try again.
        </p>
      ) : null}

      {snapshot ? (
        <div className="grid gap-2" data-testid="performance-evidence-list">
          {snapshot.evidence.map((entry) => (
            <article
              className="rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-subtle) p-3"
              key={entry.area}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {areaLabels[entry.area]}
                  </h3>
                  <p className="mt-1 text-(length:--text-description) text-foreground-muted">
                    {budgetLabels[entry.budgetStatus]}
                  </p>
                </div>
                <strong className="text-sm text-(--text-headline)">
                  {entry.measurementStatus === "available"
                    ? formatDuration(entry.durationMs)
                    : entry.measurementStatus === "partial"
                      ? "Total not recorded"
                      : "Not recorded"}
                </strong>
              </div>

              {entry.stageDurations.length > 0 ? (
                <details className="mt-3 border-t border-(--surface-panel-border) pt-2">
                  <summary className="cursor-pointer text-(length:--text-description) font-medium text-foreground-soft">
                    Stage details
                  </summary>
                  <dl className="mt-2 grid gap-1 text-(length:--text-description) text-foreground-muted">
                    {entry.stageDurations.map((stage) => (
                      <div
                        className="flex justify-between gap-3"
                        key={stage.id}
                      >
                        <dt>{stageLabels[stage.id]}</dt>
                        <dd>{formatDuration(stage.durationMs)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
