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
 *
 *   It also stands in for the two models a refinery batch calls, so the sandbox runs a whole batch
 *   with no paid key: `/v1/systemone` answers a decision in TypeSafe's shape with the sample's known
 *   class, and `/ai/v1/chat/completions` answers an extraction with the sample's known fields.
 * @structure startFakeMailServer(port) · decideAnswer · chatAnswer · the CLI entry (`tsx scripts/lib/fake-mail-server.ts <port>`)
 * @usage node --import tsx scripts/lib/fake-mail-server.ts 40703
 * @version-history
 *   v1.1.0 — 2026-09-29 — The decision and completion stand-ins, recording what each received; a
 *     token from before a restart still reads; port 0 binds any free port and the answer names it
 *     (test/e2e-refinery.ts runs it in process).
 *   v1.0.0 — 2026-09-29 — Initial (wish sandboxiin-testipostilaatikko).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildMailbox, MAILBOX_ADDRESS, SAMPLE_MESSAGES, type SampleMessage } from './fake-mailbox.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolveBody(raw));
  });
}

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readRaw(req));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readRaw(req) || '{}') as Record<string, unknown>; } catch { return {}; }
}

/** The sample a decision request is about: the sender's domain first, then the subject. */
function sampleOfState(state: Record<string, unknown>): SampleMessage | undefined {
  const domain = String(state.from_domain ?? '').toLowerCase();
  const subject = String(state.subject ?? '');
  return SAMPLE_MESSAGES.find((s) => domain && s.from.toLowerCase().includes('@' + domain + '>'))
    ?? SAMPLE_MESSAGES.find((s) => subject && s.subject === subject);
}

/** The sample an extraction prompt is about, by its `Subject:` line. */
function sampleOfPrompt(prompt: string): SampleMessage | undefined {
  return SAMPLE_MESSAGES.find((s) => prompt.includes(`Subject: ${s.subject}\n`));
}

/**
 * The decision model's stand-in (TypeSafe's SystemOne shape): a choice question is answered with the
 * sample's known class at its known certainty, so a batch lands every message in the queue a person
 * would put it in. Any other question type gets a middling answer.
 */
function decideAnswer(body: Record<string, unknown>): Record<string, unknown> {
  const state = (body.state && typeof body.state === 'object' ? body.state : {}) as Record<string, unknown>;
  const sample = sampleOfState(state);
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries((body.questions ?? {}) as Record<string, { type?: string; criteria?: unknown }>)) {
    if (q.type === 'choice' && q.criteria && typeof q.criteria === 'object') {
      const opts = Object.keys(q.criteria);
      const pick = sample && opts.includes(sample.expect) ? sample.expect : (opts.includes('NONE') ? 'NONE' : opts[0]);
      const sure = sample?.sure ?? 0.93;
      const rest = (1 - sure) / Math.max(1, opts.length - 1);
      answers[id] = { type: 'choice', choice: pick, confidence: sure, probabilities: Object.fromEntries(opts.map((o) => [o, o === pick ? sure : rest])) };
    } else if (q.type === 'noul') {
      answers[id] = { type: 'noul', noul: 0.5 };
    } else {
      const levels = Array.isArray(q.criteria) ? q.criteria : [];
      answers[id] = { type: 'score', score: 0, confidence: 0.5, legend: Object.fromEntries(levels.map((l, i) => [String(i), l])) };
    }
  }
  return { model: body.model ?? 'sandbox-decide', answers, usage: { input_tokens: 600, output_tokens: 20 } };
}

/** The text of a chat request's messages, whether each content is a string or a list of parts. */
function promptText(body: Record<string, unknown>): string {
  const msgs = Array.isArray(body.messages) ? body.messages as Array<{ content?: unknown }> : [];
  return msgs.map((m) => (typeof m.content === 'string' ? m.content
    : Array.isArray(m.content) ? (m.content as Array<{ text?: string }>).map((p) => p.text ?? '').join('\n') : '')).join('\n');
}

/** The completion model's stand-in (OpenAI chat shape): an extraction answers with the sample's known fields. */
function chatAnswer(body: Record<string, unknown>): Record<string, unknown> {
  const sample = sampleOfPrompt(promptText(body));
  const content = sample
    ? JSON.stringify({ ...(sample.fields ?? {}), _confidence: sample.sure ?? 0.9, _note: '' })
    : 'The sandbox model answers extraction prompts about the sample mailbox only.';
  return {
    id: 'chatcmpl-sandbox', object: 'chat.completion', model: body.model ?? 'sandbox-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980, cost: 0 },
  };
}

/** `after:2026/09/20` in a Gmail query, as epoch milliseconds; everything else in q is ignored. */
function afterOf(q: string): number {
  const m = /after:(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(q);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : 0;
}

/** A running server: the port it bound (0 asks for any free one), what the model stand-ins received, and a stop. */
export interface FakeMailServer {
  port: number;
  seen: { decide: Record<string, unknown>[]; chat: Record<string, unknown>[] };
  close(): Promise<void>;
}

export function startFakeMailServer(port: number): Promise<FakeMailServer> {
  const { messages, attachments } = buildMailbox(Date.now());
  const seen: FakeMailServer['seen'] = { decide: [], chat: [] };
  const tokens = new Set<string>();
  const issue = () => {
    const access = 'fm-at-' + randomBytes(12).toString('hex');
    tokens.add(access);
    return { access_token: access, refresh_token: 'fm-rt-' + randomBytes(12).toString('hex'), expires_in: 3600, token_type: 'Bearer', scope: 'mail.read' };
  };
  // A token this server issued before a restart is still its own: the sandbox restarts the server
  // with the node, and a connection that stopped reading after every restart is not a test mailbox.
  const authorised = (req: IncomingMessage) => {
    const t = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return tokens.has(t) || /^fm-at-[0-9a-f]{24}$/.test(t);
  };

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

    // The two model stand-ins take any key: the sandbox node sends its own made-up one.
    if (path === '/v1/systemone' && req.method === 'POST') {
      const body = await readJson(req);
      seen.decide.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'x-typesafe-request-id': 'sandbox-' + randomBytes(4).toString('hex') });
      res.end(JSON.stringify(decideAnswer(body)));
      return;
    }
    if (path === '/ai/v1/chat/completions' && req.method === 'POST') {
      const body = await readJson(req);
      seen.chat.push(body);
      return json(res, 200, chatAnswer(body));
    }
    if (path === '/ai/v1/models') return json(res, 200, { data: [{ id: 'sandbox-model', name: 'Sandbox model', context_length: 32000, pricing: { prompt: '0', completion: '0' } }] });

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
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({
    port: (server.address() as { port: number }).port,
    seen,
    close: () => new Promise<void>((done) => server.close(() => done())),
  })));
}

// Run as a script: the sandbox spawns this detached, beside the node.
if (process.argv[1] && /fake-mail-server\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2]);
  if (!port) { console.error('usage: fake-mail-server.ts <port>'); process.exit(2); }
  await startFakeMailServer(port);
  console.log(`fake mail server on http://127.0.0.1:${port} (${MAILBOX_ADDRESS})`);
}
