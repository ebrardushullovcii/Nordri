/**
 * Stable posting identity for jobs the search agent saves. These are URL
 * mechanics, not judgments about the page: the model reads the listing, and
 * this only gives the same listing reached twice the same id.
 */

/** The page address without its query or fragment, for display and matching. */
export function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A stable posting id from a URL that carries no explicit id: host and path
 * (plus any id-shaped query values) as one slug. Every extraction path uses
 * this same fallback so the same listing reached twice gets the same id.
 */
function buildPathBasedGenericJobId(parsed: URL): string {
  const interestingParamKeys = [
    "id",
    "job",
    "jobid",
    "job_id",
    "gh_jid",
    "req",
    "reqid",
    "opening",
  ];
  const interestingParams = interestingParamKeys
    .map((key) => parsed.searchParams.get(key))
    .filter((value): value is string => Boolean(value?.trim()))
    .join("_");
  const rawValue = [parsed.hostname, parsed.pathname, interestingParams]
    .filter(Boolean)
    .join("_");

  return rawValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

export function buildGenericJobId(url: string): string {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map(safeDecodeUriComponent);
    const detailId = pathSegments.at(-1);
    const detailRoute = pathSegments.at(-2);
    if (
      detailId &&
      detailRoute &&
      /^(?:jobs?|positions?|openings?|requisitions?|vacanc(?:y|ies))$/iu.test(
        detailRoute,
      )
    ) {
      return detailId.slice(0, 160);
    }
    return buildPathBasedGenericJobId(parsed);
  } catch {
    return url
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 160);
  }
}

/**
 * Replaces only the legacy host-plus-path fallback with the semantic detail
 * route id. Provider-supplied ids stay authoritative.
 */
export function normalizeExtractedJobSourceId<
  T extends { sourceJobId: string; canonicalUrl: string },
>(job: T): T {
  try {
    const parsed = new URL(job.canonicalUrl);
    const legacyFallback = buildPathBasedGenericJobId(parsed);
    const semanticFallback = buildGenericJobId(job.canonicalUrl);
    if (
      job.sourceJobId !== legacyFallback ||
      semanticFallback === legacyFallback
    ) {
      return job;
    }
    return { ...job, sourceJobId: semanticFallback };
  } catch {
    return job;
  }
}
