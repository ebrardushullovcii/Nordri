import { z } from "zod";

/** Durations overlap: tool time includes checks; auxiliary model calls may run during tools. */
const ApplyAgentTimingRecordSchema = z.object({
  totalMs: z.number().finite().nonnegative(),
  modelMs: z.number().finite().nonnegative(),
  modelTurns: z.number().int().nonnegative(),
  auxiliaryModelMs: z.number().finite().nonnegative(),
  auxiliaryModelCalls: z.number().int().nonnegative(),
  toolMs: z.number().finite().nonnegative(),
  pageReadMs: z.number().finite().nonnegative(),
  pageReads: z.number().int().nonnegative(),
  writeMs: z.number().finite().nonnegative(),
  uploadMs: z.number().finite().nonnegative(),
  longestSteps: z
    .array(
      z.object({
        toolName: z.string().min(1).max(100),
        durationMs: z.number().finite().nonnegative(),
      }),
    )
    .max(5),
  requests: z
    .array(
      z.object({
        turn: z.number().int().positive(),
        historyChars: z.number().int().nonnegative(),
        observationChars: z.number().int().nonnegative(),
        // Optional so timing records from earlier runs still load.
        fieldsAttempted: z.number().int().nonnegative().optional(),
        fieldsFilled: z.number().int().nonnegative().optional(),
        stepsAdvanced: z.number().int().nonnegative().optional(),
      }),
    )
    .max(1000),
});
export type ApplyAgentTiming = z.infer<typeof ApplyAgentTimingRecordSchema>;
// Keep the timing schema from expanding through every workspace state schema.
export const ApplyAgentTimingSchema: z.ZodType<ApplyAgentTiming> =
  ApplyAgentTimingRecordSchema;
