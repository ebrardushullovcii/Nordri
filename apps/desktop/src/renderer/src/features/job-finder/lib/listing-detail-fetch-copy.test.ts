import { describe, expect, it } from "vitest";

import { describeMissingListingText } from "./listing-detail-fetch-copy";

describe("describeMissingListingText", () => {
  it("says a rate limit is the site asking to slow down, not a sign-in", () => {
    const text = describeMissingListingText({
      attemptedAt: "2026-09-12T10:00:00.000Z",
      outcome: "blocked",
      method: null,
      detail: "The site asked Job Finder to slow down (HTTP 429).",
      retryAfterAt: "2026-09-12T10:00:02.000Z",
    });
    expect(text).toContain("asked Job Finder to slow down");
    expect(text).not.toContain("signed-in");
  });

  it("explains a refused read without assuming sign-in will fix it", () => {
    const text = describeMissingListingText({
      attemptedAt: "2026-09-12T10:00:00.000Z",
      outcome: "blocked",
      method: null,
      detail:
        "The page answered 403; it may require access or a signed-in visitor.",
    });
    expect(text).toContain("did not let Job Finder read the listing");
    expect(text).not.toContain("signed-in visitor");
    expect(text).toContain("Use Open listing below");
    expect(text).not.toContain("open it in your browser");
  });

  it("explains sparse content using the read result even when capture is blocked", () => {
    const text = describeMissingListingText(
      {
        attemptedAt: "2026-09-12T10:00:00.000Z",
        outcome: "no_detail",
        method: null,
        detail: "The page published too little readable text.",
      },
      { state: "blocked", textHash: null },
    );
    expect(text).toContain("too little readable job detail");
    expect(text).not.toContain("did not let");
    expect(text).not.toContain("no job description");
  });
});
