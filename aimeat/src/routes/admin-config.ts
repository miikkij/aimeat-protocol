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
 *   v1.1.0 — 2026-08-18 — Sealed configuration on all four doors: GET reports `sealed`, PUT and
 *     DELETE refuse with 403 SEALED_CONFIG, and the Consul export stops pushing a sealed value
 *     into a KV store where it would look editable. PUT refuses the WHOLE request when any path
 *     in it is sealed, before applying any of it: partial application across a security boundary
 *     leaves the operator working out which three of their four changes landed.
 *     docs/plans/sealed-config-plan.md
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP, DOT_PATH_TO_ENV, serializeConfigValue } from '../services/config-schema.js';
import { isSealed, sealRefusal } from '../services/config-sealing.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import { applyConsulValues } from '../services/consul-config.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

export function adminConfigRouter(
    config: AimeatConfig,
    storage: Storage,
    provenance?: ConfigProvenance,
    consulService?: ConsulConfigService | null,
): Router {
    const router = Router();

    // GET /v1/admin/config — full config schema with types, ranges, descriptions (§14.2)
    // Schema is built dynamically from the shared CONFIG_FIELDS definitions
    router.get('/v1/admin/config', requireAuth(), requireRole('operator'), async (_req, res) => {
        const editable = storage.supportsConfigPersistence();
        type SchemaEntry = {
            value: unknown; type: string; description: string; range?: string;
            mutable: boolean; editable: boolean; path: string;
            source?: string; canReset?: boolean; sealed?: boolean;
        };
        const schema: Record<string, SchemaEntry> = {};

        for (const field of CONFIG_FIELDS) {
            if (field.adminDisplay === 'hidden') continue;

            if (field.adminDisplay === 'configured') {
                // Secret fields — show as boolean indicating whether configured
                const configuredPath = `${field.dotPath}_configured`;
                const src = provenance?.getSource(field.dotPath);
                schema[configuredPath] = {
                    value: !!config[field.key],
                    type: 'boolean',
                    description: `Whether ${field.description.toLowerCase().replace(' (secret)', '')} is configured (read-only secret)`,
                    mutable: false,
                    editable: false,
                    path: configuredPath,
                    source: src ?? 'default',
                    canReset: false,
                };
                continue;
            }

            // Normal field — show actual value
            const typeStr = field.type === 'number' ? 'integer' : field.type;
            // A sealed path answers "where did this come from" with the seal rather than with
            // whether the host happened to pass it as env or as file: the seal is the operative
            // fact, and it is what the admin tab badges. The VALUE is untouched and present — the
            // operator is entitled to see what their limits are, only not to move them.
            const sealed = isSealed(config, field.dotPath);
            const src = sealed ? 'sealed' : (provenance?.getSource(field.dotPath) ?? 'default');
            schema[field.dotPath] = {
                value: config[field.key],
                type: typeStr,
                description: field.description,
                ...(field.range ? { range: field.range } : {}),
                mutable: !field.immutable && !sealed,
                editable: editable && !field.immutable && !sealed,
                path: field.dotPath,
                source: src,
                canReset: src === 'database',
                ...(sealed ? { sealed: true } : {}),
            };
        }

        // Combined virtual field: VAPID keys configured
        schema['push.vapid_configured'] = {
            value: !!config.vapidPublicKey && !!config.vapidPrivateKey,
            type: 'boolean',
            description: 'Whether VAPID keys are configured (read-only secret)',
            mutable: false,
            editable: false,
            path: 'push.vapid_configured',
            source: 'default',
            canReset: false,
        };

        res.json(success(config.nodeId, {
            editable,
            storageType: config.storageProvider,
            note: editable ? undefined : 'In-memory storage detected. Config is read-only. Use .env or aimeat.ini to configure this node.',
            sealed: config.sealedConfigKeys,
            sealedNote: config.sealedConfigKeys.length > 0
                ? 'Some settings here are set by whoever runs this node. You can see them; changing them is a conversation with them.'
                : undefined,
            schema,
        }));
    });
    // PUT /v1/admin/config — atomic config update with dot-path addressing (§14.2, Appendix B)
    // Body format: {"changes": [{"path": "morsel_policy.daily_allowance", "value": 75}, ...]}
    // Mutable field lookup comes from the shared config-schema module (single source of truth)
    router.put('/v1/admin/config', requireAuth(), requireRole('operator'), async (req, res) => {
        // In-memory guard — config editing requires persistent storage
        if (!storage.supportsConfigPersistence()) {
            res.status(403).json(error(config.nodeId, 'READONLY_CONFIG',
                'Config editing requires a persistent database (PostgreSQL or SQLite). Use .env or aimeat.ini created with "aimeat init".'));
            return;
        }

        const { changes } = req.body ?? {};

        if (!Array.isArray(changes) || changes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'Body must contain "changes" array with [{path, value}] entries'));
            return;
        }

        // Refuse before you write. The sealed scan runs over the WHOLE batch first, so a request
        // carrying one sealed path applies none of it — including the paths that were fine. Letting
        // the rest through would answer a refusal with "we applied three of your four changes" and
        // leave the operator to work out which, on the one boundary where that is least acceptable.
        const sealedPaths = (changes as Array<{ path?: unknown }>)
            .map(c => c?.path)
            .filter((p): p is string => typeof p === 'string' && isSealed(config, p));
        if (sealedPaths.length > 0) {
            const refusal = sealRefusal(sealedPaths[0]);
            res.status(403).json(error(config.nodeId, refusal.code,
                sealedPaths.length === 1
                    ? refusal.message
                    : `${sealedPaths.join(', ')} are set by whoever runs this node and cannot be changed here. Nothing in this request was applied.`,
                undefined, { sealed: sealedPaths },
                [{ description: 'Ask whoever runs this node to change it.', method: 'GET', url: '/v1/admin/config' }]));
            return;
        }

        const applied: { path: string; old_value: unknown; new_value: unknown }[] = [];
        const errors: { path: string; reason: string }[] = [];

        for (const change of changes) {
            const { path, value } = change ?? {};
            if (typeof path !== 'string' || value === undefined) {
                errors.push({ path: path ?? '(missing)', reason: 'Each change must have "path" (string) and "value"' });
                continue;
            }
            const mapping = MUTABLE_CONFIG_MAP[path];
            if (!mapping) {
                errors.push({ path, reason: `Unknown or immutable config path. Valid mutable paths: ${Object.keys(MUTABLE_CONFIG_MAP).join(', ')}` });
                continue;
            }
            if (!mapping.validate(value)) {
                errors.push({ path, reason: `Invalid value for ${path}` });
                continue;
            }
            const oldValue = config[mapping.key];
            (config as unknown as Record<string, unknown>)[mapping.key] = value;
            applied.push({ path, old_value: oldValue, new_value: value });

            // Persist to database as raw string
            try {
                await storage.setConfigValue(path, serializeConfigValue(value));
                if (provenance) provenance.markDatabase([path]);
            } catch (e) {
                console.warn(`[config] Failed to persist ${path} to DB:`, e);
            }
        }

        if (applied.length === 0 && errors.length > 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid changes applied', undefined, { errors }));
            return;
        }

        res.json(success(config.nodeId, {
            applied,
            errors: errors.length > 0 ? errors : undefined,
            note: 'Config updated and persisted to database. Changes survive restart.',
        }));
        emitChange('config');
    });

    // DELETE /v1/admin/config/:path — remove a DB override (revert to file/env/default)
    router.delete('/v1/admin/config/:path', requireAuth(), requireRole('operator'), async (req, res) => {
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
    router.get('/v1/admin/consul', requireAuth(), requireRole('operator'), async (_req, res) => {
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
    router.post('/v1/admin/consul/export', requireAuth(), requireRole('operator'), async (_req, res) => {
        if (!consulService) {
            res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
            return;
        }

        let exported = 0;
        let sealedSkipped = 0;
        for (const [dotPath, field] of Object.entries(MUTABLE_CONFIG_MAP)) {
            // A sealed value pushed into the KV store looks editable there, gets edited, and is
            // then discarded on the next import without anyone being told. Leave it out.
            if (isSealed(config, dotPath)) { sealedSkipped++; continue; }
            try {
                const value = (config as unknown as Record<string, unknown>)[field.key];
                await consulService.set(dotPath, serializeConfigValue(value));
                exported++;
            } catch (err) { logger.warn('value: skip individual failures', { error: String(err) }); }
        }

        res.json(success(config.nodeId, {
            exported, total: Object.keys(MUTABLE_CONFIG_MAP).length,
            ...(sealedSkipped > 0 ? { sealed_skipped: sealedSkipped } : {}),
        }));
        emitChange('config');
    });

    // POST /v1/admin/consul/import — pull config from Consul KV and apply to runtime + DB
    router.post('/v1/admin/consul/import', requireAuth(), requireRole('operator'), async (_req, res) => {
        if (!consulService) {
            res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
            return;
        }

        const values = await consulService.loadAll();
        // applyConsulValues drops sealed paths itself (it is also the boot loader and the watch
        // callback), so `applied` cannot contain one and nothing sealed reaches the database here.
        const { applied, sealed } = applyConsulValues(config, values);

        // Persist to DB if available
        if (storage.supportsConfigPersistence()) {
            for (const dotPath of applied) {
                await storage.setConfigValue(dotPath, values[dotPath]);
            }
            if (provenance) provenance.markDatabase(applied);
        }

        res.json(success(config.nodeId, {
            imported: applied.length, total: Object.keys(values).length,
            ...(sealed.length > 0 ? { sealed } : {}),
        }));
        emitChange('config');
    });

    return router;
}
