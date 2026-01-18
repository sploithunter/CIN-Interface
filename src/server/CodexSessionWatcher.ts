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
  ManagedSession,
} from '../shared/types.js';

// Actual Codex session log format (different from --json output)
interface CodexSessionLogEvent {
  timestamp: string;
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context';
  payload: CodexPayload;
}

type CodexPayload =
  | CodexSessionMeta
  | CodexResponseItem
  | CodexEventMsg
  | CodexTurnContext;

interface CodexSessionMeta {
  id: string;
  cwd: string;
  cli_version: string;
  model_provider?: string;
}

interface CodexResponseItem {
  type: 'function_call' | 'function_call_output' | 'message' | 'reasoning';
  // For function_call
  name?: string;
  arguments?: string;
  call_id?: string;
  // For function_call_output
  output?: string;
  // For message
  role?: string;
  content?: Array<{ type: string; text?: string }>;
}

interface CodexEventMsg {
  type: 'user_message' | 'agent_reasoning' | 'token_count' | 'turn_end';
  message?: string;
  text?: string;
}

interface CodexTurnContext {
  turn_id?: string;
}

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
    // Always log for now to debug
    console.log(`[CodexWatcher:debug] ${message}`);
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

  // Only track session files modified within the last 24 hours
  private static readonly MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

  /**
   * Scan for existing session files (only recent ones)
   */
  private scanForSessions(): void {
    try {
      // Only scan today's and yesterday's directories for efficiency
      const now = new Date();
      const today = this.formatDatePath(now);
      const yesterday = this.formatDatePath(new Date(now.getTime() - 24 * 60 * 60 * 1000));

      const pathsToScan = [today, yesterday]
        .map(datePath => join(CODEX_SESSIONS_DIR, datePath))
        .filter(p => existsSync(p));

      for (const dayPath of pathsToScan) {
        this.scanDayDirectory(dayPath);
      }

      this.log(`Found ${this.trackedFiles.size} recent Codex session files`);
    } catch (e) {
      this.log(`Error scanning sessions: ${(e as Error).message}`);
    }
  }

  /**
   * Format a date as YYYY/MM/DD path
   */
  private formatDatePath(date: Date): string {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return join(year, month, day);
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
          this.debugLog(`File changed: ${basename(tracked.path)} (${stat.mtimeMs} > ${tracked.lastModified})`);
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
          const rawEvent = JSON.parse(line) as CodexSessionLogEvent;

          // Extract CWD from session_meta
          if (rawEvent.type === 'session_meta') {
            const meta = rawEvent.payload as CodexSessionMeta;
            if (meta.cwd) {
              tracked.cwd = meta.cwd;
            }
          }

          // Extract first user message for session naming
          if (!tracked.firstUserMessage && rawEvent.type === 'event_msg') {
            const msg = rawEvent.payload as CodexEventMsg;
            if (msg.type === 'user_message' && msg.message) {
              tracked.firstUserMessage = msg.message.slice(0, 100);
            }
          }

          // Map and emit event (skip initial read to avoid flooding)
          if (!isInitialRead) {
            const mappedEvent = this.mapCodexEvent(rawEvent, tracked);
            if (mappedEvent) {
              this.debugLog(`Emitting event: ${mappedEvent.type}`);
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
   * Map a Codex session log event to CIN-Interface format
   * Handles the actual session log format (session_meta, response_item, event_msg, turn_context)
   */
  private mapCodexEvent(raw: CodexSessionLogEvent, tracked: TrackedFile): VibecraftEvent | null {
    const base = {
      id: `codex-${tracked.threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(raw.timestamp).getTime(),
      sessionId: tracked.threadId,
      cwd: tracked.cwd || process.cwd(),
      agent: 'codex' as const,
    };

    switch (raw.type) {
      case 'session_meta': {
        const meta = raw.payload as CodexSessionMeta;
        return {
          ...base,
          type: 'session_start',
          source: `codex-cli v${meta.cli_version}`,
        };
      }

      case 'event_msg': {
        const msg = raw.payload as CodexEventMsg;
        if (msg.type === 'user_message' && msg.message) {
          return {
            ...base,
            type: 'user_prompt_submit',
            prompt: msg.message,
          };
        }
        if (msg.type === 'turn_end') {
          return {
            ...base,
            type: 'stop',
            stopHookActive: false,
          };
        }
        // agent_reasoning, token_count - skip
        return null;
      }

      case 'response_item': {
        const item = raw.payload as CodexResponseItem;
        return this.mapResponseItem(item, base);
      }

      case 'turn_context':
        // Skip turn context events
        return null;

      default:
        return null;
    }
  }

  /**
   * Map a Codex response_item to CIN-Interface format
   */
  private mapResponseItem(
    item: CodexResponseItem,
    base: { id: string; timestamp: number; sessionId: string; cwd: string; agent: 'codex' }
  ): VibecraftEvent | null {
    switch (item.type) {
      case 'function_call': {
        // Map Codex function names to CIN-Interface tool names
        const toolName = this.mapToolName(item.name || 'unknown');
        let toolInput: Record<string, unknown> = {};

        try {
          if (item.arguments) {
            toolInput = JSON.parse(item.arguments);
          }
        } catch {
          toolInput = { raw: item.arguments };
        }

        return {
          ...base,
          type: 'pre_tool_use',
          tool: toolName,
          toolInput,
          toolUseId: item.call_id || base.id,
        };
      }

      case 'function_call_output': {
        // Parse output to extract useful info
        const output = item.output || '';
        const exitCodeMatch = output.match(/Exit code: (\d+)/);
        const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 0;

        return {
          ...base,
          type: 'post_tool_use',
          tool: 'Bash', // We might not know the tool here, default to Bash
          toolInput: {},
          toolResponse: { output, exit_code: exitCode },
          toolUseId: item.call_id || base.id,
          success: exitCode === 0,
        };
      }

      case 'message': {
        // Assistant messages - could be the final response
        if (item.role === 'assistant' && item.content) {
          const text = item.content
            .filter(c => c.type === 'output_text' || c.type === 'text')
            .map(c => c.text || '')
            .join('\n');

          if (text) {
            return {
              ...base,
              type: 'stop',
              stopHookActive: false,
              response: text,
            };
          }
        }
        return null;
      }

      case 'reasoning':
        // Skip reasoning events
        return null;

      default:
        return null;
    }
  }

  /**
   * Map Codex tool/function names to CIN-Interface tool names
   */
  private mapToolName(codexName: string): string {
    const mapping: Record<string, string> = {
      'shell_command': 'Bash',
      'shell': 'Bash',
      'read_file': 'Read',
      'write_file': 'Write',
      'edit_file': 'Edit',
      'list_directory': 'Glob',
      'search_files': 'Grep',
      'web_search': 'WebSearch',
    };
    return mapping[codexName] || codexName;
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
