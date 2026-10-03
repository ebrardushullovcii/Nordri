import type { CandidateReusableAnswer } from "@nordri/contracts";

import { normalizeSignal } from "./control-classification";
import type {
  ApplyAnswer,
  ApplyAnswerSources,
  ApplyFormControl,
} from "./types";

/**
 * The person's facts for one application, as the model reads them (ADR 0041).
 *
 * The model gets everything Job Finder knows about the person in one place and
 * answers the form from it; no rule picks an answer per field. Pay is left out
 * when the person keeps it to themselves, so it is never on hand to type.
 */
export function applicationFacts(
  sources: ApplyAnswerSources,
  options: { payDisclosed: boolean },
) {
  const profile = sources.profile;
  const answerBank = { ...profile.answerBank };
  if (!options.payDisclosed) {
    answerBank.salaryExpectations = null;
  }
  return {
    name: {
      full: profile.fullName,
      first: profile.firstName,
      middle: profile.middleName,
      last: profile.lastName,
      preferred: profile.preferredDisplayName,
    },
    email: profile.applicationIdentity.preferredEmail ?? profile.email,
    secondaryEmail: profile.secondaryEmail,
    phone: profile.applicationIdentity.preferredPhone ?? profile.phone,
    location: {
      current: profile.currentLocation,
      city: profile.currentCity,
      region: profile.currentRegion,
      country: profile.currentCountry,
      timeZone: profile.timeZone,
    },
    links: {
      professionalProfile: profile.linkedinUrl,
      codeProfile: profile.githubUrl,
      portfolio: profile.portfolioUrl,
      website: profile.personalWebsiteUrl,
      other: profile.links,
    },
    headline: profile.headline,
    yearsExperience: profile.yearsExperience,
    workEligibility: profile.workEligibility,
    answers: answerBank,
    savedAnswers: sources.reusableAnswers.map((saved) => ({
      question: saved.question,
      answer: saved.answer,
    })),
    spokenLanguages: profile.spokenLanguages,
    skills: profile.skills,
    experiences: profile.experiences.filter((entry) => entry.isDraft !== true),
    education: profile.education.filter((entry) => entry.isDraft !== true),
    certifications: profile.certifications,
    projects: profile.projects,
  };
}

interface StoredFact {
  value: string;
  sourceKind: ApplyAnswer["sourceKind"];
  sourceId: string;
  provenanceLabel: string;
}

const YES_NO = new Set(["yes", "no", "y", "n", "true", "false"]);

/**
 * Whether a value is distinctive enough that typing it can only mean that
 * fact: an email address, a phone number, a link, a name, a saved sentence.
 * "Yes", "No" and short numbers could answer anything, so they are always
 * read by the fact check with their question.
 */
function isDistinctive(value: string): boolean {
  const normalized = normalizeSignal(value);
  if (normalized.length < 3 || YES_NO.has(normalized)) return false;
  if (/^\d+$/u.test(normalized.replace(/\s+/gu, "")))
    return normalized.replace(/\s+/gu, "").length >= 7;
  return true;
}

function storedFacts(
  sources: ApplyAnswerSources,
  options: { payDisclosed: boolean },
): StoredFact[] {
  const profile = sources.profile;
  const facts: StoredFact[] = [];
  const add = (
    value: string | null | undefined,
    sourceId: string,
    provenanceLabel: string,
    sourceKind: ApplyAnswer["sourceKind"] = "profile",
  ) => {
    const trimmed = value?.trim();
    if (trimmed && isDistinctive(trimmed)) {
      facts.push({ value: trimmed, sourceKind, sourceId, provenanceLabel });
    }
  };
  add(profile.fullName, "profile.fullName", "your name");
  add(profile.firstName, "profile.firstName", "your first name");
  add(profile.middleName, "profile.middleName", "your middle name");
  add(profile.lastName, "profile.lastName", "your last name");
  add(
    profile.preferredDisplayName,
    "profile.preferredDisplayName",
    "the name you go by",
  );
  add(
    profile.applicationIdentity.preferredEmail ?? profile.email,
    "profile.email",
    "your email address",
  );
  add(profile.secondaryEmail, "profile.secondaryEmail", "your other email");
  add(
    profile.applicationIdentity.preferredPhone ?? profile.phone,
    "profile.phone",
    "your phone number",
  );
  add(profile.currentLocation, "profile.currentLocation", "where you live");
  add(profile.currentCity, "profile.currentCity", "your city");
  add(profile.currentRegion, "profile.currentRegion", "your region");
  add(
    profile.currentCountry,
    "profile.currentCountry",
    "the country you live in",
  );
  add(profile.linkedinUrl, "profile.linkedinUrl", "your professional profile link");
  add(profile.githubUrl, "profile.githubUrl", "your code profile link");
  add(profile.portfolioUrl, "profile.portfolioUrl", "your portfolio");
  add(profile.personalWebsiteUrl, "profile.personalWebsiteUrl", "your website");
  for (const link of profile.links) {
    add(link.url, `profile.links.${link.id}`, "a link on your profile");
  }
  const bank = profile.answerBank;
  const bankEntries: Array<[string | null, string, string]> = [
    [
      bank.workAuthorization,
      "workAuthorization",
      "your work authorization answer",
    ],
    [bank.visaSponsorship, "visaSponsorship", "your sponsorship answer"],
    [bank.relocation, "relocation", "your relocation answer"],
    [bank.travel, "travel", "your travel answer"],
    [bank.noticePeriod, "noticePeriod", "your notice period"],
    [bank.availability, "availability", "when you can start"],
    [bank.selfIntroduction, "selfIntroduction", "your introduction"],
    [bank.careerTransition, "careerTransition", "your career change answer"],
    [
      options.payDisclosed ? bank.salaryExpectations : null,
      "salaryExpectations",
      "your saved pay answer",
    ],
  ];
  for (const [value, key, label] of bankEntries) {
    add(value, `profile.answerBank.${key}`, label);
  }
  for (const saved of sources.reusableAnswers) {
    add(
      saved.answer,
      `answerLibrary.${saved.id}`,
      "your saved answer",
      "answer_library",
    );
  }
  return facts;
}

/**
 * The stored fact a proposed value is, word for word, when it is one. Such a
 * value goes in as that fact without a fact check; anything else is checked.
 */
export function storedFactFor(input: {
  sources: ApplyAnswerSources;
  payDisclosed: boolean;
  control: ApplyFormControl;
  value: string;
}): ApplyAnswer | null {
  const wanted = normalizeSignal(input.value);
  if (!wanted || !isDistinctive(input.value)) return null;
  const fact = storedFacts(input.sources, {
    payDisclosed: input.payDisclosed,
  }).find((candidate) => normalizeSignal(candidate.value) === wanted);
  if (!fact) return null;
  return {
    value: input.value.trim(),
    kind: input.control.questionKind,
    sourceKind: fact.sourceKind,
    sourceId: fact.sourceId,
    provenanceLabel: fact.provenanceLabel,
    groundedIn: [fact.provenanceLabel],
  };
}

/**
 * The answer the person saved for this exact question, when there is one.
 * A radio or checkbox group asks its question in the group label.
 */
export function savedAnswerForQuestion(
  control: ApplyFormControl,
  reusableAnswers: readonly CandidateReusableAnswer[],
): CandidateReusableAnswer | null {
  const asked = new Set(
    [control.label, control.groupLabel]
      .map((text) => normalizeSignal(text))
      .filter((text) => text.length > 0),
  );
  return (
    reusableAnswers.find((saved) =>
      asked.has(normalizeSignal(saved.question)),
    ) ?? null
  );
}
