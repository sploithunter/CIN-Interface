/**
 * Toast - Simple toast notification system
 *
 * Shows brief, non-blocking notifications at the bottom of the screen.
 * Auto-dismisses after a configurable duration.
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  /** Toast variant for styling */
  type?: ToastType
  /** Icon to show (emoji or character) */
  icon?: string
  /** Duration in milliseconds before auto-dismiss (default: 3000) */
  duration?: number
  /** Whether to allow HTML in message (default: false) */
  html?: boolean
}

const DEFAULT_DURATION = 3000
const FADE_OUT_DURATION = 200

let container: HTMLElement | null = null

/**
 * Get or create the toast container
 */
function getContainer(): HTMLElement {
  if (!container) {
    container = document.getElementById('toast-container')
    if (!container) {
      // Create container if it doesn't exist
      container = document.createElement('div')
      container.id = 'toast-container'
      document.body.appendChild(container)
    }
  }
  return container
}

/**
 * Show a toast notification
 *
 * @param message - Text message to display (or HTML if options.html is true)
 * @param options - Toast options
 * @returns The toast element (for manual removal if needed)
 */
export function showToast(message: string, options: ToastOptions = {}): HTMLElement {
  const {
    type = 'info',
    icon,
    duration = DEFAULT_DURATION,
    html = false,
  } = options

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`

  // Build toast content
  let content = ''

  if (icon) {
    content += `<span class="toast-icon">${icon}</span>`
  }

  if (html) {
    content += `<span class="toast-message">${message}</span>`
  } else {
    content += `<span class="toast-message">${escapeHtml(message)}</span>`
  }

  toast.innerHTML = content

  // Add to container
  const toastContainer = getContainer()
  toastContainer.appendChild(toast)

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeToast(toast)
    }, duration)
  }

  return toast
}

/**
 * Remove a toast with animation
 */
export function removeToast(toast: HTMLElement): void {
  if (!toast.parentElement) return

  toast.classList.add('toast-out')
  setTimeout(() => {
    toast.remove()
  }, FADE_OUT_DURATION)
}

/**
 * Clear all toasts
 */
export function clearToasts(): void {
  const toastContainer = getContainer()
  const toasts = toastContainer.querySelectorAll('.toast')
  toasts.forEach(toast => {
    removeToast(toast as HTMLElement)
  })
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Convenience methods for common toast types
export const toast = {
  info: (message: string, options?: Omit<ToastOptions, 'type'>) =>
    showToast(message, { ...options, type: 'info' }),

  success: (message: string, options?: Omit<ToastOptions, 'type'>) =>
    showToast(message, { ...options, type: 'success' }),

  warning: (message: string, options?: Omit<ToastOptions, 'type'>) =>
    showToast(message, { ...options, type: 'warning' }),

  error: (message: string, options?: Omit<ToastOptions, 'type'>) =>
    showToast(message, { ...options, type: 'error' }),
}
