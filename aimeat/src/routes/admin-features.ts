import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import type { EmailService } from '../services/email.js';
import { verificationEmailHtml, magicLinkEmailHtml, notificationEmailHtml, matchSuggestionEmailHtml } from '../services/email-templates.js';
import type { DirectoryService } from '../services/directory.js';
import type { MatchingEngine } from '../services/matching.js';
import type { PushService } from '../services/push.js';
import type { GenesisPeeringService } from '../services/genesis-peering.js';
import { TEMPLATE_IDS, SUPPORTED_LOCALES, getDefaultTemplate, seedDefaultTemplates } from '../services/notification-templates.js';
import type { TemplateId } from '../services/notification-templates.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function adminFeaturesRouter(
    config: AimeatConfig,
    storage: Storage,
    services: {
        emailService: EmailService;
        directoryService: DirectoryService;
        matchingEngine: MatchingEngine;
        pushService: PushService;
        genesisPeeringService: GenesisPeeringService;
    },
): Router {
    const router = Router();
    const auth = [requireAuth(), requireRole('operator')] as const;

    /** DRY wrapper – catches errors and returns a standard 500 envelope. */
    const handle = (handler: (req: Request, res: Response) => Promise<void>) =>
        async (req: Request, res: Response) => {
            try {
                await handler(req, res);
            } catch (err) {
                res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
            }
        };

    // ── GHII Users ──────────────────────────────────────────

    router.get('/v1/admin/ghii', ...auth, handle(async (_req, res) => {
        const users = await storage.listGHIIs();
        res.json(success(config.nodeId, {
            ghii_users: users.map(u => ({
                ghii: u.ghii,
                username: u.username,
                display_name: u.displayName,
                verification_level: u.verificationLevel,
                totp_enabled: u.totpEnabled,
                email_hash: u.emailHash ?? null,
                owner_name: u.ownerName,
                allowed_origins: u.allowedOrigins ?? null,
                created_at: u.createdAt,
                updated_at: u.updatedAt,
            })),
            total: users.length,
        }));
    }));

    router.put('/v1/admin/ghii/:ghii', ...auth, handle(async (req, res) => {
        const ghii = param(req.params.ghii);
        const { verificationLevel } = req.body ?? {};

        if (verificationLevel === undefined || typeof verificationLevel !== 'number' || ![0, 1, 2].includes(verificationLevel)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'verificationLevel must be 0, 1, or 2'));
            return;
        }

        const updated = await storage.updateGHII(ghii, { verificationLevel: verificationLevel as 0 | 1 | 2 | 3 });
        if (!updated) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII not found: ${ghii}`));
            return;
        }

        res.json(success(config.nodeId, { ghii_user: updated }));
        emitChange('features');
    }));

    router.delete('/v1/admin/ghii/:ghii', ...auth, handle(async (req, res) => {
        const ghii = param(req.params.ghii);
        const deleted = await storage.deleteGHII(ghii);
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII not found: ${ghii}`));
            return;
        }
        res.json(success(config.nodeId, { deleted: true, ghii }));
        emitChange('features');
    }));

    // PUT /v1/admin/ghii/:ghii/cors — Operator sets/clears CORS for any GHII user
    router.put('/v1/admin/ghii/:ghii/cors', ...auth, handle(async (req, res) => {
        const ghii = param(req.params.ghii);
        const record = await storage.getGHII(ghii);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII not found: ${ghii}`));
            return;
        }

        const { allowed_origins } = req.body ?? {};
        if (allowed_origins !== null && !Array.isArray(allowed_origins)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'allowed_origins must be an array of origin URLs or null to clear'));
            return;
        }
        if (Array.isArray(allowed_origins)) {
            for (const origin of allowed_origins) {
                if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid origin: ${origin}. Must be an http(s) URL or '*'`));
                    return;
                }
            }
        }

        const updated = await storage.updateGHII(ghii, {
            allowedOrigins: allowed_origins === null ? undefined : allowed_origins,
        });
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update CORS settings'));
            return;
        }
        res.json(success(config.nodeId, {
            ghii: updated.ghii,
            allowed_origins: updated.allowedOrigins ?? null,
        }));
        emitChange('features');
    }));

    // ── Email Status ────────────────────────────────────────

    router.get('/v1/admin/email/status', ...auth, handle(async (_req, res) => {
        res.json(success(config.nodeId, {
            enabled: config.emailEnabled,
            smtp_host: config.smtpHost,
            smtp_port: config.smtpPort,
            smtp_from: config.smtpFrom,
            smtp_secure: config.smtpSecure,
            smtp_reject_unauthorized: config.smtpRejectUnauthorized,
            confirmation_required: config.emailConfirmationRequired,
            smtp_user_configured: !!config.smtpUser,
            smtp_pass_configured: !!config.smtpPass,
        }));
    }));

    router.post('/v1/admin/email/test', ...auth, handle(async (req, res) => {
        const { to, template, locale: loc } = req.body ?? {};
        if (!to || typeof to !== 'string') {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'to (email address) is required'));
            return;
        }
        if (!services.emailService.enabled) {
            res.status(400).json(error(config.nodeId, 'EMAIL_DISABLED', 'Email service is not configured'));
            return;
        }
        const tplLocale = loc || 'en';
        let subject: string;
        let html: string;
        let text: string;
        switch (template) {
            case 'verification': {
                const r = verificationEmailHtml('123456', tplLocale);
                subject = 'AIMEAT Test — Verification Code'; html = r.html; text = r.text; break;
            }
            case 'magic_link': {
                const r = magicLinkEmailHtml('https://example.com/login?token=sample', tplLocale);
                subject = 'AIMEAT Test — Magic Link'; html = r.html; text = r.text; break;
            }
            case 'match_suggestion': {
                const r = matchSuggestionEmailHtml([
                    { ghii: 'gaii:example:alice', displayName: 'Alice', sharedInterests: ['hiking', 'photography'], distance: '12 km' },
                ], tplLocale);
                subject = 'AIMEAT Test — Match Suggestion'; html = r.html; text = r.text; break;
            }
            default: {
                const r = notificationEmailHtml('AIMEAT Test Email', 'This is a test email from your AIMEAT node.', tplLocale);
                subject = 'AIMEAT Test Email'; html = r.html; text = r.text; break;
            }
        }
        const sent = await services.emailService.sendRaw(to, subject, html, text);
        res.json(success(config.nodeId, { sent, template: template || 'notification' }));
        emitChange('features');
    }));

    router.post('/v1/admin/email/send-group', ...auth, handle(async (req, res) => {
        const { group, subject, body } = req.body ?? {};
        if (!subject || !body) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'subject and body are required'));
            return;
        }
        if (!services.emailService.enabled) {
            res.status(400).json(error(config.nodeId, 'EMAIL_DISABLED', 'Email service is not configured'));
            return;
        }
        const recipients: string[] = [];
        if (group === 'operators') {
            const owners = await storage.listOwners();
            const ghiis = await storage.listGHIIs();
            const operatorNames = new Set(owners.filter(o => o.roles.includes('operator')).map(o => o.name));
            for (const g of ghiis) {
                if (g.notificationEmail && operatorNames.has(g.ownerName ?? '')) {
                    recipients.push(g.notificationEmail);
                }
            }
        } else if (group === 'all') {
            const ghiis = await storage.listGHIIs();
            for (const g of ghiis) {
                if (g.notificationEmail) recipients.push(g.notificationEmail);
            }
        } else {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'group must be "operators" or "all"'));
            return;
        }
        const { html: mailHtml, text: mailText } = notificationEmailHtml(subject as string, body as string);
        let sent = 0;
        for (const addr of recipients) {
            const ok = await services.emailService.sendRaw(addr, subject as string, mailHtml, mailText);
            if (ok) sent++;
        }
        res.json(success(config.nodeId, { sent, total: recipients.length, group }));
        emitChange('features');
    }));

    /** Generate code-default templates for a given locale */
    function emailTemplateDefaults(locale: string) {
        return [
            { id: 'verification', usedIn: 'ghii', ...verificationEmailHtml('123456', locale),
              params: ['{{code}}'], paramDescriptions: { '{{code}}': 'Verification code (e.g. 123456)' } },
            { id: 'magic_link', usedIn: 'ghii', ...magicLinkEmailHtml('https://example.com/login?token=sample', locale),
              params: ['{{url}}'], paramDescriptions: { '{{url}}': 'Magic login URL' } },
            { id: 'notification', usedIn: 'system', ...notificationEmailHtml('AIMEAT Notification', 'This is a sample notification message.', locale),
              params: ['{{subject}}', '{{body}}'], paramDescriptions: { '{{subject}}': 'Notification subject', '{{body}}': 'Notification body text' } },
            { id: 'match_suggestion', usedIn: 'matching', ...matchSuggestionEmailHtml([
                { ghii: 'gaii:example:alice', displayName: 'Alice', sharedInterests: ['hiking', 'photography'], distance: '12 km' },
                { ghii: 'gaii:example:bob', displayName: 'Bob', sharedInterests: ['cooking'], distance: '5 km' },
            ], locale),
              params: ['{{matches}}'], paramDescriptions: { '{{matches}}': 'Array of match cards (name, GHII, interests, distance)' } },
        ];
    }

    /** Write a single template (html+text) to memory */
    async function writeEmailTplToMemory(id: string, locale: string, htmlContent: string, textContent: string) {
        const now = new Date().toISOString();
        const base = { ownerGaii: '__site__', visibility: 'private' as const, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
        await storage.setMemory({ ...base, key: `_email_tpl/${id}/${locale}/html`, value: htmlContent });
        await storage.setMemory({ ...base, key: `_email_tpl/${id}/${locale}/text`, value: textContent });
    }

    router.get('/v1/admin/email/templates', ...auth, handle(async (req, res) => {
        const locale = (req.query.locale as string) || 'en';
        const defaults = emailTemplateDefaults(locale);

        const templates = [];
        for (const tpl of defaults) {
            const customHtmlRec = await storage.getMemory('__site__', `_email_tpl/${tpl.id}/${locale}/html`);
            const customTextRec = await storage.getMemory('__site__', `_email_tpl/${tpl.id}/${locale}/text`);
            templates.push({
                id: tpl.id,
                usedIn: tpl.usedIn,
                preview: (customHtmlRec?.value as string | undefined) ?? tpl.html,
                text: (customTextRec?.value as string | undefined) ?? tpl.text,
                defaultHtml: tpl.html,
                defaultText: tpl.text,
                isCustom: !!(customHtmlRec || customTextRec),
                params: tpl.params,
                paramDescriptions: tpl.paramDescriptions,
            });
        }

        // Check if any templates are seeded at all
        const seeded = templates.some(t => t.isCustom);
        res.json(success(config.nodeId, { templates, locale, seeded }));
    }));

    // POST /v1/admin/email/templates/seed — Seed all defaults (en + fi) into memory
    // NOTE: static routes MUST be before parameterized /:id routes
    router.post('/v1/admin/email/templates/seed', ...auth, handle(async (_req, res) => {
        let count = 0;
        for (const locale of ['en', 'fi']) {
            const defaults = emailTemplateDefaults(locale);
            for (const tpl of defaults) {
                await writeEmailTplToMemory(tpl.id, locale, tpl.html, tpl.text);
                count++;
            }
        }
        res.json(success(config.nodeId, { seeded: true, count }));
        emitChange('features');
    }));

    // POST /v1/admin/email/templates/reset — Delete all custom, re-seed defaults
    router.post('/v1/admin/email/templates/reset', ...auth, handle(async (_req, res) => {
        const validIds = ['verification', 'magic_link', 'notification', 'match_suggestion'];
        for (const locale of ['en', 'fi']) {
            for (const id of validIds) {
                await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/html`);
                await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/text`);
            }
        }
        let count = 0;
        for (const locale of ['en', 'fi']) {
            const defaults = emailTemplateDefaults(locale);
            for (const tpl of defaults) {
                await writeEmailTplToMemory(tpl.id, locale, tpl.html, tpl.text);
                count++;
            }
        }
        res.json(success(config.nodeId, { reset: true, count }));
        emitChange('features');
    }));

    // PUT /v1/admin/email/templates/:id — Save custom template
    router.put('/v1/admin/email/templates/:id', ...auth, handle(async (req, res) => {
        const id = req.params.id as string;
        const locale = (req.body.locale as string) || 'en';
        const { html: htmlContent, text: textContent } = req.body;

        const validIds = ['verification', 'magic_link', 'notification', 'match_suggestion'];
        if (!validIds.includes(id)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid template id: ${id}`));
            return;
        }

        await writeEmailTplToMemory(id, locale, htmlContent ?? '', textContent ?? '');
        res.json(success(config.nodeId, { saved: true, id, locale }));
        emitChange('features');
    }));

    // DELETE /v1/admin/email/templates/:id — Reset single template to default
    router.delete('/v1/admin/email/templates/:id', ...auth, handle(async (req, res) => {
        const id = req.params.id as string;
        const locale = (req.query.locale as string) || 'en';

        await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/html`);
        await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/text`);

        // Re-seed this template's default
        const defaults = emailTemplateDefaults(locale);
        const tpl = defaults.find(d => d.id === id);
        if (tpl) {
            await writeEmailTplToMemory(id, locale, tpl.html, tpl.text);
        }

        res.json(success(config.nodeId, { reset: true, id, locale }));
        emitChange('features');
    }));

    // ── Directory Stats ─────────────────────────────────────

    router.get('/v1/admin/directory/stats', ...auth, handle(async (_req, res) => {
        const stats = services.directoryService.getStats();
        res.json(success(config.nodeId, stats));
    }));

    router.post('/v1/admin/directory/rebuild', ...auth, handle(async (_req, res) => {
        await services.directoryService.rebuildIndex();
        const stats = services.directoryService.getStats();
        res.json(success(config.nodeId, { rebuilt: true, stats }));
        emitChange('features');
    }));

    // ── Matching ────────────────────────────────────────────

    router.get('/v1/admin/matching', ...auth, handle(async (_req, res) => {
        res.json(success(config.nodeId, {
            enabled: config.matchingEnabled,
            interval_hours: config.matchIntervalHours,
            threshold: config.matchThreshold,
            max_suggestions: config.matchMaxSuggestions,
            max_distance_km: config.matchMaxDistanceKm,
            cooldown_days: config.matchCooldownDays,
        }));
    }));

    router.post('/v1/admin/matching/run', ...auth, handle(async (_req, res) => {
        const result = await services.matchingEngine.runMatchingRound();
        res.json(success(config.nodeId, result));
        emitChange('features');
    }));

    // ── Marketplace ─────────────────────────────────────────

    router.get('/v1/admin/marketplace', ...auth, handle(async (_req, res) => {
        const listings = await storage.listListings({});
        const byStatus: Record<string, number> = {};
        for (const l of listings) {
            byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
        }
        const recent = listings
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 20);

        res.json(success(config.nodeId, {
            enabled: config.marketplaceEnabled,
            listing_fee: config.marketplaceListingFeeMorsels,
            tx_fee_percent: config.marketplaceTransactionFeePercent,
            escrow_enabled: config.marketplaceEscrowEnabled,
            stats: {
                total: listings.length,
                by_status: byStatus,
                recent_listings: recent.map(l => ({
                    id: l.id,
                    title: l.title,
                    category: l.category,
                    price_morsels: l.priceMorsels,
                    status: l.status,
                    seller_ghii: l.sellerGhii,
                    created_at: l.createdAt,
                })),
            },
        }));
    }));

    // ── Push Notifications ──────────────────────────────────

    router.get('/v1/admin/push', ...auth, handle(async (_req, res) => {
        const subs = await storage.listPushSubscriptions();
        const templates = await storage.listNotificationTemplates();

        // Build template map: merge stored with defaults
        const templateList: Array<Record<string, unknown>> = [];
        for (const locale of SUPPORTED_LOCALES) {
            for (const id of TEMPLATE_IDS) {
                const stored = templates.find(t => t.id === id && t.locale === locale);
                const def = getDefaultTemplate(id, locale);
                templateList.push({
                    id,
                    locale,
                    fields: stored ? stored.fields : def.fields,
                    placeholders: def.placeholders,
                    is_default: !stored,
                    updated_at: stored?.updatedAt ?? null,
                    updated_by: stored?.updatedBy ?? null,
                });
            }
        }

        res.json(success(config.nodeId, {
            enabled: services.pushService.enabled,
            vapid_configured: !!config.vapidPublicKey && !!config.vapidPrivateKey,
            locales: [...SUPPORTED_LOCALES],
            total_subscriptions: subs.length,
            subscriptions: subs.map(s => ({
                owner_name: s.ownerName,
                endpoint: s.endpoint?.substring(0, 60) ?? '\u2014',
                created_at: s.createdAt,
                last_used_at: s.lastUsedAt,
            })),
            templates: templateList,
        }));
    }));

    // PUT /v1/admin/push/templates/:id/:locale — Save/update a template
    router.put('/v1/admin/push/templates/:id/:locale', ...auth, handle(async (req, res) => {
        const id = param(req.params.id);
        const locale = param(req.params.locale);
        if (!TEMPLATE_IDS.includes(id as TemplateId)) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', `Invalid template id. Valid: ${TEMPLATE_IDS.join(', ')}`));
            return;
        }
        if (!SUPPORTED_LOCALES.includes(locale as typeof SUPPORTED_LOCALES[number])) {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', `Invalid locale. Valid: ${SUPPORTED_LOCALES.join(', ')}`));
            return;
        }
        const { fields } = req.body;
        if (!fields || typeof fields.body !== 'string') {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'fields.body is required'));
            return;
        }
        const def = getDefaultTemplate(id as TemplateId, locale);
        const record = await storage.upsertNotificationTemplate({
            id,
            locale,
            fields: {
                title: typeof fields.title === 'string' ? fields.title : undefined,
                body: fields.body,
                subject: typeof fields.subject === 'string' ? fields.subject : undefined,
            },
            placeholders: def.placeholders,
            updatedAt: new Date().toISOString(),
            updatedBy: req.auth!.owner,
        });
        res.json(success(config.nodeId, { template: record }));
        emitChange('features');
    }));

    // POST /v1/admin/push/test — Send test notification to operator
    router.post('/v1/admin/push/test', ...auth, handle(async (req, res) => {
        const ownerName = req.auth!.owner;
        const ok = await services.pushService.sendNotification(ownerName, {
            title: 'AIMEAT Test',
            body: 'Push notifications are working!',
            icon: '/icons/icon-192.png',
            url: '/v1/portal',
            tag: 'test',
        });
        if (!ok) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No push subscription found for your account, or notification failed'));
            return;
        }
        res.json(success(config.nodeId, { sent: true }));
        emitChange('features');
    }));

    // POST /v1/admin/push/templates/reset — Reset all templates to defaults
    router.post('/v1/admin/push/templates/reset', ...auth, handle(async (req, res) => {
        const count = await seedDefaultTemplates(storage, req.auth!.owner);
        res.json(success(config.nodeId, { reset: true, count }));
        emitChange('features');
    }));

    // ── CSM Templates ───────────────────────────────────────

    router.get('/v1/admin/csm', ...auth, handle(async (_req, res) => {
        const csms = await storage.listCsms();
        res.json(success(config.nodeId, {
            templates: csms.map(c => ({
                name: c.name,
                service_type: c.serviceType,
                registered_by: c.registeredBy,
                registered_at: c.registeredAt,
                updated_at: c.updatedAt,
                federate: c.federate ?? false,
            })),
            total: csms.length,
        }));
    }));

    // GET /v1/admin/csm/:name — CSM detail for admin dashboard
    router.get('/v1/admin/csm/:name', ...auth, handle(async (req, res) => {
        const name = req.params.name as string;
        const csm = await storage.getCsm(name);
        if (!csm) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `CSM "${name}" not found`));
            return;
        }
        res.json(success(config.nodeId, {
            name: csm.name,
            service_type: csm.serviceType,
            json_schema_key: csm.jsonSchemaKey,
            registered_by: csm.registeredBy,
            registered_at: csm.registeredAt,
            updated_at: csm.updatedAt,
            definition: csm.definition,
            semantic: csm.semantic ?? null,
            federate: csm.federate ?? false,
        }));
    }));

    // DELETE /v1/admin/csm/:name — Delete CSM from admin dashboard
    router.delete('/v1/admin/csm/:name', ...auth, handle(async (req, res) => {
        const name = req.params.name as string;
        const csm = await storage.getCsm(name);
        if (!csm) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `CSM "${name}" not found`));
            return;
        }
        await storage.deleteSchema(csm.jsonSchemaKey);
        await storage.deleteCsm(name);
        res.json(success(config.nodeId, { deleted: true, name }));
        emitChange('features');
    }));

    // ── MSM Integrations ────────────────────────────────────

    router.get('/v1/admin/msm', ...auth, handle(async (_req, res) => {
        const msms = await storage.listMsms();
        res.json(success(config.nodeId, {
            integrations: msms.map(m => ({
                name: m.name,
                category: m.category,
                auth_type: m.authType,
                actions_count: m.actionsCount,
                registered_by: m.registeredBy,
                registered_at: m.registeredAt,
                updated_at: m.updatedAt,
                federate: m.federate ?? false,
            })),
            total: msms.length,
        }));
    }));

    // GET /v1/admin/msm/:name — MSM detail for admin dashboard
    router.get('/v1/admin/msm/:name', ...auth, handle(async (req, res) => {
        const name = req.params.name as string;
        const msm = await storage.getMsm(name);
        if (!msm) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM "${name}" not found`));
            return;
        }
        res.json(success(config.nodeId, {
            name: msm.name,
            category: msm.category,
            auth_type: msm.authType,
            actions_count: msm.actionsCount,
            registered_by: msm.registeredBy,
            registered_at: msm.registeredAt,
            updated_at: msm.updatedAt,
            federate: msm.federate ?? false,
            definition: msm.definition,
        }));
    }));

    // PUT /v1/admin/msm/:name — Update MSM metadata (description, federate)
    router.put('/v1/admin/msm/:name', ...auth, handle(async (req, res) => {
        const name = req.params.name as string;
        const msm = await storage.getMsm(name);
        if (!msm) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM "${name}" not found`));
            return;
        }

        const updates: Partial<import('../storage/interface.js').MsmRecord> = {};
        if (req.body.description !== undefined) {
            // Update description in the definition
            const def = { ...msm.definition } as Record<string, unknown>;
            if (def.service && typeof def.service === 'object') {
                (def.service as Record<string, unknown>).description = req.body.description;
            }
            updates.definition = def;
        }
        if (typeof req.body.federate === 'boolean') {
            updates.federate = req.body.federate;
        }
        updates.updatedAt = new Date().toISOString();

        const updated = await storage.updateMsm(name, updates);
        if (!updated) {
            res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update MSM'));
            return;
        }
        res.json(success(config.nodeId, {
            name: updated.name,
            category: updated.category,
            auth_type: updated.authType,
            actions_count: updated.actionsCount,
            registered_by: updated.registeredBy,
            registered_at: updated.registeredAt,
            updated_at: updated.updatedAt,
            federate: updated.federate ?? false,
        }));
        emitChange('features');
    }));

    // DELETE /v1/admin/msm/:name — Delete MSM from admin dashboard
    router.delete('/v1/admin/msm/:name', ...auth, handle(async (req, res) => {
        const name = req.params.name as string;
        const msm = await storage.getMsm(name);
        if (!msm) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `MSM "${name}" not found`));
            return;
        }
        await storage.deleteMsm(name);
        res.json(success(config.nodeId, { deleted: true, name }));
        emitChange('features');
    }));

    // ── Genesis Peers (Cross-Federation) ────────────────────

    router.get('/v1/admin/genesis-peers', ...auth, handle(async (_req, res) => {
        const peers = await storage.listGenesisPeers();
        const networkStats = await services.genesisPeeringService.getNetworkStats();
        res.json(success(config.nodeId, {
            peers: peers.map(p => ({
                id: p.id,
                genesis_node_id: p.genesisNodeId,
                genesis_url: p.genesisUrl,
                status: p.status,
                last_sync_at: p.lastSyncAt,
                created_at: p.createdAt,
                updated_at: p.updatedAt,
            })),
            total: peers.length,
            network_stats: networkStats,
        }));
    }));

    router.post('/v1/admin/genesis-peers/:id/approve', ...auth, handle(async (req, res) => {
        const id = param(req.params.id);
        const peer = await services.genesisPeeringService.approvePeering(id);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Genesis peer not found: ${id}`));
            return;
        }
        res.json(success(config.nodeId, { peer, status: 'approved' }));
        emitChange('features');
    }));

    router.post('/v1/admin/genesis-peers/:id/suspend', ...auth, handle(async (req, res) => {
        const id = param(req.params.id);
        const peer = await services.genesisPeeringService.suspendPeering(id);
        if (!peer) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Genesis peer not found: ${id}`));
            return;
        }
        res.json(success(config.nodeId, { peer, status: 'suspended' }));
        emitChange('features');
    }));

    router.delete('/v1/admin/genesis-peers/:id', ...auth, handle(async (req, res) => {
        const id = param(req.params.id);
        const deleted = await services.genesisPeeringService.removePeering(id);
        if (!deleted) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Genesis peer not found: ${id}`));
            return;
        }
        res.json(success(config.nodeId, { deleted: true, id }));
        emitChange('features');
    }));

    return router;
}
