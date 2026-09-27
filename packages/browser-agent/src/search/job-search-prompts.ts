import type { AgentConfig } from "../types";

/**
 * What the search agent and the source-check agent are told.
 *
 * Plain words, the goal, what the person prefers, what past runs learned
 * about this site, and how to report. No step quota, no list of what to
 * try in what order: the model has the page and decides.
 */

function listOrNone(
  values: readonly string[] | undefined,
  none: string,
): string {
  return values && values.length > 0 ? values.join(", ") : none;
}

export function createJobSearchPrompts(config: AgentConfig): {
  system: string;
  user: string;
} {
  const { searchPreferences, promptContext } = config;
  const packet = promptContext.taskPacket;
  const learned = [
    ...(promptContext.siteInstructions ?? []),
    ...(promptContext.toolUsageNotes ?? []),
  ];

  const goal = packet
    ? `Check ${promptContext.siteLabel} for a future search run. The goal of this check: ${packet.phaseGoal}`
    : config.retainAllFound
      ? `Find current job postings on ${promptContext.siteLabel} that fit this person, and save all suitable results you find. There is no default numeric result cap; honor any limit in the person's request.`
      : `Find up to ${config.targetJobCount} current job postings on ${promptContext.siteLabel} that fit this person, and save them.`;
  // The saved AI search behavior (Settings) decides how picky the run is; a
  // run-scoped mode is the fallback for callers that still pass only that.
  const selectivity =
    promptContext.searchGuidance?.selectivity ??
    (promptContext.searchMode === "scale" ? "wide_net" : "best_matches");
  const searchFocus =
    selectivity === "wide_net"
      ? "Search focus: find a broad pool of plausible jobs. Explore widely and save borderline possibilities when they could reasonably fit; later review will narrow them."
      : selectivity === "balanced"
        ? "Search focus: save close matches, and also adjacent roles the person could plausibly do well with their experience. Skip postings that are clearly a different job or level."
        : "Search focus: save only strong fits. Prefer close matches to the requested roles, locations, work modes, skills, and experience over filling the list.";
  const remoteHandling =
    promptContext.searchGuidance === undefined
      ? null
      : promptContext.searchGuidance.remoteCountsAsAnyLocation
        ? "Remote roles: a posting that is remote for the person's country or region counts as matching their locations, even when the office is somewhere else."
        : "Remote roles: do not count a remote posting as a location match on its own; the role must fit the listed locations and work modes.";
  const searchIntent = promptContext.searchRequest?.intent.trim() ?? "";
  const freshnessInstruction =
    promptContext.searchRequest?.freshness === "recent"
      ? "Freshness: prefer postings marked as recent. Do not guess dates, and do not discard an otherwise suitable posting when the site gives no trustworthy date."
      : null;
  const experienceLines = config.userProfile.experiences
    .filter((experience) => !experience.isDraft)
    .map((experience) =>
      [
        experience.title,
        experience.companyName ? `at ${experience.companyName}` : null,
        [
          experience.startDate,
          experience.isCurrent ? "present" : experience.endDate,
        ]
          .filter(Boolean)
          .join(" to ") || null,
        experience.summary,
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean);
  const educationLines = config.userProfile.education
    .filter((education) => !education.isDraft)
    .map((education) =>
      [education.degree, education.fieldOfStudy, education.schoolName]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean);
  const boundedResumeText = config.userProfile.baseResume.textContent
    ?.trim()
    .slice(0, 6_000);

  const system = [
    `You are working in this person's browser on ${promptContext.siteLabel}, with the ordinary powers a person has: look at the page, read it, go to addresses, follow links, press anything, type, choose, scroll, wait, go back.`,
    "",
    goal,
    packet ? null : searchFocus,
    packet ? null : remoteHandling,
    !packet && searchIntent
      ? `The person asked for: ${JSON.stringify(searchIntent)}. Interpret this request with their full profile in mind. ${selectivity === "best_matches" ? "Best matches only keeps the saved target roles, locations, and work modes as hard filters. This request may narrow them but cannot override them. If no job can satisfy both the request and those filters, save no jobs: do not fall back to the saved role when the person asked for a different role instead. Explain the conflict in your finish reason and tell the person which saved preference needs changing." : "It may narrow or redirect the saved target roles and defaults below."}`
      : null,
    packet ? null : freshnessInstruction,
    "",
    "About the person:",
    config.userProfile.headline
      ? `- Headline: ${config.userProfile.headline}`
      : null,
    config.userProfile.summary
      ? `- Summary: ${config.userProfile.summary}`
      : null,
    `- Roles they want: ${listOrNone(searchPreferences.targetRoles, "not specified")}`,
    `- Locations: ${listOrNone(searchPreferences.locations, "no constraint; do not add their current location as one")}`,
    `- Work modes: ${listOrNone(searchPreferences.workModes, "not specified")}`,
    config.userProfile.yearsExperience != null
      ? `- Experience: ${config.userProfile.yearsExperience} years`
      : null,
    config.userProfile.skills?.length
      ? `- Skills: ${config.userProfile.skills.join(", ")}`
      : null,
    experienceLines.length > 0
      ? `- Experience:\n${experienceLines.map((line) => `  - ${line}`).join("\n")}`
      : null,
    educationLines.length > 0
      ? `- Education:\n${educationLines.map((line) => `  - ${line}`).join("\n")}`
      : null,
    boundedResumeText ? `- Resume text (bounded):\n${boundedResumeText}` : null,
    "",
    "How to work:",
    "- Work the site out the way a person would. Use its search and filters when they help; scroll or page through results; open a posting only when the card is not enough.",
    "- Save what you find with scan_cards (fast, on results pages) or extract_jobs (reads any page). Each tells you what was new and what you already had; saved_jobs lists everything so far. Never reopen a posting you already saved.",
    "- When the site exposes a task-relevant JSON or text endpoint and the visible page is incomplete, read_page_api can retrieve it with this browser session. It is GET-only. Use an endpoint the page reveals; do not guess unrelated APIs.",
    "- Jobs can be in any language; a non-English posting that fits is a fit.",
    "- Close a cookie banner or chat bubble yourself. If a page is still loading, wait and look again. If a link is the wrong way, go back.",
    `- This run lives on ${promptContext.siteLabel}. You may leave it when the way to a posting or its details is on another site (an employer's own page, an applicant-tracking system, a careers hub it points at): pass a reason with navigate, follow_link, or click that says exactly what you saw and what you expect to find there. A separate review reads that reason against the goal and allows or refuses the move; a refused move tells you why. Do not leave for anything else.`,
    "- Never sign in, create an account, type a password, or work around a security check or a code sent to the person. If the site needs one of those, finish with needsPerson and say what it asks for.",
    "- When a step fails in the browser you are told what happened in plain words and shown the page again. Look, and try another way. If it keeps failing, report exactly what blocked you.",
    "",
    "Pacing: there is no step quota and Job Finder does not stop you for pacing. A thin site is done in a few steps; a deep one takes many, and that is fine. Finish when you have what was asked for, when the site has no more relevant results, when only the person can go further, or when you are genuinely stuck.",
    "",
    "Your finish reason is what the person reads. Use ordinary language and source names; leave out tool names and internal identifiers. Explain matches and exclusions without claiming saved or new result counts: the app calculates those after duplicate checks. Say which pages you were on, what you tried, what the site did, and what they would have to do themselves. 'The listings load, but every posting opens a sign-in page before the details' is a report; 'could not complete' is not.",
    learned.length > 0
      ? `\nWhat earlier runs learned about this site (check it against the live page before relying on it):\n${learned.map((line) => `- ${line}`).join("\n")}`
      : null,
    packet
      ? [
          "",
          "This is a source check, not a job search. Sample postings only where they help prove how the site works.",
          packet.knownFacts.length > 0
            ? `Earlier observations, unverified:\n${packet.knownFacts.map((fact) => `- ${fact}`).join("\n")}`
            : null,
          packet.successCriteria.length > 0
            ? `What would prove the goal:\n${packet.successCriteria.map((entry) => `- ${entry}`).join("\n")}`
            : null,
          packet.stopConditions.length > 0
            ? `When to stop:\n${packet.stopConditions.map((entry) => `- ${entry}`).join("\n")}`
            : null,
          packet.avoidStrategyFingerprints.length > 0
            ? `Approaches already tried without new evidence:\n${packet.avoidStrategyFingerprints.map((entry) => `- ${entry}`).join("\n")}`
            : null,
          "When you finish, fill the structured fields with what you proved on the live page: controls that changed results, filters that mislead, the best route to the jobs, how apply works here, and warnings. Write them as instructions for a future run, not as a story of this one. Leave a field empty rather than guess.",
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const user = [
    packet
      ? `Check ${promptContext.siteLabel}. Start here:`
      : `Find jobs on ${promptContext.siteLabel}. Start here:`,
    ...config.startingUrls.map((url) => `- ${url}`),
    "",
    "Begin by looking at the page.",
  ].join("\n");

  return { system, user };
}
