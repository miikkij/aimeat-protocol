/**
 * @file src/routes/consent.ts
 * @description Consent-grant API — lets an owner create, list, inspect, and revoke consent records
 *   authorizing recipients (wildcard, GAII, organism, ghii, domain, node) to access data patterns.
 *   Also exposes the buffered consent-audit log. Identity resolved via resolveIdentity().
 *
 * @structure
 *   - consentRouter(config, storage, stats, onDirectoryChange): mounts the routes below
 *   - POST /v1/consent: create a grant (recipient-format + quota validation, max 100/owner)
 *   - GET /v1/consent, GET /v1/consent/:id, DELETE /v1/consent/:id: list, inspect, revoke
 *   - GET /v1/consent/audit: pending consent-audit buffer entries
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import type { StatsCollector } from '../services/stats.js';
import { emitChange } from '../services/event-bus.js';
import { ConsentCreateSchema, validateBody } from '../models/schemas.js';
import { resolveIdentity } from '../utils/gaii.js';
import { auditDataAccess } from '../services/consent.js';
import { getPendingConsentAudit } from '../services/consent-audit-buffer.js';

export function consentRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector, onDirectoryChange?: () => void): Router {
    const router = Router();
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // POST /v1/consent — Create a new consent grant
    router.post('/v1/consent', requireAuth(), requireScope('consent:manage'), validateBody(ConsentCreateSchema, config.nodeId), async (req, res) => {
        const ownerGaii = resolve(req);
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

        // Validate recipient format
        const validRecipientPatterns = [
            /^\*$/,                           // Wildcard
            /^organism\.\S+$/,                // Organism
            /^ghii:\S+@\S+$/,                // GHII user
            /^domain:\S+$/,                   // Domain glob
            /^node:\S+$/,                     // Specific node
            /^[^*][^:]*#[^@]+@.+$/,          // Specific GAII (agent#owner@node)
            /^[^#@*:]+@[^@]+$/,              // Short GAII (owner@node)
        ];
        if (!validRecipientPatterns.some(p => p.test(recipient))) {
            res.status(400).json(error(config.nodeId, 'INVALID_RECIPIENT',
                'recipient must be "*", a GAII, or prefixed with "organism.", "ghii:", "domain:", or "node:"'));
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

        // Audit the consent mutation (buffered, off the request path). Mutations + denials
        // are the only things the audit trail keeps now (allowed reads are no longer logged).
        await auditDataAccess(storage, consent.id, ownerGaii, consent.recipient, consent.dataPattern, 'grant', true);

        // Notify directory of federation consent changes (Phase 1.4 — event-driven refresh)
        if (consent.scope === 'federation' && onDirectoryChange) {
            onDirectoryChange();
        }

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
        emitChange('consent');
    });

    // GET /v1/consent — List own consents
    router.get('/v1/consent', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const ownerGaii = resolve(req);
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
    router.get('/v1/consent/audit', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const ownerGaii = resolve(req);
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
        const opts: { days?: number; accessorGaii?: string; consentId?: string } = { days };

        if (req.query.accessor_gaii) {
            opts.accessorGaii = req.query.accessor_gaii as string;
        }
        if (req.query.consent_id) {
            opts.consentId = req.query.consent_id as string;
        }

        // Merge not-yet-flushed buffer entries (newest first) ahead of the persisted rows so
        // a just-made denial/mutation is visible immediately (writes are batched off the
        // request path — see consent-audit-buffer.ts).
        const pending = getPendingConsentAudit(ownerGaii, opts)
            .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
        const stored = await storage.listConsentAudit(ownerGaii, opts);
        const entries = [...pending, ...stored];

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
    router.get('/v1/consent/:id', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const id = req.params.id as string;
        const consent = await storage.getConsent(id);

        if (!consent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Consent not found: ${id}`));
            return;
        }

        if (consent.ownerGaii !== resolve(req) && !req.auth!.roles.includes('operator')) {
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
    router.delete('/v1/consent/:id', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const id = req.params.id as string;
        const consent = await storage.getConsent(id);

        if (!consent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Consent not found: ${id}`));
            return;
        }

        if (consent.ownerGaii !== resolve(req)) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the consent owner can revoke'));
            return;
        }

        const now = new Date().toISOString();
        await storage.updateConsent(id, { status: 'revoked', revokedAt: now });

        stats?.increment('consent_revocations');

        // Audit the consent mutation (buffered, off the request path).
        await auditDataAccess(storage, id, consent.ownerGaii, consent.recipient, consent.dataPattern, 'revoke', true);

        // Notify directory of federation consent revocation (Phase 1.4 — event-driven refresh)
        if (consent.scope === 'federation' && onDirectoryChange) {
            onDirectoryChange();
        }

        res.json(success(config.nodeId, {
            status: 'revoked',
            consent_id: id,
            revoked_at: now,
        }, [
            { description: 'List all consents', method: 'GET', url: '/v1/consent' },
            { description: 'Audit log', method: 'GET', url: '/v1/consent/audit' },
        ]));
        emitChange('consent');
    });

    return router;
}
