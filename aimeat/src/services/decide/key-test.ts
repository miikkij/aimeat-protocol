/**
 * @file src/services/decide/key-test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Does this TypeSafe key work?" answered with one real, tiny call (TARGET-080).
 *
 *   Two askers. The OWNER asks about the key that would pay for them (their own, else the node's);
 *   the OPERATOR asks about the node's key. Both get the same answer shape: it worked, which model
 *   answered, and TypeSafe's request id, or the reason in words they can act on.
 *
 *   THE CALL IS FIXED TEXT ABOUT NOTHING. It carries no one's data, so there is nothing to scrub, and
 *   it is not a decision about anything, so it leaves no decision record. It is still a paid call on
 *   somebody's key, so it is metered like any other: on the owner's budget when the owner asked, and
 *   in the log when the operator asked about the node's key.
 * @structure testDecideKey(storage, config, { gaii, which })
 * @usage const r = await testDecideKey(storage, config, { gaii, which: 'mine' });
 * @version-history
 *   v1.1.1 — 2026-09-23 — Through the generic System One client (systemone-client.ts).
 *   v1.1.0 — 2026-09-20 — `which: 'agent'`: the key that would pay for one agent.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { getTodayUsage, recordAiUsage } from '../ai-completion.js';
import { logger } from '../../utils/logger.js';
import { callSystemOne, SystemOneError } from './systemone-client.js';
import { readOwnDecideKey } from './settings.js';
import { readAgentKey } from '../agent-ai-keys.js';
import { DecideError } from './errors.js';

const PROBE = {
  state: 'The sky over the harbour was clear and blue all afternoon.',
  questions: { sky: { type: 'noul' as const, instructions: 'The text says the sky was clear.' } },
};

export interface KeyTestResult {
  ok: boolean;
  key_source: 'agent' | 'own' | 'node';
  model?: string;
  request_id?: string | null;
  code?: string;
  message?: string;
}

/**
 * `which: 'mine'` tests the key that pays for this owner (own, else the node's). `which: 'node'`
 * tests the node's key; the route decides who may ask for that.
 */
export async function testDecideKey(
  storage: Storage, config: AimeatConfig, opts: { gaii: string; which: 'mine' | 'node' | 'agent'; agent?: string },
): Promise<KeyTestResult> {
  if (!config.decideEnabled) {
    throw new DecideError('DECIDE_DISABLED', 503, 'The operator has turned the decision model off on this node.');
  }
  // `agent` tests the key that would pay for THAT agent, down the same order a real call takes:
  // its own, the owner's, the node's. The answer's key_source says which one it was.
  const agentKey = opts.which === 'agent' && opts.agent ? await readAgentKey(storage, config, opts.gaii, opts.agent, 'decide') : null;
  const own = !agentKey && opts.which !== 'node' ? await readOwnDecideKey(storage, config, opts.gaii) : null;
  const key = agentKey ?? own ?? config.decideInstanceKey.trim();
  const scope: 'agent' | 'own' | 'node' = agentKey ? 'agent' : own ? 'own' : 'node';
  if (!key) {
    return {
      ok: false, key_source: scope, code: 'NO_API_KEY',
      message: opts.which === 'node'
        ? 'This node has no TypeSafe key. Set decide.instance_key (AIMEAT_TYPESAFE_INSTANCE_KEY).'
        : 'No TypeSafe key is set: neither your own nor the node\'s.',
    };
  }

  try {
    // The key chain belongs to the configured provider, so that is the one tested.
    const res = await callSystemOne({
      url: config.decideBaseUrl, key, providerName: 'TypeSafe',
      request: { model: config.decideModel, state: PROBE.state, questions: PROBE.questions },
      policy: { maxRetries: 0 },
    });
    const costUsd = (res.usage.input_tokens / 1_000_000) * config.decidePricePerMtok;
    if (opts.which !== 'node') {
      await recordAiUsage(storage, opts.gaii, await getTodayUsage(storage, opts.gaii), {
        costUsd, tokens: res.usage.input_tokens, appId: 'decide-key-test', model: res.model, provider: 'typesafe',
        promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens,
        source: 'ai-decide-test', apiKeyScope: scope,
      }, config).catch(err => logger.warn('[decide] key test usage record failed', { error: String(err) }));
    } else {
      logger.info('[decide] operator tested the node key', { model: res.model, requestId: res.requestId, inputTokens: res.usage.input_tokens });
    }
    return { ok: true, key_source: scope, model: res.model, request_id: res.requestId };
  } catch (e) {
    if (!(e instanceof SystemOneError)) throw e;
    const refused = e.code === 'JEV_UNAUTHORIZED' || e.code === 'JEV_FORBIDDEN';
    return {
      ok: false, key_source: scope, code: refused ? 'INVALID_API_KEY' : e.code, request_id: e.requestId,
      message: refused
        ? 'TypeSafe refused the key. Check that it was copied whole and that the TypeSafe account has credit.'
        : `TypeSafe did not answer the test: ${e.message}`,
    };
  }
}
