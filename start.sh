#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "--- Shell Script (start.sh) v4.0 (socat proxy) has taken control ---"
echo "User: $(whoami)"
echo "Working directory: $(pwd)"

# Ensure essential tools are available, now including socat
if ! command -v curl &> /dev/null || ! command -v gunzip &> /dev/null || ! command -v jq &> /dev/null || ! command -v socat &> /dev/null; then
    echo "--- Essential tools not found, attempting to install with apt-get ---"
    apt-get update -y
    apt-get install -y curl gzip jq socat --no-install-recommends
    rm -rf /var/lib/apt/lists/*
fi

# --- Step 1: Prepare workerd (same as before) ---

WORKERD_VERSION="v1.20240222.0"
API_URL="https://api.github.com/repos/cloudflare/workerd/releases/tags/${WORKERD_VERSION}"
WORKERD_DIR="/tmp/workerd-bin"
WORKERD_GZ_PATH="${WORKERD_DIR}/workerd.gz"
WORKERD_EXEC_PATH="${WORKERD_DIR}/workerd"

echo "--- Fetching release info from GitHub API: ${API_URL} ---"
DOWNLOAD_URL=$(curl -s -L -H "User-Agent: HuggingFace-Space-Builder" $API_URL | jq -r '.assets[] | select(.name=="workerd-linux-64.gz") | .browser_download_url')

if [ -z "$DOWNLOAD_URL" ]; then
    echo "!!! ERROR: Could not find download URL using jq."
    exit 1
fi

echo "--- Real download URL found via jq: ${DOWNLOAD_URL} ---"
mkdir -p "$WORKERD_DIR"
curl -L "$DOWNLOAD_URL" -o "$WORKERD_GZ_PATH"
gunzip "$WORKERD_GZ_PATH"
chmod +x "$WORKERD_EXEC_PATH"
echo "--- workerd binary is ready at ${WORKERD_EXEC_PATH} ---"

# --- Step 2: Start workerd in the background ---

# workerd will listen on an internal port (8080).
# The '&' symbol runs the process in the background.
echo "--- Starting workerd service in the background on port 8080 ---"
"$WORKERD_EXEC_PATH" serve /app/config.capnp --verbose &

# Give workerd a moment to start up
sleep 3

# --- Step 3: Start socat as the main process ---

# socat will listen on the public port 7860 (expected by Hugging Face)
# and forward all traffic transparently to our background workerd on port 8080.
# This becomes the main, blocking process of the container.
echo "--- Starting socat to proxy port 7860 -> 8080 ---"
exec socat TCP-LISTEN:7860,fork TCP:127.0.0.1:8080
