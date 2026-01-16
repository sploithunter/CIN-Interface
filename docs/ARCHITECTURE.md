# CIN-Interface Architecture Specification

## Overview

CIN-Interface is a real-time visualization and management interface for Claude Code sessions. It provides a WebSocket server that bridges between Claude Code's hook system and a 3D browser-based frontend (hosted at vibecraft.sh).

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser (vibecraft.sh)                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Three.js 3D Scene  │  Activity Feed  │  Session Management  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │ WebSocket (ws://localhost:4003)       │
└──────────────────────────────┼──────────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Local Server (localhost:4003)                          │
│                                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐     │
│  │ WebSocket       │  │ HTTP REST API   │  │ Session Manager  │     │
│  │ Server          │  │ - /event        │  │ - tmux control   │     │
│  │ - broadcast     │  │ - /sessions     │  │ - health check   │     │
│  │ - voice proxy   │  │ - /tiles        │  │ - permission     │     │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘     │
│                                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐     │
│  │ File Watcher    │  │ GitStatus       │  │ Projects         │     │
│  │ (events.jsonl)  │  │ Manager         │  │ Manager          │     │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
                               │ POST /event + File append
┌──────────────────────────────┴──────────────────────────────────────┐
│                     Hook Script                                       │
│  ~/.vibecraft/hooks/vibecraft-hook.sh                                │
│  - Receives JSON from Claude Code hooks                              │
│  - Transforms to event format                                        │
│  - Appends to ~/.vibecraft/data/events.jsonl                        │
│  - POSTs to server for real-time updates                            │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
                               │ stdin (JSON)
┌──────────────────────────────┴──────────────────────────────────────┐
│                        Claude Code CLI                               │
│  Hooks: PreToolUse, PostToolUse, Stop, SubagentStop,                │
│         SessionStart, SessionEnd, UserPromptSubmit, Notification    │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. WebSocket Server

The WebSocket server handles real-time communication with browser clients.

**Responsibilities:**
- Accept connections from vibecraft.sh (origin-validated)
- Broadcast events to all connected clients
- Handle client messages (history requests, voice, permissions)
- Proxy voice audio to Deepgram for transcription

**Message Types (Server → Client):**
- `connected` - Initial connection acknowledgment
- `sessions` - List of managed sessions
- `text_tiles` - Text tile data for 3D grid
- `history` - Historical events
- `event` - New event notification
- `tokens` - Token usage updates
- `permission_prompt` - Permission request detected
- `permission_resolved` - Permission request resolved
- `voice_ready` / `voice_transcript` / `voice_error` - Voice transcription

**Message Types (Client → Server):**
- `subscribe` - Subscribe to events
- `get_history` - Request event history
- `ping` - Keep-alive
- `voice_start` / `voice_stop` - Voice session control
- `permission_response` - Send permission selection

### 2. HTTP REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/event` | Receive hook events |
| GET | `/health` | Server status (version, clients, events) |
| GET | `/config` | User/hostname/tmux configuration |
| GET | `/stats` | Tool usage statistics |
| GET | `/sessions` | List all managed sessions |
| POST | `/sessions` | Create new session |
| GET | `/sessions/:id` | Get session details |
| PATCH | `/sessions/:id` | Update session (name, position) |
| DELETE | `/sessions/:id` | Kill and remove session |
| POST | `/sessions/:id/prompt` | Send prompt to session |
| POST | `/sessions/:id/cancel` | Send Ctrl+C to session |
| POST | `/sessions/:id/restart` | Restart offline session |
| POST | `/sessions/:id/permission` | Respond to permission prompt |
| GET | `/tiles` | List text tiles |
| POST | `/tiles` | Create text tile |
| GET | `/projects` | List known project directories |
| GET | `/projects/autocomplete` | Path autocomplete |

### 3. Session Manager

Manages Claude Code sessions via tmux.

**Session States:**
- `idle` - Claude is waiting for input
- `working` - Claude is processing (tool in use)
- `waiting` - Claude is waiting for permission
- `offline` - tmux session not running

**Session Lifecycle:**
1. **Create**: Spawn tmux session with `claude -c --dangerously-skip-permissions`
2. **Health Check**: Poll `tmux list-sessions` every 5 seconds
3. **Working Timeout**: Auto-transition from `working` to `idle` after 2 minutes
4. **Restart**: Kill existing tmux session, spawn new one
5. **Delete**: Kill tmux session, remove from state

**Session Linking:**
- Claude Code sessions have internal session IDs
- Managed sessions have UUID-based IDs
- `claudeToManagedMap` links Claude session IDs to managed session IDs
- Events update the linked managed session status

### 4. Event Processing

**Event Flow:**
1. Claude Code hook fires → JSON to stdin
2. Hook script transforms → POST to `/event` + append to events.jsonl
3. Server receives event → Process (duration tracking) → Broadcast
4. File watcher catches append → Parse → Add (if new) → Broadcast

**Event Types:**
- `pre_tool_use` - Tool about to execute
- `post_tool_use` - Tool completed (includes duration if matched)
- `stop` - Claude finished responding
- `subagent_stop` - Subagent completed
- `session_start` - New Claude session
- `session_end` - Session ended
- `user_prompt_submit` - User submitted prompt
- `notification` - Claude notification

**Duration Tracking:**
- `pre_tool_use` events stored in `pendingToolUses` map by `toolUseId`
- `post_tool_use` events match and calculate duration
- Duration added to event before broadcast

### 5. GitStatus Manager

Polls git status for tracked session directories.

**Tracked Data:**
- Branch name, ahead/behind counts
- Staged changes (added/modified/deleted)
- Unstaged changes
- Untracked file count
- Lines added/removed
- Last commit time and message

**Polling:**
- 5-second interval for tracked directories
- Uses `git status --porcelain` and `git diff --stat`
- Broadcasts updated status to sessions

### 6. Projects Manager

Tracks known project directories.

**Storage:** `~/.vibecraft/projects.json`

**Provides:**
- List of known projects with names
- Path autocomplete for directory selection

### 7. Permission Detection

Polls tmux pane content to detect Claude Code permission prompts.

**Detection:**
- Searches for "Do you want to proceed?" text
- Parses option numbers and labels
- Detects tool name from context
- Handles bypass permissions warning auto-accept

**Flow:**
1. Poll tmux capture-pane every 1 second
2. Detect permission prompt → Broadcast `permission_prompt`
3. User responds via WebSocket → Send key to tmux
4. Prompt disappears → Broadcast `permission_resolved`

### 8. Voice Transcription (Optional)

Proxies audio to Deepgram for real-time transcription.

**Requirements:** `DEEPGRAM_API_KEY` environment variable

**Flow:**
1. Client sends `voice_start` message
2. Server creates Deepgram live connection
3. Client streams binary audio data
4. Server forwards to Deepgram
5. Deepgram returns transcripts → Broadcast to client

## Data Storage

All persistent data in `~/.vibecraft/`:

```
~/.vibecraft/
├── hooks/
│   └── vibecraft-hook.sh    # Installed hook script
├── data/
│   ├── events.jsonl         # Event log (JSONL)
│   ├── sessions.json        # Managed session state
│   └── tiles.json           # Text tiles for 3D grid
└── projects.json            # Known project directories
```

## Security

### Origin Validation
- WebSocket connections only accepted from:
  - `localhost` / `127.0.0.1` (any port)
  - `https://vibecraft.sh`

### Input Validation
- Directory paths validated (exists, is directory, no dangerous chars)
- tmux session names validated (alphanumeric + underscore/hyphen only)
- Request body size limited to 1MB

### Command Injection Prevention
- All shell commands use `execFile` (not `exec`)
- Arguments passed as array, not string
- PATH quoted to handle spaces in directory names

## Configuration

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `VIBECRAFT_PORT` | 4003 | Server port |
| `VIBECRAFT_DEBUG` | false | Enable debug logging |
| `VIBECRAFT_EVENTS_FILE` | ~/.vibecraft/data/events.jsonl | Events file path |
| `VIBECRAFT_SESSIONS_FILE` | ~/.vibecraft/data/sessions.json | Sessions file path |
| `VIBECRAFT_TMUX_SESSION` | claude | Default tmux session name |
| `DEEPGRAM_API_KEY` | - | Enable voice transcription |

## Tool-to-Station Mapping (Frontend)

The 3D visualization maps tools to visual "stations":

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

## Known Limitations

1. **Frontend Source**: The frontend is minified (~970KB). Source not available.
2. **Single Machine**: Currently designed for single-machine local use
3. **tmux Dependency**: Sessions require tmux for process management
4. **Browser Requirement**: Requires vibecraft.sh for visualization
5. **No Authentication**: Local-only, no auth beyond origin validation

## Future Considerations

### CIN-API Integration
- Add adapter interface for multiple backends
- Support CIN-API alongside tmux-based sessions
- Abstract session management to support different CLIs

### Multi-IDE Support
- Design adapter pattern for different CLI tools
- Support VS Code, Cursor, other IDE integrations
- Standardize event format across tools

### Scalability
- Consider Redis for event storage (vs JSONL file)
- WebSocket clustering for multiple server instances
- Session persistence across server restarts (improved)
