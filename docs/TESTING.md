# Testing

## Pick the smallest check

| Change                                             | Run                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| package-local code                                 | `pnpm validate:package <alias>` (`desktop`, `job-finder`, `browser-agent`, `browser-runtime`, `contracts`) |
| contracts or IPC                                   | `pnpm validate:contracts` plus typecheck of affected packages                                              |
| discovery or source-debug                          | `pnpm source-generic:check` plus focused package tests                                                     |
| desktop UI                                         | `pnpm validate:desktop` plus the matching `ui:*` harness from `apps/desktop/package.json`                  |
| broad cross-package behavior                       | `pnpm verify:affected`                                                                                     |
| release candidate, only when the user declares one | `pnpm verify`, then `pnpm test:evidence` (ADR 0014)                                                        |

Other entry points: `pnpm test:correctness`, `pnpm test:performance` (serial, no coverage, by design), `pnpm test:coverage`, `pnpm format`, `pnpm knip`, `pnpm structure:check`.

## Stop rules

- Never stop a process you did not start. Stop only the Electron instance you launched, through its own handle or PID tree, and report survivors instead of sweeping. Pattern kills (`pkill -f electron`, `killall Electron`) hit the user's own dev instance and every other Electron app.
- Do not rerun a broad failing command unchanged; isolate the failing package or command first.
- If a failure is pre-existing and unrelated, report it once and switch to focused validation.
- Builds and full suites heat the laptop. Batch related fixes and build once per batch.

## Testing the built app

- For exploratory agent testing, use `pnpm --filter @nordri/desktop qa`. It wraps the installed Playwright/Electron tools in an isolated session with a private build copy, local sites, diagnostics and restarts. See [Agent development QA](AGENT_QA.md) for interactive/scripted usage, fault injection and evidence limits. Existing focused harnesses remain available.

- Build first: `pnpm --filter @nordri/desktop build`. Scripts that launch `out/main/index.cjs` run whatever was last built.
- Use a temporary user-data directory and synthetic data (`apps/desktop/test-fixtures/job-finder/resume-import-sample.txt`), never the user's real workspace. `docs/resume-tests/` includes personal resumes; it is not a synthetic fixture source.
- Serialize isolated Electron launches; audit for leftover processes you own before launching another.
- Harness commands live in `apps/desktop/package.json` (`ui:*`, `test:job-finder-*`, `test:live-assistant-*`). `:built` variants use the existing build; the others rebuild.
- For an isolated production import without a native picker: `node apps/desktop/scripts/seed-product-quality-audit.mjs --user-data-dir <dir> --resume <synthetic-resume>`.

## Safety rules

- Never submit to a real employer site. Final submits, from an apply harness or the assistant, are allowed only against the local replica job sites (below): the harness must fail before sending if any application target is not a loopback replica origin. Every other apply harness keeps `submitAuthorized: false` and `accountCreationAuthorized: false` and fails if any attempt, job, or application record reaches `submitted`.
- Live prepare-only runs use a temporary user-data directory, a fake profile, and an approved deterministic resume. Anonymous Workday must stop at the account gate with a `site_login_required` handoff; never attempt credentials.
- Live Assistant harnesses default to deterministic providers with AI credentials blanked. Live providers require `UI_LIVE_ASSISTANT_PROVIDER_MODE=configured` (see `docs/AI_PROVIDER_SETUP.md`).
- Never add personal resumes, live workspaces, credentials, or authenticated browser state to benchmark corpora.
- Fixtures must not seed approved resume exports through `upsertResumeExportArtifact({ isApproved: true })`; both repositories reject it. Use the repository seed or `approveResumeExport()`. The guard is the invariant under test.

## Fit calibration gate

- `pnpm job-finder:fit-calibration` (also in `pnpm verify`) compares against the single baseline `packages/job-finder/test-fixtures/fit-calibration-baseline-v12.json`. It fails on the quality gates and on any `schemaVersion`, `corpusVersion`, or `scorerVersion` drift between run and baseline.
- Bumping `MATCH_ASSESSMENT_SCORER_VERSION` is expected to fail the gate until the baseline is regenerated. Read the case diff first, then run `node scripts/run-fit-calibration-benchmark.cjs --output <new-baseline>` and rename the baseline file plus both `package.json` references together so exactly one baseline exists. `--report-only` never fails and is not a gate.

## Benchmarks

- Resume import: `pnpm --filter @nordri/desktop benchmark:resume-import`
- Resume quality: `pnpm --filter @nordri/desktop benchmark:resume-quality` (`-- --canary-only` for the canary)
- AI capabilities: `pnpm ai:benchmark plan | full <lane> | canary luna_high | full-report`. Keep each lane serial. Deterministic fallbacks are reported separately and never credited to the model.
- Live discovery audit: `pnpm --filter @nordri/desktop audit:job-finder-live` needs network access and must never execute application actions.

## Assistant

- Unit and host tests: `pnpm validate:package job-finder` (session host, grants, change diff, action inventory) and `pnpm validate:package agent-runtime`.
- Eval lane: `pnpm --filter @nordri/ai-evals assistant-lane` runs the scripted-model cases; add `-- --model live` for the configured assistant model (serial; `--case <id prefix>`, `--out <dir>`). Report actual passes and failures, not percentages.
- Built app: after a desktop build, `pnpm --filter @nordri/desktop qa --script scripts/test-job-finder-assistant.mjs` drives the sidebar with the scripted model (set `NORDRI_TEST_ASSISTANT_DELAY_MS=600` to exercise Stop). With `--provider configured` it also sends one application, only to the qa launcher's replica site, and refuses any other target before sending. `scripts/test-job-finder-assistant-fixes.mjs` (configured provider; `NORDRI_QA_ONLY=M1,M4` runs chosen journeys) re-checks selection, truthful replies, exclusions, the studio refresh and an authorized send to the replica; `scripts/test-job-finder-assistant-browser.mjs` checks the browser side of the sidebar. A Playwright-launched window does not get OS focus, so that script reports the window as focused inside Electron; say so when you report its results.

## Local replica job sites

From the repo root, run `node apps/desktop/test-fixtures/job-sites/serve.mjs` with Node 22 or newer. Open `http://127.0.0.1:47950/` for the index; set `PORT` to override the port. Each listing URL below is a Job Finder source with ten fictional software jobs.

`http://127.0.0.1:47950/board/` exercises age badges, job details, the `/employer-a/apply/<id>` handoff, hidden resume upload, cover letter and required certification.

`http://127.0.0.1:47950/lever/` exercises location selection and autocomplete, opacity-zero resume upload, background-check consent and a fake CAPTCHA with an inline error.

`http://127.0.0.1:47950/greenhouse/` exercises attachment buttons and a drop zone, optional cover-letter upload, custom questions, yes/no radios and optional EEO selects.

`http://127.0.0.1:47950/workday/` exercises application choices, account creation/sign-in, four steps, repeatable work experience, simulated resume autofill, review and required terms. Use made-up credentials; accounts and saved steps live in server memory until restart. Saved steps do not restore after reload.

`http://127.0.0.1:47950/gatekeeper/` exercises a cookie overlay, chat bubble, eight-second security interstitial, new-tab application, per-field autosaves and in-page confirmation after fetch submission.

Run `node apps/desktop/test-fixtures/job-sites/check.mjs` for the HTTP self-check. It starts its own server on a random port, visits every job/application, submits one synthetic application per site, checks confirmations and POST logs, then stops that server. It does not execute browser JavaScript.

Every POST is logged as JSON to stdout and the gitignored `apps/desktop/test-fixtures/job-sites/submissions.log`; passwords are redacted and uploads record metadata only. All content is local and synthetic. Agent runs may send real applications to these fixtures, and only to them; read `submissions.log` to prove a send. Runs against any other site stay prepare-only. See the fixture folder's `README.md` for details.
