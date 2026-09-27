import { CandidateProfileSchema } from "@unemployed/contracts";
import { describe, expect, test } from "vitest";

import {
  buildCoverLetterRequest,
  coverLetterPolicyAllows,
  coverLetterDeliveryFor,
  detectPostingLanguage,
  isCoverLetterControl,
  looksLikeUsableLetter,
  requiredLetterFileType,
} from "./cover-letter";
import type { ApplyAnswerSources, ApplyFormControl } from "./types";

/**
 * The letter that goes with one application.
 *
 * The rules worth holding: the same request whether the form wants a file or a
 * box, never a language the posting did not ask for, and never a letter with a
 * gap in it where a person was supposed to fill something in.
 */

function control(overrides: Partial<ApplyFormControl> = {}): ApplyFormControl {
  return {
    ref: "c0",
    kind: "long_text",
    label: "",
    groupLabel: "",
    placeholder: "",
    required: false,
    disabled: false,
    readOnly: false,
    visible: true,
    value: "",
    checked: false,
    options: [],
    selectedOptionLabel: "",
    invalid: false,
    validationMessage: "",
    questionKind: "other",
    answerControlType: "text",
    attestationKind: null,
    answered: false,
    ...overrides,
  };
}

function sources(description: string): ApplyAnswerSources {
  return {
    profile: CandidateProfileSchema.parse({
      id: "candidate_test",
      firstName: "Robin",
      lastName: "Ashford",
      fullName: "Robin Ashford",
      headline: "Platform engineer",
      summary: "Builds dependable internal tools.",
      currentLocation: "Manchester",
      yearsExperience: 8,
      baseResume: {
        id: "resume_test",
        fileName: "resume.txt",
        uploadedAt: "2026-09-01T09:00:00.000Z",
        textContent: "Resume",
        textUpdatedAt: "2026-09-01T09:00:00.000Z",
        extractionStatus: "ready",
      },
    }),
    resumeText: "Robin Ashford. 8 years of platform engineering.",
    posting: {
      title: "Platform Engineer",
      company: "Northwind Tools",
      location: "Manchester",
      description,
    },
    reusableAnswers: [],
    documents: [],
  };
}

describe("the letter one application sends", () => {
  test("a file field and a text box are the same request", () => {
    const fileField = control({
      kind: "file",
      label: "Cover letter",
      questionKind: "cover_letter",
    });
    const textBox = control({
      label: "Why do you want to work here?",
      questionKind: "cover_letter",
    });

    expect(isCoverLetterControl(fileField)).toBe(true);
    expect(isCoverLetterControl(textBox)).toBe(true);
    expect(coverLetterDeliveryFor(fileField)).toBe("file");
    expect(coverLetterDeliveryFor(textBox)).toBe("text");
  });

  test("the saved letter policy distinguishes required and optional fields", () => {
    const required = control({ label: "Cover letter", required: true });
    const optional = control({ label: "Cover letter", required: false });

    expect(coverLetterPolicyAllows(required, "when_required")).toBe(true);
    expect(coverLetterPolicyAllows(optional, "when_required")).toBe(false);
    expect(coverLetterPolicyAllows(optional, "when_possible")).toBe(true);
    expect(coverLetterPolicyAllows(required, "never")).toBe(false);
  });

  test("a form that names one file type is taken at its word", () => {
    expect(
      requiredLetterFileType(
        control({ kind: "file", label: "Cover letter (PDF only)" }),
      ),
    ).toBe("pdf");
    expect(
      requiredLetterFileType(
        control({ kind: "file", label: "Cover letter (Word document)" }),
      ),
    ).toBe("docx");
    // Offered a choice, the form is left to decide nothing.
    expect(
      requiredLetterFileType(
        control({ kind: "file", label: "Cover letter (PDF or DOCX)" }),
      ),
    ).toBeNull();
  });

  test("the posting's language is followed, and only when it is clear", () => {
    expect(
      detectPostingLanguage(
        "Wir suchen eine Person mit Erfahrung und Freude an der Arbeit mit uns bei einem Team das fur Qualitat steht und das Produkt",
      ),
    ).toBe("German");
    expect(detectPostingLanguage("Own the internal platform.")).toBeNull();
  });

  test("a saved preference overrides the posting's language", () => {
    const request = buildCoverLetterRequest({
      sources: sources(
        "Wir suchen eine Person und wir arbeiten mit einem Team fur das Produkt",
      ),
      preference: {
        tone: "plain_professional",
        length: "standard",
        language: "English",
        sample: null,
      },
    });
    expect(request.language).toBe("English");
    expect(request.prompt).toContain("Write it in English.");
  });

  test("the letter is told exactly what it may be built from", () => {
    const request = buildCoverLetterRequest({
      sources: sources("Own the internal platform."),
      preference: {
        tone: "direct",
        length: "short",
        language: null,
        sample: "I have always liked building tools that other people rely on.",
      },
    });

    expect(request.groundedIn.join("\n")).toContain(
      "Resume sent with this application",
    );
    expect(request.groundedIn.join("\n")).toContain("Saved sample letter");
    expect(request.groundedIn.join("\n")).toContain(
      '"headline": "Platform engineer"',
    );
    expect(request.groundedIn.join("\n")).toContain('"yearsExperience": 8');
    expect(request.prompt).toContain("About 120 words");
    expect(request.prompt).toContain("Direct and brief");
    expect(request.prompt).toContain("Match the voice, not the content");
    expect(request.prompt).toContain("Do not state anything else as fact");
    expect(request.prompt).toContain(
      "must be supported by their resume or profile",
    );
    expect(request.prompt).toContain(
      "never turn a job requirement into a claim that the person has done it",
    );
  });

  test("a letter with a gap where a person should have typed is refused", () => {
    const body = "Dear hiring team, ".padEnd(260, "I have built platforms. ");
    expect(looksLikeUsableLetter(body)).toBe(true);
    expect(looksLikeUsableLetter(`${body} [Your name here]`)).toBe(false);
    expect(looksLikeUsableLetter(`${body} {{company}}`)).toBe(false);
    expect(looksLikeUsableLetter("Too short.")).toBe(false);
  });
});
