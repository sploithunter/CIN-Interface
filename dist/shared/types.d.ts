/**
 * CIN-Interface Event Types
 *
 * These types define the contract between:
 * - Hook scripts (produce events)
 * - WebSocket server (relay events)
 * - Three.js client (consume events)
 */
/** Map tools to stations in the 3D visualization */
export declare const TOOL_STATION_MAP: Record<string, string>;
/** Get station for a tool (handles unknown/MCP tools) */
export declare function getStationForTool(tool: string): string;
export type EventType = 'pre_tool_use' | 'post_tool_use' | 'stop' | 'subagent_stop' | 'session_start' | 'session_end' | 'user_prompt_submit' | 'notification' | 'pre_compact' | 'unknown';
/** Base event structure */
export interface BaseEvent {
    id: string;
    timestamp: number;
    type: EventType;
    sessionId: string;
    cwd: string;
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
    tmuxPane?: string;
    tmuxSocket?: string;
    tty?: string;
}
/** Session start event */
export interface SessionStartEvent extends BaseEvent {
    type: 'session_start';
    source: string;
    terminal?: TerminalInfo;
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
export type VibecraftEvent = PreToolUseEvent | PostToolUseEvent | StopEvent | SessionStartEvent | SessionEndEvent | UserPromptSubmitEvent | NotificationEvent | PreCompactEvent | UnknownEvent;
export type SessionStatus = 'idle' | 'working' | 'waiting' | 'offline';
export type SessionType = 'internal' | 'external';
export interface ZonePosition {
    q: number;
    r: number;
}
export interface ManagedSession {
    id: string;
    name: string;
    type: SessionType;
    tmuxSession?: string;
    status: SessionStatus;
    createdAt: number;
    lastActivity: number;
    cwd: string;
    claudeSessionId?: string;
    currentTool?: string;
    zonePosition?: ZonePosition;
    suggestion?: string;
    autoAccept?: boolean;
    terminal?: TerminalInfo;
}
export interface SessionFlags {
    continue?: boolean;
    skipPermissions?: boolean;
    chrome?: boolean;
    openTerminal?: boolean;
}
export interface CreateSessionOptions {
    name?: string;
    cwd?: string;
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
//# sourceMappingURL=types.d.ts.map