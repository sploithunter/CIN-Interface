/**
 * Issue Poller - Poll GitHub for New Issues
 *
 * Polls GitHub API for new issues across repos and spawns Claude Code
 * sessions via CIN-Interface to analyze and work on them.
 *
 * Advantages over webhooks:
 * - Can watch multiple repos or an entire account
 * - No need to expose a public URL
 * - Works behind firewalls
 *
 * Usage:
 *   npm run agent:poller -- --user sploithunter
 *   npm run agent:poller -- --repos owner/repo1,owner/repo2
 */

import { execSync } from 'child_process'
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
      console.log(`⚠️  No allowed users configured. Edit the config file or use --allowed-users`)
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
  repository_url: string
  user: { login: string }
  labels: Array<{ name: string }>
  state: string
  created_at: string
  updated_at: string
}

/**
 * Git checkpoint for safe rollback on validation failure
 */
interface GitCheckpoint {
  issueKey: string
  cwd: string
  originalBranch: string
  sha: string
  timestamp: number
  hasUncommittedChanges: boolean
  feedbackId?: string  // Link to feedback for status updates
}

/**
 * Validation result
 */
interface ValidationResult {
  success: boolean
  output: string
  failedCommand?: string
}

interface CINSession {
  id: string
  name: string
  status: string
}

interface IssuePollerConfig {
  apiUrl: string            // CIN-Interface API URL
  defaultProjectCwd: string
  pollIntervalMs: number
  user?: string              // GitHub username to watch all repos
  repos?: string[]           // Specific repos to watch (owner/repo format)
  allowedUsers?: string[]    // Only process issues from these users (security whitelist)
  dangerouslyAllowAllUsers?: boolean  // Bypass user whitelist (NOT recommended)
  allowedLabels?: string[]
  ignoredLabels?: string[]
  ignoredUsers?: string[]
  autoFix: boolean
  maxConcurrentSessions: number
  debug: boolean
  // Validation options
  validationEnabled: boolean
  validationCommands?: string[]  // Custom commands, or auto-detect from package.json
  skipBuild: boolean
  skipTest: boolean
  skipLint: boolean
  skipTypecheck: boolean
  rollbackOnFailure: boolean
}

const DEFAULT_CONFIG: IssuePollerConfig = {
  apiUrl: 'http://localhost:4003',
  defaultProjectCwd: process.cwd(),
  pollIntervalMs: 60000, // 1 minute
  allowedUsers: undefined,
  dangerouslyAllowAllUsers: false, // Closed by default - must explicitly allow users
  allowedLabels: undefined,
  ignoredLabels: ['wontfix', 'duplicate', 'invalid', 'agent-processing'],
  ignoredUsers: [],
  autoFix: false,
  maxConcurrentSessions: 1,
  debug: false,
  // Validation defaults
  validationEnabled: true,
  validationCommands: undefined,  // Auto-detect
  skipBuild: false,
  skipTest: false,
  skipLint: false,
  skipTypecheck: false,
  rollbackOnFailure: true,
}

class IssuePoller {
  private config: IssuePollerConfig
  private running = false
  private processedIssues: Set<string> = new Set() // "owner/repo#number"
  private activeSessions: Map<string, string> = new Map() // issueKey -> sessionId
  private sessionToIssue: Map<string, string> = new Map() // sessionId -> issueKey
  private ws: WebSocket | null = null
  private sessionReadyResolvers: Map<string, () => void> = new Map() // sessionId -> resolver
  private checkpoints: Map<string, GitCheckpoint> = new Map() // issueKey -> checkpoint

  constructor(config: Partial<IssuePollerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ===========================================================================
  // Checkpoint / Validation / Rollback
  // ===========================================================================

  /**
   * Create a git checkpoint before starting work
   */
  private async createCheckpoint(issueKey: string, cwd: string, feedbackId?: string): Promise<GitCheckpoint> {
    this.log(`Creating checkpoint for ${issueKey}`)

    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()

      const sha = execSync('git rev-parse HEAD', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()

      const status = execSync('git status --porcelain', {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()

      const checkpoint: GitCheckpoint = {
        issueKey,
        cwd,
        originalBranch: branch,
        sha,
        timestamp: Date.now(),
        hasUncommittedChanges: status.length > 0,
        feedbackId,
      }

      this.checkpoints.set(issueKey, checkpoint)
      this.log(`Checkpoint created: branch=${branch}, sha=${sha.substring(0, 8)}`)

      // Warn if there are uncommitted changes
      if (checkpoint.hasUncommittedChanges) {
        console.log(`   ⚠️  Warning: Uncommitted changes detected. Rollback may lose them.`)
      }

      return checkpoint
    } catch (err) {
      this.log('Failed to create checkpoint:', err)
      throw new Error(`Failed to create git checkpoint: ${err}`)
    }
  }

  /**
   * Run validation commands to verify the fix works
   */
  private async runValidation(cwd: string): Promise<ValidationResult> {
    if (!this.config.validationEnabled) {
      return { success: true, output: 'Validation disabled' }
    }

    console.log(`   🔍 Running validation...`)
    const outputs: string[] = []
    let commands: string[] = []

    // Use custom commands or auto-detect from package.json
    if (this.config.validationCommands && this.config.validationCommands.length > 0) {
      commands = this.config.validationCommands
    } else {
      // Auto-detect from package.json
      try {
        const pkgPath = join(cwd, 'package.json')
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
          const scripts = pkg.scripts || {}

          if (scripts.build && !this.config.skipBuild) {
            commands.push('npm run build')
          }
          if (scripts.typecheck && !this.config.skipTypecheck) {
            commands.push('npm run typecheck')
          }
          if (scripts.lint && !this.config.skipLint) {
            commands.push('npm run lint')
          }
          if (scripts.test && !this.config.skipTest) {
            commands.push('npm test')
          }
        }
      } catch (err) {
        this.log('Failed to read package.json:', err)
      }
    }

    if (commands.length === 0) {
      return { success: true, output: 'No validation commands found' }
    }

    console.log(`   📋 Validation commands: ${commands.join(', ')}`)

    for (const cmd of commands) {
      try {
        console.log(`   ⏳ Running: ${cmd}`)
        const output = execSync(cmd, {
          cwd,
          encoding: 'utf-8',
          timeout: 300000, // 5 minutes per command
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        outputs.push(`✓ ${cmd}:\n${output.slice(-500)}`) // Last 500 chars
        console.log(`   ✓ ${cmd} passed`)
      } catch (err) {
        const error = err as { stderr?: string; stdout?: string; message?: string }
        const errorOutput = error.stderr || error.stdout || error.message || 'Unknown error'
        outputs.push(`✗ ${cmd} FAILED:\n${errorOutput.slice(-1000)}`)
        console.log(`   ✗ ${cmd} FAILED`)
        return {
          success: false,
          output: outputs.join('\n\n'),
          failedCommand: cmd,
        }
      }
    }

    console.log(`   ✅ All validation checks passed`)
    return { success: true, output: outputs.join('\n\n') }
  }

  /**
   * Rollback to checkpoint state
   */
  private async rollback(checkpoint: GitCheckpoint): Promise<void> {
    const { cwd, originalBranch, sha, issueKey } = checkpoint
    console.log(`   ⏪ Rolling back ${issueKey}...`)

    try {
      // Switch back to original branch
      execSync(`git checkout ${originalBranch}`, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe',
      })
      console.log(`   ✓ Switched to branch: ${originalBranch}`)

      // Reset to original SHA
      execSync(`git reset --hard ${sha}`, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe',
      })
      console.log(`   ✓ Reset to commit: ${sha.substring(0, 8)}`)

      // Clean untracked files (new files created by the agent)
      execSync('git clean -fd', {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: 'pipe',
      })
      console.log(`   ✓ Cleaned untracked files`)

      // Delete fix branch if it was created
      const issueNumber = issueKey.split('#')[1]
      const fixBranches = [`fix/issue-${issueNumber}`, `feature/issue-${issueNumber}`]
      for (const branch of fixBranches) {
        try {
          execSync(`git branch -D ${branch}`, {
            cwd,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: 'pipe',
          })
          this.log(`Deleted branch: ${branch}`)
        } catch {
          // Branch doesn't exist, ignore
        }
      }

      console.log(`   ✅ Rollback complete`)
    } catch (err) {
      console.error(`   ❌ Rollback failed:`, err)
      throw new Error(`Rollback failed: ${err}`)
    }
  }

  /**
   * Update feedback fixer status via API
   */
  private async updateFeedbackStatus(
    feedbackId: string,
    status: 'pending' | 'in_progress' | 'validating' | 'complete' | 'failed' | 'rolled_back',
    message?: string,
    validationOutput?: string
  ): Promise<void> {
    try {
      await this.fetchJson(`${this.config.apiUrl}/feedback/${feedbackId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fixerStatus: status,
          fixerMessage: message,
          validationOutput,
        }),
      })
      this.log(`Updated feedback ${feedbackId} status: ${status}`)
    } catch (err) {
      this.log('Failed to update feedback status:', err)
    }
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
   * Handle WebSocket messages
   */
  private async handleWebSocketMessage(message: unknown): Promise<void> {
    const msg = message as { type: string; data?: unknown }

    if (msg.type === 'event') {
      const event = msg.data as { type: string; sessionId?: string }

      // Session is ready when we receive session_start event
      if (event.type === 'session_start' && event.sessionId) {
        const resolver = this.sessionReadyResolvers.get(event.sessionId)
        if (resolver) {
          this.log('Session ready:', event.sessionId)
          resolver()
          this.sessionReadyResolvers.delete(event.sessionId)
        }
      }

      if (event.type === 'stop' && event.sessionId) {
        await this.handleSessionComplete(event.sessionId)
      }
    }
  }

  /**
   * Wait for a session to become ready (receive session_start event)
   */
  private waitForSessionReady(sessionId: string, timeoutMs: number = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.sessionReadyResolvers.delete(sessionId)
        this.log('Session ready wait timed out:', sessionId)
        resolve(false)
      }, timeoutMs)

      this.sessionReadyResolvers.set(sessionId, () => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
  }

  /**
   * Handle session completion - validate, rollback if needed, cleanup
   */
  private async handleSessionComplete(sessionId: string): Promise<void> {
    const issueKey = this.sessionToIssue.get(sessionId)
    if (!issueKey) {
      this.log('Unknown session completed:', sessionId)
      return
    }

    console.log(`\n✅ Session for ${issueKey} completed`)

    // Get checkpoint for this issue
    const checkpoint = this.checkpoints.get(issueKey)

    // Run validation if in auto-fix mode
    if (this.config.autoFix && checkpoint) {
      // Update feedback status to validating
      if (checkpoint.feedbackId) {
        await this.updateFeedbackStatus(checkpoint.feedbackId, 'validating', 'Running validation checks')
      }

      const validation = await this.runValidation(checkpoint.cwd)

      if (!validation.success) {
        console.log(`   ❌ Validation failed: ${validation.failedCommand}`)

        // Rollback if enabled
        if (this.config.rollbackOnFailure) {
          try {
            await this.rollback(checkpoint)
            if (checkpoint.feedbackId) {
              await this.updateFeedbackStatus(
                checkpoint.feedbackId,
                'rolled_back',
                `Validation failed: ${validation.failedCommand}`,
                validation.output
              )
            }

            // Add comment to issue explaining the failure
            try {
              const [repo, issueNum] = issueKey.split('#')
              const comment = `⚠️ **Automated fix attempt failed validation**\n\n` +
                `The agent attempted to fix this issue but the changes failed validation:\n` +
                `- Failed command: \`${validation.failedCommand}\`\n\n` +
                `The changes have been rolled back. Manual intervention may be required.`
              execSync(`gh issue comment ${issueNum} --repo ${repo} --body "${comment.replace(/"/g, '\\"')}"`, {
                encoding: 'utf-8',
                stdio: 'pipe',
              })
            } catch (err) {
              this.log('Failed to comment on issue:', err)
            }
          } catch (rollbackErr) {
            console.error(`   ❌ Rollback also failed:`, rollbackErr)
            if (checkpoint.feedbackId) {
              await this.updateFeedbackStatus(
                checkpoint.feedbackId,
                'failed',
                `Validation failed and rollback failed: ${rollbackErr}`,
                validation.output
              )
            }
          }
        } else {
          // No rollback, just mark as failed
          if (checkpoint.feedbackId) {
            await this.updateFeedbackStatus(
              checkpoint.feedbackId,
              'failed',
              `Validation failed: ${validation.failedCommand}`,
              validation.output
            )
          }
        }

        // Clean up tracking but don't close issue
        this.cleanupTracking(sessionId, issueKey)
        return
      }

      // Validation passed - update feedback and close issue
      if (checkpoint.feedbackId) {
        await this.updateFeedbackStatus(
          checkpoint.feedbackId,
          'complete',
          `Fix validated and applied successfully`,
          validation.output
        )
      }

      // Close the GitHub issue
      try {
        const [repo, issueNum] = issueKey.split('#')
        execSync(`gh issue close ${issueNum} --repo ${repo} --comment "Fix implemented and validated by automation agent. Branch: fix/issue-${issueNum}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        })
        console.log(`   ✅ Issue ${issueKey} closed`)
      } catch (err) {
        console.log(`   ⚠️  Could not close issue (may need manual review):`, (err as Error).message)
      }
    }

    // Clean up
    this.cleanupTracking(sessionId, issueKey)
  }

  /**
   * Clean up tracking maps and session
   */
  private async cleanupTracking(sessionId: string, issueKey: string): Promise<void> {
    // Clean up the session
    try {
      await this.deleteSession(sessionId)
      console.log(`   🧹 Session cleaned up`)
    } catch (err) {
      this.log('Failed to delete session:', err)
    }

    // Remove from tracking maps
    this.activeSessions.delete(issueKey)
    this.sessionToIssue.delete(sessionId)
    this.checkpoints.delete(issueKey)
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
      console.log('[IssuePoller]', ...args)
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
   * Get repos to watch
   */
  private getReposToWatch(): string[] {
    if (this.config.repos && this.config.repos.length > 0) {
      return this.config.repos
    }

    if (this.config.user) {
      // Use gh CLI to list repos for the user
      try {
        const output = execSync(
          `gh repo list ${this.config.user} --json nameWithOwner --limit 100`,
          { encoding: 'utf-8' }
        )
        const repos = JSON.parse(output) as Array<{ nameWithOwner: string }>
        return repos.map(r => r.nameWithOwner)
      } catch (error) {
        console.error('Failed to list repos:', error)
        return []
      }
    }

    return []
  }

  /**
   * Get open issues for a repo using gh CLI
   */
  private getRepoIssues(repo: string): GitHubIssue[] {
    try {
      const output = execSync(
        `gh issue list --repo ${repo} --state open --json number,title,body,url,author,labels,createdAt,updatedAt --limit 50`,
        { encoding: 'utf-8' }
      )
      const issues = JSON.parse(output) as Array<{
        number: number
        title: string
        body: string
        url: string
        author: { login: string }
        labels: Array<{ name: string }>
        createdAt: string
        updatedAt: string
      }>

      return issues.map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        html_url: i.url,
        repository_url: `https://api.github.com/repos/${repo}`,
        user: { login: i.author.login },
        labels: i.labels,
        state: 'open',
        created_at: i.createdAt,
        updated_at: i.updatedAt,
      }))
    } catch (error) {
      this.log(`Failed to get issues for ${repo}:`, error)
      return []
    }
  }

  /**
   * Check if an issue should be processed
   */
  private shouldProcessIssue(issue: GitHubIssue, repo: string): boolean {
    const issueKey = `${repo}#${issue.number}`

    // Already processed or being processed
    if (this.processedIssues.has(issueKey) || this.activeSessions.has(issueKey)) {
      return false
    }

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
    if (this.config.ignoredUsers?.includes(issue.user.login)) {
      this.log(`Ignoring issue from user: ${issue.user.login}`)
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

    // Check if issue is recent (created in last 24 hours)
    const createdAt = new Date(issue.created_at).getTime()
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    if (createdAt < oneDayAgo) {
      this.log(`Ignoring old issue: ${issueKey}`)
      this.processedIssues.add(issueKey) // Mark as processed to avoid re-checking
      return false
    }

    return true
  }

  /**
   * Create a Claude Code session via CIN-Interface
   */
  async createSession(name: string, cwd: string): Promise<CINSession> {
    const result = await this.fetchJson<{ ok: boolean; session: CINSession }>(
      `${this.config.apiUrl}/sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          cwd,
          agent: 'claude',
        }),
      }
    )
    return result.session
  }

  /**
   * Send a prompt to a CIN-Interface session
   */
  async sendPrompt(sessionId: string, prompt: string): Promise<boolean> {
    try {
      const result = await this.fetchJson<{ ok: boolean }>(`${this.config.apiUrl}/sessions/${sessionId}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      return result.ok
    } catch (error) {
      this.log('sendPrompt error:', error)
      return false
    }
  }

  /**
   * Get local clone path for a repo, or use default
   */
  private getRepoCwd(repo: string): string {
    // Check common locations
    const home = homedir()
    const repoName = repo.split('/')[1]
    const possiblePaths = [
      `${home}/Documents/${repoName}`,
      `${home}/Projects/${repoName}`,
      `${home}/code/${repoName}`,
      `${home}/${repoName}`,
    ]

    for (const path of possiblePaths) {
      try {
        execSync(`test -d "${path}/.git"`, { stdio: 'ignore' })
        return path
      } catch {
        // Not found, continue
      }
    }

    return this.config.defaultProjectCwd
  }

  /**
   * Build the prompt for working on an issue
   */
  buildIssuePrompt(issue: GitHubIssue, repo: string): string {
    const labels = issue.labels.map(l => l.name).join(', ') || 'none'

    if (this.config.autoFix) {
      return `A GitHub issue needs to be addressed.

**Issue #${issue.number}: ${issue.title}**
**Repository:** ${repo}
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
      return `A GitHub issue needs analysis.

**Issue #${issue.number}: ${issue.title}**
**Repository:** ${repo}
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
   * Process a single issue
   */
  async processIssue(issue: GitHubIssue, repo: string, feedbackId?: string): Promise<void> {
    const issueKey = `${repo}#${issue.number}`

    console.log(`\n📋 Processing ${issueKey}: ${issue.title}`)
    console.log(`   Created by: ${issue.user.login}`)
    console.log(`   URL: ${issue.html_url}`)

    const sessionName = `${repo.replace('/', '-')}-${issue.number}`
    const cwd = this.getRepoCwd(repo)

    try {
      console.log(`   📁 Working directory: ${cwd}`)

      // Create checkpoint before starting work (for auto-fix mode)
      if (this.config.autoFix) {
        console.log(`   💾 Creating checkpoint...`)
        await this.createCheckpoint(issueKey, cwd, feedbackId)
        if (feedbackId) {
          await this.updateFeedbackStatus(feedbackId, 'in_progress', `Working on issue #${issue.number}`)
        }
      }

      console.log(`   🚀 Spawning Claude Code session...`)
      const session = await this.createSession(sessionName, cwd)
      this.activeSessions.set(issueKey, session.id)
      this.sessionToIssue.set(session.id, issueKey) // Reverse mapping for cleanup
      this.log('Session created:', session.id)

      // Wait for session to become ready (session_start event or timeout)
      console.log(`   ⏳ Waiting for session to be ready...`)
      const ready = await this.waitForSessionReady(session.id, 60000)

      if (!ready) {
        console.log(`   ⚠️  Session ready wait timed out, attempting to send prompt anyway`)
      } else {
        console.log(`   ✓  Session is ready`)
      }

      console.log(`   📝 Sending ${this.config.autoFix ? 'fix' : 'analysis'} prompt...`)
      const prompt = this.buildIssuePrompt(issue, repo)
      const result = await this.sendPrompt(session.id, prompt)

      if (!result) {
        console.error(`   ❌ Failed to send prompt`)
        if (feedbackId) {
          await this.updateFeedbackStatus(feedbackId, 'failed', 'Failed to send prompt to agent')
        }
        return
      }

      console.log(`   ✅ Prompt sent - agent is ${this.config.autoFix ? 'working on' : 'analyzing'} the issue`)
      if (this.config.autoFix && this.config.validationEnabled) {
        console.log(`   ℹ️  Validation will run on completion, rollback on failure: ${this.config.rollbackOnFailure ? 'enabled' : 'disabled'}`)
      }
      console.log(`   ℹ️  Session will auto-cleanup when complete`)

      // Mark as processed
      this.processedIssues.add(issueKey)

    } catch (error) {
      console.error(`   ❌ Error processing issue:`, error)
      this.activeSessions.delete(issueKey)
      this.checkpoints.delete(issueKey)
      if (feedbackId) {
        await this.updateFeedbackStatus(feedbackId, 'failed', `Error processing issue: ${error}`)
      }
    }
  }

  /**
   * Run one poll cycle
   */
  async poll(): Promise<void> {
    const repos = this.getReposToWatch()

    if (repos.length === 0) {
      console.log('⚠️  No repos to watch. Use --user or --repos to specify.')
      return
    }

    this.log(`Checking ${repos.length} repos...`)

    let newIssuesFound = 0
    const issuesToProcess: Array<{ issue: GitHubIssue; repo: string }> = []

    for (const repo of repos) {
      const issues = this.getRepoIssues(repo)

      for (const issue of issues) {
        if (this.shouldProcessIssue(issue, repo)) {
          issuesToProcess.push({ issue, repo })
          newIssuesFound++
        }
      }
    }

    if (newIssuesFound === 0) {
      this.log('No new issues found')
      return
    }

    console.log(`\n📬 Found ${newIssuesFound} new issue(s) to process`)

    // Process up to maxConcurrentSessions
    const toProcess = issuesToProcess.slice(0, this.config.maxConcurrentSessions)

    for (const { issue, repo } of toProcess) {
      await this.processIssue(issue, repo)
    }
  }

  /**
   * Start polling
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('Poller is already running')
      return
    }

    const repos = this.getReposToWatch()

    console.log('🔄 Issue Poller started')
    console.log(`   CIN-Interface API: ${this.config.apiUrl}`)
    console.log(`   Poll interval: ${this.config.pollIntervalMs / 1000}s`)
    console.log(`   Auto-fix: ${this.config.autoFix ? 'enabled' : 'disabled (analyze only)'}`)
    if (this.config.autoFix) {
      console.log(`   Validation: ${this.config.validationEnabled ? 'enabled' : 'disabled'}`)
      if (this.config.validationEnabled) {
        console.log(`   Rollback on failure: ${this.config.rollbackOnFailure ? 'enabled' : 'disabled'}`)
        const skipped: string[] = []
        if (this.config.skipBuild) skipped.push('build')
        if (this.config.skipTest) skipped.push('test')
        if (this.config.skipLint) skipped.push('lint')
        if (this.config.skipTypecheck) skipped.push('typecheck')
        if (skipped.length > 0) {
          console.log(`   Skipped checks: ${skipped.join(', ')}`)
        }
      }
    }
    if (this.config.dangerouslyAllowAllUsers) {
      console.log(`   ⚠️  DANGER: All users allowed (--dangerously-allow-all-users)`)
    } else if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      console.log(`   🔒 Allowed users: ${this.config.allowedUsers.join(', ')}`)
    } else {
      console.log(`   🚫 No users allowed (configure ${CONFIG_FILE} or use --allowed-users)`)
    }
    console.log(`   Watching ${repos.length} repo(s):`)
    repos.slice(0, 10).forEach(r => console.log(`     - ${r}`))
    if (repos.length > 10) {
      console.log(`     ... and ${repos.length - 10} more`)
    }
    console.log('')

    this.running = true

    // Connect to CIN-Interface WebSocket for session completion events
    this.connectWebSocket()

    // Initial poll
    await this.poll()

    // Polling loop
    while (this.running) {
      await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs))
      await this.poll()
    }
  }

  /**
   * Stop polling
   */
  stop(): void {
    console.log('\n🛑 Issue Poller stopped')
    this.running = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)
  const config: Partial<IssuePollerConfig> = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--api-url':
        config.apiUrl = args[++i]
        break
      case '--cwd':
        config.defaultProjectCwd = args[++i]
        break
      case '--poll-interval':
        config.pollIntervalMs = parseInt(args[++i], 10) * 1000
        break
      case '--user':
        config.user = args[++i]
        break
      case '--repos':
        config.repos = args[++i].split(',')
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
      case '--max-concurrent':
        config.maxConcurrentSessions = parseInt(args[++i], 10)
        break
      case '--debug':
        config.debug = true
        break
      // Validation options
      case '--no-validation':
        config.validationEnabled = false
        break
      case '--validation-commands':
        config.validationCommands = args[++i].split(',')
        break
      case '--skip-build':
        config.skipBuild = true
        break
      case '--skip-test':
        config.skipTest = true
        break
      case '--skip-lint':
        config.skipLint = true
        break
      case '--skip-typecheck':
        config.skipTypecheck = true
        break
      case '--no-rollback':
        config.rollbackOnFailure = false
        break
      case '--help':
        console.log(`
Issue Poller - Poll GitHub for New Issues

Polls GitHub for new issues and spawns Claude Code sessions to work on them.
When auto-fix is enabled, validates changes and rolls back on failure.

Usage: npm run agent:poller [options]

Options:
  --user <username>       Watch all repos for this GitHub user
  --repos <list>          Watch specific repos (comma-separated, owner/repo format)
  --api-url <url>         CIN-Interface API URL (default: http://localhost:4003)
  --cwd <path>            Default project directory (default: current dir)
  --poll-interval <secs>  Poll interval in seconds (default: 60)
  --auto-fix              Enable auto-fix mode (default: analyze only)
  --allowed-users <list>  REQUIRED: Only process issues from these users (comma-separated)
  --dangerously-allow-all-users  Bypass user whitelist (NOT RECOMMENDED - see Security)
  --allowed-labels <list> Only process issues with these labels
  --ignored-labels <list> Ignore issues with these labels
  --max-concurrent <n>    Max concurrent sessions (default: 1)
  --debug                 Enable debug logging
  --help                  Show this help

Validation Options (for --auto-fix mode):
  --no-validation         Disable validation after fix (default: enabled)
  --validation-commands   Custom validation commands (comma-separated)
  --skip-build            Skip 'npm run build' validation
  --skip-test             Skip 'npm test' validation
  --skip-lint             Skip 'npm run lint' validation
  --skip-typecheck        Skip 'npm run typecheck' validation
  --no-rollback           Don't rollback on validation failure (default: rollback enabled)

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

Examples:
  # Watch repos, only allow issues from trusted users (RECOMMENDED)
  npm run agent:poller -- --user myuser --allowed-users myuser,trustedcollab

  # Watch specific repos with auto-fix for trusted users
  npm run agent:poller -- --repos owner/repo --auto-fix --allowed-users owner

  # Auto-fix with custom validation and no rollback
  npm run agent:poller -- --repos owner/repo --auto-fix --validation-commands "npm run build,npm test" --no-rollback --allowed-users owner

  # DANGEROUS: Allow all users (only for fully trusted private repos)
  npm run agent:poller -- --repos owner/private-repo --dangerously-allow-all-users
`)
        process.exit(0)
    }
  }

  if (!config.user && !config.repos) {
    console.error('Error: Must specify --user or --repos')
    console.error('Run with --help for usage information')
    process.exit(1)
  }

  // Load allowed users from config file if not specified via CLI
  if (!config.allowedUsers && !config.dangerouslyAllowAllUsers) {
    const agentConfig = loadAgentConfig()
    config.allowedUsers = agentConfig.allowedUsers
    if (agentConfig.allowedUsers.length > 0) {
      console.log(`Loaded allowed users from ${CONFIG_FILE}`)
    }
  }

  const poller = new IssuePoller(config)

  process.on('SIGINT', () => {
    poller.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    poller.stop()
    process.exit(0)
  })

  await poller.start()
}

export { IssuePoller, IssuePollerConfig }

main().catch(console.error)
