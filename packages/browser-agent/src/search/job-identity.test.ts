import { describe, expect, test } from "vitest";

import {
  buildGenericJobId,
  normalizeExtractedJobSourceId,
  sanitizeUrl,
} from "./job-identity";

describe("job identity", () => {
  test("uses a short semantic detail-route id as the generic posting id", () => {
    expect(buildGenericJobId("https://careers.example.test/jobs/4")).toBe("4");
    expect(
      buildGenericJobId("https://careers.example.test/openings/design-lead"),
    ).toBe("design-lead");
  });

  test("normalizes only a legacy URL-derived id on a semantic detail route", () => {
    const legacy = {
      sourceJobId: "careers_example_test_jobs_4",
      canonicalUrl: "https://careers.example.test/jobs/4",
    };
    expect(normalizeExtractedJobSourceId(legacy).sourceJobId).toBe("4");
    expect(
      normalizeExtractedJobSourceId({
        ...legacy,
        sourceJobId: "provider-requisition-004",
      }).sourceJobId,
    ).toBe("provider-requisition-004");
  });

  test("drops the query and fragment from a page address", () => {
    expect(sanitizeUrl("https://jobs.example.test/a?q=1#top")).toBe(
      "https://jobs.example.test/a",
    );
    expect(sanitizeUrl(null)).toBeNull();
  });
});
