# GPLv3 licensing for Exodus Browser — design

Date: 2026-10-31. Status: **approved by the owner** (`GPL-3.0-only`; name and logo reserved). Implementation: `docs/superpowers/plans/2026-10-31-license-gplv3.md`.

## Intent

The repository is public and ships Windows installers but currently has **no license file**; GitHub reports `license: null`. Legally that means "all rights reserved": others may not copy, modify or redistribute. The owner wants an open license that permits use and improvement while preventing closed-source derivatives of the product. The owner confirmed Dolphin was used only as a source of ideas and observable behaviour; the code is original, so no third-party proprietary code blocks relicensing.

## Decision

Adopt **GPL-3.0-only** (SPDX `GPL-3.0-only`).

Rationale: strong copyleft keeps forks open, matches the anti-detect product's interest in preventing closed clones under another brand, and is compatible with every dependency in use (MIT, ISC, BSD-2-Clause, MIT-0, Electron, `flag-icons` MIT, `maxmind` MIT, `ipaddr.js` MIT). DB-IP data (CC BY 4.0) is data, not code; existing attribution stays and CC BY 4.0 is GPL-compatible for distribution.

Not chosen:

- **GPL-3.0-or-later** — allows future GPL versions; more permissive than needed and makes the applicable terms less predictable for a distributed desktop product.
- **AGPL-3.0** — targets network services; adds friction for a local Windows application without meaningfully increasing protection here.
- **MIT / Apache-2.0** — permit closed-source commercial forks and rebranding, which the owner wants to discourage.
- **Source-available custom terms** (e.g. non-commercial) — not OSI open source and would mislead users about their rights.

## Scope of change

1. `LICENSE` — verbatim GNU GPL v3 text (35,149 bytes, SHA-256 `3972dc97…b36986`), kept unmodified so its provenance can be checked. The copyright line lives in `NOTICE`, `README.md` and `package.json` rather than inside the canonical text.
2. `README.md` — short "License" section: GPLv3, right to use/modify/share, obligation to keep derivative distributions open, no warranty, and a note that the **Exodus Browser** name and logo are not granted as trademarks. Add a license badge next to the existing four.
3. `NOTICE` — third-party components and attribution: Electron/Chromium, `flag-icons` (MIT, existing license file under `resources/flags/`), DB-IP Country Lite (CC BY 4.0), and the Rust/JS dependency families (MIT/ISC/BSD). Keeps required attribution in one visible place.
4. `package.json` — `"license": "GPL-3.0-only"` to match the SPDX identifier.
5. `DECISIONS.md` — entry recording the decision, rationale, rejected alternatives and the cost of being wrong; correct the earlier note that no license existed.
6. `STATUS.md` / `docs/verification.md` — record the change and the verification performed.

No application code, storage paths, branding identifiers or release artifacts change. A new release is **not** produced; the license will simply be present in the next installer build. Optionally, a later release can show the license page in the NSIS wizard via electron-builder's `nsis.license`; that alters installer UI and is therefore deferred to an explicit request.

## Constraints

- Everything published stays in English.
- Existing artwork, installer/product name, release tags and topics are unchanged.
- Distributing binaries requires providing the corresponding source; the public repository already satisfies this.
- No per-file copyright headers: a single `LICENSE` plus README section is sufficient and avoids churn across the codebase.

## Verification

- GitHub repository license detection reports `GPL-3.0`.
- `LICENSE` byte-for-byte matches the canonical GNU GPL v3 text (compare against the official source and record the SHA-256).
- `package.json` parses and its SPDX value matches README/NOTICE wording.
- README renders on GitHub: badge loads, License section and links resolve.
- `npm run verify` and `npm run test:integration` still pass (docs-only change, expected no effect).

## Open questions for the owner

1. Confirm `GPL-3.0-only` rather than `GPL-3.0-or-later`.
2. Confirm that the Exodus name and logo are **not** licensed for reuse by forks (recommended, and stated in README).
