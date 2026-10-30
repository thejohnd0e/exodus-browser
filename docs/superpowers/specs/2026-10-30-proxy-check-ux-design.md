# IP check: agreed changes

Goal: remove the unnecessary confirmation and show the result beside the corresponding profile rather than in a global warning.

## Approaches

- A global green banner is simpler but does not associate the result with a profile.
- **Selected by the user:** show the result in the profile card; place the external-service and HTTP warning beside the button; no modal confirmation.

## Scope

- The button remains the only trigger for the network check. Main verifies that a proxy exists and runs the existing checkProxy without a dialog.
- Success: “External IP: <address>” in the checked profile's card, without the service URL or a global yellow banner.
- Check errors are separate from success; clear the old IP on a repeated check and when the proxy changes. The result is temporary and is not saved in SQLite.
- Display this text beside the button: “api.ipify.org will see the proxy IP. The HTTP response could be tampered with.”
- The IPC contract and network implementation remain unchanged; no background requests or DIRECT fallback.
- Do not change the Chrome for Testing banner or launch arguments.
- Correct the erroneous explanation of the 404 in the documentation: the wrong endpoint was used; the correct last-known-good-versions-with-downloads.json confirmed Stable 156.0.8078.80.

Verification: UI unit tests for result association, errors, repeated checks, and proxy changes; an Electron test confirming the absence of a dialog with a local upstream; verify and test:integration.
