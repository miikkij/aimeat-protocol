/**
 * @file src/routes/admin-features.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-only admin API surface — GHII user administration, email/notification
 *   templates and sending, directory rebuild, push config, and genesis
 *   peering management. All routes gated by requireAuth() + requireRole('operator').
 *
 * @structure
 *   - adminFeaturesRouter(config, storage, services): mounts /v1/admin/* routes
 *   - handle(): DRY try/catch wrapper returning a standard 500 envelope
 *   - Route groups: GHII users, notification templates, directory, push, genesis peering
 *
 * @version-history
 *   v1.2.0 — 2026-09-09 — GET /v1/admin/marketplace deleted: it read a table nothing writes and
 *     answered total 0 on every node, and the admin view fetched it without rendering it.
 *   v1.1.0 — 2026-09-08 — The GHII CORS write goes through services/cors-overview.ts (setCorsList),
 *     the one implementation the aimeat_admin_cors_set tool calls too.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { setCorsList } from '../services/cors-overview.js';
import type { EmailService } from '../services/email.js';
import { verificationEmailHtml, magicLinkEmailHtml, notificationEmailHtml } from '../services/email-templates.js';
import { emailReach } from '../services/email-recipients.js';
import { getStats } from '../services/stats.js';
import type { DirectoryService } from '../services/directory.js';
import type { PushService } from '../services/push.js';
import type { GenesisPeeringService } from '../services/genesis-peering.js';
import { TEMPLATE_IDS, SUPPORTED_LOCALES, getDefaultTemplate, seedDefaultTemplates } from '../services/notification-templates.js';
import type { TemplateId } from '../services/notification-templates.js';
import { LOCALES } from '../i18n.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function adminFeaturesRouter(
    config: AimeatConfig,
    storage: Storage,
    services: {
        emailService: EmailService;
        directoryService: DirectoryService;
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
            ghii_users: users.map(u => {
                let maskedEmail: string | null = null;
                if (u.notificationEmail) {
                    const [local, domain] = u.notificationEmail.split('@');
                    maskedEmail = (local?.[0] ?? '') + '***@' + (domain ?? '');
                }
                return {
                    ghii: u.ghii,
                    username: u.username,
                    display_name: u.displayName,
                    verification_level: u.verificationLevel,
                    totp_enabled: u.totpEnabled,
                    email_hash: u.emailHash ?? null,
                    email_verified: !!u.emailVerifiedAt,
                    masked_email: maskedEmail,
                    owner_name: u.ownerName,
                    allowed_origins: u.allowedOrigins ?? null,
                    last_login_at: u.lastLoginAt ?? null,
                    login_count: u.loginCount ?? 0,
                    created_at: u.createdAt,
                    updated_at: u.updatedAt,
                };
            }),
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

    router.delete('/v1/admin/ghii/:ghii/email', ...auth, handle(async (req, res) => {
        const ghii = param(req.params.ghii);
        const updated = await storage.updateGHII(ghii, {
            emailHash: null as unknown as string,
            emailVerifiedAt: null as unknown as string,
            notificationEmail: null as unknown as string,
            verificationLevel: 0,
        });
        if (!updated) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII not found: ${ghii}`));
            return;
        }
        res.json(success(config.nodeId, { deleted: true, ghii }));
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

    // PUT /v1/admin/ghii/:ghii/cors — Operator sets/clears CORS for any GHII user. The check, the
    // write and the change event live in services/cors-overview.ts, which aimeat_admin_cors_set
    // calls too; the door here refuses a missing person before anything is checked, as it always has.
    router.put('/v1/admin/ghii/:ghii/cors', ...auth, handle(async (req, res) => {
        const ghii = param(req.params.ghii);
        const record = await storage.getGHII(ghii);
        if (!record) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `GHII not found: ${ghii}`));
            return;
        }
        const r = await setCorsList(storage, config, ghii, (req.body ?? {}).allowed_origins);
        if (!r.ok) {
            res.status(r.code === 'NOT_FOUND' ? 404 : r.code === 'INVALID_INPUT' ? 400 : 500).json(error(config.nodeId, r.code, r.message));
            return;
        }
        res.json(success(config.nodeId, { ghii: r.kind === 'person' ? r.ghii : ghii, allowed_origins: r.allowed_origins }));
    }));

    // ── Email Status ────────────────────────────────────────

    /**
     * What the node has actually sent, from the counters services/email.ts already writes.
     *
     * The messages themselves are not kept, but every send, failure and retry is counted by type
     * (email_sent:verification and so on), and the Email page is the one screen where an operator
     * asks the question those counters answer. A type that has never been sent is absent from the
     * snapshot rather than zero, which is why `by_type` is passed through as it comes.
     */
    function emailCounts() {
        const snap = getStats()?.snapshot() as Record<string, unknown> | undefined;
        if (!snap) return { total: 0, failed: 0, retried: 0, last_7_days: 0, by_type: {}, counted: false };

        const daily = (snap.daily_history ?? {}) as Record<string, Record<string, number>>;
        const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
        let last7 = 0;
        for (const [day, counters] of Object.entries(daily)) {
            if (day < from) continue;
            for (const [key, value] of Object.entries(counters)) {
                if (key === 'email_sent' || key.startsWith('email_sent:')) last7 += value;
            }
        }
        return {
            total: Number(snap.email_sent ?? 0),
            failed: Number(snap.email_failed ?? 0),
            retried: Number(snap.email_retried ?? 0),
            last_7_days: last7,
            by_type: (snap.email_sent_by_type ?? {}) as Record<string, number>,
            counted: true,
        };
    }

    router.get('/v1/admin/email/status', ...auth, handle(async (_req, res) => {
        // The reach is read here so the page can say how many people a group send would go to
        // BEFORE it is pressed; the send itself uses the same function (services/email-recipients).
        const reach = await emailReach(storage);
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
            recipients: {
                accounts: reach.accounts,
                with_address: reach.all.length,
                operators: reach.operatorAccounts,
                operators_with_address: reach.operators.length,
            },
            sent: emailCounts(),
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
        // The request is judged before the service state: a group that does not exist is a bad
        // request whether or not this node can send, and answering EMAIL_DISABLED to it sends the
        // caller to fix the wrong thing.
        if (group !== 'operators' && group !== 'all') {
            res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'group must be "operators" or "all"'));
            return;
        }
        if (!services.emailService.enabled) {
            res.status(400).json(error(config.nodeId, 'EMAIL_DISABLED', 'Email service is not configured'));
            return;
        }
        // The same count the status route prints on the button, from the same function.
        const reach = await emailReach(storage);
        const recipients = group === 'operators' ? reach.operators : reach.all;
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

    // POST /v1/admin/email/templates/seed — Seed the defaults for every shipped language into memory
    // NOTE: static routes MUST be before parameterized /:id routes
    router.post('/v1/admin/email/templates/seed', ...auth, handle(async (_req, res) => {
        let count = 0;
        for (const locale of LOCALES) {
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
        const validIds = ['verification', 'magic_link', 'notification'];
        for (const locale of LOCALES) {
            for (const id of validIds) {
                await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/html`);
                await storage.deleteMemory('__site__', `_email_tpl/${id}/${locale}/text`);
            }
        }
        let count = 0;
        for (const locale of LOCALES) {
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

        const validIds = ['verification', 'magic_link', 'notification'];
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
            url: '/v1/admin?tab=push',
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
