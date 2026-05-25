# Pi Coding Agent Web UI

Browser UI for the Pi coding agent. It uses `AgentSessionRuntime` directly, so sessions run with the normal Pi runtime: bash/read/edit/write tools, configured extensions, MCP-backed extensions, skills, prompt slash commands, session files, model registry, and tree/fork operations.

## Run

From the repo root:

```bash
npm --prefix packages/coding-agent-web run start
```

LAN-accessible:

```bash
npm --prefix packages/coding-agent-web run start -- --host 0.0.0.0 --port 32123 --auth-token
```

The server prints local and LAN URLs. Token auth is disabled unless `PI_WEB_TOKEN`, `--auth-token`, or `--token <value>` is set. Use `--auth-token` for a random token in the printed URL, `--token <value>` for a stable token, or `--no-token` to explicitly disable token checks on a trusted network.

## Flags

- `--host <host>`: bind address, default `127.0.0.1`.
- `--port <port>`: preferred port, default `32123`.
- `--cwd <path>`: project directory for new sessions, default current directory.
- `--continue`: open the most recent session for the cwd at startup.
- `--session <path>`: open a specific session file at startup.
- `--auth-token`: generate a random browser/API token.
- `--token <value>`: use a fixed browser/API token.
- `--no-token`: disable token checks.

## Features

- Full Pi agent runtime, including system tools and installed extensions.
- Multiple active browser sessions running in parallel.
- Persistent session history with resume support.
- Session tree navigation and fork actions.
- Sorted, filterable model dropdown from the Pi model registry.
- Thinking level selector: off, minimal, low, medium, high.
- Streaming transcript updates with tool execution status.
- Inline previews for referenced image artifacts (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.avif`) and sandboxed generated HTML files.
- Explicit preview directives with stable artifact IDs and an artifact list in the session panel.
- Slash command palette for extension, prompt, and skill commands.
- Auto-growing composer that can also be resized manually.
- Collapsible session/history/command sidebar, inline on desktop and overlay on mobile.
- Openable session panel for settings, tree navigation, tool activity, and extension UI.
- Dark/light theme toggle with a green accent.

## Artifact previews

Assistant messages can request explicit previews with a full-line directive:

```md
::preview id="sales-chart" path="./reports/sales.html" title="Sales chart" type="html"::
::preview id="fit-plot" path="/tmp/fit-plot.png" title="Model fit" type="image"::
```

Rules:

- Directives are parsed only from completed assistant messages, not user messages, live streaming text, tool calls, or tool results.
- The directive must be on its own line and outside fenced code blocks.
- `path` is required. Relative paths resolve from the session cwd. Absolute paths must be inside the session cwd or `/tmp`.
- `type` must be `html` or `image` and match the file extension.
- `id` is optional but recommended. The UI generates a stable fallback ID when it is omitted.
- Previewable artifacts must be static local files no larger than 25 MiB.
- HTML previews currently run in an unrestricted iframe while the preview compatibility baseline is being validated. Bundle scripts/styles/data into the artifact when possible; CDN-backed static HTML can work when the browser has network access, but is less reliable.
- If an explicit preview fails validation or browser image rendering, the UI sends a one-time repair message to the agent asking it to regenerate the artifact.
