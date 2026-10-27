/**
 * @file src/services/extension-publish-keep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A once-per-node step: the extensions an agent or an ecosystem app installed, and the
 *   workflows saved, before their unattended publishing asked the node's publish gate keep publishing
 *   as they did, until their code or definition changes.
 *
 *   WHY. Since secaudit 2026-10 (v68, v69) an extension's unattended run (a manifest schedule, an
 *   @activate job, a workflow step, an AI job's on_done) asks the node's publish gate about the
 *   principal that installed it before ctx.files.write or ctx.datapackage.publish makes something
 *   public, and a workflow run asks it about the run's principal before a datapackage step publishes
 *   (services/publish-actors.ts). Before, nothing asked. A producer an agent installed, or a
 *   workflow an agent saved, published public on its clock on a node with the gate on, and purpose
 *   rule 6 says what exists at the update keeps working: the new rule governs what is written after.
 *
 *   WHAT IS KEPT.
 *   - Each installed extension whose installer is an agent or an ecosystem app (an
 *     `installedByPrincipal` with a `#`), with a digest of its action scripts. The installer reads as
 *     the account holder while the scripts still match. A changed script, a new action or a removed
 *     one ends the keep, so the gate applies from the next code write. A config change keeps it.
 *   - Every workflow definition saved before the step ran (`at`): a run of a definition whose
 *     `updatedAt` is earlier publishes for the owner, as before. The next save of the definition ends
 *     it, as every save already holds a definition to the rules in force.
 *   An extension the account holder installed in person, and a workflow the owner runs in person,
 *   need no keep: the gate always lets the owner publish.
 *
 *   WHERE. `migrations.extension-publish-gate-keep` under `system@<nodeId>`: { at, kept: { name: digest } }.
 *   It runs before the node serves (server-bootstrap/once-only-keep-steps.ts). Until it has run, nothing
 *   is kept: a node whose step failed asks the gate, and the next start runs the step again.
 * @structure PUBLISH_KEEP_STEP_KEY · scriptsDigest(actions) · keepsPrePublishGate(storage, nodeId, ext) ·
 *   definitionPredatesPublishGate(storage, nodeId, def) · keepExtensionPublishOnce(storage, config)
 * @usage
 *   await keepExtensionPublishOnce(storage, config);                 // server-bootstrap/once-only-keep-steps.ts
 *   if (await keepsPrePublishGate(storage, nodeId, ext)) ...         // services/publish-actors.ts
 * @version-history
 *   v1.1.0 — 2026-10-27 — keepsPrePublishGate keeps only an extension installed before the step: a
 *     new install under a kept name, with the same scripts, is not kept (secaudit2026oct26,
 *     keep-matched-by-reusable-identifier).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v68 and v69; purpose rule 6).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';

/** The record under `system@<nodeId>` that says the step has run, when, and which extensions it kept. */
export const PUBLISH_KEEP_STEP_KEY = 'migrations.extension-publish-gate-keep';

interface PublishKeep { at?: unknown; kept?: Record<string, unknown> }

async function readKeep(storage: Storage, nodeId: string): Promise<PublishKeep | null> {
    const value = (await storage.getMemory(`system@${nodeId}`, PUBLISH_KEEP_STEP_KEY))?.value as PublishKeep | undefined;
    // A claim still running carries no `at`: nothing is kept yet.
    return value && typeof value.at === 'string' ? value : null;
}

/** One digest of every action id and its script, in id order: the code an extension runs. */
export function scriptsDigest(actions: ReadonlyArray<{ id: string; scriptContent?: string }>): string {
    const h = createHash('sha256');
    for (const a of [...actions].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
        h.update(a.id).update('\0').update(a.scriptContent ?? '').update('\0');
    }
    return h.digest('hex');
}

/**
 * True when this extension was installed by an agent or an app before the step, with the same code
 * now. A new install under the same name after an uninstall is a new extension, whoever installed
 * it: its `installedAt` is later than the step, while a redeploy keeps `installedAt` (as
 * services/extension-consent.ts reads it), so it is not kept (secaudit2026oct26,
 * keep-matched-by-reusable-identifier).
 */
export async function keepsPrePublishGate(
    storage: Storage, nodeId: string, ext: Pick<ExtensionRecord, 'name' | 'actions'> & { installedAt?: string },
): Promise<boolean> {
    const keep = await readKeep(storage, nodeId);
    const kept = keep?.kept;
    const digest = kept && Object.hasOwn(kept, ext.name) ? kept[ext.name] : undefined;
    if (typeof digest !== 'string' || digest !== scriptsDigest(ext.actions ?? [])) return false;
    const installed = ext.installedAt ? Date.parse(ext.installedAt) : NaN;
    const at = Date.parse(keep!.at as string);
    return Number.isNaN(installed) || Number.isNaN(at) || installed < at;
}

/** True when this workflow definition was last saved before the step ran. */
export async function definitionPredatesPublishGate(
    storage: Storage, nodeId: string, def: { updatedAt?: string },
): Promise<boolean> {
    const at = (await readKeep(storage, nodeId))?.at as string | undefined;
    return !!at && typeof def.updatedAt === 'string' && def.updatedAt < at;
}

/**
 * Record, once per node, the time and every installed extension whose installer is an agent or an
 * ecosystem app. Throws when a read fails, and then leaves no record, so the next start tries again.
 */
export async function keepExtensionPublishOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; names: string[] }> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, PUBLISH_KEEP_STEP_KEY);
    if (!claim) return { ran: false, names: [] };
    try {
        const at = new Date().toISOString();
        const kept: Record<string, string> = {};
        for (const lean of await storage.listExtensions({ lean: true })) {
            if (!(lean.installedByPrincipal ?? '').includes('#')) continue;
            // The lean list leaves the scripts out; the digest needs them.
            const ext = await storage.getExtension(lean.name);
            if (ext) kept[ext.name] = scriptsDigest(ext.actions ?? []);
        }
        await claim.finish({ at, kept });
        const names = Object.keys(kept);
        if (names.length) logger.info(`Extensions: ${names.length} installed by an agent or an app before the publish gate reached their unattended runs keep publishing as before`, { names });
        return { ran: true, names };
    } catch (err) {
        await claim.release();
        throw err;
    }
}
