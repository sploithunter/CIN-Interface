/**
 * CIN-Interface - Central Configuration Defaults
 *
 * Single source of truth for default values.
 * Environment variables override these defaults.
 */
export declare const DEFAULTS: {
    /** WebSocket/API server port */
    readonly SERVER_PORT: 4003;
    /** Vite dev server port */
    readonly CLIENT_PORT: 4002;
    /**
     * Events file path.
     * Uses ~/.vibecraft/ to ensure consistent location regardless of
     * how the app was installed (npx, global npm, local dev).
     * The ~ is expanded by the server at runtime.
     */
    readonly EVENTS_FILE: "~/.vibecraft/data/events.jsonl";
    /**
     * Sessions file path.
     * Uses ~/.vibecraft/ for consistency across installations.
     */
    readonly SESSIONS_FILE: "~/.vibecraft/data/sessions.json";
    /** Max events to keep in memory */
    readonly MAX_EVENTS: 1000;
    /** tmux session name */
    readonly TMUX_SESSION: "claude";
};
export type Defaults = typeof DEFAULTS;
//# sourceMappingURL=defaults.d.ts.map