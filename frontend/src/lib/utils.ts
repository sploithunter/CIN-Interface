/**
 * Pure utility functions extracted from main.ts for testability
 */

import type { ManagedSession, VibecraftEvent } from '../types';

// Thresholds for truncation
export const RESPONSE_TRUNCATE_THRESHOLD = 300;
export const RESPONSE_FULL_THRESHOLD = 500;
export const BASH_OUTPUT_TRUNCATE_THRESHOLD = 200;
export const BASH_OUTPUT_FULL_THRESHOLD = 300;

/**
 * Format a number as a human-readable token count (e.g., 1.5k, 2.3M)
 */
export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format a timestamp as HH:MM:SS in local time
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Escape HTML special characters to prevent XSS
 * Pure version that doesn't depend on DOM
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

/**
 * Get the SVG icon for a tool
 */
export function getToolIcon(tool: string | undefined): string {
  if (!tool) return '';

  const toolLower = tool.toLowerCase();

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

/**
 * Get CSS class for an event based on its type/tool
 */
export function getEventClass(event: VibecraftEvent): string {
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

/**
 * Extract file path from an event's tool input
 */
export function getFilePath(event: VibecraftEvent): string | null {
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

/**
 * Check if an event belongs to a specific session
 */
export function eventBelongsToSession(
  event: VibecraftEvent,
  session: ManagedSession,
  allSessions: ManagedSession[]
): boolean {
  // Direct match: event.sessionId equals managed session ID
  if (event.sessionId === session.id) {
    return true;
  }

  // For Codex sessions, match by codexThreadId (most reliable)
  const eventCodexThreadId = (event as any).codexThreadId;
  if (session.codexThreadId && eventCodexThreadId === session.codexThreadId) {
    return true;
  }

  // If session has a Claude session ID, filter strictly by that
  if (session.claudeSessionId) {
    return event.sessionId === session.claudeSessionId;
  }

  // For Codex sessions, also match by cwd (handles old events without codexThreadId)
  if (session.codexThreadId && session.cwd && event.cwd === session.cwd) {
    // Make sure this event doesn't belong to another Codex session with same cwd
    const otherCodexSessionIds = allSessions
      .filter(s => s.id !== session.id && s.codexThreadId && s.cwd === session.cwd)
      .map(s => s.id);
    // If event doesn't match another session's ID, it likely belongs to this one
    if (!otherCodexSessionIds.includes(event.sessionId)) {
      return true;
    }
  }

  // For sessions without claudeSessionId, check CWD but exclude events from other linked sessions
  if (event.cwd !== session.cwd) return false;

  const otherClaudeSessionIds = new Set(
    allSessions
      .filter(s => s.id !== session.id && s.claudeSessionId)
      .map(s => s.claudeSessionId)
  );

  return !otherClaudeSessionIds.has(event.sessionId);
}

/**
 * Check if an event has a response long enough to warrant truncation
 */
export function hasLongResponse(event: VibecraftEvent): boolean {
  if (event.type === 'stop' && event.response && event.response.length > RESPONSE_FULL_THRESHOLD) {
    return true;
  }
  if (event.assistantText && event.assistantText.length > RESPONSE_FULL_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * Check if a bash event has output long enough to warrant truncation
 */
export function hasLongBashOutput(event: VibecraftEvent): boolean {
  if (!event.toolResponse) return false;
  const output = getBashOutputText(event.toolResponse);
  return output.length > BASH_OUTPUT_FULL_THRESHOLD;
}

/**
 * Extract the output text from a bash tool response
 */
export function getBashOutputText(toolResponse: unknown): string {
  if (typeof toolResponse === 'string') {
    return toolResponse;
  }
  if (typeof toolResponse === 'object' && toolResponse !== null) {
    const resp = toolResponse as Record<string, unknown>;
    // Handle common response formats
    if (typeof resp.stdout === 'string') return resp.stdout;
    if (typeof resp.output === 'string') return resp.output;
    if (typeof resp.content === 'string') return resp.content;
    return JSON.stringify(toolResponse);
  }
  return String(toolResponse);
}

/**
 * Format event content for display
 */
export function formatEventContent(event: VibecraftEvent, fullContent = false): string {
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

/**
 * Format a bash command for display with prompt styling
 */
export function formatBashCommand(event: VibecraftEvent): string {
  if (!event.toolInput || typeof event.toolInput !== 'object') {
    return '<span class="bash-prompt">$</span> <span class="bash-cmd">???</span>';
  }
  const input = event.toolInput as Record<string, unknown>;
  const command = typeof input.command === 'string' ? input.command : '???';
  return `<span class="bash-prompt">$</span> <span class="bash-cmd">${escapeHtml(command)}</span>`;
}

/**
 * Format bash output for display, optionally truncating
 */
export function formatBashOutput(event: VibecraftEvent, fullContent: boolean): string {
  if (!event.toolResponse) return '';
  const output = getBashOutputText(event.toolResponse);
  if (fullContent) {
    return escapeHtml(output);
  }
  return escapeHtml(truncate(output, BASH_OUTPUT_TRUNCATE_THRESHOLD));
}

/**
 * Get status text for a session card
 */
export function getSessionStatusText(
  session: ManagedSession,
  isExternal: boolean = false,
  isUnplaced: boolean = false
): string {
  // Build type prefix for external/agent type
  const isCodex = session.agent === 'codex';
  // Show agent tag for both Claude and Codex external sessions
  const agentTag = isCodex
    ? '<span class="session-agent-tag codex">codex</span> '
    : (isExternal ? '<span class="session-agent-tag claude">claude</span> ' : '');
  // Show EXT tag for all external sessions
  const typePrefix = isExternal ? '<span class="session-type-tag">ext</span> ' : '';
  const unplacedSuffix = isUnplaced ? ' <span class="session-unplaced-tag">⊕</span>' : '';

  if (session.status === 'waiting') {
    return `${agentTag}${typePrefix}<span class="needs-attention">⚡ Needs attention</span>${unplacedSuffix}`;
  }
  if (session.currentTool) {
    return `${agentTag}${typePrefix}<span class="session-tool">${escapeHtml(session.currentTool)}</span>${unplacedSuffix}`;
  }
  if (session.status === 'working') {
    return `${agentTag}${typePrefix}Working...${unplacedSuffix}`;
  }
  if (session.status === 'offline') {
    return `${agentTag}${typePrefix}Offline${unplacedSuffix}`;
  }
  // Extract folder name from cwd for display
  const folder = session.cwd?.split('/').pop() || 'Idle';
  return `${agentTag}${typePrefix}${folder}${unplacedSuffix}`;
}
