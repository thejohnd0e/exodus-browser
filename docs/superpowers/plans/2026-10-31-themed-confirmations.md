# Plan: themed confirmation dialogs

Spec: `docs/superpowers/specs/2026-10-31-themed-confirmations-design.md`.

## Global constraints

- Keep native open/save pickers; replace confirmation message boxes only.
- Retain cancellation semantics and do not begin side effects before approval.
- Keep the renderer sandbox and preload allowlist; never pass paths or arbitrary commands from the renderer.
- Use English source text and EN/RU translations.
- TDD: each behavior test must fail before implementation.

## Task 1 — Renderer confirmation component

Add the accessible Exodus-styled dialog, localized title/body/actions, keyboard cancellation, focus management, and unit tests for rendering and actions. Add only the translation keys needed by the final dialog labels if current catalog keys are insufficient.

Expected: focused unit tests fail before the component exists and pass after; existing `npm test` passes.

## Task 2 — Move operation confirmations to renderer

Move cookie-clear, profile-delete, backup, portable-export, and Chromium download/link confirmations into the renderer. Keep file pickers and operation execution in main. Add Electron integration coverage proving cancel has no side effect and approval proceeds, in both language catalogs where practical. Update the preload contract only for required safe operations.

Expected: Electron tests observe Exodus dialog roles/copy, never call `dialog.showMessageBox` for these flows, and native open/save dialogs remain available; `npm run test:integration` passes.

## Task 3 — Themed manager-close confirmation and docs

Bridge active-window close requests to the renderer dialog and send only the user's decision back through a fixed preload API. Main retains shutdown ownership. Test cancel keeps the app/window running and approval performs shutdown. Update STATUS, TODO, architecture, and verification notes as appropriate.

Expected: close-flow integration checks pass, `npm run verify` and `npm run test:integration` pass, and a fresh built Electron run shows the actual in-app dialog.

## Review focus

Check cancellation and duplicate-submit races, keyboard/focus behavior, renderer-to-main trust boundaries, close/shutdown races, language changes while a dialog is open, and retention of native file pickers.
