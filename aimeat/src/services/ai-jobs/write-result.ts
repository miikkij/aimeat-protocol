/**
 * @file src/services/ai-jobs/write-result.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an AI job's answer lands: the shared memory write, as the job's starter, on the
 *   version it read. Moved out of service.ts unchanged (AiJobService.writeResult), so the service
 *   stays under the 800-line limit.
 * @structure writeJobResult
 * @usage const written = await writeJobResult({ storage, config }, job, answer, parseJson, provenanceId);
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Pure extraction from service.ts (codebase analysis 2026-11-03, item HA 1.4).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { CAS_ATTEMPTS } from '../record-cas.js';
import { writeMemoryRecord } from '../memory-write.js';
import { jobWriter } from './starter.js';
import { AiJobError, type AiJobRecord } from './types.js';

/** Land the answer where the caller said it should go. `parseJson` is set for a text answer
 *  the job asked JSON of; an image record and a transcription arrive in their final shape.
 *  Answers with the value stored, the version it was stored at and the visibility it got. */
export async function writeJobResult(
    deps: { storage: Storage; config: AimeatConfig },
    job: AiJobRecord, answer: unknown, parseJson: boolean, provenanceId?: string,
): Promise<{ value: unknown; version: number; visibility: AiJobRecord['result_visibility']; requestId?: string }> {
    let value: unknown = answer;
    if (parseJson) {
        // Parsed HERE when the job asked for JSON, so a malformed answer fails at the job rather
        // than becoming a string every downstream reader has to re-parse and none of them checks.
        const content = typeof answer === 'string' ? answer : '';
        const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(content);
        if (!m) throw new Error('The job asked for json and the answer contained none.');
        value = JSON.parse(m[0]);
    }

    // THROUGH THE SHARED MEMORY WRITE, as the job's starter (starter.ts jobWriter). A raw storage
    // write here stored the answer at whatever visibility the caller asked: an agent without
    // publish:public made its answer public with no request to the owner, past the closed-node
    // level and the label audience cap, and wrote an `organism.*` key the organism namespace
    // rule refuses it on POST /v1/memory (secaudit 2026-10). `gatePublic` asks the publish gate,
    // which keeps the record at the level it had and files the request; the job records what
    // was stored. `ai:use` is the word this write answers to, the one the start already asked.
    //
    // Written on the version read, so the version the job records (result_version) is the one
    // its answer holds: a concurrent writer makes this read again instead of being overwritten
    // under a version number that then names two different values.
    const writer = jobWriter(job);
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const existing = await deps.storage.getMemory(job.owner, job.result_key);
        const written = await writeMemoryRecord(deps, writer, {
            key: job.result_key,
            value,
            visibility: job.result_visibility,
            tags: ['ai', 'ai-job-result'],
            ttlHours: null,
            expectedVersion: existing?.version ?? 0,
            authorisingScope: 'ai:use',
            gatePublic: true,
            // As before the answer came through here: it starts no workflow trigger, Tracked
            // Response, connector push, ecosystem push or automation recipe. A chain of work
            // after a job is what on_done is for.
            noTriggers: true,
            pipeline: `ai-job:${job.id}`,
            // TARGET-058: the completion already minted an observed record — the node watched the
            // model produce these exact bytes — so it is CARRIED here rather than re-derived. Nobody
            // read the substance on this path, so `humanInvolvement: 'none'` stands untouched.
            ...(provenanceId ? { declaredProvenanceId: provenanceId } : {}),
        });
        if (written.ok) {
            return {
                value, version: written.record.version, visibility: written.record.visibility,
                // The record's own publish request, which a picture's request joins as a part.
                ...(written.publishRequest ? { requestId: written.publishRequest.request_id } : {}),
            };
        }
        if (written.code === 'VERSION_CONFLICT') continue;
        throw new AiJobError(written.code, written.status, written.message);
    }
    throw new Error(`The record at "${job.result_key}" changed under every one of ${CAS_ATTEMPTS} attempts to write the answer.`);
}
