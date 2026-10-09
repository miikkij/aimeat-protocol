/**
 * @file library-packs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 — 2026-10-09 — PackChange, PackProof and LibraryPack come from ./library-packs/types.ts
 *     (re-exported here unchanged) instead of a second copy in this file; the leaf file had been
 *     restored on 2026-09-05 and nothing imported it.
 *   v1.1.0 — 2026-09-03 — The index carries supersededBy and showcaseUrl; the Finnish and Spanish
 *     overlays live in ./library-packs/translations.ts and cover every node pack.
 *   2026-07-19 — Self-reported acceleration proofs (AppDev KB Phase 8): community-pack + template proofs; self_reported labeling
 *   v1.0.0 — 2026-07-16 — initial registry + surface generators (Library Acceleration Program,
 *     Phase 1: kills the 4-way hardcoded lib-list drift).
 */

import { SDK_PACKS } from './library-packs/sdk.js';
import { CORTEX_PACKS } from './library-packs/cortex.js';
import { VENDORED_PACKS } from './library-packs/vendored.js';
import { TRANSLATIONS } from './library-packs/translations.js';

import type { LibraryPack, PackChange, PackProof } from './library-packs/types.js';
// The record types moved to ./library-packs/types.ts (pure extraction, 2026-10-09) so a pack file
// can import them without this file, which imports every pack file. Re-exported here unchanged.
export type { LibraryPack, PackChange, PackProof };

const PACKS: LibraryPack[] = [...SDK_PACKS, ...CORTEX_PACKS, ...VENDORED_PACKS];


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
  Pick<LibraryPack, 'id' | 'kind' | 'category' | 'title' | 'description' | 'url' | 'include' | 'requires' | 'version' | 'license' | 'apiSurface' | 'demoTemplateId' | 'skillRef' | 'tierHint' | 'interviewTriggers' | 'sizeEstimate' | 'status' | 'modelTier' | 'proofs' | 'apiCaveat' | 'supersededBy' | 'showcaseUrl'>
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
      // A deprecated pack names what replaces it; a pack with a public showcase says where it is seen working.
      supersededBy: p.supersededBy, showcaseUrl: p.showcaseUrl,
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
    if (p.status === 'deprecated') {
      entry.deprecated = true;
      if (p.supersededBy) entry.superseded_by = p.supersededBy;
    }
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

/**
 * The ATELIER specification's library section, from the same registry and the same lines as the
 * Classic one, without the Classic track's styling packs (the cortex UI bundles are daisyUI-based,
 * and an Atelier page gets its components from the kit).
 *
 * Until 2026-09-19 the Atelier text named four libraries in passing and never pointed at the list,
 * and its skill forbids reading the Classic specification, where the list lives. So a builder on
 * the track every new app goes on never saw that the node has a voice library, a calendar, a print
 * engine or a storage helper, and wrote them.
 */
export function buildAtelierLibrarySection(nodeUrl: string): string {
  let s = '## The node\'s libraries: read this list before you write a mechanism\n\n';
  s += 'Speech, audio, files, live updates, notifications, printing, calendars, decisions, payments and agents are already written, served by this node and kept in step with it. '
    + 'Before you write a mechanism of your own, find it here. An app that runs its own speech loop, its own socket or its own `fetch` to `/v1/memory` works on the day it ships and stops following the platform afterwards, and the publish says so (`app_hints`, pitfall `hand-rolled`).\n\n';
  s += 'Load with `<script src>` from ' + nodeUrl + '/v1/libs/, after `aimeat-auth` and beside the kit. Include ONLY the ones you use.\n\n';
  for (const { group, heading } of PROMPT_GROUP_HEADINGS) {
    const lines = SDK_PACKS.filter(p => p.promptGroup === group && p.promptLine && p.status !== 'deprecated');
    if (lines.length === 0) continue;
    s += heading.replace(' (prompt-driven — see the AI section below)', '') + '\n';
    s += lines.map(p => p.promptLine as string).join('\n') + '\n\n';
  }
  s += 'Each library\'s full usage is one call away: `GET ' + nodeUrl + '/v1/library-packs/<id>` (the `ai_doc` field), or `GET ' + nodeUrl + '/v1/libs` for the list with sizes. '
    + 'Third-party engines the node hosts itself (maps, charts, 3D, editors, game engines) are in `GET ' + nodeUrl + '/v1/library-packs`; never load one from an outside CDN.\n\n';
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
    // The deprecation label used to be printed for sdk packs only, so a deprecated VENDORED pack
    // appeared here with its ordinary description and nothing else — and the vendored packs are
    // exactly the ones that get replaced, since a new major of a browser library ships as a new
    // file beside the old one. A model reading this table would have picked the dead one.
    const doc = p.status === 'deprecated'
      ? p.description + ' (DEPRECATED — do not use in new apps'
        + (p.supersededBy ? `; use ${p.supersededBy} instead)` : ')')
      : p.kind === 'sdk'
        ? p.aiDoc
        : tier + p.description + caveat + ' Full usage doc: GET /v1/library-packs/' + p.id;
    rows.push(`| ${p.id} | \`${p.url}\` | ${cell(doc)} |`);
  }
  return rows.join('\n');
}
