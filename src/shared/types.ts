/**
 * CIN-Interface Event Types
 *
 * These types define the contract between:
 * - Hook scripts (produce events)
 * - WebSocket server (relay events)
 * - Three.js client (consume events)
 *
 * Base event and session types are imported from coding-agent-bridge.
 * CIN-specific types (tiles, projects, git status, 3D visualization) are defined here.
 */

// =============================================================================
// Re-export base types from coding-agent-bridge
// =============================================================================

export type {
  // Agent types
  AgentType,

  // Session types
  SessionStatus,
  SessionType,
  TerminalInfo,
  Session,
  SessionFilter,

  // Event types
  EventType,
  BaseEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  StopEvent,
  SubagentStopEvent,
  SessionStartEvent,
  SessionEndEvent,
  UserPromptSubmitEvent,
  NotificationEvent,
  AgentEvent,

  // Configuration
  BridgeConfig,
  ResolvedConfig,

  // Adapter types
  HookConfig,
  AgentCommandOptions,
  AgentAdapter,

  // API types
  ImageInput,
  SendResult,
} from 'coding-agent-bridge';

// =============================================================================
// Tool-to-Station Mapping (CIN-specific - 3D visualization)
// =============================================================================

/** Map tools to stations in the 3D visualization */
export const TOOL_STATION_MAP: Record<string, string> = {
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
};

/** Get station for a tool (handles unknown/MCP tools) */
export function getStationForTool(tool: string): string {
  return TOOL_STATION_MAP[tool] ?? 'center';
}

// =============================================================================
// CIN-specific Event Types
// =============================================================================

import type { BaseEvent, AgentType } from 'coding-agent-bridge';

/** Base event structure for CIN-specific events (allows custom types) */
interface CINBaseEvent extends Omit<BaseEvent, 'type'> {
  type: string;
}

/** Pre-compact event (CIN-specific) */
export interface PreCompactEvent extends CINBaseEvent {
  type: 'pre_compact';
  trigger: string;
  customInstructions: string;
}

/** Unknown event (raw data preserved) */
export interface UnknownEvent extends CINBaseEvent {
  type: 'unknown';
  raw: Record<string, unknown>;
}

/** Extended event type including CIN-specific events */
export type CINEventType =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'subagent_stop'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'
  | 'notification'
  | 'pre_compact'
  | 'unknown';

/** Union of all CIN event types (bridge events + CIN-specific) */
export type CINEvent =
  | import('coding-agent-bridge').PreToolUseEvent
  | import('coding-agent-bridge').PostToolUseEvent
  | import('coding-agent-bridge').StopEvent
  | import('coding-agent-bridge').SubagentStopEvent
  | import('coding-agent-bridge').SessionStartEvent
  | import('coding-agent-bridge').SessionEndEvent
  | import('coding-agent-bridge').UserPromptSubmitEvent
  | import('coding-agent-bridge').NotificationEvent
  | PreCompactEvent
  | UnknownEvent;

// =============================================================================
// CIN-specific Session Types
// =============================================================================

export interface ZonePosition {
  q: number;
  r: number;
}

/**
 * CIN-specific managed session - extends bridge's Session with visualization fields
 */
export interface ManagedSession {
  id: string;
  name: string;
  type: import('coding-agent-bridge').SessionType;
  agent: AgentType;
  tmuxSession?: string;
  status: import('coding-agent-bridge').SessionStatus;
  createdAt: number;
  lastActivity: number;
  cwd: string;
  claudeSessionId?: string;       // Claude session ID (for Claude agent)
  codexThreadId?: string;         // Codex thread ID (for Codex agent)
  currentTool?: string;
  zonePosition?: ZonePosition;    // CIN-specific: hex grid position
  suggestion?: string;            // CIN-specific: Claude's suggested next prompt
  autoAccept?: boolean;           // CIN-specific: Ralph Wiggum mode
  terminal?: import('coding-agent-bridge').TerminalInfo;
}

export interface SessionFlags {
  // Claude-specific flags
  continue?: boolean;           // Claude: -c (continue conversation)
  skipPermissions?: boolean;    // Claude: --dangerously-skip-permissions, Codex: --dangerously-bypass-approvals-and-sandbox
  chrome?: boolean;             // Claude: --chrome

  // Codex-specific flags
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';  // Codex: --sandbox
  approval?: 'untrusted' | 'on-failure' | 'on-request' | 'never';    // Codex: --ask-for-approval
  fullAuto?: boolean;           // Codex: --full-auto
  model?: string;               // Codex: --model

  // Shared flags
  openTerminal?: boolean;       // Open Terminal.app attached to tmux session
}

export interface CreateSessionOptions {
  name?: string;
  cwd?: string;
  agent?: AgentType;
  flags?: SessionFlags;
  zonePosition?: ZonePosition;  // CIN-specific
}

// =============================================================================
// Git Status Types (CIN-specific)
// =============================================================================

export interface GitFileChanges {
  added: number;
  modified: number;
  deleted: number;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChanges;
  unstaged: GitFileChanges;
  untracked: number;
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
  lastCommitTime: number | null;
  lastCommitMessage: string | null;
  isRepo: boolean;
  lastChecked: number;
}

// =============================================================================
// Permission Types (CIN-specific)
// =============================================================================

export interface PermissionOption {
  number: string;
  label: string;
}

export interface PermissionPrompt {
  tool: string;
  context: string;
  options: PermissionOption[];
  detectedAt: number;
}

// =============================================================================
// Text Tile Types (CIN-specific - 3D visualization)
// =============================================================================

export interface TextTile {
  id: string;
  text: string;
  position: ZonePosition;
  color?: string;
  createdAt: number;
}

// =============================================================================
// WebSocket Message Types (CIN-specific)
// =============================================================================

export interface WSMessage {
  type: string;
  /** Standard payload field per WEBSOCKET_INTERFACE.md spec */
  data?: unknown;
  /** Legacy payload field for backward compatibility */
  payload?: unknown;
}

export interface WSEventMessage extends WSMessage {
  type: 'event';
  payload: CINEvent;
}

export interface WSHistoryMessage extends WSMessage {
  type: 'history';
  payload: CINEvent[];
}

export interface WSSessionsMessage extends WSMessage {
  type: 'sessions';
  payload: ManagedSession[];
}

export interface WSTokensMessage extends WSMessage {
  type: 'tokens';
  payload: {
    session: string;
    current: number;
    cumulative: number;
  };
}

export interface WSPermissionPromptMessage extends WSMessage {
  type: 'permission_prompt';
  payload: {
    sessionId: string;
    tool: string;
    context: string;
    options: PermissionOption[];
  };
}

// =============================================================================
// Project Types (CIN-specific)
// =============================================================================

export interface Project {
  path: string;
  name: string;
  lastUsed: number;
  useCount: number;
}

// =============================================================================
// Default Config (legacy compatibility)
// =============================================================================

export const DEFAULT_CONFIG = {
  serverPort: 4003,
  eventsFile: './data/events.jsonl',
  maxEventsInMemory: 1000,
  debug: false,
};

// =============================================================================
// Codex-Specific Types (CIN-specific - for CodexSessionWatcher)
// =============================================================================

/** Codex event types from --json output */
export type CodexEventType =
  | 'thread.started'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'item.started'
  | 'item.completed'
  | 'error';

/** Codex item types */
export type CodexItemType =
  | 'agent_message'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'web_search'
  | 'plan_update'
  | 'reasoning';

/** Codex token usage */
export interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
}

/** Codex item structure */
export interface CodexItem {
  id: string;
  type: CodexItemType;
  status?: string;
  text?: string;
  command?: string;
  output?: string;
  exit_code?: number;
  file_path?: string;
  operation?: string;  // 'create' | 'modify' | 'delete'
  query?: string;      // for web_search
  tool_name?: string;  // for mcp_tool_call
  tool_input?: Record<string, unknown>;
}

/** Raw Codex event from JSONL */
export interface CodexRawEvent {
  type: CodexEventType;
  thread_id?: string;
  turn_id?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  error?: {
    message: string;
    code?: string;
  };
}
