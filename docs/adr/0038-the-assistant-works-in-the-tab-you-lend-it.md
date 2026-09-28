# ADR 0038: The assistant works in the tab you lend it

Status: accepted (2026-09-27).

Narrows ADR 0034's protection of tabs the person opened, for the assistant only. ADR 0017's minimize and close meanings are unchanged.

## Context

People open a page in the embedded browser and ask the assistant to read it, collect the jobs on it, or apply there. ADR 0034 protects a tab the person opened from automation, which would make every such request impossible.

## Decision

- **A lease on send.** Sending a message while a browser tab is visible lends that exact tab to the assistant's turn. The lease is a normal automation claim (`runAutomation`) owned by `assistant:<conversationId>` and is recorded with the conversation. No other tab is touched.
- **Takeover by click.** A real click or keypress by the person on the lent tab ends the lease at once; the assistant's next browser step fails with "the person took over" and the turn reports it. Focus or hovering does not.
- **Real popups.** A popup the page opens during the lease is adopted into the same lease, so sign-in and apply windows work.
- **Fenced late writes.** Every browser step checks the turn's generation; a stopped or superseded turn cannot act on the page after Stop, even if a step was in flight.
- **The final send stays gated.** Page tools refuse a final submit; sending goes through the application send path and its grants (ADR 0039) and preflight (ADR 0012). Page text is data: it cannot grant authority, choose files or tabs, or reach the bridge.

## Consequences

The assistant can read, click, type, upload, collect jobs and prepare an application on a page the person chose, and stops the moment they take the tab back. Tabs the person did not lend stay protected as before.
