/**
 * @file src/services/place-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The trail of a place: every action on this node as a list a person reads, newest
 *   first: what was done, to what, by whom (a person, their AI, an agent, an app or the operator) and
 *   when. The owner reads their own account's trail (GET /v1/build-with-you/trail, aimeat_trail_list);
 *   the operator and the store's fleet service read the whole node's (GET /v1/operator/activity).
 *
 *   NO NEW STORE. The source is the usage stream the node already keeps (services/usage/usage-buffer.ts,
 *   storage usage_calls): every MCP tool call is recorded there as it runs (mcp/tool-usage-wrap.ts), and
 *   every authenticated REST change since 2026-11-01 too, as surface `http` (middleware/trail-recorder.ts).
 *   A read joins the stored rows and the ones still in the buffer, so an action shows at once. How the
 *   trail goes stale is the usage stream's own answer: rows leave the hot table after usage.hot_days
 *   (services/usage/archive-job.ts), and the trail shows the hot table.
 *
 *   EVENTS. Three entries carry an `event` the fleet keys on (Jouni, 1.11 16.22, part D): agent.approved
 *   when the owner makes an agent, approves one their AI proposed, or approves an agent's device
 *   authorization (routes/agents/device-auth.ts records those two itself),
 *   agent.ran on an agent's successful call (the place's own chat agent excluded: it is not an agent the
 *   person made), and app.published when an app is published by any route or tool.
 * @structure TrailEntry · TRAIL_EVENTS · recordTrailEvent · trailEntryOf · TrailError · readOwnTrail · readTrail
 * @usage const { entries, next } = await readTrail(storage, { ownerGhii, since, before, limit });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi", part C; Jouni, 1.11 16.22).
 */
import type { Storage, UsageCallRecord, UsageCallFilter } from '../storage/interface.js';
import { pendingUsageCalls, recordUsageCall } from './usage/usage-buffer.js';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../tool-catalog/definitions.js';
import { localAccountName, ownerGhiiOf } from '../utils/gaii.js';
import type { CallerContext } from './caller-context.js';

/** Who acted, as a person reads it: the person, their AI over MCP or in the chat, an agent, an app, the operator. */
export type TrailActorKind = 'person' | 'ai' | 'agent' | 'app' | 'operator';

export interface TrailEntry {
  at: string;
  /** The acting identity as recorded (an account, an agent's GAII, an app). */
  actor: string;
  actorName: string;
  actorKind: TrailActorKind;
  /** What was done, as a short English phrase. */
  action: string;
  /** The MCP tool name, or the REST method and route template (`POST /v1/apps`). */
  code: string;
  /** What it was done to, when the call named it: a key, a filename, an id. Empty otherwise. */
  target: string;
  /** agent.approved, agent.ran or app.published; absent on every other entry. */
  event?: string;
  /** True for a call that only read. */
  readOnly: boolean;
  outcome: 'ok' | 'error';
}

export const TRAIL_EVENTS = ['agent.approved', 'agent.ran', 'app.published'] as const;

/** The codes that publish an app, whichever door: the MCP tools and the REST routes behind them. */
const APP_PUBLISH_CODES = new Set([
  'aimeat_app_publish', 'aimeat_app_draft_publish',
  'POST /v1/apps', 'POST /v1/apps/:owner/:filename/publish-draft',
]);

/**
 * The routes where the owner makes or approves an agent in one press: registering one, and approving
 * an agent their AI proposed. The two device approval routes write their own line (recordTrailEvent).
 */
const AGENT_APPROVE_CODES = new Set(['POST /v1/agents', 'POST /v1/agents/v2/agent-proposals/:id/approve']);

const MAX_LIMIT = 500;
/** The place's own chat agent (services/chat-agent.ts): the person's chat, not an agent they made. */
const CHAT_AGENT = 'chat';

let toolInfo: Map<string, { title: string; readOnly: boolean }> | null = null;
function toolOf(name: string): { title: string; readOnly: boolean } | undefined {
  if (!toolInfo) {
    toolInfo = new Map(CLI_FALLBACK_TOOL_DEFINITIONS.map((d) => [d.name, {
      title: d.annotations?.title ?? d.name, readOnly: d.annotations?.readOnlyHint === true,
    }]));
  }
  return toolInfo.get(name);
}

/**
 * Record one action a route decides on its own, for an entry the REST middleware cannot write (a
 * route whose credential arrives in the body, as the device approval's does). The caller sets
 * `res.locals.trailRecorded` so the middleware does not write the same request twice.
 */
export function recordTrailEvent(input: { actor: string; code: string; target?: string; event?: string }): void {
  recordUsageCall({
    ownerGhii: ownerGhiiOf(input.actor),
    actorGaii: input.actor,
    actorKind: input.actor.includes('#') ? 'agent' : 'owner',
    surface: 'http',
    coordinate: input.code,
    outcome: 'ok',
    meta: { ...(input.target ? { target: input.target } : {}), ...(input.event ? { event: input.event } : {}) },
  });
}

function agentName(actor: string): string {
  return actor.includes('#') ? actor.slice(0, actor.indexOf('#')) : actor;
}

function kindOf(row: UsageCallRecord): TrailActorKind {
  switch (row.actorKind) {
    case 'operator': return 'operator';
    case 'app': case 'eco': return 'app';
    case 'agent': return agentName(row.actorGaii) === CHAT_AGENT ? 'ai' : 'agent';
    // An account acting over MCP is that person's AI: a person does not call MCP tools by hand.
    default: return row.surface === 'mcp' ? 'ai' : 'person';
  }
}

/** A REST code's phrase: the verb from the method, the thing from the route's first segment. */
function restAction(code: string): string {
  const [method, path = ''] = code.split(' ');
  const thing = path.replace(/^\/v1\//, '').split('/')[0] || 'the node';
  const verb = method === 'POST' ? 'created or sent' : method === 'DELETE' ? 'removed' : 'changed';
  return `${verb} ${thing.replace(/-/g, ' ')}`;
}

function eventOf(row: UsageCallRecord, kind: TrailActorKind): string | undefined {
  const named = typeof row.meta?.event === 'string' ? row.meta.event : '';
  if (named) return named;
  if (row.outcome !== 'ok') return undefined;
  if (APP_PUBLISH_CODES.has(row.coordinate)) return 'app.published';
  if (AGENT_APPROVE_CODES.has(row.coordinate)) return 'agent.approved';
  if (kind === 'agent') return 'agent.ran';
  return undefined;
}

/** One usage row as a trail entry, or null for a row that is no action on the place (an anonymous visit). */
export function trailEntryOf(row: UsageCallRecord): TrailEntry | null {
  if (row.actorKind === 'anon' || !row.actorGaii) return null;
  const kind = kindOf(row);
  const tool = row.surface === 'mcp' ? toolOf(row.coordinate) : undefined;
  const action = row.surface === 'mcp' ? (tool ? `used "${tool.title}"` : `used ${row.coordinate}`)
    : row.surface === 'http' ? restAction(row.coordinate)
      : `used ${row.coordinate}`;
  const target = typeof row.meta?.target === 'string' ? row.meta.target : (row.appId || '');
  const event = eventOf(row, kind);
  return {
    at: row.ts,
    actor: row.actorGaii,
    actorName: row.actorGaii.includes('#') ? agentName(row.actorGaii) : localAccountName(row.actorGaii),
    actorKind: kind,
    action,
    code: row.coordinate,
    target,
    ...(event ? { event } : {}),
    readOnly: tool?.readOnly ?? false,
    outcome: row.outcome === 'ok' ? 'ok' : 'error',
  };
}

export interface TrailQuery {
  /** One account's trail (its own calls and its agents'); absent: the whole node. */
  ownerGhii?: string;
  /** Inclusive lower bound (ISO). */
  since?: string;
  /** Exclusive upper bound (ISO): the `next` of the page before. */
  before?: string;
  limit?: number;
}

export class TrailError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** The caller's own account's trail: its owner, or one of its agents holding memory:read. */
export async function readOwnTrail(storage: Storage, caller: CallerContext, q: Omit<TrailQuery, 'ownerGhii'>) {
  if (caller.visitor || caller.kind === 'app' || caller.kind === 'ecosystem' || caller.kind === 'anonymous') {
    throw new TrailError(403, 'FORBIDDEN', 'The trail is the account\'s own: its owner or one of its agents reads it.');
  }
  if (!caller.has('memory:read')) throw new TrailError(403, 'SCOPE_DENIED', 'This needs the permission memory:read.');
  return readTrail(storage, { ...q, ownerGhii: caller.ownerGhii });
}

/** The trail, newest first: the stored rows and the ones not yet written, one page of them. */
export async function readTrail(storage: Storage, q: TrailQuery): Promise<{ entries: TrailEntry[]; next: string | null }> {
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 1), MAX_LIMIT);
  const filter: UsageCallFilter = {
    ...(q.ownerGhii ? { ownerGhii: q.ownerGhii } : {}),
    ...(q.since ? { from: q.since } : {}),
    ...(q.before ? { to: q.before } : {}),
    limit: limit + 1,
  };
  const stored = await storage.listUsageCalls(filter);
  const seen = new Set(stored.map((r) => r.id));
  const rows = [...pendingUsageCalls(filter).filter((r) => !seen.has(r.id)), ...stored]
    // `to` is inclusive in the store; the page boundary is not, so the row the last page ended on is not repeated.
    .filter((r) => !q.before || r.ts < q.before)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const entries: TrailEntry[] = [];
  let last = '';
  for (const row of rows) {
    if (entries.length >= limit) break;
    last = row.ts;
    const entry = trailEntryOf(row);
    if (entry) entries.push(entry);
  }
  const more = rows.length > limit;
  return { entries, next: more && last ? last : null };
}
