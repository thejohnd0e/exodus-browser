# English-only repository

## Approved scope

The owner requires all material published to GitHub to be English, including source comments, UI strings, error messages, test names and fixtures, documentation, commit messages, and repository metadata. Conversation language is independent of repository language. The product name is Exodus Browser.

## Approach

Translate the existing project in place, retaining the complete technical documentation and behavior. Do not merely hide documentation with ignore rules. Do not change BCP47 identifiers or reject user-entered non-English data. Preserve the legacy `Local Profiles` application data directory to avoid silently switching databases.

Ordinary translation commits would leave Russian content reachable in Git history. Preserve the former history under a local-only `refs/archive/` reference and in a standalone bundle outside the repository, construct one English root commit from the verified tree, and replace only remote `master` using an explicit expected old hash with `--force-with-lease`. Keep the archive outside `refs/heads/` so a normal `git push --all` cannot accidentally republish it. Never mirror-push the archive or publish old tags. GitHub may retain previously pushed unreachable objects; rewriting the branch is not a guarantee of physical server-side erasure.

## Verification

Add a repository text regression test that rejects Cyrillic in tracked text, without imposing an English-only input restriction on the application. Check rendered language names use English, run `npm run verify` and `npm run test:integration`, inspect the replacement commit ancestry and pushed tree, and verify repository visibility remains private.

## Non-goals

No fingerprint, proxy, migration, or process-lifecycle changes. The previously requested removal of duplicate interface headings is separate from this translation.
