import type {
  CandidateProfile,
  FitRecommendation,
  JobRequirementAssessment,
  JobRequirementImportance,
  MatchLocationReach,
  ResumeRequirementEvidence,
} from "@nordri/contracts";

import type { MatchAssessmentPostingInput } from "./match-assessment-posting-input";
import { buildCareerStageRequirement } from "./matching-career-stage";
import { buildEligibilityRequirementAssessments } from "./matching-eligibility";
import type {
  LocationCompatibilityState,
  WorkModeCompatibilityState,
} from "./matching";
import { isAbsentFieldText, normalizeText, uniqueStrings } from "./shared";

const technologySignals = [
  { label: "TypeScript", aliases: ["typescript"] },
  { label: "JavaScript", aliases: ["javascript"] },
  { label: "Node.js", aliases: ["node js", "nodejs"] },
  { label: "React", aliases: ["react"] },
  { label: "Next.js", aliases: ["next js", "nextjs"] },
  { label: "React Native", aliases: ["react native"] },
  { label: "Electron", aliases: ["electron"] },
  { label: ".NET", aliases: ["net", "dotnet"] },
  { label: "ASP.NET", aliases: ["asp net", "aspnet"] },
  { label: "C#", aliases: ["csharp"] },
  { label: "Python", aliases: ["python"] },
  { label: "FastAPI", aliases: ["fastapi", "fast api"] },
  { label: "Django", aliases: ["django"] },
  { label: "Java", aliases: ["java"] },
  { label: "Kotlin", aliases: ["kotlin"] },
  { label: "Go", aliases: ["golang"] },
  { label: "Rust", aliases: ["rust"] },
  { label: "PHP", aliases: ["php"] },
  { label: "Ruby", aliases: ["ruby"] },
  { label: "Rails", aliases: ["rails", "ruby on rails"] },
  { label: "Elixir", aliases: ["elixir"] },
  { label: "Phoenix", aliases: ["phoenix"] },
  { label: "AWS", aliases: ["aws", "amazon web services"] },
  { label: "Azure", aliases: ["azure"] },
  { label: "Google Cloud", aliases: ["gcp", "google cloud"] },
  { label: "Docker", aliases: ["docker"] },
  { label: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { label: "Terraform", aliases: ["terraform"] },
  { label: "SQL", aliases: ["sql"] },
  { label: "PostgreSQL", aliases: ["postgresql", "postgres"] },
  { label: "MySQL", aliases: ["mysql"] },
  { label: "MongoDB", aliases: ["mongodb", "mongo db"] },
  { label: "Salesforce", aliases: ["salesforce"] },
  { label: "Redis", aliases: ["redis"] },
  { label: "Kafka", aliases: ["kafka"] },
  { label: "GraphQL", aliases: ["graphql", "graph ql"] },
  { label: "Cypress", aliases: ["cypress"] },
  { label: "Playwright", aliases: ["playwright"] },
] as const;

/** Canonical technologies stated in listing or profile text. */
export function collectTechnologySignals(value: string): string[] {
  return technologySignals
    .filter((technology) => containsPhrase(value, technology.aliases))
    .map((technology) => technology.label);
}

const preferredMarkers = /\b(?:nice to have|preferred|ideally|bonus|plus)\b/iu;
const requiredMarkers =
  /\b(?:must|required|requirements|minimum|at least|you have|you bring|we expect|need to have|strong|solid hands-on|deep hands-on|proven|demonstrated|experience with|experience building)\b/iu;
const explicitDescriptionRequirementMarkers =
  /\b(?:must|required|minimum qualifications?|at least|you have|you bring|we expect|need to have|strong proficiency|solid hands-on|deep hands-on|proven experience|demonstrated (?:experience|ability)|experience with|experience building|proficien(?:cy|t) (?:in|with))\b/iu;

type RequirementEvidenceSource =
  | "title"
  | "key_skill"
  | "minimum_qualification"
  | "preferred_qualification"
  | "responsibility"
  | "description";

type RequirementEvidenceLine = {
  text: string;
  source: RequirementEvidenceSource;
  sectionImportance: JobRequirementImportance | null;
};

type CapabilitySignal = {
  label: string;
  category: "skill" | "domain";
  listingPattern: RegExp;
  profilePattern: RegExp;
  requiresDesignContext?: boolean;
  skillEntryAliases?: readonly string[];
};

const capabilitySignals: readonly CapabilitySignal[] = [
  {
    label: "Customer support",
    category: "domain",
    listingPattern:
      /\b(?:customer support|chat[- ](?:first )?support|client[- ]facing SaaS)\b/iu,
    profilePattern:
      /\b(?:customer support|chat[- ](?:first )?support|client[- ]facing SaaS)\b/iu,
  },
  {
    label: "Customer implementation ownership",
    category: "domain",
    listingPattern:
      /\b(?:leading customer (?:onboarding|implementation|setup)[^.!?\n]{0,60}projects|manag(?:e|ing) customers through multi[- ](?:step|week)[^.!?\n]{0,100}setup|(?:customer|client)[^.!?\n]{0,60}(?:implementation|setup) projects)\b/iu,
    profilePattern:
      /\b(?:(?:led|owned|managed|delivered) (?:customer|client) (?:onboarding|implementation|setup) (?:projects|programs)|(?:led|owned|managed|delivered)[^.!?\n]{0,35}multi[- ](?:step|week)[^.!?\n]{0,60}(?:customer|client|onboarding|implementation|setup)|managed customers through multi[- ](?:step|week)[^.!?\n]{0,100}setup)\b/iu,
  },
  {
    label: "Customer onboarding",
    category: "domain",
    listingPattern:
      /\b(?:(?:customer|client|merchant|partner)(?:s| accounts?)?\s+onboard(?:ing|ed)?|onboard(?:ing|ed)?\s+(?:new\s+)?(?:customer|client|merchant|partner)s?)\b/iu,
    profilePattern:
      /\b(?:(?:customer|client|merchant|partner)(?:s| accounts?)?\s+onboard(?:ing|ed)?|onboard(?:ing|ed)?\s+(?:new\s+)?(?:customer|client|merchant|partner)s?)\b/iu,
  },
  {
    label: "Customer adoption",
    category: "domain",
    listingPattern:
      /\b(?:(?:customer|client|product|platform|feature|user)\s+adoption|(?:drive|increase|improve|grow|accelerate|support)(?:s|d|ing)?\s+(?:customer|client|product|platform|feature|user)?\s*adoption)\b/iu,
    profilePattern:
      /\b(?:(?:customer|client|product|platform|feature|user)\s+adoption|(?:drove|drive|increased|improved|grew|accelerated|supported)\s+(?:customer|client|product|platform|feature|user)?\s*adoption)\b/iu,
  },
  {
    label: "Renewals",
    category: "domain",
    listingPattern:
      /\b(?:(?:customer|client|contract|account)\s+renewals?|renewal\s+(?:management|strategy|motion|process|pipeline|conversations?|forecasting)|manage(?:s|d|ment|ing)?\s+(?:customer|client|contract|account)?\s*renewals?)\b/iu,
    profilePattern:
      /\b(?:(?:customer|client|contract|account)\s+renewals?|renewal\s+(?:management|strategy|motion|process|pipeline|conversations?|forecasting)|manage(?:s|d|ment|ing)?\s+(?:customer|client|contract|account)?\s*renewals?)\b/iu,
  },
  {
    label: "Quarterly business reviews (QBRs)",
    category: "domain",
    listingPattern:
      /\b(?:QBRs?|quarterly business reviews?|executive business reviews?)\b/iu,
    profilePattern:
      /\b(?:QBRs?|quarterly business reviews?|executive business reviews?)\b/iu,
  },
  {
    label: "Customer escalations",
    category: "domain",
    listingPattern:
      /\b(?:(?:customer|client|account)\s+escalations?|escalation\s+management|manage(?:s|d|ment|ing)?\s+(?:customer|client|account)?\s*escalations?|escalated\s+(?:customer|client|account)\s+(?:issues?|cases?|concerns?))\b/iu,
    profilePattern:
      /\b(?:(?:customer|client|account)\s+escalations?|escalation\s+management|manage(?:s|d|ment|ing)?\s+(?:customer|client|account)?\s*escalations?|escalated\s+(?:customer|client|account)\s+(?:issues?|cases?|concerns?))\b/iu,
  },
  {
    label: "User research",
    category: "skill",
    listingPattern:
      /\b(?:user|ux|customer)\s+research\b|\buser interviews?\b|\busability (?:testing|tests?|research|studies)\b/iu,
    profilePattern:
      /\b(?:user|ux|customer)\s+research\b|\buser interviews?\b|\busability (?:testing|tests?|research|studies)\b/iu,
  },
  {
    label: "Prototyping",
    category: "skill",
    listingPattern:
      /\b(?:interactive|design|product|ux|ui|clickable|high[- ]fidelity|low[- ]fidelity)\s+prototypes?\b|\bprototyp(?:e|es|ed|ing)\s+(?:user flows?|interfaces?|interactions?|experiences?|designs?)\b/iu,
    profilePattern:
      /\b(?:interactive|design|product|ux|ui|clickable|high[- ]fidelity|low[- ]fidelity)\s+prototypes?\b|\bprototyp(?:e|es|ed|ing)\s+(?:user flows?|interfaces?|interactions?|experiences?|designs?)\b/iu,
    requiresDesignContext: true,
    skillEntryAliases: ["prototyping"],
  },
  {
    label: "Design systems",
    category: "skill",
    listingPattern:
      /\b(?:design systems?|component librar(?:y|ies)|design tokens?)\b/iu,
    profilePattern:
      /\b(?:design systems?|component librar(?:y|ies)|design tokens?)\b/iu,
  },
  {
    label: "Figma",
    category: "skill",
    listingPattern: /\bFigma\b/iu,
    profilePattern: /\bFigma\b/iu,
  },
  {
    label: "Accessibility",
    category: "skill",
    listingPattern:
      /\b(?:accessibility|a11y|WCAG(?:\s*2(?:\.\d)?)?|inclusive design)\b/iu,
    profilePattern:
      /\b(?:accessibility|a11y|WCAG(?:\s*2(?:\.\d)?)?|inclusive design)\b/iu,
  },
];

function containsPhrase(value: string, phrases: readonly string[]): boolean {
  const normalizedValue = ` ${normalizeText(value)} `;
  return phrases.some((phrase) =>
    normalizedValue.includes(` ${normalizeText(phrase)} `),
  );
}

function decodeJobMarkup(value: string): string {
  return value
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#(?:39|x27);/giu, "'")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/<\s*br\s*\/?\s*>/giu, "\n")
    .replace(/<\/?(?:p|li|ul|ol|h[1-6]|section|div)[^>]*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
}

function splitJobEvidence(value: string, minimumLength = 8): string[] {
  return uniqueStrings(
    decodeJobMarkup(value)
      // Compact browser extraction can flatten headings and bullets into one
      // line. Restore those generic semantic boundaries before requirement
      // classification so "Candidate Requirements: - ..." is not treated as
      // an undifferentiated introductory paragraph.
      .replace(
        /\s+(?=(?:candidate requirements?|requirements?|minimum qualifications?|preferred qualifications?|nice to have|what you(?:'ll| will) do|what you should bring|who you are)\s*[:：])/giu,
        "\n",
      )
      .replace(/\s*[:：]\s*-\s+/gu, ":\n")
      .replace(/\s+-\s+(?=[A-Z0-9])/gu, "\n")
      .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z0-9])/u)
      .map((part) => part.replace(/\s+/gu, " ").trim())
      .filter(
        (part) =>
          part.length >= minimumLength && normalizeText(part).length > 0,
      ),
  );
}

function getDescriptionSectionImportance(
  lines: readonly string[],
  index: number,
): JobRequirementImportance | null {
  // A requirement section remains in force through its bullets, regardless
  // of their length. Stop at another heading instead of an arbitrary distance.
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previousLine = lines[previousIndex]!.trim();
    if (
      /^(?:nice[- ]to[- ]have(?: background)?|preferred(?: qualifications?)?|bonus(?: qualifications?)?)[:：]?$/iu.test(
        previousLine,
      )
    ) {
      return "preferred";
    }
    if (
      /^(?:candidate requirements?|requirements?|minimum qualifications?|qualifications?|what (?:you|we) (?:bring|expect|are looking for)|what (?:you['’]ll|you will) need|what we['’]re looking for|what you should bring|must[- ]have(?: background)?)[:：]?$/iu.test(
        previousLine,
      )
    ) {
      return "required";
    }
    if (
      /^(?:about(?: the)? .+|what you(?:['’]ll| will) do|responsibilities|benefits(?: & perks)?|tools and systems|how .+|this role is not|core skills and qualities|the role)[:：]?$/iu.test(
        previousLine,
      )
    ) {
      return null;
    }
  }

  return null;
}

function buildRequirementEvidenceLines(
  posting: MatchAssessmentPostingInput,
): RequirementEvidenceLine[] {
  const descriptionLines = splitJobEvidence(posting.description);
  const descriptionEvidence = descriptionLines.flatMap((text, index) => {
    const sectionImportance = getDescriptionSectionImportance(
      descriptionLines,
      index,
    );
    if (
      sectionImportance === null &&
      !preferredMarkers.test(text) &&
      !explicitDescriptionRequirementMarkers.test(text)
    ) {
      return [];
    }

    return [
      {
        text,
        source: "description" as const,
        sectionImportance,
      },
    ];
  });
  const structuredLines = (
    [
      ["minimum_qualification", posting.minimumQualifications],
      ["preferred_qualification", posting.preferredQualifications],
      ["key_skill", posting.keySkills],
      ["responsibility", posting.responsibilities],
    ] as const
  ).flatMap(([source, values]) =>
    values.flatMap((value) =>
      splitJobEvidence(value, 1).map((text) => ({
        text,
        source,
        sectionImportance: null,
      })),
    ),
  );
  const candidates: RequirementEvidenceLine[] = [
    {
      text: posting.title,
      source: "title",
      sectionImportance: "required",
    },
    ...structuredLines,
    ...descriptionEvidence,
  ];
  const seen = new Set<string>();

  return candidates.filter((line) => {
    const key = `${line.source}|${normalizeText(line.text)}`;
    if (!normalizeText(line.text) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function clip(value: string, limit = 220): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trim()}…`;
}

function containsTechnologySignal(
  value: string,
  technology: (typeof technologySignals)[number],
  context: "narrative" | "requirement_line" | "skill_entry" = "narrative",
): boolean {
  // Punctuation-heavy and ordinary-word technology names cannot safely use
  // the generic normalized phrase matcher. Normalizing `C#` to `c` misses a
  // real requirement, while normalizing `.NET` to `net` and `Go` to `go`
  // turns ordinary prose ("net revenue", "go beyond") into skill gaps.
  switch (technology.label) {
    case "C#":
      return /(?:^|[^\p{L}\p{N}_])(?:c#|c\s*sharp|csharp)(?=$|[^\p{L}\p{N}_])/iu.test(
        value,
      );
    case ".NET":
      return /(?:^|[^\p{L}\p{N}_])(?:\.net|dotnet)(?=$|[^\p{L}\p{N}_])/iu.test(
        value,
      );
    case "Go": {
      const trimmed = value.trim();
      if (/^(?:go|golang)$/iu.test(trimmed) || /\bgolang\b/iu.test(value)) {
        return true;
      }

      return (
        /\b(?:experience|experienced|proficiency|proficient|knowledge|skills?|programming|develop(?:ing|ment)?|build(?:ing|s)?)\b[^.!?\n]{0,48}\bGo\b/u.test(
          value,
        ) ||
        /\bGo\b\s*(?:[,/&|]|\band\b)\s*(?:Java|JavaScript|TypeScript|Python|Rust|C\+\+|Kotlin|Ruby|PHP|Elixir|Kubernetes)\b/u.test(
          value,
        ) ||
        (context !== "narrative" &&
          /\bGo\b[^.!?\n]{0,48}\b(?:required|preferred|proficien(?:cy|t)|experience|programming|language|backend|services?|development)\b/u.test(
            value,
          )) ||
        (context !== "narrative" &&
          /\bGo\s+(?:(?:backend|platform|software|systems?)\s+)?(?:engineer|developer)\b/u.test(
            value,
          )) ||
        (context !== "narrative" &&
          /\b(?:experience|proficiency|proficient|knowledge|programming|language|backend|services?|development)\b[^.!?\n]{0,48}\bgo\b|\bgo\b[^.!?\n]{0,48}\b(?:programming|language|backend|services?|development)\b/iu.test(
            value,
          ))
      );
    }
    case "React":
      return (
        /^react$/iu.test(value.trim()) ||
        /\bReact\b(?!\s+(?:Native|to|with|when|by)\b)/u.test(value)
      );
    default:
      return containsPhrase(value, technology.aliases);
  }
}

function isAlternativeTechnologyLine(line: string): boolean {
  return (
    /\b(?:one|1)\+?\s+(?:or more\s+)?[^.!?\n]{0,48}\b(?:languages?|frameworks?|technologies|stacks?|tools?)\b/iu.test(
      line,
    ) ||
    /\b(?:any of|either|one of|such as|for example|e\.g\.)\b/iu.test(line) ||
    /(?:,|\bor\b)\s*etc\.?\s*[).]?$/iu.test(line.trim())
  );
}

function collectExplicitDomainEvidence(input: {
  profile: CandidateProfile;
  domainPattern: RegExp;
  deliveryPattern: RegExp;
}): ResumeRequirementEvidence[] {
  const evidence: ResumeRequirementEvidence[] = [];
  for (const experience of input.profile.experiences) {
    const matched = [experience.summary, ...experience.achievements]
      .filter((value): value is string => typeof value === "string")
      .find(
        (value) =>
          input.domainPattern.test(value) && input.deliveryPattern.test(value),
      );
    if (matched) {
      evidence.push({
        sourceKind: "experience",
        sourceId: experience.id,
        label: [experience.title, experience.companyName]
          .filter(Boolean)
          .join(" at "),
        detail: clip(matched),
      });
    }
  }

  for (const project of input.profile.projects) {
    const matched = [project.summary, project.outcome]
      .filter((value): value is string => typeof value === "string")
      .find(
        (value) =>
          input.domainPattern.test(value) && input.deliveryPattern.test(value),
      );
    if (matched) {
      evidence.push({
        sourceKind: "project",
        sourceId: project.id,
        label: project.name,
        detail: clip(matched),
      });
    }
  }

  return evidence.slice(0, 3);
}

function dedupeRequirementEvidence(
  evidence: readonly ResumeRequirementEvidence[],
): ResumeRequirementEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((entry) => {
    const key = [entry.sourceKind, entry.sourceId ?? "", entry.detail].join(
      "|",
    );
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreProductionAiEvidenceLine(line: string): number {
  return (
    Number(/\b(?:shipped?|deployed?|launched?)\b/iu.test(line)) * 2 +
    Number(/\bnot just prototypes?\b/iu.test(line)) * 2 +
    Number(/\bproduction\b/iu.test(line))
  );
}

function selectStrongestEvidenceLine(
  lines: readonly string[],
  pattern: RegExp,
): string | null {
  return (
    lines
      .filter((line) => pattern.test(line))
      .sort((left, right) => {
        const importanceRank = (line: string) =>
          requiredMarkers.test(line) ? 0 : preferredMarkers.test(line) ? 1 : 2;
        return importanceRank(left) - importanceRank(right);
      })[0] ?? null
  );
}

function parseCefrLevel(value: string): number | null {
  const match = /\b([ABC])\s*([12])\b/iu.exec(value);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const ranks: Record<string, number> = {
    A1: 1,
    A2: 2,
    B1: 3,
    B2: 4,
    C1: 5,
    C2: 6,
  };
  return ranks[`${match[1].toUpperCase()}${match[2]}`] ?? null;
}

function meetsEnglishProficiency(
  value: string,
  requiredLevel: number | null,
  listing: string,
): boolean {
  if (
    /\b(?:no|not|never|without|basic|beginner|elementary|learning|limited|uncertain|hoping|seeking|aspiring|aiming|want|wish|hope|improving|towards?)\b/iu.test(
      value,
    )
  )
    return false;
  const level = parseCefrLevel(value);
  const native = /\b(?:native|bilingual|mother tongue)\b/iu.test(value);
  if (requiredLevel !== null)
    return level !== null ? level >= requiredLevel : native;
  if (/\bnative\b/iu.test(listing) && !native) return false;
  // A stated CEFR level is more precise than a nearby generic fluency claim.
  if (level !== null) return level >= (/\bfluent\b/iu.test(listing) ? 5 : 4);
  return (
    native ||
    /\bfluent\b/iu.test(value) ||
    (!/\bfluent\b/iu.test(listing) &&
      /\b(?:proficient|professional proficiency)\b/iu.test(value))
  );
}

function summaryEnglishEvidence(summary: string): string | null {
  const lines = splitJobEvidence(summary, 1).filter((line) =>
    /\bEnglish\b/iu.test(line),
  );
  // Explicit uncertainty or lower proficiency cannot be hidden by another
  // sentence saying "fluent". A structured language record wins separately.
  if (
    lines.some((line) =>
      /\b(?:no|not|never|without|basic|beginner|elementary|learning|limited|uncertain|hoping|seeking|aspiring|aiming|want|wish|hope|improving|towards?)\b/iu.test(
        line,
      ),
    )
  )
    return null;
  const explicit = lines.filter(
    (line) =>
      /^(?:I (?:am|speak) |I['’]m )?(?:fluent(?:ly)?(?: in)?|proficient in|native(?: in)?|bilingual(?: in)?) English[.!]?$/iu.test(
        line.trim(),
      ) ||
      /^(?:My )?English\s*(?:(?:is (?:at )?|[:—–-])\s*)?(?:fluent|native|bilingual|professional proficiency|(?:CEFR(?: level)?\s*)?[ABC]\s*[12])[.!]?$/iu.test(
        line.trim(),
      ),
  );
  if (explicit.length === 0) return null;
  const levelLines = lines.filter((line) => parseCefrLevel(line) !== null);
  if (levelLines.some((line) => !explicit.includes(line))) return null;
  const statedLevels = levelLines.sort(
    (left, right) => parseCefrLevel(left)! - parseCefrLevel(right)!,
  );
  return statedLevels[0] ?? explicit[0] ?? null;
}

function inferImportance(input: {
  evidenceLine: RequirementEvidenceLine;
}): JobRequirementImportance {
  if (
    input.evidenceLine.source === "title" ||
    input.evidenceLine.source === "minimum_qualification"
  ) {
    return "required";
  }

  if (
    input.evidenceLine.source === "preferred_qualification" ||
    preferredMarkers.test(input.evidenceLine.text)
  ) {
    return "preferred";
  }

  if (explicitDescriptionRequirementMarkers.test(input.evidenceLine.text)) {
    return "required";
  }

  if (input.evidenceLine.sectionImportance !== null) {
    return input.evidenceLine.sectionImportance;
  }

  return "inferred";
}

function collectProfileRoleEvidence(
  profile: CandidateProfile,
  aliases: readonly string[],
): ResumeRequirementEvidence[] {
  const evidence = profile.experiences.flatMap((experience) => {
    const values = [
      experience.title,
      experience.summary,
      ...experience.achievements,
      ...experience.skills,
    ].filter((value): value is string => typeof value === "string");
    const matched = values.find((value) => containsPhrase(value, aliases));
    if (!matched) {
      return [];
    }

    return [
      {
        sourceKind: "experience" as const,
        sourceId: experience.id,
        label: [experience.title, experience.companyName]
          .filter(Boolean)
          .join(" at "),
        detail: clip(matched),
      },
    ];
  });

  return evidence.slice(0, 3);
}

function collectProfileSkillEvidence(
  profile: CandidateProfile,
  technology: (typeof technologySignals)[number],
): ResumeRequirementEvidence[] {
  const directSkills = uniqueStrings([
    ...profile.skills,
    ...profile.skillGroups.coreSkills,
    ...profile.skillGroups.tools,
    ...profile.skillGroups.languagesAndFrameworks,
    ...profile.skillGroups.highlightedSkills,
  ]);
  const evidence: ResumeRequirementEvidence[] = [];
  const directSkill = directSkills.find((skill) =>
    containsTechnologySignal(skill, technology, "skill_entry"),
  );

  if (directSkill) {
    evidence.push({
      sourceKind: "profile_skill",
      sourceId: null,
      label: `Profile skill: ${directSkill}`,
      detail: `${directSkill} is explicitly listed in the imported profile.`,
    });
  }

  for (const experience of profile.experiences) {
    const values = [
      ...experience.skills,
      ...experience.achievements,
      experience.summary,
    ].filter((value): value is string => typeof value === "string");
    const matched = values.find((value) =>
      containsTechnologySignal(value, technology),
    );
    if (!matched) {
      continue;
    }

    evidence.push({
      sourceKind: "experience",
      sourceId: experience.id,
      label: [experience.title, experience.companyName]
        .filter(Boolean)
        .join(" at "),
      detail: clip(matched),
    });
  }

  for (const project of profile.projects) {
    const values = [...project.skills, project.summary, project.outcome].filter(
      (value): value is string => typeof value === "string",
    );
    const matched = values.find((value) =>
      containsTechnologySignal(value, technology),
    );
    if (!matched) {
      continue;
    }

    evidence.push({
      sourceKind: "project",
      sourceId: project.id,
      label: project.name,
      detail: clip(matched),
    });
  }

  return evidence.slice(0, 3);
}

function hasAffirmativeCapability(
  value: string,
  capability: CapabilitySignal,
): boolean {
  return splitJobEvidence(value, 1).some(
    (line) =>
      capability.profilePattern.test(line) &&
      !/\b(?:no|not|never|without|lack(?:s|ing)?|learning|aspir(?:e|ing)|seeking|hop(?:e|ing))\b/iu.test(
        line,
      ),
  );
}

function matchesCapabilitySkillEntry(
  value: string,
  capability: CapabilitySignal,
): boolean {
  return (
    hasAffirmativeCapability(value, capability) ||
    (capability.skillEntryAliases?.some((alias) =>
      containsPhrase(value, [alias]),
    ) ??
      false)
  );
}

function collectProfileCapabilityEvidence(
  profile: CandidateProfile,
  capability: CapabilitySignal,
): ResumeRequirementEvidence[] {
  const directSkills = uniqueStrings([
    ...profile.skills,
    ...profile.skillGroups.coreSkills,
    ...profile.skillGroups.tools,
    ...profile.skillGroups.languagesAndFrameworks,
    ...profile.skillGroups.highlightedSkills,
  ]);
  const evidence: ResumeRequirementEvidence[] = [];
  const summaryEvidence = splitJobEvidence(profile.summary ?? "", 1).find(
    (line) => hasAffirmativeCapability(line, capability),
  );
  if (summaryEvidence) {
    evidence.push({
      sourceKind: "profile",
      sourceId: profile.id,
      label: "Profile summary",
      detail: clip(summaryEvidence),
    });
  }
  const directSkill = directSkills.find((skill) =>
    matchesCapabilitySkillEntry(skill, capability),
  );
  if (directSkill) {
    evidence.push({
      sourceKind: "profile_skill",
      sourceId: null,
      label: `Profile skill: ${directSkill}`,
      detail: `${directSkill} is explicitly listed in the imported profile.`,
    });
  }

  for (const experience of profile.experiences) {
    const skill = experience.skills.find((value) =>
      matchesCapabilitySkillEntry(value, capability),
    );
    const narrative = [
      experience.title,
      ...experience.achievements,
      experience.summary,
    ]
      .filter((value): value is string => typeof value === "string")
      .find((value) => hasAffirmativeCapability(value, capability));
    const matched = skill ?? narrative;
    if (!matched) {
      continue;
    }

    evidence.push({
      sourceKind: "experience",
      sourceId: experience.id,
      label: [experience.title, experience.companyName]
        .filter(Boolean)
        .join(" at "),
      detail: clip(matched),
    });
  }

  for (const project of profile.projects) {
    const skill = project.skills.find((value) =>
      matchesCapabilitySkillEntry(value, capability),
    );
    const narrative = [project.role, project.summary, project.outcome]
      .filter((value): value is string => typeof value === "string")
      .find((value) => hasAffirmativeCapability(value, capability));
    const matched = skill ?? narrative;
    if (!matched) {
      continue;
    }

    evidence.push({
      sourceKind: "project",
      sourceId: project.id,
      label: project.name,
      detail: clip(matched),
    });
  }

  return dedupeRequirementEvidence(evidence).slice(0, 3);
}

function hasDesignRequirementContext(
  posting: MatchAssessmentPostingInput,
): boolean {
  const context = [
    posting.title,
    posting.department,
    posting.team,
    ...posting.keySkills,
    ...posting.minimumQualifications,
    ...posting.preferredQualifications,
    ...posting.responsibilities,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return /\b(?:designer|product design|ux|ui design|user experience|interaction design|visual design|design systems?|figma|user research)\b/iu.test(
    context,
  );
}

const waivedRequirementPattern =
  /\b(?:not required|no (?:prior )?experience\b[^.!?\n]{0,140}\brequired)\b/iu;

function hasUnwaivedRequirement(
  text: string,
  matches: (clause: string) => boolean,
): boolean {
  // A separate qualification can be waived without waiving this one:
  // "Fluent English (French is not required)" still asks for English.
  const clauses = text
    .replace(/\(([^()]*)\)/gu, (whole: string, content: string) =>
      waivedRequirementPattern.test(content) &&
      !/^\s*not required\s*$/iu.test(content)
        ? `;${content};`
        : whole,
    )
    .split(/;|,\s*(?:but|while|whereas)\s+/iu);
  return clauses.some(
    (clause) => matches(clause) && !waivedRequirementPattern.test(clause),
  );
}

function matchesCapabilityListingLine(
  line: RequirementEvidenceLine,
  capability: CapabilitySignal,
  posting: MatchAssessmentPostingInput,
): boolean {
  if (
    capability.requiresDesignContext === true &&
    !hasDesignRequirementContext(posting)
  ) {
    return false;
  }

  return hasUnwaivedRequirement(
    line.text,
    (clause) =>
      capability.listingPattern.test(clause) ||
      (line.source === "key_skill" &&
        (capability.skillEntryAliases?.some((alias) =>
          containsPhrase(clause, [alias]),
        ) ??
          false)),
  );
}

function requirementId(category: string, label: string): string {
  return `requirement_${category}_${normalizeText(label).replaceAll(" ", "_")}`;
}

export function buildRequirementEvidenceAssessment(input: {
  profile: CandidateProfile;
  posting: MatchAssessmentPostingInput;
  locationCompatibility: LocationCompatibilityState;
  locationRemotePreferenceApplied?: boolean;
  workModeCompatibility: WorkModeCompatibilityState;
  hasLocationPreferences: boolean;
  hasWorkModePreferences: boolean;
  /**
   * Where the listing stands against the saved areas. Only `outside_area`
   * means the job genuinely cannot be done from a saved area, so it is the
   * only reach that can turn a location miss into a blocker.
   */
  locationReach?: MatchLocationReach | undefined;
  /** The saved search rules exclude this listing's stated location. */
  locationExcluded?: boolean | undefined;
  /** The saved search rules exclude every work mode this listing states. */
  workModeExcluded?: boolean | undefined;
  /**
   * Saved target roles, used only as extra career-stage evidence about the
   * candidate. Omitted by callers that have no saved preferences; the
   * career-stage requirement then falls back to the profile alone.
   */
  targetRoles?: readonly string[];
}): JobRequirementAssessment[] {
  const { profile, posting } = input;
  const jobText = [
    posting.title,
    posting.description,
    ...posting.keySkills,
    ...posting.minimumQualifications,
    ...posting.preferredQualifications,
    ...posting.responsibilities,
  ].join("\n");
  const evidenceLines = splitJobEvidence(jobText);
  const requirementEvidenceLines = buildRequirementEvidenceLines(posting);
  const requirements: JobRequirementAssessment[] = [];
  const importanceRank = { required: 0, preferred: 1, inferred: 2 } as const;
  const sourceRank: Record<RequirementEvidenceSource, number> = {
    title: 0,
    minimum_qualification: 1,
    preferred_qualification: 2,
    key_skill: 3,
    responsibility: 4,
    description: 5,
  };
  const compareEvidenceLines = (
    left: RequirementEvidenceLine,
    right: RequirementEvidenceLine,
  ) =>
    importanceRank[inferImportance({ evidenceLine: left })] -
      importanceRank[inferImportance({ evidenceLine: right })] ||
    sourceRank[left.source] - sourceRank[right.source];
  const evidenceLineKey = (line: RequirementEvidenceLine) =>
    `${line.source}|${normalizeText(line.text)}`;

  const technologyMatches = technologySignals.flatMap((technology) => {
    const matchingEvidenceLines = requirementEvidenceLines.filter((line) =>
      containsTechnologySignal(
        line.text,
        technology,
        line.source === "key_skill" ? "skill_entry" : "requirement_line",
      ),
    );
    const evidenceLine = [...matchingEvidenceLines].sort(
      compareEvidenceLines,
    )[0];
    if (!evidenceLine) {
      return [];
    }

    return [{ technology, evidenceLine }];
  });
  const alternativeTechnologyLines = uniqueStrings(
    technologyMatches
      .map((match) => evidenceLineKey(match.evidenceLine))
      .filter((lineKey) => {
        const matchingLine = technologyMatches.find(
          (match) => evidenceLineKey(match.evidenceLine) === lineKey,
        )?.evidenceLine;
        return Boolean(
          matchingLine &&
          isAlternativeTechnologyLine(matchingLine.text) &&
          technologyMatches.filter(
            (match) => evidenceLineKey(match.evidenceLine) === lineKey,
          ).length >= 2,
        );
      }),
  );
  const alternativeTechnologyRequirements = alternativeTechnologyLines.map(
    (lineKey) => {
      const alternatives = technologyMatches.filter(
        (match) => evidenceLineKey(match.evidenceLine) === lineKey,
      );
      const evidenceLine = alternatives[0]!.evidenceLine;
      const resumeEvidence = dedupeRequirementEvidence(
        alternatives.flatMap((match) =>
          collectProfileSkillEvidence(profile, match.technology),
        ),
      );
      const labels = alternatives.map((match) => match.technology.label);

      return {
        id: requirementId("skill", `one of ${labels.join(" ")}`),
        category: "skill" as const,
        label: `One of: ${labels.join(", ")}`,
        importance: inferImportance({ evidenceLine }),
        status:
          resumeEvidence.length > 0
            ? ("supported" as const)
            : ("missing" as const),
        jobEvidence: clip(evidenceLine.text),
        resumeEvidence,
        explanation:
          resumeEvidence.length > 0
            ? `The resume contains explicit evidence for at least one accepted technology (${labels.join(", ")}).`
            : `No explicit evidence was found for any accepted technology (${labels.join(", ")}).`,
      };
    },
  );
  const technologyRequirements = technologyMatches.flatMap(
    ({ technology, evidenceLine }) => {
      if (alternativeTechnologyLines.includes(evidenceLineKey(evidenceLine))) {
        return [];
      }

      const importance = inferImportance({ evidenceLine });
      const resumeEvidence = collectProfileSkillEvidence(profile, technology);

      return [
        {
          id: requirementId("skill", technology.label),
          category: "skill" as const,
          label: technology.label,
          importance,
          status:
            resumeEvidence.length > 0
              ? ("supported" as const)
              : ("missing" as const),
          jobEvidence: clip(evidenceLine.text),
          resumeEvidence,
          explanation:
            resumeEvidence.length > 0
              ? `The resume contains explicit ${technology.label} evidence.`
              : `No explicit ${technology.label} evidence was found in the imported resume.`,
        },
      ];
    },
  );

  const capabilityRequirements = capabilitySignals.flatMap((capability) => {
    const evidenceLine = requirementEvidenceLines
      .filter((line) => line.source !== "title")
      .filter((line) => matchesCapabilityListingLine(line, capability, posting))
      .sort(compareEvidenceLines)[0];
    if (!evidenceLine) {
      return [];
    }

    const resumeEvidence = collectProfileCapabilityEvidence(
      profile,
      capability,
    );
    return [
      {
        id: requirementId(capability.category, capability.label),
        category: capability.category,
        label: capability.label,
        importance: inferImportance({ evidenceLine }),
        status:
          resumeEvidence.length > 0
            ? ("supported" as const)
            : ("missing" as const),
        jobEvidence: clip(evidenceLine.text),
        resumeEvidence,
        explanation:
          resumeEvidence.length > 0
            ? `The resume contains explicit ${capability.label.toLowerCase()} evidence.`
            : `No explicit ${capability.label.toLowerCase()} evidence was found in the imported resume.`,
      },
    ];
  });

  requirements.push(
    ...[...alternativeTechnologyRequirements, ...technologyRequirements]
      .sort((left, right) => {
        return (
          importanceRank[left.importance] - importanceRank[right.importance]
        );
      })
      .slice(0, 12),
    ...capabilityRequirements.sort(
      (left, right) =>
        importanceRank[left.importance] - importanceRank[right.importance],
    ),
  );

  const productionAiLine = evidenceLines
    .filter(
      (line) =>
        /\b(?:AI|artificial intelligence|LLMs?|large language models?|RAG|retrieval[- ]augmented generation|AI agents?)\b/iu.test(
          line,
        ) &&
        /\b(?:hands[- ]on|production|shipped?|deployed?|launched?|real (?:AI )?use case|not just prototypes?)\b/iu.test(
          line,
        ),
    )
    .sort(
      (left, right) =>
        scoreProductionAiEvidenceLine(right) -
        scoreProductionAiEvidenceLine(left),
    )[0];
  if (productionAiLine) {
    const resumeEvidence = collectExplicitDomainEvidence({
      profile,
      domainPattern:
        /\b(?:AI|artificial intelligence|LLMs?|large language models?|RAG|retrieval[- ]augmented generation|AI agents?|machine learning)\b/iu,
      deliveryPattern:
        /\b(?:production|shipped?|deployed?|launched?|released?|customers?|users?|live)\b/iu,
    });
    requirements.push({
      id: requirementId("domain", "production AI feature delivery"),
      category: "domain",
      label: "Production AI feature delivery",
      importance: requiredMarkers.test(productionAiLine)
        ? "required"
        : "inferred",
      status: resumeEvidence.length > 0 ? "supported" : "missing",
      jobEvidence: clip(productionAiLine),
      resumeEvidence,
      explanation:
        resumeEvidence.length > 0
          ? "The resume explicitly shows an AI or LLM feature shipped to production users."
          : "The resume does not explicitly show an AI or LLM feature shipped to production; generic AI interest or prototypes are not treated as evidence.",
    });
  }

  const productionScaleLine = evidenceLines.find((line) =>
    /\b(?:high[- ]traffic|production applications?[^.!?]{0,40}(?:scale|scaling)|challenges? that come with scale|query optimization|performance bottlenecks?|careful migrations)\b/iu.test(
      line,
    ),
  );
  if (productionScaleLine) {
    const resumeEvidence = collectExplicitDomainEvidence({
      profile,
      domainPattern:
        /\b(?:high[- ]traffic|large[- ]scale|at scale|production scale|millions? of (?:users|requests|transactions)|thousands? of (?:requests|transactions) (?:per|a)|query optimization|performance bottlenecks?|zero[- ]downtime migrations?)\b/iu,
      deliveryPattern:
        /\b(?:production|shipped?|deployed?|launched?|scaled?|optimized?|handled?|served?|users?|requests?|transactions?|migrations?)\b/iu,
    });
    requirements.push({
      id: requirementId("domain", "high traffic production scaling"),
      category: "domain",
      label: "High-traffic production scaling",
      importance:
        requiredMarkers.test(productionScaleLine) ||
        /\b\d{1,2}\+?\s*years?\s+(?:of\s+)?experience\b/iu.test(
          productionScaleLine,
        )
          ? "required"
          : "inferred",
      status: resumeEvidence.length > 0 ? "supported" : "missing",
      jobEvidence: clip(productionScaleLine),
      resumeEvidence,
      explanation:
        resumeEvidence.length > 0
          ? "The resume explicitly shows production work at material traffic or scaling depth."
          : "The resume does not explicitly show high-traffic production scaling; general performance work is not treated as proof of traffic scale.",
    });
  }

  const experimentationLine = selectStrongestEvidenceLine(
    evidenceLines,
    /\b(?:experimentation|experiments?|A\/?B tests?)\b/iu,
  );
  if (experimentationLine) {
    const resumeEvidence = collectProfileRoleEvidence(profile, [
      "experimentation",
      "experiment",
      "experiments",
      "A/B",
      "A/B tests",
      "A/B testing",
    ]);
    requirements.push({
      id: requirementId("domain", "experimentation and measurement"),
      category: "domain",
      label: "Experimentation and measurement",
      importance: requiredMarkers.test(experimentationLine)
        ? "required"
        : preferredMarkers.test(experimentationLine)
          ? "preferred"
          : "inferred",
      status: resumeEvidence.length > 0 ? "supported" : "missing",
      jobEvidence: clip(experimentationLine),
      resumeEvidence,
      explanation:
        resumeEvidence.length > 0
          ? "The resume explicitly shows experimentation or A/B testing experience."
          : "The resume does not explicitly show designing, running, or measuring experiments.",
    });
  }

  const englishProficiencyPattern =
    /\b(?:English[^.!?\n]{0,60}(?:CEFR\s+Level\s+)?[ABC][12]|(?:proficient|fluent|professional proficiency|native)[^.!?\n]{0,24}English)\b/iu;
  const englishProficiencyLine = selectStrongestEvidenceLine(
    evidenceLines.filter((line) =>
      hasUnwaivedRequirement(line, (clause) =>
        englishProficiencyPattern.test(clause),
      ),
    ),
    englishProficiencyPattern,
  );
  if (englishProficiencyLine) {
    const englishRecord = profile.spokenLanguages.find(
      (language) => normalizeText(language.language) === "english",
    );
    const requiredLevel = parseCefrLevel(englishProficiencyLine);
    const summaryEvidence = englishRecord
      ? null
      : summaryEnglishEvidence(profile.summary ?? "");
    const proficiency = englishRecord?.proficiency ?? summaryEvidence ?? "";
    const supported = meetsEnglishProficiency(
      proficiency,
      requiredLevel,
      englishProficiencyLine,
    );
    const resumeEvidence =
      englishRecord || summaryEvidence
        ? [
            {
              sourceKind: "profile" as const,
              sourceId: profile.id,
              label: englishRecord ? "English proficiency" : "Profile summary",
              detail: englishRecord
                ? [englishRecord.language, englishRecord.proficiency]
                    .filter(Boolean)
                    .join(" — ")
                : summaryEvidence!,
            },
          ]
        : [];
    requirements.push({
      id: requirementId("domain", "English proficiency"),
      category: "domain",
      label:
        requiredLevel === null
          ? "English proficiency"
          : "English proficiency at the stated CEFR level",
      importance:
        requiredMarkers.test(englishProficiencyLine) ||
        /\byou (?:are|must|need to be)\b/iu.test(englishProficiencyLine)
          ? "required"
          : "inferred",
      status: supported ? "supported" : "missing",
      jobEvidence: clip(englishProficiencyLine),
      resumeEvidence,
      explanation: supported
        ? "The saved English proficiency meets the listing's stated level."
        : englishRecord
          ? "English is present in the profile, but the saved proficiency does not meet the listing's stated level."
          : "The profile does not contain explicit English proficiency evidence.",
    });
  }

  if (/\b(?:site reliability|sre)\b/iu.test(posting.title)) {
    const aliases = [
      "site reliability",
      "sre",
      "kubernetes",
      "terraform",
      "incident response",
      "on call",
    ];
    const resumeEvidence = collectProfileRoleEvidence(profile, aliases);
    requirements.push({
      id: requirementId("domain", "site reliability operations"),
      category: "domain",
      label: "Site reliability operations",
      importance: "required",
      status: resumeEvidence.length > 0 ? "supported" : "missing",
      jobEvidence: posting.title,
      resumeEvidence,
      explanation:
        resumeEvidence.length > 0
          ? "The resume contains explicit production-operations or site-reliability evidence."
          : "The resume does not explicitly show SRE, on-call, incident-response, observability, Kubernetes, or infrastructure-as-code ownership.",
    });
  }

  const yearsEvidenceLine = evidenceLines.find((line) =>
    /\b\d{1,2}\+?\s*(?:years|yrs)\b.*\bexperience\b|\bexperience\b.*\b\d{1,2}\+?\s*(?:years|yrs)\b/iu.test(
      line,
    ),
  );
  const yearsMatch = yearsEvidenceLine?.match(
    /\b(\d{1,2})\+?\s*(?:years|yrs)\b/iu,
  );
  if (yearsEvidenceLine && yearsMatch?.[1]) {
    const requiredYears = Number.parseInt(yearsMatch[1], 10);
    const supported = profile.yearsExperience >= requiredYears;
    requirements.push({
      id: requirementId("experience", `${requiredYears} years`),
      category: "experience",
      label: `${requiredYears}+ years of experience`,
      importance: preferredMarkers.test(yearsEvidenceLine)
        ? "preferred"
        : "required",
      status: supported ? "supported" : "missing",
      jobEvidence: clip(yearsEvidenceLine),
      resumeEvidence: [
        {
          sourceKind: "profile",
          sourceId: profile.id,
          label: "Imported experience timeline",
          detail: `${profile.yearsExperience} years of experience are recorded in the profile.`,
        },
      ],
      explanation: supported
        ? "The imported experience timeline meets the stated threshold."
        : "The imported experience timeline is below the stated threshold.",
    });
  }

  // Career stage is checked before eligibility so an opening reserved for
  // entrants surfaces as the first hard conflict on the row.
  const careerStageRequirement = buildCareerStageRequirement({
    profile,
    posting,
    searchPreferences: { targetRoles: input.targetRoles ?? [] },
  });
  if (careerStageRequirement) {
    requirements.push(careerStageRequirement);
  }

  requirements.push(
    ...buildEligibilityRequirementAssessments({ profile, posting }),
  );

  if (input.hasLocationPreferences) {
    // A saved area is a preference, not a rule the listing broke. Being
    // outside it sinks the listing through the score; it may only block the
    // listing when the person ruled the place out themselves, or when the job
    // cannot be done from any saved area at all (on site, elsewhere, and
    // relocation ruled out). Anything else stays a "check this" row, so a
    // wanted job is never thrown out for sitting one city over.
    const locationUnreachable =
      input.locationReach === "outside_area" &&
      profile.workEligibility.willingToRelocate === false;
    const locationStatus: JobRequirementAssessment["status"] =
      input.locationCompatibility === "compatible"
        ? "supported"
        : input.locationCompatibility === "unknown"
          ? "unknown"
          : input.locationExcluded === true || locationUnreachable
            ? "conflict"
            : "unknown";
    // A stored absence placeholder ("Location not stated") is not a stated
    // location: it must not become a "Location: Location not stated" label or
    // pose as captured listing evidence.
    const rawLocation = posting.location.trim();
    const statedLocation = isAbsentFieldText(rawLocation) ? "" : rawLocation;
    const locationExplanation = input.locationRemotePreferenceApplied
      ? input.locationCompatibility === "compatible"
        ? "Remote listing; remote is one of your preferred work modes."
        : "Remote listing; remote is one of your preferred work modes, but its stated region may exclude the saved search areas."
      : input.locationCompatibility === "compatible"
        ? "The listing location is compatible with the saved search area."
        : input.locationCompatibility === "unknown"
          ? statedLocation
            ? "The listing does not specify enough geographic detail to verify it against the saved search areas."
            : "The listing does not state a location, so it could not be compared with the saved search areas."
          : input.locationExcluded === true
            ? "The listing location is one you asked the search to leave out."
            : locationUnreachable
              ? "The listing is on site outside the saved search area and the profile rules out relocation."
              : "The listing location is outside the saved search area; relocation needs confirmation.";
    requirements.push({
      id: requirementId("location", statedLocation || "not stated"),
      category: "location",
      // A missing location must not produce a dangling "Location: " label.
      label: statedLocation
        ? `Location: ${statedLocation}`
        : "Location (not stated in listing)",
      importance: "required",
      status: locationStatus,
      jobEvidence: statedLocation || "The listing does not state a location.",
      resumeEvidence: profile.currentLocation
        ? [
            {
              sourceKind: "profile",
              sourceId: profile.id,
              label: "Current location",
              detail: profile.currentLocation,
            },
          ]
        : [],
      explanation: locationExplanation,
    });
  }

  // When the user saved a work-mode preference, the check must always show
  // up. Omitting the row when the listing states no work mode read as "the
  // work mode is fine", and an in-office role topped a remote-only search.
  if (input.hasWorkModePreferences && posting.workMode.length === 0) {
    requirements.push({
      id: requirementId("work_mode", "not stated"),
      category: "work_mode",
      label: "Work mode (not stated in listing)",
      importance: "required",
      status: "unknown",
      jobEvidence: "The listing does not state a work mode.",
      resumeEvidence: [],
      explanation:
        "This listing does not publish a work mode, so it could not be confirmed against your saved preference. Check the listing before you apply.",
    });
  }

  if (input.hasWorkModePreferences && posting.workMode.length > 0) {
    const isRemotePosting = posting.workMode.includes("remote");
    // A work mode the person did not tick is a preference miss, not a
    // blocker: the score already sinks it. Only a mode they explicitly ruled
    // out can throw the listing away, so ticking hybrid can never be the
    // reason a hybrid job is skipped.
    const workModeStatus =
      input.workModeCompatibility === "conflict"
        ? input.workModeExcluded === true
          ? "conflict"
          : "missing"
        : input.workModeCompatibility === "unknown"
          ? "unknown"
          : isRemotePosting && profile.workEligibility.remoteEligible === false
            ? "conflict"
            : isRemotePosting && profile.workEligibility.remoteEligible === null
              ? "unknown"
              : "supported";
    requirements.push({
      id: requirementId("work_mode", posting.workMode.join(" ")),
      category: "work_mode",
      label: `Work mode: ${uniqueStrings(posting.workMode).join(", ")}`,
      importance: "required",
      status: workModeStatus,
      jobEvidence: uniqueStrings([posting.location, ...posting.workMode]).join(
        "; ",
      ),
      resumeEvidence: [
        {
          sourceKind: "profile",
          sourceId: profile.id,
          label: "Remote-work eligibility",
          detail:
            profile.workEligibility.remoteEligible === null
              ? "Remote-work eligibility is not confirmed in the profile."
              : profile.workEligibility.remoteEligible
                ? "The profile confirms remote-work eligibility."
                : "The profile does not confirm remote-work eligibility.",
        },
      ],
      explanation:
        input.workModeCompatibility === "conflict"
          ? input.workModeExcluded === true
            ? "You asked the search to leave this work mode out."
            : "The listing work mode is not one you ticked, so it ranks lower rather than being thrown out."
          : input.workModeCompatibility === "unknown"
            ? "The listing does not state a concrete work mode, so it cannot be verified against the saved preference."
            : isRemotePosting && profile.workEligibility.remoteEligible === null
              ? "The listing matches the saved remote-work preference, but remote-work eligibility is not confirmed in the profile."
              : isRemotePosting &&
                  profile.workEligibility.remoteEligible === false
                ? "The listing is remote, but the profile does not confirm remote-work eligibility."
                : "The listing work mode matches the saved preference.",
    });
  }

  const noSponsorshipLine = evidenceLines.find((line) =>
    /\b(?:no|not)\s+(?:visa\s+)?sponsorship|\bmust\s+(?:already\s+)?(?:have|hold)\b.*\b(?:work authorization|right to work)\b/iu.test(
      line,
    ),
  );
  if (noSponsorshipLine) {
    const sponsorship = profile.workEligibility.requiresVisaSponsorship;
    requirements.push({
      id: requirementId("work_authorization", "work authorization"),
      category: "work_authorization",
      label: "Work authorization without sponsorship",
      importance: "required",
      status:
        sponsorship === true
          ? "conflict"
          : sponsorship === false
            ? "supported"
            : "unknown",
      jobEvidence: clip(noSponsorshipLine),
      resumeEvidence:
        sponsorship === null
          ? []
          : [
              {
                sourceKind: "profile",
                sourceId: profile.id,
                label: "Visa sponsorship preference",
                detail: sponsorship
                  ? "The profile records that visa sponsorship is required."
                  : "The profile records that visa sponsorship is not required.",
              },
            ],
      explanation:
        sponsorship === true
          ? "The listing rejects sponsorship while the profile records that sponsorship is required."
          : sponsorship === false
            ? "The saved sponsorship preference is compatible with the listing."
            : "Work-authorization evidence is missing from the profile and needs confirmation.",
    });
  }

  return requirements;
}

/**
 * Location, work mode, and work authorization are compared with saved
 * preferences and profile facts, never with resume evidence, so their
 * rationale must not claim that a resume failed to prove them.
 * Returns `null` for the resume-evidence categories (skills, experience,
 * seniority, domain), which keep the evidence-shaped sentence.
 */
function preferenceRequirementRationale(
  requirement: JobRequirementAssessment,
): string | null {
  switch (requirement.category) {
    case "location": {
      // "Could not be compared" contradicted the explanation four lines down
      // when the listing did state a location outside the saved areas and
      // only relocation was unconfirmed. Name what was observed instead.
      // The label is "Location: <stated>" or "Location (not stated in
      // listing)"; the evidence field is not reliably the location itself.
      const statedLocation = requirement.label.startsWith("Location: ")
        ? requirement.label.slice("Location: ".length).trim()
        : "";
      const outsideButUnconfirmed =
        requirement.status === "unknown" &&
        statedLocation.length > 0 &&
        requirement.explanation.includes("outside the saved search area");
      if (outsideButUnconfirmed) {
        return `This job is in ${statedLocation}, outside your saved search areas — your profile does not say whether you would relocate.`;
      }
      return requirement.status === "unknown"
        ? "The listing location could not be compared with the saved search areas yet."
        : statedLocation
          ? `This job is in ${statedLocation}, outside your saved search areas.`
          : "The listing location is outside the saved search areas.";
    }
    case "work_mode":
      if (requirement.status !== "unknown") {
        return `${requirement.label} — does not match your preferred work modes.`;
      }
      if (requirement.label.startsWith("Work mode (not stated")) {
        return "The listing does not say whether the job is remote, hybrid or on site.";
      }
      // The listing said remote plainly; what is unknown is the person's own
      // remote eligibility, so the row names that field instead of blaming
      // the listing.
      if (
        /remote-work eligibility is not confirmed/iu.test(
          requirement.explanation,
        )
      ) {
        return `${requirement.label} — fits your preferred work modes, but your profile does not say yet whether you can work remotely. Answer it in Profile under work eligibility and the score updates.`;
      }
      return `${requirement.label} — not stated clearly enough to compare with your preferred work modes.`;
    case "work_authorization":
      return requirement.status === "unknown"
        ? "Work authorization is not stated in your profile yet."
        : "Work authorization does not match what this listing requires.";
    default:
      return null;
  }
}

export function buildFitRecommendation(input: {
  score: number;
  requirements: readonly JobRequirementAssessment[];
}): {
  recommendation: FitRecommendation;
  rationale: string;
} {
  const hardConflicts = input.requirements.filter(
    (requirement) =>
      requirement.importance === "required" &&
      requirement.status === "conflict",
  );
  const missingRequired = input.requirements.filter(
    (requirement) =>
      requirement.importance === "required" && requirement.status === "missing",
  );
  const unknownRequired = input.requirements.filter(
    (requirement) =>
      requirement.importance === "required" && requirement.status === "unknown",
  );
  const missingDetected = input.requirements.filter(
    (requirement) => requirement.status === "missing",
  );

  if (hardConflicts.length > 0) {
    return {
      recommendation: "skip",
      rationale: `${hardConflicts[0]!.label} conflicts with the saved profile or search preferences.`,
    };
  }

  if (missingRequired.length > 0 || unknownRequired.length > 0) {
    const requirement = missingRequired[0] ?? unknownRequired[0]!;
    return {
      recommendation: "review_before_applying",
      rationale:
        preferenceRequirementRationale(requirement) ??
        `${requirement.label} is not yet supported by explicit resume evidence.`,
    };
  }

  if (missingDetected.length >= 3) {
    return {
      recommendation: "review_before_applying",
      rationale: `${missingDetected.length} detected requirements are not backed by explicit resume evidence.`,
    };
  }

  if (input.score >= 86 && missingDetected.length === 0) {
    return {
      recommendation: "strong_fit",
      rationale:
        "No hard conflicts or unsupported required requirements were detected.",
    };
  }

  if (input.score >= 72) {
    return {
      recommendation: "apply_with_original",
      rationale:
        "The original resume has credible evidence for the detected requirements, with no hard blocker found.",
    };
  }

  return {
    recommendation: "review_before_applying",
    rationale:
      "The fit is plausible, but the evidence is not strong enough for an unqualified recommendation.",
  };
}
