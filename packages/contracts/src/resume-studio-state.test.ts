import { expect, test } from "vitest";
import { JobFinderIntelligenceStateSchema } from "./job-finder-intelligence";
import {
  ResumeBatchCheckpointSchema,
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
