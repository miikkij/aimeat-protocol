/**
 * @file src/services/ai-jobs/result-precheck.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an AI job's start can tell about where its answer will land, before the model is
 *   paid for. The answer is written through the shared memory write (services/memory-write.ts), as
 *   the job's starter (starter.ts jobWriter), and that write refuses what any memory write refuses.
 *   A refusal there comes after the provider was paid, so every part of it that does not depend on
 *   the answer itself is asked here first, at the start, and refused with the same code:
 *
 *   - an `organism.*` result key the starter may not write (services/organism-namespace-access.ts);
 *   - a result key whose record, workspace or organism is archived (services/archive.ts);
 *   - a schema lock on the key whose JSON type cannot take the answer the op produces (a text
 *     answer is a string, an image record and a JSON transcription are objects); a lock that could
 *     take it is checked against the real answer at the write;
 *   - a new key on an account at its key ceiling, and an account already over its byte quota with no
 *     balance for the overage (services/memory-ceilings.ts, services/quota.ts).
 *
 *   The size of the answer cannot be known before the model answers, so the per-value ceiling stays
 *   at the write.
 * @structure ResultRefusal · resultWriteRefusal(deps, spec)
 * @usage
 *   const refusal = await resultWriteRefusal({ storage, config }, { ownerGhii, key, startedBy, op, json });
 *   if (refusal) throw new AiJobError(refusal.code, refusal.status, refusal.message);
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, ai-jobs/service.ts:writeResult): the organism
 *     check moved here from service.ts, and the archive, schema-type, key-count and quota checks were
 *     added so a job the write would refuse is refused before any cost.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { checkOrganismNamespaceAccess } from '../organism-namespace-access.js';
import { isKeyArchived } from '../archive.js';
import { checkMemoryQuota } from '../quota.js';
import { jobWriter } from './starter.js';
import type { AiJobStartedBy } from './types.js';
import type { AiOp } from './op.js';

export interface ResultRefusal { status: number; code: string; message: string }

/** The JSON type of the answer an op writes, or null when it is not known before the model answers. */
function answerType(op: AiOp, json: boolean): 'string' | 'object' | null {
    if (op === 'image') return 'object';
    if (op === 'transcribe') return json ? 'object' : 'string';
    return json ? null : 'string';
}

/** A refusal for the result key, or null when nothing that can be known at the start refuses it. */
export async function resultWriteRefusal(
    deps: { storage: Storage; config: AimeatConfig },
    spec: { ownerGhii: string; key: string; startedBy?: AiJobStartedBy; op: AiOp; json?: boolean },
): Promise<ResultRefusal | null> {
    const { storage, config } = deps;
    const { ownerGhii, key } = spec;
    const where = `result_key "${key}"`;

    if (key.startsWith('organism.')) {
        const writer = jobWriter({ owner: ownerGhii, started_by: spec.startedBy });
        const refusal = await checkOrganismNamespaceAccess(deps, {
            principal: writer.principal, owner: localAccountName(writer.principal), roles: writer.roles, scopes: writer.scopes,
        }, key, 'write');
        if (refusal) return { status: refusal.status, code: refusal.code, message: `${where}: ${refusal.message}` };
    }

    const existing = await storage.getMemory(ownerGhii, key);
    const archived = existing?.archived ? { archived: true, level: 'record' } : await isKeyArchived(storage, key);
    if (archived.archived) {
        return { status: 409, code: 'ARCHIVED', message: `${where}: this ${archived.level ?? 'record'} is archived (read-only). Unarchive it, or name another key.` };
    }

    const want = answerType(spec.op, !!spec.json);
    if (want) {
        const lock = await storage.findApplicableSchema(key);
        const declared = lock?.schemaJson?.type;
        const types = typeof declared === 'string' ? [declared] : Array.isArray(declared) ? declared.map(String) : null;
        if (lock && types && !types.includes(want)) {
            return {
                status: 422, code: 'SCHEMA_VALIDATION_FAILED',
                message: `${where} has a schema lock (${lock.keyPattern}) that takes ${types.join(' or ')}, and this job writes ${want === 'string' ? 'text' : 'an object'}. `
                    + (want === 'string' ? 'Start it with json: true, or name a key without the lock.' : 'Name a key without the lock.'),
            };
        }
    }

    if (!existing) {
        const count = await storage.countMemory([ownerGhii]);
        if (count >= config.memoryMaxKeysPerAgent) {
            return {
                status: 413, code: 'QUOTA_EXCEEDED',
                message: `${where} is a new key, and this account is at its memory key limit (${config.memoryMaxKeysPerAgent}). Name an existing key, or fold small keys into one record.`,
            };
        }
    }
    const quota = await checkMemoryQuota(config, storage, ownerGhii, 0, 0);
    if (!quota.allowed) {
        return { status: 413, code: 'QUOTA_EXCEEDED', message: `${where}: ${quota.reason ?? 'the memory quota is used up.'}` };
    }
    return null;
}
