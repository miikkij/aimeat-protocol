/**
 * @file src/routes/prompts-places.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/places/sections and /sections/:id — where things are on this node's
 *   own pages (Settings & Controls and the admin pages), the HTTP half of
 *   aimeat_handbook_get { tier: "places" | "places/admin" }. The connector's MCP tool and the CLI
 *   dispatch call these; the node's own MCP tool reads the same service (services/places.ts), so
 *   the doors cannot answer differently. Public, like the page code that holds the same menus.
 * @structure registerPlacesPrompt(router, config)
 * @usage registerPlacesPrompt(router, config);   // BEFORE /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { placesParts, placesPiece, placesPieceIds } from '../services/places.js';

export function registerPlacesPrompt(router: Router, config: AimeatConfig): void {
  router.get('/v1/prompts/places/sections', (_req, res) => {
    res.json(success(config.nodeId, { parts: placesParts(config.baseUrl) }, [
      { description: 'One part by id', method: 'GET', url: '/v1/prompts/places/sections/{id}' },
    ]));
  });

  router.get('/v1/prompts/places/sections/:id', (req, res) => {
    const id = req.params.id as string;
    const piece = placesPiece(id, config.baseUrl);
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The list of places has no part "' + id + '". It has: ' + placesPieceIds().join(', ')
        + ' (aimeat_handbook_get tiers "places" and "places/admin").'));
      return;
    }
    if (req.query.format === 'txt') {
      sendPlainText(res, piece.text);
      return;
    }
    res.json(success(config.nodeId, { id: piece.id === 'start' ? 'places' : 'places/' + piece.id, kind: 'part', prompt: piece.text }, [
      { description: 'The list of parts', method: 'GET', url: '/v1/prompts/places/sections' },
    ]));
  });
}
