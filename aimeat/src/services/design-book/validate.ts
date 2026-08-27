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
 *   V1 CARRIES ONLY THE KINDS THE NODE CAN PROVE TODAY: `layout` (a complete mosaic arrangement)
 *   and `fill` (a leiska — the same shape with <angle-bracket> placeholders, a starting shape to
 *   fill). Both are proven by the SAME validator every stored app layout passes through, so a
 *   part that enters the Book is a part every adopt is guaranteed to accept. Component and look
 *   kinds arrive when a bench exists that can prove them; a kind this file does not know is
 *   refused by name rather than stored on trust.
 * @structure DesignBookError · PART_KINDS · PART_STATUSES · validatePartInput()
 * @usage
 *   const part = validatePartInput(raw);   // throws DesignBookError with worded refusals
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { validateUiLayout, AppUiError, type AppUiLayout } from '../app-ui/validate.js';

export class DesignBookError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'DesignBookError';
  }
}

/** The kinds the node can PROVE. Growing this list means growing the bench first. */
export const PART_KINDS = ['layout', 'fill'] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const PART_STATUSES = ['proposed', 'published', 'aging', 'retired'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

/** A part id is an address other records hold forever: short, lowercase, hyphenated. */
const ID_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;

export interface PartInput {
  id: string;
  kind: PartKind;
  title: string;
  summary: string;
  body: AppUiLayout;
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
      '(layout = a complete mosaic arrangement; fill = the same shape with <placeholder> slots to fill.)');
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

  let body: AppUiLayout;
  try {
    body = validateUiLayout(p.body);
  } catch (err) {
    if (err instanceof AppUiError) {
      throw new DesignBookError('BODY_INVALID',
        `The part body did not pass the layout bench — ${err.message}`, 422);
    }
    throw err;
  }

  return { id, kind: kind as PartKind, title, summary, body, tags };
}
