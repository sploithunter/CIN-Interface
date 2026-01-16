# Adapter Interface Design for CIN-Interface

## Overview

This document outlines the design for an adapter interface that will allow CIN-Interface to connect to multiple CLI/agent backends beyond just Claude Code with tmux.

## Current Limitations

### Tight Coupling to tmux
The current implementation is tightly coupled to tmux for session management:
- Sessions spawn tmux sessions directly
- Health checks poll `tmux list-sessions`
- Prompts sent via `tmux load-buffer` + `tmux paste-buffer`
- Cancellation via `tmux send-keys C-c`
- Permission detection via `tmux capture-pane`

### Hardcoded Claude Code Assumptions
- Hook script expects Claude Code hook format
- Command spawned is hardcoded to `claude` binary
- Event types match Claude Code's hook system

## Proposed Adapter Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CIN-Interface Server                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               Session Manager (Abstract)                     │   │
│  │  - createSession(options): Promise<Session>                  │   │
│  │  - sendPrompt(sessionId, prompt): Promise<Result>           │   │
│  │  - cancelSession(sessionId): Promise<Result>                │   │
│  │  - restartSession(sessionId): Promise<Result>               │   │
│  │  - deleteSession(sessionId): Promise<boolean>               │   │
│  │  - getSessionStatus(sessionId): SessionStatus               │   │
│  │  - checkHealth(): void                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐        │
│  │ TmuxAdapter │    │ CINAdapter  │    │ DirectAdapter   │        │
│  │ (current)   │    │ (CIN-API)   │    │ (subprocess)    │        │
│  └─────────────┘    └─────────────┘    └─────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
```

## Adapter Interface Definition

### TypeScript Interface

```typescript
// src/shared/adapters/types.ts

export interface AdapterConfig {
  type: string;
  name: string;
  options: Record<string, unknown>;
}

export interface SessionOptions {
  name?: string;
  cwd?: string;
  flags?: Record<string, boolean>;
  adapterConfig?: AdapterConfig;
}

export interface SessionInfo {
  id: string;
  name: string;
  status: SessionStatus;
  cwd?: string;
  createdAt: number;
  lastActivity: number;
  adapterId: string;
  adapterMeta?: Record<string, unknown>;
}

export type SessionStatus = 'idle' | 'working' | 'waiting' | 'offline';

export interface SendPromptResult {
  ok: boolean;
  error?: string;
}

export interface PermissionPrompt {
  tool: string;
  context: string;
  options: { number: string; label: string }[];
}

export interface AdapterEvents {
  onStatusChange: (sessionId: string, status: SessionStatus, tool?: string) => void;
  onPermissionPrompt: (sessionId: string, prompt: PermissionPrompt) => void;
  onPermissionResolved: (sessionId: string) => void;
  onSessionEnd: (sessionId: string) => void;
}

export interface SessionAdapter {
  /** Unique identifier for this adapter type */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Initialize the adapter with event handlers */
  initialize(events: AdapterEvents): Promise<void>;

  /** Create a new session */
  createSession(options: SessionOptions): Promise<SessionInfo>;

  /** Send a prompt to a session */
  sendPrompt(sessionId: string, prompt: string): Promise<SendPromptResult>;

  /** Cancel current operation (like Ctrl+C) */
  cancelSession(sessionId: string): Promise<SendPromptResult>;

  /** Restart an offline session */
  restartSession(sessionId: string): Promise<SessionInfo>;

  /** Delete/kill a session */
  deleteSession(sessionId: string): Promise<boolean>;

  /** Get current session info */
  getSession(sessionId: string): SessionInfo | undefined;

  /** Get all sessions managed by this adapter */
  getSessions(): SessionInfo[];

  /** Respond to a permission prompt */
  respondToPermission(sessionId: string, response: string): Promise<boolean>;

  /** Check health of all sessions */
  checkHealth(): void;

  /** Start any polling/monitoring */
  startMonitoring(): void;

  /** Stop monitoring and cleanup */
  shutdown(): Promise<void>;
}
```

## Adapter Implementations

### 1. TmuxAdapter (Current Behavior)

```typescript
// src/server/adapters/TmuxAdapter.ts

export class TmuxAdapter implements SessionAdapter {
  readonly id = 'tmux';
  readonly name = 'tmux + Claude Code';

  private sessions = new Map<string, TmuxSessionInfo>();
  private events?: AdapterEvents;

  async initialize(events: AdapterEvents): Promise<void> {
    this.events = events;
  }

  async createSession(options: SessionOptions): Promise<SessionInfo> {
    const tmuxSession = `vibecraft-${shortId()}`;
    const cwd = options.cwd || process.cwd();

    // Spawn tmux session with claude
    await execFileAsync('tmux', [
      'new-session', '-d', '-s', tmuxSession, '-c', cwd,
      `PATH='${EXEC_PATH}' claude -c --dangerously-skip-permissions`
    ]);

    const session: TmuxSessionInfo = {
      id: randomUUID(),
      name: options.name || 'Claude Session',
      status: 'idle',
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      adapterId: this.id,
      adapterMeta: { tmuxSession }
    };

    this.sessions.set(session.id, session);
    return session;
  }

  // ... other methods
}
```

### 2. CINAdapter (CIN-API Integration)

```typescript
// src/server/adapters/CINAdapter.ts

export class CINAdapter implements SessionAdapter {
  readonly id = 'cin-api';
  readonly name = 'CIN API';

  private apiUrl: string;
  private apiKey?: string;
  private sessions = new Map<string, CINSessionInfo>();
  private events?: AdapterEvents;
  private wsConnection?: WebSocket;

  constructor(config: { apiUrl: string; apiKey?: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
  }

  async initialize(events: AdapterEvents): Promise<void> {
    this.events = events;

    // Connect to CIN-API WebSocket for real-time updates
    this.wsConnection = new WebSocket(`${this.apiUrl}/ws`);
    this.wsConnection.on('message', (data) => {
      this.handleCINEvent(JSON.parse(data.toString()));
    });
  }

  async createSession(options: SessionOptions): Promise<SessionInfo> {
    const response = await fetch(`${this.apiUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        name: options.name,
        cwd: options.cwd,
        // CIN-specific options
      })
    });

    const data = await response.json();

    const session: SessionInfo = {
      id: data.id,
      name: data.name,
      status: 'idle',
      cwd: data.cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      adapterId: this.id,
      adapterMeta: { cinSessionId: data.id }
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<SendPromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };

    const response = await fetch(
      `${this.apiUrl}/sessions/${session.adapterMeta?.cinSessionId}/prompt`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      }
    );

    return response.ok ? { ok: true } : { ok: false, error: 'API error' };
  }

  private handleCINEvent(event: any): void {
    // Map CIN-API events to our event system
    switch (event.type) {
      case 'status_change':
        this.events?.onStatusChange(event.sessionId, event.status, event.tool);
        break;
      case 'permission_required':
        this.events?.onPermissionPrompt(event.sessionId, event.prompt);
        break;
      // ... other event types
    }
  }

  // ... other methods
}
```

### 3. DirectAdapter (Subprocess)

For running agents directly as subprocesses without tmux:

```typescript
// src/server/adapters/DirectAdapter.ts

export class DirectAdapter implements SessionAdapter {
  readonly id = 'direct';
  readonly name = 'Direct Subprocess';

  private sessions = new Map<string, DirectSessionInfo>();
  private processes = new Map<string, ChildProcess>();
  private events?: AdapterEvents;

  async createSession(options: SessionOptions): Promise<SessionInfo> {
    const id = randomUUID();
    const cwd = options.cwd || process.cwd();

    // Spawn process directly
    const proc = spawn('claude', ['-c', '--dangerously-skip-permissions'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: EXEC_PATH }
    });

    // Handle stdout/stderr for event detection
    proc.stdout?.on('data', (data) => this.parseOutput(id, data));
    proc.stderr?.on('data', (data) => this.parseOutput(id, data));

    proc.on('exit', () => {
      this.events?.onSessionEnd(id);
      this.sessions.get(id)!.status = 'offline';
    });

    this.processes.set(id, proc);

    const session: SessionInfo = {
      id,
      name: options.name || 'Claude Session',
      status: 'idle',
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      adapterId: this.id
    };

    this.sessions.set(id, session);
    return session;
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<SendPromptResult> {
    const proc = this.processes.get(sessionId);
    if (!proc?.stdin) return { ok: false, error: 'Session not found' };

    proc.stdin.write(prompt + '\n');
    return { ok: true };
  }

  async cancelSession(sessionId: string): Promise<SendPromptResult> {
    const proc = this.processes.get(sessionId);
    if (!proc) return { ok: false, error: 'Session not found' };

    proc.kill('SIGINT');
    return { ok: true };
  }

  // ... other methods
}
```

## Adapter Registry

```typescript
// src/server/adapters/registry.ts

export class AdapterRegistry {
  private adapters = new Map<string, SessionAdapter>();
  private defaultAdapterId: string;

  constructor(defaultAdapterId = 'tmux') {
    this.defaultAdapterId = defaultAdapterId;
  }

  register(adapter: SessionAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): SessionAdapter | undefined {
    return this.adapters.get(id);
  }

  getDefault(): SessionAdapter {
    const adapter = this.adapters.get(this.defaultAdapterId);
    if (!adapter) throw new Error(`Default adapter ${this.defaultAdapterId} not found`);
    return adapter;
  }

  getAll(): SessionAdapter[] {
    return Array.from(this.adapters.values());
  }

  async initializeAll(events: AdapterEvents): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.initialize(events);
      adapter.startMonitoring();
    }
  }

  async shutdownAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown();
    }
  }
}
```

## Event System Integration

### Event Handler in Server

```typescript
// src/server/index.ts

const registry = new AdapterRegistry();
registry.register(new TmuxAdapter());
registry.register(new CINAdapter({ apiUrl: 'http://localhost:5000' }));

await registry.initializeAll({
  onStatusChange: (sessionId, status, tool) => {
    const session = findSession(sessionId);
    if (session) {
      session.status = status;
      session.currentTool = tool;
      broadcastSessions();
    }
  },

  onPermissionPrompt: (sessionId, prompt) => {
    pendingPermissions.set(sessionId, prompt);
    broadcast({
      type: 'permission_prompt',
      payload: { sessionId, ...prompt }
    });
  },

  onPermissionResolved: (sessionId) => {
    pendingPermissions.delete(sessionId);
    broadcast({
      type: 'permission_resolved',
      payload: { sessionId }
    });
  },

  onSessionEnd: (sessionId) => {
    const session = findSession(sessionId);
    if (session) {
      session.status = 'offline';
      broadcastSessions();
    }
  }
});
```

## Migration Path

### Phase 1: Extract TmuxAdapter
1. Extract current tmux logic into `TmuxAdapter` class
2. Create adapter interface and registry
3. Refactor server to use adapter registry
4. Ensure backward compatibility

### Phase 2: Add CIN-API Adapter
1. Implement `CINAdapter` for CIN-API
2. Add configuration for CIN-API connection
3. Map CIN-API events to internal event system
4. Test with CIN-API backend

### Phase 3: Support Multiple Adapters
1. Allow sessions to specify adapter type
2. Update UI to show adapter options
3. Handle mixed adapter sessions
4. Add adapter-specific configuration UI

## API Changes

### Session Creation with Adapter

```http
POST /sessions
Content-Type: application/json

{
  "name": "My Session",
  "cwd": "/path/to/project",
  "adapter": "cin-api",  // NEW: specify adapter
  "adapterOptions": {    // NEW: adapter-specific options
    "model": "claude-3-opus",
    "context": "existing-context-id"
  }
}
```

### List Available Adapters

```http
GET /adapters

Response:
{
  "ok": true,
  "adapters": [
    { "id": "tmux", "name": "tmux + Claude Code" },
    { "id": "cin-api", "name": "CIN API" },
    { "id": "direct", "name": "Direct Subprocess" }
  ]
}
```

## Configuration

```javascript
// config.js or environment variables

export const config = {
  adapters: {
    tmux: {
      enabled: true,
      default: true
    },
    'cin-api': {
      enabled: true,
      apiUrl: process.env.CIN_API_URL || 'http://localhost:5000',
      apiKey: process.env.CIN_API_KEY
    },
    direct: {
      enabled: false
    }
  }
};
```

## Considerations

### State Persistence
- Each adapter manages its own session state
- Server maintains unified view across adapters
- Session IDs unique across all adapters

### Error Handling
- Adapters should handle their own errors gracefully
- Failed adapter initialization shouldn't crash server
- Provide fallback to default adapter

### Testing
- Mock adapters for unit testing
- Integration tests for each adapter
- End-to-end tests for adapter switching

### Security
- Validate adapter options
- Rate limit adapter-specific operations
- Secure API key handling for remote adapters
