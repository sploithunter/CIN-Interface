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
- [ ] Add expand/collapse for Bash/script output in activity feed

### Medium Priority
- [ ] Permission prompt handling in web UI
- [ ] Drag and drop images into prompt input (for screenshots)

### Low Priority / Future
- [ ] Text labels on hex grid (partially implemented)
- [ ] Voice input (requires DEEPGRAM_API_KEY)
- [ ] CIN-API integration (original fork goal)
- [ ] Deobfuscate/recreate original Vibecraft frontend

### Ambitious Features
- [ ] Browser preview pane for web development (agent can screenshot it)
- [ ] Remote management of CIN-Interface
- [ ] Multi-user support for remote access

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
