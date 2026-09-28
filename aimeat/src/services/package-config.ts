/**
 * @file services/package-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config a package install fills in, checked before a single component registers.
 *
 *   WHAT IT IS FOR. A package that installs and then does not work until somebody finds the right
 *   screen is the thing install packages exist to end (wish-asennuspaketit-uusille-nodeille-ja-
 *   keskitetty-pakettireposit, phase 2). So an install takes `config: { <componentId>: { … } }`:
 *   an app component's values go into its config record (services/app-config.ts), and an extension
 *   component's values go into the extension's own config, where a `type: secret` field is encrypted
 *   and only the sandbox sees it decrypted.
 *
 *   REFUSED BEFORE ANYTHING IS WRITTEN, like every other install refusal: a component the package
 *   does not have, a field a component does not declare, a value of the wrong type, and a required
 *   app field left empty. A dry run answers the same checks without refusing on the empty ones, and
 *   lists them with what each is for, so a chat can ask the person and then install.
 * @structure ConfigPlanEntry · PackageConfigPlan · planPackageConfig(components, planned, input, deps)
 *   · missingConfigMessage(plan) · mergeExtensionConfig() · configPreview(plan)
 * @usage
 *   const plan = planPackageConfig(pkg.components, plannedComponents, input.config, { config, owner });
 *   if (!plan.ok) return plan;
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */
import type { AimeatConfig } from '../config.js';
import type { PackageComponent, InstalledComponent } from '../storage/interface.js';
import { parseAppConfigSchema, checkAppConfigValues, configMissing, type AppConfigSchema, type AppConfigValues } from './app-config.js';
import { buildExtensionRecordFromManifest } from './extension-manifest.js';
import { getExtSecretKeys, prepareSecretConfigForWrite } from './extension-secrets.js';
import { getEncryptionKey } from './encryption.js';

/** Config keys the extension builder keeps beside the declared fields; never a caller's to set. */
const EXTENSION_RESERVED_KEY = /^__|^\$/;

export type ConfigPlanEntry =
    | { componentId: string; type: 'app'; registeredAs: string; schema: AppConfigSchema; values: AppConfigValues;
        missing: Array<{ field: string; description?: string }> }
    | { componentId: string; type: 'extension'; registeredAs: string; fields: string[]; secretFields: string[];
        values: Record<string, unknown>; unsetSecrets: string[] };

export type PackageConfigPlan =
    | { ok: true; entries: ConfigPlanEntry[]; missingCount: number }
    | { ok: false; status: number; code: string; message: string };

const refuse = (status: number, code: string, message: string): PackageConfigPlan => ({ ok: false, status, code, message });

function extensionFields(content: string, config: AimeatConfig, owner: string): { fields: string[]; secretFields: string[] } | null {
    let parsed: { manifest?: string; scripts?: Record<string, string> };
    try { parsed = JSON.parse(content); }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    catch { parsed = { manifest: content }; }
    const built = buildExtensionRecordFromManifest(parsed.manifest ?? '', parsed.scripts ?? {}, config, owner, new Date().toISOString(), false);
    if (!built.ok) return null;
    const secretFields = getExtSecretKeys(built.record);
    const plain = Object.keys(built.record.config ?? {}).filter(k => !EXTENSION_RESERVED_KEY.test(k));
    return { fields: [...new Set([...plain, ...secretFields])], secretFields };
}

/**
 * Check the config an install was given against what each component declares.
 *
 * `planned` carries the registered name of each component, so a dry run can say which app a field
 * belongs to under the name this install gives it. Refusals are the install's own shape.
 */
export function planPackageConfig(
    components: PackageComponent[],
    planned: InstalledComponent[],
    input: unknown,
    deps: { config: AimeatConfig; owner: string },
): PackageConfigPlan {
    if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
        return refuse(400, 'INVALID_INPUT', 'config must be an object keyed by component id, e.g. { "app-shop.html": { "currency": "EUR" } }.');
    }
    const given = (input ?? {}) as Record<string, unknown>;
    const byId = new Map(components.map(c => [c.id, c]));
    const nameOf = new Map(planned.map(p => [p.componentId, p.registeredAs]));

    const unknownIds = Object.keys(given).filter(id => !byId.has(id));
    if (unknownIds.length) {
        return refuse(400, 'INVALID_INPUT', `config names parts this package does not have: ${unknownIds.join(', ')}. Its parts: ${components.map(c => c.id).join(', ')}.`);
    }

    const entries: ConfigPlanEntry[] = [];
    const problems: string[] = [];
    for (const comp of components) {
        const values = given[comp.id];
        if (values !== undefined && (values === null || typeof values !== 'object' || Array.isArray(values))) {
            problems.push(`${comp.id}: its config must be an object of field: value`);
            continue;
        }
        const vals = (values ?? {}) as Record<string, unknown>;
        const registeredAs = nameOf.get(comp.id) ?? comp.id;

        if (comp.type === 'app') {
            const parsed = parseAppConfigSchema(comp.content);
            if (parsed && 'error' in parsed) { problems.push(`${comp.id}: the app's config declaration cannot be used: ${parsed.error}`); continue; }
            if (!parsed) {
                if (values !== undefined) problems.push(`${comp.id}: this app declares no config`);
                continue;
            }
            const checked = checkAppConfigValues(parsed.schema, vals);
            if (!checked.ok) { problems.push(`${comp.id}: ${checked.errors.join('; ')}`); continue; }
            entries.push({
                componentId: comp.id, type: 'app', registeredAs, schema: parsed.schema,
                values: vals as AppConfigValues, missing: configMissing(parsed.schema, vals as AppConfigValues),
            });
            continue;
        }

        if (comp.type === 'extension') {
            const decl = extensionFields(comp.content, deps.config, deps.owner);
            if (!decl) {
                if (values !== undefined) problems.push(`${comp.id}: the extension's manifest does not build, so its config cannot be checked`);
                continue;
            }
            if (decl.fields.length === 0 && values === undefined) continue;
            const foreign = Object.keys(vals).filter(k => !decl.fields.includes(k));
            if (foreign.length) {
                problems.push(`${comp.id}: the extension does not declare ${foreign.join(', ')}${decl.fields.length ? ` (it declares ${decl.fields.join(', ')})` : ' (it declares no config)'}`);
                continue;
            }
            const secretsGiven = decl.secretFields.filter(k => vals[k] !== undefined && vals[k] !== '');
            if (secretsGiven.length && !getEncryptionKey(deps.config)) {
                return refuse(503, 'ENCRYPTION_NOT_CONFIGURED',
                    `${comp.id}: this node has no encryption key, so the secret field${secretsGiven.length > 1 ? 's' : ''} ${secretsGiven.join(', ')} cannot be stored. The operator sets AIMEAT_ENCRYPTION_KEY.`);
            }
            entries.push({
                componentId: comp.id, type: 'extension', registeredAs, fields: decl.fields, secretFields: decl.secretFields,
                values: vals, unsetSecrets: decl.secretFields.filter(k => vals[k] === undefined || vals[k] === ''),
            });
            continue;
        }

        if (values !== undefined) problems.push(`${comp.id}: a ${comp.type} part takes no config`);
    }

    if (problems.length) {
        return refuse(400, 'INVALID_INPUT', `The install's config does not fit the package: ${problems.join('. ')}.`);
    }
    const missingCount = entries.reduce((n, e) => n + (e.type === 'app' ? e.missing.length : 0), 0);
    return { ok: true, entries, missingCount };
}

/** The refusal for required app fields left empty, naming each one with what it is for. */
export function missingConfigMessage(plan: { entries: ConfigPlanEntry[] }): string {
    const lines = plan.entries.flatMap(e => e.type === 'app'
        ? e.missing.map(m => `${e.componentId}.${m.field}${m.description ? ` (${m.description})` : ''}`)
        : []);
    return `The package needs config the install did not give: ${lines.join(', ')}. `
        + 'Ask for these values and install again with config: { "<component id>": { "<field>": value } }. Nothing was installed.';
}

/**
 * An extension component's config as it is stored: the manifest's own values, then what the owner
 * had before (an update keeps the owner's config), then what this install was given. Secret fields
 * are encrypted, and a stored secret the new config does not repeat is carried forward. Null when a
 * secret must be stored and the node has no encryption key.
 */
export function mergeExtensionConfig(
    built: Record<string, unknown>, given: Record<string, unknown> | undefined,
    previous: Record<string, unknown> | undefined, nodeConfig: AimeatConfig,
): Record<string, unknown> | null {
    const carried = Object.fromEntries(Object.entries(previous ?? {})
        .filter(([k]) => !EXTENSION_RESERVED_KEY.test(k) && k in built));
    const merged = { ...built, ...carried, ...(given ?? {}) };
    return prepareSecretConfigForWrite(merged, previous, getEncryptionKey(nodeConfig));
}

/** The plan as a dry run and an install answer show it: what each part asks for, never a secret. */
export function configPreview(plan: { entries: ConfigPlanEntry[] }): Array<Record<string, unknown>> {
    return plan.entries.map(e => e.type === 'app'
        ? { component_id: e.componentId, type: 'app', registered_as: e.registeredAs, schema: e.schema, given: Object.keys(e.values), missing: e.missing }
        : { component_id: e.componentId, type: 'extension', registered_as: e.registeredAs, fields: e.fields, secret_fields: e.secretFields,
            given: Object.keys(e.values), unset_secrets: e.unsetSecrets });
}
