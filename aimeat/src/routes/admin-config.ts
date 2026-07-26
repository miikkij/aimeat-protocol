/**
 * @file src/routes/admin-config.ts
 * @description Operator-only admin config API. Exposes the node's configuration schema
 *   (types, ranges, descriptions, provenance/source, editability) and applies mutations to
 *   persistable fields, integrating with Consul-sourced values and provenance tracking.
 *
 * @structure
 *   - adminConfigRouter(config, storage, provenance?, consulService?): builds the router
 *   - GET /v1/admin/config: dynamic schema from CONFIG_FIELDS incl. secret "_configured" flags
 *   - mutation routes: validate + persist mutable config, emit change events
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP, DOT_PATH_TO_ENV, serializeConfigValue } from '../services/config-schema.js';
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
            source?: string; canReset?: boolean;
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
            const src = provenance?.getSource(field.dotPath) ?? 'default';
            schema[field.dotPath] = {
                value: config[field.key],
                type: typeStr,
                description: field.description,
                ...(field.range ? { range: field.range } : {}),
                mutable: !field.immutable,
                editable: editable && !field.immutable,
                path: field.dotPath,
                source: src,
                canReset: src === 'database',
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
        for (const [dotPath, field] of Object.entries(MUTABLE_CONFIG_MAP)) {
            try {
                const value = (config as unknown as Record<string, unknown>)[field.key];
                await consulService.set(dotPath, serializeConfigValue(value));
                exported++;
            } catch (err) { logger.warn('value: skip individual failures', { error: String(err) }); }
        }

        res.json(success(config.nodeId, { exported, total: Object.keys(MUTABLE_CONFIG_MAP).length }));
        emitChange('config');
    });

    // POST /v1/admin/consul/import — pull config from Consul KV and apply to runtime + DB
    router.post('/v1/admin/consul/import', requireAuth(), requireRole('operator'), async (_req, res) => {
        if (!consulService) {
            res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
            return;
        }

        const values = await consulService.loadAll();
        const { applied } = applyConsulValues(config, values);

        // Persist to DB if available
        if (storage.supportsConfigPersistence()) {
            for (const dotPath of applied) {
                await storage.setConfigValue(dotPath, values[dotPath]);
            }
            if (provenance) provenance.markDatabase(applied);
        }

        res.json(success(config.nodeId, { imported: applied.length, total: Object.keys(values).length }));
        emitChange('config');
    });

    return router;
}
