/**
 * @file src/services/app-ui/registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier mosaic's component registry (TARGET-074) — the app-side sibling of
 *   the surface-layout block registry, built on the SAME typed prop grammar (BlockPropDef), so
 *   the two systems can never grow different validation rules for the same idea.
 *
 *   ONE DECLARATION, MANY SURFACES. Each entry below is DATA, and from it derive: the validator
 *   (validate.ts), the AI catalogue every read answers with (the get tool and GET
 *   /v1/apps/ui/catalogue carry it, so the first write is never a refusal), and — later — the
 *   gallery and the client renderer's contract. A component missing here does not exist, on any
 *   door.
 *
 *   MOSAIC DESCRIBES ARRANGEMENT AND CONFIGURATION, NEVER BEHAVIOUR. A block's `source` is a
 *   memory-key prefix the APP binds and resolves; handlers, formatting and data live in the
 *   app's own code and in the served kit. That boundary is what keeps a stored layout valid
 *   arithmetic instead of a program (the eval-free CSP settles this — see the target).
 *
 *   APPEND-ONLY FROM THE FIRST STORED LAYOUT (decided 2026-08-27): a component's props may only
 *   gain entries; a breaking change is a NEW component id. Stored layouts outlive every runtime
 *   version.
 * @structure AppUiPropDef / AppUiComponentDef · NAV_MODES · LOOKS · UI_COMPONENTS ·
 *   componentById() · buildUiCatalogue()
 * @usage
 *   import { UI_COMPONENTS, componentById, buildUiCatalogue } from './registry.js';
 * @version-history
 *   v1.5.0 — 2026-08-28 — COLOUR OPENS AS A PAIR (append-only): `--ak-accent` joins the signature
 *     as "light/dark" — measurement proved no single hex survives both modes, so the validator
 *     runs the contrast matrix per mode against each half before accepting (TARGET-074).
 *   v1.4.0 — 2026-08-28 — SIGNATURE arrives (append-only): the bounded `--ak-*` token subset a
 *     layout may override (shape, typography, density, motion — deliberately no colour until the
 *     contrast bench can prove an override), listed in the catalogue as signature_tokens.
 *   v1.3.0 — 2026-08-27 — COMPOSITION arrives (append-only): per-block `span` (full/main/side/
 *     half) turns the stack into a composed page, and `rail` joins the nav modes — the
 *     desktop-grade left rail. The developer's award-site references made the gap plain: the
 *     missing axis was layout, not colour.
 *   v1.2.0 — 2026-08-27 — The catalogue carries the layout presets (layouts.ts): a first layout
 *     starts from a finished shape, not from nothing (TARGET-074, leiskat v1).
 *   v1.1.0 — 2026-08-27 — Append-only: every unit-forming component gains an optional `title` —
 *     the block's name in tabs, decks and canvas tiles. The first real-browser run showed
 *     component ids leaking into tab labels because most blocks had no prop to name them with.
 *   v1.0.0 — 2026-08-27 — Initial: eleven mosaic components mirroring the served kit
 *     (TARGET-074 phase 2).
 */
import type { BlockPropDef } from '../surface-layout/registry-types.js';
import { LOOKS as LOOK_REGISTRY, STRUCTURES } from '../../data/atelier-looks.js';
import { UI_LAYOUT_PRESETS, type AppUiLayoutPreset } from './layouts.js';

/** A mosaic prop: the shared grammar, plus whether a layout must supply it. */
export type AppUiPropDef = BlockPropDef & {
  /** The validator refuses a block that omits this prop. Most props default instead. */
  required?: true;
};

export interface AppUiComponentDef {
  /** Stable id — the kit's own component name (AIMEAT.atelier.<id>). */
  id: string;
  /** One sentence for the catalogue and the picker. */
  summary: string;
  /** The declared settings. Append-only once a layout is stored. */
  props: Record<string, AppUiPropDef>;
  /** At most this many instances per layout (the hero rule: one focal point). */
  maxPerLayout?: number;
}

/** Every navigation projection a layout may ask for — all supported on every screen size
 *  (decided 2026-08-27); the renderer carries each mode's own ergonomics. `rail` is the
 *  desktop-grade left rail that folds to a strip on a narrow screen; `overlay` is the
 *  award-site move — one Menu control opening a full-screen list in display type (both
 *  append-only additions, 2026-08-27). */
export const NAV_MODES = ['tabs', 'bottom-bar', 'canvas', 'deck', 'flow', 'rail', 'overlay'] as const;

/** How much of the composition grid one block takes. The default is the full line; the other
 *  values are what turn a stack of cards into a COMPOSED PAGE — an asymmetric editorial split
 *  is two blocks, `main` beside `side`. */
export const BLOCK_SPANS = ['full', 'main', 'side', 'half'] as const;

/** The look presets the stylesheet ships — DERIVED from the look registry
 *  (src/data/atelier-looks.ts), the same source the generated stylesheet and the build prompt
 *  read, so the three can never disagree. check:atelier verifies every one arithmetically. */
export const LOOKS: readonly string[] = LOOK_REGISTRY.map((l) => l.id);

const text = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description });
const requiredText = (description: string, maxLength = 200): AppUiPropDef => ({ type: 'string', maxLength, description, required: true });
/** A memory-key prefix the app binds this block to; the app resolves it to rows. */
const source = (): AppUiPropDef => ({
  type: 'string', maxLength: 120, required: true,
  description: 'The data binding: a memory-key prefix the app resolves to this block\'s rows.',
});

export const UI_COMPONENTS: readonly AppUiComponentDef[] = [
  {
    id: 'hero',
    summary: 'The one focal band a screen gets — gradient-mesh ground with no image, a mode-surviving scrim over one.',
    props: {
      title: requiredText('The headline.', 120),
      sub: text('The line under it.'),
      image: text('A storage URL painted under the scrim. Never a data: URI.', 500),
    },
    maxPerLayout: 1,
  },
  {
    id: 'statRow',
    summary: 'The KPI strip; figures count up when the bound data changes.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'figure',
    summary: 'The data IS the hero: ONE giant display numeral with its label and a context line, counting up on change. The source resolves to { value, label, sub?, delta? }.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'list',
    summary: 'Keyed rows with live-change motion; empty renders the designed empty state.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'cardGrid',
    summary: 'The browsing grid; imageless cards keep their deterministic monogram washes.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'table',
    summary: 'Real table semantics that scroll inside their own box.',
    props: {
      source: source(),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
      caption: text('The screen-reader caption.', 120),
    },
  },
  {
    id: 'searchBar',
    summary: 'Debounced search that reports the query to the app.',
    props: {
      bind: text('What the app filters with this query (its own name for it).', 80),
      title: text('The block\'s name in tabs, decks and canvas tiles.', 80),
    },
  },
  {
    id: 'tabs',
    summary: 'A tab row; the app swaps views on the pick.',
    props: {
      items: { type: 'string[]', maxItems: 8, required: true, description: 'The tab labels, in order.' },
    },
  },
  {
    id: 'section',
    summary: 'The titled card — and the escape hatch whose body the app fills itself.',
    props: { title: text('The section title.', 80), hint: text('The line under it.', 160) },
  },
  {
    id: 'emptyState',
    summary: 'The designed empty/error/notice card.',
    props: {
      title: requiredText('What it says.', 80),
      hint: text('The line under it.', 160),
      tone: { type: 'enum', values: ['quiet', 'error', 'celebrate'], default: 'quiet', description: 'How it reads.' },
    },
  },
  {
    id: 'timeline',
    summary: 'Events on the vertical line every history shares.',
    props: { source: source(), title: text('The block\'s name in tabs, decks and canvas tiles.', 80) },
  },
  {
    id: 'mediaCard',
    summary: 'One feature card on its own.',
    props: {
      title: requiredText('The card title.', 80),
      sub: text('The line under it.', 160),
      image: text('A storage URL. Never a data: URI.', 500),
    },
  },
  {
    id: 'aide',
    summary: 'The in-app AI: a chat panel whose tools are the app\'s OWN declared sources and actions — it reads what the screen reads and proposes what the buttons do, a person confirms every run. Runs on the owner\'s AI key; shows the platform AI notice and per-message provenance labels itself.',
    maxPerLayout: 1,
    props: {
      title: text('The app name the aide speaks as.', 80),
      intro: text('The opening line the panel greets with.', 200),
    },
  },
];

/**
 * The SIGNATURE TOKENS: the bounded `--ak-*` subset a layout may override to give one app its own
 * hand — colour, shape, typography, density and motion. COLOUR IS ONE TOKEN AND IT IS A PAIR:
 * measurement proved no single hex survives every palette in both modes (the house coral fails 32
 * light-mode checks and passes dark completely), so `--ak-accent` takes "light/dark" and the
 * validator runs the full contrast matrix per mode before accepting it — colour ships proven, not
 * on trust. Growing this list is append-only, and every other entry stays provable-safe by
 * construction (a radius cannot break contrast).
 */
export const SIGNATURE_TOKENS: Record<string, string> = {
  '--ak-accent': 'The signature colour, as a LIGHT/DARK PAIR "#hex/#hex" — the light-mode value first, the dark-mode value second, e.g. "#0e7c66/#e8564a". Both values run the full contrast matrix at validation, each against its own mode, and a pair that breaks readability anywhere refuses with the numbers. Every accent derivation (text tint, gradient, spectrum, focus ring) follows the pair.',
  '--ak-radius': 'Corner rounding of cards and surfaces, e.g. "2px" for a sharp hand, "18px" for a soft one.',
  '--ak-radius-sm': 'Corner rounding of rows and inputs.',
  '--ak-radius-pill': 'Rounding of pills and chips.',
  '--ak-gap': 'The grid gap between blocks.',
  '--ak-pad': 'The base padding inside surfaces.',
  '--ak-main-max': 'The content column width, e.g. "56rem" for a tight editorial measure.',
  '--ak-font': 'The body face (a stack; the platform webfonts are already loaded).',
  '--ak-font-display': 'The display face for titles and figures.',
  '--ak-weight-display': 'The display weight, e.g. "900" for a heavy masthead.',
  '--ak-text-hero': 'The hero title size, e.g. "clamp(2.2rem, 7vw, 4.4rem)".',
  '--ak-tilt': 'The playful tilt of cards and tiles, e.g. "1.2deg". "0deg" is calm.',
  '--ak-motion': 'The base transition duration, e.g. "120ms" for a snappy hand.',
  '--ak-enter-distance': 'How far content travels on entry, e.g. "0px" turns reveals off.',
  '--ak-blur': 'The glass blur of the chrome, e.g. "0px" for solid chrome.',
};

const byId = new Map(UI_COMPONENTS.map((c) => [c.id, c]));

/** The component, or undefined — the validator words the refusal. */
export function componentById(id: string): AppUiComponentDef | undefined {
  return byId.get(id);
}

/**
 * The catalogue every read answers with: ids, summaries and full prop schemas, the nav modes
 * and looks, and the LAYOUT PRESETS — the whole vocabulary in one payload, so an AI asked to
 * change a layout never has to guess at names, and one asked to write a first layout starts
 * from a finished shape rather than from nothing.
 */
export function buildUiCatalogue(): {
  components: Array<{ id: string; summary: string; props: Record<string, AppUiPropDef>; max_per_layout?: number }>;
  nav_modes: readonly string[];
  looks: readonly string[];
  spans: { values: readonly string[]; summary: string };
  look_sheets: Array<{ id: string; feel: string; structures: string[] }>;
  structures: Array<{ id: string; summary: string }>;
  layouts: readonly AppUiLayoutPreset[];
  signature_tokens: { values: Record<string, string>; summary: string };
  imagery: { summary: string };
} {
  return {
    components: UI_COMPONENTS.map((c) => ({
      id: c.id,
      summary: c.summary,
      props: c.props,
      ...(c.maxPerLayout !== undefined ? { max_per_layout: c.maxPerLayout } : {}),
    })),
    nav_modes: NAV_MODES,
    looks: LOOKS,
    spans: {
      values: BLOCK_SPANS,
      summary: 'Optional per-block `span`: how much of the composition grid the block takes. '
        + '`full` (the default) is the whole line; `main` + `side` side by side make the '
        + 'asymmetric editorial split; two `half` blocks share a line. Narrow screens stack '
        + 'everything, so a span is layout ambition, never a mobile risk.',
    },
    // The look data sheets: what each look feels like and which page structures it carries —
    // enough for an AI to pick by intent instead of by trying them all.
    look_sheets: LOOK_REGISTRY.map((l) => ({ id: l.id, feel: l.feel, structures: l.structures })),
    structures: STRUCTURES.map((s) => ({ id: s.id, summary: s.summary })),
    layouts: UI_LAYOUT_PRESETS,
    signature_tokens: {
      values: SIGNATURE_TOKENS,
      summary: 'Optional top-level `tokens`: the app\'s SIGNATURE — bounded overrides of colour, '
        + 'shape, typography, density and motion, applied on top of the look. Only the names '
        + 'listed here are legal. The one colour door is --ak-accent as a light/dark pair '
        + '"#hex/#hex", proven by the full contrast matrix at validation — every other colour '
        + 'derives from it. The design pass: propose two or three token-sets as whole layouts, '
        + 'dry-run each, show the owner, store the one they pick.',
    },
    imagery: {
      summary: 'Optional top-level `imagery`: art direction for the imagery pipeline as data — '
        + '{ style: "the illustration prompt fragment", palette_words?: "colour words" }. '
        + 'Builders and the Design Book\'s illustration parts write it; image generation reads it.',
    },
  };
}
