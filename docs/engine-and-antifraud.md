# Browser engine and anti-bot behaviour

This note records what was measured while investigating sign-in failures on an
anti-bot protected site. It separates proven behaviour from hypotheses so the
next person does not repeat the same dead ends.

## Summary

- The managed engine used to be Google's **Chrome for Testing** build. It is a
  real Chromium, but it reports itself with Chromium-only Client Hints brands:
  `"Not:A-Brand";v="8", "Chromium";v="156"` instead of
  `"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"`.
- That brand list is fixed at compile time. No command-line flag or CDP override
  changes the binary; only `Network.setUserAgentOverride` changes what a page
  receives afterwards.
- Spoofing through CDP applies **after** a tab starts loading, so a tab created
  with a URL (a link from an email, an OAuth return) sends its first request with
  the engine's native brands. The engine now ships as Google Chrome, so that
  first request is correct.
- The engine brand was **not** the reason the sign-in failed. The account was
  blocked by an account-level anti-fraud decision (see below), and the browser
  passed the step that had been failing.

## Engine: Chrome for Testing versus Google Chrome

Measured on the same machine, same version `156.0.8078.80`:

| Engine | `Sec-CH-UA` on a fresh request |
|---|---|
| Chrome for Testing | `"Not:A-Brand";v="8", "Chromium";v="156"` |
| Google Chrome | `"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"` |

The difference is not a setting. Chrome for Testing is built without the Google
branding flag, so the brand list is shorter at the source.

Two related defects that were reproduced and then fixed or avoided:

1. **First-request leakage.** A target created with a URL is attached after its
   navigation starts; `Network.setUserAgentOverride` cannot affect the request
   that is already in flight. A branded engine removes the problem for identity
   fields, because the native value is already correct.
2. **Duplicate document load.** `Page.reload` was applied to such targets to
   force overrides onto the visible document. That produced two document
   requests for every link-opened tab, which is destructive for one-shot URLs
   (magic links, password resets, OAuth callbacks).

   **Not solved.** The reload is still performed for every engine
   (`src/main/cdp/fingerprint.ts`), including Google Chrome. Dropping it breaks
   user-agent, timezone and script-based overrides on the first document of any
   profile that overrides something. The branded engine only makes the first
   request native for fields the profile leaves unchanged. A correct fix is to
   skip the reload when the profile overrides nothing; it is tracked in
   `TODO.md`. Until then, open one-shot links by pasting them into a tab that
   already exists.

## How the engine is installed now

A fresh machine needs no Chrome and no administrator rights.

1. `GET https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi`
   (~164 MB, Google's own offline installer).
2. Unpack the nested archives with the bundled `resources/bin/7z.exe`:

   ```
   chrome.msi
     └─ Binary.GoogleChromeInstaller
         └─ updater.7z
             └─ <version>_chrome_installer.exe
                 └─ chrome.7z
                     └─ Chrome-bin\chrome.exe
   ```

3. Verify the extracted `chrome.exe` with an Authenticode check: status `Valid`
   and publisher `O=Google LLC`. A pinned SHA-256 is not used here because Google
   rebuilds the binary on every release; the signature survives that.
4. Move the result to `%APPDATA%\Local Profiles\engine\branded\<version>\` and
   record it in `branded.json`. Nothing is installed system-wide.

Engine resolution order at launch: `branded.json` → `external.json` (a
`chrome.exe` the user linked explicitly, pinned by SHA-256) → the packaged
Chrome for Testing build.

Operational notes:

- Windows PowerShell loads type data from every `PSModulePath` entry. When
  PowerShell 7 is installed, its Security module collides with the 5.1 one, the
  module fails to load, and **every** signature looks invalid. The signature
  check spawns PowerShell with `PSModulePath` restricted to
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules` and a minimal
  environment.
- `7za.exe` does not read MSI containers. The app ships `7z.exe` together with
  `7z.dll` (about 2.4 MB in total, `resources/bin`, committed explicitly because
  `.gitignore` excludes other `*.exe`; license in `7-Zip-License.txt`) instead.
- The engine never updates itself. Downloading again is the only way to move to
  a newer Chrome; the old copy stays on disk until it is removed manually.

## What the sign-in investigation found

The site in question (Claude) maps a specific server error to its
"we could not verify your browser" page. In the client bundle the branch is:

```js
else if (Ae(e)) t = "We couldn't verify your browser"
```

where `Ae` is `missing_client_attestation` — an error code returned by the API.
The message has nothing to do with the user agent.

Client attestation on the auth endpoints is a mix of two third-party checks:

- **hCaptcha** — sent as `client_attestation.hcaptcha_token` on
  `POST /api/auth/send_magic_link`;
- **Arkose Labs** — loaded from `https://<host>/v2/<apiKey>/api.js` with SRI and
  `crossOrigin="anonymous"`, sent as `arkose_session_token` on
  `POST /api/auth/verify_magic_link`.

The magic-link flow also changed: opening the link no longer signs the user in.
The page returns a six-digit code that must be entered on the page where the
sign-in started (`Use verification code to continue`).

Measured end to end through a datacenter proxy in Turkey with the branded
engine:

```
POST /api/auth/exchange_nonce_for_code → 200
→ page shows a verification code
```

So the browser was accepted at that step. No `missing_client_attestation`, no
rejection. The account itself was then put **on hold** ("unusual activity") —
a new account, created from datacenter IP ranges, with a custom-domain alias,
after several sign-in attempts in a short window.

## Google Search `/sorry` is a different problem

An earlier, separate failure (Google Search redirecting to `/sorry/index` on a
Kazakhstan proxy) was caused by `--remote-debugging-pipe`, which enables Blink's
`AutomationControlled` feature and makes `navigator.webdriver` true. It was fixed
by `--disable-blink-features=AutomationControlled` (Decision #58) and does not
depend on the engine brand. See `kz-google-antifraud-diagnosis-2026-11-05.md`
(local notes, not tracked) and DECISIONS.md #58-#60.

## Tabs created by the browser with an address already set

Overrides are applied over the DevTools protocol, so they exist only after a tab
has been attached. Tabs the application opens itself start at `about:blank` and
are navigated afterwards. A tab that the browser creates with a web address
already set (`Target.createTarget`, an external link handed to a running
profile) starts loading before it can be attached.

Until 2026-11-08 such a tab, when the server answered instantly, ran its first
document with the real fingerprint until the automatic reload: platform,
`userAgentData`, hardware, time zone, WebGL vendor and renderer, screen and
`devicePixelRatio` were all the host's. (An earlier version of this section listed
only the platform and said non-Windows profiles alone were affected; that was
wrong.)

Now the installer sends `Page.stopLoading` the moment such a tab is attached, so
the in-flight document does not commit, and opens the same address again
(`Page.navigate`) once the overrides are in place. Measured on Google Chrome 157
and Playwright Chromium 149 (`tests/integration/blank-target.test.ts`): for a tab
created over the DevTools protocol, for an external link handed over by a second
launch with the same user-data directory, and for an address that redirects, no
document runs with real values.

Middle click, Ctrl+click and "Open link in new tab" behave differently: the
background tab is attached with an empty address while the browser is already
loading it, so it cannot be recognised and stopped at attach. Measured on Chrome
157 with a macOS profile: with an instant answer its document committed about
20 ms after attach, before the overrides, and the tab used to keep the real
platform, hardware and time zone for good, because nothing reloaded it. Now the
installer notices a web document that commits while the tab is still being set
up (in the frame tree right after `Page.enable`, or as `Page.frameNavigated`
before the last override is confirmed) and reloads the tab. The tab no longer
keeps real values, but on an instant answer its first document still runs with
them before the reload and the address is requested twice. With a 500 ms answer
the first document was already spoofed. Sending all overrides in one batch did
not shorten the window: the commit does not wait for the installer. Latencies
between 0 and 500 ms were not measured.

What remains:

- The first request may already have left before the tab was attached. It
  carries a spoofed `User-Agent` but the host `Sec-CH-UA-Platform`, and the address
  is requested a second time. This cannot be fixed after attach: enabling `Fetch`
  on the paused tab only intercepted the second request, and
  `--disable-features=UserAgentClientHint` had no effect on Chromium 149.
- One-shot addresses (magic links, OAuth callbacks) opened this way are therefore
  requested twice while the profile overrides anything. With nothing overridden the
  tab is neither stopped nor reloaded.
- Only `http` and `https` addresses are stopped; other addresses keep the reload.
- Guidance: avoid handing sensitive one-shot URLs to a running profile from
  outside; open them from a page inside the profile instead.

## Links that open a new tab by `target="_blank"`

Found and fixed on 2026-11-07/08. A link `<a href="/page" target="_blank">` is
treated as `noopener`, so the new tab gets its own renderer process. Until that
tab is resumed, Chromium answers only browser-side commands
(`Target.setAutoAttach`, `Runtime.runIfWaitingForDebugger`); page-level commands
(`Page.enable`, `Network.setUserAgentOverride`,
`Page.addScriptToEvaluateOnNewDocument`) wait for the resume. The installer used
to wait for those answers before resuming, hit its 5-second timeout and, failing
closed, closed the tab: such links and forms did not open at all.

Now a new page that does not answer `Page.enable` within 300 ms gets the same
overrides sent in order, followed by the resume, before any reply is awaited.
Chromium delivers a session's commands in order, so the overrides reach the page
before its first document runs. Measured on Google Chrome 157 and Playwright
Chromium 149 (`tests/integration/blank-target.test.ts`): links and GET/POST forms
with `target="_blank"` open once, a POST is sent once with its body, and the first
document already reports the profile's platform, hardware, time zone, user agent
and manual screen (in JavaScript and in media queries).

Trade-offs of this path: such a tab opens about 300 ms later; a failed override is
detected only after the resume, so the tab may run briefly before it is closed
(ordinary tabs still fail closed before they run); a manual screen uses the last
display that another page measured, and the tab is closed if none has been
measured yet.

## Cross-origin iframes and the emulated screen

Chromium rejects `Emulation.setDeviceMetricsOverride` on an iframe target
("Command can only be executed on top-level targets", confirmed on Chrome 157)
and does not propagate the page's screen emulation into out-of-process iframes;
`Emulation.setEmulatedMedia` accepts a `resolution` feature but ignores it. A
cross-origin frame therefore renders with the host display.

Its script now reports the profile's `devicePixelRatio` and rewrites the screen
features of `matchMedia` queries (`device-width`, `device-height`, `resolution`,
`-webkit-device-pixel-ratio`, with `min-`/`max-` prefixes) from the profile's screen
to the host's, so they answer exactly as on the top page; `MediaQueryList.media`
and `MediaQueryListEvent.media` return the query as written and `matchMedia` keeps
a native `toString`. Measured on Chrome 157 and Chromium 149
(`tests/integration/screen-consistency.test.ts`).

Not covered: `@media` rules in the frame's stylesheets still follow the host
display (a page can detect this by comparing a computed style with `matchMedia`),
range syntax such as `(device-width >= 1512px)` and `device-aspect-ratio` are not
rewritten, and the frame's actual rendering resolution stays the host's.

## Workers and WebGPU Off

Found by an external audit on 2026-11-08 and fixed the same day (Decision #76):

- A worker started by another worker was never attached, so it reported the host's
  hardware, platform and GPU while the page and first-level workers were spoofed.
  Worker sessions now attach their own child workers before they run; chains of
  classic and module workers are covered by `tests/integration/worker-chain.test.ts`.
- WebGPU Off used to hide `navigator.gpu` in page script only, so the prototype getter
  and every worker still returned the real adapter. It is now an engine switch
  (`--disable-features=WebGPUService`): `navigator.gpu` exists and `requestAdapter()`
  returns `null` everywhere, as in Chrome on a machine without a usable adapter.
  The switch must be re-checked on every Chrome update (`tests/integration/webgpu-off.test.ts`).

## What is not proven

- That Client Hints brands ever influenced the outcome. The front end never
  reads `navigator.userAgentData.brands`; only `getHighEntropyValues` for
  architecture and platform. A server could still look at `Sec-CH-UA`, but no
  measurement connects it to the rejection.
- That the engine change fixes or breaks anything for anti-bot systems. It
  removes one observable difference; it is not a pass.
- That CDP instrumentation is detectable here. A local battery (native
  `Function.prototype.toString`, console descriptors and property names,
  injected globals, `webdriver`, permissions, WebGL, canvas)
  compared a clean launch, a launch with fingerprint overrides, and a launch
  with `Runtime`, `Network`, `Page` and `Debugger` enabled. Only the intended
  differences appeared.

## Practical guidance

- Use one browser, one profile and one stable exit IP per account. Rotating
  proxies between the steps of a single sign-in is what triggers account-level
  anti-fraud, not the browser.
- Do not create accounts in a loop from datacenter ranges; each attempt worsens
  the reputation of the address and of the email domain.
- If a hold appears, use the account review flow once and stop signing in.
- Engine updates are manual. Profiles and proxies never move during an
  application update; they live in `%APPDATA%\Local Profiles`.

## Audit of 2026-11-11: comparison with an unmodified Chrome

A profile was compared with the same Google Chrome 157.0.8103.39 binary started with the same switches and a bare DevTools pipe (no overrides). The comparison is permanent: `tests/integration/differential.test.ts`.

| Observation | Profile before | Unmodified Chrome |
|---|---|---|
| `Accept-Language` for language `en-US` | `en-US` | `en-US,en;q=0.9` |
| `navigator.languages` | `["en-US"]` | `["en-US","en"]` |
| `getHighEntropyValues(['formFactors'])` | `[]` | `["Desktop"]` |
| Header order (found after the above) | `accept-language` before `accept` | after `accept-encoding` |
| GREASE entry of `fullVersionList` | `99` | `99.0.0.0` |
| Page replaces `WeakMap.prototype.has`, calls any `toString()` | receives the map of wrappers, reads the real core count | hook never called |
| Hooks on `Function.prototype.apply`, `Document.prototype.createElement`, `canvas.toDataURL()` | each fires | never fires |
| `Object.setPrototypeOf(Function.prototype.toString, Object.create(Function.prototype.toString))` | no exception | `TypeError` |
| WebGL vendor containing `$'` | the generated script does not compile | n/a |
| `outerWidth` after the window is resized to 900x700 | still the screen size | 900 |
| Maximized window, emulated screen 1366x768 on a 2560x1440 host | `innerWidth` 2560, `screen.width` 1366 | n/a |
| `--window-size=3840,2160` on a 2560 px display | window 3840 px wide | n/a |

What changed is in Decisions 87 to 91. What is still visible:

- **Wrapper source in an error message.** `Reflect.construct(String, [], wrapper)` prints the source of a JavaScript wrapper in its `TypeError`. A wrapper cannot be given a native-looking source in JavaScript. The differential test lists this explicitly.
- **Stack frames.** A page that sets `Error.prepareStackTrace` or raises `Error.stackTraceLimit` before calling a spoofed API can still see wrapper frames; stack depth at a `RangeError` differs by the wrapper frames. Both need a native implementation.
- **Fonts and graphics limits.** Fonts, text rendering, WebGL limits and extensions, and the WebGPU feature list come from the host, whatever operating system and card the profile reports.
- **Layout is real.** The window cannot be larger than the reported screen without contradicting it; this is why generated screens cover the host display (Decision 89).
- **Out-of-process frames.** The `matchMedia` rewrite there still uses regular expressions and `Map`, so a hostile page that controls those inside the frame can observe it.
- **Destination DNS.** The net log shows no resolver job for hosts that go through the proxy (Decision 91); a packet capture was not made.
