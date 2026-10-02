# ADR 0041: The model reads the page; scripts do not interpret it

Status: accepted (2026-10-02).

Partly supersedes ADR 0023: compact card scans are no longer an accelerator that saves jobs.

## Context

The second usability round found jobs saved with a logo's initials as the company ("CR" for Cresta), with a board's tag chips as the location, and with a "DE" country code read as Delaware. Each came from code that parsed page text by rules: the `scan_cards` tool saved repeated DOM cards without a model call, and its parsed company and location were also handed to the extractor as evidence. The first fixes added more rules on top (initials patterns, tag-chip class names, class-name reads on detail pages). The same pattern sits behind other findings: a keyword list read "privacy notice" as a notice period, and title words decided role matches.

The agent already sees the whole page. It can tell a logo from a company, a tag from a place, and Berlin's DE from Delaware's.

## Decision

- **Job details come from the model.** A search saves postings only through `extract_jobs`, where the model reads the page and returns each job's fields. The `scan_cards` tool is removed. The extractor gets the visible page text and the page's posting links; scripts no longer pass it guessed companies or places, and no rule rewrites what it returned (initials, tag text, country codes).
- **Data published for machines is read as published.** JSON-LD `JobPosting` records and provider job-board APIs are the site's own structured data, not guesses, and stay deterministic. Page text is never parsed by rules to fill job fields.
- **Code keeps safety and mechanics.** Final submit authority, consent, credentials, allowed origins, identity of the same URL, counts, dates and time zones, and file fingerprints stay deterministic.
- **One model read per page.** The model reads a page once and returns everything on it, rather than being called per field or per job. A full fit assessment of one listing (about a minute) runs when the person asks for it, not for every job a search finds.

## Consequences

Searching a results page now costs one model call where the card scan cost none; large boards take longer per page. Jobs saved before this change keep whatever the scan recorded until they are seen again.

Other places still interpret human-written content by rules and should move to the model under this decision: resume import source validation, application question classification and answer matching, the fit scorer's keyword and title matching, and result grouping by title words.
