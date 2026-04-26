/**
 * Browser web UI extension for pi-coding-agent.
 *
 * This extension starts a localhost HTTP/SSE server and owns SDK-backed
 * AgentSessionRuntime instances. The browser does not drive the terminal
 * session that loaded this extension; every visible session is a full runtime
 * session that can expand skills, prompt templates, and extension commands.
 *
 * Usage:
 *   pi --extension web-ui-extension
 *
 * Optional flags:
 *   --web-ui-host 127.0.0.1
 *   --web-ui-port 32123
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	DefaultPackageManager,
	type ExtensionAPI,
	type ExtensionCommandContextActions,
	type ExtensionContext,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	type ExtensionWidgetOptions,
	getAgentDir,
	type LoadExtensionsResult,
	type RegisteredCommand,
	type ResolvedCommand,
	type SessionEntry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 32123;
const PORT_SCAN_LIMIT = 20;
const REQUEST_BODY_LIMIT = 256 * 1024;
const SSE_KEEPALIVE_MS = 15_000;
const SNAPSHOT_THROTTLE_MS = 80;
const MAX_TOOL_ACTIVITIES = 20;
const HOST_COMMANDS: readonly SerializedCommand[] = [
	{ name: "compact", description: "Compact this session context", source: "host" },
	{ name: "reload", description: "Reload prompts, skills, extensions, and settings", source: "host" },
	{ name: "new", description: "Replace this runtime with a new session", source: "host" },
	{ name: "name", description: "Rename this session", source: "host" },
	{ name: "stop", description: "Stop the current run", source: "host" },
	{ name: "settings", description: "Open session settings", source: "host" },
	{ name: "tree", description: "Open session tree navigation", source: "host" },
];

const WEB_UI_EXTENSION_FILE = resolve(fileURLToPath(import.meta.url));
const WEB_UI_EXTENSION_DIR = dirname(WEB_UI_EXTENSION_FILE);

type NotifyType = "info" | "warning" | "error";
type PromptMode = "auto" | "steer" | "followUp";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type QueueMode = "all" | "one-at-a-time";
type TreeFilterMode = "default" | "no-tools" | "user-only" | "labeled-only" | "all";

interface WebUiConfig {
	host: string;
	port: number;
}

interface SerializedCommand {
	name: string;
	description: string;
	source: "extension" | "prompt" | "skill" | "host";
}

interface SessionSummary {
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

interface SerializedToolCall {
	id: string;
	name: string;
	args: string;
}

interface SerializedContent {
	text: string;
	thinking: string;
	toolCalls: SerializedToolCall[];
	imageCount: number;
}

interface SerializedMessage {
	role: string;
	title: string;
	text: string;
	thinking: string;
	toolCalls: SerializedToolCall[];
	imageCount: number;
	meta: Record<string, string | number | boolean | null>;
	error?: string;
}

interface SerializedEntry {
	id: string;
	parentId: string | null;
	timestamp: string;
	entryType: string;
	message: SerializedMessage;
}

interface ToolActivity {
	id: string;
	name: string;
	args: string;
	result: string;
	isError: boolean;
	status: "running" | "done";
	updatedAt: number;
}

interface ExtensionStatus {
	key: string;
	text: string;
}

interface ExtensionWidget {
	key: string;
	placement: "aboveEditor" | "belowEditor";
	lines: string[];
}

interface HostDialog {
	id: string;
	kind: "select" | "confirm" | "input" | "editor";
	title: string;
	message: string | null;
	placeholder: string | null;
	prefill: string | null;
	options: string[];
}

interface ExtensionUiSnapshot {
	title: string | null;
	editorText: string | null;
	statuses: ExtensionStatus[];
	widgets: ExtensionWidget[];
	dialog: HostDialog | null;
}

interface SerializedModelOption {
	provider: string;
	modelId: string;
	label: string;
	current: boolean;
}

interface SerializedExtensionInfo {
	path: string;
	source: string;
	commands: number;
	tools: number;
	error: string | null;
}

interface SettingsSnapshot {
	currentModel: string | null;
	currentThinkingLevel: ThinkingLevel;
	availableThinkingLevels: ThinkingLevel[];
	defaultProvider: string | null;
	defaultModel: string | null;
	defaultThinkingLevel: ThinkingLevel | null;
	steeringMode: QueueMode;
	followUpMode: QueueMode;
	autoCompactionEnabled: boolean;
	treeFilterMode: TreeFilterMode;
	models: SerializedModelOption[];
	extensions: SerializedExtensionInfo[];
}

interface TreeNodeSnapshot {
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

interface TreeSnapshot {
	leafId: string | null;
	nodes: TreeNodeSnapshot[];
}

type HostPanelSnapshot =
	| {
			kind: "settings";
			settings: SettingsSnapshot;
	  }
	| {
			kind: "tree";
			tree: TreeSnapshot;
	  };

interface WebUiSnapshot {
	activeSessionId: string | null;
	sessions: SessionSummary[];
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
	entries: SerializedEntry[];
	liveMessage: SerializedMessage | null;
	tools: ToolActivity[];
	commands: SerializedCommand[];
	extensionUi: ExtensionUiSnapshot | null;
	hostPanel: HostPanelSnapshot | null;
	notice: string | null;
	url: string | null;
}

interface SendPromptRequest {
	sessionId: string | undefined;
	message: string;
	mode: PromptMode;
}

interface SessionNameRequest {
	sessionId: string | undefined;
	name: string;
}

interface SelectSessionRequest {
	sessionId: string;
}

interface DialogResponseRequest {
	sessionId: string | undefined;
	requestId: string;
	value: string | undefined;
	confirmed: boolean | undefined;
	cancelled: boolean;
}

interface SettingsUpdateRequest {
	sessionId: string | undefined;
	action:
		| "setModel"
		| "setThinkingLevel"
		| "setSteeringMode"
		| "setFollowUpMode"
		| "setAutoCompaction"
		| "setTreeFilterMode";
	provider: string | undefined;
	modelId: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	mode: QueueMode | undefined;
	enabled: boolean | undefined;
	treeFilterMode: TreeFilterMode | undefined;
}

interface TreeNavigateRequest {
	sessionId: string | undefined;
	entryId: string;
	summarize: boolean;
	customInstructions: string | undefined;
}

interface PanelRequest {
	sessionId: string | undefined;
	kind: "settings" | "tree" | undefined;
}

type DialogResolver = (response: DialogResponseRequest) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function stringifyUnknown(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function normalizeMetaValue(value: unknown): string | number | boolean | null {
	if (value === null) return null;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
	return stringifyUnknown(value);
}

function textFromContentItems(content: unknown): SerializedContent {
	const result: SerializedContent = {
		text: "",
		thinking: "",
		toolCalls: [],
		imageCount: 0,
	};

	if (typeof content === "string") {
		result.text = content;
		return result;
	}
	if (!Array.isArray(content)) {
		result.text = stringifyUnknown(content);
		return result;
	}

	const textParts: string[] = [];
	const thinkingParts: string[] = [];
	for (const item of content) {
		if (!isRecord(item)) {
			const text = stringifyUnknown(item);
			if (text) textParts.push(text);
			continue;
		}

		const type = getString(item, "type");
		if (type === "text") {
			const text = getString(item, "text");
			if (text) textParts.push(text);
		} else if (type === "thinking") {
			const thinking = getString(item, "thinking");
			if (thinking) thinkingParts.push(thinking);
		} else if (type === "toolCall") {
			result.toolCalls.push({
				id: getString(item, "id") ?? "",
				name: getString(item, "name") ?? "tool",
				args: stringifyUnknown(item.arguments ?? {}),
			});
		} else if (type === "image") {
			result.imageCount++;
		} else {
			const text = stringifyUnknown(item);
			if (text) textParts.push(text);
		}
	}

	result.text = textParts.join("\n\n");
	result.thinking = thinkingParts.join("\n\n");
	return result;
}

function serializeAgentMessage(message: unknown): SerializedMessage {
	if (!isRecord(message)) {
		return {
			role: "unknown",
			title: "Message",
			text: stringifyUnknown(message),
			thinking: "",
			toolCalls: [],
			imageCount: 0,
			meta: {},
		};
	}

	const role = getString(message, "role") ?? "unknown";
	const content = textFromContentItems(message.content);
	const meta: Record<string, string | number | boolean | null> = {};

	if (role === "assistant") {
		for (const key of ["provider", "model", "api", "stopReason", "responseId"]) {
			if (message[key] !== undefined) meta[key] = normalizeMetaValue(message[key]);
		}
		if (isRecord(message.usage)) {
			const totalTokens = getNumber(message.usage, "totalTokens");
			if (totalTokens !== undefined) meta.totalTokens = totalTokens;
			if (isRecord(message.usage.cost)) {
				const cost = getNumber(message.usage.cost, "total");
				if (cost !== undefined) meta.cost = cost;
			}
		}
		return {
			role,
			title: "Assistant",
			text: content.text,
			thinking: content.thinking,
			toolCalls: content.toolCalls,
			imageCount: content.imageCount,
			meta,
			error: getString(message, "errorMessage"),
		};
	}

	if (role === "toolResult") {
		for (const key of ["toolCallId", "toolName", "isError"]) {
			if (message[key] !== undefined) meta[key] = normalizeMetaValue(message[key]);
		}
		return {
			role,
			title: getString(message, "toolName") ?? "Tool result",
			text: content.text,
			thinking: "",
			toolCalls: [],
			imageCount: content.imageCount,
			meta,
			error: getBoolean(message, "isError") ? "Tool returned an error" : undefined,
		};
	}

	if (role === "bashExecution") {
		const command = getString(message, "command") ?? "";
		const output = getString(message, "output") ?? "";
		if (message.exitCode !== undefined) meta.exitCode = normalizeMetaValue(message.exitCode);
		if (message.cancelled !== undefined) meta.cancelled = normalizeMetaValue(message.cancelled);
		if (message.truncated !== undefined) meta.truncated = normalizeMetaValue(message.truncated);
		return {
			role,
			title: "Shell",
			text: command ? `$ ${command}\n${output}`.trimEnd() : output,
			thinking: "",
			toolCalls: [],
			imageCount: 0,
			meta,
		};
	}

	if (role === "custom") {
		const customType = getString(message, "customType") ?? "custom";
		meta.customType = customType;
		return {
			role,
			title: customType,
			text: content.text,
			thinking: content.thinking,
			toolCalls: content.toolCalls,
			imageCount: content.imageCount,
			meta,
		};
	}

	return {
		role,
		title: role === "user" ? "You" : role,
		text: content.text,
		thinking: content.thinking,
		toolCalls: content.toolCalls,
		imageCount: content.imageCount,
		meta,
	};
}

function serializeEntry(entry: SessionEntry): SerializedEntry | null {
	const record = entry as unknown as Record<string, unknown>;
	const id = getString(record, "id") ?? "";
	const parentId = getString(record, "parentId") ?? null;
	const timestamp = getString(record, "timestamp") ?? "";
	const entryType = getString(record, "type") ?? "entry";

	if (entryType === "message") {
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: serializeAgentMessage(record.message),
		};
	}

	if (entryType === "custom_message") {
		if (record.display === false) return null;
		const customType = getString(record, "customType") ?? "custom";
		const content = textFromContentItems(record.content);
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: {
				role: "custom",
				title: customType,
				text: content.text,
				thinking: content.thinking,
				toolCalls: content.toolCalls,
				imageCount: content.imageCount,
				meta: { customType },
			},
		};
	}

	if (entryType === "compaction") {
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: {
				role: "system",
				title: "Compaction",
				text: getString(record, "summary") ?? "",
				thinking: "",
				toolCalls: [],
				imageCount: 0,
				meta: {
					tokensBefore: normalizeMetaValue(record.tokensBefore),
				},
			},
		};
	}

	if (entryType === "branch_summary") {
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: {
				role: "system",
				title: "Branch summary",
				text: getString(record, "summary") ?? "",
				thinking: "",
				toolCalls: [],
				imageCount: 0,
				meta: {
					fromId: normalizeMetaValue(record.fromId),
				},
			},
		};
	}

	if (entryType === "model_change") {
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: {
				role: "system",
				title: "Model changed",
				text: `${getString(record, "provider") ?? "provider"} / ${getString(record, "modelId") ?? "model"}`,
				thinking: "",
				toolCalls: [],
				imageCount: 0,
				meta: {},
			},
		};
	}

	if (entryType === "thinking_level_change") {
		return {
			id,
			parentId,
			timestamp,
			entryType,
			message: {
				role: "system",
				title: "Thinking level",
				text: getString(record, "thinkingLevel") ?? "",
				thinking: "",
				toolCalls: [],
				imageCount: 0,
				meta: {},
			},
		};
	}

	return null;
}

function parsePort(value: boolean | string | undefined): number {
	if (typeof value !== "string") return DEFAULT_PORT;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
}

function parseHost(value: boolean | string | undefined): string {
	return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_HOST;
}

function formatUrlHost(host: string): string {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function getLanHosts(): string[] {
	const hosts: string[] = [];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.internal) continue;
			if (String(entry.family) !== "IPv4") continue;
			hosts.push(entry.address);
		}
	}
	return [...new Set(hosts)];
}

function getDisplayUrls(host: string, port: number): string[] {
	if (host === "0.0.0.0" || host === "::") {
		const hosts = [...getLanHosts(), "127.0.0.1"];
		return [...new Set(hosts)].map((displayHost) => `http://${formatUrlHost(displayHost)}:${port}/`);
	}
	return [`http://${formatUrlHost(host)}:${port}/`];
}

function isPromptMode(value: unknown): value is PromptMode {
	return value === "auto" || value === "steer" || value === "followUp";
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

function isQueueMode(value: unknown): value is QueueMode {
	return value === "all" || value === "one-at-a-time";
}

function isTreeFilterMode(value: unknown): value is TreeFilterMode {
	return (
		value === "default" ||
		value === "no-tools" ||
		value === "user-only" ||
		value === "labeled-only" ||
		value === "all"
	);
}

function parseSendPromptRequest(value: unknown): SendPromptRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const message = getString(value, "message")?.trim();
	if (!message) throw new Error("message is required");
	const modeValue = value.mode;
	return {
		sessionId: getString(value, "sessionId"),
		message,
		mode: isPromptMode(modeValue) ? modeValue : "auto",
	};
}

function parseSessionNameRequest(value: unknown): SessionNameRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const name = getString(value, "name")?.trim();
	if (!name) throw new Error("name is required");
	return { sessionId: getString(value, "sessionId"), name };
}

function parseSelectSessionRequest(value: unknown): SelectSessionRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const sessionId = getString(value, "sessionId")?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	return { sessionId };
}

function parseDialogResponseRequest(value: unknown): DialogResponseRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const requestId = getString(value, "requestId")?.trim();
	if (!requestId) throw new Error("requestId is required");
	return {
		sessionId: getString(value, "sessionId"),
		requestId,
		value: getString(value, "value"),
		confirmed: getBoolean(value, "confirmed"),
		cancelled: getBoolean(value, "cancelled") ?? false,
	};
}

function parseSettingsUpdateRequest(value: unknown): SettingsUpdateRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const action = getString(value, "action");
	if (
		action !== "setModel" &&
		action !== "setThinkingLevel" &&
		action !== "setSteeringMode" &&
		action !== "setFollowUpMode" &&
		action !== "setAutoCompaction" &&
		action !== "setTreeFilterMode"
	) {
		throw new Error("Unsupported settings action");
	}
	const thinkingLevel = value.thinkingLevel;
	const mode = value.mode;
	const treeFilterMode = value.treeFilterMode;
	return {
		sessionId: getString(value, "sessionId"),
		action,
		provider: getString(value, "provider"),
		modelId: getString(value, "modelId"),
		thinkingLevel: isThinkingLevel(thinkingLevel) ? thinkingLevel : undefined,
		mode: isQueueMode(mode) ? mode : undefined,
		enabled: getBoolean(value, "enabled"),
		treeFilterMode: isTreeFilterMode(treeFilterMode) ? treeFilterMode : undefined,
	};
}

function parseTreeNavigateRequest(value: unknown): TreeNavigateRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const entryId = getString(value, "entryId")?.trim();
	if (!entryId) throw new Error("entryId is required");
	const customInstructions = getString(value, "customInstructions")?.trim();
	return {
		sessionId: getString(value, "sessionId"),
		entryId,
		summarize: getBoolean(value, "summarize") ?? false,
		customInstructions: customInstructions || undefined,
	};
}

function parsePanelRequest(value: unknown): PanelRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const kind = getString(value, "kind");
	return {
		sessionId: getString(value, "sessionId"),
		kind: kind === "settings" || kind === "tree" ? kind : undefined,
	};
}

function escapeHeaderValue(value: string): string {
	return value.replace(/[\r\n]/g, " ");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	let total = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request as AsyncIterable<Buffer | string>) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += buffer.byteLength;
		if (total > REQUEST_BODY_LIMIT) throw new Error("Request body is too large");
		chunks.push(buffer);
	}

	if (chunks.length === 0) return {};
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (!text) return {};
	return JSON.parse(text);
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(data));
}

function sendText(response: ServerResponse, status: number, text: string, contentType: string): void {
	response.writeHead(status, {
		"Content-Type": contentType,
		"Cache-Control": "no-store",
	});
	response.end(text);
}

function hasWebUiPostHeader(request: IncomingMessage): boolean {
	return request.headers["x-pi-web-ui"] === "1";
}

function modelLabel(model: { provider: string; id: string } | undefined): string | null {
	return model ? `${model.provider}/${model.id}` : null;
}

function contextUsageSnapshot(session: AgentSession): WebUiSnapshot["contextUsage"] {
	const contextUsage = session.getContextUsage();
	if (!contextUsage) return null;
	return {
		tokens: contextUsage.tokens,
		contextWindow: contextUsage.contextWindow,
		percent: contextUsage.percent,
	};
}

function commandNameFromText(text: string): string | null {
	if (!text.trimStart().startsWith("/")) return null;
	const trimmed = text.trimStart();
	const spaceIndex = trimmed.indexOf(" ");
	return spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
}

function normalizeCommandName(name: string): string {
	return name.startsWith("/") ? name.slice(1) : name;
}

function serializeExtensionCommand(command: ResolvedCommand | RegisteredCommand): SerializedCommand {
	const invocationName = "invocationName" in command ? command.invocationName : command.name;
	return {
		name: normalizeCommandName(invocationName),
		description: command.description ?? "",
		source: "extension",
	};
}

function serializeRuntimeCommands(session: AgentSession): SerializedCommand[] {
	const extensionCommands = session.extensionRunner.getRegisteredCommands().map(serializeExtensionCommand);
	const prompts: SerializedCommand[] = session.promptTemplates.map((template) => ({
		name: normalizeCommandName(template.name),
		description: template.description ?? "",
		source: "prompt",
	}));
	const skills: SerializedCommand[] = session.resourceLoader.getSkills().skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description ?? "",
		source: "skill",
	}));
	return [...HOST_COMMANDS, ...extensionCommands, ...prompts, ...skills];
}

function treeEntryText(entry: SessionEntry): { title: string; text: string } {
	const serialized = serializeEntry(entry);
	if (serialized) {
		return {
			title: serialized.message.title,
			text: serialized.message.text || serialized.message.thinking || serialized.entryType,
		};
	}
	return {
		title: entry.type,
		text: stringifyUnknown(entry),
	};
}

interface SessionTreeNodeLike {
	entry: SessionEntry;
	children: SessionTreeNodeLike[];
	label?: string;
}

function serializeTree(session: AgentSession): TreeSnapshot {
	const branchIds = new Set(session.sessionManager.getBranch().map((entry) => entry.id));
	const leafId = session.sessionManager.getLeafId();
	const nodes: TreeNodeSnapshot[] = [];
	const stack = [...(session.sessionManager.getTree() as SessionTreeNodeLike[])]
		.reverse()
		.map((node) => ({ node, depth: 0 }));

	while (stack.length > 0) {
		const { node, depth } = stack.pop()!;
		const { title, text } = treeEntryText(node.entry);
		nodes.push({
			id: node.entry.id,
			parentId: node.entry.parentId,
			depth,
			entryType: node.entry.type,
			title,
			text,
			timestamp: node.entry.timestamp,
			label: node.label ?? null,
			isActive: node.entry.id === leafId,
			isCurrentBranch: branchIds.has(node.entry.id),
		});

		for (const child of [...node.children].reverse()) {
			stack.push({ node: child, depth: depth + 1 });
		}
	}

	return { leafId, nodes };
}

function serializeSettings(session: AgentSession): SettingsSnapshot {
	const settingsManager = session.settingsManager;
	const currentModel = session.model;
	const models = session.modelRegistry.getAvailable().map((model) => ({
		provider: model.provider,
		modelId: model.id,
		label: `${model.provider}/${model.id}`,
		current: model.provider === currentModel?.provider && model.id === currentModel?.id,
	}));
	const extensionsResult = session.resourceLoader.getExtensions();
	const extensions: SerializedExtensionInfo[] = extensionsResult.extensions.map((extension) => ({
		path: extension.path,
		source: extension.sourceInfo.source,
		commands: extension.commands.size,
		tools: extension.tools.size,
		error: null,
	}));
	extensions.push(
		...extensionsResult.errors.map((error) => ({
			path: error.path,
			source: "error",
			commands: 0,
			tools: 0,
			error: error.error,
		})),
	);
	return {
		currentModel: modelLabel(currentModel),
		currentThinkingLevel: session.thinkingLevel as ThinkingLevel,
		availableThinkingLevels: session.getAvailableThinkingLevels() as ThinkingLevel[],
		defaultProvider: settingsManager.getDefaultProvider() ?? null,
		defaultModel: settingsManager.getDefaultModel() ?? null,
		defaultThinkingLevel: settingsManager.getDefaultThinkingLevel() ?? null,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		autoCompactionEnabled: session.autoCompactionEnabled,
		treeFilterMode: settingsManager.getTreeFilterMode(),
		models,
		extensions,
	};
}

function isSameOrNestedPath(candidate: string, parent: string): boolean {
	const resolvedCandidate = resolve(candidate);
	const resolvedParent = resolve(parent);
	return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${sep}`);
}

function isWebUiExtensionPath(path: string): boolean {
	return (
		isSameOrNestedPath(path, WEB_UI_EXTENSION_FILE) ||
		isSameOrNestedPath(path, WEB_UI_EXTENSION_DIR) ||
		isSameOrNestedPath(WEB_UI_EXTENSION_FILE, path)
	);
}

function filterSelfFromLoadedExtensions(result: LoadExtensionsResult): LoadExtensionsResult {
	result.extensions = result.extensions.filter(
		(extension) => !isWebUiExtensionPath(extension.path) && !isWebUiExtensionPath(extension.resolvedPath),
	);
	return result;
}

async function discoverEnabledExtensionsExceptSelf(
	cwd: string,
	agentDir: string,
	settingsManager: SettingsManager,
): Promise<string[]> {
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
	const resolvedPaths = await packageManager.resolve();
	return resolvedPaths.extensions
		.filter((extension) => extension.enabled && !isWebUiExtensionPath(extension.path))
		.map((extension) => extension.path);
}

async function createWebRuntime(cwd: string): Promise<AgentSessionRuntime> {
	const agentDir = getAgentDir();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager,
		sessionStartEvent,
	}) => {
		const settingsManager = SettingsManager.create(runtimeCwd, runtimeAgentDir);
		const enabledExtensions = await discoverEnabledExtensionsExceptSelf(runtimeCwd, runtimeAgentDir, settingsManager);
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			settingsManager,
			resourceLoaderOptions: {
				additionalExtensionPaths: enabledExtensions,
				extensionsOverride: filterSelfFromLoadedExtensions,
				noExtensions: true,
			},
		});
		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	return createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager: SessionManager.create(cwd),
		sessionStartEvent: { type: "session_start", reason: "new" },
	});
}

const extensionUiThemeStub = new Proxy({} as ExtensionUIContext["theme"], {
	get() {
		return (..._args: unknown[]) => "";
	},
});

class WebRuntimeSession {
	private liveMessage: SerializedMessage | null = null;
	private notice: string | null = null;
	private toolActivities = new Map<string, ToolActivity>();
	private statuses = new Map<string, string>();
	private widgets = new Map<string, ExtensionWidget>();
	private dialog: HostDialog | null = null;
	private dialogResolvers = new Map<string, DialogResolver>();
	private title: string | null = null;
	private editorText: string | null = null;
	private hostPanel: HostPanelSnapshot["kind"] | null = null;
	private unsubscribe: (() => void) | undefined;

	private constructor(
		readonly id: string,
		private readonly fallbackTitle: string,
		readonly runtime: AgentSessionRuntime,
		private readonly onChange: (immediate?: boolean) => void,
	) {}

	static async create(
		id: string,
		title: string,
		cwd: string,
		onChange: (immediate?: boolean) => void,
	): Promise<WebRuntimeSession> {
		const runtime = await createWebRuntime(cwd);
		const webSession = new WebRuntimeSession(id, title, runtime, onChange);
		runtime.setRebindSession(async () => {
			webSession.resetLiveState();
			await webSession.bindSession();
		});
		await webSession.bindSession();
		if (!runtime.session.sessionName) {
			runtime.session.setSessionName(title);
		}
		if (runtime.modelFallbackMessage) {
			webSession.setNotice(runtime.modelFallbackMessage, "warning");
		}
		const diagnostics = runtime.diagnostics.filter((diagnostic) => diagnostic.type !== "info");
		if (diagnostics.length > 0) {
			webSession.setNotice(diagnostics.map((diagnostic) => diagnostic.message).join("\n"), "warning");
		}
		return webSession;
	}

	async dispose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		for (const resolver of this.dialogResolvers.values()) {
			resolver({
				sessionId: this.id,
				requestId: "",
				value: undefined,
				confirmed: false,
				cancelled: true,
			});
		}
		this.dialogResolvers.clear();
		await this.runtime.dispose();
	}

	async sendPrompt(payload: SendPromptRequest): Promise<void> {
		const message = payload.message.trim();
		if (await this.runHostCommand(message)) {
			this.onChange();
			return;
		}

		const isExtensionCommand = this.isExtensionCommand(message);
		const streamingBehavior =
			this.session.isStreaming && !isExtensionCommand
				? payload.mode === "steer"
					? "steer"
					: "followUp"
				: undefined;

		await this.session.prompt(message, {
			source: "interactive",
			streamingBehavior,
		});
	}

	async abort(): Promise<void> {
		await this.session.abort();
		this.onChange();
	}

	async compact(customInstructions?: string): Promise<void> {
		await this.session.compact(customInstructions);
		this.onChange();
	}

	async reload(): Promise<void> {
		this.resetExtensionUi();
		await this.session.reload();
		this.onChange();
	}

	openPanel(kind: HostPanelSnapshot["kind"] | undefined): void {
		this.hostPanel = kind ?? null;
		this.onChange();
	}

	async updateSettings(payload: SettingsUpdateRequest): Promise<void> {
		if (payload.action === "setModel") {
			if (!payload.provider || !payload.modelId) throw new Error("provider and modelId are required");
			const model = this.session.modelRegistry.find(payload.provider, payload.modelId);
			if (!model) throw new Error(`Unknown model: ${payload.provider}/${payload.modelId}`);
			await this.session.setModel(model);
		} else if (payload.action === "setThinkingLevel") {
			if (!payload.thinkingLevel) throw new Error("thinkingLevel is required");
			this.session.setThinkingLevel(payload.thinkingLevel);
		} else if (payload.action === "setSteeringMode") {
			if (!payload.mode) throw new Error("mode is required");
			this.session.setSteeringMode(payload.mode);
		} else if (payload.action === "setFollowUpMode") {
			if (!payload.mode) throw new Error("mode is required");
			this.session.setFollowUpMode(payload.mode);
		} else if (payload.action === "setAutoCompaction") {
			if (payload.enabled === undefined) throw new Error("enabled is required");
			this.session.setAutoCompactionEnabled(payload.enabled);
		} else if (payload.action === "setTreeFilterMode") {
			if (!payload.treeFilterMode) throw new Error("treeFilterMode is required");
			this.session.settingsManager.setTreeFilterMode(payload.treeFilterMode);
		}
		this.hostPanel = "settings";
		this.onChange();
	}

	async navigateTree(payload: TreeNavigateRequest): Promise<void> {
		const result = await this.session.navigateTree(payload.entryId, {
			summarize: payload.summarize,
			customInstructions: payload.customInstructions,
		});
		if (result.cancelled) {
			this.setNotice("Tree navigation cancelled", "warning");
			return;
		}
		if (result.editorText) {
			this.editorText = result.editorText;
		}
		this.hostPanel = "tree";
		this.onChange();
	}

	setSessionName(name: string): void {
		this.session.setSessionName(name);
		this.onChange();
	}

	respondToDialog(response: DialogResponseRequest): void {
		const resolver = this.dialogResolvers.get(response.requestId);
		if (!resolver) return;
		this.dialogResolvers.delete(response.requestId);
		if (this.dialog?.id === response.requestId) {
			this.dialog = null;
		}
		resolver(response);
		this.onChange();
	}

	getSummary(): SessionSummary {
		return {
			id: this.id,
			title: this.title ?? this.session.sessionName ?? this.fallbackTitle,
			cwd: this.runtime.cwd,
			sessionFile: this.session.sessionFile ?? null,
			sessionName: this.session.sessionName ?? null,
			model: modelLabel(this.session.model),
			isIdle: !this.session.isStreaming,
			hasPendingMessages: this.session.pendingMessageCount > 0,
			messageCount: this.session.messages.length,
		};
	}

	getSnapshot(url: string | null, activeSessionId: string | null, sessions: SessionSummary[]): WebUiSnapshot {
		const entries = this.session.sessionManager
			.getBranch()
			.map((entry) => serializeEntry(entry))
			.filter((entry): entry is SerializedEntry => entry !== null);
		return {
			activeSessionId,
			sessions,
			cwd: this.runtime.cwd,
			sessionFile: this.session.sessionFile ?? null,
			sessionId: this.session.sessionId,
			sessionName: this.session.sessionName ?? null,
			model: modelLabel(this.session.model),
			contextUsage: contextUsageSnapshot(this.session),
			isIdle: !this.session.isStreaming,
			hasPendingMessages: this.session.pendingMessageCount > 0,
			entries,
			liveMessage: this.liveMessage,
			tools: [...this.toolActivities.values()].sort((a, b) => b.updatedAt - a.updatedAt),
			commands: serializeRuntimeCommands(this.session),
			extensionUi: this.getExtensionUiSnapshot(),
			hostPanel: this.getHostPanelSnapshot(),
			notice: this.notice,
			url,
		};
	}

	private get session(): AgentSession {
		return this.runtime.session;
	}

	private async bindSession(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		await this.session.bindExtensions({
			uiContext: this.createExtensionUiContext(),
			commandContextActions: this.createCommandContextActions(),
			onError: (error) => {
				const message = `[${error.extensionPath ?? "extension"}] ${error.event}: ${error.error}`;
				this.setNotice(message, "error");
			},
		});
		this.unsubscribe = this.session.subscribe((event) => this.handleEvent(event));
		this.onChange();
	}

	private createCommandContextActions(): ExtensionCommandContextActions {
		return {
			waitForIdle: () => this.session.agent.waitForIdle(),
			newSession: async (options) => {
				const result = await this.runtime.newSession(options);
				this.onChange();
				return result;
			},
			fork: async (entryId, options) => {
				const result = await this.runtime.fork(entryId, options);
				if (result.selectedText) {
					this.editorText = result.selectedText;
				}
				this.onChange();
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.session.navigateTree(targetId, options);
				if (result.editorText && !this.editorText) {
					this.editorText = result.editorText;
				}
				this.onChange();
				return { cancelled: result.cancelled };
			},
			switchSession: async (sessionPath, options) => {
				const result = await this.runtime.switchSession(sessionPath, options);
				this.onChange();
				return result;
			},
			reload: async () => {
				await this.reload();
			},
		};
	}

	private createExtensionUiContext(): ExtensionUIContext {
		return {
			select: (title, options, opts) =>
				this.requestDialog(
					{
						kind: "select",
						title,
						message: null,
						placeholder: null,
						prefill: null,
						options,
					},
					undefined,
					(response) => (response.cancelled ? undefined : response.value),
					opts,
				),
			confirm: (title, message, opts) =>
				this.requestDialog(
					{
						kind: "confirm",
						title,
						message,
						placeholder: null,
						prefill: null,
						options: [],
					},
					false,
					(response) => !response.cancelled && response.confirmed === true,
					opts,
				),
			input: (title, placeholder, opts) =>
				this.requestDialog(
					{
						kind: "input",
						title,
						message: null,
						placeholder: placeholder ?? null,
						prefill: null,
						options: [],
					},
					undefined,
					(response) => (response.cancelled ? undefined : response.value),
					opts,
				),
			notify: (message, type = "info") => this.setNotice(message, type),
			onTerminalInput: () => () => {},
			setStatus: (key, text) => {
				if (text === undefined) {
					this.statuses.delete(key);
				} else {
					this.statuses.set(key, text);
				}
				this.onChange();
			},
			setWorkingMessage: (message) => this.setNotice(message ?? "Working", "info"),
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: (key, content, options?: ExtensionWidgetOptions) => {
				if (Array.isArray(content)) {
					this.widgets.set(key, {
						key,
						placement: options?.placement ?? "aboveEditor",
						lines: content,
					});
				} else {
					this.widgets.delete(key);
				}
				this.onChange();
			},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => {
				this.title = title;
				this.onChange();
			},
			custom: async <T>() => undefined as T,
			pasteToEditor: (text) => {
				this.editorText = `${this.editorText ?? ""}${text}`;
				this.onChange();
			},
			setEditorText: (text) => {
				this.editorText = text;
				this.onChange();
			},
			getEditorText: () => this.editorText ?? "",
			editor: (title, prefill) =>
				this.requestDialog(
					{
						kind: "editor",
						title,
						message: null,
						placeholder: null,
						prefill: prefill ?? null,
						options: [],
					},
					undefined,
					(response) => (response.cancelled ? undefined : response.value),
				),
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			get theme() {
				return extensionUiThemeStub;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Theme switching is not supported in the web UI extension" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}

	private async requestDialog<T>(
		request: Omit<HostDialog, "id">,
		defaultValue: T,
		parse: (response: DialogResponseRequest) => T,
		opts?: ExtensionUIDialogOptions,
	): Promise<T> {
		if (opts?.signal?.aborted) {
			return defaultValue;
		}
		const id = randomUUID();
		const dialog: HostDialog = { ...request, id };
		this.dialog = dialog;
		this.onChange();

		return await new Promise<T>((resolveValue) => {
			let settled = false;
			let timeout: NodeJS.Timeout | undefined;
			const finish = (response: DialogResponseRequest) => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				this.dialogResolvers.delete(id);
				if (this.dialog?.id === id) {
					this.dialog = null;
				}
				resolveValue(parse(response));
				this.onChange();
			};
			this.dialogResolvers.set(id, finish);
			if (opts?.timeout !== undefined) {
				timeout = setTimeout(() => {
					finish({
						sessionId: this.id,
						requestId: id,
						value: undefined,
						confirmed: false,
						cancelled: true,
					});
				}, opts.timeout);
			}
			opts?.signal?.addEventListener(
				"abort",
				() => {
					finish({
						sessionId: this.id,
						requestId: id,
						value: undefined,
						confirmed: false,
						cancelled: true,
					});
				},
				{ once: true },
			);
		});
	}

	private async runHostCommand(message: string): Promise<boolean> {
		const commandName = commandNameFromText(message);
		if (!commandName) return false;
		const args = message.slice(commandName.length + 1).trim();

		if (commandName === "compact") {
			await this.compact(args || undefined);
			return true;
		}
		if (commandName === "reload") {
			await this.reload();
			return true;
		}
		if (commandName === "new") {
			await this.runtime.newSession();
			return true;
		}
		if (commandName === "name") {
			if (!args) throw new Error("/name requires a title");
			this.setSessionName(args);
			return true;
		}
		if (commandName === "stop") {
			await this.abort();
			return true;
		}
		if (commandName === "settings") {
			this.openPanel("settings");
			return true;
		}
		if (commandName === "tree") {
			this.openPanel("tree");
			return true;
		}

		return false;
	}

	private isExtensionCommand(message: string): boolean {
		const commandName = commandNameFromText(message);
		return commandName !== null && Boolean(this.session.extensionRunner.getCommand(commandName));
	}

	private handleEvent(event: AgentSessionEvent): void {
		let immediate = false;
		switch (event.type) {
			case "agent_start":
				this.notice = "Agent is running";
				immediate = true;
				break;
			case "agent_end":
				this.liveMessage = null;
				this.notice = "Agent is idle";
				immediate = true;
				break;
			case "message_start":
				if (event.message.role === "assistant") {
					this.liveMessage = serializeAgentMessage(event.message);
					immediate = true;
				}
				break;
			case "message_update":
				this.liveMessage = serializeAgentMessage(event.message);
				immediate = true;
				break;
			case "message_end":
				this.liveMessage = null;
				break;
			case "tool_execution_start":
				this.setToolStarted(event.toolCallId, event.toolName, event.args);
				break;
			case "tool_execution_update":
				this.setToolUpdated(event.toolCallId, event.partialResult);
				break;
			case "tool_execution_end":
				this.setToolEnded(event.toolCallId, event.result, event.isError);
				break;
		}
		this.onChange(immediate);
	}

	private setNotice(message: string, type: NotifyType = "info"): void {
		this.notice = type === "info" ? message : `${type}: ${message}`;
		this.onChange();
	}

	private setToolStarted(id: string, name: string, args: unknown): void {
		this.toolActivities.set(id, {
			id,
			name,
			args: stringifyUnknown(args),
			result: "",
			isError: false,
			status: "running",
			updatedAt: Date.now(),
		});
		this.pruneToolActivities();
	}

	private setToolUpdated(id: string, partialResult: unknown): void {
		const activity = this.toolActivities.get(id);
		if (!activity) return;
		activity.result = stringifyUnknown(partialResult);
		activity.updatedAt = Date.now();
	}

	private setToolEnded(id: string, result: unknown, isError: boolean): void {
		const activity = this.toolActivities.get(id);
		if (!activity) return;
		activity.result = stringifyUnknown(result);
		activity.isError = isError;
		activity.status = "done";
		activity.updatedAt = Date.now();
		this.pruneToolActivities();
	}

	private pruneToolActivities(): void {
		const activities = [...this.toolActivities.values()].sort((a, b) => b.updatedAt - a.updatedAt);
		for (const stale of activities.slice(MAX_TOOL_ACTIVITIES)) {
			this.toolActivities.delete(stale.id);
		}
	}

	private resetLiveState(): void {
		this.liveMessage = null;
		this.toolActivities.clear();
		this.resetExtensionUi();
	}

	private resetExtensionUi(): void {
		this.statuses.clear();
		this.widgets.clear();
		this.dialog = null;
		this.dialogResolvers.clear();
		this.title = null;
		this.editorText = null;
	}

	private getExtensionUiSnapshot(): ExtensionUiSnapshot {
		return {
			title: this.title,
			editorText: this.editorText,
			statuses: [...this.statuses.entries()].map(([key, text]) => ({ key, text })),
			widgets: [...this.widgets.values()],
			dialog: this.dialog,
		};
	}

	private getHostPanelSnapshot(): HostPanelSnapshot | null {
		if (this.hostPanel === "settings") {
			return {
				kind: "settings",
				settings: serializeSettings(this.session),
			};
		}
		if (this.hostPanel === "tree") {
			return {
				kind: "tree",
				tree: serializeTree(this.session),
			};
		}
		return null;
	}
}

class WebUiServer {
	private server: Server | null = null;
	private clients = new Set<ServerResponse>();
	private keepAliveTimer: NodeJS.Timeout | null = null;
	private snapshotTimer: NodeJS.Timeout | null = null;
	private url: string | null = null;
	private urls: string[] = [];
	private sessions = new Map<string, WebRuntimeSession>();
	private activeSessionId: string | null = null;
	private nextSessionNumber = 1;
	private baseCwd: string;
	private startupPromise: Promise<WebRuntimeSession> | null = null;
	private notice: string | null = null;

	constructor(config: WebUiConfig, initialCwd: string) {
		this.config = config;
		this.baseCwd = initialCwd;
	}

	private readonly config: WebUiConfig;

	async start(): Promise<string> {
		let lastError: Error | null = null;
		for (let offset = 0; offset < PORT_SCAN_LIMIT; offset++) {
			const port = this.config.port + offset;
			try {
				const server = await this.listen(port);
				this.server = server;
				const address = server.address() as AddressInfo | null;
				const actualPort = address?.port ?? port;
				this.urls = getDisplayUrls(this.config.host, actualPort);
				this.url = this.urls[0] ?? `http://${formatUrlHost(this.config.host)}:${actualPort}/`;
				this.keepAliveTimer = setInterval(() => this.keepAlive(), SSE_KEEPALIVE_MS);
				return this.url;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (!this.isAddressInUse(lastError)) break;
			}
		}
		throw lastError ?? new Error("Failed to start web UI server");
	}

	async stop(): Promise<void> {
		if (this.snapshotTimer) {
			clearTimeout(this.snapshotTimer);
			this.snapshotTimer = null;
		}
		if (this.keepAliveTimer) {
			clearInterval(this.keepAliveTimer);
			this.keepAliveTimer = null;
		}
		for (const client of this.clients) {
			client.end();
		}
		this.clients.clear();
		await Promise.all([...this.sessions.values()].map((session) => session.dispose()));
		this.sessions.clear();

		const server = this.server;
		this.server = null;
		this.url = null;
		this.urls = [];
		if (!server) return;
		await new Promise<void>((resolveClose) => {
			server.close(() => resolveClose());
		});
	}

	getUrl(): string | null {
		return this.url;
	}

	getUrls(): readonly string[] {
		return this.urls;
	}

	async setWorkspace(ctx: ExtensionContext): Promise<void> {
		this.baseCwd = ctx.cwd;
		await this.ensureActiveSession();
		this.scheduleSnapshot();
	}

	private async ensureActiveSession(): Promise<WebRuntimeSession> {
		if (this.activeSessionId) {
			const active = this.sessions.get(this.activeSessionId);
			if (active) return active;
		}
		const first = this.sessions.values().next().value;
		if (first) {
			this.activeSessionId = first.id;
			return first;
		}
		if (!this.startupPromise) {
			this.startupPromise = this.createRuntimeSession("Session 1").finally(() => {
				this.startupPromise = null;
			});
		}
		return this.startupPromise;
	}

	private async listen(port: number): Promise<Server> {
		const server = createServer((request, response) => {
			this.handleRequest(request, response).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (!response.headersSent) {
					sendJson(response, 500, { error: message });
				} else {
					response.end();
				}
			});
		});

		return await new Promise<Server>((resolveListen, reject) => {
			const onError = (error: Error) => {
				server.off("listening", onListening);
				reject(error);
			};
			const onListening = () => {
				server.off("error", onError);
				resolveListen(server);
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, this.config.host);
		});
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
		const method = request.method ?? "GET";

		if (method === "GET" && url.pathname === "/") {
			sendText(response, 200, INDEX_HTML, "text/html; charset=utf-8");
			return;
		}
		if (method === "GET" && url.pathname === "/events") {
			await this.ensureActiveSession();
			this.handleEvents(response);
			return;
		}
		if (method === "GET" && url.pathname === "/api/state") {
			await this.ensureActiveSession();
			sendJson(response, 200, this.createSnapshot());
			return;
		}
		if (method === "GET" && url.pathname === "/favicon.ico") {
			response.writeHead(204);
			response.end();
			return;
		}
		if (method === "POST" && url.pathname.startsWith("/api/")) {
			if (!hasWebUiPostHeader(request)) {
				sendJson(response, 403, { error: "Missing x-pi-web-ui header" });
				return;
			}
			await this.handleApiPost(url.pathname, request, response);
			return;
		}

		sendJson(response, 404, { error: "Not found" });
	}

	private handleEvents(response: ServerResponse): void {
		response.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		response.write("retry: 1000\n\n");
		this.clients.add(response);
		this.writeEvent(response, "snapshot", this.createSnapshot());
		response.on("close", () => {
			this.clients.delete(response);
		});
	}

	private async handleApiPost(pathname: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (pathname === "/api/send") {
				const payload = parseSendPromptRequest(await readJsonBody(request));
				await this.sendPrompt(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/sessions") {
				const session = await this.createRuntimeSession(`Session ${this.nextSessionNumber}`);
				this.activeSessionId = session.id;
				this.scheduleSnapshot();
				sendJson(response, 200, { ok: true, sessionId: session.id });
				return;
			}
			if (pathname === "/api/select-session") {
				const payload = parseSelectSessionRequest(await readJsonBody(request));
				this.selectSession(payload.sessionId);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/abort") {
				await this.abortActiveSession();
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/compact") {
				await this.compactActiveSession();
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/session-name") {
				const payload = parseSessionNameRequest(await readJsonBody(request));
				await this.setSessionName(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/dialog-response") {
				const payload = parseDialogResponseRequest(await readJsonBody(request));
				await this.respondToDialog(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/settings") {
				const payload = parseSettingsUpdateRequest(await readJsonBody(request));
				await this.updateSettings(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/tree-navigate") {
				const payload = parseTreeNavigateRequest(await readJsonBody(request));
				await this.navigateTree(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			if (pathname === "/api/panel") {
				const payload = parsePanelRequest(await readJsonBody(request));
				await this.setPanel(payload);
				sendJson(response, 200, { ok: true });
				return;
			}
			sendJson(response, 404, { error: "Unknown API endpoint" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.notice = message;
			this.scheduleSnapshot();
			sendJson(response, 400, { error: message });
		}
	}

	private async sendPrompt(payload: SendPromptRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		await session.sendPrompt(payload);
		this.scheduleSnapshot();
	}

	private async createRuntimeSession(title: string): Promise<WebRuntimeSession> {
		const id = `session-${randomUUID().slice(0, 8)}`;
		const session = await WebRuntimeSession.create(id, title, this.baseCwd, (immediate) =>
			this.scheduleSnapshot(immediate),
		);
		this.sessions.set(id, session);
		this.activeSessionId = id;
		this.nextSessionNumber++;
		return session;
	}

	private selectSession(sessionId: string): void {
		if (!this.sessions.has(sessionId)) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		this.activeSessionId = sessionId;
		this.scheduleSnapshot();
	}

	private async abortActiveSession(): Promise<void> {
		const session = await this.ensureActiveSession();
		await session.abort();
		this.scheduleSnapshot();
	}

	private async compactActiveSession(): Promise<void> {
		const session = await this.ensureActiveSession();
		await session.compact();
		this.scheduleSnapshot();
	}

	private async setSessionName(payload: SessionNameRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		session.setSessionName(payload.name);
		this.scheduleSnapshot();
	}

	private async respondToDialog(payload: DialogResponseRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		session.respondToDialog(payload);
		this.scheduleSnapshot();
	}

	private async updateSettings(payload: SettingsUpdateRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		await session.updateSettings(payload);
		this.scheduleSnapshot();
	}

	private async navigateTree(payload: TreeNavigateRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		await session.navigateTree(payload);
		this.scheduleSnapshot();
	}

	private async setPanel(payload: PanelRequest): Promise<void> {
		const session = await this.getSession(payload.sessionId);
		session.openPanel(payload.kind);
		this.scheduleSnapshot();
	}

	private async getSession(sessionId: string | undefined): Promise<WebRuntimeSession> {
		if (!sessionId) return this.ensureActiveSession();
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown session: ${sessionId}`);
		return session;
	}

	private getSessionSummaries(): SessionSummary[] {
		return [...this.sessions.values()].map((session) => session.getSummary());
	}

	private createSnapshot(): WebUiSnapshot {
		const sessions = this.getSessionSummaries();
		if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
			this.activeSessionId = sessions[0]?.id ?? null;
		}
		const active = this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
		if (active) {
			return active.getSnapshot(this.url, this.activeSessionId, sessions);
		}

		return {
			activeSessionId: null,
			sessions,
			cwd: this.baseCwd,
			sessionFile: null,
			sessionId: null,
			sessionName: null,
			model: null,
			contextUsage: null,
			isIdle: true,
			hasPendingMessages: false,
			entries: [],
			liveMessage: null,
			tools: [],
			commands: [...HOST_COMMANDS],
			extensionUi: null,
			hostPanel: null,
			notice: this.notice,
			url: this.url,
		};
	}

	private scheduleSnapshot(immediate = false): void {
		if (immediate) {
			if (this.snapshotTimer) {
				clearTimeout(this.snapshotTimer);
				this.snapshotTimer = null;
			}
			this.broadcastSnapshot();
			return;
		}
		if (this.snapshotTimer) return;
		this.snapshotTimer = setTimeout(() => {
			this.snapshotTimer = null;
			this.broadcastSnapshot();
		}, SNAPSHOT_THROTTLE_MS);
	}

	private broadcastSnapshot(): void {
		const snapshot = this.createSnapshot();
		for (const client of this.clients) {
			this.writeEvent(client, "snapshot", snapshot);
		}
	}

	private keepAlive(): void {
		for (const client of this.clients) {
			client.write(": keepalive\n\n");
		}
	}

	private writeEvent(response: ServerResponse, event: string, data: unknown): void {
		response.write(`event: ${escapeHeaderValue(event)}\n`);
		response.write(`data: ${JSON.stringify(data)}\n\n`);
	}

	private isAddressInUse(error: Error): boolean {
		return isRecord(error) && error.code === "EADDRINUSE";
	}
}

export default async function webUiExtension(pi: ExtensionAPI): Promise<void> {
	pi.registerFlag("web-ui-host", {
		description: "Host for the web UI extension server",
		type: "string",
		default: DEFAULT_HOST,
	});
	pi.registerFlag("web-ui-port", {
		description: "Port for the web UI extension server",
		type: "string",
		default: String(DEFAULT_PORT),
	});

	let server: WebUiServer | null = null;
	let startPromise: Promise<WebUiServer> | null = null;

	const ensureServer = async (): Promise<WebUiServer> => {
		if (server) return server;
		if (!startPromise) {
			const nextServer = new WebUiServer(
				{
					host: parseHost(pi.getFlag("web-ui-host")),
					port: parsePort(pi.getFlag("web-ui-port")),
				},
				process.cwd(),
			);
			startPromise = nextServer
				.start()
				.then(() => {
					server = nextServer;
					return nextServer;
				})
				.finally(() => {
					startPromise = null;
				});
		}
		return startPromise;
	};

	const formatServerUrls = (webServer: WebUiServer): string => webServer.getUrls().join(", ");

	pi.registerCommand("web-ui", {
		description: "Show the browser web UI URL",
		handler: async (_args, ctx) => {
			const webServer = await ensureServer();
			await webServer.setWorkspace(ctx);
			ctx.ui.notify(`Web UI: ${formatServerUrls(webServer) || "not running"}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const webServer = await ensureServer();
		await webServer.setWorkspace(ctx);
		ctx.ui.setStatus("web-ui", `Web UI ${formatServerUrls(webServer)}`);
	});

	pi.on("session_shutdown", async () => {
		const webServer = server ?? (startPromise ? await startPromise.catch(() => null) : null);
		server = null;
		startPromise = null;
		if (webServer) {
			await webServer.stop();
		}
	});
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>pi coding agent</title>
	<style>
		:root {
			color-scheme: dark;
			--bg: #111316;
			--panel: #171a1f;
			--panel-2: #1f2329;
			--panel-3: #242b31;
			--surface: #14171b;
			--input: #101215;
			--active: #20352f;
			--border: #353b45;
			--divider: rgba(53, 59, 69, 0.72);
			--text: #eceff3;
			--muted: #a6afbc;
			--soft: #737d8b;
			--accent: #5db8a8;
			--accent-contrast: #071311;
			--warn: #e0b15a;
			--error: #ef6f70;
			--error-soft: #ffdcdc;
			--user: #d9efe7;
			--assistant: #edf0f4;
			--tool: #d7d3f1;
			--system: #d7dde5;
			--backdrop-strong: rgba(4, 6, 8, 0.72);
			--backdrop: rgba(4, 6, 8, 0.5);
			--panel-shadow: rgba(0, 0, 0, 0.35);
			--dialog-shadow: rgba(0, 0, 0, 0.45);
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}

		body[data-theme="light"] {
			color-scheme: light;
			--bg: #f6f7f9;
			--panel: #ffffff;
			--panel-2: #edf0f3;
			--panel-3: #e5e9ed;
			--surface: #ffffff;
			--input: #ffffff;
			--active: #dcefe9;
			--border: #c9d1da;
			--divider: rgba(201, 209, 218, 0.8);
			--text: #17202a;
			--muted: #52606e;
			--soft: #73808c;
			--accent: #1f8a78;
			--accent-contrast: #ffffff;
			--warn: #8b6417;
			--error: #b4232a;
			--error-soft: #7c1d22;
			--user: #0f6b59;
			--assistant: #1f2933;
			--tool: #4d3d8f;
			--system: #394452;
			--backdrop-strong: rgba(22, 30, 38, 0.36);
			--backdrop: rgba(22, 30, 38, 0.24);
			--panel-shadow: rgba(22, 30, 38, 0.18);
			--dialog-shadow: rgba(22, 30, 38, 0.24);
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			min-height: 100vh;
			background: var(--bg);
			color: var(--text);
			font-size: 14px;
			line-height: 1.45;
			letter-spacing: 0;
		}

		button, textarea, input {
			font: inherit;
		}

		button {
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--panel-2);
			color: var(--text);
			min-height: 34px;
			padding: 0 12px;
			cursor: pointer;
		}

		button:hover {
			border-color: var(--accent);
		}

		button.primary {
			background: var(--accent);
			border-color: var(--accent);
			color: var(--accent-contrast);
			font-weight: 650;
		}

		button.danger:hover {
			border-color: var(--error);
			color: var(--error-soft);
		}

		button:disabled {
			opacity: 0.48;
			cursor: default;
		}

		.app {
			display: grid;
			grid-template-columns: minmax(250px, 310px) minmax(0, 1fr);
			height: 100vh;
			overflow: hidden;
		}

		.sidebar {
			border-right: 1px solid var(--border);
			background: var(--panel);
			display: flex;
			flex-direction: column;
			min-width: 0;
		}

		.brand {
			padding: 14px 16px;
			border-bottom: 1px solid var(--border);
		}

		.brand h1 {
			margin: 0;
			font-size: 16px;
			font-weight: 700;
		}

		.brand .sub {
			color: var(--muted);
			font-size: 12px;
			margin-top: 3px;
		}

		.sub {
			color: var(--muted);
			font-size: 12px;
		}

		.side-scroll {
			overflow: auto;
		}

		.side-section {
			padding: 14px 16px;
			border-bottom: 1px solid var(--border);
			min-width: 0;
		}

		.side-section h2 {
			margin: 0 0 8px;
			font-size: 12px;
			color: var(--muted);
			font-weight: 650;
			text-transform: uppercase;
		}

		.kv {
			display: grid;
			grid-template-columns: 78px minmax(0, 1fr);
			gap: 6px 10px;
			font-size: 12px;
		}

		.kv .k {
			color: var(--soft);
		}

		.kv .v {
			color: var(--text);
			overflow-wrap: anywhere;
		}

		.tools,
		.extension-boxes {
			display: flex;
			flex-direction: column;
			gap: 8px;
			overflow: auto;
		}

		.sessions,
		.commands {
			display: flex;
			flex-direction: column;
			gap: 7px;
			margin-bottom: 8px;
		}

		.session-button,
		.command-button {
			width: 100%;
			text-align: left;
			min-height: 32px;
			overflow-wrap: anywhere;
		}

		.session-button.active {
			border-color: var(--accent);
			background: var(--active);
		}

		.command-button {
			color: var(--muted);
		}

		.box,
		.tool {
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 8px;
			background: var(--surface);
		}

		.box strong,
		.tool strong {
			display: block;
			font-size: 12px;
		}

		.box pre,
		.tool pre {
			margin: 6px 0 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			color: var(--muted);
			font-size: 12px;
		}

		.main {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			min-width: 0;
			height: 100vh;
		}

		.topbar {
			border-bottom: 1px solid var(--border);
			padding: 10px 14px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			background: var(--surface);
		}

		.status {
			display: flex;
			align-items: center;
			gap: 8px;
			min-width: 0;
		}

		.dot {
			width: 9px;
			height: 9px;
			border-radius: 50%;
			background: var(--accent);
			flex: 0 0 auto;
		}

		.dot.running {
			background: var(--warn);
		}

		.status-text {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			color: var(--muted);
		}

		.actions {
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
			justify-content: flex-end;
		}

		.transcript {
			overflow: auto;
			padding: 14px 16px 22px;
		}

		.empty {
			color: var(--muted);
			max-width: 680px;
			margin: 24px auto;
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 16px;
			background: var(--panel);
		}

		.message {
			display: grid;
			grid-template-columns: 96px minmax(0, 1fr);
			gap: 12px;
			padding: 13px 0;
			border-bottom: 1px solid var(--divider);
		}

		.message:last-child {
			border-bottom: 0;
		}

		.message .role {
			color: var(--muted);
			font-size: 12px;
			font-weight: 650;
			overflow-wrap: anywhere;
		}

		.message.user .role {
			color: var(--user);
		}

		.message.assistant .role {
			color: var(--assistant);
		}

		.message.toolResult .role,
		.message.bashExecution .role {
			color: var(--tool);
		}

		.message.system .role {
			color: var(--system);
		}

		.message .time {
			display: block;
			color: var(--soft);
			font-weight: 400;
			margin-top: 2px;
		}

		.content {
			min-width: 0;
		}

		.content pre {
			margin: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
			font-size: 13px;
		}

		.meta {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 8px;
		}

		.pill {
			border: 1px solid var(--border);
			border-radius: 999px;
			color: var(--muted);
			padding: 2px 7px;
			font-size: 12px;
			max-width: 100%;
			overflow-wrap: anywhere;
		}

		details {
			margin-top: 9px;
		}

		summary {
			color: var(--muted);
			cursor: pointer;
			font-size: 12px;
		}

		.composer {
			border-top: 1px solid var(--border);
			background: var(--panel);
			padding: 12px 14px;
		}

		.composer-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px;
			align-items: end;
		}

		textarea,
		input {
			width: 100%;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--input);
			color: var(--text);
			padding: 10px;
			outline: none;
		}

		textarea {
			min-height: 72px;
			max-height: 180px;
			resize: vertical;
		}

		textarea:focus,
		input:focus {
			border-color: var(--accent);
		}

		.send-actions {
			display: flex;
			flex-direction: column;
			gap: 8px;
			min-width: 112px;
		}

		.error-text {
			color: var(--error);
			margin-top: 8px;
		}

		.dialog-backdrop {
			position: fixed;
			inset: 0;
			background: var(--backdrop-strong);
			display: none;
			align-items: center;
			justify-content: center;
			padding: 18px;
			z-index: 20;
		}

		.dialog-backdrop.open {
			display: flex;
		}

		.host-panel-backdrop {
			position: fixed;
			inset: 0;
			background: var(--backdrop);
			display: none;
			align-items: stretch;
			justify-content: flex-end;
			z-index: 15;
		}

		.host-panel-backdrop.open {
			display: flex;
		}

		.host-panel {
			width: min(760px, 100%);
			background: var(--panel);
			border-left: 1px solid var(--border);
			padding: 16px;
			overflow: auto;
			box-shadow: -18px 0 60px var(--panel-shadow);
		}

		.host-panel h2 {
			margin: 0;
			font-size: 17px;
		}

		.host-panel__header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
			margin-bottom: 14px;
		}

		.settings-grid {
			display: grid;
			grid-template-columns: 160px minmax(0, 1fr);
			gap: 12px;
			align-items: center;
		}

		.settings-grid label {
			color: var(--muted);
			font-size: 12px;
			font-weight: 650;
		}

		select {
			width: 100%;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--input);
			color: var(--text);
			padding: 9px 10px;
		}

		.tree-controls {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			gap: 10px;
			align-items: center;
			margin-bottom: 12px;
		}

		.tree-list {
			display: grid;
			gap: 6px;
		}

		.tree-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px;
			align-items: center;
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--surface);
			padding: 8px;
		}

		.tree-row.active {
			border-color: var(--accent);
			background: var(--active);
		}

		.tree-row.dim {
			opacity: 0.78;
		}

		.tree-title {
			font-size: 12px;
			color: var(--muted);
			font-weight: 650;
		}

		.tree-text {
			margin-top: 3px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.dialog {
			width: min(620px, 100%);
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--panel);
			box-shadow: 0 24px 80px var(--dialog-shadow);
			padding: 16px;
		}

		.dialog h2 {
			margin: 0 0 10px;
			font-size: 16px;
		}

		.dialog p {
			margin: 0 0 12px;
			color: var(--muted);
		}

		.dialog-options {
			display: grid;
			gap: 8px;
			margin: 12px 0;
		}

		.dialog-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			margin-top: 12px;
		}

		@media (max-width: 820px) {
			.app {
				grid-template-columns: 1fr;
				grid-template-rows: auto minmax(0, 1fr);
			}

			.sidebar {
				border-right: 0;
				border-bottom: 1px solid var(--border);
				max-height: 250px;
			}

			.side-scroll {
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				overflow: auto;
			}

			.main {
				height: calc(100vh - 250px);
			}

			.message {
				grid-template-columns: 1fr;
				gap: 6px;
			}
		}

		@media (max-width: 560px) {
			.topbar,
			.composer-row {
				display: block;
			}

			.actions,
			.send-actions {
				margin-top: 8px;
				flex-direction: row;
			}

			.side-scroll {
				grid-template-columns: 1fr;
			}
		}
	</style>
</head>
<body>
	<div class="app">
		<aside class="sidebar">
			<div class="brand">
				<h1>pi coding agent</h1>
				<div class="sub">browser runtime UI</div>
			</div>
			<div class="side-scroll">
				<section class="side-section">
					<h2>Sessions</h2>
					<div class="sessions" id="sessions"></div>
					<button id="new-session" type="button">New session</button>
				</section>
				<section class="side-section">
					<h2>Session</h2>
					<div class="kv" id="session"></div>
				</section>
				<section class="side-section">
					<h2>Commands</h2>
					<div class="commands" id="commands"></div>
				</section>
				<section class="side-section">
					<h2>Extension UI</h2>
					<div class="extension-boxes" id="extension-ui"></div>
				</section>
				<section class="side-section">
					<h2>Activity</h2>
					<div class="tools" id="tools"></div>
				</section>
			</div>
		</aside>
		<main class="main">
			<header class="topbar">
				<div class="status">
					<span class="dot" id="dot"></span>
					<span class="status-text" id="status">Connecting</span>
				</div>
				<div class="actions">
					<button id="theme-toggle" type="button">Theme</button>
					<button id="settings" type="button">Settings</button>
					<button id="tree" type="button">Tree</button>
					<button id="compact" type="button">Compact</button>
					<button id="abort" class="danger" type="button">Stop</button>
				</div>
			</header>
			<section class="transcript" id="transcript"></section>
			<footer class="composer">
				<form class="composer-row" id="form">
					<textarea id="prompt" placeholder="Message the coding agent"></textarea>
					<div class="send-actions">
						<button class="primary" type="submit" id="send">Send</button>
						<button type="button" id="steer">Steer</button>
					</div>
				</form>
				<div class="error-text" id="error"></div>
			</footer>
		</main>
	</div>
	<div class="host-panel-backdrop" id="host-panel-backdrop">
		<div class="host-panel" id="host-panel"></div>
	</div>
	<div class="dialog-backdrop" id="dialog-backdrop">
		<div class="dialog" id="dialog"></div>
	</div>
	<script>
		const state = {
			snapshot: null,
			connected: false,
			error: '',
			lastEditorText: null,
			userEdited: false,
			theme: localStorage.getItem('pi-web-ui-theme') ||
				(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
		};

		const els = {
			sessions: document.getElementById('sessions'),
			session: document.getElementById('session'),
			commands: document.getElementById('commands'),
			extensionUi: document.getElementById('extension-ui'),
			tools: document.getElementById('tools'),
			transcript: document.getElementById('transcript'),
			status: document.getElementById('status'),
			dot: document.getElementById('dot'),
			form: document.getElementById('form'),
			prompt: document.getElementById('prompt'),
			send: document.getElementById('send'),
			steer: document.getElementById('steer'),
			themeToggle: document.getElementById('theme-toggle'),
			abort: document.getElementById('abort'),
			compact: document.getElementById('compact'),
			settings: document.getElementById('settings'),
			tree: document.getElementById('tree'),
			newSession: document.getElementById('new-session'),
			error: document.getElementById('error'),
			hostPanelBackdrop: document.getElementById('host-panel-backdrop'),
			hostPanel: document.getElementById('host-panel'),
			dialogBackdrop: document.getElementById('dialog-backdrop'),
			dialog: document.getElementById('dialog')
		};

		function escapeHtml(value) {
			return String(value ?? '')
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#39;');
		}

		function applyTheme() {
			document.body.dataset.theme = state.theme;
			els.themeToggle.textContent = state.theme === 'light' ? 'Dark' : 'Light';
			els.themeToggle.title = state.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
		}

		function formatTime(timestamp) {
			if (!timestamp) return '';
			const date = new Date(timestamp);
			if (Number.isNaN(date.getTime())) return '';
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}

		function kv(label, value) {
			return '<div class="k">' + escapeHtml(label) + '</div><div class="v">' + escapeHtml(value || '-') + '</div>';
		}

		function renderMeta(meta) {
			const entries = Object.entries(meta || {}).filter(([, value]) => value !== null && value !== '');
			if (entries.length === 0) return '';
			return '<div class="meta">' + entries.map(([key, value]) =>
				'<span class="pill">' + escapeHtml(key) + ': ' + escapeHtml(value) + '</span>'
			).join('') + '</div>';
		}

		function renderToolCalls(toolCalls) {
			if (!toolCalls || toolCalls.length === 0) return '';
			return toolCalls.map((tool) =>
				'<details open><summary>' + escapeHtml(tool.name || 'tool') + '</summary><pre>' +
				escapeHtml(tool.args || '') + '</pre></details>'
			).join('');
		}

		function renderMessage(entry, isLive) {
			const message = entry.message;
			const roleClass = escapeHtml(message.role || 'unknown');
			const text = message.text || (message.imageCount ? '[' + message.imageCount + ' image attachment(s)]' : '');
			const thinking = message.thinking
				? '<details><summary>thinking</summary><pre>' + escapeHtml(message.thinking) + '</pre></details>'
				: '';
			const error = message.error ? '<div class="error-text">' + escapeHtml(message.error) + '</div>' : '';
			const live = isLive ? '<span class="pill">streaming</span>' : '';
			return '<article class="message ' + roleClass + '">' +
				'<div class="role">' + escapeHtml(message.title || message.role || 'message') +
				'<span class="time">' + escapeHtml(formatTime(entry.timestamp)) + '</span></div>' +
				'<div class="content"><pre>' + escapeHtml(text) + '</pre>' +
				thinking + renderToolCalls(message.toolCalls) + renderMeta(message.meta) + live + error +
				'</div></article>';
		}

		function renderTools(tools) {
			if (!tools || tools.length === 0) {
				els.tools.innerHTML = '<div class="kv"><div class="v">No active tools</div></div>';
				return;
			}
			els.tools.innerHTML = tools.map((tool) =>
				'<div class="tool"><strong>' + escapeHtml(tool.name) + ' ' + escapeHtml(tool.status) +
				(tool.isError ? ' error' : '') + '</strong><pre>' +
				escapeHtml(tool.result || tool.args || '') + '</pre></div>'
			).join('');
		}

		function renderSessions(snapshot) {
			els.sessions.innerHTML = (snapshot.sessions || []).map((session) => {
				const active = session.id === snapshot.activeSessionId ? ' active' : '';
				const runState = session.isIdle ? 'idle' : 'running';
				const pending = session.hasPendingMessages ? ' queued' : '';
				return '<button type="button" class="session-button' + active + '" data-session-id="' +
					escapeHtml(session.id) + '">' + escapeHtml(session.title) +
					'<br><span class="sub">' + escapeHtml(runState + pending) + '</span></button>';
			}).join('');
		}

		function renderCommands(commands) {
			if (!commands || commands.length === 0) {
				els.commands.innerHTML = '<div class="kv"><div class="v">No slash commands</div></div>';
				return;
			}
			els.commands.innerHTML = commands.slice(0, 36).map((command) =>
				'<button type="button" class="command-button" data-command="' + escapeHtml(command.name) +
				'">/' + escapeHtml(command.name) + '<br><span class="sub">' +
				escapeHtml(command.source + (command.description ? ' - ' + command.description : '')) +
				'</span></button>'
			).join('');
		}

		function renderExtensionUi(extensionUi) {
			if (!extensionUi) {
				els.extensionUi.innerHTML = '<div class="kv"><div class="v">No extension UI</div></div>';
				renderDialog(null);
				return;
			}
			const boxes = [];
			if (extensionUi.title) {
				boxes.push('<div class="box"><strong>Title</strong><pre>' + escapeHtml(extensionUi.title) + '</pre></div>');
			}
			for (const status of extensionUi.statuses || []) {
				boxes.push('<div class="box"><strong>' + escapeHtml(status.key) + '</strong><pre>' +
					escapeHtml(status.text) + '</pre></div>');
			}
			for (const widget of extensionUi.widgets || []) {
				boxes.push('<div class="box"><strong>' + escapeHtml(widget.key + ' ' + widget.placement) +
					'</strong><pre>' + escapeHtml((widget.lines || []).join('\\n')) + '</pre></div>');
			}
			els.extensionUi.innerHTML = boxes.join('') || '<div class="kv"><div class="v">No extension UI</div></div>';
			renderDialog(extensionUi.dialog);

			if (extensionUi.editorText && extensionUi.editorText !== state.lastEditorText) {
				if (!state.userEdited || !els.prompt.value.trim()) {
					els.prompt.value = extensionUi.editorText;
					state.lastEditorText = extensionUi.editorText;
					state.userEdited = false;
				}
			}
		}

		function renderSettingsPanel(settings) {
			const modelOptions = (settings.models || []).map((model) =>
				'<option value="' + escapeHtml(model.provider + '\\t' + model.modelId) + '"' +
				(model.current ? ' selected' : '') + '>' + escapeHtml(model.label) + '</option>'
			).join('');
			const thinkingOptions = (settings.availableThinkingLevels || []).map((level) =>
				'<option value="' + escapeHtml(level) + '"' +
				(level === settings.currentThinkingLevel ? ' selected' : '') + '>' + escapeHtml(level) + '</option>'
			).join('');
			const queueOption = (value, current) =>
				'<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>';
			const treeOptions = ['default', 'no-tools', 'user-only', 'labeled-only', 'all'].map((mode) =>
				'<option value="' + mode + '"' + (mode === settings.treeFilterMode ? ' selected' : '') + '>' + mode + '</option>'
			).join('');
			const extensionRows = (settings.extensions || []).map((extension) =>
				'<div class="box"><strong>' + escapeHtml(extension.source) + '</strong><pre>' +
				escapeHtml(extension.path + (extension.error ? '\\n' + extension.error : '\\n' + extension.commands + ' commands, ' + extension.tools + ' tools')) +
				'</pre></div>'
			).join('');
			return '<div class="host-panel__header"><h2>Settings</h2><button type="button" data-panel-close="true">Close</button></div>' +
				'<div class="settings-grid">' +
				'<label>Model</label><select id="settings-model">' + modelOptions + '</select>' +
				'<label>Reasoning</label><select id="settings-thinking">' + thinkingOptions + '</select>' +
				'<label>Steering</label><select id="settings-steering">' +
				queueOption('one-at-a-time', settings.steeringMode) + queueOption('all', settings.steeringMode) + '</select>' +
				'<label>Follow-up</label><select id="settings-follow-up">' +
				queueOption('one-at-a-time', settings.followUpMode) + queueOption('all', settings.followUpMode) + '</select>' +
				'<label>Tree filter</label><select id="settings-tree-filter">' + treeOptions + '</select>' +
				'<label>Auto compact</label><label><input id="settings-auto-compact" type="checkbox"' +
				(settings.autoCompactionEnabled ? ' checked' : '') + '> Enabled</label>' +
				'<label>Default model</label><div class="sub">' + escapeHtml((settings.defaultProvider || '-') + '/' + (settings.defaultModel || '-')) + '</div>' +
				'<label>Default reasoning</label><div class="sub">' + escapeHtml(settings.defaultThinkingLevel || '-') + '</div>' +
				'</div>' +
				'<h2 style="margin-top:18px">Extensions</h2>' +
				'<div class="extension-boxes" style="margin-top:8px">' +
				(extensionRows || '<div class="box"><strong>None</strong><pre>No extensions loaded</pre></div>') +
				'</div>';
		}

		function renderTreePanel(tree) {
			const rows = (tree.nodes || []).map((node) => {
				const active = node.isActive ? ' active' : '';
				const dim = node.isCurrentBranch ? '' : ' dim';
				const label = node.label ? ' [' + node.label + ']' : '';
				const indent = Math.min(node.depth * 18, 160);
				return '<div class="tree-row' + active + dim + '">' +
					'<div style="padding-left:' + indent + 'px">' +
					'<div class="tree-title">' + escapeHtml((node.isActive ? 'Current - ' : '') + node.title + label) + '</div>' +
					'<div class="tree-text">' + escapeHtml(node.text || node.entryType) + '</div>' +
					'</div>' +
					'<button type="button" data-tree-id="' + escapeHtml(node.id) + '"' +
					(node.isActive ? ' disabled' : '') + '>Go</button>' +
					'</div>';
			}).join('');
			return '<div class="host-panel__header"><h2>Tree</h2><button type="button" data-panel-close="true">Close</button></div>' +
				'<div class="tree-controls">' +
				'<label><input id="tree-summarize" type="checkbox"> Summarize branch</label>' +
				'<input id="tree-instructions" placeholder="Optional summary instructions">' +
				'</div>' +
				'<div class="tree-list">' + (rows || '<div class="empty">No tree entries yet.</div>') + '</div>';
		}

		function renderHostPanel(panel) {
			if (!panel) {
				els.hostPanelBackdrop.classList.remove('open');
				els.hostPanel.innerHTML = '';
				return;
			}
			els.hostPanel.innerHTML = panel.kind === 'settings'
				? renderSettingsPanel(panel.settings)
				: renderTreePanel(panel.tree);
			els.hostPanelBackdrop.classList.add('open');
		}

		function renderDialog(dialog) {
			if (!dialog) {
				els.dialogBackdrop.classList.remove('open');
				els.dialog.innerHTML = '';
				return;
			}

			let body = '<h2>' + escapeHtml(dialog.title) + '</h2>';
			if (dialog.message) body += '<p>' + escapeHtml(dialog.message) + '</p>';
			if (dialog.kind === 'select') {
				body += '<div class="dialog-options">' + (dialog.options || []).map((option) =>
					'<button type="button" data-dialog-value="' + escapeHtml(option) + '">' +
					escapeHtml(option) + '</button>'
				).join('') + '</div>';
			}
			if (dialog.kind === 'input') {
				body += '<input id="dialog-input" placeholder="' + escapeHtml(dialog.placeholder || '') + '">';
			}
			if (dialog.kind === 'editor') {
				body += '<textarea id="dialog-input">' + escapeHtml(dialog.prefill || '') + '</textarea>';
			}
			body += '<div class="dialog-actions">';
			if (dialog.kind === 'confirm') {
				body += '<button type="button" data-dialog-confirm="false">Cancel</button>';
				body += '<button class="primary" type="button" data-dialog-confirm="true">Confirm</button>';
			} else {
				body += '<button type="button" data-dialog-cancel="true">Cancel</button>';
				if (dialog.kind !== 'select') body += '<button class="primary" type="button" data-dialog-submit="true">Submit</button>';
			}
			body += '</div>';
			els.dialog.innerHTML = body;
			els.dialogBackdrop.classList.add('open');
		}

		function render() {
			const snapshot = state.snapshot;
			if (!snapshot) {
				applyTheme();
				els.status.textContent = state.connected ? 'Preparing session' : 'Connecting';
				els.error.textContent = state.error;
				return;
			}

			els.dot.classList.toggle('running', !snapshot.isIdle);
			els.status.textContent = snapshot.isIdle ? 'Idle' : 'Running';
			if (snapshot.hasPendingMessages) els.status.textContent += ' with queued input';
			if (snapshot.notice) els.status.textContent += ' - ' + snapshot.notice;
			els.abort.disabled = snapshot.isIdle;

			const usage = snapshot.contextUsage && snapshot.contextUsage.percent !== null
				? Math.round(snapshot.contextUsage.percent) + '%'
				: null;
			els.session.innerHTML =
				kv('Name', snapshot.sessionName) +
				kv('Model', snapshot.model) +
				kv('Context', usage) +
				kv('Cwd', snapshot.cwd) +
				kv('File', snapshot.sessionFile);

			renderSessions(snapshot);
			renderCommands(snapshot.commands);
			renderExtensionUi(snapshot.extensionUi);
			renderHostPanel(snapshot.hostPanel);
			renderTools(snapshot.tools);

			const entries = snapshot.entries || [];
			let html = entries.map((entry) => renderMessage(entry, false)).join('');
			if (snapshot.liveMessage) {
				html += renderMessage({
					id: 'live',
					parentId: null,
					timestamp: new Date().toISOString(),
					entryType: 'message',
					message: snapshot.liveMessage
				}, true);
			}
			els.transcript.innerHTML = html || '<div class="empty">No messages in this session yet.</div>';
			els.error.textContent = state.error;
			els.send.textContent = snapshot.isIdle ? 'Send' : 'Queue';
			applyTheme();
		}

		async function postJson(path, payload) {
			state.error = '';
			render();
			const response = await fetch(path, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-pi-web-ui': '1'
				},
				body: JSON.stringify(payload || {})
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || response.statusText);
			return data;
		}

		async function send(mode) {
			const message = els.prompt.value.trim();
			if (!message) return;
			await postJson('/api/send', { message, mode, sessionId: state.snapshot && state.snapshot.activeSessionId });
			els.prompt.value = '';
			state.userEdited = false;
		}

		function activeDialog() {
			return state.snapshot && state.snapshot.extensionUi && state.snapshot.extensionUi.dialog;
		}

		async function respondToDialog(payload) {
			const dialog = activeDialog();
			if (!dialog) return;
			await postJson('/api/dialog-response', {
				sessionId: state.snapshot && state.snapshot.activeSessionId,
				requestId: dialog.id,
				...payload
			});
		}

		async function updateSetting(payload) {
			await postJson('/api/settings', {
				sessionId: state.snapshot && state.snapshot.activeSessionId,
				...payload
			});
		}

		async function closeHostPanel() {
			await postJson('/api/panel', {
				sessionId: state.snapshot && state.snapshot.activeSessionId
			});
		}

		els.prompt.addEventListener('input', () => {
			state.userEdited = true;
		});

		els.form.addEventListener('submit', (event) => {
			event.preventDefault();
			send('auto').catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.steer.addEventListener('click', () => {
			send('steer').catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.abort.addEventListener('click', () => {
			postJson('/api/abort').catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.compact.addEventListener('click', () => {
			postJson('/api/compact').catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.themeToggle.addEventListener('click', () => {
			state.theme = state.theme === 'light' ? 'dark' : 'light';
			localStorage.setItem('pi-web-ui-theme', state.theme);
			applyTheme();
		});

		els.settings.addEventListener('click', () => {
			postJson('/api/panel', {
				sessionId: state.snapshot && state.snapshot.activeSessionId,
				kind: 'settings'
			}).catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.tree.addEventListener('click', () => {
			postJson('/api/panel', {
				sessionId: state.snapshot && state.snapshot.activeSessionId,
				kind: 'tree'
			}).catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.newSession.addEventListener('click', () => {
			postJson('/api/sessions').catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.sessions.addEventListener('click', (event) => {
			const button = event.target.closest('[data-session-id]');
			if (!button) return;
			postJson('/api/select-session', { sessionId: button.getAttribute('data-session-id') }).catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.commands.addEventListener('click', (event) => {
			const button = event.target.closest('[data-command]');
			if (!button) return;
			const command = '/' + button.getAttribute('data-command') + ' ';
			const start = els.prompt.selectionStart || 0;
			const end = els.prompt.selectionEnd || 0;
			els.prompt.value = els.prompt.value.slice(0, start) + command + els.prompt.value.slice(end);
			state.userEdited = true;
			els.prompt.focus();
			els.prompt.selectionStart = els.prompt.selectionEnd = start + command.length;
		});

		els.hostPanel.addEventListener('click', (event) => {
			if (event.target.closest('[data-panel-close]')) {
				closeHostPanel().catch((error) => {
					state.error = error.message;
					render();
				});
				return;
			}
			const treeButton = event.target.closest('[data-tree-id]');
			if (treeButton) {
				const summarize = document.getElementById('tree-summarize');
				const instructions = document.getElementById('tree-instructions');
				postJson('/api/tree-navigate', {
					sessionId: state.snapshot && state.snapshot.activeSessionId,
					entryId: treeButton.getAttribute('data-tree-id'),
					summarize: summarize ? summarize.checked : false,
					customInstructions: instructions ? instructions.value : ''
				}).catch((error) => {
					state.error = error.message;
					render();
				});
			}
		});

		els.hostPanel.addEventListener('change', (event) => {
			const target = event.target;
			if (!target) return;
			let payload = null;
			if (target.id === 'settings-model') {
				const parts = target.value.split('\\t');
				payload = { action: 'setModel', provider: parts[0], modelId: parts[1] };
			} else if (target.id === 'settings-thinking') {
				payload = { action: 'setThinkingLevel', thinkingLevel: target.value };
			} else if (target.id === 'settings-steering') {
				payload = { action: 'setSteeringMode', mode: target.value };
			} else if (target.id === 'settings-follow-up') {
				payload = { action: 'setFollowUpMode', mode: target.value };
			} else if (target.id === 'settings-tree-filter') {
				payload = { action: 'setTreeFilterMode', treeFilterMode: target.value };
			} else if (target.id === 'settings-auto-compact') {
				payload = { action: 'setAutoCompaction', enabled: target.checked };
			}
			if (!payload) return;
			updateSetting(payload).catch((error) => {
				state.error = error.message;
				render();
			});
		});

		els.dialog.addEventListener('click', (event) => {
			const option = event.target.closest('[data-dialog-value]');
			if (option) {
				respondToDialog({ value: option.getAttribute('data-dialog-value'), cancelled: false }).catch((error) => {
					state.error = error.message;
					render();
				});
				return;
			}
			const confirm = event.target.closest('[data-dialog-confirm]');
			if (confirm) {
				respondToDialog({
					confirmed: confirm.getAttribute('data-dialog-confirm') === 'true',
					cancelled: confirm.getAttribute('data-dialog-confirm') !== 'true'
				}).catch((error) => {
					state.error = error.message;
					render();
				});
				return;
			}
			if (event.target.closest('[data-dialog-cancel]')) {
				respondToDialog({ cancelled: true }).catch((error) => {
					state.error = error.message;
					render();
				});
				return;
			}
			if (event.target.closest('[data-dialog-submit]')) {
				const input = document.getElementById('dialog-input');
				respondToDialog({ value: input ? input.value : '', cancelled: false }).catch((error) => {
					state.error = error.message;
					render();
				});
			}
		});

		const events = new EventSource('/events');
		events.addEventListener('open', () => {
			state.connected = true;
			state.error = '';
			render();
		});
		events.addEventListener('error', () => {
			state.connected = false;
			state.error = 'Disconnected from extension server';
			render();
		});
		events.addEventListener('snapshot', (event) => {
			state.snapshot = JSON.parse(event.data);
			state.connected = true;
			state.error = '';
			render();
		});

		fetch('/api/state')
			.then((response) => response.json())
			.then((snapshot) => {
				state.snapshot = snapshot;
				render();
			})
			.catch((error) => {
				state.error = error.message;
				render();
			});
	</script>
</body>
</html>`;
