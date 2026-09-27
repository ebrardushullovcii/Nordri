/**
 * Browser errors, in words a person can read.
 *
 * The raw text of a browser-automation error names an internal call and
 * nothing the person could act on. What they need, and what the model needs
 * as a fact to react to, is what happened on the page. Every agent in this
 * package and the runtime beneath it says it the same way.
 */

/** Whether an error means the page moved on underneath the step. */
export function isPageReplacedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /execution context was destroyed|navigating and changing the content|frame was detached|cannot find context with specified id|most likely because of a navigation/iu.test(
    message,
  );
}

export function describeBrowserError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (isPageReplacedError(error)) {
    return "The page moved to a new address while Job Finder was reading it.";
  }
  if (
    /target (?:page|context|browser)?\s*(?:has been )?closed|page has been closed|browser has been closed|has been closed/iu.test(
      message,
    )
  ) {
    return "The browser tab Job Finder was working in was closed.";
  }
  if (/timeout .* exceeded|timed out/iu.test(message)) {
    return "The page did not respond in time.";
  }
  if (
    /not visible|outside of the viewport|intercepts pointer events|element is not (?:attached|enabled|visible)/iu.test(
      message,
    )
  ) {
    return "That is on the page but cannot be pressed right now: something is covering it or it is off screen.";
  }
  if (/net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/iu.test(message)) {
    return "The site did not answer, so the page would not open.";
  }
  if (/strict mode violation|resolved to \d+ elements/iu.test(message)) {
    return "More than one thing on the page matched, so nothing was pressed.";
  }
  return `${fallback} (${message.split("\n")[0]?.slice(0, 200)})`;
}
