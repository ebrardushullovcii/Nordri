// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import {
  ResumeDraftBulletSchema,
  ResumeDraftEntrySchema,
  ResumeDraftSchema,
  ResumeDraftSectionSchema,
  type ResumeDraft,
  type ResumeDraftBullet,
  type ResumeDraftEntry,
  type ResumeDraftSection,
  type ResumeDraftSourceRef,
} from "@nordri/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildResumeJobKeywordEvidence,
  ResumeJobKeywordEvidencePanel,
  type ResumeKeywordEvidenceJob,
} from "./resume-job-keyword-evidence";

const updatedAt = "2026-04-27T00:00:00.000Z";

function createSourceRef(
  sourceKind: ResumeDraftSourceRef["sourceKind"],
  snippet: string,
): ResumeDraftSourceRef {
  return {
    id: `${sourceKind}_evidence`,
    sourceKind,
    sourceId: `${sourceKind}_1`,
    snippet,
  };
}

function createBullet(
  id: string,
  text: string,
  sourceRefs: readonly ResumeDraftSourceRef[] = [],
): ResumeDraftBullet {
  return ResumeDraftBulletSchema.parse({
    id,
    text,
    origin: "imported",
    sourceRefs,
    updatedAt,
  });
}

function createSection(
  overrides: Partial<ResumeDraftSection> = {},
): ResumeDraftSection {
  return ResumeDraftSectionSchema.parse({
    id: "section_summary",
    kind: "summary",
    label: "Summary",
    origin: "imported",
    sortOrder: 0,
    updatedAt,
    ...overrides,
  });
}

function createEntry(
  overrides: Partial<ResumeDraftEntry> = {},
): ResumeDraftEntry {
  return ResumeDraftEntrySchema.parse({
    id: "entry_1",
    entryType: "experience",
    origin: "imported",
    sortOrder: 0,
    updatedAt,
    ...overrides,
  });
}

function createDraft(overrides: Partial<ResumeDraft> = {}): ResumeDraft {
  return ResumeDraftSchema.parse({
    id: "draft_1",
    jobId: "job_1",
    status: "draft",
    templateId: "classic_ats",
    identity: null,
    sections: [],
    targetPageCount: 2,
    generationMethod: "manual",
    approvedAt: null,
    approvedExportId: null,
    staleReason: null,
    workHistoryReviewAcknowledgments: [],
    claimConfirmations: [],
    issueApprovals: [],
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  });
}

function createJob(
  overrides: Partial<ResumeKeywordEvidenceJob> = {},
): ResumeKeywordEvidenceJob {
  return {
    title: "Senior Frontend Engineer",
    keySkills: ["React", "TypeScript"],
    keywordSignals: [],
    minimumQualifications: [],
    ...overrides,
  };
}

afterEach(cleanup);

function renderedSupportedKeywords(): HTMLElement {
  const supported = document.querySelector("[data-resume-supported-keywords]");
  if (!(supported instanceof HTMLElement)) {
    throw new Error("Expected the supported-keywords panel to render.");
  }
  return supported;
}

function renderedMissingKeywords(): HTMLElement {
  const missing = document.querySelector("[data-resume-missing-keywords]");
  if (!(missing instanceof HTMLElement)) {
    throw new Error("Expected the missing-keywords panel to render.");
  }
  return missing;
}

describe("ResumeJobKeywordEvidencePanel", () => {
  it("marks explicit job terms supported only when candidate source evidence matches", () => {
    const draft = createDraft({
      sections: [
        createSection({
          sourceRefs: [
            createSourceRef(
              "profile",
              "Built React and TypeScript interfaces for workflow teams.",
            ),
          ],
        }),
      ],
    });

    const items = buildResumeJobKeywordEvidence({
      draft,
      job: createJob(),
    });

    expect(items).toEqual([
      expect.objectContaining({
        evidence: "Built React and TypeScript interfaces for workflow teams.",
        sourceLabel: "Saved profile",
        status: "supported",
        term: "React",
      }),
      expect.objectContaining({
        status: "supported",
        term: "TypeScript",
      }),
    ]);

    const rendered = render(
      <ResumeJobKeywordEvidencePanel draft={draft} job={createJob()} />,
    );

    const supported = rendered.container.querySelector(
      "[data-resume-supported-keywords]",
    );
    if (!(supported instanceof HTMLElement)) {
      throw new Error("Expected the supported-keywords panel to render.");
    }
    expect(within(supported).getByText("React")).toBeTruthy();
    expect(within(supported).getByText("TypeScript")).toBeTruthy();
    expect(screen.getByText("2 supported")).toBeTruthy();
    expect(screen.getByText("0 not evidenced")).toBeTruthy();
    expect(supported.textContent).toContain("Saved profile:");
  });

  it("uses visible content from a profile-backed structured entry without resume text", () => {
    const draft = createDraft({
      sections: [
        createSection({
          kind: "experience",
          label: "Experience",
          entries: [
            createEntry({
              title: "React Engineer",
              subtitle: "Acme Labs",
              summary: "Built TypeScript interfaces for workflow teams.",
              profileRecordId: "experience_profile_only",
            }),
          ],
        }),
      ],
    });

    expect(buildResumeJobKeywordEvidence({ draft, job: createJob() })).toEqual([
      expect.objectContaining({
        evidence:
          "React Engineer — Acme Labs — Built TypeScript interfaces for workflow teams.",
        sourceLabel: "Saved profile",
        status: "supported",
        term: "React",
      }),
      expect.objectContaining({
        status: "supported",
        term: "TypeScript",
      }),
    ]);

    render(<ResumeJobKeywordEvidencePanel draft={draft} job={createJob()} />);

    const supported = renderedSupportedKeywords();
    expect(within(supported).getByText("React")).toBeTruthy();
    expect(within(supported).getByText("TypeScript")).toBeTruthy();
    expect(supported.textContent).toContain("Saved profile:");
    expect(screen.getByText("2 supported")).toBeTruthy();
  });

  it("does not treat a profile record locator without visible content as evidence", () => {
    const draft = createDraft({
      sections: [
        createSection({
          kind: "experience",
          label: "Experience",
          entries: [
            createEntry({ profileRecordId: "experience_without_content" }),
          ],
        }),
      ],
    });
    const job = createJob({ keySkills: ["React"] });

    expect(buildResumeJobKeywordEvidence({ draft, job })).toEqual([
      expect.objectContaining({
        evidence: null,
        sourceLabel: null,
        status: "not_evidenced",
        term: "React",
      }),
    ]);

    render(<ResumeJobKeywordEvidencePanel draft={draft} job={job} />);

    const missing = renderedMissingKeywords();
    expect(within(missing).getByText("React")).toBeTruthy();
    expect(screen.getByText("0 supported")).toBeTruthy();
    expect(screen.getByText("1 not evidenced")).toBeTruthy();
  });

  it("keeps requested terms without candidate evidence in the not-evidenced list", () => {
    const draft = createDraft({
      sections: [
        createSection({
          sourceRefs: [createSourceRef("resume", "Built React interfaces.")],
        }),
      ],
    });

    const rendered = render(
      <ResumeJobKeywordEvidencePanel
        draft={draft}
        job={createJob({ keySkills: ["React", "Kubernetes"] })}
      />,
    );
    const missing = rendered.container.querySelector(
      "[data-resume-missing-keywords]",
    );
    if (!(missing instanceof HTMLElement)) {
      throw new Error("Expected the missing-keywords panel to render.");
    }
    expect(within(missing).getByText("Kubernetes")).toBeTruthy();
    expect(within(missing).getByText("Not evidenced")).toBeTruthy();
    expect(screen.getByText("1 supported")).toBeTruthy();
    expect(screen.getByText("1 not evidenced")).toBeTruthy();
    expect(
      screen.getByText(
        "Keep these terms out unless you can add truthful support from your own experience.",
      ),
    ).toBeTruthy();
  });

  it("does not use a hidden targeted-keyword section as candidate evidence", () => {
    const hiddenTargetedSection = createSection({
      id: "section_keywords",
      kind: "keywords",
      label: "Targeted Keywords",
      included: false,
      bullets: [
        createBullet("keyword_kubernetes", "Kubernetes", [
          createSourceRef("resume", "Kubernetes"),
        ]),
      ],
    });
    const draft = createDraft({ sections: [hiddenTargetedSection] });

    const items = buildResumeJobKeywordEvidence({
      draft,
      job: createJob({ keySkills: [] }),
    });

    expect(items).toEqual([
      expect.objectContaining({
        evidence: null,
        sourceLabel: null,
        status: "not_evidenced",
        term: "Kubernetes",
      }),
    ]);

    const rendered = render(
      <ResumeJobKeywordEvidencePanel
        draft={draft}
        job={createJob({ keySkills: [] })}
      />,
    );

    expect(
      within(
        rendered.container.querySelector(
          "[data-resume-supported-keywords]",
        ) as HTMLElement,
      ).queryByText("Kubernetes"),
    ).toBeNull();
    expect(
      within(
        rendered.container.querySelector(
          "[data-resume-missing-keywords]",
        ) as HTMLElement,
      ).getByText("Kubernetes"),
    ).toBeTruthy();
  });

  it("discloses fallback output as review-only and keeps the panel non-mutating", () => {
    const draft = createDraft({
      sections: [
        createSection({
          sourceRefs: [createSourceRef("resume", "React delivery work.")],
        }),
      ],
    });

    const rendered = render(
      <ResumeJobKeywordEvidencePanel
        draft={draft}
        fallbackMessage="The AI resume draft timed out, so Job Finder used the built-in fallback."
        job={createJob({ keySkills: ["React"] })}
      />,
    );

    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "This draft needs a factual review before approval.",
    );
    expect(note.textContent).toContain(
      "The keyword list is a review aid only; it does not add evidence or prove that a term is true.",
    );
    expect(rendered.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("discloses a needs-review draft even without a fallback note", () => {
    const draft = createDraft({
      status: "needs_review",
      sections: [
        createSection({
          sourceRefs: [createSourceRef("profile", "React delivery work.")],
        }),
      ],
    });

    render(<ResumeJobKeywordEvidencePanel draft={draft} job={createJob()} />);

    expect(screen.getByRole("note").textContent).toContain("before approval");
  });

  it("stays absent when a job has no explicit keyword signals", () => {
    const draft = createDraft({
      sections: [
        createSection({
          sourceRefs: [
            createSourceRef("resume", "Five years of React experience."),
          ],
        }),
      ],
    });
    const job = createJob({
      keySkills: [],
      keywordSignals: [],
      minimumQualifications: ["Five years of React experience."],
    });

    expect(buildResumeJobKeywordEvidence({ draft, job })).toEqual([]);
    const rendered = render(
      <ResumeJobKeywordEvidencePanel draft={draft} job={job} />,
    );
    expect(rendered.container.firstElementChild).toBeNull();
  });

  it("associates the named region with its visible heading and description", () => {
    const draft = createDraft({
      sections: [
        createSection({
          sourceRefs: [createSourceRef("profile", "React delivery work.")],
        }),
      ],
    });

    const rendered = render(
      <ResumeJobKeywordEvidencePanel draft={draft} job={createJob()} />,
    );
    const panel = rendered.getByRole("region", {
      name: "Job keywords and evidence",
    });
    const headingId = panel.getAttribute("aria-labelledby");
    const descriptionId = panel.getAttribute("aria-describedby");

    expect(headingId).toBeTruthy();
    expect(descriptionId).toBeTruthy();
    expect(
      headingId ? document.getElementById(headingId) : null,
    ).toHaveProperty("textContent", "Job keywords and evidence");
    expect(
      descriptionId ? document.getElementById(descriptionId) : null,
    ).toHaveProperty(
      "textContent",
      expect.stringContaining("A missing term is not added to the draft."),
    );
  });
});
