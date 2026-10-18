# Review and implementation notes

Reviewed baseline: the supplied Flow Connector CLI 1.0.9 distribution. Its
`dist/cli.js` was 240,058 bytes and `dist/mcp.js` was 59,246 bytes. Original
TypeScript, build configuration, tests, LICENSE and `tools/inpaint.py` were absent.
The adjacent Flow Connector browser extension identifies as 1.2.7.

## What the program does

The CLI parses commands, validates generation parameters and sends jobs over
loopback HTTP. A local bridge persists history, serves temporary file tokens,
selects a connected browser extension and forwards jobs through WebSockets. The
extension drives Google Flow or Grok and reports progress, results and failures.
CLI wait/list commands report those updates. Named run manifests allow failed or
missing prompts to be resubmitted without repeating finished or active jobs.

The MCP program exposes four tools over stdio and uses the same bridge. Media
commands operate on local files using FFmpeg, with optional Python/LaMa for
inpainting. The packaged agent skill describes the terminal workflow. Update
maintenance refreshes skills, retrieves notices, checks releases and can replace
an idle stale bridge.

## Source organization

| Area | Editable files |
|---|---|
| Branding, package identity, data location | `src/brand.js` |
| CLI registration, all original flags and actions | `src/cli.js` |
| MCP registration and four tool handlers | `src/mcp.js` |
| HTTP client, auto-start and waiting | `src/bridge-client/index.js` |
| HTTP/WebSocket bridge, diagnostics and routing | `src/bridge/server.js` |
| History, stale jobs, restart recovery and wait events | `src/bridge/job-store.js` |
| Expiring file tokens and media MIME types | `src/bridge/file-service.js` |
| Job/model limits, settings, protocol and notices | `src/shared/` |
| Merge, clean, delay, failed runs, manifests, doctor, updates, skills | `src/commands/` |
| Optional still/frame inpainting runner | `tools/inpaint.py` |
| Reproducible ESM bundles with source maps | `scripts/build.mjs` |

Recovered application logic is retained where changing it would risk feature
loss. This is a modular derivative/refactor, not a claim of a clean-room rewrite.
The client and persistent job store have new implementations. The former bundled
Zod implementation is now an external dependency. CLI and MCP share one copy of
the application modules, eliminating divergent embedded bridge implementations.

## Corrections made during the port

- **Custom port:** the original CLI passed its chosen port to the client but not
  to the detached bridge. The new child command includes `--port`.
- **Missing inpaint runner:** the package advertised it but did not ship it. A
  Python still/frame runner now ships, retaining implicit fallback and explicit
  failure behavior. Windows' missing-Python message also triggers the fallback.
- **Cancelled jobs:** late result/failure messages no longer revive a cancelled
  job; accepted/progress messages already had this protection.
- **WebSocket host validation:** upgrade requests now use the HTTP loopback-host
  check as well as the original extension-origin check.
- **Persistent writes:** the new store writes a temporary file and renames it,
  reducing the risk of truncated JSON; persistence failures are surfaced.
- **Child launch failures:** bridge startup catches spawn errors and keeps helper
  windows hidden on Windows.
- **Product isolation:** new state directory, command names, package identity and
  download folder; release checks cannot accidentally advertise upstream versions
  as this company's releases or terminate an upstream daemon.
- **MCP identity:** reads the actual product version instead of the old hard-coded
  `0.1.0`; startup errors are handled without contaminating stdio protocol output.

## Compatibility choices

Wire mode names, message names, JSON field names, legacy Grok support, plan and
model restrictions, the extension notice URL, and references naming the actual
Flow Connector extension remain compatible. The CLI's inherited Grok defaults
are documented rather than changed. Old binaries are not installed under the
same names, so global installations do not overwrite `flow-auto`.

Existing history is not silently migrated or overwritten. `FLOW_BEHIND_HOME`
allows choosing another state location; README describes copying legacy data.
The npm package is configured for public publication as `flow-behind-cli`.
It includes generated bundles while Git tracks the editable source and command
entry scripts. Branded release checking remains configurable.

## Verification

The compatibility fixture was captured by **executing the original CLI** against
a temporary HTTP fixture: 18 payload scenarios (all 16 modes, full optional
parameters and stdin), plus the options of 23 help surfaces. Tests compare the
new CLI with that fixed baseline. `scripts/capture-compatibility.mjs` exists to
repeat that audit when the original sibling folder is available; normal builds
and tests do not require it.

Additional tests exercise a real local bridge with a simulated WebSocket
extension, custom-port detached startup, file tokens, diagnostics, progress,
completion, cancellation, stop/clear, named-run resume, restart recovery, origin
checks, notices, doctor checks and MCP handshake/input schemas. FFmpeg tests
create actual short videos and verify merge, crop, delogo, cover and optional
inpainting-dependency fallback.

Live Google Flow generation was not run. A passing protocol fixture does not
verify current site selectors, account availability, download behavior in a real
browser or extension plan limits. Python syntax and its argument parser were
checked with the bundled Python runtime. Torch was not installed, so actual LaMa
model download/inference remains unverified. No large model/dependency download
was performed. The helper and fallback paths are present; this limitation is
not hidden by the passing test suite.
