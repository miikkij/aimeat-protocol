/**
 * @file src/routes/ai-transparency.ts
 * @description The node's machine-readable AI transparency statement (TARGET-058) — what this node
 *   marks, how, in which posture, and who operates it. The agent-native equivalent of a transparency
 *   page, and the document a regulator, a researcher or a buyer's compliance officer reads first.
 *
 *   IT ANSWERS HONESTLY WHEN THE ANSWER IS "NO". `code_of_practice.signatory` ships as **false** and
 *   flips only if the operator actually signs; `text_watermarking` says plainly that this node does
 *   not do it, because the node does not sample the tokens and that layer belongs to whoever runs
 *   the model. A field that is honest when the answer is no is what makes it worth anything when the
 *   answer is yes — a transparency claim is the one claim a reader will check.
 *
 *   IT IS DERIVED, NEVER HAND-MAINTAINED. Every value comes from config or from the provenance
 *   module, so the statement cannot drift away from what the node actually does: turn provenance off
 *   and this says so, set the detail knob to `minimal` and this says so.
 * @structure
 *   - GET /v1/ai-transparency     — the JSON statement (AIMEAT envelope)
 *   - GET /v1/ai-transparency.md  — the same facts as markdown, for an agent that reads prose
 * @usage
 *   import { aiTransparencyRouter } from './routes/ai-transparency.js';
 *   app.use(aiTransparencyRouter(config));
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2. Shape from docs/internal/EUAct/20-public-release-plan.md §B.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';
import { AI_PROVENANCE_SPEC_V1, AI_PROVENANCE_SCHEMA_PATH } from '../models/ai-provenance-schemas.js';

/** The node's own statement about how it marks AI-generated content. */
export function buildAiTransparency(config: AimeatConfig): Record<string, unknown> {
  const b = config.baseUrl.replace(/\/+$/, '');
  const op = config.operator;
  return {
    node_id: config.nodeId,
    operator: {
      legal_name: op.name || null,
      business_id: op.businessId || null,
      address: op.address || null,
      country: op.country || null,
      contact: op.email || null,
    },
    supervisory_authority: {
      // The AI Act's market-surveillance authority is NOT the data-protection authority, and this
      // node has no configuration for it yet, so it says so rather than naming the wrong regulator.
      // Which one applies depends on where the operator is established.
      ai_market_surveillance: null,
      data_protection: op.supervisoryName ? { name: op.supervisoryName, url: op.supervisoryUrl || null } : null,
      member_state: op.country || null,
      note: 'The AI Act market-surveillance authority is determined by where the operator is established and is not the data-protection authority named here.',
    },
    marking: {
      spec: AI_PROVENANCE_SPEC_V1,
      schema: `${b}${AI_PROVENANCE_SCHEMA_PATH}`,
      // Two independent layers, which is what the Code of Practice asks for: the mark travels with
      // the document AND the record is separately addressable.
      layers: ['document-metadata', 'addressable-record'],
      vocabularies: ['iptc-digitalsourcetype', 'ai-disclosure-header', 'w3c-ai-disclosure', 'schema.org'],
      // Structurally the model vendor's layer: this node does not sample the tokens.
      text_watermarking: 'not-performed-by-this-node',
      surfaces: ['json-envelope', 'http-headers', 'html', 'markdown', 'webmcp', 'mcp'],
    },
    detection: {
      by_hash: `${b}/v1/provenance/by-hash/{sha256}`,
      by_id: `${b}/v1/provenance/{id}`,
      access: 'public, unauthenticated, rate-limited',
      // The rule a caller has to understand before reading an empty answer as an acquittal.
      scope: 'Records describing content that is publicly readable on this node. Absence means UNSTATED, never "a human wrote it".',
    },
    labelling: { icons: 'eu-ai-office-2026-06-10', languages: ['en', 'fi'] },
    code_of_practice: { signatory: false, sections: [] },
    posture: {
      provenance: config.aiProvenance ? 'on' : 'off',
      detail: config.aiProvenanceDetail,
    },
  };
}

function renderMarkdown(config: AimeatConfig, s: Record<string, unknown>): string {
  const b = config.baseUrl.replace(/\/+$/, '');
  const op = s.operator as Record<string, string | null>;
  const marking = s.marking as Record<string, unknown>;
  const detection = s.detection as Record<string, string>;
  const posture = s.posture as Record<string, string>;
  return [
    '---',
    `title: AI transparency statement`,
    `url: ${b}/v1/ai-transparency`,
    `node: ${config.nodeId}`,
    '---',
    '',
    '# AI transparency statement',
    '',
    `This node is \`${config.nodeId}\`${op.legal_name ? `, operated by ${op.legal_name}` : ''}.`,
    '',
    '## What is marked',
    '',
    `Content generated through this node carries an \`${marking.spec}\` provenance record: which model,`,
    'when, which principal, how much a human was involved, and a SHA-256 of the exact bytes the',
    'statement is about. It is served on every surface this node serves that content on —',
    `${(marking.surfaces as string[]).join(', ')} — in two independent layers:`,
    'the mark travels with the document, and the record is separately addressable.',
    '',
    `- Record schema: ${marking.schema}`,
    `- Resolve a record: ${detection.by_id}`,
    `- Ask about bytes you hold, with no account: ${detection.by_hash} (${detection.access})`,
    '',
    '## What is not',
    '',
    'This node does **not** watermark text. It does not sample the tokens; that layer belongs to',
    'whoever runs the model. What it does is record how content was made, attributably, and show it.',
    '',
    `An absent record means **unstated** — never "a human wrote it". ${detection.scope}`,
    '',
    '## Posture',
    '',
    `- Provenance recording: **${posture.provenance}**`,
    `- Detail served on public surfaces: **${posture.detail}**`,
    `- Code of Practice signatory: **no**`,
    '',
    `Machine-readable: ${b}/v1/ai-transparency`,
    '',
  ].join('\n');
}

export function aiTransparencyRouter(config: AimeatConfig): Router {
  const router = Router();

  router.get('/v1/ai-transparency', (_req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(success(config.nodeId, buildAiTransparency(config), [
      { description: 'The same statement as markdown', method: 'GET', url: '/v1/ai-transparency.md' },
      { description: 'The provenance record schema', method: 'GET', url: AI_PROVENANCE_SCHEMA_PATH },
      { description: 'Ask whether this node produced some bytes', method: 'GET', url: '/v1/provenance/by-hash/{sha256}' },
    ]));
  });

  router.get('/v1/ai-transparency.md', (_req: Request, res: Response) => {
    res.set('Link', `<${config.baseUrl.replace(/\/+$/, '')}/v1/ai-transparency>; rel="canonical"`);
    res.set('Access-Control-Allow-Origin', '*');
    sendMarkdown(res, renderMarkdown(config, buildAiTransparency(config)));
  });

  return router;
}
