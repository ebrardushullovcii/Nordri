import { buildValuePreview } from "@nordri/ai-providers";
import type {
  ResumeDocumentBundle,
  ResumeImportFieldCandidate,
} from "@nordri/contracts";

import {
  isObject,
  toCandidateListValues,
  toStringArray,
} from "./resume-import-common";
import { normalizeText } from "./shared";
import {
  importedRoleWordPattern as roleWordPattern,
  splitRoleTitleAndEmployer,
} from "./resume-role-title";

const headingPattern =
  /^(?:(?:work|professional|relevant|employment|career)(?: work)? (?:experience|history|background)|experience|employment|education(?: and training)?|(?:technical|core|key|additional) skills|skills|projects?|project experience|certifications?|certificates?|languages?|language skills|(?:career )?objective|target roles|(?:work|employment) preferences|(?:extracurricular )?activities|extracurricular|volunteer(?:ing| experience)?|summary|profile|about me|references|disclaimer)\s*[:–—-]?$/i;
const activityPattern =
  /^(?:(?:extracurricular )?activities|extracurricular|volunteer(?:ing| experience)?)\s*[:–—-]?$/i;
const proficiencyPattern =
  /^(?:native|mother tongue|fluent|bilingual|conversational|basic|beginner|intermediate|advanced|elementary|professional|limited|working|full professional|[ABC][12])\b/i;

export function splitImportedRole(
  value: string,
  companyName: string | null = null,
  bundle?: ResumeDocumentBundle,
): { title: string; companyName: string | null } {
  const lines = sourceLines(bundle);
  const sourceCompanyLine = lines.find((line, index) => {
    if (!containsValue(line.text, value)) return false;
    const next = lines[index + 1]?.text ?? "";
    return (
      Boolean(next) &&
      !headingPattern.test(next) &&
      !/^(?:[-*•]|<.*DATE)|\b(?:19|20)\d{2}\b/i.test(next) &&
      !roleWordPattern.test(next)
    );
  });
  const sourceCompany = sourceCompanyLine
    ? (lines[lines.indexOf(sourceCompanyLine) + 1]?.text ?? null)
    : null;
  const split = splitRoleTitleAndEmployer(
    value,
    Boolean(companyName || sourceCompany),
  );
  return {
    ...split,
    companyName: split.companyName || companyName || sourceCompany,
  };
}

export function isImportedLocationLine(value: string): boolean {
  return (
    !roleWordPattern.test(value) &&
    /^(?:remote|hybrid|on-?site|[\p{L}][\p{L}\s.'’-]+(?:,\s*[\p{L}][\p{L}\s.'’-]+){1,2})$/iu.test(
      value.trim(),
    )
  );
}

type SourceLine = {
  text: string;
  section: string;
  blockId: string;
  chrome: boolean;
};

function sourceLines(bundle?: ResumeDocumentBundle): SourceLine[] {
  if (!bundle) return [];
  const blocks = [...bundle.blocks].sort(
    (a, b) => a.readingOrder - b.readingOrder,
  );
  const pageEdges = new Map<string, Set<number>>();
  for (const page of new Set(blocks.map((block) => block.pageNumber))) {
    const pageLines = blocks
      .filter((block) => block.pageNumber === page)
      .flatMap((block) => block.text.split(/\r?\n/))
      .filter((line) => line.trim());
    for (const line of [...pageLines.slice(0, 2), ...pageLines.slice(-2)]) {
      const key = normalizeText(line.replace(/\b\d+\b/g, "#"));
      const pages = pageEdges.get(key) ?? new Set<number>();
      pages.add(page);
      pageEdges.set(key, pages);
    }
  }
  let section = "header";
  return blocks
    .flatMap((block) =>
      block.text.split(/\r?\n/).map((raw) => {
        const text = raw.trim();
        if (headingPattern.test(text))
          section = text
            .toLowerCase()
            .replace(/[:–—-]+$/, "")
            .trim();
        const key = normalizeText(text.replace(/\b\d+\b/g, "#"));
        const chrome =
          !headingPattern.test(text) &&
          ((pageEdges.get(key)?.size ?? 0) > 1 ||
            /^(?:page\s+\d+(?:\s+of\s+\d+)?|disclaimer\s*:|©|copyright\b)/i.test(
              text,
            ));
        return { text, section, blockId: block.id, chrome };
      }),
    )
    .filter((line) => line.text);
}

function containsValue(line: string, value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.length > 0 &&
    ` ${normalizeText(line)} `.includes(` ${normalized} `)
  );
}

function onlyInActivities(value: string, lines: SourceLine[]): boolean {
  const matches = lines.filter((line) => containsValue(line.text, value));
  return (
    matches.length > 0 &&
    matches.every((line) => activityPattern.test(line.section))
  );
}

function objectiveRolesFromSource(lines: SourceLine[]) {
  return lines
    .filter(
      (line) =>
        /objective$/.test(line.section) && !headingPattern.test(line.text),
    )
    .flatMap((line) => {
      const match = line.text.match(
        /(?:seeking|looking for|objective:)\s+(?:an?\s+)?(.+?)(?:\s+(?:role|position|job|with|where|at)\b|[.!]|$)/i,
      );
      const role = (match?.[1] ?? line.text).trim();
      return role.length <= 80 && roleWordPattern.test(role)
        ? [{ role, line }]
        : [];
    });
}

function mostRecentSourceRole(
  lines: SourceLine[],
  candidates: readonly ResumeImportFieldCandidate[],
  bundle?: ResumeDocumentBundle,
) {
  return candidates
    .filter(
      (candidate) =>
        candidate.target.section === "experience" && isObject(candidate.value),
    )
    .flatMap((candidate) => {
      const checked = validateResumeImportSourceCandidate(
        candidate,
        bundle,
        candidates,
      );
      if (checked.reject || checked.review) return [];
      candidate = checked.candidate;
      if (
        !isObject(candidate.value) ||
        typeof candidate.value.title !== "string"
      )
        return [];
      const role = candidate.value.title;
      const current = candidate.value.isCurrent === true;
      const start =
        typeof candidate.value.startDate === "string"
          ? candidate.value.startDate
          : "";
      const end =
        typeof candidate.value.endDate === "string"
          ? candidate.value.endDate
          : "";
      const date = current ? start || end : end || start;
      const line = lines.find(
        (line) =>
          /(?:experience|employment|history|background)$/.test(line.section) &&
          !headingPattern.test(line.text) &&
          containsValue(line.text, role),
      );
      return line
        ? [
            {
              role,
              line,
              current,
              date: /^(?:19|20)\d{2}(?:-\d{2})?$/.test(date) ? date : "",
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        right.date.localeCompare(left.date),
    )[0];
}

function sourceIdentifiesLocation(
  title: string,
  lines: SourceLine[],
  records: readonly ResumeImportFieldCandidate[],
): boolean {
  const exact = (line: string) => normalizeText(line) === normalizeText(title);
  const identifiedContactLocation = records.some(
    (record) =>
      record.target.section === "location" &&
      record.target.key === "currentLocation" &&
      typeof record.value === "string" &&
      exact(record.value),
  );
  if (
    lines.some(
      (line, index) =>
        line.section === "header" &&
        line.text.split(/[|·]/).some((part) => exact(part.trim())) &&
        (identifiedContactLocation ||
          (lines[index + 1]?.section === "header" &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lines[index + 1]?.text ?? "") &&
            !lines.some(
              (entry) => entry.section !== "header" && exact(entry.text),
            ))),
    )
  )
    return true;
  return lines.some((line, index) => {
    if (!exact(line.text)) return false;
    const previous = lines[index - 1]?.text ?? "";
    if (headingPattern.test(previous) || /^[-*•]/.test(previous)) return false;
    return (
      roleWordPattern.test(previous) ||
      Boolean(splitRoleTitleAndEmployer(previous).companyName) ||
      records.some(
        (record) =>
          record.target.section === "experience" &&
          isObject(record.value) &&
          typeof record.value.title === "string" &&
          !exact(record.value.title) &&
          containsValue(previous, record.value.title),
      )
    );
  });
}

/** Validate every extraction branch against source structure before auto-apply. */
export function validateResumeImportSourceCandidate(
  candidate: ResumeImportFieldCandidate,
  bundle?: ResumeDocumentBundle,
  recordCandidates: readonly ResumeImportFieldCandidate[] = [],
): { candidate: ResumeImportFieldCandidate; reject: boolean; review: boolean } {
  const lines = sourceLines(bundle);
  let value = candidate.value;
  let reject = false;
  let review = false;
  const section = candidate.target.section;
  const key = candidate.target.key;
  const sourceSkills = lines
    .filter(
      (line) => /skills$/.test(line.section) && !headingPattern.test(line.text),
    )
    .flatMap((line) =>
      line.text
        .replace(/^(?:tools|core|technical skills)\s*:\s*/i, "")
        .split(/[,;|•]/),
    )
    .map((entry) => entry.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
  const validSkill = (skill: string) => {
    if (headingPattern.test(skill)) return false;
    const normalized = normalizeText(skill);
    if (sourceSkills.some((item) => normalizeText(item) === normalized))
      return true;
    return !sourceSkills.some(
      (item) =>
        normalizeText(item) !== normalized &&
        item.split(/\s+/).length <= 4 &&
        !/[()\d]/.test(item) &&
        !/\b(?:and|or|with|in|using|including)\b/i.test(item) &&
        containsValue(item, skill),
    );
  };

  if (section === "skill") {
    const skills = toStringArray(value).filter(validSkill);
    reject = skills.length === 0;
    value =
      typeof value === "string" && skills.length === 1
        ? (skills[0] ?? "")
        : skills;
  }
  if (section === "experience" && isObject(value)) {
    const title = typeof value.title === "string" ? value.title : "";
    const split = splitImportedRole(
      title,
      typeof value.companyName === "string" ? value.companyName : null,
      bundle,
    );
    const hasEmployer = Boolean(value.companyName || split.companyName);
    const hasDates =
      value.isCurrent === true ||
      [value.startDate, value.endDate].some(
        (date) => typeof date === "string" && date.trim().length > 0,
      );
    const locationShape = isImportedLocationLine(title);
    const locationEvidence =
      locationShape &&
      ((!hasEmployer && !hasDates) ||
        sourceIdentifiesLocation(title, lines, recordCandidates));
    review = locationShape && !locationEvidence && (!hasEmployer || !hasDates);
    value = {
      ...value,
      title: split.title,
      companyName: value.companyName || split.companyName,
      skills: toStringArray(value.skills).filter(validSkill),
    };
    const activityEvidence =
      candidate.visualEvidence?.some((entry) =>
        activityPattern.test(
          (entry.regionHint ?? "").replace(/\s+section\b.*$/i, ""),
        ),
      ) ?? false;
    reject =
      locationEvidence ||
      headingPattern.test(title) ||
      onlyInActivities(title, lines) ||
      activityEvidence;
  }
  if (
    section === "identity" &&
    key === "headline" &&
    typeof value === "string"
  ) {
    const invalidHeadline = (headline: string) =>
      onlyInActivities(headline, lines) ||
      isImportedLocationLine(headline) ||
      headingPattern.test(headline);
    reject = invalidHeadline(value);
    value = splitImportedRole(value, null, bundle).title;
    const title = value;
    const derivedFromRole = lines.some(
      (line) =>
        /(?:experience|employment|history|background)$/.test(line.section) &&
        containsValue(line.text, title),
    );
    const statedHeadline = lines.some(
      (line) =>
        line.section === "header" &&
        normalizeText(line.text) === normalizeText(title),
    );
    if (!reject && derivedFromRole && !statedHeadline) {
      // The headline sits under the person's name on every resume, so it is
      // the title they hold now; the objective's role is only a fallback.
      const preferred =
        mostRecentSourceRole(lines, recordCandidates, bundle) ??
        objectiveRolesFromSource(lines)[0];
      if (preferred && !invalidHeadline(preferred.role)) {
        value = preferred.role;
        candidate = {
          ...candidate,
          evidenceText: preferred.line.text,
          sourceBlockIds: [preferred.line.blockId],
        };
      }
    }
  }
  if (section === "search_preferences" && key === "targetRoles") {
    const objectives = objectiveRolesFromSource(lines);
    const objectiveLines = objectives.map((entry) => entry.line);
    const objectiveRoles = objectives.map((entry) => entry.role);
    value =
      objectiveRoles.length > 0
        ? objectiveRoles
        : toCandidateListValues(candidate)
            .filter(
              (role) =>
                !onlyInActivities(role, lines) &&
                !isImportedLocationLine(role) &&
                !headingPattern.test(role),
            )
            .map((role) => splitImportedRole(role, null, bundle).title);
    if (objectiveRoles.length > 0)
      candidate = {
        ...candidate,
        evidenceText: objectiveLines.map((line) => line.text).join(" "),
        sourceBlockIds: objectiveLines.map((line) => line.blockId),
      };
    reject = value.length === 0;
  }

  if (
    section === "location" &&
    key === "currentLocation" &&
    typeof value === "string"
  ) {
    const current = value;
    const complete = lines
      .filter((line) => line.section === "header")
      .flatMap((line) => line.text.split(/[|·]/).map((entry) => entry.trim()))
      .find(
        (line) =>
          line.split(",").length === 3 &&
          isImportedLocationLine(line) &&
          containsValue(line, current),
      );
    if (complete) value = complete;
  }
  if (section === "language" && isObject(value)) {
    const language =
      typeof value.language === "string" ? value.language.trim() : "";
    const matchingLines = lines.filter((line) =>
      containsValue(line.text, language),
    );
    reject =
      headingPattern.test(language) ||
      /^(?:page\b|disclaimer\b|copyright\b|©)/i.test(language) ||
      language.length > 40 ||
      language.split(/\s+/).length > 4 ||
      /[\d$€£]/.test(language) ||
      (matchingLines.length > 0 &&
        matchingLines.every(
          (line) =>
            line.chrome ||
            /preferences|disclaimer|references/.test(line.section),
        ));
    review =
      !reject &&
      (typeof value.proficiency !== "string" ||
        !proficiencyPattern.test(value.proficiency));
  }
  if (section === "education" && isObject(value)) {
    const school = typeof value.schoolName === "string" ? value.schoolName : "";
    review =
      (!value.degree &&
        !value.fieldOfStudy &&
        !value.startDate &&
        !value.endDate) ||
      /\b(?:degree|bachelor|master|associate|diploma)\b|\b(?:19|20)\d{2}\b/i.test(
        school,
      );
  }
  if (
    (section === "project" || section === "certification") &&
    isObject(value)
  ) {
    const name = typeof value.name === "string" ? value.name : "";
    review =
      name.length > 100 ||
      /https?:\/\/|\n|\b(?:technologies|tools|skills)\s*:/i.test(name);
  }
  if (
    (section === "project" ||
      section === "certification" ||
      section === "education") &&
    typeof value === "string"
  ) {
    // Raw section text is not one record. Keep it available for review.
    review = true;
  }
  return {
    candidate: {
      ...candidate,
      value,
      normalizedValue: value,
      valuePreview: buildValuePreview(value),
    },
    reject,
    review,
  };
}
