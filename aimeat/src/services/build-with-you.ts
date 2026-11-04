/**
 * @file src/services/build-with-you.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Build it with you" ("Rakennamme kanssasi"; Jouni, 1.11 16.22): a place gets one build
 *   request. Its owner, or the owner's AI over MCP, describes the first thing to build (what, for whom,
 *   what for, when it is ready), the operator takes it to their build queue (site.build_queue_url), and
 *   the node shows where it stands: the queue's state word and the position, never a time. The REST
 *   routes (routes/build-with-you.ts) and the MCP tools aimeat_build_request_submit and
 *   aimeat_build_request_status (mcp/build-with-you.ts) call the operations here, so who may do what exists once.
 *
 *   A STORE PLACE SENDS IT WITH THE PERSON'S OWN ACCOUNT. With the store's build code (site.build_code)
 *   the place calls the queue's app tool through the MCP server the person attached for the builders'
 *   node, with their own sign-in there (sendWithOwnAccount, build-with-you-send.ts), and keeps the
 *   queue's answer. No key of the operator's is involved.
 *
 *   WITHOUT A CODE THE PLACE DOES NOT SUBMIT. The queue's write key reaches every extension of the operator's account,
 *   so it never sits on a customer's place. The request waits here as `waiting-for-operator`; the
 *   operator's fleet service reads it (GET /v1/operator/build-request), submits it from where the key
 *   lives, and writes the queue's answer back (PUT /v1/operator/build-request). From then on the node
 *   asks the queue's public getStatus with the request's id and status token, which needs no key.
 *
 *   THE OFFER opens once per place, on the first sign that the owner works through an AI: the first MCP
 *   call of an outside AI (a usage listener on the MCP tool stream), or, on a place bought from the store
 *   that runs on the store's AI key, the first chat turn (routes/chat.ts). An offer that is not open does
 *   not stop a request: an AI that sends one has just made that MCP call.
 *
 *   ONE PER PLACE. The request is one record under the node's own identity, written on its version, so
 *   two submits at once leave one request, and the operator's answer is taken once: a second PUT with
 *   the same requestId changes nothing. The queue's statusToken is the request's secret: it stays in the
 *   record, goes to the operator's routes only, and never reaches an owner's answer.
 * @structure BuildError · readOp · submitOp · operatorPendingOp · operatorHandOp · openBuildOffer ·
 *   startBuildWithYou · stopBuildWithYou
 * @usage res.json(success(nodeId, await submitOp(deps, callerOf(req, nodeId, storage), req.body)));
 * @version-history
 *   v1.2.2 — 2026-11-04 — A setting changed on another process of the node is told to the card's
 *     domain by that process only, so a stream hears it once (event-bus.ts origin rule; codebase
 *     analysis 2026-11-03, HA stage 2, e2-bus).
 *   v1.2.1 — 2026-11-02 — The queue's `inviteAccount` is kept and shown beside `inviteEmail`, so the
 *     card can say the invitation waits in the aimeat.io account rather than in an inbox
 *     (commercial's crew56 chain test).
 *   v1.2.0 — 2026-11-01 — With the build code the PLACE sends the request (sendWithOwnAccount), through
 *     the server the person attached for the builders' node and with their own sign-in there, and keeps
 *     the queue's answer as the operator's hand-back did; BUILD_REQUEST_ELSEWHERE is gone, and a place
 *     not yet connected answers BUILD_CONNECT_FIRST. The `send` block for the person's AI to fill in
 *     failed on the test lane: the chat named the address where aimeat_mcp_call wants the short name
 *     (aimeat-commercial-1c, crew54). A request in `sending` is never the operator's to take.
 *   v1.1.0 — 2026-11-01 — The store's build code (site.build_code). Jouni rejected the queue submit
 *     agent (1.11 18.18), so the request goes with the person's OWN aimeat.io account: a place with a
 *     code answers buildCode and `send` (the queue's app tool submitRequest, called through aimeat.io's
 *     MCP with aimeat_app_tool_invoke), has its offer open, and refuses its own local request
 *     (BUILD_REQUEST_ELSEWHERE). The relay routes stay, inert without a queue.
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi", part B).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CallerContext } from './caller-context.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { emitChange, onChangeEvent, offChangeEvent, isRemoteEvent, type ChangeEvent } from './event-bus.js';
import { onUsageRecorded } from './usage/usage-buffer.js';
import { safeFetch } from '../utils/url-validator.js';
import { readJson } from '../utils/read-capped.js';
import { INPUT_LIMITS } from '../models/input-limits.js';
import { BUILD_CODE } from '../utils/build-code.js';
import { logger } from '../utils/logger.js';
import { callRemoteTool, statusForRemoteRefusal } from './mcp-client/invoke.js';
import { attachedQueueServer, queueAnswerOf, answerText } from './build-with-you-send.js';

export const BUILD_DOMAIN = 'build-with-you';
const KEY = 'build-with-you.request';
const TAG = 'build-with-you';
const FIELD_MAX = INPUT_LIMITS.line;
const QUEUE_TIMEOUT_MS = 10_000;
const QUEUE_READ_BYTES = 64 * 1024;
/** How old a status may be before a read asks the queue again. */
const STATUS_FRESH_MS = 60_000;
const SWEEP_MS = 10 * 60_000;
const TERMINAL = new Set(['done', 'declined']);
/** The state of a request the operator has not taken to the queue yet. */
const WAITING = 'waiting-for-operator';
/** The state of a request the place is sending with the person's own account, until the far side answers. */
const SENDING = 'sending';
const SPEC_FIELDS = ['what', 'forWhom', 'use', 'readyWhen'] as const;

export class BuildError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Spec = Record<(typeof SPEC_FIELDS)[number], string>;

interface StoredRequest {
  id: string;
  state: string;
  spec: Spec;
  submittedAt: string;
  submittedBy: string;
  lang: string;
  email: string;
  requestId?: string;
  statusToken?: string;
  position: number | null;
  queueLength: number | null;
  organismInviteSent: boolean;
  organism: { id: string; name: string; url?: string } | null;
  inviteEmail: string | null;
  /** The aimeat.io account the organism invitation went to, when it went to an account and not an address. */
  inviteAccount?: string | null;
  note: string;
  checkedAt?: string;
  lastError?: string;
}

/** The place's one record: when the offer opened and through what (`via`), and the request. */
interface BuildWithYouRecord { offeredAt?: string; via?: 'mcp' | 'chat'; offeredTo?: string; request?: StoredRequest }

interface Deps { storage: Storage; config: AimeatConfig }

const systemOf = (config: AimeatConfig) => `system@${config.nodeId}`;
const queueBase = (config: AimeatConfig) => (config.siteLinks?.buildQueue ?? '').trim().replace(/\/+$/, '');
const parse = (v: unknown): BuildWithYouRecord => (v && typeof v === 'object' ? v as BuildWithYouRecord : {});

async function readRecord(deps: Deps): Promise<BuildWithYouRecord> {
  return parse((await deps.storage.getMemory(systemOf(deps.config), KEY))?.value);
}

function write(deps: Deps, mutate: (cur: BuildWithYouRecord) => BuildWithYouRecord | typeof UNCHANGED): Promise<BuildWithYouRecord> {
  return updateRecord(deps.storage, systemOf(deps.config), KEY, parse, mutate, { tag: TAG, visibility: 'private' });
}

function access(caller: CallerContext, mode: 'read' | 'write'): void {
  if (caller.visitor || caller.kind === 'anonymous') throw new BuildError(403, 'FORBIDDEN', 'The build request belongs to an account on this node; sign in as its owner, or use one of its agents.');
  if (caller.kind === 'app' || caller.kind === 'ecosystem') throw new BuildError(403, 'FORBIDDEN', 'An app cannot send or read the build request; the owner or one of the owner\'s agents can.');
  const word = mode === 'read' ? 'memory:read' : 'memory:write';
  if (!caller.has(word)) throw new BuildError(403, 'SCOPE_DENIED', `This needs the permission ${word}.`);
}

// ── What a caller reads ──────────────────────────────────────────────────────────────────────────

/** The queue's origin, or null for no queue (the setting is checked as an http(s) address when it is saved). */
function originOf(base: string): string | null {
  return URL.canParse(base) ? new URL(base).origin : null;
}

/** The store's build code for this place, or null when none is set or it is not in the code's format. */
function buildCodeOf(config: AimeatConfig): string | null {
  const code = (config.buildCode ?? '').trim();
  return BUILD_CODE.test(code) ? code : null;
}

/**
 * Where the person's own AI sends the request with the person's own account. site.build_queue_url names
 * the queue (`<origin>/v1/ext/<owner>/<name>`); the queue's app of the same name offers its tools to any
 * account (`<name>.html`, the builders' own word: rakennamme 2.0.1), called through that origin's MCP
 * with aimeat_app_tool_invoke, because aimeat_extension_invoke reaches only the caller's own
 * extensions. Null when the setting names no queue. The place itself sends nothing.
 */
function sendVia(config: AimeatConfig, base: string, code: string) {
  if (!URL.canParse(base)) return null;
  const url = new URL(base);
  const m = /^\/v1\/ext\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  return {
    mcp: `${url.origin}/v1/mcp`,
    tool: 'aimeat_app_tool_invoke',
    arguments: {
      owner: decodeURIComponent(m[1]),
      app: `${decodeURIComponent(m[2])}.html`,
      tool: 'submitRequest',
      input: { code, nodeId: config.nodeId, lang: '<the person\'s language: en, fi or es>', spec: { what: '', forWhom: '', use: '', readyWhen: '' } },
    },
  };
}

function view(config: AimeatConfig, rec: BuildWithYouRecord) {
  const base = queueBase(config);
  const queueOrigin = base ? originOf(base) : null;
  const r = rec.request;
  const buildCode = buildCodeOf(config);
  // A place with the store's build code has its offer open: the request goes with the person's own account.
  const reason = buildCode ? null : !base ? 'off' : r ? 'used' : !rec.offeredAt ? 'not-yet' : null;
  return {
    queueOrigin,
    buildCode,
    send: buildCode && base ? sendVia(config, base, buildCode) : null,
    offer: { available: reason === null, reason, offeredAt: rec.offeredAt ?? null, trigger: rec.via ?? null },
    request: r ? {
      id: r.id, state: r.state, position: r.position, queueLength: r.queueLength,
      organismInviteSent: r.organismInviteSent,
      organism: r.organism ? {
        id: r.organism.id, name: r.organism.name,
        url: r.organism.url ?? (queueOrigin ? `${queueOrigin}/v1/profile?tab=organisms&org=${encodeURIComponent(r.organism.id)}` : null),
      } : null,
      inviteEmail: r.inviteEmail, inviteAccount: r.inviteAccount ?? null, note: r.note, spec: r.spec, submittedAt: r.submittedAt, checkedAt: r.checkedAt ?? null,
    } : null,
  };
}

/** The offer and the request as they stand, with the queue asked again when its answer is old. */
export async function readOp(deps: Deps, caller: CallerContext) {
  access(caller, 'read');
  let rec = await readRecord(deps);
  const r = rec.request;
  if (r?.requestId && !TERMINAL.has(r.state) && (!r.checkedAt || Date.now() - Date.parse(r.checkedAt) > STATUS_FRESH_MS)) {
    rec = await refreshStatus(deps) ?? rec;
  }
  return view(deps.config, rec);
}

// ── Sending the request ──────────────────────────────────────────────────────────────────────────

/** The four fields, flat or under `spec` (the shape the status's `send` shows); a flat field wins. */
function specOf(body: Record<string, unknown>): Spec {
  const nested = body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec) ? body.spec as Record<string, unknown> : {};
  const spec = {} as Spec;
  for (const f of SPEC_FIELDS) {
    const raw = typeof body[f] === 'string' && (body[f] as string).trim() ? body[f] : nested[f];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) throw new BuildError(400, 'VALIDATION_ERROR', `${f} is required: ${f === 'what' ? 'what to build' : f === 'forWhom' ? 'who it is for' : f === 'use' ? 'what it is used for' : 'when it is ready, in a sentence'}.`);
    if (v.length > FIELD_MAX) throw new BuildError(400, 'VALIDATION_ERROR', `${f} is at most ${FIELD_MAX} characters.`);
    spec[f] = v;
  }
  return spec;
}

/**
 * The place's one request. With the store's build code the place sends it at once, through the server
 * the person attached for the builders' node and with their own sign-in there (sendWithOwnAccount);
 * without one it is stored for the operator to take to the queue.
 */
export async function submitOp(deps: Deps, caller: CallerContext, body: Record<string, unknown>) {
  try {
    return await submit(deps, caller, body);
  } catch (err) {
    // A refusal is the answer the caller gets, and the log is where the person running the place sees
    // why an AI's send did not go (the test lane's chat failed with nothing in the log).
    if (err instanceof BuildError) logger.warn(`[build-with-you] the build request was refused for ${caller.principal}: ${err.code}: ${err.message}`);
    throw err;
  }
}

async function submit(deps: Deps, caller: CallerContext, body: Record<string, unknown>) {
  access(caller, 'write');
  const spec = specOf(body);
  if (!queueBase(deps.config)) throw new BuildError(409, 'BUILD_WITH_YOU_OFF', 'This node has no build queue, so a build request cannot be sent from here.');
  // The account's language and notification address are defaults only; without them the request still goes.
  const ghii = await deps.storage.getGHII(caller.ownerGhii).catch((e: Error) => {
    logger.warn(`[build-with-you] the account record was not read for the request's defaults: ${e.message}`);
    return null;
  });
  const wanted = typeof body.lang === 'string' && ['en', 'fi', 'es'].includes(body.lang) ? body.lang : '';
  const lang = wanted || ghii?.locale || deps.config.siteLinks?.defaultLocale || 'en';
  const email = (typeof body.email === 'string' ? body.email.trim() : '') || ghii?.notificationEmail || '';
  const code = buildCodeOf(deps.config);
  if (code) return sendWithOwnAccount(deps, caller, { spec, lang, email, code });
  const now = new Date().toISOString();
  const rec = await write(deps, (cur) => {
    if (cur.request) throw new BuildError(409, 'BUILD_REQUEST_EXISTS', 'This place has already sent its build request. Read its status instead.');
    return {
      ...cur,
      offeredAt: cur.offeredAt ?? now, via: cur.via ?? 'mcp',
      request: {
        id: randomUUID(), state: WAITING, spec, submittedAt: now, submittedBy: caller.ownerGhii, lang, email,
        position: null, queueLength: null, organismInviteSent: false, organism: null, inviteEmail: null, note: '',
      },
    };
  });
  emitChange(BUILD_DOMAIN, caller.ownerGhii);
  return view(deps.config, rec);
}

const CALLER_KIND = { owner: 'owner', agent: 'agent', app: 'app', ecosystem: 'eco' } as const;

/**
 * Send the request with the person's own account: the queue's app tool submitRequest, called through the
 * server they attached for the builders' node (aimeat_app_tool_invoke on that node's MCP), with the grants
 * and the sign-in that server row carries. The place's one request is claimed BEFORE the call, so two
 * sends at once make one call, and released again when the far side did not take it, so the person can
 * send it again.
 */
async function sendWithOwnAccount(deps: Deps, caller: CallerContext, req: { spec: Spec; lang: string; email: string; code: string }) {
  const via = sendVia(deps.config, queueBase(deps.config), req.code);
  if (!via) throw new BuildError(409, 'BUILD_WITH_YOU_OFF', 'This node\'s build queue setting names no queue extension, so the request has nowhere to go.');
  const host = new URL(via.mcp).host;
  const where = '/v1/profile?tab=access&section=ac-mcp';
  const row = await attachedQueueServer(deps.storage, caller.ownerGhii, via.mcp);
  if (!row) {
    throw new BuildError(409, 'BUILD_CONNECT_FIRST', `Connect this place to ${host} first, with your own account there: Settings & Controls, Access, MCP servers, "Connect to ${host}" (${where}). Then send the request again.`);
  }
  if (row.status === 'needs_reauth') {
    throw new BuildError(409, 'BUILD_CONNECT_FIRST', `Sign in to ${host} again first: Settings & Controls, Access, MCP servers, "${row.slug}" (${where}). Then send the request again.`);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  await write(deps, (cur) => {
    if (cur.request) throw new BuildError(409, 'BUILD_REQUEST_EXISTS', 'This place has already sent its build request. Read its status instead.');
    return {
      ...cur,
      offeredAt: cur.offeredAt ?? now, via: cur.via ?? 'mcp',
      request: {
        id, state: SENDING, spec: req.spec, submittedAt: now, submittedBy: caller.ownerGhii, lang: req.lang, email: req.email,
        position: null, queueLength: null, organismInviteSent: false, organism: null, inviteEmail: null, note: '',
      },
    };
  });
  const result = await callRemoteTool({
    storage: deps.storage, config: deps.config, server: row, tool: via.tool,
    args: { ...via.arguments, input: { code: req.code, nodeId: deps.config.nodeId, lang: req.lang, spec: req.spec } },
    caller: caller.principal, callerKind: CALLER_KIND[caller.kind as keyof typeof CALLER_KIND] ?? 'agent',
    scopes: [...caller.scopes], ownerInPerson: caller.inPerson,
  });
  if (!result.ok || result.isError) {
    await write(deps, (cur) => (cur.request?.id === id && !cur.request.requestId ? { ...cur, request: undefined } : UNCHANGED));
    const said = (!result.ok ? result.message : answerText(result.content)).slice(0, 300);
    // A refusal on this side keeps its own status (403 for a grant that does not cover the call);
    // the far side saying no is 502.
    throw new BuildError(result.ok ? 502 : statusForRemoteRefusal(result.code), 'BUILD_SEND_FAILED', `${host} did not take the build request: ${said || 'no reason given'}`);
  }
  // Taken. Without a requestId in the answer the request is still the queue's, so it stays sent.
  const answer = queueAnswerOf(result.content, result.structuredContent);
  if (!answer) logger.warn(`[build-with-you] ${host} took the build request but its answer named no requestId`);
  const rec = await write(deps, (cur) => (cur.request?.id === id
    ? { ...cur, request: { ...fold(cur.request, { ...(answer ?? {}), state: str(answer?.state) || 'queued' }, ''), checkedAt: undefined } }
    : UNCHANGED));
  emitChange(BUILD_DOMAIN, caller.ownerGhii);
  return view(deps.config, rec);
}

// ── The operator's half: take the request to the queue, and bring the answer back ──────────────────

/** The request the operator has not taken to the queue yet, or the queue's id and token once it has. */
export async function operatorPendingOp(deps: Deps) {
  const r = (await readRecord(deps)).request;
  if (!r) return { pending: null };
  // A request the place is sending itself (a store place's build code) is never the operator's to send.
  if (!r.requestId && r.state !== WAITING) return { pending: null, state: r.state };
  if (r.requestId) return { pending: null, requestId: r.requestId, statusToken: r.statusToken ?? null, state: r.state };
  return {
    pending: {
      id: r.id, node: deps.config.baseUrl, nodeId: deps.config.nodeId,
      customerEmail: r.email, lang: r.lang, spec: r.spec, at: r.submittedAt,
    },
  };
}

/** The queue's answer to the operator's submit. Taken once: the same requestId again changes nothing. */
export async function operatorHandOp(deps: Deps, body: Record<string, unknown>) {
  const requestId = str(body.requestId).trim();
  const statusToken = str(body.statusToken).trim();
  if (!requestId || !statusToken) throw new BuildError(400, 'VALIDATION_ERROR', 'requestId and statusToken are required: the queue\'s answer to submitRequest.');
  let already = false;
  let owner = '';
  const rec = await write(deps, (cur) => {
    if (!cur.request) throw new BuildError(404, 'NOT_FOUND', 'This place has no build request.');
    if (cur.request.requestId) {
      if (cur.request.requestId === requestId) { already = true; return UNCHANGED; }
      throw new BuildError(409, 'BUILD_REQUEST_HANDED', 'This request already carries another requestId from the queue.');
    }
    owner = cur.request.submittedBy;
    // Not marked as checked: the owner's next read asks the queue at once, which is what the operator's
    // answer is for.
    return { ...cur, request: { ...fold(cur.request, { ...body, requestId, statusToken }, ''), checkedAt: undefined } };
  });
  if (!already) emitChange(BUILD_DOMAIN, owner);
  return { already, request: view(deps.config, rec).request };
}

type QueueAnswer = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; message: string };

/** The queue's public status call: the request's id and token, no key. */
async function queueStatus(config: AimeatConfig, body: unknown): Promise<QueueAnswer> {
  const base = queueBase(config);
  const url = `${base}/getStatus`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  try {
    // The operator named this queue, so its origin is the operator's word (allowOrigins); no redirect
    // is followed, so the status token reaches that address and nothing else.
    const res = await safeFetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), maxRedirects: 0,
      allowOrigins: [new URL(base).origin], signal: AbortSignal.timeout(QUEUE_TIMEOUT_MS),
    });
    const json = await readJson(res, QUEUE_READ_BYTES).catch((e: Error) => {
      logger.warn(`[build-with-you] the build queue's status answer was not JSON (HTTP ${res.status}): ${e.message}`);
      return null;
    }) as { ok?: unknown; data?: unknown; error?: { message?: unknown } | string } | null;
    if (res.ok && json?.ok === true && json.data && typeof json.data === 'object') return { ok: true, data: json.data as Record<string, unknown> };
    const said = typeof json?.error === 'string' ? json.error : typeof json?.error?.message === 'string' ? json.error.message : '';
    return { ok: false, status: res.status, message: said || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err) };
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The queue's answer folded into the request: only what the answer carries changes. */
function fold(r: StoredRequest, d: Record<string, unknown>, at: string): StoredRequest {
  const org = d.organism && typeof d.organism === 'object' ? d.organism as Record<string, unknown> : null;
  return {
    ...r,
    ...(str(d.requestId) ? { requestId: str(d.requestId) } : {}),
    ...(str(d.statusToken) ? { statusToken: str(d.statusToken) } : {}),
    state: str(d.state) || (r.state === WAITING ? 'queued' : r.state),
    position: 'position' in d ? num(d.position) : r.position,
    queueLength: 'queueLength' in d ? num(d.queueLength) : r.queueLength,
    organismInviteSent: typeof d.organismInviteSent === 'boolean' ? d.organismInviteSent : r.organismInviteSent,
    organism: org && str(org.id) ? { id: str(org.id), name: str(org.name), ...(str(org.url) ? { url: str(org.url) } : {}) } : r.organism,
    inviteEmail: str(d.inviteEmail) || r.inviteEmail,
    inviteAccount: str(d.inviteAccount) || r.inviteAccount || null,
    note: 'note' in d ? str(d.note) : r.note,
    checkedAt: at,
    lastError: undefined,
  };
}

/** Ask the queue where the request stands; tell the owner's stream when the answer changed anything. */
async function refreshStatus(deps: Deps): Promise<BuildWithYouRecord | null> {
  const r = (await readRecord(deps)).request;
  if (!r?.requestId || !r.statusToken) return null;
  const answer = await queueStatus(deps.config, { requestId: r.requestId, statusToken: r.statusToken, nodeId: deps.config.nodeId });
  const at = new Date().toISOString();
  if (!answer.ok) {
    logger.warn(`[build-with-you] the build queue did not answer the status: ${answer.status || 'no answer'}`);
    return null;
  }
  let changed = false;
  const rec = await write(deps, (cur) => {
    if (!cur.request) return UNCHANGED;
    const next = fold(cur.request, answer.data, at);
    // What changed, the time it was asked aside.
    changed = JSON.stringify({ ...cur.request, checkedAt: '' }) !== JSON.stringify({ ...next, checkedAt: '' });
    return { ...cur, request: next };
  });
  if (changed) emitChange(BUILD_DOMAIN, r.submittedBy);
  return rec;
}

// ── The offer, and the sweep ─────────────────────────────────────────────────────────────────────

const offered = new Set<string>();

/** Open the place's one offer, the first time an AI shows up. A node without a queue opens nothing. */
export async function openBuildOffer(deps: Deps, via: 'mcp' | 'chat', ownerGhii: string): Promise<void> {
  if (!queueBase(deps.config) || offered.has(deps.config.nodeId)) return;
  let opened = false;
  await write(deps, (cur) => {
    if (cur.offeredAt) return UNCHANGED;
    opened = true;
    return { ...cur, offeredAt: new Date().toISOString(), via, offeredTo: ownerGhii };
  });
  offered.add(deps.config.nodeId);
  if (opened) emitChange(BUILD_DOMAIN, ownerGhii);
}

let stopListener: (() => void) | null = null;
let stopConfig: (() => void) | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** The usage listener that opens the offer on an outside AI's first MCP call, and the sweep. */
export function startBuildWithYou(storage: Storage, config: AimeatConfig): void {
  stopBuildWithYou();
  const deps = { storage, config };
  stopListener = onUsageRecorded((call) => {
    if (call.surface !== 'mcp' || call.outcome !== 'ok' || offered.has(config.nodeId) || !queueBase(config)) return;
    // The place's own chat agent is not an outside AI; the chat opens the offer by its own rule.
    if (call.actorKind === 'agent' && call.actorGaii.startsWith('chat#')) return;
    if (call.actorKind !== 'owner' && call.actorKind !== 'agent') return;
    void openBuildOffer(deps, 'mcp', call.ownerGhii).catch((e: Error) => logger.warn(`[build-with-you] the offer was not opened: ${e.message}`));
  });
  // A changed setting may be the build code or the queue, which the card reads: tell it in its own
  // domain, so a page listens to one.
  // A setting another process changed is told by that process, whose own event reaches every stream.
  const onConfig = (evt: ChangeEvent) => { if (evt.domain === 'config' && !isRemoteEvent(evt)) emitChange(BUILD_DOMAIN); };
  onChangeEvent(onConfig);
  stopConfig = () => offChangeEvent(onConfig);
  sweepTimer = setInterval(() => {
    void (async () => {
      const r = (await readRecord(deps)).request;
      // A request the operator has not taken to the queue yet waits for them; there is nothing to ask.
      if (!r?.requestId || TERMINAL.has(r.state) || !queueBase(config)) return;
      await refreshStatus(deps);
    })().catch((e: Error) => logger.warn(`[build-with-you] sweep: ${e.message}`));
  }, SWEEP_MS);
  sweepTimer.unref?.();
}

export function stopBuildWithYou(): void {
  stopListener?.();
  stopListener = null;
  stopConfig?.();
  stopConfig = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
