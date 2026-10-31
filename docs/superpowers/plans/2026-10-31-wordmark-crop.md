# Wordmark Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display the supplied sidebar wordmark at near-full panel width by cropping its built-in margins without modifying the asset.

**Architecture:** Keep the existing `<img>` contract and wrap/clip it in a fixed-size logo viewport. CSS scales and positions the image proportionally. An Electron integration assertion pins the visible viewport dimensions and unchanged source asset.

**Tech Stack:** React, CSS, Electron, Playwright/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-wordmark-crop-design.md`

## Global Constraints

- Preserve `ico/exodus-wordmark.png` bytes and native icon/favicon contracts.
- Do not change sidebar width or profile data/lifecycle behavior.
- Keep all tracked text in English.
- Use the existing Electron integration test and run `npm run verify` plus `npm run test:integration`.

## Review Focus

- Artwork is clipped rather than distorted: assert the visible logo viewport stays within the sidebar and uses the approved near-full width.
- Source asset remains unchanged: existing asset-byte integration assertion continues to pass.
- Narrow layout has no horizontal overflow: existing responsive-width coverage continues to pass.

---

### Task 1: Crop the sidebar wordmark at display time

**Files:**
- Modify: `src/renderer/App.tsx` — wrap the existing image with a clipping viewport.
- Modify: `src/renderer/styles.css` — scale and offset the image proportionally inside the viewport.
- Modify: `tests/integration/app-smoke.test.ts` — assert the visible viewport nearly fills the sidebar logo width.

**Interfaces:** Uses the existing imported wordmark asset and its `alt="Exodus Browser"` contract; no new interfaces.

- [x] **Step 1: Add the Electron regression assertion** for a logo viewport at least 250 px wide within the existing 280 px sidebar and a visible image contained by that viewport.
- [x] **Step 2: Run** the unit contract test and confirm it fails because the clipping viewport is absent.
- [x] **Step 3: Add the clipping viewport and proportional image crop** using CSS; do not modify the PNG.
- [x] **Step 4: Re-run the targeted Electron integration test** and confirm it passes at standard and narrow viewports.
- [x] **Step 5: Run** `npm run verify` and `npm run test:integration`; both must pass.
