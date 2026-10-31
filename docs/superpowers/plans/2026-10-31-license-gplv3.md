# GPLv3 licensing — implementation plan

**Goal:** publish the project under GPL-3.0-only with accurate third-party attribution and user-facing explanation.

**Spec:** `docs/superpowers/specs/2026-10-31-license-gplv3-design.md` (approved 2026-10-31: `GPL-3.0-only`; name and logo stay with the owner).

**Scope:** documentation and package metadata only. No application code, installer behavior, release tags or branding identifiers change. No new release is produced.

## Global constraints

- All published text is English.
- `LICENSE` stays byte-identical to the canonical GNU GPL v3 text so the provenance is checkable.
- Copyright ownership and brand reservation are stated in `NOTICE` and `README.md`, not by editing the canonical license body.
- Do not add per-file copyright headers.
- Do not claim compatibility with GPL for any component that is not; Apache-2.0 is compatible with GPLv3, Apache-2.0 is **not** compatible with GPLv2.

## Review focus

- A reader must be able to tell what they may do, what they must share back, and that the brand is excluded.
- A fork must not be able to argue the artwork or name was licensed.
- The attribution for DB-IP (CC BY 4.0) and flag-icons (MIT) must remain discoverable from the repository root.
- The SPDX value in `package.json` must match the README and GitHub's detection.

## Task 1: license text and package metadata

- [x] Download the canonical text from `https://www.gnu.org/licenses/gpl-3.0.txt` over HTTPS.
- [x] Verify it is the formatted GPLv3 document: 35,149 bytes, 674 lines, expected title/section structure.
- [x] Verify the SPDX plain-text copy is a whitespace-reformatted equivalent (not byte-identical by design), confirming the document identity.
- [x] Copy it verbatim to `LICENSE`; record `SHA-256 3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
- [x] Add `"license": "GPL-3.0-only"` to `package.json`.
- [x] Verify `package.json` still parses and the value matches the README wording.

## Task 2: attribution and brand statement

- [x] Create `NOTICE` with the copyright line, GPLv3-only grant, warranty disclaimer, brand reservation, third-party list and the separate-program note for Chrome for Testing.
- [x] Verify every listed dependency license against the installed packages and the production dependency set (MIT, Apache-2.0, BSD-3-Clause, 0BSD — all GPLv3-compatible).
- [x] Reference the existing `resources/flags/LICENSE.flag-icons.txt` and `resources/geoip/README.md` rather than duplicating them.

## Task 3: user-facing README section

- [x] Add a GPL-3.0 badge to the existing badge row.
- [x] Add a `## License` section: permissions, source-sharing obligation, no warranty, brand exclusion, pointer to `NOTICE` and to the separately licensed Chromium build.
- [x] Confirm the section does not contradict the Privacy/limitations and update notes.

## Task 4: verification and publication

- [x] Assert `LICENSE` structure and hash; link `LICENSE`/`NOTICE` from README.
- [x] `npm run verify` and `npm run test:integration` (docs-only change; expected unaffected).
- [x] Commit, push, and confirm GitHub reports `GPL-3.0` and the rendered badge/section appear.
- [x] Record the decision and evidence in `DECISIONS.md`, `STATUS.md` and `docs/verification.md`.

## Deliberately not done

- NSIS license page (`build.nsis.license`): changes installer UI; deferred to an explicit request and a later release.
- Per-file SPDX headers: rejected as churn with no legal benefit here.
- Contributor CLA / dual licensing: the project currently has no external contributors; revisit only if that changes.
