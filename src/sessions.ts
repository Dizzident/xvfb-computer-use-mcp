import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import sharp from "sharp";

const execAsync = promisify(exec);

export interface SessionOptions {
	width?: number;
	height?: number;
	colorDepth?: number;
	windowManager?: boolean;
}

export interface ProcessInfo {
	pid: number;
	command: string;
	alive: boolean;
}

export interface Session {
	id: string;
	display: number;
	width: number;
	height: number;
	colorDepth: number;
	xvfbProcess: ChildProcess;
	wmProcess?: ChildProcess;
	appProcesses: Map<number, { command: string; process: ChildProcess }>;
}

export interface WindowInfo {
	windowId: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

// Claude API image size limits
const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1.15 * 1024 * 1024;

function getApiScaleFactor(width: number, height: number): number {
	const longEdge = Math.max(width, height);
	const totalPixels = width * height;
	const longEdgeScale =
		longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
	const pixelScale =
		totalPixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / totalPixels) : 1;
	return Math.min(longEdgeScale, pixelScale);
}

export class SessionManager {
	private sessions = new Map<string, Session>();
	private nextId = 1;
	private nextDisplay = 99;

	private allocateDisplay(): number {
		while (existsSync(`/tmp/.X${this.nextDisplay}-lock`)) {
			this.nextDisplay++;
		}
		const display = this.nextDisplay;
		this.nextDisplay++;
		return display;
	}

	async createSession(opts: SessionOptions = {}): Promise<Session> {
		const width = opts.width ?? 1920;
		const height = opts.height ?? 1080;
		const colorDepth = opts.colorDepth ?? 24;
		const display = this.allocateDisplay();
		const id = `s${this.nextId++}`;

		// Start Xvfb
		const xvfbProcess = spawn(
			"Xvfb",
			[
				`:${display}`,
				"-screen",
				"0",
				`${width}x${height}x${colorDepth}`,
				"-ac",
				"+extension",
				"GLX",
				"+render",
				"-noreset",
			],
			{
				stdio: "ignore",
				detached: true,
			},
		);

		// Wait for Xvfb to be ready
		await this.waitForDisplay(display);

		const session: Session = {
			id,
			display,
			width,
			height,
			colorDepth,
			xvfbProcess,
			appProcesses: new Map(),
		};

		// Optionally start a lightweight window manager
		if (opts.windowManager !== false) {
			try {
				const wmProcess = spawn("openbox", [], {
					stdio: "ignore",
					detached: true,
					env: { ...process.env, DISPLAY: `:${display}` },
				});
				session.wmProcess = wmProcess;
				// Give the WM a moment to start
				await new Promise((resolve) => setTimeout(resolve, 200));
			} catch {
				// openbox not available, continue without WM
				console.error(
					`[${id}] Window manager (openbox) not available, continuing without one`,
				);
			}
		}

		this.sessions.set(id, session);
		console.error(
			`[${id}] Created session on :${display} (${width}x${height}x${colorDepth})`,
		);
		return session;
	}

	private async waitForDisplay(
		display: number,
		timeout = 5000,
	): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			try {
				await execAsync(`xdpyinfo -display :${display}`, {
					timeout: 1000,
				});
				return;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		// Final check — even if xdpyinfo isn't installed, check if the lock
		// file appeared (means Xvfb started)
		if (existsSync(`/tmp/.X${display}-lock`)) {
			// Give it a tiny bit more time to be fully ready
			await new Promise((resolve) => setTimeout(resolve, 300));
			return;
		}
		throw new Error(
			`Xvfb display :${display} did not become ready within ${timeout}ms`,
		);
	}

	async destroySession(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session '${id}' not found`);
		}

		// Kill all app processes
		for (const [pid, info] of session.appProcesses) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Already dead
			}
		}

		// Kill window manager
		if (session.wmProcess?.pid) {
			try {
				process.kill(session.wmProcess.pid, "SIGTERM");
			} catch {
				// Already dead
			}
		}

		// Kill Xvfb
		if (session.xvfbProcess.pid) {
			try {
				process.kill(session.xvfbProcess.pid, "SIGTERM");
			} catch {
				// Already dead
			}
		}

		this.sessions.delete(id);
		console.error(`[${id}] Destroyed session on :${session.display}`);
	}

	getSession(id: string): Session {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session '${id}' not found`);
		}
		return session;
	}

	/**
	 * Resolve a session ID. If id is provided, use it.
	 * If omitted and only one session exists, use that.
	 * Otherwise throw.
	 */
	resolveSession(id?: string): Session {
		if (id) {
			return this.getSession(id);
		}
		if (this.sessions.size === 1) {
			return this.sessions.values().next().value!;
		}
		if (this.sessions.size === 0) {
			throw new Error(
				"No sessions exist. Create one with create_session first.",
			);
		}
		throw new Error(
			`Multiple sessions exist (${[...this.sessions.keys()].join(", ")}). Specify session_id.`,
		);
	}

	listSessions(): Array<{
		id: string;
		display: number;
		width: number;
		height: number;
		processes: ProcessInfo[];
	}> {
		return [...this.sessions.values()].map((s) => ({
			id: s.id,
			display: s.display,
			width: s.width,
			height: s.height,
			processes: [...s.appProcesses.entries()].map(([pid, info]) => ({
				pid,
				command: info.command,
				alive: !info.process.killed && info.process.exitCode === null,
			})),
		}));
	}

	async execInSession(
		id: string,
		command: string,
		args: string[] = [],
		env: Record<string, string> = {},
	): Promise<{ pid: number }> {
		const session = this.getSession(id);

		const child = spawn(command, args, {
			stdio: "ignore",
			detached: true,
			env: {
				...process.env,
				DISPLAY: `:${session.display}`,
				QT_QPA_PLATFORM: "xcb",
				...env,
			},
		});

		const cmdStr = [command, ...args].join(" ");

		// Wait briefly to catch immediate spawn errors (e.g. ENOENT)
		await new Promise<void>((resolve, reject) => {
			child.on("error", (err) => {
				reject(new Error(`Failed to launch '${cmdStr}': ${err.message}`));
			});
			// If no error within 100ms, assume successful spawn
			setTimeout(resolve, 100);
		});

		const pid = child.pid!;
		session.appProcesses.set(pid, { command: cmdStr, process: child });

		child.on("exit", () => {
			// Keep in map for status tracking but mark as exited
		});

		console.error(`[${id}] Launched: ${cmdStr} (PID ${pid})`);
		return { pid };
	}

	// --- Input actions via xdotool ---

	/**
	 * Run xdotool with proper argument passing (no shell escaping needed).
	 * Uses spawn instead of exec to safely handle arbitrary text.
	 */
	private xdotool(session: Session, ...args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn("xdotool", args, {
				env: { ...process.env, DISPLAY: `:${session.display}` },
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			child.stdout!.on("data", (data: Buffer) => {
				stdout += data.toString();
			});
			child.stderr!.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			const timer = setTimeout(() => {
				child.kill("SIGTERM");
				reject(new Error("xdotool timed out after 5s"));
			}, 5000);

			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) {
					resolve(stdout.trim());
				} else {
					reject(
						new Error(
							`xdotool exited with code ${code}: ${stderr.trim()}`,
						),
					);
				}
			});
		});
	}

	async sendKey(session: Session, key: string): Promise<void> {
		// xdotool uses '+' for combos (e.g. ctrl+shift+s)
		await this.xdotool(session, "key", "--clearmodifiers", key);
	}

	async sendType(session: Session, text: string): Promise<void> {
		// Use spawn-based xdotool — no shell escaping needed
		await this.xdotool(
			session,
			"type",
			"--clearmodifiers",
			"--delay",
			"12",
			"--",
			text,
		);
	}

	async mouseMove(session: Session, x: number, y: number): Promise<void> {
		await this.xdotool(session, "mousemove", "--sync", String(x), String(y));
	}

	async mouseClick(
		session: Session,
		button: number,
		x?: number,
		y?: number,
	): Promise<void> {
		if (x !== undefined && y !== undefined) {
			await this.mouseMove(session, x, y);
		}
		await this.xdotool(session, "click", String(button));
	}

	async mouseDoubleClick(
		session: Session,
		x?: number,
		y?: number,
	): Promise<void> {
		if (x !== undefined && y !== undefined) {
			await this.mouseMove(session, x, y);
		}
		await this.xdotool(session, "click", "--repeat", "2", "--delay", "50", "1");
	}

	async mouseDrag(session: Session, x: number, y: number): Promise<void> {
		await this.xdotool(
			session,
			"mousedown",
			"1",
			"mousemove",
			"--sync",
			String(x),
			String(y),
			"mouseup",
			"1",
		);
	}

	async mouseScroll(
		session: Session,
		direction: string,
		amount: number,
		x?: number,
		y?: number,
	): Promise<void> {
		if (x !== undefined && y !== undefined) {
			await this.mouseMove(session, x, y);
		}
		// xdotool scroll: button 4=up, 5=down, 6=left, 7=right
		const buttonMap: Record<string, number> = {
			up: 4,
			down: 5,
			left: 6,
			right: 7,
		};
		const button = buttonMap[direction.toLowerCase()];
		if (!button) {
			throw new Error(
				`Invalid scroll direction: ${direction}. Use up/down/left/right.`,
			);
		}
		// Convert pixel amount to click count (~30px per click)
		const clicks = Math.max(1, Math.round(amount / 30));
		await this.xdotool(
			session,
			"click",
			"--repeat",
			String(clicks),
			"--delay",
			"10",
			String(button),
		);
	}

	async getCursorPosition(
		session: Session,
	): Promise<{ x: number; y: number }> {
		const output = await this.xdotool(session, "getmouselocation");
		// Output: "x:123 y:456 screen:0 window:12345"
		const xMatch = output.match(/x:(\d+)/);
		const yMatch = output.match(/y:(\d+)/);
		return {
			x: xMatch ? parseInt(xMatch[1]) : 0,
			y: yMatch ? parseInt(yMatch[1]) : 0,
		};
	}

	// --- Screenshots via ffmpeg ---

	async screenshot(
		session: Session,
	): Promise<{ base64: string; width: number; height: number }> {
		const tmpFile = `/tmp/mcp_screenshot_${session.id}_${Date.now()}.png`;

		try {
			await execAsync(
				`ffmpeg -f x11grab -video_size ${session.width}x${session.height} ` +
					`-i :${session.display} -vframes 1 -y "${tmpFile}"`,
				{ timeout: 5000 },
			);
		} catch (e: any) {
			throw new Error(`Screenshot failed: ${e.message}`);
		}

		if (!existsSync(tmpFile)) {
			throw new Error("Screenshot file not created");
		}

		const pngBuffer = readFileSync(tmpFile);
		try {
			unlinkSync(tmpFile);
		} catch {
			// ignore
		}

		const scaleFactor = getApiScaleFactor(session.width, session.height);
		const imageWidth =
			scaleFactor < 1
				? Math.floor(session.width * scaleFactor)
				: session.width;
		const imageHeight =
			scaleFactor < 1
				? Math.floor(session.height * scaleFactor)
				: session.height;

		let finalBuffer: Buffer;
		if (scaleFactor < 1) {
			finalBuffer = await sharp(pngBuffer)
				.resize(imageWidth, imageHeight)
				.png({ compressionLevel: 3 })
				.toBuffer();
		} else {
			finalBuffer = pngBuffer;
		}

		return {
			base64: finalBuffer.toString("base64"),
			width: imageWidth,
			height: imageHeight,
		};
	}

	// --- Window management ---

	async findWindows(
		session: Session,
		titlePattern?: string,
	): Promise<WindowInfo[]> {
		try {
			let windowIds: string[];
			if (titlePattern) {
				const output = await this.xdotool(
					session,
					"search",
					"--name",
					titlePattern,
				);
				windowIds = output.split("\n").filter(Boolean);
			} else {
				// Search for visible windows only (--onlyvisible filters out WM internals)
				const output = await this.xdotool(
					session,
					"search",
					"--onlyvisible",
					"--name",
					"",
				);
				windowIds = output.split("\n").filter(Boolean);
			}

			const windows: WindowInfo[] = [];
			for (const wid of windowIds) {
				try {
					const geoOutput = await this.xdotool(
						session,
						"getwindowgeometry",
						"--shell",
						wid,
					);
					const nameOutput = await this.xdotool(
						session,
						"getwindowname",
						wid,
					);

					const xMatch = geoOutput.match(/X=(\d+)/);
					const yMatch = geoOutput.match(/Y=(\d+)/);
					const wMatch = geoOutput.match(/WIDTH=(\d+)/);
					const hMatch = geoOutput.match(/HEIGHT=(\d+)/);

					windows.push({
						windowId: wid,
						name: nameOutput,
						x: xMatch ? parseInt(xMatch[1]) : 0,
						y: yMatch ? parseInt(yMatch[1]) : 0,
						width: wMatch ? parseInt(wMatch[1]) : 0,
						height: hMatch ? parseInt(hMatch[1]) : 0,
					});
				} catch {
					// Window may have closed between search and query
				}
			}
			return windows;
		} catch {
			return [];
		}
	}

	async waitForWindow(
		session: Session,
		titlePattern: string,
		timeout = 10000,
	): Promise<WindowInfo | null> {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const windows = await this.findWindows(session, titlePattern);
			if (windows.length > 0) {
				return windows[0];
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return null;
	}

	// --- Cleanup ---

	async destroyAll(): Promise<void> {
		for (const id of [...this.sessions.keys()]) {
			try {
				await this.destroySession(id);
			} catch {
				// Best effort
			}
		}
	}
}
