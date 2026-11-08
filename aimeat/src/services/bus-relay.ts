/**
 * @file src/services/bus-relay.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event bus (./event-bus.ts) between the processes of one node: every event this
 *   process produces goes out on the storage's bus wire (PostgreSQL NOTIFY, storage/bus-wire.ts), and
 *   every event another process produced comes in and is told to this process's listeners as remote
 *   (emitRemote). SQLite has no wire: one process per database, and nothing starts here.
 *
 *   WHAT GOES OVER. The whole event, as JSON. Most events are a domain name and a time; a delivery to
 *   an agent carries the task or the message it delivers, so the agent's tunnel on the other process
 *   pushes the same frame it would push here. A message longer than the wire takes (about 7.5 kB) is
 *   cut into parts sent in one statement, which arrive together and in order, and joined again; one
 *   over MAX_MESSAGE_BYTES is not sent, with a log line (the tunnel's backlog from storage still
 *   carries a delivery when the agent reconnects).
 *
 *   ONE PROCESS. A message from this process comes back on its own LISTEN and is dropped by its id,
 *   so with one process nothing reaches a listener twice and every answer stays as it was.
 *
 *   REGISTRIES BEFORE THE STREAMS. A process keeps some of the operator's decisions in memory: the
 *   federation peers, the internet openings, maintenance mode, the stored settings. A change another
 *   process made arrives as its `change` event; the relay first reads the registry of that domain
 *   again (RemoteReload, at most RELOAD_WAIT_MS), and then tells this process's listeners, so a page
 *   that re-reads on the frame sees the new state and a request after it is judged by it. Events are
 *   told in the order they arrived. After the wire was down, every registry is read again, because
 *   whatever was sent meanwhile is lost.
 *
 *   A LOST EVENT. Delivery is at most once: a send that fails is dropped, a process that crashes
 *   before its send loses it, and a listening connection can go deaf without ending. With several
 *   processes per node each registry therefore has a stored mark the changing process moves before
 *   its event goes out (RegistryVersions), and every process reads again, every REGISTRY_RESYNC_MS, a
 *   registry whose mark moved since it read it. So a removed peer or a closed opening stays in force on
 *   another process for at most that long. With one process per node (the default) there are no marks
 *   and no timer.
 * @structure MAX_MESSAGE_BYTES · RELOAD_WAIT_MS · REGISTRY_RESYNC_MS · RegistryVersions · storedRegistryVersions ·
 *   RemoteReload · encodeMessage · createBusRelay · startBusRelay · stopBusRelays
 * @usage const relay = await startBusRelay(storage, config.nodeId, reloads, { severalProcesses }); // null on SQLite
 * @version-history
 *   v1.1.0 — 2026-11-08 — Registry marks and the resync timer on a node with several processes, so a
 *     lost event cannot keep a removed peer or a closed opening in force (secaudit2026nov08 round 14,
 *     registry-reload/no-resync-after-lost-notify); the aiJobCancel and tunnelControl channels.
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { BUS_WIRE_PAYLOAD_BYTES, type BusWire } from '../storage/bus-wire.js';
import { addBusTransport, emitRemote, type BusChannelName, type BusTransport, type ChangeEvent } from './event-bus.js';
import { runAsNode } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The longest event the relay sends to the other processes, in bytes of JSON. */
export const MAX_MESSAGE_BYTES = 512 * 1024;

/** How long an event from another process waits for the registry it changed to be read again. */
export const RELOAD_WAIT_MS = 2_000;

/** Bytes of the event per part when it is cut; base64 of this plus the envelope stays inside the wire's limit. */
const PART_BYTES = 5_000;
/** At most this many messages per NOTIFY statement. */
const SEND_BATCH = 200;
/** A part whose siblings have not all come within this long is dropped. */
const PART_TTL_MS = 30_000;
/** At most this many cut messages are joined at once. */
const MAX_JOINING = 256;

const CHANNELS: ReadonlySet<string> = new Set<BusChannelName>(['change', 'delivery', 'task-moved', 'publicActivity', 'memoryWritten', 'rowsAppended', 'appChange', 'aiJobCancel', 'tunnelControl']);

/** How often a process with several siblings compares the registries' stored marks with what it read (resync). */
export const REGISTRY_RESYNC_MS = 30_000;

/**
 * Where each registry's change mark is stored, for a node with several processes. The process that
 * makes a change writes a new mark before its event goes out; every process compares the marks with
 * the ones it read on a timer and reads a registry again whose mark moved. So a lost event (a send
 * that failed, a crash before the send, a listening connection that went deaf without ending) keeps a
 * removed peer or a closed opening in force for at most REGISTRY_RESYNC_MS, not until a restart.
 * A change written to storage without the node (no new mark) is not picked up by the timer.
 */
export interface RegistryVersions {
  /** The current mark of the registry `domain` names, or null when none was written yet. */
  read(domain: string): Promise<string | null>;
  /** Write a new mark for `domain` and answer it. */
  bump(domain: string): Promise<string>;
}

/** The marks as memory records of the node's system identity, one per registry. */
export function storedRegistryVersions(storage: Pick<Storage, 'getMemory' | 'setMemory'>, nodeId: string): RegistryVersions {
  const owner = `system@${nodeId}`;
  const key = (domain: string) => `bus.registry-version.${domain}`;
  return {
    async read(domain) {
      const v = (await storage.getMemory(owner, key(domain)))?.value as { mark?: unknown } | undefined;
      return typeof v?.mark === 'string' ? v.mark : null;
    },
    async bump(domain) {
      const existing = await storage.getMemory(owner, key(domain));
      const now = new Date().toISOString();
      const mark = randomUUID();
      await storage.setMemory({
        key: key(domain), ownerGaii: owner, value: { mark, at: now }, visibility: 'private',
        tags: ['bus'], ttlHours: null, version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
      return mark;
    },
  };
}

/** One registry this process keeps in memory, read again when another process changed it. */
export interface RemoteReload {
  name: string;
  /** The `change` domains that mean another process changed it. */
  domains: readonly string[];
  /** Read it again from storage. Never throws (a failure keeps the last copy, with a log line). */
  run(): Promise<void>;
}

interface Whole { v: 1; p: string; c: BusChannelName; e: object }
interface Part { v: 1; p: string; m: string; i: number; n: number; d: string }

/**
 * The wire messages for one event: one when it fits, else its parts. Empty when the event is over
 * MAX_MESSAGE_BYTES. Exported for the unit test.
 */
export function encodeMessage(processId: string, channel: BusChannelName, evt: object): string[] {
  const whole = JSON.stringify({ v: 1, p: processId, c: channel, e: evt } satisfies Whole);
  if (Buffer.byteLength(whole, 'utf8') <= BUS_WIRE_PAYLOAD_BYTES) return [whole];
  const body = Buffer.from(JSON.stringify({ c: channel, e: evt }), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) return [];
  const m = randomUUID();
  const n = Math.ceil(body.length / PART_BYTES);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = body.subarray(i * PART_BYTES, (i + 1) * PART_BYTES).toString('base64');
    parts.push(JSON.stringify({ v: 1, p: processId, m, i, n, d } satisfies Part));
  }
  return parts;
}

/** The single-flight form of `fn`: a call during a run waits for one more run after it, shared by every such call. */
function singleFlight(name: string, fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    const p: Promise<void> = fn()
      .catch((err: unknown) => { logger.warn('bus: a registry was not read again; the last copy stays', { registry: name, error: String(err) }); })
      .finally(() => { if (running === p) running = null; });
    running = p;
    return p;
  };
  return () => {
    if (!running) return start();
    if (!queued) queued = running.then(() => { queued = null; return start(); });
    return queued;
  };
}

export interface BusRelay extends BusTransport {
  /** This process's id on the wire. */
  readonly processId: string;
  /** One message from the wire. */
  receive(payload: string): void;
  /** Read every registry again (after the wire was down). */
  reloadAll(): Promise<void>;
  /** Read again every registry whose stored mark moved since this process read it (RegistryVersions). A no-op without marks. */
  resync(): Promise<void>;
  /** Resolves when everything received so far was told and everything published so far was sent. */
  idle(): Promise<void>;
}

export interface BusRelayOptions {
  wire: Pick<BusWire, 'send'>;
  /** The node this relay serves: remote events are told as it, as a request of it would be. */
  nodeId: string;
  reloads?: readonly RemoteReload[];
  processId?: string;
  reloadWaitMs?: number;
  /** The registries' stored marks: given on a node with several processes only (startBusRelay). */
  versions?: RegistryVersions;
}

/** A relay that is not yet anybody's transport and listens to nothing: startBusRelay wires it. */
export function createBusRelay(opts: BusRelayOptions): BusRelay {
  const processId = opts.processId ?? randomUUID();
  const waitMs = opts.reloadWaitMs ?? RELOAD_WAIT_MS;
  const versions = opts.versions;
  // The mark each registry had when this process last read it; a read takes the mark first, so a
  // change made during the read moves the mark again and is read at the next resync.
  const seen = new Map<string, string | null>();
  const markOf = (r: RemoteReload): string => r.domains[0] ?? r.name;
  const readMark = (r: RemoteReload): Promise<string | null | undefined> => versions
    ? versions.read(markOf(r)).catch((err: unknown) => { logger.warn('bus: a registry mark was not read', { registry: r.name, error: String(err) }); return undefined; })
    : Promise.resolve(undefined);
  const reloads = (opts.reloads ?? []).map(r => ({
    ...r,
    request: singleFlight(r.name, async () => {
      const mark = await readMark(r);
      await r.run();
      if (mark !== undefined) seen.set(r.name, mark);
    }),
  }));

  let outbox: string[] = [];
  let flushScheduled = false;
  let sending: Promise<void> = Promise.resolve();
  let telling: Promise<void> = Promise.resolve();
  const joining = new Map<string, { parts: Array<Buffer | undefined>; got: number; at: number }>();

  const flush = (): void => {
    flushScheduled = false;
    const batch = outbox;
    outbox = [];
    sending = sending.then(async () => {
      for (let i = 0; i < batch.length; i += SEND_BATCH) {
        await opts.wire.send(batch.slice(i, i + SEND_BATCH)).catch((err: unknown) => {
          logger.warn('bus: events were not sent to the other processes of this node', { count: Math.min(SEND_BATCH, batch.length - i), error: String(err) });
        });
      }
    });
  };

  const wait = (p: Promise<void>): Promise<void> =>
    Promise.race([p, new Promise<void>(r => { const t = setTimeout(r, waitMs); t.unref?.(); })]);

  const tell = (channel: BusChannelName, evt: object): void => {
    // The read starts when the event arrives, so a burst of the same domain shares one read
    // (singleFlight); the event waits for it in its place in the line.
    const domain = channel === 'change' ? (evt as ChangeEvent).domain : null;
    const due = domain === null ? [] : reloads.filter(r => r.domains.includes(domain));
    const reloaded = due.length ? Promise.all(due.map(r => r.request())).then(() => undefined) : null;
    telling = telling.then(async () => {
      if (reloaded) await wait(reloaded);
      try {
        runAsNode(opts.nodeId, () => emitRemote(channel, evt));
      } catch (err) {
        logger.warn('bus: a listener failed on an event from another process', { channel, error: String(err) });
      }
    });
  };

  const join = (part: Part): { c: BusChannelName; e: object } | null => {
    const now = Date.now();
    for (const [k, j] of joining) if (now - j.at > PART_TTL_MS) joining.delete(k);
    const key = `${part.p}:${part.m}`;
    let j = joining.get(key);
    if (!j) {
      if (joining.size >= MAX_JOINING) joining.delete(joining.keys().next().value as string);
      j = { parts: new Array<Buffer | undefined>(part.n).fill(undefined), got: 0, at: now };
      joining.set(key, j);
    }
    if (part.i < 0 || part.i >= j.parts.length || j.parts[part.i]) return null;
    j.parts[part.i] = Buffer.from(part.d, 'base64');
    if (++j.got < j.parts.length) return null;
    joining.delete(key);
    return JSON.parse(Buffer.concat(j.parts as Buffer[]).toString('utf8')) as { c: BusChannelName; e: object };
  };

  return {
    processId,
    publish(channel, evt) {
      if (versions && channel === 'change') {
        // A registry change: its new mark is written before the event goes out (the send waits on
        // the same chain), so a process that hears the event and reads the registry reads the new
        // mark with it, and one that misses the event finds the mark moved at its next resync.
        const domain = (evt as ChangeEvent).domain;
        const due = reloads.filter(r => r.domains.includes(domain));
        if (due.length) {
          sending = sending.then(async () => {
            // This process made the change and holds it, so the new mark is the one it has read.
            await Promise.all(due.map(r => versions.bump(markOf(r)).then(mark => { seen.set(r.name, mark); }, (err: unknown) => {
              logger.warn('bus: a registry mark was not written; other processes rely on the event alone', { registry: r.name, error: String(err) });
            })));
          });
          if (!flushScheduled) { flushScheduled = true; setImmediate(flush); }
        }
      }
      const messages = encodeMessage(processId, channel, evt);
      if (messages.length === 0) {
        logger.warn('bus: an event too long for the other processes was told in this process only', { channel, limitBytes: MAX_MESSAGE_BYTES });
        return;
      }
      outbox.push(...messages);
      if (!flushScheduled) { flushScheduled = true; setImmediate(flush); }
    },
    receive(payload) {
      let msg: Partial<Whole & Part>;
      try { msg = JSON.parse(payload) as Partial<Whole & Part>; } catch { return; }
      if (!msg || msg.v !== 1 || typeof msg.p !== 'string' || msg.p === processId) return;
      let whole: { c: unknown; e: unknown } | null;
      if (typeof msg.m === 'string') {
        if (typeof msg.d !== 'string' || !Number.isInteger(msg.i) || !Number.isInteger(msg.n) || (msg.n as number) < 1) return;
        try { whole = join(msg as Part); } catch (err) {
          logger.warn('bus: a cut event from another process could not be joined', { error: String(err) });
          return;
        }
        if (!whole) return;
      } else {
        whole = { c: msg.c, e: msg.e };
      }
      if (typeof whole.c !== 'string' || !CHANNELS.has(whole.c) || !whole.e || typeof whole.e !== 'object') return;
      tell(whole.c as BusChannelName, whole.e);
    },
    async reloadAll() {
      await Promise.all(reloads.map(r => r.request()));
    },
    async resync() {
      if (!versions) return;
      await Promise.all(reloads.map(async (r) => {
        const mark = await readMark(r);
        if (mark === undefined) return;
        if (!seen.has(r.name)) { seen.set(r.name, mark); return; }
        if (seen.get(r.name) === mark) return;
        logger.info('bus: a registry changed on another process with no event here; reading it again', { registry: r.name });
        await r.request();
      }));
    },
    async idle() {
      if (flushScheduled) flush();
      await Promise.all([sending, telling]);
    },
  };
}

interface Running { relay: BusRelay; wire: BusWire; detach: () => void; timer?: ReturnType<typeof setInterval> }
// process-local: the relays this process runs, one per node it serves, so a stop closes their connections.
const running = new Set<Running>();

/**
 * Start carrying this node's events to its other processes and back, when the storage has a wire
 * (PostgreSQL). Answers null without one. Call once per node, after the registries in `reloads` were
 * loaded. A failed first connection is logged and retried by the wire; until it listens, events from
 * other processes do not arrive here, and this process's still go out.
 */
export async function startBusRelay(
  storage: Storage, nodeId: string, reloads: readonly RemoteReload[], opts: { severalProcesses?: boolean } = {},
): Promise<BusRelay | null> {
  const wire = storage.busWire?.();
  if (!wire) return null;
  // Several processes: the registries carry stored marks, and a timer reads again what moved
  // (RegistryVersions). One process, the default: neither, as before 2026-11-08.
  const versions = opts.severalProcesses ? storedRegistryVersions(storage, nodeId) : undefined;
  const relay = createBusRelay({ wire, nodeId, reloads, ...(versions ? { versions } : {}) });
  const detach = addBusTransport(relay);
  const run: Running = { relay, wire, detach };
  if (versions) {
    await relay.resync();   // the marks as they are now, which the registries loaded at boot answer to
    // process-local: each process compares the stored marks with what it read; the marks are in storage.
    run.timer = setInterval(() => { void relay.resync(); }, REGISTRY_RESYNC_MS);
    run.timer.unref?.();
  }
  running.add(run);
  try {
    await wire.listen({
      message: (payload) => relay.receive(payload),
      reconnected: () => {
        logger.info('bus: the connection to the other processes is back; reading the registries again');
        void relay.reloadAll();
      },
    });
  } catch (err) {
    logger.warn('bus: not listening to the other processes yet; the connection is retried', { error: String(err) });
  }
  return relay;
}

/** Stop every relay of this process: nothing more goes out, and the listening connections close. */
export async function stopBusRelays(): Promise<void> {
  const all = [...running];
  running.clear();
  for (const r of all) {
    if (r.timer) clearInterval(r.timer);
    r.detach();
    await r.relay.idle().catch((err: unknown) => { logger.warn('bus: events were left unsent at the stop', { error: String(err) }); });
    await r.wire.close().catch((err: unknown) => { logger.warn('bus: the listening connection did not close cleanly at the stop', { error: String(err) }); });
  }
}
