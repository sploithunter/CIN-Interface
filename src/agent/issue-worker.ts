/**
 * Issue Worker - GitHub Webhook Handler
 *
 * Receives GitHub webhook events for new issues and spawns Claude Code
 * sessions via CIN-Interface to analyze and work on them.
 *
 * Setup:
 * 1. Start this server: npm run agent:webhook
 * 2. Configure GitHub webhook:
 *    - URL: http://your-server:3001/webhook/github
 *    - Content type: application/json
 *    - Secret: (optional, set GITHUB_WEBHOOK_SECRET env var)
 *    - Events: Issues
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { createHmac } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { WebSocket } from 'ws'

// Config file location - use CIN-Interface's data directory
const CONFIG_DIR = join(homedir(), '.cin-interface')
const CONFIG_FILE = join(CONFIG_DIR, 'agent-config.json')

interface AgentConfig {
  allowedUsers: string[]
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  allowedUsers: [], // Empty by default - must be configured
}

/**
 * Load agent config from file, creating default if not exists
 */
function loadAgentConfig(): AgentConfig {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }

    if (!existsSync(CONFIG_FILE)) {
      // Create default config file
      writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_AGENT_CONFIG, null, 2))
      console.log(`Created default config at ${CONFIG_FILE}`)
      return DEFAULT_AGENT_CONFIG
    }

    const content = readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(content) as AgentConfig
  } catch (error) {
    console.warn(`Warning: Could not load config from ${CONFIG_FILE}, using defaults`)
    return DEFAULT_AGENT_CONFIG
  }
}

interface GitHubIssue {
  number: number
  title: string
  body: string | null
  html_url: string
  user: { login: string }
  labels: Array<{ name: string }>
  state: string
  created_at: string
}

interface GitHubWebhookPayload {
  action: string
  issue: GitHubIssue
  repository: {
    full_name: string
    clone_url: string
    default_branch: string
  }
  sender: { login: string }
}

interface CINSession {
  id: string
  name: string
  status: string
}

interface IssueWorkerConfig {
  port: number
  apiUrl: string            // CIN-Interface API URL
  projectCwd: string
  webhookSecret?: string
  allowedUsers?: string[]    // Only process issues from these users (security whitelist)
  dangerouslyAllowAllUsers?: boolean  // Bypass user whitelist (NOT recommended)
  allowedLabels?: string[]
  ignoredLabels?: string[]
  ignoredUsers?: string[]
  autoFix: boolean
  debug: boolean
}

const DEFAULT_CONFIG: IssueWorkerConfig = {
  port: 3001,
  apiUrl: 'http://localhost:4003',
  projectCwd: process.cwd(),
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  allowedUsers: undefined,
  dangerouslyAllowAllUsers: false, // Closed by default - must explicitly allow users
  allowedLabels: undefined, // If set, only process issues with these labels
  ignoredLabels: ['wontfix', 'duplicate', 'invalid'],
  ignoredUsers: [], // Bots or users to ignore
  autoFix: false, // If true, attempt to fix. If false, just analyze and comment
  debug: false,
}

class IssueWorker {
  private config: IssueWorkerConfig
  private server: ReturnType<typeof createServer> | null = null
  private activeSessions: Map<number, string> = new Map() // issueNumber -> sessionId
  private sessionToIssue: Map<string, number> = new Map() // sessionId -> issueNumber
  private ws: WebSocket | null = null

  constructor(config: Partial<IssueWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Connect to CIN-Interface WebSocket for session completion events
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
      setTimeout(() => this.connectWebSocket(), 5000)
    })

    this.ws.on('error', (err) => {
      this.log('WebSocket error:', err)
    })

    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; data?: unknown }

    if (msg.type === 'event') {
      const event = msg.data as { type: string; sessionId?: string }

      if (event.type === 'stop' && event.sessionId) {
        await this.handleSessionComplete(event.sessionId)
      }
    }
  }

  /**
   * Handle session completion - cleanup
   */
  private async handleSessionComplete(sessionId: string): Promise<void> {
    const issueNumber = this.sessionToIssue.get(sessionId)
    if (!issueNumber) {
      this.log('Unknown session completed:', sessionId)
      return
    }

    console.log(`\n✅ Session for issue #${issueNumber} completed`)

    try {
      await this.deleteSession(sessionId)
      console.log(`   🧹 Session cleaned up`)
    } catch (err) {
      this.log('Failed to delete session:', err)
    }

    this.activeSessions.delete(issueNumber)
    this.sessionToIssue.delete(sessionId)
  }

  /**
   * Delete a CIN-Interface session
   */
  private async deleteSession(sessionId: string): Promise<void> {
    await fetch(`${this.config.apiUrl}/sessions/${sessionId}`, {
      method: 'DELETE',
    })
  }

  private log(...args: unknown[]) {
    if (this.config.debug) {
      console.log('[IssueWorker]', ...args)
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
   * Verify GitHub webhook signature
   */
  private verifySignature(payload: string, signature: string | undefined): boolean {
    if (!this.config.webhookSecret) {
      return true // No secret configured, skip verification
    }

    if (!signature) {
      return false
    }

    const expectedSig = 'sha256=' + createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex')

    return signature === expectedSig
  }

  /**
   * Check if an issue should be processed
   */
  private shouldProcessIssue(issue: GitHubIssue, sender: string): boolean {
    // SECURITY: Check allowed users whitelist (closed by default)
    // This is a critical security check - only trusted users can trigger agents
    if (!this.config.dangerouslyAllowAllUsers) {
      if (!this.config.allowedUsers || this.config.allowedUsers.length === 0) {
        // No users configured and not dangerously allowing all - reject everything
        this.log(`Rejecting issue - no allowed users configured`)
        return false
      }
      if (!this.config.allowedUsers.includes(issue.user.login)) {
        this.log(`Rejecting issue from untrusted user: ${issue.user.login}`)
        return false
      }
    }

    // Check ignored users
    if (this.config.ignoredUsers?.includes(sender)) {
      this.log(`Ignoring issue from user: ${sender}`)
      return false
    }

    if (this.config.ignoredUsers?.includes(issue.user.login)) {
      this.log(`Ignoring issue created by: ${issue.user.login}`)
      return false
    }

    // Check ignored labels
    const issueLabels = issue.labels.map(l => l.name)
    if (this.config.ignoredLabels?.some(label => issueLabels.includes(label))) {
      this.log(`Ignoring issue with ignored label`)
      return false
    }

    // Check allowed labels (if configured)
    if (this.config.allowedLabels && this.config.allowedLabels.length > 0) {
      if (!this.config.allowedLabels.some(label => issueLabels.includes(label))) {
        this.log(`Ignoring issue without allowed label`)
        return false
      }
    }

    // Don't process if already being worked on
    if (this.activeSessions.has(issue.number)) {
      this.log(`Issue #${issue.number} already being processed`)
      return false
    }

    return true
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
   * Build the prompt for working on an issue
   */
  buildIssuePrompt(issue: GitHubIssue, repoFullName: string): string {
    const labels = issue.labels.map(l => l.name).join(', ') || 'none'

    if (this.config.autoFix) {
      return `A new GitHub issue has been created that needs to be addressed.

**Issue #${issue.number}: ${issue.title}**
**Repository:** ${repoFullName}
**Labels:** ${labels}
**Created by:** ${issue.user.login}
**URL:** ${issue.html_url}

**Description:**
${issue.body || '(No description provided)'}

---

Instructions:
1. Analyze the issue and understand what needs to be done
2. Search the codebase to find relevant files
3. Implement a fix or feature as described
4. Create a new branch named "fix/issue-${issue.number}" or "feature/issue-${issue.number}"
5. Commit your changes with a message referencing the issue (e.g., "Fix #${issue.number}: ...")
6. After completing the work, summarize what you did

Do not push or create a PR - just make the local changes. The user will review and push when ready.`
    } else {
      return `A new GitHub issue has been created. Please analyze it and provide feedback.

**Issue #${issue.number}: ${issue.title}**
**Repository:** ${repoFullName}
**Labels:** ${labels}
**Created by:** ${issue.user.login}
**URL:** ${issue.html_url}

**Description:**
${issue.body || '(No description provided)'}

---

Instructions:
1. Analyze the issue to understand what's being requested
2. Search the codebase to find relevant files and understand the current implementation
3. Assess the complexity and scope of the work required
4. Identify any potential challenges or considerations
5. Provide a summary of your analysis including:
   - What files would need to be modified
   - Estimated complexity (simple/medium/complex)
   - Any questions or clarifications needed
   - Suggested approach

Do not make any changes - just analyze and report your findings.`
    }
  }

  /**
   * Process a new issue
   */
  async processIssue(payload: GitHubWebhookPayload): Promise<void> {
    const { issue, repository, sender } = payload

    console.log(`\n📋 New issue #${issue.number}: ${issue.title}`)
    console.log(`   Repository: ${repository.full_name}`)
    console.log(`   Created by: ${issue.user.login}`)

    if (!this.shouldProcessIssue(issue, sender.login)) {
      console.log(`   ⏭️  Skipping issue`)
      return
    }

    const sessionName = `issue-${issue.number}-${Date.now()}`

    try {
      console.log(`   🚀 Spawning Claude Code session...`)
      const session = await this.createSession(sessionName)
      this.activeSessions.set(issue.number, session.id)
      this.sessionToIssue.set(session.id, issue.number) // Reverse mapping for cleanup
      this.log('Session created:', session.id)

      // Wait a moment for session to initialize
      await new Promise(resolve => setTimeout(resolve, 3000))

      console.log(`   📝 Sending analysis prompt...`)
      const prompt = this.buildIssuePrompt(issue, repository.full_name)
      await this.sendPrompt(session.id, prompt)

      console.log(`   ✅ Agent is ${this.config.autoFix ? 'working on' : 'analyzing'} the issue`)
      console.log(`   ℹ️  Session: ${session.id}`)

    } catch (error) {
      console.error(`   ❌ Error processing issue:`, error)
      this.activeSessions.delete(issue.number)
    }
  }

  /**
   * Handle incoming webhook request
   */
  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Read body
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString()

    // Verify signature
    const signature = req.headers['x-hub-signature-256'] as string | undefined
    if (!this.verifySignature(body, signature)) {
      console.log('⚠️  Invalid webhook signature')
      res.writeHead(401)
      res.end('Invalid signature')
      return
    }

    // Check event type
    const event = req.headers['x-github-event'] as string
    if (event !== 'issues') {
      this.log(`Ignoring event: ${event}`)
      res.writeHead(200)
      res.end('OK')
      return
    }

    // Parse payload
    let payload: GitHubWebhookPayload
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400)
      res.end('Invalid JSON')
      return
    }

    // Only process opened issues
    if (payload.action !== 'opened') {
      this.log(`Ignoring action: ${payload.action}`)
      res.writeHead(200)
      res.end('OK')
      return
    }

    // Respond quickly, process async
    res.writeHead(200)
    res.end('OK')

    // Process the issue
    await this.processIssue(payload)
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/'

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, service: 'issue-worker' }))
      return
    }

    if (url === '/webhook/github' && req.method === 'POST') {
      await this.handleWebhook(req, res)
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  }

  /**
   * Start the webhook server
   */
  async start(): Promise<void> {
    // Connect to CIN-Interface WebSocket for session completion events
    this.connectWebSocket()

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch(err => {
        console.error('Request error:', err)
        res.writeHead(500)
        res.end('Internal Server Error')
      })
    })

    this.server.listen(this.config.port, () => {
      console.log('🎣 Issue Worker (Webhook) started')
      console.log(`   Webhook URL: http://localhost:${this.config.port}/webhook/github`)
      console.log(`   CIN-Interface API: ${this.config.apiUrl}`)
      console.log(`   Project: ${this.config.projectCwd}`)
      console.log(`   Auto-fix: ${this.config.autoFix ? 'enabled' : 'disabled (analyze only)'}`)
      if (this.config.dangerouslyAllowAllUsers) {
        console.log(`   ⚠️  DANGER: All users allowed (--dangerously-allow-all-users)`)
      } else if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
        console.log(`   🔒 Allowed users: ${this.config.allowedUsers.join(', ')}`)
      } else {
        console.log(`   🚫 No users allowed (configure ${CONFIG_FILE} or use --allowed-users)`)
      }
      console.log('')
      console.log('Configure this URL in your GitHub repository webhook settings.')
      console.log('')
    })
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.close()
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    console.log('\n🛑 Issue Worker stopped')
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)
  const config: Partial<IssueWorkerConfig> = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        config.port = parseInt(args[++i], 10)
        break
      case '--api-url':
        config.apiUrl = args[++i]
        break
      case '--cwd':
        config.projectCwd = args[++i]
        break
      case '--secret':
        config.webhookSecret = args[++i]
        break
      case '--auto-fix':
        config.autoFix = true
        break
      case '--allowed-users':
        config.allowedUsers = args[++i].split(',')
        break
      case '--dangerously-allow-all-users':
        config.dangerouslyAllowAllUsers = true
        break
      case '--allowed-labels':
        config.allowedLabels = args[++i].split(',')
        break
      case '--ignored-labels':
        config.ignoredLabels = args[++i].split(',')
        break
      case '--debug':
        config.debug = true
        break
      case '--help':
        console.log(`
Issue Worker - GitHub Webhook Handler

Receives GitHub webhook events and spawns Claude Code sessions to work on issues.

Usage: npm run agent:webhook [options]

Options:
  --port <port>           Server port (default: 3001)
  --api-url <url>         CIN-Interface API URL (default: http://localhost:4003)
  --cwd <path>            Project working directory (default: current dir)
  --secret <secret>       GitHub webhook secret (or set GITHUB_WEBHOOK_SECRET)
  --auto-fix              Enable auto-fix mode (default: analyze only)
  --allowed-users <list>  REQUIRED: Only process issues from these users (comma-separated)
  --dangerously-allow-all-users  Bypass user whitelist (NOT RECOMMENDED - see Security)
  --allowed-labels <list> Only process issues with these labels (comma-separated)
  --ignored-labels <list> Ignore issues with these labels (comma-separated)
  --debug                 Enable debug logging
  --help                  Show this help

Security (IMPORTANT):
  By default, the agent will NOT process any issues unless you specify trusted users.
  This is a critical security measure because:

  - The agent can execute arbitrary code on your machine via Claude Code
  - Malicious actors could craft issues that trick the agent into harmful actions
  - Your secrets, credentials, and files could be exposed

  Allowed users are loaded from: ~/.cin-interface/agent-config.json

  You can:
  1. Edit the config file to add trusted GitHub usernames (RECOMMENDED)
  2. Use --allowed-users to override the config file
  3. Use --dangerously-allow-all-users to bypass this check (NOT RECOMMENDED)

GitHub Webhook Setup:
  1. Go to your repo Settings -> Webhooks -> Add webhook
  2. Payload URL: http://your-server:3001/webhook/github
  3. Content type: application/json
  4. Secret: (optional, must match --secret)
  5. Events: Select "Issues"
`)
        process.exit(0)
    }
  }

  // Load allowed users from config file if not specified via CLI
  if (!config.allowedUsers && !config.dangerouslyAllowAllUsers) {
    const agentConfig = loadAgentConfig()
    config.allowedUsers = agentConfig.allowedUsers
    if (agentConfig.allowedUsers.length > 0) {
      console.log(`Loaded allowed users from ${CONFIG_FILE}`)
    }
  }

  const worker = new IssueWorker(config)

  process.on('SIGINT', () => {
    worker.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    worker.stop()
    process.exit(0)
  })

  await worker.start()
}

export { IssueWorker, IssueWorkerConfig }

main().catch(console.error)
