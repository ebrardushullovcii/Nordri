import { describe, expect, test } from "vitest";
import { ApplicationRecordSchema } from "@unemployed/contracts";

import {
  APPLICATION_CRM_STAGE_LABELS,
  applicationCrmStageLabelForView,
  applicationCrmStageProvenanceForView,
  applicationCrmDataForView,
  buildApplicationCrmCalendarForView,
  groupApplicationRecordsByStage,
  inferApplicationCrmStageForView,
} from "./applications-crm-model";

function record(overrides: Record<string, unknown> = {}) {
  return ApplicationRecordSchema.parse({
    id: "application_1",
    jobId: "job_1",
    title: "Engineer",
    company: "Example",
    status: "submitted",
    lastActionLabel: "Applied manually",
    nextActionLabel: null,
    lastUpdatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  });
}

describe("application CRM renderer model", () => {
  test("metadata-only CRM payloads follow activity in every view and keep truthful provenance", () => {
    const progressing = record({
      status: "interview",
      crm: {
        stage: "preparing",
        stageSource: "activity",
        stageChangedAt: "2026-08-01T10:00:00.000Z",
        tags: ["Priority"],
      },
    });
    expect(inferApplicationCrmStageForView(progressing)).toBe("interview");
    expect(applicationCrmDataForView(progressing)).toMatchObject({
      stage: "interview",
      tags: ["Priority"],
      stageSource: "activity",
    });
    expect(applicationCrmStageProvenanceForView(progressing)).toBe(
      "From your activity",
    );
    expect(
      groupApplicationRecordsByStage([progressing]).get("interview"),
    ).toHaveLength(1);
    const chosen = record({
      ...progressing,
      crm: { ...progressing.crm, stageSource: "user" },
    });
    expect(inferApplicationCrmStageForView(chosen)).toBe("preparing");
    expect(applicationCrmStageProvenanceForView(chosen)).toBe(
      "You recorded this",
    );
  });

  test("distinguishes compatibility-inferred stages from CRM stages", () => {
    const legacyRecord = record();
    const explicitRecord = record({
      crm: {
        stage: "applied",
        stageChangedAt: "2026-08-15T10:00:00.000Z",
      },
    });

    expect(inferApplicationCrmStageForView(legacyRecord)).toBe("applied");
    // Implementation vocabulary stays out of the cell; provenance keeps its
    // own plain-language badge.
    expect(applicationCrmStageLabelForView(legacyRecord)).toBe("Applied");
    expect(applicationCrmStageProvenanceForView(legacyRecord)).toBe(
      "From your activity",
    );
    // Same stage name either way; provenance is its own badge.
    expect(applicationCrmStageLabelForView(explicitRecord)).toBe("Applied");
    expect(applicationCrmStageProvenanceForView(explicitRecord)).toBe(
      "You recorded this",
    );
    expect(APPLICATION_CRM_STAGE_LABELS.applied).toBe("Applied");
    expect(APPLICATION_CRM_STAGE_LABELS.interview).toBe("Interview");
    expect(legacyRecord.crm).toBeNull();
  });

  test("never reports a paused, blocked application as ready for approval", () => {
    // The Stages tab said "Ready for approval" while the Preparation tab said
    // Needs you about the very same application.
    const pausedRecord = record({
      status: "approved",
      lastAttemptState: "paused",
      latestBlocker: {
        code: "requires_manual_review",
        summary: "The application page could not safely save a prepared field.",
      },
    });

    expect(inferApplicationCrmStageForView(pausedRecord)).toBe("preparing");
    expect(applicationCrmStageLabelForView(pausedRecord)).toBe("Preparing");
  });

  test("groups records into all lifecycle columns", () => {
    const grouped = groupApplicationRecordsByStage([
      record(),
      record({ id: "application_2", jobId: "job_2", status: "interview" }),
    ]);
    expect(grouped.get("applied")).toHaveLength(1);
    expect(grouped.get("interview")).toHaveLength(1);
    expect(grouped.has("no_response")).toBe(true);
  });

  test.each([
    "submitted",
    "interview",
    "offer",
    "rejected",
    "withdrawn",
  ] as const)("keeps %s ahead of a stale preparation blocker", (status) => {
    expect(
      inferApplicationCrmStageForView(
        record({
          status,
          lastAttemptState: "paused",
          latestBlocker: {
            code: "requires_manual_review",
            summary: "Old preparation handoff.",
          },
        }),
      ),
    ).toBe(status === "submitted" ? "applied" : status);
  });

  test("projects reminders, interviews, and offer deadlines", () => {
    const entries = buildApplicationCrmCalendarForView([
      record({
        crm: {
          stage: "offer",
          stageChangedAt: "2026-08-15T10:00:00.000Z",
          reminders: [
            {
              id: "reminder_1",
              title: "Follow up",
              dueAt: "2026-08-16T10:00:00.000Z",
              createdAt: "2026-08-15T10:00:00.000Z",
              updatedAt: "2026-08-15T10:00:00.000Z",
            },
          ],
          interviews: [
            {
              id: "interview_1",
              title: "Technical interview",
              startsAt: "2026-08-17T10:00:00.000Z",
              createdAt: "2026-08-15T10:00:00.000Z",
              updatedAt: "2026-08-15T10:00:00.000Z",
            },
          ],
          compensation: {
            offerDeadlineAt: "2026-08-18T10:00:00.000Z",
            offerStatus: "active",
          },
        },
      }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "reminder",
      "interview",
      "offer_deadline",
    ]);
  });
});
