#!/usr/bin/env node
/**
 * Build a comicland-v2 AIMEAT package ZIP.
 *
 * Reads the Comicland source files from the session outputs directory,
 * constructs an AIMEAT package matching the format that
 * `aimeat/src/services/package-zip.ts buildZip()` produces, and writes
 * the ZIP to `packages/comicland-v2-<version>.zip`.
 *
 * The resulting ZIP is uploadable to any AIMEAT node via
 * `POST /v1/packages/import` (multipart). Once imported, the package
 * appears in the node's gallery and can be INSTANCE-installed via
 * `POST /v1/packages/<groupId>/install` — each install spins up an
 * isolated set of components named `comicland-v2-<owner>-<shortId>-<componentId>`.
 *
 * Run:
 *   node packages/build-comicland-v2.mjs
 *
 * Requires: archiver (already in aimeat dev deps).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Paths ────────────────────────────────────────────────────────────────
const SRC = 'C:/Users/mail/AppData/Roaming/Claude/local-agent-mode-sessions/76dadc30-65bd-4876-b38b-5ebf091bb0ef/dd66332a-6e4f-419d-9910-1c217401b640/local_2eb02dfd-46c3-4bf4-b445-89084b8cdcc0/outputs';
const EXT_DIR = path.join(SRC, 'comicland-v2-fixed');
const APP_FILE = path.join(SRC, 'comicland-v2-app.html');
const CORTEX_LIB_FILE = path.join(SRC, 'comicland-v2-cortex.js');
const CORTEX_MANIFEST_FILE = path.join(SRC, 'comicland-v2-cortex-manifest.yaml');

// ─── Version ──────────────────────────────────────────────────────────────
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const VERSION = `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

// ─── Helpers ──────────────────────────────────────────────────────────────
async function readText(p) {
  return await fs.readFile(p, 'utf-8');
}

async function loadExtensionScripts() {
  const scriptsDir = path.join(EXT_DIR, 'scripts', 'actions');
  const files = await fs.readdir(scriptsDir);
  const scripts = {};
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const content = await readText(path.join(scriptsDir, file));
    // Key matches the `script:` field in the manifest, e.g. "actions/init.js"
    scripts[`actions/${file}`] = content;
  }
  return scripts;
}

// ─── Build components ─────────────────────────────────────────────────────
async function buildExtensionComponent() {
  const manifest = await readText(path.join(EXT_DIR, 'manifest.yaml'));
  const scripts = await loadExtensionScripts();
  // Component-registrar expects extension content as JSON-stringified
  // { manifest: "<YAML>", scripts: { "actions/foo.js": "<code>" } }.
  return {
    id: 'extension-comicland-v2',
    type: 'extension',
    label: 'Comicland v2 Server-side Extension (router actions)',
    content: JSON.stringify({ manifest, scripts }),
    dependencies: [], // extension doesn't depend on anything else in the package
  };
}

async function buildCortexComponent() {
  const manifest = await readText(CORTEX_MANIFEST_FILE);
  const libJs = await readText(CORTEX_LIB_FILE);
  // Cortex content is JSON-stringified { manifest: "<YAML>", libs: { "filename.js": "<code>" } }.
  return {
    id: 'cortex-comicland-v2',
    type: 'cortex',
    label: 'Comicland v2 Browser API (cortex lib)',
    content: JSON.stringify({
      manifest,
      libs: { 'comicland-v2.js': libJs },
    }),
    dependencies: ['extension-comicland-v2'], // cortex calls extension actions
  };
}

async function buildAppComponent() {
  const html = await readText(APP_FILE);
  return {
    id: 'app-comicland-v2',
    type: 'app',
    label: 'Comicland v2 — Web App (SPA)',
    content: html,
    dependencies: ['cortex-comicland-v2'], // app loads cortex
  };
}

function buildTranslationComponent(lang, content) {
  return {
    id: `translation-${lang}`,
    type: 'translation',
    label: `Comicland v2 — ${lang.toUpperCase()} translations`,
    content: JSON.stringify({
      entries: [
        { key: `comicland.i18n.${lang}`, value: content, visibility: 'public' },
      ],
    }),
    dependencies: [],
  };
}

function buildMemoryDefaults() {
  // Seed memory entries for a fresh install: empty settings, empty featured list.
  // The extension's @activate action runs these too via the seed-prompts +
  // init scripts; this memory component is the "ground state" so an install
  // works even if @activate hasn't run yet.
  return {
    id: 'memory-defaults',
    type: 'memory',
    label: 'Comicland v2 — Default settings + flag fees',
    content: JSON.stringify({
      entries: [
        {
          key: 'comicland.settings',
          value: {
            default_age: 'k-13',
            default_format: 'free',
            ui_lang: 'fi',
            morsels_per_publish: 5,
            morsels_per_episode: 2,
          },
          visibility: 'private',
        },
        {
          key: 'comicland.flag_fees',
          value: {
            spam: 1, abuse: 3, copyright: 5, illegal: 10,
          },
          visibility: 'public',
        },
        {
          key: 'comicland.featured',
          value: [],
          visibility: 'public',
        },
      ],
    }),
    dependencies: [],
  };
}

// Minimal i18n payloads — full set is embedded in the SPA's lang() block.
// These are seed entries so the cortex's getTranslations() returns something
// on a fresh install before the user has edited them.
const I18N_FI = {
  'app.title': 'Comicland',
  'app.tagline': 'AI-sarjakuvayhteisö',
  'common.publish': 'Julkaise',
  'common.save': 'Tallenna',
  'common.cancel': 'Peruuta',
  'common.delete': 'Poista',
  'common.edit': 'Muokkaa',
  'common.loading': 'Ladataan...',
  'nav.catalog': 'Sarjikset',
  'nav.characters': 'Hahmot',
  'nav.environments': 'Miljööt',
  'nav.create': 'Luo',
  'nav.profile': 'Profiili',
  'nav.settings': 'Asetukset',
};

const I18N_EN = {
  'app.title': 'Comicland',
  'app.tagline': 'AI comic community',
  'common.publish': 'Publish',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.loading': 'Loading...',
  'nav.catalog': 'Series',
  'nav.characters': 'Characters',
  'nav.environments': 'Environments',
  'nav.create': 'Create',
  'nav.profile': 'Profile',
  'nav.settings': 'Settings',
};

// ─── Manifest YAML (root of ZIP) ──────────────────────────────────────────
const CHANGELOG = `${VERSION} — initial package release.

Snapshot of the live Comicland v2 stack after the v2.41 + v2.42 development cycle:

Highlights:
  - Prompt-driven AI comic community (catalog, characters, environments, series, episodes, reviews)
  - Asset Basket pattern (characters + environments as shared pool, CC-licensed)
  - Author analytics (panel views + drop-off heatmap, comment threading, reactions)
  - Bubble Text Editor with page-group detection (multi-panel page images)
  - Full AI integration via the user's own OpenRouter key (per-app daily budget):
      * Series: ✨ Suggest tags / Polish summary / Generate foreword / Generate afterword
      * Episode wizard: ✨ Suggest title / Generate foreword / Generate afterword
      * Character + Environment: ✨ Polish description
      * Translate page: free-form language input + side-by-side review
      * Bubble editor: per-page translate all bubbles
  - JSON auto-repair (fence-strip + truncation recovery) for unreliable models
  - Self-contained backup: this package ZIP includes the extension (server-side
    router actions), the cortex (browser-side API), the SPA app, default
    settings, and Finnish/English translation seeds. Importable to any AIMEAT
    node; instantiable as many times as the owner wants (each instance gets a
    unique component-name prefix so they don't collide).

Categories of components:
  - extension-comicland-v2: 15 router actions (users, series, episodes, prompts,
      moderation, reviews, translations, subscriptions, characters,
      environments, attributions, admin-config, engagement) running in WASM
  - cortex-comicland-v2: browser-side API (\\Comicland.* methods) used by the SPA
  - app-comicland-v2: the full SPA (HTML/CSS/JS), ~430 KB
  - memory-defaults: settings.config, flag_fees, featured-empty
  - translation-fi / translation-en: minimal i18n seeds (full set is embedded
      in the SPA)
`;

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const components = [
    buildMemoryDefaults(),
    buildTranslationComponent('fi', I18N_FI),
    buildTranslationComponent('en', I18N_EN),
    await buildExtensionComponent(),
    await buildCortexComponent(),
    await buildAppComponent(),
  ];

  const COMPONENT_EXTENSIONS = {
    csm: '.yaml',
    extension: '.yaml',
    cortex: '.yaml',
    app: '.html',
    msm: '.yaml',
    memory: '.json',
    translation: '.json',
  };

  const manifest = {
    'aimeat-package': '1.0',
    name: 'comicland-v2',
    author: 'happydude500001',
    authorGhii: 'happydude500001@aimeat-finland-001-genesis',
    version: VERSION,
    description: 'Prompt-driven AI comic community on AIMEAT. Compose comics from characters + environments + generated panels with full AI assistance. Multi-language via AI translation, page-aware bubble editor, asset basket, author analytics.',
    category: 'community',
    tags: ['comics', 'webcomics', 'ai-comics', 'community', 'openrouter', 'prompt-driven'],
    components: components.map(c => ({
      id: c.id,
      type: c.type,
      label: c.label,
      file: `components/${c.id}${COMPONENT_EXTENSIONS[c.type]}`,
      dependencies: c.dependencies,
    })),
    changelog: CHANGELOG,
  };

  // Output path
  const outPath = path.join(__dirname, `comicland-v2-${VERSION}.zip`);
  const out = await fs.open(outPath, 'w');
  const stream = out.createWriteStream();

  await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    stream.on('close', resolve);
    archive.pipe(stream);
    archive.append(YAML.stringify(manifest), { name: 'manifest.yaml' });
    for (const comp of components) {
      const ext = COMPONENT_EXTENSIONS[comp.type];
      archive.append(comp.content, { name: `components/${comp.id}${ext}` });
    }
    archive.finalize();
  });

  const stat = await fs.stat(outPath);
  console.log(`✓ Built ${outPath}`);
  console.log(`  Size: ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(`  Components: ${components.length}`);
  for (const c of components) {
    console.log(`    - ${c.id} (${c.type}, ${c.content.length} bytes)`);
  }
  console.log('');
  console.log('To upload to aimeat.io:');
  console.log(`  curl -X POST https://aimeat.io/v1/packages/import \\`);
  console.log(`    -H "Authorization: Bearer $JWT" \\`);
  console.log(`    -F "file=@${path.basename(outPath)}"`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
