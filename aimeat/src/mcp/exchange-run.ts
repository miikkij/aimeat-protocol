/**
 * @file src/mcp/exchange-run.ts
 * @description The GENERIC "act on EXCHANGE" MCP tools — the operations that had no MCP surface, so any
 *   MCP client (Claude chat, another agent, a fleet) can do what a bespoke runtime tool did, NOT just one.
 *   These are the app/agent-layer moat's primitives, exposed generically:
 *     - aimeat_app_tool_invoke — CALL an app's offered function (e.g. getCompanyBrief) through your metered
 *       contract. The generic "one app calls another app's tool" channel: contract authorises it, the node
 *       meters + rakes, the provider's upstream keys stay server-side. Mirrors POST /v1/apps/:o/:f/webmcp/tools/:t.
 *     - aimeat_exchange_work / _work_deliver / _work_list — the async AGENT-WORK surface (start a task under a
 *       contract; the provider delivers → settle-on-delivery; list your items either side). Mirrors /v1/exchange/work*.
 *     - aimeat_exchange_proposals / _proposal_decide — RENEGOTIATION (list the proposals you're party to; accept
 *       → supersede, decline, or withdraw). Mirrors GET /v1/exchange/proposals + /:id/{accept,decline,withdraw}.
 *   Every tool acts as the CALLER's own resolved GAII (never from input) and reaches the SAME metered
 *   chokepoint (authoriseMeteredCall) as the REST routes — no new business logic, no undercut, node stays
 *   the trust boundary. The chokepoint returns a decision rather than writing HTTP, so these tools render
 *   it as MCP text instead of fabricating an Express response to get at it.
 * @structure registerExchangeRunTools() — registers 6 tools (app-tool invoke · work start/deliver/list · proposals/decide)
 * @usage
 *   import { registerExchangeRunTools } from './exchange-run.js';
 *   registerExchangeRunTools(mcp, storage, config, () => agentGaii, () => sessionToken);
 * @version-history
 *   v1.2.0 — 2026-07-28 — Calls the metered chokepoint directly. The capture-only mock Express
 *     Response existed only because the gate insisted on writing HTTP; a decision is a value.
 *   v1.1.0 — 2026-07-27 — The app-tool invoke carries the internal pass. Without it the loopback met the
 *     raw paywall and settled the same contract a second time — one call, two charges.
 *   v1.0.0 — 2026-07-21 — Initial: generic app-tool invoke + agent-work + renegotiation over MCP (parity with
 *     the REST routes so every MCP client, not only crewaimeat, can act on EXCHANGE).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { readEntitlementForCall } from '../services/metered-entitlements.js';
import { getOffering } from '../services/exchange-market.js';
import {
    type AgentWork, newWorkId, putWork, getWork, listWorkByConsumer, listWorkByProvider,
} from '../services/exchange-work.js';
import {
    getProposal, listProposalsForOwner, supersedeWithProposal, putProposal,
} from '../services/exchange-proposals.js';
import { authoriseMeteredCall } from '../services/metered-access.js';
import { meteredRefusalText } from '../routes/extensions/metered-response.js';
import { appToolsKey, appIdFromToolsKey, AppToolsDocSchema } from '../models/app-tool-schemas.js';
import { getInterfaceVersion } from '../services/app-tool-interfaces.js';
import { sendDirectMessage } from '../services/message-send.js';
import type { PeerInfo } from '../services/federation.js';
import { logger } from '../utils/logger.js';


/** The app ids an owner publishes a public tool manifest for — the signpost on a missed lookup. */
async function listAppToolManifests(storage: Storage, ownerGhii: string): Promise<string[]> {
    try {
        const recs = await storage.listMemory(ownerGhii, { prefix: 'apps.' });
        return recs
            .filter(r => r.visibility === 'public')
            .map(r => appIdFromToolsKey(r.key))
            .filter((id): id is string => !!id)
            .sort()
            .slice(0, 12);
    } catch (err) {
        // A courtesy on a path that already failed; never turn it into a second failure — but say
        // so, or a broken listing looks like an owner with no manifests.
        logger.warn('app-tool manifest hint could not be built', { ownerGhii, error: String(err) });
        return [];
    }
}

export function registerExchangeRunTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    getToken: () => string | undefined,
): void {
    const agentGaii = getAgentGaii();
    const owner = parseGaiiLoose(agentGaii).owner;
    const callerGaii = agentGaii;

    const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
    const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true as const });

    const gh = (o: string) => `${o}@${config.nodeId}`;
    async function notify(recipientOwner: string, subject: string, body: string): Promise<void> {
        try {
            await sendDirectMessage({ config, storage, peers: new Map<string, PeerInfo>() }, {
                senderGhii: gh(owner), recipientGhii: gh(recipientOwner), body, subject, respondable: false, skipContactGate: true,
            });
        } catch (err) { logger.warn('notify: notification failure must never fail the action', { error: String(err) }); }
    }

    function workView(w: AgentWork) {
        return {
            work_id: w.workId, offering_id: w.offeringId, consumer: w.consumerGaii, provider: w.providerGhii,
            agent: w.agentGaii, task_type: w.taskType, ext: w.ext, action: w.action, input: w.input, output: w.output,
            note: w.note, state: w.state, unit: w.unit, currency: w.currency, charged_units: w.chargedUnits,
            created_at: w.createdAt, delivered_at: w.deliveredAt,
        };
    }

    // ── aimeat_app_tool_invoke — call an app's offered tool through your metered contract ──────────────
    mcp.tool(
        'aimeat_app_tool_invoke',
        descriptionFor('aimeat_app_tool_invoke'),
        {
            owner: z.string().min(1).max(120),
            app: z.string().min(1).max(120),
            tool: z.string().min(1).max(120),
            input: z.record(z.string(), z.unknown()).optional(),
        },
        annotationsFor('aimeat_app_tool_invoke'),
        async ({ owner: appOwner, app, tool, input }) => {
            const ownerName = appOwner.split('@')[0];
            const manifestRec = await storage.getMemory(`${ownerName}@${config.nodeId}`, appToolsKey(app));
            if (!manifestRec) {
                // An app id is a FILENAME and carries its extension; the app's own subdomain does not.
                // Naming what this owner actually publishes turns a dead end into a one-step correction,
                // instead of sending the caller off to read the app's source to guess.
                const near = await listAppToolManifests(storage, `${ownerName}@${config.nodeId}`);
                const hint = near.length ? ` This owner publishes tool manifests for: ${near.join(', ')}.` : '';
                return fail(`APP_TOOLS_NOT_FOUND: app "${ownerName}/${app}" declares no tool manifest.${hint}`);
            }
            const parsed = AppToolsDocSchema.safeParse(manifestRec.value);
            if (!parsed.success) return fail(`INVALID_TOOL_MANIFEST: app "${ownerName}/${app}" tool manifest is malformed`);
            const toolDef = parsed.data.tools.find(t => t.name === tool);
            if (!toolDef) return fail(`TOOL_NOT_FOUND: no tool "${tool}" on app "${ownerName}/${app}"`);

            const coordExt = `apptool:${ownerName}/${app}`;
            const ent = await readEntitlementForCall(storage, callerGaii, coordExt, tool);
            if (!ent) return fail(`NO_CONTRACT: accept a contract for "${ownerName}/${app}/${tool}" first (aimeat_exchange_accept with its offering_id)`);

            // Resolve the binding from the PINNED interface snapshot (the freeze), else the tool's current binding.
            const pinnedVersion = ent.surface && ent.surface.kind === 'app-tool' ? ent.surface.ifaceVersion : undefined;
            const iface = pinnedVersion ? await getInterfaceVersion(storage, ent.providerGhii, app, tool, pinnedVersion) : null;
            const binding = iface?.binding ?? toolDef.action_id ?? null;
            if (!binding) return fail('TOOL_NOT_INVOKABLE: this tool has no capability binding to invoke');
            const cap = await storage.getCapability(binding);
            if (!cap) return fail(`CAPABILITY_NOT_FOUND: backing capability not found (${binding})`);

            // The SAME decision the REST twin makes, from the same function — not a re-derivation of
            // it, and no fabricated Response to reach it through.
            const label = `${app}/${tool}${pinnedVersion ? ` v${pinnedVersion}` : ''}`;
            const outcome = await authoriseMeteredCall({
                config, storage, caller: callerGaii, product: { ext: coordExt, action: tool, label },
            });
            if (outcome.kind === 'no_right') return fail('NO_CONTRACT: no active contract to settle against');
            if (outcome.kind !== 'settled' && outcome.kind !== 'free_owner') {
                const r = meteredRefusalText(outcome, label);
                return fail(`${r.code}: ${r.message}`);
            }

            // Settled → invoke; refund on throw (never leave a phantom charge).
            try {
                const { invokeCapability } = await import('../services/capability-invoke.js');
                const { mintInternalPass } = await import('../routes/extensions/internal-pass.js');
                // Settled above on this app-tool's coordinate. The capability then runs over the node's
                // own HTTP surface and meets the raw paywall, which cannot know which product was bought —
                // so it billed the same contract a second time. One call, one settlement, whichever twin
                // of this route the caller reached (the REST WebMCP path carries the same pass).
                const invoked = await invokeCapability(config, storage, cap, (input ?? {}) as Record<string, unknown>, callerGaii, getToken() ?? '', 'normal',
                    mintInternalPass(coordExt, tool));
                return ok({ app: `${ownerName}/${app}`, tool, iface_version: pinnedVersion ?? null, metered: true, result: invoked.result });
            } catch (err) {
                if (outcome.kind === 'settled') await outcome.refund();
                const e = err as { code?: string; message?: string };
                return fail(`${e.code ?? 'TOOL_INVOKE_FAILED'}: ${e.message ?? 'tool invocation failed (you were refunded)'}`);
            }
        },
    );

    // ── aimeat_exchange_work — start a task under an agent-work contract (consumer) ────────────────────
    mcp.tool(
        'aimeat_exchange_work',
        descriptionFor('aimeat_exchange_work'),
        {
            offering_id: z.string().min(1).max(120),
            input: z.record(z.string(), z.unknown()).optional(),
            note: z.string().max(2000).optional(),
        },
        annotationsFor('aimeat_exchange_work'),
        async ({ offering_id, input, note }) => {
            const o = await getOffering(storage, offering_id);
            if (!o || o.state !== 'listed' || o.kind !== 'agent-work' || !o.surface || o.surface.kind !== 'agent-work') {
                return fail('NOT_FOUND: no such listed agent-work offering');
            }
            const ent = await readEntitlementForCall(storage, callerGaii, o.ext, o.action);
            if (!ent || ent.state !== 'active') {
                return fail('NO_CONTRACT: accept a contract for this agent-work offering before starting a task');
            }
            const s = o.surface;
            const now = new Date().toISOString();
            const work: AgentWork = {
                workId: newWorkId(), offeringId: offering_id, consumerGaii: callerGaii, consumerOwner: owner,
                providerGhii: o.providerGhii, providerOwner: o.providerOwner,
                agentGaii: `${s.agentName}#${o.providerOwner}@${config.nodeId}`, taskType: s.taskType,
                ext: o.ext, action: o.action, input: input ?? {}, output: null,
                note: note ?? '', state: 'open', unit: ent.unit, currency: ent.currency,
                chargedUnits: 0, createdAt: now, deliveredAt: null,
            };
            await putWork(storage, work);
            await notify(o.providerOwner, 'EXCHANGE — new agent work started',
                `${owner} started a "${s.taskType}" task for your agent ${s.agentName} (work ${work.workId}). Deliver it to get paid.`);
            return ok({ work: workView(work) });
        },
    );

    // ── aimeat_exchange_work_deliver — provider delivers → settle on delivery ──────────────────────────
    mcp.tool(
        'aimeat_exchange_work_deliver',
        descriptionFor('aimeat_exchange_work_deliver'),
        {
            work_id: z.string().min(1).max(120),
            output: z.unknown().optional(),
            note: z.string().max(2000).optional(),
        },
        annotationsFor('aimeat_exchange_work_deliver'),
        async ({ work_id, output, note }) => {
            const w = await getWork(storage, work_id);
            if (!w || w.providerOwner !== owner) return fail('NOT_FOUND: no such work of yours to deliver');
            if (w.state !== 'open') return fail(`WORK_NOT_OPEN: work is ${w.state}`);
            const before = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
            if (!before || before.state !== 'active') return fail('CONTRACT_INACTIVE: the consumer contract is no longer active — cannot settle this delivery');
            const workLabel = `${w.agentGaii}:${w.taskType}`;
            const outcome = await authoriseMeteredCall({
                config, storage, caller: w.consumerGaii,
                product: { ext: w.ext, action: w.action, label: workLabel },
            });
            if (outcome.kind === 'no_right') return fail('NO_CONTRACT: no active contract to settle against');
            if (outcome.kind !== 'settled' && outcome.kind !== 'free_owner') {
                const r = meteredRefusalText(outcome, workLabel);
                return fail(`${r.code}: ${r.message}`);
            }
            const after = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
            const charged = after && before ? Math.max(0, after.budget.spentUnits - before.budget.spentUnits) : 0;
            w.state = 'delivered'; w.output = output ?? null; w.chargedUnits = charged; w.deliveredAt = new Date().toISOString();
            if (note) w.note = note.slice(0, 2000);
            await putWork(storage, w);
            await notify(w.consumerOwner, 'EXCHANGE — your agent work was delivered',
                `Your "${w.taskType}" task (work ${w.workId}) was delivered by ${owner} and charged to your contract.`);
            return ok({ work: workView(w) });
        },
    );

    // ── aimeat_exchange_work_list — your agent-work items (consumer default, or provider) ──────────────
    mcp.tool(
        'aimeat_exchange_work_list',
        descriptionFor('aimeat_exchange_work_list'),
        {
            role: z.enum(['consumer', 'provider']).optional(),
        },
        annotationsFor('aimeat_exchange_work_list'),
        async ({ role }) => {
            const items = role === 'provider' ? await listWorkByProvider(storage, owner) : await listWorkByConsumer(storage, owner);
            return ok({ work: items.map(workView), count: items.length, role: role ?? 'consumer' });
        },
    );

    // ── aimeat_exchange_proposals — renegotiation proposals you are party to ───────────────────────────
    mcp.tool(
        'aimeat_exchange_proposals',
        descriptionFor('aimeat_exchange_proposals'),
        {},
        annotationsFor('aimeat_exchange_proposals'),
        async () => {
            const list = await listProposalsForOwner(storage, owner);
            const view = list.map(p => ({
                proposal_id: p.proposalId, capability: p.capabilityLabel, ext: p.ext, action: p.action,
                consumer_gaii: p.consumerGaii, provider: p.providerGhii,
                proposed_by: p.proposedByRole, proposer_owner: p.proposerOwner, counterparty_owner: p.counterpartyOwner,
                new_price_per_call: p.newPricePerCall, new_cap_units: p.newCapUnits, note: p.note,
                current_terms: p.currentTerms, status: p.status, created_at: p.createdAt, resolved_at: p.resolvedAt,
            }));
            return ok({ proposals: view, count: view.length });
        },
    );

    // ── aimeat_exchange_proposal_decide — accept (supersede) / decline / withdraw a proposal ───────────
    mcp.tool(
        'aimeat_exchange_proposal_decide',
        descriptionFor('aimeat_exchange_proposal_decide'),
        {
            proposal_id: z.string().min(1).max(120),
            decision: z.enum(['accept', 'decline', 'withdraw']),
        },
        annotationsFor('aimeat_exchange_proposal_decide'),
        async ({ proposal_id, decision }) => {
            const p = await getProposal(storage, proposal_id);
            if (!p || p.status !== 'pending') return fail('NOT_FOUND: no such pending proposal');
            if (decision === 'withdraw') {
                if (p.proposerOwner !== owner) return fail('FORBIDDEN: only the proposer may withdraw');
                p.status = 'withdrawn'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
                return ok({ proposal_id: p.proposalId, status: p.status });
            }
            // accept / decline are the COUNTERPARTY's calls.
            if (p.counterpartyOwner !== owner) return fail(`FORBIDDEN: only the counterparty (${p.counterpartyOwner}) may ${decision} this proposal`);
            if (decision === 'decline') {
                p.status = 'declined'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
                await notify(p.proposerOwner, 'EXCHANGE — contract change declined', `${owner} declined your proposed change to ${p.capabilityLabel}. The contract is unchanged.`);
                return ok({ proposal_id: p.proposalId, status: p.status });
            }
            const ent = await supersedeWithProposal(storage, p);
            if (!ent) return fail('CONTRACT_GONE: the contract no longer exists');
            p.status = 'accepted'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
            await notify(p.proposerOwner, 'EXCHANGE — contract change accepted',
                `${owner} accepted your proposed change to ${p.capabilityLabel}. The new contract is in effect; the previous one is in your contract history.`);
            return ok({
                proposal_id: p.proposalId, status: p.status,
                entitlement: { ext: ent.ext, action: ent.action, price_per_call: ent.pricePerCall, unit: ent.unit, state: ent.state, cap_units: ent.budget.capUnits },
            });
        },
    );
}
