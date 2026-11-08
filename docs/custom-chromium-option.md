# Option: a patched Chromium engine (research, not planned)

Status: research only, recorded 2026-11-08. Nothing here is approved or scheduled. The current
engine is Google Chrome with the CDP fingerprint installer (see `engine-and-antifraud.md`).
The goal of this note is to keep the numbers, so the question does not have to be researched again.

## Why it could matter

A patch inside Chromium (C++) is not visible through `Function.prototype.toString`, prototype or
stack checks, and covers pages, workers and out-of-process frames without extra code. It would
remove the known limits of script patching listed in DECISIONS (#76, #85, #86): canvas noise,
stylesheet `@media` and `device-aspect-ratio` in OOPIF frames, the first-document race.

## Existing third-party engines

| Candidate | Finding | Verdict |
|---|---|---|
| fingerprint-chromium (adryfish) | BSD-3 fork of ungoogled-chromium. Latest 150.0.7871.186 (2026-10-02); releases every 1-4 months, 148 to 150 took over three months while Chrome stable was at 157. Binaries are built by one author; patches are published only about a month after the binary ("delayed source release"); no reproducible build; no support. Spoofs UA and Client Hints, OS, audio, plugins, cores, memory, fonts, canvas, ClientRects, WebRTC, language, timezone and hides CDP use. **GPU vendor/model (WebGL metadata) only on Linux.** | Not adopted: version lag, unverifiable binaries, no GPU spoof on Windows. |
| Camoufox (Firefox fork) | Clean C++ patches, but a different engine: no CDP, no Chrome extensions, needs a separate adapter and Firefox-only profiles. | Only as a separate product mode, weeks of work. |
| Commercial engines (Orbita, SunBrowser, ...) | Closed, licence does not allow reuse. | Excluded. |
| Brave, ungoogled-chromium, Mullvad | Privacy browsers (uniform or noisy fingerprint), not profile-driven spoofing. | Not suitable. |

## Building our own

- Requirements (official Chromium docs for Windows): Windows 10+, Visual Studio 2022, Windows 11 SDK,
  about 100 GB free on NTFS, 16 GB RAM minimum, more is better. First build 2-8 hours depending on
  hardware, later builds incremental. The development machine (128 GB RAM, several TB free) meets this.
- Base: ungoogled-chromium (BSD-3), then our own patches. Patch sets of other projects are not reused.
- Hosted CI is not enough (time and disk limits); a self-hosted runner or a VM is needed.
- The real cost is upkeep, not the first build: Chrome ships every 4 weeks, so patches must be
  rebased, tested and released as a signed engine each time, and the in-app engine updater must
  handle it. Falling behind loses the advantage of a current Chrome.
- A custom build differs from retail Chrome (flags, missing Google components, version); strong
  anti-fraud checks may see this, so every module needs verification against real Chrome.

## Rough token estimate (order of magnitude, not measured)

Total processed tokens including cached context reads; output tokens are far fewer.

| Stage | Estimate |
|---|---|
| 1. Trial build of vanilla ungoogled-chromium and our test suite on it | 0.3-1 M |
| 2. First module (canvas, ClientRects, fonts) with tests | 2-5 M |
| 3. Remaining fingerprint (audio, WebGL/GPU process, navigator and Client Hints, screen, workers, WebRTC, timezone) | 10-25 M |
| 4. Engine adapter, signing and verification, engine updater, docs | 2-4 M |
| 5. Upkeep per Chrome release (rebase and retest) | 1-3 M, up to 5 M+; 15-40 M a year |

Builds themselves cost little: they run in the background and only log tails are read.

## If it is ever taken up

1. Stage 1 first, plus one tiny patch that reaches a page, and record the real token and time cost.
2. Decide on upkeep before stage 2: commit to the 4-week cadence or do not start.
3. Start with what script patching cannot cover; keep the CDP installer as the fallback layer.
4. Re-check the third-party list first (versions, licences, source availability change quickly).
5. Preserve the rules in `AGENTS.md`: signed releases, no secrets in logs, renderer isolation.
