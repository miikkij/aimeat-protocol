/**
 * @file src/services/db/access-tab-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE read behind the Access page and behind aimeat_access_list: who holds a key to
 *   this person's account and how far each key reaches. Composes, in one read scope: the consents,
 *   the public key, the apps' grants, the tokens, the sharing groups, the agent defaults (the six the
 *   tab always had), and since 2026-09-05 the sign-in state (password, two-step, passkeys, the OPEN
 *   sessions grouped by device and by agent, never the expired ones), the accounts connected at other
 *   services, and the eight-word base package the boot migration wrote onto every grant, so the page
 *   can say it once instead of on every row. Each older section keeps the payload shape its own
 *   endpoint returns; the new ones are shaped here and nowhere else.
 *
 *   NO SECRET LEAVES. Two-step is a state, passkeys are labels and dates, sessions are counts and
 *   devices, tokens are labels and levels. The route gates on the owner role or the account:security
 *   scope, and the MCP tool calls this same function, so an agent an owner has trusted with that word
 *   reads exactly what the page shows.
 *
 * @structure AccessTabService.overview(ownerName, ownerGhii, currentSessionId?) → AccessOverview ·
 *   summarizeSessions(sessions, ownerName, currentSessionId, now) — pure, unit-tested
 * @usage const access = await createAccessTabService(storage, config).overview(owner, `${owner}@${nodeId}`, req.auth.sessionId);
 * @version-history
 *   v2.0.0 — 2026-09-05 — sign_in, connections and base_package (design canvas "AIMEAT Pääsy-sivu",
 *     direction A). Sessions arrive grouped and valid-only: the security overview handed the page
 *     3 290 rows of which 2 848 had expired, 815 kB for a question whose answer is "374 on four
 *     devices". The grants carry can_spend, the cap and scopes_fixed_at like GET /v1/app-grants.
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Access tab's 6-request fan-out into one composite.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { SessionRecord } from '../../storage/repositories/session.repository.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { GRANDFATHERED_SCOPES } from '../scope-vocabulary-migration.js';
import { buildOutboundProviders, listProviderMeta, type OutboundProvider } from '../connections/providers.js';
import { listOwnConnections, toPublicClient } from '../connections/access.js';

// Each older section's payload mirrors its source endpoint's response `.data` exactly.
export interface AccessOverview {
  consent: { consents: Array<Record<string, unknown>>; total: number };
  publicKey: string | null;
  appGrants: { grants: Array<Record<string, unknown>>; total: number };
  accessTokens: { tokens: Array<Record<string, unknown>>; total: number };
  groups: { groups: unknown[] };
  agentDefaults: { defaults: Record<string, unknown> };
  /** The words the boot migration wrote onto every app grant that lacked them (2026-08-10). */
  base_package: string[];
  /** How long an app's already-issued access token outlives a narrowing or a revoke, in seconds. */
  access_ttl_seconds: number;
  sign_in: SignInOverview;
  connections: ConnectionsOverview | null;
}

export interface SignInOverview {
  has_password: boolean;
  managed_by: { connection: string; name: string } | null;
  two_factor: { available: boolean; enabled: boolean; pending: boolean; backup_codes_left: number };
  passkeys: { available: boolean; count: number; passkeys: Array<Record<string, unknown>> };
  sessions: SessionSummary;
}

export interface ConnectionsOverview {
  enabled: boolean;
  connections: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  clients: Array<Record<string, unknown>>;
}

export interface SessionSummary {
  current_id: string | null;
  /** Rows the store still holds past their expiry. They open nothing; the count says what the sweep will clear. */
  expired_kept: number;
  mine: {
    total: number;
    current: { issued_at: string; expires_at: string; device_label: string | null } | null;
    by_device: Array<{ label: string | null; count: number; newest_issued_at: string; last_used_at: string | null }>;
  };
  agents: {
    total: number;
    distinct: number;
    by_agent: Array<{ name: string; gaii: string; count: number; newest_issued_at: string; last_used_at: string | null }>;
  };
}

const later = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
};

/**
 * The open sessions, grouped so the page can say "374 on four devices, 68 by 64 agents" instead of
 * listing them. Expired rows are counted and dropped: the store keeps them until its sweep, but they
 * open nothing, and a list that shows them says the account is more exposed than it is. Every row
 * the store returns for an owner is that owner's: a session whose principal carries `#` is one of
 * their agents, and any other is the person's own sign-in.
 */
export function summarizeSessions(
  sessions: SessionRecord[], ownerName: string, currentSessionId: string | undefined, now: number = Date.now(),
): SessionSummary {
  const live = sessions.filter(s => new Date(s.expiresAt).getTime() > now);
  const expiredKept = sessions.length - live.length;
  const isAgent = (s: SessionRecord) => s.gaii.includes('#');
  const mine = live.filter(s => !isAgent(s));
  const agents = live.filter(isAgent);

  const byDevice = new Map<string, SessionSummary['mine']['by_device'][number]>();
  for (const s of mine) {
    const label = s.deviceLabel ?? null;
    const key = label ?? '';
    const slot = byDevice.get(key) ?? { label, count: 0, newest_issued_at: s.issuedAt, last_used_at: null };
    slot.count++;
    if (s.issuedAt > slot.newest_issued_at) slot.newest_issued_at = s.issuedAt;
    slot.last_used_at = later(slot.last_used_at, s.lastUsedAt ?? s.issuedAt);
    byDevice.set(key, slot);
  }
  const byAgent = new Map<string, SessionSummary['agents']['by_agent'][number]>();
  for (const s of agents) {
    const hash = s.gaii.indexOf('#');
    const name = hash > 0 ? s.gaii.slice(0, hash) : s.gaii;
    const slot = byAgent.get(s.gaii) ?? { name, gaii: s.gaii, count: 0, newest_issued_at: s.issuedAt, last_used_at: null };
    slot.count++;
    if (s.issuedAt > slot.newest_issued_at) slot.newest_issued_at = s.issuedAt;
    slot.last_used_at = later(slot.last_used_at, s.lastUsedAt ?? s.issuedAt);
    byAgent.set(s.gaii, slot);
  }
  const current = currentSessionId ? mine.find(s => s.sessionId === currentSessionId) ?? null : null;
  return {
    current_id: current?.sessionId ?? null,
    expired_kept: expiredKept,
    mine: {
      total: mine.length,
      current: current ? { issued_at: current.issuedAt, expires_at: current.expiresAt, device_label: current.deviceLabel ?? null } : null,
      by_device: [...byDevice.values()].sort((a, b) => b.count - a.count),
    },
    agents: {
      total: agents.length,
      distinct: byAgent.size,
      by_agent: [...byAgent.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)),
    },
  };
}

export class AccessTabService {
  private readonly providers: OutboundProvider[];

  constructor(private readonly storage: Storage, private readonly config: AimeatConfig) {
    this.providers = buildOutboundProviders(config);
  }

  /**
   * The whole Access page for one owner in a single read scope. Composed only for the owner, or for
   * a principal carrying account:security — the route decides that; this only shapes.
   */
  overview(ownerName: string, ownerGhii: string, currentSessionId?: string): Promise<AccessOverview> {
    return runInReadScope(async () => {
      const [consents, owner, grantsRaw, pats, ownedGroups, memberGroups, defaults, ghiiRecord, passkeys, sessions] = await Promise.all([
        this.storage.listConsents(ownerGhii),
        this.storage.getOwner(ownerName),
        this.storage.listAppGrantsByOwner(ownerName),
        this.storage.listPats(ownerName),
        this.storage.listSharingGroups(ownerGhii),
        this.storage.listSharingGroupsByMember(ownerGhii),
        this.storage.getOwnerAgentDefaults(ownerGhii),
        this.storage.getGHIIByOwner(ownerName),
        this.storage.listPasskeysByOwner(ownerName),
        this.storage.listActiveSessions(ownerName),
      ]);

      // ── consent (mirrors GET /v1/consent) ──
      const consent = {
        consents: consents.map(c => ({
          id: c.id, data_pattern: c.dataPattern, recipient: c.recipient, purpose: c.purpose,
          scope: c.scope, expires: c.expires, status: c.status, granted_at: c.grantedAt,
          revoked_at: c.revokedAt, metadata: c.metadata,
        })),
        total: consents.length,
      };

      // ── app-grants (mirrors GET /v1/app-grants: non-revoked only) ──
      const grants = grantsRaw.filter(g => !g.revoked);
      const appGrants = {
        grants: grants.map(g => ({
          grant_id: g.grantId, app: g.app, app_name: g.appName, app_origin: g.appOrigin,
          scopes: g.scopes, granted_at: g.createdAt, last_used_at: g.lastUsedAt,
          can_spend: (g.scopes ?? []).includes('contract:spend'),
          spend_cap_morsels: g.spendCapMorsels ?? null,
          spent_morsels: g.spentMorsels ?? 0,
          scopes_fixed_at: g.scopesFixedAt ?? null,
        })),
        total: grants.length,
      };

      // ── access tokens (mirrors GET /v1/access/tokens) ──
      const accessTokens = {
        tokens: pats.map(p => ({
          id: p.id, label: p.label, gaii: p.gaii, scopes: p.scopes, grant_owner: p.grantOwner,
          grant_operator: p.grantOperator, read_owner_data: p.readOwnerData, created_at: p.createdAt,
          last_used_at: p.lastUsedAt, expires_at: p.expiresAt,
        })),
        total: pats.length,
      };

      // ── sharing groups (mirrors GET /v1/groups owner branch: owned + member-of, deduped by id) ──
      const seen = new Set<string>();
      const groupList = [...ownedGroups, ...memberGroups].filter(g => {
        const id = (g as { id?: string }).id ?? '';
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      // ── agent defaults (mirrors GET /v1/owner/agent-defaults; empty shape when unset) ──
      const agentDefaults = {
        defaults: defaults
          ? {
            owner_gaii: defaults.ownerGaii, rules: defaults.rules,
            default_token_budget: defaults.defaultTokenBudget,
            default_memory_areas: (defaults.defaultMemoryAreas ?? []).map(ma => ({
              key_prefix: ma.keyPrefix, description: ma.description, schema: ma.schema, csm_id: ma.csmId,
            })),
            updated_at: defaults.updatedAt,
          }
          : { owner_gaii: ownerGhii, rules: [], default_token_budget: undefined, default_memory_areas: [] },
      };

      // ── sign-in: the person's own ways in, as states and counts ──
      let managedBy: SignInOverview['managed_by'] = null;
      if (owner?.managedBy) {
        const conn = await this.storage.getSsoConnection(owner.managedBy);
        managedBy = { connection: owner.managedBy, name: conn?.name ?? owner.managedBy };
      }
      const signIn: SignInOverview = {
        has_password: !!ghiiRecord?.passwordHash,
        managed_by: managedBy,
        two_factor: {
          available: this.config.totpEnabled,
          enabled: ghiiRecord?.totpEnabled === true,
          pending: !!ghiiRecord?.totpSecret && ghiiRecord.totpEnabled !== true,
          backup_codes_left: ghiiRecord?.totpEnabled === true ? (ghiiRecord.totpBackupCodes?.length ?? 0) : 0,
        },
        passkeys: {
          available: this.config.passkeyEnabled,
          count: passkeys.length,
          passkeys: passkeys.map(p => ({
            id: p.id, label: p.label, transports: p.transports, backed_up: p.backedUp,
            created_at: p.createdAt, last_used_at: p.lastUsedAt,
          })),
        },
        sessions: summarizeSessions(sessions, ownerName, currentSessionId),
      };

      // ── accounts elsewhere: the owner's own connections, the services on offer, the own apps ──
      let connections: ConnectionsOverview;
      if (this.config.connectionsEnabled) {
        const [list, clientRows] = await Promise.all([
          listOwnConnections(this.storage, ownerGhii),
          this.storage.listPrincipalProviderClients(ownerGhii),
        ]);
        const clients = await Promise.all(clientRows.map(async r =>
          toPublicClient(r, await this.storage.countConnectionsByProviderClient(r.id))));
        connections = {
          enabled: true,
          connections: list as unknown as Array<Record<string, unknown>>,
          providers: listProviderMeta(this.providers) as unknown as Array<Record<string, unknown>>,
          clients: clients as unknown as Array<Record<string, unknown>>,
        };
      } else {
        connections = { enabled: false, connections: [], providers: [], clients: [] };
      }

      return {
        consent,
        publicKey: owner?.publicKey ?? null,
        appGrants,
        accessTokens,
        groups: { groups: groupList },
        agentDefaults,
        base_package: [...GRANDFATHERED_SCOPES],
        access_ttl_seconds: this.config.accessTtlSeconds,
        sign_in: signIn,
        connections,
      };
    });
  }
}

/** Assemble the Access page composite over the given storage. */
export function createAccessTabService(storage: Storage, config: AimeatConfig): AccessTabService {
  return new AccessTabService(storage, config);
}
