/**
 * @file src/services/prompts/handbook-fill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The values a handbook prompt's {{variables}} are filled with for one caller: the node,
 *   the caller's identity and agent name, and its agent record's trust score (50 when it has no
 *   record). GET /v1/agents/me/handbook and aimeat_handbook_get (the prompt tiers) both fill from
 *   here, so an agent reads the same text through either surface (structure programme 2026-11,
 *   unit 2b). The route adds what only it shows (the owner's name, the balance).
 * @structure handbookFill(deps, gaii) → { agent, vars }
 * @usage
 *   const { agent, vars } = await handbookFill({ storage, config }, gaii);
 *   const text = substituteVariables(content, { ...vars, owner_name });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { parseGaiiLoose } from '../../utils/gaii.js';

/** The caller's agent record (null for an owner session or an unknown identity) and the shared values. */
export async function handbookFill(
    deps: { storage: Storage; config: Pick<AimeatConfig, 'baseUrl' | 'nodeId' | 'dailyAllowance'> },
    gaii: string,
): Promise<{ agent: AgentRecord | null; vars: Record<string, string | number> }> {
    const agent = gaii && gaii !== 'unknown' ? await deps.storage.getAgent(gaii) : null;
    return {
        agent,
        vars: {
            node_url: deps.config.baseUrl,
            node_id: deps.config.nodeId,
            gaii,
            agent_name: parseGaiiLoose(gaii).agent || 'unknown',
            trust_score: agent?.trustScore ?? 50,
            daily_allowance: deps.config.dailyAllowance,
        },
    };
}
