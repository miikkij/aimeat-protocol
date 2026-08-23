/**
 * @file src/routes/federation-peer/link-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator routes for one-time link invitations: mint, list, revoke.
 *
 *   The invite is how a node you PROVISION becomes a peer without its future operator having to
 *   approve a request from you on a screen they have not seen yet. Why the tier lives on the invite
 *   rather than in the introduce body, and why the token is hashed at rest: services/link-invites.ts.
 * @structure
 *   - POST   /v1/federation/link-invites      — mint one; the token is returned ONCE
 *   - GET    /v1/federation/link-invites      — what exists, without tokens
 *   - DELETE /v1/federation/link-invites/:id  — revoke one
 * @usage registerLinkInviteRoutes(router, config, storage) from ../federation-peer.js
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, for the contact tier.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { coerceTier, type PeerTier } from '../../services/federation-tiers.js';
import { mintLinkInvite, listLinkInvites, revokeLinkInvite, DEFAULT_INVITE_TTL_HOURS } from '../../services/link-invites.js';

/** Tiers an invite may name. Deliberately not `genesis` or `member`: an invite is presented by an
 *  unauthenticated caller at introduce time, and full federation is a relationship an operator agrees
 *  to with a node they can already see, not one a token grants in advance. */
const INVITABLE: PeerTier[] = ['contact', 'visiting'];

export function registerLinkInviteRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // POST /v1/federation/link-invites — mint a one-time invitation (operator)
    router.post('/v1/federation/link-invites', requireAuth(), requireRole('operator'), async (req, res) => {
        const { tier, ttl_hours, label } = req.body ?? {};
        const wanted = coerceTier(tier ?? 'contact');
        if (!INVITABLE.includes(wanted)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                `An invite may name ${INVITABLE.join(' or ')}. Fuller federation is agreed with a node you can already see, not granted in advance by a token.`));
            return;
        }
        if (ttl_hours !== undefined && (typeof ttl_hours !== 'number' || !Number.isFinite(ttl_hours) || ttl_hours <= 0)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ttl_hours must be a positive number of hours'));
            return;
        }

        const { token, invite } = await mintLinkInvite(storage, {
            tier: wanted,
            createdBy: req.auth!.owner,
            ttlHours: typeof ttl_hours === 'number' ? ttl_hours : DEFAULT_INVITE_TTL_HOURS,
            label: typeof label === 'string' ? label.slice(0, 200) : undefined,
        });

        res.status(201).json(success(config.nodeId, {
            id: invite.id,
            // The only time this is ever readable. Only its hash is stored, so a lost token is
            // re-minted rather than looked up.
            token,
            tier: invite.tier,
            expires_at: invite.expiresAt,
            label: invite.label,
            note: 'Give this token to the node being provisioned; it presents it once, as invite_token on POST /v1/federation/peer/introduce. It is shown here and never again.',
        }));
        emitChange('federation');
    });

    // GET /v1/federation/link-invites — list (operator). Never includes a token.
    router.get('/v1/federation/link-invites', requireAuth(), requireRole('operator'), async (_req, res) => {
        const invites = await listLinkInvites(storage);
        res.json(success(config.nodeId, {
            invites: invites.map(i => ({
                id: i.id,
                tier: i.tier,
                label: i.label,
                created_by: i.createdBy,
                created_at: i.createdAt,
                expires_at: i.expiresAt,
                consumed_at: i.consumedAt ?? null,
                consumed_by_node_id: i.consumedByNodeId ?? null,
                // A consumed invite is kept as the record of who was admitted at what tier.
                state: i.consumedAt ? 'consumed' : (new Date(i.expiresAt).getTime() <= Date.now() ? 'expired' : 'open'),
            })),
            total: invites.length,
        }));
    });

    // DELETE /v1/federation/link-invites/:id — revoke (operator)
    router.delete('/v1/federation/link-invites/:id', requireAuth(), requireRole('operator'), async (req, res) => {
        const id = req.params.id as string;
        const removed = await revokeLinkInvite(storage, id);
        if (!removed) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No such invite: ${id}`));
            return;
        }
        res.json(success(config.nodeId, { id, revoked: true }));
        emitChange('federation');
    });
}
