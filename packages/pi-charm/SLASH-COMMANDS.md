# Slash Command Audit

Built-in slash commands from Pi's interactive mode vs RPC availability.

| Slash Command | RPC Command | pi-charm Status |
|---|---|---|
| `/settings` | -- | No RPC equivalent |
| `/model` | `cycle_model`, `set_model`, `get_available_models` | Done (picker overlay via Ctrl+P) |
| `/scoped-models` | -- | No RPC equivalent |
| `/export` | `export_html` | Done |
| `/import` | -- | No RPC equivalent |
| `/share` | -- | No RPC equivalent |
| `/copy` | `get_last_assistant_text` | Done |
| `/name` | `set_session_name` | Done |
| `/session` | `get_session_stats` | Done |
| `/changelog` | -- | No RPC equivalent |
| `/hotkeys` | -- | Done (local) |
| `/fork` | `fork`, `get_fork_messages` | Available, needs message picker UI |
| `/tree` | `switch_session` | Available, needs session tree UI |
| `/login` | -- | No RPC equivalent |
| `/logout` | -- | No RPC equivalent |
| `/new` | `new_session` | Done |
| `/compact` | `compact` | Done |
| `/resume` | `switch_session` | Available, needs session picker UI |
| `/reload` | -- | No RPC equivalent |
| `/quit` | -- | Done (local) |

## Categories

**Done (10):** `/name`, `/new`, `/compact`, `/quit`, `/model`, `/export`, `/copy`, `/session`, `/hotkeys`, `/help`

**Needs picker UI — RPC exists (3):** `/fork`, `/tree`/`/resume`

**No RPC equivalent (8):** `/settings`, `/scoped-models`, `/import`, `/share`, `/login`, `/logout`, `/changelog`, `/reload`
