/**
 * @file presence.ts
 * @description Human (GHII) presence/availability tracker — the single source of
 *   truth for "is this person reachable right now". Holds three things in memory:
 *   (1) local online state derived from open portal SSE connections, (2) each
 *   owner's presence CONFIG (manual/auto, chosen status, visibility) cached from
 *   their `presence.config` memory key, and (3) a CACHE of remote owners' presence
 *   pushed to us by federation peers. Reads are ALWAYS local — a node renders
 *   presence straight from this structure, never fetching cross-node on demand.
 *
 *   Federation is CHANGE-DRIVEN, not polled: when a local owner's broadcastable
 *   status actually changes we mark it dirty; a flush loop (≤1/min) pushes the
 *   delta to active peers. An idle-but-online user therefore generates zero
 *   traffic. A peer receives a full snapshot once (on first flush after it goes
 *   active) and deltas thereafter. Only `visibility: 'everyone'` is federated —
 *   `contacts`/`nobody` never leave the home node (a remote `contacts` user reads
 *   as `unknown`). Stale remote entries are evicted when their source peer is no
 *   longer active, so a crashed home node's users drop network-wide without any
 *   per-user keepalive.
 * @structure
 *   - PresenceTracker class (module singleton `presence`)
 *   - markOnline/markOffline — called by the SSE transport on stream open/close
 *   - getConfig/setConfig — owner presence config (cached + persisted to memory)
 *   - getOwnStatus — the owner's own computed status (ignores visibility)
 *   - getVisible/getVisibleMany — viewer-scoped status for one/many targets
 *   - applyRemoteUpdates / getSnapshot — federation receive / snapshot
 *   - presenceSignString — canonical string signed/verified for peer pushes
 *   - init / flush — wire deps + start the throttled push loop
 * @usage import { presence } from '../services/presence.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial presence feature (local + federated, change-driven push).
 *   v1.1.0 — 2026-06-23 — Agent/app (GAII/GEAI) presence: a principal now reports its OWN liveness, not
 *     its owner's — a live connect-tunnel socket → available, recently-seen (lastSeen) → away, else
 *     offline (LOCAL principals only). Previously a GAII fell through to `unknown`.
 *   v1.2.0 — 2026-06-28 — Node-run system agents (Secretary/specialist) report liveness from their OWN
 *     usability via systemAgentLiveness (available/away/offline) instead of falling through to 'offline':
 *     they never open a tunnel or refresh lastSeen, so presence now reads their configured state.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign } from '../auth/keypair.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { emitChange } from './event-bus.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { logger } from '../utils/logger.js';

export type RawStatus = 'available' | 'busy' | 'away' | 'offline';
export type VisibleStatus = RawStatus | 'unknown';
export type ManualStatus = 'available' | 'busy' | 'away' | 'invisible';
export type PresenceMode = 'auto' | 'manual';
export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface PresenceConfig {
  mode: PresenceMode;
  status: ManualStatus;
  visibility: Visibility;
}

export interface PresenceView {
  ghii: string;
  status: VisibleStatus;
  since: string | null;
}

/** Memory key under the owner's GHII namespace that stores their presence config. */
export const PRESENCE_CONFIG_KEY = 'presence.config';

export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  mode: 'auto',
  status: 'available',
  visibility: 'everyone',
};

const MODES = new Set<PresenceMode>(['auto', 'manual']);
const MANUAL_STATUSES = new Set<ManualStatus>(['available', 'busy', 'away', 'invisible']);
const VISIBILITIES = new Set<Visibility>(['everyone', 'contacts', 'nobody']);

const CONFIG_CACHE_TTL_MS = 30_000;
const FLUSH_INTERVAL_MS = 60_000; // "at most once a minute" per the federation design
const AGENT_RECENT_MS = 5 * 60_000;     // no live socket but seen within this → 'away' (amber)
const AGENT_SEEN_CACHE_TTL_MS = 15_000; // cache an agent's lastSeen briefly (avoid per-refresh DB hits)

/** Canonical string that a node signs (and a receiver verifies) for a presence push. */
export function presenceSignString(fromNodeId: string, timestamp: string, updates: PresenceUpdate[]): string {
  return `${fromNodeId}|${timestamp}|${JSON.stringify(updates)}`;
}

export interface PresenceUpdate {
  ghii: string;
  status: VisibleStatus;
  since: string | null;
}

interface RemoteEntry {
  status: VisibleStatus;
  since: string | null;
  node: string;
  receivedAt: number;
}

/** Coerce an arbitrary stored value into a valid PresenceConfig (per-field fallback). */
export function normalizeConfig(value: unknown): PresenceConfig {
  const v = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  return {
    mode: MODES.has(v.mode as PresenceMode) ? v.mode as PresenceMode : DEFAULT_PRESENCE_CONFIG.mode,
    status: MANUAL_STATUSES.has(v.status as ManualStatus) ? v.status as ManualStatus : DEFAULT_PRESENCE_CONFIG.status,
    visibility: VISIBILITIES.has(v.visibility as Visibility) ? v.visibility as Visibility : DEFAULT_PRESENCE_CONFIG.visibility,
  };
}

export class PresenceTracker {
  private config: AimeatConfig | null = null;
  private storage: Storage | null = null;
  private peers: Map<string, PeerInfo> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // ── Local state ──
  private onlineCount = new Map<string, number>();   // ghii → # of open SSE streams
  private localRaw = new Map<string, RawStatus>();   // ghii → last computed raw status
  private localSince = new Map<string, string>();    // ghii → ISO time current raw status was entered
  private lastBroadcast = new Map<string, VisibleStatus>(); // ghii → last status pushed to peers
  private dirty = new Set<string>();                 // local ghiis with a pending delta
  private configCache = new Map<string, { cfg: PresenceConfig; exp: number }>();
  private agentSeenCache = new Map<string, { lastSeen: string | null; exp: number }>(); // agent GAII → lastSeen

  // ── Remote (federated) cache ──
  private remote = new Map<string, RemoteEntry>();   // full ghii (owner@remoteNode) → entry
  private snapshottedPeers = new Set<string>();      // peer nodeIds we've sent a full snapshot to

  /** Wire runtime deps and start the throttled flush loop. Idempotent. */
  init(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    this.config = config;
    this.storage = storage;
    this.peers = peers;
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        this.flush().catch(err => logger.warn('Presence flush failed', { error: (err as Error).message }));
      }, FLUSH_INTERVAL_MS);
    }
  }

  stop(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
  }

  // ── Online tracking (called by the SSE transport) ──

  markOnline(ghii: string): void {
    if (!this.isLocalGhii(ghii)) return;
    this.onlineCount.set(ghii, (this.onlineCount.get(ghii) ?? 0) + 1);
    void this.recompute(ghii);
  }

  markOffline(ghii: string): void {
    if (!this.isLocalGhii(ghii)) return;
    const next = (this.onlineCount.get(ghii) ?? 0) - 1;
    if (next <= 0) this.onlineCount.delete(ghii);
    else this.onlineCount.set(ghii, next);
    void this.recompute(ghii);
  }

  private isOnline(ghii: string): boolean {
    return (this.onlineCount.get(ghii) ?? 0) > 0;
  }

  /** Only bare GHIIs (owner@node) hosted on THIS node are tracked for online state. */
  private isLocalGhii(ghii: string): boolean {
    if (ghii.includes('#')) return false; // GAII/chat-instance, not a human owner
    const { node } = parseGaiiLoose(ghii);
    return !!this.config && node === this.config.nodeId;
  }

  // ── Config ──

  async getConfig(ghii: string): Promise<PresenceConfig> {
    const cached = this.configCache.get(ghii);
    if (cached && cached.exp > Date.now()) return cached.cfg;
    let cfg = DEFAULT_PRESENCE_CONFIG;
    if (this.storage) {
      try {
        const rec = await this.storage.getMemory(ghii, PRESENCE_CONFIG_KEY);
        if (rec) cfg = normalizeConfig(rec.value);
      } catch { /* defaults stand */ }
    }
    this.configCache.set(ghii, { cfg, exp: Date.now() + CONFIG_CACHE_TTL_MS });
    return cfg;
  }

  /** Merge a partial config, persist it to the owner's memory, and recompute broadcast state. */
  async setConfig(ghii: string, partial: Partial<PresenceConfig>): Promise<PresenceConfig> {
    const current = await this.getConfig(ghii);
    const next = normalizeConfig({ ...current, ...partial });
    if (this.storage) {
      const now = new Date().toISOString();
      const existing = await this.storage.getMemory(ghii, PRESENCE_CONFIG_KEY).catch(() => null);
      await this.storage.setMemory({
        key: PRESENCE_CONFIG_KEY,
        ownerGaii: ghii,
        value: next,
        visibility: 'private',
        tags: ['presence', 'settings'],
        ttlHours: null,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
    this.configCache.set(ghii, { cfg: next, exp: Date.now() + CONFIG_CACHE_TTL_MS });
    await this.recompute(ghii);
    return next;
  }

  // ── Status computation ──

  private rawStatus(cfg: PresenceConfig, online: boolean): RawStatus {
    if (cfg.status === 'invisible') return 'offline';        // appear offline to everyone
    if (cfg.mode === 'manual') return cfg.status;            // available | busy | away
    return online ? 'available' : 'offline';                // auto
  }

  /** Recompute a local owner's status; mark dirty if the broadcastable value changed. */
  private async recompute(ghii: string): Promise<void> {
    if (!this.isLocalGhii(ghii)) return;
    const cfg = await this.getConfig(ghii);
    const raw = this.rawStatus(cfg, this.isOnline(ghii));
    if (raw !== this.localRaw.get(ghii)) {
      this.localRaw.set(ghii, raw);
      this.localSince.set(ghii, new Date().toISOString());
    }
    // Only `everyone` is federated; anything else broadcasts as `unknown` (tombstone).
    const broadcast: VisibleStatus = cfg.visibility === 'everyone' ? raw : 'unknown';
    if (broadcast !== this.lastBroadcast.get(ghii)) {
      this.lastBroadcast.set(ghii, broadcast);
      this.dirty.add(ghii);
      emitChange('presence');
    }
  }

  /** The owner's own status (visibility never hides it from themselves). */
  async getOwnStatus(ghii: string): Promise<PresenceView> {
    const cfg = await this.getConfig(ghii);
    const raw = this.rawStatus(cfg, this.isOnline(ghii));
    return { ghii, status: raw, since: this.localSince.get(ghii) ?? null };
  }

  /** Viewer-scoped status of a single target. */
  async getVisible(viewerGhii: string, targetGhii: string): Promise<PresenceView> {
    if (viewerGhii === targetGhii) return this.getOwnStatus(targetGhii);

    // An agent/app principal (GAII/GEAI, has '#') reports its OWN liveness, not its owner's: a connected
    // tunnel socket → available; recently seen → away; else offline. Only LOCAL principals are knowable.
    if (targetGhii.includes('#')) return this.getAgentStatus(targetGhii);

    if (this.isLocalGhii(targetGhii)) {
      const cfg = await this.getConfig(targetGhii);
      const raw = this.rawStatus(cfg, this.isOnline(targetGhii));
      const since = this.localSince.get(targetGhii) ?? null;
      if (cfg.visibility === 'everyone') return { ghii: targetGhii, status: raw, since };
      if (cfg.visibility === 'nobody') return { ghii: targetGhii, status: 'unknown', since: null };
      // contacts — visible only to owners the target has a conversation with
      const ok = await this.isContact(targetGhii, viewerGhii);
      return { ghii: targetGhii, status: ok ? raw : 'unknown', since: ok ? since : null };
    }

    // Remote target — read straight from the federated cache.
    const r = this.remote.get(targetGhii);
    if (!r || !this.isPeerActive(r.node)) return { ghii: targetGhii, status: 'unknown', since: null };
    return { ghii: targetGhii, status: r.status, since: r.since };
  }

  async getVisibleMany(viewerGhii: string, targets: string[]): Promise<PresenceView[]> {
    return Promise.all(targets.map(t => this.getVisible(viewerGhii, t)));
  }

  /** Liveness of an agent/app principal (GAII/GEAI). LOCAL only — a remote node owns its principals'
   *  state, so a remote GAII is `unknown` (presence reads are always local). */
  private async getAgentStatus(gaii: string): Promise<PresenceView> {
    const { node } = parseGaiiLoose(gaii);
    if (!this.config || node !== this.config.nodeId) return { ghii: gaii, status: 'unknown', since: null };

    // A live tunnel socket is the strongest "running right now" signal (in-memory, no DB).
    if (getActiveConnectTunnelManager()?.isConnected(gaii)) return { ghii: gaii, status: 'available', since: null };

    // No socket: recently-seen (last heartbeat/activity) → away; otherwise offline.
    const lastSeen = await this.getAgentLastSeen(gaii);
    if (lastSeen && Date.now() - new Date(lastSeen).getTime() < AGENT_RECENT_MS) {
      return { ghii: gaii, status: 'away', since: lastSeen };
    }
    return { ghii: gaii, status: 'offline', since: lastSeen };
  }

  private async getAgentLastSeen(gaii: string): Promise<string | null> {
    const cached = this.agentSeenCache.get(gaii);
    if (cached && cached.exp > Date.now()) return cached.lastSeen;
    let lastSeen: string | null = null;
    if (this.storage) {
      try { lastSeen = (await this.storage.getAgent(gaii))?.lastSeen ?? null; } catch { /* none */ }
    }
    this.agentSeenCache.set(gaii, { lastSeen, exp: Date.now() + AGENT_SEEN_CACHE_TTL_MS });
    return lastSeen;
  }

  private async isContact(targetGhii: string, viewerGhii: string): Promise<boolean> {
    if (!this.storage) return false;
    try {
      const convs = await this.storage.listConversations(targetGhii);
      return convs.some(c => c.peerGhii === viewerGhii);
    } catch {
      return false;
    }
  }

  private isPeerActive(nodeId: string): boolean {
    const peer = this.peers?.get(nodeId) ?? [...(this.peers?.values() ?? [])].find(p => p.nodeId === nodeId);
    return !!peer && peer.status === 'active';
  }

  // ── Federation: receive ──

  /** Apply a batch of presence updates pushed by a peer node. */
  applyRemoteUpdates(fromNode: string, updates: PresenceUpdate[]): void {
    if (!Array.isArray(updates)) return;
    let changed = false;
    for (const u of updates) {
      if (!u || typeof u.ghii !== 'string') continue;
      // Never accept a remote claim about a local owner.
      if (this.isLocalGhii(u.ghii)) continue;
      if (u.status === 'unknown') {
        if (this.remote.delete(u.ghii)) changed = true;
      } else {
        this.remote.set(u.ghii, { status: u.status, since: u.since ?? null, node: fromNode, receivedAt: Date.now() });
        changed = true;
      }
    }
    if (changed) emitChange('presence');
  }

  // ── Federation: push ──

  /** Full snapshot of currently-broadcastable local owners (sent once per peer). */
  getSnapshot(): PresenceUpdate[] {
    const out: PresenceUpdate[] = [];
    for (const [ghii, status] of this.lastBroadcast) {
      if (status === 'unknown') continue;
      out.push({ ghii, status, since: this.localSince.get(ghii) ?? null });
    }
    return out;
  }

  private buildDelta(): PresenceUpdate[] {
    const out: PresenceUpdate[] = [];
    for (const ghii of this.dirty) {
      out.push({ ghii, status: this.lastBroadcast.get(ghii) ?? 'unknown', since: this.localSince.get(ghii) ?? null });
    }
    return out;
  }

  /** Throttled push loop: snapshot new peers, push deltas to all active peers, evict stale remotes. */
  async flush(): Promise<void> {
    if (!this.config || !this.storage || !this.peers) return;

    const activePeers = [...this.peers.values()].filter(
      p => p.status === 'active' && p.peerMode !== 'private',
    );
    const activeIds = new Set(activePeers.map(p => p.nodeId));

    // Forget peers that went away so a re-peer triggers a fresh snapshot.
    for (const id of [...this.snapshottedPeers]) {
      if (!activeIds.has(id)) this.snapshottedPeers.delete(id);
    }

    // Evict cached remotes whose source peer is no longer active.
    for (const [ghii, entry] of [...this.remote]) {
      if (!activeIds.has(entry.node)) this.remote.delete(ghii);
    }

    if (activePeers.length === 0) { this.dirty.clear(); return; }

    const nodeKey = await this.storage.getNodeKey();
    const delta = this.buildDelta();
    this.dirty.clear();

    for (const peer of activePeers) {
      const isNew = !this.snapshottedPeers.has(peer.nodeId);
      const updates = isNew ? this.getSnapshot() : delta;
      if (updates.length === 0) { if (isNew) this.snapshottedPeers.add(peer.nodeId); continue; }
      const sent = await this.pushToPeer(peer, updates, nodeKey?.privateKey);
      if (sent && isNew) this.snapshottedPeers.add(peer.nodeId);
    }
  }

  private async pushToPeer(peer: PeerInfo, updates: PresenceUpdate[], privateKey?: string): Promise<boolean> {
    if (!this.config) return false;
    try {
      const check = await validateOutboundUrl(peer.url);
      if (!check.valid) return false;
      const timestamp = new Date().toISOString();
      const signature = privateKey ? await sign(privateKey, presenceSignString(this.config.nodeId, timestamp, updates)) : undefined;
      const resp = await fetch(`${peer.url}/v1/federation/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_node_id: this.config.nodeId, timestamp, updates, signature }),
        signal: AbortSignal.timeout(this.config.federationTimeoutMs ?? 5_000),
      });
      return resp.ok;
    } catch {
      return false; // peer health is tracked by the federation heartbeat, not here
    }
  }
}

/** Module singleton — imported by the SSE transport, presence routes, and federation. */
export const presence = new PresenceTracker();
