import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  ApplicationDocumentRevisionSchema,
  ApplicationQuestionRecordSchema,
  ApplyJobResultSchema,
  ApplyRunDetailsSchema,
  ApplyRunSchema,
  type JobFinderWorkspaceSnapshot,
} from "@nordri/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationDocumentLibrary } from "../services/job-finder/application-document-library";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showSaveDialog: vi.fn() },
}));

import { registerApplicationDocumentRouteHandlers } from "./application-documents";

type RouteHandler = (
  event: IpcMainInvokeEvent,
  payload?: unknown,
) => Promise<unknown>;

const now = "2026-08-23T12:00:00.000Z";
const job = {
  id: "job-1",
  sourceJobId: "source-job-1",
  canonicalUrl: "https://jobs.example.com/job-1",
  title: "Staff Engineer",
  company: "Example",
};
const applicationA = { id: "application-a", jobId: job.id };
const applicationB = { id: "application-b", jobId: job.id };
const run = ApplyRunSchema.parse({
  id: "run-1",
  mode: "copilot",
  state: "paused_for_user_review",
  jobIds: [job.id],
  currentJobId: job.id,
  summary: "Questions captured",
  detail: "Preparation remains subject to review.",
  createdAt: now,
  updatedAt: now,
});
const resultB = ApplyJobResultSchema.parse({
  id: "result-b",
  runId: run.id,
  jobId: job.id,
  applicationRecordId: applicationB.id,
  state: "awaiting_review",
  summary: "Prepared",
  detail: "Final submission is not authorized.",
  startedAt: now,
  updatedAt: now,
});
const questionB = ApplicationQuestionRecordSchema.parse({
  id: "question-b",
  runId: run.id,
  jobId: job.id,
  applicationRecordId: applicationB.id,
  resultId: resultB.id,
  prompt: "Why are you interested in this role?",
  detectedAt: now,
});
const revision = ApplicationDocumentRevisionSchema.parse({
  id: "document-1",
  revision: 1,
  kind: "short_response",
  status: "proposed",
  createdAt: now,
  updatedAt: now,
  job: {
    jobId: job.id,
    applicationRecordId: applicationB.id,
    sourceJobId: job.sourceJobId,
    canonicalUrl: job.canonicalUrl,
    title: job.title,
    company: job.company,
    jobDigest: "a".repeat(64),
  },
  question: {
    runId: run.id,
    questionId: questionB.id,
    prompt: questionB.prompt,
  },
  content: "I am interested because my approved experience matches the role.",
  evidence: [
    {
      id: "profile.summary",
      source: "profile_summary",
      label: "Approved profile summary",
      text: "Experienced engineer.",
    },
  ],
  evidenceDigest: "b".repeat(64),
});

function createDetails(
  overrides: {
    run?: typeof run;
    result?: typeof resultB | null;
    question?: typeof questionB;
  } = {},
) {
  const selectedRun = overrides.run ?? run;
  const result = overrides.result === undefined ? resultB : overrides.result;
  const question = overrides.question ?? questionB;
  return ApplyRunDetailsSchema.parse({
    run: selectedRun,
    result,
    results: result ? [result] : [],
    questionRecords: [question],
  });
}

function register(details: ReturnType<typeof createDetails>) {
  const handlers = new Map<string, RouteHandler>();
  const propose = vi
    .fn<ApplicationDocumentLibrary["propose"]>()
    .mockResolvedValue(revision);
  const getApplyRunDetails = vi.fn().mockResolvedValue(details);
  const ipcMain = {
    handle: vi.fn((channel: string, handler: RouteHandler) => {
      handlers.set(channel, handler);
    }),
  } as unknown as IpcMain;
  const snapshot = {
    profile: {},
    discoveryJobs: [job],
    applicationRecords: [applicationA, applicationB],
  } as unknown as JobFinderWorkspaceSnapshot;

  registerApplicationDocumentRouteHandlers(ipcMain, {
    library: { propose } as unknown as ApplicationDocumentLibrary,
    getWorkspaceSnapshot: () => Promise.resolve(snapshot),
    getApplyRunDetails,
    selectExportPath: () => Promise.resolve(null),
  });

  return {
    handler: handlers.get("job-finder:propose-application-document")!,
    propose,
    getApplyRunDetails,
  };
}

const payload = {
  kind: "short_response",
  jobId: job.id,
  applicationRecordId: applicationB.id,
  question: { runId: run.id, questionId: questionB.id },
};

describe("application document proposal lineage", () => {
  it("forwards and accepts the exact application B lineage", async () => {
    const { handler, propose, getApplyRunDetails } = register(createDetails());

    await expect(
      handler({ sender: {} } as IpcMainInvokeEvent, payload),
    ).resolves.toEqual(revision);
    expect(getApplyRunDetails).toHaveBeenCalledWith(
      run.id,
      job.id,
      applicationB.id,
    );
    expect(propose).toHaveBeenCalledOnce();
    expect(propose.mock.calls[0]?.[0].grounding.applicationRecord).toEqual(
      applicationB,
    );
    expect(propose.mock.calls[0]?.[0].grounding.question).toEqual(questionB);
  });

  it.each([
    [
      "sibling application A",
      createDetails({
        result: { ...resultB, applicationRecordId: applicationA.id },
        question: { ...questionB, applicationRecordId: applicationA.id },
      }),
    ],
    ["wrong run", createDetails({ run: { ...run, id: "run-other" } })],
    [
      "wrong job",
      createDetails({
        result: { ...resultB, jobId: "job-other" },
      }),
    ],
    [
      "wrong result",
      createDetails({
        question: { ...questionB, resultId: "result-other" },
      }),
    ],
    [
      "wrong question",
      createDetails({ question: { ...questionB, id: "question-other" } }),
    ],
    [
      "legacy null result lineage",
      createDetails({ result: { ...resultB, applicationRecordId: null } }),
    ],
    [
      "legacy null question lineage",
      createDetails({ question: { ...questionB, applicationRecordId: null } }),
    ],
    ["missing result", createDetails({ result: null })],
  ])("rejects %s without proposing a document", async (_label, details) => {
    const { handler, propose } = register(details);

    await expect(
      handler({ sender: {} } as IpcMainInvokeEvent, payload),
    ).rejects.toThrow(/stale|another application/iu);
    expect(propose).not.toHaveBeenCalled();
  });
});
