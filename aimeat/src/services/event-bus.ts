/**
 * @file event-bus.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pub/sub bus for live updates, in each process, and carried to the node's other
 *   processes by the transports of services/bus-relay.ts (see "Other processes" below). Channels:
 *   `change` — coarse domain-string events broadcast to every SSE client (UI
 *   live refresh); `delivery` — agent-scoped targeted events carrying a full
 *   payload, consumed by the ConnectTunnelManager to push a single agent's
 *   socket (realtime reverse delivery). SSE never subscribes to `delivery`, so
 *   per-agent payloads are not broadcast to UI clients.
 * @structure emitChange/emitRecordChange/emitRecordChangePriorUnknown/onChangeEvent/offChangeEvent (change) +
 *   emitDelivery/onDeliveryEvent/offDeliveryEvent (delivery), and the task-moved, publicActivity,
 *   memoryWritten, rowsAppended, appChange, aiJobCancel and tunnelControl channels;
 *   addBusTransport/emitRemote/isRemoteEvent (other processes).
 * @usage import { emitDelivery } from '../services/event-bus.js';
 * @version-history
 *   v1.0.0 — pre-2026-06 — Initial change-event bus for SSE live updates.
 *   v1.1.0 — 2026-06-10 — Add the agent-scoped `delivery` channel for the
 *     connector forward tunnel's realtime reverse delivery.
 *   v1.2.0 — 2026-06-16 — Add the `publicActivity` broadcast channel carrying a
 *     full public-feed event payload to every public SSE client (landing feed).
 *   v1.3.0 — 2026-06-21 — `change` events carry an optional `ownerGaii` so the SSE
 *     transport can scope owner-private domains per connected owner (hot agent paths);
 *     omitted owner = global broadcast (shared data stays visible to all owners).
 *   v1.4.0 — 2026-06-22 — `MemoryWriteEvent` carries an optional `op` ('created'|'updated') so the
 *     connector record-push (ConnectTunnelManager) can label workspace.record wakes; best-effort,
 *     set by the generic memory route, defaulted to 'updated' by consumers when absent.
 *   v1.5.0 — 2026-10-11 — emitRecordChange: a `memory` or `files` change to a private or
 *     owner-visible record carries its owner, so it reaches that owner's streams only. Every such
 *     change was global, which v1.3.0's owner scope never reached.
 *   v1.6.0 — 2026-10-13 — The `rowsAppended` channel: one event per append call to a workspace row
 *     space, which the workflow engine's `workspace.rows` triggers start from.
 *   v1.7.0 — 2026-10-18 — The `appChange` channel: one app's new version or draft change, which the
 *     SSE transport forwards to the streams opened for that app (the app page's update news).
 *   v1.8.0 — 2026-10-18 — emitWorkspaceChange: a change in one workspace is the live domain
 *     `workspace:<organismId>/<ws>`, told only to the organism's members (ChangeEvent.organismId).
 *     A written key inside a workspace and an appended row emit it from here; the workspace
 *     operations that write no key (a draft, a delete, an archive) call it themselves.
 *   v1.9.0 — 2026-11-04 — ChangeEvent.ownerOnly: emitRecordChange marks a change every record of
 *     which only its owner reads, before and after, so the read cache keeps what it computed from
 *     records others read. emitRecordChangePriorUnknown for a writer that does not know the earlier
 *     visibility: routed to the streams the same way, never marked (codebase analysis 2026-11-03,
 *     item C4).
 *   v1.10.0 — 2026-11-04 — The bus reaches the node's other processes: every event is also handed
 *     to the transports added with addBusTransport (services/bus-relay.ts, PostgreSQL LISTEN/NOTIFY),
 *     and an event another process produced arrives through emitRemote. isRemoteEvent tells a
 *     listener which is which: a listener that starts work (a workflow trigger, the content intake,
 *     a data product, a tracked response) runs only for its own process's events; a listener that
 *     tells a browser, a tunnel or a cache runs for every process's events. With no transport (SQLite,
 *     one process) nothing here changes (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 *   v1.11.0 — 2026-11-08 — The `aiJobCancel` and `tunnelControl` channels: a cancel of an AI job that
 *     another process runs, and a tunnel revocation, stop or permission change for a socket another
 *     process holds (secaudit2026nov08 round 14). Their listeners act only on another process's event.
 */
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0); // unlimited — each SSE client adds a listener

// ── Other processes of this node ────────────────────────────────────────────
//
// THE ORIGIN RULE. An event reaches every process of the node, so a listener that STARTS work would
// start it once per process. Such a listener asks isRemoteEvent(evt) and returns for an event another
// process produced: the process where the write happened does the work, once. A listener that only
// tells somebody (an SSE stream, an agent's tunnel, a read cache, a registry reload) runs for every
// event, because the browser, the agent or the cache may be on any process.
//
// The mark is kept beside the event object, never in it: the public activity stream sends its event
// object as it is, and a field added here would reach every visitor's page.

/** The channels of this bus. Every one of them reaches the node's other processes. */
export type BusChannelName = 'change' | 'delivery' | 'task-moved' | 'publicActivity' | 'memoryWritten' | 'rowsAppended' | 'appChange'
  | 'aiJobCancel' | 'tunnelControl';

/** What carries this process's events to the node's other processes (services/bus-relay.ts). Never throws. */
export interface BusTransport { publish(channel: BusChannelName, evt: object): void }

// process-local: the transports this process hands its events to; each process adds its own at boot.
const transports = new Set<BusTransport>();
const remoteEvents = new WeakSet<object>();

/** Hand every later event to `transport` as well. Answers the function that stops it. */
export function addBusTransport(transport: BusTransport): () => void {
  transports.add(transport);
  return () => { transports.delete(transport); };
}

/** One event on one channel: to the other processes, then to this process's listeners as before. */
function fire(channel: BusChannelName, evt: object): void {
  for (const t of transports) t.publish(channel, evt);
  bus.emit(channel, evt);
}

/**
 * An event another process of this node produced, told to this process's listeners. It is never
 * handed to a transport again, so it reaches each process once.
 */
export function emitRemote(channel: BusChannelName, evt: object): void {
  remoteEvents.add(evt);
  bus.emit(channel, evt);
}

/** True for an event another process produced (emitRemote). A listener that starts work returns for it. */
export function isRemoteEvent(evt: object): boolean {
  return remoteEvents.has(evt);
}

export interface ChangeEvent {
  domain: string;
  timestamp: number;
  /**
   * Owner this change concerns (GHII or GAII — only the owner SEGMENT is compared). When set,
   * the SSE transport forwards the event ONLY to streams owned by that owner; when ABSENT the
   * event is global (broadcast to every client). Default-omit keeps shared-data changes
   * (organisms, boards, public activity, …) visible to other owners. See sse.ts owner filter.
   */
  ownerGaii?: string;
  /**
   * The organism whose MEMBERS this change concerns. When set, the SSE transport forwards the event
   * only to streams whose account is an active member of that organism (services/audience.ts
   * isOrganismMember). Set by emitWorkspaceChange: the domain names one workspace, and that name and
   * its timing are the members' business only.
   */
  organismId?: string;
  /**
   * True when every record this change touched was readable by its owner alone, before the change
   * and after it: emitRecordChange sets it when the writer named every visibility involved. The read
   * cache (server-bootstrap/process-buffers.ts) then drops only what it keeps for that owner, and
   * keeps what it computed from records other people read. Absent means the change may concern
   * others, and every cache of the domain is dropped as before.
   */
  ownerOnly?: boolean;
}

export function emitChange(domain: string, ownerGaii?: string): void {
  fire('change', { domain, timestamp: Date.now(), ...(ownerGaii ? { ownerGaii } : {}) } satisfies ChangeEvent);
}

/** Every workspace domain starts with this; the rest is `<organismId>/<workspaceId>`. */
export const WORKSPACE_DOMAIN_PREFIX = 'workspace:';

/** The live domain of one organism workspace: what a page subscribes to with AIMEAT.live. */
export function workspaceDomain(organismId: string, ws: string): string {
  return `${WORKSPACE_DOMAIN_PREFIX}${organismId}/${ws}`;
}

const WORKSPACE_KEY = /^organism\.([^.]+)\.w\.([^.]+)\./;

/** The organism and workspace a memory key lies in, or null for a key outside every workspace. */
export function workspaceOfKey(key: string): { organismId: string; ws: string } | null {
  const m = WORKSPACE_KEY.exec(key);
  return m ? { organismId: m[1]!, ws: m[2]! } : null;
}

/**
 * Something in one workspace changed: a record, a draft, a document, a row, a deletion. The domain
 * names the workspace, so a page that shows it re-reads only when its own workspace changed. The
 * `memory` and `organisms` events stay as they are; until 2026-10-18 they were all a page had, and a
 * memory write anywhere on the node woke every open workspace page, about once a second on a busy node
 * (wish-reaaliaikainen-tapahtuma-kertoo-mink-ty-tilan-tieto-muuttui).
 */
export function emitWorkspaceChange(organismId: string, ws: string): void {
  if (!organismId || !ws) return;
  fire('change', { domain: workspaceDomain(organismId, ws), timestamp: Date.now(), organismId } satisfies ChangeEvent);
}

/** The visibilities under which only the owner and the owner's own agents and apps read a record. */
const OWNER_ONLY_VISIBILITY: ReadonlySet<string> = new Set(['private', 'owner']);

/**
 * True when a change to a record of `ownerGaii` concerns that owner alone: the owner is an account
 * (a GHII or a GAII, which carry an '@'), and every visibility given is one nobody else reads.
 * Several visibilities are given when a write moved a record from one to another: a record that
 * was public a moment ago is still somebody else's business once.
 */
export function isOwnerOnlyChange(ownerGaii: string | null | undefined, ...visibilities: Array<string | null | undefined>): boolean {
  if (!ownerGaii || !ownerGaii.includes('@') || visibilities.length === 0) return false;
  return visibilities.every(v => typeof v === 'string' && OWNER_ONLY_VISIBILITY.has(v));
}

/**
 * A change to one stored record or file, told to the streams that may read it.
 *
 * A private or owner-visible record of an account goes to that owner's streams only. Everything
 * else is global as before: a record other people read (public, group, workspace, members), a
 * record of a namespace that is no account (`ext:name`), and a record whose visibility the caller
 * does not know. Until 2026-10-11 every `memory` and `files` change was global, so one owner's
 * private write woke every other owner's open page and told it, by the timing alone, that somebody
 * was writing (measured in test/e2e-sse.ts).
 */
export function emitRecordChange(
  domain: 'memory' | 'files',
  ownerGaii: string | null | undefined,
  ...visibilities: Array<string | null | undefined>
): void {
  if (isOwnerOnlyChange(ownerGaii, ...visibilities)) {
    // The writer named every visibility the change involved, so the read cache may keep what it
    // computed from records other people read (ChangeEvent.ownerOnly).
    fire('change', { domain, timestamp: Date.now(), ownerGaii: ownerGaii as string, ownerOnly: true } satisfies ChangeEvent);
    return;
  }
  emitChange(domain);
}

/**
 * emitRecordChange for a writer that does not know what every record held before: a batch that does
 * not read the keys it overwrites, or a write of a fixed visibility over whatever the key held. The
 * streams hear it exactly as emitRecordChange would tell them; the read cache treats it as a change
 * other people may read, because a record it moved from public to private was public a moment ago.
 */
export function emitRecordChangePriorUnknown(
  domain: 'memory' | 'files',
  ownerGaii: string | null | undefined,
  ...visibilities: Array<string | null | undefined>
): void {
  emitChange(domain, isOwnerOnlyChange(ownerGaii, ...visibilities) ? ownerGaii as string : undefined);
}

export function onChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.on('change', handler);
}

export function offChangeEvent(handler: (evt: ChangeEvent) => void): void {
  bus.off('change', handler);
}

// ── Targeted delivery channel (agent-scoped realtime push) ──────────────────
// The `change` channel above is coarse (a domain string broadcast to every SSE
// client) — unsuitable for pushing a full task payload to ONE agent. This
// separate `delivery` channel carries an explicit `target` identity + the full
// object so the ConnectTunnelManager can fan it out to exactly that agent's
// socket, without leaking the payload to SSE consumers (which never subscribe
// here). This is how Phase 2 "enriches" push with a target identity.

export interface DeliveryEvent {
  /** The GAII this delivery is for. */
  target: string;
  /** Delivery kind, e.g. 'task_assigned' | 'message'. */
  kind: string;
  /** Stable dedup id (e.g. the task id). */
  id: string;
  /** The full object delivered (zero round-trip). */
  payload: unknown;
  timestamp: number;
}

export function emitDelivery(evt: Omit<DeliveryEvent, 'timestamp'>): void {
  fire('delivery', { ...evt, timestamp: Date.now() } satisfies DeliveryEvent);
}

export function onDeliveryEvent(handler: (evt: DeliveryEvent) => void): void {
  bus.on('delivery', handler);
}

export function offDeliveryEvent(handler: (evt: DeliveryEvent) => void): void {
  bus.off('delivery', handler);
}

// ── One task moved (nudge only, no payload) ────────────────────────────────
//
// A2A streaming needs to know that a task changed, for a caller that may be nobody's connector: the
// delivery channel above only fires when the target HOLDS A LIVE TUNNEL, because that is what it is
// for. A stranger's A2A client subscribed to a task has no tunnel and would have heard nothing.
//
// IT CARRIES NO DATA ON PURPOSE. The listener re-reads the task through the same op every other
// reader uses, so the fence that decides who may see a task is applied in exactly one place and a
// subscriber cannot be handed a task it would have been refused. An event that carried the record
// would be a second read path with no check on it.

export interface TaskMovedEvent {
  taskId: string;
  timestamp: number;
}

export function emitTaskMoved(taskId: string): void {
  fire('task-moved', { taskId, timestamp: Date.now() } satisfies TaskMovedEvent);
}

export function onTaskMoved(handler: (evt: TaskMovedEvent) => void): void {
  bus.on('task-moved', handler);
}

export function offTaskMoved(handler: (evt: TaskMovedEvent) => void): void {
  bus.off('task-moved', handler);
}

// ── Public activity channel (broadcast, full payload) ───────────────────────
// The landing page's public activity feed needs the FULL event (category, time,
// summary, link) pushed to every connected public SSE client — unlike the coarse
// `change` channel (a marker the UI uses only to trigger a re-fetch). This is a
// broadcast (no `target`, unlike `delivery`): every public viewer sees the same
// public events. Producers call `recordPublicActivity` (services/public-activity.ts)
// which persists the event, then emits here.

export interface PublicActivityEvent {
  /** Which landing tab this belongs to. */
  category: 'apps' | 'organisms' | 'agents';
  /** ISO 8601 timestamp of when it happened. */
  at: string;
  /** Display name segment only — never a full private GAII path. */
  actor: string;
  /** One-line human summary shown in the feed row. */
  summary: string;
  /** Short curated detail blob (already-public fields only). */
  detail: string;
  /** Link to an existing unauthenticated route for the material/event. */
  link: string;
}

export function emitPublicActivity(evt: PublicActivityEvent): void {
  fire('publicActivity', evt);
}

export function onPublicActivityEvent(handler: (evt: PublicActivityEvent) => void): void {
  bus.on('publicActivity', handler);
}

export function offPublicActivityEvent(handler: (evt: PublicActivityEvent) => void): void {
  bus.off('publicActivity', handler);
}

// ── Memory-write channel (reactive Memory Contracts) ────────────────────────
// The Memory Contract pattern (docs/coding-guidelines/memory-contracts.md) reacts to changes in a
// specific memory key. Central write paths (the generic memory-write route, the workspace publish
// path) emit `memoryWritten` with the written key; the contract subscriber checks the track-registry
// (O(1)) and evaluates only contracts watching that key. This is the event-driven trigger; a
// reconciler sweep is the safety net. Generic on purpose — the bus knows nothing about contracts.

export interface MemoryWriteEvent {
  /** The owner GAII the memory record was written under. */
  ownerGaii: string;
  /** The full memory key that was written. */
  key: string;
  /**
   * Whether this write CREATED the key or UPDATED an existing one. Best-effort: set by the generic
   * memory route (which already knows from its existing-record lookup); omitted by the publish paths
   * (a publish updates the published `.latest` view) — consumers default to 'updated' when absent.
   */
  op?: 'created' | 'updated';
  timestamp: number;
}

export function emitMemoryWritten(ownerGaii: string, key: string, op?: 'created' | 'updated'): void {
  fire('memoryWritten', { ownerGaii, key, ...(op ? { op } : {}), timestamp: Date.now() } satisfies MemoryWriteEvent);
  // Every central write path names its key here, so a key inside a workspace tells that workspace's
  // open pages from this one place.
  const inWs = workspaceOfKey(key);
  if (inWs) emitWorkspaceChange(inWs.organismId, inWs.ws);
}

export function onMemoryWrittenEvent(handler: (evt: MemoryWriteEvent) => void): void {
  bus.on('memoryWritten', handler);
}

export function offMemoryWrittenEvent(handler: (evt: MemoryWriteEvent) => void): void {
  bus.off('memoryWritten', handler);
}

// ── Rows-appended channel ───────────────────────────────────────────────────
// A row of a workspace row space is not a memory record, so appending one emits no `memoryWritten`
// and until 2026-10-13 nothing but the open pages heard of it (`emitChange('organisms')`). The row
// service emits this once per append call, after the insert; the workflow engine starts the
// `workspace.rows` triggers it matches. It carries the node id because the bus is one per process
// and a process may serve more than one node: a subscriber answers only for its own node.

export interface RowsAppendedEvent {
  nodeId: string;
  organismId: string;
  wsId: string;
  /** The space's name in the manifest (what a caller passes as `space`). */
  space: string;
  /** The space's storage namespace. */
  namespace: string;
  /** The rows this call wrote, in the order they were written. */
  rowIds: string[];
  /** The resolved identity that wrote them (the row's `createdBy`). */
  createdBy: string;
  timestamp: number;
}

export function emitRowsAppended(evt: Omit<RowsAppendedEvent, 'timestamp'>): void {
  fire('rowsAppended', { ...evt, timestamp: Date.now() } satisfies RowsAppendedEvent);
  emitWorkspaceChange(evt.organismId, evt.wsId);
}

export function onRowsAppendedEvent(handler: (evt: RowsAppendedEvent) => void): void {
  bus.on('rowsAppended', handler);
}

export function offRowsAppendedEvent(handler: (evt: RowsAppendedEvent) => void): void {
  bus.off('rowsAppended', handler);
}

// ── appChange ────────────────────────────────────────────────────────────────────────────────────
// One app changed: a new version went live, or its draft was written, discarded or promoted. The
// `change` channel's `apps` domain says only that SOME app changed, so an open app page could not
// tell its own update from any other publish on the node. The SSE transport forwards this channel
// to a stream that was opened for one app (routes/sse.ts), and only `version` to a visitor: a
// draft is seen by the owner and the people holding a development right (Jouni, 2026-10-18).

export interface AppChangeEvent {
  /** `owner/filename` with the bare owner name (services/app-record-keys.ts canonicalAppId form). */
  appId: string;
  /** `version`: a new version is live. `draft`: the draft slot was written, discarded or promoted. */
  kind: 'version' | 'draft';
  /** For `version`: the number now live. */
  version?: number;
  timestamp: number;
}

export function emitAppChange(evt: Omit<AppChangeEvent, 'timestamp'>): void {
  fire('appChange', { ...evt, timestamp: Date.now() } satisfies AppChangeEvent);
}

/**
 * A new live version of one app: the coarse `apps` domain for every stream, as before, and the
 * app's own `version` event for the pages that have it open.
 */
export function emitAppVersion(ownerName: string, filename: string, version: number): void {
  emitChange('apps');
  emitAppChange({ appId: `${ownerName}/${filename}`, kind: 'version', version });
}

export function onAppChangeEvent(handler: (evt: AppChangeEvent) => void): void {
  bus.on('appChange', handler);
}

export function offAppChangeEvent(handler: (evt: AppChangeEvent) => void): void {
  bus.off('appChange', handler);
}

// ── aiJobCancel ──────────────────────────────────────────────────────────────────────────────────
// A cancel of an AI job that another process of the node runs (services/ai-jobs/service.ts
// cancelJob). The process that took the cancel stored the job as cancelled; the process that runs it
// aborts its provider call when it hears this. It carries ids only. With one process nothing listens
// to another process's event, so nothing changes there.

export interface AiJobCancelEvent {
  /** The node the job belongs to: a process may serve more than one node in the multi-node suites. */
  nodeId: string;
  jobId: string;
  timestamp: number;
}

export function emitAiJobCancel(evt: Omit<AiJobCancelEvent, 'timestamp'>): void {
  fire('aiJobCancel', { ...evt, timestamp: Date.now() } satisfies AiJobCancelEvent);
}

export function onAiJobCancelEvent(handler: (evt: AiJobCancelEvent) => void): void {
  bus.on('aiJobCancel', handler);
}

export function offAiJobCancelEvent(handler: (evt: AiJobCancelEvent) => void): void {
  bus.off('aiJobCancel', handler);
}

// ── tunnelControl ────────────────────────────────────────────────────────────────────────────────
// A change to what a connector tunnel may hold, made on one process, for the tunnel sockets other
// processes hold (services/connect-tunnel/cross-process.ts): an agent deleted, moved or rekeyed, an
// account deactivated, a token revoked, an agent stopped or started, a permission change. A token is
// named by its id (auth/jwt.ts tokenIdOf), never by the token itself.

/** One decision about a tunnel identity. */
export type TunnelControl =
  | { op: 'gaii'; gaii: string; reason: 'moved' | 'deleted' | 'rekeyed' }
  | { op: 'owner'; owner: string }
  | { op: 'token'; tokenId: string }
  | { op: 'stopped'; gaii: string; stopped: boolean }
  | { op: 'scopes'; gaii: string };

export type TunnelControlEvent = TunnelControl & { nodeId: string; timestamp: number };

export function emitTunnelControl(nodeId: string, control: TunnelControl): void {
  fire('tunnelControl', { ...control, nodeId, timestamp: Date.now() } satisfies TunnelControlEvent);
}

export function onTunnelControlEvent(handler: (evt: TunnelControlEvent) => void): void {
  bus.on('tunnelControl', handler);
}

export function offTunnelControlEvent(handler: (evt: TunnelControlEvent) => void): void {
  bus.off('tunnelControl', handler);
}
