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
