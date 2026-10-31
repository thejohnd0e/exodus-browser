# Extension library design (first version)

Status: proposed, awaiting approval. Implementation follows only after approval, through a separate plan.

## Intent

Users install a browser extension once in Exodus, then choose which profiles use it. They should not search for and install the same extension in every profile. Each profile keeps its own extension settings, sign-ins and storage.

## Goals

- A library of extensions that is managed in one place.
- Each profile has its own set of enabled extensions.
- Add an extension from a local unpacked folder or a ZIP archive.
- An extension in the library is an independent copy. Changes in the original source folder do not affect installed copies.
- Updating an extension is explicit and takes effect at the next launch of a profile.
- Extension settings, cookies and site data stay separate per profile.

## Non-goals (first version)

- Adding from the Chrome Web Store (deferred; the store install confirmation is a native browser dialog and cannot be completed programmatically; see the spike result).
- Automatic updates, cloud sync or sharing extensions between computers.
- Developer mode that loads the source folder live.
- Editing an extension's own settings from Exodus.
- Forced closing of running browsers to apply changes.

## Constraints

- The engine is Chrome for Testing 156 pinned by the release (decision #31).
- Loading works through Chromium arguments (`--load-extension`, `--disable-extensions-except`). The spike confirmed that the TimeZone Changer folder loads and runs its background script. Our launcher must not add `--disable-extensions`.
- An unpacked extension's ID is derived from its installed path. The library location for each extension must therefore stay fixed, so the ID and per-profile extension storage stay stable across updates.
- Input validation follows the existing archive rules: entry-count, size and duplicate limits, and rejection of unsafe paths and links (`src/main/backups/archive.ts`).
- The renderer receives no file paths and performs no file access; file dialogs run in main (existing rule).
- Russian text appears only in translation catalogs (repository rule).
- Settings and secrets are never logged.

## Approaches

1. **Selected: copy into the library and load unpacked per profile.** Each library entry is a validated copy under the application data directory. Launch passes the enabled entries to Chromium. Stable paths give stable IDs and keep profile storage isolated. Trade-off: duplicate disk use; reinstallation or removal is explicit.
2. **Rejected: load directly from the user's source folder.** Makes development convenient but lets an accidental change affect every profile at the next launch. The user chose copies instead.
3. **Rejected: install into each profile's own extension directory.** Duplicates the management problem this feature solves and loses central control.

## Data model

- Library: id, display name, version, source kind (folder or ZIP), name of the installed copy directory, file hash of the manifest, added date.
- Assignment: profile id, library id, enabled flag.
- Stored in SQLite through a new schema version with a migration. Removing a library entry that is still assigned requires confirmation and then removes the assignments. Profile deletion removes its assignments.
- Copies live in `%APPDATA%\Local Profiles\extensions\<library id>\`.

## Behavior

- **Add:** the user chooses a folder or ZIP through a native dialog in main. Exodus validates `manifest.json` (required, manifest version 3, no unsupported permissions that break the core flow), copies the files, and adds an entry. The original path is not stored in the renderer.
- **Assign:** each profile editor has an extension section with checkboxes from the library. Changes are saved with the profile.
- **Apply:** enabled extensions are passed when the profile launches. Changes made while the profile runs apply at its next launch; the running browser is not restarted automatically.
- **Update:** the user selects a new folder or ZIP for an existing library entry. Exodus validates and replaces the copy atomically; the ID stays the same. Profiles pick up the new version at their next launch.
- **Remove from profile** only changes that profile's assignment. **Remove from library** affects every profile and requires explicit confirmation.
- **Timezone extensions:** if an enabled extension named or detected as a timezone changer is assigned to a profile whose Timezone mode is not Manual, show a non-blocking warning. Do not disable anything automatically.

## Errors and safety

- Invalid or unsafe archives are rejected with a localized, value-free error.
- A missing copy directory blocks launch of that profile with a clear message, without deleting assignments.
- No proxy or fingerprint behavior changes.

## Testing approach

- Unit tests: validation of manifests and archives, library and assignment repository operations, migration, argument building for enabled extensions, and the renderer assignment UI.
- Integration tests with real Chromium: a folder extension loads in a profile, is absent in a profile that does not enable it, keeps its own storage per profile across restart, and an update changes the loaded version at next launch.
- Acceptance with the real TimeZone Changer folder and an invalid package.

## Open questions

None blocking. Settled as the author's decisions:
- Maximum library size: no limit in version one; the existing archive limits apply to each package.
- Store links and automatic updates: deferred to a later decision.
