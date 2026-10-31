# Profile Portability and Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; request one independent whole-branch review after implementation, consistent with DECISIONS.md #12. Do not begin implementation merely because this plan exists.

**Goal:** Add portable profile transfer, optional tab URL restoration, cookie clearing, EN/RU localization, proxy-country flags, and monotonically increasing visible build versions.

**Architecture:** Extend the existing main-process services and validated IPC boundary, retaining separate backup and portable-transfer formats. Introduce focused session-snapshot, application-settings, country-lookup, and build-metadata modules. Deliver each subsystem as an independently testable increment, with portability last because it consumes the new profile fields.

**Tech Stack:** Electron 45, TypeScript, React 19, SQLite, Zod, CDP, yazl/yauzl, Vitest, Playwright, esbuild, Vite; one pinned MMDB reader and licensed local country/flag data.

**Spec:** `docs/superpowers/specs/2026-10-31-profile-portability-and-usability-design.md`

## Global Constraints

- Windows, Electron 45, TypeScript, React 19, SQLite, and the existing CDP engine adapter remain in use.
- Preserve legacy storage locations, existing data, renderer isolation, engine checksum verification, proxy fail-closed behavior, and lifecycle ownership checks.
- Documentation, comments, tests, and GitHub metadata remain English. Product translation catalogs are user-facing data and may contain Russian; this does not change the publication language of project materials.
- Test-first implementation; run `npm run verify` and `npm run test:integration` after each increment. Use isolated storage only; real data requires separate approval and backup.
- Keep existing ZIP backups readable and preserve their documented limitations. Do not replace backups with a less complete format.
- No GitHub publication, remote history rewriting, dependency installation, data download, or application implementation is part of preparing this plan.

## Review Focus

1. Interrupted/concurrent builds must not reuse a reserved number or publish mixed-version artifacts: Task 1.
2. Maintenance Chromium sessions must not replace a user's saved tab snapshot: Task 2.
3. Partitioned cookies must be cleared and transferred correctly or explicitly rejected, never silently omitted: Tasks 3 and 7.
4. Delayed proxy checks must not attach a stale country to an edited connection: Task 6.
5. Failed import after directory rename or database write must leave no visible partial profile, proxy, or snapshot: Task 8.

## Delivery map

| Increment | Owned files / responsibility |
|---|---|
| Build identity | `scripts/build-version.mjs`, `scripts/build.mjs`, `src/shared/build-info.ts`, branding in `src/renderer/App.tsx`, native title in `src/main/index.ts` |
| Tab restoration | `src/shared/session.ts`, `src/main/sessions/store.ts`, `src/main/sessions/tracker.ts`, profile model/storage, Chromium/CDP navigation |
| Cookie clearing | Existing `src/main/cookies/{session,service}.ts`, contract/IPC/preload, profile actions |
| App language | `src/shared/settings.ts`, `src/main/settings/service.ts`, `src/renderer/i18n/*`, `src/renderer/AppSettings.tsx`, main dialog text |
| Country | `src/main/proxy/country.ts`, `src/renderer/CountryFlag.tsx`, `resources/geoip/*`, `src/renderer/assets/flags/*`, proxy result DTOs |
| Portability | `src/shared/portable.ts`, `src/main/portable/{archive,cookies,service,operations}.ts`, existing safe archive extraction, UI actions |

Shared edits: `src/shared/{contracts,validation}.ts`, `src/main/{index,ipc}.ts`, `src/preload/index.ts`. Preserve their existing allowlists and update their tests for every new method. Existing `BackupService` remains a separate public feature.

## Execution checklist

- [ ] Review the spec and its proposed defaults with the user before application implementation.
- [x] Clarify language policy: Russian UI translation strings are product data; project documentation, comments, tests, and GitHub metadata remain English.
- [x] Complete Tasks 1–3; Task 4 remains.
- [ ] Complete Tasks 4–6 as individual increments, subject to their gates.
- [ ] Complete Tasks 7–8 for portable transfer.
- [ ] Complete Task 9 acceptance, documentation, and independent review.

### Task 1: One build identity and visible version

**Files:** Create `scripts/build-version.mjs`, `scripts/recover-build-version.mjs`, `build-version-floor.json`, `src/shared/build-info.ts`, `tests/unit/build-version.test.ts`. Modify `scripts/build.mjs`, `.gitignore`, `docs/development.md`, `src/main/index.ts`, `src/main/window.ts`, `src/renderer/App.tsx`, `src/renderer/styles.css`, and `tests/integration/app-smoke.test.ts`.

**Interfaces:** `withBuildVersion({root,run}):Promise<BuildInfo>` where `run(info:BuildInfo):Promise<void>` executes the full build while holding an exclusive lock; `BuildInfo={version:string;buildNumber:number}`. Build-time `__BUILD_INFO__` is defined identically in esbuild and Vite, with an explicit TypeScript declaration. `recoverBuildVersion({root,buildNumber,confirm}):Promise<void>` reseeds only after an explicit interactive confirmation and while the build lock is available. No IPC is needed because both processes receive the same immutable build-time value.

- [x] Test consecutive builds `0.1.1` / `0.1.2`, deleting `dist/`, consumed failed reservations, corrupt/missing state, concurrent build rejection, explicit reseed confirmation, and Electron agreement between visible and native-window versions. Use temporary roots for counter tests.
- [x] Run `npx vitest run tests/unit/build-version.test.ts`; missing allocator and recovery behavior failed before implementation.
- [x] Implement an exclusive whole-build lock and atomic persistent counter outside `dist/`; distinguish fresh initialization from lost state using an ignored root marker; require explicit reseeding on ambiguity. Initialize floor at 0. Do not automatically remove a lock based on PID alone. Recovery instructions require confirming no build is active before removing a stale lock and running the reseed command.
- [x] Inject immutable metadata into both build pipelines. Show the value beside the wordmark and in the native title; use actual generated metadata, not `app.getVersion()`.
- [x] Run targeted tests; Electron asserts that title and visible branding agree and fit at normal/narrow widths. `npm run verify` PASS (153 unit tests, typecheck, production build); `npm run test:integration` PASS (38/38).
- [x] Commit this increment: `feat: add monotonic build identity and visible version` (follow-up recovery UX is committed separately).

### Task 2: Profile preference and application-managed tab restoration

**Files:** Create `src/shared/session.ts`, `src/main/sessions/store.ts`, `src/main/sessions/tracker.ts`, `tests/unit/sessions.test.ts`, `tests/integration/sessions.test.ts`. Modify `src/shared/{contracts,validation}.ts`, `src/main/profiles/{repository,service}.ts`, `src/main/engines/{types,chromium}.ts`, `src/main/cdp/fingerprint.ts`, `src/main/runtime/supervisor.ts`, `src/main/index.ts`, `src/renderer/ProfileEditor.tsx`, `src/main/backups/service.ts`.

**Interfaces:** `SessionSnapshot={version:1;urls:string[];updatedAt:string}`; `SessionStore.read(id):Promise<SessionSnapshot|null>`, `write(id,snapshot):Promise<void>`, `remove(id):Promise<void>`; `SessionTracker.flush():Promise<void>`, `dispose():void`. Add optional input `restoreLastSession?:boolean`, normalize public/stored/launch profiles to required boolean. Add optional input `fingerprintSeed?:number`, normalize stored/launch profiles to uint32; historical records use `seedFor(id)`, new records use cryptographic random uint32. Never let omission on edit regenerate the seed.

- [x] Add failing tests: old records default false and retain the deterministic historical seed; editing preserves seed; explicit invalid seeds are rejected; snapshots reject 101 tabs, credentials, unsafe schemes, oversized files, and URLs longer than 8192 characters; missing/corrupt snapshots yield fallback; deletion removes the snapshot.
- [x] Run targeted unit tests first and observe expected failures for missing session schema/store/tracker and profile fields.
- [x] Persist new fields through repository/service normalization without rewriting existing records on read. No SQLite schema bump for optional JSON fields. Add atomic snapshot storage with path/link checks, a 1 MiB file-read limit, and strict schema. Stored snapshot errors trigger safe fallback without exposing URLs.
- [x] Track page targets only in normal managed launches, persist ordered eligible URLs after a 1-second debounce, flush before intentional closure, and dispose listeners/timers on exit. Cookie-maintenance sessions never instantiate this tracker. Initial startup uses saved tabs only when enabled and nonempty; navigation still goes through `FingerprintSession.navigate(urls)` after initialization.
- [x] Add editor checkbox and upgrade newly written backups to manifest v4 containing restore preference, seed, and snapshot; keep frozen v1–v3 schemas independent of evolving `profileSchema`. Old formats default false and derive a new profile's historical seed. Add v4 roundtrip and v1–v3 fixtures.
- [x] Add real-browser tests for ordered tabs, restore on/off, empty snapshot fallback, graceful stop and unexpected exit, and cookie-maintenance non-overwrite; unit tests reject internal/credential URLs. Existing integration test asserts fingerprint configuration is applied before initial navigation. `npm run verify` PASS (165 unit tests, typecheck, production build); `npm run test:integration` PASS (42/42).
- [x] Commit: `feat: restore saved profile tabs on request`.

### Task 3: Clear all cookies without clearing other storage

**Files:** Modify `src/main/cookies/{session,service}.ts`, `src/shared/contracts.ts`, `src/main/{ipc,index}.ts`, `src/preload/index.ts`, `src/renderer/{ProfileList,App}.tsx`, existing cookie unit/integration tests.

**Interfaces:** `CookieService.clear(id:string):Promise<void>`; `ProfileApi.clearCookies(id:string):Promise<Result<{cleared:true}|null>>`, where null is confirmation cancellation. Extend the cookie session with browser-level `clearCookies():Promise<void>` and raw-count readback that does not normalize away partitioned cookies.

- [x] Write failing service/IPC/UI tests for confirm/cancel, running/blocked/orphan rejection, unavailable engine, CDP clear failure, nonzero readback, close failure, and no cookie values in errors or UI. Cancellation never acquires a maintenance session.
- [x] Run cookie unit tests and observe expected missing-method failures.
- [x] Implement main-process confirmation and `Storage.clearCookies` within the existing isolated session/exclusive lock. Verify zero raw cookies including partitioned entries, close normally, and return success only after lifecycle cleanup succeeds.
- [x] Add the stopped-profile action with sign-out warning and busy state. Update IPC argument validation and preload allowlist tests.
- [x] Real Chromium verifies persistent/session/httpOnly/partitioned cookies disappear, localStorage/IndexedDB survive, another profile is unaffected, and the maintenance browser emits no network requests.
- [x] `npm run verify` PASS (170 unit tests, typecheck, production build); `npm run test:integration` PASS (43/43). Commit: `feat: clear all cookies from stopped profiles`.

### Task 4: Persist application settings and establish typed localization

**Gate:** None. Russian UI strings are product translation data, not Russian project documentation or GitHub metadata. Keep source identifiers, comments, and test descriptions in English.

**Files:** Create `src/shared/settings.ts`, `src/main/settings/service.ts`, `src/renderer/i18n/{en,types,provider}.tsx` (use `.ts` for non-JSX modules), `src/renderer/AppSettings.tsx`, `tests/unit/settings.test.ts`, `tests/unit/i18n.test.tsx`. Modify shared contracts, IPC, preload, main assembly, and `src/renderer/App.tsx`.

**Interfaces:** `AppLanguage='en'|'ru'`; `AppSettings={language:AppLanguage}`; `getSettings():Promise<Result<AppSettings>>`, `updateSettings(input:AppSettings):Promise<Result<AppSettings>>`; `translate(language,key,params?):string`. English keys define the catalog type; other catalogs satisfy that type. Default to `en`; strict validated application-owned settings file, atomic writes, safe fallback on malformed files.

- [ ] Write failing tests for English default, persistence across restart, invalid/extra settings rejection, English fallback for missing translation, parameter substitution, and a language switch preserving unsaved editor input and profile website locale.
- [ ] Run `npx vitest run tests/unit/settings.test.ts tests/unit/i18n.test.tsx`; confirm missing behavior fails.
- [ ] Implement settings service, trusted IPC methods, typed provider, and persistent EN/RU selector. Use a single English catalog as fallback; no automatic OS-language switch or remote catalogs.
- [ ] Run targeted tests and both full verification commands; expect PASS. Commit: `feat: add persistent application language settings`.

### Task 5: Translate renderer and native dialogs

**Files:** Add `src/renderer/i18n/ru.ts` only after the policy gate. Modify all renderer components containing user-facing text, `src/main/index.ts`, `src/main/cookies/operations.ts`, `src/main/ipc.ts`; create `src/shared/i18n/{en,ru,messages}.ts` for main-safe common messages and error-code mappings. Keep one canonical catalog per namespace, not duplicate renderer/main translations.

**Interfaces:** `messageForError(code:string,language:AppLanguage):string` with a fixed generic fallback. Main dialogs consume persisted `AppSettings.language`; renderer stores message descriptors/codes and parameters, not permanently formatted strings that become stale on switching languages.

- [ ] Add failing tests for identical key coverage, plural/count formatting, all allowlisted errors, unknown-code fallback, localized native confirm/open/save dialogs, accessible labels, and switching language while an operation result is visible. Test names and descriptions remain English.
- [ ] Run the i18n/UI tests and confirm untranslated UI/dialog behavior fails.
- [ ] Extract all UI text, statuses, warnings, empty states, tooltips, aria labels, and result templates into typed catalogs; use `Intl` for locale-dependent formatting. Preserve user-entered names, BCP47 profile language codes, branding, and technical paths. Never display raw exceptions.
- [ ] Add Electron coverage for language persistence, native-dialog arguments, editor input preservation, and no external locale requests. Manually inspect both languages at normal/narrow widths.
- [ ] Run both full verification commands; expect PASS. Commit: `feat: localize the interface and dialogs in English and Russian`.

### Task 6: Offline country lookup and accessible flags

**Files:** Create `src/main/proxy/country.ts`, `src/renderer/CountryFlag.tsx`, `tests/unit/country.test.ts`, `resources/geoip/README.md`, local licensed country/flag resources and attribution inventory. Modify `scripts/build.mjs`, `package.json`, lockfile, `src/main/index.ts`, `src/shared/contracts.ts`, `src/renderer/{App,ProfileList,ProxyLibrary}.tsx`.

**Interfaces:** `lookupCountry(ip:string):Promise<string|null>` returns uppercase ISO 3166-1 alpha-2 only; extend both proxy-check DTOs with `countryCode:string|null`. `CountryFlag({countryCode,language})` uses a locally bundled SVG and `Intl.DisplayNames` for accessible country text, never remote image paths or unvalidated filenames.

- [ ] Write failing tests for known IPv4/IPv6 results using a tiny licensed fixture/injected reader, private/reserved IPs, malformed/missing MMDB, unknown country, invalid country code, and a delayed result following proxy-password-only edit. Unknown country must preserve IP success; IP and country share one result version.
- [ ] Run `npx vitest run tests/unit/country.test.ts` and existing proxy UI tests; confirm expected failures.
- [ ] Verify DB-IP Country Lite distribution license, provenance, date, SHA-256, and attribution; select and pin a compatible bounded MMDB reader and licensed local SVG set. Do not fetch data in ordinary builds or startup. Document an explicit maintainer refresh procedure. If distribution rights/provenance cannot be established, stop this increment rather than shipping an unverified asset.
- [ ] Bundle the dataset as a runtime resource with module-relative path resolution. Perform lookup only on validated checked IPs in main; catch dataset/lookup errors as null. Keep the existing HTTP warning unchanged. Clear/invalidate country and IP together on repeat checks or edits.
- [ ] Render flags in profile and proxy-library results with accessible localized labels. Test real Electron built-resource loading without source-directory access, narrow width, and zero additional network requests.
- [ ] Run both full verification commands; expect PASS. Commit: `feat: show offline country flags beside checked proxy IPs`.

### Task 7: Portable archive schema and lossless cookie adapter

**Files:** Create `src/shared/portable.ts`, `src/main/portable/{archive,cookies}.ts`, `tests/unit/portable-format.test.ts`, `tests/integration/portable-cookies.test.ts`. Modify `src/main/cookies/session.ts` only to expose a reusable isolated raw-CDP maintenance boundary; do not change current JSON/Netscape format semantics.

**Interfaces:** `PortableManifest={format:'exodus-portable';version:1;profile:PortableProfile;session:SessionSnapshot|null}`. `PortableProfile` contains name/note/startUrls/languages/fingerprint/uint32 fingerprintSeed/restoreLastSession and password-free proxy snapshot, with no UUID or original filesystem path. `PortableCookie` models lossless validated CDP cookie-setting fields, including host-only/domain semantics, session expiry, and supported partition keys. `readPortableCookies(client):Promise<PortableCookie[]>`, `writePortableCookies(client,cookies):Promise<void>`. Strict archive layout: `manifest.json`, `cookies.json`, `data/`.

- [ ] Add failing schema/extraction tests for wrong format/version, extra fields, passwords, malicious paths, links, case-insensitive duplicates, 1 MiB manifest, 5 MiB cookie sidecar, more than 20,000 cookies, more than 100,000 entries, and expanded data above 20 GiB. Use injected small limits for large-byte tests.
- [ ] Run `npx vitest run tests/unit/portable-format.test.ts`; confirm missing-format behavior fails.
- [ ] Implement strict versioned schemas and reuse the existing streaming extractor protections. Define an explicit tested exclusion predicate for native cookie files/journals, `Local State`, lock/debugging files, and native session files; validate Windows path/case behavior. Do not broaden the existing cookie import parser or blindly serialize arbitrary CDP objects.
- [ ] Add real Chromium cookie roundtrips for session, persistent, httpOnly, secure/SameSite, host-only/domain cookies, and partitioned cookies. Assert unsupported opaque partition information rejects the export, not silently drops the cookie. Readback compares semantic fields, with Chromium-supported expiry normalization, not just name/path/domain.
- [ ] Confirm existing cookie JSON/Netscape tests still pass. Run both full verification commands; expect PASS. Commit: `feat: define portable profile archives and cookie transfer`.

### Task 8: Transactional export/import service and UI

**Files:** Create `src/main/portable/{service,operations}.ts`, `tests/unit/portable-service.test.ts`, `tests/integration/portable-profiles.test.ts`. Modify `src/main/profiles/service.ts`, session store, main assembly/IPC, contracts, preload, `src/renderer/{App,ProfileList}.tsx`, and translation catalogs.

**Interfaces:** `PortableProfileService.exportFile(id:string,destination:string):Promise<void>`; `importFile(source:string):Promise<Profile>`; `closeAll():Promise<void>` for tracked maintenance operations. `ProfileApi.exportProfile(id):Promise<Result<{fileName:string}|null>>`, `importProfile():Promise<Result<Profile|null>>`. File paths remain in main. Reuse profile restoration transaction/compensation primitives rather than opening a second database connection or publishing early.

- [ ] Add failing tests for cancelled dialogs, sensitive-archive confirmation, destination inside profile, running/blocked/orphan rejection, missing engine, partial writes, import proxy-password requirement, new UUID with unchanged fingerprint seed, and no cookie/URL/password contents in UI/logs.
- [ ] Run `npx vitest run tests/unit/portable-service.test.ts`; confirm missing-service behavior fails.
- [ ] Export under one exclusive lease: read settings/snapshot, collect cookies through isolated Chromium, close successfully, copy filtered browser data, stream archive to a temporary destination, atomically rename. Register all active work for shutdown. Keep source profile data unmodified except normal Chromium maintenance effects.
- [ ] Import entirely in staging: validate, copy, launch verified isolated maintenance browser, restore/verify cookies, close, prepare profile/proxy/session publication, then commit. Explicitly mark imported authenticated proxies as requiring credentials so an attempted launch cannot become DIRECT. Reject overwrites; return only the new profile DTO after success.
- [ ] Inject failures after staged cookie restoration, after directory rename, during snapshot publication, and after database writes before commit. Assert no new visible profile/proxy/snapshot and no partial published directory remain. Cleanup errors retain the primary safe error and are covered separately; never report successful rollback when a process still holds files.
- [ ] Add distinct Export profile… and Import profile… actions, retain Backup / Restore, localized warnings and result messages, busy state, and dialog cancellation. Extend preload and invalid-argument tests.
- [ ] Integration: export a source with localStorage/IndexedDB/cookies/tabs/settings, import into separate temporary app storage, verify cookies and seed, alter imported data and prove the source is unchanged. Keep historical backup roundtrips passing. Run both full verification commands; expect PASS.
- [ ] Commit: `feat: export and import portable browser profiles`.

### Task 9: Manual acceptance, documentation, and review

**Files:** Update `README.md`, `STATUS.md`, `TODO.md`, `DECISIONS.md`, `docs/{architecture,development,verification}.md`; retain this plan's checkboxes as the execution ledger.

**Interfaces:** No new runtime interfaces. Verification records distinguish automated PASS, manual PASS, BLOCKED, and known limitations.

- [ ] Run `npm run verify` and `npm run test:integration` on the final combined tree; capture exact counts/runtime versions. A build-number increase from each command is expected, not repository drift requiring a reset.
- [ ] In isolated data directories manually test export/import via actual dialogs, restore preference on/off, cookie-clear confirm/cancel, EN/RU restart/switch, known/unknown-country flags, and version/title agreement at narrow width. Do not use real profiles.
- [ ] Transfer a test archive to a separate Windows account or machine with a verified compatible engine. Verify a controlled local test login and document that unrelated websites may reject transferred tokens; verify that proxy password re-entry is required. Without this environment, mark cross-account acceptance BLOCKED.
- [ ] Document sensitive plaintext archives, browser-bound credential limitations, tab-URL-only restoration, offline dataset date/license/refresh, build counter scope/recovery/failed-attempt gaps, backup v4 compatibility, and any required translation-policy approval. Update TODO only for verified deliverables.
- [ ] Request one independent whole-branch review focused on import rollback, secret exposure, session initialization order, cookie completeness, and build-state recovery. Fix findings with failing regression tests before changes; rerun both full verification commands after fixes.
- [ ] Commit documentation: `docs: document profile portability and usability verification`. Do not publish, merge, or rewrite remote history without an explicit request.

## Plan self-review

- Coverage: all six requested features have independently testable increments; profile export/import is deliberately separate from existing backups.
- Dependencies: Task 5 depends on Task 4; Task 6 uses localization infrastructure; Tasks 7–8 depend on Task 2's persisted seed/session contracts. Task 3 shares maintenance code but does not require portable formats.
- Review Focus: each of the five named risks has explicit tests in its owning task.
- Important limits: restore means tab URLs, not native history; cross-site authorization portability is best effort; failed build attempts consume numbers; global multi-clone numbering needs coordination.
- No implementation, automatic commits, dependency acquisition, or real-user-data operations were performed while writing this plan.
