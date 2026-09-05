/**
 * @file src/services/app-ui/catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mosaic CATALOGUE every read answers with — ids, summaries and full prop
 *   schemas, the nav modes, the looks and their data sheets, the structures, the layout presets,
 *   the signature tokens, the dialog shapes, the imagery field, the pattern shelf and the ambient
 *   shelf: the whole vocabulary in one payload, so an AI asked to change a layout never has to
 *   guess at names, and one asked to write a first layout starts from a finished shape rather
 *   than from nothing. A pure extraction of buildUiCatalogue() from registry.ts on 2026-09-05
 *   (the registry stood at 798 lines against the 800 cap, and the effects round adds a shelf).
 *   The registry stays the single declaration and this file only reads it, so the dependency
 *   runs one way; the two doors (GET /v1/apps/ui/catalogue and the aimeat_app_ui_get tool)
 *   import from here.
 * @structure buildUiCatalogue()
 * @usage
 *   import { buildUiCatalogue } from './catalogue.js';
 * @version-history
 *   v1.1.0 — 2026-09-05 — THE EFFECTS SHELF (wish-atelier-post-process-effects, stage 4): the
 *     nine effects with their knobs' bounds, the hosts a prop or zone effect may land on, the
 *     post passes, and a summary teaching still, moment and living; the ambient summary names
 *     `post`. The three generators reach the ambient shelf on their own.
 *   v1.0.0 — 2026-09-05 — Pure extraction from registry.ts v1.20.0
 *     (wish-atelier-post-process-effects, stage 1).
 */
import { LOOKS as LOOK_REGISTRY, STRUCTURES } from '../../data/atelier-looks.js';
import { UI_LAYOUT_PRESETS, type AppUiLayoutPreset } from './layouts.js';
import { PATTERNS } from '../../data/atelier-patterns.js';
import { AMBIENTS } from '../../data/atelier-ambients.js';
import { EFFECTS, EFFECT_HOSTS, POST_IDS, POST_MAX, type AtelierEffectParam } from '../../data/atelier-effects.js';
import { UI_COMPONENTS, NAV_MODES, CHOREOGRAPHIES, LOOKS, BLOCK_SPANS, type AppUiPropDef } from './registry.js';
import { SIGNATURE_TOKENS } from './signature-tokens.js';

/**
 * The catalogue every read answers with: ids, summaries and full prop schemas, the nav modes
 * and looks, and the LAYOUT PRESETS — the whole vocabulary in one payload, so an AI asked to
 * change a layout never has to guess at names, and one asked to write a first layout starts
 * from a finished shape rather than from nothing.
 */
export function buildUiCatalogue(): {
  components: Array<{ id: string; summary: string; props: Record<string, AppUiPropDef>; max_per_layout?: number }>;
  nav_modes: readonly string[];
  choreographies: { values: readonly string[]; summary: string };
  looks: readonly string[];
  spans: { values: readonly string[]; summary: string };
  look_sheets: Array<{ id: string; feel: string; structures: string[]; ambient: string }>;
  structures: Array<{ id: string; summary: string }>;
  layouts: readonly AppUiLayoutPreset[];
  signature_tokens: { values: Record<string, string>; summary: string };
  dialog: { tones: string[]; sizes: string[]; from: string[]; summary: string };
  imagery: { summary: string };
  patterns: {
    summary: string;
    recipes: Array<{
      id: string;
      looks_like: string;
      evokes: string;
      use: { ground?: string; prop?: string; zone?: string };
      default_size: string;
    }>;
  };
  ambients: {
    summary: string;
    presets: Array<{
      id: string; feel: string; evokes: string; technique: string; proof: string;
      fits_looks: string[]; default_alpha: number; default_speed: number; peak: number;
    }>;
  };
  effects: {
    summary: string;
    hosts: readonly string[];
    post: readonly string[];
    entries: Array<{
      id: string; feel: string; evokes: string; engine: string; volume: readonly string[];
      motion: readonly string[]; backdrop: boolean; post: boolean; proof: string;
      params: readonly AtelierEffectParam[]; fits_looks: readonly string[];
    }>;
  };
} {
  return {
    components: UI_COMPONENTS.map((c) => ({
      id: c.id,
      summary: c.summary,
      props: c.props,
      ...(c.maxPerLayout !== undefined ? { max_per_layout: c.maxPerLayout } : {}),
    })),
    nav_modes: NAV_MODES,
    choreographies: {
      values: CHOREOGRAPHIES,
      summary: 'How the page moves under the reader\'s hand. still: nothing scroll-driven. cinema: the opening band recedes and each section rises as it enters the view — right for fronts, stories and reports; wrong for a tool someone lives in.',
    },
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
    look_sheets: LOOK_REGISTRY.map((l) => ({
      id: l.id, feel: l.feel, structures: l.structures,
      // The layer this look runs at idle, from its own token — the one place the answer lives.
      ambient: l.tokens['--ak-ambient'] ?? 'none',
    })),
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
    dialog: {
      tones: ['plain', 'danger', 'celebrate', 'ai'],
      sizes: ['compact', 'roomy', 'wide'],
      from: ['center', 'bottom'],
      summary: 'Optional top-level `dialog`: this arrangement is the INSIDE OF A MODAL rather '
        + 'than a screen — { title?, tone?, size?, from? }. The tone says what kind of moment it '
        + 'is before a word is read (plain, danger, celebrate, ai), the size how much room it '
        + 'takes, and from whether it arrives centred or up from the bottom edge for a phone. '
        + 'Open it with AIMEAT.atelier.dialog({ layout, sources, ...the shape }); the buttons and '
        + 'when it opens stay your app\'s. A dialog SHAPE travels through the Design Book like '
        + 'any other arrangement.',
    },
    imagery: {
      summary: 'Optional top-level `imagery`: art direction for the imagery pipeline as data — '
        + '{ style: "the illustration prompt fragment", palette_words?: "colour words" }. '
        + 'Builders and the Design Book\'s illustration parts write it; image generation reads it.',
    },
    patterns: {
      summary: 'The pattern shelf (patterns.css): gradient-built background recipes on the '
        + '--ak-* tokens, technique after Temani Afif\'s CSS-Pattern (MIT). Class is '
        + '.ak-pat-<id> plus ONE volume: .ak-pat--ground (a whole page stands on it, body text '
        + 'proven readable), .ak-pat--prop (one object\'s texture — a chip, an edge, an empty '
        + 'state), .ak-pat--zone (full ink, ONE banner or divider per screen, words only inside '
        + 'solid chips; -2/-3 take the spectrum colours, -ink goes monochrome). Tile size: '
        + '--ak-pat-size on the element. Both text-bearing volumes are proven by the contrast '
        + 'matrix (AK-PAT) in every look × palette × mode.',
      recipes: PATTERNS.map((p) => ({
        id: p.id,
        looks_like: p.looksLike,
        evokes: p.evokes,
        use: p.use,
        default_size: p.defaultSize,
      })),
    },
    ambients: {
      summary: 'The ambient shelf: the one layer allowed to move at idle, behind the app. '
        + 'THE LOOK DECIDES — each look sheet says which preset it runs (`ambient`, or none), '
        + 'and an arrangement overrides with an optional top-level `ambient`: { preset, alpha?, '
        + 'speed? }, or { preset: "none" } to switch the look\'s own off. A field preset (it lays '
        + 'pigment under the words) is proven by the contrast matrix at peak × alpha: on a look '
        + 'that stands on the palette\'s own page it may run only at the whisper (alpha at or '
        + 'below the preset\'s default), while a world that owns its ground (lounge, dawn, stage, '
        + 'broadcast) runs it as loud as the ink allows. The layer pauses on a hidden tab, stills '
        + 'under Less motion and reduced motion, and the viewer\'s weather switch (Off, Calm, '
        + 'Full) always wins. One per app; a tool someone lives in usually wants none. '
        + `Optional \`post\`: up to ${POST_MAX} passes run over the layer's own field each frame `
        + `(${POST_IDS.join(', ')}), as ids or { id, params } — the one place an effect may live.`,
      presets: AMBIENTS.map((a) => ({
        id: a.id,
        feel: a.feel,
        evokes: a.evokes,
        technique: a.technique,
        proof: a.proof,
        fits_looks: a.fitsLooks,
        default_alpha: a.defaultAlpha,
        default_speed: a.defaultSpeed,
        peak: a.peak,
      })),
    },
    effects: {
      summary: 'The effects shelf (effects.css, effects.js): post-process filters a block wears, '
        + 'declared once with every knob\'s bounds and default. Per block: `effect: { id, params?, '
        + 'backdrop? }`. STILL on the words (scanlines, vignette, recolour) or on a picture '
        + '(duotone, distort); a MOMENT the app plays on a cue with AIMEAT.atelier.fxPlay (glitch, '
        + 'vhs, distort, ripple), finite and gone on finished; LIVING only behind the words — '
        + '`ambient.post` runs it over the layer\'s own field (glitch, vhs, ripple, kaleidoscope). '
        + 'A prop or zone effect lands only on a picture or a band (`hosts`; on a hero, on its '
        + 'image); on any other component it would bend or recolour the words and is refused. A '
        + 'colour or overlay effect under words is proven by the contrast matrix on the look '
        + '(AK-FX): a quarter of ink passes every look, any hue at saturate 1.5 or under passes '
        + 'every look, louder on the six worlds only. `backdrop: true` (recolour alone) '
        + 'post-processes what is BEHIND the block, the ambient seen through a card. Under Less '
        + 'motion a moment does not play and a still stays; the viewer\'s weather is the layer\'s.',
      hosts: EFFECT_HOSTS,
      post: POST_IDS,
      entries: EFFECTS.map((e) => ({
        id: e.id,
        feel: e.feel,
        evokes: e.evokes,
        engine: e.engine,
        volume: e.volume,
        motion: e.motion,
        backdrop: e.backdrop,
        post: e.post,
        proof: e.proof,
        params: e.params,
        fits_looks: e.fitsLooks,
      })),
    },
  };
}
