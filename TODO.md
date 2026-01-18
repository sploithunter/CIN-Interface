# CIN-Interface TODO

## Working Features

### Session Management
- [x] Create internal sessions via tmux (two-step approach: create session, then send-keys)
- [x] Auto-detect external Claude sessions via hooks
- [x] Session names default to directory name
- [x] Sessions placed correctly on hex grid when created from empty hex click
- [x] Terminal.app auto-opens for new internal sessions
- [x] Send prompts to sessions via web interface
- [x] Send prompts via terminal (both work)
- [x] Cancel sessions (Ctrl+C via tmux)
- [x] Delete sessions via UI (hover for X button)
- [x] Restart offline sessions via UI (hover for restart button)

### Activity Feed
- [x] Filter events by selected session (uses claudeSessionId when available)
- [x] Display Claude's final response in stop events
- [x] No duplicate responses (subagent_stop doesn't repeat stop content)
- [x] Tool call details displayed (Bash, Read, Edit, etc.)
- [x] Expandable content for Edit/Write/Read events

### 3D Visualization
- [x] Hex grid displays sessions as zones
- [x] Click empty hex to create new session at that position
- [x] Click zone to select session
- [x] Context menu on empty hex (Create Zone, Place existing session)
- [x] Unplaced sessions shown with dashed border

### UI
- [x] Session cards in 2x2 grid layout
- [x] Type badges (EXT for external) in detail line
- [x] Status indicators (working, idle, offline, needs attention)
- [x] Git status display per session
- [x] Enter key submits messages (Shift+Enter for newline)
- [x] Stop button auto-hides after session stops

---

## TODO / Bugs

### High Priority
- [x] Replace Vibecraft references with CIN-Interface throughout codebase (user-facing strings updated; ~/.vibecraft paths kept for backward compatibility)
- [x] Add expand/collapse for large responses in activity feed
- [x] Add option to minimize 3D map and maximize chat/activity interface
- [x] Add expand/collapse for Bash/script output in activity feed
- [x] Add expand/collapse for agent/subagent actions in activity feed
- [x] Auto-cleanup stale sessions (detect and remove sessions killed externally)

### Medium Priority
- [x] Permission prompt handling in web UI
- [x] Image support in prompts (API supports base64 images, saves to .cin-images/)
  - [x] Backend API accepts images in POST /sessions/:id/prompt
  - [x] Images saved to session's .cin-images/ directory
  - [x] Image paths included in prompt for Claude/Codex to read
  - [ ] Frontend: Drag and drop images (requires frontend modification)
  - [ ] Frontend: Paste images from clipboard (requires frontend modification)
- [x] File explorer API for current repo
  - [x] GET /sessions/:id/files - List files in directory
  - [x] GET /sessions/:id/file - Read file content (with size limits)
  - [x] GET /sessions/:id/files/tree - Get directory tree
  - [ ] Frontend: File explorer UI component (requires frontend modification)

### Agent Integrations
- [x] OpenAI Codex CLI integration Phase 1 (first non-Claude agent) - See [CODEX_INTEGRATION.md](docs/CODEX_INTEGRATION.md)
  - [x] Research Codex CLI hook system / event format
  - [x] Create integration spec document
  - [x] CodexSessionWatcher (watch ~/.codex/sessions/ JSONL files)
  - [x] Event mapper (Codex events → CIN-Interface format)
  - [x] Add agent type field to sessions and UI
  - [x] Session naming from cwd (with startup reconciliation)
  - [x] Session health checks (mark offline after 30 min inactivity)
  - [x] Persist codexToManagedMap for session ID stability
  - [x] Unified event flow: all events through events.jsonl (single source of truth)
  - [x] Persist Codex events to events.jsonl (survives server restarts)
  - [x] Store codexThreadId in events for reliable cross-restart matching
  - [x] Never auto-delete external sessions (preserves event history matching)
- [x] Codex CLI Phase 2: Notify hook for real-time events
  - [x] Create hooks/codex-hook.sh (transforms notify payload to CIN-Interface format)
  - [x] Add POST /event/codex endpoint to server
  - [x] Add `setup-codex` CLI command (configures ~/.codex/config.toml)
  - [x] Update uninstall command to remove Codex hooks
  - [x] Add Codex checks to doctor command
- [x] Codex CLI Phase 3: Internal Codex sessions via tmux
  - [x] POST /sessions accepts `agent: 'codex'` to create Codex sessions
  - [x] Session restart uses correct agent command (claude or codex)
  - [x] Codex sessions run with `--full-auto` flag by default

### Low Priority / Future
- [ ] Text labels on hex grid (partially implemented)
- [ ] Voice input (requires DEEPGRAM_API_KEY)
- [ ] CIN-API integration (original fork goal)
- [ ] Deobfuscate/recreate original Vibecraft frontend

### Ambitious Features
- [ ] Browser preview pane for web development (agent can screenshot it)
- [ ] Remote access (local network / internet) - requires infrastructure
  - [ ] Authentication system
  - [ ] WebSocket proxy / tunneling
- [ ] Community leaderboard - opt-in stats sharing
  - [ ] Project name, tokens expended, activity stats
  - [ ] Public dashboard for participating users

---

## Recent Changes (2026-01-18)

### Fixed
- Session creation now uses two-step tmux approach (create session, then send claude command)
- Removed default -c flag that caused "No conversation found" errors
- Fixed hex menu placement bug (position was nulled before being used)
- Fixed activity feed session filtering
- Fixed duplicate response display in stop/subagent_stop events

### Added
- zonePosition support when creating sessions
- Response text display for stop events
- Terminal info capture in hooks for external sessions
- Session names default to directory name
- Enter key to submit prompts (Shift+Enter for newline)
- Stop button auto-hides when session stops
- Delete button on session cards (hover to reveal)
- Restart button on offline session cards (hover to reveal)
- Rebranded user-facing strings from Vibecraft to CIN-Interface (data paths unchanged for compatibility)
- Added `cin-interface` as CLI command (alongside `vibecraft` for backward compatibility)
- Expand/collapse for long responses in activity feed (> 500 chars shows preview + "Show full response")
- Map minimize/maximize toggle button and M keyboard shortcut (preference saved in localStorage)
- Fixed expand/collapse to show full content height (removed max-height constraint)
- Fixed dev mode static file path resolution (tsx watch now correctly serves from dist/)
- Added DELETE /sessions/cleanup endpoint to remove all offline sessions
- Added auto-cleanup for sessions offline > 1 hour (runs every minute)
- Added expand/collapse for Bash output in activity feed (shows command + truncated output)
- Implemented Codex CLI integration Phase 1:
  - CodexSessionWatcher watches ~/.codex/sessions/ for JSONL files
  - Event mapper translates Codex events to CIN-Interface format
  - Added agent type field to sessions (claude/codex)
  - UI shows green "codex" badge and border for Codex sessions
  - Fixed event sessionId to use managed session UUID (enables activity feed filtering)
  - Only track recent session files (today + yesterday) to avoid stale sessions
  - Session naming from cwd with startup reconciliation
  - Codex session health checks (offline after 5 min inactivity)
  - Persist codexToManagedMap for session ID stability across restarts
  - Frontend fallback matching by cwd for Codex events
- Unified event architecture:
  - All events flow through events.jsonl as single source of truth
  - CodexWatcher writes to file, file watcher processes all events uniformly
  - Removes duplicate code paths between Claude and Codex event handling
- Session cleanup policy:
  - External sessions (Claude/Codex) never auto-deleted (preserves event matching)
  - Internal sessions auto-cleanup only when tmux process gone (1 hour threshold)
  - Users can manually delete any session via UI
- UI improvements:
  - Both agent tag (CLAUDE/CODEX) and type tag (EXT) shown for external sessions
  - Updated ARCHITECTURE.md with event flow diagrams and remote access design
- Codex Phase 2: Notify hook for instant turn completion events:
  - Created hooks/codex-hook.sh (receives JSON from Codex notify, transforms to CIN-Interface format)
  - Added POST /event/codex endpoint for instant event delivery
  - Added `cin-interface setup-codex` command to configure ~/.codex/config.toml
  - Updated uninstall command to remove Codex hooks and config
  - Added Codex configuration checks to doctor command
- File Explorer API:
  - GET /sessions/:id/files - List files/directories (sorted, directories first)
  - GET /sessions/:id/file - Read file content (1MB limit, binary detection)
  - GET /sessions/:id/files/tree - Recursive directory tree (configurable depth)
  - Security: Path validation ensures requests stay within session's cwd
- Image Support in Prompts:
  - POST /sessions/:id/prompt now accepts `images` array with base64 data
  - Images saved to `.cin-images/` directory in session's cwd
  - Image paths prepended to prompt for Claude/Codex to read
  - Validation: max 5MB per image, supported types: jpeg, png, gif, webp
- Codex Phase 3: Internal Codex sessions:
  - POST /sessions accepts `agent: 'codex'` to spawn Codex CLI via tmux
  - Codex sessions run with `--full-auto` flag (workspace-write + on-request approval)
  - Session restart uses correct agent command based on session.agent type
