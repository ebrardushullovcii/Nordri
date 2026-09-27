import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";

import { ApplicationAuthorityReadinessSchema } from "@unemployed/contracts";
import type { JobFinderApplicationAuthorityService } from "../services/job-finder";
import { registerJobFinderAuthorityRouteHandlers } from "./job-finder-authority";

type RouteHandler = (
  event: IpcMainInvokeEvent,
  payload?: unknown,
) => Promise<unknown>;

function createHarness() {
  const handlers = new Map<string, RouteHandler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: RouteHandler) => {
      handlers.set(channel, handler);
    }),
  } as unknown as IpcMain;
  const service = {
    getReadiness: vi.fn(),
    approveCurrentAnswers: vi.fn(),
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve(null)),
    create: vi.fn(),
    update: vi.fn(),
    replaceUsed: vi.fn(),
    revoke: vi.fn(),
    resolveSubmissionOutcome: vi.fn(),
  } satisfies JobFinderApplicationAuthorityService;
  registerJobFinderAuthorityRouteHandlers(ipcMain, { service });
  return { handlers, service };
}

describe("Job Finder authority IPC routes", () => {
  it("exposes readiness and only accepts the literal current-answer approval", async () => {
    const { handlers, service } = createHarness();
    const readiness = ApplicationAuthorityReadinessSchema.parse({
      generatedAt: "2026-08-28T10:00:00.000Z",
      executionCapability: "prepare_only",
      elevatedExecutionAvailable: false,
      answerApprovalStatus: "missing_answers",
      currentAnswers: {
        sourceProfileRevision: 1,
        digest: null,
        entryCount: 0,
        kinds: [],
        missingRequiredKinds: [],
      },
      approvedSnapshot: null,
      activeAuthority: null,
      blockers: [{ code: "no_reusable_answers", remediation: "profile" }],
    });
    service.getReadiness.mockResolvedValueOnce(readiness);
    await expect(
      handlers.get("job-finder:get-application-authority-readiness")!(
        {} as IpcMainInvokeEvent,
        {},
      ),
    ).resolves.toEqual(readiness);
    expect(service.getReadiness).toHaveBeenCalledOnce();

    service.approveCurrentAnswers.mockResolvedValueOnce({
      status: "blocked",
      snapshot: null,
      readiness,
    });
    await expect(
      handlers.get("job-finder:approve-current-application-answers")!(
        {} as IpcMainInvokeEvent,
        { expectedProfileRevision: 1, confirmedCurrentAnswers: true },
      ),
    ).resolves.toEqual({ status: "blocked", snapshot: null, readiness });
    expect(service.approveCurrentAnswers).toHaveBeenCalledWith({
      expectedProfileRevision: 1,
      confirmedCurrentAnswers: true,
    });
    await expect(
      handlers.get("job-finder:approve-current-application-answers")!(
        {} as IpcMainInvokeEvent,
        { expectedProfileRevision: 1, confirmedCurrentAnswers: false },
      ),
    ).rejects.toThrow();
  });

  it("registers only typed management channels and forwards safe list/get inputs", async () => {
    const { handlers, service } = createHarness();
    expect([...handlers.keys()]).toEqual([
      "job-finder:get-application-authority-readiness",
      "job-finder:approve-current-application-answers",
      "job-finder:list-application-authority-envelopes",
      "job-finder:get-application-authority-envelope",
      "job-finder:create-application-authority-envelope",
      "job-finder:update-application-authority-envelope",
      "job-finder:revoke-application-authority-envelope",
      "job-finder:resolve-submission-outcome",
    ]);
    expect(
      [...handlers.keys()].some((channel) => /execute|grant|arm/.test(channel)),
    ).toBe(false);

    const event = {} as IpcMainInvokeEvent;
    await handlers.get("job-finder:list-application-authority-envelopes")!(
      event,
      { status: "active" },
    );
    await handlers.get("job-finder:get-application-authority-envelope")!(
      event,
      { id: "authority_1" },
    );
    expect(service.list).toHaveBeenCalledWith({ status: "active" });
    expect(service.get).toHaveBeenCalledWith({ id: "authority_1" });
  });

  it("rejects malformed and legacy authority payloads before the service", async () => {
    const { handlers, service } = createHarness();
    const event = {} as IpcMainInvokeEvent;

    await expect(
      handlers.get("job-finder:create-application-authority-envelope")!(event, {
        mode: "prepare_only",
        scope: { campaignId: null, jobIds: [] },
        maxApplicationsPerRun: 1,
        maxApplicationsPerLocalDay: 1,
        intermediateMutationsAuthorized: false,
        allowedResumeSha256: [],
        allowedOrigins: ["https://jobs.example.com"],
        expiresAt: null,
        allowAutoSubmitOverride: true,
      }),
    ).rejects.toThrow();
    expect(service.create).not.toHaveBeenCalled();
  });

  it("rejects malformed service output instead of sending it to the renderer", async () => {
    const { handlers, service } = createHarness();
    service.revoke.mockResolvedValueOnce({
      status: "applied",
      envelope: { id: "not-a-valid-envelope" },
    } as never);

    await expect(
      handlers.get("job-finder:revoke-application-authority-envelope")!(
        {} as IpcMainInvokeEvent,
        { id: "authority_1", expectedRevision: 1 },
      ),
    ).rejects.toThrow();
  });

  it("accepts only the redacted operator-verification command", async () => {
    const { handlers, service } = createHarness();
    service.resolveSubmissionOutcome.mockResolvedValueOnce({
      status: "missing",
      outcome: null,
      idempotency: null,
    });
    const handler = handlers.get("job-finder:resolve-submission-outcome")!;
    const event = {} as IpcMainInvokeEvent;

    await expect(
      handler(event, {
        uncertainOutcomeId: "outcome_uncertain",
        resolution: "submitted",
        confirmedOnEmployerSite: true,
      }),
    ).resolves.toEqual({
      status: "missing",
      outcome: null,
      idempotency: null,
    });
    expect(service.resolveSubmissionOutcome).toHaveBeenCalledWith({
      uncertainOutcomeId: "outcome_uncertain",
      resolution: "submitted",
      confirmedOnEmployerSite: true,
    });

    await expect(
      handler(event, {
        uncertainOutcomeId: "outcome_uncertain",
        resolution: "submitted",
        confirmedOnEmployerSite: true,
        evidence: [{ summary: "renderer forged evidence" }],
      }),
    ).rejects.toThrow();
  });
});
