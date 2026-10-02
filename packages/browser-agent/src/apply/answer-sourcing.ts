import type {
  ApplicationQuestionKind,
  CandidateProfile,
  CandidateReusableAnswer,
} from "@nordri/contracts";

import { normalizeSignal } from "./control-classification";
import {
  isPhoneCountryControl,
  matchPhoneCountryOption,
  resolveCallingCode,
  resolvePhoneCountryHint,
  stripSelectedCallingCode,
} from "./phone-country";
import type {
  ApplyAnswer,
  ApplyAnswerSources,
  ApplyFormControl,
} from "./types";
import {
  judgeWorkCountry,
  namedWorkCountries,
  type WorkCountryVerdict,
} from "./work-country";

/**
 * Where an answer comes from, in the order Job Finder trusts.
 *
 * 1. a fact the person already stated in their profile
 * 2. the resume that goes with this application
 * 3. an answer they saved earlier and reused
 * 4. free text written for this question, grounded in the three above
 *
 * A question none of those can answer is never guessed at: it goes to the
 * Needs you list with the exact wording from the page.
 */

export type ApplyAnswerResolution =
  | { status: "answered"; answer: ApplyAnswer }
  | { status: "map_choice"; context: ApplyAnswer }
  /** Free text the loop may write for this question, grounded in these facts. */
  | { status: "write_free_text"; grounding: string[] }
  /**
   * Nothing stored answers it. `permission` marks the person's own choice to
   * answer this themselves (pay they keep private), which no model answer
   * overrides; otherwise the model may still answer from the person's facts
   * when the fact check supports it.
   */
  | {
      status: "needs_you";
      reason: string;
      suggestion: ApplyAnswer | null;
      permission?: true;
    };

/** The reason given when nothing stored bears on a question at all. */
export const NO_STORED_ANSWER_REASON =
  "Nothing in your profile, resume, or saved answers answers this.";

/**
 * The reason worth showing the person beside the question: one that names
 * what Job Finder did find (for example the countries saved in the profile)
 * and why it does not settle this question. The bare "nothing answers this"
 * adds nothing to the card's own heading, so it is not repeated.
 */
export function personFacingNeedsYouReason(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed !== NO_STORED_ANSWER_REASON
    ? trimmed
    : null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function yesNo(value: boolean | null | undefined): string | null {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}

const OVERALL_YEARS_EXPERIENCE_PATTERN =
  /\byears?\s+(?:of\s+)?(?:(?:professional|work|overall)\s+)?experience\b/u;

function asksForOverallYearsExperience(control: ApplyFormControl): boolean {
  const label = normalizeSignal(control.label);
  const match = OVERALL_YEARS_EXPERIENCE_PATTERN.exec(label);
  if (!match) {
    return false;
  }

  // "Years of experience with Python" asks about Python, not the person's
  // overall career. Never let the generic prefix hide a trailing qualifier.
  const suffix = label.slice(match.index + match[0].length);
  if (/\b(?:with|in|using|on|for)\b/u.test(suffix)) {
    return false;
  }

  const group = normalizeSignal(control.groupLabel);
  if (!group || group === label) {
    return true;
  }
  return (
    OVERALL_YEARS_EXPERIENCE_PATTERN.test(group) ||
    /^(?:professional |work |overall )?(?:experience|background|work history)$/u.test(
      group,
    )
  );
}

function profileAnswer(
  value: string,
  kind: ApplicationQuestionKind,
  sourceId: string,
  provenanceLabel: string,
): ApplyAnswer {
  return {
    value,
    kind,
    sourceKind: "profile",
    sourceId,
    provenanceLabel,
    groundedIn: [provenanceLabel],
  };
}

function technicalSkillsAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const signal = normalizeSignal(`${control.groupLabel} ${control.label}`);
  if (
    (control.kind !== "text" && control.kind !== "long_text") ||
    control.options.length > 0 ||
    control.questionKind === "experience" ||
    /\b(?:how many|years?|duration|never|not|lack|unfamiliar|no experience)\b/u.test(
      signal,
    ) ||
    !/\b(?:(?:which|what) (?:technical )?(?:skills?|technologies|tools)(?: would you bring| do you (?:have|use|know))?|list (?:your )?(?:technical )?(?:skills?|technologies|tools))\b/u.test(
      signal,
    )
  ) {
    return null;
  }
  const seen = new Set<string>();
  const skills = [
    ...profile.skills,
    ...profile.skillGroups.coreSkills,
    ...profile.skillGroups.tools,
    ...profile.skillGroups.languagesAndFrameworks,
    ...profile.skillGroups.highlightedSkills,
  ].filter((skill) => {
    const normalized = normalizeSignal(skill);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  if (skills.length === 0) return null;
  return profileAnswer(
    skills.slice(0, 12).join(", "),
    control.questionKind,
    "profile.skills",
    "the technical skills saved in your profile",
  );
}

function nameFieldAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const signal = normalizeSignal(`${control.label} ${control.groupLabel}`);
  const label = normalizeSignal(control.label);
  const kind: ApplicationQuestionKind = "personal_info";
  if (
    /\b(first|given)\s+name\b/u.test(signal) ||
    /^(first|given)$/u.test(label)
  ) {
    const value = trimmedOrNull(profile.firstName);
    return value
      ? profileAnswer(value, kind, "profile.firstName", "your first name")
      : null;
  }
  if (
    /\b(last|family|sur)\s+name\b/u.test(signal) ||
    /^(last|family|sur)$/u.test(label)
  ) {
    const value = trimmedOrNull(profile.lastName);
    return value
      ? profileAnswer(value, kind, "profile.lastName", "your last name")
      : null;
  }
  if (/\bmiddle\s+name\b/u.test(signal) || label === "middle") {
    const value = trimmedOrNull(profile.middleName);
    return value
      ? profileAnswer(value, kind, "profile.middleName", "your middle name")
      : null;
  }
  if (/\bpreferred(?:\s+(?:full|display))?\s+name\b/u.test(signal)) {
    const value =
      trimmedOrNull(profile.preferredDisplayName) ??
      trimmedOrNull(profile.firstName);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.preferredDisplayName",
          "the name you go by",
        )
      : null;
  }
  if (/\bname\b/u.test(signal)) {
    const value = trimmedOrNull(profile.fullName);
    return value
      ? profileAnswer(value, kind, "profile.fullName", "your name")
      : null;
  }
  return null;
}

function phoneCountryAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const phone =
    trimmedOrNull(profile.applicationIdentity.preferredPhone) ??
    trimmedOrNull(profile.phone);
  if (!phone) {
    return null;
  }
  const countryHint = resolvePhoneCountryHint(profile);
  const callingCode = resolveCallingCode({
    phone,
    countryHint,
    optionLabels: control.options,
  });
  if (!callingCode) {
    return null;
  }
  const option = matchPhoneCountryOption({
    options: control.options,
    callingCode,
    countryHint,
  });
  // Several countries share a calling code. Without an option that names both
  // the code and the country, the picker is left for the person.
  if (control.options.length > 0 && !option) {
    return null;
  }
  return profileAnswer(
    option ?? callingCode,
    "personal_info",
    "profile.phoneCountry",
    "the country your phone number belongs to",
  );
}

function personalInfoAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const signal = normalizeSignal(
    `${control.label} ${control.groupLabel} ${control.placeholder}`,
  );
  if (isPhoneCountryControl(control)) {
    return phoneCountryAnswer(control, profile);
  }
  if (/\bemail\b/u.test(signal)) {
    const value =
      trimmedOrNull(profile.applicationIdentity.preferredEmail) ??
      trimmedOrNull(profile.email);
    return value
      ? profileAnswer(
          value,
          "personal_info",
          "profile.email",
          "your email address",
        )
      : null;
  }
  if (/\b(phone|mobile|telephone|cell)\b/u.test(signal)) {
    const value =
      trimmedOrNull(profile.applicationIdentity.preferredPhone) ??
      trimmedOrNull(profile.phone);
    if (!value) {
      return null;
    }
    // When a picker beside this field already carries the country code, the
    // number must not repeat it, or it goes out dialled twice.
    const withoutCode = stripSelectedCallingCode(
      value,
      control.selectedCallingCode ?? null,
    );
    return profileAnswer(
      withoutCode || value,
      "personal_info",
      "profile.phone",
      "your phone number",
    );
  }
  return nameFieldAnswer(control, profile);
}

function locationAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const addressField = addressFactField(control);
  if (addressField) {
    if (addressField !== "street") return null;
    // currentLocation normally holds a city, not an address. Only use a
    // street line actually written there; never turn the city into one.
    const street = explicitStreetLine(profile.currentLocation);
    return street
      ? profileAnswer(
          street,
          "location",
          "profile.currentLocation",
          "the street address you saved",
        )
      : null;
  }
  const signal = normalizeSignal(
    `${control.label} ${control.groupLabel} ${control.placeholder}`,
  );
  const kind: ApplicationQuestionKind = "location";
  if (/\bcountry\b/u.test(signal)) {
    const value = trimmedOrNull(profile.currentCountry);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.currentCountry",
          "the country you live in",
        )
      : null;
  }
  if (/\b(city|town)\b/u.test(signal)) {
    const value = trimmedOrNull(profile.currentCity);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.currentCity",
          "the city you live in",
        )
      : null;
  }
  if (/\b(state|province|region)\b/u.test(signal)) {
    const value = trimmedOrNull(profile.currentRegion);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.currentRegion",
          "the region you live in",
        )
      : null;
  }
  if (/\b(location|based)\b/u.test(signal)) {
    const value = trimmedOrNull(profile.currentLocation);
    return value
      ? profileAnswer(value, kind, "profile.currentLocation", "where you live")
      : null;
  }
  return null;
}

function addressFactField(
  control: ApplyFormControl,
): "street" | "supplement" | "postal" | null {
  // Use this field's wording, not its surrounding Address group: a postal
  // code, city and street in that group are different facts.
  const signal = normalizeSignal(`${control.label} ${control.placeholder}`);
  if (/\b(?:email|e mail|website|web|url)\b/u.test(signal)) return null;
  if (/\b(?:postal code|post code|postcode|zip(?: code)?)\b/u.test(signal))
    return "postal";
  if (
    /\baddress(?: line)? 2\b|^(?:apartment|suite|unit)(?: number| no)?$/u.test(
      signal,
    )
  )
    return "supplement";
  return /\b(?:street|mailing|residential|home|permanent|current) address\b|\baddress line\b|^(?:your )?(?:address|street)$/u.test(
    signal,
  )
    ? "street"
    : null;
}

function explicitStreetLine(location: string | null): string | null {
  const line = (location ?? "").split(/[,\r\n]/u)[0]?.trim() ?? "";
  // This only recognises a supplied numbered street line. Other address
  // formats remain available through an exact saved answer, without guessing.
  return /^\d+[\p{L}\p{N}/-]*\s+.+\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|place|pl|boulevard|blvd|court|ct|terrace|close)\.?$/iu.test(
    line,
  )
    ? line
    : null;
}

function asksForPostingLocation(control: ApplyFormControl): boolean {
  const signal = normalizeSignal(`${control.label} ${control.placeholder}`);
  const asksForResidence =
    /\b(?:current|home|residential) location\b/u.test(signal) ||
    /\bwhere (?:do you live|are you based)\b/u.test(signal);
  return (
    !asksForResidence &&
    (/(?:^|\b)(?:which|what) location (?:are you |would you be )?applying for\b/u.test(
      signal,
    ) ||
      /\b(?:job|role) location\b/u.test(signal) ||
      /\blocation for this (?:job|role|application)\b/u.test(signal))
  );
}

function postingLocationAnswer(
  control: ApplyFormControl,
  posting: ApplyAnswerSources["posting"],
): ApplyAnswer | null {
  const asksForApplicationLocation = asksForPostingLocation(control);
  const value = trimmedOrNull(posting.location);
  if (!asksForApplicationLocation || !value) {
    return null;
  }
  return {
    value,
    kind: "location",
    sourceKind: "posting",
    sourceId: "posting.location",
    provenanceLabel: "the job posting",
    groundedIn: ["the job posting"],
  };
}

type WorkHistoryField =
  | "companyName"
  | "title"
  | "location"
  | "startDate"
  | "endDate"
  | "summary";

export function workHistoryField(
  control: ApplyFormControl,
): { index: number; field: WorkHistoryField } | null {
  const group = normalizeSignal(control.groupLabel);
  const label = normalizeSignal(control.label);
  const combined = normalizeSignal(`${control.groupLabel} ${control.label}`);
  const indexedGroup =
    /\b(?:work |employment |professional )?(?:experience|history)\s+(\d+)\b/u.exec(
      group || combined,
    );
  const parsedIndex =
    control.workHistoryIndex ??
    (indexedGroup?.[1]
      ? Number.parseInt(indexedGroup[1], 10) - 1
      : /^(?:my |work |employment |professional )?(?:experience|history)$/u.test(
            group,
          )
        ? 0
        : -1);
  if (parsedIndex < 0) {
    return null;
  }

  if (/\b(?:job title|position|role)\b/u.test(label)) {
    return { index: parsedIndex, field: "title" };
  }
  if (/\b(?:company|employer|organization|organisation)\b/u.test(label)) {
    return { index: parsedIndex, field: "companyName" };
  }
  if (/^(?:from|start|start date|started)$/u.test(label)) {
    return { index: parsedIndex, field: "startDate" };
  }
  if (/^(?:to|end|end date|ended)(?: optional)?$/u.test(label)) {
    return { index: parsedIndex, field: "endDate" };
  }
  if (
    /\b(?:description|summary|responsibilities|achievements)\b/u.test(label)
  ) {
    return { index: parsedIndex, field: "summary" };
  }
  if (/\blocation\b/u.test(label)) {
    return { index: parsedIndex, field: "location" };
  }
  return null;
}

// Profile dates may be saved in the person's words. Preserve their precision:
// a known month can fill a month input, but must not invent a day for a date input.
function workHistoryDate(
  value: string | null,
  inputType: ApplyFormControl["dateInputType"],
): string | null {
  const saved = trimmedOrNull(value);
  if (!saved || !inputType) return saved;
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u.exec(saved);
  const named =
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/iu.exec(
      saved,
    );
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const year = iso?.[1] ?? named?.[2];
  const month =
    iso?.[2] ??
    (named?.[1]
      ? String(months.indexOf(named[1].toLowerCase()) + 1).padStart(2, "0")
      : null);
  if (!year || !month || Number(month) < 1 || Number(month) > 12) return null;
  if (inputType === "month") return `${year}-${month}`;
  return iso?.[3] ? saved : null;
}

function workHistoryAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const requested = workHistoryField(control);
  if (!requested) {
    return null;
  }
  const experience = profile.experiences.filter(
    (entry) => entry.isDraft !== true,
  )[requested.index];
  if (!experience) {
    return null;
  }
  const value =
    requested.field === "summary"
      ? trimmedOrNull(
          [experience.summary, ...experience.achievements]
            .filter((entry): entry is string => Boolean(entry?.trim()))
            .join("\n"),
        )
      : requested.field === "startDate" || requested.field === "endDate"
        ? workHistoryDate(experience[requested.field], control.dateInputType)
        : trimmedOrNull(experience[requested.field]);
  return value
    ? profileAnswer(
        value,
        "experience",
        `profile.experiences.${experience.id}.${requested.field}`,
        "your saved work history",
      )
    : null;
}

function linkAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
): ApplyAnswer | null {
  const signal = normalizeSignal(
    `${control.label} ${control.groupLabel} ${control.placeholder}`,
  );
  // A source select often includes an option called "Company website" inside
  // the label text exposed by the page. That option is not a request for the
  // person's portfolio URL; it is one possible answer to how they found the
  // job. Let the exact saved source answer handle this question instead.
  if (/\b(?:how|where) did you (?:hear|learn|find)\b/u.test(signal)) {
    return null;
  }
  const kind: ApplicationQuestionKind = "portfolio";
  const namedLink = profile.links.find((link) => {
    const label = normalizeSignal(link.label ?? "");
    return label.length > 0 && signal.includes(label);
  });
  if (namedLink?.url) {
    return profileAnswer(
      namedLink.url,
      kind,
      `profile.links.${namedLink.id}`,
      "a link on your profile",
    );
  }
  if (/\b(portfolio|personal site|website|home page)\b/u.test(signal)) {
    const value =
      trimmedOrNull(profile.portfolioUrl) ??
      trimmedOrNull(profile.personalWebsiteUrl);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.portfolioUrl",
          "your portfolio link",
        )
      : null;
  }
  if (/\b(repository|repositories|code|source)\b/u.test(signal)) {
    const value = trimmedOrNull(profile.githubUrl);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.codeProfileUrl",
          "your code profile link",
        )
      : null;
  }
  if (/\b(profile|professional network)\b/u.test(signal)) {
    const value = trimmedOrNull(profile.linkedinUrl);
    return value
      ? profileAnswer(
          value,
          kind,
          "profile.professionalProfileUrl",
          "your professional profile link",
        )
      : null;
  }
  return null;
}

/**
 * Whether the saved countries cover the country this question or job is
 * about. Null when the profile lists no countries.
 */
function workCountryVerdict(
  control: ApplyFormControl,
  profile: CandidateProfile,
  posting: ApplyAnswerSources["posting"] | null,
): WorkCountryVerdict | null {
  const countries = profile.workEligibility.authorizedWorkCountries.filter(
    (country) => country.trim().length > 0,
  );
  if (countries.length === 0) {
    return null;
  }
  return judgeWorkCountry({
    questionText: `${control.groupLabel} ${control.label}`,
    postingLocation: posting?.location ?? "",
    authorizedWorkCountries: countries,
  });
}

function eligibilityAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
  posting: ApplyAnswerSources["posting"] | null,
): ApplyAnswer | null {
  const eligibility = profile.workEligibility;
  const bank = profile.answerBank;
  switch (control.questionKind) {
    case "work_authorization": {
      const saved = trimmedOrNull(bank.workAuthorization);
      if (saved) {
        return profileAnswer(
          saved,
          control.questionKind,
          "profile.answerBank.workAuthorization",
          "your saved work-eligibility answer",
        );
      }
      // The list answers only for the country this job or question is
      // about. A list that does not settle it hands the question back.
      const verdict = workCountryVerdict(control, profile, posting);
      if (verdict?.kind === "covered") {
        return profileAnswer(
          `Yes — authorised to work in ${verdict.country}`,
          control.questionKind,
          "profile.workEligibility.authorizedWorkCountries",
          "the countries you can work in",
        );
      }
      if (verdict?.kind === "not_covered") {
        return profileAnswer(
          `No — not authorised to work in ${verdict.country}`,
          control.questionKind,
          "profile.workEligibility.authorizedWorkCountries",
          "the countries you can work in",
        );
      }
      return null;
    }
    case "visa_sponsorship": {
      const saved = trimmedOrNull(bank.visaSponsorship);
      if (saved) {
        return profileAnswer(
          saved,
          control.questionKind,
          "profile.answerBank.visaSponsorship",
          "your saved sponsorship answer",
        );
      }
      // "No sponsorship needed" is only true where the person can already
      // work; for a job in a country their list clearly leaves out it goes
      // back to them.
      if (
        eligibility.requiresVisaSponsorship === false &&
        workCountryVerdict(control, profile, posting)?.kind === "not_covered"
      ) {
        return null;
      }
      const value = yesNo(eligibility.requiresVisaSponsorship);
      return value
        ? profileAnswer(
            value,
            control.questionKind,
            "profile.workEligibility.requiresVisaSponsorship",
            "whether you need sponsorship",
          )
        : null;
    }
    case "relocation": {
      const saved = trimmedOrNull(bank.relocation);
      if (saved) {
        return profileAnswer(
          saved,
          control.questionKind,
          "profile.answerBank.relocation",
          "your saved relocation answer",
        );
      }
      const value = yesNo(eligibility.willingToRelocate);
      return value
        ? profileAnswer(
            value,
            control.questionKind,
            "profile.workEligibility.willingToRelocate",
            "whether you would relocate",
          )
        : null;
    }
    case "travel": {
      const saved = trimmedOrNull(bank.travel);
      if (saved) {
        return profileAnswer(
          saved,
          control.questionKind,
          "profile.answerBank.travel",
          "your saved travel answer",
        );
      }
      const value = yesNo(eligibility.willingToTravel);
      return value
        ? profileAnswer(
            value,
            control.questionKind,
            "profile.workEligibility.willingToTravel",
            "whether you would travel",
          )
        : null;
    }
    case "notice_period": {
      const saved = trimmedOrNull(bank.noticePeriod);
      if (saved) {
        return profileAnswer(
          saved,
          control.questionKind,
          "profile.answerBank.noticePeriod",
          "your saved notice period",
        );
      }
      if (eligibility.noticePeriodDays !== null) {
        return profileAnswer(
          `${eligibility.noticePeriodDays} days`,
          control.questionKind,
          "profile.workEligibility.noticePeriodDays",
          "your notice period",
        );
      }
      return null;
    }
    case "availability": {
      const saved =
        trimmedOrNull(bank.availability) ??
        trimmedOrNull(eligibility.availableStartDate);
      return saved
        ? profileAnswer(
            saved,
            control.questionKind,
            "profile.workEligibility.availableStartDate",
            "when you can start",
          )
        : null;
    }
    case "clearance": {
      const value = trimmedOrNull(eligibility.securityClearance);
      return value
        ? profileAnswer(
            value,
            control.questionKind,
            "profile.workEligibility.securityClearance",
            "your clearance",
          )
        : null;
    }
    case "experience": {
      if (asksForOverallYearsExperience(control)) {
        // Unknown is not zero: leave the question for the person.
        if (profile.yearsExperience === null) return null;
        return profileAnswer(
          String(profile.yearsExperience),
          control.questionKind,
          "profile.yearsExperience",
          "your years of experience",
        );
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * A fact the person has already stated. Never inferred, never averaged.
 */
/**
 * The kinds that are a question about the person's circumstances, not a field
 * to be filled from their address book.
 *
 * A question already read as one of these is only ever answered by what the
 * person said about that thing. Letting the generic matchers have a second go
 * is how "Will you require sponsorship for a visa to remain in your current
 * location?" came back answered with the city they live in.
 */
const ELIGIBILITY_QUESTION_KINDS: ReadonlySet<string> = new Set([
  "work_authorization",
  "visa_sponsorship",
  "relocation",
  "travel",
  "notice_period",
  "availability",
  "clearance",
  "salary_expectation",
  "experience",
  "cover_letter",
]);

export function resolveExactProfileAnswer(
  control: ApplyFormControl,
  profile: CandidateProfile,
  posting: ApplyAnswerSources["posting"] | null = null,
): ApplyAnswer | null {
  if (ELIGIBILITY_QUESTION_KINDS.has(control.questionKind)) {
    return eligibilityAnswer(control, profile, posting);
  }
  if (isPhoneCountryControl(control))
    return phoneCountryAnswer(control, profile);
  return (
    personalInfoAnswer(control, profile) ??
    locationAnswer(control, profile) ??
    linkAnswer(control, profile) ??
    technicalSkillsAnswer(control, profile) ??
    eligibilityAnswer(control, profile, posting)
  );
}

/**
 * A line the resume for this job already carries.
 *
 * Only used for short factual controls where the resume states the answer
 * outright; it never becomes a paraphrase of the resume.
 */
export function resolveResumeAnswer(
  control: ApplyFormControl,
  resumeText: string | null,
): ApplyAnswer | null {
  if (!resumeText) {
    return null;
  }
  if (control.questionKind !== "experience") {
    return null;
  }
  const match = /(\d{1,2})\+?\s*years?\b/iu.exec(resumeText);
  if (!match?.[1]) {
    return null;
  }
  if (!asksForOverallYearsExperience(control)) {
    return null;
  }
  return {
    value: match[1],
    kind: control.questionKind,
    sourceKind: "resume",
    sourceId: "application.resume",
    provenanceLabel: "the resume sent with this application",
    groundedIn: ["the resume sent with this application"],
  };
}

function answerLibraryScore(
  control: ApplyFormControl,
  saved: CandidateReusableAnswer,
): number {
  const question = normalizeSignal(saved.question);
  // The saved question can be the prompt as it was shown, group and label
  // together; the field on the retry may show only one of them. Both readings
  // count, so the same question keeps finding the same answer.
  const group = normalizeSignal(control.groupLabel);
  const labelAlone = normalizeSignal(control.label);
  const label =
    control.kind === "radio" && group
      ? group
      : group &&
          labelAlone &&
          !group.includes(labelAlone) &&
          !labelAlone.includes(group)
        ? `${group} ${labelAlone}`
        : labelAlone || group || normalizeSignal(control.placeholder);
  if (!question || !label) {
    return 0;
  }
  if (question === label || (labelAlone && question === labelAlone)) {
    return 1;
  }
  if (
    label.includes(question) ||
    question.includes(label) ||
    (labelAlone.split(" ").length >= 2 &&
      (labelAlone.includes(question) || question.includes(labelAlone)))
  ) {
    return 0.9;
  }
  const questionWords = new Set(
    question.split(" ").filter((word) => word.length > 3),
  );
  const labelWords = new Set(
    label.split(" ").filter((word) => word.length > 3),
  );
  if (questionWords.size === 0 || labelWords.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of questionWords) {
    if (labelWords.has(word)) {
      shared += 1;
    }
  }
  return shared / Math.max(questionWords.size, labelWords.size);
}

/** An answer the person saved earlier, matched on the question they saved it for. */
/** A saved answer whose question is exactly this control's question. */
export function resolveExactQuestionAnswer(
  control: ApplyFormControl,
  reusableAnswers: readonly CandidateReusableAnswer[],
): ApplyAnswer | null {
  // A radio or checkbox group asks its question in the group label, and
  // each option's own label is only "Yes" or "No".
  const group = normalizeSignal(control.groupLabel);
  const exact = reusableAnswers.find(
    (saved) =>
      answerLibraryScore(control, saved) === 1 ||
      (group.length > 0 && normalizeSignal(saved.question) === group),
  );
  if (!exact) return null;
  return {
    value: exact.answer,
    kind: control.questionKind,
    sourceKind: "answer_library",
    sourceId: `answerLibrary.${exact.id}`,
    provenanceLabel: "your answer to this question",
    groundedIn: ["your answer to this question"],
  };
}

export function resolveReusableAnswer(
  control: ApplyFormControl,
  reusableAnswers: readonly CandidateReusableAnswer[],
): ApplyAnswer | null {
  let best: { answer: CandidateReusableAnswer; score: number } | null = null;
  for (const saved of reusableAnswers) {
    const score = answerLibraryScore(control, saved);
    if (score >= 0.8 && (best === null || score > best.score)) {
      best = { answer: saved, score };
    }
  }
  if (!best) {
    return null;
  }
  return {
    value: best.answer.answer,
    kind: control.questionKind,
    sourceKind: "answer_library",
    sourceId: `answerLibrary.${best.answer.id}`,
    provenanceLabel: "your answer to this question",
    groundedIn: ["your answer to this question"],
  };
}

const FREE_TEXT_KINDS: ReadonlySet<string> = new Set(["text", "long_text"]);

/** True when Job Finder may write prose here rather than pick a stored value. */
export function acceptsWrittenAnswer(control: ApplyFormControl): boolean {
  return FREE_TEXT_KINDS.has(control.kind) && control.options.length === 0;
}

/**
 * Fit an answer to the options a control actually offers.
 *
 * Returns the option label to choose, or null when nothing on the list says
 * the same thing. A near-miss is not a match: an answer that is not offered
 * goes to the person rather than being rounded to the closest option.
 */
/** The plain ways people write yes and no, in the words a form offers. */
const AFFIRMATIVE_SYNONYMS = new Set([
  "yes",
  "y",
  "true",
  "i do",
  "i have",
  "affirmative",
]);
const NEGATIVE_SYNONYMS = new Set([
  "no",
  "n",
  "none",
  "nope",
  "false",
  "i do not",
  "i have not",
  "negative",
  "not applicable",
  "n a",
]);

export function matchOption(
  options: readonly string[],
  desiredValue: string,
): string | null {
  const desired = normalizeSignal(desiredValue);
  if (!desired) {
    return null;
  }
  const exact = options.find((option) => normalizeSignal(option) === desired);
  if (exact) {
    return exact;
  }
  const yesish =
    AFFIRMATIVE_SYNONYMS.has(desired) || desired.startsWith("yes ");
  const noish = NEGATIVE_SYNONYMS.has(desired) || desired.startsWith("no ");
  if (yesish || noish) {
    const wanted = yesish ? "yes" : "no";
    const affirmative = options.find((option) => {
      const normalized = normalizeSignal(option);
      return normalized === wanted || normalized.startsWith(`${wanted} `);
    });
    if (affirmative) {
      return affirmative;
    }
  }
  const contained = options.filter((option) => {
    const normalized = normalizeSignal(option);
    return (
      normalized.length > 0 &&
      (normalized === desired || normalized.includes(desired))
    );
  });
  if (contained.length === 1) {
    return contained[0] ?? null;
  }
  // One choice the answer is the beginning of, and only one, is that choice:
  // "Bach" on a list offering "Bachelor's degree" and "Master's degree".
  const prefixed = options.filter((option) =>
    normalizeSignal(option).startsWith(desired),
  );
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}

function matchExperienceRangeOption(
  options: readonly string[],
  desiredValue: string,
): string | null {
  const years = Number.parseInt(desiredValue.trim(), 10);
  if (!Number.isFinite(years) || years < 0) {
    return null;
  }
  const matches = options.filter((option) => {
    const normalized = option.trim().replace(/[–—]/gu, "-");
    const range = /^(\d+)\s*-\s*(\d+)(?:\s*years?)?$/iu.exec(normalized);
    if (range?.[1] && range[2]) {
      return years >= Number(range[1]) && years <= Number(range[2]);
    }
    const openEnded = /^(\d+)\s*\+(?:\s*years?)?$/iu.exec(normalized);
    return Boolean(openEnded?.[1] && years >= Number(openEnded[1]));
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * The full sourcing order for one control.
 *
 * `salaryDisclosure` is passed in because pay is the one answer the person can
 * decide to keep out of an automated run entirely.
 */
export function resolveApplyAnswer(input: {
  control: ApplyFormControl;
  sources: ApplyAnswerSources;
  salaryDisclosure: "pause_for_user" | "answer_from_profile";
}): ApplyAnswerResolution {
  const { control, sources } = input;

  if (control.questionKind === "salary_expectation") {
    const saved = trimmedOrNull(sources.profile.answerBank.salaryExpectations);
    if (input.salaryDisclosure !== "answer_from_profile") {
      return {
        status: "needs_you",
        permission: true,
        reason:
          "This asks what pay you expect, and you asked Job Finder to leave that to you.",
        suggestion: saved
          ? profileAnswer(
              saved,
              "salary_expectation",
              "profile.answerBank.salaryExpectations",
              "your saved pay answer",
            )
          : null,
      };
    }
    if (saved) {
      return {
        status: "answered",
        answer: profileAnswer(
          saved,
          "salary_expectation",
          "profile.answerBank.salaryExpectations",
          "your saved pay answer",
        ),
      };
    }
    return {
      status: "needs_you",
      reason: "This asks what pay you expect and your profile does not say.",
      suggestion: null,
    };
  }

  // An answer saved for this exact question (the person answered it in
  // Needs you or the application's questions) beats a general profile
  // answer: "Yes" to "Are you authorized to work in this country?" must not
  // lose to a saved sentence that fits none of the choices.
  const direct =
    resolveExactQuestionAnswer(control, sources.reusableAnswers) ??
    postingLocationAnswer(control, sources.posting) ??
    (asksForPostingLocation(control)
      ? null
      : resolveExactProfileAnswer(control, sources.profile, sources.posting)) ??
    workHistoryAnswer(control, sources.profile) ??
    resolveResumeAnswer(control, sources.resumeText) ??
    resolveReusableAnswer(control, sources.reusableAnswers);

  if (direct) {
    if (control.options.length > 0) {
      const numericExperience =
        control.questionKind === "experience" &&
        /^\d+$/u.test(direct.value.trim());
      const option = numericExperience
        ? (matchExperienceRangeOption(control.options, direct.value) ??
          control.options.find(
            (candidate) =>
              normalizeSignal(candidate) === normalizeSignal(direct.value),
          ) ??
          null)
        : matchOption(control.options, direct.value);
      if (!option) {
        if (
          (direct.sourceKind === "answer_library" ||
            direct.sourceId.startsWith("profile.answerBank.")) &&
          direct.value.trim().split(/\s+/u).length > 1 &&
          control.attestationKind === null
        ) {
          if (
            (control.questionKind === "work_authorization" ||
              control.questionKind === "visa_sponsorship") &&
            namedWorkCountries(
              `${control.groupLabel} ${control.label} ${sources.posting.location}`,
            ).length === 0
          ) {
            return {
              status: "needs_you",
              reason:
                "Neither the question nor the posting names the country. Your saved answer needs that context.",
              suggestion: direct,
            };
          }
          return { status: "map_choice", context: direct };
        }
        // Saying which answer did not fit and what the choices are is what
        // stops the person answering the identical question over and over.
        return {
          status: "needs_you",
          reason: `Your answer "${direct.value}" did not match one of the choices: ${control.options.slice(0, 12).join(", ")}`,
          suggestion: direct,
        };
      }
      return { status: "answered", answer: { ...direct, value: option } };
    }
    return { status: "answered", answer: direct };
  }

  if (workHistoryField(control)) {
    return {
      status: "needs_you",
      reason:
        "This work-history field has no matching fact in your saved profile.",
      suggestion: null,
    };
  }

  if (addressFactField(control)) {
    return {
      status: "needs_you",
      reason:
        "This asks for an address detail you have not saved. Your city or country does not answer it.",
      suggestion: null,
    };
  }

  // A legal answer the saved countries do not settle is never written as
  // free text either.
  if (
    control.questionKind === "work_authorization" ||
    control.questionKind === "visa_sponsorship"
  ) {
    const verdict = workCountryVerdict(
      control,
      sources.profile,
      sources.posting,
    );
    if (
      control.questionKind === "work_authorization" &&
      verdict?.kind === "unknown"
    ) {
      return { status: "needs_you", reason: verdict.reason, suggestion: null };
    }
    if (
      control.questionKind === "visa_sponsorship" &&
      verdict?.kind === "not_covered"
    ) {
      return {
        status: "needs_you",
        reason: `This asks whether you need sponsorship to work in ${verdict.country}. Your profile says you need none, but it does not list ${verdict.country} among the countries you can work in.`,
        suggestion: null,
      };
    }
  }

  // A notice period or start date is a fact about the person, not prose to
  // compose. With nothing saved it goes to them the first time it is seen.
  // Letting the model write one meant a sentence like "happy to discuss"
  // went in on one pass, and the same question came back on a later pass
  // when the written-answer check refused it.
  if (
    control.questionKind === "notice_period" ||
    control.questionKind === "availability"
  ) {
    return {
      status: "needs_you",
      reason:
        control.questionKind === "notice_period"
          ? "This asks for your notice period, and your profile does not say."
          : "This asks when you can start, and your profile does not say.",
      suggestion: null,
    };
  }

  if (acceptsWrittenAnswer(control)) {
    const grounding = [
      sources.resumeText ? "the resume sent with this application" : null,
      "your profile",
      `the posting for ${sources.posting.title} at ${sources.posting.company}`,
    ].filter((value): value is string => value !== null);
    return { status: "write_free_text", grounding };
  }

  return {
    status: "needs_you",
    reason: NO_STORED_ANSWER_REASON,
    suggestion: null,
  };
}
