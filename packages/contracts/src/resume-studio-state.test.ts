import {
  hasModelReadResumeHeader,
  ResumeImportRunSchema,
} from "./resume-import";
import { expect, test } from "vitest";
import { JobFinderIntelligenceStateSchema } from "./job-finder-intelligence";
import {
  ResumeBatchCheckpointSchema,
  estimateResumeBatchMinutesLeft,
  ResumeLanguageTranslationSchema,
} from "./resume";

test("keeps the unfinished batch receipt through intelligence serialization", () => {
  const checkpoint = ResumeBatchCheckpointSchema.parse({
    id: "batch",
    jobIds: ["one", "two"],
    activeJobIds: ["two"],
    completedJobIds: ["one"],
    done: false,
    stopRequested: false,
  });
  const state = JobFinderIntelligenceStateSchema.parse({
    resumeBatchCheckpoint: checkpoint,
  });
  expect(
    JobFinderIntelligenceStateSchema.parse(
      JSON.parse(JSON.stringify(state)) as unknown,
    ).resumeBatchCheckpoint,
  ).toEqual(checkpoint);
});

test("requires nonempty translated fields and a reported language", () => {
  expect(
    ResumeLanguageTranslationSchema.safeParse({
      language: "German",
      translations: [{ id: "summary", text: "" }],
    }).success,
  ).toBe(false);
  expect(
    ResumeLanguageTranslationSchema.parse({
      language: "German",
      translations: [{ id: "summary", text: "Lagerlogistik" }],
    }).language,
  ).toBe("German");
});

test("R3-184 waits for two measured completions, then estimates two-writer waves", () => {
  expect(estimateResumeBatchMinutesLeft([120_000], 8)).toBeNull();
  expect(estimateResumeBatchMinutesLeft([120_000, 180_000], 7)).toBe(10);
  expect(estimateResumeBatchMinutesLeft([120_000, 180_000], 0)).toBeNull();
  expect(estimateResumeBatchMinutesLeft([10_000, 20_000], 1)).toBe(1);
});

test("R3-183 preserves requested rewrites and observed times across serialization", () => {
  const checkpoint = ResumeBatchCheckpointSchema.parse({
    id: "assistant_batch",
    jobIds: ["old"],
    activeJobIds: ["old"],
    completedJobIds: [],
    done: false,
    stopRequested: false,
    requests: [
      {
        jobId: "old",
        level: "aggressive",
        language: "German",
        regenerate: true,
      },
    ],
    durationsMs: [140000, 170000],
  });
  const saved = JobFinderIntelligenceStateSchema.parse(
    JSON.parse(
      JSON.stringify({
        resumeBatchCheckpoint: checkpoint,
        resumeBatchCheckpoints: [checkpoint],
      }),
    ),
  );
  expect(saved.resumeBatchCheckpoint).toEqual(checkpoint);
  expect(saved.resumeBatchCheckpoints).toEqual([checkpoint]);
});

test("older imports offer a new read until the model completed the header stage", () => {
  const run = ResumeImportRunSchema.parse({
    id: "old",
    sourceResumeId: "resume",
    sourceResumeFileName: "synthetic.txt",
    status: "applied",
    startedAt: "2026-10-05T00:00:00.000Z",
  });
  expect(hasModelReadResumeHeader(run)).toBe(false);
  run.timing = {
    totalMs: 1,
    textBranchMs: 1,
    literalExtractionMs: 0,
    reconciliationMs: 0,
    finalizationMs: 0,
    textStages: [
      {
        stage: "identity_summary",
        status: "completed",
        providerKind: "openai_compatible",
        providerLabel: "Model",
        durationMs: 1,
        primaryProviderMs: 1,
        deterministicFallbackMs: null,
        candidateCount: 1,
        fallbackKind: null,
        fallbackReason: null,
      },
    ],
  };
  expect(hasModelReadResumeHeader(run)).toBe(true);
  run.timing.textStages[0]!.providerKind = "deterministic";
  expect(hasModelReadResumeHeader(run)).toBe(false);
});
