/** User navigation is web-only. It must never reach Electron or local-file URLs. */
export function normalizeBrowserNavigation(value: string): string {
  const input = value.trim();
  if (input === "about:blank") return input;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input)
    ? input
    : `https://${input}`;
  const url = new URL(candidate);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Enter an http or https website address without embedded credentials.",
    );
  }
  return url.href;
}

export function isBrowserNavigationAllowed(value: string): boolean {
  try {
    normalizeBrowserNavigation(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opening a URL already held by the browser must reveal that tab without
 * reloading it. Application forms can contain prepared values and file
 * attachments that a reload or duplicate tab would lose.
 */
export function isSameBrowserNavigation(
  currentUrl: string,
  requestedUrl: string,
): boolean {
  try {
    return (
      normalizeBrowserNavigation(currentUrl) ===
      normalizeBrowserNavigation(requestedUrl)
    );
  } catch {
    return false;
  }
}

/** Query strings and fragments can contain OAuth codes. They never enter UI state. */
export function browserDisplayUrl(value: string): string {
  if (!value || value === "about:blank") return "about:blank";
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.origin}${url.pathname}`.slice(0, 4096);
  } catch {
    return "";
  }
}

/** Keep Chromium's actual platform/version; remove app packaging tokens only. */
export function browserUserAgent(value: string, appName: string): string {
  return value
    .split(/\s+/)
    .filter(
      (token) =>
        !token.startsWith("Electron/") &&
        !token
          .toLowerCase()
          .startsWith(`${appName.toLowerCase().replace(/\s/g, "")}/`),
    )
    .join(" ");
}
