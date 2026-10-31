# Decisions and trade-offs

Decision log for the first version. Each entry records the decision, its rationale, and the risk if it proves wrong. Specification: `docs/superpowers/specs/2026-10-30-local-profile-manager-design.md`; architecture: `docs/architecture.md`.

## Product

### 1. Separate Chromium instead of embedded Electron windows
**Decision:** each profile is a separate Chromium process with its own `--user-data-dir`.
**Rationale:** independent lifecycle, genuine storage isolation, and the ability to replace the engine later for fingerprinting work.
**Cost of being wrong:** two windows instead of tabs; profile-state integration is more complex than with embedded views.

### 2. No anti-detection in the first version
**Decision:** do not pretend to spoof fingerprints; warn the user explicitly.
**Rationale:** an honest capability boundary; placeholders would create a false sense of protection.
**Cost of being wrong:** users expecting anti-detection receive only isolation; this is known in advance and stated in the UI and README.

### 3. Local data without accounts or cloud
**Decision:** SQLite and profile directories under `%APPDATA%\Local Profiles`; no requests to Dolphin.
**Rationale:** agreed requirement; lack of network access does not prevent profile management.
**Cost of being wrong:** no synchronization between computers; transfer requires a manual profile backup.

## Security and trust

### 4. Engine: attach installed Chromium instead of using a fake hash
**Decision:** the user explicitly selects `chrome.exe`; the application pins SHA-256 and checks it before every launch. Chrome for Testing downloads are prohibited until a release is pinned in `src/main/engines/releases.json`.
**Rationale:** CfT has no independent checksum that can be trusted automatically. A maintainer-pinned hash identifies a particular archive for subsequent downloads but does not prove the provenance of the initial copy: it trusts TLS to Google's official server. For manual attachment, responsibility for the selected file's provenance lies with the user.
**Cost of being wrong:** the user can attach a malicious `chrome.exe` by selecting it; the application only checks that the file remains unchanged after attachment.

**Addendum, 2026-10-30:** CfT 156.0.8078.80 was pinned and installed through the UI; the Stable channel and win64 URL were confirmed by the official `last-known-good-versions-with-downloads.json`. Checks and SHA-256: `docs/verification.md`.

### 5. Secrets only through safeStorage, fail-closed
**Decision:** if OS encryption is unavailable, the password is not saved and the operation fails.
**Rationale:** rejection is clearer and safer than plaintext storage.
**Cost of being wrong:** authenticated proxies cannot be saved on a system with DPAPI disabled; profiles can still be used without a password or with a direct connection.

### 6. Proxy errors do not result in DIRECT
**Decision:** loopback bridge without fallback; an unavailable proxy is a launch error.
**Rationale:** a hidden direct connection would violate user expectations and expose the real IP.
**Cost of being wrong:** the profile does not launch during proxy failure; the user sees a message.

### 7. Recovery does not kill processes
**Decision:** if a browser may remain, the profile is blocked until it is closed manually; unrelated PIDs are not terminated.
**Rationale:** PIDs can be reused; automatic killing with incomplete information is more dangerous than blocking.
**Cost of being wrong:** after a crash, the browser window must be closed manually and the manager restarted; there is no automatic recovery.

## Data and compatibility

### 8. UUID directories instead of profile names
**Decision:** profile path is `<root>/profiles/<uuid>`.
**Rationale:** prevents collisions, path traversal, and leakage of names into the filesystem.
**Cost of being wrong:** directories are not human-readable; lookup is through the UI only.

### 9. Proxy passwords are excluded from backups
**Decision:** re-enter the password after restoration.
**Rationale:** DPAPI encryption is bound to a Windows account; including secrets in an archive would falsely promise portability and increase the exposure surface.
**Cost of being wrong:** a restored profile with an authenticated proxy requires manual password entry.

### 10. Restore only into a new profile
**Decision:** restoration creates a new UUID; overwriting an existing profile is prohibited.
**Rationale:** prevents partial data loss and conflicts between two cookie sets.
**Cost of being wrong:** an existing profile cannot be rolled back in place; it must be deleted separately.

### 11. IP checking only on request and over HTTP
**Decision:** fixed service `api.ipify.org`, bounded and validated response; no automatic invocation.
**Rationale:** avoids background network requests; the user starts the check with a button and a visible service/HTTP warning, without additional confirmation (UX clarification of 2026-10-30).
**Cost of being wrong:** an on-path observer can alter the response; this is disclosed next to the button. HTTPS is not implemented because of CONNECT+TLS complexity.

### 14. IP-check results belong to the card
**Decision:** success appears in the checked profile's card without a URL or global warning banner; errors remain separate messages. The result exists only in memory and is valid for the profile version (`updatedAt`) that was checked.
**Rationale:** the result cannot be confused with an error or another profile; changing the proxy, including its password, does not leave an old IP displayed as current.
**Cost of being wrong:** even renaming a profile clears the result. The CfT banner remains unchanged — no test modes or warning suppression are used for cosmetic reasons.

## Development process

### 15. Shared proxy directory and site language (2026-10-30)
**Decision:** a profile stores `proxyId` and one selected `languages` code; a separate proxy entry can be used by multiple profiles. Shared-entry changes apply at the next launch; an active bridge retains its snapshot. Deleting a referenced entry is prohibited; a missing proxy does not imply DIRECT.
**Rationale:** avoid entering the same credentials in every profile; select site languages through search. The initial list mockup was simplified to a single selectable language at the user's request.
**Cost of being wrong:** SQLite schema v2 is incompatible with older builds; back up user data before a real migration. Migration is transactional; passwords transfer as BLOBs without decryption/merging. Archive v2 stores a connection snapshot without ID/password; v1 remains readable.
**Diagnostics, 2026-10-30:** Chromium reduces the list through `ReduceAcceptLanguageHTTP` and `ReduceAcceptLanguageCount`. On test Playwright Chromium 149, temporary `--disable-features=ReduceAcceptLanguage,reduce-accept-language,ReduceAcceptLanguageHTTP,ReduceAcceptLanguageCount,reduce-accept-language-http` allowed the browser test to see both languages in JS and HTTP (19/19 integration).
**Product decision:** do not disable reduction; the user preferred to retain privacy. Instead of a language list, the UI selects one BCP47 code; it affects `navigator.language` and HTTP language priority, but the application does not promise to expose additional languages to sites. CfT 156 and manual application acceptance have not yet been verified. See STATUS and verification for details.

### 12. Inline plan execution + one independent review
**Decision:** tasks were executed in the current session using TDD, followed by a fresh reviewer.
**Rationale:** cheaper than a separate agent for each task while retaining independent review.
**Cost of being wrong:** fewer independent eyes on intermediate steps; defects discovered later were fixed in one pass.

### 13. Download npm dependencies through a temporary local relay
**Decision:** because Node HTTPS requests to the registry timed out, a loopback relay over system `curl` was used; the lockfile was then normalized to `registry.npmjs.org`.
**Rationale:** TLS verification remained enabled and global npm configuration was not changed.
**Cost of being wrong:** the relay is not in the repository and is needed only for reinstallation on this network; `npm ci` works directly on an ordinary network.

## Final review: fixes

An independent branch review found a critical issue: without a pinned hash, the engine could not be installed, making profile launch unreachable. Fixes:

| Finding | Fix |
|---|---|
| Engine unreachable | Attach installed Chromium + pin SHA-256; download remains fail-closed |
| Old-run completion race | Compare run identity before changing state and removing the journal |
| IP-check cancellation treated as an error | Cancellation returns `null`, without a red banner |
| Idle timeout broke tunnels | Removed; added upstream TCP reachability check with a 10 s timeout |
| HTTP → SOCKS5 switching broken | Username and password are not sent for SOCKS5 |
| Literal `%` in passwords corrupted | Escape `%` before passing it upstream |
| Synchronous deletion blocked the UI | Asynchronous deletion after renaming to trash |
| Launch journal not read | Journal presence blocks the profile during recovery |
| No engine version/URL validation | URL must match the version; 500 MB download limit |
| DPAPI not genuinely verified | Electron test: save, restart, decrypt, verify absence of plaintext |
| Trusted-frame predicate untested | Extracted to `trust.ts`, covered by a test matrix |
| No lease/port tests | Added bridge-close tests on failure/exit and separate-port tests |
| Integration tests could use a stale build | `test:integration` builds the project first |

## Deliberately deferred

- Forced browser termination after `STOP_TIMEOUT` — risk of killing the wrong process.
- Excluding cache from backups — would reduce size but change the “full data copy” promise.
- Engine-download and copying progress indicators — convenience, not correctness.
- Separate archive cleanup error codes — diagnostics, not security.
- HTTPS IP checking — requires CONNECT+TLS and a separate trusted-CA test.

## Anti-detection: fingerprint, geolocation, cookies (2026-10-30)

### 16. Fingerprint: CDP for native parameters and an injected script for JS
**Decision:** User-Agent is passed with `--user-agent`; Client Hints/platform use `Network.setUserAgentOverride`; timezone uses `Emulation.setTimezoneOverride`; Canvas, WebGL, WebGPU, ClientRects, Audio, cores, memory, and `screen.*` use a single script executed before the first document in all frames. The noise seed is `sha256(profileId)`, making noise stable within a profile and different between profiles.
**Rationale:** native parameters are indistinguishable from those of an ordinary browser, while the script covers everything without a direct CDP API; a single bundle is easier to verify on real Chromium.
**Cost of being wrong:** script-based overrides are inherently distinguishable from a real browser (even with `Function.prototype.toString` preserved); the application does not claim protection against network/TLS fingerprinting. User-Agent is passed with `--user-agent`, so any local process can see it in the process command line — an intentional trade-off to give popups their UA before the first navigation; other fingerprint values do not enter argv.

### 17. Residual debugging-port risk
**Decision:** CDP listens only on `127.0.0.1` on an ephemeral port; its URL is not logged; the session lasts exactly as long as the browser; the client checks host and port against values parsed from Chromium stderr.
**Rationale:** alternatives (pipe or extension) substantially complicate launch and verification.
**Cost of being wrong:** while a profile runs, a local process belonging to the same user can connect to the port and control that browser.

### 18. Screen uses real window size; DPR is not overridden
**Decision:** manual screen settings specify `--window-size` and `screen.*`/`outer*`; `Emulation.setDeviceMetricsOverride` is not used, and DPR stays real.
**Rationale:** a fake viewport that does not fit the physical monitor is itself a signal, and DPR cannot be made consistent without scaling.
**Cost of being wrong:** window resolution is limited by the physical monitor; a large fingerprint value on a small screen appears as a reduced-size window.

### 19. WebRTC Off differs from Disable UDP
**Decision:** Real — unchanged; Disable UDP — only `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`; Altered — that flag plus private-IP rewriting in SDP; Off — that flag plus removal of `RTCPeerConnection`.
**Rationale:** Disable UDP preserves media sites; Off provides maximum isolation but breaks the API; the user sees a warning in the card.
**Cost of being wrong:** Off is detectable by checking API presence and breaks some media sites.

### 20. Fingerprint storage and backup v3
**Decision:** `fingerprint` is an optional field in profile JSON; SQLite remains schema v2, old records load with `DEFAULT_FINGERPRINT` and are not rewritten. New archives write manifest v3 with the fingerprint; v1/v2 restore with defaults. Proxy passwords remain excluded from archives.
**Rationale:** no user-database migration is needed, and old backups remain readable.
**Cost of being wrong:** old backups lack a fingerprint, so a restored profile looks like the system; this is expected and disclosed.

### 21. Geolocation: Manual through CDP, Auto without override
**Decision:** Manual uses session-scoped `Browser.grantPermissions` and `Emulation.setGeolocationOverride` for each target; Auto uses the normal permission prompt without an override. Coordinates are not inferred from proxy IP.
**Rationale:** IP geolocation requires an external service and creates inconsistencies; manual coordinates are verifiable and local.
**Cost of being wrong:** Auto can reveal the user's real location; the UI exposes this through the mode selection.

### 22. Cookies through a temporary network-isolated headless session (2026-10-31)
**Decision:** import/export operates on a stopped profile: the file is read and normalized in main, then an exclusive lock protects a `--headless=new` Chromium using the same `user-data-dir`, but with a dead loopback proxy (`127.0.0.1:9`), `--host-resolver-rules=MAP * ~NOTFOUND`, `--disable-background-networking`, and no navigation. Cookies are set/read through CDP, and the browser closes normally.
**Rationale:** writing directly to the encrypted cookie database is impossible without a custom addon; the profile proxy may be unavailable, and import must not depend on it; the dead loopback proxy and DNS blocking ensure that the temporary browser does not leak the real IP.
**Cost of being wrong:** the guarantee relies on Chromium flags, not network hardware; if the manager is killed during import, the headless process may outlive it — the next operation reports `ORPHAN_BROWSER`, and the process can be closed in Task Manager. Partitioned (CHIPS) cookies are unsupported.

**Implementation-review clarification:** engine executable existence is checked before launch; the entire `withStopped` section, including temporary Chromium startup, is tracked for `closeAll()` during exit. Supported cookie expiry is capped at the year 2100. Real execution without network requests and preservation of httpOnly/session cookies are verified by integration tests on local Chromium; actual Electron dialogs require manual acceptance.

### 23. Exodus Browser branding and English-only publication (2026-10-31)
**Decision:** use Exodus Browser as display branding and English for all tracked material, UI copy, comments, test names/fixtures, documentation, commit messages, and GitHub metadata. Chat may remain in Russian; Russian text must never be published. Keep arbitrary user input and valid BCP47 codes such as `ru-RU` supported. Preserve legacy `%APPDATA%\Local Profiles` paths and Electron `app.setName` compatibility unless a separate migration is approved. Save prior history locally, then replace remote `master` with one English root commit, as authorized by the user; this entry records the plan, not its execution.
**Rationale:** the user explicitly requires no Russian on GitHub and approved English UI copy and history cleanup. Display renaming must not silently move or lose existing data.
**Cost of being wrong:** replacing remote history changes commit identities and requires coordination with existing clones; local history retention is necessary for recovery. Changing compatibility identifiers without migration could make existing profiles appear missing.

### 24. Bundle the supplied PNG artwork for native and renderer branding (2026-10-31)
**Decision:** use the owner's unchanged `ico/exodus-icon.png` for the native Electron window and document favicon, and `ico/exodus-wordmark.png` for the sidebar. The main-process esbuild file loader emits a module-relative `dist/assets/exodus-icon.png`; Vite emits renderer asset URLs. Keep original SVG sources available, but use the supplied raster wordmark at runtime because its SVG variant relies on installed fonts.
**Rationale:** use the approved artwork without redrawing it, adding dependencies, relying on source-directory paths, or loosening CSP. Tests verify the native window's icon argument, actual PNG decoding in Electron, exact built/source asset bytes, and sidebar fit at normal/narrow widths.
**Cost of being wrong:** future installer/shortcut/executable packaging still needs its own Windows icon resources; this runtime integration does not rebrand the Electron executable itself. Future main-process artwork with duplicate basenames would require revisiting the fixed asset naming convention.

### 25. Opt-in URL-only session restoration (2026-10-31)
**Decision:** save only the ordered URLs of eligible HTTP(S) and `about:blank` tabs; do not save browsing history, form state, or cookies separately. Restoration is per profile and defaults off. A persistent random uint32 fingerprint seed keeps script-based fingerprint noise stable across profile renames/backup transfer; older records derive the existing deterministic seed. Backup manifest v4 carries the preference, seed, and optional tab snapshot; v1–v3 remain readable.
**Rationale:** explicit opt-in limits surprise and privacy impact; URL-only restore is bounded and avoids claiming to restore transient browser state. A random stored seed avoids deriving fingerprint identity directly from a portable profile UUID.
**Cost of being wrong:** users who expect form/session state need to sign in or refill forms; a copied v4 archive reproduces the fingerprint noise seed on the destination machine.
