# Local Profile Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable Windows manager for independent Chromium profiles, without a Dolphin account or cloud.

**Architecture:** An isolated Electron renderer calls the main process's validated IPC API. The main process stores metadata in SQLite and manages separate Chromium processes and proxy bridges; BrowserEngineAdapter separates the engine from the manager. Browser profile directories do not overlap.

**Tech Stack:** Electron, TypeScript, React, Vite, Zod, SQLite through better-sqlite3 rebuilt for Electron, Vitest, Playwright for Chromium integration tests, yauzl/yazl for streaming archives. Dependency versions are pinned in a lockfile during implementation; check compatibility with the installed Node before installation.

**Spec:** `docs/superpowers/specs/2026-10-30-local-profile-manager-design.md`

## Global Constraints

- Windows; data only in this application's own user directory, not Dolphin's directory.
- No Dolphin account, subscription, cloud, or API; no use of its code, binaries, or branding.
- Each profile has a separate persistent directory and a separate standard Chromium process.
- contextIsolation enabled, nodeIntegration disabled; the renderer has no Node.js access.
- HTTP/HTTPS upstream with optional authentication; SOCKS5 without authentication. No PAC or chains.
- Proxy secrets use Windows DPAPI through Electron safeStorage; refuse to save if encryption is unavailable.
- No automatic direct connection on proxy failure; a loopback bridge per profile.
- No promises of anti-detection or elimination of all DNS/WebRTC/UDP leaks; fingerprints are outside the first version.
- Download Chromium only on explicit action, using official Chrome for Testing with a pinned version and SHA-256. Establish a source for a trusted checksum before delivery; a locally computed hash alone does not prove authenticity.
- Copy only closed profiles; restore into a new profile without proxy secrets or overwriting an existing profile.
- No installer, automatic updates, or automatic Dolphin data migration.
- The working directory is not currently a Git repository. At implementation start, creating a new local repository here without a remote is authorized. Commits below are local and follow successful tests; do not commit user data.

## Review Focus

1. Spaces, Cyrillic characters, and quotes in paths/names: launch through an argv array without a shell (Task 3).
2. Proxy unavailable or incorrect password required: clear error, no fallback or secret leakage (Task 4).
3. Manager crash leaves a browser and busy directory: prevent duplicate startup without killing an unrelated PID (Task 5).
4. Malicious archive or insufficient disk space: no storage escape or partially visible restore (Task 6).
5. Invalid URL/IPC and a window displaying an external page: reject dangerous schemes and access to the privileged API (Tasks 1, 7).

## File map

- `src/shared/contracts.ts`, `validation.ts`: DTO types and Zod schemas; no Electron/Node imports.
- `src/main/index.ts`, `ipc.ts`, `window.ts`: bootstrap, IPC, window security.
- `src/main/profiles/{repository,service,paths}.ts`: SQLite, profile operations, safe paths.
- `src/main/security/secrets.ts`: safeStorage wrapper and log protection.
- `src/main/engines/{types,chromium,installation}.ts`: adapter, launch, explicit engine installation.
- `src/main/runtime/{supervisor,recovery}.ts`: processes, locks, crash recovery.
- `src/main/proxy/{bridge,check}.ts`: upstream, loopback, explicit IP checking.
- `src/main/backups/{archive,service}.ts`: streaming backups and safe restore.
- `src/preload/index.ts`: typed contextBridge.
- `src/renderer/{App,ProfileList,ProfileEditor,EngineSettings}.tsx`, `styles.css`: English interface, states, and errors.
- `tests/unit/`, `tests/integration/`, `tests/fixtures/`: tests using synthetic data only.
- `scripts/{dev,build,verify}.mjs`, `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`: running, building, testing.
- `README.md`, `.gitignore`: instructions and exclusions for data/secrets/engine.

## Shared interfaces

All profile identifiers are UUIDs. `ProfileInput = {name:string; note:string; startUrls:string[]; language:string; proxy:ProxyInput|null}`. `ProxyInput = {kind:'http'|'https'|'socks5';host:string;port:number;username?:string;password?:string}`. A saved profile returns `proxy` without a password, with `hasPassword:boolean`. Update: `password:undefined` preserves the previous secret; `password:''` clears it.

`Profile = {id:string; name:string; note:string; startUrls:string[]; language:string; proxy:ProxyPublic|null; createdAt:string; updatedAt:string}`. `ProfileState = 'stopped'|'starting'|'running'|'stopping'|'error'|'blocked'`.

`AppError = {code:string;message:string}`; IPC returns `Result<T> = {ok:true;value:T}|{ok:false;error:AppError}`. DTOs contain no secrets, absolute paths, stack traces, or ChildProcess objects.

`ProfileApi`: `list():Promise<Result<Profile[]>>`, `create(input:ProfileInput):Promise<Result<Profile>>`, `update(id:string,input:ProfileInput):Promise<Result<Profile>>`, `remove(id:string):Promise<Result<void>>`, `start(id:string):Promise<Result<void>>`, `stop(id:string):Promise<Result<void>>`, `states():Promise<Result<Record<string,ProfileState>>>`. The renderer polls states once per second; persistent IPC subscriptions are not needed yet.

Internal interfaces: `EngineLaunch = {profileId:string;userDataDir:string;startUrls:string[];language:string;proxyUrl?:string}`; `EngineProcess = {pid:number;executable:string;startedAt:string;exit:Promise<{code:number|null;signal:string|null}>;stop():Promise<void>}`. `BrowserEngineAdapter = {capabilities:{fingerprints:false};validate():Promise<void>;launch(input:EngineLaunch):Promise<EngineProcess>}`. `ProxyLease = {url:string;close():Promise<void>}`.

---

### Task 1: Contracts and a testable application skeleton

**Files:** Create `package.json`, lockfile, `.gitignore`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `scripts/*.mjs`, `src/shared/contracts.ts`, `src/shared/validation.ts`; Test `tests/unit/validation.test.ts`.

**Interfaces:** Produces the shared DTOs above and `parseProfileInput(value:unknown):ProfileInput`, `parseProfileId(value:unknown):string`.

- [ ] Check Node/npm, existing files, and AGENTS.md; initialize local Git without changing global configuration. Configure minimal scripts: `dev`, `build`, `typecheck`, `test`, `test:integration`, `verify` (typecheck + unit + build).
- [ ] Write failing tests `rejects_unsafe_urls`, `rejects_invalid_proxy`, `accepts_russian_profile`: `expect(() => parseProfileInput({...valid,startUrls:['file:///C:/secret']})).toThrow()`; also reject javascript:, data:, credentials in URLs, port 0/65536, and authenticated SOCKS5; accept the name `Work profile`. Allow http:, https:, and the exact `about:blank`.
- [ ] Run `npm test -- tests/unit/validation.test.ts`; expect FAIL because implementations are missing, not because the test runner is broken.
- [ ] Implement schemas: name 1–120 characters after trim, note up to 4000, up to 20 start URLs, language using BCP-47 syntax; port 1–65535; host without a scheme, path, credentials, or control characters. Reject unknown fields.
- [ ] Run the same test and `npm run typecheck`; expect PASS. Commit the listed files: `feat: add validated profile contracts`.

### Task 2: Profile and secret storage

**Files:** Create `src/main/profiles/{repository,service,paths}.ts`, `src/main/security/secrets.ts`; Test `tests/unit/profiles.test.ts`, `tests/unit/secrets.test.ts`.

**Interfaces:** Consumes `ProfileInput`, `Profile`; Produces `ProfileService.list/create/update/remove` with the API signatures but without the Result wrapper, `profilePath(root:string,id:string):string`, `SecretStore.seal(value:string):Buffer`, `SecretStore.open(value:Buffer):string`. Inject SecretStore, UUID, a clock, and a temporary root for tests.

- [ ] Write failing tests for persistence after reopening SQLite, distinct directories for A/B, password update semantics, and seal failure when safeStorage is unavailable. Assertions: `expect(profilePath(root,a)).not.toBe(profilePath(root,b))`; `expect(dbBytes.includes(Buffer.from('proxy-password'))).toBe(false)`; `expect(() => profilePath(root,'../outside')).toThrow()`.
- [ ] Run `npm test -- tests/unit/profiles.test.ts tests/unit/secrets.test.ts`; expect FAIL due to the missing implementation.
- [ ] Implement versioned SQLite migration, UUID directories, transactional operations, and SecretStore. Do not use user-provided names in paths. Deletion requires an injected guard `assertStopped(id:string):Promise<void>`; test with a stub until the supervisor exists. Disk errors must not leave a visible incomplete record; log only error codes without input.
- [ ] Run tests and typecheck; expect PASS. Commit `feat: persist isolated profile metadata securely`.

### Task 3: Chromium adapter and engine management

**Files:** Create `src/main/engines/{types,chromium,installation}.ts`; Test `tests/unit/engine.test.ts`, `tests/integration/engine-installation.test.ts`.

**Interfaces:** Consumes `EngineLaunch`; Produces `ChromiumAdapter implements BrowserEngineAdapter`, `EngineInstaller.status():Promise<EngineStatus>`, `EngineInstaller.install(release:EngineRelease):Promise<void>`. `EngineRelease={version:string;url:string;sha256:string}` is supplied by the developer, not an arbitrary URL from IPC; `EngineStatus={state:'missing'|'ready'|'unsupported';version?:string}`.

- [ ] Write an argv test with directory `Profiles with spaces`, quotes in the note, and two URLs: `expect(spawnOptions.shell).toBe(false)`; `expect(argv).toContain('--user-data-dir='+dir)`; remote-debugging-port is absent. Download test using a local server: incorrect SHA-256 prevents installation, interrupted downloads do not become ready, and archives containing `../` are rejected.
- [ ] Run the relevant tests; expect FAIL because the adapter and installer are missing.
- [ ] Implement spawn without a shell, persistent user-data-dir, language and start URLs, suppressed first-run/default-browser prompts, without disabling the sandbox. Passwords in argv are forbidden. stop first gracefully closes the browser belonging to the profile process; limited forced termination is allowed only for a verified application-owned process tree after a 10-second timeout.
- [ ] Implement installation into a staging directory: explicit install only, official HTTPS CfT URL in the shipped catalog, digest verification, safe extraction, atomic release activation. During implementation choose the current stable release and record version/hash/provenance in `src/main/engines/releases.json`; a missing verified release blocks installation with an explanation, never a fake hash. No network requests during bootstrap.
- [ ] Run tests and build; expect PASS. Commit `feat: add replaceable Chromium engine adapter`.

### Task 4: Per-profile proxy bridge

**Files:** Create `src/main/proxy/{bridge,check}.ts`, `tests/fixtures/proxy-servers.ts`; Test `tests/integration/proxy.test.ts`.

**Interfaces:** Consumes `ProxyInput`, SecretStore decryption only within main; Produces `openProxyBridge(input:ProxyInput):Promise<ProxyLease>`, `checkProxy(input:ProxyInput,endpoint:URL):Promise<{ip:string}>`. IPC will later provide a fixed IP-check address, not an arbitrary endpoint.

- [ ] Write tests with local origin/upstream servers: HTTP and CONNECT tunnels, Basic-auth, TLS upstream, and SOCKS5 without auth. `expect(upstream.auth).toBe(expected)`; `expect(origin.headers['proxy-authorization']).toBeUndefined()`; listener address strictly 127.0.0.1; different leases have different ports.
- [ ] Add an upstream failure/407 test: `expect(origin.requestCount).toBe(0)`; an error is returned, the password is absent from captured logs; close destroys open sockets. HTTPS upstream validates the certificate (do not use rejectUnauthorized:false).
- [ ] Run `npm run test:integration -- tests/integration/proxy.test.ts`; expect FAIL due to the missing bridge.
- [ ] Implement a bridge with bounded 10-second connection timeouts, socket cleanup, and no DIRECT fallback; select a maintained tunneling library covering the specified schemes and document the choice in README. Pass the loopback address to Chromium and disable implicit loopback bypass (`--proxy-bypass-list=<-loopback>`) so local websites also go through the test upstream.
- [ ] Implement an explicit IP check through the same bridge, validating the returned IP and limiting the response to 64 KiB; do not run it automatically. Run integration tests, unit tests, and typecheck; expect PASS. Commit `feat: isolate authenticated proxy connections`.

### Task 5: Lifecycle, locking, and recovery

**Files:** Create `src/main/runtime/{supervisor,recovery}.ts`; Test `tests/unit/supervisor.test.ts`, `tests/integration/recovery.test.ts`.

**Interfaces:** Consumes ProfileService, BrowserEngineAdapter, `openProxyBridge`; Produces `Supervisor.start(id:string):Promise<void>`, `stop(id:string):Promise<void>`, `states():Record<string,ProfileState>`, `assertStopped(id:string):Promise<void>`, `shutdown():Promise<void>`, `recover():Promise<void>`.

- [ ] Write tests: concurrent `start(A)` launches the engine exactly once; A and B are independent; launch failure closes the lease; exit changes running to stopped/error and releases the lease. Assertion: `expect(engine.launch).toHaveBeenCalledTimes(1)` for two simultaneous starts of A.
- [ ] Add recovery tests: a saved PID with a different exe/creation time is not terminated; live Chromium using the matching directory blocks duplicate startup; unverified ownership results in blocked, not lock deletion. Stop failure retains blocked and prevents deletion/backup.
- [ ] Run tests; expect FAIL due to the missing supervisor.
- [ ] Implement states, a per-profile mutex, and a journal of owned processes. During normal operation retain a Windows handle/equivalent reliable identity; after a crash verify PID, creation time, executable, and user-data-dir. Never rely on PID alone. Register app.requestSingleInstanceLock; do not accept second-instance argv as commands.
- [ ] Run tests and typecheck; expect PASS. Commit `feat: supervise profile processes and crash recovery`.

### Task 6: Safe backups

**Files:** Create `src/main/backups/{archive,service}.ts`; Test `tests/integration/backups.test.ts`.

**Interfaces:** Consumes `assertStopped`, ProfileService, and safe UUID paths; Produces `BackupService.create(id:string,destination:string):Promise<void>`, `restore(source:string):Promise<Profile>`. Paths come only from native file dialogs in main, not the renderer.

- [ ] Write a roundtrip test for a closed profile: matching data, new UUID, no password. Tests reject running/blocked, `../`, absolute paths, alternate data streams, links, duplicate paths, incompatible versions, and Windows device names. Synthetic ENOSPC write failure: `expect(await profiles.list()).toEqual(before)` and staging does not appear as a profile.
- [ ] Run `npm run test:integration -- tests/integration/backups.test.ts`; expect FAIL due to the missing implementation.
- [ ] Implement streaming ZIP with a versioned manifest and import through staging/atomic registration. v1 limits: 100000 entries, 20 GiB total unpacked data; verify actual bytes written, not just ZIP headers. Recheck stopped under lock before reading. Restored proxies require the secret to be entered again. Do not promise portability of Chromium-encrypted cookies between Windows users.
- [ ] Run tests and typecheck; expect PASS. Commit `feat: back up closed profiles safely`.

### Task 7: Secure IPC and a working English interface

**Files:** Create `src/main/{index,ipc,window}.ts`, `src/preload/index.ts`, `src/renderer/{App,ProfileList,ProfileEditor,EngineSettings}.tsx`, `src/renderer/styles.css`, `index.html`; Test `tests/unit/ipc.test.ts`, `tests/unit/ui.test.tsx`.

**Interfaces:** Consumes the preceding services; Produces `window.profileApi:ProfileApi` plus `engineStatus()`, `installEngine()`, `backup(id)`, `restore()`, `checkProxy(id)`, `confirmShutdown()`, all returning `Promise<Result<T>>`. install/check/backup/restore need separate explicit buttons/confirmations; cancelled dialogs are not errors.

- [ ] Write IPC tests: unknown sender/frame, invalid UUID/input, and extra fields are rejected before service invocation. `expect(service.start).not.toHaveBeenCalled()` after an invalid request. Child/external frames do not receive the main UI's privileges. list/update do not return passwords.
- [ ] Write UI tests for creation/editing, search, proxy display without passwords, disabled buttons during starting/stopping, visible error/blocked/missing engine messages, deletion confirmation, and a warning about sensitive backups.
- [ ] Run `npm test -- tests/unit/ipc.test.ts tests/unit/ui.test.tsx`; expect FAIL due to missing implementations.
- [ ] Implement contextBridge with an allowlist of methods, IPC Zod validation, and exact webContents/mainFrame checks. The window loads only its own UI, blocks external navigation/new windows, and uses CSP without unsafe-eval in production. Never load external URLs into the privileged window. On close with active profiles, show a native confirmation; cancellation leaves everything running, confirmation invokes shutdown before app.quit.
- [ ] Implement a restrained English interface without Dolphin branding: list, editor, engine settings, states. Show “Profile isolation is not anti-detection” and a warning about proxy/leak limitations. No registration, telemetry, or background cloud requests.
- [ ] Run unit tests, typecheck, and build; expect PASS. Commit `feat: add local profile management interface`.

### Task 8: Windows end-to-end verification and instructions

**Files:** Create `tests/integration/isolation.test.ts`, `tests/integration/app-smoke.test.ts`, `README.md`, `docs/verification.md`; Modify verify scripts as needed.

**Interfaces:** Consumes the real ChromiumAdapter and application; Produces reproducible checks and instructions for `npm ci`, `npm run dev`, `npm run build`, `npm run verify`, and a separate integration run with an explicitly installed engine.

- [ ] Write a real test with a local origin: A stores a cookie/localStorage/IndexedDB, B sees none of the markers; A retains its markers after closing and restarting. Playwright connects to real test Chromium through a pipe/test transport; production does not open a debugging port. Test profiles are separate and contain no user data.
- [ ] Write an Electron smoke test: offline profile creation, metadata after restart, A/B startup, stop, duplicate-start rejection. Capture outgoing connections from the manager process: normal startup makes no Dolphin/telemetry/engine-download requests. Blocking the network must not break CRUD.
- [ ] Run the new tests; if the environment or engine is unavailable, record BLOCKED with the reason, not PASS. Fix defects through the failing test → minimal fix → passing test cycle.
- [ ] Run `npm run verify` and `npm run test:integration` on Windows. Manual checks: authenticated proxy, proxy failure, app close cancel/confirm, manager crash, backup/restore. Record the date, Node/Electron/Chromium versions, commands, and actual results in `docs/verification.md`; exclude tokens, passwords, real cookies/IP addresses.
- [ ] Write README: data location, explicit engine installation, supported proxies, anti-detection and DNS/WebRTC limitations, backup security, no Dolphin dependency, and what to do when blocked. CRUD needs no network; websites and engine downloads do.
- [ ] Obtain an independent final code review using the chosen execution approach, resolve significant findings, and rerun affected checks. Commit `test: verify local profile isolation on Windows`.

## Plan coverage check

- [x] First-version features are mapped to Tasks 1–8.
- [x] Every interface is defined before use; external DTOs contain no internal paths or processes.
- [x] All five Review Focus items have specific tests in the corresponding tasks.
- [x] Covers safeStorage, no fallback, single instance, recovery, archive staging, explicit installation, and IP checking.
- [x] Fingerprints are explicitly deferred; the adapter does not pretend to provide them.
- [x] Implementation and dependency installation have not started yet.
