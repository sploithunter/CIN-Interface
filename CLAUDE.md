# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Guidelines

**IMPORTANT**: When working on this codebase:
- Keep going until the task is completely finished
- Don't take shortcuts
- Don't do any hand waving
- Don't assume errors are from previous issues - ALL errors must be fixed
- Test everything end-to-end before considering a task complete

### Test Early, Test Often
- Write tests alongside implementation, not after
- Run tests at the end of every phase before moving on
- Tests should cover both unit tests AND integration/E2E tests where applicable
- No phase is complete until tests pass

### Integration as You Go
- Don't build in isolation - integrate components as they're built
- E2E tests should verify the full flow works, not just individual pieces
- When adding new functionality, update existing tests to cover integration points

## Project Overview

CIN-Interface is a fork of [Vibecraft](https://vibecraft.sh) - a 3D visualization interface for Claude Code. It uses [coding-agent-bridge](../coding-agent-bridge) as a foundation for hook management, tmux operations, and event processing.

**Current State**:
- TypeScript source has been recreated for the server
- Uses coding-agent-bridge for core functionality (tmux, hooks, file watching)
- CIN-specific features (3D visualization, tiles, projects, git status) remain in this repo

## Development Commands

```bash
# Development mode with hot-reload
npm run dev

# Type check without emitting
npm run typecheck

# Build TypeScript to dist/
npm run build

# Start compiled server
npm start

# Start via CLI (production)
node bin/cli.js

# Run diagnostics
node bin/cli.js doctor

# Configure hooks (uses coding-agent-bridge HookInstaller)
node bin/cli.js setup

# Configure Codex CLI hooks only
node bin/cli.js setup-codex

# Remove hooks
node bin/cli.js uninstall
```

## Getting Started (Development)

### Quick Start

1. **Install dependencies**: `npm install`
2. **Start the dev server**: `npm run dev`
   - This runs Vite (frontend dev server) on port 4002 and the backend on port 4003
   - Hot reload is enabled for both
3. **Open the interface**: http://localhost:4003 (backend serves frontend + API)

### Running Tests

**Important**: Tests require the server to be running on port 4003.

```bash
# Terminal 1: Start the server
npm run dev:server

# Terminal 2: Run tests (wait for server to be ready)
npm test
```

Or run server-only without Vite frontend:
```bash
npm run dev:server  # Just the API server with hot reload
```

### Common Issues

**Port 4003 already in use:**
```bash
lsof -ti :4003 | xargs kill -9
```

**Tests fail with ECONNREFUSED:**
- The server isn't running. Start it with `npm run dev:server` first.

**WebSocket rejected (origin: undefined):**
- WebSocket connections require an `Origin` header. When testing from Node.js:
```javascript
const ws = new WebSocket('ws://localhost:4003', {
  headers: { origin: 'http://localhost:4002' }
});
```

**Events not showing up:**
- Check that hooks are installed: `node bin/cli.js doctor`
- Events file location: `~/.coding-agent-bridge/data/events.jsonl`
- Server must be reading from the same events file the hooks write to

### Debug Mode

Enable verbose logging:
```bash
CIN_DEBUG=1 npm run dev:server
```

This shows:
- Event processing details
- Session state changes
- WebSocket connections
- File watcher activity

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (localhost)                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Three.js 3D Scene │ Activity Feed │ Session Management      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │ WebSocket                         │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    CIN-Interface Server (localhost:4003)          │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ WebSocket      │  │ HTTP API       │  │ Session Manager     │ │
│  │ (event stream) │  │ (REST)         │  │ (CIN-specific)      │ │
│  └────────────────┘  └────────────────┘  └─────────────────────┘ │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ GitStatus      │  │ Projects       │  │ Tiles Manager       │ │
│  │ Manager        │  │ Manager        │  │ (3D grid)           │ │
│  └────────────────┘  └────────────────┘  └─────────────────────┘ │
│                              │                                    │
│  ┌───────────────────────────┼──────────────────────────────────┐ │
│  │              coding-agent-bridge (npm package)                │ │
│  │  TmuxExecutor │ FileWatcher │ HookInstaller │ Adapters       │ │
│  └───────────────────────────┼──────────────────────────────────┘ │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Hook Script (generated by bridge)                │
│  ~/.cin-interface/hooks/coding-agent-hook.sh                      │
│  - Receives JSON from Claude Code / Codex CLI hooks              │
│  - Appends to ~/.cin-interface/data/events.jsonl                 │
│  - POSTs to server for real-time updates                         │
└──────────────────────────────────────────────────────────────────┘
                               ▲
                               │ stdin (JSON)
┌──────────────────────────────┴───────────────────────────────────┐
│             Claude Code / OpenAI Codex CLI                        │
│  Claude Hooks: PreToolUse, PostToolUse, Stop, SubagentStop,      │
│                SessionStart, SessionEnd, UserPromptSubmit        │
│  Codex: notify hook on agent-turn-complete                       │
└──────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
CIN-Interface/
├── src/                 # TypeScript source (edit these files)
│   ├── server/
│   │   ├── index.ts              # Main server (uses bridge components)
│   │   ├── GitStatusManager.ts   # Git status polling
│   │   ├── ProjectsManager.ts    # Project directory tracking
│   │   └── CodexSessionWatcher.ts # Codex session file watcher
│   └── shared/
│       ├── defaults.ts           # Configuration defaults
│       └── types.ts              # Types (imports from bridge + CIN-specific)
├── dist/                # Compiled output (generated by npm run build)
│   ├── index.html       # Frontend entry point
│   ├── assets/          # Bundled frontend
│   ├── server/          # Compiled TypeScript
│   └── shared/          # Compiled shared modules
├── bin/
│   └── cli.js           # CLI (uses bridge's HookInstaller)
├── frontend/            # Frontend source (Vite + TypeScript)
├── data/                # Local data (gitignored)
├── tsconfig.json        # TypeScript configuration
└── package.json
```

### Data Storage

All persistent data lives in `~/.cin-interface/`:
- `hooks/coding-agent-hook.sh` - Hook script (generated by bridge's HookInstaller)
- `data/events.jsonl` - Event log (JSONL format)
- `data/sessions.json` - Managed session state
- `data/tiles.json` - Text tiles for 3D grid
- `projects.json` - Known project directories

### Bridge Integration

CIN-Interface uses coding-agent-bridge for:
- **TmuxExecutor**: All tmux operations (createSession, sendKeys, capturePane, etc.)
- **FileWatcher**: Watching events.jsonl for new events
- **HookInstaller**: Installing/uninstalling hooks via CLI
- **Adapters**: ClaudeAdapter and CodexAdapter for agent-specific command building

CIN-Interface maintains its own:
- **Session management**: With CIN-specific fields (zonePosition, suggestion, autoAccept)
- **3D visualization**: Tool-to-station mapping, hex grid positioning
- **Git status**: Real-time git status per session
- **Projects**: Directory tracking and autocomplete
- **Tiles**: Text tiles on 3D grid

## Server API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| WS | `/` | WebSocket for real-time events |
| POST | `/event` | Receive hook events |
| GET | `/health` | Server status |
| GET | `/config` | Username, hostname, tmux session |
| GET | `/stats` | Tool usage statistics |
| GET/POST/DELETE | `/prompt` | Pending prompt management |
| GET | `/sessions` | List all managed sessions |
| POST | `/sessions` | Create new session |
| PATCH | `/sessions/:id` | Update session (rename, position) |
| DELETE | `/sessions/:id` | Kill session |
| POST | `/sessions/:id/prompt` | Send prompt to session (with optional images) |
| POST | `/sessions/:id/cancel` | Send Ctrl+C to session |
| POST | `/sessions/:id/restart` | Restart offline session |
| POST | `/sessions/:id/permission` | Respond to permission prompt |
| GET | `/sessions/:id/files` | List files in session directory |
| GET | `/sessions/:id/file` | Read file content |
| GET | `/sessions/:id/files/tree` | Directory tree |
| GET/POST/PUT/DELETE | `/tiles` | Text tile CRUD |
| GET | `/projects` | Known project directories |
| GET | `/projects/autocomplete` | Path autocomplete |

## Event Types

Events flow from Claude Code/Codex hooks through the bridge to the server:

- `pre_tool_use` - Tool about to execute (includes tool name, input)
- `post_tool_use` - Tool completed (includes response, duration)
- `stop` - Agent finished responding
- `subagent_stop` - Subagent completed
- `session_start` - New agent session started
- `session_end` - Session ended
- `user_prompt_submit` - User submitted a prompt
- `notification` - Agent notification

## Tool-to-Station Mapping

The 3D visualization maps tools to "stations":

```javascript
{
  Read: 'bookshelf',
  Write: 'desk',
  Edit: 'workbench',
  Bash: 'terminal',
  Grep: 'scanner',
  Glob: 'scanner',
  WebFetch: 'antenna',
  WebSearch: 'antenna',
  Task: 'portal',
  TodoWrite: 'taskboard',
  AskUserQuestion: 'center',
  NotebookEdit: 'desk',
}
```

## Key Configuration

Environment variables (override defaults):

- `CIN_PORT` - Server port (default: 4003)
- `CIN_DEBUG` - Enable debug logging
- `CIN_EVENTS_FILE` - Events file path
- `CIN_SESSIONS_FILE` - Sessions file path
- `DEEPGRAM_API_KEY` - Enable voice input

## Session Management

Sessions are managed via the bridge's TmuxExecutor:
- Internal sessions spawn a tmux session with Claude Code or Codex CLI
- External sessions are detected via hook events
- Server tracks session state (idle, working, waiting, offline)
- Prompts sent via `bridgeTmux.pasteBuffer()` (uses tmux load-buffer + paste-buffer)
- Cancel via `bridgeTmux.sendCtrlC()`
- Token/permission/suggestion polling via `bridgeTmux.capturePane()`

## Supported Agents

- **Claude Code** (`claude`): Full support via hooks
- **OpenAI Codex CLI** (`codex`): Support via notify hook and session file watching

## Next Development Steps

1. **Phase 13 - Integration Testing**: Test the full event flow with the bridge integration
2. **CIN-API Integration**: Add adapters to connect to CIN-API for remote sessions
3. **Frontend Features**: File explorer UI, voice input
4. **Additional Agents**: Add adapters for other AI coding assistants (Gemini CLI, etc.)
