import type { JobPosting } from "@nordri/contracts";

export function resolvePostingSeniority(
  posting: Pick<JobPosting, "title" | "seniority">,
): string | null {
  return (
    posting.seniority ??
    posting.title.match(
      /^\s*(Junior|Senior|Lead|Intern(?:ship)?|Staff|Principal|Entry[- ]level)\b/iu,
    )?.[1] ??
    null
  );
}
