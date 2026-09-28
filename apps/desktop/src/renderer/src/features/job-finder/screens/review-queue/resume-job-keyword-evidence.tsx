import type {
  JobPosting,
  ResumeDraft,
  ResumeDraftSourceRef,
} from "@nordri/contracts";
import { useId } from "react";
import { StatusBadge } from "../../components/status-badge";

export type ResumeKeywordEvidenceJob = Pick<
  JobPosting,
  "title" | "keySkills" | "keywordSignals" | "minimumQualifications"
>;

export type ResumeKeywordEvidenceItem = {
  evidence: string | null;
  sourceLabel: string | null;
  status: "supported" | "not_evidenced";
  term: string;
};

type CandidateEvidence = {
  label: string;
  text: string;
};

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim();
}

function containsTerm(text: string, term: string): boolean {
  const normalizedText = normalizeForMatch(text);
  const normalizedTerm = normalizeForMatch(term);
  if (!normalizedText || !normalizedTerm) {
    return false;
  }

  return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
}

function uniqueTerms(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const term = value.trim();
    const normalized = normalizeForMatch(term);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(term);
  }

  return result;
}

function formatSourceLabel(
  sourceKind: ResumeDraftSourceRef["sourceKind"],
): string {
  switch (sourceKind) {
    case "resume":
      return "Imported resume";
    case "profile":
      return "Saved profile";
    default:
      return "Saved profile or resume";
  }
}

function compactEvidenceText(values: readonly (string | null | undefined)[]) {
  return values
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" — ");
}

function collectStructuredProfileEvidence(
  draft: ResumeDraft,
): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];

  for (const section of draft.sections) {
    if (section.kind === "keywords" || !section.included) {
      continue;
    }

    if (section.profileRecordId) {
      const text = compactEvidenceText([
        section.text,
        ...section.bullets
          .filter((bullet) => bullet.included)
          .map((bullet) => bullet.text),
      ]);

      if (text) {
        evidence.push({
          label: "Saved profile",
          text,
        });
      }
    }

    for (const entry of section.entries) {
      if (!entry.profileRecordId || !entry.included) {
        continue;
      }

      const recordLabel = compactEvidenceText([entry.title, entry.subtitle]);
      const text = compactEvidenceText([
        recordLabel,
        entry.summary,
        ...entry.bullets
          .filter((bullet) => bullet.included)
          .map((bullet) => bullet.text),
      ]);

      // A profileRecordId is a locator, not evidence by itself. Only the
      // profile-backed content that is actually visible in this draft can
      // support a keyword here.
      if (text) {
        evidence.push({
          label: "Saved profile",
          text,
        });
      }
    }
  }

  return evidence;
}

function collectCandidateSourceRefs(draft: ResumeDraft): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];

  const addRefs = (sourceRefs: readonly ResumeDraftSourceRef[]) => {
    for (const sourceRef of sourceRefs) {
      if (
        (sourceRef.sourceKind !== "resume" &&
          sourceRef.sourceKind !== "profile") ||
        !sourceRef.snippet?.trim()
      ) {
        continue;
      }

      evidence.push({
        label: formatSourceLabel(sourceRef.sourceKind),
        text: sourceRef.snippet.trim(),
      });
    }
  };

  for (const section of draft.sections) {
    if (section.kind === "keywords") {
      continue;
    }

    addRefs(section.sourceRefs);
    for (const bullet of section.bullets) {
      addRefs(bullet.sourceRefs);
    }
    for (const entry of section.entries) {
      addRefs(entry.sourceRefs);
      for (const bullet of entry.bullets) {
        addRefs(bullet.sourceRefs);
      }
    }
  }

  return [...evidence, ...collectStructuredProfileEvidence(draft)];
}

function collectTargetedKeywords(draft: ResumeDraft): string[] {
  const values: string[] = [];

  for (const section of draft.sections) {
    if (section.kind !== "keywords") {
      continue;
    }

    if (section.text) {
      values.push(section.text);
    }
    values.push(...section.bullets.map((bullet) => bullet.text));
    for (const entry of section.entries) {
      if (entry.title) {
        values.push(entry.title);
      }
      if (entry.summary) {
        values.push(entry.summary);
      }
      values.push(...entry.bullets.map((bullet) => bullet.text));
    }
  }

  return values;
}

function collectJobTerms(
  job: ResumeKeywordEvidenceJob | null | undefined,
  draft: ResumeDraft,
): string[] {
  const terms = [
    ...(job?.keySkills ?? []),
    ...(job?.keywordSignals ?? []).map((signal) => signal.label),
  ];

  // Qualification prose is intentionally not converted into keyword terms.
  // Explicit skills/signals and the saved targeted-keyword section are the
  // bounded request data this review aid can show without keyword stuffing.
  return uniqueTerms([...terms, ...collectTargetedKeywords(draft)]);
}

function shortenEvidence(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 180) {
    return compact;
  }
  return `${compact.slice(0, 177).trimEnd()}…`;
}

export function isResumeDraftThin(draft: ResumeDraft): boolean {
  const includedSections = draft.sections.filter((section) => section.included);
  const includedLineCount = includedSections.reduce((count, section) => {
    const sectionLines = section.text ? 1 : 0;
    const bulletLines = section.bullets.filter(
      (bullet) => bullet.included,
    ).length;
    const entryLines = section.entries
      .filter((entry) => entry.included)
      .reduce(
        (entryCount, entry) =>
          entryCount +
          (entry.title || entry.summary ? 1 : 0) +
          entry.bullets.filter((bullet) => bullet.included).length,
        0,
      );
    return count + sectionLines + bulletLines + entryLines;
  }, 0);
  const hasExperienceContent = includedSections.some(
    (section) =>
      section.kind === "experience" &&
      section.entries.some(
        (entry) =>
          entry.included &&
          Boolean(
            entry.title ||
            entry.summary ||
            entry.bullets.some((bullet) => bullet.included),
          ),
      ),
  );

  return (
    includedLineCount < 5 ||
    !hasExperienceContent ||
    includedSections.length < 2
  );
}

export function buildResumeJobKeywordEvidence(input: {
  draft: ResumeDraft;
  job?: ResumeKeywordEvidenceJob | null | undefined;
}): ResumeKeywordEvidenceItem[] {
  const terms = collectJobTerms(input.job, input.draft);
  if (terms.length === 0) {
    return [];
  }

  const linkedEvidence = collectCandidateSourceRefs(input.draft);

  return terms.map((term) => {
    const match = linkedEvidence.find((candidate) =>
      containsTerm(candidate.text, term),
    );

    return {
      evidence: match ? shortenEvidence(match.text) : null,
      sourceLabel: match?.label ?? null,
      status: match ? "supported" : "not_evidenced",
      term,
    };
  });
}

export function ResumeJobKeywordEvidencePanel(props: {
  draft: ResumeDraft;
  fallbackMessage?: string | null | undefined;
  job?: ResumeKeywordEvidenceJob | null | undefined;
}) {
  const headingId = useId();
  const summaryId = useId();
  const items = buildResumeJobKeywordEvidence({
    draft: props.draft,
    job: props.job,
  });

  if (items.length === 0) {
    return null;
  }

  const supportedItems = items.filter((item) => item.status === "supported");
  const missingItems = items.filter((item) => item.status === "not_evidenced");
  const needsFactualReview =
    Boolean(props.fallbackMessage) ||
    props.draft.generationMethod === "deterministic" ||
    props.draft.status === "needs_review" ||
    isResumeDraftThin(props.draft);

  return (
    <section
      aria-describedby={summaryId}
      aria-labelledby={headingId}
      className="grid gap-3 rounded-(--radius-field) border border-(--surface-panel-border) bg-(--surface-fill-soft) p-3"
      data-resume-job-keyword-evidence
    >
      <div className="grid gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-0.5">
            <h3 className="text-(--text-headline)" id={headingId}>
              Job keywords and evidence
            </h3>
            <p
              className="text-(length:--text-small) leading-5 text-foreground-soft"
              id={summaryId}
            >
              {props.job?.title
                ? `Terms saved from ${props.job.title}.`
                : "Terms saved from this job."}{" "}
              A supported term matches candidate content shown in this draft or
              an imported resume excerpt. A missing term is not added to the
              draft.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* A count of zero is not good news: "0 supported" in the success
                colour, beside a red "1 not evidenced", read as if something
                had passed. Each badge carries its tone only when it has
                something to report. */}
            <StatusBadge
              tone={supportedItems.length > 0 ? "positive" : "muted"}
            >
              {supportedItems.length} supported
            </StatusBadge>
            <StatusBadge tone={missingItems.length > 0 ? "critical" : "muted"}>
              {missingItems.length} not evidenced
            </StatusBadge>
          </div>
        </div>
      </div>

      {needsFactualReview ? (
        <div
          className="rounded-(--radius-field) border border-(--warning-border) bg-(--warning-surface) px-3 py-2 text-(length:--text-small) leading-5 text-(--warning-text)"
          data-resume-keyword-factual-review
          role="note"
        >
          This draft needs a factual review before approval. The keyword list is
          a review aid only; it does not add evidence or prove that a term is
          true.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div
          className="grid content-start gap-2 rounded-(--radius-field) border border-positive/25 bg-positive/5 p-2.5"
          data-resume-supported-keywords
        >
          <div className="grid gap-0.5">
            <h4 className="text-(--text-headline)">
              Supported by candidate content
            </h4>
            <p className="text-(length:--text-small) leading-5 text-foreground-soft">
              These terms match saved profile content shown here or an imported
              resume excerpt.
            </p>
          </div>
          {supportedItems.length > 0 ? (
            <ul className="grid gap-1.5">
              {supportedItems.map((item) => (
                <li
                  className="grid gap-1 rounded-(--radius-field) border border-positive/20 bg-background/45 px-2.5 py-2"
                  key={`supported_${item.term}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-foreground">
                      {item.term}
                    </strong>
                    <StatusBadge tone="positive">Supported</StatusBadge>
                  </div>
                  {item.evidence ? (
                    <p className="text-(length:--text-small) leading-5 text-foreground-soft">
                      <span className="font-medium text-foreground">
                        {item.sourceLabel ?? "Candidate source"}:
                      </span>{" "}
                      {item.evidence}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-(length:--text-small) leading-5 text-foreground-soft">
              No saved candidate content matches these terms yet.
            </p>
          )}
        </div>

        <div
          className="grid content-start gap-2 rounded-(--radius-field) border border-(--warning-border) bg-(--warning-surface)/35 p-2.5"
          data-resume-missing-keywords
        >
          <div className="grid gap-0.5">
            <h4 className="text-(--text-headline)">
              Requested by this job, not evidenced yet
            </h4>
            <p className="text-(length:--text-small) leading-5 text-foreground-soft">
              Keep these terms out unless you can add truthful support from your
              own experience.
            </p>
          </div>
          {missingItems.length > 0 ? (
            <ul className="grid gap-1.5">
              {missingItems.map((item) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-field) border border-(--warning-border) bg-background/45 px-2.5 py-2"
                  key={`missing_${item.term}`}
                >
                  <strong className="text-sm text-foreground">
                    {item.term}
                  </strong>
                  <StatusBadge tone="critical">Not evidenced</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-(length:--text-small) leading-5 text-foreground-soft">
              Every saved job term has a matching candidate source. Review the
              wording before approval.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
