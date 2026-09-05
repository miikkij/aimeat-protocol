/**
 * @file src/services/design-book/validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a Design Book part must prove before it becomes a record (TARGET-074 phase 5).
 *
 *   THE BENCH RUNS AT PROPOSE TIME, NOT AT REVIEW TIME. The earned path is proposal → machine
 *   bench → human publish, and the bench is this file: a part whose body the node cannot prove
 *   valid never lands even as a proposal, and the refusal carries the validator's words so the
 *   proposer can act without a review round.
 *
 *   THE BOOK CARRIES ONLY KINDS THE NODE CAN PROVE. `layout` (a complete mosaic arrangement) and
 *   `fill` (a leiska — the same shape with <angle-bracket> placeholders) run the same validator
 *   every stored app layout passes. `look` (a signature token sheet + optional preset) and
 *   `motion` (the motion-token subset) run the signature-token bench, contrast-matrix pair proof
 *   included. `illustration` (art direction for the imagery pipeline) runs the imagery-style
 *   bench. `genre` names one of the node's served page templates. `ambient` (the one layer
 *   allowed to move at idle, with the look it was proven on) runs the ambient bench, which
 *   proves the preset on that look through the contrast matrix. A kind this file does not know
 *   is refused by name rather than stored on trust.
 * @structure DesignBookError · PART_KINDS · MOTION_TOKENS · PART_STATUSES · validatePartInput()
 * @usage
 *   const part = validatePartInput(raw);   // throws DesignBookError with worded refusals
 * @version-history
 *   v1.2.0 — 2026-09-05 — The AMBIENT kind (wish-atelier-ambient-visuals): a body of
 *     { ambient, alpha?, speed?, look?, tokens? } through validateAmbientSpec on the part's look
 *     (or the first look the registry says the preset fits), "none" refused because a part that
 *     switches things off is an arrangement's choice; the look-name refusal is one helper now,
 *     shared by the look and ambient kinds; the unknown-kind sentence names genre and ambient.
 *   v1.1.0 — 2026-08-28 — THREE NEW KINDS, each with a bench that can prove it (TARGET-074):
 *     `look` (a signature token sheet + optional preset — the same token bench a layout's
 *     signature runs, contrast-matrix pair proof included), `motion` (the same sheet restricted
 *     to the motion tokens), and `illustration` (art direction as data, the imagery-style bench).
 *     The kind decides the body's shape and its bench in benchBodyFor().
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import {
  validateUiLayout, validateSignatureTokens, validateImageryStyle, validateAmbientSpec, AppUiError,
} from '../app-ui/validate.js';
import { LOOKS } from '../app-ui/registry.js';
import { getAppTemplates } from '../../data/app-templates.js';
import { AMBIENT_IDS, ambientById } from '../../data/atelier-ambients.js';

export class DesignBookError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'DesignBookError';
  }
}

/** The kinds the node can PROVE. Growing this list means growing the bench first. */
export const PART_KINDS = ['layout', 'fill', 'look', 'motion', 'illustration', 'genre', 'ambient'] as const;
export type PartKind = (typeof PART_KINDS)[number];

/** The motion recipe's vocabulary: the signature tokens that ARE motion. */
export const MOTION_TOKENS = [
  '--ak-motion', '--ak-ease', '--ak-enter-distance', '--ak-enter-stagger', '--ak-tilt', '--ak-kinetic',
] as const;

export const PART_STATUSES = ['proposed', 'published', 'aging', 'retired'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

/** A part id is an address other records hold forever: short, lowercase, hyphenated. */
const ID_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;

export interface PartInput {
  id: string;
  kind: PartKind;
  title: string;
  summary: string;
  /** The kind decides the shape: a whole layout (layout/fill), a token sheet with an optional
   *  preset (look), a motion-token sheet (motion), or art direction (illustration). */
  body: Record<string, unknown>;
  tags: string[];
}

/**
 * The whole propose-time bench. Field checks first (cheap, worded), then the body through the
 * app-ui validator — the same code every adopt will run, so passing here IS the guarantee.
 */
export function validatePartInput(raw: unknown): PartInput {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DesignBookError('INVALID_PART', 'A part is an object: { id, kind, title, summary, body, tags? }.');
  }
  const p = raw as Record<string, unknown>;

  const id = typeof p.id === 'string' ? p.id.trim() : '';
  if (!ID_RE.test(id)) {
    throw new DesignBookError('INVALID_ID',
      'The part id is its permanent address: 3-61 characters, lowercase letters, digits and hyphens, starting with a letter or digit — like "cover-figure-wire".');
  }

  const kind = typeof p.kind === 'string' ? p.kind : '';
  if (!(PART_KINDS as readonly string[]).includes(kind)) {
    throw new DesignBookError('UNKNOWN_KIND',
      `"${kind}" is not a part kind this node can prove. It proves: ${PART_KINDS.join(', ')}. ` +
      '(layout = a complete mosaic arrangement; fill = the same shape with <placeholder> slots to fill; ' +
      'look = a signature token sheet with an optional preset; motion = a motion-token recipe; ' +
      'illustration = art direction for the imagery pipeline; genre = one of the node\'s served page ' +
      'templates, shown and forked rather than adopted; ambient = the animated layer behind an app, ' +
      'proven on a look.)');
  }

  const title = typeof p.title === 'string' ? p.title.trim() : '';
  if (!title || title.length > 80) {
    throw new DesignBookError('INVALID_TITLE', 'A part carries a title of 1-80 characters — the name the gallery shows.');
  }
  const summary = typeof p.summary === 'string' ? p.summary.trim() : '';
  if (!summary || summary.length > 240) {
    throw new DesignBookError('INVALID_SUMMARY',
      'A part carries a summary of 1-240 characters: what this arrangement is FOR, so a picker can choose without rendering it.');
  }

  const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : [];

  const body = benchBodyFor(kind as PartKind, p.body);
  return { id, kind: kind as PartKind, title, summary, body, tags };
}

/** Each kind's own propose-time bench, every refusal in the underlying validator's words. */
function benchBodyFor(kind: PartKind, raw: unknown): Record<string, unknown> {
  try {
    if (kind === 'layout' || kind === 'fill') {
      return validateUiLayout(raw) as unknown as Record<string, unknown>;
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DesignBookError('BODY_INVALID', bodyShapeHint(kind), 422);
    }
    const o = raw as Record<string, unknown>;
    if (kind === 'illustration') {
      return validateImageryStyle(o) as unknown as Record<string, unknown>;
    }
    // A GENRE points at one of the registry's genre templates — a complete committed page.
    // The Book PROVES and SHOWS it; taking one home is a FORK of the template, never a merge,
    // so adopt refuses this kind with the address (service.ts).
    if (kind === 'genre') {
      const id = typeof o.template === 'string' ? o.template : '';
      const known = getAppTemplates().filter((t) => t.kind === 'genre').map((t) => t.id);
      if (!known.includes(id)) {
        throw new DesignBookError('BODY_INVALID',
          `A genre part's body is { "template": "<id>" } naming a genre template this node serves. It serves: ${known.join(', ')}.`, 422);
      }
      return { template: id };
    }
    // An AMBIENT carries one of the presets, the numbers, and the look it was proven on (the
    // first look the registry says it fits, when the part names none — the same look the
    // preview shows it on). "none" is an arrangement's choice and never a part.
    if (kind === 'ambient') {
      if (o.ambient === 'none') {
        throw new DesignBookError('BODY_INVALID',
          'An ambient part carries one of the presets. "none" is an arrangement\'s choice, not a part: to switch a look\'s ambient off, store { "ambient": { "preset": "none" } } on the app\'s arrangement.', 422);
      }
      if (typeof o.ambient !== 'string') throw new DesignBookError('BODY_INVALID', bodyShapeHint(kind), 422);
      const look = o.look === undefined ? undefined : lookNameOrRefuse(o.look);
      const provenOn = look ?? ambientById(o.ambient)?.fitsLooks[0];
      const spec = validateAmbientSpec({ preset: o.ambient, alpha: o.alpha, speed: o.speed }, provenOn);
      const out: Record<string, unknown> = { ambient: spec.preset };
      if (spec.alpha !== undefined) out.alpha = spec.alpha;
      if (spec.speed !== undefined) out.speed = spec.speed;
      if (o.tokens !== undefined) {
        const tokens = validateSignatureTokens(o.tokens, look);
        if (Object.keys(tokens).length > 0) out.tokens = tokens;
      }
      if (look !== undefined) out.look = look;
      return out;
    }
    // look and motion: a token sheet — the same bench a layout's signature runs, including the
    // contrast-matrix proof of an `--ak-accent` pair.
    const tokens = validateSignatureTokens(o.tokens, typeof o.look === 'string' ? o.look : undefined);
    if (Object.keys(tokens).length === 0) {
      throw new DesignBookError('BODY_INVALID',
        `A ${kind} part carries at least one token — an empty sheet changes nothing and proves nothing.`, 422);
    }
    if (kind === 'motion') {
      for (const name of Object.keys(tokens)) {
        if (!(MOTION_TOKENS as readonly string[]).includes(name)) {
          throw new DesignBookError('BODY_INVALID',
            `"${name}" is not a motion token. A motion recipe covers exactly: ${MOTION_TOKENS.join(', ')} — anything more belongs in a look part.`, 422);
        }
      }
      return { tokens };
    }
    const out: Record<string, unknown> = { tokens };
    if (o.look !== undefined) out.look = lookNameOrRefuse(o.look);
    return out;
  } catch (err) {
    if (err instanceof AppUiError) {
      throw new DesignBookError('BODY_INVALID',
        `The part body did not pass the bench — ${err.message}`, 422);
    }
    throw err;
  }
}

/** A look this node ships, or the refusal that names them — the look and ambient kinds share it. */
function lookNameOrRefuse(value: unknown): string {
  if (typeof value !== 'string' || !(LOOKS as readonly string[]).includes(value)) {
    throw new DesignBookError('BODY_INVALID',
      `"${String(value)}" is not a look this node ships. The looks it has: ${LOOKS.join(', ')}.`, 422);
  }
  return value;
}

function bodyShapeHint(kind: PartKind): string {
  if (kind === 'illustration') return 'An illustration part\'s body is { style, palette_words? } — art direction as data.';
  if (kind === 'ambient') {
    return `An ambient part's body is { ambient: one of ${AMBIENT_IDS.join(', ')}, alpha?, speed?, look?, tokens? } — the layer behind the app, proven on the look.`;
  }
  return `A ${kind} part's body is { tokens: { "--ak-…": "value" }${kind === 'look' ? ', look?' : ''} }.`;
}
