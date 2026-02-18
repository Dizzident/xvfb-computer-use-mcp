import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from "./sessions.js";

export function createServer(): McpServer {
	const server = new McpServer({
		name: "computer-use-offscreen",
		version: "1.0.0",
	});

	const manager = new SessionManager();

	// --- Session management tools ---

	server.registerTool(
		"create_session",
		{
			title: "Create Virtual Display",
			description:
				"Create a new offscreen virtual display (Xvfb) for isolated application testing. " +
				"Each session gets its own display, mouse, and keyboard. " +
				"Multiple sessions can run in parallel for concurrent testing.",
			inputSchema: z
				.object({
					width: z
						.number()
						.default(1920)
						.describe("Display width in pixels"),
					height: z
						.number()
						.default(1080)
						.describe("Display height in pixels"),
					color_depth: z
						.number()
						.default(24)
						.describe("Color depth (16, 24, or 32)"),
					window_manager: z
						.boolean()
						.default(true)
						.describe(
							"Start openbox window manager (needed for proper window positioning/sizing)",
						),
				})
				.strict(),
			annotations: { readOnlyHint: false },
		},
		async ({ width, height, color_depth, window_manager }) => {
			const session = await manager.createSession({
				width,
				height,
				colorDepth: color_depth,
				windowManager: window_manager,
			});
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								session_id: session.id,
								display: session.display,
								width: session.width,
								height: session.height,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"destroy_session",
		{
			title: "Destroy Virtual Display",
			description:
				"Destroy a virtual display session and kill all processes running in it.",
			inputSchema: z
				.object({
					session_id: z.string().describe("Session ID to destroy"),
				})
				.strict(),
			annotations: { readOnlyHint: false },
		},
		async ({ session_id }) => {
			await manager.destroySession(session_id);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ ok: true, destroyed: session_id }),
					},
				],
			};
		},
	);

	server.registerTool(
		"list_sessions",
		{
			title: "List Virtual Displays",
			description:
				"List all active virtual display sessions and their running processes.",
			inputSchema: z.object({}).strict(),
			annotations: { readOnlyHint: true },
		},
		async () => {
			const sessions = manager.listSessions();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(sessions, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		"run_in_session",
		{
			title: "Run Command in Session",
			description:
				"Launch a process inside a virtual display session. The process runs in the background. " +
				"Use this to start applications for testing. " +
				"Environment variables DISPLAY and QT_QPA_PLATFORM=xcb are set automatically.",
			inputSchema: z
				.object({
					session_id: z
						.string()
						.optional()
						.describe(
							"Session ID (optional if only one session exists)",
						),
					command: z
						.string()
						.describe("Command to run (e.g. ./notepad-plus-plus)"),
					args: z
						.array(z.string())
						.default([])
						.describe("Command arguments"),
					env: z
						.record(z.string(), z.string())
						.default({})
						.describe("Additional environment variables"),
				})
				.strict(),
			annotations: { readOnlyHint: false },
		},
		async ({ session_id, command, args, env }) => {
			const session = manager.resolveSession(session_id);
			const result = await manager.execInSession(
				session.id,
				command,
				args,
				env,
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ pid: result.pid, session_id: session.id },
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"wait_for_window",
		{
			title: "Wait for Window",
			description:
				"Wait for a window with the given title pattern to appear in a session. " +
				"Useful for waiting for an application to start before interacting with it. " +
				"Returns window info (position, size) or null if timeout.",
			inputSchema: z
				.object({
					session_id: z
						.string()
						.optional()
						.describe(
							"Session ID (optional if only one session exists)",
						),
					title: z
						.string()
						.describe(
							"Window title pattern to search for (regex supported)",
						),
					timeout_ms: z
						.number()
						.default(10000)
						.describe(
							"Maximum time to wait in milliseconds (default 10000)",
						),
				})
				.strict(),
			annotations: { readOnlyHint: true },
		},
		async ({ session_id, title, timeout_ms }) => {
			const session = manager.resolveSession(session_id);
			const window = await manager.waitForWindow(
				session,
				title,
				timeout_ms,
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							window
								? { found: true, ...window }
								: { found: false, title, timeout_ms },
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerTool(
		"find_windows",
		{
			title: "Find Windows",
			description:
				"Find all windows in a session, optionally filtering by title pattern. " +
				"Returns window ID, title, position, and size for each match.",
			inputSchema: z
				.object({
					session_id: z
						.string()
						.optional()
						.describe(
							"Session ID (optional if only one session exists)",
						),
					title: z
						.string()
						.optional()
						.describe(
							"Window title pattern to filter by (regex supported)",
						),
				})
				.strict(),
			annotations: { readOnlyHint: true },
		},
		async ({ session_id, title }) => {
			const session = manager.resolveSession(session_id);
			const windows = await manager.findWindows(session, title);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(windows, null, 2),
					},
				],
			};
		},
	);

	// --- Standard computer-use tool ---

	const ActionEnum = z.enum([
		"key",
		"type",
		"mouse_move",
		"left_click",
		"left_click_drag",
		"right_click",
		"middle_click",
		"double_click",
		"scroll",
		"get_screenshot",
		"get_cursor_position",
	]);

	server.registerTool(
		"computer",
		{
			title: "Computer Control",
			description: `Use a mouse and keyboard to interact with a virtual display, and take screenshots.
* This controls an offscreen virtual display (not your physical screen).
* Always prefer using keyboard shortcuts rather than clicking, where possible.
* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions.
* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.
* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element.`,
			inputSchema: z
				.object({
					session_id: z
						.string()
						.optional()
						.describe(
							"Session ID (optional if only one session exists)",
						),
					action: ActionEnum.describe(
						`The action to perform:
* key: Press a key or key-combination (e.g. "ctrl+s", "Return", "alt+F4")
* type: Type a string of text
* get_cursor_position: Get current cursor (x, y) coordinates
* mouse_move: Move cursor to (x, y)
* left_click: Left click (optionally at coordinate)
* left_click_drag: Drag from current position to coordinate
* right_click: Right click (optionally at coordinate)
* middle_click: Middle click (optionally at coordinate)
* double_click: Double-click (optionally at coordinate)
* scroll: Scroll at coordinate. text = "up", "down", "left", "right" with optional ":N" for pixels
* get_screenshot: Capture the virtual display`,
					),
					coordinate: z
						.tuple([z.number(), z.number()])
						.optional()
						.describe(
							"(x, y): pixel coordinates on the virtual display",
						),
					text: z
						.string()
						.optional()
						.describe("Text to type or key command to execute"),
				})
				.strict(),
			annotations: { readOnlyHint: false },
		},
		async ({ session_id, action, coordinate, text }) => {
			const session = manager.resolveSession(session_id);

			// For screenshots, no coordinate scaling needed — the virtual display
			// IS the coordinate space. We do scale screenshots down for the API,
			// so we need to scale coordinates back up.
			const scaleFactor = getScaleFactor(session.width, session.height);

			let scaledCoordinate = coordinate;
			if (coordinate) {
				scaledCoordinate = [
					Math.round(coordinate[0] * scaleFactor),
					Math.round(coordinate[1] * scaleFactor),
				];
				// Clamp to session bounds
				scaledCoordinate[0] = Math.max(
					0,
					Math.min(scaledCoordinate[0], session.width - 1),
				);
				scaledCoordinate[1] = Math.max(
					0,
					Math.min(scaledCoordinate[1], session.height - 1),
				);
			}

			switch (action) {
				case "key": {
					if (!text) throw new Error("text required for key action");
					await manager.sendKey(session, text);
					return jsonResult({ ok: true });
				}
				case "type": {
					if (!text) throw new Error("text required for type action");
					await manager.sendType(session, text);
					return jsonResult({ ok: true });
				}
				case "get_cursor_position": {
					const pos = await manager.getCursorPosition(session);
					// Return in API image space
					return jsonResult({
						x: Math.round(pos.x / scaleFactor),
						y: Math.round(pos.y / scaleFactor),
					});
				}
				case "mouse_move": {
					if (!scaledCoordinate)
						throw new Error("coordinate required for mouse_move");
					await manager.mouseMove(
						session,
						scaledCoordinate[0],
						scaledCoordinate[1],
					);
					return jsonResult({ ok: true });
				}
				case "left_click": {
					await manager.mouseClick(
						session,
						1,
						scaledCoordinate?.[0],
						scaledCoordinate?.[1],
					);
					return jsonResult({ ok: true });
				}
				case "right_click": {
					await manager.mouseClick(
						session,
						3,
						scaledCoordinate?.[0],
						scaledCoordinate?.[1],
					);
					return jsonResult({ ok: true });
				}
				case "middle_click": {
					await manager.mouseClick(
						session,
						2,
						scaledCoordinate?.[0],
						scaledCoordinate?.[1],
					);
					return jsonResult({ ok: true });
				}
				case "double_click": {
					await manager.mouseDoubleClick(
						session,
						scaledCoordinate?.[0],
						scaledCoordinate?.[1],
					);
					return jsonResult({ ok: true });
				}
				case "left_click_drag": {
					if (!scaledCoordinate)
						throw new Error(
							"coordinate required for left_click_drag",
						);
					await manager.mouseDrag(
						session,
						scaledCoordinate[0],
						scaledCoordinate[1],
					);
					return jsonResult({ ok: true });
				}
				case "scroll": {
					if (!scaledCoordinate)
						throw new Error("coordinate required for scroll");
					if (!text)
						throw new Error(
							'text required for scroll (e.g. "down", "up:500")',
						);
					const parts = text.split(":");
					const direction = parts[0]!;
					const amount = parts[1] ? parseInt(parts[1], 10) : 300;
					await manager.mouseScroll(
						session,
						direction,
						amount,
						scaledCoordinate[0],
						scaledCoordinate[1],
					);
					return jsonResult({ ok: true });
				}
				case "get_screenshot": {
					const shot = await manager.screenshot(session);
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									display_width_px: shot.width,
									display_height_px: shot.height,
								}),
							},
							{
								type: "image" as const,
								data: shot.base64,
								mimeType: "image/png" as const,
							},
						],
					};
				}
				default:
					throw new Error(`Unknown action: ${action}`);
			}
		},
	);

	// Register cleanup handler
	const origClose = server.close.bind(server);
	server.close = async () => {
		await manager.destroyAll();
		return origClose();
	};

	return server;
}

// --- Helpers ---

const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1.15 * 1024 * 1024;

/**
 * Get the factor to scale from API image coordinates back to logical display coordinates.
 * If the display is larger than the API limits, we downscale screenshots, so
 * coordinates from Claude are in the smaller image space and need scaling up.
 */
function getScaleFactor(displayWidth: number, displayHeight: number): number {
	const longEdge = Math.max(displayWidth, displayHeight);
	const totalPixels = displayWidth * displayHeight;
	const longEdgeScale =
		longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
	const pixelScale =
		totalPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / totalPixels) : 1;
	const apiScale = Math.min(longEdgeScale, pixelScale);
	// Inverse: API coords * scaleFactor = display coords
	return 1 / apiScale;
}

function jsonResult(data: Record<string, unknown>) {
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify(data, null, 2) },
		],
	};
}
