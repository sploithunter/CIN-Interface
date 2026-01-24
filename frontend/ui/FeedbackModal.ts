/**
 * Feedback Modal - User feedback submission UI
 *
 * Captures:
 * - Feedback type (bug, improve, works)
 * - Description from user
 * - Automatic screenshot via html2canvas
 * - Context: session info, recent events, console errors
 */

import html2canvas from 'html2canvas'
import { toast } from './Toast'

// ============================================================================
// Types
// ============================================================================

export type FeedbackType = 'bug' | 'improve' | 'works'

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

// ============================================================================
// State
// ============================================================================

let context: FeedbackModalContext | null = null
let isSubmitting = false
let capturedScreenshot: string | null = null

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

  // Open modal on button click
  feedbackBtn?.addEventListener('click', () => {
    showFeedbackModal()
  })

  // Cancel button
  cancelBtn?.addEventListener('click', () => {
    hideFeedbackModal()
  })

  // Submit button
  submitBtn?.addEventListener('click', () => {
    submitFeedback()
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

    // Success!
    hideFeedbackModal()

    // Show appropriate success message based on type
    const messages: Record<FeedbackType, string> = {
      bug: 'Bug report submitted. Thanks for helping improve CIN!',
      improve: 'Suggestion submitted. Thanks for your feedback!',
      works: 'Thanks for letting us know what works!',
    }
    toast.success(messages[type], { icon: '✓', duration: 4000 })

  } catch (e) {
    console.error('Failed to submit feedback:', e)
    toast.error('Failed to submit feedback. Please try again.', { icon: '✕' })
    setSubmitLoading(false)
  }
}
