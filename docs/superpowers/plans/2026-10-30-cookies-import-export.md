# Cookie Import and Export: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import and export profile cookies in JSON (compatible with Dolphin exports) and Netscape formats without weakening isolation or leaking values to the renderer.

**Architecture:** Read and write cookies through CDP (`Network.setCookies` / `Storage.getCookies`) in a temporary `--headless=new` instance of the same engine using the profile directory; verify by reading back after import and close gracefully through `Browser.close`. Start the profile proxy as during a normal launch.

**Tech Stack:** Electron 45, TypeScript strict, Zod, the CDP client from plan `2026-10-30-fingerprint-geolocation.md`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-fingerprint-geolocation-cookies-design.md` (§4.5, §1)

## Global Constraints

- Operations only when the profile is `stopped` (`supervisor.withStopped`).
- Cookie values are not logged or included in DTOs, messages, or the renderer.
- Limits: file ≤ 5 MiB, ≤ 20 000 entries, each entry ≤ 64 KiB.
- No new npm dependencies.
- Tests do not use real user cookies.

## Review Focus

1. A 6 MiB file or 25 000 entries: clear error, profile unchanged.
2. Cookie with `domain=''` or an invalid domain: skip and count it; continue importing the rest.
3. Profile without a proxy and profile with a dead proxy: import must not hang or leave a `headless` process.
4. Expired cookies in exports: exclude them.
5. Netscape line with the `#HttpOnly_` prefix: the domain name does not retain the prefix; preserve the httpOnly flag.

---

### Task 1: Cookie model and Dolphin normalization

**Files:**
- Create: `src/main/cookies/format.ts`
- Test: `tests/unit/cookies-format.test.ts`

**Interfaces:**
- Produces: `interface StoredCookie {domain: string; name: string; path: string; value: string; expirationDate: number; httpOnly: boolean; secure: boolean; sameSite: 'unspecified'|'no_restriction'|'lax'|'strict'; storeId: string}`; `normalizeCookies(input: unknown, now?: () => number): StoredCookie[]`.

- [ ] **Step 1: Write a failing test**

```ts
it('normalizes fields and expiration times like Dolphin',()=>{
  const [c]=normalizeCookies([{domain:'.example.com',name:'sid',path:'/',value:42,expires:1700000000,httpOnly:'true',secure:'false'}],()=>1_700_000_000_000);
  expect(c).toMatchObject({value:'42',httpOnly:true,secure:false,sameSite:'unspecified',storeId:'0'});
  expect(c.expirationDate).toBe(1_700_000_000_000);
});
it('selects expiration units and uses one year for zero',()=>{
  expect(normalizeCookies([{domain:'a.com',name:'n',path:'/',value:'v',expirationDate:1700000000}],()=>1_699_000_000_000)[0].expirationDate).toBe(1_700_000_000_000);
  expect(normalizeCookies([{domain:'a.com',name:'n',path:'/',value:'v',expirationDate:0}],()=>1_699_000_000_000)[0].expirationDate).toBe(1_699_000_000_000+31_536_000_000);
});
it('handles special facebook names and a leading domain dot',()=>{
  const [c]=normalizeCookies([{domain:'facebook.com',name:'c_user',path:'/',value:'1',secure:false,httpOnly:false}],()=>1);
  expect(c).toMatchObject({domain:'.facebook.com',httpOnly:true,secure:true,sameSite:'no_restriction'});
});
it('skips entries missing required fields',()=>{
  expect(normalizeCookies([{name:'x'},{domain:'a.com',name:'n',path:'/',value:'v'}])).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/cookies-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Follow the rules in specification §1: require `domain/name/path/value`; `expires` → `expirationDate`; strings for `name/value/domain/path`; booleans from `"true"`; default `storeId` to `"0"`; default `sameSite` to `"unspecified"`; choose the first expiration from `[t, t*1000, t/1000]` that is greater than `now` and ≤ `4102444800000`, otherwise `now + 31_536_000_000`; special names `c_user, xs, fr, datr, sb` → `httpOnly/secure=true, sameSite='no_restriction'`; `facebook.com` without a dot → `.facebook.com`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/cookies-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cookies/format.ts tests/unit/cookies-format.test.ts
git commit -m "feat: normalize imported cookies like dolphin"
```

---

### Task 2: Netscape and JSON

**Files:**
- Create: `src/main/cookies/netscape.ts`, `src/main/cookies/json.ts`
- Test: `tests/unit/cookies-formats.test.ts`

**Interfaces:**
- Produces: `parseNetscape(text: string): StoredCookie[]`; `serializeNetscape(cookies: StoredCookie[]): string`; `parseJson(text: string): StoredCookie[]` (delegates to `normalizeCookies`); `serializeJson(cookies: StoredCookie[]): string`.

- [ ] **Step 1: Write a failing test**

```ts
it('reads netscape with the httpOnly prefix',()=>{
  const [c]=parseNetscape('# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1800000000\tsid\tabc');
  expect(c).toMatchObject({domain:'.example.com',httpOnly:true,secure:true,name:'sid',value:'abc'});
  expect(c.expirationDate).toBe(1_800_000_000_000);
});
it('skips comments and malformed lines',()=>{
  expect(parseNetscape('#comment\n\ninvalid line')).toHaveLength(0);
});
it('round-trips netscape and json',()=>{
  const cookies=normalizeCookies([{domain:'.a.com',name:'n',path:'/',value:'v',expirationDate:1_800_000_000_000,httpOnly:true,secure:true,sameSite:'lax'}]);
  expect(parseNetscape(serializeNetscape(cookies))).toEqual(cookies);
  expect(parseJson(serializeJson(cookies))).toEqual(cookies);
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/cookies-formats.test.ts`
Expected: FAIL — modules are missing.

- [ ] **Step 3: Implement**

Netscape: 7 fields separated by `\t`, `#HttpOnly_` as a flag, `TRUE/FALSE` → bool, expiration in seconds when serializing (`Math.floor(ms/1000)`); skip lines without 7 fields. JSON: array of objects, serialize with `expirationDate` in milliseconds and `null` values, nothing extra; parse through `normalizeCookies`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/cookies-formats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cookies/netscape.ts src/main/cookies/json.ts tests/unit/cookies-formats.test.ts
git commit -m "feat: read and write netscape and json cookies"
```

---

### Task 3: Temporary headless instance

**Files:**
- Create: `src/main/cookies/temp-browser.ts`
- Modify: `src/main/engines/chromium.ts` (export windowless launch)
- Test: `tests/integration/cookies.test.ts` (part 1)

**Interfaces:**
- Consumes: `CdpClient`, `parseDevtoolsUrl`.
- Produces: `withTempBrowser<T>(options: {executable: string; userDataDir: string; proxyUrl?: string}, fn: (client: CdpClient) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write a failing test**

```ts
it('starts headless, provides a client, and closes gracefully',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cookies-'));
  let version='';
  await withTempBrowser({executable,userDataDir:dir},async client=>{version=(await client.send<{product:string}>('Browser.getVersion')).product;});
  expect(version).toContain('Chrome/');
  expect(isProcessAlive(dir)).toBe(false);
});
it('reports an unavailable proxy without leaving a process',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cookies-'));
  await expect(withTempBrowser({executable,userDataDir:dir,proxyUrl:'http://127.0.0.1:1'},async()=>{})).rejects.toThrow();
  expect(isProcessAlive(dir)).toBe(false);
});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npm run build && npx vitest run tests/integration/cookies.test.ts -t "headless"`
Expected: FAIL — module is missing.

- [ ] **Step 3: Implement**

Launch with `spawn(executable, ['--headless=new','--remote-debugging-port=0','--user-data-dir='+dir, ...(proxyUrl?['--proxy-server='+proxyUrl,'--proxy-bypass-list=<-loopback>']:[]), '--no-first-run','--no-default-browser-check','about:blank'], {stdio:['ignore','ignore','pipe'],shell:false})`; wait 10 seconds for the URL from stderr; `CdpClient.connect`. In `finally`: `Browser.close`, wait up to 10 seconds for `exit`; if it does not exit, return `CDP_CLOSE_TIMEOUT` (no killing by PID).

- [ ] **Step 4: Run the test**

Run: `npm run build && npx vitest run tests/integration/cookies.test.ts -t "headless"`
Expected: PASS or `BLOCKED` without local Chromium.

- [ ] **Step 5: Commit**

```bash
git add src/main/cookies/temp-browser.ts src/main/engines/chromium.ts tests/integration/cookies.test.ts
git commit -m "feat: add temporary headless browser for cookies"
```

---

### Task 4: Import and export through CDP

**Files:**
- Create: `src/main/cookies/service.ts`
- Test: `tests/integration/cookies.test.ts` (part 2)

**Interfaces:**
- Consumes: `withTempBrowser`, `normalizeCookies`, `parseNetscape`, `parseJson`, `serializeJson`, `serializeNetscape`.
- Produces: `class CookieService { constructor(deps: {executable: () => Promise<string>; openProxy: (p: ProxyInput) => Promise<{url: string; close(): Promise<void>}>}) ; importProfile(profileDir: string, proxy: ProxyInput | null, format: 'json'|'netscape', text: string): Promise<{count: number}>; exportProfile(profileDir: string, proxy: ProxyInput | null, format: 'json'|'netscape'): Promise<{count: number; text: string}> }`.

- [ ] **Step 1: Write a failing test**

```ts
it('import is visible to the page and survives a restart',async()=>{
  const svc=newCookieService();
  const {count}=await svc.importProfile(dir,null,'json',JSON.stringify([{domain:'127.0.0.1',name:'sid',path:'/',value:'abc',expirationDate:Date.now()+86400000}]));
  expect(count).toBe(1);
  const page=await openProfile(dir); // same directory, normal launch
  expect(await page.evaluate(()=>document.cookie)).toContain('sid=abc');
});
it('skips an invalid domain and persists the rest',async()=>{
  const {count}=await svc.importProfile(dir,null,'json',JSON.stringify([{domain:'',name:'a',path:'/',value:'1'},{domain:'127.0.0.1',name:'b',path:'/',value:'2',expirationDate:Date.now()+86400000}]));
  expect(count).toBe(1);
});
it('rejects excessive file sizes and entry counts',async()=>{
  await expect(svc.importProfile(dir,null,'json','[]'.padEnd(5*1024*1024+1))).rejects.toThrow('COOKIES_TOO_LARGE');
});
it('export excludes expired cookies and preserves httpOnly',async()=>{/* after importing an httpOnly cookie → export includes it but not the expired cookie */});
it('malformed JSON returns an error without writing',async()=>{await expect(svc.importProfile(dir,null,'json','{')).rejects.toThrow('INVALID_COOKIES_FILE');});
```

- [ ] **Step 2: Run the tests (fail)**

Run: `npm run build && npx vitest run tests/integration/cookies.test.ts`
Expected: FAIL — service is missing.

- [ ] **Step 3: Implement**

`importProfile`: parse and normalize, check limits (20 000 entries, 64 KiB per entry), filter out empty/invalid domains, `Network.setCookies {cookies:[{name,value,domain,path,secure,httpOnly,expires,sameSite}]}`; after writing, call `Storage.getCookies` and compare by `domain+path+name` — return `COOKIES_NOT_PERSISTED` on mismatch. `exportProfile`: `Storage.getCookies`, discard `expires>0 && expires<now/1000`, serialize. Do not log values; errors contain codes only.

- [ ] **Step 4: Run the tests**

Run: `npm run build && npx vitest run tests/integration/cookies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cookies/service.ts tests/integration/cookies.test.ts
git commit -m "feat: import and export profile cookies over cdp"
```

---

### Task 5: IPC, dialogs, and locking

**Files:**
- Modify: `src/shared/contracts.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/unit/ipc.test.ts`, `tests/integration/app-smoke.test.ts`

**Interfaces:**
- Produces: `ProfileApi.importCookies(id: string): Promise<Result<{count: number; fileName: string} | null>>`; `ProfileApi.exportCookies(id: string, format: 'json'|'netscape'): Promise<Result<{count: number; fileName: string} | null>>`.

- [ ] **Step 1: Write failing tests**

```ts
it('rejects import for a running profile',async()=>{/* dispatcher → PROFILE_BUSY */});
it('validates id and format',()=>{expect(operations).toContain('importCookies');expect(operations).toContain('exportCookies');/* invalid format → INVALID_INPUT */});
it('cookie errors have clear messages',()=>{/* INVALID_COOKIES_FILE, COOKIES_NOT_PERSISTED, COOKIES_TOO_LARGE */});
```

- [ ] **Step 2: Run the tests (fail)**

Run: `npx vitest run tests/unit/ipc.test.ts`
Expected: FAIL — operations are missing.

- [ ] **Step 3: Implement**

Schemas `importCookies: z.tuple([id])`, `exportCookies: z.tuple([id, z.enum(['json','netscape'])])`. In `index.ts`: file selection dialog with `json/txt` filters, read the file in main with a size check, call the service, use `dialog.showSaveDialog` for export with filename `<profile>-cookies.<ext>`; all within `supervisor.withStopped(id, …)`, obtain the proxy through `profiles.getLaunchInput(id).proxy`, use the shared `openProxyBridge`. Add two new lines in preload. Messages: `INVALID_COOKIES_FILE` — “Cookie file not recognized”, `COOKIES_TOO_LARGE` — “File is too large”, `COOKIES_NOT_PERSISTED` — “Cookies were not saved in the profile”.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/ipc.test.ts && npm run build && npx vitest run tests/integration/app-smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts src/main/ipc.ts src/main/index.ts src/preload/index.ts tests
git commit -m "feat: expose cookie import and export over ipc"
```

---

### Task 6: Profile card buttons and documentation

**Files:**
- Modify: `src/renderer/ProfileList.tsx`, `src/renderer/App.tsx`, `tests/unit/ui.test.tsx`, `README.md`, `docs/architecture.md`, `STATUS.md`, `TODO.md`
- Test: `tests/unit/ui.test.tsx`

- [ ] **Step 1: Write a failing test**

```tsx
it('import and export are disabled for a running profile',()=>{/* state='running' → both buttons disabled */});
it('shows the entry count and filename after import',async()=>{/* api.importCookies → {count:3,fileName:'a.json'} → text “Imported 3 cookies from a.json” */});
```

- [ ] **Step 2: Run the test (fails)**

Run: `npx vitest run tests/unit/ui.test.tsx`
Expected: FAIL — buttons are missing.

- [ ] **Step 3: Implement**

Place “Import cookies…” and “Export cookies…” buttons (format menu: JSON / Netscape) next to “Backup”; display the result as a separate message in App. Describe the cookie flow in `docs/architecture.md`, current status and outstanding manual acceptance in `STATUS.md`, and formats and a sensitive-data warning in `README.md`.

- [ ] **Step 4: Full verification**

Run: `npm run verify && npm run test:integration`
Expected: PASS. Record the manual scenario “import Dolphin export → website sees the session → export → reimport” in `docs/verification.md` with the date and engine version.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cookie import and export in profile card"
```
