# CIN-Interface

3D visualization interface for AI coding agents. Watch and manage Claude Code and OpenAI Codex sessions in real-time.

> **Note**: This is a fork of [Vibecraft](https://vibecraft.sh) by Elysian Labs. Data is stored in `~/.cin-interface/`.

![Three.js](https://img.shields.io/badge/Three.js-black?logo=threedotjs) ![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white) ![Vitest](https://img.shields.io/badge/Vitest-green?logo=vitest&logoColor=white)

## Requirements

- **macOS or Linux** (Windows not supported - hooks require bash)
- **Node.js** 18+
- **jq** - for hook scripts (`brew install jq` / `apt install jq`)
- **tmux** - for session management (`brew install tmux` / `apt install tmux`)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/sploithunter/CIN-Interface
cd CIN-Interface && npm install

# 2. Configure hooks (one time)
npm run setup
# OR: node bin/cli.js setup

# 3. Start server
npm start

# 4. Open http://localhost:4003 in your browser
```

## Development

```bash
# Development mode with hot-reload
npm run dev

# Build TypeScript
npm run build

# Type check
npm run typecheck
```

## Features

### Multi-Agent Support
- **Claude Code** - Full integration via hooks (create sessions, send prompts, cancel, restart)
- **OpenAI Codex CLI** - Auto-detect external Codex sessions via JSONL file watching
- Agent type badges (CLAUDE/CODEX) and color-coded session cards
- Unified event flow - all agent events through single events.jsonl

### Session Management
- Create and manage multiple AI coding sessions
- Auto-detect external sessions via hooks (Claude) or file watching (Codex)
- Send prompts to sessions from web UI or terminal
- Cancel (Ctrl+C) and restart sessions
- Session status tracking (idle, working, waiting, offline)
- Permission prompt handling - respond to agent permission requests from web UI

### 3D Visualization
- Hex grid displays sessions as zones
- Watch agents move between stations as they use tools
- Stations: Bookshelf (Read), Desk (Write), Workbench (Edit), Terminal (Bash), Scanner (Grep/Glob), Antenna (WebFetch), Portal (Task), Taskboard (Todo)
- Floating context labels show file paths and commands
- Toggle map visibility with `M` key (preference saved)

### Activity Feed
- Real-time event stream from all agents
- Filter events by selected session
- Expandable content for:
  - Long responses (500+ chars)
  - Bash command output
  - Task/subagent prompts
  - Edit/Write/Read tool details
- Response capture for agent's final messages

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-9` | Switch to session (or respond to permission prompt) |
| `0` | All sessions |
| `M` | Toggle 3D map visibility |
| `Tab` / `Esc` | Switch focus between scene and feed |
| `Enter` | Submit prompt (Shift+Enter for newline) |

## CLI Commands

```bash
cin-interface [options]
cin-interface setup         # Configure Claude Code hooks
cin-interface uninstall     # Remove hooks (keeps data)
cin-interface doctor        # Diagnose common issues

Options:
  --port, -p <port>    Server port (default: 4003)
  --help, -h           Show help
  --version, -v        Show version
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed technical documentation.

```
Browser (localhost:4003)
    │ WebSocket
    ▼
Local Server
    │
    ├── Session Manager (tmux control for internal sessions)
    ├── Event Processor (events.jsonl - single source of truth)
    ├── Git Status Manager
    └── Codex Session Watcher (~/.codex/sessions/*.jsonl)

    ▲                              ▲
    │                              │
hooks/cin-hook.sh            File Watcher
    ▲                              ▲
    │                              │
Claude Code                  Codex CLI
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Backend tests only
npm run test:backend
```

## License

MIT
