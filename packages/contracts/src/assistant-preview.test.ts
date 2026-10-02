import { describe, expect, it } from "vitest";
import { AssistantMessagePartSchema } from "./assistant";

describe("assistant change preview", () => {
  it("keeps a removed record's fields, one per line, beyond a single value's length", () => {
    const before = Array.from(
      { length: 12 },
      (_, index) => `Field ${index}: ${"synthetic detail ".repeat(8)}`,
    ).join("\n");
    const preview = [
      { label: "Skills", before: "React", after: "React, TypeScript" },
      { label: "Removed education", before, after: null },
    ];
    const parsed = AssistantMessagePartSchema.parse({
      type: "change",
      receiptId: "receipt_synthetic",
      target: "profile",
      summary: "Removed an education record",
      preview,
    });
    expect(before.length).toBeGreaterThan(600);
    expect(parsed.type === "change" ? parsed.preview : null).toEqual(preview);
  });
});
