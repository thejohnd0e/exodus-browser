# Option: moving profiles and cookies from Dolphin Anty (research, not planned)

Status: research only, recorded 2026-11-08. Nothing here is implemented or scheduled. Exodus has
no Dolphin importer; "Import profile" reads only Exodus archives. Field names and Dolphin behaviour
below were not verified against a real export and may differ between Dolphin versions.

## Constraint: export is a paid Dolphin feature

Exporting cookies and profile data from Dolphin requires a paid account, and the project owner
does not have one. Any plan that starts from a Dolphin export therefore has no input to work with.
Do not guess the format: a parser built without a real sample would be unreliable.

## What would transfer if an export were available

| Data | Path | Reliability |
|---|---|---|
| Cookies | Dolphin export (JSON or Netscape) into Exodus "Import cookies" (JSON and Netscape are already supported, 5 MiB / 20,000 entries) | Good |
| Name, notes, folder | Profile fields | Good |
| Proxy host, port, type | Profile fields; the proxy password must be entered again (Exodus archives omit it too) | Good |
| User-Agent, platform, language, timezone, geolocation, screen, cores, memory | Map to the matching Exodus fingerprint settings | Good |
| WebRTC, WebGPU, canvas/WebGL/audio modes | Mapped as a mode (real, noise, off) | Partial |

## What cannot transfer

- **The exact fingerprint.** Dolphin runs its own Chromium build with C++ patches; Exodus runs Google Chrome with script-level spoofing. Canvas, WebGL and audio noise depend on a seed and on the engine's algorithm, so hashes differ. A site that stored the old hash sees a new device.
- **The browser version in the User-Agent.** Dolphin reports its own version; Exodus runs the real engine version. Declaring a different one than the engine behaves like is itself a signal.
- **Fonts, extensions, website storage** (`localStorage`, IndexedDB), and the Windows-bound password store.

## Without a paid account

- Reading the Dolphin profile directory on disk is a possible route in principle (it is a Chromium user data directory), but the cookie database is protected by Windows data protection and Chrome's own encryption, so reading it from another program is unreliable and may be blocked. Not investigated; it should not be attempted without the owner's decision, and decrypting stored credentials of another application needs explicit approval.
- Signing in again in an Exodus profile with the same proxy, country and timezone is the dependable fallback. A fresh sign-in with matching network identity usually raises fewer flags than a stale cookie with a different fingerprint.
- A manual checklist (proxy, locale, timezone, screen, UA) copied from the Dolphin profile card into an Exodus profile needs no export.

## If it is taken up later

1. Obtain one or two sanitized exports (no cookie values, proxy passwords or personal data) from an account that can export.
2. Write a converter that produces an Exodus profile plus a report: transferred / skipped / approximate.
3. Keep import local, never log cookie values or proxy credentials, and keep the Exodus archive rules from `AGENTS.md`.
4. Re-check Dolphin's current export options first; they change with plans and versions.
