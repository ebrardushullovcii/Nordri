import {
  deviceTimeZone,
  resolvePlanTimeZone,
} from "../../lib/job-finder-timestamp-format";

export function trackerTimeZones(): readonly string[] {
  return [
    ...new Set([
      deviceTimeZone(),
      "UTC",
      ...((
        Intl as typeof Intl & {
          supportedValuesOf?: (key: "timeZone") => string[];
        }
      ).supportedValuesOf?.("timeZone") ?? []),
    ]),
  ];
}

export function trackerTimeInputValue(
  instant: number,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Resolve the entered clock time against the zone's offsets, including DST. */
export function trackerTimeToIso(
  value: string,
  timeZone: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const clock = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(clock)) return null;
  const candidates = new Set<number>();
  for (const days of [-2, -1, 0, 1, 2]) {
    const sample = clock + days * 86400000;
    const offset =
      Date.parse(`${trackerTimeInputValue(sample, timeZone)}:00Z`) - sample;
    const instant = clock - offset;
    if (trackerTimeInputValue(instant, timeZone) === value)
      candidates.add(instant);
  }
  // A repeated autumn time uses its first occurrence. A spring gap is refused.
  return candidates.size
    ? new Date(Math.min(...candidates)).toISOString()
    : null;
}

export function formatTrackerMoment(
  value: string,
  timeZone?: string | null,
): string {
  const zone = resolvePlanTimeZone(timeZone);
  const format = (timeZone: string) =>
    new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
  return `${format(zone)} (${zone})`;
}

export function searchableTrackerTimeZones(
  query: string,
  homeZone: string,
): readonly string[] {
  const search = query.trim().toLocaleLowerCase().replaceAll(" ", "_");
  return [
    ...new Set([
      homeZone,
      "Europe/London",
      "Europe/Lisbon",
      "America/New_York",
      "America/Los_Angeles",
      ...trackerTimeZones(),
    ]),
  ].filter((zone) => zone.toLocaleLowerCase().includes(search));
}

export function trackerTimeZoneLabel(zone: string): string {
  const offset = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  return `${zone} · ${offset ?? zone}`;
}

/** Compact table cells; the column names the zone once. */
export function formatTrackerCell(
  value: string,
  timeZone?: string | null,
): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: resolvePlanTimeZone(timeZone),
  });
}
