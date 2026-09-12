/**
 * @file src/services/federation-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read behind the operator's Federation page: where this node stands, what is
 *   waiting for the operator, who may sign in here, what this node offers the federation, and how
 *   old the federation book is.
 *
 *   THE COUNT THAT WAS MISSING. Adding a peer does not connect anything, and there are two roads
 *   into that state with different words for it: the direct door writes `pending`, approving a
 *   peering request writes `approved`, and Activate accepts either. The page counted active,
 *   degraded, offline and pending REQUESTS — not peers — so both roads ended the same way: the
 *   number the operator was watching went to zero, nothing else moved, and the screen read as
 *   finished while the peer sat there doing nothing. `peers.awaiting` is both roads in one count,
 *   and `needs` is the list of things waiting on a person.
 *
 *   WHO MAY SIGN IN IS TWO DECISIONS, NOT ONE. `federationAuthPolicy` is the node's answer and
 *   `allowFederatedAuth` is the per-peer answer, and both have to say yes (routes/ghii/
 *   register-login.ts:381-390). On `specific_peers` with no peer carrying the flag, the setting
 *   reads as configured and admits nobody — the same shape the organisation sign-in page had
 *   before it started counting its own steps. `signin.reaches` is that count.
 *
 *   BEHIND WHAT. The page compared every version against the highest among LIVE PEERS and drew the
 *   badge in the federation book too — which carries this node's own card and the nodes it does not
 *   peer with directly. So this node was never the yardstick: an operator running the newest build
 *   saw no peer marked behind. The baseline here is the whole federation, this node included, and
 *   a row says how far behind it is rather than only that it is.
 *
 *   WHAT THIS NODE GIVES is `federate === true` on an action, agent, board or service, counted by
 *   utils/service-summary.ts. Zero means this node reads the federation and puts nothing back,
 *   which is a decision rather than a fault — but it was written `0a · 0g · 0b · 0c` in a column
 *   called Resources, so nobody could tell it from a broken counter. The totals ride along, so the
 *   page can say nought of fifty-seven rather than nought.
 * @structure
 *   - FederationOverview and its parts
 *   - compareVersions(a, b) / versionsBehind(a, b) — the semver-ish comparison, exported for tests
 *   - buildFederationOverview(config, storage, peers)
 * @usage
 *   import { buildFederationOverview } from '../services/federation-overview.js';
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Federation page's rebuild.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { getActiveBook, buildNodeCard } from './federation-book.js';
import type { NodeCard } from './federation-book.js';
import { computeServiceSummary } from '../utils/service-summary.js';
import { logger } from '../utils/logger.js';

export type FederationStanding = 'alone' | 'waiting' | 'degraded' | 'linked';

/** One thing waiting on a person, with the nodes it is about. */
export interface FederationNeed {
  kind: 'request' | 'activate' | 'key' | 'leaving';
  count: number;
  nodes: string[];
}

export interface FederationPeerCounts {
  total: number;
  active: number;
  degraded: number;
  offline: number;
  depeering: number;
  /** Added through the direct door, which writes `pending` and does not switch anything on. */
  pending: number;
  /** Created by approving a peering request, which also does not switch anything on. */
  approved: number;
  /**
   * ADDED AND NOT SWITCHED ON: pending plus approved.
   *
   * Two doors produce this state and they use different words for it — the direct add writes
   * `pending`, approving a request writes `approved` — and Activate accepts either. The page
   * counted neither, so both roads into a peer ended with a screen that looked finished.
   */
  awaiting: number;
  /** No verification key, so nothing it sends could be checked and it cannot be switched on. */
  keyless: number;
}

export interface FederationSignin {
  policy: 'disabled' | 'all_peers' | 'specific_peers';
  scopes: string[];
  open_join: boolean;
  /** Peers whose own switch is on. Only meaningful under `specific_peers`. */
  named: number;
  /** How many peers a person could actually arrive from, under the policy as it stands. */
  reaches: number;
  /** The policy is set to something other than off and still admits nobody. */
  reaches_nobody: boolean;
}

export interface FederationOffer {
  actions: number; actions_total: number;
  agents: number; agents_total: number;
  boards: number; boards_total: number;
  csms: number; csms_total: number;
  /** Nothing at all is offered: this node reads the federation and puts nothing back. */
  gives_nothing: boolean;
}

export interface FederationBookRow {
  node_id: string;
  operators: Array<{ ghii: string; display_name: string }>;
  software_version: string | null;
  versions_behind: number | null;
  offers: { actions: number; agents: number; boards: number; csms: number; nothing: boolean };
  auth_policy: string | null;
  open_join: boolean;
  cross_federation: boolean;
  is_this_node: boolean;
  keeps_book: boolean;
  listed: boolean;
}

export interface FederationBookState {
  present: boolean;
  edition: number | null;
  issued_by: string | null;
  issued_at: string | null;
  age_days: number | null;
  is_primary: boolean;
  nodes: FederationBookRow[];
}

/**
 * One peer, as the page and the tool read it.
 *
 * `state` is what an operator would DO about this row rather than what the schema calls it:
 * `no_key` and `awaiting` are both stuck, and `awaiting` is the two doors' two words for one
 * thing. The raw `status` rides along, because the page's own actions still branch on it.
 */
export interface FederationRosterRow {
  node_id: string;
  url: string;
  status: string;
  state: 'no_key' | 'awaiting' | 'active' | 'degraded' | 'offline' | 'leaving' | 'unknown';
  tier: string;
  has_key: boolean;
  software_version: string | null;
  versions_behind: number | null;
  last_seen: string;
  added_at: string;
  allow_federated_auth: boolean;
}

export interface FederationOverview {
  standing: FederationStanding;
  needs: FederationNeed[];
  peers: FederationPeerCounts;
  /** Every peer, with the one thing the page could not work out: how far behind, and behind what. */
  roster: FederationRosterRow[];
  signin: FederationSignin;
  offer: FederationOffer;
  book: FederationBookState;
  requests: {
    /** Somebody asking THIS node. These are the ones waiting on the operator. */
    pending: Array<Record<string, unknown>>;
    /** This node asking somebody else. Waiting on them, and never an Approve button here. */
    sent: Array<Record<string, unknown>>;
    history: number;
  };
  /** The highest version anywhere in the federation, this node included. The badge's baseline. */
  newest_version: string | null;
  this_node: { node_id: string; software_version: string | null; is_primary: boolean };
}

/**
 * Compare two semver-ish strings. Returns -1, 0 or 1. A missing or non-numeric part sorts lowest,
 * which is what "unknown" should do.
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 {
  const pa = String(a ?? '').split('.').map(n => parseInt(n, 10));
  const pb = String(b ?? '').split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : -1;
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * How far `v` is behind `newest`, in released versions of the part that differs first.
 *
 * "Behind" on its own is a badge nobody can act on. One minor version behind is a peer that will
 * catch up; nine is a peer that predates half the protocol. Null means this cannot be said — one of
 * the two versions is unknown, or `v` is not behind at all.
 */
export function versionsBehind(v: string | null | undefined, newest: string | null | undefined): number | null {
  if (!v || !newest || compareVersions(v, newest) >= 0) return null;
  const pa = String(v).split('.').map(n => parseInt(n, 10));
  const pb = String(newest).split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const y = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (x !== y) return y - x;
  }
  return null;
}

/** One peering request as a surface reads it. `to_node_id` is what says which way it points. */
function asRequestRow(r: {
  id: string; fromNodeId?: string; fromNodeUrl: string; toNodeId?: string;
  targetUrl?: string; message?: string; tier?: string; createdAt: string;
}): Record<string, unknown> {
  return {
    id: r.id,
    from_node_id: r.fromNodeId ?? null,
    from_node_url: r.fromNodeUrl,
    to_node_id: r.toNodeId ?? null,
    target_url: r.targetUrl ?? null,
    message: r.message ?? null,
    tier: r.tier ?? 'member',
    created_at: r.createdAt,
  };
}

/** Whole days between an ISO timestamp and now. Null when the timestamp is missing or unreadable. */
function ageInDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** Everything the Federation page shows, in one read. */
export async function buildFederationOverview(
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): Promise<FederationOverview> {
  const all = [...peers.values()];

  // ── The counts ──
  const awaiting = all.filter(p => p.status === 'pending' || p.status === 'approved');
  const counts: FederationPeerCounts = {
    total: all.length,
    active: all.filter(p => p.status === 'active').length,
    degraded: all.filter(p => p.status === 'degraded').length,
    offline: all.filter(p => p.status === 'offline').length,
    depeering: all.filter(p => p.status === 'depeering').length,
    pending: all.filter(p => p.status === 'pending').length,
    approved: all.filter(p => p.status === 'approved').length,
    awaiting: awaiting.length,
    keyless: all.filter(p => !p.publicKey).length,
  };

  const requests = await storage.listPeeringRequests().catch(err => {
    logger.warn('buildFederationOverview: peering requests unreadable', { error: String(err) });
    return [];
  });
  /**
   * A PEERING REQUEST HAS A DIRECTION, and one table holds both.
   *
   * `POST /v1/federation/peer/request` records `fromNodeId: config.nodeId` — this node asking
   * somebody else. `POST /v1/federation/peer/introduce` records the caller's id — somebody asking
   * this node. The page read every pending row as an arrival, so a request WE had sent appeared
   * under "asking to join" with Approve and Refuse beside it, naming this node as the asker. The
   * two are different facts and only one of them is waiting on the operator.
   */
  const allPending = requests.filter(r => r.status === 'pending');
  const pending = allPending.filter(r => r.fromNodeId !== config.nodeId);
  const sent = allPending.filter(r => r.fromNodeId === config.nodeId);

  // ── What is waiting on a person ──
  // The order is the order to act in: a stranger asking, then a peer you approved and never
  // switched on, then one that cannot be switched on at all, then one on its way out.
  const needs: FederationNeed[] = [];
  if (pending.length) {
    needs.push({ kind: 'request', count: pending.length, nodes: pending.map(r => r.fromNodeId || r.fromNodeUrl) });
  }
  if (awaiting.length) {
    needs.push({ kind: 'activate', count: awaiting.length, nodes: awaiting.map(p => p.nodeId) });
  }
  const keyless = all.filter(p => !p.publicKey);
  if (keyless.length) {
    needs.push({ kind: 'key', count: keyless.length, nodes: keyless.map(p => p.nodeId) });
  }
  const leaving = all.filter(p => p.status === 'depeering');
  if (leaving.length) {
    needs.push({ kind: 'leaving', count: leaving.length, nodes: leaving.map(p => p.nodeId) });
  }

  // ── Who may sign in here ──
  const policy = config.federationAuthPolicy;
  const activeForAuth = all.filter(p => p.status === 'active');
  const named = activeForAuth.filter(p => p.allowFederatedAuth === true).length;
  const reaches = policy === 'disabled' ? 0 : policy === 'all_peers' ? activeForAuth.length : named;
  const signin: FederationSignin = {
    policy,
    scopes: config.federationDefaultScopes ?? [],
    open_join: config.federationOpenJoin === true,
    named,
    reaches,
    reaches_nobody: policy !== 'disabled' && reaches === 0,
  };

  // ── What this node offers, and out of how much ──
  let offer: FederationOffer = {
    actions: 0, actions_total: 0, agents: 0, agents_total: 0,
    boards: 0, boards_total: 0, csms: 0, csms_total: 0, gives_nothing: true,
  };
  try {
    const [summary, allActions, allAgents, allBoards, allCsms] = await Promise.all([
      computeServiceSummary(config, storage),
      storage.listActions(),
      storage.listAgents(),
      storage.listBoards(),
      storage.listCsms(),
    ]);
    offer = {
      actions: summary.actions?.length ?? 0, actions_total: allActions.length,
      agents: summary.agents?.length ?? 0, agents_total: allAgents.length,
      boards: summary.boards?.length ?? 0, boards_total: allBoards.length,
      csms: summary.csms?.length ?? 0, csms_total: allCsms.length,
      gives_nothing: false,
    };
    offer.gives_nothing = offer.actions + offer.agents + offer.boards + offer.csms === 0;
  } catch (err) {
    logger.warn('buildFederationOverview: the offer counts are best-effort', { error: String(err) });
  }

  // ── The federation book ──
  const book = await getActiveBook(storage);
  const isPrimary = !config.genesisUrl;

  // THE BASELINE IS THE WHOLE FEDERATION. Peers, the book, and this node's own version — the page
  // compared against the peers alone and drew the badge in both tables, so a node running the
  // newest build never made anything else look behind.
  let ownVersion: string | null = null;
  try {
    ownVersion = (await buildNodeCard(config, storage)).software_version ?? null;
  } catch (err) {
    logger.warn('buildFederationOverview: own node card unreadable', { error: String(err) });
  }
  const everyVersion: Array<string | null | undefined> = [
    ownVersion,
    ...all.map(p => p.softwareVersion),
    ...((book?.nodes ?? []) as NodeCard[]).map(n => n.software_version),
  ];
  const newest = everyVersion.reduce<string | null>(
    (m, v) => (v && compareVersions(v, m) > 0 ? v : m), null);

  const bookRows: FederationBookRow[] = ((book?.nodes ?? []) as NodeCard[]).map(n => {
    const r = n.resources ?? { actions: 0, agents: 0, boards: 0, csms: 0, highlights: [] };
    const s = (n.settings ?? {}) as { auth_policy?: string; open_join?: boolean; cross_federation?: boolean };
    return {
      node_id: n.node_id,
      operators: (n.operators ?? []).map(o => ({ ghii: o.ghii, display_name: o.display_name })),
      software_version: n.software_version ?? null,
      versions_behind: versionsBehind(n.software_version, newest),
      offers: {
        actions: r.actions, agents: r.agents, boards: r.boards, csms: r.csms,
        nothing: r.actions + r.agents + r.boards + r.csms === 0,
      },
      auth_policy: s.auth_policy ?? null,
      open_join: s.open_join === true,
      cross_federation: s.cross_federation === true,
      // The two rows a reader needs to pick out of a directory of identical rows: which one is me,
      // and which one keeps the book everybody else mirrors.
      is_this_node: n.node_id === config.nodeId,
      keeps_book: !!book && n.node_id === book.issued_by,
      listed: n.listed !== false,
    };
  });

  // ── Where this node stands ──
  // One word, and the worst true thing wins: something needs you beats a peer being down, because
  // one is your move and the other is theirs.
  const standing: FederationStanding =
    counts.total === 0 && allPending.length === 0 ? 'alone'
      : needs.length > 0 ? 'waiting'
        : counts.degraded + counts.offline > 0 ? 'degraded'
          : 'linked';

  const roster: FederationRosterRow[] = all.map(p => ({
    node_id: p.nodeId,
    url: p.url,
    status: p.status,
    state: !p.publicKey ? 'no_key'
      : p.status === 'pending' || p.status === 'approved' ? 'awaiting'
        : p.status === 'active' ? 'active'
          : p.status === 'degraded' ? 'degraded'
            : p.status === 'offline' ? 'offline'
              : p.status === 'depeering' ? 'leaving'
                : 'unknown',
    tier: p.tier ?? 'member',
    has_key: !!p.publicKey,
    software_version: p.softwareVersion ?? null,
    versions_behind: versionsBehind(p.softwareVersion, newest),
    last_seen: p.lastSeen,
    added_at: p.addedAt,
    allow_federated_auth: p.allowFederatedAuth === true,
  }));

  return {
    standing,
    needs,
    peers: counts,
    roster,
    signin,
    offer,
    book: {
      present: !!book,
      edition: book?.book_version ?? null,
      issued_by: book?.issued_by ?? null,
      issued_at: book?.issued_at ?? null,
      age_days: ageInDays(book?.issued_at),
      is_primary: isPrimary,
      nodes: bookRows,
    },
    requests: {
      pending: pending.map(asRequestRow),
      sent: sent.map(asRequestRow),
      history: requests.length - allPending.length,
    },
    newest_version: newest,
    this_node: { node_id: config.nodeId, software_version: ownVersion, is_primary: isPrimary },
  };
}
