#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  FitConnect Backend — Development Startup
#  Usage: bash scripts/dev.sh
#
#  Detects your LAN IP automatically and adds it to
#  ALLOWED_ORIGINS so physical devices can connect.
# ─────────────────────────────────────────────────────────
set -e

PORT=${PORT:-5000}

# Detect LAN IP (works on macOS and Linux)
if command -v ipconfig &>/dev/null; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
elif command -v hostname &>/dev/null; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
else
  LAN_IP=""
fi

ORIGINS="http://localhost:${PORT},http://localhost:3000,http://10.0.2.2:${PORT}"
if [ -n "$LAN_IP" ]; then
  ORIGINS="${ORIGINS},http://${LAN_IP}:${PORT}"
  echo "🌐  LAN IP detected: ${LAN_IP}"
  echo "    Flutter physical device: --dart-define=API_URL=http://${LAN_IP}:${PORT}/api/v1"
fi

echo "🚀  Starting FitConnect API on port ${PORT}"
echo "    ALLOWED_ORIGINS=${ORIGINS}"
echo ""

ALLOWED_ORIGINS="$ORIGINS" npx nodemon src/server.js
