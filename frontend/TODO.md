# CIN-Interface Frontend TODO

## Completed
- [x] Set up Vite + TypeScript project
- [x] Create project structure (src/lib, src/components, src/types)
- [x] Define TypeScript types for sessions, events, API responses
- [x] Create REST API client (src/lib/api.ts)
- [x] Create WebSocket client with auto-reconnect (src/lib/websocket.ts)
- [x] Build HTML template with all UI elements
- [x] Create CSS styling (dark theme)
- [x] Implement main.ts with core functionality:
  - WebSocket connection management
  - Session list rendering
  - Activity feed with event filtering
  - New session modal with directory autocomplete
  - Recent projects selection
  - Prompt submission
  - Keyboard shortcuts (0-9 for sessions, Escape for modals)
  - Toast notifications

## Remaining Tasks

### High Priority
- [x] Add 3D scene visualization (Three.js)
  - [x] Initialize Three.js scene in #canvas-container
  - [x] Create hexagonal zone representations for sessions
  - [x] Animate zones based on session status (idle, working, waiting)
  - [x] Add particle effects for tool activity
  - [x] Implement camera controls (orbit, zoom)
  - [x] Auto-focus camera on sessions when loaded
  - [x] Session number labels ("1 CIN", "2 CIN-Interface")
  - [x] Git status labels (branch, lines added/removed)
  - [x] Current tool labels
  - [x] Different 3D shapes for station types (boxes, cones, torus)

- [x] Visual improvements (Vibecraft-style)
  - [x] Replace square grid with hex grid pattern
  - [x] Larger hex platforms with proper fill
  - [x] Thick glowing edges (TubeGeometry)
  - [x] Better status color differentiation (cyan=idle, green=working, rusty-red=waiting)
  - [x] File labels on platform surface
  - [x] Semi-transparent hex surface overlay

- [x] Activity feed improvements
  - [x] Different background colors (greenish for Claude, black for tools)
  - [x] Tool-colored left border (Edit=amber, Bash=green, Read=purple, etc.)
  - [x] "Show content" expandable for Edit/Write/Read events
  - [x] Duration badges (e.g., "79ms")
  - [x] File path display for file operations

- [ ] Session context menu (right-click)
  - Restart session
  - Delete session
  - Copy session ID
  - Open in tmux

- [ ] Voice control integration
  - Connect to voice endpoints if available
  - Show/hide voice control UI based on server capability

### Medium Priority
- [ ] Settings persistence
  - Save port to localStorage
  - Reconnect on port change

- [x] Feed improvements
  - [x] Collapsible feed items for long content ("Show content" toggle)
  - [ ] Search/filter events
  - [x] Color-code by tool type (left border colors)

- [ ] Session details panel
  - Git status display
  - Token usage per session
  - Session duration

### Low Priority
- [ ] Responsive design for mobile
- [ ] Custom themes / light mode
- [ ] Export event history
- [ ] Notifications (browser notifications for errors)

## Backend Improvements (from previous session)
These are already implemented in the backend:
- [x] CWD-based session linking (findManagedSession fallback)
- [x] /projects endpoint - list recent projects
- [x] /projects/autocomplete endpoint - directory suggestions
- [x] /projects/default endpoint - sensible default path
- [x] PATH quoting fix for spaces in paths

## Running the Frontend

```bash
cd /Users/jason/Documents/CIN-Interface/frontend
npm run dev
```

The frontend will be available at http://localhost:5173 (or next available port).

Make sure the backend server is running on port 4003:
```bash
cd /Users/jason/Documents/CIN-Interface
npm start
```

## Architecture Notes

### Files
- `src/main.ts` - Main app entry point, handles all UI logic
- `src/lib/api.ts` - REST API client for sessions, projects
- `src/lib/websocket.ts` - WebSocket client with auto-reconnect
- `src/lib/scene/` - Three.js 3D scene modules:
  - `index.ts` - Barrel exports
  - `SceneManager.ts` - Main Three.js setup (renderer, camera, orbit controls)
  - `SessionZone.ts` - Session visualization (hex platform, status ring, stations)
  - `ParticleSystem.ts` - Particle effects for tool activity
  - `HexGrid.ts` - Hexagonal coordinate utilities
- `src/types/index.ts` - TypeScript interfaces
- `src/style.css` - All CSS styling
- `index.html` - HTML template

### State
- `sessions: ManagedSession[]` - List of managed zones
- `events: VibecraftEvent[]` - Activity feed events
- `selectedSessionId: string | null` - Currently selected session ('all' or session ID)
- `isConnected: boolean` - WebSocket connection status

### WebSocket Messages
- `sessions` - Updated session list from server
- `event` - New tool event
- `history` - Historical events on connect
- `tokens` - Token usage updates

### API Endpoints
- `GET /health` - Server health check
- `GET /config` - Get username, hostname
- `GET /sessions` - List managed sessions
- `POST /sessions` - Create new session
- `DELETE /sessions/:id` - Delete session
- `POST /sessions/:id/restart` - Restart session
- `POST /sessions/:id/prompt` - Send prompt
- `POST /sessions/:id/cancel` - Cancel current operation
- `GET /projects` - List recent projects
- `GET /projects/default` - Get default project path
- `GET /projects/autocomplete?q=<query>` - Autocomplete directories
