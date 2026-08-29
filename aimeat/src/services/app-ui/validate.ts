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
 *   v1.4.0 — 2026-08-28 — Two benches step out as REUSABLE doors for the Design Book's new part
 *     kinds: validateSignatureTokens() (pure extraction of the tokens loop, now also serving the
 *     `look` and `motion` kinds) and validateImageryStyle() (new: art direction as data, serving
 *     the layout's append-only optional `imagery` field and the `illustration` kind).
 *   v1.3.0 — 2026-08-28 — The signature COLOUR opens: `--ak-accent` accepted as a light/dark pair
 *     "#hex/#hex", each half proven by the full contrast matrix against its own mode's combos
 *     (validateAccentPair). A failing half refuses with the measured numbers; other colour-token
 *     names still refuse, now pointing at the pair door. TARGET-074.
 *   v1.2.0 — 2026-08-28 — The SIGNATURE: optional top-level `tokens`, validated against the
 *     registry allowlist (shape/typography/density/motion — a colour name is refused with the
 *     reason, not just the list), values bounded and vehicle-proof (no urls, no declaration
 *     characters). TARGET-074 phase 4, signature-look.
 *   v1.1.1 — 2026-08-28 — SECURITY (CodeQL js/loop-bound-injection): distance() ran the O(m*n)
 *     Levenshtein against a caller-supplied name at full length, so a huge submitted look/nav/block
 *     value was a DoS. Both grid dimensions are now bounded by a constant (Math.min(.length, 64)) at
 *     the loop itself, and nearest() slices its input to 64 too; a real name is far shorter and a
 *     long one is never a typo away, so no real suggestion changes.
 *   v1.1.0 — 2026-08-27 — Per-block `span` (composition grid placement), validated against
 *     BLOCK_SPANS with the same did-you-mean refusal every other name gets.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import type { BlockPropValue } from '../surface-layout/types.js';
import { propProblem } from '../surface-layout/validate.js';
import { componentById, NAV_MODES, CHOREOGRAPHIES, LOOKS, BLOCK_SPANS, UI_COMPONENTS, SIGNATURE_TOKENS } from './registry.js';
import { runMatrix } from '../atelier-contrast.js';

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
  /** How the page moves under the reader's hand: 'still' (default) or 'cinema' — the opening
   *  band recedes and each section rises as it enters, all CSS scroll timelines, zero idle. */
  choreography?: string;
  /** The app's SIGNATURE: bounded token overrides (shape, typography, density, motion). */
  tokens?: Record<string, string>;
  /** Art direction for the imagery pipeline: a prompt fragment and optional colour words. */
  imagery?: { style: string; palette_words?: string };
  /** This arrangement is a DIALOG's inside: what kind of moment it is and how much room it
   *  takes. Absent means the arrangement is a screen. */
  dialog?: { title?: string; tone?: string; size?: string; from?: string };
  blocks: AppUiBlockInstance[];
  meta?: { note?: string };
}

/** A token value is a short CSS value, never a sentence and never a vehicle: no urls, no
 *  declaration or block characters that could smuggle a second property past the allowlist. */
const TOKEN_VALUE_MAX = 120;
const TOKEN_VALUE_FORBIDDEN = /url\s*\(|[;{}<>@\\]|\/\*/i;

/** Plain Levenshtein — the vocabulary is dozens of short names, so brute force is fine. */
function distance(a: string, b: string): number {
  // Bound both dimensions of the O(m*n) grid by a constant (js/loop-bound-injection). Callers pass
  // already-capped names (nearest slices to 64), and truncating a pathological input past 64 chars
  // changes no real suggestion — a name that far off is not a typo.
  const m = Math.min(a.length, 64);
  const n = Math.min(b.length, 64);
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
 * The signature-token bench, on its own so ONE implementation serves every door that takes
 * tokens: a layout's top-level `tokens`, and the Design Book's `look` and `motion` part kinds.
 * Returns the validated map (accent pair normalized); throws with the same worded refusals.
 */
export function validateSignatureTokens(raw: unknown, look?: string): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('tokens is one object of { "--ak-…": "value" } overrides — the catalogue\'s signature_tokens lists the legal names.');
  }
  const legal = Object.keys(SIGNATURE_TOKENS);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!legal.includes(name)) {
      if (/color|accent|bg|ink|surface|scrim|grad/i.test(name)) {
        // Colour is open, but through ONE door: measurement proved a single hex cannot satisfy
        // the mode-tuned derivations, so the signature colour is `--ak-accent` as a light/dark
        // pair and every other colour token stays derived from it by the sheet.
        fail(`"${name}" is a colour token the signature does not take directly — the one colour door is --ak-accent as a light/dark pair "#hex/#hex" (both halves are proven by the contrast matrix); every other colour derives from it. The signature covers: ${legal.join(', ')}.`);
      }
      unknownName('signature token', name, legal);
    }
    if (typeof value !== 'string' || !value.trim() || value.length > TOKEN_VALUE_MAX) {
      fail(`the value of ${name} must be a short CSS value string (at most ${TOKEN_VALUE_MAX} characters).`);
    }
    if (TOKEN_VALUE_FORBIDDEN.test(value)) {
      fail(`the value of ${name} may not carry urls, comments or declaration characters — a token is one value, never a vehicle.`);
    }
    if (name === '--ak-accent') {
      out[name] = validateAccentPair(value, look);
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Art direction for the imagery pipeline, as data: a prompt fragment and optional colour words.
 * Serves the layout's optional `imagery` field and the Design Book's `illustration` part kind —
 * one bench for both, like the tokens above.
 */
export function validateImageryStyle(raw: unknown): { style: string; palette_words?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('imagery is one object: { style, palette_words? } — art direction as data, no urls.');
  }
  const o = raw as Record<string, unknown>;
  const style = typeof o.style === 'string' ? o.style.trim() : '';
  if (!style || style.length > 400) {
    fail('imagery.style is the illustration prompt fragment: 1-400 characters of art direction, like "soft watercolour wash, grainy paper, no text".');
  }
  if (TOKEN_VALUE_FORBIDDEN.test(style)) {
    fail('imagery.style may not carry urls, comments or declaration characters — it is words for the image prompt, never a vehicle.');
  }
  const out: { style: string; palette_words?: string } = { style };
  if (o.palette_words !== undefined) {
    const pw = typeof o.palette_words === 'string' ? o.palette_words.trim() : '';
    if (!pw || pw.length > 200 || TOKEN_VALUE_FORBIDDEN.test(pw)) {
      fail('imagery.palette_words is a short line of colour words (at most 200 characters, no urls or declaration characters).');
    }
    out.palette_words = pw;
  }
  return out;
}

/** The dialog shapes a node can prove — enums, so a shape is data and never a stylesheet. */
export const DIALOG_TONES = ['plain', 'danger', 'celebrate', 'ai'] as const;
export const DIALOG_SIZES = ['compact', 'roomy', 'wide'] as const;
export const DIALOG_FROM = ['center', 'bottom'] as const;

/**
 * A dialog SHAPE: what kind of moment this arrangement is the inside of. Behaviour (when it
 * opens, what the buttons do) stays the app's; the shape is design data, which is what lets a
 * dialog travel through the Design Book like any other arrangement.
 */
export function validateDialogShape(raw: unknown): { title?: string; tone?: string; size?: string; from?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('dialog is one object: { title?, tone?, size?, from? } — the shape of the modal this arrangement stands inside.');
  }
  const o = raw as Record<string, unknown>;
  const out: { title?: string; tone?: string; size?: string; from?: string } = {};
  if (o.title !== undefined) {
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title || title.length > 120) fail('dialog.title is the modal\'s heading: 1-120 characters.');
    out.title = title;
  }
  const named: Array<[string, readonly string[]]> = [
    ['tone', DIALOG_TONES], ['size', DIALOG_SIZES], ['from', DIALOG_FROM],
  ];
  for (const [key, values] of named) {
    if (o[key] === undefined) continue;
    if (typeof o[key] !== 'string' || !values.includes(o[key] as string)) {
      unknownName('dialog ' + key, String(o[key]), [...values]);
    }
    out[key as 'tone' | 'size' | 'from'] = o[key] as string;
  }
  return out;
}

/** The signature colour: "#hex/#hex", light first, dark second. */
const ACCENT_PAIR_RE = /^(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*\/\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)$/;

/**
 * Prove a signature colour pair: each half runs the FULL contrast matrix as an `--ak-accent`
 * override and is judged against its own mode's combos — the sheet derives every other colour
 * (text tint, gradient, spectrum, focus) from the accent, so proving the accent proves them all.
 * A failing half refuses with the first measured numbers; the normalized "light/dark" survives.
 */
function validateAccentPair(value: string, look?: string): string {
  const m = ACCENT_PAIR_RE.exec(value.trim());
  if (!m) {
    fail('--ak-accent is a light/dark PAIR "#hex/#hex" — the light-mode value first, the dark-mode value second, like "#0e7c66/#e8564a". A single value cannot stay readable in both modes (measured), so both halves are required.');
  }
  const [light, dark] = [m[1]!.toLowerCase(), m[2]!.toLowerCase()];
  // The pair is proven WHERE IT LIVES: against the layout's own look (vivid when none is
  // named). Sweeping every registered look would let each new WORLD (paper, phosphor, night)
  // shrink the accent space of apps that never wear it.
  const presets = [look && look.length ? look : 'vivid'];
  for (const [half, mode] of [[light, 'light'], [dark, 'dark']] as const) {
    const bad = runMatrix({ '--ak-accent': half }, { presets })
      .filter((r) => !r.ok && r.combo.includes('/dark') === (mode === 'dark'));
    if (bad.length > 0) {
      const first = bad[0]!;
      fail(`the ${mode} half of --ak-accent (${half}) fails the contrast matrix: ${first.label} in ${first.combo} measures ${first.actual.toFixed(2)} against the ${first.min} floor (${first.why}); ${bad.length} check(s) fail in all. Pick a ${mode === 'dark' ? 'brighter mid-tone for dark surfaces' : 'deeper value for light surfaces'} and it will pass.`);
    }
  }
  return `${light}/${dark}`;
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
  if (input.choreography !== undefined) {
    if (typeof input.choreography !== 'string'
      || !(CHOREOGRAPHIES as readonly string[]).includes(input.choreography)) {
      unknownName('choreography', String(input.choreography), [...CHOREOGRAPHIES]);
    }
    out.choreography = input.choreography;
  }

  if (input.tokens !== undefined) {
    out.tokens = validateSignatureTokens(input.tokens, out.look);
    if (Object.keys(out.tokens).length === 0) delete out.tokens;
  }

  if (input.imagery !== undefined) {
    out.imagery = validateImageryStyle(input.imagery);
  }

  if (input.dialog !== undefined) {
    out.dialog = validateDialogShape(input.dialog);
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
