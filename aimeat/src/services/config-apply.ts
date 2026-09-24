/**
 * @file src/services/config-apply.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Apply a batch of config changes the way the admin Config tab always has: every path
 *   checked, the durable write first and the live one only if it took, a secret answered with
 *   whether it is configured and never with its value. Moved out of routes/admin-config.ts (PUT
 *   /v1/admin/config) unchanged, so that a second door that changes settings (Themes & Styles'
 *   "who chooses", PUT /v1/themes/policy and aimeat_theme_policy_set) goes through the same code.
 *   The sealed-path refusal stays with the caller: it answers before anything is applied.
 * @structure ConfigChange · ConfigApplyResult · applyConfigChanges(deps, changes)
 * @usage const r = await applyConfigChanges({ config, storage, provenance }, [{ path, value }]);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Moved from routes/admin-config.ts (a pure move of its loop).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ConfigProvenance } from './config-provenance.js';
import { MUTABLE_CONFIG_MAP, serializeConfigValue, readConfigField, writeConfigField } from './config-schema.js';
import { isSecretField } from './config-sealing.js';
import { logger } from '../utils/logger.js';

export interface ConfigChange { path?: unknown; value?: unknown }
export interface ConfigApplyResult {
    applied: { path: string; old_value: unknown; new_value: unknown; secret?: true }[];
    errors: { path: string; reason: string }[];
}

export async function applyConfigChanges(
    deps: { config: AimeatConfig; storage: Storage; provenance?: ConfigProvenance },
    changes: ConfigChange[],
): Promise<ConfigApplyResult> {
    const { config, storage, provenance } = deps;
    const applied: ConfigApplyResult['applied'] = [];
    const errors: ConfigApplyResult['errors'] = [];

    for (const change of changes) {
        const { path, value } = change ?? {};
        if (typeof path !== 'string' || value === undefined) {
            errors.push({ path: typeof path === 'string' ? path : '(missing)', reason: 'Each change must have "path" (string) and "value"' });
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
        const oldValue = readConfigField(config, mapping);

        // THE DURABLE WRITE FIRST, and the live one only if it took. This ran the other way
        // round: the running node was changed, the persist was attempted, and a failure went to
        // console.warn — not to the logger, so it reached no log this node keeps — while the
        // loop carried on, the path went into `applied`, and the answer said "Changes survive
        // restart". The operator was told a setting was saved when it was live-only and would
        // vanish on the next boot, which is the worst of the three possible outcomes because
        // nobody investigates a success.
        try {
            await storage.setConfigValue(path, serializeConfigValue(value));
        } catch (e) {
            logger.error('admin-config: a change could not be persisted, so it was not applied', { path, error: String(e) });
            errors.push({
                path,
                reason: 'Could not be saved to this node\'s database. Nothing changed for this setting: it still has the value it had.',
            });
            continue;
        }
        writeConfigField(config, mapping, value);
        if (provenance) provenance.markDatabase([path]);
        // A secret is answered with whether it was and is configured, never with the value.
        // The old value can be a key the host injected through the environment, which the
        // operator may replace and must not read. Measured on aimeat.io 2026-09-16.
        applied.push(isSecretField(mapping)
            ? { path, old_value: { configured: !!oldValue }, new_value: { configured: !!value }, secret: true }
            : { path, old_value: oldValue, new_value: value });
    }
    return { applied, errors };
}
