package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/stopwatch"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/glamour"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"

	"github.com/rbw/pi-charm/rpc"
)

// ---------------------------------------------------------------------------
// Tea messages
// ---------------------------------------------------------------------------

type rpcEventMsg json.RawMessage
type rpcDoneMsg struct{}
type errMsg struct{ err error }

func (e errMsg) Error() string { return e.err.Error() }

type stateMsg struct{ state *rpc.SessionState }
type cycleModelMsg struct {
	provider string
	modelID  string
}
type toastMsg struct {
	text  string
	level string // "info", "warning", "error"
}
type toastExpireMsg struct{}

type modelsListMsg struct {
	models []rpc.ModelInfo
	err    error
}

type setModelMsg struct {
	provider string
	modelID  string
	err      error
}

// modelItem implements list.Item for the model picker.
type modelItem struct {
	provider string
	modelID  string
}

func (i modelItem) Title() string       { return i.provider + "/" + i.modelID }
func (i modelItem) Description() string { return i.provider }
func (i modelItem) FilterValue() string { return i.provider + "/" + i.modelID }

// forkItem implements list.Item for the fork message picker.
type forkItem struct {
	entryID string
	text    string
}

func (i forkItem) Title() string {
	t := i.text
	if len(t) > 60 {
		t = t[:57] + "..."
	}
	return t
}
func (i forkItem) Description() string { return i.entryID }
func (i forkItem) FilterValue() string { return i.text }

type commandsMsg struct {
	cmds []slashCmd
	err  error
}

type forkMessagesMsg struct {
	messages []rpc.ForkMessage
	err      error
}
type forkResultMsg struct {
	err error
}

type exportMsg struct {
	path string
	err  error
}
type copyMsg struct {
	text string
	err  error
}
type sessionStatsMsg struct {
	stats string
	err   error
}

// ---------------------------------------------------------------------------
// Chat entry
// ---------------------------------------------------------------------------

type chatEntry struct {
	role    string // user, assistant, tool_start, tool_end, thinking, error, info
	content string
	// tool_start / tool_end specifics
	toolName   string
	toolID     string
	isError    bool
	fullArgs   json.RawMessage // raw args for tool_start
	fullResult json.RawMessage // raw result for tool_end
}

// ---------------------------------------------------------------------------
// UI modes — what currently has focus
// ---------------------------------------------------------------------------

type uiMode int

const (
	modeChat       uiMode = iota // normal chat input
	modeDialog                   // extension UI dialog overlay
	modePicker                   // model picker overlay
	modeForkPicker               // fork message picker overlay
)

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type model struct {
	client *rpc.Client
	theme  Theme

	// Components
	viewport   viewport.Model
	input      textarea.Model
	spinner    spinner.Model
	stopwatch  stopwatch.Model
	help       help.Model
	dialog     *huh.Form  // active extension UI dialog, if any
	picker     list.Model // model picker list
	forkPicker list.Model // fork message picker list

	// Layout
	width, height int
	ready         bool

	// State
	chatLog       []chatEntry
	streaming     bool
	turnActive    bool
	streamBuf     *strings.Builder
	thinkBuf      *strings.Builder
	activeTools   map[string]string // toolCallId -> toolName
	toolsExpanded bool              // toggle all tool entries expanded/collapsed
	mode          uiMode
	dialogReqID   string // pending extension_ui_request ID
	quitting      bool
	err           error

	// Steering/follow-up queues (from queue_update events)
	steeringQueue []string
	followUpQueue []string

	// Progress overlay
	progressOverlay string // non-empty when overlay should show
	isCompacting    bool
	isRetrying      bool

	// Toast notification (transient overlay)
	toast      string // current toast text, empty when hidden
	toastLevel string // "info", "warning", "error"

	// Autocomplete state
	acMatches     []slashCmd // filtered matches
	acSelected    int        // selected index
	acVisible     bool       // whether autocomplete is showing
	extensionCmds []slashCmd // fetched from RPC get_commands

	// Session info (from get_state)
	modelName     string
	thinkingLevel string
	sessionName   string

	// Glamour renderer (cached per width)
	glamourWidth int
	glamour      *glamour.TermRenderer
}

func initialModel(client *rpc.Client) model {
	th := newTheme()

	ta := textarea.New()
	ta.Placeholder = "Message pi..."
	ta.Focus()
	ta.CharLimit = 0
	ta.SetWidth(80)
	ta.SetHeight(3)
	ta.ShowLineNumbers = false
	ta.FocusedStyle.CursorLine = lipgloss.NewStyle()
	ta.FocusedStyle.Base = lipgloss.NewStyle()
	ta.BlurredStyle.Base = lipgloss.NewStyle()

	sp := spinner.New()
	sp.Spinner = spinner.MiniDot
	sp.Style = lipgloss.NewStyle().Foreground(accent)

	h := help.New()
	h.Styles.ShortKey = th.HelpKey
	h.Styles.ShortDesc = th.HelpDesc
	h.Styles.ShortSeparator = th.HelpSep
	h.Styles.FullKey = th.HelpKey
	h.Styles.FullDesc = th.HelpDesc
	h.Styles.FullSeparator = th.HelpSep

	vp := viewport.New(80, 20)

	sw := stopwatch.New()

	return model{
		client:      client,
		theme:       th,
		viewport:    vp,
		input:       ta,
		spinner:     sp,
		stopwatch:   sw,
		help:        h,
		streamBuf:   &strings.Builder{},
		thinkBuf:    &strings.Builder{},
		activeTools: make(map[string]string),
		mode:        modeChat,
	}
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

func (m model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		textarea.Blink,
		waitForEvent(m.client),
		waitForDone(m.client),
		fetchState(m.client),
		doFetchCommands(m.client),
	)
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	// If a dialog is active, route messages there first
	if m.mode == modeDialog && m.dialog != nil {
		return m.updateDialog(msg)
	}

	// If the model picker is active, route messages there
	if m.mode == modePicker {
		return m.updatePicker(msg)
	}

	// If the fork picker is active, route messages there
	if m.mode == modeForkPicker {
		return m.updateForkPicker(msg)
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		// Handle autocomplete navigation when visible
		if m.acVisible && !m.streaming {
			switch msg.String() {
			case "tab", "enter":
				if m.acSelected < len(m.acMatches) {
					selected := m.acMatches[m.acSelected]
					m.input.SetValue("/" + selected.name)
					// Move cursor to end
					m.input.CursorEnd()
				}
				m.acVisible = false
				m.acMatches = nil
				// If it was Tab, don't also send — let user add args or press Enter again
				if msg.String() == "tab" {
					m.updateAutocomplete()
					return m, nil
				}
				// For Enter, fall through to the existing Send handler
			case "up":
				if m.acSelected > 0 {
					m.acSelected--
				}
				return m, nil
			case "down":
				if m.acSelected < len(m.acMatches)-1 {
					m.acSelected++
				}
				return m, nil
			case "esc":
				m.acVisible = false
				m.acMatches = nil
				return m, nil
			}
		}

		switch {
		case key.Matches(msg, keys.Quit):
			m.quitting = true
			return m, tea.Quit

		case key.Matches(msg, keys.Abort):
			if m.isCompacting || m.isRetrying {
				if m.client != nil {
					_ = m.client.Abort()
				}
				m.progressOverlay = ""
				m.isCompacting = false
				m.isRetrying = false
				m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Cancelled"})
				m.viewport.SetContent(m.renderChat())
				m.viewport.GotoBottom()
			} else if m.streaming && m.client != nil {
				_ = m.client.Abort()
				m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Aborted"})
				m.viewport.SetContent(m.renderChat())
				m.viewport.GotoBottom()
			} else if m.input.Value() != "" {
				m.input.Reset()
			}

		case key.Matches(msg, keys.CycleModel):
			if !m.streaming {
				cmds = append(cmds, doFetchModels(m.client))
			}

		case key.Matches(msg, keys.ClearChat):
			m.chatLog = nil
			m.viewport.SetContent("")
			m.viewport.GotoBottom()

		case key.Matches(msg, keys.ToggleExpand):
			if !m.streaming && !m.acVisible && m.mode == modeChat {
				m.toolsExpanded = !m.toolsExpanded
				m.viewport.SetContent(m.renderChat())
			}

		case key.Matches(msg, keys.Send):
			text := strings.TrimSpace(m.input.Value())
			if text != "" {
				m.input.Reset()

				// Handle built-in slash commands locally (only when not streaming)
				if !m.streaming {
					if cmd, handled := m.handleSlashCommand(text); handled {
						if cmd != nil {
							cmds = append(cmds, cmd)
						}
						m.viewport.SetContent(m.renderChat())
						m.viewport.GotoBottom()
						break
					}
				}

				if m.streaming {
					// During streaming, send as steer message
					m.chatLog = append(m.chatLog, chatEntry{role: "user", content: "→ " + text})
					m.viewport.SetContent(m.renderChat())
					m.viewport.GotoBottom()
					if m.client != nil {
						_ = m.client.Steer(text)
					}
				} else {
					// Normal prompt
					m.chatLog = append(m.chatLog, chatEntry{role: "user", content: text})
					m.streaming = true
					m.streamBuf.Reset()
					m.thinkBuf.Reset()
					m.viewport.SetContent(m.renderChat())
					m.viewport.GotoBottom()
					cmds = append(cmds, doPrompt(m.client, text))
				}
			}
		default:
			// Pass to textarea for text input
			var cmd tea.Cmd
			m.input, cmd = m.input.Update(msg)
			cmds = append(cmds, cmd)
			m.updateAutocomplete()
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		m.relayout()

	case rpcEventMsg:
		cmds = append(cmds, m.handleEvent(json.RawMessage(msg))...)
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()
		cmds = append(cmds, waitForEvent(m.client))
		// Dynamic placeholder
		if m.streaming {
			m.input.Placeholder = "Steer pi..."
		} else {
			m.input.Placeholder = "Message pi..."
		}

	case toastExpireMsg:
		m.toast = ""
		m.toastLevel = ""

	case rpcDoneMsg:
		m.quitting = true
		return m, tea.Quit

	case errMsg:
		m.err = msg.err
		m.chatLog = append(m.chatLog, chatEntry{role: "error", content: msg.err.Error()})
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case commandsMsg:
		if msg.err == nil {
			m.extensionCmds = msg.cmds
		}

	case stateMsg:
		if msg.state != nil {
			if msg.state.Model != nil {
				m.modelName = fmt.Sprintf("%s/%s", msg.state.Model.Provider, msg.state.Model.ID)
			}
			m.thinkingLevel = msg.state.ThinkingLevel
			m.sessionName = msg.state.SessionName
		}

	case cycleModelMsg:
		if msg.provider != "" {
			m.modelName = msg.provider + "/" + msg.modelID
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Switched to " + m.modelName})
			m.viewport.SetContent(m.renderChat())
			m.viewport.GotoBottom()
		}

	case modelsListMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Failed to fetch models: " + msg.err.Error()})
			m.viewport.SetContent(m.renderChat())
			m.viewport.GotoBottom()
		} else {
			items := make([]list.Item, len(msg.models))
			for i, mdl := range msg.models {
				items[i] = modelItem{provider: mdl.Provider, modelID: mdl.ID}
			}
			delegate := list.NewDefaultDelegate()
			m.picker = list.New(items, delegate, m.width-4, m.height-6)
			m.picker.Title = "Select Model"
			m.picker.SetShowStatusBar(true)
			m.picker.SetFilteringEnabled(true)
			m.picker.SetShowHelp(true)
			m.mode = modePicker
		}

	case setModelMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Set model failed: " + msg.err.Error()})
		} else {
			m.modelName = msg.provider + "/" + msg.modelID
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Switched to " + m.modelName})
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case newSessionMsg:
		m.chatLog = nil
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "New session started"})
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()
		cmds = append(cmds, fetchState(m.client))

	case compactMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Compact failed: " + msg.err.Error()})
		} else {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Context compacted"})
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case sessionNameMsg:
		m.sessionName = msg.name
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Session named: " + msg.name})
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case exportMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Export failed: " + msg.err.Error()})
		} else {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Exported to " + msg.path})
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case copyMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Copy failed: " + msg.err.Error()})
		} else if msg.text != "" {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Copied last message to clipboard"})
		} else {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "No assistant message to copy"})
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case sessionStatsMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Stats failed: " + msg.err.Error()})
		} else {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: msg.stats})
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case forkMessagesMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Fork failed: " + msg.err.Error()})
			m.viewport.SetContent(m.renderChat())
			m.viewport.GotoBottom()
		} else if len(msg.messages) == 0 {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "No messages to fork from"})
			m.viewport.SetContent(m.renderChat())
			m.viewport.GotoBottom()
		} else {
			items := make([]list.Item, len(msg.messages))
			for i, fm := range msg.messages {
				items[i] = forkItem{entryID: fm.EntryID, text: fm.Text}
			}
			m.forkPicker = list.New(items, list.NewDefaultDelegate(), m.width-4, m.height-6)
			m.forkPicker.Title = "Fork from message"
			m.forkPicker.SetFilteringEnabled(true)
			m.mode = modeForkPicker
		}

	case forkResultMsg:
		if msg.err != nil {
			m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Fork failed: " + msg.err.Error()})
		} else {
			m.chatLog = nil
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Forked to new branch"})
			cmds = append(cmds, fetchState(m.client))
		}
		m.viewport.SetContent(m.renderChat())
		m.viewport.GotoBottom()

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		cmds = append(cmds, cmd)

	case stopwatch.TickMsg, stopwatch.StartStopMsg, stopwatch.ResetMsg:
		var cmd tea.Cmd
		m.stopwatch, cmd = m.stopwatch.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Viewport scrolling (always active)
	{
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

// updateDialog handles input when an extension UI dialog is active.
func (m model) updateDialog(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	// Allow quit even in dialog
	if keyMsg, ok := msg.(tea.KeyMsg); ok && key.Matches(keyMsg, keys.Quit) {
		m.quitting = true
		return m, tea.Quit
	}

	// Pass rpc events through even during dialog
	if ev, ok := msg.(rpcEventMsg); ok {
		cmds = append(cmds, m.handleEvent(json.RawMessage(ev))...)
		m.viewport.SetContent(m.renderChat())
		cmds = append(cmds, waitForEvent(m.client))
	}

	// Handle toast expiration during dialog
	if _, ok := msg.(toastExpireMsg); ok {
		m.toast = ""
		m.toastLevel = ""
	}

	// Spinner ticks
	if tickMsg, ok := msg.(spinner.TickMsg); ok {
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(tickMsg)
		cmds = append(cmds, cmd)
	}

	// Stopwatch ticks
	switch msg.(type) {
	case stopwatch.TickMsg, stopwatch.StartStopMsg, stopwatch.ResetMsg:
		var cmd tea.Cmd
		m.stopwatch, cmd = m.stopwatch.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Update the form
	form, cmd := m.dialog.Update(msg)
	if f, ok := form.(*huh.Form); ok {
		m.dialog = f
	}
	cmds = append(cmds, cmd)

	// Check if form completed
	if m.dialog.State == huh.StateCompleted {
		m.finishDialog(false)
	} else if m.dialog.State == huh.StateAborted {
		m.finishDialog(true)
	}

	return m, tea.Batch(cmds...)
}

// updatePicker handles input when the model picker overlay is active.
func (m model) updatePicker(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		case "esc":
			// Close picker, return to chat
			m.mode = modeChat
			m.input.Focus()
			return m, nil
		case "enter":
			// Select the current item
			if item, ok := m.picker.SelectedItem().(modelItem); ok {
				m.mode = modeChat
				m.input.Focus()
				m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Switching to " + item.Title() + "..."})
				m.viewport.SetContent(m.renderChat())
				cmds = append(cmds, doSetModel(m.client, item.provider, item.modelID))
				return m, tea.Batch(cmds...)
			}
			m.mode = modeChat
			m.input.Focus()
			return m, nil
		}
	}

	// Pass rpc events through
	if ev, ok := msg.(rpcEventMsg); ok {
		cmds = append(cmds, m.handleEvent(json.RawMessage(ev))...)
		m.viewport.SetContent(m.renderChat())
		cmds = append(cmds, waitForEvent(m.client))
	}

	// Toast expiration
	if _, ok := msg.(toastExpireMsg); ok {
		m.toast = ""
		m.toastLevel = ""
	}

	// Spinner/stopwatch ticks
	if tickMsg, ok := msg.(spinner.TickMsg); ok {
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(tickMsg)
		cmds = append(cmds, cmd)
	}
	switch msg.(type) {
	case stopwatch.TickMsg, stopwatch.StartStopMsg, stopwatch.ResetMsg:
		var cmd tea.Cmd
		m.stopwatch, cmd = m.stopwatch.Update(msg)
		cmds = append(cmds, cmd)
	}

	// Update the list
	var cmd tea.Cmd
	m.picker, cmd = m.picker.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// updateForkPicker handles input when the fork message picker overlay is active.
func (m model) updateForkPicker(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		case "esc":
			m.mode = modeChat
			m.input.Focus()
			return m, nil
		case "enter":
			if item, ok := m.forkPicker.SelectedItem().(forkItem); ok {
				m.mode = modeChat
				m.input.Focus()
				m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Forking from: " + item.Title() + "..."})
				m.viewport.SetContent(m.renderChat())
				cmds = append(cmds, doFork(m.client, item.entryID))
				return m, tea.Batch(cmds...)
			}
			m.mode = modeChat
			m.input.Focus()
			return m, nil
		}
	}

	// Pass rpc events through
	if ev, ok := msg.(rpcEventMsg); ok {
		cmds = append(cmds, m.handleEvent(json.RawMessage(ev))...)
		m.viewport.SetContent(m.renderChat())
		cmds = append(cmds, waitForEvent(m.client))
	}
	if _, ok := msg.(toastExpireMsg); ok {
		m.toast = ""
		m.toastLevel = ""
	}
	if tickMsg, ok := msg.(spinner.TickMsg); ok {
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(tickMsg)
		cmds = append(cmds, cmd)
	}
	switch msg.(type) {
	case stopwatch.TickMsg, stopwatch.StartStopMsg, stopwatch.ResetMsg:
		var cmd tea.Cmd
		m.stopwatch, cmd = m.stopwatch.Update(msg)
		cmds = append(cmds, cmd)
	}

	var cmd tea.Cmd
	m.forkPicker, cmd = m.forkPicker.Update(msg)
	cmds = append(cmds, cmd)

	return m, tea.Batch(cmds...)
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

func (m model) View() string {
	if m.quitting {
		return ""
	}
	if !m.ready {
		return "\n  Initializing..."
	}

	th := m.theme

	// Header
	header := th.Logo.Render("pi-charm")
	badges := m.renderBadges()
	if badges != "" {
		header = lipgloss.JoinHorizontal(lipgloss.Center, header, badges)
	}

	// Dividers
	divider := th.Divider.Render(strings.Repeat("─", max(m.width-2, 0)))

	// Status line (streaming indicator + spinner + stopwatch + toast)
	statusLine := ""
	if m.streaming {
		status := m.spinner.View() + " " + m.stopwatch.View() + " streaming..."
		if qc := len(m.steeringQueue) + len(m.followUpQueue); qc > 0 {
			status += fmt.Sprintf(" [%d queued]", qc)
		}
		statusLine = th.StatusBar.Render(status)
	}
	if m.toast != "" {
		var toastStyle lipgloss.Style
		switch m.toastLevel {
		case "warning":
			toastStyle = th.ToastWarning
		case "error":
			toastStyle = th.ToastError
		default:
			toastStyle = th.ToastInfo
		}
		toastPill := toastStyle.Render(m.toast)
		if statusLine != "" {
			statusLine = lipgloss.JoinHorizontal(lipgloss.Center, statusLine, "  ", toastPill)
		} else {
			statusLine = toastPill
		}
	}

	// Help bar
	helpView := m.help.View(keys)

	// Autocomplete popup (shown above input when typing "/")
	acView := m.renderAutocomplete()

	// Dialog overlay or input
	var inputArea string
	if m.mode == modeDialog && m.dialog != nil {
		inputArea = m.dialog.View()
	} else if m.mode == modePicker {
		inputArea = m.picker.View()
	} else if m.mode == modeForkPicker {
		inputArea = m.forkPicker.View()
	} else {
		inputArea = m.input.View()
	}

	// Progress overlay (compaction/retry)
	viewportView := m.viewport.View()
	if m.progressOverlay != "" {
		overlayContent := m.spinner.View() + " " + m.progressOverlay + "\n\n" + th.HelpDesc.Render("Press Esc to cancel")
		overlayBox := th.ProgressOverlay.Render(overlayContent)
		viewportView = lipgloss.Place(
			m.viewport.Width, m.viewport.Height,
			lipgloss.Center, lipgloss.Center,
			overlayBox,
		)
	}

	return th.App.Render(
		lipgloss.JoinVertical(lipgloss.Left,
			header,
			divider,
			viewportView,
			divider,
			statusLine,
			acView,
			inputArea,
			helpView,
		),
	)
}

// renderBadges builds pill-style status badges for model/thinking/session.
func (m model) renderBadges() string {
	th := m.theme
	var badges []string

	if m.modelName != "" {
		badges = append(badges, th.BadgeVal.Render(m.modelName))
	}
	if m.thinkingLevel != "" && m.thinkingLevel != "off" {
		badges = append(badges,
			th.BadgeKey.Render("think:")+th.BadgeVal.Render(m.thinkingLevel))
	}
	if m.sessionName != "" {
		badges = append(badges,
			th.BadgeKey.Render("session:")+th.BadgeVal.Render(m.sessionName))
	}

	if len(badges) == 0 {
		return ""
	}
	return th.StatusBar.Render(strings.Join(badges, th.HelpSep.Render(" | ")))
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

func (m *model) relayout() {
	contentWidth := m.width - 2 // app padding
	headerHeight := 1
	dividerLines := 2
	statusLine := 1
	inputHeight := 3
	helpHeight := 1
	chrome := headerHeight + dividerLines + statusLine + inputHeight + helpHeight

	m.viewport.Width = contentWidth
	m.viewport.Height = max(m.height-chrome, 3)
	m.input.SetWidth(contentWidth)

	// Invalidate glamour cache if width changed
	if m.glamourWidth != contentWidth {
		m.glamourWidth = contentWidth
		m.glamour = nil
	}

	m.viewport.SetContent(m.renderChat())
}

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

// dismissToast returns a tea.Cmd that fires a toastExpireMsg after the given duration.
func dismissToast(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(t time.Time) tea.Msg {
		return toastExpireMsg{}
	})
}

// ---------------------------------------------------------------------------
// Slash command handling
// ---------------------------------------------------------------------------

// slashCmd describes a slash command for autocomplete display.
type slashCmd struct {
	name string
	desc string
}

// slashCommands lists all built-in slash commands shown in autocomplete.
var slashCommands = []slashCmd{
	{"clear", "Clear chat history"},
	{"model", "Open model picker"},
	{"new", "Start new session"},
	{"compact", "Compact session context"},
	{"name", "Set session name"},
	{"export", "Export session to HTML"},
	{"copy", "Copy last assistant message"},
	{"fork", "Fork session from a message"},
	{"session", "Show session stats"},
	{"hotkeys", "Show keyboard shortcuts"},
	{"quit", "Quit pi-charm"},
	{"help", "Show available commands"},
}

// handleSlashCommand intercepts built-in slash commands that RPC mode doesn't
// handle. Returns (cmd, true) if handled, (nil, false) to pass through to pi.
func (m *model) handleSlashCommand(text string) (tea.Cmd, bool) {
	if !strings.HasPrefix(text, "/") {
		return nil, false
	}

	parts := strings.Fields(text)
	cmd := strings.TrimPrefix(parts[0], "/")

	switch cmd {
	case "clear":
		m.chatLog = nil
		m.viewport.SetContent("")
		return nil, true

	case "model":
		return doFetchModels(m.client), true

	case "new":
		m.chatLog = nil
		m.viewport.SetContent("")
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Starting new session..."})
		return doNewSession(m.client), true

	case "compact":
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Compacting..."})
		return doCompact(m.client), true

	case "name":
		if len(parts) > 1 {
			name := strings.Join(parts[1:], " ")
			return doSetSessionName(m.client, name), true
		}
		m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "Usage: /name <session name>"})
		return nil, true

	case "quit":
		m.quitting = true
		return tea.Quit, true

	case "export":
		path := ""
		if len(parts) > 1 {
			path = parts[1]
		}
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Exporting session..."})
		return doExportHTML(m.client, path), true

	case "copy":
		return doCopyLastMessage(m.client), true

	case "session":
		return doGetSessionStats(m.client), true

	case "hotkeys":
		helpText := "Keybindings:\n"
		for _, group := range keys.FullHelp() {
			for _, k := range group {
				helpText += fmt.Sprintf("  %s — %s\n", k.Help().Key, k.Help().Desc)
			}
		}
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: helpText})
		return nil, true

	case "help":
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Slash commands: /clear /model /new /compact /name /fork /export /copy /session /hotkeys /quit /help"})
		return nil, true

	case "fork":
		return doFetchForkMessages(m.client), true

	case "login", "logout", "settings", "share", "resume":
		m.chatLog = append(m.chatLog, chatEntry{role: "error", content: "/" + cmd + " is not yet supported in pi-charm"})
		return nil, true
	}

	// Not a known built-in — pass through to pi (could be an extension command)
	return nil, false
}

// updateAutocomplete refreshes the autocomplete matches based on current input.
func (m *model) updateAutocomplete() {
	text := m.input.Value()
	if !strings.HasPrefix(text, "/") || strings.Contains(text, " ") {
		m.acVisible = false
		m.acMatches = nil
		m.acSelected = 0
		return
	}

	prefix := strings.TrimPrefix(text, "/")
	var matches []slashCmd
	// Built-in commands first
	for _, cmd := range slashCommands {
		if strings.HasPrefix(cmd.name, prefix) {
			matches = append(matches, cmd)
		}
	}
	// Extension commands
	for _, cmd := range m.extensionCmds {
		if strings.HasPrefix(cmd.name, prefix) {
			matches = append(matches, cmd)
		}
	}

	m.acMatches = matches
	m.acVisible = len(matches) > 0
	if m.acSelected >= len(matches) {
		m.acSelected = max(len(matches)-1, 0)
	}
}

// renderAutocomplete renders the autocomplete popup as styled text.
func (m *model) renderAutocomplete() string {
	if !m.acVisible || len(m.acMatches) == 0 {
		return ""
	}

	th := m.theme
	var sb strings.Builder
	for i, cmd := range m.acMatches {
		name := "/" + cmd.name
		desc := cmd.desc
		if i == m.acSelected {
			// Highlighted item
			sb.WriteString(th.BadgeVal.Render(name) + " " + th.HelpDesc.Render(desc))
		} else {
			sb.WriteString(th.HelpKey.Render(name) + " " + th.HelpDesc.Render(desc))
		}
		sb.WriteString("\n")
	}
	return strings.TrimRight(sb.String(), "\n")
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

func (m *model) handleEvent(raw json.RawMessage) []tea.Cmd {
	var ev rpc.Event
	if err := json.Unmarshal(raw, &ev); err != nil {
		return nil
	}

	var cmds []tea.Cmd

	switch ev.Type {
	case "agent_start":
		m.streaming = true
		m.turnActive = true
		cmds = append(cmds, m.stopwatch.Reset(), m.stopwatch.Start())

	case "agent_end":
		m.flushStream()
		m.streaming = false
		m.turnActive = false
		m.steeringQueue = nil
		m.followUpQueue = nil
		cmds = append(cmds, m.stopwatch.Stop())

	case "message_update":
		if ev.AssistantMessageEvent != nil {
			switch ev.AssistantMessageEvent.Type {
			case "text_delta":
				m.streamBuf.WriteString(ev.AssistantMessageEvent.Delta)
			case "thinking_delta":
				m.thinkBuf.WriteString(ev.AssistantMessageEvent.ThinkingDelta)
			}
		}

	case "message_end":
		m.flushStream()

	case "tool_execution_start":
		m.activeTools[ev.ToolCallID] = ev.ToolName
		argSummary := summarizeToolArgs(ev.Args)
		m.chatLog = append(m.chatLog, chatEntry{
			role:     "tool_start",
			toolName: ev.ToolName,
			toolID:   ev.ToolCallID,
			content:  argSummary,
			fullArgs: ev.Args,
		})

	case "tool_execution_end":
		name := m.activeTools[ev.ToolCallID]
		delete(m.activeTools, ev.ToolCallID)
		resultSummary := summarizeToolResult(ev.Result)
		m.chatLog = append(m.chatLog, chatEntry{
			role:       "tool_end",
			toolName:   name,
			toolID:     ev.ToolCallID,
			content:    resultSummary,
			isError:    ev.IsError,
			fullResult: ev.Result,
		})

	case "compaction_start":
		m.isCompacting = true
		m.progressOverlay = "Compacting context..."
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Compacting context..."})

	case "compaction_end":
		m.isCompacting = false
		m.progressOverlay = ""
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: "Context compacted"})

	case "auto_retry_start":
		m.isRetrying = true
		m.progressOverlay = fmt.Sprintf("Retrying (attempt %d/%d)...", ev.Attempt, ev.MaxAttempts)
		m.chatLog = append(m.chatLog, chatEntry{
			role:    "info",
			content: fmt.Sprintf("Retrying (attempt %d/%d)...", ev.Attempt, ev.MaxAttempts),
		})

	case "auto_retry_end":
		m.isRetrying = false
		m.progressOverlay = ""

	case "queue_update":
		m.steeringQueue = ev.Steering
		m.followUpQueue = ev.FollowUp

	case "extension_ui_request":
		var uiReq rpc.ExtensionUIRequest
		if err := json.Unmarshal(raw, &uiReq); err == nil {
			cmds = append(cmds, m.handleExtensionUI(uiReq)...)
		}
	}

	return cmds
}

func (m *model) flushStream() {
	if m.thinkBuf.Len() > 0 {
		text := strings.TrimSpace(m.thinkBuf.String())
		if text != "" {
			m.chatLog = append(m.chatLog, chatEntry{role: "thinking", content: text})
		}
		m.thinkBuf.Reset()
	}
	if m.streamBuf.Len() > 0 {
		text := strings.TrimSpace(m.streamBuf.String())
		if text != "" {
			m.chatLog = append(m.chatLog, chatEntry{role: "assistant", content: text})
		}
		m.streamBuf.Reset()
	}
}

// ---------------------------------------------------------------------------
// Extension UI handling via Huh
// ---------------------------------------------------------------------------

func (m *model) handleExtensionUI(req rpc.ExtensionUIRequest) []tea.Cmd {
	switch req.Method {
	case "notify":
		msg := req.Message
		if msg == "" {
			msg = req.Title
		}
		level := "info"
		if req.NotifyType == "warning" {
			level = "warning"
		} else if req.NotifyType == "error" {
			level = "error"
		}
		m.chatLog = append(m.chatLog, chatEntry{role: "info", content: msg})
		m.toast = msg
		m.toastLevel = level
		return []tea.Cmd{dismissToast(4 * time.Second)}

	case "setStatus":
		if req.StatusText != "" {
			m.chatLog = append(m.chatLog, chatEntry{role: "info", content: req.StatusText})
			m.toast = req.StatusText
			m.toastLevel = "info"
			return []tea.Cmd{dismissToast(4 * time.Second)}
		}

	case "select":
		m.dialogReqID = req.ID
		options := make([]huh.Option[string], len(req.Options))
		for i, opt := range req.Options {
			options[i] = huh.NewOption(opt, opt)
		}
		var selected string
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewSelect[string]().
					Title(req.Title).
					Options(options...).
					Value(&selected).
					Key("value"),
			),
		).WithShowHelp(true).WithTheme(newHuhTheme())
		m.dialog = form
		m.mode = modeDialog
		return []tea.Cmd{m.dialog.Init()}

	case "confirm":
		m.dialogReqID = req.ID
		var confirmed bool
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewConfirm().
					Title(req.Title).
					Description(req.Message).
					Value(&confirmed).
					Key("confirmed"),
			),
		).WithShowHelp(true).WithTheme(newHuhTheme())
		m.dialog = form
		m.mode = modeDialog
		return []tea.Cmd{m.dialog.Init()}

	case "input":
		m.dialogReqID = req.ID
		var value string
		inp := huh.NewInput().
			Title(req.Title).
			Value(&value).
			Key("value")
		if req.Placeholder != "" {
			inp = inp.Placeholder(req.Placeholder)
		}
		form := huh.NewForm(
			huh.NewGroup(inp),
		).WithShowHelp(true).WithTheme(newHuhTheme())
		m.dialog = form
		m.mode = modeDialog
		return []tea.Cmd{m.dialog.Init()}

	case "editor":
		m.dialogReqID = req.ID
		var value string
		if req.Prefill != "" {
			value = req.Prefill
		}
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewText().
					Title(req.Title).
					Value(&value).
					Key("value"),
			),
		).WithShowHelp(true).WithTheme(newHuhTheme())
		m.dialog = form
		m.mode = modeDialog
		return []tea.Cmd{m.dialog.Init()}

	default:
		// For unsupported methods (setWidget, setTitle, set_editor_text), cancel
		if req.ID != "" && m.client != nil {
			cancelled := true
			_ = m.client.SendUIResponse(rpc.ExtensionUIResponse{
				Type:      "extension_ui_response",
				ID:        req.ID,
				Cancelled: &cancelled,
			})
		}
	}

	return nil
}

// finishDialog sends the dialog result back to pi and returns to chat mode.
func (m *model) finishDialog(cancelled bool) {
	if m.dialogReqID == "" {
		m.mode = modeChat
		m.dialog = nil
		return
	}

	if m.client != nil {
		if cancelled {
			c := true
			_ = m.client.SendUIResponse(rpc.ExtensionUIResponse{
				Type:      "extension_ui_response",
				ID:        m.dialogReqID,
				Cancelled: &c,
			})
		} else {
			// Try to get the value or confirmed status
			val := m.dialog.GetString("value")
			if val != "" {
				_ = m.client.SendUIResponse(rpc.ExtensionUIResponse{
					Type:  "extension_ui_response",
					ID:    m.dialogReqID,
					Value: val,
				})
			} else {
				confirmed := m.dialog.GetBool("confirmed")
				_ = m.client.SendUIResponse(rpc.ExtensionUIResponse{
					Type:      "extension_ui_response",
					ID:        m.dialogReqID,
					Confirmed: &confirmed,
				})
			}
		}
	}

	m.dialogReqID = ""
	m.dialog = nil
	m.mode = modeChat
	m.input.Focus()
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

func (m *model) getGlamour() *glamour.TermRenderer {
	if m.glamour == nil {
		r, err := glamour.NewTermRenderer(
			glamour.WithAutoStyle(),
			glamour.WithWordWrap(m.viewport.Width),
		)
		if err == nil {
			m.glamour = r
		}
	}
	return m.glamour
}

func (m *model) renderChat() string {
	th := m.theme
	var sb strings.Builder
	blockWidth := max(m.viewport.Width-4, 20)

	for _, entry := range m.chatLog {
		switch entry.role {
		case "user":
			content := th.UserLabel.Render("You") + "\n" + th.UserText.Render(entry.content)
			sb.WriteString(th.UserBlock.Width(blockWidth).Render(content) + "\n")

		case "assistant":
			label := th.AssistantLabel.Render("Pi")
			var body string
			if r := m.getGlamour(); r != nil {
				rendered, err := r.Render(entry.content)
				if err == nil {
					body = strings.TrimRight(rendered, "\n")
				} else {
					body = th.AssistantText.Render(entry.content)
				}
			} else {
				body = th.AssistantText.Render(entry.content)
			}
			sb.WriteString(th.AssistantBlock.Width(blockWidth).Render(label+"\n"+body) + "\n")

		case "thinking":
			if m.toolsExpanded {
				sb.WriteString(th.ThinkingText.Render("thinking:") + "\n")
				sb.WriteString(th.ToolBox.Render(entry.content) + "\n")
			} else {
				lines := strings.Split(entry.content, "\n")
				preview := lines[0]
				if len(preview) > 80 {
					preview = preview[:77] + "..."
				}
				indicator := ""
				if len(lines) > 1 || len(entry.content) > 80 {
					indicator = " [+]"
				}
				sb.WriteString(th.ThinkingText.Render("thinking: "+preview+indicator) + "\n")
			}

		case "tool_start":
			icon := toolIcon(entry.toolName)
			line := icon + " " + th.ToolName.Render(entry.toolName)
			if entry.content != "" {
				line += " " + th.ToolArg.Render(entry.content)
			}
			sb.WriteString(th.ToolRunning.Render(line) + "\n")
			if m.toolsExpanded && entry.fullArgs != nil {
				tableStr := renderToolArgsTable(entry.fullArgs, th, blockWidth-4)
				if tableStr != "" {
					sb.WriteString(tableStr + "\n")
				}
			}

		case "tool_end":
			style := th.ToolDone
			icon := "done"
			if entry.isError {
				style = th.ToolError
				icon = "fail"
			}
			line := icon
			if entry.content != "" {
				line += " " + entry.content
			}
			sb.WriteString(style.Render("  "+line) + "\n")
			if m.toolsExpanded && entry.fullResult != nil {
				var resultStr string
				if json.Unmarshal(entry.fullResult, &resultStr) == nil {
					if len(resultStr) > 500 {
						resultStr = resultStr[:497] + "..."
					}
					sb.WriteString(th.ToolBox.Render(resultStr) + "\n")
				} else {
					var pretty interface{}
					if json.Unmarshal(entry.fullResult, &pretty) == nil {
						formatted, err := json.MarshalIndent(pretty, "    ", "  ")
						if err == nil {
							out := string(formatted)
							if len(out) > 500 {
								out = out[:497] + "..."
							}
							sb.WriteString(th.ToolBox.Render(out) + "\n")
						}
					}
				}
			}

		case "error":
			sb.WriteString(th.ErrorText.Render("error: "+entry.content) + "\n")

		case "info":
			sb.WriteString(th.ThinkingText.Render(entry.content) + "\n")
		}
	}

	// In-progress streaming
	if m.streaming {
		if m.thinkBuf.Len() > 0 {
			text := m.thinkBuf.String()
			lines := strings.Split(text, "\n")
			last := lines[len(lines)-1]
			if len(last) > 80 {
				last = last[:77] + "..."
			}
			sb.WriteString(th.ThinkingText.Render("thinking: "+last) + "\n")
		}
		if m.streamBuf.Len() > 0 {
			label := th.AssistantLabel.Render("Pi")
			text := m.streamBuf.String()
			var body string
			if r := m.getGlamour(); r != nil {
				rendered, err := r.Render(text)
				if err == nil {
					body = strings.TrimRight(rendered, "\n")
				} else {
					body = th.AssistantText.Render(text)
				}
			} else {
				body = th.AssistantText.Render(text)
			}
			sb.WriteString(th.AssistantBlock.Width(blockWidth).Render(label+"\n"+body) + "\n")
		}
	}

	return sb.String()
}

// ---------------------------------------------------------------------------
// Tool display helpers
// ---------------------------------------------------------------------------

// toolIcon returns a short icon/prefix based on tool name.
func toolIcon(name string) string {
	switch name {
	case "bash":
		return "$"
	case "read":
		return "r"
	case "write":
		return "w"
	case "edit":
		return "e"
	case "grep":
		return "/"
	case "find":
		return "?"
	case "ls":
		return "d"
	default:
		return ">"
	}
}

// renderToolArgsTable renders tool args as a styled two-column table.
func renderToolArgsTable(raw json.RawMessage, th Theme, maxWidth int) string {
	var args map[string]interface{}
	if json.Unmarshal(raw, &args) != nil {
		return ""
	}

	keys := make([]string, 0, len(args))
	for k := range args {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	rows := make([][]string, 0, len(keys))
	for _, k := range keys {
		val := fmt.Sprintf("%v", args[k])
		if len(val) > 80 {
			val = val[:77] + "..."
		}
		rows = append(rows, []string{k, val})
	}

	t := table.New().
		Border(lipgloss.NormalBorder()).
		BorderStyle(lipgloss.NewStyle().Foreground(subtle)).
		Width(maxWidth).
		StyleFunc(func(row, col int) lipgloss.Style {
			if col == 0 {
				return th.ToolName.Width(12)
			}
			return th.ToolArg
		}).
		Rows(rows...)

	return t.Render()
}

// summarizeToolArgs extracts a compact summary from tool call args.
func summarizeToolArgs(raw json.RawMessage) string {
	if raw == nil {
		return ""
	}
	var args map[string]interface{}
	if json.Unmarshal(raw, &args) != nil {
		return ""
	}

	// Pick the most interesting arg to show
	for _, key := range []string{"command", "path", "file_path", "pattern", "content"} {
		if v, ok := args[key]; ok {
			if s, ok := v.(string); ok {
				if len(s) > 70 {
					s = s[:67] + "..."
				}
				return s
			}
		}
	}

	// Fallback: first string value
	for _, v := range args {
		if s, ok := v.(string); ok {
			if len(s) > 70 {
				s = s[:67] + "..."
			}
			return s
		}
	}
	return ""
}

// summarizeToolResult extracts a compact summary from tool result.
func summarizeToolResult(raw json.RawMessage) string {
	if raw == nil {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if len(s) > 100 {
			s = s[:97] + "..."
		}
		return s
	}
	return ""
}

// ---------------------------------------------------------------------------
// Tea commands (async)
// ---------------------------------------------------------------------------

func doFetchForkMessages(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		msgs, err := client.GetForkMessages()
		if err != nil {
			return forkMessagesMsg{err: err}
		}
		return forkMessagesMsg{messages: msgs}
	}
}

func doFork(client *rpc.Client, entryID string) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.Fork(entryID)
		if err != nil {
			return forkResultMsg{err: err}
		}
		if !resp.Success {
			return forkResultMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		return forkResultMsg{}
	}
}

func doFetchCommands(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.Send(rpc.Command{Type: "get_commands"})
		if err != nil {
			return commandsMsg{err: err}
		}
		if !resp.Success {
			return commandsMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		var data struct {
			Commands []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			} `json:"commands"`
		}
		if json.Unmarshal(resp.Data, &data) != nil {
			return commandsMsg{}
		}
		var cmds []slashCmd
		for _, c := range data.Commands {
			cmds = append(cmds, slashCmd{name: c.Name, desc: c.Description})
		}
		return commandsMsg{cmds: cmds}
	}
}

func waitForEvent(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		raw, ok := <-client.Events()
		if !ok {
			return rpcDoneMsg{}
		}
		return rpcEventMsg(raw)
	}
}

func waitForDone(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		<-client.Done()
		return rpcDoneMsg{}
	}
}

func fetchState(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		state, err := client.GetState()
		if err != nil {
			return errMsg{err}
		}
		return stateMsg{state}
	}
}

func doPrompt(client *rpc.Client, text string) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		if err := client.Prompt(text); err != nil {
			return errMsg{err}
		}
		return nil
	}
}

func doFetchModels(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		models, err := client.GetAvailableModels()
		if err != nil {
			return modelsListMsg{err: err}
		}
		return modelsListMsg{models: models}
	}
}

func doSetModel(client *rpc.Client, provider, modelID string) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.Send(rpc.Command{
			Type:     "set_model",
			Provider: provider,
			ModelID:  modelID,
		})
		if err != nil {
			return setModelMsg{err: err}
		}
		if !resp.Success {
			return setModelMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		return setModelMsg{provider: provider, modelID: modelID}
	}
}

func doCycleModel(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.CycleModel()
		if err != nil {
			return errMsg{err}
		}
		if !resp.Success || resp.Data == nil {
			return nil
		}
		var data struct {
			Model struct {
				Provider string `json:"provider"`
				ID       string `json:"id"`
			} `json:"model"`
		}
		if json.Unmarshal(resp.Data, &data) != nil {
			return nil
		}
		return cycleModelMsg{provider: data.Model.Provider, modelID: data.Model.ID}
	}
}

type newSessionMsg struct{}
type compactMsg struct{ err error }
type sessionNameMsg struct{ name string }

func doNewSession(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		_, err := client.NewSession()
		if err != nil {
			return errMsg{err}
		}
		return newSessionMsg{}
	}
}

func doCompact(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.Send(rpc.Command{Type: "compact"})
		if err != nil {
			return compactMsg{err: err}
		}
		if !resp.Success {
			return compactMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		return compactMsg{}
	}
}

func doSetSessionName(client *rpc.Client, name string) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		err := client.SendAsync(rpc.Command{Type: "set_session_name", Name: name})
		if err != nil {
			return errMsg{err}
		}
		return sessionNameMsg{name: name}
	}
}

func doExportHTML(client *rpc.Client, path string) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.ExportHTML(path)
		if err != nil {
			return exportMsg{err: err}
		}
		if !resp.Success {
			return exportMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		var data struct {
			Path string `json:"path"`
		}
		if json.Unmarshal(resp.Data, &data) == nil {
			return exportMsg{path: data.Path}
		}
		return exportMsg{path: "exported"}
	}
}

func doCopyLastMessage(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.GetLastAssistantText()
		if err != nil {
			return copyMsg{err: err}
		}
		if !resp.Success {
			return copyMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		var data struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(resp.Data, &data) == nil {
			return copyMsg{text: data.Text}
		}
		return copyMsg{err: fmt.Errorf("no text")}
	}
}

func doGetSessionStats(client *rpc.Client) tea.Cmd {
	if client == nil {
		return nil
	}
	return func() tea.Msg {
		resp, err := client.GetSessionStats()
		if err != nil {
			return sessionStatsMsg{err: err}
		}
		if !resp.Success {
			return sessionStatsMsg{err: fmt.Errorf("%s", resp.Error)}
		}
		var stats map[string]interface{}
		if json.Unmarshal(resp.Data, &stats) == nil {
			var parts []string
			for k, v := range stats {
				parts = append(parts, fmt.Sprintf("%s: %v", k, v))
			}
			sort.Strings(parts)
			return sessionStatsMsg{stats: strings.Join(parts, " | ")}
		}
		return sessionStatsMsg{stats: string(resp.Data)}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	piPath := os.Getenv("PI_PATH")
	if piPath == "" {
		// Try to find pi relative to this binary's location (monorepo sibling)
		exe, _ := os.Executable()
		if exe != "" {
			candidate := filepath.Join(filepath.Dir(exe), "..", "coding-agent", "dist", "cli.js")
			if _, err := os.Stat(candidate); err == nil {
				piPath = "node " + candidate
			}
		}
		// Try relative to cwd (running from packages/pi-charm/)
		if piPath == "" {
			candidate := filepath.Join("..", "coding-agent", "dist", "cli.js")
			if abs, err := filepath.Abs(candidate); err == nil {
				if _, err := os.Stat(abs); err == nil {
					piPath = "node " + abs
				}
			}
		}
		if piPath == "" {
			piPath = "pi"
		}
	}

	cwd, _ := os.Getwd()

	client, err := rpc.NewClient(piPath, cwd)
	if err != nil {
		log.Fatalf("Failed to start pi: %v", err)
	}
	defer client.Close()

	p := tea.NewProgram(
		initialModel(client),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
