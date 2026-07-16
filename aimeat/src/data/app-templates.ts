/**
 * @file app-templates.ts
 * @description Authoring-template registry — the "booster kit" data. Curated starting points
 *   the app-prompt builders (app-catalog + landing) inject so the AI copies from a model instead
 *   of building from scratch. Templates are DATA: adding one is a new entry here (+ its content),
 *   no code change. Served as JSON at GET /v1/app-templates and consumed by both prompt surfaces.
 *
 *   kinds (layered — see docs/internal/authoring-templates/):
 *     - app-shell  : a full app skeleton (boot + auth + layout + theme). Tiers T1/T2/T3.
 *     - component  : a reusable block + its lib deps (future).
 *     - use-case   : composes an app-shell + components (+ optional package) (future).
 * @structure AppTemplate · getAppTemplates() · getAppTemplateIndex()
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial registry + first app-shell (T1 pure-client).
 *   v1.1.0 — 2026-06-26 — app-shells T2 (cortex) + T3 (extension).
 *   v1.2.0 — 2026-06-26 — component library (auth-gated, private-store, shared-feed, ai-action, data-table, settings, dated-archive).
 *   v1.3.0 — 2026-06-26 — components: image-upload, realtime-room, search, list+detail (for marketplace / realtime-social / homepage use-cases).
 *   v1.4.0 — 2026-06-26 — use-case templates (full working scaffolds) + composes field; first: realtime-social.
 *   v1.5.0 — 2026-06-26 — use-case: marketplace (anon browse + search + detail + post with image); fix image-upload URL.
 *   v1.6.0 — 2026-06-26 — component: markdown (AIMEAT.md.render); use-case: homepage (personal site — profile + markdown blog + images + AI stories).
 *   v1.7.0 — 2026-06-26 — plain-language app-shell titles (drop T1/T2/T3 jargon): "Standard app",
 *     "Data app", "Connected app" — what a non-technical user gets, not the architecture.
 *   v1.8.0 — 2026-07-13 — template bodies extracted to ./app-templates/{shells,components,use-cases}.ts (max-file-lines).
 *   v1.9.0 — 2026-07-16 — packs?: string[] field (library-pack deps, Library Acceleration
 *     Program); components: mermaid-diagram + three-scene (demos for the mermaid/three packs).
 *   v1.10.0 — 2026-07-16 — component: public-intake (aimeat-intake) — the anonymous-submission path
 *     (lead/contact/feedback/RSVP/quiz forms) so AI app-builders discover the Public Intake capability.
 */

import { SHELL_PURE_CLIENT, SHELL_CORTEX, SHELL_EXTENSION } from './app-templates/shells.js';
import {
  COMP_AUTH_GATED,
  COMP_PRIVATE_STORE,
  COMP_SHARED_FEED,
  COMP_PUBLIC_INTAKE,
  COMP_AI_ACTION,
  COMP_DATA_TABLE,
  COMP_SETTINGS,
  COMP_DATED_ARCHIVE,
  COMP_IMAGE_UPLOAD,
  COMP_REALTIME_ROOM,
  COMP_SEARCH,
  COMP_LIST_DETAIL,
  COMP_MARKDOWN,
  COMP_MERMAID_DIAGRAM,
  COMP_THREE_SCENE,
  COMP_P5_SKETCH,
  COMP_PIXI_STAGE,
  COMP_PHASER_ARCADE,
  COMP_FLOW_EDITOR,
} from './app-templates/components.js';
import { USECASE_REALTIME_SOCIAL, USECASE_MARKETPLACE, USECASE_HOMEPAGE } from './app-templates/use-cases.js';

export interface AppTemplate {
  /** Stable id, e.g. "shell-pure-client". */
  id: string;
  kind: 'app-shell' | 'component' | 'use-case';
  /** Capability tier for app-shells: T1 pure client · T2 +cortex · T3 +extension. */
  tier?: 'T1' | 'T2' | 'T3';
  title: string;
  /** One line shown in the picker and in the prompt index. */
  description: string;
  /** Client libs the template loads (for the AI's awareness). */
  libs: string[];
  /** Library-pack ids the template demonstrates/depends on (see src/data/library-packs.ts). */
  packs?: string[];
  /** For use-cases: the component/shell ids this scaffold builds on (for the index + matching). */
  composes?: string[];
  /** The model the AI copies from — a skeleton, not a finished app. */
  content: string;
}

const TEMPLATES: AppTemplate[] = [
  {
    id: 'shell-pure-client',
    kind: 'app-shell',
    tier: 'T1',
    title: 'Standard app — login + saves your data',
    description: 'Single-file HTML app: login + private/shared memory, self-hosted Tailwind + daisyUI, light/dark theme. The 80% case — notes, trackers, boards, dashboards.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_PURE_CLIENT,
  },
  {
    id: 'shell-cortex',
    kind: 'app-shell',
    tier: 'T2',
    title: 'Data app — built-in tables, forms & charts',
    description: 'Standard app plus the bundled cortex UI libraries (DataTable, forms, layouts, charts) for richer structured UIs without hand-rolling components.',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-ui-viewers', 'aimeat-ui-forms'],
    content: SHELL_CORTEX,
  },
  {
    id: 'shell-extension',
    kind: 'app-shell',
    tier: 'T3',
    title: 'Connected app — fetches outside data / runs on a schedule (advanced)',
    description: 'For apps needing server-side work (external API fetch, scheduled jobs): the client calls a sandboxed extension. Build the extension separately or ship it in a package.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_EXTENSION,
  },
  { id: 'comp-auth-gated', kind: 'component', title: 'Auth-gated section', description: 'Show/hide a section based on login state.', libs: ['aimeat-auth'], content: COMP_AUTH_GATED },
  { id: 'comp-private-store', kind: 'component', title: 'Private store', description: 'Save / list / remove a per-owner private collection.', libs: ['aimeat-data'], content: COMP_PRIVATE_STORE },
  { id: 'comp-shared-feed', kind: 'component', title: 'Shared feed', description: 'A public community feed — each user writes their own key, everyone reads.', libs: ['aimeat-data'], content: COMP_SHARED_FEED },
  { id: 'comp-public-intake', kind: 'component', title: 'Public form (anonymous submissions)', description: 'Let not-logged-in visitors submit a lead / contact / feedback / RSVP / quiz form into your workspace — the owner defines the form once, anyone submits with no account. The ONLY anonymous-write path.', libs: ['aimeat-intake'], content: COMP_PUBLIC_INTAKE },
  { id: 'comp-ai-action', kind: 'component', title: 'AI action button', description: "Run the user's own LLM on demand, render into an editable field.", libs: ['aimeat-auth', 'aimeat-ai'], content: COMP_AI_ACTION },
  { id: 'comp-data-table', kind: 'component', title: 'Data table', description: 'Sortable / filterable / paginated table via the viewers cortex.', libs: ['aimeat-ui-viewers'], content: COMP_DATA_TABLE },
  { id: 'comp-settings', kind: 'component', title: 'Settings panel', description: "Read / write the app's settings from memory.", libs: ['aimeat-data'], content: COMP_SETTINGS },
  { id: 'comp-dated-archive', kind: 'component', title: 'Dated archive', description: 'Group entries by date and render newest-first (news/journal).', libs: ['aimeat-data'], content: COMP_DATED_ARCHIVE },
  { id: 'comp-image-upload', kind: 'component', title: 'Image upload', description: 'Upload an image to storage and get a shareable public URL (marketplace listings, avatars).', libs: ['aimeat-auth', 'aimeat-storage'], content: COMP_IMAGE_UPLOAD },
  { id: 'comp-realtime-room', kind: 'component', title: 'Realtime room', description: 'Live presence + messages over a shared room — multiplayer games, chat, presence boards.', libs: ['aimeat-auth'], content: COMP_REALTIME_ROOM },
  { id: 'comp-search', kind: 'component', title: 'Search / filter', description: 'Instant client-side filter over a list, or server-side memory search.', libs: ['aimeat-data'], content: COMP_SEARCH },
  { id: 'comp-list-detail', kind: 'component', title: 'List + detail', description: 'Master/detail layout: a list, click an item to show its detail (directories, catalogs).', libs: [], content: COMP_LIST_DETAIL },
  { id: 'comp-markdown', kind: 'component', title: 'Markdown render', description: 'Render safe GFM markdown (AI stories, blog posts, docs) to styled HTML.', libs: ['aimeat-markdown'], content: COMP_MARKDOWN },
  { id: 'comp-mermaid-diagram', kind: 'component', title: 'Mermaid diagram', description: 'Render flowcharts / sequence / gantt / mindmap diagrams from text definitions (self-hosted mermaid pack), theme-aware, definitions saved to memory.', libs: [], packs: ['mermaid'], content: COMP_MERMAID_DIAGRAM },
  { id: 'comp-three-scene', kind: 'component', title: '3D scene (three.js)', description: 'A themed, resizable WebGL 3D scene on the self-hosted three.js pack (r128 UMD) — lights, camera, animation loop, theme-aware background.', libs: [], packs: ['three'], content: COMP_THREE_SCENE },
  { id: 'comp-p5-sketch', kind: 'component', title: 'p5.js sketch', description: 'An instance-mode p5.js creative-coding sketch (generative art, particles) with parameter persistence and image export via AIMEAT.', libs: [], packs: ['p5'], content: COMP_P5_SKETCH },
  { id: 'comp-pixi-stage', kind: 'component', title: 'PixiJS stage', description: 'A PixiJS v8 WebGL stage (async init, app.canvas, v8 Graphics chain) rendering hundreds of animated sprites.', libs: [], packs: ['pixi'], content: COMP_PIXI_STAGE },
  { id: 'comp-phaser-arcade', kind: 'component', title: 'Phaser arcade shell', description: 'A Phaser 3 game shell: generated textures (no asset files), FIT scaling, arcade physics, and an AIMEAT public high-score leaderboard.', libs: ['aimeat-auth', 'aimeat-data'], packs: ['phaser'], content: COMP_PHASER_ARCADE },
  { id: 'comp-flow-editor', kind: 'component', title: 'Flow / mindmap editor', description: 'An editable drag-and-drop flow or mindmap (aimeat-flow cortex): presets, connect, rename-on-dblclick, save/load to flow:* memory.', libs: ['aimeat-auth', 'aimeat-data'], packs: ['aimeat-flow'], content: COMP_FLOW_EDITOR },
  {
    id: 'usecase-realtime-social',
    kind: 'use-case',
    title: 'Realtime social room',
    description: 'A live room: logged-in users get live presence + chat with durable history. Chat, presence boards, multiplayer lobbies.',
    libs: ['aimeat-auth', 'aimeat-data'],
    composes: ['comp-realtime-room', 'comp-shared-feed', 'comp-auth-gated'],
    content: USECASE_REALTIME_SOCIAL,
  },
  {
    id: 'usecase-marketplace',
    kind: 'use-case',
    title: 'Marketplace (single-seller storefront)',
    description: 'Anyone browses + searches the public listings and opens a detail view; the seller posts listings with images. One public index key, anon-readable. For multi-seller, use an extension.',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-storage'],
    composes: ['comp-list-detail', 'comp-image-upload', 'comp-search', 'comp-auth-gated'],
    content: USECASE_MARKETPLACE,
  },
  {
    id: 'usecase-homepage',
    kind: 'use-case',
    title: 'Homepage / personal site',
    description: 'A single-writer public site: anyone views the owner profile + blog/feed; the owner edits the profile and publishes posts (markdown body, images, optional AI-written draft).',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-storage', 'aimeat-ai', 'aimeat-markdown'],
    composes: ['comp-markdown', 'comp-image-upload', 'comp-ai-action', 'comp-auth-gated'],
    content: USECASE_HOMEPAGE,
  },
];

// Localized title/description for the picker (the templates a non-technical user
// actually sees). English lives on the template itself; other languages overlay
// here, keyed by id. Only the picker-visible templates (shells + use-cases) need it.
const TRANSLATIONS: Record<string, Record<string, { title: string; description?: string }>> = {
  fi: {
    'shell-pure-client': { title: 'Vakiosovellus — kirjautuminen + tallentaa tietosi' },
    'shell-cortex': { title: 'Datasovellus — valmiit taulukot, lomakkeet & kaaviot' },
    'shell-extension': { title: 'Yhdistetty sovellus — hakee ulkoista dataa / ajastetut tehtävät (edistynyt)' },
    'usecase-realtime-social': { title: 'Reaaliaikainen yhteisöhuone', description: 'Live-huone: kirjautuneet käyttäjät saavat live-läsnäolon + chatin pysyvällä historialla. Chatit, läsnäolotaulut, moninpeliaulat.' },
    'usecase-marketplace': { title: 'Kauppapaikka (yhden myyjän myymälä)', description: 'Kuka tahansa selaa + hakee julkisia ilmoituksia ja avaa yksityiskohdat; myyjä lisää ilmoituksia kuvilla.' },
    'usecase-homepage': { title: 'Kotisivu / henkilökohtainen sivusto', description: 'Yhden kirjoittajan julkinen sivusto: kuka tahansa katselee profiilia + blogia; omistaja muokkaa ja julkaisee.' },
  },
};

/** All authoring templates. */
export function getAppTemplates(): AppTemplate[] {
  return TEMPLATES;
}

/**
 * Lightweight index (no content) — for injecting a menu into a prompt or rendering
 * a picker. Pass a `lang` (e.g. 'fi') to get localized title/description where a
 * translation exists; everything else falls back to the canonical English.
 */
export function getAppTemplateIndex(lang?: string): Array<Pick<AppTemplate, 'id' | 'kind' | 'tier' | 'title' | 'description' | 'libs'>> {
  const tr = (lang && TRANSLATIONS[lang]) || null;
  return TEMPLATES.map(({ id, kind, tier, title, description, libs }) => {
    const o = tr && tr[id];
    return { id, kind, tier, title: (o && o.title) || title, description: (o && o.description) || description, libs };
  });
}
