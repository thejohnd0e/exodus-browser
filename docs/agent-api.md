# Agent API and OpenCode MCP

Exodus Browser's Agent API lets a local agent client use a limited set of profile and browser operations. The API is opt-in, authenticated, and listens only on `127.0.0.1`. The optional Exodus MCP adapter connects OpenCode to that API over local stdio.

## Requirements

- Exodus Browser 1.2.6 or later, running on Windows.
- Node.js 22 or later.
- A local copy of the Exodus Browser source repository. The MCP adapter is `tools/mcp/exodus-mcp.mjs`; it is not shipped as a standalone file in the installer.
- OpenCode V2.

## Enable the API and create an integration key

1. In Exodus, open **Agent API** and enable the API.
2. Create a separate key for OpenCode. The key is shown once; keep it private. If it is exposed, revoke it and create a replacement.
3. Grant the integration only the profiles and saved proxies it needs. A successful connection with an empty profile list can mean that no profiles have been granted.
4. Copy the loopback API address shown by Exodus. The port is chosen once and remembered, so the address stays the same across restarts. If the remembered port is taken by another program, Exodus binds a free port and remembers that one instead; the adapter then follows the change automatically (see below).

The API key grants only the operations available to that integration and the resources granted above. It does not expose proxy passwords, raw DevTools commands, arbitrary JavaScript, cookie export, or profile deletion.

## Store the key in a local file

Do not paste the key into OpenCode's JSON configuration, a command argument, a URL, a screenshot, or chat. The steps below create a user-local file, restrict its directory to the current Windows user and administrators, and write the key without a trailing newline. Type or paste the key only when PowerShell displays the hidden input prompt.

In PowerShell, create and protect the directory:

```powershell
$secretDir = Join-Path $HOME '.config\opencode\secrets'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
icacls $secretDir /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F'
```

Then run this as a single line. When the hidden prompt appears, enter the key there; do not replace the prompt text with the key:

```powershell
$secure=Read-Host 'Paste the Exodus API key (input hidden)' -AsSecureString; $ptr=[IntPtr]::Zero; $plain=$null; try {$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr); [IO.File]::WriteAllText((Join-Path $secretDir 'exodus-api-token'),$plain,[Text.UTF8Encoding]::new($false)); 'Token saved locally'} finally {if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}; Remove-Variable plain,secure,ptr -ErrorAction SilentlyContinue}
```

The token file is at `%USERPROFILE%\.config\opencode\secrets\exodus-api-token`. Treat it as a password. Do not commit it or copy it into a project. To rotate a key, revoke the old key in Exodus and replace the local file using the same hidden-input steps.

## Add Exodus to OpenCode globally

Open the user-wide OpenCode configuration at `%USERPROFILE%\.config\opencode\opencode.json` (or `opencode.jsonc`). Merge the `mcp.servers.exodus` entry below into the existing file; do not replace unrelated providers, plugins, permissions, or MCP entries.

Replace the adapter path with the absolute path to your local source checkout, and replace `<port>` with the current port shown in Exodus. Keep the `{file:...}` reference as a reference to the local token file; do not put the token itself between the braces.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "exodus": {
        "type": "local",
        "command": [
          "node",
          "C:/path/to/exodus-browser/tools/mcp/exodus-mcp.mjs"
        ],
        "environment": {
          "EXODUS_API_URL": "http://127.0.0.1:<port>",
          "EXODUS_API_TOKEN": "{file:C:/Users/your-user/.config/opencode/secrets/exodus-api-token}"
        }
      }
    }
  }
}
```

OpenCode V2 resolves `{file:...}` references when it reads the configuration and watches configuration changes. After saving, check the connection:

```powershell
opencode mcp list
```

The expected status is `exodus connected`. If needed, use `/reload` in OpenCode to reload configuration. The Exodus tools include `status`, `profiles_list`, `profiles_get`, `profile_create`, `profile_start`, `profile_stop`, `proxies_list`, `fingerprint_generate`, `tabs`, `navigate`, `snapshot`, `click`, `fill`, `screenshot`, and `close`.

## Stable address and automatic discovery

- Exodus remembers the listener port in `agent-api-settings.json` and tries it first on every start.
- While the API is listening, the current address is written to `%APPDATA%\Local Profiles\agent-api-origin.txt`; the file is removed when the listener stops.
- The adapter uses that file when `EXODUS_API_URL` is not set, and re-reads it once when a request fails to connect. It only follows a `http://127.0.0.1:<port>` origin, so the key can never be sent to another host. Set `EXODUS_API_ORIGIN_FILE` to read a different file.
- `EXODUS_API_URL` and `EXODUS_API_TOKEN` both accept the `{file:C:/path/to/file.txt}` form.

## Minimize to tray

Open the language menu in the sidebar footer and turn on **Minimize to tray**. Both the minimize button and the close (X) button then hide the window to the notification area; the application keeps running. Click the tray icon, or choose **Show Exodus Browser**, to bring it back; **Quit** is the way to exit: it shows the window and starts the normal close flow, including the running-profile confirmation. The Agent API keeps running while the window is hidden.

## Browser tool limits

- Browser operations require an authorized, running profile. Start only the profile you intend to use.
- `navigate` accepts `http(s)` URLs and `about:blank` only.
- `snapshot` returns element references for `click` and `fill`; take a new snapshot after navigation or page changes and use only current references.
- Snapshots include same-origin frames and open shadow roots, but do not automatically traverse cross-origin frames.
- `screenshot` returns a base64 PNG; handle it as sensitive page data.
- `snapshot` also lists ARIA widgets (`combobox`, `listbox`, `option`, `radio`, `switch`, menu items, sliders) and reports `type`, `checked` and `expanded` where they apply.
- `fill` on a native `<select>` picks the option whose value or visible text matches. It refuses `<input type="file">`; use `upload` for those.
- `upload` attaches local files (1-20 absolute paths of regular files; symbolic links are rejected) to an `<input type="file">` ref, or to a dropzone that contains or sits next to one, without opening an operating-system file dialog. Only give an agent files you are willing to hand to the page it is operating.
- `press` sends `Enter`, `Escape`, `Tab`, arrow keys, `PageUp`/`PageDown`, `Home`/`End`, `Space`, `Backspace` or `Delete`, optionally after focusing a ref. Use it to drive custom dropdowns.
- `close` closes a tab, not its profile. The adapter provides no arbitrary JavaScript evaluation, cookie export, raw DevTools commands, or profile deletion; the only filesystem paths it accepts are the files named in `upload`.

Treat webpage content as untrusted input. Confirm before submitting forms, sending messages, purchasing, or performing other consequential actions.

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP server is missing or fails to start | Confirm Node.js is installed, the adapter path is correct, and the Exodus source checkout is available. |
| Connection is refused | Confirm Exodus is running, Agent API is enabled, and the configured loopback URL uses the current port shown in Exodus. |
| `UNAUTHORIZED` / HTTP 401 | Check that the key has not been revoked and that the local token file contains the current key. If exposed, revoke it and create a replacement. |
| No profiles are listed | In Exodus, grant the integration access to the intended profiles. An empty list does not mean the application has no profiles. |
| A browser action reports that the profile is not running | Start the authorized profile, then list its tabs before navigating or interacting. |

The API remains local to the computer. A profile proxy applies to that browser profile; it is not a system VPN or a guarantee of anonymity.
