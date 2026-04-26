# Web UI Extension

Browser UI for `pi-coding-agent` backed by the coding agent runtime, not `@mariozechner/pi-web-ui`.

## Usage

From this repository:

```bash
./pi-test.sh --extension web-ui-extension
```

With an installed `pi` binary and this repo checked out locally:

```bash
pi --extension /home/rbw/repo/pi-mono/web-ui-extension
```

Optional flags:

```bash
pi --extension /home/rbw/repo/pi-mono/web-ui-extension --web-ui-host=127.0.0.1 --web-ui-port=32123
```

The extension serves a browser UI and shows the URL in the pi status line. Run `/web-ui` inside pi to show the URL again. The default is `http://127.0.0.1:32123/`; if the configured port is busy, it scans the next few ports.

To open the UI from another device on the same network, bind to all interfaces and use the host machine's LAN IP:

```bash
./pi-test.sh --extension web-ui-extension --web-ui-host=0.0.0.0
```

The status line and `/web-ui` command show usable display URLs. Do not open `0.0.0.0` from the other device; use the LAN IP URL, for example `http://192.168.1.19:32123/`.

Only do this on a trusted network. The UI can send prompts and run agent tools.

## Sessions

- The browser UI owns SDK-backed `AgentSessionRuntime` sessions in the same working directory.
- `New session` creates another independent runtime, so multiple sessions can stream and execute tools in parallel.
- The terminal session that loaded this extension is only the host that starts and stops the web server.
- Web sessions load project and user extensions, including global package extensions such as MCP adapters, excluding this web UI extension itself so it does not recursively start more servers.

## Slash Commands

Web sessions send prompts through `session.prompt()`, so runtime slash commands use normal pi expansion:

- Extension commands registered with `pi.registerCommand()`
- Prompt templates
- Skills via `/skill:<name>`
- Web-hosted commands: `/settings`, `/tree`, `/compact`, `/reload`, `/new`, `/name`, and `/stop`

The browser host implements common extension UI methods such as `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`, `ctx.ui.editor()`, `ctx.ui.notify()`, `ctx.ui.setStatus()`, `ctx.ui.setWidget()`, and `ctx.ui.setEditorText()`. Terminal-only extension UI hooks are ignored.

The Settings panel lists loaded extensions and extension load errors, which is useful for confirming that package-backed global extensions were discovered in the web-owned runtime.

## Browser UI

- Light and dark modes are supported. The initial theme follows the browser/system preference, and the top-bar toggle persists the choice in local storage.
- The layout has mobile breakpoints for narrow screens: the sidebar moves above the transcript, actions wrap, and message rows collapse to a single column.
- The UI is served as a self-contained HTML page by the extension; no separate web-ui package, dev server, or build step is required.
