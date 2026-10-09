/**
 * @file src/auth/ws-upgrade.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is opening this WebSocket: the one credential check the three upgrade code paths in
 *   index-start.ts share (`/v1/realtime/ws`, `/v1/personal/tunnel`, `/v1/connect/tunnel`). Express
 *   middleware does not run on a raw upgrade, so the token is read and verified here by hand, with the
 *   same revocation questions requireAuth asks (credentialRevoked).
 *
 *   A credential arrives one of three ways, tried in this order:
 *   - `Authorization: Bearer <jwt>`: the connector and any server-side client. Never logged.
 *   - `?ticket=<single-use ticket>` from POST /v1/ws/ticket: the browser path, because a browser
 *     WebSocket cannot set a header. The ticket names one socket kind and is spent on first use.
 *   - `?token=<jwt>`: DEPRECATED. A URL is written to every reverse proxy's access log, so this put a
 *     live session token in those logs (secrets audit 2026-10-09, d3). Controlled by
 *     AIMEAT_WS_QUERY_TOKEN (config.wsQueryToken): default on in 3.x, removed in 4.0.0. When off it is
 *     refused with WS_QUERY_TOKEN_DISABLED. Each accepted use is counted in the stats counter family
 *     `ws_query_token` (by socket kind, GET /v1/stats) and logged at most once a day, so the switch-off
 *     can be decided on data.
 *
 *   A refusal is written as a plain HTTP answer on the socket with the code in an `X-AIMEAT-Error`
 *   header and the AIMEAT error envelope as the body (refuseUpgrade). A browser does not expose either,
 *   but a server-side client and a test can read why.
 * @structure SOCKET_KINDS · isSocketKind · SOCKET_TICKET_TTL_SECONDS · mintSocketTicket ·
 *   authenticateUpgrade · refuseUpgrade
 * @usage
 *   const auth = await authenticateUpgrade(request, url, 'personal-tunnel', config.wsQueryToken);
 *   if (auth.outcome === 'refused') { refuseUpgrade(socket, auth.status, auth.code, auth.message); return; }
 *   if (auth.outcome === 'none') { refuseUpgrade(socket, 401, 'AUTH_REQUIRED'); return; }
 *   const { payload, token } = auth;
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial: the single-use socket ticket and the deprecated query token
 *     (secrets audit 2026-10-09, d3).
 */
import { STATUS_CODES, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { verifyJWT, type VerifiedToken } from './jwt.js';
import { credentialRevoked } from './middleware.js';
import { createSingleUseTicketStore } from '../services/single-use-tickets.js';
import { getStats } from '../services/stats.js';
import { logger } from '../utils/logger.js';

/** The WebSocket endpoints a ticket can be minted for. One ticket opens one kind and no other. */
export const SOCKET_KINDS = ['realtime', 'personal-tunnel', 'connect-tunnel'] as const;
export type SocketKind = (typeof SOCKET_KINDS)[number];

export function isSocketKind(v: unknown): v is SocketKind {
  return typeof v === 'string' && (SOCKET_KINDS as readonly string[]).includes(v);
}

/** Long enough for a client on a slow link to POST and then open, short enough to be dead in any log. */
export const SOCKET_TICKET_TTL_SECONDS = 60;

interface SocketTicket {
  socket: SocketKind;
  /**
   * The bearer the ticket was minted with. Kept in this process's memory only, for the life of the
   * ticket, because the upgrade re-verifies it (an expired or revoked token opens nothing) and the
   * connect tunnel reuses it as the bearer of every forwarded call.
   */
  token: string;
  /** The principal that minted the ticket; the re-verified token must name the same one. */
  sub: string;
}

const socketTickets = createSingleUseTicketStore<SocketTicket>();

/** Mint a ticket for one socket kind. `token` is the caller's verified JWT, `sub` its principal. */
export function mintSocketTicket(socket: SocketKind, token: string, sub: string): string {
  return socketTickets.mint({ socket, token, sub }, SOCKET_TICKET_TTL_SECONDS * 1000);
}

export type UpgradeAuth =
  | { outcome: 'none' }
  | { outcome: 'refused'; status: 401; code: string; message: string }
  | { outcome: 'verified'; token: string; payload: VerifiedToken; via: 'header' | 'ticket' | 'query' };

function refused(code: string, message: string): UpgradeAuth {
  return { outcome: 'refused', status: 401, code, message };
}

let lastQueryTokenNoticeDay = '';

/** One accepted ?token= upgrade: counted always, logged at most once a day. Neither carries the URL. */
function noteQueryTokenUse(socket: SocketKind): void {
  getStats()?.incrementTyped('ws_query_token', socket);
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastQueryTokenNoticeDay) return;
  lastQueryTokenNoticeDay = day;
  logger.warn(
    'A WebSocket upgrade carried a session token in its URL (?token=). This is deprecated and removed in 4.0.0, '
    + 'because reverse proxies log URLs. Clients should POST /v1/ws/ticket and connect with ?ticket=. '
    + 'GET /v1/stats counts the uses (ws_query_token); AIMEAT_WS_QUERY_TOKEN=false refuses them. Logged once a day.',
    { socket },
  );
}

/**
 * Read and verify the credential of one WebSocket upgrade. Returns `none` when the request carries no
 * credential at all (the realtime endpoint lets that in under anonymous mode), `refused` when it carries
 * one that does not hold, and `verified` with the token and its payload otherwise.
 */
export async function authenticateUpgrade(
  request: IncomingMessage,
  url: URL,
  socket: SocketKind,
  queryTokenAllowed: boolean,
): Promise<UpgradeAuth> {
  const header = request.headers.authorization;
  const ticketParam = url.searchParams.get('ticket');
  const queryToken = url.searchParams.get('token');

  let token: string;
  let via: 'header' | 'ticket' | 'query';
  let ticketSub: string | null = null;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    token = header.slice(7);
    via = 'header';
  } else if (ticketParam !== null) {
    const t = socketTickets.take(ticketParam);
    if (!t) return refused('INVALID_TICKET', 'The ticket is unknown, expired or already used. POST /v1/ws/ticket for a new one.');
    if (t.socket !== socket) return refused('TICKET_WRONG_SOCKET', `This ticket was minted for the ${t.socket} socket, not ${socket}.`);
    token = t.token;
    ticketSub = t.sub;
    via = 'ticket';
  } else if (queryToken !== null) {
    if (!queryTokenAllowed) {
      return refused('WS_QUERY_TOKEN_DISABLED', 'This node does not take a session token in the URL. POST /v1/ws/ticket and connect with ?ticket=, or send an Authorization header.');
    }
    token = queryToken;
    via = 'query';
  } else {
    return { outcome: 'none' };
  }

  const payload = await verifyJWT(token);
  if (!payload || !payload.sub) return refused('INVALID_TOKEN', 'The token is invalid or expired.');
  if (await credentialRevoked(token, payload)) return refused('CREDENTIAL_REVOKED', 'The credential is no longer valid.');
  if (ticketSub !== null && payload.sub !== ticketSub) return refused('INVALID_TICKET', 'The ticket does not match its credential.');
  if (via === 'query') noteQueryTokenUse(socket);
  return { outcome: 'verified', token, payload, via };
}

/**
 * Refuse an upgrade with a plain HTTP answer and close the socket. `code` goes in an X-AIMEAT-Error
 * header and in the AIMEAT error envelope of the body; without a code the answer is the bare status
 * line the upgrade code paths have always written.
 */
export function refuseUpgrade(socket: Duplex, status: number, code?: string, message?: string): void {
  const reason = STATUS_CODES[status] ?? 'Error';
  if (!code) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  } else {
    const body = JSON.stringify({ ok: false, error: { code, message: message ?? reason } });
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n`
      + `X-AIMEAT-Error: ${code}\r\n`
      + 'Content-Type: application/json\r\n'
      + `Content-Length: ${Buffer.byteLength(body)}\r\n`
      + 'Connection: close\r\n\r\n'
      + body,
    );
  }
  socket.destroy();
}
