import type { ApplyAuthority, ApplyFormObservation } from "./types";

/**
 * The checks that stand between a filled form and one irreversible click.
 *
 * None of this asks the model anything. Sending an application is decided from
 * the saved authority document and from what the page itself shows: every
 * required answer present, every file attached, nothing flagged as wrong, and
 * this really being the last screen. Anything less stops (ADR 0012).
 */

export type ApplySubmitPreflightResult =
  | { ok: true }
  | { ok: false; reason: string };

function unansweredRequiredLabels(observation: ApplyFormObservation): string[] {
  return observation.controls
    .filter(
      (control) =>
        control.required &&
        control.visible &&
        !control.disabled &&
        !control.answered &&
        control.kind !== "file",
    )
    .map((control) =>
      [control.groupLabel, control.label]
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .join(" — "),
    )
    .filter((label) => label.length > 0);
}

function hasUnattachedRequiredFile(observation: ApplyFormObservation): boolean {
  return observation.controls.some(
    (control) =>
      control.kind === "file" &&
      control.visible &&
      control.required &&
      !control.answered,
  );
}

function looksLikeTheLastScreen(observation: ApplyFormObservation): boolean {
  const { index, total } = observation.step;
  if (index !== null && total !== null) {
    return index >= total;
  }
  return !observation.actions.some(
    (action) => action.kind === "advance" && action.visible && !action.disabled,
  );
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function runSubmitPreflight(input: {
  observation: ApplyFormObservation;
  proposedActionRef: string;
  authority: ApplyAuthority;
}): ApplySubmitPreflightResult {
  const { observation, authority } = input;

  if (authority.mode === "prepare_only") {
    return {
      ok: false,
      reason:
        "This application is set to fill in only, so Job Finder stopped before sending it.",
    };
  }

  const pageOrigin = observation.origin;
  const allowedOrigins = authority.allowedOrigins
    .map(canonicalOrigin)
    .filter((value): value is string => value !== null);
  if (!pageOrigin || !allowedOrigins.includes(pageOrigin)) {
    return {
      ok: false,
      reason: pageOrigin
        ? `Job Finder is not authorized to send an application on ${pageOrigin}. The form is still available for review.`
        : "Job Finder could not verify which site would receive this application, so it stopped before sending.",
    };
  }

  const action = observation.actions.find(
    (candidate) => candidate.ref === input.proposedActionRef,
  );
  if (!action) {
    return { ok: false, reason: "That button is not on the page any more." };
  }
  if (action.kind !== "final") {
    return {
      ok: false,
      reason: `"${action.label}" does not send the application.`,
    };
  }
  if (!action.visible || action.disabled) {
    return { ok: false, reason: `"${action.label}" cannot be used right now.` };
  }

  if (observation.blocker) {
    return { ok: false, reason: observation.blocker.summary };
  }

  if (hasUnattachedRequiredFile(observation)) {
    return { ok: false, reason: "A file the form asks for is not attached yet." };
  }

  const missing = unansweredRequiredLabels(observation);
  if (missing.length > 0) {
    const first = missing.slice(0, 3).join(", ");
    return {
      ok: false,
      reason:
        missing.length > 3
          ? `${missing.length} required answers are still empty, starting with ${first}.`
          : `These required answers are still empty: ${first}.`,
    };
  }

  if (observation.validationErrors.length > 0) {
    return {
      ok: false,
      reason: `The page is still showing a problem: ${observation.validationErrors[0]}`,
    };
  }

  if (!looksLikeTheLastScreen(observation)) {
    return {
      ok: false,
      reason: "There is still another step after this one, so nothing was sent.",
    };
  }

  return { ok: true };
}
