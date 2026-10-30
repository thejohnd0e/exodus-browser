# Design: a single selectable browser language

## Intent

Each profile needs one user-selected website language. Users can replace it at any time by searching by name or BCP47 code. Multiple languages and their priorities are not needed.

## Approaches

1. **Keep the list, limited to one item.** Minimal model changes, but the Add button, arrows, and removal become redundant and misleading.
2. **Provide a single searchable selection field.** The recommended and selected approach: the interface matches the actual feature—one replaceable language—while retaining catalog search and entry of a valid BCP47 code.
3. **Remove selection and always use the system language.** Unsuitable: the user explicitly confirmed that selecting a language from a list is required.

## Goals

- One active language per profile, editable in the profile form.
- Search by display name and code; valid custom BCP47 codes remain available.
- Preserve the current Chromium Preferences and `--lang` behavior for the single selected language.
- Do not disable Accept-Language Reduction or other privacy protections.
- Simplify the UI: no priority list or actions to add, move, or remove languages.

## Non-goals

- Do not guarantee that websites will see more than one language.
- Do not change the system language or Chromium interface language.
- Do not change proxies, SQLite schema v2, or the profile directory structure.

## Compatibility and data preservation

- Retain the current internal `languages: string[]` representation as a single-item array to avoid a SQLite migration and preserve the existing v2 backup contract.
- New validation accepts exactly one language.
- When reading an old v2 profile or backup with multiple languages, use the first (previously primary) language; treat an empty/corrupted list as a validation error rather than silently substituting another language.
- A v1 backup with a `language` field continues to restore as a single-item array; new v2 backups continue to write a singleton array.

## Verification

- UI tests confirm language search, selection, and replacement, and the absence of multi-select actions.
- Unit tests confirm singleton validation and normalization of old multi-value records to the first item.
- A real Chromium integration test checks the selected language through `navigator.language` and the start of Accept-Language; it does not require disabling reduction or claim support for a language list.
- Full `npm run verify` and `npm run test:integration` runs.

## Implementation decisions

- The user selected one searchable field instead of a single-item list or the system language.
- Preserving compatibility through a single-item array is a proposed implementation detail; SQLite schema v2 and backup v2 remain unchanged.
