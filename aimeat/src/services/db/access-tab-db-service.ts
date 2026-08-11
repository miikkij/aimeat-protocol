/**
 * @file src/services/db/access-tab-db-service.ts
 * @description Purpose-built Application DB Service for the profile Access tab — the ONE call behind
 *   GET /v1/access/overview. The tab mounts a 6-request fan-out (parent: consent + ghii-public-key;
 *   four child sections: app-grants + access-tokens + sharing-groups + agent-defaults); this composes
 *   all six in ONE read scope. Each section is returned in the SAME payload shape its individual endpoint
 *   returns, so the tab + its child sections consume it unchanged. Single-master: it serves the Access
 *   tab mount only — the individual endpoints stay for interactive re-fetches (each child's live-update).
 *
 * @structure AccessTabService.overview(ownerName, ownerGhii) → { consent, publicKey, appGrants, accessTokens, groups, agentDefaults }
 * @usage const access = await createAccessTabService(storage).overview(owner, `${owner}@${nodeId}`);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Access tab's 6-request fan-out into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

// Each section's payload mirrors its source endpoint's response `.data` exactly (see the @description).
export interface AccessOverview {
  consent: { consents: Array<Record<string, unknown>>; total: number };
  publicKey: string | null;
  appGrants: { grants: Array<Record<string, unknown>>; total: number };
  accessTokens: { tokens: Array<Record<string, unknown>>; total: number };
  groups: { groups: unknown[] };
  agentDefaults: { defaults: Record<string, unknown> };
}

export class AccessTabService {
  constructor(private readonly storage: Storage) {}

  /**
   * The whole Access tab mount for one owner in a single read scope. The six sections load concurrently.
   * Composed only for an owner (the route gates requireRole('owner') — stricter than the individual
   * endpoints, so no section's data is exposed more widely than before).
   */
  overview(ownerName: string, ownerGhii: string): Promise<AccessOverview> {
    return runInReadScope(async () => {
      const [consents, owner, grantsRaw, pats, ownedGroups, memberGroups, defaults] = await Promise.all([
        this.storage.listConsents(ownerGhii),
        this.storage.getOwner(ownerName),
        this.storage.listAppGrantsByOwner(ownerName),
        this.storage.listPats(ownerName),
        this.storage.listSharingGroups(ownerGhii),
        this.storage.listSharingGroupsByMember(ownerGhii),
        this.storage.getOwnerAgentDefaults(ownerGhii),
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

      return {
        consent,
        publicKey: owner?.publicKey ?? null,
        appGrants,
        accessTokens,
        groups: { groups: groupList },
        agentDefaults,
      };
    });
  }
}

/** Assemble the Access tab composite over the given storage. */
export function createAccessTabService(storage: Storage): AccessTabService {
  return new AccessTabService(storage);
}
