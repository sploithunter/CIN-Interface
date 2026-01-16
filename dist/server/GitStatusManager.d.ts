/**
 * GitStatusManager - Track git status for managed sessions
 *
 * Polls git status independently of Claude activity so we always
 * know the state of each session's working directory.
 */
import type { GitStatus } from '../shared/types.js';
export interface GitStatusUpdate {
    sessionId: string;
    status: GitStatus;
}
export type GitStatusUpdateHandler = (update: GitStatusUpdate) => void;
export declare class GitStatusManager {
    private statusCache;
    private directories;
    private pollInterval;
    private onUpdate;
    private readonly POLL_INTERVAL_MS;
    private readonly EXEC_TIMEOUT_MS;
    /**
     * Set callback for status updates
     */
    setUpdateHandler(handler: GitStatusUpdateHandler): void;
    /**
     * Register a session's working directory to track
     */
    track(sessionId: string, directory: string): void;
    /**
     * Stop tracking a session
     */
    untrack(sessionId: string): void;
    /**
     * Get cached status for a session
     */
    getStatus(sessionId: string): GitStatus | null;
    /**
     * Get all cached statuses
     */
    getAllStatuses(): Map<string, GitStatus>;
    /**
     * Start polling for git status
     */
    start(): void;
    /**
     * Stop polling
     */
    stop(): void;
    /**
     * Force refresh status for a session
     */
    refresh(sessionId: string): Promise<GitStatus | null>;
    /**
     * Poll all tracked directories
     */
    private pollAll;
    /**
     * Fetch git status for a directory
     */
    private fetchStatus;
    /**
     * Check if status has meaningfully changed
     */
    private hasStatusChanged;
    /**
     * Get git status for a directory
     */
    private getGitStatus;
    /**
     * Execute a git command in a directory using execFile (no shell).
     * Args should be passed as an array, not a string, to prevent command injection.
     */
    private execGit;
}
//# sourceMappingURL=GitStatusManager.d.ts.map