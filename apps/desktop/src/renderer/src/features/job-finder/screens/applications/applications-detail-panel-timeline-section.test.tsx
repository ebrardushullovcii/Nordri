// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApplicationRecordSchema } from "@nordri/contracts";
import { ApplicationsDetailPanelTimelineSection } from "./applications-detail-panel-timeline-section";
afterEach(cleanup);
it("shows the person's recent send above older unsent activity without mutating history", () => {
  const record = ApplicationRecordSchema.parse({
    id: "application_test",
    jobId: "job_test",
    title: "Engineer",
    company: "Synthetic",
    status: "submitted",
    lastActionLabel: "Sent by you",
    nextActionLabel: null,
    lastUpdatedAt: "2026-10-05T12:00:00Z",
    events: [
      {
        id: "old",
        at: "2026-10-03T12:00:00Z",
        title: "Not sent: choose which applications to send",
        detail: "Choose the jobs.",
        kind: "status_changed",
        emphasis: "neutral",
      },
      {
        id: "new",
        at: "2026-10-05T12:00:00Z",
        title: "You sent this application",
        detail: "The site confirmed receipt.",
        kind: "status_changed",
        emphasis: "neutral",
      },
    ],
  });
  render(<ApplicationsDetailPanelTimelineSection events={record.events} />);
  expect(
    screen
      .getAllByRole("article")
      .map((entry) => entry.querySelector("strong")?.textContent),
  ).toEqual([
    "You sent this application",
    "Not sent: choose which applications to send",
  ]);
  expect(record.events[0]?.id).toBe("old");
});

it("shows an older record's duplicated confirmation once and keeps other history", () => {
  const events = [
    {
      id: "confirmation-one",
      at: "2026-10-05T12:00:00Z",
      title: "Application sent",
      detail: "The site confirmed receipt. Reference: SYN-42.",
      emphasis: "positive" as const,
    },
    {
      id: "confirmation-two",
      at: "2026-10-05T12:00:01Z",
      title: "Submission confirmed",
      detail: "The site confirmed receipt. Reference: SYN-42.",
      emphasis: "positive" as const,
    },
    {
      id: "other",
      at: "2026-10-05T11:00:00Z",
      title: "Prepared",
      detail: "The application was prepared.",
      emphasis: "neutral" as const,
    },
  ];
  render(<ApplicationsDetailPanelTimelineSection events={events} />);
  expect(
    screen.getAllByText("The site confirmed receipt. Reference: SYN-42."),
  ).toHaveLength(1);
  expect(screen.getByText("Activity history (2)")).toBeTruthy();
  expect(events).toHaveLength(3);
});
