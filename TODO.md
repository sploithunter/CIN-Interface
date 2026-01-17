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

---

## TODO / Bugs

### High Priority
- [ ] Replace Vibecraft references with CIN-Interface throughout codebase
- [ ] Enable Enter key to submit messages in prompt input box
- [ ] Hide Stop button after subagent_stop signal received
- [ ] Add UI to kill/delete sessions (backend endpoint exists)
- [ ] Add UI to restart offline sessions (backend endpoint exists)

### Medium Priority
- [ ] Add expand/collapse for large responses in activity feed
- [ ] Add option to minimize 3D map and maximize chat/activity interface
- [ ] Permission prompt handling in web UI

### Low Priority / Future
- [ ] Text labels on hex grid (partially implemented)
- [ ] Voice input (requires DEEPGRAM_API_KEY)
- [ ] CIN-API integration (original fork goal)
- [ ] Deobfuscate/recreate original Vibecraft frontend

---

## Recent Changes (2026-01-17)

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
