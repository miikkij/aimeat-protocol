/**
 * @file src/services/organism/approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's approval requests: filing one for an action (it waits for a person, or
 *   runs at once when the organism's policy lets it) and the approval inbox. POST and GET
 *   /v1/organisms/:id/approvals run these functions, and so do the MCP tools
 *   aimeat_organism_approval_request and aimeat_organism_approvals, so the policy, the workspace's own
 *   autonomy and who may read a suggestion are decided in one place. Moved out of
 *   routes/organisms/gates.ts unchanged. A person resolves a request (POST
 *   /v1/organisms/:id/approvals/:aid), never an agent, so resolving has no function here.
 * @structure mergeWorkspaceGatePolicy · requestApprovalOp · listApprovalsOp
 * @usage
 *   const out = await requestApprovalOp({ storage, config }, req.auth!, orgId, req.body ?? {});
 *   if (!out.ok) res.status(out.status).json(error(config.nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: moved out of routes/organisms/gates.ts for the MCP tools (feature
 *     audit 2026-11-19, 4.4 item 1).
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, PendingApprovalRecord } from '../../storage/interface.js';
import { resolveIdentity, isOwnerInPerson } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { shouldGate, gatePolicyFromManifest, approverRoleFor, DEFAULT_ALWAYS_GATE, type GatePolicy, type Risk } from '../gate-policy.js';
import { readWorkspaceMetaRecord } from '../workspace/meta.js';
import { expireOverdueApprovals } from '../gate-expiry.js';
import { canReadWorkspace } from '../workspace/access.js';
import { isMemberChangeAction, visibleApprovals } from '../workspace/suggestions.js';
import { isTeamGateAction } from '../team/action-gate.js';
import { createOrganismGate } from './gate.js';
import { memberRoleOf } from '../workspace/share.js';

/** The caller as a token carries it: what req.auth and an MCP session's caller().auth both hold. */
export interface ApprovalAuth { sub: string; owner: string; roles: string[]; scopes?: string[]; federated?: boolean }
interface Deps { storage: Storage; config: AimeatConfig }
type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

/**
 * The policy for an action in a workspace: the workspace manifest's autonomy when it sets one, else the
 * organism's. The always-gate list is the UNION of the organism's floor (its own list, or the default
 * when it declares none) and the workspace's list, so a workspace can add classes to the floor and can
 * never remove one, an empty `alwaysGate: []` included. A workspace that declares no list leaves the
 * organism's value as it is.
 */
export function mergeWorkspaceGatePolicy(org: GatePolicy, ws: GatePolicy): GatePolicy {
    const autonomy = ws.autonomy ?? org.autonomy;
    const alwaysGate = ws.alwaysGate === undefined
        ? org.alwaysGate
        : [...new Set([...(org.alwaysGate ?? DEFAULT_ALWAYS_GATE), ...ws.alwaysGate])];
    return { ...(autonomy ? { autonomy } : {}), ...(alwaysGate ? { alwaysGate } : {}) };
}

/** File an approval request for `action` in organism `id`: it waits (gated) or is approved at once. */
export async function requestApprovalOp(deps: Deps, auth: ApprovalAuth, id: string, body: Record<string, unknown>) {
    const { storage, config } = deps;
    const H = createOrganismGate(config, storage);
    const organism = await storage.getOrganism(id);
    if (!organism) return refuse(404, 'NOT_FOUND', 'Organism not found');
    // The membership rule every organism route asks (createOrganismGate memberRole).
    if (!(await memberRoleOf(storage, organism, id, { sub: auth.sub, owner: auth.owner }))) return refuse(403, 'ACCESS_DENIED', 'Not an active member of this organism');

    // `arguments` is reserved in ESM strict mode — destructure it under a new name.
    const { action, arguments: actionArgs, risk, rule, stageId, flowGateId, approverRole, prompt, deadline } = body as {
        action?: unknown; arguments?: PendingApprovalRecord['arguments']; risk?: unknown; rule?: 'approve' | 'auto';
        stageId?: unknown; flowGateId?: unknown; approverRole?: unknown; prompt?: unknown; deadline?: unknown;
    };
    if (!action || typeof action !== 'string') return refuse(400, 'INVALID_INPUT', 'action is required');
    // A member's suggested workspace change is filed by the member change doors and nowhere else:
    // approving one RUNS the change it carries, so one filed here with arguments of the caller's
    // choosing would be a change nobody's rule allowed.
    if (isMemberChangeAction(action)) {
        return refuse(400, 'INVALID_INPUT', `${action} is filed by the workspace's member change routes: POST /v1/organisms/${id}/workspace/spaces or PUT /v1/organisms/${id}/workspace/sections/{space}.`);
    }
    // The same for a publish: approving one publishes the draft its arguments name, and the publish
    // route asks first whether the caller may write that draft, the space fence and the namespace
    // rule, and takes the approver from the organism's publish gate. Filed here, with arguments and
    // an approver of the caller's choosing, it skipped all of that (register finding
    // f-2026-11-13-generic-approval-action-publish-runs-a-publish). The resolve step keeps its
    // publish branch for the approvals that route files.
    if (action === 'publish') {
        return refuse(400, 'INVALID_INPUT', `A publish approval is filed by POST /v1/organisms/${id}/publish, which asks the publish checks and the organism's publish gate first.`);
    }
    // A team gate approval is filed by the node when an AI asks for the held action itself
    // (services/team/action-gate.ts, T7), with the node's own words of what it is. Filed here, its
    // fingerprint and its words would be the caller's, and a lead would approve one thing while
    // reading another.
    if (isTeamGateAction(action)) {
        return refuse(400, 'INVALID_INPUT', `${action} is filed by the node when the action itself is asked for: make the call, and it waits for a lead.`);
    }
    const riskVal: Risk = typeof risk === 'string' && ['low', 'medium', 'high'].includes(risk) ? risk as Risk : 'medium';

    const orgManifest = await H.readManifest(id);
    const orgPolicy = gatePolicyFromManifest(orgManifest);
    // An action names its workspace in `arguments.ws`, the field the publish approval stores.
    // The workspace manifest's policy (the autonomy level the workspace settings save) applies only
    // when the caller may read that workspace: a workspace the caller cannot read lends it no policy,
    // so naming another workspace's L5 cannot loosen the gate. The manifest is the copy that counts
    // (readWorkspaceMetaRecord), the same one the workspace read takes.
    const wsArg = (actionArgs as { ws?: unknown } | null | undefined)?.ws;
    let policy = orgPolicy;
    const manifests: unknown[] = [];
    if (typeof wsArg === 'string' && wsArg
        && await canReadWorkspace(storage, config, organism, auth.sub, auth.owner, resolveIdentity(auth, config.nodeId), wsArg)) {
        const wsManifest = await readWorkspaceMetaRecord(storage, id, wsArg, 'meta.manifest', config.nodeId);
        if (wsManifest) {
            policy = mergeWorkspaceGatePolicy(orgPolicy, gatePolicyFromManifest(wsManifest.value));
            manifests.push(wsManifest.value);
        }
    }
    manifests.push(orgManifest);
    // Whose word `risk` is. A human member describing what they are about to do is the party the
    // policy protects; an agent, an app grant or an ecosystem token describing its OWN action is the
    // party it constrains, and its word cannot lower the gate below the default. Same test the rest
    // of this codebase uses for "a person in person": isOwnerInPerson (utils/gaii.ts).
    const selfDeclaredRisk = !isOwnerInPerson(auth);
    const decision = shouldGate({ action, risk: riskVal, rule, policy, selfDeclaredRisk });
    // The same rule for `approverRole`, the field beside `risk`: a caller not in person does not
    // choose a laxer approver than the default, except where a manifest flow gate it names says so
    // (services/gate-policy.ts approverRoleFor; structure programme 2026-11, unit 7).
    const approverRoleVal = approverRoleFor({ declared: approverRole, selfDeclared: selfDeclaredRisk, flowGateId, manifests });

    const actor = resolveIdentity(auth, config.nodeId);
    const now = new Date().toISOString();
    const aid = uuidv4();
    const record: PendingApprovalRecord = {
        id: aid, organismId: id, actor, action,
        ...(actionArgs !== undefined ? { arguments: actionArgs } : {}),
        risk: riskVal, approverRole: approverRoleVal,
        ...(typeof prompt === 'string' ? { prompt } : {}),
        ...(typeof stageId === 'string' ? { stageId } : {}),
        ...(typeof flowGateId === 'string' ? { flowGateId } : {}),
        ...(typeof deadline === 'string' ? { deadline } : {}),
        status: decision.gate ? 'pending' : 'approved',
        ...(decision.gate ? {} : { decidedBy: 'system', decidedAt: now, resolutionNote: `auto: ${decision.reason}` }),
        createdAt: now, updatedAt: now,
    };
    await storage.createPendingApproval(record);
    if (!decision.gate) {
        await H.writeDecision(id, actor, `auto-approved action: ${action}`, [aid]);
    }
    emitChange('organisms');
    return { ok: true as const, approval: record, gated: decision.gate, reason: decision.reason };
}

/** The approval inbox of organism `id` for an active member, overdue requests aborted first. */
export async function listApprovalsOp(deps: Deps, auth: ApprovalAuth, id: string, status?: string) {
    const { storage, config } = deps;
    const organism = await storage.getOrganism(id);
    if (!organism) return refuse(404, 'NOT_FOUND', 'Organism not found');
    if (!(await memberRoleOf(storage, organism, id, { sub: auth.sub, owner: auth.owner }))) return refuse(403, 'ACCESS_DENIED', 'Not an active member of this organism');
    // Durable pause: lazily abort any overdue pending approvals before listing.
    await expireOverdueApprovals(storage, new Date().toISOString());
    // A member's suggestion carries the structure it would add to a workspace, so it is listed only
    // to someone who may read that workspace, or who made it (services/workspace/suggestions.ts).
    const caller = {
        principal: resolveIdentity(auth, config.nodeId), owner: auth.owner ?? '', roles: auth.roles ?? [],
        // The fenced-space rule reads the session's scopes when an approval writes the manifest.
        scopes: auth.scopes ?? [],
    };
    const approvals = await visibleApprovals({ storage, config }, caller, id,
        await storage.listPendingApprovals(id, status ? { status } : undefined));
    return { ok: true as const, approvals, total: approvals.length };
}
