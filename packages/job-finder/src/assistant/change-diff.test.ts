import { describe, expect, it } from "vitest";

import { diffValues, readPath, undoChangeEntries } from "./change-diff";

const profile = () => ({
  headline: "Engineer",
  summary: "Builds things.",
  skills: ["TypeScript", "React"],
  experiences: [
    { id: "e1", title: "Developer", companyName: "Acme" },
    { id: "e2", title: "Intern", companyName: "Beta" },
  ],
});

describe("change diff and per-change undo", () => {
  it("records only the values an edit touched", () => {
    const before = profile();
    const after = { ...before, headline: "Senior Engineer" };
    const entries = diffValues(before, after);
    expect(entries).toEqual([
      expect.objectContaining({
        path: ["headline"],
        kind: "set",
        before: "Engineer",
        after: "Senior Engineer",
      }),
    ]);
  });

  it("addresses records by id, so a reordered list still undoes", () => {
    const before = profile();
    const after = {
      ...before,
      experiences: [
        before.experiences[0]!,
        { id: "e2", title: "Junior Developer", companyName: "Beta" },
      ],
    };
    const entries = diffValues(before, after);
    expect(entries[0]?.path).toEqual(["experiences", "#id:e2", "title"]);
    // The person moves e2 to the top afterwards.
    const reordered = {
      ...after,
      experiences: [after.experiences[1]!, after.experiences[0]!],
    };
    const undo = undoChangeEntries(reordered, entries);
    expect(undo.conflicts).toEqual([]);
    expect(undo.next.experiences[0]).toEqual({
      id: "e2",
      title: "Intern",
      companyName: "Beta",
    });
  });

  it("undoes the second of three assistant changes and keeps the other two", () => {
    const start = profile();
    const first = { ...start, headline: "Staff Engineer" };
    const second = { ...first, summary: "Leads platform work." };
    const third = {
      ...second,
      experiences: [
        ...second.experiences,
        { id: "e3", title: "Mentor", companyName: "Gamma" },
      ],
    };
    const firstEntries = diffValues(start, first);
    const secondEntries = diffValues(first, second);
    const thirdEntries = diffValues(second, third);
    expect(firstEntries).toHaveLength(1);
    expect(thirdEntries[0]?.kind).toBe("insert");

    const undo = undoChangeEntries(third, secondEntries);
    expect(undo.conflicts).toEqual([]);
    expect(undo.next.summary).toBe("Builds things.");
    expect(undo.next.headline).toBe("Staff Engineer");
    expect(undo.next.experiences.map((entry) => entry.id)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
  });

  it("keeps a manual edit to another field", () => {
    const start = profile();
    const assistant = { ...start, headline: "Principal Engineer" };
    const entries = diffValues(start, assistant);
    const manual = { ...assistant, skills: ["TypeScript", "React", "Go"] };
    const undo = undoChangeEntries(manual, entries);
    expect(undo.conflicts).toEqual([]);
    expect(undo.next.headline).toBe("Engineer");
    expect(undo.next.skills).toContain("Go");
  });

  it("refuses to undo a field the person changed again, and names it", () => {
    const start = profile();
    const assistant = { ...start, headline: "Principal Engineer" };
    const entries = diffValues(start, assistant);
    const manual = { ...assistant, headline: "Head of Engineering" };
    const undo = undoChangeEntries(manual, entries);
    expect(undo.undone).toEqual([]);
    expect(undo.conflicts.map((entry) => entry.label)).toEqual(["Headline"]);
    expect(undo.next.headline).toBe("Head of Engineering");
  });

  it("takes out an inserted record and puts a removed one back in place", () => {
    const start = profile();
    const removed = { ...start, experiences: [start.experiences[1]!] };
    const removeEntries = diffValues(start, removed);
    expect(removeEntries[0]).toMatchObject({ kind: "remove", index: 0 });
    const restored = undoChangeEntries(removed, removeEntries);
    expect(restored.next.experiences.map((entry) => entry.id)).toEqual([
      "e1",
      "e2",
    ]);

    const inserted = {
      ...start,
      experiences: [
        ...start.experiences,
        { id: "e9", title: "New", companyName: "Delta" },
      ],
    };
    const insertEntries = diffValues(start, inserted);
    const taken = undoChangeEntries(inserted, insertEntries);
    expect(taken.next.experiences.map((entry) => entry.id)).toEqual([
      "e1",
      "e2",
    ]);
  });

  it("ignores bookkeeping keys such as timestamps", () => {
    const before = {
      sections: [
        { id: "s1", text: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    const after = {
      sections: [
        { id: "s1", text: "b", updatedAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    const entries = diffValues(before, after, { ignoreKeys: ["updatedAt"] });
    expect(entries.map((entry) => entry.path)).toEqual([
      ["sections", "#id:s1", "text"],
    ]);
    const later = {
      sections: [
        { id: "s1", text: "b", updatedAt: "2026-03-01T00:00:00.000Z" },
      ],
    };
    const undo = undoChangeEntries(later, entries, {
      ignoreKeys: ["updatedAt"],
    });
    expect(readPath(undo.next, ["sections", "#id:s1", "text"]).value).toBe("a");
  });

  it("undoes a reorder only when the order is still the one it made", () => {
    const start = profile();
    const swapped = {
      ...start,
      experiences: [start.experiences[1]!, start.experiences[0]!],
    };
    const entries = diffValues(start, swapped);
    expect(entries.map((entry) => entry.path.at(-1))).toEqual(["#order"]);
    const undo = undoChangeEntries(swapped, entries);
    expect(undo.next.experiences.map((entry) => entry.id)).toEqual([
      "e1",
      "e2",
    ]);
  });
});
