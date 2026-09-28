import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createJobFinderAiClientFromEnvironment,
  createResumeVisionProviderFromEnvironment,
  type JobFinderAiClient,
} from "@nordri/ai-providers";
import {
  ResumeImportBenchmarkCaseSchema,
  ResumeImportBenchmarkRequestSchema,
  type CandidateProfile,
  type JobSearchPreferences,
  type ResumeDocumentBundle,
  type ResumeImportBenchmarkCase,
  type ResumeImportBenchmarkReport,
  type ResumeImportBenchmarkRequest,
} from "@nordri/contracts";
import {
  buildBenchmarkAiClient,
  runResumeImportBenchmark,
} from "@nordri/job-finder";

import { createEmptyJobFinderRepositoryState } from "../../adapters/job-finder-initial-state";
import { extractResumeDocument } from "../../adapters/resume-document";
import { detectResumeDocumentFileKind } from "../../adapters/resume-document/worker";
import { generateResumeVisionImages } from "../../adapters/resume-vision-images";

const defaultBenchmarkCases = [
  {
    id: "resume_import_comprehensive_txt",
    label: "Comprehensive structured text canary",
    resumePath:
      "apps/desktop/test-fixtures/job-finder/resume-import-comprehensive-sample.txt",
    canary: true,
    tags: ["txt", "canary", "dates", "projects", "certifications", "languages"],
    expected: {
      literalFields: {
        fullName: "Morgan Lee",
        currentLocation: "Amsterdam, Netherlands",
        email: "morgan.lee@example.test",
        phone: "+31 20 555 0199",
      },
      summaryContains: ["reliable workflow software"],
      experienceRecords: [
        {
          title: "Senior Product Engineer",
          companyName: "Northstar Labs",
          location: "Amsterdam, Netherlands",
          startDate: "2022-03",
          endDate: null,
          isCurrent: true,
          achievements: [
            "Reduced manual review time by 28% through a guided validation queue.",
            "Led an accessibility remediation that reached WCAG 2.2 AA on core flows.",
          ],
        },
        {
          title: "Frontend Engineer",
          companyName: "Harbor Studio",
          location: "Rotterdam, Netherlands",
          startDate: "2019-01",
          endDate: "2022-02",
          isCurrent: false,
          achievements: [
            "Shipped a reusable component library across four products.",
          ],
        },
      ],
      educationRecords: [
        {
          schoolName: "Delft University of Technology",
          degree: "BSc Computer Science",
        },
      ],
      projectRecords: [
        {
          name: "Queue Insight",
          role: "Lead Developer",
        },
      ],
      certificationRecords: [
        {
          name: "AWS Certified Developer - Associate",
          issuer: "Amazon Web Services",
        },
      ],
      languageRecords: [
        { language: "English", proficiency: "Professional working proficiency" },
        { language: "Dutch", proficiency: "Native" },
      ],
      forbiddenProfileText: [
        "PhD",
        "Spanish - Native",
        "managed 50 engineers",
      ],
    },
  },
  {
    id: "resume_import_sample_txt",
    label: "Deterministic text canary",
    resumePath: "apps/desktop/test-fixtures/job-finder/resume-import-sample.txt",
    canary: true,
    tags: ["txt", "canary"],
    expected: {
      literalFields: {
        fullName: "Jamie Rivers",
        currentLocation: "Berlin, Germany",
        email: "jamie@example.com",
        phone: "+49 555 0000000",
      },
      summaryContains: ["12 years of experience"],
      experienceRecords: [
        {
          title: "Staff Frontend Engineer",
          companyName: "Signal Systems",
        },
      ],
      educationRecords: [],
    },
  },
  {
    id: "ebrar_pdf",
    label: "Ebrar PDF",
    resumePath: "docs/resume-tests/Ebrar.pdf",
    canary: true,
    tags: ["pdf", "canary", "baseline"],
    expected: {
      literalFields: {
        fullName: "Ebrar Dushullovci",
        currentLocation: "Prishtina, Kosovo",
        email: "ebrar.dushullovci@gmail.com",
        phone: "(+383) 44283970",
      },
      summaryContains: ["6+ years of full-stack experience"],
      experienceRecords: [
        {
          title: "Senior Full-Stack Software Engineer",
          companyName: "AUTOMATEDPROS",
        },
        {
          title: "Chief Experience Officer",
          companyName: "AUTOMATEDPROS",
        },
        {
          title: ".NET Consultant",
          companyName: "INFOTECH L.L.C",
        },
        {
          title: ".NET Developer",
          companyName: "INFOTECH L.L.C",
        },
        {
          title: ".NET Developer",
          companyName: "CREA-KO",
        },
        {
          title: "Project Manager",
          companyName: "BEAUTYQUE",
        },
        {
          title: "Digital Marketing Manager",
          companyName: "BEAUTYQUE",
        },
        {
          title: "Technical Support Agent",
          companyName: "BIT BY BIT",
        },
        {
          title: "Call Center Agent",
          companyName: "TREGI KOSOVO",
        },
      ],
      educationRecords: [
        {
          schoolName: "Kolegji Riinvest (Riinvest College)",
          degree: "BACHELOR'S DEGREE",
        },
      ],
    },
  },
  {
    id: "ebrar_new_pdf",
    label: "Ebrar New PDF",
    resumePath: "docs/resume-tests/Ebrar new.pdf",
    canary: false,
    tags: ["pdf", "alternate-format", "baseline"],
    expected: {
      literalFields: {
        fullName: "Ebrar Dushullovci",
        currentLocation: "Prishtina, Kosovo",
        email: "ebrar.dushullovci@gmail.com",
        phone: "(+383) 44283970",
      },
      summaryContains: ["full-stack developer"],
      experienceRecords: [
        {
          title: "Senior Full-Stack Software Engineer",
          companyName: "AUTOMATEDPROS",
        },
        {
          title: "Chief Experience Officer",
          companyName: "AUTOMATEDPROS",
        },
        {
          title: "Senior Full-Stack Software Engineer (Part-Time Consultant)",
          companyName: "INFOTECH L.L.C",
        },
        {
          title: "Full-Stack Software Engineer",
          companyName: "INFOTECH L.L.C",
        },
        {
          title: "Full-Stack Software Engineer",
          companyName: "CREA-KO",
        },
        {
          title: "Project Manager",
          companyName: "BEAUTYQUE",
        },
        {
          title: "Digital Marketing Manager",
          companyName: "BEAUTYQUE",
        },
        {
          title: "Technical Support Agent",
          companyName: "BIT BY BIT",
        },
        {
          title: "Call Center Agent",
          companyName: "TREGI KOSOVO",
        },
      ],
      educationRecords: [
        {
          schoolName: "Kolegji Riinvest (Riinvest College)",
          degree: "BACHELOR'S DEGREE",
        },
      ],
    },
  },
  {
    id: "aaron_murphy_pdf",
    label: "Aaron Murphy PDF",
    resumePath: "docs/resume-tests/Aaron Murphy Resume.pdf",
    canary: true,
    tags: ["pdf", "multi-column", "name-failure"],
    expected: {
      literalFields: {
        fullName: "Aaron Murphy",
        currentLocation: "Tampa, FL",
        email: "murphyaron12@gmail.com",
        phone: "+1 615-378-5538",
      },
      summaryContains: ["Experienced Staff Engineer"],
      experienceRecords: [
        {
          title: "Staff/Senior Software Engineer",
          companyName: "EdSights",
        },
        {
          title: "Senior Software Developer",
          companyName: "Agile Thought",
        },
        {
          title: "Software Developer",
          companyName: "Agile Thought",
        },
        {
          title: "Software Developer",
          companyName: "Three Five Two",
        },
      ],
      educationRecords: [
        {
          schoolName: "Florida State University",
          degree: "Bachelor’s Degree",
        },
      ],
    },
  },
  {
    id: "paul_asselin_pdf",
    label: "Paul Asselin PDF",
    resumePath: "docs/resume-tests/Paul Asselin CV.pdf",
    canary: false,
    tags: ["pdf", "location-failure"],
    expected: {
      literalFields: {
        fullName: "Paul Asselin",
        currentLocation: "Philadelphia, PA",
        email: "paul.asselin454@outlook.com",
        phone: "(530) 213-3550",
      },
      summaryContains: ["Senior Software Engineer with 7+ years"],
      experienceRecords: [
        {
          title: "Senior Software Engineer",
          companyName: "Mercury",
        },
        {
          title: "Senior Software Engineer",
          companyName: "Leif",
        },
        {
          title: "Software Engineer",
          companyName: "Leif",
        },
        {
          title: "Summer Analyst",
          companyName: "IK Investment Partners",
        },
      ],
      educationRecords: [
        {
          schoolName: "University of Pennsylvania",
          degree: "Bachelor of Computer Science, 2014",
        },
      ],
    },
  },
  {
    id: "ryan_holstien_pdf",
    label: "Ryan Holstien PDF",
    resumePath: "docs/resume-tests/Ryan Holstien Resume.pdf",
    canary: false,
    tags: ["pdf", "name-failure", "location-failure"],
    expected: {
      literalFields: {
        fullName: "Ryan Holstien",
        currentLocation: "Cedar Park, TX 78613",
        email: "ryanholstien993@outlook.com",
        phone: "+1 650-353-7911",
      },
      summaryContains: ["10+ years of experience"],
      experienceRecords: [
        {
          title: "Senior Software Engineer",
          companyName: "DataHub",
        },
        {
          title: "Senior Software Engineer",
          companyName: "Vrbo",
        },
        {
          title: "Software Engineer",
          companyName: "Infor",
        },
      ],
      educationRecords: [
        {
          schoolName: "The University of Texas at Austin",
          degree: "Bachelor of Science",
        },
      ],
    },
  },
] satisfies ResumeImportBenchmarkCase[];

function findRepoRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function resolveRepoRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(currentDir) ?? findRepoRoot(process.cwd());

  if (!repoRoot) {
    throw new Error(
      `Could not locate repo root from ${currentDir} or ${process.cwd()}.`,
    );
  }

  return repoRoot;
}

function resolveBenchmarkCases(
  request: ResumeImportBenchmarkRequest,
): ResumeImportBenchmarkCase[] {
  const cases = request.cases.length > 0 ? request.cases : defaultBenchmarkCases;
  return cases.map((benchmarkCase) => ResumeImportBenchmarkCaseSchema.parse(benchmarkCase));
}

function buildBenchmarkProfile(fileName: string): CandidateProfile {
  const emptyState = createEmptyJobFinderRepositoryState();
  return {
    ...emptyState.profile,
    baseResume: {
      ...emptyState.profile.baseResume,
      id: `resume_benchmark_${Date.now()}`,
      fileName,
      uploadedAt: new Date().toISOString(),
    },
  };
}

function buildBenchmarkSearchPreferences(): JobSearchPreferences {
  return createEmptyJobFinderRepositoryState().searchPreferences;
}

function buildAiClient(
  request: ResumeImportBenchmarkRequest,
): JobFinderAiClient {
  if (request.useConfiguredAi) {
    return createJobFinderAiClientFromEnvironment(process.env);
  }

  return buildBenchmarkAiClient(false);
}

async function loadDocumentBundle(input: {
  benchmarkCase: ResumeImportBenchmarkCase;
  profile: CandidateProfile;
  useVision: boolean;
}): Promise<{
  documentBundle: ResumeDocumentBundle;
  parseMethod: string;
  workerManifestVersion: string | null;
  visionArtifact: Awaited<ReturnType<typeof generateResumeVisionImages>>["artifact"] | null;
}> {
  const repoRoot = resolveRepoRoot();
  const resumePath = path.resolve(repoRoot, input.benchmarkCase.resumePath);
  await readFile(resumePath);
  const extracted = await extractResumeDocument(resumePath, {
    bundleId: `benchmark_bundle_${input.benchmarkCase.id}`,
    runId: `benchmark_run_${input.benchmarkCase.id}`,
    sourceResumeId: input.profile.baseResume.id,
  });
  const visionArtifact = input.useVision
    ? await generateResumeVisionImages({
        filePath: resumePath,
        fileKind: detectResumeDocumentFileKind(resumePath),
        runId: `benchmark_run_${input.benchmarkCase.id}`,
        sourceResumeId: input.profile.baseResume.id,
        artifactId: `benchmark_vision_artifact_${input.benchmarkCase.id}`,
        env: process.env,
      }).then((result) => result.artifact)
    : null;

  return {
    documentBundle: extracted.bundle,
    parseMethod: [
      extracted.bundle.parserManifest?.workerKind ?? "unknown_worker",
      extracted.bundle.primaryParserKind,
    ].filter(Boolean).join("+"),
    workerManifestVersion: extracted.bundle.parserManifest?.manifestVersion ?? null,
    visionArtifact,
  };
}

export async function runDesktopResumeImportBenchmark(
  input: Partial<ResumeImportBenchmarkRequest> = {},
): Promise<ResumeImportBenchmarkReport> {
  const parsedInput = ResumeImportBenchmarkRequestSchema.parse({
    ...input,
    cases: input.cases ?? [],
  });
  const request = ResumeImportBenchmarkRequestSchema.parse({
    ...parsedInput,
    cases: resolveBenchmarkCases(parsedInput),
  });

  return runResumeImportBenchmark({
    request,
    async createHarness(benchmarkCase, normalizedRequest) {
      const profile = buildBenchmarkProfile(path.basename(benchmarkCase.resumePath));
      const searchPreferences = buildBenchmarkSearchPreferences();
      const { documentBundle, parseMethod, workerManifestVersion, visionArtifact } = await loadDocumentBundle({
        benchmarkCase,
        profile,
        useVision: normalizedRequest.useVision,
      });

      return {
        profile: {
          ...profile,
          baseResume: {
            ...profile.baseResume,
            textContent: documentBundle.fullText,
            textUpdatedAt: documentBundle.fullText ? new Date().toISOString() : null,
            extractionStatus: documentBundle.fullText ? "ready" : "needs_text",
            storagePath: path.resolve(resolveRepoRoot(), benchmarkCase.resumePath),
          },
        },
        searchPreferences,
        documentBundle,
        aiClient: buildAiClient(normalizedRequest),
        visionProvider: normalizedRequest.useConfiguredAi && normalizedRequest.useVision
          ? createResumeVisionProviderFromEnvironment(process.env)
          : null,
        parseMethod,
        workerManifestVersion,
        ...(normalizedRequest.useVision ? { visionArtifact } : {}),
      };
    },
  });
}

export { defaultBenchmarkCases };
