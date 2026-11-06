# Agent API and OpenCode MCP Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an accurate English README overview and safe OpenCode V2 global MCP setup guide, then ship them in Exodus Browser 1.2.8 and remove the superseded 1.2.6 GitHub release.

**Architecture:** This is a documentation-only product change plus the repository's standard patch release workflow. The README links to a dedicated guide; the guide configures the existing local stdio adapter with the current loopback API URL and a token sourced from a local file reference, never an inline credential.

**Tech Stack:** Markdown, OpenCode V2 JSON configuration, Windows PowerShell, Node.js/npm, Electron Builder, Git and GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-11-06-agent-api-opencode-mcp-docs-design.md`

## Global Constraints

- All committed text must be in English.
- Use OpenCode V2's `mcp.servers` shape and preserve unrelated global settings in examples.
- Never place an API token in committed text, JSON values, command-line arguments, logs, or chat.
- The API remains loopback-only and requires explicit per-integration grants.
- Every installer build requires a fresh patch version and a `chore: release X.Y.Z` commit before `npm run dist`.
- Run `npm run verify` and `npm run test:integration` after changes.
- Delete only GitHub release `v1.2.6` and its release assets after the replacement is published; preserve the `v1.2.6` Git tag and existing Git history.
- Do not install the new build or rewrite remote Git history.

## Review Focus

- **API port changes after restart:** the guide must tell users to copy the current loopback address from Exodus rather than hard-code an example port; verify the guide describes updating the global server URL.
- **One-time/revoked credentials:** the guide must instruct creation of an integration-specific key, explain rotation, and never show a real-looking token; inspect all committed diffs for credential-shaped values.
- **Token file formatting and access:** the guide must use OpenCode file substitution and a user-local secret path, avoid shell-history exposure, and avoid adding a newline to the value; review exact Windows instructions.
- **Unrelated global MCP configuration:** only add an Exodus entry to example snippets; check JSONC validity and ensure other server entries are not replaced.
- **Old release removal:** verify `v1.2.8` and its assets are published before deleting only the `v1.2.6` GitHub release record/assets; confirm the tag still exists afterward.

---

### Task 1: Update README discovery and create the OpenCode guide

**Files:**
- Modify: `README.md` Agent API section
- Create: `docs/agent-api.md`
- Reference: `tools/mcp/exodus-mcp.mjs`, current OpenCode V2 MCP documentation, `package.json`

**Interfaces:**
- README exposes a short summary and link to `docs/agent-api.md`.
- The guide describes existing API and adapter behavior only; no runtime interfaces change.

- [x] **Step 1: Check factual source details** — confirm adapter path/tool inventory, current product version, and the OpenCode V2 global config and `{file:...}` syntax. Use placeholders for machine-specific paths and ports.
- [x] **Step 2: Rewrite the README Agent API section** — remove the generic client JSON example that embeds a token; state the API's local/authenticated/opt-in behavior, adapter distribution boundary, and link to the new guide.
- [x] **Step 3: Write `docs/agent-api.md`** — include prerequisites, UI enablement and grants, locating current API URL, safe Windows token-file creation/access guidance, exact OpenCode V2 global `mcp.servers` configuration with an environment file substitution, reload/status checks, available tools and safety limits, and troubleshooting for disabled API, changed port, revoked key, and missing grants.
- [x] **Step 4: Review documentation** — run `git diff --check`; inspect changed text for English-only copy, valid paths/config, no secrets, accurate tool count and links; validate any JSON example by parsing an equivalent JSON file without comments/trailing commas.
- [x] **Step 5: Commit documentation** — force-add only the new requested guide and required design/plan documents if the repository ignore rule excludes `docs/`; commit README and guide as `docs: explain global OpenCode MCP setup`.

### Task 2: Verify and version the release

**Files:**
- Modify via npm: `package.json`, `package-lock.json`
- Build outputs: ignored `dist/` and `dist-install/`
- Release metadata: `dist-install/SHA256SUMS`, `dist-install/latest.yml`

**Interfaces:**
- Release version: `1.2.8`.
- Expected installer: `dist-install/ExodusBrowser-Setup-1.2.8.exe`.

- [ ] **Step 1: Run project verification** — run `npm run verify`, then `npm run test:integration`; stop and report if either fails.
- [ ] **Step 2: Bump release patch** — run `npm version 1.2.8 --no-git-tag-version`, inspect package/lock changes, then commit only those files as `chore: release 1.2.8`.
- [ ] **Step 3: Build installer** — run `npm run dist` only after the release commit exists.
- [ ] **Step 4: Verify artifact metadata** — confirm installer exists and packaged version/app archive are valid; ensure `latest.yml` names 1.2.8; calculate SHA-256 and add the 1.2.8 line to `SHA256SUMS`; verify the recorded hash against the file.

### Task 3: Publish and retire the old GitHub release

**Files/Systems:**
- Git branch: local `master` and `origin/master`
- GitHub: release `v1.2.8`, then release record/assets for `v1.2.6`
- Preserve: Git tag `v1.2.6`

**Interfaces:**
- Publish local commits already ahead of origin plus the documentation and `1.2.8` release commits.
- Release assets include `ExodusBrowser-Setup-1.2.8.exe`, its blockmap if generated, `latest.yml`, and `SHA256SUMS`.

- [ ] **Step 1: Pre-push review** — inspect status, complete commit list, English-only tracked diffs, release artifacts, and confirm origin is a fast-forward target; do not push if remote diverged.
- [ ] **Step 2: Push `master`** — push the verified local commits to `origin/master`; do not force-push.
- [ ] **Step 3: Publish 1.2.8** — create GitHub release/tag `v1.2.8` with release notes and verified installer/update/checksum assets; confirm release and assets are visible.
- [ ] **Step 4: Delete the superseded release** — delete GitHub release `v1.2.6` and its assets only, without `--cleanup-tag`; confirm release `v1.2.8` remains latest and remote tag `v1.2.6` is still present.
- [ ] **Step 5: Report outcome** — provide release URL, installer name and SHA-256, commits pushed, old release deletion/tag preservation, and explicitly state that installation was not performed.
