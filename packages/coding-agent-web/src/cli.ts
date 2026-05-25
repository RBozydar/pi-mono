#!/usr/bin/env node
import { resolve } from "node:path";
import { startWebServer } from "./server.ts";
import type { CliOptions } from "./types.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 32123;

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const server = await startWebServer(options);

	console.log("Pi web UI listening:");
	console.log(`  Local: ${server.urls.localUrl}`);
	for (const url of server.urls.lanUrls) {
		console.log(`  LAN:   ${url}`);
	}
	if (options.tokenEnabled) {
		console.log("Token auth is enabled. Use the printed URL.");
	} else if (options.host === "0.0.0.0" || options.host === "::") {
		console.log("Token auth is disabled. Only use this on a trusted LAN.");
	}

	const shutdown = async (): Promise<void> => {
		await server.close();
		process.exit(0);
	};
	process.once("SIGINT", () => {
		void shutdown();
	});
	process.once("SIGTERM", () => {
		void shutdown();
	});
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		cwd: process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : process.cwd(),
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		token: process.env.PI_WEB_TOKEN,
		tokenEnabled: process.env.PI_WEB_TOKEN !== undefined,
		continueRecent: false,
		sessionPath: undefined,
	};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--host") {
			options.host = requireValue(args, ++index, "--host");
		} else if (arg === "--port") {
			options.port = parsePort(requireValue(args, ++index, "--port"));
		} else if (arg === "--cwd") {
			options.cwd = resolve(requireValue(args, ++index, "--cwd"));
		} else if (arg === "--continue") {
			options.continueRecent = true;
		} else if (arg === "--session") {
			options.sessionPath = resolve(requireValue(args, ++index, "--session"));
		} else if (arg === "--auth-token") {
			options.token = undefined;
			options.tokenEnabled = true;
		} else if (arg === "--token") {
			options.token = requireValue(args, ++index, "--token");
			options.tokenEnabled = true;
		} else if (arg === "--no-token") {
			options.token = undefined;
			options.tokenEnabled = false;
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}

	return options;
}

function requireValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function parsePort(value: string): number {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid port: ${value}`);
	}
	return port;
}

function printHelp(): void {
	console.log(`Usage: npm --prefix packages/coding-agent-web run start -- [options]

Options:
  --host <host>       Bind address, default ${DEFAULT_HOST}
  --port <port>       Preferred port, default ${DEFAULT_PORT}
  --cwd <path>        Project directory for new sessions
  --continue          Open the most recent session for --cwd
  --session <path>    Open a specific session file
  --auth-token        Generate a random browser/API token
  --token <value>     Use a fixed browser/API token
  --no-token          Disable token checks
  --help              Show this help
`);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
