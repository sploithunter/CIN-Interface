/**
 * TimelineManager - Manages the icon timeline at the bottom of the 3D scene
 *
 * Displays tool usage as a horizontal strip of icons with:
 * - Pending/success/fail states
 * - Tooltips on hover
 * - Click to scroll to feed item
 */

import { getToolIcon } from '../utils/ToolUtils'
import type { ClaudeEvent, PreToolUseEvent, PostToolUseEvent } from '../../shared/types'

export class TimelineManager {
  private timelineEl: HTMLElement | null = null
  private tooltipEl: HTMLElement | null = null

  // State tracking
  private eventIds = new Set<string>()
  private pendingIcons = new Map<string, HTMLElement>()
  private completedToolUses = new Set<string>()

  // Configuration
  private maxIcons = 50

  constructor() {
    this.timelineEl = document.getElementById('timeline')
    this.tooltipEl = document.getElementById('timeline-tooltip')
  }

  /**
   * Mark a tool use as completed (used during history pre-scan)
   */
  markCompleted(toolUseId: string): void {
    this.completedToolUses.add(toolUseId)
  }

  /**
   * Add an event to the timeline
   */
  add(event: ClaudeEvent, sessionColor?: number): void {
    if (!this.timelineEl) return

    // Skip duplicates
    if (this.eventIds.has(event.id)) {
      return
    }
    this.eventIds.add(event.id)

    // Limit timeline size
    this.pruneOldIcons()

    // Helper to apply session color border
    const applySessionColor = (icon: HTMLElement) => {
      if (sessionColor !== undefined) {
        icon.style.borderColor = `#${sessionColor.toString(16).padStart(6, '0')}`
        icon.style.borderWidth = '2px'
      }
    }

    // Handle post_tool_use - update existing pending icon or create completed
    if (event.type === 'post_tool_use') {
      const e = event as PostToolUseEvent
      this.completedToolUses.add(e.toolUseId)

      const existing = this.pendingIcons.get(e.toolUseId)
      if (existing) {
        existing.classList.remove('pending')
        existing.classList.add(e.success ? 'success' : 'fail')
        existing.dataset.duration = e.duration?.toString() ?? ''
        existing.dataset.success = e.success.toString()
        this.pendingIcons.delete(e.toolUseId)
        return
      }

      // No pending icon - create completed icon directly
      const icon = this.createIcon(event)
      icon.classList.add(e.success ? 'success' : 'fail')
      applySessionColor(icon)
      this.appendIcon(icon)
      return
    }

    // Handle pre_tool_use - create pending or already-completed icon
    if (event.type === 'pre_tool_use') {
      const e = event as PreToolUseEvent
      const icon = this.createIcon(event)
      applySessionColor(icon)
      this.appendIcon(icon)

      if (this.completedToolUses.has(e.toolUseId)) {
        // Already completed (history replay)
        icon.classList.add('success')
      } else {
        // Still pending
        icon.classList.add('pending')
        this.pendingIcons.set(e.toolUseId, icon)
      }
      return
    }

    // Other events (lifecycle)
    const icon = this.createIcon(event)
    icon.classList.add('lifecycle')
    applySessionColor(icon)
    this.appendIcon(icon)
  }

  /**
   * Remove old icons when timeline exceeds max size
   */
  private pruneOldIcons(): void {
    if (!this.timelineEl) return

    while (this.timelineEl.children.length > this.maxIcons) {
      const first = this.timelineEl.firstChild as HTMLElement
      if (first?.dataset?.toolUseId) {
        this.pendingIcons.delete(first.dataset.toolUseId)
      }
      if (first?.dataset?.eventId) {
        this.eventIds.delete(first.dataset.eventId)
      }
      this.timelineEl.removeChild(first)
    }
  }

  /**
   * Append icon and scroll to end
   */
  private appendIcon(icon: HTMLElement): void {
    if (!this.timelineEl) return
    this.timelineEl.appendChild(icon)
    this.timelineEl.scrollLeft = this.timelineEl.scrollWidth
  }

  /**
   * Create a timeline icon element for an event
   */
  private createIcon(event: ClaudeEvent): HTMLElement {
    const icon = document.createElement('div')
    icon.className = 'timeline-icon'

    let emoji = '📌'
    let toolName = ''
    let filePath = ''
    let toolUseId = ''

    switch (event.type) {
      case 'pre_tool_use':
      case 'post_tool_use': {
        const e = event as PreToolUseEvent | PostToolUseEvent
        emoji = getToolIcon(e.tool)
        toolName = e.tool
        filePath = (e.toolInput as { file_path?: string }).file_path ?? ''
        toolUseId = e.toolUseId
        break
      }
      case 'stop':
        emoji = '🏁'
        toolName = 'Finished'
        break
      case 'session_start':
        emoji = '🚀'
        toolName = 'Session Start'
        break
      case 'user_prompt_submit':
        emoji = '💬'
        toolName = 'Prompt'
        break
      case 'notification':
        emoji = '🔔'
        toolName = 'Notification'
        break
      default:
        toolName = event.type
    }

    icon.textContent = emoji
    icon.dataset.tool = toolName
    icon.dataset.time = new Date(event.timestamp).toLocaleTimeString()
    icon.dataset.file = filePath
    icon.dataset.eventId = event.id
    if (toolUseId) {
      icon.dataset.toolUseId = toolUseId
    }

    this.setupTooltip(icon)
    this.setupClickHandler(icon, event)

    return icon
  }

  /**
   * Setup tooltip behavior for an icon
   */
  private setupTooltip(icon: HTMLElement): void {
    if (!this.tooltipEl) return
    const tooltip = this.tooltipEl

    icon.addEventListener('mouseenter', () => {
      const rect = icon.getBoundingClientRect()
      const duration = icon.dataset.duration ? `${icon.dataset.duration}ms` : ''
      const success = icon.dataset.success
      const statusText = success === 'true' ? '✓' : success === 'false' ? '✗' : '⏳'

      tooltip.innerHTML = `
        <span class="tooltip-tool">${icon.dataset.tool}</span>
        ${duration ? `<span class="tooltip-duration">${duration}</span>` : ''}
        <span style="margin-left: 4px">${statusText}</span>
        <div class="tooltip-time">${icon.dataset.time}</div>
        ${icon.dataset.file ? `<div class="tooltip-file">${icon.dataset.file}</div>` : ''}
      `
      tooltip.style.left = `${rect.left}px`
      tooltip.style.top = `${rect.top - 60}px`
      tooltip.classList.add('visible')
    })

    icon.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible')
    })
  }

  /**
   * Setup click handler to scroll to feed item
   */
  private setupClickHandler(icon: HTMLElement, event: ClaudeEvent): void {
    icon.addEventListener('click', () => {
      const feed = document.getElementById('activity-feed')
      if (!feed) return

      // Try to find by toolUseId first
      let feedItem: HTMLElement | null = null
      if (icon.dataset.toolUseId) {
        feedItem = feed.querySelector(`[data-tool-use-id="${icon.dataset.toolUseId}"]`)
      }

      // Fall back to matching by timestamp
      if (!feedItem && event.timestamp) {
        feedItem = feed.querySelector(`[data-event-id="${event.timestamp}"]`)
      }

      if (feedItem) {
        // Scroll feed item into view
        feedItem.scrollIntoView({ behavior: 'smooth', block: 'center' })

        // Highlight the item briefly
        feedItem.style.transition = 'box-shadow 0.2s'
        feedItem.style.boxShadow = '0 0 0 2px #a78bfa, 0 0 20px rgba(167, 139, 250, 0.4)'
        setTimeout(() => {
          feedItem!.style.boxShadow = ''
        }, 1500)
      }
    })
  }
}
