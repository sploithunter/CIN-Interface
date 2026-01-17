import './style.css';
import { api } from './lib/api';
import { ws } from './lib/websocket';
import { SceneManager } from './lib/scene';
import type { ManagedSession, VibecraftEvent, WSMessage } from './types';

// State
let sessions: ManagedSession[] = [];
let events: VibecraftEvent[] = [];
let selectedSessionId: string | null = 'all';
let _isConnected = false;
let tokenCount = 0;
let sceneManager: SceneManager | null = null;
let pendingZonePosition: { q: number; r: number } | null = null;

// DOM Elements
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const usernameEl = document.getElementById('username')!;
const tokenCounter = document.getElementById('token-counter')!;
const connectionStatus = document.getElementById('connection-status')!;
const managedSessionsEl = document.getElementById('managed-sessions')!;
const allSessionsCount = document.getElementById('all-sessions-count')!;
const activityFeed = document.getElementById('activity-feed')!;
const feedEmpty = document.getElementById('feed-empty')!;
const _feedScrollBtn = document.getElementById('feed-scroll-bottom')!;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const promptForm = document.getElementById('prompt-form')!;
const promptSubmit = document.getElementById('prompt-submit') as HTMLButtonElement;
const promptCancel = document.getElementById('prompt-cancel') as HTMLButtonElement;
const promptTarget = document.getElementById('prompt-target')!;
const newSessionBtn = document.getElementById('new-session-btn')!;
const newSessionModal = document.getElementById('new-session-modal')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsModal = document.getElementById('settings-modal')!;
const aboutBtn = document.getElementById('about-btn')!;
const aboutModal = document.getElementById('about-modal')!;
const notConnectedOverlay = document.getElementById('not-connected-overlay')!;
const retryConnectionBtn = document.getElementById('retry-connection')!;
const canvasContainer = document.getElementById('canvas-container')!;
const toggleMapBtn = document.getElementById('toggle-map-btn')!;
const appEl = document.getElementById('app')!;

// Modal elements
const sessionCwdInput = document.getElementById('session-cwd-input') as HTMLInputElement;
const sessionNameInput = document.getElementById('session-name-input') as HTMLInputElement;
const cwdAutocomplete = document.getElementById('cwd-autocomplete')!;
const recentProjectsEl = document.getElementById('recent-projects')!;
const modalDefaultCwd = document.getElementById('modal-default-cwd')!;
const modalCancel = document.getElementById('modal-cancel')!;
const modalCreate = document.getElementById('modal-create')!;
const sessionOptContinue = document.getElementById('session-opt-continue') as HTMLInputElement;
const sessionOptSkipPerms = document.getElementById('session-opt-skip-perms') as HTMLInputElement;
const sessionOptChrome = document.getElementById('session-opt-chrome') as HTMLInputElement;

// Settings modal (port UI for future use)
const _settingsPort = document.getElementById('settings-port') as HTMLInputElement;
const _settingsPortStatus = document.getElementById('settings-port-status')!;
const settingsClose = document.getElementById('settings-close')!;

// About modal
const aboutClose = document.getElementById('about-close')!;

// Hex context menu
const hexContextMenu = document.getElementById('hex-context-menu')!;
let hexMenuPosition: { q: number; r: number } | null = null;
let hexMenuShowTime = 0;

// Initialize
async function init() {
  console.log('[CIN] Initializing...');

  // Load saved preferences
  loadMapPreference();

  // Initialize 3D scene
  if (canvasContainer) {
    sceneManager = new SceneManager(canvasContainer);
    sceneManager.setOnZoneSelect((sessionId) => {
      if (sessionId) {
        selectSession(sessionId);
      }
    });
    sceneManager.setOnEmptyHexClick((hexPosition, screenPos) => {
      showHexContextMenu(hexPosition, screenPos);
    });
    sceneManager.start();
    console.log('[CIN] 3D scene initialized');
  }

  // Set up WebSocket handlers
  ws.onConnection(handleConnection);
  ws.onMessage(handleMessage);

  // Connect to WebSocket
  ws.connect();

  // Set up UI event handlers
  setupEventHandlers();

  // Load initial data
  try {
    const config = await api.config();
    usernameEl.textContent = `${config.username}@${config.hostname}`;
  } catch (e) {
    console.error('[CIN] Failed to load config:', e);
    usernameEl.textContent = 'Not connected';
  }
}

function handleConnection(connected: boolean) {
  _isConnected = connected;

  if (connected) {
    statusDot.className = 'connected';
    statusText.textContent = 'Connected';
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'connection-status connected';
    notConnectedOverlay.classList.add('hidden');
  } else {
    statusDot.className = '';
    statusText.textContent = 'Disconnected';
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'connection-status';
    notConnectedOverlay.classList.remove('hidden');
  }
}

function handleMessage(message: WSMessage) {
  switch (message.type) {
    case 'sessions':
      sessions = message.payload as ManagedSession[];
      renderSessions();
      // Update 3D scene
      sceneManager?.updateSessions(sessions);
      break;

    case 'event':
      const event = message.payload as VibecraftEvent;
      events.push(event);
      renderEvent(event);
      // Update 3D scene with event
      sceneManager?.handleEvent(event);
      // Hide Stop button when session stops
      if (event.type === 'stop' || event.type === 'subagent_stop') {
        const session = sessions.find(s => s.claudeSessionId === event.sessionId);
        if (session && session.id === selectedSessionId) {
          promptCancel.classList.add('hidden');
        }
      }
      break;

    case 'history':
      events = message.payload as VibecraftEvent[];
      renderAllEvents();
      break;

    case 'tokens':
      const tokens = message.payload as { session: string; current: number; cumulative: number };
      tokenCount = tokens.cumulative;
      tokenCounter.textContent = `${formatTokens(tokenCount)} tok`;
      break;
  }
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function renderSessions() {
  const activeCount = sessions.filter(s => s.status !== 'offline').length;
  const workingCount = sessions.filter(s => s.status === 'working').length;
  const externalCount = sessions.filter(s => s.type === 'external').length;

  let statusText = '';
  if (activeCount > 0) {
    statusText = `${activeCount} session${activeCount !== 1 ? 's' : ''}, ${workingCount} working`;
    if (externalCount > 0) {
      statusText += `, ${externalCount} external`;
    }
  } else {
    statusText = 'No active sessions';
  }
  allSessionsCount.textContent = statusText;

  // Sort: placed sessions first, then unplaced
  const sortedSessions = [...sessions].sort((a, b) => {
    const aPlaced = a.zonePosition ? 1 : 0;
    const bPlaced = b.zonePosition ? 1 : 0;
    return bPlaced - aPlaced; // Placed first
  });

  managedSessionsEl.innerHTML = sortedSessions.map((session, index) => {
    const isExternal = session.type === 'external';
    const isUnplaced = !session.zonePosition;
    const classes = [
      'session-card',
      session.status,
      selectedSessionId === session.id ? 'selected' : '',
      isExternal ? 'external' : '',
      isUnplaced ? 'unplaced' : ''
    ].filter(Boolean).join(' ');

    const canRestart = session.type === 'internal' && session.status === 'offline';
    const canDelete = true; // Can always delete

    return `
    <div class="${classes}" data-session="${session.id}">
      <div class="session-card-header">
        <span class="session-hotkey">${index + 1}</span>
        <span class="session-status-dot ${session.status}"></span>
        <span class="session-name">${escapeHtml(session.name)}</span>
        <div class="session-card-actions">
          ${canRestart ? `<button class="session-action-btn restart" data-action="restart" title="Restart session">↻</button>` : ''}
          ${canDelete ? `<button class="session-action-btn delete" data-action="delete" title="Delete session">×</button>` : ''}
        </div>
      </div>
      <div class="session-card-detail">
        ${getSessionStatusText(session, isExternal, isUnplaced)}
      </div>
    </div>
  `;
  }).join('');

  // Add click handlers
  managedSessionsEl.querySelectorAll('.session-card').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't select session if clicking action button
      if ((e.target as HTMLElement).classList.contains('session-action-btn')) {
        return;
      }
      selectSession(el.getAttribute('data-session'));
    });
  });

  // Add action button handlers
  managedSessionsEl.querySelectorAll('.session-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = (btn as HTMLElement).closest('.session-card');
      const sessionId = card?.getAttribute('data-session');
      const action = (btn as HTMLElement).dataset.action;

      if (!sessionId) return;

      if (action === 'delete') {
        const session = sessions.find(s => s.id === sessionId);
        if (confirm(`Delete session "${session?.name}"?`)) {
          const result = await api.deleteSession(sessionId);
          if (result.ok) {
            showToast(`Deleted ${session?.name}`, 'success');
          } else {
            showToast(result.error || 'Failed to delete session', 'error');
          }
        }
      } else if (action === 'restart') {
        const session = sessions.find(s => s.id === sessionId);
        const result = await api.restartSession(sessionId);
        if (result.ok) {
          showToast(`Restarted ${session?.name}`, 'success');
        } else {
          showToast(result.error || 'Failed to restart session', 'error');
        }
      }
    });
  });

  updatePromptTarget();
}

function getSessionStatusText(session: ManagedSession, isExternal: boolean = false, isUnplaced: boolean = false): string {
  // Build type prefix for external/unplaced
  const typePrefix = isExternal ? '<span class="session-type-tag">ext</span> ' : '';
  const unplacedSuffix = isUnplaced ? ' <span class="session-unplaced-tag">⊕</span>' : '';

  if (session.status === 'waiting') {
    return `${typePrefix}<span class="needs-attention">⚡ Needs attention</span>${unplacedSuffix}`;
  }
  if (session.currentTool) {
    return `${typePrefix}<span class="session-tool">${escapeHtml(session.currentTool)}</span>${unplacedSuffix}`;
  }
  if (session.status === 'working') {
    return `${typePrefix}Working...${unplacedSuffix}`;
  }
  if (session.status === 'offline') {
    return `${typePrefix}Offline${unplacedSuffix}`;
  }
  // Extract folder name from cwd for display
  const folder = session.cwd?.split('/').pop() || 'Idle';
  return `${typePrefix}${folder}${unplacedSuffix}`;
}

function selectSession(sessionId: string | null) {
  selectedSessionId = sessionId;

  // Update UI - highlight selected session card
  document.querySelectorAll('.session-card').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('data-session') === sessionId);
  });

  // Update 3D scene selection
  sceneManager?.selectZone(sessionId === 'all' ? null : sessionId);

  updatePromptTarget();
  renderAllEvents();
}

function updatePromptTarget() {
  if (selectedSessionId === 'all' || !selectedSessionId) {
    // "All Sessions" is for viewing only - require specific session to send
    promptTarget.textContent = 'Select a session to send';
    promptSubmit.disabled = true;
    promptInput.placeholder = 'Send a prompt to the selected session...';
  } else {
    const session = sessions.find(s => s.id === selectedSessionId);
    promptTarget.textContent = session ? `Sending to: ${session.name}` : 'Select a session to send';
    promptSubmit.disabled = !session || session.status === 'offline';

    // Show suggestion as placeholder if available
    if (session?.suggestion) {
      promptInput.placeholder = session.suggestion;
    } else {
      promptInput.placeholder = 'Send a prompt to the selected session...';
    }
  }
}

function renderAllEvents() {
  const filtered = filterEvents();

  if (filtered.length === 0) {
    feedEmpty.classList.remove('hidden');
    activityFeed.querySelectorAll('.feed-item').forEach(el => el.remove());
  } else {
    feedEmpty.classList.add('hidden');
    activityFeed.innerHTML = '';
    filtered.forEach(event => renderEvent(event, false));
    scrollToBottom();
  }
}

function filterEvents(): VibecraftEvent[] {
  if (selectedSessionId === 'all') {
    return events;
  }

  const session = sessions.find(s => s.id === selectedSessionId);
  if (!session) return [];

  return events.filter(e => eventBelongsToSession(e, session));
}

function eventBelongsToSession(event: VibecraftEvent, session: ManagedSession): boolean {
  // If session has a Claude session ID, filter strictly by that
  if (session.claudeSessionId) {
    return event.sessionId === session.claudeSessionId;
  }

  // For sessions without claudeSessionId, check CWD but exclude events from other linked sessions
  if (event.cwd !== session.cwd) return false;

  const otherClaudeSessionIds = new Set(
    sessions
      .filter(s => s.id !== session.id && s.claudeSessionId)
      .map(s => s.claudeSessionId)
  );

  return !otherClaudeSessionIds.has(event.sessionId);
}

function renderEvent(event: VibecraftEvent, autoScroll = true) {
  // Check if event should be shown
  if (selectedSessionId !== 'all') {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (!session) return;
    if (!eventBelongsToSession(event, session)) return;
  }

  feedEmpty.classList.add('hidden');

  const el = document.createElement('div');
  el.className = `feed-item ${getEventClass(event)}`;

  const toolName = event.tool || event.type;
  const toolIcon = getToolIcon(event.tool);
  const duration = event.duration ? `<span class="feed-item-duration">${event.duration}ms</span>` : '';
  const filePath = getFilePath(event);
  const fileHtml = filePath ? `<div class="feed-item-file">${escapeHtml(filePath)}</div>` : '';

  // Check if this event has expandable content (Edit, Write, Read tool details)
  const hasExpandableToolDetails = event.tool && ['Edit', 'Write', 'Read'].includes(event.tool) && event.toolInput;
  // Check if this event has a long response that should be collapsible
  const hasLongContent = hasLongResponse(event);

  if (hasExpandableToolDetails) {
    const content = formatEventContent(event);
    el.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-item-tool">${toolIcon}${escapeHtml(toolName)}</span>
        <span class="feed-item-time">${formatTime(event.timestamp)}${duration}</span>
      </div>
      ${fileHtml}
      <div class="feed-item-toggle">Show content</div>
      <div class="feed-item-expandable">
        <div class="feed-item-content">${content}</div>
      </div>
    `;
    // Add click handler for toggle
    const toggle = el.querySelector('.feed-item-toggle');
    toggle?.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
    });
  } else if (hasLongContent) {
    // Long response - show truncated with expand option
    const truncatedContent = formatEventContent(event, false);
    const fullContent = formatEventContent(event, true);
    el.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-item-tool">${toolIcon}${escapeHtml(toolName)}</span>
        <span class="feed-item-time">${formatTime(event.timestamp)}${duration}</span>
      </div>
      ${fileHtml}
      <div class="feed-item-content feed-item-preview">${truncatedContent}</div>
      <div class="feed-item-toggle response-toggle">Show full response</div>
      <div class="feed-item-expandable feed-item-full">
        <div class="feed-item-content">${fullContent}</div>
      </div>
    `;
    // Add click handler for toggle
    const toggle = el.querySelector('.feed-item-toggle');
    toggle?.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
      // Update toggle text
      const previewEl = el.querySelector('.feed-item-preview');
      if (toggle.classList.contains('expanded')) {
        toggle.textContent = 'Show less';
        previewEl?.classList.add('hidden');
      } else {
        toggle.textContent = 'Show full response';
        previewEl?.classList.remove('hidden');
      }
    });
  } else {
    el.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-item-tool">${toolIcon}${escapeHtml(toolName)}</span>
        <span class="feed-item-time">${formatTime(event.timestamp)}${duration}</span>
      </div>
      ${fileHtml}
      <div class="feed-item-content">${formatEventContent(event)}</div>
    `;
  }

  activityFeed.appendChild(el);

  if (autoScroll) {
    scrollToBottom();
  }
}

function getEventClass(event: VibecraftEvent): string {
  if (event.assistantText) return 'claude-message';
  if (!event.tool) return '';

  const tool = event.tool.toLowerCase();
  if (tool === 'edit') return 'tool-edit';
  if (tool === 'bash') return 'tool-bash';
  if (tool === 'read') return 'tool-read';
  if (tool === 'write' || tool === 'notebookedit') return 'tool-write';
  if (tool === 'grep' || tool === 'glob') return 'tool-grep';
  if (tool.includes('web')) return 'tool-web';
  if (tool === 'task') return 'tool-task';
  if (tool === 'todowrite') return 'tool-todo';
  return '';
}

function getToolIcon(tool: string | undefined): string {
  if (!tool) return '';

  const toolLower = tool.toLowerCase();

  // Map tools to icons (using simple SVG icons)
  const icons: Record<string, string> = {
    edit: `<svg class="tool-icon tool-icon-edit" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    bash: `<svg class="tool-icon tool-icon-bash" viewBox="0 0 24 24" fill="currentColor"><path d="M20 19.59V8l-6-6H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c.45 0 .85-.15 1.19-.4l-4.43-4.43c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L20 19.59z"/></svg>`,
    read: `<svg class="tool-icon tool-icon-read" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`,
    write: `<svg class="tool-icon tool-icon-write" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`,
    grep: `<svg class="tool-icon tool-icon-grep" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
    glob: `<svg class="tool-icon tool-icon-glob" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
    webfetch: `<svg class="tool-icon tool-icon-web" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    websearch: `<svg class="tool-icon tool-icon-web" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
    task: `<svg class="tool-icon tool-icon-task" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`,
    todowrite: `<svg class="tool-icon tool-icon-todo" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    notebookedit: `<svg class="tool-icon tool-icon-write" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`,
  };

  return icons[toolLower] || `<svg class="tool-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
}

function getFilePath(event: VibecraftEvent): string | null {
  if (!event.toolInput || typeof event.toolInput !== 'object') return null;
  const input = event.toolInput as Record<string, unknown>;
  const pathFields = ['file_path', 'path', 'notebook_path', 'filePath'];
  for (const field of pathFields) {
    if (typeof input[field] === 'string') {
      return input[field] as string;
    }
  }
  return null;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Thresholds for truncation
const RESPONSE_TRUNCATE_THRESHOLD = 300;
const RESPONSE_FULL_THRESHOLD = 500; // Show expand if longer than this

function formatEventContent(event: VibecraftEvent, fullContent = false): string {
  // Show Claude's response for stop events (but not subagent_stop to avoid duplication)
  if (event.type === 'stop' && event.response) {
    if (fullContent) {
      return escapeHtml(event.response);
    }
    return escapeHtml(truncate(event.response, RESPONSE_TRUNCATE_THRESHOLD));
  }
  if (event.assistantText) {
    if (fullContent) {
      return escapeHtml(event.assistantText);
    }
    return escapeHtml(truncate(event.assistantText, 200));
  }
  if (event.toolInput) {
    return escapeHtml(truncate(JSON.stringify(event.toolInput), 200));
  }
  return escapeHtml(event.type);
}

function hasLongResponse(event: VibecraftEvent): boolean {
  if (event.type === 'stop' && event.response && event.response.length > RESPONSE_FULL_THRESHOLD) {
    return true;
  }
  if (event.assistantText && event.assistantText.length > RESPONSE_FULL_THRESHOLD) {
    return true;
  }
  return false;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function scrollToBottom() {
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

// Map minimize/maximize
function toggleMapMinimized() {
  const isMinimized = appEl.classList.toggle('map-minimized');
  localStorage.setItem('mapMinimized', isMinimized ? 'true' : 'false');
  // Trigger resize for any canvas elements
  window.dispatchEvent(new Event('resize'));
}

function loadMapPreference() {
  const saved = localStorage.getItem('mapMinimized');
  if (saved === 'true') {
    appEl.classList.add('map-minimized');
  }
}

// Event handlers
function setupEventHandlers() {
  // All sessions row
  document.querySelector('.all-sessions-row')?.addEventListener('click', () => {
    selectSession('all');
  });

  // New session button
  newSessionBtn.addEventListener('click', () => openNewSessionModal());

  // Modal buttons
  modalCancel.addEventListener('click', closeNewSessionModal);
  modalCreate.addEventListener('click', createSession);

  // Settings
  settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  settingsClose.addEventListener('click', () => settingsModal.classList.add('hidden'));

  // About
  aboutBtn.addEventListener('click', () => aboutModal.classList.remove('hidden'));
  aboutClose.addEventListener('click', () => aboutModal.classList.add('hidden'));

  // Toggle map button
  toggleMapBtn.addEventListener('click', toggleMapMinimized);

  // Retry connection
  retryConnectionBtn.addEventListener('click', () => ws.connect());

  // Close modals on backdrop click
  [newSessionModal, settingsModal, aboutModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // Prompt form
  promptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendPrompt();
  });

  // Tab key fills in the suggestion
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !promptInput.value.trim()) {
      const session = sessions.find(s => s.id === selectedSessionId);
      if (session?.suggestion) {
        e.preventDefault();
        promptInput.value = session.suggestion;
      }
    }
    // Enter submits (Shift+Enter for new line)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  promptCancel.addEventListener('click', async () => {
    if (selectedSessionId && selectedSessionId !== 'all') {
      await api.cancelSession(selectedSessionId);
    }
  });

  // Autocomplete for directory input
  let autocompleteTimeout: number | null = null;
  sessionCwdInput.addEventListener('input', () => {
    if (autocompleteTimeout) clearTimeout(autocompleteTimeout);
    autocompleteTimeout = window.setTimeout(async () => {
      const query = sessionCwdInput.value;
      if (query.length < 2) {
        cwdAutocomplete.classList.add('hidden');
        return;
      }

      try {
        const result = await api.autocomplete(query);
        if (result.suggestions.length > 0) {
          cwdAutocomplete.innerHTML = result.suggestions.map(s =>
            `<div class="autocomplete-item">${escapeHtml(s)}</div>`
          ).join('');
          cwdAutocomplete.classList.remove('hidden');

          cwdAutocomplete.querySelectorAll('.autocomplete-item').forEach(el => {
            el.addEventListener('click', () => {
              sessionCwdInput.value = el.textContent || '';
              cwdAutocomplete.classList.add('hidden');
              updateSessionNameFromPath();
            });
          });
        } else {
          cwdAutocomplete.classList.add('hidden');
        }
      } catch (e) {
        console.error('[CIN] Autocomplete error:', e);
      }
    }, 200);
  });

  sessionCwdInput.addEventListener('blur', () => {
    // Delay to allow click on autocomplete item
    setTimeout(() => cwdAutocomplete.classList.add('hidden'), 200);
  });

  // Hex context menu handlers
  hexContextMenu.querySelectorAll('.hex-menu-option').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (el as HTMLElement).dataset.action;
      // Save position before hiding menu (hideHexContextMenu nulls hexMenuPosition)
      const savedPosition = hexMenuPosition;
      if (action === 'create-zone' && savedPosition) {
        hideHexContextMenu();
        openNewSessionModal(savedPosition);
      } else if (action === 'add-label') {
        // TODO: Implement text label feature
        hideHexContextMenu();
        showToast('Text labels not yet implemented', 'error');
      }
    });
  });

  // Dismiss hex context menu when clicking anywhere else
  document.addEventListener('click', (e) => {
    // Only dismiss if menu has been visible for at least 150ms (prevents the opening click from closing it)
    if (!hexContextMenu.contains(e.target as Node) && !hexContextMenu.classList.contains('hidden') && Date.now() - hexMenuShowTime > 150) {
      hideHexContextMenu();
    }
  });

  // Dismiss on canvas mouse movement after a brief delay (Vibecraft behavior)
  canvasContainer.addEventListener('mousemove', () => {
    // Only dismiss if menu has been visible for at least 150ms
    if (!hexContextMenu.classList.contains('hidden') && Date.now() - hexMenuShowTime > 150) {
      hideHexContextMenu();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Hex context menu shortcuts
    if (!hexContextMenu.classList.contains('hidden')) {
      // Save position before hiding menu (hideHexContextMenu nulls hexMenuPosition)
      const savedPosition = hexMenuPosition;
      if (e.key.toLowerCase() === 'c' && savedPosition) {
        e.preventDefault();
        hideHexContextMenu();
        openNewSessionModal(savedPosition);
        return;
      }
      if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        hideHexContextMenu();
        showToast('Text labels not yet implemented', 'error');
        return;
      }
      if (e.key === 'Escape') {
        hideHexContextMenu();
        return;
      }
    }

    // Number keys 0-9 for session selection
    if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = document.activeElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const num = parseInt(e.key);
      if (num === 0) {
        selectSession('all');
      } else if (num <= sessions.length) {
        selectSession(sessions[num - 1].id);
      }
    }

    // Escape to close modals
    if (e.key === 'Escape') {
      newSessionModal.classList.add('hidden');
      settingsModal.classList.add('hidden');
      aboutModal.classList.add('hidden');
    }

    // M key to toggle map
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const target = document.activeElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      toggleMapMinimized();
    }
  });
}

function showHexContextMenu(hexPosition: { q: number; r: number }, screenPos: { x: number; y: number }) {
  hexMenuPosition = hexPosition;
  hexMenuShowTime = Date.now();

  // Find unplaced sessions that can be placed here
  const unplacedSessions = sessions.filter(s => !s.zonePosition);

  // Build menu content dynamically
  let menuHtml = `
    <div class="hex-menu-option" data-action="create-zone">
      <span class="hex-menu-key">C</span>
      <span class="hex-menu-label">Create new zone</span>
    </div>
  `;

  // Add unplaced sessions as placement options
  if (unplacedSessions.length > 0) {
    menuHtml += `<div class="hex-menu-divider"></div>`;
    unplacedSessions.forEach((session, i) => {
      const typeBadge = session.type === 'external' ? ' <span class="hex-menu-badge">ext</span>' : '';
      menuHtml += `
        <div class="hex-menu-option" data-action="place-session" data-session-id="${session.id}">
          <span class="hex-menu-key">${i + 1}</span>
          <span class="hex-menu-label">Place: ${escapeHtml(session.name)}${typeBadge}</span>
        </div>
      `;
    });
  }

  menuHtml += `<div class="hex-menu-hint">Click elsewhere to dismiss</div>`;
  hexContextMenu.innerHTML = menuHtml;

  // Re-attach click handlers for the new elements
  hexContextMenu.querySelectorAll('.hex-menu-option').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = (el as HTMLElement).dataset.action;
      // Save position before hiding menu (hideHexContextMenu nulls hexMenuPosition)
      const savedPosition = hexMenuPosition;
      if (action === 'create-zone' && savedPosition) {
        hideHexContextMenu();
        openNewSessionModal(savedPosition);
      } else if (action === 'place-session') {
        const sessionId = (el as HTMLElement).dataset.sessionId;
        if (sessionId && savedPosition) {
          placeSessionAtHex(sessionId, savedPosition);
        }
        hideHexContextMenu();
      }
    });
  });

  // Position the menu at click location
  hexContextMenu.style.left = `${screenPos.x}px`;
  hexContextMenu.style.top = `${screenPos.y}px`;
  hexContextMenu.classList.remove('hidden');

  // Adjust if menu goes off screen
  const rect = hexContextMenu.getBoundingClientRect();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  if (rect.right > windowWidth) {
    hexContextMenu.style.left = `${screenPos.x - rect.width}px`;
  }
  if (rect.bottom > windowHeight) {
    hexContextMenu.style.top = `${screenPos.y - rect.height}px`;
  }
}

function hideHexContextMenu() {
  hexContextMenu.classList.add('hidden');
  hexMenuPosition = null;
}

async function placeSessionAtHex(sessionId: string, position: { q: number; r: number }) {
  try {
    const result = await api.updateSession(sessionId, { zonePosition: position });
    if (result.ok) {
      const session = sessions.find(s => s.id === sessionId);
      showToast(`Placed ${session?.name || 'session'} on grid`, 'success');
    } else {
      showToast(result.error || 'Failed to place session', 'error');
    }
  } catch (e) {
    showToast('Failed to place session', 'error');
  }
}

async function openNewSessionModal(hexPosition?: { q: number; r: number }) {
  pendingZonePosition = hexPosition || null;
  newSessionModal.classList.remove('hidden');

  // Load default path
  try {
    const result = await api.getDefaultPath();
    modalDefaultCwd.textContent = result.path;
    if (!sessionCwdInput.value) {
      sessionCwdInput.value = result.path;
      updateSessionNameFromPath();
    }
  } catch (e) {
    modalDefaultCwd.textContent = '~/Documents';
  }

  // Load recent projects
  try {
    const result = await api.getProjects();
    recentProjectsEl.innerHTML = result.projects.slice(0, 6).map(p =>
      `<div class="recent-project" data-path="${escapeHtml(p.path)}">${escapeHtml(p.name)}</div>`
    ).join('');

    recentProjectsEl.querySelectorAll('.recent-project').forEach(el => {
      el.addEventListener('click', () => {
        sessionCwdInput.value = el.getAttribute('data-path') || '';
        updateSessionNameFromPath();
      });
    });
  } catch (e) {
    console.error('[CIN] Failed to load projects:', e);
  }

  sessionCwdInput.focus();
}

function closeNewSessionModal() {
  newSessionModal.classList.add('hidden');
  sessionCwdInput.value = '';
  sessionNameInput.value = '';
  pendingZonePosition = null;
}

function updateSessionNameFromPath() {
  const path = sessionCwdInput.value;
  if (path && !sessionNameInput.value) {
    const parts = path.split('/').filter(Boolean);
    sessionNameInput.placeholder = parts[parts.length - 1] || 'Auto-filled from directory...';
  }
}

async function createSession() {
  const cwd = sessionCwdInput.value || undefined;
  const name = sessionNameInput.value || undefined;

  const options: {
    name?: string;
    cwd?: string;
    zonePosition?: { q: number; r: number };
    flags: { continue: boolean; skipPermissions: boolean; chrome: boolean };
  } = {
    name,
    cwd,
    flags: {
      continue: sessionOptContinue.checked,
      skipPermissions: sessionOptSkipPerms.checked,
      chrome: sessionOptChrome.checked,
    },
  };

  // Include zone position if clicking on empty hex
  if (pendingZonePosition) {
    options.zonePosition = pendingZonePosition;
  }

  try {
    modalCreate.textContent = 'Creating...';
    modalCreate.setAttribute('disabled', 'true');

    const result = await api.createSession(options);

    if (result.ok && result.session) {
      closeNewSessionModal();
      selectSession(result.session.id);
      showToast(`Created zone: ${result.session.name}`, 'success');
    } else {
      showToast(result.error || 'Failed to create session', 'error');
    }
  } catch (e) {
    console.error('[CIN] Failed to create session:', e);
    showToast('Failed to create session', 'error');
  } finally {
    modalCreate.textContent = 'Create';
    modalCreate.removeAttribute('disabled');
  }
}

async function sendPrompt() {
  let prompt = promptInput.value.trim();

  // If input is empty, use the suggestion (if available)
  if (!prompt && selectedSessionId && selectedSessionId !== 'all') {
    const session = sessions.find(s => s.id === selectedSessionId);
    if (session?.suggestion) {
      prompt = session.suggestion;
    }
  }

  if (!prompt || !selectedSessionId || selectedSessionId === 'all') return;

  try {
    promptSubmit.disabled = true;
    const result = await api.sendPrompt(selectedSessionId, prompt);

    if (result.ok) {
      promptInput.value = '';
      promptCancel.classList.remove('hidden');
    } else {
      showToast(result.error || 'Failed to send prompt', 'error');
    }
  } catch (e) {
    console.error('[CIN] Failed to send prompt:', e);
    showToast('Failed to send prompt', 'error');
  } finally {
    promptSubmit.disabled = false;
  }
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// Start the app
init();
