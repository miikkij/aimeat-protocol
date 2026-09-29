/**
 * @file src/services/agent-refusals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node refused an agent for a missing permission, and what the agent asked
 *   for when it was approved: kept where the owner reads it, on the agent's open tasks, and for the
 *   agent itself.
 *
 *   WHY. A crew on a sold seat ran to exit 0 while the node refused its writes with SCOPE_DENIED.
 *   The customer's task stayed queued, and the only trace was one `[scope-denied]` line in the node
 *   log: nothing on the task, the agent card or the run's outcome said why (wish
 *   `wish-agentin-ajo-onnistuu-vaikka-node-kielt-sen-kirjoitukset-scop`, measured 2026-09-29). A
 *   refusal is a fact the node already knows at the moment it answers 403, so the node records it
 *   rather than asking every runtime to notice.
 *
 *   WHERE. Two memory records per agent in the OWNER's namespace, visibility 'owner':
 *     `audit.agents.<name>.refusals`       what was refused: one entry per (needed scopes, route)
 *     `audit.agents.<name>.scope-request`  the last approval: the scopes asked for and granted
 *   The `audit.` prefix is reserved (utils/reserved-keys.ts), so neither the agent nor a granted app
 *   can erase or forge the record of its own refusals. Written through storage directly, like
 *   services/app-audit.ts, because a refusal note is a machine's note about an act and not content
 *   anybody authored, so it takes no AI-provenance record.
 *
 *   HOW IT GOES STALE. A refusal is shown while it is open: the agent still lacks the permission and
 *   the refusal is younger than REFUSAL_KEEP_DAYS. Granting the permission closes it on the next
 *   read, with no second step; the record prunes closed and old entries on its next write, keeps at
 *   most REFUSAL_MAX_ENTRIES, and goes when the agent is deleted.
 *
 *   COST ON THE REFUSAL PATH. The 403 is answered first and the note is written after, off the
 *   request. One write per (agent, needed, route) per REFUSAL_WRITE_WINDOW_MS: refusals inside the
 *   window are counted in memory and folded into one write at its end, so an agent looping on a
 *   refused call costs one write a minute, not one per call. Each write also looks at the agent's
 *   open tasks, at most TASK_NOTE_MAX_TASKS of them, and notes the refusal once per task: a task
 *   that started after the first note gets its own.
 *
 *   NEVER THROWS. The refusal already stands; a failed note is logged and dropped.
 * @structure
 *   - initAgentRefusals(storage) — arm the recorder (server-bootstrap/process-buffers.ts)
 *   - noteAgentRefusal(auth, needed, anyOf, call) — called by auth/deny.ts on every scope refusal
 *   - recordAgentScopeRequest(storage, args) — called when device authorization approves an agent
 *   - readAgentAccess(storage, ownerGhii, agentName, heldScopes, since?) — one agent, open refusals
 *   - readOwnerAgentAccess(storage, ownerGhii) — every agent of an owner in one list read
 *   - openRefusals(entries, heldScopes, nowMs, since?) — which refusals still stand
 *   - refusalView / scopeRequestView / agentAccessView — the wire shape, one for every surface
 *   - forgetAgentAccess(storage, ownerGhii, agentName) — the agent was deleted
 *   - flushAgentRefusals() — write what the windows hold now (tests, shutdown)
 * @usage
 *   noteAgentRefusal(req.auth, ['agent:write'], false, 'PATCH /v1/agents/:name/tags');
 *   const { refusals, request } = await readAgentAccess(storage, ownerGhii, 'concierge', agent.defaultScopes ?? ['*']);
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, MemoryRecord, AgentTaskRecord } from '../storage/interface.js';
import { parseGAII, ownerGhiiOf } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

export const AGENT_REFUSALS_SPEC = 'aimeat.agent-refusals/v1';
export const AGENT_SCOPE_REQUEST_SPEC = 'aimeat.agent-scope-request/v1';
export const REFUSAL_MAX_ENTRIES = 20;
export const REFUSAL_KEEP_DAYS = 14;
export const REFUSAL_WRITE_WINDOW_MS = 60_000;
const TASK_NOTE_MAX_TASKS = 10;
/** A task in one of these is still waiting on the agent, so a refusal can be why it waits. */
const OPEN_TASK_STATUSES = new Set(['queued', 'revision_requested', 'active', 'paused', 'stalled']);
/** The in-memory window table is bounded: past this many (agent, needed, route) slots it starts over. */
const MAX_SLOTS = 2000;

export interface AgentRefusalEntry {
  /** The scopes the refused call needed. */
  needed: string[];
  /** True when any one of `needed` would have been enough (requireAnyScope). */
  anyOf: boolean;
  /** Method and route pattern, e.g. `PATCH /v1/agents/:name/tags`, or `MCP aimeat_x` for a tool. */
  call: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

interface AgentRefusalsRecord {
  spec: typeof AGENT_REFUSALS_SPEC;
  agentGaii: string;
  entries: AgentRefusalEntry[];
}

export interface AgentScopeRequest {
  spec: typeof AGENT_SCOPE_REQUEST_SPEC;
  agentGaii: string;
  /** What the agent named in its device-authorize call; null when it named nothing. */
  requested: string[] | null;
  /** What the approval granted. */
  granted: string[];
  approvedBy: string;
  at: string;
}

export function agentRefusalsKey(agentName: string): string {
  return `audit.agents.${agentName}.refusals`;
}

export function agentScopeRequestKey(agentName: string): string {
  return `audit.agents.${agentName}.scope-request`;
}

/* ── The recorder ─────────────────────────────────────────────────────────────────────────────── */

let storageRef: Storage | null = null;

interface Slot {
  gaii: string;
  needed: string[];
  anyOf: boolean;
  call: string;
  /** Refusals counted since the last write. */
  pending: number;
  firstPendingAt: string;
  lastPendingAt: string;
  lastWriteMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const slots = new Map<string, Slot>();
/** One write at a time per agent, so two refusals in the same moment cannot lose each other's entry. */
const chains = new Map<string, Promise<void>>();

export function initAgentRefusals(storage: Storage): void {
  storageRef = storage;
}

/**
 * Note one scope refusal. Only an agent principal is noted: an app grant, an ecosystem app or a
 * visitor has no agent card and no task queue to show it on.
 */
export function noteAgentRefusal(
  auth: { sub: string; roles: string[] } | undefined,
  needed: string[],
  anyOf: boolean,
  call: string,
): void {
  if (!storageRef || !auth || !auth.roles.includes('agent') || needed.length === 0) return;
  if (!parseGAII(auth.sub)) return;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const key = `${auth.sub}|${[...needed].sort().join(' ')}|${call}`;
  let slot = slots.get(key);
  if (!slot) {
    if (slots.size >= MAX_SLOTS) slots.clear();
    slot = { gaii: auth.sub, needed: [...needed], anyOf, call, pending: 0, firstPendingAt: nowIso, lastPendingAt: nowIso, lastWriteMs: 0, timer: null };
    slots.set(key, slot);
  }
  if (slot.pending === 0) slot.firstPendingAt = nowIso;
  slot.pending += 1;
  slot.lastPendingAt = nowIso;
  if (nowMs - slot.lastWriteMs >= REFUSAL_WRITE_WINDOW_MS) {
    writeSlot(slot);
    return;
  }
  // Inside the window: fold this refusal into one write at the window's end.
  if (!slot.timer) {
    const s = slot;
    s.timer = setTimeout(() => { s.timer = null; if (s.pending > 0) writeSlot(s); }, s.lastWriteMs + REFUSAL_WRITE_WINDOW_MS - nowMs);
    s.timer.unref?.();
  }
}

function writeSlot(slot: Slot): void {
  const storage = storageRef;
  if (!storage) return;
  const nowMs = Date.now();
  const delta = { count: slot.pending, firstAt: slot.firstPendingAt, lastAt: slot.lastPendingAt };
  slot.pending = 0;
  slot.lastWriteMs = nowMs;
  const entry = { needed: slot.needed, anyOf: slot.anyOf, call: slot.call };
  const gaii = slot.gaii;
  const prev = chains.get(gaii) ?? Promise.resolve();
  const next = prev
    .then(() => persistRefusal(storage, gaii, entry, delta))
    .catch((err) => { logger.warn('agent-refusals: note failed, the refusal still stands', { gaii, error: String(err) }); });
  chains.set(gaii, next);
  void next.then(() => { if (chains.get(gaii) === next) chains.delete(gaii); });
}

/** Write whatever the windows hold now and wait for every pending write. For tests and shutdown. */
export async function flushAgentRefusals(): Promise<void> {
  for (const slot of slots.values()) {
    if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
    if (slot.pending > 0) writeSlot(slot);
  }
  await Promise.all([...chains.values()]);
}

function sameEntry(e: AgentRefusalEntry, needed: string[], call: string): boolean {
  return e.call === call && e.needed.length === needed.length && e.needed.every((s) => needed.includes(s));
}

function asRefusals(value: unknown, agentGaii: string): AgentRefusalsRecord {
  const v = value as Partial<AgentRefusalsRecord> | null;
  if (!v || v.spec !== AGENT_REFUSALS_SPEC || !Array.isArray(v.entries)) return { spec: AGENT_REFUSALS_SPEC, agentGaii, entries: [] };
  return { spec: AGENT_REFUSALS_SPEC, agentGaii, entries: v.entries as AgentRefusalEntry[] };
}

async function persistRefusal(
  storage: Storage,
  gaii: string,
  entry: { needed: string[]; anyOf: boolean; call: string },
  delta: { count: number; firstAt: string; lastAt: string },
): Promise<void> {
  const parsed = parseGAII(gaii);
  if (!parsed) return;
  const ownerGhii = ownerGhiiOf(gaii);
  const key = agentRefusalsKey(parsed.agent);
  const agent = await storage.getAgent(gaii);
  if (!agent) return;
  const held = agent.defaultScopes ?? ['*'];
  const existing = await storage.getMemory(ownerGhii, key);
  const rec = existing ? asRefusals(existing.value, gaii) : { spec: AGENT_REFUSALS_SPEC, agentGaii: gaii, entries: [] as AgentRefusalEntry[] };
  const at = rec.entries.find((e) => sameEntry(e, entry.needed, entry.call));
  // A closed entry starts over: the permission was granted and then taken away again, or the old
  // one aged out, and a count carried across that gap would describe two different situations.
  const stillOpen = at && openRefusals([at], held, Date.now()).length === 1;
  const merged: AgentRefusalEntry = at && stillOpen
    ? { ...at, anyOf: entry.anyOf, count: at.count + delta.count, lastAt: delta.lastAt }
    : { needed: entry.needed, anyOf: entry.anyOf, call: entry.call, count: delta.count, firstAt: delta.firstAt, lastAt: delta.lastAt };
  const others = rec.entries.filter((e) => e !== at);
  const kept = openRefusals(others, held, Date.now())
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, REFUSAL_MAX_ENTRIES - 1);
  const now = new Date().toISOString();
  const record: MemoryRecord = {
    key,
    ownerGaii: ownerGhii,
    value: { spec: AGENT_REFUSALS_SPEC, agentGaii: gaii, entries: [merged, ...kept] } satisfies AgentRefusalsRecord,
    visibility: 'owner',
    tags: ['agent-refusals', 'system'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await storage.setMemory(record);
  await noteOpenTasks(storage, gaii, merged);
}

/** The English sentence stored on the task event. The task view says it in the reader's language. */
export function refusalSentence(e: { needed: string[]; anyOf: boolean; call: string }): string {
  const words = e.needed.join(e.anyOf ? '" or "' : '" and "');
  return `AIMEAT refused this agent's call ${e.call}: it needs the permission "${words}". The owner grants it in Profile → Agents → Manage access rights.`;
}

/**
 * Put the refusal on the agent's open tasks, once per task: a task that waits on this agent may
 * wait because of it, and the task is where the person who ordered the work looks. The event type
 * `scope_denied` is written by the node only; the event route does not accept it from an agent.
 */
async function noteOpenTasks(storage: Storage, gaii: string, e: AgentRefusalEntry): Promise<void> {
  const { tasks } = await storage.listAgentTasks(gaii, { perPage: 50 });
  const open = tasks.filter((t: AgentTaskRecord) => OPEN_TASK_STATUSES.has(t.status)).slice(0, TASK_NOTE_MAX_TASKS);
  for (const task of open) {
    const { events } = await storage.listTaskEvents(task.id, { page: 1, perPage: 100 });
    const already = events.some((ev) => ev.type === 'scope_denied'
      && (ev.details as { call?: unknown } | undefined)?.call === e.call
      && JSON.stringify((ev.details as { needed?: unknown } | undefined)?.needed) === JSON.stringify(e.needed));
    if (already) continue;
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: task.id,
      type: 'scope_denied',
      message: refusalSentence(e),
      details: { needed: e.needed, any_of: e.anyOf, call: e.call },
      timestamp: e.lastAt,
    });
  }
}

/* ── The approval record ──────────────────────────────────────────────────────────────────────── */

/** Record what an approval was asked for and what it granted. Never throws. */
export async function recordAgentScopeRequest(
  storage: Storage,
  args: { gaii: string; requested: string[] | null | undefined; granted: string[]; approvedBy: string },
): Promise<void> {
  const parsed = parseGAII(args.gaii);
  if (!parsed) return;
  const ownerGhii = ownerGhiiOf(args.gaii);
  const key = agentScopeRequestKey(parsed.agent);
  const now = new Date().toISOString();
  try {
    const existing = await storage.getMemory(ownerGhii, key);
    const value: AgentScopeRequest = {
      spec: AGENT_SCOPE_REQUEST_SPEC,
      agentGaii: args.gaii,
      requested: Array.isArray(args.requested) && args.requested.length > 0 ? [...args.requested] : null,
      granted: [...args.granted],
      approvedBy: args.approvedBy,
      at: now,
    };
    await storage.setMemory({
      key,
      ownerGaii: ownerGhii,
      value,
      visibility: 'owner',
      tags: ['agent-scope-request', 'system'],
      ttlHours: null,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  } catch (err) {
    logger.warn('agent-refusals: scope request not recorded, the approval stands', { gaii: args.gaii, error: String(err) });
  }
}

/* ── Reading ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The refusals that still stand: the agent still lacks the permission, and the refusal is younger
 * than REFUSAL_KEEP_DAYS. With `since`, only those refused at or after it (the run-window question
 * a runtime asks after a run). Newest first.
 */
export function openRefusals(entries: AgentRefusalEntry[], heldScopes: readonly string[], nowMs: number, since?: string): AgentRefusalEntry[] {
  const oldest = new Date(nowMs - REFUSAL_KEEP_DAYS * 86_400_000).toISOString();
  return entries
    .filter((e) => Array.isArray(e.needed) && e.needed.length > 0 && typeof e.lastAt === 'string')
    .filter((e) => e.lastAt >= oldest && (!since || e.lastAt >= since))
    .filter((e) => {
      const covered = e.needed.map((s) => scopeIsCovered(heldScopes, s));
      const resolved = e.anyOf ? covered.some(Boolean) : covered.every(Boolean);
      return !resolved;
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

function asRequest(value: unknown): AgentScopeRequest | null {
  const v = value as Partial<AgentScopeRequest> | null;
  if (!v || v.spec !== AGENT_SCOPE_REQUEST_SPEC || !Array.isArray(v.granted)) return null;
  return v as AgentScopeRequest;
}

export interface AgentAccess {
  refusals: AgentRefusalEntry[];
  request: AgentScopeRequest | null;
}

export async function readAgentAccess(
  storage: Storage,
  ownerGhii: string,
  agentName: string,
  heldScopes: readonly string[],
  since?: string,
): Promise<AgentAccess> {
  const [refusals, request] = await Promise.all([
    storage.getMemory(ownerGhii, agentRefusalsKey(agentName)),
    storage.getMemory(ownerGhii, agentScopeRequestKey(agentName)),
  ]);
  return {
    refusals: refusals ? openRefusals(asRefusals(refusals.value, agentName).entries, heldScopes, Date.now(), since) : [],
    request: request ? asRequest(request.value) : null,
  };
}

/**
 * Every agent of one owner in one list read, keyed by agent name, with every entry (not only the
 * open ones): the caller knows each agent's scopes and passes them to openRefusals.
 */
export async function readOwnerAgentAccess(
  storage: Storage,
  ownerGhii: string,
): Promise<Map<string, { entries: AgentRefusalEntry[]; request: AgentScopeRequest | null }>> {
  const out = new Map<string, { entries: AgentRefusalEntry[]; request: AgentScopeRequest | null }>();
  const rows = await storage.listMemory(ownerGhii, { prefix: 'audit.agents.' });
  for (const row of rows) {
    const m = /^audit\.agents\.(.+)\.(refusals|scope-request)$/.exec(row.key);
    if (!m) continue;
    const slot = out.get(m[1]) ?? { entries: [], request: null };
    if (m[2] === 'refusals') slot.entries = asRefusals(row.value, m[1]).entries;
    else slot.request = asRequest(row.value);
    out.set(m[1], slot);
  }
  return out;
}

/** The wire shape of one refusal, as the agent list, the refusals route and the MCP tools give it. */
export interface AgentRefusalView {
  needed: string[];
  any_of: boolean;
  call: string;
  count: number;
  first_at: string;
  last_at: string;
}

export function refusalView(e: AgentRefusalEntry): AgentRefusalView {
  return { needed: e.needed, any_of: e.anyOf, call: e.call, count: e.count, first_at: e.firstAt, last_at: e.lastAt };
}

export function scopeRequestView(r: AgentScopeRequest | null): { requested: string[] | null; granted: string[]; at: string } | null {
  return r ? { requested: r.requested, granted: r.granted, at: r.at } : null;
}

/**
 * The two fields an agent row carries: `refusals`, the open ones, and `scope_request`, the last
 * approval (null when it was approved before this was recorded, or not through device authorization).
 */
export function agentAccessView(
  heldScopes: readonly string[],
  slot: { entries: AgentRefusalEntry[]; request: AgentScopeRequest | null } | undefined,
  nowMs = Date.now(),
): { refusals: AgentRefusalView[]; scope_request: ReturnType<typeof scopeRequestView> } {
  return {
    refusals: openRefusals(slot?.entries ?? [], heldScopes, nowMs).map(refusalView),
    scope_request: scopeRequestView(slot?.request ?? null),
  };
}

/** The agent is gone: its refusals and its approval record go with it. Best effort. */
export async function forgetAgentAccess(storage: Storage, ownerGhii: string, agentName: string): Promise<void> {
  for (const key of [agentRefusalsKey(agentName), agentScopeRequestKey(agentName)]) {
    try {
      await storage.deleteMemory(ownerGhii, key);
    } catch (err) {
      logger.warn('agent-refusals: record not removed with the agent', { key, error: String(err) });
    }
  }
}
