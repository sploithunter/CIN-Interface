/**
 * Unit tests for shared types
 * Tests type utilities and constants
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_STATION_MAP,
  getStationForTool,
  DEFAULT_CONFIG,
} from '../../src/shared/types';

describe('TOOL_STATION_MAP', () => {
  it('maps Read to bookshelf', () => {
    expect(TOOL_STATION_MAP.Read).toBe('bookshelf');
  });

  it('maps Write to desk', () => {
    expect(TOOL_STATION_MAP.Write).toBe('desk');
  });

  it('maps Edit to workbench', () => {
    expect(TOOL_STATION_MAP.Edit).toBe('workbench');
  });

  it('maps Bash to terminal', () => {
    expect(TOOL_STATION_MAP.Bash).toBe('terminal');
  });

  it('maps Grep to scanner', () => {
    expect(TOOL_STATION_MAP.Grep).toBe('scanner');
  });

  it('maps Glob to scanner', () => {
    expect(TOOL_STATION_MAP.Glob).toBe('scanner');
  });

  it('maps WebFetch to antenna', () => {
    expect(TOOL_STATION_MAP.WebFetch).toBe('antenna');
  });

  it('maps WebSearch to antenna', () => {
    expect(TOOL_STATION_MAP.WebSearch).toBe('antenna');
  });

  it('maps Task to portal', () => {
    expect(TOOL_STATION_MAP.Task).toBe('portal');
  });

  it('maps TodoWrite to taskboard', () => {
    expect(TOOL_STATION_MAP.TodoWrite).toBe('taskboard');
  });

  it('maps AskUserQuestion to center', () => {
    expect(TOOL_STATION_MAP.AskUserQuestion).toBe('center');
  });

  it('maps NotebookEdit to desk', () => {
    expect(TOOL_STATION_MAP.NotebookEdit).toBe('desk');
  });
});

describe('getStationForTool', () => {
  it('returns correct station for known tools', () => {
    expect(getStationForTool('Read')).toBe('bookshelf');
    expect(getStationForTool('Write')).toBe('desk');
    expect(getStationForTool('Bash')).toBe('terminal');
  });

  it('returns center for unknown tools', () => {
    expect(getStationForTool('UnknownTool')).toBe('center');
    expect(getStationForTool('SomeRandomThing')).toBe('center');
  });

  it('returns center for MCP tools', () => {
    expect(getStationForTool('mcp__server__tool')).toBe('center');
  });

  it('returns center for empty string', () => {
    expect(getStationForTool('')).toBe('center');
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has correct server port', () => {
    expect(DEFAULT_CONFIG.serverPort).toBe(4003);
  });

  it('has events file path', () => {
    expect(DEFAULT_CONFIG.eventsFile).toBe('./data/events.jsonl');
  });

  it('has maxEventsInMemory', () => {
    expect(DEFAULT_CONFIG.maxEventsInMemory).toBe(1000);
  });

  it('has debug flag', () => {
    expect(DEFAULT_CONFIG.debug).toBe(false);
  });
});
