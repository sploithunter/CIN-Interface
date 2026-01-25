/**
 * Feedback Modal - User feedback submission UI with Status Tab
 *
 * Captures:
 * - Feedback type (bug, improve, works)
 * - Description from user
 * - Automatic screenshot via html2canvas
 * - Context: session info, recent events, console errors
 *
 * Status Tab:
 * - Shows submission history from localStorage
 * - Polls for status updates from the API
 * - Shows lifecycle: Submitted → Issue Created → In Progress → Complete/Failed
 */

import html2canvas from 'html2canvas'
import { toast } from './Toast'

// ============================================================================
// Types
// ============================================================================

export type FeedbackType = 'bug' | 'improve' | 'works'

export type FixerStatus = 'pending' | 'in_progress' | 'validating' | 'complete' | 'failed' | 'rolled_back'

export interface FeedbackModalContext {
  apiUrl: string
  getActiveSessionId: () => string | null
  getActiveSessionName: () => string | null
  getActiveSessionStatus: () => string | null
  getRecentEvents: () => string[]
}

interface CreateFeedbackInput {
  type: FeedbackType
  description: string
  sessionId?: string
  sessionName?: string
  sessionStatus?: string
  recentEvents?: string[]
  consoleErrors?: string[]
  viewportWidth: number
  viewportHeight: number
  userAgent: string
  screenshot?: string
}

interface StoredFeedback {
  id: string
  timestamp: number
  description: string
  type: FeedbackType
}

interface FeedbackStatus {
  id: string
  processed: boolean
  githubIssueNumber?: number
  githubIssueUrl?: string
  fixerStatus?: FixerStatus
  fixerMessage?: string
  screenshotUrl?: string
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'cin-feedback-submissions'
const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds
const MAX_STORED_SUBMISSIONS = 20

// ============================================================================
// State
// ============================================================================

let context: FeedbackModalContext | null = null
let isSubmitting = false
let capturedScreenshot: string | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let currentTab: 'submit' | 'status' = 'submit'

// Capture console errors for context
const consoleErrors: string[] = []
const MAX_CONSOLE_ERRORS = 10

// Intercept console.error to capture errors
const originalConsoleError = console.error
console.error = (...args) => {
  const errorMessage = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')

  consoleErrors.push(errorMessage)
  if (consoleErrors.length > MAX_CONSOLE_ERRORS) {
    consoleErrors.shift()
  }

  originalConsoleError.apply(console, args)
}

// ============================================================================
// LocalStorage Helpers
// ============================================================================

function getStoredSubmissions(): StoredFeedback[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveSubmission(feedback: StoredFeedback): void {
  const submissions = getStoredSubmissions()
  submissions.unshift(feedback)
  // Keep only the most recent submissions
  while (submissions.length > MAX_STORED_SUBMISSIONS) {
    submissions.pop()
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions))
  updateStatusCount()
}

function removeSubmission(id: string): void {
  const submissions = getStoredSubmissions().filter(s => s.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(submissions))
  updateStatusCount()
}

// ============================================================================
// Status Tab Helpers
// ============================================================================

function getStatusBadgeClass(status?: FeedbackStatus): string {
  if (!status) return 'status-pending'
  if (!status.processed) return 'status-pending'
  if (status.fixerStatus === 'complete') return 'status-complete'
  if (status.fixerStatus === 'failed' || status.fixerStatus === 'rolled_back') return 'status-failed'
  if (status.fixerStatus === 'in_progress' || status.fixerStatus === 'validating') return 'status-in-progress'
  if (status.githubIssueNumber) return 'status-issue-created'
  return 'status-pending'
}

function getStatusText(status?: FeedbackStatus): string {
  if (!status) return 'Submitted'
  if (!status.processed) return 'Submitted'
  if (status.fixerStatus === 'complete') return 'Complete'
  if (status.fixerStatus === 'failed') return 'Failed'
  if (status.fixerStatus === 'rolled_back') return 'Rolled Back'
  if (status.fixerStatus === 'validating') return 'Validating'
  if (status.fixerStatus === 'in_progress') return 'In Progress'
  if (status.githubIssueNumber) return `Issue #${status.githubIssueNumber}`
  return 'Processing'
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function updateStatusCount(): void {
  const count = getStoredSubmissions().length
  const badge = document.querySelector('.feedback-status-count')
  if (badge) {
    badge.textContent = String(count)
    badge.classList.toggle('hidden', count === 0)
  }
}

async function fetchFeedbackStatus(id: string): Promise<FeedbackStatus | null> {
  if (!context) return null
  try {
    const response = await fetch(`${context.apiUrl}/feedback/${id}/status`)
    if (!response.ok) return null
    const data = await response.json()
    return data.status
  } catch {
    return null
  }
}

async function renderStatusList(): Promise<void> {
  const listEl = document.getElementById('feedback-status-list')
  if (!listEl) return

  const submissions = getStoredSubmissions()

  if (submissions.length === 0) {
    listEl.innerHTML = '<div class="feedback-status-empty">No submissions yet</div>'
    return
  }

  // Fetch status for all submissions in parallel
  const statuses = await Promise.all(
    submissions.map(sub => fetchFeedbackStatus(sub.id))
  )

  listEl.innerHTML = submissions.map((sub, i) => {
    const status = statuses[i]
    const badgeClass = getStatusBadgeClass(status)
    const statusText = getStatusText(status)
    const issueUrl = status?.githubIssueUrl

    return `
      <div class="feedback-status-item">
        <div class="feedback-status-item-header">
          <span class="feedback-status-badge ${badgeClass}">${statusText}</span>
          <span class="feedback-status-time">${formatTimeAgo(sub.timestamp)}</span>
        </div>
        <div class="feedback-status-item-body">
          <span class="feedback-status-type-icon">${getTypeIcon(sub.type)}</span>
          <span class="feedback-status-description">${escapeHtml(sub.description.slice(0, 80))}${sub.description.length > 80 ? '...' : ''}</span>
        </div>
        ${status?.fixerMessage ? `<div class="feedback-status-message">${escapeHtml(status.fixerMessage)}</div>` : ''}
        ${issueUrl ? `<a class="feedback-status-link" href="${issueUrl}" target="_blank" rel="noopener">View Issue →</a>` : ''}
        <button class="feedback-status-remove" data-id="${sub.id}" title="Remove from history">×</button>
      </div>
    `
  }).join('')

  // Add click handlers for remove buttons
  listEl.querySelectorAll('.feedback-status-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id')
      if (id) {
        removeSubmission(id)
        renderStatusList()
      }
    })
  })
}

function getTypeIcon(type: FeedbackType): string {
  const icons: Record<FeedbackType, string> = {
    bug: '🐛',
    improve: '💡',
    works: '✨',
  }
  return icons[type] || '📝'
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function startStatusPolling(): void {
  if (pollInterval) return
  pollInterval = setInterval(() => {
    if (currentTab === 'status' && isFeedbackModalVisible()) {
      renderStatusList()
    }
  }, POLL_INTERVAL_MS)
}

function stopStatusPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

// ============================================================================
// Tab Management
// ============================================================================

function switchTab(tab: 'submit' | 'status'): void {
  currentTab = tab

  // Update tab buttons
  document.querySelectorAll('.feedback-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab)
  })

  // Update tab content
  const submitContent = document.getElementById('feedback-tab-submit')
  const statusContent = document.getElementById('feedback-tab-status')

  if (submitContent) submitContent.classList.toggle('hidden', tab !== 'submit')
  if (statusContent) statusContent.classList.toggle('hidden', tab !== 'status')

  // Render status list when switching to status tab
  if (tab === 'status') {
    renderStatusList()
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the feedback modal with dependencies
 */
export function setupFeedbackModal(ctx: FeedbackModalContext): void {
  context = ctx

  const modal = document.getElementById('feedback-modal')
  const feedbackBtn = document.getElementById('feedback-btn')
  const cancelBtn = document.getElementById('feedback-cancel')
  const submitBtn = document.getElementById('feedback-submit')
  const statusCloseBtn = document.getElementById('feedback-status-close')

  // Open modal on button click
  feedbackBtn?.addEventListener('click', () => {
    showFeedbackModal()
  })

  // Cancel button
  cancelBtn?.addEventListener('click', () => {
    hideFeedbackModal()
  })

  // Status close button
  statusCloseBtn?.addEventListener('click', () => {
    hideFeedbackModal()
  })

  // Submit button
  submitBtn?.addEventListener('click', () => {
    submitFeedback()
  })

  // Tab switching
  document.querySelectorAll('.feedback-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab') as 'submit' | 'status'
      if (tabName) switchTab(tabName)
    })
  })

  // Click outside to close
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideFeedbackModal()
    }
  })

  // Escape to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFeedbackModalVisible()) {
      hideFeedbackModal()
    }
  })

  // F key to open feedback (when not in input)
  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input/textarea
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return
    }

    if (e.key === 'f' || e.key === 'F') {
      if (!isFeedbackModalVisible()) {
        e.preventDefault()
        showFeedbackModal()
      }
    }
  })

  // Initialize status count
  updateStatusCount()

  // Start polling when modal is open
  startStatusPolling()
}

/**
 * Show the feedback modal
 */
export async function showFeedbackModal(): Promise<void> {
  const modal = document.getElementById('feedback-modal')
  const description = document.getElementById('feedback-description') as HTMLTextAreaElement

  if (!modal) return

  // Capture screenshot before showing modal (so modal isn't in screenshot)
  try {
    capturedScreenshot = await captureScreenshot()
  } catch (e) {
    console.error('Failed to capture screenshot:', e)
    capturedScreenshot = null
  }

  // Reset form
  const worksRadio = document.querySelector('input[name="feedback-type"][value="works"]') as HTMLInputElement
  if (worksRadio) worksRadio.checked = true
  if (description) description.value = ''

  // Reset submit button state
  setSubmitLoading(false)

  // Show on submit tab
  switchTab('submit')

  // Show modal
  modal.classList.add('visible')

  // Focus description
  description?.focus()
}

/**
 * Hide the feedback modal
 */
export function hideFeedbackModal(): void {
  const modal = document.getElementById('feedback-modal')
  modal?.classList.remove('visible')
  capturedScreenshot = null
  isSubmitting = false
}

/**
 * Check if feedback modal is currently shown
 */
export function isFeedbackModalVisible(): boolean {
  const modal = document.getElementById('feedback-modal')
  return modal?.classList.contains('visible') ?? false
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Capture a screenshot of the app
 */
async function captureScreenshot(): Promise<string> {
  const app = document.getElementById('app')
  if (!app) {
    throw new Error('App element not found')
  }

  const canvas = await html2canvas(app, {
    backgroundColor: '#0f172a',
    scale: 1, // Use 1x scale to reduce file size
    logging: false,
    useCORS: true,
    allowTaint: true,
    // Ignore elements that might cause issues
    ignoreElements: (element) => {
      // Ignore any video/canvas elements that might cause issues
      return element.tagName === 'VIDEO'
    },
  })

  return canvas.toDataURL('image/png')
}

/**
 * Set the submit button loading state
 */
function setSubmitLoading(loading: boolean): void {
  const submitBtn = document.getElementById('feedback-submit') as HTMLButtonElement
  const submitText = document.getElementById('feedback-submit-text')
  const submitSpinner = document.getElementById('feedback-submit-spinner')

  if (submitBtn) submitBtn.disabled = loading
  if (submitText) submitText.textContent = loading ? 'Sending...' : 'Send Feedback'
  if (submitSpinner) submitSpinner.classList.toggle('hidden', !loading)

  isSubmitting = loading
}

/**
 * Submit the feedback to the API
 */
async function submitFeedback(): Promise<void> {
  if (!context || isSubmitting) return

  const descriptionInput = document.getElementById('feedback-description') as HTMLTextAreaElement
  const description = descriptionInput?.value.trim()

  // Validate
  if (!description) {
    toast.warning('Please enter a description', { icon: '!' })
    descriptionInput?.focus()
    return
  }

  // Get selected type
  const typeRadio = document.querySelector('input[name="feedback-type"]:checked') as HTMLInputElement
  const type = (typeRadio?.value || 'works') as FeedbackType

  setSubmitLoading(true)

  try {
    // Gather context
    const input: CreateFeedbackInput = {
      type,
      description,
      sessionId: context.getActiveSessionId() || undefined,
      sessionName: context.getActiveSessionName() || undefined,
      sessionStatus: context.getActiveSessionStatus() || undefined,
      recentEvents: context.getRecentEvents(),
      consoleErrors: [...consoleErrors],
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      userAgent: navigator.userAgent,
      screenshot: capturedScreenshot || undefined,
    }

    // Send to API
    const response = await fetch(`${context.apiUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to submit feedback')
    }

    const result = await response.json()
    const feedbackId = result.feedback?.id

    // Save to localStorage for status tracking
    if (feedbackId) {
      saveSubmission({
        id: feedbackId,
        timestamp: Date.now(),
        description,
        type,
      })
    }

    // Show appropriate success message based on type
    const messages: Record<FeedbackType, string> = {
      bug: 'Bug report submitted. Track status in the Status tab.',
      improve: 'Suggestion submitted. Track status in the Status tab.',
      works: 'Thanks for letting us know what works!',
    }
    toast.success(messages[type], { icon: '✓', duration: 4000 })

    // Switch to status tab to show the new submission
    switchTab('status')

  } catch (e) {
    console.error('Failed to submit feedback:', e)
    toast.error('Failed to submit feedback. Please try again.', { icon: '✕' })
    setSubmitLoading(false)
  }
}
