# Searchable manual timezone selector

## Intent

Replace the free-text timezone field in Manual mode with an offline searchable dropdown. Users should select a timezone without knowing or typing its exact IANA identifier. The user approved a searchable dropdown; the third proxy-IP mode is recorded separately as future work.

## Approaches

- Selected: searchable dropdown of IANA zones and current-date UTC offsets. Faster to navigate than an unfiltered list and clearer than free text.
- Rejected: plain text entry, which requires memorizing identifiers.
- Rejected: a large unfiltered select, which is cumbersome for hundreds of entries.

## Behavior and constraints

- Replace only the Manual field in `src/renderer/FingerprintPanel.tsx`; do not change stored fingerprint schema, main-process timezone handling, or Auto behavior.
- Each option displays an IANA identifier and the UTC offset for the current date, including daylight-saving rules. Store only the IANA identifier.
- Search at least by the displayed identifier, case-insensitively. Keep the selected value separate from the search query: typing a query is not selecting a timezone.
- Work fully offline using the bundled runtime's timezone support; retain valid existing saved identifiers even when absent from its enumerated canonical zone list, including aliases and UTC.
- Support pointer selection, keyboard navigation, Enter selection, Escape dismissal and visible focus. Label the control using existing EN/RU i18n; provide localized search/empty-result text as needed.
- Preserve disabled/busy behavior, existing editor drafts and save validation. Do not silently select or save a different zone when the field is opened or dismissed.
- Verify current-date offsets, empty search results, existing aliases, keyboard operation and bounds inside the scrolling editor at supported minimum window dimensions.
- Follow TDD and run `npm run verify` and `npm run test:integration` before claiming completion; test only with isolated storage.

## Future third mode (not implemented by this change)

Three distinct semantics: existing Auto/system-default behavior, Manual selection, and By profile proxy IP. The third mode must resolve the actual assigned proxy's exit-IP timezone, never silently fall back to the computer's direct IP or change the interpretation of existing saved Auto profiles. No-proxy, lookup failure, changed-proxy and extension-coexistence policies require separate design before implementation. TimeZone Changer remains the interim solution.
