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
import { watch } from 'chokidar';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync, statSync, } from 'fs';
import { exec, execFile } from 'child_process';
import { dirname, resolve, join, extname, basename } from 'path';
import { hostname } from 'os';
import { randomUUID, randomBytes } from 'crypto';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { DEFAULTS } from '../shared/defaults.js';
import { GitStatusManager } from './GitStatusManager.js';
import { ProjectsManager } from './ProjectsManager.js';
import { getCodexWatcher } from './CodexSessionWatcher.js';
import { fileURLToPath } from 'url';
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
const PORT = parseInt(process.env.VIBECRAFT_PORT ?? String(DEFAULTS.SERVER_PORT), 10);
const EVENTS_FILE = resolve(expandHome(process.env.VIBECRAFT_EVENTS_FILE ?? DEFAULTS.EVENTS_FILE));
const PENDING_PROMPT_FILE = resolve(expandHome(process.env.VIBECRAFT_PROMPT_FILE ?? '~/.vibecraft/data/pending-prompt.txt'));
const MAX_EVENTS = parseInt(process.env.VIBECRAFT_MAX_EVENTS ?? String(DEFAULTS.MAX_EVENTS), 10);
const DEBUG = process.env.VIBECRAFT_DEBUG === 'true';
const TMUX_SESSION = process.env.VIBECRAFT_TMUX_SESSION ?? DEFAULTS.TMUX_SESSION;
const SESSIONS_FILE = resolve(expandHome(process.env.VIBECRAFT_SESSIONS_FILE ?? DEFAULTS.SESSIONS_FILE));
const TILES_FILE = resolve(expandHome(process.env.VIBECRAFT_TILES_FILE ?? '~/.vibecraft/data/tiles.json'));
/** Time before a "working" session auto-transitions to idle */
const WORKING_TIMEOUT_MS = 120_000; // 2 minutes
/** Time before offline sessions are auto-cleaned (1 hour) */
const OFFLINE_CLEANUP_MS = 60 * 60 * 1000; // 1 hour
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
        if (url.hostname === 'vibecraft.sh' && url.protocol === 'https:') {
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
function execFileAsync(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, EXEC_OPTIONS, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
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
async function sendToTmuxSafe(tmuxSession, text) {
    validateTmuxSession(tmuxSession);
    const tempFile = `/tmp/vibecraft-prompt-${Date.now()}-${randomBytes(16).toString('hex')}.txt`;
    writeFileSync(tempFile, text);
    try {
        await execFileAsync('tmux', ['load-buffer', tempFile]);
        await execFileAsync('tmux', ['paste-buffer', '-t', tmuxSession]);
        await new Promise((r) => setTimeout(r, 100));
        await execFileAsync('tmux', ['send-keys', '-t', tmuxSession, 'Enter']);
    }
    finally {
        try {
            unlinkSync(tempFile);
        }
        catch {
            // Ignore cleanup errors
        }
    }
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
const managedSessions = new Map();
const textTiles = new Map();
const gitStatusManager = new GitStatusManager();
const projectsManager = new ProjectsManager();
const voiceSessions = new Map();
let deepgramApiKey = null;
const claudeToManagedMap = new Map();
let sessionCounter = 0;
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
function pollTokens(tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        debug(`Invalid tmux session for token polling: ${tmuxSession}`);
        return;
    }
    execFile('tmux', ['capture-pane', '-t', tmuxSession, '-p', '-S', '-50'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) {
            debug(`Token poll failed: ${error.message}`);
            return;
        }
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
    });
}
function startTokenPolling() {
    setInterval(() => {
        for (const session of managedSessions.values()) {
            // Only poll internal sessions (they have tmuxSession)
            if (session.status !== 'offline' && session.tmuxSession) {
                pollTokens(session.tmuxSession);
            }
        }
        if (!managedSessions.size) {
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
function pollPermissions(sessionId, tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        debug(`Invalid tmux session for permission polling: ${tmuxSession}`);
        return;
    }
    execFile('tmux', ['capture-pane', '-t', tmuxSession, '-p', '-S', '-50'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) {
            debug(`Permission poll failed for ${tmuxSession}: ${error.message}`);
            return;
        }
        if (detectBypassWarning(stdout) && !bypassWarningHandled.has(sessionId)) {
            log(`Bypass permissions warning detected for session ${sessionId}, auto-accepting...`);
            bypassWarningHandled.add(sessionId);
            execFile('tmux', ['send-keys', '-t', tmuxSession, '2'], EXEC_OPTIONS, (err) => {
                if (err) {
                    log(`Failed to auto-accept bypass warning: ${err.message}`);
                }
                else {
                    log(`Bypass permissions warning accepted for session ${sessionId}`);
                }
            });
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
            const session = managedSessions.get(sessionId);
            if (session) {
                session.status = 'waiting';
                session.currentTool = prompt.tool;
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
            const session = managedSessions.get(sessionId);
            if (session && session.status === 'waiting') {
                session.status = 'working';
                session.currentTool = undefined;
                broadcastSessions();
            }
        }
    });
}
function startPermissionPolling() {
    setInterval(() => {
        for (const session of managedSessions.values()) {
            // Only poll internal sessions (they have tmuxSession)
            if (session.status !== 'offline' && session.tmuxSession) {
                pollPermissions(session.id, session.tmuxSession);
            }
        }
    }, 1000);
    log(`Permission polling started`);
}
function sendPermissionResponse(sessionId, optionNumber) {
    const session = managedSessions.get(sessionId);
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
    execFile('tmux', ['send-keys', '-t', session.tmuxSession, optionNumber], EXEC_OPTIONS, (error) => {
        if (error) {
            log(`Failed to send permission response: ${error.message}`);
            return;
        }
        log(`Sent permission response to ${session.name}: option ${optionNumber}`);
        pendingPermissions.delete(sessionId);
        session.status = 'working';
        session.currentTool = undefined;
        broadcastSessions();
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
function pollSuggestions(sessionId, tmuxSession) {
    try {
        validateTmuxSession(tmuxSession);
    }
    catch {
        return;
    }
    execFile('tmux', ['capture-pane', '-t', tmuxSession, '-p', '-S', '-20'], { ...EXEC_OPTIONS, maxBuffer: 1024 * 512 }, (error, stdout) => {
        if (error) {
            return;
        }
        const session = managedSessions.get(sessionId);
        if (!session)
            return;
        // Only look for suggestions when session is waiting or idle
        // (sessions may timeout to idle while still waiting for input)
        if (session.status !== 'waiting' && session.status !== 'idle') {
            if (session.suggestion) {
                session.suggestion = undefined;
                broadcastSessions();
            }
            return;
        }
        const suggestion = extractSuggestion(stdout);
        // Update if suggestion changed
        if (suggestion !== session.suggestion) {
            session.suggestion = suggestion || undefined;
            debug(`Suggestion for ${session.name}: ${suggestion || '(none)'}`);
            broadcastSessions();
        }
    });
}
function startSuggestionPolling() {
    setInterval(() => {
        for (const session of managedSessions.values()) {
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
        for (const session of managedSessions.values()) {
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
            sendPromptToSession(session.id, session.suggestion).then((result) => {
                if (result.ok) {
                    // Clear the suggestion so we don't send it again
                    session.suggestion = undefined;
                    session.status = 'working';
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
function createSession(options = {}) {
    return new Promise((resolve, reject) => {
        const id = randomUUID();
        sessionCounter++;
        const tmuxSession = `vibecraft-${shortId()}`;
        let cwd;
        try {
            cwd = validateDirectoryPath(options.cwd || process.cwd());
        }
        catch (err) {
            reject(err);
            return;
        }
        // Default name to the directory name (project name)
        const name = options.name || basename(cwd);
        const flags = options.flags || {};
        const claudeArgs = [];
        // Don't use -c by default - each new session should start fresh
        // Otherwise it might continue an existing conversation (like this one!)
        if (flags.continue === true) {
            claudeArgs.push('-c');
        }
        if (flags.skipPermissions !== false) {
            claudeArgs.push('--permission-mode=bypassPermissions');
            claudeArgs.push('--dangerously-skip-permissions');
        }
        if (flags.chrome) {
            claudeArgs.push('--chrome');
        }
        const claudeCmd = claudeArgs.length > 0 ? `claude ${claudeArgs.join(' ')}` : 'claude';
        // Two-step approach: create session without command, then send claude via send-keys
        // This prevents the session from closing when Claude exits or has startup issues
        execFile('tmux', ['new-session', '-d', '-s', tmuxSession, '-c', cwd], EXEC_OPTIONS, (createError) => {
            if (createError) {
                log(`Failed to create tmux session: ${createError.message}`);
                reject(new Error(`Failed to create tmux session: ${createError.message}`));
                return;
            }
            // Now send the Claude command to the session
            execFile('tmux', ['send-keys', '-t', tmuxSession, claudeCmd, 'Enter'], EXEC_OPTIONS, (sendError) => {
                if (sendError) {
                    log(`Failed to send command to session: ${sendError.message}`);
                    // Kill the empty session since we couldn't start Claude
                    exec(`tmux kill-session -t ${tmuxSession}`, EXEC_OPTIONS);
                    reject(new Error(`Failed to start Claude: ${sendError.message}`));
                    return;
                }
                const session = {
                    id,
                    name,
                    type: 'internal',
                    agent: 'claude',
                    tmuxSession,
                    status: 'idle',
                    createdAt: Date.now(),
                    lastActivity: Date.now(),
                    cwd,
                    zonePosition: options.zonePosition,
                };
                managedSessions.set(id, session);
                log(`Created session: ${name} (${id.slice(0, 8)}) -> tmux:${tmuxSession}`);
                if (cwd) {
                    gitStatusManager.track(id, cwd);
                    projectsManager.addProject(cwd, name);
                }
                // Open Terminal.app attached to the tmux session (default: true)
                if (flags.openTerminal !== false) {
                    openTerminalForTmux(tmuxSession);
                }
                broadcastSessions();
                saveSessions();
                resolve(session);
            });
        });
    });
}
function getSessions() {
    return Array.from(managedSessions.values()).map((session) => ({
        ...session,
        gitStatus: gitStatusManager.getStatus(session.id) ?? undefined,
    }));
}
function getSession(id) {
    return managedSessions.get(id);
}
function updateSession(id, updates) {
    const session = managedSessions.get(id);
    if (!session)
        return null;
    if (updates.name) {
        session.name = updates.name;
    }
    // Allow setting zonePosition to place/unplace sessions
    // null = unplace (remove from grid), object = place at position
    if ('zonePosition' in updates) {
        session.zonePosition = updates.zonePosition ?? undefined;
    }
    if (typeof updates.autoAccept === 'boolean') {
        session.autoAccept = updates.autoAccept;
    }
    log(`Updated session: ${session.name} (${id.slice(0, 8)})`);
    broadcastSessions();
    saveSessions();
    return session;
}
function deleteSession(id) {
    return new Promise((resolve) => {
        const session = managedSessions.get(id);
        if (!session) {
            resolve(false);
            return;
        }
        const cleanup = () => {
            managedSessions.delete(id);
            gitStatusManager.untrack(id);
            for (const [claudeId, managedId] of claudeToManagedMap) {
                if (managedId === id) {
                    claudeToManagedMap.delete(claudeId);
                }
            }
            log(`Deleted session: ${session.name} (${id.slice(0, 8)})`);
            broadcastSessions();
            saveSessions();
            resolve(true);
        };
        // External sessions have no tmux to kill
        if (!session.tmuxSession) {
            cleanup();
            return;
        }
        try {
            validateTmuxSession(session.tmuxSession);
        }
        catch {
            log(`Invalid tmux session name: ${session.tmuxSession}`);
            cleanup(); // Still clean up the session record
            return;
        }
        execFile('tmux', ['kill-session', '-t', session.tmuxSession], EXEC_OPTIONS, (error) => {
            if (error) {
                log(`Warning: Failed to kill tmux session: ${error.message}`);
            }
            cleanup();
        });
    });
}
/**
 * Send text to a tmux pane by pane ID (for external sessions running in tmux)
 */
async function sendToTmuxPane(tmuxPane, tmuxSocket, text) {
    // Validate pane ID format (e.g., "%0", "%1", etc.)
    if (!/^%\d+$/.test(tmuxPane)) {
        throw new Error(`Invalid tmux pane ID: ${tmuxPane}`);
    }
    const tempFile = `/tmp/vibecraft-prompt-${Date.now()}-${randomBytes(16).toString('hex')}.txt`;
    writeFileSync(tempFile, text);
    try {
        // Build tmux args - use socket if provided
        const socketArgs = tmuxSocket ? ['-S', tmuxSocket.split(',')[0]] : [];
        await execFileAsync('tmux', [...socketArgs, 'load-buffer', tempFile]);
        await execFileAsync('tmux', [...socketArgs, 'paste-buffer', '-t', tmuxPane]);
        await new Promise((r) => setTimeout(r, 100));
        await execFileAsync('tmux', [...socketArgs, 'send-keys', '-t', tmuxPane, 'Enter']);
    }
    finally {
        try {
            unlinkSync(tempFile);
        }
        catch {
            // Ignore cleanup errors
        }
    }
}
async function sendPromptToSession(id, prompt) {
    const session = managedSessions.get(id);
    if (!session) {
        return { ok: false, error: 'Session not found' };
    }
    // Internal sessions use their managed tmux session
    if (session.tmuxSession) {
        try {
            await sendToTmuxSafe(session.tmuxSession, prompt);
            session.lastActivity = Date.now();
            log(`Prompt sent to ${session.name}: ${prompt.slice(0, 50)}...`);
            return { ok: true };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log(`Failed to send prompt to ${session.name}: ${msg}`);
            return { ok: false, error: msg };
        }
    }
    // External sessions - try to use captured terminal info
    if (session.terminal?.tmuxPane) {
        try {
            await sendToTmuxPane(session.terminal.tmuxPane, session.terminal.tmuxSocket, prompt);
            session.lastActivity = Date.now();
            log(`Prompt sent to external ${session.name} via tmux pane ${session.terminal.tmuxPane}: ${prompt.slice(0, 50)}...`);
            return { ok: true };
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            log(`Failed to send prompt to external ${session.name}: ${msg}`);
            return { ok: false, error: msg };
        }
    }
    return { ok: false, error: 'Cannot send prompts to this external session (no tmux pane info)' };
}
function checkSessionHealth() {
    exec('tmux list-sessions -F "#{session_name}"', EXEC_OPTIONS, (error, stdout) => {
        if (error) {
            // Mark only internal sessions as offline (external sessions don't use tmux)
            for (const session of managedSessions.values()) {
                if (session.tmuxSession && session.status !== 'offline') {
                    session.status = 'offline';
                }
            }
            return;
        }
        const activeSessions = new Set(stdout.trim().split('\n'));
        let changed = false;
        for (const session of managedSessions.values()) {
            // Skip external sessions (they don't have tmux)
            if (!session.tmuxSession)
                continue;
            const isAlive = activeSessions.has(session.tmuxSession);
            const newStatus = isAlive
                ? session.status === 'offline'
                    ? 'idle'
                    : session.status
                : 'offline';
            if (session.status !== newStatus) {
                session.status = newStatus;
                changed = true;
            }
        }
        if (changed) {
            broadcastSessions();
            saveSessions();
        }
    });
}
function checkWorkingTimeout() {
    const now = Date.now();
    let changed = false;
    for (const session of managedSessions.values()) {
        if (session.status === 'working') {
            const timeSinceActivity = now - session.lastActivity;
            if (timeSinceActivity > WORKING_TIMEOUT_MS) {
                log(`Session "${session.name}" timed out after ${Math.round(timeSinceActivity / 1000)}s`);
                session.status = 'idle';
                session.currentTool = undefined;
                changed = true;
            }
        }
    }
    if (changed) {
        broadcastSessions();
        saveSessions();
    }
}
/** How long without activity before marking Codex sessions offline */
const CODEX_INACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Check Codex session health based on activity time
 * Mark sessions as offline if they haven't had activity recently
 */
function checkCodexSessionHealth() {
    const now = Date.now();
    let changed = false;
    for (const session of managedSessions.values()) {
        // Only check Codex sessions that aren't already offline
        if (session.agent === 'codex' && session.status !== 'offline') {
            const inactiveTime = now - session.lastActivity;
            if (inactiveTime >= CODEX_INACTIVE_THRESHOLD_MS) {
                log(`Codex session "${session.name}" marked offline (inactive for ${Math.round(inactiveTime / 60000)} min)`);
                session.status = 'offline';
                session.currentTool = undefined;
                changed = true;
            }
        }
    }
    if (changed) {
        broadcastSessions();
        saveSessions();
    }
}
/** Auto-cleanup sessions that have been offline for too long */
function cleanupStaleOfflineSessions() {
    const now = Date.now();
    const toDelete = [];
    for (const session of managedSessions.values()) {
        if (session.status === 'offline') {
            const offlineTime = now - session.lastActivity;
            if (offlineTime >= OFFLINE_CLEANUP_MS) {
                log(`Auto-cleaning stale session: ${session.name} (offline for ${Math.round(offlineTime / 60000)} min)`);
                toDelete.push(session.id);
            }
        }
    }
    // Delete sessions (async, but we don't need to wait)
    for (const id of toDelete) {
        deleteSession(id);
    }
}
function saveSessions() {
    try {
        const data = {
            sessions: Array.from(managedSessions.values()),
            claudeToManagedMap: Array.from(claudeToManagedMap.entries()),
            sessionCounter,
        };
        writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
        debug(`Saved ${managedSessions.size} sessions to ${SESSIONS_FILE}`);
    }
    catch (e) {
        console.error('Failed to save sessions:', e);
    }
}
function loadSessions() {
    if (!existsSync(SESSIONS_FILE)) {
        debug('No saved sessions file found');
        return;
    }
    try {
        const content = readFileSync(SESSIONS_FILE, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data.sessions)) {
            for (const session of data.sessions) {
                session.status = 'offline';
                session.currentTool = undefined;
                // Migrate old sessions: if they have tmuxSession, they're internal
                if (!session.type) {
                    session.type = session.tmuxSession ? 'internal' : 'external';
                }
                // Migrate old sessions: default agent to 'claude' if not set
                if (!session.agent) {
                    session.agent = session.codexThreadId ? 'codex' : 'claude';
                }
                managedSessions.set(session.id, session);
                if (session.cwd) {
                    gitStatusManager.track(session.id, session.cwd);
                }
            }
        }
        if (Array.isArray(data.claudeToManagedMap)) {
            for (const [claudeId, managedId] of data.claudeToManagedMap) {
                claudeToManagedMap.set(claudeId, managedId);
            }
        }
        if (typeof data.sessionCounter === 'number') {
            sessionCounter = data.sessionCounter;
        }
        log(`Loaded ${managedSessions.size} sessions from ${SESSIONS_FILE}`);
    }
    catch (e) {
        console.error('Failed to load sessions:', e);
    }
}
function broadcastSessions() {
    broadcast({
        type: 'sessions',
        payload: getSessions(),
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
function linkClaudeSession(claudeSessionId, managedSessionId) {
    claudeToManagedMap.set(claudeSessionId, managedSessionId);
    const session = managedSessions.get(managedSessionId);
    if (session) {
        session.claudeSessionId = claudeSessionId;
        log(`Linked Claude session ${claudeSessionId.slice(0, 8)} to ${session.name}`);
        saveSessions();
    }
}
function findManagedSession(claudeSessionId, _eventCwd) {
    // 1. Direct lookup via claudeToManagedMap
    const managedId = claudeToManagedMap.get(claudeSessionId);
    if (managedId) {
        return managedSessions.get(managedId);
    }
    // 2. Try to find by existing claudeSessionId on sessions
    for (const session of managedSessions.values()) {
        if (session.claudeSessionId === claudeSessionId) {
            // Re-establish the map entry
            claudeToManagedMap.set(claudeSessionId, session.id);
            return session;
        }
    }
    // NOTE: We intentionally do NOT fall back to CWD matching here.
    // This keeps internal (tmux-managed) and external sessions separate.
    // External sessions are auto-created in findOrCreateExternalSession().
    return undefined;
}
/**
 * Find existing session or auto-create an external session for unknown Claude sessions.
 * External sessions appear in the sidebar but are not placed on the 3D grid initially.
 */
function findOrCreateExternalSession(claudeSessionId, eventCwd, terminalInfo) {
    // First try normal lookup by Claude session ID
    const existing = findManagedSession(claudeSessionId);
    if (existing) {
        // Update terminal info if provided (e.g., from session_start event)
        if (terminalInfo && existing.type === 'external') {
            existing.terminal = terminalInfo;
            if (terminalInfo.tmuxPane) {
                log(`Updated terminal info for ${existing.name}: tmux pane ${terminalInfo.tmuxPane}`);
            }
        }
        return existing;
    }
    // Check if there's an internal session with matching CWD that doesn't have a Claude ID yet.
    // This handles the case where we just created an internal session and Claude is starting up.
    for (const session of managedSessions.values()) {
        if (session.type === 'internal' &&
            session.cwd === eventCwd &&
            !session.claudeSessionId) {
            // Link this Claude session to the internal session
            session.claudeSessionId = claudeSessionId;
            claudeToManagedMap.set(claudeSessionId, session.id);
            log(`Linked Claude session ${claudeSessionId.slice(0, 8)} to internal session ${session.name}`);
            saveSessions();
            return session;
        }
    }
    // Auto-create external session for this unknown Claude session
    const id = randomUUID();
    const dirName = eventCwd.split('/').pop() || 'External';
    const session = {
        id,
        name: dirName,
        type: 'external',
        agent: 'claude',
        // No tmuxSession for external sessions
        status: 'working',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        cwd: eventCwd,
        claudeSessionId,
        terminal: terminalInfo,
        // No zonePosition - external sessions are unplaced initially
    };
    managedSessions.set(id, session);
    claudeToManagedMap.set(claudeSessionId, id);
    const tmuxInfo = terminalInfo?.tmuxPane ? ` (tmux: ${terminalInfo.tmuxPane})` : '';
    log(`Auto-created external session: ${session.name} (Claude: ${claudeSessionId.slice(0, 8)})${tmuxInfo}`);
    broadcastSessions();
    saveSessions();
    return session;
}
// =============================================================================
// Codex Session Management
// =============================================================================
/** Map of Codex thread IDs to managed session IDs */
const codexToManagedMap = new Map();
/**
 * Find existing session or auto-create a session for Codex threads.
 */
function findOrCreateCodexSession(codexThreadId, eventCwd, name) {
    // First try lookup by Codex thread ID
    const existingId = codexToManagedMap.get(codexThreadId);
    if (existingId) {
        const existing = managedSessions.get(existingId);
        if (existing)
            return existing;
    }
    // Check if there's a session with matching thread ID
    for (const session of managedSessions.values()) {
        if (session.codexThreadId === codexThreadId) {
            codexToManagedMap.set(codexThreadId, session.id);
            return session;
        }
    }
    // Auto-create external session for this Codex thread
    const id = randomUUID();
    const dirName = eventCwd.split('/').pop() || 'Codex';
    const sessionName = name || dirName;
    const session = {
        id,
        name: sessionName,
        type: 'external',
        agent: 'codex',
        status: 'working',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        cwd: eventCwd,
        codexThreadId,
        // No zonePosition - sessions are unplaced initially
    };
    managedSessions.set(id, session);
    codexToManagedMap.set(codexThreadId, id);
    log(`Auto-created Codex session: ${session.name} (Thread: ${codexThreadId.slice(0, 8)})`);
    broadcastSessions();
    saveSessions();
    return session;
}
/**
 * Initialize the Codex session watcher
 */
function initCodexWatcher() {
    const codexWatcher = getCodexWatcher({ debug: DEBUG });
    codexWatcher.on('event', (event) => {
        // Find or create session for this event
        const session = findOrCreateCodexSession(event.sessionId, // This is the Codex thread ID
        event.cwd);
        // IMPORTANT: Update event's sessionId to match the managed session's ID
        // so the frontend can properly filter events by session
        event.sessionId = session.id;
        // Update session state based on event
        if (event.type === 'stop') {
            session.status = 'idle';
            session.currentTool = undefined;
        }
        else if (event.type === 'pre_tool_use') {
            session.status = 'working';
            session.currentTool = event.tool;
        }
        else if (event.type === 'post_tool_use') {
            session.currentTool = event.tool;
        }
        session.lastActivity = Date.now();
        // Add to events and broadcast
        events.push(event);
        if (events.length > MAX_EVENTS) {
            events.shift();
        }
        broadcast({ type: 'event', payload: event });
        broadcastSessions();
        saveSessions();
    });
    codexWatcher.on('session:new', (info) => {
        log(`New Codex session detected: ${info.name} (${info.threadId.slice(0, 8)})`);
        findOrCreateCodexSession(info.threadId, info.cwd, info.name);
    });
    codexWatcher.start();
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
    // Internal sessions are found by Claude session ID mapping
    // External sessions are auto-created when we see an unknown Claude session
    const managedSession = findOrCreateExternalSession(event.sessionId, event.cwd, terminalInfo);
    if (managedSession) {
        const prevStatus = managedSession.status;
        managedSession.lastActivity = Date.now();
        managedSession.cwd = event.cwd;
        switch (event.type) {
            case 'pre_tool_use':
                managedSession.status = 'working';
                managedSession.currentTool = event.tool;
                break;
            case 'post_tool_use':
                managedSession.currentTool = undefined;
                break;
            case 'user_prompt_submit':
                managedSession.status = 'working';
                managedSession.currentTool = undefined;
                break;
            case 'stop':
                // Claude finished responding - waiting for next user input (NEEDS ATTENTION!)
                managedSession.status = 'waiting';
                managedSession.currentTool = undefined;
                break;
            case 'session_end':
                managedSession.status = 'idle';
                managedSession.currentTool = undefined;
                break;
        }
        if (managedSession.status !== prevStatus) {
            broadcastSessions();
            saveSessions();
        }
    }
    broadcast({ type: 'event', payload: processed });
}
// =============================================================================
// File Watching
// =============================================================================
function loadEventsFromFile() {
    if (!existsSync(EVENTS_FILE)) {
        debug(`Events file not found: ${EVENTS_FILE}`);
        return;
    }
    const content = readFileSync(EVENTS_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            processEvent(event);
            events.push(event);
        }
        catch {
            debug(`Failed to parse event line: ${line}`);
        }
    }
    lastFileSize = content.length;
    log(`Loaded ${events.length} events from file`);
}
function watchEventsFile() {
    const dir = dirname(EVENTS_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(EVENTS_FILE)) {
        appendFileSync(EVENTS_FILE, '');
    }
    const watcher = watch(EVENTS_FILE, {
        persistent: true,
        usePolling: true,
        interval: 100,
    });
    watcher.on('change', () => {
        try {
            const content = readFileSync(EVENTS_FILE, 'utf-8');
            if (content.length > lastFileSize) {
                const newContent = content.slice(lastFileSize);
                const newLines = newContent.trim().split('\n').filter(Boolean);
                for (const line of newLines) {
                    try {
                        const event = JSON.parse(line);
                        addEvent(event);
                        debug(`New event from file: ${event.type}`);
                    }
                    catch {
                        debug(`Failed to parse new event: ${line}`);
                    }
                }
                lastFileSize = content.length;
            }
        }
        catch (e) {
            debug(`Error reading events file: ${e}`);
        }
    });
    log(`Watching events file: ${EVENTS_FILE}`);
}
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
            ws.send(JSON.stringify({ type: 'history', payload: history }));
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
            const event = JSON.parse(body);
            addEvent(event);
            debug(`Received event via HTTP: ${event.type}`);
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
    // DELETE /sessions/cleanup - Remove offline sessions
    const cleanupMatch = req.url?.match(/^\/sessions\/cleanup(\?.*)?$/);
    if (req.method === 'DELETE' && cleanupMatch) {
        const urlParams = new URLSearchParams(cleanupMatch[1] || '');
        const maxAgeMs = parseInt(urlParams.get('maxAge') || '0', 10);
        const now = Date.now();
        const toDelete = [];
        for (const session of managedSessions.values()) {
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
        log(`Cleaned up ${toDelete.length} offline sessions`);
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
        if (req.method === 'POST' && action === 'prompt') {
            try {
                const body = await collectRequestBody(req);
                const { prompt } = JSON.parse(body);
                if (!prompt) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Prompt is required' }));
                    return;
                }
                const result = await sendPromptToSession(sessionId, prompt);
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
            try {
                validateTmuxSession(session.tmuxSession);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid tmux session' }));
                return;
            }
            execFile('tmux', ['send-keys', '-t', session.tmuxSession, 'C-c'], EXEC_OPTIONS, (error) => {
                if (error) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: error.message }));
                }
                else {
                    log(`Sent Ctrl+C to ${session.name}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                }
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
            const tmuxSessionName = session.tmuxSession; // TypeScript now knows this is string
            // Kill existing tmux session if it exists (ignore errors)
            execFile('tmux', ['kill-session', '-t', tmuxSessionName], EXEC_OPTIONS, () => {
                // Two-step approach: create session without command, then send claude via send-keys
                execFile('tmux', ['new-session', '-d', '-s', tmuxSessionName, '-c', cwd], EXEC_OPTIONS, (createError) => {
                    if (createError) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: `Failed to create session: ${createError.message}` }));
                        return;
                    }
                    // Send the Claude command to the session
                    const claudeCmd = 'claude --permission-mode=bypassPermissions --dangerously-skip-permissions';
                    execFile('tmux', ['send-keys', '-t', tmuxSessionName, claudeCmd, 'Enter'], EXEC_OPTIONS, (sendError) => {
                        if (sendError) {
                            // Kill the empty session since we couldn't start Claude
                            exec(`tmux kill-session -t ${tmuxSessionName}`, EXEC_OPTIONS);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: false, error: `Failed to restart: ${sendError.message}` }));
                            return;
                        }
                        session.status = 'idle';
                        session.lastActivity = Date.now();
                        session.claudeSessionId = undefined;
                        session.currentTool = undefined;
                        // Clear old linking
                        for (const [claudeId, managedId] of claudeToManagedMap) {
                            if (managedId === session.id) {
                                claudeToManagedMap.delete(claudeId);
                            }
                        }
                        log(`Restarted session: ${session.name} (${session.id.slice(0, 8)})`);
                        broadcastSessions();
                        saveSessions();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, session }));
                    });
                });
            });
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
    // Fallback: static files
    serveStaticFile(req, res);
}
// =============================================================================
// Main
// =============================================================================
function main() {
    log('Starting CIN-Interface server...');
    deepgramApiKey = loadDeepgramKey();
    loadEventsFromFile();
    loadSessions();
    loadTiles();
    gitStatusManager.setUpdateHandler(({ sessionId, status }) => {
        const session = managedSessions.get(sessionId);
        if (session) {
            debug(`Git status updated for ${session.name}: ${status.branch}`);
            broadcastSessions();
        }
    });
    gitStatusManager.start();
    // Initialize Codex session watcher (watches ~/.codex/sessions/)
    initCodexWatcher();
    watchEventsFile();
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
        ws.send(JSON.stringify({
            type: 'connected',
            payload: { sessionId: events[events.length - 1]?.sessionId ?? 'unknown' },
        }));
        ws.send(JSON.stringify({ type: 'sessions', payload: getSessions() }));
        ws.send(JSON.stringify({ type: 'text_tiles', payload: getTiles() }));
        const activeClaudeSessionIds = new Set(Array.from(managedSessions.values())
            .map((s) => s.claudeSessionId)
            .filter(Boolean));
        const filteredHistory = events
            .filter((e) => activeClaudeSessionIds.has(e.sessionId))
            .slice(-50);
        ws.send(JSON.stringify({ type: 'history', payload: filteredHistory }));
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
        setInterval(checkSessionHealth, 5000);
        setInterval(checkWorkingTimeout, WORKING_CHECK_INTERVAL_MS);
        setInterval(checkCodexSessionHealth, 30_000); // Check every 30 seconds
        setInterval(cleanupStaleOfflineSessions, 60_000); // Check every minute
        checkSessionHealth();
        checkCodexSessionHealth(); // Mark inactive Codex sessions as offline
        cleanupStaleOfflineSessions(); // Run once at startup
    });
}
main();
//# sourceMappingURL=index.js.map