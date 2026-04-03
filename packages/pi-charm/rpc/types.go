// Package rpc provides a Go client for the Pi coding agent's RPC protocol.
//
// The protocol is JSON-Lines over stdin/stdout. Commands are sent as JSON objects
// with a "type" field, responses come back with type "response", and agent events
// stream as they occur.
package rpc

import "encoding/json"

// ---------------------------------------------------------------------------
// Commands (sent to pi stdin)
// ---------------------------------------------------------------------------

// Command is a JSON-Lines command sent to the pi RPC process.
type Command struct {
	ID   string `json:"id,omitempty"`
	Type string `json:"type"`

	// prompt / steer / follow_up
	Message           string `json:"message,omitempty"`
	StreamingBehavior string `json:"streamingBehavior,omitempty"`

	// set_model
	Provider string `json:"provider,omitempty"`
	ModelID  string `json:"modelId,omitempty"`

	// set_thinking_level
	Level string `json:"level,omitempty"`

	// compact
	CustomInstructions string `json:"customInstructions,omitempty"`

	// bash
	BashCommand string `json:"command,omitempty"`

	// set_auto_compaction / set_auto_retry
	Enabled *bool `json:"enabled,omitempty"`

	// fork
	EntryID string `json:"entryId,omitempty"`

	// switch_session
	SessionPath string `json:"sessionPath,omitempty"`

	// set_session_name
	Name string `json:"name,omitempty"`

	// new_session
	ParentSession string `json:"parentSession,omitempty"`

	// set_steering_mode / set_follow_up_mode
	Mode string `json:"mode,omitempty"`

	// export_html
	OutputPath string `json:"outputPath,omitempty"`
}

// ---------------------------------------------------------------------------
// Responses (received from pi stdout, type == "response")
// ---------------------------------------------------------------------------

// Response is a JSON-Lines response from the pi RPC process.
type Response struct {
	ID      string          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Command string          `json:"command"`
	Success bool            `json:"success"`
	Error   string          `json:"error,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// SessionState mirrors RpcSessionState from the TypeScript types.
type SessionState struct {
	Model                 *ModelInfo `json:"model,omitempty"`
	ThinkingLevel         string     `json:"thinkingLevel"`
	IsStreaming           bool       `json:"isStreaming"`
	IsCompacting          bool       `json:"isCompacting"`
	SteeringMode          string     `json:"steeringMode"`
	FollowUpMode          string     `json:"followUpMode"`
	SessionFile           string     `json:"sessionFile,omitempty"`
	SessionID             string     `json:"sessionId"`
	SessionName           string     `json:"sessionName,omitempty"`
	AutoCompactionEnabled bool       `json:"autoCompactionEnabled"`
	MessageCount          int        `json:"messageCount"`
	PendingMessageCount   int        `json:"pendingMessageCount"`
}

// ModelInfo represents an LLM model.
type ModelInfo struct {
	Provider      string `json:"provider"`
	ID            string `json:"id"`
	ContextWindow int    `json:"contextWindow,omitempty"`
	Reasoning     bool   `json:"reasoning,omitempty"`
}

// ---------------------------------------------------------------------------
// Agent Events (received from pi stdout, type != "response")
// ---------------------------------------------------------------------------

// Event is a raw agent event from the pi RPC process. The Type field
// determines which other fields are populated.
type Event struct {
	Type string `json:"type"`

	// message_start, message_update, message_end, turn_end
	Message *AgentMessage `json:"message,omitempty"`

	// message_update
	AssistantMessageEvent *AssistantMessageEvent `json:"assistantMessageEvent,omitempty"`

	// agent_end
	Messages []AgentMessage `json:"messages,omitempty"`

	// turn_end
	ToolResults []json.RawMessage `json:"toolResults,omitempty"`

	// tool_execution_start, tool_execution_update, tool_execution_end
	ToolCallID string          `json:"toolCallId,omitempty"`
	ToolName   string          `json:"toolName,omitempty"`
	Args       json.RawMessage `json:"args,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	IsError    bool            `json:"isError,omitempty"`

	// tool_execution_update
	PartialResult json.RawMessage `json:"partialResult,omitempty"`

	// compaction_start, compaction_end
	Reason string `json:"reason,omitempty"`
	// Note: compaction result also lands in Result (same JSON key, different event type)
	Aborted      bool   `json:"aborted,omitempty"`
	WillRetry    bool   `json:"willRetry,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`

	// auto_retry_start, auto_retry_end
	Attempt     int    `json:"attempt,omitempty"`
	MaxAttempts int    `json:"maxAttempts,omitempty"`
	DelayMs     int    `json:"delayMs,omitempty"`
	Success     bool   `json:"success,omitempty"`
	FinalError  string `json:"finalError,omitempty"`

	// queue_update
	Steering []string `json:"steering,omitempty"`
	FollowUp []string `json:"followUp,omitempty"`
}

// ExtensionUIRequest is emitted when an extension needs user input.
// Parsed separately from Event because "message" field conflicts.
type ExtensionUIRequest struct {
	Type        string   `json:"type"`
	ID          string   `json:"id"`
	Method      string   `json:"method"`
	Title       string   `json:"title,omitempty"`
	Options     []string `json:"options,omitempty"`
	Message     string   `json:"message,omitempty"`
	NotifyType  string   `json:"notifyType,omitempty"`
	StatusKey   string   `json:"statusKey,omitempty"`
	StatusText  string   `json:"statusText,omitempty"`
	Timeout     int      `json:"timeout,omitempty"`
	Prefill     string   `json:"prefill,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
}

// AgentMessage represents a message in the conversation.
type AgentMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

// AssistantMessageEvent carries streaming delta information.
type AssistantMessageEvent struct {
	Type  string `json:"type"`
	Delta string `json:"delta,omitempty"`
	// thinking_delta
	ThinkingDelta string `json:"thinking_delta,omitempty"`
}

// ContentBlock is one block within a message's content array.
type ContentBlock struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	Thinking string          `json:"thinking,omitempty"`
	Name     string          `json:"name,omitempty"`
	ID       string          `json:"id,omitempty"`
	Input    json.RawMessage `json:"input,omitempty"`
}

// ForkMessage represents a user message available for forking.
type ForkMessage struct {
	EntryID string `json:"entryId"`
	Text    string `json:"text"`
}

// ExtensionUIResponse is sent back to pi when an extension requests UI input.
type ExtensionUIResponse struct {
	Type      string `json:"type"` // always "extension_ui_response"
	ID        string `json:"id"`
	Value     string `json:"value,omitempty"`
	Confirmed *bool  `json:"confirmed,omitempty"`
	Cancelled *bool  `json:"cancelled,omitempty"`
}
