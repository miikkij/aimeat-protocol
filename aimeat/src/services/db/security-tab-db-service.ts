/**
 * @file src/services/db/security-tab-db-service.ts
 * @description Purpose-built Application DB Service for the profile **Security** tab — the ONE call behind
 *   GET /v1/security/overview. The tab mounted listAgents + listSessions + a per-agent CORS fan-out: it
 *   read GET /v1/agents/:name/cors once PER agent (3 + N requests). But per-agent CORS is just
 *   `agent.allowedOrigins` on the agent record, resolved against the owner's GHII origins and the node
 *   default — so this composes the whole tab from getAgentsByOwner + getGHIIByOwner (ONE GHII read shared
 *   across every agent) + the session list, with NO per-agent read. Single-master: the Security tab mount
 *   only. The individual endpoints stay for interactive re-fetch (save GHII/agent CORS, revoke sessions).
 *
 * @structure SecurityTabService.overview(owner, currentSessionId) → { ghii, agents, sessions }
 * @usage const ov = await createSecurityTabService(storage, config).overview(owner, req.auth.sessionId);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Security tab's CORS-per-agent N+1 into two shared reads.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';

export interface SecurityOverview {
  ghii: { ghii: string; allowed_origins: string[] | null; effective: string[]; inherited: boolean } | null;
  agents: Array<{ gaii: string; allowed_origins: string[] | null; effective: string[]; inherited_from: string }>;
  sessions: Array<Record<string, unknown>>;
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
      const [agents, ghiiRecord, sessions] = await Promise.all([
        this.storage.getAgentsByOwner(owner),
        this.storage.getGHIIByOwner(owner),
        this.storage.listActiveSessions(owner),
      ]);

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
        sessions: sessions.map(s => ({
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
