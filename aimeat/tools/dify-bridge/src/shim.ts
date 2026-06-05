/**
 * @file shim.ts
 * @description Dify ↔ AIMEAT bridge shim. Receives AIMEAT capability-invoke webhooks
 *   (source.type 'manual') and translates them into a Dify Service API call, then maps the
 *   Dify response back into the { result } shape AIMEAT expects. This is the Direction-2
 *   ("AIMEAT calls Dify") translation layer described in
 *   docs/integrations/dify-hello-integration.md §6. Zero external dependencies (node:http +
 *   global fetch). Supports DIFY_MODE=mock for testing the full loop without a live Dify.
 * @structure handle() request handler; callDify()/mockDify(); startServer().
 * @usage
 *   # from the aimeat/ dir, with env set (see .env.example):
 *   pnpm exec node --import tsx tools/dify-bridge/src/shim.ts
 * @version-history
 *   v1.0.0 - 2026-06-05 - Initial bridge shim (Dify integration prototype).
 */
import http from 'node:http';

interface AimeatWebhookBody {
  input: Record<string, unknown>;
  caller: string;
  capability: string;
}

const env = (k: string, d = ''): string => process.env[k] ?? d;

const PORT = parseInt(env('SHIM_PORT', '8787'), 10);
const PATH = env('SHIM_PATH', '/invoke');
const EXPECTED_NODE_ID = env('EXPECTED_NODE_ID'); // optional: reject other nodes
const URL_SECRET = env('SHIM_URL_SECRET'); // optional: ?key= guard (non-public caps only)
const MAX_SKEW_SECONDS = parseInt(env('MAX_SKEW_SECONDS', '300'), 10);

const DIFY_MODE = env('DIFY_MODE', 'mock'); // 'mock' | 'live'
const DIFY_BASE_URL = env('DIFY_BASE_URL', 'https://api.dify.ai').replace(/\/+$/, '');
const DIFY_APP_KEY = env('DIFY_APP_KEY');
const DIFY_APP_TYPE = env('DIFY_APP_TYPE', 'workflow'); // 'workflow' | 'chat'
const DIFY_QUERY_FIELD = env('DIFY_QUERY_FIELD', 'query'); // chat mode: which input field is the query
const DIFY_TIMEOUT_MS = parseInt(env('DIFY_TIMEOUT_MS', '9000'), 10); // below AIMEAT's 10s ceiling

function log(...args: unknown[]): void {
  // never log DIFY_APP_KEY / secrets
  console.log(new Date().toISOString(), ...args);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

/** Mock Dify response — lets you exercise the full AIMEAT→shim→back loop with no Dify creds. */
function mockDify(body: AimeatWebhookBody): Record<string, unknown> {
  return {
    summary: `MOCK summary of: ${JSON.stringify(body.input).slice(0, 120)}`,
    echo: body.input,
    caller: body.caller,
    capability: body.capability,
    mode: 'mock',
  };
}

/** Call the real Dify Service API and normalize the result. Throws on failure. */
async function callDify(body: AimeatWebhookBody): Promise<Record<string, unknown>> {
  if (!DIFY_APP_KEY) throw new Error('DIFY_APP_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIFY_TIMEOUT_MS);
  try {
    if (DIFY_APP_TYPE === 'chat') {
      const query =
        (body.input[DIFY_QUERY_FIELD] as string) ??
        (body.input.query as string) ??
        JSON.stringify(body.input);
      const resp = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DIFY_APP_KEY}` },
        body: JSON.stringify({
          query,
          inputs: {},
          response_mode: 'blocking',
          user: body.caller,
          ...(body.input.conversation_id ? { conversation_id: body.input.conversation_id } : {}),
        }),
        signal: controller.signal,
      });
      const data = (await resp.json()) as Record<string, unknown>;
      if (!resp.ok) throw new Error(`Dify chat ${resp.status}: ${(data.message as string) ?? 'error'}`);
      return { answer: data.answer, conversation_id: data.conversation_id, message_id: data.message_id };
    }

    // default: workflow app
    const resp = await fetch(`${DIFY_BASE_URL}/v1/workflows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DIFY_APP_KEY}` },
      body: JSON.stringify({ inputs: body.input, response_mode: 'blocking', user: body.caller }),
      signal: controller.signal,
    });
    const data = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) throw new Error(`Dify workflow ${resp.status}: ${(data.message as string) ?? 'error'}`);
    const run = (data.data ?? {}) as Record<string, unknown>;
    if (run.status && run.status !== 'succeeded') {
      throw new Error(`Dify workflow status=${String(run.status)}: ${(run.error as string) ?? 'failed'}`);
    }
    return (run.outputs as Record<string, unknown>) ?? {};
  } finally {
    clearTimeout(timer);
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true, mode: DIFY_MODE, appType: DIFY_APP_TYPE });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== PATH) {
    send(res, 404, { error: 'Not found' });
    return;
  }

  // ── Guards (see §6d) ──
  if (EXPECTED_NODE_ID) {
    const node = req.headers['x-aimeat-node'];
    if (node !== EXPECTED_NODE_ID) {
      log('reject: unexpected node', node);
      send(res, 403, { error: 'Unexpected AIMEAT node' });
      return;
    }
  }
  const ts = req.headers['x-aimeat-timestamp'];
  if (typeof ts === 'string' && MAX_SKEW_SECONDS > 0) {
    const skew = Math.abs(Date.now() - Date.parse(ts)) / 1000;
    if (Number.isFinite(skew) && skew > MAX_SKEW_SECONDS) {
      log('reject: stale timestamp, skew=', Math.round(skew), 's');
      send(res, 403, { error: 'Stale timestamp' });
      return;
    }
  }
  if (URL_SECRET && url.searchParams.get('key') !== URL_SECRET) {
    log('reject: bad url secret');
    send(res, 403, { error: 'Forbidden' });
    return;
  }

  let body: AimeatWebhookBody;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as AimeatWebhookBody;
  } catch (e) {
    send(res, 400, { error: 'Invalid JSON body', detail: (e as Error).message });
    return;
  }
  if (!body || typeof body.input !== 'object' || body.input === null) {
    send(res, 400, { error: 'Body must include an "input" object' });
    return;
  }

  log('invoke', { capability: body.capability, caller: body.caller, mode: DIFY_MODE });

  try {
    const result = DIFY_MODE === 'live' ? await callDify(body) : mockDify(body);
    // AIMEAT (normal mode) returns body.result to the caller.
    send(res, 200, { result });
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'Dify call timed out' : (e as Error).message;
    log('dify error:', msg);
    // 502 → AIMEAT marks the capability invoke as errored (WEBHOOK_ERROR).
    send(res, 502, { error: 'Dify call failed', detail: msg });
  }
}

function startServer(): void {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log('handler crash:', (e as Error).message);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    });
  });
  server.listen(PORT, () => {
    log(`dify-bridge shim listening on http://127.0.0.1:${PORT}${PATH}  (mode=${DIFY_MODE}, app=${DIFY_APP_TYPE})`);
    if (DIFY_MODE === 'live' && !DIFY_APP_KEY) log('WARNING: DIFY_MODE=live but DIFY_APP_KEY is empty');
  });
}

startServer();
