# Chrome Web Store extension links (design)

Status: proposed, awaiting approval.

## Intent

Let a user add an extension by pasting a Chrome Web Store link. The package joins the existing library, so one copy serves every profile that enables it. This removes the need to open each profile and install the same extension from the store.

## Findings from the technical check (2026-10-31)

- Downloading `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<engine version>&acceptformat=crx2,crx3&x=id%3D<extension id>%26uc` with HTTPS returns a CRX3 package (magic `Cr24`, version 3, header length, then a ZIP).
- Removing the CRX header and extracting the ZIP yields a loadable unpacked extension. Eagle for Chrome (`lieogkinebikhdchceieedcigeafdkid`) loaded as version 3.1.28 with a running service worker.
- Because the copy is loaded unpacked, Chromium derives a different extension ID from the copy path. Per-profile storage therefore stays stable only while the library copy path stays fixed, which the library already guarantees.
- Store packages may declare `__MSG_<key>__` as the manifest `name`; the real name lives in `_locales/<default_locale>/messages.json`.
- Automating the store page itself is rejected: its "Add extension" confirmation is a native browser dialog, and installing inside a profile would duplicate the extension per profile, which is exactly what this feature prevents.

## Approaches

1. **Selected: download the CRX from Google's update service and unpack it into the library.** Works headlessly, offline afterwards, reuses the existing library, validation, staging and per-profile assignment. Trade-offs: the unpacked ID differs from the store ID; store signature verification by Chromium does not happen; updates must be explicit.
2. **Rejected: open the store page in a profile and let the user click Add.** Requires per-profile installation and cannot be automated; the extension then also lives inside profile data instead of the shared library.
3. **Rejected: keep the CRX and install it via `--load-extension`.** Chromium does not load CRX files through that switch.

## Behavior

- A new action, "Add from store…", asks for a Chrome Web Store link. Accepted forms: `https://chromewebstore.google.com/detail/<slug>/<32-char id>` and `https://chrome.google.com/webstore/detail/<slug>/<32-char id>`, with optional query or fragment, which are ignored. The extension ID must match `[a-p]{32}`.
- The download runs in the main process with a timeout and a size cap (100 MB). Only HTTPS responses are accepted; a redirect to a non-HTTPS URL fails.
- The package is validated as CRX3 (`Cr24`, version 3, sane header length) and the ZIP is extracted with the existing safe-archive rules. The manifest is validated as Manifest V3, exactly as for folder and ZIP input.
- The display name resolves `__MSG_<key>__` from `_locales/<default_locale>/messages.json` when present; otherwise the raw name is kept.
- Entries record their source: local folder, local archive, or store with the store extension ID. Duplicates of the same store ID are rejected with a clear message instead of silently adding a second copy.
- "Update…" for a store entry re-downloads the package from the store; for local entries it keeps the current folder picker. Updates stay explicit and apply at the next profile launch, per the existing library decision.
- Errors are localized and value-free: invalid link, unknown or unavailable extension, download failure, invalid package, unsafe package, duplicate.
- Removal, per-profile assignment and the timezone warning are unchanged.

## Constraints

- TLS to Google is the trust anchor. The CRX signature is not independently verified; this is documented rather than presented as stronger assurance. No checksum from a non-official source is trusted.
- No automatic updates, no background network requests, no store browsing inside the app.
- The renderer never receives a download URL or file path; it submits only the pasted link, which main validates.
- Existing renderer isolation, IPC allowlist and English-only repository text stay unchanged.

## Testing

- Unit: link parsing and normalization (valid, lookalike hosts, wrong ID length/characters, non-HTTPS), CRX header parsing and rejection of a non-CRX payload or truncated header, localized name resolution, duplicate store IDs, download failure and size-cap paths with an injected downloader.
- Integration/acceptance: a locally constructed CRX fixture (our ZIP fixture plus a synthetic CRX3 header) installs and launches in real Chromium; one manual acceptance with the real Eagle link while online.
- `npm run verify` and `npm run test:integration` must pass before completion.
