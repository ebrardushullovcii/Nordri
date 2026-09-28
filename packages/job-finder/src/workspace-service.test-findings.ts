import type { AgentDebugFindings, SourceDebugPhase } from "@nordri/contracts";

import type { AgentDebugFindingsInput } from "./workspace-service.test-runtimes";
import type { SourceDebugPhaseMap } from "./workspace-service.test-fixtures";

const sourceDebugPhaseOrder: SourceDebugPhase[] = [
  "access_auth_probe",
  "site_structure_mapping",
  "search_filter_probe",
  "job_detail_validation",
  "apply_path_validation",
  "replay_verification",
];

function withEmptyVisualFindings(
  findingsByPhase: SourceDebugPhaseMap<AgentDebugFindingsInput | null>,
): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return Object.fromEntries(
    sourceDebugPhaseOrder.flatMap((phase) => {
      const findings = findingsByPhase[phase];
      return findings
        ? [
            [
              phase,
              {
                visualFindings: [],
                visualObservationSets: [],
                ...findings,
              },
            ],
          ]
        : [];
    }),
  ) as SourceDebugPhaseMap<AgentDebugFindings | null>;
}

export function createStrongSourceDebugFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    access_auth_probe: {
      summary:
        "Public job browsing is available without login or consent blockers.",
      reliableControls: [
        "The homepage and jobs navigation are accessible without authentication.",
      ],
      trickyFilters: [],
      navigationTips: [
        "Confirm public access first, then move to the dedicated jobs/listings route for repeatable discovery.",
      ],
      applyTips: [],
      warnings: [],
    },
    site_structure_mapping: {
      summary:
        "Use the dedicated jobs/listings route or reusable recommendation lists instead of staying on the homepage.",
      reliableControls: [
        "The jobs navigation link opens a dedicated listings page.",
        "Recommendation rows expose show-all links that open reusable prefiltered job lists.",
      ],
      trickyFilters: [],
      navigationTips: [
        "Start future discovery from the dedicated jobs/listings route rather than the homepage.",
        "If a recommendation row looks relevant, its show-all route is a valid entry path for a prefiltered result set.",
      ],
      applyTips: [],
      warnings: [],
    },
    search_filter_probe: {
      summary:
        "Keyword search plus the visible location and industry filters change the result set reliably.",
      reliableControls: [
        "Use the keyword search box on the listings route to refresh the visible job set.",
        "Use the visible location filter to narrow the listings by city or region.",
        "Use the visible industry filter to narrow the listings by sector.",
        "Recommendation show-all routes can open large reusable result sets with site-preselected filters already applied.",
      ],
      trickyFilters: [
        "Homepage promo chips that do not open a full result list should be ignored.",
      ],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
    job_detail_validation: {
      summary:
        "Open the same-host detail page from the listing card to recover canonical job data.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Open the listing card detail page instead of relying on inline card previews.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary:
        "Sampled job details did not expose a reliable on-site apply entry.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [
        "Treat applications as manual unless a detail page clearly exposes a stable apply entry.",
      ],
      warnings: [],
    },
    replay_verification: {
      summary:
        "Replay from the listings route reproduced the searchable and filterable job flow.",
      reliableControls: [
        "The listings route, keyword search, and visible filters remained stable on replay.",
      ],
      trickyFilters: [],
      navigationTips: [
        "Reuse the listings route, recommendation show-all paths, and keyword search path during normal discovery.",
      ],
      applyTips: [],
      warnings: [],
    },
  });
}

export function createThinSourceDebugFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    job_detail_validation: {
      summary:
        "Job details resolve to same-host detail pages instead of only inline cards.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Different listings resolve to distinct canonical detail URLs.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary:
        "Sampled job details did not expose a reliable apply entry on the site.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: ["Treat applications as manual for now."],
      warnings: [],
    },
    replay_verification: {
      summary: "Replay verification reached the same listings again.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
  });
}

export function createUnprovenVisibleControlFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    site_structure_mapping: {
      summary: "Jobs are listed directly on the homepage.",
      reliableControls: ["Use the homepage as the initial jobs surface."],
      trickyFilters: [],
      navigationTips: [
        "Jobs appear directly on the homepage without a separate jobs route.",
      ],
      applyTips: [],
      warnings: [],
    },
    search_filter_probe: {
      summary:
        "The homepage shows visible search and filter controls, but they were not proven reusable in this pass.",
      reliableControls: [],
      trickyFilters: [
        "Search box exists but functionality was not confirmed in this probe.",
        "Visible city and industry filters were present but not tested to completion.",
      ],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
    job_detail_validation: {
      summary:
        "Job details resolve to same-host detail pages instead of only inline cards.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Different listings resolve to distinct canonical detail URLs.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary:
        "Sampled job details did not expose a reliable apply entry on the site.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: ["Treat applications as manual for now."],
      warnings: [],
    },
    replay_verification: {
      summary: "Replay verification reached the same listings again.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
  });
}

export function createUrlShortcutOnlyFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    site_structure_mapping: {
      summary:
        "Direct URL navigation to /jobs/search with geoId reaches a results page.",
      reliableControls: [
        "Jobs landing URL: https://www.linkedin.com/jobs/search/?location=Prishtina%2C%20Kosovo&geoId=103175575",
      ],
      trickyFilters: [],
      navigationTips: [
        "Jobs URL pattern: /jobs/search/?location={location}&geoId={geoId}",
      ],
      applyTips: [],
      warnings: [],
    },
    search_filter_probe: {
      summary:
        "Direct URL navigation with geoId loads results and a filter button, but no visible control was proven beyond the shortcut URL.",
      reliableControls: [
        "Direct URL navigation to /jobs/search with geoId works.",
        "Filter button present at index 0 opens full filter options.",
      ],
      trickyFilters: [
        "CurrentJobId appears in the URL after opening a listing.",
      ],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
    job_detail_validation: {
      summary:
        "Job details resolve to same-host detail pages instead of only inline cards.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Different listings resolve to distinct canonical detail URLs.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary:
        "Sampled job details did not expose a reliable apply entry on the site.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: ["Treat applications as manual for now."],
      warnings: [],
    },
    replay_verification: {
      summary:
        "Replay verification reached the same listings again through the URL shortcut.",
      reliableControls: [
        "Replay repeated the same /jobs/search/?location={location}&geoId={geoId} route.",
      ],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
  });
}

export function createMixedAuthSurfaceFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    access_auth_probe: {
      summary:
        "The /jobs page showed a login form before authenticated browsing was available.",
      reliableControls: [
        "Login form is the only visible surface - no public job listings accessible",
        "Authentication required - cannot access job listings without target site account",
      ],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
    site_structure_mapping: {
      summary:
        "Authenticated browsing later exposed reusable recommendation and collection routes.",
      reliableControls: [
        "Show all top job picks for you opens a reusable recommended collection.",
      ],
      trickyFilters: [],
      navigationTips: [
        "Start from /jobs/ and open a reusable show-all or collection route when recommendation modules are visible.",
      ],
      applyTips: [],
      warnings: [],
    },
    search_filter_probe: {
      summary:
        "Authenticated results exposed a search box and visible filters.",
      reliableControls: [
        "Search box is visible on the results surface.",
        "Remote and on-site filters are visible on the results surface.",
      ],
      trickyFilters: [],
      navigationTips: [
        "The fuller search surface lives under the main jobs search route.",
      ],
      applyTips: [],
      warnings: [],
    },
    job_detail_validation: {
      summary: "Job detail pages use stable /jobs/view/{jobId} URLs.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Use same-host detail pages as the canonical source of job data.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary: "Easy Apply is visible on some authenticated listings.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [
        "Use the on-site apply entry when the detail page exposes it.",
      ],
      warnings: [],
    },
    replay_verification: {
      summary:
        "Replay reached the same authenticated collection and results surfaces again.",
      reliableControls: [
        "The collection route and visible filters were stable on replay.",
      ],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
  });
}

export function createNoisySourceDebugFindingsByPhase(): SourceDebugPhaseMap<AgentDebugFindings | null> {
  return withEmptyVisualFindings({
    site_structure_mapping: {
      summary: 'Clicked link "Show all top job picks for you"',
      reliableControls: [
        "Show all top job picks for you: opens reusable recommended jobs collection",
        'Clicked link "Show all top job picks for you"',
        "Some direct URL patterns may return 404 - use the main /jobs/ landing page instead",
      ],
      trickyFilters: [],
      navigationTips: [
        "Show all top job picks for you: opens reusable /collections/recommended/ path",
        "Job cards are clickable for detail view",
      ],
      applyTips: [],
      warnings: [],
    },
    search_filter_probe: {
      summary:
        'Clicked button "Show all filters. Clicking this button displays all available filter options."',
      reliableControls: [
        'link "Senior Frontend Engineer (Verified job) Fresha • Pristina (On-site) Dismiss Senior Frontend Engineer job 1 connection works here Viewed · Promoted"',
        'button "Show all filters. Clicking this button displays all available filter options."',
      ],
      trickyFilters: [
        "click failed: locator.click: Timeout 10000ms exceeded. Call log: waiting for getByRole(...)",
        "Location filter links visible: Prishtinë, Gjithë Kosovën, Jashtë Vendit",
      ],
      navigationTips: [],
      applyTips: [],
      warnings: [],
    },
    job_detail_validation: {
      summary:
        "Open the same-host detail page from the listing card to recover canonical job data.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [
        "Open the listing card detail page instead of relying on inline card previews.",
      ],
      applyTips: [],
      warnings: [],
    },
    apply_path_validation: {
      summary:
        "Primary target exposes a stable apply path via Easy Apply buttons on job cards.",
      reliableControls: [],
      trickyFilters: [],
      navigationTips: [],
      applyTips: [
        "Job listings show Easy Apply button on cards - this is the primary apply entry point",
        "Treat applications as manual until a reliable on-site apply entry is proven - the Easy Apply button is the proven on-site entry",
        "Use the on-site apply entry when the detail page exposes it.",
      ],
      warnings: [],
    },
    replay_verification: {
      summary:
        "Replay from the listings route reproduced the searchable and filterable job flow.",
      reliableControls: [
        "The listings route, keyword search, and visible filters remained stable on replay.",
      ],
      trickyFilters: [],
      navigationTips: [
        "Reuse the listings route and show-all collection path during normal discovery.",
      ],
      applyTips: [],
      warnings: [],
    },
  });
}
