import { describe, expect, test, vi } from "vitest";
import type { ListingHtmlFetcher } from "./index";
import { htmlToPlainText } from "./internal/listing-detail-extraction";
import { createSeed } from "./workspace-service.test-fixtures";
import { createWorkspaceServiceHarness } from "./workspace-service.test-harness";
import { createAiClient } from "./workspace-service.test-runtimes";

const DESCRIPTION_HTML =
  "<p>We build the design system and the workflow platform every product team ships on, and this role owns both end to end.</p><h3>What you will do</h3><ul><li>Lead the design system roadmap across web and native surfaces.</li><li>Partner with product designers and engineers on component quality.</li><li>Run design reviews and mentor senior designers.</li></ul><h3>Requirements</h3><ul><li>Six or more years of product design with a shipped design system.</li><li>Deep Figma expertise and hands-on prototyping.</li><li>Experience with workflow or B2B platforms.</li></ul>";

function createDetailReadingAiClient() {
  const jobs = createSeed().savedJobs;
  const postings = [
    ...jobs,
    {
      ...jobs[1]!,
      canonicalUrl: "https://www.linkedin.com/jobs/view/linkedin_pause_case",
    },
  ];
  const aiClient = createAiClient();
  // Configured readers now read every page, including its published record.
  // Supply the model's result instead of relying on a structured-data bypass.
  const extractJobsFromPage = vi.fn<typeof aiClient.extractJobsFromPage>(
    (input) => {
      expect(input.pageType).toBe("job_detail");
      expect(input.maxJobs).toBe(1);
      expect(input.pageText).toContain("Published JobPosting record");
      expect(input.pageText).toContain("Six or more years of product design");
      const posting = postings.find(
        (job) => job.canonicalUrl === input.pageUrl,
      );
      if (!posting) throw new Error(`Unexpected listing: ${input.pageUrl}`);
      return Promise.resolve([
        {
          ...posting,
          company: "Signal Systems",
          location: "Austin, TX, US",
          description: htmlToPlainText(DESCRIPTION_HTML),
          salaryText: "USD 150,000 – 190,000 / year",
          applicationUrl: null,
        },
      ]);
    },
  );
  return {
    aiClient: { ...aiClient, extractJobsFromPage },
    extractJobsFromPage,
  };
}

const RECORD_PAGE = (title: string | null, company: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title,
    datePosted: "2026-03-19",
    employmentType: "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: company },
    jobLocation: {
      "@type": "Place",
      address: {
        addressLocality: "Austin",
        addressRegion: "TX",
        addressCountry: "US",
      },
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { minValue: 150000, maxValue: 190000, unitText: "YEAR" },
    },
    description: DESCRIPTION_HTML,
  })}</script></head><body></body></html>`;

describe("listing detail enrichment inside a discovery run", () => {
  test("reads each retained card's page, upgrades it to full detail, re-scores it, and logs the stage", async () => {
    const fetched: string[] = [];
    const fetchListingHtml: ListingHtmlFetcher = (url) => {
      fetched.push(url);
      return Promise.resolve({
        status: 200,
        html: RECORD_PAGE(null, "Signal Systems"),
        finalUrl: url,
      });
    };
    const { aiClient, extractJobsFromPage } = createDetailReadingAiClient();
    const { repository, workspaceService } = createWorkspaceServiceHarness({
      fetchListingHtml,
      aiClient,
    });
    const before = await repository.listSavedJobs();
    const cardOnlyBefore = before.filter(
      (job) => job.detailQuality !== "detail_enriched",
    );
    expect(cardOnlyBefore.length).toBeGreaterThan(0);

    await workspaceService.runDiscovery();

    const after = await repository.listSavedJobs();
    const read = after.filter((job) => job.listingDetailFetch !== null);
    expect(fetched.length).toBeGreaterThan(0);
    expect(read.length).toBe(fetched.length);
    expect(extractJobsFromPage).toHaveBeenCalledTimes(fetched.length);
    for (const job of read) {
      expect(job.listingDetailFetch).toMatchObject({
        outcome: "enriched",
        method: "page_text",
      });
      expect(job.detailQuality).toBe("detail_enriched");
      expect(job.description).toContain("Six or more years of product design");
      // The full page can correct the card's pay, employer and place.
      expect(job.salaryText).toBe("USD 150,000 – 190,000 / year");
      expect(job.company).toBe("Signal Systems");
      expect(job.location).toBe("Austin, TX, US");
      // A fresh score against the body, not the card.
      expect(job.matchAssessment.postingFingerprint).toBeTruthy();
    }

    const discoveryState = await repository.getDiscoveryState();
    const run = discoveryState.recentRuns.at(-1);
    expect(run?.summary.outcome).toBe("completed");
    const messages = (run?.activity ?? []).map((event) => event.message);
    expect(
      messages.some((message) =>
        /^Reading listing details for \d+ jobs?$/u.test(message),
      ),
    ).toBe(true);
    expect(
      messages.some((message) =>
        /^Read \d+ of \d+ listing pages?/u.test(message),
      ),
    ).toBe(true);
  }, 30_000);

  test("without a configured reader the run never fetches and jobs stay honest cards", async () => {
    const { repository, workspaceService } = createWorkspaceServiceHarness();

    await workspaceService.runDiscovery();

    const after = await repository.listSavedJobs();
    expect(after.every((job) => job.listingDetailFetch === null)).toBe(true);
    const run = (await repository.getDiscoveryState()).recentRuns.at(-1);
    expect(
      (run?.activity ?? []).some((event) =>
        /listing details/iu.test(event.message),
      ),
    ).toBe(false);
  }, 30_000);

  test("a page that will not read leaves the card scored as a title match with the attempt recorded", async () => {
    const fetchListingHtml: ListingHtmlFetcher = (url) =>
      Promise.resolve({
        status: 403,
        html: "",
        finalUrl: url,
      });
    const { repository, workspaceService } = createWorkspaceServiceHarness({
      fetchListingHtml,
    });

    await workspaceService.runDiscovery();

    const after = await repository.listSavedJobs();
    const attempted = after.filter((job) => job.listingDetailFetch !== null);
    expect(attempted.length).toBeGreaterThan(0);
    for (const job of attempted) {
      expect(job.listingDetailFetch?.outcome).toBe("blocked");
      expect(job.detailQuality).not.toBe("detail_enriched");
    }
    const run = (await repository.getDiscoveryState()).recentRuns.at(-1);
    expect(run?.summary.outcome).toBe("completed");
    expect(
      (run?.activity ?? []).some((event) =>
        /blocked or rate-limited/u.test(event.message),
      ),
    ).toBe(true);
  }, 30_000);

  test("a rate-limited listing is read on shortlist once the site's wait has passed", async () => {
    let limited = true;
    const fetchListingHtml: ListingHtmlFetcher = (url) =>
      Promise.resolve(
        limited
          ? { status: 429, html: "", finalUrl: url, retryAfterMs: 0 }
          : {
              status: 200,
              html: RECORD_PAGE(null, "Signal Systems"),
              finalUrl: url,
            },
      );
    const { aiClient, extractJobsFromPage } = createDetailReadingAiClient();
    const { repository, workspaceService } = createWorkspaceServiceHarness({
      fetchListingHtml,
      aiClient,
    });

    await workspaceService.runDiscovery();
    const blocked = (await repository.listSavedJobs()).find(
      (job) => job.listingDetailFetch?.outcome === "blocked",
    );
    expect(blocked?.listingDetailFetch?.retryAfterAt).toBeTruthy();
    expect(extractJobsFromPage).not.toHaveBeenCalled();

    limited = false;
    await workspaceService.queueJobForReview(blocked!.id);

    const read = (await repository.listSavedJobs()).find(
      (job) => job.id === blocked!.id,
    );
    expect(read?.listingDetailFetch?.outcome).toBe("enriched");
    expect(read?.listingDetailCapture?.state).toBe("captured");
    expect(extractJobsFromPage).toHaveBeenCalledTimes(1);
  }, 30_000);
});
