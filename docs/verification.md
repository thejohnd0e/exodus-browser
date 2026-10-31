# First-version verification

Date: 2026-10-30. Machine: Windows (x64), Node.js 22.23.4, npm 10.9.9, Electron 45.1.0; Chromium for integration tests is a local Playwright build (`ms-playwright/chromium-1228`, Chrome 149.0.7827.55). The application's Chrome for Testing 156.0.8078.80 engine **was installed through the UI on 2026-10-30** after the release was pinned (see below).

## Automated checks

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
