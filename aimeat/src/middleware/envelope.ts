/**
 * @file src/middleware/envelope.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Canonical AIMEAT response envelope — every route builds its JSON body with the
 *   success()/error() helpers here so all responses share the same protocol/version/node/timestamp/
 *   request_id shape plus optional hint next-actions and pagination meta.
 *
 * @structure
 *   - HintAction: shape of a next-action hint (description/method/url + optional example)
 *   - AimeatResponse<T>: the full envelope type (ok, protocol, data, error, hints, meta)
 *   - EnvelopeMeta: pagination plus `provenance` — the ONE carrier for AI provenance (TARGET-058)
 *   - success: build an ok:true envelope with data, optional hints and meta
 *   - error: build an ok:false envelope with a code/message and default docs hints
 *
 * @version-history
 *   v1.2.0 — 2026-08-11 — Every error() carries the support@operators next-action. A caller that
 *     hits a wall now has somewhere to ask on the response itself, instead of guessing.
 *   v1.1.0 — 2026-08-01 — TARGET-058: `meta.provenance` typed on the envelope, so every route that
 *     serves generated content carries the record in the same place. No `data` shape changed.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { generateRequestId } from '../utils/tracking-code.js';
import type { AiProvenance } from '../models/ai-provenance-schemas.js';

import { nextStepFor } from './message-audience.js';

export interface HintAction {
  description: string;
  method: string;
  url: string;
  note?: string;
  example_body?: Record<string, unknown>;
}

export interface AimeatResponse<T = unknown> {
  ok: boolean;
  protocol: 'aimeat';
  version: 'v1';
  node: string;
  timestamp: string;
  request_id: string;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  hints?: { next_actions: HintAction[]; help_url?: string };
  meta?: EnvelopeMeta;
}

/**
 * The envelope's side-channel: facts ABOUT the response rather than parts of it.
 *
 * `provenance` is the single carrier for AI provenance across every route that serves generated
 * content (TARGET-058). It lives here and not in `data` on purpose: `data` shapes are what
 * published apps read, so putting provenance there would be a per-route shape change, and putting
 * it in `data` on some routes and `meta` on others is exactly the drift that makes an SDK need a
 * special case per endpoint. `record` is an `aimeat.provenance/v1` document — readers MUST branch on
 * its `spec` and MUST NOT assume fields.
 */
export interface EnvelopeMeta {
  page?: number;
  per_page?: number;
  total?: number;
  provenance?: { id: string; record: AiProvenance; recordUrl: string };
}

export function success<T>(nodeId: string, data: T, hints?: HintAction[], meta?: AimeatResponse['meta']): AimeatResponse<T> {
  return {
    ok: true,
    protocol: 'aimeat',
    version: 'v1',
    node: nodeId,
    timestamp: new Date().toISOString(),
    request_id: generateRequestId(),
    data,
    hints: hints ? { next_actions: hints, help_url: '/v1/docs' } : undefined,
    meta,
  };
}

/**
 * The way out of a dead end, on every error this node returns.
 *
 * A caller that has hit a wall reads the error and then guesses. An external agent did exactly that
 * in August 2026: it could not pass an onboarding step, invented three possible remedies, and its
 * user waited six days for a human to relay the problem by email — because nothing in any response
 * had ever told it where to ask. `support@operators` reaches whoever runs the node, so it belongs on
 * the error itself rather than in documentation the caller has already left behind.
 *
 * It rides in `next_actions`, which is where a client already looks for what to do next, and it is
 * appended rather than replacing a route's own hints: the specific fix comes first when the route
 * knows one.
 */
const SUPPORT_HINT: HintAction = {
  description: 'Stuck, or think this is a bug? Message the people who run this node — they answer in Messages',
  method: 'POST',
  url: '/v1/messages',
  note: 'No identity lookup needed: "support@operators" reaches every operator in one thread.',
  example_body: { to: 'support@operators', subject: 'What went wrong', body: 'What you were doing, and what happened instead.' },
};

export function error(nodeId: string, code: string, message: string, httpStatus?: number, details?: unknown, hints?: HintAction[]): AimeatResponse {
  return {
    ok: false,
    protocol: 'aimeat',
    version: 'v1',
    node: nodeId,
    timestamp: new Date().toISOString(),
    request_id: generateRequestId(),
    error: { code, message, details },
    hints: {
      next_actions: [
        // The FLOOR: when a route has not said where to go, the code usually can. 696 of the 855
        // messages a person hears failed on this one thing and nothing else — the English was fine,
        // they just stopped. "View API documentation" is not an answer to somebody who has just been
        // told their name is taken. A route that knows better still passes its own and comes first.
        ...(hints ?? (nextStepFor(code)
          ? [{ description: nextStepFor(code)!, method: 'GET', url: '/v1/docs' }]
          : [{ description: 'View API documentation', method: 'GET', url: '/v1/docs' }])),
        SUPPORT_HINT,
      ],
      help_url: '/v1/docs',
    },
  };
}
