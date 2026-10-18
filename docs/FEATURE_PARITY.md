# Feature parity — Flow Behind CLI

Baseline: supplied flow-connector-cli 1.0.9. Every command/flag below is retained.

## CLI command surfaces

| Command | Options (excluding automatic help) |
|---|---|
| `flow-behind ` | `--version`, `--port` |
| `flow-behind bridge` | — |
| `flow-behind bridge start` | — |
| `flow-behind doctor` | `--site`, `--json` |
| `flow-behind status` | `--site`, `--json` |
| `flow-behind stop` | `--site` |
| `flow-behind queue` | — |
| `flow-behind queue clear` | `--site` |
| `flow-behind modes` | — |
| `flow-behind generate` | — |
| `flow-behind generate create` | `--prompt`, `--image`, `--video`, `--asset`, `--character`, `--aspect-ratio`, `--duration`, `--resolution`, `--model`, `--outputs`, `--new-project`, `--batch`, `--speed`, `--delay`, `--image-delay`, `--delay`, `--extend`, `--extend-prompt`, `--step`, `--folder`, `--index`, `--name`, `--character-info`, `--voice`, `--voice-style`, `--voice-name`, `--body`, `--wait`, `--wait-timeout`, `--json` |
| `flow-behind generate list` | `--json`, `--failed`, `--all`, `--run` |
| `flow-behind generate get` | `--json` |
| `flow-behind generate wait` | `--timeout`, `--json` |
| `flow-behind generate cancel` | — |
| `flow-behind generate runs` | — |
| `flow-behind generate resume` | `--dry-run`, `--json` |
| `flow-behind reload-extension` | `--site` |
| `flow-behind merge` | `--output`, `--fast`, `--json` |
| `flow-behind clean` | `--output`, `--mark`, `--mode`, `--cut`, `--box`, `--logo`, `--json` |
| `flow-behind skill` | — |
| `flow-behind skill install` | `--dir`, `--json` |
| `flow-behind skill list` | — |

## Generation and action modes

- `text-to-video`
- `frame-to-video`
- `ingredients-to-video`
- `text-to-image`
- `image-to-image`
- `flow-text-to-image`
- `flow-image-to-image`
- `flow-text-to-video`
- `flow-frame-to-video`
- `flow-ingredients-to-video`
- `flow-video-to-video`
- `flow-create-character`
- `flow-set-voice`
- `flow-extend-video`
- `flow-rename-asset`
- `flow-upload-assets`

## Other preserved functionality

- HTTP routes: status; job create/list/get/wait/cancel; queue stop/clear; reload-extension; token file downloads; DOM, logs and healthcheck queries.
- WebSocket hello/status/heartbeat, progress, completion/warnings, failure/retryability, reconnect/orphan recovery and browser selection.
- Image/video uploads, project assets, character references, model-specific limits, quality/resolution, batch pacing, new projects, storyboard extension, character/body/voice settings and indexed output naming.
- Persistent history, named-run manifests, failure deduplication, policy-block reporting, resume and dry-run.
- Media merge (stream copy or normalized re-encode) and clean (crop, delogo, logo cover, optional LaMa inpaint).
- Doctor checks: Node, bridge version, extension, login, visibility, access, layout, duplicate installs, plan/usage, paused queue, cooldown, FFmpeg and agent skill.
- Agent skill list/install/update, custom skill folders, cached compatibility notices and configurable release checks.
- MCP tools: `flow_generate`, `flow_status`, `flow_list_jobs`, `flow_get_job`; same eight generation input fields.

## Intentional product differences

- Package: `flow-behind-cli`; commands: `flow-behind` and `flow-behind-mcp`.
- Default download folder: `flow-behind`; default local state: `~/.flow-behind`.
- Original protocol identifiers and extension names remain unchanged for compatibility.
- Release checking requires a real package configured through `FLOW_BEHIND_UPDATE_PACKAGE`; compatibility notices remain available.
- See [REVIEW.md](REVIEW.md) for fixes, provenance and live-verification limitations.
