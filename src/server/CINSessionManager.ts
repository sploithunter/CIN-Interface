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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, basename, join } from 'path';
import type {
  Session,
  SessionStatus,
  SessionFilter,
  AgentType,
  TerminalInfo,
  ImageInput,
  SendResult,
  CreateSessionOptions as CABCreateSessionOptions,
} from 'coding-agent-bridge';
import type { SessionManager } from 'coding-agent-bridge';
import type {
  ManagedSession,
  ZonePosition,
  CINSessionMetadata,
  SessionFlags,
  CreateSessionOptions,
  GitStatus,
} from '../shared/types.js';
import { GitStatusManager } from './GitStatusManager.js';
import { ProjectsManager } from './ProjectsManager.js';

// =============================================================================
// Types
// =============================================================================

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

interface PersistedMetadata {
  metadata: [string, CINSessionMetadata][];
}

// =============================================================================
// CINSessionManager
// =============================================================================

export class CINSessionManager extends EventEmitter {
  private bridgeManager: SessionManager;
  private metadata: Map<string, CINSessionMetadata> = new Map();
  private config: CINSessionManagerConfig;
  private dirty = false;

  constructor(bridgeManager: SessionManager, config: CINSessionManagerConfig) {
    super();
    this.bridgeManager = bridgeManager;
    this.config = config;

    // Forward bridge events with merged metadata
    this.setupBridgeEventForwarding();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initialize the CIN session manager (load metadata).
   * Call this AFTER bridgeManager.start() has been called.
   */
  async start(): Promise<void> {
    await this.loadMetadata();
    this.debug('CINSessionManager started');
  }

  /**
   * Stop the CIN session manager (save metadata).
   */
  async stop(): Promise<void> {
    await this.saveMetadata();
    this.debug('CINSessionManager stopped');
  }

  // ===========================================================================
  // Session CRUD
  // ===========================================================================

  /**
   * Create a new internal session.
   */
  async createSession(options: CreateSessionOptions = {}): Promise<ManagedSession> {
    // Extract CIN-specific options
    const { zonePosition, flags, ...cabOptions } = options;

    // Build CAB-compatible options
    const cabCreateOptions: CABCreateSessionOptions = {
      name: cabOptions.name,
      cwd: cabOptions.cwd,
      agent: cabOptions.agent,
      flags: this.mapFlagsToCAB(cabOptions.agent || 'claude', flags),
    };

    // Create session via bridge
    const session = await this.bridgeManager.createSession(cabCreateOptions);

    // Store CIN metadata
    if (zonePosition) {
      this.metadata.set(session.id, { zonePosition });
      this.markDirty();
    }

    // Track with GitStatusManager and ProjectsManager
    if (session.cwd) {
      this.config.gitStatusManager.track(session.id, session.cwd);
      this.config.projectsManager.addProject(session.cwd, session.name);
    }

    const managedSession = this.mergeMetadata(session);
    this.emit('session:created', managedSession);
    return managedSession;
  }

  /**
   * Get a session by ID, merged with CIN metadata.
   */
  getSession(id: string): ManagedSession | undefined {
    const session = this.bridgeManager.getSession(id);
    if (!session) return undefined;
    return this.mergeMetadata(session);
  }

  /**
   * List all sessions, merged with CIN metadata.
   */
  listSessions(filter?: SessionFilter): ManagedSession[] {
    const sessions = this.bridgeManager.listSessions(filter);
    return sessions.map((s) => this.mergeMetadata(s));
  }

  /**
   * Update a session's CIN-specific properties.
   */
  updateSession(
    id: string,
    updates: { name?: string; zonePosition?: ZonePosition | null; autoAccept?: boolean }
  ): ManagedSession | null {
    const session = this.bridgeManager.getSession(id);
    if (!session) return null;

    // Update name via bridge (it handles persistence)
    if (updates.name) {
      this.bridgeManager.updateSession(id, { name: updates.name });
    }

    // Update CIN metadata
    const meta = this.metadata.get(id) || {};
    let changed = false;

    if ('zonePosition' in updates) {
      if (updates.zonePosition === null) {
        delete meta.zonePosition;
      } else if (updates.zonePosition) {
        meta.zonePosition = updates.zonePosition;
      }
      changed = true;
    }

    if (typeof updates.autoAccept === 'boolean') {
      meta.autoAccept = updates.autoAccept;
      changed = true;
    }

    if (changed) {
      if (Object.keys(meta).length > 0) {
        this.metadata.set(id, meta);
      } else {
        this.metadata.delete(id);
      }
      this.markDirty();
    }

    const updatedSession = this.getSession(id);
    if (updatedSession) {
      this.emit('session:updated', updatedSession, updates);
    }
    return updatedSession ?? null;
  }

  /**
   * Delete a session.
   */
  async deleteSession(id: string): Promise<boolean> {
    const session = this.getSession(id);
    if (!session) return false;

    // Clean up CIN metadata
    this.metadata.delete(id);
    this.markDirty();

    // Untrack from GitStatusManager
    this.config.gitStatusManager.untrack(id);

    // Delete via bridge
    const deleted = await this.bridgeManager.deleteSession(id);

    if (deleted) {
      this.emit('session:deleted', session);
    }

    return deleted;
  }

  // ===========================================================================
  // Session Control
  // ===========================================================================

  /**
   * Send a prompt to a session.
   * Handles image preprocessing before delegating to CAB.
   */
  async sendPrompt(
    id: string,
    prompt: string,
    images?: ImageInput[]
  ): Promise<SendResult> {
    const session = this.getSession(id);
    if (!session) {
      return { ok: false, error: 'Session not found' };
    }

    // Process images if provided - save to temp files in session's cwd
    let fullPrompt = prompt;
    const savedImagePaths: string[] = [];

    if (images && images.length > 0 && session.cwd) {
      const imageDir = join(session.cwd, '.cin-images');
      if (!existsSync(imageDir)) {
        mkdirSync(imageDir, { recursive: true });
      }

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const ext = img.mediaType.split('/')[1] || 'png';
        const filename = img.name || `image-${Date.now()}-${i}.${ext}`;
        const imagePath = join(imageDir, filename);

        try {
          const buffer = Buffer.from(img.data, 'base64');
          writeFileSync(imagePath, buffer);
          savedImagePaths.push(imagePath);
          this.debug(`Saved image: ${imagePath}`);
        } catch (e) {
          this.debug(`Failed to save image ${filename}: ${(e as Error).message}`);
        }
      }

      if (savedImagePaths.length > 0) {
        const imageRefs = savedImagePaths.map((p) => `[Image: ${p}]`).join('\n');
        fullPrompt = `${imageRefs}\n\n${prompt}`;
      }
    }

    // Send prompt via bridge
    const result = await this.bridgeManager.sendPrompt(id, fullPrompt);

    // Update session status
    if (result.ok) {
      this.updateSessionStatus(id, 'working');
    }

    return {
      ...result,
      imagePaths: savedImagePaths.length > 0 ? savedImagePaths : undefined,
    };
  }

  /**
   * Cancel (Ctrl+C) a session.
   */
  async cancel(id: string): Promise<boolean> {
    return this.bridgeManager.cancel(id);
  }

  /**
   * Restart an offline session.
   */
  async restart(id: string): Promise<ManagedSession | undefined> {
    const session = await this.bridgeManager.restart(id);
    if (!session) return undefined;
    return this.mergeMetadata(session);
  }

  // ===========================================================================
  // Session Linking
  // ===========================================================================

  /**
   * Find or create a session for an agent session ID.
   * Delegates to bridge's findOrCreateSession and merges metadata.
   */
  findOrCreateSession(
    agentSessionId: string,
    agent: AgentType,
    cwd: string,
    terminal?: TerminalInfo
  ): ManagedSession {
    const session = this.bridgeManager.findOrCreateSession(
      agentSessionId,
      agent,
      cwd,
      terminal
    );

    // Track with GitStatusManager
    if (session.cwd) {
      this.config.gitStatusManager.track(session.id, session.cwd);
    }

    return this.mergeMetadata(session);
  }

  /**
   * Get a session by agent session ID.
   */
  getSessionByAgentId(agentSessionId: string): ManagedSession | undefined {
    const session = this.bridgeManager.getSessionByAgentId(agentSessionId);
    if (!session) return undefined;
    return this.mergeMetadata(session);
  }

  // ===========================================================================
  // Metadata Operations
  // ===========================================================================

  /**
   * Update CIN-specific metadata for a session.
   */
  updateMetadata(id: string, updates: Partial<CINSessionMetadata>): void {
    const meta = this.metadata.get(id) || {};

    if ('zonePosition' in updates) {
      if (updates.zonePosition === undefined) {
        delete meta.zonePosition;
      } else {
        meta.zonePosition = updates.zonePosition;
      }
    }

    if ('suggestion' in updates) {
      if (updates.suggestion === undefined) {
        delete meta.suggestion;
      } else {
        meta.suggestion = updates.suggestion;
      }
    }

    if ('autoAccept' in updates) {
      if (updates.autoAccept === undefined) {
        delete meta.autoAccept;
      } else {
        meta.autoAccept = updates.autoAccept;
      }
    }

    if (Object.keys(meta).length > 0) {
      this.metadata.set(id, meta);
    } else {
      this.metadata.delete(id);
    }

    this.markDirty();
  }

  /**
   * Get CIN metadata for a session.
   */
  getMetadata(id: string): CINSessionMetadata | undefined {
    return this.metadata.get(id);
  }

  /**
   * Clean up metadata for a deleted session.
   */
  cleanupMetadata(id: string): void {
    this.metadata.delete(id);
    this.markDirty();
  }

  // ===========================================================================
  // Status Updates
  // ===========================================================================

  /**
   * Update a session's status.
   */
  updateSessionStatus(id: string, newStatus: SessionStatus): void {
    const session = this.bridgeManager.getSession(id);
    if (!session) return;

    const oldStatus = session.status;
    if (oldStatus === newStatus) return;

    this.bridgeManager.updateSessionStatus(session, newStatus);
    this.emit('session:status', this.mergeMetadata(session), oldStatus, newStatus);
  }

  /**
   * Update a session's current tool.
   */
  updateSessionTool(id: string, tool: string | undefined): void {
    const session = this.bridgeManager.getSession(id);
    if (!session) return;
    this.bridgeManager.updateSessionTool(session, tool);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Merge a CAB Session with CIN metadata to create a ManagedSession.
   */
  private mergeMetadata(session: Session): ManagedSession {
    const meta = this.metadata.get(session.id) || {};
    const gitStatus = this.config.gitStatusManager.getStatus(session.id);

    return {
      id: session.id,
      name: session.name,
      type: session.type,
      agent: session.agent,
      tmuxSession: session.tmuxSession,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      cwd: session.cwd,
      claudeSessionId: session.agentSessionId,
      codexThreadId: session.agent === 'codex' ? session.agentSessionId : undefined,
      currentTool: session.currentTool,
      terminal: session.terminal,
      // CIN-specific fields
      zonePosition: meta.zonePosition,
      suggestion: meta.suggestion,
      autoAccept: meta.autoAccept,
      // Git status (added dynamically)
      ...(gitStatus ? { gitStatus } : {}),
    } as ManagedSession;
  }

  /**
   * Map CIN SessionFlags to CAB-compatible flags.
   */
  private mapFlagsToCAB(
    agent: AgentType,
    flags?: SessionFlags
  ): Record<string, boolean | string> | undefined {
    if (!flags) return undefined;

    const cabFlags: Record<string, boolean | string> = {};

    if (agent === 'codex') {
      if (flags.model) cabFlags.model = flags.model;
      if (flags.skipPermissions) cabFlags['dangerously-bypass-approvals-and-sandbox'] = true;
      else if (flags.fullAuto) cabFlags['full-auto'] = true;
      else {
        if (flags.sandbox) cabFlags.sandbox = flags.sandbox;
        if (flags.approval) cabFlags['ask-for-approval'] = flags.approval;
      }
    } else {
      // Claude
      if (flags.continue) cabFlags.c = true;
      if (flags.skipPermissions !== false) {
        cabFlags['permission-mode'] = 'bypassPermissions';
        cabFlags['dangerously-skip-permissions'] = true;
      }
      if (flags.chrome) cabFlags.chrome = true;
    }

    return Object.keys(cabFlags).length > 0 ? cabFlags : undefined;
  }

  /**
   * Set up forwarding of bridge events with merged metadata.
   */
  private setupBridgeEventForwarding(): void {
    this.bridgeManager.on('session:created', (session) => {
      // Don't emit here - we emit in createSession() after adding metadata
      this.debug(`Bridge: session created ${session.name}`);
    });

    this.bridgeManager.on('session:updated', (session, changes) => {
      this.emit('session:updated', this.mergeMetadata(session), changes);
    });

    this.bridgeManager.on('session:deleted', (session) => {
      this.cleanupMetadata(session.id);
      this.emit('session:deleted', this.mergeMetadata(session));
    });

    this.bridgeManager.on('session:status', (session, from, to) => {
      this.emit('session:status', this.mergeMetadata(session), from, to);
    });

    this.bridgeManager.on('error', (error) => {
      this.emit('error', error);
    });
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private markDirty(): void {
    this.dirty = true;
  }

  /**
   * Load CIN metadata from disk.
   */
  private async loadMetadata(): Promise<void> {
    try {
      if (!existsSync(this.config.metadataFile)) {
        this.debug('No metadata file found, starting fresh');
        return;
      }

      const content = readFileSync(this.config.metadataFile, 'utf8');
      const data: PersistedMetadata = JSON.parse(content);

      this.metadata.clear();
      for (const [id, meta] of data.metadata) {
        this.metadata.set(id, meta);
      }

      this.debug(`Loaded metadata for ${this.metadata.size} sessions`);
    } catch (err) {
      this.debug(`Failed to load metadata: ${err}`);
    }
  }

  /**
   * Save CIN metadata to disk.
   */
  async saveMetadata(): Promise<void> {
    if (!this.dirty) return;

    try {
      const data: PersistedMetadata = {
        metadata: Array.from(this.metadata.entries()),
      };

      // Ensure directory exists
      const dir = dirname(this.config.metadataFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.config.metadataFile, JSON.stringify(data, null, 2), 'utf8');
      this.dirty = false;
      this.debug(`Saved metadata for ${this.metadata.size} sessions`);
    } catch (err) {
      console.error('Failed to save CIN metadata:', err);
    }
  }

  /**
   * Force save (for shutdown).
   */
  async forceSave(): Promise<void> {
    this.dirty = true;
    await this.saveMetadata();
  }

  private debug(...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[CINSessionManager ${new Date().toISOString()}]`, ...args);
    }
  }
}

/**
 * Create a CINSessionManager instance.
 */
export function createCINSessionManager(
  bridgeManager: SessionManager,
  config: CINSessionManagerConfig
): CINSessionManager {
  return new CINSessionManager(bridgeManager, config);
}
