#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

function setupSignalHandlers(cleanup: () => Promise<void>): void {
	process.on("SIGINT", async () => {
		await cleanup();
		process.exit(0);
	});
	process.on("SIGTERM", async () => {
		await cleanup();
		process.exit(0);
	});
}

(async () => {
	const server = createServer();
	setupSignalHandlers(async () => server.close());

	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Offscreen Computer Use MCP server running on stdio");
	console.error("Create a session with create_session to begin.");
})();
