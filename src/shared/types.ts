/**
 * CIN-Interface Event Types
 *
 * These types define the contract between:
 * - Hook scripts (produce events)
 * - WebSocket server (relay events)
 * - Three.js client (consume events)
 */

// =============================================================================
// Tool-to-Station Mapping
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
// Event Types
// =============================================================================

export type EventType =
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

/** Base event structure */
export interface BaseEvent {
  id: string;
  timestamp: number;
  type: EventType;
  sessionId: string;
  cwd: string;
  agent?: AgentType;  // Which agent produced this event (defaults to 'claude' for backward compatibility)
}

/** Pre-tool-use event */
export interface PreToolUseEvent extends BaseEvent {
  type: 'pre_tool_use';
  tool: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  assistantText?: string;
}

/** Post-tool-use event */
export interface PostToolUseEvent extends BaseEvent {
  type: 'post_tool_use';
  tool: string;
  toolInput: Record<string, unknown>;
  toolResponse: Record<string, unknown>;
  toolUseId: string;
  success: boolean;
  duration?: number;
}

/** Stop event */
export interface StopEvent extends BaseEvent {
  type: 'stop' | 'subagent_stop';
  stopHookActive: boolean;
  response?: string;
}

/** Terminal info for external sessions (captured from environment) */
export interface TerminalInfo {
  tmuxPane?: string;       // TMUX_PANE env var (e.g., "%0")
  tmuxSocket?: string;     // TMUX env var (socket path)
  tty?: string;            // Terminal device (e.g., "/dev/ttys001")
}

/** Session start event */
export interface SessionStartEvent extends BaseEvent {
  type: 'session_start';
  source: string;
  terminal?: TerminalInfo;  // Terminal info for potential message sending
}

/** Session end event */
export interface SessionEndEvent extends BaseEvent {
  type: 'session_end';
  reason: string;
}

/** User prompt submit event */
export interface UserPromptSubmitEvent extends BaseEvent {
  type: 'user_prompt_submit';
  prompt: string;
}

/** Notification event */
export interface NotificationEvent extends BaseEvent {
  type: 'notification';
  message: string;
  notificationType: string;
}

/** Pre-compact event */
export interface PreCompactEvent extends BaseEvent {
  type: 'pre_compact';
  trigger: string;
  customInstructions: string;
}

/** Unknown event (raw data preserved) */
export interface UnknownEvent extends BaseEvent {
  type: 'unknown';
  raw: Record<string, unknown>;
}

/** Union of all event types */
export type VibecraftEvent =
  | PreToolUseEvent
  | PostToolUseEvent
  | StopEvent
  | SessionStartEvent
  | SessionEndEvent
  | UserPromptSubmitEvent
  | NotificationEvent
  | PreCompactEvent
  | UnknownEvent;

// =============================================================================
// Session Types
// =============================================================================

export type SessionStatus = 'idle' | 'working' | 'waiting' | 'offline';
export type SessionType = 'internal' | 'external';
export type AgentType = 'claude' | 'codex';

export interface ZonePosition {
  q: number;
  r: number;
}

export interface ManagedSession {
  id: string;
  name: string;
  type: SessionType;              // 'internal' = created via New Zone (tmux), 'external' = detected from hooks
  agent: AgentType;               // 'claude' or 'codex' - which AI agent is running
  tmuxSession?: string;           // Only for internal sessions
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
  cwd: string;
  claudeSessionId?: string;       // Claude session ID (for Claude agent)
  codexThreadId?: string;         // Codex thread ID (for Codex agent)
  currentTool?: string;
  zonePosition?: ZonePosition;    // If undefined, session is "unplaced" (not on 3D grid)
  suggestion?: string;            // Claude's suggested next prompt (shown in gray at input line)
  autoAccept?: boolean;           // Ralph Wiggum mode - auto-accept suggestions
  terminal?: TerminalInfo;        // Terminal info for external sessions (enables message sending)
}

export interface SessionFlags {
  // Claude-specific flags
  continue?: boolean;           // Claude: -c (continue conversation)
  skipPermissions?: boolean;    // Claude: --dangerously-skip-permissions, Codex: --dangerously-bypass-approvals-and-sandbox
  chrome?: boolean;             // Claude: --chrome

  // Codex-specific flags
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';  // Codex: --sandbox
  approval?: 'untrusted' | 'on-failure' | 'on-request' | 'never';    // Codex: --ask-for-approval
  fullAuto?: boolean;           // Codex: --full-auto (convenience alias for -a on-request, --sandbox workspace-write)
  model?: string;               // Codex: --model (e.g., 'gpt-5.2-codex-high', 'o3')

  // Shared flags
  openTerminal?: boolean;       // Open Terminal.app attached to tmux session (default: true)
}

export interface CreateSessionOptions {
  name?: string;
  cwd?: string;
  agent?: AgentType;  // 'claude' (default) or 'codex'
  flags?: SessionFlags;
  zonePosition?: ZonePosition;
}

// =============================================================================
// Git Status Types
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
// Permission Types
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
// Text Tile Types
// =============================================================================

export interface TextTile {
  id: string;
  text: string;
  position: ZonePosition;
  color?: string;
  createdAt: number;
}

// =============================================================================
// WebSocket Message Types
// =============================================================================

export interface WSMessage {
  type: string;
  payload?: unknown;
}

export interface WSEventMessage extends WSMessage {
  type: 'event';
  payload: VibecraftEvent;
}

export interface WSHistoryMessage extends WSMessage {
  type: 'history';
  payload: VibecraftEvent[];
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
// Project Types
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
// Codex-Specific Types
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
