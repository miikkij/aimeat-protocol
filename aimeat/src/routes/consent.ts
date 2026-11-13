/**
 * @file src/routes/consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-11-14 — GET /v1/consent/:id reads through consentRecordFor (services/consent/consent-read.ts),
 *     which the consent-record MCP resource now asks too (structure programme 2026-11, unit 2b, B13).
 *   2026-11-09 — Additive query parameters for the Data Wallet trail read by day: GET /v1/data-wallet
 *     takes group_limit, today_from and yesterday_from; GET /v1/consent/audit takes from, to and
 *     grouped=true (the groups of the window, paged by limit and offset).
 *   2026-11-08 — POST /v1/consent passes `role` (read | write) to the service, which refuses write
 *     where no write check reads it; the purpose text no longer decides write access.
 *   2026-10-15 — POST /v1/consent stamps how the consent was given (web form for the person, API call
 *     by an agent or app), which the consent receipt reads (feature-list audit #161).
 *   v1.3.0 — 2026-10-15 — The owner in person lists, reads and revokes the consents their agents filed
 *     on this route (listAccountConsents, accountHoldsConsent); an agent's consent stays under its own
 *     GAII, where the access checks read it (feature-list audit 40).
 *   v1.2.0 — 2026-10-12 — POST /v1/consent no longer defaults the reach to `federation` here: the
 *     service decides it by version, and `private`/`dmz` are answered as `local` (Core 2026-11 AUTHZ-18).
 *   v1.1.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import type { StatsCollector } from '../services/stats.js';
import { emitChange } from '../services/event-bus.js';
import { ConsentCreateSchema, validateBody } from '../models/schemas.js';
import { resolveIdentity } from '../utils/gaii.js';
import { grantConsent, revokeConsent, listAccountConsents } from '../services/consent-write.js';
import { consentRecordFor } from '../services/consent/consent-read.js';
import { getPendingConsentAudit } from '../services/consent-audit-buffer.js';
import { createDataWalletService } from '../services/db/data-wallet-db-service.js';
import { callerOf } from '../middleware/caller.js';
import { consentCollectionMethod } from '../services/mydata-receipt.js';
import { auditWithin, groupConsentAudit } from '../services/consent-audit-groups.js';

/** A query value that parses as a time, as ISO; anything else is absent. */
function isoParam(v: unknown): string | undefined {
    if (typeof v !== 'string' || !v) return undefined;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

export function consentRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector, onDirectoryChange?: () => void): Router {
    const router = Router();
    // A consent covers the data of the identity it is filed under, because every access check reads
    // the consents of the data's owner. An agent's consent on this route covers the agent's own data
    // and stays under its GAII (decision 2026-10-02, consent stays per agent); the owner in person
    // lists, reads and revokes it through listAccountConsents and accountHoldsConsent. The owner got
    // 403 on it and did not see it in the list (feature-list audit 40).
    const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

    // POST /v1/consent — Create a new consent grant
    router.post('/v1/consent', requireAuth(), requireScope('consent:manage'), validateBody(ConsentCreateSchema, config.nodeId), async (req, res) => {
        const ownerGaii = resolve(req);
        const {
            data_pattern,
            recipient,
            purpose,
            // Absent: the service gives the running version's default reach (Core 2026-11 AUTHZ-18).
            scope,
            expires = null,
            metadata,
            // read (absent) or write; the service decides where write is possible (consentWsRole).
            role,
        } = req.body ?? {};

    // ONE implementation (services/consent-write.ts): the recipient shapes, the quota, the record,
    // the audit entry and the directory refresh. The MCP tool calls the same function, which is how
    // it stopped accepting recipients nothing matches and started leaving an audit trail.
    const granted = await grantConsent({ storage, config, onDirectoryChange }, {
      ownerGaii,
      scopes: req.auth!.scopes ?? [],
      roles: req.auth!.roles,
      // How it was given, for the consent receipt (feature-list audit #161).
      collectionMethod: consentCollectionMethod('rest', callerOf(req, config.nodeId, storage)),
    }, { recipient, dataPattern: data_pattern, purpose, scope, expires, metadata, role });
    if (!granted.ok) {
      res.status(granted.status).json(error(config.nodeId, granted.code, granted.message));
      return;
    }
    const consent = granted.value;

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
        emitChange('consent');
    });

    // GET /v1/consent — List own consents
    // GET /v1/data-wallet — the Data Wallet tab mount in ONE call: consents + audit (incl. pending buffer)
    // + permission summary. Folds GET /v1/consent + /v1/consent/audit + /v1/permissions/summary, reading
    // the consent list once and counting memory via metadata only. Same gate as the folded reads.
    const dataWalletDb = createDataWalletService(storage);
    router.get('/v1/data-wallet', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
        const entryLimit = req.query.entry_limit ? Math.max(0, Math.min(1000, parseInt(req.query.entry_limit as string, 10) || 0)) : 20;
        // Additive: group_limit caps audit.groups; today_from + yesterday_from (the reader's own
        // midnights) add audit.buckets. Without them the answer is what it always was.
        const groupLimit = req.query.group_limit !== undefined ? Math.max(0, Math.min(1000, parseInt(req.query.group_limit as string, 10) || 0)) : undefined;
        const todayFrom = isoParam(req.query.today_from);
        const yesterdayFrom = isoParam(req.query.yesterday_from);
        const data = await dataWalletDb.overview(resolve(req), days, entryLimit, { groupLimit, todayFrom, yesterdayFrom });
        res.json(success(config.nodeId, data));
    });

    router.get('/v1/consent', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const ownerGaii = resolve(req);
        const opts: { status?: 'active' | 'revoked' | 'expired'; recipient?: string } = {};

        if (req.query.status) {
            opts.status = req.query.status as 'active' | 'revoked' | 'expired';
        }
        if (req.query.recipient) {
            opts.recipient = req.query.recipient as string;
        }

        const consents = await listAccountConsents(storage, ownerGaii, opts);

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
        let entries = [...pending, ...stored];

        // The rows of ONE group of the Data Wallet page (who × what): the accessor filter above plus
        // the key's prefix, and a page of them. The composite (GET /v1/data-wallet) serves the groups.
        const keyPrefix = typeof req.query.key_prefix === 'string' ? req.query.key_prefix : '';
        if (keyPrefix) entries = entries.filter(e => e.memoryKey.startsWith(keyPrefix));
        // One day bucket of the page: the rows in [from, to).
        entries = auditWithin(entries, isoParam(req.query.from), isoParam(req.query.to));
        const total = entries.length;
        const limit = req.query.limit ? Math.max(0, Math.min(1000, parseInt(req.query.limit as string, 10) || 0)) : 0;
        const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string, 10) || 0) : 0;

        // grouped=true: the groups of these rows instead of the rows, and limit/offset page the groups.
        if (req.query.grouped === 'true') {
            const groups = groupConsentAudit(entries.filter(e => e.action !== 'grant' && e.action !== 'revoke'));
            res.json(success(config.nodeId, {
                entries: [],
                total,
                period_days: days,
                groups: limit || offset ? groups.slice(offset, limit ? offset + limit : undefined) : groups,
                group_total: groups.length,
                ...(limit || offset ? { limit, offset } : {}),
            }));
            return;
        }
        if (limit || offset) entries = entries.slice(offset, limit ? offset + limit : undefined);

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
            total,
            period_days: days,
            ...(limit || offset ? { limit, offset } : {}),
        }));
    });

    // GET /v1/consent/:id — Get single consent
    router.get('/v1/consent/:id', requireAuth(), requireScope('consent:manage'), async (req, res) => {
        const id = req.params.id as string;
        // Another person's record: the operator's pass (operatorOverride) admits the operator and the
        // operator's agent holding operator:admin, and writes the operator trail. The same function
        // answers the consent-record MCP resource.
        const read = await consentRecordFor(storage, config, callerOf(req, config.nodeId, storage), id, 'principal');

        if (read.status === 'missing') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Consent not found: ${id}`));
            return;
        }
        if (read.status === 'refused') {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You do not own this consent record'));
            return;
        }
        const consent = read.record;

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
    // Same function: it owns the ownership check, the audit entry and the directory refresh.
    const revoked = await revokeConsent({ storage, config, onDirectoryChange }, {
      ownerGaii: resolve(req),
      scopes: req.auth!.scopes ?? [],
      roles: req.auth!.roles,
    }, id);
    if (!revoked.ok) {
      res.status(revoked.status).json(error(config.nodeId, revoked.code, revoked.message));
      return;
    }
    const now = revoked.value.revokedAt;

    stats?.increment('consent_revocations');

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
