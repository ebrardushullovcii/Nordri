import {
  parseToolArguments,
  type AgentLoopTool,
} from "@nordri/agent-runtime";
import type { JobPosting } from "@nordri/contracts";

/** The model selects existing records; it cannot invent or rewrite feed jobs. */
export function createSearchCatalogTools(input: {
  jobs: readonly JobPosting[];
  keep: (job: JobPosting) => boolean;
  checkpoint: () => Promise<void>;
}): AgentLoopTool[] {
  const readIds = new Set<number>();
  const offsetOf = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  const indexed = input.jobs.map((job, id) => ({ job, id }));
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "list_catalog_jobs",
          description:
            "Read 25 jobs from the site's public feed without opening each page. Page with the returned nextOffset. Use sort=recent to see known posting dates first; missing dates remain unknown. This does not save jobs.",
          parameters: {
            type: "object",
            properties: {
              offset: { type: "integer", minimum: 0 },
              sort: { type: "string", enum: ["source", "recent"] },
            },
          },
        },
      },
      execute: (raw, context) => {
        context.signal?.throwIfAborted();
        const args = parseToolArguments(raw);
        const offset = offsetOf(args.offset);
        const rows =
          args.sort === "recent"
            ? [...indexed].sort((a, b) => {
                const time = (job: JobPosting) => {
                  const parsed = Date.parse(job.postedAt ?? "");
                  return Number.isFinite(parsed) ? parsed : 0;
                };
                return time(b.job) - time(a.job) || a.id - b.id;
              })
            : indexed;
        const page = rows.slice(offset, offset + 25);
        page.forEach(({ id }) => readIds.add(id));
        return Promise.resolve({
          kind: "ok",
          content: JSON.stringify({
            total: rows.length,
            nextOffset:
              offset + page.length < rows.length ? offset + page.length : null,
            jobs: page.map(({ id, job }) => ({
              id,
              title: job.title,
              company: job.company,
              location: job.location,
              workMode: job.workMode,
              postedAt: job.postedAt,
              postedAtText: job.postedAtText,
              providerUpdatedAt: job.providerUpdatedAt,
              summary: (job.summary ?? job.description).slice(0, 400),
            })),
          }),
          progress: page.length > 0,
        });
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "read_catalog_job",
          description:
            "Read an existing catalog job's facts and up to 12,000 characters of its description. Continue with nextOffset when needed. This does not save the job.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "integer", minimum: 0 },
              offset: { type: "integer", minimum: 0 },
            },
            required: ["id"],
          },
        },
      },
      execute: (raw, context) => {
        context.signal?.throwIfAborted();
        const args = parseToolArguments(raw);
        const id = args.id;
        const job =
          typeof id === "number" && Number.isSafeInteger(id)
            ? input.jobs[id]
            : undefined;
        if (!job)
          return Promise.resolve({
            kind: "ok",
            content: "Unknown catalog id. Read list_catalog_jobs first.",
          });
        readIds.add(id as number);
        const offset = offsetOf(args.offset);
        return Promise.resolve({
          kind: "ok",
          content: JSON.stringify({
            id,
            title: job.title,
            company: job.company,
            location: job.location,
            workMode: job.workMode,
            canonicalUrl: job.canonicalUrl,
            postedAt: job.postedAt,
            postedAtText: job.postedAtText,
            providerUpdatedAt: job.providerUpdatedAt,
            salaryText: job.salaryText,
            description: job.description.slice(offset, offset + 12_000),
            nextOffset:
              offset + 12_000 < job.description.length ? offset + 12_000 : null,
          }),
          progress: true,
        });
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "save_catalog_jobs",
          description:
            "Save up to 100 catalog ids you have read and judged suitable for this search. Choose by the person's goal and search preferences. Existing saved jobs are not duplicated.",
          parameters: {
            type: "object",
            properties: {
              ids: {
                type: "array",
                items: { type: "integer", minimum: 0 },
                maxItems: 100,
              },
            },
            required: ["ids"],
          },
        },
      },
      execute: async (raw, context) => {
        context.signal?.throwIfAborted();
        const ids = parseToolArguments(raw).ids;
        const validIds = Array.isArray(ids)
          ? ids.filter(
              (id: unknown): id is number =>
                typeof id === "number" &&
                Number.isSafeInteger(id) &&
                Boolean(input.jobs[id]) &&
                readIds.has(id),
            )
          : [];
        if (
          !Array.isArray(ids) ||
          ids.length > 100 ||
          validIds.length !== ids.length
        ) {
          return {
            kind: "ok",
            content:
              "No jobs saved. Supply at most 100 valid catalog ids you have read with list_catalog_jobs or read_catalog_job.",
          };
        }
        let added = 0;
        for (const id of new Set(validIds)) {
          const job = input.jobs[id];
          if (job && input.keep(job)) added += 1;
        }
        if (added) await input.checkpoint();
        return {
          kind: "ok",
          content: `Saved ${added} new catalog jobs.`,
          progress: added > 0,
        };
      },
    },
  ];
}
