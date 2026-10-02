/* eslint-env node */

if (process.env.JOB_FINDER_LOCAL_REPLICA === "1") {
  const { runReplicaHarness } =
    await import("./test-job-finder-replica-apply.mjs");
  await runReplicaHarness("workday");
  process.exit(0);
}

const preferredTitle =
  process.env.JOB_FINDER_WORKDAY_TITLE ?? "Software Engineer";

// The smoke module auto-runs on import; the `?preflight` query form is a
// separate, side-effect-free module instance that only exposes the exported
// no-launch binding helpers. Strict bound runs validate the local
// acceptance/custody binding BEFORE any live board fetch; diagnostic runs are
// skipped by the gate below so unbound developer diagnostics keep their
// existing behavior.
process.env.JOB_FINDER_PREPARE_ONLY_SKIP_SMOKE_RUN = "1";
const smokePreflight =
  await import("./test-job-finder-prepare-only.mjs?preflight");
delete process.env.JOB_FINDER_PREPARE_ONLY_SKIP_SMOKE_RUN;

// Local binding gate: a strictly bound run must prove the whole sealed
// acceptance binding locally before the live board is ever fetched. An
// incomplete or tampered binding terminates here with no network traffic; the
// same preflight is re-run by the smoke before the sealed app is launched.
await smokePreflight.preflightBoundAtsRun(process.env);

// Workday board env is validated locally before the live board is fetched:
// the host must be a bare hostname and tenant/site/locale safe single path
// segments, so URLs, control characters, and traversal never reach the
// network or the built job URL.
const boardEnv = smokePreflight.validateWorkdayBoardEnv(process.env);
const hostname = boardEnv.host;
const tenant = boardEnv.tenant;
const siteId = boardEnv.siteId;
const locale = boardEnv.locale;

const response = await fetch(
  `https://${hostname}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(siteId)}/jobs`,
  {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: preferredTitle,
    }),
  },
);

if (!response.ok) {
  throw new Error(
    `Workday board lookup failed with status ${response.status}.`,
  );
}

const payload = await response.json();
const jobs = Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
const selectedJob =
  jobs.find(
    (job) =>
      typeof job?.title === "string" &&
      job.title.toLowerCase() === preferredTitle.toLowerCase() &&
      typeof job?.externalPath === "string",
  ) ??
  jobs.find(
    (job) =>
      typeof job?.title === "string" &&
      /\bsoftware engineer\b/iu.test(job.title) &&
      typeof job?.externalPath === "string",
  );

if (!selectedJob) {
  throw new Error(
    `No current Software Engineer vacancy was available on Workday site '${tenant}/${siteId}'.`,
  );
}

const jobUrl = `https://${hostname}/${locale}/${siteId}${selectedJob.externalPath}`;
const authorizedWriteDiagnostic =
  process.env.JOB_FINDER_COMPLETE_FLOW_AUTHORIZED_WRITE_DIAGNOSTIC === "1";
const baseLabel =
  process.env.JOB_FINDER_PREPARE_ONLY_LABEL ?? "complete-flow-current-workday";

if (authorizedWriteDiagnostic) {
  process.env.JOB_FINDER_PREPARE_ONLY_AUTHORIZE_INTERMEDIATE_WRITES = "1";
  process.env.JOB_FINDER_PREPARE_ONLY_LABEL = /diagnostic[-_]only/u.test(
    baseLabel,
  )
    ? baseLabel
    : `${baseLabel}-diagnostic-only`;
  delete process.env.JOB_FINDER_ACCEPTANCE_RUN_DIR;
  delete process.env.JOB_FINDER_ACCEPTANCE_MANIFEST;
  delete process.env.JOB_FINDER_ACCEPTANCE_MANIFEST_SHA256;
  delete process.env.JOB_FINDER_ACCEPTANCE_EXPECTED_SEAL_SHA256;
} else {
  process.env.JOB_FINDER_PREPARE_ONLY_LABEL = baseLabel;
  process.env.JOB_FINDER_PREPARE_ONLY_AUTHORIZE_INTERMEDIATE_WRITES = "0";
  process.stdout.write(
    `${baseLabel}: strict prepare-only mode leaves intermediate ATS writes unauthorized, so resume upload autosave stays blocked and resumeUploadVerified is not expected evidence.\n`,
  );
}

process.env.JOB_FINDER_PREPARE_ONLY_EXPECT_EXACT_SOURCE_JOB = "1";
process.env.JOB_FINDER_PREPARE_ONLY_REQUIRE_FINAL_CHECKPOINT = "0";
process.env.JOB_FINDER_PREPARE_ONLY_EXPECT_BLOCKER_CODE = "site_login_required";
process.env.JOB_FINDER_PREPARE_ONLY_RESUME_MODE =
  process.env.JOB_FINDER_PREPARE_ONLY_RESUME_MODE ?? "original_resume";
process.env.JOB_FINDER_PREPARE_ONLY_USE_LIVE_DISCOVERY_AI = "0";
process.env.JOB_FINDER_PREPARE_ONLY_SOURCE_ID = `target_workday_${tenant}_${siteId}_complete_flow`;
process.env.JOB_FINDER_PREPARE_ONLY_SOURCE_LABEL = `${tenant} Workday`;
process.env.JOB_FINDER_PREPARE_ONLY_SOURCE_URL = jobUrl;
process.env.JOB_FINDER_PREPARE_ONLY_TARGET_ROLES = selectedJob.title;

await import("./test-job-finder-prepare-only.mjs");
