/**
 * Vibecraft Event Types
 *
 * These types define the contract between:
 * - Hook scripts (produce events)
 * - WebSocket server (relay events)
 * - Three.js client (consume events)
 */
/** Map tools to stations */
export const TOOL_STATION_MAP = {
    Read: 'bookshelf',
    Write: 'desk',
    Edit: 'workbench',
    Bash: 'terminal',
    Grep: 'scanner',
    Glob: 'scanner',
    WebFetch: 'antenna',
    WebSearch: 'antenna',
    Task: 'portal',
    TodoWrite: 'taskboard',
    AskUserQuestion: 'center',
    NotebookEdit: 'desk',
};
/** Get station for a tool (handles unknown/MCP tools) */
export function getStationForTool(tool) {
    return TOOL_STATION_MAP[tool] ?? 'center';
}
export const DEFAULT_CONFIG = {
    serverPort: 4003,
    eventsFile: './data/events.jsonl',
    maxEventsInMemory: 1000,
    debug: false,
};
