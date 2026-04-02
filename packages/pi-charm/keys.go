package main

import (
	"github.com/charmbracelet/bubbles/key"
)

// KeyMap defines all keyboard shortcuts for the TUI.
type KeyMap struct {
	Send       key.Binding
	Newline    key.Binding
	Abort      key.Binding
	CycleModel key.Binding
	ClearChat  key.Binding
	ScrollUp   key.Binding
	ScrollDown key.Binding
	HalfPageUp   key.Binding
	HalfPageDown key.Binding
	Quit         key.Binding
	Help         key.Binding
	ToggleExpand key.Binding
}

var keys = KeyMap{
	Send: key.NewBinding(
		key.WithKeys("enter"),
		key.WithHelp("enter", "send"),
	),
	Newline: key.NewBinding(
		key.WithKeys("alt+enter", "shift+enter"),
		key.WithHelp("alt+enter", "newline"),
	),
	Abort: key.NewBinding(
		key.WithKeys("esc"),
		key.WithHelp("esc", "abort"),
	),
	CycleModel: key.NewBinding(
		key.WithKeys("ctrl+p"),
		key.WithHelp("ctrl+p", "cycle model"),
	),
	ClearChat: key.NewBinding(
		key.WithKeys("ctrl+l"),
		key.WithHelp("ctrl+l", "clear"),
	),
	ScrollUp: key.NewBinding(
		key.WithKeys("up", "k"),
		key.WithHelp("up/k", "scroll up"),
	),
	ScrollDown: key.NewBinding(
		key.WithKeys("down", "j"),
		key.WithHelp("down/j", "scroll down"),
	),
	HalfPageUp: key.NewBinding(
		key.WithKeys("ctrl+u"),
		key.WithHelp("ctrl+u", "page up"),
	),
	HalfPageDown: key.NewBinding(
		key.WithKeys("ctrl+d"),
		key.WithHelp("ctrl+d", "page down"),
	),
	Quit: key.NewBinding(
		key.WithKeys("ctrl+c"),
		key.WithHelp("ctrl+c", "quit"),
	),
	Help: key.NewBinding(
		key.WithKeys("ctrl+?"),
		key.WithHelp("ctrl+?", "help"),
	),
	ToggleExpand: key.NewBinding(
		key.WithKeys("tab"),
		key.WithHelp("tab", "expand/collapse"),
	),
}

// ShortHelp returns bindings shown in compact help bar.
func (k KeyMap) ShortHelp() []key.Binding {
	return []key.Binding{k.Send, k.Abort, k.CycleModel, k.ClearChat, k.Quit}
}

// FullHelp returns bindings shown in expanded help view.
func (k KeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		{k.Send, k.Newline, k.Abort},
		{k.CycleModel, k.ClearChat},
		{k.ScrollUp, k.ScrollDown, k.HalfPageUp, k.HalfPageDown},
		{k.Quit, k.Help, k.ToggleExpand},
	}
}
