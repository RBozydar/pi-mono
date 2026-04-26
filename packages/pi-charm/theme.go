package main

import (
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// Theme holds all styles used by the TUI, computed from adaptive colors
// so they respond to light/dark terminal backgrounds.
type Theme struct {
	// Layout
	App     lipgloss.Style
	Divider lipgloss.Style

	// Header / status bar
	Logo      lipgloss.Style
	StatusBar lipgloss.Style
	Badge     lipgloss.Style
	BadgeKey  lipgloss.Style
	BadgeVal  lipgloss.Style

	// Chat messages
	UserLabel      lipgloss.Style
	UserText       lipgloss.Style
	UserBlock      lipgloss.Style
	AssistantLabel lipgloss.Style
	AssistantText  lipgloss.Style
	AssistantBlock lipgloss.Style
	ThinkingText   lipgloss.Style
	ErrorText      lipgloss.Style

	// Tools
	ToolRunning lipgloss.Style
	ToolDone    lipgloss.Style
	ToolError   lipgloss.Style
	ToolBox     lipgloss.Style
	ToolName    lipgloss.Style
	ToolArg     lipgloss.Style

	// Help bar
	HelpKey  lipgloss.Style
	HelpDesc lipgloss.Style
	HelpSep  lipgloss.Style

	// Overlay (extension dialogs)
	Overlay      lipgloss.Style
	OverlayTitle lipgloss.Style

	// Toast notifications
	ToastInfo    lipgloss.Style
	ToastWarning lipgloss.Style
	ToastError   lipgloss.Style

	// Progress overlay (compaction/retry)
	ProgressOverlay lipgloss.Style
}

// Adaptive palette — picks correct color for light vs dark terminal.
var (
	subtle    = lipgloss.AdaptiveColor{Light: "250", Dark: "238"}
	dimText   = lipgloss.AdaptiveColor{Light: "247", Dark: "243"}
	text      = lipgloss.AdaptiveColor{Light: "235", Dark: "252"}
	accent    = lipgloss.AdaptiveColor{Light: "63", Dark: "205"}
	accentDim = lipgloss.AdaptiveColor{Light: "105", Dark: "170"}
	blue      = lipgloss.AdaptiveColor{Light: "33", Dark: "39"}
	green     = lipgloss.AdaptiveColor{Light: "34", Dark: "78"}
	red       = lipgloss.AdaptiveColor{Light: "160", Dark: "196"}
	yellow    = lipgloss.AdaptiveColor{Light: "136", Dark: "220"}
	bgDim     = lipgloss.AdaptiveColor{Light: "254", Dark: "236"}
)

func newTheme() Theme {
	return Theme{
		App:     lipgloss.NewStyle().Padding(0, 1),
		Divider: lipgloss.NewStyle().Foreground(subtle),

		Logo: lipgloss.NewStyle().
			Bold(true).
			Foreground(accent).
			Padding(0, 1),

		StatusBar: lipgloss.NewStyle().
			Foreground(dimText).
			Padding(0, 1),

		Badge: lipgloss.NewStyle().
			Padding(0, 1),

		BadgeKey: lipgloss.NewStyle().
			Foreground(dimText),

		BadgeVal: lipgloss.NewStyle().
			Foreground(text).
			Bold(true),

		UserLabel: lipgloss.NewStyle().
			Foreground(blue).
			Bold(true),

		UserText: lipgloss.NewStyle().
			Foreground(text).
			PaddingLeft(2),

		UserBlock: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(blue).
			PaddingLeft(1).
			PaddingRight(1).
			MarginBottom(1),

		AssistantLabel: lipgloss.NewStyle().
			Foreground(accent).
			Bold(true),

		AssistantText: lipgloss.NewStyle().
			Foreground(text),

		AssistantBlock: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(accent).
			PaddingLeft(1).
			PaddingRight(1).
			MarginBottom(1),

		ThinkingText: lipgloss.NewStyle().
			Foreground(dimText).
			Italic(true).
			PaddingLeft(2),

		ErrorText: lipgloss.NewStyle().
			Foreground(red).
			Bold(true).
			PaddingLeft(2),

		ToolRunning: lipgloss.NewStyle().
			Foreground(yellow).
			PaddingLeft(2),

		ToolDone: lipgloss.NewStyle().
			Foreground(green).
			PaddingLeft(2),

		ToolError: lipgloss.NewStyle().
			Foreground(red).
			PaddingLeft(2),

		ToolBox: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(subtle).
			Padding(0, 1).
			MarginLeft(2),

		ToolName: lipgloss.NewStyle().
			Foreground(accentDim).
			Bold(true),

		ToolArg: lipgloss.NewStyle().
			Foreground(dimText),

		HelpKey: lipgloss.NewStyle().
			Foreground(accent).
			Bold(true),

		HelpDesc: lipgloss.NewStyle().
			Foreground(dimText),

		HelpSep: lipgloss.NewStyle().
			Foreground(subtle),

		Overlay: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(accent).
			Padding(1, 2).
			Background(bgDim),

		OverlayTitle: lipgloss.NewStyle().
			Foreground(accent).
			Bold(true),

		ToastInfo: lipgloss.NewStyle().
			Foreground(dimText).
			Background(bgDim).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(subtle).
			Padding(0, 1),

		ToastWarning: lipgloss.NewStyle().
			Foreground(yellow).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(yellow).
			Padding(0, 1),

		ToastError: lipgloss.NewStyle().
			Foreground(red).
			Bold(true).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(red).
			Padding(0, 1),

		ProgressOverlay: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(yellow).
			Padding(1, 3).
			Foreground(text).
			Align(lipgloss.Center),
	}
}

// newHuhTheme builds a huh form theme using pi-charm's adaptive palette.
func newHuhTheme() *huh.Theme {
	t := huh.ThemeBase()

	t.Focused.Base = t.Focused.Base.BorderForeground(subtle)
	t.Focused.Card = t.Focused.Base
	t.Focused.Title = t.Focused.Title.Foreground(accent).Bold(true)
	t.Focused.NoteTitle = t.Focused.NoteTitle.Foreground(accent).Bold(true).MarginBottom(1)
	t.Focused.Directory = t.Focused.Directory.Foreground(accent)
	t.Focused.Description = t.Focused.Description.Foreground(dimText)
	t.Focused.ErrorIndicator = t.Focused.ErrorIndicator.Foreground(red)
	t.Focused.ErrorMessage = t.Focused.ErrorMessage.Foreground(red)
	t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(accent)
	t.Focused.NextIndicator = t.Focused.NextIndicator.Foreground(accent)
	t.Focused.PrevIndicator = t.Focused.PrevIndicator.Foreground(accent)
	t.Focused.Option = t.Focused.Option.Foreground(text)
	t.Focused.MultiSelectSelector = t.Focused.MultiSelectSelector.Foreground(accent)
	t.Focused.SelectedOption = t.Focused.SelectedOption.Foreground(green)
	t.Focused.SelectedPrefix = lipgloss.NewStyle().Foreground(green).SetString("✓ ")
	t.Focused.UnselectedPrefix = lipgloss.NewStyle().Foreground(dimText).SetString("• ")
	t.Focused.UnselectedOption = t.Focused.UnselectedOption.Foreground(text)
	t.Focused.FocusedButton = t.Focused.FocusedButton.Foreground(lipgloss.AdaptiveColor{Light: "255", Dark: "235"}).Background(accent)
	t.Focused.Next = t.Focused.FocusedButton
	t.Focused.BlurredButton = t.Focused.BlurredButton.Foreground(text).Background(bgDim)

	t.Focused.TextInput.Cursor = t.Focused.TextInput.Cursor.Foreground(green)
	t.Focused.TextInput.Placeholder = t.Focused.TextInput.Placeholder.Foreground(subtle)
	t.Focused.TextInput.Prompt = t.Focused.TextInput.Prompt.Foreground(accent)

	t.Blurred = t.Focused
	t.Blurred.Base = t.Focused.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Blurred.Card = t.Blurred.Base
	t.Blurred.NextIndicator = lipgloss.NewStyle()
	t.Blurred.PrevIndicator = lipgloss.NewStyle()

	t.Help.ShortKey = lipgloss.NewStyle().Foreground(accent).Bold(true)
	t.Help.ShortDesc = lipgloss.NewStyle().Foreground(dimText)
	t.Help.ShortSeparator = lipgloss.NewStyle().Foreground(subtle)
	t.Help.FullKey = lipgloss.NewStyle().Foreground(accent).Bold(true)
	t.Help.FullDesc = lipgloss.NewStyle().Foreground(dimText)
	t.Help.FullSeparator = lipgloss.NewStyle().Foreground(subtle)

	t.Group.Title = t.Focused.Title
	t.Group.Description = t.Focused.Description
	return t
}
