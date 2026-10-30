# English-only Repository Implementation Plan

**Goal:** Publish Exodus Browser with English-only repository content and reachable history.

**Architecture:** Translate existing files without changing APIs or storage locations. Retain the former history locally, then publish a verified English root commit with a guarded branch replacement.

**Tech Stack:** TypeScript, React, Electron, Vitest, Playwright, Git, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-10-31-english-only-repository-design.md`.

## Constraints

- English for all GitHub-bound material; chat language is independent.
- Preserve arbitrary user input, locale identifiers, security behavior, and the legacy application data directory.
- Preserve old history locally; never force-push without the explicit expected remote hash.
- No unrelated UI layout or fingerprint changes.

## Tasks

- [x] Add and run a failing English-language regression test for repository text and language names. Both tests failed for the expected reasons before translation.
- [x] Translate source strings, comments, fixture text, test names and assertions; use English locale display names and default document language. Focused unit checks and the complete integration rerun passed; legacy storage compatibility remains explicit.
- [x] Translate current and historical documentation, retaining technical facts; record the permanent English-only policy in `AGENTS.md`. All original numeric tokens and historical-plan code-fence/checkbox counts were retained.
- [x] Run `npm run verify` and `npm run test:integration`; inspect the complete diff and language scan. Verify passed 146/146; the final full integration rerun passed 37/37. Record the initial cleanup-only EBUSY and successful reruns without code changes. Fresh-context review found no Critical/Important issues; minor follow-ups are in TODO.md.
- [x] Update GitHub metadata in English; preserve the old local history and publish an English root commit with a guarded push. The coordinator executes the guarded push only after auditing the exact root tree; the archive remains local under refs/archive and in a verified external bundle.
- [x] Verify the remote branch, root ancestry, English-only tree, and private visibility. Preserve the user-supplied untracked ico/ directory without integrating or publishing it. Final remote verification is the publication gate recorded by the coordinating session.
