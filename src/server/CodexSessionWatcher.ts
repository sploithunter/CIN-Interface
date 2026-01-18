/**
 * CodexSessionWatcher - Watches ~/.codex/sessions/ for Codex CLI session files
 *
 * Codex CLI stores session logs as JSONL files in:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * This watcher:
 * 1. Detects new session files (new Codex sessions)
 * 2. Watches existing files for new events (incremental reads)
 * 3. Maps Codex events to CIN-Interface event format
 * 4. Emits events via callback for integration with main server
 */

import { watch, existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { EventEmitter } from 'events';
import type {
  VibecraftEvent,
  CodexRawEvent,
  CodexItem,
  ManagedSession,
} from '../shared/types.js';

// Codex home directory (can be overridden via env)
const CODEX_HOME = process.env.CODEX_HOME || join(process.env.HOME || '', '.codex');
const CODEX_SESSIONS_DIR = join(CODEX_HOME, 'sessions');

/** Tracked session file state */
interface TrackedFile {
  path: string;
  threadId: string;
  lastPosition: number;  // Byte offset for incremental reads
  lastModified: number;
  cwd?: string;
  firstUserMessage?: string;
}

export interface CodexSessionInfo {
  threadId: string;
  filePath: string;
  cwd: string;
  name: string;
  firstUserMessage?: string;
}

export class CodexSessionWatcher extends EventEmitter {
  private trackedFiles: Map<string, TrackedFile> = new Map();
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private enabled: boolean = false;
  private debug: boolean;

  constructor(options: { debug?: boolean } = {}) {
    super();
    this.debug = options.debug ?? false;
  }

  private log(message: string): void {
    console.log(`[CodexWatcher] ${message}`);
  }

  private debugLog(message: string): void {
    if (this.debug) {
      console.log(`[CodexWatcher:debug] ${message}`);
    }
  }

  /**
   * Start watching for Codex sessions
   */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;

    if (!existsSync(CODEX_SESSIONS_DIR)) {
      this.log(`Codex sessions directory not found: ${CODEX_SESSIONS_DIR}`);
      this.log('Codex integration disabled (install Codex CLI to enable)');
      return;
    }

    this.log(`Watching Codex sessions: ${CODEX_SESSIONS_DIR}`);

    // Initial scan for existing sessions
    this.scanForSessions();

    // Watch for new session directories/files
    this.watchSessionsDirectory();

    // Poll for file changes (fallback for systems where fs.watch is unreliable)
    this.pollInterval = setInterval(() => this.pollTrackedFiles(), 2000);
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.enabled = false;

    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.log('Stopped watching Codex sessions');
  }

  /**
   * Scan for existing session files
   */
  private scanForSessions(): void {
    try {
      // Codex organizes sessions by date: sessions/YYYY/MM/DD/
      const years = this.listDirs(CODEX_SESSIONS_DIR);

      for (const year of years) {
        const yearPath = join(CODEX_SESSIONS_DIR, year);
        const months = this.listDirs(yearPath);

        for (const month of months) {
          const monthPath = join(yearPath, month);
          const days = this.listDirs(monthPath);

          for (const day of days) {
            const dayPath = join(monthPath, day);
            this.scanDayDirectory(dayPath);
          }
        }
      }

      this.log(`Found ${this.trackedFiles.size} Codex session files`);
    } catch (e) {
      this.log(`Error scanning sessions: ${(e as Error).message}`);
    }
  }

  /**
   * Scan a day directory for session files
   */
  private scanDayDirectory(dayPath: string): void {
    try {
      const files = readdirSync(dayPath).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = join(dayPath, file);
        this.trackFile(filePath);
      }
    } catch (e) {
      this.debugLog(`Error scanning ${dayPath}: ${(e as Error).message}`);
    }
  }

  /**
   * Start tracking a session file
   */
  private trackFile(filePath: string): void {
    if (this.trackedFiles.has(filePath)) return;

    const threadId = this.extractThreadId(filePath);
    if (!threadId) {
      this.debugLog(`Could not extract thread ID from: ${filePath}`);
      return;
    }

    const stat = statSync(filePath);
    const tracked: TrackedFile = {
      path: filePath,
      threadId,
      lastPosition: 0,
      lastModified: stat.mtimeMs,
    };

    this.trackedFiles.set(filePath, tracked);

    // Read initial content to get session info
    this.readNewContent(tracked, true);

    this.debugLog(`Tracking: ${filePath} (thread: ${threadId})`);
  }

  /**
   * Extract thread ID from filename
   * Format: rollout-<thread_id>.jsonl or similar
   */
  private extractThreadId(filePath: string): string | null {
    const filename = basename(filePath, '.jsonl');
    // Try common patterns
    const patterns = [
      /^rollout-(.+)$/,
      /^session-(.+)$/,
      /^thread-(.+)$/,
      /^(.+)$/,  // Fallback: use whole filename
    ];

    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Watch the sessions directory for new files
   */
  private watchSessionsDirectory(): void {
    try {
      // Watch the root sessions directory
      const watcher = watch(CODEX_SESSIONS_DIR, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;

        const filePath = join(CODEX_SESSIONS_DIR, filename);

        if (eventType === 'rename' && existsSync(filePath)) {
          // New file created
          this.trackFile(filePath);
          this.emit('session:new', this.getSessionInfo(filePath));
        }
      });

      this.watchers.set(CODEX_SESSIONS_DIR, watcher);
    } catch (e) {
      this.log(`Error setting up directory watcher: ${(e as Error).message}`);
    }
  }

  /**
   * Poll tracked files for changes
   */
  private pollTrackedFiles(): void {
    for (const tracked of this.trackedFiles.values()) {
      try {
        const stat = statSync(tracked.path);

        if (stat.mtimeMs > tracked.lastModified) {
          tracked.lastModified = stat.mtimeMs;
          this.readNewContent(tracked, false);
        }
      } catch (e) {
        // File may have been deleted
        this.debugLog(`Error polling ${tracked.path}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Read new content from a tracked file
   */
  private readNewContent(tracked: TrackedFile, isInitialRead: boolean): void {
    try {
      const content = readFileSync(tracked.path, 'utf-8');
      const newContent = content.slice(tracked.lastPosition);
      tracked.lastPosition = content.length;

      if (!newContent.trim()) return;

      const lines = newContent.trim().split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const rawEvent = JSON.parse(line) as CodexRawEvent;

          // Extract CWD from first event if available
          if (!tracked.cwd && rawEvent.item?.text) {
            // Try to extract cwd from environment_context in first message
            const cwdMatch = rawEvent.item.text.match(/cwd:\s*([^\n]+)/);
            if (cwdMatch) {
              tracked.cwd = cwdMatch[1].trim();
            }
          }

          // Extract first user message for session naming
          if (!tracked.firstUserMessage && rawEvent.item?.type === 'agent_message') {
            // Skip system messages
            const text = rawEvent.item.text || '';
            if (!text.includes('<environment_context>') && !text.includes('<INSTRUCTIONS>')) {
              tracked.firstUserMessage = text.slice(0, 100);
            }
          }

          // Map and emit event (skip initial read to avoid flooding)
          if (!isInitialRead) {
            const mappedEvent = this.mapCodexEvent(rawEvent, tracked);
            if (mappedEvent) {
              this.emit('event', mappedEvent);
            }
          }
        } catch (parseError) {
          this.debugLog(`Failed to parse JSONL line: ${(parseError as Error).message}`);
        }
      }
    } catch (e) {
      this.debugLog(`Error reading ${tracked.path}: ${(e as Error).message}`);
    }
  }

  /**
   * Map a Codex event to CIN-Interface format
   */
  private mapCodexEvent(raw: CodexRawEvent, tracked: TrackedFile): VibecraftEvent | null {
    const base = {
      id: `codex-${tracked.threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      sessionId: tracked.threadId,
      cwd: tracked.cwd || process.cwd(),
      agent: 'codex' as const,
    };

    switch (raw.type) {
      case 'thread.started':
        return {
          ...base,
          type: 'session_start',
          source: 'codex-cli',
        };

      case 'turn.started':
        return {
          ...base,
          type: 'user_prompt_submit',
          prompt: '[Turn started]',
        };

      case 'turn.completed':
        return {
          ...base,
          type: 'stop',
          stopHookActive: false,
          response: raw.item?.text,
        };

      case 'turn.failed':
        return {
          ...base,
          type: 'stop',
          stopHookActive: false,
          response: raw.error?.message || 'Turn failed',
        };

      case 'item.completed':
        return this.mapItemEvent(raw.item, base);

      case 'error':
        return {
          ...base,
          type: 'notification',
          message: raw.error?.message || 'Unknown error',
          notificationType: 'error',
        };

      default:
        return null;
    }
  }

  /**
   * Map a Codex item event to CIN-Interface format
   */
  private mapItemEvent(
    item: CodexItem | undefined,
    base: Omit<VibecraftEvent, 'type'>
  ): VibecraftEvent | null {
    if (!item) return null;

    switch (item.type) {
      case 'command_execution':
        return {
          ...base,
          type: 'post_tool_use',
          tool: 'Bash',
          toolInput: { command: item.command || '' },
          toolResponse: { stdout: item.output || '', exit_code: item.exit_code },
          toolUseId: item.id,
          success: item.exit_code === 0,
        };

      case 'file_change':
        const tool = item.operation === 'create' ? 'Write' : 'Edit';
        return {
          ...base,
          type: 'post_tool_use',
          tool,
          toolInput: { file_path: item.file_path },
          toolResponse: { operation: item.operation },
          toolUseId: item.id,
          success: true,
        };

      case 'web_search':
        return {
          ...base,
          type: 'post_tool_use',
          tool: 'WebSearch',
          toolInput: { query: item.query },
          toolResponse: {},
          toolUseId: item.id,
          success: true,
        };

      case 'mcp_tool_call':
        return {
          ...base,
          type: 'post_tool_use',
          tool: item.tool_name || 'MCP',
          toolInput: item.tool_input || {},
          toolResponse: {},
          toolUseId: item.id,
          success: true,
        };

      case 'agent_message':
        // Skip agent messages as separate events (they come with turn.completed)
        return null;

      case 'reasoning':
        // Could emit as a special event type if desired
        return null;

      case 'plan_update':
        return {
          ...base,
          type: 'post_tool_use',
          tool: 'TodoWrite',
          toolInput: { plan: item.text },
          toolResponse: {},
          toolUseId: item.id,
          success: true,
        };

      default:
        return null;
    }
  }

  /**
   * Get session info for a tracked file
   */
  getSessionInfo(filePath: string): CodexSessionInfo | null {
    const tracked = this.trackedFiles.get(filePath);
    if (!tracked) return null;

    // Derive name from first user message or directory
    let name = 'Codex Session';
    if (tracked.firstUserMessage) {
      name = tracked.firstUserMessage.slice(0, 50);
      if (tracked.firstUserMessage.length > 50) name += '...';
    } else if (tracked.cwd) {
      name = basename(tracked.cwd);
    }

    return {
      threadId: tracked.threadId,
      filePath: tracked.path,
      cwd: tracked.cwd || process.cwd(),
      name,
      firstUserMessage: tracked.firstUserMessage,
    };
  }

  /**
   * Get all tracked sessions
   */
  getAllSessions(): CodexSessionInfo[] {
    const sessions: CodexSessionInfo[] = [];

    for (const tracked of this.trackedFiles.values()) {
      const info = this.getSessionInfo(tracked.path);
      if (info) sessions.push(info);
    }

    return sessions;
  }

  /**
   * Check if a session is active (recently modified)
   */
  isSessionActive(threadId: string, maxAgeMs: number = 60000): boolean {
    for (const tracked of this.trackedFiles.values()) {
      if (tracked.threadId === threadId) {
        return Date.now() - tracked.lastModified < maxAgeMs;
      }
    }
    return false;
  }

  /**
   * List directories in a path
   */
  private listDirs(dirPath: string): string[] {
    try {
      return readdirSync(dirPath).filter(f => {
        const fullPath = join(dirPath, f);
        return statSync(fullPath).isDirectory();
      });
    } catch {
      return [];
    }
  }
}

// Export singleton for easy use
let instance: CodexSessionWatcher | null = null;

export function getCodexWatcher(options?: { debug?: boolean }): CodexSessionWatcher {
  if (!instance) {
    instance = new CodexSessionWatcher(options);
  }
  return instance;
}
