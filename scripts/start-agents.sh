#!/bin/bash
# Quick start script for feedback automation agents
# Usage: ./scripts/start-agents.sh [--stop]

cd "$(dirname "$0")/.."

if [ "$1" = "--stop" ]; then
  echo "Stopping agents..."
  pkill -f "agent:issues" 2>/dev/null && echo "Stopped issue-creator" || echo "issue-creator not running"
  pkill -f "agent:poller" 2>/dev/null && echo "Stopped issue-poller" || echo "issue-poller not running"
  exit 0
fi

# Check if server is running
if ! curl -s http://localhost:4003/health > /dev/null 2>&1; then
  echo "Error: CIN-Interface server not running on port 4003"
  echo "Start it first with: npm run dev:server"
  exit 1
fi

# Stop any existing agents
pkill -f "agent:issues" 2>/dev/null
pkill -f "agent:poller" 2>/dev/null
sleep 1

echo "Starting feedback automation agents..."
echo ""

# Start issue creator
nohup npm run agent:issues > /tmp/agent-issues.log 2>&1 &
echo "Issue Creator started (PID: $!) - creates GitHub issues from feedback"
echo "  Log: /tmp/agent-issues.log"

# Start issue poller with auto-fix
nohup npm run agent:poller -- \
  --repos sploithunter/CIN-Interface \
  --auto-fix \
  --dangerously-allow-all-users \
  --poll-interval 15 \
  > /tmp/agent-poller.log 2>&1 &
echo "Issue Poller started (PID: $!) - watches GitHub and auto-fixes issues"
echo "  Log: /tmp/agent-poller.log"

echo ""
echo "Agents running. Submit feedback via the UI to test."
echo ""
echo "Monitor logs:"
echo "  tail -f /tmp/agent-issues.log"
echo "  tail -f /tmp/agent-poller.log"
echo ""
echo "Stop agents:"
echo "  ./scripts/start-agents.sh --stop"
