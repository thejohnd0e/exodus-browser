# Sidebar Utility Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the default native menu and ship the approved compact language/GitHub/version footer in the left sidebar.

**Architecture:** Keep Windows window chrome and the existing sticky sidebar. `AppSettings` owns the upward language popover through the existing i18n/settings flow; `SidebarFooter` composes it with an external GitHub link and the build version. Main controls external URL opening through the existing exact allowlist; no IPC expansion is needed.

**Tech Stack:** Electron 45, TypeScript, React 19, existing CSS and local EN/RU catalogs, Vitest/Testing Library, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-10-31-sidebar-utility-footer-design.md`

## Global Constraints

- Exact external project URL: `https://github.com/thejohnd0e/exodus-browser`.
- Preserve original artwork/current crop, 280 px sidebar, native title bar, profile cards and main disclaimer.
- Footer only inside sidebar; approximately 64 px high; interactive targets at least 32 px high.
- Supported minimum window size: 920 x 640; verify also at 1200 x 820.
- Version from `BUILD_INFO.version`, never the illustrative `v0.1.64` literal.
- Keep current persisted EN/RU settings, busy/error handling and renderer isolation. No new dependencies, preload methods, remote assets or automatic network requests.
- First observe a meaningful failing test, then implement the minimum change; run `npm run verify` and `npm run test:integration` after implementation.
- Do not run concurrent builds in one checkout: each build consumes a local build number.
- Preserve existing dirty UI/wordmark/confirmation changes. Do not stage whole shared files without inspecting hunks; do not commit or publish unrelated work. User previously chose this working tree; reconfirm only if execution requires moving work elsewhere.
- All tracked prose, tests and comments remain English; localized catalog values follow existing policy.

## Review Focus

- Alt/F10 must not reveal the removed menu; standard editing/clipboard behavior must not regress (Tasks 1 and 3).
- Lookalike GitHub hosts, credentials, alternate paths, query/fragment and non-HTTPS URLs must never reach `shell.openExternal` (Task 1).
- Keyboard/outside-click dismissal, busy changes and rejected language saves must leave usable focus and truthful selected state (Task 2).
- A short viewport and long profile list must not hide the footer or clip its upward popup (Task 3).
- Removing the select must not silently remove language persistence, localization, editor-draft preservation or error coverage (Tasks 2 and 3).

## File map

- Modify `src/main/window.ts`: absent native menu and exact GitHub external-link permission.
- Modify `src/renderer/AppSettings.tsx`: replace the large select with a compact accessible upward popover.
- Create `src/renderer/SidebarFooter.tsx`: language, GitHub and dynamic version composition; default export is not needed.
- Modify `src/renderer/App.tsx`: mount footer after sidebar navigation; remove old language/version placements.
- Modify `src/renderer/styles.css`: scope footer/popover styles and remove only obsolete language/version placement rules.
- Modify `src/shared/i18n/en.ts` and `src/shared/i18n/ru.ts`: localized accessible names/endonyms as needed, retaining key parity.
- Modify `tests/unit/window-branding.test.ts`, `tests/unit/ui.test.tsx` and affected language tests: regression coverage; retain existing scenarios.
- Modify `tests/integration/app-smoke.test.ts`: actual menu, footer geometry, persistence and link activation.
- Update `STATUS.md`, `TODO.md`, `DECISIONS.md`, `docs/architecture.md`, `docs/verification.md` after verified results.

### Task 1: Remove menu and safely allow the project link

**Interfaces:** Preserve `createWindow(version?: string): BrowserWindow`. Window-open handler still returns `{action:'deny'}` for every request; only approved canonical URLs trigger external opening. Existing DB-IP behavior remains unchanged.

- [ ] Add a mocked `setMenu` spy to `tests/unit/window-branding.test.ts`; add `removes the native application menu` asserting `setMenu(null)` on the created window and unchanged security options/title.
- [ ] Add a separate test asserting project URL activation calls `shell.openExternal` exactly once with the canonical URL. Reset spies per test to prevent call-count leakage. Retain DB-IP assertions.
- [ ] Add negative URL cases: `https://github.com.attacker.example/thejohnd0e/exodus-browser`, `https://user@github.com/thejohnd0e/exodus-browser`, HTTP, another repository, suffix path, query, fragment, `file:` and `javascript:`. Assert denied windows and zero external calls for each negative case.
- [ ] Run `npx vitest run tests/unit/window-branding.test.ts`; observe failure for missing menu removal and project-link permission, not mock/setup errors.
- [ ] In `src/main/window.ts`, call `win.setMenu(null)` and extend the exact canonical URL allowlist without broadening it to all GitHub URLs or accepting arbitrary renderer commands. Catch external-open rejection as today.
- [ ] Rerun `npx vitest run tests/unit/window-branding.test.ts`; expect all cases PASS.
- [ ] Review the task diff and prepare an isolated conventional commit (`feat: remove native menu and allow project link`) only if committing is authorized; exclude unrelated dirty changes.

### Task 2: Compose the footer and accessible language popover

**Interfaces:** Preserve `AppSettings({disabled=false}:{disabled?:boolean})` and `useI18n()` language/setLanguage/t contract. Introduce `SidebarFooter({disabled=false}:{disabled?:boolean})`; import `BUILD_INFO` inside it. Preserve `.build-version` as a selector, moving its sole instance into `.sidebar-footer`.

- [ ] Add UI tests: `places language, GitHub and the build version only in the sidebar footer` and `opens language choices upward without saving until selection`. Assert footer follows nav; `.brand .build-version` absent; exactly one version equals `v${BUILD_INFO.version}`; project anchor has exact href, `target="_blank"`, `rel="noopener noreferrer"`; popup initially absent/hidden.
- [ ] Add interaction tests asserting English and Russian (endonym) choices, current selection, save once for a different language and no save for the current one; Escape restores trigger focus, outside click closes, Tab can leave, and focus leaving closes without stealing focus back.
- [ ] Add busy/error tests: disabled trigger cannot open; becoming disabled closes an open popover; failed settings update retains previous language and existing safe error feedback. Retain successful persistence and editor-draft tests.
- [ ] Locate select-dependent tests with `rg 'Interface language|language.label|selectOption|change.*language' tests`; update interactions to the new control without deleting their behavioral assertions. Run `npx vitest run tests/unit/ui.test.tsx tests/unit/i18n.test.tsx` and observe the new regression assertions fail for the expected missing footer/popover.
- [ ] Implement `AppSettings` using semantic buttons in a named popover group, not ARIA menu/listbox roles. Set localized accessible trigger name, aria-expanded and aria-controls; use visible endonyms, selection indicator, decorative globe and chevron SVG. Reuse existing settings updates; manage dismissal/focus cleanup without trapping Tab.
- [ ] Create `SidebarFooter` and move existing `AppSettings` plus version out of the logo area in `App.tsx`. Add the static canonical GitHub anchor with a local decorative SVG and localized accessible name. Do not change profile cards, navigation actions, title version, or main disclaimer.
- [ ] Add scoped CSS: one footer row, subtle top border, `margin-top:auto`, upward popup, readable existing palette, visible focus and at least 32 px controls. Account for existing aside padding so the footer spans the sidebar cleanly. Remove obsolete select spacing, reset moved version margins, keep logo crop unchanged.
- [ ] Run `npx vitest run tests/unit/ui.test.tsx tests/unit/i18n.test.tsx` and any other tests found by the select-dependency search; expect PASS. Run `npm run typecheck`; expect exit 0.
- [ ] Review task-only hunks and prepare `feat: add sidebar utility footer` if commits are authorized; preserve unrelated local work.

### Task 3: Verify in built Electron and record acceptance

**Interfaces:** Consume Tasks 1–2 without expanding the preload API. Existing `.build-version` and brand asset selectors remain valid except their intentional placement change.

- [ ] Extend Electron smoke tests to assert `BrowserWindow.getAllWindows()[0].getMenu() === null` and menu bar remains invisible after Alt and F10. Type into search using keyboard and exercise select-all/copy/paste without losing ordinary editing behavior.
- [ ] Update existing language `selectOption`/`inputValue` scenarios to click the trigger and language choices; after restart assert RU trigger/current selection and localized headings. Keep no-remote-locale requests and editor coverage intact.
- [ ] Add geometry checks at 1200 x 820 and 920 x 640 with enough temporary profiles to overflow the document: footer remains at viewport bottom within sidebar before/after scrolling; language popup bounds stay above trigger and within viewport; GitHub/version fit; no horizontal overflow. Check both EN and RU. Retain source-byte/logo crop tests.
- [ ] Test GitHub activation by stubbing main `shell.openExternal` (never launch a real browser in the test); click footer link and assert one exact URL, unchanged manager URL, no extra Electron window. Retain DB-IP link and blocked-navigation checks.
- [ ] Run `npm run test:integration` before final integration implementation adjustments; confirm failures identify the intended menu/footer/popup contract rather than stale select locators. Make only necessary corrections, then rerun to PASS.
- [ ] Run `npm run verify`, then `npm run test:integration` sequentially. Record actual totals, exit codes and any blockers; do not copy earlier totals or reset the build counter.
- [ ] Inspect built Electron screenshots in isolated `LOCAL_PROFILES_DATA` at normal/minimum sizes, with popover closed/open and keyboard focus. Compare only the agreed sidebar/menu changes with the approved mockup; verify readable footer and intact profile controls.
- [ ] Update status/TODO/architecture/decisions/verification with actual results and remaining user manual acceptance. Check `git diff --check` and inspect `git status --short`; do not publish local mockup/browser artifacts or unrelated changes. Prepare `test: verify sidebar utility footer in Electron` if commits are authorized.

## Handoff

This plan is documentation only. Implementation starts after user review. Native inline execution is recommended: the three tasks share a small renderer/main boundary and do not justify separate implementers. A final fresh-context review should focus on link policy, focus behavior and minimum-height layout.
