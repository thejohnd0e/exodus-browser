# Proxy library and multiple profile languages

Status: approved by the user after an interactive mockup, 2026-10-30. The technical solutions below were proposed by the implementer; an independent design review found no substantial gaps.

## Goal and context

Avoid re-entering connections in each profile; select a saved proxy and an ordered language list from searchable dropdowns. Preserve existing profiles, browser data, and encrypted passwords.

Behavioral reference: [Dolphin's official proxy guide](https://docs.dolphin-anty.com/en/working-with-proxies/how-to-add-a-proxy-in-dolphin-anty): a separate proxy screen, adding and selecting saved proxies, and unassigning without deletion. Use only the publicly described UX; do not use Dolphin code, engine, branding, or local data.

Current state: ProfileInput contains a single `language` and an embedded `proxy`; the password is stored in profiles.secret; SQLite user_version=1; backup manifest version=1. master contains uncommitted, verified IP-check UX changes—preserve them; do not revert them.

## Approaches

1. Saved templates with connection details copied into each profile: easier migration, but editing a proxy does not update associated profiles.
2. **Agreed with the user:** a shared library, with profiles referencing proxies. Edits apply to all associated profiles on their next launch; running browsers remain unchanged.
3. Proxies in a separate external service: unnecessary infrastructure, contrary to a fully local product.

Languages: the user agreed to a searchable, reorderable list instead of one text field. The first language is primary and the others are fallbacks; automatic IP-based detection is out of scope.

## Agreed requirements

- A separate “Proxies” section: create, edit, select for a profile, and check IP.
- The profile editor offers “No proxy,” selection of a saved proxy, and “Add proxy”; connection details are edited in the library.
- The saved proxy's name is visible in the selector; passwords are absent from lists, DTOs, logs, and argv.
- Editing a proxy does not reconfigure or stop running browsers. The current record is used on the next launch.
- Multiple preferred languages, with meaningful ordering. Do not confuse website languages with Chromium interface resources.
- Behavior is confirmed in a real browser, not just in saved configuration.

## Proposed implementation and safe defaults

### 1. Storage and migration

- Shared SQLite, schema v2: a proxies table with UUID, public settings, name, createdAt/updatedAt, and a separate encrypted secret BLOB; profiles reference the UUID through a foreign key.
- Public profile input: name, note, startUrls, languages:string[], proxyId:UUID|null. The readable Profile additionally contains the associated proxy's resolved public details, including its version; the secret is not duplicated in the profile.
- Transactional v1→v2 migration: each embedded proxy becomes a separate record named after the profile; the secret BLOB is transferred unchanged without decryption. Do not automatically merge identical host:port entries: their credentials may differ. Users can consolidate any duplicates manually later.
- A single language becomes [language]. Existing UUIDs, Chromium directories, and other settings remain unchanged.
- Validate all old records before publishing the new schema; an error rolls back the entire transaction and user_version remains 1. Do not overwrite an unknown newer schema.
- Do not migrate real user data during development/tests. Acceptance requires the manager to be closed, separate approval to run against the real database, and a retained recovery option.

### 2. Library semantics

- HTTP/HTTPS with optional authentication; SOCKS5 without authentication only, as currently supported.
- IP checking is available from the library without launching a browser; the existing button in the profile card remains and uses the selected proxy.
- During start, take one consistent snapshot of connection details from the database before creating the bridge. An existing bridge continues using its snapshot even after the shared record is edited.
- Assigning/changing a profile's proxy is permitted only while the profile is stopped, as with current editing. The shared record itself may be edited while associated profiles are running; the UI explains: “Changes will apply on the next launch.”
- Delete only unassigned proxies. If there are assignments, show the profile count/names and refuse deletion; no silent unassignments or DIRECT. Deleting a profile does not delete its proxy.
- Reject a reference to a missing proxy; never interpret it as a direct connection.
- Saving/clearing/replacing a password retains fail-closed safeStorage behavior. When changing upstream/account, do not silently carry over the previous password.
- IP results are temporary; reset on a repeated check, assignment change, or proxy version change (including password). The profile version alone is no longer sufficient.
- Checking the current record does not confirm the IP of an already-running browser using an old snapshot. When these differ, explicitly state: “The saved proxy was checked; the running browser uses the previous settings until restarted.”

### 3. Languages

- languages is a nonempty ordered list of 1–20 values, each up to 64 characters. Canonicalize in main through Intl.getCanonicalLocales; reject duplicates after canonicalization with a clear error.
- A new profile defaults to [ru-RU]; an old profile retains its previous language. Do not add en or base languages to saved settings without user selection.
- A local catalog of common locales with Russian names and codes; search by name/code, add, remove, and up/down buttons with accessible labels. The last language cannot be removed.
- The catalog must not restrict existing valid custom BCP47 values: display them by code and retain the ability to add a valid code outside the catalog. The final catalog is the implementer's choice, not a promise to support all Chromium interface languages.
- Pass the first language through --lang to select the Chromium interface where matching resources exist; browser fallback is possible. For website languages, set native per-profile language Preferences before launching a stopped browser, preserving other fields and writing atomically. Confirm the exact keys with a test on the supported engine before finalizing implementation; do not use JS injections/CDP spoofing.
- Chromium may add base languages or q-weights, or reduce the exposed list through privacy mechanisms. The test checks the actual observed order and primary language through navigator.language/navigator.languages and local HTTP Accept-Language; do not invent the q-weight format. If the target version cannot apply the selected list natively, that is a blocker, not a reason to weaken protections or claim full support.
- Language changes only while the profile is stopped. Relaunching and reordering must update settings without erasing cookies/localStorage.

### 4. IPC and interface

- Add explicit proxy list/create/update/delete/check operations to the narrow preload API. Validate UUIDs and all payloads in main; retain trusted main-frame checking.
- Navigation has two sections: profiles and proxies. A separate proxy editor is reused from the library and the “Add” button in the profile editor.
- If a proxy is added from the editor, select it automatically while preserving other unsaved profile fields; cancellation does not reset the editor. A saved proxy remains in the library even if profile creation is canceled.
- Search the library by name/address; show type, host:port, and associated profile count, not the password. Check success and failure are distinguishable; the HTTP/external-service warning remains visible.

### 5. Backups and compatibility

- New archives: manifest v2, the complete languages list, and a snapshot of the selected proxy's public connection details with its name, but without the local proxyId or password. Do not transfer global IDs between installations.
- Retain manifest v1 reading: language→[language], embedded proxy→new library record without a password. Also restore manifest v2 into a new profile and, if needed, a new proxy; do not associate by matching host:port.
- Coordinate proxy record creation and restored profile creation transactionally with directory publication; on failure, leave neither a visible partial profile nor an orphaned proxy record. Retain current BackupService limits and safe extraction.
- Old builds need not read v2, but must reject a newer schema without modifying data. Document the compatibility boundary.

## Out of scope

Anti-detection, automatic geolocation-based language, Dolphin import, PAC/chains, SOCKS5-auth, IP rotation via a link, bulk proxy import, cloud, suppressing the CfT banner, automatic browser updates. Do not remove unfinished P0 checks or incorporate them into this task.

## Acceptance and tests

- Unit: canonical locales/order/duplicates/empty list, proxy CRUD/secret/references, transactional migration and rollback, no DIRECT when a record is missing.
- Migration fixtures: no proxy, password present, identical addresses with different secrets, an uncommon valid locale, a corrupted record; restarting does not duplicate the library.
- Runtime: two profiles on one proxy; editing the shared record does not change the old bridge; a new launch receives new parameters; an in-use proxy cannot be deleted.
- Real Chromium: different lists in two profiles, HTTP/JS observations, reordering, restart, preservation of other data. Without a test browser, honestly report BLOCKED.
- UI/Electron: language search/selection/order; adding and selecting a proxy, cancellation without losing the form, locks, errors, IP invalidation after a shared-record change.
- Backup: v1 and v2, languages/connection details without the secret, new UUID, rollback on failure; existing archive security tests.
- Final checks: npm run verify and npm run test:integration, independent review, update STATUS/DECISIONS/TODO/README/verification. Commits and real data require approval.

## Left to the implementer

Names of helper modules and UI components, the specific locale catalog and accessibility labels; native Preferences keys after confirmation in real Chromium. Do not change user requirements or security invariants to simplify tests.
