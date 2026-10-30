# Browser fingerprint, geolocation, and cookies

Status: approved by the user, 2026-10-30. Approach: option A (CDP). An independent design review raised 7 questions; answers are recorded in §7, and three user-visible decisions (language without “Auto,” screen as the actual window size, WebRTC Off by removing the API) were confirmed by the user.

## 1. Goal and context

Bring the application's capabilities closer to an anti-detect browser in the three areas needed first:

1. Profile **fingerprint**: OS/User-Agent, WebRTC, Canvas, WebGL and its vendor/renderer, WebGPU, ClientRects, timezone, language, CPU/memory, screen, audio.
2. **Geolocation**: Auto (unchanged) or Manual (coordinates).
3. Profile **cookie import and export**, compatible with Dolphin exports.

Target websites are ordinary services for personal work (Claude and similar sites), not platforms with specialized anti-bot systems. The requirement is therefore a **consistent** fingerprint, not a battle against FingerprintJS/DataDome: values must tell one coherent story (OS ↔ UA ↔ Client Hints ↔ GPU ↔ screen ↔ timezone ↔ language), remain stable across launches, and differ between profiles.

### Findings from analyzing Dolphin (2026-10-30, build 2026.295.27762)

- Fingerprints are implemented **natively in their own Chromium fork**, `anty.exe` (currently core 152). Parameters arrive from their server as an encrypted `config` in the browser launch command; they cannot be decrypted without the server, and project rules prohibit using the binary itself.
- Their cookies are written by a **Rust addon directly into the profile's `Default/Cookies`** SQLite database; there is no remote API for this.
- **The reproducible part is the cookie format and semantics** (local mass-import API):
  - bulk import columns: `Profile name, Cookie, Proxy type, Proxy, User Agent, Notes`;
  - cookies in JSON (an array of objects) or Netscape format;
  - JSON fields: `domain, name, path, value, expirationDate (or expires), httpOnly, secure, sameSite, storeId`;
  - normalization: `expires` → `expirationDate`; `name/value/domain/path` → strings; `httpOnly/secure` from `"true"`; `storeId` defaults to `"0"`; `sameSite` defaults to `"unspecified"`; choose the first expiration from `[t, t*1000, t/1000]` that is greater than `now` and no later than the year 2100, otherwise `now + 1 year`; for names `c_user, xs, fr, datr, sb`, force `httpOnly=true, secure=true, sameSite=no_restriction`; add a leading dot to `facebook.com`.

This confirms that their method cannot be copied (we have neither the fork nor the server), but **the cookie data model and rules transfer directly**—Dolphin exports will import without loss.

### Current project state

The engine is standard Chrome for Testing 156, launched with `spawn` and `--user-data-dir/--lang/--proxy-server`; CDP is not used, and the adapter declares `capabilities.fingerprints: false`. Profiles are stored as JSON blocks in SQLite (user_version 2); backups use manifest v1/v2. Full anti-detection is listed in TODO as P3, “outside the first version.”

## 2. Approaches

1. **A CDP session per profile + an injected script (selected by the user).** Half the parameters are native (UA/Client Hints, timezone, locale, screen, geolocation, permissions, cookies); the rest use a script at the very start of the document. Works with the already-pinned CfT, is testable with Playwright, and does not require a custom engine.
2. **Our own MV3 extension with MAIN-world scripts.** No debugging port is needed, but Client Hints and headers cannot be overridden this way; per-profile configuration must be written into extension files, adding more code and failure points for fewer capabilities. Retained as a fallback if the port proves unacceptable.
3. **Our own Chromium fork, like Dolphin's.** True parity, but months of C++ work and ongoing build maintenance. Rejected.

**Direct cookie writes to SQLite** (Dolphin's method) were separately rejected: standard Chrome protects cookies with app-bound encryption (`v20`), so reliable writes are impossible without a custom addon. Cookies go through CDP.

## 3. Agreed requirements

- Three blocks in one phase, in order: fingerprint → geolocation → cookies.
- The parameter set matches Dolphin's interface in the screenshots: OS, User-agent, WebRTC (Off/Real/Disable UDP/Altered), Canvas (Off/Real/Noise), WebGL (Off/Real/Noise), WebGL Info (Real/Manual with vendor and renderer), WebGPU (Off/On), ClientRects (Real/Noise), Timezone (Auto/Manual), Language (Auto/Manual), Geolocation (Auto/Manual), CPU (cores), architecture, memory, MAC (Off), device name (Off), Audio (Real), Screen (Real), a “New fingerprint” button, and a profile summary.
- The fingerprint is configured **per profile**, applied at launch, and does not change an already-running browser.
- Dolphin code may be reused; its branding may not.

## 4. Proposed implementation

### 4.1 CDP transport and launch order

- Add `--remote-debugging-port=0` at launch; read `ws://127.0.0.1:<port>/devtools/browser/<id>` from browser **stderr** (`DevTools listening on …`). The port is ephemeral and listens only on loopback; the URL is not logged or exposed in DTOs.
- Use our own minimal CDP client (JSON-RPC over Node 22's built-in `WebSocket`): `send(method, params)` with a timeout, event subscriptions, and waiting for `ready`. No new npm dependencies.
- **Invariant:** the browser starts at `about:blank`; startup URLs open only after all fingerprint settings have been applied to the page. If CDP does not connect or settings fail to apply, launch fails with `FINGERPRINT_UNAVAILABLE`, the browser closes, and the profile does not enter `running`. Silent launch “without spoofing” is prohibited.
- Enable `Target.setAutoAttach {autoAttach:true, waitForDebuggerOnStart:true, flatten:true}` on the browser target; for each new page/popup/iframe target apply `Page.addScriptToEvaluateOnNewDocument`, `Emulation.setTimezoneOverride`, `Emulation.setLocaleOverride`, `Network.setUserAgentOverride`, then `Runtime.runIfWaitingForDebugger`. This makes spoofing work in new tabs and after reloads.
- **Post-start failure policy.** The strict “no pages without spoofing” guarantee applies to pages (`page`, popup, iframe). If settings cannot be applied to a new page, close it with `Target.closeTarget` and show the user a separate message; the session and other tabs continue running. Workers, service workers, `devtools://`, and `chrome://` are excluded from the guarantee: `Page.*`/`Emulation.*` do not apply to them, and pressing F12 must not terminate the session. This is an explicit limitation, not a silent relaxation.
- When the browser exits, the CDP session closes with the process; it retains no separate state.

### 4.2 Native mechanisms versus scripts

| Parameter | Mechanism | Note |
|---|---|---|
| User-Agent, Client Hints | `Network.setUserAgentOverride` + `userAgentMetadata` | `Sec-CH-UA*` headers and `navigator.userAgentData` are consistent |
| Platform/OS | UA + metadata | no separate `navigator.platform` override is needed for Windows/macOS; Linux is adjusted by script |
| Timezone | `Emulation.setTimezoneOverride` | real `Intl`/`Date`, not a patch |
| Language | existing `--lang` and Preferences, no CDP override | Manual only: the `languages` field remains unchanged; do not use `Emulation.setLocaleOverride` to avoid contradicting the existing Accept-Language privacy decision. “Auto” is deferred |
| Screen | fingerprint-derived `--window-size` + scripted `screen.*`/`outer*` | actual window size, no fake viewport or DPR spoofing: DPR stays real |
| Geolocation | `Browser.grantPermissions` + `Emulation.setGeolocationOverride` | Manual; Auto has no override |
| WebRTC | `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` flag | see mode explanations below |
| Canvas, WebGL, WebGL Info, WebGPU, ClientRects, Audio | injected script | see 4.3 |
| CPU (cores), memory | script: `navigator.hardwareConcurrency`, `navigator.deviceMemory` | values from the summary |
| MAC, device name | not implemented | require OS/driver-level control; show “Off” in the UI as unmanaged |

The injected script is one compiled bundle (esbuild inlines it into main), with configuration passed as a literal. The script runs in the main world before any page code, in all frames, and must:
- override `CanvasRenderingContext2D.getImageData/toDataURL/toBlob` and `WebGLRenderingContext.readPixels` with deterministic noise;
- return the configured `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` and `VENDOR/RENDERER`;
- remove `navigator.gpu` when WebGPU = Off;
- add noise to `AnalyserNode.getFloatFrequencyData` when Audio = Noise (this version supports only Real/Noise, default Real);
- offset `getBoundingClientRect/getClientRects` by fractions of a pixel when ClientRects = Noise;
- override `navigator.hardwareConcurrency`, `navigator.deviceMemory`, `outerWidth/outerHeight`;
- for WebRTC: **Real**—no changes; **Disable UDP**—only the `disable_non_proxied_udp` flag; **Altered**—the flag plus rewriting local/private IPs in SDP to a stable private address (the public address is not exposed, and STUN through the proxy remains functional); **Off**—the flag plus removal of `RTCPeerConnection` (JS-level: websites checking API presence will notice, and some media sites will break—a warning is shown in the interface);
- preserve `Function.prototype.toString` for overridden native functions;
- **not** touch anything when a parameter = Real/Off (Canvas/WebGL Off = API disabled: methods return empty data and no context is created).

**Deterministic noise.** Profile seed = `sha256(profileId)`; noise is always identical within a profile and differs between profiles—otherwise repeat visits produce different canvas hashes, which is itself suspicious.

### 4.3 Fingerprint model and “New fingerprint”

```ts
type FingerprintMode = 'off' | 'real' | 'noise';
type Fingerprint = {
  os: 'windows11' | 'windows10' | 'macos' | 'linux';
  userAgent: string;                    // derived from OS and engine version; editable
  webRtc: 'off' | 'real' | 'disableUdp' | 'altered';
  canvas: FingerprintMode;
  webgl: FingerprintMode;
  webglInfo: { mode: 'real' | 'manual'; vendor?: string; renderer?: string };
  webgpu: 'on' | 'off';
  clientRects: 'real' | 'noise';
  timezone: { mode: 'auto' | 'manual'; value?: string };   // IANA
  geolocation: { mode: 'auto' | 'manual'; latitude?: number; longitude?: number; accuracy?: number };
  hardware: { cores: number; memoryGb: 0.5 | 1 | 2 | 4 | 8 };   // deviceMemory cannot report more than 8
  audio: 'real' | 'noise';
  screen: { width: number; height: number; dpr: number };        // dpr is real, not spoofed
};
```

- `languages` remains a separate existing profile field and is not duplicated in the fingerprint.
- “New fingerprint” generates a **consistent** set from a small local catalog: UA comes from templates for the selected OS **using the installed engine version** (a mismatch between the UA version and actual Chrome is a separate detection signal); select matching Client Hints, a typical resolution and DPR, core count and memory, and a vendor/renderer pair (Windows—ANGLE/D3D11, macOS—Apple/Metal, Linux—Mesa); timezone stays Auto.
- Consistency validation on save: UA contains the declared OS; vendor and renderer are nonempty for `webglInfo.mode='manual'`; coordinates are within valid ranges; DPR 1–3; cores 1–64; memory 1–128.
- New profile defaults are “unchanged” (`real`/`auto`, WebRTC Real, WebGPU On, Audio Real, Screen Real): existing profiles' behavior does not change.
- Memory is restricted to `0.5|1|2|4|8` GB because Chromium's `navigator.deviceMemory` reports no more than 8 and only powers of two; 32 GB in the summary would expose the spoofing. Screen dimensions use the actual window size (`--window-size`), excluding a fake viewport that does not fit the physical monitor.

### 4.4 Geolocation

- **Auto**—no override: the native permission prompt and real coordinates are used.
- **Manual**—`Browser.grantPermissions` for geolocation for the session + `Emulation.setGeolocationOverride {latitude, longitude, accuracy}` for each target.
- This version will not derive coordinates from the proxy IP: that would add a network service and another source of inconsistencies. Record the decision in `DECISIONS.md` as deliberately deferred.

### 4.5 Cookies: import and export

- **Formats:** Dolphin-compatible JSON (`domain, name, path, value, expirationDate, httpOnly, secure, sameSite, storeId`) and Netscape `cookies.txt`. Default export is JSON; both formats are read.
- **Import:** select a file through a native dialog in main (cookie values **do not pass through the renderer**), read with a limit of 5 MiB and 20,000 records, normalize using Dolphin's rules from §1 (including `expires` → `expirationDate`, expiration scale selection, `storeId`, `sameSite`, special names), then use `Network.setCookies` per domain with `urls` derived from domain/path/scheme (`secure` → https, otherwise both).
- **Export:** `Storage.getCookies` (browser-level, including httpOnly), filter expired entries, write to the selected file; Netscape uses the `#HttpOnly_` prefix for httpOnly.
- **Profile state:** `stopped` only, as with editing. For a stopped profile, start a temporary `--headless=new --remote-debugging-port=0 --user-data-dir=<profile>` instance with **the profile's proxy** (even headless browsers make startup requests), apply cookies, then close the instance. Same engine, same directory, nothing copied. For a running profile, refuse the operation with a clear message.
- **Temporary instance shutdown and durability.** Close the temporary instance through CDP `Browser.close` (graceful browser shutdown, not a PID kill; this does not violate `DECISIONS.md` #7 concerning unrelated processes), waiting for process exit. After import, read back with `Storage.getCookies`; only a match by domain+path+name yields `{count}`; otherwise return `COOKIES_NOT_PERSISTED`. This guards against “import succeeded, but Chromium did not have time to flush the database.”
- **Security:** cookie values are not logged or exposed in DTOs, error messages, or logs; the interface shows only the imported/exported record count and filename.
- Import **adds and overwrites** matching cookies (domain+path+name); do not implement “replace all”—it can easily destroy a session.

### 4.6 Storage, compatibility, backups

- SQLite table structure does not change; `user_version` stays 2: `fingerprint` is an optional profile JSON field. Read old records with defaults (§4.3); do not rewrite the database when reading.
- Add `fingerprint` to `ProfileInput`; strict Zod validation uses the same limits as §4.3.
- Backup manifest **v3** adds the fingerprint; read v1/v2 with defaults. The proxy password remains excluded from the archive.
- The fingerprint does not affect the Chromium directory or transfer data between profiles.

### 4.7 IPC and interface

- New operations: `importCookies(id)` and `exportCookies(id, format)`—both open a dialog in main and return `{count, fileName}`; `id` is a UUID; `format` is `'json'|'netscape'`.
- The profile editor gains a “Fingerprint” tab/section: blocks matching the Dolphin screenshot (OS buttons, UA, WebRTC/Canvas/WebGL/WebGL Info/WebGPU/ClientRects, Timezone/Language/Geolocation, CPU/memory/screen), a “New fingerprint” button, and a compact summary beside it.
- The profile card shows summary lines (platform, timezone, Canvas/WebGL) and “Import cookies…” / “Export cookies…” buttons, disabled for a running profile.
- All new fields undergo the same IPC checks: tuple schemas, UUID, trusted main frame, error allowlist.

### 4.8 Security and fault tolerance

- Residual risk: while a profile is running, the debugging port is accessible to local processes. Mitigations: `127.0.0.1` only, ephemeral port, no URL logging, session lifetime exactly matches the browser's, no external connections, and the client verifies host/port against those parsed from stderr. Record the risk in `DECISIONS.md`; alternatives (pipe or extension) are in §2.
- Timeouts: CDP connection 10 seconds, each command 5 seconds; on failure, close the browser with graceful `stop()` and set the profile to `error` rather than leaving it partially started.
- No fingerprint or cookie values are logged or included in argv (except `--lang`, `--proxy-server`, and `--force-webrtc-ip-handling-policy`, which are already public).

## 5. Out of scope

Android/iOS (“Soon” in the UI), MAC address and device name, WebGPU Manual Info, fonts, TLS/JA3, network-level “Altered,” automatic IP geolocation, importing entire Dolphin profiles, PAC/proxy chains, cloud. Existing P0 manual checks remain required.

## 6. Acceptance and tests

- **Test engine.** Automated tests use whichever Chromium the existing integration-test resolver finds (Playwright Chromium, or pinned CfT when explicitly specified), as in `tests/integration/languages.test.ts`; tests are not tied to a minor version and do not require WebGPU. Behavior specifically on CfT 156 requires a mandatory manual run recorded in `docs/verification.md`: otherwise automation cannot close acceptance in this environment.
- **Unit:** `fingerprint` schema and defaults, normalization of old records and v1/v2 backups; Dolphin cookie rules (expiration, `expires`, special names, `storeId`, `sameSite`); Netscape parser and serializer; seed determinism; launch argument construction; rejection of `webglInfo.mode='manual'` without vendor/renderer.
- **Integration (real Chromium):** for two profiles verify `navigator.userAgent`, `Sec-CH-UA*` in an HTTP request to a local server, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.language`, `screen.width/height`, `navigator.hardwareConcurrency/deviceMemory`; stable canvas/WebGL hashes across restarts of one profile and differences between profiles; WebGL vendor/renderer; Manual geolocation; cookie import → `document.cookie` and httpOnly availability to the server, export → lossless reimport.
- **Failure scenarios:** CDP fails to start (injected fault) → profile `error`, browser closed; corrupt/oversized file import → clear error without writing; import attempted while a profile is running → refusal.
- **UI/Electron:** “Fingerprint” tab, “New fingerprint,” summary, locks, and text; import/export dialogs do not leak values to the renderer.
- Final checks: `npm run verify` and `npm run test:integration`, independent review, updates to `STATUS.md`, `DECISIONS.md`, `TODO.md`, `docs/architecture.md`, `docs/verification.md`. Tests do not use real user data.

## 7. Decisions following design review (2026-10-30)

| Question | Decision |
|---|---|
| Which engine to use for automated tests | Whatever the existing resolver finds (Playwright Chromium or explicitly specified CfT); version-independent checks, CfT 156 requires a manual run in `verification.md` |
| Failure policy for targets after startup | Pages fail closed (close target, show message); workers/devtools/chrome:// excluded; do not kill the session because of F12 |
| Language in the fingerprint | Keep existing single-value `languages`; Manual only, do not use `setLocaleOverride`, “Auto” deferred |
| Closing the temporary instance | `Browser.close` over CDP with exit wait + read-back using `Storage.getCookies`; start the profile's proxy as in a normal launch |
| Screen semantics | Actual window size through `--window-size` and scripted `screen.*`; no `setDeviceMetricsOverride` or DPR spoofing |
| Memory range | Only `0.5/1/2/4/8` GB—what `deviceMemory` can report |
| WebRTC Off versus Disable UDP | Off = flag + removal of `RTCPeerConnection` (with warning), Disable UDP = flag only, Altered = flag + local IP rewriting in SDP |

## 8. Left to the implementer

Splitting the spoofing script into modules, exact UA/Client Hints templates and a GPU catalog for the engine version, specific labels and layout of the new tab, module and IPC handler names, and Netscape heuristics. Do not simplify requirements or security invariants for the sake of tests.
