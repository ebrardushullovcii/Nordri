import { useEffect, useId, useState } from "react";
import { Field, FieldLabel } from "@renderer/components/ui/field";
import { Input } from "@renderer/components/ui/input";
import {
  APPLY_MODE_OPTIONS,
  ChoiceCards,
} from "@renderer/features/job-finder/components/choice-cards";
import type { ApplicationAutomationMode } from "@unemployed/contracts";
import { useRegisterSettingsDirtySection } from "./settings-dirty-sections";
import {
  hasOutstandingSectionChanges,
  useSettingsSectionSave,
} from "./settings-section-save";
import { SettingsSectionSaveControl } from "./settings-section-save-control";

/**
 * What every Apply and Apply to all does from now on, said once the choice
 * has saved, so the person reads which mode the next journey will use.
 */
const SAVED_MODE_SENTENCE: Record<ApplicationAutomationMode, string> = {
  prepare_only:
    "Saved. From now on Apply fills in each form and attaches the resume; you press Send.",
  confirm_before_submit:
    "Saved. From now on Apply fills in each form, then waits for your go-ahead before sending.",
  autonomous_submit:
    "Saved. From now on Apply fills in and sends each application, and pauses only when it needs you.",
};

/** Runs a save now, turning a synchronous throw into a rejected promise. */
function startSave(save: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(save());
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

type ModeSaveState = {
  status: "idle" | "saving" | "saved" | "failed";
  message: string | null;
};

/**
 * The three useful application defaults. The task-specific permission is
 * assembled when an application starts; Settings stores only the person's
 * ordinary choice, never an empty authority envelope.
 *
 * The mode is one switch (ADR 0022): pressing a card saves it. It used to
 * wait for a separate Save button further down, and a person who picked
 * "Send for me" and went back to Home lost the choice without a word; the
 * next Apply to all then ran in the old mode. The daily limit is typed, so
 * it keeps its own Save and joins the page's unsaved-changes bar.
 */
export function SettingsApplyModeSection(props: {
  headingId?: string;
  /** The saved mode; the switch is off until the person turns it on. */
  mode: ApplicationAutomationMode;
  /** The existing daily cap on applications, kept from ADR 0012. */
  maxApplicationsPerLocalDay: number;
  onSave: (input: {
    mode: ApplicationAutomationMode;
    maxApplicationsPerLocalDay: number;
  }) => void | Promise<void>;
  isSaving?: boolean;
}) {
  const { headingId, isSaving = false, mode, onSave } = props;
  const dailyCapId = useId();
  const dailyCapErrorId = useId();
  const [selectedMode, setSelectedMode] = useState(mode);
  const [modeSave, setModeSave] = useState<ModeSaveState>({
    status: "idle",
    message: null,
  });
  const [dailyCap, setDailyCap] = useState(
    String(props.maxApplicationsPerLocalDay),
  );
  const {
    resetSectionSave: resetCapSave,
    runSectionSave: runCapSave,
    saveState: capSaveState,
  } = useSettingsSectionSave();

  useEffect(() => {
    setSelectedMode(mode);
  }, [mode]);
  useEffect(() => {
    setDailyCap(String(props.maxApplicationsPerLocalDay));
  }, [props.maxApplicationsPerLocalDay]);

  const parsedCap = Number(dailyCap);
  const capIsValid =
    /^\d+$/.test(dailyCap) && Number.isSafeInteger(parsedCap) && parsedCap > 0;
  const capIsDirty = capIsValid
    ? parsedCap !== props.maxApplicationsPerLocalDay
    : dailyCap !== String(props.maxApplicationsPerLocalDay);
  const capSaving = capSaveState.status === "saving";
  const capIsOutstanding = hasOutstandingSectionChanges(
    capIsDirty,
    capSaveState,
  );
  const modeSaving = modeSave.status === "saving";

  const chooseMode = (value: ApplicationAutomationMode) => {
    if (isSaving || modeSaving || capSaving) return;
    if (value === mode && modeSave.status !== "failed") {
      setSelectedMode(value);
      return;
    }
    const previous = mode;
    setSelectedMode(value);
    setModeSave({ status: "saving", message: null });
    void startSave(() =>
      onSave({
        mode: value,
        // The saved limit, never a half-typed one: only the mode was chosen.
        maxApplicationsPerLocalDay: props.maxApplicationsPerLocalDay,
      }),
    ).then(
      () => {
        setModeSave({ status: "saved", message: SAVED_MODE_SENTENCE[value] });
      },
      () => {
        setSelectedMode(previous);
        setModeSave({
          status: "failed",
          message:
            "That did not save, so Apply still uses the mode shown. Try again.",
        });
      },
    );
  };

  const saveDailyCap = () => {
    if (!capIsOutstanding || !capIsValid || isSaving || capSaving || modeSaving) {
      return;
    }
    // The mode the person last picked, so a limit saved moments after a
    // mode change can never put the old mode back.
    const maxApplicationsPerLocalDay = parsedCap;
    void runCapSave({
      execute: () =>
        startSave(() =>
          onSave({ mode: selectedMode, maxApplicationsPerLocalDay }),
        ),
      failedMessage: "The daily limit did not save. Try again.",
      savedMessage: `Saved. Apply stops after ${maxApplicationsPerLocalDay} ${maxApplicationsPerLocalDay === 1 ? "application" : "applications"} a day.`,
    });
  };

  // One save for the typed limit, in the section header like every other
  // Settings section; the page's unsaved-changes bar names it when the
  // person scrolls away. A second "Save daily limit" under the field used to
  // sit right above the bar's own button with the same name.
  useRegisterSettingsDirtySection({
    anchorId: "settings-application-authority",
    isDirty: capIsOutstanding,
    isSaveDisabled: !capIsValid || isSaving || modeSaving,
    isSaving: capSaving,
    label: "Applying",
    onSave: saveDailyCap,
    order: 2.5,
    saveLabel: "Save daily limit",
  });

  return (
    <section className="surface-panel-shell grid min-w-0 content-start gap-4 rounded-(--radius-field) border border-(--surface-panel-border) px-4 py-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 max-w-[72ch] flex-1 gap-1">
          <h3
            className="min-w-0 font-semibold text-(--text-headline)"
            id={headingId}
          >
            Applying
          </h3>
          <p className="text-(length:--text-description) leading-5 text-foreground-soft">
            What Apply does. Your choice saves as soon as you pick it, and every
            Apply and Apply to all uses it until you change it here.
          </p>
        </div>
        <SettingsSectionSaveControl
          hasUnsavedChanges={capIsDirty}
          isSaveDisabled={!capIsValid || isSaving || modeSaving}
          onSave={saveDailyCap}
          saveState={capSaveState}
          subject="daily limit"
        />
      </div>

      <ChoiceCards
        aria-label="Default application mode"
        disabled={isSaving || modeSaving || capSaving}
        onChange={chooseMode}
        options={APPLY_MODE_OPTIONS}
        value={selectedMode}
      />
      {modeSave.message ? (
        <p
          className={
            modeSave.status === "failed"
              ? "text-sm leading-5 text-destructive"
              : "text-sm leading-5 text-(--success-text)"
          }
          data-apply-mode-save-state={modeSave.status}
          role={modeSave.status === "failed" ? "alert" : "status"}
        >
          {modeSave.message}
        </p>
      ) : null}

      <p className="text-sm leading-5 text-foreground-soft">
        Sign-in, security checks, and account creation pause for you. Job Finder
        never stores a password you provide for one task.
      </p>

      <Field>
        <FieldLabel htmlFor={dailyCapId}>
          Most applications in one day
        </FieldLabel>
        <Input
          aria-describedby={!capIsValid ? dailyCapErrorId : undefined}
          aria-invalid={!capIsValid}
          disabled={isSaving || capSaving || modeSaving}
          id={dailyCapId}
          min="1"
          step="1"
          onChange={(event) => {
            setDailyCap(event.target.value);
            resetCapSave();
          }}
          type="number"
          value={dailyCap}
        />
        {!capIsValid ? (
          <p
            className="text-sm leading-5 text-foreground-soft"
            id={dailyCapErrorId}
          >
            Enter a whole number of 1 or more.
          </p>
        ) : null}
      </Field>
    </section>
  );
}
