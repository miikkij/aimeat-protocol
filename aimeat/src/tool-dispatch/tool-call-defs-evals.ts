/**
 * @file tool-dispatch/tool-call-defs-evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The eval set tools on the CLI dispatch (`/local/call/<tool>`) and the connector MCP: a
 *   thin REST proxy over /v1/evals/*, so the node decides everything (services/evals/eval-ops.ts).
 * @version-history
 *   v1.2.0 — 2026-11-27 — aimeat_eval_run { run_id, results, model } finishes an open run.
 *   v1.1.0 — 2026-11-26 — aimeat_eval_set { remove: true }.
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString } from './tool-call-helpers.js';

const at = (input: Record<string, unknown>) =>
  `/v1/evals/${encodeURIComponent(optionalString(input, 'kind') ?? '')}/${encodeURIComponent(optionalString(input, 'name') ?? '')}`;

export const evalCliTools: ConnectCliToolDefinition[] = [
  {
    // → PUT /v1/evals/:kind/:name (routes/evals/evals.ts)
    name: 'aimeat_eval_set',
    // remove: true → DELETE /v1/evals/:kind/:name
    handler: ({ client }, input) => (input.remove === true
      ? client.delete(at(input))
      : client.put(at(input), { cases: input.cases, ...(input.repeats !== undefined ? { repeats: input.repeats } : {}) })),
  },
  {
    // → GET /v1/evals/:kind/:name
    name: 'aimeat_eval_get',
    handler: ({ client }, input) => client.get(at(input)),
  },
  {
    // → POST /v1/evals/:kind/:name/run
    name: 'aimeat_eval_run',
    // every given field goes on: the node decides (run_id finishes an open run with the caller's results)
    handler: ({ client }, input) => client.post(`${at(input)}/run`, Object.fromEntries(
      (['dry_run', 'run_id', 'model', 'results'] as const).filter(k => input[k] !== undefined).map(k => [k, input[k]]))),
  },
];
