# pi-charm Feature Implementation Plan

## Architecture Context

Single-binary Bubble Tea app communicating with Pi coding agent via JSONL-over-stdio RPC.

**Source files**: `main.go` (~1645 lines), `theme.go` (~245), `keys.go` (~83), `rpc/client.go` (~330), `rpc/types.go` (~196)

**UI modes**: `modeChat`, `modeDialog`, `modePicker` — managed by `uiMode` enum.

---

## Tier 1: High Impact, Doable Now

### 1. Expandable/Collapsible Tool Output

**What**: Tool entries show one-line summary. Users need to expand to see full args and result text.

**RPC**: Already have full data — `tool_execution_start` delivers `args`, `tool_execution_end` delivers `result`. We just discard them in `summarizeToolArgs()` / `summarizeToolResult()`.

**Approach**: Store full args/result on `chatEntry`. Toggle `expanded` bool via keybinding. Render full JSON (pretty-printed) in `ToolBox` styled container when expanded.

**Files**: `main.go` (chatEntry, handleEvent, renderChat, Update), `keys.go` (add ToggleExpand)

**Complexity**: Easy

**Changes**:
- Extend `chatEntry` with `fullArgs json.RawMessage`, `fullResult json.RawMessage`, `expanded bool`
- Store `ev.Args` and `ev.Result` in handleEvent
- Add `ToggleExpand` keybinding (Tab when not streaming and autocomplete not visible)
- In `renderChat()`: if `expanded && fullArgs != nil`, render full JSON inside `ToolBox`

---

### 2. Session Fork (/fork)

**What**: Branch conversation from a previous user message.

**RPC**: Full support — `get_fork_messages` returns `[{entryId, text}]`, `fork` takes `{entryId}`.

**Approach**: `bubbles/list` picker (same pattern as model picker). Fetch messages, user selects, call fork, refresh state.

**Files**: `rpc/client.go` (GetForkMessages, Fork), `rpc/types.go` (ForkMessage), `main.go` (modeForkPicker, updateForkPicker, View)

**Complexity**: Medium

**Changes**:
- Add `ForkMessage` struct to types.go
- Add `GetForkMessages()` and `Fork(entryID)` to client.go
- New `modeForkPicker` uiMode, `forkPicker list.Model` field
- Tea messages: `forkMessagesMsg`, `forkResultMsg`
- `/fork` dispatches `doFetchForkMessages`, result populates list, Enter calls `doFork`

---

### 3. Steer/Follow-up During Streaming

**What**: Allow sending steering messages while assistant is streaming. Base TUI handles this transparently.

**RPC**: Full support — `steer` and `follow_up` commands exist. `queue_update` event notifies about queued messages. Go client already has `Steer(message)`.

**Approach**: Keep textarea active during streaming. Enter sends via `Steer()`. Show queue count in status bar. Handle `queue_update` event.

**Files**: `rpc/client.go` (add FollowUp), `main.go` (modify Send handler, add queue display, handle queue_update)

**Complexity**: Medium

**Changes**:
- Add `FollowUp(message)` to client.go
- Add `steeringQueue []string`, `followUpQueue []string` to model
- Remove `!m.streaming` guard on Send — if streaming, use `Steer(text)` instead of `Prompt(text)`
- Handle `queue_update` event: `m.steeringQueue = ev.Steering; m.followUpQueue = ev.FollowUp`
- Show queue count in status line when streaming
- Change textarea placeholder to "Steer pi..." when streaming

---

### 4. Compaction/Retry Progress Overlay

**What**: Show progress overlay instead of just a chat message during compaction/retry. Include spinner, description, Esc-to-cancel.

**RPC**: Full support — already parse `compaction_start/end`, `auto_retry_start/end` events. `abort` command cancels.

**Approach**: Lip Gloss overlay rendered on top of viewport in View(). Not a mode change — visual overlay only.

**Files**: `main.go` (progress state, handleEvent, View), `theme.go` (ProgressOverlay style)

**Complexity**: Easy

**Changes**:
- Add `progressOverlay string`, `isCompacting bool`, `isRetrying bool` to model
- Set overlay text on compaction/retry start, clear on end
- In View(): if `progressOverlay != ""`, render centered overlay with spinner + text + "Press Esc to cancel"
- In Esc handler: if compacting/retrying, call `client.Abort()`
- Add `ProgressOverlay` style to theme.go

---

### 5. Streaming Thinking Expansion

**What**: Thinking text collapsed to one line. Should be expandable to see full text.

**RPC**: Already fully captured — thinking stored in `chatEntry` with role `"thinking"`.

**Approach**: Same toggle mechanism as tool output expansion (feature 1). Share `expanded` field and keybinding.

**Files**: `main.go` (renderChat thinking case)

**Complexity**: Easy

**Dependencies**: Feature 1 (shares expansion mechanism)

**Changes**:
- In `renderChat()` thinking case: if `expanded`, render full text in styled box; if not, show first-line preview with `[+]` indicator
- Same Tab keybinding toggles

---

### 6. Lip Gloss Table Layout for Tool Args

**What**: Structured table for tool arguments instead of inline text. Two-column layout (key | value).

**RPC**: Already have full args as `json.RawMessage`. No new RPC needed.

**Approach**: Use `lipgloss/table` for two-column table from args map.

**Files**: `main.go` (renderToolArgsTable helper, use in expanded tool rendering), `theme.go` (table styles)

**Complexity**: Easy

**Dependencies**: Feature 1 (only shown in expanded view)

**Changes**:
- Import `github.com/charmbracelet/lipgloss/table`
- Add `renderToolArgsTable(raw json.RawMessage, th Theme, maxWidth int) string`
- Use in expanded `tool_start` rendering path

---

## Tier 2: Medium Impact

### 7. Session Resume (/resume)

**What**: Resume a different session. Shows picker of available sessions.

**RPC**: Partial — `switch_session` exists but there is **no `list_sessions` RPC command**. Interactive mode reads session files from disk directly.

**Approach**: Either (a) add `list_sessions` RPC command to agent (preferred), or (b) read session files from `~/.pi/agent/sessions/<sha256(cwd)>/` directly in Go.

**Files**: `rpc/client.go`, `main.go` (modeSessionPicker), possibly new `sessions.go`

**Complexity**: Hard (needs RPC addition or local session parsing)

---

### 8. Session Tree Navigation (/tree)

**What**: Tree visualization of session branches with navigation.

**RPC**: **Blocked** — no `get_tree` or `navigate_tree` RPC command. `navigateTree` exists internally but is not exposed to RPC clients.

**Approach**: Requires adding `get_tree` and `navigate_tree` RPC commands to the agent first. Then render using custom tree view with Lip Gloss.

**Files**: Requires changes to `rpc-mode.ts` and `rpc-types.ts` first, then Go client + main.go

**Complexity**: Hard (blocked on RPC additions)

---

### 9. Custom Themes

**What**: Load themes from JSON files, switch via `/theme` command.

**RPC**: Not needed — entirely client-side.

**Approach**: JSON schema mapping to `Theme` struct fields. Load from `~/.pi/themes/*.json`. `/theme` opens `bubbles/list` picker.

**Files**: `theme.go` (ThemeConfig, loadThemeFromFile, applyThemeConfig), `main.go` (/theme command, picker)

**Complexity**: Medium

**Changes**:
- Define `ThemeConfig` struct with color strings
- `loadThemeConfig(path) (*ThemeConfig, error)` reads JSON
- `newThemeFromConfig(cfg) Theme` builds Lip Gloss styles from config
- Discover themes from `~/.pi/themes/`, bundle 2-3 built-ins (dark, light, solarized)
- `/theme` opens list picker, selection rebuilds `m.theme`

---

### 10. Customizable Keybindings

**What**: Load keybindings from JSON config instead of hardcoding.

**RPC**: Not needed — entirely client-side.

**Approach**: JSON schema mapping action names to key strings. Load from `~/.pi/keybindings.json`, merge with defaults.

**Files**: `keys.go` (KeyConfig, loadKeybindings), `main.go` (load at startup)

**Complexity**: Medium

**Changes**:
- Define `KeyConfig` struct with `[]string` per action
- `loadKeyConfig(path) (*KeyConfig, error)` with fallback defaults
- `newKeyMap(cfg) KeyMap` constructs bindings from config
- Load in `main()` before `initialModel`

---

## Tier 3: Low Priority / Polish

### 11. Image Display (iTerm2/Kitty Protocol)

**What**: Inline image display using terminal-specific protocols.

**RPC**: `prompt` accepts images, but image content in responses needs detection from content blocks.

**Approach**: Write raw escape sequences. Detect terminal via `$TERM_PROGRAM` / `$KITTY_WINDOW_ID`. Fallback to `[image: <filename>]` placeholder.

**Files**: New `images.go`, `main.go` (content block detection), `rpc/types.go` (ImageContent)

**Complexity**: Hard (terminal-dependent, limited support)

---

### 12. File Path Autocomplete

**What**: Autocomplete filesystem paths in textarea (triggered by `./`, `../`, `/`, `~/`).

**RPC**: Not needed — local filesystem access.

**Approach**: Extend `updateAutocomplete()` to detect path-like tokens, call `os.ReadDir()`, show in existing autocomplete popup.

**Files**: `main.go` (updateAutocomplete, renderAutocomplete)

**Complexity**: Medium

---

## Implementation Sequencing

```
Phase 1: Core UX improvements
  1. Expandable/Collapsible Tool Output (Easy)
  5. Streaming Thinking Expansion (Easy, shares mechanism)
  4. Compaction/Retry Progress Overlay (Easy)
  3. Steer/Follow-up During Streaming (Medium)

Phase 2: Session features + polish
  2. Session Fork /fork (Medium)
  6. Lip Gloss Table Layout (Easy, depends on #1)

Phase 3: Customization
  9. Custom Themes (Medium)
  10. Customizable Keybindings (Medium)
  7. Session Resume /resume (Hard, may need RPC additions)

Phase 4: Advanced / blocked
  8. Session Tree /tree (Hard, needs new RPC commands)
  12. File Path Autocomplete (Medium)
  11. Image Display (Hard, terminal-dependent)
```
