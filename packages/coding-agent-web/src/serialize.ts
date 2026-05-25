import type { SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import type {
	HistorySessionSummary,
	SerializedEntry,
	SerializedMessage,
	TreeNodeSnapshot,
	TreeSnapshot,
} from "./types.ts";

interface SerializedContent {
	text: string;
	thinking: string;
	toolCalls: Array<{ id: string; name: string; args: string }>;
	imageCount: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

export function getNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

export function stringifyUnknown(value: unknown): string {
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

export function serializeAgentMessage(message: unknown): SerializedMessage {
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
			for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
				const value = getNumber(message.usage, key);
				if (value !== undefined) meta[key] = value;
			}
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

export function serializeEntry(entry: SessionEntry): SerializedEntry | null {
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
		return systemEntry(id, parentId, timestamp, entryType, "Compaction", getString(record, "summary") ?? "", {
			tokensBefore: normalizeMetaValue(record.tokensBefore),
		});
	}

	if (entryType === "branch_summary") {
		return systemEntry(id, parentId, timestamp, entryType, "Branch summary", getString(record, "summary") ?? "", {
			fromId: normalizeMetaValue(record.fromId),
		});
	}

	if (entryType === "model_change") {
		return systemEntry(
			id,
			parentId,
			timestamp,
			entryType,
			"Model changed",
			`${getString(record, "provider") ?? "provider"} / ${getString(record, "modelId") ?? "model"}`,
			{},
		);
	}

	if (entryType === "thinking_level_change") {
		return systemEntry(
			id,
			parentId,
			timestamp,
			entryType,
			"Thinking level",
			getString(record, "thinkingLevel") ?? "",
			{},
		);
	}

	if (entryType === "session_info") {
		return systemEntry(id, parentId, timestamp, entryType, "Session name", getString(record, "name") ?? "", {});
	}

	return null;
}

function systemEntry(
	id: string,
	parentId: string | null,
	timestamp: string,
	entryType: string,
	title: string,
	text: string,
	meta: Record<string, string | number | boolean | null>,
): SerializedEntry {
	return {
		id,
		parentId,
		timestamp,
		entryType,
		message: {
			role: "system",
			title,
			text,
			thinking: "",
			toolCalls: [],
			imageCount: 0,
			meta,
		},
	};
}

export function serializeHistorySession(session: SessionInfo): HistorySessionSummary {
	return {
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name ?? null,
		parentSessionPath: session.parentSessionPath ?? null,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	};
}

export function serializeTree(roots: readonly unknown[], leafId: string | null, branchIds: Set<string>): TreeSnapshot {
	const nodes: TreeNodeSnapshot[] = [];

	const visit = (node: unknown, depth: number): void => {
		if (!isRecord(node) || !isRecord(node.entry)) return;
		const record = node.entry;
		const id = getString(record, "id") ?? "";
		if (!id) return;

		nodes.push({
			id,
			parentId: getString(record, "parentId") ?? null,
			depth,
			entryType: getString(record, "type") ?? "entry",
			title: getTreeTitle(record),
			text: getTreeText(record),
			timestamp: getString(record, "timestamp") ?? "",
			label: getString(node, "label") ?? null,
			isActive: id === leafId,
			isCurrentBranch: branchIds.has(id),
		});

		const children = Array.isArray(node.children) ? node.children : [];
		for (const child of children) {
			visit(child, depth + 1);
		}
	};

	for (const root of roots) {
		visit(root, 0);
	}

	return { leafId, nodes };
}

function getTreeTitle(entry: Record<string, unknown>): string {
	const type = getString(entry, "type") ?? "entry";
	if (type === "message") return serializeAgentMessage(entry.message).title;
	if (type === "custom_message") return getString(entry, "customType") ?? "Custom";
	if (type === "branch_summary") return "Branch summary";
	if (type === "compaction") return "Compaction";
	if (type === "model_change") return "Model changed";
	if (type === "thinking_level_change") return "Thinking level";
	if (type === "session_info") return "Session name";
	if (type === "label") return "Label";
	return type;
}

function getTreeText(entry: Record<string, unknown>): string {
	const type = getString(entry, "type");
	if (type === "message") {
		const message = serializeAgentMessage(entry.message);
		return excerpt(message.text || message.thinking || message.role);
	}
	if (type === "custom_message") {
		const content = textFromContentItems(entry.content);
		return excerpt(content.text || getString(entry, "customType") || "");
	}
	if (type === "branch_summary" || type === "compaction") return excerpt(getString(entry, "summary") ?? "");
	if (type === "model_change") {
		return `${getString(entry, "provider") ?? "provider"} / ${getString(entry, "modelId") ?? "model"}`;
	}
	if (type === "thinking_level_change") return getString(entry, "thinkingLevel") ?? "";
	if (type === "session_info") return getString(entry, "name") ?? "";
	if (type === "label") return getString(entry, "label") ?? "";
	return "";
}

function excerpt(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= 180) return normalized;
	return `${normalized.slice(0, 177)}...`;
}
