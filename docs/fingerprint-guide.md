# Building a believable fingerprint

A fingerprint is judged on **consistency**, not on how unusual it looks. Anti-fraud systems rarely flag a rare value; they flag two values that contradict each other, or a value the real hardware cannot produce. Use this guide to keep a profile coherent.

## 1. Stay close to your real operating system

- If you run Windows, choose Windows 10 or 11. Spoofing macOS or Linux creates the most mismatches: fonts, window sizes, GPU behaviour, keyboard handling.
- Spoof a different OS only when you have a specific reason to.

## 2. Graphics card

- **Single profile on this computer:** keep **Use the installed graphics card** on. The reported card then matches the real one, so there is nothing for a site to contradict.
- **Several profiles on this computer:** turn the option off for some of them. Otherwise every profile reports the same card and they look related. Pick a card from the same vendor as yours (NVIDIA, AMD or Intel). A claimed high-end card on integrated graphics shows up in rendering performance.

## 3. Screen, CPU and memory

- Use **New fingerprint** and avoid hand-editing these values without a reason. The preset picks a screen at least as large as your monitor and keeps cores and memory consistent with the chosen card.
- If you edit manually, stay within what the hardware could plausibly have: the window cannot be larger than the screen, and a low-end card does not come with 32 GB of memory and 24 cores.

## 4. User-Agent

- Keep the generated one. Its Chrome version matches the installed engine. Do not paste a User-Agent from a different version: a site can compare it with the features the browser really supports.
- After updating the engine, click **New fingerprint** again so the version follows.

## 5. Time zone, language and proxy

- Set the time zone to **Auto (by IP)**; it follows the proxy exit IP.
- Choose interface languages that fit the proxy country. A Russian-language profile with a US IP and a Tokyo time zone looks wrong.
- Leave geolocation on **Block** (the default). If a site requires it, use **Manual** with coordinates near the IP.

## 6. Noise (Canvas, WebGL, ClientRects)

- **Noise** is safer than **Off**. It changes the output slightly and stably for a given profile, so it does not look like blocking.
- Do not switch modes between launches of the same profile. A fingerprint should be **stable**; one that keeps changing is more suspicious than one that stays the same.

## 7. WebRTC

- **Disable UDP** (the default) keeps the real IP from leaking. Use **Real** only without a proxy.

## 8. When to click New fingerprint

- Once, when you create the profile. A fingerprint that stays the same over time looks like a real user's.
- Generate a new one after changing the engine, moving the proxy to another country, or if the profile was flagged.
- **New fingerprint also draws a new hidden noise seed.** Save the profile and start it again for the change to take effect.

## What to avoid

- Copying one fingerprint to many profiles.
- Mixing characteristics by hand, such as a Mac platform with a Windows User-Agent and a Windows-only GPU.
- Turning every protection on at once: more spoofed values means more places to disagree.

See also [Browser engine and anti-bot behaviour](engine-and-antifraud.md).
