# First-version verification

Date: 2026-10-30. Machine: Windows (x64), Node.js 22.23.4, npm 10.9.9, Electron 45.1.0; Chromium for integration tests is a local Playwright build (`ms-playwright/chromium-1228`, Chrome 149.0.7827.55). The application's Chrome for Testing 156.0.8078.80 engine **was installed through the UI on 2026-10-30** after the release was pinned (see below).

## Automated checks

### GPL-3.0-only licensing (2026-10-31)

- The repository previously had **no license**, so GitHub reported no license and distribution was legally "all rights reserved". The owner approved `GPL-3.0-only` and reserved the product name, logo and `ico/` artwork.
- The owner confirmed Dolphin was used only as a source of ideas and observable behaviour and that the code is original, so relicensing is not blocked by third-party proprietary code.
- `LICENSE` is the canonical text from `https://www.gnu.org/licenses/gpl-3.0.txt` (35,149 bytes, SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`), copied verbatim. The SPDX plain-text copy differs only in whitespace formatting, which confirms document identity. Required structural markers (title, version line, sections 0/15/16, "How to Apply", end marker) were asserted.
- `package.json` declares `GPL-3.0-only`; `NOTICE` carries the copyright line, warranty disclaimer, brand reservation, third-party attribution and the separate-program note for Chrome for Testing.
- Dependency licenses were read from installed packages and the production tree: MIT (20), Apache-2.0 (1), BSD-3-Clause (1), 0BSD (1). All are GPLv3-compatible; Apache-2.0 is compatible with GPLv3 but not GPLv2, and nothing here requires GPLv2.
- README gained a GPL-3.0 badge and a License section; `LICENSE` and `NOTICE` links resolve and are tracked. All remote links and badge endpoints responded successfully.
- `npm run verify` PASS (349 unit, typecheck, build); `npm run test:integration` PASS (60/60). No application code changed.
- Published and verified on GitHub: repository license detection reports `GPL-3.0` / "GNU General Public License v3.0", the detected `LICENSE` blob is `f288702d2fa16d3cdf0035b15a9fcbc552cd88e7` (the canonical Git blob for the GPLv3 text, 35,149 bytes), and the public README blob equals the committed one. The rendered page shows the "GPL-3.0 license" label in the README header, all six badges including the license badge, the License section, and working `LICENSE`/`NOTICE` links.
- Not done: NSIS license page (installer UI change, deferred) and per-file SPDX headers. No new release was built.

### Anti-detect and privacy presentation (2026-10-31)

- On the user's approval, changed the README heading to **Exodus Anti-Detect Browser** and updated GitHub positioning. The Windows application's display name, installer filenames, source behavior, release tags and storage paths remain unchanged.
- Added a user-oriented explanation of configurable fingerprints, graphics/audio noise, screen/hardware settings, time zone/location, WebRTC controls, isolated storage, optional proxies, cookie persistence and local profile management.
- Fact-checked against fingerprint schemas/defaults, presets and the implemented spoof script. Clarified that noise changes selected outputs rather than recreating another physical device, Altered WebRTC does not substitute the proxy's public IP, many new-profile defaults expose real values, and there is no built-in ad/tracker-blocking list. Included account/cookie/IP correlation and network/anonymity limitations.
- Added `anti-detect`, `antidetect-browser`, `anti-fingerprinting` and `browser-privacy` Topics; existing Topics and release tags were preserved. Checked tracked relative links, remote release/issue URLs, all badge SVGs and GitHub Markdown rendering.
- `npm run verify` PASS (349 unit, typecheck, build); `npm run test:integration` PASS (60/60). Subsequent fact-check corrections changed prose only.

### Repository presentation (2026-10-31)

- Reworked the English README as a user guide: existing Exodus artwork, four factual badges, a latest-release download link, feature overview, installer-first onboarding, everyday tasks, data storage, updates, privacy limits and support. Developer setup remains in the linked development guide; removed README links to local-only files that are not published.
- Checked feature claims against the implemented UI and archive schemas. Review corrections clarified the Settings > Edit path, Manifest V3 extension support, extension exclusions from archives, the Chromium requirement for portable transfers and the limits of cookie clearing.
- Updated the GitHub description, homepage link to Releases and 12 descriptive Topics. No license, release tags or application code changed.
- Verified all README relative files are tracked; external release/issue links and all badge SVG endpoints responded successfully. GitHub's Markdown API rendered the README, and a disposable preview was visually checked at desktop and 390 px mobile widths using only public artwork and documentation.
- `npm run verify` PASS (349 unit, typecheck, build); `npm run test:integration` PASS (60/60). Subsequent review corrections changed prose only.

### 1.1.85 installed-updater test release (2026-10-31)

- The user reported manually installing 1.1.84. Published the version-only `v1.1.85` release so the installed application can exercise its new transport; application code is unchanged from 1.1.84.
- Fresh `npm run verify` PASS (349 unit, typecheck, production build), `npm run test:integration` PASS (60/60), `npm run dist` PASS (version 1.1.85, `app.asar` intact).
- Published `ExodusBrowser-Setup-1.1.85.exe` (135,268,906 bytes) and `SHA256SUMS`. SHA-256: `a1d99a33150e2e47bbd737860567cd8dfc789b8fc20810bbd4ffcc4bc825ed24`. An unauthenticated `releases/latest` request returned `v1.1.85`, non-draft and non-prerelease.
- A disposable real-Electron production-default service run, reporting current version 1.1.84, checked/downloaded the public 1.1.85 installer to `ready` in 7.60 seconds; size and SHA-256 matched. The probe did not execute an installer or open real profile storage.
- User acceptance was initially pending; see the subsequent confirmation below. This test release contains no separate installation fix.

### User acceptance: installed update 1.1.84 to 1.1.85 (2026-10-31)

- After reporting a manual installation of 1.1.84, the user tested the published 1.1.85 update through the installed application and confirmed that downloading was fast and installation completed normally.
- This is user-reported acceptance of the download-to-install scenario on this Windows installation, not another disposable service-only probe. The earlier slow/stalled-download and missing-install-step reports did not recur in this test.
- The user did not supply an exact duration or a separate post-restart version screenshot. Automatic restart details, other installation modes/accounts and Windows proxy/PAC/custom-certificate environments are not separately verified by this report. No additional test release is required for the reported scenario.

### Update transport investigation (2026-10-31; unpublished 1.1.84 candidate)

- User report: downloading the 1.1.83 update from installed 1.1.82 took almost ten minutes, then no installer appeared. Read-only inspection found the full 135,269,832-byte installer under the legacy update directory; SHA-256 was `609f58f4ee8052de5ceeb31af94f02ff083c27f77d67e508cc7ef380a9bd4398`. No real installer was run, no installed app was closed and no profile database was opened by this investigation.
- Reproduced in disposable Electron processes: the old transport took 437.6 seconds; curl downloaded the same full asset in 6.34 seconds. A separate run of the original 1.1.82 writer took 70.9 seconds. These timings alone did not establish a writer bottleneck.
- Bounded measurements counted bytes at the Chromium response and at the writer: both progressed slowly together (roughly 5-6 MB per 15 seconds). With HTTP/2 disabled only in the disposable diagnostic process, full Chromium downloads took 6.14/7.06 seconds. Node downloads in that comparison took 4.05/4.63 seconds. No protocol setting was changed in production.
- Changed production to the default Node HTTPS transport, preserving redirect allowlisting and checksums. Two complete `UpdateService` runs **inside Electron, without injecting a test fetch implementation**, checked the live release and downloaded/verified the installer in 5.61 and 7.93 seconds. Connection diagnostics reported ALPN `http/1.1`. Both hashes matched the value above.
- Limitations: an earlier Node metadata check failed and an earlier Node download hit a 30-second diagnostic cancellation. Network speed is not guaranteed. Chromium resolved DIRECT for GitHub and its asset host on this machine; Windows proxy/PAC and custom-certificate environments have not been accepted for the new Node transport.
- A cancelled diagnostic of the old adapter exposed `ERR_INVALID_STATE: Controller is already closed` and an Electron error dialog. The obsolete adapter is removed rather than retained as a fallback. New tests check cancellation of the native response connection **before** forced test-server cleanup.
- `tests/integration/update-node-transport.test.ts` uses an offline loopback server and the production default inside real Electron: metadata/checksum/installer redirect chain, HTTP/1.1 compatibility, verified bytes/readiness and installer-callback invocation, streamed cancellation without a partial file, and blocked untrusted redirects. The installer callback is a test stub: it does not prove real NSIS handoff. Replaces the old adapter-specific online GitHub test.
- Unit regressions cover releasing streaming bodies discarded on allowed/rejected/malformed redirects and HTTP errors, cancelling a failed installer body, and the existing checksum/size/idle-timeout rules. `npm run verify` PASS (349 unit, typecheck, build); `npm run test:integration` PASS (60/60 across 16 files). The first full run exposed an index-based language inventory referencing the unstaged deleted adapter; staging its deletion and rerunning passed without changing the language policy test. Independent review identified discarded-body cleanup and a teardown-only socket-closure assertion; both were corrected and verified before the full runs.
- At this investigation checkpoint, release 1.1.84 was not yet published. The missing installed-app install prompt and interactive NSIS handoff/restart remain unresolved and are not claimed fixed by these transport tests.

### 1.1.84 release preparation (2026-10-31)

- Fresh `npm run verify` PASS (349 unit, typecheck, build); `npm run test:integration` PASS (60/60). The first release-check run exposed a pre-existing race in the build-lock test: it started both reservations concurrently but assumed which one acquired the lock. The test now waits for the first build callback before checking rejection of the second reservation; production locking code is unchanged.
- `npm run dist` PASS on the second packaging attempt: version 1.1.84, `app.asar` intact. The first NSIS attempt reported "Can't open output file"; subsequent inspection found no matching installer/compiler process and exclusive file access was available. No security product was disabled; an ordinary rebuild succeeded. The source of that transient lock is unproven.
- Prepared `ExodusBrowser-Setup-1.1.84.exe` (135,269,002 bytes), SHA-256 `06f19ed2f75278cb97f4bf0f5eab102d4f4b4a70591f6e02bf7caef7bfd245aa`, plus `SHA256SUMS`. Installer execution remains unverified.
- Published `v1.1.84` with those two assets. An unauthenticated public `releases/latest` request returned `v1.1.84` with `draft: false` and `prerelease: false`.
- Post-publication real-Electron check/download using the production default: the 135,269,002-byte public 1.1.84 installer reached `ready` in 6.11 seconds with the matching SHA-256 above. No installed app or real installer was launched by this probe.
- Older installed versions still use their old downloader until manually upgraded. To exercise the new code through the installed UI, manually install 1.1.84 and subsequently offer a newer test release; downloading 1.1.84 from 1.1.82 does not test the new transport.

### Themed confirmations (2026-10-31)

- Renderer unit tests cover cookie-clear cancel/approve, profile-delete cancel/approve, backup approval, Escape cancellation, and active-window close cancel/approve decisions.
- Electron smoke verifies Russian cookie-confirmation text/actions in an in-app `alertdialog` without calling `dialog.showMessageBox`.
- Built Electron dialog screenshot was inspected at `C:\Users\la\AppData\Local\Temp\opencode\exodus-confirmation-preview.png` using separate temporary storage. Native file picker code remains in main.
- This is automated/agent visual inspection, not user manual acceptance of cookie clearing or closing while real Chromium is running.

| Command | Result |
|---|---|
| `npm run verify` (typecheck + unit + production build) | PASS: 141/141 unit, typecheck without errors, production build |
| `npm run test:integration` | PASS: 36/36 across 9 files; including real Chromium fingerprint, cookies, and backup v1/v2/v3 |
| `npx vitest run tests/integration/isolation.test.ts` | PASS: cookies, localStorage, and IndexedDB are isolated between profile directories and persist after browser restart |
| `npx vitest run tests/integration/app-smoke.test.ts` | PASS: window opens, profile is created offline, preload API is allowlisted, `require`/`process` are unavailable to the page, all window requests use `file://`/`data:`/`devtools://`, SQLite contains no absolute paths |

Covered by tests:

- URL, proxy, language, UUID, and extra-field validation; rejection of `javascript:`, `data:`, `file:`, URL credentials, ports outside 1–65535, and authenticated SOCKS5;
- profile persistence after restart, unique directories, no plaintext password in SQLite, password preservation/clearing, rejection when encryption is unavailable;
- HTTP/CONNECT through authenticated upstream, no `Proxy-Authorization` at the origin, unauthenticated SOCKS5, rejection without direct fallback for incorrect passwords and unavailable proxies;
- explicit IP check through a proxy and rejection of invalid responses;
- double-launch prevention, profile independence, exclusive lock for copying/editing, `blocked` after failed stopping;
- crash recovery: unrelated processes are not terminated; suspicious/unavailable process inventory blocks the profile;
- ZIP backup of a stopped profile, new UUID, no proxy password, rejection of running profiles and unsafe paths/links/duplicates/excessive size, no partially visible profile after write failure;
- IPC: untrusted frames and invalid arguments are rejected before service invocation; errors do not expose paths or secrets;
- UI: search, disabled actions for running profiles, missing-engine message, profile editor, anti-detection warning.
- fingerprint (2026-10-30): schema and defaults, reading old profiles without rewriting SQLite, persistence and launch input, backup v3 and v1/v2 reading with defaults; editor — mode switching, engine-version-aware “New fingerprint”, vendor/renderer required for Manual WebGL, Manual timezone/geolocation fields, blocking while busy; card summary and WebRTC Off warning; `FINGERPRINT_UNAVAILABLE`/`INVALID_FINGERPRINT` messages and input-error text.
- fingerprint on real Chromium (Playwright 149): UA and Client Hints, timezone, screen, CPU/memory, stable and distinct noise, WebGL vendor/renderer, WebGPU Off, Canvas Off, WebRTC Off/Altered, Manual geolocation returns configured coordinates, Auto does not provide them without permission; unavailable CDP closes the browser. A launch flake was found and fixed: `navigate` did not wait for the initial page — added a wait of up to 5 s with unit coverage. Final review found and fixed: `Supervisor.start` did not pass the fingerprint to the engine (the field is now required in the type and tested), streaming noise was replaced with a positional hash (repeated canvas reads, including after layout measurement, match), `toBlob` returns a decodable image again, WebGL Off does not create a context, Client Hints use GREASE `Not_A Brand`/`24`, the full version, and `arm` for macOS, internal `devtools://`/`chrome://` pages are not patched, and process exit is awaited after an emergency `kill`.
- cookies (2026-10-31): Dolphin JSON and Netscape normalization, limits, rejection of corrupted files, export and lossless reimport; on real Chromium — httpOnly is sent to the server but not exposed in `document.cookie`, session cookies persist, the local server received no requests during the headless session, import/export work with a dead proxy while profile launch with it remains rejected; import into a running profile returns `PROFILE_BUSY`. Manual button acceptance with actual Electron dialogs has not yet been performed.
- IP-check UX (2026-10-30): 4 new UI regressions (card association, warning before click, repeat check, error, proxy change); an Electron scenario with a real local upstream confirms no modal dialog or requests before click and IP output in the card without a global alert. All tests passed; the new tests first reproduced the old behavior as FAIL. User visual acceptance of the new UX has not yet been performed.
- The author checked screenshots of a separate Electron instance with test data at normal window size and a 780 px viewport: the warning is readable, the result is green in the card, and there is no global banner. Independent review found no Critical/Important issues; a separate password-only-change UI test was deferred (TODO P2). User profiles were not touched during testing.

## Completed manual checks

- Launching the production build through Electron: the application window opens, SQLite is created, and the UI renders. The historical window title used the former product name; current display branding is Exodus Browser.
- Launching another application instance does not create a second window (single instance lock).
- **Engine installation using “Download Chromium” (2026-10-30, PASS).** Pinned CfT 156.0.8078.80, official URL `https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/win64/chrome-win64.zip`. The archive was downloaded over TLS from the official bucket; its size, 208,152,768 bytes, matched Content-Length; local SHA-256 `16edb57d6107bf1c48a7c149b8d78b155fe614410093796dd72441fd6640540f`. This pins the archive, not independent authentication of the initial download. UI installation was confirmed: `%APPDATA%\Local Profiles\engine\current\chrome-win64\chrome.exe`, ProductVersion 156.0.8078.80, `release.json` present, staging removed; system proxy disabled.
- **Version clarification (2026-10-30).** [Official metadata](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json), timestamp `2026-10-29T22:14:17.810Z`: Stable = 156.0.8078.80; the win64 URL exactly matched the pin. The earlier 404 was caused by the incorrect filename `latest-versions-with-downloads.json`, not network blocking. The CfT banner is normal and was not suppressed.
- **Real IP check through the UI (2026-10-30, based on the user's screenshot).** An unauthenticated LAN HTTP proxy returned the same external IP as an independent curl request through that proxy. This does not complete authentication/incorrect-password verification on a real upstream.

## Verification limitations and manual scenarios

- **One site language (2026-10-30):** unit/UI tests confirm one editable selection and singleton validation; older profiles and backup v2 with multiple languages normalize to the first (primary) language; backup v1 remains readable. Real Playwright Chromium 149 confirmed `de-DE` and, after restart, `fr-FR` in `navigator.language`, `navigator.languages[0]`, the beginning of Accept-Language, and Preferences without disabling privacy protections. Latest full check at that checkpoint: verify 110/110 unit, integration 32/32. The CfT 156 check from the agent environment produced no page report; CfT 156 behavior in this scenario is not claimed here.
- **Proxy directory/language:** automated UI, SQLite, backup v1/v2, Electron DPAPI/IP, and real Chromium tests pass. The new build uses SQLite v2; the user's real database was not opened or migrated. This does not replace manual end-to-end acceptance.
- **Historical proxy-directory implementation verification:** the discovered `Intl.DisplayNames` failure on valid extended BCP47 codes (`en-u-ca-gregory`, `de-DE-x-test`) was fixed by falling back to the code. The 58/58 and 18/19 results mentioned in an older record were intermediate; current results are in the table above. Additional failure-injection hardening remains in `TODO.md`. Visual screenshots of the editor/directory were checked in Electron with a temporary database and do not constitute manual acceptance of the full scenario.

- **Chrome for Testing engine installation** using the UI button: **completed 2026-10-30** (see manual checks). Previously blocked by the absence of a pinned SHA-256; profile launch is also available through explicit attachment of installed Chromium.
- **Attaching installed Chromium** is unit-tested (SHA-256 pinning, rejection of replaced files, rejection of an arbitrary `.exe`); manually launching a profile through an attached engine in the Electron UI has not been performed. A DPAPI roundtrip with real `safeStorage` is verified by an Electron test: the password is encrypted on save, readable after restart, and absent as plaintext from SQLite.
- **HTTPS proxy upstream:** no automated test coverage, because a trusted test CA is required; code uses default certificate verification (`ignoreUpstreamProxyCertificate: false`). Testing against a live HTTPS proxy has not been performed.
- **Real authenticated proxy through the UI:** verified only with a local test upstream in an integration test; not checked on an external proxy.
- **External IP check through `api.ipify.org`:** performed through the UI with a real unauthenticated HTTP proxy (see above); authentication on a real upstream remains unverified. Automated tests do not contact the external service.
- **Application-close and browser-stop dialogs** (Cancel / Stop and exit): manual scenario not performed; logic is covered only by supervisor unit tests.
- **Manager crash** followed by recovery on real Chromium: covered by an integration test with injected process inventory, not by actually killing the manager process.
- **Two simultaneous profiles in the real application:** covered by a supervisor unit test; Electron smoke does not launch browsers (isolated test directory without an engine); manual two-profile verification is incomplete.
- **Backup transfer to another Windows user:** not tested; Chromium may bind cookie encryption to the account.
- **Fingerprint on CfT 156 (2026-10-30):** all fingerprint and geolocation integration checks ran on local Playwright Chromium 149. Manual testing on pinned CfT 156 (UA, Client Hints, timezone, screen, CPU/memory, Canvas/WebGL, WebRTC, Manual geolocation) has not yet been performed; fingerprint acceptance on CfT 156 remains open.

## Known limitations

- **Profile isolation is not anti-detection.** Selected fingerprint fields are implemented, but script-based overrides are distinguishable from a real browser, and complete protection against DNS/WebRTC/UDP leaks and TLS/JA3 is not claimed. The CDP debugging port is accessible to local processes while the profile runs.
- No PAC, proxy chains, or authenticated SOCKS5.
- Proxy errors result in connection failure, not DIRECT; complete protection against DNS/WebRTC/UDP leaks is nevertheless not guaranteed.
- After a manager crash, a profile is blocked until the remaining browser is closed manually; processes are not terminated automatically.
- No installer, digital signature, or auto-update.

## Final review and fixes

An independent branch review found that the engine could not be installed without a pinned hash, making profile launch unreachable. Explicit attachment of a user-installed chrome.exe was added with SHA-256 pinning and prelaunch integrity verification; CfT download still requires a pinned release. Also fixed: run-identity race in the supervisor, mandatory blocking when a journal remains, IP-check cancellation without an error, proxy reachability precheck with a 10 s timeout (instead of interrupting idle tunnels), lost username when switching to SOCKS5, literal % in proxy passwords, synchronous deletion of large directories, engine version/URL agreement validation, engine download size limit, real DPAPI roundtrip, and trusted IPC-frame validation matrix.

## Subsequent recorded verification (2026-10-31)

The post-handoff “New fingerprint” button fix is recorded in `STATUS.md`: `npm run verify` PASS (141/141 unit, typecheck, build), `npm run test:integration` PASS (37/37). The Electron regression first failed on the transparent background, then verified an opaque button background and text contrast without hover (excluding disabled-opacity), while preserving the editor close button's transparent background. This later result does not change the historical 36/36 table above or close manual acceptance.

## English-only publication (2026-10-31)

- `npm run verify`: PASS, 146/146 unit tests across 25 files, typecheck, and production build.
- `npm run test:integration`: final full rerun PASS, 37/37 across 9 files. The first run failed only when deleting a temporary Chromium LevelDB log with Windows `EBUSY` in the WebRTC scenario; a targeted rerun and then a full rerun passed without implementation changes. This cleanup intermittency remains a known test-environment limitation, not a claim that the initial run passed.
- The new repository-language tests first failed on repository Cyrillic and Russian runtime language names. They now pass, including English `Intl.DisplayNames` output and preservation of arbitrary Unicode profile input and `ru-RU` as valid locale data.
- A new-profile default regression first failed on `ru-RU` and then passed with `en-US`. Existing profile languages are retained.
- Electron smoke verifies Exodus Browser application/window identity, `lang="en"`, isolated test storage, the visible fingerprint action, and existing security/DPAPI behavior.
- Independent review exercised a pre-ready nonexistent-path probe and a fresh-appData application launch on the pinned Electron 45.1.0. The application created the legacy `Local Profiles` directory/database successfully. `app.setName('Exodus Browser')` changes display identity; the explicit userData override preserves the old storage location. Real user data was not opened. A permanent fresh-install regression test remains a follow-up.
- Independent review found no Critical or Important issues. Minor storage wording, button-label consistency, and a stale test description are tracked in `TODO.md`.
- Core documentation and all historical specs/plans were translated rather than deleted or ignored. Numeric-token audits found no missing historical numbers; historical plans retained code-fence and checkbox counts.
- English-only publication is a permanent `AGENTS.md` policy. Old history is retained locally outside normal branch publication; only the audited English root snapshot is intended for GitHub. Replacing reachable history does not guarantee deletion of GitHub's cached or otherwise retained unreachable objects.
- The user supplied `ico/` assets for inspection only. They are not integrated into the application or included in this publication snapshot.

## Supplied artwork integration (2026-10-31, subsequent local work)

- The user subsequently requested integration before any GitHub repository recreation. Source PNG/SVG artwork in `ico/` was not redrawn or modified. Runtime uses the provided square PNG for the native window/favicon and the provided PNG wordmark in the sidebar; the SVG wordmark's font dependency is avoided.
- RED: the native-window unit check failed on its missing icon argument; the UI check failed on the missing accessible wordmark image; the real Electron asset check failed on the missing wordmark before implementation.
- GREEN: `npm run verify` PASS (147/147 unit across 26 files, typecheck, production build); `npm run test:integration` PASS (38/38 across 9 files).
- The integration test compares bundled wordmark, favicon, and native-icon bytes with the supplied sources, verifies local `file:` image URLs, decodes the PNG with Electron `nativeImage`, and checks that the sidebar image fits at 1200 px and 940 px viewport widths. The unit check pins the absolute module-relative native icon path and retains renderer security settings.
- A separate isolated Electron instance was visually inspected with temporary data: the sidebar wordmark is loaded, the old letter badge is absent, and navigation remains visible. The preview was saved outside the repository under the approved OpenCode temporary directory. Real user data was not opened.
- No installer or executable-resource icon is claimed; the project does not yet package an installer. GitHub recreation and publication remain deferred, as requested.

## Compact profile UI (2026-10-31, local changes)

- `npm run verify`: PASS (230/230 unit tests, typecheck, production build).
- `npm run test:integration`: PASS (48/48 across 13 files). The built Electron test checks collapsed and expanded card controls, a long profile name at 1188 px and 940 px widths, absence of horizontal overflow, and Russian disclosure labels.
- Unit coverage checks independent disclosure, visible blocked/missing-credential warnings, unchanged Launch/Stop enablement, preservation of checked IP results across collapse, closure of the transient cookie menu, compact profile/Chromium summary, tooltip accessibility, and the editor path to fingerprint settings.
- No real profile data was used. Manual visual acceptance remains open. Themed confirmations were deferred at this checkpoint and are covered in the following verification entry.

## Extension library (2026-10-31, local changes)

- RED first: package, library, profile, IPC and UI tests failed for the expected missing behavior before each implementation step.
- Covered by unit tests: MV3 manifest validation, rejection of Manifest V2, unsafe archive entry names and nested manifests; schema migration to version 3; independent library copies; failed adds leaving no row or staging directory; in-place updates keeping the identifier; removal stripping assignments; unique/valid `extensionIds`; launch arguments and absence of a blanket `--disable-extensions`.
- Real Chromium (`tests/integration/extensions.test.ts`): an extension loads only in the profile that enables it, its storage persists across restart, an explicit update changes the loaded version at the next launch, and removal deletes the copy and the assignments.
- Acceptance with the real TimeZone Changer folder (`D:\MyProjects\TimeZoneChanger`): a library-style copy loaded in the bundled Chrome for Testing with `name: TimeZone Changer`, `version: 2.2`, and a running background worker. This checked the extension package and copy model, not the new UI buttons.
- `npm run verify`: PASS (264/264 unit, typecheck, production build).
- `npm run test:integration`: PASS (50/50 across 14 files).
- Chrome Web Store links (2026-10-31): unit tests cover link parsing (both hosts, lookalike hosts, credentials, HTTP, malformed IDs), the official download URL, CRX3 header handling and rejection of non-CRX or malformed payloads, localized name resolution, store duplicates and failed downloads leaving no row or staging directory. `tests/integration/extensions.test.ts` installs a synthetic CRX through the store path and loads it in real Chromium.
- Live acceptance: through the built Electron UI, the real Eagle link was pasted into "Add from store…". The library card showed `Eagle for Chrome`, version 3.1.28 and the Store badge, which also confirms the localized `__MSG_appName__` name was resolved. `npm run verify` PASS (278/278 unit, typecheck, build); `npm run test:integration` PASS (51/51 across 14 files). The first attempt failed with a download error because the check expected a non-empty `response.url`, which Electron's `net.fetch` does not provide; the check was removed and the acceptance repeated successfully.
- Not yet done: user acceptance through the Extensions screen and the profile checkboxes, launching a profile with a store-installed extension, and a check that a timezone extension does not conflict with the profile timezone override.

## Sidebar utility footer (2026-10-31, local changes)

- RED before implementation: unit tests failed for the missing footer, language popover, native-menu removal and exact project-link policy.
- Implemented: native menu removed with `setMenu(null)`; language, GitHub and dynamic version are in `.sidebar-footer`; language choices open upward and save only a different language; Escape returns focus to the trigger.
- Exact external-link allowlist: only `https://github.com/thejohnd0e/exodus-browser` and `https://db-ip.com/`; lookalike hosts, credentials, extra paths, query/fragment and non-HTTPS URLs are denied.
- `npm run verify`: PASS (245/245 unit, typecheck, production build).
- `npm run test:integration`: PASS (49/49 across 13 files), including footer geometry and upward popover in built Electron.
- Visual check: built Electron screenshot with the popover open reviewed in an isolated temporary profile directory.
- Not yet done: Electron check at the minimum 920 × 640 window size, keyboard-only review, and user acceptance.

## Searchable manual timezone (2026-10-31, local changes)

- RED: new unit tests failed before implementation (missing `timezones` module and no combobox). GREEN after adding `src/shared/timezones.ts` and `src/renderer/TimeZoneSelect.tsx`.
- Covered: current-date UTC offsets including DST, offline IANA list, search, pointer and keyboard selection, Escape cancellation without saving, localized empty result.
- `npm run verify`: PASS (240/240 unit tests, typecheck, production build).
- `npm run test:integration`: PASS (48/48 across 13 files).
- Not yet done: visual inspection of the dropdown in the built application.

## Sidebar wordmark crop (2026-10-31, local changes)

- The user requested approximately equal left, right, and top margins around the visible artwork after noting that the supplied PNG has more empty background on the right. The implementation uses a 264×60 px overflow-hidden viewport and the existing PNG at `455px` wide, positioned `left:-32px; top:-26px`; no source asset was edited.
- RED: the Electron regression assertion failed against the old `475px/-39px/-34px` crop and again when asserting the larger top inset; it passed with the updated dimensions and offsets.
- `npm run verify`: PASS (231/231 unit tests, typecheck, production build).
- `npm run test:integration`: PASS (48/48 across 13 files). Electron checks verify the logo viewport fits within the existing sidebar and keeps at least 250 px width at 1200 px and 940 px window widths; bundled image bytes still match the supplied asset.
- Tests use isolated temporary application storage only; no real profile data was used.

## Windows NSIS installer (2026-10-31)

- `npm run dist`: PASS on Windows 10 x64, Node.js 22.23.4, Electron 45.1.0, electron-builder 26.18.0. Output: `dist-install/ExodusBrowser-Setup-0.1.0.exe` (138,401,067 bytes) and the NSIS `.blockmap`; no update YAML is produced because auto-update is not configured. The artifacts are ignored by Git.
- Windows executable metadata reports ProductName `Exodus Browser`, ProductVersion `0.1.0`, and CompanyName `thejohnd0e`. The setup filename and bundled Exodus ICO match the configuration. `better-sqlite3`'s Windows x64 prebuild is present in `app.asar.unpacked`; Electron app-smoke integration verifies the same native prebuild loads with Electron 45.
- `npm run verify`: PASS (282/282 unit, typecheck, production build). `npm run test:integration`: PASS (51/51 across 14 files).
- NSIS packaging reports `oneClick=false` and `perMachine=false`; the installer is configured for an assisted current-user default with elevation/all-users selection and a changeable directory. Interactive wizard navigation, installed launch, Start Menu/desktop shortcut selection, and uninstall data preservation were not completed. Packaged mode intentionally ignores `LOCAL_PROFILES_DATA` and selects `%APPDATA%\Local Profiles`; perform those acceptance steps only with a disposable Windows account. The installer is unsigned and may trigger SmartScreen.

## In-app update check and release 1.1.78 (2026-10-31)

- Automated: `npm run verify` PASS (333/333 unit, typecheck, build). `npm run test:integration` PASS (57/57 across 15 files) on the fixed commit `452566c`; one run hit a known Windows `EBUSY` cleanup failure in `sessions.test.ts`, and the rerun passed without code changes.
- Live check (temporary test, not committed): a service built as version 0.1.78 checked the public GitHub release, downloaded `ExodusBrowser-Setup-1.1.78.exe` (138,699,073 bytes), and verified SHA-256 `8becbdb51272435b2c821d30e2c6876ef0dc3e903c407dd3a9f3598fbc587f7d` against `SHA256SUMS`. The check used Node `fetch`, not Electron `net.fetch`.
- Defect found by the live check and fixed before re-release: `SHA256SUMS` is served through a redirect to `objects.githubusercontent.com`. Metadata fetches did not follow allowed redirects, so the first release could not complete a download. The fix follows only allowlisted hosts and has unit tests for allowed and refused redirects. The first `v1.1.78` release (built from `45a7466`) was deleted and re-issued from `452566c`.
- Publication: repository made public; tag `v1.1.78` annotated on `452566c`; GitHub release `v1.1.78` with `ExodusBrowser-Setup-1.1.78.exe` and `SHA256SUMS`, English notes; unauthenticated `releases/latest` returns `v1.1.78`.
- Not yet verified: installing the NSIS package through the wizard, the packaged app's update button using Electron `net.fetch` with `redirect: 'manual'`, and the installer handoff on a disposable Windows account.

## Release 1.1.78 failure and fix (2026-10-31)

- Symptom reported by the user: after installing 1.1.78 the application did not start at all (silent exit, code 1), and an earlier launch showed no profiles.
- Root cause (confirmed by inspecting the published artifact): `resources/app.asar` contained a corrupted `package.json` (427 bytes starting with a fragment of `index.html`) instead of JSON. Electron could not resolve `main` and exited without a window or message. A copy of the artifact with the same corruption reproduced exit code 1 with no output.
- Contributing cause: `build.files` was unrestricted, so the whole repository (`index.html`, tests, docs, screenshots) was packed into the archive; restricting packaging to `dist/**` and `package.json` produced a valid `package.json` on every rebuild (two corrupt builds before, one valid build after).
- Guard added: `scripts/check-artifacts.mjs` reads the produced `app.asar` and `npm run dist` now fails if `package.json` is missing or invalid, if `main`/version differ, if `dist/main.cjs`, `dist/preload.cjs`, `dist/ui/index.html` or the GeoIP database are missing, or if the native `better-sqlite3` module is absent. `tests/unit/dist-artifacts.test.ts` covers the check, including the corrupted-`package.json` case.
- Data safety: the user's database was inspected read-only through copies. It contains 3 profiles (`123`, `3`, `EE`), 3 proxies and 2 extensions; nothing was deleted or migrated.
- Verified with the fixed build: `npm run verify` PASS (338 unit), `npm run test:integration` PASS (57/57), `npm run dist` PASS with "Packaged application verified: version 1.1.79, app.asar intact", and an Electron run against a copy of the real data root rendered the existing profile names.
- Still not verified: starting the packaged executable while another Exodus instance is closed, the NSIS wizard on a clean account, and the installer handoff.

## Release 1.1.79 (2026-10-31)

- Published `v1.1.79` with `ExodusBrowser-Setup-1.1.79.exe` (135,268,836 bytes) and `SHA256SUMS`; the broken `v1.1.78` release and tag were deleted at the user's request. Unauthenticated `releases/latest` returns `v1.1.79`.
- Live update check from version 1.1.78 (temporary test, not committed): the service reported `available` for 1.1.79, downloaded the installer and matched SHA-256 `3a68ac410808530f353ea0ca2ee268306e2e222ee15493f27fb8daa54cbeb2ad`.

## Release 1.1.80 (2026-10-31)

- The update status moved from a truncated inline label in the sidebar footer into a panel above the footer. Measured in Electron: content 198 px inside a 260 px panel with no clipping.
- `npm run verify` PASS (338 unit); `npm run test:integration` PASS (57/57); `npm run dist` PASS with "Packaged application verified: version 1.1.80, app.asar intact".
- Published `v1.1.80` with `ExodusBrowser-Setup-1.1.80.exe` (135,268,551 bytes) and `SHA256SUMS`; SHA-256 `bd451858b464af0da28af1ac26e8bce541d293154a6c93e180f31bdf5d6852fe`. Unauthenticated `releases/latest` returns `v1.1.80`.
- Live update check from version 1.1.79 (temporary test, not committed): `available` → downloaded → checksum matched.

## Release 1.1.81 (2026-10-31)

- The update panel is now dismissible: `Esc`, an outside click, or its close button. The "up to date" message hides itself after 6 seconds; an available update stays until the user acts. Covered by unit tests and an Electron run.
- `npm run verify` PASS (342 unit); `npm run test:integration` PASS (57/57); `npm run dist` PASS with "Packaged application verified: version 1.1.81, app.asar intact".
- Published `v1.1.81` with `ExodusBrowser-Setup-1.1.81.exe` (135,268,707 bytes) and `SHA256SUMS`; SHA-256 `f06f4197164f1bb61c16e0f5d3bd094913d57d1d0ad081a5eee624ab6fec15ff`. Unauthenticated `releases/latest` returns `v1.1.81`.
- Live update check from version 1.1.80 (temporary test, not committed): `available` → downloaded → checksum matched.

## Release 1.1.82: update download inside Electron (2026-10-31)

- Reported symptom: pressing "Download update" in 1.1.80 produced "Could not download the update".
- Root cause (measured inside the Electron main process): `net.fetch` with `redirect: 'manual'` throws "Redirect was cancelled" as soon as the server answers with a redirect, and GitHub serves `SHA256SUMS` through a redirect to `objects.githubusercontent.com`. The download therefore never started. Earlier live checks passed because they used Node's `fetch`, which honours manual redirects.
- Fix: `src/main/update/net-fetch.ts` builds a fetch-compatible adapter on `net.request`, which reports redirects as an event; the adapter returns them as an ordinary 302 response so the existing host allowlist and redirect limit still apply.
- Regression test: `tests/integration/update-net-fetch.test.ts` runs the adapter inside a real Electron process and asserts 302 → 200 with the expected `SHA256SUMS` line. `npm run verify` PASS (342 unit); `npm run test:integration` PASS (58/58).
- End-to-end inside Electron from version 1.1.81 (temporary probe): `available` for 1.1.82 → downloaded 135,269,736 bytes → SHA-256 `f1221210d7cea16fa4926fc5b49d41685dae10f877ff72227352bd94a1ef2b94`, matching the release.
- Published `v1.1.82`. Versions 1.1.78–1.1.81 cannot download updates themselves and need one manual install.






## Release 1.1.83 (2026-10-31)

- Test release to verify the in-app download flow from an installed build.
- 
pm run verify PASS (342 unit); 
pm run test:integration PASS (58/58); 
pm run dist PASS with "Packaged application verified: version 1.1.83, app.asar intact".
- Published 1.1.83 with ExodusBrowser-Setup-1.1.83.exe (135,269,832 bytes) and SHA256SUMS; SHA-256 609f58f4ee8052de5ceeb31af94f02ff083c27f77d67e508cc7ef380a9bd4398. Unauthenticated eleases/latest returns 1.1.83.
- Live update check from version 1.1.82 (temporary test, not committed): vailable → downloaded → checksum matched.
