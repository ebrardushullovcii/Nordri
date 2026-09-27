# Local replica job sites

From the repo root, run `node apps/desktop/test-fixtures/job-sites/serve.mjs` with Node 22 or newer. Open `http://127.0.0.1:47950/` for the index. Set `PORT=47951` before the command to use another port. Each listing URL can be added as a Job Finder source; each has ten fictional software jobs.

`http://127.0.0.1:47950/board/` exercises age badges, job details, a handoff to `/employer-a/apply/<id>`, a hidden resume input, cover letter and required certification.

`http://127.0.0.1:47950/lever/` exercises location selection and autocomplete, an opacity-zero resume input, background-check consent and a fake CAPTCHA with an inline error.

`http://127.0.0.1:47950/greenhouse/` exercises resume attachments and a drop zone, optional cover-letter upload, custom questions, radio buttons and optional EEO selects.

`http://127.0.0.1:47950/workday/` exercises application choices, account creation and sign-in, four steps, repeatable work experience, a simulated autofill spinner, review and required terms. Use made-up credentials; accounts and saved steps live only in server memory. Restarting clears them. Saved steps do not restore after a page reload.

`http://127.0.0.1:47950/gatekeeper/` exercises a cookie overlay, chat bubble, eight-second security interstitial, new-tab apply form, per-field fetch autosaves and a fetch submission that confirms receipt without navigation.

Run `node apps/desktop/test-fixtures/job-sites/check.mjs` for the dependency-free HTTP self-check. It starts and stops its own server on a random port, visits every job and application, and submits one synthetic application per site. It also checks account/CAPTCHA gates and POST logging; it does not execute browser JavaScript.

Every POST writes one JSON line to stdout and the gitignored `submissions.log` beside the server. Passwords are redacted; uploads log filename, type and size, not file contents. Startup messages go to stderr. All pages and assets are local, and successful applications display “Thank you! Your application has been received.” Use only synthetic data. Job Finder agent runs may send real applications to these fixtures, and only to them; the self-check also submits directly.
