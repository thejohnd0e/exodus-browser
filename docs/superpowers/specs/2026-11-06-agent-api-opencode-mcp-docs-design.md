# Agent API and OpenCode MCP documentation design

## Intent

Help Exodus Browser users connect OpenCode to the local Agent API safely and consistently across sessions. Replace the README's generic client example, which places a key directly in configuration, with a brief overview and a link to a focused setup guide.

## Goals

- Keep the README Agent API section concise and link to `docs/agent-api.md`.
- Document the Windows/OpenCode V2 global MCP setup using the repository's local `tools/mcp/exodus-mcp.mjs` adapter.
- Show how to supply the API URL and token without embedding the token in JSON, shell arguments, or chat; document a local protected token file and OpenCode `{file:...}` substitution.
- Cover enabling the API, creating an integration-specific key, granting least-privilege profile/proxy access, starting OpenCode, and confirming `exodus connected` plus the status/profile-list tools.
- State adapter limitations, that the adapter is source-distributed rather than included as a standalone installer file, and basic token rotation troubleshooting.
- Publish the docs together with a fresh patch release, then remove the currently published 1.2.6 GitHub release and its assets while retaining the `v1.2.6` Git tag.

## Non-goals

- Change Agent API or MCP adapter behavior.
- Add dependencies, expose or copy any user token, or grant API permissions automatically.
- Rewrite remote Git history as part of this documentation/release task.
- Delete the historical `v1.2.6` Git tag.

## Approaches

1. Rewrite the README section only. Smallest diff, but leaves a dense setup procedure in the landing page.
2. Add a standalone guide only. Keeps the README untouched but makes the setup harder to discover.
3. **Selected:** concise README overview plus a dedicated, linked `docs/agent-api.md`. This keeps discovery easy while allowing a safe, exact OpenCode walkthrough.

## Constraints and release

- All committed text must be English.
- OpenCode configuration must use the V2 `mcp.servers` shape and preserve unrelated global settings.
- GitHub currently publishes 1.2.6; local master is at 1.2.7 and ahead of origin by two commits. The new documentation release will therefore use version 1.2.8 and a fresh installer, following the repository's release-version rule.
- After publishing 1.2.8, delete the GitHub release record and release assets for 1.2.6; preserve its Git tag and repository history.

## Verification

- Review all documentation for accurate commands, paths, secret handling, and English-only text.
- Run `npm run verify` and `npm run test:integration` as required by the repository.
- Build the 1.2.8 installer only after committing its fresh version bump; verify package version, artifact hash and updater metadata.
- Confirm the GitHub release/tag and remote branch state before and after publication; verify 1.2.8 is published and 1.2.6 release assets are removed while its tag remains.
