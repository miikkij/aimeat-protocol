/**
 * @file src/routes/prompts-features.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/features/sections and /sections/:id — what this node can do, in parts,
 *   the HTTP half of aimeat_handbook_get { tier: "features" | "features/<id>" } (guided journey P6).
 *   The connector's MCP tool and the CLI dispatch call these; the node's own MCP tool reads the same
 *   service (services/feature-map.ts), so the doors cannot answer differently. Public, like the
 *   Everything page it is cut from.
 * @structure registerFeaturesPrompt(router, config)
 * @usage registerFeaturesPrompt(router, config);   // BEFORE /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { featureMapParts, featureMapPiece, featureMapPieceIds } from '../services/feature-map.js';

export function registerFeaturesPrompt(router: Router, config: AimeatConfig): void {
  router.get('/v1/prompts/features/sections', (_req, res) => {
    res.json(success(config.nodeId, { parts: featureMapParts() }, [
      { description: 'One part by id', method: 'GET', url: '/v1/prompts/features/sections/{id}' },
      { description: 'The same list as a page', method: 'GET', url: '/v1/everything' },
    ]));
  });

  router.get('/v1/prompts/features/sections/:id', (req, res) => {
    const id = req.params.id as string;
    const piece = featureMapPiece(id);
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The feature map has no part "' + id + '". It has: ' + featureMapPieceIds().join(', ') + '.'));
      return;
    }
    if (req.query.format === 'txt') {
      sendPlainText(res, piece.text);
      return;
    }
    res.json(success(config.nodeId, { id: 'features/' + piece.id, kind: 'part', prompt: piece.text }, [
      { description: 'The list of parts', method: 'GET', url: '/v1/prompts/features/sections' },
    ]));
  });
}
