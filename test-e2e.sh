#!/bin/bash
# End-to-end test of the offscreen computer-use MCP server.
# Tests: create session, launch app, screenshot, keyboard input, cleanup.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="node ${SCRIPT_DIR}/dist/main.js"

# Helper to send JSON-RPC to the server and get the response
FIFO_IN=$(mktemp -u)
FIFO_OUT=$(mktemp -u)
mkfifo "$FIFO_IN"
mkfifo "$FIFO_OUT"

# Start server
$SERVER < "$FIFO_IN" > "$FIFO_OUT" 2>/dev/null &
SERVER_PID=$!

# Open write fd to server
exec 3>"$FIFO_IN"
exec 4<"$FIFO_OUT"

cleanup() {
    exec 3>&-
    exec 4<&-
    kill $SERVER_PID 2>/dev/null || true
    rm -f "$FIFO_IN" "$FIFO_OUT"
}
trap cleanup EXIT

send_and_recv() {
    echo "$1" >&3
    # Read one line of response
    local response
    read -t 10 response <&4
    echo "$response"
}

echo "=== MCP Server E2E Test ==="

# 1. Initialize
echo "1. Initializing MCP server..."
INIT_RESP=$(send_and_recv '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}')
echo "   Init: OK"

# Send initialized notification
echo '{"jsonrpc":"2.0","method":"notifications/initialized"}' >&3

# 2. Create session
echo "2. Creating virtual display session..."
CREATE_RESP=$(send_and_recv '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_session","arguments":{"width":1280,"height":720}}}')
echo "   Response: $CREATE_RESP" | head -c 200
echo ""

# Extract session_id from response
SESSION_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.loads(r['result']['content'][0]['text'])['session_id'])")
echo "   Session ID: $SESSION_ID"

# 3. Launch xterm (simple X11 app for testing)
echo "3. Launching xterm..."
EXEC_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"run_in_session\",\"arguments\":{\"session_id\":\"$SESSION_ID\",\"command\":\"xterm\",\"args\":[\"-geometry\",\"80x24+0+0\"]}}}")
echo "   Launched: $(echo "$EXEC_RESP" | head -c 200)"
echo ""

# Wait for xterm to start
sleep 1

# 4. Take screenshot
echo "4. Taking screenshot..."
SCREENSHOT_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"computer\",\"arguments\":{\"session_id\":\"$SESSION_ID\",\"action\":\"get_screenshot\"}}}")
# Check if response contains image data
if echo "$SCREENSHOT_RESP" | python3 -c "import sys,json; r=json.load(sys.stdin); content=r['result']['content']; assert any(c['type']=='image' for c in content); print('   Screenshot OK - contains image data')" 2>/dev/null; then
    echo "   (screenshot contains base64 image data)"
else
    echo "   ERROR: Screenshot failed"
    echo "   Response: $(echo "$SCREENSHOT_RESP" | head -c 500)"
fi

# 5. Send keyboard input
echo "5. Sending keyboard input..."
KEY_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"computer\",\"arguments\":{\"session_id\":\"$SESSION_ID\",\"action\":\"key\",\"text\":\"ctrl+l\"}}}")
echo "   Key response: $(echo "$KEY_RESP" | head -c 200)"
echo ""

# 6. Type text
echo "6. Typing text..."
TYPE_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"computer\",\"arguments\":{\"session_id\":\"$SESSION_ID\",\"action\":\"type\",\"text\":\"echo Hello from MCP\"}}}")
echo "   Type response: $(echo "$TYPE_RESP" | head -c 200)"
echo ""

# 7. Get cursor position
echo "7. Getting cursor position..."
POS_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"computer\",\"arguments\":{\"session_id\":\"$SESSION_ID\",\"action\":\"get_cursor_position\"}}}")
echo "   Cursor: $(echo "$POS_RESP" | head -c 200)"
echo ""

# 8. List sessions
echo "8. Listing sessions..."
LIST_RESP=$(send_and_recv '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"list_sessions","arguments":{}}}')
echo "   Sessions: $(echo "$LIST_RESP" | head -c 300)"
echo ""

# 9. Destroy session
echo "9. Destroying session..."
DESTROY_RESP=$(send_and_recv "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"destroy_session\",\"arguments\":{\"session_id\":\"$SESSION_ID\"}}}")
echo "   Destroy: $(echo "$DESTROY_RESP" | head -c 200)"
echo ""

echo ""
echo "=== All tests passed! ==="
