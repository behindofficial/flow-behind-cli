# Flow Behind CLI

[![CI](https://github.com/behindofficial/flow-behind-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/behindofficial/flow-behind-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Flow Behind** brings terminal and AI-agent workflows to Google Flow: images,
videos, characters, voices, reusable assets and recoverable batches.

Built by [Behind Official](https://github.com/behindofficial) for creators and
developers who want to drive browser-based creative workflows from their terminal,
coding agent or MCP client.

```text
Your terminal / AI agent → Flow Behind CLI → local bridge → browser extension → Google Flow
                                                     ← progress, results and downloads ←
```

This is a separately packaged, modular adaptation of Flow Connector CLI 1.0.9.
It preserves its 16 CLI modes, command options, browser protocol and four MCP
tools. See [the feature map](docs/FEATURE_PARITY.md) and
[review notes](docs/REVIEW.md) for coverage and verification limits.

## Requirements

| Requirement | When it is needed |
| --- | --- |
| Node.js 20+ and npm | All CLI and MCP commands |
| Git | Cloning this repository |
| Compatible Flow Connector browser extension | Driving Google Flow through Chrome or Edge |
| Signed-in Google Flow session | Generating media; keep the browser window visible |
| FFmpeg and ffprobe | Optional local media merging and cleaning |

## Install from GitHub

Run these commands in PowerShell, Terminal or your preferred shell:

```sh
git clone https://github.com/behindofficial/flow-behind-cli.git
cd flow-behind-cli
npm ci
npm run build
npm install -g .
flow-behind --version
flow-behind --help
```

The global install makes both `flow-behind` and `flow-behind-mcp` available.
If global installation is unavailable, run the CLI directly from the checkout:

```sh
node bin/flow-behind.mjs --help
node bin/flow-behind.mjs status --site flow
```

The package has not been published to npm. Use this repository checkout or a generated
`.tgz`; do not assume `npm install -g flow-behind-cli` downloads this project.

## Browser connection

Install a compatible **Flow Connector** browser extension using the
[upstream setup instructions](https://github.com/srijan-kaiwart/flow-connector).
The separately supplied Flow Behind Connector build also uses this protocol;
its extension files are distributed separately from this CLI repository.
Keep one connector active, open [Google Flow](https://flow.google.com), sign in,
and keep its browser window visible. This package implements the CLI, bridge and MCP server;
the extension performs the actual browser actions. The supplied extension is
version 1.2.7. Its plan limits, login requirements and pacing rules remain in force.

Start the bridge in one terminal:

```sh
flow-behind bridge start
```

Then check the connection and generate an image from another terminal:

```sh
flow-behind status --site flow
flow-behind doctor --site flow
flow-behind generate create flow-text-to-image --prompt "A red fox in snow" --wait
```

The extension performs the download; the CLI reports job progress and resulting
file paths. Available models, credits and access depend on your Google account
and the extension provider's plan.

The bridge auto-starts when generation needs it and binds only to
`127.0.0.1:8791`. Read-only `status` and `doctor` do not start it. You can run it
in the foreground with `flow-behind bridge start`, or use
`flow-behind --port 8792 bridge start` and configure the extension for that port.
Only one bridge can use a port. An existing compatible bridge can be reused;
to run the new bridge implementation on 8791, first stop the old idle daemon.

## Use

```powershell
flow-behind doctor --site flow
flow-behind modes
flow-behind generate create flow-text-to-image --prompt "A red fox in snow" --wait
flow-behind generate create flow-image-to-image --prompt "Watercolour" --image .\photo.png --wait
flow-behind generate create flow-text-to-video --prompt "Waves at sunset" --duration 8 --wait
flow-behind generate create flow-frame-to-video --prompt "She turns and smiles" --image .\frame.png --wait

# Submit the batch, then inspect it.
flow-behind generate create flow-text-to-image --prompt "First scene" --index 1 --folder campaign
flow-behind generate create flow-text-to-image --prompt "Second scene" --index 2 --folder campaign
flow-behind generate list
flow-behind generate list --failed --run campaign
flow-behind generate resume campaign --dry-run
flow-behind generate resume campaign
flow-behind stop --site flow
flow-behind queue clear --site flow

flow-behind merge .\clip1.mp4 .\clip2.mp4 -o .\final.mp4
flow-behind clean .\own-generation.png --mark flow --mode delogo -o .\clean.png
flow-behind skill install flow-generate
```

For full options: `flow-behind generate create --help`. All original defaults are
preserved except product identity and the default download folder (`flow-behind`).
Some legacy commands default to Grok, including `status`, `stop`, `queue clear`,
`reload-extension` and `clean --mark`; pass `--site flow` / `--mark flow` explicitly.

`merge` and `clean` need FFmpeg and ffprobe on PATH or `FFMPEG_PATH` pointing to
ffmpeg. Clean supports crop, delogo, logo cover and LaMa inpaint for your own
generated media. The Python runner is included (it was absent from the supplied
package). Inpainting additionally requires Python with `torch`, `numpy`, and
`pillow`, and downloads the LaMa model on first use. Set `PYTHON` to the Python
executable, or `FLOW_BEHIND_LAMA_MODEL` to an existing TorchScript model. Images
default to inpaint for `--mark flow`, falling back to delogo for missing optional
dependencies; videos default to crop. An explicit `--mode inpaint` fails rather
than silently falling back. This does not remove invisible SynthID metadata or
change the fact that media is AI-generated.

## MCP

After the optional global install, configure an MCP client with:

```json
{
  "mcpServers": {
    "flow-behind": {
      "command": "flow-behind-mcp"
    }
  }
}
```

Without global installation, use `node` with the absolute path to
`bin/flow-behind-mcp.mjs` in `args`. Windows example:

```json
{
  "mcpServers": {
    "flow-behind": {
      "command": "node",
      "args": ["C:/path/to/flow-behind-cli/bin/flow-behind-mcp.mjs"]
    }
  }
}
```

The tool names remain `flow_generate`, `flow_status`, `flow_list_jobs`, and
`flow_get_job` so existing tool integrations remain compatible. The MCP server
identifies as `flow-behind`. As in the original product, advanced character,
voice and batch flags are available through the CLI; the four-tool MCP interface
does not expose every CLI option.

## Configuration and stored data

| Setting | Purpose |
|---|---|
| `FLOW_BEHIND_HOME` | State folder; defaults to `~/.flow-behind` |
| `FLOW_BEHIND_CLIENT` | Job submitter label; legacy `GROK_AUTO_CLIENT` also works |
| `FLOW_BEHIND_NO_UPDATE_CHECK=1` | Disable update/notice fetching and CLI auto-maintenance |
| `FLOW_AUTO_NO_UPDATE_CHECK=1` | Retained legacy equivalent |
| `FLOW_BEHIND_CONFIG_URL` | Company configuration endpoint with the existing agent-notice schema |
| `FLOW_BEHIND_UPDATE_PACKAGE` | Explicit npm package to check for releases, once your package is published |
| `FFMPEG_PATH`, `PYTHON` | Optional media executable paths |
| `FLOW_BEHIND_LAMA_MODEL` | Existing local LaMa model path |

History, run manifests, plan observations and update cache use the new state
folder. Existing `~/.grok-auto` data is not overwritten. To use a copy of legacy
history, copy `jobs.json` and `runs/` into the new state folder while both daemons
are stopped. Interrupted jobs become failed on startup, and named runs can be
resumed. Do not run two daemons against the same state folder.

The upstream extension-notice feed remains enabled for compatibility. No prompts
or files are sent to that feed. A branded endpoint can replace it with
`FLOW_BEHIND_CONFIG_URL`. npm release checks are opt-in until an actual Flow Behind
release package exists. CLI auto-replacement only targets an idle bridge that
identifies itself as this product, not an unrelated process or an upstream bridge.

## Develop and verify

```powershell
npm run check
npm pack
```

Edit `src/`, then rebuild. `dist/` contains generated runnable bundles and source
maps; it is ignored by Git and created locally by `npm run build`.

`bin/` contains the two hand-written Node.js entry scripts registered as CLI
commands in `package.json`, so it is kept in source control. A distributable
package needs both `bin/` and `dist/`: `npm pack` runs the `prepack` build and
includes them through the package's explicit `files` list. Dependencies, logs,
test output and package archives are excluded from the repository.

Tests use temporary state directories and a simulated extension on random ports;
they do not submit real Google Flow generations. FFmpeg tests create short local
fixtures. LaMa model inference and real browser generation require separate live
verification. Source provenance and attribution are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

To update a cloned installation, run `git pull --ff-only`, `npm ci`,
`npm run build`, then `npm install -g .` from the repository directory.
To remove the global commands, run `npm uninstall -g flow-behind-cli`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `flow-behind` is not found | Reopen the terminal after installing Node/global package; try `node bin/flow-behind.mjs --help` from the checkout. |
| Bridge is down | Run `flow-behind bridge start`; read-only status does not start it. |
| Extension is disconnected | Enable the connector, keep one installation active and use the same bridge port on both sides. |
| Job stalls or Flow is hidden | Restore the browser window, sign in to Flow and run `flow-behind doctor --site flow`. |
| Plan limit or cooldown | Read the reported quota/reset time; provider account and pacing rules still apply. |
| Media tools are unavailable | Install FFmpeg with ffprobe and add them to PATH, or set `FFMPEG_PATH`. |

## Support and attribution

Report CLI problems in [GitHub Issues](https://github.com/behindofficial/flow-behind-cli/issues).
Include your OS, Node version, CLI version and relevant diagnostics; remove
private prompts, local paths and account details before posting logs.

Licensed under [MIT](LICENSE). Upstream Flow Connector CLI contributions are
credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Flow Behind is not affiliated with Google or the original Flow Connector author.
