/**
 * @file client.ts
 * @description Thin AIMEAT REST client for the SynthTraces harness. Implements
 *   the programmatic setup recipe proven in test/api-full.ts (register owner ->
 *   owner token -> register agent -> agent token) plus the memory / message /
 *   task-lifecycle calls the self-play loop drives. All responses are normalised
 *   to {ok,status,...} so the tool dispatcher and trace stay transport-agnostic.
 * @structure
 *   - AimeatClient: request(), setup(), memory*, message*, task* methods
 *   - Creds (type)
 * @usage
 *   const client = new AimeatClient(baseUrl, nodeId);
 *   const creds = await client.setup({ ownerName, agentName });
 * @version-history
 *   v0.1.0 -- 2026-06-05 -- Initial PoC (REST transport)
 */

import { signMsg } from './sign.js';

export interface Creds {
  owner: string;
  ownerToken: string;
  agentName: string;
  agentGaii: string;
  agentToken: string;
}

interface RawResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function errMsg(r: RawResult): string {
  const e = r.body?.error as { message?: string } | undefined;
  return e?.message ?? (r.body?._raw as string) ?? `HTTP ${r.status}`;
}

export class AimeatClient {
  constructor(private baseUrl: string, private nodeId: string) {}

  updateNodeId(id: string): void {
    this.nodeId = id;
  }

  async request(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<RawResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json')
      ? ((await res.json()) as Record<string, unknown>)
      : { _raw: await res.text() };
    return { ok: body.ok === true || (res.ok && body.ok !== false), status: res.status, body };
  }

  /** Best-effort node-id detection from the bootstrap endpoint. */
  async detectNodeId(): Promise<string | undefined> {
    try {
      const r = await this.request('GET', '/');
      const b = r.body as Record<string, unknown>;
      const thisNode = (b.this_node ?? (b.data as Record<string, unknown>)?.this_node) as
        | Record<string, unknown>
        | undefined;
      const id =
        (thisNode?.node_id as string) ??
        (thisNode?.id as string) ??
        (b.node as string) ??
        (b.node_id as string);
      return typeof id === 'string' && id.length > 0 ? id : undefined;
    } catch {
      return undefined;
    }
  }

  async setup(opts: { ownerName: string; agentName: string; scopes?: string[] }): Promise<Creds> {
    const { ownerName, agentName } = opts;
    const scopes = opts.scopes ?? ['*'];

    // 1. Register owner.
    const reg = await this.request('POST', '/v1/owners', {
      body: { name: ownerName, public_key: 'placeholder' },
    });
    const ownerPriv = (reg.body.data as Record<string, unknown>)?.private_key as string;
    if (!reg.ok || !ownerPriv) throw new Error(`owner register failed: ${errMsg(reg)}`);

    // 2. Owner token (sign owner + nodeId + timestamp).
    const ots = new Date().toISOString();
    const osig = await signMsg(ownerPriv, ownerName + this.nodeId + ots);
    const otk = await this.request('POST', '/v1/auth/token', {
      body: { owner: ownerName, timestamp: ots, signature: osig },
    });
    const ownerToken = (otk.body.data as Record<string, unknown>)?.token as string;
    if (!ownerToken) throw new Error(`owner token failed: ${errMsg(otk)}`);

    // 3. Register agent under the owner.
    const areg = await this.request('POST', '/v1/agents', {
      token: ownerToken,
      body: { name: agentName, owner: ownerName, capabilities: ['memory', 'messages'], model: 'synthtraces', scopes },
    });
    const agent = (areg.body.data as Record<string, unknown>)?.agent as Record<string, unknown>;
    const agentGaii = agent?.gaii as string;
    const agentPriv = (areg.body.data as Record<string, unknown>)?.private_key as string;
    if (!areg.ok || !agentGaii || !agentPriv) throw new Error(`agent register failed: ${errMsg(areg)}`);

    // 4. Agent token (sign gaii + timestamp).
    const ats = new Date().toISOString();
    const asig = await signMsg(agentPriv, agentGaii + ats);
    const atk = await this.request('POST', '/v1/auth/token', {
      body: { gaii: agentGaii, timestamp: ats, signature: asig },
    });
    const agentToken = (atk.body.data as Record<string, unknown>)?.token as string;
    if (!agentToken) throw new Error(`agent token failed: ${errMsg(atk)}`);

    return { owner: ownerName, ownerToken, agentName, agentGaii, agentToken };
  }

  // ── Memory ──
  async memoryWrite(token: string, m: { key: string; value: unknown; visibility?: string }) {
    const r = await this.request('POST', '/v1/memory', {
      token,
      body: { key: m.key, value: m.value, visibility: m.visibility ?? 'private' },
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : errMsg(r) };
  }

  async memoryRead(token: string, key: string) {
    const r = await this.request('GET', `/v1/memory/${encodeURIComponent(key)}`, { token });
    const d = r.body.data as Record<string, unknown> | undefined;
    const value = d?.value ?? (d?.entry as Record<string, unknown>)?.value ?? d;
    return { ok: r.ok, status: r.status, value, message: r.ok ? undefined : errMsg(r) };
  }

  async memoryList(token: string, prefix?: string) {
    const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const r = await this.request('GET', `/v1/memory${q}`, { token });
    const items = ((r.body.data as Record<string, unknown>)?.items as Record<string, unknown>[]) ?? [];
    return { ok: r.ok, status: r.status, keys: items.map((i) => i.key), message: r.ok ? undefined : errMsg(r) };
  }

  // ── Messages (owner <-> agent) ──
  async sendMessage(
    token: string,
    agentName: string,
    m: { direction: 'inbound' | 'outbound'; content: string; thread_id?: string; linked_task_id?: string },
  ) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/messages`, {
      token,
      body: m,
    });
    const msg = (r.body.data as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    return {
      ok: r.ok,
      status: r.status,
      id: msg?.id as string | undefined,
      threadId: msg?.threadId as string | undefined,
      message: r.ok ? undefined : errMsg(r),
    };
  }

  async getInbox(token: string, agentName: string) {
    const r = await this.request('GET', `/v1/agents/${encodeURIComponent(agentName)}/messages/inbox`, { token });
    const messages = ((r.body.data as Record<string, unknown>)?.messages as Record<string, unknown>[]) ?? [];
    return { ok: r.ok, status: r.status, messages };
  }

  // ── Tasks (the trace container) ──
  async createTask(
    ownerToken: string,
    agentName: string,
    t: { title: string; description: string },
  ) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/tasks`, {
      token: ownerToken,
      body: { title: t.title, description: t.description, status: 'queued' },
    });
    const d = r.body.data as Record<string, unknown> | undefined;
    const task = (d?.task as Record<string, unknown>) ?? d;
    return { ok: r.ok, status: r.status, taskId: task?.id as string | undefined, message: r.ok ? undefined : errMsg(r) };
  }

  async startTask(token: string, agentName: string, taskId: string) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}/start`, { token });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : errMsg(r) };
  }

  async taskEvent(
    token: string,
    agentName: string,
    taskId: string,
    e: { type: string; message: string; details?: Record<string, unknown> },
  ) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}/event`, {
      token,
      body: e,
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : errMsg(r) };
  }

  async completeTask(token: string, agentName: string, taskId: string, message: string) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}/complete`, {
      token,
      body: { message },
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : errMsg(r) };
  }

  async failTask(token: string, agentName: string, taskId: string, reason: string) {
    const r = await this.request('POST', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}/fail`, {
      token,
      body: { reason, message: reason },
    });
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : errMsg(r) };
  }

  async getTask(token: string, agentName: string, taskId: string) {
    const r = await this.request('GET', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}`, { token });
    const d = r.body.data as Record<string, unknown> | undefined;
    const task = ((d?.task as Record<string, unknown>) ?? d) as Record<string, unknown> | undefined;
    return { ok: r.ok, status: r.status, task };
  }

  async getTaskEvents(token: string, agentName: string, taskId: string) {
    const r = await this.request('GET', `/v1/agents/${encodeURIComponent(agentName)}/tasks/${taskId}/events`, { token });
    const d = r.body.data as Record<string, unknown> | undefined;
    const events = ((d?.events as unknown[]) ?? (d?.items as unknown[]) ?? []) as unknown[];
    return { ok: r.ok, status: r.status, events };
  }
}
