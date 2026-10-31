# Sidebar utility footer design

## Approved direction

The user approved the browser mockup and requested an implementation plan. Remove the default Electron menu bar and move secondary utilities into a compact footer pinned to the bottom of the left sidebar. This document records that approved direction; implementation has not started.

## Layout and behavior

- Preserve the native Windows title bar and window controls. Remove File/Edit/View/Window entirely, rather than auto-hiding a menu that Alt can reveal.
- Preserve the original Exodus artwork, current crop, 280 px sidebar width, profile cards, navigation, dialogs, and main-content disclaimer.
- Remove the version and language selector beneath the logo. Navigation follows the logo without the old language-control gap.
- Footer occupies only the sidebar, not the full window. Use the mockup's approximately 64 px height, subtle top border, existing navy background, and a single row: globe + EN/RU + chevron, separator, GitHub icon + label, version aligned right.
- Footer remains visible when the profile list scrolls, including at the supported minimum window size (920 x 640). It must not cover navigation or create horizontal overflow.
- Language button opens a small popover upward, with English and Russian shown by their endonyms and a selected indicator. Reuse persisted settings and the existing busy/error flow. Opening does not save; choosing a different language saves once. Escape, outside click and focus leaving the control close it. Escape and selection restore focus to the trigger; ordinary Tab navigation must not be trapped.
- Use native buttons with a named group of language choices, not incomplete ARIA menu/listbox semantics. Trigger has a localized accessible name, aria-expanded and aria-controls. Icons are decorative inline SVG; interactive targets are at least 32 px high, with visible keyboard focus.
- GitHub opens exactly `https://github.com/thejohnd0e/exodus-browser` in the external default browser on explicit user activation. No remote icon, embed, prefetch, automatic network request or arbitrary-URL IPC.
- Footer version comes from `BUILD_INFO.version`; `v0.1.64` in the mockup is illustrative, never a hard-coded production value. Preserve version-bearing native title behavior.
- Displayed popup labels are runtime localization data; project prose, tests and comments remain English under repository policy.

## Approaches

1. **Selected: sidebar footer.** Keeps utilities out of primary navigation, remains available while scrolling, and preserves content width.
2. **Rejected: full-width bottom bar.** Consumes profile-list height and gives secondary utilities excessive visual weight.
3. **Rejected: keep utilities under the logo.** Preserves the clutter the user wants removed.

## Implementation choices

Reuse `AppSettings` for language selection and introduce `SidebarFooter` for footer composition. Keep the current sticky-sidebar/document-scroll model unless minimum-height verification proves it insufficient. Disable the window's native menu with `win.setMenu(null)`. Extend the existing main-process external-link allowlist with the exact project URL, always denying new renderer windows. These are implementation recommendations, not additional user requirements.

## Acceptance and non-goals

TDD unit coverage plus built Electron checks must prove the absent menu, footer location, popup interaction, persisted language, exact external-link policy, and dynamic version. Verify at 1200 x 820 and 920 x 640, with EN/RU and a long overflowing profile list; inspect screenshots and keyboard navigation.

No profile migration, new settings format, preload methods, auto-update, custom title bar, profile-card redesign, or unrelated cleanup. Mockup files remain local; no production code is copied wholesale from the prototype. Real application data is never used for testing.
