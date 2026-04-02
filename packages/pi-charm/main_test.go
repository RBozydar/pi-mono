package main

import (
	"encoding/json"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// newTestModel creates a model without a real RPC client for unit testing.
func newTestModel() model {
	m := initialModel(nil)
	m.width = 80
	m.height = 24
	m.ready = true
	m.relayout()
	return m
}

func TestInitialState(t *testing.T) {
	m := newTestModel()

	if m.streaming {
		t.Error("should not be streaming initially")
	}
	if m.mode != modeChat {
		t.Errorf("expected modeChat, got %d", m.mode)
	}
	if len(m.chatLog) != 0 {
		t.Errorf("expected empty chatLog, got %d entries", len(m.chatLog))
	}
	if m.toast != "" {
		t.Error("expected no toast initially")
	}
}

func TestViewRendersWithoutPanic(t *testing.T) {
	m := newTestModel()
	view := m.View()

	if !strings.Contains(view, "pi-charm") {
		t.Error("view should contain logo")
	}
}

func TestViewNotReadyShowsInitializing(t *testing.T) {
	m := initialModel(nil)
	// ready is false by default
	view := m.View()
	if !strings.Contains(view, "Initializing") {
		t.Error("expected Initializing message when not ready")
	}
}

func TestHandleEventTextDelta(t *testing.T) {
	m := newTestModel()
	m.streaming = true

	raw := json.RawMessage(`{
		"type": "message_update",
		"assistantMessageEvent": {"type": "text_delta", "delta": "hello"}
	}`)
	m.handleEvent(raw)

	if m.streamBuf.String() != "hello" {
		t.Errorf("expected streamBuf 'hello', got %q", m.streamBuf.String())
	}
}

func TestHandleEventThinkingDelta(t *testing.T) {
	m := newTestModel()
	m.streaming = true

	raw := json.RawMessage(`{
		"type": "message_update",
		"assistantMessageEvent": {"type": "thinking_delta", "thinking_delta": "hmm"}
	}`)
	m.handleEvent(raw)

	if m.thinkBuf.String() != "hmm" {
		t.Errorf("expected thinkBuf 'hmm', got %q", m.thinkBuf.String())
	}
}

func TestHandleEventToolLifecycle(t *testing.T) {
	m := newTestModel()

	// tool_execution_start
	raw := json.RawMessage(`{
		"type": "tool_execution_start",
		"toolCallId": "tc_1",
		"toolName": "bash",
		"args": {"command": "ls"}
	}`)
	m.handleEvent(raw)

	if len(m.chatLog) != 1 {
		t.Fatalf("expected 1 chatLog entry, got %d", len(m.chatLog))
	}
	if m.chatLog[0].role != "tool_start" {
		t.Errorf("expected tool_start, got %s", m.chatLog[0].role)
	}
	if m.chatLog[0].toolName != "bash" {
		t.Errorf("expected toolName 'bash', got %s", m.chatLog[0].toolName)
	}
	if m.activeTools["tc_1"] != "bash" {
		t.Error("expected tc_1 in activeTools")
	}

	// tool_execution_end
	raw = json.RawMessage(`{
		"type": "tool_execution_end",
		"toolCallId": "tc_1",
		"result": "\"file1.txt\"",
		"isError": false
	}`)
	m.handleEvent(raw)

	if len(m.chatLog) != 2 {
		t.Fatalf("expected 2 chatLog entries, got %d", len(m.chatLog))
	}
	if m.chatLog[1].role != "tool_end" {
		t.Errorf("expected tool_end, got %s", m.chatLog[1].role)
	}
	if _, ok := m.activeTools["tc_1"]; ok {
		t.Error("tc_1 should be removed from activeTools")
	}
}

func TestHandleEventAgentLifecycle(t *testing.T) {
	m := newTestModel()

	// agent_start
	cmds := m.handleEvent(json.RawMessage(`{"type": "agent_start"}`))
	if !m.streaming {
		t.Error("should be streaming after agent_start")
	}
	if !m.turnActive {
		t.Error("should be turnActive after agent_start")
	}
	if len(cmds) == 0 {
		t.Error("expected stopwatch cmds from agent_start")
	}

	// Simulate some text
	m.streamBuf.WriteString("response text")

	// agent_end
	cmds = m.handleEvent(json.RawMessage(`{"type": "agent_end"}`))
	if m.streaming {
		t.Error("should not be streaming after agent_end")
	}
	if m.turnActive {
		t.Error("should not be turnActive after agent_end")
	}
	if len(cmds) == 0 {
		t.Error("expected stopwatch cmds from agent_end")
	}

	// flushStream should have added assistant entry
	if len(m.chatLog) != 1 {
		t.Fatalf("expected 1 chatLog entry after flush, got %d", len(m.chatLog))
	}
	if m.chatLog[0].role != "assistant" {
		t.Errorf("expected assistant role, got %s", m.chatLog[0].role)
	}
}

func TestFlushStreamThinkingAndText(t *testing.T) {
	m := newTestModel()
	m.thinkBuf.WriteString("thinking about it")
	m.streamBuf.WriteString("the answer")

	m.flushStream()

	if len(m.chatLog) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(m.chatLog))
	}
	if m.chatLog[0].role != "thinking" {
		t.Errorf("expected thinking, got %s", m.chatLog[0].role)
	}
	if m.chatLog[1].role != "assistant" {
		t.Errorf("expected assistant, got %s", m.chatLog[1].role)
	}
}

func TestRenderChatUserMessage(t *testing.T) {
	m := newTestModel()
	m.chatLog = append(m.chatLog, chatEntry{role: "user", content: "hello"})
	rendered := m.renderChat()

	if !strings.Contains(rendered, "You") {
		t.Error("should contain 'You' label")
	}
	if !strings.Contains(rendered, "hello") {
		t.Error("should contain user message")
	}
}

func TestRenderChatAssistantMessage(t *testing.T) {
	m := newTestModel()
	m.chatLog = append(m.chatLog, chatEntry{role: "assistant", content: "world"})
	rendered := m.renderChat()

	if !strings.Contains(rendered, "Pi") {
		t.Error("should contain 'Pi' label")
	}
	if !strings.Contains(rendered, "world") {
		t.Error("should contain assistant message")
	}
}

func TestToolIcon(t *testing.T) {
	cases := map[string]string{
		"bash":  "$",
		"read":  "r",
		"write": "w",
		"edit":  "e",
		"grep":  "/",
		"other": ">",
	}
	for name, expected := range cases {
		if got := toolIcon(name); got != expected {
			t.Errorf("toolIcon(%q) = %q, want %q", name, got, expected)
		}
	}
}

func TestSummarizeToolArgs(t *testing.T) {
	raw := json.RawMessage(`{"command": "ls -la", "timeout": 5000}`)
	result := summarizeToolArgs(raw)
	if result != "ls -la" {
		t.Errorf("expected 'ls -la', got %q", result)
	}
}

func TestSummarizeToolArgsTruncation(t *testing.T) {
	long := strings.Repeat("x", 100)
	raw := json.RawMessage(`{"command": "` + long + `"}`)
	result := summarizeToolArgs(raw)
	if len(result) > 70 {
		t.Errorf("expected truncation, got len %d", len(result))
	}
	if !strings.HasSuffix(result, "...") {
		t.Error("expected ... suffix")
	}
}

func TestSummarizeToolResultTruncation(t *testing.T) {
	long := `"` + strings.Repeat("y", 200) + `"`
	result := summarizeToolResult(json.RawMessage(long))
	if len(result) > 100 {
		t.Errorf("expected truncation, got len %d", len(result))
	}
}

func TestToastExpire(t *testing.T) {
	m := newTestModel()
	m.toast = "hello"
	m.toastLevel = "info"

	updated, _ := m.Update(toastExpireMsg{})
	m2 := updated.(model)
	if m2.toast != "" {
		t.Error("toast should be cleared after expire")
	}
}

func TestClearChat(t *testing.T) {
	m := newTestModel()
	m.chatLog = append(m.chatLog, chatEntry{role: "user", content: "test"})

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlL})
	m2 := updated.(model)
	if len(m2.chatLog) != 0 {
		t.Error("chatLog should be empty after clear")
	}
}

func TestBadgesRendering(t *testing.T) {
	m := newTestModel()
	m.modelName = "anthropic/claude-sonnet"
	m.thinkingLevel = "high"
	m.sessionName = "test"

	badges := m.renderBadges()
	if !strings.Contains(badges, "claude-sonnet") {
		t.Error("badges should contain model name")
	}
	if !strings.Contains(badges, "think:") {
		t.Error("badges should contain thinking level")
	}
	if !strings.Contains(badges, "session:") {
		t.Error("badges should contain session name")
	}
}

func TestBadgesHiddenThinkingOff(t *testing.T) {
	m := newTestModel()
	m.thinkingLevel = "off"

	badges := m.renderBadges()
	if strings.Contains(badges, "think:") {
		t.Error("badges should not show thinking when off")
	}
}
