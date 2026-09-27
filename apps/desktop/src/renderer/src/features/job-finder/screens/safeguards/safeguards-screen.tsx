import { PageHeaderStack } from "../../components/page-header";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  JobFinderWorkspaceSnapshot,
  SafeguardMutationInput,
} from "@unemployed/contracts";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { EmptyState } from "@renderer/features/job-finder/components/empty-state";
import { Input } from "@renderer/components/ui/input";
import { StatusBadge } from "@renderer/features/job-finder/components/status-badge";
import {
  formatDailyPreparationCapacityReachedText,
  isDailyPreparationCapacityExhausted,
} from "@renderer/features/job-finder/lib/job-finder-daily-capacity";
import { cn } from "@renderer/lib/utils";
import { SafeguardsApplicationBoundary } from "./safeguards-application-boundary";
import {
  buildSafeguardsPresentationModel,
  filterSafeguardRows,
  safeguardMutationKey,
  type SafeguardControl,
  type SafeguardRow,
  type SafeguardTabId,
} from "./safeguards-presentation";

const TAB_ORDER: readonly { id: SafeguardTabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "caps", label: "Application limits" },
  { id: "conflicts", label: "Conflicts" },
  { id: "signals", label: "Listing signals" },
  { id: "pauses", label: "Automatic pauses" },
  { id: "reviews", label: "Reviews" },
  { id: "contradictions", label: "Conflicting answers" },
  { id: "dismissals", label: "Dismissals" },
];

function SafeguardRowCard(props: {
  isPending: (controlId: string) => boolean;
  onMutate: (mutation: SafeguardMutationInput) => Promise<boolean>;
  row: SafeguardRow;
}) {
  const { isPending, onMutate, row } = props;
  const [error, setError] = useState<string | null>(null);

  async function runControl(control: SafeguardControl) {
    setError(null);
    const ok = await onMutate(control.mutation);
    if (!ok) {
      setError("That safeguard change could not be saved. Try again.");
    }
  }

  return (
    <article
      aria-label={row.title}
      className="grid gap-3 rounded-(--radius-field) border border-(--surface-panel-border) bg-background/40 px-4 py-3"
      data-safeguard-kind={row.kind}
      data-safeguard-blocked={row.blocked ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h3 className="font-semibold text-foreground">{row.title}</h3>
          <p className="break-words text-(length:--text-small) text-foreground-soft">
            {row.subtitle}
          </p>
        </div>
        <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
      </div>

      <div className="grid gap-1 text-(length:--text-small) leading-5">
        <p className="text-foreground">{row.explanation}</p>
        <p className="text-foreground-soft">Recovery: {row.recoveryGuidance}</p>
      </div>

      {row.lineage.jobs.length > 0 ||
      row.lineage.companies.length > 0 ||
      row.lineage.campaigns.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-(length:--text-small) leading-5">
          {row.lineage.jobs.length > 0 ? (
            <>
              <dt className="text-foreground-muted">Jobs</dt>
              <dd className="text-foreground">
                {row.lineage.jobs.map((label) => (
                  <span className="block truncate" key={label} title={label}>
                    {label}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {row.lineage.companies.length > 0 ? (
            <>
              <dt className="text-foreground-muted">Companies</dt>
              <dd className="text-foreground">
                {row.lineage.companies.map((label) => (
                  <span className="block truncate" key={label} title={label}>
                    {label}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {row.lineage.campaigns.length > 0 ? (
            <>
              <dt className="text-foreground-muted">Search plans</dt>
              <dd className="text-foreground">
                {row.lineage.campaigns.map((label) => (
                  <span className="block truncate" key={label} title={label}>
                    {label}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {row.sampleLinks?.map((link) => (
          <Button
            asChild
            key={link.href}
            size="sm"
            type="button"
            variant="outline"
          >
            <Link to={link.href}>Review {link.label}</Link>
          </Button>
        ))}
        {/* The recovery sentence above names a place to look. This is that
            place, so the guidance is never an instruction the page refuses to
            carry out. */}
        {row.recoveryLink ? (
          <Button asChild size="sm" type="button" variant="outline">
            <Link to={row.recoveryLink.href}>{row.recoveryLink.label}</Link>
          </Button>
        ) : null}
        <span className="ml-auto flex flex-wrap justify-end gap-2">
          {row.controls.map((control) => (
            <Button
              disabled={isPending(safeguardMutationKey(control.mutation))}
              key={control.id}
              onClick={() => void runControl(control)}
              size="sm"
              type="button"
              variant={control.kind === "resolve" ? "primary" : "outline"}
            >
              {isPending(safeguardMutationKey(control.mutation))
                ? "Working…"
                : control.label}
            </Button>
          ))}
        </span>
      </div>
      {error ? (
        <p
          className="rounded-md border border-(--warning-border) bg-(--warning-surface) px-3 py-2 text-(length:--text-small) leading-5 text-foreground-soft"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function SafeguardsScreen(props: {
  actionMessage: string | null;
  isPending: (controlId: string) => boolean;
  onMutateSafeguards: (input: SafeguardMutationInput) => Promise<boolean>;
  workspace: JobFinderWorkspaceSnapshot | null;
}) {
  const { actionMessage, isPending, onMutateSafeguards, workspace } = props;
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<SafeguardTabId>(
    searchParams.get("tab") === "reviews" ? "reviews" : "all",
  );
  const [query, setQuery] = useState("");
  const [eventsOpenOverride, setEventsOpenOverride] = useState<boolean | null>(
    null,
  );

  const model = useMemo(
    () =>
      workspace
        ? buildSafeguardsPresentationModel({
            safeguards: workspace.intelligence.safeguards,
            workspace,
          })
        : null,
    [workspace],
  );

  if (!workspace || !model) {
    return (
      <div className="grid min-h-72 place-items-center" role="status">
        <p className="text-(length:--text-small) text-foreground-soft">
          Loading safeguards…
        </p>
      </div>
    );
  }

  const blockedCount = model.counts.blockers;
  const isEmpty = model.rows.length === 0;
  // Zero-count filters were seven of eight chips on a healthy workspace and
  // wrapped the row onto a second line for nothing. Only categories that have
  // something in them are offered.
  const visibleTabs = TAB_ORDER.filter(
    (entry) => entry.id === "all" || countForTab(model.counts, entry.id) > 0,
  );
  const activeTab = visibleTabs.some((entry) => entry.id === tab) ? tab : "all";
  const visibleRows = filterSafeguardRows(model.rows, activeTab, query);
  const isNoMatch = !isEmpty && visibleRows.length === 0;
  // The event engine is secondary to the boundary above it, so it stays
  // folded away unless something is actually blocking work.
  const eventsOpen = eventsOpenOverride ?? blockedCount > 0;
  // The fixed local-day preparation limit is a limit, not a blocker: with no
  // slots left the page must not claim that "preparation is clear".
  const dailyCapacity =
    workspace.dashboard?.globalDailyApplicationPreparationCapacity ?? null;
  const dailyCapacityExhausted =
    isDailyPreparationCapacityExhausted(dailyCapacity);

  return (
    <section aria-label="High-volume safeguards" className="grid gap-4">
      {/* This screen used to paint its own <h1> at a bespoke size, so its
          page title could drift away from every other route's. It goes
          through the shared PageHeader like the rest of the app. The card
          below states the boundary in full, so the description no longer
          paraphrases it in smaller type first. */}
      <PageHeaderStack
        description="What Job Finder is allowed to do on an application site, and the automatic limits that keep a high-volume search safe."
        meta="Quality and reputation"
        title="Safeguards"
      />

      <SafeguardsApplicationBoundary />

      {/* Limits are read when a run starts, so a change never reaches the
          run already in progress; and the per-plan limits and stop rules
          are edited on the plan, not here, which this page used to leave
          unsaid. */}
      <p className="text-(length:--text-small) leading-6 text-foreground-soft">
        Each limit is checked when its relevant work starts and applies from the
        next run you start. Per-plan limits and stop rules are edited on each
        plan in{" "}
        <Link
          className="font-medium text-foreground underline underline-offset-2"
          to="/job-finder/campaigns"
        >
          Search plans
        </Link>
        .
      </p>

      {blockedCount > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-(--radius-field) border border-destructive/30 bg-destructive/10 px-3 py-2 text-(length:--text-small) text-foreground"
          role="status"
        >
          <ShieldAlert aria-hidden="true" className="size-4 text-destructive" />
          <span>
            {blockedCount === 1
              ? "1 thing is being held back."
              : `${blockedCount} things are being held back.`}{" "}
            Settle, dismiss, or retry them below so the affected work can carry
            on.
          </span>
        </div>
      ) : dailyCapacityExhausted && dailyCapacity ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-(--radius-field) border border-(--warning-border) bg-(--warning-surface) px-3 py-2 text-(length:--text-small) text-foreground"
          data-testid="safeguards-daily-capacity-status"
          role="status"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          <span>
            Nothing is being held back right now.{" "}
            {formatDailyPreparationCapacityReachedText(dailyCapacity)}
          </span>
        </div>
      ) : (
        <div
          className="flex flex-wrap items-center gap-2 rounded-(--radius-field) border border-positive/30 bg-positive/10 px-3 py-2 text-(length:--text-small) text-foreground"
          role="status"
        >
          <ShieldCheck aria-hidden="true" className="size-4 text-positive" />
          <span>
            Nothing is being held back right now. Searching and preparing
            applications can both run.
          </span>
        </div>
      )}

      {actionMessage ? (
        <p
          className="rounded-(--radius-field) border border-(--surface-panel-border) bg-background/40 px-3 py-2 text-(length:--text-small) leading-5 text-foreground-soft"
          role="status"
        >
          {actionMessage}
        </p>
      ) : null}

      <details
        className="surface-panel-shell grid min-w-0 gap-3 rounded-(--radius-panel) border border-(--surface-panel-border) p-4"
        data-safeguard-events
        onToggle={(event) =>
          setEventsOpenOverride(event.currentTarget.open ? true : false)
        }
        open={eventsOpen}
      >
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-(length:--text-body) font-semibold text-(--text-headline)">
          Safety events and automatic pauses
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--input) px-1 text-(length:--text-tiny) tabular-nums font-normal text-foreground">
            {model.counts.total}
          </span>
        </summary>

        <div className="grid min-w-0 gap-3 pt-3">
          {!isEmpty ? (
            <div
              className="grid min-w-0 gap-3 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)] lg:items-start"
              data-safeguard-toolbar
            >
              <div className="relative min-w-0">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="Search safeguards"
                  className="pl-9"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search safeguards"
                  type="search"
                  value={query}
                />
              </div>
              <div
                aria-label="Safeguard categories"
                className="flex min-w-0 w-full flex-wrap items-center gap-1 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel) p-1"
                data-safeguard-categories
                role="group"
              >
                {visibleTabs.map((entry) => {
                  const count = countForTab(model.counts, entry.id);
                  return (
                    <button
                      aria-pressed={activeTab === entry.id}
                      className={cn(
                        "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-3 text-(length:--text-small) font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
                        activeTab === entry.id
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      key={entry.id}
                      onClick={() => setTab(entry.id)}
                      type="button"
                    >
                      {entry.label}
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--input) px-1 text-(length:--text-tiny) tabular-nums text-foreground">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {isEmpty ? (
            <div data-safeguard-empty>
              <EmptyState
                className="min-h-40 px-5 py-6"
                description="Job Finder records an event here only when one of its limits is actually reached — a per-company application limit, a listing that looks closed or suspicious, an unusual run of failures, or a batch waiting for your spot check. Nothing has been recorded yet."
                title="No safety events yet"
              />
            </div>
          ) : isNoMatch ? (
            <EmptyState
              className="min-h-40 px-5 py-6"
              description="Nothing in this category matches your search. Try a different term or clear the search box."
              title="No matching safeguards"
            />
          ) : (
            <div className="grid gap-3">
              {visibleRows.map((row) => (
                <SafeguardRowCard
                  isPending={isPending}
                  key={row.key}
                  onMutate={onMutateSafeguards}
                  row={row}
                />
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function countForTab(
  counts: {
    caps: number;
    conflicts: number;
    signals: number;
    pauses: number;
    reviews: number;
    contradictions: number;
    dismissals: number;
    total: number;
  },
  tab: SafeguardTabId,
): number {
  switch (tab) {
    case "all":
      return counts.total;
    case "caps":
      return counts.caps;
    case "conflicts":
      return counts.conflicts;
    case "signals":
      return counts.signals;
    case "pauses":
      return counts.pauses;
    case "reviews":
      return counts.reviews;
    case "contradictions":
      return counts.contradictions;
    case "dismissals":
      return counts.dismissals;
  }
}
