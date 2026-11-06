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
   (magic links, password resets, OAuth callbacks). Removing the reload broke
   user-agent and timezone overrides on the first document, so the reload stayed
   for the Chrome for Testing engine.

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
  `7z.dll` (about 2.4 MB) instead.
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
