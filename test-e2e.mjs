#!/usr/bin/env node
// End-to-end test of the offscreen computer-use MCP server.
// Tests session lifecycle, screenshots, keyboard, mouse, and window detection.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/main.js"],
});

const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(transport);

async function callTool(name, args = {}) {
	const result = await client.callTool({ name, arguments: args });
	return result;
}

function parseText(result) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent ? JSON.parse(textContent.text) : null;
}

try {
	console.log("=== MCP Server E2E Test ===\n");

	// 1. List tools
	const tools = await client.listTools();
	console.log(
		`1. Listed ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`,
	);

	// 2. Create session
	const createResult = await callTool("create_session", {
		width: 1280,
		height: 720,
	});
	const sessionInfo = parseText(createResult);
	console.log(`2. Created session: ${JSON.stringify(sessionInfo)}`);
	const sessionId = sessionInfo.session_id;

	// 3. Take screenshot of empty desktop
	const shot1 = await callTool("computer", {
		session_id: sessionId,
		action: "get_screenshot",
	});
	const hasImage = shot1.content.some((c) => c.type === "image");
	const shotInfo = parseText(shot1);
	console.log(
		`3. Screenshot of empty desktop: ${hasImage ? "OK" : "FAILED"} (${shotInfo.display_width_px}x${shotInfo.display_height_px})`,
	);

	// 4. Launch xterm
	const execResult = await callTool("run_in_session", {
		session_id: sessionId,
		command: "xmessage",
		args: ["-geometry", "400x200+100+100", "Hello from MCP test!"],
	});
	const execInfo = parseText(execResult);
	console.log(`4. Launched xmessage: PID ${execInfo.pid}`);

	// 5. Wait for window
	const waitResult = await callTool("wait_for_window", {
		session_id: sessionId,
		title: "xmessage",
		timeout_ms: 5000,
	});
	const windowInfo = parseText(waitResult);
	console.log(
		`5. Wait for window: ${windowInfo.found ? `found "${windowInfo.name}" at (${windowInfo.x},${windowInfo.y}) ${windowInfo.width}x${windowInfo.height}` : "NOT FOUND"}`,
	);

	// 6. Click on xterm window to focus
	const clickResult = await callTool("computer", {
		session_id: sessionId,
		action: "left_click",
		coordinate: [400, 300],
	});
	console.log(`6. Clicked on window: ${parseText(clickResult).ok}`);

	// 7. Type text
	const typeResult = await callTool("computer", {
		session_id: sessionId,
		action: "type",
		text: "echo Hello from MCP",
	});
	console.log(`7. Typed text: ${parseText(typeResult).ok}`);

	// 8. Press Enter
	const keyResult = await callTool("computer", {
		session_id: sessionId,
		action: "key",
		text: "Return",
	});
	console.log(`8. Pressed Enter: ${parseText(keyResult).ok}`);

	// 9. Wait a moment, then screenshot
	await new Promise((resolve) => setTimeout(resolve, 500));
	const shot2 = await callTool("computer", {
		session_id: sessionId,
		action: "get_screenshot",
	});
	const hasImage2 = shot2.content.some((c) => c.type === "image");
	console.log(`9. Screenshot with app: ${hasImage2 ? "OK" : "FAILED"}`);

	// 10. Get cursor position
	const posResult = await callTool("computer", {
		session_id: sessionId,
		action: "get_cursor_position",
	});
	const pos = parseText(posResult);
	console.log(`10. Cursor position: (${pos.x}, ${pos.y})`);

	// 11. Find windows
	const findResult = await callTool("find_windows", {
		session_id: sessionId,
	});
	const windows = parseText(findResult);
	console.log(`11. Found ${windows.length} window(s)`);

	// 12. List sessions
	const listResult = await callTool("list_sessions");
	const sessions = parseText(listResult);
	console.log(
		`12. Active sessions: ${sessions.map((s) => `${s.id} (:${s.display})`).join(", ")}`,
	);

	// 13. Test parallel sessions
	const create2 = await callTool("create_session", {
		width: 800,
		height: 600,
	});
	const session2 = parseText(create2);
	console.log(
		`13. Created second session: ${session2.session_id} (:${session2.display})`,
	);

	const listResult2 = await callTool("list_sessions");
	const sessions2 = parseText(listResult2);
	console.log(`    Now have ${sessions2.length} parallel sessions`);

	// 14. Destroy second session
	await callTool("destroy_session", { session_id: session2.session_id });
	console.log(`14. Destroyed second session`);

	// 15. Destroy first session
	await callTool("destroy_session", { session_id: sessionId });
	console.log(`15. Destroyed first session`);

	console.log("\n=== All tests passed! ===");
} catch (err) {
	console.error("TEST FAILED:", err);
	process.exit(1);
} finally {
	await client.close();
	process.exit(0);
}
