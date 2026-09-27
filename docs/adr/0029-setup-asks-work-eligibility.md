# ADR 0029: Guided setup asks where you can work and whether you need sponsorship

Status: accepted (2026-09-23).

Supersedes the eligibility part of ADR 0024's guided-setup bullet ("Work history, targeting, eligibility and work mode remain hints on their steps"). Work history, targeting and work mode stay hints.

## Context

Almost every application form asks two questions: "Are you legally authorized to work in this country?" and "Will you require sponsorship?". Setup let a person finish without answering them. The first end-to-end gate then needed five more presses after setup (Profile, Preferences, the sponsorship dropdown, No, Save) to stop the first application from asking. Under ADR 0027 a run hands an unanswered question back at the form instead of stopping, so skipping the answers still cost the person a question on their first application.

## Decision

- Job targets asks both, in plain words: the countries or regions where the person may work, and a No/Yes choice for visa sponsorship. The country the person lives in is offered as a one-press answer ("I can work in Germany"). It is never filled in for them, because living somewhere is not a right to work there.
- Setup finishes only when both are answered. An answer written in the saved answers ("Work authorization: Yes") counts too.
- An import fills either answer only from a sentence the resume states outright ("EU citizen", "No visa sponsorship required"). It never replaces an answer the person saved; a different reading waits for review.
- Applications use the same saved fields through the apply agent's answer sourcing, so the first application does not ask them again. The saved countries answer a work-authorization question only for the country the question names, or else the job's location (EU and EEA membership counts): Yes when the list covers it, No when it clearly does not, and the question goes back to the person when neither names a country or the list does not settle it.
- A setup finished before this change is not reopened. Only the Finish control in setup checks the two answers; the rule for when a saved setup counts as complete is unchanged.

## Consequences

- From import to Finish took 5 presses in setup plus a 5-press Profile round trip. It now takes 5 presses in total, both answers included.
- Scripts and harnesses that finish setup must answer the two questions.

Rejected alternatives: filling the answer from the person's location (a guess about a legal fact); a separate "Before you apply" step (ADR 0027 already rejected it); keeping the answers optional (the cost only moved to the first application).

## Related Decisions

- ADR 0022, ADR 0024, ADR 0027
