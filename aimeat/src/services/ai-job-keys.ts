/**
 * @file src/services/ai-job-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which of the owner's records an AI job may read into its prompt, and where it may
 *   write its answer. One rule for both kinds of job: the AI job a caller starts (services/ai-jobs/)
 *   and the scheduled AI job (services/schedule-write.ts, services/scheduler-remote-jobs.ts).
 *
 *   A job sends every record it reads to the model provider, and writes the answer at a key its
 *   caller names, with the visibility the caller chose. So a job reads none of the records the node
 *   keeps for itself, and writes over none of them. They are the records every memory door already
 *   guards: the reserved keys (utils/reserved-keys.ts, both kinds: the ones the node reads and acts
 *   on, and the ones only the node writes) and the credential records (services/secret-records.ts),
 *   which the generic doors show redacted. The rule is the same for every caller, the account owner
 *   included, as it is for a decision run (services/decide/runs.ts) and a workflow step
 *   (services/workflow/store.ts reservedStepKeys).
 *
 *   Each kind asks at its door, before anything is stored, and again where the record is read or the
 *   answer written, so a job stored before this rule is held to it too.
 * @structure isOutsideAiJobReach(key) · aiJobKeyRefusal({ promptKey?, inputKeys?, outputKey? })
 * @usage
 *   const refusal = aiJobKeyRefusal({ inputKeys: body.input_keys, outputKey: body.output_key });
 *   if (refusal) return { ok: false, ...refusal };
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: one rule for the AI job and the scheduled AI job (secaudit
 *     2026-09: A6-1, 573704db10ed).
 */
import { isReservedServerKey } from '../utils/reserved-keys.js';
import { isSecretRecordKey } from './secret-records.js';

/** The refusal, which each door renders in its own way. The code and status every memory door uses. */
export interface AiJobKeyRefusal {
  status: 403;
  code: 'RESERVED_KEY';
  message: string;
}

/** What the refusals say the kept records are, in words a caller can act on. */
const KEPT = 'a record this node keeps for itself, such as an AI key, a payout setting or a spend limit';

/** True when an AI job may not read `key` into a prompt, nor write its answer there. */
export function isOutsideAiJobReach(key: unknown): key is string {
  return typeof key === 'string' && (isReservedServerKey(key) || isSecretRecordKey(key));
}

/**
 * The refusal for a job's keys, or null when every key is the owner's own to use.
 *
 * `promptKey` and `inputKeys` are read into the prompt; `outputKey` receives the answer. A value
 * that is not a string is left to the door's own validation, which says what shape it wants.
 */
export function aiJobKeyRefusal(keys: { promptKey?: unknown; inputKeys?: unknown; outputKey?: unknown }): AiJobKeyRefusal | null {
  const reads = [keys.promptKey, ...(Array.isArray(keys.inputKeys) ? keys.inputKeys : [])];
  const kept = [...new Set(reads.filter(isOutsideAiJobReach))];
  if (kept.length > 0) {
    const named = kept.map(k => `"${k}"`).join(', ');
    return {
      status: 403, code: 'RESERVED_KEY',
      message: kept.length === 1
        ? `${named} is ${KEPT}. An AI job does not send it to a model. Name records of your own.`
        : `${named} are records this node keeps for itself, such as an AI key, a payout setting or a spend limit. An AI job does not send them to a model. Name records of your own.`,
    };
  }
  if (isOutsideAiJobReach(keys.outputKey)) {
    return {
      status: 403, code: 'RESERVED_KEY',
      message: `"${keys.outputKey}" is ${KEPT}. An AI job does not write its answer there. Pick a key of your own.`,
    };
  }
  return null;
}
