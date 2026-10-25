/**
 * @file src/routes/admin-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-only admin config API. Exposes the node's configuration schema
 *   (types, ranges, descriptions, provenance/source, editability) and applies mutations to
 *   persistable fields, integrating with Consul-sourced values and provenance tracking.
 *
 *   SEALED PATHS. On a node one party runs on behalf of another, the host nominates settings the
 *   operator may read and may not change (services/config-sealing.ts). Here that means: the value
 *   stays VISIBLE on GET, marked `sealed`, and every write door refuses it. The refusal names the
 *   setting and says who set it, because the person reading it is a customer looking at their own
 *   admin screen and a bare 403 reads as a bug in our software.
 *
 * @structure
 *   - adminConfigRouter(config, storage, provenance?, consulService?): builds the router
 *   - GET /v1/admin/config: dynamic schema from CONFIG_FIELDS incl. secret "_configured" flags
 *   - mutation routes: validate + persist mutable config, emit change events
 *
 * @version-history
 *   2026-10-25 -- GET's list and PUT's checks moved to services/config-admin-view.ts unchanged, so the
 *     MCP tools aimeat_admin_config and aimeat_admin_config_set read and change settings through the
 *     same code. GET serves `appliesAt: 'restart'` on a row that takes effect at the next start and
 *     `set_path` on a secret the operator may set; PUT's note names the rows that wait for a restart.
 *     The Consul import stores such a row and answers it in `at_restart`, leaving the running value.
 *   2026-10-18 -- classification.mode moved from off makes the default caps offer of a node that ran
 *     before, when it waits (services/classification/default-caps.ts, plan doc-mvdipuyqraas, L5.1).
 *   2026-10-16 -- A setting changed (PUT) or a database override removed (DELETE) writes the operator
 *     trail: a usage row in the operator's own stream naming the paths, and a log line. Never a value
 *     (QA audit E2-04).
 *   v1.9.0 -- 2026-10-11 -- GET serves `rangeKind` on a number field with a range: `limit` when a
 *     larger value is refused, `recommended` when it is accepted (rangeKindOf). GET serves
 *     `restartPending` on a field whose database override was removed since start: its value is
 *     still the removed one until a restart.
 *   v1.8.0 -- 2026-10-09 -- POST /v1/admin/consul/export leaves the secret rows out unless the body
 *     says include_secrets: true, and answers secrets_skipped (services/consul-export.ts, shared with
 *     the CLI); the Consul import stores a secret row encrypted (secrets audit 2026-10-09, S3, S4b).
 *   v1.7.0 -- 2026-10-05 -- The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.6.0 -- 2026-09-29 -- PUT and the classification switch (classification.mode): an AI
 *     credential (a personal access token) is refused a change that turns classification off or
 *     from all to owner, before anything in the request is applied, and every applied change of the
 *     switch is kept in the classification audit log (services/classification/switch.ts).
 *   v1.5.0 -- 2026-09-29 -- GET serves a field's `choices` (the fixed values of a string setting),
 *     so the Config tab offers a pick instead of a text field.
 *   v1.4.0 -- 2026-09-24 -- PUT's loop moved to services/config-apply.ts unchanged (a second door,
 *     Themes & Styles' who-chooses, applies settings through it).
 *   v1.3.0 -- 2026-09-16 -- PUT answers a secret field (adminDisplay configured) with
 *     `{ configured }` in old_value and new_value, not the value. It returned the old value raw,
 *     and on aimeat.io that was the OpenRouter key the environment injected. GET marks a sealed
 *     secret's `_configured` row as sealed.
 *   v1.2.0 -- 2026-09-06 -- Review item 4.1: the DURABLE write goes first and the live one only if
 *     it took. A failed persist went to console.warn -- not the logger -- while the loop carried
 *     on, the path went into `applied`, and the answer said "Changes survive restart".
 *   (2026-08-28) Reads and writes a row's value through readConfigField / writeConfigField, so the
 *     site-link rows (siteLinks.<name>) resolve one level down like every other row.
 *   v1.1.0 — 2026-08-18 — Sealed configuration on all four doors: GET reports `sealed`, PUT and
 *     DELETE refuse with 403 SEALED_CONFIG, and the Consul export stops pushing a sealed value
 *     into a KV store where it would look editable. PUT refuses the WHOLE request when any path
 *     in it is sealed, before applying any of it: partial application across a security boundary
 *     leaves the operator working out which three of their four changes landed.
 *     https://aimeat-pages.apps.aimeat.io/#org=fbb51de5-56d5-4143-9871-b998a1187655&ws=ws-mq664uyfz21&doc=doc-mv44mc35csxm
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { MUTABLE_CONFIG_MAP, DOT_PATH_TO_ENV } from '../services/config-schema.js';
import { planConsulExport } from '../services/consul-export.js';
import { sealSettingForStorage } from '../services/config-at-rest-rows.js';
import { buildConfigView, changeNodeSettings } from '../services/config-admin-view.js';
import { isSealed, sealRefusal } from '../services/config-sealing.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import { applyConsulValues } from '../services/consul-config.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { recordOperatorNodeAct } from '../services/operator-access-audit.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';

export function adminConfigRouter(
    config: AimeatConfig,
    storage: Storage,
    provenance?: ConfigProvenance,
    consulService?: ConsulConfigService | null,
): Router {
    const router = Router();

    // GET /v1/admin/config — full config schema with types, ranges, descriptions (§14.2)
    // Schema is built dynamically from the shared CONFIG_FIELDS definitions
    // The list is built in services/config-admin-view.ts, which aimeat_admin_config reads too.
    router.get('/v1/admin/config', requireAuth(), requireOperator(storage), async (req, res) => {
        const section = typeof req.query.section === 'string' ? req.query.section : undefined;
        const q = typeof req.query.q === 'string' ? req.query.q : undefined;
        res.json(success(config.nodeId, buildConfigView({ config, storage, provenance }, { section, q })));
    });
    // PUT /v1/admin/config — atomic config update with dot-path addressing (§14.2, Appendix B)
    // Body format: {"changes": [{"path": "morsel_policy.daily_allowance", "value": 75}, ...]}
    // Mutable field lookup comes from the shared config-schema module (single source of truth)
    router.put('/v1/admin/config', requireAuth(), requireOperator(storage), async (req, res) => {
        // The checks and the apply loop are in services/config-admin-view.ts, which
        // aimeat_admin_config_set calls too: sealed paths and the classification switch are refused
        // before anything in the request is applied.
        const r = await changeNodeSettings({ config, storage, provenance }, req.auth!, req.body?.changes);
        if (!r.ok) {
            res.status(r.status).json(error(config.nodeId, r.code, r.message, undefined, r.details,
                r.sealed ? [{ description: 'Ask whoever runs this node to change it.', method: 'GET', url: '/v1/admin/config' }] : undefined));
            return;
        }
        res.json(success(config.nodeId, { applied: r.applied, errors: r.errors, note: r.note }));
    });

    // DELETE /v1/admin/config/:path — remove a DB override (revert to file/env/default)
    router.delete('/v1/admin/config/:path', requireAuth(), requireOperator(storage), async (req, res) => {
        if (!storage.supportsConfigPersistence()) {
            res.status(403).json(error(config.nodeId, 'READONLY_CONFIG',
                'Config persistence not available with in-memory storage.'));
            return;
        }

        const path = req.params.path as string;
        // Removing a DB override moves the value back to whatever env/file says, so it is a write,
        // and it is refused before storage is touched.
        if (isSealed(config, path)) {
            const refusal = sealRefusal(path);
            res.status(403).json(error(config.nodeId, refusal.code, refusal.message, undefined, undefined,
                [{ description: 'Ask whoever runs this node to change it.', method: 'GET', url: '/v1/admin/config' }]));
            return;
        }
        const field = MUTABLE_CONFIG_MAP[path];
        if (!field) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND',
                `Unknown or immutable config path: ${path}`));
            return;
        }

        await storage.deleteConfigValue(path);
        const actorGaii = resolveIdentity(req.auth!, config.nodeId);
        recordOperatorNodeAct({ operatorGhii: ownerGhiiOf(actorGaii), actorGaii, area: 'config', action: 'reset', meta: { paths: path, count: 1 } });

        // Recalculate provenance for this field
        if (provenance) {
            const envVarName = DOT_PATH_TO_ENV[path];
            const envExists = envVarName ? process.env[envVarName] !== undefined : false;
            // File/consul checks are simplified — full detection added with file/consul wiring
            provenance.revertSource(path, envExists, false, false);
        }

        res.json(success(config.nodeId, {
            deleted: path,
            newSource: provenance?.getSource(path) ?? 'default',
            note: 'DB override removed. Value reverts to file/env/default on next restart.',
        }));
        emitChange('config');
    });

    // ── Consul Integration Endpoints ──

    // GET /v1/admin/consul — Consul connection status and key listing
    router.get('/v1/admin/consul', requireAuth(), requireOperator(storage), async (_req, res) => {
        if (!consulService) {
            res.json(success(config.nodeId, {
                enabled: false,
                note: 'Consul integration is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL, or use --consul flag.',
            }));
            return;
        }

        const healthy = await consulService.health();
        const values = await consulService.loadAll();

        res.json(success(config.nodeId, {
            enabled: true,
            url: config.consulUrl,
            prefix: config.consulPrefix,
            healthy,
            key_count: Object.keys(values).length,
            keys: Object.keys(values),
            watch_interval_seconds: config.consulWatchIntervalSeconds,
        }));
    });

    // POST /v1/admin/consul/export — push current mutable config to Consul KV
    router.post('/v1/admin/consul/export', requireAuth(), requireOperator(storage), async (req, res) => {
        if (!consulService) {
            res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
            return;
        }

        // A sealed value is left out (it looks editable in KV and is discarded on import), and so
        // is a secret row unless the operator sends include_secrets: true (secrets audit
        // 2026-10-09, S3): services/consul-export.ts, the same plan the CLI uses.
        const plan = planConsulExport(config, { includeSecrets: req.body?.include_secrets === true });
        let exported = 0;
        for (const { path, value } of plan.entries) {
            try {
                await consulService.set(path, value);
                exported++;
            } catch (err) { logger.warn('value: skip individual failures', { error: String(err) }); }
        }

        res.json(success(config.nodeId, {
            exported, total: plan.total,
            ...(plan.sealedSkipped > 0 ? { sealed_skipped: plan.sealedSkipped } : {}),
            ...(plan.secretsSkipped > 0 ? { secrets_skipped: plan.secretsSkipped } : {}),
        }));
        emitChange('config');
    });

    // POST /v1/admin/consul/import — pull config from Consul KV and apply to runtime + DB
    router.post('/v1/admin/consul/import', requireAuth(), requireOperator(storage), async (_req, res) => {
        if (!consulService) {
            res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
            return;
        }

        const values = await consulService.loadAll();
        // applyConsulValues drops sealed paths itself (it is also the boot loader and the watch
        // callback), so `applied` cannot contain one and nothing sealed reaches the database here.
        // The node is running, so a row read once at start is stored and waits for the next start.
        const { applied, sealed, atRestart } = applyConsulValues(config, values, { running: true });

        // Persist to DB if available
        if (storage.supportsConfigPersistence()) {
            for (const dotPath of [...applied, ...atRestart]) {
                // A secret row is stored encrypted, as PUT stores it (services/config-at-rest.ts).
                await storage.setConfigValue(dotPath, sealSettingForStorage(dotPath, values[dotPath], config));
            }
            if (provenance) { provenance.markDatabase(applied); provenance.markDatabaseAtRestart(atRestart); }
        } else if (provenance) provenance.markConsulAtRestart(atRestart);

        res.json(success(config.nodeId, {
            imported: applied.length + atRestart.length, total: Object.keys(values).length,
            ...(atRestart.length > 0 ? { at_restart: atRestart } : {}),
            ...(sealed.length > 0 ? { sealed } : {}),
        }));
        emitChange('config');
    });

    return router;
}
