/**
 * SessionAPI - Pure API layer for session management
 *
 * All functions are pure HTTP calls with no DOM/state dependencies.
 * UI logic and state updates are handled by the caller (main.ts).
 */

import type { ManagedSession } from '../../shared/types'

export interface SessionFlags {
  continue?: boolean
  skipPermissions?: boolean
  chrome?: boolean
}

export interface CreateSessionResponse {
  ok: boolean
  error?: string
  session?: ManagedSession
}

export interface SimpleResponse {
  ok: boolean
  error?: string
}

export interface ServerInfoResponse {
  ok: boolean
  cwd?: string
  error?: string
}

/**
 * Create a SessionAPI instance bound to a specific API URL
 */
export function createSessionAPI(apiUrl: string) {
  return {
    /**
     * Create a new managed session
     */
    async createSession(
      name?: string,
      cwd?: string,
      flags?: SessionFlags
    ): Promise<CreateSessionResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, cwd, flags }),
        })
        return await response.json()
      } catch (e) {
        console.error('Error creating session:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Fetch server info (cwd, etc.)
     */
    async getServerInfo(): Promise<ServerInfoResponse> {
      try {
        const response = await fetch(`${apiUrl}/info`)
        return await response.json()
      } catch (e) {
        console.error('Error fetching server info:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Rename a managed session
     */
    async renameSession(sessionId: string, name: string): Promise<SimpleResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        return await response.json()
      } catch (e) {
        console.error('Error renaming session:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Save zone position for a managed session
     */
    async saveZonePosition(
      sessionId: string,
      position: { q: number; r: number }
    ): Promise<SimpleResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zonePosition: position }),
        })
        return await response.json()
      } catch (e) {
        console.error('Error saving zone position:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Delete a managed session
     */
    async deleteSession(sessionId: string): Promise<SimpleResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions/${sessionId}`, {
          method: 'DELETE',
        })
        return await response.json()
      } catch (e) {
        console.error('Error deleting session:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Restart an offline session
     */
    async restartSession(sessionId: string): Promise<SimpleResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions/${sessionId}/restart`, {
          method: 'POST',
        })
        return await response.json()
      } catch (e) {
        console.error('Error restarting session:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Send a prompt to a managed session
     */
    async sendPrompt(
      sessionId: string,
      prompt: string
    ): Promise<SimpleResponse> {
      try {
        const response = await fetch(`${apiUrl}/sessions/${sessionId}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        return await response.json()
      } catch (e) {
        console.error('Error sending prompt:', e)
        return { ok: false, error: 'Network error' }
      }
    },

    /**
     * Link a Claude session ID to a managed session
     */
    async linkSession(
      managedId: string,
      claudeSessionId: string
    ): Promise<void> {
      try {
        await fetch(`${apiUrl}/sessions/${managedId}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claudeSessionId }),
        })
      } catch (e) {
        console.error('Failed to link session on server:', e)
      }
    },

    /**
     * Trigger a health check / refresh of all sessions
     */
    async refreshSessions(): Promise<void> {
      try {
        await fetch(`${apiUrl}/sessions/refresh`, { method: 'POST' })
      } catch (e) {
        console.error('Error refreshing sessions:', e)
      }
    },
  }
}

export type SessionAPI = ReturnType<typeof createSessionAPI>
