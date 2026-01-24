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
export type { AgentType, SessionStatus, SessionType, TerminalInfo, Session, SessionFilter, EventType, BaseEvent, PreToolUseEvent, PostToolUseEvent, StopEvent, SubagentStopEvent, SessionStartEvent, SessionEndEvent, UserPromptSubmitEvent, NotificationEvent, AgentEvent, BridgeConfig, ResolvedConfig, HookConfig, AgentCommandOptions, AgentAdapter, ImageInput, SendResult, } from 'coding-agent-bridge';
/** Map tools to stations in the 3D visualization */
export declare const TOOL_STATION_MAP: Record<string, string>;
/** Get station for a tool (handles unknown/MCP tools) */
export declare function getStationForTool(tool: string): string;
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
export type CINEventType = 'pre_tool_use' | 'post_tool_use' | 'stop' | 'subagent_stop' | 'session_start' | 'session_end' | 'user_prompt_submit' | 'notification' | 'pre_compact' | 'unknown';
/** Union of all CIN event types (bridge events + CIN-specific) */
export type CINEvent = import('coding-agent-bridge').PreToolUseEvent | import('coding-agent-bridge').PostToolUseEvent | import('coding-agent-bridge').StopEvent | import('coding-agent-bridge').SubagentStopEvent | import('coding-agent-bridge').SessionStartEvent | import('coding-agent-bridge').SessionEndEvent | import('coding-agent-bridge').UserPromptSubmitEvent | import('coding-agent-bridge').NotificationEvent | PreCompactEvent | UnknownEvent;
export interface ZonePosition {
    q: number;
    r: number;
}
/**
 * CIN-specific session metadata stored separately from CAB's Session.
 * This allows CIN to extend sessions without modifying the bridge's Session type.
 */
export interface CINSessionMetadata {
    /** Hex grid position for 3D visualization */
    zonePosition?: ZonePosition;
    /** Claude's suggested next prompt */
    suggestion?: string;
    /** Ralph Wiggum mode - auto-accept suggestions */
    autoAccept?: boolean;
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
    claudeSessionId?: string;
    codexThreadId?: string;
    currentTool?: string;
    zonePosition?: ZonePosition;
    suggestion?: string;
    autoAccept?: boolean;
    terminal?: import('coding-agent-bridge').TerminalInfo;
}
export interface SessionFlags {
    continue?: boolean;
    skipPermissions?: boolean;
    chrome?: boolean;
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approval?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
    fullAuto?: boolean;
    model?: string;
    openTerminal?: boolean;
}
export interface CreateSessionOptions {
    name?: string;
    cwd?: string;
    agent?: AgentType;
    flags?: SessionFlags;
    zonePosition?: ZonePosition;
}
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
export interface TextTile {
    id: string;
    text: string;
    position: ZonePosition;
    color?: string;
    createdAt: number;
}
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
export interface Project {
    path: string;
    name: string;
    lastUsed: number;
    useCount: number;
}
export declare const DEFAULT_CONFIG: {
    serverPort: number;
    eventsFile: string;
    maxEventsInMemory: number;
    debug: boolean;
};
/** Codex event types from --json output */
export type CodexEventType = 'thread.started' | 'turn.started' | 'turn.completed' | 'turn.failed' | 'item.started' | 'item.completed' | 'error';
/** Codex item types */
export type CodexItemType = 'agent_message' | 'command_execution' | 'file_change' | 'mcp_tool_call' | 'web_search' | 'plan_update' | 'reasoning';
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
    operation?: string;
    query?: string;
    tool_name?: string;
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
//# sourceMappingURL=types.d.ts.map