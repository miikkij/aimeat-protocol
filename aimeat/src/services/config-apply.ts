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
 *   2026-10-16 — A refused value is answered with the row's `refusal` when it has one (eudiw.enabled; QA audit D6-01).
 *   v1.4.0 — 2026-10-11 — A list setting is normalized to a list before its check and stored as
 *     comma-separated text; it was written as the text the request sent. The rate-limit settings are
 *     copied into the limiter tiers after a save (config-rate-limit-sync.ts).
 *   v1.3.0 — 2026-10-11 — A refused value on a setting whose range is a recommendation is answered
 *     with the minimum, not with the range as if it were a limit.
 *   v1.2.0 — 2026-10-09 — A secret row is stored encrypted with the node key (config-at-rest.ts); it
 *     went into SystemSetting in plain text (secrets audit 2026-10-09, S4b).
 *   v1.1.0 — 2026-10-02 — The four settings in RANGE_ENFORCED are refused outside their stated
 *     `range` (withinStatedRange), with the range named in the reason. The rows' checks enforced the
 *     minimum only, so a value above the maximum the Config tab shows was stored and applied.
 *   v1.0.0 — 2026-09-24 — Moved from routes/admin-config.ts (a pure move of its loop).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ConfigProvenance } from './config-provenance.js';
import { MUTABLE_CONFIG_MAP, serializeFieldValue, readConfigField, writeConfigField } from './config-schema.js';
import { isSecretField } from './config-sealing.js';
import { sealSettingForStorage } from './config-at-rest-rows.js';
import { withinStatedRange, RANGE_ENFORCED, rangeKindOf, numericRangeOf, asList } from './config-schema-validators.js';
import { syncRateLimitTiers } from './config-rate-limit-sync.js';
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
        const { path, value: sent } = change ?? {};
        if (typeof path !== 'string' || sent === undefined) {
            errors.push({ path: typeof path === 'string' ? path : '(missing)', reason: 'Each change must have "path" (string) and "value"' });
            continue;
        }
        const mapping = MUTABLE_CONFIG_MAP[path];
        if (!mapping) {
            errors.push({ path, reason: `Unknown or immutable config path. Valid mutable paths: ${Object.keys(MUTABLE_CONFIG_MAP).join(', ')}` });
            continue;
        }
        // A list setting is a list from here on, whether the request sent a list or a
        // comma-separated text: the check below, the stored row and the running config all see the
        // normalized value. The text used to be written as it came into a field the code reads as an
        // array, so `allowed.includes(origin)` became a substring test (measured 2026-10-11: with
        // "https://app.example.com" saved, the MCP origin check passed "https://app.example").
        const value = mapping.list ? asList(sent) : sent;
        // `validate` checks the type and mostly only the lower bound; for the settings in
        // RANGE_ENFORCED the row's `range` is a limit, so a value outside it is refused here too.
        if (!mapping.validate(value) || (RANGE_ENFORCED.has(path) && !withinStatedRange(mapping, value))) {
            // A recommended range has no maximum to break, so the reason names the minimum, the only
            // bound the value can have missed; a limit names the whole range.
            const min = rangeKindOf(mapping) === 'recommended' ? numericRangeOf(mapping)?.min : undefined;
            const hint = min !== undefined ? ` (the minimum is ${min}; ${mapping.range} is the recommended range)`
                : mapping.range ? ` (range ${mapping.range})` : '';
            errors.push({ path, reason: mapping.refusal ?? `Invalid value for ${path}${hint}` });
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
            // A secret row is stored encrypted (services/config-at-rest.ts; secrets audit 2026-10-09, S4b).
            await storage.setConfigValue(path, sealSettingForStorage(path, serializeFieldValue(mapping, value), config));
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
    // A saved rate limit reaches the running limiters now, not at the next restart.
    if (applied.length > 0) syncRateLimitTiers(config);
    return { applied, errors };
}
