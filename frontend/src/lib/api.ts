import type {
  HealthResponse,
  ConfigResponse,
  SessionsResponse,
  ProjectsResponse,
  AutocompleteResponse,
  DefaultPathResponse,
  CreateSessionOptions,
  ManagedSession,
} from '../types';

const DEFAULT_PORT = 4003;

class ApiClient {
  private baseUrl: string;

  constructor(port: number = DEFAULT_PORT) {
    this.baseUrl = `http://localhost:${port}`;
  }

  setPort(port: number): void {
    this.baseUrl = `http://localhost:${port}`;
  }

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }

  async config(): Promise<ConfigResponse> {
    const res = await fetch(`${this.baseUrl}/config`);
    return res.json();
  }

  // Sessions
  async getSessions(): Promise<SessionsResponse> {
    const res = await fetch(`${this.baseUrl}/sessions`);
    return res.json();
  }

  async createSession(options: CreateSessionOptions): Promise<{ ok: boolean; session?: ManagedSession; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return res.json();
  }

  async deleteSession(id: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, {
      method: 'DELETE',
    });
    return res.json();
  }

  async updateSession(
    id: string,
    updates: { name?: string; zonePosition?: { q: number; r: number } | null; autoAccept?: boolean }
  ): Promise<{ ok: boolean; session?: ManagedSession; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  }

  async restartSession(id: string): Promise<{ ok: boolean; session?: ManagedSession; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${id}/restart`, {
      method: 'POST',
    });
    return res.json();
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    return res.json();
  }

  async cancelSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/cancel`, {
      method: 'POST',
    });
    return res.json();
  }

  async openTerminal(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/terminal`, {
      method: 'POST',
    });
    return res.json();
  }

  // Projects
  async getProjects(): Promise<ProjectsResponse> {
    const res = await fetch(`${this.baseUrl}/projects`);
    return res.json();
  }

  async getDefaultPath(): Promise<DefaultPathResponse> {
    const res = await fetch(`${this.baseUrl}/projects/default`);
    return res.json();
  }

  async autocomplete(query: string, limit: number = 15): Promise<AutocompleteResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await fetch(`${this.baseUrl}/projects/autocomplete?${params}`);
    return res.json();
  }
}

export const api = new ApiClient();
export default api;
