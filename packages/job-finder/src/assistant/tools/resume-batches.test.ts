import { randomUUID } from "node:crypto";

import type { AssistantRunRef } from "@nordri/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createSeed,
  createWorkspaceServiceHarness,
} from "../../workspace-service.test-support";
import type { AssistantHostPorts } from "../ports";
import type { AssistantTurnSession } from "../tool-kit";
import {
  cancelBackgroundBatch,
  cancelResumesTool,
  generateResumesTool,
  readBackgroundBatch,
} from "./resume-tools";

async function world(count = 5) {
  const seed = createSeed();
  const base = seed.savedJobs[0]!;
  seed.savedJobs = Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `resume_batch_job_${index + 1}`,
    sourceJobId: `resume_batch_source_${index + 1}`,
    canonicalUrl: `https://jobs.example.test/resume-batch/${index + 1}`,
    applicationUrl: `https://jobs.example.test/resume-batch/${index + 1}/apply`,
    status: "shortlisted" as const,
    resumeApplicationMode: "tailored_per_job" as const,
    resumeTailoringMode:
      index === 0 ? ("aggressive" as const) : ("balanced" as const),
  }));
  seed.resumeDrafts = [];
  seed.tailoredAssets = [];
  seed.applicationRecords = [];
  const { workspaceService: service } = createWorkspaceServiceHarness({ seed });
  const snapshot = await service.getWorkspaceSnapshot();
  const controller = new AbortController();
  const runs: AssistantRunRef[] = [];
  const session = {
    conversationId: randomUUID(),
    signal: controller.signal,
    assertCurrent: () => undefined,
    now: () => new Date().toISOString(),
    createId: () => randomUUID(),
    watchRun: (run: AssistantRunRef) => {
      runs.push(run);
      return Promise.resolve();
    },
  } as unknown as AssistantTurnSession;
  const ports = {
    publishWorkspaceUpdate: vi.fn(),
  } as unknown as AssistantHostPorts;
  const generate = vi
    .spyOn(service, "generateResume")
    .mockResolvedValue(snapshot);
  const regenerate = vi
    .spyOn(service, "regenerateResumeDraft")
    .mockResolvedValue(snapshot);
  return {
    service,
    session,
    ports,
    controller,
    runs,
    generate,
    regenerate,
    snapshot,
    ids: seed.savedJobs.map((job) => job.id),
  };
}

function hold() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function finished(run: AssistantRunRef) {
  await vi.waitFor(() => expect(readBackgroundBatch(run.id)?.done).toBe(true));
  return readBackgroundBatch(run.id)!;
}

describe("sidebar resume batches", () => {
  it("writes only the requested eligible jobs and reports Original, existing and application skips", async () => {
    const ctx = await world();
    const current = structuredClone(ctx.snapshot);
    current.discoveryJobs[0]!.resumeApplicationMode = "original_resume";
    current.resumeDrafts = [
      { jobId: ctx.ids[1]! } as (typeof current.resumeDrafts)[number],
    ];
    current.applicationRecords = [
      { jobId: ctx.ids[2]! } as (typeof current.applicationRecords)[number],
    ];
    vi.spyOn(ctx.service, "getWorkspaceSnapshot").mockResolvedValue(current);
    const result = await generateResumesTool.execute(
      { jobIds: ctx.ids.slice(0, 4), regenerate: false },
      ctx,
    );
    await finished(ctx.runs[0]!);
    expect(ctx.generate.mock.calls.map(([id]) => id)).toEqual([ctx.ids[3]]);
    expect(ctx.regenerate).not.toHaveBeenCalled();
    expect(ctx.runs[0]?.jobIds).toEqual([ctx.ids[3]]);
    expect(result.data).toMatchObject({
      jobIds: [ctx.ids[3]],
      skipped: [
        { jobId: ctx.ids[0], reason: "Original resume is unchanged" },
        { jobId: ctx.ids[1], reason: "resume already exists" },
        { jobId: ctx.ids[2], reason: "already in Applications" },
      ],
    });
    expect(result.summary).toContain("Started writing 1 resume");
    expect(result.summary).toContain("Skipped 3 jobs");
  });

  it("follows the saved Original default, but preserves a per-job tailored override", async () => {
    const ctx = await world(2);
    const current = structuredClone(ctx.snapshot);
    current.settings.resumeApplicationMode = "original_resume";
    current.discoveryJobs[0]!.resumeApplicationMode = null;
    vi.spyOn(ctx.service, "getWorkspaceSnapshot").mockResolvedValue(current);
    await generateResumesTool.execute(
      { jobIds: ctx.ids, regenerate: false },
      ctx,
    );
    await finished(ctx.runs[0]!);
    expect(ctx.generate.mock.calls.map(([id]) => id)).toEqual([ctx.ids[1]]);
    expect(current.discoveryJobs[1]?.resumeTailoringMode).toBe("balanced");
  });

  it("rewrites an existing draft only when asked, without changing its saved level", async () => {
    const ctx = await world(1);
    const current = structuredClone(ctx.snapshot);
    current.resumeDrafts = [
      { jobId: ctx.ids[0]! } as (typeof current.resumeDrafts)[number],
    ];
    vi.spyOn(ctx.service, "getWorkspaceSnapshot").mockResolvedValue(current);
    const skipped = await generateResumesTool.execute(
      { jobIds: ctx.ids, regenerate: false },
      ctx,
    );
    expect(skipped.summary).toContain("No resumes started");
    expect(ctx.runs).toEqual([]);
    await generateResumesTool.execute(
      { jobIds: ctx.ids, regenerate: true },
      ctx,
    );
    await finished(ctx.runs[0]!);
    expect(ctx.generate).not.toHaveBeenCalled();
    expect(ctx.regenerate).toHaveBeenCalledWith(ctx.ids[0]);
    expect(current.discoveryJobs[0]?.resumeTailoringMode).toBe("aggressive");
  });

  it("bounds workers, holds duplicate starts, and Stop after the turn ends lets only active drafts finish", async () => {
    const ctx = await world();
    const gate = hold();
    ctx.generate.mockImplementation(async () => {
      await gate.promise;
      return ctx.snapshot;
    });
    await generateResumesTool.execute(
      { jobIds: [...ctx.ids, ctx.ids[0]!], regenerate: false },
      ctx,
    );
    await vi.waitFor(() => expect(ctx.generate).toHaveBeenCalledTimes(2));
    const duplicate = await generateResumesTool.execute(
      { jobIds: ctx.ids, regenerate: true },
      ctx,
    );
    expect(duplicate.summary).toContain("No resumes started");
    expect(duplicate.summary).toContain("already being written");
    expect(ctx.runs).toHaveLength(1);
    cancelBackgroundBatch(ctx.runs[0]!.id);
    const active = readBackgroundBatch(ctx.runs[0]!.id)!;
    expect(active.cancelled).toBe(true);
    expect(active.done).toBe(false);
    expect(active.activeJobIds).toHaveLength(2);
    gate.resolve();
    const final = await finished(ctx.runs[0]!);
    expect(ctx.generate).toHaveBeenCalledTimes(2);
    expect(final.completedJobIds).toEqual(ctx.ids.slice(0, 2));
    expect(final.failures).toEqual([]);
  });

  it("rechecks the queued jobs' newest settings and continues after one job fails", async () => {
    const ctx = await world(4);
    const gate = hold();
    const current = structuredClone(ctx.snapshot);
    vi.spyOn(ctx.service, "getWorkspaceSnapshot").mockImplementation(() =>
      Promise.resolve(structuredClone(current)),
    );
    ctx.generate.mockImplementation(async (jobId) => {
      if (jobId === ctx.ids[0] || jobId === ctx.ids[1]) await gate.promise;
      if (jobId === ctx.ids[0]) throw new Error("temporary provider failure");
      return ctx.snapshot;
    });
    await generateResumesTool.execute(
      { jobIds: ctx.ids, regenerate: false },
      ctx,
    );
    await vi.waitFor(() => expect(ctx.generate).toHaveBeenCalledTimes(2));
    current.discoveryJobs[2]!.resumeApplicationMode = "original_resume";
    gate.resolve();
    const final = await finished(ctx.runs[0]!);
    expect(ctx.generate.mock.calls.map(([id]) => id)).toEqual([
      ctx.ids[0],
      ctx.ids[1],
      ctx.ids[3],
    ]);
    expect(final.failures).toEqual([
      `${ctx.ids[0]}: temporary provider failure`,
    ]);
    expect(final.skipped).toEqual([
      { jobId: ctx.ids[2], reason: "Original resume is unchanged" },
    ]);
    expect(final.completedJobIds).toEqual([ctx.ids[1], ctx.ids[3]]);
  });

  it("the cancellation tool names active drafts and affects only its conversation", async () => {
    const ctx = await world(4);
    const gate = hold();
    ctx.generate.mockImplementation(async () => {
      await gate.promise;
      return ctx.snapshot;
    });
    await generateResumesTool.execute(
      { jobIds: ctx.ids.slice(0, 2), regenerate: false },
      ctx,
    );
    const other = {
      ...ctx,
      session: { ...ctx.session, conversationId: randomUUID() },
    };
    await generateResumesTool.execute(
      { jobIds: ctx.ids.slice(2), regenerate: false },
      other,
    );
    await vi.waitFor(() => expect(ctx.generate).toHaveBeenCalledTimes(4));
    const result = await cancelResumesTool.execute({}, ctx);
    expect(result.data).toEqual({ stoppedBatches: 1, activeDrafts: 2 });
    expect(result.summary).toContain("2 active drafts will finish");
    expect(readBackgroundBatch(ctx.runs[0]!.id)?.cancelled).toBe(true);
    expect(readBackgroundBatch(ctx.runs[1]!.id)?.cancelled).toBe(false);
    gate.resolve();
    await Promise.all(ctx.runs.map(finished));
  });
});
