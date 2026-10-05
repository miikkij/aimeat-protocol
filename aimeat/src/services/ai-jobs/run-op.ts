/**
 * @file src/services/ai-jobs/run-op.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model call a running AI job makes, one branch per `op` (op.ts): a completion, an
 *   image, or a transcription. Each branch calls the service function the synchronous REST route
 *   calls (completeForOwner, generateForOwner, transcribeForOwner), so the key, the budget, the
 *   per-app quota, the provider rules and the provenance are decided in one place for both code
 *   paths. Nothing here writes the result: service.ts does that, for every op the same way.
 *
 *   WHO PAYS AND WHERE THINGS ARE. The job and its result stay in the CALLER's namespace; the money
 *   is the human's (services/agent-ai-keys.ts aiPayerOf), exactly as on POST /v1/ai/complete. So:
 *     - a picture lands in the PAYER's storage, where POST /v1/ai/image and the MCP tool put it;
 *     - the audio is read from the CALLER's storage, where POST /v1/ai/transcribe reads it, so one
 *       account cannot transcribe another's file.
 *
 *   NO TOKEN CAP on any branch (scripts/check-no-max-tokens.ts): a cap truncates a long generation
 *   in silence, and a long generation is the reason a background job exists.
 * @structure runJobOp(deps, job, prompt, signal) → JobOpOutcome · assertAudioInReach(deps, owner, key)
 * @usage const outcome = await runJobOp({ storage, config }, entry.job, entry.prompt, signal);
 * @version-history
 *   v1.6.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     A job's run passes `limit: 'exempt'`: the job's start counted it.
 *   v1.5.0 — 2026-10-05 — The model call runs as the app or agent that started the job (starter.ts
 *     jobCaller): the owner's per-app and per-agent rules and the agent's cap apply. Before, every job
 *     was planned as the owner in person (secaudit 2026-10, AI-3).
 *   v1.4.0 — 2026-09-30 — A transcription hands back the warning-classified audio it gave the model
 *     (`warnings` on the outcome), which service.ts keeps on the job (TARGET-082 review, item 2).
 *   v1.3.0 — 2026-09-29 — The transcription reads its audio as the job's starter (starter.ts jobReader),
 *     and as an AI when no starter is recorded (TARGET-082 V4).
 *   v1.2.0 — 2026-09-29 — The transcription reads its audio through readAiFile (TARGET-082).
 *   v1.1.0 — 2026-09-28 — Every op passes the job's `role`, the AI role the call runs as.
 *   v1.0.0 — 2026-09-28 — System 2 plan, V5: the text call moved here from service.ts run(), and the
 *     image and transcription calls added beside it.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { completeForOwner } from '../ai/completion.js';
import { readAiFile } from '../ai-inputs.js';
import { jobReader, jobCaller } from './starter.js';
import { warningsNote } from '../classification/reader.js';
import { generateForOwner } from '../ai-image.js';
import { transcribeForOwner } from '../ai-transcription.js';
import { aiPayerOf } from '../agent-ai-keys.js';
import { aiOpOf } from './op.js';
import { AiJobError, type AiJobRecord, type AiJobClassificationWarnings } from './types.js';

/** What the provider's answer cost, carried onto the job record for every op the same way. */
export interface JobSpend {
    cost_usd: number;
    tokens?: number;
    provenance_id?: string;
}

/**
 * What a finished model call hands back. `value` is what lands at `result_key`, except that a text
 * answer is still a string here when the job asked for JSON: service.ts parses it, so a malformed
 * answer fails the job there as it always has.
 */
export interface JobOpOutcome {
    value: unknown;
    /** True only for a text answer that service.ts must parse as JSON before writing. */
    parseJson: boolean;
    spend: JobSpend;
    /** The warning-classified items this call read (the transcription's audio). Absent when none. */
    warnings?: AiJobClassificationWarnings;
}

const MB = 1024 * 1024;

/**
 * The audio exists in the owner's own storage and is within the node's transcription size limit.
 * Asked at the start, before the job record exists, and the answer is the one POST /v1/ai/transcribe
 * gives: 404 for a key that is not in the caller's storage, whether or not it exists elsewhere.
 * Reads the file's metadata only, not its bytes.
 */
export async function assertAudioInReach(
    deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, audioKey: string,
): Promise<void> {
    const meta = await deps.storage.getStorageFileMeta(ownerGhii, audioKey);
    if (!meta) throw new AiJobError('NOT_FOUND', 404, `No such file in your storage: audio_key "${audioKey}".`);
    const maxMb = deps.config.sttMaxMb;
    if (maxMb > 0 && meta.size > maxMb * MB) {
        throw new AiJobError('AUDIO_TOO_LARGE', 400,
            `The audio at "${audioKey}" is ${(meta.size / MB).toFixed(1)} MB; this node accepts up to ${maxMb} MB for transcription.`);
    }
}

/** Run the job's model call. Throws what the service function throws; service.ts records it. */
export async function runJobOp(
    deps: { storage: Storage; config: AimeatConfig },
    job: AiJobRecord,
    prompt: string,
    signal: AbortSignal,
): Promise<JobOpOutcome> {
    const { storage, config } = deps;
    const { payer, agent } = aiPayerOf(job.owner);
    // Who the call runs as: the app or agent that started the job, under the owner's rules for it.
    const who = jobCaller(job);
    const common = {
        ...(agent ? { agent } : {}),
        caller: who.caller,
        ...(who.verifiedApp ? { verifiedApp: who.verifiedApp } : {}),
        ...(job.model ? { model: job.model } : {}),
        ...(job.app_id ? { appId: job.app_id } : {}),
        ...(job.provider ? { provider: job.provider } : {}),
        ...(job.role ? { role: job.role } : {}),
        signal,
    };
    const op = aiOpOf(job.op);

    if (op === 'image') {
        const r = await generateForOwner(storage, config, payer, {
            ...common,
            // The job's start (POST /v1/ai/jobs, aimeat_ai_job_start) counted the AI call limit;
            // the run is the node's own work and is not counted again.
            limit: 'exempt',
            prompt,
            ...(job.size ? { size: job.size } : {}),
            // A public result record that pointed at a private picture would answer 401 to every
            // reader it was made public for, so the picture follows the record's visibility.
            publicVisibility: job.result_visibility === 'public',
        });
        return {
            value: { storage_key: r.storageKey, url: r.fetchUrl, mime_type: r.mime, model: r.model },
            parseJson: false,
            spend: { cost_usd: r.usage.costUsd, ...(r.provenance ? { provenance_id: r.provenance.id } : {}) },
        };
    }

    if (op === 'transcribe') {
        const key = job.audio_key ?? '';
        // Read again here, bytes and all: the start checked the metadata only, and the file may have
        // been deleted while the job queued.
        // The one loader of what a model reads (services/ai-inputs.ts), as whoever started the job;
        // a job with no starter recorded reads as an AI (starter.ts).
        const reader = jobReader({ storage, config }, job);
        const file = await readAiFile(storage, reader, job.owner, key, { capability: 'transcription' });
        if (!file) throw new AiJobError('NOT_FOUND', 404, `No such file in your storage: audio_key "${key}".`);
        const r = await transcribeForOwner(storage, config, payer, {
            ...common,
            limit: 'exempt', // counted at the job's start, as the image op above
            audio: {
                data: file.data,
                mime: file.mimeType || 'application/octet-stream',
                filename: key.split('/').pop() || 'audio',
            },
            ...(job.language ? { language: job.language } : {}),
        });
        const warnings = warningsNote(reader).classification_warnings;
        return {
            value: job.json
                ? { text: r.text, language: r.language ?? null, seconds: r.seconds, model: r.model }
                : r.text,
            parseJson: false,
            spend: {
                cost_usd: r.usage.costUsd, tokens: r.usage.totalTokens,
                ...(r.provenance ? { provenance_id: r.provenance.id } : {}),
            },
            ...(warnings ? { warnings } : {}),
        };
    }

    const r = await completeForOwner(storage, config, payer, {
        ...common,
        prompt,
        ...(job.system_prompt ? { systemPrompt: job.system_prompt } : {}),
    });
    return {
        value: r.content,
        parseJson: !!job.json,
        spend: {
            cost_usd: r.usage.costUsd, tokens: r.usage.totalTokens,
            ...(r.provenance ? { provenance_id: r.provenance.id } : {}),
        },
    };
}
