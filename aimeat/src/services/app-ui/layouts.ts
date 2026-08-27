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
 * @structure UI_LAYOUT_PRESETS · presetById()
 * @usage
 *   import { UI_LAYOUT_PRESETS } from './layouts.js';
 * @version-history
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
    blocks: Array<{ id: string; component: string; props?: Record<string, unknown> }>;
  };
}

export const UI_LAYOUT_PRESETS: readonly AppUiLayoutPreset[] = [
  {
    id: 'cover',
    summary: 'A front page: one focal band, one feature, the main list under them.',
    fill: 'Replace every <angle-bracketed> value with your words and your source names; keep the block ids.',
    layout: {
      v: 1,
      look: 'vivid',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>', sub: '<one line under it>' } },
        { id: 'feature', component: 'mediaCard', props: { title: '<the thing to highlight>', sub: '<why it matters>' } },
        { id: 'main', component: 'list', props: { source: '<your source name>', title: '<what the rows are>', emptyTitle: '<what the empty state says>' } },
      ],
    },
  },
  {
    id: 'dashboard',
    summary: 'Numbers first, then the detail views as tabs — the operator shape.',
    fill: 'Replace every <angle-bracketed> value; add or drop tab units freely, the nav projects whatever is there.',
    layout: {
      v: 1,
      look: 'vivid',
      nav: 'tabs',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>' } },
        { id: 'kpis', component: 'statRow', props: { source: '<your stats source>', title: '<Overview>' } },
        { id: 'rows', component: 'list', props: { source: '<your rows source>', title: '<the rows tab name>' } },
        { id: 'tbl', component: 'table', props: { source: '<your rows source>', title: '<the table tab name>', caption: '<what the table holds>' } },
        { id: 'hist', component: 'timeline', props: { source: '<your events source>', title: '<the history tab name>' } },
      ],
    },
  },
  {
    id: 'browse',
    summary: 'Search over a grid of cards — the gallery and catalogue shape.',
    fill: 'Replace every <angle-bracketed> value; the search reports its query to the app under the bind name.',
    layout: {
      v: 1,
      look: 'vivid',
      blocks: [
        { id: 'top', component: 'hero', props: { title: '<what this app is>' } },
        { id: 'find', component: 'searchBar', props: { bind: '<what the query filters>' } },
        { id: 'grid', component: 'cardGrid', props: { source: '<your items source>', title: '<what the cards are>', emptyTitle: '<what the empty state says>' } },
      ],
    },
  },
  {
    id: 'work-queue',
    summary: 'The queue and its history, one thumb away — the mobile-first doing shape.',
    fill: 'Replace every <angle-bracketed> value; the bottom bar carries the two units on every screen size.',
    layout: {
      v: 1,
      look: 'calm-card',
      nav: 'bottom-bar',
      blocks: [
        { id: 'kpis', component: 'statRow', props: { source: '<your stats source>', title: '<Today>' } },
        { id: 'queue', component: 'list', props: { source: '<your queue source>', title: '<the queue name>', emptyTitle: '<what an empty queue says>' } },
        { id: 'hist', component: 'timeline', props: { source: '<your events source>', title: '<the history name>' } },
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
    summary: 'Step by step to a finish line — the onboarding and wizard shape.',
    fill: 'Replace every <angle-bracketed> value; fill the section bodies from the app (spec.fill by block id).',
    layout: {
      v: 1,
      look: 'calm-card',
      nav: 'flow',
      blocks: [
        { id: 'intro', component: 'section', props: { title: '<where this starts>', hint: '<what the person will have at the end>' } },
        { id: 'pick', component: 'list', props: { source: '<your choices source>', title: '<the choosing step>' } },
        { id: 'finish', component: 'section', props: { title: '<the finish line>', hint: '<what happens next>' } },
      ],
    },
  },
];

const byId = new Map(UI_LAYOUT_PRESETS.map((p) => [p.id, p]));

/** The preset, or undefined. */
export function presetById(id: string): AppUiLayoutPreset | undefined {
  return byId.get(id);
}
