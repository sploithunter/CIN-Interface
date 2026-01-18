#!/bin/bash
# Codex Hook - Captures Codex CLI events for CIN-Interface
#
# This script is called by Codex notify configuration and:
# 1. Receives JSON payload as first argument
# 2. Transforms it into our event format
# 3. Appends to the events JSONL file
# 4. Notifies the WebSocket server for instant updates
#
# Configure in ~/.codex/config.toml:
#   notify = ["~/.cin-interface/hooks/codex-hook.sh"]
#
# Or use the setup command: cin-interface setup-codex

set -e

# =============================================================================
# Cross-Platform PATH Setup
# =============================================================================

KNOWN_PATHS=(
  "/opt/homebrew/bin"      # macOS Apple Silicon Homebrew
  "/usr/local/bin"         # macOS Intel Homebrew / Linux local
  "$HOME/.local/bin"       # User local bin
  "/usr/bin"               # System binaries
  "/bin"                   # Core binaries
)

for dir in "${KNOWN_PATHS[@]}"; do
  [ -d "$dir" ] && export PATH="$dir:$PATH"
done

# =============================================================================
# Tool Discovery
# =============================================================================

find_tool() {
  local name="$1"
  local found=$(command -v "$name" 2>/dev/null)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi
  for dir in "${KNOWN_PATHS[@]}"; do
    if [ -x "$dir/$name" ]; then
      echo "$dir/$name"
      return 0
    fi
  done
  return 1
}

JQ=$(find_tool "jq") || {
  echo "codex-hook: ERROR - jq not found. Install it:" >&2
  echo "  macOS: brew install jq" >&2
  echo "  Linux: apt install jq (or yum install jq)" >&2
  exit 1
}

CURL=$(find_tool "curl") || {
  CURL=""
}

# =============================================================================
# Configuration
# =============================================================================

VIBECRAFT_DATA_DIR="${VIBECRAFT_DATA_DIR:-$HOME/.vibecraft/data}"
EVENTS_FILE="${VIBECRAFT_EVENTS_FILE:-$VIBECRAFT_DATA_DIR/events.jsonl}"
WS_NOTIFY_URL="${VIBECRAFT_WS_NOTIFY:-http://localhost:4003/event/codex}"
ENABLE_WS_NOTIFY="${VIBECRAFT_ENABLE_WS_NOTIFY:-true}"

mkdir -p "$(dirname "$EVENTS_FILE")"

# =============================================================================
# Read Input
# Codex notify passes JSON as first argument
# =============================================================================

input="$1"

if [ -z "$input" ]; then
  echo "codex-hook: ERROR - No JSON payload received" >&2
  exit 1
fi

# Debug logging
echo "[$(date)] Codex hook fired: ${input:0:200}..." >> /tmp/codex-hook-debug.log

# =============================================================================
# Parse Codex Notify Payload
# Format: { type, thread-id, turn-id, cwd, input-messages, last-assistant-message }
# =============================================================================

event_type=$(echo "$input" | "$JQ" -r '.type // "unknown"')
thread_id=$(echo "$input" | "$JQ" -r '.["thread-id"] // "unknown"')
turn_id=$(echo "$input" | "$JQ" -r '.["turn-id"] // ""')
cwd=$(echo "$input" | "$JQ" -r '.cwd // ""')
last_message=$(echo "$input" | "$JQ" -r '.["last-assistant-message"] // ""')

# Generate unique event ID and timestamp
if [[ "$OSTYPE" == "darwin"* ]]; then
  if command -v perl &> /dev/null; then
    timestamp=$(perl -MTime::HiRes=time -e 'printf "%.0f", time * 1000')
  elif command -v python3 &> /dev/null; then
    timestamp=$(python3 -c 'import time; print(int(time.time() * 1000))')
  else
    timestamp=$(($(date +%s) * 1000 + RANDOM % 1000))
  fi
  event_id="codex-${thread_id}-${timestamp}-${RANDOM}"
else
  ms_part=$(date +%N | cut -c1-3)
  timestamp=$(($(date +%s) * 1000 + 10#$ms_part))
  event_id="codex-${thread_id}-$(date +%s%N)"
fi

# =============================================================================
# Build Event JSON
# Map Codex event to CIN-Interface format
# =============================================================================

case "$event_type" in
  agent-turn-complete)
    # Map to "stop" event type for consistency with Claude
    cin_event_type="stop"

    event=$("$JQ" -n -c \
      --arg id "$event_id" \
      --argjson timestamp "$timestamp" \
      --arg type "$cin_event_type" \
      --arg sessionId "$thread_id" \
      --arg codexThreadId "$thread_id" \
      --arg cwd "$cwd" \
      --arg response "$last_message" \
      --arg turnId "$turn_id" \
      --arg agent "codex" \
      --arg source "notify" \
      '{
        id: $id,
        timestamp: $timestamp,
        type: $type,
        sessionId: $sessionId,
        codexThreadId: $codexThreadId,
        cwd: $cwd,
        response: $response,
        turnId: $turnId,
        agent: $agent,
        source: $source
      }')
    ;;

  *)
    # Unknown event - store with raw data
    event=$("$JQ" -n -c \
      --arg id "$event_id" \
      --argjson timestamp "$timestamp" \
      --arg type "$event_type" \
      --arg sessionId "$thread_id" \
      --arg codexThreadId "$thread_id" \
      --arg cwd "$cwd" \
      --arg agent "codex" \
      --arg source "notify" \
      --argjson raw "$input" \
      '{
        id: $id,
        timestamp: $timestamp,
        type: $type,
        sessionId: $sessionId,
        codexThreadId: $codexThreadId,
        cwd: $cwd,
        agent: $agent,
        source: $source,
        raw: $raw
      }')
    ;;
esac

# =============================================================================
# Output Event
# =============================================================================

# Append event to JSONL file
echo "$event" >> "$EVENTS_FILE"

# Notify WebSocket server (fire and forget)
if [ "$ENABLE_WS_NOTIFY" = "true" ] && [ -n "$CURL" ]; then
  "$CURL" -s -X POST "$WS_NOTIFY_URL" \
    -H "Content-Type: application/json" \
    -d "$event" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 &
fi

exit 0
