import { describe, expect, it } from "vitest";
import { deviceTimeZone } from "../../lib/job-finder-timestamp-format";
import {
  formatTrackerMoment,
  trackerTimeToIso,
  trackerTimeZones,
  searchableTrackerTimeZones,
  trackerTimeZoneLabel,
} from "./applications-tracker-time";

describe("interview time zones", () => {
  it.each([
    ["America/New_York", "2026-10-05T09:00", "2026-10-05T13:00:00.000Z"],
    ["Europe/London", "2026-10-05T09:00", "2026-10-05T08:00:00.000Z"],
    ["Europe/Lisbon", "2026-10-05T09:00", "2026-10-05T08:00:00.000Z"],
    ["Asia/Kathmandu", "2026-10-05T09:00", "2026-10-05T03:15:00.000Z"],
    ["Europe/London", "2026-12-05T09:00", "2026-12-05T09:00:00.000Z"],
  ])("stores %s clock time as an exact instant", (zone, clock, instant) => {
    expect(trackerTimeToIso(clock, zone)).toBe(instant);
  });
  it("rejects nonexistent times and picks the first occurrence of a repeated time", () => {
    expect(trackerTimeToIso("2026-03-29T01:30", "Europe/London")).toBeNull();
    expect(trackerTimeToIso("2026-10-25T01:30", "Europe/London")).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(trackerTimeToIso("2026-02-30T09:00", "UTC")).toBeNull();
  });
  it("names only the chosen clock", () => {
    const zone =
      deviceTimeZone() === "America/New_York"
        ? "Europe/London"
        : "America/New_York";
    const at = "2026-10-05T13:00:00.000Z";
    expect(formatTrackerMoment(at, zone)).toContain(zone);
    expect(formatTrackerMoment(at, deviceTimeZone())).not.toContain("[");
    expect(trackerTimeZones()).toContain(deviceTimeZone());
    expect(trackerTimeZones()).toContain("Europe/London");
  });
});

it("a Los Angeles pause covers the Los Angeles run and city search finds London", () => {
  const starts = trackerTimeToIso("2026-10-05T07:30", "America/Los_Angeles")!;
  const ends = trackerTimeToIso("2026-10-05T09:00", "America/Los_Angeles")!;
  const run = trackerTimeToIso("2026-10-05T08:00", "America/Los_Angeles")!;
  expect(Date.parse(starts)).toBeLessThan(Date.parse(run));
  expect(Date.parse(ends)).toBeGreaterThan(Date.parse(run));
  expect(searchableTrackerTimeZones("London", "Europe/Lisbon")).toEqual([
    "Europe/London",
  ]);
  expect(trackerTimeZoneLabel("Europe/London")).toMatch(/GMT/);
});
