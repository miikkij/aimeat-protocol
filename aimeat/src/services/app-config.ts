/**
 * @file services/app-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's config: the values an app declares it needs to work (a company name, a
 *   contact address, a currency), filled in when a package installs it and changed by its owner
 *   later. Install packages, phase 2 (wish-asennuspaketit-uusille-nodeille-ja-keskitetty-pakettireposit).
 *
 *   THE WORD IS "CONFIG", NOT "SETTINGS". services/app-settings.ts already means the app's name,
 *   description, access code and parking, which every app has and the node owns. Config is what one
 *   app asks for about itself, in its own words, and nothing else carries it.
 *
 *   THE DECLARATION LIVES IN THE APP'S HTML, as a JSON Schema in
 *   `<script type="application/json" id="aimeat-config">`, for the reason app-bundled-crews.ts gives:
 *   the HTML is the one thing every publish endpoint, the package ZIP and a pull from another node
 *   carry unchanged. publishApp parses it and stores the schema on the manifest, so reading the
 *   config never loads the app's bytes.
 *
 *   THE VALUES ARE ONE MEMORY RECORD, `apps.<filename>.config` in the owner's namespace, public. The
 *   app runs for people who are not its owner (organism members, visitors), and it reads the values
 *   the owner set, so they are as public as the app. That is also why a config field may not be a
 *   secret: a secret never reaches a browser. A package that needs an API key declares it on its
 *   extension's config, which the same install fills and which only the sandbox ever sees decrypted.
 * @structure
 *   - AppConfigSchema · parseAppConfigSchema(html) — the declaration, checked
 *   - appConfigKey(filename) · readAppConfigValues() · writeAppConfigValues()
 *   - configMissing() · checkAppConfigValues() — required and valid
 *   - appConfigView() · getAppConfig() · setAppConfig() — what REST and MCP call
 * @usage
 *   const parsed = parseAppConfigSchema(html);   // null | { schema } | { error }
 *   const out = await setAppConfig(storage, { callerOwnerGhii, ownerName, filename, values: { currency: 'EUR' } });
 * @version-history
 *   v1.2.0 — 2026-10-05 — getAppConfig takes the reader: an operator-hidden app is not found except
 *     for its owner and operators, and an access-coded app's workspace ids need the code, the unlock
 *     token, or the owner (secaudit 2026-10, APP-6).
 *   v1.1.0 — 2026-10-02 — getAppConfig answers `workspaces`: where an install made the workspaces the
 *     app declares, by contract (app-workspaces.ts; package sale design, phase 4).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */
import type { Storage } from '../storage/interface.js';
import { validateValueAgainstSchema, validateSchemaItself } from './schema-validator.js';
import { emitChange } from './event-bus.js';
import { readAppWorkspaceLinks, type AppWorkspaceLink } from './app-workspaces.js';
import { appAccessGranted } from './app-access-token.js';

/** The declaration an app makes: a flat JSON Schema object of scalar fields. */
export interface AppConfigSchema {
    type: 'object';
    title?: string;
    description?: string;
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
}

export type AppConfigValues = Record<string, string | number | boolean>;

const CONFIG_BLOCK_RE = /<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])(?=[^>]*\bid\s*=\s*["']aimeat-config["'])[^>]*>([\s\S]*?)<\/script>/i;
/** A declaration is prose-sized; the ceiling keeps a pathological app from making every publish parse megabytes. */
const MAX_BLOCK_BYTES = 16 * 1024;
const MAX_FIELDS = 50;
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean']);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The config schema an app declares, checked. `null` when the app declares none; `{ error }` names
 * what is wrong, so publish can refuse with it and an install can say which package part is broken.
 */
export function parseAppConfigSchema(html: string): { schema: AppConfigSchema } | { error: string } | null {
    const m = CONFIG_BLOCK_RE.exec(html);
    if (!m) return null;
    const raw = (m[1] ?? '').trim();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BLOCK_BYTES) {
        return { error: `the aimeat-config block is over ${MAX_BLOCK_BYTES / 1024} kB` };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (err) {
        return { error: `the aimeat-config block is not JSON: ${(err as Error).message}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'the aimeat-config block must be a JSON Schema object with "properties"' };
    }
    const decl = parsed as Record<string, unknown>;
    if (decl.type !== undefined && decl.type !== 'object') return { error: 'the aimeat-config schema must have type "object"' };
    const props = decl.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
        return { error: 'the aimeat-config schema needs "properties": one entry per field the app asks for' };
    }
    const entries = Object.entries(props as Record<string, unknown>);
    if (entries.length === 0) return { error: 'the aimeat-config schema declares no fields' };
    if (entries.length > MAX_FIELDS) return { error: `the aimeat-config schema declares ${entries.length} fields; at most ${MAX_FIELDS}` };
    for (const [key, p] of entries) {
        if (!KEY_RE.test(key)) return { error: `config field "${key}": a name starts with a letter and holds letters, digits and _ (at most 64)` };
        if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: `config field "${key}" must be a schema object` };
        const field = p as Record<string, unknown>;
        if (field.secret === true || field.writeOnly === true || field.format === 'password') {
            return {
                error: `config field "${key}" is marked secret. An app's config is read by everyone who opens the app, `
                    + 'so a secret never goes there: declare it as a `type: secret` field in the config of the package\'s extension.',
            };
        }
        const t = field.type;
        if (t === undefined ? !Array.isArray(field.enum) : !SCALAR_TYPES.has(String(t))) {
            return { error: `config field "${key}" must have type string, number, integer or boolean (or an enum)` };
        }
    }
    const required = decl.required;
    if (required !== undefined) {
        if (!Array.isArray(required) || !required.every(r => typeof r === 'string')) {
            return { error: 'the aimeat-config "required" must be a list of field names' };
        }
        const unknown = (required as string[]).filter(r => !(r in (props as object)));
        if (unknown.length) return { error: `the aimeat-config "required" names fields it does not declare: ${unknown.join(', ')}` };
    }
    const schema: AppConfigSchema = {
        type: 'object',
        ...(typeof decl.title === 'string' ? { title: decl.title } : {}),
        ...(typeof decl.description === 'string' ? { description: decl.description } : {}),
        properties: props as Record<string, Record<string, unknown>>,
        ...(Array.isArray(required) && required.length ? { required: required as string[] } : {}),
    };
    const invalid = validateSchemaItself(valueSchema(schema));
    if (invalid) return { error: `the aimeat-config schema does not compile: ${invalid}` };
    return { schema };
}

/** The schema values are checked against: the declaration, closed to fields it does not name. */
function valueSchema(schema: AppConfigSchema): Record<string, unknown> {
    return { type: 'object', properties: schema.properties, additionalProperties: false };
}

/** Where the values live, in the owner's namespace. */
export function appConfigKey(filename: string): string {
    return `apps.${filename}.config`;
}

/** The declared defaults under the stored values. */
function withDefaults(schema: AppConfigSchema, values: AppConfigValues): AppConfigValues {
    const out: AppConfigValues = {};
    for (const [key, p] of Object.entries(schema.properties)) {
        if (values[key] !== undefined) out[key] = values[key]!;
        else if (p.default !== undefined) out[key] = p.default as string | number | boolean;
    }
    return out;
}

/** Required fields with neither a value nor a default, each with what the app says it is for. */
export function configMissing(schema: AppConfigSchema, values: AppConfigValues): Array<{ field: string; description?: string }> {
    const full = withDefaults(schema, values);
    return (schema.required ?? [])
        .filter(k => full[k] === undefined || full[k] === '')
        .map(k => ({
            field: k,
            ...(typeof schema.properties[k]?.description === 'string'
                ? { description: schema.properties[k]!.description as string }
                : typeof schema.properties[k]?.title === 'string' ? { description: schema.properties[k]!.title as string } : {}),
        }));
}

/** Are these values ones the app accepts? Missing required fields are a separate question. */
export function checkAppConfigValues(schema: AppConfigSchema, values: unknown): { ok: true } | { ok: false; errors: string[] } {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, errors: ['config values must be an object of field: value'] };
    const out = validateValueAgainstSchema(values, valueSchema(schema));
    return out.ok ? { ok: true } : { ok: false, errors: out.errors ?? ['the values do not match the app\'s config schema'] };
}

export async function readAppConfigValues(storage: Storage, ownerGhii: string, filename: string): Promise<{ values: AppConfigValues; updatedAt: string | null }> {
    const rec = await storage.getMemory(ownerGhii, appConfigKey(filename));
    if (!rec) return { values: {}, updatedAt: null };
    const raw = typeof rec.value === 'string' ? safeJson(rec.value) : rec.value;
    const values = (raw && typeof raw === 'object' && (raw as { values?: unknown }).values && typeof (raw as { values?: unknown }).values === 'object')
        ? (raw as { values: AppConfigValues }).values : {};
    return { values, updatedAt: rec.updatedAt ?? null };
}

function safeJson(s: string): unknown {
    try { return JSON.parse(s); }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: a stored value that is not JSON holds no values
    catch { return null; }
}

/** Replace the stored values with these. The caller has checked them. */
export async function writeAppConfigValues(storage: Storage, ownerGhii: string, filename: string, values: AppConfigValues): Promise<void> {
    const key = appConfigKey(filename);
    const now = new Date().toISOString();
    const existing = await storage.getMemory(ownerGhii, key);
    await storage.setMemory({
        key,
        ownerGaii: ownerGhii,
        value: JSON.stringify({ spec: 'aimeat.app-config/1', values }),
        visibility: 'public',
        tags: ['app-config'],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        trackable: true,
    });
    emitChange('apps', ownerGhii);
}

export interface AppConfigView {
    app: string;
    schema: AppConfigSchema | null;
    values: AppConfigValues;
    missing: Array<{ field: string; description?: string }>;
    updated_at: string | null;
    /** Where the workspaces the app declares were made for this copy, by contract (app-workspaces.ts). */
    workspaces?: Record<string, AppWorkspaceLink>;
}

export function appConfigView(app: string, schema: AppConfigSchema | null, values: AppConfigValues, updatedAt: string | null): AppConfigView {
    return {
        app,
        schema,
        values: schema ? withDefaults(schema, values) : {},
        missing: schema ? configMissing(schema, values) : [],
        updated_at: updatedAt,
    };
}

export type AppConfigResult =
    | { ok: true; view: AppConfigView }
    | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/** Who reads an app's config, as far as the app's own gates care (secaudit 2026-10, APP-6). */
export interface AppConfigReader {
    /** The app's owner, an agent of theirs, or an operator. */
    ownerOrOperator: boolean;
    /** The access code the caller sent, or the unlock token the apex minted (app-access-token.ts). */
    code?: string;
    accessToken?: string;
}

/**
 * The config of one published app, as anyone who may open the app reads it. An app an operator hid
 * is not found except for its owner and operators, as the app itself is (routes/apps/read.ts). The
 * workspace ids of an app behind an access code go only to its owner, an operator, or a caller with
 * the code or the unlock token; the values stay readable, because the app reads them before anyone
 * signs in and they hold nothing secret (secaudit 2026-10, APP-6).
 */
export async function getAppConfig(storage: Storage, ownerName: string, filename: string, reader: AppConfigReader): Promise<AppConfigResult> {
    const app = await storage.getAppByOwnerName(ownerName, filename);
    const notFound: AppConfigResult = { ok: false, status: 404, code: 'NOT_FOUND', message: `No published app "${filename}" under "${ownerName}".` };
    if (!app || (app.operatorHidden && !reader.ownerOrOperator)) return notFound;
    const schema = (app.manifest.configSchema as AppConfigSchema | undefined) ?? null;
    const { values, updatedAt } = await readAppConfigValues(storage, app.ownerGaii, filename);
    const unlocked = !app.accessCode || reader.ownerOrOperator || reader.code === app.accessCode
        || (!!reader.accessToken && await appAccessGranted(reader.accessToken, app.ownerName, filename));
    // The workspace ids an install made for this copy travel with the config, on the one read an app
    // already makes; an app that declares none gets no field.
    const workspaces = unlocked && app.manifest.workspaces?.length ? await readAppWorkspaceLinks(storage, app.ownerGaii, filename) : {};
    return {
        ok: true,
        view: { ...appConfigView(`${ownerName}/${filename}`, schema, values, updatedAt), ...(Object.keys(workspaces).length ? { workspaces } : {}) },
    };
}

/**
 * Change an app's config: the named fields take the given values, a `null` removes one (its
 * default applies again), and fields not named keep theirs. Only the app's owner and the agents
 * acting for them may, which the caller has resolved to `callerOwnerGhii`.
 *
 * A config change is a setting, so a managed package install allows it (package-managed.ts).
 */
export async function setAppConfig(
    storage: Storage,
    input: { callerOwnerGhii: string; ownerName: string; filename: string; values: unknown },
): Promise<AppConfigResult> {
    const app = await storage.getAppByOwnerName(input.ownerName, input.filename);
    if (!app) return { ok: false, status: 404, code: 'NOT_FOUND', message: `No published app "${input.filename}" under "${input.ownerName}".` };
    if (app.ownerGaii !== input.callerOwnerGhii) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: `This app's config belongs to ${input.ownerName}. Only that owner (and the agents acting for them) may change it.` };
    }
    const schema = (app.manifest.configSchema as AppConfigSchema | undefined) ?? null;
    if (!schema) {
        return {
            ok: false, status: 409, code: 'NO_CONFIG_SCHEMA',
            message: 'This app declares no config. An app declares one as a JSON Schema in <script type="application/json" id="aimeat-config"> and publishes again.',
        };
    }
    const patch = input.values;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'values must be an object of field: value (null removes a field).' };
    }
    const { values: current } = await readAppConfigValues(storage, app.ownerGaii, input.filename);
    const next: AppConfigValues = { ...current };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v === null) delete next[k];
        else next[k] = v as string | number | boolean;
    }
    const checked = checkAppConfigValues(schema, next);
    if (!checked.ok) {
        return { ok: false, status: 422, code: 'INVALID_CONFIG', message: `The values do not fit the app's config: ${checked.errors.join('; ')}`, details: { errors: checked.errors } };
    }
    await writeAppConfigValues(storage, app.ownerGaii, input.filename, next);
    const { updatedAt } = await readAppConfigValues(storage, app.ownerGaii, input.filename);
    return { ok: true, view: appConfigView(`${input.ownerName}/${input.filename}`, schema, next, updatedAt) };
}
