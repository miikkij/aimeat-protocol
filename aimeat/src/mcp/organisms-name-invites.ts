/**
 * @file organisms-name-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for NAME invitations + direct member adds — already-registered local
 *   owners joining an organism. Mirrors the REST membership routes via the shared
 *   services/invitations.ts core (invite-time role + workspace grants, pending-invite edit/cancel,
 *   direct add without the accept round-trip). Extracted from mcp/organisms.ts (max-file-lines).
 * @structure registerOrganismNameInviteTools() — registers aimeat_organism_invite,
 *   aimeat_organism_member_add, aimeat_organism_invitation_update, aimeat_organism_invitation_cancel,
 *   aimeat_organism_invitations, aimeat_organism_invitation_respond, aimeat_organism_agent_attach,
 *   aimeat_organism_agent_detach.
 * @usage registerOrganismNameInviteTools(mcp, storage, config, getOwnerName, agentGaii, emitResourceUpdated);
 * @version-history
 *   2026-11-13 — The invite-admin gate, the two owner tools, aimeat_organism_invitations and
 *     aimeat_organism_invitation_respond read through services/organism-read/manager.ts and
 *     name-invitations.ts, as their REST routes do (structure programme 2026-11, unit 2b).
 *   2026-11-11 — aimeat_organism_agent_attach and aimeat_organism_agent_detach: the organism's agent
 *     list reached the page and REST only, so an owner's AI could not add an admin's agent to an
 *     organism that admits only listed agents. Same service as the route.
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-15 — aimeat_organism_invitation_respond accepts only for the person in person (isOwnerPrincipal),
 *     as the REST route and the emailed link do; declining stays open (feature-list audit #57).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-08-25 — aimeat_organism_member_remove: removal existed on the web door only, so an
 *     owner asking their own AI to take someone out of an organism had no tool for it while
 *     member_add had had one since July. Calls services/organism-member-remove.ts, as REST does.
 *   v1.1.0 — 2026-08-11 — invitation_respond's decline path calls declineNameInvitation() instead of
 *     deleting the membership row itself (August 2026 MCP audit step 8), so the delete and the
 *     `organisms` emit stay together with the REST decline route.
 *   v1.0.0 — 2026-07-16 — Extracted from mcp/organisms.ts; tools now ride the shared name-invite core.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { addOrganismOwner, removeOrganismOwner } from '../services/organism-ownership.js';
import { organismForManager, organismForOwner } from '../services/organism-read/manager.js';
import { nameInvitationsOf, nameInvitationTo } from '../services/organism-read/name-invitations.js';
import {
    InvitationError, createNameInvitation, updateNameInvitation, cancelNameInvitation,
    acceptNameInvitation, declineNameInvitation, addOrganismMember, NAMED_INVITE_ACCEPT_REFUSAL,
} from '../services/invitations.js';
import { removeOrganismMember, MemberRemoveError } from '../services/organism-member-remove.js';
import { attachOrganismAgent, detachOrganismAgent, AgentListError } from '../services/organism-agents/attach.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerOrganismNameInviteTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getOwnerName: () => string,
    agentGaii: string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    /** The session's caller: accepting asks whether it is the person in person (isOwnerPrincipal). */
    caller?: () => CallerContext,
): void {
    /** Creator/admin gate shared by the invite/add/edit tools. Returns the organism or an error string. */
    type InviteGate = { err: string; organism?: never; ownerName?: never } | { err?: never; organism: OrganismRecord; ownerName: string };
    const inviteAdminGate = async (organism_id: string): Promise<InviteGate> => {
        // The read and the owner-or-admin rule are services/organism-read/manager.ts, which the REST
        // invitation and member routes ask too (requireInviteAdmin).
        const ownerName = getOwnerName();
        const gate = await organismForManager(storage, organism_id, { owner: ownerName });
        if (gate.ok) return { organism: gate.organism, ownerName };
        return { err: gate.code === 'NOT_FOUND' ? 'Organism not found' : 'Only the creator or an admin can manage members and invitations' };
    };
    const invitationErrText = (e: unknown): string =>
        e instanceof InvitationError ? e.message : ((e as Error)?.message || 'Invitation operation failed');

    // ── Tool: aimeat_organism_invite ──
    // Mirrors POST /v1/organisms/:id/invitations — shared core in services/invitations.ts. Carries
    // an org role + per-workspace grants chosen at invite time, applied on accept.
    mcp.registerTool(
        'aimeat_organism_invite',
        {
            description: descriptionFor('aimeat_organism_invite'),
            inputSchema: zodShapeFor('aimeat_organism_invite'),
            annotations: annotationsFor('aimeat_organism_invite'),
        },
        async ({ organism_id, invitee, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                const membership = await createNameInvitation(storage, config, {
                    organism: gate.organism, inviterGhii: gate.ownerName, inviteeRaw: invitee, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'invited', organism_id, invitee: membership.ghii, role: membership.role, workspaces: membership.invitedWorkspaces ?? [] }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_member_add ──
    // Mirrors POST /v1/organisms/:id/members — DIRECT ADD: the owner becomes an active member with
    // role + workspace grants applied immediately (no accept round-trip; they are notified and can leave).
    mcp.registerTool(
        'aimeat_organism_member_add',
        {
            description: descriptionFor('aimeat_organism_member_add'),
            inputSchema: zodShapeFor('aimeat_organism_member_add'),
            annotations: annotationsFor('aimeat_organism_member_add'),
        },
        async ({ organism_id, ghii, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                const { membership, grantedWorkspaces } = await addOrganismMember(storage, config, {
                    organism: gate.organism, inviterGhii: gate.ownerName, inviteeRaw: ghii, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'added', organism_id, member: membership.ghii, role: membership.role, workspaces: grantedWorkspaces }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_member_remove ──
    // Mirrors DELETE /v1/organisms/:id/members/:ghii and calls the same service, so the refusals,
    // the agent detach, the workspace-grant revoke and the notice are one implementation.
    mcp.registerTool(
        'aimeat_organism_member_remove',
        {
            description: descriptionFor('aimeat_organism_member_remove'),
            inputSchema: zodShapeFor('aimeat_organism_member_remove'),
            annotations: annotationsFor('aimeat_organism_member_remove'),
        },
        async ({ organism_id, ghii, ban }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                const out = await removeOrganismMember(storage, config, {
                    organism: gate.organism, callerOwner: gate.ownerName, targetRaw: ghii, ban,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: out.banned ? 'banned' : 'removed', organism_id, ...out }, null, 2) }] };
            } catch (e) {
                if (e instanceof MemberRemoveError) return { content: [{ type: 'text' as const, text: `${e.code}: ${e.message}` }], isError: true };
                throw e;
            }
        },
    );

    // ── Tools: aimeat_organism_agent_attach / aimeat_organism_agent_detach ──
    // Mirror POST and DELETE /v1/organisms/:id/agents and call the same service
    // (services/organism-agents/attach.ts). Under "listed", adding asks isOwnerPrincipal of the
    // session, as the route does: an agent passes when its owner gave it account:security.
    const agentListFail = (e: unknown) => {
        if (e instanceof AgentListError) return { ...toolError(e.code, e.message) };
        throw e;
    };
    mcp.registerTool(
        'aimeat_organism_agent_attach',
        {
            description: descriptionFor('aimeat_organism_agent_attach'),
            inputSchema: zodShapeFor('aimeat_organism_agent_attach'),
            annotations: annotationsFor('aimeat_organism_agent_attach'),
        },
        async ({ organism_id, agent_gaii }) => {
            try {
                const out = await attachOrganismAgent(storage, config, {
                    organismId: organism_id, callerOwner: getOwnerName(),
                    mayActAsPerson: !!caller && isOwnerPrincipal(caller().auth), agentGaii: agent_gaii,
                });
                emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, ...out }, null, 2) }] };
            } catch (e) { return agentListFail(e); }
        },
    );
    mcp.registerTool(
        'aimeat_organism_agent_detach',
        {
            description: descriptionFor('aimeat_organism_agent_detach'),
            inputSchema: zodShapeFor('aimeat_organism_agent_detach'),
            annotations: annotationsFor('aimeat_organism_agent_detach'),
        },
        async ({ organism_id, agent_gaii }) => {
            try {
                const out = await detachOrganismAgent(storage, { organismId: organism_id, callerOwner: getOwnerName(), agentGaii: agent_gaii });
                emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, ...out }, null, 2) }] };
            } catch (e) { return agentListFail(e); }
        },
    );

    // ── Tool: aimeat_organism_owner_add ──
    // Mirrors POST /v1/organisms/:id/owners, and calls the same service, so the membership rules and
    // the notifications cannot differ between the two doors.
    mcp.registerTool(
        'aimeat_organism_owner_add',
        {
            description: descriptionFor('aimeat_organism_owner_add'),
            inputSchema: zodShapeFor('aimeat_organism_owner_add'),
            annotations: annotationsFor('aimeat_organism_owner_add'),
        },
        async ({ organism_id, ghii }) => {
            // The read and the owner rule are services/organism-read/manager.ts, which POST /v1/organisms/:id/owners asks too.
            const ownerName = getOwnerName();
            const gate = await organismForOwner(storage, organism_id, { owner: ownerName });
            if (!gate.ok) {
                return { content: [{ type: 'text' as const, text: gate.code === 'NOT_FOUND' ? `Organism not found: ${organism_id}` : 'Only an owner can add an owner' }], isError: true };
            }
            const out = await addOrganismOwner(storage, config, gate.organism, ghii, { performedBy: ownerName });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, added: out.added, owners: out.owners }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_owner_remove ──
    // Mirrors DELETE /v1/organisms/:id/owners/:ghii. The last owner cannot be removed: an organism
    // with no owner is the one state nobody inside it can repair.
    mcp.registerTool(
        'aimeat_organism_owner_remove',
        {
            description: descriptionFor('aimeat_organism_owner_remove'),
            inputSchema: zodShapeFor('aimeat_organism_owner_remove'),
            annotations: annotationsFor('aimeat_organism_owner_remove'),
        },
        async ({ organism_id, ghii }) => {
            // The read and the owner rule are services/organism-read/manager.ts, which DELETE /v1/organisms/:id/owners/:ghii asks too.
            const ownerName = getOwnerName();
            const gate = await organismForOwner(storage, organism_id, { owner: ownerName });
            if (!gate.ok) {
                return { content: [{ type: 'text' as const, text: gate.code === 'NOT_FOUND' ? `Organism not found: ${organism_id}` : 'Only an owner can remove an owner' }], isError: true };
            }
            const out = await removeOrganismOwner(storage, config, gate.organism, ghii, { performedBy: ownerName });
            if (!out.ok) return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ organism_id, removed: out.removed, owners: out.owners }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitation_update ──
    // Mirrors PATCH /v1/organisms/:id/invitations/:ghii — edit a PENDING name invitation's rights.
    mcp.registerTool(
        'aimeat_organism_invitation_update',
        {
            description: descriptionFor('aimeat_organism_invitation_update'),
            inputSchema: zodShapeFor('aimeat_organism_invitation_update'),
            annotations: annotationsFor('aimeat_organism_invitation_update'),
        },
        async ({ organism_id, invitee, role, workspaces }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            if (role === undefined && workspaces === undefined) {
                return { content: [{ type: 'text' as const, text: 'Provide "role" and/or "workspaces" to update' }], isError: true };
            }
            try {
                const membership = await updateNameInvitation(storage, config, {
                    organism: gate.organism, inviteeRaw: invitee, role, workspaces,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'updated', organism_id, invitee: membership.ghii, role: membership.role, workspaces: membership.invitedWorkspaces ?? [] }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_invitation_cancel ──
    // Mirrors DELETE /v1/organisms/:id/invitations/:ghii — withdraw a PENDING name invitation.
    mcp.registerTool(
        'aimeat_organism_invitation_cancel',
        {
            description: descriptionFor('aimeat_organism_invitation_cancel'),
            inputSchema: zodShapeFor('aimeat_organism_invitation_cancel'),
            annotations: annotationsFor('aimeat_organism_invitation_cancel'),
        },
        async ({ organism_id, invitee }) => {
            const gate = await inviteAdminGate(organism_id);
            if (gate.err !== undefined) return { content: [{ type: 'text' as const, text: gate.err }], isError: true };
            try {
                await cancelNameInvitation(storage, config, {
                    organism: gate.organism, cancellerGhii: gate.ownerName, inviteeRaw: invitee,
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'cancelled', organism_id, invitee }, null, 2) }] };
            } catch (e) {
                return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_organism_invitations ── (your own pending invitations across organisms)
    mcp.registerTool(
        'aimeat_organism_invitations',
        {
            description: descriptionFor('aimeat_organism_invitations'),
            inputSchema: zodShapeFor('aimeat_organism_invitations'),
            annotations: annotationsFor('aimeat_organism_invitations'),
        },
        async () => {
            // services/organism-read/name-invitations.ts, which GET /v1/organisms/invitations/mine asks too.
            const out = (await nameInvitationsOf(storage, { owner: getOwnerName() })).map(({ membership: m, organism: org }) =>
                ({ organism_id: org.id, name: org.name, type: org.type, invited_by: m.invitedBy, role: m.role, workspaces: m.invitedWorkspaces ?? [] }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
        },
    );

    // ── Tool: aimeat_organism_invitation_respond ── (accept | decline your invitation)
    mcp.registerTool(
        'aimeat_organism_invitation_respond',
        {
            description: descriptionFor('aimeat_organism_invitation_respond'),
            inputSchema: zodShapeFor('aimeat_organism_invitation_respond'),
            annotations: annotationsFor('aimeat_organism_invitation_respond'),
        },
        async ({ organism_id, decision }) => {
            // The organism and the pending invitation: services/organism-read/name-invitations.ts,
            // which POST /v1/organisms/:id/invitations/accept asks too.
            const ownerName = getOwnerName();
            const inv = await nameInvitationTo(storage, organism_id, { owner: ownerName });
            if (!inv.ok) {
                return { content: [{ type: 'text' as const, text: inv.code === 'NOT_FOUND' ? 'Organism not found' : 'You have no pending invitation to this organism' }], isError: true };
            }
            const { organism, membership } = inv;
            if (decision === 'decline') {
                // Shared with POST /:id/invitations/decline (services/invitations.ts).
                try {
                    await declineNameInvitation(storage, { organismId: organism_id, inviteeOwner: ownerName });
                } catch (e) {
                    return { content: [{ type: 'text' as const, text: invitationErrText(e) }], isError: true };
                }
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'declined', organism_id }, null, 2) }] };
            }
            // THE PERSON ACCEPTS IN PERSON, as on POST /:id/invitations/accept and the emailed link
            // (routes/invite-accept.ts): joining an organism is the account holder's own decision. An
            // agent session passes only holding account:security (feature-list audit #57).
            if (!caller || !isOwnerPrincipal(caller().auth)) {
                return toolError('ACCESS_DENIED', NAMED_INVITE_ACCEPT_REFUSAL);
            }
            // Shared accept core: activates the row, syncs members/admins, applies invite-time ws grants.
            const workspaces = await acceptNameInvitation(storage, config, { organism, membership });
            emitResourceUpdated(agentGaii, `aimeat://organisms/${encodeURIComponent(organism_id)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'joined', organism_id, role: membership.role, workspaces }, null, 2) }] };
        },
    );
}
