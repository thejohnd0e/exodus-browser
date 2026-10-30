# Proxy Check UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click IP checking with the result displayed in the profile card.
**Architecture:** App stores temporary results by UUID; ProfileList displays them. Main calls the existing check without showMessageBox; IPC and networking remain unchanged.
**Tech Stack:** TypeScript, React, Vitest/Testing Library, Electron/Playwright.
**Spec:** `docs/superpowers/specs/2026-10-30-proxy-check-ux-design.md` (design approved in chat).

## Global Constraints

- No background requests or changes to browser protections or Chromium arguments.
- Keep the HTTP warning visible next to the button.
- Do not change the IPC contract or store IP addresses in SQLite.

## Review Focus

Check that the result belongs to the correct card; an error does not leave an old IP visible; changing the proxy resets the result; checking again clears the previous result; and no network request occurs before a click. Cover these cases with the tests below.

## Task 1: IP checking and regression tests

**Files:** `src/main/index.ts`, `src/renderer/App.tsx`, `src/renderer/ProfileList.tsx`, renderer CSS; `tests/unit/ui.test.tsx`, `tests/integration/app-smoke.test.ts`.
**Interfaces:** Keep ProfileApi.checkProxy(id); add temporary results by UUID to ProfileList and display success inside the profile article.

- [x] Add UI tests: two profiles; one click calls the API only with the intended UUID; success appears inside the correct article without role=alert or a URL; the warning is visible before clicking; errors are separate; another request and proxy changes clear the old IP. Run `npx vitest run tests/unit/ui.test.tsx` and observe the expected failures.
- [x] Implement result state in App and output and warnings in ProfileList; remove the modal checkProxy confirmation in main. Keep the other dialogs.
- [x] Rerun UI tests; expect PASS.
- [x] Add an Electron scenario with a temporary data directory and local upstream: no requests before clicking; clicking triggers the check without showMessageBox; the result appears in the card. Do not contact the external service (respond locally). Make sure the scenario distinguishes the old behavior from the new behavior.

## Task 2: Documentation and final verification

**Files:** `README.md`, `STATUS.md`, `DECISIONS.md`, `TODO.md`, `docs/architecture.md`, `docs/verification.md`, `src/main/engines/releases.json` (reason explanation only).
**Interfaces:** Do not change the pinned version, URL, or SHA-256.

- [x] Remove outdated claims about an unpinned release and unavailable metadata; reference the correct endpoint; describe the confirmed Stable release and new UX. Do not mark the remaining P0 items complete.
- [x] Run `npm run verify` and `npm run test:integration`; expect exit 0. Check `git diff --check` and inspect the diff for changes to Chromium or secrets.
- [x] Record actual results in STATUS and verification. Obtain an independent review of the changes, then report the result to the user; commit only with approval.

Outcome: verify — 48/48 unit, typecheck/build PASS; integration — 16/16 PASS. Independent review: no blockers; a dedicated password-only change test was deferred to TODO P2. Changes are uncommitted.
