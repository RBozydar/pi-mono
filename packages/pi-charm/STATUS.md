# pi-charm — Charmbracelet TUI for Pi

## Architecture

```
pi-charm/
├── main.go              Model/Update/View, event handling, chat rendering, toasts
├── theme.go             Lip Gloss adaptive theme, message borders, toast styles, huh theme
├── keys.go              Bubbles key.Binding definitions + help.KeyMap
├── main_test.go         Unit tests (model, events, rendering, helpers)
├── STATUS.md            This file
├── SLASH-COMMANDS.md    Audit of built-in slash commands vs RPC availability
├── go.mod
└── rpc/
    ├── types.go         Go types mirroring Pi's RPC protocol
    └── client.go        Subprocess mgmt, JSONL framing, typed helpers
```

## Charmbracelet Usage

| Library | Where | What for |
|---------|-------|----------|
| Bubble Tea | main.go | Core Elm-arch framework (model/update/view) |
| Bubbles/viewport | main.go | Scrollable chat history |
| Bubbles/textarea | main.go | Multi-line message input |
| Bubbles/spinner | main.go | Streaming indicator |
| Bubbles/help | main.go | Keybinding bar at bottom |
| Bubbles/key | keys.go | Keybinding definitions with help text |
| Glamour | main.go | Markdown rendering for assistant messages |
| Lip Gloss | theme.go | All styling, adaptive colors, layout |
| Huh | main.go | Extension UI dialogs (select, confirm, input, editor) |

## Done

- [x] RPC client (subprocess mgmt, JSONL framing, async events)
- [x] RPC types (commands, responses, events, extension UI)
- [x] Bubble Tea app with Elm architecture
- [x] Viewport with chat history scrollback
- [x] Textarea input with Enter to send
- [x] Streaming assistant text deltas with live rendering
- [x] Thinking block display (collapsed preview)
- [x] Glamour markdown rendering for assistant messages
- [x] Spinner during streaming (MiniDot style)
- [x] Graceful shutdown on Ctrl+C
- [x] **Split into multiple files** (theme.go, keys.go, main.go)
- [x] **Lip Gloss adaptive theme** — AdaptiveColor for light/dark terminals
- [x] **Bubbles help bar** — keybinding display at bottom
- [x] **Bubbles key.Binding** — typed shortcuts with help text
- [x] **Keyboard shortcuts** — Esc (abort), Ctrl+P (cycle model), Ctrl+L (clear)
- [x] **Huh forms** — extension UI select/confirm/input/editor as overlays
- [x] **Status badges** — model name, thinking level, session name in header
- [x] **Better tool rendering** — per-tool icons, prioritized arg display, compact results
- [x] **RPC client helpers** — CycleModel, CycleThinkingLevel, Steer, NewSession, GetAvailableModels

- [x] **Bubbles stopwatch** — turn duration timing in status bar
- [x] **Lip Gloss message borders** — rounded borders on user/assistant blocks
- [x] **Notification toasts** — transient overlays for setStatus/notify with auto-dismiss
- [x] **Custom huh theme** — adaptive palette matching pi-charm theme

## Planned

- [ ] Bubbles list for model picker overlay (Ctrl+Shift+P style)
- [ ] Huh input for inline steer/follow-up during streaming
- [ ] Bubbles progress for compaction/retry progress
- [ ] Lip Gloss table layout for structured tool args
- [ ] Theme switching command (dark/light/custom JSON)
- [ ] Slash command autocomplete in textarea
- [ ] File path autocomplete in textarea
- [ ] Session tree navigation overlay
- [ ] Expandable/collapsible tool output on click
- [ ] Image rendering (iTerm2/Kitty inline protocol)
