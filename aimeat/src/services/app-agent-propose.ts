/**
 * @file src/services/app-agent-propose.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's bundled agent reaches its user as a proposal they approve, not as a task for
 *   a runner they do not have (guided journey P3, brief doc-mupor242l3cq).
 *
 *   WHY. An app carries its agents as crew definitions inside its HTML (app-bundled-crews.ts), and
 *   deploying one meant a task for the owner's `crew-forge` runner. crew-forge left the basic agents
 *   on 2026-09-02 because creating an agent is two data writes and an approval, not an agent's job:
 *   a proposal the owner approves creates the agent and seeds its definition in one step
 *   (routes/agents-v2/agent-proposals.ts). So a new account had no runner, and every "deploy" ended
 *   in RUNNER_NOT_FOUND. This turns a bundled agent into that proposal, from an installed package and
 *   from the app's own "deploy" button alike.
 * @structure proposeBundledAgent(ctx, principal, app, agentName) · proposeBundledAgentsOfApps(...)
 * @usage const r = await proposeBundledAgent({ storage, config }, principal, app, 'researcher');
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppRecord } from '../storage/types/apps.js';
import type { CrewDefDoc } from '../data/basic-agents.js';
import { proposeAgent, type ProposerPrincipal } from './agent-proposals.js';
import { deployedAgentName } from '../models/crew-def-schemas.js';
import { logger } from '../utils/logger.js';

export interface BundledAgentProposal { agent_name: string; proposed_name: string; proposal_id: string; already_waiting: boolean }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The proposal's name: the deployed-name convention, cut to the 40 characters a proposal allows. */
function proposalName(agentName: string, appId: string): string {
    return deployedAgentName(agentName, appId).slice(0, 40).replace(/-+$/g, '');
}

/**
 * Propose one agent an app declares, for the principal's owner. The definition goes with the
 * proposal, so approving it creates the agent and seeds what it is in one step.
 */
export async function proposeBundledAgent(
    ctx: { storage: Storage; config: AimeatConfig },
    principal: ProposerPrincipal, app: AppRecord, agentName: string,
): Promise<{ ok: true; proposal: BundledAgentProposal } | { ok: false; status: number; code: string; message: string }> {
    const declared = (app.manifest?.cortex?.agents ?? [])
        .find(a => (a as { agent_name?: unknown }).agent_name === agentName) as Record<string, unknown> | undefined;
    if (!declared) {
        return { ok: false, status: 404, code: 'AGENT_NOT_DECLARED', message: `The app ${app.filename} does not list an agent called "${agentName}".` };
    }
    const appId = `${app.ownerName}/${app.filename}`;
    const { description, ...rest } = declared;
    delete rest.agent_name;
    // The bundled crew-def is the flat shape the publish route validates (models/crew-def-schemas.ts);
    // the two fields a seeded definition states and a bundled one may leave out get their defaults.
    const crewDef = {
        tags: [], listen_for: ['tasks'], ...rest,
    } as unknown as CrewDefDoc;
    const readmeLine = text(crewDef.readme_md).split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? '';
    const purpose = text(description) || readmeLine || `Works for the app ${app.filename}, which it came with.`;
    const r = await proposeAgent(ctx, principal, {
        name: proposalName(agentName, appId),
        // The app's own name where it has one: an installed copy's filename carries the instance id.
        display_name: `${agentName} (${text((app.manifest as { name?: unknown } | undefined)?.name) || app.filename})`,
        purpose: purpose.length >= 10 ? purpose : `${purpose}: the agent that came with the app ${app.filename}.`,
        mode: 'task-runner', run_mode: 'spawn', crew_def: crewDef,
    });
    if (!r.ok) return r;
    return { ok: true, proposal: { agent_name: agentName, proposed_name: r.proposal.name, proposal_id: r.proposal.id, already_waiting: !!r.alreadyWaiting } };
}

/**
 * Propose every agent the given apps declare. Used after a package install: each agent lands on the
 * owner's open items, and nothing runs until they approve it. A refusal is logged and named in the
 * answer rather than failing the install, which has already succeeded.
 */
export async function proposeBundledAgentsOfApps(
    ctx: { storage: Storage; config: AimeatConfig },
    principal: ProposerPrincipal, apps: AppRecord[],
): Promise<{ proposed: BundledAgentProposal[]; skipped: string[] }> {
    const proposed: BundledAgentProposal[] = [];
    const skipped: string[] = [];
    for (const app of apps) {
        for (const a of app.manifest?.cortex?.agents ?? []) {
            const name = text((a as { agent_name?: unknown }).agent_name);
            if (!name) continue;
            const r = await proposeBundledAgent(ctx, principal, app, name);
            if (r.ok) proposed.push(r.proposal);
            else {
                skipped.push(`${app.filename}/${name}: ${r.message}`);
                logger.warn('proposeBundledAgentsOfApps: an agent was not proposed', { app: app.filename, agent: name, code: r.code });
            }
        }
    }
    return { proposed, skipped };
}
