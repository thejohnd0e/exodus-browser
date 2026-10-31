# Extension Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen for this single-subsystem change) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a library of browser extensions installed from a local folder or ZIP, and let each profile enable a chosen set of them.

**Architecture:** Each library entry is an independent, validated copy stored under `extensions/<id>/` in the application data directory. Launch passes each enabled copy to Chromium with `--load-extension`. The library lives in a new `extensions` SQLite table (schema version 3); each profile stores its `extensionIds` in its existing JSON data, so no assignment table is needed.

**Tech Stack:** Electron 45, TypeScript, Zod, better-sqlite3, yauzl (existing archive reader), React 19, Vitest, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-10-31-extension-library-design.md`

## Global Constraints

- Source of truth for behavior: the approved spec. No Chrome Web Store support, no auto-update, no live loading of source folders, no forced browser closure.
- Renderer receives no file paths. Folder and ZIP selection run only in main through native dialogs.
- Library ID is a UUID; the copy directory is `<root>/extensions/<id>/` and never changes, so an unpacked extension ID stays stable across updates.
- Manifest must be `manifest_version: 3`, have `name` and `version`, and be a regular file named `manifest.json` at the package root. Reject symlinks, path traversal, duplicate entries and archives over the existing limits (`src/main/backups/archive.ts`).
- Do not log paths, manifests' contents beyond names/versions, or profile data.
- Do not add `--disable-extensions`. Keep sandbox, contextIsolation and CSP unchanged.
- Russian text appears only in `src/shared/i18n/ru.ts` and translation-test fixtures; all tracked prose and comments in English.
- TDD for every behavior: write the failing test, run it, see the expected failure, then implement.
- Do not commit local-only files (`AGENTS.md`, `CLAUDE.md`, `DECISIONS.md`, `STATUS.md`, `TODO.md`).

## Review Focus

- A ZIP or folder that contains a symlink, `..` path, or a second `manifest.json` in a subdirectory is rejected before anything is copied into the library.
- Updating an extension while a profile using it is running: the running profile keeps its loaded copy; the change applies only at the next launch.
- Removing a library entry that is assigned to profiles removes those assignments in the same transaction; a missing copy directory blocks only the affected profile with a clear error.
- A profile with a non-Manual timezone and an assigned extension whose name suggests timezone spoofing gets a non-blocking warning only.
- Deleting or backing up a profile does not corrupt library entries; portable export (`src/main/portable`) must not include the shared extension copies.

## File Map

- Create `src/shared/extension.ts`: schemas and types for library entries and manifest subset.
- Create `src/main/extensions/package.ts`: validate a folder or ZIP, return manifest summary and copy plan.
- Create `src/main/extensions/library.ts`: library repository (SQLite table) and add/update/remove operations with staging and atomic rename.
- Modify `src/main/profiles/repository.ts`: schema version 3 creates `extensions` table.
- Modify `src/shared/contracts.ts`, `src/shared/validation.ts`: `extensionIds` on profile input; extension DTOs; new `ProfileApi` methods.
- Modify `src/main/profiles/service.ts`: store `extensionIds`; `getLaunchInput` resolves enabled copy directories; strip removed IDs.
- Modify `src/main/engines/types.ts`, `src/main/engines/chromium.ts`: `extensionDirs` argument and arguments.
- Modify `src/main/runtime/supervisor.ts`: pass resolved extension directories to the engine.
- Modify `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: IPC operations with dialogs in main.
- Create `src/renderer/ExtensionLibrary.tsx`, `src/renderer/ExtensionEditorSection.tsx`: library view and per-profile checkboxes.
- Modify `src/renderer/App.tsx`, `src/renderer/ProfileEditor.tsx`, `src/renderer/styles.css`, `src/shared/i18n/en.ts`, `src/shared/i18n/ru.ts`, `src/shared/i18n/messages.ts`.
- Tests: `tests/unit/extension-package.test.ts`, `tests/unit/extension-library.test.ts`, `tests/unit/chromium-args.test.ts` (extend existing), `tests/unit/ui-extensions.test.tsx`, `tests/integration/extensions.test.ts`, `tests/integration/app-smoke.test.ts` (extend).

---

### Task 1: Package validation

**Files:**
- Create: `src/shared/extension.ts`
- Create: `src/main/extensions/package.ts`
- Test: `tests/unit/extension-package.test.ts`

**Interfaces:**
- Produces: `ExtensionSummary = {name: string; version: string}`; `validateManifest(text: string): ExtensionSummary` (throws `EXTENSION_INVALID_MANIFEST`); `inspectFolder(dir: string): Promise<ExtensionSummary>`; `inspectZip(file: string, staging: string): Promise<ExtensionSummary>` (extracts into `staging` and validates; throws `EXTENSION_UNSAFE_PACKAGE` or `EXTENSION_INVALID_MANIFEST`).

- [ ] **Step 1: Write failing tests**

Cover: valid MV3 manifest accepted; `manifest_version: 2` rejected; missing `version` rejected; folder with symlinked `manifest.json` rejected; ZIP containing `../evil.js` rejected; ZIP with two `manifest.json` files (root and nested) rejected; valid ZIP extracts to staging. Use temporary directories and the existing `createZip` helper pattern from `tests/unit/` (look at how backup tests create ZIPs).

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/extension-package.test.ts`
Expected: FAIL, module `src/main/extensions/package` not found.

- [ ] **Step 3: Implement minimal validation**

Implement `validateManifest` with a Zod schema (`manifest_version` literal 3, `name` 1–75 chars, `version` 1–32 chars). `inspectFolder` uses `lstat` to reject symlinks at the root and reads `manifest.json`. `inspectZip` delegates to `extractArchive` with the existing limits and rejects any entry whose base name is `manifest.json` but is not exactly at root.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/extension-package.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/extension.ts src/main/extensions/package.ts tests/unit/extension-package.test.ts
git commit -m "feat: validate extension folders and archives"
```

---

### Task 2: Library storage and schema v3

**Files:**
- Modify: `src/main/profiles/repository.ts`
- Create: `src/main/extensions/library.ts`
- Test: `tests/unit/extension-library.test.ts`

**Interfaces:**
- Consumes: `inspectFolder`, `inspectZip` from Task 1.
- Produces:
  - `ExtensionEntry = {id: string; name: string; version: string; addedAt: string; updatedAt: string}`
  - `class ExtensionLibrary` with `constructor(root: string, db: Database)`, `list(): ExtensionEntry[]`, `directoryFor(id: string): string` (returns `<root>/extensions/<id>`), `addFromFolder(source: string): Promise<ExtensionEntry>`, `addFromZip(file: string): Promise<ExtensionEntry>`, `updateFromFolder(id: string, source: string): Promise<ExtensionEntry>`, `updateFromZip(id: string, file: string): Promise<ExtensionEntry>`, `remove(id: string): void` (removes the row and assignments in `profiles`, then deletes the copy directory), `exists(id: string): boolean`.
- Staging: copy into `<root>/extensions/.staging-<uuid>/`, validate, then rename to `<root>/extensions/<id>/`. On update, rename the old directory aside, rename the new one in, then delete the old one; on failure restore.

- [ ] **Step 1: Write failing tests**

Tests: schema migrates to `user_version` 3 and an existing v2 database keeps profiles; `addFromFolder` creates a row and a copy that is independent of the source (modify source afterwards, copy unchanged); `updateFromFolder` keeps the same ID and directory; a failing validation leaves no row and no directory; `remove` strips the ID from profile data (`profiles` rows with `extensionIds` containing it) and deletes the copy.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/extension-library.test.ts`
Expected: FAIL, `ExtensionLibrary` not defined and user_version still 2.

- [ ] **Step 3: Implement**

In `repository.ts`, accept `user_version` ≤ 3 and, when below 3, run `CREATE TABLE extensions(id TEXT PRIMARY KEY, data TEXT NOT NULL)` then set `user_version = 3`. Implement the library with the staging approach described above. `remove` runs in one SQLite transaction for the row and profile data rewrite, then deletes the directory outside the transaction.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/extension-library.test.ts tests/unit/migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/profiles/repository.ts src/main/extensions/library.ts tests/unit/extension-library.test.ts
git commit -m "feat: store extension library copies and assignments"
```

---

### Task 3: Profile assignments and launch resolution

**Files:**
- Modify: `src/shared/contracts.ts`, `src/shared/validation.ts`, `src/main/profiles/service.ts`
- Test: extend `tests/unit/profiles.test.ts`

**Interfaces:**
- Consumes: `ExtensionLibrary.directoryFor`, `exists` from Task 2.
- Produces: `ProfileInput.extensionIds: string[]` (default `[]`, each a UUID, max 50, no duplicates); `LaunchInput.extensionDirs: string[]`.

- [ ] **Step 1: Write failing tests**

Tests: a profile created with `extensionIds` round-trips; `getLaunchInput` returns `extensionDirs` only for IDs whose copies exist; an ID whose copy directory is missing makes `getLaunchInput` throw `EXTENSION_MISSING` (the profile is not launched); an unknown ID rejected by validation; duplicates rejected.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/profiles.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

Extend the Zod profile schema; keep older profiles readable by defaulting `extensionIds` to `[]`. Inject a resolver into `ProfileService` for directories so tests can stub it.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/profiles.test.ts tests/unit/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts src/shared/validation.ts src/main/profiles/service.ts tests/unit/profiles.test.ts
git commit -m "feat: assign library extensions to profiles"
```

---

### Task 4: Chromium arguments and supervisor wiring

**Files:**
- Modify: `src/main/engines/types.ts`, `src/main/engines/chromium.ts`, `src/main/runtime/supervisor.ts`
- Test: extend `tests/unit/chromium-args.test.ts` (create if absent, following `tests/unit/cdp-fingerprint.test.ts` style)

**Interfaces:**
- Consumes: `LaunchInput.extensionDirs` from Task 3.
- Produces: `EngineLaunch.extensionDirs?: string[]`.

- [ ] **Step 1: Write failing tests**

Assertions on `chromiumArgs`: with two directories the argument list contains `--disable-extensions-except=<a>,<b>` and `--load-extension=<a>,<b>`; with none, neither is present; `--disable-extensions` is never present.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/chromium-args.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the two arguments in `chromiumArgs` when `extensionDirs` is non-empty, joined with commas. Pass `extensionDirs` from `Supervisor.start` into `engine.launch`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/chromium-args.test.ts tests/unit/supervisor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/engines/types.ts src/main/engines/chromium.ts src/main/runtime/supervisor.ts tests/unit/chromium-args.test.ts
git commit -m "feat: load enabled extension copies at browser launch"
```

---

### Task 5: IPC operations

**Files:**
- Modify: `src/shared/contracts.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/i18n/messages.ts`
- Test: extend `tests/unit/ipc.test.ts`, `tests/integration/app-smoke.test.ts` (surface keys)

**Interfaces:**
- Produces on `ProfileApi`: `listExtensions(): Promise<Result<ExtensionEntry[]>>`, `addExtensionFolder(): Promise<Result<ExtensionEntry | null>>`, `addExtensionZip(): Promise<Result<ExtensionEntry | null>>`, `updateExtension(id: string): Promise<Result<ExtensionEntry | null>>` (opens dialog in main), `removeExtension(id: string): Promise<Result<void>>`.
- Dialogs and file reads happen only in main; renderer receives only entries.

- [ ] **Step 1: Write failing tests**

Dispatcher rejects invalid UUIDs for `updateExtension`/`removeExtension`; surface test expects the five new keys in order; `removeExtension` on a running profile's enabled extension returns `PROFILE_BUSY` (a profile using it must be stopped; per spec, blocking is only for running copies being replaced).

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/ipc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Register schemas, handlers, preload methods and safe error codes (`EXTENSION_INVALID_MANIFEST`, `EXTENSION_UNSAFE_PACKAGE`, `EXTENSION_MISSING`, `EXTENSION_NOT_FOUND`) with EN/RU messages.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts src/shared/i18n/messages.ts tests/unit/ipc.test.ts tests/integration/app-smoke.test.ts
git commit -m "feat: expose extension library operations over IPC"
```

---

### Task 6: Renderer library and profile checkboxes

**Files:**
- Create: `src/renderer/ExtensionLibrary.tsx`, `src/renderer/ExtensionEditorSection.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/ProfileEditor.tsx`, `src/renderer/styles.css`, `src/shared/i18n/en.ts`, `src/shared/i18n/ru.ts`
- Test: `tests/unit/ui-extensions.test.tsx`

**Interfaces:**
- Consumes: the five `ProfileApi` methods from Task 5.
- `ExtensionLibrary` shows entries with name, version, Add folder…, Add ZIP…, Update…, Remove (confirmation via existing `ConfirmDialog`).
- `ExtensionEditorSection({value, library, disabled, onChange})` lists library entries as checkboxes and shows the non-blocking timezone warning when the timezone mode is not Manual and an enabled extension name contains "timezone" (case-insensitive).

- [ ] **Step 1: Write failing tests**

Tests: the library lists entries from `listExtensions`; Remove opens the confirmation and calls `removeExtension` only after approval; checkboxes in the editor save `extensionIds`; the timezone warning appears only in the stated condition and does not block saving.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/ui-extensions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use the existing button/`settings-panel` styling. Keep English source strings and add EN/RU keys with parity.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/ui-extensions.test.tsx tests/unit/ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ExtensionLibrary.tsx src/renderer/ExtensionEditorSection.tsx src/renderer/App.tsx src/renderer/ProfileEditor.tsx src/renderer/styles.css src/shared/i18n/en.ts src/shared/i18n/ru.ts tests/unit/ui-extensions.test.tsx
git commit -m "feat: manage extensions in the library and per profile"
```

---

### Task 7: Real-Chromium integration and acceptance

**Files:**
- Create: `tests/integration/extensions.test.ts`

**Interfaces:**
- Consumes: the whole stack through `ProfileService`, `ExtensionLibrary`, `ChromiumAdapter`.

- [ ] **Step 1: Write failing integration test**

Create a minimal MV3 fixture extension in the test (a `manifest.json` plus a background script that writes `chrome.storage.local` value `marker`). Add it to the library, assign it to profile A only, launch A and B, verify A's service worker exists and B's does not; stop, relaunch A and verify the stored value persists; update the fixture to version 2 and verify the loaded version changes only at next launch; remove the entry and verify the copy directory is gone and launch no longer includes it.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:integration -- tests/integration/extensions.test.ts`
Expected: FAIL until Tasks 1–6 are complete.

- [ ] **Step 3: Implement any remaining glue found by the test**

Fix only what the failing assertions show.

- [ ] **Step 4: Run and confirm pass**

Run: `npm run test:integration`
Expected: PASS, all integration files.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/extensions.test.ts
git commit -m "test: verify extension isolation and updates in Chromium"
```

---

### Task 8: Verification, acceptance and documentation

**Files:**
- Modify (local docs, not committed): `STATUS.md`, `TODO.md`, `DECISIONS.md`, `docs/verification.md`, `docs/architecture.md`

- [ ] **Step 1: Run full verification**

Run: `npm run verify` then `npm run test:integration`
Expected: both exit 0; record actual totals.

- [ ] **Step 2: Manual acceptance with the real TimeZone Changer folder**

Add `D:\MyProjects\TimeZoneChanger` as a folder, assign it to one profile, launch it, and check the timezone result on 2ip.io. Record the result with dates and versions in `docs/verification.md`. Use an isolated `LOCAL_PROFILES_DATA`.

- [ ] **Step 3: Update local documents with actual results**

Add decision 32 to `DECISIONS.md` (library copies, per-profile sets, explicit updates, no store support in version one). Mark the related TODO items only after verification.

- [ ] **Step 4: Final checks**

Run: `git status --short`; confirm local-only files are not staged and no Russian text was added outside translation catalogs (`npx vitest run tests/unit/repository-language.test.ts`).

## Handoff

Execution: inline in this session, one task at a time, with a fresh-context review of the whole branch after Task 7. Stop after each task's tests pass and report results before continuing.
