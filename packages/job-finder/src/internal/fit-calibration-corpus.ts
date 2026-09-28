import {
  CandidateProfileSchema,
  JobPostingSchema,
  JobSearchPreferencesSchema,
  type CandidateProfile,
  type JobPosting,
  type JobSearchPreferences,
} from "@nordri/contracts";
import type {
  FitCalibrationCase,
  FitCalibrationCorpus,
  FitCalibrationDimensionExpectation,
  FitCalibrationDisposition,
  FitCalibrationRequirementExpectation,
  FitScenarioTag,
} from "./fit-calibration-types";

const NOW = "2026-07-01T12:00:00.000Z";
const CASE_RATIONALES: Readonly<Record<string, string>> = {
  eng_exact_supported_emea:
    "Exact target, supported requirements, eligible region, and comparable pay.",
  eng_fullstack_supported_global:
    "Exact full-stack target with supported evidence; missing pay remains neutral.",
  eng_backend_node_supported:
    "Direct backend target with explicit production evidence.",
  eng_frontend_adjacent_supported:
    "Credible adjacent specialization backed by frontend evidence.",
  eng_platform_adjacent_supported:
    "Adjacent platform scope is supported but not an exact saved title.",
  eng_exact_required_go_missing:
    "The title fits, but two required technologies lack evidence.",
  eng_staff_sre_ops_missing:
    "Staff scope and required SRE depth are not supported.",
  eng_card_only_exact:
    "An exact card title is insufficient for an unqualified recommendation.",
  eng_below_minimum_usd:
    "Fit is otherwise strong, but stated pay is below the saved minimum.",
  eng_data_wrong_family:
    "Data engineering falls outside the saved software and full-stack targets.",
  eng_solutions_sales_body: "The title masks a quota-carrying pre-sales role.",
  eng_talent_pool_not_opening:
    "A talent community is not an actionable current vacancy.",
  eng_us_only_no_sponsorship:
    "US-only eligibility and no sponsorship conflict with the profile.",
  cs_exact_onboarding_renewals:
    "Exact nontechnical target with grounded onboarding and renewal evidence.",
  cs_senior_exact_supported:
    "Exact senior scope, location, and work mode align.",
  cs_onboarding_manager_adjacent:
    "Saved adjacent target with strong onboarding evidence.",
  cs_support_manager_adjacent:
    "Support leadership is adjacent and uses evidenced capabilities.",
  cs_implementation_manager_adjacent:
    "Implementation scope is adjacent and grounded in onboarding work.",
  cs_technical_sql_missing:
    "Customer-success scope fits, but required SQL and Salesforce evidence is absent.",
  cs_card_only_exact:
    "A title-only nontechnical card needs evidence before recommendation.",
  cs_below_minimum:
    "Explicit compensation is materially below the saved minimum.",
  cs_account_executive_wrong_family:
    "A quota-carrying sales role is outside customer-success targets.",
  cs_software_engineer_customer_platform:
    "Customer-success wording names the product, not the candidate role.",
  cs_talent_pool_not_opening: "Future opportunities are not an active vacancy.",
  cs_onsite_no_relocation:
    "Mandatory Madrid attendance conflicts with location, work mode, and relocation facts.",
  cs_us_only_sponsorship_conflict:
    "US-only authorization and no sponsorship conflict with the UK profile.",
  transition_ux_engineer_react_figma:
    "The intended career move is backed by coded design-system evidence.",
  transition_design_systems_engineer:
    "Exact transition target with strong transferable evidence.",
  transition_ui_engineer_accessibility:
    "Exact target with relevant evidence but limited engineering tenure.",
  transition_frontend_design_systems:
    "Adjacent engineering role grounded in design-system implementation.",
  transition_product_engineer_supported:
    "Adjacent product engineering uses explicit transition evidence.",
  transition_product_designer_old_path:
    "Capability fits, but the role moves away from the stated transition.",
  transition_principal_ux_scope_gap:
    "Target direction fits, but principal engineering scope is unsupported.",
  transition_typescript_required_missing:
    "React is supported, but required production TypeScript is not.",
  transition_card_only_ux_engineer:
    "A card-only transition role requires evidence review.",
  transition_backend_go_wrong:
    "Backend infrastructure is outside both target and evidence.",
  transition_ux_researcher_wrong:
    "Shared UX wording does not make research an engineering match.",
  transition_talent_pool_not_opening:
    "A talent network is not a current vacancy.",
  transition_apac_only:
    "APAC-only residency and no sponsorship conflict with UK eligibility.",
  region_uk_remote: "Exact target with explicit UK remote eligibility.",
  region_london_hybrid:
    "Exact target, London location, and hybrid preference align.",
  region_worldwide_remote:
    "Worldwide remote explicitly includes the candidate country.",
  region_emea_includes_uk:
    "EMEA evidence explicitly includes the United Kingdom.",
  region_europe_unspecified:
    "Broad Europe evidence is plausible but not explicit enough to promote.",
  region_eur_pay_incomparable:
    "Foreign-currency pay is incomparable and therefore fit-neutral.",
  region_remote_no_geography:
    "Remote without eligible geography requires confirmation.",
  region_location_not_listed:
    "Missing location and eligibility evidence must remain unresolved.",
  region_clearance_required_unknown:
    "Required clearance is unknown and cannot be treated as supported.",
  region_eu_only_excludes_uk:
    "The listing excludes the candidate country and offers no sponsorship.",
  region_us_only_no_sponsor:
    "US-only authorization and no sponsorship explicitly conflict.",
  region_apac_only:
    "APAC-only residency and no sponsorship conflict with UK eligibility.",
  region_berlin_onsite_no_relocation:
    "Mandatory Berlin attendance conflicts with no relocation and remote preferences.",
};

type PersonaInput = {
  id: string;
  name: [string, string];
  headline: string;
  location: string;
  years: number;
  skills: string[];
  experienceTitle: string;
  countries: string[];
};

function persona(input: PersonaInput): CandidateProfile {
  const [firstName, lastName] = input.name;
  const evidence = `${input.headline}. ${input.skills.join(", ")}.`;
  return CandidateProfileSchema.parse({
    id: input.id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    headline: input.headline,
    summary: evidence,
    currentLocation: input.location,
    yearsExperience: input.years,
    baseResume: {
      id: `${input.id}_resume`,
      fileName: `${input.id}.pdf`,
      uploadedAt: NOW,
      textContent: evidence,
      extractionStatus: "ready",
    },
    workEligibility: {
      authorizedWorkCountries: input.countries,
      requiresVisaSponsorship: true,
      willingToRelocate: false,
      remoteEligible: true,
      securityClearance: null,
    },
    skillGroups: {
      coreSkills: input.skills,
      tools: input.skills,
      languagesAndFrameworks: input.skills,
      highlightedSkills: input.skills.slice(0, 5),
    },
    skills: input.skills,
    experiences: [
      {
        id: `${input.id}_experience`,
        companyName: "Established Employer",
        title: input.experienceTitle,
        employmentType: "Full-time",
        location: input.location,
        workMode: ["remote"],
        startDate: "2018-01",
        endDate: null,
        isCurrent: true,
        summary: evidence,
        achievements: [`Delivered ${input.skills.join(", ")} in production.`],
        skills: input.skills,
      },
    ],
  });
}

function preferences(input: {
  roles: string[];
  locations: string[];
  workModes?: Array<"remote" | "hybrid" | "onsite" | "flexible">;
  minimumSalaryUsd: number;
}): JobSearchPreferences {
  return JobSearchPreferencesSchema.parse({
    targetRoles: input.roles,
    locations: input.locations,
    workModes: input.workModes ?? ["remote"],
    seniorityLevels: ["Senior"],
    employmentTypes: ["Full-time"],
    minimumSalaryUsd: input.minimumSalaryUsd,
    approvalMode: "review_before_submit",
    tailoringMode: "balanced",
  });
}

type CaseExtra = {
  salaryText?: string | null;
  workMode?: JobPosting["workMode"];
  detailQuality?: JobPosting["detailQuality"];
  seniority?: string | null;
  employmentType?: string | null;
  keySkills?: string[];
  minimumQualifications?: string[];
  screeningHints?: Partial<JobPosting["screeningHints"]>;
  hardConflict?: boolean;
  expectedDimensions?: FitCalibrationDimensionExpectation;
  expectedRequirements?: FitCalibrationRequirementExpectation[];
};

type CaseSpec = [
  id: string,
  title: string,
  location: string,
  description: string,
  grade: 0 | 1 | 2 | 3,
  disposition: FitCalibrationDisposition,
  tags: FitScenarioTag[],
  extra?: CaseExtra,
];

function cases(cohortId: string, specs: CaseSpec[]): FitCalibrationCase[] {
  return specs.map(
    (
      [id, title, location, description, grade, disposition, tags, extra = {}],
      index,
    ) => ({
      id,
      posting: JobPostingSchema.parse({
        source: "target_site",
        sourceJobId: `${cohortId}_${id}`,
        // Calibration postings model the output of a completed listing-route
        // discovery run.  Keep this explicit so their session-bound
        // assessment is authoritative in the ranking benchmark rather than
        // inheriting the schema's offline catalog default.
        discoveryMethod: "browser_agent",
        collectionMethod: "listing_route",
        canonicalUrl: `https://jobs.example.test/${cohortId}/${id}`,
        applicationUrl: `https://apply.example.test/${cohortId}/${id}`,
        title,
        company: `Calibration Employer ${index + 1}`,
        location,
        workMode: extra.workMode ?? ["remote"],
        applyPath: "external_redirect",
        easyApplyEligible: false,
        postedAt: NOW,
        discoveredAt: NOW,
        salaryText: extra.salaryText ?? null,
        detailQuality: extra.detailQuality ?? "detail_enriched",
        description,
        keySkills: extra.keySkills ?? [],
        minimumQualifications: extra.minimumQualifications ?? [],
        seniority: extra.seniority === undefined ? "Senior" : extra.seniority,
        employmentType:
          extra.employmentType === undefined
            ? "Full-time"
            : extra.employmentType,
        screeningHints: extra.screeningHints ?? {},
      }),
      label: {
        grade,
        disposition,
        hardConflict: extra.hardConflict ?? false,
        rationale:
          CASE_RATIONALES[id] ??
          `Calibration case ${id} is missing an independent label rationale.`,
        tags,
        ...(extra.expectedDimensions
          ? { expectedDimensions: extra.expectedDimensions }
          : {}),
        ...(extra.expectedRequirements
          ? { expectedRequirements: extra.expectedRequirements }
          : {}),
      },
    }),
  );
}

const engineer = persona({
  id: "fit_engineer",
  name: ["Alex", "Morgan"],
  headline: "Senior Full-Stack Software Engineer",
  location: "Prishtina, Kosovo",
  years: 9,
  skills: [
    "TypeScript",
    "JavaScript",
    "React",
    "Node.js",
    "AWS",
    "Docker",
    "PostgreSQL",
  ],
  experienceTitle: "Senior Software Engineer",
  countries: ["Kosovo"],
});
const engineerPreferences = preferences({
  roles: [
    "Senior Software Engineer",
    "Senior Full-Stack Engineer",
    "Senior Backend Engineer",
  ],
  locations: ["Prishtina, Kosovo", "Remote-EMEA"],
  minimumSalaryUsd: 120_000,
});
const engineeringEvidence =
  "Required: 5+ years of experience with TypeScript, React, Node.js, AWS, Docker, and PostgreSQL.";
const engineeringCases = cases("senior_engineer_eu", [
  [
    "eng_exact_supported_emea",
    "Senior Software Engineer",
    "Remote - EMEA",
    engineeringEvidence,
    3,
    "promote",
    ["senior_engineering", "application_effort"],
    {
      salaryText: "$140k-$165k/year",
      keySkills: [
        "TypeScript",
        "React",
        "Node.js",
        "AWS",
        "Docker",
        "PostgreSQL",
      ],
      expectedDimensions: {
        roleSuitability: ["exact"],
        preferenceAlignment: ["aligned"],
        compensationFit: ["meets_minimum"],
        applicationEffort: ["moderate"],
        evidenceConfidence: ["high"],
      },
    },
  ],
  [
    "eng_fullstack_supported_global",
    "Senior Full-Stack Engineer",
    "Remote - Worldwide",
    engineeringEvidence,
    3,
    "promote",
    ["senior_engineering", "compensation"],
    {
      keySkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      expectedDimensions: {
        roleSuitability: ["exact"],
        compensationFit: ["unknown"],
      },
    },
  ],
  [
    "eng_backend_node_supported",
    "Senior Backend Engineer",
    "Remote - Europe",
    "Required: 5+ years of experience with Node.js, AWS, Docker, and PostgreSQL.",
    2,
    "consider",
    ["senior_engineering"],
    {
      salaryText: "$130k/year",
      keySkills: ["Node.js", "AWS", "Docker", "PostgreSQL"],
    },
  ],
  [
    "eng_frontend_adjacent_supported",
    "Senior Frontend Engineer",
    "Remote - EMEA",
    "Required: 5+ years of experience with TypeScript and React.",
    2,
    "consider",
    ["senior_engineering"],
    { salaryText: "$125k/year", keySkills: ["TypeScript", "React"] },
  ],
  [
    "eng_platform_adjacent_supported",
    "Senior Platform Engineer",
    "Remote - EMEA",
    "Required production experience with AWS, Docker, Node.js, and PostgreSQL platform services.",
    2,
    "consider",
    ["senior_engineering"],
    {
      salaryText: "$135k/year",
      keySkills: ["AWS", "Docker", "Node.js", "PostgreSQL"],
    },
  ],
  [
    "eng_exact_required_go_missing",
    "Senior Software Engineer",
    "Remote - EMEA",
    "Required: 5+ years of production Go and Kubernetes experience.",
    1,
    "review",
    ["senior_engineering", "hard_requirement_conflict"],
    {
      salaryText: "$145k/year",
      keySkills: ["Go", "Kubernetes"],
      minimumQualifications: ["Production Go and Kubernetes are required."],
      expectedRequirements: [
        { label: "Go", allowedStatuses: ["missing"] },
        { label: "Kubernetes", allowedStatuses: ["missing"] },
      ],
    },
  ],
  [
    "eng_staff_sre_ops_missing",
    "Staff Site Reliability Engineer",
    "Remote - EMEA",
    "Required: deep Kubernetes, Terraform, incident response, and on-call production ownership.",
    1,
    "review",
    ["senior_engineering"],
    {
      salaryText: "$150k/year",
      keySkills: ["Kubernetes", "Terraform"],
      seniority: "Staff",
    },
  ],
  [
    "eng_card_only_exact",
    "Senior Software Engineer",
    "Remote",
    "Senior Software Engineer opening.",
    1,
    "review",
    ["senior_engineering", "incomplete_listing"],
    {
      detailQuality: "card_only",
      seniority: null,
      employmentType: null,
      expectedDimensions: {
        evidenceConfidence: ["unavailable", "low"],
        roleSuitability: ["adjacent"],
      },
    },
  ],
  [
    "eng_below_minimum_usd",
    "Senior Software Engineer",
    "Remote - EMEA",
    engineeringEvidence,
    1,
    "review",
    ["senior_engineering", "compensation"],
    {
      salaryText: "$80k-$95k/year",
      keySkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      expectedDimensions: { compensationFit: ["below_minimum"] },
    },
  ],
  [
    "eng_data_wrong_family",
    "Senior Data Engineer",
    "Remote - EMEA",
    "Build Python data pipelines and analytics infrastructure using AWS and PostgreSQL.",
    0,
    "reject",
    ["senior_engineering"],
    { salaryText: "$140k/year", keySkills: ["Python", "AWS", "PostgreSQL"] },
  ],
  [
    "eng_solutions_sales_body",
    "Senior Solutions Engineer",
    "Remote - EMEA",
    "Own quota, run sales demos, qualify opportunities, and support account executives. TypeScript, React, Node.js, AWS, and PostgreSQL are useful.",
    0,
    "reject",
    ["senior_engineering", "misleading_title"],
    {
      salaryText: "$150k/year",
      keySkills: ["TypeScript", "React", "Node.js", "AWS", "PostgreSQL"],
    },
  ],
  [
    "eng_talent_pool_not_opening",
    "Senior Software Engineer - Talent Community",
    "Remote - EMEA",
    "This is not a current vacancy. Join our talent community for future TypeScript, React, Node.js, AWS, and PostgreSQL roles.",
    0,
    "reject",
    ["senior_engineering", "misleading_title"],
    {
      salaryText: "$150k/year",
      keySkills: ["TypeScript", "React", "Node.js", "AWS", "PostgreSQL"],
    },
  ],
  [
    "eng_us_only_no_sponsorship",
    "Senior Software Engineer",
    "Remote - United States only",
    `${engineeringEvidence} Candidates must already have US work authorization. No visa sponsorship is available.`,
    0,
    "reject",
    ["senior_engineering", "regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$150k/year",
      keySkills: ["TypeScript", "React", "Node.js", "AWS", "PostgreSQL"],
      hardConflict: true,
      screeningHints: { remoteGeographies: ["United States"] },
      expectedRequirements: [
        {
          label: "Work authorization without sponsorship",
          allowedStatuses: ["conflict"],
        },
      ],
    },
  ],
]);

const customerSuccess = persona({
  id: "fit_customer_success",
  name: ["Morgan", "Ellis"],
  headline: "Customer Success Lead",
  location: "London, United Kingdom",
  years: 8,
  skills: [
    "Customer onboarding",
    "Renewals",
    "Customer adoption",
    "Stakeholder management",
    "Zendesk",
    "CRM",
  ],
  experienceTitle: "Customer Success Lead",
  countries: ["United Kingdom"],
});
const customerSuccessPreferences = preferences({
  roles: ["Customer Success Manager", "Customer Onboarding Manager"],
  locations: ["London, United Kingdom", "Remote - United Kingdom"],
  workModes: ["remote", "hybrid"],
  minimumSalaryUsd: 80_000,
});
const customerEvidence =
  "Required: 5+ years of experience leading customer onboarding, adoption, renewals, and stakeholder management.";
const customerSuccessCases = cases("customer_success_nontechnical", [
  [
    "cs_exact_onboarding_renewals",
    "Customer Success Manager",
    "Remote - United Kingdom",
    customerEvidence,
    3,
    "promote",
    ["nontechnical"],
    {
      salaryText: "$90k/year",
      keySkills: ["Customer onboarding", "Renewals", "Customer adoption"],
    },
  ],
  [
    "cs_senior_exact_supported",
    "Senior Customer Success Manager",
    "Hybrid - London, United Kingdom",
    customerEvidence,
    3,
    "promote",
    ["nontechnical"],
    {
      workMode: ["hybrid"],
      salaryText: "$95k/year",
      keySkills: ["Renewals", "Customer adoption", "CRM"],
    },
  ],
  [
    "cs_onboarding_manager_adjacent",
    "Customer Onboarding Manager",
    "Remote - United Kingdom",
    "Lead customer onboarding, stakeholder workshops, adoption plans, and CRM handoffs.",
    2,
    "consider",
    ["nontechnical"],
    {
      salaryText: "$85k/year",
      keySkills: ["Customer onboarding", "Stakeholder management", "CRM"],
    },
  ],
  [
    "cs_support_manager_adjacent",
    "Customer Support Manager",
    "Remote - United Kingdom",
    "Manage support operations, Zendesk workflows, escalations, and adoption feedback.",
    2,
    "consider",
    ["nontechnical"],
    { salaryText: "$82k/year", keySkills: ["Zendesk", "Customer adoption"] },
  ],
  [
    "cs_implementation_manager_adjacent",
    "Customer Implementation Manager",
    "Hybrid - London, United Kingdom",
    "Own onboarding delivery, stakeholder management, adoption milestones, and CRM handoffs.",
    2,
    "consider",
    ["nontechnical"],
    {
      workMode: ["hybrid"],
      salaryText: "$88k/year",
      keySkills: ["Customer onboarding", "Stakeholder management", "CRM"],
    },
  ],
  [
    "cs_technical_sql_missing",
    "Technical Customer Success Manager",
    "Remote - United Kingdom",
    "Required: advanced SQL and Salesforce reporting alongside onboarding and renewals.",
    1,
    "review",
    ["nontechnical"],
    {
      salaryText: "$92k/year",
      keySkills: ["SQL", "Salesforce", "Customer onboarding", "Renewals"],
      minimumQualifications: [
        "Advanced SQL and Salesforce reporting are required.",
      ],
      expectedRequirements: [
        { label: "SQL", allowedStatuses: ["missing"] },
        { label: "Salesforce", allowedStatuses: ["missing"] },
      ],
    },
  ],
  [
    "cs_card_only_exact",
    "Customer Success Manager",
    "Remote",
    "Customer Success Manager opening.",
    1,
    "review",
    ["nontechnical", "incomplete_listing"],
    { detailQuality: "card_only", seniority: null, employmentType: null },
  ],
  [
    "cs_below_minimum",
    "Customer Success Manager",
    "Remote - United Kingdom",
    customerEvidence,
    1,
    "review",
    ["nontechnical", "compensation"],
    {
      salaryText: "$55k-$65k/year",
      keySkills: ["Customer onboarding", "Customer adoption", "Renewals"],
    },
  ],
  [
    "cs_account_executive_wrong_family",
    "Senior Account Executive",
    "Remote - United Kingdom",
    "Carry a new-business quota, prospect, negotiate, and close contracts.",
    0,
    "reject",
    ["nontechnical"],
    { salaryText: "$110k/year" },
  ],
  [
    "cs_software_engineer_customer_platform",
    "Software Engineer, Customer Success Platform",
    "Remote - United Kingdom",
    "Build backend services for the customer-success product using Python, AWS, and PostgreSQL.",
    0,
    "reject",
    ["nontechnical", "misleading_title"],
    { salaryText: "$100k/year", keySkills: ["Python", "AWS", "PostgreSQL"] },
  ],
  [
    "cs_talent_pool_not_opening",
    "Customer Success Manager - Future Opportunities",
    "Remote - United Kingdom",
    "This is not an active vacancy. Register interest for future onboarding, adoption, and renewal roles.",
    0,
    "reject",
    ["nontechnical", "misleading_title"],
    {
      salaryText: "$90k/year",
      keySkills: ["Customer onboarding", "Customer adoption", "Renewals"],
    },
  ],
  [
    "cs_onsite_no_relocation",
    "Customer Success Manager",
    "On-site - Madrid, Spain",
    "This role is on-site in Madrid five days per week and does not support remote work.",
    0,
    "reject",
    ["nontechnical", "regional_eligibility", "hard_requirement_conflict"],
    { workMode: ["onsite"], salaryText: "$90k/year", hardConflict: true },
  ],
  [
    "cs_us_only_sponsorship_conflict",
    "Customer Success Manager",
    "Remote - United States only",
    "Candidates must already have US work authorization. No visa sponsorship is available. Lead onboarding and renewals.",
    0,
    "reject",
    ["nontechnical", "regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$100k/year",
      hardConflict: true,
      screeningHints: { remoteGeographies: ["United States"] },
    },
  ],
]);
const transition = persona({
  id: "fit_transition",
  name: ["Riley", "Chen"],
  headline: "Senior Product Designer transitioning to UX Engineering",
  location: "Manchester, United Kingdom",
  years: 6,
  skills: ["React", "Figma", "Design Systems", "Accessibility", "HTML", "CSS"],
  experienceTitle: "Senior Product Designer",
  countries: ["United Kingdom"],
});
const transitionPreferences = preferences({
  roles: ["UX Engineer", "Design Systems Engineer", "UI Engineer"],
  locations: ["Manchester, United Kingdom", "Remote - United Kingdom"],
  workModes: ["remote", "hybrid"],
  minimumSalaryUsd: 90_000,
});
const transitionEvidence =
  "Build production React interfaces with Figma, design systems, accessibility, HTML, and CSS.";
const transitionCases = cases("designer_to_ux_engineer_transition", [
  [
    "transition_ux_engineer_react_figma",
    "UX Engineer",
    "Remote - United Kingdom",
    `Required: ${transitionEvidence}`,
    3,
    "promote",
    ["career_change"],
    {
      salaryText: "$105k/year",
      keySkills: [
        "React",
        "Figma",
        "Design Systems",
        "Accessibility",
        "HTML",
        "CSS",
      ],
    },
  ],
  [
    "transition_design_systems_engineer",
    "Design Systems Engineer",
    "Hybrid - Manchester, United Kingdom",
    transitionEvidence,
    3,
    "promote",
    ["career_change"],
    {
      workMode: ["hybrid"],
      salaryText: "$100k/year",
      keySkills: [
        "React",
        "Figma",
        "Design Systems",
        "Accessibility",
        "HTML",
        "CSS",
      ],
    },
  ],
  [
    "transition_ui_engineer_accessibility",
    "UI Engineer",
    "Remote - United Kingdom",
    "Required: React, accessible HTML, CSS, and partnership with Figma design-system teams.",
    2,
    "consider",
    ["career_change"],
    {
      salaryText: "$98k/year",
      keySkills: ["React", "Accessibility", "HTML", "CSS", "Figma"],
    },
  ],
  [
    "transition_frontend_design_systems",
    "Frontend Engineer, Design Systems",
    "Remote - United Kingdom",
    transitionEvidence,
    2,
    "consider",
    ["career_change"],
    {
      salaryText: "$95k/year",
      keySkills: ["React", "HTML", "CSS", "Accessibility", "Figma"],
    },
  ],
  [
    "transition_product_engineer_supported",
    "Product Engineer, UI Platform",
    "Remote - United Kingdom",
    "Create React UI platform components using HTML, CSS, accessibility, and design-system practices.",
    2,
    "consider",
    ["career_change"],
    {
      salaryText: "$96k/year",
      keySkills: ["React", "HTML", "CSS", "Accessibility", "Design Systems"],
    },
  ],
  [
    "transition_product_designer_old_path",
    "Senior Product Designer",
    "Remote - United Kingdom",
    "Lead Figma product design and design-system strategy.",
    1,
    "review",
    ["career_change"],
    { salaryText: "$100k/year", keySkills: ["Figma", "Design Systems"] },
  ],
  [
    "transition_principal_ux_scope_gap",
    "Principal UX Engineer",
    "Remote - United Kingdom",
    "Set organization-wide frontend architecture and lead multiple React platform teams.",
    1,
    "review",
    ["career_change"],
    { salaryText: "$120k/year", keySkills: ["React"], seniority: "Principal" },
  ],
  [
    "transition_typescript_required_missing",
    "UX Engineer",
    "Remote - United Kingdom",
    "Required: deep production TypeScript and React experience building component libraries.",
    1,
    "review",
    ["career_change"],
    {
      salaryText: "$105k/year",
      keySkills: ["TypeScript", "React"],
      minimumQualifications: ["Production TypeScript and React are required."],
      expectedRequirements: [
        { label: "TypeScript", allowedStatuses: ["missing"] },
      ],
    },
  ],
  [
    "transition_card_only_ux_engineer",
    "UX Engineer",
    "Remote",
    "UX Engineer opening.",
    1,
    "review",
    ["career_change", "incomplete_listing"],
    { detailQuality: "card_only", seniority: null, employmentType: null },
  ],
  [
    "transition_backend_go_wrong",
    "Senior Backend Engineer",
    "Remote - United Kingdom",
    "Build Go and Kubernetes backend services.",
    0,
    "reject",
    ["career_change"],
    { salaryText: "$110k/year", keySkills: ["Go", "Kubernetes"] },
  ],
  [
    "transition_ux_researcher_wrong",
    "Senior UX Researcher",
    "Remote - United Kingdom",
    "Lead qualitative research, interviews, and usability studies.",
    0,
    "reject",
    ["career_change", "misleading_title"],
    { salaryText: "$95k/year" },
  ],
  [
    "transition_talent_pool_not_opening",
    "UX Engineer - Talent Network",
    "Remote - United Kingdom",
    "This is not an active opening. Join our network for future React, Figma, and design-system roles.",
    0,
    "reject",
    ["career_change", "misleading_title"],
    {
      salaryText: "$105k/year",
      keySkills: ["React", "Figma", "Design Systems"],
    },
  ],
  [
    "transition_apac_only",
    "UX Engineer",
    "Remote - APAC only",
    "Candidates must reside in APAC. No visa sponsorship or relocation is available. Build React design systems.",
    0,
    "reject",
    ["career_change", "regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$105k/year",
      keySkills: ["React", "Design Systems"],
      hardConflict: true,
      screeningHints: { remoteGeographies: ["APAC"] },
    },
  ],
]);

const regional = persona({
  id: "fit_regional",
  name: ["Jamie", "Patel"],
  headline: "Senior Product Designer",
  location: "London, United Kingdom",
  years: 7,
  skills: [
    "Product Design",
    "Figma",
    "Design Systems",
    "User Research",
    "Workflows",
  ],
  experienceTitle: "Senior Product Designer",
  countries: ["United Kingdom"],
});
const regionalPreferences = preferences({
  roles: ["Senior Product Designer", "Product Designer"],
  locations: ["London, United Kingdom", "Remote - United Kingdom"],
  workModes: ["remote", "hybrid"],
  minimumSalaryUsd: 100_000,
});
const regionalEvidence =
  "Required: 5+ years of experience leading product design, Figma design systems, user research, and workflow products.";
const regionalCases = cases("uk_product_designer_regional", [
  [
    "region_uk_remote",
    "Senior Product Designer",
    "Remote - United Kingdom",
    regionalEvidence,
    3,
    "promote",
    ["regional_eligibility"],
    {
      salaryText: "$115k/year",
      keySkills: [
        "Product Design",
        "Figma",
        "Design Systems",
        "User Research",
        "Workflows",
      ],
    },
  ],
  [
    "region_london_hybrid",
    "Senior Product Designer",
    "Hybrid - London, United Kingdom",
    regionalEvidence,
    3,
    "promote",
    ["regional_eligibility"],
    {
      workMode: ["hybrid"],
      salaryText: "$115k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
    },
  ],
  [
    "region_worldwide_remote",
    "Senior Product Designer",
    "Remote - Worldwide",
    regionalEvidence,
    3,
    "promote",
    ["regional_eligibility"],
    {
      salaryText: "$115k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
    },
  ],
  [
    "region_emea_includes_uk",
    "Senior Product Designer",
    "Remote - EMEA including United Kingdom",
    regionalEvidence,
    3,
    "promote",
    ["regional_eligibility"],
    {
      salaryText: "$115k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
    },
  ],
  [
    "region_europe_unspecified",
    "Product Designer",
    "Remote - Europe",
    regionalEvidence,
    2,
    "consider",
    ["regional_eligibility"],
    {
      salaryText: "$115k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
    },
  ],
  [
    "region_eur_pay_incomparable",
    "Senior Product Designer",
    "Remote - United Kingdom",
    regionalEvidence,
    3,
    "promote",
    ["regional_eligibility", "compensation"],
    {
      salaryText: "EUR 120k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
      expectedDimensions: { compensationFit: ["currency_incomparable"] },
    },
  ],
  [
    "region_remote_no_geography",
    "Senior Product Designer",
    "Remote",
    "Lead product design and Figma systems. Eligible countries are not listed.",
    1,
    "review",
    ["regional_eligibility", "incomplete_listing"],
    {
      salaryText: "$115k/year",
      keySkills: ["Product Design", "Figma", "Design Systems"],
    },
  ],
  [
    "region_location_not_listed",
    "Senior Product Designer",
    "Location not listed",
    "Lead product design. Work location and eligibility are not stated.",
    1,
    "review",
    ["regional_eligibility", "incomplete_listing"],
    {
      salaryText: "$115k/year",
      detailQuality: "partial_detail",
      keySkills: ["Product Design", "Figma"],
    },
  ],
  [
    "region_clearance_required_unknown",
    "Senior Product Designer",
    "Hybrid - London, United Kingdom",
    "Active UK security clearance is required before starting. Lead product design and Figma systems.",
    1,
    "review",
    ["regional_eligibility", "hard_requirement_conflict"],
    {
      workMode: ["hybrid"],
      salaryText: "$115k/year",
      screeningHints: { requiresSecurityClearance: true },
      expectedRequirements: [
        { label: "Security clearance", allowedStatuses: ["unknown"] },
      ],
    },
  ],
  [
    "region_eu_only_excludes_uk",
    "Senior Product Designer",
    "Remote - European Union only (United Kingdom excluded)",
    "Candidates must reside in an EU member state; the United Kingdom is excluded. No visa sponsorship is available.",
    0,
    "reject",
    ["regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$115k/year",
      hardConflict: true,
      screeningHints: {
        remoteGeographies: ["European Union excluding United Kingdom"],
      },
    },
  ],
  [
    "region_us_only_no_sponsor",
    "Senior Product Designer",
    "Remote - United States only",
    "Candidates must already have US work authorization. No visa sponsorship is available.",
    0,
    "reject",
    ["regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$115k/year",
      hardConflict: true,
      screeningHints: { remoteGeographies: ["United States"] },
    },
  ],
  [
    "region_apac_only",
    "Senior Product Designer",
    "Remote - APAC only",
    "Candidates must reside in APAC. No visa sponsorship is available.",
    0,
    "reject",
    ["regional_eligibility", "hard_requirement_conflict"],
    {
      salaryText: "$115k/year",
      hardConflict: true,
      screeningHints: { remoteGeographies: ["APAC"] },
    },
  ],
  [
    "region_berlin_onsite_no_relocation",
    "Senior Product Designer",
    "On-site - Berlin, Germany",
    "This role is on-site in Berlin five days per week. Remote work and relocation support are unavailable.",
    0,
    "reject",
    ["regional_eligibility", "hard_requirement_conflict"],
    { workMode: ["onsite"], salaryText: "$115k/year", hardConflict: true },
  ],
]);

export const FIT_CALIBRATION_CORPUS: FitCalibrationCorpus = {
  version: "fit-calibration-v1-2026-07-30",
  cohorts: [
    {
      id: "senior_engineer_eu",
      label: "Senior engineering in Europe",
      profile: engineer,
      searchPreferences: engineerPreferences,
      cases: engineeringCases,
    },
    {
      id: "customer_success_nontechnical",
      label: "Nontechnical customer success",
      profile: customerSuccess,
      searchPreferences: customerSuccessPreferences,
      cases: customerSuccessCases,
    },
    {
      id: "designer_to_ux_engineer_transition",
      label: "Product design to UX engineering career change",
      profile: transition,
      searchPreferences: transitionPreferences,
      cases: transitionCases,
    },
    {
      id: "uk_product_designer_regional",
      label: "UK product designer regional eligibility",
      profile: regional,
      searchPreferences: regionalPreferences,
      cases: regionalCases,
    },
  ],
};

export function findFitCalibrationCohort(id: string) {
  return (
    FIT_CALIBRATION_CORPUS.cohorts.find((cohort) => cohort.id === id) ?? null
  );
}

export function findFitCalibrationCase(cohortId: string, caseId: string) {
  return (
    findFitCalibrationCohort(cohortId)?.cases.find(
      (entry) => entry.id === caseId,
    ) ?? null
  );
}
