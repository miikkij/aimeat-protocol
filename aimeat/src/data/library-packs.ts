/**
 * @file library-packs.ts
 * @description The library-pack registry — ONE data-driven source of truth for every
 *   client-side library an AIMEAT app can include (SDK wrappers at /v1/libs, node-bundled
 *   cortex libs at /v1/cortex/<n>/libs, vendored third-party assets at /lib). Every AI-facing
 *   surface derives from this registry so the lists can never drift again:
 *     - GET /v1/library-packs (+ /:id with the full aiDoc + changelog) — routes/library-packs.ts
 *     - GET /v1/libs catalogue — routes/libs.ts (buildLibsCatalogue)
 *     - the build-app prompt's library sections — services/build-app-prompt.ts (buildPromptLibrarySections)
 *     - bootstrap sdk_libraries — routes/bootstrap.ts (buildSdkLibrariesList)
 *     - llms-full.txt Client SDK Libraries table — {{LIBRARY_PACKS_TABLE}} token (buildLlmsPacksTable)
 *   A pack = include line(s) + version + per-library AI usage doc (aiDoc) + changelog + demo
 *   template link + interview triggers. `status:'stable'` is gated on a demo + an AEB
 *   acceleration result (Library Acceleration Program). Versioning policy: public/lib/VENDORED.md.
 * @structure LibraryPack · PackChange · SDK_PACKS/CORTEX_PACKS/VENDORED_PACKS (./library-packs/)
 *   · getLibraryPacks() · getLibraryPack() · getLibraryPackIndex() · renderPackText()
 *   · buildLibsCatalogue() · buildPromptLibrarySections() · buildSdkLibrariesList()
 *   · buildLlmsPacksTable()
 * @usage import { getLibraryPacks, buildPromptLibrarySections } from '../data/library-packs.js';
 * @version-history
 *   2026-07-19 — Self-reported acceleration proofs (AppDev KB Phase 8): community-pack + template proofs; self_reported labeling
 *   v1.0.0 — 2026-07-16 — initial registry + surface generators (Library Acceleration Program,
 *     Phase 1: kills the 4-way hardcoded lib-list drift).
 */

import { SDK_PACKS } from './library-packs/sdk.js';
import { CORTEX_PACKS } from './library-packs/cortex.js';
import { VENDORED_PACKS } from './library-packs/vendored.js';

export interface PackChange {
  /** The pack version this entry describes. */
  version: string;
  /** ISO date of the change. */
  date: string;
  /** Written FOR AN AI reading it later: what changed and what it means for existing apps. */
  summary: string;
  /** Present ONLY when existing apps must change something (rare — majors ship as new files). */
  breaking?: string;
}

/**
 * One recorded AEB proof: the pack run on ONE model, against a shared test set.
 * The ledger is append-only — a new model's run adds an entry, never overwrites another.
 * See tools/aeb/acceleration-tiers.md ("Add your own proof") for how these are produced.
 */
export interface PackProof {
  /** Model id the run used, e.g. 'claude-haiku-4-5', 'claude-opus-4-8'. */
  model: string;
  /** Did the pack accelerate/render on this model, per the checklist + browser verify. */
  verdict: 'pass' | 'fail';
  /** The shared test set id under tools/aeb/specs/, e.g. 'pixi' → pixi.spec.md + pixi.checklist.md. */
  testSet: string;
  /** Repo-relative evidence file (tokens, checklist, browser findings), e.g. 'tools/aeb/results/aeb3-pixi-perpack.md'. */
  evidence: string;
  /** Output tokens the treatment arm spent, when recorded. */
  tokens?: number;
  /** ISO date of the run. */
  date: string;
}

export interface LibraryPack {
  /** Stable id, e.g. 'chartjs', 'aimeat-charts', 'styling'. */
  id: string;
  /** sdk = /v1/libs wrapper · cortex = node-bundled cortex lib · vendored = /lib third-party · bundle = multi-file set. */
  kind: 'sdk' | 'cortex' | 'vendored' | 'bundle';
  category: 'core' | 'ai' | 'ui' | 'visualization' | 'diagrams' | 'canvas' | 'game' | '3d' | 'realtime' | 'economy' | 'media';
  title: string;
  /** One line (English) — shown in the index, catalogue and pack pickers. */
  description: string;
  /** Canonical path of the main file (root-relative). */
  url: string;
  /** Exact include line(s) in load order; {{BASE_URL}} is substituted at render time. */
  include: string[];
  /** Pack ids this pack needs loaded first. */
  requires: string[];
  /** Pinned version (vendored/bundle) or the cortex spec.version. SDK packs omit it (always served live from the node). */
  version?: string;
  /** The frozen-major filename contract, e.g. 'chartjs@4' — see public/lib/VENDORED.md. */
  majorPin?: string;
  license: string;
  sourceUrl?: string;
  /** The global/API namespace an app talks to, e.g. 'AIMEAT.charts', 'window.Phaser'. */
  apiSurface: string;
  /** The acceleration payload: a 10–40 line usage doc an AI reads BEFORE writing code with the pack. */
  aiDoc: string;
  /** What changed and what it means for existing apps — newest last. */
  changelog: PackChange[];
  /** app-templates id of the demo that proves the pack (required for status 'stable'). */
  demoTemplateId?: string;
  /** node:-scoped skill carrying deep docs (@semver-pinnable), when the aiDoc is not enough. */
  skillRef?: string;
  /** Which app-shell tier the pack implies (cortex packs → T2 shell). */
  tierHint: 'T1' | 'T2' | 'T3';
  /** Idea-text keywords that pre-select this pack in the interview / catalog picker. */
  interviewTriggers: string[];
  sizeEstimate: string;
  /** stable REQUIRES a demo template + a recorded AEB acceleration result. */
  status: 'preview' | 'stable' | 'deprecated';
  /**
   * The strongest model-strength this pack is reliably-and-accelerated on — a WARNING label, not a
   * gate (an unlabelled pack still ships). Driven by API-version drift from training data:
   *   'any'       — pin == the API models know; a mid-tier model codes it correctly from memory.
   *   'frontier'  — breaking API vs the version most examples show; weak models write the old API
   *                 from memory and crash → carry an `apiCaveat` and prefer forcing the ai_doc.
   *   'needs-doc' — AIMEAT-authored/wrapper, no training-data priors; must fetch the ai_doc to use
   *                 it at all (no crash, just a silent no-op if skipped).
   * Derivable from `proofs` (strongest model with a 'pass'); set explicitly until proofs exist.
   * Full scheme + how a pack earns this: tools/aeb/acceleration-tiers.md.
   */
  modelTier?: 'any' | 'frontier' | 'needs-doc';
  /**
   * The per-model AEB proof ledger — which models this pack has actually been demonstrated on.
   * Lets a client/pipeline pick a pack proven on the model it is about to use. Append-only.
   */
  proofs?: PackProof[];
  /**
   * For `modelTier:'frontier'` packs ONLY: the one-line breaking-API idiom a weak model gets wrong
   * from stale memory. The build-app prompt INLINES this next to the pack (so a model that skips the
   * ai_doc still gets corrected), e.g. pixi's "v8 Graphics chains .rect().fill(), NOT beginFill()/
   * drawRect() (v7, removed)". Keep it to the single most load-bearing gotcha.
   */
  apiCaveat?: string;
  /** Exact line used in the build-app prompt (sdk/cortex packs that the prompt lists). */
  promptLine?: string;
  /** Build-app-prompt grouping for sdk packs. */
  promptGroup?: 'core' | 'ai' | 'economy' | 'media';
}

const PACKS: LibraryPack[] = [...SDK_PACKS, ...CORTEX_PACKS, ...VENDORED_PACKS];

// Localized title/description overlays for picker-visible packs (same pattern as
// app-templates.ts TRANSLATIONS). English lives on the pack itself.
const TRANSLATIONS: Record<string, Record<string, { title: string; description?: string }>> = {
  fi: {
    styling: { title: 'Tyylipino (Tailwind + daisyUI)', description: 'Itse isännöity Tailwind CSS v4 + daisyUI v5 + AIMEAT-teemasilta — utility-luokat ilman käsin kirjoitettua CSS:ää, seuraa vaalea/tumma-teemaa.' },
    chartjs: { title: 'Chart.js 4 (raaka)', description: 'Chart.js v4 itse isännöitynä (window.Chart) — koko Chart.js-API omiin kaavioihin; aimeat-charts-cortex on saman tiedoston helpompi kääre.' },
    mermaid: { title: 'Mermaid-kaaviot', description: 'Mermaid v11 itse isännöitynä — vuokaaviot, sekvenssi-/luokka-/tilakaaviot, gantt ja mindmapit tekstimäärittelyistä.' },
    three: { title: 'three.js (3D)', description: 'three.js r128 itse isännöitynä (window.THREE) — WebGL-3D-scenet: geometriat, materiaalit, valot, kamerat.' },
    p5: { title: 'p5.js (luova koodaus)', description: 'p5.js v1 itse isännöitynä — generatiivinen taide, interaktiiviset luonnokset, partikkelit setup()/draw()-mallilla.' },
    pixi: { title: 'PixiJS 8 (2D WebGL)', description: 'PixiJS v8 itse isännöitynä — nopea WebGL/WebGPU-2D-renderöinti: spritet, partikkelit, filtterit, tuhansia liikkuvia objekteja.' },
    phaser: { title: 'Phaser 3 (pelimoottori)', description: 'Phaser v3 itse isännöitynä — täysi 2D-pelimoottori: scenet, arcade-fysiikka, syötteet, spritet, animaatiot, ääni.' },
    'aimeat-flow': { title: 'Flow-/mindmap-editori', description: 'Muokattavat drag-and-drop-prosessi- ja miellekarttakaaviot — yksi create()-kutsu, presetit, tallennus flow:*-muistiin. Moottori on wrapperin sisäinen.' },
    realtime: { title: 'Realtime-huoneet (AimeatRealtime)', description: 'WebSocket-P2P-huoneet, WebRTC-datakanavat ja Yjs CRT -jaettu tila — moninpelit, live-yhteistyö ja chat.' },
  },
};

/** All library packs. */
export function getLibraryPacks(): LibraryPack[] {
  return PACKS;
}

/** One pack by id. */
export function getLibraryPack(id: string): LibraryPack | undefined {
  return PACKS.find(p => p.id === id);
}

/** Substitute the {{BASE_URL}} placeholder in include lines / doc text. */
export function renderPackText(text: string, baseUrl: string): string {
  return text.replaceAll('{{BASE_URL}}', baseUrl.replace(/\/+$/, ''));
}

/**
 * Lightweight index (no aiDoc/changelog/promptLine) — for GET /v1/library-packs and pickers.
 * Pass a lang (e.g. 'fi') for localized title/description where a translation exists.
 */
export function getLibraryPackIndex(lang?: string): Array<
  Pick<LibraryPack, 'id' | 'kind' | 'category' | 'title' | 'description' | 'url' | 'include' | 'requires' | 'version' | 'license' | 'apiSurface' | 'demoTemplateId' | 'skillRef' | 'tierHint' | 'interviewTriggers' | 'sizeEstimate' | 'status' | 'modelTier' | 'proofs' | 'apiCaveat'>
> {
  const tr = (lang && TRANSLATIONS[lang]) || null;
  return PACKS.map(p => {
    const o = tr && tr[p.id];
    return {
      id: p.id, kind: p.kind, category: p.category,
      title: (o && o.title) || p.title,
      description: (o && o.description) || p.description,
      url: p.url, include: p.include, requires: p.requires, version: p.version,
      license: p.license, apiSurface: p.apiSurface, demoTemplateId: p.demoTemplateId,
      skillRef: p.skillRef, tierHint: p.tierHint, interviewTriggers: p.interviewTriggers,
      sizeEstimate: p.sizeEstimate, status: p.status,
      // AI-acceleration tier + per-model proof ledger + the frontier-pack caveat (tools/aeb/acceleration-tiers.md).
      modelTier: p.modelTier, proofs: p.proofs, apiCaveat: p.apiCaveat,
    };
  });
}

/**
 * The GET /v1/libs catalogue array — derived from the sdk packs. Response shape is
 * backwards-compatible with the pre-registry hardcoded list (fields added, none removed).
 */
export function buildLibsCatalogue(baseUrl: string): Array<Record<string, unknown>> {
  return SDK_PACKS.map(p => {
    const entry: Record<string, unknown> = {
      name: p.id,
      url: p.url,
      description: p.description,
      size_estimate: p.sizeEstimate,
      include: renderPackText(p.include.join('\n'), baseUrl),
    };
    if (p.requires.length > 0) entry.requires = p.requires.join(', ');
    if (p.status === 'deprecated') entry.deprecated = true;
    return entry;
  });
}

const PROMPT_GROUP_HEADINGS: Array<{ group: NonNullable<LibraryPack['promptGroup']>; heading: string }> = [
  { group: 'core', heading: 'Core:' },
  { group: 'ai', heading: 'AI (prompt-driven — see the AI section below):' },
  { group: 'economy', heading: 'Economy & agents:' },
  { group: 'media', heading: 'Media & misc:' },
];

/**
 * The build-app prompt's library sections (Available Client Libraries + Ready-made UI +
 * Optional capability packs), generated from the registry. Consumed by build-app-prompt.ts.
 */
export function buildPromptLibrarySections(nodeUrl: string): string {
  let s = '';
  s += '### Available Client Libraries\n';
  s += 'Load with <script src> from the node base ' + nodeUrl + '/v1/libs/. Include ONLY the ones you use. Load aimeat-auth first — the others build on its session.\n\n';
  for (const { group, heading } of PROMPT_GROUP_HEADINGS) {
    const lines = SDK_PACKS.filter(p => p.promptGroup === group && p.promptLine && p.status !== 'deprecated');
    if (lines.length === 0) continue;
    s += heading + '\n';
    s += lines.map(p => p.promptLine as string).join('\n') + '\n\n';
  }

  s += 'Ready-made UI (node-bundled — load from ' + nodeUrl + '/v1/cortex/<name>/libs/<name>.js, use only what you need):\n';
  for (const p of CORTEX_PACKS) {
    if (p.promptLine && p.status !== 'deprecated') s += p.promptLine + '\n';
  }
  s += 'Example: <script src="' + nodeUrl + '/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></' + 'script>\n\n';

  const capability = VENDORED_PACKS.filter(p => p.status !== 'deprecated');
  if (capability.length > 0) {
    s += 'Optional capability packs (vendored third-party libraries, self-hosted on this node — NEVER load these from an external CDN):\n';
    s += 'Each pack carries a reliability tag from AEB testing: [any] a mid-tier model codes it correctly from memory · [frontier] the pinned API BREAKS vs the version you likely know — you MUST fetch its ai_doc, and heed the ⚠ line · [needs-doc] AIMEAT-authored, no priors — fetch its ai_doc or you cannot use it.\n';
    for (const p of capability) {
      const inc = renderPackText(p.include.join(' + '), nodeUrl);
      const tier = p.modelTier ? ' [' + p.modelTier + ']' : '';
      s += '- ' + p.id + tier + ' — ' + p.description + ' Include: ' + inc + '\n';
      // Frontier-tier packs pin an API that BREAKS vs the version a model knows from memory —
      // inline the one load-bearing gotcha so a model that skips the ai_doc still gets corrected.
      if (p.apiCaveat) s += '  ⚠ ' + p.apiCaveat + '\n';
    }
    s += 'Before writing code that uses a capability pack, fetch its full usage doc (API idioms, version notes, gotchas): GET ' + nodeUrl + '/v1/library-packs/<id> — the ai_doc field (it also returns modelTier + the per-model proof ledger). Index of every pack: GET ' + nodeUrl + '/v1/library-packs. Include ONLY packs the user\'s needs match.\n';
    s += 'The live index may also list COMMUNITY packs (scope "community") — cortex libraries published by users on this node, with the same include + ai_doc contract. They are unvetted (always status "preview"): prefer a node-scope pack when one covers the same need, and read a community pack\'s ai_doc before trusting its API. A community pack may carry SELF-REPORTED per-model proofs (proofs[] with self_reported: true, proven_models) — treat them as the owner\'s own acceleration claims, not a node-verified badge.\n\n';
  }
  return s;
}

/** The bootstrap GET / `sdk_libraries` list — "<url> - <description>" per non-deprecated pack. */
export function buildSdkLibrariesList(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/+$/, '');
  return PACKS.filter(p => p.status !== 'deprecated').map(p => `${base}${p.url} - ${p.description}`);
}

/**
 * The llms-full.txt "Client SDK Libraries" markdown table — substituted for the
 * {{LIBRARY_PACKS_TABLE}} token in public/llms-template.txt (routes/bootstrap.ts).
 * SDK rows carry the richer aiDoc (matching the pre-registry table cells); cortex/vendored
 * rows carry the one-line description + a pointer to the pack detail endpoint.
 */
export function buildLlmsPacksTable(): string {
  const rows: string[] = [
    '| Library | URL | What it does |',
    '|---------|-----|-------------|',
  ];
  const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  for (const p of PACKS) {
    const tier = p.modelTier ? `[${p.modelTier}] ` : '';
    const caveat = p.apiCaveat ? ` ⚠ ${p.apiCaveat}` : '';
    const doc = p.kind === 'sdk'
      ? (p.status === 'deprecated' ? p.description + ' (DEPRECATED — do not use in new apps)' : p.aiDoc)
      : tier + p.description + caveat + ' Full usage doc: GET /v1/library-packs/' + p.id;
    rows.push(`| ${p.id} | \`${p.url}\` | ${cell(doc)} |`);
  }
  return rows.join('\n');
}
