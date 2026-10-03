import { formatTrackerMoment as formatCalendarMoment } from "./applications-tracker-time";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ApplicationCrmStage,
  ApplicationCrmStageDefinition,
  ApplicationRecord,
} from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/badge";
import { EmptyState } from "../../components/empty-state";
import {
  APPLICATION_CRM_PAGE_SIZE,
  CollectionPagination,
} from "../../components/collection-pagination";
import {
  CollectionColumnPicker,
  CollectionNoMatches,
  CollectionSavedViews,
  CollectionSearchToolbar,
  matchesCollectionSearch,
} from "../../components/collection-search-toolbar";
import { usePersistedCollectionView } from "../../hooks/use-persisted-collection-view";

import {
  APPLICATION_CRM_STAGE_NAMES,
  APPLICATION_CRM_STAGE_ORDER,
  applicationCrmDataForView,
  applicationCrmStageLabelForView,
  applicationCrmStageProvenanceDetailForView,
  applicationCrmStageProvenanceForView,
  buildApplicationCrmCalendarForView,
  groupApplicationRecordsByStage,
} from "./applications-crm-model";
import { formatApplicationEmployerLine } from "../../lib/job-employer-location-display";
import { useAssistantContextSource } from "../../assistant/assistant-provider";
import { buildListContext } from "../../assistant/assistant-context-capture";

export const APPLICATION_CRM_VIEW_VALUES = [
  "table",
  "kanban",
  "calendar",
] as const;
export type ApplicationCrmView = (typeof APPLICATION_CRM_VIEW_VALUES)[number];

const crmSavedViewValues = [
  "all",
  "needs_follow_up",
  "interviews",
  "offers",
] as const;
type CrmSavedView = (typeof crmSavedViewValues)[number];

const crmSavedViewLabels: Record<CrmSavedView, string> = {
  all: "All applications",
  needs_follow_up: "Needs follow-up",
  interviews: "Interviews",
  offers: "Offers",
};

const columnValues = [
  "job",
  "company",
  "stage",
  "reminder",
  "interview",
  "tags",
  "updated",
] as const;
type CrmColumn = (typeof columnValues)[number];

/**
 * Below this many records the table/board/calendar switcher and the exports
 * are not offered: they are three ways of viewing, and two formats for
 * exporting, a single row.
 */
export const APPLICATION_CRM_VIEW_SWITCHER_MIN_RECORDS = 2;

const viewLabels: Record<ApplicationCrmView, string> = {
  table: "List",
  kanban: "Board",
  calendar: "Calendar",
};

function encodeVisibleRecordIdKey(recordIds: readonly string[]): string {
  return JSON.stringify(recordIds);
}

function decodeVisibleRecordIdKey(key: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) &&
      parsed.every((id): id is string => typeof id === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

const emptyStateCopy: Record<
  ApplicationCrmView,
  { description: string; title: string }
> = {
  table: {
    title: "No applications yet",
    description:
      "Shortlist a job or prepare an application and it will appear as a row in your tracker table.",
  },
  kanban: {
    title: "No applications on your board yet",
    description:
      "Applications you prepare will appear here grouped by hiring stage.",
  },
  calendar: {
    title: "Nothing scheduled yet",
    description:
      "Upcoming reminders, interviews, and offer deadlines will appear on the application calendar.",
  },
};

function startOfLocalDay(time: number, daysAhead = 0): number {
  const date = new Date(time);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Overdue first, then today, tomorrow and later, so what is due is on top. */
function groupCalendarEntries<T extends { startsAt: string }>(
  entries: readonly T[],
  now: number,
): { key: string; label: string; entries: T[] }[] {
  const tomorrow = startOfLocalDay(now, 1);
  const dayAfter = startOfLocalDay(now, 2);
  const groups = [
    { key: "overdue", label: "Overdue", entries: [] as T[] },
    { key: "today", label: "Today", entries: [] as T[] },
    { key: "tomorrow", label: "Tomorrow", entries: [] as T[] },
    { key: "later", label: "Later", entries: [] as T[] },
  ];
  for (const entry of entries) {
    const at = Date.parse(entry.startsAt);
    const group =
      at < now
        ? groups[0]
        : at < tomorrow
          ? groups[1]
          : at < dayAfter
            ? groups[2]
            : groups[3];
    group?.entries.push(entry);
  }
  return groups.filter((group) => group.entries.length > 0);
}

const NO_CUSTOM_STAGES: readonly ApplicationCrmStageDefinition[] = [];

function RecordButton(props: {
  record: ApplicationRecord;
  selected: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
  relatedJobCanonicalUrl?: string | null;
}) {
  const crm = applicationCrmDataForView(props.record);
  const pendingReminderCount = crm.reminders.filter(
    (reminder) => reminder.status === "pending",
  ).length;
  const employerLine = formatApplicationEmployerLine({
    company: props.record.company,
    ...(props.relatedJobCanonicalUrl
      ? { canonicalUrl: props.relatedJobCanonicalUrl }
      : {}),
  });
  return (
    <button
      aria-current={props.selected ? "true" : undefined}
      className={cn(
        "grid w-full min-w-0 gap-2 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) p-3 text-left outline-none transition-colors hover:bg-(--surface-panel-raised) focus-visible:ring-[3px] focus-visible:ring-ring/30",
        props.selected && "border-primary/60 bg-(--surface-panel-raised)",
        props.compact && "gap-1.5 p-2.5",
      )}
      onClick={() => props.onSelect(props.record.id)}
      type="button"
    >
      <strong className="min-w-0 break-words text-sm text-foreground">
        {props.record.title}
      </strong>
      {employerLine ? (
        <span className="min-w-0 break-words text-xs text-foreground-soft">
          {employerLine}
        </span>
      ) : null}
      <span className="flex flex-wrap gap-1.5">
        <Badge
          title={applicationCrmStageProvenanceDetailForView(props.record)}
          variant="section"
        >
          {applicationCrmStageProvenanceForView(props.record)}
        </Badge>
        {crm.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="section">
            {tag}
          </Badge>
        ))}
        {pendingReminderCount > 0 ? (
          <Badge variant="section">
            {pendingReminderCount} reminder
            {pendingReminderCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

export function ApplicationsCrmViews(props: {
  records: readonly ApplicationRecord[];
  selectedRecordId: string | null;
  view: ApplicationCrmView;
  discoveryJobs?: ReadonlyArray<{
    id: string;
    canonicalUrl: string;
  }>;
  onSelectRecord: (recordId: string) => void;
  onViewChange: (view: ApplicationCrmView) => void;
  onVisibleRecordIdsChange?: (recordIds: readonly string[]) => void;
  onBulkStageChange?: (
    recordIds: readonly string[],
    stage: ApplicationCrmStage,
  ) => Promise<void>;
  /** Stages the person named; shown and searchable by those names. */
  customStages?: readonly ApplicationCrmStageDefinition[];
  /** Marks a reminder done straight from the calendar (N-018). */
  onCompleteReminder?: (recordId: string, reminderId: string) => Promise<void>;
}) {
  const customStages = props.customStages ?? NO_CUSTOM_STAGES;
  const {
    applySavedView,
    deleteSavedView,
    density,
    query,
    savedViews,
    saveCurrentView,
    setDensity,
    setQuery,
  } = usePersistedCollectionView("applications-crm", "comfortable");
  const [savedView, setSavedView] = useState<CrmSavedView>(() => {
    try {
      const stored = window.localStorage.getItem(
        "nordri.job-finder.applications-crm.saved-view.v1",
      );
      return crmSavedViewValues.includes(stored as CrmSavedView)
        ? (stored as CrmSavedView)
        : "all";
    } catch {
      return "all";
    }
  });
  const [visibleColumns, setVisibleColumns] = useState<readonly CrmColumn[]>(
    () => {
      try {
        const stored = JSON.parse(
          window.localStorage.getItem(
            "nordri.job-finder.applications-crm.columns.v1",
          ) ?? "null",
        ) as unknown;
        return Array.isArray(stored)
          ? columnValues.filter((column) => stored.includes(column))
          : columnValues;
      } catch {
        return columnValues;
      }
    },
  );
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [showEmptyKanbanStages, setShowEmptyKanbanStages] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [completingEntryId, setCompletingEntryId] = useState<string | null>(
    null,
  );
  const [calendarError, setCalendarError] = useState<string | null>(null);
  async function completeReminder(entry: {
    id: string;
    applicationRecordId: string;
  }) {
    if (!props.onCompleteReminder) return;
    setCompletingEntryId(entry.id);
    setCalendarError(null);
    try {
      await props.onCompleteReminder(
        entry.applicationRecordId,
        entry.id.slice("reminder_".length),
      );
    } catch {
      setCalendarError(
        "The reminder could not be marked done. Open the application and try again.",
      );
    } finally {
      setCompletingEntryId(null);
    }
  }
  const selectedIdsRef = useRef(selectedIds);
  const pagedRecordIdsRef = useRef<readonly string[]>([]);
  selectedIdsRef.current = selectedIds;
  const [page, setPage] = useState(1);
  const selectionKey = selectedIds.join("\0");

  useEffect(() => {
    setBulkError(null);
  }, [selectionKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "nordri.job-finder.applications-crm.saved-view.v1",
        savedView,
      );
      window.localStorage.setItem(
        "nordri.job-finder.applications-crm.columns.v1",
        JSON.stringify(visibleColumns),
      );
    } catch {
      // The CRM stays usable when renderer preferences cannot be persisted.
    }
  }, [savedView, visibleColumns]);

  const relatedJobsById = useMemo(
    () =>
      new Map((props.discoveryJobs ?? []).map((job) => [job.id, job] as const)),
    [props.discoveryJobs],
  );

  const filteredRecords = useMemo(
    () =>
      props.records.filter((record) => {
        const crm = applicationCrmDataForView(record);
        const savedViewMatch =
          savedView === "all" ||
          (savedView === "needs_follow_up" &&
            (crm.stage === "no_response" ||
              crm.reminders.some(
                (reminder) => reminder.status === "pending",
              ))) ||
          (savedView === "interviews" &&
            crm.interviews.some(
              (interview) => interview.status === "scheduled",
            )) ||
          // An offer is an offer whether or not the stage was moved to it:
          // a saved, still-open offer counts.
          (savedView === "offers" &&
            (crm.stage === "offer" ||
              crm.compensation.offerStatus === "active"));
        const employerLine = formatApplicationEmployerLine({
          company: record.company,
          ...(relatedJobsById.get(record.jobId)?.canonicalUrl
            ? { canonicalUrl: relatedJobsById.get(record.jobId)?.canonicalUrl }
            : {}),
        });
        return (
          savedViewMatch &&
          matchesCollectionSearch(query, [
            record.title,
            record.company,
            employerLine,
            crm.stage,
            applicationCrmStageLabelForView(record, customStages),
            ...crm.tags,
            ...crm.contacts.flatMap((contact) => [contact.name, contact.email]),
          ])
        );
      }),
    [customStages, props.records, query, relatedJobsById, savedView],
  );
  const visibleRecordIdKey = useMemo(
    () => encodeVisibleRecordIdKey(filteredRecords.map((record) => record.id)),
    [filteredRecords],
  );
  const onVisibleRecordIdsChangeRef = useRef(props.onVisibleRecordIdsChange);
  onVisibleRecordIdsChangeRef.current = props.onVisibleRecordIdsChange;
  const reportedVisibleRecordIdKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (reportedVisibleRecordIdKeyRef.current === visibleRecordIdKey) {
      return;
    }
    reportedVisibleRecordIdKeyRef.current = visibleRecordIdKey;
    onVisibleRecordIdsChangeRef.current?.(
      decodeVisibleRecordIdKey(visibleRecordIdKey),
    );
  }, [visibleRecordIdKey]);

  // The tracker's ticked rows are the assistant's selection (ADR 0037).
  useAssistantContextSource(
    "applications-tracker-list",
    () => ({
      list: buildListContext({
        listKind: "applications",
        checkedIds: selectedIdsRef.current,
        displayedIds: pagedRecordIdsRef.current,
        filteredIds: filteredRecords.map((record) => record.id),
        filterSummary: query.trim() ? `matching "${query.trim()}"` : null,
      }),
    }),
    { priority: 1 },
  );

  useEffect(() => {
    const visibleIds = new Set(filteredRecords.map((record) => record.id));
    setSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [filteredRecords]);

  useEffect(() => {
    setPage(1);
  }, [props.view, query, savedView]);

  const calendar = useMemo(
    () => buildApplicationCrmCalendarForView(filteredRecords, relatedJobsById),
    [filteredRecords, relatedJobsById],
  );
  const pageItemCount =
    props.view === "calendar" ? calendar.length : filteredRecords.length;
  const pageCount = Math.max(
    1,
    Math.ceil(pageItemCount / APPLICATION_CRM_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, pageCount));
  }, [pageCount]);
  const pagedRecords = useMemo(
    () =>
      filteredRecords.slice(
        (currentPage - 1) * APPLICATION_CRM_PAGE_SIZE,
        currentPage * APPLICATION_CRM_PAGE_SIZE,
      ),
    [currentPage, filteredRecords],
  );
  pagedRecordIdsRef.current = pagedRecords.map((record) => record.id);

  const grouped = useMemo(
    () => groupApplicationRecordsByStage(pagedRecords),
    [pagedRecords],
  );
  const groupedTotals = useMemo(
    () => groupApplicationRecordsByStage(filteredRecords),
    [filteredRecords],
  );
  const populatedKanbanStages = useMemo(
    () =>
      APPLICATION_CRM_STAGE_ORDER.filter(
        (stage) => (grouped.get(stage)?.length ?? 0) > 0,
      ),
    [grouped],
  );
  const emptyKanbanStages = useMemo(
    () =>
      APPLICATION_CRM_STAGE_ORDER.filter(
        (stage) => (grouped.get(stage)?.length ?? 0) === 0,
      ),
    [grouped],
  );
  const pagedCalendar = useMemo(
    () =>
      calendar.slice(
        (currentPage - 1) * APPLICATION_CRM_PAGE_SIZE,
        currentPage * APPLICATION_CRM_PAGE_SIZE,
      ),
    [calendar, currentPage],
  );
  const recordsById = useMemo(
    () => new Map(filteredRecords.map((record) => [record.id, record])),
    [filteredRecords],
  );
  const selectedRecordIndex = useMemo(
    () =>
      props.selectedRecordId
        ? filteredRecords.findIndex(
            (record) => record.id === props.selectedRecordId,
          )
        : -1,
    [filteredRecords, props.selectedRecordId],
  );
  const selectedCalendarIndex = useMemo(
    () =>
      props.selectedRecordId
        ? calendar.findIndex(
            (entry) => entry.applicationRecordId === props.selectedRecordId,
          )
        : -1,
    [calendar, props.selectedRecordId],
  );
  useEffect(() => {
    const selectedIndex =
      props.view === "calendar" ? selectedCalendarIndex : selectedRecordIndex;
    if (selectedIndex < 0) return;
    setPage(Math.floor(selectedIndex / APPLICATION_CRM_PAGE_SIZE) + 1);
  }, [props.view, selectedCalendarIndex, selectedRecordIndex]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const columnVisible = (column: CrmColumn) => visibleColumns.includes(column);
  const rowPadding =
    density === "compact" ? "py-2" : density === "detailed" ? "py-5" : "py-3";

  function submitBulkStageChange(stage: ApplicationCrmStage) {
    if (!props.onBulkStageChange || selectedIds.length === 0) return;
    const submittedSelectionKey = selectionKey;
    setBulkPending(true);
    const operation = props.onBulkStageChange(selectedIds, stage);
    void operation
      .then(
        () => {
          if (selectedIdsRef.current.join("\0") !== submittedSelectionKey) {
            return;
          }
          setBulkError(null);
          setSelectedIds([]);
        },
        () => {
          if (selectedIdsRef.current.join("\0") !== submittedSelectionKey) {
            return;
          }
          setBulkError(
            "The selected applications could not be updated. Keep them selected and try again.",
          );
        },
      )
      .finally(() => setBulkPending(false));
  }

  return (
    <section className="surface-panel-shell @container/tracker flex min-h-0 max-h-128 min-w-0 flex-1 flex-col overflow-hidden rounded-(--radius-field) border border-(--surface-panel-border)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--surface-panel-border) px-5 py-3">
        <div>
          {/* Same panel-title rule as the Preparation list: the base scale
              owns the size and weight. */}
          <h2 className="min-w-0" id="application-tracker-heading">
            Application tracker
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {filteredRecords.length} of {props.records.length} applications in
            this view · a stage is either one you recorded or one Job Finder
            worked out from your activity
          </p>
        </div>
        {/* A table, a board and a calendar are three ways of looking at a
            list. With one row there is nothing to look at three ways, so the
            switcher is earned rather than always present. */}
        {props.records.length >= APPLICATION_CRM_VIEW_SWITCHER_MIN_RECORDS ? (
          <div
            aria-label="Application view"
            className="flex gap-1"
            data-testid="applications-crm-view-switcher"
            role="group"
          >
            {APPLICATION_CRM_VIEW_VALUES.map((view) => (
              <Button
                aria-pressed={props.view === view}
                key={view}
                onClick={() => props.onViewChange(view)}
                size="sm"
                type="button"
                variant={props.view === view ? "secondary" : "ghost"}
              >
                {viewLabels[view]}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <CollectionSearchToolbar
        density={density}
        label="Search applications"
        onDensityChange={setDensity}
        onQueryChange={setQuery}
        placeholder="Search jobs, companies, contacts, stages, or tags"
        query={query}
        totalCount={props.records.length}
        viewActions={
          <div className="flex items-center gap-1">
            <CollectionSavedViews
              onApply={applySavedView}
              onDelete={deleteSavedView}
              onSave={saveCurrentView}
              views={savedViews}
            />
            {props.view === "table" ? (
              <CollectionColumnPicker
                columns={columnValues.map((column) => ({
                  id: column,
                  label: column === "reminder" ? "Next reminder" : column,
                  required: column === "job",
                  visible: visibleColumns.includes(column),
                }))}
                onChange={(columnId, visible) =>
                  setVisibleColumns((current) =>
                    visible
                      ? [...current, columnId as CrmColumn]
                      : current.filter((value) => value !== columnId),
                  )
                }
              />
            ) : null}
          </div>
        }
        visibleCount={filteredRecords.length}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--surface-panel-border) px-5 py-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          Show
          <select
            className="h-9 rounded-(--radius-field) border border-(--field-border) bg-(--field) px-2 text-sm outline-none focus-visible:border-(--field-focus-border) focus-visible:bg-(--field-strong) focus-visible:shadow-[var(--field-focus-shadow)]"
            onChange={(event) =>
              setSavedView(event.target.value as CrmSavedView)
            }
            value={savedView}
          >
            {crmSavedViewValues.map((view) => (
              <option key={view} value={view}>
                {crmSavedViewLabels[view]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {props.records.length === 0 ? (
        <EmptyState
          description={emptyStateCopy[props.view].description}
          title={emptyStateCopy[props.view].title}
        />
      ) : filteredRecords.length === 0 && query && savedView === "all" ? (
        <CollectionNoMatches
          noun="applications"
          onClear={() => setQuery("")}
          query={query}
        />
      ) : filteredRecords.length === 0 ? (
        <div className="grid min-h-48 place-items-center px-6 text-center">
          <div>
            <h3 className="font-semibold text-foreground">
              {query
                ? `Nothing in ${crmSavedViewLabels[savedView]} matches "${query}"`
                : "No applications in this view right now"}
            </h3>
            {/* Both filters can hide a row; each gets its own way back. */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button
                onClick={() => setSavedView("all")}
                size="sm"
                type="button"
                variant="ghost"
              >
                Show all applications
              </Button>
              {query ? (
                <Button
                  onClick={() => setQuery("")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Clear search
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {props.view === "table" && filteredRecords.length > 0 ? (
        <div
          className="min-h-28 flex-1 overflow-auto"
          data-locked-pane-scroll-region
        >
          {/* A fixed 50rem minimum turned this table into a horizontally
              scrolling strip inside a ~28rem column, which cut the Stage cell
              off at the pane edge. The wide layout is kept only once the
              panel is actually wide enough for it. */}
          <table
            aria-labelledby="application-tracker-heading"
            className="w-full min-w-0 border-collapse text-left text-sm @[54rem]/tracker:min-w-200"
            data-application-tracker-table
          >
            <thead className="sticky top-0 z-10 bg-(--surface-panel-solid)">
              <tr className="border-b border-(--surface-panel-border)">
                <th className="w-10 px-3 py-3" scope="col">
                  <input
                    aria-label="Select all matching applications"
                    checked={
                      selectedIdSet.size > 0 &&
                      selectedIdSet.size === filteredRecords.length
                    }
                    onChange={(event) =>
                      setSelectedIds(
                        event.target.checked
                          ? filteredRecords.map((record) => record.id)
                          : [],
                      )
                    }
                    type="checkbox"
                  />
                </th>
                {columnValues.filter(columnVisible).map((column) => (
                  <th
                    className="label-mono-xs px-2 @[54rem]/tracker:px-4 py-3 capitalize"
                    key={column}
                    scope="col"
                  >
                    {column === "reminder" ? "Next reminder" : column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRecords.map((record) => {
                const crm = applicationCrmDataForView(record);
                const employerLine = formatApplicationEmployerLine({
                  company: record.company,
                  ...(relatedJobsById.get(record.jobId)?.canonicalUrl
                    ? {
                        canonicalUrl: relatedJobsById.get(record.jobId)
                          ?.canonicalUrl,
                      }
                    : {}),
                });
                const reminder = crm.reminders
                  .filter((entry) => entry.status === "pending")
                  .sort((left, right) =>
                    left.dueAt.localeCompare(right.dueAt),
                  )[0];
                const interview = crm.interviews
                  .filter((entry) => entry.status === "scheduled")
                  .sort((left, right) =>
                    left.startsAt.localeCompare(right.startsAt),
                  )[0];
                return (
                  <tr
                    className={cn(
                      "cursor-pointer border-b border-(--surface-panel-border) hover:bg-(--surface-panel-raised)",
                      props.selectedRecordId === record.id &&
                        "bg-(--surface-panel-raised)",
                    )}
                    key={record.id}
                    onClick={() => props.onSelectRecord(record.id)}
                  >
                    <td
                      className={cn("px-3", rowPadding)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        aria-label={
                          employerLine
                            ? `Select ${record.title} at ${employerLine}`
                            : `Select ${record.title}`
                        }
                        checked={selectedIdSet.has(record.id)}
                        onChange={(event) =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(record.id);
                            } else {
                              next.delete(record.id);
                            }
                            return [...next];
                          })
                        }
                        type="checkbox"
                      />
                    </td>
                    {columnVisible("job") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 font-semibold text-foreground",
                          rowPadding,
                        )}
                      >
                        <button
                          className="text-left outline-none focus-visible:underline"
                          onClick={() => props.onSelectRecord(record.id)}
                          type="button"
                        >
                          {record.title}
                        </button>
                      </td>
                    ) : null}
                    {columnVisible("company") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 text-foreground-soft",
                          rowPadding,
                        )}
                      >
                        {employerLine ?? "—"}
                      </td>
                    ) : null}
                    {columnVisible("stage") ? (
                      <td
                        className={cn("px-2 @[54rem]/tracker:px-4", rowPadding)}
                      >
                        <span
                          title={applicationCrmStageProvenanceDetailForView(
                            record,
                          )}
                        >
                          {applicationCrmStageLabelForView(
                            record,
                            customStages,
                          )}
                        </span>
                      </td>
                    ) : null}
                    {columnVisible("reminder") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 text-muted-foreground",
                          rowPadding,
                        )}
                      >
                        {reminder
                          ? new Date(reminder.dueAt).toLocaleDateString()
                          : "—"}
                      </td>
                    ) : null}
                    {columnVisible("interview") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 text-muted-foreground",
                          rowPadding,
                        )}
                      >
                        {/* The zone is named so a time set up across
                            borders reads unambiguously (N-014). */}
                        {interview
                          ? formatCalendarMoment(
                              interview.startsAt,
                              interview.timeZone,
                            )
                          : "—"}
                      </td>
                    ) : null}
                    {columnVisible("tags") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 text-muted-foreground",
                          rowPadding,
                        )}
                      >
                        {crm.tags.join(", ") || "—"}
                      </td>
                    ) : null}
                    {columnVisible("updated") ? (
                      <td
                        className={cn(
                          "px-2 @[54rem]/tracker:px-4 text-muted-foreground",
                          rowPadding,
                        )}
                      >
                        {new Date(record.lastUpdatedAt).toLocaleDateString()}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {props.view === "table" && selectedIds.length > 0 ? (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-primary/30 bg-(--surface-panel-solid) px-5 py-3 shadow-[0_-12px_28px_rgba(0,0,0,0.35)]">
          {bulkError ? (
            <p
              className="basis-full rounded-(--radius-field) border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {bulkError}
            </p>
          ) : null}
          <strong className="text-sm text-foreground">
            {selectedIds.length} matching application
            {selectedIds.length === 1 ? "" : "s"} selected
          </strong>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={bulkPending || !props.onBulkStageChange}
              onClick={() => submitBulkStageChange("reviewing")}
              size="sm"
              type="button"
              variant="secondary"
            >
              Move to Reviewing
            </Button>
            <Button
              disabled={bulkPending || !props.onBulkStageChange}
              onClick={() => submitBulkStageChange("withdrawn")}
              size="sm"
              type="button"
              variant="ghost"
            >
              Mark withdrawn
            </Button>
            <Button
              disabled={bulkPending}
              onClick={() => setSelectedIds([])}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear selection
            </Button>
          </div>
        </div>
      ) : null}

      {props.view === "kanban" && filteredRecords.length > 0 ? (
        <div
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"
          data-locked-pane-scroll-region
        >
          <div className="grid min-w-0 gap-3">
            {emptyKanbanStages.length > 0 ? (
              <div className="flex min-w-0 justify-end">
                <Button
                  onClick={() =>
                    setShowEmptyKanbanStages((current) => !current)
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {showEmptyKanbanStages
                    ? "Hide empty stages"
                    : `Show empty stages (${emptyKanbanStages.length})`}
                </Button>
              </div>
            ) : null}
            {populatedKanbanStages.map((stage) => {
              const stageRecords = grouped.get(stage) ?? [];
              return (
                <section
                  className="grid min-w-0 gap-3 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) p-3"
                  key={stage}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-foreground">
                      {APPLICATION_CRM_STAGE_NAMES[stage]}
                    </h3>
                    <Badge variant="section">
                      {groupedTotals.get(stage)?.length ?? 0}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {stageRecords.length > 0 ? (
                      stageRecords.map((record) => (
                        <RecordButton
                          compact
                          key={record.id}
                          onSelect={props.onSelectRecord}
                          record={record}
                          relatedJobCanonicalUrl={
                            relatedJobsById.get(record.jobId)?.canonicalUrl ??
                            null
                          }
                          selected={props.selectedRecordId === record.id}
                        />
                      ))
                    ) : (
                      <p className="rounded-(--radius-field) border border-dashed border-(--surface-panel-border) p-3 text-xs text-muted-foreground">
                        No applications
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
            {showEmptyKanbanStages ? (
              <div
                aria-label="Empty stages"
                className="grid min-w-0 grid-cols-2 gap-2"
                role="list"
              >
                {emptyKanbanStages.map((stage) => (
                  <div
                    className="flex min-w-0 items-center justify-between gap-2 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) px-3 py-2"
                    key={stage}
                    role="listitem"
                  >
                    <span className="min-w-0 break-words text-xs font-medium text-foreground-soft">
                      {APPLICATION_CRM_STAGE_NAMES[stage]}
                    </span>
                    <Badge variant="section">0</Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.view === "calendar" && filteredRecords.length > 0 ? (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-5"
          data-locked-pane-scroll-region
        >
          {calendarError ? (
            <p
              className="mb-4 rounded-(--radius-field) border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {calendarError}
            </p>
          ) : null}
          {calendar.length > 0 ? (
            <div className="grid gap-5">
              {groupCalendarEntries(pagedCalendar, Date.now()).map((group) => (
                <section
                  aria-label={group.label}
                  className="grid gap-2"
                  key={group.key}
                >
                  <h3
                    className={
                      group.key === "overdue"
                        ? "text-xs font-bold uppercase tracking-(--tracking-label) text-(--warning-text)"
                        : "text-xs font-bold uppercase tracking-(--tracking-label) text-foreground-muted"
                    }
                  >
                    {group.label}
                  </h3>
                  <ol className="grid gap-3">
                    {group.entries.map((entry) => {
                      const record = recordsById.get(entry.applicationRecordId);
                      return (
                        <li
                          className="grid gap-1 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) p-4 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                          key={entry.id}
                        >
                          <time
                            className="text-sm font-semibold text-foreground"
                            dateTime={entry.startsAt}
                          >
                            {formatCalendarMoment(
                              entry.startsAt,
                              entry.timeZone,
                            )}
                          </time>
                          <div className="min-w-0">
                            <strong className="block break-words text-sm text-foreground">
                              {entry.title}
                            </strong>
                            <span className="label-mono-xs">
                              {entry.kind.replaceAll("_", " ")}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {entry.kind === "reminder" &&
                            props.onCompleteReminder ? (
                              <Button
                                aria-label={`Mark "${entry.title}" done`}
                                disabled={completingEntryId !== null}
                                onClick={() => void completeReminder(entry)}
                                pending={completingEntryId === entry.id}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                Mark done
                              </Button>
                            ) : null}
                            <Button
                              disabled={!record}
                              onClick={() =>
                                record && props.onSelectRecord(record.id)
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Open
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center text-center">
              <div>
                <h3 className="font-semibold text-foreground">
                  Nothing scheduled
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pending reminders, interviews, and offer deadlines will appear
                  here.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {pageItemCount > 0 ? (
        <CollectionPagination
          itemLabel={
            props.view === "calendar" ? "scheduled items" : "applications"
          }
          onPageChange={setPage}
          page={currentPage}
          pageSize={APPLICATION_CRM_PAGE_SIZE}
          totalCount={pageItemCount}
        />
      ) : null}
    </section>
  );
}
