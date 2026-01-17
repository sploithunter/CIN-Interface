// Session types
export type SessionStatus = 'idle' | 'working' | 'waiting' | 'offline';
export type SessionType = 'internal' | 'external';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: { added: number; modified: number; deleted: number };
  unstaged: { added: number; modified: number; deleted: number };
  untracked: number;
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
  lastCommitTime?: number;
  lastCommitMessage?: string;
  isRepo: boolean;
  lastChecked: number;
}

export interface ZonePosition {
  q: number;
  r: number;
}

export interface ManagedSession {
  id: string;
  name: string;
  type: SessionType;              // 'internal' = created via New Zone (tmux), 'external' = detected from hooks
  tmuxSession?: string;           // Only for internal sessions
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
  cwd?: string;
  claudeSessionId?: string;
  currentTool?: string;
  zonePosition?: ZonePosition;    // If undefined, session is "unplaced" (not on 3D grid)
  gitStatus?: GitStatus;
  suggestion?: string;            // Claude's suggested next prompt
  autoAccept?: boolean;           // Ralph Wiggum mode - auto-accept suggestions
}

export interface Project {
  path: string;
  name: string;
  lastUsed: number;
  useCount: number;
}

// Event types
export interface VibecraftEvent {
  id: string;
  timestamp: number;
  type: string;
  sessionId: string;
  cwd: string;
  tool?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  toolUseId?: string;
  duration?: number;
  success?: boolean;
  assistantText?: string;
  response?: string;  // Claude's final response text (for stop events)
}

// WebSocket message types
export interface WSMessage {
  type: string;
  payload?: unknown;
}

export interface ConnectedMessage extends WSMessage {
  type: 'connected';
  payload: { sessionId: string };
}

export interface SessionsMessage extends WSMessage {
  type: 'sessions';
  payload: ManagedSession[];
}

export interface EventMessage extends WSMessage {
  type: 'event';
  payload: VibecraftEvent;
}

export interface HistoryMessage extends WSMessage {
  type: 'history';
  payload: VibecraftEvent[];
}

export interface TokensMessage extends WSMessage {
  type: 'tokens';
  payload: {
    session: string;
    current: number;
    cumulative: number;
  };
}

// API response types
export interface HealthResponse {
  ok: boolean;
  version: string;
  clients: number;
  events: number;
  voiceEnabled: boolean;
}

export interface ConfigResponse {
  username: string;
  hostname: string;
  tmuxSession: string;
}

export interface SessionsResponse {
  ok: boolean;
  sessions: ManagedSession[];
}

export interface ProjectsResponse {
  ok: boolean;
  projects: Project[];
}

export interface AutocompleteResponse {
  ok: boolean;
  suggestions: string[];
}

export interface DefaultPathResponse {
  ok: boolean;
  path: string;
}

export interface CreateSessionOptions {
  name?: string;
  cwd?: string;
  flags?: {
    continue?: boolean;
    skipPermissions?: boolean;
    chrome?: boolean;
  };
  zonePosition?: ZonePosition;
}
