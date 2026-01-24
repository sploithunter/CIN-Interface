/**
 * CINSessionManager - Wrapper around CAB's SessionManager
 *
 * This class provides a clean API boundary between CIN-Interface and coding-agent-bridge.
 * It delegates core session operations to CAB's SessionManager while storing CIN-specific
 * metadata (zonePosition, suggestion, autoAccept) in a parallel Map.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │                   CIN-Interface                      │
 * │  ┌───────────────────────────────────────────────┐  │
 * │  │           CINSessionManager (this file)        │  │
 * │  │  - cinMetadata: Map<id, CINSessionMetadata>   │  │
 * │  │  - createSession() → delegate + store meta    │  │
 * │  │  - getSession() → CAB session + merge meta    │  │
 * │  └───────────────────────────────────────────────┘  │
 * │                        │                             │
 * │                        ▼ delegates to                │
 * │  ┌───────────────────────────────────────────────┐  │
 * │  │       bridgeSessionManager (from CAB)          │  │
 * │  │  - createSession(), deleteSession()            │  │
 * │  │  - sendPrompt(), cancel(), restart()           │  │
 * │  │  - findOrCreateSession()                       │  │
 * │  └───────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────┘
 */
import { EventEmitter } from 'events';
import type { SessionStatus, SessionFilter, AgentType, TerminalInfo, ImageInput, SendResult } from 'coding-agent-bridge';
import type { SessionManager } from 'coding-agent-bridge';
import type { ManagedSession, ZonePosition, CINSessionMetadata, CreateSessionOptions } from '../shared/types.js';
import { GitStatusManager } from './GitStatusManager.js';
import { ProjectsManager } from './ProjectsManager.js';
export interface CINSessionManagerConfig {
    /** Path to CIN metadata file */
    metadataFile: string;
    /** Reference to GitStatusManager */
    gitStatusManager: GitStatusManager;
    /** Reference to ProjectsManager */
    projectsManager: ProjectsManager;
    /** Enable debug logging */
    debug?: boolean;
}
export interface CINSessionManagerEvents {
    'session:created': (session: ManagedSession) => void;
    'session:updated': (session: ManagedSession, changes: Partial<ManagedSession>) => void;
    'session:deleted': (session: ManagedSession) => void;
    'session:status': (session: ManagedSession, from: SessionStatus, to: SessionStatus) => void;
    error: (error: Error) => void;
}
export declare class CINSessionManager extends EventEmitter {
    private bridgeManager;
    private metadata;
    private config;
    private dirty;
    constructor(bridgeManager: SessionManager, config: CINSessionManagerConfig);
    /**
     * Initialize the CIN session manager (load metadata).
     * Call this AFTER bridgeManager.start() has been called.
     */
    start(): Promise<void>;
    /**
     * Stop the CIN session manager (save metadata).
     */
    stop(): Promise<void>;
    /**
     * Create a new internal session.
     */
    createSession(options?: CreateSessionOptions): Promise<ManagedSession>;
    /**
     * Get a session by ID, merged with CIN metadata.
     */
    getSession(id: string): ManagedSession | undefined;
    /**
     * List all sessions, merged with CIN metadata.
     */
    listSessions(filter?: SessionFilter): ManagedSession[];
    /**
     * Update a session's CIN-specific properties.
     */
    updateSession(id: string, updates: {
        name?: string;
        zonePosition?: ZonePosition | null;
        autoAccept?: boolean;
    }): ManagedSession | null;
    /**
     * Delete a session.
     */
    deleteSession(id: string): Promise<boolean>;
    /**
     * Send a prompt to a session.
     * Handles image preprocessing before delegating to CAB.
     */
    sendPrompt(id: string, prompt: string, images?: ImageInput[]): Promise<SendResult>;
    /**
     * Cancel (Ctrl+C) a session.
     */
    cancel(id: string): Promise<boolean>;
    /**
     * Restart an offline session.
     */
    restart(id: string): Promise<ManagedSession | undefined>;
    /**
     * Find or create a session for an agent session ID.
     * Delegates to bridge's findOrCreateSession and merges metadata.
     */
    findOrCreateSession(agentSessionId: string, agent: AgentType, cwd: string, terminal?: TerminalInfo): ManagedSession;
    /**
     * Get a session by agent session ID.
     */
    getSessionByAgentId(agentSessionId: string): ManagedSession | undefined;
    /**
     * Update CIN-specific metadata for a session.
     */
    updateMetadata(id: string, updates: Partial<CINSessionMetadata>): void;
    /**
     * Get CIN metadata for a session.
     */
    getMetadata(id: string): CINSessionMetadata | undefined;
    /**
     * Clean up metadata for a deleted session.
     */
    cleanupMetadata(id: string): void;
    /**
     * Update a session's status.
     */
    updateSessionStatus(id: string, newStatus: SessionStatus): void;
    /**
     * Update a session's current tool.
     */
    updateSessionTool(id: string, tool: string | undefined): void;
    /**
     * Merge a CAB Session with CIN metadata to create a ManagedSession.
     */
    private mergeMetadata;
    /**
     * Map CIN SessionFlags to CAB-compatible flags.
     */
    private mapFlagsToCAB;
    /**
     * Set up forwarding of bridge events with merged metadata.
     */
    private setupBridgeEventForwarding;
    private markDirty;
    /**
     * Load CIN metadata from disk.
     */
    private loadMetadata;
    /**
     * Save CIN metadata to disk.
     */
    saveMetadata(): Promise<void>;
    /**
     * Force save (for shutdown).
     */
    forceSave(): Promise<void>;
    private debug;
}
/**
 * Create a CINSessionManager instance.
 */
export declare function createCINSessionManager(bridgeManager: SessionManager, config: CINSessionManagerConfig): CINSessionManager;
//# sourceMappingURL=CINSessionManager.d.ts.map