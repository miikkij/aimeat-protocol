/**
 * @file src/routes/ai-transparency.ts
 * @description The node's machine-readable AI transparency statement (TARGET-058) — what this node
 *   marks, how, in which posture, and who operates it. The agent-native equivalent of a transparency
 *   page, and the document a regulator, a researcher or a buyer's compliance officer reads first.
 *
 *   IT ANSWERS HONESTLY WHEN THE ANSWER IS "NO". `code_of_practice.signatory` ships as **false** and
 *   flips only where the operator configured the sections they actually signed; `text_watermarking`
 *   says plainly that this node does not do it, because the node does not sample the tokens and that
 *   layer belongs to whoever runs the model. A field that is honest when the answer is no is what
 *   makes it worth anything when the answer is yes — a transparency claim is the one claim a reader
 *   will check. Where the answer IS yes, the sections NOT signed are published beside it with the
 *   reason, because a bare `signatory: true` is the shape a reader would reasonably over-read.
 *
 *   IT IS DERIVED, NEVER HAND-MAINTAINED. Every value comes from config or from the provenance
 *   module, so the statement cannot drift away from what the node actually does: turn provenance off
 *   and this says so, set the detail knob to `minimal` and this says so.
 * @structure
 *   - GET /v1/ai-transparency                  — the JSON statement (AIMEAT envelope); a browser
 *                                                asking for HTML is redirected to /v1/transparency
 *   - GET /v1/ai-transparency.md               — the same facts as markdown, for an agent
 *   - GET /v1/admin/ai-transparency-report     — operator: the documentation duty, from data
 *   - GET /v1/ai-transparency/mine             — owner: what your agents published, and how labelled
 *   - GET /v1/ai-transparency/logging-policy   — owner: what is logged, for how long, and by whom
 * @usage
 *   import { aiTransparencyRouter } from './routes/ai-transparency.js';
 *   app.use(aiTransparencyRouter(config, storage));
 * @version-history
 *   v1.4.0 — 2026-08-08 — The AI Office confirmed Overscale Solutions Oy's signature of Section 2
 *     (deployer; Section 1 deliberately not signed), so `code_of_practice` needed a way to say yes.
 *     It reads AIMEAT_AI_COP_SECTIONS / _SIGNED_ON rather than a constant: the signature is the
 *     operator's, and a `true` in this file would be a false claim on every other node.
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 10b. `/v1/ai-transparency` and `/v1/transparency` are one
 *     word apart and answer different content types, so a person pasting the machine URL into a
 *     browser landed on JSON. Content negotiation sends a browser to the page; JSON stays the
 *     default for every caller that does not rank text/html first.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 8. The operator report (Code of Practice Section 2,
 *     Commitment 2 — documentation, answered from records rather than a spreadsheet), the per-owner
 *     view (most publishing here is done by accounts, so an account must see its own exposure), and
 *     the logging policy (Sub-measure 1.1.3 — the deployer gets access to it).
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 3. `ai_market_surveillance` is answered from
 *     AIMEAT_AI_SUPERVISORY_NAME/_URL instead of being permanently null, and `posture.visible_label`
 *     publishes AIMEAT_AI_LABEL_PUBLIC so a reader can tell a legally required label from one this
 *     operator chose to show.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2. Shape from docs/internal/EUAct/20-public-release-plan.md §B.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { sendMarkdown, prefersHtmlPage } from '../services/markdown-negotiation.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { AI_PROVENANCE_SPEC_V1, AI_PROVENANCE_SCHEMA_PATH } from '../models/ai-provenance-schemas.js';
import {
  buildAiTransparencyReport, listUnlabelledPublic, DEFAULT_TREND_DAYS,
} from '../services/ai-transparency-report.js';

/** Official section titles, quoted verbatim from the Code of Practice signature form. A section
 *  whose title is not held here is published by number alone — a paraphrased title in a compliance
 *  artefact is a small invention, and this file exists to not make those. */
const COP_SECTION_TITLES: Record<string, string> = {
  '2': 'Labelling deep fakes and AI-generated and manipulated published text',
};

/** Why this node cannot sign Section 1, in the operator's own words to the AI Office. It is the
 *  same fact `marking.text_watermarking` states, said where a reader is looking for the scope of
 *  the signature rather than for the marking layers. */
const COP_SECTION_1_DECLINED =
  'This node does not run the generative models itself, so imperceptible watermarking of model '
  + 'output is not a layer it is in a position to provide, and the operator would rather state that '
  + 'than commit to it.';

/**
 * The Code of Practice block — signatory status, and the SCOPE of the signature.
 *
 * `signatory` is true only where the operator configured the sections they actually signed
 * (AIMEAT_AI_COP_SECTIONS), never from a constant: see the config-types.ts note on why a signature
 * written into MIT source would be a false claim on everybody else's node.
 *
 * A signed section is only half an answer. Section 1 and Section 2 are separate commitments and a
 * deployer can honestly hold one without the other, so the section NOT signed is published beside
 * the one that is, with the reason. Reporting `signatory: true` alone would let a reader infer the
 * whole Code, which is the over-reading a transparency artefact is supposed to prevent.
 */
function buildCodeOfPractice(config: AimeatConfig): Record<string, unknown> {
  const sections = config.aiCopSections;
  if (!sections.length) return { signatory: false, sections: [] };
  const has = (n: string) => sections.includes(n);
  return {
    signatory: true,
    sections,
    section_titles: Object.fromEntries(
      sections.filter(s => COP_SECTION_TITLES[s]).map(s => [s, COP_SECTION_TITLES[s]]),
    ),
    signed_on: config.aiCopSignedOn || null,
    // Which duty-holder the signature was given as, derived from the sections rather than stated
    // twice: Section 1 is the provider's commitment, Section 2 the deployer's.
    role: has('1') ? (has('2') ? 'provider-and-deployer' : 'provider') : 'deployer',
    not_signed: has('1') ? [] : [{ section: '1', reason: COP_SECTION_1_DECLINED }],
  };
}

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
      // Two DIFFERENT regulators, kept in two different config fields on purpose. Naming the
      // data-protection authority here would be a false statement in a compliance artefact, so an
      // operator who has not told us theirs gets `null` and the note, never a guess.
      ai_market_surveillance: config.aiSupervisoryName
        ? { name: config.aiSupervisoryName, url: config.aiSupervisoryUrl || null }
        : null,
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
    // The correction procedure the Code of Practice asks for (Section 2, Commitment 2), named in the
    // artefact a regulator or a reader reads first. It routes into the node's existing moderation
    // queue — the one that already has reviewers, an auto-hide threshold and an appeal path —
    // rather than a second inbox that would look like a procedure without being one.
    correction: {
      how: `POST ${b}/v1/flags`,
      body: { targetType: 'ai_provenance | app | memory', targetId: '<record id, owner/filename, or gaii::key>', reason: 'undisclosed_ai' },
      reaches: 'the node operator\'s moderation queue, and an organism admin for organism content',
      appeal: `POST ${b}/v1/flags/{flagId}/appeal`,
      note: 'A visible AI label links to its own record; that record id is what to report.',
    },
    code_of_practice: buildCodeOfPractice(config),
    posture: {
      provenance: config.aiProvenance ? 'on' : 'off',
      detail: config.aiProvenanceDetail,
      // Presentation only, and worth publishing precisely because it can be STRICTER than the law:
      // a reader who sees a label on this node should be able to find out whether it means "the law
      // required this" or "the operator chose it". `disclosure.reason` on the record answers per
      // item; this answers for the node.
      visible_label: config.aiLabelPublic,
    },
  };
}

function renderMarkdown(config: AimeatConfig, s: Record<string, unknown>): string {
  const b = config.baseUrl.replace(/\/+$/, '');
  const op = s.operator as Record<string, string | null>;
  const marking = s.marking as Record<string, unknown>;
  const detection = s.detection as Record<string, string>;
  const posture = s.posture as Record<string, string>;
  const authorities = s.supervisory_authority as Record<string, unknown>;
  const ams = authorities.ai_market_surveillance as { name: string; url: string | null } | null;
  const correction = s.correction as Record<string, string>;
  const cop = s.code_of_practice as {
    signatory: boolean; sections: string[]; section_titles?: Record<string, string>;
    signed_on?: string | null; role?: string; not_signed?: { section: string; reason: string }[];
  };
  // Named sections, not a bare "yes". The number alone tells a reader nothing about what was
  // promised, and this is the surface an agent quotes back to somebody.
  const copLines = cop.signatory
    ? [
      `- Code of Practice signatory: **yes**, as ${cop.role || 'deployer'}`
        + (cop.signed_on ? ` (signed ${cop.signed_on})` : ''),
      ...cop.sections.map(n => `  - Section ${n}${cop.section_titles?.[n] ? ` — ${cop.section_titles[n]}` : ''}`),
      ...(cop.not_signed || []).map(ns => `  - Section ${ns.section} — **not signed**. ${ns.reason}`),
    ]
    : ['- Code of Practice signatory: **no**'];
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
    `- Visible label on public surfaces: **${posture.visible_label}**`
      + (posture.visible_label === 'strict'
        ? ' (also labels content the law exempts, such as content a person reviewed)'
        : ''),
    ...copLines,
    '',
    '## If a label is missing or wrong',
    '',
    'Anyone can report content that should carry an AI label and does not. A visible label links to',
    'its own provenance record; that record id is what to report.',
    '',
    `- Report it: \`${correction.how}\` with \`reason: "undisclosed_ai"\``,
    `- It reaches ${correction.reaches}`,
    `- Appeal a decision: \`${correction.appeal}\``,
    '',
    '## Who supervises this',
    '',
    ams
      ? `AI Act market surveillance: **${ams.name}**${ams.url ? ` (${ams.url})` : ''}.`
      : 'The AI Act market-surveillance authority for this node is **not stated**. It follows from where '
        + 'the operator is established, and it is a different regulator from the data-protection authority.',
    '',
    `Machine-readable: ${b}/v1/ai-transparency`,
    '',
  ].join('\n');
}

/**
 * What the node records about a model call, how long it keeps it, and what the owner can do about
 * it — the deployer's access to the logging policy that Sub-measure 1.1.3 of the Code of Practice
 * asks for where logging is used as a marking layer.
 *
 * DERIVED FROM CONFIG, like everything else in this file. A policy page that is prose somebody
 * edited by hand drifts away from what the software does, and a wrong retention promise is worse
 * than none — it is the one thing a deployer would rely on.
 */
function buildLoggingPolicy(config: AimeatConfig): Record<string, unknown> {
  const b = config.baseUrl.replace(/\/+$/, '');
  return {
    why: 'This node records how content was made so it can be labelled, and records model calls so '
      + 'they can be metered. The provenance record is the marking layer; the usage ledger is the '
      + 'billing layer. They are joined by provenanceId and neither contains prompt text.',
    records: [
      {
        what: 'AI provenance record',
        contains: 'level, human involvement, timestamp, model, provider, principal, node id, a '
          + 'SHA-256 of the exact bytes, and the pre-rendered disclosure text',
        never_contains: 'prompt text, response text, cost',
        retention: 'kept for as long as the content it describes exists — a record is an '
          + 'attributable statement about specific bytes, so it is append-only and is never edited; '
          + 'a correction is a NEW record about the new bytes',
        who_can_read: 'you, always. Anyone, but only while the content it describes is itself '
          + 'publicly readable — make the content private and the record returns to a 404.',
        your_controls: [
          `See your own: GET ${b}/v1/ai-transparency/mine`,
          'Stop a record being publicly resolvable: make the content it describes non-public',
        ],
      },
      {
        what: 'Usage ledger event (one per model call)',
        contains: 'agent, owner, model, provider, token counts, cost, source, and the provenance id',
        never_contains: 'prompt text, response text',
        retention: 'append-only; it is the billing source of truth',
        who_can_read: 'you, and the node operator',
        your_controls: [`See your own spend: GET ${b}/v1/ledger/usage`],
      },
      {
        what: 'Execution log (scheduled jobs and extension runs)',
        contains: 'timing, result, memory reads/writes',
        never_contains: 'prompt text',
        retention: `pruned after ${config.executionLogRetentionDays} days on this node`,
        who_can_read: 'you, and the node operator',
        your_controls: ['Set by the operator via AIMEAT_EXECUTION_LOG_RETENTION_DAYS'],
      },
      {
        what: 'Consent audit',
        contains: 'who was granted what, and when',
        never_contains: 'content',
        retention: `pruned after ${config.consentAuditRetentionDays} days on this node`,
        who_can_read: 'you, and the node operator',
        your_controls: ['Set by the operator via AIMEAT_CONSENT_AUDIT_RETENTION_DAYS'],
      },
    ],
    posture: {
      provenance: config.aiProvenance ? 'on' : 'off',
      detail_served_publicly: config.aiProvenanceDetail,
      visible_label: config.aiLabelPublic,
    },
    // The honest limit. Saying it here costs nothing and stops the policy reading as a promise the
    // node cannot keep.
    note: 'This node does not watermark text — it does not sample the tokens, and that layer belongs '
      + 'to whoever runs the model. What it does is record how content was made, attributably.',
  };
}

export function aiTransparencyRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/ai-transparency', (req: Request, res: Response) => {
    res.set('Access-Control-Allow-Origin', '*');
    // A person who pastes the machine URL into a browser gets the page, not a wall of JSON. Only
    // a client that ranks text/html ABOVE application/json is redirected, which is what a browser
    // does and what curl, fetch() and every agent following the llms.txt / .well-known / bootstrap
    // links do NOT — so the default answer on this route is still, and must stay, JSON.
    res.vary('Accept');
    if (prefersHtmlPage(req)) {
      res.redirect(302, '/v1/transparency');
      return;
    }
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

  // ── GET /v1/admin/ai-transparency-report — the operator's documentation duty, from data ──
  // Section 2, Commitment 2 of the Code of Practice asks a provider to keep documentation of what it
  // marks and how. This answers it from the records the node already holds rather than from a
  // spreadsheet somebody maintains, which means it cannot go stale.
  router.get('/v1/admin/ai-transparency-report',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const sinceDays = Number.parseInt(String(req.query.since_days ?? ''), 10);
      const report = await buildAiTransparencyReport(storage, {
        sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
      });
      const detail = await listUnlabelledPublic(storage, {
        sinceDays: Number.isFinite(sinceDays) ? sinceDays : DEFAULT_TREND_DAYS,
        limit: 50,
      });
      res.json(success(config.nodeId, {
        ...report,
        unlabelled_detail: {
          // `total` beside a capped list, always: a truncated list with no total reads as the whole
          // story, which is precisely how a compliance report comes to overstate coverage.
          total: detail.total,
          shown: detail.items.length,
          items: detail.items.map(serveRow),
        },
      }, [
        { description: 'The node\'s public transparency statement', method: 'GET', url: '/v1/ai-transparency' },
        { description: 'Report unlabelled AI content (anyone can)', method: 'POST', url: '/v1/flags' },
      ]));
    });

  // ── GET /v1/ai-transparency/mine — what YOUR agents published, and how it was labelled ──
  // Most publishing on this node is done by accounts, so an account has to be able to see its own
  // exposure without asking the operator. Scoped by resolveIdentity(), never by a query parameter.
  router.get('/v1/ai-transparency/mine', requireAuth(), async (req: Request, res: Response) => {
    const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
    const sinceDays = Number.parseInt(String(req.query.since_days ?? ''), 10);
    const opts = { ownerGhii, sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined };
    const [report, recent, unlabelled] = await Promise.all([
      buildAiTransparencyReport(storage, opts),
      storage.listAiProvenance({ ownerGhii, limit: 25 }),
      listUnlabelledPublic(storage, { ...opts, limit: 25 }),
    ]);
    res.json(success(config.nodeId, {
      ...report,
      recent: { total: recent.total, shown: recent.items.length, items: recent.items.map(serveRow) },
      unlabelled_detail: {
        total: unlabelled.total,
        shown: unlabelled.items.length,
        items: unlabelled.items.map(serveRow),
      },
    }, [
      { description: 'What this node logs about a model call, and for how long', method: 'GET', url: '/v1/ai-transparency/logging-policy' },
      { description: 'Report content that should carry a label and does not', method: 'POST', url: '/v1/flags' },
    ]));
  });

  // ── GET /v1/ai-transparency/logging-policy — the deployer's access to the logging policy ──
  // Sub-measure 1.1.3: where logging is used as a marking layer, the deployer gets access to the
  // policy and control over retention. The ledger existed; the owner had no view of it AS a policy.
  router.get('/v1/ai-transparency/logging-policy', requireAuth(), (_req: Request, res: Response) => {
    res.json(success(config.nodeId, buildLoggingPolicy(config), [
      { description: 'What you have published, and how it was labelled', method: 'GET', url: '/v1/ai-transparency/mine' },
      { description: 'Your own spend, joined to what it produced', method: 'GET', url: '/v1/ledger/usage' },
    ]));
  });

  return router;
}

/** One provenance row as this surface serves it: enough to act on, and a link to the whole record. */
function serveRow(row: AiProvenanceRecordRow): Record<string, unknown> {
  return {
    id: row.id,
    principal: row.principal,
    content_hash: row.contentHash,
    generated_at: row.generatedAt,
    level: row.record.level,
    human_involvement: row.record.humanInvolvement,
    disclosure_required: row.record.disclosure?.required ?? false,
    pipeline: row.record.generator?.pipeline ?? null,
    model: row.record.generator?.model ?? null,
    record_url: row.record.attestation?.recordUrl ?? null,
  };
}
