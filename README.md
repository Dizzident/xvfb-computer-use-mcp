# xvfb-computer-use-mcp

An offscreen computer-use MCP server for headless GUI testing. Uses **Xvfb** (X Virtual Framebuffer) to create isolated virtual displays that don't interfere with your physical desktop.

Built for autonomous E2E testing with Claude Code and other MCP clients.

## Features

- **Offscreen displays** — Tests run in virtual framebuffers, your desktop stays untouched
- **Parallel sessions** — Each session gets its own display (`:99`, `:100`, etc.), enabling concurrent test execution
- **Fast screenshots** — Uses `ffmpeg` x11grab for sub-second capture
- **Full input control** — Keyboard, mouse, scroll, drag via `xdotool`
- **Window detection** — Wait for and find windows by title pattern
- **Process management** — Launch and track application processes per session
- **Automatic cleanup** — Sessions and processes are cleaned up on destroy or server shutdown
- **Qt6 ready** — Automatically sets `QT_QPA_PLATFORM=xcb` for Qt applications

## System Requirements

- Linux (X11 support required)
- Node.js 18+

### System Packages

**Arch Linux:**
```bash
sudo pacman -S xorg-server-xvfb xdotool ffmpeg xorg-xdpyinfo openbox
```

**Debian/Ubuntu:**
```bash
sudo apt install xvfb xdotool ffmpeg x11-utils openbox
```

**Fedora:**
```bash
sudo dnf install xorg-x11-server-Xvfb xdotool ffmpeg xdpyinfo openbox
```

Or run the included script: `./install-deps.sh`

## Installation

```bash
npm install
npm run build
```

## Usage with Claude Code

```bash
claude mcp add --transport stdio computer-use-offscreen -- \
  node /path/to/xvfb-computer-use-mcp/dist/main.js
```

Then in a Claude Code session:

1. **Create a session** — `create_session` with optional width/height
2. **Launch your app** — `run_in_session` with the command
3. **Wait for it** — `wait_for_window` until the app's window appears
4. **Interact** — `computer` tool for screenshots, clicks, keyboard
5. **Clean up** — `destroy_session` when done

## MCP Tools

### Session Management

| Tool | Description |
|------|-------------|
| `create_session` | Create a new Xvfb virtual display (default 1920x1080) |
| `destroy_session` | Destroy a session and kill all its processes |
| `list_sessions` | List all active sessions with process info |
| `run_in_session` | Launch a command inside a session |
| `wait_for_window` | Poll until a window with matching title appears |
| `find_windows` | Find all windows, optionally filtered by title |

### Computer Control

The `computer` tool supports all standard actions:

| Action | Description |
|--------|-------------|
| `get_screenshot` | Capture the virtual display as PNG |
| `key` | Press key combo (e.g. `ctrl+s`, `Return`, `alt+F4`) |
| `type` | Type text string |
| `left_click` | Left click at optional coordinate |
| `right_click` | Right click at optional coordinate |
| `middle_click` | Middle click at optional coordinate |
| `double_click` | Double-click at optional coordinate |
| `mouse_move` | Move cursor to coordinate |
| `left_click_drag` | Drag from current position to coordinate |
| `scroll` | Scroll at coordinate (text: `up`, `down:500`, etc.) |
| `get_cursor_position` | Get current cursor x,y |

All coordinate-based actions auto-scale between API image space and display space.

## Parallel Testing Example

```javascript
// Create two isolated sessions
const s1 = await callTool("create_session", { width: 1280, height: 720 });
const s2 = await callTool("create_session", { width: 1280, height: 720 });

// Launch apps in parallel
await Promise.all([
  callTool("run_in_session", { session_id: "s1", command: "./my-app" }),
  callTool("run_in_session", { session_id: "s2", command: "./my-app" }),
]);

// Each session has independent mouse, keyboard, and display
await callTool("computer", { session_id: "s1", action: "key", text: "ctrl+n" });
await callTool("computer", { session_id: "s2", action: "key", text: "ctrl+o" });

// Screenshots are per-session
const shot1 = await callTool("computer", { session_id: "s1", action: "get_screenshot" });
const shot2 = await callTool("computer", { session_id: "s2", action: "get_screenshot" });
```

## How It Works

1. **Xvfb** creates lightweight virtual X11 displays with no physical monitor
2. **openbox** provides a minimal window manager for proper window management
3. **xdotool** sends keyboard and mouse events to the virtual display
4. **ffmpeg** captures screenshots via X11 screen grab
5. **sharp** resizes screenshots to fit Claude's API image limits

Each session is fully isolated — separate display server, window manager, and input state.

## License

MIT
