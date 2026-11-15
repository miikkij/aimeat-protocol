/**
 * @file src/services/team/waiting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everything that waits for one person across their teams, in one read (team setup T6):
 *   the open records of each team's "Waiting for you" workspace that name the person, or name nobody
 *   and the person leads the team, and the team's pending approvals the person may decide. The one
 *   implementation behind GET /v1/teams/waiting and the MCP tool aimeat_team_waiting, so a person asks
 *   their own AI "what waits for me" and gets the same list the team page shows.
 *
 *   A waiting record is decided by writing its status (approved, rejected, done), which a member's AI
 *   does with the workspace tools as with any record. An organism approval is decided by the person
 *   signed in (POST /v1/organisms/:id/approvals/:aid); this read names it and where to decide it.
 *
 *   The records pass the caller's own read rule and classification reader (loadWorkspaceContent).
 * @structure WaitingItem · WaitingApproval · teamWaitingFor
 * @usage const out = await teamWaitingFor(deps, caller);
 * @version-history
 *   v1.1.0 — 2026-11-15 — decide_url opens the team's Waiting for you workspace, where its approvals are decided (T7).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T6).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { readerFor } from '../classification/reader.js';
import { loadWorkspaceContent } from '../workspace/content.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { listTeamsOf } from './status.js';
import { teamDisplayName } from './record.js';

export interface WaitingItem {
    organism_id: string;
    team: string;
    workspace: string;
    id: string;
    title: string;
    kind: string;
    detail: string;
    for: string;
    by: string;
    status: string;
}
export interface WaitingApproval { organism_id: string; team: string; id: string; action: string; prompt: string; decide_url: string }

const WAITING_SPACE = 'shared.waiting';

/** The newest value of each record in a space: `.latest` over `.draft` over the bare key. */
function recordsOf(rows: MemoryRecord[], prefix: string): Map<string, Record<string, unknown>> {
    const rank = (key: string) => key.endsWith('.latest') ? 3 : key.endsWith('.draft') ? 2 : 1;
    const best = new Map<string, { rank: number; value: Record<string, unknown> }>();
    for (const r of rows) {
        if (!r.key.startsWith(prefix) || !r.value || typeof r.value !== 'object') continue;
        const id = r.key.slice(prefix.length).replace(/\.(latest|draft)$/, '');
        if (!id || id.includes('.')) continue;
        const k = rank(r.key);
        if ((best.get(id)?.rank ?? 0) < k) best.set(id, { rank: k, value: r.value as Record<string, unknown> });
    }
    return new Map([...best].map(([id, v]) => [id, v.value]));
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** What waits for the caller in every team they are in. */
export async function teamWaitingFor(
    deps: { storage: Storage; config: AimeatConfig }, caller: CallerContext,
): Promise<{ items: WaitingItem[]; approvals: WaitingApproval[] }> {
    const { storage } = deps;
    const owner = caller.owner;
    const reader = readerFor(deps, caller.auth);
    const locale = (await storage.getGHIIByOwner(owner))?.locale ?? null;
    const items: WaitingItem[] = [];
    const approvals: WaitingApproval[] = [];
    for (const { organism, team } of await listTeamsOf(storage, owner)) {
        const name = teamDisplayName(team, locale, organism.name);
        const lead = isOrganismOwner(organism, owner);
        const got = await loadWorkspaceContent(deps, reader, { sub: caller.principal, ownerName: owner, accessorGaii: caller.ownerGhii }, { organismId: organism.id, ws: team.workspaces.waiting });
        if (got.ok) {
            const prefix = `organism.${organism.id}.w.${team.workspaces.waiting}.${WAITING_SPACE}.`;
            for (const [id, v] of recordsOf(got.items, prefix)) {
                const status = str(v.status) || 'open';
                const forWhom = str(v.for);
                if (status !== 'open') continue;
                if (forWhom ? forWhom !== owner : !lead) continue;
                items.push({
                    organism_id: organism.id, team: name, workspace: team.workspaces.waiting, id,
                    title: str(v.title), kind: str(v.kind) || 'other', detail: str(v.detail), for: forWhom, by: str(v.by), status,
                });
            }
        }
        const pending = await storage.listPendingApprovals(organism.id, { status: 'pending' });
        const membership = await storage.getMembership(organism.id, owner);
        const role = membership?.role === 'creator' ? 'owner' : membership?.role === 'admin' ? 'admin' : 'member';
        const rank: Record<string, number> = { member: 1, admin: 2, owner: 3 };
        for (const a of pending) {
            if ((rank[role] ?? 0) < (rank[a.approverRole] ?? 3)) continue;
            approvals.push({
                organism_id: organism.id, team: name, id: a.id, action: a.action, prompt: a.prompt ?? '',
                // The approvals are listed and decided in the team's Waiting for you workspace.
                decide_url: `/v1/profile?tab=organisms&org=${encodeURIComponent(organism.id)}&ws=${encodeURIComponent(team.workspaces.waiting)}`,
            });
        }
    }
    return { items, approvals };
}
