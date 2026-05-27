/**
 * @file api-client.ts
 * @description HTTP client for AIMEAT node API with automatic auth header injection.
 */
import { getToken } from './keychain.js';
import { loadConfig } from './config.js';

export interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export class AimeatClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token ?? null;
  }

  static async fromConfig(): Promise<AimeatClient> {
    const config = loadConfig();
    if (!config) throw new Error('Not configured. Run: npx @aimeat/connect');
    const token = await getToken(config.agent, config.owner);
    if (!token) throw new Error('No stored token. Run: npx @aimeat/connect');
    return new AimeatClient(config.node_url, token);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async get(path: string): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json() as Promise<ApiResponse>;
  }

  async post(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async put(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async patch(path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async delete(path: string): Promise<ApiResponse> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: 'DELETE', headers: this.headers() });
    return res.json() as Promise<ApiResponse>;
  }

  getBaseUrl(): string { return this.baseUrl; }
  getTokenValue(): string | null { return this.token; }
  setToken(t: string): void { this.token = t; }
}
