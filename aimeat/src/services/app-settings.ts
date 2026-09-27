/**
 * @file src/services/app-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own settings, written by its owner: display name, description, per-locale
 *   descriptions, access code, parked, forkable and copy-protection. One implementation for
 *   PATCH /v1/apps/:filename (routes/apps/fork-manage.ts) and the MCP tool, so the validation, the
 *   write order, the audit entries and the notes cannot drift between the two callers.
 *
 *   The route keeps its own pre-check (patchRefusal), which asks every refusal the whole body can
 *   produce before the first write; it reaches these fields through parseOwnerSettingsInput, so each
 *   rule has one implementation and the pre-check is a second call of it, not a second copy.
 * @structure
 *   - SETTINGS_PRESENTATION_FIELDS / SETTINGS_OFFERING_FIELDS — the fields, in the route's order
 *   - parseOwnerSettingsInput(body)                — validation only, first refusal wins
 *   - applyOwnerSettingsUpdate(storage, config, target, body) — validate, write, audit, notes
 *   - appSettingsState(app, filename)             — the settings part of the answer (pure)
 *   - ownerAppSettings(storage, config, target)   — the same, read from storage
 *   - appDownloadUrl(ownerName, filename)         — the app's owner-scoped path
 * @usage
 *   const out = await applyOwnerSettingsUpdate(storage, config, target, { parked: true });
 *   if ('refusal' in out) return `${out.refusal.code}: ${out.refusal.message}`;
 * @version-history
 *   v1.0.0 — 2026-09-27 — Extracted from routes/apps/fork-manage.ts (PATCH /v1/apps/:filename), so
 *     the MCP tool aimeat_app_manage (action "settings") calls the same code as the route.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppProtection, AppRecord } from '../storage/interface.js';
import { sanitizeProtection, invalidateProtectionCache } from '../utils/app-protect.js';
import { recordAppAudit, type AppAuditAction } from './app-audit.js';
import { emitChange } from './event-bus.js';

/** How an app presents itself: a rung that stops at `presentation` may write these. */
export const SETTINGS_PRESENTATION_FIELDS = ['name', 'description', 'descriptions'] as const;

/** How an app is offered: needs the `operate` rung on a delegated app. */
export const SETTINGS_OFFERING_FIELDS = ['access_code', 'parked', 'forkable', 'protection'] as const;

/** Every field this service writes, in the order it writes them. */
export const SETTINGS_FIELDS = [...SETTINGS_PRESENTATION_FIELDS, ...SETTINGS_OFFERING_FIELDS] as const;

/** One settings field name. */
export type AppSettingsField = typeof SETTINGS_FIELDS[number];

/** Which app, in which storage bucket, changed by whom. */
export interface AppSettingsTarget {
    /** The storage bucket the app row lives in (the route's effectiveGaii). */
    ownerGaii: string;
    /** The owner's account name: the protection cache key and the download path. */
    ownerName: string;
    filename: string;
    /** The principal making the change, recorded in the app's audit log. */
    callerGaii: string;
}

/** What the service answers when the body cannot be carried out. Rendered as `CODE: message`. */
export interface AppSettingsRefusal {
    status: 400 | 404;
    code: 'INVALID_INPUT' | 'NOT_FOUND';
    message: string;
}

/** The body, as the route and the MCP tool receive it. Values are unchecked. */
export type AppSettingsInput = Partial<Record<AppSettingsField, unknown>>;

/** A body that passed validation, with only the fields it carried. */
export interface ParsedAppSettings {
    meta: { name?: string; description?: string; descriptions?: Record<string, string> };
    /** Present when `access_code` was in the body; `code` undefined clears it. */
    accessCode?: { code: string | undefined };
    parked?: boolean;
    forkable?: boolean;
    protection?: AppProtection;
}

/** The settings part of PATCH /v1/apps/:filename's answer, in the route's key order. */
export interface AppSettingsState {
    filename: string;
    name: string | undefined;
    description: string | undefined;
    protected: boolean;
    parked: boolean;
    forkable: boolean;
    protection: AppProtection | null;
}

const bad = (message: string): { refusal: AppSettingsRefusal } =>
    ({ refusal: { status: 400, code: 'INVALID_INPUT', message } });

/**
 * Validate the settings fields present in `body`, in the route's order; the first refusal wins.
 * Fields the body does not carry are not touched, and fields that are not settings are ignored.
 */
export function parseOwnerSettingsInput(
    body: Record<string, unknown>,
): { settings: ParsedAppSettings } | { refusal: AppSettingsRefusal } {
    const settings: ParsedAppSettings = { meta: {} };
    if ('name' in body) {
        if (typeof body.name !== 'string') return bad('name must be a string');
        const trimmedName = body.name.trim();
        if (trimmedName.length < 1 || trimmedName.length > 120) return bad('name must be 1-120 characters');
        settings.meta.name = trimmedName;
    }
    if ('description' in body) {
        if (typeof body.description !== 'string') return bad('description must be a string');
        const trimmedDesc = body.description.trim();
        if (trimmedDesc.length > 10_000) return bad('description must be at most 10000 characters');
        if (trimmedDesc.length === 0) return bad('description cannot be empty — apps require a description');
        settings.meta.description = trimmedDesc;
    }
    // Per-locale descriptions (EN/FI, extensible): a `{ locale: text }` map. Each value is a
    // string of at most 10000 characters; blank values are dropped. Additive: the canonical
    // `description` stays.
    if ('descriptions' in body) {
        if (typeof body.descriptions !== 'object' || body.descriptions === null || Array.isArray(body.descriptions)) {
            return bad('descriptions must be an object mapping locale → text');
        }
        const cleaned: Record<string, string> = {};
        for (const [loc, val] of Object.entries(body.descriptions as Record<string, unknown>)) {
            if (typeof val !== 'string') return bad(`descriptions.${loc} must be a string`);
            const trimmed = val.trim();
            if (trimmed.length > 10_000) return bad(`descriptions.${loc} must be at most 10000 characters`);
            if (trimmed.length > 0) cleaned[loc] = trimmed;
        }
        settings.meta.descriptions = cleaned;
    }
    if ('access_code' in body) {
        const accessCode = body.access_code;
        // Anything but a non-empty string clears the code, as the route always did.
        const newCode = typeof accessCode === 'string' && accessCode.length > 0 ? accessCode : undefined;
        if (newCode && (newCode.length < 4 || newCode.length > 64)) return bad('access_code must be 4-64 characters');
        settings.accessCode = { code: newCode };
    }
    if ('parked' in body) {
        if (typeof body.parked !== 'boolean') return bad('parked must be a boolean');
        settings.parked = body.parked;
    }
    if ('forkable' in body) {
        if (typeof body.forkable !== 'boolean') return bad('forkable must be a boolean');
        settings.forkable = body.forkable;
    }
    if ('protection' in body) {
        const sanitized = sanitizeProtection(body.protection);
        if (sanitized === undefined) {
            return bad('protection must be an object of booleans (obfuscate, domainLock, watermark, noRawDownload)');
        }
        settings.protection = sanitized;
    }
    return { settings };
}

/**
 * Validate, write, audit and say what changed, for the settings fields present in `body`. The app
 * is looked up first, so a missing app is refused before any write. Emits 'apps' after a write.
 *
 * Refusals: INVALID_INPUT (400) for a malformed field or a body with no settings field, NOT_FOUND
 * (404) when `target` names no app. The route never reaches the first kind, because its own
 * pre-check refused them already with the same codes and messages.
 */
export async function applyOwnerSettingsUpdate(
    storage: Storage,
    _config: AimeatConfig,
    target: AppSettingsTarget,
    body: AppSettingsInput,
): Promise<{ notes: string[] } | { refusal: AppSettingsRefusal }> {
    const input = body as Record<string, unknown>;
    if (!SETTINGS_FIELDS.some(f => f in input)) {
        return bad(`Provide at least one field to update (${SETTINGS_FIELDS.join(', ')}).`);
    }
    const parsed = parseOwnerSettingsInput(input);
    if ('refusal' in parsed) return parsed;
    const { settings } = parsed;
    const { ownerGaii, ownerName, filename, callerGaii } = target;

    if (!await storage.getApp(ownerGaii, filename)) {
        return { refusal: { status: 404, code: 'NOT_FOUND', message: `App "${filename}" not found in your uploads` } };
    }

    const notes: string[] = [];
    // Every change to how this app is offered lands in its audit log (services/app-audit.ts),
    // under the principal that made it: the agent's GAII when an agent did, so the owner can tell
    // their own hand from their agents'.
    const audit = (action: AppAuditAction, detail?: Record<string, string | number | boolean | null>) =>
        recordAppAudit(storage, { ownerGhii: ownerGaii, filename, by: callerGaii, action, detail });

    // Rename / re-describe in place: the display name is metadata, the URL is keyed off
    // owner/filename, so this never changes the link. Only the latest version's manifest is
    // updated (the version the catalogue surfaces).
    const metaUpdate = settings.meta;
    if (metaUpdate.name !== undefined || metaUpdate.description !== undefined || metaUpdate.descriptions !== undefined) {
        await storage.updateAppMeta(ownerGaii, filename, metaUpdate);
        if (metaUpdate.name !== undefined) await audit('name', { name: metaUpdate.name });
        if (metaUpdate.description !== undefined || metaUpdate.descriptions !== undefined) await audit('description');
        if (metaUpdate.name !== undefined && metaUpdate.description !== undefined) {
            notes.push('Name and description updated. The app link is unchanged.');
        } else if (metaUpdate.name !== undefined) {
            notes.push('Name updated. The app link is unchanged.');
        } else {
            notes.push('Description updated.');
        }
    }

    if (settings.accessCode) {
        const newCode = settings.accessCode.code;
        await storage.updateAppAccessCode(ownerGaii, filename, newCode);
        // The fact, never the code.
        await audit(newCode ? 'access_code.set' : 'access_code.cleared');
        notes.push(newCode
            ? 'Access code updated. Share the new code with recipients.'
            : 'Access code removed. The app is now publicly downloadable.');
    }

    if (settings.parked !== undefined) {
        await storage.setAppParked(ownerGaii, filename, settings.parked);
        await audit(settings.parked ? 'parked' : 'unparked');
        notes.push(settings.parked
            ? 'App parked. It is now hidden from the public catalogue but stays usable by you.'
            : 'App unparked. It is published in the public catalogue again.');
    }

    if (settings.forkable !== undefined) {
        await storage.setAppForkable(ownerGaii, filename, settings.forkable);
        await audit('forkable', { on: settings.forkable });
        notes.push(settings.forkable
            ? 'Forking enabled. Anyone can now fork this app into their own catalogue.'
            : 'Forking disabled. Only you and your agents can fork this app.');
    }

    if (settings.protection) {
        const toStore: AppProtection = Object.values(settings.protection).some(Boolean) ? settings.protection : {};
        await storage.updateAppMeta(ownerGaii, filename, { protection: toStore });
        invalidateProtectionCache(ownerName, filename);
        const on = Object.entries(toStore).filter(([, v]) => v).map(([k]) => k);
        await audit('protection', { flags: on.join(',') });
        notes.push(on.length
            ? `Copy-protection updated (${on.join(', ')}). Note: these raise the cost of casual copying and make leaks traceable — they cannot stop someone who can view the app from copying its HTML. To truly protect logic/data, move it into an extension.`
            : 'Copy-protection cleared.');
    }

    // The catalogue card shows name, parked and forkable, so the views watching 'apps' hear about
    // it here, where the write is, and not at each caller.
    emitChange('apps');
    return { notes };
}

/** The app's owner-scoped path, as PATCH /v1/apps/:filename answers it. */
export function appDownloadUrl(ownerName: string, filename: string): string {
    return `/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`;
}

/** The settings part of the answer, from an app record (or none, when it vanished mid-request). */
export function appSettingsState(app: AppRecord | null | undefined, filename: string): AppSettingsState {
    return {
        filename,
        name: app?.manifest?.name,
        description: app?.manifest?.description,
        protected: !!app?.accessCode,
        parked: !!app?.parked,
        forkable: !!app?.forkable,
        protection: app?.manifest?.protection ?? null,
    };
}

/**
 * The app's settings as they stand, read from storage: what the MCP tool answers after a write,
 * or when asked with no field to change. NOT_FOUND (404) when `target` names no app.
 */
export async function ownerAppSettings(
    storage: Storage,
    _config: AimeatConfig,
    target: { ownerGaii: string; ownerName: string; filename: string },
): Promise<(AppSettingsState & { download_url: string }) | { refusal: AppSettingsRefusal }> {
    const app = await storage.getApp(target.ownerGaii, target.filename);
    if (!app) {
        return { refusal: { status: 404, code: 'NOT_FOUND', message: `App "${target.filename}" not found in your uploads` } };
    }
    return { ...appSettingsState(app, target.filename), download_url: appDownloadUrl(target.ownerName, target.filename) };
}
