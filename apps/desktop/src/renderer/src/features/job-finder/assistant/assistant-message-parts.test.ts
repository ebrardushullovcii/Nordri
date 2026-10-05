import { describe, expect, it } from "vitest";

import { describeChangedFields } from "./assistant-message-parts";

describe("the one-line summary on an assistant change card", () => {
  it("names an added or removed record instead of calling it changed", () => {
    expect(
      describeChangedFields(["Added Education: Example College of Art"]),
    ).toBe("Added Education: Example College of Art");
    expect(
      describeChangedFields([
        "Headline",
        "Location",
        "Removed Experience: Example Co",
      ]),
    ).toBe("Changed Headline, Location · Removed Experience: Example Co");
  });

  it("keeps edited values under Changed and counts the rest", () => {
    expect(
      describeChangedFields(["A", "B", "C", "D", "E", "F", "G", "H"]),
    ).toBe("Changed A, B, C, D, E, F and 2 more");
  });
});

describe("R3-217 repeated bulk job lists", () => {
  it("shows the same 30-job action once and uses the latest fit read", async () => {
    const { consolidateJobLists } = await import("./assistant-message-parts");
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `job_${index}`,
      title: `Synthetic job ${index}`,
      subtitle: "Synthetic employer",
      status: "72% fit",
      route: "/job-finder/review-queue",
    }));
    const list = {
      type: "records" as const,
      kind: "jobs" as const,
      title: "Shortlisted",
      resultSetId: null,
      totalCount: 30,
      rows,
    };
    const parts = consolidateJobLists([
      list,
      { ...list, rows: rows.map((row) => ({ ...row, status: "75% fit" })) },
      {
        ...list,
        totalCount: 5,
        rows: rows.slice(0, 5).map((row) => ({ ...row, status: "81% fit" })),
      },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      totalCount: 30,
      rows: [
        { status: "81% fit" },
        ...Array.from({ length: 4 }, () => ({ status: "81% fit" })),
        ...Array.from({ length: 20 }, () => ({ status: "75% fit" })),
      ],
    });
  });
  it("keeps distinct lists and non-record parts intact", async () => {
    const { consolidateJobLists } = await import("./assistant-message-parts");
    const list = (id: string) => ({
      type: "records" as const,
      kind: "jobs" as const,
      title: null,
      resultSetId: null,
      totalCount: 1,
      rows: [{ id, title: id, subtitle: null, status: null, route: null }],
    });
    const text = { type: "text" as const, text: "Shortlisted 2 jobs." };
    expect(consolidateJobLists([list("one"), text, list("two")])).toEqual([
      list("one"),
      text,
      list("two"),
    ]);
  });
});
