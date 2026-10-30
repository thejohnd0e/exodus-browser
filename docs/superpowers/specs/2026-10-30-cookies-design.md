# Cookies: import and export — implementation design

Date: 2026-10-30. Status: awaiting approval.
Basis: `docs/superpowers/specs/2026-10-30-fingerprint-geolocation-cookies-design.md`, §1 and §4.5.
Difference from the original specification: the temporary session **does not use the profile's proxy** and has no network access at all; import and export do not depend on proxy availability.

## 1. Purpose

Users transfer sessions between profiles and from Dolphin exports: sign-ins on ordinary websites (Claude and similar services) without re-entering passwords. Export is needed to back up a session and transfer it to another profile.

Done when: a Dolphin JSON or Netscape export imports without loss into a stopped profile; exports in both formats can be read back; cookie values do not reach the renderer, logs, or messages; the temporary browser makes no external requests.

## 2. Scope

**Goals:** JSON (Dolphin-compatible) and Netscape import; JSON and Netscape export; httpOnly and session cookies; limits and clear errors; a count and filename in the interface.

**Non-goals:** a “replace all cookies” mode; per-site cookie management; importing an entire Dolphin profile; cookie operations for a running profile; bypassing cookie database encryption; partitioned (CHIPS) cookies; Netscape export of partitioned cookies.

**Anti-goals:** any external network request from the temporary session; cookies in the renderer, DTOs, argv, or logs; direct SQLite writes; silent partial import.

## 3. Approaches

1. **Loopback “black hole” + DNS blocking (selected by the user).** Temporary Chromium with `--headless=new`, the same `user-data-dir`, `--proxy-server=http://127.0.0.1:9` (nothing listening), `--host-resolver-rules=MAP * ~NOTFOUND`, `--disable-background-networking`. External requests fail on loopback, DNS does not work, and CDP runs on 127.0.0.1.
   *Tradeoff:* network errors are written to Chromium's log (not shown to the user); the guarantee relies on Chromium flags rather than network equipment.
2. **The profile's proxy, if available.** Closer to a normal launch, but adds a network check and makes import dependent on the proxy again. Rejected by the user.
3. **Copy the cookie directory and merge.** Leaves the live profile untouched, but copies the encrypted database and conflicts with the decision to use “the same directory, with nothing copied.” Rejected.

## 4. Decisions

### 4.1 Temporary session

- Select the file and parse it in memory first; only then acquire `supervisor.withStopped(id, …)`. The dialog does not hold the lock.
- Before the session, use the same `probeProfileProcesses` as `start()`: a live Chromium using the profile directory → `ORPHAN_BROWSER`.
- Use the same engine as the profile (`installer.resolveExecutable()`), with integrity verification. No engine → `ENGINE_NOT_READY`; nothing is created.
- Arguments: `--headless=new --user-data-dir=<profile> --remote-debugging-port=0 --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-domain-reliability --disable-sync --no-pings --metrics-recording-only --host-resolver-rules=MAP * ~NOTFOUND --proxy-server=http://127.0.0.1:9 --proxy-bypass-list=<-loopback> about:blank`.
- No navigation: the browser stays at `about:blank`. No fingerprint is applied.
- Cookie commands: send `Network.setCookies` to the `about:blank` page session (the command is unavailable on the browser target—verified on CfT 156); send `Storage.getCookies` to the browser connection. The `Network.setCookies` format does not accept a per-cookie `urls` list: domain and path are passed as fields.
- CDP connection: wait up to 10 seconds for the devtools line from stderr; command timeout is 5 seconds. Failure → `COOKIES_SESSION_FAILED`; close the browser.
- Closing: `Browser.close` over CDP, wait up to 10 seconds for exit; on failure, use `CloseMainWindow` for our own just-launched process. Killing by PID is prohibited (DECISIONS #7).
- Do not write a `runtime-<uuid>.json` journal: this is not a profile launch.
- `CookieService` tracks active sessions. When the application window closes, close them before `supervisor.shutdown()` and wait for current operations to finish so that the `withStopped` lock can be released.
- Limitation: if the manager process is killed during import, headless Chromium may outlive it. The next operation or profile launch will detect `ORPHAN_BROWSER`; the process can be closed in Task Manager. Document this.

### 4.2 Cookie model

```ts
type CookieInput = {
  domain: string;        // no scheme or port; leading dot = domain cookie
  name: string;
  path: string;          // starts with '/'
  value: string;
  expirationDate: number | null; // null = session cookie
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  storeId: string;       // "0" = unpartitioned
};
```

- Limits: domain ≤ 256, path ≤ 1024, name ≤ 1024, value ≤ 8192 bytes.
- Any control characters (`\x00-\x1f`, `\x7f`) in domain/name/path/value cause file rejection: tabs and newlines break both Netscape and `Network.setCookies`.
- `sameSite = no_restriction` requires `secure`; import forces `secure` to `true` (otherwise Chromium silently drops the cookie).
- `__Secure-*` names require `secure=true`; `__Host-*` require `secure=true`, `path='/'`, and a host-only domain (no leading dot). Import normalizes values to these requirements rather than rejecting them.
- `storeId ≠ "0"` → `COOKIE_STORE_UNSUPPORTED`: partitioned cookies are unsupported.
- Chromium limits lifetimes to 400 days and may reduce `expirationDate`; this is not an import error.

### 4.3 Dolphin JSON normalization

- Accept an array or an object `{cookies: [...]}`.
- `expires` → `expirationDate`; a number or numeric string; `-1`, `0`, `null`, or absence → session cookie.
- Expiration scale: the first of `[t, t*1000, t/1000]` that is greater than `now` and no later than the year 2100; otherwise `now + 1 year`.
- `httpOnly`/`secure` from `true`/`"true"`/`1`; `storeId` defaults to `"0"`; `sameSite` defaults to `unspecified`, with aliases `no_restriction`/`none`, `lax`, `strict`; unknown value → `unspecified`.
- Names `c_user`, `xs`, `fr`, `datr`, `sb` force `httpOnly=true`, `secure=true`, `sameSite=no_restriction`.
- `facebook.com` and its subdomains without a leading dot receive the `.facebook.com` form.
- Field order and case do not matter; extra fields are ignored.

### 4.4 Netscape

- 7 tab-separated fields; `#` lines are comments; `#HttpOnly_` before the domain means `httpOnly`.
- Field 2 is the include-subdomains flag: `TRUE` = domain cookie (domain with a leading dot), `FALSE` = host-only. On import, `TRUE` without a dot adds one; `FALSE` with a dot removes it.
- Expiration `0` → session cookie. `TRUE`/`FALSE` in secure/httpOnly fields.
- Lines with a field count ≠ 7, an empty domain, or an empty name → reject the entire file.
- Export writes the `# Netscape HTTP Cookie File` header, `#HttpOnly_` for httpOnly, expiration `0` for session cookies, and field 2 based on the domain's leading dot.

### 4.5 Import

1. File picker in main: filters `.json`, `.txt`, `.cookies`; cancellation → `null`.
2. Read as bytes: size ≤ 5 MiB; strip the UTF-8 BOM; strict UTF-8 decoding (`TextDecoder('utf-8', {fatal:true})`), otherwise `INVALID_COOKIE_FILE`. Records ≤ 20,000; otherwise `COOKIES_TOO_LARGE`/`COOKIES_TOO_MANY`.
3. Format: first non-whitespace character `[` or `{` → JSON; otherwise Netscape; parse error → `INVALID_COOKIE_FILE`.
4. Normalize entirely in memory. Any invalid record → refusal before browser launch.
5. `Network.setCookies` one record at a time in the `about:blank` page session: this associates rejection with a specific cookie. Pass domain and path directly (leading dot = domain cookie, no dot = host-only). `sameSite`: `unspecified`—omit the field; `no_restriction` → `None`, `lax` → `Lax`, `strict` → `Strict`. Pass session cookies without `expires`.
6. If Chromium rejects a record, stop with `COOKIE_REJECTED_BY_BROWSER`. Cookies already written remain; repeated import is idempotent by the `domain+path+name` key.
7. Read back using `Storage.getCookies`: verify each record exists by `domain+path+name` (do not compare attributes or expiration—Chromium may change them). Otherwise `COOKIES_NOT_PERSISTED`.
8. Close the session and return `{count, fileName}`.

### 4.6 Export

1. The user selects `format`: “JSON (Dolphin)” and “Netscape cookies.txt.”
2. Save dialog in main with the corresponding extension; cancellation → `null`.
3. `Storage.getCookies` on the browser target. Skip cookies with `partitionKey` in both formats and exclude them from `count`. Discard expired cookies (`0 < expires < now`); retain session cookies (`expires <= 0`).
4. JSON is an array containing the model fields; `expirationDate` is in seconds, `null` for session cookies. Netscape follows §4.4.
5. Atomic write: adjacent temporary file + `rename`; overwriting the selected file is authorized by the dialog.
6. Return `{count, fileName}`.

### 4.7 IPC and interface

- Contract: `importCookies(id): Promise<{count, fileName} | null>`, `exportCookies(id, format: 'json' | 'netscape'): Promise<{count, fileName} | null>`.
- Schemas: `z.tuple([uuid])` and `z.tuple([uuid, z.enum(['json','netscape'])])`.
- Add two methods to preload and `operations`; Electron-smoke updates the exact key list.
- Profile card: “Import cookies…” and “Export cookies…” buttons (export has a compact format selector). Available only for `stopped`/`error`; disabled when `busy` and for a running profile.
- After an operation, temporarily show “Imported N cookies from file.json” / “Exported N cookies to file.json” in the card; errors use the global message. Cookie values are not shown.
- Dialogs and file reading are main-only; the renderer receives only `count` and the filename.

### 4.8 Errors

New codes and text in `messages`: `INVALID_COOKIE_FILE` (“The cookie file is corrupted or uses an unsupported format”), `COOKIES_TOO_LARGE`, `COOKIES_TOO_MANY`, `COOKIE_REJECTED_BY_BROWSER` (“Chromium rejected some cookies. Import stopped; correct the file and try again”), `COOKIES_NOT_PERSISTED` (“Some cookies were not saved—import again”), `COOKIE_STORE_UNSUPPORTED`, `COOKIES_SESSION_FAILED`, `ENGINE_NOT_READY`. Other errors use existing `PROFILE_BUSY`, `ORPHAN_BROWSER`, `DATABASE_TOO_NEW`, `OPERATION_FAILED`.

## 5. Security

- The temporary session has no internet access: a dead loopback proxy, DNS blocking, disabled background network traffic, and no navigation. This protects the user's real IP.
- Cookie values are not logged or exposed in argv, DTOs, error messages, or the renderer.
- External files are neither executed nor extracted; only the user-selected file is read, with a size limit.
- A profile cannot launch concurrently with import (`withStopped`).
- No direct cookie database writes: app-bound encryption remains intact.

## 6. Verification

**Unit:** JSON normalization (expires/expirationDate, scale, session, string booleans, storeId, sameSite aliases, special names, facebook, `__Host-`/`__Secure-`, no_restriction→secure), Netscape (comments, `#HttpOnly_`, field 2, expiration 0, malformed lines), serializers and round-trip, deriving `urls`, limits, control characters, BOM/non-UTF-8, IPC schemas, message map, rejection of `storeId ≠ 0`.

**Integration (real Chromium):** import JSON and Netscape into a new profile → `Storage.getCookies` contains httpOnly and session cookies; export JSON → reimport without loss by key; export Netscape → reimport; expired cookies are not exported; during the session, a local HTTP server receives no requests (network isolation check); a profile with a broken proxy still cannot launch, but import/export succeed; importing into a running profile is rejected.

**Electron/UI:** two new preload operations; card buttons, disabled for a running profile, a message with a count; no cookie values in the renderer.

**Full run:** `npm run verify`, `npm run test:integration`.

## 7. Left to the implementer

- The exact Chromium flags and verification on CfT 156 that no requests escape (a local trap server).
- Exact button labels and export format selector appearance.
- Intermediate JSON serializer formatting (field order, indentation).
- Storage of the temporary operation result in the UI (in memory, like the IP check result).
- A small `ChromiumAdapter` refactor: extract devtools-line waiting and process closing into a shared helper so the cookie session does not duplicate code.
