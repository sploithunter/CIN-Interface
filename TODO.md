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
- [x] Update frontend/index.html branding from Vibecraft to CIN-Interface
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
- [ ] File explorer UI component
  - [x] Backend API complete (files, file, tree endpoints)
  - [ ] File tree sidebar/panel
  - [ ] Click to view file contents
  - [ ] Integration with prompt input (reference files)
- [ ] External session prompt UI clarity
  - [ ] Disable/hide prompt input for external sessions (can't send messages to them)
  - [ ] Show clear indicator that external sessions are view-only
  - [ ] Consider tooltip or message explaining why prompts are disabled
- [x] Clean up 3D visualization for offline agents
  - [x] Automatically remove zones for offline sessions from hex grid
  - [x] Offline sessions still accessible in sidebar (collapsed "OFFLINE" section)
  - [x] Zones restored when sessions come back online

### Low Priority / Future
- [ ] Text labels on hex grid (partially implemented in frontend)
- [ ] Voice input (requires DEEPGRAM_API_KEY, frontend code exists)
- [ ] CIN-API integration (original fork goal)

### Ambitious Features
- [ ] Browser preview pane for web development (agent can screenshot it)
- [ ] Remote access (local network / internet)
  - [ ] Authentication system
  - [ ] WebSocket proxy / tunneling
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
All data stored in `~/.vibecraft/` for backward compatibility:
- `hooks/` - Installed hook scripts
- `data/events.jsonl` - Event log
- `data/sessions.json` - Session state
- `data/tiles.json` - Text tiles

---

## Recent Changes (2026-01-19)

### Status Update
- Verified all backend features are complete and working
- Frontend source now available (synced from Vibecraft)
- Identified remaining frontend work: branding updates and image/file UI

### Previous Changes (2026-01-18)
- Implemented Codex CLI integration (all 3 phases)
- Added file explorer API (backend)
- Added image support in prompts (backend)
- Added permission prompt handling
- Unified event architecture
- Session cleanup improvements
