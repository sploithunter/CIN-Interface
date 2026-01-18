# CIN-Interface Test Specification

## Overview

This document specifies tests for CIN-Interface covering:
1. **Backend API Tests** - Fast, automated HTTP/WebSocket tests
2. **Integration Tests** - Event flow, session management, file watchers
3. **Frontend E2E Tests** - UI interactions through the browser
4. **Future Feature Tests** - Planned for upcoming features

## Test Infrastructure

### Recommended Stack
- **Backend Tests**: Vitest or Jest + supertest (HTTP) + ws (WebSocket)
- **Frontend E2E**: Playwright or Cypress
- **Test Data**: Fixtures in `tests/fixtures/`
- **Mocks**: Mock tmux, file system for isolated tests

### Directory Structure
```
tests/
├── backend/
│   ├── api/
│   │   ├── health.test.ts
│   │   ├── sessions.test.ts
│   │   ├── events.test.ts
│   │   └── tiles.test.ts
│   ├── integration/
│   │   ├── event-flow.test.ts
│   │   ├── session-lifecycle.test.ts
│   │   └── codex-watcher.test.ts
│   └── websocket/
│       ├── connection.test.ts
│       ├── broadcast.test.ts
│       └── history.test.ts
├── e2e/
│   ├── session-management.spec.ts
│   ├── activity-feed.spec.ts
│   ├── 3d-visualization.spec.ts
│   └── prompt-input.spec.ts
├── fixtures/
│   ├── events.jsonl
│   ├── sessions.json
│   └── codex-session.jsonl
└── setup.ts
```

---

## Backend API Tests

### 1. Health & Config Endpoints

#### GET /health
```typescript
describe('GET /health', () => {
  it('returns server status with version', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      version: expect.any(String),
      uptime: expect.any(Number),
      clients: expect.any(Number),
      events: expect.any(Number),
      sessions: expect.any(Number)
    });
  });
});
```

#### GET /config
```typescript
describe('GET /config', () => {
  it('returns user and hostname', async () => {
    const res = await request(app).get('/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: expect.any(String),
      hostname: expect.any(String)
    });
  });
});
```

#### GET /stats
```typescript
describe('GET /stats', () => {
  it('returns tool usage statistics', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(200);
    expect(res.body.tools).toBeDefined();
  });
});
```

---

### 2. Session Management

#### GET /sessions
```typescript
describe('GET /sessions', () => {
  it('returns list of all sessions', async () => {
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('includes required session fields', async () => {
    const res = await request(app).get('/sessions');
    const session = res.body.sessions[0];
    if (session) {
      expect(session).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        type: expect.stringMatching(/^(internal|external)$/),
        status: expect.stringMatching(/^(idle|working|waiting|offline)$/),
        createdAt: expect.any(Number),
        lastActivity: expect.any(Number)
      });
    }
  });

  it('includes agent type for sessions', async () => {
    const res = await request(app).get('/sessions');
    res.body.sessions.forEach((session: any) => {
      expect(session.agent).toMatch(/^(claude|codex)$/);
    });
  });
});
```

#### POST /sessions (Create Internal Session)
```typescript
describe('POST /sessions', () => {
  it('creates internal session with valid cwd', async () => {
    const res = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project', name: 'Test Session' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.session).toMatchObject({
      name: 'Test Session',
      type: 'internal',
      agent: 'claude',
      cwd: '/tmp/test-project'
    });
  });

  it('rejects invalid directory', async () => {
    const res = await request(app)
      .post('/sessions')
      .send({ cwd: '/nonexistent/path' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('creates session at specified zonePosition', async () => {
    const res = await request(app)
      .post('/sessions')
      .send({
        cwd: '/tmp/test-project',
        zonePosition: { q: 1, r: 0 }
      });

    expect(res.body.session.zonePosition).toEqual({ q: 1, r: 0 });
  });

  it('supports continue flag', async () => {
    const res = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project', continue: true });

    expect(res.status).toBe(200);
    // Verify tmux command includes -c flag (mock verification)
  });
});
```

#### PATCH /sessions/:id
```typescript
describe('PATCH /sessions/:id', () => {
  let sessionId: string;

  beforeEach(async () => {
    // Create a test session
    const res = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project' });
    sessionId = res.body.session.id;
  });

  it('updates session name', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .send({ name: 'Renamed Session' });

    expect(res.status).toBe(200);
    expect(res.body.session.name).toBe('Renamed Session');
  });

  it('updates zonePosition', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .send({ zonePosition: { q: 2, r: -1 } });

    expect(res.body.session.zonePosition).toEqual({ q: 2, r: -1 });
  });

  it('unplaces session with null zonePosition', async () => {
    const res = await request(app)
      .patch(`/sessions/${sessionId}`)
      .send({ zonePosition: null });

    expect(res.body.session.zonePosition).toBeUndefined();
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await request(app)
      .patch('/sessions/nonexistent-id')
      .send({ name: 'Test' });

    expect(res.status).toBe(404);
  });
});
```

#### DELETE /sessions/:id
```typescript
describe('DELETE /sessions/:id', () => {
  it('deletes session and returns success', async () => {
    // Create session first
    const createRes = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project' });
    const sessionId = createRes.body.session.id;

    const res = await request(app).delete(`/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify session is gone
    const listRes = await request(app).get('/sessions');
    expect(listRes.body.sessions.find((s: any) => s.id === sessionId)).toBeUndefined();
  });

  it('returns 404 for nonexistent session', async () => {
    const res = await request(app).delete('/sessions/nonexistent-id');
    expect(res.status).toBe(404);
  });
});
```

#### DELETE /sessions/cleanup
```typescript
describe('DELETE /sessions/cleanup', () => {
  it('removes all offline sessions', async () => {
    // Setup: create sessions and mark some offline
    const res = await request(app).delete('/sessions/cleanup');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBeGreaterThanOrEqual(0);
  });
});
```

#### POST /sessions/:id/prompt
```typescript
describe('POST /sessions/:id/prompt', () => {
  it('sends prompt to internal session', async () => {
    // Create internal session
    const createRes = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project' });
    const sessionId = createRes.body.session.id;

    const res = await request(app)
      .post(`/sessions/${sessionId}/prompt`)
      .send({ prompt: 'Hello, Claude!' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects prompt to external session', async () => {
    // External sessions can't receive prompts (no tmux control)
    // This test requires an external session fixture
  });
});
```

#### POST /sessions/:id/cancel
```typescript
describe('POST /sessions/:id/cancel', () => {
  it('sends Ctrl+C to session', async () => {
    const createRes = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project' });
    const sessionId = createRes.body.session.id;

    const res = await request(app)
      .post(`/sessions/${sessionId}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

#### POST /sessions/:id/restart
```typescript
describe('POST /sessions/:id/restart', () => {
  it('restarts offline internal session', async () => {
    // Create session, mark offline, then restart
    const createRes = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test-project' });
    const sessionId = createRes.body.session.id;

    // Simulate offline (mock tmux exit)

    const res = await request(app)
      .post(`/sessions/${sessionId}/restart`);

    expect(res.status).toBe(200);
    expect(res.body.session.status).not.toBe('offline');
  });

  it('rejects restart of external session', async () => {
    // External sessions can't be restarted
  });
});
```

---

### 3. Event Handling

#### POST /event
```typescript
describe('POST /event', () => {
  it('accepts valid hook event', async () => {
    const event = {
      id: 'test-event-1',
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'test-session',
      cwd: '/tmp/test',
      tool: 'Bash',
      toolInput: { command: 'ls -la' }
    };

    const res = await request(app)
      .post('/event')
      .send(event);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('creates external session for unknown sessionId', async () => {
    const event = {
      id: 'test-event-2',
      type: 'session_start',
      timestamp: Date.now(),
      sessionId: 'new-claude-session',
      cwd: '/tmp/new-project'
    };

    await request(app).post('/event').send(event);

    const sessionsRes = await request(app).get('/sessions');
    const newSession = sessionsRes.body.sessions.find(
      (s: any) => s.claudeSessionId === 'new-claude-session'
    );
    expect(newSession).toBeDefined();
    expect(newSession.type).toBe('external');
  });

  it('updates session status on tool events', async () => {
    // pre_tool_use should set status to 'working'
    // post_tool_use should clear currentTool
    // stop should set status to 'waiting'
  });
});
```

---

### 4. Tiles API

#### GET /tiles
```typescript
describe('GET /tiles', () => {
  it('returns list of text tiles', async () => {
    const res = await request(app).get('/tiles');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.tiles)).toBe(true);
  });
});
```

#### POST /tiles
```typescript
describe('POST /tiles', () => {
  it('creates new text tile', async () => {
    const res = await request(app)
      .post('/tiles')
      .send({
        text: 'Test Label',
        position: { q: 0, r: 0 }
      });

    expect(res.status).toBe(200);
    expect(res.body.tile).toMatchObject({
      text: 'Test Label',
      position: { q: 0, r: 0 }
    });
  });
});
```

---

### 5. Projects API

#### GET /projects
```typescript
describe('GET /projects', () => {
  it('returns known project directories', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.projects)).toBe(true);
  });
});
```

#### GET /projects/autocomplete
```typescript
describe('GET /projects/autocomplete', () => {
  it('returns path completions', async () => {
    const res = await request(app)
      .get('/projects/autocomplete')
      .query({ path: '/tmp' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.completions)).toBe(true);
  });

  it('filters by prefix', async () => {
    const res = await request(app)
      .get('/projects/autocomplete')
      .query({ path: '/tmp/t' });

    res.body.completions.forEach((c: string) => {
      expect(c.startsWith('/tmp/t')).toBe(true);
    });
  });
});
```

---

## WebSocket Tests

### Connection & Authentication
```typescript
describe('WebSocket Connection', () => {
  it('accepts connection from localhost', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForOpen(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('sends connected message with initial data', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    const message = await waitForMessage(ws);

    expect(message.type).toBe('connected');
    expect(message.payload).toMatchObject({
      version: expect.any(String),
      username: expect.any(String)
    });
    ws.close();
  });

  it('sends sessions list on connect', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForMessage(ws); // connected
    const sessionsMsg = await waitForMessage(ws);

    expect(sessionsMsg.type).toBe('sessions');
    expect(Array.isArray(sessionsMsg.payload)).toBe(true);
    ws.close();
  });
});
```

### Event Broadcasting
```typescript
describe('WebSocket Broadcasting', () => {
  it('broadcasts events to all clients', async () => {
    const ws1 = new WebSocket('ws://localhost:4003');
    const ws2 = new WebSocket('ws://localhost:4003');
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    // Skip initial messages
    await drainMessages(ws1, 3);
    await drainMessages(ws2, 3);

    // Post event via HTTP
    const event = {
      id: 'broadcast-test',
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'test',
      cwd: '/tmp',
      tool: 'Bash'
    };
    await request(app).post('/event').send(event);

    // Both clients should receive
    const msg1 = await waitForMessage(ws1);
    const msg2 = await waitForMessage(ws2);

    expect(msg1.type).toBe('event');
    expect(msg2.type).toBe('event');
    expect(msg1.payload.id).toBe('broadcast-test');

    ws1.close();
    ws2.close();
  });

  it('broadcasts session updates', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForOpen(ws);
    await drainMessages(ws, 3);

    // Create session via HTTP
    await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test' });

    const msg = await waitForMessage(ws);
    expect(msg.type).toBe('sessions');
    ws.close();
  });
});
```

### History Request
```typescript
describe('WebSocket History', () => {
  it('responds to get_history request', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForOpen(ws);
    await drainMessages(ws, 3);

    ws.send(JSON.stringify({ type: 'get_history', payload: { limit: 50 } }));
    const msg = await waitForMessage(ws);

    expect(msg.type).toBe('history');
    expect(Array.isArray(msg.payload)).toBe(true);
    expect(msg.payload.length).toBeLessThanOrEqual(50);
    ws.close();
  });
});
```

---

## Integration Tests

### Event Flow (Unified)
```typescript
describe('Event Flow', () => {
  it('Claude hook event → file → broadcast', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForOpen(ws);
    await drainMessages(ws, 3);

    // Simulate hook writing to events.jsonl
    const event = {
      id: 'flow-test-1',
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'claude-session',
      cwd: '/tmp/test',
      tool: 'Read'
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    // Should receive via WebSocket
    const msg = await waitForMessage(ws, 2000);
    expect(msg.type).toBe('event');
    expect(msg.payload.id).toBe('flow-test-1');
    ws.close();
  });

  it('Codex event → file → broadcast with codexThreadId', async () => {
    const ws = new WebSocket('ws://localhost:4003');
    await waitForOpen(ws);
    await drainMessages(ws, 3);

    // Simulate CodexWatcher writing event
    const event = {
      id: 'codex-flow-test',
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: 'codex-thread-123',
      cwd: '/tmp/codex-project',
      tool: 'shell',
      codexThreadId: 'codex-thread-123'
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');

    const msg = await waitForMessage(ws, 2000);
    expect(msg.type).toBe('event');
    expect(msg.payload.codexThreadId).toBe('codex-thread-123');
    ws.close();
  });
});
```

### Session Lifecycle
```typescript
describe('Session Lifecycle', () => {
  it('internal session: create → working → idle → offline', async () => {
    // Create
    const createRes = await request(app)
      .post('/sessions')
      .send({ cwd: '/tmp/test' });
    const sessionId = createRes.body.session.id;
    expect(createRes.body.session.status).toBe('idle');

    // Simulate tool use → working
    await request(app).post('/event').send({
      id: 'lifecycle-1',
      type: 'pre_tool_use',
      timestamp: Date.now(),
      sessionId: createRes.body.session.claudeSessionId,
      cwd: '/tmp/test',
      tool: 'Bash'
    });

    let session = (await request(app).get(`/sessions`)).body.sessions
      .find((s: any) => s.id === sessionId);
    expect(session.status).toBe('working');

    // Simulate stop → waiting
    await request(app).post('/event').send({
      id: 'lifecycle-2',
      type: 'stop',
      timestamp: Date.now(),
      sessionId: createRes.body.session.claudeSessionId,
      cwd: '/tmp/test'
    });

    session = (await request(app).get(`/sessions`)).body.sessions
      .find((s: any) => s.id === sessionId);
    expect(session.status).toBe('waiting');
  });

  it('external sessions never auto-deleted', async () => {
    // Create external session via event
    await request(app).post('/event').send({
      id: 'external-1',
      type: 'session_start',
      timestamp: Date.now(),
      sessionId: 'external-claude',
      cwd: '/tmp/external'
    });

    // Wait for cleanup interval (mock time)
    // External session should still exist
  });
});
```

### Codex Session Watcher
```typescript
describe('CodexSessionWatcher', () => {
  it('detects new Codex session files', async () => {
    // Create mock Codex session file
    const sessionDir = path.join(CODEX_SESSIONS_DIR, '2026/01/18');
    fs.mkdirSync(sessionDir, { recursive: true });

    const sessionFile = path.join(sessionDir, 'rollout-test.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'session_meta',
      payload: { cwd: '/tmp/codex-test' }
    }) + '\n');

    // Wait for watcher to detect
    await sleep(500);

    const sessions = (await request(app).get('/sessions')).body.sessions;
    const codexSession = sessions.find((s: any) =>
      s.agent === 'codex' && s.cwd === '/tmp/codex-test'
    );
    expect(codexSession).toBeDefined();
  });

  it('marks Codex session offline after 30 min inactivity', async () => {
    // Create Codex session with old mtime
    // Trigger health check
    // Verify status is 'offline'
  });
});
```

---

## Frontend E2E Tests

### Session Management
```typescript
describe('Session Management UI', () => {
  beforeEach(async () => {
    await page.goto('http://localhost:4003');
    await page.waitForSelector('#managed-sessions');
  });

  it('displays all sessions', async () => {
    const sessionCards = await page.$$('.session-card');
    expect(sessionCards.length).toBeGreaterThan(0);
  });

  it('shows correct status indicators', async () => {
    const workingDot = await page.$('.session-status-dot.working');
    const idleDot = await page.$('.session-status-dot.idle');
    // At least one status indicator should exist
    expect(workingDot || idleDot).toBeTruthy();
  });

  it('shows CLAUDE + EXT tags for external Claude sessions', async () => {
    const claudeTag = await page.$('.session-agent-tag.claude');
    const extTag = await page.$('.session-type-tag');
    // If external Claude session exists
    if (claudeTag) {
      expect(extTag).toBeTruthy();
    }
  });

  it('shows CODEX + EXT tags for Codex sessions', async () => {
    const codexTag = await page.$('.session-agent-tag.codex');
    // If Codex session exists
    if (codexTag) {
      const parent = await codexTag.evaluateHandle(el => el.closest('.session-card-detail'));
      const extTag = await parent.$('.session-type-tag');
      expect(extTag).toBeTruthy();
    }
  });

  it('clicking session card selects it', async () => {
    const firstCard = await page.$('.session-card');
    await firstCard?.click();

    const selectedCard = await page.$('.session-card.selected');
    expect(selectedCard).toBeTruthy();
  });

  it('shows delete button on hover', async () => {
    const card = await page.$('.session-card');
    await card?.hover();

    const deleteBtn = await page.$('.session-action-btn.delete');
    expect(deleteBtn).toBeTruthy();
  });

  it('creates new session via modal', async () => {
    await page.click('#new-session-btn');
    await page.waitForSelector('#new-session-modal:not(.hidden)');

    await page.fill('#session-cwd-input', '/tmp/e2e-test');
    await page.fill('#session-name-input', 'E2E Test Session');
    await page.click('#modal-create');

    // Wait for modal to close and session to appear
    await page.waitForSelector('#new-session-modal.hidden');
    const newSession = await page.$('.session-name:has-text("E2E Test Session")');
    expect(newSession).toBeTruthy();
  });
});
```

### Activity Feed
```typescript
describe('Activity Feed', () => {
  beforeEach(async () => {
    await page.goto('http://localhost:4003');
    await page.waitForSelector('#activity-feed');
  });

  it('displays events in feed', async () => {
    const feedItems = await page.$$('.feed-item');
    // May be empty if no events, but feed should exist
    expect(await page.$('#activity-feed')).toBeTruthy();
  });

  it('filters events by selected session', async () => {
    // Select a specific session
    const firstCard = await page.$('.session-card');
    await firstCard?.click();

    // Events should be filtered (or empty if no events for session)
    const feedItems = await page.$$('.feed-item');
    // Verify events belong to selected session
  });

  it('shows all events when "All Sessions" selected', async () => {
    await page.click('.all-sessions-row');
    // All events should be visible
  });

  it('expands/collapses Task events', async () => {
    const taskToggle = await page.$('.task-toggle');
    if (taskToggle) {
      await taskToggle.click();
      const expanded = await page.$('.task-toggle.expanded');
      expect(expanded).toBeTruthy();

      await taskToggle.click();
      const collapsed = await page.$('.task-toggle:not(.expanded)');
      expect(collapsed).toBeTruthy();
    }
  });

  it('expands/collapses Bash output', async () => {
    const bashToggle = await page.$('.bash-toggle');
    if (bashToggle) {
      await bashToggle.click();
      expect(await page.$('.bash-toggle.expanded')).toBeTruthy();
    }
  });

  it('expands/collapses long responses', async () => {
    const responseToggle = await page.$('.response-toggle');
    if (responseToggle) {
      await responseToggle.click();
      expect(await page.$('.response-toggle.expanded')).toBeTruthy();
    }
  });
});
```

### Prompt Input
```typescript
describe('Prompt Input', () => {
  beforeEach(async () => {
    await page.goto('http://localhost:4003');
  });

  it('enables send button when session selected and text entered', async () => {
    // Select a session
    const card = await page.$('.session-card');
    await card?.click();

    // Type in prompt
    await page.fill('#prompt-input', 'Test prompt');

    const sendBtn = await page.$('#prompt-submit:not([disabled])');
    expect(sendBtn).toBeTruthy();
  });

  it('Enter key submits prompt', async () => {
    const card = await page.$('.session-card');
    await card?.click();

    await page.fill('#prompt-input', 'Test prompt');
    await page.press('#prompt-input', 'Enter');

    // Verify prompt was sent (input cleared or status changed)
  });

  it('Shift+Enter adds newline', async () => {
    await page.fill('#prompt-input', 'Line 1');
    await page.press('#prompt-input', 'Shift+Enter');
    await page.type('#prompt-input', 'Line 2');

    const value = await page.$eval('#prompt-input', (el: HTMLTextAreaElement) => el.value);
    expect(value).toContain('\n');
  });

  it('shows target session name', async () => {
    const card = await page.$('.session-card');
    const sessionName = await card?.$eval('.session-name', el => el.textContent);
    await card?.click();

    const target = await page.$eval('#prompt-target', el => el.textContent);
    expect(target).toContain(sessionName);
  });
});
```

### 3D Visualization
```typescript
describe('3D Visualization', () => {
  beforeEach(async () => {
    await page.goto('http://localhost:4003');
    await page.waitForSelector('#canvas-container canvas');
  });

  it('renders Three.js canvas', async () => {
    const canvas = await page.$('#canvas-container canvas');
    expect(canvas).toBeTruthy();
  });

  it('minimizes/maximizes with M key', async () => {
    await page.press('body', 'm');
    const minimized = await page.$('#scene-panel.minimized');
    expect(minimized).toBeTruthy();

    await page.press('body', 'm');
    const maximized = await page.$('#scene-panel:not(.minimized)');
    expect(maximized).toBeTruthy();
  });

  it('clicking hex shows context menu', async () => {
    // Click on empty hex area
    const canvas = await page.$('#canvas-container canvas');
    await canvas?.click({ position: { x: 200, y: 200 } });

    // Context menu may appear if clicked on empty hex
    // This is tricky to test without knowing hex positions
  });
});
```

### Modals
```typescript
describe('Modals', () => {
  beforeEach(async () => {
    await page.goto('http://localhost:4003');
  });

  it('opens and closes new session modal', async () => {
    await page.click('#new-session-btn');
    expect(await page.$('#new-session-modal:not(.hidden)')).toBeTruthy();

    await page.click('#modal-cancel');
    expect(await page.$('#new-session-modal.hidden')).toBeTruthy();
  });

  it('opens and closes settings modal', async () => {
    await page.click('#settings-btn');
    expect(await page.$('#settings-modal:not(.hidden)')).toBeTruthy();

    await page.click('#settings-close');
    expect(await page.$('#settings-modal.hidden')).toBeTruthy();
  });

  it('opens and closes about modal', async () => {
    await page.click('#about-btn');
    expect(await page.$('#about-modal:not(.hidden)')).toBeTruthy();

    await page.click('#about-close');
    expect(await page.$('#about-modal.hidden')).toBeTruthy();
  });
});
```

---

## Future Feature Tests (Planned)

### Permission Prompt Handling
```typescript
describe('Permission Prompts', () => {
  it('displays permission prompt in UI', async () => {
    // Simulate permission_prompt WebSocket message
    // Verify prompt appears in UI
  });

  it('sends permission response via UI', async () => {
    // Click permission option
    // Verify response sent to backend
  });

  it('clears prompt after resolution', async () => {
    // Simulate permission_resolved message
    // Verify prompt disappears
  });
});
```

### Image Drag & Drop
```typescript
describe('Image Upload', () => {
  it('accepts dropped image', async () => {
    // Simulate drag and drop of image file
    // Verify image is attached to prompt
  });

  it('shows image preview', async () => {
    // After drop, preview should be visible
  });

  it('sends image path with prompt', async () => {
    // Submit prompt with image
    // Verify image path included
  });
});
```

### File Explorer
```typescript
describe('File Explorer', () => {
  it('shows edited files for session', async () => {
    // Select session with file edits
    // Verify file list appears
  });

  it('clicking file shows diff', async () => {
    // Click on file in explorer
    // Verify diff view opens
  });
});
```

### Remote Access
```typescript
describe('Remote Access', () => {
  it('connects via relay server', async () => {
    // Connect to relay URL
    // Verify connection established
  });

  it('authenticates with token', async () => {
    // Provide invalid token → reject
    // Provide valid token → accept
  });

  it('receives events via relay', async () => {
    // Events broadcast through relay
  });
});
```

---

## Test Utilities

```typescript
// tests/utils.ts

export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
    } else {
      ws.onopen = () => resolve();
      ws.onerror = reject;
    }
  });
}

export function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), timeout);
    ws.onmessage = (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(event.data));
    };
  });
}

export async function drainMessages(ws: WebSocket, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await waitForMessage(ws);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Running Tests

```bash
# Run all backend tests
npm run test:backend

# Run specific test file
npm run test:backend -- api/sessions.test.ts

# Run E2E tests (requires server running)
npm run test:e2e

# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:backend

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx playwright install
      - run: npm run build
      - run: npm run test:e2e
```
