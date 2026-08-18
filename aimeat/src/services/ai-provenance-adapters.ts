/**
 * @file src/services/ai-provenance-adapters.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONLY place in AIMEAT where an external AI-transparency vocabulary string appears.
 *   Five pure functions project the canonical `aimeat.provenance/v1` record onto the four external
 *   vocabularies plus the official EU icons. Nothing here does I/O; nothing here is stored.
 *
 *   WHY THE PROJECTION RUNS THIS WAY ROUND. Four vocabularies for "how much AI is in this" already
 *   exist and they do not agree — two of them come from the same proposal family and still disagree
 *   with each other. None can express `humanInvolvement` separately from `level`, and that
 *   separation is what decides whether a label is owed. So our two fields are the stored form and
 *   everything else is derived. Storing an external value would mean inheriting that project's
 *   future; deriving it means that when the IETF draft expires (3 Aug 2026) or the W3C Community
 *   Group vocabulary settles, ONE function and ONE test row change and nothing else moves.
 *
 *   If you find yourself typing `trainedAlgorithmicMedia` anywhere outside this file, that is a bug.
 *
 *   ABSENCE IS `unstated`, NEVER `none`. Every function takes `unknown` and routes it through
 *   asKnownProvenance(), so an absent record, an unknown `spec` and a malformed object all behave
 *   the same: the machine planes omit their mark (we have nothing to assert) and the EU icon becomes
 *   `ai-basic` with an "origin unstated" alt. A missing record never reads as "a human wrote it".
 * @structure
 *   - toIptc            — IPTC digitalSourceType URI (also what C2PA carries)
 *   - toW3cHtml         — W3C CG `ai-disclosure` attribute value
 *   - toIetfHeader      — `AI-Disclosure` value, RFC 9651 structured field (draft-abaris-aicdh)
 *   - toEuIcon          — official EU icon stem + alt-text i18n key
 *   - toC2paAssertion   — C2PA action assertion, a strict projection of toIptc
 * @usage
 *   import { toIptc, toEuIcon } from './ai-provenance-adapters.js';
 *   const uri = toIptc(record);              // undefined = emit nothing
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. Mapping is the truth table in
 *     docs/internal/EUAct/22-frozen-vocabulary.md Part C2, executed by
 *     test/unit/ai-provenance-adapters.test.ts.
 */
import {
  asKnownProvenance,
  type AiProvenance, type MaybeAiProvenance,
} from '../models/ai-provenance-schemas.js';

/** IPTC's controlled vocabulary lives under this namespace. */
const IPTC_DIGITAL_SOURCE_TYPE = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

/** W3C Community Group `ai-disclosure` values (formed Feb 2026 — young, expect movement). */
export type W3cAiDisclosure = 'none' | 'ai-assisted' | 'ai-generated' | 'autonomous';

/**
 * A reference to one of the official EU icons.
 *
 * `file` is the icon STEM, not a full filename: the four variants (`_black`, `_white`, and their
 * 50%-transparency siblings, in `public/assets/eu-ai-icons/svg/`) are chosen by theme and by
 * whether the icon sits over imagery, which a pure function cannot know. `alt` is the i18n KEY for
 * the alt text, never a rendered string — the icons carry an accessibility duty (alt text / ARIA
 * stating the content is AI-generated) and "AI-generated" as English text in a component is exactly
 * what 19-future-proofing §5 says never to hardcode.
 */
export interface EuIconRef { file: 'ai-basic' | 'ai-generated' | 'ai-modified'; alt: string }

/** One C2PA action assertion. `digitalSourceType` is the same IPTC URI toIptc() produces. */
export interface C2paAction {
  action: 'c2pa.created' | 'c2pa.edited';
  digitalSourceType?: string;
  softwareAgent?: string;
  when?: string;
}

/** Did a person read the substance and retain the power to reject it? */
function reviewed(p: AiProvenance): boolean {
  return p.humanInvolvement === 'editorial-control' || p.humanInvolvement === 'full-human';
}

// ── IPTC ────────────────────────────────────────────────────────────────────────────────────────

/**
 * IPTC `digitalSourceType` URI, or undefined to emit nothing.
 *
 * `original` omits rather than claiming `digitalCapture`: we know a model was not involved, which
 * is not the same as knowing the content came from a camera.
 */
export function toIptc(input: MaybeAiProvenance): string | undefined {
  const p = asKnownProvenance(input);
  if (!p) return undefined;
  switch (p.level) {
    case 'original': return undefined;
    case 'assisted': return `${IPTC_DIGITAL_SOURCE_TYPE}compositeWithTrainedAlgorithmicMedia`;
    case 'synthesized':
    case 'ai-generated': return `${IPTC_DIGITAL_SOURCE_TYPE}trainedAlgorithmicMedia`;
  }
}

// ── W3C ─────────────────────────────────────────────────────────────────────────────────────────

/** W3C `ai-disclosure` attribute value, or undefined to omit the attribute entirely. */
export function toW3cHtml(input: MaybeAiProvenance): W3cAiDisclosure | undefined {
  const p = asKnownProvenance(input);
  if (!p) return undefined;
  switch (p.level) {
    case 'original': return 'none';
    case 'assisted': return 'ai-assisted';
    case 'synthesized':
    case 'ai-generated': return reviewed(p) ? 'ai-generated' : 'autonomous';
  }
}

// ── IETF ────────────────────────────────────────────────────────────────────────────────────────

/** RFC 9651 `mode` token. Its own switch, because the IETF and W3C vocabularies disagree. */
function ietfMode(p: AiProvenance): string {
  switch (p.level) {
    case 'original': return 'none';
    case 'assisted': return 'ai-modified';
    case 'synthesized':
    case 'ai-generated': return reviewed(p) ? 'ai-originated' : 'machine-generated';
  }
}

/**
 * Serialise one RFC 9651 sf-string parameter, or return null when the value cannot be one.
 * sf-string is ASCII printable only (0x20–0x7E) with `\` and `"` escaped; a value carrying anything
 * else is DROPPED rather than emitted broken, because an unparseable header is worse than a header
 * missing one hint. Escaping is what stops a hostile model id from injecting extra parameters.
 */
function sfString(value: string | undefined): string | null {
  if (!value) return null;
  if (/[^\x20-\x7E]/.test(value)) return null;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * `AI-Disclosure` header VALUE per the IETF individual draft `draft-abaris-aicdh` — a structured
 * field whose `mode` member carries model/provider/date as parameters. The draft expires
 * 3 Aug 2026 and has no working group; when it moves or dies, only this function changes, and
 * `Link: <…>; rel="ai-provenance"` (which points at our own record) is the half that survives.
 *
 * Returns undefined for unstated provenance — omit the header rather than assert nothing.
 */
export function toIetfHeader(input: MaybeAiProvenance): string | undefined {
  const p = asKnownProvenance(input);
  if (!p) return undefined;

  const parts = [`mode=${ietfMode(p)}`];
  const model = sfString(p.generator?.model);
  if (model) parts.push(`model=${model}`);
  const provider = sfString(p.generator?.provider);
  if (provider) parts.push(`provider=${provider}`);
  const ms = Date.parse(p.generatedAt);
  if (!Number.isNaN(ms)) parts.push(`date=@${Math.floor(ms / 1000)}`);

  return parts.join('; ');
}

// ── EU icons ────────────────────────────────────────────────────────────────────────────────────

/**
 * Which official EU icon to show, and the i18n key for its alt text. `undefined` means no icon:
 * a human wrote it and there is nothing to disclose.
 *
 * The unstated case is deliberately NOT silence. A record we did not stamp gets the basic icon and
 * an honest "AI involvement unstated" alt — absence is not "human". Whether a label is *owed* is a
 * separate question, answered by disclosureFor(); this function only says which badge is correct
 * if one is shown.
 */
export function toEuIcon(input: MaybeAiProvenance): EuIconRef | undefined {
  const p = asKnownProvenance(input);
  if (!p) return { file: 'ai-basic', alt: 'aiLabel.iconAlt.unstated' };
  switch (p.level) {
    case 'original': return undefined;
    case 'assisted': return { file: 'ai-modified', alt: 'aiLabel.iconAlt.aiModified' };
    case 'synthesized':
    case 'ai-generated': return reviewed(p)
      ? { file: 'ai-basic', alt: 'aiLabel.iconAlt.aiBasic' }
      : { file: 'ai-generated', alt: 'aiLabel.iconAlt.aiGenerated' };
  }
}

// ── C2PA ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A C2PA action assertion. C2PA carries the IPTC vocabulary, so this is a strict projection of
 * toIptc(): present exactly when there is an IPTC value to assert, absent otherwise. The record
 * does not depend on C2PA existing — if we never obtain a signing certificate, everything else
 * still works and this adapter simply goes unused.
 */
export function toC2paAssertion(input: MaybeAiProvenance): C2paAction | undefined {
  const p = asKnownProvenance(input);
  if (!p) return undefined;
  const digitalSourceType = toIptc(p);
  if (!digitalSourceType) return undefined;
  const assertion: C2paAction = {
    action: p.level === 'assisted' ? 'c2pa.edited' : 'c2pa.created',
    digitalSourceType,
    when: p.generatedAt,
  };
  if (p.generator?.model) assertion.softwareAgent = p.generator.model;
  return assertion;
}
