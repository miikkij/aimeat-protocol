/**
 * @file connect-tunnel-forward.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The forward half of the Connector Forward Tunnel: one `request` frame replayed
 *   through the node's REAL Express stack over loopback, with that identity's own bearer, and the
 *   correlated `response` sent back.
 *
 *   THIS IS THE SECURITY MODEL'S SPINE, which is why it is worth its own file rather than being a
 *   long method in the middle of the manager. The tunnel is not a second implementation of the API:
 *   a forward frame becomes an ordinary HTTP request against the node itself, so `requireAuth`,
 *   `requireScope` and the AIMEAT envelope apply by construction rather than by being remembered
 *   here. Two guards protect that: the resolved origin is pinned to loopback (a protocol-relative
 *   path would otherwise make the node fetch an arbitrary host AND ship the agent's bearer to it),
 *   and only an allowlisted method and header set survive the crossing.
 *
 *   Extracted from connect-tunnel.ts unchanged when one socket carrying many identities pushed that
 *   file past the 800-line ceiling. A pure move: same body, same order, same comments; `this.x`
 *   became `ctx.x` and the method became a function taking what it used to reach for.
 *
 * @structure ForwardContext / ForwardConn — what the dispatch needs · forwardRequest()
 * @usage import { forwardRequest } from './connect-tunnel-forward.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Extracted from connect-tunnel.ts (max-file-lines).
 */
import type { WebSocket } from 'ws';
import type { AimeatConfig } from '../config.js';
import type { ConnectFrame, ConnectTunnelStats } from './connect-tunnel-wire.js';
import type { Fairness } from './connect-tunnel-multiplex.js';
import { logger } from '../utils/logger.js';

/** Just enough of a connection for the dispatch: whose it is, where it writes, what it may use. */
export interface ForwardConn {
  principal: string;
  ws: WebSocket;
  rawToken: string;
}

/** What the manager lends the dispatch. Nothing here is state the dispatch owns. */
export interface ForwardContext {
  config: AimeatConfig;
  stats: ConnectTunnelStats;
  fairness: Fairness;
  loopbackBase: string;
  sendTo: (conn: ForwardConn, frame: ConnectFrame) => void;
}

/**
 * Only these client-supplied request headers are forwarded on the loopback
 * call. Authorization/Host/Cookie are deliberately excluded — the pinned agent
 * JWT is the sole credential, so the tunnel can never be used to escalate past
 * the identity established at upgrade.
 */
const FORWARDABLE_HEADERS = new Set(['content-type', 'accept', 'idempotency-key', 'x-request-id']);

/** Forward dispatch only accepts these HTTP methods. */
const FORWARDABLE_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Forward a tunneled `request` through the real Express stack (loopback
 * self-fetch with the pinned agent bearer) and return the correlated
 * `response`. Scope enforcement + the AIMEAT envelope hold by construction.
 */
export async function forwardRequest(ctx: ForwardContext, conn: ForwardConn, frame: ConnectFrame): Promise<void> {
  const { id } = frame;
  if (!id || typeof frame.method !== 'string' || typeof frame.path !== 'string' || !frame.path.startsWith('/')) {
    ctx.stats.malformedFramesTotal++;
    ctx.sendTo(conn, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'request requires id, method, and an absolute path' });
    return;
  }
  if (!FORWARDABLE_METHODS.has(frame.method.toUpperCase())) {
    ctx.stats.malformedFramesTotal++;
    ctx.sendTo(conn, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: `Unsupported method: ${frame.method}` });
    return;
  }

  // SSRF guard: `path.startsWith('/')` is NOT enough — a protocol-relative path
  // like `//evil.com/x` (or a backslash variant) resolves against the loopback
  // scheme to an off-host origin, which would make the server fetch an arbitrary
  // host AND ship the agent's bearer to it. Pin the resolved origin to loopback.
  let url: URL;
  try {
    url = new URL(frame.path, ctx.loopbackBase);
  } catch {
    ctx.stats.malformedFramesTotal++;
    ctx.sendTo(conn, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'Invalid request path' });
    return;
  }
  if (url.origin !== ctx.loopbackBase) {
    ctx.stats.malformedFramesTotal++;
    logger.warn('Connect tunnel rejected off-host forward path', { event: 'connect_tunnel.ssrf_block', principal: conn.principal, path: frame.path, resolvedOrigin: url.origin });
    ctx.sendTo(conn, { type: 'error', id, code: 'BAD_REQUEST_FRAME', message: 'request path must stay on this node (loopback)' });
    return;
  }

  // ONE IDENTITY MAY NOT FILL A SHARED WIRE. A private socket per agent was natural isolation;
  // this replaces it with a counter. Refused before the fetch, so a runaway costs the node
  // nothing and costs its eleven neighbours nothing.
  if (!ctx.fairness.tryAcquire(conn.principal)) {
    ctx.sendTo(conn, {
      type: 'response', id, status: 429,
      body: {
        ok: false, protocol: 'aimeat', version: 'v1', node: ctx.config.nodeId,
        error: {
          code: 'TUNNEL_TOO_MANY_IN_FLIGHT',
          message: `This agent already has ${ctx.fairness.limitInFlight} calls in flight on this connection. Wait for one to finish.`,
        },
      },
    });
    return;
  }

  ctx.stats.forwardRequestsTotal++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.config.connectTunnelRequestTimeoutMs);

  try {
    if (frame.query) {
      for (const [k, v] of Object.entries(frame.query)) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${conn.rawToken}` };
    if (frame.headers) {
      for (const [k, v] of Object.entries(frame.headers)) {
        if (FORWARDABLE_HEADERS.has(k.toLowerCase())) headers[k] = String(v);
      }
    }
    const hasBody = frame.body !== undefined && frame.body !== null && frame.method.toUpperCase() !== 'GET' && frame.method.toUpperCase() !== 'HEAD';
    if (hasBody && !Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: frame.method,
      headers,
      body: hasBody ? JSON.stringify(frame.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    // The other half of fairness. One agent's enormous answer is one agent's answer, and putting
    // it on a wire eleven others are waiting on delays all of them. Measured on the encoded body
    // because that is what actually occupies the socket.
    if (ctx.fairness.responseTooLarge(Buffer.byteLength(text, 'utf8'))) {
      logger.warn('Connect tunnel response over the per-identity cap', {
        event: 'connect_tunnel.response_too_large', principal: conn.principal,
        path: frame.path, bytes: Buffer.byteLength(text, 'utf8'), cap: ctx.fairness.limitResponseBytes,
      });
      ctx.sendTo(conn, {
        type: 'response', id, status: 502,
        body: {
          ok: false, protocol: 'aimeat', version: 'v1', node: ctx.config.nodeId,
          error: {
            code: 'TUNNEL_RESPONSE_TOO_LARGE',
            message: `That answer is larger than one agent may put on a shared connection (${ctx.fairness.limitResponseBytes} bytes). Ask for less of it, or fetch it over HTTP.`,
          },
        },
      });
      return;
    }
    let body: unknown;
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    ctx.sendTo(conn, { type: 'response', id, status: res.status, body });
  } catch (err) {
    ctx.stats.forwardErrorsTotal++;
    const aborted = err instanceof Error && err.name === 'AbortError';
    logger.warn('Connect tunnel forward dispatch failed', { event: 'connect_tunnel.error', principal: conn.principal, path: frame.path, error: err instanceof Error ? err.message : String(err) });
    ctx.sendTo(conn, {
      type: 'response',
      id,
      status: aborted ? 504 : 502,
      body: {
        ok: false,
        protocol: 'aimeat',
        version: 'v1',
        node: ctx.config.nodeId,
        error: { code: aborted ? 'TUNNEL_TIMEOUT' : 'TUNNEL_DISPATCH_ERROR', message: aborted ? 'Forward request timed out' : 'Forward dispatch failed' },
      },
    });
  } finally {
    clearTimeout(timer);
    // Every path out of the try gives the slot back, including the size refusal above. A leaked
    // slot is a cap that tightens itself until the agent can make no calls at all.
    ctx.fairness.release(conn.principal);
  }
}
