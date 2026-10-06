import { ApplyJobResultSchema } from "./apply";
import { describe, expect, test } from "vitest";

import {
  projectApplicationRecordsActivity,
  inferApplicationActivityStage,
  ApplicationCrmBulkStageMutationInputSchema,
  ApplicationCrmDataSchema,
  ApplicationCrmMutationInputSchema,
  ApplicationCrmSettingsSchema,
  resolveApplicationCrmStageSource,
  resolveApplicationCrmTrackedStage,
} from "./application-crm";
import { ApplicationRecordSchema } from "./discovery";

describe("application CRM contracts", () => {
  test("classifies only complete metadata histories as activity-driven legacy stages", () => {
    const metadata = ApplicationCrmDataSchema.parse({
      stage: "preparing",
      stageChangedAt: "2026-08-15T10:00:00.000Z",
      revision: 1,
      events: [
        {
          id: "tag",
          at: "2026-08-15T10:00:00.000Z",
          kind: "tags_changed",
          title: "Tags saved",
          source: "user",
        },
      ],
    });
    expect(metadata.stageSource).toBeUndefined();
    expect(resolveApplicationCrmStageSource(metadata)).toBe("activity");
    expect(resolveApplicationCrmTrackedStage(metadata, "interview")).toBe(
      "interview",
    );
    expect(resolveApplicationCrmStageSource({ ...metadata, revision: 2 })).toBe(
      "user",
    );
    expect(
      resolveApplicationCrmStageSource({
        ...metadata,
        revision: 0,
        events: [],
      }),
    ).toBe("user");
    expect(
      resolveApplicationCrmStageSource({
        ...metadata,
        customStageId: "custom",
      }),
    ).toBe("user");
    expect(
      resolveApplicationCrmStageSource({ ...metadata, stageSource: "user" }),
    ).toBe("user");
    const explicit = ApplicationCrmDataSchema.parse({
      ...metadata,
      events: [
        {
          ...metadata.events[0],
          kind: "stage_changed",
          fromStage: "applied",
          toStage: "preparing",
        },
      ],
    });
    expect(resolveApplicationCrmStageSource(explicit)).toBe("user");
    expect(resolveApplicationCrmTrackedStage(explicit, "interview")).toBe(
      "preparing",
    );
  });

  test("keeps automatic no-response until application progress advances", () => {
    const crm = ApplicationCrmDataSchema.parse({
      stage: "no_response",
      stageSource: "activity",
      stageChangedAt: "2026-08-15T10:00:00.000Z",
      revision: 1,
      events: [
        {
          id: "auto",
          at: "2026-08-15T10:00:00.000Z",
          kind: "automation",
          title: "No response",
          source: "automation",
          fromStage: "applied",
          toStage: "no_response",
        },
      ],
    });
    expect(resolveApplicationCrmTrackedStage(crm, "applied")).toBe(
      "no_response",
    );
    expect(resolveApplicationCrmTrackedStage(crm, "interview")).toBe(
      "interview",
    );
  });

  test("keeps legacy application records readable without inventing CRM history", () => {
    const record = ApplicationRecordSchema.parse({
      id: "application_1",
      jobId: "job_1",
      title: "Software Engineer",
      company: "Example",
      status: "submitted",
      lastActionLabel: "Prepared",
      nextActionLabel: null,
      lastUpdatedAt: "2026-08-15T10:00:00.000Z",
    });

    expect(record.crm).toBeNull();
  });

  test("parses the complete local CRM data without storing attachment bytes", () => {
    const crm = ApplicationCrmDataSchema.parse({
      stage: "interview",
      stageChangedAt: "2026-08-15T10:00:00.000Z",
      tags: ["priority", "remote"],
      contacts: [
        {
          id: "contact_1",
          name: "Recruiter",
          email: "recruiter@example.com",
          createdAt: "2026-08-15T10:00:00.000Z",
          updatedAt: "2026-08-15T10:00:00.000Z",
        },
      ],
      attachments: [
        {
          id: "attachment_1",
          candidateAssetId: "asset_1",
          label: "Approved resume",
          kind: "resume",
          addedAt: "2026-08-15T10:00:00.000Z",
        },
      ],
    });

    expect(crm.stage).toBe("interview");
    expect(crm.attachments[0]).not.toHaveProperty("filePath");
    expect(crm.attachments[0]).not.toHaveProperty("bytes");
  });

  test("defaults no-response automation to fourteen days", () => {
    expect(ApplicationCrmSettingsSchema.parse({}).noResponseAutomation).toEqual(
      { enabled: true, afterDays: 14 },
    );
  });

  test("rejects stale or negative mutation revisions at the boundary", () => {
    expect(() =>
      ApplicationCrmMutationInputSchema.parse({
        applicationRecordId: "application_1",
        expectedRevision: -1,
        mutation: { type: "set_tags", tags: ["priority"] },
      }),
    ).toThrow();
  });

  test("requires unique revision-guarded records for bulk stage changes", () => {
    expect(() =>
      ApplicationCrmBulkStageMutationInputSchema.parse({
        items: [
          { applicationRecordId: "application_1", expectedRevision: 0 },
          { applicationRecordId: "application_1", expectedRevision: 0 },
        ],
        stage: "reviewing",
      }),
    ).toThrow();

    expect(
      ApplicationCrmBulkStageMutationInputSchema.parse({
        items: [{ applicationRecordId: "application_1", expectedRevision: 2 }],
        stage: "reviewing",
      }),
    ).toMatchObject({
      customStageId: null,
      note: null,
    });
  });
});

test("requires complete Undo snapshots and tags for bulk actions", () => {
  const base = {
    items: [{ applicationRecordId: "application", expectedRevision: 1 }],
    stage: "reviewing",
  };
  expect(
    ApplicationCrmBulkStageMutationInputSchema.safeParse({
      ...base,
      action: "undo",
    }).success,
  ).toBe(false);
  expect(
    ApplicationCrmBulkStageMutationInputSchema.safeParse({
      ...base,
      action: "tags",
    }).success,
  ).toBe(false);
  expect(
    ApplicationCrmBulkStageMutationInputSchema.safeParse({
      ...base,
      action: "tags",
      tags: ["priority"],
    }).success,
  ).toBe(true);
  expect(
    ApplicationCrmMutationInputSchema.safeParse({
      applicationRecordId: "application",
      expectedRevision: 1,
      mutation: { type: "set_archived", archived: true },
    }).success,
  ).toBe(true);
});

describe("latest application result projection", () => {
  const at = "2026-10-05T10:00:00Z";
  const record = ApplicationRecordSchema.parse({
    id: "application",
    jobId: "job",
    title: "Engineer",
    company: "Synthetic",
    status: "ready_for_review",
    lastActionLabel: "Preparing",
    nextActionLabel: null,
    lastUpdatedAt: at,
    lastAttemptState: null,
  });
  function result(state: string, overrides: Record<string, unknown> = {}) {
    return ApplyJobResultSchema.parse({
      id: "result",
      runId: "run",
      jobId: "job",
      applicationRecordId: "application",
      state,
      summary: "Synthetic attempt",
      detail: "Synthetic detail",
      startedAt: at,
      updatedAt: at,
      ...overrides,
    });
  }
  test("a failed retained result replaces blank record attempt state", () => {
    const projected = projectApplicationRecordsActivity({
      records: [record],
      results: [result("failed")],
    })[0]!;
    expect(projected.lastAttemptState).toBe("failed");
    expect(inferApplicationActivityStage(projected)).toBe("failed");
  });
  test("verified sends supply the applied date without rewriting a manual stage", () => {
    const sent = result("submitted", {
      completedAt: at,
      privacyReceipt: {
        generatedAt: at,
        lineage: { runId: "run", jobId: "job", resultId: "result" },
        destination: { origin: "http://127.0.0.1:47950", safePath: "/apply" },
        resume: { source: "original_upload", fileName: "synthetic.pdf" },
        finalSubmitAuthorized: true,
        finalSubmitOccurred: true,
      },
    });
    const manual = {
      ...record,
      crm: ApplicationCrmDataSchema.parse({
        stage: "interview",
        stageSource: "user",
        stageChangedAt: at,
      }),
    };
    const projected = projectApplicationRecordsActivity({
      records: [manual, { ...record, id: "other" }],
      results: [sent],
    });
    expect(projected[0]?.crm?.stage).toBe("interview");
    expect(projected[0]?.crm?.appliedAt).toBe(at);
    expect(
      projectApplicationRecordsActivity({
        records: [record],
        results: [sent],
      })[0]?.crm?.appliedAt,
    ).toBe(at);
    const uncertain = projectApplicationRecordsActivity({
      records: [record],
      results: [result("submitted")],
    })[0]!;
    expect(uncertain.crm?.appliedAt).toBeFalsy();
    expect(uncertain.lastAttemptState).toBe("paused");
  });
  test.each([
    ["filling", {}, "in_progress"],
    ["planned", {}, "in_progress"],
    ["awaiting_review", {}, "ready"],
    [
      "awaiting_review",
      { latestQuestionCount: 2, latestAnswerCount: 1 },
      "paused",
    ],
    ["blocked", { blockerReason: "auth_required" }, "paused"],
  ])("projects %s as %s", (state, overrides, expected) => {
    expect(
      projectApplicationRecordsActivity({
        records: [record],
        results: [result(state, overrides as Record<string, unknown>)],
      })[0]?.lastAttemptState,
    ).toBe(expected);
  });
});

test("legacy sent records need a receipt or the person's own confirmation", () => {
  const record = ApplicationRecordSchema.parse({
    id: "legacy",
    jobId: "job",
    title: "Engineer",
    company: "Synthetic",
    status: "submitted",
    lastAttemptState: "submitted",
    lastActionLabel: "Sent",
    nextActionLabel: null,
    lastUpdatedAt: "2026-10-05T00:00:00.000Z",
  });
  expect(
    projectApplicationRecordsActivity({ records: [record], results: [] })[0],
  ).toMatchObject({
    status: "ready_for_review",
    lastAttemptState: "paused",
    lastActionLabel: "Not confirmed",
  });
  expect(
    projectApplicationRecordsActivity({
      records: [{ ...record, status: "interview" }],
      results: [],
    })[0]?.status,
  ).toBe("interview");
  const manual = {
    ...record,
    crm: ApplicationCrmDataSchema.parse({
      stage: "applied",
      stageSource: "user",
      stageChangedAt: record.lastUpdatedAt,
    }),
  };
  expect(
    projectApplicationRecordsActivity({ records: [manual], results: [] })[0]
      ?.lastActionLabel,
  ).toBe("Marked sent by you");
  const confirmed = {
    ...record,
    personSendReceipt: {
      observedAt: record.lastUpdatedAt,
      origin: "https://example.test",
      safePath: "/confirmation",
      summary: "The site confirmed receipt. Reference: SYN-42.",
    },
  };
  expect(
    projectApplicationRecordsActivity({ records: [confirmed], results: [] })[0]
      ?.lastAttemptState,
  ).toBe("submitted");
  expect(
    projectApplicationRecordsActivity({
      records: [{ ...confirmed, nextActionLabel: "Prepare again" }],
      results: [],
    })[0]?.nextActionLabel,
  ).toBe("View application");
});
