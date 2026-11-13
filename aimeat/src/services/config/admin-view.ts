/**
 * @file src/services/config/admin-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's view of this node's settings and the one function that changes them,
 *   shared by the admin Config API (GET and PUT /v1/admin/config) and the MCP tools
 *   aimeat_admin_config and aimeat_admin_config_set. Moved out of routes/admin/config.ts so that an
 *   operator's AI reads the same list the Config tab shows and changes a setting through the same
 *   checks: the sealed paths and the classification switch are refused before anything in the
 *   request is applied, every change goes through applyConfigChanges, and every applied change is
 *   written to the operator trail.
 *
 *   A secret row is shown as whether it is set (`<path>_configured`), never with its value. It names
 *   the path that sets it (`set_path`) when the operator may set it, so a key can be replaced from
 *   the Config tab or from chat and still never be read back.
 * @structure ConfigViewEntry · buildConfigView(deps) · changeNodeSettings(deps, caller, changes) ·
 *   resetNodeSettingRefusal(caller, path)
 * @usage const view = buildConfigView({ config, storage, provenance });
 *        const r = await changeNodeSettings({ config, storage, provenance }, req.auth!, changes);
 * @version-history
 *   2026-11-04 — The three checks of the settings an AI may only make stricter and the hand list of their
 *     five paths are one check read from each setting's row (config-strictness.ts), asked in the same
 *     order before the sign-in policy's cross-checks and after them; applyConfigChanges is told the
 *     caller. The answers are the same (codebase analysis 2026-11-03, item B4).
 *   2026-11-03 — resetNodeSettingRefusal: an AI credential does not remove the saved value of a setting
 *     it may only make stricter (classification.mode, the sign-in policy, mcp.capability_use_approval),
 *     because the value then falls back to the file or the default (secaudit2026nov02d round 13b).
 *   2026-11-03 — mcp.capability_use_approval: a change that asks fewer people (ask to operators to off) is
 *     refused to an AI credential with PERSON_REQUIRED, before anything is applied (secaudit2026nov02d round 13b).
 *   2026-11-02 — auth.sign_in_lockout: switching it off is refused to an AI credential, like the two below.
 *   2026-11-02 — The sign-in policy: a change that weakens auth.two_step_required or
 *     auth.password_sign_in is refused to an AI credential with PERSON_REQUIRED, and
 *     auth.password_sign_in=off with 409 OPERATOR_LOCKOUT while no operator account has a passkey or an
 *     identity provider link (services/sign-in-policy.ts; IT review). Both before anything is applied.
 *     A request that leaves auth.two_step_required above off with totp.enabled false, whichever of the
 *     two it moves, is refused with 409 TWO_STEP_NEEDS_TOTP.
 *   2026-10-31 — The classification switch check asks every change of classification.mode in the
 *     batch, each from the mode the change before it leaves; it asked the first one only, and the
 *     batch is applied in order (secaudit 2026-10-31 inv-14).
 *   v1.0.0 — 2026-10-25 — Moved from routes/admin-config.ts (GET's loop and PUT's checks), plus
 *     `appliesAt` on a row that takes effect at the next start and `set_path` on a secret the
 *     operator may set.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { CONFIG_FIELDS, MUTABLE_CONFIG_MAP, readConfigField } from './schema.js';
import { rangeKindOf } from './schema-validators.js';
import { applyConfigChanges, type ConfigChange, type ConfigApplyResult } from './apply.js';
import { isSealed, sealRefusal } from './sealing.js';
import type { ConfigProvenance } from './provenance.js';
import { emitChange } from '../event-bus.js';
import { CLASSIFICATION_MODE_PATH, recordSwitchChange, type SwitchCaller } from '../classification-run/switch.js';
import { offerDefaultCapsWhenSwitchedOn } from '../classification/default-caps.js';
import { recordOperatorNodeAct } from '../operator-access-audit.js';
import { resolveIdentity, ownerGhiiOf } from '../../utils/gaii.js';
import { TWO_STEP_REQUIRED_PATH, PASSWORD_SIGN_IN_PATH, TOTP_ENABLED_PATH, passwordOffLockoutRefusal, twoStepWithoutTotpRefusal } from '../sign-in-policy.js';
import { requestLooseningRefusal, resetRefusal, tightenOnlyRank, type TightenRefusal } from './strictness.js';

/**
 * The refusal an AI credential gets for removing the saved value of a setting it may only make stricter
 * (the row's `aiMayOnlyTighten`), or null: the saved value removed falls back to the file, the
 * environment or the default, which can be less strict. DELETE /v1/admin/config/:path asks it through
 * resetConfigValue (config-apply.ts) before storage is touched. The AI may still set a stricter value
 * with PUT; a person's own session is never refused here.
 */
export function resetNodeSettingRefusal(caller: SwitchCaller, path: string): { status: number; code: string; message: string; details: Record<string, unknown> } | null {
    return resetRefusal(caller, path);
}

export interface ConfigViewDeps { config: AimeatConfig; storage: Storage; provenance?: ConfigProvenance }

export interface ConfigViewEntry {
    value: unknown; type: string; description: string; range?: string; rangeKind?: 'limit' | 'recommended'; choices?: readonly string[];
    mutable: boolean; editable: boolean; path: string;
    source?: string; canReset?: boolean; sealed?: boolean; restartPending?: boolean;
    /** The code reads the setting once at start: a saved value takes effect at the next start. */
    appliesAt?: 'restart';
    /** A secret the operator may set: the path a change names. Its value is never shown. */
    set_path?: string;
}

export interface ConfigView {
    editable: boolean;
    storageType: string;
    note?: string;
    sealed: string[];
    sealedNote?: string;
    schema: Record<string, ConfigViewEntry>;
}

/**
 * Narrow the list: `section` is the first part of a path (`ai`, `auth`), `q` a piece of text a path or
 * its description contains. The whole list is over four hundred settings, more than a chat answer
 * should carry, so an AI asks for the section it needs.
 */
export interface ConfigViewFilter { section?: string; q?: string }

/** Every setting the Config tab shows, with where its value comes from and whether it can be changed. */
export function buildConfigView({ config, storage, provenance }: ConfigViewDeps, filter: ConfigViewFilter = {}): ConfigView {
    const editable = storage.supportsConfigPersistence();
    const schema: Record<string, ConfigViewEntry> = {};
    const section = filter.section?.trim().toLowerCase() || '';
    const q = filter.q?.trim().toLowerCase() || '';
    const wanted = (path: string, description: string): boolean =>
        (!section || path.split('.')[0] === section) && (!q || path.toLowerCase().includes(q) || description.toLowerCase().includes(q));

    for (const field of CONFIG_FIELDS) {
        if (field.adminDisplay === 'hidden') continue;
        if (!wanted(field.dotPath, field.description)) continue;
        const sealed = isSealed(config, field.dotPath);
        const appliesAt = !field.immutable && field.applies === 'restart' ? { appliesAt: 'restart' as const } : {};

        if (field.adminDisplay === 'configured') {
            // Secret fields — show as boolean indicating whether configured
            const configuredPath = `${field.dotPath}_configured`;
            const src = sealed ? 'sealed' : provenance?.getSource(field.dotPath);
            const settable = editable && !field.immutable && !sealed;
            schema[configuredPath] = {
                value: !!readConfigField(config, field),
                type: 'boolean',
                description: `Whether ${field.description.toLowerCase().replace(' (secret)', '')} is configured (read-only secret)`,
                mutable: false,
                editable: false,
                path: configuredPath,
                source: src ?? 'default',
                // A saved secret can be removed, which brings back the one the environment gives.
                canReset: settable && src === 'database',
                ...(sealed ? { sealed: true } : {}),
                ...(settable ? { set_path: field.dotPath } : {}),
                ...appliesAt,
                ...(provenance?.awaitsRestart(field.dotPath) ? { restartPending: true } : {}),
            };
            continue;
        }

        // Normal field — show actual value
        const typeStr = field.type === 'number' ? 'integer' : field.type;
        // A sealed path answers "where did this come from" with the seal rather than with
        // whether the host happened to pass it as env or as file: the seal is the operative
        // fact, and it is what the admin tab badges. The VALUE is untouched and present — the
        // operator is entitled to see what their limits are, only not to move them.
        const src = sealed ? 'sealed' : (provenance?.getSource(field.dotPath) ?? 'default');
        // A number's range is a limit (a larger value is refused) or a recommendation (a larger
        // value is accepted); the page words the range by it.
        const rangeKind = rangeKindOf(field);
        schema[field.dotPath] = {
            value: readConfigField(config, field),
            type: typeStr,
            description: field.description,
            ...(field.range ? { range: field.range } : {}),
            ...(rangeKind ? { rangeKind } : {}),
            ...(field.choices ? { choices: field.choices } : {}),
            mutable: !field.immutable && !sealed,
            editable: editable && !field.immutable && !sealed,
            path: field.dotPath,
            source: src,
            canReset: src === 'database',
            ...(sealed ? { sealed: true } : {}),
            ...appliesAt,
            // The running value is not the one the next start uses: an override was removed, or a
            // value was saved for a row that takes effect at the next start.
            ...(provenance?.awaitsRestart(field.dotPath) ? { restartPending: true } : {}),
        };
    }

    // Combined virtual field: VAPID keys configured
    if (wanted('push.vapid_configured', 'VAPID keys')) schema['push.vapid_configured'] = {
        value: !!config.vapidPublicKey && !!config.vapidPrivateKey,
        type: 'boolean',
        description: 'Whether VAPID keys are configured (read-only secret)',
        mutable: false,
        editable: false,
        path: 'push.vapid_configured',
        source: 'default',
        canReset: false,
    };

    return {
        editable,
        storageType: config.storageProvider,
        note: editable ? undefined : 'In-memory storage detected. Config is read-only. Use .env or aimeat.ini to configure this node.',
        sealed: config.sealedConfigKeys,
        sealedNote: config.sealedConfigKeys.length > 0
            ? 'Some settings here are set by whoever runs this node. You can see them; changing them is a conversation with them.'
            : undefined,
        schema,
    };
}

export type ChangeSettingsResult =
    | { ok: true; applied: ConfigApplyResult['applied']; errors?: ConfigApplyResult['errors']; note: string }
    | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown>; sealed?: boolean };

/**
 * Check and apply a batch of setting changes for an operator: what PUT /v1/admin/config and
 * aimeat_admin_config_set both do. The caller has already been checked to be an operator.
 */
export async function changeNodeSettings(deps: ConfigViewDeps, caller: SwitchCaller, changes: unknown): Promise<ChangeSettingsResult> {
    const { config, storage } = deps;
    // In-memory guard — config editing requires persistent storage
    if (!storage.supportsConfigPersistence()) {
        return { ok: false, status: 403, code: 'READONLY_CONFIG',
            message: 'Config editing requires a persistent database (PostgreSQL or SQLite). Use .env or aimeat.ini created with "aimeat init".' };
    }
    if (!Array.isArray(changes) || changes.length === 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Body must contain "changes" array with [{path, value}] entries' };
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
        return { ok: false, status: 403, code: refusal.code, sealed: true, details: { sealed: sealedPaths },
            message: sealedPaths.length === 1
                ? refusal.message
                : `${sealedPaths.join(', ')} are set by whoever runs this node and cannot be changed here. Nothing in this request was applied.` };
    }

    // A setting an AI may only make stricter (its row's `aiMayOnlyTighten`: the classification switch,
    // the sign-in policy, who is asked before another account's capability uses a person's sign-in, and
    // any row that says so later) is refused a looser value from an AI credential, each change from the
    // value the one before it leaves (secaudit 2026-10-31 inv-14), before anything in the request is
    // applied (services/config/strictness.ts). The refusals of the groups up to the sign-in policy are
    // answered before its two cross-checks below and the later groups after them, the order these
    // checks had when each was written out here, so a request with two refusals gets the same answer.
    const loosening = requestLooseningRefusal(caller, config, changes as ConfigChange[]);
    const refusedRequest = (r: TightenRefusal): ChangeSettingsResult => ({ ok: false, status: r.status, code: r.code,
        ...(r.details ? { details: r.details } : {}), message: `${r.message} Nothing in this request was applied.` });
    if (loosening && loosening.rank <= tightenOnlyRank(TWO_STEP_REQUIRED_PATH)) return refusedRequest(loosening);
    const modeBefore = config.classificationMode;

    // The sign-in policy's cross-checks (services/sign-in-policy.ts): two-step sign-in required needs
    // TOTP on, and password sign-in off is refused while no operator account has another way in, on the
    // values the whole request leaves. Nothing in the request is applied when either refuses.
    const policyAt: Record<string, unknown> = {
        [TWO_STEP_REQUIRED_PATH]: config.twoStepRequired, [PASSWORD_SIGN_IN_PATH]: config.passwordSignIn,
        [TOTP_ENABLED_PATH]: config.totpEnabled,
    };
    let movedLast: typeof TWO_STEP_REQUIRED_PATH | typeof TOTP_ENABLED_PATH | null = null;
    for (const change of changes as Array<{ path?: unknown; value?: unknown }>) {
        const path = change?.path;
        if (path !== TOTP_ENABLED_PATH && path !== TWO_STEP_REQUIRED_PATH && path !== PASSWORD_SIGN_IN_PATH) continue;
        if (!MUTABLE_CONFIG_MAP[path]?.validate(change.value)) continue;
        policyAt[path] = change.value;
        if (path !== PASSWORD_SIGN_IN_PATH) movedLast = path;
    }
    // Two-step sign-in required needs TOTP on: refused whichever of the two the request moves, on the
    // values the whole batch leaves (so one request may switch TOTP on and require it).
    if (movedLast) {
        const needsTotp = twoStepWithoutTotpRefusal(policyAt[TWO_STEP_REQUIRED_PATH], policyAt[TOTP_ENABLED_PATH], movedLast);
        if (needsTotp) return { ok: false, status: needsTotp.status, code: needsTotp.code, message: `${needsTotp.message} Nothing in this request was applied.` };
    }
    if (policyAt[PASSWORD_SIGN_IN_PATH] === 'off' && config.passwordSignIn !== 'off') {
        const lockout = await passwordOffLockoutRefusal(storage, config.nodeId);
        if (lockout) return { ok: false, status: lockout.status, code: lockout.code, message: `${lockout.message} Nothing in this request was applied.` };
    }
    // The groups after the sign-in policy (mcp.capability_use_approval, and any later row), as before.
    if (loosening) return refusedRequest(loosening);

    // The loop that checks, persists and applies each change: services/config/apply.ts, shared with
    // the other door that changes settings (Themes & Styles' who-chooses). It asks the same rule for the
    // same caller, and finds nothing more to refuse.
    const { applied, errors } = await applyConfigChanges({ ...deps, caller }, changes as ConfigChange[]);
    if (applied.some(a => a.path === CLASSIFICATION_MODE_PATH) && config.classificationMode !== modeBefore) {
        recordSwitchChange(config.nodeId, caller, modeBefore, config.classificationMode);
        // A node that ran before gets the default caps offered when classification comes into use (L5.1).
        await offerDefaultCapsWhenSwitchedOn(config, storage, modeBefore, config.classificationMode);
        emitChange('classification');
    }

    if (applied.length > 0) {
        // Who changed which setting, and when (QA audit E2-04). The paths only: a value can be a key.
        const actorGaii = resolveIdentity(caller, config.nodeId);
        recordOperatorNodeAct({
            operatorGhii: ownerGhiiOf(actorGaii), actorGaii, area: 'config', action: 'set',
            meta: { paths: applied.map(a => a.path).join(', '), count: applied.length },
        });
    }

    if (applied.length === 0 && errors.length > 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'No valid changes applied', details: { errors } };
    }
    emitChange('config');
    const later = applied.filter(a => a.applies === 'restart').map(a => a.path);
    return {
        ok: true,
        applied,
        ...(errors.length > 0 ? { errors } : {}),
        note: later.length === 0
            ? 'Config updated and persisted to database. Changes survive restart.'
            : `Config persisted to database. ${later.join(', ')} ${later.length === 1 ? 'takes' : 'take'} effect when this node next starts; until then it runs with the old value.`,
    };
}
