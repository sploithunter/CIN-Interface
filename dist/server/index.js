/**
 * CIN-Interface WebSocket Server
 *
 * This server:
 * 1. Watches the events JSONL file for changes
 * 2. Accepts HTTP POST /event for real-time hook notifications
 * 3. Broadcasts events to connected WebSocket clients
 * 4. Tracks tool durations by matching pre/post events
 * 5. Proxies voice input to Deepgram for transcription
 * 6. Manages Claude Code sessions via tmux
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// NOTE: chokidar import removed - file watching now handled by bridge's FileWatcher
import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync, readdirSync, } from 'fs';
import { exec, execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, resolve, join, extname, basename } from 'path';
import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { DEFAULTS } from '../shared/defaults.js';
import { GitStatusManager } from './GitStatusManager.js';
import { ProjectsManager } from './ProjectsManager.js';
import { getCodexWatcher } from './CodexSessionWatcher.js';
import { createCINSessionManager } from './CINSessionManager.js';
import { JSONFileFeedbackRepo } from './feedback/index.js';
import { fileURLToPath } from 'url';
// Bridge components
import { createSessionManager, createFileWatcher, createTmuxExecutor, createEventProcessor, ClaudeAdapter, CodexAdapter, } from 'coding-agent-bridge';
// =============================================================================
// Version (read from package.json)
// =============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function getPackageVersion() {
    try {
        // Try multiple locations (dev vs compiled)
        const locations = [
            resolve(__dirname, '../package.json'), // dev: server/ -> package.json
            resolve(__dirname, '../../package.json'), // compiled: dist/server/ -> package.json
            resolve(__dirname, '../../../package.json'), // src/server/ -> package.json
        ];
        for (const loc of locations) {
            if (existsSync(loc)) {
                const pkg = JSON.parse(readFileSync(loc, 'utf-8'));
                return pkg.version || 'unknown';
            }
        }
    }
    catch {
        // Ignore errors
    }
    return 'unknown';
}
const VERSION = getPackageVersion();
// =============================================================================
// Configuration
// =============================================================================
/** Expand ~ to home directory in paths */
function expandHome(path) {
    if (path.startsWith('~/') || path === '~') {
        return path.replace('~', process.env.HOME || '');
    }
    return path;
}
const PORT = parseInt(process.env.CIN_PORT ?? String(DEFAULTS.SERVER_PORT), 10);
const EVENTS_FILE = resolve(expandHome(process.env.CIN_EVENTS_FILE ?? DEFAULTS.EVENTS_FILE));
const PENDING_PROMPT_FILE = resolve(expandHome(process.env.CIN_PROMPT_FILE ?? '~/.cin-interface/data/pending-prompt.txt'));
const MAX_EVENTS = parseInt(process.env.CIN_MAX_EVENTS ?? String(DEFAULTS.MAX_EVENTS), 10);
const DEBUG = process.env.CIN_DEBUG === '1' || process.env.CIN_DEBUG === 'true';
const TRACE = process.env.CIN_TRACE === 'true'; // Verbose event field detection logging
const TMUX_SESSION = process.env.CIN_TMUX_SESSION ?? DEFAULTS.TMUX_SESSION;
const SESSIONS_FILE = resolve(expandHome(process.env.CIN_SESSIONS_FILE ?? DEFAULTS.SESSIONS_FILE));
const METADATA_FILE = resolve(expandHome(process.env.CIN_METADATA_FILE ?? '~/.cin-interface/data/cin-metadata.json'));
const TILES_FILE = resolve(expandHome(process.env.CIN_TILES_FILE ?? '~/.cin-interface/data/tiles.json'));
const DATA_DIR = resolve(expandHome('~/.cin-interface/data'));
/** Time before a "working" session auto-transitions to idle */
const WORKING_TIMEOUT_MS = 120_000; // 2 minutes
/** Time before offline internal sessions with dead tmux are auto-cleaned (1 hour) */
const OFFLINE_CLEANUP_MS = 60 * 60 * 1000; // 1 hour
/** Time before offline EXTERNAL sessions are auto-cleaned (15 minutes)
 * External sessions are receive-only - we can't restart or interact with them,
 * so there's no point keeping them around once they go offline */
const EXTERNAL_OFFLINE_CLEANUP_MS = 5 * 60 * 1000; // 5 minutes
/** Time before ANY offline session (including external) is auto-cleaned (7 days) */
const OFFLINE_STALE_CLEANUP_DAYS = 7;
const OFFLINE_STALE_CLEANUP_MS = OFFLINE_STALE_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
/** Maximum request body size (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;
/** How often to check for stale "working" sessions */
const WORKING_CHECK_INTERVAL_MS = 10_000; // 10 seconds
/** Extended PATH for exec() */
const HOME = process.env.HOME || '';
const EXEC_PATH = [
    `${HOME}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.env.PATH || '',
].join(':');
const EXEC_OPTIONS = { env: { ...process.env, PATH: EXEC_PATH } };
/** Deepgram configuration */
const DEEPGRAM_API_KEY_ENV = 'DEEPGRAM_API_KEY';
const DEEPGRAM_MODEL = 'nova-2';
const DEEPGRAM_LANGUAGE = 'en';
// =============================================================================
// Security Helpers
// =============================================================================
function isOriginAllowed(origin) {
    if (!origin)
        return false;
    try {
        const url = new URL(origin);
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            return true;
        }
        // Allow CIN-Interface hosted version if deployed
        if (url.hostname === 'cin-interface.local' && url.protocol === 'https:') {
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
function validateDirectoryPath(inputPath) {
    const resolved = resolve(expandHome(inputPath));
    if (!existsSync(resolved)) {
        throw new Error(`Directory does not exist: ${inputPath}`);
    }
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: ${inputPath}`);
    }
    const dangerousChars = /[;&|`$(){}[\]<>\\'"!#*?]/;
    if (dangerousChars.test(resolved)) {
        throw new Error(`Directory path contains invalid characters: ${inputPath}`);
    }
    return resolved;
}
function validateTmuxSession(name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error(`Invalid tmux session name: ${name}`);
    }
    return name;
}
function collectRequestBody(req, maxSize = MAX_BODY_SIZE) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxSize) {
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            body += chunk;
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
/**
 * Send text to a tmux session using bridge's TmuxExecutor.
 * This replaces the embedded tmux code with the bridge component.
 */
async function sendToTmuxSafe(tmuxSession, text) {
    await bridgeTmux.pasteBuffer({
        target: tmuxSession,
        text,
        sendEnter: true,
    });
}
// =============================================================================
// State
// =============================================================================
const events = [];
const seenEventIds = new Set();
const pendingToolUses = new Map();
const clients = new Set();
let lastFileSize = 0;
const sessionTokens = new Map();
let lastTmuxHash = '';
const pendingPermissions = new Map();
const bypassWarningHandled = new Set();
const textTiles = new Map();
const gitStatusManager = new GitStatusManager();
const projectsManager = new ProjectsManager();
const feedbackRepo = new JSONFileFeedbackRepo(DATA_DIR);
const voiceSessions = new Map();
let deepgramApiKey = null;
// CINSessionManager wraps bridgeSessionManager and stores CIN-specific metadata
// Will be initialized after bridgeSessionManager is created
let cinSessionManager;
// =============================================================================
// Bridge Components (from coding-agent-bridge)
// =============================================================================
// Session manager handles session CRUD, state machine, persistence, health checks
const bridgeSessionManager = createSessionManager({
    sessionsFile: SESSIONS_FILE,
    defaultAgent: 'claude',
    workingTimeoutMs: WORKING_TIMEOUT_MS,
    offlineCleanupMs: OFFLINE_CLEANUP_MS,
    staleCleanupMs: OFFLINE_STALE_CLEANUP_MS,
    trackExternalSessions: true,
    debug: DEBUG,
});
// Register agent adapters
bridgeSessionManager.registerAdapter(ClaudeAdapter);
bridgeSessionManager.registerAdapter(CodexAdapter);
// Create CINSessionManager wrapper
cinSessionManager = createCINSessionManager(bridgeSessionManager, {
    metadataFile: METADATA_FILE,
    gitStatusManager,
    projectsManager,
    debug: DEBUG,
});
// File watcher monitors events.jsonl for new events
const bridgeFileWatcher = createFileWatcher(EVENTS_FILE, {
    processExisting: false, // Only new events
    debug: DEBUG,
});
// EventProcessor to transform raw hook events (with hook_event_name) to normalized events (with type)
// Use TRACE for verbose field detection logging: CIN_TRACE=true npm run dev
const bridgeEventProcessor = createEventProcessor({ debug: DEBUG, trace: TRACE });
// TmuxExecutor for safe tmux operations (replaces embedded tmux code)
const bridgeTmux = createTmuxExecutor({ debug: DEBUG });
/**
 * Wire up bridge event flow:
 * FileWatcher → parse JSON → addEvent() → session routing → WebSocket broadcast
 *
 * This replaces the old watchEventsFile() function with bridge components.
 */
function initBridgeEventFlow() {
    // Connect FileWatcher output to event processing
    // Use EventProcessor to transform raw hook events (hook_event_name) to normalized events (type)
    bridgeFileWatcher.on('line', (line) => {
        try {
            const parsed = JSON.parse(line);
            // Check if this is an already-normalized event (has 'type' field with valid value)
            // or a raw hook event (has 'hook_event_name' field)
            const validTypes = [
                'pre_tool_use',
                'post_tool_use',
                'stop',
                'subagent_stop',
                'session_start',
                'session_end',
                'user_prompt_submit',
                'notification',
            ];
            if (parsed.type && validTypes.includes(parsed.type)) {
                // Already normalized event - use directly
                const event = {
                    id: parsed.id || `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    type: parsed.type,
                    timestamp: parsed.timestamp || Date.now(),
                    sessionId: parsed.sessionId || '',
                    cwd: parsed.cwd || process.cwd(),
                    ...parsed,
                };
                addEvent(event);
                debug(`[Bridge] New normalized event from file: ${event.type}`);
            }
            else {
                // Raw hook event - use EventProcessor
                const processed = bridgeEventProcessor.processLine(line);
                if (processed) {
                    // ProcessedEvent has { event: AgentEvent, agentSessionId, ... }
                    // We need to set sessionId on the event from the extracted agentSessionId
                    const event = processed.event;
                    event.sessionId = processed.agentSessionId;
                    event.cwd = processed.cwd || event.cwd || process.cwd();
                    addEvent(event);
                    debug(`[Bridge] New raw event from file: ${event.type}`);
                }
                else {
                    debug(`[Bridge] EventProcessor returned null for: ${line.substring(0, 100)}`);
                }
            }
        }
        catch (e) {
            debug(`[Bridge] Failed to parse event: ${line.substring(0, 100)}`);
        }
    });
    // Listen for session changes from CINSessionManager (which wraps bridgeSessionManager)
    cinSessionManager.on('session:created', (session) => {
        debug(`[CIN] Session created: ${session.name} (${session.id})`);
        broadcastSessions();
    });
    cinSessionManager.on('session:updated', (session, changes) => {
        debug(`[CIN] Session updated: ${session.name} - ${JSON.stringify(changes)}`);
        broadcastSessions();
        cinSessionManager.saveMetadata();
    });
    cinSessionManager.on('session:status', (session, from, to) => {
        debug(`[CIN] Session ${session.name}: ${from} -> ${to}`);
        broadcastSessions();
        cinSessionManager.saveMetadata();
    });
    cinSessionManager.on('session:deleted', (session) => {
        debug(`[CIN] Session deleted: ${session.name} (${session.id})`);
        broadcastSessions();
        cinSessionManager.saveMetadata();
    });
    cinSessionManager.on('error', (error) => {
        console.error('[CIN] SessionManager error:', error);
    });
    bridgeFileWatcher.on('error', (error) => {
        console.error('[Bridge] FileWatcher error:', error);
    });
}
/**
 * Start bridge components
 */
async function startBridge() {
    log('[Bridge] Starting bridge components...');
    // Start session manager (loads state, starts health checks)
    await bridgeSessionManager.start();
    log('[Bridge] SessionManager started');
    // Start CIN session manager (loads metadata)
    await cinSessionManager.start();
    log('[CIN] CINSessionManager started');
    // Wire up event flow BEFORE starting file watcher
    // Event handlers must be attached before start() to avoid missing events
    initBridgeEventFlow();
    log('[Bridge] Event flow wired');
    // Start file watcher
    await bridgeFileWatcher.start();
    log('[Bridge] FileWatcher started');
}
/**
 * Stop bridge components (for graceful shutdown)
 */
async function stopBridge() {
    log('[Bridge] Stopping bridge components...');
    await bridgeFileWatcher.stop();
    await cinSessionManager.stop();
    await bridgeSessionManager.stop();
    log('[Bridge] Bridge stopped');
}
// =============================================================================
// Logging
// =============================================================================
function log(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}
function debug(...args) {
    if (DEBUG) {
        console.log(`[DEBUG ${new Date().toISOString()}]`, ...args);
    }
}
// =============================================================================
// Deepgram
// =============================================================================
function loadDeepgramKey() {
    const key = process.env[DEEPGRAM_API_KEY_ENV]?.trim();
    if (key) {
        log('Deepgram API key loaded from environment');
        return key;
    }
    log(`${DEEPGRAM_API_KEY_ENV} not set - voice input disabled`);
    return null;
}
// =============================================================================
// Token Tracking
// =============================================================================
function parseTokensFromOutput(output) {
    const patterns = [/↓\s*([0-9,]+)\s*tokens?/gi, /↓\s*([0-9.]+)k\s*tokens?/gi];
    let maxTokens = 0;
    const plainMatches = output.matchAll(patterns[0]);
    for (const match of plainMatches) {
        const num = parseInt(match[1].replace(/,/g, ''), 10);
        if (num > maxTokens)
            maxTokens = num;
    }
    const kMatches = output.matchAll(patterns[1]);
    for (const match of kMatches) {
        const num = Math.round(parseFloat(match[1]) * 1000);
        if (num > maxTokens)
            maxTokens = num;
    }
    return maxTokens > 0 ? maxTokens : null;
}
async function pollTokens(tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        debug(`Invalid tmux session for token polling: ${tmuxSession}`);
        return;
    }
    try {
        const stdout = await bridgeTmux.capturePane(tmuxSession, { start: -50 });
        const hash = stdout.slice(-500);
        if (hash === lastTmuxHash)
            return;
        lastTmuxHash = hash;
        const tokens = parseTokensFromOutput(stdout);
        if (tokens === null)
            return;
        let session = sessionTokens.get(tmuxSession);
        if (!session) {
            session = { lastSeen: 0, cumulative: 0, lastUpdate: Date.now() };
            sessionTokens.set(tmuxSession, session);
        }
        if (tokens > session.lastSeen) {
            const delta = tokens - session.lastSeen;
            session.cumulative += delta;
            session.lastSeen = tokens;
            session.lastUpdate = Date.now();
            debug(`Tokens updated: ${tokens} (cumulative: ${session.cumulative})`);
            broadcast({
                type: 'tokens',
                payload: {
                    session: tmuxSession,
                    current: tokens,
                    cumulative: session.cumulative,
                },
            });
        }
        else if (tokens < session.lastSeen && tokens > 0) {
            session.lastSeen = tokens;
            session.lastUpdate = Date.now();
            debug(`Token count reset detected: ${tokens}`);
        }
    }
    catch (error) {
        debug(`Token poll failed: ${error instanceof Error ? error.message : error}`);
    }
}
function startTokenPolling() {
    setInterval(() => {
        const sessions = cinSessionManager.listSessions();
        for (const session of sessions) {
            // Only poll internal sessions (they have tmuxSession)
            if (session.status !== 'offline' && session.tmuxSession) {
                pollTokens(session.tmuxSession);
            }
        }
        if (sessions.length === 0) {
            pollTokens(TMUX_SESSION);
        }
    }, 2000);
    log(`Token polling started`);
}
// =============================================================================
// Permission Prompt Detection
// =============================================================================
function detectPermissionPrompt(output) {
    const lines = output.split('\n');
    let proceedLineIdx = -1;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
        if (/(Do you want|Would you like) to proceed\?/i.test(lines[i])) {
            proceedLineIdx = i;
            break;
        }
    }
    if (proceedLineIdx === -1)
        return null;
    let hasFooter = false;
    let hasSelector = false;
    for (let i = proceedLineIdx + 1; i < Math.min(lines.length, proceedLineIdx + 15); i++) {
        if (/Esc to cancel|ctrl-g to edit/i.test(lines[i])) {
            hasFooter = true;
            break;
        }
        if (/^\s*❯/.test(lines[i])) {
            hasSelector = true;
        }
    }
    if (!hasFooter && !hasSelector) {
        debug('Skipping false positive: no footer or selector found');
        return null;
    }
    const options = [];
    for (let i = proceedLineIdx + 1; i < Math.min(lines.length, proceedLineIdx + 10); i++) {
        const line = lines[i];
        if (/Esc to cancel/i.test(line))
            break;
        const optionMatch = line.match(/^\s*[❯>]?\s*(\d+)\.\s+(.+)$/);
        if (optionMatch) {
            options.push({
                number: optionMatch[1],
                label: optionMatch[2].trim(),
            });
        }
    }
    if (options.length < 2)
        return null;
    let tool = 'Unknown';
    for (let i = proceedLineIdx; i >= Math.max(0, proceedLineIdx - 20); i--) {
        const toolMatch = lines[i].match(/[●◐·]\s*(\w+)\s*\(/);
        if (toolMatch) {
            tool = toolMatch[1];
            break;
        }
        const cmdMatch = lines[i].match(/^\s*(Bash|Read|Write|Edit|Grep|Glob|Task|WebFetch|WebSearch)\s+\w+/i);
        if (cmdMatch) {
            tool = cmdMatch[1];
            break;
        }
    }
    const contextStart = Math.max(0, proceedLineIdx - 10);
    const contextEnd = proceedLineIdx + 1 + options.length;
    const context = lines.slice(contextStart, contextEnd).join('\n').trim();
    debug(`Detected permission prompt: tool=${tool}, options=${options.length}`);
    return { tool, context, options };
}
function detectBypassWarning(output) {
    return output.includes('WARNING') && output.includes('Bypass Permissions mode');
}
async function pollPermissions(sessionId, tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        debug(`Invalid tmux session for permission polling: ${tmuxSession}`);
        return;
    }
    try {
        const stdout = await bridgeTmux.capturePane(tmuxSession, { start: -50 });
        if (detectBypassWarning(stdout) && !bypassWarningHandled.has(sessionId)) {
            log(`Bypass permissions warning detected for session ${sessionId}, auto-accepting...`);
            bypassWarningHandled.add(sessionId);
            bridgeTmux.sendKeys({ target: tmuxSession, keys: '2' })
                .then(() => log(`Bypass permissions warning accepted for session ${sessionId}`))
                .catch((err) => log(`Failed to auto-accept bypass warning: ${err.message}`));
            return;
        }
        const prompt = detectPermissionPrompt(stdout);
        const existing = pendingPermissions.get(sessionId);
        if (prompt && !existing) {
            pendingPermissions.set(sessionId, {
                tool: prompt.tool,
                context: prompt.context,
                options: prompt.options,
                detectedAt: Date.now(),
            });
            log(`Permission prompt detected for session ${sessionId}: ${prompt.tool}`);
            broadcast({
                type: 'permission_prompt',
                payload: {
                    sessionId,
                    tool: prompt.tool,
                    context: prompt.context,
                    options: prompt.options,
                },
            });
            const session = cinSessionManager.getSession(sessionId);
            if (session) {
                cinSessionManager.updateSessionStatus(sessionId, 'waiting');
                cinSessionManager.updateSessionTool(sessionId, prompt.tool);
                broadcastSessions();
            }
        }
        else if (!prompt && existing) {
            pendingPermissions.delete(sessionId);
            log(`Permission prompt resolved for session ${sessionId}`);
            broadcast({
                type: 'permission_resolved',
                payload: { sessionId },
            });
            const session = cinSessionManager.getSession(sessionId);
            if (session && session.status === 'waiting') {
                cinSessionManager.updateSessionStatus(sessionId, 'working');
                cinSessionManager.updateSessionTool(sessionId, undefined);
                broadcastSessions();
            }
        }
    }
    catch (error) {
        debug(`Permission poll failed for ${tmuxSession}: ${error instanceof Error ? error.message : error}`);
    }
}
function startPermissionPolling() {
    setInterval(() => {
        const sessions = cinSessionManager.listSessions();
        for (const session of sessions) {
            // Only poll internal sessions (they have tmuxSession)
            if (session.status !== 'offline' && session.tmuxSession) {
                pollPermissions(session.id, session.tmuxSession);
            }
        }
    }, 1000);
    log(`Permission polling started`);
}
function sendPermissionResponse(sessionId, optionNumber) {
    const session = cinSessionManager.getSession(sessionId);
    if (!session) {
        log(`Cannot send permission response: session ${sessionId} not found`);
        return false;
    }
    // Only internal sessions have tmux control
    if (!session.tmuxSession) {
        log(`Cannot send permission response: session ${sessionId} is external (no tmux)`);
        return false;
    }
    if (!/^\d+$/.test(optionNumber)) {
        log(`Invalid permission response: ${optionNumber} (expected number)`);
        return false;
    }
    try {
        validateTmuxSession(session.tmuxSession);
    }
    catch {
        log(`Invalid tmux session name: ${session.tmuxSession}`);
        return false;
    }
    bridgeTmux.sendKeys({ target: session.tmuxSession, keys: optionNumber })
        .then(() => {
        log(`Sent permission response to ${session.name}: option ${optionNumber}`);
        pendingPermissions.delete(sessionId);
        cinSessionManager.updateSessionStatus(sessionId, 'working');
        cinSessionManager.updateSessionTool(sessionId, undefined);
        broadcastSessions();
    })
        .catch((error) => {
        log(`Failed to send permission response: ${error.message}`);
    });
    return true;
}
// =============================================================================
// Suggestion Extraction (Claude's suggested next prompt)
// =============================================================================
/**
 * Extract Claude's suggested next prompt from tmux pane output.
 * The suggestion appears at the input line in gray text.
 * We look for the last line that contains a prompt indicator and text after it.
 */
function extractSuggestion(output) {
    const lines = output.split('\n');
    // Look at the last 10 lines for the input prompt with suggestion
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
        const line = lines[i].trim();
        // Skip empty lines
        if (!line)
            continue;
        // Claude Code prompt patterns:
        // "❯" (U+276F) or ">" followed by suggestion text
        // The suggestion is usually the text after the prompt character
        // Look for a line starting with the prompt character followed by text
        const promptMatch = line.match(/^[❯>]\s*(.+)$/);
        if (promptMatch && promptMatch[1]) {
            let suggestion = promptMatch[1].trim();
            // Remove trailing status indicators like "↵ send" or "shift+tab to cycle"
            suggestion = suggestion.replace(/\s*↵\s*send\s*$/i, '').trim();
            suggestion = suggestion.replace(/\s*shift\+tab to cycle\s*$/i, '').trim();
            suggestion = suggestion.replace(/\s+$/, '').trim();
            // Exclude common non-suggestion patterns
            if (suggestion &&
                !suggestion.startsWith('[') &&
                !suggestion.includes('tokens') &&
                !suggestion.includes('bypass permissions') &&
                suggestion.length > 2) {
                return suggestion;
            }
        }
    }
    return null;
}
async function pollSuggestions(sessionId, tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        return;
    }
    try {
        const stdout = await bridgeTmux.capturePane(tmuxSession, { start: -20 });
        const session = cinSessionManager.getSession(sessionId);
        if (!session)
            return;
        // Only look for suggestions when session is waiting or idle
        // (sessions may timeout to idle while still waiting for input)
        if (session.status !== 'waiting' && session.status !== 'idle') {
            if (session.suggestion) {
                cinSessionManager.updateMetadata(sessionId, { suggestion: undefined });
                broadcastSessions();
            }
            return;
        }
        const suggestion = extractSuggestion(stdout);
        // Update if suggestion changed
        if (suggestion !== session.suggestion) {
            cinSessionManager.updateMetadata(sessionId, { suggestion: suggestion || undefined });
            debug(`Suggestion for ${session.name}: ${suggestion || '(none)'}`);
            broadcastSessions();
        }
    }
    catch {
        // Ignore errors - session may have ended
    }
}
function startSuggestionPolling() {
    setInterval(() => {
        const sessions = cinSessionManager.listSessions();
        for (const session of sessions) {
            // Poll for suggestions in both 'waiting' and 'idle' sessions
            // (idle sessions may have timed out but still be waiting for input)
            // Only internal sessions have tmux to poll from
            if ((session.status === 'waiting' || session.status === 'idle') && session.tmuxSession) {
                pollSuggestions(session.id, session.tmuxSession);
            }
        }
    }, 1500); // Poll every 1.5 seconds
    log(`Suggestion polling started`);
}
// =============================================================================
// Ralph Wiggum Mode (Auto-Accept Suggestions)
// =============================================================================
// Track last auto-accept time per session to prevent rapid-fire
const lastAutoAcceptTime = new Map();
const AUTO_ACCEPT_COOLDOWN_MS = 3000; // 3 second cooldown between auto-accepts
function startRalphWiggumPolling() {
    setInterval(() => {
        const sessions = cinSessionManager.listSessions();
        for (const session of sessions) {
            // Check if Ralph Wiggum mode is enabled for this session
            if (!session.autoAccept)
                continue;
            // Only auto-accept for internal sessions that are waiting with a suggestion
            if (!session.tmuxSession)
                continue;
            if (session.status !== 'waiting' && session.status !== 'idle')
                continue;
            if (!session.suggestion)
                continue;
            // Check cooldown to prevent rapid-fire
            const lastTime = lastAutoAcceptTime.get(session.id) || 0;
            const now = Date.now();
            if (now - lastTime < AUTO_ACCEPT_COOLDOWN_MS)
                continue;
            // Auto-accept the suggestion!
            log(`[Ralph Wiggum] Auto-accepting suggestion for ${session.name}: "${session.suggestion.slice(0, 50)}..."`);
            lastAutoAcceptTime.set(session.id, now);
            cinSessionManager.sendPrompt(session.id, session.suggestion).then((result) => {
                if (result.ok) {
                    // Clear the suggestion so we don't send it again
                    cinSessionManager.updateMetadata(session.id, { suggestion: undefined });
                    cinSessionManager.updateSessionStatus(session.id, 'working');
                    broadcastSessions();
                }
                else {
                    log(`[Ralph Wiggum] Failed to auto-accept for ${session.name}: ${result.error}`);
                }
            });
        }
    }, 2000); // Check every 2 seconds
    log(`Ralph Wiggum mode polling started`);
}
// =============================================================================
// Session Management
// =============================================================================
function shortId() {
    return randomUUID().slice(0, 8);
}
/**
 * Open a Terminal.app window attached to a tmux session (macOS only)
 */
function openTerminalForTmux(tmuxSession) {
    if (process.platform !== 'darwin') {
        debug('openTerminalForTmux: Not on macOS, skipping');
        return;
    }
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        log(`Invalid tmux session name for terminal: ${tmuxSession}`);
        return;
    }
    // Use osascript to open Terminal.app and attach to the tmux session
    const script = `
    tell application "Terminal"
      activate
      do script "tmux attach-session -t ${tmuxSession}"
    end tell
  `;
    exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, EXEC_OPTIONS, (error) => {
        if (error) {
            log(`Failed to open terminal for ${tmuxSession}: ${error.message}`);
        }
        else {
            log(`Opened Terminal.app for session ${tmuxSession}`);
        }
    });
}
/**
 * Focus the terminal window for an external session (macOS only)
 * Tries multiple strategies: tmux pane, tty device, or just activate Terminal
 */
function focusExternalTerminal(terminalInfo) {
    if (process.platform !== 'darwin') {
        debug('focusExternalTerminal: Not on macOS, skipping');
        return;
    }
    const { tmuxPane, tmuxSocket, tty } = terminalInfo;
    // Strategy 1: If running in tmux, select the pane and focus Terminal
    if (tmuxPane) {
        // Extract just the pane number (e.g., "%0" -> "0")
        const paneId = tmuxPane.replace(/^%/, '');
        const socketArg = tmuxSocket ? `-S "${tmuxSocket.split(',')[0]}"` : '';
        // Select the tmux pane and then activate Terminal
        const script = `
      tell application "Terminal"
        activate
      end tell
    `;
        // First select the tmux pane
        exec(`tmux ${socketArg} select-pane -t %${paneId} 2>/dev/null`, EXEC_OPTIONS, (err) => {
            if (err) {
                debug(`Could not select tmux pane %${paneId}: ${err.message}`);
            }
            // Then activate Terminal regardless
            exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, EXEC_OPTIONS, (error) => {
                if (error) {
                    log(`Failed to focus terminal: ${error.message}`);
                }
                else {
                    log(`Focused terminal (tmux pane: ${tmuxPane})`);
                }
            });
        });
        return;
    }
    // Strategy 2: Use tty to find and focus the terminal window
    if (tty) {
        // AppleScript to find the window with the matching tty
        // This is a best-effort approach - Terminal.app doesn't expose tty directly
        // But activating Terminal.app is usually enough for the user to find their session
        const script = `
      tell application "Terminal"
        activate
      end tell
    `;
        exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, EXEC_OPTIONS, (error) => {
            if (error) {
                log(`Failed to focus terminal: ${error.message}`);
            }
            else {
                log(`Focused terminal (tty: ${tty})`);
            }
        });
        return;
    }
    // Fallback: just activate Terminal.app
    const script = `
    tell application "Terminal"
      activate
    end tell
  `;
    exec(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, EXEC_OPTIONS, (error) => {
        if (error) {
            log(`Failed to focus terminal: ${error.message}`);
        }
        else {
            log('Focused Terminal.app');
        }
    });
}
async function createSession(options = {}) {
    // Validate cwd
    const cwd = validateDirectoryPath(options.cwd || process.cwd());
    const flags = options.flags || {};
    try {
        // Delegate to cinSessionManager
        const session = await cinSessionManager.createSession({
            ...options,
            cwd,
        });
        log(`Created ${session.agent} session: ${session.name} (${session.id.slice(0, 8)}) -> tmux:${session.tmuxSession}`);
        // Open Terminal.app attached to the tmux session (default: true)
        if (flags.openTerminal !== false && session.tmuxSession) {
            openTerminalForTmux(session.tmuxSession);
        }
        broadcastSessions();
        return session;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to create session: ${message}`);
        throw new Error(`Failed to create session: ${message}`);
    }
}
function getSessions() {
    // cinSessionManager.listSessions() already includes gitStatus via mergeMetadata
    return cinSessionManager.listSessions();
}
function getSession(id) {
    return cinSessionManager.getSession(id);
}
function updateSession(id, updates) {
    const updated = cinSessionManager.updateSession(id, updates);
    if (!updated)
        return null;
    log(`Updated session: ${updated.name} (${id.slice(0, 8)})`);
    broadcastSessions();
    return updated;
}
async function deleteSession(id) {
    const session = cinSessionManager.getSession(id);
    if (!session) {
        return false;
    }
    // On macOS, get the Terminal window ID before killing tmux so we can close it
    let terminalWindowId = null;
    if (process.platform === 'darwin' && session.tmuxSession) {
        try {
            const result = execSync(`osascript -e '
        tell application "Terminal"
          repeat with w in windows
            if name of w contains "${session.tmuxSession}" then
              return id of w
            end if
          end repeat
        end tell
      '`, { encoding: 'utf8', timeout: 5000 }).trim();
            if (result && /^\d+$/.test(result)) {
                terminalWindowId = result;
            }
        }
        catch {
            // Ignore - window may not exist or Terminal not running
        }
    }
    // Delegate deletion to cinSessionManager (which handles tmux cleanup via bridge)
    const deleted = await cinSessionManager.deleteSession(id);
    if (!deleted) {
        log(`Warning: Failed to delete session: ${id}`);
        return false;
    }
    log(`Deleted session: ${session.name} (${id.slice(0, 8)})`);
    // On macOS, close the Terminal window that was attached to this session
    // Add a small delay to let the tmux detach complete before closing Terminal
    if (terminalWindowId) {
        setTimeout(() => {
            try {
                execSync(`osascript -e 'tell application "Terminal" to close (first window whose id is ${terminalWindowId})'`, { timeout: 5000 });
                debug(`Closed Terminal window ${terminalWindowId} for session ${session.tmuxSession}`);
            }
            catch {
                // Ignore - window may have already closed
            }
        }, 500);
    }
    broadcastSessions();
    return true;
}
/**
 * Send text to a tmux pane by pane ID (for external sessions running in tmux).
 * Uses bridge's TmuxExecutor for safe tmux operations.
 */
async function sendToTmuxPane(tmuxPane, tmuxSocket, text) {
    await bridgeTmux.pasteBuffer({
        target: tmuxPane,
        text,
        isPaneId: true,
        socket: tmuxSocket ? tmuxSocket.split(',')[0] : undefined,
        sendEnter: true,
    });
}
async function sendPromptToSession(id, prompt, images) {
    // Delegate to cinSessionManager which handles image preprocessing
    const result = await cinSessionManager.sendPrompt(id, prompt, images);
    if (result.ok) {
        const session = cinSessionManager.getSession(id);
        log(`Prompt sent to ${session?.name || id}: ${prompt.slice(0, 50)}...`);
        if (result.imagePaths && result.imagePaths.length > 0) {
            log(`Prompt includes ${result.imagePaths.length} image(s)`);
        }
    }
    return result;
}
/**
 * Check if tmux sessions are still alive.
 * Note: bridgeSessionManager already handles this via its health checks,
 * but we keep this for additional broadcast triggers.
 */
async function checkSessionHealth() {
    // bridgeSessionManager already handles tmux health checks
    // Just trigger a broadcast to ensure UI is in sync
    broadcastSessions();
}
/**
 * Check for sessions stuck in working state.
 * Note: bridgeSessionManager already handles this via its working timeout checks,
 * but we keep this for additional broadcast triggers and logging.
 */
function checkWorkingTimeout() {
    const now = Date.now();
    let changed = false;
    const sessions = cinSessionManager.listSessions();
    for (const session of sessions) {
        if (session.status === 'working') {
            const timeSinceActivity = now - session.lastActivity;
            if (timeSinceActivity > WORKING_TIMEOUT_MS) {
                log(`Session "${session.name}" timed out after ${Math.round(timeSinceActivity / 1000)}s`);
                cinSessionManager.updateSessionStatus(session.id, 'idle');
                cinSessionManager.updateSessionTool(session.id, undefined);
                changed = true;
            }
        }
    }
    if (changed) {
        broadcastSessions();
    }
}
/** How long without file activity before marking Codex sessions offline */
const CODEX_INACTIVE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes (Codex may be idle but still open)
/** How long without activity before marking EXTERNAL idle/waiting sessions as offline
 * External sessions can't be restarted, so if they've been quiet this long, they're likely dead */
const EXTERNAL_IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Check Codex session health based on session file modification time.
 * This is more accurate than lastActivity since the file is updated even
 * when the session is idle but still running.
 */
function checkCodexSessionHealth() {
    if (!codexWatcherInstance)
        return;
    let changed = false;
    const sessions = cinSessionManager.listSessions();
    for (const session of sessions) {
        // Only check EXTERNAL Codex sessions - never auto-offline internal sessions
        // Internal sessions could have unsaved work or background processes
        if (session.agent === 'codex' &&
            session.type === 'external' &&
            session.status !== 'offline' &&
            session.codexThreadId) {
            // Check if the session file was modified recently
            const isActive = codexWatcherInstance.isSessionActive(session.codexThreadId, CODEX_INACTIVE_THRESHOLD_MS);
            if (!isActive) {
                log(`Codex session "${session.name}" marked offline (file inactive for 5+ min)`);
                cinSessionManager.updateSessionStatus(session.id, 'offline');
                cinSessionManager.updateSessionTool(session.id, undefined);
                changed = true;
            }
        }
    }
    if (changed) {
        broadcastSessions();
    }
}
/**
 * Check if a tmux pane exists using the bridge's TmuxExecutor.
 * Returns true if the pane is alive, false if not found.
 */
const execFileAsync = promisify(execFile);
async function checkTmuxPaneExists(paneId, socket) {
    try {
        // Use tmux list-panes to check if the specific pane exists
        // The pane ID is like %123 - we need to find it in any session
        const args = socket
            ? ['-S', socket, 'list-panes', '-a', '-F', '#{pane_id}']
            : ['list-panes', '-a', '-F', '#{pane_id}'];
        const result = await execFileAsync('tmux', args);
        const panes = result.stdout?.split('\n').filter(Boolean) || [];
        return panes.includes(paneId);
    }
    catch {
        // If tmux fails, assume the pane doesn't exist
        return false;
    }
}
/**
 * Check external sessions for staleness.
 * External sessions that have been inactive for too long are marked offline
 * since we can't interact with them and they're likely dead.
 *
 * Unlike internal sessions, external sessions can't be restarted, so we
 * aggressively clean them up to avoid cluttering the UI.
 *
 * For sessions with terminal info (tmux pane), we probe the terminal to verify
 * it's actually alive before relying on the activity timeout.
 */
async function checkExternalSessionHealth() {
    const now = Date.now();
    let changed = false;
    const sessions = cinSessionManager.listSessions();
    for (const session of sessions) {
        // Only check external sessions that aren't already offline
        if (session.type !== 'external')
            continue;
        if (session.status === 'offline')
            continue;
        // Codex sessions have their own health check based on file modification
        if (session.agent === 'codex' && session.codexThreadId)
            continue;
        // PROBE: If we have tmux pane info, check if the pane still exists
        // This is more accurate than time-based cleanup
        if (session.terminal?.tmuxPane) {
            const paneExists = await checkTmuxPaneExists(session.terminal.tmuxPane, session.terminal.tmuxSocket);
            if (!paneExists) {
                log(`External session "${session.name}" marked offline (tmux pane ${session.terminal.tmuxPane} no longer exists)`);
                cinSessionManager.updateSessionStatus(session.id, 'offline');
                cinSessionManager.updateSessionTool(session.id, undefined);
                changed = true;
                continue;
            }
        }
        // Fall back to time-based check for sessions without terminal info
        // or if the terminal exists but has been inactive
        const timeSinceActivity = now - session.lastActivity;
        // For "working" sessions, use a shorter timeout since they may be
        // phantom sessions created from historical events in events.jsonl
        // Use same timeout as the working timeout (2 min)
        const threshold = session.status === 'working'
            ? WORKING_TIMEOUT_MS
            : EXTERNAL_IDLE_THRESHOLD_MS;
        if (timeSinceActivity > threshold) {
            const mins = Math.round(timeSinceActivity / 60000);
            const secs = Math.round(timeSinceActivity / 1000);
            const timeStr = mins > 0 ? `${mins} min` : `${secs}s`;
            log(`External session "${session.name}" (${session.status}) marked offline (inactive for ${timeStr})`);
            cinSessionManager.updateSessionStatus(session.id, 'offline');
            cinSessionManager.updateSessionTool(session.id, undefined);
            changed = true;
        }
    }
    if (changed) {
        broadcastSessions();
    }
}
/**
 * Auto-cleanup offline sessions:
 * 1. External sessions offline > 15 minutes - cleaned up (can't interact with them anyway)
 * 2. Internal sessions whose tmux process is gone - cleaned up after 1 hour
 * 3. ALL sessions (including external) offline for > 7 days - cleaned up automatically
 */
// Threshold for deleting phantom external sessions (no terminal info)
const PHANTOM_SESSION_CLEANUP_MS = 2 * 60 * 1000; // 2 minutes
async function cleanupStaleOfflineSessions() {
    const now = Date.now();
    const toDelete = [];
    // Get list of active tmux sessions using bridge
    let activeTmuxSessions;
    try {
        const sessions = await bridgeTmux.listSessions();
        activeTmuxSessions = new Set(sessions.map(s => s.name));
    }
    catch {
        activeTmuxSessions = new Set();
    }
    const allSessions = cinSessionManager.listSessions();
    for (const session of allSessions) {
        const timeSinceActivity = now - session.lastActivity;
        // Rule 0: Phantom external sessions (no terminal info) - delete aggressively
        // These are sessions created from events but have no real terminal to interact with
        // They're useless and clutter the UI
        if (session.type === 'external' && !session.terminal) {
            if (timeSinceActivity >= PHANTOM_SESSION_CLEANUP_MS) {
                log(`Auto-cleaning phantom external session: ${session.name} (no terminal, inactive for ${Math.round(timeSinceActivity / 1000)}s)`);
                toDelete.push(session.id);
            }
            continue;
        }
        // Skip non-offline sessions for remaining rules
        if (session.status !== 'offline') {
            continue;
        }
        const offlineTime = timeSinceActivity;
        // Rule 1: Any session offline for > 7 days gets cleaned up (internal or external)
        if (offlineTime >= OFFLINE_STALE_CLEANUP_MS) {
            const days = Math.round(offlineTime / (24 * 60 * 60 * 1000));
            log(`Auto-cleaning stale session: ${session.name} (offline for ${days} days)`);
            toDelete.push(session.id);
            continue;
        }
        // Rule 2: External sessions - cleaned up after 5 minutes offline
        // External sessions are receive-only; we can't restart or interact with them
        if (session.type === 'external') {
            if (offlineTime >= EXTERNAL_OFFLINE_CLEANUP_MS) {
                log(`Auto-cleaning external session: ${session.name} (offline for ${Math.round(offlineTime / 60000)} min)`);
                toDelete.push(session.id);
            }
            continue;
        }
        // Rule 3: Internal sessions with dead tmux - cleaned up after 1 hour
        if (session.type === 'internal' && session.tmuxSession) {
            // If tmux session still exists, don't cleanup (something wrong with our state)
            if (activeTmuxSessions.has(session.tmuxSession)) {
                continue;
            }
            // Tmux session is gone (e.g., after reboot) - safe to cleanup after 1 hour
            if (offlineTime >= OFFLINE_CLEANUP_MS) {
                log(`Auto-cleaning stale internal session: ${session.name} (tmux gone, offline for ${Math.round(offlineTime / 60000)} min)`);
                toDelete.push(session.id);
            }
        }
    }
    // Delete sessions
    for (const id of toDelete) {
        await deleteSession(id);
    }
    if (toDelete.length > 0) {
        log(`Cleaned up ${toDelete.length} stale session(s)`);
    }
}
// Note: Session persistence is now handled by bridgeSessionManager + cinSessionManager.
// bridgeSessionManager persists core session state to ~/.cin-interface/data/sessions.json
// cinSessionManager persists CIN-specific metadata to ~/.cin-interface/data/cin-metadata.json
function broadcastSessions() {
    const sessions = getSessions();
    // Use 'data' per WEBSOCKET_INTERFACE.md spec, keep 'payload' for backward compatibility
    broadcast({
        type: 'sessions',
        data: sessions,
        payload: sessions,
    });
}
// =============================================================================
// Text Tiles
// =============================================================================
function getTiles() {
    return Array.from(textTiles.values());
}
function saveTiles() {
    try {
        const data = Array.from(textTiles.values());
        writeFileSync(TILES_FILE, JSON.stringify(data, null, 2));
        debug(`Saved ${textTiles.size} tiles to ${TILES_FILE}`);
    }
    catch (e) {
        console.error('Failed to save tiles:', e);
    }
}
function loadTiles() {
    if (!existsSync(TILES_FILE)) {
        debug('No saved tiles file found');
        return;
    }
    try {
        const content = readFileSync(TILES_FILE, 'utf-8');
        const data = JSON.parse(content);
        for (const tile of data) {
            textTiles.set(tile.id, tile);
        }
        log(`Loaded ${textTiles.size} tiles from ${TILES_FILE}`);
    }
    catch (e) {
        console.error('Failed to load tiles:', e);
    }
}
function broadcastTiles() {
    broadcast({
        type: 'text_tiles',
        payload: getTiles(),
    });
}
// =============================================================================
// Voice Transcription
// =============================================================================
function startVoiceSession(ws) {
    if (!deepgramApiKey) {
        ws.send(JSON.stringify({ type: 'voice_error', payload: { error: 'Voice input not configured' } }));
        return false;
    }
    stopVoiceSession(ws);
    try {
        const deepgram = createClient(deepgramApiKey);
        const connection = deepgram.listen.live({
            model: DEEPGRAM_MODEL,
            language: DEEPGRAM_LANGUAGE,
            smart_format: true,
            interim_results: true,
            utterance_end_ms: 1000,
            vad_events: true,
            encoding: 'linear16',
            sample_rate: 16000,
        });
        connection.on(LiveTranscriptionEvents.Open, () => {
            ws.send(JSON.stringify({ type: 'voice_ready', payload: {} }));
        });
        connection.on(LiveTranscriptionEvents.Transcript, (data) => {
            const transcript = data.channel?.alternatives?.[0]?.transcript;
            if (transcript) {
                ws.send(JSON.stringify({
                    type: 'voice_transcript',
                    payload: { transcript, isFinal: data.is_final },
                }));
            }
        });
        connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            ws.send(JSON.stringify({ type: 'voice_utterance_end', payload: {} }));
        });
        connection.on(LiveTranscriptionEvents.Error, (error) => {
            log(`Deepgram error: ${error}`);
            ws.send(JSON.stringify({ type: 'voice_error', payload: { error: String(error) } }));
        });
        connection.on(LiveTranscriptionEvents.Close, () => {
            voiceSessions.delete(ws);
        });
        voiceSessions.set(ws, connection);
        debug('Voice session started');
        return true;
    }
    catch (e) {
        log(`Failed to start voice session: ${e}`);
        ws.send(JSON.stringify({ type: 'voice_error', payload: { error: String(e) } }));
        return false;
    }
}
function stopVoiceSession(ws) {
    const connection = voiceSessions.get(ws);
    if (connection) {
        try {
            connection.requestClose();
        }
        catch {
            // Ignore close errors
        }
        voiceSessions.delete(ws);
        debug('Voice session stopped');
    }
}
function sendVoiceAudio(ws, audioData) {
    const connection = voiceSessions.get(ws);
    if (!connection)
        return;
    try {
        const arrayBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
        connection.send(arrayBuffer);
    }
    catch (e) {
        debug(`Error sending audio: ${e}`);
    }
}
// =============================================================================
// Session Linking
// =============================================================================
// Session linking is now handled by cinSessionManager.findOrCreateSession()
// which delegates to bridgeSessionManager.findOrCreateSession()
/** Reference to Codex watcher for session health checks */
let codexWatcherInstance = null;
/**
 * Find or create a session for an event.
 * Delegates to cinSessionManager which handles session linking.
 */
function findOrCreateSessionForEvent(agentSessionId, agent, eventCwd, terminalInfo) {
    const session = cinSessionManager.findOrCreateSession(agentSessionId, agent, eventCwd, terminalInfo);
    // Log for debugging
    if (session.type === 'external') {
        const tmuxInfo = terminalInfo?.tmuxPane ? ` (tmux: ${terminalInfo.tmuxPane})` : '';
        debug(`Session for ${agent} ${agentSessionId.slice(0, 8)}: ${session.name}${tmuxInfo}`);
    }
    return session;
}
// Legacy compatibility - Codex watcher still calls this
function findOrCreateCodexSession(codexThreadId, eventCwd, _name) {
    return findOrCreateSessionForEvent(codexThreadId, 'codex', eventCwd);
}
/**
 * Initialize the Codex session watcher
 */
function initCodexWatcher() {
    const codexWatcher = getCodexWatcher({ debug: DEBUG });
    codexWatcherInstance = codexWatcher;
    codexWatcher.on('event', (event) => {
        // Store the original Codex thread ID for recovery/matching
        const codexThreadId = event.sessionId;
        event.codexThreadId = codexThreadId;
        // Just write to file - the file watcher will handle processing uniformly
        // This keeps the same code path for both Claude and Codex events
        try {
            appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n');
        }
        catch (err) {
            debug(`Failed to persist Codex event: ${err}`);
        }
    });
    codexWatcher.on('session:new', (info) => {
        log(`New Codex session detected: ${info.name} (${info.threadId.slice(0, 8)})`);
        findOrCreateCodexSession(info.threadId, info.cwd, info.name);
    });
    codexWatcher.start();
    // Reconcile existing Codex sessions with actual file data
    reconcileCodexSessions(codexWatcher);
}
/**
 * Update existing Codex sessions with correct cwd/name from their actual session files
 */
function reconcileCodexSessions(watcher) {
    const allSessionInfo = watcher.getAllSessions();
    let updated = false;
    const sessions = cinSessionManager.listSessions();
    for (const info of allSessionInfo) {
        // Find the managed session for this thread
        for (const session of sessions) {
            if (session.codexThreadId === info.threadId) {
                // Update if cwd differs and name is still default
                if (info.cwd && info.cwd !== session.cwd) {
                    const newDirName = info.cwd.split('/').pop() || 'Codex';
                    if (session.name === 'Codex Session' || session.name === 'Codex') {
                        log(`Reconciling Codex session: ${session.name} -> ${newDirName}`);
                        cinSessionManager.updateSession(session.id, { name: newDirName });
                        updated = true;
                    }
                }
                break;
            }
        }
    }
    if (updated) {
        broadcastSessions();
    }
}
// =============================================================================
// Event Processing
// =============================================================================
function processEvent(event) {
    if (event.type === 'pre_tool_use') {
        const preEvent = event;
        pendingToolUses.set(preEvent.toolUseId, preEvent);
        debug(`Tracking tool use: ${preEvent.tool} (${preEvent.toolUseId})`);
    }
    if (event.type === 'post_tool_use') {
        const postEvent = event;
        const preEvent = pendingToolUses.get(postEvent.toolUseId);
        if (preEvent) {
            postEvent.duration = postEvent.timestamp - preEvent.timestamp;
            pendingToolUses.delete(postEvent.toolUseId);
            debug(`Tool ${postEvent.tool} took ${postEvent.duration}ms`);
        }
    }
    return event;
}
function addEvent(event) {
    if (seenEventIds.has(event.id)) {
        debug(`Skipping duplicate event: ${event.id}`);
        return;
    }
    seenEventIds.add(event.id);
    if (seenEventIds.size > MAX_EVENTS * 2) {
        const idsToKeep = [...seenEventIds].slice(-MAX_EVENTS);
        seenEventIds.clear();
        idsToKeep.forEach((id) => seenEventIds.add(id));
    }
    const processed = processEvent(event);
    events.push(processed);
    if (events.length > MAX_EVENTS) {
        events.splice(0, events.length - MAX_EVENTS);
    }
    // Extract terminal info from session_start events (for external session control)
    let terminalInfo;
    if (event.type === 'session_start') {
        const startEvent = event;
        if (startEvent.terminal) {
            // Only capture if there's useful info (tmux pane or tty)
            const { tmuxPane, tmuxSocket, tty } = startEvent.terminal;
            if (tmuxPane || tty) {
                terminalInfo = { tmuxPane, tmuxSocket, tty };
            }
        }
    }
    // Find or auto-create session for this event
    // Codex events have codexThreadId, Claude events use sessionId
    const codexThreadId = event.codexThreadId;
    const agentSessionId = codexThreadId || event.sessionId;
    const agent = codexThreadId ? 'codex' : 'claude';
    const managedSession = findOrCreateSessionForEvent(agentSessionId, agent, event.cwd, terminalInfo);
    // Normalize: always use managed session ID for event sessionId
    // This allows the frontend to use a single ID for zones and filtering
    event.sessionId = managedSession.id;
    // Update session status based on event type
    const prevStatus = managedSession.status;
    switch (event.type) {
        case 'pre_tool_use':
            cinSessionManager.updateSessionStatus(managedSession.id, 'working');
            cinSessionManager.updateSessionTool(managedSession.id, event.tool);
            break;
        case 'post_tool_use':
            cinSessionManager.updateSessionTool(managedSession.id, undefined);
            break;
        case 'user_prompt_submit':
            cinSessionManager.updateSessionStatus(managedSession.id, 'working');
            cinSessionManager.updateSessionTool(managedSession.id, undefined);
            break;
        case 'stop':
            // Claude finished responding - waiting for next user input (NEEDS ATTENTION!)
            cinSessionManager.updateSessionStatus(managedSession.id, 'waiting');
            cinSessionManager.updateSessionTool(managedSession.id, undefined);
            break;
        case 'session_end':
            cinSessionManager.updateSessionStatus(managedSession.id, 'idle');
            cinSessionManager.updateSessionTool(managedSession.id, undefined);
            break;
    }
    // Get updated session to check if status changed
    const updatedSession = cinSessionManager.getSession(managedSession.id);
    if (updatedSession && updatedSession.status !== prevStatus) {
        broadcastSessions();
    }
    // Use 'data' per WEBSOCKET_INTERFACE.md spec, keep 'payload' for backward compatibility
    broadcast({ type: 'event', data: processed, payload: processed });
}
// =============================================================================
// File Watching
// =============================================================================
// Maximum age for events to process from file on startup
// Events older than this won't create sessions (prevents phantom sessions from old test data)
const MAX_EVENT_AGE_MS = 30 * 60 * 1000; // 30 minutes
function loadEventsFromFile() {
    if (!existsSync(EVENTS_FILE)) {
        debug(`Events file not found: ${EVENTS_FILE}`);
        return;
    }
    const content = readFileSync(EVENTS_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const now = Date.now();
    let skippedOld = 0;
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            // Skip events older than MAX_EVENT_AGE_MS to prevent phantom sessions
            // from old test data when the server restarts
            if (event.timestamp && (now - event.timestamp) > MAX_EVENT_AGE_MS) {
                skippedOld++;
                events.push(event); // Still add to history for display
                continue; // But don't create/update sessions
            }
            processEvent(event);
            // Normalize: always use managed session ID for event sessionId
            // This allows the frontend to use a single ID for zones and filtering
            const codexThreadId = event.codexThreadId;
            const agentSessionId = codexThreadId || event.sessionId;
            const agent = codexThreadId ? 'codex' : 'claude';
            const managedSession = findOrCreateSessionForEvent(agentSessionId, agent, event.cwd);
            event.sessionId = managedSession.id;
            events.push(event);
        }
        catch {
            debug(`Failed to parse event line: ${line}`);
        }
    }
    lastFileSize = content.length;
    if (skippedOld > 0) {
        log(`Loaded ${events.length} events from file (skipped ${skippedOld} old events for session creation)`);
    }
    else {
        log(`Loaded ${events.length} events from file`);
    }
}
// NOTE: watchEventsFile() has been removed and replaced by bridge's FileWatcher
// See initBridgeEventFlow() for the new implementation
// =============================================================================
// WebSocket
// =============================================================================
function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}
function handleClientMessage(ws, message) {
    switch (message.type) {
        case 'subscribe':
            debug('Client subscribed');
            break;
        case 'get_history': {
            const limit = message.payload?.limit ?? 100;
            const history = events.slice(-limit);
            // Use 'data' per spec, keep 'payload' for backward compatibility
            ws.send(JSON.stringify({ type: 'history', data: history, payload: history }));
            debug(`Sent ${history.length} historical events`);
            break;
        }
        case 'ping':
            break;
        case 'voice_start':
            startVoiceSession(ws);
            break;
        case 'voice_stop':
            stopVoiceSession(ws);
            break;
        case 'permission_response': {
            const { sessionId, response } = message.payload;
            sendPermissionResponse(sessionId, response);
            break;
        }
        default:
            debug(`Unknown message type: ${message.type}`);
    }
}
// =============================================================================
// HTTP Server
// =============================================================================
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};
function serveStaticFile(req, res) {
    // In dev mode (tsx watch), we're in src/server, so go up 2 levels then into dist
    // In production (dist/server), go up 1 level to dist
    const serverDir = dirname(new URL(import.meta.url).pathname);
    const isDevMode = serverDir.includes('/src/');
    const distDir = isDevMode
        ? resolve(serverDir, '../../dist')
        : resolve(serverDir, '..');
    let urlPath = req.url?.split('?')[0] ?? '/';
    if (urlPath === '/')
        urlPath = '/index.html';
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(urlPath);
    }
    catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
    }
    const filePath = resolve(distDir, '.' + decodedPath);
    if (!filePath.startsWith(distDir + '/') && filePath !== distDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    if (!existsSync(filePath)) {
        const indexPath = join(distDir, 'index.html');
        if (existsSync(indexPath) && !decodedPath.startsWith('/api')) {
            const content = readFileSync(indexPath);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
            return;
        }
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
}
async function handleHttpRequest(req, res) {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
        if (!origin || !isOriginAllowed(origin)) {
            res.writeHead(403);
            res.end();
            return;
        }
        res.writeHead(204);
        res.end();
        return;
    }
    // POST /event
    if (req.method === 'POST' && req.url === '/event') {
        try {
            const body = await collectRequestBody(req);
            const parsed = JSON.parse(body);
            // Check if this is an already-normalized event (has 'type' field with valid value)
            // or a raw hook event (has 'hook_event_name' field)
            const validTypes = [
                'pre_tool_use',
                'post_tool_use',
                'stop',
                'subagent_stop',
                'session_start',
                'session_end',
                'user_prompt_submit',
                'notification',
            ];
            if (parsed.type && validTypes.includes(parsed.type)) {
                // Already normalized event - use directly
                const event = {
                    id: parsed.id || `http-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    type: parsed.type,
                    timestamp: parsed.timestamp || Date.now(),
                    sessionId: parsed.sessionId || '',
                    cwd: parsed.cwd || process.cwd(),
                    ...parsed,
                };
                addEvent(event);
                debug(`Received normalized event via HTTP: ${event.type}`);
            }
            else {
                // Raw hook event - use EventProcessor
                const processed = bridgeEventProcessor.processLine(body);
                if (processed) {
                    // Set sessionId from extracted agentSessionId
                    const event = processed.event;
                    event.sessionId = processed.agentSessionId;
                    event.cwd = processed.cwd || event.cwd || process.cwd();
                    addEvent(event);
                    debug(`Received raw event via HTTP: ${event.type}`);
                }
                else {
                    debug(`EventProcessor returned null for HTTP event: ${body.substring(0, 100)}`);
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            debug(`Failed to parse HTTP event: ${e}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return;
    }
    // POST /event/codex - Instant notification from Codex notify hook
    if (req.method === 'POST' && req.url === '/event/codex') {
        try {
            const body = await collectRequestBody(req);
            const event = JSON.parse(body);
            debug(`Received Codex notify event: ${event.type} for thread ${event.codexThreadId || 'unknown'}`);
            // The event is already formatted by codex-hook.sh, add it
            addEvent(event);
            // Trigger immediate check of Codex session files for this thread
            // to pick up any detailed events we may have missed
            const watcher = getCodexWatcher();
            if (event.codexThreadId && watcher) {
                watcher.triggerCheckForThread(event.codexThreadId);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        catch (e) {
            debug(`Failed to parse Codex event: ${e}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
        return;
    }
    // GET /health
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            version: VERSION,
            clients: clients.size,
            events: events.length,
            voiceEnabled: !!deepgramApiKey,
        }));
        return;
    }
    // GET /config
    if (req.method === 'GET' && req.url === '/config') {
        const username = process.env.USER || process.env.USERNAME || 'claude-user';
        const host = hostname();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            username,
            hostname: host,
            tmuxSession: TMUX_SESSION,
        }));
        return;
    }
    // GET /browse - Browse filesystem directories (for file explorer)
    const browseMatch = req.url?.match(/^\/browse(\?.*)?$/);
    if (req.method === 'GET' && browseMatch) {
        const urlParams = new URLSearchParams(browseMatch[1] || '');
        let browsePath = urlParams.get('path') || process.env.HOME || '/';
        // Expand ~ to home directory
        if (browsePath.startsWith('~')) {
            browsePath = browsePath.replace('~', process.env.HOME || '');
        }
        // Resolve to absolute path
        browsePath = resolve(browsePath);
        try {
            const stats = statSync(browsePath);
            if (!stats.isDirectory()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Path is not a directory' }));
                return;
            }
            const entries = readdirSync(browsePath, { withFileTypes: true });
            const items = entries
                .filter(entry => {
                // Always show directories, filter hidden by default
                if (entry.name.startsWith('.'))
                    return false;
                return true;
            })
                .map(entry => ({
                name: entry.name,
                path: join(browsePath, entry.name),
                isDirectory: entry.isDirectory(),
            }))
                .sort((a, b) => {
                // Directories first, then alphabetical
                if (a.isDirectory && !b.isDirectory)
                    return -1;
                if (!a.isDirectory && b.isDirectory)
                    return 1;
                return a.name.localeCompare(b.name);
            });
            // Calculate parent path
            const parentPath = dirname(browsePath);
            const isRoot = browsePath === '/' || browsePath === parentPath;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                path: browsePath,
                parent: isRoot ? null : parentPath,
                items,
            }));
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
    }
    // GET /stats
    if (req.method === 'GET' && req.url === '/stats') {
        const toolCounts = {};
        const toolDurations = {};
        for (const event of events) {
            if (event.type === 'post_tool_use') {
                const e = event;
                toolCounts[e.tool] = (toolCounts[e.tool] ?? 0) + 1;
                if (e.duration !== undefined) {
                    toolDurations[e.tool] = toolDurations[e.tool] ?? [];
                    toolDurations[e.tool].push(e.duration);
                }
            }
        }
        const avgDurations = {};
        for (const [tool, durations] of Object.entries(toolDurations)) {
            avgDurations[tool] = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
        }
        const tokens = {};
        for (const [session, data] of sessionTokens) {
            tokens[session] = { current: data.lastSeen, cumulative: data.cumulative };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ totalEvents: events.length, toolCounts, avgDurations, tokens }));
        return;
    }
    // GET /sessions
    if (req.method === 'GET' && req.url === '/sessions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessions: getSessions() }));
        return;
    }
    // POST /sessions
    if (req.method === 'POST' && req.url === '/sessions') {
        try {
            const body = await collectRequestBody(req);
            const options = body ? JSON.parse(body) : {};
            log(`Creating session with options: ${JSON.stringify(options)}`);
            const session = await createSession(options);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, session }));
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
        return;
    }
    // DELETE /sessions/cleanup - Remove stale sessions
    // Query params:
    //   maxAge=<ms> - Only delete sessions inactive for at least this long
    //   type=external - Only delete external sessions
    //   phantom=true - Delete external sessions without terminal info (regardless of status)
    const cleanupMatch = req.url?.match(/^\/sessions\/cleanup(\?.*)?$/);
    if (req.method === 'DELETE' && cleanupMatch) {
        const urlParams = new URLSearchParams(cleanupMatch[1] || '');
        const maxAgeMs = parseInt(urlParams.get('maxAge') || '0', 10);
        const typeFilter = urlParams.get('type');
        const phantomOnly = urlParams.get('phantom') === 'true';
        const now = Date.now();
        const toDelete = [];
        const sessions = cinSessionManager.listSessions();
        for (const session of sessions) {
            // Type filter
            if (typeFilter && session.type !== typeFilter)
                continue;
            // Phantom filter: external sessions without terminal info
            // These are sessions created from events but have no real terminal to interact with
            if (phantomOnly) {
                if (session.type === 'external' && !session.terminal) {
                    // Check age if specified
                    if (maxAgeMs > 0) {
                        const age = now - session.lastActivity;
                        if (age >= maxAgeMs) {
                            toDelete.push(session.id);
                        }
                    }
                    else {
                        toDelete.push(session.id);
                    }
                }
                continue;
            }
            // Standard offline cleanup
            if (session.status === 'offline') {
                if (maxAgeMs > 0) {
                    // Only delete if offline longer than maxAge
                    const offlineTime = now - session.lastActivity;
                    if (offlineTime >= maxAgeMs) {
                        toDelete.push(session.id);
                    }
                }
                else {
                    // Delete all offline sessions
                    toDelete.push(session.id);
                }
            }
        }
        // Delete sessions
        for (const id of toDelete) {
            await deleteSession(id);
        }
        log(`Cleaned up ${toDelete.length} sessions (phantom=${phantomOnly}, type=${typeFilter || 'all'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted: toDelete.length }));
        return;
    }
    // Session-specific endpoints: /sessions/:id
    const sessionMatch = req.url?.match(/^\/sessions\/([a-f0-9-]+)(?:\/(.+))?$/);
    if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const action = sessionMatch[2];
        // GET /sessions/:id
        if (req.method === 'GET' && !action) {
            const session = getSession(sessionId);
            if (session) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, session }));
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
            }
            return;
        }
        // DELETE /sessions/:id
        if (req.method === 'DELETE' && !action) {
            const deleted = await deleteSession(sessionId);
            if (deleted) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
            }
            return;
        }
        // POST /sessions/:id/prompt
        // Accepts: { prompt: string, images?: Array<{ data: string, mediaType: string, name?: string }> }
        if (req.method === 'POST' && action === 'prompt') {
            try {
                const body = await collectRequestBody(req);
                const { prompt, images } = JSON.parse(body);
                if (!prompt) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Prompt is required' }));
                    return;
                }
                // Validate images if provided
                if (images) {
                    const validMediaTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
                    for (const img of images) {
                        if (!img.data || !img.mediaType) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: false, error: 'Each image must have data and mediaType' }));
                            return;
                        }
                        if (!validMediaTypes.includes(img.mediaType)) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: false, error: `Invalid mediaType: ${img.mediaType}. Supported: ${validMediaTypes.join(', ')}` }));
                            return;
                        }
                        // Check image size (max 5MB)
                        const sizeBytes = Buffer.from(img.data, 'base64').length;
                        if (sizeBytes > 5 * 1024 * 1024) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: false, error: `Image too large (${(sizeBytes / 1024 / 1024).toFixed(2)}MB). Maximum is 5MB.` }));
                            return;
                        }
                    }
                }
                const result = await sendPromptToSession(sessionId, prompt, images);
                res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
            }
            return;
        }
        // POST /sessions/:id/cancel
        if (req.method === 'POST' && action === 'cancel') {
            const session = getSession(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
                return;
            }
            // External sessions can't be cancelled via tmux
            if (!session.tmuxSession) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Cannot cancel external sessions' }));
                return;
            }
            // Use bridge's TmuxExecutor to send Ctrl+C
            bridgeTmux.sendCtrlC(session.tmuxSession)
                .then(() => {
                log(`Sent Ctrl+C to ${session.name}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            })
                .catch((error) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: error.message }));
            });
            return;
        }
        // POST /sessions/:id/restart - Restart an offline session
        if (req.method === 'POST' && action === 'restart') {
            const session = getSession(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
                return;
            }
            // External sessions can't be restarted via tmux
            if (!session.tmuxSession) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Cannot restart external sessions' }));
                return;
            }
            // Validate inputs to prevent command injection
            try {
                validateTmuxSession(session.tmuxSession);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session name' }));
                return;
            }
            let cwd;
            try {
                cwd = validateDirectoryPath(session.cwd || process.cwd());
            }
            catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    ok: false,
                    error: `Invalid directory: ${err instanceof Error ? err.message : err}`,
                }));
                return;
            }
            // Use cinSessionManager.restart() which delegates to bridgeSessionManager
            (async () => {
                try {
                    const restarted = await cinSessionManager.restart(sessionId);
                    if (!restarted) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Failed to restart session' }));
                        return;
                    }
                    log(`Restarted ${restarted.agent} session: ${restarted.name} (${restarted.id.slice(0, 8)})`);
                    broadcastSessions();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, session: restarted }));
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: `Failed to restart: ${message}` }));
                }
            })();
            return;
        }
        // POST /sessions/:id/terminal - Open Terminal.app attached to tmux session
        if (req.method === 'POST' && action === 'terminal') {
            const session = getSession(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
                return;
            }
            if (!session.tmuxSession) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Cannot open terminal for external sessions' }));
                return;
            }
            openTerminalForTmux(session.tmuxSession);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        // POST /sessions/:id/focus - Focus the terminal window for an external session
        if (req.method === 'POST' && action === 'focus') {
            const session = getSession(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
                return;
            }
            // Only external sessions need this - internal sessions can use /terminal endpoint
            if (session.type !== 'external') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Use /terminal endpoint for internal sessions' }));
                return;
            }
            const terminalInfo = session.terminal;
            if (!terminalInfo) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'No terminal info available for this session' }));
                return;
            }
            // Try to focus the terminal window
            focusExternalTerminal(terminalInfo);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        // PATCH /sessions/:id - Update session name, zone position, or autoAccept
        if (req.method === 'PATCH' && !action) {
            const session = getSession(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
                return;
            }
            try {
                const body = await collectRequestBody(req);
                const updates = JSON.parse(body);
                const updated = updateSession(sessionId, updates);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, session: updated }));
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
            }
            return;
        }
    }
    // GET /projects - List known project directories
    if (req.method === 'GET' && req.url === '/projects') {
        const projects = projectsManager.getProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projects }));
        return;
    }
    // GET /projects/autocomplete?q=<partial> - Autocomplete directory paths
    if (req.method === 'GET' && req.url?.startsWith('/projects/autocomplete')) {
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        const partial = urlObj.searchParams.get('q') || '';
        const limit = parseInt(urlObj.searchParams.get('limit') || '15', 10);
        const suggestions = projectsManager.autocomplete(partial, limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, suggestions }));
        return;
    }
    // GET /projects/default - Get a sensible default project directory
    if (req.method === 'GET' && req.url === '/projects/default') {
        const projects = projectsManager.getProjects();
        let defaultPath;
        if (projects.length > 0) {
            // Use most recently used project
            defaultPath = projects[0].path;
        }
        else {
            // Fall back to ~/Documents or home directory
            const home = process.env.HOME || '';
            const documentsDir = `${home}/Documents`;
            defaultPath = existsSync(documentsDir) ? documentsDir : home;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: defaultPath }));
        return;
    }
    // ==========================================================================
    // File Explorer Endpoints
    // ==========================================================================
    // GET /sessions/:id/files - List files in session's directory
    const filesMatch = req.url?.match(/^\/sessions\/([a-f0-9-]+)\/files(\?.*)?$/);
    if (req.method === 'GET' && filesMatch) {
        const sessionId = filesMatch[1];
        const session = cinSessionManager.getSession(sessionId);
        if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
            return;
        }
        // Get path from query params, default to session's cwd
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        let requestedPath = urlObj.searchParams.get('path') || session.cwd;
        // Expand ~ to home directory
        if (requestedPath.startsWith('~')) {
            requestedPath = requestedPath.replace('~', process.env.HOME || '');
        }
        // Security: Ensure requested path is within session's cwd
        const resolvedPath = resolve(requestedPath);
        const resolvedCwd = resolve(session.cwd);
        if (!resolvedPath.startsWith(resolvedCwd) && resolvedPath !== resolvedCwd) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Access denied: path outside session directory' }));
            return;
        }
        try {
            if (!existsSync(resolvedPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Path not found' }));
                return;
            }
            const stats = statSync(resolvedPath);
            if (!stats.isDirectory()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Path is not a directory' }));
                return;
            }
            const entries = readdirSync(resolvedPath, { withFileTypes: true });
            const files = entries
                .filter(entry => !entry.name.startsWith('.')) // Skip hidden files by default
                .map(entry => {
                const fullPath = join(resolvedPath, entry.name);
                let size;
                let modified;
                try {
                    const entryStats = statSync(fullPath);
                    size = entryStats.size;
                    modified = entryStats.mtimeMs;
                }
                catch {
                    // Ignore stat errors (permission issues, etc.)
                }
                return {
                    name: entry.name,
                    path: fullPath,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size,
                    modified,
                };
            })
                .sort((a, b) => {
                // Directories first, then alphabetically
                if (a.type === 'directory' && b.type !== 'directory')
                    return -1;
                if (a.type !== 'directory' && b.type === 'directory')
                    return 1;
                return a.name.localeCompare(b.name);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                path: resolvedPath,
                cwd: session.cwd,
                files,
            }));
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Failed to read directory: ${e.message}` }));
        }
        return;
    }
    // GET /sessions/:id/file - Read file content
    const fileMatch = req.url?.match(/^\/sessions\/([a-f0-9-]+)\/file(\?.*)?$/);
    if (req.method === 'GET' && fileMatch) {
        const sessionId = fileMatch[1];
        const session = cinSessionManager.getSession(sessionId);
        if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
            return;
        }
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        const requestedPath = urlObj.searchParams.get('path');
        if (!requestedPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Missing path parameter' }));
            return;
        }
        // Expand ~ to home directory
        let expandedPath = requestedPath;
        if (expandedPath.startsWith('~')) {
            expandedPath = expandedPath.replace('~', process.env.HOME || '');
        }
        // Security: Ensure requested path is within session's cwd
        const resolvedPath = resolve(expandedPath);
        const resolvedCwd = resolve(session.cwd);
        if (!resolvedPath.startsWith(resolvedCwd)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Access denied: path outside session directory' }));
            return;
        }
        try {
            if (!existsSync(resolvedPath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'File not found' }));
                return;
            }
            const stats = statSync(resolvedPath);
            if (stats.isDirectory()) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Path is a directory, not a file' }));
                return;
            }
            // Limit file size to 1MB for safety
            const MAX_FILE_SIZE = 1024 * 1024;
            if (stats.size > MAX_FILE_SIZE) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    ok: false,
                    error: `File too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum is 1MB.`,
                }));
                return;
            }
            // Detect binary files by extension
            const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib'];
            const ext = extname(resolvedPath).toLowerCase();
            if (binaryExtensions.includes(ext)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Binary files cannot be displayed' }));
                return;
            }
            const content = readFileSync(resolvedPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                path: resolvedPath,
                name: basename(resolvedPath),
                size: stats.size,
                modified: stats.mtimeMs,
                content,
            }));
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Failed to read file: ${e.message}` }));
        }
        return;
    }
    // GET /sessions/:id/files/tree - Get directory tree
    const treeMatch = req.url?.match(/^\/sessions\/([a-f0-9-]+)\/files\/tree(\?.*)?$/);
    if (req.method === 'GET' && treeMatch) {
        const sessionId = treeMatch[1];
        const session = cinSessionManager.getSession(sessionId);
        if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
            return;
        }
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        let requestedPath = urlObj.searchParams.get('path') || session.cwd;
        const maxDepth = Math.min(parseInt(urlObj.searchParams.get('depth') || '3', 10), 5);
        const includeHidden = urlObj.searchParams.get('hidden') === 'true';
        // Expand ~ to home directory
        if (requestedPath.startsWith('~')) {
            requestedPath = requestedPath.replace('~', process.env.HOME || '');
        }
        // Security: Ensure requested path is within session's cwd
        const resolvedPath = resolve(requestedPath);
        const resolvedCwd = resolve(session.cwd);
        if (!resolvedPath.startsWith(resolvedCwd) && resolvedPath !== resolvedCwd) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Access denied: path outside session directory' }));
            return;
        }
        function buildTree(dirPath, depth) {
            if (depth <= 0)
                return [];
            try {
                const entries = readdirSync(dirPath, { withFileTypes: true });
                return entries
                    .filter(entry => includeHidden || !entry.name.startsWith('.'))
                    .filter(entry => entry.name !== 'node_modules' && entry.name !== '.git') // Skip large dirs
                    .map(entry => {
                    const fullPath = join(dirPath, entry.name);
                    const node = {
                        name: entry.name,
                        path: fullPath,
                        type: entry.isDirectory() ? 'directory' : 'file',
                    };
                    if (entry.isDirectory()) {
                        node.children = buildTree(fullPath, depth - 1);
                    }
                    return node;
                })
                    .sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory')
                        return -1;
                    if (a.type !== 'directory' && b.type === 'directory')
                        return 1;
                    return a.name.localeCompare(b.name);
                });
            }
            catch {
                return [];
            }
        }
        try {
            const tree = buildTree(resolvedPath, maxDepth);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                path: resolvedPath,
                cwd: session.cwd,
                tree,
            }));
        }
        catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Failed to build tree: ${e.message}` }));
        }
        return;
    }
    // GET /tiles
    if (req.method === 'GET' && req.url === '/tiles') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, tiles: getTiles() }));
        return;
    }
    // POST /tiles
    if (req.method === 'POST' && req.url === '/tiles') {
        try {
            const body = await collectRequestBody(req);
            const data = JSON.parse(body);
            if (!data.text || !data.position) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing text or position' }));
                return;
            }
            const tile = {
                id: randomUUID(),
                text: data.text,
                position: data.position,
                color: data.color,
                createdAt: Date.now(),
            };
            textTiles.set(tile.id, tile);
            saveTiles();
            broadcastTiles();
            log(`Created text tile: "${tile.text}"`);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, tile }));
        }
        catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
        return;
    }
    // DELETE /tiles/:id
    const tileDeleteMatch = req.url?.match(/^\/tiles\/([a-f0-9-]+)$/);
    if (req.method === 'DELETE' && tileDeleteMatch) {
        const tileId = tileDeleteMatch[1];
        const tile = textTiles.get(tileId);
        if (tile) {
            textTiles.delete(tileId);
            saveTiles();
            broadcastTiles();
            log(`Deleted text tile: "${tile.text}"`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Tile not found' }));
        }
        return;
    }
    // =============================================================================
    // Feedback Endpoints
    // =============================================================================
    // POST /feedback - Create new feedback
    if (req.method === 'POST' && req.url === '/feedback') {
        try {
            const body = await collectRequestBody(req);
            const input = JSON.parse(body);
            if (!input.type || !input.description) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing type or description' }));
                return;
            }
            const feedback = await feedbackRepo.create(input);
            log(`Created feedback: ${feedback.id} (${feedback.type})`);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, feedback }));
        }
        catch (e) {
            console.error('Failed to create feedback:', e);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    // GET /feedback - List all feedback (with optional filters)
    if (req.method === 'GET' && req.url?.startsWith('/feedback')) {
        // Parse query params for filtering
        const urlObj = new URL(req.url, `http://localhost:${PORT}`);
        // Check for /feedback/unprocessed
        if (urlObj.pathname === '/feedback/unprocessed') {
            const feedback = await feedbackRepo.getUnprocessed();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, feedback }));
            return;
        }
        // Check for /feedback/:id (get single feedback)
        const feedbackIdMatch = urlObj.pathname.match(/^\/feedback\/([a-f0-9-]+)$/);
        if (feedbackIdMatch) {
            const feedback = await feedbackRepo.get(feedbackIdMatch[1]);
            if (feedback) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, feedback }));
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Feedback not found' }));
            }
            return;
        }
        // GET /feedback - list with optional filters
        if (urlObj.pathname === '/feedback') {
            const filter = {};
            const typeParam = urlObj.searchParams.get('type');
            if (typeParam && ['bug', 'improve', 'works'].includes(typeParam)) {
                filter.type = typeParam;
            }
            const processedParam = urlObj.searchParams.get('processed');
            if (processedParam !== null) {
                filter.processed = processedParam === 'true';
            }
            const limitParam = urlObj.searchParams.get('limit');
            if (limitParam) {
                filter.limit = parseInt(limitParam, 10);
            }
            const offsetParam = urlObj.searchParams.get('offset');
            if (offsetParam) {
                filter.offset = parseInt(offsetParam, 10);
            }
            const feedback = await feedbackRepo.list(filter);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, feedback }));
            return;
        }
    }
    // PATCH /feedback/:id - Update feedback (mark processed, link GitHub issue)
    const feedbackPatchMatch = req.url?.match(/^\/feedback\/([a-f0-9-]+)$/);
    if (req.method === 'PATCH' && feedbackPatchMatch) {
        try {
            const feedbackId = feedbackPatchMatch[1];
            const body = await collectRequestBody(req);
            const changes = JSON.parse(body);
            const feedback = await feedbackRepo.update(feedbackId, changes);
            if (feedback) {
                log(`Updated feedback: ${feedback.id}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, feedback }));
            }
            else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Feedback not found' }));
            }
        }
        catch (e) {
            console.error('Failed to update feedback:', e);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
        }
        return;
    }
    // DELETE /feedback/:id - Delete feedback
    const feedbackDeleteMatch = req.url?.match(/^\/feedback\/([a-f0-9-]+)$/);
    if (req.method === 'DELETE' && feedbackDeleteMatch) {
        const feedbackId = feedbackDeleteMatch[1];
        const deleted = await feedbackRepo.delete(feedbackId);
        if (deleted) {
            log(`Deleted feedback: ${feedbackId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Feedback not found' }));
        }
        return;
    }
    // Fallback: static files
    serveStaticFile(req, res);
}
// =============================================================================
// Main
// =============================================================================
function main() {
    log('Starting CIN-Interface server...');
    deepgramApiKey = loadDeepgramKey();
    // Load tiles (independent of sessions)
    loadTiles();
    // Start bridge components (session manager, file watcher, event processor)
    // bridgeSessionManager.start() loads sessions from disk
    // cinSessionManager.start() loads CIN metadata
    // Events will be loaded after sessions are ready
    startBridge()
        .then(() => {
        // Load events after sessions are ready so we can link them
        loadEventsFromFile();
    })
        .catch((err) => {
        console.error('Failed to start bridge:', err);
    });
    gitStatusManager.setUpdateHandler(({ sessionId, status }) => {
        const session = cinSessionManager.getSession(sessionId);
        if (session) {
            debug(`Git status updated for ${session.name}: ${status.branch}`);
            broadcastSessions();
        }
    });
    gitStatusManager.start();
    // Initialize Codex session watcher (watches ~/.codex/sessions/)
    initCodexWatcher();
    // NOTE: watchEventsFile() has been replaced by bridge's FileWatcher
    // The bridge is started earlier in main() and handles event file watching
    const httpServer = createServer((req, res) => {
        handleHttpRequest(req, res).catch((e) => {
            console.error('Request error:', e);
            res.writeHead(500);
            res.end('Internal server error');
        });
    });
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws, req) => {
        const origin = req.headers.origin;
        if (!isOriginAllowed(origin)) {
            log(`Rejected WebSocket connection from origin: ${origin}`);
            ws.close(1008, 'Origin not allowed');
            return;
        }
        clients.add(ws);
        log(`Client connected (${clients.size} total)${origin ? ` from ${origin}` : ''}`);
        // Send standard 'init' message per WEBSOCKET_INTERFACE.md spec
        const sessions = getSessions();
        ws.send(JSON.stringify({ type: 'init', data: { sessions } }));
        // Also send legacy messages for backward compatibility with existing frontend
        ws.send(JSON.stringify({
            type: 'connected',
            payload: { sessionId: events[events.length - 1]?.sessionId ?? 'unknown' },
        }));
        ws.send(JSON.stringify({ type: 'sessions', data: sessions, payload: sessions }));
        ws.send(JSON.stringify({ type: 'text_tiles', payload: getTiles() }));
        // Filter history to only include events from active sessions
        // Event sessionIds are now normalized to managed session IDs
        const activeSessionIds = new Set(cinSessionManager.listSessions().map((s) => s.id));
        const filteredHistory = events
            .filter((e) => activeSessionIds.has(e.sessionId))
            .slice(-50);
        ws.send(JSON.stringify({ type: 'history', data: filteredHistory, payload: filteredHistory }));
        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
                sendVoiceAudio(ws, audioBuffer);
                return;
            }
            try {
                const message = JSON.parse(data.toString());
                handleClientMessage(ws, message);
            }
            catch (e) {
                debug(`Failed to parse client message: ${e}`);
            }
        });
        ws.on('close', () => {
            stopVoiceSession(ws);
            clients.delete(ws);
            log(`Client disconnected (${clients.size} total)`);
        });
        ws.on('error', (error) => {
            debug(`WebSocket error: ${error}`);
            stopVoiceSession(ws);
            clients.delete(ws);
        });
    });
    httpServer.listen(PORT, () => {
        log(`Server running on port ${PORT}`);
        log(``);
        log(`Open http://localhost:${PORT} to view your interface`);
        log(``);
        log(`Local API endpoints:`);
        log(`  WebSocket: ws://localhost:${PORT}`);
        log(`  Events: http://localhost:${PORT}/event`);
        log(`  Sessions: http://localhost:${PORT}/sessions`);
        startTokenPolling();
        startPermissionPolling();
        startSuggestionPolling();
        startRalphWiggumPolling();
        setInterval(() => { checkSessionHealth().catch(e => DEBUG && console.error('Session health check error:', e)); }, 5000);
        setInterval(checkWorkingTimeout, WORKING_CHECK_INTERVAL_MS);
        setInterval(checkCodexSessionHealth, 30_000); // Check Codex sessions every 30 seconds
        setInterval(() => { checkExternalSessionHealth().catch(e => DEBUG && console.error('External session health error:', e)); }, 60_000); // Check external sessions every minute
        setInterval(() => { cleanupStaleOfflineSessions().catch(e => DEBUG && console.error('Cleanup error:', e)); }, 60_000); // Cleanup every minute
        checkSessionHealth().catch(e => DEBUG && console.error('Initial session health check error:', e));
        checkCodexSessionHealth(); // Mark inactive Codex sessions as offline
        checkExternalSessionHealth().catch(e => DEBUG && console.error('Initial external session health error:', e)); // Mark stale external sessions as offline
        cleanupStaleOfflineSessions().catch(e => DEBUG && console.error('Initial cleanup error:', e)); // Cleanup stale sessions
    });
}
main();
//# sourceMappingURL=index.js.map