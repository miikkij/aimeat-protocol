/**
 * @file src/services/extension-first-use-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: every extension installed when this node first starts with the
 *   first-use rules of secaudit 2026-10 (v58, v59) keeps the first use it had before them.
 *
 *   WHY. Before the audit, the first use of a vault secret with no host bound it to whatever host the
 *   extension's script named, whoever called. The new rules ask who wrote the code, what it declares
 *   and who calls. aimeat.io runs 95 active extensions written before any declaration existed, and the
 *   developer's ruling is that they keep working exactly as before (Jouni, 2026-10-21): the v59 hole is
 *   an agent writing NEW code that chooses a host, and code that already exists is frozen. So each
 *   installed record is marked once, here, and a marked extension of the caller's own account binds a
 *   first use as at HEAD (services/extension-secret-authority.ts). Another account's extension is not
 *   covered: its code never binds the caller's unbound secret (v58), marked or not.
 *
 *   THE MARK GOES WITH THE CODE. It is a __-prefixed config key, which no manifest and no config write
 *   can set (extension-manifest.ts stripNodeOwnedConfig, extension-config-set.ts RESERVED_KEY). A
 *   code write (a redeploy, a ZIP upload, a package reinstall) carries it with carryFirstUseKeep()
 *   only when every script is byte-identical, and drops it when any script changed. The route that
 *   changes a script in place (PATCH /v1/extensions/:name/actions/:id) drops it with
 *   withoutFirstUseKeep(). A config change keeps it, because the code did not change. A new install
 *   after a delete starts without it.
 *
 *   NOT MARKED: the extensions the node seeds itself (installed by `system`, living-hooks and
 *   vocab-finto). living-hooks has its own rule in extension-secret-authority.ts.
 *
 *   WHERE. The step's record is `migrations.extension-first-use-keep` under `system@<nodeId>`:
 *   { at, names }. It runs before the node serves (server-bootstrap/once-only-keep-steps.ts).
 * @structure FIRST_USE_KEEP_KEY · keepsPreAuditFirstUse(config) · withoutFirstUseKeep(config) ·
 *   carryFirstUseKeep(nextConfig, nextActions, previous) · keepExtensionFirstUseOnce(storage, config)
 * @usage
 *   await keepExtensionFirstUseOnce(storage, config);              // server-bootstrap/once-only-keep-steps.ts
 *   if (keepsPreAuditFirstUse(extConfig)) ...                     // extension-secret-authority.ts
 * @version-history
 *   2026-10-27 — secaudit2026oct26: only an extension installed before the rule's first try on this
 *     node gets the mark, also when the step runs at a later start (keptBefore, madeBefore).
 *   v1.1.0 — 2026-10-21 — carryFirstUseKeep: byte-identical code keeps the mark through a redeploy,
 *     a ZIP upload or a package reinstall; only a changed script drops it.
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59; the developer's ruling on old extensions).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep, keptBefore, madeBefore } from './once-only-step.js';

/** The mark on an extension record's config. __-prefixed, so no manifest or config write can set it. */
export const FIRST_USE_KEEP_KEY = '__keepsPreAuditFirstUse';

/** The record under `system@<nodeId>` that says the step has run, and which extensions it marked. */
export const FIRST_USE_KEEP_STEP_KEY = 'migrations.extension-first-use-keep';

/** The installer the node's own extensions are recorded under (BUILTIN_EXTENSION_OWNER). */
const NODE_INSTALLER = 'system';

/** True when this extension's code existed before the first-use rules and keeps the old first use. */
export function keepsPreAuditFirstUse(config: Record<string, unknown> | undefined): boolean {
    return typeof config?.[FIRST_USE_KEEP_KEY] === 'string';
}

/** The config without the mark: what a code write stores, so changed code falls under the new rules. */
export function withoutFirstUseKeep(config: Record<string, unknown>): Record<string, unknown> {
    if (!(FIRST_USE_KEEP_KEY in config)) return config;
    const out = { ...config };
    delete out[FIRST_USE_KEEP_KEY];
    return out;
}

/** Same code: the same action ids, each with the same script, byte for byte. */
function sameScripts(
    a: ReadonlyArray<{ id: string; scriptContent?: string }>, b: ReadonlyArray<{ id: string; scriptContent?: string }>,
): boolean {
    if (a.length !== b.length) return false;
    const before = new Map(b.map(x => [x.id, x.scriptContent ?? '']));
    return a.every(x => before.has(x.id) && before.get(x.id) === (x.scriptContent ?? ''));
}

/**
 * The config a code write stores: with the previous record's mark when the code is byte-identical
 * (the same action ids and the same scripts), so a redeploy, a reinstall or a package reinstall of the
 * same code changes nothing; without it when any script changed, so changed code falls under the
 * first-use rules (Jouni, 2026-10-21).
 */
export function carryFirstUseKeep(
    nextConfig: Record<string, unknown>,
    nextActions: ReadonlyArray<{ id: string; scriptContent?: string }>,
    previous: { config?: Record<string, unknown>; actions?: ReadonlyArray<{ id: string; scriptContent?: string }> } | null | undefined,
): Record<string, unknown> {
    if (!previous || !keepsPreAuditFirstUse(previous.config) || !sameScripts(nextActions, previous.actions ?? [])) {
        return withoutFirstUseKeep(nextConfig);
    }
    return { ...nextConfig, [FIRST_USE_KEEP_KEY]: previous.config![FIRST_USE_KEEP_KEY] };
}

/**
 * Mark, once per node, every installed extension that the node did not seed itself. Throws when a
 * read or a write fails, and then leaves no record, so the next start tries again; a record marked
 * by a failed run stays marked, which is what the next run would do anyway.
 */
export async function keepExtensionFirstUseOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; names: string[] }> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, FIRST_USE_KEEP_STEP_KEY);
    if (!claim) return { ran: false, names: [] };
    try {
        const at = new Date().toISOString();
        // Only what was installed before the rule first took effect here, also on a later start after a
        // failed one: an extension written under the rule never gets the mark (secaudit2026oct26).
        const cutoff = keptBefore(claim);
        const names: string[] = [];
        for (const ext of await storage.listExtensions({ lean: true })) {
            if (ext.installedBy === NODE_INSTALLER || keepsPreAuditFirstUse(ext.config)) continue;
            if (!madeBefore(ext.installedAt, cutoff)) continue;
            const updated = await storage.updateExtension(ext.name, { config: { ...(ext.config ?? {}), [FIRST_USE_KEEP_KEY]: at } });
            if (!updated) throw new Error(`extension first-use keep: the mark on ${ext.name} did not land`);
            names.push(ext.name);
        }
        await claim.finish({ at, names });
        if (names.length) logger.info(`Extensions: ${names.length} installed before the first-use rules keep their first use`, { names });
        return { ran: true, names };
    } catch (err) {
        await claim.release();
        throw err;
    }
}
