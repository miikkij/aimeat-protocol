/**
 * @file api-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HTTP client for AIMEAT node API with automatic auth header injection.
 * @structure Wraps fetch, response-envelope handling, and stored-token based client
 *   construction. `Transport` is the pluggable seam: the default transport does a
 *   direct `fetch` with `Connection: close` (one-shot CLI behavior); the serve
 *   daemon swaps in a tunnel transport (`ConnectTunnelClient.forward`) so every
 *   MCP tool call flows over the single persistent WS without per-tool changes.
 * @usage Imported by `aimeat connect` subcommands and MCP tools.
 * @version-history
 *   v1.9.4 — 2026-05-28 — Update connector guidance and close one-shot CLI HTTP connections.
 *   v2.0.0 — 2026-06-10 — Phase 4: Transport seam (direct fetch default, tunnel override).
 *   v2.1.0 — 2026-08-01 — TARGET-058 Phase 11b: ApiResponse models `meta`. It always arrived; not
 *     being in the type is why every tool handler dropped meta.provenance without anyone noticing.
 */
import { getToken } from './keychain.js';
import { loadConfig } from './config.js';

export interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  /**
   * The envelope's `meta` slot. It has always ARRIVED — every transport here returns the parsed
   * envelope whole — but it was not in this type, so every `resp.data ?? resp` in a tool handler
   * dropped it and nothing complained.
   *
   * That matters because `meta.provenance` is the ONE carrier the AI-provenance work froze for a
   * response that IS a piece of generated content (22-frozen-vocabulary.md §A4). `GET /v1/memory/:key`
   * serves the whole record there, and a crew reading its own content back through the connector got
   * only `ai_provenance_id` — the pointer, not the statement. TARGET-058 Phase 11b.
   */
  meta?: Record<string, unknown>;
}

/**
 * Pluggable request transport. `path` is always node-relative (`/v1/...`);
 * absolute URLs never reach a transport (they go direct — see `send()`).
 * Returns the HTTP status and the parsed (envelope) body.
 */
export interface Transport {
  request(method: string, path: string, opts?: { body?: unknown; query?: Record<string, string> }): Promise<{ status: number; body: unknown }>;
}

export class AimeatClient {
  private baseUrl: string;
  private token: string | null = null;
  private transport: Transport | null = null;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token ?? null;
  }

  static async fromConfig(): Promise<AimeatClient> {
    const config = loadConfig();
    if (!config) throw new Error('Not configured. Run: npx aimeat connect');
    const token = await getToken(config.agent, config.owner);
    if (!token) throw new Error('No stored token. Run: npx aimeat connect');
    return new AimeatClient(config.node_url, token);
  }

  /** Route subsequent requests through `t` (e.g. the tunnel). `null` restores direct fetch. */
  setTransport(t: Transport | null): void { this.transport = t; }
  hasTransport(): boolean { return this.transport !== null; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Connection: 'close' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Single dispatch point for every verb. Node-relative paths go through the
   * transport when one is set; absolute URLs (presigned uploads etc.) and the
   * default case use direct fetch with `Connection: close`.
   */
  private async send(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    if (this.transport && !path.startsWith('http')) {
      const r = await this.transport.request(method, path, { body });
      return r.body as ApiResponse;
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResponse>;
  }

  async get(path: string): Promise<ApiResponse> { return this.send('GET', path); }
  async post(path: string, body?: unknown): Promise<ApiResponse> { return this.send('POST', path, body); }
  async put(path: string, body?: unknown): Promise<ApiResponse> { return this.send('PUT', path, body); }
  async patch(path: string, body?: unknown): Promise<ApiResponse> { return this.send('PATCH', path, body); }
  async delete(path: string): Promise<ApiResponse> { return this.send('DELETE', path); }

  getBaseUrl(): string { return this.baseUrl; }
  getTokenValue(): string | null { return this.token; }
  setToken(t: string): void { this.token = t; }
}
