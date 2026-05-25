import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionCommandContextActions,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	type ExtensionWidgetOptions,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	getBoolean,
	getString,
	isRecord,
	serializeAgentMessage,
	serializeEntry,
	serializeHistorySession,
	serializeTree,
	stringifyUnknown,
} from "./serialize.ts";
import {
	type DialogResponseRequest,
	type ExtensionStatus,
	type ExtensionUiSnapshot,
	type ExtensionWidget,
	type ForkRequest,
	type HistorySessionSummary,
	type LabelRequest,
	type PromptMode,
	type QueueMode,
	type ResumeSessionRequest,
	type SelectSessionRequest,
	type SendPromptRequest,
	type SerializedCommand,
	type SerializedEntry,
	type SerializedMessage,
	type SerializedModelOption,
	type SessionRequest,
	type SessionSummary,
	type SettingsSnapshot,
	type SettingsUpdateRequest,
	THINKING_LEVELS,
	type ThinkingLevel,
	type ToolActivity,
	type TreeNavigateRequest,
	type TreeSnapshot,
	type WebSessionSnapshot,
} from "./types.ts";

const MAX_TOOL_ACTIVITIES = 40;
const HISTORY_LIMIT = 80;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const ARTIFACT_CONTENT_TYPES = new Map<string, string>([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".svg", "image/svg+xml"],
	[".bmp", "image/bmp"],
	[".avif", "image/avif"],
	[".html", "text/html; charset=utf-8"],
	[".htm", "text/html; charset=utf-8"],
]);

type SnapshotListener = (snapshot: WebSessionSnapshot) => void;
type DialogResolver = (response: DialogResponseRequest) => void;

export interface ResolvedArtifact {
	filePath: string;
	contentType: string;
	size: number;
	isHtml: boolean;
}

interface RuntimeOptions {
	cwd: string;
	continueRecent: boolean;
	sessionPath: string | undefined;
}

export class WebRuntime {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly authStorage: AuthStorage;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private readonly sessions = new Map<string, WebRuntimeSession>();
	private readonly listeners = new Set<SnapshotListener>();
	private activeSessionId: string | null = null;
	private history: HistorySessionSummary[] = [];
	private broadcastQueued = false;

	constructor(cwd: string) {
		this.cwd = resolve(cwd);
		this.agentDir = getAgentDir();
		this.authStorage = AuthStorage.create();
		this.createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				authStorage: this.authStorage,
			});
			const created = await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
			});
			return {
				...created,
				services,
				diagnostics: [...services.diagnostics],
			};
		};
	}

	static async create(options: RuntimeOptions): Promise<WebRuntime> {
		const runtime = new WebRuntime(options.cwd);
		const sessionManager = runtime.getInitialSessionManager(options);
		await runtime.addSession(sessionManager, true);
		await runtime.refreshHistory();
		return runtime;
	}

	subscribe(listener: SnapshotListener): () => void {
		this.listeners.add(listener);
		listener(this.getSnapshot());
		return () => {
			this.listeners.delete(listener);
		};
	}

	getSnapshot(): WebSessionSnapshot {
		const activeSession = this.getActiveSessionOrUndefined();
		const activeSnapshot = activeSession?.getSnapshot();

		return {
			activeSessionId: this.activeSessionId,
			sessions: this.getSessionSummaries(),
			history: this.history,
			cwd: activeSnapshot?.cwd ?? null,
			sessionFile: activeSnapshot?.sessionFile ?? null,
			sessionId: activeSnapshot?.sessionId ?? null,
			sessionName: activeSnapshot?.sessionName ?? null,
			model: activeSnapshot?.model ?? null,
			contextUsage: activeSnapshot?.contextUsage ?? null,
			isIdle: activeSnapshot?.isIdle ?? true,
			hasPendingMessages: activeSnapshot?.hasPendingMessages ?? false,
			pendingMessageCount: activeSnapshot?.pendingMessageCount ?? 0,
			entries: activeSnapshot?.entries ?? [],
			liveMessage: activeSnapshot?.liveMessage ?? null,
			tools: activeSnapshot?.tools ?? [],
			commands: activeSnapshot?.commands ?? [],
			extensionUi: activeSnapshot?.extensionUi ?? null,
			settings: activeSnapshot?.settings ?? null,
			tree: activeSnapshot?.tree ?? null,
			diagnostics: activeSnapshot?.diagnostics ?? [],
			notice: activeSnapshot?.notice ?? null,
		};
	}

	async createSession(): Promise<void> {
		await this.addSession(SessionManager.create(this.cwd), true);
		await this.refreshHistory();
	}

	async resumeSession(request: ResumeSessionRequest): Promise<void> {
		const existing = [...this.sessions.values()].find((session) => session.sessionFile === request.path);
		if (existing) {
			this.activeSessionId = existing.id;
			this.queueBroadcast();
			return;
		}
		await this.addSession(SessionManager.open(request.path), true);
		await this.refreshHistory();
	}

	selectSession(request: SelectSessionRequest): void {
		if (!this.sessions.has(request.sessionId)) {
			throw new Error(`Unknown session: ${request.sessionId}`);
		}
		this.activeSessionId = request.sessionId;
		this.queueBroadcast();
	}

	async sendPrompt(request: SendPromptRequest): Promise<void> {
		await this.getSession(request.sessionId).sendPrompt(request.message, request.mode);
	}

	async abort(request: SessionRequest): Promise<void> {
		await this.getSession(request.sessionId).abort();
	}

	async compact(request: SessionRequest): Promise<void> {
		await this.getSession(request.sessionId).compact();
		await this.refreshHistory();
	}

	async updateSettings(request: SettingsUpdateRequest): Promise<void> {
		await this.getSession(request.sessionId).updateSettings(request);
	}

	async navigateTree(request: TreeNavigateRequest): Promise<void> {
		await this.getSession(request.sessionId).navigateTree(request);
		await this.refreshHistory();
	}

	async fork(request: ForkRequest): Promise<void> {
		await this.getSession(request.sessionId).fork(request);
		await this.refreshHistory();
	}

	label(request: LabelRequest): void {
		this.getSession(request.sessionId).label(request);
	}

	respondToDialog(request: DialogResponseRequest): void {
		this.getSession(request.sessionId).respondToDialog(request);
	}

	async refreshHistory(): Promise<void> {
		const sessions = await SessionManager.listAll();
		this.history = sessions.slice(0, HISTORY_LIMIT).map(serializeHistorySession);
		this.queueBroadcast();
	}

	async resolveArtifact(sessionId: string | undefined, rawPath: string): Promise<ResolvedArtifact> {
		return this.getSession(sessionId).resolveArtifact(rawPath);
	}

	queueBroadcast(): void {
		if (this.broadcastQueued) return;
		this.broadcastQueued = true;
		setTimeout(() => {
			this.broadcastQueued = false;
			this.broadcast();
		}, 0);
	}

	broadcast(): void {
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}

	private getInitialSessionManager(options: RuntimeOptions): SessionManager {
		if (options.sessionPath) return SessionManager.open(options.sessionPath);
		if (options.continueRecent) return SessionManager.continueRecent(this.cwd);
		return SessionManager.create(this.cwd);
	}

	private async addSession(sessionManager: SessionManager, activate: boolean): Promise<WebRuntimeSession> {
		const runtime = await createAgentSessionRuntime(this.createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir: this.agentDir,
			sessionManager,
		});
		const session = await WebRuntimeSession.create(this, runtime);
		this.sessions.set(session.id, session);
		if (activate || this.activeSessionId === null) {
			this.activeSessionId = session.id;
		}
		this.queueBroadcast();
		return session;
	}

	private getSession(sessionId: string | undefined): WebRuntimeSession {
		const id = sessionId ?? this.activeSessionId;
		if (!id) throw new Error("No active session");
		const session = this.sessions.get(id);
		if (!session) throw new Error(`Unknown session: ${id}`);
		return session;
	}

	private getActiveSessionOrUndefined(): WebRuntimeSession | undefined {
		if (!this.activeSessionId) return undefined;
		return this.sessions.get(this.activeSessionId);
	}

	private getSessionSummaries(): SessionSummary[] {
		return [...this.sessions.values()].map((session) => session.getSummary());
	}
}

class WebRuntimeSession {
	readonly id: string;
	private readonly owner: WebRuntime;
	private runtime: AgentSessionRuntime;
	private unsubscribe: (() => void) | undefined;
	private liveMessage: SerializedMessage | null = null;
	private readonly toolActivities = new Map<string, ToolActivity>();
	private readonly statuses = new Map<string, ExtensionStatus>();
	private readonly widgets = new Map<string, ExtensionWidget>();
	private readonly dialogResolvers = new Map<string, DialogResolver>();
	private title: string | null = null;
	private editorText: string | null = null;
	private dialog: ExtensionUiSnapshot["dialog"] = null;
	private notice: string | null = null;
	private availableModels: SerializedModelOption[] = [];

	private constructor(owner: WebRuntime, runtime: AgentSessionRuntime) {
		this.id = randomUUID();
		this.owner = owner;
		this.runtime = runtime;
		this.runtime.setRebindSession(async () => {
			await this.bindCurrentSession();
		});
	}

	static async create(owner: WebRuntime, runtime: AgentSessionRuntime): Promise<WebRuntimeSession> {
		const session = new WebRuntimeSession(owner, runtime);
		await session.bindCurrentSession();
		return session;
	}

	get sessionFile(): string | undefined {
		return this.runtime.session.sessionFile;
	}

	getSnapshot(): Omit<WebSessionSnapshot, "activeSessionId" | "sessions" | "history"> {
		const session = this.runtime.session;
		return {
			cwd: this.runtime.cwd,
			sessionFile: session.sessionFile ?? null,
			sessionId: session.sessionId,
			sessionName: session.sessionName ?? null,
			model: formatModel(session),
			contextUsage: session.getContextUsage() ?? null,
			isIdle: this.isIdle(),
			hasPendingMessages: session.pendingMessageCount > 0,
			pendingMessageCount: session.pendingMessageCount,
			entries: serializeEntries(session),
			liveMessage: this.liveMessage,
			tools: this.getTools(),
			commands: this.getCommands(),
			extensionUi: this.getExtensionUiSnapshot(),
			settings: this.getSettingsSnapshot(),
			tree: this.getTreeSnapshot(),
			diagnostics: [...this.runtime.diagnostics],
			notice: this.notice,
		};
	}

	getSummary(): SessionSummary {
		const session = this.runtime.session;
		const name = session.sessionName;
		const firstUserMessage = getFirstUserMessage(session);
		const title = name ?? firstUserMessage ?? session.sessionId.slice(0, 8);
		return {
			id: this.id,
			title,
			cwd: this.runtime.cwd,
			sessionFile: session.sessionFile ?? null,
			sessionName: name ?? null,
			model: formatModel(session),
			isIdle: this.isIdle(),
			hasPendingMessages: session.pendingMessageCount > 0,
			messageCount: session.messages.length,
		};
	}

	async sendPrompt(message: string, mode: PromptMode): Promise<void> {
		const session = this.runtime.session;
		this.notice = null;
		const options: Parameters<AgentSession["prompt"]>[1] = { source: "interactive" };
		if (session.isStreaming) {
			options.streamingBehavior = mode === "steer" ? "steer" : "followUp";
		}
		await session.prompt(message, options);
		this.owner.queueBroadcast();
	}

	async abort(): Promise<void> {
		await this.runtime.session.abort();
		this.notice = "Run aborted";
		this.owner.queueBroadcast();
	}

	async compact(): Promise<void> {
		await this.runtime.session.compact();
		this.notice = "Session compacted";
		this.owner.queueBroadcast();
	}

	async updateSettings(request: SettingsUpdateRequest): Promise<void> {
		const session = this.runtime.session;
		if (request.action === "setModel") {
			if (!request.provider || !request.modelId) throw new Error("provider and modelId are required");
			const model = session.modelRegistry
				.getAvailable()
				.find((candidate) => candidate.provider === request.provider && candidate.id === request.modelId);
			if (!model) throw new Error(`Model not found or not authenticated: ${request.provider}/${request.modelId}`);
			await session.setModel(model);
			this.refreshModels();
		} else if (request.action === "setThinkingLevel") {
			if (!request.thinkingLevel) throw new Error("thinkingLevel is required");
			session.setThinkingLevel(request.thinkingLevel);
		} else if (request.action === "setSteeringMode") {
			if (!request.mode) throw new Error("mode is required");
			session.setSteeringMode(request.mode);
		} else if (request.action === "setFollowUpMode") {
			if (!request.mode) throw new Error("mode is required");
			session.setFollowUpMode(request.mode);
		} else if (request.action === "setAutoCompaction") {
			if (request.enabled === undefined) throw new Error("enabled is required");
			session.setAutoCompactionEnabled(request.enabled);
		}
		this.owner.queueBroadcast();
	}

	async navigateTree(request: TreeNavigateRequest): Promise<void> {
		const result = await this.runtime.session.navigateTree(request.entryId, {
			summarize: request.summarize,
			customInstructions: request.customInstructions,
		});
		if (result.cancelled) {
			this.notice = "Tree navigation cancelled";
			return;
		}
		if (result.editorText) {
			this.editorText = result.editorText;
		}
		this.notice = "Navigated session tree";
		this.owner.queueBroadcast();
	}

	async fork(request: ForkRequest): Promise<void> {
		const result = await this.runtime.fork(request.entryId, { position: request.position });
		if (result.cancelled) {
			this.notice = "Fork cancelled";
			return;
		}
		if (result.selectedText) {
			this.editorText = result.selectedText;
		}
		this.notice = "Forked to a new session";
		this.owner.queueBroadcast();
	}

	label(request: LabelRequest): void {
		this.runtime.session.sessionManager.appendLabelChange(request.entryId, request.label);
		this.owner.queueBroadcast();
	}

	async resolveArtifact(rawPath: string): Promise<ResolvedArtifact> {
		const cleaned = normalizeArtifactPath(rawPath);
		const filePath = isAbsolute(cleaned) ? resolve(cleaned) : resolve(this.runtime.cwd, cleaned);
		const contentType = ARTIFACT_CONTENT_TYPES.get(extname(filePath).toLowerCase());
		if (!contentType) {
			throw new Error("Unsupported artifact type");
		}
		if (!isInsidePath(this.runtime.cwd, filePath) && !isInsidePath(tmpdir(), filePath)) {
			throw new Error("Artifact path is outside this session cwd and /tmp");
		}

		const fileStat = await stat(filePath);
		if (!fileStat.isFile()) {
			throw new Error("Artifact path is not a file");
		}
		if (fileStat.size > MAX_ARTIFACT_BYTES) {
			throw new Error("Artifact is too large to preview");
		}

		return {
			filePath,
			contentType,
			size: fileStat.size,
			isHtml: contentType.startsWith("text/html"),
		};
	}

	respondToDialog(request: DialogResponseRequest): void {
		const resolver = this.dialogResolvers.get(request.requestId);
		if (!resolver) return;
		resolver(request);
	}

	private async bindCurrentSession(): Promise<void> {
		this.unsubscribe?.();
		this.liveMessage = null;
		this.toolActivities.clear();
		this.statuses.clear();
		this.widgets.clear();
		this.dialog = null;
		this.dialogResolvers.clear();
		this.refreshModels();

		const session = this.runtime.session;
		await session.bindExtensions({
			uiContext: this.createExtensionUiContext(),
			commandContextActions: this.createCommandActions(),
			shutdownHandler: () => {
				this.notice = "Session shutdown requested by extension";
				this.owner.queueBroadcast();
			},
			onError: (error) => {
				this.notice = `Extension error in ${error.extensionPath}: ${error.error}`;
				this.owner.queueBroadcast();
			},
		});

		this.unsubscribe = session.subscribe((event) => {
			this.handleSessionEvent(event);
		});
		this.owner.queueBroadcast();
	}

	private createCommandActions(): ExtensionCommandContextActions {
		return {
			waitForIdle: () => this.runtime.session.agent.waitForIdle(),
			newSession: async (options) => {
				const result = await this.runtime.newSession(options);
				if (!result.cancelled) await this.owner.refreshHistory();
				return result;
			},
			fork: async (entryId, options) => {
				const result = await this.runtime.fork(entryId, options);
				if (!result.cancelled) await this.owner.refreshHistory();
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.runtime.session.navigateTree(targetId, {
					summarize: options?.summarize,
					customInstructions: options?.customInstructions,
					replaceInstructions: options?.replaceInstructions,
					label: options?.label,
				});
				this.owner.queueBroadcast();
				return { cancelled: result.cancelled };
			},
			switchSession: async (sessionPath, options) => {
				const result = await this.runtime.switchSession(sessionPath, options);
				if (!result.cancelled) await this.owner.refreshHistory();
				return result;
			},
			reload: async () => {
				await this.runtime.session.reload();
				this.refreshModels();
				this.owner.queueBroadcast();
			},
		};
	}

	private createExtensionUiContext(): ExtensionUIContext {
		const theme = {} as ExtensionUIContext["theme"];
		return {
			select: (title, options, opts) =>
				this.createDialogPromise("select", title, { options }, opts, undefined, (response) =>
					response.cancelled ? undefined : response.value,
				),
			confirm: (title, message, opts) =>
				this.createDialogPromise("confirm", title, { message }, opts, false, (response) =>
					response.cancelled ? false : response.confirmed === true,
				),
			input: (title, placeholder, opts) =>
				this.createDialogPromise("input", title, { placeholder }, opts, undefined, (response) =>
					response.cancelled ? undefined : response.value,
				),
			notify: (message, type) => {
				this.notice = type ? `${type}: ${message}` : message;
				this.owner.queueBroadcast();
			},
			onTerminalInput: () => () => {},
			setStatus: (key, text) => {
				if (text === undefined) {
					this.statuses.delete(key);
				} else {
					this.statuses.set(key, { key, text });
				}
				this.owner.queueBroadcast();
			},
			setWorkingMessage: (message) => {
				this.notice = message ?? null;
				this.owner.queueBroadcast();
			},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) => {
				if (content === undefined) {
					this.widgets.delete(key);
				} else if (Array.isArray(content) && content.every((line) => typeof line === "string")) {
					this.widgets.set(key, {
						key,
						lines: content,
						placement: options?.placement ?? "aboveEditor",
					});
				}
				this.owner.queueBroadcast();
			},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => {
				this.title = title;
				this.owner.queueBroadcast();
			},
			async custom() {
				return undefined as never;
			},
			pasteToEditor: (text) => {
				this.editorText = `${this.editorText ?? ""}${text}`;
				this.owner.queueBroadcast();
			},
			setEditorText: (text) => {
				this.editorText = text;
				this.owner.queueBroadcast();
			},
			getEditorText: () => this.editorText ?? "",
			editor: (title, prefill) =>
				this.createDialogPromise("editor", title, { prefill }, undefined, undefined, (response) =>
					response.cancelled ? undefined : response.value,
				),
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Theme switching is handled by the browser UI" }),
			getToolsExpanded: () => true,
			setToolsExpanded: () => {},
		};
	}

	private createDialogPromise<T>(
		kind: NonNullable<ExtensionUiSnapshot["dialog"]>["kind"],
		title: string,
		input: { message?: string; placeholder?: string; prefill?: string; options?: string[] },
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		parseResponse: (response: DialogResponseRequest) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = randomUUID();
		return new Promise((resolve) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const cleanup = (): void => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				this.dialogResolvers.delete(id);
				if (this.dialog?.id === id) {
					this.dialog = null;
					this.owner.queueBroadcast();
				}
			};
			const onAbort = (): void => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}
			this.dialogResolvers.set(id, (response) => {
				cleanup();
				resolve(parseResponse(response));
			});
			this.dialog = {
				id,
				kind,
				title,
				message: input.message ?? null,
				placeholder: input.placeholder ?? null,
				prefill: input.prefill ?? null,
				options: input.options ?? [],
			};
			this.owner.queueBroadcast();
		});
	}

	private handleSessionEvent(event: AgentSessionEvent): void {
		if (event.type === "message_start" || event.type === "message_update") {
			if (event.message.role === "assistant") {
				this.liveMessage = serializeAgentMessage(event.message);
			}
		} else if (event.type === "message_end") {
			if (event.message.role === "assistant") {
				this.liveMessage = null;
				setTimeout(() => {
					this.owner.queueBroadcast();
				}, 0);
			}
		} else if (event.type === "tool_execution_start") {
			this.setToolActivity(event.toolCallId, {
				id: event.toolCallId,
				name: event.toolName,
				args: stringifyUnknown(event.args),
				result: "",
				isError: false,
				status: "running",
				updatedAt: Date.now(),
			});
		} else if (event.type === "tool_execution_update") {
			const existing = this.getToolActivity(event.toolCallId, event.toolName, event.args);
			existing.result = stringifyUnknown(event.partialResult);
			existing.updatedAt = Date.now();
		} else if (event.type === "tool_execution_end") {
			const existing = this.getToolActivity(event.toolCallId, event.toolName, {});
			existing.result = stringifyUnknown(event.result);
			existing.isError = event.isError;
			existing.status = "done";
			existing.updatedAt = Date.now();
		} else if (event.type === "thinking_level_changed") {
			this.refreshModels();
		}
		this.owner.queueBroadcast();
	}

	private setToolActivity(id: string, activity: ToolActivity): void {
		this.toolActivities.set(id, activity);
		this.trimToolActivities();
	}

	private getToolActivity(id: string, name: string, args: unknown): ToolActivity {
		let activity = this.toolActivities.get(id);
		if (!activity) {
			activity = {
				id,
				name,
				args: stringifyUnknown(args),
				result: "",
				isError: false,
				status: "running",
				updatedAt: Date.now(),
			};
			this.setToolActivity(id, activity);
		}
		return activity;
	}

	private trimToolActivities(): void {
		if (this.toolActivities.size <= MAX_TOOL_ACTIVITIES) return;
		const entries = [...this.toolActivities.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
		for (const [id] of entries.slice(0, this.toolActivities.size - MAX_TOOL_ACTIVITIES)) {
			this.toolActivities.delete(id);
		}
	}

	private getTools(): ToolActivity[] {
		return [...this.toolActivities.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	private getExtensionUiSnapshot(): ExtensionUiSnapshot {
		return {
			title: this.title,
			editorText: this.editorText,
			statuses: [...this.statuses.values()],
			widgets: [...this.widgets.values()],
			dialog: this.dialog,
		};
	}

	private getSettingsSnapshot(): SettingsSnapshot {
		const session = this.runtime.session;
		return {
			currentModel: formatModel(session),
			currentThinkingLevel: session.thinkingLevel,
			availableThinkingLevels: session.getAvailableThinkingLevels().filter(isUiThinkingLevel),
			steeringMode: session.steeringMode,
			followUpMode: session.followUpMode,
			autoCompactionEnabled: session.autoCompactionEnabled,
			models: this.availableModels,
		};
	}

	private getTreeSnapshot(): TreeSnapshot {
		const session = this.runtime.session;
		const branchIds = new Set(session.sessionManager.getBranch().map((entry) => entry.id));
		return serializeTree(session.sessionManager.getTree(), session.sessionManager.getLeafId(), branchIds);
	}

	private getCommands(): SerializedCommand[] {
		const session = this.runtime.session;
		const commands: SerializedCommand[] = [];
		for (const command of session.extensionRunner.getRegisteredCommands()) {
			commands.push({
				name: command.invocationName,
				description: command.description ?? "",
				source: "extension",
			});
		}
		for (const template of session.promptTemplates) {
			commands.push({
				name: template.name,
				description: template.description,
				source: "prompt",
			});
		}
		for (const skill of session.resourceLoader.getSkills().skills) {
			commands.push({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
			});
		}
		return commands.sort((a, b) => a.name.localeCompare(b.name));
	}

	private refreshModels(): void {
		const session = this.runtime.session;
		const current = session.model;
		this.availableModels = session.modelRegistry
			.getAvailable()
			.map(
				(model): SerializedModelOption => ({
					provider: model.provider,
					modelId: model.id,
					label: `${model.provider} / ${model.name || model.id}`,
					current: current?.provider === model.provider && current?.id === model.id,
					reasoning: model.reasoning,
					contextWindow: model.contextWindow,
				}),
			)
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	private isIdle(): boolean {
		const session = this.runtime.session;
		return !session.isStreaming && !session.isCompacting;
	}
}

function serializeEntries(session: AgentSession): SerializedEntry[] {
	return session.sessionManager
		.getBranch()
		.map((entry) => serializeEntry(entry))
		.filter((entry): entry is SerializedEntry => entry !== null);
}

function formatModel(session: AgentSession): string | null {
	const model = session.model;
	return model ? `${model.provider}/${model.id}` : null;
}

function getFirstUserMessage(session: AgentSession): string | undefined {
	for (const entry of session.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message as unknown;
		if (!isRecord(message) || getString(message, "role") !== "user") continue;
		const serialized = serializeAgentMessage(message);
		return serialized.text ? serialized.text.slice(0, 64) : undefined;
	}
	return undefined;
}

function isUiThinkingLevel(level: string): level is ThinkingLevel {
	return THINKING_LEVELS.includes(level as ThinkingLevel);
}

export function parseSendPromptRequest(value: unknown): SendPromptRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const message = getString(value, "message")?.trim();
	if (!message) throw new Error("message is required");
	const mode = getString(value, "mode");
	return {
		sessionId: getString(value, "sessionId"),
		message,
		mode: mode === "steer" || mode === "followUp" ? mode : "auto",
	};
}

export function parseSessionRequest(value: unknown): SessionRequest {
	if (!isRecord(value)) return { sessionId: undefined };
	return { sessionId: getString(value, "sessionId") };
}

export function parseResumeSessionRequest(value: unknown): ResumeSessionRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const path = getString(value, "path")?.trim();
	if (!path) throw new Error("path is required");
	return { path };
}

export function parseSelectSessionRequest(value: unknown): SelectSessionRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const sessionId = getString(value, "sessionId")?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	return { sessionId };
}

export function parseDialogResponseRequest(value: unknown): DialogResponseRequest {
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

export function parseSettingsUpdateRequest(value: unknown): SettingsUpdateRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const action = getString(value, "action");
	if (
		action !== "setModel" &&
		action !== "setThinkingLevel" &&
		action !== "setSteeringMode" &&
		action !== "setFollowUpMode" &&
		action !== "setAutoCompaction"
	) {
		throw new Error("Unsupported settings action");
	}
	const thinkingLevel = getString(value, "thinkingLevel");
	const parsedThinkingLevel: ThinkingLevel | undefined =
		thinkingLevel !== undefined && isUiThinkingLevel(thinkingLevel) ? thinkingLevel : undefined;
	const mode = getString(value, "mode");
	return {
		sessionId: getString(value, "sessionId"),
		action,
		provider: getString(value, "provider"),
		modelId: getString(value, "modelId"),
		thinkingLevel: parsedThinkingLevel,
		mode: isQueueMode(mode) ? mode : undefined,
		enabled: getBoolean(value, "enabled"),
	};
}

export function parseTreeNavigateRequest(value: unknown): TreeNavigateRequest {
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

export function parseForkRequest(value: unknown): ForkRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const entryId = getString(value, "entryId")?.trim();
	if (!entryId) throw new Error("entryId is required");
	return {
		sessionId: getString(value, "sessionId"),
		entryId,
		position: getString(value, "position") === "at" ? "at" : "before",
	};
}

export function parseLabelRequest(value: unknown): LabelRequest {
	if (!isRecord(value)) throw new Error("Request body must be an object");
	const entryId = getString(value, "entryId")?.trim();
	if (!entryId) throw new Error("entryId is required");
	const label = getString(value, "label")?.trim();
	return {
		sessionId: getString(value, "sessionId"),
		entryId,
		label: label || undefined,
	};
}

function isQueueMode(value: string | undefined): value is QueueMode {
	return value === "all" || value === "one-at-a-time";
}

function normalizeArtifactPath(rawPath: string): string {
	const trimmed = rawPath.trim().replace(/^file:\/\//, "");
	if (!trimmed) throw new Error("path is required");
	if (trimmed.includes("\0")) throw new Error("Invalid artifact path");
	return trimmed.split(/[?#]/, 1)[0];
}

function isInsidePath(basePath: string, filePath: string): boolean {
	const base = resolve(basePath);
	const target = resolve(filePath);
	const rel = relative(base, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function createRuntimeOptions(
	cwd: string,
	continueRecent: boolean,
	sessionPath: string | undefined,
): RuntimeOptions {
	return {
		cwd,
		continueRecent,
		sessionPath,
	};
}
