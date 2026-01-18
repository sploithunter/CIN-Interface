/**
 * Tests for frontend utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  formatTokens,
  formatTime,
  escapeHtml,
  truncate,
  getToolIcon,
  getEventClass,
  getFilePath,
  eventBelongsToSession,
  hasLongResponse,
  hasLongBashOutput,
  getBashOutputText,
  formatEventContent,
  formatBashCommand,
  formatBashOutput,
  getSessionStatusText,
  RESPONSE_TRUNCATE_THRESHOLD,
  RESPONSE_FULL_THRESHOLD,
  BASH_OUTPUT_TRUNCATE_THRESHOLD,
  BASH_OUTPUT_FULL_THRESHOLD,
} from '../../frontend/src/lib/utils';
import type { ManagedSession, VibecraftEvent } from '../../frontend/src/types';

describe('formatTokens', () => {
  it('formats numbers under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(25000)).toBe('25.0k');
    expect(formatTokens(999999)).toBe('1000.0k');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(1500000)).toBe('1.5M');
    expect(formatTokens(2345678)).toBe('2.3M');
  });
});

describe('formatTime', () => {
  it('formats timestamp as HH:MM:SS', () => {
    // Create a known timestamp
    const date = new Date('2024-01-15T14:30:45');
    const result = formatTime(date.getTime());
    // The format depends on locale, but should contain digits
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes less than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater than', () => {
    expect(escapeHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it('handles multiple escapes', () => {
    expect(escapeHtml('<div class="test">a & b</div>'))
      .toBe('&lt;div class=&quot;test&quot;&gt;a &amp; b&lt;/div&gt;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('truncate', () => {
  it('returns string unchanged if under limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates string and adds ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
    expect(truncate('abcdefghij', 3)).toBe('abc...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('getToolIcon', () => {
  it('returns empty string for undefined tool', () => {
    expect(getToolIcon(undefined)).toBe('');
  });

  it('returns SVG for known tools', () => {
    expect(getToolIcon('Edit')).toContain('svg');
    expect(getToolIcon('edit')).toContain('svg');
    expect(getToolIcon('Bash')).toContain('svg');
    expect(getToolIcon('Read')).toContain('svg');
    expect(getToolIcon('Write')).toContain('svg');
    expect(getToolIcon('Grep')).toContain('svg');
    expect(getToolIcon('Glob')).toContain('svg');
    expect(getToolIcon('WebFetch')).toContain('svg');
    expect(getToolIcon('Task')).toContain('svg');
    expect(getToolIcon('TodoWrite')).toContain('svg');
  });

  it('returns default SVG for unknown tools', () => {
    expect(getToolIcon('UnknownTool')).toContain('svg');
  });

  it('is case insensitive', () => {
    expect(getToolIcon('EDIT')).toContain('tool-icon-edit');
    expect(getToolIcon('bash')).toContain('tool-icon-bash');
  });
});

describe('getEventClass', () => {
  it('returns claude-message for assistant text', () => {
    const event = { type: 'pre_tool_use', assistantText: 'hello' } as VibecraftEvent;
    expect(getEventClass(event)).toBe('claude-message');
  });

  it('returns empty string for no tool', () => {
    const event = { type: 'stop' } as VibecraftEvent;
    expect(getEventClass(event)).toBe('');
  });

  it('returns correct class for each tool type', () => {
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Edit' } as VibecraftEvent)).toBe('tool-edit');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Bash' } as VibecraftEvent)).toBe('tool-bash');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Read' } as VibecraftEvent)).toBe('tool-read');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Write' } as VibecraftEvent)).toBe('tool-write');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'NotebookEdit' } as VibecraftEvent)).toBe('tool-write');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Grep' } as VibecraftEvent)).toBe('tool-grep');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Glob' } as VibecraftEvent)).toBe('tool-grep');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'WebFetch' } as VibecraftEvent)).toBe('tool-web');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'WebSearch' } as VibecraftEvent)).toBe('tool-web');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Task' } as VibecraftEvent)).toBe('tool-task');
    expect(getEventClass({ type: 'pre_tool_use', tool: 'TodoWrite' } as VibecraftEvent)).toBe('tool-todo');
  });

  it('returns empty string for unknown tool', () => {
    expect(getEventClass({ type: 'pre_tool_use', tool: 'Unknown' } as VibecraftEvent)).toBe('');
  });
});

describe('getFilePath', () => {
  it('returns null for no tool input', () => {
    const event = { type: 'pre_tool_use' } as VibecraftEvent;
    expect(getFilePath(event)).toBeNull();
  });

  it('returns null for non-object tool input', () => {
    const event = { type: 'pre_tool_use', toolInput: 'string' } as unknown as VibecraftEvent;
    expect(getFilePath(event)).toBeNull();
  });

  it('extracts file_path', () => {
    const event = { type: 'pre_tool_use', toolInput: { file_path: '/path/to/file.ts' } } as VibecraftEvent;
    expect(getFilePath(event)).toBe('/path/to/file.ts');
  });

  it('extracts path', () => {
    const event = { type: 'pre_tool_use', toolInput: { path: '/path/to/dir' } } as VibecraftEvent;
    expect(getFilePath(event)).toBe('/path/to/dir');
  });

  it('extracts notebook_path', () => {
    const event = { type: 'pre_tool_use', toolInput: { notebook_path: '/notebook.ipynb' } } as VibecraftEvent;
    expect(getFilePath(event)).toBe('/notebook.ipynb');
  });

  it('extracts filePath (camelCase)', () => {
    const event = { type: 'pre_tool_use', toolInput: { filePath: '/camel/path.ts' } } as VibecraftEvent;
    expect(getFilePath(event)).toBe('/camel/path.ts');
  });

  it('prefers file_path over other fields', () => {
    const event = { type: 'pre_tool_use', toolInput: { file_path: '/first', path: '/second' } } as VibecraftEvent;
    expect(getFilePath(event)).toBe('/first');
  });
});

describe('eventBelongsToSession', () => {
  const sessions: ManagedSession[] = [
    {
      id: 'session-1',
      name: 'Session 1',
      type: 'external',
      status: 'idle',
      agent: 'claude',
      cwd: '/project-a',
      claudeSessionId: 'claude-123',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
    {
      id: 'session-2',
      name: 'Session 2',
      type: 'external',
      status: 'working',
      agent: 'codex',
      cwd: '/project-b',
      codexThreadId: 'codex-456',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    },
  ];

  it('matches by managed session ID', () => {
    const event = { sessionId: 'session-1', type: 'pre_tool_use' } as VibecraftEvent;
    expect(eventBelongsToSession(event, sessions[0], sessions)).toBe(true);
    expect(eventBelongsToSession(event, sessions[1], sessions)).toBe(false);
  });

  it('matches by claudeSessionId', () => {
    const event = { sessionId: 'claude-123', type: 'pre_tool_use', cwd: '/project-a' } as VibecraftEvent;
    expect(eventBelongsToSession(event, sessions[0], sessions)).toBe(true);
  });

  it('matches codex by codexThreadId', () => {
    const event = { sessionId: 'codex-456', codexThreadId: 'codex-456', type: 'pre_tool_use', cwd: '/project-b' } as unknown as VibecraftEvent;
    expect(eventBelongsToSession(event, sessions[1], sessions)).toBe(true);
  });

  it('does not match different claude session', () => {
    const event = { sessionId: 'claude-999', type: 'pre_tool_use', cwd: '/project-a' } as VibecraftEvent;
    expect(eventBelongsToSession(event, sessions[0], sessions)).toBe(false);
  });
});

describe('hasLongResponse', () => {
  it('returns false for short stop response', () => {
    const event = { type: 'stop', response: 'short' } as VibecraftEvent;
    expect(hasLongResponse(event)).toBe(false);
  });

  it('returns true for long stop response', () => {
    const event = { type: 'stop', response: 'x'.repeat(RESPONSE_FULL_THRESHOLD + 1) } as VibecraftEvent;
    expect(hasLongResponse(event)).toBe(true);
  });

  it('returns false for short assistant text', () => {
    const event = { type: 'pre_tool_use', assistantText: 'short' } as VibecraftEvent;
    expect(hasLongResponse(event)).toBe(false);
  });

  it('returns true for long assistant text', () => {
    const event = { type: 'pre_tool_use', assistantText: 'x'.repeat(RESPONSE_FULL_THRESHOLD + 1) } as VibecraftEvent;
    expect(hasLongResponse(event)).toBe(true);
  });
});

describe('hasLongBashOutput', () => {
  it('returns false for no tool response', () => {
    const event = { type: 'post_tool_use', tool: 'Bash' } as VibecraftEvent;
    expect(hasLongBashOutput(event)).toBe(false);
  });

  it('returns false for short output', () => {
    const event = { type: 'post_tool_use', tool: 'Bash', toolResponse: 'short output' } as VibecraftEvent;
    expect(hasLongBashOutput(event)).toBe(false);
  });

  it('returns true for long output', () => {
    const event = { type: 'post_tool_use', tool: 'Bash', toolResponse: 'x'.repeat(BASH_OUTPUT_FULL_THRESHOLD + 1) } as VibecraftEvent;
    expect(hasLongBashOutput(event)).toBe(true);
  });
});

describe('getBashOutputText', () => {
  it('returns string as-is', () => {
    expect(getBashOutputText('hello')).toBe('hello');
  });

  it('extracts stdout from object', () => {
    expect(getBashOutputText({ stdout: 'output text' })).toBe('output text');
  });

  it('extracts output from object', () => {
    expect(getBashOutputText({ output: 'output text' })).toBe('output text');
  });

  it('extracts content from object', () => {
    expect(getBashOutputText({ content: 'content text' })).toBe('content text');
  });

  it('stringifies unknown object', () => {
    expect(getBashOutputText({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('converts non-object to string', () => {
    expect(getBashOutputText(123)).toBe('123');
    expect(getBashOutputText(null)).toBe('null');
  });
});

describe('formatEventContent', () => {
  it('formats stop event response', () => {
    const event = { type: 'stop', response: 'Done!' } as VibecraftEvent;
    expect(formatEventContent(event)).toBe('Done!');
  });

  it('truncates long stop response', () => {
    const longResponse = 'x'.repeat(400);
    const event = { type: 'stop', response: longResponse } as VibecraftEvent;
    const result = formatEventContent(event);
    expect(result.length).toBeLessThan(longResponse.length);
    expect(result).toContain('...');
  });

  it('shows full response when fullContent is true', () => {
    const longResponse = 'x'.repeat(400);
    const event = { type: 'stop', response: longResponse } as VibecraftEvent;
    const result = formatEventContent(event, true);
    expect(result).toBe(longResponse);
  });

  it('formats assistant text', () => {
    const event = { type: 'pre_tool_use', assistantText: 'Hello!' } as VibecraftEvent;
    expect(formatEventContent(event)).toBe('Hello!');
  });

  it('formats tool input as JSON', () => {
    const event = { type: 'pre_tool_use', toolInput: { file: 'test.ts' } } as VibecraftEvent;
    expect(formatEventContent(event)).toContain('file');
    expect(formatEventContent(event)).toContain('test.ts');
  });

  it('escapes HTML in content', () => {
    const event = { type: 'stop', response: '<script>alert(1)</script>' } as VibecraftEvent;
    expect(formatEventContent(event)).not.toContain('<script>');
    expect(formatEventContent(event)).toContain('&lt;script&gt;');
  });
});

describe('formatBashCommand', () => {
  it('returns placeholder for missing input', () => {
    const event = { type: 'pre_tool_use', tool: 'Bash' } as VibecraftEvent;
    expect(formatBashCommand(event)).toContain('???');
  });

  it('formats bash command', () => {
    const event = { type: 'pre_tool_use', tool: 'Bash', toolInput: { command: 'ls -la' } } as VibecraftEvent;
    const result = formatBashCommand(event);
    expect(result).toContain('$');
    expect(result).toContain('ls -la');
    expect(result).toContain('bash-prompt');
    expect(result).toContain('bash-cmd');
  });

  it('escapes HTML in command', () => {
    const event = { type: 'pre_tool_use', tool: 'Bash', toolInput: { command: 'echo "<script>"' } } as VibecraftEvent;
    const result = formatBashCommand(event);
    expect(result).not.toContain('<script>');
  });
});

describe('formatBashOutput', () => {
  it('returns empty for no response', () => {
    const event = { type: 'post_tool_use', tool: 'Bash' } as VibecraftEvent;
    expect(formatBashOutput(event, false)).toBe('');
    expect(formatBashOutput(event, true)).toBe('');
  });

  it('truncates long output', () => {
    const longOutput = 'x'.repeat(400);
    const event = { type: 'post_tool_use', tool: 'Bash', toolResponse: longOutput } as VibecraftEvent;
    const result = formatBashOutput(event, false);
    expect(result.length).toBeLessThan(longOutput.length);
    expect(result).toContain('...');
  });

  it('shows full output when requested', () => {
    const longOutput = 'x'.repeat(400);
    const event = { type: 'post_tool_use', tool: 'Bash', toolResponse: longOutput } as VibecraftEvent;
    const result = formatBashOutput(event, true);
    expect(result).toBe(longOutput);
  });
});

describe('getSessionStatusText', () => {
  const createSession = (overrides: Partial<ManagedSession> = {}): ManagedSession => ({
    id: 'test-id',
    name: 'Test Session',
    type: 'internal',
    status: 'idle',
    agent: 'claude',
    cwd: '/test/project',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ...overrides,
  });

  it('shows needs attention for waiting status', () => {
    const session = createSession({ status: 'waiting' });
    const result = getSessionStatusText(session);
    expect(result).toContain('Needs attention');
  });

  it('shows current tool when working', () => {
    const session = createSession({ status: 'working', currentTool: 'Edit' });
    const result = getSessionStatusText(session);
    expect(result).toContain('Edit');
  });

  it('shows Working... when no tool', () => {
    const session = createSession({ status: 'working' });
    const result = getSessionStatusText(session);
    expect(result).toContain('Working...');
  });

  it('shows Offline for offline status', () => {
    const session = createSession({ status: 'offline' });
    const result = getSessionStatusText(session);
    expect(result).toContain('Offline');
  });

  it('shows folder name for idle status', () => {
    const session = createSession({ status: 'idle', cwd: '/path/to/my-project' });
    const result = getSessionStatusText(session);
    expect(result).toContain('my-project');
  });

  it('shows ext tag for external sessions', () => {
    const session = createSession({ type: 'external' });
    const result = getSessionStatusText(session, true);
    expect(result).toContain('ext');
  });

  it('shows unplaced indicator when unplaced', () => {
    const session = createSession();
    const result = getSessionStatusText(session, false, true);
    expect(result).toContain('⊕');
  });

  it('shows codex agent tag', () => {
    const session = createSession({ agent: 'codex', type: 'external' });
    const result = getSessionStatusText(session, true);
    expect(result).toContain('codex');
    expect(result).toContain('session-agent-tag');
  });

  it('shows claude agent tag for external claude sessions', () => {
    const session = createSession({ agent: 'claude', type: 'external' });
    const result = getSessionStatusText(session, true);
    expect(result).toContain('claude');
    expect(result).toContain('session-agent-tag');
  });
});

describe('Constants', () => {
  it('has expected truncation thresholds', () => {
    expect(RESPONSE_TRUNCATE_THRESHOLD).toBe(300);
    expect(RESPONSE_FULL_THRESHOLD).toBe(500);
    expect(BASH_OUTPUT_TRUNCATE_THRESHOLD).toBe(200);
    expect(BASH_OUTPUT_FULL_THRESHOLD).toBe(300);
  });
});
