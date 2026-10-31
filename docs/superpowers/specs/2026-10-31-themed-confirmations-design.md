# Themed confirmation dialogs

## Goal

Replace operating-system message boxes used for application confirmations with dialogs rendered inside Exodus Browser. Keep native open/save dialogs for selecting files.

## Scope

Use one accessible, localized renderer dialog for cookie clearing, profile deletion, backup creation, portable-profile export, Chromium download/link, and closing the manager while browsers are active. Preserve each existing confirmation's cancel-by-default behavior, warning text, and destructive-action styling. The manager-close flow must still stop managed work and close storage only after confirmation. Startup-fatal errors are not confirmations and remain native.

## Design

- A reusable modal uses the existing dark Exodus palette, clear title/body, Cancel and action buttons, and danger styling when applicable.
- It is keyboard accessible: focus is moved into the dialog, Tab is contained, Escape cancels, and focus returns to the invoking control.
- All visible strings use the existing EN/RU catalogs. Dialog content is text, never injected HTML.
- Confirmation ownership moves to the renderer. Main-process operations perform their existing validation and work only after the renderer explicitly invokes them.
- On a window-close attempt with active browsers, main notifies the renderer and defers shutdown. The renderer presents the same dialog and reports the user's choice over a narrowly scoped preload method; main remains responsible for shutdown and final close.
- Native open/save dialogs remain in main and keep their existing language and filters.

## Acceptance

Automated unit and Electron integration tests verify the dialog's accessible actions, cancel paths, confirmation before side effects, EN/RU copy, close-flow behavior, and that open/save dialogs remain native. `npm run verify` and `npm run test:integration` pass.
