# CIN-Interface

3D visualization interface for Claude Code. Watch and manage your Claude sessions in real-time.

> **Note**: This is a fork of [Vibecraft](https://vibecraft.sh) by Elysian Labs. Data is stored in `~/.vibecraft/` for backward compatibility.

![Three.js](https://img.shields.io/badge/Three.js-black?logo=threedotjs) ![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)

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

### Session Management
- Create and manage multiple Claude Code sessions
- Auto-detect external Claude sessions via hooks
- Send prompts to sessions from web UI or terminal
- Cancel (Ctrl+C) and restart sessions
- Session status tracking (idle, working, waiting, offline)

### 3D Visualization
- Hex grid displays sessions as zones
- Watch Claude move between stations as it uses tools
- Stations: Bookshelf (Read), Desk (Write), Workbench (Edit), Terminal (Bash), Scanner (Grep/Glob), Antenna (WebFetch), Portal (Task), Taskboard (Todo)
- Floating context labels show file paths and commands

### Activity Feed
- Real-time event stream from Claude Code
- Filter events by selected session
- Expandable tool call details
- Response capture for Claude's final messages

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-6` | Switch to session |
| `0` | All sessions |
| `Tab` / `Esc` | Switch focus between scene and feed |
| `Alt+N` | New session |
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
Local Server ← hooks/vibecraft-hook.sh ← Claude Code
    │
    ├── Session Manager (tmux control)
    ├── Event Processor (events.jsonl)
    └── Git Status Manager
```

## License

MIT
