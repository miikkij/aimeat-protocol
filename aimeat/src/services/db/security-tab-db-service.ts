/**
 * @file src/services/db/security-tab-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the profile **Security** tab — the ONE call behind
 *   GET /v1/security/overview. The tab mounted listAgents + listSessions + a per-agent CORS fan-out: it
 *   read GET /v1/agents/:name/cors once PER agent (3 + N requests). But per-agent CORS is just
 *   `agent.allowedOrigins` on the agent record, resolved against the owner's GHII origins and the node
 *   default — so this composes the whole tab from getAgentsByOwner + getGHIIByOwner (ONE GHII read shared
 *   across every agent) + the session list, with NO per-agent read. Single-master: the Security tab mount
 *   only. The individual endpoints stay for interactive re-fetch (save GHII/agent CORS, revoke sessions).
 *
 * @structure SecurityTabService.overview(owner, currentSessionId) → { ghii, agents, sessions, two_factor }
 * @usage const ov = await createSecurityTabService(storage, config).overview(owner, req.auth.sessionId);
 * @version-history
 *   v1.3.1 — 2026-09-05 — Sessions past their expiry are left out as well (merge of the access-page
 *     branch): a row past its expiry opens nothing, and on aimeat.io 2 848 of the 3 290 rows served
 *     here were of that kind. The Access page took over the sign-in state; two_factor stays here
 *     for the Security tab's own read.
 *   v1.3.0 — 2026-09-05 — The session list is the person's own devices, as GET /v1/auth/sessions
 *     has always been: this fold was written from the individual reads and dropped their
 *     `!isExternalPrincipal` filter, so the Security tab listed every agent session too.
 *   v1.2.0 — 2026-09-04 — two_factor in the overview. The TOTP routes shipped with no way to ask
 *     whether the factor is on, so the Security tab could not render a state and nobody could arm
 *     one. `pending` separates a half-finished setup (secret stored, never verified) from an armed
 *     factor, which is the difference between "finish this" and "you are protected".
 *   v1.1.0 — 2026-08-24 — managed_by (BR-04): the Security tab tells an organisation-managed
 *     account that its lifecycle lives in the organisation's directory, by the connection's name.
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Security tab's CORS-per-agent N+1 into two shared reads.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { isExternalPrincipal } from '../../utils/gaii.js';

export interface SecurityOverview {
  ghii: { ghii: string; allowed_origins: string[] | null; effective: string[]; inherited: boolean } | null;
  agents: Array<{ gaii: string; allowed_origins: string[] | null; effective: string[]; inherited_from: string }>;
  sessions: Array<Record<string, unknown>>;
  /** Set when an organisation's identity provider manages this account's lifecycle (BR-04). */
  managed_by: { connection: string; name: string } | null;
  /**
   * Two-step sign-in as it stands for this account. `available` is the node's switch, so a node
   * that turned TOTP off renders nothing rather than a control that 503s. `pending` means a secret
   * was generated and never verified: the person started and stopped, and the account is NOT
   * protected. Never carries the secret or the backup codes — those are shown once, by the routes
   * that mint them.
   */
  two_factor: {
    available: boolean;
    enabled: boolean;
    pending: boolean;
    backup_codes_left: number;
  };
}

export class SecurityTabService {
  constructor(private readonly storage: Storage, private readonly config: AimeatConfig) {}

  /**
   * The Security tab mount for one owner in a single read scope. Per-agent CORS is resolved from the
   * already-loaded agent record + the single GHII read + the node default — mirroring GET
   * /v1/agents/:name/cors for every agent without the per-agent round-trip. `current` on each session
   * marks the caller's own session.
   */
  overview(owner: string, currentSessionId: string | undefined): Promise<SecurityOverview> {
    return runInReadScope(async () => {
      const now = Date.now();
      const [agents, ghiiRecord, sessions, ownerRecord] = await Promise.all([
        this.storage.getAgentsByOwner(owner),
        this.storage.getGHIIByOwner(owner),
        this.storage.listActiveSessions(owner),
        this.storage.getOwner(owner),
      ]);

      // BR-04: when an organisation connection manages the account, the person should SEE that —
      // it is why they have no password here and why leaving the organisation ends their access.
      let managedBy: SecurityOverview['managed_by'] = null;
      if (ownerRecord?.managedBy) {
        const conn = await this.storage.getSsoConnection(ownerRecord.managedBy);
        managedBy = { connection: ownerRecord.managedBy, name: conn?.name ?? ownerRecord.managedBy };
      }

      const nodeDefault = this.config.corsAllowedOrigins;
      const ghiiOrigins = ghiiRecord?.allowedOrigins;

      const ghii = ghiiRecord
        ? {
            ghii: ghiiRecord.ghii,
            allowed_origins: ghiiRecord.allowedOrigins ?? null,
            effective: ghiiRecord.allowedOrigins ?? nodeDefault,
            inherited: !ghiiRecord.allowedOrigins,
          }
        : null;

      const agentsCors = agents.map(a => {
        let effective = nodeDefault;
        let inherited_from = 'node';
        if (a.allowedOrigins?.length) { effective = a.allowedOrigins; inherited_from = 'none'; }
        else if (ghiiOrigins?.length) { effective = ghiiOrigins; inherited_from = 'ghii'; }
        return { gaii: a.gaii, allowed_origins: a.allowedOrigins ?? null, effective, inherited_from };
      });

      return {
        ghii,
        agents: agentsCors,
        managed_by: managedBy,
        two_factor: {
          available: this.config.totpEnabled,
          enabled: ghiiRecord?.totpEnabled === true,
          pending: !!ghiiRecord?.totpSecret && ghiiRecord.totpEnabled !== true,
          backup_codes_left: ghiiRecord?.totpEnabled === true ? (ghiiRecord.totpBackupCodes?.length ?? 0) : 0,
        },
        // THE PERSON'S OWN DEVICES, and nothing else. An agent's session row carries the same
        // `owner` but a GAII with a '#' in it, and GET /v1/auth/sessions has always filtered those
        // out: this list is a device list, and an agent is ended from the Agents surface where
        // there is something to say about it. This fold was written from the individual reads and
        // dropped the rule, so the Security tab showed thirty agent rows the dedicated route hides
        // — measured on aimeat.io 2026-09-05, and reproduced in a sandbox as 1 row against 2.
        // And open sessions only: the store keeps a row until its sweep; a row past its expiry
        // opens nothing, and on aimeat.io 2 848 of the 3 290 rows served here were of that kind.
        sessions: sessions.filter(s => !isExternalPrincipal(s.gaii) && new Date(s.expiresAt).getTime() > now).map(s => ({
          session_id: s.sessionId, gaii: s.gaii, issued_at: s.issuedAt, expires_at: s.expiresAt,
          last_used_at: s.lastUsedAt ?? null, device_label: s.deviceLabel ?? null,
          current: s.sessionId === currentSessionId,
        })),
      };
    });
  }
}

/** Assemble the Security tab composite over the given storage. */
export function createSecurityTabService(storage: Storage, config: AimeatConfig): SecurityTabService {
  return new SecurityTabService(storage, config);
}
