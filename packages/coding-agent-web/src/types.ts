import type { AgentSessionRuntimeDiagnostic } from "@earendil-works/pi-coding-agent";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type QueueMode = "all" | "one-at-a-time";
export type PromptMode = "auto" | "steer" | "followUp";
export type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

export interface CliOptions {
	cwd: string;
	host: string;
	port: number;
	token: string | undefined;
	tokenEnabled: boolean;
	continueRecent: boolean;
	sessionPath: string | undefined;
}

export interface ServerUrls {
	localUrl: string;
	lanUrls: string[];
}

export interface StartedServer {
	port: number;
	urls: ServerUrls;
	close(): Promise<void>;
}

export interface SerializedCommand {
	name: string;
	description: string;
	source: "extension" | "prompt" | "skill" | "host";
}

export interface SessionSummary {
	id: string;
	title: string;
	cwd: string;
	sessionFile: string | null;
	sessionName: string | null;
	model: string | null;
	isIdle: boolean;
	hasPendingMessages: boolean;
	messageCount: number;
}

export interface HistorySessionSummary {
	path: string;
	id: string;
	cwd: string;
	name: string | null;
	parentSessionPath: string | null;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

export interface SerializedToolCall {
	id: string;
	name: string;
	args: string;
}

export interface SerializedMessage {
	role: string;
	title: string;
	text: string;
	thinking: string;
	toolCalls: SerializedToolCall[];
	imageCount: number;
	meta: Record<string, string | number | boolean | null>;
	error?: string;
}

export interface SerializedEntry {
	id: string;
	parentId: string | null;
	timestamp: string;
	entryType: string;
	message: SerializedMessage;
}

export interface ToolActivity {
	id: string;
	name: string;
	args: string;
	result: string;
	isError: boolean;
	status: "running" | "done";
	updatedAt: number;
}

export interface ExtensionStatus {
	key: string;
	text: string;
}

export interface ExtensionWidget {
	key: string;
	placement: "aboveEditor" | "belowEditor";
	lines: string[];
}

export interface HostDialog {
	id: string;
	kind: "select" | "confirm" | "input" | "editor";
	title: string;
	message: string | null;
	placeholder: string | null;
	prefill: string | null;
	options: string[];
}

export interface ExtensionUiSnapshot {
	title: string | null;
	editorText: string | null;
	statuses: ExtensionStatus[];
	widgets: ExtensionWidget[];
	dialog: HostDialog | null;
}

export interface SerializedModelOption {
	provider: string;
	modelId: string;
	label: string;
	current: boolean;
	reasoning: boolean;
	contextWindow: number;
}

export interface SettingsSnapshot {
	currentModel: string | null;
	currentThinkingLevel: string;
	availableThinkingLevels: ThinkingLevel[];
	steeringMode: QueueMode;
	followUpMode: QueueMode;
	autoCompactionEnabled: boolean;
	models: SerializedModelOption[];
}

export interface TreeNodeSnapshot {
	id: string;
	parentId: string | null;
	depth: number;
	entryType: string;
	title: string;
	text: string;
	timestamp: string;
	label: string | null;
	isActive: boolean;
	isCurrentBranch: boolean;
}

export interface TreeSnapshot {
	leafId: string | null;
	nodes: TreeNodeSnapshot[];
}

export interface WebSessionSnapshot {
	activeSessionId: string | null;
	sessions: SessionSummary[];
	history: HistorySessionSummary[];
	cwd: string | null;
	sessionFile: string | null;
	sessionId: string | null;
	sessionName: string | null;
	model: string | null;
	contextUsage: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	} | null;
	isIdle: boolean;
	hasPendingMessages: boolean;
	pendingMessageCount: number;
	entries: SerializedEntry[];
	liveMessage: SerializedMessage | null;
	tools: ToolActivity[];
	commands: SerializedCommand[];
	extensionUi: ExtensionUiSnapshot | null;
	settings: SettingsSnapshot | null;
	tree: TreeSnapshot | null;
	diagnostics: AgentSessionRuntimeDiagnostic[];
	notice: string | null;
}

export interface SendPromptRequest {
	sessionId: string | undefined;
	message: string;
	mode: PromptMode;
}

export interface SessionRequest {
	sessionId: string | undefined;
}

export interface ResumeSessionRequest {
	path: string;
}

export interface SelectSessionRequest {
	sessionId: string;
}

export interface DialogResponseRequest {
	sessionId: string | undefined;
	requestId: string;
	value: string | undefined;
	confirmed: boolean | undefined;
	cancelled: boolean;
}

export interface SettingsUpdateRequest {
	sessionId: string | undefined;
	action: "setModel" | "setThinkingLevel" | "setSteeringMode" | "setFollowUpMode" | "setAutoCompaction";
	provider: string | undefined;
	modelId: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	mode: QueueMode | undefined;
	enabled: boolean | undefined;
}

export interface TreeNavigateRequest {
	sessionId: string | undefined;
	entryId: string;
	summarize: boolean;
	customInstructions: string | undefined;
}

export interface ForkRequest {
	sessionId: string | undefined;
	entryId: string;
	position: "before" | "at";
}

export interface LabelRequest {
	sessionId: string | undefined;
	entryId: string;
	label: string | undefined;
}
