/**
 * @file src/services/request-injector.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's request to itself, dispatched in process: the same HTTP request reaches the
 *   same Express app through the same HTTP server, with no socket.
 *
 *   WHO USES IT. Three code paths run a capability through the node's own routes with a caller's
 *   credential, so that every gate of the route (sign-in, scope, ownership, paywall, envelope) runs
 *   exactly as it does for a request from outside: `aimeat_invoke` and POST /v1/invoke
 *   (services/node-invoke.ts), `aimeat_capabilities_invoke` and `aimeat_app_tool_invoke` over
 *   POST /v1/ext/:name/:action (services/capability-invoke.ts), and the connector tunnel's forward of
 *   an agent's request frame (services/connect-tunnel-forward.ts). Until 2026-11-04 each did this with
 *   a fetch to http://127.0.0.1:<port>, which needed the port to be reachable on loopback, needed the
 *   request to land in the process that sent it (the loopback pass lived in that process's memory),
 *   and went through the TCP stack twice per call.
 *
 *   HOW. The caller uses the platform's own fetch with a dispatcher whose connect step returns one end
 *   of an in-memory stream pair instead of a TCP socket. The other end is handed to the node's HTTP
 *   server as a new connection ('connection' event). From there everything is the ordinary path: the
 *   server's HTTP parser reads the request, the server's request listeners run (the drain's request
 *   count, then the Express app), and the response bytes go back through the client's HTTP parser
 *   into a fetch Response. What fetch sends (its default headers, the body encoding, the decoding of
 *   a compressed answer) and what a caller reads is the same as over the socket.
 *
 *   WHAT IS KEPT THE SAME AS THE SOCKET. The connection reports the remote address a loopback
 *   connection to this server reports (127.0.0.1, or ::ffff:127.0.0.1 on a server listening on
 *   every IPv6 and IPv4 address), so `req.ip`, rate limits and logs read what they read before. It
 *   keeps an idle timeout the way a socket does, because some routes set one (req.setTimeout). The
 *   request runs in a fresh async context, as a request from a socket does: the caller's
 *   request-scoped stores (a storage transaction, the MCP request authority, the read scope) do not
 *   reach it. A dispatch is refused with the error a refused connection gives when the server is not
 *   listening (before start, and from the moment a stop begins to drain) or listens on an address a
 *   connection to 127.0.0.1 does not reach.
 *
 *   THE CALLER'S MARK. A dispatch for a caller marks its connection with the hash of the caller's
 *   bearer (auth/injected-request.ts). A REST route takes a token bound to the MCP endpoint on such a
 *   request, as it took it with the loopback pass; no header carries anything for it.
 *
 *   A node created by createServer registers its app here for its port (server.ts). The process that
 *   listens also hands over its HTTP server (index-start.ts), and the dispatch then goes to that
 *   server. An app that is registered but whose server was not handed over (an in-process test node
 *   that listens on its own) is served by an HTTP server this module creates for it, which never
 *   listens.
 * @structure inProcessOrigin(config) · registerInProcessApp(port, app) · noteListeningServer(port, server) ·
 *   withInProcessFetch(config, { forBearer }, run)
 * @usage
 *   const out = await withInProcessFetch(config, { forBearer: jwt }, async (fetchIn) => {
 *     const res = await fetchIn(`/v1/ext/${name}/${action}`, { method: 'POST', headers, body });
 *     return { status: res.status, body: await res.json() };
 *   });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item D-j).
 */
import http, { type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { duplexPair, type Duplex } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Agent } from 'undici';
import { markInjectedConnection } from '../auth/injected-request.js';
import { logger } from '../utils/logger.js';

/**
 * The async context a connection from a socket starts in: no request's stores. Taken when this
 * module loads, which is at start, before any request or node context exists.
 */
const inFreshContext = AsyncLocalStorage.snapshot();

interface Target {
  app: RequestListener;
  /** The process's listening HTTP server for this port, once index-start.ts hands it over. */
  server: Server | null;
  /** A server of this module's own for an app whose listening server was not handed over. Never listens. */
  own: Server | null;
}

// process-local: this process's own app per port; a dispatch is for the process that sends it, by design.
const targets = new Map<number, Target>();

/**
 * The origin a request to this node in process is addressed to: what the loopback fetch used, so the
 * Host header and every URL built from it read as before. No socket is opened to it.
 */
export function inProcessOrigin(config: { port: number }): string {
  return `http://127.0.0.1:${config.port}`;
}

/** The app that answers requests for this port in this process. server.ts calls it once per node. */
export function registerInProcessApp(port: number, app: RequestListener): void {
  targets.set(port, { app, server: null, own: null });
}

/** The listening HTTP server of the app registered for this port. index-start.ts calls it after listen(). */
export function noteListeningServer(port: number, server: Server): void {
  const target = targets.get(port);
  if (target) target.server = server;
}

/** The error a fetch to a port nobody answers on carries as its cause. */
function refused(port: number): Error {
  return Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), {
    code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port,
  });
}

/**
 * Where a connection to 127.0.0.1 on this server appears to come from, or null when such a
 * connection would be refused: the server is not listening, or listens on an address 127.0.0.1 does
 * not reach. A server of this module's own answers as one listening on 127.0.0.1.
 */
function remoteOf(target: Target): { address: string; family: 'IPv4' | 'IPv6' } | null {
  if (!target.server) return { address: '127.0.0.1', family: 'IPv4' };
  if (!target.server.listening) return null;
  const bound = target.server.address() as AddressInfo | string | null;
  if (!bound || typeof bound === 'string') return null;
  if (bound.address === '::') return { address: '::ffff:127.0.0.1', family: 'IPv6' };
  if (bound.address === '0.0.0.0' || bound.address === '127.0.0.1') return { address: '127.0.0.1', family: 'IPv4' };
  return null;
}

/**
 * Give the server side of the stream pair what the HTTP server and the routes read from a socket:
 * the addresses, and an idle timeout (req.setTimeout and res.setTimeout set the socket's) that emits
 * 'timeout' after that long without traffic, as net.Socket does. Returns the function that marks
 * traffic arriving at the server.
 */
function asConnection(end: Duplex, remote: { address: string; family: 'IPv4' | 'IPv6' }, port: number): () => void {
  let idleMs = 0;
  let timer: NodeJS.Timeout | null = null;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (idleMs > 0) {
      timer = setTimeout(() => end.emit('timeout'), idleMs);
      timer.unref();
    }
  };
  Object.assign(end, {
    remoteAddress: remote.address, remoteFamily: remote.family, remotePort: 0,
    localAddress: remote.address, localFamily: remote.family, localPort: port,
    setTimeout(ms: number, callback?: () => void): Duplex {
      idleMs = ms > 0 ? ms : 0;
      if (callback) {
        if (idleMs === 0) end.removeListener('timeout', callback);
        else end.once('timeout', callback);
      }
      arm();
      return end;
    },
    setNoDelay: (): Duplex => end,
    setKeepAlive: (): Duplex => end,
    ref: (): Duplex => end,
    unref: (): Duplex => end,
  });
  const write = end.write.bind(end) as (...args: unknown[]) => boolean;
  (end as unknown as { write: (...args: unknown[]) => boolean }).write = (...args: unknown[]): boolean => {
    if (idleMs > 0) arm();
    return write(...args);
  };
  end.once('close', () => { if (timer) clearTimeout(timer); timer = null; });
  return () => { if (idleMs > 0) arm(); };
}

/** One in-process connection to the target: the client end for the dispatcher, the server end to the server. */
function connect(target: Target, port: number, bearer: string | null, callback: (err: Error | null, socket: Duplex | null) => void): void {
  const remote = remoteOf(target);
  if (!remote) { setImmediate(() => callback(refused(port), null)); return; }
  const [clientEnd, serverEnd] = duplexPair();
  const traffic = asConnection(serverEnd, remote, port);
  markInjectedConnection(serverEnd, bearer);
  // Every chunk the client writes reaches the server in a fresh async context, so the server's
  // parser, the 'request' event and everything the app runs for it start with no store of the
  // caller's, as they do for a request read from a socket.
  const push = serverEnd.push.bind(serverEnd);
  serverEnd.push = (chunk: unknown, encoding?: BufferEncoding): boolean => {
    traffic();
    return inFreshContext(() => push(chunk, encoding));
  };
  // A socket closed at one end is closed at the other; the stream pair does not do that by itself.
  // Without it a connection the client dropped (the dispatch ended, or a timeout aborted it) would
  // stay open on the server, and the server would never see the request end.
  clientEnd.once('close', () => inFreshContext(() => serverEnd.destroy()));
  serverEnd.once('close', () => clientEnd.destroy());
  const server = target.server ?? (target.own ??= http.createServer(target.app));
  inFreshContext(() => server.emit('connection', serverEnd));
  // The dispatcher expects the connect step to finish later, as a socket's does.
  setImmediate(() => callback(null, clientEnd));
}

/** A fetch whose path is node-relative and whose request goes to this node in process. */
export type InProcessFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Run `run` with a fetch that reaches this node's own app in process. `forBearer` marks every
 * request it sends as the node's dispatch for that caller's bearer (auth/injected-request.ts).
 * The connections end when `run` settles, so `run` reads every body it needs before it returns.
 * Without a registered app for `config.port` the fetch fails as a fetch to a closed port does.
 */
export async function withInProcessFetch<T>(
  config: { port: number },
  opts: { forBearer?: string | null },
  run: (fetchIn: InProcessFetch) => Promise<T>,
): Promise<T> {
  const port = config.port;
  const origin = inProcessOrigin(config);
  const agent = new Agent({
    connect: (_options, callback) => {
      const target = targets.get(port);
      if (!target) { setImmediate(() => callback(refused(port), null)); return; }
      connect(target, port, opts.forBearer ?? null, callback as (err: Error | null, socket: Duplex | null) => void);
    },
  });
  const fetchIn: InProcessFetch = (path, init) =>
    fetch(path.startsWith(origin) ? path : `${origin}${path}`, { ...init, dispatcher: agent } as RequestInit);
  try {
    return await run(fetchIn);
  } finally {
    // The call's answer is already read; a failure to close the in-memory connections is logged.
    await agent.destroy().catch((err: unknown) => logger.debug('request-injector: closing the in-process connections failed', { error: String(err) }));
  }
}
