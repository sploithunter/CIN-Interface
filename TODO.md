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
- [x] Expand/collapse for large responses (> 500 chars)
- [x] Expand/collapse for Bash output
- [x] Expand/collapse for Task (subagent) events

### 3D Visualization
- [x] Hex grid displays sessions as zones
- [x] Click empty hex to create new session at that position
- [x] Click zone to select session
- [x] Context menu on empty hex (Create Zone, Place existing session)
- [x] Unplaced sessions shown with dashed border
- [x] Map minimize/maximize toggle (M key or button)

### UI
- [x] Session cards in 2x2 grid layout
- [x] Type badges (EXT for external) in detail line
- [x] Agent badges (Claude 🧠 / Codex 🤖)
- [x] Status indicators (working, idle, offline, needs attention)
- [x] Git status display per session
- [x] Enter key submits messages (Shift+Enter for newline)
- [x] Stop button auto-hides after session stops
- [x] Permission prompt modal

### Backend APIs
- [x] POST /sessions/:id/prompt - Send prompts with optional images
- [x] GET /sessions/:id/files - List files in directory
- [x] GET /sessions/:id/file - Read file content (1MB limit)
- [x] GET /sessions/:id/files/tree - Directory tree
- [x] POST /event/codex - Codex notify hook endpoint

### Agent Integrations
- [x] Claude Code (via hooks)
- [x] OpenAI Codex CLI (Phase 1-3 complete)
  - [x] CodexSessionWatcher for JSONL files
  - [x] Event mapper (Codex → CIN-Interface format)
  - [x] Notify hook for real-time events
  - [x] Internal Codex sessions via tmux

---

## TODO / In Progress

### High Priority - Frontend Branding
- [x] Update frontend/index.html branding from CIN-Interface to CIN-Interface
  - [x] Page title and meta tags
  - [x] About modal content
  - [x] Not connected overlay text
  - [x] Settings field hints
  - [x] Version checker references
  - [x] Rebuild frontend (`npm run build:client`)

### Medium Priority - Frontend Features
- [x] Image support in prompt input
  - [x] Backend API complete (accepts base64 images)
  - [x] Drag and drop images onto prompt input
  - [x] Paste images from clipboard (Ctrl+V)
  - [x] Image preview before sending
- [x] Full screen chat mode
  - [x] Toggle button (◀) on left edge of feed panel to expand/collapse
  - [x] M keyboard shortcut to toggle
  - [x] Persist preference in localStorage
- [ ] File explorer UI component
  - [x] Backend API complete (files, file, tree endpoints)
  - [ ] File tree sidebar/panel
  - [ ] Click to view file contents
  - [ ] Integration with prompt input (reference files)
- [x] External session UX improvements
  - [x] Disable prompt input for external sessions (can't send messages to them)
  - [x] Show clear "VIEW ONLY" badge in prompt target area
  - [x] Dotted border styling to distinguish external session cards
  - [x] Add "Focus Terminal" button to bring the external terminal window to front
    - Uses tmux select-pane for tmux sessions
    - Activates Terminal.app via AppleScript
- [x] Clean up 3D visualization for offline agents
  - [x] Automatically remove zones for offline sessions from hex grid
  - [x] Offline sessions still accessible in sidebar (collapsed "OFFLINE" section)
  - [x] Zones restored when sessions come back online
- [x] Claude suggestion display in prompt input
  - [x] Show suggestion as placeholder text with 💡 icon
  - [x] Tab key fills in the suggestion
  - [x] 💡 indicator in prompt target area when suggestion available
  - [x] Only displayed when session is idle/waiting (hidden when working)

### Low Priority / Future
- [ ] Text labels on hex grid (partially implemented in frontend)
- [ ] Voice input (requires DEEPGRAM_API_KEY, frontend code exists)
- [ ] CIN-API integration (original fork goal)

---

## Claude TMUX Bridge - New Repository

Extract session management into standalone package `coding-agent-bridge` for reuse across projects.

### Phase 1: Repository Setup
- [x] Create new repository `coding-agent-bridge`
- [x] Initialize with TypeScript, package.json, .gitignore
- [x] Define TypeScript types (Session, Event, Config, AgentAdapter interface)
- [x] Configure package.json exports and build scripts

### Phase 2: Core Implementation
- [x] Implement TmuxExecutor (safe command execution with validation)
- [x] Implement base AgentAdapter interface
- [x] Implement ClaudeAdapter (command building, hook parsing, settings path)
- [x] Implement CodexAdapter (command building, hook parsing, settings path)
- [x] Create universal hook script (coding-agent-hook.sh)

### Phase 3: Session Management
- [x] Implement SessionManager (CRUD, state machine, persistence)
- [x] Implement session linking (agent session ID ↔ bridge session ID)
- [x] Implement external session discovery (read-only monitoring)
- [x] Implement health checks (tmux polling, working timeout, cleanup)
- [x] Unit tests (37 tests)
- [x] Integration tests with real tmux (18 tests)

### Phase 4: Event Processing
- [x] Implement FileWatcher for events.jsonl
- [x] Implement EventProcessor (parse, normalize, route to sessions)
- [x] Wire up EventEmitter for event broadcasting
- [x] Unit tests: FileWatcher (15 tests), EventProcessor (27 tests)

### Phase 5: Server & API
- [x] Implement HTTP server with session endpoints
- [x] Implement WebSocket for real-time events
- [x] Add CORS and origin validation
- [x] Unit tests (21 tests)
- [ ] Plan for future remote gateway (auth, tunneling)

### Phase 6: CLI & Installation
- [x] Implement HookInstaller (per-agent hook setup)
- [x] Build CLI: `coding-agent-bridge setup`
- [x] Build CLI: `coding-agent-bridge doctor`
- [x] Build CLI: `coding-agent-bridge uninstall`
- [x] Build CLI: `coding-agent-bridge server`
- [x] Add dependency checking (tmux, jq, curl)
- [x] Unit tests (17 tests)

### Phase 7: Documentation
- [x] Write README with installation instructions
- [x] Document public API with examples
- [x] Architecture diagram and configuration reference
- [ ] Tag v1.0.0 and publish (GitHub/npm) - deferred until integration complete

---

## CIN-Interface Integration

Integrate `coding-agent-bridge` and remove CIN-Interface branding.

### Phase 8: Remove CIN-Interface References

#### File Renames
- [x] Rename `bin/vibecraft` → `bin/cin`
- [x] Rename `hooks/vibecraft-hook.sh` → `hooks/cin-hook.sh`

#### Content Updates (51 files total)
- [x] Update `package.json` (name, bin, scripts)
- [x] Update `src/server/index.ts` (~30 references)
- [x] Update `src/shared/defaults.ts` (paths, env vars)
- [x] Update `src/shared/types.ts`
- [x] Update `src/server/ProjectsManager.ts`
- [x] Update `src/server/CodexSessionWatcher.ts`
- [x] Update `bin/cli.js` (~36 references)
- [x] Update `hooks/install.sh`
- [x] Update `hooks/codex-hook.sh`
- [x] Update `vite.config.ts`
- [x] Update `CLAUDE.md`
- [x] Update `README.md`
- [x] Update `TODO.md`
- [x] Update `docs/ARCHITECTURE.md`
- [x] Update `docs/CODEX_INTEGRATION.md`
- [x] Update `docs/ADAPTER_DESIGN.md`
- [x] Update `tests/backend/integration/event-flow.test.ts`

#### Frontend Content Updates
- [x] Update `frontend/index.html` (kept attribution credit)
- [x] Update `frontend/main.ts`
- [x] Update `frontend/shared/types.ts`
- [x] Update `frontend/shared/defaults.ts`
- [x] Update `frontend/ui/VersionChecker.ts`
- [x] Update `frontend/ui/VoiceControl.ts`
- [x] Update `frontend/ui/DirectoryAutocomplete.ts`
- [x] Update `frontend/ui/KeybindConfig.ts`
- [x] Update `frontend/systems/AttentionSystem.ts`
- [x] Update `frontend/events/EventBus.ts`
- [x] Update `frontend/audio/SpatialAudioContext.ts`
- [x] Update `frontend/audio/SoundManager.ts`
- [x] Update `shared/defaults.ts` (root shared/)
- [x] Update `shared/types.ts` (root shared/)

#### Data Directory Migration
- [x] Decide on new data directory name → `~/.cin-interface/`
- [x] Update all path references to use `~/.cin-interface/`
- [ ] Add migration logic for existing `~/.cin-interface/` data (deferred - optional)

#### Rebuild
- [ ] Rebuild frontend (`npm run build:client`)
- [ ] Rebuild server (`npm run build`)
- [ ] Test all functionality

### Phase 9: Add Bridge Dependency
- [x] Add `coding-agent-bridge` as file dependency (`file:../coding-agent-bridge`)
- [x] Verify bridge imports work correctly

### Phase 10: Refactor Server to Use Bridge ✅
- [x] Import bridge components in `src/server/index.ts` (SessionManager, FileWatcher, TmuxExecutor)
- [x] Initialize bridge components with CIN data paths
- [x] Wire up bridge event flow (FileWatcher → parse JSON → addEvent())
- [x] Start bridge components in main() function
- [x] Replace watchEventsFile() with bridge's FileWatcher (removed chokidar dependency)
- [x] Replace sendToTmuxSafe() with bridge's TmuxExecutor.pasteBuffer()
- [x] Replace sendToTmuxPane() with bridge's TmuxExecutor.pasteBuffer()
- [x] Replace permission response send-keys with bridge's TmuxExecutor.sendKeys()
- [x] Replace createSession tmux operations with bridge's TmuxExecutor.createSession()
- [x] Replace deleteSession kill-session with bridge's TmuxExecutor.killSession()
- [x] Replace restart session tmux operations with bridge methods
- [x] Replace cancel operation (Ctrl+C) with bridge's TmuxExecutor.sendCtrlC()
- [x] Replace checkSessionHealth() with bridge's TmuxExecutor.listSessions()
- [x] Replace cleanupStaleOfflineSessions() with bridge's TmuxExecutor.listSessions()
- [x] Replace pollTokens/pollPermissions/pollSuggestions with bridge's TmuxExecutor.capturePane()
- [x] Remove chokidar direct dependency (bridge provides it)
- [x] Remove unused execFileAsync() helper
- [x] Remove unused execFile import
- [x] Remove unused EventProcessor (events parsed directly from FileWatcher)

**Note**: TmuxExecutor operations are now fully using the bridge. CIN-specific features (zonePosition, suggestion, autoAccept, tiles, projects, git status) remain in CIN-Interface as a layer on top. The bridge's SessionManager is initialized but CIN maintains its own session management for CIN-specific fields.

### Phase 11: Refactor CLI ✅
- [x] Update `bin/cli.js` to delegate hook setup to bridge
- [x] Keep CIN-specific doctor checks (data directory, server status, tmux sessions)
- [x] Remove manual hook installation code (bridge's HookInstaller handles it)
- [x] Update `setup`, `setup-codex`, `uninstall`, `doctor` commands to use bridge
- [x] Update `--hook-path` to return bridge's hook script path

### Phase 12: Cleanup ✅
- [x] Remove `hooks/` directory (bridge provides hooks)
- [x] Remove `hooks/` from package.json files array
- [x] Update types.ts to import from bridge
- [x] Keep CIN-specific types (tiles, projects, git status, 3D visualization)
- [x] Update CLAUDE.md with new architecture

### Phase 13: Integration Testing ✅
- [x] Test session creation via API (creates tmux session with Claude)
- [x] Test event flow: hooks → bridge FileWatcher → CIN server → WebSocket
- [x] Test external session detection (sessions appear from hook events)
- [x] Test prompt sending via bridge's pasteBuffer
- [x] Test cancel via bridge's sendCtrlC
- [x] Test session deletion via bridge's killSession
- [x] Verify tiles work (CRUD operations)
- [x] Verify projects work (tracking, autocomplete)
- [x] Verify git status polling works (branch, changes, commits)
- [x] Codex sessions: hooks installed via bridge (setup-codex tested earlier)

---

## Future / Ambitious Features
- [ ] Browser preview pane for web development (agent can screenshot it)
- [ ] Remote access via bridge gateway
  - [ ] Authentication system in coding-agent-bridge
  - [ ] WebSocket proxy / tunneling
  - [ ] CIN-Interface as local gateway to remote UI
- [ ] Additional agent adapters (Google Gemini CLI, etc.)
- [ ] Community leaderboard - opt-in stats sharing

---

## Development Notes

### Frontend Development
The frontend source is now available in `frontend/` directory:
```bash
# Development mode with hot-reload
npm run dev

# Build frontend only
npm run build:client

# Full build (client + server)
npm run build
```

Key frontend files:
- `frontend/index.html` - Main HTML template
- `frontend/main.ts` - Main application logic (~108KB)
- `frontend/styles/` - CSS files
- `frontend/ui/` - UI components (modals, menus, etc.)
- `frontend/api/SessionAPI.ts` - Backend API client

### Data Paths
Currently stored in `~/.cin-interface/` (will migrate to `~/.cin-interface/`):
- `hooks/` - Installed hook scripts (will be replaced by coding-agent-bridge)
- `data/events.jsonl` - Event log
- `data/sessions.json` - Session state
- `data/tiles.json` - Text tiles

### Architecture After Integration
```
┌─────────────────────────────────────────────────────────────────┐
│                      CIN-Interface                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Tiles │ Projects │ Git Status │ 3D Visualization (frontend)│ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              coding-agent-bridge (npm package)                │ │
│  │  Sessions │ Events │ Tmux │ Hooks │ Claude/Codex Adapters   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recent Changes (2026-01-23)

### Phase 13 Complete - Integration Testing ✅
- All bridge integration tests pass:
  - Session creation: Creates tmux session with Claude Code
  - Event flow: hooks → FileWatcher → server → WebSocket broadcast
  - External sessions: Detected from hook events with claudeSessionId
  - Prompt sending: Uses bridge's pasteBuffer (tmux load-buffer + paste-buffer)
  - Cancel: Uses bridge's sendCtrlC
  - Delete: Uses bridge's killSession
- CIN-specific features verified:
  - Tiles: CRUD operations work
  - Projects: Tracking and autocomplete work
  - Git status: Polling detects branch, staged/unstaged changes, commits
- Bridge integration is complete and stable

### Phase 12 Complete - Cleanup ✅
- Removed `hooks/` directory (cin-hook.sh, codex-hook.sh, install.sh)
- Removed `hooks/` from package.json files array
- Updated `src/shared/types.ts` to import base types from coding-agent-bridge
- CIN-specific types preserved (ZonePosition, ManagedSession, GitStatus, TextTile, etc.)
- Updated CLAUDE.md with new architecture diagrams and documentation

### Phase 11 Complete - CLI Refactoring ✅
- CLI now uses bridge's `HookInstaller` for all hook operations
- `setup` command delegates to `setupHooks({ dataDir: ~/.cin-interface })`
- `setup-codex` command uses `installer.install('codex')` for Codex-only setup
- `uninstall` command uses `uninstallHooks()` to remove hooks
- `doctor` command uses `checkDependencies()` and `getStatus()` for checks
- `--hook-path` returns bridge's hook script path
- CIN-specific doctor checks preserved: data directory, server status, tmux sessions

### Phase 10 Complete - Bridge Integration ✅
- Phase 8 (Remove Vibecraft References) completed - all 50+ files updated
- Phase 9 (Add Bridge Dependency) completed - `coding-agent-bridge` linked as file dependency
- Phase 10 (Refactor Server) **COMPLETED**:
  - All tmux operations now use bridge's TmuxExecutor
  - File watching uses bridge's FileWatcher (chokidar removed from direct dependencies)
  - Removed unused code: execFileAsync(), execFile import, EventProcessor
  - Bridge's SessionManager initialized but CIN maintains own session management for CIN-specific fields

**Code removals in Phase 10:**
- Removed chokidar direct dependency (bridge provides it)
- Removed execFile import (no longer used)
- Removed execFileAsync helper function
- Removed EventProcessor (events parsed directly)
- Converted callback-based tmux calls to async/await using bridge

### Previous Changes (2026-01-19)

#### Status Update
- Verified all backend features are complete and working
- Frontend source now available (synced from CIN-Interface)
- Identified remaining frontend work: branding updates and image/file UI

### Previous Changes (2026-01-18)
- Implemented Codex CLI integration (all 3 phases)
- Added file explorer API (backend)
- Added image support in prompts (backend)
- Added permission prompt handling
- Unified event architecture
- Session cleanup improvements
