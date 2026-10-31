# Chrome Web Store Extension Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** let users add an extension by pasting a Chrome Web Store link; the package joins the existing library and behaves like folder/ZIP entries.

**Architecture:** a strict link parser yields the store ID; main downloads the CRX3 from Google's update service, validates the container, extracts the ZIP with existing safe-archive rules, validates the manifest and records the entry with source `store`. Updates for store entries re-download; duplicates by store ID are rejected.

**Tech Stack:** Electron 45, TypeScript, Zod, better-sqlite3, yauzl, React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-chrome-web-store-extensions-design.md`

## Global Constraints

- Accepted links: `https://chromewebstore.google.com/detail/<slug>/<id>` and `https://chrome.google.com/webstore/detail/<slug>/<id>`; query/fragment ignored; ID `[a-p]{32}`. Everything else fails with `EXTENSION_INVALID_LINK`.
- HTTPS only; download timeout 60 s; hard cap 100 MB; redirect to non-HTTPS fails.
- CRX3 only: `Cr24`, version 3, header length between 0 and 1 MB.
- Extraction reuses `extractArchive` limits; manifest must be MV3 at the archive root.
- Renderer sends only the pasted link; no URLs or paths come back.
- No automatic updates, no background requests.
- English-only tracked text; Russian strings only in `ru.ts`.
- TDD: failing test first for each behavior.

## Review Focus

- A lookalike host (`chromewebstore.google.com.evil.example`), credentials, HTTP link, wrong ID length or characters must be rejected before any request.
- A truncated CRX header, a ZIP without `manifest.json`, or a package over the cap must leave no row, no staging directory and no partial copy.
- Duplicate store IDs must be rejected, while the same extension from a local folder is still allowed.
- "Update…" on a store entry must re-download and keep the same library ID; on a local entry it must keep the folder picker.
- An offline or failing download must surface a localized error and keep the library unchanged.

## File Map

- Create `src/main/extensions/store.ts`: `parseStoreLink`, `storeDownloadUrl`, `readCrxZip`, `resolveExtensionName`.
- Modify `src/shared/extension.ts`: `ExtensionSource`, localized manifest helpers.
- Modify `src/main/extensions/library.ts`: `source`/`storeId` on entries, injected `download`, `addFromStore`, `updateFromStore`, duplicate rejection, backward-compatible reads.
- Modify `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/contracts.ts`: `addExtensionFromStore(url)` and store-aware `updateExtension`.
- Modify `src/shared/i18n/messages.ts`: `EXTENSION_INVALID_LINK`, `EXTENSION_ALREADY_IN_LIBRARY`, `EXTENSION_DOWNLOAD_FAILED`.
- Create `src/renderer/StoreLinkDialog.tsx`; modify `src/renderer/ExtensionLibrary.tsx`, `src/renderer/App.tsx`, `styles.css`, `en.ts`, `ru.ts`.
- Tests: `tests/unit/extension-store.test.ts`, extend `tests/unit/extension-library.test.ts`, `tests/unit/ui-extensions.test.tsx`, `tests/integration/extensions.test.ts`.

---

### Task 1: Link, CRX and name parsing

- [ ] Write failing tests in `tests/unit/extension-store.test.ts`: valid both hosts with slug/query; reject lookalike host, credentials, HTTP, uppercase/invalid ID, wrong length; `storeDownloadUrl` embeds the ID and HTTPS Google host; `readCrxZip` strips a synthetic header and rejects `PK` input, wrong magic, version 2 and absurd header length; `resolveExtensionName` resolves `__MSG_appName__` from `_locales/en/messages.json`, falls back when missing.
- [ ] Run `npx vitest run tests/unit/extension-store.test.ts`; expect FAIL (module missing).
- [ ] Implement `src/main/extensions/store.ts` and extend `src/shared/extension.ts` with `ExtensionSource = 'folder'|'zip'|'store'`.
- [ ] Rerun to PASS; commit `feat: parse Chrome Web Store links and CRX packages`.

### Task 2: Library integration

- [ ] Extend `tests/unit/extension-library.test.ts`: `addFromStore` records `source:'store'` and `storeId`, uses the injected download, rejects duplicates with `EXTENSION_ALREADY_IN_LIBRARY`, leaves no row/staging on download or package failure, and rejects a package over the cap; `updateFromStore` keeps the ID and re-downloads; entries written without `source` still list as `folder`.
- [ ] Run to FAIL.
- [ ] Implement in `src/main/extensions/library.ts`: optional injected `download(url, destination)`, `storeId` uniqueness check, staging cleanup, size cap enforced by the injected downloader contract plus package check.
- [ ] Rerun to PASS; commit `feat: add store extensions to the library`.

### Task 3: IPC and main downloader

- [ ] Extend `tests/unit/ipc.test.ts`: `addExtensionFromStore` requires exactly one string argument and rejects non-strings.
- [ ] Implement `addExtensionFromStore(url)` in schemas, main (using `net.fetch` with timeout and cap), preload and contracts; `updateExtension` re-downloads for store entries and opens the folder picker otherwise.
- [ ] Run tests to PASS; commit `feat: install store extensions over IPC`.

### Task 4: Renderer

- [ ] Extend `tests/unit/ui-extensions.test.tsx`: "Add from store…" opens a dialog, submitting passes the pasted text to `addExtensionFromStore`, an error result shows a translated message, cancel sends nothing; store entries show a store badge.
- [ ] Implement `StoreLinkDialog`, wire the button and badge, add EN/RU copy.
- [ ] Run to PASS and `npm run typecheck`; commit `feat: add extensions from the store in the UI`.

### Task 5: Integration and acceptance

- [ ] Extend `tests/integration/extensions.test.ts` with a synthetic CRX built from the fixture ZIP and a CRX3 header, installed through `addFromStore`, launched in real Chromium, version updated through `updateFromStore`.
- [ ] Run `npm run test:integration`.
- [ ] Manual acceptance with the real Eagle link while online; record it in `docs/verification.md`.
- [ ] Update `docs/architecture.md`, `DECISIONS.md`, `STATUS.md`, `TODO.md`; run `npm run verify` and `npm run test:integration` one final time; commit docs.

## Handoff

Inline execution with a report after each task. Stop and ask if the store endpoint changes behavior or if a package cannot be validated safely.
