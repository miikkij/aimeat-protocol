/**
 * @file scripts/lib/fake-mail-server.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The server behind the sandbox's `fake-mail` provider: an OAuth round that approves
 *   itself, and a Gmail-shaped read API over the sample mailbox in fake-mailbox.ts. The sandbox
 *   starts it on its own port (the node's plus 100) and points AIMEAT_CONNECT_FAKE_BASE_URL at it.
 *
 *   It answers what the node's Gmail resources ask for and nothing else: messages (maxResults,
 *   pageToken, and `after:YYYY/MM/DD` in q), one message (format=full), one attachment, the profile,
 *   and /me for the identity lookup. Every read wants a bearer token this server issued.
 * @structure startFakeMailServer(port) · the CLI entry (`tsx scripts/lib/fake-mail-server.ts <port>`)
 * @usage node --import tsx scripts/lib/fake-mail-server.ts 40703
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish sandboxiin-testipostilaatikko).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildMailbox, MAILBOX_ADDRESS } from './fake-mailbox.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolveBody) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolveBody(new URLSearchParams(raw)));
  });
}

/** `after:2026/09/20` in a Gmail query, as epoch milliseconds; everything else in q is ignored. */
function afterOf(q: string): number {
  const m = /after:(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(q);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : 0;
}

export function startFakeMailServer(port: number): Promise<void> {
  const { messages, attachments } = buildMailbox(Date.now());
  const tokens = new Set<string>();
  const issue = () => {
    const access = 'fm-at-' + randomBytes(12).toString('hex');
    tokens.add(access);
    return { access_token: access, refresh_token: 'fm-rt-' + randomBytes(12).toString('hex'), expires_in: 3600, token_type: 'Bearer', scope: 'mail.read' };
  };
  const authorised = (req: IncomingMessage) => tokens.has(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname;
    if (path === '/health') return json(res, 200, { ok: true, messages: messages.length });

    // The consent page approves itself: the sandbox drives this round over HTTP with no person.
    if (path === '/authorize' && req.method === 'GET') {
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', 'fm-code-' + randomBytes(6).toString('hex'));
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.toString() });
      res.end();
      return;
    }
    if (path === '/token' && req.method === 'POST') {
      const form = await readBody(req);
      const grant = form.get('grant_type');
      if (grant === 'authorization_code' || grant === 'refresh_token') return json(res, 200, issue());
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (path === '/revoke') return json(res, 200, {});

    if (!authorised(req)) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (path === '/me') return json(res, 200, { id: MAILBOX_ADDRESS, label: MAILBOX_ADDRESS });

    const base = '/gmail/v1/users/me';
    if (path === `${base}/profile`) return json(res, 200, { emailAddress: MAILBOX_ADDRESS, messagesTotal: messages.length, threadsTotal: messages.length });
    if (path === `${base}/messages`) {
      const max = Math.max(1, Math.min(100, Number(url.searchParams.get('maxResults') ?? 25) || 25));
      const offset = Math.max(0, Number(url.searchParams.get('pageToken') ?? 0) || 0);
      const after = afterOf(url.searchParams.get('q') ?? '');
      const matching = messages.filter((m) => m.internalDate >= after);
      const page = matching.slice(offset, offset + max);
      const next = offset + max < matching.length ? String(offset + max) : undefined;
      return json(res, 200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.id })),
        ...(next ? { nextPageToken: next } : {}),
        resultSizeEstimate: matching.length,
      });
    }
    const att = new RegExp(`^${base}/messages/([A-Za-z0-9_-]+)/attachments/([A-Za-z0-9_-]+)$`).exec(path);
    if (att) {
      const bytes = attachments.get(att[2]);
      if (!bytes) return json(res, 404, { error: { code: 404, message: 'Not Found' } });
      return json(res, 200, { size: bytes.length, data: bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') });
    }
    const one = new RegExp(`^${base}/messages/([A-Za-z0-9_-]+)$`).exec(path);
    if (one) {
      const m = messages.find((x) => x.id === one[1]);
      return m ? json(res, 200, m.json) : json(res, 404, { error: { code: 404, message: 'Not Found' } });
    }
    return json(res, 404, { error: { code: 404, message: 'Not Found' } });
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok()));
}

// Run as a script: the sandbox spawns this detached, beside the node.
if (process.argv[1] && /fake-mail-server\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2]);
  if (!port) { console.error('usage: fake-mail-server.ts <port>'); process.exit(2); }
  await startFakeMailServer(port);
  console.log(`fake mail server on http://127.0.0.1:${port} (${MAILBOX_ADDRESS})`);
}
