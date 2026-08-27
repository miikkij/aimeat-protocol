/**
 * @file src/services/app-ui/validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mosaic layout validator (TARGET-074): every refusal is worded, names the
 *   offending block and field, and — NEW against the surface-layout precedent, which only
 *   enumerates — suggests the NEAREST KNOWN NAME when a component or prop id is one typo away.
 *   The measurement found no did-you-mean anywhere in the codebase; the promise in the spec is
 *   honoured here.
 *
 *   It throws on the FIRST problem (a builder fixes one thing at a time), and the same function
 *   runs on every door — the PUT route, the MCP set tool and the dry-run endpoint — so a layout
 *   that passes anywhere passes everywhere.
 * @structure AppUiError · nearest() · validateUiLayout(raw) → AppUiLayout
 * @usage
 *   import { validateUiLayout, AppUiError } from './validate.js';
 *   const layout = validateUiLayout(req.body);   // throws AppUiError(422) with words
 * @version-history
 *   v1.2.0 — 2026-08-28 — The SIGNATURE: optional top-level `tokens`, validated against the
 *     registry allowlist (shape/typography/density/motion — a colour name is refused with the
 *     reason, not just the list), values bounded and vehicle-proof (no urls, no declaration
 *     characters). TARGET-074 phase 4, signature-look.
 *   v1.1.1 — 2026-08-28 — SECURITY (CodeQL js/loop-bound-injection): nearest() ran the O(m*n)
 *     Levenshtein against the caller-supplied name at full length, so a huge submitted look/nav/block
 *     value was a DoS. The name is capped at 64 chars before the distance loop; a real name is far
 *     shorter and a long one is never a typo away, so no real suggestion changes.
 *   v1.1.0 — 2026-08-27 — Per-block `span` (composition grid placement), validated against
 *     BLOCK_SPANS with the same did-you-mean refusal every other name gets.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import type { BlockPropValue } from '../surface-layout/types.js';
import { propProblem } from '../surface-layout/validate.js';
import { componentById, NAV_MODES, LOOKS, BLOCK_SPANS, UI_COMPONENTS, SIGNATURE_TOKENS } from './registry.js';

/** More blocks than this is a page nobody reads — and a payload nobody meant. */
const MAX_BLOCKS = 40;
/** Block ids are addresses: short slugs, stable across writes. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Suggest a name only when it is plausibly a typo, not a different idea. */
const SUGGEST_MAX_DISTANCE = 3;

export class AppUiError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message);
    this.name = 'AppUiError';
  }
}

export interface AppUiBlockInstance {
  id: string;
  component: string;
  props?: Record<string, BlockPropValue>;
  /** How much of the composition grid the block takes. Absent means the full line. */
  span?: string;
  hidden?: boolean;
}

export interface AppUiLayout {
  v: 1;
  look?: string;
  nav?: string;
  /** The app's SIGNATURE: bounded token overrides (shape, typography, density, motion). */
  tokens?: Record<string, string>;
  blocks: AppUiBlockInstance[];
  meta?: { note?: string };
}

/** A token value is a short CSS value, never a sentence and never a vehicle: no urls, no
 *  declaration or block characters that could smuggle a second property past the allowlist. */
const TOKEN_VALUE_MAX = 120;
const TOKEN_VALUE_FORBIDDEN = /url\s*\(|[;{}<>@\\]|\/\*/i;

/** Plain Levenshtein — the vocabulary is dozens of short names, so brute force is fine. */
function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n]!;
}

/** The nearest known name, when it is near enough to be a typo. */
export function nearest(given: string, known: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = SUGGEST_MAX_DISTANCE + 1;
  // Bound the caller-supplied name before the O(m*n) Levenshtein below (js/loop-bound-injection):
  // a real look/nav/block name is a handful of characters, and a long input is never "one typo
  // away" from a known short name, so capping it changes no real suggestion.
  const lower = given.toLowerCase().slice(0, 64);
  for (const k of known) {
    const d = distance(lower, k.toLowerCase());
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= SUGGEST_MAX_DISTANCE ? best : null;
}

function fail(message: string): never {
  throw new AppUiError('LAYOUT_INVALID', message, 422);
}

/** `"x" — did you mean "y"?` when a near name exists, plus the legal set either way. */
function unknownName(kind: string, given: string, known: string[]): never {
  const guess = nearest(given, known);
  const hint = guess ? ` Did you mean "${guess}"?` : '';
  fail(`this node has no ${kind} called "${given}".${hint} The ${kind}s it has: ${known.join(', ')}.`);
}

/**
 * Validate one submitted layout. Returns the typed layout (unknown fields dropped) or throws an
 * AppUiError whose message a builder can act on without fetching anything else.
 */
export function validateUiLayout(raw: unknown): AppUiLayout {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('a layout is one object: { v: 1, blocks: [...] }. Fetch the catalogue from the same tool you are writing with.');
  }
  const input = raw as Record<string, unknown>;
  if (input.v !== 1) fail('the layout version must be v: 1 — this node knows no other.');

  const out: AppUiLayout = { v: 1, blocks: [] };

  if (input.look !== undefined) {
    if (typeof input.look !== 'string' || !(LOOKS as readonly string[]).includes(input.look)) {
      unknownName('look', String(input.look), [...LOOKS]);
    }
    out.look = input.look;
  }
  if (input.nav !== undefined) {
    if (typeof input.nav !== 'string' || !(NAV_MODES as readonly string[]).includes(input.nav)) {
      unknownName('navigation mode', String(input.nav), [...NAV_MODES]);
    }
    out.nav = input.nav;
  }

  if (input.tokens !== undefined) {
    if (input.tokens === null || typeof input.tokens !== 'object' || Array.isArray(input.tokens)) {
      fail('tokens is one object of { "--ak-…": "value" } overrides — the catalogue\'s signature_tokens lists the legal names.');
    }
    const legal = Object.keys(SIGNATURE_TOKENS);
    out.tokens = {};
    for (const [name, value] of Object.entries(input.tokens as Record<string, unknown>)) {
      if (!legal.includes(name)) {
        if (/color|accent|bg|ink|surface|scrim|grad/i.test(name)) {
          fail(`"${name}" is a colour token, and colour overrides wait for the contrast bench — an unproven colour is how a signature stops being readable. The signature covers shape, typography, density and motion: ${legal.join(', ')}.`);
        }
        unknownName('signature token', name, legal);
      }
      if (typeof value !== 'string' || !value.trim() || value.length > TOKEN_VALUE_MAX) {
        fail(`the value of ${name} must be a short CSS value string (at most ${TOKEN_VALUE_MAX} characters).`);
      }
      if (TOKEN_VALUE_FORBIDDEN.test(value)) {
        fail(`the value of ${name} may not carry urls, comments or declaration characters — a token is one value, never a vehicle.`);
      }
      out.tokens[name] = value;
    }
    if (Object.keys(out.tokens).length === 0) delete out.tokens;
  }

  if (!Array.isArray(input.blocks)) fail('blocks must be a list of block instances.');
  if (input.blocks.length > MAX_BLOCKS) fail(`a layout holds at most ${MAX_BLOCKS} blocks; this one has ${input.blocks.length}.`);

  const componentIds = UI_COMPONENTS.map((c) => c.id);
  const seenIds = new Set<string>();
  const perComponent = new Map<string, number>();

  input.blocks.forEach((rawBlock, index) => {
    const at = `block ${index}`;
    if (rawBlock === null || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
      fail(`${at}: each block is an object { id, component, props }.`);
    }
    const b = rawBlock as Record<string, unknown>;
    if (typeof b.id !== 'string' || !SLUG_RE.test(b.id)) {
      fail(`${at}: the block id must be a short slug (a-z, 0-9, dashes) — it is the address later writes and per-viewer overlays use.`);
    }
    if (seenIds.has(b.id)) fail(`${at}: the id "${b.id}" is already used — every block id is unique.`);
    seenIds.add(b.id);

    if (typeof b.component !== 'string') fail(`${at} ("${b.id}"): name the component.`);
    const def = componentById(b.component);
    if (!def) unknownName('component', b.component, componentIds);

    const count = (perComponent.get(def.id) ?? 0) + 1;
    perComponent.set(def.id, count);
    if (def.maxPerLayout !== undefined && count > def.maxPerLayout) {
      fail(`${at} ("${b.id}"): at most ${def.maxPerLayout} ${def.id} per layout — ${def.id === 'hero' ? 'two focal points is shouting' : 'the layout stops reading as one'}.`);
    }

    const props: Record<string, BlockPropValue> = {};
    if (b.props !== undefined) {
      if (b.props === null || typeof b.props !== 'object' || Array.isArray(b.props)) {
        fail(`${at} ("${b.id}"): props is an object of settings.`);
      }
      for (const [name, value] of Object.entries(b.props as Record<string, unknown>)) {
        const propDef = def.props[name];
        if (!propDef) {
          const guess = nearest(name, Object.keys(def.props));
          const hint = guess ? ` Did you mean "${guess}"?` : '';
          fail(`${at} ("${b.id}"): ${def.id} has no setting called "${name}".${hint} Its settings: ${Object.keys(def.props).join(', ') || '(none)'}.`);
        }
        const problem = propProblem(propDef, value as BlockPropValue);
        if (problem) fail(`${at} ("${b.id}"): the setting "${name}" ${problem}.`);
        if ((name === 'image') && typeof value === 'string' && /^data:/i.test(value)) {
          fail(`${at} ("${b.id}"): "${name}" is a data: URI — upload the image to storage and pass its URL. Inlined image bytes are how an app file outgrows its own edit loop.`);
        }
        props[name] = value as BlockPropValue;
      }
    }
    for (const [name, propDef] of Object.entries(def.props)) {
      if (propDef.required && props[name] === undefined) {
        fail(`${at} ("${b.id}"): ${def.id} needs "${name}" — ${propDef.description}`);
      }
    }

    if (b.span !== undefined) {
      if (typeof b.span !== 'string' || !(BLOCK_SPANS as readonly string[]).includes(b.span)) {
        unknownName('span', String(b.span), [...BLOCK_SPANS]);
      }
    }

    out.blocks.push({
      id: b.id,
      component: def.id,
      ...(Object.keys(props).length ? { props } : {}),
      ...(typeof b.span === 'string' && b.span !== 'full' ? { span: b.span } : {}),
      ...(b.hidden === true ? { hidden: true } : {}),
    });
  });

  const note = (input.meta as Record<string, unknown> | undefined)?.note;
  if (typeof note === 'string' && note.trim()) out.meta = { note: note.trim().slice(0, 300) };

  return out;
}
