/**
 * @file src/middleware/extended-features-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The guard in front of the extended features (boards, most of federation, storage and
 *   validation): 503 FEATURE_DISABLED when the operator has turned them off.
 *
 *   Moved out of server-bootstrap/routes-loader.ts, where its JSON was built by hand without a
 *   request id or a next step (feature-list audit #186). It answers with the shared error() envelope
 *   now, and names the setting in `details` rather than in the sentence.
 * @structure requireExtendedFeatures(config)
 * @usage const requireExtended = requireExtendedFeatures(config); app.use('/v1/boards', requireExtended);
 * @version-history
 *   2026-10-15 — Moved out of routes-loader.ts and built with error() (feature-list audit #186).
 */
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import { error } from './envelope.js';

export function requireExtendedFeatures(config: Pick<AimeatConfig, 'nodeId' | 'extendedFeaturesEnabled'>): RequestHandler {
  return (_req, res, next) => {
    if (!config.extendedFeaturesEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED',
        'This node does not offer this feature: its operator has turned the extended features off. '
        + 'Ask the operator to turn them on, or use a node that offers them.',
        503, { setting: 'AIMEAT_EXTENDED_FEATURES' }));
      return;
    }
    next();
  };
}
