/**
 * @file src/services/app-ui/layouts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The layout presets — "leiskat" (TARGET-074): finished, fillable arrangements in
 *   the mosaic vocabulary, so a builder's FIRST MOVE is picking a shape rather than composing
 *   from nothing. A preset is DATA in the same grammar every stored layout uses: copy it,
 *   replace every <angle-bracketed> value with the app's own words and source names, store it
 *   with the same write every layout takes. No new mechanism — new vocabulary.
 *
 *   EVERY PRESET VALIDATES AS-IS: the placeholders are legal prop values, so a preset passes
 *   the dry-run validator before a single value is replaced, and the e2e proves that for each
 *   one — a preset that stopped validating would be teaching a shape the node refuses.
 *   A SHAPE IS COMPOSED, NOT STACKED. Every preset places its blocks on the composition grid with
 *   `span`, because a starting shape is judged on the screen it opens on, and a column of
 *   full-width cards leaves a desktop mostly empty. The measured criterion (audit/density.mjs,
 *   2026-09-05): at 1440x900 at most 55 % of the first screen may be bare page ground.
 * @structure UI_LAYOUT_PRESETS · presetById()
 * @usage
 *   import { UI_LAYOUT_PRESETS } from './layouts.js';
 * @version-history
 *   v1.1.0 — 2026-09-05 — THE FIRST SCREEN IS COMPOSED. Measured at 1440x900, four of the six
 *     shapes opened on a mostly bare desktop — guided-flow and work-queue at 84 % bare, dashboard
 *     64 %, browse 48 %, cover 40 % — because three of them projected ONE unit at a time (tabs,
 *     bottom-bar, flow) and the rest stacked full-width cards down a single column. Each first
 *     screen now uses the grid: spans place the blocks, the dashboard's panels stand on one wall,
 *     the work queue shows the queue with its history beside it, and the guided flow carries its
 *     path as a `steps` block instead of a "1 / 3" counter. The one-unit projections stay in the
 *     vocabulary and each fill line names the one this shape would take.
 *   v1.0.0 — 2026-08-27 — Initial: six presets, one per common app shape (TARGET-074, leiskat v1).
 */

export interface AppUiLayoutPreset {
  /** Stable id, the name a builder picks by. */
  id: string;
  /** One sentence: what kind of app this shape fits. */
  summary: string;
  /** What to do with it, in one line. */
  fill: string;
  /** The layout itself — valid as-is; every <angle-bracketed> value is meant to be replaced. */
  layout: {
    v: 1;
    look?: string;
    nav?: string;
    blocks: Array<{ id: string; component: string; span?: string; props?: Record<string, unknown> }>;
  };
}

export const UI_LAYOUT_PRESETS: readonly AppUiLayoutPreset[] = [
  {
    id: 'cover',
    summary: 'A front page: one focal band, the feature beside the main list, the rest as cards under them.',
    fill: 'Replace every <angle-bracketed> value with your words and your source names; keep the block ids and the spans.',
    layout: {
      v: 1,
      look: 'vivid',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>', sub: '<one line under it>' } },
        { id: 'feature', component: 'mediaCard', span: 'side', props: { title: '<the thing to highlight>', sub: '<why it matters>' } },
        { id: 'main', component: 'list', span: 'main', props: { source: '<your source name>', title: '<what the rows are>', emptyTitle: '<what the empty state says>' } },
        { id: 'more', component: 'cardGrid', span: 'full', props: { source: '<your highlights source>', title: '<what the cards are>', emptyTitle: '<what the empty state says>' } },
      ],
    },
  },
  {
    id: 'dashboard',
    summary: 'Numbers across the top, the detail panels on one wall under them — the operator shape.',
    fill: 'Replace every <angle-bracketed> value; add or drop panels freely, and set nav: "tabs" if you would rather they took turns.',
    layout: {
      v: 1,
      look: 'vivid',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>' } },
        { id: 'kpis', component: 'statRow', span: 'full', props: { source: '<your stats source>', title: '<Overview>' } },
        { id: 'rows', component: 'list', span: 'main', props: { source: '<your rows source>', title: '<what the rows are>' } },
        { id: 'hist', component: 'timeline', span: 'side', props: { source: '<your events source>', title: '<the history name>' } },
        { id: 'tbl', component: 'table', span: 'full', props: { source: '<your rows source>', title: '<the table name>', caption: '<what the table holds>' } },
      ],
    },
  },
  {
    id: 'browse',
    summary: 'Search over a grid of cards, the filters beside the results — the gallery and catalogue shape.',
    fill: 'Replace every <angle-bracketed> value; the search reports its query to the app under the bind name, and the facets report each pick.',
    layout: {
      v: 1,
      look: 'vivid',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>' } },
        { id: 'find', component: 'searchBar', span: 'full', props: { bind: '<what the query filters>' } },
        { id: 'filters', component: 'facets', span: 'side', props: { source: '<your facets source>', title: '<what the filters narrow>' } },
        { id: 'grid', component: 'cardGrid', span: 'main', props: { source: '<your items source>', title: '<what the cards are>', emptyTitle: '<what the empty state says>' } },
      ],
    },
  },
  {
    id: 'work-queue',
    summary: 'The queue itself, its counts over it and its history beside it — the doing shape.',
    fill: 'Replace every <angle-bracketed> value; on a phone the grid stacks on its own, and nav: "bottom-bar" gives the units a thumb bar instead.',
    layout: {
      v: 1,
      look: 'calm-card',
      blocks: [
        { id: 'kpis', component: 'statRow', span: 'full', props: { source: '<your stats source>', title: '<Today>' } },
        { id: 'queue', component: 'queue', span: 'main', props: { source: '<your queue source>', title: '<the queue name>', emptyTitle: '<what an empty queue says>' } },
        { id: 'hist', component: 'timeline', span: 'side', props: { source: '<your events source>', title: '<the history name>' } },
        { id: 'done', component: 'table', span: 'full', props: { source: '<your finished source>', title: '<what is finished>', caption: '<what the table holds>' } },
      ],
    },
  },
  {
    id: 'story-deck',
    summary: 'One idea per swipe — the presentation and briefing shape.',
    fill: 'Replace every <angle-bracketed> value; each unit is one card of the deck, in order.',
    layout: {
      v: 1,
      look: 'poster',
      nav: 'deck',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<the story’s name>' } },
        { id: 'lead', component: 'mediaCard', props: { title: '<the first idea>', sub: '<one line on it>' } },
        { id: 'proof', component: 'statRow', props: { source: '<your numbers source>', title: '<The numbers>' } },
        { id: 'trail', component: 'timeline', props: { source: '<your milestones source>', title: '<The road>' } },
      ],
    },
  },
  {
    id: 'guided-flow',
    summary: 'Step by step to a finish line, the path in sight the whole way — the onboarding and wizard shape.',
    fill: 'Replace every <angle-bracketed> value; the app moves the steps record\'s `current` as the person advances, and nav: "flow" turns the same blocks into one-step-at-a-time with a Previous and a Next.',
    layout: {
      v: 1,
      look: 'calm-card',
      blocks: [
        { id: 'path', component: 'steps', span: 'full', props: { source: '<your steps source>', title: '<what this takes>' } },
        { id: 'intro', component: 'section', span: 'full', props: { title: '<where this starts>', hint: '<what the person will have at the end>' } },
        { id: 'pick', component: 'list', span: 'main', props: { source: '<your choices source>', title: '<the choosing step>' } },
        { id: 'finish', component: 'section', span: 'side', props: { title: '<the finish line>', hint: '<what happens next>' } },
      ],
    },
  },
];

const byId = new Map(UI_LAYOUT_PRESETS.map((p) => [p.id, p]));

/** The preset, or undefined. */
export function presetById(id: string): AppUiLayoutPreset | undefined {
  return byId.get(id);
}
