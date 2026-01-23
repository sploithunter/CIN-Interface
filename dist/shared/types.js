/**
 * CIN-Interface Event Types
 *
 * These types define the contract between:
 * - Hook scripts (produce events)
 * - WebSocket server (relay events)
 * - Three.js client (consume events)
 *
 * Base event and session types are imported from coding-agent-bridge.
 * CIN-specific types (tiles, projects, git status, 3D visualization) are defined here.
 */
// =============================================================================
// Tool-to-Station Mapping (CIN-specific - 3D visualization)
// =============================================================================
/** Map tools to stations in the 3D visualization */
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
// =============================================================================
// Default Config (legacy compatibility)
// =============================================================================
export const DEFAULT_CONFIG = {
    serverPort: 4003,
    eventsFile: './data/events.jsonl',
    maxEventsInMemory: 1000,
    debug: false,
};
//# sourceMappingURL=types.js.map