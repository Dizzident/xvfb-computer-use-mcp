#!/usr/bin/env node
// Test the MCP server with the actual Notepad++ Qt6 application.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/main.js"],
});

const client = new Client({ name: "test-npp", version: "1.0.0" });
await client.connect(transport);

async function callTool(name, args = {}) {
	return await client.callTool({ name, arguments: args });
}

function parseText(result) {
	const textContent = result.content.find((c) => c.type === "text");
	return textContent ? JSON.parse(textContent.text) : null;
}

function saveScreenshot(result, filename) {
	const imgContent = result.content.find((c) => c.type === "image");
	if (imgContent) {
		writeFileSync(filename, Buffer.from(imgContent.data, "base64"));
		console.log(`  Saved screenshot: ${filename}`);
	}
}

try {
	console.log("=== Notepad++ Qt6 Integration Test ===\n");

	// Create session
	const session = parseText(
		await callTool("create_session", { width: 1920, height: 1080 }),
	);
	console.log(`1. Session created: ${session.session_id} on :${session.display}`);

	// Launch Notepad++
	const proc = parseText(
		await callTool("run_in_session", {
			session_id: session.session_id,
			command: "/home/josh/notepad-plus-plus/build/notepad-plus-plus",
		}),
	);
	console.log(`2. Launched Notepad++: PID ${proc.pid}`);

	// Wait for main window
	console.log("3. Waiting for Notepad++ window...");
	const win = parseText(
		await callTool("wait_for_window", {
			session_id: session.session_id,
			title: "Notepad",
			timeout_ms: 15000,
		}),
	);
	if (win.found) {
		console.log(`   Found: "${win.name}" at (${win.x},${win.y}) ${win.width}x${win.height}`);
	} else {
		console.log("   Window NOT found within timeout");
	}

	// Take screenshot
	const shot = await callTool("computer", {
		session_id: session.session_id,
		action: "get_screenshot",
	});
	saveScreenshot(shot, "/tmp/npp-offscreen-test.png");

	// Type some text
	console.log("4. Typing text...");
	await callTool("computer", {
		session_id: session.session_id,
		action: "type",
		text: "Hello from the offscreen MCP server!",
	});

	await new Promise((r) => setTimeout(r, 500));

	// Take another screenshot
	const shot2 = await callTool("computer", {
		session_id: session.session_id,
		action: "get_screenshot",
	});
	saveScreenshot(shot2, "/tmp/npp-offscreen-test-typed.png");

	// Test keyboard shortcut (Ctrl+N for new file)
	console.log("5. Pressing Ctrl+N (new file)...");
	await callTool("computer", {
		session_id: session.session_id,
		action: "key",
		text: "ctrl+n",
	});
	await new Promise((r) => setTimeout(r, 500));

	const shot3 = await callTool("computer", {
		session_id: session.session_id,
		action: "get_screenshot",
	});
	saveScreenshot(shot3, "/tmp/npp-offscreen-test-newfile.png");

	// Cleanup
	await callTool("destroy_session", { session_id: session.session_id });
	console.log("\n6. Session destroyed.");

	console.log("\n=== Test complete! Screenshots saved to /tmp/npp-offscreen-test*.png ===");
} catch (err) {
	console.error("TEST FAILED:", err);
	process.exit(1);
} finally {
	await client.close();
	process.exit(0);
}
