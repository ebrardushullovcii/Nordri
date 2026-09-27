import { describe, expect, it } from "vitest";
import {
  searchJobFinderEntries,
  type JobFinderGlobalSearchEntry,
} from "./job-finder-global-search";

const entries: readonly JobFinderGlobalSearchEntry[] = [
  {
    campaignId: "campaign-a",
    href: "/job-finder/discovery?job=one",
    id: "one",
    kind: "job",
    metadata: ["TypeScript", "remote"],
    subtitle: "Acme · Remote",
    title: "Platform Engineer",
  },
  {
    campaignId: "campaign-b",
    href: "/job-finder/applications?application=two",
    id: "two",
    kind: "application",
    metadata: ["applied"],
    subtitle: "Example · Applied",
    title: "Frontend Engineer",
  },
];

describe("searchJobFinderEntries", () => {
  it("searches metadata and groups results", () => {
    expect(searchJobFinderEntries(entries, "typescript")).toEqual([
      { entries: [entries[0]], kind: "job" },
    ]);
  });

  it("can stay inside the active campaign", () => {
    expect(
      searchJobFinderEntries(entries, "engineer", { campaignId: "campaign-b" }),
    ).toEqual([{ entries: [entries[1]], kind: "application" }]);
  });

  it("keeps the first match when the result limit is one", () => {
    expect(searchJobFinderEntries(entries, "engineer", { limit: 1 })).toEqual([
      { entries: [entries[0]], kind: "job" },
    ]);
  });

  it("keeps application and resume results reachable when many jobs match", () => {
    const manyJobs = Array.from({ length: 50 }, (_, index) => ({
      ...entries[0]!,
      id: `job-${index}`,
    }));
    const application = { ...entries[1]!, title: "Platform application" };
    const resume: JobFinderGlobalSearchEntry = {
      href: "/job-finder/review-queue",
      id: "resume",
      kind: "document",
      metadata: [],
      subtitle: "Platform resume",
      title: "Platform resume",
    };

    const groups = searchJobFinderEntries(
      [...manyJobs, application, resume],
      "platform",
      { limit: 5 },
    );

    expect(groups.flatMap((group) => group.entries)).toHaveLength(5);
    expect(groups.map((group) => group.kind)).toEqual([
      "job",
      "application",
      "document",
    ]);
  });
});
