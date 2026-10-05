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
 * @structure startedByOf(auth, principal) · jobReader(deps, job) · jobCaller(job) · unattendedReader(deps, ownerGaii)
 * @usage
 *   startJob(input, { ownerGhii, createdBy, startedBy: startedByOf(req.auth!, ownerGhii) });
 *   const reader = jobReader({ storage, config }, job);
 * @version-history
 *   v1.1.0 — 2026-10-05 — The starter keeps the app an app grant names, and jobCaller() says who the
 *     job's model call runs as, so the owner's rules for that app or agent apply to it (secaudit
 *     2026-10, AI-3).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { readerForCaller, type ContentReader } from '../classification/reader.js';
import { aiCallerFromCredential, aiCallerOfPrincipal, type AiCallerContext } from '../ai/caller-context.js';
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
    };
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
