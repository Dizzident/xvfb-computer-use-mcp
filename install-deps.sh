#!/bin/bash
# Install system dependencies for the offscreen computer-use MCP server.
# Supports Arch Linux (pacman), Debian/Ubuntu (apt), and Fedora (dnf).

set -e

PACKAGES_PACMAN="xorg-server-xvfb xdotool ffmpeg xorg-xdpyinfo openbox"
PACKAGES_APT="xvfb xdotool ffmpeg x11-utils openbox"
PACKAGES_DNF="xorg-x11-server-Xvfb xdotool ffmpeg xdpyinfo openbox"

if command -v pacman &>/dev/null; then
    echo "Detected Arch Linux (pacman)"
    sudo pacman -S --needed --noconfirm $PACKAGES_PACMAN
elif command -v apt-get &>/dev/null; then
    echo "Detected Debian/Ubuntu (apt)"
    sudo apt-get update
    sudo apt-get install -y $PACKAGES_APT
elif command -v dnf &>/dev/null; then
    echo "Detected Fedora (dnf)"
    sudo dnf install -y $PACKAGES_DNF
else
    echo "Unsupported package manager. Please install manually:"
    echo "  - Xvfb (X virtual framebuffer)"
    echo "  - xdotool (X11 automation)"
    echo "  - ffmpeg (screenshot capture)"
    echo "  - xdpyinfo (display info, optional)"
    echo "  - openbox (window manager, optional)"
    exit 1
fi

echo ""
echo "System dependencies installed. Now install Node.js dependencies:"
echo "  cd tools/computer-use-mcp && npm install && npm run build"
