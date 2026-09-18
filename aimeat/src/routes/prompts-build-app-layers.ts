/**
 * @file prompts-build-app-layers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The build specification in layers, beside the full one:
 *   GET /v1/prompts/build-app/core            what every app needs in one piece, plus an index of the rest
 *   GET /v1/prompts/build-app/sections        the four parts of the core, and the sections by id
 *   GET /v1/prompts/build-app/sections/:id    one part (start, libraries, data, look) or one
 *                                             section, byte for byte as the full text has it
 *
 *   GET /v1/prompts/build-app itself is not touched and keeps serving the whole text: the
 *   app catalog composes its prompt from it and agentic coders fetch it. These routes exist for
 *   the reader who cannot take 95 000 characters in one piece, which is every AI connected over
 *   MCP (the handbook tool reads the same service). Reasoning: services/build-app-layers.ts.
 *
 *   Public, like the full specification: build guidance, not a secret.
 *   Its own file because routes/prompts.ts is at 783 of 800 lines.
 * @structure registerBuildAppLayerPrompts(router, config)
 * @usage registerBuildAppLayerPrompts(router, config);
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { buildAppPrompt, buildAppSpecToken } from '../services/build-app-prompt.js';
import {
  layeredBuildAppPrompt, splitBuildAppSpec, buildAppPiece, buildAppPieceIds, SPEC_PARTS,
} from '../services/build-app-layers.js';

export function registerBuildAppLayerPrompts(router: Router, config: AimeatConfig): void {
  const fullFor = (query: Record<string, unknown>) => buildAppPrompt(config, {
    mode: query.mode === 'improve' ? 'improve' : 'new',
    lang: typeof query.lang === 'string' ? query.lang : 'en',
    idea: typeof query.idea === 'string' ? query.idea : '',
  }).full;

  router.get('/v1/prompts/build-app/core', (req, res) => {
    const { prompt, sections } = layeredBuildAppPrompt(fullFor(req.query), config.baseUrl);
    if (req.query.format === 'txt') {
      sendPlainText(res, prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app/core',
      name: 'Build an AIMEAT app: the part every app needs',
      description: 'The build specification without the sections only some apps need. Each of those is listed in `sections` with the situation it covers, and is read on its own when the app is in that situation.',
      prompt,
      system_prompt: prompt,
      sections,
      spec_token: buildAppSpecToken(config),
    }, [
      { description: 'The whole specification in one piece', method: 'GET', url: '/v1/prompts/build-app' },
      { description: 'One section by id', method: 'GET', url: '/v1/prompts/build-app/sections/{id}' },
    ]));
  });

  router.get('/v1/prompts/build-app/sections', (req, res) => {
    const full = fullFor(req.query);
    const sections = splitBuildAppSpec(full).map(s => ({
      id: s.id, title: s.title, layer: s.layer, chars: s.text.length,
      ...(s.part ? { part: s.part } : {}), ...(s.when ? { when: s.when } : {}),
    }));
    const parts = SPEC_PARTS.map(p => ({
      id: p.id, what: p.what, chars: buildAppPiece(full, p.id, config.baseUrl)?.text.length ?? 0,
    }));
    res.json(success(config.nodeId, { parts, sections, spec_token: buildAppSpecToken(config) }, [
      { description: 'One section by id', method: 'GET', url: '/v1/prompts/build-app/sections/{id}' },
    ]));
  });

  router.get('/v1/prompts/build-app/sections/:id', (req, res) => {
    const id = req.params.id as string;
    const full = fullFor(req.query);
    // A part of the core (start, libraries, data, look) or one section; the same function the
    // MCP handbook tool reads, so the two doors cannot answer differently.
    const piece = buildAppPiece(full, id, config.baseUrl);
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The build specification has no part or section "' + id + '". It has: ' + buildAppPieceIds(full).join(', ') + '.'));
      return;
    }
    if (req.query.format === 'txt') {
      sendPlainText(res, piece.text);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app/' + piece.id,
      kind: piece.kind,
      prompt: piece.text,
      spec_token: buildAppSpecToken(config),
    }, [
      { description: 'The part every app needs, with the index of sections', method: 'GET', url: '/v1/prompts/build-app/core' },
    ]));
  });
}
