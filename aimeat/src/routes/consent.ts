import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import type { StatsCollector } from '../services/stats.js';

export function consentRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector): Router {
    const router = Router();

    // POST /v1/consent — Create a new consent grant
    router.post('/v1/consent', requireAuth(), async (req, res) => {
        const ownerGaii = req.auth!.sub;
        const {
            data_pattern,
            recipient,
            purpose,
            scope = 'federation',
            expires = null,
            metadata,
        } = req.body ?? {};

        if (!data_pattern || !recipient || !purpose) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'data_pattern, recipient, and purpose are required'));
            return;
        }

        // Quota check: max 100 consents per owner
        const existing = await storage.listConsents(ownerGaii);
        if (existing.length >= 100) {
            res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', 'Maximum 100 consent records per owner'));
            return;
        }

        const now = new Date().toISOString();
        const consent = await storage.createConsent({
            id: uuidv4(),
            ownerGaii,
            dataPattern: data_pattern,
            recipient,
            purpose,
            scope,
            expires,
            status: 'active',
            grantedAt: now,
            revokedAt: null,
            metadata,
        });

        stats?.increment('consent_grants');

        res.status(201).json(success(config.nodeId, {
            id: consent.id,
            data_pattern: consent.dataPattern,
            recipient: consent.recipient,
            purpose: consent.purpose,
            scope: consent.scope,
            expires: consent.expires,
            status: consent.status,
            granted_at: consent.grantedAt,
            revoked_at: consent.revokedAt,
            metadata: consent.metadata,
        }, [
            { description: 'View this consent', method: 'GET', url: `/v1/consent/${consent.id}` },
            { description: 'Revoke this consent', method: 'DELETE', url: `/v1/consent/${consent.id}` },
            { description: 'List all consents', method: 'GET', url: '/v1/consent' },
            { description: 'Audit log', method: 'GET', url: '/v1/consent/audit' },
        ]));
    });

    // GET /v1/consent — List own consents
    router.get('/v1/consent', requireAuth(), async (req, res) => {
        const ownerGaii = req.auth!.sub;
        const opts: { status?: 'active' | 'revoked' | 'expired'; recipient?: string } = {};

        if (req.query.status) {
            opts.status = req.query.status as 'active' | 'revoked' | 'expired';
        }
        if (req.query.recipient) {
            opts.recipient = req.query.recipient as string;
        }

        const consents = await storage.listConsents(ownerGaii, opts);

        res.json(success(config.nodeId, {
            consents: consents.map(c => ({
                id: c.id,
                data_pattern: c.dataPattern,
                recipient: c.recipient,
                purpose: c.purpose,
                scope: c.scope,
                expires: c.expires,
                status: c.status,
                granted_at: c.grantedAt,
                revoked_at: c.revokedAt,
                metadata: c.metadata,
            })),
            total: consents.length,
        }));
    });

    // GET /v1/consent/audit — Audit report (MUST be before /:id)
    router.get('/v1/consent/audit', requireAuth(), async (req, res) => {
        const ownerGaii = req.auth!.sub;
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
        const opts: { days?: number; accessorGaii?: string; consentId?: string } = { days };

        if (req.query.accessor_gaii) {
            opts.accessorGaii = req.query.accessor_gaii as string;
        }
        if (req.query.consent_id) {
            opts.consentId = req.query.consent_id as string;
        }

        const entries = await storage.listConsentAudit(ownerGaii, opts);

        res.json(success(config.nodeId, {
            entries: entries.map(e => ({
                id: e.id,
                consent_id: e.consentId,
                accessor_gaii: e.accessorGaii,
                memory_key: e.memoryKey,
                action: e.action,
                timestamp: e.timestamp,
                allowed: e.allowed,
            })),
            total: entries.length,
            period_days: days,
        }));
    });

    // GET /v1/consent/:id — Get single consent
    router.get('/v1/consent/:id', requireAuth(), async (req, res) => {
        const id = req.params.id as string;
        const consent = await storage.getConsent(id);

        if (!consent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Consent not found: ${id}`));
            return;
        }

        if (consent.ownerGaii !== req.auth!.sub && !req.auth!.roles.includes('operator')) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not own this consent record'));
            return;
        }

        res.json(success(config.nodeId, {
            id: consent.id,
            data_pattern: consent.dataPattern,
            recipient: consent.recipient,
            purpose: consent.purpose,
            scope: consent.scope,
            expires: consent.expires,
            status: consent.status,
            granted_at: consent.grantedAt,
            revoked_at: consent.revokedAt,
            metadata: consent.metadata,
        }, [
            { description: 'Revoke this consent', method: 'DELETE', url: `/v1/consent/${consent.id}` },
            { description: 'List all consents', method: 'GET', url: '/v1/consent' },
        ]));
    });

    // DELETE /v1/consent/:id — Revoke consent (soft-delete: sets status to 'revoked')
    router.delete('/v1/consent/:id', requireAuth(), async (req, res) => {
        const id = req.params.id as string;
        const consent = await storage.getConsent(id);

        if (!consent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Consent not found: ${id}`));
            return;
        }

        if (consent.ownerGaii !== req.auth!.sub) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the consent owner can revoke'));
            return;
        }

        const now = new Date().toISOString();
        await storage.updateConsent(id, { status: 'revoked', revokedAt: now });

        stats?.increment('consent_revocations');

        res.json(success(config.nodeId, {
            status: 'revoked',
            consent_id: id,
            revoked_at: now,
        }, [
            { description: 'List all consents', method: 'GET', url: '/v1/consent' },
            { description: 'Audit log', method: 'GET', url: '/v1/consent/audit' },
        ]));
    });

    return router;
}
