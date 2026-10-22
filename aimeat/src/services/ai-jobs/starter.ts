/**
 * @file src/services/ai-jobs/starter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who an AI job reads its inputs as (TARGET-082 V4, decided 2026-09-29). A job stores
 *   who started it and reads its inputs as that starter; a job with no starter recorded (started
 *   before this change, by an extension, or by a chain) and a scheduled job read as an unattended
 *   run, which classification counts as an AI, the strictest reader.
 *
 *   The starter is taken from the verified credential when the job is created (startedByOf), never
 *   from the request body, and it holds only what a reader is rebuilt from: the identity, the
 *   account name, the roles, the scopes and the `via` mark. Never a token. Nothing here grants the
 *   job anything: whose key pays and whose namespace it reads is still the job's `owner`.
 *
 *   The same starter is who the job WRITES its answer as (jobWriter, through the shared memory write
 *   in services/memory-write.ts) and decides whether the job may name an extension action as its
 *   `on_done` (starterMayInvokeExtensions).
 * @structure startedByOf(auth, principal) · jobReader(deps, job) · jobCaller(job) · unattendedReader(deps, ownerGaii) ·
 *   jobWriter(job) · starterMayInvokeExtensions(startedBy) · onDoneScopeRefusal(startedBy) · jobReadViewer(job)
 * @usage
 *   startJob(input, { ownerGhii, createdBy, startedBy: startedByOf(req.auth!, ownerGhii) });
 *   const reader = jobReader({ storage, config }, job);
 *   const written = await writeMemoryRecord(deps, jobWriter(job), { ... });
 * @version-history
 *   v1.4.0 -- 2026-10-22 -- jobReadViewer(): the job hands its model only the same-owner records and
 *     files its starter, or the principal an extension's code reads as (`read_as`), may read; the
 *     owner in person, an app grant and memory:read-as-owner read all (secaudit 2026-10, r49, v75).
 *   v1.3.0 — 2026-10-21 — onDoneScopeRefusal(): an app is told what its author declares, an agent to
 *     ask its owner.
 *   v1.2.0 — 2026-10-20 — jobWriter(): the answer is written through the shared memory write as the
 *     job's starter, so the publish gate, the closed-node level, the label audience cap and the
 *     organism namespace rule apply to it; a job with no starter writes as its owner, as before
 *     (secaudit 2026-10, writeResult:raw-write-caller-chosen-visibility). starterMayInvokeExtensions():
 *     `on_done` runs an extension action unattended, which costs ext:invoke for a starter that is not
 *     the owner in person (secaudit 2026-10, assertCallbackAllowed:on-done-asks-no-ext-invoke).
 *     startedByOf() keeps the visitor mark.
 *   v1.1.0 — 2026-10-05 — The starter keeps the app an app grant names, and jobCaller() says who the
 *     job's model call runs as, so the owner's rules for that app or agent apply to it (secaudit
 *     2026-10, AI-3).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { readerForCaller, type ContentReader } from '../classification/reader.js';
import { aiCallerFromCredential, aiCallerOfPrincipal, type AiCallerContext } from '../ai/caller-context.js';
import type { MemoryWriteCaller } from '../memory-write.js';
import { aiReadViewerOf, type AiReadViewer } from '../ai-read-viewer.js';
import type { AiJobRecord, AiJobStartedBy } from './types.js';

type ReaderDeps = { storage: Storage; config: AimeatConfig };

/** The credential fields read. `req.auth` fits. */
interface StarterCredential {
    owner: string;
    roles: readonly string[];
    scopes?: readonly string[];
    via?: string;
    /** The app an app grant names (`req.auth.app`). */
    app?: string | null;
    /** A session from another node (`req.auth.federated`). */
    federated?: boolean;
}

/**
 * The starter's facts from a verified credential. `principal` is the identity the caller already
 * resolved (resolveIdentity for a request, the agent's GAII on the MCP surface).
 */
export function startedByOf(auth: StarterCredential, principal: string): AiJobStartedBy {
    return {
        principal,
        owner: auth.owner,
        roles: [...auth.roles],
        scopes: [...(auth.scopes ?? [])],
        ...(auth.via ? { via: auth.via } : {}),
        ...(auth.roles.includes('app') && auth.app ? { app: auth.app } : {}),
        ...(auth.federated === true ? { federated: true } : {}),
    };
}

/**
 * Who the job's answer is written as (services/memory-write.ts): the starter, with the roles and
 * scopes its credential carried, into the job owner's namespace. So a raise to public by an agent
 * without publish:public stays private and files a request for the owner, the closed-node level and
 * the label audience cap apply, and an `organism.*` result key is held to the organism namespace
 * rule, exactly as the starter's own memory write would be.
 *
 * A job with no starter recorded (ctx.ai.start in an extension, a chain's next job, a job stored
 * before starters were kept) writes as its owner in person, which is what it did before: the
 * extension that starts it was installed by that owner and runs on their behalf.
 */
export function jobWriter(job: Pick<AiJobRecord, 'owner' | 'started_by'>): MemoryWriteCaller {
    const s = job.started_by;
    if (!s) return { principal: job.owner, targetGaii: job.owner, roles: ['owner'], scopes: [] };
    return {
        principal: s.principal,
        targetGaii: job.owner,
        roles: [...s.roles],
        scopes: [...s.scopes],
        ...(s.federated ? { federated: true } : {}),
        ...(s.app ? { app: s.app } : {}),
    };
}

/**
 * May this starter name an extension action as the job's `on_done`. The action runs unattended in
 * the owner's name when the answer lands, which is what POST /v1/ext/:ext/:action and a workflow
 * extension step charge `ext:invoke` for, so a starter that is not the owner in person needs that
 * word too. No starter recorded is ctx.ai.start in an extension continuing its own chain: allowed.
 */
export function starterMayInvokeExtensions(s: AiJobStartedBy | undefined): boolean {
    return !s || isOwnerInPerson(s) || scopeIsCovered(s.scopes, 'ext:invoke');
}

/**
 * The refusal when starterMayInvokeExtensions says no, worded for who can fix it. An app's grant
 * holds the words the app's own `aimeat-scopes` asks for, and its owner cannot add one to it, so the
 * app's author is told what to change. An agent is told to ask its owner, who grants agent words.
 */
export function onDoneScopeRefusal(s: AiJobStartedBy | undefined): string {
    const need = 'on_done runs one of the owner\'s extension actions when the job is done, and that needs the "ext:invoke" permission, which this sign-in does not carry. ';
    if (s?.app) {
        return need + `The app's author adds ext:invoke to the app's <meta name="aimeat-scopes"> (keeping the words it already asks for) and publishes it again; `
            + 'the person approves the word at their next sign-in. Until then, start the job without on_done and read the answer with AIMEAT.ai.job.waitFor.';
    }
    return need + 'Ask the owner to give this agent ext:invoke, or start the job without on_done and read the answer when the job is done.';
}

/**
 * Who the job's model call runs as (services/ai/caller-context.ts): the app or the agent that
 * started it, under the owner's rules for that app or agent. A job with no starter recorded, from
 * before starters were kept, runs as the identity that owns it.
 */
export function jobCaller(job: Pick<AiJobRecord, 'owner' | 'started_by'>): AiCallerContext {
    const s = job.started_by;
    return s ? aiCallerFromCredential({ roles: s.roles, app: s.app }, s.principal) : aiCallerOfPrincipal(job.owner);
}

/**
 * The node running something for an owner with nobody present: role operator alone, which
 * reader-kind.ts counts as an AI. A scheduled job, and an AI job with no starter recorded.
 */
export function unattendedReader(deps: ReaderDeps, ownerGaii: string): ContentReader {
    return readerForCaller(deps, { gaii: ownerGaii, owner: localAccountName(ownerGaii), roles: ['operator'], scopes: [] });
}

/**
 * Which same-owner records and files the job may hand its model (services/ai-inputs.ts): the
 * principal an extension's code reads as when one is recorded (`read_as`), else the starter. No
 * starter and no `read_as` (ctx.ai.start on the owner's reach, a chain, a job stored before
 * starters) is no viewer, which reads the owner scope as before.
 */
export function jobReadViewer(job: Pick<AiJobRecord, 'started_by' | 'read_as'>): AiReadViewer | undefined {
    const r = job.read_as;
    if (r) {
        return aiReadViewerOf(r, `This job was started by extension code that ${r.principal} wrote, so it reads what ${r.principal} may read. `
            + 'When the extension runs on its own, you choose what it reads on its page at /profile?tab=extensions.');
    }
    return aiReadViewerOf(job.started_by);
}

/** The reader an AI job reads its prompt record, its input records and its audio file with. */
export function jobReader(deps: ReaderDeps, job: Pick<AiJobRecord, 'owner' | 'started_by'>): ContentReader {
    const s = job.started_by;
    if (!s) return unattendedReader(deps, job.owner);
    // Built as a variable, not as a literal in the call: readerForCaller decides the kind from the
    // whole object it is given (readerKindOf), so `via` reaches that decision even though the
    // parameter type does not name it.
    const caller = { gaii: s.principal, owner: s.owner, roles: [...s.roles], scopes: [...s.scopes], ...(s.via ? { via: s.via } : {}) };
    return readerForCaller(deps, caller);
}
