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
import { join, basename } from 'path';
import { EventEmitter } from 'events';
// Codex home directory (can be overridden via env)
const CODEX_HOME = process.env.CODEX_HOME || join(process.env.HOME || '', '.codex');
const CODEX_SESSIONS_DIR = join(CODEX_HOME, 'sessions');
export class CodexSessionWatcher extends EventEmitter {
    trackedFiles = new Map();
    watchers = new Map();
    pollInterval = null;
    enabled = false;
    debug;
    constructor(options = {}) {
        super();
        this.debug = options.debug ?? false;
    }
    log(message) {
        console.log(`[CodexWatcher] ${message}`);
    }
    debugLog(message) {
        // Always log for now to debug
        console.log(`[CodexWatcher:debug] ${message}`);
    }
    /**
     * Start watching for Codex sessions
     */
    start() {
        if (this.enabled)
            return;
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
    stop() {
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
    static MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;
    /**
     * Scan for existing session files (only recent ones)
     */
    scanForSessions() {
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
        }
        catch (e) {
            this.log(`Error scanning sessions: ${e.message}`);
        }
    }
    /**
     * Format a date as YYYY/MM/DD path
     */
    formatDatePath(date) {
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return join(year, month, day);
    }
    /**
     * Scan a day directory for session files
     */
    scanDayDirectory(dayPath) {
        try {
            const files = readdirSync(dayPath).filter(f => f.endsWith('.jsonl'));
            for (const file of files) {
                const filePath = join(dayPath, file);
                this.trackFile(filePath);
            }
        }
        catch (e) {
            this.debugLog(`Error scanning ${dayPath}: ${e.message}`);
        }
    }
    /**
     * Start tracking a session file
     */
    trackFile(filePath) {
        if (this.trackedFiles.has(filePath))
            return;
        const threadId = this.extractThreadId(filePath);
        if (!threadId) {
            this.debugLog(`Could not extract thread ID from: ${filePath}`);
            return;
        }
        const stat = statSync(filePath);
        const tracked = {
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
    extractThreadId(filePath) {
        const filename = basename(filePath, '.jsonl');
        // Try common patterns
        const patterns = [
            /^rollout-(.+)$/,
            /^session-(.+)$/,
            /^thread-(.+)$/,
            /^(.+)$/, // Fallback: use whole filename
        ];
        for (const pattern of patterns) {
            const match = filename.match(pattern);
            if (match)
                return match[1];
        }
        return null;
    }
    /**
     * Watch the sessions directory for new files
     */
    watchSessionsDirectory() {
        try {
            // Watch the root sessions directory
            const watcher = watch(CODEX_SESSIONS_DIR, { recursive: true }, (eventType, filename) => {
                if (!filename || !filename.endsWith('.jsonl'))
                    return;
                const filePath = join(CODEX_SESSIONS_DIR, filename);
                if (eventType === 'rename' && existsSync(filePath)) {
                    // New file created
                    this.trackFile(filePath);
                    this.emit('session:new', this.getSessionInfo(filePath));
                }
            });
            this.watchers.set(CODEX_SESSIONS_DIR, watcher);
        }
        catch (e) {
            this.log(`Error setting up directory watcher: ${e.message}`);
        }
    }
    /**
     * Poll tracked files for changes
     */
    pollTrackedFiles() {
        for (const tracked of this.trackedFiles.values()) {
            try {
                const stat = statSync(tracked.path);
                if (stat.mtimeMs > tracked.lastModified) {
                    this.debugLog(`File changed: ${basename(tracked.path)} (${stat.mtimeMs} > ${tracked.lastModified})`);
                    tracked.lastModified = stat.mtimeMs;
                    this.readNewContent(tracked, false);
                }
            }
            catch (e) {
                // File may have been deleted
                this.debugLog(`Error polling ${tracked.path}: ${e.message}`);
            }
        }
    }
    /**
     * Read new content from a tracked file
     */
    readNewContent(tracked, isInitialRead) {
        try {
            const content = readFileSync(tracked.path, 'utf-8');
            const newContent = content.slice(tracked.lastPosition);
            tracked.lastPosition = content.length;
            if (!newContent.trim())
                return;
            const lines = newContent.trim().split('\n');
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const rawEvent = JSON.parse(line);
                    // Extract CWD from session_meta
                    if (rawEvent.type === 'session_meta') {
                        const meta = rawEvent.payload;
                        if (meta.cwd) {
                            tracked.cwd = meta.cwd;
                        }
                    }
                    // Extract first user message for session naming
                    if (!tracked.firstUserMessage && rawEvent.type === 'event_msg') {
                        const msg = rawEvent.payload;
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
                }
                catch (parseError) {
                    this.debugLog(`Failed to parse JSONL line: ${parseError.message}`);
                }
            }
        }
        catch (e) {
            this.debugLog(`Error reading ${tracked.path}: ${e.message}`);
        }
    }
    /**
     * Map a Codex session log event to CIN-Interface format
     * Handles the actual session log format (session_meta, response_item, event_msg, turn_context)
     */
    mapCodexEvent(raw, tracked) {
        const base = {
            id: `codex-${tracked.threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date(raw.timestamp).getTime(),
            sessionId: tracked.threadId,
            cwd: tracked.cwd || process.cwd(),
            agent: 'codex',
        };
        switch (raw.type) {
            case 'session_meta': {
                const meta = raw.payload;
                return {
                    ...base,
                    type: 'session_start',
                    source: `codex-cli v${meta.cli_version}`,
                };
            }
            case 'event_msg': {
                const msg = raw.payload;
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
                const item = raw.payload;
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
    mapResponseItem(item, base) {
        switch (item.type) {
            case 'function_call': {
                // Map Codex function names to CIN-Interface tool names
                const toolName = this.mapToolName(item.name || 'unknown');
                let toolInput = {};
                try {
                    if (item.arguments) {
                        toolInput = JSON.parse(item.arguments);
                    }
                }
                catch {
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
    mapToolName(codexName) {
        const mapping = {
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
    getSessionInfo(filePath) {
        const tracked = this.trackedFiles.get(filePath);
        if (!tracked)
            return null;
        // Derive name from first user message or directory
        let name = 'Codex Session';
        if (tracked.firstUserMessage) {
            name = tracked.firstUserMessage.slice(0, 50);
            if (tracked.firstUserMessage.length > 50)
                name += '...';
        }
        else if (tracked.cwd) {
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
    getAllSessions() {
        const sessions = [];
        for (const tracked of this.trackedFiles.values()) {
            const info = this.getSessionInfo(tracked.path);
            if (info)
                sessions.push(info);
        }
        return sessions;
    }
    /**
     * Check if a session is active (recently modified)
     */
    isSessionActive(threadId, maxAgeMs = 60000) {
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
    listDirs(dirPath) {
        try {
            return readdirSync(dirPath).filter(f => {
                const fullPath = join(dirPath, f);
                return statSync(fullPath).isDirectory();
            });
        }
        catch {
            return [];
        }
    }
}
// Export singleton for easy use
let instance = null;
export function getCodexWatcher(options) {
    if (!instance) {
        instance = new CodexSessionWatcher(options);
    }
    return instance;
}
//# sourceMappingURL=CodexSessionWatcher.js.map