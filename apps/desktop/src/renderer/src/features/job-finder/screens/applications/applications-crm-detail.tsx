import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  ApplicationCrmExportFormat,
  ApplicationCrmInterview,
  ApplicationCrmMutationInput,
  ApplicationCrmReminder,
  ApplicationCrmSettings,
  ApplicationCrmStage,
  ApplicationRecord,
  CandidateAsset,
  RecordOutcomeInput,
} from "@nordri/contracts";
import { Button } from "@renderer/components/ui/button";

import {
  APPLICATION_CRM_STAGE_LABELS,
  APPLICATION_CRM_STAGE_ORDER,
  applicationCrmDataForView,
} from "./applications-crm-model";
import { ApplicationsOutcomeRecorder } from "./applications-outcome-recorder";
import { isImeComposingEvent } from "../../lib/job-finder-shortcuts";
import { useJobFinderOverlayOwnership } from "../../lib/job-finder-overlay-ownership";
import { StatusBadge } from "../../components/status-badge";
import { formatApplicationEmployerLine } from "../../lib/job-employer-location-display";
import { getJobFinderDateInputLocale } from "../../lib/job-finder-date-input-locale";

const jobFinderDateInputLocale = getJobFinderDateInputLocale();

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toLocalInputValue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(
    parsed.getDate(),
  )}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

const fieldClassName =
  "h-11 w-full rounded-(--radius-field) border border-(--field-border) bg-(--field) px-3.5 text-(length:--text-field) text-foreground outline-none focus-visible:border-(--field-focus-border) focus-visible:bg-(--field-strong) focus-visible:shadow-[var(--field-focus-shadow)]";
const areaClassName =
  "min-h-20 w-full resize-y rounded-(--radius-field) border border-(--field-border) bg-(--field) px-3 py-2 text-sm leading-6 text-foreground outline-none focus-visible:border-(--field-focus-border) focus-visible:bg-(--field-strong) focus-visible:shadow-[var(--field-focus-shadow)]";

const externallyClaimedStages = new Set<ApplicationCrmStage>([
  "employer_viewed",
  "recruiter_contact",
  "assessment",
  "interview",
  "offer",
  "rejected",
]);

function getDialogFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

const legacySubmitApprovalEvent = {
  title: "Automatic submit approval requested",
  detail:
    "A run-scoped submit approval was created for this job. The current safe implementation still stops before any final submit action.",
} as const;

function applicationCrmEventCopyForView(
  title: string,
  detail: string | null,
): { title: string; detail: string | null } {
  if (
    title !== legacySubmitApprovalEvent.title ||
    detail !== legacySubmitApprovalEvent.detail
  ) {
    return { title, detail };
  }

  return {
    title: "Historical legacy event: preparation approval requested",
    detail:
      "Legacy record: this requested approval to open and fill the application for preparation only. It granted no authority to submit.",
  };
}

export function ApplicationsCrmDetail(props: {
  record: ApplicationRecord;
  relatedJobCanonicalUrl?: string | null;
  settings: ApplicationCrmSettings;
  onMutate: (command: ApplicationCrmMutationInput) => Promise<void>;
  onExport: (
    format: ApplicationCrmExportFormat,
    recordId: string,
  ) => Promise<void>;
  onRecordOutcome?: (input: RecordOutcomeInput) => Promise<void>;
  isRecordOutcomePending?: boolean;
  outcomeCampaignId?: string | null;
  outcomeResumeStrategyId?: string | null;
}) {
  const crm = applicationCrmDataForView(props.record);
  const employerLine = formatApplicationEmployerLine({
    company: props.record.company,
    ...(props.relatedJobCanonicalUrl
      ? { canonicalUrl: props.relatedJobCanonicalUrl }
      : {}),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState(crm.tags.join(", "));
  const [note, setNote] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [interviewTitle, setInterviewTitle] = useState("");
  const [interviewAt, setInterviewAt] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [offerAmount, setOfferAmount] = useState(
    crm.compensation.offerBase?.amount.toString() ?? "",
  );
  const [offerCurrency, setOfferCurrency] = useState(
    crm.compensation.offerBase?.currency ?? "EUR",
  );
  const [offerPeriod, setOfferPeriod] = useState<"hour" | "month" | "year">(
    crm.compensation.offerBase?.period ?? "year",
  );
  const [offerDeadline, setOfferDeadline] = useState(
    crm.compensation.offerDeadlineAt
      ? toLocalInputValue(crm.compensation.offerDeadlineAt)
      : "",
  );
  const [reminderReschedules, setReminderReschedules] = useState<
    Record<string, string>
  >({});
  const [candidateAssets, setCandidateAssets] = useState<
    readonly CandidateAsset[]
  >([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [pendingStage, setPendingStage] = useState<{
    stage: ApplicationCrmStage;
    customStageId: string | null;
    label: string;
  } | null>(null);
  const addNoteReasonId = useId();
  const exportDisabledReasonId = useId();
  const stageConfirmationTitleId = useId();
  const stageConfirmationDescriptionId = useId();
  const stageConfirmationRef = useRef<HTMLDivElement>(null);
  const stageConfirmationOpenerRef = useRef<HTMLElement | null>(null);
  const stageConfirmationInProgressRef = useRef(false);
  const closeStageConfirmation = useCallback(() => setPendingStage(null), []);
  // The confirmation modal joins the shared LIFO overlay stack so stacked
  // surfaces (Task Center, global search, menus) close one per Escape and
  // shell aliases stay blocked while it owns the surface.
  const { isTopmost: isStageConfirmationTopmost } =
    useJobFinderOverlayOwnership({
      active: pendingStage !== null,
      close: closeStageConfirmation,
    });

  // Re-seed only when a different record is shown. Revision bumps on the same
  // record must not clobber in-progress drafts; the screen keys this detail by
  // record id, so this also acts as a safety net for unkeyed mounts.
  useEffect(() => {
    const nextCrm = applicationCrmDataForView(props.record);
    setTags(nextCrm.tags.join(", "));
    setOfferAmount(nextCrm.compensation.offerBase?.amount.toString() ?? "");
    setOfferCurrency(nextCrm.compensation.offerBase?.currency ?? "EUR");
    setOfferPeriod(nextCrm.compensation.offerBase?.period ?? "year");
    setOfferDeadline(
      nextCrm.compensation.offerDeadlineAt
        ? toLocalInputValue(nextCrm.compensation.offerDeadlineAt)
        : "",
    );
    setReminderReschedules({});
    setError(null);
  }, [props.record.id]);

  useEffect(() => {
    let active = true;
    void window.nordri.jobFinder
      .listCandidateAssets({ includeDeleted: false })
      .then((result) => {
        if (!active) return;
        setCandidateAssets(
          result.assets.filter(
            (asset) =>
              asset.deletedAt === null &&
              asset.consentScope === "job_application_attachment",
          ),
        );
      })
      .catch(() => {
        if (active) setCandidateAssets([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingStage) return;

    stageConfirmationInProgressRef.current = false;
    stageConfirmationOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.getAttribute("inert") ?? null;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");

    const dialog = stageConfirmationRef.current;
    const focusableElements = dialog ? getDialogFocusableElements(dialog) : [];
    (focusableElements[0] ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (
          event.defaultPrevented ||
          isImeComposingEvent(event) ||
          !isStageConfirmationTopmost()
        ) {
          return;
        }
        event.preventDefault();
        setPendingStage(null);
        return;
      }
      if (event.key !== "Tab") return;

      const currentDialog = stageConfirmationRef.current;
      if (!currentDialog) return;
      const currentFocusableElements =
        getDialogFocusableElements(currentDialog);
      event.preventDefault();
      if (currentFocusableElements.length === 0) {
        currentDialog.focus();
        return;
      }
      const currentIndex = currentFocusableElements.findIndex(
        (element) => element === document.activeElement,
      );
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + currentFocusableElements.length) %
          currentFocusableElements.length
        : (currentIndex + 1) % currentFocusableElements.length;
      currentFocusableElements[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (appRoot) {
        if (previousInert === null) appRoot.removeAttribute("inert");
        else appRoot.setAttribute("inert", previousInert);
        if (previousAriaHidden === null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      stageConfirmationOpenerRef.current?.focus({ preventScroll: true });
    };
  }, [isStageConfirmationTopmost, pendingStage]);

  const customStagesById = useMemo(
    () =>
      new Map(props.settings.customStages.map((stage) => [stage.id, stage])),
    [props.settings.customStages],
  );

  async function mutate(mutation: ApplicationCrmMutationInput["mutation"]) {
    setPending(true);
    setError(null);
    try {
      await props.onMutate({
        applicationRecordId: props.record.id,
        expectedRevision: crm.revision,
        mutation,
      });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The application update could not be saved.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  function selectStage(value: string) {
    const customId = value.startsWith("custom:") ? value.slice(7) : null;
    const custom = customId ? customStagesById.get(customId) : null;
    const stage = custom?.baseStage ?? (value as ApplicationCrmStage);
    const selection = {
      stage,
      customStageId: custom?.id ?? null,
      label: custom?.label ?? APPLICATION_CRM_STAGE_LABELS[stage],
    };
    if (externallyClaimedStages.has(stage)) {
      setPendingStage(selection);
      return;
    }
    void mutate({
      type: "set_stage",
      stage: selection.stage,
      customStageId: selection.customStageId,
      note: null,
    });
  }

  async function confirmPendingStage() {
    if (!pendingStage || stageConfirmationInProgressRef.current) return;
    stageConfirmationInProgressRef.current = true;
    const selection = pendingStage;
    const opener = stageConfirmationOpenerRef.current;
    setPendingStage(null);
    await mutate({
      type: "set_stage",
      stage: selection.stage,
      customStageId: selection.customStageId,
      note: null,
    });
    requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    });
  }

  function setReminderStatus(
    entry: ApplicationCrmReminder,
    status: "completed" | "dismissed",
  ) {
    const now = new Date().toISOString();
    void mutate({
      type: "upsert_reminder",
      reminder: {
        ...entry,
        status,
        updatedAt: now,
        ...(status === "completed" ? { completedAt: now } : {}),
      },
    });
  }

  function rescheduleReminder(entry: ApplicationCrmReminder) {
    const dueAt = toIso(reminderReschedules[entry.id] ?? "");
    if (!dueAt) return;
    void mutate({
      type: "upsert_reminder",
      reminder: { ...entry, dueAt, updatedAt: new Date().toISOString() },
    }).then((saved) => {
      if (!saved) return;
      setReminderReschedules((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
    });
  }

  function setInterviewStatus(
    entry: ApplicationCrmInterview,
    status: "completed" | "cancelled",
  ) {
    void mutate({
      type: "upsert_interview",
      interview: { ...entry, status, updatedAt: new Date().toISOString() },
    });
  }

  return (
    <section
      className="grid gap-4 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-panel-tint) p-4"
      aria-labelledby="application-crm-details-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label-mono-xs">Application tracker</p>
          <h3
            className="mt-1 font-semibold text-foreground"
            id="application-crm-details-heading"
          >
            Track what happens next
          </h3>
          <p className="mt-1 text-sm font-medium break-words leading-6 text-foreground">
            {employerLine
              ? `${props.record.title} · ${employerLine}`
              : props.record.title}
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground-soft">
            These are local, user-recorded notes and stages. Nothing here
            contacts the employer or submits an application. Exports contain
            these tracking facts, not submission evidence.
          </p>
        </div>
        {/* These two were the same colour as the paragraph directly above
            them, with no underline, box or chevron — nothing said they were
            controls. One link treatment, always underlined. */}
        <div className="flex items-baseline gap-4">
          <Button
            aria-describedby={pending ? exportDisabledReasonId : undefined}
            disabled={pending}
            onClick={() => void props.onExport("csv", props.record.id)}
            size="sm"
            type="button"
            variant="link"
          >
            Export CSV
          </Button>
          <Button
            aria-describedby={pending ? exportDisabledReasonId : undefined}
            disabled={pending}
            onClick={() => void props.onExport("json", props.record.id)}
            size="sm"
            type="button"
            variant="link"
          >
            Export JSON
          </Button>
          {pending ? (
            <span
              className="text-(length:--text-small) text-(--disabled-foreground)"
              id={exportDisabledReasonId}
            >
              Available once the change you just made has saved.
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          className="rounded-(--radius-field) border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
          Stage
          <select
            className={fieldClassName}
            disabled={pending}
            onChange={(event) => selectStage(event.target.value)}
            value={
              crm.customStageId ? `custom:${crm.customStageId}` : crm.stage
            }
          >
            {APPLICATION_CRM_STAGE_ORDER.map((stage) => (
              <option key={stage} value={stage}>
                {APPLICATION_CRM_STAGE_LABELS[stage]}
              </option>
            ))}
            {props.settings.customStages.length > 0 ? (
              <optgroup label="Custom stages">
                {props.settings.customStages.map((stage) => (
                  <option key={stage.id} value={`custom:${stage.id}`}>
                    {stage.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate({
              type: "set_tags",
              tags: tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            });
          }}
        >
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="application-crm-tags"
          >
            Tags
          </label>
          <div className="flex gap-2">
            <input
              className={fieldClassName}
              disabled={pending}
              id="application-crm-tags"
              onChange={(event) => setTags(event.target.value)}
              placeholder="priority, remote, referral"
              value={tags}
            />
            <Button
              disabled={pending}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Save
            </Button>
          </div>
        </form>
      </div>

      {pendingStage
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-(--modal-scrim) px-4 py-6 backdrop-blur-sm"
              onClick={() => setPendingStage(null)}
            >
              <div
                aria-describedby={stageConfirmationDescriptionId}
                aria-labelledby={stageConfirmationTitleId}
                aria-modal="true"
                className="surface-panel-shell grid min-w-0 w-full max-w-lg gap-5 rounded-(--radius-panel) border border-(--surface-panel-border) p-6 shadow-(--modal-shadow)"
                onClick={(event) => event.stopPropagation()}
                ref={stageConfirmationRef}
                role="alertdialog"
                tabIndex={-1}
              >
                <div className="grid gap-2">
                  <p className="label-mono-xs">Update your tracker</p>
                  <h2
                    className="font-display font-semibold text-foreground"
                    id={stageConfirmationTitleId}
                  >
                    Mark this as {pendingStage.label}?
                  </h2>
                  <p
                    className="text-sm leading-6 text-foreground-soft"
                    id={stageConfirmationDescriptionId}
                  >
                    This updates your own tracker only. Job Finder does not
                    check this with the employer.
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <Button
                    onClick={() => setPendingStage(null)}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void confirmPendingStage()}
                    type="button"
                  >
                    Mark as {pendingStage.label}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <details
        className="group rounded-(--radius-field) border border-(--surface-panel-border) p-3"
        open
      >
        <summary className="cursor-pointer font-semibold text-foreground">
          Notes and follow-ups
        </summary>
        <div className="mt-3 grid gap-4">
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = note.trim();
              if (!body) return;
              void mutate({
                type: "add_note",
                note: {
                  id: createId("note"),
                  body,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              }).then((saved) => {
                if (saved) setNote("");
              });
            }}
          >
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="application-crm-note"
            >
              Add a note
            </label>
            <textarea
              className={areaClassName}
              disabled={pending}
              id="application-crm-note"
              maxLength={4_000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record recruiter feedback or what you want to remember."
              value={note}
            />
            {/* A greyed control with no stated reason reads as broken. */}
            <div className="grid justify-items-start gap-1">
              <Button
                aria-describedby={
                  pending || !note.trim() ? addNoteReasonId : undefined
                }
                className="justify-self-start"
                disabled={pending || !note.trim()}
                size="sm"
                type="submit"
                variant="secondary"
              >
                Add note
              </Button>
              {pending || !note.trim() ? (
                <p
                  className="text-(length:--text-small) text-(--disabled-foreground)"
                  id={addNoteReasonId}
                >
                  {pending
                    ? "Available once the change you just made has saved."
                    : "Write the note first."}
                </p>
              ) : null}
            </div>
          </form>
          {crm.notes.length > 0 ? (
            <ul className="grid gap-2" aria-label="Application notes">
              {[...crm.notes].reverse().map((entry) => (
                <li
                  className="flex items-start justify-between gap-3 rounded-(--radius-field) bg-background/45 p-3 text-sm"
                  key={entry.id}
                >
                  <div>
                    <p className="min-w-0 wrap-anywhere whitespace-pre-wrap text-foreground">
                      {entry.body}
                    </p>
                    <time
                      className="mt-1 block text-xs text-muted-foreground"
                      dateTime={entry.updatedAt}
                    >
                      {new Date(entry.updatedAt).toLocaleString()}
                    </time>
                  </div>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      void mutate({ type: "remove_note", noteId: entry.id })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.75fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const dueAt = toIso(reminderAt);
              if (!reminderTitle.trim() || !dueAt) return;
              const now = new Date().toISOString();
              void mutate({
                type: "upsert_reminder",
                reminder: {
                  id: createId("reminder"),
                  title: reminderTitle.trim(),
                  dueAt,
                  status: "pending",
                  note: null,
                  createdAt: now,
                  updatedAt: now,
                  completedAt: null,
                },
              }).then((saved) => {
                if (!saved) return;
                setReminderTitle("");
                setReminderAt("");
              });
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Reminder
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setReminderTitle(event.target.value)}
                placeholder="Follow up"
                value={reminderTitle}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Due
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setReminderAt(event.target.value)}
                lang={jobFinderDateInputLocale}
                type="datetime-local"
                value={reminderAt}
              />
            </label>
            <Button
              disabled={pending || !reminderTitle.trim() || !reminderAt}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Add
            </Button>
          </form>
          {crm.reminders.length > 0 ? (
            <ul aria-label="Application reminders" className="grid gap-2">
              {[...crm.reminders].reverse().map((entry) => (
                <li
                  className="grid gap-2 rounded-(--radius-field) bg-background/45 p-3 text-sm"
                  key={entry.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-foreground">
                        {entry.title}
                      </p>
                      <time
                        className="mt-0.5 block text-xs text-muted-foreground"
                        dateTime={entry.dueAt}
                      >
                        Due {new Date(entry.dueAt).toLocaleString()}
                      </time>
                    </div>
                    <StatusBadge
                      tone={entry.status === "pending" ? "active" : "muted"}
                    >
                      {entry.status}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.status === "pending" ? (
                      <>
                        <Button
                          disabled={pending}
                          onClick={() => setReminderStatus(entry, "completed")}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Complete
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => setReminderStatus(entry, "dismissed")}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Dismiss
                        </Button>
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            rescheduleReminder(entry);
                          }}
                        >
                          <input
                            aria-label={`New due time for ${entry.title}`}
                            className={`${fieldClassName} sm:w-56`}
                            disabled={pending}
                            onChange={(event) =>
                              setReminderReschedules((current) => ({
                                ...current,
                                [entry.id]: event.target.value,
                              }))
                            }
                            lang={jobFinderDateInputLocale}
                            type="datetime-local"
                            value={reminderReschedules[entry.id] ?? ""}
                          />
                          <Button
                            disabled={pending || !reminderReschedules[entry.id]}
                            size="sm"
                            type="submit"
                            variant="secondary"
                          >
                            Reschedule
                          </Button>
                        </form>
                      </>
                    ) : null}
                    <Button
                      disabled={pending}
                      onClick={() =>
                        void mutate({
                          type: "remove_reminder",
                          reminderId: entry.id,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      <details className="rounded-(--radius-field) border border-(--control-border) p-3">
        <summary className="cursor-pointer font-semibold text-foreground">
          Interviews and contacts
        </summary>
        <div className="mt-3 grid gap-4">
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.75fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const startsAt = toIso(interviewAt);
              if (!interviewTitle.trim() || !startsAt) return;
              const now = new Date().toISOString();
              void mutate({
                type: "upsert_interview",
                interview: {
                  id: createId("interview"),
                  title: interviewTitle.trim(),
                  startsAt,
                  endsAt: null,
                  timeZone:
                    Intl.DateTimeFormat().resolvedOptions().timeZone || null,
                  location: null,
                  meetingUrl: null,
                  contactIds: [],
                  status: "scheduled",
                  notes: null,
                  createdAt: now,
                  updatedAt: now,
                },
              }).then((saved) => {
                if (!saved) return;
                setInterviewTitle("");
                setInterviewAt("");
              });
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Interview
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setInterviewTitle(event.target.value)}
                placeholder="Technical interview"
                value={interviewTitle}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Starts
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setInterviewAt(event.target.value)}
                lang={jobFinderDateInputLocale}
                type="datetime-local"
                value={interviewAt}
              />
            </label>
            <Button
              disabled={pending || !interviewTitle.trim() || !interviewAt}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Add
            </Button>
          </form>
          {crm.interviews.length > 0 ? (
            <ul aria-label="Application interviews" className="grid gap-2">
              {[...crm.interviews].reverse().map((entry) => (
                <li
                  className="grid gap-2 rounded-(--radius-field) bg-background/45 p-3 text-sm"
                  key={entry.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-foreground">
                        {entry.title}
                      </p>
                      <time
                        className="mt-0.5 block text-xs text-muted-foreground"
                        dateTime={entry.startsAt}
                      >
                        Starts {new Date(entry.startsAt).toLocaleString()}
                      </time>
                    </div>
                    <StatusBadge
                      tone={
                        entry.status === "scheduled"
                          ? "active"
                          : entry.status === "completed"
                            ? "positive"
                            : "muted"
                      }
                    >
                      {entry.status}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.status === "scheduled" ? (
                      <>
                        <Button
                          disabled={pending}
                          onClick={() => setInterviewStatus(entry, "completed")}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Complete
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => setInterviewStatus(entry, "cancelled")}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    <Button
                      disabled={pending}
                      onClick={() =>
                        void mutate({
                          type: "remove_interview",
                          interviewId: entry.id,
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (!contactName.trim()) return;
              const now = new Date().toISOString();
              void mutate({
                type: "upsert_contact",
                contact: {
                  id: createId("contact"),
                  name: contactName.trim(),
                  role: null,
                  email: contactEmail.trim() || null,
                  phone: null,
                  profileUrl: null,
                  notes: null,
                  createdAt: now,
                  updatedAt: now,
                },
              }).then((saved) => {
                if (!saved) return;
                setContactName("");
                setContactEmail("");
              });
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Contact name
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setContactName(event.target.value)}
                value={contactName}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Email
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setContactEmail(event.target.value)}
                type="email"
                value={contactEmail}
              />
            </label>
            <Button
              disabled={pending || !contactName.trim()}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Add
            </Button>
          </form>
          {crm.contacts.length > 0 ? (
            <ul aria-label="Application contacts" className="grid gap-2">
              {[...crm.contacts].reverse().map((entry) => (
                <li
                  className="flex items-start justify-between gap-3 rounded-(--radius-field) bg-background/45 p-3 text-sm"
                  key={entry.id}
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-foreground">
                      {entry.name}
                    </p>
                    {entry.email ? (
                      <p className="mt-0.5 text-xs break-words text-muted-foreground">
                        {entry.email}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      void mutate({
                        type: "remove_contact",
                        contactId: entry.id,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      <details className="rounded-(--radius-field) border border-(--control-border) p-3">
        <summary className="cursor-pointer font-semibold text-foreground">
          Offer and attachments
        </summary>
        <div className="mt-3 grid gap-4">
          <form
            className="grid gap-2 sm:grid-cols-4 sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              const amount = Number(offerAmount);
              if (!Number.isFinite(amount) || amount < 0) return;
              void mutate({
                type: "set_compensation",
                compensation: {
                  ...crm.compensation,
                  offerBase: {
                    amount,
                    currency: offerCurrency.trim().toUpperCase(),
                    period: offerPeriod,
                  },
                  offerDeadlineAt: toIso(offerDeadline),
                  offerStatus:
                    crm.compensation.offerStatus === "none"
                      ? "active"
                      : crm.compensation.offerStatus,
                },
              });
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Offer amount
              <input
                className={fieldClassName}
                disabled={pending}
                min="0"
                onChange={(event) => setOfferAmount(event.target.value)}
                type="number"
                value={offerAmount}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Currency
              <input
                className={fieldClassName}
                disabled={pending}
                maxLength={3}
                onChange={(event) => setOfferCurrency(event.target.value)}
                value={offerCurrency}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Period
              <select
                className={fieldClassName}
                disabled={pending}
                onChange={(event) =>
                  setOfferPeriod(event.target.value as typeof offerPeriod)
                }
                value={offerPeriod}
              >
                <option value="hour">Hourly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Deadline
              <input
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setOfferDeadline(event.target.value)}
                lang={jobFinderDateInputLocale}
                type="datetime-local"
                value={offerDeadline}
              />
            </label>
            <Button
              className="sm:col-span-4 sm:justify-self-start"
              disabled={pending || !offerAmount}
              size="sm"
              type="submit"
              variant="secondary"
            >
              Save offer
            </Button>
          </form>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Approved local asset
              <select
                className={fieldClassName}
                disabled={pending}
                onChange={(event) => setSelectedAssetId(event.target.value)}
                value={selectedAssetId}
              >
                <option value="">Choose an asset</option>
                {candidateAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalName}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={pending || !selectedAssetId}
              onClick={() => {
                const asset = candidateAssets.find(
                  (candidate) => candidate.id === selectedAssetId,
                );
                if (!asset) return;
                void mutate({
                  type: "add_attachment",
                  attachment: {
                    id: createId("attachment"),
                    candidateAssetId: asset.id,
                    label: asset.originalName,
                    kind: [
                      "resume",
                      "cover_letter",
                      "portfolio",
                      "work_sample",
                    ].includes(asset.kind)
                      ? (asset.kind as
                          | "resume"
                          | "cover_letter"
                          | "portfolio"
                          | "work_sample")
                      : "other",
                    addedAt: new Date().toISOString(),
                  },
                }).then((saved) => {
                  if (saved) setSelectedAssetId("");
                });
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              Link asset
            </Button>
          </div>
          {crm.attachments.length > 0 ? (
            <ul
              aria-label="Linked application attachments"
              className="grid gap-2"
            >
              {[...crm.attachments].reverse().map((entry) => (
                <li
                  className="flex items-start justify-between gap-3 rounded-(--radius-field) bg-background/45 p-3 text-sm"
                  key={entry.id}
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-foreground">
                      {entry.label}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.kind.replaceAll("_", " ")}
                    </p>
                  </div>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      void mutate({
                        type: "remove_attachment",
                        attachmentId: entry.id,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Unlink
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Only metadata is linked here. The file itself, its integrity checks,
            and its stored bytes stay with your files under Profile.
          </p>
        </div>
      </details>

      <details className="rounded-(--radius-field) border border-(--control-border) p-3">
        <summary className="cursor-pointer font-semibold text-foreground">
          Timeline ({crm.events.length})
        </summary>
        {crm.events.length > 0 ? (
          <ol className="mt-3 grid gap-2">
            {[...crm.events].reverse().map((event) => {
              const copy = applicationCrmEventCopyForView(
                event.title,
                event.detail,
              );
              return (
                <li
                  className="border-l-2 border-(--surface-panel-border) pl-3"
                  key={event.id}
                >
                  <strong className="text-sm text-foreground">
                    {copy.title}
                  </strong>
                  {copy.detail ? (
                    <p className="mt-1 text-sm text-foreground-soft">
                      {copy.detail}
                    </p>
                  ) : null}
                  <time
                    className="mt-1 block text-xs text-muted-foreground"
                    dateTime={event.at}
                  >
                    {new Date(event.at).toLocaleString()} ·{" "}
                    {event.source.replaceAll("_", " ")}
                  </time>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No tracker activity has been recorded yet. Existing safe-apply
            history remains available below.
          </p>
        )}
      </details>

      {props.onRecordOutcome ? (
        <ApplicationsOutcomeRecorder
          isPending={props.isRecordOutcomePending ?? false}
          jobId={props.record.jobId}
          campaignId={props.outcomeCampaignId ?? null}
          applicationRecordId={props.record.id}
          onRecordOutcome={props.onRecordOutcome}
          resumeStrategyId={props.outcomeResumeStrategyId ?? null}
        />
      ) : null}
    </section>
  );
}
