# Profile Portability and Usability Design

## Status and intent

Planning only. The user requested a plan for six features and authorized proceeding with explicitly stated recommended assumptions. These are proposed implementation choices, not separately approved product decisions. No application changes or data migrations are authorized by this document alone.

Deliver independent increments for profile export/import, optional tab restoration, explicit cookie clearing, extensible EN/RU localization, country flags beside checked proxy IPs, and an increasing version beside the application branding.

## Existing constraints

- Windows, Electron 45, TypeScript, React 19, SQLite, and the existing CDP engine adapter remain in use.
- Preserve legacy storage locations, existing data, renderer isolation, engine checksum verification, proxy fail-closed behavior, and lifecycle ownership checks.
- Documentation, comments, tests, and GitHub metadata remain English. Product translation catalogs are user-facing data and may contain Russian; this does not change the publication language of project materials.
- Test-first implementation; run `npm run verify` and `npm run test:integration` after each increment. Use isolated storage only; real data requires separate approval and backup.
- Keep existing ZIP backups readable and preserve their documented limitations. Do not replace backups with a less complete format.

## Approaches and recommendation

1. Relabel current backup/restore: cheapest, but does not solve DPAPI-bound cookies or make cross-computer login transfer dependable. Rejected as the sole solution.
2. Extend the existing services with a separate portable ZIP format, application-managed tab URL snapshots, typed local translation catalogs, offline country data, and build-generated version metadata. Recommended: reuse security boundaries without adding background services.
3. Depend on native Chromium session restoration and online geolocation: less application code, but restores pages before the current fingerprint initialization and introduces more network/privacy dependencies. Not recommended.

The recommended approach is a planning assumption following the user's instruction to proceed without more questions. The six increments can be reviewed and shipped separately; portable export follows the tab-settings work to avoid successive archive changes.

## 1. Tab restoration

Per-profile `restoreLastSession:boolean`, default `false` for new and historical profiles. Off opens configured start URLs. On opens the most recently saved eligible tab URLs, in tab order; if no eligible snapshot exists, use start URLs. Never append both sets.

This restores tab URLs, not full Chromium session history, POST bodies, unsaved forms, scroll positions, or arbitrary browser windows. Accept only existing safe startup URL schemes: HTTP(S) without credentials and `about:blank`. Limit snapshots to 100 tabs and 8192 characters per URL. Ignore internal/devtools/extension and private browsing targets. Missing or invalid snapshots fall back safely; no automatic native crash/session restore.

Track targets while running, debounce persistence by 1 second, flush before an intentional stop, and keep the last successfully persisted snapshot after an unexpected exit. Temporary cookie-maintenance browsers must never update it. Store snapshots atomically under a dedicated application-owned `sessions/<uuid>.json` directory, not inside Chromium Preferences. Snapshot URLs are sensitive; never log them or expose them in error messages.

All restored pages must use the existing blank-target, fingerprint-then-navigation path. No `--restore-last-session` shortcut. Existing popup initialization limitations remain documented; do not claim a broader security guarantee without a separate fix.

## 2. Clear cookies

An explicit `Clear cookies…` action with confirmation on a stopped profile. This is not automatic clearing at launch or exit. Cancel makes no changes. Clear persistent, session, httpOnly, and partitioned cookies through browser-level `Storage.clearCookies`, verify the browser reports none, close normally, and verify persistence after reopening. Do not route readback through the existing export normalizer if it cannot represent partitioned cookies.

Reuse the network-isolated temporary browser, exclusive lease, orphan-process checks, and shutdown tracking. Do not remove localStorage, IndexedDB, cache, saved passwords, history, or tabs. Failure must not report success; no cookie contents in UI or logs. Warn that clearing cookies can sign the user out.

## 3. Portable profile export/import

Keep Backup / Restore and add separate Export profile… / Import profile… actions. One profile per ZIP initially; no batch import, third-party profile conversion, overwriting, or cloud transfer.

Use `format:"exodus-portable",version:1`, distinct from backup manifest versions 1–3. Carry validated profile settings, restore preference, tab URLs, proxy configuration without password, a stable fingerprint seed, Chromium data, and browser-neutral cookies in `cookies.json`. This needs an attached verified engine for export/import. Export locks the stopped profile for the entire consistent snapshot and cookie read. Use staged output and atomic publication.

Portable cookies use a dedicated schema, not the current lossy Netscape or JSON exporter. Preserve validated partition keys when supported by the pinned CDP version; reject unsupported nonempty cookie representations with an actionable error rather than silently dropping them. Support session/httpOnly/SameSite/secure/host-only semantics and Chromium-supported expiry. Retain the existing 5 MiB / 20,000-cookie limits for the sidecar.

Chromium data is copied with an explicit, tested portable exclusion list: native cookie databases and their journals, `Local State`, singleton/process locks, debugging port files, and native session-restore files. Never copy runtime journals or application secrets. Keep other site data as best effort; do not promise portability of browser-bound credentials, passkeys, or all encrypted Chromium stores. The archive contains sensitive plaintext cookie material and must display a warning before export; archive encryption is outside this increment.

Import validates archive layout and sizes using the existing traversal/link/duplicate protections (100,000 entries, 20 GiB; manifest 1 MiB), creates a fresh UUID in staging, starts an isolated maintenance browser on staging, imports cookies, verifies supported fields, and closes it. Publish the directory, proxy record, session snapshot, and profile only after preparation succeeds; compensate filesystem publication if the database transaction fails. Do not create visible placeholder profiles. Proxy passwords must be re-entered. No DIRECT fallback for an incomplete authenticated proxy.

Add a persisted `fingerprintSeed` so a new UUID does not silently change Canvas/WebGL noise. Historical profiles derive and retain the existing `seedFor(id)` value. New profiles receive an independent random uint32 seed; exported profiles retain their seed on import. Warn that original and imported copies intentionally share this identity. Newly written backup manifest v4 carries the seed and restore setting; manifests v1–3 remain readable with historical defaults. Session snapshots are explicitly included in v4, not accidentally copied as Chromium files.

## 4. Localization

Subject to the publication-policy exception above, support `en` and `ru`, default `en`, selectable in application settings and persisted independently from the profile's website language. Switching updates UI without restarting or discarding editor input. Other languages are an extension point, not a deliverable.

Use typed translation keys, English fallback, parameterized messages, and `Intl` formatting. Translate buttons, labels, status/error messages, accessibility text, confirmation dialogs, and main-process open/save dialogs. Map allowlisted error codes to localized messages; never translate or interpolate raw exception messages. Keep technical identifiers and arbitrary user input unchanged. Main-process dialogs read the persisted application language. No remote translation service, locale packs, or CSP relaxation.

## 5. Country flag

Show a small locally rendered flag beside the successfully checked external proxy IP in both profile cards and the shared proxy directory. Use the checked IP, never the configured proxy hostname. Include an accessible localized country name; unknown countries show the IP without an invented flag.

Use a pinned DB-IP Country Lite MMDB dataset with its required CC BY attribution and a bounded MMDB reader dependency selected and pinned during implementation. Validate distribution rights and supply-chain provenance before bundling it; record URL, dataset date, SHA-256, and license. Dataset acquisition is an explicit maintenance operation, not part of every build or application startup. No live lookup requests, CDN flag images, or automatic dataset refresh. Use locally bundled SVG flags with a license inventory; Windows emoji rendering is not reliable enough for this feature.

Lookup failures, missing data, private/reserved IPs, and IPv6 lookup misses must not turn a successful IP check into an error. Return `countryCode:null`. Keep results ephemeral and invalidate IP and country together on profile/proxy edits or repeat checks. The current HTTP IP-check warning remains: country is an estimate based on an untrusted HTTP-reported IP, not proof of location.

## 6. Build version

Display `v0.1.N` below/beside the existing wordmark in the upper branding block and in the native window title. It must remain visible in narrow layouts. One immutable build-info object supplies main, preload/IPC, and renderer; never calculate versions independently at runtime.

Every invocation of the common build pipeline reserves the next integer N, including builds triggered by `dev`, `verify`, and integration tests. `npm start` does not increment it. Failed attempts consume their reservation, so versions are never reused and gaps are possible. Tell users this explicitly. Concurrent builds must not publish mixed artifacts: hold a build lock for the entire build or fail clearly when busy.

Keep the counter outside disposable `dist/`, in ignored `.local/build-version.json`, with an initial checked-in high-water mark of 0. Deleting `dist/` must not reset it. Lost/corrupt counter state must require explicit reseeding rather than silently reusing a version. An environment-provided build number for CI must exceed the persisted/checked-in high-water mark. Multiple clones require a coordinated CI allocator or manual high-water updates; no claim of globally unique offline versioning.

Do not rewrite tracked `package.json` and the lockfile on every test build. Their `0.1.0` is the base release version; generated metadata is the development build identity. Future packaging must set the packaged application's version to the generated value. Until packaging exists, do not use `app.getVersion()` as the source of the displayed build number.

## Acceptance and non-goals

Automated tests cover security boundaries, historical compatibility, isolated real Chromium behavior, native Electron dialogs where practical, and narrow layout. Manual acceptance covers actual cross-Windows-account import, both UI languages, flag rendering, and persistence. A successful transfer restores tested cookies; it cannot guarantee that every website accepts a transferred login.

No installer, updater, cloud service, native session-history reconstruction, automatic cookie deletion, archive encryption, or modifications to real user data are included.
