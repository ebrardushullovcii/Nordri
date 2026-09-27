import type {
  AppearanceTheme,
  ApplicationCrmSettings,
  BrowserSessionState,
  JobFinderSettings,
  JobSearchPreferences,
  ResumeTemplateDefinition,
  UpdateAiBehaviorInput,
  UpdateApplicationDefaultsInput,
  UpdateWorkspaceBehaviorInput,
} from "@unemployed/contracts";
import { ApplicationCrmSettingsSchema } from "@unemployed/contracts";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@renderer/lib/cn";
import { JOB_FINDER_ROUTE_PATHS } from "@renderer/features/job-finder/lib/job-finder-route-hrefs";
import { SHELL_SCROLLING_ROUTE_BOTTOM_GUTTER_CANCEL_CLASS } from "../../lib/job-finder-shell-gutters";
import { PageHeaderStack } from "../../components/page-header";
import { ApplicationsCrmSettingsEditor } from "../applications/applications-crm-settings";
import {
  SETTINGS_AI_BEHAVIOR_LABEL,
  SettingsAiBehaviorSection,
} from "./settings-ai-behavior-section";
import { SettingsAppDeviceSection } from "./settings-app-device-section";
import {
  SETTINGS_RESUME_LOOK_LABEL,
  SettingsApplicationDefaultsSection,
} from "./settings-application-defaults-section";
import { SettingsApplyModeSection } from "./settings-apply-mode-section";
import {
  SettingsDirtySectionsProvider,
  useSettingsDirtySections,
} from "./settings-dirty-sections";
import { SettingsRuntimeSummary } from "./settings-runtime-summary";
import { focusSettingsSection } from "./settings-section-anchor";
import { SettingsSupportControls } from "./settings-support-controls";
import { SettingsUnsavedChangesBar } from "./settings-unsaved-changes-bar";
import { SettingsWorkspaceBehaviorSection } from "./settings-workspace-behavior-section";
import { SettingsWorkspaceControls } from "./settings-workspace-controls";

// `Application authority` and `Workspace behavior` were product vocabulary,
// not user vocabulary. The boundary and every permission it describes are
// ADR 0022: one switch decides whether Job Finder sends the application or
// leaves it filled in for the person to send. The section is named for the
// thing it decides.
export const SETTINGS_APPLICATION_AUTHORITY_LABEL = "Applying";
export const SETTINGS_WORKSPACE_BEHAVIOR_LABEL = "Browser & saved jobs";

const settingsSections = [
  {
    headingId: "settings-app-device-heading",
    href: "#settings-app-device",
    id: "settings-app-device",
    label: "App & device",
    tone: "default",
  },
  {
    headingId: "settings-ai-behavior-heading",
    href: "#settings-ai-behavior",
    id: "settings-ai-behavior",
    label: SETTINGS_AI_BEHAVIOR_LABEL,
    tone: "default",
  },
  {
    headingId: "settings-application-defaults-heading",
    href: "#settings-application-defaults",
    id: "settings-application-defaults",
    label: SETTINGS_RESUME_LOOK_LABEL,
    tone: "default",
  },
  {
    headingId: "settings-application-authority-heading",
    href: "#settings-application-authority",
    id: "settings-application-authority",
    label: SETTINGS_APPLICATION_AUTHORITY_LABEL,
    tone: "default",
  },
  {
    headingId: "settings-workspace-behavior-heading",
    href: "#settings-workspace-behavior",
    id: "settings-workspace-behavior",
    label: SETTINGS_WORKSPACE_BEHAVIOR_LABEL,
    tone: "default",
  },
  {
    headingId: "settings-tracker-heading",
    href: "#settings-tracker",
    id: "settings-tracker",
    label: "Tracker",
    tone: "default",
  },
  {
    headingId: "settings-diagnostics-heading",
    href: "#settings-diagnostics",
    id: "settings-diagnostics",
    label: "Diagnostics",
    tone: "default",
  },
  {
    headingId: "settings-danger-zone-heading",
    href: "#settings-danger-zone",
    id: "settings-danger-zone",
    label: "Delete everything",
    // The only section that can destroy work says so before it is opened.
    tone: "destructive",
  },
] as const;

// The sticky section subnav sits over the page scroller. Its wrapped height is
// layout-dependent (it wraps at native zoom levels and narrow windows), so its
// scroll clearance is derived from the rendered nav height plus a breathing
// gap, with a raised fallback that covers the widest realistic wrap before the
// first measurement lands (and where ResizeObserver is unavailable).
export const SETTINGS_SUBNAV_BOTTOM_GAP_PX = 12;
export const SETTINGS_SUBNAV_WRAPPED_ROW_HEIGHT_PX = 40;
export const SETTINGS_SUBNAV_WRAPPED_ROW_GAP_PX = 4;
export const SETTINGS_SUBNAV_VERTICAL_PADDING_PX = 16;
export const SETTINGS_SUBNAV_SCROLL_OFFSET_FALLBACK_PX =
  SETTINGS_SUBNAV_WRAPPED_ROW_HEIGHT_PX * 2 +
  SETTINGS_SUBNAV_WRAPPED_ROW_GAP_PX +
  SETTINGS_SUBNAV_VERTICAL_PADDING_PX +
  SETTINGS_SUBNAV_BOTTOM_GAP_PX;
export const SETTINGS_SUBNAV_OFFSET_VARIABLE = "--settings-subnav-offset";

// The unsaved-changes bar is sticky to the bottom of the same scroller, so the
// last card needs at least the bar's own height of clearance beneath it —
// otherwise the bar sits over live card text with no scroll position that
// frees it. The bar wraps (narrow windows, several dirty sections), so the
// clearance is measured rather than assumed, with a wrap-aware fallback until
// the first measurement lands.
export const SETTINGS_UNSAVED_BAR_BOTTOM_GAP_PX = 12;
export const SETTINGS_UNSAVED_BAR_WRAPPED_ROW_HEIGHT_PX = 32;
export const SETTINGS_UNSAVED_BAR_VERTICAL_PADDING_PX = 16;
export const SETTINGS_UNSAVED_BAR_CLEARANCE_FALLBACK_PX =
  SETTINGS_UNSAVED_BAR_WRAPPED_ROW_HEIGHT_PX * 2 +
  SETTINGS_UNSAVED_BAR_VERTICAL_PADDING_PX +
  SETTINGS_UNSAVED_BAR_BOTTOM_GAP_PX;
export const SETTINGS_UNSAVED_BAR_CLEARANCE_VARIABLE =
  "--settings-unsaved-bar-clearance";

export function SettingsScreen(props: {
  availableResumeTemplates: readonly ResumeTemplateDefinition[];
  browserSession: BrowserSessionState;
  isWorkspaceResetPending: boolean;
  onResetWorkspace: () => void;
  // Reports staged settings edits upward so a shell save retry captured
  // before the edit can never resubmit stale values.
  onSettingsDraftEdited: () => void;
  // Scoped saves resolve false when the save did not commit; sections treat
  // that as a failure instead of showing a local saved message.
  onUpdateAppearanceTheme: (
    theme: AppearanceTheme,
  ) => Promise<boolean | void> | void;
  onUpdateAiBehavior: (
    input: UpdateAiBehaviorInput,
  ) => Promise<boolean | void> | void;
  onUpdateApplicationDefaults: (
    input: UpdateApplicationDefaultsInput,
  ) => Promise<boolean | void> | void;
  onUpdateTrackerCrm: (
    settings: ApplicationCrmSettings,
  ) => Promise<boolean | void> | void;
  onUpdateWorkspaceBehavior: (
    input: UpdateWorkspaceBehaviorInput,
  ) => Promise<boolean | void> | void;
  /** The saved resume tailoring strength lives here, not in settings. */
  searchPreferences: Pick<JobSearchPreferences, "tailoringMode">;
  settings: JobFinderSettings;
}) {
  const {
    availableResumeTemplates,
    browserSession,
    isWorkspaceResetPending,
    onResetWorkspace,
    onSettingsDraftEdited,
    onUpdateAiBehavior,
    onUpdateAppearanceTheme,
    onUpdateApplicationDefaults,
    onUpdateTrackerCrm,
    onUpdateWorkspaceBehavior,
    searchPreferences,
    settings,
  } = props;

  const subnavRef = useRef<HTMLElement | null>(null);
  const unsavedBarRef = useRef<HTMLDivElement | null>(null);
  const [sectionScrollOffsetPx, setSectionScrollOffsetPx] = useState(
    SETTINGS_SUBNAV_SCROLL_OFFSET_FALLBACK_PX,
  );
  const [unsavedBarClearancePx, setUnsavedBarClearancePx] = useState(
    SETTINGS_UNSAVED_BAR_CLEARANCE_FALLBACK_PX,
  );
  // Seven labels at one colour with no current-item marker are a list, not
  // navigation. The active section is tracked so the nav can say where the
  // reader is.
  const [activeSectionId, setActiveSectionId] = useState<string>(
    settingsSections[0].id,
  );
  const location = useLocation();
  const { dirtySections, registry } = useSettingsDirtySections();

  useLayoutEffect(() => {
    const sectionId = location.hash.slice(1);
    if (
      settingsSections.some((section) => section.id === sectionId) &&
      focusSettingsSection(sectionId)
    ) {
      setActiveSectionId(sectionId);
    }
  }, [location.hash]);

  // A workspace that has never saved tracker settings has no persisted
  // `applicationCrm`, and parsing a fresh default inline handed the Tracker
  // editor a new object identity on every render of this screen. Its
  // "reseed from persisted settings" effect then fired on every render and
  // reset the form, so a tracker edit could never become dirty, never
  // published to the save bar, and never reached its own Save.
  const applicationCrmSettings = useMemo(
    () => settings.applicationCrm ?? ApplicationCrmSettingsSchema.parse({}),
    [settings.applicationCrm],
  );

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const visibleRatios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRatios.set(
            entry.target.id,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        }

        let mostVisibleId: string | null = null;
        let mostVisibleRatio = 0;
        // Document order breaks ties, so scrolling never flickers between two
        // equally visible neighbours.
        for (const section of settingsSections) {
          const ratio = visibleRatios.get(section.id) ?? 0;
          if (ratio > mostVisibleRatio) {
            mostVisibleRatio = ratio;
            mostVisibleId = section.id;
          }
        }

        if (mostVisibleId) {
          setActiveSectionId(mostVisibleId);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const section of settingsSections) {
      const target = document.getElementById(section.id);
      if (target) {
        observer.observe(target);
      }
    }

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const subnav = subnavRef.current;
    if (!subnav) {
      return;
    }

    const measureSubnavOffset = () => {
      const height = subnav.getBoundingClientRect().height;
      // Unmeasured layouts (jsdom, pre-first-paint) report 0px; keep the
      // raised wrap-aware floor so a wrapped subnav can never cover the
      // headings it scrolls to.
      if (height <= 0) {
        return;
      }
      setSectionScrollOffsetPx(
        Math.ceil(height) + SETTINGS_SUBNAV_BOTTOM_GAP_PX,
      );
    };

    measureSubnavOffset();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measureSubnavOffset);
    observer.observe(subnav);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const bar = unsavedBarRef.current;
    if (!bar) {
      setUnsavedBarClearancePx(0);
      return;
    }

    setUnsavedBarClearancePx(SETTINGS_UNSAVED_BAR_CLEARANCE_FALLBACK_PX);
    const measureUnsavedBarClearance = () => {
      const height = bar.getBoundingClientRect().height;
      // Unmeasured layouts (jsdom, pre-first-paint) report 0px; keep the
      // wrap-aware floor so the last card can always be scrolled clear of the
      // sticky bar.
      if (height <= 0) {
        return;
      }
      setUnsavedBarClearancePx(
        Math.ceil(height) + SETTINGS_UNSAVED_BAR_BOTTOM_GAP_PX,
      );
    };

    measureUnsavedBarClearance();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measureUnsavedBarClearance);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [dirtySections.length > 0]);

  const handleSectionAnchorClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const isUnmodifiedPrimaryActivation =
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey;

    if (!isUnmodifiedPrimaryActivation) {
      return;
    }

    event.preventDefault();

    const sectionId = event.currentTarget.getAttribute("href")?.slice(1);
    if (!sectionId) {
      return;
    }

    if (!focusSettingsSection(sectionId)) {
      return;
    }

    setActiveSectionId(sectionId);
  };

  return (
    <section
      // The unsaved-changes bar is `sticky bottom-0`, and a sticky box is
      // clamped to its containing block. With the shell's own bottom gutter
      // still in place that block ended 40px above the window, so the bar came
      // to rest there with live cards rendering under and below it — it read
      // as a strip dropped into the middle of the page. The route cancels the
      // shell gutter (the bar is this route's bottom edge and paints its own)
      // and drops its trailing `pb-8` for the same reason: any padding after
      // the bar is padding the bar cannot cover at the end of the scroll.
      className={cn(
        "grid min-w-0 gap-3",
        SHELL_SCROLLING_ROUTE_BOTTOM_GUTTER_CANCEL_CLASS,
      )}
      style={
        {
          [SETTINGS_SUBNAV_OFFSET_VARIABLE]: `${sectionScrollOffsetPx}px`,
          [SETTINGS_UNSAVED_BAR_CLEARANCE_VARIABLE]: `${unsavedBarClearancePx}px`,
        } as CSSProperties
      }
    >
      {/* The old standing notice spent a bordered 70px band restating where
          Documents lives. It is one line of the header's own meta slot now, so
          the first real setting is reachable in a short window. */}
      <PageHeaderStack
        description="Choose how the AI works for you, and set reusable defaults for resumes and applications."
        meta={
          <>
            Your resume and any extra files for applications are managed in{" "}
            <Link
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              to={JOB_FINDER_ROUTE_PATHS.profile}
            >
              Profile
            </Link>
            .
          </>
        }
        title="Settings"
      />

      <nav
        aria-label="Settings sections"
        // Fully opaque with its own edge: a translucent blurred band let the
        // page scroll visibly through it and cut headings and helper text in
        // half as they passed underneath.
        //
        // `top-0` is the only correct sticky offset here, at every width. The
        // scroll owner is the shell's `<main>`, which already begins below the
        // fixed shell header (the shell pads its content wrapper by the header
        // height). A width-specific `sm:top-[7.25rem]` re-applied that same
        // header height a second time, so at scroll 0 the band was pushed 33px
        // past its own flow box and painted over the first card's top border,
        // padding and heading. Do not reintroduce a header-height offset here.
        className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-1 border-b border-(--surface-panel-border) bg-(--background) px-1 py-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]"
        ref={subnavRef}
      >
        {settingsSections.map((section) => {
          const isActive = section.id === activeSectionId;
          const isDestructive = section.tone === "destructive";

          return (
            <a
              // A transparent border on every state keeps the box metrics
              // identical, so the current item never nudges its neighbours.
              aria-current={isActive ? "location" : undefined}
              className={cn(
                "inline-flex min-h-10 min-w-10 items-center justify-center rounded-(--radius-button) border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                isActive &&
                  !isDestructive &&
                  "border-(--nav-active-surface) bg-(--nav-active-surface) text-(--nav-active-foreground) shadow-[inset_0_-2px_0_0_var(--nav-active-bar)]",
                isActive &&
                  isDestructive &&
                  "border-(--destructive) bg-(--destructive)/18 text-(--destructive) shadow-[inset_0_-2px_0_0_var(--destructive)]",
                !isActive &&
                  !isDestructive &&
                  "border-transparent text-foreground-soft hover:border-(--surface-panel-border) hover:bg-secondary hover:text-foreground focus-visible:text-foreground",
                !isActive &&
                  isDestructive &&
                  "border-transparent text-(--destructive) hover:border-(--destructive) hover:bg-(--destructive)/10",
              )}
              href={section.href}
              key={section.id}
              onClick={handleSectionAnchorClick}
            >
              {section.label}
            </a>
          );
        })}
      </nav>

      <SettingsDirtySectionsProvider registry={registry}>
        <section
          aria-labelledby="settings-app-device-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-app-device"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-app-device-heading">
            App & device
          </h2>
          <SettingsAppDeviceSection
            onSettingsDraftEdited={onSettingsDraftEdited}
            onUpdateAppearanceTheme={onUpdateAppearanceTheme}
            settings={settings}
          />
        </section>

        <section
          aria-labelledby="settings-ai-behavior-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-ai-behavior"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-ai-behavior-heading">
            {SETTINGS_AI_BEHAVIOR_LABEL}
          </h2>
          <SettingsAiBehaviorSection
            onSettingsDraftEdited={onSettingsDraftEdited}
            onUpdateAiBehavior={onUpdateAiBehavior}
            searchPreferences={searchPreferences}
            settings={settings}
          />
        </section>

        <section
          aria-labelledby="settings-application-defaults-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-application-defaults"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-application-defaults-heading">
            {SETTINGS_RESUME_LOOK_LABEL}
          </h2>
          <SettingsApplicationDefaultsSection
            availableResumeTemplates={availableResumeTemplates}
            onSettingsDraftEdited={onSettingsDraftEdited}
            onUpdateApplicationDefaults={onUpdateApplicationDefaults}
            settings={settings}
          />
        </section>

        <section
          aria-labelledby="settings-application-authority-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-application-authority"
          tabIndex={-1}
        >
          {/* No sr-only h2 here: this section's visible heading already says
              exactly the region name, so a hidden duplicate above it read the
              same sentence twice at two different heading levels. */}
          <SettingsApplyModeSection
            headingId="settings-application-authority-heading"
            maxApplicationsPerLocalDay={
              settings.maxApplicationsPerLocalDay ?? 20
            }
            mode={settings.applicationAutomationMode ?? "prepare_only"}
            onSave={async (input) => {
              onSettingsDraftEdited();
              const saved = await onUpdateApplicationDefaults({
                applicationAutomationMode: input.mode,
                maxApplicationsPerLocalDay: input.maxApplicationsPerLocalDay,
              });
              if (saved === false) {
                throw new Error("The application mode did not save.");
              }
            }}
          />
        </section>

        <section
          aria-labelledby="settings-workspace-behavior-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-workspace-behavior"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-workspace-behavior-heading">
            {SETTINGS_WORKSPACE_BEHAVIOR_LABEL}
          </h2>
          <SettingsWorkspaceBehaviorSection
            onSettingsDraftEdited={onSettingsDraftEdited}
            onUpdateWorkspaceBehavior={onUpdateWorkspaceBehavior}
            settings={settings}
          />
        </section>

        <section
          aria-labelledby="settings-tracker-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-tracker"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-tracker-heading">
            Tracker
          </h2>
          <ApplicationsCrmSettingsEditor
            onDraftEdited={onSettingsDraftEdited}
            onSave={async (crmSettings) => {
              const saved = await onUpdateTrackerCrm(crmSettings);
              // Scoped saves resolve false instead of rejecting when the save
              // did not commit. Throwing here enters the editor's existing
              // failure path so its staged values are kept for a retry.
              if (saved === false) {
                throw new Error(
                  "The application tracker settings could not be saved.",
                );
              }
            }}
            settings={applicationCrmSettings}
          />
        </section>

        <section
          aria-labelledby="settings-diagnostics-heading"
          className="scroll-mt-(--settings-subnav-offset) min-w-0"
          id="settings-diagnostics"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-diagnostics-heading">
            Diagnostics
          </h2>
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.32fr)_minmax(0,0.92fr)] xl:items-start">
            <SettingsRuntimeSummary
              browserSession={browserSession}
              settings={settings}
            />
            <div className="grid min-w-0 gap-3">
              <SettingsSupportControls />
            </div>
          </div>
        </section>

        <section
          aria-labelledby="settings-danger-zone-heading"
          // Scroll clearance for the sticky save bar below. Without it the
          // bar painted over the last card's live text at the bottom of the
          // scroll region, and no scroll position freed it.
          className="scroll-mt-(--settings-subnav-offset) mb-3 min-w-0 pb-(--settings-unsaved-bar-clearance)"
          id="settings-danger-zone"
          tabIndex={-1}
        >
          <h2 className="sr-only" id="settings-danger-zone-heading">
            Delete everything
          </h2>
          <SettingsWorkspaceControls
            isWorkspaceResetPending={isWorkspaceResetPending}
            onResetWorkspace={onResetWorkspace}
          />
        </section>
      </SettingsDirtySectionsProvider>

      <SettingsUnsavedChangesBar
        dirtySections={dirtySections}
        ref={unsavedBarRef}
      />
    </section>
  );
}
