# In-app update check and installer download — design

Status: approved by the user on 2026-10-31 with the proposed defaults below. Nothing here is implemented or published yet. Making the repository public is a separate, explicit action that still needs its own confirmation.

## Intent

A user clicks the version label in the sidebar footer. Exodus checks GitHub Releases for a newer installer. If one exists, Exodus downloads it, verifies it, and offers to run it. The user stays in control: no silent installation and no background polling.

## Goals

- Manual check from the version label only.
- Download the newer NSIS installer with visible progress and cancellation.
- Verify the download (size limit, file name, SHA-256 from the release) before offering installation.
- Installation requires an explicit click and runs the normal installer, which keeps `%APPDATA%\Local Profiles` intact.
- Installation is blocked while any profile browser or maintenance operation is running. Browsers are never closed forcibly.

## Non-goals

- Automatic or background update checks.
- Silent installation, delta updates, or rollback to older versions.
- Engine (Chrome for Testing) updates. These stay tied to Exodus releases (DECISIONS #31).
- Code signing. The installer remains unsigned in this stage.
- Updates for linked external Chromium installations.

## Anti-goals

- No token, credential, or private endpoint in the client.
- No Russian text in release assets, release notes, or metadata (AGENTS.md publication policy).
- No trust in a download beyond its checksum from the same release.

## Constraints

- The repository `thejohnd0e/exodus-browser` must become public so that unauthenticated clients can read release assets. This is an explicit, separate user action; it exposes all tracked source permanently through clones and forks.
- The app is unsigned. Windows SmartScreen may warn on the downloaded installer. The checksum only proves that the file matches the release; it does not prove the release is authentic if the GitHub account is compromised.
- Existing `npm run dist` already produces `dist-install/ExodusBrowser-Setup-<version>.exe` and `latest.yml`. The `latest.yml` file is not used by this design.
- The current displayed version is the local build counter `0.1.N` (`docs/development.md`). It is unique only within one checkout, so it cannot identify public releases on its own.
- Renderer isolation rules apply: all network and file work stays in the main process, through the existing allowlisted IPC.

## Approaches

1. **electron-updater with GitHub provider.** Mature and handles downloads, but it expects signed or configured publishing, runs checks on startup by default, and its flow is harder to restrict to a manual click. Rejected for the first version.
2. **Custom main-process updater using the GitHub Releases API (selected).** The main process calls `api.github.com/repos/thejohnd0e/exodus-browser/releases/latest` only when the user clicks the version. It reads a `SHA256SUMS` asset, streams the installer over HTTPS into a staging directory, and verifies it. Full control over trust checks, the manual trigger, and the installation gate. Cost: more code to write and test.
3. **Open the releases page in the browser.** No network code in the app, but the user downloads manually. This does not meet the stated goal.

Selected: approach 2.

## Design

### Version identity

- Release builds use the semantic version from `package.json`, and the title and footer show that value. The first public release is `1.1.78` (chosen by the user; the number matches the last development build counter, `0.1.78`). Development builds keep the `0.1.N` counter, which is never compared with release versions.
- Release tags are `v<semver>`. Release assets: `ExodusBrowser-Setup-<semver>.exe` and `SHA256SUMS` (one line in standard `sha256sum` format).

### Update check (main process, `src/main/update/`)

- Trigger: an explicit IPC call from the version label. No timers, no startup check.
- Request: HTTPS `GET` to the fixed GitHub API URL, timeout 10 s, response limited to 64 KiB, `Accept: application/vnd.github+json`, no cookies, no credentials.
- Parsing: `tag_name` must match `^v\d+\.\d+\.\d+$`; the asset list must contain exactly one installer with the expected name and one `SHA256SUMS`.
- Comparison: strict semantic-version comparison. Only a strictly newer version is offered.
- Results: `up-to-date`, `available{version, size}`, or a localized error code. No release notes are rendered from remote text in this version.

### Download and verification

- Only the asset URLs returned for that release are used. Redirects are followed only to `github.com` and `*.githubusercontent.com` over HTTPS.
- Size limit: 300 MB, enforced while streaming. Timeout: 60 s idle.
- Staging: `<userData>/updates/<version>/…partial`, renamed only after successful verification.
- The SHA-256 of the streamed bytes must equal the entry in `SHA256SUMS`. A mismatch deletes the file and reports an error.
- Concurrency: one download at a time; a new check while downloading is rejected.

### Installation

- The renderer shows "Install and restart" only after verification succeeds.
- Main process checks that no profile is running or in maintenance. If any is active, it returns a localized error and does not start the installer.
- Installation launches the verified installer as an ordinary child process with its normal wizard, then quits Exodus through the existing shutdown path.
- Downloaded installers remain in `updates/` until the next successful check; old versions are removed then.

### UI

- The footer version label becomes a button with an accessible name. States: idle, checking, up to date, update available (size, "Download"), downloading (progress, Cancel), ready ("Install and restart"), and errors.
- All strings are added to the EN and RU catalogs. Product name and version remain unchanged.

### Errors

Localized codes such as `UPDATE_CHECK_FAILED`, `UPDATE_NETWORK`, `UPDATE_INVALID_RELEASE`, `UPDATE_CHECKSUM_MISMATCH`, `UPDATE_TOO_LARGE`, `UPDATE_BUSY_PROFILES`. Messages never include URLs with tokens, file contents, or profile data.

### Release process

1. `npm run verify` and `npm run test:integration` pass on the release commit.
2. `npm run dist` builds the installer with the release version from `package.json`.
3. Compute SHA-256 of the installer and write `SHA256SUMS`.
4. Tag `v<semver>` and create a GitHub release with `gh release create`, English notes only.
5. Verify the public download path from a clean machine or disposable account before announcing it.

## Testing (TDD)

- Unit: version parsing and comparison; release JSON validation; redirect host allowlist; size limit; checksum match and mismatch; cancellation cleanup; busy-profile gate; error code mapping.
- Integration: a loopback fake GitHub server injected through a test-only base-URL option, covering up-to-date, available, checksum mismatch, oversize, and interrupted download. Requires no real network.
- Electron smoke: the version label opens the update state and performs no request without a click.
- Manual: check and download a real public release in a disposable Windows account; run the wizard; keep `%APPDATA%\Local Profiles` intact.

## Decisions

1. Repository visibility: `thejohnd0e/exodus-browser` must be made public for this option. **Pending separate explicit confirmation; not yet done.**
2. Version scheme: semantic release versions from `package.json`, first release `1.1.78` (user decision, 2026-10-31).
3. Installation: interactive installer wizard, not silent `/S` (approved default).
4. Unsigned releases and SmartScreen warnings are accepted for now; signing is later work (approved default).

## Left to the builder

- Exact module names, IPC channel names, and progress event shape, following existing patterns in `src/main/ipc.ts` and `src/preload/index.ts`.
- Whether the staging directory lives under `userData` or the existing app root.
