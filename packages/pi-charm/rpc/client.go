package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
)

// Client manages a pi --mode rpc subprocess and provides typed communication.
type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser

	events   chan json.RawMessage // raw events forwarded to consumer
	pending  map[string]chan *Response
	mu       sync.Mutex
	reqID    atomic.Int64
	done     chan struct{}
	stderrBuf []byte
}

// NewClient creates a client that will spawn pi in RPC mode.
// piPath is the path to the pi binary or "node dist/cli.js" entrypoint.
// cwd is the working directory for the agent.
func NewClient(piPath string, cwd string, extraArgs ...string) (*Client, error) {
	args := append([]string{"--mode", "rpc"}, extraArgs...)
	cmd := exec.Command(piPath, args...)
	cmd.Dir = cwd

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	c := &Client{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		stderr:  stderr,
		events:  make(chan json.RawMessage, 256),
		pending: make(map[string]chan *Response),
		done:    make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi: %w", err)
	}

	go c.readStdout()
	go c.readStderr()

	return c, nil
}

// Events returns the channel that receives raw JSON event lines.
// These are agent events (not responses to commands).
func (c *Client) Events() <-chan json.RawMessage {
	return c.events
}

// Done returns a channel that closes when the pi process exits.
func (c *Client) Done() <-chan struct{} {
	return c.done
}

// Send sends a command and waits for its response.
func (c *Client) Send(cmd Command) (*Response, error) {
	id := fmt.Sprintf("req_%d", c.reqID.Add(1))
	cmd.ID = id

	ch := make(chan *Response, 1)
	c.mu.Lock()
	c.pending[id] = ch
	c.mu.Unlock()

	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("marshal command: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("write command: %w", err)
	}

	resp := <-ch
	if resp == nil {
		return nil, fmt.Errorf("connection closed")
	}
	return resp, nil
}

// SendAsync sends a command without waiting for a response (fire-and-forget with ID).
func (c *Client) SendAsync(cmd Command) error {
	id := fmt.Sprintf("req_%d", c.reqID.Add(1))
	cmd.ID = id

	// Register but don't block — response will be consumed by readStdout
	ch := make(chan *Response, 1)
	c.mu.Lock()
	c.pending[id] = ch
	c.mu.Unlock()

	// Drain in background
	go func() { <-ch }()

	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("marshal command: %w", err)
	}
	data = append(data, '\n')

	if _, err := c.stdin.Write(data); err != nil {
		return fmt.Errorf("write command: %w", err)
	}
	return nil
}

// SendUIResponse sends an extension UI response back to pi.
func (c *Client) SendUIResponse(resp ExtensionUIResponse) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = c.stdin.Write(data)
	return err
}

// Prompt sends a prompt command (async — events stream back).
func (c *Client) Prompt(message string) error {
	return c.SendAsync(Command{Type: "prompt", Message: message})
}

// Abort cancels the current operation.
func (c *Client) Abort() error {
	return c.SendAsync(Command{Type: "abort"})
}

// GetState fetches current session state.
func (c *Client) GetState() (*SessionState, error) {
	resp, err := c.Send(Command{Type: "get_state"})
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("get_state: %s", resp.Error)
	}
	var state SessionState
	if err := json.Unmarshal(resp.Data, &state); err != nil {
		return nil, fmt.Errorf("unmarshal state: %w", err)
	}
	return &state, nil
}

// CycleModel cycles to the next available model.
func (c *Client) CycleModel() (*Response, error) {
	return c.Send(Command{Type: "cycle_model"})
}

// SetThinkingLevel sets the thinking level.
func (c *Client) SetThinkingLevel(level string) error {
	return c.SendAsync(Command{Type: "set_thinking_level", Level: level})
}

// CycleThinkingLevel cycles to the next thinking level.
func (c *Client) CycleThinkingLevel() (*Response, error) {
	return c.Send(Command{Type: "cycle_thinking_level"})
}

// Steer sends a steering message to interrupt the agent mid-run.
func (c *Client) Steer(message string) error {
	return c.SendAsync(Command{Type: "steer", Message: message})
}

// NewSession starts a new session.
func (c *Client) NewSession() (*Response, error) {
	return c.Send(Command{Type: "new_session"})
}

// GetAvailableModels returns all available models.
func (c *Client) GetAvailableModels() ([]ModelInfo, error) {
	resp, err := c.Send(Command{Type: "get_available_models"})
	if err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("get_available_models: %s", resp.Error)
	}
	var data struct {
		Models []ModelInfo `json:"models"`
	}
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		return nil, fmt.Errorf("unmarshal models: %w", err)
	}
	return data.Models, nil
}

// Close terminates the pi process.
func (c *Client) Close() error {
	c.stdin.Close()
	return c.cmd.Wait()
}

// readStdout reads JSONL from pi's stdout, routing responses to pending
// requests and everything else to the events channel.
func (c *Client) readStdout() {
	defer close(c.done)
	defer close(c.events)

	scanner := bufio.NewScanner(c.stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024) // 10MB max line

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		// Peek at the type field to route
		var peek struct {
			Type    string `json:"type"`
			ID      string `json:"id,omitempty"`
			Command string `json:"command,omitempty"`
		}
		if err := json.Unmarshal(line, &peek); err != nil {
			continue
		}

		if peek.Type == "response" && peek.ID != "" {
			var resp Response
			if err := json.Unmarshal(line, &resp); err != nil {
				continue
			}
			c.mu.Lock()
			ch, ok := c.pending[peek.ID]
			if ok {
				delete(c.pending, peek.ID)
			}
			c.mu.Unlock()
			if ok {
				ch <- &resp
			}
			continue
		}

		// Everything else is an event — send raw JSON
		raw := make(json.RawMessage, len(line))
		copy(raw, line)
		select {
		case c.events <- raw:
		default:
			// Drop if consumer is too slow (avoid blocking the reader)
		}
	}

	// Close all pending requests
	c.mu.Lock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.mu.Unlock()
}

func (c *Client) readStderr() {
	buf := make([]byte, 4096)
	for {
		n, err := c.stderr.Read(buf)
		if n > 0 {
			c.stderrBuf = append(c.stderrBuf, buf[:n]...)
		}
		if err != nil {
			return
		}
	}
}
