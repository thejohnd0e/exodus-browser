# Local browser profile manager — first-version design

Status: approved by the user on 2026-10-30. Implementation has not started.

> Historical design snapshot: the status and first-version constraints below describe the original approval checkpoint. Later fingerprint/cookie decisions, the code-reuse decision, and the English-only publication policy supersede the corresponding original scope restrictions. See `STATUS.md`, `DECISIONS.md`, and `AGENTS.md` at the repository root for current requirements.

## Task and agreed requirements

Build a standalone local Windows application serving a similar purpose to Dolphin Anty. No Dolphin account, subscription, cloud, or calls to its API are required. Profiles and their data are stored on the computer. The first version needs isolated profiles with separate cookies, proxies, and settings. Browser fingerprint support will be needed later.

Isolation is not anti-detection: the first version does not hide matching hardware and browser characteristics or promise that websites cannot link profiles.

## Approaches considered

1. An Electron interface and a separate Chromium process for each profile. Recommended and accepted as the direction: independent browser lifecycles and the ability to replace the engine.
2. Embedded Electron browser windows. Easier tab integration, but tighter coupling between the manager and browser engine; less suitable for a future engine replacement to support fingerprints.

The following are technical solutions proposed by the author, not details previously agreed with the user.

## First-version scope

- A Russian-language desktop application: profile list, search, creation, editing, starting, and stopping.
- Profile card: name, note, startup URLs, browser language, and proxy.
- Each profile has its own persistent Chromium directory: cookies, localStorage, IndexedDB, cache, and other data are not shared between profiles.
- Multiple different profiles can run simultaneously; launching the same profile twice is prohibited.
- Local backups of closed profiles and restoration from backups in the application's own format. This is not Dolphin data import.
- Deleting a closed profile requires confirmation. A running profile or an arbitrary path outside application storage cannot be deleted.
- Closing the manager while browsers are running requires confirmation to stop them, followed by graceful shutdown. On the next launch, check for remaining processes and locks without automatically deleting lock files.

## Architecture

Proposal: Electron + TypeScript, React for the interface, SQLite for metadata. The database contains identifiers, settings, relative paths, and backup status; browser data lives in separate directories under the application's user data directory. The database must not store cookies or website passwords separately from the browser.

The renderer has no Node.js or direct disk or process access: contextIsolation is enabled and nodeIntegration is disabled; preload exposes a narrow typed API. The main process validates IPC and manages profiles, processes, the database, and backups. The launched browser does not open a remote debugging port unless specifically needed.

BrowserEngineAdapter abstracts the profile directory, engine availability checks, launching, graceful shutdown, and supported-capability reporting. The first adapter works with standard Chromium. Fingerprint spoofing is not implemented through stubs, injections, or random user-agent changes. A future engine will require separate research and testing.

For reproducibility, use a separate verified Chromium build from the official Chrome for Testing channel, not the Dolphin browser or the user's personal Chrome. Engine installation/download is performed only at the user's explicit request; the application shows the engine version, its absence, or an unsupported version. Profile management is available offline; browsing websites and downloading the engine require a network. The engine source, version, and checksum are pinned at distribution time. Automatic engine updates and profile migration between arbitrary versions are outside the first version's scope.

## Proxies

Proposed support: HTTP/HTTPS upstreams with optional authentication and SOCKS5 without authentication. An authenticated upstream requires a separate local proxy bridge per profile: Chromium connects to a loopback port and the bridge adds upstream authentication. Credentials are not passed on the command line or written to logs. Secrets are protected by Windows DPAPI through Electron safeStorage, not stored as plaintext in SQLite. If encrypted storage is unavailable, saving a secret is prohibited with a clear error.

The bridge binds only to loopback, is created before browser startup, and closes after the browser exits. A proxy error does not trigger an automatic direct connection. An external IP check runs only on explicit command and identifies the checking service used. A browser proxy is not a system VPN: the first version does not promise to eliminate all DNS/WebRTC/UDP leaks. Authenticated SOCKS5, PAC, and proxy chains are outside the first version's scope.

## Backups and security boundaries

Only a closed profile can be backed up, after the browser and proxy bridge have exited. Before restoration, validate the archive format, version, and paths; escaping the destination directory, links, and overwriting an existing profile are prohibited. Restoration creates a new identifier. Backups contain sensitive browser data; the application warns about this. Saved proxy passwords are excluded from backups and must be re-entered after restoration. Chromium may bind browser passwords and cookies to the Windows user; they are not guaranteed to remain usable on another computer.

Do not read or modify existing Dolphin profiles, cookies, tokens, settings, or license. Do not use its binaries, branding, or extracted code in the product. REA is used to understand the reference application's structure; our implementation is written separately.

## Outside the first version

Anti-detection and Canvas/WebGL/Audio fingerprints; cloud and synchronization; teamwork; Dolphin profile import; mobile platforms; website automation and a public API; embedded tabs; an installer, digital signing, and automatic application updates. The first deliverable is a locally runnable Windows project with launch instructions; packaging can be added as a separate stage.

## Verification criteria

1. Created profiles and settings survive manager restarts.
2. A test website's cookies, localStorage, and IndexedDB in profile A are not visible in B and persist after restarting A.
3. Two profiles run in parallel, a second launch of the same profile is blocked, and crashes are reflected in the interface.
4. Different proxies are selected independently; an authenticated HTTP proxy is verified with a local test server; an unavailable proxy does not cause a direct connection.
5. Secrets are absent from plaintext SQLite data, the command line, and diagnostic logs.
6. A closed profile's backup restores into a new profile; backing up a running profile and unsafe paths are rejected.
7. Creating, editing, and launching a profile do not depend on a Dolphin account, API, or servers.
8. Manual Windows verification and automated tests confirm IPC validation, path restrictions, and process lifecycle handling. Unverified scenarios are explicitly listed.

## REA evidence and research limitations

Reference: installed Dolphin Anty 2026.295.27762, `C:\Program Files\Dolphin Anty\resources\app.asar`, SHA-256 `a2fbc62e5f10b1fafb4a788fd923723c2e4ea85476100bc0610282cc80aa1efc`.

- `ev_671f92b8abf01fcfb9d818bdc203d3ce76ba583cb9bfade0aad31ca902765dd9`: initial inventory and package.json; discovered paths js_dist/main.js, js_dist/background.js, js_dist/preload.js, and public/splash/splash.bundle.js.
- `ev_101b868d93364102be52dafd63778c9c7bb708df6a05300c18ff79d780033620`: static analysis of package.json, main.js, and preload.js. Two JS files were parsed syntactically; semantic analysis was partial due to dynamic constructs and limits; 17 files were not selected. The application was not launched by the analysis tools.

This is not a complete reconstruction of Dolphin's architecture. Our application structure, stack selection, and adapter interface described above are design decisions, not proven properties of the original. Further complete decompilation of the original is not a dependency for the first version.

## Approval checklist

- [x] Record the agreed goals and alternatives.
- [x] Prepare the first-version design and scope boundaries.
- [x] Independently review the design for substantial gaps: the review found no blocking issues.
- [x] Obtain user approval.
- [x] After approval, prepare the implementation plan: `docs/superpowers/plans/2026-10-30-local-profile-manager.md`.
