/**
 * @file src/services/publish-actors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The principals the node's publish gate (services/publish-gate.ts) is asked about when
 *   content is made public from inside an extension or a workflow, where there is no request whose
 *   caller object a route could ask.
 *
 *   WHY. POST /v1/datapackages, aimeat_datapackage_publish and the upload routes ask the gate about
 *   their caller: an agent without publish:public stores the content at the level it had and files a
 *   request the owner approves. ctx.datapackage.publish, ctx.files.write and the workflow datapackage
 *   step reached the same stores and asked nobody, so an agent that could not publish a package
 *   through the route published it through an extension it installed, or through a workflow step
 *   (secaudit 2026-10, v68 and v69). Each of those code paths now names the principals behind it
 *   here, and asks the gate about every one of them:
 *
 *   - an extension action a caller invokes: that caller (invokingActor);
 *   - an extension action with nobody present: the principal that installed it (installerActor),
 *     because that principal wrote the code that chooses what is made public;
 *   - a workflow run: the principal the run acts for (runActor).
 *
 *   The gate's own rule is unchanged: the owner in person always may, an agent with publish:public
 *   may, an app may unless the node's gate covers apps, and every node whose gate is off (the code
 *   default) allows everyone, so nothing here changes on such a node.
 *
 *   WHAT EXISTS KEEPS WORKING. An extension an agent installed before this rule keeps publishing as
 *   before until its code changes, and a workflow saved before it until its next save
 *   (services/extension-publish-keep.ts). A run started before runs recorded their principal acts for
 *   the owner, as it always has.
 * @structure PublishActor · invokingActor · principalActor · installerActor · runActor · askActors
 * @usage
 *   const actors = [invokingActor(storage, config.nodeId, caller)];
 *   const ask = askActors({ storage, config }, actors);   // allowed | refused | ask (requester)
 * @version-history
 *   v1.0.1 — 2026-10-27 — installerActor passes the extension's installedAt to the keep check
 *     (secaudit2026oct26, keep-matched-by-reusable-identifier).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v68 and v69).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { WorkflowRun, WorkflowSaver } from '../models/workflow-schemas.js';
import { callerFromAuth, type CallerContext, type CallerKind } from './caller-context.js';
import { publishAskOf, type PublishAsk } from './publish-requests/ask.js';
import type { PublishStoreCtx } from './publish-requests/store.js';
import { saverAuthority } from './workflow/trigger-authority.js';
import { isGEAI } from '../utils/gaii.js';
import { keepsPrePublishGate, definitionPredatesPublishGate } from './extension-publish-keep.js';

/** A principal the gate is asked about, as the gate reads it. */
export interface PublishActor {
    caller: CallerContext;
    /** An app grant's `owner/filename`, so a request names the app (publishAskOf). */
    app?: string;
    /** The name a request carries when the caller object cannot spell it: a hosted app's GEAI. */
    requesterPrincipal?: string;
}

/** The account holder, who the gate always lets publish. */
function ownerActor(storage: Storage, nodeId: string, ownerName: string): PublishActor {
    return { caller: callerFromAuth({ sub: ownerName, owner: ownerName, roles: ['owner'], scopes: [] }, nodeId, storage) };
}

/**
 * The caller of an extension action (services/extension-invoke.ts ExtensionInvokeCaller). The kind
 * is the one the surface decided, so a visitor from another node stays a visitor.
 */
export function invokingActor(
    storage: Storage, nodeId: string,
    c: { gaii: string; metered?: string; owner: string; kind: CallerKind; roles: readonly string[]; scopes: readonly string[] },
): PublishActor {
    const base = callerFromAuth({ sub: c.gaii, owner: c.owner, roles: c.roles, scopes: c.scopes }, nodeId, storage);
    const caller: CallerContext = base.kind === c.kind ? base : { ...base, kind: c.kind };
    return {
        caller,
        ...(c.kind === 'app' && typeof c.metered === 'string' && c.metered.startsWith('eco:') ? { requesterPrincipal: c.metered } : {}),
    };
}

/**
 * A recorded principal (a workflow saver or a run's principal, an extension's installer) with the
 * permissions it holds NOW, read as the trigger reads them (trigger-authority.ts saverAuthority). One
 * that is gone holds none, so the gate asks the owner about it.
 */
export async function principalActor(storage: Storage, nodeId: string, ownerName: string, who: WorkflowSaver): Promise<PublishActor> {
    if (who.kind === 'owner') return ownerActor(storage, nodeId, ownerName);
    const now = await saverAuthority(storage, who);
    const scopes = now.gone ? [] : now.scopes;
    if (who.kind === 'app') {
        const grant = who.id ? await storage.getAppGrant(who.id) : null;
        return {
            caller: callerFromAuth({ sub: `${ownerName}@${nodeId}`, owner: ownerName, roles: ['app'], scopes }, nodeId, storage),
            ...(grant?.app ? { app: grant.app } : {}),
        };
    }
    return { caller: callerFromAuth({ sub: who.id, owner: ownerName, roles: [who.kind], scopes }, nodeId, storage) };
}

/**
 * Whom an extension's unattended run publishes for: the principal that installed it. A name with no
 * `#` is the account itself (the owner in person, or an app grant, whose `sub` is the account's GHII).
 * An extension an agent or an ecosystem app installed before this rule, with its code unchanged since,
 * publishes for the owner as it did (services/extension-publish-keep.ts).
 */
export async function installerActor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, ext: Pick<ExtensionRecord, 'name' | 'actions' | 'installedByPrincipal'> & { installedAt?: string }, ownerName: string,
): Promise<PublishActor> {
    const principal = (ext.installedByPrincipal ?? '').trim();
    if (!principal.includes('#') || await keepsPrePublishGate(storage, config.nodeId, ext)) {
        return ownerActor(storage, config.nodeId, ownerName);
    }
    return principalActor(storage, config.nodeId, ownerName, { kind: isGEAI(principal) ? 'ecosystem' : 'agent', id: principal });
}

/**
 * Whom a workflow run publishes for: its recorded principal. Null when nobody but the owner is behind
 * it: the owner in person, a run started before runs recorded a principal (2026-10-20), or a
 * definition last saved before this rule (services/extension-publish-keep.ts), which keeps publishing
 * as it did until its next save.
 */
export async function runActor(
    storage: Storage, nodeId: string, ownerName: string, run: Pick<WorkflowRun, 'principal' | 'defSnapshot'>,
): Promise<PublishActor | null> {
    const principal = run.principal;
    if (!principal || principal.kind === 'owner') return null;
    if (await definitionPredatesPublishGate(storage, nodeId, run.defSnapshot)) return null;
    return principalActor(storage, nodeId, ownerName, principal);
}

/**
 * The gate's answer for all of them: allowed when every actor may publish; otherwise the first refusal
 * (nobody on this node to ask) or the first actor the owner is asked about.
 */
export function askActors(ctx: PublishStoreCtx, actors: readonly PublishActor[]): PublishAsk {
    for (const a of actors) {
        const ask = publishAskOf(ctx, a.caller, a.app);
        if (ask.kind === 'refused') return ask;
        if (ask.kind === 'ask') {
            return a.requesterPrincipal ? { kind: 'ask', requester: { ...ask.requester, principal: a.requesterPrincipal } } : ask;
        }
    }
    return { kind: 'allowed' };
}
