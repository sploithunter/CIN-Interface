/**
 * Slash Commands - Autocomplete for Claude Code commands
 *
 * Provides autocomplete suggestions when user types "/" in the prompt input.
 * Commands are sent directly to Claude Code via tmux.
 */

// Known Claude Code slash commands
export const SLASH_COMMANDS = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation to save context' },
  { command: '/config', description: 'View/edit configuration' },
  { command: '/cost', description: 'Show token usage and cost' },
  { command: '/doctor', description: 'Run diagnostics' },
  { command: '/help', description: 'Show help' },
  { command: '/init', description: 'Initialize CLAUDE.md' },
  { command: '/login', description: 'Login to Anthropic' },
  { command: '/logout', description: 'Logout from Anthropic' },
  { command: '/memory', description: 'Edit CLAUDE.md memory' },
  { command: '/model', description: 'Switch model' },
  { command: '/permissions', description: 'View/edit permissions' },
  { command: '/pr-comments', description: 'View PR comments' },
  { command: '/review', description: 'Request code review' },
  { command: '/status', description: 'Show status' },
  { command: '/terminal-setup', description: 'Setup terminal integration' },
  { command: '/vim', description: 'Toggle vim mode' },
] as const

export type SlashCommand = typeof SLASH_COMMANDS[number]

/**
 * Setup slash command autocomplete on a textarea
 */
export function setupSlashCommands(
  input: HTMLTextAreaElement,
  onSelect?: (command: string) => void
): () => void {
  let dropdown: HTMLElement | null = null
  let selectedIndex = 0
  let filteredCommands: SlashCommand[] = []

  const createDropdown = () => {
    if (dropdown) return dropdown

    dropdown = document.createElement('div')
    dropdown.className = 'slash-commands-dropdown'
    dropdown.style.cssText = `
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: rgba(20, 20, 25, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      margin-bottom: 4px;
      display: none;
      z-index: 1000;
      backdrop-filter: blur(8px);
    `
    input.parentElement?.style.setProperty('position', 'relative')
    input.parentElement?.appendChild(dropdown)
    return dropdown
  }

  const renderDropdown = () => {
    const dd = createDropdown()
    if (filteredCommands.length === 0) {
      dd.style.display = 'none'
      return
    }

    dd.innerHTML = filteredCommands.map((cmd, i) => `
      <div class="slash-command-item${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
        <span class="slash-command-name">${cmd.command}</span>
        <span class="slash-command-desc">${cmd.description}</span>
      </div>
    `).join('')

    // Add inline styles for items
    dd.querySelectorAll('.slash-command-item').forEach((item) => {
      const el = item as HTMLElement
      el.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      `
      if (el.classList.contains('selected')) {
        el.style.background = 'rgba(167, 139, 250, 0.2)'
      }
    })

    dd.querySelectorAll('.slash-command-name').forEach((el) => {
      (el as HTMLElement).style.cssText = `
        color: #a78bfa;
        font-family: ui-monospace, monospace;
        font-weight: 600;
      `
    })

    dd.querySelectorAll('.slash-command-desc').forEach((el) => {
      (el as HTMLElement).style.cssText = `
        color: rgba(255, 255, 255, 0.5);
        font-size: 12px;
      `
    })

    dd.style.display = 'block'

    // Scroll selected into view
    const selectedEl = dd.querySelector('.selected')
    selectedEl?.scrollIntoView({ block: 'nearest' })
  }

  const hideDropdown = () => {
    if (dropdown) {
      dropdown.style.display = 'none'
    }
    filteredCommands = []
    selectedIndex = 0
  }

  const selectCommand = (command: string) => {
    input.value = command + ' '
    input.focus()
    hideDropdown()
    onSelect?.(command)
  }

  const handleInput = () => {
    const value = input.value
    const cursorPos = input.selectionStart || 0

    // Check if we're at the start of a line with a /
    const beforeCursor = value.slice(0, cursorPos)
    const lineStart = beforeCursor.lastIndexOf('\n') + 1
    const currentLine = beforeCursor.slice(lineStart)

    if (currentLine.startsWith('/')) {
      const query = currentLine.toLowerCase()
      filteredCommands = SLASH_COMMANDS.filter(cmd =>
        cmd.command.toLowerCase().startsWith(query)
      )
      selectedIndex = 0
      renderDropdown()
    } else {
      hideDropdown()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (filteredCommands.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        selectedIndex = (selectedIndex + 1) % filteredCommands.length
        renderDropdown()
        break

      case 'ArrowUp':
        e.preventDefault()
        selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length
        renderDropdown()
        break

      case 'Tab':
      case 'Enter':
        if (filteredCommands.length > 0) {
          e.preventDefault()
          selectCommand(filteredCommands[selectedIndex].command)
        }
        break

      case 'Escape':
        hideDropdown()
        break
    }
  }

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const item = target.closest('.slash-command-item') as HTMLElement
    if (item) {
      const index = parseInt(item.dataset.index || '0', 10)
      selectCommand(filteredCommands[index].command)
    }
  }

  const handleBlur = () => {
    // Delay to allow click events to fire
    setTimeout(hideDropdown, 150)
  }

  // Attach listeners
  input.addEventListener('input', handleInput)
  input.addEventListener('keydown', handleKeydown)
  input.addEventListener('blur', handleBlur)
  createDropdown().addEventListener('click', handleClick)

  // Return cleanup function
  return () => {
    input.removeEventListener('input', handleInput)
    input.removeEventListener('keydown', handleKeydown)
    input.removeEventListener('blur', handleBlur)
    dropdown?.remove()
  }
}

/**
 * Check if a string is a slash command
 */
export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/')
}
