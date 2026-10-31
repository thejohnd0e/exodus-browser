# Compact Profile Cards and Larger Sidebar Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep profile launch/stop controls immediately accessible while collapsing secondary settings, and enlarge the existing sidebar artwork.

**Additional approved scope:** Replace application confirmation/warning message boxes with accessible themed in-app modals. Keep native file/folder selection dialogs. Preserve warning text and cancellation semantics: Escape and the close button cancel, and initial focus goes to the safe action. This work is a separate subsystem and requires its own implementation plan before execution; the renderer-only architecture below applies only to the compact-card/branding tasks.

**Additional approved layout scope:** Replace the oversized profile-count/running-count cards and the ready-engine banner with one compact summary row: profile total and running count on the left, Chromium version on the right. Move the separate-browser explanation into a keyboard-accessible tooltip. Retain a prominent actionable engine block when the engine is unavailable or reports an error.

**Architecture:** Renderer-only changes using existing React components, callbacks and CSS. Introduce a small keyed ProfileCard component to own per-profile disclosure state without changing ProfileList's public props. No IPC, database, proxy, browser lifecycle or network changes.

**Tech Stack:** TypeScript, React 19, custom CSS, Vitest/Testing Library, Playwright Electron integration tests.

**Spec:** Confirmed user requirements in this conversation: remove the proxy-check-button request; retain profile identity, proxy and status in the header; move Launch/Stop into that always-visible header; collapse settings and secondary actions below the illustrated divider; enlarge the sidebar emblem. Defaults below are implementation proposals, not additional user requests.

## Global Constraints

- Read AGENTS.md, STATUS.md, TODO.md, DECISIONS.md, docs/development.md and docs/architecture.md before execution.
- Preserve existing launch/stop/edit permission checks and all existing callbacks.
- Use existing local EN/RU catalogs; keep new keys, tests, comments and documentation in English and follow the repository's localization policy.
- Preserve the supplied artwork and Exodus Browser branding; no new dependencies or remote assets.
- Do not touch real profile storage. Electron acceptance must use isolated LOCAL_PROFILES_DATA.
- Use TDD; run npm run verify and npm run test:integration sequentially after changes. Never run concurrent builds in this checkout.
- Do not commit unrelated work or publish changes without the user's instruction.

## Review Focus

1. Profiles must retain independent expanded states when another profile changes, polling refreshes, or list ordering changes.
2. Launch/Stop must not toggle disclosure or silently alter their existing disabled-state rules.
3. Hidden controls must not be keyboard-focusable; disclosure must work with Enter/Space and expose its expanded state.
4. Long names, proxy addresses, narrow windows and both UI languages must not hide operational controls or cause horizontal overflow.
5. Collapsing details must not invalidate check results or conceal a blocked-profile recovery warning.

## Proposed Interaction Defaults

- Initially collapse every profile's details. Keep the number/avatar, name, proxy summary, status, Launch, Stop and a separate Settings disclosure button visible.
- Multiple profiles may be expanded independently. Keep expanded state only while the list remains mounted; do not add persistence or settings migrations.
- Settings toggles an inline panel, not the existing Edit dialog. Keep only Edit inside that panel: remove the redundant Fingerprint: edit button, since both currently invoke the same onEdit(p) callback. Fingerprint settings remain accessible through Edit; retain the read-only fingerprint summary.
- Place notes, language/start-page metadata, fingerprint summary, edit/backup/export/cookie/check-IP/delete actions and their existing result/disclosure text inside the panel.
- Keep actionable launch/recovery warnings (missing proxy credentials and blocked-profile instructions) visible even when settings are collapsed. Preserve other warning copy in details.
- Keep launch and stop as separate buttons, with their current labels and enablement rules.
- Enlarge the existing wordmark to the sidebar's available inner width without enlarging the sidebar, stretching the artwork, cropping its visible content or changing native/window icons. Inspect transparent artwork padding before choosing CSS; if it causes the small visible logo, use a bounded renderer crop of transparent margins or a derived local asset, preserving the original artwork and documenting the derivative.

## Files and Responsibilities

- `src/renderer/ProfileList.tsx`: keep list mapping and existing public props; extract/export the shared props type if needed for ProfileCard.
- `src/renderer/ProfileCard.tsx` (new): profile header, existing action rules and independently controlled details panel; keep CookieExport local here if moved with the card.
- `src/renderer/styles.css`: header wrapping, disclosure/details styling and sidebar artwork sizing.
- `src/renderer/App.tsx`: change only branding markup if the chosen artwork sizing requires it.
- `src/shared/i18n/en.ts`, `src/shared/i18n/ru.ts`: localized disclosure labels.
- `tests/unit/ui.test.tsx`, `tests/unit/ui-fingerprint.test.tsx`, `tests/unit/i18n.test.tsx`: disclosure behavior and updates to tests that access secondary actions.
- `tests/integration/app-smoke.test.ts`: built Electron layout and artwork checks, preserving existing resource provenance assertions.
- `docs/verification.md`, `STATUS.md`, `TODO.md`: actual verification and acceptance status, not speculative success.

### Task 1: Compact Profile Headers and Expandable Settings

**Interfaces:** Preserve `ProfileList`'s existing props and action callbacks. `ProfileCard` consumes one Profile, the current state/result data and unchanged callbacks; expansion is local state associated with its React key `p.id`. Keep `profileCheckVersion` and `fingerprintSummary` exports compatible with existing callers.

- [ ] Add failing unit tests: profiles start collapsed; Launch/Stop and identity/status remain accessible; Edit, Backup and cookie controls are absent from accessible queries until Settings is expanded. After expansion, exactly one Edit button opens the full profile editor including fingerprint settings, no Fingerprint: edit button exists, and the read-only fingerprint summary remains visible.
- [ ] Add tests for independent disclosure of two profiles, stable identity through rerender/reordering, and keyboard activation with correct `aria-expanded` and unique `aria-controls`/panel IDs.
- [ ] Add tests that launch/stop clicks call exactly the existing callback with the profile ID without toggling details. Cover stopped, starting, running, stopping, error and blocked states, plus busy and engine-not-ready conditions against the current enablement rules.
- [ ] Add tests that check-IP results and country flags survive collapse/reopen, no automatic proxy check occurs, and blocked/missing-credential warnings remain visible while collapsed.
- [ ] Run `npx vitest run tests/unit/ui.test.tsx tests/unit/ui-fingerprint.test.tsx tests/unit/i18n.test.tsx` and verify new tests fail for missing disclosure behavior, not fixture/setup errors.
- [ ] Implement the ProfileCard extraction and header/details structure. Use a real button, localized Settings/Hide settings labels, `aria-expanded`, `aria-controls`, and a genuinely hidden or unmounted details region. Never nest action buttons inside a clickable disclosure/header button.
- [ ] Update existing secondary-action tests to explicitly expand the relevant profile first; keep their original action/result/security assertions intact. Ensure transient cookie menus close when their panel is hidden.
- [ ] Run the same targeted tests and confirm all pass.

### Task 2: Larger Branding and Responsive Layout

**Interfaces:** Use the existing `ico/exodus-wordmark.png` import and alt text `Exodus Browser`; preserve the existing native icon and favicon resource contract. Compact profile controls from Task 1 must remain reachable in the final CSS layout.

- [ ] Inspect the source image's dimensions and visible-content bounds; identify whether internal transparent margins or CSS sizing limit the visible emblem. Record the selected fit approach in the verification notes.
- [ ] Extend built Electron tests with measurable assertions: branding fits within sidebar bounds, visible artwork is larger than the current baseline, aspect ratio is preserved, and version/language/navigation do not overlap it. Keep exact original asset-byte assertions when the original is still bundled; explicitly test provenance of any derived asset instead of silently removing coverage.
- [ ] Add layout assertions for the screenshot-sized viewport (1188 by 813) and the existing narrow test viewport, in EN and RU: no horizontal document overflow; header actions stay within the card; long names/addresses wrap or truncate without covering buttons; expanding one card reveals its panel and collapsing reduces its height.
- [ ] Run `npm run test:integration` and verify the new assertions fail for the expected old-layout behavior before changing CSS.
- [ ] Implement bounded artwork enlargement and responsive header/details styling. Do not widen the sidebar or expand the scope to unrelated visual redesign.
- [ ] Run the integration tests again and confirm new and existing assertions pass.

### Task 2B: Compact Counts and Ready-Engine Summary

**Files:** `src/renderer/App.tsx`, `src/renderer/EngineSettings.tsx`, `src/renderer/styles.css`, local EN/RU catalogs as needed, `tests/unit/ui.test.tsx`, `tests/integration/app-smoke.test.ts`.

**Interfaces:** Reuse existing profile counts, polled running states and engine status/version. Do not introduce new IPC, storage or background checks; retain existing engine management controls and their guards.

- [ ] Add failing unit tests for ready-engine mode: one compact summary contains profile total, running count and the actual installed Chromium version; changing the profile list or polled state updates the counts. Test zero profiles and several running profiles.
- [ ] Add tests for existing non-ready engine states: installation/attachment actions, progress and errors remain accessible and prominent. Keep existing management controls available rather than deleting them for visual compactness.
- [ ] Add tests for the separate-browser explanation: available through a focusable information control on keyboard focus and pointer hover, dismissed with Escape, with accessible description association. Cover EN/RU and do not rely solely on an HTML title attribute.
- [ ] Run `npx vitest run tests/unit/ui.test.tsx` and confirm the added tests fail for the old large-block layout or missing accessible explanation.
- [ ] Replace the two large ready-state blocks with a single compact row: counts left and version right, wrapping cleanly on narrow windows. Preserve a separate actionable block for unavailable/error engine states and existing installation progress behavior. Keep search and restore/import actions below the summary.
- [ ] Extend built Electron layout tests to assert that ready-state summary uses less vertical space than the old stacked blocks, with no overlap or horizontal overflow at normal/narrow widths and in both languages.
- [ ] Run the targeted unit tests and `npm run test:integration`; confirm both behavior and layout assertions pass.

### Task 3: Verification and Handoff

- [ ] Run `npm run verify` and record typecheck, unit-test and build outcomes.
- [ ] Run `npm run test:integration` after verify completes; report BLOCKED honestly if required local Chromium is unavailable.
- [ ] Manually inspect an isolated-data Electron session: multiple collapsed profiles; launch/stop access; expand/edit/cookies/IP check; long names; both languages; narrow window; enlarged artwork. Never run these scenarios against the real profile database.
- [ ] Update `docs/verification.md`, `STATUS.md` and relevant TODO acceptance entries only with observed results. Do not claim unperformed manual checks passed.
- [ ] Review `git diff --check` and the scoped diff; confirm no lifecycle, network, proxy-check implementation, real-data or secret changes.
- [ ] Report results and remaining limitations. If a commit is requested, include only scoped files and use an English conventional message such as `feat: add compact profile cards and larger sidebar branding`.

## Self-Review

- Confirmed card/branding/summary requirements map to Tasks 1, 2 and 2B; the cancelled proxy-library change is excluded. Themed dialogs have a separate planning workstream below.
- Interaction defaults and visible-warning behavior are explicit proposals for approval before implementation.
- All five review-focus items have unit or built-layout coverage in their owning task.
- Backend contracts, stored profiles, proxy routing and original action guards remain unchanged.
- Implementation has not started; this plan requires user review first.

## Follow-up Workstream: Themed Application Dialogs

The user approved adding this workstream to the current scope. Do not implement it as an incidental CSS change: confirmations are currently owned by main-process operations and must retain their security boundary.

### Required Design and Plan

- [ ] Inventory application message boxes in `src/main/index.ts`: portable export, cookie clearing, profile deletion, engine download/attach, backup, exit confirmation and exit errors. Distinguish confirmations, warnings and informational/error messages from OS file pickers and fatal startup errors.
- [ ] Inspect `src/main/cookies/operations.ts`, `src/main/portable/operations.ts`, IPC validation, preload allowlisting and existing React dialog patterns/tests before choosing the dialog request/response interface.
- [ ] Write a separate detailed implementation plan for a reusable themed modal and the main/renderer confirmation bridge. Preserve trusted-frame validation, operation-specific ownership and validation, and stopped-profile locks. Renderer-side confirmation must not become a bypassable flag granting permission to a sensitive operation.
- [ ] Specify fail-closed cancellation for Escape, close button, app/window destruction, renderer reload/crash, duplicate requests and late/stale responses. Match each response to exactly one pending request; cancellation must never execute the operation.
- [ ] Preserve existing localized warning text and operation-specific button wording. Use the application's dark surfaces, typography, rounded corners and accent colors; distinguish destructive actions without making them the default.
- [ ] Specify modal focus trapping, safe initial focus, focus restoration, accessible dialog naming/description, and blocked interaction with the background.
- [ ] Keep `showOpenDialog`/`showSaveDialog` native. Define a safe native fallback for startup/fatal errors when no functional renderer is available.
- [ ] Add TDD steps for confirm/cancel, all dismissal paths, response correlation, renderer failure, localized text and keyboard accessibility; add built Electron scenarios for sensitive actions and closing the application with running profiles using isolated data.
- [ ] Run the complete verification commands and document tested results; do not weaken or remove existing warning/confirmation tests to accommodate the visual redesign.

**Implementation order:** Complete compact cards and branding first, then themed dialogs after reviewing their separate detailed plan. No code implementation is authorized merely by recording this scope addition.
