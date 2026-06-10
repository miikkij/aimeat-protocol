/**
 * @file tunnel-harness.ts
 * @description Reusable WebSocket test client for the Connector Forward Tunnel
 *   (`/v1/connect/tunnel`). The first live-WS-driving harness in the suite —
 *   reused by every tunnel E2E. Opens the tunnel with an agent JWT, sends
 *   id-correlated `request` frames and awaits the matching `response`, buffers
 *   inbound `deliver`/`backlog`/`error` frames for inspection, sends `ack`,
 *   and can force-drop + reconnect.
 * @usage
 *   const t = await TunnelClient.connect(BASE, agentToken);
 *   const r = await t.request('GET', '/v1/memory');
 *   const d = await t.waitForDeliver(1000);
 *   await t.close();
 * @version-history
 *   v1.0.0 — 2026-06-10 — Phase 1 harness (forward request/response, welcome,
 *     heartbeat, buffered inbound frames, reconnect).
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

export interface TunnelFrame {
  type: string;
  id?: string;
  method?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  status?: number;
  kind?: string;
  payload?: unknown;
  code?: string;
  message?: string;
  timestamp?: string;
}

export interface ForwardResponse {
  status: number;
  body: any;
}

function wsBase(httpBase: string): string {
  return httpBase.replace(/^http/, 'ws').replace(/\/+$/, '');
}

export class TunnelClient {
  private ws!: WebSocket;
  private pending = new Map<string, (f: TunnelFrame) => void>();
  /** All inbound deliver frames, in arrival order. */
  readonly delivers: TunnelFrame[] = [];
  /** All inbound backlog frames, in arrival order. */
  readonly backlogs: TunnelFrame[] = [];
  /** All inbound error frames, in arrival order. */
  readonly errors: TunnelFrame[] = [];
  welcome: TunnelFrame | null = null;

  private constructor(
    private readonly httpBase: string,
    private readonly token: string,
  ) {}

  static async connect(httpBase: string, token: string): Promise<TunnelClient> {
    const c = new TunnelClient(httpBase, token);
    await c.open();
    return c;
  }

  private open(): Promise<void> {
    const url = `${wsBase(this.httpBase)}/v1/connect/tunnel?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const onWelcome = (f: TunnelFrame) => { this.welcome = f; resolve(); };
      let welcomed = false;
      this.ws.on('message', (data) => {
        let frame: TunnelFrame;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        switch (frame.type) {
          case 'welcome': if (!welcomed) { welcomed = true; onWelcome(frame); } break;
          case 'response':
          case 'heartbeat_ack': {
            if (frame.id && this.pending.has(frame.id)) {
              this.pending.get(frame.id)!(frame);
              this.pending.delete(frame.id);
            }
            break;
          }
          case 'deliver': this.delivers.push(frame); break;
          case 'backlog': this.backlogs.push(frame); break;
          case 'error': this.errors.push(frame); break;
          default: break;
        }
      });
      this.ws.on('error', (err) => { if (!welcomed) reject(err); });
      this.ws.on('close', () => { if (!welcomed) reject(new Error('closed before welcome')); });
    });
  }

  /** Send a forward request and resolve with the correlated response. */
  request(method: string, path: string, opts: { body?: unknown; query?: Record<string, string>; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<ForwardResponse> {
    const id = randomUUID();
    const frame: TunnelFrame = { type: 'request', id, method, path, query: opts.query, headers: opts.headers, body: opts.body };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`request ${method} ${path} timed out`)); }, opts.timeoutMs ?? 5000);
      this.pending.set(id, (f) => { clearTimeout(timer); resolve({ status: f.status ?? 0, body: f.body }); });
      this.ws.send(JSON.stringify(frame));
    });
  }

  /** Send a heartbeat and await the heartbeat_ack. */
  heartbeat(timeoutMs = 3000): Promise<TunnelFrame> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('heartbeat ack timed out')); }, timeoutMs);
      this.pending.set(id, (f) => { clearTimeout(timer); resolve(f); });
      this.ws.send(JSON.stringify({ type: 'heartbeat', id, timestamp: new Date().toISOString() }));
    });
  }

  /** Send a raw frame (for malformed-frame tests). */
  sendRaw(text: string): void { this.ws.send(text); }

  /** Send an ack for a delivered item. */
  ack(id: string): void { this.ws.send(JSON.stringify({ type: 'ack', id })); }

  // Per-buffer read cursors so each frame is consumed exactly once — independent
  // of whether it arrived before or after the corresponding wait call (the frame
  // can land during an awaited request/connect).
  private deliverCursor = 0;
  private backlogCursor = 0;
  private errorCursor = 0;

  /** Return the next unconsumed deliver frame, waiting up to timeoutMs for one. */
  async waitForDeliver(timeoutMs = 1000): Promise<TunnelFrame | null> {
    return this.nextFrame(this.delivers, () => this.deliverCursor, (n) => { this.deliverCursor = n; }, timeoutMs);
  }
  async waitForError(timeoutMs = 1000): Promise<TunnelFrame | null> {
    return this.nextFrame(this.errors, () => this.errorCursor, (n) => { this.errorCursor = n; }, timeoutMs);
  }
  async waitForBacklog(timeoutMs = 1500): Promise<TunnelFrame | null> {
    return this.nextFrame(this.backlogs, () => this.backlogCursor, (n) => { this.backlogCursor = n; }, timeoutMs);
  }

  private async nextFrame(buf: TunnelFrame[], getCursor: () => number, setCursor: (n: number) => void, timeoutMs: number): Promise<TunnelFrame | null> {
    const start = Date.now();
    for (;;) {
      const cursor = getCursor();
      if (cursor < buf.length) { setCursor(cursor + 1); return buf[cursor]; }
      if (Date.now() - start >= timeoutMs) return null;
      await new Promise(r => setTimeout(r, 10));
    }
  }

  /** Abruptly terminate the socket (simulate a network drop, no close frame). */
  drop(): void { this.ws.terminate(); }

  /** Gracefully close. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.once('close', () => resolve());
      try { this.ws.close(); } catch { resolve(); }
    });
  }
}
