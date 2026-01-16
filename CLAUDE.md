# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CIN-Interface is a fork of [Vibecraft](https://vibecraft.sh) - a 3D visualization interface for Claude Code. The goal is to extend it to connect to CIN-API and potentially other IDE CLIs beyond Claude Code.

**Current State**: The codebase contains compiled JavaScript from the original Vibecraft project. The frontend is minified, but the server code is readable. Source TypeScript files are not present (original repo is private).

## Development Commands

```bash
# Start the server (production mode - uses compiled JS)
node bin/cli.js

# Alternative: direct server start
node dist/server/server/index.js

# Run diagnostics
node bin/cli.js doctor

# Configure hooks in Claude Code settings
node bin/cli.js setup

# Remove hooks
node bin/cli.js uninstall
```

**Note**: There is no `npm run dev` currently - the TypeScript source needs to be recreated from the compiled JS if we want hot-reload development.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (vibecraft.sh)                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Three.js 3D Scene │ Activity Feed │ Session Management      │ │
│  └──────────────────────────────────────────────────────────────│ │
│                              │ WebSocket                         │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Local Server (localhost:4003)                  │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ WebSocket      │  │ HTTP API       │  │ Session Manager     │ │
│  │ (event stream) │  │ (REST)         │  │ (tmux control)      │ │
│  └────────────────┘  └────────────────┘  └─────────────────────┘ │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ File Watcher   │  │ GitStatus      │  │ Projects            │ │
│  │ (events.jsonl) │  │ Manager        │  │ Manager             │ │
│  └────────────────┘  └────────────────┘  └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                               ▲
                               │ POST /event + File append
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                     Hook Script (bash)                            │
│  ~/.vibecraft/hooks/vibecraft-hook.sh                            │
│  - Receives JSON from Claude Code hooks                          │
│  - Transforms to event format                                    │
│  - Appends to ~/.vibecraft/data/events.jsonl                     │
│  - POSTs to server for real-time updates                         │
└──────────────────────────────────────────────────────────────────┘
                               ▲
                               │ stdin (JSON)
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                        Claude Code                                │
│  Hooks: PreToolUse, PostToolUse, Stop, SubagentStop,             │
│         SessionStart, SessionEnd, UserPromptSubmit, Notification │
└──────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
CIN-Interface/
├── bin/
│   └── cli.js           # CLI entry point (setup, doctor, server start)
├── dist/
│   ├── index.html       # Frontend entry point
│   ├── assets/          # Bundled frontend (minified)
│   └── server/
│       ├── server/
│       │   ├── index.js          # Main server (~2000 lines)
│       │   ├── GitStatusManager.js
│       │   └── ProjectsManager.js
│       └── shared/
│           ├── defaults.js       # Configuration defaults
│           └── types.js          # Event types, tool-to-station mapping
├── hooks/
│   ├── vibecraft-hook.sh         # Hook script (copied to ~/.vibecraft/hooks/)
│   └── install.sh
├── data/                # Local data (gitignored)
└── package.json
```

### Data Storage

All persistent data lives in `~/.vibecraft/`:
- `hooks/vibecraft-hook.sh` - Installed hook script
- `data/events.jsonl` - Event log (JSONL format)
- `data/sessions.json` - Managed session state
- `data/tiles.json` - Text tiles for 3D grid
- `projects.json` - Known project directories

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
| POST | `/sessions/:id/prompt` | Send prompt to session |
| POST | `/sessions/:id/cancel` | Send Ctrl+C to session |
| POST | `/sessions/:id/restart` | Restart offline session |
| POST | `/sessions/:id/permission` | Respond to permission prompt |
| GET/POST/PUT/DELETE | `/tiles` | Text tile CRUD |
| GET | `/projects` | Known project directories |
| GET | `/projects/autocomplete` | Path autocomplete |

## Event Types

Events flow from Claude Code hooks through the bash script to the server:

- `pre_tool_use` - Tool about to execute (includes tool name, input)
- `post_tool_use` - Tool completed (includes response, duration)
- `stop` - Claude finished responding
- `subagent_stop` - Subagent completed
- `session_start` - New Claude session started
- `session_end` - Session ended
- `user_prompt_submit` - User submitted a prompt
- `notification` - Claude notification

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

Environment variables (override defaults in `dist/server/shared/defaults.js`):

- `VIBECRAFT_PORT` - Server port (default: 4003)
- `VIBECRAFT_DEBUG` - Enable debug logging
- `VIBECRAFT_EVENTS_FILE` - Events file path
- `VIBECRAFT_SESSIONS_FILE` - Sessions file path
- `DEEPGRAM_API_KEY` - Enable voice input

## Session Management

Sessions are managed via tmux:
- Each session spawns a tmux session with Claude Code
- Server tracks session state (idle, working, waiting, offline)
- Prompts sent via `tmux load-buffer` + `tmux paste-buffer`
- Cancel via `tmux send-keys C-c`

## Future Development Notes

1. **TypeScript Recreation**: To enable proper development, recreate TypeScript source from compiled JS in `dist/server/`

2. **CIN-API Integration**: Add endpoints/adapters to connect to CIN-API alongside or instead of tmux-based sessions

3. **Frontend Modifications**: The frontend is minified (~970KB). Options:
   - Recreate from scratch using Three.js
   - Attempt to deobfuscate
   - Contact original author for source access

4. **Other IDE CLIs**: Architecture supports adding adapters for other CLI tools beyond Claude Code
