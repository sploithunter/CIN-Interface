/**
 * Issue Creator Agent
 *
 * Polls the feedback API for unprocessed feedback and spawns Claude Code
 * sessions via CIN-Interface to create GitHub issues.
 *
 * Flow:
 * 1. Poll GET /feedback/unprocessed
 * 2. For each feedback, create a session via CIN-Interface API
 * 3. Send a prompt to create a GitHub issue
 * 4. Mark feedback as processed with the issue URL
 *
 * Usage:
 *   npm run agent:issues -- --cwd /path/to/project
 */

import { homedir } from 'os'
import { join } from 'path'
import { WebSocket } from 'ws'

interface Feedback {
  id: string
  type: 'bug' | 'improve' | 'works'
  description: string
  timestamp: number
  sessionId?: string
  sessionName?: string
  sessionStatus?: string
  consoleErrors?: string[]
  recentEvents?: string[]
  viewportWidth: number
  viewportHeight: number
  userAgent: string
  screenshotPath?: string
  processed: boolean
  githubIssueNumber?: number
  githubIssueUrl?: string
}

interface CINSession {
  id: string
  name: string
  status: string
  tmuxSession?: string
}

interface IssueCreatorConfig {
  apiUrl: string           // CIN-Interface API URL (includes feedback + sessions)
  projectCwd: string
  pollIntervalMs: number
  maxConcurrentSessions: number
  debug: boolean
}

const DEFAULT_CONFIG: IssueCreatorConfig = {
  apiUrl: 'http://localhost:4003',
  projectCwd: process.cwd(),
  pollIntervalMs: 10000, // 10 seconds
  maxConcurrentSessions: 1, // Process one at a time to avoid conflicts
  debug: false,
}

class IssueCreatorAgent {
  private config: IssueCreatorConfig
  private activeSessions: Map<string, string> = new Map() // feedbackId -> sessionId
  private sessionToFeedback: Map<string, string> = new Map() // sessionId -> feedbackId
  private sessionTmux: Map<string, string> = new Map() // sessionId -> tmuxSessionName
  private running = false
  private ws: WebSocket | null = null
  private sessionCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<IssueCreatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Connect to CIN-Interface WebSocket for real-time events
   */
  private connectWebSocket(): void {
    const wsUrl = this.config.apiUrl.replace('http', 'ws')
    this.log('Connecting to WebSocket:', wsUrl)

    // Must provide origin header or connection will be rejected
    this.ws = new WebSocket(wsUrl, {
      headers: {
        origin: this.config.apiUrl,
      },
    })

    this.ws.on('open', () => {
      this.log('WebSocket connected')
    })

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        this.handleWebSocketMessage(message)
      } catch (err) {
        this.log('Failed to parse WebSocket message:', err)
      }
    })

    this.ws.on('close', () => {
      this.log('WebSocket disconnected, reconnecting in 5s...')
      if (this.running) {
        setTimeout(() => this.connectWebSocket(), 5000)
      }
    })

    this.ws.on('error', (err) => {
      this.log('WebSocket error:', err)
    })

    // Keep-alive ping
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleWebSocketMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; data?: unknown }

    if (msg.type === 'event') {
      const event = msg.data as { type: string; sessionId?: string; response?: string }

      if (event.type === 'stop' && event.sessionId) {
        await this.handleSessionComplete(event.sessionId, event.response)
      }
    }
  }

  /**
   * Capture output from a tmux session
   */
  private async captureTmuxOutput(tmuxSession: string): Promise<string | null> {
    try {
      const { execSync } = await import('child_process')
      const output = execSync(`tmux capture-pane -t ${tmuxSession} -p -S -200`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      return output
    } catch {
      return null
    }
  }

  /**
   * Check active sessions periodically (fallback for WebSocket)
   */
  private async checkActiveSessions(): Promise<void> {
    if (this.activeSessions.size === 0) return

    for (const [feedbackId, sessionId] of this.activeSessions.entries()) {
      try {
        const result = await this.fetchJson<{ ok: boolean; session: CINSession }>(
          `${this.config.apiUrl}/sessions/${sessionId}`
        )

        // If session is idle/waiting, it's done working
        if (result.session.status === 'idle' || result.session.status === 'waiting') {
          this.log(`Session ${sessionId} is idle, checking for completion...`)

          // Get tmux output to find ISSUE_URL
          const tmuxSession = this.sessionTmux.get(sessionId)
          let response: string | undefined
          if (tmuxSession) {
            const output = await this.captureTmuxOutput(tmuxSession)
            if (output) response = output
          }

          // Check if ISSUE_URL is in the output (indicates completion)
          if (response && response.includes('ISSUE_URL:')) {
            await this.handleSessionComplete(sessionId, response)
          }
        }
      } catch {
        // Session might have been deleted or doesn't exist - clean up our tracking
        this.log(`Session ${sessionId} not found, cleaning up tracking`)
        this.activeSessions.delete(feedbackId)
        this.sessionToFeedback.delete(sessionId)
        this.sessionTmux.delete(sessionId)
      }
    }
  }

  /**
   * Handle session completion - parse output, mark processed, cleanup
   */
  private async handleSessionComplete(sessionId: string, response?: string): Promise<void> {
    const feedbackId = this.sessionToFeedback.get(sessionId)
    if (!feedbackId) {
      this.log('Unknown session completed:', sessionId)
      return
    }

    console.log(`\n✅ Session ${sessionId} completed`)

    // Parse issue URL from response (or tmux output)
    let issueUrl: string | null = null
    let issueNumber: number | null = null

    // If no response from WebSocket, try to capture from tmux
    if (!response) {
      const tmuxSession = this.sessionTmux.get(sessionId)
      if (tmuxSession) {
        response = (await this.captureTmuxOutput(tmuxSession)) || undefined
      }
    }

    if (response) {
      // Find all ISSUE_URL matches and take the last one (to skip the example in the prompt)
      const urlMatches = [...response.matchAll(/ISSUE_URL:\s*(https:\/\/github\.com\/[^\s]+\/issues\/(\d+))/g)]
      if (urlMatches.length > 0) {
        const lastMatch = urlMatches[urlMatches.length - 1]
        issueUrl = lastMatch[1]
        issueNumber = parseInt(lastMatch[2], 10)
        console.log(`   📎 Created issue: ${issueUrl}`)
      }
    }

    // Mark feedback as processed
    if (issueUrl && issueNumber) {
      try {
        await this.markProcessed(feedbackId, issueNumber, issueUrl)
        console.log(`   ✓ Feedback ${feedbackId} marked as processed`)
      } catch (err) {
        console.error(`   ✗ Failed to mark feedback as processed:`, err)
      }
    }

    // Clean up the session
    try {
      await this.deleteSession(sessionId)
      console.log(`   🧹 Session cleaned up`)
    } catch (err) {
      this.log('Failed to delete session:', err)
    }

    // Remove from tracking maps
    this.activeSessions.delete(feedbackId)
    this.sessionToFeedback.delete(sessionId)
    this.sessionTmux.delete(sessionId)
  }

  private log(...args: unknown[]) {
    if (this.config.debug) {
      console.log('[IssueCreator]', ...args)
    }
  }

  private async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Get all unprocessed feedback from the API
   */
  async getUnprocessedFeedback(): Promise<Feedback[]> {
    const result = await this.fetchJson<{ ok: boolean; feedback: Feedback[] }>(
      `${this.config.apiUrl}/feedback/unprocessed`
    )
    return result.feedback
  }

  /**
   * Mark feedback as processed with GitHub issue info
   */
  async markProcessed(
    feedbackId: string,
    githubIssueNumber: number,
    githubIssueUrl: string
  ): Promise<void> {
    await this.fetchJson(`${this.config.apiUrl}/feedback/${feedbackId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        processed: true,
        githubIssueNumber,
        githubIssueUrl,
      }),
    })
  }

  /**
   * Create a Claude Code session via CIN-Interface
   */
  async createSession(name: string): Promise<CINSession> {
    const result = await this.fetchJson<{ ok: boolean; session: CINSession }>(
      `${this.config.apiUrl}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          cwd: this.config.projectCwd,
          agent: 'claude',
        }),
      }
    )
    return result.session
  }

  /**
   * Send a prompt to a CIN-Interface session
   */
  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.fetchJson(`${this.config.apiUrl}/sessions/${sessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
  }

  /**
   * Delete a CIN-Interface session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await fetch(`${this.config.apiUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
    })
  }

  /**
   * Build the prompt for creating a GitHub issue from feedback
   */
  buildIssuePrompt(feedback: Feedback): string {
    const typeLabels: Record<Feedback['type'], string> = {
      bug: 'bug',
      improve: 'enhancement',
      works: 'feedback',
    }

    const typeEmojis: Record<Feedback['type'], string> = {
      bug: '🐛',
      improve: '💡',
      works: '❤️',
    }

    const label = typeLabels[feedback.type]
    const emoji = typeEmojis[feedback.type]

    let context = ''
    if (feedback.sessionName) {
      context += `\n- Session: ${feedback.sessionName}`
    }
    if (feedback.sessionStatus) {
      context += `\n- Session status: ${feedback.sessionStatus}`
    }
    if (feedback.consoleErrors && feedback.consoleErrors.length > 0) {
      context += `\n- Console errors: ${feedback.consoleErrors.slice(0, 5).join(', ')}`
    }
    if (feedback.recentEvents && feedback.recentEvents.length > 0) {
      context += `\n- Recent events: ${feedback.recentEvents.join(', ')}`
    }
    if (feedback.viewportWidth && feedback.viewportHeight) {
      context += `\n- Viewport: ${feedback.viewportWidth}x${feedback.viewportHeight}`
    }
    if (feedback.userAgent) {
      context += `\n- Browser: ${feedback.userAgent}`
    }

    const screenshotNote = feedback.screenshotPath
      ? `\n\nA screenshot was captured and saved at: ${feedback.screenshotPath}`
      : ''

    return `Create a GitHub issue for the following user feedback. Use the gh CLI to create the issue.

**Feedback Type:** ${emoji} ${feedback.type}
**Description:** ${feedback.description}
**Context:**${context}${screenshotNote}

**Submitted:** ${new Date(feedback.timestamp).toISOString()}
**Feedback ID:** ${feedback.id}

Instructions:
1. Create a clear, descriptive issue title based on the feedback
2. Write a well-formatted issue body that includes:
   - A summary of the reported ${feedback.type}
   - The technical context (session, viewport, browser)
   - Any console errors if present
   - Reference to the feedback ID for tracking
3. Add the label "${label}" to the issue
4. After creating the issue, output ONLY the issue URL on a single line starting with "ISSUE_URL:"

Example output format:
ISSUE_URL: https://github.com/owner/repo/issues/123

Do not ask for confirmation, just create the issue.`
  }

  /**
   * Process a single feedback item
   */
  async processFeedback(feedback: Feedback): Promise<void> {
    console.log(`\n📋 Processing feedback ${feedback.id} (${feedback.type})`)
    console.log(`   "${feedback.description.substring(0, 60)}..."`)

    // Create a session for this feedback
    const sessionName = `issue-${feedback.id.substring(0, 8)}`

    try {
      // Create CIN-Interface session
      console.log(`   🚀 Spawning Claude Code session...`)
      const session = await this.createSession(sessionName)
      this.activeSessions.set(feedback.id, session.id)
      this.sessionToFeedback.set(session.id, feedback.id) // Reverse mapping for WebSocket events
      if (session.tmuxSession) {
        this.sessionTmux.set(session.id, session.tmuxSession)
      }
      this.log('Session created:', session.id)

      // Wait for session to be ready
      await this.waitForSessionReady(session.id)

      // Send the prompt to create the issue
      console.log(`   📝 Sending issue creation prompt...`)
      const prompt = this.buildIssuePrompt(feedback)
      await this.sendPrompt(session.id, prompt)

      console.log(`   ✅ Prompt sent - agent is working on creating the issue`)
      console.log(`   ℹ️  Session will auto-cleanup when complete`)

    } catch (error) {
      console.error(`   ❌ Error processing feedback:`, error)
      throw error
    }
  }

  /**
   * Wait for a session to be ready (idle status)
   */
  async waitForSessionReady(sessionId: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now()

    // Initial delay to let Claude Code fully start up
    this.log('Waiting 5s for Claude Code to initialize...')
    await new Promise((resolve) => setTimeout(resolve, 5000))

    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.fetchJson<{ ok: boolean; session: CINSession }>(
          `${this.config.apiUrl}/sessions/${sessionId}`
        )

        this.log(`Session ${sessionId} status: ${result.session.status}`)

        // Session is ready when idle or waiting for input
        if (result.session.status === 'idle' || result.session.status === 'waiting') {
          this.log('Session is ready')
          return
        }
      } catch (err) {
        this.log('Session check error:', err)
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Even if we timeout, continue - the session should still work
    console.log(`   ⚠️  Session ready wait timed out, attempting to send prompt anyway`)
  }

  /**
   * Run one poll cycle
   */
  async poll(): Promise<void> {
    try {
      const feedback = await this.getUnprocessedFeedback()

      if (feedback.length === 0) {
        this.log('No unprocessed feedback')
        return
      }

      console.log(`\n📬 Found ${feedback.length} unprocessed feedback item(s)`)

      // Process up to maxConcurrentSessions at a time
      const toProcess = feedback.slice(0, this.config.maxConcurrentSessions)

      for (const item of toProcess) {
        // Skip if we're already processing this one
        if (this.activeSessions.has(item.id)) {
          this.log(`Already processing ${item.id}`)
          continue
        }

        await this.processFeedback(item)
      }
    } catch (error) {
      console.error('Poll error:', error)
    }
  }

  /**
   * Start the agent polling loop
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Agent is already running')
      return
    }

    console.log('🤖 Issue Creator Agent started')
    console.log(`   CIN-Interface API: ${this.config.apiUrl}`)
    console.log(`   Project: ${this.config.projectCwd}`)
    console.log(`   Poll interval: ${this.config.pollIntervalMs}ms`)
    console.log('')

    this.running = true

    // Connect to CIN-Interface WebSocket for session completion events
    this.connectWebSocket()

    // Start session status polling (fallback for unreliable WebSocket)
    this.sessionCheckInterval = setInterval(() => {
      this.checkActiveSessions().catch(err => this.log('Session check error:', err))
    }, 5000) // Check every 5 seconds

    // Initial poll
    await this.poll()

    // Start polling loop
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs))
      await this.poll()
    }
  }

  /**
   * Stop the agent
   */
  stop(): void {
    console.log('\n🛑 Stopping Issue Creator Agent...')
    this.running = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval)
      this.sessionCheckInterval = null
    }
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)
  const config: Partial<IssueCreatorConfig> = {}

  // Parse CLI arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--api-url':
        config.apiUrl = args[++i]
        break
      case '--cwd':
        config.projectCwd = args[++i]
        break
      case '--poll-interval':
        config.pollIntervalMs = parseInt(args[++i], 10)
        break
      case '--debug':
        config.debug = true
        break
      case '--help':
        console.log(`
Issue Creator Agent - Creates GitHub issues from feedback via Claude Code

Usage: npm run agent:issues [options]

Options:
  --api-url <url>         CIN-Interface API URL (default: http://localhost:4003)
  --cwd <path>            Project working directory (default: current dir)
  --poll-interval <ms>    Poll interval in ms (default: 10000)
  --debug                 Enable debug logging
  --help                  Show this help

Example:
  npm run agent:issues -- --cwd /path/to/my-project
`)
        process.exit(0)
    }
  }

  const agent = new IssueCreatorAgent(config)

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    agent.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    agent.stop()
    process.exit(0)
  })

  await agent.start()
}

export { IssueCreatorAgent, IssueCreatorConfig }

// Run if executed directly
main().catch(console.error)
