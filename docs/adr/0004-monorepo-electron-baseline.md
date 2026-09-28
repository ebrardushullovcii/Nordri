# Monorepo And Electron Baseline

Status: accepted

Use one `pnpm` plus `turbo` TypeScript monorepo and one Electron desktop app as the implementation baseline. One shell can host Job Finder and Live Assistant, Electron gives the fastest cross-platform path for desktop windowing, tray, hotkeys, overlays, and browser-adjacent workflows, and the monorepo keeps contracts, docs, test harnesses, and modules in one place for agents.

## Considered Options

- Separate repos per module: rejected because shared contracts, persistence, profile memory, and harnesses would drift.
- Web-only app first: rejected because native desktop windows, local persistence, browser automation, tray/hotkeys, and overlay work are first-class product constraints.
