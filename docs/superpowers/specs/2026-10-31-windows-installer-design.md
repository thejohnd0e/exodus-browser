# Windows installer (electron-builder + NSIS) — design

Status: approved direction (electron-builder + NSIS). This document records the agreed design; implementation follows after a plan.

## Intent

Ship Exodus Browser as a standard Windows installer: an NSIS setup wizard that lets the user choose the installation folder, installing per user by default and offering Program Files (all users) to administrators.

## Goals

- `npm run dist` produces `ExodusBrowser-Setup-<version>.exe` from the existing production build.
- Standard wizard: welcome, directory selection, install progress, finish page with an optional "Run Exodus Browser".
- Default target `%LOCALAPPDATA%\Programs\Exodus Browser` without elevation; administrators may install machine-wide (Program Files).
- Start Menu shortcut; desktop shortcut is optional on the wizard. Uninstaller via Windows "Apps & features".
- The app icon and product name in the installer match Exodus branding.
- Existing behavior is unchanged: user data stays in `%APPDATA%\Local Profiles`, the engine is downloaded after first launch, and no auto-update is added.

## Non-goals

- Code signing (none available yet; SmartScreen will warn — documented, not worked around).
- Bundling Chromium into the installer.
- Auto-update channels, delta updates, or a portable build.
- Windows ARM, x86 builds, or other platforms.

## Approaches

1. **Selected: electron-builder with NSIS target.** The standard for Electron apps; gives the assisted wizard, directory page, per-user/per-machine choice through NSIS multi-user behavior, shortcuts and uninstaller with minimal custom scripting.
2. **Rejected: WiX/MSI.** Heavier tooling and effectively per-machine only; no benefit for this product today.
3. **Rejected: Squirrel/Inno.** Squirrel cannot offer a directory choice; Inno would need hand-written scripts duplicating what NSIS gives for free.

## Decisions

- Config lives in `package.json` under `build` (electron-builder convention) plus a new npm script `dist` = `electron-builder --win nsis`.
- electron-builder is a devDependency only; it must not affect the runtime bundle.
- NSIS options: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `allowElevation: true`, `createDesktopShortcut: 'allow'` (user checkbox), Start Menu shortcut created.
- Uninstaller must not delete `%APPDATA%\Local Profiles` (user data and downloaded engine survive uninstall/reinstall).
- Artifacts are written to `dist-install/` so they never mix with the app bundle in `dist/`; the directory is git-ignored.
- An `.ico` (256 px) is generated from `ico/exodus-icon.png` once and committed, so builds are reproducible without extra tooling.
- Native module `better-sqlite3` is unpacked from the asar so the installed app can load it.
- Installer language: English. Product name "Exodus Browser", publisher "thejohnd0e".
- Version: the npm package version (0.1.x). The local build counter stays untouched.

## Verification plan

- `npm run dist` exits 0 and writes the setup exe plus its NSIS blockmap. No update YAML is emitted because publishing and auto-update are out of scope.
- Install per user into the default directory; app launches from the finish page and from the Start Menu shortcut; the installed app creates and uses `%APPDATA%\Local Profiles` (verified with a temp override first).
- Install machine-wide as administrator into Program Files; same checks.
- Repair/modify is not required; uninstall removes program files and shortcuts but leaves user data intact.
- Installer properties: product name, version, publisher, and icon are correct in Add/Remove Programs.
- All automated suites (`npm run verify`, `npm run test:integration`) still pass; installer artifacts stay out of Git.
