import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import {
	createRuntimeOptions,
	parseDialogResponseRequest,
	parseForkRequest,
	parseLabelRequest,
	parseResumeSessionRequest,
	parseSelectSessionRequest,
	parseSendPromptRequest,
	parseSessionRequest,
	parseSettingsUpdateRequest,
	parseTreeNavigateRequest,
	WebRuntime,
} from "./runtime.ts";
import { INDEX_HTML } from "./static.ts";
import type { CliOptions, ServerUrls, StartedServer, WebSessionSnapshot } from "./types.ts";

const REQUEST_BODY_LIMIT = 512 * 1024;
const SSE_KEEPALIVE_MS = 15_000;
const PORT_SCAN_LIMIT = 20;

export async function startWebServer(options: CliOptions): Promise<StartedServer> {
	const token = options.tokenEnabled ? (options.token ?? randomBytes(18).toString("base64url")) : undefined;
	const runtime = await WebRuntime.create(
		createRuntimeOptions(options.cwd, options.continueRecent, options.sessionPath),
	);
	const server = createServer((request, response) => {
		void handleRequest(runtime, token, request, response);
	});
	const port = await listen(server, options.host, options.port);
	const urls = getDisplayUrls(options.host, port, token);
	return {
		port,
		urls,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

async function handleRequest(
	runtime: WebRuntime,
	token: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (!isAuthorized(request, url, token)) {
		sendJson(response, 401, { error: "Unauthorized" });
		return;
	}

	try {
		if (request.method === "GET" && url.pathname === "/") {
			sendHtml(response, INDEX_HTML);
			return;
		}
		if (request.method === "GET" && url.pathname === "/api/state") {
			sendJson(response, 200, runtime.getSnapshot());
			return;
		}
		if (request.method === "GET" && url.pathname === "/events") {
			handleEvents(runtime, request, response);
			return;
		}
		if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/artifact") {
			await handleArtifact(runtime, url, response, request.method === "HEAD");
			return;
		}
		if (request.method === "GET" && url.pathname === "/api/artifact-info") {
			await handleArtifactInfo(runtime, url, response);
			return;
		}
		if (request.method === "POST") {
			await handlePost(runtime, url.pathname, await readJson(request));
			sendJson(response, 200, { ok: true });
			return;
		}
		sendJson(response, 404, { error: "Not found" });
	} catch (error) {
		sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
	}
}

async function handleArtifact(
	runtime: WebRuntime,
	url: URL,
	response: ServerResponse,
	headOnly: boolean,
): Promise<void> {
	const rawPath = url.searchParams.get("path");
	if (!rawPath) {
		sendJson(response, 400, { error: "path is required" });
		return;
	}
	const artifact = await runtime.resolveArtifact(url.searchParams.get("sessionId") ?? undefined, rawPath);
	const headers: Record<string, string | number> = {
		"content-type": artifact.contentType,
		"content-length": artifact.size,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	};
	response.writeHead(200, headers);
	if (headOnly) {
		response.end();
		return;
	}
	createReadStream(artifact.filePath).pipe(response);
}

async function handleArtifactInfo(runtime: WebRuntime, url: URL, response: ServerResponse): Promise<void> {
	const rawPath = url.searchParams.get("path");
	if (!rawPath) {
		sendJson(response, 400, { error: "path is required" });
		return;
	}
	const artifact = await runtime.resolveArtifact(url.searchParams.get("sessionId") ?? undefined, rawPath);
	sendJson(response, 200, {
		contentType: artifact.contentType,
		size: artifact.size,
		isHtml: artifact.isHtml,
	});
}

async function handlePost(runtime: WebRuntime, path: string, body: unknown): Promise<void> {
	if (path === "/api/sessions") {
		await runtime.createSession();
		return;
	}
	if (path === "/api/resume") {
		await runtime.resumeSession(parseResumeSessionRequest(body));
		return;
	}
	if (path === "/api/select-session") {
		runtime.selectSession(parseSelectSessionRequest(body));
		return;
	}
	if (path === "/api/send") {
		await runtime.sendPrompt(parseSendPromptRequest(body));
		return;
	}
	if (path === "/api/abort") {
		await runtime.abort(parseSessionRequest(body));
		return;
	}
	if (path === "/api/compact") {
		await runtime.compact(parseSessionRequest(body));
		return;
	}
	if (path === "/api/settings") {
		await runtime.updateSettings(parseSettingsUpdateRequest(body));
		return;
	}
	if (path === "/api/tree-navigate") {
		await runtime.navigateTree(parseTreeNavigateRequest(body));
		return;
	}
	if (path === "/api/fork") {
		await runtime.fork(parseForkRequest(body));
		return;
	}
	if (path === "/api/label") {
		runtime.label(parseLabelRequest(body));
		return;
	}
	if (path === "/api/dialog-response") {
		runtime.respondToDialog(parseDialogResponseRequest(body));
		return;
	}
	if (path === "/api/history/refresh") {
		await runtime.refreshHistory();
		return;
	}
	throw new Error(`Unknown endpoint: ${path}`);
}

function handleEvents(runtime: WebRuntime, request: IncomingMessage, response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});

	const send = (snapshot: WebSessionSnapshot): void => {
		response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
	};
	const unsubscribe = runtime.subscribe(send);
	const interval = setInterval(() => {
		response.write(": keepalive\n\n");
	}, SSE_KEEPALIVE_MS);

	request.on("close", () => {
		clearInterval(interval);
		unsubscribe();
	});
}

function readJson(request: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			size += chunk.byteLength;
			if (size > REQUEST_BODY_LIMIT) {
				reject(new Error("Request body too large"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("Invalid JSON body"));
			}
		});
		request.on("error", reject);
	});
}

function isAuthorized(request: IncomingMessage, url: URL, token: string | undefined): boolean {
	if (!token) return true;
	const header = request.headers["x-pi-web-token"];
	return url.searchParams.get("token") === token || header === token;
}

function sendHtml(response: ServerResponse, html: string): void {
	response.writeHead(200, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(html);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
}

function listen(server: Server, host: string, preferredPort: number): Promise<number> {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const tryPort = (port: number): void => {
			const onError = (error: NodeJS.ErrnoException): void => {
				server.off("listening", onListening);
				if (error.code === "EADDRINUSE" && attempts < PORT_SCAN_LIMIT) {
					attempts++;
					tryPort(port + 1);
					return;
				}
				reject(error);
			};
			const onListening = (): void => {
				server.off("error", onError);
				const address = server.address() as AddressInfo;
				resolve(address.port);
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, host);
		};
		tryPort(preferredPort);
	});
}

function getDisplayUrls(host: string, port: number, token: string | undefined): ServerUrls {
	const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : "";
	const localUrl = `http://127.0.0.1:${port}/${tokenQuery}`;
	if (host !== "0.0.0.0" && host !== "::") {
		const url = `http://${formatUrlHost(host)}:${port}/${tokenQuery}`;
		return {
			localUrl: host === "127.0.0.1" || host === "localhost" ? localUrl : url,
			lanUrls: [],
		};
	}

	return {
		localUrl,
		lanUrls: getLanHosts().map((address) => `http://${formatUrlHost(address)}:${port}/${tokenQuery}`),
	};
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
	return [...new Set(hosts)].sort();
}

function formatUrlHost(host: string): string {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
