# ADR 0041: The model reads the page; scripts do not interpret it

Status: accepted (2026-10-02); fit and application answers added the same day.

Partly supersedes ADR 0023: compact card scans are no longer an accelerator that saves jobs.

## Context

The second usability round found jobs saved with a logo's initials as the company ("CR" for Cresta), with a board's tag chips as the location, and with a "DE" country code read as Delaware. Each came from code that parsed page text by rules: the `scan_cards` tool saved repeated DOM cards without a model call, and its parsed company and location were also handed to the extractor as evidence. The first fixes added more rules on top (initials patterns, tag-chip class names, class-name reads on detail pages). The same pattern sits behind other findings: a keyword list read "privacy notice" as a notice period, and title words decided role matches.

The agent already sees the whole page. It can tell a logo from a company, a tag from a place, and Berlin's DE from Delaware's.

## Decision

- **Job details come from the model.** A search saves postings only through `extract_jobs`, where the model reads the page and returns each job's fields. The `scan_cards` tool is removed. The extractor gets the visible page text and the page's posting links; scripts no longer pass it guessed companies or places, and no rule rewrites what it returned (initials, tag text, country codes).
- **Data published for machines is read as published.** JSON-LD `JobPosting` records and provider job-board APIs are the site's own structured data, not guesses, and stay deterministic. Page text is never parsed by rules to fill job fields.
- **Listing pages without a record are read by the model.** A listing that publishes no JSON-LD record is turned into plain text and the model returns the posting, or nothing when the page is not one (a sign-in page, a talent pool, a closed listing). Page text is no longer cut, trimmed or accepted by word counts and cue words.
- **The model decides fit.** After a search, the model judges the jobs in batches of twenty: role, preference and place fit, a score, a recommendation, reasons and gaps. "Read and assess listing" asks it about one listing in full. Its verdict is stored on the assessment and stands: no rule recomputes the score, caps it, or corrects the place. The rule scorer only gives a job a number until it is judged, and a job is judged again when the profile, the goals or the listing change.
- **The model answers application questions.** What the apply agent types or chooses stands when it matches the person's stored answer or the fact check (a model reading the answer against the person's profile, resume and saved answers) supports it. Keyword-classified stored answers no longer replace what the model typed or refuse the option it chose; they are used only when no fact check is available.
- **Code keeps safety and mechanics.** Final submit authority, consent, credentials, allowed origins, identity of the same URL, counts, dates and time zones, and file fingerprints stay deterministic. So do the person's own switches: pay they keep to themselves, declarations they did not approve, companies they blocked and places they excluded.
- **One model read per page.** The model reads a page once and returns everything on it, rather than being called per field or per job. Fit is judged many jobs per call; a full assessment of one listing (about a minute) runs when the person asks for it.

## Consequences

Searching a results page now costs one model call where the card scan cost none, and a search adds one judging call per twenty jobs (at most five per run). Jobs saved before this change keep whatever the scan recorded until they are seen again. When the model is unavailable, jobs keep their rule score and are judged on the next search; nothing pretends a rule score is the model's.

Still interpreted by rules, and next to move: resume import source validation and literal extraction (they guard the profile against invented facts, so they move only with a fact check that does the same), the "only collect jobs that match" search setting's title and place filters, closure phrases on saved listings, the keyword classification that finds a pay question for the person's pay switch, and result grouping by title words.
