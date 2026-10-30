# AGENTS.md

Shared instructions for all agents (Codex, Claude Code, OpenCode) and people modifying this repository. Read before starting work. `CLAUDE.md` only points here.

**Exodus Browser** is a local browser profile manager for Windows: Electron 45, TypeScript, React 19, SQLite (`better-sqlite3`). Each profile is a separate Chromium process with its own data directory. Entirely local: no accounts, cloud, or Dolphin services. The interface and documentation are in English.

## Before starting

1. `STATUS.md` — current state, verified behavior, and exact next step.
2. `TODO.md` — work priorities and maintenance rules.
3. `DECISIONS.md` — decisions and their rationale; do not change them silently.
4. `docs/development.md` — builds, tests, adding IPC operations and profile fields, troubleshooting.
5. `docs/architecture.md` — components, data flows, and security model.

## Language and publication policy

- All Git-tracked material must be in English: UI copy, comments, test names and fixtures, documentation, and any other published text. Commit messages and GitHub metadata (including repository descriptions, issues, pull requests, and releases) must also be in English.
- Chat with the user may remain in Russian. Never publish Russian text to Git or GitHub.
- This policy does not restrict arbitrary user input or valid technical data. BCP47 locale codes such as `ru-RU` remain valid data and must continue to be supported.
- The user approved English UI copy and history cleanup. Preserve prior history locally, then replace remote `master` with one English root commit; do not publish the previous Russian history. History replacement requires the coordinating session's explicit execution, not an incidental documentation edit.
- Use Exodus Browser as display branding. Preserve literal legacy storage paths such as `%APPDATA%\Local Profiles`, compatibility-related `app.setName` values/discussions, fixture identifiers, and other technical identifiers unless a separate migration explicitly changes them.

## Commands

| Command | Purpose |
|---|---|
| `npm run verify` | typecheck + unit tests + production build |
| `npm test` | unit tests only |
| `npm run test:integration` | build + integration tests (requires local Playwright Chromium; otherwise `BLOCKED`) |
| `npm run build` | production build |

Development takes place on Windows (PowerShell). See `docs/development.md` for the complete script table and requirements.

## Non-negotiable rules

- Use TDD for new functionality: first a test that fails for the expected reason, then the minimal implementation.
- After changes, run `npm run verify` and `npm run test:integration`.
- Do not log secrets, proxy headers, argv, or profile contents.
- Do not terminate processes based on PID alone; do not kill after `STOP_TIMEOUT` (DECISIONS.md #7).
- Do not disable TLS verification or substitute unverified engine checksums (DECISIONS.md #4).
- Do not weaken renderer isolation: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP.
- Do not use Dolphin branding: the name, logos, icons, copy, and visual UI style must remain our own.
- Reuse of Dolphin code and ideas was authorized by the user's decision of 2026-10-30: its build may be analyzed and implementations reused, but without its branding or third-party binaries.

See `docs/development.md` → “Security when making changes” for the detailed list and rationale.

## After significant work

Update as appropriate:

- `STATUS.md` — state, verification results, next step;
- `TODO.md` — mark items complete only after verification;
- `DECISIONS.md` — add an entry for each significant decision (decision, rationale, cost of being wrong);
- `docs/verification.md` — manual scenario results with dates and versions.

## Repository structure

`src/shared` — DTOs and Zod schemas; `src/main` — main process (profiles, secrets, engine, lifecycle, proxies, backups, IPC); `src/renderer` — React UI; `tests/unit`, `tests/integration` — tests. See `docs/architecture.md` and `README.md` for the detailed map.

Use conventional-style commits: `feat:`, `fix:`, `test:`, `docs:`.
