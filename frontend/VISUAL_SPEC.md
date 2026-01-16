# CIN-Interface Visual & Functionality Spec

Based on analysis of Vibecraft (vibecraft.sh)

## 1. Background Grid

### Current (Wrong)
- Square grid pattern
- Flat, single-color lines

### Target (Vibecraft)
- **Hexagonal grid pattern** covering the entire background
- Grid extends to horizon with perspective
- Grid color: Dark cyan/teal (#1e3a5f or similar)
- Grid lines are thin but visible
- Creates depth with perspective fogging

## 2. Hex Zone Platforms

### Current (Wrong)
- Small, dark platforms
- Thin edge lines
- Flat appearance

### Target (Vibecraft)
- **Large, prominent hexagonal platforms**
- Platform fill: Semi-transparent dark blue/navy (#1a2744)
- **Thick glowing edge**: Bright cyan (#22d3ee) when idle, green when working
- Edge thickness: ~3-5px equivalent in 3D
- Edge has a glow/bloom effect
- Platform is slightly raised (extruded) with visible depth
- Hex size is much larger relative to stations

## 3. Station Objects (Tool Indicators)

### Current (Wrong)
- Simple geometric primitives (boxes, spheres, cones)
- Small size
- Positioned around edge of hex

### Target (Vibecraft)
Each station has a **distinct, recognizable 3D model**:

| Station | Tool(s) | 3D Model Description |
|---------|---------|---------------------|
| **terminal** | Bash | Robot/android figure with glowing elements |
| **bookshelf** | Read | Bookshelf with visible books, purple/violet glow |
| **desk** | Write, NotebookEdit | Desk with monitor/screen, papers |
| **workbench** | Edit | Workbench with tools, amber/orange glow |
| **scanner** | Grep, Glob | Scanner device with cyan glow |
| **antenna** | WebFetch, WebSearch | Antenna/satellite dish, pink glow |
| **portal** | Task | Swirling portal ring, purple glow |
| **taskboard** | TodoWrite | Board with checkboxes/cards, yellow glow |
| **center** | AskUserQuestion | Central hub marker |

- Stations positioned around the hex perimeter
- Size: ~0.5-0.8 units (much larger than current)
- Each has emissive glow matching its color
- Active station: Brighter, possibly floating/rotating

## 4. Session Labels

### Current (Wrong)
- Single label above platform
- Number badge + name in one sprite
- Git status in separate label above

### Target (Vibecraft)
**Session identifier** (top-left of hex):
- Format: `1 CIN` or `2 CIN-Interface`
- Number in colored circle (status color)
- Name in white text
- Positioned floating above platform, left-aligned

**Git status** (bottom-left of hex):
- Format: `main +174/-5`
- Branch name in gray
- Additions in green (`+174`)
- Deletions in red (`/-5`)
- Small, unobtrusive

**File labels** (on platform surface):
- Current file being worked on
- Example: `email_verification.test.ts`
- Floating slightly above platform
- Multiple file labels can appear

## 5. Status Indication

### Current (Wrong)
- Edge color changes but subtle
- Hard to tell working vs idle at a glance

### Target (Vibecraft)
**Clear visual hierarchy**:

| Status | Edge Color | Glow Intensity | Animation |
|--------|------------|----------------|-----------|
| **idle** | Cyan (#22d3ee) | Medium | Subtle pulse |
| **working** | Green (#22c55e) | High | Active pulse, station animation |
| **waiting** | Yellow (#eab308) | High | Attention-grabbing pulse |
| **offline** | Gray (#64748b) | Low | None |

- Working status should be **immediately obvious**
- Waiting status should **demand attention** (needs user input)

## 6. Color Palette

### Primary Colors
- Background: #0a0f1a (very dark navy)
- Grid lines: #1e3a5f (dark cyan)
- Platform fill: #1a2744 (dark blue-gray)
- Default edge: #22d3ee (bright cyan)

### Status Colors
- Idle: #22d3ee (cyan)
- Working: #22c55e (green)
- Waiting: #eab308 (yellow/amber)
- Offline: #64748b (gray)

### Station Colors
- Terminal (Bash): #22c55e (green)
- Bookshelf (Read): #8b5cf6 (purple)
- Desk (Write): #3b82f6 (blue)
- Workbench (Edit): #f59e0b (amber)
- Scanner (Grep/Glob): #06b6d4 (cyan)
- Antenna (Web): #ec4899 (pink)
- Portal (Task): #a855f7 (violet)
- Taskboard (Todo): #eab308 (yellow)

## 7. Camera & View

### Target
- Isometric-ish angle (not top-down)
- Camera positioned to show depth
- Auto-focus on session centroid on load
- Smooth orbit controls
- Zoom range: Close enough to see details, far enough to see all zones

## 8. Animations

### Platform Edge
- Idle: Subtle breathing pulse (opacity 0.7-1.0)
- Working: Faster pulse, brighter glow
- Waiting: Attention pulse (possibly color shift)

### Active Station
- Floats up slightly
- Rotates slowly
- Increased glow/emissive

### Particles
- Burst on tool activation
- Color matches tool/station
- Rise upward and fade

## 9. UI Layout (Right Panel)

### Session List
- Clear status indicators (colored dots)
- Session number hotkeys visible
- Current tool shown as subtitle
- Working sessions should stand out
- "Needs attention" sessions glow yellow with lightning bolt icon

### Activity Feed
- **Claude messages**: Greenish-black background (#1a2e1a or similar)
- **Tool events**: Pure black background (#0f0f0f)
- **Edit events**: Have "Show content" expandable option
- **Tool icons**: Colored icons matching station colors (Edit = amber, Bash = green, etc.)
- **Timestamps**: Right-aligned, muted gray
- **Duration badges**: Show execution time (e.g., "79ms")

### Message Card Structure
```
┌─────────────────────────────────────────────┐
│ [Icon] ToolName                   4:21 PM 79ms │
│ /path/to/file.ts                              │
│ ▶ Show content                                │
└─────────────────────────────────────────────┘
```

---

## Implementation Priority

### Phase 1: Grid & Platform (Critical)
1. Replace square grid with hex grid
2. Larger hex platforms with proper fill
3. Thick glowing edges with bloom effect
4. Better status color differentiation

### Phase 2: Labels & Status (High)
1. Reposition labels (session top-left, git bottom-left)
2. Add file labels on platform
3. Make working/waiting status obvious
4. Improve label readability

### Phase 3: Station Models (Medium)
1. Create recognizable station models
2. Proper sizing and positioning
3. Emissive materials with glow
4. Active state animations

### Phase 4: Polish (Low)
1. Particle effects improvement
2. Bloom/glow post-processing
3. Smooth animations
4. Performance optimization

### Phase 5: UI Panel (Medium)
1. Different background colors for Claude messages vs tool events
2. "Show content" expandable option for Edit/Write events
3. Tool icons with matching station colors
4. Duration badges for tool execution time
5. "Needs attention" indicator with lightning bolt icon
