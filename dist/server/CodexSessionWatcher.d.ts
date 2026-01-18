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
import { EventEmitter } from 'events';
export interface CodexSessionInfo {
    threadId: string;
    filePath: string;
    cwd: string;
    name: string;
    firstUserMessage?: string;
}
export declare class CodexSessionWatcher extends EventEmitter {
    private trackedFiles;
    private watchers;
    private pollInterval;
    private enabled;
    private debug;
    constructor(options?: {
        debug?: boolean;
    });
    private log;
    private debugLog;
    /**
     * Start watching for Codex sessions
     */
    start(): void;
    /**
     * Stop watching
     */
    stop(): void;
    private static readonly MAX_SESSION_AGE_MS;
    /**
     * Scan for existing session files (only recent ones)
     */
    private scanForSessions;
    /**
     * Format a date as YYYY/MM/DD path
     */
    private formatDatePath;
    /**
     * Scan a day directory for session files
     */
    private scanDayDirectory;
    /**
     * Start tracking a session file
     */
    private trackFile;
    /**
     * Extract thread ID from filename
     * Format: rollout-<thread_id>.jsonl or similar
     */
    private extractThreadId;
    /**
     * Watch the sessions directory for new files
     */
    private watchSessionsDirectory;
    /**
     * Poll tracked files for changes
     */
    private pollTrackedFiles;
    /**
     * Read new content from a tracked file
     */
    private readNewContent;
    /**
     * Map a Codex session log event to CIN-Interface format
     * Handles the actual session log format (session_meta, response_item, event_msg, turn_context)
     */
    private mapCodexEvent;
    /**
     * Map a Codex response_item to CIN-Interface format
     */
    private mapResponseItem;
    /**
     * Map Codex tool/function names to CIN-Interface tool names
     */
    private mapToolName;
    /**
     * Get session info for a tracked file
     */
    getSessionInfo(filePath: string): CodexSessionInfo | null;
    /**
     * Get all tracked sessions
     */
    getAllSessions(): CodexSessionInfo[];
    /**
     * Check if a session is active (recently modified)
     */
    isSessionActive(threadId: string, maxAgeMs?: number): boolean;
    /**
     * List directories in a path
     */
    private listDirs;
}
export declare function getCodexWatcher(options?: {
    debug?: boolean;
}): CodexSessionWatcher;
//# sourceMappingURL=CodexSessionWatcher.d.ts.map