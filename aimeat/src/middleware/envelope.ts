/**
 * @file src/middleware/envelope.ts
 * @description Canonical AIMEAT response envelope — every route builds its JSON body with the
 *   success()/error() helpers here so all responses share the same protocol/version/node/timestamp/
 *   request_id shape plus optional hint next-actions and pagination meta.
 *
 * @structure
 *   - HintAction: shape of a next-action hint (description/method/url + optional example)
 *   - AimeatResponse<T>: the full envelope type (ok, protocol, data, error, hints, meta)
 *   - success: build an ok:true envelope with data, optional hints and meta
 *   - error: build an ok:false envelope with a code/message and default docs hints
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { generateRequestId } from '../utils/tracking-code.js';

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
  meta?: { page?: number; per_page?: number; total?: number };
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

export function error(nodeId: string, code: string, message: string, httpStatus?: number, details?: unknown, hints?: HintAction[]): AimeatResponse {
  return {
    ok: false,
    protocol: 'aimeat',
    version: 'v1',
    node: nodeId,
    timestamp: new Date().toISOString(),
    request_id: generateRequestId(),
    error: { code, message, details },
    hints: hints ? { next_actions: hints, help_url: '/v1/docs' } : {
      next_actions: [
        { description: 'View API documentation', method: 'GET', url: '/v1/docs' },
      ],
      help_url: '/v1/docs',
    },
  };
}
