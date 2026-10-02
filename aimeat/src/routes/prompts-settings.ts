/**
 * @file src/routes/prompts-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/settings/sections and /sections/:id — the setting explanations the
 *   pages show behind a question mark, in parts, the HTTP half of aimeat_handbook_get
 *   { tier: "settings" | "settings/<term>" }. The connector's MCP tool and the CLI dispatch call
 *   these; the node's own MCP tool reads the same service (services/settings-explain.ts), so the
 *   interfaces cannot answer differently. Public, like the locale files the text comes from.
 * @structure registerSettingsPrompt(router, config)
 * @usage registerSettingsPrompt(router, config);   // BEFORE /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { settingsExplainParts, settingsExplainPiece, settingsExplainPieceIds } from '../services/settings-explain.js';

export function registerSettingsPrompt(router: Router, config: AimeatConfig): void {
  router.get('/v1/prompts/settings/sections', (_req, res) => {
    res.json(success(config.nodeId, { parts: settingsExplainParts() }, [
      { description: 'One part by id', method: 'GET', url: '/v1/prompts/settings/sections/{id}' },
    ]));
  });

  router.get('/v1/prompts/settings/sections/:id', (req, res) => {
    const id = req.params.id as string;
    const piece = settingsExplainPiece(id);
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The setting explanations have no part "' + id + '". They have: ' + settingsExplainPieceIds().join(', ') + '.'));
      return;
    }
    if (req.query.format === 'txt') {
      sendPlainText(res, piece.text);
      return;
    }
    res.json(success(config.nodeId, { id: 'settings/' + piece.id, kind: 'part', prompt: piece.text }, [
      { description: 'The list of parts', method: 'GET', url: '/v1/prompts/settings/sections' },
    ]));
  });
}
