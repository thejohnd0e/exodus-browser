# In-app Update Check and Installer Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the version label in the sidebar footer checks GitHub Releases for a newer Exodus installer, downloads and verifies it on request, and runs it only after an explicit click while no profile is active.

**Architecture:** All network, file, and process work lives in a new main-process module `src/main/update/`, reached through the existing allowlisted IPC dispatcher. The renderer owns only the footer state machine. Release builds take their version from `package.json`; development builds keep the local `0.1.N` counter.

**Tech Stack:** Electron 45 (`net`, `dialog`, `child_process`), TypeScript, React 19, Zod, Vitest, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-31-app-update-design.md`

## Global Constraints

- Release version: semantic `MAJOR.MINOR.PATCH` from `package.json`; first release `1.1.78`.
- Release tag: `v<semver>`; assets: `ExodusBrowser-Setup-<semver>.exe` and `SHA256SUMS`.
- Update check API: `https://api.github.com/repos/thejohnd0e/exodus-browser/releases/latest`; timeout 10 s; response limit 64 KiB.
- Download: HTTPS only; redirects allowed only to `github.com` and `*.githubusercontent.com`; limit 300 MB; idle timeout 60 s.
- No automatic checks; no timers; no startup request.
- No tokens or credentials in the client; no Russian text in tracked files outside `src/shared/i18n/ru.ts` and `src/renderer/i18n` Russian catalogs.
- Installation is blocked while any profile is `starting`, `running`, `stopping`, or `blocked`, or while any cookie/portable maintenance operation is active. Never close browsers forcibly.
- Renderer isolation unchanged: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP.
- Error messages never include URLs with query strings, file contents, or profile data.

## Review Focus

1. Malformed or hostile release JSON (missing assets, extra installers, tag like `v0.2`, non-string fields) must yield `UPDATE_INVALID_RELEASE`, not a crash or a download. Covered in Task 2.
2. Redirect to a non-GitHub host must be refused before any bytes are written. Covered in Task 3.
3. A checksum mismatch or truncated download must leave no installable file behind. Covered in Task 3.
4. Starting the installer while a profile browser runs must be refused, and the refusal must not close any browser. Covered in Task 4.
5. Clicking "Download" twice or cancelling mid-download must not leave two writers or a `.partial` file. Covered in Task 4.

## File Structure

- Create `src/main/update/version.ts` — parse and compare `MAJOR.MINOR.PATCH`.
- Create `src/main/update/release.ts` — validate GitHub release JSON and `SHA256SUMS`.
- Create `src/main/update/download.ts` — streamed, bounded, verified download into staging.
- Create `src/main/update/service.ts` — `UpdateService` state machine: check, download, cancel, install.
- Create `src/shared/update.ts` — shared DTOs and the update Zod schema.
- Modify `src/shared/contracts.ts` — add update methods to `ProfileApi`.
- Modify `src/shared/build-info.ts` — unchanged type; value comes from build.
- Modify `scripts/build.mjs` — release builds use `package.json` version.
- Modify `src/main/ipc.ts` — register `checkForUpdate`, `downloadUpdate`, `cancelUpdate`, `installUpdate`.
- Modify `src/main/index.ts` — construct `UpdateService`, wire dispatcher, `app.quit` path.
- Modify `src/preload/index.ts` — expose the four methods and `onUpdateProgress`.
- Modify `src/renderer/SidebarFooter.tsx` — version label becomes `UpdateButton`.
- Create `src/renderer/UpdateButton.tsx` — state UI.
- Modify `src/shared/i18n/en.ts`, `src/shared/i18n/ru.ts`, `src/shared/i18n/messages.ts` — new keys and error codes.
- Modify docs: `DECISIONS.md`, `STATUS.md`, `TODO.md`, `docs/architecture.md`, `docs/development.md`, `docs/verification.md`, `README.md`.
- Tests: `tests/unit/update-version.test.ts`, `tests/unit/update-release.test.ts`, `tests/unit/update-download.test.ts`, `tests/unit/update-service.test.ts`, `tests/unit/ui-update.test.tsx`, `tests/integration/update.test.ts`, extend `tests/unit/ipc.test.ts`, `tests/unit/build-version.test.ts`, `tests/integration/app-smoke.test.ts`.

---

### Task 1: Release version source

**Files:**
- Modify: `scripts/build.mjs`
- Test: `tests/unit/build-version.test.ts`

**Interfaces:**
- Consumes: existing `withBuildVersion({root,run})`.
- Produces: `resolveBuildInfo({counterInfo, packageVersion, release}):BuildInfo` exported from `scripts/build-version.mjs`. When `release` is true it returns `{version: packageVersion, buildNumber: counterInfo.buildNumber}`; otherwise it returns `counterInfo`. `release` comes from `process.env.EXODUS_RELEASE==='1'`, which `npm run dist` sets.

- [ ] **Step 1: Write the failing test** — in `tests/unit/build-version.test.ts`, assert `resolveBuildInfo` returns the package version when `release` is true, keeps `0.1.N` when false, and throws `BUILD_VERSION_INVALID` for a non-semver `packageVersion` in release mode.
- [ ] **Step 2: Run** `npx vitest run tests/unit/build-version.test.ts` — expected FAIL (`resolveBuildInfo` not exported).
- [ ] **Step 3: Implement** `resolveBuildInfo` in `scripts/build-version.mjs` and use it in `scripts/build.mjs`. Change `dist` in `package.json` to `EXODUS_RELEASE=1 npm run build && electron-builder --win nsis` (use `cross-env`-free form appropriate for PowerShell: set env in the script via `scripts/dist.mjs` if the one-liner is not portable).
- [ ] **Step 4: Run** the test — expected PASS. Then `npm run build` and confirm `dist/main.cjs` contains the expected version when `EXODUS_RELEASE=1`.
- [ ] **Step 5: Commit** `build: use the package version for release builds`.

### Task 2: Version and release parsing

**Files:**
- Create: `src/main/update/version.ts`, `src/main/update/release.ts`
- Test: `tests/unit/update-version.test.ts`, `tests/unit/update-release.test.ts`

**Interfaces:**
- Produces:
  - `parseVersion(text:string):{major:number;minor:number;patch:number}|null` — strict `^\d+\.\d+\.\d+$`, no leading `v`, numeric parts ≤ 999999.
  - `isNewer(candidate:string, current:string):boolean`.
  - `parseLatestRelease(json:unknown, appVersion:string):{kind:'up-to-date'}|{kind:'available';version:string;installer:{name:string;url:string;size:number};checksumsUrl:string}` — throws `UPDATE_INVALID_RELEASE`.
  - `parseSha256Sums(text:string, fileName:string):string` — returns the lowercase 64-hex digest for `fileName` or throws `UPDATE_INVALID_RELEASE`.

- [ ] **Step 1: Write failing tests**: `1.10.0` newer than `1.9.9`; `1.1.78` not newer than `1.1.78`; `v1.1.78`, `1.1`, `1.1.78-beta` rejected; release with tag `v1.1.78` and exactly one matching `.exe` plus `SHA256SUMS` returns `available`; missing `SHA256SUMS`, two installers, `draft: true`, a `browser_download_url` on a non-GitHub host, and a non-numeric `size` each throw `UPDATE_INVALID_RELEASE`; `SHA256SUMS` line `<64hex>  ExodusBrowser-Setup-1.1.78.exe` yields the digest; a missing or uppercase-invalid line throws.
- [ ] **Step 2: Run** `npx vitest run tests/unit/update-version.test.ts tests/unit/update-release.test.ts` — expected FAIL (modules missing).
- [ ] **Step 3: Implement** the two modules with Zod for the release JSON (`tag_name`, `draft`, `prerelease`, `assets[]` with `name`, `browser_download_url`, `size`). Reject `draft` or `prerelease` releases. Installer name must equal `ExodusBrowser-Setup-<version>.exe`.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `feat: parse update versions and GitHub release metadata`.

### Task 3: Bounded verified download

**Files:**
- Create: `src/main/update/download.ts`
- Test: `tests/unit/update-download.test.ts`

**Interfaces:**
- Consumes: `parseSha256Sums` from Task 2.
- Produces:
  - `downloadInstaller({url, expectedSize, expectedSha256, destinationDir, fileName, fetch, signal, onProgress}):Promise<string>` returns the verified path `<destinationDir>/<fileName>`.
  - `fetch` is injected: `(url:string, init:{signal:AbortSignal;redirect:'manual'})=>Promise<Response>` so tests use a fake. The function follows at most 5 redirects itself, each target must pass `isAllowedHost` (`github.com` or a host ending in `.githubusercontent.com`, protocol `https:`).
  - Writes `<fileName>.partial` in `destinationDir`, renames on success, deletes the partial on any failure or abort.
  - Errors: `UPDATE_DOWNLOAD_FAILED`, `UPDATE_CHECKSUM_MISMATCH`, `UPDATE_TOO_LARGE`, `UPDATE_CANCELLED`, `UPDATE_UNTRUSTED_REDIRECT`.
  - `isAllowedHost(url:string):boolean` exported.

- [ ] **Step 1: Write failing tests** with a fake fetch: success writes the final file and its SHA-256 matches; redirect to `evil.example` throws `UPDATE_UNTRUSTED_REDIRECT` and no file exists; body longer than `expectedSize` or over 300 MB aborts with `UPDATE_TOO_LARGE` and leaves no `.partial`; wrong digest throws `UPDATE_CHECKSUM_MISMATCH` and leaves neither `.partial` nor final file; aborting the signal mid-stream throws `UPDATE_CANCELLED` and cleans up; `http://github.com/...` is refused.
- [ ] **Step 2: Run** `npx vitest run tests/unit/update-download.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** streaming with `node:crypto` `createHash('sha256')` while writing, counting bytes, and checking the 300 MB cap and `expectedSize` equality. Use `flags:'wx'` to refuse overwriting an existing partial.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `feat: download update installers with bounded checksum verification`.

### Task 4: Update service state machine

**Files:**
- Create: `src/shared/update.ts`, `src/main/update/service.ts`
- Test: `tests/unit/update-service.test.ts`

**Interfaces:**
- Consumes: `parseLatestRelease`, `parseSha256Sums`, `downloadInstaller`, `isNewer`.
- Produces in `src/shared/update.ts`:
  - `type UpdateState = {state:'idle'}|{state:'checking'}|{state:'up-to-date'}|{state:'available';version:string;size:number}|{state:'downloading';version:string;received:number;total:number}|{state:'ready';version:string}|{state:'error';code:string}`
  - `updateStateSchema` (Zod) mirroring the type.
- Produces in `src/main/update/service.ts`:
  - `class UpdateService` constructor `({appVersion, root, fetchJson, fetchFile, busy:()=>Promise<boolean>, runInstaller:(path:string)=>Promise<void>, onState:(state:UpdateState)=>void})`.
  - `check():Promise<UpdateState>`, `download():Promise<UpdateState>`, `cancel():Promise<void>`, `install():Promise<void>`, `state():UpdateState`.
  - `install()` throws `UPDATE_BUSY_PROFILES` when `busy()` is true; throws `UPDATE_NOT_READY` unless state is `ready`; it calls `runInstaller(path)` and does not quit; the caller quits.
  - Only one `download` at a time; a second call while downloading throws `UPDATE_BUSY`.
  - `check()` while `checking` or `downloading` throws `UPDATE_BUSY`.

- [ ] **Step 1: Write failing tests** for the transitions: idle→checking→available; idle→checking→up-to-date; available→downloading→ready; cancel during downloading returns to available and removes partial; install with busy profiles throws `UPDATE_BUSY_PROFILES` and never calls `runInstaller`; install in `available` throws `UPDATE_NOT_READY`; double `download` throws `UPDATE_BUSY`; network error sets `error` with `UPDATE_CHECK_FAILED`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/update-service.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the service. The directory is `<root>/updates/<version>/`; delete other `updates/*` entries after a new version is verified.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `feat: add update state machine with installation gate`.

### Task 5: Busy check from existing services

**Files:**
- Modify: `src/main/runtime/supervisor.ts`, `src/main/cookies/service.ts` (path: `src/main/cookies/service.ts`), `src/main/portable/service.ts`
- Test: `tests/unit/supervisor.test.ts`, `tests/unit/cookies-service.test.ts`, `tests/unit/portable-service.test.ts`

**Interfaces:**
- Produces: `Supervisor.hasActiveWork():boolean` — true if any profile state is `starting|running|stopping|blocked` or any lock is held. `CookieService.hasActiveWork():boolean` and `PortableProfileService.hasActiveWork():boolean` — true when their `active` set is non-empty or handles exist.

- [ ] **Step 1: Write failing tests** asserting each `hasActiveWork()` is false when idle and true while an operation is pending (use the existing fakes in each test file).
- [ ] **Step 2: Run** the three test files — expected FAIL.
- [ ] **Step 3: Implement** the three methods as one-line checks over existing state.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat: report active profile work for the update gate`.

### Task 6: IPC, preload, and contract

**Files:**
- Modify: `src/shared/contracts.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/ipc.test.ts`, `tests/integration/app-smoke.test.ts`

**Interfaces:**
- Consumes: `UpdateService` from Task 4.
- Produces in `ProfileApi`: `getUpdateState():Promise<Result<UpdateState>>`, `checkForUpdate():Promise<Result<UpdateState>>`, `downloadUpdate():Promise<Result<UpdateState>>`, `cancelUpdate():Promise<Result<void>>`, `installUpdate():Promise<Result<void>>`, `onUpdateState(callback:(state:UpdateState)=>void):()=>void`.
- IPC names: `profiles:getUpdateState`, `profiles:checkForUpdate`, `profiles:downloadUpdate`, `profiles:cancelUpdate`, `profiles:installUpdate` (zero-argument tuples). State pushes use channel `app:update-state`, sent only to the trusted window.
- `installUpdate` handler: calls `service.install()`, then `app.quit()` through the existing `finishShutdown`-style path only after `runInstaller` has spawned the installer. `finishShutdown` already waits for cookie/portable operations, so reuse it.

- [ ] **Step 1: Write failing tests**: `tests/unit/ipc.test.ts` asserts the five new operation names are accepted with empty tuples and rejected with extra arguments; `app-smoke.test.ts` asserts the preload surface key list includes the new methods (the existing exact-list test must be updated deliberately).
- [ ] **Step 2: Run** `npx vitest run tests/unit/ipc.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the schemas, the contract, the preload methods (mirroring `onCloseRequested`), and the `index.ts` wiring: `fetchJson` uses `net.fetch` with the 10 s timeout and 64 KiB cap, `fetchFile` calls `downloadInstaller` with `net.fetch`, `runInstaller` uses `child_process.spawn(path, [], {detached:true, stdio:'ignore'}).unref()`, `busy` uses `supervisor.hasActiveWork()||cookies.hasActiveWork()||portable.hasActiveWork()`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/ipc.test.ts` and `npx tsc --noEmit` — expected PASS.
- [ ] **Step 5: Commit** `feat: expose update operations through the trusted IPC contract`.

### Task 7: Localized messages

**Files:**
- Modify: `src/shared/i18n/messages.ts`, `src/shared/i18n/en.ts`, `src/shared/i18n/ru.ts`, `src/renderer/i18n/en.ts` if the renderer catalog is separate
- Test: `tests/unit/messages.test.ts`, `tests/unit/i18n.test.tsx`

**Interfaces:**
- Error codes to add: `UPDATE_CHECK_FAILED`, `UPDATE_INVALID_RELEASE`, `UPDATE_DOWNLOAD_FAILED`, `UPDATE_CHECKSUM_MISMATCH`, `UPDATE_TOO_LARGE`, `UPDATE_CANCELLED`, `UPDATE_UNTRUSTED_REDIRECT`, `UPDATE_BUSY`, `UPDATE_BUSY_PROFILES`, `UPDATE_NOT_READY`.
- UI keys: `Check for updates`, `Checking for updates…`, `You have the latest version.`, `Version {{version}} is available ({{size}}).`, `Download update`, `Downloading {{percent}}%`, `Cancel download`, `Install and restart`, `Stop all browsers before installing the update.`, `Update check failed. Try again later.`

- [ ] **Step 1: Write failing tests**: every new error code has EN and RU text; every new UI key has EN and RU text; no RU text contains Latin-only placeholders missing braces.
- [ ] **Step 2: Run** the two test files — expected FAIL.
- [ ] **Step 3: Add** the strings. Russian strings go only in `ru.ts` catalogs.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat: add localized update messages`.

### Task 8: Footer update control

**Files:**
- Create: `src/renderer/UpdateButton.tsx`
- Modify: `src/renderer/SidebarFooter.tsx` (replace `<span className="build-version">` with `<UpdateButton/>`), `src/renderer/styles.css`
- Test: `tests/unit/ui-update.test.tsx`

**Interfaces:**
- Consumes: `window.profileApi` methods from Task 6, `useI18n()`.
- Produces: `UpdateButton({disabled?:boolean})`. Initial render calls only `getUpdateState()` (no network). Clicking the version label calls `checkForUpdate()`. Button label shows `v{BUILD_INFO.version}` in idle. Keep the `.build-version` class on the label.

- [ ] **Step 1: Write failing tests** with a mocked `profileApi`: rendering performs no `checkForUpdate` call; clicking calls it once; `available` shows "Download update"; progress text updates from pushed state; "Install and restart" is shown only in `ready`; installing is disabled and shows the busy message when `UPDATE_BUSY_PROFILES` is returned; the control has an accessible name containing the version.
- [ ] **Step 2: Run** `npx vitest run tests/unit/ui-update.test.tsx` — expected FAIL.
- [ ] **Step 3: Implement** the component with the state machine rendered as buttons and text; subscribe with `onUpdateState` in `useEffect` and unsubscribe on unmount.
- [ ] **Step 4: Run** the test plus `npx vitest run tests/unit/ui.test.tsx` — expected PASS.
- [ ] **Step 5: Commit** `feat: add update controls to the sidebar version label`.

### Task 9: Integration test with a loopback GitHub stand-in

**Files:**
- Create: `tests/integration/update.test.ts`
- Modify: `src/main/update/service.ts` only if needed to accept an injected base URL for tests (`apiBase` and `allowedHosts` options with production defaults).

**Interfaces:**
- Consumes: `UpdateService`, `downloadInstaller`.

- [ ] **Step 1: Write failing tests** against a loopback HTTP server standing in for the API and asset host: up-to-date, available with correct digest, digest mismatch leaves no installable file, oversize body rejected, cancel mid-stream cleans up. Use the `allowedHosts` test option to allow `127.0.0.1`; production defaults must still refuse it (asserted in Task 3 tests).
- [ ] **Step 2: Run** `npm run test:integration -- update` — expected FAIL.
- [ ] **Step 3: Implement** the minimal option plumbing.
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `test: cover update check and download against a loopback stand-in`.

### Task 10: Documentation

**Files:**
- Modify: `DECISIONS.md`, `STATUS.md`, `TODO.md`, `docs/architecture.md`, `docs/development.md`, `docs/verification.md`, `README.md`

- [ ] **Step 1:** Add `DECISIONS.md` entry #34: manual-trigger update check and verified installer download; reverses "no auto-update" only for this scoped flow; unsigned; trust rests on GitHub account and TLS plus SHA-256 from the same release.
- [ ] **Step 2:** Update `docs/development.md` with the release procedure (`npm run dist` with `EXODUS_RELEASE=1`, `SHA256SUMS`, `gh release create`, English notes only).
- [ ] **Step 3:** Update `docs/architecture.md`, `README.md`, `STATUS.md`, `TODO.md`. Do not mark manual items complete.
- [ ] **Step 4:** Run `npm run verify` — expected PASS.
- [ ] **Step 5: Commit** `docs: record the update flow and release procedure`.

### Task 11: Release 1.1.78

**Gate:** Requires the user's explicit confirmation to make `thejohnd0e/exodus-browser` public. Do not change visibility before that.

- [ ] **Step 1:** Run `npm run verify` and `npm run test:integration`; both must PASS on the release commit.
- [ ] **Step 2:** Set `package.json` version to `1.1.78`; commit `chore: release 1.1.78`.
- [ ] **Step 3:** Run `npm run dist` with `EXODUS_RELEASE=1`. Confirm the file `dist-install/ExodusBrowser-Setup-1.1.78.exe` exists and `latest.yml` version is `1.1.78`.
- [ ] **Step 4:** Create `dist-install/SHA256SUMS` with `Get-FileHash -Algorithm SHA256` output in `<hash>  <name>` form.
- [ ] **Step 5:** After confirmation, change visibility with `gh repo edit thejohnd0e/exodus-browser --visibility public --accept-visibility-change-consequences`, then `git tag v1.1.78`, `git push origin master v1.1.78`, and `gh release create v1.1.78 dist-install/ExodusBrowser-Setup-1.1.78.exe dist-install/SHA256SUMS --title "Exodus Browser 1.1.78" --notes-file <english-notes-file>`.
- [ ] **Step 6:** Verify from a clean state: `gh release view v1.1.78` lists both assets; the update flow in a disposable Windows account finds `1.1.78` from an older build. Record in `docs/verification.md`.

Do not push the untracked root-level `wordmark-*.png` files or `.playwright-mcp/`; they are not part of this release.
