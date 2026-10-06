import { describe, expect, test } from "vitest";

import { ApplyJobResultSchema } from "./apply";

const baseResult = {
  id: "result_1",
  runId: "run_1",
  jobId: "job_1",
  summary: "Application planned.",
  detail: "Waiting to prepare.",
  startedAt: "2026-08-23T09:00:00.000Z",
  updatedAt: "2026-08-23T09:00:00.000Z",
};

describe("application preparation accounting contract", () => {
  test("accepts legacy absent, current null, and committed non-null pairs", () => {
    const legacy = ApplyJobResultSchema.parse(baseResult);
    expect(legacy).not.toHaveProperty("applicationPreparationStartedAt");
    expect(legacy).not.toHaveProperty("applicationPreparationStartedLocalDate");

    expect(
      ApplyJobResultSchema.parse({
        ...baseResult,
        applicationPreparationStartedAt: null,
        applicationPreparationStartedLocalDate: null,
      }),
    ).toMatchObject({
      applicationPreparationStartedAt: null,
      applicationPreparationStartedLocalDate: null,
    });

    expect(
      ApplyJobResultSchema.parse({
        ...baseResult,
        applicationPreparationStartedAt: "2026-08-23T10:15:30.000Z",
        applicationPreparationStartedLocalDate: "2026-08-23",
      }),
    ).toMatchObject({
      applicationPreparationStartedAt: "2026-08-23T10:15:30.000Z",
      applicationPreparationStartedLocalDate: "2026-08-23",
    });
  });

  test.each([
    { applicationPreparationStartedAt: null },
    { applicationPreparationStartedLocalDate: null },
    {
      applicationPreparationStartedAt: "2026-08-23T10:15:30.000Z",
      applicationPreparationStartedLocalDate: null,
    },
    {
      applicationPreparationStartedAt: null,
      applicationPreparationStartedLocalDate: "2026-08-23",
    },
    {
      applicationPreparationStartedAt: "not-an-iso-timestamp",
      applicationPreparationStartedLocalDate: "2026-08-23",
    },
    {
      applicationPreparationStartedAt: "2026-08-23T10:15:30.000Z",
      applicationPreparationStartedLocalDate: "2026-02-30",
    },
    {
      applicationPreparationStartedAt: "2026-08-23T10:15:30.000Z",
      applicationPreparationStartedLocalDate: "2026-8-23",
    },
  ])("rejects mismatched or invalid preparation fields", (fields) => {
    expect(() =>
      ApplyJobResultSchema.parse({ ...baseResult, ...fields }),
    ).toThrow();
  });
});

test("automatic send queue state is typed and optional for old records", () => {
  expect(
    ApplyJobResultSchema.parse(baseResult).automaticSendPending,
  ).toBeUndefined();
  expect(
    ApplyJobResultSchema.parse({ ...baseResult, automaticSendPending: true })
      .automaticSendPending,
  ).toBe(true);
  expect(() =>
    ApplyJobResultSchema.parse({
      ...baseResult,
      automaticSendPending: "queued",
    }),
  ).toThrow();
});
