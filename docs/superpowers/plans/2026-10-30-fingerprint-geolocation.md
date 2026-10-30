# Fingerprint and Geolocation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each profile a consistent browser fingerprint (UA/Client Hints, timezone, screen, Canvas, WebGL, WebGPU, ClientRects, cores/memory, WebRTC) and configurable geolocation, applied at startup through CDP without a custom engine.

**Architecture:** Launch standard CfT with `--remote-debugging-port=0`; read the DevTools address from stderr and connect a minimal CDP client to the browser. Apply native settings (UA/CH, timezone, screen, geolocation, permissions) using `Emulation.*`/`Network.*` methods and the rest through a script in `Page.addScriptToEvaluateOnNewDocument` before the first navigation. Any startup failure aborts the launch.

**Tech Stack:** Electron 45, TypeScript strict, React 19, Zod 4, SQLite (`better-sqlite3`), Node 22's built-in `WebSocket`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-fingerprint-geolocation-cookies-design.md`

## Global Constraints

- Windows x64, Node 22, existing dependency versions; no new npm dependencies — the CDP client uses built-in `WebSocket`.
- Do not weaken `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP, or trusted main-frame checks.
- Do not log fingerprint values; argv contains only `--lang`, `--proxy-server`, `--force-webrtc-ip-handling-policy`, `--window-size`, `--remote-debugging-port`.
- Keep the CDP debugging URL and cookies out of DTOs, logs, and error messages.
- All profile writes require a stopped profile (`withStopped`).
- Tests: `npm run verify`, `npm run test:integration`; integration tests use the engine found by `tests/integration/languages.test.ts`, otherwise report an honest `BLOCKED`.
- Memory only `0.5|1|2|4|8` GB; do not spoof DPR; screen = actual window size.
- Language remains the existing singleton `languages` without `Emulation.setLocaleOverride`.

## Review Focus

1. Profile with an unavailable proxy: launch must fail with a clear error and must not open a window without its fingerprint.
2. User pastes a UA containing `\n` or 5000 characters: argv is not broken; saving is rejected.
3. Slow disk/antivirus: CDP does not start within 10 seconds — close the browser, profile becomes `error`, restarting remains possible.
4. Website opens a popup and workers: the popup receives the same values; workers and `devtools://` do not terminate the session.
5. Canvas/WebGL = Off: the page must not crash with an unhandled exception — return an empty result instead of data.
6. Two profiles with “Noise” on the same website: canvas hashes differ, but each profile's hash remains stable across restarts.

---

### Task 1: Fingerprint model, defaults, and validation

**Files:**
- Create: `src/shared/fingerprint.ts`
- Modify: `src/shared/contracts.ts`, `src/shared/validation.ts`
- Test: `tests/unit/fingerprint.test.ts`

**Interfaces:**
- Produces: `type Fingerprint`, `type FingerprintMode`, `DEFAULT_FINGERPRINT: Fingerprint`, `fingerprintSchema: z.ZodType<Fingerprint>`, `normalizeFingerprint(value: unknown): Fingerprint`. Add `fingerprint: Fingerprint` to `ProfileInput`, `Profile`, and `LaunchInput`.

- [ ] **Step 1: Write a failing test**

```ts
import {describe,it,expect} from 'vitest';
import {DEFAULT_FINGERPRINT,normalizeFingerprint,fingerprintSchema} from '../../src/shared/fingerprint';
import {parseProfileInput} from '../../src/shared/validation';
const base={name:'P',note:'',startUrls:['https://example.com'],languages:['ru-RU'],proxyId:null};
it('legacy profiles without a fingerprint receive unchanged system values',()=>{
  expect(normalizeFingerprint(undefined)).toEqual(DEFAULT_FINGERPRINT);
  expect(parseProfileInput({...base,fingerprint:undefined})).toMatchObject({fingerprint:DEFAULT_FINGERPRINT});
});
it('defaults do not override anything',()=>{
  expect(DEFAULT_FINGERPRINT).toMatchObject({userAgent:null,webRtc:'real',canvas:'real',webgl:'real',webgpu:'on',clientRects:'real',audio:'real',timezone:{mode:'auto'},geolocation:{mode:'auto'}});
});
it('rejects inconsistent and unsafe values',()=>{
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,userAgent:'Mozilla/5.0\nEvil'}).success).toBe(false);
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,userAgent:'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36',os:'windows11'}).success).toBe(false);
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,webglInfo:{mode:'manual'}}).success).toBe(false);
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,hardware:{cores:3,memoryGb:32}}).success).toBe(false);
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,geolocation:{mode:'manual',latitude:91,longitude:0,accuracy:10}}).success).toBe(false);
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,timezone:{mode:'manual',value:'Mars/Olympus'}}).success).toBe(false);
});
```

- [ ] **Step 2: Confirm that the test fails**

Run: `npx vitest run tests/unit/fingerprint.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/fingerprint'`.

- [ ] **Step 3: Implement the model**

Use the type from specification §4.3 with `userAgent: string | null`. Zod validation: UA ≤ 512 characters, no CR/LF, nonempty values must contain an OS marker (`Windows NT 10.0` for windows11/windows10, `Macintosh` for macos, `Linux` for linux); `webglInfo.mode='manual'` requires nonempty `vendor`/`renderer` (≤ 256, no CR/LF); `hardware.cores` is an integer 1–64, `memoryGb` is a literal union; `screen.width` 800–7680, `height` 600–4320, `dpr` 1–3; `geolocation.mode='manual'` requires latitude −90…90, longitude −180…180, accuracy 1…10000; validate `timezone.mode='manual'` values through `Intl.DateTimeFormat('en-US',{timeZone:value})` in `try/catch`. `normalizeFingerprint` parses the value and returns `DEFAULT_FINGERPRINT` on error only when reading legacy records; user input strictly passes through `fingerprintSchema`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/fingerprint.ts src/shared/contracts.ts src/shared/validation.ts tests/unit/fingerprint.test.ts
git commit -m "feat: add fingerprint profile model"
```

---

### Task 2: UA/Client Hints catalog, generator, and launch arguments

**Files:**
- Create: `src/main/engines/ua.ts`, `src/main/engines/fingerprint.ts`
- Test: `tests/unit/fingerprint-engine.test.ts`

**Interfaces:**
- Consumes: `Fingerprint`, `DEFAULT_FINGERPRINT`.
- Produces: `uaForOs(os: Fingerprint['os'], chromeVersion: string): string`; `metadataFor(ua: string, os: Fingerprint['os']): UserAgentMetadata | null` (null when the UA matches the engine's platform and major version); `newFingerprint(input: {os: Fingerprint['os']; chromeVersion: string; random: () => number}): Fingerprint`; `fingerprintArgs(fp: Fingerprint): string[]`; `seedFor(profileId: string): number`.

- [ ] **Step 1: Write a failing test**

```ts
it('builds UA for the engine version rather than a constant',()=>{
  expect(uaForOs('windows11','156.0.8078.80')).toContain('Chrome/156.0.8078.80');
  expect(uaForOs('macos','156.0.8078.80')).toContain('Macintosh; Intel Mac OS X 10_15_7');
  expect(uaForOs('linux','156.0.8078.80')).toContain('X11; Linux x86_64');
});
it('requires Client Hints only when the platform or version changes',()=>{
  expect(metadataFor(uaForOs('windows11','156.0.8078.80'),'windows11')).toBeNull();
  expect(metadataFor(uaForOs('macos','156.0.8078.80'),'macos')).toMatchObject({platform:'macOS',mobile:false,bitness:'64'});
});
it('generator produces a consistent set',()=>{
  const fp=newFingerprint({os:'windows10',chromeVersion:'156.0.8078.80',random:()=>0.5});
  expect(fp.userAgent).toContain('Windows NT 10.0');
  expect(fp.webglInfo.mode).toBe('manual');
  expect(fp.webglInfo.renderer).toContain('ANGLE');
  expect([0.5,1,2,4,8]).toContain(fp.hardware.memoryGb);
  expect(fp.timezone.mode).toBe('auto');
});
it('arguments contain only public flags',()=>{
  expect(fingerprintArgs({...DEFAULT_FINGERPRINT,webRtc:'disableUdp',screen:{width:1920,height:1080,dpr:1}})).toEqual(['--window-size=1920,1080','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);
  expect(fingerprintArgs({...DEFAULT_FINGERPRINT,webRtc:'real',screen:{width:1366,height:768,dpr:1}})).toEqual(['--window-size=1366,768']);
});
it('seed is stable and differs between profiles',()=>{
  expect(seedFor('a')).toBe(seedFor('a'));
  expect(seedFor('a')).not.toBe(seedFor('b'));
});
```

- [ ] **Step 2: Run the test (expected failure)**

Run: `npx vitest run tests/unit/fingerprint-engine.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`uaForOs`: three template strings with version substitution; display/GPU catalog (Windows: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)`, `ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 …)`, `ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 …)`; macOS: `Apple GPU`/`Apple M2`; Linux: `Mesa/Intel`). `newFingerprint` uses `random()` to choose a resolution typical for the OS, cores from `[4,8,12,16]`, memory from `[4,8]`, a vendor/renderer pair, `canvas/webgl/clientRects: 'noise'`, `webgpu:'on'`, `audio:'real'`, `timezone/geolocation:'auto'`. `metadataFor` returns null if the UA platform and major version match the host (Windows) and engine version; otherwise returns `{brands:[{brand:'Chromium',version:major},{brand:'Google Chrome',version:major},{brand:'Not_A Brand',version:'24'}],fullVersion,fullVersionList,platform,platformVersion,architecture:'x86',model:'',mobile:false,bitness:'64',wow64:false}`. `seedFor` = first 4 bytes of `sha256(profileId)` as uint32.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/fingerprint-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/engines/ua.ts src/main/engines/fingerprint.ts tests/unit/fingerprint-engine.test.ts
git commit -m "feat: add fingerprint presets and launch args"
```

---

### Task 3: Minimal CDP client

**Files:**
- Create: `src/main/cdp/client.ts`
- Test: `tests/unit/cdp-client.test.ts`

**Interfaces:**
- Produces: `parseDevtoolsUrl(line: string): string | null`; `class CdpClient { static connect(url: string, options?: {factory?: (url: string) => CdpSocket; connectTimeoutMs?: number}): Promise<CdpClient>; send<T>(method: string, params?: Record<string, unknown>, sessionId?: string, timeoutMs?: number): Promise<T>; onEvent(listener: (message: CdpMessage) => void): void; close(): void }`; `interface CdpSocket { send(data: string): void; close(): void; onmessage: ((event: {data: string}) => void) | null; onclose: (() => void) | null; onerror: ((error: unknown) => void) | null }`.

- [ ] **Step 1: Write a failing test with a fake socket**

```ts
it('extracts the address from stderr and ignores other output',()=>{
  expect(parseDevtoolsUrl('DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc')).toBe('ws://127.0.0.1:9222/devtools/browser/abc');
  expect(parseDevtoolsUrl('[123:ERROR] something')).toBeNull();
});
it('matches responses by id and rejects on timeout',async()=>{
  const sent:any[]=[];const fake={send:(d:string)=>sent.push(JSON.parse(d)),close(){},onmessage:null,onclose:null,onerror:null};
  const client=await CdpClient.connect('ws://127.0.0.1:1/x',{factory:()=>fake as any,connectTimeoutMs:50});
  const call=client.send('Emulation.setTimezoneOverride',{timezoneId:'Europe/Moscow'});
  const request=sent.at(-1);fake.onmessage!({data:JSON.stringify({id:request.id,result:{}})});
  await expect(call).resolves.toEqual({});
  await expect(client.send('Slow.method',{},undefined,20)).rejects.toThrow('CDP_TIMEOUT');
});
it('rejects pending calls on close',async()=>{/* similarly: pending → CDP_CLOSED */});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/cdp-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`parseDevtoolsUrl`: regex `/(ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/`. `connect` creates a socket through `factory ?? (url => new WebSocket(url) as unknown as CdpSocket)` and waits for it to open with a timeout (Node `WebSocket` does not provide an `onopen` property — use `addEventListener('open', …)` through an adapter; wrap it in the default factory). `send` adds an entry to `Map<number, {resolve, reject, timer}>`; events without `id` go to `onEvent`; `close`/`onclose`/`onerror` reject everything with `CDP_CLOSED`; timeout is `CDP_TIMEOUT`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/cdp-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cdp/client.ts tests/unit/cdp-client.test.ts
git commit -m "feat: add minimal cdp client"
```

---

### Task 4: Spoofing script generator

**Files:**
- Create: `src/main/engines/spoof-script.ts`
- Test: `tests/unit/spoof-script.test.ts`

**Interfaces:**
- Consumes: `Fingerprint`, `seedFor`.
- Produces: `buildSpoofScript(fingerprint: Fingerprint, seed: number): string` — a self-contained IIFE string; `spoofConfig(fingerprint: Fingerprint, seed: number): Record<string, unknown>`.

- [ ] **Step 1: Write a failing test**

```ts
it('script is a safe literal with the required values',()=>{
  const script=buildSpoofScript({...DEFAULT_FINGERPRINT,canvas:'noise',webglInfo:{mode:'manual',vendor:'Google Inc. (NVIDIA)',renderer:'ANGLE (NVIDIA…)'},hardware:{cores:12,memoryGb:8},webgpu:'off'},7);
  expect(script.startsWith('(()=>{')).toBe(true);
  expect(script).toContain('ANGLE (NVIDIA');
  expect(script).toContain('"cores":12');
  expect(()=>new Function(script)).not.toThrow();
});
it('quotes in values do not break the literal',()=>{
  const script=buildSpoofScript({...DEFAULT_FINGERPRINT,webglInfo:{mode:'manual',vendor:'a"b',renderer:"c'd\\e"}},1);
  expect(()=>new Function(script)).not.toThrow();
});
it('real mode does not patch canvas',()=>{
  expect(buildSpoofScript({...DEFAULT_FINGERPRINT,canvas:'real',webgl:'real'},1)).not.toContain('getImageData');
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/spoof-script.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Serialize the configuration with `JSON.stringify` and insert it into the template; no name interpolation. The template patches only enabled modes, wraps overrides in `Object.defineProperty` with `configurable:true`, preserves `Function.prototype.toString` for overridden functions, and leaves `webdriver`-independent values untouched. Noise generator: mulberry32(seed), applied to `getImageData` (one bit of the lowest channel), `toDataURL/toBlob` (through a private canvas context), `readPixels` (last byte of the block). `Off` for canvas/webgl: methods return an empty array/transparent image; a context is created, but `getParameter` returns `null`. `webgpu:'off'`: `delete` through `Object.defineProperty(navigator,'gpu',{get:()=>undefined})`. `clientRects:'noise'`: seed-based offset of ±0.02 px. `hardware`: `hardwareConcurrency`, `deviceMemory`. `webRtc:'off'`: remove constructors; `'altered'`: wrap `RTCPeerConnection` to rewrite private IPs in `localDescription`. Screen: override `screen.width/height/availWidth/availHeight` and `outerWidth/outerHeight` to match `fingerprint.screen`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/spoof-script.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/engines/spoof-script.ts tests/unit/spoof-script.test.ts
git commit -m "feat: generate fingerprint spoof script"
```

---

### Task 5: Applying the fingerprint through CDP

**Files:**
- Create: `src/main/cdp/fingerprint.ts`
- Test: `tests/unit/cdp-fingerprint.test.ts`

**Interfaces:**
- Consumes: `CdpClient`, `buildSpoofScript`, `metadataFor`.
- Produces: `interface InstallOptions {fingerprint: Fingerprint; languages: string[]; seed: number; onPageFailure?: (reason: string) => void}`; `installFingerprint(client: CdpClient, options: InstallOptions): Promise<void>`; `navigate(client: CdpClient, urls: string[]): Promise<void>`.

- [ ] **Step 1: Write a failing test with a fake client**

```ts
it('sets native parameters and the script for every page',async()=>{
  const calls:string[]=[];const client={send:async(m:string,p:any,s?:string)=>{calls.push(`${m}${s?':'+s:''}`);if(m==='Target.getTargets')return{targetInfos:[{targetId:'t1',type:'page'}]};if(m==='Target.attachToTarget')return{sessionId:'s1'};return{};},onEvent:()=>{},close(){}} as any;
  await installFingerprint(client,{fingerprint:{...DEFAULT_FINGERPRINT,timezone:{mode:'manual',value:'Europe/Moscow'},geolocation:{mode:'manual',latitude:55.75,longitude:37.61,accuracy:30}},languages:['ru-RU'],seed:1});
  expect(calls).toContain('Target.setAutoAttach');
  expect(calls).toContain('Page.addScriptToEvaluateOnNewDocument:s1');
  expect(calls).toContain('Emulation.setTimezoneOverride:s1');
  expect(calls).toContain('Emulation.setGeolocationOverride:s1');
  expect(calls).toContain('Browser.grantPermissions');
});
it('does not set timezone or geo in auto mode',async()=>{/* no such calls */});
it('failure on a new page closes it but not the session',async()=>{/* attachedToTarget(page) + send rejects → Target.closeTarget, onPageFailure called */});
it('a worker is not treated as a page and is still resumed',async()=>{/* type worker → Runtime.runIfWaitingForDebugger, no Page.* */});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/cdp-fingerprint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Order: `Target.setAutoAttach {autoAttach:true,waitForDebuggerOnStart:true,flatten:true}` → `Target.getTargets` → for each `type==='page'`, `Target.attachToTarget {flatten:true}` and `applyToPage`; subscribe through `onEvent` to `Target.attachedToTarget` using the same logic. `applyToPage(sessionId)`: `Page.addScriptToEvaluateOnNewDocument {source}`, `Network.setUserAgentOverride {userAgent, acceptLanguage: languages[0], platform, userAgentMetadata?}` (only if `metadataFor` returned an object), `Emulation.setTimezoneOverride` for manual, `Emulation.setGeolocationOverride` for manual; **do not** call `Emulation.setDeviceMetricsOverride`. Call `Browser.grantPermissions {permissions:['geolocation']}` once for manual geolocation. After applying, call `Runtime.runIfWaitingForDebugger`. For non-page targets, only `runIfWaitingForDebugger`; swallow errors without treating them as failures. `navigate` opens the first URL through `Page.navigate` in the first page target and the others through `Target.createTarget {url}`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/cdp-fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cdp/fingerprint.ts tests/unit/cdp-fingerprint.test.ts
git commit -m "feat: apply fingerprint over cdp"
```

---

### Task 6: Launch with CDP and fail closed without spoofing

**Files:**
- Modify: `src/main/engines/types.ts`, `src/main/engines/chromium.ts`, `src/main/runtime/supervisor.ts`
- Test: `tests/integration/fingerprint.test.ts` (part 1), `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `CdpClient.connect`, `parseDevtoolsUrl`, `installFingerprint`, `navigate`, `fingerprintArgs`, `seedFor`.
- Produces: `EngineLaunch` with field `fingerprint: Fingerprint`; `capabilities: {fingerprints: true}`; new error codes `FINGERPRINT_UNAVAILABLE`, `INVALID_FINGERPRINT` in `src/main/ipc.ts`.

- [ ] **Step 1: Write a failing integration test**

```ts
it('applies UA, timezone, language, and screen before first navigation',async()=>{
  const server=await startHttpServer('<html><body>ok</body></html>');
  const {adapter,dir,close}=await launchWithFingerprint({userAgent:UA_MAC,timezone:{mode:'manual',value:'America/New_York'},languages:['en-US'],screen:{width:1512,height:982,dpr:1}});
  const page=await firstPage(adapter);
  const data=await page.evaluate(()=>({ua:navigator.userAgent,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,lang:navigator.language,w:screen.width,h:screen.height}));
  expect(data).toMatchObject({ua:UA_MAC,tz:'America/New_York',lang:'en-US',w:1512,h:982});
  await close();
});
it('launch without CDP leaves no browser behind',async()=>{/* replace the argument with a known occupied port → expect rejects FINGERPRINT_UNAVAILABLE, no chrome processes with this user-data-dir */});
```

- [ ] **Step 2: Run the test (expected failure)**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts`
Expected: FAIL — `EngineLaunch` does not accept `fingerprint`.

- [ ] **Step 3: Implement**

`chromiumArgs` no longer includes start URLs: always `about:blank` plus `--remote-debugging-port=0` and `fingerprintArgs(fingerprint)`. `launch`: `spawn(..., {stdio:['ignore','ignore','pipe']})`, accumulate stderr with a 64 KiB limit while searching with `parseDevtoolsUrl`, 10-second timeout → `FINGERPRINT_UNAVAILABLE`; `CdpClient.connect`, `installFingerprint(client, {fingerprint, languages, seed: seedFor(profileId)})`, `navigate(startUrls)`. On any error before returning `EngineProcess`, use `Browser.close` if CDP is alive, otherwise `child.kill()` for **the application's own just-created** process (identity is the `ChildProcess` handle, not a PID lookup), waiting up to 5 seconds for `exit`. `Supervisor.start` passes `fingerprint: p.fingerprint`; `getLaunchInput` returns the fingerprint.

- [ ] **Step 4: Run the tests**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts tests/unit/engine.test.ts`
Expected: PASS (or `BLOCKED` if Chromium is unavailable — record it in the report).

- [ ] **Step 5: Commit**

```bash
git add src/main/engines src/main/runtime/supervisor.ts tests/integration/fingerprint.test.ts
git commit -m "feat: launch chromium with cdp fingerprint"
```

---

### Task 7: New tabs and popups

**Files:**
- Modify: `src/main/cdp/fingerprint.ts`
- Test: `tests/integration/fingerprint.test.ts` (part 2)

- [ ] **Step 1: Write a failing test**

```ts
it('popup receives the same UA and timezone',async()=>{
  const url=await startHttpServer(`<script>window.open('/popup')</script>`);
  const page=await openProfileWith({userAgent:UA_MAC,timezone:{mode:'manual',value:'Asia/Tokyo'}});
  const popup=await waitForNewTarget(page);
  expect(await popup.evaluate(()=>({ua:navigator.userAgent,tz:Intl.DateTimeFormat().resolvedOptions().timeZone}))).toEqual({ua:UA_MAC,tz:'Asia/Tokyo'});
});
it('F12 and workers do not terminate the session',async()=>{/* open a worker through page.evaluate(new Worker(blob)) → browser alive, page responds */});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts -t "popup"`
Expected: FAIL — popup has no spoofing.

- [ ] **Step 3: Implement**

Use `Target.setAutoAttach` with `waitForDebuggerOnStart` and handle `Target.attachedToTarget`; for `type==='page'`, apply spoofing before `runIfWaitingForDebugger`. Report application failures on a page through `onPageFailure`, close the page with `Target.closeTarget`, and leave the session alone; in `Supervisor`, the handler writes a clear message to the profile's error state only for the initial page; for subsequent pages, leave the browser running.

- [ ] **Step 4: Run the test**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cdp/fingerprint.ts src/main/runtime/supervisor.ts tests/integration/fingerprint.test.ts
git commit -m "feat: fingerprint popups and spare workers"
```

---

### Task 8: JS layer in a real browser

**Files:**
- Modify: `src/main/engines/spoof-script.ts` (if needed)
- Test: `tests/integration/fingerprint.test.ts` (part 3)

- [ ] **Step 1: Write a failing test**

```ts
const canvasHash=page=>page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#123456';x.fillRect(0,0,64,64);return c.toDataURL().slice(-64)});
it('noise is stable per profile and differs between profiles',async()=>{
  const a1=await canvasHash(await openWith({canvas:'noise'},'profile-a'));
  const a2=await canvasHash(await openWith({canvas:'noise'},'profile-a'));
  const b=await canvasHash(await openWith({canvas:'noise'},'profile-b'));
  expect(a1).toBe(a2);expect(a1).not.toBe(b);
});
it('webgl returns the specified vendor and renderer',async()=>{/* UNMASKED_VENDOR_WEBGL === 'Google Inc. (NVIDIA)' */});
it('applies cores, memory, and absence of webgpu',async()=>{/* hardwareConcurrency=12, deviceMemory=8, navigator.gpu undefined */});
it('rejects long and multiline UA',()=>{
  expect(fingerprintSchema.safeParse({...DEFAULT_FINGERPRINT,userAgent:'Mozilla/5.0'+'x'.repeat(600)}).success).toBe(false);
});
it('canvas off does not crash the page',async()=>{/* getImageData returns an empty Uint8ClampedArray */});
it('webRTC off removes the constructor, altered does not reveal the public address',async()=>{
  expect(await page.evaluate(()=>typeof RTCPeerConnection)).toBe('undefined');
  const sdp=await page.evaluate(async()=>{const pc=new RTCPeerConnection({iceServers:[]});pc.createDataChannel('x');const o=await pc.createOffer();await pc.setLocalDescription(o);return pc.localDescription.sdp;});
  expect(sdp).not.toMatch(/192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./);
});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts -t "canvas"`
Expected: FAIL — hashes match the real ones.

- [ ] **Step 3: Implement**

Finish the template: apply pixel noise only to `getImageData`, `toDataURL`, `toBlob`, and `HTMLCanvasElement.prototype.toDataURL`; for WebGL, to `readPixels` and `getParameter` (`37445/37446`, `7936/7937`). `hardwareConcurrency`/`deviceMemory`: `Object.defineProperty` with `configurable:true`. `navigator.gpu` is `undefined` when `off`. Ensure exceptions inside overrides do not escape: wrap everything in `try/catch` returning the original value.

- [ ] **Step 4: Run the test**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/engines/spoof-script.ts tests/integration/fingerprint.test.ts
git commit -m "feat: verify canvas webgl and hardware spoofing"
```

---

### Task 9: Geolocation

**Files:**
- Modify: `src/main/cdp/fingerprint.ts`
- Test: `tests/integration/fingerprint.test.ts` (part 4)

- [ ] **Step 1: Write a failing test**

```ts
it('manual geolocation returns coordinates without a permission prompt',async()=>{
  const page=await openWith({geolocation:{mode:'manual',latitude:55.75,longitude:37.61,accuracy:25}});
  const pos=await page.evaluate(()=>new Promise(r=>navigator.geolocation.getCurrentPosition(p=>r({lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy}),e=>r({error:e.code}),{timeout:3000})));
  expect(pos).toEqual({lat:55.75,lon:37.61,acc:25});
});
it('auto geolocation does not silently grant permission',async()=>{/* getCurrentPosition → error or prompt, coordinates are not 55.75 */});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts -t "geolocation"`
Expected: FAIL — coordinates are not overridden.

- [ ] **Step 3: Implement**

Call `Browser.grantPermissions {permissions:['geolocation']}` once before first navigation only when `mode==='manual'`; call `Emulation.setGeolocationOverride {latitude, longitude, accuracy}` on each page target after `attach`. For `auto`, make neither call.

- [ ] **Step 4: Run the test**

Run: `npm run build && npx vitest run tests/integration/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cdp/fingerprint.ts tests/integration/fingerprint.test.ts
git commit -m "feat: apply manual geolocation"
```

---

### Task 10: Storage, read-time migration, v3 backups

**Files:**
- Modify: `src/shared/contracts.ts`, `src/main/profiles/service.ts`, `src/main/backups/service.ts`
- Test: `tests/unit/profiles.test.ts`, `tests/unit/migration.test.ts`, `tests/integration/backups.test.ts`

**Interfaces:**
- Produces: `ProfileInput.fingerprint`, `Profile.fingerprint`, `LaunchInput.fingerprint`; manifest v3 `{version:3, profile:{name,note,startUrls,languages,fingerprint,proxy}}`.

- [ ] **Step 1: Write failing tests**

```ts
it('reads a legacy record without a fingerprint using defaults without rewriting it',()=>{/* get() returns DEFAULT_FINGERPRINT, database row remains unchanged */});
it('update persists the fingerprint and advances updatedAt',()=>{});
it('v3 backup carries the fingerprint, v2 uses defaults',()=>{/* create → manifest.version===3; restore v2 fixture → DEFAULT_FINGERPRINT */});
```

- [ ] **Step 2: Run the tests (fail)**

Run: `npx vitest run tests/unit/profiles.test.ts tests/unit/migration.test.ts`
Expected: FAIL — `fingerprint` is not persisted.

- [ ] **Step 3: Implement**

`get()` calls `normalizeFingerprint(data.fingerprint)`; `create/update/restoreProfile` write the fingerprint unchanged after `parseProfileInput`. `getLaunchInput` adds `fingerprint`. In `backups/service.ts`, add a third `manifestSchema` branch (`version:3`), write `version:3`, and restore v1/v2 through `normalizeFingerprint(undefined)`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/profiles.test.ts tests/unit/migration.test.ts && npm run build && npx vitest run tests/integration/backups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts src/main/profiles/service.ts src/main/backups/service.ts tests/unit tests/integration/backups.test.ts
git commit -m "feat: persist fingerprint and back it up"
```

---

### Task 11: Fingerprint panel in the editor

**Files:**
- Create: `src/renderer/FingerprintPanel.tsx`
- Modify: `src/renderer/ProfileEditor.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- Test: `tests/unit/ui-fingerprint.test.tsx`

**Interfaces:**
- Consumes: `Fingerprint`, `newFingerprint`, `engineStatus().version`.
- Produces: `<FingerprintPanel value={Fingerprint} onChange={(next: Fingerprint) => void} disabled={boolean} chromeVersion={string | null} />`; the editor submits `fingerprint` in `onSave`.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('shows sections and changes modes',async()=>{/* click “Canvas → Noise” → onChange receives canvas:'noise' */});
it('“New fingerprint” fills UA with the engine version and enables noise',async()=>{/* chromeVersion='156.0.8078.80' → UA contains Chrome/156.0.8078.80, canvas==='noise' */});
it('manual WebGL Info requires vendor and renderer',async()=>{/* empty fields + save → error, onSave not called */});
it('selecting Manual for timezone/geolocation shows fields',async()=>{});
```

- [ ] **Step 2: Run the tests (fail)**

Run: `npx vitest run tests/unit/ui-fingerprint.test.tsx`
Expected: FAIL — component is missing.

- [ ] **Step 3: Implement**

Sections as specified: OS buttons (Windows 11/10, macOS, Linux; Android/iOS `disabled` with a “Soon” label), UA field (placeholder: the engine's real UA), toggle groups, Manual fields, “New fingerprint”. All controls use `disabled={disabled}`. In `ProfileEditor`, initialize `fingerprint` state with `profile?.fingerprint ?? DEFAULT_FINGERPRINT` and include it in `parseProfileInput` on submit. In `App`, pass `chromeVersion={engine.version ?? null}`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/ui-fingerprint.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/FingerprintPanel.tsx src/renderer/ProfileEditor.tsx src/renderer/App.tsx src/renderer/styles.css tests/unit/ui-fingerprint.test.tsx
git commit -m "feat: add fingerprint editor panel"
```

---

### Task 12: Card summary, Electron verification, and documentation

**Files:**
- Modify: `src/renderer/ProfileList.tsx`, `tests/unit/ui.test.tsx`, `tests/integration/app-smoke.test.ts`, `src/main/ipc.ts`
- Update: `STATUS.md`, `DECISIONS.md`, `TODO.md`, `docs/architecture.md`, `docs/verification.md`, `README.md`
- Test: `tests/unit/ui.test.tsx`, `tests/integration/app-smoke.test.ts`

- [ ] **Step 1: Write a failing test**

```tsx
it('card shows the platform and modes and warns for Off',()=>{/* “Windows 11 · Canvas: Noise · WebGL: Real”, for webRtc:'off': text about media websites */});
it('fingerprint launch errors have clear messages',()=>{/* FINGERPRINT_UNAVAILABLE → “Could not apply fingerprint…” */});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npx vitest run tests/unit/ui.test.tsx`
Expected: FAIL — summary lines are missing.

- [ ] **Step 3: Implement**

Summary: platform from `fingerprint.os` (“System default” if `userAgent===null`), Canvas/WebGL, timezone (`Auto`/IANA); the “Fingerprint: edit” button opens the editor. Add `FINGERPRINT_UNAVAILABLE` and `INVALID_FINGERPRINT` codes to `messages`. Update documentation: `DECISIONS.md` entries on the CDP approach, residual debugging-port risk, screen as window size, and WebRTC Off; `architecture.md` startup flow with CDP; `STATUS.md` completed work and outstanding manual acceptance on CfT 156; `TODO.md` replace the P3 anti-detection item with the actual status.

- [ ] **Step 4: Full verification**

Run: `npm run verify && npm run test:integration`
Expected: PASS. Record a manual run on CfT 156 in `docs/verification.md` with the date and version; do not close the item without it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: show fingerprint summary and document antidetect baseline"
```
