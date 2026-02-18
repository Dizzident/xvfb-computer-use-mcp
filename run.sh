#!/bin/bash
# Wrapper script to start the offscreen computer-use MCP server.
# Usage: ./run.sh
# Or:    claude mcp add --transport stdio computer-use-offscreen -- /path/to/run.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node "${SCRIPT_DIR}/dist/main.js"
