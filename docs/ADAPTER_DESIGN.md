# Adapter Interface Design

## Overview

This document defines an adapter interface that allows CIN-Interface to work with multiple backend systems:
- Claude Code CLI (current)
- CIN-API (planned)
- Other agentic CLI tools (future)

## Design Goals

1. **Pluggable backends** - Add new backends without modifying core server
2. **Unified event format** - Normalize events from different sources
3. **Session abstraction** - Abstract session lifecycle management
4. **Backward compatible** - Keep existing tmux-based Claude Code working

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CIN-Interface Server                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ WebSocket    │  │ REST API     │  │ Session Router       │  │
│  │ Server       │  │ Handlers     │  │ (selects adapter)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                              │                   │
│  ┌───────────────────────────────────────────┼──────────────┐   │
│  │              Adapter Interface            │               │   │
│  │                                           │               │   │
│  │  createSession() │ sendPrompt() │ getStatus() │ ...      │   │
│  └───────────────────────────────────────────┼──────────────┘   │
│                                              │                   │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
        ┌──────────────────┬───────────────────┼───────────────────┐
        │                  │                   │                   │
        ▼                  ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ TmuxClaude   │  │ CIN-API      │  │ Docker       │  │ Custom       │
│ Adapter      │  │ Adapter      │  │ Adapter      │  │ Adapter      │
│              │  │              │  │              │  │              │
│ (current)    │  │ (planned)    │  │ (future)     │  │ (extensible) │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
        │                  │                   │                   │
        ▼                  ▼                   ▼                   ▼
   tmux + CLI         REST API          Docker API          Any Backend
```

## Core Interfaces

### SessionAdapter Interface

```typescript
/**
 * Adapter for managing agent sessions across different backends
 */
interface SessionAdapter {
  /** Unique identifier for this adapter type */
  readonly type: string;
  
  /** Human-readable name */
  readonly displayName: string;
  
  /** Check if this adapter is available/configured */
  isAvailable(): Promise<boolean>;
  
  /** Create a new session */
  createSession(options: CreateSessionOptions): Promise<AdapterSession>;
  
  /** Get session by ID */
  getSession(id: string): Promise<AdapterSession | null>;
  
  /** List all sessions */
  listSessions(): Promise<AdapterSession[]>;
  
  /** Send a prompt to a session */
  sendPrompt(sessionId: string, prompt: string): Promise<PromptResult>;
  
  /** Cancel current operation */
  cancelOperation(sessionId: string): Promise<void>;
  
  /** Restart an offline session */
  restartSession(sessionId: string): Promise<AdapterSession>;
  
  /** Terminate and remove a session */
  deleteSession(sessionId: string): Promise<void>;
  
  /** Subscribe to events from this adapter */
  onEvent(callback: (event: AdapterEvent) => void): () => void;
  
  /** Cleanup resources */
  dispose(): Promise<void>;
}
```

### Canonical Data Types

```typescript
/**
 * Unified session representation
 */
interface AdapterSession {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'waiting' | 'offline' | 'error';
  adapterType: string;           // Which adapter manages this
  createdAt: number;
  lastActivity: number;
  cwd?: string;
  
  // Optional metadata
  metadata?: {
    // tmux adapter specific
    tmuxSession?: string;
    
    // CIN-API specific
    apiSessionId?: string;
    
    // Docker adapter specific
    containerId?: string;
    
    // Any adapter can add custom metadata
    [key: string]: unknown;
  };
  
  // Linked agent session ID (for event correlation)
  agentSessionId?: string;
  
  // Current tool being executed
  currentTool?: string;
  
  // Additional status details
  statusMessage?: string;
}

/**
 * Session creation options
 */
interface CreateSessionOptions {
  name?: string;
  cwd?: string;
  adapterType?: string;          // Which adapter to use
  
  // Adapter-specific options
  adapterOptions?: {
    // tmux adapter
    flags?: {
      continue?: boolean;
      skipPermissions?: boolean;
      chrome?: boolean;
    };
    
    // CIN-API adapter
    apiKey?: string;
    model?: string;
    systemPrompt?: string;
    
    // Docker adapter
    image?: string;
    volumes?: string[];
    
    [key: string]: unknown;
  };
}

/**
 * Prompt send result
 */
interface PromptResult {
  ok: boolean;
  error?: string;
  promptId?: string;             // For tracking
}

/**
 * Canonical event format
 * All adapters must translate their events to this format
 */
interface AdapterEvent {
  id: string;
  timestamp: number;
  sessionId: string;             // Managed session ID
  agentSessionId?: string;       // Agent's internal session ID
  adapterType: string;
  
  type: 'tool_start' | 'tool_end' | 'prompt_submitted' | 
        'response_complete' | 'error' | 'status_change' |
        'permission_request' | 'permission_response' |
        'session_start' | 'session_end';
  
  // Tool-related
  tool?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  duration?: number;
  success?: boolean;
  
  // Text content
  text?: string;
  
  // Permission-related
  permissionPrompt?: {
    tool: string;
    context: string;
    options: { number: string; label: string; }[];
  };
  
  // Error details
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  
  // Working directory context
  cwd?: string;
}
```

## Adapter Implementations

### 1. TmuxClaudeAdapter (Current Behavior)

```typescript
class TmuxClaudeAdapter implements SessionAdapter {
  readonly type = 'tmux-claude';
  readonly displayName = 'Claude Code (tmux)';
  
  private sessions = new Map<string, TmuxSession>();
  private pollIntervals = new Map<string, NodeJS.Timer>();
  
  async isAvailable(): Promise<boolean> {
    // Check tmux and claude are installed
    return await this.checkTmux() && await this.checkClaude();
  }
  
  async createSession(options: CreateSessionOptions): Promise<AdapterSession> {
    const tmuxSession = `vibecraft-${shortId()}`;
    const claudeCmd = this.buildClaudeCommand(options);
    
    await execFileAsync('tmux', [
      'new-session', '-d', '-s', tmuxSession,
      '-c', options.cwd || process.cwd(),
      `PATH='${EXEC_PATH}' ${claudeCmd}`
    ]);
    
    const session = {
      id: randomUUID(),
      name: options.name || `Claude ${++this.counter}`,
      status: 'idle' as const,
      adapterType: this.type,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      cwd: options.cwd,
      metadata: { tmuxSession }
    };
    
    this.sessions.set(session.id, session);
    this.startPolling(session.id);
    
    return session;
  }
  
  async sendPrompt(sessionId: string, prompt: string): Promise<PromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    
    await this.sendToTmuxSafe(session.metadata.tmuxSession, prompt);
    return { ok: true };
  }
  
  // ... other methods
}
```

### 2. CINApiAdapter (Planned)

```typescript
class CINApiAdapter implements SessionAdapter {
  readonly type = 'cin-api';
  readonly displayName = 'CIN-API';
  
  private apiBaseUrl: string;
  private apiKey: string;
  private ws: WebSocket | null = null;
  
  constructor(config: { apiUrl: string; apiKey: string }) {
    this.apiBaseUrl = config.apiUrl;
    this.apiKey = config.apiKey;
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiBaseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
  
  async createSession(options: CreateSessionOptions): Promise<AdapterSession> {
    const res = await fetch(`${this.apiBaseUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.adapterOptions?.model,
        systemPrompt: options.adapterOptions?.systemPrompt,
        workingDirectory: options.cwd
      })
    });
    
    const data = await res.json();
    
    return {
      id: randomUUID(),
      name: options.name || `CIN Session ${data.id}`,
      status: 'idle',
      adapterType: this.type,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      cwd: options.cwd,
      metadata: { apiSessionId: data.id }
    };
  }
  
  async sendPrompt(sessionId: string, prompt: string): Promise<PromptResult> {
    const session = await this.getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    
    const res = await fetch(
      `${this.apiBaseUrl}/sessions/${session.metadata.apiSessionId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: prompt })
      }
    );
    
    return { ok: res.ok };
  }
  
  onEvent(callback: (event: AdapterEvent) => void): () => void {
    // Connect to CIN-API WebSocket for real-time events
    this.ws = new WebSocket(`${this.apiBaseUrl.replace('http', 'ws')}/events`);
    
    this.ws.onmessage = (msg) => {
      const cinEvent = JSON.parse(msg.data);
      const adapterEvent = this.translateEvent(cinEvent);
      callback(adapterEvent);
    };
    
    return () => {
      this.ws?.close();
      this.ws = null;
    };
  }
  
  private translateEvent(cinEvent: CINEvent): AdapterEvent {
    // Translate CIN-API event format to canonical format
    return {
      id: cinEvent.id,
      timestamp: cinEvent.timestamp,
      sessionId: this.findManagedSession(cinEvent.sessionId),
      agentSessionId: cinEvent.sessionId,
      adapterType: this.type,
      type: this.mapEventType(cinEvent.type),
      tool: cinEvent.toolName,
      toolInput: cinEvent.toolInput,
      toolOutput: cinEvent.toolOutput,
      cwd: cinEvent.workingDirectory
    };
  }
}
```

### 3. DockerAdapter (Future)

```typescript
class DockerAdapter implements SessionAdapter {
  readonly type = 'docker';
  readonly displayName = 'Docker Container';
  
  async createSession(options: CreateSessionOptions): Promise<AdapterSession> {
    const container = await docker.createContainer({
      Image: options.adapterOptions?.image || 'claude-code:latest',
      Cmd: ['claude', '-c'],
      Tty: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: options.adapterOptions?.volumes || []
      }
    });
    
    await container.start();
    
    return {
      id: randomUUID(),
      name: options.name || `Container ${container.id.slice(0, 12)}`,
      status: 'idle',
      adapterType: this.type,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      metadata: { containerId: container.id }
    };
  }
  
  // ... other methods
}
```

## Adapter Registry

```typescript
class AdapterRegistry {
  private adapters = new Map<string, SessionAdapter>();
  private defaultAdapter: string = 'tmux-claude';
  
  register(adapter: SessionAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }
  
  get(type: string): SessionAdapter | undefined {
    return this.adapters.get(type);
  }
  
  getDefault(): SessionAdapter {
    const adapter = this.adapters.get(this.defaultAdapter);
    if (!adapter) throw new Error('No default adapter configured');
    return adapter;
  }
  
  setDefault(type: string): void {
    if (!this.adapters.has(type)) {
      throw new Error(`Adapter ${type} not registered`);
    }
    this.defaultAdapter = type;
  }
  
  async listAvailable(): Promise<string[]> {
    const available: string[] = [];
    for (const [type, adapter] of this.adapters) {
      if (await adapter.isAvailable()) {
        available.push(type);
      }
    }
    return available;
  }
  
  getAllTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

## Server Integration

### Session Manager Refactoring

```typescript
class SessionManager {
  private registry: AdapterRegistry;
  private sessions = new Map<string, AdapterSession>();
  
  constructor(registry: AdapterRegistry) {
    this.registry = registry;
  }
  
  async createSession(options: CreateSessionOptions): Promise<AdapterSession> {
    const adapterType = options.adapterType || this.registry.getDefault().type;
    const adapter = this.registry.get(adapterType);
    
    if (!adapter) {
      throw new Error(`Unknown adapter: ${adapterType}`);
    }
    
    if (!await adapter.isAvailable()) {
      throw new Error(`Adapter ${adapterType} is not available`);
    }
    
    const session = await adapter.createSession(options);
    this.sessions.set(session.id, session);
    
    return session;
  }
  
  async sendPrompt(sessionId: string, prompt: string): Promise<PromptResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    
    const adapter = this.registry.get(session.adapterType);
    if (!adapter) return { ok: false, error: 'Adapter not found' };
    
    return adapter.sendPrompt(sessionId, prompt);
  }
  
  // ... other methods delegate to appropriate adapter
}
```

### API Changes

```typescript
// POST /sessions - now accepts adapterType
app.post('/sessions', async (req, res) => {
  const options = req.body as CreateSessionOptions;
  
  // Optionally specify adapter
  // If not specified, uses default
  const session = await sessionManager.createSession({
    ...options,
    adapterType: options.adapterType
  });
  
  res.json({ ok: true, session });
});

// GET /adapters - list available adapters
app.get('/adapters', async (req, res) => {
  const available = await registry.listAvailable();
  const all = registry.getAllTypes().map(type => {
    const adapter = registry.get(type)!;
    return {
      type,
      displayName: adapter.displayName,
      available: available.includes(type)
    };
  });
  
  res.json({ adapters: all });
});
```

## Event Normalization

Each adapter is responsible for translating its native events to the canonical `AdapterEvent` format. The server's event processing remains the same:

```typescript
function handleAdapterEvent(event: AdapterEvent): void {
  // Update session status
  const session = sessions.get(event.sessionId);
  if (session) {
    updateSessionFromEvent(session, event);
  }
  
  // Broadcast to clients (same format for all adapters)
  broadcast({
    type: 'event',
    payload: event
  });
}
```

## Migration Path

1. **Phase 1**: Create adapter interface, refactor current tmux code into TmuxClaudeAdapter
2. **Phase 2**: Update SessionManager to use registry
3. **Phase 3**: Add API endpoints for adapter management
4. **Phase 4**: Implement CINApiAdapter
5. **Phase 5**: Add UI for adapter selection

## Configuration

```typescript
// config.ts
interface AdapterConfig {
  adapters: {
    'tmux-claude': {
      enabled: boolean;
      default: boolean;
    };
    'cin-api': {
      enabled: boolean;
      apiUrl: string;
      apiKey: string;
    };
    'docker': {
      enabled: boolean;
      socketPath: string;
    };
  };
}
```

## Testing

Each adapter should have:
1. Unit tests for session lifecycle
2. Integration tests with mock backend
3. Event translation tests

```typescript
describe('SessionAdapter', () => {
  it('should implement required interface', () => {
    const adapter = new TmuxClaudeAdapter();
    expect(adapter.type).toBeDefined();
    expect(adapter.createSession).toBeInstanceOf(Function);
    // ...
  });
  
  it('should normalize events to canonical format', () => {
    const rawEvent = { /* adapter-specific */ };
    const normalized = adapter.translateEvent(rawEvent);
    expect(normalized.type).toMatch(/^(tool_start|tool_end|...)$/);
    expect(normalized.sessionId).toBeDefined();
  });
});
```
