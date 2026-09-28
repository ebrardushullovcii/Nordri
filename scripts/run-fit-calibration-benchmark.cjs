/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const packageEntries = new Map([
  ["@nordri/ai-providers", "packages/ai-providers/src/index.ts"],
  ["@nordri/browser-runtime", "packages/browser-runtime/src/index.ts"],
  ["@nordri/contracts", "packages/contracts/src/index.ts"],
  ["@nordri/db", "packages/db/src/index.ts"],
  ["@nordri/knowledge-base", "packages/knowledge-base/src/index.ts"],
]);

function installTypeScriptLoader() {
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(
    request,
    parent,
    isMain,
    options,
  ) {
    const packageEntry = packageEntries.get(request);
    if (packageEntry) {
      return path.join(repoRoot, packageEntry);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  require.extensions[".ts"] = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: (value) => value,
        getCurrentDirectory: () => repoRoot,
        getNewLine: () => "\n",
      });
      throw new Error(formatted);
    }
    module._compile(compiled.outputText, filename);
  };
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function parseArgs(argv) {
  const parsed = {
    baseline: null,
    caseId: null,
    cohortId: null,
    output: path.join(
      repoRoot,
      "apps/desktop/test-artifacts/job-finder/fit-calibration/fit-calibration-report.json",
    ),
    reportOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report-only") {
      parsed.reportOnly = true;
      continue;
    }
    if (
      argument === "--output" ||
      argument === "--baseline" ||
      argument === "--cohort" ||
      argument === "--case"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw usageError(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--output") {
        parsed.output = path.resolve(repoRoot, value);
      } else if (argument === "--baseline") {
        parsed.baseline = path.resolve(repoRoot, value);
      } else if (argument === "--cohort") {
        parsed.cohortId = value;
      } else {
        parsed.caseId = value;
      }
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    throw usageError(`Unknown argument: ${argument}`);
  }

  if (parsed.caseId && !parsed.cohortId) {
    throw usageError(
      "--case requires --cohort so case identities remain scoped.",
    );
  }
  return parsed;
}

/**
 * A baseline whose schema, corpus, or scorer version no longer matches the
 * current build cannot surface an unintended ranking regression: every case
 * reads as changed, so the case diff is noise. That drift is a failure of the
 * gate itself, so it fails the run instead of being printed and ignored.
 * Case-level deltas stay informational: an intentional scoring change must
 * bump the scorer version, and that is the condition gated here.
 */
function baselineGateFailures(baselineComparison) {
  if (!baselineComparison) {
    return [];
  }

  return baselineComparison.metadataDeltas.map(
    (delta) =>
      `baseline ${delta.field} is ${JSON.stringify(delta.previous)} but this run is ${JSON.stringify(delta.current)}`,
  );
}

function decideExitCode(report, reportOnly, baselineComparison) {
  if (reportOnly) {
    return 0;
  }

  return report.passed && baselineGateFailures(baselineComparison).length === 0
    ? 0
    : 1;
}

function numericAggregateDeltas(current, baseline) {
  const deltas = {};
  for (const [key, value] of Object.entries(current.aggregate)) {
    const previous = baseline?.aggregate?.[key];
    if (typeof value === "number" && typeof previous === "number") {
      deltas[key] = value - previous;
    }
  }
  return deltas;
}

function caseDeltas(current, baseline) {
  const previousEntries = (baseline?.cohorts ?? []).flatMap((cohort) =>
    (cohort.cases ?? []).map((entry) => [
      `${cohort.id}:${entry.id}`,
      { cohortId: cohort.id, entry },
    ]),
  );
  const previousById = new Map(previousEntries);
  const currentIds = new Set(
    current.cohorts.flatMap((cohort) =>
      cohort.cases.map((entry) => `${cohort.id}:${entry.id}`),
    ),
  );
  const changedOrAdded = current.cohorts.flatMap((cohort) =>
    cohort.cases.flatMap((entry) => {
      const previousRecord = previousById.get(`${cohort.id}:${entry.id}`);
      if (!previousRecord) {
        return [
          {
            cohortId: cohort.id,
            caseId: entry.id,
            changes: ["added"],
          },
        ];
      }
      const previous = previousRecord.entry;
      const changes = [];
      if (previous.score !== entry.score) changes.push("score");
      if (previous.recommendation !== entry.recommendation)
        changes.push("recommendation");
      if (previous.rank !== entry.rank) changes.push("rank");
      if (
        JSON.stringify(previous.dimensions) !== JSON.stringify(entry.dimensions)
      )
        changes.push("dimensions");
      if (
        JSON.stringify(previous.requirements) !==
        JSON.stringify(entry.requirements)
      )
        changes.push("requirements");
      if (
        JSON.stringify(previous.explicitExpectationFailureCodes ?? []) !==
        JSON.stringify(entry.explicitExpectationFailureCodes)
      ) {
        changes.push("explicit_expectations");
      }
      return changes.length > 0
        ? [
            {
              cohortId: cohort.id,
              caseId: entry.id,
              previous: {
                rank: previous.rank,
                recommendation: previous.recommendation,
                score: previous.score,
              },
              current: {
                rank: entry.rank,
                recommendation: entry.recommendation,
                score: entry.score,
              },
              changes,
            },
          ]
        : [];
    }),
  );
  const removed = previousEntries.flatMap(([key, previousRecord]) =>
    currentIds.has(key)
      ? []
      : [
          {
            cohortId: previousRecord.cohortId,
            caseId: previousRecord.entry.id,
            changes: ["removed"],
          },
        ],
  );
  return [...changedOrAdded, ...removed];
}

function metadataDeltas(current, baseline) {
  return ["schemaVersion", "corpusVersion", "scorerVersion"].flatMap((field) =>
    current[field] === baseline?.[field]
      ? []
      : [
          {
            field,
            previous: baseline?.[field] ?? null,
            current: current[field],
          },
        ],
  );
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/run-fit-calibration-benchmark.cjs [options]",
      "  --output <path>      Report destination",
      "  --baseline <path>    Compare with a prior report",
      "  --cohort <id>        Print one cohort after the full gate",
      "  --case <id>          Print one case (requires --cohort)",
      "  --report-only        Exit zero even when quality gates fail",
      "",
    ].join("\n"),
  );
}

function printSummary(report) {
  const aggregate = report.aggregate;
  process.stdout.write(
    [
      `Fit calibration ${report.corpusVersion} / scorer v${report.scorerVersion}`,
      `Cases ${aggregate.caseCount}; cohorts ${aggregate.cohortCount}`,
      `NDCG@10 ${aggregate.macroNdcgAtTen.toFixed(3)}; P@5 ${aggregate.macroPrecisionAtFive.toFixed(3)}; R@10 ${aggregate.macroRecallAtTen.toFixed(3)}`,
      `Disposition agreement ${aggregate.dispositionAgreement.toFixed(3)}; weighted kappa ${aggregate.quadraticWeightedKappa.toFixed(3)}`,
      `Explicit expectation failures ${aggregate.explicitCaseExpectationFailures}`,
      `Counterexamples ${(aggregate.counterexamplePassRate * 100).toFixed(1)}%; hard-conflict top-five ${aggregate.hardConflictsInTopFive}; incomplete unqualified ${aggregate.incompleteStrongRecommendations}; misleading top-five ${aggregate.misleadingTitlesInTopFive}`,
      report.passed
        ? "Quality gates: PASS"
        : `Quality gates: FAIL (${report.gateFailures.join(", ")})`,
      "",
    ].join("\n"),
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode ?? 2;
  }
  if (args.help) {
    printUsage();
    return 0;
  }

  installTypeScriptLoader();
  const { FIT_CALIBRATION_CORPUS } = require(
    path.join(
      repoRoot,
      "packages/job-finder/src/internal/fit-calibration-corpus.ts",
    ),
  );
  const { runFitCalibrationBenchmark } = require(
    path.join(
      repoRoot,
      "packages/job-finder/src/internal/fit-calibration-benchmark.ts",
    ),
  );
  const report = runFitCalibrationBenchmark({ corpus: FIT_CALIBRATION_CORPUS });

  const selectedCohort = args.cohortId
    ? report.cohorts.find((entry) => entry.id === args.cohortId)
    : null;
  if (args.cohortId && !selectedCohort) {
    throw usageError(`Unknown cohort: ${args.cohortId}`);
  }
  const selectedCase = args.caseId
    ? selectedCohort.cases.find((entry) => entry.id === args.caseId)
    : null;
  if (args.caseId && !selectedCase) {
    throw usageError(`Unknown case in ${args.cohortId}: ${args.caseId}`);
  }

  let baselineComparison = null;
  if (args.baseline) {
    const baseline = JSON.parse(fs.readFileSync(args.baseline, "utf8"));
    baselineComparison = {
      sourcePath: args.baseline,
      metadataDeltas: metadataDeltas(report, baseline),
      aggregateDeltas: numericAggregateDeltas(report, baseline),
      caseDeltas: caseDeltas(report, baseline),
    };
  }
  const output = baselineComparison
    ? { ...report, baselineComparison }
    : report;
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  printSummary(report);
  if (selectedCase) {
    process.stdout.write(`${JSON.stringify(selectedCase, null, 2)}\n`);
  } else if (selectedCohort) {
    process.stdout.write(`${JSON.stringify(selectedCohort, null, 2)}\n`);
  }
  if (baselineComparison) {
    process.stdout.write(
      `Baseline changes: ${baselineComparison.caseDeltas.length} cases\n`,
    );
    const baselineFailures = baselineGateFailures(baselineComparison);
    if (baselineFailures.length > 0) {
      process.stderr.write(
        [
          `Baseline is stale (${baselineFailures.join("; ")}).`,
          "Its case diff cannot surface an unintended ranking regression until it is regenerated:",
          `  node scripts/run-fit-calibration-benchmark.cjs --output ${path.relative(repoRoot, args.baseline)}`,
          "",
        ].join("\n"),
      );
    }
  }
  process.stdout.write(`Report: ${args.output}\n`);
  return decideExitCode(report, args.reportOnly, baselineComparison);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = error?.exitCode ?? 2;
  }
}

module.exports = {
  baselineGateFailures,
  caseDeltas,
  decideExitCode,
  metadataDeltas,
  numericAggregateDeltas,
  parseArgs,
};
