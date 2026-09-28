import { looksLikeSpokenLanguageSkillEntry } from "./resume-skill-grounding";
import {
  knownSkillPhrases,
  knownSoftSkillPhrases,
  skillCategoryHeadingPattern,
  skillSectionAliases,
} from "./constants";
import {
  cleanLine,
  findSectionBodyLinesByAliases,
  splitLines,
  uniqueStrings,
} from "./utils";

function inferKnownPhrases(text: string, phrases: readonly string[]): string[] {
  return uniqueStrings(
    phrases.filter((phrase) => containsPhrase(text, phrase)),
  );
}

function containsPhrase(text: string, phrase: string): boolean {
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9])${escapedPhrase}(?=$|[^A-Za-z0-9])`,
    "i",
  ).test(text);
}

export function inferSkills(
  resumeText: string,
  fallbackSkills: readonly string[],
): string[] {
  const sectionLines = findSectionBodyLinesByAliases(
    splitLines(resumeText),
    skillSectionAliases,
  );
  const sectionText = sectionLines.join("\n");
  const matchedKnownSkills = uniqueStrings(
    knownSkillPhrases.filter((skill) => containsPhrase(sectionText, skill)),
  );
  const nonNestedMatchedSkills = matchedKnownSkills.filter(
    (skill) =>
      !matchedKnownSkills.some(
        (other) =>
          other !== skill && other.toLowerCase().includes(skill.toLowerCase()),
      ),
  );
  const rawSectionSkills = sectionLines
    .filter((line) => !skillCategoryHeadingPattern.test(line))
    .map(stripInlineSkillCategory)
    .flatMap((line) => line.split(/[,;]|\||[\u2022\u25cf\u25aa\u25e6\u2023]/))
    .map(cleanLine)
    .filter((entry) => entry.length >= 2 && entry.length <= 28)
    .filter((entry) => !looksLikeSpokenLanguageSkillEntry(entry))
    .filter((entry) => {
      const overlappingKnownSkills = knownSkillPhrases.filter((skill) =>
        containsPhrase(entry, skill),
      );
      if (overlappingKnownSkills.length > 1) {
        return false;
      }
      return !nonNestedMatchedSkills.some(
        (skill) => skill.toLowerCase() === entry.toLowerCase(),
      );
    });
  const sectionSkills = uniqueStrings([
    ...nonNestedMatchedSkills,
    ...rawSectionSkills,
  ]);

  if (sectionSkills.length > 0) {
    return sectionSkills;
  }

  const extractedSkills = knownSkillPhrases.filter((skill) =>
    containsPhrase(resumeText, skill),
  );
  const nonNestedExtracted = extractedSkills.filter(
    (skill) =>
      !extractedSkills.some(
        (other) =>
          other !== skill && other.toLowerCase().includes(skill.toLowerCase()),
      ),
  );
  return nonNestedExtracted.length > 0
    ? uniqueStrings(nonNestedExtracted)
    : uniqueStrings(fallbackSkills);
}

function stripInlineSkillCategory(line: string): string {
  return line.replace(
    /^(?:core(?: skills)?|technical skills|frameworks|programming languages|languages|databases|tools|security(?:\s*&\s*authentication)?|soft skills)\s*:\s*/i,
    "",
  );
}

function splitSkillLine(line: string): string[] {
  line = stripInlineSkillCategory(line);
  const rawEntries = line
    .split(/[,;]|\||[\u2022\u25cf\u25aa\u25e6\u2023]| {2,}/)
    .map(cleanLine)
    .filter((entry) => entry.length >= 2 && entry.length <= 40)
    .filter((entry) => !looksLikeSpokenLanguageSkillEntry(entry));

  if (rawEntries.length === 0) {
    const matchedKnownSkills = inferKnownPhrases(line, knownSkillPhrases);
    const nonNested = matchedKnownSkills.filter(
      (skill) =>
        !matchedKnownSkills.some(
          (other) =>
            other !== skill &&
            other.toLowerCase().includes(skill.toLowerCase()),
        ),
    );
    return nonNested.length > 0 ? nonNested : [];
  }

  const entryMatches = rawEntries.map((entry) => {
    const matches = inferKnownPhrases(entry, knownSkillPhrases);
    return matches.filter(
      (skill) =>
        !matches.some(
          (other) =>
            other !== skill &&
            other.toLowerCase().includes(skill.toLowerCase()),
        ),
    );
  });

  const rawUnmatched = rawEntries.filter(
    (entry) => inferKnownPhrases(entry, knownSkillPhrases).length === 0,
  );

  return uniqueStrings([...entryMatches.flat(), ...rawUnmatched]);
}

export function inferSkillGroups(
  resumeText: string,
  fallbackSkills: readonly string[],
) {
  const sectionLines = findSectionBodyLinesByAliases(
    splitLines(resumeText),
    skillSectionAliases,
  );
  const groups = {
    coreSkills: [] as string[],
    tools: [] as string[],
    languagesAndFrameworks: [] as string[],
    softSkills: [] as string[],
    highlightedSkills: [] as string[],
  };
  let activeGroup: keyof typeof groups = "coreSkills";

  for (const line of sectionLines) {
    if (/^(frameworks|programming languages|languages)$/i.test(line)) {
      activeGroup = "languagesAndFrameworks";
      continue;
    }

    if (/^(databases|tools|security(?:\s*&\s*authentication)?)$/i.test(line)) {
      activeGroup = "tools";
      continue;
    }

    if (/^soft skills$/i.test(line)) {
      activeGroup = "softSkills";
      continue;
    }

    if (skillCategoryHeadingPattern.test(line)) {
      continue;
    }

    if (activeGroup === "softSkills") {
      groups.softSkills.push(...inferKnownPhrases(line, knownSoftSkillPhrases));
      continue;
    }

    groups[activeGroup].push(...splitSkillLine(line));
  }

  const allSkills = inferSkills(resumeText, fallbackSkills);

  return {
    coreSkills: uniqueStrings(
      groups.coreSkills.length > 0 ? groups.coreSkills : allSkills.slice(0, 8),
    ),
    tools: uniqueStrings(groups.tools),
    languagesAndFrameworks: uniqueStrings(groups.languagesAndFrameworks),
    softSkills: uniqueStrings(groups.softSkills),
    highlightedSkills: uniqueStrings([
      ...groups.coreSkills.slice(0, 4),
      ...groups.languagesAndFrameworks.slice(0, 4),
      ...allSkills.slice(0, 4),
    ]).slice(0, 8),
  };
}
