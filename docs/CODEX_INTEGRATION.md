# OpenAI Codex CLI Integration Spec

## Overview

This document specifies how to integrate OpenAI Codex CLI into CIN-Interface as the first non-Claude agent. The goal is to allow users to monitor and interact with Codex sessions alongside Claude Code sessions in the same unified interface.

## Research Summary

### Codex CLI Capabilities

OpenAI Codex CLI is a terminal-based coding agent similar to Claude Code. Key features:

- **Local execution**: Runs in terminal, can read/write files, execute commands
- **Session persistence**: Stores session logs in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **JSON output mode**: `--json` flag outputs newline-delimited JSON events
- **Notification hooks**: `notify` config runs external program on events
- **SDK available**: `@openai/codex-sdk` for programmatic control

### Integration Points Comparison

| Feature | Claude Code | Codex CLI |
|---------|-------------|-----------|
| Hook system | Rich (PreToolUse, PostToolUse, Stop, etc.) | Limited (`notify` only fires on `agent-turn-complete`) |
| JSON events | Via hooks stdin | `--json` flag or session JSONL files |
| Session files | None (hooks are real-time) | `~/.codex/sessions/` JSONL logs |
| Programmatic API | None | `@openai/codex-sdk` |
| Real-time events | Yes (hooks fire immediately) | Partial (notify hook, or poll session files) |

### Codex Event Types

From `--json` output mode:

| Event Type | Description |
|------------|-------------|
| `thread.started` | New conversation thread created |
| `turn.started` | Agent turn begins |
| `turn.completed` | Agent turn finishes (includes token usage) |
| `turn.failed` | Agent turn errored |
| `item.started` | Item processing begins |
| `item.completed` | Item processing complete |
| `error` | Error occurred |

Item types include:
- `agent_message` - Assistant text response
- `command_execution` - Shell command run
- `file_change` - File modification
- `mcp_tool_call` - MCP tool invocation
- `web_search` - Web search performed
- `plan_update` - Plan modification
- `reasoning` - Chain of thought

### Codex Session JSONL Format

Session files at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` contain:

```json
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello..."}}
{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"ls -la","output":"..."}}
{"type":"turn.completed","usage":{"input_tokens":1500,"cached_input_tokens":1000,"output_tokens":500}}
```

## Recommended Integration Approach

### Primary: Session File Watcher

**Rationale**: Most reliable and doesn't require modifying how users run Codex.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CIN-Interface Server                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              CodexSessionWatcher                            │ │
│  │  - Watch ~/.codex/sessions/ for new/modified JSONL files   │ │
│  │  - Parse events and map to CIN-Interface format            │ │
│  │  - Detect active sessions by file modification time        │ │
│  │  - Emit events to existing WebSocket broadcast system      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Advantages**:
- No user setup required (Codex already writes these files)
- Full event history available
- Works with existing Codex workflows
- Session resume capability via file ID

**Disadvantages**:
- Slight delay (file system polling, ~1-2 seconds)
- Need to parse JSONL incrementally as files grow

### Secondary: Notify Hook (Optional Enhancement)

For users who want real-time events, they can configure Codex to notify CIN-Interface:

**~/.codex/config.toml**:
```toml
notify = ["curl", "-X", "POST", "-H", "Content-Type: application/json", "-d", "@-", "http://localhost:4003/event/codex"]
```

Or with a dedicated hook script:
```toml
notify = ["~/.cin-interface/hooks/codex-hook.sh"]
```

This provides instant notification on `agent-turn-complete` events.

### Tertiary: SDK Integration (Future)

For internal sessions created via CIN-Interface, use the SDK:

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();

// Stream events to CIN-Interface
thread.on('event', (event) => {
  broadcastEvent(mapCodexEvent(event));
});

await thread.run(prompt);
```

## Event Mapping

### Codex → CIN-Interface Event Translation

```typescript
interface CodexEvent {
  type: string;
  item?: {
    id: string;
    type: string;
    text?: string;
    command?: string;
    output?: string;
    file_path?: string;
    // ... other fields
  };
  usage?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

function mapCodexToCIN(codexEvent: CodexEvent, sessionId: string, cwd: string): CINEvent {
  const base = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    sessionId,
    cwd,
    agent: 'codex', // New field to identify agent type
  };

  switch (codexEvent.type) {
    case 'turn.started':
      return { ...base, type: 'session_start' };

    case 'turn.completed':
      return {
        ...base,
        type: 'stop',
        response: codexEvent.item?.text,
        tokens: codexEvent.usage,
      };

    case 'item.completed':
      return mapItemEvent(codexEvent.item, base);

    default:
      return { ...base, type: codexEvent.type };
  }
}

function mapItemEvent(item: CodexEvent['item'], base: object): CINEvent {
  if (!item) return { ...base, type: 'unknown' };

  switch (item.type) {
    case 'command_execution':
      return {
        ...base,
        type: 'post_tool_use',
        tool: 'Bash',
        toolInput: { command: item.command },
        toolResponse: item.output,
      };

    case 'file_change':
      return {
        ...base,
        type: 'post_tool_use',
        tool: 'Edit', // or 'Write' based on operation
        toolInput: { file_path: item.file_path },
      };

    case 'agent_message':
      return {
        ...base,
        type: 'stop',
        assistantText: item.text,
      };

    case 'web_search':
      return {
        ...base,
        type: 'post_tool_use',
        tool: 'WebSearch',
        toolInput: { query: item.query },
      };

    default:
      return { ...base, type: 'post_tool_use', tool: item.type };
  }
}
```

## Implementation Plan

### Phase 1: Session File Watcher (MVP)

1. **Create `CodexSessionWatcher` class** (`src/server/CodexSessionWatcher.ts`)
   - Watch `~/.codex/sessions/` directory recursively
   - Detect new JSONL files (new sessions)
   - Track file positions to read incremental updates
   - Parse JSONL and emit mapped events

2. **Add Codex session management**
   - Auto-detect Codex sessions from session files
   - Add `agent: 'codex' | 'claude'` field to `ManagedSession`
   - Session ID = Codex thread ID from filename

3. **Update frontend**
   - Add agent type badge (Claude icon vs Codex icon)
   - Different accent color for Codex sessions
   - Tool icons may differ slightly

### Phase 2: Notify Hook Integration

1. **Create Codex hook script** (`hooks/codex-hook.sh`)
   - Receives JSON from Codex notify
   - POSTs to `/event/codex` endpoint

2. **Add `/event/codex` endpoint**
   - Parse Codex notification format
   - Map to CIN-Interface event format
   - Correlate with session from watcher

3. **Setup command** (`bin/cli.js setup-codex`)
   - Adds notify config to `~/.codex/config.toml`

### Phase 3: Internal Codex Sessions (Future)

1. **SDK integration** for creating Codex sessions from UI
2. **Prompt sending** via SDK thread.run()
3. **Full parity** with Claude Code internal sessions

## File Structure

```
src/
├── server/
│   ├── index.ts
│   ├── CodexSessionWatcher.ts    # New: watches ~/.codex/sessions
│   ├── CodexEventMapper.ts       # New: maps Codex events to CIN format
│   ├── GitStatusManager.ts
│   └── ProjectsManager.ts
└── shared/
    └── types.ts                   # Add: agent field, Codex event types

hooks/
├── cin-hook.sh              # Existing Claude Code hook
└── codex-hook.sh                  # New: Codex notify hook
```

## Configuration

### New config options in `~/.cin-interface/config.json`:

```json
{
  "agents": {
    "claude": {
      "enabled": true,
      "hookInstalled": true
    },
    "codex": {
      "enabled": true,
      "sessionDir": "~/.codex/sessions",
      "watchEnabled": true,
      "notifyHookInstalled": false
    }
  }
}
```

## UI Changes

### Session Cards
- Add agent icon (Claude logo or Codex logo)
- Codex sessions get distinct accent color (e.g., green vs Claude's orange)

### Activity Feed
- Show agent badge on events
- Tool names may differ slightly (e.g., Codex uses "command_execution" vs Claude's "Bash")

### 3D Visualization
- Different zone color/style for Codex sessions
- Optional: different particle effects

## Testing Strategy

1. **Unit tests**: Event mapping functions
2. **Integration tests**: Session file watcher with mock JSONL files
3. **Manual testing**: Run Codex CLI alongside Claude Code, verify both appear in UI

## Open Questions

1. **Session naming**: How to derive meaningful names from Codex sessions?
   - Use first user message (like CodexMonitor does)
   - Use working directory name

2. **Token tracking**: Codex reports tokens differently
   - `input_tokens`, `cached_input_tokens`, `output_tokens`
   - May need separate token counter or unified display

3. **Prompt sending**: Without SDK, how to send prompts to existing Codex sessions?
   - Codex doesn't have tmux-like approach
   - May need to use `codex exec resume <session>` via subprocess

## References

- [Codex CLI Documentation](https://developers.openai.com/codex/cli/)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex GitHub Repository](https://github.com/openai/codex)
- [CodexMonitor (community tool)](https://github.com/Cocoanetics/CodexMonitor)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive/)
