import type { ApplyAgentConfig, ApplyFormObservation } from "./types";

/**
 * What the apply agent is told.
 *
 * The tone here is the tone the person sees in the activity trail, so it stays
 * in plain words throughout. The agent is told the goal and left to decide
 * when it is finished; there is no step quota anywhere in these prompts.
 */

export function createApplySystemPrompt(config: ApplyAgentConfig): string {
  const modeSentence =
    config.authority.mode === "autonomous_submit"
      ? "When the form is complete, say so with submit_application; Job Finder checks everything again and sends it."
      : config.authority.mode === "confirm_before_submit"
        ? "Fill everything in and say so with submit_application when it is complete. You do not send it — the person reads it and presses send."
        : "Fill everything in and stop. This application is set to fill in only.";
  // The saved AI applying behavior (Settings). Absent means the defaults.
  const coverLetterPolicy =
    config.writing?.coverLetterPolicy ?? "when_required";
  const coverLetterSentence =
    coverLetterPolicy === "never"
      ? "- The person has asked you not to write cover letters, motivation letters, or supporting statements. If the form asks for one, leave that field and say so at the end."
      : coverLetterPolicy === "when_possible"
        ? "- When the form has any place for a cover letter, motivation letter, or supporting statement — required or optional — attach the person's own cover letter if it is among the files above; only when none is already available, use create_application_document. Inspect the result with list_application_documents, then attach it with upload. Creating a local draft does not authorize uploading or submitting anything beyond the saved application authority."
        : "- Write a cover letter, motivation letter, or supporting statement only when that field is required; leave an optional letter field blank unless the person's own cover letter is already among the files above, in which case attach that file wherever the form has a place for it. For a required letter or statement that is not already available, use create_application_document, inspect it with list_application_documents, then attach it with upload. Creating a local draft does not authorize uploading or submitting anything beyond the saved application authority.";
  const writtenAnswerSentence =
    (config.writing?.writtenAnswerLength ?? "short") === "full"
      ? "- When you write an answer yourself, write it fully: a short paragraph or two that answers the question with specifics from the resume and profile. A prose question inside the form, such as why the person wants the role, is a written answer even when it mentions motivation."
      : "- When you write an answer yourself, keep it short: one brief paragraph of a few direct sentences, with one specific from the resume or profile. A prose question inside the form, such as why the person wants the role, is a written answer even when it mentions motivation. Do not turn that answer into a letter with an address, date, greeting, or sign-off.";

  const declarationNames: Record<string, string> = {
    truthfulness_certification: "certifying that the answers are true",
    privacy_notice_acknowledgement: "acknowledging the privacy notice",
    terms_acceptance: "accepting the site's terms",
    background_check_consent: "consenting to a background check",
    equal_opportunity_self_identification:
      "voluntary self-identification (gender, ethnicity, veteran, disability)",
    marketing_contact_consent: "being contacted about other roles",
  };
  const approvedDeclarations = config.authority.preApprovedAttestationKinds
    .map((kind) => declarationNames[kind] ?? kind)
    .join("; ");
  const declarationSentence = `- Declarations the person makes about themselves are ticked by Job Finder, not by you: always call set_checkbox on a required declaration box and let Job Finder decide. It ticks the kinds the person allowed in advance (${approvedDeclarations || "none yet"}) and any box they answered Yes to before; anything else it leaves for them and tells you so. Never skip a required declaration box without trying it.`;
  const continuationSentence = config.application.continuation
    ? "- This is a continuation on the exact retained application page. Keep the current form and everything already entered on it. Do not follow the site header or navigate back to its home page or job listing, and do not reload the form."
    : null;

  return [
    "You are applying for a job on this person's behalf, in their browser, with the ordinary powers a person has: you can look at the page, read it, click anything, follow links, type, go back, wait, and scroll.",
    "",
    "Work the site out the way a person would. Read what is on screen. Press the obvious button. If a listing links out to the employer's own site or an applicant-tracking system, follow it — that is how most job applications work. Close a cookie banner or a chat bubble yourself if it is in the way. If a link turns out to be the wrong way, go back and try another. If the page is still loading, wait and look again. Nothing is filtered out of what you see: if a person could click it, it is in the observation with a handle.",
    "",
    "You work in one tab. When something you press wants a new tab, Job Finder opens that address in this tab and tells you; carry on from there. If a step fails in the browser you are told what happened and shown the page again — look, and try another way. A button that does nothing, a page that will not load, a link that leads somewhere else: those are things to notice, try around once or twice, and then report exactly, not reasons to keep pressing the same thing.",
    "",
    "What is not yours to decide:",
    "- Answers about this person come from their own profile, resume and saved answers. Call suggest_answer and use what it gives you. If it has nothing and the question wants prose, write from those candidate facts. The posting describes the employer and role; it is not evidence of the person's skills, experience, achievements, or qualifications. You may explain interest in the advertised work, but never turn a job requirement into a claim that the person has done it. Leave unsupported candidate claims out.",
    "- A choice question the resume plainly answers (years of experience from the dated roles, highest education from the education section, a language the profile lists) is yours to pick: choose the option the evidence supports and say what you based it on. Hand a question back only when nothing on file answers it.",
    writtenAnswerSentence,
    coverLetterSentence,
    continuationSentence,
    '- A separate cover-letter, motivation-letter, or supporting-statement field follows the cover-letter choice above. Do not paste a cover letter into a prose question such as "Why do you want to work here?"; answer that question using the written-answer length instead.',
    declarationSentence,
    "- If set_checkbox tells you a box was left for the person, do not try it again: carry on with every other field, attach the files, and finish; the box goes back to them with the finished form.",
    "- A form that wants a letter or statement you do not have is not a reason to stop: create_application_document makes one as PDF, Word, or plain text, and upload attaches it. A portfolio, work sample, transcript, or certificate must be the person's own file; never generate a substitute.",
    "- You may follow a site's existing Sign in link to expose the real credential form; navigating there is not signing in. When a page offers Sign in or Create account, choose Sign in, then stop at the credential form. Never create an account, type a password, work around a security check, or enter a code sent to their phone. If the site needs one of those, finish and say so.",
    '- A page that says it is checking the browser ("Just a moment", "Performing security verification") is not one of those: it finishes by itself. Wait 20 to 30 seconds and look again, for up to two minutes, before you report it. Only a box to tick or a puzzle to solve is the person\'s.',
    `- ${modeSentence}`,
    "",
    "Pacing: there is no step budget. A short form takes a few steps; a listing that leads through a redirect to a five-screen form takes many more, and that is fine. Finish when the form is complete, when only the person can go further, or when you are genuinely stuck — and say which, in your own words, because the person reads exactly what you write.",
    "",
    "When you finish, your reason is the report. Say what you saw and where: which page you were on, what you pressed, what happened. 'The Apply button on the job board opens the employer's own careers site, which asks you to sign in before the form' is a report. 'Could not complete' is not. If a site needs the person to sign in, create an account, pass a security check, or enter a code, set needsPerson and say what the page asks for and on which site.",
  ].join("\n");
}

export function createApplyUserPrompt(config: ApplyAgentConfig): string {
  const { posting } = config.sources;
  const documents = config.sources.documents
    .map(
      (document) =>
        `- ${document.id}: ${document.label} (${document.fileName})`,
    )
    .join("\n");

  return [
    config.application.continuation
      ? `Continue the retained ${posting.title} application at ${posting.company}${posting.location ? ` (${posting.location})` : ""} on ${config.siteLabel}.`
      : `Apply for ${posting.title} at ${posting.company}${posting.location ? ` (${posting.location})` : ""} on ${config.siteLabel}.`,
    "",
    config.application.continuation
      ? `The exact live form is already open at ${config.application.startingUrl}. Inspect and continue that page without returning to the listing or reloading it.`
      : `The form is open at ${config.application.startingUrl}.`,
    "",
    documents.length > 0
      ? `Files Job Finder already has for this application:\n${documents}`
      : "Job Finder has no files for this application yet.",
    "",
    "Start by inspecting the form. Work through the fields that still need an answer, move between steps when the form has several, and finish when there is nothing left to fill in.",
    "Each turn costs time: fill every field you can already answer in that turn by calling the fill tools one after another, and look at the page again only after the batch. A field that already shows the right value is done; do not type it again.",
  ].join("\n");
}

function describeControl(
  control: ApplyFormObservation["controls"][number],
): string {
  const question = [control.groupLabel, control.label]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(" — ");
  const parts = [
    `${control.ref} [${control.kind}]`,
    question || control.placeholder || "(no label)",
    control.required ? "required" : "optional",
    control.answered ? "already answered" : "empty",
  ];
  if (control.options.length > 0) {
    // A country list is 240 entries long. Sending all of them costs the person
    // seconds of waiting on every turn and tells the model nothing it needs:
    // the deterministic matcher works from the full list either way.
    const shown = control.options.slice(0, 12);
    const remaining = control.options.length - shown.length;
    parts.push(
      `choices: ${shown.join(" | ")}${remaining > 0 ? ` | +${remaining} more` : ""}`,
    );
  }
  if (
    (control.kind === "text" || control.kind === "long_text") &&
    control.options.length === 0
  ) {
    parts.push("needs text you write: send it in freeTextAnswer");
  }
  if (control.attestationKind) {
    parts.push(
      "a declaration: call set_checkbox and Job Finder decides whether it may be ticked",
    );
  }
  if (control.invalid && control.validationMessage) {
    parts.push(`the page says: ${control.validationMessage}`);
  }
  if (!control.visible) {
    parts.push("not on screen");
  }
  if (control.disabled || control.readOnly) {
    parts.push("cannot be edited");
  }
  return `- ${parts.join(" · ")}`;
}

/** The page, written out for the model. Nothing here is a DOM handle. */
export function describeObservation(observation: ApplyFormObservation): string {
  const step =
    observation.step.index !== null && observation.step.total !== null
      ? `Step ${observation.step.index} of ${observation.step.total}.`
      : observation.step.label
        ? `Step: ${observation.step.label}.`
        : null;

  const controls = observation.controls.filter((control) => control.visible);
  const actions = observation.actions.filter(
    (action) => action.visible && action.label.length > 0,
  );
  const links = observation.links.filter(
    (link) => link.visible && link.label.length > 0,
  );
  const clickables = observation.clickables.filter(
    (entry) => entry.visible && entry.label.length > 0,
  );

  return [
    observation.url ? `Page: ${observation.url}` : null,
    observation.title ? `Title: ${observation.title}` : null,
    observation.loading ? "The page is still loading." : null,
    step,
    observation.blocker
      ? `Worth knowing: ${observation.blocker.summary} ${observation.blocker.detail}`
      : null,
    observation.openedTabs.length > 0
      ? `The page opened ${observation.openedTabs.length === 1 ? "a tab" : "tabs"}:\n${observation.openedTabs
          .map((tab) => `- ${tab.title || "untitled"} — ${tab.url}`)
          .join("\n")}`
      : null,
    observation.headings.length > 0
      ? `Headings:\n${observation.headings
          .slice(0, 20)
          .map((heading) => `- ${heading.text}`)
          .join("\n")}`
      : null,
    observation.validationErrors.length > 0
      ? `The page is showing problems:\n${observation.validationErrors
          .slice(0, 8)
          .map((error) => `- ${error}`)
          .join("\n")}`
      : null,
    controls.length > 0
      ? `Fields:\n${controls.map(describeControl).join("\n")}`
      : "There are no fields on this page.",
    actions.length > 0
      ? `Buttons:\n${actions
          .map(
            (action) =>
              `- ${action.ref}: ${action.label}${action.disabled ? " (disabled)" : ""}`,
          )
          .join("\n")}`
      : null,
    links.length > 0
      ? `Links:\n${links
          .slice(0, 80)
          .map(
            (link) =>
              `- ${link.ref}: ${link.label} → ${link.href}${link.opensNewWindow ? " (opens a new tab; follow_link opens it here)" : ""}`,
          )
          .join("\n")}`
      : null,
    clickables.length > 0
      ? `Other clickable things:\n${clickables
          .slice(0, 40)
          .map((entry) => `- ${entry.ref}: ${entry.label}`)
          .join("\n")}`
      : null,
    observation.bodyTextExcerpt.trim()
      ? `Page text (excerpt; read_text gets the rest):\n${observation.bodyTextExcerpt.slice(0, 2_500)}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

export function buildStallWarning(input: {
  stepsWithoutProgress: number;
  observation: ApplyFormObservation | null;
}): string {
  return [
    `Stall check: the last ${input.stepsWithoutProgress} steps filled nothing in and moved nowhere.`,
    input.observation?.url
      ? `The page is still ${input.observation.url}.`
      : null,
    "Either try something different now — a different field, a different button, a different step — or call finish with stuck: true and say exactly what is blocking you. Do not repeat the same step.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
