# CIN-Interface Architecture Specification

## Overview

CIN-Interface is a real-time visualization and management interface for AI coding assistants (Claude Code, OpenAI Codex CLI). It provides a WebSocket server that bridges between CLI hook systems and a 3D browser-based frontend.

## System Architecture (Current - Local)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser (localhost:4003)                          │
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
│  │ File Watcher    │◀─│ events.jsonl    │  │ Codex Watcher    │     │
│  │ (unified input) │  │ (SINGLE SOURCE) │──│ (session files)  │     │
│  └─────────────────┘  └─────────────────┘  └──────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                               ▲                      ▲
           ┌───────────────────┴──────┐               │
           │                          │               │
┌──────────┴──────────┐    ┌──────────┴──────────┐   │
│   Hook Script       │    │   Codex Watcher     │   │
│   (cin-hook)  │    │   writes to file    │   │
│   writes to file    │    │                     │   │
└──────────┬──────────┘    └─────────────────────┘   │
           │                                          │
           ▼                                          ▼
┌──────────────────────┐    ┌─────────────────────────────────────────┐
│   Claude Code CLI    │    │   ~/.codex/sessions/YYYY/MM/DD/*.jsonl  │
│   Hook events        │    │   Codex CLI session logs                │
└──────────────────────┘    └─────────────────────────────────────────┘
```

## Event Flow (Unified)

**Key Principle**: `events.jsonl` is the single source of truth. All events flow through this file.

### Claude Code Events
```
Claude Code Hook → Hook Script → events.jsonl → File Watcher → addEvent() → Broadcast
```

### Codex CLI Events
```
Codex Session File → CodexWatcher → events.jsonl → File Watcher → addEvent() → Broadcast
```

### addEvent() Processing
```
1. Deduplicate by event ID
2. Process event (track tool duration)
3. Route to session:
   - If event.codexThreadId → findOrCreateCodexSession()
   - Else → findOrCreateExternalSession() (Claude)
4. Update session state (status, currentTool, lastActivity)
5. Broadcast to WebSocket clients
```

## Data Storage

All persistent data in `~/.cin-interface/`:

```
~/.cin-interface/
├── hooks/
│   └── cin-hook.sh      # Claude Code hook script
├── data/
│   ├── events.jsonl           # UNIFIED EVENT LOG (single source of truth)
│   ├── sessions.json          # Managed session state
│   ├── tiles.json             # Text tiles for 3D grid
│   └── codexToManagedMap.json # Codex thread ID → session ID mapping
└── projects.json              # Known project directories
```

### events.jsonl Format

Each line is a JSON object:
```json
{"id":"uuid","type":"pre_tool_use","timestamp":1234567890,"sessionId":"uuid","cwd":"/path","tool":"Bash","toolInput":{}}
{"id":"uuid","type":"post_tool_use","timestamp":1234567891,"sessionId":"uuid","cwd":"/path","tool":"Bash","toolResponse":{},"codexThreadId":"2026-01-18T..."}
```

**Codex events include `codexThreadId`** for reliable session matching across server restarts.

## Session Types

| Type | Agent | Source | Management |
|------|-------|--------|------------|
| Internal | Claude | Created via UI | tmux-controlled |
| External | Claude | Auto-detected from hooks | Read-only |
| External | Codex | Auto-detected from session files | Read-only |

### Session States
- `idle` - Waiting for input
- `working` - Processing (tool in use)
- `waiting` - Claude finished, needs attention
- `offline` - Process not running

## Agent Integrations

### Claude Code
- **Hook Events**: PreToolUse, PostToolUse, Stop, SubagentStop, SessionStart, SessionEnd, UserPromptSubmit, Notification
- **Session Control**: tmux send-keys for prompts, Ctrl+C for cancel
- **Permission Handling**: Detect prompts via tmux capture-pane

### OpenAI Codex CLI
- **Session Files**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Event Types**: session_meta, response_item, event_msg, turn_context
- **Session Control**: Read-only (no send/cancel support yet)
- **Health Check**: File modification time (5 min inactive → offline)

---

## Remote Access Architecture (Planned)

### Design Goals
1. Access CIN-Interface from any device on local network or internet
2. Secure authentication (no open access)
3. Real-time event streaming with low latency
4. Support multiple concurrent clients

### Architecture Options

#### Option A: Direct WebSocket with Auth
```
┌─────────────────┐     HTTPS/WSS      ┌─────────────────────────────┐
│  Remote Client  │◀──────────────────▶│  CIN-Interface Server       │
│  (Browser/App)  │     + Auth Token   │  + TLS Termination          │
└─────────────────┘                    │  + Token Auth Middleware    │
                                       └─────────────────────────────┘
```

**Pros**: Simple, low latency
**Cons**: Requires port forwarding/DNS, certificate management

#### Option B: Relay Server (Recommended)
```
┌─────────────────┐                    ┌─────────────────────────────┐
│  Remote Client  │◀───── WSS ────────▶│  Relay Server (cloud)       │
│  (Browser/App)  │                    │  - Auth + routing           │
└─────────────────┘                    │  - Session management       │
                                       └──────────────┬──────────────┘
                                                      │ WSS (outbound)
                                       ┌──────────────▼──────────────┐
                                       │  CIN-Interface Server       │
                                       │  (connects to relay)        │
                                       │  - No port forwarding       │
                                       │  - Outbound connection only │
                                       └─────────────────────────────┘
```

**Pros**: No port forwarding, NAT traversal, centralized auth
**Cons**: Added latency, requires relay infrastructure

#### Option C: Tailscale/ZeroTier VPN
```
┌─────────────────┐    Tailscale      ┌─────────────────────────────┐
│  Remote Client  │◀────Mesh VPN─────▶│  CIN-Interface Server       │
│  (on Tailnet)   │                   │  (on Tailnet)               │
└─────────────────┘                   └─────────────────────────────┘
```

**Pros**: Simple setup, secure, no relay needed
**Cons**: Requires Tailscale on both ends, not web-accessible

### Recommended: Hybrid Approach

```
┌──────────────────────────────────────────────────────────────────────┐
│                         cin-relay.example.com                         │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                      Relay Service                              │  │
│  │  - WebSocket hub (rooms per user)                              │  │
│  │  - Auth via API keys or OAuth                                  │  │
│  │  - Message routing (client ↔ server)                           │  │
│  │  - Connection health monitoring                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬─────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Remote Client A │     │ Remote Client B │     │ CIN-Interface   │
│ (Phone/Tablet)  │     │ (Laptop)        │     │ Server          │
│                 │     │                 │     │ (home machine)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Protocol Design

#### Connection Flow
```
1. Server starts, connects to relay: wss://cin-relay.example.com/server/{api_key}
2. Relay authenticates server, assigns room ID
3. Client connects: wss://cin-relay.example.com/client/{room_id}?token={auth_token}
4. Relay routes messages bidirectionally
```

#### Message Types (Relay Protocol)
```typescript
// Server → Relay
{ type: 'register', apiKey: string, capabilities: string[] }
{ type: 'broadcast', payload: CINEvent }
{ type: 'response', clientId: string, payload: any }

// Client → Relay
{ type: 'connect', roomId: string, token: string }
{ type: 'subscribe', channels: string[] }
{ type: 'request', payload: { method: string, path: string, body?: any } }

// Relay → Client
{ type: 'event', payload: CINEvent }
{ type: 'response', payload: any }
{ type: 'error', code: string, message: string }
```

### Security Considerations

1. **Authentication**
   - API keys for server registration
   - JWT tokens for client access
   - Token refresh mechanism

2. **Authorization**
   - Room-based isolation (one server = one room)
   - Read-only vs admin client roles
   - Rate limiting per client

3. **Encryption**
   - TLS for all connections
   - Optional E2E encryption for sensitive data

4. **Audit**
   - Connection logs
   - Action logs (prompts sent, sessions created)

### Implementation Phases

#### Phase 1: Local Network Access
- Add optional TLS to existing server
- Add API key authentication
- Allow connections from local network

#### Phase 2: Relay Service
- Build/deploy relay server (Node.js + WebSocket)
- Server-side relay client
- Client-side relay support

#### Phase 3: Mobile/Web App
- React Native or PWA client
- Push notifications for session activity
- Offline event caching

---

## API Reference

### HTTP Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/event` | Receive hook events |
| GET | `/health` | Server status |
| GET | `/config` | User/hostname config |
| GET | `/sessions` | List all sessions |
| POST | `/sessions` | Create new session |
| PATCH | `/sessions/:id` | Update session |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/sessions/:id/prompt` | Send prompt |
| POST | `/sessions/:id/cancel` | Cancel (Ctrl+C) |
| DELETE | `/sessions/cleanup` | Remove offline sessions |

### WebSocket Messages

**Server → Client**
- `connected` - Connection acknowledged
- `sessions` - Session list update
- `event` - New event
- `history` - Historical events
- `permission_prompt` - Permission detected
- `permission_resolved` - Permission handled

**Client → Server**
- `subscribe` - Subscribe to events
- `get_history` - Request history
- `ping` - Keep-alive
- `permission_response` - Answer permission

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CIN_PORT` | 4003 | Server port |
| `CIN_DEBUG` | false | Debug logging |
| `CIN_EVENTS_FILE` | ~/.cin-interface/data/events.jsonl | Events file |
| `CIN_SESSIONS_FILE` | ~/.cin-interface/data/sessions.json | Sessions file |
| `DEEPGRAM_API_KEY` | - | Voice transcription |

## Known Limitations

1. **Single Machine**: Currently local-only
2. **tmux Dependency**: Internal sessions require tmux
3. **Codex Read-Only**: No prompt/cancel support for Codex sessions
4. **Frontend Minified**: Original source not available

## Future Work

- [ ] Remote access via relay
- [ ] Codex CLI Phase 2: notify hooks for real-time events
- [ ] Codex CLI Phase 3: SDK integration for internal sessions
- [ ] Mobile client
- [ ] Multi-user support
