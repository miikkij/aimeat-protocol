/**
 * @file src/services/connector-registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's connectors as named, remembered machines.
 *
 *   WHAT WAS MISSING. A connector (`aimeat connect serve`) existed on the node only while its socket
 *   was open, as a group of agent sockets under an install id, which is a random UUID. So the node
 *   could not say "your laptop has been away for two days", an agent could not be ordered to a
 *   machine that was switched off, and no page could show a machine by a name a person recognises.
 *   Measured 2026-10-10: one account, 73 agents, and nothing anywhere that said which machine holds
 *   which.
 *
 *   ONE MEMORY RECORD PER OWNER, not a table. `agents.connectors.registry` in the owner's own namespace holds
 *   every connector of that owner and the placements that wait for one: a collection the owner reads
 *   as a unit, a few kilobytes, with a lifecycle of connect, rename and forget. Agent proposals are
 *   kept the same way (agents.proposals.<id>), for the same reason.
 *
 *   WHAT IS STORED AND WHAT IS READ LIVE. Stored: the id, the owner's name for it, the name the
 *   connector reported, when it was first and last seen, the run modes it presented, and the agents
 *   last seen on it. Read live at every listing: whether it is connected right now and which agents
 *   it holds right now (the tunnel roster). A listing never writes; the record is written when a
 *   connector connects or disconnects, when an agent enrols on one, and on rename and forget.
 *
 *   THE TRUST LEVEL IS THE INSTALL ID'S. The id and the reported name are unsigned headers
 *   (cli/connect/install-id.ts): they select among one owner's own machines and authenticate
 *   nothing. The enrolment grant remains the whole authority for giving a machine an agent's key.
 *
 *   A CONNECTOR WITH NO INSTALL ID is one older than 2026-09-01. It cannot be addressed, so it is
 *   not recorded; the routes that take no connector choice serve it as before.
 * @structure CONNECTORS_KEY · StoredConnector · ConnectorView · listConnectors() · findConnector() ·
 *   syncConnectors() · renameConnector() · forgetConnector() · setWanted() · clearWanted() ·
 *   wantedInstalls() · recordPlacement() · startConnectorRegistry()
 * @usage
 *   const rows = await listConnectors({ config, storage }, owner);
 *   const hit = await findConnector({ config, storage }, owner, 'Kotikone');
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { connectedDaemons } from './basic-agents.js';
import { onTunnelSocketOpened, onTunnelSocketClosed, type TunnelSocketOpened } from './connect-tunnel-hooks.js';
import { INSTALL_NAME_MAX } from './connect-tunnel-roster.js';
import { emitChange } from './event-bus.js';
import { parseGAII, runAsNode } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Where an owner's connectors live, in the owner's own namespace. */
export const CONNECTORS_KEY = 'agents.connectors.registry';

/** How long after a connector's first socket its agents are read: it attaches them after it opens. */
const SETTLE_MS = 2_000;

export interface StoredConnector {
  /** The install id the connector presents. */
  id: string;
  /** The owner's own name for it, or null when they have given none. */
  given_name: string | null;
  /** The name the connector reported (its host name unless the person set one), or null. */
  reported_name: string | null;
  first_seen: string;
  /** When it last connected or disconnected. */
  last_seen: string;
  /** The run modes it presented at its last connect; null from a connector that did not say. */
  run_modes: string[] | null;
  /** Agent names last seen on it. */
  agents: string[];
}

interface Registry {
  connectors: StoredConnector[];
  /** Agent name → the install id it was ordered to, until it enrols there. */
  wanted: Record<string, string>;
}

/** One connector as the owner reads it. */
export interface ConnectorView {
  id: string;
  /** The owner's name for it, else the reported one, else null. */
  name: string | null;
  reported_name: string | null;
  online: boolean;
  first_seen: string;
  last_seen: string;
  run_modes: string[] | null;
  /** The owner's agents that live on it. */
  agents: string[];
  /** Agents ordered to it that have no key yet. */
  waiting: string[];
}

export interface RegistryContext { config: AimeatConfig; storage: Storage }

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const ghiiOf = (ctx: RegistryContext, owner: string) => `${owner}@${ctx.config.nodeId}`;

async function readRegistry(ctx: RegistryContext, owner: string): Promise<Registry> {
  const row = await ctx.storage.getMemory(ghiiOf(ctx, owner), CONNECTORS_KEY);
  const value = (row?.value ?? {}) as Partial<Registry>;
  return {
    connectors: Array.isArray(value.connectors) ? value.connectors.filter(c => c && typeof c.id === 'string') : [],
    wanted: value.wanted && typeof value.wanted === 'object' ? { ...value.wanted } : {},
  };
}

async function writeRegistry(ctx: RegistryContext, owner: string, next: Registry): Promise<void> {
  const ownerGhii = ghiiOf(ctx, owner);
  const row = await ctx.storage.getMemory(ownerGhii, CONNECTORS_KEY);
  const now = new Date().toISOString();
  await ctx.storage.setMemory({
    key: CONNECTORS_KEY,
    ownerGaii: ownerGhii,
    value: next as unknown as Record<string, unknown>,
    visibility: 'owner',
    tags: ['agent-connectors'],
    ttlHours: null,
    version: (row?.version ?? 0) + 1,
    createdAt: row?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * One change to an owner's record at a time. The record is read, changed and written back, and a
 * connect, a disconnect and an enrolment can land in the same second.
 */
const chains = new Map<string, Promise<unknown>>();
function mutate<T>(ctx: RegistryContext, owner: string, change: (reg: Registry) => { write: boolean; result: T } | Promise<{ write: boolean; result: T }>): Promise<T> {
  const key = `${ctx.config.nodeId}\n${owner}`;
  const run = async (): Promise<T> => {
    const reg = await readRegistry(ctx, owner);
    const out = await change(reg);
    if (out.write) await writeRegistry(ctx, owner, reg);
    return out.result;
  };
  const next = (chains.get(key) ?? Promise.resolve()).then(run, run);
  // eslint-disable-next-line aimeat/no-silent-catch -- the failure goes to this change's own caller through `next`; the chain only has to stay unbroken for the change after it
  chains.set(key, next.catch(() => undefined));
  return next;
}

/** The owner's own agent names held by a live daemon. A principal of another node or owner is not one. */
function agentNamesOf(ctx: RegistryContext, owner: string, principals: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of principals) {
    const parsed = parseGAII(p);
    if (parsed && parsed.owner === owner && parsed.node === ctx.config.nodeId) out.push(parsed.agent);
  }
  return out;
}

/** The owner's connected daemons that can be addressed, with the agent names each holds. */
function liveConnectors(ctx: RegistryContext, owner: string) {
  return connectedDaemons(owner)
    .filter(d => !!d.installId)
    .map(d => ({ id: d.installId as string, name: d.name, runModes: d.runModes, agents: agentNamesOf(ctx, owner, d.principals) }));
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Bring the record up to what the tunnel shows now: every connected connector is recorded with what
 * it reported and the agents it holds, and `closedId` (a connector that just disconnected) gets its
 * last-seen time. An agent lives on one machine, so a name seen on one connector leaves the others.
 */
export function syncConnectors(ctx: RegistryContext, owner: string, closedId?: string | null): Promise<void> {
  return mutate(ctx, owner, (reg) => {
    const now = new Date().toISOString();
    const live = liveConnectors(ctx, owner);
    let write = false;
    for (const d of live) {
      let rec = reg.connectors.find(c => c.id === d.id);
      if (!rec) {
        rec = { id: d.id, given_name: null, reported_name: d.name, first_seen: now, last_seen: now, run_modes: d.runModes, agents: [] };
        reg.connectors.push(rec);
      }
      const agents = [...new Set([...rec.agents, ...d.agents])].sort();
      const reported = d.name ?? rec.reported_name;
      const modes = d.runModes ?? rec.run_modes;
      // A connected connector is always written: its last-seen time is this moment.
      rec.agents = agents;
      rec.reported_name = reported;
      rec.run_modes = modes;
      rec.last_seen = now;
      write = true;
      for (const other of reg.connectors) {
        if (other.id === d.id) continue;
        const kept = other.agents.filter(n => !d.agents.includes(n));
        if (kept.length !== other.agents.length) { other.agents = kept; write = true; }
      }
    }
    if (closedId) {
      const rec = reg.connectors.find(c => c.id === closedId);
      if (rec && !live.some(d => d.id === closedId)) { rec.last_seen = now; write = true; }
    }
    return { write, result: undefined };
  });
}

/**
 * The owner's connectors, connected ones first, then by name. Live state is read from the tunnel,
 * so a connector that connected a moment ago is listed before the record has caught up.
 */
export async function listConnectors(ctx: RegistryContext, owner: string): Promise<ConnectorView[]> {
  const reg = await readRegistry(ctx, owner);
  const live = liveConnectors(ctx, owner);
  const agents = await ctx.storage.getAgentsByOwner(owner);
  const exists = new Set(agents.map(a => a.name));
  const keyless = new Set(agents.filter(a => !a.enrolledAt && !a.publicKey).map(a => a.name));
  const now = new Date().toISOString();
  const liveNames = new Map<string, string>();
  for (const d of live) for (const n of d.agents) liveNames.set(n, d.id);

  const ids = [...new Set([...reg.connectors.map(c => c.id), ...live.map(d => d.id)])];
  const rows: ConnectorView[] = ids.map((id) => {
    const rec = reg.connectors.find(c => c.id === id);
    const d = live.find(x => x.id === id);
    const reported = d?.name ?? rec?.reported_name ?? null;
    const held = new Set([...(rec?.agents ?? []), ...(d?.agents ?? [])]);
    return {
      id,
      name: rec?.given_name ?? reported,
      reported_name: reported,
      online: !!d,
      first_seen: rec?.first_seen ?? now,
      last_seen: d ? now : (rec?.last_seen ?? now),
      run_modes: d?.runModes ?? rec?.run_modes ?? null,
      // An agent seen live on another connector has moved there; a deleted agent is no longer anybody's.
      agents: [...held].filter(n => exists.has(n) && (liveNames.get(n) ?? id) === id).sort(),
      waiting: Object.entries(reg.wanted).filter(([n, want]) => want === id && keyless.has(n)).map(([n]) => n).sort(),
    };
  });
  return rows.sort((x, y) => Number(y.online) - Number(x.online) || (x.name ?? x.id).localeCompare(y.name ?? y.id));
}

/**
 * One connector by its id, or by a name: the owner's name for it or the one it reported, compared
 * without case. Null when there is none; 'ambiguous' when a name fits more than one.
 */
export async function findConnector(ctx: RegistryContext, owner: string, idOrName: string): Promise<ConnectorView | null | 'ambiguous'> {
  const wanted = idOrName.trim();
  if (!wanted) return null;
  const rows = await listConnectors(ctx, owner);
  const byId = rows.find(c => c.id === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  const byName = rows.filter(c => c.name?.toLowerCase() === lower || c.reported_name?.toLowerCase() === lower);
  if (byName.length > 1) return 'ambiguous';
  return byName[0] ?? null;
}

/**
 * The owner names one of their connectors, addressed by its id or by its present name. Two
 * connectors with one name could not be told apart, so a name another one carries is refused.
 */
export async function renameConnector(
  ctx: RegistryContext, owner: string, idOrName: string, name: unknown,
): Promise<{ ok: true; connector: ConnectorView } | Fail> {
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!clean || clean.length > INSTALL_NAME_MAX) {
    return fail(400, 'INVALID_INPUT', `A connector name is 1 to ${INSTALL_NAME_MAX} characters.`);
  }
  const hit = await findConnector(ctx, owner, idOrName);
  if (hit === 'ambiguous') return fail(409, 'AMBIGUOUS_CONNECTOR', 'More than one of your connectors has that name. Name it by its id.');
  if (!hit) return fail(404, 'NOT_FOUND', 'You have no such connector.');
  const id = hit.id;
  const rows = await listConnectors(ctx, owner);
  if (rows.some(c => c.id !== id && c.name?.toLowerCase() === clean.toLowerCase())) {
    return fail(409, 'NAME_TAKEN', `Another of your connectors is already called "${clean}".`);
  }
  await syncConnectors(ctx, owner);
  await mutate(ctx, owner, (reg) => {
    const rec = reg.connectors.find(c => c.id === id);
    if (!rec) return { write: false, result: undefined };
    rec.given_name = clean;
    return { write: true, result: undefined };
  });
  const after = (await listConnectors(ctx, owner)).find(c => c.id === id);
  if (!after) return fail(404, 'NOT_FOUND', 'You have no such connector.');
  logger.info('Connector renamed', { event: 'connector.renamed', owner, id });
  return { ok: true, connector: after };
}

/**
 * Remove a connector that is not connected from the owner's list. Its agents stay: they are records
 * on the node, and an agent that was waiting for this connector is then offered to whichever of the
 * owner's connectors connects next. A connected connector is refused, because it would be listed
 * again at once.
 */
export async function forgetConnector(ctx: RegistryContext, owner: string, id: string): Promise<{ ok: true } | Fail> {
  const rows = await listConnectors(ctx, owner);
  const row = rows.find(c => c.id === id);
  if (!row) return fail(404, 'NOT_FOUND', 'You have no such connector.');
  if (row.online) {
    return fail(409, 'CONNECTOR_ONLINE', 'That connector is connected right now. Stop it first, then forget it.');
  }
  await mutate(ctx, owner, (reg) => {
    reg.connectors = reg.connectors.filter(c => c.id !== id);
    for (const [name, want] of Object.entries(reg.wanted)) if (want === id) delete reg.wanted[name];
    return { write: true, result: undefined };
  });
  logger.info('Connector forgotten', { event: 'connector.forgotten', owner, id });
  return { ok: true };
}

/** An agent is ordered to one connector: until it enrols, only that connector is offered it. */
export function setWanted(ctx: RegistryContext, owner: string, agentName: string, installId: string): Promise<void> {
  return mutate(ctx, owner, (reg) => {
    if (reg.wanted[agentName] === installId) return { write: false, result: undefined };
    reg.wanted[agentName] = installId;
    return { write: true, result: undefined };
  });
}

/** Take back an order, for an agent that was not made after all. */
export function clearWanted(ctx: RegistryContext, owner: string, agentName: string): Promise<void> {
  return mutate(ctx, owner, (reg) => {
    if (!(agentName in reg.wanted)) return { write: false, result: undefined };
    delete reg.wanted[agentName];
    return { write: true, result: undefined };
  });
}

/**
 * Agent name → the install id of the connector that holds it, or, for an agent with no key yet,
 * the one it was ordered to. Built from listConnectors(), so the agent list and the connector list
 * cannot name two connectors for one agent. An agent the node cannot place is absent.
 */
export async function agentInstalls(ctx: RegistryContext, owner: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of await listConnectors(ctx, owner)) {
    for (const n of c.waiting) out[n] = c.id;
    for (const n of c.agents) out[n] = c.id;
  }
  return out;
}

/** Agent name → the install id each waiting agent was ordered to. */
export async function wantedInstalls(ctx: RegistryContext, owner: string): Promise<Record<string, string>> {
  return (await readRegistry(ctx, owner)).wanted;
}

/** These agents enrolled on this connector: they live there now, and wait for nothing. */
export function recordPlacement(ctx: RegistryContext, owner: string, agentNames: readonly string[], installId: string | null): Promise<void> {
  return mutate(ctx, owner, (reg) => {
    let write = false;
    for (const name of agentNames) {
      if (name in reg.wanted) { delete reg.wanted[name]; write = true; }
    }
    if (installId) {
      const now = new Date().toISOString();
      let rec = reg.connectors.find(c => c.id === installId);
      if (!rec) {
        rec = { id: installId, given_name: null, reported_name: null, first_seen: now, last_seen: now, run_modes: null, agents: [] };
        reg.connectors.push(rec);
        write = true;
      }
      for (const other of reg.connectors) {
        const kept = other.id === installId
          ? [...new Set([...other.agents, ...agentNames])].sort()
          : other.agents.filter(n => !agentNames.includes(n));
        if (!sameList(kept, other.agents)) { other.agents = kept; write = true; }
      }
    }
    return { write, result: undefined };
  });
}

const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

function onOpened(ctx: RegistryContext, info: TunnelSocketOpened): void {
  // An ecosystem app's socket is not a connector that holds agent keys, and a connector with no
  // install id cannot be addressed.
  if (info.principal.startsWith('eco:') || !info.installId) return;
  if (info.nodeId !== ctx.config.nodeId) return;
  const key = `${info.nodeId}\n${info.owner}`;
  if (scheduled.has(key)) return;
  const timer = setTimeout(() => {
    scheduled.delete(key);
    runAsNode(ctx.config.nodeId, () => {
      void syncConnectors(ctx, info.owner)
        .then(() => emitChange('agents'))
        .catch(err => logger.warn('Connector registry: sync on connect failed', { event: 'connector.sync_failed', owner: info.owner, error: String(err) }));
    });
  }, SETTLE_MS);
  timer.unref?.();
  scheduled.set(key, timer);
}

function onClosed(ctx: RegistryContext, info: TunnelSocketOpened): void {
  if (info.principal.startsWith('eco:') || !info.installId) return;
  if (info.nodeId !== ctx.config.nodeId) return;
  // A socket's close event arrives as no node, so this runs as this node, like the timer above.
  runAsNode(ctx.config.nodeId, () => {
    void syncConnectors(ctx, info.owner, info.installId)
      .then(() => emitChange('agents'))
      .catch(err => logger.warn('Connector registry: sync on disconnect failed', { event: 'connector.sync_failed', owner: info.owner, error: String(err) }));
  });
}

/** Record connectors as they connect and disconnect. Called once at start, after the tunnel manager exists. */
export function startConnectorRegistry(ctx: RegistryContext): () => void {
  const offOpen = onTunnelSocketOpened(info => onOpened(ctx, info));
  const offClose = onTunnelSocketClosed(info => onClosed(ctx, info));
  return () => {
    offOpen();
    offClose();
    for (const t of scheduled.values()) clearTimeout(t);
    scheduled.clear();
  };
}
