# Shared Proxy Library and Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared proxy library and ordered locale list matching the approved mockup.
**Architecture:** SQLite v2 with separate proxies referenced by profiles; narrow, validated IPC. Take a proxy snapshot at startup and apply standard language Preferences. React: a separate library, a reusable proxy editor, and language selection with search and ordering.
**Tech Stack:** Electron, TypeScript, React, better-sqlite3, Zod, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-30-proxy-library-locales-design.md`.

## Global Constraints
- Do not touch the real database, profile directories, or installed Dolphin; test with temporary data.
- Preserve existing uncommitted changes; use master as requested by the user. No commits or pushes.
- 1–20 canonical BCP47 languages, up to 64 characters each; new profile [ru-RU].
- Secrets only through safeStorage, never DTO/argv/logs; no DIRECT fallback.
- A proxy assigned to profiles cannot be deleted; running browsers are not reconfigured.
- Archive v2 excludes the password and local ID; retain v1 reading support.

## Review Focus
1. Migration of corrupt v1 data must roll back completely; transfer the password BLOB without decrypting it (Task 1).
2. Editing a shared proxy during a run must not change the existing bridge or leave the old IP marked as current (Tasks 1, 4).
3. The language list must be observable in real Chromium, not just the DTO (Task 2).
4. Adding a proxy from the form must not lose its draft or select a record after cancellation (Task 4).
5. A restore failure must not leave a partial profile or an orphaned new proxy (Task 3).

## Task 1 — Contracts, migration, service
**Files:** `src/shared/{contracts,validation}.ts`, `src/main/profiles/{repository,service}.ts`, `tests/unit/{validation,profiles,supervisor}.test.ts`, new `tests/unit/migration.test.ts`, `tests/fixtures/profiles.ts`.
**Interfaces:** ProfileInput{name,note,startUrls,languages:string[],proxyId:string|null}; SavedProxyInput=ProxyInput & {name}; SavedProxy=ProxyPublic & {id,name,createdAt,updatedAt,profileIds:string[]}; Profile adds a resolved proxy. ProfileService: listProxies(), getProxy(id), createProxy(input), updateProxy(id,input), removeProxy(id), getProxyInput(id); getLaunchInput returns a snapshot of languages and ProxyInput.
- [ ] Write failing tests for canonical languages/duplicates, shared records/secrets/FK, v1 migration, and rollback; adapt fixtures to the new shape. Run targeted tests before implementation; expect FAIL.
- [ ] Implement strict contracts, transactional v2 migration, and CRUD; preserve path and lifecycle checks.
- [ ] Verify RED→GREEN and a runtime test: the old lease uses the original credentials; a new run uses the changed ones.

## Task 2 — Real Chromium languages
**Files:** `src/main/engines/{types,chromium}.ts`, `src/main/runtime/supervisor.ts`, `tests/unit/engine.test.ts`, `tests/integration/{isolation,languages}.test.ts`.
**Interfaces:** EngineLaunch.languages:string[]; launch receives a nonempty canonical list; --lang=first language; update profile Preferences intl.accept_languages/selected_languages before spawn, preserving other fields.
- [ ] Write a real-browser test using a local HTTP server: navigator.language/languages and Accept-Language for two different languages, reordering and restarting, and localStorage persistence. Confirm FAIL first.
- [ ] Implement standard Preferences using atomic writes without weakening protections; update the adapter and supervisor. Rerun the test until PASS; a missing engine means BLOCKED.

## Task 3 — Backups and IPC
**Files:** `src/main/backups/service.ts`, `src/main/{index,ipc}.ts`, `src/preload/index.ts`, `tests/integration/{backups,app-smoke}.test.ts`, `tests/unit/ipc.test.ts`.
**Interfaces:** New ProfileApi listProxies/createProxy/updateProxy/removeProxy/checkSavedProxy; keep the existing checkProxy(profileId). Manifest v2={version:2,profile:{name,note,startUrls,languages,proxy:public snapshot with name|null}}.
- [ ] RED tests: v1→new profile/proxy, v2 languages/proxy without password/ID, rollback, IPC rejects invalid payloads and untrusted frames.
- [ ] Implement archive v2/v1 reading and atomic publication; register new IPC operations through the existing trust checks and schemas. Preserve a narrow preload and no requests before the button is clicked.
- [ ] Rerun tests until PASS.

## Task 4 — Approved interface
**Files:** `src/renderer/{App,ProfileEditor,ProfileList}.tsx`, new `LanguagePicker.tsx`, `ProxyEditor.tsx`, `ProxyLibrary.tsx`, `src/shared/locales.ts`, `src/renderer/styles.css`, `tests/unit/ui.test.tsx`, `tests/integration/app-smoke.test.ts`.
**Interfaces:** Shared proxy list from the API; the profile editor saves proxyId/languages. The IP result includes a fingerprint of the profile and proxy versions. Runtime snapshot metadata without secrets allows outdated settings of an active browser to be marked.
- [ ] RED UI tests: search/add/order/last language, shared proxy selection, creating and cancelling a nested editor without losing the draft, password-only changes invalidate the IP.
- [ ] Implement the mockup in the existing style without copying sample network responses. Protect assigned proxies from deletion in main; the UI shows assignments and that changes apply after restarting.
- [ ] Electron: new preload surface, proxy/profile creation, real loopback IP check; visually inspect a separate instance using test data.

## Task 5 — Verification and documentation
- [ ] `npm run verify`, `npm run test:integration`, `git diff --check`: PASS; fix or explicitly report every discovered error.
- [ ] Update README, STATUS, DECISIONS, TODO, architecture/development/verification: new entities, the v1/v2 boundary, real language verification; unverified P0 items remain open.
- [ ] Independent review of the entire changeset; fix Critical/Important findings with RED→GREEN. Do not open the user database or commit without approval.
