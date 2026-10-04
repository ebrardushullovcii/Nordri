import { expect, test } from "vitest";
import {
  ApplicationAnswerRecordSchema,
  compareApplicationAnswerRecency,
} from "./apply";

const answer = (id: string, revision: number, createdAt: string) =>
  ApplicationAnswerRecordSchema.parse({
    id,
    revision,
    createdAt,
    questionId: "pay",
    runId: "run",
    jobId: "job",
    text: "42000 EUR",
  });

test("answer recency orders by revision, then creation time, then id", () => {
  const older = "2026-10-01T10:00:00.000Z";
  const newer = "2026-10-02T10:00:00.000Z";
  const records = [
    answer("a", 1, older),
    answer("b", 1, newer),
    answer("c", 1, newer),
    answer("d", 2, older),
  ];
  expect(
    [...records]
      .sort(compareApplicationAnswerRecency)
      .map((record) => record.id),
  ).toEqual(["d", "c", "b", "a"]);
  expect(compareApplicationAnswerRecency(records[0]!, records[0]!)).toBe(0);
});
