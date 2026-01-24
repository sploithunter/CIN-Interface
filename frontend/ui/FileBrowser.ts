/**
 * FileBrowser - File explorer modal for directory selection
 *
 * Provides a Finder/Explorer-like interface for browsing and selecting directories.
 */

// Injected by Vite at build time
declare const __CIN_DEFAULT_PORT__: number
const API_PORT = __CIN_DEFAULT_PORT__
const API_URL = `http://localhost:${API_PORT}`

interface BrowseItem {
  name: string
  path: string
  isDirectory: boolean
}

interface BrowseResult {
  ok: boolean
  path: string
  parent: string | null
  items: BrowseItem[]
  error?: string
}

type SelectCallback = (path: string) => void

let modalElement: HTMLElement | null = null
let currentPath = ''
let onSelectCallback: SelectCallback | null = null

/**
 * Open the file browser modal
 */
export function openFileBrowser(initialPath?: string, onSelect?: SelectCallback): void {
  onSelectCallback = onSelect || null
  currentPath = initialPath || ''

  if (!modalElement) {
    createModal()
  }

  modalElement!.classList.add('visible')

  // Start browsing from initial path or home
  browseTo(initialPath || '~')
}

/**
 * Close the file browser modal
 */
export function closeFileBrowser(): void {
  modalElement?.classList.remove('visible')
  onSelectCallback = null
}

function createModal(): void {
  modalElement = document.createElement('div')
  modalElement.id = 'file-browser-modal'
  modalElement.className = 'file-browser-modal'
  modalElement.innerHTML = `
    <div class="file-browser-content modal-content">
      <div class="file-browser-header">
        <div class="file-browser-nav">
          <button class="file-browser-nav-btn" id="fb-nav-up" title="Go up">
            <span>⬆</span>
          </button>
          <button class="file-browser-nav-btn" id="fb-nav-home" title="Home">
            <span>🏠</span>
          </button>
        </div>
        <div class="file-browser-path" id="fb-current-path">/</div>
        <button class="file-browser-close" id="fb-close">&times;</button>
      </div>
      <div class="file-browser-list" id="fb-list">
        <div class="file-browser-loading">Loading...</div>
      </div>
      <div class="file-browser-footer">
        <div class="file-browser-selected">
          <span class="file-browser-selected-label">Selected:</span>
          <span class="file-browser-selected-path" id="fb-selected-path">-</span>
        </div>
        <div class="file-browser-actions">
          <button class="modal-btn modal-btn-cancel" id="fb-cancel">Cancel</button>
          <button class="modal-btn modal-btn-create" id="fb-select">Select</button>
        </div>
      </div>
    </div>
  `

  // Add styles
  const style = document.createElement('style')
  style.textContent = `
    .file-browser-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1100;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s, visibility 0.2s;
    }

    .file-browser-modal.visible {
      opacity: 1;
      visibility: visible;
    }

    .file-browser-content {
      width: 500px;
      max-width: 90vw;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
    }

    .file-browser-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 0;
    }

    .file-browser-nav {
      display: flex;
      gap: 4px;
    }

    .file-browser-nav-btn {
      width: 32px;
      height: 32px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .file-browser-nav-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .file-browser-nav-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .file-browser-path {
      flex: 1;
      font-family: ui-monospace, monospace;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      direction: rtl;
      text-align: left;
    }

    .file-browser-close {
      width: 32px;
      height: 32px;
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.5);
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.15s;
    }

    .file-browser-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .file-browser-list {
      flex: 1;
      overflow-y: auto;
      min-height: 200px;
      max-height: 350px;
      margin: 16px 0;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.2);
    }

    .file-browser-loading {
      padding: 40px;
      text-align: center;
      color: rgba(255, 255, 255, 0.4);
    }

    .file-browser-error {
      padding: 40px;
      text-align: center;
      color: #f87171;
    }

    .file-browser-empty {
      padding: 40px;
      text-align: center;
      color: rgba(255, 255, 255, 0.4);
    }

    .file-browser-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
      transition: background 0.1s;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .file-browser-item:last-child {
      border-bottom: none;
    }

    .file-browser-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .file-browser-item.selected {
      background: rgba(74, 222, 128, 0.15);
    }

    .file-browser-item-icon {
      font-size: 18px;
      width: 24px;
      text-align: center;
    }

    .file-browser-item-name {
      flex: 1;
      font-size: 14px;
      color: #fff;
    }

    .file-browser-item.is-file .file-browser-item-name {
      color: rgba(255, 255, 255, 0.5);
    }

    .file-browser-item-arrow {
      color: rgba(255, 255, 255, 0.3);
      font-size: 12px;
    }

    .file-browser-footer {
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .file-browser-selected {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .file-browser-selected-label {
      color: rgba(255, 255, 255, 0.5);
    }

    .file-browser-selected-path {
      color: #4ade80;
      font-family: ui-monospace, monospace;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .file-browser-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
  `
  document.head.appendChild(style)
  document.body.appendChild(modalElement)

  // Event listeners
  modalElement.querySelector('#fb-close')?.addEventListener('click', closeFileBrowser)
  modalElement.querySelector('#fb-cancel')?.addEventListener('click', closeFileBrowser)
  modalElement.querySelector('#fb-select')?.addEventListener('click', handleSelect)
  modalElement.querySelector('#fb-nav-up')?.addEventListener('click', handleNavUp)
  modalElement.querySelector('#fb-nav-home')?.addEventListener('click', handleNavHome)
  modalElement.querySelector('#fb-list')?.addEventListener('click', handleItemClick)
  modalElement.querySelector('#fb-list')?.addEventListener('dblclick', handleItemDblClick)

  // Close on backdrop click
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      closeFileBrowser()
    }
  })

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalElement?.classList.contains('visible')) {
      closeFileBrowser()
    }
  })
}

async function browseTo(path: string): Promise<void> {
  const listEl = document.getElementById('fb-list')
  const pathEl = document.getElementById('fb-current-path')
  const upBtn = document.getElementById('fb-nav-up') as HTMLButtonElement

  if (!listEl) return

  // Show loading
  listEl.innerHTML = '<div class="file-browser-loading">Loading...</div>'

  try {
    const response = await fetch(`${API_URL}/browse?path=${encodeURIComponent(path)}`)
    const data: BrowseResult = await response.json()

    if (!data.ok) {
      listEl.innerHTML = `<div class="file-browser-error">${escapeHtml(data.error || 'Failed to browse')}</div>`
      return
    }

    currentPath = data.path
    if (pathEl) pathEl.textContent = data.path
    if (upBtn) upBtn.disabled = data.parent === null

    // Update selected path display
    updateSelectedPath(data.path)

    // Filter to only show directories (for directory selection)
    const directories = data.items.filter(item => item.isDirectory)

    if (directories.length === 0) {
      listEl.innerHTML = '<div class="file-browser-empty">No subdirectories</div>'
      return
    }

    listEl.innerHTML = directories.map(item => `
      <div class="file-browser-item" data-path="${escapeHtml(item.path)}">
        <span class="file-browser-item-icon">📁</span>
        <span class="file-browser-item-name">${escapeHtml(item.name)}</span>
        <span class="file-browser-item-arrow">›</span>
      </div>
    `).join('')

  } catch (e) {
    listEl.innerHTML = `<div class="file-browser-error">Error: ${escapeHtml((e as Error).message)}</div>`
  }
}

function handleNavUp(): void {
  const pathEl = document.getElementById('fb-current-path')
  if (!pathEl || !currentPath) return

  // Go to parent directory
  const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
  browseTo(parent)
}

function handleNavHome(): void {
  browseTo('~')
}

function handleItemClick(e: Event): void {
  const target = e.target as HTMLElement
  const item = target.closest('.file-browser-item') as HTMLElement

  if (!item) return

  // Remove selection from all items
  document.querySelectorAll('.file-browser-item.selected').forEach(el => {
    el.classList.remove('selected')
  })

  // Select this item
  item.classList.add('selected')

  // Update selected path
  const path = item.dataset.path
  if (path) {
    updateSelectedPath(path)
  }
}

function handleItemDblClick(e: Event): void {
  const target = e.target as HTMLElement
  const item = target.closest('.file-browser-item') as HTMLElement

  if (!item) return

  const path = item.dataset.path
  if (path) {
    // Navigate into directory
    browseTo(path)
  }
}

function handleSelect(): void {
  const selectedEl = document.querySelector('.file-browser-item.selected') as HTMLElement
  const path = selectedEl?.dataset.path || currentPath

  if (path && onSelectCallback) {
    onSelectCallback(path)
  }

  closeFileBrowser()
}

function updateSelectedPath(path: string): void {
  const el = document.getElementById('fb-selected-path')
  if (el) {
    el.textContent = path
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
