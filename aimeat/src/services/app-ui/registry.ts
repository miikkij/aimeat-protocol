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
 *   v1.0.0 — 2026-08-27 — Initial: eleven mosaic components mirroring the served kit
 *     (TARGET-074 phase 2).
 */
import type { BlockPropDef } from '../surface-layout/registry-types.js';

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
 *  (decided 2026-08-27); the renderer carries each mode's own ergonomics. */
export const NAV_MODES = ['tabs', 'bottom-bar', 'canvas', 'deck', 'flow'] as const;

/** The look presets the stylesheet ships — check:atelier verifies every one arithmetically. */
export const LOOKS = ['vivid', 'calm-card', 'editorial', 'sticker', 'neon-dense', 'poster', 'flat'] as const;

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
    props: { source: source() },
  },
  {
    id: 'list',
    summary: 'Keyed rows with live-change motion; empty renders the designed empty state.',
    props: {
      source: source(),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'cardGrid',
    summary: 'The browsing grid; imageless cards keep their deterministic monogram washes.',
    props: {
      source: source(),
      emptyTitle: text('What the empty state says.', 80),
      emptyHint: text('The line under it.', 160),
    },
  },
  {
    id: 'table',
    summary: 'Real table semantics that scroll inside their own box.',
    props: { source: source(), caption: text('The screen-reader caption.', 120) },
  },
  {
    id: 'searchBar',
    summary: 'Debounced search that reports the query to the app.',
    props: { bind: text('What the app filters with this query (its own name for it).', 80) },
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
    props: { source: source() },
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
];

const byId = new Map(UI_COMPONENTS.map((c) => [c.id, c]));

/** The component, or undefined — the validator words the refusal. */
export function componentById(id: string): AppUiComponentDef | undefined {
  return byId.get(id);
}

/**
 * The catalogue every read answers with: ids, summaries and full prop schemas, plus the nav
 * modes and looks — the whole vocabulary in one payload, so an AI asked to change a layout
 * never has to guess at names.
 */
export function buildUiCatalogue(): {
  components: Array<{ id: string; summary: string; props: Record<string, AppUiPropDef>; max_per_layout?: number }>;
  nav_modes: readonly string[];
  looks: readonly string[];
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
  };
}
