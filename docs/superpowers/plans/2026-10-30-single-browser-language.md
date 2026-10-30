# One Selectable Browser Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one freely selectable website language per profile, with search, without disabling Accept-Language reduction.

**Architecture:** The UI shows one search/selection field; the storage contract remains `languages: string[]`, but new records accept exactly one element. Legacy records and v2 archives with multiple languages are normalized to the first (primary) language; SQLite remains at schema v2.

**Tech Stack:** TypeScript, React 19, Zod, SQLite (`better-sqlite3`), Vitest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-10-30-single-browser-language-design.md`

## Global Constraints

- Do not disable Accept-Language Reduction or other privacy protections.
- Do not change SQLite schema v2 or profile directories.
- Keep the current `languages: string[]` shape as a single-element array.
- Use the first (primary) language for legacy multivalue data.
- Continue reading backup v1 (`language`) and v2 (`languages`); new v2 archives contain a singleton array.
- Do not open or migrate the real user database; do not commit changes.
- Add a failing test before changing behavior; run `npm run verify` and `npm run test:integration` after changes.

## Review Focus

- Empty or invalid language list in stored data: reject with an error rather than inventing a value — Task 2 tests the error.
- Legacy database record contains multiple locales: select the first element — Task 2 tests reading.
- Legacy v2 backup contains multiple locales: restore the first element — Task 2 tests restore.
- Selecting a new language while editing must not retain the previous one — Task 1 tests the submitted value.
- Chromium may reduce Accept-Language to a language subtag: Task 3 checks the selected `navigator.language` and a compatible primary HTTP token without requiring the full list.

---

### Task 1: One searchable language field and singleton validation

**Files:**
- Modify: `src/renderer/LanguagePicker.tsx`
- Modify: `src/renderer/ProfileEditor.tsx` (only if changing the prop/state from an array to a string is necessary; preferably keep `languages` and adapt the picker)
- Modify: `src/shared/validation.ts`
- Test: `tests/unit/ui.test.tsx`
- Test: `tests/unit/validation.test.ts`
- Test: `tests/unit/proxy-library.test.ts` (existing fixtures/canonicalization test must reflect the newly singleton contract)

**Interfaces:**
- Keep `ProfileInput.languages: string[]`; the picker still accepts an array and calls `onChange` with an array containing exactly one value.
- `languagesSchema` accepts only an array of length 1; `localeSchema` remains the source of BCP47 canonicalization.

- [ ] **Step 1: Add a UI test for the new single selection.** Check that searching for `de` shows `de-DE`, selecting it submits `languages: ['de-DE']`, and reopening/selecting `fr-FR` replaces the value with `['fr-FR']`; check that the “Add language”, “Move up”, “Move down”, and “Remove” buttons are absent.
- [ ] **Step 2: Run `npx vitest run tests/unit/ui.test.tsx`; confirm failure due to the old multi-select UI/expected contract.**
- [ ] **Step 3: Add validation tests: one valid language is accepted; an empty array and two languages are rejected.**
- [ ] **Step 4: Run `npx vitest run tests/unit/validation.test.ts`; confirm that the two-language test fails before changing the schema.**
- [ ] **Step 5: Implement one searchable selection field in `LanguagePicker.tsx`.** Preserve catalog selection, custom valid BCP47 codes, accessible labels, and disabled state while busy; remove priorities, adding, and removal.
- [ ] **Step 6: Limit `languagesSchema` to one element; make form hints/errors singular and remove UI tests for the old multi-select.
- [ ] **Step 7: Run `npx vitest run tests/unit/ui.test.tsx tests/unit/validation.test.ts`; expect PASS.**

### Task 2: Stored profile and backup compatibility

**Files:**
- Modify: `src/shared/validation.ts`
- Modify: `src/main/profiles/service.ts`
- Modify: `src/main/backups/service.ts`
- Test: `tests/unit/profiles.test.ts` or new `tests/unit/single-language-compat.test.ts`
- Test: `tests/integration/backups.test.ts`

**Interfaces:**
- New `languagesSchema`: an array containing exactly one canonical BCP47 code.
- Add a separate schema for reading historical lists (1–20 unique valid codes), without weakening validation of new `ProfileInput` values.
- Historical list normalization: `normalizeStoredLanguages(languages: string[]): [string]` selects the first element; an empty list is not normalized and remains an error.

- [ ] **Step 1: Add a test for a legacy v2 profile with `languages: ['de-DE','fr-FR']`; expect `ProfileService.get/list` to return `['de-DE']` without changing SQLite `user_version`.
- [ ] **Step 2: Run the relevant unit test and confirm failure: the service returns both languages.
- [ ] **Step 3: Add a backup test for a version 2 manifest with two languages; expect only the first language to be restored. Also check that a new backup writes one element and v1 backup restore still works.
- [ ] **Step 4: Run `npx vitest run tests/integration/backups.test.ts`; confirm the expected failure in legacy v2 reading/normalization.
- [ ] **Step 5: Implement normalization at the profile reading boundary and a separate legacy v2 manifest schema; pass only the first language to `restoreProfile`. Do not add a SQL migration.
- [ ] **Step 6: Check corrupt/empty legacy lists: restore/profile reading returns a controlled error without silently choosing a default language.
- [ ] **Step 7: Run targeted unit and backup tests; expect PASS, including the unchanged v1→v2 migration test.

### Task 3: Real Chromium verification and documentation

**Files:**
- Modify: `tests/integration/languages.test.ts`
- Modify: `README.md`
- Modify: `STATUS.md`
- Modify: `TODO.md`
- Modify: `DECISIONS.md`
- Modify: `docs/development.md`
- Modify: `docs/verification.md`

**Interfaces:**
- Chromium still receives `languages[0]` as `--lang`, and Preferences receive one selected locale.
- Do not add `--disable-features` or another workaround for Accept-Language Reduction.

- [ ] **Step 1: Rewrite the integration test from two languages to one selected language.** For `de-DE`, and `fr-FR` after restarting, check `navigator.language`, the first element of `navigator.languages`, the first Accept-Language token, localStorage persistence, and a singleton array in Preferences.
- [ ] **Step 2: Run `npx vitest run tests/integration/languages.test.ts`; confirm that the check passes with standard Chromium flags, without opt-out.
- [ ] **Step 3: Update README and development documentation: one language selected with search; websites may see a reduced list; the language UI does not promise multiple languages.
- [ ] **Step 4: Update STATUS/TODO/DECISIONS/verification: mark the reduction investigation closed by the decision to preserve privacy; record actual results and remaining manual checks.
- [ ] **Step 5: Run `npm run verify`; expect typecheck, 58+ unit tests, and production build without errors.
- [ ] **Step 6: Run `npm run test:integration`; expect 7/7 files and 19+ tests PASS, including Chromium language and backup compatibility.
- [ ] **Step 7: Run `git diff --check`; check `git status --short` and ensure only the user's changes remain uncommitted; do not touch the database at `%APPDATA%\Local Profiles`.
