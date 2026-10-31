# Wordmark Equal Margins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crop excess right-side background from the displayed wordmark so its visible artwork has approximately equal small left, right, and top margins.

**Architecture:** Keep the original PNG and clipped viewport. Reduce the displayed image width and adjust its horizontal and vertical offsets so the visible content, rather than the full bitmap, has approximately 6–8 px margins around the left, right, and top edges.

**Tech Stack:** CSS, Electron, Playwright/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-wordmark-crop-design.md`

## Global Constraints

- Do not modify the source PNG, favicon, native icon, sidebar width, or unrelated UI.
- Keep the artwork's proportions; crop only at display time.
- Keep tracked text in English.
- Run `npm run verify` and `npm run test:integration`.

## Review Focus

- Visible left/right/top artwork margins stay approximately equal at standard and narrow window widths; integration test checks the selected image crop dimensions and existing viewport bounds.
- The source PNG remains byte-for-byte unchanged; existing branding integration assertion covers it.

---

### Task 1: Balance the visible wordmark margins

**Files:**
- Modify: `src/renderer/styles.css` — scale and offset the existing image within its clipping viewport.
- Modify: `tests/integration/app-smoke.test.ts` — assert the crop dimensions/offset and preserve existing viewport checks.
- Update: `STATUS.md` and `docs/verification.md` — record the change and verification results.

**Interfaces:** Keep the existing `.brand-logo-viewport` and accessible image name; no new interfaces.

- [x] **Step 1: Add the Electron regression assertion** for image width `455px`, left offset `-32px`, and top offset `-26px` inside the existing 264px viewport.
- [x] **Step 2: Run** `npx vitest run tests/integration/app-smoke.test.ts -t "loads the supplied wordmark"`; confirmed it failed on the old `475px` / `-39px` crop.
- [x] **Step 3: Update the CSS crop** to `width:455px; left:-32px; top:-26px`, retaining the original proportions and source asset.
- [x] **Step 4: Re-run the targeted Electron integration test** and confirmed it passes at both tested widths.
- [x] **Step 5: Run** `npm run verify` and `npm run test:integration`; both passed, and results are recorded in status and verification docs.
