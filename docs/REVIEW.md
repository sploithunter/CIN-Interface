# Architecture Review: Deficiencies and Scalability Issues

## Critical Issues

### 1. Single Point of Failure - File-Based Event Storage
**Issue:** Events are stored in a single JSONL file (`events.jsonl`)
**Problems:**
- File can grow unbounded (only trimmed in memory, not on disk)
- File locking not implemented - concurrent writes possible
- No rotation or archival strategy
- Read performance degrades as file grows
**Recommendation:** 
- Implement log rotation
- Consider SQLite for structured storage
- Add periodic file trimming to match MAX_EVENTS

### 2. Session-Claude Linking is Fragile
**Issue:** `claudeToManagedMap` linking is:
- Not persisted between server restarts (partial save/restore)
- Based on Claude session IDs from events
- Can become stale if Claude restarts without proper cleanup
**Impact:** Events may not be associated with the correct managed session
**Recommendation:** 
- Implement proper session linking on tmux session start
- Use environment variables to pass managed session ID to Claude
- Clean up stale mappings periodically

### 3. No Authentication/Authorization
**Issue:** Anyone on localhost can:
- Create/delete sessions
- Send prompts (potentially malicious)
- Access all session data
**Impact:** Local privilege escalation risk
**Recommendation:**
- Add API key authentication
- Implement session-scoped tokens
- Add rate limiting

### 4. Memory Leaks Potential
**Issue:** Several maps grow without cleanup:
- `seenEventIds` - only trimmed when size > MAX_EVENTS * 2
- `pendingToolUses` - never cleaned if post_tool_use is missing
- `sessionTokens` - never cleaned for deleted sessions
- `voiceSessions` - cleaned on disconnect but could leak on crashes
**Recommendation:**
- Implement TTL-based cleanup for all maps
- Add periodic garbage collection
- Monitor memory usage

## Scalability Issues

### 1. tmux as Process Manager
**Current:** Each session spawns a tmux session
**Limitations:**
- tmux server is single-process
- Limited to single machine
- No built-in clustering
- Resource isolation limited
**Future Scale Solution:**
- Container-based session management
- Kubernetes operators for Claude sessions
- Process pools with health checking

### 2. WebSocket Broadcasting is O(n)
**Current:** Every event broadcast to all clients
**Issues:**
- 100 clients = 100 sends per event
- No filtering by session interest
- No message batching
**Recommendation:**
- Implement subscription channels per session
- Batch events with debounce
- Consider WebSocket multiplexing

### 3. Git Status Polling
**Current:** Polls every 15 seconds per tracked directory
**Issues:**
- Linear scaling with session count
- Spawns git processes repeatedly
- No caching of unchanged status
**Recommendation:**
- Use file watchers (fsevents) for change detection
- Cache status with invalidation
- Batch git operations

### 4. Permission Polling
**Current:** Polls tmux pane every 1 second per session
**Issues:**
- N sessions = N tmux captures per second
- CPU intensive for large session counts
- Regex parsing on every poll
**Recommendation:**
- Implement Claude hook for permission requests
- Use Claude's native permission system
- Event-driven instead of polling

## Design Issues

### 1. Tight Coupling to tmux
**Issue:** Session management deeply coupled to tmux
**Files Affected:** 
- `createSession()` - spawns tmux directly
- `restartSession()` - kills/recreates tmux
- `sendPromptToSession()` - uses tmux paste-buffer
- `checkSessionHealth()` - calls tmux list-sessions
- `pollPermissions()` - captures tmux pane
**Impact:** Cannot easily support alternative backends
**Solution:** Create session adapter interface (see ADAPTER_DESIGN.md)

### 2. Hardcoded Claude CLI Flags
**Issue:** Restart always uses:
```javascript
`claude -c --permission-mode=bypassPermissions --dangerously-skip-permissions`
```
**Problems:**
- Cannot change permission mode
- Cannot add new flags
- Session creation flags not preserved in restart
**Recommendation:**
- Store session creation flags in session data
- Use stored flags for restart
- Make permission mode configurable

### 3. No Event Deduplication Across Sources
**Issue:** Events can arrive via:
- HTTP POST (from hooks)
- File watcher (from events.jsonl)
**Current:** Deduplication by event ID
**Problem:** Race conditions possible if POST arrives after file write
**Recommendation:**
- Remove file watcher backup, rely only on HTTP
- Or add delay to file watcher processing

### 4. Frontend Source Not Available
**Issue:** Frontend is minified, source not in repository
**Impact:**
- Cannot modify 3D visualization
- Cannot add new UI features
- Dependent on external hosting
**Recommendation:**
- Acquire or recreate frontend source
- Add Vite/React build to repository
- Host frontend locally

## External API Connectivity Issues

### 1. No Adapter Interface
**Issue:** Server directly implements Claude-specific logic
**Affected Code:**
- Hook event format parsing
- tmux session management
- Claude CLI invocation
- Permission prompt detection
**Impact:** Cannot connect to CIN-API or other backends
**Solution:** Design clean adapter interface

### 2. Event Format Lock-in
**Issue:** Event types match Claude hooks exactly
**Problem:** Other systems may have different:
- Event types
- Data structures
- Tool naming
**Recommendation:**
- Define canonical event format
- Create adapters that translate to/from canonical

### 3. No Health/Metrics Endpoints for Monitoring
**Issue:** `/health` is basic
**Missing:**
- Prometheus metrics
- Session health details
- Resource usage stats
- Error rates
**Recommendation:**
- Add `/metrics` endpoint
- Track event processing latency
- Monitor session health trends

## Security Concerns

### 1. Command Injection Risk in PATH
**Fixed:** PATH is now single-quoted
**Remaining Risk:** Other environment variables not sanitized
**Recommendation:** Audit all execFile calls for injection vectors

### 2. Prompt Injection via tmux
**Issue:** User prompts sent directly to tmux via paste-buffer
**Risk:** Specially crafted prompts could escape context
**Mitigation:** Current temp file approach is reasonable
**Recommendation:** Add prompt sanitization layer

### 3. Session Data Exposure
**Issue:** All sessions visible to all clients
**Risk:** Multi-user scenarios leak information
**Recommendation:** Implement session ownership/visibility

## Performance Bottlenecks

### 1. Synchronous File Operations
**Issue:** `writeFileSync`, `readFileSync` used throughout
**Impact:** Blocks event loop during file I/O
**Recommendation:** Convert to async operations

### 2. JSON Parsing on Every Event
**Issue:** Each event parsed independently
**Impact:** CPU overhead for high event volumes
**Recommendation:** Consider streaming JSON parser

### 3. No Connection Pooling
**Issue:** Each tmux command spawns new process
**Impact:** Process creation overhead
**Recommendation:** Consider tmux control mode for batching

## Recommendations Priority

### P0 (Critical)
1. Add log rotation for events.jsonl
2. Fix memory leak in pendingToolUses map
3. Implement adapter interface for backend flexibility

### P1 (High)
1. Convert to async file operations
2. Add session subscription filtering
3. Implement proper session-Claude linking

### P2 (Medium)
1. Add authentication
2. Replace permission polling with hooks
3. Add Prometheus metrics

### P3 (Low)
1. Frontend source reconstruction
2. WebSocket message batching
3. Container-based session management
